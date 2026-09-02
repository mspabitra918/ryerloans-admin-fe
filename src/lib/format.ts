import type { ApplicationStatus } from "./types";

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const currencyPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/**
 * Timestamps are rendered in the lender's own timezone, matching the backend's
 * ADMIN_TIMEZONE. An admin in another timezone reading "today" off their own
 * clock would disagree with every count on the dashboard.
 */
const LENDER_TIMEZONE = "America/Los_Angeles";

const dateTime = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: LENDER_TIMEZONE,
});

const dateOnly = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeZone: LENDER_TIMEZONE,
});

export function money(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return currency.format(value);
}

export function moneyPrecise(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return currencyPrecise.format(value);
}

export function when(value: string | Date | null | undefined): string {
  if (!value) return "—";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return dateTime.format(date);
}

export function day(value: string | Date | null | undefined): string {
  if (!value) return "—";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return dateOnly.format(date);
}

/** "3 minutes ago", for the timeline. */
export function relative(value: string | Date | null | undefined): string {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
  ];

  const formatter = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

  if (seconds < 60) return formatter.format(-seconds, "second");

  for (let i = 1; i < units.length; i++) {
    const [limit, unit] = units[i];

    if (seconds < limit) {
      return formatter.format(-Math.round(seconds / units[i - 1][0]), unit);
    }
  }

  return formatter.format(-Math.round(seconds / 31557600), "year");
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}%`;
}

export function hours(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 24) return `${value.toFixed(1)}h`;
  return `${(value / 24).toFixed(1)}d`;
}

export function bytes(value: number | null | undefined): string {
  if (!value) return "—";

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unit = 0;

  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit++;
  }

  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function titleCase(value: string): string {
  return value
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Status colours group by meaning rather than by pipeline position: in-flight
 * states are blue, borrower-blocked states amber, good outcomes green, closed
 * outcomes grey, and only a decline is red. A palette that walks the rainbow
 * down the pipeline makes "waiting on the borrower" and "we said no" look
 * equally alarming.
 */
export const STATUS_TONE: Record<ApplicationStatus, string> = {
  received: "bg-slate-100 text-slate-700 ring-slate-300",
  pending_call: "bg-amber-100 text-amber-800 ring-amber-300",
  in_review: "bg-sky-100 text-sky-800 ring-sky-300",
  bank_verification_pending: "bg-amber-100 text-amber-800 ring-amber-300",
  bank_verification_complete: "bg-sky-100 text-sky-800 ring-sky-300",
  agreement_sent: "bg-amber-100 text-amber-800 ring-amber-300",
  agreement_signed: "bg-sky-100 text-sky-800 ring-sky-300",
  verification_deposit_sent: "bg-amber-100 text-amber-800 ring-amber-300",
  verification_deposit_confirmed: "bg-sky-100 text-sky-800 ring-sky-300",
  underwriting: "bg-indigo-100 text-indigo-800 ring-indigo-300",
  approved: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  funded: "bg-emerald-600 text-white ring-emerald-700",
  declined: "bg-rose-100 text-rose-800 ring-rose-300",
  withdrawn: "bg-slate-200 text-slate-700 ring-slate-400",
  expired: "bg-slate-200 text-slate-600 ring-slate-400",
};

export { LENDER_TIMEZONE };
