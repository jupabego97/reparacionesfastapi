import { useState } from 'react';
import type { UserInfo, Tag } from '../api/client';

interface Filtros {
  search: string;
  estado: string;
  prioridad: string;
  asignado_a: string;
  cargador: string;
  tag: string;
  orden_por: string;
  orden_dir: string;
}

interface Props {
  filtros: Filtros;
  onChange: (f: Filtros) => void;
  totalResults?: number;
  users: UserInfo[];
  tags: Tag[];
  columnas: { key: string; title: string }[];
}

const EMPTY_FILTROS: Filtros = { search: '', estado: '', prioridad: '', asignado_a: '', cargador: '', tag: '', orden_por: '', orden_dir: '' };

export default function BusquedaFiltros({ filtros, onChange, totalResults, users, tags, columnas }: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const set = (key: keyof Filtros, val: string) => onChange({ ...filtros, [key]: val });
  const hasFilters = filtros.search || filtros.estado || filtros.prioridad || filtros.asignado_a || filtros.cargador || filtros.tag || filtros.orden_por;
  const activeFilterCount = [filtros.estado, filtros.prioridad, filtros.asignado_a, filtros.cargador, filtros.tag, filtros.orden_por].filter(Boolean).length;

  const toggleOrdenDir = () => set('orden_dir', filtros.orden_dir === 'desc' ? 'asc' : 'desc');

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

        <button
          className="filters-toggle-btn"
          onClick={() => setFiltersOpen(o => !o)}
          aria-expanded={filtersOpen}
          aria-label={filtersOpen ? 'Ocultar filtros' : 'Mostrar filtros'}
        >
          <i className="fas fa-sliders-h"></i>
          {activeFilterCount > 0 && <span className="filter-badge">{activeFilterCount}</span>}
        </button>

        <div className={`filters-collapsible ${filtersOpen ? 'open' : ''}`}>
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

          <div className="cargador-toggle" aria-label="Filtrar por cargador">
            <button
              className={`cargador-btn ${filtros.cargador === 'si' ? 'active' : ''}`}
              onClick={() => set('cargador', filtros.cargador === 'si' ? '' : 'si')}
              title="Con cargador"
              type="button"
            >
              <i className="fas fa-plug"></i>
            </button>
            <button
              className={`cargador-btn cargador-btn-no ${filtros.cargador === 'no' ? 'active' : ''}`}
              onClick={() => set('cargador', filtros.cargador === 'no' ? '' : 'no')}
              title="Sin cargador"
              type="button"
            >
              <i className="fas fa-plug"></i><i className="fas fa-slash cargador-slash"></i>
            </button>
          </div>

          <div className="orden-group">
            <select
              className="filter-select"
              value={filtros.orden_por}
              onChange={e => set('orden_por', e.target.value)}
              aria-label="Ordenar por"
            >
              <option value="">Posicion</option>
              <option value="fecha_ingreso">Ingreso</option>
              <option value="prioridad">Prioridad</option>
              <option value="nombre_cliente">Cliente</option>
              <option value="fecha_limite">Limite</option>
            </select>
            {filtros.orden_por && (
              <button
                className="orden-dir-btn"
                onClick={toggleOrdenDir}
                title={filtros.orden_dir === 'desc' ? 'Descendente' : 'Ascendente'}
                aria-label="Cambiar direccion de orden"
              >
                <i className={`fas fa-sort-amount-${filtros.orden_dir === 'desc' ? 'down' : 'up'}`}></i>
              </button>
            )}
          </div>
        </div>
      </div>

      {(hasFilters || totalResults !== undefined) && (
        <div className="filtros-info">
          {totalResults !== undefined && <span className="results-count">{totalResults} resultados</span>}
          {hasFilters && (
            <button className="clear-all-btn" onClick={() => onChange(EMPTY_FILTROS)}>
              <i className="fas fa-times-circle"></i> Limpiar filtros
            </button>
          )}
        </div>
      )}
    </div>
  );
}
