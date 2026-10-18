import { handler } from "@/lib/api-helpers";
import { requireAuth } from "@/lib/auth";
import {
  registerAgent,
  delegateTask,
  getAgentStatus,
  completeDelegation,
  getAgentCapabilities,
  addAgentCapability,
  getAgents,
  getPendingDelegations,
} from "@/lib/services/agent-platform";

export const GET = handler(async (req) => {
  const { orgId } = await requireAuth(req);
  const { searchParams } = new URL(req.url);
  const agentId = searchParams.get("agentId");
  const type = searchParams.get("type");

  if (agentId) {
    const status = await getAgentStatus(orgId, agentId);
    return Response.json(status);
  }

  if (type === "pending") {
    const delegations = await getPendingDelegations(orgId);
    return Response.json(delegations);
  }

  const agents = await getAgents(orgId, type ?? undefined);
  return Response.json(agents);
});

export const POST = handler(async (req) => {
  const { orgId } = await requireAuth(req);
  const body = await req.json();
  const { action, name, description, agentType, model, config, agentId, task, context, delegatedTo, delegationId, status, result, capabilityName, capabilityDescription, capabilityConfig } = body;

  switch (action) {
    case "register_agent": {
      if (!name || !agentType) return Response.json({ error: "name and type required" }, { status: 400 });
      const agent = await registerAgent({ orgId, name, description, type: agentType, model, config });
      return Response.json(agent);
    }
    case "delegate_task": {
      if (!agentId || !task) return Response.json({ error: "agentId and task required" }, { status: 400 });
      const delegation = await delegateTask({ agentId, orgId, task, context, delegatedTo });
      return Response.json(delegation);
    }
    case "complete_delegation": {
      if (!delegationId || !status) return Response.json({ error: "delegationId and status required" }, { status: 400 });
      const delegation = await completeDelegation({ delegationId, status, result });
      return Response.json(delegation);
    }
    case "add_capability": {
      if (!agentId || !capabilityName) return Response.json({ error: "agentId and name required" }, { status: 400 });
      const capability = await addAgentCapability({ agentId, name: capabilityName, description: capabilityDescription, config: capabilityConfig });
      return Response.json(capability);
    }
    default:
      return Response.json({ error: "Invalid action" }, { status: 400 });
  }
});
