from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text
from loguru import logger

from app.core.database import get_db
from app.core.config import get_settings
from app.services.gemini_service import get_gemini_service

router = APIRouter(tags=["health"])


@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    health_status = {
        "status": "healthy",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": {},
    }

    try:
        db.scalar(text("SELECT 1"))
        health_status["services"]["database"] = "healthy"
    except Exception as e:
        logger.error(f"Error en health check de BD: {e}")
        health_status["services"]["database"] = "unhealthy"
        health_status["status"] = "degraded"

    gemini = get_gemini_service()
    health_status["services"]["gemini_ai"] = "healthy" if gemini else "unavailable"

    status_code = 200 if health_status["status"] == "healthy" else 503
    return JSONResponse(content=health_status, status_code=status_code)
