"""Schemas para modelos Kanban adicionales."""
from typing import Optional, List
from pydantic import BaseModel, Field


# --- Columnas ---
class ColumnCreate(BaseModel):
    key: str = Field(..., min_length=2, max_length=50)
    title: str = Field(..., min_length=1, max_length=100)
    color: Optional[str] = "#0369a1"
    icon: Optional[str] = "fas fa-inbox"
    position: Optional[int] = 0
    wip_limit: Optional[int] = None
    is_done_column: Optional[bool] = False


class ColumnUpdate(BaseModel):
    title: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    position: Optional[int] = None
    wip_limit: Optional[int] = None
    is_done_column: Optional[bool] = None


class ColumnReorder(BaseModel):
    columns: List[dict]  # [{id: 1, position: 0}, ...]


# --- Tags ---
class TagCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50)
    color: Optional[str] = "#6366f1"
    icon: Optional[str] = None


class TagUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None


# --- Sub-tareas ---
class SubTaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    position: Optional[int] = 0


class SubTaskUpdate(BaseModel):
    title: Optional[str] = None
    completed: Optional[bool] = None
    position: Optional[int] = None


# --- Comentarios ---
class CommentCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)


# --- Notificaciones ---
class NotificationMarkRead(BaseModel):
    ids: List[int]
