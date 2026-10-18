import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handler, jsonOk, readJson, audit } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { getPublicKey, sendPush } from "@/lib/adapters/push";
import { DomainError } from "@/lib/domain/states";

// GET /api/push — VAPID public key + current subscription status
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const subs = await db.pushSubscription.findMany({ where: { userId: ctx.userId } });
    return jsonOk({
      publicKey: getPublicKey(),
      subscribed: subs.length > 0,
      subscriptions: subs.length,
      subject: process.env.VAPID_SUBJECT ?? "mailto:platform@citizen-lane.com",
    });
  })(req);
}

// POST /api/push — { action: "subscribe" | "unsubscribe" | "test" }
export async function POST(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const body = await readJson<{
      action: string;
      subscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
    }>(r);

    if (body.action === "subscribe") {
      const sub = body.subscription;
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        throw new DomainError("Invalid subscription payload", 400);
      }
      await db.pushSubscription.upsert({
        where: { endpoint: sub.endpoint },
        update: { userId: ctx.userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        create: { userId: ctx.userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: r.headers.get("user-agent") ?? undefined },
      });
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "push.subscribed", target: sub.endpoint.slice(-24) });
      return jsonOk({ ok: true, subscribed: true });
    }

    if (body.action === "unsubscribe") {
      if (body.subscription?.endpoint) {
        await db.pushSubscription.deleteMany({ where: { endpoint: body.subscription.endpoint, userId: ctx.userId } });
      }
      await audit({ orgId: ctx.orgId, actorId: ctx.userId, actorLabel: `${ctx.name} [${ctx.role}]`, action: "push.unsubscribed", target: body.subscription?.endpoint?.slice(-24) ?? "unknown" });
      return jsonOk({ ok: true, subscribed: false });
    }

    if (body.action === "test") {
      const subs = await db.pushSubscription.findMany({ where: { userId: ctx.userId } });
      if (subs.length === 0) throw new DomainError("No push subscription — enable notifications first", 409);
      const results: Array<{ endpoint: string; ok: boolean; error?: string }> = [];
      for (const sub of subs) {
        const res = await sendPush(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          {
            title: "Citizen Lane — notifications enabled",
            body: "VAPID-signed push is live. You will receive case updates here.",
            tag: "cl-push-test",
            url: "/",
          }
        );
        if (res.gone) {
          await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
        }
        results.push({ endpoint: sub.endpoint.slice(-8), ok: res.ok, error: res.error });
      }
      return jsonOk({ sent: results.filter((x) => x.ok).length, results });
    }

    throw new DomainError("Unknown push action", 400);
  })(req);
}
