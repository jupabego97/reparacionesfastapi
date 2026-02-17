import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { DndContext, pointerWithin, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors, DragOverlay, useDroppable } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent, DragOverEvent, CollisionDetection } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import { api } from '../api/client';
import type { TarjetaBoardItem, KanbanColumn } from '../api/client';
import SortableTarjetaCard from './SortableTarjetaCard';
import TarjetaCard from './TarjetaCard';

interface Props {
  columnas: KanbanColumn[];
  tarjetas: TarjetaBoardItem[];
  onEdit: (t: TarjetaBoardItem) => void;
  groupBy?: string;
  compactView?: boolean;
  selectable?: boolean;
  selectedIds?: number[];
  onSelect?: (id: number) => void;
  onBlock?: (id: number, reason: string) => void;
  onUnblock?: (id: number) => void;
  onMoveSuccess?: (cardId: number, oldCol: string, newCol: string) => void;
  onMoveError?: (err?: unknown) => void;
}

// Custom collision detection: prefer pointerWithin, fallback to closestCenter
const kanbanCollision: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  if (pointerCollisions.length > 0) return pointerCollisions;
  return closestCenter(args);
};

// Droppable column wrapper — registers each column as a drop target
function DroppableColumn({ id, children }: { id: string; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={`kanban-column-body ${isOver ? 'droppable-over' : ''}`}>
      {children}
    </div>
  );
}

const PRIORITY_LABELS: Record<string, string> = { alta: 'Alta', media: 'Media', baja: 'Baja' };
const VIRTUALIZATION_THRESHOLD = 40;
const CARD_ESTIMATED_HEIGHT = 220;

function VirtualizedColumnList({
  cards,
  columnas,
  col,
  onEdit,
  onDelete,
  onMove,
  compact,
  selectable,
  selectedIds,
  onSelect,
  onBlock,
  onUnblock,
}: {
  cards: TarjetaBoardItem[];
  columnas: KanbanColumn[];
  col: KanbanColumn;
  onEdit: (t: TarjetaBoardItem) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, newCol: string) => void;
  compact: boolean;
  selectable?: boolean;
  selectedIds?: number[];
  onSelect?: (id: number) => void;
  onBlock?: (id: number, reason: string) => void;
  onUnblock?: (id: number) => void;
}) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: cards.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => CARD_ESTIMATED_HEIGHT,
    overscan: 8,
  });

  return (
    <SortableContext items={cards.map(t => t.id)} strategy={verticalListSortingStrategy}>
      <DroppableColumn id={col.key}>
        <div ref={parentRef} style={{ flex: 1, overflowY: 'auto' }}>
          {cards.length === 0 && (
            <div className="kanban-empty">
              <i className="fas fa-inbox" style={{ color: col.color, opacity: 0.3 }}></i>
              <span>Arrastra aquí</span>
            </div>
          )}
          {cards.length > 0 && (
            <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
              {rowVirtualizer.getVirtualItems().map(virtualItem => {
                const t = cards[virtualItem.index];
                return (
                  <div
                    key={t.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualItem.start}px)`,
                    }}
                  >
                    <SortableTarjetaCard
                      tarjeta={t}
                      columnas={columnas}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onMove={onMove}
                      compact={compact}
                      selectable={selectable}
                      selected={selectedIds?.includes(t.id)}
                      onSelect={onSelect}
                      onBlock={onBlock}
                      onUnblock={onUnblock}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DroppableColumn>
    </SortableContext>
  );
}

export default function KanbanBoard({
  columnas,
  tarjetas,
  onEdit,
  groupBy = 'none',
  compactView = false,
  selectable,
  selectedIds,
  onSelect,
  onBlock,
  onUnblock,
  onMoveSuccess,
  onMoveError,
}: Props) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [visibleColIndex, setVisibleColIndex] = useState(0);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 8 } }),
  );

  const lastMoveRef = useRef<{ cardId: number; oldCol: string; newCol: string } | null>(null);

  const tarjetaById = useMemo(() => {
    const map = new Map<number, TarjetaBoardItem>();
    tarjetas.forEach(t => map.set(t.id, t));
    return map;
  }, [tarjetas]);

  const activeTarjeta = activeId != null ? tarjetaById.get(activeId) || null : null;

  const batchMutation = useMutation({
    mutationFn: (items: { id: number; columna: string; posicion: number }[]) => api.batchUpdatePositions(items),
    onMutate: async (items) => {
      // Save snapshot for rollback, then apply optimistic update
      let snapshot: [unknown, unknown][] = [];
      try {
        snapshot = queryClient.getQueriesData({ queryKey: ['tarjetas-board'] }) as [unknown, unknown][];
        await queryClient.cancelQueries({ queryKey: ['tarjetas-board'] });
        const byId = new Map(items.map(i => [i.id, i]));
        for (const [key] of snapshot) {
          queryClient.setQueryData(key as Parameters<typeof queryClient.setQueryData>[0], (old: unknown) => {
            if (!old || typeof old !== 'object') return old;
            const data = old as { pages?: { tarjetas?: TarjetaBoardItem[] }[]; pageParams?: unknown[] };
            if (!Array.isArray(data.pages)) return old;
            return {
              ...data,
              pages: data.pages.map(page => {
                if (!Array.isArray(page.tarjetas)) return page;
                return {
                  ...page,
                  tarjetas: page.tarjetas.map((t: TarjetaBoardItem) => {
                    const upd = byId.get(t.id);
                    return upd ? { ...t, columna: upd.columna, posicion: upd.posicion } : t;
                  }),
                };
              }),
            };
          });
        }
      } catch (e) {
        console.warn('[KanbanBoard] optimistic update skipped:', e);
      }
      return { snapshot };
    },
    onError: (err, _items, context) => {
      console.error('[KanbanBoard] batchMutation error:', err);
      // Rollback to snapshot
      const snapshot = context?.snapshot as [unknown, unknown][] | undefined;
      if (snapshot) {
        for (const [key, data] of snapshot) {
          queryClient.setQueryData(key as Parameters<typeof queryClient.setQueryData>[0], data);
        }
      }
      onMoveError?.(err);
    },
    onSuccess: () => {
      const move = lastMoveRef.current;
      if (move) {
        onMoveSuccess?.(move.cardId, move.oldCol, move.newCol);
        lastMoveRef.current = null;
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tarjetas-board'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteTarjeta(id),
  });

  const tarjetasPorColumna = useMemo(() => {
    const grouped: Record<string, TarjetaBoardItem[]> = {};
    columnas.forEach(c => { grouped[c.key] = []; });
    tarjetas
      .filter(t => !t.eliminado)
      .forEach(t => {
        if (grouped[t.columna]) grouped[t.columna].push(t);
      });
    Object.keys(grouped).forEach(key => {
      grouped[key].sort((a, b) => a.posicion - b.posicion);
    });
    return grouped;
  }, [tarjetas, columnas]);

  const groupedByPriority = useMemo(() => {
    const out: Record<string, Record<string, TarjetaBoardItem[]>> = {};
    columnas.forEach(c => {
      const cards = tarjetasPorColumna[c.key] || [];
      out[c.key] = { alta: [], media: [], baja: [] };
      cards.forEach(card => {
        const prio = ['alta', 'media', 'baja'].includes(card.prioridad) ? card.prioridad : 'media';
        out[c.key][prio].push(card);
      });
    });
    return out;
  }, [columnas, tarjetasPorColumna]);

  const groupedByAssignee = useMemo(() => {
    const out: Record<string, Map<string, TarjetaBoardItem[]>> = {};
    columnas.forEach(c => {
      const map = new Map<string, TarjetaBoardItem[]>();
      (tarjetasPorColumna[c.key] || []).forEach(card => {
        const key = card.asignado_nombre || 'Sin asignar';
        const prev = map.get(key) || [];
        prev.push(card);
        map.set(key, prev);
      });
      out[c.key] = map;
    });
    return out;
  }, [columnas, tarjetasPorColumna]);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(Number(event.active.id));
  }, []);

  const handleDragOver = useCallback((event: DragOverEvent) => {
    const overId = event.over?.id;
    if (!overId) {
      setOverColumn(null);
      return;
    }
    const col = columnas.find(c => c.key === overId);
    if (col) {
      setOverColumn(col.key);
      return;
    }
    const overCard = tarjetaById.get(Number(overId));
    if (overCard) setOverColumn(overCard.columna);
  }, [columnas, tarjetaById]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    setActiveId(null);
    setOverColumn(null);
    const { active, over } = event;
    if (!over) return;

    const draggedId = Number(active.id);
    const draggedCard = tarjetaById.get(draggedId);
    if (!draggedCard) return;

    let destCol: string;
    const colDest = columnas.find(c => c.key === String(over.id));
    if (colDest) {
      destCol = colDest.key;
    } else {
      const overCard = tarjetaById.get(Number(over.id));
      if (!overCard) return;
      destCol = overCard.columna;
    }

    const sourceCards = (tarjetasPorColumna[draggedCard.columna] || []).filter(t => t.id !== draggedId);
    let destCards: TarjetaBoardItem[];

    if (destCol === draggedCard.columna) {
      destCards = [...sourceCards];
      const overIdx = destCards.findIndex(t => t.id === Number(over.id));
      if (overIdx >= 0) destCards.splice(overIdx, 0, draggedCard);
      else destCards.push(draggedCard);
    } else {
      destCards = [...(tarjetasPorColumna[destCol] || [])];
      const overIdx = destCards.findIndex(t => t.id === Number(over.id));
      if (overIdx >= 0) destCards.splice(overIdx, 0, draggedCard);
      else destCards.push(draggedCard);
    }

    const updates: { id: number; columna: string; posicion: number }[] = [];
    if (destCol !== draggedCard.columna) {
      sourceCards.forEach((t, i) => updates.push({ id: t.id, columna: draggedCard.columna, posicion: i }));
      lastMoveRef.current = { cardId: draggedId, oldCol: draggedCard.columna, newCol: destCol };
    }
    destCards.forEach((t, i) => updates.push({ id: t.id, columna: destCol, posicion: i }));

    if (updates.length) batchMutation.mutate(updates);
  }, [tarjetaById, columnas, tarjetasPorColumna, batchMutation]);

  const handleMoveViaDrop = useCallback((id: number, newCol: string) => {
    const card = tarjetaById.get(id);
    if (!card) return;
    if (card.columna !== newCol) {
      lastMoveRef.current = { cardId: id, oldCol: card.columna, newCol };
    }
    const destCards = [...(tarjetasPorColumna[newCol] || [])];
    const updates = [{ id, columna: newCol, posicion: destCards.length }];
    batchMutation.mutate(updates);
  }, [tarjetaById, tarjetasPorColumna, batchMutation]);

  // Stable delete handler — avoids new function ref on each render
  const handleDelete = useCallback((id: number) => deleteMutation.mutate(id), [deleteMutation]);

  // Memoized selected set for O(1) lookup instead of Array.includes per card
  const selectedSet = useMemo(() => new Set(selectedIds || []), [selectedIds]);

  // IntersectionObserver for mobile column dots
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const cols = board.querySelectorAll<HTMLElement>('.kanban-column');
    if (!cols.length) return;
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const idx = Array.from(cols).indexOf(entry.target as HTMLElement);
            if (idx >= 0) setVisibleColIndex(idx);
          }
        }
      },
      { root: board, threshold: 0.6 }
    );
    cols.forEach(col => observer.observe(col));
    return () => observer.disconnect();
  }, [columnas]);

  const renderCard = useCallback((t: TarjetaBoardItem, _col: KanbanColumn) => (
    <SortableTarjetaCard
      key={t.id}
      tarjeta={t}
      columnas={columnas}
      onEdit={onEdit}
      onDelete={handleDelete}
      onMove={handleMoveViaDrop}
      compact={compactView}
      selectable={selectable}
      selected={selectedSet.has(t.id)}
      onSelect={onSelect}
      onBlock={onBlock}
      onUnblock={onUnblock}
    />
  ), [columnas, onEdit, handleDelete, handleMoveViaDrop, compactView, selectable, selectedSet, onSelect, onBlock, onUnblock]);

  return (
    <DndContext sensors={sensors} collisionDetection={kanbanCollision}
      onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="kanban-board" ref={boardRef}>
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

              {groupBy === 'none' && cards.length > VIRTUALIZATION_THRESHOLD ? (
                <VirtualizedColumnList
                  cards={cards}
                  columnas={columnas}
                  col={col}
                  onEdit={onEdit}
                  onDelete={(id: number) => deleteMutation.mutate(id)}
                  onMove={handleMoveViaDrop}
                  compact={compactView}
                  selectable={selectable}
                  selectedIds={selectedIds}
                  onSelect={onSelect}
                  onBlock={onBlock}
                  onUnblock={onUnblock}
                />
              ) : (
                <SortableContext items={cards.map(t => t.id)} strategy={verticalListSortingStrategy}>
                  <DroppableColumn id={col.key}>
                    {cards.length === 0 && (
                      <div className="kanban-empty">
                        <i className="fas fa-inbox" style={{ color: col.color, opacity: 0.3 }}></i>
                        <span>Arrastra aquí</span>
                      </div>
                    )}
                    {groupBy === 'priority' ? (
                      ['alta', 'media', 'baja'].map(p => {
                        const grouped = groupedByPriority[col.key]?.[p] || [];
                        if (grouped.length === 0) return null;
                        return (
                          <div key={p} className="swimlane">
                            <div className="swimlane-header">{PRIORITY_LABELS[p]} ({grouped.length})</div>
                            {grouped.map(t => renderCard(t, col))}
                          </div>
                        );
                      })
                    ) : groupBy === 'assignee' ? (
                      Array.from(groupedByAssignee[col.key]?.entries() || []).map(([name, group]) => (
                        <div key={name} className="swimlane">
                          <div className="swimlane-header"><i className="fas fa-user-hard-hat"></i> {name} ({group.length})</div>
                          {group.map(t => renderCard(t, col))}
                        </div>
                      ))
                    ) : (
                      cards.map(t => renderCard(t, col))
                    )}
                  </DroppableColumn>
                </SortableContext>
              )}
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

      <div className="kanban-column-dots">
        {columnas.map((col, i) => (
          <span key={col.key} className={`kanban-column-dot ${i === visibleColIndex ? 'active' : ''}`}
            style={i === visibleColIndex ? { background: col.color } : undefined}
            title={col.title} />
        ))}
      </div>
    </DndContext>
  );
}
