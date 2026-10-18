import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import { DomainError } from "@/lib/domain/states";

// ── Agent Registration ──────────────────────────────────────────

export async function registerAgent(params: {
  orgId: string;
  name: string;
  description?: string;
  type: "worker" | "supervisor" | "router" | "meta";
  model?: string;
  config?: Prisma.InputJsonValue;
}) {
  try {
    return await db.agent.create({
      data: {
        orgId: params.orgId,
        name: params.name,
        description: params.description,
        type: params.type,
        model: params.model,
        config: params.config,
      },
    });
  } catch (err) {
    throw new DomainError("Failed to register agent", 500);
  }
}

// ── Task Delegation ────────────────────────────────────────────

export async function delegateTask(params: {
  agentId: string;
  orgId: string;
  task: string;
  context?: Prisma.InputJsonValue;
  delegatedTo?: string;
}) {
  try {
    return await db.agentDelegation.create({
      data: {
        agentId: params.agentId,
        orgId: params.orgId,
        task: params.task,
        context: params.context,
        delegatedTo: params.delegatedTo,
      },
    });
  } catch (err) {
    throw new DomainError("Failed to delegate task", 500);
  }
}

// ── Get Agent Status ────────────────────────────────────────────

export async function getAgentStatus(orgId: string, agentId: string) {
  const agent = await db.agent.findFirst({
    where: { orgId, id: agentId },
    include: {
      delegations: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      capabilities: true,
    },
  });

  if (!agent) return null;

  const pendingCount = agent.delegations.filter((d) => d.status === "pending").length;
  const completedCount = agent.delegations.filter((d) => d.status === "completed").length;
  const failedCount = agent.delegations.filter((d) => d.status === "failed").length;

  return {
    ...agent,
    stats: {
      pending: pendingCount,
      completed: completedCount,
      failed: failedCount,
      total: agent.delegations.length,
    },
  };
}

// ── Complete Delegation ────────────────────────────────────────

export async function completeDelegation(params: {
  delegationId: string;
  status: "completed" | "failed";
  result?: Prisma.InputJsonValue;
}) {
  try {
    return await db.agentDelegation.update({
      where: { id: params.delegationId },
      data: {
        status: params.status,
        result: params.result,
        completedAt: new Date(),
      },
    });
  } catch (err) {
    throw new DomainError("Failed to complete delegation", 500);
  }
}

// ── Get Agent Capabilities ─────────────────────────────────────

export async function getAgentCapabilities(orgId: string, agentId: string) {
  return db.agentCapability.findMany({
    where: { agent: { orgId, id: agentId } },
  });
}

// ── Add Agent Capability ────────────────────────────────────────

export async function addAgentCapability(params: {
  agentId: string;
  name: string;
  description?: string;
  config?: Prisma.InputJsonValue;
}) {
  try {
    return await db.agentCapability.create({
      data: {
        agentId: params.agentId,
        name: params.name,
        description: params.description,
        config: params.config,
      },
    });
  } catch (err) {
    throw new DomainError("Failed to add agent capability", 500);
  }
}

// ── Get All Agents ──────────────────────────────────────────────

export async function getAgents(orgId: string, type?: string) {
  return db.agent.findMany({
    where: { orgId, active: true, ...(type ? { type } : {}) },
    include: { capabilities: true },
  });
}

// ── Get Pending Delegations ─────────────────────────────────────

export async function getPendingDelegations(orgId: string) {
  return db.agentDelegation.findMany({
    where: { orgId, status: "pending" },
    include: { agent: true },
    orderBy: { createdAt: "desc" },
  });
}
