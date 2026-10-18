/**
 * RLS tenant table registry (ADR-002) — single source of truth for which
 * tables carry tenant policies and how chained tables reach their org.
 *
 * Prisma-free pure data: imported by unit specs (the regression test derives
 * its expectations from here) and by the P1b SQL generator. Table/column
 * names equal Prisma model/field names (no @@map in this schema).
 */

export type DirectTable = { table: string; column: string };

/** Direct policy `<column> = current_setting('app.current_org_id', true)` (P1). */
export const DIRECT_TENANT_TABLES: readonly DirectTable[] = [
  { table: "User", column: "orgId" },
  { table: "Case", column: "orgId" },
  { table: "Workflow", column: "orgId" },
  { table: "HookEndpoint", column: "orgId" },
  { table: "LanePage", column: "orgId" },
  { table: "AuditEvent", column: "orgId" },
  { table: "AiRun", column: "orgId" },
  { table: "AiFeedback", column: "orgId" },
  { table: "WebhookEndpoint", column: "orgId" },
  { table: "Invoice", column: "orgId" },
  { table: "CreditNote", column: "orgId" },
  { table: "Payment", column: "orgId" },
  { table: "RenewalReminder", column: "orgId" },
  { table: "RegulatoryChange", column: "orgId" },
  { table: "NewsScanProfile", column: "orgId" },
  { table: "MessageTemplate", column: "orgId" },
  { table: "Consultation", column: "orgId" },
  { table: "BrandSetting", column: "orgId" },
  { table: "TelemetryEvent", column: "orgId" },
  { table: "CallSession", column: "orgId" },
  { table: "Team", column: "orgId" },
  { table: "Meeting", column: "orgId" },
  { table: "AutomationJob", column: "orgId" },
  { table: "Contact", column: "orgId" },
  { table: "CrmTask", column: "orgId" },
  { table: "Activity", column: "orgId" },
  { table: "Party", column: "orgId" },
  { table: "DuplicateCandidate", column: "orgId" },
  { table: "MergeLedger", column: "orgId" },
  { table: "WorkItem", column: "orgId" },
  { table: "SLAClock", column: "orgId" },
  { table: "KycCheck", column: "orgId" },
  { table: "Decision", column: "orgId" },
  { table: "Quote", column: "orgId" },
  { table: "Refund", column: "orgId" },
  { table: "Handoff", column: "orgId" },
  { table: "ProviderReceipt", column: "orgId" },
  { table: "CommunicationDelivery", column: "orgId" },
  { table: "EmailTemplate", column: "orgId" },
  { table: "EmailCampaign", column: "orgId" },
  { table: "WebhookInbox", column: "orgId" },
  { table: "ReconciliationRun", column: "orgId" },
  { table: "ReconciliationFinding", column: "orgId" },
  { table: "Incident", column: "orgId" },
  { table: "ConfigurationVersion", column: "orgId" },
  { table: "McpTool", column: "orgId" },
  { table: "McpCall", column: "orgId" },
  { table: "OfflineQueue", column: "orgId" },
  { table: "SyncState", column: "orgId" },
  { table: "PollConnection", column: "orgId" },
  { table: "HumanTask", column: "orgId" },
  { table: "Attachment", column: "orgId" },
  { table: "LegalHold", column: "orgId" },
  { table: "Conversation", column: "orgId" },
  { table: "Availability", column: "orgId" },
  { table: "VoiceCommand", column: "orgId" },
  { table: "VoiceNote", column: "orgId" },
  { table: "BusinessSetting", column: "orgId" },
  { table: "FormSchema", column: "orgId" },
  { table: "PromptVersion", column: "orgId" },
  { table: "SignalDefinition", column: "orgId" },
  { table: "SignalObservation", column: "orgId" },
  { table: "FeatureSnapshot", column: "orgId" },
  { table: "Prediction", column: "orgId" },
  { table: "Intervention", column: "orgId" },
  { table: "ProactiveTrigger", column: "orgId" },
  { table: "ProactiveAction", column: "orgId" },
  { table: "AiTool", column: "orgId" },
  { table: "TranslationJob", column: "orgId" },
  { table: "TranslationMemory", column: "orgId" },
  { table: "Agent", column: "orgId" },
  { table: "AgentDelegation", column: "orgId" },
  { table: "Organisation", column: "id" },
  { table: "Connection", column: "orgId" },
  { table: "Lead", column: "orgId" },
  { table: "AutomationRule", column: "orgId" },
  { table: "RfiThread", column: "orgId" },
  { table: "SubmissionScore", column: "orgId" },
];

/** One hop: rows reach the tenant through `fk` on the current level. */
export type ChainHop = { parent: string; fk: string };

export type ChainedTable = {
  table: string;
  /** Single chain (1–2 hops). Each hop's fk lives on the previous level. */
  chain?: ChainHop[];
  /** OR of chains (nullable dual parents — rows with neither link stay invisible). */
  anyOf?: ChainHop[][];
  note?: string;
};

/** EXISTS policy tables (P1b). 48 entries — ADR-002 groups them. */
export const CHAINED_TENANT_TABLES: readonly ChainedTable[] = [
  // Via Case (14)
  { table: "ServiceSelection", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "CaseAssignment", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "CaseStatusHistory", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "Document", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "DocumentRequest", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "Comment", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "Dispatch", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "FollowUp", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "ApprovalLetter", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "ScreeningResult", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "EscalationWindow", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "ExternalComm", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "CaseEvent", chain: [{ parent: "Case", fk: "caseId" }] },
  { table: "CaseApplicant", chain: [{ parent: "Case", fk: "caseId" }] },
  // Via Document→Case (4; DocumentVersion dropped 20261011 — never wired)
  {
    table: "OcrJob",
    chain: [
      { parent: "Document", fk: "documentId" },
      { parent: "Case", fk: "caseId" },
    ],
  },
  {
    table: "ExtractedField",
    chain: [
      { parent: "Document", fk: "documentId" },
      { parent: "Case", fk: "caseId" },
    ],
  },
  {
    table: "DocumentReview",
    chain: [
      { parent: "Document", fk: "documentId" },
      { parent: "Case", fk: "caseId" },
    ],
  },
  {
    table: "CorrectionAudit",
    chain: [
      { parent: "Document", fk: "documentId" },
      { parent: "Case", fk: "caseId" },
    ],
  },
  // Via Workflow / LanePage (4)
  {
    table: "WorkflowVersion",
    chain: [{ parent: "Workflow", fk: "workflowId" }],
  },
  {
    table: "WorkflowRun",
    chain: [{ parent: "Workflow", fk: "workflowId" }],
    note: "Optional caseId stays an app-layer check.",
  },
  { table: "PageRevision", chain: [{ parent: "LanePage", fk: "pageId" }] },
  { table: "PageSubmission", chain: [{ parent: "LanePage", fk: "pageId" }] },
  // Via WorkflowRun→Workflow (2)
  {
    table: "WorkflowNodeRun",
    chain: [
      { parent: "WorkflowRun", fk: "runId" },
      { parent: "Workflow", fk: "workflowId" },
    ],
  },
  {
    table: "Waitpoint",
    chain: [
      { parent: "WorkflowRun", fk: "runId" },
      { parent: "Workflow", fk: "workflowId" },
    ],
  },
  // Via User→Organisation (5)
  { table: "Notification", chain: [{ parent: "User", fk: "userId" }] },
  {
    table: "NotificationPreference",
    chain: [{ parent: "User", fk: "userId" }],
  },
  { table: "PushSubscription", chain: [{ parent: "User", fk: "userId" }] },
  { table: "Consent", chain: [{ parent: "User", fk: "userId" }] },
  { table: "GdprRequest", chain: [{ parent: "User", fk: "userId" }] },
  // Via Team / Meeting (4)
  { table: "TeamMember", chain: [{ parent: "Team", fk: "teamId" }] },
  { table: "TeamMessage", chain: [{ parent: "Team", fk: "teamId" }] },
  {
    table: "MeetingParticipant",
    chain: [{ parent: "Meeting", fk: "meetingId" }],
  },
  { table: "MeetingSignal", chain: [{ parent: "Meeting", fk: "meetingId" }] },
  // Misc single-hop (10)
  { table: "CallSignal", chain: [{ parent: "CallSession", fk: "callId" }] },
  { table: "Citation", chain: [{ parent: "AiRun", fk: "aiRunId" }] },
  {
    table: "EmailTracking",
    chain: [{ parent: "EmailTemplate", fk: "templateId" }],
  },
  {
    table: "PollCheckpoint",
    chain: [{ parent: "PollConnection", fk: "connectionId" }],
  },
  {
    table: "PredictionFeedback",
    chain: [{ parent: "Prediction", fk: "predictionId" }],
  },
  {
    table: "NewsScanFinding",
    chain: [{ parent: "NewsScanProfile", fk: "profileId" }],
    note: "Nullable parent — orphan findings invisible.",
  },
  { table: "ExternalIdentity", chain: [{ parent: "Party", fk: "partyId" }] },
  {
    table: "Message",
    chain: [{ parent: "Conversation", fk: "conversationId" }],
  },
  {
    table: "ConversationParticipant",
    chain: [{ parent: "Conversation", fk: "conversationId" }],
  },
  { table: "AgentCapability", chain: [{ parent: "Agent", fk: "agentId" }] },
  // Misc 2-hop (2)
  {
    table: "AutomationAttempt",
    chain: [
      { parent: "AutomationJob", fk: "jobId" },
      { parent: "Organisation", fk: "orgId" },
    ],
    note: "Job carries orgId directly; second hop binds the org row.",
  },
  {
    table: "WebhookDelivery",
    chain: [
      { parent: "WebhookEndpoint", fk: "endpointId" },
      { parent: "Organisation", fk: "orgId" },
    ],
    note: "Nullable endpoint — orphan deliveries invisible.",
  },
  // OR-chained (2)
  {
    table: "Reminder",
    anyOf: [
      [{ parent: "Case", fk: "caseId" }],
      [{ parent: "User", fk: "clientId" }],
    ],
    note: "Rows with neither link stay invisible.",
  },
  {
    table: "Booking",
    anyOf: [
      [{ parent: "Case", fk: "caseId" }],
      [{ parent: "User", fk: "clientId" }],
    ],
    note: "Rows with neither link stay invisible.",
  },
];
