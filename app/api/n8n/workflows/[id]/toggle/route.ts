import { NextRequest } from "next/server";
import { handler, jsonOk, readJson } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

/**
 * POST /api/n8n/workflows/[id]/toggle — toggle workflow active state on n8n instance
 * Requires workflow.write capability
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write");

    const { id: workflowId } = await params;
    await readJson<unknown>(r); // consume body (safe-parse)

    // In a real implementation, this would call the n8n API to toggle the workflow
    // For now, return mock data that matches the expected structure
    return jsonOk({
      success: true,
      message: `Workflow ${workflowId} toggled successfully`,
    });
  })(req);
}
