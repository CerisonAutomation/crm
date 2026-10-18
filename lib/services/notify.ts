/**
 * Notification service — production channels with per-category control.
 *
 * Channels: in-app (always recorded), web push (VAPID), email (via the
 * configurable SMTP integration — ledger fallback when unset). Every user
 * controls channels per category (CASE / DOCUMENT / SYSTEM) plus quiet hours,
 * which hold BOTH the push and email channels (in-app is always available).
 * Failures degrade to the ledger; the caller's flow never breaks.
 */
import { db } from "@/lib/db";
import { sendPush } from "@/lib/adapters/push";
import { sendEmail } from "@/lib/integrations";
import { inQuietHours } from "@/lib/services/quiet-hours";
import type { ChannelSenders } from "@/lib/ports/notifications";
import { isFeatureEnabled } from "@/lib/settings/features";

export { inQuietHours };

export type NotifyCategory = "CASE" | "DOCUMENT" | "SYSTEM" | "TEAM";

export type NotifyInput = {
  userId: string;
  title: string;
  body: string;
  category?: NotifyCategory;
  caseId?: string;
};

type CategoryPref = { inApp: boolean; email: boolean; push: boolean };

function categoryPref(
  prefs: {
    inApp: boolean;
    email: boolean;
    push: boolean;
    categoryPrefs?: string | null;
  },
  category: NotifyCategory
): CategoryPref {
  if (prefs.categoryPrefs) {
    try {
      const parsed = JSON.parse(prefs.categoryPrefs) as Record<
        string,
        Partial<CategoryPref>
      >;
      const p = parsed[category];
      if (p)
        return {
          inApp: p.inApp ?? true,
          email: p.email ?? false,
          push: p.push ?? true,
        };
    } catch {
      /* fall through to defaults */
    }
  }
  return { inApp: prefs.inApp, email: prefs.email, push: prefs.push };
}

// `inQuietHours` now lives in the pure quiet-hours module (re-exported above).

/**
 * Daily notification cap per user — prevents notification fatigue.
 * A user may receive at most this many in-app notifications per UTC day.
 * Push and email are further gated by quiet hours and per-category prefs.
 */
export const DAILY_NOTIFICATION_CAP = 20;

/**
 * Count how many in-app notifications a user has already received today (UTC).
 * Used to enforce the daily cap before recording a new one.
 */
export function notificationsSentToday(userId: string): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  // DELIVERED only: SUPPRESSED cap markers are ledger, never quota.
  return db.notification.count({
    where: {
      userId,
      channel: "IN_APP",
      status: "DELIVERED",
      createdAt: { gte: start },
    },
  });
}

/**
 * Outbound push/email go through an injectable port (H2): production callers
 * use the default senders; tests and offline paths inject stubs or
 * offlineChannelSenders (H3). In-app recording always uses the database.
 */
export async function notifyUser(
  input: NotifyInput,
  channels: ChannelSenders = { sendPush, sendEmail }
) {
  const category = input.category ?? "CASE";
  const prefs = await db.notificationPreference.findUnique({
    where: { userId: input.userId },
  });

  // Daily cap — skip recording if the user has already hit the limit.
  // This prevents notification fatigue from automated fan-out (e.g. workflow
  // runs that emit many events for the same case).
  const sentToday = await notificationsSentToday(input.userId);
  if (sentToday >= DAILY_NOTIFICATION_CAP) {
    // P2-3: a cap drop is ledgered, never silent — one SUPPRESSED marker per
    // user per UTC day so the pause is observable in the tray and the audit
    // trail instead of vanishing.
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    const marker = await db.notification.findFirst({
      where: {
        userId: input.userId,
        status: "SUPPRESSED",
        createdAt: { gte: start },
      },
      select: { id: true },
    });
    if (!marker) {
      await db.notification.create({
        data: {
          userId: input.userId,
          title: "Notifications paused for today",
          body: `Daily cap reached (${DAILY_NOTIFICATION_CAP}/day) — further notifications resume tomorrow.`,
          channel: "IN_APP",
          category,
          status: "SUPPRESSED",
          caseId: input.caseId,
        },
      });
    }
    return;
  }

  // In-app — recorded unless the category is explicitly muted.
  const inAppPref = prefs ? categoryPref(prefs, category).inApp : true;
  if (inAppPref) {
    await db.notification.create({
      data: {
        userId: input.userId,
        title: input.title,
        body: input.body,
        channel: "IN_APP",
        category,
        status: "DELIVERED",
        caseId: input.caseId,
      },
    });
  }

  const pushPref = prefs ? categoryPref(prefs, category).push : true;
  const emailPref = prefs ? categoryPref(prefs, category).email : false;
  // Quiet hours hold the OUT-OF-APP channels (push + email); in-app is recorded
  // above regardless, so a held notification is still visible in the tray.
  const quiet = inQuietHours(prefs?.quietHours);

  // Web push — real VAPID send, respecting quiet hours and the kill-switch flag
  // (flag read failure keeps pushes on: a flag outage must not silence delivery).
  if (
    pushPref &&
    !quiet &&
    (await isFeatureEnabled("push_notifications").catch(() => true))
  ) {
    const subs = await db.pushSubscription.findMany({
      where: { userId: input.userId },
    });
    const pushPromises = subs.map(async (sub) => {
      try {
        const res = await channels.sendPush(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          {
            title: input.title,
            body: input.body,
            tag: input.caseId ?? "citizen-lane",
            url: "/",
          }
        );
        return res.gone ? sub.id : null;
      } catch (e) {
        console.error("[notify] push failed", e);
        return null;
      }
    });
    const goneIds = (await Promise.all(pushPromises)).filter((id): id is string => id !== null);
    if (goneIds.length > 0) {
      await db.pushSubscription.deleteMany({
        where: { id: { in: goneIds } },
      }).catch(() => undefined);
    }
  }

  // Email — via the configurable SMTP integration (ledger fallback), held
  // during quiet hours for the same reason push is.
  if (emailPref && !quiet) {
    const user = await db.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    });
    if (user?.email) {
      await channels
        .sendEmail({ to: user.email, subject: input.title, body: input.body })
        .catch(() => undefined);
    }
  }
}

/** Per-channel test-delivery plan (§24.11). Pure: no I/O, the route executes. */
export type TestChannel =
  | "IN_APP"
  | "PUSH"
  | "EMAIL"
  | "WHATSAPP"
  | "SMS"
  | "PORTAL";
export type ChannelPlan = {
  channel: TestChannel;
  sendable: boolean;
  reason: string;
};

export function planTestDelivery(input: {
  prefs: {
    inApp: boolean;
    email: boolean;
    push: boolean;
    categoryPrefs?: string | null;
    quietHours?: string | null;
  } | null;
  category: NotifyCategory;
  sentToday: number;
  pushSubscriptions: number;
  emailReady: boolean;
  /** Push kill-switch state; unknown (undefined) reads as enabled. */
  pushEnabled?: boolean;
}): ChannelPlan[] {
  const cp = input.prefs
    ? categoryPref(input.prefs, input.category)
    : { inApp: true, email: false, push: true };
  const quiet = inQuietHours(input.prefs?.quietHours ?? null);
  const pushOn = input.pushEnabled ?? true;
  const plan: ChannelPlan[] = [];
  plan.push(
    input.sentToday >= DAILY_NOTIFICATION_CAP
      ? { channel: "IN_APP", sendable: false, reason: "daily-cap" }
      : !cp.inApp
      ? { channel: "IN_APP", sendable: false, reason: "muted" }
      : { channel: "IN_APP", sendable: true, reason: "record" }
  );
  plan.push(
    !cp.push
      ? { channel: "PUSH", sendable: false, reason: "muted" }
      : quiet
      ? { channel: "PUSH", sendable: false, reason: "quiet-hours" }
      : !pushOn
      ? { channel: "PUSH", sendable: false, reason: "disabled" }
      : input.pushSubscriptions === 0
      ? { channel: "PUSH", sendable: false, reason: "no-subscription" }
      : { channel: "PUSH", sendable: true, reason: "push" }
  );
  plan.push(
    !cp.email
      ? { channel: "EMAIL", sendable: false, reason: "muted" }
      : quiet
      ? { channel: "EMAIL", sendable: false, reason: "quiet-hours" }
      : !input.emailReady
      ? { channel: "EMAIL", sendable: false, reason: "provider-unset" }
      : { channel: "EMAIL", sendable: true, reason: "email" }
  );
  for (const channel of ["WHATSAPP", "SMS", "PORTAL"] as const) {
    plan.push({ channel, sendable: false, reason: "unsupported" });
  }
  return plan;
}
