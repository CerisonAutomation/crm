import { NextRequest } from "next/server";
import { handler } from "@/lib/api-helpers";
import { loadBrandSettings } from "@/lib/brand/settings";
import { sealSvgString } from "@/components/brand/seal-paths";

/**
 * GET /api/brand/favicon.svg — DYNAMIC favicon rendered from the LIVE brand
 * tokens (DB row over canon). The layout's icon link points here; the static
 * PNG rasters under /icons stay as legacy fallbacks. Small, cacheable,
 * always in brand.
 */
export async function GET(req: NextRequest) {
  return handler(async () => {
    const brand = await loadBrandSettings();
    const svg = sealSvgString({
      markColor: brand.logo.markColor,
      monogramColor: brand.logo.monogramColor,
      panelFill: brand.logo.panelFill,
      panelOpacity: brand.logo.panelOpacity,
      // minimal detail + boosted strokes — crisp at 16–32 px tab sizes
      detail: "minimal",
      strokeBoost: 2.3,
    });
    return new Response(svg, {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=300", // short cache — settings changes propagate fast
      },
    });
  })(req);
}
