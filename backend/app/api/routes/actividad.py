"""Activity feed: historial global de actividad del sistema."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.core.database import get_db
from app.models.repair_card import StatusHistory, RepairCard

router = APIRouter(prefix="/api/actividad", tags=["actividad"])


@router.get("")
def get_activity_feed(
    db: Session = Depends(get_db),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    tarjeta_id: int | None = Query(None),
):
    """Feed de actividad global o por tarjeta."""
    q = db.query(StatusHistory).order_by(desc(StatusHistory.changed_at))

    if tarjeta_id is not None:
        q = q.filter(StatusHistory.tarjeta_id == tarjeta_id)

    total = q.count()
    items = q.offset(offset).limit(limit).all()

    # Enrich with card names
    card_ids = list({h.tarjeta_id for h in items})
    cards = {}
    if card_ids:
        for c in db.query(RepairCard.id, RepairCard.owner_name).filter(RepairCard.id.in_(card_ids)).all():
            cards[c.id] = c.owner_name

    feed = []
    for h in items:
        d = h.to_dict()
        d["nombre_propietario"] = cards.get(h.tarjeta_id, "Desconocido")
        feed.append(d)

    return {"actividad": feed, "total": total}
