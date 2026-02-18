import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import TarjetaCard from './TarjetaCard';
import type { TarjetaBoardItem, KanbanColumn } from '../api/client';

interface Props {
  tarjeta: TarjetaBoardItem;
  columnas: KanbanColumn[];
  onEdit: (t: TarjetaBoardItem) => void;
  onDelete: (id: number) => void;
  onMove: (id: number, col: string) => void;
  compact?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: number) => void;
  onBlock?: (id: number, reason: string) => void;
  onUnblock?: (id: number) => void;
  /** En móvil no mostramos el handle de arrastre; se usan los botones de flecha */
  disableDrag?: boolean;
}

const noLayoutAnimation = () => false;

function SortableTarjetaCardComponent({ tarjeta, columnas, onEdit, onDelete, onMove, compact, selectable, selected, onSelect, onBlock, onUnblock, disableDrag }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isSorting } = useSortable({
    id: tarjeta.id,
    animateLayoutChanges: noLayoutAnimation,
  });

  const style = {
    transform: disableDrag ? undefined : CSS.Transform.toString(transform),
    transition: isSorting ? transition : undefined,
    opacity: isDragging ? 0.4 : 1,
    flexShrink: 0,
  };

  return (
    <div ref={setNodeRef} style={style} {...(disableDrag ? {} : attributes)}>
      <TarjetaCard tarjeta={tarjeta} columnas={columnas}
        onEdit={onEdit} onDelete={onDelete} onMove={onMove} compact={compact}
        selectable={selectable} selected={selected} onSelect={onSelect}
        onBlock={onBlock} onUnblock={onUnblock}
        dragHandleProps={disableDrag ? undefined : listeners} isDragging={isDragging} />
    </div>
  );
}

const SortableTarjetaCard = memo(SortableTarjetaCardComponent);
export default SortableTarjetaCard;
