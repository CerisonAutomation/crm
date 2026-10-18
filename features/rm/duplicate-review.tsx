"use client";
/**
 * Duplicate review queue (party merge slice) — RM review surface.
 *
 * Read-only for the desk: the queue, scores and review state render for any
 * role that can read cases. Confirm / dismiss / merge need "party.merge"
 * (SENIOR_ONLY) — the buttons below only render for SENIOR_RM and ADMIN.
 * Four-eyes lives server-side (reporter vs actor, mandatory reasons); this
 * surface mirrors that state so a blocked action is never a surprise:
 * who reported, who confirmed, and who would execute.
 *
 * Copy note: merge-specific strings are English literals until rmq.merge*
 * dictionary keys land (only common.* keys are reused via t()).
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { useApp } from "@/lib/store";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Eyebrow,
  SectionTitle,
  Spinner,
  EmptyState,
  StatusBadge,
} from "@/components/brand/ui";
import { GitMerge, ShieldCheck, RefreshCw, ChevronDown } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type PartyMini = {
  id: string;
  name: string;
  email: string | null;
  company: string | null;
  status: string;
} | null;

type Candidate = {
  id: string;
  partyId: string;
  candidatePartyId: string;
  score: number;
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  survivor: PartyMini;
  candidate: PartyMini;
};

function partyName(p: PartyMini, fallback: string): string {
  if (!p) return fallback;
  return p.company ? p.name + " · " + p.company : p.name;
}

function shortId(id: string | null): string {
  if (!id) return "—";
  return id.length > 12 ? id.slice(0, 8) + "…" : id;
}

export function DuplicateReviewSection() {
  const { t } = useI18n();
  const session = useApp((s) => s.session);
  const role = session?.role ?? null;
  const me = session?.id ?? null;
  const canMerge = role === "SENIOR_RM" || role === "ADMIN";
  const [rows, setRows] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{
    c: Candidate;
    decision: "CONFIRM" | "DISMISS";
  } | null>(null);
  const [reason, setReason] = useState("");
  const [merge, setMerge] = useState<Candidate | null>(null);
  const [survivorId, setSurvivorId] = useState<string | null>(null);
  const [mergeReason, setMergeReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{
    fills: Record<string, string | null>;
    identities: number;
    conversations: number;
  } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [restore, setRestore] = useState<Candidate | null>(null);
  const [record, setRecord] = useState<{
    performedBy: string | null;
    confirmerId: string | null;
    absorbedName: string;
    moves: number;
  } | null>(null);
  const [restoreReason, setRestoreReason] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.listPartyDuplicates();
      setRows(res.candidates);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The review queue could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Preview: project the merge outcome whenever the dialog opens or the
  // survivor pick changes. Read-only route, no writes.
  useEffect(() => {
    if (!merge || !survivorId) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let live = true;
    setPreview(null);
    setPreviewError(null);
    api
      .getMergePreview(
        merge.id,
        survivorId,
        merge.partyId === survivorId ? merge.candidatePartyId : merge.partyId
      )
      .then((res) => {
        if (live)
          setPreview({
            fills: res.plan.fieldFills,
            identities: res.absorbedExternalIdentities,
            conversations: res.absorbedConversations,
          });
      })
      .catch((e: unknown) => {
        if (live)
          setPreviewError(
            e instanceof Error ? e.message : "Preview unavailable."
          );
      });
    return () => {
      live = false;
    };
  }, [merge, survivorId]);

  // Restore record: four-eyes state for the confirm screen.
  useEffect(() => {
    if (!restore) {
      setRecord(null);
      return;
    }
    let live = true;
    setRecord(null);
    api
      .getMergeRestore(restore.id)
      .then((res) => {
        if (!live) return;
        const moves =
          (res.record.movedExternalIdentityIds?.length ?? 0) +
          (res.record.movedConversationIds?.length ?? 0);
        setRecord({
          performedBy: res.record.performedBy,
          confirmerId: res.record.confirmerId,
          absorbedName:
            res.record.absorbedSnapshot?.name ?? restore.candidatePartyId,
          moves,
        });
      })
      .catch(() => {
        if (live) setRecord(null);
      });
    return () => {
      live = false;
    };
  }, [restore]);

  async function submitRestore() {
    if (!restore || busy || restoreReason.trim().length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.restorePartyMerge(restore.id, { reason: restoreReason.trim() });
      setRestore(null);
      setRestoreReason("");
      setNotice("Merge reversed — the absorbed party is active again.");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReview() {
    if (!review || busy) return;
    if (review.decision === "DISMISS" && reason.trim().length === 0) return;
    setBusy(true);
    setNotice(null);
    try {
      await api.reviewPartyDuplicate(review.c.id, {
        decision: review.decision,
        reason: reason.trim() || undefined,
      });
      setReview(null);
      setReason("");
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Review failed.");
    } finally {
      setBusy(false);
    }
  }

  async function submitMerge() {
    if (!merge || busy || !survivorId) return;
    if (mergeReason.trim().length === 0) return;
    const absorbedId =
      survivorId === merge.partyId ? merge.candidatePartyId : merge.partyId;
    setBusy(true);
    setNotice(null);
    try {
      const res = await api.executePartyMerge(merge.id, {
        survivorId,
        absorbedId,
        reason: mergeReason.trim(),
      });
      setMerge(null);
      setMergeReason("");
      setNotice(
        res.deduped
          ? "Already merged — earlier receipt returned, nothing moved twice."
          : "Merged. History preserved in the ledger."
      );
      await load();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Merge failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Duplicate review" className="mt-8">
      <Eyebrow>Data quality</Eyebrow>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle as="h2">Duplicate review</SectionTitle>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Refresh
        </Button>
      </div>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        Possible duplicate parties, highest score first. Confirming or
        dismissing, and merging, need a second senior — reporters, confirmers
        and executors must all differ.
      </p>
      {notice && (
        <p
          className="mt-3 rounded-md border border-gold/40 bg-gold/5 px-3 py-2 text-sm text-iron-ink"
          role="status"
        >
          {notice}
        </p>
      )}
      {loading ? (
        <div
          className="mt-4 flex items-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Spinner className="h-4 w-4" /> Loading the review queue…
        </div>
      ) : error ? (
        <p className="mt-4 text-sm text-danger-ink" role="alert">
          {error}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          className="mt-4"
          title="No duplicate candidates"
          hint="The detection sweep has not queued any party pairs for review."
        />
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((c) => {
            const pct = Math.round(c.score * 100);
            const confirmed = c.status === "CONFIRMED";
            return (
              <li
                key={c.id}
                className="rounded-md border border-border bg-card p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = new Set(prev);
                          if (next.has(c.id)) next.delete(c.id);
                          else next.add(c.id);
                          return next;
                        })
                      }
                      aria-expanded={expanded.has(c.id)}
                      aria-label="Pair detail"
                      className="flex w-full items-center gap-2 rounded text-left hover:bg-muted/20"
                    >
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                          expanded.has(c.id) && "rotate-180"
                        )}
                      />
                      <span className="font-medium text-cobble-ink">
                        {partyName(c.survivor, c.partyId)}
                        <span
                          className="mx-2 text-muted-foreground"
                          aria-hidden="true"
                        >
                          ≈
                        </span>
                        {partyName(c.candidate, c.candidatePartyId)}
                      </span>
                    </button>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <StatusBadge
                        status={
                          c.status === "PENDING"
                            ? "Pending review"
                            : c.status === "CONFIRMED"
                            ? "Confirmed"
                            : "Dismissed"
                        }
                        tone={
                          c.status === "PENDING"
                            ? "amber"
                            : c.status === "CONFIRMED"
                            ? "green"
                            : "neutral"
                        }
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            tabIndex={0}
                            aria-label={`Match score ${pct} percent from email, phone and name signals`}
                            className="tabular-nums rounded outline-none focus-visible:ring-2 focus-visible:ring-gold"
                          >
                            {pct}% match
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="max-w-60 text-xs">
                            Weighted email, phone and name signals from the
                            detection sweep. Confirm only after checking both
                            parties.
                          </p>
                        </TooltipContent>
                      </Tooltip>
                      <span>Reported by system detection</span>
                      {c.reviewedBy && (
                        <span>Confirmed by {shortId(c.reviewedBy)}</span>
                      )}
                    </p>
                    {expanded.has(c.id) && (
                      <dl className="mt-2 grid gap-x-6 gap-y-1 rounded-md bg-muted/30 p-3 text-xs text-muted-foreground sm:grid-cols-2">
                        <div className="flex justify-between gap-2">
                          <dt>Pair</dt>
                          <dd className="font-mono">
                            {c.partyId} ≈ {c.candidatePartyId}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>Score</dt>
                          <dd className="tabular-nums">{pct}%</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>Reporter</dt>
                          <dd>system detection</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt>Reviewed by</dt>
                          <dd className="font-mono">{c.reviewedBy ?? "—"}</dd>
                        </div>
                      </dl>
                    )}
                  </div>
                  {canMerge && c.status === "PENDING" && (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setReview({ c, decision: "CONFIRM" });
                          setReason("");
                        }}
                      >
                        Confirm
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setReview({ c, decision: "DISMISS" });
                          setReason("");
                        }}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                  {canMerge && confirmed && (
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setRestore(c);
                          setRestoreReason("");
                        }}
                      >
                        Restore…
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          setMerge(c);
                          setSurvivorId(c.partyId);
                          setMergeReason("");
                          setPreview(null);
                        }}
                      >
                        <GitMerge className="h-3.5 w-3.5" aria-hidden="true" />
                        Merge…
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Review dialog — dismiss needs a reason note, confirm keeps it optional. */}
      <Dialog
        open={review !== null}
        onOpenChange={(o) => {
          if (!o) setReview(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {review?.decision === "DISMISS"
                ? "Dismiss duplicate candidate"
                : "Confirm duplicate candidate"}
            </DialogTitle>
            <DialogDescription>
              {review?.decision === "DISMISS"
                ? "A dismissal needs a reason note — it becomes part of the audit trail."
                : "Confirming queues the pair for merging. Merging itself needs a different senior."}
            </DialogDescription>
          </DialogHeader>
          <label
            htmlFor="dup-review-reason"
            className="text-sm font-medium text-iron-ink"
          >
            Reason
            {review?.decision === "DISMISS" ? " (required)" : " (optional)"}
          </label>
          <Textarea
            id="dup-review-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Why is this pair (not) a duplicate?"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setReview(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void submitReview()}
              disabled={
                busy ||
                (review?.decision === "DISMISS" && reason.trim().length === 0)
              }
            >
              {t("common.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge dialog — survivor picker, four-eyes state, mandatory reason. */}
      <Dialog
        open={merge !== null}
        onOpenChange={(o) => {
          if (!o) setMerge(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge duplicate parties</DialogTitle>
            <DialogDescription>
              The survivor keeps every conflicting field; the absorbed party
              only fills gaps, then is tombstoned — never deleted.
            </DialogDescription>
          </DialogHeader>
          {merge && (
            <div className="space-y-4">
              <div
                className="grid gap-2"
                role="radiogroup"
                aria-label="Surviving party"
              >
                {[
                  { id: merge.partyId, p: merge.survivor },
                  { id: merge.candidatePartyId, p: merge.candidate },
                ].map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    role="radio"
                    aria-checked={survivorId === o.id}
                    onClick={() => setSurvivorId(o.id)}
                    className={cn(
                      "flex min-h-11 items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-sm",
                      survivorId === o.id
                        ? "border-gold bg-gold/5 font-medium text-cobble-ink"
                        : "border-border text-iron-ink hover:border-gold/40"
                    )}
                  >
                    <span className="min-w-0 truncate">
                      {partyName(o.p, o.id)}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {survivorId === o.id ? "Survivor" : "Absorbed"}
                    </span>
                  </button>
                ))}
              </div>
              <div
                className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-iron-ink"
                aria-live="polite"
              >
                <p className="font-medium text-cobble-ink">Projected outcome</p>
                {previewError ? (
                  <p className="mt-1.5 text-danger-ink">{previewError}</p>
                ) : !preview ? (
                  <p className="mt-1.5 flex items-center gap-2 text-muted-foreground">
                    <Spinner className="h-3.5 w-3.5" /> Computing projection…
                  </p>
                ) : (
                  <div className="mt-1.5 space-y-1">
                    {Object.keys(preview.fills).length === 0 ? (
                      <p>
                        No field changes — the survivor already holds every
                        value.
                      </p>
                    ) : (
                      <p>
                        Absorbed fills gaps:{" "}
                        {Object.keys(preview.fills).join(", ")}.
                      </p>
                    )}
                    <p>
                      {preview.identities} external identities and{" "}
                      {preview.conversations} conversations move to the
                      survivor; the absorbed party is tombstoned, never deleted.
                    </p>
                  </div>
                )}
              </div>
              <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-iron-ink">
                <p className="flex items-center gap-1.5 font-medium text-cobble-ink">
                  <ShieldCheck
                    className="h-3.5 w-3.5 text-gold-ink"
                    aria-hidden="true"
                  />
                  Four-eyes state
                </p>
                <p className="mt-1.5">
                  Reported by system detection · Confirmed by{" "}
                  {shortId(merge.reviewedBy)} · Executor is you.
                </p>
                {me !== null && merge.reviewedBy === me ? (
                  <p
                    className="mt-1.5 font-medium text-danger-ink"
                    role="alert"
                  >
                    You confirmed this pair — a different senior must execute
                    the merge.
                  </p>
                ) : (
                  <p className="mt-1.5 text-muted-foreground">
                    You did not confirm this pair, so you may execute it once a
                    reason is recorded.
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="dup-merge-reason"
                  className="text-sm font-medium text-iron-ink"
                >
                  Reason (required)
                </label>
                <Textarea
                  id="dup-merge-reason"
                  value={mergeReason}
                  onChange={(e) => setMergeReason(e.target.value)}
                  rows={3}
                  placeholder="Why is this the right merge?"
                  className="mt-1.5"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMerge(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void submitMerge()}
              disabled={
                busy ||
                !survivorId ||
                mergeReason.trim().length === 0 ||
                (me !== null && merge !== null && merge.reviewedBy === me)
              }
            >
              Merge parties
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Restore dialog — reverse a merge, strict four-eyes, mandatory reason. */}
      <Dialog
        open={restore !== null}
        onOpenChange={(o) => {
          if (!o) setRestore(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reverse merge</DialogTitle>
            <DialogDescription>
              The absorbed party returns to active, filled fields roll back,
              moved relations go home. Nothing is deleted at any step.
            </DialogDescription>
          </DialogHeader>
          {restore && !record && (
            <p
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <Spinner className="h-4 w-4" /> Loading the merge record…
            </p>
          )}
          {restore && record && (
            <div className="space-y-4">
              <div className="rounded-md border border-border/70 bg-muted/30 p-3 text-xs leading-relaxed text-iron-ink">
                <p className="flex items-center gap-1.5 font-medium text-cobble-ink">
                  <ShieldCheck
                    className="h-3.5 w-3.5 text-gold-ink"
                    aria-hidden="true"
                  />
                  Four-eyes state
                </p>
                <p className="mt-1.5">
                  Restores {record.absorbedName} ({record.moves} relations move
                  back).
                </p>
                <p className="mt-1">
                  Merged by {shortId(record.performedBy)} · Confirmed by{" "}
                  {shortId(record.confirmerId)} · Reverser is you.
                </p>
                {me !== null &&
                (record.performedBy === me || record.confirmerId === me) ? (
                  <p
                    className="mt-1.5 font-medium text-danger-ink"
                    role="alert"
                  >
                    You performed or confirmed this merge — a different senior
                    must reverse it.
                  </p>
                ) : (
                  <p className="mt-1.5 text-muted-foreground">
                    You took no part in this merge, so you may reverse it once a
                    reason is recorded.
                  </p>
                )}
              </div>
              <div>
                <label
                  htmlFor="dup-restore-reason"
                  className="text-sm font-medium text-iron-ink"
                >
                  Reason (required)
                </label>
                <Textarea
                  id="dup-restore-reason"
                  value={restoreReason}
                  rows={3}
                  onChange={function (e) {
                    setRestoreReason(e.target.value);
                  }}
                  placeholder="Why must this merge be undone?"
                  className="mt-1.5"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRestore(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => void submitRestore()}
              disabled={
                busy ||
                !record ||
                restoreReason.trim().length === 0 ||
                (me !== null &&
                  (record.performedBy === me || record.confirmerId === me))
              }
            >
              Reverse merge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
