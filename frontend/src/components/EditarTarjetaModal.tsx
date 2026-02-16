import { useEffect, useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { TarjetaDetail, SubTask, CommentItem, Tag, UserInfo, TarjetaUpdate, TarjetaMediaItem } from '../api/client';
import ConfirmModal from './ConfirmModal';

interface Props {
  tarjetaId: number;
  onClose: () => void;
}

type TabKey = 'info' | 'subtasks' | 'comments' | 'history' | 'photos';
type HistorialEntry = {
  id: number;
  old_status: string | null;
  new_status: string;
  changed_at: string | null;
  changed_by_name: string | null;
};

const PRIORIDADES = [
  { value: 'alta', label: 'Alta', color: '#ef4444' },
  { value: 'media', label: 'Media', color: '#f59e0b' },
  { value: 'baja', label: 'Baja', color: '#22c55e' },
];

export default function EditarTarjetaModal({ tarjetaId, onClose }: Props) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<TabKey>('info');
  const [showDelete, setShowDelete] = useState(false);
  const [saving, setSaving] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Basic focus trap
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !modalRef.current) return;
    const focusable = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }, []);

  const { data: tarjeta, isLoading: loadingTarjeta } = useQuery<TarjetaDetail>({
    queryKey: ['tarjeta-detail', tarjetaId],
    queryFn: () => api.getTarjetaById(tarjetaId),
  });

  const [form, setForm] = useState({
    nombre_propietario: '',
    problema: '',
    whatsapp: '',
    fecha_limite: '',
    tiene_cargador: 'si',
    notas_tecnicas: '',
    prioridad: 'media',
    asignado_a: '' as string | number,
    costo_estimado: '' as string | number,
    costo_final: '' as string | number,
    notas_costo: '',
  });
  const [selectedTags, setSelectedTags] = useState<number[]>([]);
  const [newSubtask, setNewSubtask] = useState('');
  const [newComment, setNewComment] = useState('');
  const [photoError, setPhotoError] = useState('');

  useEffect(() => {
    if (!tarjeta) return;
    setForm({
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
    setSelectedTags(tarjeta.tags?.map(t => t.id) || []);
  }, [tarjeta]);

  // Global data — uses staleTime so App-level cache is reused (no redundant fetches)
  const { data: allTags = [] } = useQuery({ queryKey: ['tags'], queryFn: api.getTags, staleTime: 5 * 60_000 });
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: api.getUsers, staleTime: 5 * 60_000 });

  // Card-specific data — only fetch when the relevant tab is active
  const { data: subtasks = [], refetch: refetchSubtasks } = useQuery({
    queryKey: ['subtasks', tarjetaId], queryFn: () => api.getSubTasks(tarjetaId),
    enabled: tab === 'subtasks',
  });
  const { data: comments = [], refetch: refetchComments } = useQuery({
    queryKey: ['comments', tarjetaId], queryFn: () => api.getComments(tarjetaId),
    enabled: tab === 'comments',
  });
  const { data: historial = [] } = useQuery({
    queryKey: ['historial', tarjetaId], queryFn: () => api.getHistorial(tarjetaId),
    enabled: tab === 'history',
  });
  const { data: media = [], refetch: refetchMedia } = useQuery<TarjetaMediaItem[]>({
    queryKey: ['media', tarjetaId], queryFn: () => api.getTarjetaMedia(tarjetaId),
    enabled: tab === 'photos',
  });

  const updateMut = useMutation({
    mutationFn: (data: TarjetaUpdate) => api.updateTarjeta(tarjetaId, data),
    onSuccess: (updated) => {
      qc.setQueryData(['tarjeta-detail', tarjetaId], updated);
      onClose();
    },
  });

  const deleteMut = useMutation({
    mutationFn: () => api.deleteTarjeta(tarjetaId),
    onSuccess: () => {
      onClose();
    },
  });

  const addSubtaskMut = useMutation({
    mutationFn: (title: string) => api.createSubTask(tarjetaId, title),
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
    mutationFn: (content: string) => api.createComment(tarjetaId, content),
    onSuccess: () => { refetchComments(); setNewComment(''); },
  });
  const delCommentMut = useMutation({
    mutationFn: (id: number) => api.deleteComment(id),
    onSuccess: () => refetchComments(),
  });
  const uploadMediaMut = useMutation({
    mutationFn: (files: File[]) => api.uploadTarjetaMedia(tarjetaId, files),
    onSuccess: () => { refetchMedia(); },
    onError: (e: unknown) => setPhotoError(e instanceof Error ? e.message : 'Error subiendo fotos'),
  });
  const deleteMediaMut = useMutation({
    mutationFn: (mediaId: number) => api.deleteTarjetaMedia(tarjetaId, mediaId),
    onSuccess: () => { refetchMedia(); },
  });
  const coverMediaMut = useMutation({
    mutationFn: (mediaId: number) => api.updateTarjetaMedia(tarjetaId, mediaId, { is_cover: true }),
    onSuccess: () => { refetchMedia(); },
  });
  const reorderMediaMut = useMutation({
    mutationFn: (items: { id: number; position: number }[]) => api.reorderTarjetaMedia(tarjetaId, items),
    onSuccess: () => refetchMedia(),
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

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    if (media.length + files.length > 10) {
      setPhotoError('Limite maximo de 10 fotos por tarjeta');
      return;
    }
    setPhotoError('');
    uploadMediaMut.mutate(files);
  };

  const moveMedia = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= media.length) return;
    const copy = [...media];
    const tmp = copy[index];
    copy[index] = copy[target];
    copy[target] = tmp;
    const items = copy.map((m, pos) => ({ id: m.id, position: pos }));
    reorderMediaMut.mutate(items);
  };

  return (
    <>
      <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
        <div className="modal-pro modal-lg" ref={modalRef} onClick={e => e.stopPropagation()}>
          <div className="modal-pro-header">
            <h3><i className="fas fa-pen-fancy"></i> Editar Reparacion #{tarjetaId}</h3>
            <button className="modal-close" onClick={onClose}><i className="fas fa-times"></i></button>
          </div>

          {loadingTarjeta || !tarjeta ? (
            <div className="modal-pro-body"><div className="app-loading"><div className="spinner-large"></div></div></div>
          ) : (
            <>
              <div className="modal-tabs">
                {[
                  { key: 'info', icon: 'fas fa-info-circle', label: 'Info', tooltip: 'Informacion y costos' },
                  { key: 'subtasks', icon: 'fas fa-tasks', label: `Tareas (${subtasks.length})`, tooltip: 'Subtareas' },
                  { key: 'comments', icon: 'fas fa-comments', label: `Comentarios (${comments.length})`, tooltip: 'Comentarios' },
                  { key: 'history', icon: 'fas fa-history', label: 'Historial', tooltip: 'Historial' },
                  { key: 'photos', icon: 'fas fa-images', label: `Fotos (${media.length})`, tooltip: 'Fotos' },
                ].map(t => (
                  <button key={t.key} className={`modal-tab ${tab === t.key ? 'active' : ''}`}
                    onClick={() => setTab(t.key as TabKey)} data-tooltip={t.tooltip}>
                    <i className={t.icon}></i> <span>{t.label}</span>
                  </button>
                ))}
              </div>

              <div className="modal-pro-body">
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
                        <label><i className="fas fa-calendar"></i> Fecha limite</label>
                        <input type="date" value={form.fecha_limite} onChange={e => setForm({ ...form, fecha_limite: e.target.value })} />
                      </div>
                      <div className="form-group">
                        <label><i className="fas fa-plug"></i> Cargador</label>
                        <select value={form.tiene_cargador} onChange={e => setForm({ ...form, tiene_cargador: e.target.value })}>
                          <option value="si">Si</option>
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
                        <select value={form.asignado_a} onChange={e => setForm({ ...form, asignado_a: e.target.value })}>
                          <option value="">Sin asignar</option>
                          {users.map((u: UserInfo) => <option key={u.id} value={u.id}>{u.full_name} ({u.role})</option>)}
                        </select>
                      </div>
                    </div>
                    <div className="form-group">
                      <label><i className="fas fa-wrench"></i> Notas tecnicas</label>
                      <textarea rows={2} value={form.notas_tecnicas} onChange={e => setForm({ ...form, notas_tecnicas: e.target.value })} />
                    </div>
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

                    {/* Costs (consolidated from Costs tab) */}
                    <div className="form-row">
                      <div className="form-group">
                        <label><i className="fas fa-calculator"></i> Costo estimado ($)</label>
                        <input type="number" value={form.costo_estimado} onChange={e => setForm({ ...form, costo_estimado: e.target.value })} placeholder="0" />
                      </div>
                      <div className="form-group">
                        <label><i className="fas fa-receipt"></i> Costo final ($)</label>
                        <input type="number" value={form.costo_final} onChange={e => setForm({ ...form, costo_final: e.target.value })} placeholder="0" />
                      </div>
                    </div>
                    <div className="form-group">
                      <label><i className="fas fa-sticky-note"></i> Notas de costo</label>
                      <textarea rows={2} value={form.notas_costo} onChange={e => setForm({ ...form, notas_costo: e.target.value })} placeholder="Detalles del presupuesto..." />
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

                    {/* Block/Unblock */}
                    <div className="form-group">
                      <label><i className="fas fa-lock"></i> Bloqueo</label>
                      {tarjeta.bloqueada ? (
                        <button type="button" className="btn-save" style={{ background: '#22c55e' }}
                          onClick={async () => {
                            await api.unblockTarjeta(tarjetaId);
                            qc.invalidateQueries({ queryKey: ['tarjeta-detail', tarjetaId] });
                            qc.invalidateQueries({ queryKey: ['tarjetas-board'] });
                          }}>
                          <i className="fas fa-lock-open"></i> Desbloquear tarjeta
                        </button>
                      ) : (
                        <button type="button" className="btn-save" style={{ background: '#ef4444' }}
                          onClick={async () => {
                            await api.blockTarjeta(tarjetaId, 'Bloqueo manual');
                            qc.invalidateQueries({ queryKey: ['tarjeta-detail', tarjetaId] });
                            qc.invalidateQueries({ queryKey: ['tarjetas-board'] });
                          }}>
                          <i className="fas fa-lock"></i> Bloquear tarjeta
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {tab === 'subtasks' && (
                  <div className="subtasks-tab">
                    <div className="add-subtask">
                      <input value={newSubtask} onChange={e => setNewSubtask(e.target.value)} placeholder="Nueva tarea..."
                        onKeyDown={e => { if (e.key === 'Enter' && newSubtask.trim()) addSubtaskMut.mutate(newSubtask.trim()); }} />
                      <button onClick={() => newSubtask.trim() && addSubtaskMut.mutate(newSubtask.trim())} disabled={!newSubtask.trim()}>
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
                          <button className="btn-del-sm" onClick={() => delSubtaskMut.mutate(s.id)}><i className="fas fa-trash"></i></button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

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
                            <button className="btn-del-sm" onClick={() => delCommentMut.mutate(c.id)}><i className="fas fa-trash"></i></button>
                          </div>
                          <p className="comment-body">{c.content}</p>
                        </div>
                      ))}
                      {comments.length === 0 && <p className="empty-msg"><i className="fas fa-comment-slash"></i> Sin comentarios aun</p>}
                    </div>
                  </div>
                )}

                {tab === 'history' && (
                  <div className="history-tab">
                    <div className="timeline">
                      {historial.map((h: HistorialEntry, i: number) => (
                        <div key={h.id || i} className="timeline-item">
                          <div className="timeline-dot"></div>
                          <div className="timeline-content">
                            <div className="timeline-row">
                              <span className="timeline-from">{h.old_status || '-'}</span>
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

                {tab === 'photos' && (
                  <div className="photos-tab">
                    <div className="form-group">
                      <label><i className="fas fa-images"></i> Galeria ({media.length}/10)</label>
                      <input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handlePhotoUpload} />
                      {photoError && <span className="field-error">{photoError}</span>}
                    </div>
                    <div className="photo-grid">
                      {media.map((m, idx) => (
                        <div key={m.id} className="photo-card">
                          <img src={m.thumb_url || m.url} alt={`Foto ${idx + 1}`} />
                          <div className="photo-actions">
                            <button className="btn-action" onClick={() => coverMediaMut.mutate(m.id)} title="Usar como portada">
                              <i className={`fas ${m.is_cover ? 'fa-star' : 'fa-star-half-alt'}`}></i>
                            </button>
                            <button className="btn-action" onClick={() => moveMedia(idx, -1)} title="Mover arriba">
                              <i className="fas fa-arrow-up"></i>
                            </button>
                            <button className="btn-action" onClick={() => moveMedia(idx, 1)} title="Mover abajo">
                              <i className="fas fa-arrow-down"></i>
                            </button>
                            <button className="btn-action" onClick={() => deleteMediaMut.mutate(m.id)} title="Eliminar foto">
                              <i className="fas fa-trash"></i>
                            </button>
                          </div>
                        </div>
                      ))}
                      {media.length === 0 && <p className="empty-msg">Sin fotos en esta tarjeta</p>}
                    </div>
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
            </>
          )}
        </div>
      </div>

      {showDelete && (
        <ConfirmModal
          title="Mover a papelera?"
          message={`La reparacion de "${tarjeta?.nombre_propietario || 'Cliente'}" se movera a la papelera. Podras restaurarla despues.`}
          onConfirm={() => deleteMut.mutate()}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </>
  );
}
