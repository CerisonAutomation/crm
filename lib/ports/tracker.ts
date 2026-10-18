// H2 port — dispatch tracker contract (Prisma-free, import anywhere).
// Courier tracking (DHL seam) sits behind this contract. H3 offline default
// reports UNKNOWN so dispatch status is never fabricated — the frozen bundle
// plus explicit tracking number remain the source of truth.

export type TrackStatus = "UNKNOWN" | "IN_TRANSIT" | "DELIVERED" | "EXCEPTION";

export type TrackResult = {
  status: TrackStatus;
  trackingNumber: string;
  detail: string;
};

export interface TrackerProvider {
  readonly name: string;
  track(trackingNumber: string): Promise<TrackResult>;
}

export const offlineTrackerProvider: TrackerProvider = {
  name: "offline",
  track: async (trackingNumber) => ({
    status: "UNKNOWN",
    trackingNumber,
    detail: "offline: tracker not reachable — see frozen bundle",
  }),
};
