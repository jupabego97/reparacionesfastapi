import { memo } from 'react';
import type { Tarjeta, KanbanColumn } from '../api/client';

interface Props {
  tarjeta: Tarjeta;
  columnas: KanbanColumn[];
  onEdit: (t: Tarjeta) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, newCol: string) => void;
  compact?: boolean;
}

const PRIORITY_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  alta: { icon: 'fas fa-arrow-up', color: '#ef4444', label: 'Alta' },
  media: { icon: 'fas fa-minus', color: '#f59e0b', label: 'Media' },
  baja: { icon: 'fas fa-arrow-down', color: '#22c55e', label: 'Baja' },
};

function timeColor(days: number): string {
  if (days <= 1) return '#22c55e';
  if (days <= 3) return '#f59e0b';
  if (days <= 7) return '#f97316';
  return '#ef4444';
}

function isOverdue(fechaLimite: string | null): boolean {
  if (!fechaLimite) return false;
  return new Date(fechaLimite) < new Date();
}

function TarjetaCard({ tarjeta, columnas, onEdit, onDelete: _onDelete, onMove, compact }: Props) {
  const t = tarjeta;
  const prio = PRIORITY_CONFIG[t.prioridad] || PRIORITY_CONFIG.media;
  const overdue = isOverdue(t.fecha_limite);
  const daysColor = timeColor(t.dias_en_columna || 0);
  const whatsNum = t.whatsapp ? t.whatsapp.replace(/\D/g, '') : null;
  const whatsUrl = whatsNum
    ? `https://wa.me/${whatsNum}?text=${encodeURIComponent(`Hola ${t.nombre_propietario || ''}, le escribimos de Nanotronics respecto a su equipo en reparación.`.trim())}`
    : null;

  if (compact) {
    return (
      <div className={`tarjeta-card compact ${overdue ? 'overdue' : ''}`} onClick={() => onEdit(t)}>
        <div className="tarjeta-compact-row">
          <span className="priority-dot" style={{ background: prio.color }}></span>
          <span className="tarjeta-name">{t.nombre_propietario || 'Cliente'}</span>
          {t.asignado_nombre && <span className="assigned-badge" title={t.asignado_nombre}>{t.asignado_nombre[0]}</span>}
          <div className="tarjeta-compact-actions">
            {t.tags?.length > 0 && <span className="tag-count">{t.tags.length} <i className="fas fa-tags"></i></span>}
            {whatsUrl && <a href={whatsUrl} target="_blank" rel="noopener noreferrer" className="btn-wa-sm" onClick={e => e.stopPropagation()} title="WhatsApp"><i className="fab fa-whatsapp"></i></a>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`tarjeta-card ${overdue ? 'overdue' : ''}`}>
      {/* Priority strip */}
      <div className="priority-strip" style={{ background: prio.color }}></div>

      {/* Header */}
      <div className="tarjeta-header">
        <div className="tarjeta-title-row">
          <i className={prio.icon} style={{ color: prio.color, fontSize: '0.75rem' }} title={`Prioridad ${prio.label}`}></i>
          <strong className="tarjeta-name" onClick={() => onEdit(t)}>{t.nombre_propietario || 'Cliente'}</strong>
        </div>
        <div className="tarjeta-meta">
          {t.asignado_nombre && (
            <span className="assigned-badge" title={`Asignado: ${t.asignado_nombre}`} style={{ background: '#6366f1' }}>
              {t.asignado_nombre.split(' ').map(w => w[0]).join('').slice(0, 2)}
            </span>
          )}
          {/* Mejora #16: Tiempo en columna */}
          {t.dias_en_columna > 0 && (
            <span className="days-badge" style={{ color: daysColor }} title={`${t.dias_en_columna} días en esta columna`}>
              <i className="fas fa-clock"></i> {t.dias_en_columna}d
            </span>
          )}
        </div>
      </div>

      {/* Problem */}
      {t.problema && t.problema !== 'Sin descripción' && (
        <p className="tarjeta-problem">{t.problema.length > 80 ? t.problema.slice(0, 80) + '...' : t.problema}</p>
      )}

      {/* Tags */}
      {t.tags && t.tags.length > 0 && (
        <div className="tarjeta-tags">
          {t.tags.map(tag => (
            <span key={tag.id} className="tag-chip" style={{ background: tag.color + '22', color: tag.color, borderColor: tag.color + '44' }}>
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {/* Subtasks progress bar (Mejora #3) */}
      {t.subtasks_total > 0 && (
        <div className="subtasks-progress">
          <div className="subtasks-bar">
            <div className="subtasks-fill" style={{ width: `${(t.subtasks_done / t.subtasks_total) * 100}%` }}></div>
          </div>
          <span className="subtasks-text">{t.subtasks_done}/{t.subtasks_total}</span>
        </div>
      )}

      {/* Image thumbnail */}
      {t.imagen_url && (
        <img src={t.imagen_url} alt="Equipo" className="tarjeta-thumbnail" loading="lazy" onClick={() => onEdit(t)} />
      )}

      {/* Footer */}
      <div className="tarjeta-footer">
        <div className="tarjeta-footer-left">
          {t.fecha_limite && (
            <span className={`date-badge ${overdue ? 'overdue' : ''}`}>
              <i className="fas fa-calendar-alt"></i> {t.fecha_limite}
            </span>
          )}
          {t.tiene_cargador === 'si' && <span className="charger-badge" title="Con cargador"><i className="fas fa-plug"></i></span>}
          {t.notas_tecnicas && <span className="notes-badge" title={t.notas_tecnicas}><i className="fas fa-wrench"></i></span>}
          {t.comments_count > 0 && <span className="comments-badge"><i className="fas fa-comment"></i> {t.comments_count}</span>}
          {t.costo_estimado != null && (
            <span className="cost-badge" title={`Estimado: $${t.costo_estimado.toLocaleString()}`}>
              <i className="fas fa-dollar-sign"></i>
            </span>
          )}
        </div>
        <div className="tarjeta-footer-right">
          {whatsUrl && (
            <a href={whatsUrl} target="_blank" rel="noopener noreferrer" className="btn-wa-action" title="Escribir por WhatsApp" onClick={e => e.stopPropagation()}>
              <i className="fab fa-whatsapp"></i> WA
            </a>
          )}
          <button className="btn-action btn-edit" onClick={() => onEdit(t)} title="Editar">
            <i className="fas fa-pen"></i>
          </button>
          <select className="move-select" value={t.columna}
            onChange={e => { e.stopPropagation(); onMove(t.id, e.target.value); }}
            onClick={e => e.stopPropagation()}>
            {columnas.map(c => <option key={c.key} value={c.key}>{c.title}</option>)}
          </select>
        </div>
      </div>
    </div>
  );
}

export default memo(TarjetaCard);
