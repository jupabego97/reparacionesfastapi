"""Tests for daily performance metrics endpoint."""
from datetime import UTC, datetime, timedelta

from app.models.repair_card import RepairCard

from tests.conftest import client


def test_daily_metrics_empty():
    r = client.get("/api/metricas/diario")
    assert r.status_code == 200
    data = r.json()
    assert data["timezone"] == "America/Bogota"
    assert "hoy" in data
    assert data["hoy"]["ingresos"] == 0
    assert data["hoy"]["entregas"] == 0
    assert data["hoy"]["bloqueadas"] == 0
    assert isinstance(data["alertas"], list)
    assert isinstance(data["por_tecnico_7d"], list)


def test_daily_metrics_counts_today(db_session):
    now = datetime.now(UTC)
    db_session.add(
        RepairCard(
            owner_name="Hoy Ingreso",
            problem="Pantalla",
            status="ingresado",
            start_date=now,
            due_date=now + timedelta(days=2),
            ingresado_date=now,
            priority="media",
            position=0,
        )
    )
    db_session.add(
        RepairCard(
            owner_name="Hoy Entrega",
            problem="Bateria",
            status="listos",
            start_date=now - timedelta(days=3),
            due_date=now,
            ingresado_date=now - timedelta(days=3),
            entregados_date=now,
            final_cost=120000,
            assigned_to=None,
            assigned_name="Ana",
            priority="alta",
            position=1,
        )
    )
    db_session.add(
        RepairCard(
            owner_name="Bloqueada",
            problem="Repuesto",
            status="diagnosticada",
            start_date=now - timedelta(days=1),
            due_date=now + timedelta(days=1),
            ingresado_date=now - timedelta(days=1),
            diagnosticada_date=now - timedelta(days=1),
            blocked_at=now,
            blocked_reason="Espera repuesto",
            priority="media",
            position=2,
        )
    )
    db_session.commit()

    r = client.get("/api/metricas/diario")
    assert r.status_code == 200
    data = r.json()
    assert data["hoy"]["ingresos"] >= 1
    assert data["hoy"]["entregas"] >= 1
    assert data["hoy"]["cobrado"] >= 120000
    assert data["hoy"]["bloqueadas"] >= 1
    assert data["hoy"]["pendientes"] >= 2
