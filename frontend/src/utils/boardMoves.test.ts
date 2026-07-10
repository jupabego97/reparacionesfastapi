import { describe, expect, it } from 'vitest';
import type { TarjetaBoardItem } from '../api/client';
import { buildPositionUpdates, canMoveToColumn, cardMatchesBoardFilters } from './boardMoves';

function card(partial: Partial<TarjetaBoardItem> & { id: number; columna: string; posicion: number }): TarjetaBoardItem {
  return {
    nombre_propietario: 'Cliente',
    problema: 'Pantalla',
    whatsapp: '',
    fecha_inicio: null,
    fecha_limite: null,
    tiene_cargador: 'no',
    fecha_diagnosticada: null,
    fecha_para_entregar: null,
    fecha_entregada: null,
    imagen_url: null,
    prioridad: 'media',
    asignado_a: null,
    asignado_nombre: null,
    tags: [],
    subtasks_total: 0,
    subtasks_done: 0,
    comments_count: 0,
    dias_en_columna: 0,
    bloqueada: false,
    ...partial,
  };
}

describe('boardMoves', () => {
  it('buildPositionUpdates reindexes source and destination', () => {
    const grouped = {
      ingresado: [card({ id: 1, columna: 'ingresado', posicion: 0 }), card({ id: 2, columna: 'ingresado', posicion: 1 })],
      diagnosticada: [card({ id: 3, columna: 'diagnosticada', posicion: 0 })],
    };
    const updates = buildPositionUpdates(1, 'diagnosticada', grouped);
    expect(updates).toEqual([
      { id: 2, columna: 'ingresado', posicion: 0 },
      { id: 1, columna: 'diagnosticada', posicion: 0 },
      { id: 3, columna: 'diagnosticada', posicion: 1 },
    ]);
  });

  it('cardMatchesBoardFilters respects estado filter', () => {
    const filters = { search: '', estado: 'diagnosticada', prioridad: '', asignado_a: '', cargador: '', tag: '' };
    const moved = card({ id: 1, columna: 'ingresado', posicion: 0 });
    expect(cardMatchesBoardFilters(moved, filters)).toBe(false);
  });

  it('canMoveToColumn blocks WIP full columns', () => {
    const c = card({ id: 1, columna: 'ingresado', posicion: 0 });
    const columnas = [{ key: 'diagnosticada', title: 'Diag', color: '#000', icon: 'x', position: 1, wip_limit: 2 }];
    const reason = canMoveToColumn(c, 'diagnosticada', columnas as never, 2, undefined);
    expect(reason).toMatch(/WIP/i);
  });
});
