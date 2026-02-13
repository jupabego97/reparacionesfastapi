import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'

interface Props {
  show: boolean
  onClose: () => void
  onCreada: () => void
}

export function NuevaTarjetaModal({ show, onClose, onCreada }: Props) {
  const [paso, setPaso] = useState(1)
  const [nombre, setNombre] = useState('Cliente')
  const [problema, setProblema] = useState('Sin descripción')
  const [whatsapp, setWhatsapp] = useState('')
  const [fechaLimite, setFechaLimite] = useState('')
  const [imagenUrl, setImagenUrl] = useState('')
  const [tieneCargador, setTieneCargador] = useState('si')
  const [analizando, setAnalizando] = useState(false)
  const [capturaLista, setCapturaLista] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const queryClient = useQueryClient()

  const analizarMut = useMutation({
    mutationFn: (imageData: string) => api.procesarImagen(imageData),
    onSuccess: (res: { nombre: string; telefono: string; tiene_cargador: boolean }) => {
      setNombre(res.nombre || 'Cliente')
      setWhatsapp(res.telefono || '')
      setTieneCargador(res.tiene_cargador ? 'si' : 'no')
      setAnalizando(false)
      setPaso(2)
    },
    onError: () => setAnalizando(false),
  })

  const procesarImagen = (base64: string) => {
    setAnalizando(true)
    setImagenUrl(base64)
    analizarMut.mutate(base64)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !file.type.startsWith('image/')) return
    const r = new FileReader()
    r.onload = () => procesarImagen(r.result as string)
    r.readAsDataURL(file)
    e.target.value = ''
  }

  const [camaraError, setCamaraError] = useState<string | null>(null)

  const iniciarCamara = async () => {
    setCamaraError(null)
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      streamRef.current = s
      if (videoRef.current) {
        videoRef.current.srcObject = s
        videoRef.current.style.display = 'block'
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'No se pudo acceder a la cámara'
      setCamaraError(msg)
      console.error('Error cámara:', err)
    }
  }

  const tomarFoto = () => {
    if (!videoRef.current || !canvasRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    if (!ctx) return
    canvasRef.current.width = videoRef.current.videoWidth
    canvasRef.current.height = videoRef.current.videoHeight
    ctx.drawImage(videoRef.current, 0, 0)
    const dataUrl = canvasRef.current.toDataURL('image/jpeg')
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    videoRef.current.style.display = 'none'
    setCapturaLista(true)
    procesarImagen(dataUrl)
  }

  const reintentar = () => {
    setCapturaLista(false)
    setAnalizando(false)
    iniciarCamara()
  }

  const resetear = () => {
    setPaso(1)
    setCapturaLista(false)
    setAnalizando(false)
    setNombre('Cliente')
    setProblema('Sin descripción')
    setWhatsapp('')
    setImagenUrl('')
    setTieneCargador('si')
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  useEffect(() => {
    if (!show) return
    resetear()
    iniciarCamara()
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [show])

  const createMut = useMutation({
    mutationFn: (data: object) => api.createTarjeta(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarjetas'] })
      onCreada()
    },
  })

  if (!show) return null

  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const defaultFecha = tomorrow.toISOString().slice(0, 10)

  const handleSubmit = () => {
    createMut.mutate({
      nombre_propietario: nombre || 'Cliente',
      problema: problema || 'Sin descripción',
      whatsapp: whatsapp,
      fecha_limite: fechaLimite || defaultFecha,
      imagen_url: imagenUrl || undefined,
      tiene_cargador: tieneCargador,
    })
  }

  return (
    <div className="modal show d-block" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <div className="modal-dialog modal-lg">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Nueva Reparación con IA</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            <div className="mb-3">
              <div className="progress mb-2">
                <div className="progress-bar" style={{ width: paso === 1 ? '50%' : '100%' }} />
              </div>
              <div className="d-flex justify-content-between small text-muted">
                <span>📷 Foto</span>
                <span>🤖 Procesar & Crear</span>
              </div>
            </div>

            {paso === 1 && (
              <div>
                <h6 className="mb-3">Paso 1: Toma una foto del recibo o ticket</h6>
                {camaraError && (
                  <div className="alert alert-warning mb-3">
                    <i className="fas fa-exclamation-triangle me-2" />
                    La cámara no está disponible. Usa <strong>Seleccionar archivo</strong> para subir una foto desde tu dispositivo.
                  </div>
                )}
                <div className="position-relative bg-dark rounded overflow-hidden mb-3" style={{ minHeight: 250 }}>
                  <video ref={videoRef} autoPlay playsInline muted className="w-100" style={{ maxHeight: 300, display: capturaLista || camaraError ? 'none' : 'block' }} />
                  <canvas ref={canvasRef} className="d-none" />
                  {imagenUrl && capturaLista && (
                    <img src={imagenUrl} alt="Preview" className="w-100" style={{ maxHeight: 300, objectFit: 'contain' }} />
                  )}
                  {camaraError && !capturaLista && (
                    <div className="position-absolute top-50 start-50 translate-middle text-center text-white">
                      <i className="fas fa-camera-slash fa-3x mb-2 opacity-50" />
                      <p className="mb-0">Selecciona una imagen de tu dispositivo</p>
                    </div>
                  )}
                  <div className="position-absolute bottom-0 start-50 translate-middle-x mb-2 d-flex gap-2 flex-wrap justify-content-center">
                    {!capturaLista && (
                      <>
                        {!camaraError && (
                          <button type="button" className="btn btn-success" onClick={tomarFoto} disabled={analizando}>
                            <i className="fas fa-camera" /> Tomar Foto
                          </button>
                        )}
                        <input type="file" ref={fileInputRef} accept="image/*" className="d-none" onChange={handleFileChange} />
                        <button type="button" className="btn btn-primary" onClick={() => fileInputRef.current?.click()} disabled={analizando}>
                          <i className="fas fa-folder-open" /> {camaraError ? 'Seleccionar archivo' : 'Archivo'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                {(analizando || analizarMut.isPending) && (
                  <div className="text-center py-3">
                    <div className="spinner-border text-primary" />
                    <p className="mt-2 mb-0">Analizando imagen con IA...</p>
                  </div>
                )}
                {capturaLista && !analizando && !analizarMut.isPending && (
                  <button type="button" className="btn btn-warning" onClick={reintentar}>
                    <i className="fas fa-redo" /> Reintentar foto
                  </button>
                )}
              </div>
            )}

            {paso === 2 && (
              <div>
                <h6 className="mb-3">Paso 2: Completa la información</h6>
                <div className="mb-2">
                  <label className="form-label">Cliente</label>
                  <input className="form-control" value={nombre} onChange={(e) => setNombre(e.target.value)} />
                </div>
                <div className="mb-2">
                  <label className="form-label">Problema</label>
                  <textarea className="form-control" rows={2} value={problema} onChange={(e) => setProblema(e.target.value)} />
                </div>
                <div className="mb-2">
                  <label className="form-label">WhatsApp (opcional)</label>
                  <input className="form-control" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} />
                </div>
                <div className="mb-2">
                  <label className="form-label">Fecha límite</label>
                  <input type="date" className="form-control" value={fechaLimite || defaultFecha} onChange={(e) => setFechaLimite(e.target.value)} />
                </div>
                <div className="mb-2">
                  <label className="form-label">Tiene cargador</label>
                  <select className="form-select" value={tieneCargador} onChange={(e) => setTieneCargador(e.target.value)}>
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <button type="button" className="btn btn-outline-secondary mb-2" onClick={() => setPaso(1)}>
                  Volver al paso 1
                </button>
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
            {paso === 2 ? (
              <button className="btn btn-primary" onClick={handleSubmit} disabled={createMut.isPending}>
                {createMut.isPending ? 'Creando...' : 'Crear'}
              </button>
            ) : (
              <button className="btn btn-primary" disabled={!imagenUrl || analizarMut.isPending} onClick={() => setPaso(2)}>
                {analizarMut.isPending ? 'Analizando...' : 'Continuar'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
