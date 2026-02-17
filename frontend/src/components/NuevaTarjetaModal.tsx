import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tag, UserInfo, TarjetaCreate } from '../api/client';

interface Props {
  onClose: () => void;
  onSuccess?: () => void;
}

function defaultTomorrowDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = () => setIsMobile(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return isMobile;
}

export default function NuevaTarjetaModal({ onClose, onSuccess }: Props) {
  const [step, setStep] = useState<'capture' | 'preview' | 'processing' | 'form'>('capture');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(false);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isMobile = useIsMobile();
  const [cameraActive, setCameraActive] = useState(() => window.innerWidth <= 768);
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoPreviews, setPhotoPreviews] = useState<string[]>([]);
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'partial_failed' | 'done'>('idle');

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
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const { data: allTags = [] } = useQuery({ queryKey: ['tags'], queryFn: api.getTags });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: api.getUsers });

  const createMut = useMutation({
    mutationFn: (data: TarjetaCreate) => api.createTarjeta(data),
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

  // En móvil: ir directo a la cámara al abrir, sin menú de opciones
  useEffect(() => {
    if (isMobile && step === 'capture') {
      setCameraActive(true);
      startCamera();
    }
  }, [isMobile, step]);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (videoRef.current) { videoRef.current.srcObject = stream; setCameraActive(true); }
    } catch {
      setError('No se pudo acceder a la cámara');
      setCameraActive(false); // Mostrar opciones subir/sin imagen si falla
    }
  };

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    const dataUrl = c.toDataURL('image/jpeg', 0.7);
    setFlash(true);
    setTimeout(() => setFlash(false), 200);
    setCapturedPreview(dataUrl);
    setStep('preview');
    if (videoRef.current?.srcObject) {
      (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      setCameraActive(false);
    }
  };

  const confirmPhoto = () => {
    if (capturedPreview) processImage(capturedPreview);
  };

  const retakePhoto = () => {
    setCapturedPreview(null);
    setCameraActive(true);
    setStep('capture');
    startCamera();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const all = [...photoFiles, ...files].slice(0, 10);
    if (all.length < photoFiles.length + files.length) {
      setError('Limite maximo de 10 fotos por tarjeta');
    }
    setPhotoFiles(all);
    const readers = all.map(file => new Promise<string>((resolve) => {
      const r = new FileReader();
      r.onload = ev => resolve((ev.target?.result as string) || '');
      r.readAsDataURL(file);
    }));
    Promise.all(readers).then(previews => {
      setPhotoPreviews(previews.filter(Boolean));
      if (previews[0]) processImage(previews[0]);
      else setStep('form');
    });
  };

  const processImage = async (imageData: string) => {
    setLoading(true);
    setError('');
    setStep('processing');
    try {
      const result = await api.procesarImagen(imageData);
      setForm(prev => ({
        ...prev,
        nombre_propietario: result.nombre || prev.nombre_propietario,
        whatsapp: result.telefono || prev.whatsapp,
        tiene_cargador: result.tiene_cargador ? 'si' : 'no',
        imagen_url: imageData,
      }));
      if (result._partial) {
        setError('IA no disponible. Completa los datos manualmente.');
      }
    } catch {
      setForm(prev => ({ ...prev, imagen_url: imageData }));
      setError('No se pudo analizar la imagen. Completa los datos manualmente.');
    }
    setCapturedPreview(null);
    setStep('form');
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

  const handleSubmit = async () => {
    if (!validate()) return;
    try {
      const created = await createMut.mutateAsync({
      nombre_propietario: form.nombre_propietario.trim(),
      problema: form.problema.trim() || 'Sin descripción',
      whatsapp: form.whatsapp.trim(),
      fecha_limite: form.fecha_limite,
      tiene_cargador: form.tiene_cargador,
      imagen_url: photoFiles.length > 0 ? undefined : (form.imagen_url || undefined),
      prioridad: form.prioridad,
      asignado_a: form.asignado_a ? Number(form.asignado_a) : undefined,
      costo_estimado: form.costo_estimado ? Number(form.costo_estimado) : undefined,
      notas_tecnicas: form.notas_tecnicas || undefined,
      tags: selectedTags.length ? selectedTags : undefined,
    });
      if (photoFiles.length > 0) {
        setUploadState('uploading');
        try {
          await api.uploadTarjetaMedia(created.id, photoFiles);
          setUploadState('done');
        } catch {
          setUploadState('partial_failed');
          setError('Tarjeta creada, pero algunas fotos no se pudieron subir');
        }
      }
      onSuccess?.();
      onClose();
    } catch {
      setUploadState('idle');
    }
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
            <div className={`capture-step ${isMobile && cameraActive ? 'camera-fullscreen' : ''}`}>
              {!cameraActive && (
                <p className="capture-instructions">
                  <i className="fas fa-magic"></i> Toma una foto del equipo y la IA extraerá los datos automáticamente
                </p>
              )}
              {cameraActive ? (
                <div className={`camera-container ${isMobile ? 'camera-fullscreen-inner' : ''}`}>
                  {isMobile && (
                    <button type="button" className="camera-back-btn" onClick={() => { (videoRef.current?.srcObject as MediaStream)?.getTracks().forEach(t => t.stop()); onClose(); }} aria-label="Cerrar cámara">
                      <i className="fas fa-times"></i>
                    </button>
                  )}
                  {flash && <div className="capture-flash" aria-hidden="true" />}
                  <video ref={videoRef} autoPlay playsInline muted className="camera-preview" />
                  <canvas ref={canvasRef} style={{ display: 'none' }} />
                  <button className="btn-capture btn-capture-large" onClick={capturePhoto} disabled={loading}
                    type="button" aria-label="Tomar foto">
                    {loading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-camera"></i>}
                  </button>
                </div>
              ) : (
                <div className="capture-options capture-options-horizontal">
                  <button className="capture-btn capture-btn-large" onClick={startCamera} type="button">
                    <i className="fas fa-camera"></i>
                    <span>Usar cámara</span>
                  </button>
                  <label className="capture-btn capture-btn-large">
                    <i className="fas fa-image"></i>
                    <span>Subir imagenes</span>
                    <input type="file" accept="image/*" multiple onChange={handleFileUpload} style={{ display: 'none' }} />
                  </label>
                  <button className="capture-btn capture-btn-large skip" onClick={() => setStep('form')} type="button">
                    <i className="fas fa-keyboard"></i>
                    <span>Sin imagen</span>
                  </button>
                </div>
              )}
              {loading && <div className="ai-loading"><i className="fas fa-brain fa-pulse"></i> Procesando con IA...</div>}
            </div>
          )}

          {step === 'processing' && (
            <div className="ai-processing-screen">
              <i className="fas fa-brain fa-pulse"></i>
              <p>Analizando imagen con IA...</p>
              <div className="ai-processing-bar" />
            </div>
          )}

          {step === 'preview' && capturedPreview && (
            <div className="capture-preview-step">
              <p className="capture-instructions">Revisa la foto</p>
              <div className="capture-preview-image">
                <img src={capturedPreview} alt="Vista previa" />
              </div>
              <div className="capture-preview-actions">
                <button className="btn-cancel" onClick={retakePhoto} type="button">
                  <i className="fas fa-redo"></i> Repetir
                </button>
                <button className="btn-save" onClick={confirmPhoto} disabled={loading} type="button">
                  {loading ? <><i className="fas fa-spinner fa-spin"></i> Procesando...</> : <><i className="fas fa-check"></i> Aceptar</>}
                </button>
              </div>
            </div>
          )}

          {step === 'form' && (
            <div className="edit-form">
              <div className="form-essentials">
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
              </div>

              <div className="form-advanced-accordion">
                <button type="button" className="form-advanced-toggle" onClick={() => setAdvancedOpen(!advancedOpen)}
                  aria-expanded={advancedOpen}>
                  <i className={`fas fa-chevron-${advancedOpen ? 'up' : 'down'}`}></i> Más opciones
                </button>
                {advancedOpen && (
                  <div className="form-advanced-content">
                    <div className="form-row">
                      <div className="form-group">
                        <label><i className="fas fa-flag"></i> Prioridad</label>
                        <select value={form.prioridad} onChange={e => setForm({ ...form, prioridad: e.target.value })}>
                          <option value="alta">Alta</option>
                          <option value="media">Media</option>
                          <option value="baja">Baja</option>
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
                  </div>
                )}
              </div>
              {form.imagen_url && (
                <div className="preview-image">
                  <img src={form.imagen_url} alt="Preview" />
                  <button className="btn-del-sm" onClick={() => setForm({ ...form, imagen_url: '' })}><i className="fas fa-times"></i></button>
                </div>
              )}
              {photoPreviews.length > 0 && (
                <div className="photo-grid">
                  {photoPreviews.map((src, idx) => (
                    <div key={`${src}-${idx}`} className="preview-image">
                      <img src={src} alt={`Foto ${idx + 1}`} />
                    </div>
                  ))}
                  <small>{photoPreviews.length}/10 fotos</small>
                </div>
              )}
              {uploadState !== 'idle' && <small>Estado fotos: {uploadState}</small>}
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
