const BASE = '';

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
}

export interface TarjetaCreate {
  nombre_propietario?: string;
  problema?: string;
  whatsapp?: string;
  fecha_limite?: string;
  imagen_url?: string;
  tiene_cargador?: string;
  notas_tecnicas?: string;
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
}

export const api = {
  async getTarjetas(params?: { page?: number; per_page?: number; light?: number }): Promise<Tarjeta[] | { tarjetas: Tarjeta[]; pagination: object }> {
    const search = new URLSearchParams();
    if (params?.page != null) search.set('page', String(params.page));
    if (params?.per_page != null) search.set('per_page', String(params.per_page));
    if (params?.light === 1) search.set('light', '1');
    const res = await fetch(`${BASE}/api/tarjetas${search.toString() ? '?' + search : ''}`, {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async createTarjeta(data: TarjetaCreate): Promise<Tarjeta> {
    const res = await fetch(`${BASE}/api/tarjetas`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async updateTarjeta(id: number, data: TarjetaUpdate): Promise<Tarjeta> {
    const res = await fetch(`${BASE}/api/tarjetas/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async deleteTarjeta(id: number): Promise<void> {
    const res = await fetch(`${BASE}/api/tarjetas/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
  },
  async getHistorial(id: number): Promise<{ id: number; tarjeta_id: number; old_status: string | null; new_status: string; changed_at: string | null }[]> {
    const res = await fetch(`${BASE}/api/tarjetas/${id}/historial`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async getEstadisticas(): Promise<object> {
    const res = await fetch(`${BASE}/api/estadisticas`);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async procesarImagen(imageData: string): Promise<{ nombre: string; telefono: string; tiene_cargador: boolean }> {
    const res = await fetch(`${BASE}/api/procesar-imagen`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageData }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async transcribirAudio(formData: FormData): Promise<{ transcripcion: string }> {
    const res = await fetch(`${BASE}/api/transcribir-audio`, { method: 'POST', body: formData });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
  async exportar(params: { formato: string; estado?: string; fecha_desde?: string; fecha_hasta?: string }): Promise<Blob> {
    const search = new URLSearchParams({ formato: params.formato })
    if (params.estado && params.estado !== 'todos') search.set('estado', params.estado)
    if (params.fecha_desde) search.set('fecha_desde', params.fecha_desde)
    if (params.fecha_hasta) search.set('fecha_hasta', params.fecha_hasta)
    const res = await fetch(`${BASE}/api/exportar?${search}`)
    if (!res.ok) throw new Error(await res.text())
    return res.blob()
  },
  async procesarMultimedia(imageData: string, audioData?: string): Promise<{ imagen: object; audio: string | object }> {
    const res = await fetch(`${BASE}/api/procesar-multimedia`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageData, audio: audioData }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};
