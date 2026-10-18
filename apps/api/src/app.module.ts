import { auth } from "@crm/auth";
import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AuthModule as BetterAuthModule } from "@thallesp/nestjs-better-auth";
import { ActivitiesModule } from "./activities/activities.module";
import { AgentModule } from "./agent/agent.module";
import { AgentGovernanceModule } from "./agent-governance/agent-governance.module";
import { ApiKeysModule } from "./api-keys/api-keys.module";
import { ArchiveModule } from "./archive/archive.module";
import { AuthModule } from "./auth/auth.module";
import { BackfillModule } from "./backfill/backfill.module";
import { AppCacheModule } from "./cache/cache.module";
import { BookingModule } from "./booking/booking.module";
import { BrainModule } from "./brain/brain.module";
import { ChannelsModule } from "./channels/channels.module";
import { CompaniesModule } from "./companies/companies.module";
import { validateEnv } from "./config/env.validation";
import { ContactsModule } from "./contacts/contacts.module";
import { ConversationsModule } from "./conversations/conversations.module";
import { CrmModule } from "./crm/crm.module";
import { CurrencyModule } from "./currency/currency.module";
import { DashboardModule } from "./dashboard/dashboard.module";
import { DatabaseModule } from "./database/database.module";
import { DealsModule } from "./deals/deals.module";
import { EnrichmentModule } from "./enrichment/enrichment.module";
import { EventsModule } from "./events/events.module";
import { FieldsModule } from "./fields/fields.module";
import { GoogleModule } from "./google/google.module";
import { HealthModule } from "./health/health.module";
import { HardeningModule } from "./hardening/hardening.module";
import { LoggingModule } from "./logging/logging.module";
import { logAuthRoute } from "./logging/request-logger.middleware";
import { MailboxModule } from "./mailbox/mailbox.module";
import { McpModule } from "./mcp/mcp.module";
import { MicrosoftModule } from "./microsoft/microsoft.module";
import { N8nModule } from "./n8n/n8n.module";
import { RoutinesModule } from "./routines/routines.module";
import { SavedViewsModule } from "./saved-views/saved-views.module";
import { SearchModule } from "./search/search.module";
import { SettingsModule } from "./settings/settings.module";
import { SlackModule } from "./slack/slack.module";
import { SsoModule } from "./sso/sso.module";
import { SoulModule } from "./soul/soul.module";
import { SyncModule } from "./sync/sync.module";
import { TelemetryModule } from "./telemetry/telemetry.module";
import { TrackingModule } from "./tracking/tracking.module";
import { TrpcModule } from "./trpc/trpc.module";
import { UsersModule } from "./users/users.module";
import { WorkspaceModule } from "./workspace/workspace.module";
import { WebhooksModule } from "./webhooks/webhooks.module";
import { WorkflowsModule } from "./workflows/workflows.module";

@Module({
	imports: [
		LoggingModule,
		ConfigModule.forRoot({
			isGlobal: true,
			cache: true,
			validate: validateEnv,
		}),
		AppCacheModule,
		DatabaseModule,
		CrmModule,
		BetterAuthModule.forRoot({ auth, middleware: logAuthRoute }),
		AuthModule,
		HealthModule,
		TrpcModule,
		UsersModule,
		ApiKeysModule,
		CompaniesModule,
		ContactsModule,
		ConversationsModule,
		CurrencyModule,
		DealsModule,
		FieldsModule,
		ActivitiesModule,
		AgentModule,
		EnrichmentModule,
		DashboardModule,
		SearchModule,
		MailboxModule,
		GoogleModule,
		MicrosoftModule,
		SyncModule,
		SettingsModule,
		WorkspaceModule,
		SsoModule,
		SlackModule,
		BackfillModule,
		TelemetryModule,
		TrackingModule,
		ArchiveModule,
		SavedViewsModule,
		WorkflowsModule,
		WebhooksModule,
		RoutinesModule,
		N8nModule,
		HardeningModule,
		EventsModule,
		BookingModule,
		ChannelsModule,
		AgentGovernanceModule,
		BrainModule,
		SoulModule,
		McpModule,
	],
})
export class AppModule {}
