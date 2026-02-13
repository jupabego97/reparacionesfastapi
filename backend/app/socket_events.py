import socketio
from loguru import logger

from app.core.config import get_settings

settings = get_settings()
transports = ["polling"] if settings.socketio_safe_mode else ["websocket", "polling"]
cors = settings.get_cors_origins()
if isinstance(cors, str):
    cors = "*"

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=cors,
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
