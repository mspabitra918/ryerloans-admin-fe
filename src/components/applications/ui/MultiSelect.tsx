export function MultiSelect({
  label,
  values,
  selected,
  onToggle,
  labelFor,
}: {
  label: string;
  values: string[];
  selected: string[];
  onToggle: (value: string) => void;
  labelFor?: (value: string) => string;
}) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs text-[var(--foreground-muted)]">
        {label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {values.map((value) => {
          const active = selected.includes(value);

          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => onToggle(value)}
              className={`rounded-full px-2.5 py-1 text-xs ring-1 ring-inset transition-colors ${
                active
                  ? "bg-[var(--accent)] text-white ring-[var(--accent)]"
                  : "bg-[var(--surface)] text-[var(--foreground-muted)] ring-[var(--border)] hover:bg-[var(--surface-muted)]"
              }`}
            >
              {labelFor ? labelFor(value) : value}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
