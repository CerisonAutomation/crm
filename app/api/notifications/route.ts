import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { parseListParams, decodeCursor, nextPage } from "@/lib/pagination";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

// GET /api/notifications — current user's notifications
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const url = new URL(r.url);
    // Keyset pagination over `createdAt desc, id desc`. Also fixes the previous
    // bare parseInt, where `?limit=abc` produced NaN and a Prisma 500.
    const { limit, cursor } = parseListParams(url, {
      defaultLimit: 30,
      maxLimit: 100,
    });
    const rows = await db.notification.findMany({
      where: { userId: ctx.userId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...(cursor ? { cursor: { id: decodeCursor(cursor) }, skip: 1 } : {}),
      take: limit + 1,
    });
    const page = nextPage(rows, limit, (n) => n.id);
    const unread = await db.notification.count({
      where: { userId: ctx.userId, readAt: null },
    });
    const prefs = await db.notificationPreference.findUnique({
      where: { userId: ctx.userId },
    });
    return jsonOk({
      notifications: page.items,
      nextCursor: page.nextCursor,
      unread,
      prefs,
    });
  })(req);
}

// POST /api/notifications — { action: "read" | "readAll" | "prefs" }
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      action: string;
      id?: string;
      prefs?: {
        inApp?: boolean;
        email?: boolean;
        push?: boolean;
        quietHours?: string;
        locale?: string;
        categoryPrefs?: Record<
          string,
          { inApp?: boolean; email?: boolean; push?: boolean }
        >;
        callPrefs?: {
          transcription?: boolean;
          recording?: boolean;
          defaultKind?: "AUDIO" | "VIDEO";
          subtitleLang?: string;
        };
        chatPrefs?: {
          voiceNotes?: boolean;
          autoPlayVoice?: boolean;
          captions?: boolean;
        };
      };
    }>(r);
    if (body.action === "read" && body.id) {
      await db.notification.updateMany({
        where: { id: body.id, userId: ctx.userId },
        data: { readAt: new Date() },
      });
      return jsonOk({ ok: true });
    }
    if (body.action === "readAll") {
      await db.notification.updateMany({
        where: { userId: ctx.userId, readAt: null },
        data: { readAt: new Date() },
      });
      return jsonOk({ ok: true });
    }
    if (body.action === "prefs" && body.prefs) {
      const p = body.prefs;
      const update: Record<string, unknown> = {};
      if (typeof p.inApp === "boolean") update.inApp = p.inApp;
      if (typeof p.email === "boolean") update.email = p.email;
      if (typeof p.push === "boolean") update.push = p.push;
      if (
        typeof p.quietHours === "string" &&
        /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(p.quietHours)
      )
        update.quietHours = p.quietHours;
      if (typeof p.locale === "string" && p.locale.length <= 8)
        update.locale = p.locale;
      if (p.categoryPrefs && typeof p.categoryPrefs === "object") {
        const clean: Record<
          string,
          { inApp: boolean; email: boolean; push: boolean }
        > = {};
        for (const [cat, val] of Object.entries(p.categoryPrefs)) {
          if (!["CASE", "DOCUMENT", "SYSTEM"].includes(cat)) continue;
          clean[cat] = {
            inApp: val.inApp ?? true,
            email: val.email ?? false,
            push: val.push ?? true,
          };
        }
        update.categoryPrefs = JSON.stringify(clean);
      }
      if (p.callPrefs && typeof p.callPrefs === "object") {
        update.callPrefs = JSON.stringify({
          transcription: p.callPrefs.transcription === true,
          recording: p.callPrefs.recording === true,
          defaultKind: p.callPrefs.defaultKind === "VIDEO" ? "VIDEO" : "AUDIO",
          subtitleLang:
            typeof p.callPrefs.subtitleLang === "string" &&
            p.callPrefs.subtitleLang.length <= 8
              ? p.callPrefs.subtitleLang
              : "en",
        });
      }
      if (p.chatPrefs && typeof p.chatPrefs === "object") {
        update.chatPrefs = JSON.stringify({
          voiceNotes: p.chatPrefs.voiceNotes ?? true,
          autoPlayVoice: p.chatPrefs.autoPlayVoice === true,
          captions: p.chatPrefs.captions ?? true,
        });
      }
      const prefs = await db.notificationPreference.upsert({
        where: { userId: ctx.userId },
        update,
        create: { userId: ctx.userId, ...update },
      });
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "notification.prefs.updated",
        target: ctx.userId,
        after: update,
      });
      return jsonOk({ ok: true, prefs });
    }
    if (body.action === "test") {
      const { planTestDelivery, notificationsSentToday } = await import(
        "@/lib/services/notify"
      );
      const rawTarget = (body as unknown as { userId?: unknown }).userId;
      const targetId =
        typeof rawTarget === "string" && rawTarget ? rawTarget : ctx.userId;
      if (targetId !== ctx.userId) {
        const { requireCapability } = await import("@/lib/auth");
        requireCapability(ctx, "admin.manage");
      }
      const target = await db.user.findUnique({
        where: { id: targetId },
        select: { id: true, email: true, orgId: true },
      });
      if (!target || target.orgId !== ctx.orgId)
        throw new DomainError(
          "Target user not found in your organisation",
          404
        );
      const rawCategory = (body as unknown as { category?: unknown }).category;
      const category = (
        typeof rawCategory === "string" &&
        ["CASE", "DOCUMENT", "SYSTEM", "TEAM"].includes(rawCategory)
          ? rawCategory
          : "SYSTEM"
      ) as "CASE" | "DOCUMENT" | "SYSTEM" | "TEAM";
      const integrations = await import("@/lib/integrations");
      const features = await import("@/lib/settings/features");
      const [prefs, sentToday, pushSubs, smtp, resend, pushOn] =
        await Promise.all([
          db.notificationPreference.findUnique({ where: { userId: targetId } }),
          notificationsSentToday(targetId),
          db.pushSubscription.count({ where: { userId: targetId } }),
          integrations
            .getIntegration("smtp")
            .catch(() => ({ active: false, config: {} })),
          integrations
            .getIntegration("resend")
            .catch(() => ({ active: false, config: {} })),
          features.isFeatureEnabled("push_notifications").catch(() => true),
        ]);
      const smtpConfig = smtp.config as Record<string, unknown>;
      const resendConfig = resend.config as Record<string, unknown>;
      const emailReady = Boolean(
        (smtp.active && smtpConfig.host) ||
          (resend.active && resendConfig.apiKey)
      );
      const plan = planTestDelivery({
        prefs,
        category,
        sentToday,
        pushSubscriptions: pushSubs,
        emailReady,
        pushEnabled: pushOn,
      });
      const title = "[TEST] Delivery check";
      const text =
        "[TEST] If you see this, the channel works. No action needed.";
      const results: Record<string, unknown> = {};
      for (const p of plan) {
        if (!p.sendable) {
          results[p.channel] = { sent: false, reason: p.reason };
          continue;
        }
        if (p.channel === "IN_APP") {
          const row = await db.notification.create({
            data: {
              userId: targetId,
              title,
              body: text,
              channel: "IN_APP",
              category,
              status: "DELIVERED",
            },
          });
          results[p.channel] = {
            sent: true,
            proof: { notificationId: row.id },
          };
        } else if (p.channel === "PUSH") {
          const { sendPush } = await import("@/lib/adapters/push");
          const subs = await db.pushSubscription.findMany({
            where: { userId: targetId },
          });
          let sent = 0;
          const failures: string[] = [];
          for (const sub of subs) {
            try {
              const res = await sendPush(
                {
                  endpoint: sub.endpoint,
                  keys: { p256dh: sub.p256dh, auth: sub.auth },
                },
                { title, body: text, tag: "test", url: "/" }
              );
              if (res.gone)
                await db.pushSubscription
                  .delete({ where: { id: sub.id } })
                  .catch(() => undefined);
              if (res.ok) sent++;
              else failures.push(res.error ?? "push failed");
            } catch (e) {
              failures.push(e instanceof Error ? e.message : "push error");
            }
          }
          results[p.channel] = {
            sent: sent > 0,
            proof: { subscriptions: subs.length, delivered: sent, failures },
          };
        } else if (p.channel === "EMAIL") {
          const { sendEmail } = await import("@/lib/integrations");
          const outcome = await sendEmail({
            to: target.email,
            subject: title,
            body: text,
          });
          results[p.channel] = {
            sent: outcome.delivered,
            proof: { channel: outcome.channel, detail: outcome.detail },
          };
        }
      }
      await audit({
        orgId: ctx.orgId,
        actorId: ctx.userId,
        actorLabel: `${ctx.name} [${ctx.role}]`,
        action: "notification.test.sent",
        target: target.email,
        after: {
          category,
          plan: plan.map((p) => ({
            channel: p.channel,
            sendable: p.sendable,
            reason: p.reason,
          })),
          results,
        },
      });
      return jsonOk({
        ok: true,
        target: target.email,
        category,
        plan,
        results,
      });
    }
    throw new DomainError("Unknown notification action", 400);
  })(req);
}
