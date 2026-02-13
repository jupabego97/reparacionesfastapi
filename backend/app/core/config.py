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

    def get_cors_origins(self) -> tuple[list[str] | str, str | None]:
        """Retorna (origins, origin_regex). Si ALLOWED_ORIGINS vacío en prod, regex para Railway."""
        if self.allowed_origins and self.allowed_origins.strip():
            lista = [o.strip() for o in self.allowed_origins.split(",") if o.strip()]
            if lista:
                return (lista, None)
        if self.is_production:
            # Fallback: permitir *.up.railway.app cuando ALLOWED_ORIGINS no está definido
            return ([], r"^https://[\w.-]+\.up\.railway\.app$")
        return ("*", None)


@lru_cache
def get_settings() -> Settings:
    return Settings()
