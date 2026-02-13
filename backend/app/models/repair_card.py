from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from app.core.database import Base


class RepairCard(Base):
    __tablename__ = "repair_cards"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_name = Column(Text, nullable=True, default="Cliente", index=True)
    whatsapp_number = Column(Text, nullable=True, default="", index=True)
    problem = Column(Text, nullable=True, default="Sin descripción")
    status = Column(Text, nullable=False, index=True)
    start_date = Column(DateTime, nullable=False, index=True)
    due_date = Column(DateTime, nullable=False, index=True)
    image_url = Column(Text, nullable=True)
    has_charger = Column(Text, nullable=True)
    ingresado_date = Column(DateTime, nullable=False)
    diagnosticada_date = Column(DateTime, nullable=True)
    para_entregar_date = Column(DateTime, nullable=True)
    entregados_date = Column(DateTime, nullable=True)
    technical_notes = Column(Text, nullable=True)

    def to_dict(self, include_image: bool = True) -> dict:
        d = {
            "id": self.id,
            "nombre_propietario": self.owner_name,
            "problema": self.problem,
            "whatsapp": self.whatsapp_number,
            "fecha_inicio": self.start_date.strftime("%Y-%m-%d %H:%M:%S") if self.start_date else None,
            "fecha_limite": self.due_date.strftime("%Y-%m-%d") if self.due_date else None,
            "columna": self.status,
            "tiene_cargador": self.has_charger,
            "fecha_diagnosticada": self.diagnosticada_date.strftime("%Y-%m-%d %H:%M:%S") if self.diagnosticada_date else None,
            "fecha_para_entregar": self.para_entregar_date.strftime("%Y-%m-%d %H:%M:%S") if self.para_entregar_date else None,
            "fecha_entregada": self.entregados_date.strftime("%Y-%m-%d %H:%M:%S") if self.entregados_date else None,
            "notas_tecnicas": self.technical_notes,
        }
        d["imagen_url"] = self.image_url if include_image else None
        return d


class StatusHistory(Base):
    __tablename__ = "status_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tarjeta_id = Column(Integer, ForeignKey("repair_cards.id", ondelete="CASCADE"), nullable=False, index=True)
    old_status = Column(Text, nullable=True)
    new_status = Column(Text, nullable=False)
    changed_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "tarjeta_id": self.tarjeta_id,
            "old_status": self.old_status,
            "new_status": self.new_status,
            "changed_at": self.changed_at.strftime("%Y-%m-%d %H:%M:%S") if self.changed_at else None,
        }
