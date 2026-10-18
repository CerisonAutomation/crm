/**
 * MCP module: Streamable HTTP JSON-RPC endpoint + tool catalog.
 */

import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { BookingModule } from "../booking/booking.module";
import { ChannelsModule } from "../channels/channels.module";
import { BrainModule } from "../brain/brain.module";
import { AgentGovernanceModule } from "../agent-governance/agent-governance.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { RoutinesModule } from "../routines/routines.module";
import { McpToolsService } from "./mcp-tools.service";
import { McpServerService } from "./mcp-server.service";
import { McpController } from "./mcp.controller";

@Module({
	imports: [
		DatabaseModule,
		WorkflowsModule,
		RoutinesModule,
		BookingModule,
		ChannelsModule,
		BrainModule,
		AgentGovernanceModule,
	],
	providers: [McpToolsService, McpServerService],
	controllers: [McpController],
	exports: [McpServerService],
})
export class McpModule {}
