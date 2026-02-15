"""Schemas para modelos Kanban adicionales."""

from pydantic import BaseModel, Field


# --- Columnas ---
class ColumnCreate(BaseModel):
    key: str = Field(..., min_length=2, max_length=50)
    title: str = Field(..., min_length=1, max_length=100)
    color: str | None = "#0369a1"
    icon: str | None = "fas fa-inbox"
    position: int | None = 0
    wip_limit: int | None = None
    is_done_column: bool | None = False


class ColumnUpdate(BaseModel):
    title: str | None = None
    color: str | None = None
    icon: str | None = None
    position: int | None = None
    wip_limit: int | None = None
    is_done_column: bool | None = None


class ColumnReorder(BaseModel):
    columns: list[dict]  # [{id: 1, position: 0}, ...]


# --- Tags ---
class TagCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    color: str | None = "#6366f1"
    icon: str | None = None


class TagUpdate(BaseModel):
    name: str | None = None
    color: str | None = None
    icon: str | None = None


# --- Sub-tareas ---
class SubTaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    position: int | None = 0


class SubTaskUpdate(BaseModel):
    title: str | None = None
    completed: bool | None = None
    position: int | None = None


# --- Comentarios ---
class CommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)


# --- Notificaciones ---
class NotificationMarkRead(BaseModel):
    ids: list[int]


class KanbanRules(BaseModel):
    wip_limits: dict[str, int] = Field(default_factory=dict)
    sla_by_column: dict[str, int] = Field(default_factory=dict)
    transition_requirements: dict[str, list[str]] = Field(default_factory=dict)
