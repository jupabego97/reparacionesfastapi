import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app.core.config import get_settings
from app.core.limiter import limiter
from app.core.logging_config import setup_logging
from app.core.database import engine
from app.models.repair_card import Base
from app.api.routes import health, tarjetas, estadisticas, exportar, multimedia
from app.api.routes.multimedia import executor

@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    setup_logging(settings.environment)
    # Crear tablas si no existen
    Base.metadata.create_all(bind=engine)
    # Corregir secuencia PostgreSQL en producción
    if settings.is_production:
        try:
            from sqlalchemy import text
            from app.core.database import SessionLocal
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
        description="API para gestión de reparaciones de dispositivos electrónicos",
        version="1.0.0",
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
            if path in ("/api/tarjetas", "/api/estadisticas", "/api/procesar-imagen"):
                import loguru
                loguru.logger.info(f"[{request_id}] {request.method} {path} {elapsed:.2f}s")
        return response

    origins = settings.get_cors_origins()
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins if isinstance(origins, list) else ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health.router)
    app.include_router(tarjetas.router)
    app.include_router(estadisticas.router)
    app.include_router(exportar.router)
    app.include_router(multimedia.router)

    return app


app = create_app()
