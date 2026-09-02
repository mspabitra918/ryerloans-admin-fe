"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Copy, MailWarning, Timer } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { hours, percent, when } from "@/lib/format";
import { ErrorState, Spinner } from "@/components/ui/States";
import { Panel } from "@/components/ui/Panel";
import type { DashboardStats } from "@/lib/types";

const RANGES = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
  { key: "all", label: "All time" },
];

/**
 * Categorical palette for the traffic-source pie.
 *
 * Six hues with distinct lightness steps, so the slices stay separable in
 * greyscale and for the ~8% of men with red-green colour vision deficiency —
 * a pie that only works in full colour is a pie that does not work.
 */
const CATEGORICAL = [
  "#0b6bcb",
  "#7c3aed",
  "#0891b2",
  "#c2410c",
  "#4d7c0f",
  "#a21caf",
];

export function DashboardView() {
  const [range, setRange] = useState("all");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      setStats(await api.dashboard(range));
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load the dashboard.",
      );
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-[var(--foreground-muted)]">
            {stats
              ? `Generated ${when(stats.generated_at)} · ${stats.timezone}`
              : " "}
          </p>
        </div>

        <div
          className="flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5"
          role="group"
          aria-label="Cohort window"
        >
          {RANGES.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setRange(option.key)}
              aria-pressed={range === option.key}
              className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                range === option.key
                  ? "bg-[var(--accent-soft)] font-medium text-[var(--accent-strong)]"
                  : "text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {loading && !stats ? <Spinner /> : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {stats ? (
        <>
          {/*
            The header tiles deliberately ignore the range selector — the
            backend always reports today/week/month here, so these four never
            move under the admin as they change cohort.
          */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Today" value={stats.applications.today} />
            <Tile label="This week" value={stats.applications.week} />
            <Tile label="This month" value={stats.applications.month} />
            <Tile label="All time" value={stats.applications.total} />
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Metric
              icon={<Timer size={15} aria-hidden />}
              label="Called in within 24h"
              value={percent(stats.performance.called_in_within_24h_percent)}
              hint={`${stats.performance.called_in_within_24h} of ${stats.performance.called_in_24h_eligible} eligible`}
            />
            <Metric
              label="Bank verified"
              value={percent(stats.performance.bank_verified_percent)}
              hint={`${percent(stats.performance.called_in_percent)} called in`}
            />
            <Metric
              label="Avg. time to fund"
              value={hours(stats.performance.average_time_to_fund_hours)}
              hint={`Median ${hours(stats.performance.median_time_to_fund_hours)} · ${stats.performance.funded_count} funded`}
            />
            <Metric
              icon={<MailWarning size={15} aria-hidden />}
              label="Email bounce rate"
              value={`${stats.email.bounce_rate_percent.toFixed(1)}%`}
              hint={`${stats.email.bounced} of ${stats.email.sent} sent`}
              tone={stats.email.bounce_rate_percent > 5 ? "warn" : undefined}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Funnel conversion" className="lg:col-span-2">
              <FunnelChart stats={stats} />
            </Panel>

            <Panel title="Queue counts">
              <ul className="space-y-1">
                {stats.queues.map((queue) => (
                  <li key={queue.status}>
                    <Link
                      href={`/applications?status=${queue.status}`}
                      className="flex items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-[var(--surface-muted)]"
                    >
                      <span className="text-[var(--foreground-muted)]">
                        {queue.label}
                      </span>
                      <span className="tabular font-medium">{queue.count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Decline reasons">
              {stats.decline_reasons.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--foreground-muted)]">
                  No declines in this window.
                </p>
              ) : (
                <ul className="space-y-2">
                  {stats.decline_reasons.slice(0, 8).map((reason) => (
                    <li key={reason.code}>
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate" title={reason.label}>
                          {reason.label}
                        </span>
                        <span className="tabular shrink-0 text-[var(--foreground-muted)]">
                          {reason.count} · {percent(reason.percent)}
                        </span>
                      </div>
                      <Meter value={reason.percent ?? 0} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Applications by state">
              <StateBars stats={stats} />
            </Panel>

            <Panel title="Traffic sources">
              <SourcePie stats={stats} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Agent workload">
              {stats.agent_workload.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--foreground-muted)]">
                  No applications in this window.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--foreground-muted)]">
                      <th className="pb-2 font-medium">Agent</th>
                      <th className="pb-2 text-right font-medium">Open</th>
                      <th className="pb-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.agent_workload.map((agent) => (
                      <tr
                        key={agent.admin_user_id ?? "unassigned"}
                        className="border-t border-[var(--border)]"
                      >
                        <td className="py-2">{agent.email}</td>
                        <td className="tabular py-2 text-right font-medium">
                          {agent.open}
                        </td>
                        <td className="tabular py-2 text-right text-[var(--foreground-muted)]">
                          {agent.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>

            <div className="space-y-4">
              <Panel title="Flagged duplicates">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm text-[var(--foreground-muted)]">
                    <Copy size={15} aria-hidden />
                    {stats.flagged_duplicates.open} open of{" "}
                    {stats.flagged_duplicates.total} flagged
                  </div>
                  <Link
                    href="/applications?possible_duplicate=true"
                    className="btn btn-secondary"
                  >
                    Review
                  </Link>
                </div>
              </Panel>

              <Panel title="Email deliverability">
                <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  <Stat label="Sent" value={stats.email.sent} />
                  <Stat label="Delivered" value={stats.email.delivered} />
                  <Stat label="Opened" value={stats.email.opened} />
                  <Stat label="Bounced" value={stats.email.bounced} />
                  <Stat label="Complaints" value={stats.email.complaints} />
                  <Stat label="Withheld" value={stats.email.cancelled} />
                </dl>
              </Panel>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-[var(--foreground-muted)]">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  tone?: "warn";
}) {
  return (
    <div className="card p-4">
      <p className="flex items-center gap-1.5 text-xs text-[var(--foreground-muted)]">
        {icon}
        {label}
      </p>
      <p
        className={`tabular mt-1 text-xl font-semibold ${
          tone === "warn" ? "text-amber-600" : ""
        }`}
      >
        {value}
        {tone === "warn" ? (
          <AlertTriangle size={15} className="ml-1 inline" aria-hidden />
        ) : null}
      </p>
      {hint ? (
        <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <>
      <dt className="text-[var(--foreground-muted)]">{label}</dt>
      <dd className="tabular text-right font-medium">{value}</dd>
    </>
  );
}

function Meter({ value }: { value: number }) {
  return (
    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[var(--surface-muted)]">
      <div
        className="h-full rounded-full bg-[var(--accent)]"
        style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
      />
    </div>
  );
}

/**
 * The funnel is drawn as horizontal bars rather than a tapering funnel shape.
 * Stages here are not strictly nested — a file can be funded with no micro
 * deposit on record — so a taper would draw a containment relationship that
 * the data does not have.
 */
function FunnelChart({ stats }: { stats: DashboardStats }) {
  const top = stats.funnel[0]?.count ?? 0;

  return (
    <ol className="space-y-2.5">
      {stats.funnel.map((stage, index) => (
        <li key={stage.stage}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span>{stage.label}</span>
            <span className="tabular shrink-0 text-[var(--foreground-muted)]">
              {stage.count}
              {index > 0 ? (
                <>
                  {" · "}
                  {percent(stage.conversion_from_previous_percent)} from prev
                  {stage.drop_off_from_previous > 0 ? (
                    <span className="text-rose-600">
                      {" "}
                      (−{stage.drop_off_from_previous})
                    </span>
                  ) : null}
                </>
              ) : null}
            </span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[var(--surface-muted)]">
            <div
              className="h-full rounded-full bg-[var(--accent)]"
              style={{ width: top > 0 ? `${(stage.count / top) * 100}%` : "0%" }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function StateBars({ stats }: { stats: DashboardStats }) {
  const data = stats.applications_by_state.slice(0, 8);

  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--foreground-muted)]">
        No applications in this window.
      </p>
    );
  }

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="state" tick={{ fontSize: 11 }} stroke="var(--foreground-muted)" />
          <YAxis tick={{ fontSize: 11 }} stroke="var(--foreground-muted)" allowDecimals={false} />
          <Tooltip
            cursor={{ fill: "var(--surface-muted)" }}
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
          <Bar dataKey="count" fill="var(--accent)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function SourcePie({ stats }: { stats: DashboardStats }) {
  const data = stats.traffic_sources.slice(0, 6);

  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-[var(--foreground-muted)]">
        No applications in this window.
      </p>
    );
  }

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="count"
            nameKey="source"
            innerRadius={40}
            outerRadius={70}
            paddingAngle={2}
          >
            {data.map((entry, index) => (
              <Cell
                key={entry.source}
                fill={CATEGORICAL[index % CATEGORICAL.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              fontSize: 12,
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {data.map((entry, index) => (
          <li key={entry.source} className="flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: CATEGORICAL[index % CATEGORICAL.length] }}
            />
            {entry.source} ({entry.count})
          </li>
        ))}
      </ul>
    </div>
  );
}
