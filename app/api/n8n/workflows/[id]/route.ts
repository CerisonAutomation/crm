import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

/**
 * GET /api/n8n/workflows/[id] — get details of a specific n8n workflow
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

    // In a real implementation, this would call the n8n API to get workflow details
    // For now, return mock data that matches the expected structure
    const mockWorkflow = {
      id,
      name: "Client Onboarding Workflow",
      active: true,
      nodeCount: 5,
      updatedAt: "2026-10-12T10:30:00Z",
      nodes: [
        { id: "node1", name: "Start", type: "n8n-nodes-base.start" },
        {
          id: "node2",
          name: "HTTP Request",
          type: "n8n-nodes-base.httpRequest",
        },
        { id: "node3", name: "Set", type: "n8n-nodes-base.set" },
        { id: "node4", name: "Email Send", type: "n8n-nodes-base.emailSend" },
        { id: "node5", name: "End", type: "n8n-nodes-base.end" },
      ],
      connections: {
        node1: { main: [{ node: "node2", type: "main", index: 0 }] },
        node2: { main: [{ node: "node3", type: "main", index: 0 }] },
        node3: { main: [{ node: "node4", type: "main", index: 0 }] },
        node4: { main: [{ node: "node5", type: "main", index: 0 }] },
      },
    };

    return jsonOk({ workflow: mockWorkflow });
  })(req);
}
