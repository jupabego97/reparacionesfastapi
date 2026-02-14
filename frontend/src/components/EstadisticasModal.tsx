import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend } from 'chart.js';
import { Bar, Doughnut } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Title, Tooltip, Legend);

interface Props { onClose: () => void; }
interface EstadisticasData {
  totales_por_estado?: Record<string, number>;
  tiempos_promedio_dias?: Record<string, number>;
  distribucion_prioridad?: Record<string, number>;
  resumen_financiero?: { total_estimado?: number; total_cobrado?: number };
  tasa_cargador?: { con_cargador?: number; sin_cargador?: number };
  top_problemas?: Array<{ problema: string; cantidad: number }>;
  total_reparaciones?: number;
  completadas_ultimo_mes?: number;
  pendientes?: number;
  con_notas_tecnicas?: number;
}

export default function EstadisticasModal({ onClose }: Props) {
  const { data: stats, isLoading } = useQuery<EstadisticasData>({ queryKey: ['estadisticas'], queryFn: api.getEstadisticas as () => Promise<EstadisticasData> });

  if (isLoading || !stats) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-pro modal-lg" onClick={e => e.stopPropagation()}>
          <div className="modal-pro-header"><h3><i className="fas fa-chart-bar"></i> Estadísticas</h3><button className="modal-close" onClick={onClose}><i className="fas fa-times"></i></button></div>
          <div className="modal-pro-body"><div className="app-loading"><div className="spinner-large"></div></div></div>
        </div>
      </div>
    );
  }

  const s = stats;
  const estados = s.totales_por_estado || {};
  const tiempos = s.tiempos_promedio_dias || {};
  const prioridad = s.distribucion_prioridad || {};
  const financiero = s.resumen_financiero || {};
  const totalEstimado = financiero.total_estimado ?? 0;
  const totalCobrado = financiero.total_cobrado ?? 0;
  const topProblemas = s.top_problemas ?? [];

  const barData = {
    labels: Object.keys(estados).map((k: string) => ({ ingresado: 'Ingresado', diagnosticada: 'Diagnóstico', para_entregar: 'Para entregar', listos: 'Completados' }[k] || k)),
    datasets: [{ label: 'Cantidad', data: Object.values(estados), backgroundColor: ['#0ea5e9', '#f59e0b', '#8b5cf6', '#22c55e'], borderRadius: 8 }],
  };

  const chargerData = {
    labels: ['Con cargador', 'Sin cargador'],
    datasets: [{ data: [s.tasa_cargador?.con_cargador || 0, s.tasa_cargador?.sin_cargador || 0], backgroundColor: ['#22c55e', '#ef4444'], borderWidth: 0 }],
  };

  const prioData = {
    labels: ['Alta', 'Media', 'Baja'],
    datasets: [{ data: [prioridad.alta || 0, prioridad.media || 0, prioridad.baja || 0], backgroundColor: ['#ef4444', '#f59e0b', '#22c55e'], borderWidth: 0 }],
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-pro modal-lg" onClick={e => e.stopPropagation()}>
        <div className="modal-pro-header">
          <h3><i className="fas fa-chart-bar"></i> Estadísticas del Sistema</h3>
          <button className="modal-close" onClick={onClose}><i className="fas fa-times"></i></button>
        </div>
        <div className="modal-pro-body">
          {/* KPIs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '0.75rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Total', value: s.total_reparaciones || 0, icon: 'fas fa-tools', color: '#0ea5e9' },
              { label: 'Completadas/mes', value: s.completadas_ultimo_mes || 0, icon: 'fas fa-check-double', color: '#22c55e' },
              { label: 'Pendientes', value: s.pendientes || 0, icon: 'fas fa-clock', color: '#f59e0b' },
              { label: 'Con diagnóstico', value: s.con_notas_tecnicas || 0, icon: 'fas fa-stethoscope', color: '#8b5cf6' },
            ].map((kpi, i) => (
              <div key={i} style={{ background: 'var(--input-bg)', borderRadius: 'var(--radius-sm)', padding: '1rem', textAlign: 'center', border: '1px solid var(--border)' }}>
                <i className={kpi.icon} style={{ color: kpi.color, fontSize: '1.3rem' }}></i>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, marginTop: '0.3rem' }}>{kpi.value}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{kpi.label}</div>
              </div>
            ))}
          </div>

          {/* Charts */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <h5 style={{ fontSize: '0.8rem', marginBottom: '0.75rem', fontWeight: 600 }}>Distribución por Estado</h5>
              <Bar data={barData} options={{ responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }} />
            </div>
            <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <h5 style={{ fontSize: '0.8rem', marginBottom: '0.75rem', fontWeight: 600 }}>Cargador</h5>
              <div style={{ maxWidth: 200, margin: '0 auto' }}>
                <Doughnut data={chargerData} options={{ responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } } }} />
              </div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
            <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <h5 style={{ fontSize: '0.8rem', marginBottom: '0.75rem', fontWeight: 600 }}>Distribución por Prioridad</h5>
              <div style={{ maxWidth: 200, margin: '0 auto' }}>
                <Doughnut data={prioData} options={{ responsive: true, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } } }} />
              </div>
            </div>
            <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <h5 style={{ fontSize: '0.8rem', marginBottom: '0.75rem', fontWeight: 600 }}>Tiempos Promedio (días)</h5>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', padding: '0.5rem 0' }}>
                {[
                  { label: 'Ingresado → Diagnóstico', value: tiempos.ingresado_a_diagnosticada || 0, color: '#0ea5e9' },
                  { label: 'Diagnóstico → Listo', value: tiempos.diagnosticada_a_para_entregar || 0, color: '#f59e0b' },
                  { label: 'Listo → Entregado', value: tiempos.para_entregar_a_entregados || 0, color: '#22c55e' },
                ].map((t, i) => (
                  <div key={i}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.2rem' }}>
                      <span>{t.label}</span><strong>{t.value}d</strong>
                    </div>
                    <div style={{ height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${Math.min(t.value * 10, 100)}%`, background: t.color, borderRadius: 3 }}></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Financial summary */}
          {(totalEstimado > 0 || totalCobrado > 0) && (
            <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', marginBottom: '1rem' }}>
              <h5 style={{ fontSize: '0.8rem', marginBottom: '0.75rem', fontWeight: 600 }}><i className="fas fa-dollar-sign"></i> Resumen Financiero</h5>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', textAlign: 'center' }}>
                <div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#f59e0b' }}>${totalEstimado.toLocaleString()}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Total Estimado</div>
                </div>
                <div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#22c55e' }}>${totalCobrado.toLocaleString()}</div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Total Cobrado</div>
                </div>
              </div>
            </div>
          )}

          {/* Top Problems */}
          {topProblemas.length > 0 && (
            <div style={{ background: 'var(--input-bg)', padding: '1rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
              <h5 style={{ fontSize: '0.8rem', marginBottom: '0.75rem', fontWeight: 600 }}>Top 5 Problemas</h5>
              {topProblemas.map((p: { problema: string; cantidad: number }, i: number) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
                  <span style={{ fontSize: '0.8rem', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {i + 1}. {p.problema}
                  </span>
                  <strong style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>{p.cantidad}</strong>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
