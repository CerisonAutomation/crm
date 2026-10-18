/**
 * H2 port — outbound notification channels.
 *
 * Push delivery (VAPID adapter) and email (integration) are capabilities this
 * codebase does not own, so they sit behind this contract: services depend on
 * ChannelSenders, never on the adapters directly.
 *
 * H3 default: offlineChannelSenders sends nothing and resolves — offline paths
 * (tests, degraded boot) stay silent without a network.
 *
 * Pure types + one constant: Prisma-free, safe to import anywhere.
 */
export type PushSubscription = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

export type PushMessage = {
  title: string;
  body: string;
  tag?: string;
  url?: string;
};

export type PushResult = { ok: boolean; gone?: boolean; error?: string };

export type EmailMessage = { to: string; subject: string; body: string };

export type EmailResult = { delivered: boolean; channel: string; detail: string };

export interface ChannelSenders {
  sendPush(sub: PushSubscription, msg: PushMessage): Promise<PushResult>;
  sendEmail(msg: EmailMessage): Promise<EmailResult>;
}

/** H3 offline default — resolves without touching the network. */
export const offlineChannelSenders: ChannelSenders = {
  sendPush: async () => ({ ok: false, error: "offline: push not sent" }),
  sendEmail: async () => ({ delivered: false, channel: "offline", detail: "offline: email not sent" }),
};
