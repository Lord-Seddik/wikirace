import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { levelForXp } from '../../shared/progression';
import { Link } from '../lib/router';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

export function Button({
  variant = 'secondary',
  size,
  loading,
  className = '',
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'sm' | 'lg'; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={rest.disabled || loading}
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''}${loading ? ' is-loading' : ''} ${className}`}
    >
      {loading && <span className="spinner spinner-sm" aria-hidden />}
      {children}
    </button>
  );
}

export function LinkButton({ to, variant = 'secondary', size, children, className = '' }: { to: string; variant?: Variant; size?: 'sm' | 'lg'; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={`btn btn-${variant}${size ? ` btn-${size}` : ''} ${className}`}>
      {children}
    </Link>
  );
}

export function Card({ children, className = '', title, actions }: { children: ReactNode; className?: string; title?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-head">
          {title && <h2 className="card-title">{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden />
      {label && <span>{label}</span>}
    </div>
  );
}

export function Empty({ icon = '🔎', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: Error | string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <span>⚠️ {typeof error === 'string' ? error : error.message}</span>
      {onRetry && (
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  size,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  disabled?: boolean;
  size?: 'sm';
}) {
  return (
    <div className={`segmented${size ? ` segmented-${size}` : ''}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          disabled={disabled}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled, hint }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; hint?: string }) {
  return (
    <label className={`toggle${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden>
        <span className="toggle-thumb" />
      </span>
      <span className="toggle-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

export function Field({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Avatar({ avatar, color, size = 36, ring }: { avatar: string; color: string; size?: number; ring?: boolean }) {
  return (
    <span className={`avatar${ring ? ' avatar-ring' : ''}`} style={{ width: size, height: size, fontSize: size * 0.55, background: `${color}26`, borderColor: color }} aria-hidden>
      {avatar}
    </span>
  );
}

export function PlayerTag({ id, name, avatar, color, xp, level, size = 28, link = true }: { id?: string; name: string; avatar: string; color: string; xp?: number; level?: number; size?: number; link?: boolean }) {
  const lvl = level ?? (xp !== undefined ? levelForXp(xp) : undefined);
  const inner = (
    <>
      <Avatar avatar={avatar} color={color} size={size} />
      <span className="player-name">{name}</span>
      {lvl !== undefined && <span className="lvl">Lv {lvl}</span>}
    </>
  );
  return link && id ? (
    <Link to={`/u/${id}`} className="player-tag">
      {inner}
    </Link>
  ) : (
    <span className="player-tag">{inner}</span>
  );
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose?: () => void; title?: ReactNode; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.classList.add('modal-open');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('modal-open');
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true">
        {(title || onClose) && (
          <header className="modal-head">
            {title && <h2>{title}</h2>}
            {onClose && (
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                ✕
              </button>
            )}
          </header>
        )}
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, icon, accent }: { label: string; value: ReactNode; icon?: string; accent?: boolean }) {
  return (
    <div className={`stat${accent ? ' stat-accent' : ''}`}>
      {icon && (
        <span className="stat-icon" aria-hidden>
          {icon}
        </span>
      )}
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export function Tabs<T extends string>({ value, tabs, onChange }: { value: T; tabs: { id: T; label: ReactNode }[]; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={t.id === value} className={t.id === value ? 'on' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
