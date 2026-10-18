/**
 * Workspace hardening module (SeldonFrame U8): secret vault, portal access
 * codes, custom domains, suppression list.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { HardeningController } from "./hardening.controller";
import {
	PortalAccessService,
	SuppressionService,
	WorkspaceDomainsService,
	WorkspaceSecretsService,
} from "./hardening-services";

@Module({
	imports: [DatabaseModule],
	providers: [
		WorkspaceSecretsService,
		PortalAccessService,
		WorkspaceDomainsService,
		SuppressionService,
	],
	controllers: [HardeningController],
	exports: [
		WorkspaceSecretsService,
		PortalAccessService,
		WorkspaceDomainsService,
		SuppressionService,
	],
})
export class HardeningModule {}
