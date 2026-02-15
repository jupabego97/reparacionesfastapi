import { useState, useEffect, lazy, Suspense, useCallback, useRef, useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InfiniteData } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { api } from './api/client';
import type { TarjetaBoardItem, KanbanColumn, Tag, UserInfo, TarjetasBoardResponse, TarjetaUpdate, UserPreferences, SavedView } from './api/client';
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
import { EmptyState, ErrorState } from './components/UiState';
import { useDebounce } from './hooks/useDebounce';
import { API_BASE } from './api/client';

const NuevaTarjetaModal = lazy(() => import('./components/NuevaTarjetaModal'));
const EditarTarjetaModal = lazy(() => import('./components/EditarTarjetaModal'));
const EstadisticasModal = lazy(() => import('./components/EstadisticasModal'));
const ExportarModal = lazy(() => import('./components/ExportarModal'));

type ThemeMode = 'light' | 'dark';
type ViewMode = 'kanban' | 'calendar';
type ToastType = 'success' | 'warning' | 'info' | 'error';
type BoardInfiniteData = InfiniteData<TarjetasBoardResponse, number>;

type ReorderItem = { id: number; columna: string; posicion: number };
type SocketEnvelope<T> = { event_version?: number; data?: T } | T;

function unwrapSocketData<T>(payload: SocketEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

function loadFilters() {
  try {
    const saved = localStorage.getItem('kanban-filters');
    return saved ? JSON.parse(saved) : { search: '', estado: '', prioridad: '', asignado_a: '', cargador: '', tag: '' };
  } catch {
    return { search: '', estado: '', prioridad: '', asignado_a: '', cargador: '', tag: '' };
  }
}

const DEFAULT_PREFERENCES: UserPreferences = {
  saved_views: [],
  default_view: null,
  density: 'comfortable',
  theme: 'dark',
  mobile_behavior: 'horizontal_swipe',
};

function applyCardPatch(data: BoardInfiniteData | undefined, card: TarjetaBoardItem): BoardInfiniteData | undefined {
  if (!data) return data;
  let found = false;
  const nextPages = data.pages.map(page => {
    const idx = page.tarjetas.findIndex(t => t.id === card.id);
    if (idx === -1) return page;
    found = true;
    const nextTarjetas = [...page.tarjetas];
    nextTarjetas[idx] = { ...nextTarjetas[idx], ...card };
    return { ...page, tarjetas: nextTarjetas };
  });
  if (!found && nextPages.length > 0) {
    const first = nextPages[0];
    nextPages[0] = { ...first, tarjetas: [card, ...first.tarjetas] };
  }
  return { ...data, pages: nextPages };
}

function removeCardPatch(data: BoardInfiniteData | undefined, id: number): BoardInfiniteData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map(page => ({
      ...page,
      tarjetas: page.tarjetas.filter(t => t.id !== id),
    })),
  };
}

function applyReorderPatch(data: BoardInfiniteData | undefined, items: ReorderItem[]): BoardInfiniteData | undefined {
  if (!data || !items.length) return data;
  const byId = new Map(items.map(i => [i.id, i]));
  return {
    ...data,
    pages: data.pages.map(page => ({
      ...page,
      tarjetas: page.tarjetas.map(t => {
        const upd = byId.get(t.id);
        return upd ? { ...t, columna: upd.columna, posicion: upd.posicion } : t;
      }),
    })),
  };
}

async function fetchBoardCards(params: {
  page?: number;
  search?: string;
  estado?: string;
  prioridad?: string;
  asignado_a?: number;
  cargador?: string;
  tag?: number;
}): Promise<TarjetasBoardResponse> {
  return api.getTarjetasBoard({
    ...params,
    page: params.page ?? 1,
    per_page: 120,
    includeImageThumb: true,
  });
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
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [activeSavedViewId, setActiveSavedViewId] = useState<string>('');
  const hasAppliedDefaultViewRef = useRef(false);

  const { data: preferences = DEFAULT_PREFERENCES } = useQuery<UserPreferences>({
    queryKey: ['preferences'],
    queryFn: api.getMyPreferences,
    enabled: isAuthenticated,
  });

  const prefsMutation = useMutation({
    mutationFn: (nextPrefs: UserPreferences) => api.updateMyPreferences(nextPrefs),
    onSuccess: data => qc.setQueryData(['preferences'], data),
    onError: () => setToast({ msg: 'No se pudieron guardar preferencias', type: 'warning' }),
  });

  const boardQueryKey = useMemo(
    () => ['tarjetas-board', debouncedSearch, filtros.estado, filtros.prioridad, filtros.asignado_a, filtros.cargador, filtros.tag] as const,
    [debouncedSearch, filtros.estado, filtros.prioridad, filtros.asignado_a, filtros.cargador, filtros.tag],
  );
  const {
    data: boardData,
    isLoading: loadingCards,
    isError: boardIsError,
    error: boardError,
    refetch: refetchBoard,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<TarjetasBoardResponse, Error, BoardInfiniteData, typeof boardQueryKey, number>({
    queryKey: boardQueryKey,
    queryFn: ({ pageParam }) => fetchBoardCards({
      page: pageParam,
      search: debouncedSearch || undefined,
      estado: filtros.estado || undefined,
      prioridad: filtros.prioridad || undefined,
      asignado_a: filtros.asignado_a ? Number(filtros.asignado_a) : undefined,
      cargador: filtros.cargador || undefined,
      tag: filtros.tag ? Number(filtros.tag) : undefined,
    }),
    initialPageParam: 1,
    getNextPageParam: lastPage => lastPage.pagination?.has_next ? (lastPage.pagination.page + 1) : undefined,
    refetchOnWindowFocus: false,
    staleTime: 30_000, // 30s — socket events keep data fresh between refetches
    enabled: isAuthenticated,
  });

  const tarjetas = useMemo(() => {
    if (!boardData?.pages?.length) return [];
    const merged: TarjetaBoardItem[] = [];
    const seen = new Set<number>();
    for (const page of boardData.pages) {
      for (const t of page.tarjetas) {
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        merged.push(t);
      }
    }
    return merged;
  }, [boardData]);

  useEffect(() => {
    if (!isAuthenticated || !hasNextPage || isFetchingNextPage) return;
    const timer = window.setTimeout(() => {
      fetchNextPage().catch(() => undefined);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [isAuthenticated, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const { data: columnas = [] } = useQuery<KanbanColumn[]>({
    queryKey: ['columnas'],
    queryFn: api.getColumnas,
    staleTime: 5 * 60_000, // 5 min — columns rarely change
    enabled: isAuthenticated,
  });

  const { data: allTags = [] } = useQuery<Tag[]>({
    queryKey: ['tags'],
    queryFn: api.getTags,
    staleTime: 5 * 60_000, // 5 min — tags rarely change
    enabled: isAuthenticated,
  });

  const { data: users = [] } = useQuery<UserInfo[]>({
    queryKey: ['users'],
    queryFn: api.getUsers,
    staleTime: 5 * 60_000, // 5 min — users rarely change
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (!preferences || hasAppliedDefaultViewRef.current) return;
    hasAppliedDefaultViewRef.current = true;
    if (preferences.theme && preferences.theme !== theme) {
      setTheme(preferences.theme);
    }
    if (preferences.default_view) {
      const found = preferences.saved_views.find(v => v.id === preferences.default_view);
      if (found) {
        setFiltros(found.filtros);
        setGroupBy(found.groupBy);
        setCompactView(found.compactView);
        setViewMode(found.viewMode);
        setActiveSavedViewId(found.id);
      }
    }
  }, [preferences, theme]);

  useEffect(() => {
    const close = () => setShowMoreMenu(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  const saveCurrentView = useCallback(() => {
    const nextIndex = (preferences.saved_views?.length || 0) + 1;
    const nextView: SavedView = {
      id: `view_${Date.now()}`,
      name: `Vista ${nextIndex}`,
      filtros,
      groupBy,
      compactView,
      viewMode,
    };
    const saved_views = [...(preferences.saved_views || []), nextView];
    const payload: UserPreferences = {
      ...DEFAULT_PREFERENCES,
      ...preferences,
      saved_views,
      default_view: preferences.default_view || nextView.id,
      theme,
    };
    prefsMutation.mutate(payload);
    setActiveSavedViewId(nextView.id);
    setToast({ msg: 'Vista guardada', type: 'success' });
  }, [preferences, filtros, groupBy, compactView, viewMode, theme, prefsMutation]);

  const applySavedView = useCallback((viewId: string) => {
    setActiveSavedViewId(viewId);
    const selected = preferences.saved_views.find(v => v.id === viewId);
    if (!selected) return;
    setFiltros(selected.filtros);
    setGroupBy(selected.groupBy);
    setCompactView(selected.compactView);
    setViewMode(selected.viewMode);
  }, [preferences.saved_views]);

  const removeSavedView = useCallback(() => {
    if (!activeSavedViewId) return;
    const saved_views = preferences.saved_views.filter(v => v.id !== activeSavedViewId);
    const payload: UserPreferences = {
      ...DEFAULT_PREFERENCES,
      ...preferences,
      saved_views,
      default_view: preferences.default_view === activeSavedViewId ? null : preferences.default_view,
      theme,
    };
    prefsMutation.mutate(payload);
    setActiveSavedViewId('');
    setToast({ msg: 'Vista eliminada', type: 'info' });
  }, [activeSavedViewId, preferences, theme, prefsMutation]);

  const flushReorderBuffer = useCallback(() => {
    const items = reorderBufferRef.current;
    reorderBufferRef.current = [];
    reorderTimerRef.current = null;
    if (!items.length) return;
    qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old => applyReorderPatch(old, items));
  }, [qc]);

  useEffect(() => {
    if (!isAuthenticated) return;

    const url = API_BASE || window.location.origin;
    const s = io(url, { transports: ['websocket', 'polling'], reconnection: true });

    s.on('connect', () => setConnStatus('connected'));
    s.on('disconnect', () => setConnStatus('disconnected'));
    s.on('connect_error', () => setConnStatus('disconnected'));

    s.on('tarjeta_creada', (payload: SocketEnvelope<TarjetaBoardItem>) => {
      const card = unwrapSocketData(payload);
      if (!card?.id) return;
      qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, card));
      qc.invalidateQueries({ queryKey: ['notificaciones'] });
    });

    s.on('tarjeta_actualizada', (payload: SocketEnvelope<TarjetaBoardItem>) => {
      const card = unwrapSocketData(payload);
      if (!card?.id) return;
      qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, card));
      qc.invalidateQueries({ queryKey: ['notificaciones'] });
    });

    s.on('tarjeta_eliminada', (payload: SocketEnvelope<{ id: number }>) => {
      const data = unwrapSocketData(payload);
      if (!data?.id) return;
      qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old => removeCardPatch(old, data.id));
    });

    s.on('tarjetas_reordenadas', (payload: SocketEnvelope<{ items?: ReorderItem[] }>) => {
      const data = unwrapSocketData(payload);
      const items = data?.items;
      if (!Array.isArray(items) || !items.length) {
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
      qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, updated));
      setToast({ msg: 'Tarjeta bloqueada', type: 'info' });
    } catch {
      setToast({ msg: 'Error al bloquear', type: 'error' });
    }
  }, [qc]);

  const handleUnblock = useCallback(async (id: number) => {
    try {
      const updated = await api.unblockTarjeta(id);
      qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, updated));
      setToast({ msg: 'Tarjeta desbloqueada', type: 'success' });
    } catch {
      setToast({ msg: 'Error al desbloquear', type: 'error' });
    }
  }, [qc]);

  const handleUndo = useCallback(async () => {
    if (!undoAction) return;
    try {
      const updated = await api.updateTarjeta(undoAction.cardId, { columna: undoAction.oldCol } as TarjetaUpdate);
      qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, updated as TarjetaBoardItem));
      setUndoAction(null);
      setToast({ msg: 'Movimiento deshecho', type: 'success' });
    } catch {
      setToast({ msg: 'Error al deshacer', type: 'error' });
    }
  }, [undoAction, qc]);

  const toggleTheme = useCallback(() => {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    setTheme(nextTheme);
    const payload: UserPreferences = {
      ...DEFAULT_PREFERENCES,
      ...preferences,
      theme: nextTheme,
    };
    prefsMutation.mutate(payload);
  }, [theme, preferences, prefsMutation]);

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
          <button className="header-btn active" onClick={() => setShowNew(true)} title="Nueva reparacion (N)" aria-label="Crear nueva tarjeta">
            <i className="fas fa-plus"></i> <span className="btn-text">Nueva</span>
          </button>

          <select className="header-select" value={groupBy} onChange={e => setGroupBy(e.target.value)} title="Agrupar por" aria-label="Agrupar tarjetas">
            <option value="none">Sin agrupar</option>
            <option value="priority">Por prioridad</option>
            <option value="assignee">Por tecnico</option>
          </select>

          <button className={`header-btn ${compactView ? 'active' : ''}`} onClick={() => setCompactView(!compactView)}
            title="Vista compacta" aria-label="Alternar vista compacta">
            <i className={compactView ? 'fas fa-th-list' : 'fas fa-th-large'}></i>
          </button>

          <NotificationCenter />

          <button className="header-btn" onClick={toggleTheme} title="Cambiar tema" aria-label="Cambiar tema">
            <i className={theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon'}></i>
          </button>
          <div className="header-menu-wrap" onClick={e => e.stopPropagation()}>
            <button
              className="header-btn"
              onClick={() => setShowMoreMenu(!showMoreMenu)}
              aria-haspopup="menu"
              aria-expanded={showMoreMenu}
              aria-controls="header-more-menu"
              title="Mas acciones"
            >
              <i className="fas fa-ellipsis-h"></i> <span className="btn-text">Mas</span>
            </button>
            {showMoreMenu && (
              <div id="header-more-menu" className="header-more-menu" role="menu">
                <button className="header-more-item" role="menuitem" onClick={() => { setShowStats(true); setShowMoreMenu(false); }}>
                  <i className="fas fa-chart-bar"></i> Estadisticas
                </button>
                <button className="header-more-item" role="menuitem" onClick={() => { setShowExport(true); setShowMoreMenu(false); }}>
                  <i className="fas fa-file-export"></i> Exportar
                </button>
                <button className="header-more-item" role="menuitem" onClick={() => { setShowActivity(true); setShowMoreMenu(false); }}>
                  <i className="fas fa-stream"></i> Actividad
                </button>
              </div>
            )}
          </div>

          <div className="user-menu">
            <div className="user-avatar" style={{ background: user?.avatar_color || '#00ACC1' }}>
              {user?.full_name?.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <span className="user-name">{user?.full_name}</span>
            <button className="btn-logout" onClick={logout} title="Cerrar sesion" aria-label="Cerrar sesion">
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
          <select
            className="header-select"
            value={activeSavedViewId}
            onChange={e => applySavedView(e.target.value)}
            aria-label="Vistas guardadas"
          >
            <option value="">Vistas guardadas</option>
            {preferences.saved_views.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <button className="toolbar-btn" onClick={saveCurrentView} aria-label="Guardar vista actual">
            <i className="fas fa-save"></i> Guardar vista
          </button>
          <button className="toolbar-btn" disabled={!activeSavedViewId} onClick={removeSavedView} aria-label="Eliminar vista guardada">
            <i className="fas fa-trash"></i> Eliminar vista
          </button>
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
          ) : boardIsError ? (
            <ErrorState
              title="No se pudo cargar el tablero"
              message={boardError instanceof Error ? boardError.message : 'Error inesperado'}
              actionLabel="Reintentar"
              onAction={() => refetchBoard()}
            />
          ) : tarjetas.length === 0 ? (
            <EmptyState
              title="No hay tarjetas para mostrar"
              message={Object.values(filtros).some(Boolean) ? 'Pruebe limpiar o ajustar filtros.' : 'Cree su primera tarjeta para comenzar.'}
              actionLabel={Object.values(filtros).some(Boolean) ? 'Limpiar filtros' : 'Nueva tarjeta'}
              onAction={() => Object.values(filtros).some(Boolean) ? setFiltros({ search: '', estado: '', prioridad: '', asignado_a: '', cargador: '', tag: '' }) : setShowNew(true)}
            />
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

      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
