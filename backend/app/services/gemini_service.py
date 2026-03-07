import base64
import io
import json
import os
import re
import tempfile

from dotenv import load_dotenv
from loguru import logger
from PIL import Image
from tenacity import retry, stop_after_attempt, wait_exponential

load_dotenv()

PROMPT_EXTRACT_INFO = """Analiza esta imagen de un taller de reparacion y extrae en JSON:
- nombre: nombre del cliente en etiqueta o nota (default "Cliente")
- telefono: numero de telefono/whatsapp visible (default "")
- tiene_cargador: true si ves cable USB o cargador, false si no

Responde SOLO con JSON valido: {"nombre": "...", "telefono": "...", "tiene_cargador": true/false}"""

# Singleton — se inicializa una sola vez y se reutiliza en todos los requests
_gemini_instance: "GeminiService | None" = None


def get_gemini_service() -> "GeminiService | None":
    global _gemini_instance
    if _gemini_instance is not None:
        return _gemini_instance
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "your_gemini_api_key_here":
        return None
    try:
        _gemini_instance = GeminiService()
        return _gemini_instance
    except Exception as e:
        logger.warning(f"Gemini no disponible: {e}")
        return None


class GeminiService:
    def __init__(self):
        api_key = os.getenv("GEMINI_API_KEY")
        if not api_key or api_key == "your_gemini_api_key_here":
            raise ValueError("GEMINI_API_KEY no configurada")
        import google.generativeai as genai

        self._genai = genai
        self._genai.configure(api_key=api_key)
        self.model = self._genai.GenerativeModel("gemini-flash-latest")

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=0.5, min=0.5, max=3), reraise=True)
    def extract_client_info_from_image(self, image_data, image_format="jpeg"):
        try:
            if isinstance(image_data, str) and image_data.startswith("data:image"):
                _, encoded = image_data.split(",", 1)
                image_data = base64.b64decode(encoded)
            if isinstance(image_data, bytes):
                image = Image.open(io.BytesIO(image_data))
            else:
                image = image_data

            response = self.model.generate_content([PROMPT_EXTRACT_INFO, image])
            if not response.text:
                return {"nombre": "Cliente", "telefono": "", "tiene_cargador": False}

            cleaned = response.text.strip()
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
                return result
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Parseo JSON fallido: {e}")
                nombre_m = re.search(r'"nombre":\s*"([^"]+)"', response.text, re.I)
                telefono_m = re.search(r'"telefono":\s*"([^"]*)"', response.text, re.I)
                cargador_m = re.search(r'"tiene_cargador":\s*(true|false)', response.text, re.I)
                return {
                    "nombre": (nombre_m.group(1).strip() if nombre_m else "Cliente") or "Cliente",
                    "telefono": telefono_m.group(1).strip() if telefono_m else "",
                    "tiene_cargador": cargador_m and cargador_m.group(1).lower() == "true",
                }
        except Exception as e:
            logger.exception(f"Error procesando imagen: {e}")
            return {"nombre": "Cliente", "telefono": "", "tiene_cargador": False, "_error": str(e)}

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=0.5, min=0.5, max=3), reraise=True)
    def transcribe_audio(self, audio_data: bytes) -> str:
        path = None
        try:
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
                f.write(audio_data)
                path = f.name
            uploaded = self._genai.upload_file(path, mime_type="audio/wav")
            response = self.model.generate_content(["Transcribe exactamente lo que dice la persona. Solo el texto.", uploaded])
            try:
                self._genai.delete_file(uploaded.name)
            except Exception:
                pass
            return response.text.strip() if response.text else "No se pudo transcribir"
        except Exception as e:
            logger.exception(f"Error transcribiendo: {e}")
            return f"Error al transcribir: {e}"
        finally:
            if path and os.path.exists(path):
                try:
                    os.unlink(path)
                except Exception:
                    pass
