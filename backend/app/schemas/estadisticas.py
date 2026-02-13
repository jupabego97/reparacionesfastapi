from typing import Optional
from pydantic import BaseModel


class TopProblema(BaseModel):
    problema: str
    cantidad: int


class TasaCargador(BaseModel):
    con_cargador: int
    sin_cargador: int
    porcentaje_con_cargador: float


class TendenciaMes(BaseModel):
    mes: Optional[str]
    total: int


class Estadisticas(BaseModel):
    totales_por_estado: dict
    tiempos_promedio_dias: dict
    completadas_ultimo_mes: int
    pendientes: int
    top_problemas: list
    tasa_cargador: dict
    tendencia_6_meses: list
    total_reparaciones: int
    con_notas_tecnicas: int
    generado_at: str
