/** URL del backend. En producción (servicios separados) = VITE_API_URL. En dev con proxy = '' */
export const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export interface Tarjeta {
  id: number;
  nombre_propietario: string | null;
  problema: string | null;
  whatsapp: string | null;
  fecha_inicio: string | null;
  fecha_limite: string | null;
  columna: string;
  tiene_cargador: string | null;
  fecha_diagnosticada: string | null;
  fecha_para_entregar: string | null;
  fecha_entregada: string | null;
  notas_tecnicas: string | null;
  imagen_url: string | null;
  // Nuevos campos
  prioridad: string;
  posicion: number;
  asignado_a: number | null;
  asignado_nombre: string | null;
  costo_estimado: number | null;
  costo_final: number | null;
  notas_costo: string | null;
  eliminado: boolean;
  tags: Tag[];
  subtasks_total: number;
  subtasks_done: number;
  comments_count: number;
  dias_en_columna: number;
}

export interface TarjetaCreate {
  nombre_propietario?: string;
  problema?: string;
  whatsapp?: string;
  fecha_limite?: string;
  imagen_url?: string;
  tiene_cargador?: string;
  notas_tecnicas?: string;
  prioridad?: string;
  asignado_a?: number;
  costo_estimado?: number;
  tags?: number[];
}

export interface TarjetaUpdate {
  nombre_propietario?: string;
  problema?: string;
  whatsapp?: string;
  fecha_limite?: string;
  imagen_url?: string;
  tiene_cargador?: string;
  notas_tecnicas?: string;
  columna?: string;
  prioridad?: string;
  posicion?: number;
  asignado_a?: number | null;
  costo_estimado?: number | null;
  costo_final?: number | null;
  notas_costo?: string | null;
  tags?: number[];
}

export interface KanbanColumn {
  id: number;
  key: string;
  title: string;
  color: string;
  icon: string;
  position: number;
  wip_limit: number | null;
  is_done_column: boolean;
}

export interface Tag {
  id: number;
  name: string;
  color: string;
  icon: string | null;
}

export interface SubTask {
  id: number;
  tarjeta_id: number;
  title: string;
  completed: boolean;
  position: number;
  created_at: string | null;
  completed_at: string | null;
}

export interface CommentItem {
  id: number;
  tarjeta_id: number;
  user_id: number | null;
  author_name: string;
  content: string;
  created_at: string | null;
}

export interface UserInfo {
  id: number;
  username: string;
  email: string | null;
  full_name: string;
  role: string;
  is_active: boolean;
  avatar_color: string;
}

export interface NotificationItem {
  id: number;
  user_id: number | null;
  tarjeta_id: number | null;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string | null;
}

export type ApiErrorKind = 'auth' | 'validation' | 'network' | 'server' | 'unknown';

export class ApiError extends Error {
  status?: number;
  kind: ApiErrorKind;
  requestId?: string;
  action: 'reintentar' | 'reautenticar' | 'contactar_soporte';

  constructor(message: string, options: { status?: number; kind: ApiErrorKind; requestId?: string; action: 'reintentar' | 'reautenticar' | 'contactar_soporte' }) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.kind = options.kind;
    this.requestId = options.requestId;
    this.action = options.action;
  }
}

function extractRequestId(headers: Headers): string | undefined {
  return headers.get('x-request-id') || headers.get('x-correlation-id') || headers.get('request-id') || undefined;
}

function readApiMessage(payload: unknown): string {
  if (!payload) return '';
  if (typeof payload === 'string') return payload.trim();
  if (typeof payload === 'object') {
    const source = payload as Record<string, unknown>;
    const detail = source.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      const firstItem = detail[0] as Record<string, unknown> | undefined;
      if (firstItem?.msg && typeof firstItem.msg === 'string') return firstItem.msg;
    }
    if (typeof source.error === 'string') return source.error;
    if (typeof source.message === 'string') return source.message;
  }
  return '';
}

function buildFriendlyError(status: number, rawMessage: string, requestId?: string): ApiError {
  const trace = requestId ? ` (ID solicitud: ${requestId})` : '';
  if (status === 401 || status === 403) {
    return new ApiError(`Tu sesión no es válida o expiró. Acción sugerida: reautenticar.${trace}`, {
      status, kind: 'auth', requestId, action: 'reautenticar',
    });
  }
  if (status === 400 || status === 422) {
    return new ApiError(`${rawMessage || 'Hay datos inválidos en la solicitud.'} Acción sugerida: reintentar.${trace}`, {
      status, kind: 'validation', requestId, action: 'reintentar',
    });
  }
  if (status >= 500) {
    return new ApiError(`El servidor tuvo un problema al procesar la solicitud. Acción sugerida: reintentar.${trace}`, {
      status, kind: 'server', requestId, action: 'reintentar',
    });
  }
  return new ApiError(`${rawMessage || 'No se pudo completar la operación.'} Acción sugerida: reintentar.${trace}`, {
    status, kind: 'unknown', requestId, action: 'reintentar',
  });
}

export async function parseApiError(response: Response): Promise<ApiError> {
  const contentType = response.headers.get('content-type') || '';
  const requestId = extractRequestId(response.headers);

  let message = '';
  if (contentType.includes('application/json')) {
    try {
      const json = await response.json();
      message = readApiMessage(json);
    } catch {
      message = '';
    }
  } else {
    try {
      message = (await response.text()).trim();
    } catch {
      message = '';
    }
  }

  return buildFriendlyError(response.status, message, requestId);
}

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof Error && /fetch|network|failed/i.test(error.message)) {
    return new ApiError('No pudimos conectar con el servidor. Acción sugerida: reintentar.', {
      kind: 'network', action: 'reintentar',
    });
  }
  return new ApiError('Ocurrió un error inesperado. Acción sugerida: reintentar.', {
    kind: 'unknown', action: 'reintentar',
  });
}

async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw toApiError(error);
  }
}

async function ensureOk(res: Response): Promise<void> {
  if (!res.ok) throw await parseApiError(res);
}

// --- Helper para auth header ---
function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...authHeaders() };
}

export const api = {
  // --- Auth ---
  async login(username: string, password: string): Promise<{ access_token: string; user: UserInfo }> {
    const res = await apiFetch(`${API_BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    await ensureOk(res);
    return res.json();
  },
  async register(data: { username: string; password: string; full_name?: string; email?: string; role?: string; avatar_color?: string }): Promise<{ access_token: string; user: UserInfo }> {
    const res = await apiFetch(`${API_BASE}/api/auth/register`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    await ensureOk(res);
    return res.json();
  },
  async getMe(): Promise<UserInfo> {
    const res = await apiFetch(`${API_BASE}/api/auth/me`, { headers: authHeaders() });
    await ensureOk(res);
    return res.json();
  },
  async getUsers(): Promise<UserInfo[]> {
    const res = await apiFetch(`${API_BASE}/api/auth/users`, { headers: authHeaders() });
    await ensureOk(res);
    return res.json();
  },

  // --- Tarjetas ---
  async getTarjetas(params?: { page?: number; per_page?: number; light?: number; search?: string; estado?: string; prioridad?: string; asignado_a?: number; tag?: number }): Promise<Tarjeta[] | { tarjetas: Tarjeta[]; pagination: object }> {
    const search = new URLSearchParams();
    if (params?.page != null) search.set('page', String(params.page));
    if (params?.per_page != null) search.set('per_page', String(params.per_page));
    if (params?.light === 1) search.set('light', '1');
    if (params?.search) search.set('search', params.search);
    if (params?.estado) search.set('estado', params.estado);
    if (params?.prioridad) search.set('prioridad', params.prioridad);
    if (params?.asignado_a != null) search.set('asignado_a', String(params.asignado_a));
    if (params?.tag != null) search.set('tag', String(params.tag));
    const res = await apiFetch(`${API_BASE}/api/tarjetas${search.toString() ? '?' + search : ''}`, {
      headers: authHeaders(),
    });
    await ensureOk(res);
    return res.json();
  },
  async createTarjeta(data: TarjetaCreate): Promise<Tarjeta> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas`, {
      method: 'POST', headers: jsonHeaders(), body: JSON.stringify(data),
    });
    await ensureOk(res);
    return res.json();
  },
  async updateTarjeta(id: number, data: TarjetaUpdate): Promise<Tarjeta> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas/${id}`, {
      method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(data),
    });
    await ensureOk(res);
    return res.json();
  },
  async deleteTarjeta(id: number): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas/${id}`, { method: 'DELETE', headers: authHeaders() });
    await ensureOk(res);
  },
  async restoreTarjeta(id: number): Promise<Tarjeta> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas/${id}/restore`, { method: 'PUT', headers: authHeaders() });
    await ensureOk(res);
    return res.json();
  },
  async batchUpdatePositions(items: { id: number; columna: string; posicion: number }[]): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas/batch/positions`, {
      method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ items }),
    });
    await ensureOk(res);
  },
  async getHistorial(id: number): Promise<{ id: number; tarjeta_id: number; old_status: string | null; new_status: string; changed_at: string | null; changed_by_name: string | null }[]> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas/${id}/historial`, { headers: authHeaders() });
    await ensureOk(res);
    return res.json();
  },
  async getTrash(): Promise<Tarjeta[]> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas/trash/list`, { headers: authHeaders() });
    await ensureOk(res);
    return res.json();
  },

  // --- Estadísticas ---
  async getEstadisticas(): Promise<object> {
    const res = await apiFetch(`${API_BASE}/api/estadisticas`, { headers: authHeaders() });
    await ensureOk(res);
    return res.json();
  },

  // --- Columnas ---
  async getColumnas(): Promise<KanbanColumn[]> {
    const res = await apiFetch(`${API_BASE}/api/columnas`, { headers: authHeaders() });
    await ensureOk(res);
    return res.json();
  },
  async createColumna(data: Partial<KanbanColumn>): Promise<KanbanColumn> {
    const res = await apiFetch(`${API_BASE}/api/columnas`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(data) });
    await ensureOk(res);
    return res.json();
  },
  async updateColumna(id: number, data: Partial<KanbanColumn>): Promise<KanbanColumn> {
    const res = await apiFetch(`${API_BASE}/api/columnas/${id}`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(data) });
    await ensureOk(res);
    return res.json();
  },
  async deleteColumna(id: number): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/columnas/${id}`, { method: 'DELETE', headers: authHeaders() });
    await ensureOk(res);
  },

  // --- Tags ---
  async getTags(): Promise<Tag[]> {
    const res = await apiFetch(`${API_BASE}/api/tags`, { headers: authHeaders() });
    await ensureOk(res);
    return res.json();
  },
  async createTag(data: { name: string; color?: string }): Promise<Tag> {
    const res = await apiFetch(`${API_BASE}/api/tags`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(data) });
    await ensureOk(res);
    return res.json();
  },
  async deleteTag(id: number): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/tags/${id}`, { method: 'DELETE', headers: authHeaders() });
    await ensureOk(res);
  },
  async addTagToTarjeta(tarjetaId: number, tagId: number): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas/${tarjetaId}/tags/${tagId}`, { method: 'POST', headers: authHeaders() });
    await ensureOk(res);
  },
  async removeTagFromTarjeta(tarjetaId: number, tagId: number): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas/${tarjetaId}/tags/${tagId}`, { method: 'DELETE', headers: authHeaders() });
    await ensureOk(res);
  },

  // --- SubTasks ---
  async getSubTasks(tarjetaId: number): Promise<SubTask[]> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas/${tarjetaId}/subtasks`, { headers: authHeaders() });
    await ensureOk(res);
    return res.json();
  },
  async createSubTask(tarjetaId: number, title: string): Promise<SubTask> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas/${tarjetaId}/subtasks`, {
      method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ title }),
    });
    await ensureOk(res);
    return res.json();
  },
  async updateSubTask(id: number, data: { completed?: boolean; title?: string }): Promise<SubTask> {
    const res = await apiFetch(`${API_BASE}/api/subtasks/${id}`, {
      method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(data),
    });
    await ensureOk(res);
    return res.json();
  },
  async deleteSubTask(id: number): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/subtasks/${id}`, { method: 'DELETE', headers: authHeaders() });
    await ensureOk(res);
  },

  // --- Comments ---
  async getComments(tarjetaId: number): Promise<CommentItem[]> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas/${tarjetaId}/comments`, { headers: authHeaders() });
    await ensureOk(res);
    return res.json();
  },
  async createComment(tarjetaId: number, content: string): Promise<CommentItem> {
    const res = await apiFetch(`${API_BASE}/api/tarjetas/${tarjetaId}/comments`, {
      method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ content }),
    });
    await ensureOk(res);
    return res.json();
  },
  async deleteComment(id: number): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/comments/${id}`, { method: 'DELETE', headers: authHeaders() });
    await ensureOk(res);
  },

  // --- Notificaciones ---
  async getNotificaciones(unreadOnly = false): Promise<{ notifications: NotificationItem[]; unread_count: number }> {
    const res = await apiFetch(`${API_BASE}/api/notificaciones?unread_only=${unreadOnly}`, { headers: authHeaders() });
    await ensureOk(res);
    return res.json();
  },
  async markNotificationsRead(ids: number[]): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/notificaciones/mark-read`, {
      method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ ids }),
    });
    await ensureOk(res);
  },
  async markAllNotificationsRead(): Promise<void> {
    const res = await apiFetch(`${API_BASE}/api/notificaciones/mark-all-read`, { method: 'PUT', headers: authHeaders() });
    await ensureOk(res);
  },

  // --- Multimedia ---
  async procesarImagen(imageData: string): Promise<{ nombre: string; telefono: string; tiene_cargador: boolean }> {
    const res = await apiFetch(`${API_BASE}/api/procesar-imagen`, {
      method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ image: imageData }),
    });
    await ensureOk(res);
    return res.json();
  },
  async transcribirAudio(formData: FormData): Promise<{ transcripcion: string }> {
    const res = await apiFetch(`${API_BASE}/api/transcribir-audio`, { method: 'POST', body: formData, headers: authHeaders() });
    await ensureOk(res);
    return res.json();
  },
  async exportar(params: { formato: string; estado?: string; fecha_desde?: string; fecha_hasta?: string }): Promise<Blob> {
    const search = new URLSearchParams({ formato: params.formato })
    if (params.estado && params.estado !== 'todos') search.set('estado', params.estado)
    if (params.fecha_desde) search.set('fecha_desde', params.fecha_desde)
    if (params.fecha_hasta) search.set('fecha_hasta', params.fecha_hasta)
    const res = await apiFetch(`${API_BASE}/api/exportar?${search}`, { headers: authHeaders() })
    await ensureOk(res)
    return res.blob()
  },
};
