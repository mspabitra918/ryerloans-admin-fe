export function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <header className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/**
 * A label/value row. `mono` is for identifiers and masked values, where
 * character alignment is what makes them readable at a glance.
 */
export function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-xs text-[var(--foreground-muted)]">
        {label}
      </dt>
      <dd
        className={`min-w-0 text-right text-sm ${mono ? "font-mono tabular" : ""}`}
      >
        {value ?? "—"}
      </dd>
    </div>
  );
}
