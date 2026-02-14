"""Métricas Kanban avanzadas: Cycle Time, Lead Time, Throughput, CFD."""
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.database import get_db
from app.models.repair_card import RepairCard, StatusHistory

router = APIRouter(prefix="/api/metricas", tags=["metricas"])


@router.get("/kanban")
def get_kanban_metrics(
    db: Session = Depends(get_db),
    dias: int = Query(30, description="Días de histórico"),
):
    """Retorna métricas avanzadas de Kanban."""
    base = db.query(RepairCard).filter(RepairCard.deleted_at.is_(None))
    now = datetime.utcnow()
    desde = now - timedelta(days=dias)
    dialect = db.get_bind().dialect.name

    # --- 1. Cycle Time (ingresado → listos) ---
    if dialect == "sqlite":
        ct_expr = func.julianday(RepairCard.entregados_date) - func.julianday(RepairCard.ingresado_date)
    else:
        ct_expr = func.extract("epoch", RepairCard.entregados_date - RepairCard.ingresado_date) / 86400

    completed = base.filter(
        RepairCard.entregados_date.isnot(None),
        RepairCard.entregados_date >= desde,
    ).all()

    cycle_times = []
    for c in completed:
        if c.ingresado_date and c.entregados_date:
            try:
                days = (c.entregados_date - c.ingresado_date).days
                cycle_times.append({"id": c.id, "nombre": c.owner_name, "dias": days})
            except Exception:
                pass

    avg_cycle = round(sum(ct["dias"] for ct in cycle_times) / len(cycle_times), 1) if cycle_times else 0

    # --- 2. Lead Time por etapa ---
    lead_stages = {
        "ingresado_diagnosticada": [],
        "diagnosticada_para_entregar": [],
        "para_entregar_listos": [],
    }
    for c in completed:
        try:
            if c.ingresado_date and c.diagnosticada_date:
                lead_stages["ingresado_diagnosticada"].append((c.diagnosticada_date - c.ingresado_date).days)
            if c.diagnosticada_date and c.para_entregar_date:
                lead_stages["diagnosticada_para_entregar"].append((c.para_entregar_date - c.diagnosticada_date).days)
            if c.para_entregar_date and c.entregados_date:
                lead_stages["para_entregar_listos"].append((c.entregados_date - c.para_entregar_date).days)
        except Exception:
            pass

    avg_leads = {}
    for k, v in lead_stages.items():
        avg_leads[k] = round(sum(v) / len(v), 1) if v else 0

    # --- 3. Throughput semanal (últimas N semanas) ---
    semanas = max(dias // 7, 4)
    throughput = []
    for i in range(semanas):
        week_end = now - timedelta(weeks=i)
        week_start = week_end - timedelta(weeks=1)
        cnt = base.filter(
            RepairCard.entregados_date.isnot(None),
            RepairCard.entregados_date >= week_start,
            RepairCard.entregados_date < week_end,
        ).count()
        throughput.append({
            "semana": week_start.strftime("%d/%m"),
            "completadas": cnt,
        })
    throughput.reverse()

    # --- 4. Cumulative Flow Diagram (CFD) data (últimos N días, muestreo diario) ---
    statuses = ["ingresado", "diagnosticada", "para_entregar", "listos"]
    cfd_data = []
    sample_days = min(dias, 60)
    step = max(1, sample_days // 30)

    for i in range(0, sample_days, step):
        day = now - timedelta(days=sample_days - i)
        point = {"fecha": day.strftime("%d/%m")}
        for status in statuses:
            # Count cards that were in this status at this point in time
            # Use StatusHistory to find historical state
            cnt = db.query(func.count(StatusHistory.id)).filter(
                StatusHistory.new_status == status,
                StatusHistory.changed_at <= day,
            ).scalar() or 0
            point[status] = cnt
        cfd_data.append(point)

    # Also add current state as last point
    current_point = {"fecha": now.strftime("%d/%m")}
    for status in statuses:
        current_point[status] = base.filter(RepairCard.status == status).count()
    cfd_data.append(current_point)

    # --- 5. SLA violations ---
    from app.models.kanban import KanbanColumn
    columns = db.query(KanbanColumn).filter(KanbanColumn.sla_hours.isnot(None)).all()
    sla_violations = []
    for col in columns:
        if not col.sla_hours:
            continue
        # Find cards in this column exceeding SLA
        date_field = {
            "ingresado": RepairCard.ingresado_date,
            "diagnosticada": RepairCard.diagnosticada_date,
            "para_entregar": RepairCard.para_entregar_date,
        }.get(col.key)
        if date_field is None:
            continue
        threshold = now - timedelta(hours=col.sla_hours)
        violating = base.filter(
            RepairCard.status == col.key,
            date_field.isnot(None),
            date_field < threshold,
        ).all()
        for v in violating:
            try:
                hours_in = int((now - getattr(v, date_field.key)).total_seconds() / 3600)
            except Exception:
                hours_in = 0
            sla_violations.append({
                "tarjeta_id": v.id,
                "nombre": v.owner_name,
                "columna": col.title,
                "horas_en_columna": hours_in,
                "sla_horas": col.sla_hours,
            })

    # --- 6. Blocked cards count ---
    blocked_count = base.filter(RepairCard.blocked_at.isnot(None)).count()

    return {
        "cycle_time": {
            "promedio_dias": avg_cycle,
            "total_completadas": len(cycle_times),
            "detalle": cycle_times[:20],
        },
        "lead_time_por_etapa": avg_leads,
        "throughput_semanal": throughput,
        "cfd": cfd_data,
        "sla_violations": sla_violations,
        "blocked_count": blocked_count,
    }
