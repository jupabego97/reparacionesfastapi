import type { Tarjeta } from '../api/client'
import { toWhatsAppUrl } from '../utils/whatsappUrl'

interface Props {
  tarjeta: Tarjeta
  onEditar: (t: Tarjeta) => void
  onMover?: (t: Tarjeta, columna: string) => void
  columnas?: readonly string[]
  compacta?: boolean
}

const ESTADO_LABEL: Record<string, string> = {
  ingresado: 'Ingresado',
  diagnosticada: 'En Diagnóstico',
  para_entregar: 'Listos para Entregar',
  listos: 'Completados',
}

function escape(s: string | null): string {
  if (!s) return ''
  const d = document.createElement('div')
  d.textContent = s
  return d.innerHTML
}

export function TarjetaCard({ tarjeta, onEditar, onMover, columnas, compacta }: Props) {
  const whatsappUrl = toWhatsAppUrl(tarjeta.whatsapp)
  const fechaLimite = tarjeta.fecha_limite ? new Date(tarjeta.fecha_limite) : null
  const hoy = new Date()
  const vencida = fechaLimite && fechaLimite < hoy
  const n = escape(tarjeta.nombre_propietario || '')
  const p = escape(tarjeta.problema || '')
  const nt = escape(tarjeta.notas_tecnicas || '')

  if (compacta) {
    return (
      <div
        className="card repair-card border-start border-4 border-success mb-2"
        data-id={tarjeta.id}
        data-status={tarjeta.columna}
      >
        <div className="card-body py-2 px-3">
          <div className="d-flex justify-content-between align-items-center">
            <strong className="text-truncate flex-grow-1 me-2 mb-0">{n || 'Cliente'}</strong>
            <div className="d-flex gap-1">
              <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onEditar(tarjeta)} title="Editar">
                <i className="fas fa-edit" />
              </button>
              {whatsappUrl && (
                <a href={whatsappUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-success" title="WhatsApp">
                  <i className="fab fa-whatsapp" />
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const borderClass =
    tarjeta.columna === 'ingresado' ? 'border-primary' :
    tarjeta.columna === 'diagnosticada' ? 'border-warning' :
    tarjeta.columna === 'para_entregar' ? 'border-info' : 'border-success'

  return (
    <div
      className={`card repair-card border-start border-4 ${borderClass} mb-2`}
      data-id={tarjeta.id}
      data-status={tarjeta.columna}
    >
      <div className="card-header d-flex justify-content-between align-items-center py-2 px-2">
        <strong className="text-truncate flex-grow-1 me-2">{n || 'Cliente'}</strong>
        {whatsappUrl && (
          <a href={whatsappUrl} target="_blank" rel="noreferrer" className="btn btn-sm btn-success" title="WhatsApp">
            <i className="fab fa-whatsapp" /> <span className="d-none d-md-inline">WhatsApp</span>
          </a>
        )}
      </div>
      <div className="card-body py-2 px-2">
        <p className="card-text small mb-1">{p || '—'}</p>
        <div className="small text-muted mb-1">
          <i className="fas fa-calendar-alt me-1" />
          <span className={vencida ? 'text-danger fw-bold' : ''}>{tarjeta.fecha_limite || '—'}</span>
        </div>
        {tarjeta.tiene_cargador === 'si' ? (
          <span className="badge bg-success me-1"><i className="fas fa-plug me-1" />Con cargador</span>
        ) : (
          <span className="badge bg-warning text-dark"><i className="fas fa-plug-circle-exclamation me-1" />Sin cargador</span>
        )}
        {nt && (
          <div className="mt-2 p-2 bg-light border-start border-primary border-3 rounded small">
            <small className="text-muted d-block mb-1"><i className="fas fa-tools" /> Diagnóstico:</small>
            <small className="text-dark">{nt}</small>
          </div>
        )}
        {tarjeta.imagen_url && (tarjeta.imagen_url.startsWith('data:') || tarjeta.imagen_url.startsWith('http')) && (
          <div className="mt-2">
            <img
              src={tarjeta.imagen_url}
              alt=""
              className="img-fluid rounded"
              style={{ maxHeight: 120, objectFit: 'cover', cursor: 'pointer' }}
              loading="lazy"
              onClick={() => window.open(tarjeta.imagen_url!, '_blank')}
            />
          </div>
        )}
      </div>
      <div className="card-footer bg-transparent border-0 pt-0 pb-2 px-2">
        <div className="d-flex justify-content-between align-items-center">
          {columnas && onMover ? (
            <select
              className="form-select form-select-sm"
              style={{ maxWidth: 140 }}
              value={tarjeta.columna}
              onChange={(e) => onMover(tarjeta, e.target.value)}
            >
              {columnas.map((c) => (
                <option key={c} value={c}>{ESTADO_LABEL[c] ?? c}</option>
              ))}
            </select>
          ) : (
            <span />
          )}
          <button type="button" className="btn btn-sm btn-outline-primary" onClick={() => onEditar(tarjeta)}>
            <i className="fas fa-edit me-1" /> Editar
          </button>
        </div>
      </div>
    </div>
  )
}
