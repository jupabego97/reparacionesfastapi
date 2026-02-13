import base64
import concurrent.futures
from typing import Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from loguru import logger

from app.core.limiter import limiter
from app.services.gemini_service import get_gemini_service

router = APIRouter(prefix="/api", tags=["multimedia"])

executor = concurrent.futures.ThreadPoolExecutor(max_workers=4)

FALLBACK_IA = {
    "nombre": "Cliente",
    "telefono": "",
    "tiene_cargador": False,
}


class ProcesarImagenBody(BaseModel):
    image: str


@router.post("/procesar-imagen")
@limiter.limit("5 per minute")
def procesar_imagen(request: Request, data: ProcesarImagenBody):
    gemini = get_gemini_service()
    if not gemini:
        logger.warning("Intento de procesamiento sin Gemini disponible")
        return JSONResponse(
            status_code=503,
            content={
                "error": "Servicio de IA no disponible",
                **FALLBACK_IA,
                "_debug": "Gemini no está configurado o no está disponible",
            },
        )
    image_data = data.image
    if not image_data:
        raise HTTPException(status_code=400, detail="No se proporcionó imagen")
    try:
        result = gemini.extract_client_info_from_image(image_data)
        if not isinstance(result, dict):
            logger.error(f"Resultado inesperado de Gemini: {type(result)}")
            return JSONResponse(
                status_code=500,
                content={
                    "error": "Respuesta inválida del servicio de IA",
                    **FALLBACK_IA,
                },
            )
        result.setdefault("nombre", "Cliente")
        result.setdefault("telefono", "")
        result.setdefault("tiene_cargador", False)
        return result
    except Exception as e:
        logger.exception(f"Error procesando imagen: {e}")
        return JSONResponse(
            status_code=500,
            content={
                "error": "Error procesando la imagen",
                "details": str(e),
                **FALLBACK_IA,
                "_debug": f"Error en servidor: {str(e)}",
            },
        )


@router.post("/transcribir-audio")
@limiter.limit("5 per minute")
async def transcribir_audio(request: Request, audio: UploadFile = File(...)):
    gemini = get_gemini_service()
    if not gemini:
        raise HTTPException(status_code=503, detail="Servicio de IA no disponible")
    if not audio.filename:
        raise HTTPException(status_code=400, detail="No se proporcionó archivo de audio")
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="Archivo de audio vacío")
    try:
        transcripcion = executor.submit(gemini.transcribe_audio, data).result(timeout=30)
        return {"transcripcion": transcripcion}
    except concurrent.futures.TimeoutError:
        raise HTTPException(status_code=408, detail="Timeout procesando audio")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class ProcesarMultimediaBody(BaseModel):
    image: str
    audio: Optional[str] = None


@router.post("/procesar-multimedia")
@limiter.limit("5 per minute")
def procesar_multimedia(request: Request, data: ProcesarMultimediaBody):
    gemini = get_gemini_service()
    if not gemini:
        raise HTTPException(status_code=503, detail="Servicio de IA no disponible")
    if not data.image:
        raise HTTPException(status_code=400, detail="No se proporcionó imagen")
    if not data.audio:
        resultado_imagen = gemini.extract_client_info_from_image(data.image)
        return {"imagen": resultado_imagen, "audio": {"error": "No se proporcionó audio"}}

    def task_imagen():
        return gemini.extract_client_info_from_image(data.image)

    def task_audio():
        ad = data.audio
        if isinstance(ad, str) and ad.startswith("data:audio"):
            _, enc = ad.split(",", 1)
            audio_bytes = base64.b64decode(enc)
        elif isinstance(ad, str):
            audio_bytes = base64.b64decode(ad)
        else:
            audio_bytes = ad
        return gemini.transcribe_audio(audio_bytes)

    try:
        f_img = executor.submit(task_imagen)
        f_aud = executor.submit(task_audio)
        return {"imagen": f_img.result(timeout=30), "audio": f_aud.result(timeout=30)}
    except concurrent.futures.TimeoutError:
        raise HTTPException(
            status_code=408,
            detail="Timeout",
        )
