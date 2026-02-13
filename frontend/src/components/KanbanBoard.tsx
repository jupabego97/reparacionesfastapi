import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api, type Tarjeta } from '../api/client'
import { TarjetaCard } from './TarjetaCard'
import { EditarTarjetaModal } from './EditarTarjetaModal'
import { ConfirmModal } from './ConfirmModal'

interface Props {
  tarjetas: Tarjeta[]
  columnas: readonly string[]
  onRefetch?: () => void
  onNotificar: (msg: string, type: 'success' | 'warning' | 'info') => void
}

const TITULOS: Record<string, string> = {
  ingresado: 'Ingresado',
  diagnosticada: 'En Diagnóstico',
  para_entregar: 'Listos para Entregar',
  listos: 'Completados',
}

export function KanbanBoard({ tarjetas, columnas, onNotificar }: Props) {
  const [editarTarjeta, setEditarTarjeta] = useState<Tarjeta | null>(null)
  const [eliminarTarjeta, setEliminarTarjeta] = useState<Tarjeta | null>(null)
  const queryClient = useQueryClient()

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: object }) => api.updateTarjeta(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarjetas'] })
      setEditarTarjeta(null)
      onNotificar('Tarjeta actualizada', 'success')
    },
    onError: (e: Error) => onNotificar(String(e), 'warning'),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteTarjeta(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tarjetas'] })
      setEliminarTarjeta(null)
      onNotificar('Tarjeta eliminada', 'success')
    },
    onError: (e: Error) => onNotificar(String(e), 'warning'),
  })

  const handleMover = (t: Tarjeta, columna: string) => {
    if (t.columna === columna) return
    updateMut.mutate({ id: t.id, data: { columna } })
  }

  return (
    <>
      <div className="row kanban-scroll-row">
        {columnas.map(col => {
          const items = tarjetas.filter(t => t.columna === col)
          return (
            <div key={col} className="col-md-3 col-12 mb-3">
              <div className="card h-100">
                <div className="card-header d-flex justify-content-between align-items-center">
                  <h5 className="mb-0">{TITULOS[col] || col}</h5>
                  <span className="badge bg-primary">{items.length}</span>
                </div>
                <div className="card-body">
                  {items.map(t => (
                    <TarjetaCard
                      key={t.id}
                      tarjeta={t}
                      onEditar={setEditarTarjeta}
                      onMover={handleMover}
                      columnas={[...columnas]}
                      compacta={col === 'listos'}
                    />
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      {editarTarjeta && (
        <EditarTarjetaModal
          tarjeta={editarTarjeta}
          onClose={() => setEditarTarjeta(null)}
          onGuardar={(data) => updateMut.mutate({ id: editarTarjeta.id, data })}
          onEliminar={() => {
            setEditarTarjeta(null)
            setEliminarTarjeta(editarTarjeta)
          }}
        />
      )}
      {eliminarTarjeta && (
        <ConfirmModal
          titulo="Eliminar reparación"
          mensaje={`¿Eliminar la reparación de ${eliminarTarjeta.nombre_propietario}?`}
          onConfirm={() => deleteMut.mutate(eliminarTarjeta.id)}
          onCancel={() => setEliminarTarjeta(null)}
        />
      )}
    </>
  )
}
