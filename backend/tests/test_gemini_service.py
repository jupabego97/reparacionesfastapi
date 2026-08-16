"""Tests del servicio Gemini (parseo y errores)."""

import base64

import pytest
from app.api.routes.multimedia import _gemini_error_status
from app.core.config import get_settings
from app.services import gemini_service
from app.services.gemini_service import ClientInfo, _parse_client_info, get_gemini_service
from google.genai.errors import ClientError, ServerError


@pytest.fixture
def reset_gemini_singleton():
    gemini_service._gemini_instance = None
    get_settings.cache_clear()
    yield
    gemini_service._gemini_instance = None
    get_settings.cache_clear()


def _stub_gemini_init(self, api_key, model=None, provider=None):
    self.api_key = api_key
    self.model = model
    self.provider = provider
    self._client = object()
    self._types = None


def test_get_gemini_service_without_api_key(monkeypatch, reset_gemini_singleton):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    get_settings.cache_clear()
    assert get_gemini_service() is None


def test_get_gemini_service_uses_env_model_and_provider(monkeypatch, reset_gemini_singleton):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("AI_PROVIDER", "google")
    monkeypatch.setenv("AI_MODEL", "gemini-2.0-flash")
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    get_settings.cache_clear()
    monkeypatch.setattr(gemini_service.GeminiService, "__init__", _stub_gemini_init)

    svc = get_gemini_service()
    assert svc is not None
    assert svc.provider == "gemini"
    assert svc.model == "gemini-2.0-flash"
    assert svc.api_key == "test-key"


def test_get_gemini_service_unsupported_provider(monkeypatch, reset_gemini_singleton):
    monkeypatch.setenv("GEMINI_API_KEY", "test-key")
    monkeypatch.setenv("AI_PROVIDER", "openai")
    get_settings.cache_clear()
    assert get_gemini_service() is None


def test_get_gemini_service_vertexai_without_api_key(monkeypatch, reset_gemini_singleton):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("AI_PROVIDER", "vertexai")
    get_settings.cache_clear()
    monkeypatch.setattr(gemini_service.GeminiService, "__init__", _stub_gemini_init)

    svc = get_gemini_service()
    assert svc is not None
    assert svc.provider == "vertexai"


def test_parse_client_info_valid_json():
    raw = '{"nombre": "Juan Pérez", "telefono": "+573001234567", "tiene_cargador": true}'
    result = _parse_client_info(raw)
    assert result["nombre"] == "Juan Pérez"
    assert result["telefono"] == "+573001234567"
    assert result["tiene_cargador"] is True


def test_parse_client_info_markdown_fence():
    raw = '```json\n{"nombre": "Ana", "telefono": "", "tiene_cargador": false}\n```'
    result = _parse_client_info(raw)
    assert result["nombre"] == "Ana"
    assert result["telefono"] == ""
    assert result["tiene_cargador"] is False


def test_parse_client_info_regex_fallback():
    raw = 'texto extra {"nombre": "Luis", "telefono": "300111", "tiene_cargador": true} fin'
    result = _parse_client_info(raw)
    assert result["nombre"] == "Luis"
    assert result["telefono"] == "300111"
    assert result["tiene_cargador"] is True


def test_client_info_schema_defaults():
    info = ClientInfo()
    assert info.nombre == "Cliente"
    assert info.telefono == ""
    assert info.tiene_cargador is False


def test_gemini_error_status_quota():
    exc = ClientError(429, {"error": {"message": "quota", "code": 429}})
    code, msg = _gemini_error_status(exc)
    assert code == 429
    assert "Cuota" in msg


def test_gemini_error_status_server():
    exc = ServerError(503, {"error": {"message": "unavailable", "code": 503}})
    code, msg = _gemini_error_status(exc)
    assert code == 503
    assert "no disponible" in msg.lower()


def test_normalize_image_payload_data_url():
    payload = "data:image/jpeg;base64," + base64.b64encode(b"fake-image").decode()
    raw, mime = gemini_service._normalize_image_payload(payload)
    assert raw == b"fake-image"
    assert mime == "image/jpeg"
