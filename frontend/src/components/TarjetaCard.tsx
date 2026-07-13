import { memo, useState } from 'react';
import type { TarjetaBoardItem, KanbanColumn } from '../api/client';
import { toWhatsAppUrl, openWhatsAppSmart } from '../utils/whatsappUrl';
import BlockTarjetaModal from './BlockTarjetaModal';

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
  highlighted?: boolean;
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

function riskLabel(t: TarjetaBoardItem): { text: string; className: string; icon: string } | null {
  if (t.bloqueada) {
    return { text: t.motivo_bloqueo ? `Bloqueada: ${t.motivo_bloqueo}` : 'Bloqueada', className: 'risk-blocked', icon: 'fas fa-lock' };
  }
  if (isOverdue(t.fecha_limite)) {
    return { text: 'Vencida', className: 'risk-overdue', icon: 'fas fa-exclamation-circle' };
  }
  if ((t.dias_en_columna || 0) >= 7) {
    return { text: `${t.dias_en_columna}d en columna`, className: 'risk-aging', icon: 'fas fa-hourglass-half' };
  }
  if (t.fecha_limite) {
    const today = new Date().toISOString().split('T')[0];
    if (t.fecha_limite.startsWith(today)) {
      return { text: 'Vence hoy', className: 'risk-due-today', icon: 'fas fa-calendar-day' };
    }
  }
  return null;
}

function TarjetaCardComponent({
  tarjeta, columnas, onEdit, onDelete: _onDelete, onMove, compact, selectable, selected, onSelect,
  onBlock, onUnblock, dragHandleProps, isDragging, highlighted,
}: Props) {
  const t = tarjeta;
  const [showBlockModal, setShowBlockModal] = useState(false);
  const prio = PRIORITY_CONFIG[t.prioridad] || PRIORITY_CONFIG.media;
  const overdue = isOverdue(t.fecha_limite);
  const daysColor = timeColor(t.dias_en_columna || 0);
  const risk = riskLabel(t);
  const whatsUrl = toWhatsAppUrl(
    t.whatsapp,
    `Hola ${t.nombre_propietario || ''}, le escribimos de Nanotronics respecto a su equipo en reparacion.`.trim(),
  );
  const isBlocked = !!t.bloqueada;
  const notaTecnica = t.notas_tecnicas_resumen || t.notas_tecnicas || '';
  const thumb = t.cover_thumb_url || t.imagen_url || '';

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('button, a, .drag-handle, .drag-handle-compact, .card-checkbox, .tarjeta-col-arrows-overlay, .tarjeta-compact-arrows, .btn-block-card')) {
      return;
    }
    onEdit(t);
  };

  const handleBlockClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isBlocked) {
      onUnblock?.(t.id);
      return;
    }
    setShowBlockModal(true);
  };

  const canMove = !isBlocked;
  const colIndex = columnas.findIndex(c => c.key === t.columna);
  const prevCol = canMove && colIndex > 0 ? columnas[colIndex - 1] : null;
  const nextCol = canMove && colIndex < columnas.length - 1 ? columnas[colIndex + 1] : null;

  if (compact) {
    return (
      <>
        <div
          className={`tarjeta-card compact ${overdue ? 'overdue' : ''} ${isBlocked ? 'blocked' : ''} ${isDragging ? 'dragging' : ''} ${highlighted ? 'card-remote-pulse' : ''}`}
          onClick={() => onEdit(t)}
          tabIndex={0}
          role="button"
          onKeyDown={e => { if (e.key === 'Enter') onEdit(t); }}
        >
          <div className="tarjeta-compact-row">
            {dragHandleProps && (
              <span className="drag-handle-compact" {...dragHandleProps} onClick={e => e.stopPropagation()}><i className="fas fa-grip-vertical"></i></span>
            )}
            {selectable && (
              <div className="card-checkbox card-checkbox-compact" onClick={e => { e.stopPropagation(); onSelect?.(t.id); }}>
                <i className={selected ? 'fas fa-check-square' : 'far fa-square'}></i>
              </div>
            )}
            {thumb && (
              <img
                src={thumb}
                alt="Equipo"
                className="tarjeta-compact-thumb"
                width={28}
                height={28}
                loading="lazy"
                decoding="async"
                onClick={e => { e.stopPropagation(); window.open(t.imagen_url || t.cover_thumb_url || '', '_blank', 'noopener,noreferrer'); }}
                style={{ cursor: 'pointer' }}
              />
            )}
            <span className="priority-dot" style={{ background: prio.color }}></span>
            <span className="tarjeta-name">{t.nombre_propietario || 'Cliente'}</span>
            {risk && <span className={`card-risk-chip ${risk.className}`} title={risk.text}><i className={risk.icon}></i></span>}
            {t.asignado_nombre && <span className="assigned-badge" title={t.asignado_nombre}>{t.asignado_nombre[0]}</span>}
            <div className="tarjeta-compact-actions">
              {t.tags?.length > 0 && <span className="tag-count">{t.tags.length} <i className="fas fa-tags"></i></span>}
              {whatsUrl && <button className="btn-wa-sm" onClick={e => { e.stopPropagation(); openWhatsAppSmart(t.whatsapp, `Hola ${t.nombre_propietario || ''}, le escribimos de Nanotronics respecto a su equipo en reparacion.`.trim()); }} title="WhatsApp"><i className="fab fa-whatsapp"></i></button>}
              <div className="tarjeta-compact-arrows">
                {prevCol && (
                  <button className="btn-action btn-col-arrow btn-col-arrow-sm" onClick={e => { e.stopPropagation(); onMove(t.id, prevCol.key); }}
                    title={`Mover a ${prevCol.title}`} aria-label={`Mover a ${prevCol.title}`}
                    style={{ borderColor: prevCol.color, color: prevCol.color }}>
                    <i className="fas fa-chevron-left"></i>
                  </button>
                )}
                {nextCol && (
                  <button className="btn-action btn-col-arrow btn-col-arrow-sm" onClick={e => { e.stopPropagation(); onMove(t.id, nextCol.key); }}
                    title={`Mover a ${nextCol.title}`} aria-label={`Mover a ${nextCol.title}`}
                    style={{ borderColor: nextCol.color, color: nextCol.color }}>
                    <i className="fas fa-chevron-right"></i>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        {showBlockModal && (
          <BlockTarjetaModal
            onCancel={() => setShowBlockModal(false)}
            onConfirm={reason => {
              setShowBlockModal(false);
              onBlock?.(t.id, reason);
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div
        className={`tarjeta-card ${overdue ? 'overdue' : ''} ${isBlocked ? 'blocked' : ''} ${selected ? 'card-selected' : ''} ${isDragging ? 'dragging' : ''} ${highlighted ? 'card-remote-pulse' : ''}`}
        tabIndex={0}
        role="button"
        aria-label={`Tarjeta de ${t.nombre_propietario || 'Cliente'}`}
        onClick={handleCardClick}
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

        <div className="tarjeta-signals">
          <div className="tarjeta-signal-primary">
            {thumb && (
              <img
                src={thumb}
                alt=""
                className="tarjeta-signal-thumb"
                width={36}
                height={36}
                loading="lazy"
                decoding="async"
              />
            )}
            <div className="tarjeta-signal-client">
              <strong className="tarjeta-name">{t.nombre_propietario || 'Cliente'}</strong>
              {(t.problema_resumen || t.problema) && (t.problema || t.problema_resumen) !== 'Sin descripcion' && (
                <span className="tarjeta-equipo-hint">{t.problema_resumen || t.problema}</span>
              )}
            </div>
          </div>
          {risk && (
            <div className={`card-risk-badge ${risk.className}`} title={risk.text}>
              <i className={risk.icon}></i>
              <span>{risk.text}</span>
            </div>
          )}
          <div className="tarjeta-signal-assignee">
            {t.asignado_nombre ? (
              <span className="assigned-badge assigned-badge-lg" title={`Asignado: ${t.asignado_nombre}`}>
                {t.asignado_nombre.split(' ').map(w => w[0]).join('').slice(0, 2)}
                <span className="assignee-name">{t.asignado_nombre.split(' ')[0]}</span>
              </span>
            ) : (
              <span className="unassigned-badge"><i className="fas fa-user-slash"></i> Sin asignar</span>
            )}
            {t.dias_en_columna > 0 && (
              <span className="days-badge" style={{ color: daysColor }} title={`${t.dias_en_columna} dias en esta columna`}>
                <i className="fas fa-clock"></i> {t.dias_en_columna}d
              </span>
            )}
          </div>
        </div>

        {notaTecnica && (
          <div className="tarjeta-notas-tecnicas" aria-label="Notas técnicas">
            <i className="fas fa-wrench"></i>
            <span>{notaTecnica}</span>
          </div>
        )}

        {t.tags && t.tags.length > 0 && (
          <div className="tarjeta-tags">
            {t.tags.slice(0, 3).map(tag => (
              <span key={tag.id} className="tag-chip" style={{ background: tag.color + '22', color: tag.color, borderColor: tag.color + '44' }}>
                {tag.name}
              </span>
            ))}
            {t.tags.length > 3 && <span className="tag-more">+{t.tags.length - 3}</span>}
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

        {(prevCol || nextCol) && (
          <div className="tarjeta-col-arrows-overlay">
            {prevCol && (
              <button
                className="btn-col-arrow-overlay"
                onClick={e => { e.stopPropagation(); onMove(t.id, prevCol.key); }}
                title={`← ${prevCol.title}`}
                aria-label={`Mover a ${prevCol.title}`}
                style={{ '--arrow-color': prevCol.color } as React.CSSProperties}
              >
                <i className="fas fa-chevron-left"></i>
              </button>
            )}
            {nextCol && (
              <button
                className="btn-col-arrow-overlay"
                onClick={e => { e.stopPropagation(); onMove(t.id, nextCol.key); }}
                title={`${nextCol.title} →`}
                aria-label={`Mover a ${nextCol.title}`}
                style={{ '--arrow-color': nextCol.color } as React.CSSProperties}
              >
                <i className="fas fa-chevron-right"></i>
              </button>
            )}
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
          <div className="tarjeta-footer-actions">
            <button
              className={`btn-action btn-block-card ${isBlocked ? 'blocked' : ''}`}
              onClick={handleBlockClick}
              title={isBlocked ? 'Desbloquear' : 'Bloquear'}
              aria-label={isBlocked ? 'Desbloquear tarjeta' : 'Bloquear tarjeta'}
            >
              <i className={isBlocked ? 'fas fa-unlock' : 'fas fa-lock'}></i>
            </button>
            {whatsUrl && (
              <button
                className="btn-action btn-wa"
                onClick={e => { e.stopPropagation(); openWhatsAppSmart(t.whatsapp, `Hola ${t.nombre_propietario || ''}, le escribimos de Nanotronics respecto a su equipo en reparacion.`.trim()); }}
                title="WhatsApp"
                aria-label="Abrir WhatsApp"
              >
                <i className="fab fa-whatsapp"></i>
              </button>
            )}
            <button className="btn-action btn-edit" onClick={e => { e.stopPropagation(); onEdit(t); }} title="Editar" aria-label="Editar tarjeta">
              <i className="fas fa-pen"></i>
            </button>
          </div>
        </div>
      </div>
      {showBlockModal && (
        <BlockTarjetaModal
          onCancel={() => setShowBlockModal(false)}
          onConfirm={reason => {
            setShowBlockModal(false);
            onBlock?.(t.id, reason);
          }}
        />
      )}
    </>
  );
}

const TarjetaCard = memo(TarjetaCardComponent);
export default TarjetaCard;
