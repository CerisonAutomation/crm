import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

/**
 * GET /api/n8n/workflows/[id]/status — get workflow status from n8n instance
 * Requires workflow.read capability
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.read");

    const { id } = await params;

    // In a real implementation, this would call the n8n API to get workflow status
    // For now, return mock data that matches the expected structure
    const mockStatus = {
      status: {
        id,
        active: true,
        lastExecution: {
          id: "execution123",
          status: "success",
          startedAt: "2026-10-12T09:30:00Z",
          completedAt: "2026-10-12T09:35:00Z",
        },
        nextScheduledRun: "2026-10-13T10:30:00Z",
        totalExecutions: 42,
        successRate: 0.95,
      },
    };

    return jsonOk(mockStatus);
  })(req);
}
