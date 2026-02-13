import os
import pytest
from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = "sqlite:///./test.db"

from app.main import app
from app.core.database import Base, engine, get_db
from app.models import RepairCard, StatusHistory

Base.metadata.create_all(bind=engine)


def override_get_db():
    from app.core.database import SessionLocal
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_db():
    StatusHistory.__table__.drop(engine, checkfirst=True)
    RepairCard.__table__.drop(engine, checkfirst=True)
    Base.metadata.create_all(bind=engine)
    yield


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert "status" in r.json()
    assert "services" in r.json()


def test_get_tarjetas_empty():
    r = client.get("/api/tarjetas")
    assert r.status_code == 200
    assert r.json() == []


def test_create_and_get_tarjeta():
    r = client.post("/api/tarjetas", json={
        "nombre_propietario": "Test",
        "problema": "Problema test",
        "fecha_limite": "2025-12-31",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["nombre_propietario"] == "Test"
    assert data["problema"] == "Problema test"
    assert "id" in data

    r2 = client.get("/api/tarjetas")
    assert r2.status_code == 200
    items = r2.json()
    assert isinstance(items, list)
    assert len(items) >= 1


def test_update_tarjeta():
    r = client.post("/api/tarjetas", json={"nombre_propietario": "A", "problema": "B"})
    assert r.status_code == 201
    id = r.json()["id"]

    r2 = client.put(f"/api/tarjetas/{id}", json={"nombre_propietario": "Actualizado"})
    assert r2.status_code == 200
    assert r2.json()["nombre_propietario"] == "Actualizado"


def test_delete_tarjeta():
    r = client.post("/api/tarjetas", json={"nombre_propietario": "X", "problema": "Y"})
    assert r.status_code == 201
    id = r.json()["id"]

    r2 = client.delete(f"/api/tarjetas/{id}")
    assert r2.status_code == 204

    r3 = client.get("/api/tarjetas")
    assert r3.status_code == 200
    assert not any(t["id"] == id for t in r3.json())
