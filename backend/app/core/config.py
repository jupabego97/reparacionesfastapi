from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "sqlite:///./reparaciones.db"
    environment: str = "development"
    allowed_origins: str = ""
    gemini_api_key: str = ""
    socketio_safe_mode: bool = True
    redis_url: str | None = None

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    def get_cors_origins(self) -> list[str] | str:
        if not self.allowed_origins or not self.allowed_origins.strip():
            return "*"
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()] or "*"


@lru_cache
def get_settings() -> Settings:
    return Settings()
