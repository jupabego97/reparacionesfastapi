import { useState, useMemo, useCallback } from 'react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent, DragOverEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tarjeta, KanbanColumn } from '../api/client';
import SortableTarjetaCard from './SortableTarjetaCard';
import TarjetaCard from './TarjetaCard';

interface Props {
  columnas: KanbanColumn[];
  tarjetas: Tarjeta[];
  onEdit: (t: Tarjeta) => void;
  groupBy?: string; // 'none' | 'priority' | 'assignee'
  compactView?: boolean;
}

const PRIORITY_LABELS: Record<string, string> = { alta: '🔴 Alta', media: '🟡 Media', baja: '🟢 Baja' };

export default function KanbanBoard({ columnas, tarjetas, onEdit, groupBy = 'none', compactView = false }: Props) {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<number | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const activeTarjeta = tarjetas.find(t => t.id === activeId) || null;

  const batchMutation = useMutation({
    mutationFn: (items: { id: number; columna: string; posicion: number }[]) => api.batchUpdatePositions(items),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tarjetas'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteTarjeta(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tarjetas'] }),
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

  const agrupacionesPorColumna = useMemo(() => {
    const groupedByColumn: Record<string, { priority: Record<string, Tarjeta[]>; assignee: [string, Tarjeta[]][] }> = {};

    columnas.forEach(col => {
      const cards = tarjetasPorColumna[col.key] || [];
      const byPriority: Record<string, Tarjeta[]> = { alta: [], media: [], baja: [] };
      const byAssigneeMap = new Map<string, Tarjeta[]>();

      cards.forEach(t => {
        if (byPriority[t.prioridad]) {
          byPriority[t.prioridad].push(t);
        }

        const assigneeKey = t.asignado_nombre || 'Sin asignar';
        if (!byAssigneeMap.has(assigneeKey)) byAssigneeMap.set(assigneeKey, []);
        byAssigneeMap.get(assigneeKey)!.push(t);
      });

      groupedByColumn[col.key] = {
        priority: byPriority,
        assignee: Array.from(byAssigneeMap.entries()),
      };
    });

    return groupedByColumn;
  }, [columnas, tarjetasPorColumna]);

  const handleDelete = useCallback((id: number) => {
    deleteMutation.mutate(id);
  }, [deleteMutation]);

  const handleMoveViaDrop = useCallback((id: number, newCol: string) => {
    const card = tarjetas.find(t => t.id === id);
    if (!card) return;
    const destCards = tarjetasPorColumna[newCol] || [];
    const updates = [{ id, columna: newCol, posicion: destCards.length }];
    batchMutation.mutate(updates);
  }, [batchMutation, tarjetas, tarjetasPorColumna]);

  const handleEdit = useCallback((t: Tarjeta) => {
    onEdit(t);
  }, [onEdit]);

  function handleDragStart(event: DragStartEvent) {
    setActiveId(Number(event.active.id));
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

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter}
      onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
      <div className="kanban-board">
        {columnas.map(col => {
          const cards = tarjetasPorColumna[col.key] || [];
          const grouped = agrupacionesPorColumna[col.key] || { priority: { alta: [], media: [], baja: [] }, assignee: [] };
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
                <div className="kanban-column-body" data-droppable={col.key}>
                  {cards.length === 0 && (
                    <div className="kanban-empty">
                      <i className="fas fa-inbox" style={{ color: col.color, opacity: 0.3 }}></i>
                      <span>Arrastra aquí</span>
                    </div>
                  )}
                  {groupBy === 'priority' ? (
                    ['alta', 'media', 'baja'].map(p => {
                      const priorityCards = grouped.priority[p] || [];
                      if (priorityCards.length === 0) return null;
                      return (
                        <div key={p} className="swimlane">
                          <div className="swimlane-header">{PRIORITY_LABELS[p]} ({priorityCards.length})</div>
                          {priorityCards.map(t => (
                            <SortableTarjetaCard key={t.id} tarjeta={t} columnas={columnas}
                              onEdit={handleEdit} onDelete={handleDelete}
                              onMove={handleMoveViaDrop} compact={compactView || col.is_done_column} />
                          ))}
                        </div>
                      );
                    })
                  ) : groupBy === 'assignee' ? (
                    grouped.assignee.map(([name, group]) => (
                      <div key={name} className="swimlane">
                        <div className="swimlane-header"><i className="fas fa-user-hard-hat"></i> {name} ({group.length})</div>
                        {group.map(t => (
                          <SortableTarjetaCard key={t.id} tarjeta={t} columnas={columnas}
                            onEdit={handleEdit} onDelete={handleDelete}
                            onMove={handleMoveViaDrop} compact={compactView || col.is_done_column} />
                        ))}
                      </div>
                    ))
                  ) : (
                    cards.map(t => (
                      <SortableTarjetaCard key={t.id} tarjeta={t} columnas={columnas}
                        onEdit={handleEdit} onDelete={handleDelete}
                        onMove={handleMoveViaDrop} compact={compactView || col.is_done_column} />
                    ))
                  )}
                </div>
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
