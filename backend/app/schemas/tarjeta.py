from datetime import date
from enum import Enum
from typing import Optional
from pydantic import BaseModel, Field


class Prioridad(str, Enum):
    alta = "alta"
    media = "media"
    baja = "baja"


class TarjetaCreate(BaseModel):
    nombre_propietario: Optional[str] = "Cliente"
    problema: Optional[str] = "Sin descripción"
    whatsapp: Optional[str] = ""
    fecha_limite: Optional[date] = None
    imagen_url: Optional[str] = None
    tiene_cargador: Optional[str] = "si"
    notas_tecnicas: Optional[str] = None
    prioridad: Optional[Prioridad] = Prioridad.media
    asignado_a: Optional[int] = None
    costo_estimado: Optional[float] = Field(None, ge=0)
    tags: Optional[list[int]] = None


class TarjetaUpdate(BaseModel):
    nombre_propietario: Optional[str] = None
    problema: Optional[str] = None
    whatsapp: Optional[str] = None
    fecha_limite: Optional[str] = None
    imagen_url: Optional[str] = None
    tiene_cargador: Optional[str] = None
    notas_tecnicas: Optional[str] = None
    columna: Optional[str] = None
    prioridad: Optional[Prioridad] = None
    posicion: Optional[int] = None
    asignado_a: Optional[int] = None
    costo_estimado: Optional[float] = Field(None, ge=0)
    costo_final: Optional[float] = Field(None, ge=0)
    notas_costo: Optional[str] = None
    tags: Optional[list[int]] = None


class TarjetaResponse(BaseModel):
    id: int
    nombre_propietario: Optional[str] = None
    problema: Optional[str] = None
    whatsapp: Optional[str] = None
    fecha_inicio: Optional[str] = None
    fecha_limite: Optional[str] = None
    columna: str
    tiene_cargador: Optional[str] = None
    fecha_diagnosticada: Optional[str] = None
    fecha_para_entregar: Optional[str] = None
    fecha_entregada: Optional[str] = None
    notas_tecnicas: Optional[str] = None
    imagen_url: Optional[str] = None
    prioridad: Optional[str] = "media"
    posicion: Optional[int] = 0
    asignado_a: Optional[int] = None
    asignado_nombre: Optional[str] = None
    costo_estimado: Optional[float] = None
    costo_final: Optional[float] = None
    notas_costo: Optional[str] = None
    eliminado: Optional[bool] = False
    bloqueada: Optional[bool] = False
    motivo_bloqueo: Optional[str] = None
    tags: Optional[list[dict]] = None
    subtasks_total: Optional[int] = 0
    subtasks_done: Optional[int] = 0
    comments_count: Optional[int] = 0
    cover_thumb_url: Optional[str] = None
    media_count: Optional[int] = 0
    has_media: Optional[bool] = False
    media_preview: Optional[list[dict]] = None
    dias_en_columna: Optional[int] = 0


class HistorialEntry(BaseModel):
    id: int
    tarjeta_id: int
    old_status: Optional[str] = None
    new_status: str
    changed_at: Optional[str] = None
    changed_by: Optional[int] = None
    changed_by_name: Optional[str] = None


# --- Batch position update para drag & drop ---
class PosicionUpdate(BaseModel):
    id: int
    columna: str
    posicion: int = Field(ge=0)


class BatchPosicionUpdate(BaseModel):
    items: list[PosicionUpdate] = Field(min_length=1)


# --- Soft delete / restore ---
class TarjetaRestore(BaseModel):
    id: int


# --- Block / Unblock ---
class BlockRequest(BaseModel):
    blocked: bool = True
    reason: Optional[str] = Field(None, max_length=500)
    user_id: Optional[int] = None


# --- Batch operations ---
class BatchAction(str, Enum):
    move = "move"
    assign = "assign"
    tag = "tag"
    priority = "priority"
    delete = "delete"


class BatchOperationRequest(BaseModel):
    ids: list[int] = Field(min_length=1)
    action: BatchAction
    value: Optional[str] = None
    user_name: Optional[str] = None
    assign_name: Optional[str] = None


# --- Media reorder ---
class MediaReorderItem(BaseModel):
    id: int
    position: int = Field(ge=0)


class MediaReorderRequest(BaseModel):
    items: list[MediaReorderItem] = Field(min_length=1)
