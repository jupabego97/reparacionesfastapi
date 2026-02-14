import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { NotificationItem } from '../api/client';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

export default function NotificationCenter() {
    const qc = useQueryClient();
    const [open, setOpen] = useState(false);
    const bellBtnRef = useRef<HTMLButtonElement>(null);
    const markAllBtnRef = useRef<HTMLButtonElement>(null);


    const { data } = useQuery({
        queryKey: ['notificaciones'],
        queryFn: () => api.getNotificaciones(),
        refetchInterval: 30000,
    });

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

    const closePanel = () => setOpen(false);
    const { dialogRef, titleId, onKeyDown } = useDialogAccessibility({ onClose: closePanel, enabled: open, initialFocusRef: markAllBtnRef });

    useEffect(() => {
        if (!open || !dialogRef.current) return;
        if (unreadCount === 0) {
            requestAnimationFrame(() => dialogRef.current?.focus());
        }
    }, [dialogRef, open, unreadCount]);

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

    return (
        <div className="notification-center">
            <button ref={bellBtnRef} className="notification-bell" onClick={() => setOpen(!open)} aria-label={open ? "Cerrar panel de notificaciones" : "Abrir panel de notificaciones"}>
                <i className="fas fa-bell"></i>
                {unreadCount > 0 && <span className="notification-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>

            {open && (
                <>
                    <div className="notification-overlay" onClick={closePanel} />
                    <div className="notification-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} tabIndex={-1} onKeyDown={onKeyDown}>
                        <div className="notification-panel-header">
                            <h4 id={titleId}><i className="fas fa-bell"></i> Notificaciones</h4>
                            {unreadCount > 0 && (
                                <button ref={markAllBtnRef} className="mark-all-btn" onClick={() => markAllMut.mutate()} aria-label="Marcar todas las notificaciones como leídas">
                                    <i className="fas fa-check-double"></i> Marcar todas
                                </button>
                            )}
                        </div>
                        <div className="notification-list">
                            {notifications.length === 0 ? (
                                <p className="empty-notif"><i className="fas fa-bell-slash"></i> Sin notificaciones</p>
                            ) : (
                                notifications.map((n: NotificationItem) => (
                                    <div key={n.id} className={`notification-item ${n.read ? 'read' : 'unread'}`}
                                        onClick={() => !n.read && markReadMut.mutate([n.id])} role="button" tabIndex={0} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && !n.read) { e.preventDefault(); markReadMut.mutate([n.id]); } }} aria-label={`Notificación: ${n.title}`}>
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
