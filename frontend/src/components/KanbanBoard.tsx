import { useEffect, useMemo, useRef, useState } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent, DragOverEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tarjeta, KanbanColumn } from '../api/client';
import SortableTarjetaCard from './SortableTarjetaCard';
import TarjetaCard from './TarjetaCard';
import { getUiErrorFeedback } from '../utils/errorMessaging';

interface Props {
  columnas: KanbanColumn[];
  tarjetas: Tarjeta[];
  onEdit: (t: Tarjeta) => void;
  groupBy?: string; // 'none' | 'priority' | 'assignee'
  compactView?: boolean;
}

interface ColumnBodyProps {
  col: KanbanColumn;
  cards: Tarjeta[];
  columnas: KanbanColumn[];
  groupBy: string;
  compactView: boolean;
  activeId: number | null;
  onEdit: (t: Tarjeta) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, col: string) => void;
}

const PRIORITY_LABELS: Record<string, string> = { alta: '🔴 Alta', media: '🟡 Media', baja: '🟢 Baja' };
const VIRTUALIZATION_THRESHOLD = 50;
const CARD_ESTIMATED_HEIGHT = 170;

function KanbanColumnBody({
  col,
  cards,
  columnas,
  groupBy,
  compactView,
  activeId,
  onEdit,
  onDelete,
  onMove,
}: ColumnBodyProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const shouldVirtualize = groupBy === 'none' && cards.length > VIRTUALIZATION_THRESHOLD;
  const activeCardInColumn = activeId != null && cards.some((t) => t.id === activeId);

  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const updateHeight = () => setViewportHeight(el.clientHeight);
    updateHeight();

    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const overscan = activeCardInColumn ? 12 : 8;
  const startIndex = shouldVirtualize ? Math.max(Math.floor(scrollTop / CARD_ESTIMATED_HEIGHT) - overscan, 0) : 0;
  const visibleCount = shouldVirtualize
    ? Math.ceil((viewportHeight || CARD_ESTIMATED_HEIGHT) / CARD_ESTIMATED_HEIGHT) + overscan * 2
    : cards.length;
  const endIndex = shouldVirtualize ? Math.min(startIndex + visibleCount, cards.length) : cards.length;
  const virtualCards = shouldVirtualize ? cards.slice(startIndex, endIndex) : cards;

  const normalCardProps = {
    columnas,
    onEdit,
    onDelete,
    onMove,
    compact: compactView || col.is_done_column,
  };

  return (
    <div
      className="kanban-column-body"
      data-droppable={col.key}
      ref={scrollRef}
      onScroll={shouldVirtualize ? (e) => setScrollTop(e.currentTarget.scrollTop) : undefined}
    >
      {cards.length === 0 && (
        <div className="kanban-empty">
          <i className="fas fa-inbox" style={{ color: col.color, opacity: 0.3 }}></i>
          <span>Arrastra aquí</span>
        </div>
      )}

      {shouldVirtualize ? (
        <div style={{ height: `${cards.length * CARD_ESTIMATED_HEIGHT}px`, position: 'relative', width: '100%' }}>
          {virtualCards.map((t, idx) => {
            const index = startIndex + idx;
            return (
              <div
                key={t.id}
                data-index={index}
                style={{
                  position: 'absolute',
                  top: `${index * CARD_ESTIMATED_HEIGHT}px`,
                  left: 0,
                  width: '100%',
                }}
              >
                <SortableTarjetaCard
                  tarjeta={t}
                  {...normalCardProps}
                  keepSpaceWhileDragging
                />
              </div>
            );
          })}
        </div>
      ) : groupBy === 'priority' ? (
        ['alta', 'media', 'baja'].map((p) => {
          const grouped = cards.filter((t) => t.prioridad === p);
          if (grouped.length === 0) return null;
          return (
            <div key={p} className="swimlane">
              <div className="swimlane-header">{PRIORITY_LABELS[p]} ({grouped.length})</div>
              {grouped.map((t) => (
                <SortableTarjetaCard key={t.id} tarjeta={t} {...normalCardProps} />
              ))}
            </div>
          );
        })
      ) : groupBy === 'assignee' ? (
        (() => {
          const byAssignee = new Map<string, Tarjeta[]>();
          cards.forEach((t) => {
            const key = t.asignado_nombre || 'Sin asignar';
            if (!byAssignee.has(key)) byAssignee.set(key, []);
            byAssignee.get(key)!.push(t);
          });
          return Array.from(byAssignee.entries()).map(([name, group]) => (
            <div key={name} className="swimlane">
              <div className="swimlane-header"><i className="fas fa-user-hard-hat"></i> {name} ({group.length})</div>
              {group.map((t) => (
                <SortableTarjetaCard key={t.id} tarjeta={t} {...normalCardProps} />
              ))}
            </div>
          ));
        })()
      ) : (
        cards.map((t) => (
          <SortableTarjetaCard key={t.id} tarjeta={t} {...normalCardProps} />
        ))
      )}
    </div>
  );
}

export default function KanbanBoard({ columnas, tarjetas, onEdit, groupBy = 'none', compactView = false }: Props) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [activeTarjetaSnapshot, setActiveTarjetaSnapshot] = useState<Tarjeta | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const activeTarjeta = activeTarjetaSnapshot || tarjetas.find(t => t.id === activeId) || null;

  const batchMutation = useMutation({
    mutationFn: (items: { id: number; columna: string; posicion: number }[]) => api.batchUpdatePositions(items),
    onSuccess: () => { setErrorMessage(''); qc.invalidateQueries({ queryKey: ['tarjetas'] }); },
    onError: (e: unknown) => {
      const feedback = getUiErrorFeedback(e, 'No se pudo actualizar la posición de la tarjeta.');
      setErrorMessage(`${feedback.message} ${feedback.actionLabel}.`);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteTarjeta(id),
    onSuccess: () => { setErrorMessage(''); qc.invalidateQueries({ queryKey: ['tarjetas'] }); },
    onError: (e: unknown) => {
      const feedback = getUiErrorFeedback(e, 'No se pudo eliminar la tarjeta.');
      setErrorMessage(`${feedback.message} ${feedback.actionLabel}.`);
    },
  });

  // Agrupar tarjetas por columna
  const tarjetasPorColumna = useMemo(() => {
    const grouped: Record<string, Tarjeta[]> = {};
    columnas.forEach(c => { grouped[c.key] = []; });
    tarjetas
      .filter(t => !t.eliminado)
      .sort((a, b) => a.posicion - b.posicion)
      .forEach(t => {
        if (grouped[t.columna]) grouped[t.columna].push(t);
      });
    return grouped;
  }, [tarjetas, columnas]);

  function handleDragStart(event: DragStartEvent) {
    const draggedId = Number(event.active.id);
    setActiveId(draggedId);
    setActiveTarjetaSnapshot(tarjetas.find((t) => t.id === draggedId) || null);
  }

  function handleDragOver(event: DragOverEvent) {
    const overId = event.over?.id;
    if (!overId) { setOverColumn(null); return; }
    // Si pasa sobre una columna directamente
    const col = columnas.find(c => c.key === overId);
    if (col) { setOverColumn(col.key); return; }
    // Si pasa sobre una tarjeta, buscar su columna
    const overCard = tarjetas.find(t => t.id === Number(overId));
    if (overCard) { setOverColumn(overCard.columna); }
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    setActiveTarjetaSnapshot(null);
    setOverColumn(null);
    const { active, over } = event;
    if (!over) return;

    const draggedId = Number(active.id);
    const draggedCard = tarjetas.find(t => t.id === draggedId);
    if (!draggedCard) return;

    // Determinar columna destino
    let destCol: string;
    const colDest = columnas.find(c => c.key === String(over.id));
    if (colDest) {
      destCol = colDest.key;
    } else {
      const overCard = tarjetas.find(t => t.id === Number(over.id));
      if (!overCard) return;
      destCol = overCard.columna;
    }

    // Construir nuevo orden
    const sourceCards = (tarjetasPorColumna[draggedCard.columna] || []).filter(t => t.id !== draggedId);
    let destCards: Tarjeta[];

    if (destCol === draggedCard.columna) {
      destCards = [...sourceCards];
      // Insertar en la posición del over
      const overIdx = destCards.findIndex(t => t.id === Number(over.id));
      if (overIdx >= 0) {
        destCards.splice(overIdx, 0, draggedCard);
      } else {
        destCards.push(draggedCard);
      }
    } else {
      destCards = [...(tarjetasPorColumna[destCol] || [])];
      const overIdx = destCards.findIndex(t => t.id === Number(over.id));
      if (overIdx >= 0) {
        destCards.splice(overIdx, 0, draggedCard);
      } else {
        destCards.push(draggedCard);
      }
    }

    // Batch update positions
    const updates: { id: number; columna: string; posicion: number }[] = [];

    // Si movimos entre columnas, actualizar source
    if (destCol !== draggedCard.columna) {
      sourceCards.forEach((t, i) => updates.push({ id: t.id, columna: draggedCard.columna, posicion: i }));
    }
    destCards.forEach((t, i) => updates.push({ id: t.id, columna: destCol, posicion: i }));

    if (updates.length) batchMutation.mutate(updates);
  }

  function handleMoveViaDrop(id: number, newCol: string) {
    const card = tarjetas.find(t => t.id === id);
    if (!card) return;
    const destCards = [...(tarjetasPorColumna[newCol] || [])];
    const updates = [{ id, columna: newCol, posicion: destCards.length }];
    batchMutation.mutate(updates);
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter}
      onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      {errorMessage && <div className="login-error"><i className="fas fa-exclamation-triangle"></i> {errorMessage}</div>}
      <div className="kanban-board">
        {columnas.map(col => {
          const cards = tarjetasPorColumna[col.key] || [];
          const wipExceeded = col.wip_limit != null && cards.length > col.wip_limit;
          const isOverTarget = overColumn === col.key;

          return (
            <div key={col.key} className={`kanban-column ${isOverTarget ? 'drag-over' : ''} ${wipExceeded ? 'wip-exceeded' : ''}`}
              data-column={col.key}>
              <div className="kanban-column-header" style={{ borderTopColor: col.color }}>
                <div className="column-title-row">
                  <i className={col.icon} style={{ color: col.color }}></i>
                  <span className="column-title">{col.title}</span>
                  <span className="column-count" style={{ background: col.color }}>{cards.length}</span>
                </div>
                {col.wip_limit != null && (
                  <div className={`wip-indicator ${wipExceeded ? 'exceeded' : ''}`}>
                    WIP: {cards.length}/{col.wip_limit}
                    {wipExceeded && <i className="fas fa-exclamation-triangle ms-1"></i>}
                  </div>
                )}
              </div>

              <SortableContext items={cards.map(t => t.id)} strategy={verticalListSortingStrategy} id={col.key}>
                <KanbanColumnBody
                  col={col}
                  cards={cards}
                  columnas={columnas}
                  groupBy={groupBy}
                  compactView={compactView}
                  activeId={activeId}
                  onEdit={onEdit}
                  onDelete={(id: number) => deleteMutation.mutate(id)}
                  onMove={handleMoveViaDrop}
                />
              </SortableContext>
            </div>
          );
        })}
      </div>

      <DragOverlay>
        {activeTarjeta && (
          <div className="drag-overlay-card">
            <TarjetaCard tarjeta={activeTarjeta} columnas={columnas} onEdit={() => { }} onDelete={() => { }} onMove={() => { }} compact={false} />
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
