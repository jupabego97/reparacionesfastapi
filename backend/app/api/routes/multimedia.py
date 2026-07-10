"""Endpoints de multimedia / IA (Gemini)."""

import asyncio
import concurrent.futures
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from google.genai.errors import APIError, ClientError, ServerError
from loguru import logger
from pydantic import BaseModel, Field

from app.core.limiter import limiter
from app.models.user import User
from app.services.auth_service import get_current_user
from app.services.gemini_service import FALLBACK_IA, get_gemini_service

router = APIRouter(prefix="/api", tags=["multimedia"])

executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)

# Timeout de la llamada a Gemini (imagen/audio). Alineado con el cliente (~15s).
GEMINI_TIMEOUT_SECONDS = 15


class ProcesarImagenBody(BaseModel):
    image: str = Field(..., min_length=1)


def _ia_unavailable_response() -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={
            "error": "Servicio de IA no disponible",
            **FALLBACK_IA,
            "_partial": True,
        },
    )


def _partial_ia_response(
    status_code: int,
    error_message: str,
) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={
            "error": error_message,
            **FALLBACK_IA,
            "_partial": True,
        },
    )


def _gemini_error_status(exc: Exception) -> tuple[int, str]:
    """Mapea excepciones de Gemini a código HTTP y mensaje amigable."""
    if isinstance(exc, ClientError):
        code = int(getattr(exc, "code", 400) or 400)
        if code == 429:
            return 429, "Cuota de IA agotada. Completa los datos manualmente."
        if code in (401, 403):
            return 503, "Servicio de IA no configurado correctamente."
        if code == 408:
            return 408, "La IA tardó demasiado. Completa los datos manualmente."
        return 500, "Error procesando la imagen"
    if isinstance(exc, ServerError):
        return 503, "Servicio de IA temporalmente no disponible."
    if isinstance(exc, APIError):
        code = int(getattr(exc, "code", 500) or 500)
        if code == 429:
            return 429, "Cuota de IA agotada. Completa los datos manualmente."
        if 500 <= code < 600:
            return 503, "Servicio de IA temporalmente no disponible."
        return 500, "Error procesando la imagen"
    return 500, "Error procesando la imagen"


@router.post("/procesar-imagen")
@limiter.limit("15 per minute")
async def procesar_imagen(
    request: Request,
    data: ProcesarImagenBody,
    _user: User = Depends(get_current_user),
):
    gemini = get_gemini_service()
    if not gemini:
        logger.warning("Intento de procesamiento sin Gemini disponible")
        return _ia_unavailable_response()

    try:
        loop = asyncio.get_running_loop()
        result = await asyncio.wait_for(
            loop.run_in_executor(executor, gemini.extract_client_info_from_image, data.image),
            timeout=GEMINI_TIMEOUT_SECONDS,
        )
        if not isinstance(result, dict):
            logger.error(f"Resultado inesperado de Gemini: {type(result)}")
            return _partial_ia_response(500, "Respuesta inválida del servicio de IA")
        return {
            "nombre": str(result.get("nombre") or "Cliente"),
            "telefono": str(result.get("telefono") or ""),
            "tiene_cargador": bool(result.get("tiene_cargador", False)),
        }
    except asyncio.TimeoutError:
        logger.warning("Timeout procesando imagen con Gemini")
        return _partial_ia_response(
            408,
            "La IA tardó demasiado. Completa los datos manualmente.",
        )
    except Exception as e:
        logger.exception(f"Error procesando imagen: {e}")
        status_code, message = _gemini_error_status(e)
        return _partial_ia_response(status_code, message)


@router.post("/transcribir-audio")
@limiter.limit("15 per minute")
async def transcribir_audio(
    request: Request,
    audio: UploadFile = File(...),
    _user: User = Depends(get_current_user),
):
    gemini = get_gemini_service()
    if not gemini:
        raise HTTPException(status_code=503, detail="Servicio de IA no disponible")
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No se proporcionó archivo de audio")
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Archivo de audio vacío")
    mime = audio.content_type or "audio/wav"
    try:
        loop = asyncio.get_running_loop()
        transcripcion = await asyncio.wait_for(
            loop.run_in_executor(executor, lambda: gemini.transcribe_audio(data, mime_type=mime)),
            timeout=GEMINI_TIMEOUT_SECONDS,
        )
        return {"transcripcion": transcripcion}
    except asyncio.TimeoutError as err:
        raise HTTPException(status_code=408, detail="Timeout procesando audio") from err
    except ClientError as e:
        code = int(getattr(e, "code", 400) or 400)
        if code == 429:
            raise HTTPException(status_code=429, detail="Cuota de IA agotada") from e
        raise HTTPException(status_code=500, detail="Error al transcribir audio") from e
    except ServerError as e:
        raise HTTPException(status_code=503, detail="Servicio de IA no disponible") from e
    except Exception as e:
        raise HTTPException(status_code=500, detail="Error al transcribir audio") from e


class ProcesarMultimediaBody(BaseModel):
    image: str = Field(..., min_length=1)
    audio: Optional[str] = None


@router.post("/procesar-multimedia")
@limiter.limit("15 per minute")
async def procesar_multimedia(
    request: Request,
    data: ProcesarMultimediaBody,
    _user: User = Depends(get_current_user),
):
    gemini = get_gemini_service()
    if not gemini:
        raise HTTPException(status_code=503, detail="Servicio de IA no disponible")

    loop = asyncio.get_running_loop()

    async def run_image():
        return await asyncio.wait_for(
            loop.run_in_executor(executor, gemini.extract_client_info_from_image, data.image),
            timeout=GEMINI_TIMEOUT_SECONDS,
        )

    if not data.audio:
        try:
            resultado_imagen = await run_image()
            return {"imagen": resultado_imagen, "audio": {"error": "No se proporcionó audio"}}
        except asyncio.TimeoutError as err:
            raise HTTPException(status_code=408, detail="Timeout") from err

    def task_audio():
        return gemini.transcribe_audio(data.audio)

    try:
        resultado_imagen, resultado_audio = await asyncio.wait_for(
            asyncio.gather(
                run_image(),
                asyncio.wait_for(
                    loop.run_in_executor(executor, task_audio),
                    timeout=GEMINI_TIMEOUT_SECONDS,
                ),
            ),
            timeout=GEMINI_TIMEOUT_SECONDS + 5,
        )
        return {"imagen": resultado_imagen, "audio": resultado_audio}
    except asyncio.TimeoutError as err:
        raise HTTPException(status_code=408, detail="Timeout") from err
