"""Tests de reglas Kanban en movimientos de tarjetas."""

from datetime import UTC, datetime

from tests.conftest import client


def test_batch_positions_rejects_blocked_card(auth_headers, sample_tarjeta, db_session):
    sample_tarjeta.blocked_at = datetime.now(UTC)
    sample_tarjeta.blocked_reason = "Esperando repuesto"
    db_session.commit()

    r = client.put(
        "/api/tarjetas/batch/positions",
        json={"items": [{"id": sample_tarjeta.id, "columna": "diagnosticada", "posicion": 0}]},
        headers=auth_headers,
    )
    assert r.status_code == 400
    body = r.json()
    msg = str(body.get("message") or body.get("detail") or "").lower()
    assert "bloqueada" in msg


def test_batch_positions_reindexes_columns(auth_headers, db_session):
    from app.models.repair_card import RepairCard

    now = datetime.now(UTC)
    a = RepairCard(
        owner_name="A", problem="P", status="ingresado",
        start_date=now, due_date=now, ingresado_date=now,
        priority="media", position=0,
    )
    b = RepairCard(
        owner_name="B", problem="P", status="ingresado",
        start_date=now, due_date=now, ingresado_date=now,
        priority="media", position=1,
    )
    db_session.add_all([a, b])
    db_session.commit()
    db_session.refresh(a)
    db_session.refresh(b)

    r = client.put(
        "/api/tarjetas/batch/positions",
        json={
            "items": [
                {"id": a.id, "columna": "diagnosticada", "posicion": 0},
                {"id": b.id, "columna": "ingresado", "posicion": 0},
            ]
        },
        headers=auth_headers,
    )
    assert r.status_code == 200

    db_session.refresh(a)
    db_session.refresh(b)
    assert a.status == "diagnosticada"
    assert a.position == 0
    assert b.status == "ingresado"
    assert b.position == 0


def test_batch_positions_rejects_invalid_transition(auth_headers, sample_tarjeta, db_session):
    from app.api.routes.kanban import _ensure_default_columns
    from app.models.kanban import KanbanColumn

    _ensure_default_columns(db_session)
    col = db_session.query(KanbanColumn).filter(KanbanColumn.key == "ingresado").first()
    if col:
        col.allowed_destinations = '["diagnosticada"]'
        db_session.commit()

    r = client.put(
        "/api/tarjetas/batch/positions",
        json={"items": [{"id": sample_tarjeta.id, "columna": "listos", "posicion": 0}]},
        headers=auth_headers,
    )
    assert r.status_code == 400
    msg = str(r.json().get("message") or r.json().get("detail") or "").lower()
    assert "transición" in msg or "permitida" in msg
