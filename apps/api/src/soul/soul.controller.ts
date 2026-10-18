/**
 * Soul routes: white-label identity profiles + inheritance-resolved view.
 */

import { Body, Controller, Get, NotFoundException, Param, Post } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { auth } from "@crm/auth";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import { SoulService } from "./soul.service";

type CrmSession = UserSession<typeof auth>;

@ApiTags("Soul")
@Controller("api/soul")
export class SoulController {
	constructor(private readonly souls: SoulService) {}

	@Post()
	@ApiOperation({ summary: "Create a soul profile (optionally inheriting)" })
	async create(
		@Session() session: CrmSession,
		@Body()
		body: {
			name: string;
			parentId?: string;
			labels?: Record<string, string>;
			tone?: string;
			positioning?: string;
			branding?: Record<string, unknown>;
		},
	) {
		return { soul: await this.souls.create(session.user.id, body) };
	}

	@Get()
	@ApiOperation({ summary: "List soul profiles" })
	async list(@Session() session: CrmSession) {
		return { souls: await this.souls.list(session.user.id) };
	}

	@Get(":id/effective")
	@ApiOperation({ summary: "Effective soul with inheritance resolved" })
	async effective(@Session() session: CrmSession, @Param("id") id: string) {
		const soul = await this.souls.effective(session.user.id, id);
		if (!soul) throw new NotFoundException(`No soul ${id}`);
		return { soul };
	}
}
