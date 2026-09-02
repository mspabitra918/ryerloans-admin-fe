"use client";

import {
  CircleDot,
  FileText,
  Flag,
  Mail,
  StickyNote,
  UserCog,
} from "lucide-react";

import { relative, when } from "@/lib/format";
import type { TimelineEntry } from "@/lib/types";

const ICONS: Record<
  TimelineEntry["kind"],
  React.ComponentType<{ size?: number }>
> = {
  status: CircleDot,
  admin_action: UserCog,
  email: Mail,
  document: FileText,
  note: StickyNote,
  milestone: Flag,
};

const TONES: Record<TimelineEntry["kind"], string> = {
  status: "bg-sky-100 text-sky-700",
  admin_action: "bg-indigo-100 text-indigo-700",
  email: "bg-violet-100 text-violet-700",
  document: "bg-amber-100 text-amber-700",
  note: "bg-slate-100 text-slate-700",
  milestone: "bg-emerald-100 text-emerald-700",
};

/**
 * §8.3: "every status change, email sent/opened/bounced, admin action,
 * document upload, in one reverse-chronological feed."
 *
 * The backend already merges and sorts the four sources, so this only renders.
 */
export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--foreground-muted)]">
        Nothing recorded yet.
      </p>
    );
  }

  return (
    <ol className="relative space-y-4 pl-6">
      {/* One continuous rule behind the markers reads as a single thread,
          rather than as a stack of unrelated cards. */}
      <span
        aria-hidden
        className="absolute left-[11px] top-2 bottom-2 w-px bg-[var(--border)]"
      />

      {entries.map((entry, index) => {
        const Icon = ICONS[entry.kind] ?? CircleDot;

        return (
          <li key={`${entry.at}-${index}`} className="relative">
            <span
              aria-hidden
              className={`absolute -left-6 flex h-6 w-6 items-center justify-center rounded-full ring-4 ring-[var(--surface)] ${TONES[entry.kind]}`}
            >
              <Icon size={12} />
            </span>

            <div className="flex flex-wrap items-baseline justify-between gap-x-3 pl-3">
              <p className="text-sm font-medium">{entry.label}</p>
              <time
                className="text-xs text-[var(--foreground-muted)]"
                dateTime={entry.at}
                title={when(entry.at)}
              >
                {relative(entry.at)}
              </time>
            </div>

            {entry.detail ? (
              <p className="mt-0.5 text-sm text-[var(--foreground-muted)] pl-3">
                {entry.detail}
              </p>
            ) : null}

            <p className="mt-0.5 text-xs text-[var(--foreground-muted)] pl-3">
              {when(entry.at)}
              {entry.actor ? ` · ${entry.actor}` : ""}
            </p>
          </li>
        );
      })}
    </ol>
  );
}
