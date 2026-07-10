import re

import jwt
import socketio
from loguru import logger

from app.core.config import get_settings

settings = get_settings()
transports = ["polling"] if settings.socketio_safe_mode else ["websocket", "polling"]
origins, origin_regex = settings.get_cors_origins()
# Socket.IO soporta callable desde v5.x; usamos uno basado en regex cuando no hay lista explícita
cors_sio: list[str] | str | object
if origin_regex:
    _pattern = re.compile(origin_regex)
    def cors_sio(origin):  # type: ignore[misc]
        result = bool(_pattern.fullmatch(origin)) if origin else False
        if not result:
            logger.warning(f"Socket.IO: origen rechazado por CORS: {origin!r}")
        return result
    logger.info(f"Socket.IO CORS: regex callable ({origin_regex})")
else:
    cors_sio = origins
    logger.info(f"Socket.IO CORS: lista explícita {origins!r}")
sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=cors_sio,
    logger=not settings.is_production,
    engineio_logger=not settings.is_production,
    ping_timeout=60,
    ping_interval=25,
    max_http_buffer_size=1_000_000,
    allow_upgrades=not settings.socketio_safe_mode,
    transports=transports,
)


def _user_id_from_socket_auth(auth) -> int | None:
    if not auth or not isinstance(auth, dict):
        return None
    token = auth.get("token")
    if not token or not isinstance(token, str):
        return None
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[settings.jwt_algorithm],
        )
        return int(payload["sub"])
    except Exception:
        return None


@sio.on("connect")
async def connect(sid, environ, auth):
    user_id = _user_id_from_socket_auth(auth)
    if user_id is None:
        logger.warning(f"Socket rechazado sin JWT válido: {sid}")
        return False
    await sio.save_session(sid, {"user_id": user_id})
    logger.info(f"Cliente autenticado conectado: {sid} (user {user_id})")
    await sio.emit("status", {"message": "Conectado al servidor en tiempo real"}, to=sid)


@sio.on("disconnect")
async def disconnect(sid):
    logger.info(f"Cliente desconectado: {sid}")


@sio.on("join")
async def join(sid, data=None):
    session = await sio.get_session(sid)
    user_id = session.get("user_id") if session else None
    if not user_id:
        return False
    logger.info(f"Usuario {user_id} unido al canal: {sid}")
    await sio.emit("status", {"message": "Unido al canal de sincronización"}, to=sid)
