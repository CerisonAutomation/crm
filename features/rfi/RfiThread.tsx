"use client";

/**
 * RFI thread UI (ADR-005) — one surface, two viewers.
 *
 * Staff (viewer="staff") ask, follow-up, note, close and escalate; the client
 * (viewer="client") answers in-portal. Every turn renders with author, role
 * and timestamp; breached SLAs show the overdue hours so the chase has a
 * number, not a vibe. All traffic goes through the typed api client.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  MessageCircleQuestion,
  Paperclip,
  X,
} from "lucide-react";
import { api, get, patch, post } from "@/lib/api-client";
import { prepareUpload } from "@/lib/upload-image";
import { cn } from "@/lib/utils";
import type { RfiThread, RfiTurn } from "@/lib/domain/rfi";
import {
  buildAnswerWithEvidence,
  receiptLine,
  type EvidenceReceipt,
} from "@/lib/domain/rfi-evidence";

type Viewer = "staff" | "client";

const STATUS_STYLE: Record<string, string> = {
  OPEN: "bg-sky/15 text-sky border-sky/30",
  ANSWERED: "bg-gold/15 text-gold border-gold/30",
  ESCALATED: "bg-destructive/10 text-destructive border-destructive/30",
  CLOSED: "bg-muted text-muted-foreground border-border",
};

function overdueHours(thread: RfiThread, now: number): number {
  if (thread.status !== "OPEN" || !thread.slaDueAt) return 0;
  const ms = now - new Date(thread.slaDueAt).getTime();
  return ms > 0 ? Math.floor(ms / 3600000) : 0;
}

export function RfiThreadView({
  thread,
  viewer,
  onChanged,
}: {
  thread: RfiThread;
  viewer: Viewer;
  onChanged: (next: RfiThread) => void;
}) {
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Client-side evidence receipts for this answer (C11): uploaded through
  // api.uploadDocument against the linked documentRequestId, rendered inline.
  const [receipts, setReceipts] = useState<EvidenceReceipt[]>([]);
  const now = useMemo(() => Date.now(), [thread]);
  const overdue = overdueHours(thread, now);
  const closed = thread.status === "CLOSED";
  const staff = viewer === "staff";
  const canAnswer =
    !closed &&
    (staff || thread.status === "OPEN" || thread.status === "ESCALATED");
  const canAttach = !staff && !closed && !!thread.documentRequestId;
  const answerReady =
    draft.trim().length >= 2 || (!staff && receipts.length > 0);

  const submitTurn = useCallback(
    async (kind: "QUESTION" | "ANSWER" | "NOTE") => {
      const body =
        kind === "ANSWER" && !staff
          ? buildAnswerWithEvidence(draft, receipts)
          : draft.trim();
      if (body.length < 2 || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await post<{ thread: RfiThread }>(
          "/api/cases/" + thread.caseId + "/rfi/" + thread.id,
          { kind, body }
        );
        onChanged(res.thread);
        setDraft("");
        if (kind === "ANSWER") setReceipts([]);
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "Could not send — try again."
        );
      } finally {
        setBusy(false);
      }
    },
    [draft, receipts, busy, staff, thread.caseId, thread.id, onChanged]
  );

  const act = useCallback(
    async (action: "close" | "escalate") => {
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await patch<{ thread: RfiThread }>(
          "/api/cases/" + thread.caseId + "/rfi/" + thread.id,
          { action }
        );
        onChanged(res.thread);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Action failed — try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy, thread.caseId, thread.id, onChanged]
  );

  return (
    <article
      className="rounded-lg border border-border bg-card p-4"
      aria-label={"RFI thread: " + thread.subject}
    >
      <div className="flex flex-wrap items-center gap-2">
        <MessageCircleQuestion className="h-4 w-4 text-sky" aria-hidden />
        <h3 className="text-sm font-semibold text-cobble-ink">
          {thread.subject}
        </h3>
        <span
          className={cn(
            "ml-auto rounded-full border px-2 py-0.5 text-[11px] font-semibold",
            STATUS_STYLE[thread.status]
          )}
        >
          {thread.status}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {thread.slaDueAt && !closed ? (
          <span
            className={cn(
              "inline-flex items-center gap-1",
              overdue > 0 && "font-semibold text-destructive"
            )}
          >
            {overdue > 0 ? (
              <AlertTriangle className="h-3 w-3" aria-hidden />
            ) : (
              <Clock3 className="h-3 w-3" aria-hidden />
            )}
            {overdue > 0
              ? "SLA breached by " + String(overdue) + "h"
              : "Answer due " +
                format(new Date(thread.slaDueAt), "d MMM, HH:mm")}
          </span>
        ) : null}
        {thread.documentRequestId ? (
          <span title={thread.documentRequestId}>
            Linked request
            {canAttach || staff
              ? ": upload-it-here — fulfilment stays with your case team"
              : ""}
          </span>
        ) : null}
      </div>

      <div className="mt-3 space-y-2">
        {thread.turns.map((t) => (
          <TurnRow key={t.id} turn={t} />
        ))}
      </div>

      {canAnswer ? (
        <div className="mt-3">
          <label
            className="text-xs font-medium text-muted-foreground"
            htmlFor={"composer-" + thread.id}
          >
            {staff
              ? "Ask a follow-up, answer, or leave a staff note"
              : "Your answer"}
          </label>
          <textarea
            id={"composer-" + thread.id}
            className="mt-1 min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              staff ? "Type a question, answer or note…" : "Type your answer…"
            }
          />
          {error ? (
            <p className="mt-1 text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {canAttach && thread.documentRequestId ? (
            <EvidenceAttach
              requestId={thread.documentRequestId}
              receipts={receipts}
              onReceipt={(r) =>
                setReceipts((prev) =>
                  prev.some((p) => p.documentId === r.documentId)
                    ? prev
                    : [...prev, r]
                )
              }
              onRemove={(id) =>
                setReceipts((prev) => prev.filter((p) => p.documentId !== id))
              }
            />
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2">
            {staff ? (
              <button
                type="button"
                disabled={busy || draft.trim().length < 2}
                onClick={() => void submitTurn("QUESTION")}
                className="rounded-md bg-cobble px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                Ask follow-up
              </button>
            ) : null}
            <button
              type="button"
              disabled={busy || !answerReady}
              onClick={() => void submitTurn("ANSWER")}
              className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            >
              {staff ? "Answer on behalf" : "Send answer"}
            </button>
            {staff && !closed ? (
              <button
                type="button"
                disabled={busy || draft.trim().length < 2}
                onClick={() => void submitTurn("NOTE")}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              >
                Staff note
              </button>
            ) : null}
            {staff && !closed ? (
              <span className="ml-auto inline-flex gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("escalate")}
                  className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-semibold text-destructive disabled:opacity-50"
                >
                  Escalate
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void act("close")}
                  className="inline-flex items-center gap-1 rounded-md border border-olive/40 px-3 py-1.5 text-xs font-semibold text-olive disabled:opacity-50"
                >
                  <CheckCircle2 className="h-3 w-3" aria-hidden /> Close
                </button>
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function RfiThreadPanel({
  caseId,
  viewer,
}: {
  caseId: string;
  viewer: Viewer;
}) {
  const [threads, setThreads] = useState<RfiThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [question, setQuestion] = useState("");
  const [opening, setOpening] = useState(false);
  const staff = viewer === "staff";

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await get<{ threads: RfiThread[] }>(
        "/api/cases/" + caseId + "/rfi"
      );
      setThreads(res.threads);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load RFI threads.");
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const openThread = useCallback(async () => {
    if (subject.trim().length === 0 || question.trim().length < 10 || opening)
      return;
    setOpening(true);
    setError(null);
    try {
      const res = await post<{ thread: RfiThread }>(
        "/api/cases/" + caseId + "/rfi",
        {
          subject: subject.trim(),
          body: question.trim(),
        }
      );
      setThreads((prev) => [res.thread, ...prev]);
      setSubject("");
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the thread.");
    } finally {
      setOpening(false);
    }
  }, [subject, question, opening, caseId]);

  const replaceThread = useCallback((next: RfiThread) => {
    setThreads((prev) => prev.map((t) => (t.id === next.id ? next : t)));
  }, []);

  if (loading)
    return <p className="text-sm text-muted-foreground">Loading questions…</p>;

  return (
    <section aria-label="RFI threads" className="space-y-3">
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {staff ? (
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-semibold text-cobble-ink">
            Ask the client
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Opens a thread with a 48-hour answer clock. Every turn is
            audit-logged.
          </p>
          <input
            className="mt-2 w-full rounded-md border border-border bg-background p-2 text-sm"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject — e.g. Bank statement for March"
            aria-label="Thread subject"
          />
          <textarea
            className="mt-2 min-h-20 w-full rounded-md border border-border bg-background p-2 text-sm"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="The question — be specific about what you need and why…"
            aria-label="Opening question"
          />
          <button
            type="button"
            disabled={
              opening ||
              subject.trim().length === 0 ||
              question.trim().length < 10
            }
            onClick={() => void openThread()}
            className="mt-2 rounded-md bg-cobble px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {opening ? "Opening…" : "Open thread"}
          </button>
        </div>
      ) : null}
      {threads.length === 0 && !staff ? (
        <p className="rounded-md border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No questions from your case team right now.
        </p>
      ) : null}
      {threads.map((t) => (
        <RfiThreadView
          key={t.id}
          thread={t}
          viewer={viewer}
          onChanged={replaceThread}
        />
      ))}
    </section>
  );
}

const EVIDENCE_MAX_BYTES = 15 * 1024 * 1024;

/**
 * Answer-with-evidence attach (client composer, FS-10 safe).
 *
 * Uploads through `api.uploadDocument` with the thread's linked
 * `documentRequestId`, so the file lands on the request as evidence. The
 * request itself is never fulfilled from here — fulfilment stays staff-side
 * (the desk reviews and decides per FS-9/FS-10). Each completed upload
 * yields a receipt rendered inline; receipts travel inside the answer body
 * via `buildAnswerWithEvidence`.
 */
function EvidenceAttach({
  requestId,
  receipts,
  onReceipt,
  onRemove,
}: {
  requestId: string;
  receipts: EvidenceReceipt[];
  onReceipt: (r: EvidenceReceipt) => void;
  onRemove: (documentId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Resolve the linked request's docType so the upload carries the right
  // document type (the upload route validates against DOC_TYPES).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { case: c } = await api.myCase();
        if (!alive) return;
        const match = c?.requests.find((r) => r.id === requestId);
        setDocType(match ? match.docType : "OTHER");
      } catch {
        if (alive) setDocType("OTHER");
      }
    })();
    return () => {
      alive = false;
    };
  }, [requestId]);

  async function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || busy) return;
    if (file.size > EVIDENCE_MAX_BYTES) {
      setProblem("That file is over 15 MB — try a smaller scan or photo.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const prepared = await prepareUpload(file);
      const res = await api.uploadDocument({
        type: docType ?? "OTHER",
        fileName: prepared.fileName,
        mimeType: prepared.mimeType,
        dataBase64: prepared.dataBase64,
        requestId,
      });
      onReceipt({
        documentId: res.document.id,
        fileName: prepared.fileName,
        status: res.document.status,
        requestId,
        uploadedAt: new Date().toISOString(),
      });
    } catch (err) {
      setProblem(
        err instanceof Error ? err.message : "Upload failed — try again."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-md border border-dashed border-border bg-muted/30 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,.pdf"
          className="sr-only"
          aria-label="Attach evidence for this answer"
          onChange={(e) => void onChange(e)}
        />
        <button
          type="button"
          disabled={busy || !docType}
          onClick={() => inputRef.current?.click()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden />
          {busy
            ? "Uploading…"
            : receipts.length > 0
            ? "Attach another"
            : "Attach evidence"}
        </button>
        <span className="text-[11px] text-muted-foreground">
          Images or PDF, up to 15 MB. Your case team reviews and fulfils the
          request.
        </span>
      </div>
      {problem ? (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          {problem}
        </p>
      ) : null}
      {receipts.length > 0 ? (
        <ul className="mt-2 space-y-1" aria-label="Attached evidence">
          {receipts.map((r) => (
            <li
              key={r.documentId}
              className="flex items-center gap-2 rounded border border-olive/30 bg-olive/5 px-2 py-1 text-xs text-cobble-ink"
            >
              <CheckCircle2
                className="h-3.5 w-3.5 shrink-0 text-olive"
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate" title={receiptLine(r)}>
                {r.fileName} · {r.status}
              </span>
              <button
                type="button"
                onClick={() => onRemove(r.documentId)}
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-destructive"
                aria-label={"Remove " + r.fileName}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TurnRow({ turn }: { turn: RfiTurn }) {
  const question = turn.kind === "QUESTION";
  const system = turn.kind === "SYSTEM";
  return (
    <div
      className={cn(
        "rounded-md border p-3",
        system
          ? "border-dashed border-border bg-muted/40"
          : "border-border bg-card",
        question && "border-l-4 border-l-sky"
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {turn.kind === "QUESTION"
          ? "Question"
          : turn.kind === "ANSWER"
          ? "Answer"
          : turn.kind === "NOTE"
          ? "Staff note"
          : "Record"}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm text-cobble-ink">
        {turn.body}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {turn.authorLabel}
        {turn.authorRole ? " · " + turn.authorRole : ""} ·{" "}
        <time dateTime={turn.createdAt}>
          {format(new Date(turn.createdAt), "d MMM yyyy, HH:mm")}
        </time>
      </p>
    </div>
  );
}
