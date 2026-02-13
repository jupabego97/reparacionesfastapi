import uuid
from contextlib import asynccontextmanager

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

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.environment)
    # Crear tablas NUEVAS si no existen (no altera columnas en tablas existentes)
    Base.metadata.create_all(bind=engine)
    # Migrar columnas faltantes en tablas existentes
    _auto_migrate_columns()
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


def _auto_migrate_columns():
    """Añade columnas faltantes a tablas existentes (PostgreSQL: IF NOT EXISTS)."""
    from sqlalchemy import text, inspect
    from app.core.database import SessionLocal
    from loguru import logger

    db = SessionLocal()
    try:
        dialect = db.get_bind().dialect.name
        inspector = inspect(db.get_bind())

        # Solo migrar si la tabla repair_cards existe
        if "repair_cards" not in inspector.get_table_names():
            logger.info("repair_cards table does not exist yet, skipping migration")
            return

        existing = {c["name"] for c in inspector.get_columns("repair_cards")}
        logger.info(f"Existing columns: {sorted(existing)}")

        # Renombrar columnas mal nombradas de deploys anteriores
        renames = [
            ("prioridad", "priority"),
            ("asignado_nombre", "assigned_name"),
            ("costo_estimado", "estimated_cost"),
            ("costo_final", "final_cost"),
            ("notas_costo", "cost_notes"),
        ]
        if dialect == "postgresql":
            for old_name, new_name in renames:
                if old_name in existing and new_name not in existing:
                    # Rename old to new
                    db.execute(text(f"ALTER TABLE repair_cards RENAME COLUMN {old_name} TO {new_name}"))
                    existing.discard(old_name)
                    existing.add(new_name)
                    logger.info(f"Renamed column: {old_name} -> {new_name}")
                elif old_name in existing and new_name in existing:
                    # Both exist — drop the old duplicate
                    db.execute(text(f"ALTER TABLE repair_cards DROP COLUMN {old_name}"))
                    existing.discard(old_name)
                    logger.info(f"Dropped duplicate column: {old_name} (keeping {new_name})")

        # Agregar columnas faltantes
        migrations = [
            ("priority", "VARCHAR(20) DEFAULT 'media'"),
            ("position", "INTEGER DEFAULT 0"),
            ("assigned_to", "INTEGER"),
            ("assigned_name", "VARCHAR(200)"),
            ("estimated_cost", "DOUBLE PRECISION" if dialect == "postgresql" else "FLOAT"),
            ("final_cost", "DOUBLE PRECISION" if dialect == "postgresql" else "FLOAT"),
            ("cost_notes", "TEXT"),
            ("deleted_at", "TIMESTAMP"),
        ]

        for col_name, col_type in migrations:
            if col_name not in existing:
                try:
                    if dialect == "postgresql":
                        db.execute(text(f"ALTER TABLE repair_cards ADD COLUMN IF NOT EXISTS {col_name} {col_type}"))
                    else:
                        db.execute(text(f"ALTER TABLE repair_cards ADD COLUMN {col_name} {col_type}"))
                    logger.info(f"Added column: repair_cards.{col_name} ({col_type})")
                except Exception as col_err:
                    logger.warning(f"Could not add column {col_name}: {col_err}")

        db.commit()
        # Verify
        updated = {c["name"] for c in inspector.get_columns("repair_cards")}
        logger.info(f"Migration done. Columns now: {sorted(updated)}")
    except Exception as e:
        logger.error(f"Auto-migration error: {e}")
        db.rollback()
    finally:
        db.close()


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
