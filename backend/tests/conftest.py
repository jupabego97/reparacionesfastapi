"""Shared test fixtures for the repair management system."""
import os

os.environ["DATABASE_URL"] = "sqlite://"
os.environ["ENVIRONMENT"] = "development"
os.environ["ALLOW_PUBLIC_REGISTER"] = "true"

from datetime import UTC

import pytest
from app.core.database import Base, SessionLocal, engine, get_db
from app.main import app
from app.models import (
    RepairCard,
    User,
)
from app.services.auth_service import create_token, hash_password
from fastapi.testclient import TestClient


def override_get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_db():
    """Drop and recreate all tables between tests for isolation."""
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def db_session():
    """Provide a database session for test setup."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture
def admin_user(db_session):
    """Create an admin user and return (user, token) tuple."""
    user = User(
        username="testadmin",
        email="admin@test.com",
        hashed_password=hash_password("admin123"),
        full_name="Test Admin",
        role="admin",
        avatar_color="#ef4444",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    token = create_token(user)
    return user, token


@pytest.fixture
def tech_user(db_session):
    """Create a technician user and return (user, token) tuple."""
    user = User(
        username="testtecnico",
        email="tecnico@test.com",
        hashed_password=hash_password("tech123"),
        full_name="Test Tecnico",
        role="tecnico",
        avatar_color="#00ACC1",
    )
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    token = create_token(user)
    return user, token


@pytest.fixture
def auth_headers(admin_user):
    """Return authorization headers for admin user."""
    _, token = admin_user
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def tech_headers(tech_user):
    """Return authorization headers for tech user."""
    _, token = tech_user
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def sample_tarjeta(db_session):
    """Create a sample repair card."""
    from datetime import datetime
    card = RepairCard(
        owner_name="Juan Perez",
        problem="Pantalla rota",
        whatsapp_number="5551234567",
        start_date=datetime.now(UTC),
        due_date=datetime.now(UTC),
        status="ingresado",
        ingresado_date=datetime.now(UTC),
        has_charger="si",
        priority="media",
        position=1,
    )
    db_session.add(card)
    db_session.commit()
    db_session.refresh(card)
    return card
