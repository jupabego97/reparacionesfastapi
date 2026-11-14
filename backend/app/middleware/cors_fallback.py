"""Middleware CORS que añade Access-Control-Allow-Origin para peticiones cross-origin.

Acepta una lista explícita (ALLOWED_ORIGINS) y/o un regex (dominios Railway).
"""
from app.core.config import origin_is_allowed


def wrap_with_cors_fallback(
    app,
    origin_regex: str | None,
    allowed_origins: list[str] | str | None = None,
):
    """Envuelve app ASGI para añadir CORS. Incluye Socket.IO y OPTIONS preflight."""

    def _is_allowed(origin: str | None) -> bool:
        origins: list[str] | str
        if allowed_origins is None:
            origins = []
        else:
            origins = allowed_origins
        return origin_is_allowed(origin, origins, origin_regex)

    async def asgi_wrapper(scope, receive, send):
        if scope["type"] != "http":
            return await app(scope, receive, send)

        origin = next((v.decode() for k, v in scope.get("headers", []) if k == b"origin"), None)
        allowed = _is_allowed(origin)

        # Preflight OPTIONS → responder directamente
        if scope["method"] == "OPTIONS" and allowed:
            await send({"type": "http.response.start", "status": 204, "headers": [
                (b"access-control-allow-origin", origin.encode()),
                (b"access-control-allow-credentials", b"true"),
                (b"access-control-allow-methods", b"GET, POST, PUT, DELETE, PATCH, OPTIONS"),
                (b"access-control-allow-headers", b"*"),
                (b"access-control-max-age", b"86400"),
            ]})
            await send({"type": "http.response.body", "body": b""})
            return

        # Peticiones normales → inyectar/reemplazar headers CORS en la respuesta.
        # Reemplazamos también el wildcard "*" que algunos servidores (ej. python-socketio)
        # emiten por defecto, ya que "*" no funciona con credenciales y es menos específico.
        async def send_wrapper(message):
            if message["type"] == "http.response.start" and allowed and origin:
                headers = [(k, v) for k, v in message.get("headers", [])
                           if k.lower() != b"access-control-allow-origin"]
                headers.append((b"access-control-allow-origin", origin.encode()))
                if not any(k.lower() == b"access-control-allow-credentials" for k, _ in headers):
                    headers.append((b"access-control-allow-credentials", b"true"))
                message = {**message, "headers": headers}
            await send(message)

        await app(scope, receive, send_wrapper)

    return asgi_wrapper
