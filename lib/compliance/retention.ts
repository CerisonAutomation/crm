/**
 * Retention runner — the automated disposition step of the records programme.
 *
 * It operates on EXACTLY the models in `PURGE_TIER` (src/lib/compliance/
 * data-map.ts) — operational exhaust. Every statutory/evidentiary record is
 * marked `legalHold` in the data map and is therefore absent from
 * `PURGE_TIER`, so this runner can never touch it; disposal of those needs an
 * authorised process (ISO 15489). The models below are wired one-to-one to the
 * purge tier — nothing outside it is referenced.
 *
 * Consent receipts carry a legal hold (GDPR Art. 7(1) accountability proof) and are therefore absent from PURGE_TARGETS along with every other statutory record.
 *
 * P2P trust exhaust (`realtime-calling-exhaust` in the data map) runs post-END:
 * signaling rows are deleted once the parent call/meeting ended 30+ days ago,
 * while the parent rows are scrubbed — transcript nulled, vault bytes destroyed
 * — never deleted, so case history survives without the media.
 * Each purge is written to the append-only audit trail (`retention.purged`)
 * with the model, the number of rows destroyed, the retention window and the
 * legal/operational basis — the destruction trail ISO 15489 requires.
 *
 * Failures are contained per model: a single failing table never aborts the
 * run and never throws into the caller.
 */
import { db } from "@/lib/db";
import { audit } from "@/lib/api-helpers";
import { loadPlatformSettings } from "@/lib/settings/store";
import { storageDelete } from "@/lib/storage";
import { purgeTierFor, retentionFor } from "./data-map";

/** One model's purge outcome. */
export type RetentionPurgeResult = {
  model: string;
  days: number;
  deleted: number;
};

/**
 * A purge target: how to count rows older than a cutoff (dry-run) and how to
 * delete them. Each model is wired to its Prisma delegate EXPLICITLY — no
 * dynamic `db[model]` string indexing, which would defeat type safety.
 */
type PurgeTarget = {
  count: (cutoff: Date) => Promise<number>;
  purge: (cutoff: Date) => Promise<number>;
};

/**
 * Only models present in `PURGE_TIER` are listed. Each maps to its natural time
 * column: most carry `createdAt`, while sessions and one-time tokens carry
 * `expiresAt`. A model that gains a purge-tier rule without a target here is
 * skipped by the loop below rather than guessed at.
 */
const PURGE_TARGETS: Record<string, PurgeTarget> = {
  Notification: {
    count: (cutoff) =>
      db.notification.count({ where: { createdAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.notification
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  Booking: {
    count: (cutoff) =>
      db.booking.count({ where: { createdAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.booking
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  Consultation: {
    count: (cutoff) =>
      db.consultation.count({ where: { createdAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.consultation
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  MessageTemplate: {
    count: (cutoff) =>
      db.messageTemplate.count({ where: { createdAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.messageTemplate
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  Lead: {
    count: (cutoff) => db.lead.count({ where: { createdAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.lead
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  PageSubmission: {
    count: (cutoff) =>
      db.pageSubmission.count({ where: { createdAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.pageSubmission
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  PushSubscription: {
    count: (cutoff) =>
      db.pushSubscription.count({ where: { createdAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.pushSubscription
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  Connection: {
    count: (cutoff) =>
      db.connection.count({ where: { createdAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.connection
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  Session: {
    count: (cutoff) =>
      db.session.count({ where: { expiresAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.session
        .deleteMany({ where: { expiresAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  AuthToken: {
    count: (cutoff) =>
      db.authToken.count({ where: { expiresAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.authToken
        .deleteMany({ where: { expiresAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  TelemetryEvent: {
    count: (cutoff) =>
      db.telemetryEvent.count({ where: { createdAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.telemetryEvent
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  OutboxEvent: {
    count: (cutoff) =>
      db.outboxEvent.count({ where: { createdAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.outboxEvent
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  WebhookDelivery: {
    count: (cutoff) =>
      db.webhookDelivery.count({ where: { createdAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.webhookDelivery
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  IdempotencyKey: {
    count: (cutoff) =>
      db.idempotencyKey.count({ where: { createdAt: { lt: cutoff } } }),
    purge: (cutoff) =>
      db.idempotencyKey
        .deleteMany({ where: { createdAt: { lt: cutoff } } })
        .then((r) => r.count),
  },
  CallSignal: {
    count: (cutoff) =>
      db.callSignal.count({ where: { call: { endedAt: { lt: cutoff } } } }),
    purge: (cutoff) =>
      db.callSignal
        .deleteMany({ where: { call: { endedAt: { lt: cutoff } } } })
        .then((r) => r.count),
  },
  MeetingSignal: {
    count: (cutoff) =>
      db.meetingSignal.count({
        where: { meeting: { endedAt: { lt: cutoff } } },
      }),
    purge: (cutoff) =>
      db.meetingSignal
        .deleteMany({ where: { meeting: { endedAt: { lt: cutoff } } } })
        .then((r) => r.count),
  },
  CallSession: {
    count: (cutoff) =>
      db.callSession.count({
        where: { endedAt: { lt: cutoff }, transcript: { not: null } },
      }),
    purge: async (cutoff) => {
      const r = await db.callSession.updateMany({
        where: { endedAt: { lt: cutoff }, transcript: { not: null } },
        data: { transcript: null, transcriptUpdatedAt: null },
      });
      return r.count;
    },
  },
  Meeting: {
    count: (cutoff) =>
      db.meeting.count({
        where: {
          endedAt: { lt: cutoff },
          OR: [{ transcript: { not: null } }, { recordingKey: { not: null } }],
        },
      }),
    purge: async (cutoff) => {
      const expired = await db.meeting.findMany({
        where: {
          endedAt: { lt: cutoff },
          OR: [{ transcript: { not: null } }, { recordingKey: { not: null } }],
        },
        select: { id: true, recordingKey: true },
      });
      for (const row of expired) {
        if (!row.recordingKey) continue;
        try {
          await storageDelete(row.recordingKey);
        } catch (err) {
          console.error("vault delete failed", row.id, err);
        }
      }
      const r = await db.meeting.updateMany({
        where: { endedAt: { lt: cutoff } },
        data: {
          transcript: null,
          transcriptStatus: "NONE",
          recordingKey: null,
          recordingMime: null,
          recordingBytes: null,
          recordingDurationMs: null,
        },
      });
      return r.count;
    },
  },
};

const DAY_MS = 86_400_000;

/**
 * Enforce the retention policy over `PURGE_TIER`.
 *
 * With `dryRun: true` it only COUNTS what would be destroyed. Otherwise it
 * deletes each expired batch and, when rows were destroyed, records a
 * `retention.purged` audit event. Failures are caught per model.
 */
export async function enforceRetention(opts?: {
  dryRun?: boolean;
}): Promise<RetentionPurgeResult[]> {
  const dryRun = opts?.dryRun === true;
  const now = Date.now();
  const results: RetentionPurgeResult[] = [];

  // Resolve the purge tier against the operator-configured retention windows
  // (settings.governance.retentionDays), canon underneath — so the cutoffs are
  // configurable from the admin surface while behaviour is unchanged until an
  // admin edits a window. `loadPlatformSettings` never throws (canon on failure).
  const { governance } = await loadPlatformSettings();
  const tier = purgeTierFor(governance.retentionDays);

  for (const { model, days } of tier) {
    const target = PURGE_TARGETS[model];
    if (!target) continue; // PURGE_TIER model with no time dimension — nothing to purge
    const cutoff = new Date(now - days * DAY_MS);

    try {
      if (dryRun) {
        const deleted = await target.count(cutoff);
        results.push({ model, days, deleted });
        continue;
      }

      const deleted = await target.purge(cutoff);
      results.push({ model, days, deleted });

      if (deleted > 0) {
        // ISO 15489 destruction trail — one audit event per purged model.
        await audit({
          action: "retention.purged",
          target: model,
          after: { deleted, days, basis: retentionFor(model)?.basis ?? "" },
        });
      }
    } catch (err) {
      console.error(`[retention] purge failed for ${model}`, err);
      results.push({ model, days, deleted: 0 });
    }
  }

  return results;
}
