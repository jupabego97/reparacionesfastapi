from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from loguru import logger
from sqlalchemy import inspect as sa_inspect
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.user import User
from app.services.auth_service import require_role
from app.services.gemini_service import get_gemini_service
from app.services.storage_service import get_storage_service

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    settings = get_settings()
    services: dict[str, str] = {}
    health_status: dict[str, object] = {
        "status": "healthy",
        "timestamp": datetime.now(UTC).isoformat(),
        "services": services,
        "environment": settings.environment,
    }

    try:
        db.scalar(text("SELECT 1"))
        services["database"] = "healthy"
    except Exception as e:
        logger.error(f"Error en health check de BD: {e}")
        services["database"] = "unhealthy"
        health_status["status"] = "degraded"

    gemini = get_gemini_service()
    services["gemini_ai"] = "healthy" if gemini else "unavailable"

    status_code = 200 if health_status["status"] == "healthy" else 503
    return JSONResponse(content=health_status, status_code=status_code)


@router.get("/health/live")
def liveness():
    return {"status": "alive", "timestamp": datetime.now(UTC).isoformat()}


@router.get("/health/ready")
def readiness(db: Session = Depends(get_db)):
    services: dict[str, str] = {}
    try:
        db.scalar(text("SELECT 1"))
        services["database"] = "ready"
    except Exception as e:
        logger.error(f"Readiness DB failure: {e}")
        services["database"] = "not_ready"
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "timestamp": datetime.now(UTC).isoformat(), "services": services},
        )

    try:
        settings = get_settings()
        if settings.use_s3_storage:
            storage = get_storage_service()
            if storage.use_s3 and getattr(storage, "_client", None):
                services["storage"] = "ready"
            else:
                services["storage"] = "not_ready"
                return JSONResponse(
                    status_code=503,
                    content={"status": "not_ready", "timestamp": datetime.now(UTC).isoformat(), "services": services},
                )
        else:
            services["storage"] = "disabled"
    except Exception as e:
        logger.error(f"Readiness storage failure: {e}")
        services["storage"] = "not_ready"
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "timestamp": datetime.now(UTC).isoformat(), "services": services},
        )

    return {"status": "ready", "timestamp": datetime.now(UTC).isoformat(), "services": services}


@router.post("/health/storage/smoke")
def storage_smoke(
    admin: User = Depends(require_role("admin")),
):
    settings = get_settings()
    if not settings.use_s3_storage:
        raise HTTPException(status_code=400, detail="Storage remoto deshabilitado")
    storage = get_storage_service()
    if not storage.use_s3 or not getattr(storage, "_client", None):
        raise HTTPException(status_code=503, detail="Storage remoto no disponible")

    key = f"healthchecks/smoke-{datetime.now(UTC).strftime('%Y%m%d%H%M%S')}.txt"
    body = f"smoke-by:{admin.username}".encode()
    started = datetime.now(UTC)
    storage._client.put_object(Bucket=storage._bucket, Key=key, Body=body, ContentType="text/plain")
    storage._client.head_object(Bucket=storage._bucket, Key=key)
    storage._client.delete_object(Bucket=storage._bucket, Key=key)
    elapsed_ms = (datetime.now(UTC) - started).total_seconds() * 1000
    return {
        "status": "ok",
        "storage": "R2",
        "bucket": storage._bucket,
        "key": key,
        "latency_ms": round(elapsed_ms, 2),
    }


@router.get("/debug/schema")
def debug_schema(db: Session = Depends(get_db)):
    settings = get_settings()
    if settings.is_production or not settings.expose_debug_schema:
        raise HTTPException(status_code=404, detail="Not found")

    try:
        inspector = sa_inspect(db.get_bind())
        tables = inspector.get_table_names()
        result = {"tables": tables}

        if "repair_cards" in tables:
            cols = inspector.get_columns("repair_cards")
            result["repair_cards_columns"] = [
                {"name": c["name"], "type": str(c["type"])} for c in cols
            ]
            count = db.scalar(text("SELECT COUNT(*) FROM repair_cards"))
            result["repair_cards_count"] = count

        try:
            test = db.execute(text(
                "SELECT id, status, priority, position, assigned_to, estimated_cost, deleted_at "
                "FROM repair_cards LIMIT 1"
            ))
            row = test.fetchone()
            if row:
                result["test_query"] = {k: str(v) for k, v in row._mapping.items()}
            else:
                result["test_query"] = "no rows"
        except Exception as qe:
            result["test_query_error"] = str(qe)

        return JSONResponse(content=result)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)
