import { useState } from 'react';
import { api } from '../api/client';
import type { KanbanColumn } from '../api/client';
import { useQuery } from '@tanstack/react-query';

interface Props { onClose: () => void; }

export default function ExportarModal({ onClose }: Props) {
  const [formato, setFormato] = useState('csv');
  const [estado, setEstado] = useState('todos');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [loading, setLoading] = useState(false);

  const { data: columnas = [] } = useQuery<KanbanColumn[]>({ queryKey: ['columnas'], queryFn: api.getColumnas });

  const handleExport = async () => {
    setLoading(true);
    try {
      const blob = await api.exportar({ formato, estado: estado !== 'todos' ? estado : undefined, fecha_desde: fechaDesde || undefined, fecha_hasta: fechaHasta || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `reparaciones.${formato === 'csv' ? 'csv' : 'xlsx'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Error al exportar:', e);
    }
    setLoading(false);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-pro" onClick={e => e.stopPropagation()}>
        <div className="modal-pro-header">
          <h3><i className="fas fa-file-export"></i> Exportar Datos</h3>
          <button className="modal-close" onClick={onClose}><i className="fas fa-times"></i></button>
        </div>
        <div className="modal-pro-body">
          <div className="edit-form">
            <div className="form-group">
              <label><i className="fas fa-file-alt"></i> Formato</label>
              <select value={formato} onChange={e => setFormato(e.target.value)}>
                <option value="csv">CSV</option>
                <option value="excel">Excel (XLSX)</option>
              </select>
            </div>
            <div className="form-group">
              <label><i className="fas fa-filter"></i> Estado</label>
              <select value={estado} onChange={e => setEstado(e.target.value)}>
                <option value="todos">Todos</option>
                {columnas.map(c => <option key={c.key} value={c.key}>{c.title}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label><i className="fas fa-calendar"></i> Desde</label>
                <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} />
              </div>
              <div className="form-group">
                <label><i className="fas fa-calendar"></i> Hasta</label>
                <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
              </div>
            </div>
          </div>
        </div>
        <div className="modal-pro-footer">
          <button className="btn-cancel" onClick={onClose}>Cancelar</button>
          <button className="btn-save" onClick={handleExport} disabled={loading}>
            {loading ? <><i className="fas fa-spinner fa-spin"></i> Exportando...</> : <><i className="fas fa-download"></i> Exportar</>}
          </button>
        </div>
      </div>
    </div>
  );
}
