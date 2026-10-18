/**
 * Account lifecycle service — self-service registration, email verification and
 * password recovery/change for Citizen Lane clients.
 *
 * Server-only: imports Prisma + node crypto. The pure password policy lives in
 * `@/lib/password-policy` (browser-safe) and is re-exported here so feature UIs
 * can import the gate from a single server-facing module.
 *
 * Secrets discipline: only a SHA-256 hash of each one-time token is stored; the
 * raw value is sent by email (or surfaced as a sandbox link when the mail channel
 * cannot actually deliver). Raw tokens/hashes are never logged or returned.
 */
import { randomBytes, createHash } from "crypto";
import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";
import { notifyUser } from "@/lib/services/notify";
import { sendEmail, sealSecret, openSecret, type DeliveryOutcome } from "@/lib/integrations";
import { base32Encode, newTotpSecretBytes, newRecoveryCode, otpauthUrl, verifyTotp } from "@/lib/mfa/totp";
import { audit } from "@/lib/api-helpers";
import { validatePassword, describePasswordProblem, clampPasswordMinLength, PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { loadPlatformSettings } from "@/lib/settings/store";

/**
 * The minimum length the platform currently enforces.
 *
 * Read here rather than inside the pure policy module so the browser can import
 * the same gate without a server dependency. A settings read failure falls back
 * to the canon default instead of silently accepting short passwords.
 */
async function effectiveMinLength(): Promise<number> {
  try {
    const settings = await loadPlatformSettings();
    return clampPasswordMinLength(settings.operations.passwordMinLength ?? PASSWORD_MIN_LENGTH);
  } catch {
    return PASSWORD_MIN_LENGTH;
  }
}

export { PASSWORD_MIN_LENGTH, clampPasswordMinLength, scorePassword, validatePassword } from "@/lib/password-policy";

/**
 * True only when an SMTP send was accepted by the mail server. Used purely for
 * operator logging — it must NEVER gate whether a one-time link is returned
 * (see sandboxLinkEchoEnabled).
 */
function deliveredInBand(outcome: DeliveryOutcome): boolean {
  return outcome.channel === "smtp" && outcome.delivered;
}

/**
 * Whether one-time links (email-verify / password-reset) may be echoed back in
 * the HTTP response as a sandbox affordance.
 *
 * This is deliberately an explicit switch, NOT a runtime delivery outcome:
 * gating on "the send failed" would turn the public forgot-password route into a
 * live-token oracle for any known account during a mail outage (account
 * takeover). The link is echoed ONLY when SANDBOX_LINK_ECHO=1 is set explicitly —
 * never implicitly based on NODE_ENV, so a production deployment that forgets to
 * set NODE_ENV=production cannot accidentally expose live tokens.
 */
function sandboxLinkEchoEnabled(): boolean {
  return process.env.SANDBOX_LINK_ECHO === "1";
}

export const EMAIL_VERIFY_TTL_MS = 24 * 3_600_000;
export const PASSWORD_RESET_TTL_MS = 3_600_000;
/**
 * Passwordless sign-in links are deliberately short-lived: a link sitting in an
 * inbox is a bearer credential, so the window in which a leaked link is useful
 * is kept small (15 minutes, single use).
 */
export const MAGIC_LINK_TTL_MS = 15 * 60_000;

export type AuthTokenKind = "EMAIL_VERIFY" | "PASSWORD_RESET" | "MAGIC_LINK" | "MFA_CHALLENGE" | "MFA_RECOVERY";

export const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
export const MFA_RECOVERY_COUNT = 10;
export const MFA_RECOVERY_TTL_MS = 365 * 24 * 3_600_000;
export const ELEVATION_TTL_MIN = 10;
export const MFA_ISSUER = "Citizen Lane";

const sha256 = (raw: string): string => createHash("sha256").update(raw).digest("hex");

/**
 * Mint a one-time token. Only the hash is persisted; any prior unconsumed token
 * of the same kind is dropped so only the newest link can be used.
 */
export async function issueAuthToken(
  userId: string,
  kind: AuthTokenKind,
  ttlMs?: number,
): Promise<{ raw: string; expiresAt: Date }> {
  const raw = randomBytes(32).toString("hex");
  const tokenHash = sha256(raw);
  const ttl = ttlMs ?? (kind === "EMAIL_VERIFY" ? EMAIL_VERIFY_TTL_MS : kind === "MAGIC_LINK" ? MAGIC_LINK_TTL_MS : PASSWORD_RESET_TTL_MS);
  const expiresAt = new Date(Date.now() + ttl);
  await db.authToken.deleteMany({ where: { userId, kind, consumedAt: null } });
  await db.authToken.create({ data: { tokenHash, userId, kind, expiresAt } });
  return { raw, expiresAt };
}

/** Claim a token atomically; returns null when unknown, expired or already used. */
export async function consumeAuthToken(
  raw: string,
  kind: AuthTokenKind,
): Promise<{ userId: string } | null> {
  const tokenHash = sha256(raw);
  const token = await db.authToken.findFirst({ where: { tokenHash, kind } });
  if (!token || token.consumedAt || token.expiresAt < new Date()) return null;
  const claimed = await db.authToken.updateMany({
    where: { id: token.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (claimed.count === 0) return null;
  return { userId: token.userId };
}

export type RegisterInput = {
  name: string;
  email: string;
  password: string;
  locale?: string;
  consent: boolean;
  ip?: string;
};

export type VerificationOutcome = {
  sent: boolean;
  channel: string;
  detail: string;
  sandboxLink: string | null;
  expiresAt: string;
  alreadyVerified?: boolean;
};

async function activeRmUsers(orgId: string): Promise<Array<{ id: string }>> {
  return db.user.findMany({
    where: { orgId, status: "ACTIVE", role: { in: ["RM", "SENIOR_RM"] } },
    select: { id: true },
  });
}

/** Register a new client account (self-service), send verification, alert the RM pool. */
export async function registerAccount(
  input: RegisterInput,
): Promise<{ userId: string; name: string; email: string; verification: VerificationOutcome }> {
  const email = input.email.toLowerCase().trim();
  const name = input.name.trim();

  const minLength = await effectiveMinLength();
  const invalid = validatePassword(input.password, minLength);
  if (invalid) throw new DomainError(describePasswordProblem(invalid, minLength) ?? "Password does not meet the policy requirements", 400);
  if (!input.consent) throw new DomainError("Consent to the terms and privacy policy is required", 400);

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) throw new DomainError("This email is already registered", 409);

  const org = await db.organisation.findFirst();
  if (!org) throw new DomainError("Platform organisation missing", 500);

  const user = await db.user.create({
    data: {
      email,
      name,
      role: "CLIENT",
      status: "ACTIVE",
      profileState: "NOT_STARTED",
      passwordHash: hashPassword(input.password),
      emailVerifiedAt: null,
      orgId: org.id,
    },
  });

  await db.notificationPreference.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, locale: input.locale ?? "en" },
  });

  for (const key of ["terms", "privacy"]) {
    await db.consent
      .create({ data: { userId: user.id, key, version: "1", granted: true } })
      .catch(() => undefined); // tolerant of a concurrent duplicate (unique constraint)
  }

  const verification = await sendVerification({
    userId: user.id,
    email: user.email,
    name: user.name,
    locale: input.locale ?? "en",
  });

  await notifyUser({
    userId: user.id,
    category: "SYSTEM",
    title: "Welcome to Citizen Lane",
    body: "Your private client account is ready. Next step: complete your profile and upload your passport.",
  });

  for (const rm of await activeRmUsers(org.id)) {
    await notifyUser({
      userId: rm.id,
      category: "CASE",
      title: "New applicant registered",
      body: `${name} · ${email} created a client account and has not started onboarding yet.`,
    });
  }

  await audit({
    orgId: org.id,
    actorId: user.id,
    actorLabel: `${name} [CLIENT]`,
    action: "auth.register",
    target: email,
    after: { role: "CLIENT" },
    ip: input.ip,
  });

  return { userId: user.id, name, email, verification };
}

/** Send (or resend) the email-verification link. */
export async function sendVerification(m: {
  userId: string;
  email: string;
  name: string;
  locale: string;
}): Promise<VerificationOutcome> {
  const { raw, expiresAt } = await issueAuthToken(m.userId, "EMAIL_VERIFY");
  const link = `/verify-email?token=${raw}`;
  const body = [
    `Hello ${m.name},`,
    "",
    "Welcome to Citizen Lane. Confirm your email address by opening this link:",
    link,
    "",
    "The link expires in 24 hours. If you did not create an account you can ignore this message.",
    "",
    "— Citizen Lane",
  ].join("\n");

  const outcome = await sendEmail({ to: m.email, subject: "Confirm your Citizen Lane account", body });

  // Sandbox affordance (shared by verification + reset): the one-time link is
  // handed back ONLY when the explicit sandbox switch is on — never merely
  // because a send happened to fail, which would leak a live token whenever
  // mail is down.
  const sandboxLink = sandboxLinkEchoEnabled() ? link : null;
  if (!sandboxLink && !deliveredInBand(outcome)) {
    console.warn(`[auth] verification email to ${m.email} was not delivered in-band (channel=${outcome.channel}); link withheld from the API response.`);
  }

  await audit({
    actorId: m.userId,
    actorLabel: m.name,
    action: "auth.email.verification_sent",
    target: m.email,
  });

  return {
    sent: outcome.delivered,
    channel: outcome.channel,
    detail: outcome.detail,
    sandboxLink,
    expiresAt: expiresAt.toISOString(),
  };
}

/** Consume an email-verification token. Idempotent when the email is already verified. */
export async function verifyEmail(raw: string): Promise<{ ok: boolean; email?: string }> {
  const consumed = await consumeAuthToken(raw, "EMAIL_VERIFY");
  if (!consumed) throw new DomainError("This verification link is invalid or has expired", 400);

  const user = await db.user.findUnique({ where: { id: consumed.userId } });
  if (!user) throw new DomainError("This verification link is invalid or has expired", 400);

  const alreadyVerified = Boolean(user.emailVerifiedAt);
  if (!alreadyVerified) {
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
  }

  await audit({
    orgId: user.orgId,
    actorId: user.id,
    actorLabel: `${user.name} [${user.role}]`,
    action: "auth.email.verified",
    target: user.email,
  });

  if (!alreadyVerified) {
    await notifyUser({
      userId: user.id,
      category: "SYSTEM",
      title: "Email verified",
      body: "Your email address is confirmed. Your Relationship Manager has been notified.",
    });
    for (const rm of await activeRmUsers(user.orgId)) {
      await notifyUser({
        userId: rm.id,
        category: "CASE",
        title: "Applicant email verified",
        body: `${user.name} · ${user.email} confirmed their email address and can now begin onboarding.`,
      });
    }
  }

  return { ok: true, email: user.email };
}

/** Always resolves — never reveals whether the address is registered. */
export async function requestPasswordReset(email: string, locale?: string): Promise<{ sandboxLink: string | null }> {
  const normalised = email.toLowerCase().trim();
  const user = await db.user.findUnique({ where: { email: normalised } });
  if (!user) return { sandboxLink: null };

  const { raw, expiresAt } = await issueAuthToken(user.id, "PASSWORD_RESET");
  const link = `/reset-password?token=${raw}`;
  const body = [
    `Hello ${user.name},`,
    "",
    "We received a request to reset your Citizen Lane password. Choose a new one here:",
    link,
    "",
    `The link expires at ${expiresAt.toISOString()}. If you did not request this, ignore this message — your password has not been changed.`,
    "",
    "— Citizen Lane",
  ].join("\n");
  const outcome = await sendEmail({ to: user.email, subject: "Reset your Citizen Lane password", body });

  await audit({
    orgId: user.orgId,
    actorId: user.id,
    actorLabel: `${user.name} [${user.role}]`,
    action: "auth.password.reset_requested",
    target: user.email,
    after: locale ? { locale } : undefined,
  });

  await notifyUser({
    userId: user.id,
    category: "SYSTEM",
    title: "Password reset requested",
    body: "If you did not request this, ignore this message — your password has not been changed.",
  });

  // Same sandbox affordance as sendVerification: the link travels back in the
  // response ONLY under the explicit sandbox switch — never merely because the
  // send failed, or an unauthenticated caller could obtain a live reset token
  // for any known account during a mail outage.
  const sandboxLink = sandboxLinkEchoEnabled() ? link : null;
  if (!sandboxLink && !deliveredInBand(outcome)) {
    // Log the user id, never the address — server logs are not a PII store.
    console.warn(`[auth] password-reset email for user ${user.id} was not delivered in-band (channel=${outcome.channel}); link withheld from the API response.`);
  }
  return { sandboxLink };
}

/**
 * Request a passwordless sign-in link.
 *
 * Always resolves — never reveals whether the address is registered (no
 * enumeration). A link is minted only for an ACTIVE account; a deactivated
 * account is treated exactly like an unknown one. The raw token travels only in
 * the email (or the sandbox echo under the explicit sandbox switch), never in
 * the response body otherwise.
 */
export async function requestMagicLink(email: string, locale?: string): Promise<{ sandboxLink: string | null }> {
  const normalised = email.toLowerCase().trim();
  const user = await db.user.findUnique({ where: { email: normalised } });
  if (!user || user.status === "DEACTIVATED") return { sandboxLink: null };

  const { raw, expiresAt } = await issueAuthToken(user.id, "MAGIC_LINK");
  const link = `/magic-link?token=${raw}`;
  const body = [
    `Hello ${user.name},`,
    "",
    "Here is your secure sign-in link for Citizen Lane. Open it to sign in — no password needed:",
    link,
    "",
    `The link expires at ${expiresAt.toISOString()} and can be used once. If you did not request it, you can safely ignore this message.`,
    "",
    "— Citizen Lane",
  ].join("\n");
  const outcome = await sendEmail({ to: user.email, subject: "Your Citizen Lane sign-in link", body });

  await audit({
    orgId: user.orgId,
    actorId: user.id,
    actorLabel: `${user.name} [${user.role}]`,
    action: "auth.magic_link.requested",
    target: user.email,
    after: locale ? { locale } : undefined,
  });

  // Same sandbox affordance as verification/reset: the link travels back in the
  // response ONLY under the explicit sandbox switch — never merely because the
  // send failed, or an unauthenticated caller could obtain a live sign-in token
  // for any known account during a mail outage.
  const sandboxLink = sandboxLinkEchoEnabled() ? link : null;
  if (!sandboxLink && !deliveredInBand(outcome)) {
    console.warn(`[auth] magic-link email to ${user.email} was not delivered in-band (channel=${outcome.channel}); link withheld from the API response.`);
  }
  return { sandboxLink };
}

export type MagicLinkAccount = {
  userId: string;
  email: string;
  name: string;
  role: string;
  orgId: string;
  profileState: string;
  emailVerifiedAt: Date | null;
};

/**
 * Consume a magic-link token and return the account it belongs to.
 *
 * Single-use and time-boxed; returns null when unknown, expired, already used or
 * belonging to a deactivated account. Deliberately does NOT mint a session — the
 * caller owns that side effect, so the token can be validated without touching
 * the session table.
 */
export async function consumeMagicLink(raw: string): Promise<MagicLinkAccount | null> {
  const consumed = await consumeAuthToken(raw, "MAGIC_LINK");
  if (!consumed) return null;
  const user = await db.user.findUnique({ where: { id: consumed.userId } });
  if (!user || user.status === "DEACTIVATED") return null;
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    orgId: user.orgId,
    profileState: user.profileState,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}

/** Consume a reset token, set the new password and sign out every session. */
export async function resetPassword(raw: string, password: string): Promise<{ ok: boolean; email?: string }> {
  const minLength = await effectiveMinLength();
  const invalid = validatePassword(password, minLength);
  if (invalid) throw new DomainError(describePasswordProblem(invalid, minLength) ?? "Password does not meet the policy requirements", 400);

  const consumed = await consumeAuthToken(raw, "PASSWORD_RESET");
  if (!consumed) throw new DomainError("This reset link is invalid or has expired", 400);

  const user = await db.user.findUnique({ where: { id: consumed.userId } });
  if (!user) throw new DomainError("This reset link is invalid or has expired", 400);

  await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password) } });
  await db.session.updateMany({
    where: { userId: user.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await sendEmail({
    to: user.email,
    subject: "Your Citizen Lane password was changed",
    body: "Your Citizen Lane password was changed and all sessions were signed out. If this was not you, contact your Relationship Manager immediately.",
  });
  await notifyUser({
    userId: user.id,
    category: "SYSTEM",
    title: "Your password was changed",
    body: "All other sessions were signed out. Contact your Relationship Manager if this was not you.",
  });
  await audit({
    orgId: user.orgId,
    actorId: user.id,
    actorLabel: `${user.name} [${user.role}]`,
    action: "auth.password.reset",
    target: user.email,
  });

  return { ok: true, email: user.email };
}

/** Change the signed-in user's password; revokes every other session. */
export async function changePassword(
  userId: string,
  sessionId: string | null,
  currentPassword: string,
  nextPassword: string,
): Promise<{ ok: true }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new DomainError("Authentication required", 401);
  if (!verifyPassword(currentPassword, user.passwordHash)) {
    throw new DomainError("Current password is incorrect", 401);
  }
  if (verifyPassword(nextPassword, user.passwordHash)) {
    throw new DomainError("The new password must be different from the current one", 400);
  }
  const minLength = await effectiveMinLength();
  const invalid = validatePassword(nextPassword, minLength);
  if (invalid) throw new DomainError(describePasswordProblem(invalid, minLength) ?? "Password does not meet the policy requirements", 400);

  await db.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(nextPassword) } });
  await db.session.updateMany({
    where: { userId: user.id, revokedAt: null, ...(sessionId ? { id: { not: sessionId } } : {}) },
    data: { revokedAt: new Date() },
  });

  await audit({
    orgId: user.orgId,
    actorId: user.id,
    actorLabel: `${user.name} [${user.role}]`,
    action: "auth.password.changed",
    target: user.email,
  });
  await notifyUser({
    userId: user.id,
    category: "SYSTEM",
    title: "Your password was changed",
    body: "All other sessions were signed out. Contact your Relationship Manager if this was not you.",
  });

  return { ok: true };
}

/**
 * TOTP second factor (RFC 6238). Secrets are sealed with the integration key;
 * recovery codes are single-use hashed rows; challenges are 5-minute tokens.
 */

/** Begin enrollment: fresh sealed secret, MFA stays off until confirmed. */
export async function beginMfaEnroll(userId: string): Promise<{ otpauthUrl: string }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new DomainError("Authentication required", 401);
  const secret = newTotpSecretBytes();
  const sealed = sealSecret(secret.toString("hex"));
  if (!sealed) throw new DomainError("MFA unavailable — encryption key not configured", 503);
  await db.user.update({ where: { id: userId }, data: { mfaSecret: sealed, mfaEnabled: false } });
  await audit({ orgId: user.orgId, actorId: user.id, actorLabel: `${user.name} [${user.role}]`, action: "auth.mfa.enroll_started", target: user.email });
  return { otpauthUrl: otpauthUrl(MFA_ISSUER, user.email, base32Encode(secret)) };
}

function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.toUpperCase().replace(/-/g, "")).digest("hex");
}

async function recoveryRemaining(userId: string): Promise<number> {
  return db.authToken.count({ where: { userId, kind: "MFA_RECOVERY", consumedAt: null } });
}

/** Mint a fresh recovery set; wipes any prior set (regeneration invalidates). */
async function mintRecoveryCodes(userId: string): Promise<{ codes: string[]; expiresAt: Date }> {
  await db.authToken.deleteMany({ where: { userId, kind: "MFA_RECOVERY" } });
  const expiresAt = new Date(Date.now() + MFA_RECOVERY_TTL_MS);
  const codes = Array.from({ length: MFA_RECOVERY_COUNT }, () => newRecoveryCode());
  for (const code of codes) {
    await db.authToken.create({ data: { tokenHash: hashRecoveryCode(code), userId, kind: "MFA_RECOVERY", expiresAt } });
  }
  return { codes, expiresAt };
}

/** Confirm enrollment with one fresh code; returns recovery codes exactly once. */
export async function confirmMfaEnroll(userId: string, code: string): Promise<{ recoveryCodes: string[]; recoveryExpiresAt: string; recoveryRemaining: number }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user?.mfaSecret) throw new DomainError("Enroll first", 400);
  const raw = openSecret(user.mfaSecret);
  if (!raw || !verifyTotp(Buffer.from(raw, "hex"), code)) {
    await audit({ orgId: user.orgId, actorId: user.id, actorLabel: `${user.name} [${user.role}]`, action: "auth.mfa.enroll_failed", target: user.email });
    throw new DomainError("Invalid code", 401);
  }
  const { codes, expiresAt } = await mintRecoveryCodes(userId);
  await db.user.update({ where: { id: userId }, data: { mfaEnabled: true } });
  await audit({ orgId: user.orgId, actorId: user.id, actorLabel: `${user.name} [${user.role}]`, action: "auth.mfa.enrolled", target: user.email });
  return { recoveryCodes: codes, recoveryExpiresAt: expiresAt.toISOString(), recoveryRemaining: codes.length };
}

/** Issue a 5-minute single-use login challenge for an MFA-enabled account. */
export async function startMfaChallenge(userId: string): Promise<{ challenge: string }> {
  const { raw } = await issueAuthToken(userId, "MFA_CHALLENGE", MFA_CHALLENGE_TTL_MS);
  return { challenge: raw };
}

/** Atomically claim one recovery code; null when unknown or already used. */
async function claimRecoveryCode(userId: string, code: string): Promise<boolean> {
  const row = await db.authToken.findFirst({ where: { tokenHash: hashRecoveryCode(code), userId, kind: "MFA_RECOVERY" } });
  if (!row || row.consumedAt || row.expiresAt < new Date()) return false;
  const claimed = await db.authToken.updateMany({ where: { id: row.id, consumedAt: null }, data: { consumedAt: new Date() } });
  return claimed.count > 0;
}

/** Verify TOTP first, recovery code second. Distinguishes the method for callers. */
export async function verifyMfa(userId: string, code: string): Promise<{ method: "totp" | "recovery"; recoveryRemaining: number }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user || !user.mfaEnabled) throw new DomainError("MFA is not enabled", 400);
  const raw = openSecret(user.mfaSecret ?? "");
  if (raw && verifyTotp(Buffer.from(raw, "hex"), code)) {
    return { method: "totp", recoveryRemaining: await recoveryRemaining(userId) };
  }
  if (await claimRecoveryCode(userId, code)) {
    return { method: "recovery", recoveryRemaining: await recoveryRemaining(userId) };
  }
  throw new DomainError("Invalid code", 401);
}

/** Disable MFA: password + second factor, then wipe secret and codes. */
export async function disableMfa(userId: string, password: string, code: string, sessionId: string | null): Promise<{ ok: true }> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new DomainError("Authentication required", 401);
  if (!verifyPassword(password, user.passwordHash)) throw new DomainError("Current password is incorrect", 401);
  if (!user.mfaEnabled) return { ok: true };
  await verifyMfa(userId, code);
  await db.user.update({ where: { id: userId }, data: { mfaSecret: null, mfaEnabled: false } });
  await db.authToken.deleteMany({ where: { userId, kind: "MFA_RECOVERY" } });
  await db.session.updateMany({ where: { userId, revokedAt: null, ...(sessionId ? { id: { not: sessionId } } : {}) }, data: { revokedAt: new Date() } });
  await audit({ orgId: user.orgId, actorId: user.id, actorLabel: `${user.name} [${user.role}]`, action: "auth.mfa.disabled", target: user.email });
  await notifyUser({ userId: user.id, category: "SYSTEM", title: "Two-factor sign-in was turned off", body: "Other sessions were signed out. Contact your Relationship Manager if this was not you." });
  return { ok: true };
}

/** Mark one owned session freshly verified for sensitive actions. */
export async function elevateSession(userId: string, sessionId: string, code: string): Promise<{ ok: true }> {
  const { method } = await verifyMfa(userId, code);
  const updated = await db.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { elevatedAt: new Date() } });
  if (updated.count === 0) throw new DomainError("Authentication required", 401);
  const user = await db.user.findUnique({ where: { id: userId } });
  await audit({ orgId: user?.orgId ?? null, actorId: userId, actorLabel: user ? `${user.name} [${user.role}]` : "unknown", action: "auth.session.elevated", target: user?.email ?? userId, after: { method } });
  return { ok: true };
}

/**
 * Gate for sensitive actions. Step-up applies only to MFA-enrolled accounts —
 * everyone else keeps the existing password-auth behaviour, so enabling the
 * gate never locks out users without MFA.
 */
export async function requireElevation(ctx: { sessionId: string | null; userId: string }, ttlMin: number = ELEVATION_TTL_MIN): Promise<void> {
  const user = await db.user.findUnique({ where: { id: ctx.userId }, select: { mfaEnabled: true } });
  if (!user?.mfaEnabled) return;
  if (!ctx.sessionId) throw new DomainError("This action needs fresh verification", 403);
  const s = await db.session.findUnique({ where: { id: ctx.sessionId }, select: { elevatedAt: true, revokedAt: true, expiresAt: true } });
  if (!s || s.revokedAt || s.expiresAt < new Date()) throw new DomainError("Authentication required", 401);
  if (!s.elevatedAt || Date.now() - s.elevatedAt.getTime() > ttlMin * 60_000) {
    throw new DomainError("This action needs fresh verification", 403);
  }
}

