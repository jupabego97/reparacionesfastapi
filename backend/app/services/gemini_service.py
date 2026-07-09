"""Servicio de IA con Google Gemini (SDK google-genai + Interactions API)."""

from __future__ import annotations

import base64
import json
import re
from typing import Any

from loguru import logger
from tenacity import retry, stop_after_attempt, wait_exponential

from app.core.config import get_settings

PROMPT_EXTRACT_INFO = """Analiza esta imagen de un taller de reparacion y extrae en JSON:
- nombre: nombre del cliente en etiqueta o nota (default "Cliente")
- telefono: numero de telefono/whatsapp visible (default "")
- tiene_cargador: true si ves cable USB o cargador, false si no

Responde SOLO con JSON valido: {"nombre": "...", "telefono": "...", "tiene_cargador": true/false}"""

PROMPT_TRANSCRIBE = "Transcribe exactamente lo que dice la persona. Solo el texto."

GEMINI_MODEL = "gemini-3.5-flash"
FALLBACK_IA = {"nombre": "Cliente", "telefono": "", "tiene_cargador": False}

_gemini_instance: GeminiService | None = None


def get_gemini_service() -> GeminiService | None:
    global _gemini_instance
    if _gemini_instance is not None:
        return _gemini_instance
    settings = get_settings()
    api_key = (settings.gemini_api_key or "").strip()
    if not api_key or api_key == "your_gemini_api_key_here":
        return None
    try:
        _gemini_instance = GeminiService(api_key)
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


def _normalize_image_payload(image_data: str | bytes) -> tuple[str, str]:
    """Devuelve (base64_str, mime_type) listo para Interactions API."""
    if isinstance(image_data, str) and image_data.startswith("data:"):
        header, encoded = image_data.split(",", 1)
        mime = "image/jpeg"
        if ";" in header:
            mime = header[5:].split(";")[0] or mime
        return encoded.strip(), mime
    if isinstance(image_data, str):
        return image_data.strip(), "image/jpeg"
    return base64.b64encode(image_data).decode("utf-8"), "image/jpeg"


def _normalize_audio_payload(audio_data: bytes | str, mime_type: str = "audio/wav") -> tuple[str, str]:
    if isinstance(audio_data, str) and audio_data.startswith("data:"):
        header, encoded = audio_data.split(",", 1)
        mime = mime_type
        if ";" in header:
            mime = header[5:].split(";")[0] or mime
        return encoded.strip(), mime
    if isinstance(audio_data, str):
        return audio_data.strip(), mime_type
    return base64.b64encode(audio_data).decode("utf-8"), mime_type


class GeminiService:
    def __init__(self, api_key: str):
        from google import genai

        self._client = genai.Client(api_key=api_key)
        self.model = GEMINI_MODEL

    def _output_text(self, interaction: Any) -> str:
        text = getattr(interaction, "output_text", None)
        if isinstance(text, str) and text.strip():
            return text.strip()
        return ""

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=0.5, min=0.5, max=3), reraise=True)
    def extract_client_info_from_image(self, image_data: str | bytes, image_format: str = "jpeg") -> dict[str, Any]:
        del image_format  # compat con firma anterior
        try:
            b64, mime = _normalize_image_payload(image_data)
            interaction = self._client.interactions.create(
                model=self.model,
                input=[
                    {"type": "text", "text": PROMPT_EXTRACT_INFO},
                    {"type": "image", "data": b64, "mime_type": mime, "resolution": "medium"},
                ],
            )
            text = self._output_text(interaction)
            if not text:
                return dict(FALLBACK_IA)
            return _parse_client_info(text)
        except Exception as e:
            logger.exception(f"Error procesando imagen: {e}")
            raise

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=0.5, min=0.5, max=3), reraise=True)
    def transcribe_audio(self, audio_data: bytes | str, mime_type: str = "audio/wav") -> str:
        try:
            b64, mime = _normalize_audio_payload(audio_data, mime_type=mime_type)
            interaction = self._client.interactions.create(
                model=self.model,
                input=[
                    {"type": "text", "text": PROMPT_TRANSCRIBE},
                    {"type": "audio", "data": b64, "mime_type": mime},
                ],
            )
            text = self._output_text(interaction)
            return text or "No se pudo transcribir"
        except Exception as e:
            logger.exception(f"Error transcribiendo: {e}")
            raise
