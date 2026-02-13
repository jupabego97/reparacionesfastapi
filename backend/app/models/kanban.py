"""Modelos adicionales para el sistema Kanban profesional.

Incluye: KanbanColumn, Tag, SubTask, Comment, Notification.
"""
from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Text, DateTime, Boolean, Float, ForeignKey, Table
from sqlalchemy.orm import relationship
from app.core.database import Base


# --- Tabla intermedia para relación M:N tarjetas <-> tags ---
repair_card_tags = Table(
    "repair_card_tags",
    Base.metadata,
    Column("repair_card_id", Integer, ForeignKey("repair_cards.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class KanbanColumn(Base):
    """Columnas configurables del tablero Kanban."""
    __tablename__ = "kanban_columns"

    id = Column(Integer, primary_key=True, autoincrement=True)
    key = Column(Text, unique=True, nullable=False, index=True)  # ej: 'ingresado'
    title = Column(Text, nullable=False)                          # ej: 'Ingresado'
    color = Column(Text, nullable=False, default="#0369a1")
    icon = Column(Text, nullable=True, default="fas fa-inbox")
    position = Column(Integer, nullable=False, default=0)
    wip_limit = Column(Integer, nullable=True)                    # WIP limit (null = sin límite)
    is_done_column = Column(Boolean, nullable=False, default=False)  # Indica si es columna "completado"
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "key": self.key,
            "title": self.title,
            "color": self.color,
            "icon": self.icon,
            "position": self.position,
            "wip_limit": self.wip_limit,
            "is_done_column": self.is_done_column,
        }


class Tag(Base):
    """Etiquetas/tags para categorizar reparaciones."""
    __tablename__ = "tags"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(Text, unique=True, nullable=False, index=True)
    color = Column(Text, nullable=False, default="#6366f1")
    icon = Column(Text, nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "color": self.color,
            "icon": self.icon,
        }


class SubTask(Base):
    """Sub-tareas / checklist dentro de una tarjeta."""
    __tablename__ = "subtasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tarjeta_id = Column(Integer, ForeignKey("repair_cards.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(Text, nullable=False)
    completed = Column(Boolean, nullable=False, default=False)
    position = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    completed_at = Column(DateTime, nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "tarjeta_id": self.tarjeta_id,
            "title": self.title,
            "completed": self.completed,
            "position": self.position,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M:%S") if self.created_at else None,
            "completed_at": self.completed_at.strftime("%Y-%m-%d %H:%M:%S") if self.completed_at else None,
        }


class Comment(Base):
    """Comentarios en una tarjeta de reparación."""
    __tablename__ = "comments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tarjeta_id = Column(Integer, ForeignKey("repair_cards.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    author_name = Column(Text, nullable=False, default="Sistema")
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "tarjeta_id": self.tarjeta_id,
            "user_id": self.user_id,
            "author_name": self.author_name,
            "content": self.content,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M:%S") if self.created_at else None,
        }


class Notification(Base):
    """Notificaciones in-app persistentes."""
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True)
    tarjeta_id = Column(Integer, ForeignKey("repair_cards.id", ondelete="SET NULL"), nullable=True)
    title = Column(Text, nullable=False)
    message = Column(Text, nullable=False)
    type = Column(Text, nullable=False, default="info")  # info, success, warning, error
    read = Column(Boolean, nullable=False, default=False, index=True)
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc), index=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "user_id": self.user_id,
            "tarjeta_id": self.tarjeta_id,
            "title": self.title,
            "message": self.message,
            "type": self.type,
            "read": self.read,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M:%S") if self.created_at else None,
        }
