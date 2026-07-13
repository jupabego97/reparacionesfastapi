"""Auditoría de operaciones sobre tarjetas con IP de origen."""
from __future__ import annotations

import ipaddress
from datetime import UTC, datetime

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.repair_card import StatusHistory
from app.models.user import User

# Acciones soportadas en el historial
ACTION_CREATED = "created"
ACTION_UPDATED = "updated"
ACTION_STATUS_CHANGED = "status_changed"
ACTION_REORDERED = "reordered"
ACTION_BLOCKED = "blocked"
ACTION_UNBLOCKED = "unblocked"
ACTION_DELETED = "deleted"
ACTION_RESTORED = "restored"
ACTION_ASSIGNED = "assigned"
ACTION_PRIORITY_CHANGED = "priority_changed"
ACTION_TAG_ADDED = "tag_added"


def is_valid_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value.strip())
        return True
    except ValueError:
        return False


def get_client_ip(request: Request) -> str | None:
    """Extrae la IP del cliente; en Railway usa la primera IP válida de X-Forwarded-For."""
    forwarded = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if forwarded:
        for part in forwarded.split(","):
            candidate = part.strip()
            if candidate and is_valid_ip(candidate):
                return candidate

    if request.client and request.client.host:
        host = request.client.host.strip()
        if host and is_valid_ip(host):
            return host
    return None


def record_card_audit(
    db: Session,
    *,
    tarjeta_id: int,
    action: str,
    new_status: str,
    client_ip: str | None = None,
    user: User | None = None,
    old_status: str | None = None,
    details: str | None = None,
) -> StatusHistory:
    """Registra un evento de auditoría en status_history."""
    if client_ip and not is_valid_ip(client_ip):
        client_ip = None

    entry = StatusHistory(
        tarjeta_id=tarjeta_id,
        action=action,
        old_status=old_status,
        new_status=new_status,
        changed_at=datetime.now(UTC),
        changed_by=user.id if user else None,
        changed_by_name=user.full_name if user else None,
        client_ip=client_ip,
        details=details,
    )
    db.add(entry)
    return entry
