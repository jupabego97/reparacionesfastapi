from datetime import date
from typing import Optional
from pydantic import BaseModel, Field


class TarjetaCreate(BaseModel):
    nombre_propietario: Optional[str] = "Cliente"
    problema: Optional[str] = "Sin descripción"
    whatsapp: Optional[str] = ""
    fecha_limite: Optional[date] = None
    imagen_url: Optional[str] = None
    tiene_cargador: Optional[str] = "si"
    notas_tecnicas: Optional[str] = None


class TarjetaUpdate(BaseModel):
    nombre_propietario: Optional[str] = None
    problema: Optional[str] = None
    whatsapp: Optional[str] = None
    fecha_limite: Optional[str] = None
    imagen_url: Optional[str] = None
    tiene_cargador: Optional[str] = None
    notas_tecnicas: Optional[str] = None
    columna: Optional[str] = None


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


class HistorialEntry(BaseModel):
    id: int
    tarjeta_id: int
    old_status: Optional[str] = None
    new_status: str
    changed_at: Optional[str] = None
