export const ACTION_LABELS: Record<string, string> = {
  created: 'Tarjeta creada',
  updated: 'Datos actualizados',
  status_changed: 'Cambio de estado',
  reordered: 'Reordenada',
  blocked: 'Bloqueada',
  unblocked: 'Desbloqueada',
  deleted: 'Eliminada',
  restored: 'Restaurada',
  assigned: 'Asignación',
  priority_changed: 'Prioridad cambiada',
  tag_added: 'Etiqueta agregada',
};

export const STATUS_LABELS: Record<string, string> = {
  ingresado: 'Ingresado',
  diagnosticada: 'En diagnóstico',
  para_entregar: 'Para entregar',
  listos: 'Entregados',
};

export function formatAuditAction(action?: string | null): string {
  if (!action) return ACTION_LABELS.status_changed;
  return ACTION_LABELS[action] || action;
}

export function formatAuditDetails(action: string | null | undefined, details: string | null | undefined): string | null {
  if (!details) return null;
  if (action === 'updated') {
    try {
      const fields = JSON.parse(details) as string[];
      if (Array.isArray(fields) && fields.length) {
        return `Campos: ${fields.join(', ')}`;
      }
    } catch {
      return details;
    }
  }
  return details;
}
