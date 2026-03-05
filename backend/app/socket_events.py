import re
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


@sio.on("connect")
async def connect(sid, env):
    logger.info(f"Cliente conectado: {sid}")
    await sio.emit("status", {"message": "Conectado al servidor en tiempo real"}, to=sid)


@sio.on("disconnect")
async def disconnect(sid):
    logger.info(f"Cliente desconectado: {sid}")


@sio.on("join")
async def join(sid, data=None):
    logger.info(f"Cliente se unió: {sid}")
    await sio.emit("status", {"message": "Unido al canal de sincronización"}, to=sid)
