import socketio

from app.main import app
from app.socket_events import sio
from app.core.config import get_settings
from app.middleware.cors_fallback import wrap_with_cors_fallback

_socket_app = socketio.ASGIApp(sio, other_asgi_app=app)
_, origin_regex = get_settings().get_cors_origins()
socket_app = wrap_with_cors_fallback(_socket_app, origin_regex)
