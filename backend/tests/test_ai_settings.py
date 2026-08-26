"""Resolución de proveedor y modelo de IA desde variables de entorno."""

from app.core.config import Settings, normalize_ai_provider


def test_default_ai_provider_and_model(monkeypatch):
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.delenv("GEMINI_PROVIDER", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.delenv("AI_MODEL", raising=False)
    settings = Settings()
    assert settings.resolved_ai_provider == "gemini"
    assert settings.resolved_ai_model == "gemini-3.5-flash"


def test_ai_model_alias(monkeypatch):
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.setenv("AI_MODEL", "gemini-2.5-flash")
    settings = Settings()
    assert settings.gemini_model == "gemini-2.5-flash"
    assert settings.resolved_ai_model == "gemini-2.5-flash"


def test_gemini_model_wins_over_ai_model(monkeypatch):
    monkeypatch.setenv("GEMINI_MODEL", "gemini-3.5-flash")
    monkeypatch.setenv("AI_MODEL", "otro-modelo")
    settings = Settings()
    assert settings.resolved_ai_model == "gemini-3.5-flash"


def test_ai_provider_from_env(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "vertexai")
    settings = Settings()
    assert settings.resolved_ai_provider == "vertexai"


def test_gemini_provider_alias(monkeypatch):
    monkeypatch.delenv("AI_PROVIDER", raising=False)
    monkeypatch.setenv("GEMINI_PROVIDER", "vertex_ai")
    settings = Settings()
    assert settings.resolved_ai_provider == "vertexai"


def test_ai_provider_wins_over_gemini_provider(monkeypatch):
    monkeypatch.setenv("AI_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_PROVIDER", "vertexai")
    settings = Settings()
    assert settings.resolved_ai_provider == "gemini"


def test_normalize_ai_provider_aliases():
    assert normalize_ai_provider("Google") == "gemini"
    assert normalize_ai_provider("VERTEX-AI") == "vertexai"
    assert normalize_ai_provider("openai") == "openai"
    assert normalize_ai_provider("  ") == "gemini"


def test_empty_model_falls_back_to_default():
    settings = Settings(gemini_model="   ")
    assert settings.resolved_ai_model == "gemini-3.5-flash"
