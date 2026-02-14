"""Rutas CRUD de tarjetas de reparación con todas las mejoras.

Mejoras integradas: #4 prioridad, #5 posición, #7 asignación, #9 notificaciones,
#11 costos, #13 búsqueda server-side, #22 S3 storage, #23 soft delete, #28 SQLite compat.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session, defer
from sqlalchemy import func, text, or_
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.core.limiter import limiter
from app.core.cache import invalidate_stats
from app.models.repair_card import RepairCard, StatusHistory
from app.models.kanban import SubTask, Comment, Tag, repair_card_tags, KanbanColumn
from app.models.user import User
from app.schemas.tarjeta import TarjetaCreate, TarjetaUpdate, BatchPosicionUpdate
from app.socket_events import sio
from app.services.auth_service import get_current_user_optional
from app.services.notification_service import notificar_cambio_estado
from app.services.storage_service import get_storage_service

router = APIRouter(prefix="/api/tarjetas", tags=["tarjetas"])

CACHE_HEADERS = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}


def _get_valid_statuses(db: Session) -> list[str]:
    """Obtiene estados válidos de las columnas configuradas (Mejora #2)."""
    cols = db.query(KanbanColumn.key).order_by(KanbanColumn.position).all()
    if cols:
        return [c[0] for c in cols]
    return ["ingresado", "diagnosticada", "para_entregar", "listos"]




def _socket_tarjeta_payload(t: RepairCard) -> dict:
    """Payload mínimo y consistente para eventos Socket.IO de tarjeta."""
    return {
        "id": t.id,
        "columna": t.status,
        "posicion": t.position,
        "nombre_propietario": t.owner_name,
        "problema": t.problem,
        "prioridad": t.priority,
        "asignado_a": t.assigned_to,
        "asignado_nombre": t.assigned_name,
        "fecha_limite": t.due_date.strftime("%Y-%m-%d") if t.due_date else None,
        "tiene_cargador": t.has_charger,
        "notas_tecnicas": t.technical_notes,
        "imagen_url": t.image_url,
        "costo_estimado": t.estimated_cost,
        "costo_final": t.final_cost,
        "notas_costo": t.cost_notes,
        "eliminado": t.deleted_at is not None,
    }

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
):
    include_image = light != 1
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
        from sqlalchemy import select
        card_ids = db.execute(
            select(repair_card_tags.c.repair_card_id).where(repair_card_tags.c.tag_id == tag)
        ).scalars().all()
        q = q.filter(RepairCard.id.in_(card_ids)) if card_ids else q.filter(RepairCard.id == -1)

    # Mejora #5: Ordenar por posición dentro de cada estado, luego por prioridad
    q = q.order_by(RepairCard.position.asc(), RepairCard.start_date.desc())

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
    total = q.count()
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


@router.post("", status_code=201)
@limiter.limit("10 per minute")
async def create_tarjeta(
    request: Request,
    data: TarjetaCreate,
    db: Session = Depends(get_db),
    user: Optional[User] = Depends(get_current_user_optional),
):
    nombre = (data.nombre_propietario or "").strip() or "Cliente"
    problema = (data.problema or "").strip() or "Sin descripción"
    whatsapp = (data.whatsapp or "").strip() or ""
    fecha_limite = data.fecha_limite
    if not fecha_limite:
        due_dt = datetime.now(timezone.utc) + timedelta(days=1)
    else:
        from datetime import time
        due_dt = datetime.combine(fecha_limite, time.min)

    # Mejora #22: Upload image to S3 if enabled
    imagen_url = data.imagen_url
    if imagen_url and imagen_url.startswith("data:"):
        storage = get_storage_service()
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

    invalidate_stats()

    result = _enrich_tarjeta(t, db)

    try:
        await sio.emit("tarjeta_creada", _socket_tarjeta_payload(t))
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
        await sio.emit("tarjeta_actualizada", _socket_tarjeta_payload(t))
    except Exception:
        pass
    return result


# Mejora #1, #5: Batch position update para Drag & Drop
@router.put("/batch/positions")
async def batch_update_positions(data: BatchPosicionUpdate, db: Session = Depends(get_db)):
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

    db.commit()
    invalidate_stats()
    try:
        await sio.emit("tarjetas_reordenadas", {"items": [{"id": item.id, "columna": item.columna, "posicion": item.posicion} for item in data.items]})
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
        await sio.emit("tarjeta_eliminada", {"id": id, "eliminado": True})
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
        await sio.emit("tarjeta_creada", _socket_tarjeta_payload(t))
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
