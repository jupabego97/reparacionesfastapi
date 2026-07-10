import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tag, UserInfo, TarjetaCreate } from '../api/client';

interface Props {
  onClose: () => void;
  onSuccess?: () => void;
}

const JPEG_QUALITY = 0.75;
const MAX_IMAGE_PX = 800;
const AI_TIMEOUT_MS = 15_000;

type CaptureStep = 'capture' | 'preview' | 'processing' | 'form';
type AiPhase = 'idle' | 'optimizing' | 'analyzing' | 'done' | 'failed';

function resizeImageDataUrl(dataUrl: string, maxPx = MAX_IMAGE_PX, quality = JPEG_QUALITY): Promise<string> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d')!.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
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

function stopStream(video: HTMLVideoElement | null) {
  if (video?.srcObject) {
    (video.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
}

export default function NuevaTarjetaModal({ onClose, onSuccess }: Props) {
  const [step, setStep] = useState<CaptureStep>('capture');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(false);
  const [capturedPreview, setCapturedPreview] = useState<string | null>(null);
  const [aiPhase, setAiPhase] = useState<AiPhase>('idle');
  const [aiElapsedSec, setAiElapsedSec] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const closedRef = useRef(false);
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
  const [successMsg, setSuccessMsg] = useState('');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const { data: allTags = [] } = useQuery({ queryKey: ['tags'], queryFn: api.getTags });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: api.getUsers });

  const createMut = useMutation({
    mutationFn: (data: TarjetaCreate) => api.createTarjeta(data),
    onError: (e: unknown) => setError(e instanceof Error ? e.message : 'Error al crear'),
  });

  const handleClose = useCallback(() => {
    closedRef.current = true;
    abortRef.current?.abort();
    abortRef.current = null;
    stopStream(videoRef.current);
    onClose();
  }, [onClose]);

  useEffect(() => {
    closedRef.current = false;
    return () => {
      closedRef.current = true;
      abortRef.current?.abort();
      stopStream(videoRef.current);
    };
  }, []);

  useEffect(() => {
    if (step !== 'processing') {
      setAiElapsedSec(0);
      return;
    }
    const started = Date.now();
    const id = window.setInterval(() => {
      setAiElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 250);
    return () => window.clearInterval(id);
  }, [step]);

  const startCamera = useCallback(async () => {
    try {
      setError('');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      if (closedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setCameraActive(true);
      } else {
        stream.getTracks().forEach(t => t.stop());
      }
    } catch {
      setError('No se pudo acceder a la cámara');
      setCameraActive(false);
    }
  }, []);

  // En móvil: ir directo a la cámara al abrir
  useEffect(() => {
    if (isMobile && step === 'capture') {
      setCameraActive(true);
      void startCamera();
    }
  }, [isMobile, step, startCamera]);

  const capturePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const v = videoRef.current;
    const c = canvasRef.current;
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')?.drawImage(v, 0, 0);
    // Un solo encode JPEG (calidad final); el resize posterior solo escala si hace falta
    const dataUrl = c.toDataURL('image/jpeg', JPEG_QUALITY);
    setFlash(true);
    setTimeout(() => setFlash(false), 200);
    resizeImageDataUrl(dataUrl).then(resized => {
      if (closedRef.current) return;
      setCapturedPreview(resized);
      setStep('preview');
    });
    stopStream(videoRef.current);
    setCameraActive(false);
  };

  const processImage = async (imageData: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError('');
    setSuccessMsg('');
    setAiPhase('optimizing');
    setStep('processing');

    let resized = imageData;
    try {
      resized = await resizeImageDataUrl(imageData);
      if (controller.signal.aborted || closedRef.current) return;

      setAiPhase('analyzing');
      const result = await api.procesarImagen(resized, {
        signal: controller.signal,
        timeoutMs: AI_TIMEOUT_MS,
      });
      if (controller.signal.aborted || closedRef.current) return;

      setForm(prev => ({
        ...prev,
        nombre_propietario: result.nombre || prev.nombre_propietario,
        whatsapp: result.telefono || prev.whatsapp,
        tiene_cargador: result.tiene_cargador ? 'si' : 'no',
        imagen_url: resized,
      }));

      if (result._partial) {
        setAiPhase('failed');
        setError(result.error || 'IA no disponible. Completa los datos manualmente.');
      } else {
        setAiPhase('done');
        const parts: string[] = [];
        if (result.nombre && result.nombre !== 'Cliente') parts.push(`nombre: ${result.nombre}`);
        if (result.telefono) parts.push(`teléfono: ${result.telefono}`);
        parts.push(`cargador: ${result.tiene_cargador ? 'sí' : 'no'}`);
        setSuccessMsg(
          parts.length > 1
            ? `IA completó los datos (${parts.join(' · ')}). Revisa y ajusta si hace falta.`
            : 'IA analizó la imagen. Revisa los campos y completa lo que falte.',
        );
      }
    } catch (err) {
      if (controller.signal.aborted || closedRef.current) return;
      setForm(prev => ({ ...prev, imagen_url: resized }));
      setAiPhase('failed');
      setError(err instanceof Error ? err.message : 'No se pudo analizar la imagen. Completa los datos manualmente.');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      // Si el usuario omitió/cerró, no pisar el estado que ya fijó skip/close.
      if (!closedRef.current && !controller.signal.aborted) {
        setCapturedPreview(null);
        setStep('form');
        setLoading(false);
        stopStream(videoRef.current);
        setCameraActive(false);
      } else if (!closedRef.current && controller.signal.aborted) {
        // Abort por omitir: skipAiAndContinue ya dejó el form; solo limpiar loading/cámara.
        setLoading(false);
        stopStream(videoRef.current);
        setCameraActive(false);
      }
    }
  };

  const confirmPhoto = () => {
    if (capturedPreview) void processImage(capturedPreview);
  };

  const skipAiAndContinue = () => {
    const img = capturedPreview || form.imagen_url;
    abortRef.current?.abort();
    abortRef.current = null;
    if (img) setForm(prev => ({ ...prev, imagen_url: img }));
    setCapturedPreview(null);
    setAiPhase('failed');
    setSuccessMsg('');
    setError('Análisis omitido. Completa los datos manualmente.');
    setStep('form');
    setLoading(false);
  };

  const retakePhoto = () => {
    abortRef.current?.abort();
    setCapturedPreview(null);
    setAiPhase('idle');
    setSuccessMsg('');
    setError('');
    setCameraActive(true);
    setStep('capture');
    void startCamera();
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
      if (closedRef.current) return;
      setPhotoPreviews(previews.filter(Boolean));
      if (previews[0]) void processImage(previews[0]);
      else setStep('form');
    });
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.nombre_propietario.trim()) errs.nombre = 'El nombre es requerido';
    if (form.whatsapp && !/^\+?\d{7,15}$/.test(form.whatsapp.replace(/[\s-]/g, ''))) {
      errs.whatsapp = 'Formato: +57 300 123 4567';
    }
    if (!form.fecha_limite) errs.fecha = 'La fecha límite es requerida';
    setValidationErrors(errs);
    if (Object.keys(errs).length > 0) {
      setTimeout(() => {
        document.querySelector('.field-error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
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
      handleClose();
    } catch {
      setUploadState('idle');
    }
  };

  const aiStatusLabel =
    aiPhase === 'optimizing'
      ? 'Optimizando imagen…'
      : aiPhase === 'analyzing'
        ? 'Extrayendo nombre, teléfono y cargador…'
        : 'Analizando imagen con IA…';

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-pro" onClick={e => e.stopPropagation()}>
        <div className="modal-pro-header">
          <h3><i className="fas fa-plus-circle"></i> Nueva Reparación</h3>
          <button className="modal-close" onClick={handleClose} type="button" aria-label="Cerrar">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="modal-pro-body">
          {error && step !== 'processing' && (
            <div className="login-error"><i className="fas fa-exclamation-triangle"></i> {error}</div>
          )}
          {successMsg && step === 'form' && (
            <div className="login-success"><i className="fas fa-check-circle"></i> {successMsg}</div>
          )}

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
                    <button
                      type="button"
                      className="camera-back-btn"
                      onClick={() => { stopStream(videoRef.current); handleClose(); }}
                      aria-label="Cerrar cámara"
                    >
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
                  <button className="capture-btn capture-btn-large" onClick={() => void startCamera()} type="button">
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
            </div>
          )}

          {step === 'processing' && (
            <div className="ai-processing-screen" role="status" aria-live="polite">
              <i className="fas fa-brain fa-pulse"></i>
              <p>{aiStatusLabel}</p>
              <div className="ai-processing-bar" />
              <div className="ai-processing-meta">
                <span className={`ai-phase-chip ${aiPhase === 'optimizing' ? 'active' : aiPhase === 'analyzing' || aiPhase === 'done' ? 'done' : ''}`}>
                  1. Optimizar
                </span>
                <span className={`ai-phase-chip ${aiPhase === 'analyzing' ? 'active' : aiPhase === 'done' ? 'done' : ''}`}>
                  2. Analizar
                </span>
              </div>
              <small className="ai-processing-timer">{aiElapsedSec}s · máx. {Math.round(AI_TIMEOUT_MS / 1000)}s</small>
              <button type="button" className="btn-cancel ai-skip-btn" onClick={skipAiAndContinue}>
                Omitir IA y continuar
              </button>
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
                  <textarea rows={isMobile ? 2 : 3} value={form.problema} onChange={e => setForm({ ...form, problema: e.target.value })} placeholder="Describe el problema del equipo..." />
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
                  <button className="btn-del-sm" onClick={() => setForm({ ...form, imagen_url: '' })} type="button">
                    <i className="fas fa-times"></i>
                  </button>
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
            <button className="btn-cancel" onClick={() => setStep('capture')} type="button">
              <i className="fas fa-arrow-left"></i> Volver
            </button>
            <button className="btn-save" onClick={() => void handleSubmit()} disabled={createMut.isPending} type="button">
              {createMut.isPending ? <><i className="fas fa-spinner fa-spin"></i> Creando...</> : <><i className="fas fa-check"></i> Crear</>}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
