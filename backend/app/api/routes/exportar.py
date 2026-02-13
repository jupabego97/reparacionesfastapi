import csv
from datetime import datetime, timezone
from io import BytesIO, StringIO

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse, Response
from sqlalchemy.orm import Session
import pandas as pd

from app.core.database import get_db
from app.core.limiter import limiter
from app.models.repair_card import RepairCard

router = APIRouter(prefix="/api", tags=["exportar"])

BATCH_SIZE = 500
EXCEL_LIMIT = 5000


def _row_to_csv_dict(t: RepairCard) -> dict:
    return {
        "ID": t.id,
        "Cliente": t.owner_name,
        "WhatsApp": t.whatsapp_number,
        "Problema": t.problem,
        "Estado": t.status,
        "Fecha Inicio": t.start_date.strftime("%Y-%m-%d %H:%M") if t.start_date else "",
        "Fecha Límite": t.due_date.strftime("%Y-%m-%d") if t.due_date else "",
        "Tiene Cargador": t.has_charger,
        "Notas Técnicas": t.technical_notes or "",
        "URL Imagen": t.image_url or "",
        "Fecha Diagnóstico": t.diagnosticada_date.strftime("%Y-%m-%d %H:%M") if t.diagnosticada_date else "",
        "Fecha Para Entregar": t.para_entregar_date.strftime("%Y-%m-%d %H:%M") if t.para_entregar_date else "",
        "Fecha Entregado": t.entregados_date.strftime("%Y-%m-%d %H:%M") if t.entregados_date else "",
    }


@router.get("/exportar")
@limiter.limit("20 per minute")
def exportar_datos(
    request: Request,
    db: Session = Depends(get_db),
    formato: str = Query("csv"),
    estado: str | None = Query(None),
    fecha_desde: str | None = Query(None),
    fecha_hasta: str | None = Query(None),
):
    query = db.query(RepairCard)
    if estado and estado != "todos":
        query = query.filter(RepairCard.status == estado)
    if fecha_desde:
        query = query.filter(RepairCard.start_date >= datetime.strptime(fecha_desde, "%Y-%m-%d"))
    if fecha_hasta:
        query = query.filter(RepairCard.start_date <= datetime.strptime(fecha_hasta, "%Y-%m-%d"))

    total_count = query.count()
    if total_count == 0:
        raise HTTPException(status_code=404, detail="No hay datos para exportar con los filtros especificados")

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    ordered = query.order_by(RepairCard.start_date.desc())

    if formato == "excel":
        if total_count > EXCEL_LIMIT:
            raise HTTPException(
                status_code=400,
                detail=f"Excel limitado a {EXCEL_LIMIT} filas. Use CSV para exportar más datos.",
            )
        tarjetas = ordered.all()
        datos = [_row_to_csv_dict(t) for t in tarjetas]
        df = pd.DataFrame(datos)
        output = BytesIO()
        with pd.ExcelWriter(output, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="Reparaciones")
        output.seek(0)
        return Response(
            content=output.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename=reparaciones_nanotronics_{timestamp}.xlsx"},
        )

    headers = [
        "ID", "Cliente", "WhatsApp", "Problema", "Estado", "Fecha Inicio", "Fecha Límite",
        "Tiene Cargador", "Notas Técnicas", "URL Imagen", "Fecha Diagnóstico",
        "Fecha Para Entregar", "Fecha Entregado",
    ]

    def generate_csv():
        yield "\ufeff"
        buf = StringIO()
        wr = csv.DictWriter(buf, fieldnames=headers)
        wr.writeheader()
        yield buf.getvalue()
        offset = 0
        while True:
            batch = ordered.offset(offset).limit(BATCH_SIZE).all()
            if not batch:
                break
            buf = StringIO()
            wr = csv.DictWriter(buf, fieldnames=headers)
            for t in batch:
                wr.writerow(_row_to_csv_dict(t))
            yield buf.getvalue()
            offset += BATCH_SIZE

    if total_count <= BATCH_SIZE:
        datos = [_row_to_csv_dict(t) for t in ordered.all()]
        df = pd.DataFrame(datos)
        output = BytesIO()
        df.to_csv(output, index=False, encoding="utf-8-sig")
        output.seek(0)
        return Response(
            content=output.getvalue(),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=reparaciones_nanotronics_{timestamp}.csv"},
        )

    return StreamingResponse(
        generate_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=reparaciones_nanotronics_{timestamp}.csv"},
    )
