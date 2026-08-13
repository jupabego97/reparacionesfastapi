"""Tests for technician performance metrics filtered by Colombia day."""
from datetime import UTC, datetime, timedelta

import pytest
from app.models.kanban import Comment, KanbanColumn
from app.models.repair_card import RepairCard, StatusHistory
from app.models.user import User
from app.services.audit_service import ACTION_BLOCKED, ACTION_STATUS_CHANGED, ACTION_UNBLOCKED
from app.services.auth_service import hash_password
from app.services.desempeno_service import (
    DateRangeError,
    blocked_seconds,
    colombia_today,
    day_bounds_utc,
    is_rework,
    parse_iso_date,
    percentile,
    resolve_date_range,
)

from tests.conftest import client


def _dt(value: str) -> datetime:
    return datetime.fromisoformat(value).replace(tzinfo=UTC)


def _seed_columns(db_session):
    for idx, (key, title) in enumerate([
        ("ingresado", "Ingresado"),
        ("diagnosticada", "En Diagnóstico"),
        ("para_entregar", "Listos para Entregar"),
        ("listos", "Completados"),
    ]):
        db_session.add(KanbanColumn(key=key, title=title, color="#000", icon="x", position=idx))
    db_session.commit()


def _add_user(db_session, username: str, full_name: str, role: str = "tecnico") -> User:
    user = User(
        username=username,
        email=f"{username}@test.com",
        hashed_password=hash_password("secret123"),
        full_name=full_name,
        role=role,
        avatar_color="#00ACC1",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


def _add_card(db_session, owner: str, assigned_to: int | None = None, assigned_name: str | None = None) -> RepairCard:
    now = datetime.now(UTC)
    card = RepairCard(
        owner_name=owner,
        problem="No enciende",
        status="ingresado",
        start_date=now,
        due_date=now,
        ingresado_date=now,
        has_charger="si",
        priority="media",
        position=0,
        assigned_to=assigned_to,
        assigned_name=assigned_name,
        technical_notes="Cambio de fuente",
        final_cost=150000,
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    return card


def _add_event(
    db_session,
    card: RepairCard,
    *,
    changed_at: datetime,
    new_status: str,
    old_status: str | None = None,
    action: str = ACTION_STATUS_CHANGED,
    user: User | None = None,
):
    db_session.add(StatusHistory(
        tarjeta_id=card.id,
        action=action,
        old_status=old_status,
        new_status=new_status,
        changed_at=changed_at.replace(tzinfo=None) if changed_at.tzinfo else changed_at,
        changed_by=user.id if user else None,
        changed_by_name=user.full_name if user else None,
    ))
    db_session.commit()


class TestDateHelpers:
    def test_parse_and_range_single_day(self):
        start, end = resolve_date_range("2026-08-12", None, None)
        assert start.isoformat() == "2026-08-12"
        assert end == start

    def test_range_from_bounds(self):
        start, end = resolve_date_range(None, "2026-08-01", "2026-08-12")
        assert start.isoformat() == "2026-08-01"
        assert end.isoformat() == "2026-08-12"

    def test_invalid_range_raises(self):
        with pytest.raises(DateRangeError):
            resolve_date_range(None, "2026-08-12", "2026-08-01")

    def test_invalid_date_raises(self):
        with pytest.raises(DateRangeError):
            parse_iso_date("12-08-2026")

    def test_colombia_day_bounds_cover_utc_offset(self):
        start, end = day_bounds_utc(datetime(2026, 8, 12, tzinfo=UTC).date())
        assert start == _dt("2026-08-12T05:00:00")
        assert end == _dt("2026-08-13T05:00:00")

    def test_colombia_today_uses_bogota(self):
        # 2026-08-13 03:30 UTC is still Aug 12 in Colombia (UTC-5)
        assert colombia_today(_dt("2026-08-13T03:30:00")).isoformat() == "2026-08-12"

    def test_percentile_and_rework(self):
        assert percentile([10, 20, 30], 0.5) == 20
        assert is_rework("para_entregar", "diagnosticada", {"ingresado": 0, "diagnosticada": 1, "para_entregar": 2})
        assert not is_rework("ingresado", "diagnosticada", {"ingresado": 0, "diagnosticada": 1})


class TestBlockedSeconds:
    def test_subtracts_blocked_interval(self):
        start = _dt("2026-08-12T10:00:00")
        end = _dt("2026-08-12T16:00:00")
        events = [
            StatusHistory(action=ACTION_BLOCKED, new_status="diagnosticada", changed_at=start + timedelta(hours=1)),
            StatusHistory(action=ACTION_UNBLOCKED, new_status="diagnosticada", changed_at=start + timedelta(hours=3)),
        ]
        assert blocked_seconds(events, start, end) == 2 * 3600


class TestDesempenoEndpoint:
    def test_requires_auth(self):
        r = client.get("/api/metricas/desempeno?fecha=2026-08-12")
        assert r.status_code == 401

    def test_rejects_invalid_date(self, auth_headers):
        r = client.get("/api/metricas/desempeno?fecha=12/08/2026", headers=auth_headers)
        assert r.status_code == 400

    def test_filters_by_colombia_day(self, db_session, auth_headers, tech_user):
        _seed_columns(db_session)
        tech, _token = tech_user
        card = _add_card(db_session, "Cliente Día", assigned_to=tech.id, assigned_name=tech.full_name)

        # 23:30 Colombia on Aug 12 => 04:30 UTC Aug 13, still Aug 12 local
        _add_event(
            db_session, card,
            changed_at=_dt("2026-08-13T04:30:00"),
            old_status="ingresado",
            new_status="diagnosticada",
            user=tech,
        )
        # 00:30 Colombia on Aug 13 => 05:30 UTC Aug 13, next day
        _add_event(
            db_session, card,
            changed_at=_dt("2026-08-13T05:30:00"),
            old_status="diagnosticada",
            new_status="para_entregar",
            user=tech,
        )

        r = client.get("/api/metricas/desempeno?fecha=2026-08-12", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        assert data["zona"] == "America/Bogota"
        assert data["desde"] == "2026-08-12"
        assert data["hasta"] == "2026-08-12"
        assert data["dias"] == 1
        tech_row = next(item for item in data["tecnicos"] if item["id"] == tech.id)
        assert tech_row["diagnosticadas"] == 1
        assert tech_row["reparadas"] == 0
        assert data["por_dia"][0]["diagnosticadas"] == 1
        assert data["por_dia"][0]["reparadas"] == 0

        r2 = client.get("/api/metricas/desempeno?fecha=2026-08-13", headers=auth_headers)
        tech_row2 = next(item for item in r2.json()["tecnicos"] if item["id"] == tech.id)
        assert tech_row2["diagnosticadas"] == 0
        assert tech_row2["reparadas"] == 1

    def test_counts_throughput_rework_and_notes(self, db_session, auth_headers, tech_user):
        _seed_columns(db_session)
        tech, _token = tech_user
        card = _add_card(db_session, "PC Gamer", assigned_to=tech.id, assigned_name=tech.full_name)
        day_start = _dt("2026-08-12T14:00:00")
        _add_event(db_session, card, changed_at=day_start, old_status=None, new_status="ingresado", action="created", user=tech)
        _add_event(db_session, card, changed_at=day_start + timedelta(hours=1), old_status="ingresado", new_status="diagnosticada", user=tech)
        _add_event(db_session, card, changed_at=day_start + timedelta(hours=3), old_status="diagnosticada", new_status="para_entregar", user=tech)
        _add_event(db_session, card, changed_at=day_start + timedelta(hours=4), old_status="para_entregar", new_status="diagnosticada", user=tech)
        _add_event(db_session, card, changed_at=day_start + timedelta(hours=5), old_status="diagnosticada", new_status="para_entregar", user=tech)
        _add_event(db_session, card, changed_at=day_start + timedelta(hours=6), old_status="para_entregar", new_status="listos", user=tech)

        r = client.get("/api/metricas/desempeno?fecha=2026-08-12", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        tech_row = next(item for item in data["tecnicos"] if item["id"] == tech.id)
        assert tech_row["diagnosticadas"] == 2
        assert tech_row["reparadas"] == 2
        assert tech_row["entregadas"] == 1
        assert tech_row["retrabajo"] == 1
        assert tech_row["con_notas_tecnicas"] == 2
        assert tech_row["tasa_notas_tecnicas"] == 100.0
        assert data["resumen"]["entregadas"] == 1
        assert tech_row["tiempo_ciclo_mediana_horas"] == 6.0
        assert tech_row["cierres"] == []

        detail = client.get(
            f"/api/metricas/desempeno?fecha=2026-08-12&include_cierres=true&tecnico_id={tech.id}",
            headers=auth_headers,
        )
        assert detail.status_code == 200
        detail_row = next(item for item in detail.json()["tecnicos"] if item["id"] == tech.id)
        assert len(detail_row["cierres"]) == 1
        assert detail_row["cierres"][0]["cliente"] == "PC Gamer"

    def test_excludes_blocked_time_from_cycle(self, db_session, auth_headers, tech_user):
        _seed_columns(db_session)
        tech, _token = tech_user
        card = _add_card(db_session, "Espera repuesto", assigned_to=tech.id, assigned_name=tech.full_name)
        t0 = _dt("2026-08-12T12:00:00")
        _add_event(db_session, card, changed_at=t0, old_status=None, new_status="ingresado", action="created", user=tech)
        _add_event(db_session, card, changed_at=t0 + timedelta(hours=1), old_status="ingresado", new_status="diagnosticada", user=tech)
        _add_event(db_session, card, changed_at=t0 + timedelta(hours=2), old_status="diagnosticada", new_status="diagnosticada", action=ACTION_BLOCKED, user=tech)
        _add_event(db_session, card, changed_at=t0 + timedelta(hours=6), old_status="diagnosticada", new_status="diagnosticada", action=ACTION_UNBLOCKED, user=tech)
        _add_event(db_session, card, changed_at=t0 + timedelta(hours=7), old_status="diagnosticada", new_status="para_entregar", user=tech)
        _add_event(db_session, card, changed_at=t0 + timedelta(hours=8), old_status="para_entregar", new_status="listos", user=tech)

        r = client.get("/api/metricas/desempeno?fecha=2026-08-12", headers=auth_headers)
        tech_row = next(item for item in r.json()["tecnicos"] if item["id"] == tech.id)
        assert tech_row["bloqueos"] == 1
        assert tech_row["desbloqueos"] == 1
        # 8h raw - 4h blocked = 4h
        assert tech_row["tiempo_ciclo_mediana_horas"] == 4.0

    def test_filters_by_technician_and_range(self, db_session, auth_headers, tech_user):
        _seed_columns(db_session)
        tech, _token = tech_user
        other = _add_user(db_session, "otro", "Otro Tecnico")
        card_a = _add_card(db_session, "Equipo A", assigned_to=tech.id, assigned_name=tech.full_name)
        card_b = _add_card(db_session, "Equipo B", assigned_to=other.id, assigned_name=other.full_name)
        _add_event(
            db_session, card_a,
            changed_at=_dt("2026-08-12T15:00:00"),
            old_status="diagnosticada",
            new_status="para_entregar",
            user=tech,
        )
        _add_event(
            db_session, card_b,
            changed_at=_dt("2026-08-13T15:00:00"),
            old_status="diagnosticada",
            new_status="para_entregar",
            user=other,
        )
        db_session.add(Comment(
            tarjeta_id=card_a.id,
            user_id=tech.id,
            author_name=tech.full_name,
            content="Diagnóstico listo",
            created_at=_dt("2026-08-12T16:00:00").replace(tzinfo=None),
        ))
        db_session.commit()

        r = client.get(
            f"/api/metricas/desempeno?desde=2026-08-12&hasta=2026-08-13&tecnico_id={tech.id}",
            headers=auth_headers,
        )
        assert r.status_code == 200
        data = r.json()
        assert data["dias"] == 2
        assert len(data["por_dia"]) == 2
        assert [item["id"] for item in data["tecnicos"]] == [tech.id]
        tech_row = data["tecnicos"][0]
        assert tech_row["reparadas"] == 1
        assert tech_row["comentarios"] == 1
        assert data["resumen"]["reparadas"] == 1
