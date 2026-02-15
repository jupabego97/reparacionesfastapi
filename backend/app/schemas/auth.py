"""Schemas para autenticación."""

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=4, max_length=128)


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    password: str = Field(..., min_length=4, max_length=128)
    full_name: str = Field(default="Usuario", max_length=100)
    email: str | None = None
    role: str | None = "tecnico"
    avatar_color: str | None = "#00ACC1"


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


class UserUpdate(BaseModel):
    full_name: str | None = None
    email: str | None = None
    avatar_color: str | None = None
    role: str | None = None
    is_active: bool | None = None


class PasswordChange(BaseModel):
    old_password: str
    new_password: str = Field(..., min_length=4, max_length=128)
