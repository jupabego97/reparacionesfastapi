import { memo } from 'react';
import type { TarjetaBoardItem, KanbanColumn } from '../api/client';

interface Props {
  tarjeta: TarjetaBoardItem;
  columnas: KanbanColumn[];
  onEdit: (t: TarjetaBoardItem) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, newCol: string) => void;
  compact?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: number) => void;
  onBlock?: (id: number, reason: string) => void;
  onUnblock?: (id: number) => void;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
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

function TarjetaCardComponent({ tarjeta, columnas, onEdit, onDelete: _onDelete, onMove, compact, selectable, selected, onSelect, dragHandleProps, isDragging }: Props) {
  const t = tarjeta;
  const prio = PRIORITY_CONFIG[t.prioridad] || PRIORITY_CONFIG.media;
  const overdue = isOverdue(t.fecha_limite);
  const daysColor = timeColor(t.dias_en_columna || 0);
  const whatsNum = t.whatsapp ? t.whatsapp.replace(/\D/g, '') : null;
  const whatsUrl = whatsNum
    ? `https://wa.me/${whatsNum}?text=${encodeURIComponent(`Hola ${t.nombre_propietario || ''}, le escribimos de Nanotronics respecto a su equipo en reparacion.`.trim())}`
    : null;
  const isBlocked = !!t.bloqueada;
  const notaTecnica = t.notas_tecnicas_resumen || t.notas_tecnicas || '';

  // Column arrow navigation (disabled for blocked cards)
  const canMove = !isBlocked;
  const colIndex = columnas.findIndex(c => c.key === t.columna);
  const prevCol = canMove && colIndex > 0 ? columnas[colIndex - 1] : null;
  const nextCol = canMove && colIndex < columnas.length - 1 ? columnas[colIndex + 1] : null;

  if (compact) {
    const compactThumb = t.cover_thumb_url || t.imagen_url || '';
    return (
      <div
        className={`tarjeta-card compact ${overdue ? 'overdue' : ''} ${isBlocked ? 'blocked' : ''} ${isDragging ? 'dragging' : ''}`}
        onClick={() => onEdit(t)}
        tabIndex={0}
        role="button"
        onKeyDown={e => { if (e.key === 'Enter') onEdit(t); }}
      >
        <div className="tarjeta-compact-row">
          {dragHandleProps && (
            <span className="drag-handle-compact" {...dragHandleProps} onClick={e => e.stopPropagation()}><i className="fas fa-grip-vertical"></i></span>
          )}
          {compactThumb && (
            <img
              src={compactThumb}
              alt="Equipo"
              className="tarjeta-compact-thumb"
              loading="lazy"
              onClick={e => { e.stopPropagation(); window.open(t.imagen_url || t.cover_thumb_url || '', '_blank', 'noopener,noreferrer'); }}
              style={{ cursor: 'pointer' }}
            />
          )}
          <span className="priority-dot" style={{ background: prio.color }}></span>
          <span className="tarjeta-name">{t.nombre_propietario || 'Cliente'}</span>
          {t.asignado_nombre && <span className="assigned-badge" title={t.asignado_nombre}>{t.asignado_nombre[0]}</span>}
          <div className="tarjeta-compact-actions">
            {t.tags?.length > 0 && <span className="tag-count">{t.tags.length} <i className="fas fa-tags"></i></span>}
            {whatsUrl && <a href={whatsUrl} target="_blank" rel="noopener noreferrer" className="btn-wa-sm" onClick={e => e.stopPropagation()} title="WhatsApp"><i className="fab fa-whatsapp"></i></a>}
            {canMove && columnas.length > 1 && (
              <div className="tarjeta-compact-arrows">
                <button className="btn-action btn-col-arrow btn-col-arrow-sm"
                  onClick={e => { e.stopPropagation(); if (prevCol) onMove(t.id, prevCol.key); }}
                  title={prevCol ? `Mover a ${prevCol.title}` : ''} aria-label={prevCol ? `Mover a ${prevCol.title}` : ''}
                  style={prevCol ? { borderColor: prevCol.color, color: prevCol.color } : { visibility: 'hidden' }}
                  disabled={!prevCol}>
                  <i className="fas fa-chevron-left"></i>
                </button>
                <button className="btn-action btn-col-arrow btn-col-arrow-sm"
                  onClick={e => { e.stopPropagation(); if (nextCol) onMove(t.id, nextCol.key); }}
                  title={nextCol ? `Mover a ${nextCol.title}` : ''} aria-label={nextCol ? `Mover a ${nextCol.title}` : ''}
                  style={nextCol ? { borderColor: nextCol.color, color: nextCol.color } : { visibility: 'hidden' }}
                  disabled={!nextCol}>
                  <i className="fas fa-chevron-right"></i>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`tarjeta-card ${overdue ? 'overdue' : ''} ${isBlocked ? 'blocked' : ''} ${selected ? 'card-selected' : ''} ${isDragging ? 'dragging' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={`Tarjeta de ${t.nombre_propietario || 'Cliente'}`}
      onKeyDown={e => {
        if (e.key === 'Enter') onEdit(t);
        if (e.key === ' ' && selectable) {
          e.preventDefault();
          onSelect?.(t.id);
        }
      }}
    >
      <div className="priority-strip" style={{ background: isBlocked ? '#ef4444' : prio.color }}></div>

      {dragHandleProps && (
        <div className="drag-handle" {...dragHandleProps} aria-label="Arrastrar tarjeta">
          <i className="fas fa-grip-vertical"></i>
        </div>
      )}

      {selectable && (
        <div className="card-checkbox" onClick={e => { e.stopPropagation(); onSelect?.(t.id); }}>
          <i className={selected ? 'fas fa-check-square' : 'far fa-square'}></i>
        </div>
      )}

      {isBlocked && (
        <div className="blocked-banner">
          <i className="fas fa-lock"></i> Bloqueada{t.motivo_bloqueo ? `: ${t.motivo_bloqueo}` : ''}
        </div>
      )}

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
          {t.dias_en_columna > 0 && (
            <span className="days-badge" style={{ color: daysColor }} title={`${t.dias_en_columna} dias en esta columna`}>
              <i className="fas fa-clock"></i> {t.dias_en_columna}d
            </span>
          )}
        </div>
      </div>

      {(t.problema_resumen || t.problema) && (t.problema || t.problema_resumen) !== 'Sin descripcion' && (
        <p className="tarjeta-problem" aria-label="Problema reportado">
          <strong>Problema:</strong> {t.problema_resumen || (t.problema!.length > 80 ? t.problema!.slice(0, 80) + '...' : t.problema)}
        </p>
      )}

      {notaTecnica && (
        <div className="tarjeta-notas-tecnicas" aria-label="Notas técnicas">
          <i className="fas fa-wrench"></i>
          <span><strong>Notas técnicas:</strong> {notaTecnica}</span>
        </div>
      )}

      {t.tags && t.tags.length > 0 && (
        <div className="tarjeta-tags">
          {t.tags.map(tag => (
            <span key={tag.id} className="tag-chip" style={{ background: tag.color + '22', color: tag.color, borderColor: tag.color + '44' }}>
              {tag.name}
            </span>
          ))}
        </div>
      )}

      {t.subtasks_total > 0 && (
        <div className="subtasks-progress">
          <div className="subtasks-bar">
            <div className="subtasks-fill" style={{ width: `${(t.subtasks_done / t.subtasks_total) * 100}%` }}></div>
          </div>
          <span className="subtasks-text">{t.subtasks_done}/{t.subtasks_total}</span>
        </div>
      )}

      {(t.cover_thumb_url || t.imagen_url) && (
        <img
          src={t.cover_thumb_url || t.imagen_url || ''}
          alt="Equipo"
          className="tarjeta-thumbnail"
          loading="lazy"
          onClick={e => { e.stopPropagation(); window.open(t.imagen_url || t.cover_thumb_url || '', '_blank', 'noopener,noreferrer'); }}
        />
      )}

      {/* Flechas de columna: overlay fijo en esquina superior derecha */}
      {canMove && columnas.length > 1 && (
        <div className="tarjeta-col-arrows-overlay">
          <button
            className="btn-col-arrow-overlay"
            onClick={e => { e.stopPropagation(); if (prevCol) onMove(t.id, prevCol.key); }}
            title={prevCol ? `← ${prevCol.title}` : ''}
            aria-label={prevCol ? `Mover a ${prevCol.title}` : ''}
            style={prevCol
              ? { '--arrow-color': prevCol.color } as React.CSSProperties
              : { visibility: 'hidden' } as React.CSSProperties}
            disabled={!prevCol}
          >
            <i className="fas fa-chevron-left"></i>
          </button>
          <button
            className="btn-col-arrow-overlay"
            onClick={e => { e.stopPropagation(); if (nextCol) onMove(t.id, nextCol.key); }}
            title={nextCol ? `${nextCol.title} →` : ''}
            aria-label={nextCol ? `Mover a ${nextCol.title}` : ''}
            style={nextCol
              ? { '--arrow-color': nextCol.color } as React.CSSProperties
              : { visibility: 'hidden' } as React.CSSProperties}
            disabled={!nextCol}
          >
            <i className="fas fa-chevron-right"></i>
          </button>
        </div>
      )}

      <div className="tarjeta-footer">
        <div className="tarjeta-footer-left">
          {t.fecha_limite && (
            <span className={`date-badge ${overdue ? 'overdue' : ''}`}>
              <i className="fas fa-calendar-alt"></i> {t.fecha_limite}
            </span>
          )}
          {t.tiene_cargador === 'si' && <span className="charger-badge" title="Con cargador"><i className="fas fa-plug"></i></span>}
          {t.comments_count > 0 && <span className="comments-badge"><i className="fas fa-comment"></i> {t.comments_count}</span>}
          {t.costo_estimado != null && (
            <span className="cost-badge" title={`Estimado: $${t.costo_estimado.toLocaleString()}`}>
              <i className="fas fa-dollar-sign"></i>
            </span>
          )}
        </div>
        <div className="tarjeta-footer-right">
          {whatsUrl && (
            <a href={whatsUrl} target="_blank" rel="noopener noreferrer" className="btn-wa-action btn-wa-big" title="Escribir por WhatsApp" onClick={e => e.stopPropagation()}>
              <i className="fab fa-whatsapp"></i> WhatsApp
            </a>
          )}
          <button className="btn-action btn-edit" onClick={() => onEdit(t)} title="Editar" aria-label="Editar tarjeta">
            <i className="fas fa-pen"></i>
          </button>
        </div>
      </div>
    </div>
  );
}

const TarjetaCard = memo(TarjetaCardComponent);
export default TarjetaCard;
