import { useState } from 'react';
import { api, type KanbanColumn } from '../api/client';

interface BulkActionsBarProps {
    selectedIds: number[];
    columns: KanbanColumn[];
    onClear: () => void;
    onDone: () => void;
}

export default function BulkActionsBar({ selectedIds, columns, onClear, onDone }: BulkActionsBarProps) {
    const [loading, setLoading] = useState(false);

    const run = async (action: string, value?: string | number) => {
        if (!selectedIds.length) return;
        setLoading(true);
        try {
            await api.batchOperation(selectedIds, action, value);
            onDone();
        } catch (e) {
            console.error('Batch error:', e);
        } finally {
            setLoading(false);
        }
    };

    if (selectedIds.length === 0) return null;

    return (
        <div className="bulk-actions-bar">
            <div className="bulk-info">
                <i className="fas fa-check-square"></i>
                <span>{selectedIds.length} seleccionada{selectedIds.length > 1 ? 's' : ''}</span>
            </div>
            <div className="bulk-buttons">
                <div className="bulk-group">
                    <span className="bulk-label">Mover a:</span>
                    {columns.map(col => (
                        <button key={col.key} className="bulk-btn" onClick={() => run('move', col.key)} disabled={loading}
                            style={{ borderLeftColor: col.color }}>
                            {col.title}
                        </button>
                    ))}
                </div>
                <div className="bulk-group">
                    <span className="bulk-label">Prioridad:</span>
                    <button className="bulk-btn prio-alta" onClick={() => run('priority', 'alta')} disabled={loading}>Alta</button>
                    <button className="bulk-btn prio-media" onClick={() => run('priority', 'media')} disabled={loading}>Media</button>
                    <button className="bulk-btn prio-baja" onClick={() => run('priority', 'baja')} disabled={loading}>Baja</button>
                </div>
                <button className="bulk-btn bulk-delete" onClick={() => run('delete')} disabled={loading}>
                    <i className="fas fa-trash"></i> Eliminar
                </button>
            </div>
            <button className="bulk-clear" onClick={onClear}><i className="fas fa-times"></i></button>
        </div>
    );
}
