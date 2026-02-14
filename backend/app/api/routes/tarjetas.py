"""Rutas CRUD de tarjetas de reparación con todas las mejoras.

Mejoras integradas: #4 prioridad, #5 posición, #7 asignación, #9 notificaciones,
#11 costos, #13 búsqueda server-side, #22 S3 storage, #23 soft delete, #28 SQLite compat.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, defer
from sqlalchemy import func, text, or_, exists, and_, select
from sqlalchemy.exc import IntegrityError

from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.core.cache import invalidate_stats
from app.models.repair_card import RepairCard, StatusHistory, RepairCardMedia
from app.models.kanban import SubTask, Comment, Tag, repair_card_tags, KanbanColumn
from app.models.user import User
from app.schemas.tarjeta import TarjetaCreate, TarjetaUpdate, BatchPosicionUpdate
from app.socket_events import sio
from app.services.auth_service import get_current_user_optional
from app.services.notification_service import notificar_cambio_estado
from app.services.storage_service import get_storage_service

router = APIRouter(prefix="/api/tarjetas", tags=["tarjetas"])

CACHE_HEADERS = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}
MAX_MEDIA_PER_CARD = 10
MAX_MEDIA_SIZE_BYTES = 8 * 1024 * 1024
ALLOWED_MEDIA_MIME = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def _get_valid_statuses(db: Session) -> list[str]:
    """Obtiene estados válidos de las columnas configuradas (Mejora #2)."""
    cols = db.query(KanbanColumn.key).order_by(KanbanColumn.position).all()
    if cols:
        return [c[0] for c in cols]
    return ["ingresado", "diagnosticada", "para_entregar", "listos"]


def _media_rows_for_card(db: Session, tarjeta_id: int) -> list[RepairCardMedia]:
    return db.query(RepairCardMedia).filter(
        RepairCardMedia.tarjeta_id == tarjeta_id,
        RepairCardMedia.deleted_at.is_(None),
    ).order_by(RepairCardMedia.position.asc(), RepairCardMedia.id.asc()).all()


def _media_cover_map(db: Session, card_ids: list[int]) -> tuple[dict[int, str | None], dict[int, int]]:
    if not card_ids:
        return {}, {}
    rows = db.query(RepairCardMedia).filter(
        RepairCardMedia.tarjeta_id.in_(card_ids),
        RepairCardMedia.deleted_at.is_(None),
    ).order_by(
        RepairCardMedia.tarjeta_id.asc(),
        RepairCardMedia.is_cover.desc(),
        RepairCardMedia.position.asc(),
        RepairCardMedia.id.asc(),
    ).all()
    cover_map: dict[int, str | None] = {}
    count_map: dict[int, int] = {}
    for row in rows:
        count_map[row.tarjeta_id] = count_map.get(row.tarjeta_id, 0) + 1
        if row.tarjeta_id not in cover_map:
            cover_map[row.tarjeta_id] = row.thumb_url or row.url
    return cover_map, count_map


def _enrich_tarjeta(t: RepairCard, db: Session, include_image: bool = True) -> dict:
    """Enriquece una sola tarjeta (para endpoints de detalle)."""
    d = t.to_dict(include_image=include_image)
    from sqlalchemy import select
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
    d["cover_thumb_url"] = (media_rows[0].thumb_url or media_rows[0].url) if media_rows else (t.image_url if include_image else None)
    d["has_media"] = len(media_rows) > 0
    d["media_preview"] = [
        {
            "id": m.id,
            "url": m.url,
            "thumb_url": m.thumb_url or m.url,
            "position": m.position,
            "is_cover": m.is_cover,
        }
        for m in media_rows[:3]
    ]
    now = datetime.utcnow()
    try:
        if t.status == "ingresado" and t.ingresado_date:
            d["dias_en_columna"] = (now - t.ingresado_date).days
        elif t.status == "diagnosticada" and t.diagnosticada_date:
            d["dias_en_columna"] = (now - t.diagnosticada_date).days
        elif t.status == "para_entregar" and t.para_entregar_date:
            d["dias_en_columna"] = (now - t.para_entregar_date).days
        elif t.status == "listos" and t.entregados_date:
            d["dias_en_columna"] = (now - t.entregados_date).days
        else:
            d["dias_en_columna"] = 0
    except Exception:
        d["dias_en_columna"] = 0
    return d


def _enrich_batch(items: list[RepairCard], db: Session, include_image: bool = True) -> list[dict]:
    """Enriquece múltiples tarjetas con solo 3 queries totales (batch).

    Antes: 3 queries × N tarjetas = O(N) queries.
    Ahora: 3 queries totales sin importar N.
    """
    if not items:
        return []

    from sqlalchemy import select
    card_ids = [t.id for t in items]
    cover_map, media_count_map = _media_cover_map(db, card_ids)

    # --- 1. Bulk tags (2 queries: links + tag objects) ---
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

    # --- 2. Bulk subtask counts (2 queries: total + done) ---
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

    # --- 3. Bulk comment counts (1 query) ---
    comment_counts: dict[int, int] = {}
    for row in db.query(Comment.tarjeta_id, func.count(Comment.id)).filter(
        Comment.tarjeta_id.in_(card_ids)
    ).group_by(Comment.tarjeta_id).all():
        comment_counts[row[0]] = row[1]

    # --- Build enriched dicts ---
    now = datetime.utcnow()
    result = []
    for t in items:
        d = t.to_dict(include_image=include_image)
        d["tags"] = card_tags.get(t.id, [])
        d["subtasks_total"] = subtask_total.get(t.id, 0)
        d["subtasks_done"] = subtask_done.get(t.id, 0)
        d["comments_count"] = comment_counts.get(t.id, 0)
        d["cover_thumb_url"] = cover_map.get(t.id) or (t.image_url if include_image else None)
        d["media_count"] = media_count_map.get(t.id, 0)
        try:
            if t.status == "ingresado" and t.ingresado_date:
                d["dias_en_columna"] = (now - t.ingresado_date).days
            elif t.status == "diagnosticada" and t.diagnosticada_date:
                d["dias_en_columna"] = (now - t.diagnosticada_date).days
            elif t.status == "para_entregar" and t.para_entregar_date:
                d["dias_en_columna"] = (now - t.para_entregar_date).days
            elif t.status == "listos" and t.entregados_date:
                d["dias_en_columna"] = (now - t.entregados_date).days
            else:
                d["dias_en_columna"] = 0
        except Exception:
            d["dias_en_columna"] = 0
        result.append(d)
    return result


def _serialize_board_items(items: list[RepairCard], db: Session, include_image: bool) -> list[dict]:
    """Serializa tarjetas para vista tablero optimizada."""
    data = _enrich_batch(items, db, include_image=include_image)
    compact: list[dict] = []
    for item in data:
        problema = (item.get("problema") or "").strip()
        compact.append({
            "id": item.get("id"),
            "nombre_propietario": item.get("nombre_propietario"),
            "problema_resumen": (problema[:90] + "...") if len(problema) > 90 else problema,
            "columna": item.get("columna"),
            "prioridad": item.get("prioridad"),
            "posicion": item.get("posicion"),
            "asignado_nombre": item.get("asignado_nombre"),
            "asignado_a": item.get("asignado_a"),
            "whatsapp": item.get("whatsapp"),
            "fecha_limite": item.get("fecha_limite"),
            "tiene_cargador": item.get("tiene_cargador"),
            "notas_tecnicas": item.get("notas_tecnicas"),
            "costo_estimado": item.get("costo_estimado"),
            "dias_en_columna": item.get("dias_en_columna", 0),
            "subtasks_total": item.get("subtasks_total", 0),
            "subtasks_done": item.get("subtasks_done", 0),
            "comments_count": item.get("comments_count", 0),
            "bloqueada": item.get("bloqueada"),
            "motivo_bloqueo": item.get("motivo_bloqueo"),
            "tags": item.get("tags", []),
            "cover_thumb_url": item.get("cover_thumb_url"),
            "media_count": item.get("media_count", 0),
            # Compatibilidad temporal
            "imagen_url": item.get("cover_thumb_url") or item.get("imagen_url"),
        })
    return compact


@router.get("")
def get_tarjetas(
    db: Session = Depends(get_db),
    page: int | None = Query(None),
    per_page: int | None = Query(None),
    light: int | None = Query(None),
    # Mejora #13: Búsqueda server-side
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
    include: str | None = Query(None),
):
    include_image = light != 1
    board_mode = (view or "").lower() == "board"
    include_opts = {opt.strip().lower() for opt in (include or "").split(",") if opt.strip()}
    if board_mode:
        include_image = "image_thumb" in include_opts or "image" in include_opts

    q = db.query(RepairCard)

    # Mejora #23: Soft delete — excluir eliminadas por defecto
    if not include_deleted:
        q = q.filter(RepairCard.deleted_at.is_(None))

    if not include_image:
        q = q.options(defer(RepairCard.image_url))

    # Mejora #13: Filtros server-side
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
        q = q.filter(RepairCard.start_date >= datetime.strptime(fecha_desde, "%Y-%m-%d"))
    if fecha_hasta:
        q = q.filter(RepairCard.start_date <= datetime.strptime(fecha_hasta, "%Y-%m-%d"))
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

    # Mejora #5: Ordenar por posición dentro de cada estado, luego por prioridad
    q = q.order_by(RepairCard.position.asc(), RepairCard.start_date.desc())

    if board_mode:
        per_page = min(per_page or 200, 500)
        page = page or 1
        total = q.order_by(None).count()
        items = q.offset((page - 1) * per_page).limit(per_page).all()
        data = {
            "tarjetas": _serialize_board_items(items, db, include_image=include_image),
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "pages": (total + per_page - 1) // per_page if per_page else 0,
                "has_next": page * per_page < total,
                "has_prev": page > 1,
            },
            "view": "board",
        }
        return JSONResponse(content=data, headers=CACHE_HEADERS)

    try:
        if page is None and per_page is None:
            items = q.all()
            data = _enrich_batch(items, db, include_image=include_image)
            return JSONResponse(content=data, headers=CACHE_HEADERS)
    except Exception as e:
        from loguru import logger
        logger.error(f"Error in GET /api/tarjetas: {e}")
        raise HTTPException(status_code=500, detail=str(e))

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


@router.get("/{id}")
def get_tarjeta_by_id(id: int, db: Session = Depends(get_db)):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    return _enrich_tarjeta(t, db, include_image=True)


@router.post("", status_code=201)
@limiter.limit("10 per minute")
async def create_tarjeta(
    request: Request,
    data: TarjetaCreate,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    settings = get_settings()
    nombre = (data.nombre_propietario or "").strip() or "Cliente"
    problema = (data.problema or "").strip() or "Sin descripción"
    whatsapp = (data.whatsapp or "").strip() or ""
    fecha_limite = data.fecha_limite
    if not fecha_limite:
        due_dt = datetime.now(timezone.utc) + timedelta(days=1)
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

    # Mejora #7: Asignación de técnico
    assigned_name = None
    if data.asignado_a:
        tech = db.query(User).filter(User.id == data.asignado_a).first()
        assigned_name = tech.full_name if tech else None

    # Mejora #5: Siguiente posición en la columna
    max_pos = db.query(func.max(RepairCard.position)).filter(
        RepairCard.status == "ingresado", RepairCard.deleted_at.is_(None)
    ).scalar() or 0

    t = RepairCard(
        owner_name=nombre,
        problem=problema,
        whatsapp_number=whatsapp,
        start_date=datetime.now(timezone.utc),
        due_date=due_dt,
        status="ingresado",
        ingresado_date=datetime.now(timezone.utc),
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
            except Exception:
                db.rollback()
                raise HTTPException(status_code=500, detail="Error de secuencia de IDs")
        else:
            raise HTTPException(status_code=500, detail="Error de integridad al crear tarjeta")

    # Mejora #10: Asignar tags
    if data.tags:
        from sqlalchemy import insert
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
    data: TarjetaUpdate,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")

    upd = data.model_dump(exclude_unset=True)
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

    # Mejora #4: Prioridad
    if "prioridad" in upd:
        t.priority = upd["prioridad"]

    # Mejora #5: Posición
    if "posicion" in upd:
        t.position = upd["posicion"]

    # Mejora #7: Asignación
    if "asignado_a" in upd:
        t.assigned_to = upd["asignado_a"]
        if upd["asignado_a"]:
            tech = db.query(User).filter(User.id == upd["asignado_a"]).first()
            t.assigned_name = tech.full_name if tech else None
        else:
            t.assigned_name = None

    # Mejora #11: Costos
    if "costo_estimado" in upd:
        t.estimated_cost = upd["costo_estimado"]
    if "costo_final" in upd:
        t.final_cost = upd["costo_final"]
    if "notas_costo" in upd:
        t.cost_notes = upd["notas_costo"]

    # Mejora #10: Tags
    if "tags" in upd and upd["tags"] is not None:
        from sqlalchemy import insert, delete
        db.execute(delete(repair_card_tags).where(repair_card_tags.c.repair_card_id == t.id))
        for tag_id in upd["tags"]:
            try:
                db.execute(insert(repair_card_tags).values(repair_card_id=t.id, tag_id=tag_id))
            except Exception:
                pass

    # Cambio de estado
    if "columna" in upd:
        nuevo = upd["columna"]
        valid_statuses = _get_valid_statuses(db)
        if nuevo not in valid_statuses:
            raise HTTPException(status_code=400, detail=f"Estado no válido. Permitidos: {valid_statuses}")

        # Mejora #12: WIP Limit check
        col = db.query(KanbanColumn).filter(KanbanColumn.key == nuevo).first()
        if col and col.wip_limit:
            current_count = db.query(RepairCard).filter(
                RepairCard.status == nuevo, RepairCard.deleted_at.is_(None), RepairCard.id != id
            ).count()
            if current_count >= col.wip_limit:
                raise HTTPException(
                    status_code=400,
                    detail=f"Límite WIP alcanzado en '{col.title}' ({col.wip_limit} máximo)"
                )

        old_status = t.status
        if old_status != nuevo:
            db.add(StatusHistory(
                tarjeta_id=t.id,
                old_status=old_status,
                new_status=nuevo,
                changed_at=datetime.now(timezone.utc),
                changed_by=user.id if user else None,
                changed_by_name=user.full_name if user else None,
            ))
            # Mejora #9: Notificaciones
            notificar_cambio_estado(db, t, old_status, nuevo)

        t.status = nuevo
        if nuevo == "diagnosticada" and not t.diagnosticada_date:
            t.diagnosticada_date = datetime.now(timezone.utc)
        elif nuevo == "para_entregar" and not t.para_entregar_date:
            t.para_entregar_date = datetime.now(timezone.utc)
        elif nuevo == "listos" and not t.entregados_date:
            t.entregados_date = datetime.now(timezone.utc)

    db.commit()
    db.refresh(t)
    invalidate_stats()

    result = _enrich_tarjeta(t, db)
    try:
        await sio.emit("tarjeta_actualizada", {"event_version": 1, "data": result})
    except Exception:
        pass
    return result


# Mejora #1, #5: Batch position update para Drag & Drop
@router.put("/batch/positions")
async def batch_update_positions(data: BatchPosicionUpdate, db: Session = Depends(get_db)):
    changed: list[dict] = []
    for item in data.items:
        t = db.query(RepairCard).filter(RepairCard.id == item.id).first()
        if t:
            old_status = t.status
            t.position = item.posicion
            if t.status != item.columna:
                # Verificar WIP limit
                col = db.query(KanbanColumn).filter(KanbanColumn.key == item.columna).first()
                if col and col.wip_limit:
                    current_count = db.query(RepairCard).filter(
                        RepairCard.status == item.columna,
                        RepairCard.deleted_at.is_(None),
                        RepairCard.id != item.id,
                    ).count()
                    if current_count >= col.wip_limit:
                        raise HTTPException(
                            status_code=400,
                            detail=f"Límite WIP alcanzado en '{col.title}'"
                        )

                db.add(StatusHistory(
                    tarjeta_id=t.id, old_status=old_status, new_status=item.columna,
                    changed_at=datetime.now(timezone.utc),
                ))
                t.status = item.columna
                if item.columna == "diagnosticada" and not t.diagnosticada_date:
                    t.diagnosticada_date = datetime.now(timezone.utc)
                elif item.columna == "para_entregar" and not t.para_entregar_date:
                    t.para_entregar_date = datetime.now(timezone.utc)
                elif item.columna == "listos" and not t.entregados_date:
                    t.entregados_date = datetime.now(timezone.utc)
            changed.append({"id": t.id, "columna": t.status, "posicion": t.position})

    db.commit()
    invalidate_stats()
    try:
        await sio.emit("tarjetas_reordenadas", {"event_version": 1, "data": {"items": changed}})
    except Exception:
        pass
    return {"ok": True}


# Mejora #23: Soft delete
@router.delete("/{id}", status_code=204)
async def delete_tarjeta(id: int, db: Session = Depends(get_db)):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    t.deleted_at = datetime.now(timezone.utc)
    db.commit()
    invalidate_stats()
    try:
        await sio.emit("tarjeta_eliminada", {"event_version": 1, "data": {"id": id}})
    except Exception:
        pass
    return None


# Mejora #23: Restaurar tarjeta eliminada
@router.put("/{id}/restore")
async def restore_tarjeta(id: int, db: Session = Depends(get_db)):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    t.deleted_at = None
    db.commit()
    db.refresh(t)
    invalidate_stats()
    result = _enrich_tarjeta(t, db)
    try:
        await sio.emit("tarjeta_creada", {"event_version": 1, "data": result})
    except Exception:
        pass
    return result


# Mejora #23: Eliminar permanentemente
@router.delete("/{id}/permanent", status_code=204)
async def permanent_delete_tarjeta(id: int, db: Session = Depends(get_db)):
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


# Mejora #23: Listar tarjetas eliminadas (papelera)
@router.get("/trash/list")
def get_trash(db: Session = Depends(get_db)):
    items = db.query(RepairCard).filter(RepairCard.deleted_at.isnot(None)).order_by(RepairCard.deleted_at.desc()).all()
    return [t.to_dict() for t in items]


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
                "event_type": "status_changed",
                "event_at": e.changed_at.strftime("%Y-%m-%d %H:%M:%S") if e.changed_at else None,
                "event_id": f"status_{e.id}",
                "data": {
                    "old_status": e.old_status,
                    "new_status": e.new_status,
                    "changed_by": e.changed_by,
                    "changed_by_name": e.changed_by_name,
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


@router.get("/{id}/media")
def get_tarjeta_media(id: int, db: Session = Depends(get_db)):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    media = _media_rows_for_card(db, id)
    if media:
        return [m.to_dict() for m in media]
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


@router.post("/{id}/media", status_code=201)
async def upload_tarjeta_media(
    id: int,
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
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
        data = await f.read()
        if len(data) > MAX_MEDIA_SIZE_BYTES:
            raise HTTPException(status_code=400, detail=f"Archivo excede {MAX_MEDIA_SIZE_BYTES // (1024 * 1024)}MB")
        upload = storage.upload_bytes_required(data, mime, ALLOWED_MEDIA_MIME[mime])
        item = RepairCardMedia(
            tarjeta_id=id,
            storage_key=upload.get("storage_key"),
            url=upload["url"],
            thumb_url=upload["url"],
            position=next_pos,
            is_cover=(len(current) == 0 and next_pos == 0),
            mime_type=mime,
            size_bytes=len(data),
        )
        db.add(item)
        db.flush()
        created.append(item.to_dict())
        next_pos += 1
    db.commit()
    invalidate_stats()
    return created


@router.put("/{id}/media/reorder")
def reorder_tarjeta_media(id: int, items: list[dict], db: Session = Depends(get_db)):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    by_id = {m.id: m for m in _media_rows_for_card(db, id)}
    for entry in items:
        media_id = int(entry.get("id"))
        pos = int(entry.get("position"))
        m = by_id.get(media_id)
        if m:
            m.position = pos
    db.commit()
    return {"ok": True}


@router.patch("/{id}/media/{media_id}")
def update_tarjeta_media(id: int, media_id: int, body: dict, db: Session = Depends(get_db)):
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
def delete_tarjeta_media(id: int, media_id: int, db: Session = Depends(get_db)):
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
    m.deleted_at = datetime.now(timezone.utc)
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


# --- Blocked cards ---
@router.patch("/{id}/block")
async def block_tarjeta(id: int, body: dict, db: Session = Depends(get_db)):
    """Bloquear o desbloquear una tarjeta."""
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")

    blocked = body.get("blocked", True)
    if blocked:
        t.blocked_at = datetime.utcnow()
        t.blocked_reason = body.get("reason", "")
        t.blocked_by = body.get("user_id")
    else:
        t.blocked_at = None
        t.blocked_reason = None
        t.blocked_by = None

    db.commit()
    db.refresh(t)
    result = _enrich_tarjeta(t, db)
    try:
        await sio.emit("tarjeta_actualizada", {"event_version": 1, "data": result})
    except Exception:
        pass
    return result


# --- Batch operations ---
@router.post("/batch")
async def batch_operations(body: dict, db: Session = Depends(get_db)):
    """Operaciones en lote sobre múltiples tarjetas.

    body: { ids: [1,2,3], action: "move"|"assign"|"tag"|"priority"|"delete",
            value: "diagnosticada" | user_id | tag_id | "alta" }
    """
    ids = body.get("ids", [])
    action = body.get("action")
    value = body.get("value")

    if not ids or not action:
        raise HTTPException(status_code=400, detail="ids and action required")

    cards = db.query(RepairCard).filter(RepairCard.id.in_(ids)).all()
    if not cards:
        raise HTTPException(status_code=404, detail="No cards found")

    updated = []
    for t in cards:
        if action == "move" and value:
            old_status = t.status
            t.status = value
            if value == "diagnosticada" and not t.diagnosticada_date:
                t.diagnosticada_date = datetime.utcnow()
            elif value == "para_entregar" and not t.para_entregar_date:
                t.para_entregar_date = datetime.utcnow()
            elif value == "listos" and not t.entregados_date:
                t.entregados_date = datetime.utcnow()
            db.add(StatusHistory(
                tarjeta_id=t.id, old_status=old_status, new_status=value,
                changed_by_name=body.get("user_name", "Batch"),
            ))
        elif action == "assign" and value is not None:
            t.assigned_to = int(value) if value else None
            t.assigned_name = body.get("assign_name", "")
        elif action == "priority" and value:
            t.priority = value
        elif action == "delete":
            t.deleted_at = datetime.utcnow()
        elif action == "tag" and value is not None:
            from sqlalchemy import select
            existing = db.execute(
                select(repair_card_tags.c.tag_id).where(
                    repair_card_tags.c.repair_card_id == t.id,
                    repair_card_tags.c.tag_id == int(value),
                )
            ).first()
            if not existing:
                db.execute(repair_card_tags.insert().values(
                    repair_card_id=t.id, tag_id=int(value),
                ))
        updated.append(t.id)

    db.commit()
    invalidate_stats()

    # Return updated cards
    refreshed = db.query(RepairCard).filter(RepairCard.id.in_(updated)).all()
    result = _enrich_batch(refreshed, db)
    try:
        for r in result:
            await sio.emit("tarjeta_actualizada", {"event_version": 1, "data": r})
    except Exception:
        pass
    return {"ok": True, "updated": len(updated), "tarjetas": result}

