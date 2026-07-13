"""Rutas CRUD de tarjetas de reparación.

Mejoras integradas: prioridad, posición, asignación, notificaciones,
costos, búsqueda server-side, S3 storage, soft delete, SQLite compat.
"""
import base64
import json
import time
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy import and_, asc, case, delete, desc, exists, func, insert, or_, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, defer

from app.core.cache import invalidate_stats
from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.kanban import Comment, KanbanColumn, SubTask, Tag, repair_card_tags
from app.models.repair_card import RepairCard, RepairCardMedia, StatusHistory
from app.models.user import User
from app.schemas.tarjeta import (
    BatchOperationRequest,
    BatchPosicionUpdate,
    BlockRequest,
    MediaReorderRequest,
    TarjetaCreate,
    TarjetaUpdate,
)
from app.services.audit_service import (
    ACTION_ASSIGNED,
    ACTION_BLOCKED,
    ACTION_CREATED,
    ACTION_DELETED,
    ACTION_PRIORITY_CHANGED,
    ACTION_REORDERED,
    ACTION_RESTORED,
    ACTION_STATUS_CHANGED,
    ACTION_TAG_ADDED,
    ACTION_UNBLOCKED,
    ACTION_UPDATED,
    get_client_ip,
    record_card_audit,
)
from app.services.auth_service import get_current_user, get_current_user_optional, require_role
from app.services.notification_service import notificar_cambio_estado
from app.services.storage_service import get_storage_service
from app.socket_events import sio

router = APIRouter(prefix="/api/tarjetas", tags=["tarjetas"])

CACHE_HEADERS = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
MAX_MEDIA_PER_CARD = 10
MAX_MEDIA_SIZE_BYTES = 8 * 1024 * 1024
ALLOWED_MEDIA_MIME = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}

# Map status to the date field that tracks when the card entered that status
_STATUS_DATE_FIELDS = {
    "ingresado": "ingresado_date",
    "diagnosticada": "diagnosticada_date",
    "para_entregar": "para_entregar_date",
    "listos": "entregados_date",
}


def _calcular_dias_en_columna(card: RepairCard) -> int:
    """Calculate days a card has been in its current column."""
    now = datetime.now(UTC)
    field = _STATUS_DATE_FIELDS.get(card.status)
    if field:
        dt = getattr(card, field, None)
        if dt:
            # Handle both naive and aware datetimes from DB
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=UTC)
            return (now - dt).days
    return 0


def _apply_status_transition(card: RepairCard, new_status: str) -> None:
    """Apply date fields for a status transition."""
    if new_status == "diagnosticada" and not card.diagnosticada_date:
        card.diagnosticada_date = datetime.now(UTC)
    elif new_status == "para_entregar" and not card.para_entregar_date:
        card.para_entregar_date = datetime.now(UTC)
    elif new_status == "listos" and not card.entregados_date:
        card.entregados_date = datetime.now(UTC)


def _get_valid_statuses(db: Session) -> list[str]:
    """Obtiene estados válidos de las columnas configuradas."""
    cols = db.query(KanbanColumn.key).order_by(KanbanColumn.position).all()
    if cols:
        return [c[0] for c in cols]
    return ["ingresado", "diagnosticada", "para_entregar", "listos"]


def _check_wip_limit(db: Session, column_key: str, exclude_card_id: int | None = None) -> None:
    """Check WIP limit for a column. Raises HTTPException if exceeded."""
    col = db.query(KanbanColumn).filter(KanbanColumn.key == column_key).first()
    if col and col.wip_limit:
        q = db.query(RepairCard).filter(
            RepairCard.status == column_key,
            RepairCard.deleted_at.is_(None),
        )
        if exclude_card_id:
            q = q.filter(RepairCard.id != exclude_card_id)
        # Lock rows in destination column to reduce WIP race under concurrency.
        try:
            q = q.with_for_update()
        except Exception:
            pass
        if q.count() >= col.wip_limit:
            raise HTTPException(
                status_code=400,
                detail=f"Límite WIP alcanzado en '{col.title}' ({col.wip_limit} máximo)"
            )


def _ensure_not_blocked(card: RepairCard) -> None:
    if card.blocked_at is not None:
        reason = (card.blocked_reason or "").strip()
        detail = f"Tarjeta bloqueada{f': {reason}' if reason else ''}"
        raise HTTPException(status_code=400, detail=detail)


def _required_field_ok(card: RepairCard, field: str) -> bool:
    checks: dict[str, bool] = {
        "nombre_propietario": bool((card.owner_name or "").strip()),
        "problema": bool((card.problem or "").strip()) and (card.problem or "").strip() != "Sin descripción",
        "whatsapp": bool((card.whatsapp_number or "").strip()),
        "diagnosticada": card.diagnosticada_date is not None,
        "costo_estimado": card.estimated_cost is not None,
        "notas_tecnicas": bool((card.technical_notes or "").strip()),
        "asignado_a": card.assigned_to is not None,
    }
    return checks.get(field, True)


def _check_required_fields_for_column(db: Session, card: RepairCard, column_key: str) -> None:
    col = db.query(KanbanColumn).filter(KanbanColumn.key == column_key).first()
    if not col or not col.required_fields:
        return
    try:
        required = json.loads(col.required_fields)
    except (json.JSONDecodeError, TypeError):
        return
    if not isinstance(required, list):
        return
    missing = [f for f in required if isinstance(f, str) and not _required_field_ok(card, f)]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Faltan campos requeridos para '{column_key}': {', '.join(missing)}",
        )


def _check_allowed_transition(db: Session, card: RepairCard, new_status: str) -> None:
    if card.status == new_status:
        return
    col = db.query(KanbanColumn).filter(KanbanColumn.key == card.status).first()
    if not col or not col.allowed_destinations:
        return
    try:
        allowed = json.loads(col.allowed_destinations)
    except (json.JSONDecodeError, TypeError):
        return
    if isinstance(allowed, list) and allowed and new_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"Transición no permitida: {card.status} → {new_status}",
        )


def _move_card_status(
    db: Session,
    card: RepairCard,
    new_status: str,
    user: User | None,
    *,
    notify: bool = True,
    client_ip: str | None = None,
) -> str | None:
    """Aplica cambio de columna con reglas Kanban. Retorna old_status si hubo cambio."""
    _ensure_not_blocked(card)
    valid_statuses = _get_valid_statuses(db)
    if new_status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Estado no válido. Permitidos: {valid_statuses}")

    old_status = card.status
    if old_status == new_status:
        return None

    _check_allowed_transition(db, card, new_status)
    _check_required_fields_for_column(db, card, new_status)
    _check_wip_limit(db, new_status, exclude_card_id=card.id)

    record_card_audit(
        db,
        tarjeta_id=card.id,
        action=ACTION_STATUS_CHANGED,
        old_status=old_status,
        new_status=new_status,
        client_ip=client_ip,
        user=user,
    )
    if notify:
        notificar_cambio_estado(db, card, old_status, new_status)

    card.status = new_status
    _apply_status_transition(card, new_status)
    return old_status


def _column_totals_map(db: Session, filter_clauses: list) -> dict[str, int]:
    stmt = select(RepairCard.status, func.count()).group_by(RepairCard.status)
    if filter_clauses:
        stmt = stmt.where(*filter_clauses)
    return {row[0]: int(row[1]) for row in db.execute(stmt).all()}


def _media_rows_for_card(db: Session, tarjeta_id: int) -> list[RepairCardMedia]:
    return db.query(RepairCardMedia).filter(
        RepairCardMedia.tarjeta_id == tarjeta_id,
        RepairCardMedia.deleted_at.is_(None),
    ).order_by(RepairCardMedia.position.asc(), RepairCardMedia.id.asc()).all()


def _resolve_media_url(raw_url: str | None, storage_key: str | None) -> str | None:
    if not raw_url and not storage_key:
        return None
    settings = get_settings()
    public_base = (settings.s3_public_base_url or "").rstrip("/")
    if public_base and storage_key:
        return f"{public_base}/{storage_key}"
    return raw_url


def _media_cover_map(db: Session, card_ids: list[int]) -> tuple[dict[int, str | None], dict[int, int]]:
    if not card_ids:
        return {}, {}

    count_map: dict[int, int] = {}
    for row in db.query(RepairCardMedia.tarjeta_id, func.count(RepairCardMedia.id)).filter(
        RepairCardMedia.tarjeta_id.in_(card_ids),
        RepairCardMedia.deleted_at.is_(None),
    ).group_by(RepairCardMedia.tarjeta_id).all():
        count_map[row[0]] = row[1]

    rn = func.row_number().over(
        partition_by=RepairCardMedia.tarjeta_id,
        order_by=(
            RepairCardMedia.is_cover.desc(),
            RepairCardMedia.position.asc(),
            RepairCardMedia.id.asc(),
        ),
    ).label("rn")
    ranked = (
        select(
            RepairCardMedia.tarjeta_id,
            RepairCardMedia.thumb_url,
            RepairCardMedia.url,
            RepairCardMedia.storage_key,
            rn,
        )
        .where(
            RepairCardMedia.tarjeta_id.in_(card_ids),
            RepairCardMedia.deleted_at.is_(None),
        )
        .subquery()
    )
    cover_map: dict[int, str | None] = {}
    for row in db.execute(select(ranked).where(ranked.c.rn == 1)).all():
        cover_map[row.tarjeta_id] = _resolve_media_url(row.thumb_url or row.url, row.storage_key)
    return cover_map, count_map


def _enrich_tarjeta(t: RepairCard, db: Session, include_image: bool = True) -> dict:
    """Enriquece una sola tarjeta (para endpoints de detalle)."""
    d = t.to_dict(include_image=include_image)
    tag_ids = db.execute(
        select(repair_card_tags.c.tag_id).where(repair_card_tags.c.repair_card_id == t.id)
    ).scalars().all()
    d["tags"] = [tg.to_dict() for tg in db.query(Tag).filter(Tag.id.in_(tag_ids)).all()] if tag_ids else []
    subtasks = db.query(SubTask).filter(SubTask.tarjeta_id == t.id).all()
    d["subtasks_total"] = len(subtasks)
    d["subtasks_done"] = sum(1 for s in subtasks if s.completed)
    d["comments_count"] = db.query(Comment).filter(Comment.tarjeta_id == t.id).count()
    media_rows = _media_rows_for_card(db, t.id)
    d["media_count"] = len(media_rows)
    d["cover_thumb_url"] = (
        _resolve_media_url(media_rows[0].thumb_url or media_rows[0].url, media_rows[0].storage_key)
        if media_rows else (t.image_url if include_image else None)
    )
    d["has_media"] = len(media_rows) > 0
    d["media_preview"] = [
        {
            "id": m.id,
            "url": _resolve_media_url(m.url, m.storage_key),
            "thumb_url": _resolve_media_url(m.thumb_url or m.url, m.storage_key),
            "position": m.position,
            "is_cover": m.is_cover,
        }
        for m in media_rows[:3]
    ]
    d["dias_en_columna"] = _calcular_dias_en_columna(t)
    return d


def _enrich_batch(items: list[RepairCard], db: Session, include_image: bool = True) -> list[dict]:
    """Enriquece múltiples tarjetas con queries batch O(1) en vez de O(N)."""
    if not items:
        return []

    card_ids = [t.id for t in items]
    cover_map, media_count_map = _media_cover_map(db, card_ids)
    legacy_http_cover_map: dict[int, str] = {}
    missing_cover_ids = [cid for cid in card_ids if cid not in cover_map]
    if missing_cover_ids:
        # Fallback only for legacy remote URLs. Do not load base64 payloads.
        legacy_rows = db.query(RepairCard.id, RepairCard.image_url).filter(
            RepairCard.id.in_(missing_cover_ids),
            RepairCard.image_url.isnot(None),
            or_(
                RepairCard.image_url.like("http://%"),
                RepairCard.image_url.like("https://%"),
            ),
        ).all()
        for rid, image_url in legacy_rows:
            if image_url:
                legacy_http_cover_map[rid] = image_url

    # Bulk tags
    tag_links = db.execute(
        select(repair_card_tags.c.repair_card_id, repair_card_tags.c.tag_id)
        .where(repair_card_tags.c.repair_card_id.in_(card_ids))
    ).all()
    tag_ids_needed = list({link.tag_id for link in tag_links})
    tags_by_id: dict[int, dict] = {}
    if tag_ids_needed:
        for tg in db.query(Tag).filter(Tag.id.in_(tag_ids_needed)).all():
            tags_by_id[tg.id] = tg.to_dict()
    card_tags: dict[int, list[dict]] = {cid: [] for cid in card_ids}
    for link in tag_links:
        if link.tag_id in tags_by_id:
            card_tags[link.repair_card_id].append(tags_by_id[link.tag_id])

    # Bulk subtask counts
    subtask_total: dict[int, int] = {}
    for row in db.query(SubTask.tarjeta_id, func.count(SubTask.id)).filter(
        SubTask.tarjeta_id.in_(card_ids)
    ).group_by(SubTask.tarjeta_id).all():
        subtask_total[row[0]] = row[1]

    subtask_done: dict[int, int] = {}
    for row in db.query(SubTask.tarjeta_id, func.count(SubTask.id)).filter(
        SubTask.tarjeta_id.in_(card_ids), SubTask.completed == True  # noqa: E712
    ).group_by(SubTask.tarjeta_id).all():
        subtask_done[row[0]] = row[1]

    # Bulk comment counts
    comment_counts: dict[int, int] = {}
    for row in db.query(Comment.tarjeta_id, func.count(Comment.id)).filter(
        Comment.tarjeta_id.in_(card_ids)
    ).group_by(Comment.tarjeta_id).all():
        comment_counts[row[0]] = row[1]

    result = []
    for t in items:
        d = t.to_dict(include_image=include_image)
        d["tags"] = card_tags.get(t.id, [])
        d["subtasks_total"] = subtask_total.get(t.id, 0)
        d["subtasks_done"] = subtask_done.get(t.id, 0)
        d["comments_count"] = comment_counts.get(t.id, 0)
        d["cover_thumb_url"] = cover_map.get(t.id) or legacy_http_cover_map.get(t.id) or (t.image_url if include_image else None)
        d["media_count"] = media_count_map.get(t.id, 0)
        d["dias_en_columna"] = _calcular_dias_en_columna(t)
        result.append(d)
    return result


def _serialize_board_items(items: list[RepairCard], db: Session, include_image: bool) -> list[dict]:
    """Serializa tarjetas para vista tablero optimizada (sin tocar image_url legacy)."""
    del include_image  # board nunca incluye image_url; thumbs vienen de repair_card_media
    if not items:
        return []

    card_ids = [t.id for t in items]
    cover_map, media_count_map = _media_cover_map(db, card_ids)

    tag_links = db.execute(
        select(repair_card_tags.c.repair_card_id, repair_card_tags.c.tag_id)
        .where(repair_card_tags.c.repair_card_id.in_(card_ids))
    ).all()
    tag_ids_needed = list({link.tag_id for link in tag_links})
    tags_by_id: dict[int, dict] = {}
    if tag_ids_needed:
        for tg in db.query(Tag).filter(Tag.id.in_(tag_ids_needed)).all():
            tags_by_id[tg.id] = tg.to_dict()
    card_tags: dict[int, list[dict]] = {cid: [] for cid in card_ids}
    for link in tag_links:
        if link.tag_id in tags_by_id:
            card_tags[link.repair_card_id].append(tags_by_id[link.tag_id])

    subtask_total: dict[int, int] = {}
    subtask_done: dict[int, int] = {}
    for row in db.query(
        SubTask.tarjeta_id,
        func.count(SubTask.id),
        func.sum(case((SubTask.completed == True, 1), else_=0)),  # noqa: E712
    ).filter(SubTask.tarjeta_id.in_(card_ids)).group_by(SubTask.tarjeta_id).all():
        subtask_total[row[0]] = int(row[1] or 0)
        subtask_done[row[0]] = int(row[2] or 0)

    comment_counts: dict[int, int] = {}
    for row in db.query(Comment.tarjeta_id, func.count(Comment.id)).filter(
        Comment.tarjeta_id.in_(card_ids)
    ).group_by(Comment.tarjeta_id).all():
        comment_counts[row[0]] = row[1]

    compact: list[dict] = []
    for t in items:
        problema = (t.problem or "").strip()
        notas = (t.technical_notes or "").strip()
        cover_thumb = cover_map.get(t.id)
        if isinstance(cover_thumb, str) and cover_thumb.startswith("data:"):
            cover_thumb = None
        compact.append({
            "id": t.id,
            "nombre_propietario": t.owner_name,
            "problema_resumen": (problema[:90] + "...") if len(problema) > 90 else problema,
            "columna": t.status,
            "prioridad": t.priority,
            "posicion": t.position,
            "asignado_nombre": t.assigned_name,
            "asignado_a": t.assigned_to,
            "whatsapp": t.whatsapp_number,
            "fecha_limite": t.due_date.strftime("%Y-%m-%d") if t.due_date else None,
            "tiene_cargador": t.has_charger,
            "notas_tecnicas_resumen": (notas[:120] + "...") if len(notas) > 120 else notas,
            "dias_en_columna": _calcular_dias_en_columna(t),
            "subtasks_total": subtask_total.get(t.id, 0),
            "subtasks_done": subtask_done.get(t.id, 0),
            "comments_count": comment_counts.get(t.id, 0),
            "bloqueada": t.blocked_at is not None,
            "motivo_bloqueo": t.blocked_reason,
            "tags": card_tags.get(t.id, []),
            "cover_thumb_url": cover_thumb,
            "media_count": media_count_map.get(t.id, 0),
            "imagen_url": cover_thumb,
        })
    return compact


def _decode_legacy_data_image(image_url: str) -> tuple[str, bytes]:
    if not image_url.startswith("data:image/"):
        raise ValueError("Formato legacy invalido")
    header, encoded = image_url.split(",", 1)
    mime = header.split(";", 1)[0].split(":", 1)[1].lower()
    if mime not in ALLOWED_MEDIA_MIME:
        raise ValueError(f"MIME no soportado: {mime}")
    try:
        raw = base64.b64decode(encoded, validate=True)
    except Exception:
        raw = base64.b64decode(encoded)
    if not raw:
        raise ValueError("Imagen vacia")
    if len(raw) > MAX_MEDIA_SIZE_BYTES:
        raise ValueError(f"Archivo excede {MAX_MEDIA_SIZE_BYTES // (1024 * 1024)}MB")
    return mime, raw


def _migrate_legacy_image_for_card(
    db: Session,
    card: RepairCard,
    storage,
) -> RepairCardMedia | None:
    if not card.image_url or not card.image_url.startswith("data:image/"):
        return None
    existing = db.query(RepairCardMedia).filter(
        RepairCardMedia.tarjeta_id == card.id,
        RepairCardMedia.deleted_at.is_(None),
    ).first()
    if existing:
        return None
    mime, raw = _decode_legacy_data_image(card.image_url)
    upload = storage.upload_bytes_required(raw, mime, ALLOWED_MEDIA_MIME[mime])
    item = RepairCardMedia(
        tarjeta_id=card.id,
        storage_key=upload.get("storage_key"),
        url=upload["url"],
        thumb_url=upload["url"],
        position=0,
        is_cover=True,
        mime_type=mime,
        size_bytes=len(raw),
    )
    db.add(item)
    card.image_url = upload["url"]
    db.flush()
    return item


def _parse_filter_date(value: str, field_name: str) -> datetime:
    try:
        return datetime.strptime(value, "%Y-%m-%d")
    except ValueError as err:
        raise HTTPException(status_code=400, detail=f"Fecha inválida en {field_name}") from err


def _repair_card_filter_clauses(
    *,
    include_deleted: bool,
    search: str | None,
    estado: str | None,
    prioridad: str | None,
    asignado_a: int | None,
    cargador: str | None,
    fecha_desde: str | None,
    fecha_hasta: str | None,
    tag: int | None,
) -> list:
    clauses = []
    if not include_deleted:
        clauses.append(RepairCard.deleted_at.is_(None))
    if search:
        search_term = f"%{search}%"
        clauses.append(or_(
            RepairCard.owner_name.ilike(search_term),
            RepairCard.problem.ilike(search_term),
            RepairCard.whatsapp_number.ilike(search_term),
            RepairCard.technical_notes.ilike(search_term),
        ))
    if estado:
        clauses.append(RepairCard.status == estado)
    if prioridad:
        clauses.append(RepairCard.priority == prioridad)
    if asignado_a is not None:
        clauses.append(RepairCard.assigned_to == asignado_a)
    if cargador:
        clauses.append(RepairCard.has_charger == cargador)
    if fecha_desde:
        clauses.append(RepairCard.start_date >= _parse_filter_date(fecha_desde, "fecha_desde"))
    if fecha_hasta:
        clauses.append(RepairCard.start_date <= _parse_filter_date(fecha_hasta, "fecha_hasta"))
    if tag is not None:
        clauses.append(
            exists(
                select(repair_card_tags.c.repair_card_id).where(
                    and_(
                        repair_card_tags.c.repair_card_id == RepairCard.id,
                        repair_card_tags.c.tag_id == tag,
                    )
                )
            )
        )
    return clauses


def _board_ranked_ids_subquery(filter_clauses: list):
    ranked = func.row_number().over(
        partition_by=RepairCard.status,
        order_by=(RepairCard.position.asc(), RepairCard.id.desc()),
    ).label("rn")
    stmt = select(RepairCard.id, ranked)
    if filter_clauses:
        stmt = stmt.where(*filter_clauses)
    return stmt.subquery()


def _fetch_board_bootstrap_ids(db: Session, filter_clauses: list, per_column: int) -> tuple[list[int], bool]:
    ranked = _board_ranked_ids_subquery(filter_clauses)
    bootstrap_ids = db.execute(
        select(ranked.c.id).where(ranked.c.rn <= per_column)
    ).scalars().all()
    has_remainder = db.execute(
        select(func.count()).select_from(ranked).where(ranked.c.rn > per_column)
    ).scalar() > 0
    return list(bootstrap_ids), has_remainder


def _fetch_board_remainder_ids(
    db: Session,
    filter_clauses: list,
    per_column: int,
    cursor_id: int | None,
    per_page: int,
) -> tuple[list[int], bool]:
    ranked = _board_ranked_ids_subquery(filter_clauses)
    stmt = select(ranked.c.id).where(ranked.c.rn > per_column)
    if cursor_id is not None:
        stmt = stmt.where(ranked.c.id > cursor_id)
    stmt = stmt.order_by(ranked.c.id.asc()).limit(per_page + 1)
    ids = db.execute(stmt).scalars().all()
    has_next = len(ids) > per_page
    return list(ids[:per_page]), has_next


def _load_board_cards(db: Session, card_ids: list[int]) -> list[RepairCard]:
    """Carga tarjetas del board en 1 query. Solo defer de image_url (base64 pesado).

    No usar load_only aquí: to_dict() lee start_date/costos/deleted_at y con
    columnas omitidas SQLAlchemy hace lazy-load N+1 (minutos en Postgres remoto).
    """
    if not card_ids:
        return []
    # Preservar orden del bootstrap (ids pueden venir desordenados por columna)
    rows = (
        db.query(RepairCard)
        .filter(RepairCard.id.in_(card_ids))
        .options(defer(RepairCard.image_url))
        .all()
    )
    by_id = {t.id: t for t in rows}
    return [by_id[i] for i in card_ids if i in by_id]


# ──────────────────────────────────────────────────────────────
# CRUD Endpoints
# ──────────────────────────────────────────────────────────────

@router.get("")
def get_tarjetas(
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
    page: int | None = Query(None),
    per_page: int | None = Query(None),
    light: int | None = Query(None),
    search: str | None = Query(None),
    estado: str | None = Query(None),
    prioridad: str | None = Query(None),
    asignado_a: int | None = Query(None),
    tag: int | None = Query(None),
    fecha_desde: str | None = Query(None),
    fecha_hasta: str | None = Query(None),
    cargador: str | None = Query(None),
    include_deleted: bool = Query(False),
    view: str | None = Query(None),
    mode: str | None = Query(None),
    cursor: str | None = Query(None),
    per_column: int | None = Query(None),
    include: str | None = Query(None),
    orden_por: str | None = Query(None),
    orden_dir: str | None = Query(None),
):
    include_image = light != 1
    board_mode = (view or "").lower() == "board"
    if board_mode and user is None:
        raise HTTPException(status_code=401, detail="Autenticación requerida para el tablero")
    include_opts = {opt.strip().lower() for opt in (include or "").split(",") if opt.strip()}
    if board_mode:
        include_image = "image_thumb" in include_opts or "image" in include_opts

    q = db.query(RepairCard)

    if not include_deleted:
        q = q.filter(RepairCard.deleted_at.is_(None))

    if not include_image:
        q = q.options(defer(RepairCard.image_url))

    if search:
        search_term = f"%{search}%"
        q = q.filter(or_(
            RepairCard.owner_name.ilike(search_term),
            RepairCard.problem.ilike(search_term),
            RepairCard.whatsapp_number.ilike(search_term),
            RepairCard.technical_notes.ilike(search_term),
        ))
    if estado:
        q = q.filter(RepairCard.status == estado)
    if prioridad:
        q = q.filter(RepairCard.priority == prioridad)
    if asignado_a is not None:
        q = q.filter(RepairCard.assigned_to == asignado_a)
    if cargador:
        q = q.filter(RepairCard.has_charger == cargador)
    if fecha_desde:
        q = q.filter(RepairCard.start_date >= _parse_filter_date(fecha_desde, "fecha_desde"))
    if fecha_hasta:
        q = q.filter(RepairCard.start_date <= _parse_filter_date(fecha_hasta, "fecha_hasta"))
    if tag is not None:
        q = q.filter(
            exists(
                select(repair_card_tags.c.repair_card_id).where(
                    and_(
                        repair_card_tags.c.repair_card_id == RepairCard.id,
                        repair_card_tags.c.tag_id == tag,
                    )
                )
            )
        )

    # Dynamic ordering
    _dir = desc if (orden_dir or "asc").lower() == "desc" else asc
    _priority_case = case(
        (RepairCard.priority == "alta", 1),
        (RepairCard.priority == "media", 2),
        else_=3,
    )
    if orden_por == "fecha_ingreso":
        q = q.order_by(_dir(RepairCard.ingresado_date))
    elif orden_por == "prioridad":
        q = q.order_by(_dir(_priority_case))
    elif orden_por == "nombre_cliente":
        q = q.order_by(_dir(RepairCard.owner_name))
    elif orden_por == "fecha_limite":
        q = q.order_by(_dir(RepairCard.due_date))
    elif orden_por == "posicion" or not orden_por:
        q = q.order_by(RepairCard.position.asc(), RepairCard.start_date.desc())
    else:
        q = q.order_by(RepairCard.position.asc(), RepairCard.start_date.desc())

    if board_mode:
        per_page = min(per_page or 120, 200)
        per_column_limit = min(max(per_column or 50, 1), 100)
        include_totals = "totals" in include_opts
        fast_mode = (mode or "").lower() == "fast"
        filter_clauses = _repair_card_filter_clauses(
            include_deleted=include_deleted,
            search=search,
            estado=estado,
            prioridad=prioridad,
            asignado_a=asignado_a,
            cargador=cargador,
            fecha_desde=fecha_desde,
            fecha_hasta=fecha_hasta,
            tag=tag,
        )

        if fast_mode:
            use_cursor = not orden_por or orden_por == "posicion"
            cursor_id: int | None = None
            if use_cursor and cursor:
                try:
                    cursor_id = int(cursor)
                except ValueError as err:
                    raise HTTPException(status_code=400, detail="Cursor invalido") from err

            if use_cursor and cursor_id is None:
                card_ids, has_remainder = _fetch_board_bootstrap_ids(db, filter_clauses, per_column_limit)
                items = _load_board_cards(db, card_ids)
                next_cursor = "0" if has_remainder else None
                col_totals = _column_totals_map(db, filter_clauses)
                data = {
                    "tarjetas": _serialize_board_items(items, db, include_image=False),
                    "pagination": {
                        "page": None,
                        "per_page": per_page,
                        "total": None,
                        "pages": None,
                        "has_next": has_remainder,
                        "has_prev": False,
                    },
                    "next_cursor": next_cursor,
                    "bootstrap": True,
                    "per_column": per_column_limit,
                    "column_totals": col_totals,
                    "view": "board",
                    "mode": "fast",
                }
                return JSONResponse(content=data, headers=CACHE_HEADERS)

            if use_cursor:
                remainder_ids, has_next = _fetch_board_remainder_ids(
                    db, filter_clauses, per_column_limit, cursor_id, per_page
                )
                items = _load_board_cards(db, remainder_ids)
                next_cursor = str(items[-1].id) if (has_next and items) else None
                col_totals = _column_totals_map(db, filter_clauses) if include_totals else None
                data = {
                    "tarjetas": _serialize_board_items(items, db, include_image=False),
                    "pagination": {
                        "page": None,
                        "per_page": per_page,
                        "total": None,
                        "pages": None,
                        "has_next": has_next,
                        "has_prev": cursor_id is not None,
                    },
                    "next_cursor": next_cursor,
                    "bootstrap": False,
                    "column_totals": col_totals,
                    "view": "board",
                    "mode": "fast",
                }
                return JSONResponse(content=data, headers=CACHE_HEADERS)

            # Custom sort: offset pagination without bootstrap
            fast_q = q.options(defer(RepairCard.image_url))
            page = page or 1
            page_items = fast_q.offset((page - 1) * per_page).limit(per_page + 1).all()
            has_next = len(page_items) > per_page
            items = page_items[:per_page]
            col_totals = _column_totals_map(db, filter_clauses) if include_totals else None
            data = {
                "tarjetas": _serialize_board_items(items, db, include_image=False),
                "pagination": {
                    "page": page,
                    "per_page": per_page,
                    "total": None,
                    "pages": None,
                    "has_next": has_next,
                    "has_prev": page > 1,
                },
                "column_totals": col_totals,
                "view": "board",
                "mode": "fast",
            }
            return JSONResponse(content=data, headers=CACHE_HEADERS)

        page = page or 1
        page_items = q.offset((page - 1) * per_page).limit(per_page + 1).all()
        has_next = len(page_items) > per_page
        items = page_items[:per_page]
        total = q.order_by(None).count() if include_totals else None
        pages = ((total + per_page - 1) // per_page) if (include_totals and total is not None) else None
        data = {
            "tarjetas": _serialize_board_items(items, db, include_image=include_image),
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "pages": pages,
                "has_next": has_next,
                "has_prev": page > 1,
            },
            "view": "board",
        }
        return JSONResponse(content=data, headers=CACHE_HEADERS)

    if page is None and per_page is None:
        items = q.limit(500).all()
        all_data = _enrich_batch(items, db, include_image=include_image)
        return JSONResponse(content=all_data, headers=CACHE_HEADERS)

    per_page = min(per_page or 50, 100)
    page = page or 1
    total = q.order_by(None).count()
    items = q.offset((page - 1) * per_page).limit(per_page).all()
    data = {
        "tarjetas": _enrich_batch(items, db, include_image=include_image),
        "pagination": {
            "page": page,
            "per_page": per_page,
            "total": total,
            "pages": (total + per_page - 1) // per_page if per_page else 0,
            "has_next": page * per_page < total,
            "has_prev": page > 1,
        },
    }
    return JSONResponse(content=data, headers=CACHE_HEADERS)


@router.get("/trash/list")
def get_trash(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    items = db.query(RepairCard).filter(RepairCard.deleted_at.isnot(None)).order_by(RepairCard.deleted_at.desc()).all()
    return [t.to_dict() for t in items]


@router.get("/{id}")
def get_tarjeta_by_id(id: int, db: Session = Depends(get_db)):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    # Use batch enrichment for consistent O(1) queries
    enriched = _enrich_batch([t], db, include_image=True)
    if enriched:
        result = enriched[0]
        # Expand media preview for detail view (up to 6 instead of board's 3)
        media_rows = _media_rows_for_card(db, t.id)
        result["media_preview"] = [
            {
                "id": m.id,
                "url": _resolve_media_url(m.url, m.storage_key),
                "thumb_url": _resolve_media_url(m.thumb_url or m.url, m.storage_key),
                "position": m.position,
                "is_cover": m.is_cover,
            }
            for m in media_rows[:6]
        ]
        return result
    return _enrich_tarjeta(t, db, include_image=True)


@router.post("", status_code=201)
@limiter.limit("10 per minute")
async def create_tarjeta(
    request: Request,
    data: TarjetaCreate,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    settings = get_settings()
    nombre = (data.nombre_propietario or "").strip() or "Cliente"
    problema = (data.problema or "").strip() or "Sin descripción"
    whatsapp = (data.whatsapp or "").strip() or ""
    fecha_limite = data.fecha_limite
    if not fecha_limite:
        due_dt = datetime.now(UTC) + timedelta(days=1)
    else:
        from datetime import time
        due_dt = datetime.combine(fecha_limite, time.min)

    # Legacy image field (compat) + optional media_v2 bootstrap
    imagen_url = data.imagen_url
    uploaded_media_bootstrap: dict | None = None
    if imagen_url and imagen_url.startswith("data:"):
        storage = get_storage_service()
        if settings.media_v2_read_write:
            uploaded_media_bootstrap = storage.upload_image_required(imagen_url)
            imagen_url = uploaded_media_bootstrap["url"]
        else:
            imagen_url = storage.upload_image(imagen_url)

    # Asignación de técnico
    assigned_name = None
    if data.asignado_a:
        tech = db.query(User).filter(User.id == data.asignado_a).first()
        assigned_name = tech.full_name if tech else None

    # Siguiente posición en la columna
    max_pos = db.query(func.max(RepairCard.position)).filter(
        RepairCard.status == "ingresado", RepairCard.deleted_at.is_(None)
    ).scalar() or 0

    t = RepairCard(
        owner_name=nombre,
        problem=problema,
        whatsapp_number=whatsapp,
        start_date=datetime.now(UTC),
        due_date=due_dt,
        status="ingresado",
        ingresado_date=datetime.now(UTC),
        image_url=imagen_url,
        has_charger=data.tiene_cargador or "si",
        priority=data.prioridad or "media",
        position=max_pos + 1,
        assigned_to=data.asignado_a,
        assigned_name=assigned_name,
        estimated_cost=data.costo_estimado,
    )
    db.add(t)
    try:
        db.commit()
        db.refresh(t)
    except IntegrityError as e:
        db.rollback()
        dialect = db.get_bind().dialect.name
        if dialect == "postgresql" and ("UniqueViolation" in str(e) or "duplicate" in str(e).lower()):
            try:
                db.execute(text(
                    "SELECT setval('repair_cards_id_seq', COALESCE((SELECT MAX(id) FROM repair_cards), 1), true);"
                ))
                db.commit()
                db.add(t)
                db.commit()
                db.refresh(t)
            except Exception as exc:
                db.rollback()
                raise HTTPException(status_code=500, detail="Error de secuencia de IDs") from exc
        else:
            raise HTTPException(status_code=500, detail="Error de integridad al crear tarjeta") from e

    if data.tags:
        for tag_id in data.tags:
            try:
                db.execute(insert(repair_card_tags).values(repair_card_id=t.id, tag_id=tag_id))
            except Exception:
                pass
        db.commit()

    if uploaded_media_bootstrap:
        db.add(RepairCardMedia(
            tarjeta_id=t.id,
            storage_key=uploaded_media_bootstrap.get("storage_key"),
            url=uploaded_media_bootstrap["url"],
            thumb_url=uploaded_media_bootstrap["url"],
            position=0,
            is_cover=True,
            mime_type="image/jpeg",
        ))
        db.commit()

    client_ip = get_client_ip(request)
    record_card_audit(
        db,
        tarjeta_id=t.id,
        action=ACTION_CREATED,
        old_status=None,
        new_status=t.status,
        client_ip=client_ip,
        user=user,
    )
    db.commit()

    invalidate_stats()

    result = _enrich_tarjeta(t, db)

    try:
        await sio.emit("tarjeta_creada", {"event_version": 1, "data": result})
    except Exception:
        pass
    return result


@router.put("/{id}")
async def update_tarjeta(
    id: int,
    request: Request,
    data: TarjetaUpdate,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")

    client_ip = get_client_ip(request)
    upd = data.model_dump(exclude_unset=True)
    changed_fields = [k for k in upd if k != "columna"]
    if "nombre_propietario" in upd:
        t.owner_name = upd["nombre_propietario"]
    if "problema" in upd:
        t.problem = upd["problema"]
    if "whatsapp" in upd:
        t.whatsapp_number = upd["whatsapp"]
    if "fecha_limite" in upd:
        t.due_date = datetime.strptime(upd["fecha_limite"], "%Y-%m-%d")
    if "imagen_url" in upd:
        new_img = upd["imagen_url"]
        if new_img and new_img.startswith("data:"):
            storage = get_storage_service()
            new_img = storage.upload_image(new_img)
        t.image_url = new_img or None
    if "tiene_cargador" in upd:
        t.has_charger = upd["tiene_cargador"]
    if "notas_tecnicas" in upd:
        t.technical_notes = upd["notas_tecnicas"] or None
    if "prioridad" in upd:
        t.priority = upd["prioridad"]
    if "posicion" in upd:
        t.position = upd["posicion"]
    if "asignado_a" in upd:
        t.assigned_to = upd["asignado_a"]
        if upd["asignado_a"]:
            tech = db.query(User).filter(User.id == upd["asignado_a"]).first()
            t.assigned_name = tech.full_name if tech else None
        else:
            t.assigned_name = None
    if "costo_estimado" in upd:
        t.estimated_cost = upd["costo_estimado"]
    if "costo_final" in upd:
        t.final_cost = upd["costo_final"]
    if "notas_costo" in upd:
        t.cost_notes = upd["notas_costo"]

    # Tags
    if "tags" in upd and upd["tags"] is not None:
        db.execute(delete(repair_card_tags).where(repair_card_tags.c.repair_card_id == t.id))
        for tag_id in upd["tags"]:
            try:
                db.execute(insert(repair_card_tags).values(repair_card_id=t.id, tag_id=tag_id))
            except Exception:
                pass

    # Cambio de estado
    if "columna" in upd:
        nuevo = upd["columna"]
        _move_card_status(db, t, nuevo, user, notify=True, client_ip=client_ip)

    if changed_fields:
        record_card_audit(
            db,
            tarjeta_id=t.id,
            action=ACTION_UPDATED,
            old_status=t.status,
            new_status=t.status,
            client_ip=client_ip,
            user=user,
            details=json.dumps(changed_fields, ensure_ascii=True),
        )

    db.commit()
    db.refresh(t)
    invalidate_stats()

    result = _enrich_tarjeta(t, db)
    try:
        await sio.emit("tarjeta_actualizada", {"event_version": 1, "data": result})
    except Exception:
        pass
    return result


# ──────────────────────────────────────────────────────────────
# Batch & Position Endpoints
# ──────────────────────────────────────────────────────────────

@router.put("/batch/positions")
@limiter.limit("60 per minute")
async def batch_update_positions(
    request: Request,
    data: BatchPosicionUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    import logging
    logger = logging.getLogger(__name__)

    try:
        item_ids = [item.id for item in data.items]
        lock_q = db.query(RepairCard).filter(RepairCard.id.in_(item_ids))
        try:
            locked_cards = lock_q.with_for_update().all()
        except Exception:
            locked_cards = lock_q.all()
        cards_by_id = {t.id: t for t in locked_cards}

        changed: list[dict] = []
        client_ip = get_client_ip(request)
        for item in data.items:
            t = cards_by_id.get(item.id)
            if not t:
                continue
            if t.status != item.columna:
                _move_card_status(db, t, item.columna, user, notify=True, client_ip=client_ip)
            elif t.position != item.posicion:
                record_card_audit(
                    db,
                    tarjeta_id=t.id,
                    action=ACTION_REORDERED,
                    old_status=t.status,
                    new_status=t.status,
                    client_ip=client_ip,
                    user=user,
                    details=json.dumps({"posicion": item.posicion}, ensure_ascii=True),
                )
            t.position = item.posicion
            changed.append({"id": t.id, "columna": t.status, "posicion": t.position})

        db.commit()
        invalidate_stats()
        try:
            await sio.emit("tarjetas_reordenadas", {"event_version": 1, "data": {"items": changed}})
        except Exception:
            pass
        return {"ok": True}
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        logger.exception("batch_update_positions failed: %s", exc)
        raise HTTPException(status_code=500, detail={
            "code": "batch_positions_error",
            "message": f"Error al actualizar posiciones: {type(exc).__name__}: {exc}",
        }) from exc


@router.post("/batch")
async def batch_operations(
    request: Request,
    data: BatchOperationRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Operaciones en lote sobre múltiples tarjetas."""
    cards = db.query(RepairCard).filter(RepairCard.id.in_(data.ids)).all()
    if not cards:
        raise HTTPException(status_code=404, detail="No cards found")

    client_ip = get_client_ip(request)
    updated = []
    for t in cards:
        if data.action == "move" and data.value:
            _move_card_status(
                db,
                t,
                data.value,
                user,
                notify=True,
                client_ip=client_ip,
            )
        elif data.action == "assign" and data.value is not None:
            t.assigned_to = int(data.value) if data.value else None
            t.assigned_name = data.assign_name or ""
            record_card_audit(
                db,
                tarjeta_id=t.id,
                action=ACTION_ASSIGNED,
                old_status=t.status,
                new_status=t.status,
                client_ip=client_ip,
                user=user,
                details=json.dumps({"asignado": data.assign_name or data.value}, ensure_ascii=True),
            )
        elif data.action == "priority" and data.value:
            t.priority = data.value
            record_card_audit(
                db,
                tarjeta_id=t.id,
                action=ACTION_PRIORITY_CHANGED,
                old_status=t.status,
                new_status=t.status,
                client_ip=client_ip,
                user=user,
                details=json.dumps({"prioridad": data.value}, ensure_ascii=True),
            )
        elif data.action == "delete":
            t.deleted_at = datetime.now(UTC)
            record_card_audit(
                db,
                tarjeta_id=t.id,
                action=ACTION_DELETED,
                old_status=t.status,
                new_status=t.status,
                client_ip=client_ip,
                user=user,
            )
        elif data.action == "tag" and data.value is not None:
            existing = db.execute(
                select(repair_card_tags.c.tag_id).where(
                    repair_card_tags.c.repair_card_id == t.id,
                    repair_card_tags.c.tag_id == int(data.value),
                )
            ).first()
            if not existing:
                db.execute(repair_card_tags.insert().values(
                    repair_card_id=t.id, tag_id=int(data.value),
                ))
                record_card_audit(
                    db,
                    tarjeta_id=t.id,
                    action=ACTION_TAG_ADDED,
                    old_status=t.status,
                    new_status=t.status,
                    client_ip=client_ip,
                    user=user,
                    details=json.dumps({"tag_id": int(data.value)}, ensure_ascii=True),
                )
        updated.append(t.id)

    db.commit()
    invalidate_stats()

    refreshed = db.query(RepairCard).filter(RepairCard.id.in_(updated)).all()
    result = _enrich_batch(refreshed, db)
    try:
        for r in result:
            await sio.emit("tarjeta_actualizada", {"event_version": 1, "data": r})
    except Exception:
        pass
    return {"ok": True, "updated": len(updated), "tarjetas": result}


# ──────────────────────────────────────────────────────────────
# Delete / Restore Endpoints
# ──────────────────────────────────────────────────────────────

@router.delete("/{id}", status_code=204)
async def delete_tarjeta(
    id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    client_ip = get_client_ip(request)
    t.deleted_at = datetime.now(UTC)
    record_card_audit(
        db,
        tarjeta_id=t.id,
        action=ACTION_DELETED,
        old_status=t.status,
        new_status=t.status,
        client_ip=client_ip,
        user=user,
    )
    db.commit()
    invalidate_stats()
    try:
        await sio.emit("tarjeta_eliminada", {"event_version": 1, "data": {"id": id}})
    except Exception:
        pass
    return None


@router.put("/{id}/restore")
async def restore_tarjeta(
    id: int,
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    client_ip = get_client_ip(request)
    t.deleted_at = None
    record_card_audit(
        db,
        tarjeta_id=t.id,
        action=ACTION_RESTORED,
        old_status=t.status,
        new_status=t.status,
        client_ip=client_ip,
        user=user,
    )
    db.commit()
    db.refresh(t)
    invalidate_stats()
    result = _enrich_tarjeta(t, db)
    try:
        await sio.emit("tarjeta_creada", {"event_version": 1, "data": result})
    except Exception:
        pass
    return result


@router.delete("/{id}/permanent", status_code=204)
async def permanent_delete_tarjeta(
    id: int,
    db: Session = Depends(get_db),
    admin: User = Depends(require_role("admin")),
):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    # Eliminar imagen de S3 si corresponde
    if t.image_url and t.image_url.startswith("http"):
        storage = get_storage_service()
        storage.delete_image(t.image_url)
    media_rows = db.query(RepairCardMedia).filter(RepairCardMedia.tarjeta_id == id).all()
    if media_rows:
        storage = get_storage_service()
        if storage.use_s3 and storage._client:
            for m in media_rows:
                if m.storage_key:
                    try:
                        storage._client.delete_object(Bucket=storage._bucket, Key=m.storage_key)
                    except Exception:
                        pass
    db.delete(t)
    db.commit()
    invalidate_stats()
    return None


# ──────────────────────────────────────────────────────────────
# Timeline & History
# ──────────────────────────────────────────────────────────────

@router.get("/{id}/historial")
def get_historial(id: int, db: Session = Depends(get_db)):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    hist = db.query(StatusHistory).filter(StatusHistory.tarjeta_id == id).order_by(StatusHistory.changed_at.desc()).all()
    return [h.to_dict() for h in hist]


@router.get("/{id}/timeline")
def get_timeline(
    id: int,
    db: Session = Depends(get_db),
    cursor: int = Query(0, ge=0),
    limit: int = Query(30, ge=1, le=100),
):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")

    status_events = db.query(StatusHistory).filter(
        StatusHistory.tarjeta_id == id
    ).order_by(StatusHistory.changed_at.desc()).all()
    comment_events = db.query(Comment).filter(
        Comment.tarjeta_id == id
    ).order_by(Comment.created_at.desc()).all()

    events: list[dict] = []
    for e in status_events:
        events.append(
            {
                "event_type": e.action or "status_changed",
                "event_at": e.changed_at.strftime("%Y-%m-%d %H:%M:%S") if e.changed_at else None,
                "event_id": f"status_{e.id}",
                "data": {
                    "action": e.action or "status_changed",
                    "old_status": e.old_status,
                    "new_status": e.new_status,
                    "changed_by": e.changed_by,
                    "changed_by_name": e.changed_by_name,
                    "client_ip": e.client_ip,
                    "details": e.details,
                },
            }
        )
    for c in comment_events:
        events.append(
            {
                "event_type": "comment_added",
                "event_at": c.created_at.strftime("%Y-%m-%d %H:%M:%S") if c.created_at else None,
                "event_id": f"comment_{c.id}",
                "data": {
                    "comment_id": c.id,
                    "author_name": c.author_name,
                    "content": c.content,
                    "user_id": c.user_id,
                },
            }
        )

    events.sort(key=lambda x: x["event_at"] or "", reverse=True)
    slice_ = events[cursor:cursor + limit]
    next_cursor = cursor + len(slice_)
    return {
        "events": slice_,
        "next_cursor": next_cursor if next_cursor < len(events) else None,
        "total": len(events),
    }


# ──────────────────────────────────────────────────────────────
# Media Endpoints
# ──────────────────────────────────────────────────────────────

@router.get("/{id}/media")
def get_tarjeta_media(id: int, db: Session = Depends(get_db)):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    media = _media_rows_for_card(db, id)
    if media:
        out: list[dict] = []
        for m in media:
            d = m.to_dict()
            d["url"] = _resolve_media_url(m.url, m.storage_key)
            d["thumb_url"] = _resolve_media_url(m.thumb_url or m.url, m.storage_key)
            out.append(d)
        return out
    if t.image_url and t.image_url.startswith("data:image/"):
        try:
            settings = get_settings()
            if settings.use_s3_storage:
                storage = get_storage_service()
                if storage.use_s3:
                    item = _migrate_legacy_image_for_card(db, t, storage)
                    if item is not None:
                        db.commit()
                        invalidate_stats()
                        return [item.to_dict()]
        except Exception:
            db.rollback()
    if t.image_url:
        return [{
            "id": 0,
            "tarjeta_id": id,
            "storage_key": None,
            "url": t.image_url,
            "thumb_url": t.image_url,
            "position": 0,
            "is_cover": True,
            "mime_type": None,
            "size_bytes": None,
            "created_at": None,
            "deleted_at": None,
        }]
    return []


@router.post("/media/migrate-legacy")
def migrate_legacy_media_to_r2(
    limit: int = Query(100, ge=1, le=1000),
    dry_run: bool = Query(False),
    only_card_id: int | None = Query(None),
    db: Session = Depends(get_db),
    admin: User = Depends(require_role("admin")),
):
    settings = get_settings()
    if not settings.use_s3_storage:
        raise HTTPException(status_code=400, detail="Storage remoto deshabilitado")
    storage = get_storage_service()
    if not storage.use_s3:
        raise HTTPException(status_code=503, detail="Storage remoto no disponible")

    q = db.query(RepairCard).filter(
        RepairCard.deleted_at.is_(None),
        RepairCard.image_url.isnot(None),
        RepairCard.image_url.like("data:image/%"),
    )
    if only_card_id is not None:
        q = q.filter(RepairCard.id == only_card_id)
    cards = q.order_by(RepairCard.id.asc()).limit(limit).all()

    migrated = 0
    skipped_has_media = 0
    failed = 0
    details: list[dict] = []

    for t in cards:
        has_media = db.query(RepairCardMedia.id).filter(
            RepairCardMedia.tarjeta_id == t.id,
            RepairCardMedia.deleted_at.is_(None),
        ).first()
        if has_media:
            skipped_has_media += 1
            details.append({"tarjeta_id": t.id, "status": "skipped_has_media"})
            continue

        try:
            if dry_run:
                mime, raw = _decode_legacy_data_image(t.image_url or "")
                details.append(
                    {
                        "tarjeta_id": t.id,
                        "status": "dry_run_ok",
                        "mime_type": mime,
                        "size_bytes": len(raw),
                    }
                )
                continue

            started = time.perf_counter()
            item = _migrate_legacy_image_for_card(db, t, storage)
            if item is None:
                skipped_has_media += 1
                details.append({"tarjeta_id": t.id, "status": "skipped"})
                continue
            elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
            db.commit()
            migrated += 1
            details.append(
                {
                    "tarjeta_id": t.id,
                    "status": "migrated",
                    "storage_key": item.storage_key,
                    "url": item.url,
                    "latency_ms": elapsed_ms,
                }
            )
        except Exception as err:
            db.rollback()
            failed += 1
            details.append({"tarjeta_id": t.id, "status": "failed", "error": str(err)})

    if migrated > 0:
        invalidate_stats()

    return {
        "ok": failed == 0,
        "requested_by": admin.username,
        "dry_run": dry_run,
        "processed": len(cards),
        "migrated": migrated,
        "skipped_has_media": skipped_has_media,
        "failed": failed,
        "details": details,
    }


@router.post("/{id}/media", status_code=201)
async def upload_tarjeta_media(
    id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    settings = get_settings()
    if not settings.media_v2_read_write:
        raise HTTPException(status_code=400, detail="Media v2 deshabilitado")
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    current = _media_rows_for_card(db, id)
    if len(current) + len(files) > MAX_MEDIA_PER_CARD:
        raise HTTPException(status_code=400, detail=f"Limite de {MAX_MEDIA_PER_CARD} fotos por tarjeta")

    storage = get_storage_service()
    if not storage.use_s3:
        raise HTTPException(status_code=503, detail="Storage remoto no disponible")

    next_pos = max([m.position for m in current], default=-1) + 1
    created: list[dict] = []
    for f in files:
        mime = (f.content_type or "").lower()
        if mime not in ALLOWED_MEDIA_MIME:
            raise HTTPException(status_code=400, detail=f"Formato no soportado: {mime}")
        file_data = await f.read()
        if len(file_data) > MAX_MEDIA_SIZE_BYTES:
            raise HTTPException(status_code=400, detail=f"Archivo excede {MAX_MEDIA_SIZE_BYTES // (1024 * 1024)}MB")
        started = time.perf_counter()
        upload = storage.upload_bytes_required(file_data, mime, ALLOWED_MEDIA_MIME[mime])
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        from loguru import logger
        logger.bind(
            storage="R2",
            bucket=storage._bucket,
            key=upload.get("storage_key"),
            tarjeta_id=id,
            user_id=user.id,
            mime_type=mime,
            size_bytes=len(file_data),
        ).info(f"media_upload_ok latency_ms={elapsed_ms}")
        item = RepairCardMedia(
            tarjeta_id=id,
            storage_key=upload.get("storage_key"),
            url=upload["url"],
            thumb_url=upload["url"],
            position=next_pos,
            is_cover=(len(current) == 0 and next_pos == 0),
            mime_type=mime,
            size_bytes=len(file_data),
        )
        db.add(item)
        db.flush()
        created.append(item.to_dict())
        next_pos += 1
    db.commit()
    invalidate_stats()
    return created


@router.put("/{id}/media/reorder")
def reorder_tarjeta_media(
    id: int,
    data: MediaReorderRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    by_id = {m.id: m for m in _media_rows_for_card(db, id)}
    for entry in data.items:
        m = by_id.get(entry.id)
        if m:
            m.position = entry.position
    db.commit()
    return {"ok": True}


@router.patch("/{id}/media/{media_id}")
def update_tarjeta_media(
    id: int,
    media_id: int,
    body: dict,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    m = db.query(RepairCardMedia).filter(
        RepairCardMedia.id == media_id,
        RepairCardMedia.tarjeta_id == id,
        RepairCardMedia.deleted_at.is_(None),
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail="Media no encontrada")
    if body.get("is_cover") is True:
        db.query(RepairCardMedia).filter(
            RepairCardMedia.tarjeta_id == id,
            RepairCardMedia.deleted_at.is_(None),
        ).update({"is_cover": False}, synchronize_session=False)
        m.is_cover = True
        t.image_url = m.url
    db.commit()
    return m.to_dict()


@router.delete("/{id}/media/{media_id}", status_code=204)
def delete_tarjeta_media(
    id: int,
    media_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    m = db.query(RepairCardMedia).filter(
        RepairCardMedia.id == media_id,
        RepairCardMedia.tarjeta_id == id,
        RepairCardMedia.deleted_at.is_(None),
    ).first()
    if not m:
        raise HTTPException(status_code=404, detail="Media no encontrada")
    m.deleted_at = datetime.now(UTC)
    if m.storage_key:
        storage = get_storage_service()
        if storage.use_s3 and storage._client:
            try:
                storage._client.delete_object(Bucket=storage._bucket, Key=m.storage_key)
            except Exception:
                pass

    active = _media_rows_for_card(db, id)
    if active and all(not it.is_cover for it in active):
        active[0].is_cover = True
        t.image_url = active[0].url
    elif not active:
        t.image_url = None
    db.commit()
    return None


# ──────────────────────────────────────────────────────────────
# Block / Unblock
# ──────────────────────────────────────────────────────────────

@router.patch("/{id}/block")
async def block_tarjeta(
    id: int,
    request: Request,
    data: BlockRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Bloquear o desbloquear una tarjeta."""
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")

    client_ip = get_client_ip(request)
    if data.blocked:
        t.blocked_at = datetime.now(UTC)
        t.blocked_reason = data.reason or ""
        t.blocked_by = data.user_id or user.id
        record_card_audit(
            db,
            tarjeta_id=t.id,
            action=ACTION_BLOCKED,
            old_status=t.status,
            new_status=t.status,
            client_ip=client_ip,
            user=user,
            details=data.reason or None,
        )
    else:
        t.blocked_at = None
        t.blocked_reason = None
        t.blocked_by = None
        record_card_audit(
            db,
            tarjeta_id=t.id,
            action=ACTION_UNBLOCKED,
            old_status=t.status,
            new_status=t.status,
            client_ip=client_ip,
            user=user,
        )

    db.commit()
    db.refresh(t)
    result = _enrich_tarjeta(t, db)
    try:
        await sio.emit("tarjeta_actualizada", {"event_version": 1, "data": result})
    except Exception:
        pass
    return result
