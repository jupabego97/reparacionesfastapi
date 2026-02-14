from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException


@dataclass
class ApiErrorPayload:
    code: str
    message: str
    details: dict[str, Any] | None = None


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(status_code=status_code, detail={"code": code, "message": message, "details": details})


def raise_api_error(status_code: int, code: str, message: str, details: dict[str, Any] | None = None) -> None:
    raise ApiError(status_code=status_code, code=code, message=message, details=details)


def default_code_for_status(status_code: int) -> str:
    mapping = {
        400: "bad_request",
        401: "unauthorized",
        403: "forbidden",
        404: "not_found",
        409: "conflict",
        422: "validation_error",
        429: "rate_limited",
        500: "internal_error",
        503: "service_unavailable",
    }
    return mapping.get(status_code, "error")
