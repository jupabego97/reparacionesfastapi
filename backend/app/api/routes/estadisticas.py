"""Estadísticas del sistema con soporte dual SQLite/PostgreSQL.

Optimizado: queries consolidadas, caching TTL 5min.
"""
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.core.cache import DEFAULT_TTL, STATS_KEY, get_cached, set_cached
from app.core.database import get_db
from app.models.repair_card import RepairCard

router = APIRouter(prefix="/api/estadisticas", tags=["estadisticas"])


def _safe_avg_days(db: Session, date_start, date_end, *filters) -> float:
    """Calcula promedio de días entre dos fechas, compatible con SQLite y PostgreSQL."""
    dialect = db.get_bind().dialect.name
    try:
        if dialect == "sqlite":
            expr = func.avg(func.julianday(date_end) - func.julianday(date_start))
        else:
            expr = func.avg(func.extract("epoch", date_end - date_start) / 86400)
        result = db.query(expr).filter(*filters).scalar()
        return round(float(result or 0), 1)
    except Exception:
        return 0.0


def _compute_estadisticas(db: Session) -> dict:
    not_deleted = RepairCard.deleted_at.is_(None)
    dialect = db.get_bind().dialect.name
    hace_un_mes = datetime.now(UTC) - timedelta(days=30)

    # --- QUERY 1: Aggregates in a single pass ---
    # Counts per status + priority + charger + financial totals + notes count
    agg = db.query(
        RepairCard.status,
        RepairCard.priority,
        func.count(RepairCard.id).label("cnt"),
        func.sum(case((RepairCard.has_charger == "si", 1), else_=0)).label("con_cargador"),
        func.sum(case((RepairCard.has_charger == "no", 1), else_=0)).label("sin_cargador"),
        func.sum(case((
            (RepairCard.status == "listos") & (RepairCard.entregados_date >= hace_un_mes), 1
        ), else_=0)).label("completadas_mes"),
        func.sum(case((RepairCard.status != "listos", 1), else_=0)).label("pendientes"),
        func.sum(case((
            RepairCard.technical_notes.isnot(None) & (RepairCard.technical_notes != ""), 1
        ), else_=0)).label("con_notas"),
    ).filter(not_deleted).group_by(RepairCard.status, RepairCard.priority).all()

    totales_por_estado: dict[str, int] = {}
    dist_prioridad: dict[str, int] = {}
    con_cargador = 0
    sin_cargador = 0
    completadas_mes = 0
    pendientes = 0
    con_notas = 0

    for row in agg:
        totales_por_estado[row.status] = totales_por_estado.get(row.status, 0) + row.cnt
        dist_prioridad[row.priority or "media"] = dist_prioridad.get(row.priority or "media", 0) + row.cnt
        con_cargador += row.con_cargador or 0
        sin_cargador += row.sin_cargador or 0
        completadas_mes += row.completadas_mes or 0
        pendientes += row.pendientes or 0
        con_notas += row.con_notas or 0

    total_tarjetas = con_cargador + sin_cargador

    # --- QUERY 2: Average times between stages ---
    tiempos_promedio = {
        "ingresado_a_diagnosticada": _safe_avg_days(
            db, RepairCard.ingresado_date, RepairCard.diagnosticada_date,
            RepairCard.diagnosticada_date.isnot(None), not_deleted,
        ),
        "diagnosticada_a_para_entregar": _safe_avg_days(
            db, RepairCard.diagnosticada_date, RepairCard.para_entregar_date,
            RepairCard.para_entregar_date.isnot(None), RepairCard.diagnosticada_date.isnot(None), not_deleted,
        ),
        "para_entregar_a_entregados": _safe_avg_days(
            db, RepairCard.para_entregar_date, RepairCard.entregados_date,
            RepairCard.entregados_date.isnot(None), RepairCard.para_entregar_date.isnot(None), not_deleted,
        ),
    }

    # --- QUERY 3: Top problems ---
    problemas_freq = (
        db.query(RepairCard.problem, func.count(RepairCard.id).label("cantidad"))
        .filter(not_deleted)
        .group_by(RepairCard.problem)
        .order_by(func.count(RepairCard.id).desc())
        .limit(5)
        .all()
    )
    top_problemas = [{"problema": p, "cantidad": c} for p, c in problemas_freq]

    # --- QUERY 4: Financial summary ---
    financials = db.query(
        func.sum(RepairCard.estimated_cost).label("est"),
        func.sum(RepairCard.final_cost).label("fin"),
    ).filter(not_deleted).first()

    # --- QUERY 5: 6-month trend ---
    seis_meses = datetime.now(UTC) - timedelta(days=180)
    if dialect == "sqlite":
        mes_expr = func.strftime("%Y-%m", RepairCard.start_date)
    else:
        mes_expr = func.date_trunc("month", RepairCard.start_date)

    tendencia = (
        db.query(mes_expr.label("mes"), func.count(RepairCard.id).label("total"))
        .filter(RepairCard.start_date >= seis_meses, not_deleted)
        .group_by(mes_expr)
        .order_by(mes_expr)
        .all()
    )
    tendencia_meses = [
        {"mes": m.strftime("%Y-%m") if hasattr(m, "strftime") else str(m)[:7] if m else None, "total": tot}
        for m, tot in tendencia
    ]

    return {
        "totales_por_estado": totales_por_estado,
        "tiempos_promedio_dias": tiempos_promedio,
        "completadas_ultimo_mes": completadas_mes,
        "pendientes": pendientes,
        "top_problemas": top_problemas,
        "tasa_cargador": {
            "con_cargador": con_cargador,
            "sin_cargador": sin_cargador,
            "porcentaje_con_cargador": round((con_cargador / total_tarjetas * 100) if total_tarjetas > 0 else 0, 1),
        },
        "tendencia_6_meses": tendencia_meses,
        "total_reparaciones": total_tarjetas,
        "con_notas_tecnicas": con_notas,
        "distribucion_prioridad": dist_prioridad,
        "resumen_financiero": {
            "total_estimado": round(float(financials.est or 0), 2),
            "total_cobrado": round(float(financials.fin or 0), 2),
        },
        "generado_at": datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S"),
    }


@router.get("")
def get_estadisticas(db: Session = Depends(get_db)):
    cached_val = get_cached(STATS_KEY, DEFAULT_TTL)
    if cached_val is not None:
        return cached_val
    result = _compute_estadisticas(db)
    set_cached(STATS_KEY, result, DEFAULT_TTL)
    return result
