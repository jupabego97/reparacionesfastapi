import { useState, useEffect, lazy, Suspense, useCallback, useRef, useMemo } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { useIsMobile } from './hooks/useIsMobile';
import { API_BASE } from './api/client';
import {
  applyActivityPatch,
  applyCardPatch,
  applyReorderPatch,
  removeCardPatch,
  type BoardInfiniteData,
  type ReorderItem,
} from './utils/boardCache';
import {
  cardMatchesOperationalView,
  filtersForOperationalView,
  OPERATIONAL_VIEWS,
  type OperationalViewId,
} from './utils/operationalViews';

const NuevaTarjetaModal = lazy(() => import('./components/NuevaTarjetaModal'));
const EditarTarjetaModal = lazy(() => import('./components/EditarTarjetaModal'));
const EstadisticasModal = lazy(() => import('./components/EstadisticasModal'));
const ExportarModal = lazy(() => import('./components/ExportarModal'));

type ThemeMode = 'light' | 'dark';
type ViewMode = 'kanban' | 'calendar';
type ToastType = 'success' | 'warning' | 'info' | 'error';
type BoardPageParam = string | number | undefined;

type SocketEnvelope<T> = { event_version?: number; data?: T } | T;

function PwaUpdateBanner({ onUpdate }: { onUpdate: () => void }) {
  return (
    <div className="pwa-update-banner" role="status" aria-live="polite">
      <span>
        <i className="fas fa-sync-alt"></i> Hay una nueva versión disponible.
      </span>
      <button type="button" onClick={onUpdate}>
        Actualizar
      </button>
    </div>
  );
}

function unwrapSocketData<T>(payload: SocketEnvelope<T>): T {
  if (payload && typeof payload === 'object' && 'data' in payload) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

const DEFAULT_FILTROS = { search: '', estado: '', prioridad: '', asignado_a: '', cargador: '', tag: '', orden_por: '', orden_dir: '' };

function filtersStorageKey(userId?: number | null) {
  return userId ? `kanban-filters-${userId}` : 'kanban-filters';
}

function loadFilters(userId?: number | null) {
  try {
    const saved = localStorage.getItem(filtersStorageKey(userId));
    return saved ? { ...DEFAULT_FILTROS, ...JSON.parse(saved) } : DEFAULT_FILTROS;
  } catch {
    return DEFAULT_FILTROS;
  }
}

const DEFAULT_PREFERENCES: UserPreferences = {
  saved_views: [],
  default_view: null,
  density: 'comfortable',
  theme: 'dark',
  mobile_behavior: 'horizontal_swipe',
};

async function fetchBoardCards(params: {
  cursor?: string;
  page?: number;
  search?: string;
  estado?: string;
  prioridad?: string;
  asignado_a?: number;
  cargador?: string;
  tag?: number;
  orden_por?: string;
  orden_dir?: string;
}): Promise<TarjetasBoardResponse> {
  return api.getTarjetasBoard({
    ...params,
    mode: 'fast',
    per_page: 200,
    per_column: 50,
    includeImageThumb: true,
    includeTotals: true,
  });
}

export default function App() {
  const { user, isAuthenticated, logout, loading: authLoading, token } = useAuth();
  const qc = useQueryClient();
  const isMobile = useIsMobile();
  const [mobileHome, setMobileHome] = useState(true);
  const reorderBufferRef = useRef<ReorderItem[]>([]);
  const reorderTimerRef = useRef<number | null>(null);

  const [theme, setTheme] = useState<ThemeMode>(() => (localStorage.getItem('theme') as ThemeMode) || 'dark');
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const [connStatus, setConnStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected');
  const [pwaUpdateAvailable, setPwaUpdateAvailable] = useState(false);
  useEffect(() => {
    const showUpdate = () => setPwaUpdateAvailable(true);
    window.addEventListener('pwa-update-available', showUpdate);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistration()
        .then(registration => {
          if (registration?.waiting) showUpdate();
        })
        .catch(() => {/* silencioso */});
    }

    return () => window.removeEventListener('pwa-update-available', showUpdate);
  }, []);

  const applyPwaUpdate = useCallback(() => {
    setPwaUpdateAvailable(false);
    window.dispatchEvent(new Event('pwa-activate-update'));
  }, []);

  const [showNew, setShowNew] = useState(false);
  const [editCardId, setEditCardId] = useState<number | null>(null);
  const [showStats, setShowStats] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showActivity, setShowActivity] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [operationalView, setOperationalView] = useState<OperationalViewId>('all');
  const [remoteEditRevision, setRemoteEditRevision] = useState(0);
  const [highlightCardIds, setHighlightCardIds] = useState<number[]>([]);
  const boardFiltersRef = useRef(DEFAULT_FILTROS);
  const editCardIdRef = useRef<number | null>(null);

  const [filtros, setFiltros] = useState(DEFAULT_FILTROS);
  const debouncedSearch = useDebounce(filtros.search, 300);

  useEffect(() => {
    if (user?.id) {
      setFiltros(loadFilters(user.id));
    }
  }, [user?.id]);


  useEffect(() => {
    editCardIdRef.current = editCardId;
  }, [editCardId]);

  useEffect(() => {
    if (user?.id) {
      localStorage.setItem(filtersStorageKey(user.id), JSON.stringify(filtros));
    }
  }, [filtros, user?.id]);

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
    () => ['tarjetas-board', debouncedSearch, filtros.estado, filtros.prioridad, filtros.asignado_a, filtros.cargador, filtros.tag, filtros.orden_por, filtros.orden_dir] as const,
    [debouncedSearch, filtros.estado, filtros.prioridad, filtros.asignado_a, filtros.cargador, filtros.tag, filtros.orden_por, filtros.orden_dir],
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
  } = useInfiniteQuery<TarjetasBoardResponse, Error, BoardInfiniteData, typeof boardQueryKey, BoardPageParam>({
    queryKey: boardQueryKey,
    queryFn: ({ pageParam }) => fetchBoardCards({
      cursor: typeof pageParam === 'string' ? pageParam : undefined,
      page: typeof pageParam === 'number' ? pageParam : undefined,
      search: debouncedSearch || undefined,
      estado: filtros.estado || undefined,
      prioridad: filtros.prioridad || undefined,
      asignado_a: filtros.asignado_a ? Number(filtros.asignado_a) : undefined,
      cargador: filtros.cargador || undefined,
      tag: filtros.tag ? Number(filtros.tag) : undefined,
      orden_por: filtros.orden_por || undefined,
      orden_dir: filtros.orden_dir || undefined,
    }),
    initialPageParam: undefined,
    getNextPageParam: lastPage => {
      if (lastPage.next_cursor != null && lastPage.next_cursor !== '') {
        return lastPage.next_cursor;
      }
      const pag = lastPage.pagination;
      if (pag?.has_next && typeof pag.page === 'number') {
        return pag.page + 1;
      }
      return undefined;
    },
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

  const displayTarjetas = useMemo(() => {
    if (operationalView === 'all') return tarjetas;
    return tarjetas.filter(t => cardMatchesOperationalView(t, operationalView));
  }, [tarjetas, operationalView]);

  useEffect(() => {
    if (!isAuthenticated || !hasNextPage || isFetchingNextPage) return;
    const delayMs = (boardData?.pages?.length ?? 0) <= 1 ? 250 : 150;
    const runFetch = () => {
      fetchNextPage().catch(() => undefined);
    };
    let idleId: number | undefined;
    let timerId: number | undefined;
    if (typeof requestIdleCallback !== 'undefined') {
      idleId = requestIdleCallback(runFetch, { timeout: delayMs });
    } else {
      timerId = window.setTimeout(runFetch, delayMs);
    }
    return () => {
      if (idleId != null && typeof cancelIdleCallback !== 'undefined') cancelIdleCallback(idleId);
      if (timerId != null) window.clearTimeout(timerId);
    };
  }, [isAuthenticated, hasNextPage, isFetchingNextPage, fetchNextPage, boardData?.pages?.length]);

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
    if (preferences.density === 'compact') {
      setCompactView(true);
    } else if (preferences.density === 'comfortable') {
      setCompactView(false);
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

  // Resetear a pantalla de inicio al volver de background (solo móvil, sin modal abierto)
  useEffect(() => {
    if (!isMobile) return;
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && !showNew && editCardId == null) {
        setMobileHome(true);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isMobile, showNew, editCardId]);

  const applyOperationalView = useCallback((viewId: OperationalViewId) => {
    setOperationalView(viewId);
    const partial = filtersForOperationalView(viewId, user);
    setFiltros(prev => ({ ...DEFAULT_FILTROS, ...partial, search: viewId === 'all' ? prev.search : '' }));
  }, [user]);

  const pulseCard = useCallback((id: number) => {
    setHighlightCardIds(prev => [...prev.filter(x => x !== id), id]);
    window.setTimeout(() => {
      setHighlightCardIds(prev => prev.filter(x => x !== id));
    }, 2500);
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
    if (!viewId) {
      setOperationalView('all');
      return;
    }
    const selected = preferences.saved_views.find(v => v.id === viewId);
    if (!selected) return;
    setOperationalView('all');
    setFiltros({ ...DEFAULT_FILTROS, ...selected.filtros });
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
    qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old => applyReorderPatch(old, items, boardFiltersRef.current));
  }, [qc]);

  const columnTotals = useMemo(() => {
    if (!boardData?.pages?.length) return undefined;
    for (const page of boardData.pages) {
      if (page.column_totals) return page.column_totals;
    }
    return undefined;
  }, [boardData]);

  const totalFilteredResults = useMemo(() => {
    if (operationalView !== 'all') return displayTarjetas.length;
    if (columnTotals) {
      return Object.values(columnTotals).reduce((sum, n) => sum + n, 0);
    }
    return tarjetas.length;
  }, [operationalView, displayTarjetas.length, columnTotals, tarjetas.length]);

  const activeBoardFilters = useMemo(() => ({
    search: debouncedSearch,
    estado: filtros.estado,
    prioridad: filtros.prioridad,
    asignado_a: filtros.asignado_a,
    cargador: filtros.cargador,
    tag: filtros.tag,
  }), [debouncedSearch, filtros.estado, filtros.prioridad, filtros.asignado_a, filtros.cargador, filtros.tag]);

  useEffect(() => {
    boardFiltersRef.current = { ...filtros, search: debouncedSearch };
  }, [filtros, debouncedSearch]);

  const displayColumnas = useMemo(
    () => columnas.map(c => (c.key === 'listos' ? { ...c, title: 'Entregados' } : c)),
    [columnas],
  );

  const { data: kanbanRules } = useQuery({
    queryKey: ['kanban-rules'],
    queryFn: api.getKanbanRules,
    staleTime: 5 * 60_000,
    enabled: isAuthenticated,
  });

  useEffect(() => {
    if (!isAuthenticated || !token) return;

    const url = API_BASE || window.location.origin;
    const safeModeEnv = import.meta.env.VITE_SOCKETIO_SAFE_MODE;
    const safeMode = safeModeEnv ? safeModeEnv === 'true' : import.meta.env.PROD;
    const s = io(url, {
      auth: { token },
      transports: safeMode ? ['polling'] : ['polling', 'websocket'],
      upgrade: !safeMode,
      reconnection: true,
    });

    s.on('connect', () => setConnStatus('connected'));
    s.on('disconnect', () => setConnStatus('disconnected'));
    s.on('connect_error', () => setConnStatus('disconnected'));

    s.on('tarjeta_creada', (payload: SocketEnvelope<TarjetaBoardItem>) => {
      const card = unwrapSocketData(payload);
      if (!card?.id) return;
      const filters = boardFiltersRef.current;
      qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, card, filters));
      pulseCard(card.id);
      setToast({ msg: `Nueva reparación: ${card.nombre_propietario || 'Cliente'}`, type: 'info' });
      qc.invalidateQueries({ queryKey: ['notificaciones'] });
    });

    s.on('tarjeta_actualizada', (payload: SocketEnvelope<TarjetaBoardItem>) => {
      const card = unwrapSocketData(payload);
      if (!card?.id) return;
      const filters = boardFiltersRef.current;
      qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, card, filters));
      if (editCardIdRef.current === card.id) {
        setRemoteEditRevision(v => v + 1);
      } else {
        pulseCard(card.id);
      }
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

    s.on('tarjeta_activity', (payload: SocketEnvelope<{ tarjeta_id?: number; kind?: string }>) => {
      const data = unwrapSocketData(payload);
      if (!data?.tarjeta_id) return;
      qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old =>
        applyActivityPatch(old, data.tarjeta_id!, data.kind || 'activity'),
      );
      if (editCardIdRef.current === data.tarjeta_id) {
        setRemoteEditRevision(v => v + 1);
        void qc.invalidateQueries({ queryKey: ['tarjeta-detail', data.tarjeta_id] });
      }
    });

    setConnStatus('connecting');
    return () => {
      if (reorderTimerRef.current != null) {
        window.clearTimeout(reorderTimerRef.current);
      }
      s.disconnect();
    };
  }, [isAuthenticated, token, qc, flushReorderBuffer, pulseCard]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); setShowNew(true); }
      else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); setShowStats(true); }
      else if (e.key === 'x' || e.key === 'X') { e.preventDefault(); setShowExport(true); }
      else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); setShowActivity(true); }
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
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const focused = document.activeElement as HTMLElement | null;
        if (!focused?.classList.contains('tarjeta-card')) return;
        const cards = Array.from(document.querySelectorAll<HTMLElement>('.tarjeta-card'));
        const idx = cards.indexOf(focused);
        if (idx === -1) return;
        const next = e.key === 'ArrowRight' ? cards[idx + 1] : cards[idx - 1];
        if (next) {
          e.preventDefault();
          next.focus();
        }
      } else if (e.key === 'Enter' && document.activeElement?.classList.contains('tarjeta-card')) {
        e.preventDefault();
        (document.activeElement as HTMLElement).click();
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
      qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, updated, boardFiltersRef.current));
      setToast({ msg: 'Tarjeta bloqueada', type: 'info' });
    } catch {
      setToast({ msg: 'Error al bloquear', type: 'error' });
    }
  }, [qc]);

  const handleUnblock = useCallback(async (id: number) => {
    try {
      const updated = await api.unblockTarjeta(id);
      qc.setQueriesData<BoardInfiniteData>({ queryKey: ['tarjetas-board'] }, old => applyCardPatch(old, updated, boardFiltersRef.current));
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

  const pwaUpdateBanner = pwaUpdateAvailable ? <PwaUpdateBanner onUpdate={applyPwaUpdate} /> : null;

  if (isMobile && mobileHome) {
    return (
      <div className="app" data-theme={theme}>
        <div className="mobile-home-screen">
          <div className="mobile-home-logo">
            <i className="fas fa-microchip"></i>
            <h1>Nanotronics</h1>
          </div>
          <div className="mobile-home-actions">
            <button className="mobile-home-btn mobile-home-btn-primary"
              onClick={() => { setMobileHome(false); setShowNew(true); }}>
              <i className="fas fa-plus-circle"></i>
              <span>Crear Reparación</span>
            </button>
            <button className="mobile-home-btn mobile-home-btn-secondary"
              onClick={() => setMobileHome(false)}>
              <i className="fas fa-columns"></i>
              <span>Ver Tablero</span>
            </button>
          </div>
          <ConexionBadge status={connStatus} />
          {pwaUpdateBanner}
        </div>

        <Suspense fallback={null}>
          {showNew && (
            <NuevaTarjetaModal
              onClose={() => setShowNew(false)}
              onSuccess={() => {
                setToast({ msg: 'Tarjeta creada correctamente', type: 'success' });
                qc.invalidateQueries({ queryKey: ['tarjetas-board'] });
              }}
            />
          )}
        </Suspense>
        <div aria-live="polite" aria-atomic="true">
          {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
        </div>
      </div>
    );
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

          <NotificationCenter onOpenTarjeta={id => setEditCardId(id)} />

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
      {pwaUpdateBanner}

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
          <span className="shortcuts-hint toolbar-secondary" title="N = Nueva | E = Estadisticas | X = Exportar | A = Actividad | / = Buscar | ←/→ = Tarjetas | Esc = Cerrar">
            <i className="fas fa-keyboard"></i> Atajos
          </span>
          <select
            className="header-select toolbar-secondary"
            value={activeSavedViewId}
            onChange={e => applySavedView(e.target.value)}
            aria-label="Vistas guardadas"
          >
            <option value="">Vistas guardadas</option>
            {preferences.saved_views.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <button className="toolbar-btn toolbar-secondary" onClick={saveCurrentView} aria-label="Guardar vista actual">
            <i className="fas fa-save"></i> Guardar vista
          </button>
          <button className="toolbar-btn toolbar-secondary" disabled={!activeSavedViewId} onClick={removeSavedView} aria-label="Eliminar vista guardada">
            <i className="fas fa-trash"></i> Eliminar vista
          </button>
          <select className="header-select toolbar-secondary" value={groupBy} onChange={e => setGroupBy(e.target.value)} title="Agrupar por" aria-label="Agrupar tarjetas">
            <option value="none">Sin agrupar</option>
            <option value="priority">Por prioridad</option>
            <option value="assignee">Por tecnico</option>
          </select>
          <button className={`toolbar-btn ${compactView ? 'active' : ''}`} onClick={() => {
            const next = !compactView;
            setCompactView(next);
            prefsMutation.mutate({
              ...DEFAULT_PREFERENCES,
              ...preferences,
              density: next ? 'compact' : 'comfortable',
              theme,
            });
          }}
            title="Vista compacta" aria-label="Alternar vista compacta">
            <i className={compactView ? 'fas fa-th-list' : 'fas fa-th-large'}></i> <span className="btn-text">Compacta</span>
          </button>
        </div>
        <div className="toolbar-right">
          <button className={`toolbar-btn ${selectMode ? 'active' : ''}`}
            onClick={() => { setSelectMode(!selectMode); if (selectMode) setSelectedIds([]); }}>
            <i className="fas fa-check-double"></i> {selectMode ? 'Cancelar seleccion' : 'Seleccionar'}
          </button>
        </div>
      </div>

      {viewMode === 'kanban' && (
        <div className="operational-views-bar" role="toolbar" aria-label="Vistas operativas">
          {OPERATIONAL_VIEWS.map(view => (
            <button
              key={view.id}
              type="button"
              className={`operational-view-btn ${operationalView === view.id ? 'active' : ''}`}
              onClick={() => applyOperationalView(view.id)}
              aria-pressed={operationalView === view.id}
            >
              <i className={view.icon}></i> {view.label}
            </button>
          ))}
        </div>
      )}

      <BusquedaFiltros filtros={filtros} onChange={f => { setOperationalView('all'); setFiltros(f); }} totalResults={totalFilteredResults} users={users} tags={allTags}
        columnas={displayColumnas.map(c => ({ key: c.key, title: c.title }))} />

      {isFetchingNextPage && (
        <div className="board-loading-banner" role="status" aria-live="polite">
          <i className="fas fa-spinner fa-spin"></i> Cargando más tarjetas…
        </div>
      )}

      <div className="view-container" key={viewMode}>
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
          ) : displayTarjetas.length === 0 ? (
            <EmptyState
              title="No hay tarjetas para mostrar"
              message={operationalView !== 'all'
                ? 'Ninguna tarjeta coincide con esta vista operativa.'
                : Object.values(filtros).some(Boolean) ? 'Pruebe limpiar o ajustar filtros.' : 'Cree su primera tarjeta para comenzar.'}
              actionLabel={operationalView !== 'all' ? 'Ver todas' : Object.values(filtros).some(Boolean) ? 'Limpiar filtros' : 'Nueva tarjeta'}
              onAction={() => operationalView !== 'all' ? applyOperationalView('all') : Object.values(filtros).some(Boolean) ? setFiltros(DEFAULT_FILTROS) : setShowNew(true)}
            />
          ) : (
            <KanbanBoard columnas={displayColumnas} tarjetas={displayTarjetas}
              boardFilters={activeBoardFilters}
              columnTotals={columnTotals}
              kanbanRules={kanbanRules}
              highlightCardIds={highlightCardIds}
              isFetchingMore={isFetchingNextPage}
              onEdit={t => setEditCardId(t.id)} groupBy={groupBy} compactView={compactView}
              selectable={selectMode} selectedIds={selectedIds} onSelect={toggleSelect}
              onBlock={handleBlock} onUnblock={handleUnblock}
              onMoveError={(err) => {
                let msg = err instanceof Error ? err.message : (err && typeof err === 'object' && 'message' in err) ? String((err as { message: unknown }).message) : 'Error desconocido';
                if (/ProgrammingError|psycopg2|SQL|column|relation|undefined/i.test(msg)) {
                  msg = 'No se pudo mover la tarjeta. Intenta de nuevo.';
                } else {
                  msg = `Error al mover: ${msg}`;
                }
                setToast({ msg, type: 'error' });
              }}
              onMoveBlocked={(msg) => setToast({ msg, type: 'warning' })}
              onMoveSuccess={(cardId, oldCol, newCol) => {
                const colTitle = displayColumnas.find(c => c.key === newCol)?.title || newCol;
                setToast({ msg: `Tarjeta movida a ${colTitle}`, type: 'success' });
                setUndoAction({ cardId, oldCol, msg: `Movida a ${colTitle}` });
              }} />
          )}
        </>
      ) : (
        <CalendarView tarjetas={displayTarjetas} onSelect={t => setEditCardId(t.id)} />
      )}
      </div>

      {selectMode && selectedIds.length > 0 && (
        <BulkActionsBar
          selectedIds={selectedIds}
          columns={displayColumnas}
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

      {showActivity && (
        <ActivityFeed
          onClose={() => setShowActivity(false)}
          onSelectTarjeta={id => setEditCardId(id)}
        />
      )}

      <button className="mobile-fab-new" onClick={() => setShowNew(true)} title="Nueva reparacion" aria-label="Crear nueva reparacion">
        <i className="fas fa-plus"></i>
        <span>Nueva Reparación</span>
      </button>

      <Suspense fallback={null}>
        {showNew && (
          <NuevaTarjetaModal
            onClose={() => setShowNew(false)}
            onSuccess={() => {
              setToast({ msg: 'Tarjeta creada correctamente', type: 'success' });
              qc.invalidateQueries({ queryKey: ['tarjetas-board'] });
            }}
          />
        )}
        {editCardId != null && (
          <EditarTarjetaModal
            tarjetaId={editCardId}
            remoteEditRevision={remoteEditRevision}
            onClose={() => setEditCardId(null)}
          />
        )}
        {showStats && <EstadisticasModal onClose={() => setShowStats(false)} />}
        {showExport && <ExportarModal onClose={() => setShowExport(false)} />}
      </Suspense>

      <div aria-live="polite" aria-atomic="true">
        {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
      </div>
    </div>
  );
}
