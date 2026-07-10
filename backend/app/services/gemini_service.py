"""Servicio de IA con Google Gemini (SDK google-genai + generateContent API)."""

from __future__ import annotations

import base64
import json
import re
from typing import Any

from loguru import logger
from pydantic import BaseModel, Field
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import get_settings

PROMPT_EXTRACT_INFO = """Analiza esta imagen de un taller de reparacion y extrae:
- nombre: nombre del cliente en etiqueta o nota (default "Cliente")
- telefono: numero de telefono/whatsapp visible (default "")
- tiene_cargador: true si ves cable USB o cargador, false si no"""

PROMPT_TRANSCRIBE = "Transcribe exactamente lo que dice la persona. Solo el texto."

FALLBACK_IA = {"nombre": "Cliente", "telefono": "", "tiene_cargador": False}

_gemini_instance: GeminiService | None = None


class ClientInfo(BaseModel):
    nombre: str = Field(default="Cliente", description="Nombre del cliente")
    telefono: str = Field(default="", description="Telefono o WhatsApp visible")
    tiene_cargador: bool = Field(default=False, description="True si hay cargador/cable USB visible")


def get_gemini_service() -> GeminiService | None:
    global _gemini_instance
    if _gemini_instance is not None:
        return _gemini_instance
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key or api_key == "your_gemini_api_key_here":
        return None
    try:
        _gemini_instance = GeminiService(api_key, model=settings.gemini_model)
        return _gemini_instance
    except Exception as e:
        logger.warning(f"Gemini no disponible: {e}")
        return None


def _parse_client_info(text: str) -> dict[str, Any]:
    cleaned = (text or "").strip()
    if not cleaned:
        return dict(FALLBACK_IA)

    if cleaned.startswith("```"):
        m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL)
        if m:
            cleaned = m.group(1)

    try:
        result = json.loads(cleaned)
        result.setdefault("nombre", "Cliente")
        result.setdefault("telefono", "")
        result.setdefault("tiene_cargador", False)
        result["nombre"] = str(result["nombre"]).strip() or "Cliente"
        result["telefono"] = str(result.get("telefono", "")).strip()
        result["tiene_cargador"] = bool(result.get("tiene_cargador", False))
        return {
            "nombre": result["nombre"],
            "telefono": result["telefono"],
            "tiene_cargador": result["tiene_cargador"],
        }
    except (json.JSONDecodeError, ValueError, TypeError) as e:
        logger.warning(f"Parseo JSON fallido: {e}")
        nombre_m = re.search(r'"nombre":\s*"([^"]+)"', text, re.I)
        telefono_m = re.search(r'"telefono":\s*"([^"]*)"', text, re.I)
        cargador_m = re.search(r'"tiene_cargador":\s*(true|false)', text, re.I)
        return {
            "nombre": (nombre_m.group(1).strip() if nombre_m else "Cliente") or "Cliente",
            "telefono": telefono_m.group(1).strip() if telefono_m else "",
            "tiene_cargador": bool(cargador_m and cargador_m.group(1).lower() == "true"),
        }


def _normalize_image_payload(image_data: str | bytes) -> tuple[bytes, str]:
    """Devuelve (bytes, mime_type) listo para Part.from_bytes."""
    if isinstance(image_data, str) and image_data.startswith("data:"):
        header, encoded = image_data.split(",", 1)
        mime = "image/jpeg"
        if ";" in header:
            mime = header[5:].split(";")[0] or mime
        return base64.b64decode(encoded.strip()), mime
    if isinstance(image_data, str):
        return base64.b64decode(image_data.strip()), "image/jpeg"
    return image_data, "image/jpeg"


def _normalize_audio_payload(audio_data: bytes | str, mime_type: str = "audio/wav") -> tuple[bytes, str]:
    if isinstance(audio_data, str) and audio_data.startswith("data:"):
        header, encoded = audio_data.split(",", 1)
        mime = mime_type
        if ";" in header:
            mime = header[5:].split(";")[0] or mime
        return base64.b64decode(encoded.strip()), mime
    if isinstance(audio_data, str):
        return base64.b64decode(audio_data.strip()), mime_type
    return audio_data, mime_type


def _client_info_from_response(response: Any) -> dict[str, Any]:
    parsed = getattr(response, "parsed", None)
    if parsed is not None:
        if isinstance(parsed, ClientInfo):
            return parsed.model_dump()
        if isinstance(parsed, dict):
            return _parse_client_info(json.dumps(parsed))
    text = getattr(response, "text", None)
    if isinstance(text, str) and text.strip():
        return _parse_client_info(text)
    return dict(FALLBACK_IA)


class GeminiService:
    def __init__(self, api_key: str, model: str | None = None):
        from google import genai
        from google.genai import types

        self._client = genai.Client(api_key=api_key)
        self._types = types
        settings = get_settings()
        self.model = (model or settings.gemini_model or "gemini-3.5-flash").strip()

    def _extract_config(self) -> Any:
        return self._types.GenerateContentConfig(
            response_mime_type="application/json",
            response_schema=ClientInfo,
            thinking_config=self._types.ThinkingConfig(
                thinking_level=self._types.ThinkingLevel.LOW,
            ),
        )

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=0.5, min=0.5, max=3), reraise=True)
    def extract_client_info_from_image(self, image_data: str | bytes, image_format: str = "jpeg") -> dict[str, Any]:
        del image_format  # compat con firma anterior
        try:
            raw_bytes, mime = _normalize_image_payload(image_data)
            image_part = self._types.Part.from_bytes(data=raw_bytes, mime_type=mime)
            response = self._client.models.generate_content(
                model=self.model,
                contents=[PROMPT_EXTRACT_INFO, image_part],
                config=self._extract_config(),
            )
            return _client_info_from_response(response)
        except Exception as e:
            logger.exception(f"Error procesando imagen: {e}")
            raise

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=0.5, min=0.5, max=3), reraise=True)
    def transcribe_audio(self, audio_data: bytes | str, mime_type: str = "audio/wav") -> str:
        try:
            raw_bytes, mime = _normalize_audio_payload(audio_data, mime_type=mime_type)
            audio_part = self._types.Part.from_bytes(data=raw_bytes, mime_type=mime)
            response = self._client.models.generate_content(
                model=self.model,
                contents=[PROMPT_TRANSCRIBE, audio_part],
                config=self._types.GenerateContentConfig(
                    thinking_config=self._types.ThinkingConfig(
                        thinking_level=self._types.ThinkingLevel.LOW,
                    ),
                ),
            )
            text = getattr(response, "text", None)
            return text.strip() if isinstance(text, str) and text.strip() else "No se pudo transcribir"
        except Exception as e:
            logger.exception(f"Error transcribiendo: {e}")
            raise
