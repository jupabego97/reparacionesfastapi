"""Servicio de notificaciones in-app y WhatsApp.

Mejora #9: Notificaciones automáticas al cambiar estado.
Mejora #20: Centro de notificaciones persistente.
"""

from sqlalchemy.orm import Session

from app.models.kanban import Notification
from app.models.repair_card import RepairCard

ESTADO_LABELS = {
    "ingresado": "Ingresado",
    "diagnosticada": "En Diagnóstico",
    "para_entregar": "Listo para Entregar",
    "listos": "Completado",
}


def crear_notificacion(
    db: Session,
    *,
    title: str,
    message: str,
    type: str = "info",
    user_id: int | None = None,
    tarjeta_id: int | None = None,
) -> Notification:
    """Crea una notificación persistente."""
    notif = Notification(
        title=title,
        message=message,
        type=type,
        user_id=user_id,
        tarjeta_id=tarjeta_id,
    )
    db.add(notif)
    return notif


def notificar_cambio_estado(
    db: Session, tarjeta: RepairCard, old_status: str, new_status: str
) -> None:
    """Genera notificaciones al cambiar el estado de una tarjeta."""
    old_label = ESTADO_LABELS.get(old_status, old_status)
    new_label = ESTADO_LABELS.get(new_status, new_status)
    nombre = tarjeta.owner_name or "Cliente"

    # Notificación para el técnico asignado
    if tarjeta.assigned_to:
        crear_notificacion(
            db,
            title="Cambio de estado",
            message=f"Reparación de {nombre} movida de '{old_label}' a '{new_label}'",
            type="info",
            user_id=tarjeta.assigned_to,
            tarjeta_id=tarjeta.id,
        )

    # Si está listo para entregar, generar notificación especial
    if new_status == "para_entregar":
        crear_notificacion(
            db,
            title="¡Listo para entregar!",
            message=f"El equipo de {nombre} ya está listo para entregar",
            type="success",
            tarjeta_id=tarjeta.id,
        )

    # Si se completó
    if new_status == "listos":
        crear_notificacion(
            db,
            title="Reparación completada",
            message=f"El equipo de {nombre} ha sido entregado exitosamente",
            type="success",
            tarjeta_id=tarjeta.id,
        )


def generar_url_whatsapp(telefono: str, mensaje: str) -> str | None:
    """Genera URL de WhatsApp para notificar al cliente."""
    if not telefono:
        return None
    digits = "".join(c for c in telefono if c.isdigit())
    if len(digits) == 10 and digits.startswith("3"):
        digits = "57" + digits
    if len(digits) < 10:
        return None
    import urllib.parse
    return f"https://wa.me/{digits}?text={urllib.parse.quote(mensaje)}"
