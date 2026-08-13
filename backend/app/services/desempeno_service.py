"""Métricas de desempeño por técnico, calculadas desde el historial.

Usa horario de Colombia (America/Bogota) para agrupar por día.
Los tiempos se reconstruyen desde status_history y descuentan bloqueos.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, time, timedelta
from statistics import median
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models.kanban import Comment, KanbanColumn
from app.models.repair_card import RepairCard, StatusHistory
from app.models.user import User
from app.services.audit_service import ACTION_BLOCKED, ACTION_STATUS_CHANGED, ACTION_UNBLOCKED

BOGOTA = ZoneInfo("America/Bogota")
MAX_RANGE_DAYS = 366
UNASSIGNED_KEY = 0

DEFAULT_FLOW = ("ingresado", "diagnosticada", "para_entregar", "listos")


class DateRangeError(ValueError):
    """Rango de fechas inválido para métricas de desempeño."""


def parse_iso_date(value: str) -> date:
    try:
        return date.fromisoformat(value)
    except ValueError as err:
        raise DateRangeError(f"Fecha inválida: {value}. Use YYYY-MM-DD.") from err


def colombia_today(now: datetime | None = None) -> date:
    current = now or datetime.now(UTC)
    if current.tzinfo is None:
        current = current.replace(tzinfo=UTC)
    return current.astimezone(BOGOTA).date()


def day_bounds_utc(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=BOGOTA).astimezone(UTC)
    end = datetime.combine(day + timedelta(days=1), time.min, tzinfo=BOGOTA).astimezone(UTC)
    return start, end


def resolve_date_range(
    fecha: str | None,
    desde: str | None,
    hasta: str | None,
    now: datetime | None = None,
) -> tuple[date, date]:
    if fecha:
        day = parse_iso_date(fecha)
        return day, day
    start = parse_iso_date(desde) if desde else None
    end = parse_iso_date(hasta) if hasta else None
    if start and not end:
        end = start
    elif end and not start:
        start = end
    elif not start and not end:
        today = colombia_today(now)
        return today, today
    if start > end:
        raise DateRangeError("La fecha inicial no puede ser posterior a la final.")
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise DateRangeError(f"El rango no puede superar {MAX_RANGE_DAYS} días.")
    return start, end


def ensure_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def to_bogota_date(dt: datetime) -> date:
    return ensure_utc(dt).astimezone(BOGOTA).date()


def as_db_datetime(dt: datetime) -> datetime:
    """SQLAlchemy DateTime columns in this app are timezone-naive UTC."""
    return ensure_utc(dt).replace(tzinfo=None)


def percentile(values: list[float], p: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    if len(ordered) == 1:
        return round(ordered[0], 2)
    rank = (len(ordered) - 1) * p
    low = int(rank)
    high = min(low + 1, len(ordered) - 1)
    if low == high:
        return round(ordered[low], 2)
    frac = rank - low
    return round(ordered[low] + (ordered[high] - ordered[low]) * frac, 2)


def round_hours(values: list[float], p: float | None = None) -> float | None:
    if p is None:
        if not values:
            return None
        return round(median(values), 2)
    return percentile(values, p)


def column_order_map(db: Session) -> dict[str, int]:
    columns = db.query(KanbanColumn).order_by(KanbanColumn.position.asc()).all()
    if columns:
        return {col.key: col.position for col in columns}
    return {key: idx for idx, key in enumerate(DEFAULT_FLOW)}


def is_rework(old_status: str | None, new_status: str | None, order: dict[str, int]) -> bool:
    if not old_status or not new_status or old_status == new_status:
        return False
    if old_status not in order or new_status not in order:
        return False
    return order[new_status] < order[old_status]


def blocked_seconds(events: list[StatusHistory], start: datetime, end: datetime) -> float:
    """Suma intervalos bloqueados que se intersectan con [start, end)."""
    blocked_from: datetime | None = None
    total = 0.0
    for event in events:
        moment = ensure_utc(event.changed_at)
        if moment is None:
            continue
        if event.action == ACTION_BLOCKED:
            if moment < start:
                blocked_from = start
            elif moment < end and blocked_from is None:
                blocked_from = moment
        elif event.action == ACTION_UNBLOCKED and blocked_from is not None:
            unlock_at = min(max(moment, start), end)
            if unlock_at > blocked_from:
                total += (unlock_at - blocked_from).total_seconds()
            blocked_from = None
    if blocked_from is not None and end > blocked_from:
        total += (end - blocked_from).total_seconds()
    return max(total, 0.0)


def _empty_tech(user: User | None, actor_id: int, fallback_name: str | None = None) -> dict:
    return {
        "id": None if actor_id == UNASSIGNED_KEY else actor_id,
        "nombre": user.full_name if user else (fallback_name or "Sin atribuir"),
        "rol": user.role if user else "sin_atribuir",
        "avatar_color": user.avatar_color if user else "#64748b",
        "diagnosticadas": 0,
        "reparadas": 0,
        "entregadas": 0,
        "retrabajo": 0,
        "bloqueos": 0,
        "desbloqueos": 0,
        "movimientos": 0,
        "comentarios": 0,
        "con_notas_tecnicas": 0,
        "sin_notas_tecnicas": 0,
        "carga_wip": 0,
        "valor_cobrado": 0.0,
        "por_prioridad": {"alta": 0, "media": 0, "baja": 0},
        "_cycle_hours": [],
        "_diag_hours": [],
        "cierres": [],
    }


def _actor_id(event: StatusHistory, card: RepairCard | None) -> int:
    if event.changed_by:
        return event.changed_by
    if card and card.assigned_to:
        return card.assigned_to
    return UNASSIGNED_KEY


def _status_durations(events: list[StatusHistory], until: datetime) -> dict[str, float]:
    """Horas acumuladas por estado hasta `until`, descontando bloqueos por intervalo."""
    durations: dict[str, float] = defaultdict(float)
    current_status: str | None = None
    status_started: datetime | None = None
    for event in events:
        moment = ensure_utc(event.changed_at)
        if moment is None or moment > until:
            break
        is_status = event.action in {ACTION_STATUS_CHANGED, "created"} and event.new_status
        if not is_status:
            continue
        if current_status and status_started and moment > status_started:
            raw = (moment - status_started).total_seconds()
            blocked = blocked_seconds(events, status_started, moment)
            durations[current_status] += max(raw - blocked, 0.0) / 3600
        current_status = event.new_status
        status_started = moment
    if current_status and status_started and until > status_started:
        raw = (until - status_started).total_seconds()
        blocked = blocked_seconds(events, status_started, until)
        durations[current_status] += max(raw - blocked, 0.0) / 3600
    return durations


def compute_desempeno(
    db: Session,
    *,
    start_day: date,
    end_day: date,
    tecnico_id: int | None = None,
) -> dict:
    start_utc, _ = day_bounds_utc(start_day)
    _, end_utc = day_bounds_utc(end_day)
    start_db = as_db_datetime(start_utc)
    end_db = as_db_datetime(end_utc)
    order = column_order_map(db)

    users = db.query(User).filter(User.is_active.is_(True)).all()
    users_by_id = {user.id: user for user in users}

    events_in_range = (
        db.query(StatusHistory)
        .filter(StatusHistory.changed_at >= start_db, StatusHistory.changed_at < end_db)
        .order_by(StatusHistory.changed_at.asc(), StatusHistory.id.asc())
        .all()
    )
    if tecnico_id:
        events_in_range = [
            event for event in events_in_range
            if event.changed_by == tecnico_id
        ]

    card_ids = {event.tarjeta_id for event in events_in_range}
    cards_by_id: dict[int, RepairCard] = {}
    if card_ids:
        cards_by_id = {
            card.id: card
            for card in db.query(RepairCard).filter(RepairCard.id.in_(card_ids)).all()
        }

    history_by_card: dict[int, list[StatusHistory]] = defaultdict(list)
    if card_ids:
        for event in (
            db.query(StatusHistory)
            .filter(StatusHistory.tarjeta_id.in_(card_ids))
            .order_by(StatusHistory.tarjeta_id.asc(), StatusHistory.changed_at.asc(), StatusHistory.id.asc())
            .all()
        ):
            history_by_card[event.tarjeta_id].append(event)

    comments_in_range = (
        db.query(Comment)
        .filter(Comment.created_at >= start_db, Comment.created_at < end_db)
        .all()
    )

    techs: dict[int, dict] = {}
    for user in users:
        if tecnico_id and user.id != tecnico_id:
            continue
        techs[user.id] = _empty_tech(user, user.id)

    daily: dict[str, dict] = {}
    cursor = start_day
    while cursor <= end_day:
        key = cursor.isoformat()
        daily[key] = {
            "fecha": key,
            "diagnosticadas": 0,
            "reparadas": 0,
            "entregadas": 0,
            "retrabajo": 0,
            "bloqueos": 0,
        }
        cursor += timedelta(days=1)

    def tech_bucket(actor_id: int, name: str | None = None) -> dict:
        if actor_id not in techs:
            techs[actor_id] = _empty_tech(users_by_id.get(actor_id), actor_id, name)
        return techs[actor_id]

    closed_in_period: dict[int, tuple[StatusHistory, RepairCard | None]] = {}
    all_cycle_hours: list[float] = []

    for event in events_in_range:
        card = cards_by_id.get(event.tarjeta_id)
        actor_id = _actor_id(event, card)
        if tecnico_id and actor_id != tecnico_id and event.changed_by != tecnico_id:
            continue
        bucket = tech_bucket(actor_id, event.changed_by_name)
        day_key = to_bogota_date(ensure_utc(event.changed_at)).isoformat()
        day_row = daily.get(day_key)

        if event.action == ACTION_BLOCKED:
            bucket["bloqueos"] += 1
            if day_row:
                day_row["bloqueos"] += 1
            continue
        if event.action == ACTION_UNBLOCKED:
            bucket["desbloqueos"] += 1
            continue

        is_status = event.action in {ACTION_STATUS_CHANGED, "created"} and event.new_status
        if not is_status or event.new_status == event.old_status:
            continue

        bucket["movimientos"] += 1
        if event.new_status == "diagnosticada":
            bucket["diagnosticadas"] += 1
            if day_row:
                day_row["diagnosticadas"] += 1
        elif event.new_status == "para_entregar":
            bucket["reparadas"] += 1
            if day_row:
                day_row["reparadas"] += 1
            if card and card.technical_notes and card.technical_notes.strip():
                bucket["con_notas_tecnicas"] += 1
            else:
                bucket["sin_notas_tecnicas"] += 1
        elif event.new_status == "listos":
            bucket["entregadas"] += 1
            if day_row:
                day_row["entregadas"] += 1
            closed_in_period[event.tarjeta_id] = (event, card)
            priority = (card.priority if card else "media") or "media"
            if priority in bucket["por_prioridad"]:
                bucket["por_prioridad"][priority] += 1
            if card and card.final_cost:
                bucket["valor_cobrado"] = round(bucket["valor_cobrado"] + float(card.final_cost), 2)
            bucket["cierres"].append({
                "tarjeta_id": event.tarjeta_id,
                "cliente": card.owner_name if card else None,
                "prioridad": priority,
                "hora": ensure_utc(event.changed_at).astimezone(BOGOTA).strftime("%H:%M"),
            })

        if is_rework(event.old_status, event.new_status, order):
            bucket["retrabajo"] += 1
            if day_row:
                day_row["retrabajo"] += 1

        if event.new_status == "para_entregar":
            durations = _status_durations(history_by_card.get(event.tarjeta_id, []), ensure_utc(event.changed_at))
            diag_hours = durations.get("diagnosticada")
            if diag_hours and diag_hours > 0:
                bucket["_diag_hours"].append(diag_hours)

    for comment in comments_in_range:
        actor_id = comment.user_id or UNASSIGNED_KEY
        if tecnico_id and actor_id != tecnico_id:
            continue
        tech_bucket(actor_id, comment.author_name)["comentarios"] += 1

    for card_id, (close_event, card) in closed_in_period.items():
        close_at = ensure_utc(close_event.changed_at)
        history = history_by_card.get(card_id, [])
        start_at = None
        for event in history:
            if event.action in {ACTION_STATUS_CHANGED, "created"} and event.new_status == "ingresado":
                start_at = ensure_utc(event.changed_at)
                break
        if start_at is None and card and card.ingresado_date:
            start_at = ensure_utc(card.ingresado_date)
        if start_at is None or close_at is None or close_at <= start_at:
            continue
        raw_seconds = (close_at - start_at).total_seconds()
        blocked = blocked_seconds(history, start_at, close_at)
        hours = max(raw_seconds - blocked, 0.0) / 3600
        actor_id = _actor_id(close_event, card)
        if tecnico_id and actor_id != tecnico_id:
            continue
        tech_bucket(actor_id, close_event.changed_by_name)["_cycle_hours"].append(hours)
        all_cycle_hours.append(hours)

    wip_rows = (
        db.query(RepairCard.assigned_to, RepairCard.id)
        .filter(
            RepairCard.deleted_at.is_(None),
            RepairCard.status != "listos",
            RepairCard.assigned_to.isnot(None),
        )
        .all()
    )
    for assigned_to, _card_id in wip_rows:
        if tecnico_id and assigned_to != tecnico_id:
            continue
        if assigned_to in techs:
            techs[assigned_to]["carga_wip"] += 1

    tecnicos = []
    for actor_id, bucket in techs.items():
        if tecnico_id and actor_id != tecnico_id:
            continue
        cycle = bucket.pop("_cycle_hours")
        diag = bucket.pop("_diag_hours")
        bucket["tiempo_ciclo_mediana_horas"] = round_hours(cycle)
        bucket["tiempo_ciclo_p90_horas"] = round_hours(cycle, 0.9)
        bucket["tiempo_diagnostico_mediana_horas"] = round_hours(diag)
        notas_total = bucket["con_notas_tecnicas"] + bucket["sin_notas_tecnicas"]
        bucket["tasa_notas_tecnicas"] = (
            round(bucket["con_notas_tecnicas"] / notas_total * 100, 1) if notas_total else None
        )
        bucket["muestra_pequena"] = bucket["entregadas"] + bucket["reparadas"] < 5
        bucket["cierres"] = bucket["cierres"][:50]
        tecnicos.append(bucket)

    tecnicos.sort(
        key=lambda item: (
            -(item["reparadas"] + item["entregadas"]),
            item["nombre"].lower(),
        )
    )

    resumen = {
        "diagnosticadas": sum(item["diagnosticadas"] for item in tecnicos),
        "reparadas": sum(item["reparadas"] for item in tecnicos),
        "entregadas": sum(item["entregadas"] for item in tecnicos),
        "retrabajo": sum(item["retrabajo"] for item in tecnicos),
        "bloqueos": sum(item["bloqueos"] for item in tecnicos),
        "comentarios": sum(item["comentarios"] for item in tecnicos),
        "tiempo_ciclo_mediana_horas": round_hours(all_cycle_hours),
        "tasa_notas_tecnicas": None,
    }
    notas_ok = sum(item["con_notas_tecnicas"] for item in tecnicos)
    notas_total = notas_ok + sum(item["sin_notas_tecnicas"] for item in tecnicos)
    if notas_total:
        resumen["tasa_notas_tecnicas"] = round(notas_ok / notas_total * 100, 1)

    return {
        "zona": "America/Bogota",
        "desde": start_day.isoformat(),
        "hasta": end_day.isoformat(),
        "dias": (end_day - start_day).days + 1,
        "tecnico_id": tecnico_id,
        "resumen": resumen,
        "tecnicos": tecnicos,
        "por_dia": [daily[key] for key in sorted(daily)],
        "generado_at": datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S"),
        "criterios": {
            "diagnosticadas": "Movimientos a En Diagnóstico",
            "reparadas": "Movimientos a Listos para Entregar",
            "entregadas": "Movimientos a Completados",
            "retrabajo": "Transiciones hacia una columna anterior",
            "tiempos": "Reconstruidos desde el historial, descontando bloqueos",
            "atribucion": "Se atribuye a quien movió la tarjeta; si no hay actor, al técnico asignado",
        },
    }
