interface StateProps {
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  icon?: string;
}

export function ErrorState({ title, message, actionLabel, onAction, icon = 'fas fa-triangle-exclamation' }: StateProps) {
  return (
    <div className="ui-state ui-state-error" role="alert">
      <i className={icon} aria-hidden="true"></i>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {actionLabel && onAction && (
        <button className="toolbar-btn active" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ title, message, actionLabel, onAction, icon = 'fas fa-inbox' }: StateProps) {
  return (
    <div className="ui-state ui-state-empty">
      <i className={icon} aria-hidden="true"></i>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {actionLabel && onAction && (
        <button className="toolbar-btn" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  );
}
