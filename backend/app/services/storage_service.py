"""Servicio de almacenamiento de imagenes (S3/R2 o local base64)."""
import base64
import uuid
from datetime import UTC, datetime

from loguru import logger

from app.core.config import get_settings


class StorageService:
    def __init__(self):
        settings = get_settings()
        self.use_s3 = bool(settings.use_s3_storage and settings.s3_bucket)
        self._client = None
        self._public_base_url = (settings.s3_public_base_url or "").rstrip("/")

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

    def build_public_url(self, key: str) -> str:
        settings = get_settings()
        if self._public_base_url:
            return f"{self._public_base_url}/{key}"
        if settings.s3_endpoint_url:
            return f"{settings.s3_endpoint_url}/{self._bucket}/{key}"
        return f"https://{self._bucket}.s3.{settings.s3_region}.amazonaws.com/{key}"

    def upload_image(self, image_data: str) -> str:
        if not self.use_s3 or not self._client:
            return image_data

        try:
            if image_data.startswith("data:image"):
                header, encoded = image_data.split(",", 1)
                content_type = header.split(":")[1].split(";")[0]
                ext = content_type.split("/")[1]
            else:
                encoded = image_data
                content_type = "image/jpeg"
                ext = "jpeg"

            raw = base64.b64decode(encoded)
            key = f"repairs/{datetime.now(UTC).strftime('%Y/%m')}/{uuid.uuid4().hex}.{ext}"
            self._client.put_object(Bucket=self._bucket, Key=key, Body=raw, ContentType=content_type)
            url = self.build_public_url(key)
            logger.info(f"Imagen subida a S3: {key}")
            return url
        except Exception as e:
            logger.error(f"Error subiendo a S3, usando base64: {e}")
            return image_data

    def upload_image_required(self, image_data: str) -> dict:
        if not self.use_s3 or not self._client:
            raise RuntimeError("Storage remoto no disponible para media_v2")
        try:
            if image_data.startswith("data:image"):
                header, encoded = image_data.split(",", 1)
                content_type = header.split(":")[1].split(";")[0]
                ext = content_type.split("/")[1]
            else:
                encoded = image_data
                content_type = "image/jpeg"
                ext = "jpeg"

            raw = base64.b64decode(encoded)
            key = f"repairs/{datetime.now(UTC).strftime('%Y/%m')}/{uuid.uuid4().hex}.{ext}"
            self._client.put_object(Bucket=self._bucket, Key=key, Body=raw, ContentType=content_type)
            return {"url": self.build_public_url(key), "storage_key": key}
        except Exception as e:
            logger.error(f"Error subiendo imagen requerida: {e}")
            raise RuntimeError("No se pudo subir imagen a storage remoto") from e

    def upload_bytes_required(self, content: bytes, mime_type: str, ext: str) -> dict:
        if not self.use_s3 or not self._client:
            raise RuntimeError("Storage remoto no disponible para media_v2")
        try:
            key = f"repairs/{datetime.now(UTC).strftime('%Y/%m')}/{uuid.uuid4().hex}.{ext}"
            self._client.put_object(Bucket=self._bucket, Key=key, Body=content, ContentType=mime_type)
            return {"url": self.build_public_url(key), "storage_key": key}
        except Exception as e:
            logger.error(f"Error subiendo bytes requeridos: {e}")
            raise RuntimeError("No se pudo subir archivo a storage remoto") from e

    def delete_image(self, url: str) -> bool:
        if not self.use_s3 or not self._client or not url.startswith("http"):
            return False
        try:
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
