"""Authentication and user management tests."""
from tests.conftest import client


def test_login_invalid_credentials():
    r = client.post("/api/auth/login", json={
        "username": "nonexistent",
        "password": "wrong",
    })
    assert r.status_code == 401


def test_login_success(admin_user):
    user, _ = admin_user
    r = client.post("/api/auth/login", json={
        "username": "testadmin",
        "password": "admin123",
    })
    assert r.status_code == 200
    data = r.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["username"] == "testadmin"
    assert "session" in data


def test_get_me(auth_headers):
    r = client.get("/api/auth/me", headers=auth_headers)
    assert r.status_code == 200
    data = r.json()
    assert data["username"] == "testadmin"
    assert data["role"] == "admin"


def test_get_me_unauthorized():
    r = client.get("/api/auth/me")
    assert r.status_code == 401


def test_get_me_invalid_token():
    r = client.get("/api/auth/me", headers={"Authorization": "Bearer invalid_token"})
    assert r.status_code == 401


def test_update_me(auth_headers):
    r = client.put("/api/auth/me", json={
        "full_name": "Updated Admin Name",
    }, headers=auth_headers)
    assert r.status_code == 200
    assert r.json()["full_name"] == "Updated Admin Name"


def test_change_password(auth_headers):
    r = client.put("/api/auth/change-password", json={
        "old_password": "admin123",
        "new_password": "newpassword456",
    }, headers=auth_headers)
    assert r.status_code == 200


def test_change_password_wrong_old(auth_headers):
    r = client.put("/api/auth/change-password", json={
        "old_password": "wrongpassword",
        "new_password": "newpassword456",
    }, headers=auth_headers)
    assert r.status_code == 400


def test_list_users(auth_headers):
    r = client.get("/api/auth/users", headers=auth_headers)
    assert r.status_code == 200
    assert isinstance(r.json(), list)
    assert len(r.json()) >= 1


def test_register_new_user(auth_headers):
    r = client.post("/api/auth/register", json={
        "username": "newuser",
        "password": "pass1234",
        "full_name": "New User",
        "role": "tecnico",
    }, headers=auth_headers)
    assert r.status_code == 201
    data = r.json()
    assert data["user"]["username"] == "newuser"


def test_register_duplicate_username(admin_user):
    _, token = admin_user
    headers = {"Authorization": f"Bearer {token}"}

    client.post("/api/auth/register", json={
        "username": "duplicate",
        "password": "pass1234",
        "full_name": "Dup User",
    }, headers=headers)

    r = client.post("/api/auth/register", json={
        "username": "duplicate",
        "password": "pass1234",
        "full_name": "Dup User 2",
    }, headers=headers)
    assert r.status_code == 409
