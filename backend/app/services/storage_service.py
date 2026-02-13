"""Servicio de almacenamiento de imágenes (S3/R2 o local base64).

Mejora #22: Migra imágenes de base64 en BD a almacenamiento S3.
Si S3 no está configurado, mantiene compatibilidad con base64.
"""
import base64
import io
import uuid
from datetime import datetime, timezone

from loguru import logger

from app.core.config import get_settings


class StorageService:
    def __init__(self):
        settings = get_settings()
        self.use_s3 = settings.use_s3_storage and settings.s3_bucket
        self._client = None

        if self.use_s3:
            try:
                import boto3
                kwargs = {
                    "aws_access_key_id": settings.s3_access_key,
                    "aws_secret_access_key": settings.s3_secret_key,
                    "region_name": settings.s3_region,
                }
                if settings.s3_endpoint_url:
                    kwargs["endpoint_url"] = settings.s3_endpoint_url
                self._client = boto3.client("s3", **kwargs)
                self._bucket = settings.s3_bucket
                logger.info(f"S3 storage configurado: {settings.s3_bucket}")
            except Exception as e:
                logger.warning(f"S3 no disponible, usando base64: {e}")
                self.use_s3 = False

    def upload_image(self, image_data: str) -> str:
        """Sube imagen base64 → devuelve URL pública o la misma base64 si no hay S3."""
        if not self.use_s3 or not self._client:
            return image_data  # Mantiene base64 como fallback

        try:
            # Decodificar base64
            if image_data.startswith("data:image"):
                header, encoded = image_data.split(",", 1)
                content_type = header.split(":")[1].split(";")[0]
                ext = content_type.split("/")[1]
            else:
                encoded = image_data
                content_type = "image/jpeg"
                ext = "jpeg"

            raw = base64.b64decode(encoded)
            filename = f"repairs/{datetime.now(timezone.utc).strftime('%Y/%m')}/{uuid.uuid4().hex}.{ext}"

            self._client.put_object(
                Bucket=self._bucket,
                Key=filename,
                Body=raw,
                ContentType=content_type,
            )

            # Construir URL pública
            settings = get_settings()
            if settings.s3_endpoint_url:
                url = f"{settings.s3_endpoint_url}/{self._bucket}/{filename}"
            else:
                url = f"https://{self._bucket}.s3.{settings.s3_region}.amazonaws.com/{filename}"

            logger.info(f"Imagen subida a S3: {filename}")
            return url

        except Exception as e:
            logger.error(f"Error subiendo a S3, usando base64: {e}")
            return image_data

    def delete_image(self, url: str) -> bool:
        """Elimina una imagen de S3 por su URL."""
        if not self.use_s3 or not self._client or not url.startswith("http"):
            return False
        try:
            # Extraer key de la URL
            parts = url.split(f"{self._bucket}/", 1)
            if len(parts) > 1:
                key = parts[1].split("?")[0]
                self._client.delete_object(Bucket=self._bucket, Key=key)
                logger.info(f"Imagen eliminada de S3: {key}")
                return True
        except Exception as e:
            logger.error(f"Error eliminando de S3: {e}")
        return False


_storage: StorageService | None = None


def get_storage_service() -> StorageService:
    global _storage
    if _storage is None:
        _storage = StorageService()
    return _storage
