"""Servicio de autenticación con JWT y hashing de contraseñas."""
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from loguru import logger
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import get_db
from app.models.user import User

security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_token(user: User) -> str:
    settings = get_settings()
    payload = {
        "sub": str(user.id),
        "username": user.username,
        "role": user.role,
        "name": user.full_name,
        "exp": datetime.now(UTC) + timedelta(minutes=settings.jwt_expire_minutes),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except jwt.ExpiredSignatureError as err:
        raise HTTPException(status_code=401, detail="Token expirado") from err
    except jwt.InvalidTokenError as err:
        raise HTTPException(status_code=401, detail="Token inválido") from err


def get_current_user_optional(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User | None:
    """Retorna el usuario autenticado o None si no hay token."""
    if not creds:
        return None
    try:
        payload = decode_token(creds.credentials)
        user_id = int(payload["sub"])
        user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
        return user
    except Exception:
        return None


def get_current_user(
    request: Request,
    creds: HTTPAuthorizationCredentials | None = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """Requiere autenticación. Lanza 401 si no hay token válido."""
    if not creds:
        raise HTTPException(status_code=401, detail="No autenticado")
    payload = decode_token(creds.credentials)
    user_id = int(payload["sub"])
    user = db.query(User).filter(User.id == user_id, User.is_active.is_(True)).first()
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no encontrado o inactivo")
    return user


def require_role(*roles: str):
    """Dependency factory para requerir un rol específico."""
    def dependency(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail=f"Rol requerido: {', '.join(roles)}")
        return user
    return dependency


def create_default_admin(db: Session) -> None:
    """Crea un admin por defecto si no existen usuarios."""
    settings = get_settings()
    count = db.query(User).count()
    if count == 0:
        admin = User(
            username=settings.default_admin_username,
            email=settings.default_admin_email,
            hashed_password=hash_password(settings.default_admin_password),
            full_name=settings.default_admin_full_name,
            role="admin",
            avatar_color=settings.default_admin_avatar_color,
        )
        db.add(admin)
        db.commit()
        logger.warning("Usuario admin por defecto creado. Cambie la contraseña inmediatamente.")
