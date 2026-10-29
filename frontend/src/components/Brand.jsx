export function BrandMark({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <rect width="32" height="32" rx="8" fill="var(--pine)" />
      <path d="M9.5 8.5v8.2a6.5 6.5 0 0 0 13 0V8.5" fill="none" stroke="var(--signal)" strokeWidth="3.2" strokeLinecap="round" />
      <circle cx="16" cy="25.6" r="1.7" fill="var(--on-pine)" />
    </svg>
  );
}

export function Brand({ subtitle }) {
  return (
    <span className="flex items-center gap-2.5">
      <BrandMark />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[17px] font-bold tracking-tight text-ink">
          UniSmart <span className="text-pine">AI</span>
        </span>
        {subtitle && <span className="mt-1 font-mono text-[10px] uppercase tracking-[0.08em] text-muted">{subtitle}</span>}
      </span>
    </span>
  );
}
