interface Props {
  conectado: boolean | null
}

export function ConexionBadge({ conectado }: Props) {
  if (conectado === null) return <span className="badge bg-secondary">Conectando...</span>
  return (
    <span
      className={`badge ${conectado ? 'bg-success' : 'bg-secondary'}`}
      title={conectado ? 'Sincronización activa' : 'Sin conexión'}
    >
      ● {conectado ? 'Conectado' : 'Sin conexión'}
    </span>
  )
}
