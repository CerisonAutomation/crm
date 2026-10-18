import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

/**
 * POST /api/n8n/workflows/[id]/validate — validate workflow configuration
 * Requires workflow.read capability
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.read");

    const { id } = await params;

    // In a real implementation, this would call the n8n API to validate workflow
    // For now, return mock data that matches the expected structure
    const mockValidation = {
      validation: {
        valid: true,
        errors: [],
        warnings: [
          {
            code: "WORKFLOW_WARNING_NODE_COUNT",
            message: "Consider breaking down large workflows",
            nodeId: "node3",
          },
        ],
        nodeCount: 5,
        checkedAt: new Date().toISOString(),
      },
    };

    return jsonOk(mockValidation);
  })(req);
}
