import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { Tarjeta, SubTask, CommentItem, Tag, UserInfo } from '../api/client';
import ConfirmModal from './ConfirmModal';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

interface Props {
  tarjeta: Tarjeta;
  onClose: () => void;
}

const PRIORIDADES = [
  { value: 'alta', label: '🔴 Alta', color: '#ef4444' },
  { value: 'media', label: '🟡 Media', color: '#f59e0b' },
  { value: 'baja', label: '🟢 Baja', color: '#22c55e' },
];

export default function EditarTarjetaModal({ tarjeta, onClose }: Props) {
  const qc = useQueryClient();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const [tab, setTab] = useState<'info' | 'subtasks' | 'comments' | 'history' | 'costs'>('info');
  const [form, setForm] = useState({
    nombre_propietario: tarjeta.nombre_propietario || '',
    problema: tarjeta.problema || '',
    whatsapp: tarjeta.whatsapp || '',
    fecha_limite: tarjeta.fecha_limite || '',
    tiene_cargador: tarjeta.tiene_cargador || 'si',
    notas_tecnicas: tarjeta.notas_tecnicas || '',
    prioridad: tarjeta.prioridad || 'media',
    asignado_a: tarjeta.asignado_a ?? '',
    costo_estimado: tarjeta.costo_estimado ?? '',
    costo_final: tarjeta.costo_final ?? '',
    notas_costo: tarjeta.notas_costo || '',
  });
  const [selectedTags, setSelectedTags] = useState<number[]>(tarjeta.tags?.map(t => t.id) || []);
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  const [showDelete, setShowDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const { dialogRef, titleId, onKeyDown } = useDialogAccessibility({ onClose, initialFocusRef: closeBtnRef });

  // Queries
  const { data: allTags = [] } = useQuery({ queryKey: ['tags'], queryFn: api.getTags });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: api.getUsers });
  const { data: subtasks = [], refetch: refetchSubtasks } = useQuery({
    queryKey: ['subtasks', tarjeta.id], queryFn: () => api.getSubTasks(tarjeta.id),
  });
  const { data: comments = [], refetch: refetchComments } = useQuery({
    queryKey: ['comments', tarjeta.id], queryFn: () => api.getComments(tarjeta.id),
  });
  const { data: historial = [] } = useQuery({
    queryKey: ['historial', tarjeta.id], queryFn: () => api.getHistorial(tarjeta.id),
  });

  // Mutations
  const updateMut = useMutation({
    mutationFn: (data: any) => api.updateTarjeta(tarjeta.id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tarjetas'] }); onClose(); },
  });
  const deleteMut = useMutation({
    mutationFn: () => api.deleteTarjeta(tarjeta.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['tarjetas'] }); onClose(); },
  });
  const addSubtaskMut = useMutation({
    mutationFn: (title: string) => api.createSubTask(tarjeta.id, title),
    onSuccess: () => { refetchSubtasks(); setNewSubtask(''); },
  });
  const toggleSubtaskMut = useMutation({
    mutationFn: (s: SubTask) => api.updateSubTask(s.id, { completed: !s.completed }),
    onSuccess: () => refetchSubtasks(),
  });
  const delSubtaskMut = useMutation({
    mutationFn: (id: number) => api.deleteSubTask(id),
    onSuccess: () => refetchSubtasks(),
  });
  const addCommentMut = useMutation({
    mutationFn: (content: string) => api.createComment(tarjeta.id, content),
    onSuccess: () => { refetchComments(); setNewComment(''); },
  });
  const delCommentMut = useMutation({
    mutationFn: (id: number) => api.deleteComment(id),
    onSuccess: () => refetchComments(),
  });

  const handleSave = async () => {
    setSaving(true);
    await updateMut.mutateAsync({
      nombre_propietario: form.nombre_propietario,
      problema: form.problema,
      whatsapp: form.whatsapp,
      fecha_limite: form.fecha_limite,
      tiene_cargador: form.tiene_cargador,
      notas_tecnicas: form.notas_tecnicas,
      prioridad: form.prioridad,
      asignado_a: form.asignado_a ? Number(form.asignado_a) : null,
      costo_estimado: form.costo_estimado ? Number(form.costo_estimado) : null,
      costo_final: form.costo_final ? Number(form.costo_final) : null,
      notas_costo: form.notas_costo || null,
      tags: selectedTags,
    });
    setSaving(false);
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose}>
        <div
          className="modal-pro modal-lg"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          ref={dialogRef}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onClick={e => e.stopPropagation()}
        >
          <div className="modal-pro-header">
            <h3 id={titleId}><i className="fas fa-pen-fancy"></i> Editar Reparación #{tarjeta.id}</h3>
            <button ref={closeBtnRef} className="modal-close" onClick={onClose} aria-label="Cerrar modal de edición"><i className="fas fa-times"></i></button>
          </div>

          {/* Tabs */}
          <div className="modal-tabs">
            {[
              { key: 'info', icon: 'fas fa-info-circle', label: 'Información' },
              { key: 'subtasks', icon: 'fas fa-tasks', label: `Tareas (${subtasks.length})` },
              { key: 'comments', icon: 'fas fa-comments', label: `Comentarios (${comments.length})` },
              { key: 'history', icon: 'fas fa-history', label: 'Historial' },
              { key: 'costs', icon: 'fas fa-dollar-sign', label: 'Costos' },
            ].map(t => (
              <button key={t.key} className={`modal-tab ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key as any)}>
                <i className={t.icon}></i> <span>{t.label}</span>
              </button>
            ))}
          </div>

          <div className="modal-pro-body">
            {/* Info Tab */}
            {tab === 'info' && (
              <div className="edit-form">
                <div className="form-row">
                  <div className="form-group">
                    <label><i className="fas fa-user"></i> Propietario</label>
                    <input value={form.nombre_propietario} onChange={e => setForm({ ...form, nombre_propietario: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label><i className="fab fa-whatsapp"></i> WhatsApp</label>
                    <input value={form.whatsapp} onChange={e => setForm({ ...form, whatsapp: e.target.value })} placeholder="+57 300 123 4567" />
                  </div>
                </div>
                <div className="form-group">
                  <label><i className="fas fa-exclamation-circle"></i> Problema</label>
                  <textarea rows={3} value={form.problema} onChange={e => setForm({ ...form, problema: e.target.value })} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label><i className="fas fa-calendar"></i> Fecha límite</label>
                    <input type="date" value={form.fecha_limite} onChange={e => setForm({ ...form, fecha_limite: e.target.value })} />
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
                      {PRIORIDADES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label><i className="fas fa-user-cog"></i> Asignado a</label>
                    <select value={form.asignado_a} onChange={e => setForm({ ...form, asignado_a: e.target.value as any })}>
                      <option value="">Sin asignar</option>
                      {users.map((u: UserInfo) => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label><i className="fas fa-wrench"></i> Notas técnicas</label>
                  <textarea rows={2} value={form.notas_tecnicas} onChange={e => setForm({ ...form, notas_tecnicas: e.target.value })} />
                </div>
                {/* Tags */}
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
                        onClick={() => setSelectedTags(prev => prev.includes(tag.id) ? prev.filter(i => i !== tag.id) : [...prev, tag.id])}>
                        {tag.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* SubTasks Tab */}
            {tab === 'subtasks' && (
              <div className="subtasks-tab">
                <div className="add-subtask">
                  <input value={newSubtask} onChange={e => setNewSubtask(e.target.value)} placeholder="Nueva tarea..."
                    onKeyDown={e => { if (e.key === 'Enter' && newSubtask.trim()) addSubtaskMut.mutate(newSubtask.trim()); }} />
                  <button onClick={() => newSubtask.trim() && addSubtaskMut.mutate(newSubtask.trim())} disabled={!newSubtask.trim()} aria-label="Agregar subtarea">
                    <i className="fas fa-plus"></i>
                  </button>
                </div>
                {subtasks.length > 0 && (
                  <div className="subtasks-progress-bar">
                    <div className="progress-fill" style={{
                      width: `${(subtasks.filter((s: SubTask) => s.completed).length / subtasks.length) * 100}%`
                    }}></div>
                    <span>{subtasks.filter((s: SubTask) => s.completed).length}/{subtasks.length} completadas</span>
                  </div>
                )}
                <ul className="subtask-list">
                  {subtasks.map((s: SubTask) => (
                    <li key={s.id} className={`subtask-item ${s.completed ? 'done' : ''}`}>
                      <input type="checkbox" checked={s.completed} onChange={() => toggleSubtaskMut.mutate(s)} />
                      <span className={s.completed ? 'line-through' : ''}>{s.title}</span>
                      <button className="btn-del-sm" onClick={() => delSubtaskMut.mutate(s.id)} aria-label="Eliminar subtarea"><i className="fas fa-trash"></i></button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Comments Tab */}
            {tab === 'comments' && (
              <div className="comments-tab">
                <div className="add-comment">
                  <textarea rows={2} value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Escribe un comentario..." />
                  <button onClick={() => newComment.trim() && addCommentMut.mutate(newComment.trim())} disabled={!newComment.trim()}>
                    <i className="fas fa-paper-plane"></i> Enviar
                  </button>
                </div>
                <div className="comment-list">
                  {comments.map((c: CommentItem) => (
                    <div key={c.id} className="comment-item">
                      <div className="comment-header">
                        <span className="comment-author"><i className="fas fa-user-circle"></i> {c.author_name}</span>
                        <span className="comment-date">{c.created_at?.slice(0, 16).replace('T', ' ')}</span>
                        <button className="btn-del-sm" onClick={() => delCommentMut.mutate(c.id)} aria-label="Eliminar comentario"><i className="fas fa-trash"></i></button>
                      </div>
                      <p className="comment-body">{c.content}</p>
                    </div>
                  ))}
                  {comments.length === 0 && <p className="empty-msg"><i className="fas fa-comment-slash"></i> Sin comentarios aún</p>}
                </div>
              </div>
            )}

            {/* History Tab (Mejora #17: Timeline visual) */}
            {tab === 'history' && (
              <div className="history-tab">
                <div className="timeline">
                  {historial.map((h: any, i: number) => (
                    <div key={h.id || i} className="timeline-item">
                      <div className="timeline-dot"></div>
                      <div className="timeline-content">
                        <div className="timeline-row">
                          <span className="timeline-from">{h.old_status || '—'}</span>
                          <i className="fas fa-arrow-right"></i>
                          <span className="timeline-to">{h.new_status}</span>
                        </div>
                        <div className="timeline-meta">
                          <span><i className="fas fa-clock"></i> {h.changed_at?.slice(0, 16).replace('T', ' ')}</span>
                          {h.changed_by_name && <span><i className="fas fa-user"></i> {h.changed_by_name}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                  {historial.length === 0 && <p className="empty-msg">Sin cambios de estado registrados</p>}
                </div>
              </div>
            )}

            {/* Costs Tab (Mejora #11) */}
            {tab === 'costs' && (
              <div className="costs-tab">
                <div className="form-row">
                  <div className="form-group">
                    <label><i className="fas fa-calculator"></i> Costo estimado ($)</label>
                    <input type="number" value={form.costo_estimado} onChange={e => setForm({ ...form, costo_estimado: e.target.value as any })} placeholder="0" />
                  </div>
                  <div className="form-group">
                    <label><i className="fas fa-receipt"></i> Costo final ($)</label>
                    <input type="number" value={form.costo_final} onChange={e => setForm({ ...form, costo_final: e.target.value as any })} placeholder="0" />
                  </div>
                </div>
                <div className="form-group">
                  <label><i className="fas fa-sticky-note"></i> Notas de costo</label>
                  <textarea rows={3} value={form.notas_costo} onChange={e => setForm({ ...form, notas_costo: e.target.value })} placeholder="Detalles del presupuesto..." />
                </div>
                {tarjeta.costo_estimado != null && tarjeta.costo_final != null && (
                  <div className="cost-summary">
                    <div className="cost-diff">
                      <span>Diferencia:</span>
                      <strong style={{ color: tarjeta.costo_final <= tarjeta.costo_estimado ? '#22c55e' : '#ef4444' }}>
                        ${(tarjeta.costo_final - tarjeta.costo_estimado).toLocaleString()}
                      </strong>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="modal-pro-footer">
            <button className="btn-delete" onClick={() => setShowDelete(true)}>
              <i className="fas fa-trash"></i> Eliminar
            </button>
            <div className="footer-right">
              <button className="btn-cancel" onClick={onClose}>Cancelar</button>
              <button className="btn-save" onClick={handleSave} disabled={saving}>
                {saving ? <><i className="fas fa-spinner fa-spin"></i> Guardando...</> : <><i className="fas fa-check"></i> Guardar</>}
              </button>
            </div>
          </div>
        </div>
      </div>

      {showDelete && (
        <ConfirmModal
          title="¿Mover a papelera?"
          message={`La reparación de "${tarjeta.nombre_propietario}" se moverá a la papelera. Podrás restaurarla después.`}
          onConfirm={() => deleteMut.mutate()}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </>
  );
}
