import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { Prisma } from "@/generated/prisma/client";
import { storagePutWithHistory, storageDelete } from "@/lib/storage";
import { handler, jsonOk, readJson, audit, sniffMime, MAX_UPLOAD_BYTES } from "@/lib/api-helpers";
import { requireAuth, requireCapability, type AuthContext } from "@/lib/auth";
import { assertDocumentTransition, DomainError, DOC_TYPES, DOC_TYPE_LABELS } from "@/lib/domain/states";
import { loadPlatformSettings } from "@/lib/settings/store";
import { isFeatureEnabled } from "@/lib/settings/features";
import { runAuthoritativeOcr } from "@/lib/adapters/ocr/authoritative";
import { emitCaseEvent } from "@/lib/services/event-hub";
import { normaliseImage, derivativeKey, MAX_ORIGINAL_EDGE, type NormalisedImage } from "@/lib/media/images";
import { hit } from "@/lib/rate-limit";
import { fieldEncryption } from "@/lib/adapters/field-encryption";
import { shouldEncryptField } from "@/lib/ports/field-encryption";

const UploadBodySchema = z.object({
  type: z.enum(DOC_TYPES as unknown as [string, ...string[]]),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127),
  dataBase64: z.string().min(1),
  requestId: z.string().uuid().optional(),
  caseId: z.string().uuid().optional(),
});

type UploadBody = z.infer<typeof UploadBodySchema>;

/** Server-authoritative upload policy read once per request from the settings. */
type UploadPolicy = {
  platformSettings: Awaited<ReturnType<typeof loadPlatformSettings>>;
  maxUploadMb: number;
  maxUploadBytes: number;
  acceptedExtensions: Set<string>;
};

async function parseUploadBody(r: NextRequest): Promise<UploadBody> {
  const rawBody = await readJson<unknown>(r);
  const parseResult = UploadBodySchema.safeParse(rawBody);
  if (!parseResult.success) {
    throw new DomainError(`Invalid request body: ${parseResult.error.issues.map(e => e.message).join(", ")}`, 400);
  }
  return parseResult.data;
}

// ── maintenance gate ──
// The admin toggle that claims to block uploads now actually does. It stops
// every role, administrators included: the switch itself is the override, so
// an operator who needs to verify the fix turns it off rather than relying on
// a hidden bypass. Keeping it uniform also preserves the rule that this route
// never special-cases a role on its way to the tenant check below.
async function assertUploadsEnabled() {
  if (await isFeatureEnabled("maintenance_mode")) {
    throw new DomainError(
      "Uploads are paused for maintenance. Please try again shortly.",
      503,
    );
  }
}

// ── boundary validation ──
function validateUploadBoundary(body: UploadBody) {
  if (!DOC_TYPES.includes(body.type as (typeof DOC_TYPES)[number])) {
    throw new DomainError("Unknown document type", 400);
  }
  if (!body.fileName?.trim() || !body.mimeType?.trim() || !body.dataBase64) {
    throw new DomainError("fileName, mimeType and dataBase64 are required", 400);
  }
}

function assertUploadActor(ctx: AuthContext) {
  if (ctx.role === "AUDITOR") throw new DomainError("Forbidden", 403); // auditors are read-only
}

// ── rate limit: per IP + user (30 uploads / 15 min) ──
function enforceUploadRateLimit(ctx: AuthContext, r: NextRequest) {
  const ip = (r.headers.get("x-forwarded-for")?.split(",")[0] ?? r.headers.get("x-real-ip") ?? "local").trim();
  const gate = hit(`doc-upload:${ip}:${ctx.userId}`, 30, 15 * 60 * 1000);
  if (!gate.allowed) throw new DomainError(`Too many uploads — try again in ${gate.retryAfterSec}s`, 429);
}

// ── resolve the target case (object-level authorisation) ──
async function resolveTargetCase(ctx: AuthContext, body: UploadBody) {
  let kase;
  if (ctx.role === "CLIENT") {
    // clients may only ever target their OWN case — a supplied caseId is never honoured
    kase = await db.case.findFirst({ where: { clientId: ctx.userId } });
  } else {
    requireCapability(ctx, "document.read.all");
    if (!body.caseId) throw new DomainError("caseId is required", 400);
    kase = await db.case.findUnique({ where: { id: body.caseId } });
  }
  if (!kase) throw new DomainError("Case not found", 404);
  // Tenant isolation for every role, ADMIN included — a case in another
  // organisation is never a valid upload target.
  if (kase.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);

  // Link an optional document request — it must belong to the resolved case
  // AND still be answerable (S4: FULFILLED/CANCELLED requests are closed; an
  // upload against one would silently satisfy nothing while flipping counts).
  if (body.requestId) {
    const request = await db.documentRequest.findUnique({ where: { id: body.requestId } });
    if (!request || request.caseId !== kase.id) throw new DomainError("Unknown document request", 400);
    if (request.status !== "OPEN" && request.status !== "OVERDUE") {
      throw new DomainError(`Document request is ${request.status} — no upload can be attached to it`, 400);
    }
  }
  return kase;
}

// ── upload policy (server-authoritative) ──
// Read the admin-editable cap and accepted extensions ONCE for this request.
// The client can never supply its own limit: the cap comes from the settings,
// is clamped to 1–50 MB, and MAX_UPLOAD_BYTES remains the hard fallback when
// the setting is absent. The setting also carries the doc-type label below.
async function loadUploadPolicy(): Promise<UploadPolicy> {
  const platformSettings = await loadPlatformSettings();
  const rawMaxMb = platformSettings.operations.maxUploadMb;
  const maxUploadMb = Number.isFinite(rawMaxMb) ? Math.min(50, Math.max(1, Math.round(rawMaxMb))) : 10;
  const maxUploadBytes = Number.isFinite(rawMaxMb) ? maxUploadMb * 1024 * 1024 : MAX_UPLOAD_BYTES;
  const acceptedExtensions = new Set(
    platformSettings.operations.acceptedExtensions.map((e) => e.toLowerCase().replace(/^\./, "")),
  );
  return { platformSettings, maxUploadMb, maxUploadBytes, acceptedExtensions };
}

type DecodedUpload = { dataBase64: string; bytes: Buffer; declaredMime: string };

// ── decode + size cap + magic-byte sniff (the declared MIME is never trusted) ──
function decodeUploadFile(body: UploadBody, policy: UploadPolicy): DecodedUpload {
  const dataBase64 = body.dataBase64.replace(/^data:[^;]+;base64,/, "");
  const bytes = Buffer.from(dataBase64, "base64");
  const sizeBytes = bytes.byteLength;
  if (sizeBytes > policy.maxUploadBytes) throw new DomainError(`File exceeds ${policy.maxUploadMb} MB cap`, 413);
  const extension = (body.fileName.split(".").pop() ?? "").toLowerCase();
  if (!policy.acceptedExtensions.has(extension)) throw new DomainError("File type not accepted", 415);
  const sniffed = sniffMime(dataBase64);
  if (sniffed === "unknown") throw new DomainError("Unsupported or unrecognised file type", 415);
  const declaredMime = sniffed === "pdf" ? "application/pdf" : body.mimeType.startsWith("image/") ? body.mimeType : "image/jpeg";
  return { dataBase64, bytes, declaredMime };
}

// ── normalise images: drop EXIF/GPS, cap the long edge, build renditions ──
// A passport photo carries the applicant's location in EXIF; a phone shot is
// routinely 40 MB. Both are normalised once, here, so every downstream reader
// (OCR, preview, download) sees the same sanitised object. Non-images and
// undecodable files pass through untouched.
async function normaliseUploadImage(bytes: Buffer, declaredMime: string, maxUploadMb: number) {
  const image = await normaliseImage(bytes, declaredMime, {
    maxEdge: maxUploadMb >= 20 ? 5000 : MAX_ORIGINAL_EDGE,
  });
  const mimeType = image.normalised ? image.mimeType : declaredMime;
  const storedSize = image.bytes.byteLength;
  return { image, mimeType, storedSize };
}

// ── persist bytes to the vault ──
async function persistUploadedDocument(
  ctx: AuthContext,
  body: UploadBody,
  kaseId: string,
  image: NormalisedImage,
  mimeType: string,
  storedSize: number,
  policy: UploadPolicy,
) {
  const documentId = randomUUID();
  const storageKey = `vault://cases/${kaseId}/documents/${documentId}.bin`;
  await storagePutWithHistory(storageKey, image.bytes);

  // Renditions are written first-class and addressed FROM the original key, so a
  // missing derivative is a 404 the UI can fall back from — never a broken page.
  const derivatives = await Promise.all(
    image.derivatives.map(async (d) => {
      const key = derivativeKey(storageKey, d.name);
      await storagePutWithHistory(key, d.bytes);
      return { name: d.name, storageKey: key, mimeType: d.mimeType, width: d.width, height: d.height, sizeBytes: d.sizeBytes };
    }),
  );

  // S2 orphan cleanup: bytes (original + renditions) land before the row —
  // if the row write fails, remove what was just written (best-effort) so a
  // failed upload leaves neither a row without bytes nor bytes without a row.
  try {
    return await db.document.create({
      data: {
        id: documentId,
        caseId: kaseId,
      requestId: body.requestId ?? null,
      type: body.type,
      title: policy.platformSettings.labels.docTypes[body.type] ?? DOC_TYPE_LABELS[body.type] ?? body.type,
      fileName: body.fileName,
      mimeType,
      sizeBytes: storedSize,
      storageKey,
      status: "UPLOADED",
      scanStatus: "PENDING",
      version: 1,
      uploadedBy: ctx.userId,
      // Source dimensions + derivative map ride along as JSON, so nothing has to
      // re-decode the object to know which renditions exist.
      ...(image.normalised
        ? { imageMeta: JSON.stringify({ width: image.width, height: image.height, derivatives }) } : undefined),
      },
    });
  } catch (err) {
    await storageDelete(storageKey).catch(() => undefined);
    await Promise.all(derivatives.map((d) => storageDelete(d.storageKey).catch(() => undefined)));
    throw err;
  }
}

// ── close the request this upload answers ──
// A request is fulfilled the moment its document arrives: the client's
// "Received" badge and the RM's open-request count both read this status,
// and nothing else in the codebase ever writes FULFILLED — without it the
// sweep flips every answered request to OVERDUE and the applicant is told
// the document is still outstanding.
async function closeFulfilledRequest(requestId: string | undefined) {
  if (!requestId) return;
  await db.documentRequest.updateMany({
    where: { id: requestId, status: { in: ["OPEN", "OVERDUE"] } },
    data: { status: "FULFILLED" },
  });
}

// Receipt-shaped OCR outcome: the authoritative pipeline returns a sealed
// receipt (no raw engine fields) — provisional extracted fields come ONLY
// from the independently re-verified MRZ (R1), never from engine metadata.
type OcrOutcome = {
  provider: string;
  confidence: number;
  error: string | null;
  fieldCount: number;
  ocrFailed: boolean;
  status: string;
};

// ── state machine: UPLOADED → OCR_PROCESSING → OCR_PROCESSED (or back to UPLOADED) ──
// Stage-2 authoritative OCR (server desk-side pipeline): normalised bytes,
// sha256-bound, engine text re-verified against mrz.ts check digits, searchable
// PDF + text sidecar persisted through the ArtifactSink, sealed receipt stored
// on the job. The engine's own serverless sandbox fallback is preserved
// inside runAuthoritativeOcr (it calls the same engine).
async function processUploadOcr(args: {
  documentId: string;
  caseId: string;
  dataBase64: string;
  mimeType: string;
}): Promise<OcrOutcome> {
  const { documentId, caseId, dataBase64, mimeType } = args;
  assertDocumentTransition("UPLOADED", "OCR_PROCESSING");
  await db.document.update({ where: { id: documentId }, data: { status: "OCR_PROCESSING" } });

  const ocrJob = await db.ocrJob.create({
    data: { documentId, status: "RUNNING", provider: "authoritative", attempts: 1, startedAt: new Date() },
  });

  let provider = "authoritative";
  let confidence = 0;
  let error: string | null = null;
  let fieldCount = 0;
  let ocrFailed = false;
  try {
    const receipt = await runAuthoritativeOcr({
      documentId,
      bytes: Buffer.from(dataBase64, "base64"),
      mimeType,
      store: async ({ suffix, bytes }) => {
        const key = `vault://cases/${caseId}/documents/${documentId}.ocr.${suffix}`;
        await storagePutWithHistory(key, bytes);
        return key;
      },
    });
    provider = "authoritative";
    confidence = receipt.confidence;
    assertDocumentTransition("OCR_PROCESSING", "OCR_PROCESSED");
    await db.document.update({ where: { id: documentId }, data: { status: "OCR_PROCESSED" } });
    await db.ocrJob.update({
      where: { id: ocrJob.id },
      data: { status: "SUCCEEDED", provider, engineVersion: receipt.model, inputSha256: receipt.inputSha256, passCount: 1, metadata: receipt as unknown as Prisma.InputJsonValue, confidence: receipt.confidence, error: null, finishedAt: new Date() },
    });
    // Provisional fields ONLY from a check-digit-valid MRZ. Non-MRZ docs and
    // failed verifications persist no fields — the desk reads them by hand
    // (FS-9 human gate) instead of confirming unverified engine guesses.
    if (receipt.mrz?.isValid) {
      const provenance = {
        provider,
        model: receipt.model,
        inputSha256: receipt.inputSha256,
        quality: receipt.quality,
        mrzChecks: receipt.mrz.checks,
        decision: receipt.decision,
        provisional: true,
      } as Prisma.InputJsonValue;
      const caseRow = await db.case.findUnique({ where: { id: caseId }, select: { orgId: true } });
      if (!caseRow) throw new DomainError("Case not found for document", 404);
      for (const [fieldKey, value] of Object.entries(receipt.mrz.fields)) {
        if (value == null || value === "") continue;
        // FIELD-ENC: identity numbers sealed at rest; a seal throw fails closed into the OCR catch below.
        const stored = shouldEncryptField(fieldKey) ? fieldEncryption.seal(caseRow.orgId, fieldKey, value) : value;
        await db.extractedField.upsert({
          where: { documentId_fieldKey: { documentId, fieldKey } },
          update: { value: stored, confidence: receipt.confidence, source: "OCR", provenance },
          create: { documentId, fieldKey, value: stored, confidence: receipt.confidence, source: "OCR", provenance },
        });
        fieldCount++;
      }
    }
  } catch (err) {
    // OCR threw — roll the document back to UPLOADED (retryable) and fail the job.
    ocrFailed = true;
    error = err instanceof Error ? err.message : String(err);
    assertDocumentTransition("OCR_PROCESSING", "UPLOADED");
    await db.document.update({ where: { id: documentId }, data: { status: "UPLOADED" } });
    await db.ocrJob.update({
      where: { id: ocrJob.id },
      data: { status: "FAILED", error, finishedAt: new Date() },
    });
  }

  const status = ocrFailed ? "UPLOADED" : "OCR_PROCESSED";
  return { provider, confidence, error, fieldCount, ocrFailed, status };
}

// ── audit + event fan-out ──
async function auditUploadOutcome(args: {
  ctx: AuthContext;
  correlationId: string;
  reference: string;
  caseId: string;
  documentId: string;
  docType: string;
  fileName: string;
  ocrProvider: string;
  ocrFields: number;
  ocrFailed: boolean;
}) {
  const { ctx, correlationId, reference, caseId, documentId, docType, fileName, ocrProvider, ocrFields, ocrFailed } = args;
  await audit({
    orgId: ctx.orgId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    action: "document.uploaded",
    target: `${reference}/${docType}`,
    after: { documentId, docType, fileName, ocrProvider, ocrFields, ocrFailed },
    correlationId,
  });
  await emitCaseEvent("document.uploaded", {
    caseId,
    actorId: ctx.userId,
    actorLabel: `${ctx.name} [${ctx.role}]`,
    meta: { documentId, docType, fileName, ocrProvider, ocrFields, ocrFailed },
    dedupeKey: documentId,
  });
}

// POST /api/documents/upload — clients upload to their own case; staff (document.read.all)
// upload to an explicit case. Bytes go to the vault, the OCR pipeline runs and the
// extracted fields are persisted for downstream human confirmation.
export async function POST(req: NextRequest) {
  return handler(async (r, correlationId) => {
    const ctx = await requireAuth(r);
    const body = await parseUploadBody(r);

    await assertUploadsEnabled();

    validateUploadBoundary(body);

    assertUploadActor(ctx);
    enforceUploadRateLimit(ctx, r);
    const kase = await resolveTargetCase(ctx, body);

    // M1 duplicate guard: retries and double-clicks must not mint duplicate
    // rows. Same case + type + fileName within 5 minutes returns the in-flight
    // row (200, deduped) instead of creating a second document — no second
    // audit/event fan-out, no second OCR job.
    const dupeWindow = new Date(Date.now() - 5 * 60 * 1000);
    const dupe = await db.document.findFirst({
      where: { caseId: kase.id, type: body.type, fileName: body.fileName, createdAt: { gte: dupeWindow } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (dupe) return jsonOk({ document: { id: dupe.id, status: dupe.status }, deduped: true });

    const policy = await loadUploadPolicy();
    const file = decodeUploadFile(body, policy);
    const { image, mimeType, storedSize } = await normaliseUploadImage(file.bytes, file.declaredMime, policy.maxUploadMb);
    const created = await persistUploadedDocument(ctx, body, kase.id, image, mimeType, storedSize, policy);
    await closeFulfilledRequest(body.requestId);

    // The `ai_ocr` flag is the switch the console has always advertised. When it
    // is off the document is stored and left at UPLOADED with no job and no
    // fields, so the desk reads it by hand — the upload itself still succeeds.
    const ocrEnabled = await isFeatureEnabled("ai_ocr");
    if (!ocrEnabled) {
      await auditUploadOutcome({
        ctx, correlationId, reference: kase.reference, caseId: kase.id,
        documentId: created.id, docType: created.type, fileName: created.fileName,
        ocrProvider: "disabled", ocrFields: 0, ocrFailed: false,
      });
      return jsonOk(
        {
          document: { id: created.id, status: "UPLOADED" },
          ocr: { provider: "disabled", confidence: 0, error: null, provisional: false },
        },
        201,
      );
    }

    const ocr = await processUploadOcr({ documentId: created.id, caseId: kase.id, dataBase64: file.dataBase64, mimeType });

    await auditUploadOutcome({
      ctx, correlationId, reference: kase.reference, caseId: kase.id,
      documentId: created.id, docType: created.type, fileName: created.fileName,
      ocrProvider: ocr.provider, ocrFields: ocr.fieldCount, ocrFailed: ocr.ocrFailed,
    });

    return jsonOk(
      {
        document: { id: created.id, status: ocr.status },
        ocr: { provider: ocr.provider, confidence: ocr.confidence, error: ocr.error, provisional: !ocr.ocrFailed },
      },
      201
    );
  })(req);
}
