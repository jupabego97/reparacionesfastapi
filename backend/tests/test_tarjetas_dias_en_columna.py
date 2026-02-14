from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

from app.api.routes.tarjetas import _calculate_dias_en_columna


def _build_card(status: str, dt: datetime | None):
    return SimpleNamespace(
        status=status,
        ingresado_date=dt if status == "ingresado" else None,
        diagnosticada_date=dt if status == "diagnosticada" else None,
        para_entregar_date=dt if status == "para_entregar" else None,
        entregados_date=dt if status == "listos" else None,
    )


def test_calculate_dias_en_columna_por_estado():
    now = datetime(2026, 1, 10, tzinfo=timezone.utc)
    casos = [
        ("ingresado", 5),
        ("diagnosticada", 3),
        ("para_entregar", 2),
        ("listos", 1),
    ]

    for status, dias in casos:
        dt = now - timedelta(days=dias, hours=1)
        card = _build_card(status=status, dt=dt)
        assert _calculate_dias_en_columna(card, now=now) == dias


def test_calculate_dias_en_columna_sin_fecha_o_estado_invalido():
    now = datetime(2026, 1, 10, tzinfo=timezone.utc)

    card_sin_fecha = _build_card(status="ingresado", dt=None)
    assert _calculate_dias_en_columna(card_sin_fecha, now=now) == 0

    card_estado_desconocido = _build_card(status="otro", dt=now - timedelta(days=4))
    assert _calculate_dias_en_columna(card_estado_desconocido, now=now) == 0


def test_calculate_dias_en_columna_tolera_fechas_naive_asumiendo_utc():
    now = datetime(2026, 1, 10, tzinfo=timezone.utc)
    dt_naive = datetime(2026, 1, 7, 12, 0, 0)

    card = _build_card(status="diagnosticada", dt=dt_naive)
    assert _calculate_dias_en_columna(card, now=now) == 2
