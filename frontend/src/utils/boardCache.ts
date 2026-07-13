import type { InfiniteData } from '@tanstack/react-query';
import type { TarjetaBoardItem, TarjetasBoardResponse } from '../api/client';
import { cardMatchesBoardFilters, type BoardFilters } from './boardMoves';

export type BoardInfiniteData = InfiniteData<TarjetasBoardResponse, string | number | undefined>;

export function findCardInBoard(data: BoardInfiniteData | undefined, id: number): TarjetaBoardItem | undefined {
  if (!data) return undefined;
  for (const page of data.pages) {
    const found = page.tarjetas.find(t => t.id === id);
    if (found) return found;
  }
  return undefined;
}

function adjustColumnTotals(
  totals: Record<string, number> | undefined,
  fromCol: string | null | undefined,
  toCol: string | null | undefined,
  delta: number,
): Record<string, number> | undefined {
  if (!totals || !delta) return totals;
  const next = { ...totals };
  if (fromCol && fromCol in next) next[fromCol] = Math.max(0, (next[fromCol] || 0) + delta);
  if (toCol && toCol !== fromCol && toCol in next) next[toCol] = Math.max(0, (next[toCol] || 0) - delta);
  return next;
}

function bumpColumnTotal(
  totals: Record<string, number> | undefined,
  col: string,
  delta: number,
): Record<string, number> | undefined {
  if (!totals) return totals;
  return { ...totals, [col]: Math.max(0, (totals[col] || 0) + delta) };
}

export function applyCardPatch(
  data: BoardInfiniteData | undefined,
  card: TarjetaBoardItem,
  filters?: BoardFilters,
): BoardInfiniteData | undefined {
  if (!data) return data;

  const existing = findCardInBoard(data, card.id);
  const matches = !filters || cardMatchesBoardFilters(card, filters);
  const oldCol = existing?.columna;
  const newCol = card.columna;

  let nextPages = data.pages.map(page => {
    const idx = page.tarjetas.findIndex(t => t.id === card.id);
    if (idx === -1) return page;

    if (!matches) {
      return { ...page, tarjetas: page.tarjetas.filter(t => t.id !== card.id) };
    }

    const nextTarjetas = [...page.tarjetas];
    nextTarjetas[idx] = { ...nextTarjetas[idx], ...card };
    return { ...page, tarjetas: nextTarjetas };
  });

  if (!existing && matches && nextPages.length > 0) {
    const first = nextPages[0];
    nextPages = [{ ...first, tarjetas: [card, ...first.tarjetas] }, ...nextPages.slice(1)];
  }

  if (nextPages.length > 0 && nextPages[0].column_totals) {
    let totals: Record<string, number> = { ...nextPages[0].column_totals };
    if (!existing && matches) {
      totals = bumpColumnTotal(totals, newCol, 1) ?? totals;
    } else if (existing && !matches) {
      totals = bumpColumnTotal(totals, oldCol || newCol, -1) ?? totals;
    } else if (existing && oldCol !== newCol) {
      totals = adjustColumnTotals(totals, oldCol, newCol, 1) ?? totals;
    }
    nextPages[0] = { ...nextPages[0], column_totals: totals };
  }

  return { ...data, pages: nextPages };
}

export function removeCardPatch(data: BoardInfiniteData | undefined, id: number): BoardInfiniteData | undefined {
  if (!data) return data;
  const existing = findCardInBoard(data, id);

  const nextPages = data.pages.map(page => ({
    ...page,
    tarjetas: page.tarjetas.filter(t => t.id !== id),
  }));

  if (existing && nextPages.length > 0 && nextPages[0].column_totals) {
    nextPages[0] = {
      ...nextPages[0],
      column_totals: bumpColumnTotal(nextPages[0].column_totals, existing.columna, -1),
    };
  }

  return { ...data, pages: nextPages };
}

export type ReorderItem = { id: number; columna: string; posicion: number };

export function applyReorderPatch(
  data: BoardInfiniteData | undefined,
  items: ReorderItem[],
  filters?: BoardFilters,
): BoardInfiniteData | undefined {
  if (!data || !items.length) return data;
  const byId = new Map(items.map(i => [i.id, i]));
  return {
    ...data,
    pages: data.pages.map(page => ({
      ...page,
      tarjetas: page.tarjetas
        .map(t => {
          const upd = byId.get(t.id);
          if (!upd) return t;
          const next = { ...t, columna: upd.columna, posicion: upd.posicion };
          if (filters && !cardMatchesBoardFilters(next, filters)) return null;
          return next;
        })
        .filter((t): t is TarjetaBoardItem => t !== null),
    })),
  };
}

export function applyActivityPatch(
  data: BoardInfiniteData | undefined,
  tarjetaId: number,
  kind: string,
): BoardInfiniteData | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map(page => ({
      ...page,
      tarjetas: page.tarjetas.map(t => {
        if (t.id !== tarjetaId) return t;
        if (kind === 'comment') {
          return { ...t, comments_count: (t.comments_count || 0) + 1 };
        }
        if (kind === 'subtask') {
          return { ...t, subtasks_total: (t.subtasks_total || 0) + 1 };
        }
        return t;
      }),
    })),
  };
}
