import type { Tarjeta } from '../api/client'

export interface Filtros {
  busqueda: string
  estado: string
  fechaDesde: string
  fechaHasta: string
  cargador: string
  diagnostico: string
}

export function filtrarTarjetas(tarjetas: Tarjeta[], filtros: Filtros): Tarjeta[] {
  let resultado = [...tarjetas]

  const busqueda = (filtros.busqueda || '').toLowerCase().trim()
  if (busqueda) {
    resultado = resultado.filter((t) => {
      const texto = [
        t.nombre_propietario,
        t.problema,
        t.whatsapp,
        t.notas_tecnicas,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return texto.includes(busqueda)
    })
  }

  if (filtros.estado) {
    resultado = resultado.filter((t) => t.columna === filtros.estado)
  }

  if (filtros.fechaDesde) {
    const desde = new Date(filtros.fechaDesde)
    resultado = resultado.filter((t) => {
      const fl = t.fecha_limite ? new Date(t.fecha_limite) : null
      return fl && fl >= desde
    })
  }

  if (filtros.fechaHasta) {
    const hasta = new Date(filtros.fechaHasta)
    hasta.setHours(23, 59, 59, 999)
    resultado = resultado.filter((t) => {
      const fl = t.fecha_limite ? new Date(t.fecha_limite) : null
      return fl && fl <= hasta
    })
  }

  if (filtros.cargador) {
    resultado = resultado.filter((t) => t.tiene_cargador === filtros.cargador)
  }

  if (filtros.diagnostico) {
    resultado = resultado.filter((t) => {
      const tieneNotas = !!(t.notas_tecnicas && t.notas_tecnicas.trim())
      return filtros.diagnostico === 'con' ? tieneNotas : !tieneNotas
    })
  }

  return resultado
}
