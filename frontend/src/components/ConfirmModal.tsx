interface Props {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ title, message, onConfirm, onCancel }: Props) {
  return (
    <div className="confirm-overlay" onClick={onCancel}>
      <div className="confirm-modal" onClick={e => e.stopPropagation()}>
        <h4><i className="fas fa-exclamation-triangle" style={{ color: '#f59e0b' }}></i> {title}</h4>
        <p>{message}</p>
        <div className="confirm-actions">
          <button className="btn-cancel" onClick={onCancel}>Cancelar</button>
          <button className="btn-delete" onClick={onConfirm}><i className="fas fa-check"></i> Confirmar</button>
        </div>
      </div>
    </div>
  );
}
