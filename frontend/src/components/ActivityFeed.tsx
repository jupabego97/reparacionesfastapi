import { useState, useEffect } from 'react';
import { api, type ActivityItem } from '../api/client';
import { formatAuditAction } from '../utils/auditLabels';
import { formatRelativeTime } from '../utils/formatRelativeTime';
import { useAuth } from '../contexts/AuthContext';
import { ErrorState, EmptyState } from './UiState';

const STATUS_LABELS: Record<string, string> = {
    ingresado: 'Ingresado',
    diagnosticada: 'Diagnosticada',
    para_entregar: 'Para entregar',
    listos: 'Entregados',
};

interface Props {
    onClose: () => void;
    onSelectTarjeta?: (id: number) => void;
}

export default function ActivityFeed({ onClose, onSelectTarjeta }: Props) {
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin';
    const [items, setItems] = useState<ActivityItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        api.getActivityFeed(50).then(d => {
            setItems(d.actividad);
            setTotal(d.total);
            setLoading(false);
            setError(null);
        }).catch((e: unknown) => {
            setLoading(false);
            setError(e instanceof Error ? e.message : 'No se pudo cargar la actividad');
        });
    }, []);

    const loadMore = () => {
        api.getActivityFeed(50, items.length).then(d => {
            setItems(prev => [...prev, ...d.actividad]);
        });
    };

    const handleSelect = (item: ActivityItem) => {
        if (item.tarjeta_id && onSelectTarjeta) {
            onSelectTarjeta(item.tarjeta_id);
            onClose();
        }
    };

    return (
        <div className="side-panel-overlay" onClick={onClose}>
            <div className="side-panel" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Actividad reciente">
                <div className="side-panel-header">
                    <h3><i className="fas fa-stream"></i> Actividad reciente</h3>
                    <button className="btn-close-panel" onClick={onClose} aria-label="Cerrar panel de actividad"><i className="fas fa-times"></i></button>
                </div>
                <div className="side-panel-body">
                    {loading ? (
                        <div className="activity-loading">Cargando...</div>
                    ) : error ? (
                        <ErrorState title="No se pudo cargar la actividad" message={error} />
                    ) : items.length === 0 ? (
                        <EmptyState title="Sin actividad registrada" message="Los cambios de estado apareceran aqui." />
                    ) : (
                        <div className="activity-list">
                            {items.map(item => (
                                <button
                                    type="button"
                                    key={item.id}
                                    className={`activity-item ${item.tarjeta_id ? 'activity-item-actionable' : ''}`}
                                    onClick={() => handleSelect(item)}
                                    disabled={!item.tarjeta_id || !onSelectTarjeta}
                                >
                                    <div className="activity-icon">
                                        <i className="fas fa-arrow-right"></i>
                                    </div>
                                    <div className="activity-content">
                                        <div className="activity-text">
                                            <strong>{formatAuditAction(item.action)}</strong>{' '}
                                            <span className="activity-card-name">{item.nombre_propietario}</span>
                                            {item.action === 'status_changed' && item.old_status && (
                                                <>
                                                    {' '}de <span className="activity-status">{STATUS_LABELS[item.old_status] || item.old_status}</span>
                                                    {' '}a <span className="activity-status highlight">{STATUS_LABELS[item.new_status] || item.new_status}</span>
                                                </>
                                            )}
                                        </div>
                                        <div className="activity-time">
                                            {formatRelativeTime(item.changed_at)}
                                            {item.changed_by_name ? ` · ${item.changed_by_name}` : ''}
                                            {isAdmin && item.client_ip ? ` · IP ${item.client_ip}` : ''}
                                        </div>
                                    </div>
                                </button>
                            ))}
                            {items.length < total && (
                                <button className="btn-load-more" onClick={loadMore}>
                                    Cargar mas ({total - items.length} restantes)
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
