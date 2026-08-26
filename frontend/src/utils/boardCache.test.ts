import { describe, expect, it } from 'vitest';
import type { TarjetaBoardItem, TarjetasBoardResponse } from '../api/client';
import {
  applyCardPatch,
  markLocalCardUpdate,
  wasRecentLocalCardUpdate,
  type BoardInfiniteData,
} from './boardCache';

function card(partial: Partial<TarjetaBoardItem> & { id: number; columna: string }): TarjetaBoardItem {
  return {
    nombre_propietario: 'Cliente',
    problema: 'Pantalla',
    whatsapp: '',
    fecha_inicio: null,
    fecha_limite: null,
    tiene_cargador: 'si',
    fecha_diagnosticada: null,
    fecha_para_entregar: null,
    fecha_entregada: null,
    imagen_url: null,
    prioridad: 'media',
    posicion: 0,
    asignado_a: null,
    asignado_nombre: null,
    tags: [],
    subtasks_total: 0,
    subtasks_done: 0,
    comments_count: 0,
    dias_en_columna: 0,
    ...partial,
  };
}

function board(tarjetas: TarjetaBoardItem[], totals: Record<string, number>): BoardInfiniteData {
  const page: TarjetasBoardResponse = {
    tarjetas,
    pagination: { page: 1, per_page: 50, total: tarjetas.length, pages: 1, has_next: false, has_prev: false },
    column_totals: totals,
  };
  return { pages: [page], pageParams: [undefined] };
}

describe('applyCardPatch', () => {
  it('moves a card between columns and updates totals immediately', () => {
    const moved = card({ id: 1, columna: 'ingresado' });
    const data = board(
      [moved, card({ id: 2, columna: 'ingresado' })],
      { ingresado: 2, diagnosticada: 0 },
    );

    const next = applyCardPatch(data, { ...moved, columna: 'diagnosticada', dias_en_columna: 0 });
    expect(next?.pages[0].tarjetas.find(t => t.id === 1)?.columna).toBe('diagnosticada');
    expect(next?.pages[0].column_totals).toEqual({ ingresado: 1, diagnosticada: 1 });
  });

  it('removes a card that no longer matches the estado filter', () => {
    const moved = card({ id: 1, columna: 'ingresado' });
    const data = board([moved], { ingresado: 1, diagnosticada: 0 });
    const filters = { search: '', estado: 'ingresado', prioridad: '', asignado_a: '', cargador: '', tag: '' };

    const next = applyCardPatch(data, { ...moved, columna: 'diagnosticada' }, filters);
    expect(next?.pages[0].tarjetas.find(t => t.id === 1)).toBeUndefined();
    expect(next?.pages[0].column_totals?.ingresado).toBe(0);
  });
});

describe('local card updates', () => {
  it('tracks a recent local update window', () => {
    markLocalCardUpdate(99);
    expect(wasRecentLocalCardUpdate(99)).toBe(true);
    expect(wasRecentLocalCardUpdate(100)).toBe(false);
  });
});
