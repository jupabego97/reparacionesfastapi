from app.core.database import normalize_database_url


def test_railway_postgres_scheme_uses_psycopg2():
    assert normalize_database_url(
        "postgres://user:pass@host:5432/db"
    ) == "postgresql+psycopg2://user:pass@host:5432/db"


def test_postgresql_scheme_uses_psycopg2():
    assert normalize_database_url(
        "postgresql://user:pass@host/db"
    ) == "postgresql+psycopg2://user:pass@host/db"


def test_explicit_driver_is_kept():
    assert normalize_database_url(
        "postgresql+psycopg://user:pass@host/db"
    ) == "postgresql+psycopg://user:pass@host/db"
    assert normalize_database_url(
        "postgresql+psycopg2://user:pass@host/db"
    ) == "postgresql+psycopg2://user:pass@host/db"


def test_sqlite_is_unchanged():
    assert normalize_database_url("sqlite:///./reparaciones.db") == "sqlite:///./reparaciones.db"
