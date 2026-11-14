"""CORS helpers used by the Railway split frontend/backend deploy."""
import asyncio

from app.core.config import (
    RAILWAY_ORIGIN_REGEX,
    Settings,
    normalize_allowed_origins,
    origin_is_allowed,
)
from app.middleware.cors_fallback import wrap_with_cors_fallback


def test_normalize_strips_trailing_slash():
    assert normalize_allowed_origins(" https://app.example.com/ ,https://b.example") == [
        "https://app.example.com",
        "https://b.example",
    ]


def test_production_always_allows_railway_hosts():
    settings = Settings(environment="production", allowed_origins="https://taller.example.com/")
    origins, regex = settings.get_cors_origins()
    assert origins == ["https://taller.example.com"]
    assert regex == RAILWAY_ORIGIN_REGEX
    assert origin_is_allowed("https://taller.example.com", origins, regex)
    assert origin_is_allowed("https://just-wisdom-production-d465.up.railway.app", origins, regex)
    assert origin_is_allowed("https://frontend-production.railway.app", origins, regex)
    assert not origin_is_allowed("https://evil.example", origins, regex)


def test_production_without_allowed_origins_still_allows_railway():
    settings = Settings(environment="production", allowed_origins="")
    origins, regex = settings.get_cors_origins()
    assert origins == []
    assert origin_is_allowed("https://app.up.railway.app", origins, regex)
    assert not origin_is_allowed("http://app.up.railway.app", origins, regex)


def test_development_without_origins_allows_all():
    settings = Settings(environment="development", allowed_origins="")
    origins, regex = settings.get_cors_origins()
    assert origins == "*"
    assert regex is None
    assert origin_is_allowed("http://localhost:5173", origins, regex)


def _run_asgi(app, method: str, origin: str | None) -> tuple[int, dict[str, str]]:
    headers = []
    if origin:
        headers.append((b"origin", origin.encode()))
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "https",
        "path": "/api/tarjetas/1",
        "raw_path": b"/api/tarjetas/1",
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 123),
        "server": ("test", 443),
    }
    status = 0
    response_headers: dict[str, str] = {}

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        nonlocal status, response_headers
        if message["type"] == "http.response.start":
            status = message["status"]
            response_headers = {
                k.decode(): v.decode() for k, v in message.get("headers", [])
            }

    asyncio.run(app(scope, receive, send))
    return status, response_headers


async def _dummy_app(scope, receive, send):
    await send({
        "type": "http.response.start",
        "status": 200,
        "headers": [(b"content-type", b"application/json")],
    })
    await send({"type": "http.response.body", "body": b"{}"})


def test_cors_wrapper_preflight_allows_listed_and_railway_origins():
    app = wrap_with_cors_fallback(
        _dummy_app,
        RAILWAY_ORIGIN_REGEX,
        ["https://taller.example.com"],
    )
    status, headers = _run_asgi(app, "OPTIONS", "https://taller.example.com")
    assert status == 204
    assert headers["access-control-allow-origin"] == "https://taller.example.com"

    status, headers = _run_asgi(app, "OPTIONS", "https://frontend.up.railway.app")
    assert status == 204
    assert headers["access-control-allow-origin"] == "https://frontend.up.railway.app"

    status, headers = _run_asgi(app, "OPTIONS", "https://evil.example")
    assert status == 200
    assert "access-control-allow-origin" not in headers
