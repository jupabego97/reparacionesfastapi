import { useState } from 'react'

interface Filtros {
  busqueda: string
  estado: string
  fechaDesde: string
  fechaHasta: string
  cargador: string
  diagnostico: string
}

interface Props {
  filtros: Filtros
  onChange: (f: Filtros) => void
  onBusquedaChange: (s: string) => void
  totalResultados: number
}

export function BusquedaFiltros({ filtros, onChange, onBusquedaChange, totalResultados }: Props) {
  const [mostrarFiltros, setMostrarFiltros] = useState(false)

  const limpiar = () => {
    const vacio: Filtros = {
      busqueda: '',
      estado: '',
      fechaDesde: '',
      fechaHasta: '',
      cargador: '',
      diagnostico: '',
    }
    onChange(vacio)
    onBusquedaChange('')
  }

  return (
    <div className="row mb-4">
      <div className="col-12">
        <div className="d-flex justify-content-center flex-column align-items-center gap-3">
          <div className="input-group" style={{ maxWidth: 600 }}>
            <span className="input-group-text bg-white border-end-0">
              <i className="fas fa-search text-muted" />
            </span>
            <input
              type="text"
              className="form-control border-start-0 border-end-0 ps-0"
              placeholder="Buscar reparaciones..."
              value={filtros.busqueda}
              onChange={(e) => onBusquedaChange(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-outline-secondary border-start-0"
              onClick={() => setMostrarFiltros(!mostrarFiltros)}
            >
              <i className="fas fa-filter" /> Filtros
            </button>
          </div>
          {mostrarFiltros && (
            <div className="w-100" style={{ maxWidth: 800 }}>
              <div className="card">
                <div className="card-body">
                  <div className="row g-3">
                    <div className="col-md-3">
                      <label className="form-label small">Estado</label>
                      <select
                        className="form-select form-select-sm"
                        value={filtros.estado}
                        onChange={(e) => onChange({ ...filtros, estado: e.target.value })}
                      >
                        <option value="">Todos</option>
                        <option value="ingresado">Ingresado</option>
                        <option value="diagnosticada">En Diagnóstico</option>
                        <option value="para_entregar">Para Entregar</option>
                        <option value="listos">Completados</option>
                      </select>
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small">Fecha desde</label>
                      <input
                        type="date"
                        className="form-control form-control-sm"
                        value={filtros.fechaDesde}
                        onChange={(e) => onChange({ ...filtros, fechaDesde: e.target.value })}
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small">Fecha hasta</label>
                      <input
                        type="date"
                        className="form-control form-control-sm"
                        value={filtros.fechaHasta}
                        onChange={(e) => onChange({ ...filtros, fechaHasta: e.target.value })}
                      />
                    </div>
                    <div className="col-md-3">
                      <label className="form-label small">Cargador</label>
                      <select
                        className="form-select form-select-sm"
                        value={filtros.cargador}
                        onChange={(e) => onChange({ ...filtros, cargador: e.target.value })}
                      >
                        <option value="">Todos</option>
                        <option value="si">Con cargador</option>
                        <option value="no">Sin cargador</option>
                      </select>
                    </div>
                    <div className="col-md-6">
                      <label className="form-label small">Diagnóstico</label>
                      <select
                        className="form-select form-select-sm"
                        value={filtros.diagnostico}
                        onChange={(e) => onChange({ ...filtros, diagnostico: e.target.value })}
                      >
                        <option value="">Todos</option>
                        <option value="con">Con diagnóstico</option>
                        <option value="sin">Sin diagnóstico</option>
                      </select>
                    </div>
                    <div className="col-md-6 text-end d-flex align-items-end">
                      <button type="button" className="btn btn-sm btn-outline-secondary w-100" onClick={limpiar}>
                        <i className="fas fa-times me-1" /> Limpiar filtros
                      </button>
                    </div>
                  </div>
                  <div className="mt-2">
                    <small className="text-muted">
                      <i className="fas fa-info-circle" /> Mostrando <span className="fw-bold">{totalResultados}</span> resultados
                    </small>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
