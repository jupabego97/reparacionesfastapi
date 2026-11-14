from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import get_settings


def normalize_database_url(url: str) -> str:
    """Railway entrega `postgres://`. SQLAlchemy 2.1 trata `postgresql://` como psycopg3.

    Este proyecto instala psycopg2-binary, así que fijamos ese dialecto salvo que
    la URL ya declare otro (`postgresql+psycopg://`, `postgresql+asyncpg://`, …).
    """
    raw = (url or "").strip()
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://"):]
    if raw.startswith("postgresql://"):
        raw = "postgresql+psycopg2://" + raw[len("postgresql://"):]
    return raw


def get_database_url() -> str:
    return normalize_database_url(get_settings().database_url)


def create_db_engine():
    url = get_database_url()
    if url.startswith("sqlite"):
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    return create_engine(
        url,
        pool_size=10,
        pool_recycle=3600,
        pool_pre_ping=True,
        max_overflow=20,
    )


engine = create_db_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
