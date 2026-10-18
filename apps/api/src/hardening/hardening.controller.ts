/**
 * Workspace hardening routes: secret vault (metadata only over HTTP), portal
 * access codes, custom domains and the suppression list.
 */

import type { auth } from "@crm/auth";
import {
	Body,
	Controller,
	Get,
	NotFoundException,
	Param,
	Post,
	Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { Session, type UserSession } from "@thallesp/nestjs-better-auth";
import {
	PortalAccessService,
	SuppressionService,
	WorkspaceDomainsService,
	WorkspaceSecretsService,
} from "./hardening-services";

type CrmSession = UserSession<typeof auth>;

@ApiTags("Workspace Hardening")
@Controller("api/hardening")
export class HardeningController {
	constructor(
		private readonly secrets: WorkspaceSecretsService,
		private readonly portal: PortalAccessService,
		private readonly domains: WorkspaceDomainsService,
		private readonly suppression: SuppressionService,
	) {}

	// ------------------------------------------------------------- secrets

	@Post("secrets")
	@ApiOperation({
		summary: "Store or rotate a workspace secret (metadata only returned)",
	})
	async putSecret(
		@Session() session: CrmSession,
		@Body() body: { name: string; value: string },
	) {
		return {
			secret: await this.secrets.put(session.user.id, body.name, body.value),
		};
	}

	@Get("secrets")
	@ApiOperation({ summary: "Secret metadata (never plaintext)" })
	async secretMetadata(@Session() session: CrmSession) {
		return { secrets: await this.secrets.metadata(session.user.id) };
	}

	@Post("secrets/:name/delete")
	@ApiOperation({ summary: "Delete a secret" })
	async deleteSecret(
		@Session() session: CrmSession,
		@Param("name") name: string,
	) {
		return { deleted: await this.secrets.remove(session.user.id, name) };
	}

	// --------------------------------------------------------- portal codes

	@Post("portal-codes")
	@ApiOperation({
		summary: "Issue a portal access code (raw code returned once)",
	})
	async issueCode(
		@Session() session: CrmSession,
		@Body() body: { label: string; maxUses?: number; expiresAt?: string },
	) {
		return {
			portalCode: await this.portal.issue(session.user.id, body.label, {
				maxUses: body.maxUses,
				expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
			}),
		};
	}

	@Post("portal-codes/consume")
	@ApiOperation({
		summary: "Consume a portal access code (public entry point)",
	})
	async consumeCode(@Body() body: { code: string }) {
		return this.portal.consume(body.code);
	}

	@Post("portal-codes/:id/revoke")
	@ApiOperation({ summary: "Revoke a portal access code" })
	async revokeCode(@Session() session: CrmSession, @Param("id") id: string) {
		return { revoked: await this.portal.revoke(session.user.id, id) };
	}

	@Get("portal-codes")
	@ApiOperation({ summary: "List issued portal codes" })
	async listCodes(@Session() session: CrmSession) {
		return { portalCodes: await this.portal.list(session.user.id) };
	}

	// ------------------------------------------------------------ domains

	@Post("domains")
	@ApiOperation({
		summary: "Register a custom domain (returns verification token)",
	})
	async registerDomain(
		@Session() session: CrmSession,
		@Body() body: { domain: string },
	) {
		return {
			domain: await this.domains.register(session.user.id, body.domain),
		};
	}

	@Post("domains/verify")
	@ApiOperation({ summary: "Verify a domain against resolved DNS TXT records" })
	async verifyDomain(
		@Session() session: CrmSession,
		@Body() body: { domain: string; txtRecords: string[] },
	) {
		return {
			verified: await this.domains.verify(
				session.user.id,
				body.domain,
				body.txtRecords ?? [],
			),
		};
	}

	@Get("domains")
	@ApiOperation({ summary: "List custom domains" })
	async listDomains(@Session() session: CrmSession) {
		return { domains: await this.domains.list(session.user.id) };
	}

	// --------------------------------------------------------- suppression

	@Post("suppression")
	@ApiOperation({ summary: "Add a suppression (do-not-contact) entry" })
	async suppress(
		@Session() session: CrmSession,
		@Body() body: { channel: string; handle: string; reason?: string },
	) {
		await this.suppression.suppress(
			session.user.id,
			body.channel,
			body.handle,
			body.reason,
		);
		return { suppressed: true };
	}

	@Get("suppression/check")
	@ApiOperation({ summary: "Check suppression status for a handle" })
	async checkSuppression(
		@Query("channel") channel: string,
		@Query("handle") handle: string,
	) {
		return {
			suppressed: await this.suppression.isSuppressed(
				channel ?? "",
				handle ?? "",
			),
		};
	}

	@Post("suppression/remove")
	@ApiOperation({ summary: "Remove a suppression entry" })
	async removeSuppression(
		@Session() session: CrmSession,
		@Body() body: { channel: string; handle: string },
	) {
		return {
			removed: await this.suppression.remove(
				session.user.id,
				body.channel,
				body.handle,
			),
		};
	}

	@Get("suppression")
	@ApiOperation({ summary: "List suppression entries" })
	async listSuppression(@Session() session: CrmSession) {
		return { entries: await this.suppression.list(session.user.id) };
	}
}
