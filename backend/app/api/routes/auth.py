"""Rutas de autenticacion y gestion de usuarios."""
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.core.limiter import limiter
from app.models.user import DeviceSession, User
from app.schemas.auth import (
    DeviceLoginRequest,
    LoginRequest,
    PasswordChange,
    RegisterRequest,
    UserUpdate,
)
from app.services.auth_service import (
    create_token,
    get_current_user,
    get_current_user_optional,
    hash_password,
    require_role,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login")
@limiter.limit("20 per minute")
def login(request: Request, data: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == data.username).first()
    if not user or not verify_password(data.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Credenciales incorrectas")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Usuario desactivado")

    user.last_login = datetime.now(UTC)

    # Crear o reutilizar sesión de dispositivo
    device_name = request.headers.get("X-Device-Name")
    device_token = str(uuid.uuid4())
    device_session = DeviceSession(
        user_id=user.id,
        device_token=device_token,
        device_name=device_name,
    )
    db.add(device_session)
    db.commit()

    settings = get_settings()
    return {
        "access_token": create_token(user),
        "token_type": "bearer",
        "device_token": device_token,
        "user": user.to_dict(),
        "session": {
            "exp_minutes": settings.jwt_expire_minutes,
            "role": user.role,
        },
    }


@router.post("/device-login")
@limiter.limit("30 per minute")
def device_login(request: Request, data: DeviceLoginRequest, db: Session = Depends(get_db)):
    """Refresca el JWT usando el token persistente del dispositivo, sin contraseña."""
    session = (
        db.query(DeviceSession)
        .filter(DeviceSession.device_token == data.device_token, DeviceSession.is_active.is_(True))
        .first()
    )
    if not session:
        raise HTTPException(status_code=401, detail="Token de dispositivo inválido o revocado")

    user = db.query(User).filter(User.id == session.user_id, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no encontrado o inactivo")

    # Actualizar timestamp de uso
    session.last_used_at = datetime.now(UTC)
    if data.device_name:
        session.device_name = data.device_name
    user.last_login = datetime.now(UTC)
    db.commit()

    settings = get_settings()
    return {
        "access_token": create_token(user),
        "token_type": "bearer",
        "device_token": data.device_token,
        "user": user.to_dict(),
        "session": {
            "exp_minutes": settings.jwt_expire_minutes,
            "role": user.role,
        },
    }


@router.delete("/device-logout")
def device_logout(request: Request, db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """Revoca el device token del dispositivo actual (cierre de sesión permanente)."""
    device_token = request.headers.get("X-Device-Token")
    if device_token:
        session = (
            db.query(DeviceSession)
            .filter(DeviceSession.device_token == device_token, DeviceSession.user_id == user.id)
            .first()
        )
        if session:
            session.is_active = False
            db.commit()
    return {"message": "Sesión de dispositivo revocada"}


@router.post("/register", status_code=201)
@limiter.limit("5 per minute")
def register(
    request: Request,
    data: RegisterRequest,
    db: Session = Depends(get_db),
    current_user: User | None = Depends(get_current_user_optional),
):
    settings = get_settings()
    existing_count = db.query(User).count()

    if existing_count > 0 and not settings.allow_public_register:
        if not current_user or current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Registro publico deshabilitado")

    if settings.is_production and not settings.allow_public_register:
        if not current_user or current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Solo administradores pueden crear usuarios")

    if db.query(User).filter(User.username == data.username).first():
        raise HTTPException(status_code=409, detail="El nombre de usuario ya existe")
    if data.email and db.query(User).filter(User.email == data.email).first():
        raise HTTPException(status_code=409, detail="El email ya esta registrado")

    user = User(
        username=data.username,
        email=data.email,
        hashed_password=hash_password(data.password),
        full_name=data.full_name or "Usuario",
        role=data.role or "tecnico",
        avatar_color=data.avatar_color or "#00ACC1",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return {"access_token": create_token(user), "token_type": "bearer", "user": user.to_dict()}


@router.get("/me")
def get_me(user: User = Depends(get_current_user)):
    return user.to_dict()


@router.put("/me")
def update_me(data: UserUpdate, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if data.full_name is not None:
        user.full_name = data.full_name
    if data.email is not None:
        user.email = data.email
    if data.avatar_color is not None:
        user.avatar_color = data.avatar_color

    if data.role is not None and user.role == "admin":
        user.role = data.role

    db.commit()
    db.refresh(user)
    return user.to_dict()


@router.put("/change-password")
def change_password(data: PasswordChange, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(data.old_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Contrasena actual incorrecta")
    user.hashed_password = hash_password(data.new_password)
    db.commit()
    return {"message": "Contrasena actualizada"}


@router.get("/users")
def list_users(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    users = db.query(User).filter(User.is_active == True).order_by(User.full_name).all()  # noqa: E712
    return [u.to_dict() for u in users]


@router.put("/users/{user_id}")
def update_user(user_id: int, data: UserUpdate, db: Session = Depends(get_db), admin: User = Depends(require_role("admin"))):
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    if data.full_name is not None:
        target.full_name = data.full_name
    if data.email is not None:
        target.email = data.email
    if data.avatar_color is not None:
        target.avatar_color = data.avatar_color
    if data.role is not None:
        target.role = data.role
    if data.is_active is not None:
        target.is_active = data.is_active

    db.commit()
    db.refresh(target)
    return target.to_dict()
