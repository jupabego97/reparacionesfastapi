import { useState, useEffect } from 'react';
import { api, type ActivityItem } from '../api/client';

const STATUS_LABELS: Record<string, string> = {
    ingresado: 'Ingresado',
    diagnosticada: 'Diagnosticada',
    para_entregar: 'Para Entregar',
    listos: 'Entregados',
};

export default function ActivityFeed({ onClose }: { onClose: () => void }) {
    const [items, setItems] = useState<ActivityItem[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.getActivityFeed(50).then(d => {
            setItems(d.actividad);
            setTotal(d.total);
            setLoading(false);
        }).catch(() => setLoading(false));
    }, []);

    const loadMore = () => {
        api.getActivityFeed(50, items.length).then(d => {
            setItems(prev => [...prev, ...d.actividad]);
        });
    };

    return (
        <div className="side-panel-overlay" onClick={onClose}>
            <div className="side-panel" onClick={e => e.stopPropagation()}>
                <div className="side-panel-header">
                    <h3><i className="fas fa-stream"></i> Actividad Reciente</h3>
                    <button className="btn-close-panel" onClick={onClose}><i className="fas fa-times"></i></button>
                </div>
                <div className="side-panel-body">
                    {loading ? (
                        <div className="activity-loading">Cargando...</div>
                    ) : items.length === 0 ? (
                        <div className="activity-empty">Sin actividad registrada</div>
                    ) : (
                        <div className="activity-list">
                            {items.map(item => (
                                <div key={item.id} className="activity-item">
                                    <div className="activity-icon">
                                        <i className="fas fa-arrow-right"></i>
                                    </div>
                                    <div className="activity-content">
                                        <div className="activity-text">
                                            <strong>{item.changed_by_name || 'Sistema'}</strong> movió{' '}
                                            <span className="activity-card-name">{item.nombre_propietario}</span>
                                            {item.old_status && (
                                                <>
                                                    {' '}de <span className="activity-status">{STATUS_LABELS[item.old_status] || item.old_status}</span>
                                                </>
                                            )}
                                            {' '}a <span className="activity-status highlight">{STATUS_LABELS[item.new_status] || item.new_status}</span>
                                        </div>
                                        <div className="activity-time">{item.changed_at}</div>
                                    </div>
                                </div>
                            ))}
                            {items.length < total && (
                                <button className="btn-load-more" onClick={loadMore}>
                                    Cargar más ({total - items.length} restantes)
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
