import { useState, useEffect, lazy, Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { api } from './api/client';
import type { Tarjeta, KanbanColumn, Tag, UserInfo } from './api/client';
import { useAuth } from './contexts/AuthContext';
import LoginScreen from './components/LoginScreen';
import KanbanBoard from './components/KanbanBoard';
import BusquedaFiltros from './components/BusquedaFiltros';
import ConexionBadge from './components/ConexionBadge';
import NotificationCenter from './components/NotificationCenter';
import Toast from './components/Toast';
import { useDebounce } from './hooks/useDebounce';
import { API_BASE } from './api/client';

const NuevaTarjetaModal = lazy(() => import('./components/NuevaTarjetaModal'));
const EditarTarjetaModal = lazy(() => import('./components/EditarTarjetaModal'));
const EstadisticasModal = lazy(() => import('./components/EstadisticasModal'));
const ExportarModal = lazy(() => import('./components/ExportarModal'));

type ThemeMode = 'light' | 'dark';

export default function App() {
  const { user, isAuthenticated, logout, loading: authLoading } = useAuth();
  const qc = useQueryClient();

  // Theme
  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('theme') as ThemeMode) || 'dark');
  useEffect(() => { document.documentElement.setAttribute('data-theme', theme); localStorage.setItem('theme', theme); }, [theme]);

  // Connection
  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

  // Modals
  const [showNew, setShowNew] = useState(false);
  const [editCard, setEditCard] = useState<Tarjeta | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [showExport, setShowExport] = useState(false);

  // Filters
  const [filtros, setFiltros] = useState({ search: '', estado: '', prioridad: '', asignado_a: '', cargador: '', tag: '' });
  const debouncedSearch = useDebounce(filtros.search, 300);

  // Board preferences
  const [groupBy, setGroupBy] = useState<string>('none');
  const [compactView, setCompactView] = useState(false);

  // Toast
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

  // Queries
  const { data: tarjetas = [], isLoading: loadingCards } = useQuery<Tarjeta[]>({
    queryKey: ['tarjetas', debouncedSearch, filtros.estado, filtros.prioridad, filtros.asignado_a, filtros.cargador, filtros.tag],
    queryFn: () => api.getTarjetas({
      search: debouncedSearch || undefined,
      estado: filtros.estado || undefined,
      prioridad: filtros.prioridad || undefined,
      asignado_a: filtros.asignado_a ? Number(filtros.asignado_a) : undefined,
      tag: filtros.tag ? Number(filtros.tag) : undefined,
    }) as Promise<Tarjeta[]>,
    refetchOnWindowFocus: false,
    enabled: isAuthenticated,
  });

  const { data: columnas = [] } = useQuery<KanbanColumn[]>({
    queryKey: ['columnas'],
    queryFn: api.getColumnas,
    enabled: isAuthenticated,
  });

  const { data: allTags = [] } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn: api.getTags,
    enabled: isAuthenticated,
  });

  const { data: users = [] } = useQuery<UserInfo[]>({
    queryKey: ['users'],
    queryFn: api.getUsers,
    enabled: isAuthenticated,
  });

  // Socket.IO
  useEffect(() => {
    if (!isAuthenticated) return;
    const url = API_BASE || window.location.origin;
    const s = io(url, { transports: ['polling', 'websocket'], reconnection: true });
    s.on('connect', () => setConnStatus('connected'));
    s.on('disconnect', () => setConnStatus('disconnected'));
    s.on('connect_error', () => setConnStatus('disconnected'));
    s.on('tarjeta_creada', () => { qc.invalidateQueries({ queryKey: ['tarjetas'] }); qc.invalidateQueries({ queryKey: ['notificaciones'] }); });
    s.on('tarjeta_actualizada', () => { qc.invalidateQueries({ queryKey: ['tarjetas'] }); qc.invalidateQueries({ queryKey: ['notificaciones'] }); });
    s.on('tarjeta_eliminada', () => { qc.invalidateQueries({ queryKey: ['tarjetas'] }); });
    s.on('tarjetas_reordenadas', () => { qc.invalidateQueries({ queryKey: ['tarjetas'] }); });
    // socket reference kept in closure
    setConnStatus('connecting');
    return () => { s.disconnect(); };
  }, [isAuthenticated, qc]);

  // Mejora #18: Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't handle if typing in input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setShowNew(true); }
      else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); setShowStats(true); }
      else if (e.key === 'x' || e.key === 'X') { e.preventDefault(); setShowExport(true); }
      else if (e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('.search-box input')?.focus(); }
      else if (e.key === 'Escape') { setShowNew(false); setEditCard(null); setShowStats(false); setShowExport(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  if (authLoading) {
    return <div className="app-loading"><div className="spinner-large"></div><p>Cargando...</p></div>;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="app" data-theme={theme}>
      {/* Header */}
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">
            <i className="fas fa-microchip"></i> Nanotronics
          </h1>
          <ConexionBadge status={connStatus} />
        </div>
        <div className="header-actions">
          <button className="header-btn" onClick={() => setShowNew(true)} title="Nueva reparación (N)">
            <i className="fas fa-plus"></i> <span className="btn-text">Nueva</span>
          </button>
          <button className="header-btn" onClick={() => setShowStats(true)} title="Estadísticas (E)">
            <i className="fas fa-chart-bar"></i>
          </button>
          <button className="header-btn" onClick={() => setShowExport(true)} title="Exportar (X)">
            <i className="fas fa-file-export"></i>
          </button>

          {/* Group by (Mejora #14: Swimlanes) */}
          <select className="header-select" value={groupBy} onChange={e => setGroupBy(e.target.value)} title="Agrupar por">
            <option value="none">Sin agrupar</option>
            <option value="priority">Por prioridad</option>
            <option value="assignee">Por técnico</option>
          </select>

          {/* Mejora #15: Vista compacta toggle */}
          <button className={`header-btn ${compactView ? 'active' : ''}`} onClick={() => setCompactView(!compactView)}
            title="Vista compacta">
            <i className={compactView ? 'fas fa-th-list' : 'fas fa-th-large'}></i>
          </button>

          <NotificationCenter />

          <button className="header-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Cambiar tema">
            <i className={theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon'}></i>
          </button>

          {/* User menu */}
          <div className="user-menu">
            <div className="user-avatar" style={{ background: user?.avatar_color || '#00ACC1' }}>
              {user?.full_name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <span className="user-name">{user?.full_name}</span>
            <button className="btn-logout" onClick={logout} title="Cerrar sesión">
              <i className="fas fa-sign-out-alt"></i>
            </button>
          </div>
        </div>
      </header>

      {/* Keyboard shortcuts hint */}
      <div className="shortcuts-hint">
        <span title="N = Nueva | E = Estadísticas | X = Exportar | / = Buscar | Esc = Cerrar">
          <i className="fas fa-keyboard"></i> Atajos
        </span>
      </div>

      {/* Filters */}
      <BusquedaFiltros filtros={filtros} onChange={setFiltros} totalResults={tarjetas.length} users={users} tags={allTags}
        columnas={columnas.map(c => ({ key: c.key, title: c.title }))} />

      {/* Kanban Board */}
      {loadingCards ? (
        <div className="skeleton-board">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="skeleton-column">
              <div className="skeleton-header"></div>
              {[1, 2, 3].map(j => <div key={j} className="skeleton-card"></div>)}
            </div>
          ))}
        </div>
      ) : (
        <KanbanBoard columnas={columnas} tarjetas={tarjetas}
          onEdit={t => setEditCard(t)} groupBy={groupBy} compactView={compactView} />
      )}

      {/* Modals */}
      <Suspense fallback={null}>
        {showNew && <NuevaTarjetaModal onClose={() => setShowNew(false)} />}
        {editCard && <EditarTarjetaModal tarjeta={editCard} onClose={() => setEditCard(null)} />}
        {showStats && <EstadisticasModal onClose={() => setShowStats(false)} />}
        {showExport && <ExportarModal onClose={() => setShowExport(false)} />}
      </Suspense>

      {/* Toast */}
      {toast && <Toast message={toast.msg} type={toast.type as any} onClose={() => setToast(null)} />}
    </div>
  );
}
