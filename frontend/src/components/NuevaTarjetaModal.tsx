import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tag, UserInfo, TarjetaCreate } from '../api/client';

interface Props {
  onClose: () => void;
}

function defaultTomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

export default function NuevaTarjetaModal({ onClose }: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState<'capture' | 'form'>('capture');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cameraActive, setCameraActive] = useState(false);

  const [form, setForm] = useState({
    nombre_propietario: '',
    problema: '',
    whatsapp: '',
    fecha_limite: defaultTomorrowDate(),
    tiene_cargador: 'si',
    imagen_url: '',
    prioridad: 'media',
    asignado_a: '' as string | number,
    costo_estimado: '' as string | number,
    notas_tecnicas: '',
  });
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

  const { data: allTags = [] } = useQuery({ queryKey: ['tags'], queryFn: api.getTags });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: api.getUsers });

  const createMut = useMutation({
    mutationFn: (data: TarjetaCreate) => api.createTarjeta(data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tarjetas-board'] }); onClose(); },
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error al crear'),
  });

  useEffect(() => {
    const currentVideo = videoRef.current;
    return () => {
      if (currentVideo?.srcObject) {
        (currentVideo.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) { videoRef.current.srcObject = stream; setCameraActive(true); }
    } catch { setError('No se pudo acceder a la cámara'); }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    const dataUrl = c.toDataURL('image/jpeg', 0.7);
    processImage(dataUrl);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { if (ev.target?.result) processImage(ev.target.result as string); };
    reader.readAsDataURL(file);
  };

  const processImage = async (imageData: string) => {
    setLoading(true);
    setError('');
    try {
      const result = await api.procesarImagen(imageData);
      setForm(prev => ({
        ...prev,
        nombre_propietario: result.nombre || prev.nombre_propietario,
        whatsapp: result.telefono || prev.whatsapp,
        tiene_cargador: result.tiene_cargador ? 'si' : 'no',
        imagen_url: imageData,
      }));
      setStep('form');
    } catch {
      setForm(prev => ({ ...prev, imagen_url: imageData }));
      setStep('form');
    }
    setLoading(false);
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      setCameraActive(false);
    }
  };

  // Mejora #27: Validación con mensajes claros
  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.nombre_propietario.trim()) errs.nombre = 'El nombre es requerido';
    if (form.whatsapp && !/^\+?\d{7,15}$/.test(form.whatsapp.replace(/[\s-]/g, ''))) {
      errs.whatsapp = 'Formato: +57 300 123 4567';
    }
    if (!form.fecha_limite) errs.fecha = 'La fecha límite es requerida';
    setValidationErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleSubmit = () => {
    if (!validate()) return;
    createMut.mutate({
      nombre_propietario: form.nombre_propietario.trim(),
      problema: form.problema.trim() || 'Sin descripción',
      whatsapp: form.whatsapp.trim(),
      fecha_limite: form.fecha_limite,
      tiene_cargador: form.tiene_cargador,
      imagen_url: form.imagen_url || undefined,
      prioridad: form.prioridad,
      asignado_a: form.asignado_a ? Number(form.asignado_a) : undefined,
      costo_estimado: form.costo_estimado ? Number(form.costo_estimado) : undefined,
      notas_tecnicas: form.notas_tecnicas || undefined,
      tags: selectedTags.length ? selectedTags : undefined,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-pro" onClick={e => e.stopPropagation()}>
        <div className="modal-pro-header">
          <h3><i className="fas fa-plus-circle"></i> Nueva Reparación</h3>
          <button className="modal-close" onClick={onClose}><i className="fas fa-times"></i></button>
        </div>

        <div className="modal-pro-body">
          {error && <div className="login-error"><i className="fas fa-exclamation-triangle"></i> {error}</div>}

          {step === 'capture' && (
            <div className="capture-step">
              <p className="capture-instructions">
                <i className="fas fa-magic"></i> Toma una foto del equipo y la IA extraerá los datos automáticamente
              </p>
              {cameraActive ? (
                <div className="camera-container">
                  <video ref={videoRef} autoPlay playsInline className="camera-preview" />
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                  <button className="btn-capture" onClick={capturePhoto} disabled={loading}>
                    {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-camera"></i>}
                  </button>
                </div>
              ) : (
                <div className="capture-options">
                  <button className="capture-btn" onClick={startCamera}>
                    <i className="fas fa-camera"></i>
                    <span>Usar cámara</span>
                  </button>
                  <label className="capture-btn">
                    <i className="fas fa-image"></i>
                    <span>Subir imagen</span>
                    <input type="file" accept="image/*" onChange={handleFileUpload} style={{ display: 'none' }} />
                  </label>
                  <button className="capture-btn skip" onClick={() => setStep('form')}>
                    <i className="fas fa-keyboard"></i>
                    <span>Sin imagen</span>
                  </button>
                </div>
              )}
              {loading && <div className="ai-loading"><i className="fas fa-brain fa-pulse"></i> Procesando con IA...</div>}
            </div>
          )}

          {step === 'form' && (
            <div className="edit-form">
              <div className="form-row">
                <div className="form-group">
                  <label><i className="fas fa-user"></i> Propietario *</label>
                  <input value={form.nombre_propietario} onChange={e => setForm({ ...form, nombre_propietario: e.target.value })}
                    className={validationErrors.nombre ? 'error' : ''} autoFocus />
                  {validationErrors.nombre && <span className="field-error">{validationErrors.nombre}</span>}
                </div>
                <div className="form-group">
                  <label><i className="fab fa-whatsapp"></i> WhatsApp</label>
                  <input value={form.whatsapp} onChange={e => setForm({ ...form, whatsapp: e.target.value })}
                    placeholder="+57 300 123 4567" className={validationErrors.whatsapp ? 'error' : ''} />
                  {validationErrors.whatsapp && <span className="field-error">{validationErrors.whatsapp}</span>}
                </div>
              </div>
              <div className="form-group">
                <label><i className="fas fa-exclamation-circle"></i> Problema</label>
                <textarea rows={3} value={form.problema} onChange={e => setForm({ ...form, problema: e.target.value })} placeholder="Describe el problema del equipo..." />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label><i className="fas fa-calendar"></i> Fecha límite *</label>
                  <input type="date" value={form.fecha_limite} onChange={e => setForm({ ...form, fecha_limite: e.target.value })}
                    className={validationErrors.fecha ? 'error' : ''} />
                  {validationErrors.fecha && <span className="field-error">{validationErrors.fecha}</span>}
                </div>
                <div className="form-group">
                  <label><i className="fas fa-plug"></i> Cargador</label>
                  <select value={form.tiene_cargador} onChange={e => setForm({ ...form, tiene_cargador: e.target.value })}>
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label><i className="fas fa-flag"></i> Prioridad</label>
                  <select value={form.prioridad} onChange={e => setForm({ ...form, prioridad: e.target.value })}>
                    <option value="alta">🔴 Alta</option>
                    <option value="media">🟡 Media</option>
                    <option value="baja">🟢 Baja</option>
                  </select>
                </div>
                <div className="form-group">
                  <label><i className="fas fa-user-cog"></i> Asignar a</label>
                  <select value={form.asignado_a} onChange={e => setForm({ ...form, asignado_a: e.target.value })}>
                    <option value="">Sin asignar</option>
                    {users.map((u: UserInfo) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label><i className="fas fa-wrench"></i> Notas técnicas</label>
                <textarea rows={2} value={form.notas_tecnicas} onChange={e => setForm({ ...form, notas_tecnicas: e.target.value })} />
              </div>
              <div className="form-group">
                <label><i className="fas fa-dollar-sign"></i> Costo estimado</label>
                <input type="number" value={form.costo_estimado} onChange={e => setForm({ ...form, costo_estimado: e.target.value })} placeholder="0" />
              </div>
              {allTags.length > 0 && (
                <div className="form-group">
                  <label><i className="fas fa-tags"></i> Etiquetas</label>
                  <div className="tags-select">
                    {allTags.map((tag: Tag) => (
                      <button key={tag.id} type="button"
                        className={`tag-chip-btn ${selectedTags.includes(tag.id) ? 'selected' : ''}`}
                        style={{
                          borderColor: tag.color, color: selectedTags.includes(tag.id) ? '#fff' : tag.color,
                          background: selectedTags.includes(tag.id) ? tag.color : 'transparent'
                        }}
                        onClick={() => setSelectedTags(p => p.includes(tag.id) ? p.filter(i => i !== tag.id) : [...p, tag.id])}>
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {form.imagen_url && (
                <div className="preview-image">
                  <img src={form.imagen_url} alt="Preview" />
                  <button className="btn-del-sm" onClick={() => setForm({ ...form, imagen_url: '' })}><i className="fas fa-times"></i></button>
                </div>
              )}
            </div>
          )}
        </div>

        {step === 'form' && (
          <div className="modal-pro-footer">
            <button className="btn-cancel" onClick={() => setStep('capture')}>
              <i className="fas fa-arrow-left"></i> Volver
            </button>
            <button className="btn-save" onClick={handleSubmit} disabled={createMut.isPending}>
              {createMut.isPending ? <><i className="fas fa-spinner fa-spin"></i> Creando...</> : <><i className="fas fa-check"></i> Crear</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
