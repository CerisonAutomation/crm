/**
 * Agent governance module (SeldonFrame U5): receipts, drafts, reflections,
 * taste sessions, eval runs.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { EventsModule } from "../events/events.module";
import { AgentGovernanceController } from "./agent-governance.controller";
import { AgentGovernanceService } from "./agent-governance.service";

@Module({
	imports: [DatabaseModule, EventsModule],
	providers: [AgentGovernanceService],
	controllers: [AgentGovernanceController],
	exports: [AgentGovernanceService],
})
export class AgentGovernanceModule {}
