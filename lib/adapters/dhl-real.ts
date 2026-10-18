/**
 * DHL Express (MyDHL API) — Real adapter.
 *
 * Implements the adapter contract used by the dispatch workflow piece and the
 * tracking webhook endpoint. Reads credentials from the IntegrationSetting
 * (key: "dhl") which an admin configures in the console. Falls back to the
 * sandbox adapter when not configured so local development still works.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getIntegration } from "@/lib/integrations";
import { officeByKey } from "@/lib/domain/brand";

/**
 * The registered Zurich office, split for the MyDHL `shipper` block. Derived
 * from the single brand source of truth so a dossier never ships from a
 * hardcoded placeholder address.
 */
function zurichShipper(): {
  name: string;
  streetLines: string[];
  postalCode: string;
  city: string;
  countryCode: string;
  phone: string;
  email: string;
} {
  const o = officeByKey("zurich");
  const address = o?.address ?? ["Citizen Lane GmbH", "Fabrikweg 2", "8306 Brüttisellen", "Switzerland"];
  const name = address[0] ?? "Citizen Lane GmbH";
  const street = address.slice(1, Math.max(1, address.length - 2));
  const locality = address[address.length - 2] ?? "8306 Brüttisellen";
  const match = locality.match(/^(\d{4})\s+(.*)$/);
  return {
    name,
    streetLines: street.length > 0 ? street : ["Fabrikweg 2"],
    postalCode: match?.[1] ?? "8306",
    city: match?.[2] ?? "Brüttisellen",
    countryCode: "CH",
    phone: o?.phone ?? "+41 55 511 54 00",
    email: "info@citizen-lane.com",
  };
}

export type ShipmentRequest = {
  caseRef: string;
  destination: string;
  documentRefs: string[];
  /** Express product code (P/B/E/D/V/X) — falls back to the integration default. */
  product?: string;
  // Optional override from UI / workflow context
  pieces?: Array<{
    weightKg: number;
    dimensionsCm: { length: number; width: number; height: number };
    description: string;
  }>;
};

export type Shipment = {
  trackingId: string;
  carrier: "DHL";
  labelRef: string;
  labelUrl?: string;
  labelPdfBase64?: string;
  /** False for a real MyDHL shipment; the sandbox adapter sets true. */
  sandbox?: boolean;
};

export type TrackingEvent = {
  status: "DISPATCHED" | "IN_TRANSIT" | "DELIVERED" | "EXCEPTION";
  at: Date;
  note: string;
  location?: string;
};

export type DHLConfig = {
  accountNumber: string;
  username: string;
  password: string;
  environment: "test" | "production";
  defaultProduct?: string;
  /** Optional declared value (CHF) for customs — falls back to 100 for document shipments. */
  declaredValue?: string | number;
  /**
   * Shared secret DHL uses to sign tracking webhooks (HMAC-SHA256 over the raw
   * body). Optional: when absent, the tracking webhook route fails closed rather
   * than accepting unsigned callbacks. Falls back to DHL_WEBHOOK_SECRET.
   */
  webhookSecret?: string;
};

function baseUrl(env: "test" | "production"): string {
  return env === "test"
    ? "https://express.api.dhl.com/mydhlapi/test"
    : "https://express.api.dhl.com/mydhlapi";
}

async function authHeader(config: DHLConfig): Promise<string> {
  const credentials = `${config.username}:${config.password}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

/** Get DHL integration config (decrypted secrets). */
async function getDHLConfig(): Promise<DHLConfig | null> {
  const { active, config } = await getIntegration("dhl");
  if (!active) return null;
  return config as unknown as DHLConfig;
}

/**
 * Parse a free-text destination into DHL address parts.
 *
 * Supported formats (comma-separated, tail-first detection):
 *   "Authority name, City"                       → country falls back to CH
 *   "Authority name, Street, 8000 City, CH"      → full international address
 * The last part is the country when it is a 2-letter ISO code; a leading
 * 4-digit postal code on the city part is split out. Anything left becomes the
 * consignee name, with the street omitted only when the input is shorter.
 */
function parseDestination(destination: string): {
  name: string;
  streetLines: string[];
  postalCode: string;
  city: string;
  countryCode: string;
} {
  const parts = destination.split(",").map((s) => s.trim()).filter(Boolean);
  let countryCode = "CH";
  if (parts.length > 1 && /^[A-Za-z]{2}$/.test(parts[parts.length - 1])) {
    countryCode = parts.pop()!.toUpperCase();
  }
  let city = parts.length > 0 ? parts[parts.length - 1] : "Zurich";
  if (parts.length > 1) parts.pop();
  let postalCode = "0000";
  const pm = city.match(/^(\d{4})\s+(.+)$/);
  if (pm) {
    postalCode = pm[1];
    city = pm[2];
  }
  const name = parts.shift() ?? destination;
  const streetLines = parts.length > 0 ? parts : [name];
  return { name, streetLines, postalCode, city, countryCode };
}

/** Build the minimal DHL Shipment request body (MyDHL API v3+). */
function buildShipmentRequest(req: ShipmentRequest, config: DHLConfig): Record<string, unknown> {
  const product = req.product?.trim() || config.defaultProduct || "P";
  const dest = parseDestination(req.destination);
  const shipper = zurichShipper();
  const declaredValue = Number(config.declaredValue);
  const value = Number.isFinite(declaredValue) && declaredValue > 0 ? declaredValue : 100;

  return {
    plannedShippingDateAndTime: new Date().toISOString().slice(0, 16), // YYYY-MM-DDTHH:MM
    pickup: {
      isRequested: false,
    },
    product: product,
    accounts: [
      {
        number: config.accountNumber,
        typeCode: "shipper",
      },
    ],
    shipper: {
      name: shipper.name,
      address: {
        streetLines: shipper.streetLines,
        city: shipper.city,
        postalCode: shipper.postalCode,
        countryCode: shipper.countryCode,
      },
      contact: {
        personName: "Dispatch Desk",
        phoneNumber: shipper.phone,
        email: shipper.email,
      },
    },
    consignee: {
      // The destination is free text entered by the RM (authority name, city,
      // optionally street/postal/country) — never a fabricated placeholder.
      name: dest.name,
      address: {
        streetLines: dest.streetLines,
        city: dest.city,
        countryCode: dest.countryCode,
        postalCode: dest.postalCode,
      },
      contact: {
        // MyDHL requires a consignee contact, but the free-text destination
        // carries no phone/email. The shipper's dispatch desk is used so the
        // carrier always reaches a real human — swap in consignee contact
        // details when an authority address book is modelled.
        personName: shipper.name,
        phoneNumber: shipper.phone,
        email: shipper.email,
      },
    },
    details: {
      shipmentReason: "DOCUMENTS",
      currencyCode: "CHF",
      unitOfMeasurement: "metric",
      weight: req.pieces?.[0]?.weightKg ?? 0.5,
      dimensions: req.pieces?.[0]?.dimensionsCm ?? { length: 30, width: 21, height: 2 },
      numberOfPieces: req.pieces?.length ?? 1,
      descriptionOfContents: req.pieces?.[0]?.description ?? "Immigration documents",
      items: req.pieces?.map((p, i) => ({
        pieceId: String(i + 1),
        description: p.description,
        weight: p.weightKg,
        dimensions: p.dimensionsCm,
      })) ?? [
        {
          pieceId: "1",
          description: "Immigration documents",
          weight: 0.5,
          dimensions: { length: 30, width: 21, height: 2 },
        },
      ],
      value: value,
      customs: {
        declaredValue: value,
        incoterm: "DAP",
      },
    },
    label: {
      outputType: "PDF",
      template: "A4",
      paperSize: "A4",
    },
    customerReferences: [
      { value: req.caseRef, typeCode: "CU" },
    ],
    valueAddedServices: [],
  };
}

function mapDHLStatus(statusCode: string, statusDescription: string): TrackingEvent["status"] {
  const code = statusCode?.toUpperCase();
  if (code === "DL" || code === "DEL" || statusDescription?.toLowerCase().includes("delivered")) return "DELIVERED";
  if (code === "IN" || code === "TR" || statusDescription?.toLowerCase().includes("transit") || statusDescription?.toLowerCase().includes("sort")) return "IN_TRANSIT";
  if (code === "DP" || code === "DI" || statusDescription?.toLowerCase().includes("dispatch")) return "DISPATCHED";
  return "EXCEPTION";
}

/**
 * Create a real DHL Express shipment via MyDHL API.
 * Falls back to sandbox adapter when integration is not configured.
 */
export async function createShipment(req: ShipmentRequest): Promise<Shipment> {
  const config = await getDHLConfig();
  if (!config) {
    const { createShipment: sandboxCreate } = await import("./dhl");
    return sandboxCreate(req);
  }

  const url = `${baseUrl(config.environment)}/shipments`;
  const body = buildShipmentRequest(req, config);
  const auth = await authHeader(config);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: auth,
      "Accept": "application/json",
    },
    body: JSON.stringify(body),
    // DHL must never wedge a case action — bound the call like every other outbound.
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const error = await res.text().catch(() => "Unknown error");
    console.error("[DHL] createShipment failed:", res.status, error);
    throw new Error(`DHL shipment creation failed: ${res.status} ${error}`);
  }

  const data = await res.json();
  const trackingId = data.shipments?.[0]?.shipmentTrackingNumber ?? data.trackingNumber;
  const labelUrl = data.shipments?.[0]?.labelImage?.[0]?.labelUrl;
  const labelPdfBase64 = data.shipments?.[0]?.labelImage?.[0]?.labelContent;

  if (!trackingId) {
    throw new Error("DHL response missing tracking number");
  }

  return {
    trackingId,
    carrier: "DHL",
    labelRef: `LBL-${trackingId}`,
    labelUrl,
    labelPdfBase64,
    sandbox: false,
  };
}

/**
 * Get tracking events from DHL Unified Tracking API.
 * Falls back to sandbox simulation when not configured (requires dispatchedAt).
 */
export async function getTrackingEvents(trackingId: string, dispatchedAt?: Date): Promise<TrackingEvent[]> {
  const config = await getDHLConfig();
  if (!config) {
    // Sandbox fallback — deterministic progression based on elapsed time
    if (dispatchedAt) {
      const { getTrackingEvents: sandboxTracking } = await import("./dhl");
      return sandboxTracking(dispatchedAt);
    }
    return [];
  }

  const url = `${baseUrl(config.environment)}/track/shipments?trackingNumber=${encodeURIComponent(trackingId)}`;
  const auth = await authHeader(config);

  const res = await fetch(url, {
    headers: {
      Authorization: auth,
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    if (res.status === 404) return [];
    const error = await res.text().catch(() => "Unknown error");
    console.error("[DHL] getTrackingEvents failed:", res.status, error);
    throw new Error(`DHL tracking failed: ${res.status} ${error}`);
  }

  const data = await res.json();
  const shipments = data.shipments ?? [];
  const events: TrackingEvent[] = [];

  for (const shipment of shipments) {
    for (const event of shipment.events ?? []) {
      const timestamp = event.timestamp ? new Date(event.timestamp) : new Date();
      const status = mapDHLStatus(event.statusCode, event.description);
      events.push({
        status,
        at: timestamp,
        note: event.description ?? event.remark ?? "DHL tracking event",
        location: event.location?.address?.addressLocality ?? event.serviceArea?.name,
      });
    }
  }

  return events.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * Fetch a shipping label by tracking ID from DHL.
 * Returns null when the integration is not configured or the label is unavailable.
 */
export async function getLabel(trackingId: string): Promise<{ labelUrl?: string; labelPdfBase64?: string } | null> {
  const config = await getDHLConfig();
  if (!config) return null;

  const url = `${baseUrl(config.environment)}/shipments/${encodeURIComponent(trackingId)}/label`;
  const auth = await authHeader(config);

  const res = await fetch(url, {
    headers: {
      Authorization: auth,
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    if (res.status === 404) return null;
    const error = await res.text().catch(() => "Unknown error");
    console.error("[DHL] getLabel failed:", res.status, error);
    return null;
  }

  const data = await res.json();
  const labelUrl = data.labelUrl ?? data.label?.url;
  const labelPdfBase64 = data.labelContent ?? data.label?.content;

  if (!labelUrl && !labelPdfBase64) return null;
  return { labelUrl, labelPdfBase64 };
}

/**
 * Verify a DHL webhook signature (HMAC-SHA256).
 * DHL signs webhook payloads with the shared secret.
 */
export function verifyDHLWebhookSignature(
  secret: string,
  payload: string,
  signatureHeader: string | null
): boolean {
  if (!secret || !signatureHeader) return false;
  const provided = signatureHeader.startsWith("sha256=")
    ? signatureHeader.slice(7)
    : signatureHeader;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(provided, "utf8"), Buffer.from(expected, "utf8"));
}

/**
 * Resolve the DHL webhook signing secret: the integration config first, then a
 * DHL_WEBHOOK_SECRET env fallback. Null means "not configured" — the tracking
 * webhook route refuses every request when null (fail closed).
 */
export async function getDHLWebhookSecret(): Promise<string | null> {
  const cfg = await getDHLConfig();
  const fromConfig = cfg?.webhookSecret?.trim();
  if (fromConfig) return fromConfig;
  return process.env.DHL_WEBHOOK_SECRET?.trim() || null;
}