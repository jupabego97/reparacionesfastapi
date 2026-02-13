import { useEffect } from 'react';

interface Props {
  message: string;
  type: 'success' | 'warning' | 'info';
  onClose: () => void;
  duration?: number;
}

export default function Toast({ message, type, onClose, duration = 4000 }: Props) {
  useEffect(() => {
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [onClose, duration]);

  const icons = { success: 'fas fa-check-circle', warning: 'fas fa-exclamation-triangle', info: 'fas fa-info-circle' };

  return (
    <div className="toast-container">
      <div className={`toast ${type}`}>
        <i className={icons[type]}></i>
        <span>{message}</span>
        <button className="close-toast" onClick={onClose}><i className="fas fa-times"></i></button>
      </div>
    </div>
  );
}
