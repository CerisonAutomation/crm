import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

/**
 * POST /api/n8n/executions/[id]/stop — stop a running execution
 * Requires workflow.write capability
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.write");

    const { id } = await params;

    // In a real implementation, this would call the n8n API to stop execution
    // For now, return mock data that matches the expected structure
    const mockStopResult = {
      success: true,
      message: `Execution ${id} stopped successfully`,
      stoppedAt: new Date().toISOString(),
    };

    return jsonOk(mockStopResult);
  })(req);
}
