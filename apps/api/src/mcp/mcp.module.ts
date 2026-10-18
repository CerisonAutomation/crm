/**
 * MCP module: Streamable HTTP JSON-RPC endpoint + tool catalog.
 */

import { Module } from "@nestjs/common";
import { AgentGovernanceModule } from "../agent-governance/agent-governance.module";
import { BookingModule } from "../booking/booking.module";
import { BrainModule } from "../brain/brain.module";
import { ChannelsModule } from "../channels/channels.module";
import { DatabaseModule } from "../database/database.module";
import { RoutinesModule } from "../routines/routines.module";
import { WorkflowsModule } from "../workflows/workflows.module";
import { McpController } from "./mcp.controller";
import { McpServerService } from "./mcp-server.service";
import { McpToolsService } from "./mcp-tools.service";

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
