from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, text
from sqlalchemy.exc import IntegrityError

from app.core.database import get_db
from app.core.limiter import limiter
from app.core.cache import invalidate_stats
from app.models.repair_card import RepairCard, StatusHistory
from app.schemas.tarjeta import TarjetaCreate, TarjetaUpdate
from app.socket_events import sio

router = APIRouter(prefix="/api/tarjetas", tags=["tarjetas"])

ESTADOS_VALIDOS = ["ingresado", "diagnosticada", "para_entregar", "listos"]


CACHE_HEADERS = {"Cache-Control": "no-cache, no-store, must-revalidate", "Pragma": "no-cache", "Expires": "0"}


@router.get("")
def get_tarjetas(
    db: Session = Depends(get_db),
    page: int | None = Query(None),
    per_page: int | None = Query(None),
    light: int | None = Query(None),
):
    include_image = light != 1
    if page is None and per_page is None:
        items = db.query(RepairCard).order_by(RepairCard.start_date.desc()).all()
        data = [t.to_dict(include_image=include_image) for t in items]
        return JSONResponse(content=data, headers=CACHE_HEADERS)

    per_page = min(per_page or 50, 100)
    page = page or 1
    q = db.query(RepairCard).order_by(RepairCard.start_date.desc())
    total = q.count()
    items = q.offset((page - 1) * per_page).limit(per_page).all()
    data = {
        "tarjetas": [t.to_dict(include_image=include_image) for t in items],
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
async def create_tarjeta(request: Request, data: TarjetaCreate, db: Session = Depends(get_db)):
    nombre = (data.nombre_propietario or "").strip() or "Cliente"
    problema = (data.problema or "").strip() or "Sin descripción"
    whatsapp = (data.whatsapp or "").strip() or ""
    fecha_limite = data.fecha_limite
    if not fecha_limite:
        due_dt = datetime.now(timezone.utc) + timedelta(days=1)
    else:
        from datetime import time
        due_dt = datetime.combine(fecha_limite, time.min)

    t = RepairCard(
        owner_name=nombre,
        problem=problema,
        whatsapp_number=whatsapp,
        start_date=datetime.now(timezone.utc),
        due_date=due_dt,
        status="ingresado",
        ingresado_date=datetime.now(timezone.utc),
        image_url=data.imagen_url,
        has_charger=data.tiene_cargador or "si",
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
                raise HTTPException(
                    status_code=500,
                    detail="Error de secuencia de IDs. Ejecuta: SELECT setval('repair_cards_id_seq', (SELECT MAX(id) FROM repair_cards), true);",
                )
        else:
            raise HTTPException(status_code=500, detail="Error de integridad al crear tarjeta")
    invalidate_stats()
    try:
        await sio.emit("tarjeta_creada", t.to_dict())
    except Exception:
        pass
    return t.to_dict()


@router.put("/{id}")
async def update_tarjeta(id: int, data: TarjetaUpdate, db: Session = Depends(get_db)):
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
        t.image_url = upd["imagen_url"] or None
    if "tiene_cargador" in upd:
        t.has_charger = upd["tiene_cargador"]
    if "notas_tecnicas" in upd:
        t.technical_notes = upd["notas_tecnicas"] or None

    if "columna" in upd:
        nuevo = upd["columna"]
        if nuevo not in ESTADOS_VALIDOS:
            raise HTTPException(status_code=400, detail=f"Estado no válido. Permitidos: {ESTADOS_VALIDOS}")
        old_status = t.status
        if old_status != nuevo:
            db.add(StatusHistory(tarjeta_id=t.id, old_status=old_status, new_status=nuevo, changed_at=datetime.now(timezone.utc)))
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
    try:
        await sio.emit("tarjeta_actualizada", t.to_dict())
    except Exception:
        pass
    return t.to_dict()


@router.delete("/{id}", status_code=204)
async def delete_tarjeta(id: int, db: Session = Depends(get_db)):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    db.delete(t)
    db.commit()
    invalidate_stats()
    try:
        await sio.emit("tarjeta_eliminada", {"id": id})
    except Exception:
        pass
    return None


@router.get("/{id}/historial")
def get_historial(id: int, db: Session = Depends(get_db)):
    t = db.query(RepairCard).filter(RepairCard.id == id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    hist = db.query(StatusHistory).filter(StatusHistory.tarjeta_id == id).order_by(StatusHistory.changed_at.desc()).all()
    return [h.to_dict() for h in hist]
