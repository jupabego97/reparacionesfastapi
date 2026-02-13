from datetime import date
from typing import Optional, List
from pydantic import BaseModel, Field


class TarjetaCreate(BaseModel):
    nombre_propietario: Optional[str] = "Cliente"
    problema: Optional[str] = "Sin descripción"
    whatsapp: Optional[str] = ""
    fecha_limite: Optional[date] = None
    imagen_url: Optional[str] = None
    tiene_cargador: Optional[str] = "si"
    notas_tecnicas: Optional[str] = None
    # Nuevos campos
    prioridad: Optional[str] = "media"
    asignado_a: Optional[int] = None
    costo_estimado: Optional[float] = None
    tags: Optional[List[int]] = None


class TarjetaUpdate(BaseModel):
    nombre_propietario: Optional[str] = None
    problema: Optional[str] = None
    whatsapp: Optional[str] = None
    fecha_limite: Optional[str] = None
    imagen_url: Optional[str] = None
    tiene_cargador: Optional[str] = None
    notas_tecnicas: Optional[str] = None
    columna: Optional[str] = None
    # Nuevos campos
    prioridad: Optional[str] = None
    posicion: Optional[int] = None
    asignado_a: Optional[int] = None
    costo_estimado: Optional[float] = None
    costo_final: Optional[float] = None
    notas_costo: Optional[str] = None
    tags: Optional[List[int]] = None


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
    # Nuevos campos
    prioridad: Optional[str] = "media"
    posicion: Optional[int] = 0
    asignado_a: Optional[int] = None
    asignado_nombre: Optional[str] = None
    costo_estimado: Optional[float] = None
    costo_final: Optional[float] = None
    notas_costo: Optional[str] = None
    eliminado: Optional[bool] = False
    tags: Optional[List[dict]] = None
    subtasks: Optional[List[dict]] = None
    comments_count: Optional[int] = 0


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
    posicion: int


class BatchPosicionUpdate(BaseModel):
    items: List[PosicionUpdate]


# --- Soft delete / restore ---
class TarjetaRestore(BaseModel):
    id: int
