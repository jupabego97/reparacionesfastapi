"""Estadísticas del sistema con soporte dual SQLite/PostgreSQL.

Mejora #28: Fix de funciones de fecha para SQLite.
"""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func, case, text

from app.core.database import get_db
from app.core.cache import get_cached, set_cached, STATS_KEY, DEFAULT_TTL
from app.models.repair_card import RepairCard

router = APIRouter(prefix="/api/estadisticas", tags=["estadisticas"])


def _safe_avg_days(db: Session, date_start, date_end, *filters) -> float:
    """Calcula promedio de días entre dos fechas, compatible con SQLite y PostgreSQL."""
    dialect = db.get_bind().dialect.name
    try:
        if dialect == "sqlite":
            # SQLite: usar julianday
            expr = func.avg(func.julianday(date_end) - func.julianday(date_start))
        else:
            # PostgreSQL
            expr = func.avg(func.extract("epoch", date_end - date_start) / 86400)

        result = db.query(expr).filter(*filters).scalar()
        return round(float(result or 0), 1)
    except Exception:
        return 0.0


def _compute_estadisticas(db: Session) -> dict:
    # Excluir eliminadas
    base_q = db.query(RepairCard).filter(RepairCard.deleted_at.is_(None))

    por_estado = (
        db.query(RepairCard.status, func.count(RepairCard.id).label("total"))
        .filter(RepairCard.deleted_at.is_(None))
        .group_by(RepairCard.status)
        .all()
    )
    totales_por_estado = {estado: total for estado, total in por_estado}

    # Mejora #28: Safe avg compatible con SQLite
    ingresado_diag = _safe_avg_days(
        db, RepairCard.ingresado_date, RepairCard.diagnosticada_date,
        RepairCard.diagnosticada_date.isnot(None), RepairCard.deleted_at.is_(None),
    )
    diag_entregar = _safe_avg_days(
        db, RepairCard.diagnosticada_date, RepairCard.para_entregar_date,
        RepairCard.para_entregar_date.isnot(None), RepairCard.diagnosticada_date.isnot(None),
        RepairCard.deleted_at.is_(None),
    )
    entregar_entregado = _safe_avg_days(
        db, RepairCard.para_entregar_date, RepairCard.entregados_date,
        RepairCard.entregados_date.isnot(None), RepairCard.para_entregar_date.isnot(None),
        RepairCard.deleted_at.is_(None),
    )

    tiempos_promedio = {
        "ingresado_a_diagnosticada": ingresado_diag,
        "diagnosticada_a_para_entregar": diag_entregar,
        "para_entregar_a_entregados": entregar_entregado,
    }

    hace_un_mes = datetime.now(timezone.utc) - timedelta(days=30)
    completadas_mes = (
        base_q.filter(RepairCard.status == "listos", RepairCard.entregados_date >= hace_un_mes).count()
    )
    pendientes = base_q.filter(RepairCard.status != "listos").count()

    problemas_freq = (
        db.query(RepairCard.problem, func.count(RepairCard.id).label("cantidad"))
        .filter(RepairCard.deleted_at.is_(None))
        .group_by(RepairCard.problem)
        .order_by(func.count(RepairCard.id).desc())
        .limit(5)
        .all()
    )
    top_problemas = [{"problema": p, "cantidad": c} for p, c in problemas_freq]

    con_cargador = base_q.filter(RepairCard.has_charger == "si").count()
    sin_cargador = base_q.filter(RepairCard.has_charger == "no").count()
    total_tarjetas = con_cargador + sin_cargador
    tasa_cargador = {
        "con_cargador": con_cargador,
        "sin_cargador": sin_cargador,
        "porcentaje_con_cargador": round((con_cargador / total_tarjetas * 100) if total_tarjetas > 0 else 0, 1),
    }

    seis_meses = datetime.now(timezone.utc) - timedelta(days=180)
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        mes_expr = func.strftime("%Y-%m", RepairCard.start_date)
    else:
        mes_expr = func.date_trunc("month", RepairCard.start_date)
    tendencia = (
        db.query(mes_expr.label("mes"), func.count(RepairCard.id).label("total"))
        .filter(RepairCard.start_date >= seis_meses, RepairCard.deleted_at.is_(None))
        .group_by(mes_expr)
        .order_by(mes_expr)
        .all()
    )
    tendencia_meses = [
        {"mes": m.strftime("%Y-%m") if hasattr(m, "strftime") else str(m)[:7] if m else None, "total": tot}
        for m, tot in tendencia
    ]

    con_notas = base_q.filter(
        RepairCard.technical_notes.isnot(None),
        RepairCard.technical_notes != "",
    ).count()

    # Mejora #4: Distribución por prioridad
    por_prioridad = (
        db.query(RepairCard.priority, func.count(RepairCard.id))
        .filter(RepairCard.deleted_at.is_(None))
        .group_by(RepairCard.priority)
        .all()
    )
    dist_prioridad = {p: c for p, c in por_prioridad}

    # Mejora #11: Resumen financiero
    total_estimado = db.query(func.sum(RepairCard.estimated_cost)).filter(
        RepairCard.deleted_at.is_(None), RepairCard.estimated_cost.isnot(None)
    ).scalar() or 0
    total_cobrado = db.query(func.sum(RepairCard.final_cost)).filter(
        RepairCard.deleted_at.is_(None), RepairCard.final_cost.isnot(None)
    ).scalar() or 0

    return {
        "totales_por_estado": totales_por_estado,
        "tiempos_promedio_dias": tiempos_promedio,
        "completadas_ultimo_mes": completadas_mes,
        "pendientes": pendientes,
        "top_problemas": top_problemas,
        "tasa_cargador": tasa_cargador,
        "tendencia_6_meses": tendencia_meses,
        "total_reparaciones": total_tarjetas,
        "con_notas_tecnicas": con_notas,
        "distribucion_prioridad": dist_prioridad,
        "resumen_financiero": {
            "total_estimado": round(total_estimado, 2),
            "total_cobrado": round(total_cobrado, 2),
        },
        "generado_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
    }


@router.get("")
def get_estadisticas(db: Session = Depends(get_db)):
    cached_val = get_cached(STATS_KEY, DEFAULT_TTL)
    if cached_val is not None:
        return cached_val
    result = _compute_estadisticas(db)
    set_cached(STATS_KEY, result, DEFAULT_TTL)
    return result
