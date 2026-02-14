import os

from fastapi.testclient import TestClient

from app.main import app
from app.core.config import get_settings


client = TestClient(app)


def test_health_live_and_ready_endpoints():
    live = client.get('/health/live')
    ready = client.get('/health/ready')
    assert live.status_code == 200
    assert ready.status_code in (200, 503)
    assert 'status' in live.json()


def test_debug_schema_disabled_by_default():
    resp = client.get('/debug/schema')
    assert resp.status_code == 404


def test_http_error_envelope_shape():
    resp = client.get('/api/tarjetas/999999')
    assert resp.status_code == 404
    body = resp.json()
    assert 'code' in body
    assert 'message' in body
    assert 'request_id' in body


def test_register_restricted_when_public_disabled_after_first_user():
    os.environ['ALLOW_PUBLIC_REGISTER'] = 'false'
    get_settings.cache_clear()

    first = client.post('/api/auth/register', json={
        'username': 'owner_init',
        'password': 'secret123',
        'full_name': 'Owner Init',
    })
    assert first.status_code in (201, 403, 409)

    second = client.post('/api/auth/register', json={
        'username': 'someone_else',
        'password': 'secret123',
        'full_name': 'Someone Else',
    })

    # Could be 409 if user existed from previous run, but if new user then it must be restricted.
    assert second.status_code in (403, 409)
