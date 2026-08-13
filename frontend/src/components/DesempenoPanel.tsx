import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar } from 'react-chartjs-2';
import { api } from '../api/client';
import type { DesempenoMetrics, DesempenoQuery, DesempenoTecnico, UserInfo } from '../api/client';
import { colombiaDateKey, formatDateKey, shiftDateKey } from '../utils/colombiaDate';

type Preset = 'hoy' | 'ayer' | '7d' | '30d' | 'rango';

function formatHours(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value < 24) return `${value.toLocaleString('es-CO')} h`;
  return `${(value / 24).toFixed(1)} d`;
}

function periodLabel(desde: string, hasta: string): string {
  if (desde === hasta) return formatDateKey(desde);
  return `${formatDateKey(desde)} – ${formatDateKey(hasta)}`;
}

function initials(name: string): string {
  return name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();
}

export default function DesempenoPanel() {
  const today = colombiaDateKey();
  const [preset, setPreset] = useState<Preset>('hoy');
  const [desde, setDesde] = useState(today);
  const [hasta, setHasta] = useState(today);
  const [tecnicoId, setTecnicoId] = useState('');
  const [selectedTechId, setSelectedTechId] = useState<number | null | 'all'>('all');

  const applyPreset = (next: Preset) => {
    setPreset(next);
    if (next === 'hoy') {
      setDesde(today);
      setHasta(today);
    } else if (next === 'ayer') {
      const yesterday = shiftDateKey(today, -1);
      setDesde(yesterday);
      setHasta(yesterday);
    } else if (next === '7d') {
      setDesde(shiftDateKey(today, -6));
      setHasta(today);
    } else if (next === '30d') {
      setDesde(shiftDateKey(today, -29));
      setHasta(today);
    }
  };

  const queryParams = useMemo(() => {
    const start = desde <= hasta ? desde : hasta;
    const end = desde <= hasta ? hasta : desde;
    return {
      desde: start,
      hasta: end,
      tecnico_id: tecnicoId ? Number(tecnicoId) : undefined,
    };
  }, [desde, hasta, tecnicoId]);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<DesempenoMetrics>({
    queryKey: ['desempeno', queryParams],
    queryFn: () => api.getDesempeno(queryParams),
    staleTime: 30_000,
  });
  const { data: users = [] } = useQuery<UserInfo[]>({ queryKey: ['users'], queryFn: api.getUsers, staleTime: 5 * 60_000 });
  const detailParams = selectedTechId !== 'all' && selectedTechId != null
    ? { ...queryParams, tecnico_id: selectedTechId, include_cierres: true }
    : null;
  const { data: detail } = useQuery<DesempenoMetrics>({
    queryKey: ['desempeno-detalle', detailParams],
    queryFn: () => api.getDesempeno(detailParams as DesempenoQuery),
    enabled: detailParams != null,
    staleTime: 30_000,
  });

  const chartData = useMemo(() => {
    const days = data?.por_dia ?? [];
    return {
      labels: days.map(day => formatDateKey(day.fecha)),
      datasets: [
        { label: 'Reparadas', data: days.map(day => day.reparadas), backgroundColor: '#0ea5e9', borderRadius: 6 },
        { label: 'Entregadas', data: days.map(day => day.entregadas), backgroundColor: '#22c55e', borderRadius: 6 },
        { label: 'Retrabajo', data: days.map(day => day.retrabajo), backgroundColor: '#ef4444', borderRadius: 6 },
      ],
    };
  }, [data]);

  if (isLoading || !data) {
    return (
      <div className="app-loading">
        {isError ? (
          <button className="btn-save" onClick={() => refetch()}>Reintentar</button>
        ) : (
          <div className="spinner-large"></div>
        )}
      </div>
    );
  }

  const resumen = data.resumen;
  const selectedTech: DesempenoTecnico | undefined = selectedTechId === 'all'
    ? undefined
    : data.tecnicos.find(item => item.id === selectedTechId);
  const cierres = detail?.tecnicos.find(item => item.id === selectedTechId)?.cierres
    ?? selectedTech?.cierres
    ?? [];
  const showChart = data.dias > 1;

  return (
    <div className="desempeno-panel">
      <div className="desempeno-filters">
        <div className="desempeno-presets" role="group" aria-label="Periodo">
          {([
            ['hoy', 'Hoy'],
            ['ayer', 'Ayer'],
            ['7d', '7 días'],
            ['30d', '30 días'],
            ['rango', 'Rango'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`desempeno-preset ${preset === key ? 'active' : ''}`}
              onClick={() => applyPreset(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="form-row desempeno-dates">
          <div className="form-group">
            <label htmlFor="desempeno-desde"><i className="fas fa-calendar-day"></i> Desde</label>
            <input
              id="desempeno-desde"
              type="date"
              value={desde}
              max={today}
              onChange={e => { setDesde(e.target.value); setPreset('rango'); }}
            />
          </div>
          <div className="form-group">
            <label htmlFor="desempeno-hasta"><i className="fas fa-calendar-day"></i> Hasta</label>
            <input
              id="desempeno-hasta"
              type="date"
              value={hasta}
              min={desde}
              max={today}
              onChange={e => { setHasta(e.target.value); setPreset('rango'); }}
            />
          </div>
          <div className="form-group">
            <label htmlFor="desempeno-tecnico"><i className="fas fa-user-cog"></i> Técnico</label>
            <select id="desempeno-tecnico" value={tecnicoId} onChange={e => { setTecnicoId(e.target.value); setSelectedTechId('all'); }}>
              <option value="">Todos</option>
              {users.map(user => (
                <option key={user.id} value={user.id}>{user.full_name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <p className="desempeno-period">
        {isFetching ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-clock"></i>}
        {' '}{periodLabel(data.desde, data.hasta)} · horario Colombia
      </p>

      <div className="desempeno-kpis">
        {[
          { label: 'Reparadas', value: resumen.reparadas, hint: 'Listos para entregar', color: '#0ea5e9' },
          { label: 'Entregadas', value: resumen.entregadas, hint: 'Completados al cliente', color: '#22c55e' },
          { label: 'Diagnósticos', value: resumen.diagnosticadas, hint: 'Entraron a diagnóstico', color: '#f59e0b' },
          { label: 'Retrabajo', value: resumen.retrabajo, hint: 'Volvieron a una etapa anterior', color: '#ef4444' },
          { label: 'Ciclo mediana', value: formatHours(resumen.tiempo_ciclo_mediana_horas), hint: 'Ingreso a entrega, sin bloqueos', color: '#8b5cf6' },
          { label: 'Notas técnicas', value: resumen.tasa_notas_tecnicas == null ? '—' : `${resumen.tasa_notas_tecnicas}%`, hint: 'Calidad documental al reparar', color: '#06b6d4' },
        ].map(kpi => (
          <div key={kpi.label} className="desempeno-kpi">
            <div className="desempeno-kpi-value" style={{ color: kpi.color }}>{kpi.value}</div>
            <div className="desempeno-kpi-label">{kpi.label}</div>
            <div className="desempeno-kpi-hint">{kpi.hint}</div>
          </div>
        ))}
      </div>

      {showChart && (
        <div className="desempeno-card">
          <h5>Actividad por día</h5>
          <Bar
            data={chartData}
            options={{
              responsive: true,
              plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
              scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
            }}
          />
        </div>
      )}

      <div className="desempeno-card desempeno-table-wrap">
        <h5>Desempeño por técnico</h5>
        <p className="desempeno-note">
          Se atribuye a quien movió la tarjeta. Los tiempos descuentan bloqueos. Evita rankings con pocos casos.
        </p>
        <div className="desempeno-table-scroll">
          <table className="desempeno-table">
            <thead>
              <tr>
                <th>Técnico</th>
                <th>Reparadas</th>
                <th>Entregadas</th>
                <th>Diagnósticos</th>
                <th>Retrabajo</th>
                <th>Ciclo</th>
                <th>Notas</th>
                <th>WIP</th>
              </tr>
            </thead>
            <tbody>
              {data.tecnicos.map(tech => (
                <tr
                  key={tech.id ?? 'sin-atribuir'}
                  className={selectedTechId === tech.id ? 'selected' : ''}
                  onClick={() => setSelectedTechId(tech.id)}
                >
                  <td>
                    <span className="desempeno-tech">
                      <span className="desempeno-avatar" style={{ background: tech.avatar_color || '#64748b' }}>
                        {initials(tech.nombre)}
                      </span>
                      <span>
                        {tech.nombre}
                        {tech.muestra_pequena && (tech.reparadas > 0 || tech.entregadas > 0) && (
                          <small className="desempeno-sample"> muestra pequeña</small>
                        )}
                      </span>
                    </span>
                  </td>
                  <td>{tech.reparadas}</td>
                  <td>{tech.entregadas}</td>
                  <td>{tech.diagnosticadas}</td>
                  <td>{tech.retrabajo}</td>
                  <td>{formatHours(tech.tiempo_ciclo_mediana_horas)}</td>
                  <td>{tech.tasa_notas_tecnicas == null ? '—' : `${tech.tasa_notas_tecnicas}%`}</td>
                  <td>{tech.carga_wip}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedTech && (
        <div className="desempeno-card">
          <h5>Detalle · {selectedTech.nombre}</h5>
          <div className="desempeno-detail-grid">
            <span>P90 ciclo: {formatHours(selectedTech.tiempo_ciclo_p90_horas)}</span>
            <span>Diagnóstico mediana: {formatHours(selectedTech.tiempo_diagnostico_mediana_horas)}</span>
            <span>Bloqueos: {selectedTech.bloqueos}</span>
            <span>Comentarios: {selectedTech.comentarios}</span>
            <span>Alta: {selectedTech.por_prioridad.alta} · Media: {selectedTech.por_prioridad.media} · Baja: {selectedTech.por_prioridad.baja}</span>
          </div>
          {cierres.length > 0 && (
            <ul className="desempeno-cierres">
              {cierres.map(cierre => (
                <li key={`${cierre.tarjeta_id}-${cierre.hora}`}>
                  <strong>#{cierre.tarjeta_id}</strong> {cierre.cliente || 'Cliente'} · {cierre.prioridad} · {cierre.hora}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
