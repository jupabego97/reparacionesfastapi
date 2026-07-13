import type { UserInfo } from '../api/client';

export type OperationalViewId = 'all' | 'my_work' | 'due_today' | 'blocked' | 'ready' | 'overdue';

export type OperationalFilters = {
  search: string;
  estado: string;
  prioridad: string;
  asignado_a: string;
  cargador: string;
  tag: string;
  orden_por: string;
  orden_dir: string;
};

export const OPERATIONAL_VIEWS: { id: OperationalViewId; label: string; icon: string }[] = [
  { id: 'all', label: 'Todas', icon: 'fas fa-th' },
  { id: 'my_work', label: 'Mi trabajo', icon: 'fas fa-user-check' },
  { id: 'due_today', label: 'Pendientes hoy', icon: 'fas fa-calendar-day' },
  { id: 'blocked', label: 'Bloqueadas', icon: 'fas fa-lock' },
  { id: 'ready', label: 'Para entregar', icon: 'fas fa-box-open' },
  { id: 'overdue', label: 'Atrasadas', icon: 'fas fa-exclamation-circle' },
];

export function filtersForOperationalView(
  viewId: OperationalViewId,
  user: UserInfo | null,
): Partial<OperationalFilters> {
  switch (viewId) {
    case 'my_work':
      return user ? { asignado_a: String(user.id), estado: '', prioridad: '', cargador: '', tag: '' } : {};
    case 'due_today':
      return { estado: '', orden_por: 'fecha_limite', orden_dir: 'asc' };
    case 'blocked':
      return { search: '', estado: '', prioridad: '', asignado_a: '', cargador: '', tag: '', orden_por: 'fecha_ingreso', orden_dir: 'desc' };
    case 'ready':
      return { estado: 'para_entregar', prioridad: '', asignado_a: '', cargador: '', tag: '' };
    case 'overdue':
      return { orden_por: 'fecha_limite', orden_dir: 'asc', estado: '', prioridad: '', asignado_a: '', cargador: '', tag: '' };
    case 'all':
    default:
      return { search: '', estado: '', prioridad: '', asignado_a: '', cargador: '', tag: '', orden_por: '', orden_dir: '' };
  }
}

export function cardMatchesOperationalView(
  card: { bloqueada?: boolean; fecha_limite?: string | null; columna?: string },
  viewId: OperationalViewId,
  today = new Date(),
): boolean {
  if (viewId === 'all') return true;
  if (viewId === 'blocked') return !!card.bloqueada;
  if (viewId === 'ready') return card.columna === 'para_entregar';
  if (viewId === 'overdue') {
    if (!card.fecha_limite) return false;
    const due = new Date(card.fecha_limite);
    due.setHours(23, 59, 59, 999);
    return due < today && card.columna !== 'listos';
  }
  if (viewId === 'due_today') {
    if (!card.fecha_limite) return false;
    return card.fecha_limite.startsWith(today.toISOString().split('T')[0]);
  }
  return true;
}
