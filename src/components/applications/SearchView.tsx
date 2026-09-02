"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Filter,
  Search,
  X,
} from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { day, money } from "@/lib/format";
import { StatusPill } from "@/components/ui/StatusPill";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import type {
  ApplicationStatus,
  FilterOptions,
  SearchResponse,
} from "@/lib/types";
import { MultiSelect } from "./ui/MultiSelect";
import { Field } from "./ui/Field";
import { TriState } from "./ui/TriState";

const STATUSES: ApplicationStatus[] = [
  "received",
  "pending_call",
  "in_review",
  "bank_verification_pending",
  "bank_verification_complete",
  "agreement_sent",
  "agreement_signed",
  "verification_deposit_sent",
  "verification_deposit_confirmed",
  "underwriting",
  "approved",
  "funded",
  "declined",
  "withdrawn",
  "expired",
];

const AMOUNT_BANDS = [
  { value: "0-1000", label: "Under $1,000" },
  { value: "1000-2500", label: "$1,000 – $2,500" },
  { value: "2500-5000", label: "$2,500 – $5,000" },
  { value: "5000-10000", label: "$5,000 – $10,000" },
  { value: "10000+", label: "$10,000+" },
];

const DETECTION_LABEL: Record<SearchResponse["detected"], string> = {
  application_id: "application ID",
  email: "email",
  phone: "phone number",
  ssn_last4: "SSN last 4",
  name: "name",
  none: "",
};

/** §8.2: "Debounced 300ms". */
const DEBOUNCE_MS = 300;

interface Filters {
  status: string[];
  state: string[];
  loan_purpose: string[];
  amount_band: string;
  assigned_agent_id: string;
  utm_source: string;
  called_in: string;
  bank_verified: string;
  possible_duplicate: string;
  date_from: string;
  date_to: string;
}

const EMPTY_FILTERS: Filters = {
  status: [],
  state: [],
  loan_purpose: [],
  amount_band: "",
  assigned_agent_id: "",
  utm_source: "",
  called_in: "",
  bank_verified: "",
  possible_duplicate: "",
  date_from: "",
  date_to: "",
};

function getLosAngelesDateTime(date: string | Date | null): string {
  if (!date) return "N/A";

  const d = new Date(date);

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);

  const datePart = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);

  return `${time}\n\n${datePart}`;
}

function getLosAngelesToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function SearchView() {
  const today = getLosAngelesToday();

  const DEFAULT_FILTERS: Filters = {
    status: [],
    state: [],
    loan_purpose: [],
    amount_band: "",
    assigned_agent_id: "",
    utm_source: "",
    called_in: "",
    bank_verified: "",
    possible_duplicate: "",
    date_from: today,
    date_to: today,
  };
  function getInitialFilters(params: URLSearchParams): Filters {
    const today = getLosAngelesToday();

    return {
      status: params.getAll("status"),
      state: params.getAll("state"),
      loan_purpose: params.getAll("loan_purpose"),
      amount_band: params.get("amount_band") ?? "",
      assigned_agent_id: params.get("assigned_agent_id") ?? "",
      utm_source: params.get("utm_source") ?? "",
      called_in: params.get("called_in") ?? "",
      bank_verified: params.get("bank_verified") ?? "",
      possible_duplicate: params.get("possible_duplicate") ?? "",
      date_from: params.get("date_from") ?? today,
      date_to: params.get("date_to") ?? today,
    };
  }

  const router = useRouter();
  const params = useSearchParams();

  // const [term, setTerm] = useState("");
  const [term, setTerm] = useState(() => params.get("q") ?? "");

  // const [debounced, setDebounced] = useState("");
  const [debounced, setDebounced] = useState(() => params.get("q") ?? "");

  // const [page, setPage] = useState(1);
  const [page, setPage] = useState(() => {
    const value = Number(params.get("page"));
    return Number.isFinite(value) && value > 0 ? value : 1;
  });

  // const [filters, setFilters] = useState<Filters>(() => ({
  //   ...EMPTY_FILTERS,
  //   // Deep links from the dashboard queue tiles and duplicate card land here.
  //   status: params.get("status") ? [params.get("status")!] : [],
  //   possible_duplicate: params.get("possible_duplicate") ?? "",
  // }));
  const [filters, setFilters] = useState<Filters>(() =>
    getInitialFilters(params),
  );

  const [showFilters, setShowFilters] = useState(false);

  const [data, setData] = useState<SearchResponse | null>(null);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const query = new URLSearchParams();

    if (debounced) {
      query.set("q", debounced);
    }

    if (page > 1) {
      query.set("page", String(page));
    }

    filters.status.forEach((value) => {
      query.append("status", value);
    });

    filters.state.forEach((value) => {
      query.append("state", value);
    });

    filters.loan_purpose.forEach((value) => {
      query.append("loan_purpose", value);
    });

    if (filters.amount_band) {
      query.set("amount_band", filters.amount_band);
    }

    if (filters.assigned_agent_id) {
      query.set("assigned_agent_id", filters.assigned_agent_id);
    }

    if (filters.utm_source) {
      query.set("utm_source", filters.utm_source);
    }

    if (filters.called_in) {
      query.set("called_in", filters.called_in);
    }

    if (filters.bank_verified) {
      query.set("bank_verified", filters.bank_verified);
    }

    if (filters.possible_duplicate) {
      query.set("possible_duplicate", filters.possible_duplicate);
    }

    // Only send date filters when there are NO other filters.
    const hasNonDateFilter =
      filters.status.length > 0 ||
      filters.state.length > 0 ||
      filters.loan_purpose.length > 0 ||
      filters.amount_band !== "" ||
      filters.assigned_agent_id !== "" ||
      filters.utm_source !== "" ||
      filters.called_in !== "" ||
      filters.bank_verified !== "" ||
      filters.possible_duplicate !== "";

    if (!hasNonDateFilter) {
      if (filters.date_from) {
        query.set("date_from", filters.date_from);
      }

      if (filters.date_to) {
        query.set("date_to", filters.date_to);
      }
    }

    router.replace(`?${query.toString()}`, {
      scroll: false,
    });
  }, [debounced, filters, page, router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(term.trim());
      setPage(1);
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [term]);

  useEffect(() => {
    api
      .filters()
      .then(setOptions)
      .catch(() => {
        // Filter dropdowns are an enhancement; the list still works without
        // them, so a failure here must not blank the page.
      });
  }, []);

  // const load = useCallback(async () => {
  //   setLoading(true);
  //   setError(null);

  //   try {
  //     const result = await api.search({
  //       q: debounced || undefined,
  //       page,
  //       limit: 25,
  //       ...Object.fromEntries(
  //         Object.entries(filters).filter(([, value]) =>
  //           Array.isArray(value) ? value.length > 0 : value !== "",
  //         ),
  //       ),
  //     });

  //     setData(result);

  //     /*
  //      * §8.2: "Application ID (6 digits) → exact match, jumps straight to
  //      * record." Only on an unambiguous single hit — jumping on a partial match
  //      * would take the admin somewhere they did not ask to go.
  //      */
  //     if (result.exact_match && result.results.length === 1) {
  //       router.push(`/applications/${result.exact_match}`);
  //     }
  //   } catch (caught) {
  //     setError(
  //       caught instanceof ApiError
  //         ? caught.message
  //         : "Could not load applications.",
  //     );
  //   } finally {
  //     setLoading(false);
  //   }
  // }, [debounced, filters, page, router]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const hasNonDateFilter =
        debounced.trim() !== "" ||
        filters.status.length > 0 ||
        filters.state.length > 0 ||
        filters.loan_purpose.length > 0 ||
        filters.amount_band !== "" ||
        filters.assigned_agent_id !== "" ||
        filters.utm_source !== "" ||
        filters.called_in !== "" ||
        filters.bank_verified !== "" ||
        filters.possible_duplicate !== "";

      const filterParams = Object.fromEntries(
        Object.entries(filters).filter(([key, value]) => {
          // If another filter is selected, don't send today's dates
          if (hasNonDateFilter && (key === "date_from" || key === "date_to")) {
            return false;
          }

          return Array.isArray(value) ? value.length > 0 : value !== "";
        }),
      );

      const result = await api.search({
        q: debounced || undefined,
        page,
        limit: 25,
        ...filterParams,
      });

      setData(result);

      if (result.exact_match && result.results.length === 1) {
        router.push(`/applications/${result.exact_match}`);
      }
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load applications.",
      );
    } finally {
      setLoading(false);
    }
  }, [debounced, filters, page, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const activeFilterCount = useMemo(
    () =>
      Object.values(filters).filter((value) =>
        Array.isArray(value) ? value.length > 0 : value !== "",
      ).length,
    [filters],
  );

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  function toggleMulti(
    key: "status" | "state" | "loan_purpose",
    value: string,
  ) {
    setFilters((current) => {
      const list = current[key];

      return {
        ...current,
        [key]: list.includes(value)
          ? list.filter((entry) => entry !== value)
          : [...list, value],
      };
    });
    setPage(1);
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Applications</h1>
        <p className="text-sm text-[var(--foreground-muted)]">
          Search by name, phone, email, application ID, or SSN last 4.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={16}
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--foreground-muted)]"
          />
          <input
            ref={searchRef}
            className="field !pl-9"
            placeholder="Smith John · (747) 200-5220 · A1B2C3 · 6789 · jane@example.com"
            value={term}
            aria-label="Search applications"
            onChange={(event) => setTerm(event.target.value)}
          />
          {term ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => {
                setTerm("");
                searchRef.current?.focus();
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[var(--foreground-muted)] hover:bg-[var(--surface-muted)]"
            >
              <X size={14} aria-hidden />
            </button>
          ) : null}
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((value) => !value)}
          aria-expanded={showFilters}
          className="btn btn-secondary"
        >
          <Filter size={15} aria-hidden />
          Filters
          {activeFilterCount > 0 ? (
            <span className="rounded-full bg-[var(--accent)] px-1.5 text-xs text-white">
              {activeFilterCount}
            </span>
          ) : null}
        </button>

        {activeFilterCount > 0 ? (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              // setFilters(EMPTY_FILTERS);
              setFilters(DEFAULT_FILTERS);
              setPage(1);
              setTerm("");
            }}
          >
            Clear
          </button>
        ) : null}
      </div>

      {/* Says what the search box decided the input was, so a surprising
          result set is explainable rather than mysterious. */}
      {data && debounced && data.detected !== "none" ? (
        <p className="text-xs text-[var(--foreground-muted)]">
          Matched as {DETECTION_LABEL[data.detected]} · {data.total} result
          {data.total === 1 ? "" : "s"}
        </p>
      ) : null}

      {showFilters ? (
        <div className="card space-y-4 p-4">
          <MultiSelect
            label="Status"
            values={STATUSES}
            selected={filters.status}
            onToggle={(value) => toggleMulti("status", value)}
            labelFor={(value) =>
              value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase())
            }
          />

          {options && options.states.length > 0 ? (
            <MultiSelect
              label="State"
              values={options.states}
              selected={filters.state}
              onToggle={(value) => toggleMulti("state", value)}
            />
          ) : null}

          {options && options.loan_purposes.length > 0 ? (
            <MultiSelect
              label="Loan purpose"
              values={options.loan_purposes}
              selected={filters.loan_purpose}
              onToggle={(value) => toggleMulti("loan_purpose", value)}
            />
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Amount band">
              <select
                className="field"
                value={filters.amount_band}
                onChange={(event) => update("amount_band", event.target.value)}
              >
                <option value="">Any</option>
                {AMOUNT_BANDS.map((band) => (
                  <option key={band.value} value={band.value}>
                    {band.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Assigned agent">
              <select
                className="field"
                value={filters.assigned_agent_id}
                onChange={(event) =>
                  update("assigned_agent_id", event.target.value)
                }
              >
                <option value="">Any</option>
                <option value="unassigned">Unassigned</option>
                {options?.agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.email}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="UTM source">
              <select
                className="field"
                value={filters.utm_source}
                onChange={(event) => update("utm_source", event.target.value)}
              >
                <option value="">Any</option>
                {options?.utm_sources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Called in">
              <TriState
                value={filters.called_in}
                onChange={(value) => update("called_in", value)}
              />
            </Field>

            <Field label="Bank verified">
              <TriState
                value={filters.bank_verified}
                onChange={(value) => update("bank_verified", value)}
              />
            </Field>

            <Field label="Possible duplicate">
              <TriState
                value={filters.possible_duplicate}
                onChange={(value) => update("possible_duplicate", value)}
              />
            </Field>

            <Field label="Submitted from">
              <input
                type="date"
                className="field"
                value={filters.date_from}
                onChange={(event) => update("date_from", event.target.value)}
              />
            </Field>

            <Field label="Submitted to">
              <input
                type="date"
                className="field"
                value={filters.date_to}
                onChange={(event) => update("date_to", event.target.value)}
              />
            </Field>
          </div>
        </div>
      ) : null}

      <div className="card overflow-hidden">
        {loading && !data ? <Spinner /> : null}
        {error ? (
          <ErrorState message={error} onRetry={() => void load()} />
        ) : null}

        {data && data.results.length === 0 && !loading ? (
          <EmptyState message="No applications match this search." />
        ) : null}

        {data && data.results.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead className="bg-[var(--surface-muted)] text-left text-xs text-[var(--foreground-muted)]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">ID</th>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Contact</th>
                  <th className="px-4 py-2.5 font-medium">State</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Agent</th>
                  <th className="px-4 py-2.5 font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {data.results.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-[var(--border)] hover:bg-[var(--surface-muted)]"
                  >
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/applications/${row.application_id}`}
                        className="font-mono font-medium text-[var(--accent-strong)] hover:underline"
                      >
                        {row.application_id}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="flex items-center gap-1.5">
                        {row.full_name}
                        {row.possible_duplicate ? (
                          <span
                            title="Flagged as a possible duplicate"
                            className="text-amber-600"
                          >
                            <Copy size={13} aria-hidden />
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="block truncate" title={row.email}>
                        {row.email}
                      </span>
                      <span className="tabular block text-xs text-[var(--foreground-muted)]">
                        {row.phone ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">{row.state}</td>
                    <td className="tabular px-4 py-2.5 text-right">
                      {money(row.amount_requested)}
                    </td>
                    <td className="px-4 py-2.5">
                      <StatusPill
                        status={row.status}
                        label={row.status_label}
                      />
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--foreground-muted)]">
                      {row.assigned_agent?.email ?? "Unassigned"}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-[var(--foreground-muted)]">
                      {getLosAngelesDateTime(row.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {data && data.pages > 1 ? (
          <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-3 text-sm">
            <span className="text-[var(--foreground-muted)]">
              Page {data.page} of {data.pages} · {data.total} total
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={data.page <= 1}
                onClick={() => setPage((value) => Math.max(value - 1, 1))}
              >
                <ChevronLeft size={15} aria-hidden />
                Previous
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={data.page >= data.pages}
                onClick={() => setPage((value) => value + 1)}
              >
                Next
                <ChevronRight size={15} aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
