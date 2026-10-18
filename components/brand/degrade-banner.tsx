"use client";

import { useEffect, useState } from "react";
import { TriangleAlert } from "lucide-react";

type Health = { status?: string; deployment?: { findings?: string[] } };

/**
 * Degrade banner (P2-2) — polls GET /api/health and renders a strip when the
 * probe reports anything but "ready" (DB down, missing config, degraded
 * storage). Silent when healthy. Unreachable probe renders nothing: the
 * offline shell owns the no-network case, not this banner.
 */
export function DegradeBanner({ pollMs = 60_000 }: { pollMs?: number }) {
  const [finding, setFinding] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const check = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (!res.ok && res.status !== 503) return;
        const data = (await res.json()) as Health;
        if (!live) return;
        if (data.status && data.status !== "ready") {
          setFinding(data.deployment?.findings?.[0] ?? "Service degraded — some features may be limited.");
        } else {
          setFinding(null);
        }
      } catch {
        /* unreachable — the offline shell owns that case */
      }
    };
    void check();
    const t = setInterval(() => {
      void check();
    }, pollMs);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [pollMs]);
  if (!finding) return null;
  return (
    <div
      role="alert"
      className="flex items-center justify-center gap-2 px-4 py-1.5 text-[12px] font-medium bg-amber-500/15 text-amber-900 dark:text-amber-200"
    >
      <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
      {finding}
    </div>
  );
}
