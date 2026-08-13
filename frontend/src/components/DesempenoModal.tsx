import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { DailyMetrics } from '../api/client';
import type { OperationalViewId } from '../utils/operationalViews';

interface Props {
  onClose: () => void;
  onOpenView?: (viewId: OperationalViewId) => void;
}

function deltaLabel(today: number, compare: number): { text: string; tone: 'up' | 'down' | 'flat' } {
  const diff = today - compare;
  if (Math.abs(diff) < 0.05) return { text: 'igual', tone: 'flat' };
  const sign = diff > 0 ? '+' : '';
  const rounded = Number.isInteger(diff) ? String(diff) : diff.toFixed(1);
  return { text: `${sign}${rounded}`, tone: diff > 0 ? 'up' : 'down' };
}

const COLUMN_LABELS: Record<string, string> = {
  ingresado: 'Ingresado',
  diagnosticada: 'Diagnóstico',
  para_entregar: 'Para entregar',
  listos: 'Entregados',
};

export default function DesempenoModal({ onClose, onOpenView }: Props) {
  const { data, isLoading, isError, refetch } = useQuery<DailyMetrics>({
    queryKey: ['metricas-diario'],
    queryFn: api.getDailyMetrics,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const openView = (viewId: OperationalViewId) => {
    onOpenView?.(viewId);
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-pro modal-lg desempeno-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="desempeno-title"
      >
        <div className="modal-pro-header">
          <h3 id="desempeno-title"><i className="fas fa-tachometer-alt"></i> Desempeño del día</h3>
          <button className="modal-close" onClick={onClose} aria-label="Cerrar"><i className="fas fa-times"></i></button>
        </div>

        <div className="modal-pro-body">
          {isLoading && (
            <div className="app-loading"><div className="spinner-large"></div></div>
          )}

          {isError && (
            <div className="desempeno-error">
              <p>No se pudieron cargar las métricas.</p>
              <button type="button" className="toolbar-btn" onClick={() => void refetch()}>Reintentar</button>
            </div>
          )}

          {data && (
            <>
              <div className="desempeno-meta">
                <span><i className="fas fa-calendar-day"></i> {data.fecha}</span>
                <span><i className="fas fa-clock"></i> {data.timezone}</span>
              </div>

              {data.alertas.length > 0 && (
                <div className="desempeno-alerts" role="status">
                  {data.alertas.map(alerta => (
                    <div key={alerta} className="desempeno-alert">
                      <i className="fas fa-exclamation-triangle"></i> {alerta}
                    </div>
                  ))}
                </div>
              )}

              <div className="desempeno-kpi-grid">
                {[
                  {
                    key: 'ingresos',
                    label: 'Ingresos hoy',
                    value: data.hoy.ingresos,
                    icon: 'fas fa-inbox',
                    vsAyer: deltaLabel(data.hoy.ingresos, data.ayer.ingresos),
                    vs7d: deltaLabel(data.hoy.ingresos, data.promedio_7d.ingresos),
                    action: undefined as OperationalViewId | undefined,
                  },
                  {
                    key: 'entregas',
                    label: 'Entregas hoy',
                    value: data.hoy.entregas,
                    icon: 'fas fa-check-double',
                    vsAyer: deltaLabel(data.hoy.entregas, data.ayer.entregas),
                    vs7d: deltaLabel(data.hoy.entregas, data.promedio_7d.entregas),
                    action: 'ready' as OperationalViewId,
                  },
                  {
                    key: 'balance',
                    label: 'Balance neto',
                    value: data.hoy.balance,
                    icon: 'fas fa-balance-scale',
                    vsAyer: deltaLabel(data.hoy.balance, data.ayer.entregas - data.ayer.ingresos),
                    vs7d: deltaLabel(data.hoy.balance, data.promedio_7d.entregas - data.promedio_7d.ingresos),
                    hint: data.hoy.balance >= 0 ? 'Cola se reduce' : 'Cola crece',
                    action: undefined as OperationalViewId | undefined,
                  },
                  {
                    key: 'bloqueadas',
                    label: 'Bloqueadas',
                    value: data.hoy.bloqueadas,
                    icon: 'fas fa-lock',
                    vsAyer: { text: 'abiertas', tone: 'flat' as const },
                    vs7d: { text: 'snapshot', tone: 'flat' as const },
                    action: 'blocked' as OperationalViewId,
                  },
                  {
                    key: 'fuera_sla',
                    label: 'Fuera de SLA',
                    value: data.hoy.fuera_sla,
                    icon: 'fas fa-hourglass-half',
                    vsAyer: { text: 'abiertas', tone: 'flat' as const },
                    vs7d: { text: 'snapshot', tone: 'flat' as const },
                    action: 'overdue' as OperationalViewId,
                  },
                  {
                    key: 'cobrado',
                    label: 'Cobrado hoy',
                    value: `$${data.hoy.cobrado.toLocaleString('es-CO')}`,
                    icon: 'fas fa-dollar-sign',
                    vsAyer: deltaLabel(data.hoy.cobrado, data.ayer.cobrado),
                    vs7d: deltaLabel(data.hoy.cobrado, data.promedio_7d.cobrado),
                    action: undefined as OperationalViewId | undefined,
                  },
                ].map(kpi => {
                  const clickable = !!kpi.action && !!onOpenView;
                  const Tag = clickable ? 'button' : 'div';
                  return (
                    <Tag
                      key={kpi.key}
                      type={clickable ? 'button' : undefined}
                      className={`desempeno-kpi ${clickable ? 'desempeno-kpi-actionable' : ''}`}
                      onClick={clickable ? () => openView(kpi.action!) : undefined}
                    >
                      <div className="desempeno-kpi-top">
                        <i className={kpi.icon}></i>
                        <span>{kpi.label}</span>
                      </div>
                      <div className="desempeno-kpi-value">{kpi.value}</div>
                      <div className="desempeno-kpi-deltas">
                        <span className={`delta ${kpi.vsAyer.tone}`}>vs ayer {kpi.vsAyer.text}</span>
                        <span className={`delta ${kpi.vs7d.tone}`}>vs 7d {kpi.vs7d.text}</span>
                      </div>
                      {'hint' in kpi && kpi.hint && <div className="desempeno-kpi-hint">{kpi.hint}</div>}
                      {clickable && <div className="desempeno-kpi-link">Ver en tablero →</div>}
                    </Tag>
                  );
                })}
              </div>

              <div className="desempeno-sections">
                <section className="desempeno-section">
                  <h4>Cola actual (WIP)</h4>
                  <div className="desempeno-wip">
                    {Object.keys(data.wip_por_columna).length === 0 ? (
                      <p className="empty-msg">Sin pendientes</p>
                    ) : (
                      Object.entries(data.wip_por_columna).map(([key, count]) => (
                        <div key={key} className="desempeno-wip-row">
                          <span>{COLUMN_LABELS[key] || key}</span>
                          <strong>{count}</strong>
                        </div>
                      ))
                    )}
                    <div className="desempeno-wip-row total">
                      <span>Total pendientes</span>
                      <strong>{data.hoy.pendientes}</strong>
                    </div>
                  </div>
                </section>

                <section className="desempeno-section">
                  <h4>Entregas por técnico (7 días)</h4>
                  <div className="desempeno-tech">
                    {data.por_tecnico_7d.length === 0 ? (
                      <p className="empty-msg">Sin entregas en la semana</p>
                    ) : (
                      data.por_tecnico_7d.map(tech => (
                        <div key={`${tech.id ?? 'none'}-${tech.nombre}`} className="desempeno-tech-row">
                          <span className="tech-name">{tech.nombre}</span>
                          <span className="tech-count">{tech.entregadas}</span>
                          <span className="tech-money">${tech.cobrado.toLocaleString('es-CO')}</span>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
