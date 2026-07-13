"""Tests for card audit IP tracking."""
import pytest
from fastapi import Request
from tests.conftest import client

from app.models.kanban import KanbanColumn
from app.models.repair_card import StatusHistory
from app.services.audit_service import get_client_ip, is_valid_ip, record_card_audit


def _make_request(headers: dict | None = None, client_host: str = "127.0.0.1") -> Request:
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
        "client": (client_host, 12345),
        "server": ("testserver", 80),
        "scheme": "http",
        "http_version": "1.1",
    }
    return Request(scope)


class TestClientIpExtraction:
    def test_direct_client_ip(self):
        req = _make_request(client_host="192.168.1.50")
        assert get_client_ip(req) == "192.168.1.50"

    def test_x_forwarded_for_first_valid_ip(self):
        req = _make_request(
            headers={"X-Forwarded-For": "203.0.113.10, 10.0.0.5, 172.16.0.2"},
            client_host="127.0.0.1",
        )
        assert get_client_ip(req) == "203.0.113.10"

    def test_x_forwarded_for_skips_invalid_entries(self):
        req = _make_request(
            headers={"X-Forwarded-For": "not-an-ip, 198.51.100.7"},
            client_host="127.0.0.1",
        )
        assert get_client_ip(req) == "198.51.100.7"

    def test_invalid_ip_rejected(self):
        assert is_valid_ip("999.999.999.999") is False
        assert is_valid_ip("abc") is False
        assert is_valid_ip("203.0.113.10") is True


class TestCardAuditRecording:
    @pytest.fixture(autouse=True)
    def _seed_columns(self, db_session):
        for key, title in [
            ("ingresado", "Ingresado"),
            ("diagnosticada", "Diagnosticada"),
            ("para_entregar", "Para entregar"),
            ("listos", "Listos"),
        ]:
            db_session.add(KanbanColumn(key=key, title=title, color="#000", icon="x", position=0))
        db_session.commit()

    def test_create_tarjeta_records_ip(self, auth_headers):
        res = client.post(
            "/api/tarjetas",
            json={"nombre_propietario": "Cliente IP", "problema": "Test"},
            headers={**auth_headers, "X-Forwarded-For": "203.0.113.44"},
        )
        assert res.status_code == 201
        card_id = res.json()["id"]

        hist = client.get(f"/api/tarjetas/{card_id}/historial", headers=auth_headers)
        assert hist.status_code == 200
        events = hist.json()
        assert len(events) >= 1
        created = next(e for e in events if e["action"] == "created")
        assert created["client_ip"] == "203.0.113.44"

    def test_update_tarjeta_records_ip(self, auth_headers, sample_tarjeta):
        res = client.put(
            f"/api/tarjetas/{sample_tarjeta.id}",
            json={"problema": "Pantalla actualizada"},
            headers={**auth_headers, "X-Forwarded-For": "198.51.100.22"},
        )
        assert res.status_code == 200

        hist = client.get(f"/api/tarjetas/{sample_tarjeta.id}/historial", headers=auth_headers)
        updated = next(e for e in hist.json() if e["action"] == "updated")
        assert updated["client_ip"] == "198.51.100.22"
        assert "problema" in (updated.get("details") or "")

    def test_move_tarjeta_records_ip(self, auth_headers, sample_tarjeta, db_session):
        sample_tarjeta.problem = "Con diagnostico"
        sample_tarjeta.whatsapp_number = "5551234567"
        db_session.commit()

        res = client.put(
            f"/api/tarjetas/{sample_tarjeta.id}",
            json={"columna": "diagnosticada"},
            headers={**auth_headers, "X-Forwarded-For": "203.0.113.99"},
        )
        assert res.status_code == 200

        hist = client.get(f"/api/tarjetas/{sample_tarjeta.id}/historial", headers=auth_headers)
        moved = next(e for e in hist.json() if e["action"] == "status_changed")
        assert moved["client_ip"] == "203.0.113.99"
        assert moved["old_status"] == "ingresado"
        assert moved["new_status"] == "diagnosticada"

    def test_block_tarjeta_records_ip(self, auth_headers, sample_tarjeta):
        res = client.patch(
            f"/api/tarjetas/{sample_tarjeta.id}/block",
            json={"blocked": True, "reason": "Esperando repuesto"},
            headers={**auth_headers, "X-Forwarded-For": "10.20.30.40"},
        )
        assert res.status_code == 200

        hist = client.get(f"/api/tarjetas/{sample_tarjeta.id}/historial", headers=auth_headers)
        blocked = next(e for e in hist.json() if e["action"] == "blocked")
        assert blocked["client_ip"] == "10.20.30.40"
        assert blocked["details"] == "Esperando repuesto"

    def test_record_card_audit_rejects_invalid_ip(self, db_session, sample_tarjeta, admin_user):
        user, _ = admin_user
        record_card_audit(
            db_session,
            tarjeta_id=sample_tarjeta.id,
            action="updated",
            new_status=sample_tarjeta.status,
            client_ip="not-valid",
            user=user,
        )
        db_session.commit()
        entry = db_session.query(StatusHistory).order_by(StatusHistory.id.desc()).first()
        assert entry.client_ip is None
