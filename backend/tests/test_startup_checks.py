from types import SimpleNamespace

import pytest

from app.main import _run_startup_checks


class _DummySession:
    def execute(self, _query):
        return 1

    def close(self):
        return None


def _dummy_session_local():
    return _DummySession()


def test_startup_checks_falla_con_jwt_inseguro_en_produccion(monkeypatch):
    settings = SimpleNamespace(
        is_production=True,
        allow_insecure_jwt_secret=False,
        jwt_secret="change-me-in-production-nanotronics-2024",
    )

    with pytest.raises(RuntimeError, match="JWT_SECRET inseguro en producción"):
        _run_startup_checks(settings)


def test_startup_checks_permite_override_temporal(monkeypatch):
    monkeypatch.setattr("app.core.database.SessionLocal", _dummy_session_local)

    settings = SimpleNamespace(
        is_production=True,
        allow_insecure_jwt_secret=True,
        jwt_secret="change-me-in-production-nanotronics-2024",
    )

    _run_startup_checks(settings)
