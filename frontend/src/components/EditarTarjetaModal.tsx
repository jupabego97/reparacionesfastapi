import { useEffect, useState } from 'react'
import { api, type Tarjeta } from '../api/client'

interface HistorialEntry {
  id: number
  tarjeta_id: number
  old_status: string | null
  new_status: string
  changed_at: string | null
}

interface Props {
  tarjeta: Tarjeta
  onClose: () => void
  onGuardar: (data: object) => void
  onEliminar?: () => void
}

const ESTADO_LABEL: Record<string, string> = {
  ingresado: 'Ingresado',
  diagnosticada: 'En Diagnóstico',
  para_entregar: 'Listos para Entregar',
  listos: 'Completados',
}

export function EditarTarjetaModal({ tarjeta, onClose, onGuardar, onEliminar }: Props) {
  const [nombre, setNombre] = useState(tarjeta.nombre_propietario || '')
  const [problema, setProblema] = useState(tarjeta.problema || '')
  const [whatsapp, setWhatsapp] = useState(tarjeta.whatsapp || '')
  const [fechaLimite, setFechaLimite] = useState((tarjeta.fecha_limite || '').slice(0, 10))
  const [notas, setNotas] = useState(tarjeta.notas_tecnicas || '')
  const [tieneCargador, setTieneCargador] = useState(tarjeta.tiene_cargador === 'si')
  const [imagenUrl, setImagenUrl] = useState(tarjeta.imagen_url || '')
  const [historial, setHistorial] = useState<HistorialEntry[]>([])

  useEffect(() => {
    api.getHistorial(tarjeta.id).then(setHistorial).catch(() => setHistorial([]))
  }, [tarjeta.id])

  const handleGuardar = () => {
    onGuardar({
      nombre_propietario: nombre || 'Cliente',
      problema: problema || 'Sin descripción',
      whatsapp: whatsapp,
      fecha_limite: fechaLimite || undefined,
      notas_tecnicas: notas || null,
      tiene_cargador: tieneCargador ? 'si' : 'no',
      imagen_url: imagenUrl || null,
    })
  }

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Editar reparación</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            <div className="mb-2">
              <label className="form-label">Cliente</label>
              <input className="form-control" value={nombre} onChange={e => setNombre(e.target.value)} />
            </div>
            <div className="mb-2">
              <label className="form-label">Problema</label>
              <textarea className="form-control" rows={2} value={problema} onChange={e => setProblema(e.target.value)} />
            </div>
            <div className="mb-2">
              <label className="form-label">WhatsApp (opcional)</label>
              <input className="form-control" value={whatsapp} onChange={e => setWhatsapp(e.target.value)} />
            </div>
            <div className="mb-2">
              <label className="form-label">Fecha límite</label>
              <input type="date" className="form-control" value={fechaLimite} onChange={e => setFechaLimite(e.target.value)} />
            </div>
            <div className="mb-2">
              <label className="form-label">Notas técnicas</label>
              <textarea className="form-control" rows={2} value={notas} onChange={e => setNotas(e.target.value)} />
            </div>
            <div className="mb-2">
              <div className="form-check">
                <input
                  type="checkbox"
                  className="form-check-input"
                  id="tieneCargador"
                  checked={tieneCargador}
                  onChange={e => setTieneCargador(e.target.checked)}
                />
                <label className="form-check-label" htmlFor="tieneCargador">Tiene cargador</label>
              </div>
            </div>
            <div className="mb-2">
              <label className="form-label">URL imagen (opcional)</label>
              <input className="form-control" value={imagenUrl} onChange={e => setImagenUrl(e.target.value)} placeholder="data:image/... o https://..." />
            </div>
            {(tarjeta.fecha_diagnosticada || tarjeta.fecha_para_entregar || tarjeta.fecha_entregada) && (
              <div className="mb-2 p-2 bg-light rounded small">
                <strong>Fechas de estado:</strong>
                {tarjeta.fecha_diagnosticada && <div>Diagnóstico: {tarjeta.fecha_diagnosticada}</div>}
                {tarjeta.fecha_para_entregar && <div>Para entregar: {tarjeta.fecha_para_entregar}</div>}
                {tarjeta.fecha_entregada && <div>Entregado: {tarjeta.fecha_entregada}</div>}
              </div>
            )}
            {historial.length > 0 && (
              <div className="mb-2">
                <label className="form-label">Historial de cambios</label>
                <ul className="list-group list-group-flush small">
                  {historial.map(h => (
                    <li key={h.id} className="list-group-item py-1 px-2">
                      {ESTADO_LABEL[h.old_status || ''] ?? h.old_status} → {ESTADO_LABEL[h.new_status] ?? h.new_status}
                      {h.changed_at && <span className="text-muted ms-1">({new Date(h.changed_at).toLocaleString()})</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-outline-danger me-auto" onClick={() => onEliminar?.()} title="Eliminar reparación">
              <i className="fas fa-trash me-1" /> Eliminar
            </button>
            <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            <button className="btn btn-primary" onClick={handleGuardar}>Guardar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
