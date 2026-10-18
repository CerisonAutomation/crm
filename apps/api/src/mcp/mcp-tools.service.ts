/**
 * Tool catalog for the MCP endpoint. Shape follows the Customermates
 * per-entity `*.mcp-tools.ts` modules: one `McpTool` per capability, Zod input
 * schema, structured results, serialized failures.
 */

import type { Db } from "@crm/db";
import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { AgentGovernanceService } from "../agent-governance/agent-governance.service";
import { BookingService } from "../booking/booking.service";
import { BrainService } from "../brain/brain.service";
import { ChannelsService } from "../channels/channels.service";
import { InjectDatabase } from "../database/database.constants";
import { RoutinesService } from "../routines/routines.service";
import { triggerTestErrorWorkflow } from "../workflows/trigger-test-error.workflow";
import { WorkflowRegistry } from "../workflows/workflow-registry.service";
import { WorkflowRunner } from "../workflows/workflow-runner.service";
import { type McpTool, type McpToolResult, mcpFailure } from "./mcp.types";

const idSchema = z.string().min(1).max(64);
const pageSchema = z.object({
	limit: z.number().int().min(1).max(50).default(20),
	offset: z.number().int().min(0).default(0),
});

/** Workflows an MCP client may dispatch directly. */
export const MCP_DISPATCHABLE_WORKFLOWS = ["trigger-test-error"] as const;

@Injectable()
export class McpToolsService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly routines: RoutinesService,
		private readonly registry: WorkflowRegistry,
		private readonly runner: WorkflowRunner,
		private readonly bookings: BookingService,
		private readonly channels: ChannelsService,
		private readonly brains: BrainService,
		private readonly governance: AgentGovernanceService,
	) {}

	catalog(): McpTool[] {
		return [
			this.systemHealth(),
			this.contactsSearch(),
			this.contactsGet(),
			this.companiesList(),
			this.dealsList(),
			this.dealsGet(),
			this.activitiesList(),
			this.routinesList(),
			this.routinesTrigger(),
			this.webhooksList(),
			this.workflowsList(),
			this.workflowsRun(),
			this.bookingSlots(),
			this.bookingCreate(),
			this.channelSendMessage(),
			this.brainAddNote(),
			this.agentDraftList(),
			this.agentDraftResolve(),
		];
	}

	private bookingSlots(): McpTool {
		return {
			name: "booking_slots",
			title: "Booking availability",
			description:
				"Free booking slots for an appointment type on a given UTC day.",
			annotations: { readOnlyHint: true },
			inputSchema: z.object({
				ownerUserId: idSchema,
				appointmentTypeId: idSchema,
				day: z.string().min(10).max(30),
			}),
			execute: async (input): Promise<McpToolResult> => {
				const { ownerUserId, appointmentTypeId, day } = input as unknown as {
					ownerUserId: string;
					appointmentTypeId: string;
					day: string;
				};
				const dayDate = new Date(day);
				if (Number.isNaN(dayDate.getTime()))
					return mcpFailure("validation", "day must be an ISO date");
				const slots = await this.bookings.slotsForDay(
					ownerUserId,
					appointmentTypeId,
					dayDate,
				);
				return {
					text: `${slots.length} slot(s) available`,
					structuredContent: {
						slots: slots.map((slot) => ({
							startsAt: slot.startsAt.toISOString(),
							endsAt: slot.endsAt.toISOString(),
						})),
					},
				};
			},
		};
	}

	private bookingCreate(): McpTool {
		return {
			name: "booking_create",
			title: "Create booking",
			description:
				"Books a slot on an appointment type (conflict-guarded, fires booking.created).",
			inputSchema: z.object({
				ownerUserId: idSchema,
				appointmentTypeId: idSchema.optional(),
				title: z.string().min(1).max(200),
				startsAt: z.string().min(10).max(30),
				fullName: z.string().max(200).optional(),
				email: z.string().max(320).optional(),
				notes: z.string().max(2000).optional(),
			}),
			execute: async (input): Promise<McpToolResult> => {
				const data = input as unknown as {
					ownerUserId: string;
					appointmentTypeId?: string;
					title: string;
					startsAt: string;
					fullName?: string;
					email?: string;
					notes?: string;
				};
				const startsAt = new Date(data.startsAt);
				if (Number.isNaN(startsAt.getTime()))
					return mcpFailure("validation", "startsAt must be an ISO date");
				try {
					const booking = await this.bookings.createBooking(data.ownerUserId, {
						appointmentTypeId: data.appointmentTypeId ?? null,
						title: data.title,
						startsAt,
						fullName: data.fullName ?? null,
						email: data.email ?? null,
						notes: data.notes ?? null,
						provider: "mcp",
					});
					return {
						text: "booking created",
						structuredContent: {
							bookingId: booking.id,
							startsAt: booking.startsAt.toISOString(),
							endsAt: booking.endsAt.toISOString(),
							status: booking.status,
						},
					};
				} catch (error) {
					return mcpFailure(
						"conflict",
						error instanceof Error ? error.message : String(error),
					);
				}
			},
		};
	}

	private channelSendMessage(): McpTool {
		return {
			name: "channel_send_message",
			title: "Send channel message",
			description:
				"Sends a WhatsApp/Messenger/Instagram/LinkedIn message (double-send-lock guarded; idempotencyKey required).",
			inputSchema: z.object({
				ownerUserId: idSchema,
				provider: z.enum(["whatsapp", "messenger", "instagram", "linkedin"]),
				recipientHandle: z.string().min(1).max(200),
				body: z.string().min(1).max(4000),
				idempotencyKey: z.string().min(1).max(200),
			}),
			execute: async (input): Promise<McpToolResult> => {
				const data = input as unknown as {
					ownerUserId: string;
					provider: "whatsapp" | "messenger" | "instagram" | "linkedin";
					recipientHandle: string;
					body: string;
					idempotencyKey: string;
				};
				try {
					const result = await this.channels.send(
						data.ownerUserId,
						data.provider,
						{ recipientHandle: data.recipientHandle, body: data.body },
						data.idempotencyKey,
					);
					return {
						text:
							result.outcome === "executed"
								? "message sent"
								: "send skipped (already claimed)",
						structuredContent: {
							outcome: result.outcome,
							externalMessageId: result.result?.externalMessageId ?? null,
						},
					};
				} catch (error) {
					return mcpFailure(
						"conflict",
						error instanceof Error ? error.message : String(error),
					);
				}
			},
		};
	}

	private brainAddNote(): McpTool {
		return {
			name: "brain_add_note",
			title: "Add brain note",
			description: "Adds a tag-indexed note to an organizational-memory brain.",
			inputSchema: z.object({
				ownerUserId: idSchema,
				brainId: idSchema,
				title: z.string().min(1).max(200),
				body: z.string().min(1).max(8000),
				tags: z.array(z.string().min(1).max(64)).max(20).optional(),
				source: z.string().max(64).optional(),
			}),
			execute: async (input): Promise<McpToolResult> => {
				const data = input as unknown as {
					ownerUserId: string;
					brainId: string;
					title: string;
					body: string;
					tags?: string[];
					source?: string;
				};
				try {
					const note = await this.brains.addNote(
						data.ownerUserId,
						data.brainId,
						{
							title: data.title,
							body: data.body,
							tags: data.tags,
							source: data.source ?? "mcp",
						},
					);
					return {
						text: "note added",
						structuredContent: { noteId: note.id, tags: note.tags },
					};
				} catch (error) {
					return mcpFailure(
						"conflict",
						error instanceof Error ? error.message : String(error),
					);
				}
			},
		};
	}

	private agentDraftList(): McpTool {
		return {
			name: "agent_draft_list",
			title: "Pending agent drafts",
			description: "Lists pending agent action drafts awaiting review.",
			annotations: { readOnlyHint: true },
			inputSchema: z.object({ ownerUserId: idSchema }),
			execute: async (input): Promise<McpToolResult> => {
				const { ownerUserId } = input as unknown as { ownerUserId: string };
				const drafts = await this.governance.pendingDrafts(ownerUserId);
				return {
					text: `${drafts.length} pending draft(s)`,
					structuredContent: {
						drafts: drafts.map((draft) => ({
							id: draft.id,
							agentKind: draft.agentKind,
							actionKind: draft.actionKind,
							reason: draft.reason,
						})),
					},
				};
			},
		};
	}

	private agentDraftResolve(): McpTool {
		return {
			name: "agent_draft_resolve",
			title: "Resolve agent draft",
			description:
				"Approves or rejects a pending agent action draft (compare-and-swap).",
			inputSchema: z.object({
				draftId: idSchema,
				decision: z.enum(["approved", "rejected"]),
				resolvedByUserId: idSchema,
				note: z.string().max(1000).optional(),
			}),
			execute: async (input): Promise<McpToolResult> => {
				const data = input as unknown as {
					draftId: string;
					decision: "approved" | "rejected";
					resolvedByUserId: string;
					note?: string;
				};
				const resolved = await this.governance.resolveDraft(
					data.draftId,
					data.decision,
					data.resolvedByUserId,
					data.note,
				);
				return {
					text: resolved ? `draft ${data.decision}` : "draft was not pending",
					structuredContent: { resolved },
				};
			},
		};
	}

	private systemHealth(): McpTool {
		return {
			name: "system_health",
			title: "System health",
			description:
				"Reports API and database liveness plus automation counters.",
			annotations: { readOnlyHint: true },
			inputSchema: z.object({}),
			execute: async (): Promise<McpToolResult> => {
				const [openRuns, activeRoutines, activeWebhooks] = await Promise.all([
					this.db.workflowRun.count({
						where: { status: { in: ["pending", "running"] } },
					}),
					this.db.routine.count({ where: { enabled: true } }),
					this.db.webhook.count({ where: { enabled: true } }),
				]);
				return {
					text: "ok",
					structuredContent: {
						database: "up",
						openWorkflowRuns: openRuns,
						enabledRoutines: activeRoutines,
						enabledWebhooks: activeWebhooks,
					},
				};
			},
		};
	}

	private contactsSearch(): McpTool {
		return {
			name: "contacts_search",
			title: "Search contacts",
			description: "Finds contacts by name or email substring, newest first.",
			annotations: { readOnlyHint: true },
			inputSchema: pageSchema.extend({ query: z.string().min(1).max(200) }),
			execute: async (input): Promise<McpToolResult> => {
				const { query, limit, offset } = input as unknown as {
					query: string;
					limit: number;
					offset: number;
				};
				const rows = await this.db.contact.findMany({
					where: {
						OR: [
							{ firstName: { contains: query, mode: "insensitive" } },
							{ lastName: { contains: query, mode: "insensitive" } },
							{ email: { contains: query, mode: "insensitive" } },
						],
					},
					orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
					take: limit,
					skip: offset,
					select: {
						id: true,
						firstName: true,
						lastName: true,
						email: true,
						title: true,
					},
				});
				return {
					text: `${rows.length} contact(s) matched`,
					structuredContent: { contacts: rows },
				};
			},
		};
	}

	private contactsGet(): McpTool {
		return {
			name: "contacts_get",
			title: "Get contact",
			description: "Fetches one contact by id.",
			annotations: { readOnlyHint: true },
			inputSchema: z.object({ id: idSchema }),
			execute: async (input): Promise<McpToolResult> => {
				const { id } = input as unknown as { id: string };
				const contact = await this.db.contact.findUnique({ where: { id } });
				if (!contact) return mcpFailure("notFound", `No contact with id ${id}`);
				return {
					text:
						`${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() ||
						contact.id,
					structuredContent: {
						contact: contact as unknown as Record<string, unknown>,
					},
				};
			},
		};
	}

	private companiesList(): McpTool {
		return {
			name: "companies_list",
			title: "List companies",
			description: "Lists companies, newest first.",
			annotations: { readOnlyHint: true },
			inputSchema: pageSchema,
			execute: async (input): Promise<McpToolResult> => {
				const { limit, offset } = input as unknown as {
					limit: number;
					offset: number;
				};
				const rows = await this.db.company.findMany({
					orderBy: { name: "asc" },
					take: limit,
					skip: offset,
					select: { id: true, name: true, domain: true, industry: true },
				});
				return {
					text: `${rows.length} company/companies`,
					structuredContent: { companies: rows },
				};
			},
		};
	}

	private dealsList(): McpTool {
		return {
			name: "deals_list",
			title: "List deals",
			description: "Lists deals ordered by value, newest first as tiebreaker.",
			annotations: { readOnlyHint: true },
			inputSchema: pageSchema.extend({ stage: z.string().max(100).optional() }),
			execute: async (input): Promise<McpToolResult> => {
				const { limit, offset, stage } = input as unknown as {
					limit: number;
					offset: number;
					stage?: string;
				};
				const rows = await this.db.deal.findMany({
					where: stage ? { stage: stage as never } : undefined,
					orderBy: [
						{ amount: { sort: "desc", nulls: "last" } },
						{ createdAt: "desc" },
					],
					take: limit,
					skip: offset,
					select: {
						id: true,
						name: true,
						stage: true,
						amount: true,
						expectedCloseDate: true,
					},
				});
				return {
					text: `${rows.length} deal(s)`,
					structuredContent: { deals: rows },
				};
			},
		};
	}

	private dealsGet(): McpTool {
		return {
			name: "deals_get",
			title: "Get deal",
			description: "Fetches one deal by id.",
			annotations: { readOnlyHint: true },
			inputSchema: z.object({ id: idSchema }),
			execute: async (input): Promise<McpToolResult> => {
				const { id } = input as unknown as { id: string };
				const deal = await this.db.deal.findUnique({ where: { id } });
				if (!deal) return mcpFailure("notFound", `No deal with id ${id}`);
				return {
					text: deal.name,
					structuredContent: {
						deal: deal as unknown as Record<string, unknown>,
					},
				};
			},
		};
	}

	private activitiesList(): McpTool {
		return {
			name: "activities_list",
			title: "List activities",
			description: "Lists recent activities, newest first.",
			annotations: { readOnlyHint: true },
			inputSchema: pageSchema,
			execute: async (input): Promise<McpToolResult> => {
				const { limit, offset } = input as unknown as {
					limit: number;
					offset: number;
				};
				const rows = await this.db.activity.findMany({
					orderBy: { createdAt: "desc" },
					take: limit,
					skip: offset,
					select: { id: true, type: true, subject: true, createdAt: true },
				});
				return {
					text: `${rows.length} activity/activities`,
					structuredContent: { activities: rows },
				};
			},
		};
	}

	private routinesList(): McpTool {
		return {
			name: "routines_list",
			title: "List routines",
			description: "Lists automation routines and their next scheduled run.",
			annotations: { readOnlyHint: true },
			inputSchema: z.object({ ownerUserId: idSchema.optional() }),
			execute: async (input): Promise<McpToolResult> => {
				const { ownerUserId } = input as unknown as { ownerUserId?: string };
				const rows = await this.db.routine.findMany({
					where: ownerUserId ? { ownerUserId } : undefined,
					orderBy: { createdAt: "desc" },
					take: 50,
				});
				return {
					text: `${rows.length} routine(s)`,
					structuredContent: { routines: rows },
				};
			},
		};
	}

	private routinesTrigger(): McpTool {
		return {
			name: "routines_trigger",
			title: "Trigger routine",
			description: "Queues a manual run of an automation routine.",
			inputSchema: z.object({ routineId: idSchema, ownerUserId: idSchema }),
			execute: async (input): Promise<McpToolResult> => {
				const { routineId, ownerUserId } = input as unknown as {
					routineId: string;
					ownerUserId: string;
				};
				const routine = await this.db.routine.findUnique({
					where: { id: routineId },
				});
				if (!routine)
					return mcpFailure("notFound", `No routine with id ${routineId}`);
				const runId = await this.routines.triggerManually(
					routineId,
					ownerUserId,
				);
				return {
					text: `Queued run ${runId}`,
					structuredContent: { routineRunId: runId },
				};
			},
		};
	}

	private webhooksList(): McpTool {
		return {
			name: "webhooks_list",
			title: "List webhooks",
			description: "Lists webhook subscriptions without exposing secrets.",
			annotations: { readOnlyHint: true },
			inputSchema: z.object({ ownerUserId: idSchema }),
			execute: async (input): Promise<McpToolResult> => {
				const { ownerUserId } = input as unknown as { ownerUserId: string };
				const webhooks = await this.routinesWebhooks(ownerUserId);
				return {
					text: `${webhooks.length} webhook(s)`,
					structuredContent: { webhooks },
				};
			},
		};
	}

	private async routinesWebhooks(ownerUserId: string) {
		const rows = await this.db.webhook.findMany({
			where: { ownerUserId },
			orderBy: { createdAt: "desc" },
			select: {
				id: true,
				url: true,
				events: true,
				enabled: true,
				secret: true,
			},
		});
		return rows.map((row) => ({
			id: row.id,
			url: row.url,
			events: row.events,
			enabled: row.enabled,
			hasSecret: row.secret != null && row.secret !== "",
		}));
	}

	private workflowsList(): McpTool {
		return {
			name: "workflows_list",
			title: "List workflows",
			description:
				"Lists registered workflow ids and the ones MCP may dispatch.",
			annotations: { readOnlyHint: true },
			inputSchema: z.object({}),
			execute: (): McpToolResult => ({
				text: "ok",
				structuredContent: {
					registered: this.registry.names(),
					dispatchable: [...MCP_DISPATCHABLE_WORKFLOWS],
				},
			}),
		};
	}

	private workflowsRun(): McpTool {
		return {
			name: "workflows_run",
			title: "Run workflow",
			description:
				"Dispatches an allowlisted workflow (currently trigger-test-error) to verify the failure pipeline.",
			inputSchema: z.object({
				workflowName: z.enum(MCP_DISPATCHABLE_WORKFLOWS),
				message: z.string().min(1).max(200).default("mcp probe"),
			}),
			execute: async (input): Promise<McpToolResult> => {
				const { workflowName, message } = input as unknown as {
					workflowName: (typeof MCP_DISPATCHABLE_WORKFLOWS)[number];
					message: string;
				};
				if (workflowName !== "trigger-test-error") {
					return mcpFailure(
						"authorization",
						`Workflow ${workflowName} is not dispatchable`,
					);
				}
				const outcome = await this.runner.run(
					triggerTestErrorWorkflow,
					{ message },
					{},
				);
				if (outcome.ok) {
					return { text: "ok", structuredContent: { runId: outcome.runId } };
				}
				return {
					text: outcome.failure.message ?? "workflow failed",
					structuredContent: {
						runId: outcome.runId,
						failure: outcome.failure,
						note: "A failing trigger-test-error run is the expected outcome of this probe.",
					},
				};
			},
		};
	}
}
