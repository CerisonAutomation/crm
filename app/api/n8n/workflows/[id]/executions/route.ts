import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

/**
 * GET /api/n8n/workflows/[id]/executions — get execution history for a workflow
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

    // In a real implementation, this would call the n8n API to get workflow executions
    // For now, return mock data that matches the expected structure
    const mockExecutions = {
      executions: [
        {
          id: "execution1",
          status: "success",
          startedAt: "2026-10-12T09:30:00Z",
          completedAt: "2026-10-12T09:35:00Z",
          durationMs: 300000,
        },
        {
          id: "execution2",
          status: "error",
          startedAt: "2026-10-11T14:22:00Z",
          completedAt: "2026-10-11T14:22:30Z",
          durationMs: 30000,
        },
        {
          id: "execution3",
          status: "success",
          startedAt: "2026-10-10T09:15:00Z",
          completedAt: "2026-10-10T09:20:00Z",
          durationMs: 300000,
        },
      ],
    };

    return jsonOk(mockExecutions);
  })(req);
}
