from functools import lru_cache

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings

# Proveedores que el SDK actual (google-genai) puede atender sin dependencias extra.
SUPPORTED_AI_PROVIDERS = frozenset({"gemini", "vertexai"})
_DEFAULT_AI_PROVIDER = "gemini"
_DEFAULT_AI_MODEL = "gemini-3.5-flash"
_GEMINI_PROVIDER_ALIASES = frozenset(
    {"", "gemini", "google", "google-ai", "google_ai", "gemini-api"}
)
_VERTEX_PROVIDER_ALIASES = frozenset({"vertexai", "vertex_ai", "vertex-ai", "vertex"})


def normalize_ai_provider(value: str | None) -> str:
    """Normaliza el proveedor de IA leído de entorno. No valida soporte."""
    raw = (value or _DEFAULT_AI_PROVIDER).strip().lower()
    if raw in _VERTEX_PROVIDER_ALIASES:
        return "vertexai"
    if raw in _GEMINI_PROVIDER_ALIASES:
        return "gemini"
    return raw


class Settings(BaseSettings):
    database_url: str = "sqlite:///./reparaciones.db"
    environment: str = "development"
    allowed_origins: str = ""
    gemini_api_key: str = ""
    ai_provider: str = Field(
        default=_DEFAULT_AI_PROVIDER,
        validation_alias=AliasChoices("AI_PROVIDER", "GEMINI_PROVIDER"),
    )
    gemini_model: str = Field(
        default=_DEFAULT_AI_MODEL,
        validation_alias=AliasChoices("GEMINI_MODEL", "AI_MODEL"),
    )
    socketio_safe_mode: bool = False
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
    s3_bucket: str = Field(default="", validation_alias=AliasChoices("S3_BUCKET", "R2_BUCKET"))
    s3_region: str = Field(default="auto", validation_alias=AliasChoices("S3_REGION", "R2_REGION"))
    s3_access_key: str = Field(default="", validation_alias=AliasChoices("S3_ACCESS_KEY", "R2_ACCESS_KEY"))
    s3_secret_key: str = Field(default="", validation_alias=AliasChoices("S3_SECRET_KEY", "R2_SECRET_KEY"))
    s3_endpoint_url: str = Field(
        default="",
        validation_alias=AliasChoices("S3_ENDPOINT_URL", "R2_ENDPOINT_URL"),
    )  # Para Cloudflare R2 u otros S3-compatible
    s3_public_base_url: str = Field(
        default="",
        validation_alias=AliasChoices("S3_PUBLIC_BASE_URL", "R2_PUBLIC_BASE_URL"),
    )  # URL publica de entrega (ej: https://pub-xxxx.r2.dev)
    use_s3_storage: bool = Field(default=False, validation_alias=AliasChoices("USE_S3_STORAGE", "R2_ENABLED"))
    media_v2_read_write: bool = True

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"
        populate_by_name = True

    @property
    def resolved_ai_provider(self) -> str:
        return normalize_ai_provider(self.ai_provider)

    @property
    def resolved_ai_model(self) -> str:
        model = (self.gemini_model or "").strip()
        return model or _DEFAULT_AI_MODEL

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
