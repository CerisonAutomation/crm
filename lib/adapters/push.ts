/**
 * Web Push adapter — real VAPID-signed push via `web-push`.
 * Keys are generated (`bunx web-push generate-vapid-keys`) and injected via env:
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
 */
import webpush from "web-push";

let configured = false;

function ensureConfigured() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:platform@citizen-lane.com";
  if (!publicKey || !privateKey) {
    throw new Error("VAPID keys missing — set VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY in .env");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export function getPublicKey(): string {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY;
  if (!key) throw new Error("VAPID public key missing");
  return key;
}

export type PushPayload = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
};

export async function sendPush(subscription: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}, payload: PushPayload): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  ensureConfigured();
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      TTL: 3600,
      headers: { "UrGency": "normal" },
    });
    return { ok: true };
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    // 404/410 = subscription gone → caller should prune it
    return { ok: false, gone: statusCode === 404 || statusCode === 410, error: (err as Error).message };
  }
}
