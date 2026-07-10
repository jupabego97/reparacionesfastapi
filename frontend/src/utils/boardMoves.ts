import type { KanbanColumn, KanbanRules, TarjetaBoardItem } from '../api/client';

export type BoardFilters = {
  search: string;
  estado: string;
  prioridad: string;
  asignado_a: string;
  cargador: string;
  tag: string;
};

const FIELD_LABELS: Record<string, string> = {
  nombre_propietario: 'nombre',
  problema: 'problema',
  whatsapp: 'WhatsApp',
  diagnosticada: 'fecha diagnóstico',
  costo_estimado: 'costo estimado',
  notas_tecnicas: 'notas técnicas',
  asignado_a: 'técnico asignado',
};

function fieldSatisfied(card: TarjetaBoardItem, field: string): boolean {
  switch (field) {
    case 'nombre_propietario':
      return !!(card.nombre_propietario || '').trim();
    case 'problema':
      return !!(card.problema || '').trim() && card.problema !== 'Sin descripción';
    case 'whatsapp':
      return !!(card.whatsapp || '').trim();
    case 'diagnosticada':
      return !!card.fecha_diagnosticada;
    case 'costo_estimado':
      return card.costo_estimado != null;
    case 'notas_tecnicas':
      return !!(card.notas_tecnicas || card.notas_tecnicas_resumen || '').trim();
    case 'asignado_a':
      return card.asignado_a != null;
    default:
      return true;
  }
}

export function missingRequiredFields(card: TarjetaBoardItem, required: string[]): string[] {
  return required.filter(f => !fieldSatisfied(card, f)).map(f => FIELD_LABELS[f] || f);
}

export function cardMatchesBoardFilters(card: TarjetaBoardItem, filters: BoardFilters): boolean {
  if (filters.estado && card.columna !== filters.estado) return false;
  if (filters.prioridad && card.prioridad !== filters.prioridad) return false;
  if (filters.asignado_a && String(card.asignado_a ?? '') !== filters.asignado_a) return false;
  if (filters.cargador && card.tiene_cargador !== filters.cargador) return false;
  if (filters.tag && !card.tags?.some(t => String(t.id) === filters.tag)) return false;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const haystack = [
      card.nombre_propietario,
      card.problema,
      card.problema_resumen,
      card.whatsapp,
      card.notas_tecnicas,
      card.notas_tecnicas_resumen,
    ];
    if (!haystack.some(v => (v || '').toLowerCase().includes(q))) return false;
  }
  return true;
}

export function buildPositionUpdates(
  draggedId: number,
  destCol: string,
  tarjetasPorColumna: Record<string, TarjetaBoardItem[]>,
  overId?: number,
): { id: number; columna: string; posicion: number }[] {
  const draggedCard = Object.values(tarjetasPorColumna)
    .flat()
    .find(t => t.id === draggedId);
  if (!draggedCard) return [];

  const sourceCards = (tarjetasPorColumna[draggedCard.columna] || []).filter(t => t.id !== draggedId);
  let destCards: TarjetaBoardItem[];

  if (destCol === draggedCard.columna) {
    destCards = [...sourceCards];
    if (overId != null) {
      const overIdx = destCards.findIndex(t => t.id === overId);
      if (overIdx >= 0) destCards.splice(overIdx, 0, draggedCard);
      else destCards.push(draggedCard);
    } else {
      destCards.push(draggedCard);
    }
  } else {
    destCards = [...(tarjetasPorColumna[destCol] || [])];
    if (overId != null) {
      const overIdx = destCards.findIndex(t => t.id === overId);
      if (overIdx >= 0) destCards.splice(overIdx, 0, draggedCard);
      else destCards.push(draggedCard);
    } else {
      destCards.push(draggedCard);
    }
  }

  const updates: { id: number; columna: string; posicion: number }[] = [];
  if (destCol !== draggedCard.columna) {
    sourceCards.forEach((t, i) => updates.push({ id: t.id, columna: draggedCard.columna, posicion: i }));
  }
  destCards.forEach((t, i) => updates.push({ id: t.id, columna: destCol, posicion: i }));
  return updates;
}

export function canMoveToColumn(
  card: TarjetaBoardItem,
  destCol: string,
  columnas: KanbanColumn[],
  destCardCount: number,
  rules?: KanbanRules,
): string | null {
  if (card.bloqueada) return 'Tarjeta bloqueada. Desbloquéala para moverla.';
  if (card.columna === destCol) return null;

  const allowed = rules?.allowed_transitions?.[card.columna];
  if (allowed?.length && !allowed.includes(destCol)) {
    const fromTitle = columnas.find(c => c.key === card.columna)?.title || card.columna;
    const toTitle = columnas.find(c => c.key === destCol)?.title || destCol;
    return `No se puede mover de "${fromTitle}" a "${toTitle}"`;
  }

  const col = columnas.find(c => c.key === destCol);
  const wipLimit = col?.wip_limit ?? rules?.wip_limits?.[destCol];
  if (wipLimit != null && destCardCount >= wipLimit) {
    return `Límite WIP en "${col?.title || destCol}" (${wipLimit} máximo)`;
  }

  const required = rules?.transition_requirements?.[destCol] || [];
  const missing = missingRequiredFields(card, required);
  if (missing.length) {
    return `Para mover a "${col?.title || destCol}" faltan: ${missing.join(', ')}`;
  }
  return null;
}
