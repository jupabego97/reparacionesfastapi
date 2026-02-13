"""Middleware CORS que añade Access-Control-Allow-Origin para peticiones cross-origin.
Soporta regex (ej. *.railway.app) o allow-all cuando no hay regex definido."""
import re


def wrap_with_cors_fallback(app, origin_regex: str | None):
    """Envuelve app ASGI para añadir CORS. Incluye Socket.IO y OPTIONS preflight."""
    pattern = re.compile(origin_regex) if origin_regex else None

    def _is_allowed(origin: str | None) -> bool:
        if not origin:
            return False
        if pattern:
            return bool(pattern.fullmatch(origin))
        # Sin regex → permitir cualquier origin (dev / ALLOWED_ORIGINS no definido)
        return True

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
                (b"access-control-allow-headers", b"Content-Type, Authorization, X-Requested-With"),
                (b"access-control-max-age", b"86400"),
            ]})
            await send({"type": "http.response.body", "body": b""})
            return

        # Peticiones normales → inyectar headers CORS en la respuesta
        async def send_wrapper(message):
            if message["type"] == "http.response.start" and allowed and origin:
                headers = list(message.get("headers", []))
                has_acao = any(h[0].lower() == b"access-control-allow-origin" for h in headers)
                if not has_acao:
                    headers.append((b"access-control-allow-origin", origin.encode()))
                    headers.append((b"access-control-allow-credentials", b"true"))
                    message = {**message, "headers": headers}
            await send(message)

        await app(scope, receive, send_wrapper)

    return asgi_wrapper
