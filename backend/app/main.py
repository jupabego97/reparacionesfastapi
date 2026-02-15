import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from starlette.middleware.gzip import GZipMiddleware

from app.api.routes import auth, estadisticas, exportar, health, multimedia, tarjetas
from app.api.routes import kanban as kanban_routes
from app.api.routes import users as users_routes
from app.api.routes.multimedia import executor
from app.core.config import get_settings
from app.core.database import Base, SessionLocal, engine
from app.core.errors import default_code_for_status
from app.core.limiter import limiter
from app.core.logging_config import setup_logging
from app.models import (  # noqa: F401 — register all models with Base.metadata
    Comment,
    KanbanColumn,
    Notification,
    RepairCard,
    RepairCardMedia,
    StatusHistory,
    SubTask,
    Tag,
    User,
    UserPreference,
    repair_card_tags,
)
from app.models.kanban import CardTemplate  # noqa: F401


def _setup_observability(app: FastAPI, settings) -> None:
    if settings.sentry_dsn:
        try:
            import sentry_sdk
            from sentry_sdk.integrations.fastapi import FastApiIntegration

            sentry_sdk.init(
                dsn=settings.sentry_dsn,
                traces_sample_rate=settings.sentry_traces_sample_rate,
                environment=settings.environment,
                integrations=[FastApiIntegration()],
            )
        except Exception as e:
            logger.warning(f"Sentry initialization failed: {e}")

    if settings.enable_prometheus_metrics:
        try:
            from prometheus_fastapi_instrumentator import Instrumentator

            Instrumentator().instrument(app).expose(app, include_in_schema=False, endpoint="/metrics")
        except Exception as e:
            logger.warning(f"Prometheus instrumentation failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.environment)
    if settings.is_production and settings.is_default_jwt_secret:
        raise RuntimeError("JWT_SECRET inseguro en producción. Configure un valor fuerte en entorno.")

    # Crear tablas nuevas automáticamente solo en entornos no productivos
    if not settings.is_production:
        Base.metadata.create_all(bind=engine)

    # Crear admin por defecto
    db = SessionLocal()
    try:
        if settings.create_default_admin_on_boot and not settings.is_production:
            from app.services.auth_service import create_default_admin
            create_default_admin(db)
    finally:
        db.close()

    # Corregir secuencia PostgreSQL en producción
    if settings.is_production:
        _fix_postgresql_sequence()

    yield
    executor.shutdown(wait=True)


def _fix_postgresql_sequence() -> None:
    """Fix PostgreSQL sequence if it's behind the max ID."""
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
        logger.warning(f"Sequence fix failed: {e}")


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

    @app.exception_handler(HTTPException)
    async def handle_http_exception(request: Request, exc: HTTPException):
        request_id = getattr(request.state, "request_id", "unknown")
        if isinstance(exc.detail, dict) and "code" in exc.detail and "message" in exc.detail:
            payload = exc.detail
            code = payload.get("code")
            message = payload.get("message")
            details = payload.get("details")
        else:
            code = default_code_for_status(exc.status_code)
            message = str(exc.detail) if exc.detail else "Error"
            details = None
        return JSONResponse(
            status_code=exc.status_code,
            content={"code": code, "message": message, "details": details, "request_id": request_id},
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError):
        request_id = getattr(request.state, "request_id", "unknown")
        return JSONResponse(
            status_code=422,
            content={
                "code": "validation_error",
                "message": "Solicitud inválida",
                "details": {"errors": exc.errors()},
                "request_id": request_id,
            },
        )

    @app.exception_handler(Exception)
    async def handle_500(request: Request, exc: Exception):
        logger.exception("Error interno del servidor")
        request_id = getattr(request.state, "request_id", "unknown")
        return JSONResponse(
            status_code=500,
            content={
                "code": "internal_error",
                "message": "Error interno del servidor",
                "details": None,
                "request_id": request_id,
            },
        )

    @app.middleware("http")
    async def request_id_middleware(request: Request, call_next):
        request_id = str(uuid.uuid4())[:8]
        request.state.request_id = request_id
        request.state.start_time = time.time()
        response = await call_next(request)
        elapsed = time.time() - request.state.start_time
        if elapsed > 0.5 and hasattr(request, "url"):
            path = request.url.path
            if "/api/" in path:
                logger.info(f"[{request_id}] {request.method} {path} {elapsed:.2f}s")
        response.headers["X-Request-ID"] = request_id
        if settings.is_production:
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["X-Frame-Options"] = "DENY"
            response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
            response.headers["Content-Security-Policy"] = "default-src 'self'; img-src 'self' data: https:; connect-src 'self' https: wss:;"
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
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
    _setup_observability(app, settings)

    # Registrar todas las rutas
    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(tarjetas.router)
    app.include_router(estadisticas.router)
    app.include_router(exportar.router)
    app.include_router(multimedia.router)
    app.include_router(kanban_routes.router)
    app.include_router(users_routes.router)

    from app.api.routes import actividad, metricas, plantillas
    app.include_router(metricas.router)
    app.include_router(actividad.router)
    app.include_router(plantillas.router)

    return app


app = create_app()
