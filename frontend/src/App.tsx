import { useState, useEffect, lazy, Suspense, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { api } from './api/client';
import type { TarjetaBoardItem, KanbanColumn, Tag, UserInfo, TarjetasBoardResponse } from './api/client';
import { useAuth } from './contexts/AuthContext';
import LoginScreen from './components/LoginScreen';
import KanbanBoard from './components/KanbanBoard';
import BusquedaFiltros from './components/BusquedaFiltros';
import ConexionBadge from './components/ConexionBadge';
import NotificationCenter from './components/NotificationCenter';
import Toast from './components/Toast';
import ActivityFeed from './components/ActivityFeed';
import CalendarView from './components/CalendarView';
import BulkActionsBar from './components/BulkActionsBar';
import { useDebounce } from './hooks/useDebounce';
import { API_BASE } from './api/client';

const NuevaTarjetaModal = lazy(() => import('./components/NuevaTarjetaModal'));
const EditarTarjetaModal = lazy(() => import('./components/EditarTarjetaModal'));
const EstadisticasModal = lazy(() => import('./components/EstadisticasModal'));
const ExportarModal = lazy(() => import('./components/ExportarModal'));

type ThemeMode = 'light' | 'dark';
type ViewMode = 'kanban' | 'calendar';

type ReorderItem = { id: number; columna: string; posicion: number };

function loadFilters() {
  try {
    const saved = localStorage.getItem('kanban-filters');
    return saved ? JSON.parse(saved) : { search: '', estado: '', prioridad: '', asignado_a: '', cargador: '', tag: '' };
  } catch {
    return { search: '', estado: '', prioridad: '', asignado_a: '', cargador: '', tag: '' };
  }
}

function applyCardPatch(data: TarjetasBoardResponse | undefined, card: TarjetaBoardItem): TarjetasBoardResponse | undefined {
  if (!data) return data;
  const idx = data.tarjetas.findIndex(t => t.id === card.id);
  if (idx === -1) {
    return { ...data, tarjetas: [card, ...data.tarjetas] };
  }
  const next = [...data.tarjetas];
  next[idx] = { ...next[idx], ...card };
  return { ...data, tarjetas: next };
}

function removeCardPatch(data: TarjetasBoardResponse | undefined, id: number): TarjetasBoardResponse | undefined {
  if (!data) return data;
  return { ...data, tarjetas: data.tarjetas.filter(t => t.id !== id) };
}

function applyReorderPatch(data: TarjetasBoardResponse | undefined, items: ReorderItem[]): TarjetasBoardResponse | undefined {
  if (!data || !items.length) return data;
  const byId = new Map(items.map(i => [i.id, i]));
  const next = data.tarjetas.map(t => {
    const upd = byId.get(t.id);
    return upd ? { ...t, columna: upd.columna, posicion: upd.posicion } : t;
  });
  return { ...data, tarjetas: next };
}

async function fetchBoardCards(params: {
  search?: string;
  estado?: string;
  prioridad?: string;
  asignado_a?: number;
  cargador?: string;
  tag?: number;
}): Promise<TarjetasBoardResponse> {
  const first = await api.getTarjetasBoard({
    ...params,
    page: 1,
    per_page: 500,
    includeImageThumb: true,
  });

  if (!first.pagination?.has_next) return first;

  const tarjetas = [...first.tarjetas];
  const pages = first.pagination.pages || 1;

  for (let page = 2; page <= pages; page += 1) {
    const nextPage = await api.getTarjetasBoard({
      ...params,
      page,
      per_page: first.pagination.per_page || 500,
      includeImageThumb: true,
    });
    tarjetas.push(...nextPage.tarjetas);
  }

  return { ...first, tarjetas };
}

export default function App() {
  const { user, isAuthenticated, logout, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const reorderBufferRef = useRef<ReorderItem[]>([]);
  const reorderTimerRef = useRef<number | null>(null);

  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('theme') as ThemeMode) || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');

  const [showNew, setShowNew] = useState(false);
  const [editCardId, setEditCardId] = useState<number | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showActivity, setShowActivity] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>('kanban');

  const [filtros, setFiltros] = useState(loadFilters);
  const debouncedSearch = useDebounce(filtros.search, 300);
  useEffect(() => {
    localStorage.setItem('kanban-filters', JSON.stringify(filtros));
  }, [filtros]);

  const [groupBy, setGroupBy] = useState<string>('none');
  const [compactView, setCompactView] = useState(false);

  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  const [undoAction, setUndoAction] = useState<{ cardId: number; oldCol: string; msg: string } | null>(null);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);

  const { data: boardData, isLoading: loadingCards } = useQuery<TarjetasBoardResponse>({
    queryKey: ['tarjetas-board', debouncedSearch, filtros.estado, filtros.prioridad, filtros.asignado_a, filtros.cargador, filtros.tag],
    queryFn: () => fetchBoardCards({
      search: debouncedSearch || undefined,
      estado: filtros.estado || undefined,
      prioridad: filtros.prioridad || undefined,
      asignado_a: filtros.asignado_a ? Number(filtros.asignado_a) : undefined,
      cargador: filtros.cargador || undefined,
      tag: filtros.tag ? Number(filtros.tag) : undefined,
    }),
    refetchOnWindowFocus: false,
    enabled: isAuthenticated,
  });

  const tarjetas = boardData?.tarjetas || [];

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

  const flushReorderBuffer = useCallback(() => {
    const items = reorderBufferRef.current;
    reorderBufferRef.current = [];
    reorderTimerRef.current = null;
    if (!items.length) return;
    qc.setQueriesData<TarjetasBoardResponse>({ queryKey: ['tarjetas-board'] }, old => applyReorderPatch(old, items));
  }, [qc]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const url = API_BASE || window.location.origin;
    const s = io(url, { transports: ['polling', 'websocket'], reconnection: true });

    s.on('connect', () => setConnStatus('connected'));
    s.on('disconnect', () => setConnStatus('disconnected'));
    s.on('connect_error', () => setConnStatus('disconnected'));

    s.on('tarjeta_creada', (card: TarjetaBoardItem) => {
      if (!card?.id) return;
      qc.setQueriesData<TarjetasBoardResponse>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, card));
      qc.invalidateQueries({ queryKey: ['notificaciones'] });
    });

    s.on('tarjeta_actualizada', (card: TarjetaBoardItem) => {
      if (!card?.id) return;
      qc.setQueriesData<TarjetasBoardResponse>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, card));
      qc.invalidateQueries({ queryKey: ['notificaciones'] });
    });

    s.on('tarjeta_eliminada', (payload: { id: number }) => {
      if (!payload?.id) return;
      qc.setQueriesData<TarjetasBoardResponse>({ queryKey: ['tarjetas-board'] }, old => removeCardPatch(old, payload.id));
    });

    s.on('tarjetas_reordenadas', (payload: { items?: ReorderItem[] }) => {
      const items = payload?.items;
      if (!Array.isArray(items) || !items.length) {
        qc.invalidateQueries({ queryKey: ['tarjetas-board'] });
        return;
      }
      reorderBufferRef.current.push(...items);
      if (reorderTimerRef.current == null) {
        reorderTimerRef.current = window.setTimeout(flushReorderBuffer, 150);
      }
    });

    setConnStatus('connecting');
    return () => {
      if (reorderTimerRef.current != null) {
        window.clearTimeout(reorderTimerRef.current);
      }
      s.disconnect();
    };
  }, [isAuthenticated, qc, flushReorderBuffer]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setShowNew(true); }
      else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); setShowStats(true); }
      else if (e.key === 'x' || e.key === 'X') { e.preventDefault(); setShowExport(true); }
      else if (e.key === '/') { e.preventDefault(); document.querySelector<HTMLInputElement>('.search-box input')?.focus(); }
      else if (e.key === 'Escape') {
        setShowNew(false);
        setEditCardId(null);
        setShowStats(false);
        setShowExport(false);
        setShowActivity(false);
        if (selectMode) {
          setSelectMode(false);
          setSelectedIds([]);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectMode]);

  const toggleSelect = useCallback((id: number) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }, []);

  const handleBlock = useCallback(async (id: number, reason: string) => {
    try {
      const updated = await api.blockTarjeta(id, reason);
      qc.setQueriesData<TarjetasBoardResponse>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, updated));
      setToast({ msg: 'Tarjeta bloqueada', type: 'info' });
    } catch {
      setToast({ msg: 'Error al bloquear', type: 'error' });
    }
  }, [qc]);

  const handleUnblock = useCallback(async (id: number) => {
    try {
      const updated = await api.unblockTarjeta(id);
      qc.setQueriesData<TarjetasBoardResponse>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, updated));
      setToast({ msg: 'Tarjeta desbloqueada', type: 'success' });
    } catch {
      setToast({ msg: 'Error al desbloquear', type: 'error' });
    }
  }, [qc]);

  const handleUndo = useCallback(async () => {
    if (!undoAction) return;
    try {
      const updated = await api.updateTarjeta(undoAction.cardId, { columna: undoAction.oldCol } as any);
      qc.setQueriesData<TarjetasBoardResponse>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, updated as TarjetaBoardItem));
      setUndoAction(null);
      setToast({ msg: 'Movimiento deshecho', type: 'success' });
    } catch {
      setToast({ msg: 'Error al deshacer', type: 'error' });
    }
  }, [undoAction, qc]);

  useEffect(() => {
    if (!undoAction) return;
    const t = setTimeout(() => setUndoAction(null), 8000);
    return () => clearTimeout(t);
  }, [undoAction]);

  if (authLoading) {
    return <div className="app-loading"><div className="spinner-large"></div><p>Cargando...</p></div>;
  }

  if (!isAuthenticated) {
    return <LoginScreen />;
  }

  return (
    <div className="app" data-theme={theme}>
      <header className="app-header">
        <div className="header-left">
          <h1 className="app-title">
            <i className="fas fa-microchip"></i> Nanotronics
          </h1>
          <ConexionBadge status={connStatus} />
        </div>
        <div className="header-actions">
          <button className="header-btn" onClick={() => setShowNew(true)} title="Nueva reparacion (N)">
            <i className="fas fa-plus"></i> <span className="btn-text">Nueva</span>
          </button>
          <button className="header-btn" onClick={() => setShowStats(true)} title="Estadisticas (E)">
            <i className="fas fa-chart-bar"></i>
          </button>
          <button className="header-btn" onClick={() => setShowExport(true)} title="Exportar (X)">
            <i className="fas fa-file-export"></i>
          </button>
          <button className="header-btn" onClick={() => setShowActivity(true)} title="Actividad">
            <i className="fas fa-stream"></i>
          </button>

          <select className="header-select" value={groupBy} onChange={e => setGroupBy(e.target.value)} title="Agrupar por">
            <option value="none">Sin agrupar</option>
            <option value="priority">Por prioridad</option>
            <option value="assignee">Por tecnico</option>
          </select>

          <button className={`header-btn ${compactView ? 'active' : ''}`} onClick={() => setCompactView(!compactView)}
            title="Vista compacta">
            <i className={compactView ? 'fas fa-th-list' : 'fas fa-th-large'}></i>
          </button>

          <NotificationCenter />

          <button className="header-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Cambiar tema">
            <i className={theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon'}></i>
          </button>

          <div className="user-menu">
            <div className="user-avatar" style={{ background: user?.avatar_color || '#00ACC1' }}>
              {user?.full_name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <span className="user-name">{user?.full_name}</span>
            <button className="btn-logout" onClick={logout} title="Cerrar sesion">
              <i className="fas fa-sign-out-alt"></i>
            </button>
          </div>
        </div>
      </header>

      <div className="toolbar-row">
        <div className="toolbar-left">
          <div className="view-toggle">
            <button className={`view-toggle-btn ${viewMode === 'kanban' ? 'active' : ''}`}
              onClick={() => setViewMode('kanban')}>
              <i className="fas fa-columns"></i> Kanban
            </button>
            <button className={`view-toggle-btn ${viewMode === 'calendar' ? 'active' : ''}`}
              onClick={() => setViewMode('calendar')}>
              <i className="fas fa-calendar-alt"></i> Calendario
            </button>
          </div>
          <span className="shortcuts-hint" title="N = Nueva | E = Estadisticas | X = Exportar | / = Buscar | Esc = Cerrar">
            <i className="fas fa-keyboard"></i> Atajos
          </span>
        </div>
        <div className="toolbar-right">
          <button className={`toolbar-btn ${selectMode ? 'active' : ''}`}
            onClick={() => { setSelectMode(!selectMode); if (selectMode) setSelectedIds([]); }}>
            <i className="fas fa-check-double"></i> {selectMode ? 'Cancelar seleccion' : 'Seleccionar'}
          </button>
        </div>
      </div>

      <BusquedaFiltros filtros={filtros} onChange={setFiltros} totalResults={tarjetas.length} users={users} tags={allTags}
        columnas={columnas.map(c => ({ key: c.key, title: c.title }))} />

      {viewMode === 'kanban' ? (
        <>
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
              onEdit={t => setEditCardId(t.id)} groupBy={groupBy} compactView={compactView}
              selectable={selectMode} selectedIds={selectedIds} onSelect={toggleSelect}
              onBlock={handleBlock} onUnblock={handleUnblock} />
          )}
        </>
      ) : (
        <CalendarView tarjetas={tarjetas} onSelect={t => setEditCardId(t.id)} />
      )}

      {selectMode && selectedIds.length > 0 && (
        <BulkActionsBar
          selectedIds={selectedIds}
          columns={columnas}
          onClear={() => setSelectedIds([])}
          onDone={() => {
            setSelectedIds([]);
            setSelectMode(false);
            qc.invalidateQueries({ queryKey: ['tarjetas-board'] });
            setToast({ msg: 'Operacion en lote completada', type: 'success' });
          }}
        />
      )}

      {undoAction && (
        <div className="undo-toast">
          <span>{undoAction.msg}</span>
          <button onClick={handleUndo}>Deshacer</button>
        </div>
      )}

      {showActivity && <ActivityFeed onClose={() => setShowActivity(false)} />}

      <button className="mobile-fab-new" onClick={() => setShowNew(true)} title="Nueva reparacion">
        <i className="fas fa-plus"></i>
        <span>Nueva</span>
      </button>

      <Suspense fallback={null}>
        {showNew && <NuevaTarjetaModal onClose={() => setShowNew(false)} />}
        {editCardId != null && <EditarTarjetaModal tarjetaId={editCardId} onClose={() => setEditCardId(null)} />}
        {showStats && <EstadisticasModal onClose={() => setShowStats(false)} />}
        {showExport && <ExportarModal onClose={() => setShowExport(false)} />}
      </Suspense>

      {toast && <Toast message={toast.msg} type={toast.type as any} onClose={() => setToast(null)} />}
    </div>
  );
}
