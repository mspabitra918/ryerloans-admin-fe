"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { BadgeCheck, Ban, Loader2, ShieldAlert } from "lucide-react";

import { api, ApiError } from "@/lib/api";
import { can } from "@/lib/auth";
import { useSession } from "@/components/shell/SessionProvider";
import { when } from "@/lib/format";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, ErrorState, Spinner } from "@/components/ui/States";
import type {
  ReviewFilter,
  ReviewModerationOptions,
  ReviewModerationView,
} from "@/lib/types";

const TABS: Array<{ value: ReviewFilter; label: string }> = [
  { value: "pending", label: "Awaiting moderation" },
  { value: "published", label: "Published" },
  { value: "rejected", label: "Rejected" },
  { value: "all", label: "All" },
];

const STATE_TONE: Record<string, string> = {
  invited: "bg-slate-100 text-slate-700 ring-slate-300",
  submitted: "bg-amber-100 text-amber-800 ring-amber-300",
  published: "bg-emerald-100 text-emerald-800 ring-emerald-300",
  rejected: "bg-rose-100 text-rose-800 ring-rose-300",
};

/**
 * §11 step 3 — the moderation queue.
 *
 * Two things this screen deliberately cannot do. There is no field to edit a
 * review: the FTC rule covers altered reviews as well as fabricated ones, so
 * the only decisions here are publish and reject. And rejecting requires
 * picking a reason, because a review buried without one is indistinguishable
 * from a review buried for being unflattering.
 *
 * Listing is open to every signed-in role — §8.1 puts `view` on all five lines
 * — while the two buttons follow `moderateReviews`, which is super_admin's
 * alone. The route guard re-checks both.
 */
export function ReviewsView() {
  const { admin } = useSession();
  const mayModerate = can.moderateReviews(admin?.role);

  const [filter, setFilter] = useState<ReviewFilter>("pending");
  const [rows, setRows] = useState<ReviewModerationView[]>([]);
  const [options, setOptions] = useState<ReviewModerationOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<ReviewModerationView | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await api.reviews(filter);
      setRows(result.rows);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load the review queue.",
      );
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .reviewOptions()
      .then(setOptions)
      .catch(() => undefined);
  }, []);

  async function publish(review: ReviewModerationView) {
    try {
      await api.moderateReview(review.id, { approve: true });
      toast.success("Review published", {
        description: `It is now live on /reviews as ${review.display_name}.`,
      });
      void load();
    } catch (caught) {
      toast.error(
        caught instanceof ApiError ? caught.message : "Could not publish.",
      );
    }
  }

  return (
    <div className="space-y-4">
      <header className="card p-4">
        <h1 className="text-base font-semibold">Borrower reviews</h1>

        <p className="mt-1 text-sm text-[var(--foreground-muted)]">
          Every review here came from a borrower with a funded loan, submitted
          through a single-use link. Published reviews appear on{" "}
          <span className="font-mono">/reviews</span> with a &ldquo;Verified
          borrower&rdquo; badge, exactly as written — reviews are never edited.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilter(tab.value)}
              aria-pressed={filter === tab.value}
              className={`btn ${
                filter === tab.value ? "btn-primary" : "btn-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </header>

      {loading ? (
        <Spinner label="Loading reviews…" />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : rows.length === 0 ? (
        <EmptyState
          message={
            filter === "pending"
              ? "Nothing is waiting for moderation."
              : "No reviews in this list yet."
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((review) => (
            <li key={review.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-lg tracking-wide text-amber-500">
                  {"★".repeat(review.rating ?? 0)}
                  <span className="text-[var(--border)]">
                    {"★".repeat(5 - (review.rating ?? 0))}
                  </span>
                </span>

                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${
                    STATE_TONE[review.state]
                  }`}
                >
                  {review.state}
                </span>

                <Link
                  href={`/applications/${review.reference}`}
                  className="font-mono text-sm text-[var(--accent-strong)] hover:underline"
                >
                  {review.reference}
                </Link>

                <span className="text-xs text-[var(--foreground-muted)]">
                  submitted {when(review.submitted_at)}
                </span>
              </div>

              <p className="mt-3 whitespace-pre-line text-sm">
                {review.review_text ?? "—"}
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--foreground-muted)]">
                <span>
                  Publishes as{" "}
                  <strong className="text-[var(--foreground)]">
                    {review.display_name ?? "—"}
                  </strong>
                </span>

                {review.moderation_reason ? (
                  <span>Rejected: {review.moderation_reason}</span>
                ) : null}

                {review.moderated_at ? (
                  <span>Decided {when(review.moderated_at)}</span>
                ) : null}
              </div>

              {!review.consent_to_publish ? (
                <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-900 ring-1 ring-amber-200">
                  <ShieldAlert
                    size={14}
                    className="mt-0.5 shrink-0"
                    aria-hidden
                  />
                  This borrower did not consent to public display. The review is
                  internal feedback only and cannot be published.
                </p>
              ) : null}

              {mayModerate && review.state === "submitted" ? (
                <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!review.consent_to_publish}
                    onClick={() => void publish(review)}
                  >
                    <BadgeCheck size={15} aria-hidden />
                    Publish
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setRejecting(review)}
                  >
                    <Ban size={15} aria-hidden />
                    Reject
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {rejecting ? (
        <RejectModal
          review={rejecting}
          reasons={options?.rejection_reasons ?? []}
          onClose={() => setRejecting(null)}
          onDone={() => {
            setRejecting(null);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * §11: "Rejection requires a logged reason". The reason list is closed and
 * comes from the API, so the portal cannot invent a category the audit trail
 * has no name for.
 */
function RejectModal({
  review,
  reasons,
  onClose,
  onDone,
}: {
  review: ReviewModerationView;
  reasons: Array<{ value: string; label: string }>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!reason) return;

    setBusy(true);
    setError(null);

    try {
      await api.moderateReview(review.id, { approve: false, reason });
      toast.success("Review rejected", {
        description:
          "It will not appear on the public site. The reason is logged.",
      });
      onDone();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not reject.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={`Reject the review on ${review.reference}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={!reason || busy}
            onClick={() => void submit()}
          >
            {busy ? (
              <Loader2 size={15} className="animate-spin" aria-hidden />
            ) : null}
            Reject review
          </button>
        </>
      }
    >
      <p className="text-sm text-[var(--foreground-muted)]">
        Rejecting hides this review from the public site permanently. Pick the
        reason — it is written to the audit log against your account.
      </p>

      <div className="mt-4 space-y-2">
        {reasons.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
              reason === option.value
                ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                : "border-[var(--border)]"
            }`}
          >
            <input
              type="radio"
              name="reason"
              value={option.value}
              checked={reason === option.value}
              onChange={() => setReason(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>

      <p className="mt-4 rounded-lg bg-[var(--surface-muted)] p-3 text-xs text-[var(--foreground-muted)]">
        A review may not be rejected for being unflattering. If it is accurate
        and on-topic, it goes up.
      </p>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-rose-600">
          {error}
        </p>
      ) : null}
    </Modal>
  );
}
