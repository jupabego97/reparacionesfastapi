import { useRef } from 'react';
import { useDialogAccessibility } from '../hooks/useDialogAccessibility';

interface Props {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ title, message, onConfirm, onCancel }: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const { dialogRef, titleId, onKeyDown } = useDialogAccessibility({ onClose: onCancel, initialFocusRef: confirmRef });

  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div
        className="confirm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onClick={e => e.stopPropagation()}
      >
        <h4 id={titleId}><i className="fas fa-exclamation-triangle" style={{ color: '#f59e0b' }}></i> {title}</h4>
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="btn-cancel" onClick={onCancel}>Cancelar</button>
          <button ref={confirmRef} className="btn-delete" onClick={onConfirm}><i className="fas fa-check"></i> Confirmar</button>
        </div>
      </div>
    </div>
  );
}
