from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    database_url: str = "sqlite:///./reparaciones.db"
    environment: str = "development"
    allowed_origins: str = ""
    gemini_api_key: str = ""
    socketio_safe_mode: bool = True
    redis_url: str | None = None

    # --- Auth (Mejora #6) ---
    jwt_secret: str = "change-me-in-production-nanotronics-2024"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480  # 8 horas

    # --- S3 storage (Mejora #22) ---
    s3_bucket: str = ""
    s3_region: str = "us-east-1"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_endpoint_url: str = ""  # Para Cloudflare R2 u otros S3-compatible
    use_s3_storage: bool = False

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
            return ([], r"^https://[\w.-]+\.up\.railway\.app$")
        return ("*", None)


@lru_cache
def get_settings() -> Settings:
    return Settings()
