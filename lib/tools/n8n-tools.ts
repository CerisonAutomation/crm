import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { n8nNodeContractFor } from "@/lib/n8n/node-contracts";
import {
  getGlobalHookRegistry,
  type ExecutionContext,
  type ExecutionResult,
} from "@/lib/n8n/execution-hooks";
import { executeWithDedup } from "@/lib/n8n/execution-dedup";

/**
 * Executes an operation with retry logic that respects idempotency,
 * deduplication, and lifecycle hooks.
 * Following the patterns from cl-automation.txt and cl-nodes.txt:
 * - Idempotent operations can be safely retried
 * - At-least-once operations should not be automatically retried without deduplication
 */
async function executeWithIdempotencyRetry<T>(
  operation: () => Promise<T>,
  pieceKey: string,
  args: Record<string, unknown> = {},
  maxRetries = 3,
  baseDelayMs = 1000,
): Promise<T> {
  const contract = n8nNodeContractFor(pieceKey);
  const isIdempotent = contract.idempotency === "idempotent";
  const hooks = getGlobalHookRegistry();
  const startedAt = Date.now();

  const context: ExecutionContext = {
    pieceKey,
    idempotency: contract.idempotency,
    attempt: 0,
    startedAt,
    metadata: args,
  };

  // For at-least-once operations, check dedup first
  if (!isIdempotent) {
    const dedupResult = await executeWithDedup(
      { pieceKey, idempotency: contract.idempotency, args },
      operation,
    );
    if (dedupResult.skipped) {
      const result: ExecutionResult = {
        success: true,
        output: { skipped: true, reason: dedupResult.reason },
        durationMs: Date.now() - startedAt,
      };
      await hooks.emit("after", context, result);
      return dedupResult.result;
    }
    return dedupResult.result;
  }

  // Idempotent operations: retry with exponential backoff
  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    context.attempt = attempt;
    await hooks.emit("before", context);

    try {
      const result = await operation();
      const execResult: ExecutionResult = {
        success: true,
        output: result,
        durationMs: Date.now() - startedAt,
      };
      await hooks.emit("after", context, execResult);
      return result;
    } catch (error) {
      lastError = error;
      const execResult: ExecutionResult = {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
        durationMs: Date.now() - startedAt,
      };
      await hooks.emit("error", context, execResult);

      // If this is the last attempt, don't retry
      if (attempt === maxRetries) {
        break;
      }

      // Calculate delay with exponential backoff and jitter
      const delayMs = baseDelayMs * Math.pow(2, attempt) + Math.random() * 1000;

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // If we got here, all retries were exhausted
  throw lastError;
}

/**
 * Tool-based architecture for n8n workflow operations.
 * Encapsulates all n8n-related operations as reusable tools.
 */

/**
 * Export workflows as an n8n bundle.
 * @returns Promise containing the exported bundle
 */
export async function exportN8nWorkflowBundle() {
  try {
    const bundle = await api.n8nExport();
    toast.success("Workflow export successful", {
      description: `Exported ${bundle.counts?.workflows ?? 0} workflows with ${bundle.counts?.nodes ?? 0} nodes`,
    });
    return bundle;
  } catch (error) {
    toast.error("Workflow export failed", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

/**
 * Get list of n8n workflows.
 * @returns Promise containing workflows list
 */
export async function getN8nWorkflows() {
  try {
    const res = await executeWithIdempotencyRetry(
      () => api.n8nWorkflows(),
      "n8n.workflows",
    );
    return res.workflows;
  } catch (error) {
    toast.error("Failed to load workflows", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

/**
 * Get list of n8n executions.
 * @returns Promise containing executions list
 */
export async function getN8nExecutions() {
  try {
    const res = await executeWithIdempotencyRetry(
      () => api.n8nExecutions(),
      "n8n.executions",
    );
    return res.executions;
  } catch (error) {
    toast.error("Failed to load executions", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

/**
 * Get n8n workflow detail.
 * @param workflowId - The ID of the workflow to get details for
 * @returns Promise containing workflow detail
 */
export async function getN8nWorkflowDetail(workflowId: string) {
  try {
    const res = await executeWithIdempotencyRetry(
      () => api.n8nWorkflow(workflowId),
      "n8n.workflow",
      { workflowId },
    );
    return res.workflow;
  } catch (error) {
    toast.error("Failed to load workflow detail", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

/**
 * Get n8n execution detail.
 * @param executionId - The ID of the execution to get details for
 * @returns Promise containing execution detail
 */
export async function getN8nExecutionDetail(executionId: string) {
  try {
    const res = await executeWithIdempotencyRetry(
      () => api.n8nExecution(executionId),
      "n8n.execution",
      { executionId },
    );
    return res.execution;
  } catch (error) {
    toast.error("Failed to load execution detail", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

/**
 * Test an n8n workflow with a payload.
 * @param workflowId - The ID of the workflow to test
 * @param payload - The payload to send with the test
 * @returns Promise containing the test result
 */
export async function testN8nWorkflow(
  workflowId: string,
  payload: Record<string, unknown>,
) {
  try {
    const res = await executeWithIdempotencyRetry(
      () => api.n8nTestWorkflow(workflowId, payload),
      "n8n.testWorkflow",
      { workflowId, payload },
    );
    return res.output ?? res;
  } catch (error) {
    toast.error("Workflow test failed", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

/**
 * Toggle n8n workflow active state.
 * @param workflowId - The ID of the workflow to toggle
 * @param active - Whether to set the workflow as active or inactive
 * @returns Promise containing the toggle result
 */
export async function toggleN8nWorkflow(workflowId: string, active: boolean) {
  try {
    await executeWithIdempotencyRetry(
      () => api.n8nToggleWorkflow(workflowId, active),
      "n8n.toggleWorkflow",
      { workflowId, active },
    );
    toast.success(active ? "Workflow activated" : "Workflow deactivated", {
      description: `Workflow has been ${active ? "activated" : "deactivated"} successfully`,
    });
  } catch (error) {
    toast.error("Failed to toggle workflow", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

/**
 * Get the status of n8n workflows.
 * @param workflowId - Optional workflow ID to get status for a specific workflow
 * @returns Promise containing workflow status information
 */
export async function getN8nWorkflowStatus(workflowId?: string) {
  try {
    if (workflowId) {
      const result = await executeWithIdempotencyRetry(
        () => api.n8nWorkflowStatus(workflowId),
        "n8n.getWorkflowStatus",
        { workflowId },
      );
      return result;
    } else {
      const workflowsResult = await executeWithIdempotencyRetry(
        () => api.n8nWorkflows(),
        "n8n.listWorkflows",
      );
      const workflows = workflowsResult.workflows || [];
      const lastUpdated = new Date().toISOString();
      return { workflows, lastUpdated };
    }
  } catch (error) {
    toast.error("Failed to fetch workflow status", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

/**
 * Validate n8n workflow configuration.
 * @param workflowId - The ID of the workflow to validate
 * @returns Promise containing validation results
 */
export async function validateN8nWorkflow(workflowId: string) {
  try {
    const result = await executeWithIdempotencyRetry(
      () => api.n8nValidateWorkflow(workflowId),
      "n8n.validateWorkflow",
      { workflowId },
    );
    return result.validation;
  } catch (error) {
    toast.error("Workflow validation failed", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

/**
 * Get n8n execution history.
 * @param workflowId - Optional workflow ID to filter history
 * @param limit - Maximum number of executions to return
 * @returns Promise containing execution history
 */
export async function getN8nExecutionHistory(workflowId?: string, limit = 50) {
  try {
    if (workflowId) {
      const result = await executeWithIdempotencyRetry(
        () => api.n8nWorkflowExecutions(workflowId),
        "n8n.getWorkflowExecutions",
        { workflowId, limit },
      );
      const executions = (result.executions || []).slice(0, limit);
      return {
        executions,
        total: executions.length,
        workflowId,
      };
    } else {
      const result = await executeWithIdempotencyRetry(
        () => api.n8nExecutions(),
        "n8n.getExecutions",
        { limit },
      );
      const executions = (result.executions || []).slice(0, limit);
      return {
        executions,
        total: executions.length,
        workflowId,
      };
    }
  } catch (error) {
    toast.error("Failed to fetch execution history", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}

/**
 * Stop a running n8n workflow execution.
 * @param executionId - The ID of the execution to stop
 * @returns Promise containing the stop result
 */
export async function stopN8nExecution(executionId: string) {
  try {
    const result = await executeWithIdempotencyRetry(
      () => api.n8nStopExecution(executionId),
      "n8n.stopExecution",
      { executionId },
    );
    toast.success("Execution stopped", {
      description: result.message,
    });
    return result;
  } catch (error) {
    toast.error("Failed to stop execution", {
      description: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}
