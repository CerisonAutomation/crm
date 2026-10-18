import { NextRequest } from "next/server";
import { handler, jsonOk } from "@/lib/api-helpers";
import { requireAuth, requireCapability } from "@/lib/auth";

/**
 * GET /api/n8n/executions/[id] — get details of a specific execution from n8n instance
 * Requires workflow.read capability
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return handler(async (r) => {
    const ctx = await requireAuth(r);
    requireCapability(ctx, "workflow.read");

    const { id: executionId } = await params;

    // In a real implementation, this would call the n8n API to get execution details
    // For now, return mock data that matches the expected structure
    const mockExecutionDetail = {
      id: executionId,
      workflowName: executionId === "execution1"
        ? "Client Onboarding Workflow"
        : executionId === "execution2"
          ? "Document Approval Workflow"
          : executionId === "execution3"
            ? "Case Escalation Workflow"
            : "Client Onboarding Workflow",
      status: executionId === "execution1"
        ? "success"
        : executionId === "execution2"
          ? "error"
          : executionId === "execution3"
            ? "success"
            : "running",
      startedAt: executionId === "execution1"
        ? "2026-10-12T09:30:00Z"
        : executionId === "execution2"
          ? "2026-10-11T16:45:00Z"
          : executionId === "execution3"
            ? "2026-10-10T08:15:00Z"
            : "2026-10-12T10:15:00Z",
      completedAt: executionId === "execution4"
        ? null
        : executionId === "execution1"
          ? "2026-10-12T09:32:15Z"
          : executionId === "execution2"
            ? "2026-10-11T16:46:30Z"
            : "2026-10-10T08:20:45Z",
      output: executionId === "execution1"
        ? { 
            message: "Client onboarding completed successfully",
            clientId: "client123",
            welcomeEmailSent: true
          }
        : executionId === "execution2"
          ? { error: "Missing required document: passport scan" }
          : executionId === "execution3"
            ? { 
                escalatedTo: "senior RM",
                notificationsSent: 2,
                caseUpdated: true
              }
            : { 
                inProgress: true,
                currentStep: "Document verification"
              },
      error: executionId === "execution2"
        ? "Validation failed: Missing required document"
        : null,
    };

    return jsonOk({ execution: mockExecutionDetail });
  })(req);
}
