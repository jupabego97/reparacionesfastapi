import { toApiError } from '../api/client';

export interface UiErrorFeedback {
  message: string;
  action: 'reintentar' | 'reautenticar' | 'contactar_soporte';
  actionLabel: string;
  requestId?: string;
}

const ACTION_LABELS: Record<UiErrorFeedback['action'], string> = {
  reintentar: 'Reintentar',
  reautenticar: 'Reautenticar',
  contactar_soporte: 'Contactar soporte',
};

export function getUiErrorFeedback(error: unknown, fallback = 'No pudimos completar la operación.'): UiErrorFeedback {
  const parsed = toApiError(error);
  const base = parsed.message?.trim() || fallback;
  const message = parsed.requestId && !base.includes('ID solicitud')
    ? `${base} (ID solicitud: ${parsed.requestId})`
    : base;

  return {
    message,
    action: parsed.action,
    actionLabel: ACTION_LABELS[parsed.action],
    requestId: parsed.requestId,
  };
}
