/**
 * Communications & Dispatch — DHL port.
 * SANDBOX adapter: deterministic tracking simulation. No live DHL API is contacted.
 * The adapter contract (createShipment / getTrackingEvents) is the real integration surface —
 * swap the implementation for the live DHL REST adapter when credentials exist.
 */

export type ShipmentRequest = {
  caseRef: string;
  destination: string;
  documentRefs: string[];
};

export type Shipment = {
  trackingId: string;
  carrier: "DHL";
  labelRef: string;
  /** True when this shipment was fabricated by the sandbox adapter. */
  sandbox?: boolean;
};

export type TrackingEvent = { status: "DISPATCHED" | "IN_TRANSIT" | "DELIVERED"; at: Date; note: string };

const PREFIX = "JD014600003";

/** Deterministic tracking id derived from caseRef so replays never duplicate shipments. */
export async function createShipment(req: ShipmentRequest): Promise<Shipment> {
  const seed = [...req.caseRef].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) % 100000000;
  const trackingId = `${PREFIX}${String(seed).padStart(8, "0")}`;
  return { trackingId, carrier: "DHL", labelRef: `LBL-${trackingId}`, sandbox: true };
}

/** Sandbox tracking progression — deterministic per elapsed time since dispatch. */
export async function getTrackingEvents(dispatchedAt: Date): Promise<TrackingEvent[]> {
  const mins = (Date.now() - dispatchedAt.getTime()) / 60000;
  const events: TrackingEvent[] = [
    { status: "DISPATCHED", at: dispatchedAt, note: "Shipment information received (sandbox)" },
  ];
  if (mins > 1) events.push({ status: "IN_TRANSIT", at: new Date(dispatchedAt.getTime() + 60000), note: "Piece in transit (sandbox simulation)" });
  if (mins > 3) events.push({ status: "DELIVERED", at: new Date(dispatchedAt.getTime() + 180000), note: "Delivered — signed by AUTHORITY DESK (sandbox)" });
  return events;
}
