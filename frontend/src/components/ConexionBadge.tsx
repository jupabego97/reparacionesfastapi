interface Props {
  status: 'connecting' | 'connected' | 'disconnected';
}

const statusConfig = {
  connecting: { label: 'Conectando', icon: 'fas fa-circle-notch fa-spin' },
  connected: { label: 'Conectado', icon: 'fas fa-check-circle' },
  disconnected: { label: 'Desconectado', icon: 'fas fa-times-circle' },
};

export default function ConexionBadge({ status }: Props) {
  const cfg = statusConfig[status];
  return (
    <span className={`connection-badge ${status}`}>
      <i className={cfg.icon}></i> {cfg.label}
    </span>
  );
}
