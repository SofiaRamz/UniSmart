import { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { LuCheck, LuCircleAlert, LuLoaderCircle, LuX } from "react-icons/lu";
import { cx } from "../lib/format";

const BUTTON = {
  primary: "bg-pine text-on-pine hover:bg-pine-deep",
  secondary: "bg-surface text-ink border border-line hover:border-pine hover:text-pine",
  ghost: "text-muted hover:text-ink hover:bg-sunken",
  danger: "bg-danger text-surface hover:opacity-90",
  signal: "bg-signal text-on-signal hover:brightness-95",
};

export function Button({ variant = "primary", size = "md", loading = false, icon: Icon, className, children, ...props }) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55",
        size === "sm" ? "h-8 px-3 text-[13px]" : "h-10 px-4 text-sm",
        BUTTON[variant],
        className,
      )}
    >
      {loading ? <LuLoaderCircle className="animate-spin" aria-hidden /> : Icon ? <Icon aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Field({ label, hint, error, children, className }) {
  const id = useId();
  return (
    <div className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-[13px] font-semibold text-ink">
          {label}
        </label>
      )}
      {typeof children === "function" ? children(id) : children}
      {error ? <p className="text-[12.5px] text-danger">{error}</p> : hint ? <p className="text-[12.5px] text-muted">{hint}</p> : null}
    </div>
  );
}

const CONTROL =
  "w-full min-w-0 rounded-lg border border-line bg-surface px-3 text-[14px] text-ink placeholder:text-muted/70 focus:border-pine focus:outline-none focus:ring-2 focus:ring-pine/20";

export const Input = ({ className, ...props }) => <input {...props} className={cx(CONTROL, "h-10", className)} />;
export const Textarea = ({ className, ...props }) => <textarea {...props} className={cx(CONTROL, "py-2.5 leading-relaxed", className)} />;
export function Select({ className, children, ...props }) {
  return (
    <select {...props} className={cx(CONTROL, "h-10 cursor-pointer pr-8", className)}>
      {children}
    </select>
  );
}

const TONES = {
  neutral: "bg-sunken text-muted",
  pine: "bg-pine-soft text-pine",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  signal: "bg-signal-soft text-warn",
};

export function Badge({ tone = "neutral", className, children }) {
  return (
    <span className={cx("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[12px] font-semibold", TONES[tone], className)}>
      {children}
    </span>
  );
}

export function Card({ className, children, as: Tag = "section" }) {
  return <Tag className={cx("min-w-0 rounded-xl border border-line bg-surface", className)}>{children}</Tag>;
}

export function SectionTitle({ eyebrow, title, children, action }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow mb-1">{eyebrow}</p>}
        <h1 className="text-[26px] font-bold leading-tight text-ink sm:text-[30px]">{title}</h1>
        {children && <p className="mt-1.5 max-w-[62ch] text-muted">{children}</p>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ label = "Cargando…" }) {
  return (
    <div className="flex items-center gap-2 py-6 text-muted" role="status">
      <LuLoaderCircle className="animate-spin" aria-hidden /> {label}
    </div>
  );
}

export function Empty({ icon: Icon, title, children }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line px-6 py-10 text-center">
      {Icon && <Icon className="text-2xl text-muted" aria-hidden />}
      <p className="font-semibold text-ink">{title}</p>
      {children && <p className="max-w-[48ch] text-[13.5px] text-muted">{children}</p>}
    </div>
  );
}

export function Segmented({ options, value, onChange, label }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex max-w-full overflow-x-auto rounded-lg border border-line bg-sunken p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Alert({ tone = "danger", children, className }) {
  if (!children) return null;
  return (
    <div role="alert" className={cx("flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13.5px]", TONES[tone], className)}>
      <LuCircleAlert className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Botón con confirmación dentro de la página (los diálogos nativos no están disponibles). */
export function ConfirmButton({ onConfirm, children, confirmLabel = "Sí, continuar", variant = "secondary", size = "sm", icon }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!asking)
    return (
      <Button variant={variant} size={size} icon={icon} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  return (
    <span className="inline-flex items-center gap-1.5">
      <Button
        variant="danger"
        size={size}
        loading={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setAsking(false);
          }
        }}
      >
        {confirmLabel}
      </Button>
      <Button variant="ghost" size={size} onClick={() => setAsking(false)}>
        Cancelar
      </Button>
    </span>
  );
}

export function Drawer({ open, onClose, title, children, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1200] flex justify-end bg-ink/30" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-label={title}
        className={cx(
          "flex h-full w-full flex-col bg-surface shadow-2xl outline-none",
          wide ? "max-w-[720px]" : "max-w-[520px]",
        )}
        style={{ paddingTop: "env(safe-area-inset-top, 0px)", paddingRight: "env(safe-area-inset-right, 0px)" }}
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <h2 className="truncate text-lg font-bold">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-muted hover:bg-sunken hover:text-ink" aria-label="Cerrar">
            <LuX />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4" style={{ paddingBottom: "max(16px, env(safe-area-inset-bottom, 0px))" }}>
          {children}
        </div>
      </aside>
    </div>
  );
}

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((message, tone = "ok") => {
    const id = Math.random().toString(36).slice(2);
    setItems((list) => [...list, { id, message, tone }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), 4200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed z-[1500] flex flex-col gap-2"
        style={{ right: "max(16px, env(safe-area-inset-right, 0px))", bottom: "max(88px, calc(env(safe-area-inset-bottom, 0px) + 88px))" }}
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              "pointer-events-auto flex max-w-[360px] items-start gap-2 rounded-lg border px-3.5 py-2.5 text-[13.5px] shadow-lg",
              t.tone === "danger" ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-surface text-ink",
            )}
          >
            {t.tone === "danger" ? <LuCircleAlert className="mt-0.5 shrink-0" /> : <LuCheck className="mt-0.5 shrink-0 text-ok" />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Ejecuta una carga asíncrona y expone {data, error, loading, reload}. */
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loader();
      setState({ data, error: null, loading: false });
    } catch (error) {
      setState({ data: null, error, loading: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  return { ...state, reload: run, setData: (data) => setState((s) => ({ ...s, data })) };
}
