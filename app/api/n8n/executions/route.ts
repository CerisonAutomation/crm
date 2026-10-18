import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

/**
 * GET /api/n8n/executions — get executions from n8n instance
 * Requires workflow.read capability
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.read");

    // In a real implementation, this would call the n8n API to get executions
    // For now, return mock data that matches the expected structure
    const mockExecutions = [
      {
        id: "execution1",
        workflowName: "Client Onboarding Workflow",
        status: "success",
        startedAt: "2026-10-12T09:30:00Z",
        completedAt: "2026-10-12T09:32:15Z",
      },
      {
        id: "execution2",
        workflowName: "Document Approval Workflow",
        status: "error",
        startedAt: "2026-10-11T16:45:00Z",
        completedAt: "2026-10-11T16:46:30Z",
      },
      {
        id: "execution3",
        workflowName: "Case Escalation Workflow",
        status: "success",
        startedAt: "2026-10-10T08:15:00Z",
        completedAt: "2026-10-10T08:20:45Z",
      },
      {
        id: "execution4",
        workflowName: "Client Onboarding Workflow",
        status: "running",
        startedAt: "2026-10-12T10:15:00Z",
        completedAt: null,
      },
    ];

    return jsonOk({ executions: mockExecutions });
  })(req);
}
