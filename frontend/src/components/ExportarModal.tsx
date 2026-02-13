import { useState } from 'react'
import { api } from '../api/client'

interface Props {
  show: boolean
  onClose: () => void
}

export function ExportarModal({ show, onClose }: Props) {
  const [formato, setFormato] = useState<'csv' | 'excel'>('csv')
  const [estado, setEstado] = useState('todos')
  const [fechaDesde, setFechaDesde] = useState('')
  const [fechaHasta, setFechaHasta] = useState('')
  const [descargando, setDescargando] = useState(false)
  const [error, setError] = useState('')

  if (!show) return null

  const descargar = async () => {
    setError('')
    setDescargando(true)
    try {
      const blob = await api.exportar({
        formato,
        estado: estado !== 'todos' ? estado : undefined,
        fecha_desde: fechaDesde || undefined,
        fecha_hasta: fechaHasta || undefined,
      })
      const ext = formato === 'excel' ? 'xlsx' : 'csv'
      const filename = `reparaciones_nanotronics_${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '')}.${ext}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setDescargando(false)
    }
  }

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title"><i className="fas fa-download me-2" /> Exportar Datos</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Cerrar" />
          </div>
          <div className="modal-body">
            <div className="mb-3">
              <label className="form-label"><strong>Formato</strong></label>
              <div className="form-check">
                <input type="radio" className="form-check-input" id="fmtCSV" checked={formato === 'csv'} onChange={() => setFormato('csv')} />
                <label className="form-check-label" htmlFor="fmtCSV"><i className="fas fa-file-csv text-success" /> CSV</label>
              </div>
              <div className="form-check">
                <input type="radio" className="form-check-input" id="fmtExcel" checked={formato === 'excel'} onChange={() => setFormato('excel')} />
                <label className="form-check-label" htmlFor="fmtExcel"><i className="fas fa-file-excel text-success" /> Excel (.xlsx)</label>
              </div>
            </div>
            <div className="mb-3">
              <label className="form-label"><strong>Filtrar por Estado</strong></label>
              <select className="form-select" value={estado} onChange={(e) => setEstado(e.target.value)}>
                <option value="todos">Todos</option>
                <option value="ingresado">Ingresado</option>
                <option value="diagnosticada">En Diagnóstico</option>
                <option value="para_entregar">Para Entregar</option>
                <option value="listos">Completados</option>
              </select>
            </div>
            <div className="mb-3">
              <label className="form-label"><strong>Rango de Fechas</strong></label>
              <div className="row">
                <div className="col-6">
                  <input type="date" className="form-control" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} placeholder="Desde" />
                </div>
                <div className="col-6">
                  <input type="date" className="form-control" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} placeholder="Hasta" />
                </div>
              </div>
            </div>
            {error && <div className="alert alert-danger">{error}</div>}
            <div className="alert alert-info">
              <i className="fas fa-info-circle" /> <small>Se exportarán los datos según los filtros seleccionados.</small>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={descargando}>Cancelar</button>
            <button type="button" className="btn btn-success" onClick={descargar} disabled={descargando}>
              <i className="fas fa-download me-1" /> {descargando ? 'Descargando...' : 'Descargar'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
