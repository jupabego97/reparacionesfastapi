import type { UserInfo, Tag } from '../api/client';

interface Filtros {
  search: string;
  estado: string;
  prioridad: string;
  asignado_a: string;
  cargador: string;
  tag: string;
}

interface Props {
  filtros: Filtros;
  onChange: (f: Filtros) => void;
  totalResults?: number;
  users: UserInfo[];
  tags: Tag[];
  columnas: { key: string; title: string }[];
}

export default function BusquedaFiltros({ filtros, onChange, totalResults, users, tags, columnas }: Props) {
  const set = (key: keyof Filtros, val: string) => onChange({ ...filtros, [key]: val });
  const hasFilters = filtros.search || filtros.estado || filtros.prioridad || filtros.asignado_a || filtros.cargador || filtros.tag;

  return (
    <div className="filtros-bar">
      <div className="filtros-row">
        <div className="search-box">
          <i className="fas fa-search"></i>
          <input
            type="text"
            value={filtros.search}
            onChange={e => set('search', e.target.value)}
            placeholder="Buscar por nombre, problema o WhatsApp..."
            aria-label="Buscar tarjetas"
          />
          {filtros.search && (
            <button className="clear-search" onClick={() => set('search', '')} aria-label="Limpiar busqueda">
              <i className="fas fa-times"></i>
            </button>
          )}
        </div>

        <select className="filter-select" value={filtros.estado} onChange={e => set('estado', e.target.value)} aria-label="Filtrar por estado">
          <option value="">Todos los estados</option>
          {columnas.map(c => <option key={c.key} value={c.key}>{c.title}</option>)}
        </select>

        <select className="filter-select" value={filtros.prioridad} onChange={e => set('prioridad', e.target.value)} aria-label="Filtrar por prioridad">
          <option value="">Toda prioridad</option>
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="baja">Baja</option>
        </select>

        <select className="filter-select" value={filtros.asignado_a} onChange={e => set('asignado_a', e.target.value)} aria-label="Filtrar por tecnico">
          <option value="">Todos los tecnicos</option>
          {users.map(u => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>

        {tags.length > 0 && (
          <select className="filter-select" value={filtros.tag} onChange={e => set('tag', e.target.value)} aria-label="Filtrar por etiqueta">
            <option value="">Todas las etiquetas</option>
            {tags.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}

        <select className="filter-select" value={filtros.cargador} onChange={e => set('cargador', e.target.value)} aria-label="Filtrar por cargador">
          <option value="">Cargador</option>
          <option value="si">Con cargador</option>
          <option value="no">Sin cargador</option>
        </select>
      </div>

      {(hasFilters || totalResults !== undefined) && (
        <div className="filtros-info">
          {totalResults !== undefined && <span className="results-count">{totalResults} resultados</span>}
          {hasFilters && (
            <button className="clear-all-btn" onClick={() => onChange({ search: '', estado: '', prioridad: '', asignado_a: '', cargador: '', tag: '' })}>
              <i className="fas fa-times-circle"></i> Limpiar filtros
            </button>
          )}
        </div>
      )}
    </div>
  );
}
