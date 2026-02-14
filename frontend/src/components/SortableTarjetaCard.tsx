import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import TarjetaCard from './TarjetaCard';
import type { Tarjeta, KanbanColumn } from '../api/client';

interface Props {
    tarjeta: Tarjeta;
    columnas: KanbanColumn[];
    onEdit: (t: Tarjeta) => void;
    onDelete: (id: number) => void;
    onMove: (id: number, col: string) => void;
    compact?: boolean;
    keepSpaceWhileDragging?: boolean;
}

export default function SortableTarjetaCard({ tarjeta, columnas, onEdit, onDelete, onMove, compact, keepSpaceWhileDragging = false }: Props) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: tarjeta.id,
    });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? (keepSpaceWhileDragging ? 0 : 0.4) : 1,
        visibility: isDragging && keepSpaceWhileDragging ? 'hidden' as const : 'visible' as const,
        cursor: 'grab',
    };

    return (
        <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
            <TarjetaCard tarjeta={tarjeta} columnas={columnas}
                onEdit={onEdit} onDelete={onDelete} onMove={onMove} compact={compact} />
        </div>
    );
}
