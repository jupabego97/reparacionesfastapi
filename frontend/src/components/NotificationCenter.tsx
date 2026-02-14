import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { NotificationItem } from '../api/client';
import { io } from 'socket.io-client';
import { API_BASE } from '../api/client';

const BASE_POLLING_MS = 30000;
const HIDDEN_POLLING_MS = 120000;
const MAX_RETRY_DELAY_MS = 300000;

export default function NotificationCenter() {
    const qc = useQueryClient();
    const [open, setOpen] = useState(false);
    const [isVisible, setIsVisible] = useState(document.visibilityState === 'visible');
    const [isUserActive, setIsUserActive] = useState(true);
    const [lastActivityAt, setLastActivityAt] = useState(Date.now());
    const [retryCount, setRetryCount] = useState(0);
    const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
    const [syncSource, setSyncSource] = useState<'polling' | 'socket' | null>(null);

    useEffect(() => {
        const onVisibilityChange = () => setIsVisible(document.visibilityState === 'visible');
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
    }, []);

    useEffect(() => {
        const events: Array<keyof WindowEventMap> = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'];
        const onActivity = () => {
            setLastActivityAt(Date.now());
            setIsUserActive(true);
        };

        events.forEach(eventName => window.addEventListener(eventName, onActivity, { passive: true }));

        const interval = window.setInterval(() => {
            setIsUserActive(Date.now() - lastActivityAt < 60000);
        }, 5000);

        return () => {
            events.forEach(eventName => window.removeEventListener(eventName, onActivity));
            window.clearInterval(interval);
        };
    }, [lastActivityAt]);

    const pollingInterval = useMemo(() => {
        if (!isVisible || !isUserActive) {
            return HIDDEN_POLLING_MS;
        }

        if (retryCount > 0) {
            return Math.min(BASE_POLLING_MS * (2 ** retryCount), MAX_RETRY_DELAY_MS);
        }

        return BASE_POLLING_MS;
    }, [isVisible, isUserActive, retryCount]);

    const { data, isFetching, isError, refetch } = useQuery({
        queryKey: ['notificaciones'],
        queryFn: () => api.getNotificaciones(),
        refetchInterval: pollingInterval,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: false,
        staleTime: 10000,
        retry: false,
    });

    useEffect(() => {
        if (data) {
            setRetryCount(0);
            setLastSyncAt(new Date());
            if (!syncSource) {
                setSyncSource('polling');
            }
        }
    }, [data, syncSource]);

    useEffect(() => {
        if (isError) {
            setRetryCount(prev => Math.min(prev + 1, 8));
        }
    }, [isError]);

    useEffect(() => {
        const url = API_BASE || window.location.origin;
        const socket = io(url, { transports: ['polling', 'websocket'], reconnection: true });

        const onNewNotification = () => {
            setSyncSource('socket');
            setRetryCount(0);
            void refetch();
        };

        socket.on('notificacion_nueva', onNewNotification);

        return () => {
            socket.off('notificacion_nueva', onNewNotification);
            socket.disconnect();
        };
    }, [refetch]);

    const markAllMut = useMutation({
        mutationFn: () => api.markAllNotificationsRead(),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['notificaciones'] }),
    });

    const markReadMut = useMutation({
        mutationFn: (ids: number[]) => api.markNotificationsRead(ids),
        onSuccess: () => qc.invalidateQueries({ queryKey: ['notificaciones'] }),
    });

    const unreadCount = data?.unread_count || 0;
    const notifications = data?.notifications || [];

    const typeIcons: Record<string, string> = {
        info: 'fas fa-info-circle',
        success: 'fas fa-check-circle',
        warning: 'fas fa-exclamation-triangle',
        error: 'fas fa-times-circle',
    };
    const typeColors: Record<string, string> = {
        info: '#3b82f6',
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#ef4444',
    };

    const syncStatus = isFetching
        ? 'Sincronizando...'
        : isError
            ? `Error de red · reintento ${retryCount}`
            : `Sincronizado${lastSyncAt ? ` · ${lastSyncAt.toLocaleTimeString()}` : ''}${syncSource ? ` · ${syncSource}` : ''}`;

    return (
        <div className="notification-center">
            <button className="notification-bell" onClick={() => setOpen(!open)}>
                <i className="fas fa-bell"></i>
                {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>

            {open && (
                <>
                    <div className="notification-overlay" onClick={() => setOpen(false)} />
                    <div className="notification-panel">
                        <div className="notification-panel-header">
                            <h4><i className="fas fa-bell"></i> Notificaciones</h4>
                            {unreadCount > 0 && (
                                <button className="mark-all-btn" onClick={() => markAllMut.mutate()}>
                                    <i className="fas fa-check-double"></i> Marcar todas
                                </button>
                            )}
                        </div>
                        <div className="notification-sync-status">{syncStatus}</div>
                        <div className="notification-list">
                            {notifications.length === 0 ? (
                                <p className="empty-notif"><i className="fas fa-bell-slash"></i> Sin notificaciones</p>
                            ) : (
                                notifications.map((n: NotificationItem) => (
                                    <div key={n.id} className={`notification-item ${n.read ? 'read' : 'unread'}`}
                                        onClick={() => !n.read && markReadMut.mutate([n.id])}>
                                        <i className={typeIcons[n.type] || 'fas fa-info-circle'} style={{ color: typeColors[n.type] }}></i>
                                        <div className="notif-content">
                                            <strong>{n.title}</strong>
                                            <p>{n.message}</p>
                                            <small>{n.created_at?.slice(0, 16).replace('T', ' ')}</small>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
