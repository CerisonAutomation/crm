import { NextRequest, NextResponse } from "next/server";
import { db, withTenantContext } from "@/lib/db";
import { storageGet } from "@/lib/storage";
import { handler } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import { DomainError } from "@/lib/domain/states";

/**
 * GET /api/documents/[id]/content?variant=thumb|preview|original
 *
 * Streams a document's bytes. The document METADATA is served by
 * /api/documents/[id]; this route exists so the binary never rides inside a JSON
 * payload (base64 in JSON inflates a 4 MB scan to ~5.4 MB and blocks the
 * response until the whole string is built).
 *
 * `variant` selects a pre-generated rendition so a list view can paint a 192px
 * thumbnail from ~15 KB instead of pulling a 4000px scan. Renditions are built
 * once at upload time by the image pipeline; requesting one that does not exist
 * for this document is a 404 — never a silent fallback to the original, which
 * would defeat the point of asking for a thumbnail.
 *
 * Authorisation mirrors /api/documents/[id]: clients may read only their own
 * case's documents; every other role is confined to its organisation.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    const variant = (new URL(r.url).searchParams.get("variant") ?? "original").toLowerCase();

    // Tenant-scoped metadata read: under RLS the bytes lookup must resolve
    // inside the caller org, never by bare id. Vault bytes stream afterwards.
    const doc = await withTenantContext(ctx.orgId, (tx) =>
      tx.document.findUnique({
        where: { id },
        select: {
          id: true, fileName: true, mimeType: true, storageKey: true, imageMeta: true,
          case: { select: { clientId: true, orgId: true } },
        },
      }),
    );
    if (!doc) throw new DomainError("Document not found", 404);
    if (ctx.role === "CLIENT" && doc.case.clientId !== ctx.userId) throw new DomainError("Forbidden", 403);
    if (ctx.role !== "CLIENT" && doc.case.orgId !== ctx.orgId) throw new DomainError("Forbidden", 403);

    let key = doc.storageKey;
    let contentType = doc.mimeType;
    let fileName = doc.fileName;

    if (variant !== "original") {
      const meta = parseImageMeta(doc.imageMeta);
      const derivative = meta?.derivatives.find((d) => d.name === variant);
      // A missing rendition is a real 404: falling back to the original would
      // hand a caller asking for a thumbnail the full-size scan instead.
      if (!derivative) throw new DomainError(`No "${variant}" rendition for this document`, 404);
      key = derivative.storageKey;
      contentType = derivative.mimeType;
      fileName = `${doc.fileName}.${variant}.webp`;
    }

    const bytes = await storageGet(key);
    if (!bytes) throw new DomainError("Document content is unavailable", 404);

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
        // `private` — these are personal documents and must never sit in a
        // shared CDN cache. immutable: a document's bytes never change under an
        // id (a corrected upload creates a new version).
        "cache-control": "private, max-age=3600, immutable",
        "content-disposition": `inline; filename="${sanitiseFileName(fileName)}"`,
        "x-content-type-options": "nosniff",
      },
    });
  })(req);
}

type Derivative = { name: string; storageKey: string; mimeType: string; width: number; height: number; sizeBytes: number };
type ImageMeta = { width: number | null; height: number | null; derivatives: Derivative[] };

/** Parse the stored image metadata defensively — a malformed value reads as absent. */
function parseImageMeta(raw: string | null): ImageMeta | null {
  if (!raw || raw === "{}") return null;
  try {
    const parsed = JSON.parse(raw) as ImageMeta;
    if (!Array.isArray(parsed?.derivatives)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Strip anything that could break out of the filename parameter. */
function sanitiseFileName(name: string): string {
  return name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "document";
}
