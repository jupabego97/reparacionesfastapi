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
    allow_public_register: bool = False
    create_default_admin_on_boot: bool = True
    default_admin_username: str = "admin"
    default_admin_password: str = "admin123"
    default_admin_email: str = "admin@nanotronics.com"
    default_admin_full_name: str = "Administrador"
    default_admin_avatar_color: str = "#ef4444"
    runtime_schema_migration: bool = False
    expose_debug_schema: bool = False
    sentry_dsn: str = ""
    sentry_traces_sample_rate: float = 0.0
    enable_prometheus_metrics: bool = True

    # --- S3 storage (Mejora #22) ---
    s3_bucket: str = ""
    s3_region: str = "us-east-1"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_endpoint_url: str = ""  # Para Cloudflare R2 u otros S3-compatible
    use_s3_storage: bool = False
    media_v2_read_write: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def is_default_jwt_secret(self) -> bool:
        return self.jwt_secret.strip() == "change-me-in-production-nanotronics-2024"

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
