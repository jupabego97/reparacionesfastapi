import { useQuery } from '@tanstack/react-query'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { api, API_BASE, type Tarjeta } from './api/client'
import { useDebounce } from './hooks/useDebounce'
import { filtrarTarjetas, type Filtros } from './utils/filtrarTarjetas'
import { KanbanBoard } from './components/KanbanBoard'
import { BusquedaFiltros } from './components/BusquedaFiltros'
import { ConexionBadge } from './components/ConexionBadge'
import { Toast } from './components/Toast'

const NuevaTarjetaModal = lazy(() => import('./components/NuevaTarjetaModal').then(m => ({ default: m.NuevaTarjetaModal })))
const EstadisticasModal = lazy(() => import('./components/EstadisticasModal').then(m => ({ default: m.EstadisticasModal })))
const ExportarModal = lazy(() => import('./components/ExportarModal').then(m => ({ default: m.ExportarModal })))

const COLUMNAS = ['ingresado', 'diagnosticada', 'para_entregar', 'listos'] as const

const FILTROS_VACIOS = {
  estado: '',
  fechaDesde: '',
  fechaHasta: '',
  cargador: '',
  diagnostico: '',
}

function App() {
  const [tarjetas, setTarjetas] = useState<Tarjeta[]>([])
  const [filtros, setFiltros] = useState<Omit<Filtros, 'busqueda'>>(FILTROS_VACIOS)
  const [busquedaInput, setBusquedaInput] = useState('')
  const debouncedBusqueda = useDebounce(busquedaInput, 300)
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'warning' | 'info' } | null>(null)
  const [showNueva, setShowNueva] = useState(false)
  const [showEstadisticas, setShowEstadisticas] = useState(false)
  const [showExportar, setShowExportar] = useState(false)
  const [conectado, setConectado] = useState<boolean | null>(null)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('theme') as 'light' | 'dark') || 'light')

  const filtrosCompletos = useMemo(() => ({ ...filtros, busqueda: debouncedBusqueda }), [filtros, debouncedBusqueda])
  const tarjetasFiltradas = useMemo(() => filtrarTarjetas(tarjetas, filtrosCompletos), [tarjetas, filtrosCompletos])

  // Cargar tarjetas sin imágenes (rápido), luego completo en segundo plano
  const { data, refetch, isLoading, isError, error } = useQuery({
    queryKey: ['tarjetas'],
    queryFn: async () => {
      const res = await api.getTarjetas({ light: 1 })
      const list = Array.isArray(res) ? res : (res as { tarjetas: Tarjeta[] }).tarjetas
      return list ?? []
    },
  })

  useEffect(() => {
    if (data) {
      setTarjetas(data)
      // Cargar imágenes en segundo plano después de pintar
      const id = requestIdleCallback?.(() => {
        api.getTarjetas().then(full => {
          const list = Array.isArray(full) ? full : (full as { tarjetas: Tarjeta[] }).tarjetas
          if (list?.length) setTarjetas(list)
        }).catch(() => {})
      }) ?? setTimeout(() => {
        api.getTarjetas().then(full => {
          const list = Array.isArray(full) ? full : (full as { tarjetas: Tarjeta[] }).tarjetas
          if (list?.length) setTarjetas(list)
        }).catch(() => {})
      }, 1500)
      return () => { typeof id === 'number' && (cancelIdleCallback?.(id) ?? clearTimeout(id)) }
    }
  }, [data])

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  // Socket diferido: conectar después de que los datos iniciales carguen
  const socketRef = useRef<Socket | null>(null)
  useEffect(() => {
    if (isLoading || !data) return
    const transports = localStorage.getItem('socketio_safe_mode') !== '0' ? ['polling'] : ['websocket', 'polling']
    const socket = io(API_BASE || undefined, {
      path: '/socket.io',
      transports: transports as ('polling' | 'websocket')[],
      upgrade: transports.length > 1,
    })
    socketRef.current = socket
    socket.on('connect', () => {
      setConectado(true)
      socket.emit('join')
    })
    socket.on('disconnect', () => setConectado(false))
    socket.on('tarjeta_creada', (t: Tarjeta) => {
      setTarjetas((prev) => {
        if (prev.some((x) => x.id === t.id)) return prev
        queueMicrotask(() => setToast({ msg: `Nueva reparación: ${t.nombre_propietario}`, type: 'success' }))
        return [t, ...prev]
      })
    })
    socket.on('tarjeta_actualizada', (t: Tarjeta) => {
      setTarjetas((prev) => {
        const i = prev.findIndex((x) => x.id === t.id)
        if (i === -1) return [t, ...prev]
        const next = [...prev]
        next[i] = t
        return next
      })
      setToast({ msg: `Actualizada: ${t.nombre_propietario}`, type: 'info' })
    })
    socket.on('tarjeta_eliminada', (p: { id: number }) => {
      setTarjetas((prev) => prev.filter((x) => x.id !== p.id))
    })
    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [isLoading, !!data]) // eslint-disable-line react-hooks/exhaustive-deps

  const notificar = (msg: string, type: 'success' | 'warning' | 'info') => setToast({ msg, type })

  const handleFiltrosChange = (f: Filtros) => setFiltros({ estado: f.estado, fechaDesde: f.fechaDesde, fechaHasta: f.fechaHasta, cargador: f.cargador, diagnostico: f.diagnostico })

  return (
    <div className="min-vh-100 bg-light" data-theme={theme}>
      <header className="app-header bg-white shadow-sm py-3 border-bottom">
        <div className="container-fluid">
          <div className="row align-items-center">
            <div className="col-12 col-md-6">
              <div className="d-flex align-items-center gap-3">
                <img src="/nano-logo.svg" alt="Nanotronics" style={{ height: 36 }} className="d-none d-md-block" />
                <span className="h5 mb-0 text-primary fw-bold d-md-none">Nanotronics</span>
                <span className="text-muted small d-none d-md-inline">Sistema de Reparaciones</span>
                <ConexionBadge conectado={conectado} />
              </div>
            </div>
            <div className="col-12 col-md-6 mt-2 mt-md-0">
              <div className="d-flex justify-content-end flex-wrap gap-2">
                <button type="button" className="btn btn-outline-primary" onClick={() => setShowEstadisticas(true)} title="Estadísticas">
                  <i className="fas fa-chart-bar" /> <span className="d-none d-lg-inline ms-2">Estadísticas</span>
                </button>
                <button type="button" className="btn btn-outline-success" onClick={() => setShowExportar(true)} title="Exportar">
                  <i className="fas fa-download" /> <span className="d-none d-lg-inline ms-2">Exportar</span>
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
                  title="Cambiar tema"
                >
                  <i className={`fas fa-${theme === 'dark' ? 'sun' : 'moon'}`} />
                </button>
                <button type="button" className="btn btn-primary" onClick={() => setShowNueva(true)}>
                  <i className="fas fa-plus-circle" /> <span className="ms-2 d-none d-sm-inline">Nueva Reparación</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="container-fluid">
        <BusquedaFiltros
          filtros={{ ...filtros, busqueda: busquedaInput }}
          onChange={handleFiltrosChange}
          onBusquedaChange={setBusquedaInput}
          totalResultados={tarjetasFiltradas.length}
        />

        <main className="pb-4">
          {isError && !tarjetas.length ? (
            <div className="alert alert-danger mx-3">
              <strong>Error al cargar tarjetas:</strong> {(error as Error)?.message}
              {!API_BASE && (
                <div className="mt-2 small">
                  <strong>Sugerencia:</strong> En producción, asegúrate de que el frontend tenga configurada la variable{' '}
                  <code>VITE_API_URL</code> con la URL del backend (ej: https://reparacionesfastapi-production.up.railway.app)
                </div>
              )}
              <button className="btn btn-sm btn-outline-danger mt-2" onClick={() => refetch()}>Reintentar</button>
            </div>
          ) : isLoading && !tarjetas.length ? (
            <div className="row kanban-scroll-row">
              {COLUMNAS.map(col => (
                <div key={col} className="col-md-3 col-12 mb-3">
                  <div className="card h-100">
                    <div className="card-header"><div className="placeholder-glow"><span className="placeholder col-6"></span></div></div>
                    <div className="card-body">
                      {[1, 2].map(i => (
                        <div key={i} className="card mb-2 border-start border-4">
                          <div className="card-body py-2 px-3 placeholder-glow">
                            <span className="placeholder col-8 mb-1"></span>
                            <span className="placeholder col-5"></span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <KanbanBoard
              tarjetas={tarjetasFiltradas}
              columnas={COLUMNAS}
              onNotificar={notificar}
            />
          )}
        </main>
      </div>

      <Suspense fallback={null}>
        {showNueva && (
          <NuevaTarjetaModal
            show={showNueva}
            onClose={() => setShowNueva(false)}
            onCreada={() => {
              refetch()
              setShowNueva(false)
              notificar('Reparación creada', 'success')
            }}
          />
        )}
        {showEstadisticas && <EstadisticasModal show={showEstadisticas} onClose={() => setShowEstadisticas(false)} />}
        {showExportar && <ExportarModal show={showExportar} onClose={() => setShowExportar(false)} />}
      </Suspense>
      {toast && <Toast message={toast.msg} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  )
}

export default App
