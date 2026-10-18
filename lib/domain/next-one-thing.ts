/**
 * Next-One-Thing — pure ranking for the client hero card.
 *
 * Ranks the single most pressing open item across RFI threads, document
 * requests and booking/follow-up gaps. Pure, Prisma-free: zero framework
 * imports, safe for client components, routes and unit specs alike.
 *
 * Priority order (client debt before staff debt):
 *   1. RFI with a breached SLA (most overdue first)
 *   2. Open RFI awaiting answer (earliest deadline first)
 *   3. Overdue document request (most overdue first)
 *   4. Open document request (earliest due date first)
 *   5. Booking / follow-up gap (as listed)
 *   6. All clear — nothing open.
 *
 * Each result carries a deep-link CTA (href + label) into the portal tab and
 * anchor that resolves it. ANSWERED threads are staff debt, never the
 * client's next thing.
 */

export interface NextRfi {
  id: string;
  subject: string;
  status: string;
  slaDueAt: string | null;
  overdueHours: number;
}

export interface NextDocRequest {
  id: string;
  title: string;
  status: string;
  dueDate: string | null;
}

export interface NextBookingGap {
  id: string;
  label: string;
  detail: string | null;
}

export type NextOneThingKind = "RFI" | "DOCUMENT" | "BOOKING" | "ALL_CLEAR";

export interface NextOneThing {
  kind: NextOneThingKind;
  refId: string | null;
  title: string;
  reason: string;
  cta: { href: string; label: string };
}

export interface NextOneThingInput {
  rfis: NextRfi[];
  requests: NextDocRequest[];
  gaps: NextBookingGap[];
}

function dueMs(value: string | null): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function overdueDays(dueDate: string | null, now: number): number {
  const ms = dueMs(dueDate);
  if (ms === null || ms > now) return 0;
  return Math.floor((now - ms) / 86_400_000);
}

/**
 * Rank the client's single next thing. Total function: empty input yields
 * ALL_CLEAR, ties break by stable id order so the hero card never flickers.
 */
export function rankNextOneThing(
  input: NextOneThingInput,
  now: Date = new Date()
): NextOneThing {
  const at = now.getTime();
  const openRfis = (input.rfis ?? []).filter(
    (r) => r.status === "OPEN" || r.status === "ESCALATED"
  );

  // 1 — breached SLA first, most overdue wins.
  const breached = openRfis
    .filter((r) => r.overdueHours > 0)
    .sort((a, b) => b.overdueHours - a.overdueHours || (a.id < b.id ? -1 : 1));
  if (breached.length > 0) {
    const top = breached[0];
    return {
      kind: "RFI",
      refId: top.id,
      title: top.subject,
      reason:
        top.overdueHours >= 24
          ? `Overdue by ${Math.floor(top.overdueHours / 24)}d ${
              top.overdueHours % 24
            }h — your case team is waiting`
          : `Overdue by ${top.overdueHours}h — your case team is waiting`,
      cta: { href: "#rfi-threads", label: "Answer now" },
    };
  }

  // 2 — open RFI, earliest deadline first (no deadline sorts last).
  const awaiting = [...openRfis].sort((a, b) => {
    const am = dueMs(a.slaDueAt);
    const bm = dueMs(b.slaDueAt);
    if (am === null && bm === null) return a.id < b.id ? -1 : 1;
    if (am === null) return 1;
    if (bm === null) return -1;
    return am - bm || (a.id < b.id ? -1 : 1);
  });
  if (awaiting.length > 0) {
    const top = awaiting[0];
    return {
      kind: "RFI",
      refId: top.id,
      title: top.subject,
      reason: top.slaDueAt
        ? `Answer due ${top.slaDueAt.slice(0, 10)}`
        : "Awaiting your answer",
      cta: { href: "#rfi-threads", label: "Answer now" },
    };
  }

  const openRequests = (input.requests ?? []).filter(
    (r) => r.status === "OPEN"
  );

  // 3 — overdue document request, most overdue first.
  const overdueReqs = openRequests
    .filter((r) => overdueDays(r.dueDate, at) > 0)
    .sort(
      (a, b) =>
        overdueDays(b.dueDate, at) - overdueDays(a.dueDate, at) ||
        (a.id < b.id ? -1 : 1)
    );
  if (overdueReqs.length > 0) {
    const top = overdueReqs[0];
    return {
      kind: "DOCUMENT",
      refId: top.id,
      title: top.title,
      reason: `Overdue by ${overdueDays(
        top.dueDate,
        at
      )}d — upload to keep your file moving`,
      cta: { href: "#requested-documents", label: "Upload now" },
    };
  }

  // 4 — open document request, earliest due date first.
  const pending = [...openRequests].sort((a, b) => {
    const am = dueMs(a.dueDate);
    const bm = dueMs(b.dueDate);
    if (am === null && bm === null) return a.id < b.id ? -1 : 1;
    if (am === null) return 1;
    if (bm === null) return -1;
    return am - bm || (a.id < b.id ? -1 : 1);
  });
  if (pending.length > 0) {
    const top = pending[0];
    return {
      kind: "DOCUMENT",
      refId: top.id,
      title: top.title,
      reason: top.dueDate
        ? `Due ${top.dueDate.slice(0, 10)}`
        : "Awaiting your upload",
      cta: { href: "#requested-documents", label: "Upload now" },
    };
  }

  // 5 — booking / follow-up gap, as listed.
  const gaps = input.gaps ?? [];
  if (gaps.length > 0) {
    const top = gaps[0];
    return {
      kind: "BOOKING",
      refId: top.id,
      title: top.label,
      reason: top.detail ?? "Needs scheduling",
      cta: { href: "#clx-panel-messages", label: "Arrange now" },
    };
  }

  // 6 — nothing open.
  return {
    kind: "ALL_CLEAR",
    refId: null,
    title: "You're all caught up",
    reason: "Nothing needs you right now — your case team has the file.",
    cta: { href: "#clx-progress", label: "View progress" },
  };
}
