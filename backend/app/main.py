import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from starlette.middleware.gzip import GZipMiddleware

from app.core.config import get_settings
from app.core.limiter import limiter
from app.core.logging_config import setup_logging
from app.core.database import engine
from app.models.repair_card import Base
# Importar TODOS los modelos para que se registren con Base.metadata
from app.models import User, KanbanColumn, Tag, SubTask, Comment, Notification, repair_card_tags
from app.api.routes import health, tarjetas, estadisticas, exportar, multimedia
from app.api.routes import auth, kanban as kanban_routes
from app.api.routes.multimedia import executor


def _run_startup_checks(settings) -> None:
    """Checks rápidos de configuración y conectividad para fail-fast."""
    from sqlalchemy import text
    from app.core.database import SessionLocal

    if settings.is_production and settings.jwt_secret == "change-me-in-production-nanotronics-2024":
        raise RuntimeError("JWT_SECRET inseguro en producción. Configura una clave fuerte antes de arrancar.")

    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
    finally:
        db.close()


def _verify_migration_version(settings) -> None:
    """Verifica que la BD esté en la revisión Alembic esperada."""
    if not settings.is_production:
        return

    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from sqlalchemy import inspect, text
    from app.core.database import SessionLocal

    backend_root = Path(__file__).resolve().parents[1]
    alembic_cfg = Config(str(backend_root / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(backend_root / "alembic"))

    script = ScriptDirectory.from_config(alembic_cfg)
    expected_heads = set(script.get_heads())

    db = SessionLocal()
    try:
        inspector = inspect(db.get_bind())
        if "alembic_version" not in inspector.get_table_names():
            raise RuntimeError("Falta tabla alembic_version. Ejecuta migraciones antes de iniciar.")

        current = {row[0] for row in db.execute(text("SELECT version_num FROM alembic_version")) if row[0]}
    finally:
        db.close()

    if current != expected_heads:
        raise RuntimeError(
            f"Migraciones pendientes o desalineadas (db={sorted(current)}, esperadas={sorted(expected_heads)}). "
            "Ejecuta: python -m alembic upgrade head"
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.environment)
    _run_startup_checks(settings)
    _verify_migration_version(settings)

    # En desarrollo permitimos bootstrap automático para acelerar onboarding local.
    if not settings.is_production:
        Base.metadata.create_all(bind=engine)

    # Crear admin por defecto
    from app.core.database import SessionLocal
    from app.services.auth_service import create_default_admin
    db = SessionLocal()
    try:
        create_default_admin(db)
    finally:
        db.close()

    # Corregir secuencia PostgreSQL en producción
    if settings.is_production:
        try:
            from sqlalchemy import text
            db = SessionLocal()
            try:
                dialect = db.get_bind().dialect.name
                if dialect == "postgresql":
                    max_id = db.scalar(text("SELECT MAX(id) FROM repair_cards")) or 0
                    seq = db.scalar(text("SELECT last_value FROM repair_cards_id_seq"))
                    if seq is not None and seq < max_id:
                        db.execute(
                            text("SELECT setval('repair_cards_id_seq', COALESCE((SELECT MAX(id) FROM repair_cards), 1), true);")
                        )
                        db.commit()
            finally:
                db.close()
        except Exception as e:
            import sys
            sys.stderr.write(f"Warning: sequence fix failed: {e}\n")
    yield
    executor.shutdown(wait=True)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Sistema de Reparaciones - API",
        description="API para gestión de reparaciones de dispositivos electrónicos con tablero Kanban profesional",
        version="2.0.0",
        lifespan=lifespan,
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

    @app.exception_handler(500)
    async def handle_500(request: Request, exc: Exception):
        from loguru import logger
        logger.exception("Error interno del servidor")
        return JSONResponse(
            status_code=500,
            content={"error": "Error interno del servidor"},
        )

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        import time
        request.state.start_time = time.time()
        response = await call_next(request)
        elapsed = time.time() - request.state.start_time
        if elapsed > 0.5 and hasattr(request, "url"):
            path = request.url.path
            if "/api/" in path:
                import loguru
                loguru.logger.info(f"[{request_id}] {request.method} {path} {elapsed:.2f}s")
        return response

    origins, origin_regex = settings.get_cors_origins()
    cors_kw: dict = {
        "allow_credentials": True,
        "allow_methods": ["*"],
        "allow_headers": ["*"],
        "expose_headers": ["*"],
    }
    if origin_regex:
        cors_kw["allow_origin_regex"] = origin_regex
        cors_kw["allow_origins"] = origins if isinstance(origins, list) else []
    else:
        cors_kw["allow_origins"] = origins if isinstance(origins, list) else ["*"]
    app.add_middleware(CORSMiddleware, **cors_kw)
    app.add_middleware(GZipMiddleware, minimum_size=500)

    # Registrar todas las rutas
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(tarjetas.router)
    app.include_router(estadisticas.router)
    app.include_router(exportar.router)
    app.include_router(multimedia.router)
    app.include_router(kanban_routes.router)

    return app


app = create_app()
