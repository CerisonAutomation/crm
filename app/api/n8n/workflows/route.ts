import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

/**
 * GET /api/n8n/workflows — get workflows from n8n instance
 * Requires workflow.read capability
 */
export async function GET(req: NextRequest) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.read");

    // In a real implementation, this would call the n8n API to get workflows
    // For now, return mock data that matches the expected structure
    const mockWorkflows = [
      {
        id: "workflow1",
        name: "Client Onboarding Workflow",
        active: true,
        nodeCount: 5,
        updatedAt: "2026-10-12T10:30:00Z",
      },
      {
        id: "workflow2",
        name: "Document Approval Workflow",
        active: false,
        nodeCount: 3,
        updatedAt: "2026-10-11T14:22:00Z",
      },
      {
        id: "workflow3",
        name: "Case Escalation Workflow",
        active: true,
        nodeCount: 7,
        updatedAt: "2026-10-10T09:15:00Z",
      },
    ];

    return jsonOk({ workflows: mockWorkflows });
  })(req);
}
