import { useState, useEffect, useRef } from 'react';

interface Props {
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export default function BlockTarjetaModal({ onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-modal"
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="block-modal-title"
      >
        <h4 id="block-modal-title">
          <i className="fas fa-lock" style={{ color: '#f59e0b' }}></i> Bloquear tarjeta
        </h4>
        <p>La tarjeta no podrá moverse hasta desbloquearla.</p>
        <label className="block-reason-label">
          Motivo (opcional)
          <textarea
            ref={textareaRef}
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Ej: Esperando repuesto del proveedor"
          />
        </label>
        <div className="confirm-actions">
          <button type="button" className="btn-cancel" onClick={onCancel}>Cancelar</button>
          <button type="button" className="btn-delete" onClick={() => onConfirm(reason.trim())}>
            <i className="fas fa-lock"></i> Bloquear
          </button>
        </div>
      </div>
    </div>
  );
}
