import { STATUS_TONE, titleCase } from "@/lib/format";
import type { ApplicationStatus } from "@/lib/types";

export function StatusPill({
  status,
  label,
}: {
  status: ApplicationStatus;
  label?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        STATUS_TONE[status] ?? "bg-slate-100 text-slate-700 ring-slate-300"
      }`}
    >
      {label ?? titleCase(status)}
    </span>
  );
}
