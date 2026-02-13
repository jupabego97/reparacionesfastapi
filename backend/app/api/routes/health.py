from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from sqlalchemy import text, inspect as sa_inspect
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


@router.get("/debug/schema")
def debug_schema(db: Session = Depends(get_db)):
    """Endpoint temporal para diagnosticar estructura de BD."""
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

        # Test the exact query the tarjetas endpoint uses
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
