from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Text, DateTime, ForeignKey, Float, Boolean
from sqlalchemy.orm import relationship

from app.core.database import Base


class RepairCard(Base):
    __tablename__ = "repair_cards"

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_name = Column(Text, nullable=True, default="Cliente", index=True)
    whatsapp_number = Column(Text, nullable=True, default="", index=True)
    problem = Column(Text, nullable=True, default="Sin descripción")
    status = Column(Text, nullable=False, index=True)
    start_date = Column(DateTime(timezone=True), nullable=False, index=True)
    due_date = Column(DateTime(timezone=True), nullable=False, index=True)
    image_url = Column(Text, nullable=True)
    has_charger = Column(Text, nullable=True)
    ingresado_date = Column(DateTime(timezone=True), nullable=False)
    diagnosticada_date = Column(DateTime(timezone=True), nullable=True)
    para_entregar_date = Column(DateTime(timezone=True), nullable=True)
    entregados_date = Column(DateTime(timezone=True), nullable=True)
    technical_notes = Column(Text, nullable=True)

    # --- Mejora #4: Prioridad ---
    priority = Column(Text, nullable=False, default="media", index=True)  # alta, media, baja

    # --- Mejora #5: Posición para ordenamiento manual ---
    position = Column(Integer, nullable=False, default=0, index=True)

    # --- Mejora #7: Asignación de técnico ---
    assigned_to = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    assigned_name = Column(Text, nullable=True)

    # --- Mejora #11: Costos ---
    estimated_cost = Column(Float, nullable=True)
    final_cost = Column(Float, nullable=True)
    cost_notes = Column(Text, nullable=True)

    # --- Mejora #23: Soft delete ---
    deleted_at = Column(DateTime(timezone=True), nullable=True, index=True)

    # --- Mejora #10: Tags (via relación M:N) ---
    # Se accede vía join, no relación directa para evitar imports circulares

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
            # Nuevos campos
            "prioridad": self.priority,
            "posicion": self.position,
            "asignado_a": self.assigned_to,
            "asignado_nombre": self.assigned_name,
            "costo_estimado": self.estimated_cost,
            "costo_final": self.final_cost,
            "notas_costo": self.cost_notes,
            "eliminado": self.deleted_at is not None,
        }
        d["imagen_url"] = self.image_url if include_image else None
        return d


class StatusHistory(Base):
    __tablename__ = "status_history"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tarjeta_id = Column(Integer, ForeignKey("repair_cards.id", ondelete="CASCADE"), nullable=False, index=True)
    old_status = Column(Text, nullable=True)
    new_status = Column(Text, nullable=False)
    changed_at = Column(DateTime(timezone=True), nullable=False, default=lambda: datetime.now(timezone.utc), index=True)
    changed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    changed_by_name = Column(Text, nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "tarjeta_id": self.tarjeta_id,
            "old_status": self.old_status,
            "new_status": self.new_status,
            "changed_at": self.changed_at.strftime("%Y-%m-%d %H:%M:%S") if self.changed_at else None,
            "changed_by": self.changed_by,
            "changed_by_name": self.changed_by_name,
        }
