export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-[var(--foreground-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}
