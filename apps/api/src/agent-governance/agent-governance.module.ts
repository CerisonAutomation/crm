/**
 * Agent governance module (SeldonFrame U5): receipts, drafts, reflections,
 * taste sessions, eval runs.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { EventsModule } from "../events/events.module";
import { AgentGovernanceService } from "./agent-governance.service";
import { AgentGovernanceController } from "./agent-governance.controller";

@Module({
	imports: [DatabaseModule, EventsModule],
	providers: [AgentGovernanceService],
	controllers: [AgentGovernanceController],
	exports: [AgentGovernanceService],
})
export class AgentGovernanceModule {}
