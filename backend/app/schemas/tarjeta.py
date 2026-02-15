from datetime import date
from enum import StrEnum

from pydantic import BaseModel, Field


class Prioridad(StrEnum):
    alta = "alta"
    media = "media"
    baja = "baja"


class TarjetaCreate(BaseModel):
    nombre_propietario: str | None = "Cliente"
    problema: str | None = "Sin descripción"
    whatsapp: str | None = ""
    fecha_limite: date | None = None
    imagen_url: str | None = None
    tiene_cargador: str | None = "si"
    notas_tecnicas: str | None = None
    prioridad: Prioridad | None = Prioridad.media
    asignado_a: int | None = None
    costo_estimado: float | None = Field(None, ge=0)
    tags: list[int] | None = None


class TarjetaUpdate(BaseModel):
    nombre_propietario: str | None = None
    problema: str | None = None
    whatsapp: str | None = None
    fecha_limite: str | None = None
    imagen_url: str | None = None
    tiene_cargador: str | None = None
    notas_tecnicas: str | None = None
    columna: str | None = None
    prioridad: Prioridad | None = None
    posicion: int | None = None
    asignado_a: int | None = None
    costo_estimado: float | None = Field(None, ge=0)
    costo_final: float | None = Field(None, ge=0)
    notas_costo: str | None = None
    tags: list[int] | None = None


class TarjetaResponse(BaseModel):
    id: int
    nombre_propietario: str | None = None
    problema: str | None = None
    whatsapp: str | None = None
    fecha_inicio: str | None = None
    fecha_limite: str | None = None
    columna: str
    tiene_cargador: str | None = None
    fecha_diagnosticada: str | None = None
    fecha_para_entregar: str | None = None
    fecha_entregada: str | None = None
    notas_tecnicas: str | None = None
    imagen_url: str | None = None
    prioridad: str | None = "media"
    posicion: int | None = 0
    asignado_a: int | None = None
    asignado_nombre: str | None = None
    costo_estimado: float | None = None
    costo_final: float | None = None
    notas_costo: str | None = None
    eliminado: bool | None = False
    bloqueada: bool | None = False
    motivo_bloqueo: str | None = None
    tags: list[dict] | None = None
    subtasks_total: int | None = 0
    subtasks_done: int | None = 0
    comments_count: int | None = 0
    cover_thumb_url: str | None = None
    media_count: int | None = 0
    has_media: bool | None = False
    media_preview: list[dict] | None = None
    dias_en_columna: int | None = 0


class HistorialEntry(BaseModel):
    id: int
    tarjeta_id: int
    old_status: str | None = None
    new_status: str
    changed_at: str | None = None
    changed_by: int | None = None
    changed_by_name: str | None = None


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
    reason: str | None = Field(None, max_length=500)
    user_id: int | None = None


# --- Batch operations ---
class BatchAction(StrEnum):
    move = "move"
    assign = "assign"
    tag = "tag"
    priority = "priority"
    delete = "delete"


class BatchOperationRequest(BaseModel):
    ids: list[int] = Field(min_length=1)
    action: BatchAction
    value: str | None = None
    user_name: str | None = None
    assign_name: str | None = None


# --- Media reorder ---
class MediaReorderItem(BaseModel):
    id: int
    position: int = Field(ge=0)


class MediaReorderRequest(BaseModel):
    items: list[MediaReorderItem] = Field(min_length=1)
