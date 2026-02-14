"""CRUD de plantillas de tarjetas reutilizables."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db
from app.models.kanban import CardTemplate

router = APIRouter(prefix="/api/plantillas", tags=["plantillas"])


class TemplateCreate(BaseModel):
    name: str
    problem_template: str | None = None
    default_priority: str = "media"
    default_notes: str | None = None
    estimated_hours: float | None = None


class TemplateUpdate(BaseModel):
    name: str | None = None
    problem_template: str | None = None
    default_priority: str | None = None
    default_notes: str | None = None
    estimated_hours: float | None = None


@router.get("")
def get_templates(db: Session = Depends(get_db)):
    templates = db.query(CardTemplate).order_by(CardTemplate.name).all()
    return [t.to_dict() for t in templates]


@router.post("")
def create_template(data: TemplateCreate, db: Session = Depends(get_db)):
    t = CardTemplate(
        name=data.name,
        problem_template=data.problem_template,
        default_priority=data.default_priority,
        default_notes=data.default_notes,
        estimated_hours=data.estimated_hours,
    )
    db.add(t)
    try:
        db.commit()
        db.refresh(t)
    except Exception:
        db.rollback()
        raise HTTPException(status_code=400, detail="Template name already exists")
    return t.to_dict()


@router.put("/{template_id}")
def update_template(template_id: int, data: TemplateUpdate, db: Session = Depends(get_db)):
    t = db.query(CardTemplate).get(template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    for field, val in data.model_dump(exclude_unset=True).items():
        setattr(t, field, val)
    db.commit()
    db.refresh(t)
    return t.to_dict()


@router.delete("/{template_id}")
def delete_template(template_id: int, db: Session = Depends(get_db)):
    t = db.query(CardTemplate).get(template_id)
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    db.delete(t)
    db.commit()
    return {"ok": True}
