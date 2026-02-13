import socketio

from app.main import app
from app.socket_events import sio

socket_app = socketio.ASGIApp(sio, other_asgi_app=app)
