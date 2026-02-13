"""Middleware CORS que añade Access-Control-Allow-Origin cuando Origin coincide con regex (ej. *.railway.app)."""
import re


def wrap_with_cors_fallback(app, origin_regex: str | None):
    """Envuelve app ASGI para añadir CORS cuando Origin coincide con regex. Incluye Socket.IO."""
    if not origin_regex:
        return app

    pattern = re.compile(origin_regex)

    async def asgi_wrapper(scope, receive, send):
        if scope["type"] != "http":
            return await app(scope, receive, send)

        origin = next((v.decode() for k, v in scope.get("headers", []) if k == b"origin"), None)
        allowed = origin and pattern.fullmatch(origin)

        if scope["method"] == "OPTIONS" and allowed:
            await send({"type": "http.response.start", "status": 204, "headers": [
                (b"access-control-allow-origin", origin.encode()),
                (b"access-control-allow-credentials", b"true"),
                (b"access-control-allow-methods", b"GET, POST, PUT, DELETE, OPTIONS"),
                (b"access-control-allow-headers", b"Content-Type, Authorization"),
            ]})
            await send({"type": "http.response.body", "body": b""})
            return

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
