import { AlertCircle, Inbox, Loader2 } from "lucide-react";

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-[var(--foreground-muted)]">
      <Loader2 size={16} className="animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-sm text-[var(--foreground-muted)]">
      <Inbox size={20} aria-hidden />
      {message}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-3 py-12 text-sm"
    >
      <span className="flex items-center gap-2 text-rose-600">
        <AlertCircle size={16} aria-hidden />
        {message}
      </span>
      {onRetry ? (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
