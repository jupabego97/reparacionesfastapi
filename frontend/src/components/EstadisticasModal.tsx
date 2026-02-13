import { useQuery } from '@tanstack/react-query'
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { api } from '../api/client'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend)

interface Props {
  show: boolean
  onClose: () => void
}

export function EstadisticasModal({ show, onClose }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['estadisticas'],
    queryFn: () => api.getEstadisticas(),
    enabled: show,
  })

  if (!show) return null

  const d = data as {
    total_reparaciones?: number
    completadas_ultimo_mes?: number
    pendientes?: number
    con_notas_tecnicas?: number
    totales_por_estado?: Record<string, number>
    tasa_cargador?: { con_cargador: number; sin_cargador: number }
    top_problemas?: { problema: string; cantidad: number }[]
    tiempos_promedio_dias?: Record<string, number>
    generado_at?: string
  } | undefined

  const chartEstados = d?.totales_por_estado && {
    labels: ['Ingresado', 'En Diagnóstico', 'Para Entregar', 'Completados'],
    datasets: [{
      label: 'Cantidad',
      data: [
        d.totales_por_estado.ingresado ?? 0,
        d.totales_por_estado.diagnosticada ?? 0,
        d.totales_por_estado.para_entregar ?? 0,
        d.totales_por_estado.listos ?? 0,
      ],
      backgroundColor: [
        'rgba(3, 105, 161, 0.7)',
        'rgba(146, 64, 14, 0.7)',
        'rgba(91, 33, 182, 0.7)',
        'rgba(6, 95, 70, 0.7)',
      ],
    }],
  }

  const chartCargador = d?.tasa_cargador && {
    labels: ['Con Cargador', 'Sin Cargador'],
    datasets: [{
      data: [d.tasa_cargador.con_cargador, d.tasa_cargador.sin_cargador],
      backgroundColor: ['rgba(16, 185, 129, 0.7)', 'rgba(239, 68, 68, 0.7)'],
    }],
  }

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-xl">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title"><i className="fas fa-chart-bar me-2" /> Estadísticas del Sistema</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Cerrar" />
          </div>
          <div className="modal-body">
            {isLoading && (
              <div className="text-center py-5">
                <div className="spinner-border text-primary" role="status" />
                <p className="mt-3 text-muted">Cargando estadísticas...</p>
              </div>
            )}
            {error && (
              <div className="alert alert-danger">Error al cargar estadísticas</div>
            )}
            {d && !isLoading && (
              <>
                <div className="row mb-4">
                  <div className="col-md-3">
                    <div className="card text-center">
                      <div className="card-body">
                        <h3 className="text-primary">{d.total_reparaciones ?? 0}</h3>
                        <p className="text-muted mb-0">Total Reparaciones</p>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="card text-center">
                      <div className="card-body">
                        <h3 className="text-success">{d.completadas_ultimo_mes ?? 0}</h3>
                        <p className="text-muted mb-0">Completadas (mes)</p>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="card text-center">
                      <div className="card-body">
                        <h3 className="text-warning">{d.pendientes ?? 0}</h3>
                        <p className="text-muted mb-0">Pendientes</p>
                      </div>
                    </div>
                  </div>
                  <div className="col-md-3">
                    <div className="card text-center">
                      <div className="card-body">
                        <h3 className="text-info">{d.con_notas_tecnicas ?? 0}</h3>
                        <p className="text-muted mb-0">Con Diagnóstico</p>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="row">
                  <div className="col-md-6 mb-4">
                    <div className="card">
                      <div className="card-header"><strong>Distribución por Estado</strong></div>
                      <div className="card-body">{chartEstados && <Bar data={chartEstados} options={{ responsive: true, scales: { y: { beginAtZero: true } } }} />}</div>
                    </div>
                  </div>
                  <div className="col-md-6 mb-4">
                    <div className="card">
                      <div className="card-header"><strong>Reparaciones con/sin Cargador</strong></div>
                      <div className="card-body">{chartCargador && <Doughnut data={chartCargador} options={{ responsive: true, plugins: { legend: { position: 'bottom' } } }} />}</div>
                    </div>
                  </div>
                </div>
                {(d.top_problemas?.length ?? 0) > 0 && (
                  <div className="card mb-4">
                    <div className="card-header"><strong>Top 5 Problemas Más Frecuentes</strong></div>
                    <div className="card-body">
                      {d.top_problemas!.map((item, i) => {
                        const max = d.top_problemas![0]?.cantidad ?? 1
                        const progress = (item.cantidad / max) * 100
                        return (
                          <div key={i} className="mb-3">
                            <div className="d-flex justify-content-between mb-1">
                              <span><strong>{i + 1}.</strong> {item.problema}</span>
                              <span className="badge bg-primary">{item.cantidad}</span>
                            </div>
                            <div className="progress">
                              <div className="progress-bar" style={{ width: `${progress}%` }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {d.tiempos_promedio_dias && (
                  <div className="card">
                    <div className="card-header"><strong>Tiempos Promedio por Estado</strong></div>
                    <div className="card-body">
                      <div className="row">
                        <div className="col-md-4">
                          <div className="text-center p-3 bg-light rounded">
                            <h5 className="text-primary">{d.tiempos_promedio_dias.ingresado_a_diagnosticada ?? 0} días</h5>
                            <small className="text-muted">Ingresado → Diagnóstico</small>
                          </div>
                        </div>
                        <div className="col-md-4">
                          <div className="text-center p-3 bg-light rounded">
                            <h5 className="text-warning">{d.tiempos_promedio_dias.diagnosticada_a_para_entregar ?? 0} días</h5>
                            <small className="text-muted">Diagnóstico → Para Entregar</small>
                          </div>
                        </div>
                        <div className="col-md-4">
                          <div className="text-center p-3 bg-light rounded">
                            <h5 className="text-success">{d.tiempos_promedio_dias.para_entregar_a_entregados ?? 0} días</h5>
                            <small className="text-muted">Para Entregar → Completado</small>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
          <div className="modal-footer">
            <small className="text-muted me-auto">{d?.generado_at ? `Generado: ${d.generado_at}` : ''}</small>
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
