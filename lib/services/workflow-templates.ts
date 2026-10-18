/**
 * Workflow template catalog — single source of truth for the gallery and for
 * seeding draft graphs. Each template maps to a real, valid graph (exactly one
 * trigger, all nodes reachable, approval nodes declare a role) so "Use
 * template" produces a draft that can be published immediately.
 */
import type { WfEdge, WfNode } from "@/lib/services/workflow-engine";

export type TemplateGraph = {
  nodes: WfNode[];
  edges: WfEdge[];
};

const node = (
  key: string,
  pieceKey: string,
  name: string,
  config: Record<string, unknown> = {}
): WfNode => ({
  key,
  pieceKey,
  name,
  config,
});

/** Linear chain n1→n2 … →n<nodeCount>, the shared backbone of the service journeys. */
const chainEdges = (nodeCount: number): WfEdge[] =>
  Array.from({ length: nodeCount - 1 }, (_, i) => ({
    from: `n${i + 1}`,
    to: `n${i + 2}`,
  }));

export const TEMPLATE_GRAPHS: Record<string, TemplateGraph> = {
  "tpl-onboarding": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.notify.rm", "Notify onboarding team", {
        title: "New case assigned",
        body: "A new client case was created — review the onboarding data.",
      }),
      node("n3", "approval.human.gate", "RM acknowledgement", { role: "RM" }),
      node("n4", "action.notify.client", "Welcome the client", {
        title: "Welcome to Citizen Lane",
        body: "Your onboarding is underway — your relationship manager will guide you.",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4" },
    ],
  },
  "tpl-ocr-review": {
    nodes: [
      node("n1", "trigger.document.uploaded", "Document uploaded"),
      node("n2", "action.notify.rm", "Request review", {
        title: "Document review needed",
        body: "A client document was uploaded and needs verification.",
      }),
      node("n3", "approval.human.gate", "Verify & approve", {
        role: "SENIOR_RM",
      }),
      node("n4", "action.notify.client", "Report the result", {
        title: "Document reviewed",
        body: "Your uploaded document has been reviewed by our team.",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4" },
    ],
  },
  "tpl-missing-docs": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "condition.field.equals", "Is required data missing?", {
        left: "documentsComplete",
        value: "false",
      }),
      node("n3", "action.create.request", "Request the missing document", {
        docType: "OTHER",
        title: "Missing document",
        instructions:
          "Please upload the requested document to continue your onboarding.",
        dueDays: 7,
      }),
      node("n4", "action.notify.rm", "Tell the team", {
        title: "Document request sent",
        body: "A document request was created automatically — follow up if the client stalls.",
      }),
    ],
    // Unmatched conditions skip the next node (the request) and continue after it.
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3", label: "true" },
      { from: "n3", to: "n4" },
    ],
  },
  "tpl-dhl-dispatch": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "approval.human.gate", "Senior approves dispatch", {
        role: "SENIOR_RM",
      }),
      node("n3", "delay.authority_followup", "Schedule authority follow-up", {
        weeks: 6,
      }),
      node("n4", "action.notify.client", "Confirm dispatch to client", {
        title: "Application dispatched",
        body: "Your application has been dispatched to the authority — we will follow up in six weeks.",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4" },
    ],
  },
  "tpl-approval-letter": {
    nodes: [
      node("n1", "trigger.document.uploaded", "Letter uploaded"),
      node("n2", "action.notify.client", "Notify the client", {
        title: "Approval in principle received",
        body: "Your approval letter is available in the portal.",
      }),
      node("n3", "action.audit.export", "Record in audit export", {}),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
    ],
  },
  "tpl-audit-export": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.audit.export", "Export audit events", {}),
    ],
    edges: [{ from: "n1", to: "n2" }],
  },
  "tpl-residence-renewal": {
    nodes: [
      node("n1", "trigger.case.created", "Renewal window opens"),
      node("n2", "action.notify.client", "Remind the client", {
        title: "Residence permit renewal due",
        body: "Your residence permit renewal window is open — your relationship manager will guide the renewal.",
      }),
      node("n3", "action.create.request", "Request renewed documents", {
        docType: "CERTIFICATE_OF_REGISTRATION",
        title: "Renewal documents",
        instructions:
          "Please upload your current registration certificate and proof of continued residency.",
        dueDays: 14,
      }),
      node("n4", "approval.human.gate", "Senior reviews renewal file", {
        role: "SENIOR_RM",
      }),
      node("n5", "action.audit.export", "Record renewal in audit", {}),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4" },
      { from: "n4", to: "n5" },
    ],
  },
  "tpl-welcome-journey": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.notify.client", "Send the welcome note", {
        title: "Welcome to Citizen Lane",
        body: "Your private onboarding begins today — here is what happens next.",
      }),
      node("n3", "condition.field.equals", "Is onboarding data missing?", {
        left: "documentsComplete",
        value: "false",
      }),
      node("n4", "action.create.request", "Nudge for onboarding data", {
        docType: "OTHER",
        title: "Complete your profile",
        instructions:
          "Please complete your profile and upload your identity document so we can proceed.",
        dueDays: 5,
      }),
      node("n5", "action.notify.rm", "Flag incomplete onboarding", {
        title: "Onboarding stalled",
        body: "The client's onboarding data is incomplete — a nudge was sent automatically.",
      }),
      node("n6", "action.audit.export", "Record onboarding outcome", {}),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4", label: "true" },
      { from: "n3", to: "n6", label: "false" },
      { from: "n4", to: "n5" },
      { from: "n5", to: "n6" },
    ],
  },
  "tpl-escalation": {
    nodes: [
      node("n1", "trigger.document.uploaded", "Document flagged uploaded"),
      node("n2", "condition.field.equals", "Is the case high risk?", {
        left: "riskFlag",
        value: "HIGH",
      }),
      node("n3", "approval.human.gate", "Senior RM escalation review", {
        role: "SENIOR_RM",
      }),
      node("n4", "action.notify.rm", "Escalate to compliance desk", {
        title: "Escalated case",
        body: "A high-risk case requires compliance attention before it may proceed.",
      }),
      node("n5", "action.audit.export", "Record screening outcome", {}),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3", label: "true" },
      { from: "n2", to: "n5", label: "false" },
      { from: "n3", to: "n4" },
      { from: "n4", to: "n5" },
    ],
  },
  "tpl-deadline-chase": {
    nodes: [
      node("n1", "trigger.reminder.due", "Deadline reached"),
      node("n2", "action.notify.rm", "Chase the owner", {
        title: "Deadline due — chase required",
        body: "A scheduled deadline fell due. Confirm the next action.",
      }),
      node("n3", "approval.human.gate", "RM confirms chase", { role: "RM" }),
      node("n4", "action.notify.client", "Remind the client", {
        title: "A deadline needs your attention",
        body: "One of your deadlines has arrived — your relationship manager will guide the next step.",
      }),
      node("n5", "action.audit.export", "Record the chase", {
        note: "Deadline chase handled",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4" },
      { from: "n4", to: "n5" },
    ],
  },
  "tpl-contact-enquiry": {
    nodes: [
      node("n1", "trigger.page.submitted", "Contact form submitted"),
      node("n2", "condition.field.exists", "Did they leave an email?", {
        left: "email",
      }),
      node("n3", "action.email.send", "Send the concierge reply", {
        to: "{{email}}",
        subject: "Thank you for reaching out to Citizen Lane",
        body: "Dear {{name}},\n\nThank you for your interest in citizenship and residence planning. One of our relationship managers will contact you within one business day.\n\nWarm regards,\nCitizen Lane",
      }),
      node("n4", "action.notify.rm", "Alert the desk", {
        title: "New website enquiry",
        body: "Enquiry from {{name}} ({{email}}) on page “{{page}}”.",
      }),
      node("n5", "action.notify.rm", "Alert the desk (no email given)", {
        title: "New website enquiry",
        body: "Enquiry from {{name}} on page “{{page}}” — no email supplied.",
      }),
      node("n6", "action.audit.export", "Record the enquiry", {
        note: "Lane page enquiry handled",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3", label: "true" },
      { from: "n2", to: "n5", label: "false" },
      { from: "n3", to: "n4" },
      { from: "n4", to: "n6" },
      { from: "n5", to: "n6" },
    ],
  },
  "tpl-whatsapp-approval": {
    nodes: [
      node("n1", "trigger.document.uploaded", "Approval letter uploaded"),
      node("n2", "action.whatsapp.send", "Text the good news", {
        to: "client",
        message:
          "Good news — your approval letter has arrived and is available in the Citizen Lane portal.",
      }),
      node("n3", "action.notify.client", "Mirror in the portal", {
        title: "Approval in principle received",
        body: "Your approval letter is available in the portal.",
      }),
      node("n4", "action.audit.export", "Record the notification", {
        note: "Approval letter relayed",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4" },
    ],
  },
  "tpl-ai-welcome": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.ai.compose", "Compose a personal welcome", {
        instruction:
          "Write a warm two-sentence welcome for a new private client beginning their citizenship journey with Citizen Lane. Mention their dedicated relationship manager.",
        outputField: "aiText",
      }),
      node("n3", "action.notify.client", "Deliver the welcome", {
        title: "Welcome to Citizen Lane",
        body: "{{aiText}}",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
    ],
  },

  // ── Added from the citizen-lane.com harvest (docs gap analysis) ──

  // The site's #1 CTA on every programme page: "Book a consultation — no
  // commitment, pressure, or obligation". This is its workflow twin.
  "tpl-consultation-booking": {
    nodes: [
      node("n1", "trigger.page.submitted", "Consultation form submitted"),
      node("n2", "condition.field.exists", "Did they leave an email?", {
        left: "email",
      }),
      node("n3", "action.email.send", "Confirm the consultation", {
        to: "{{email}}",
        subject: "Your Citizen Lane consultation is being arranged",
        body: "Dear {{name}},\n\nThank you for requesting a consultation. A relationship manager will confirm a time slot within one business day — no commitment, no pressure, no obligation.\n\nWarm regards,\nCitizen Lane",
      }),
      node("n4", "action.notify.rm", "Alert the desk (no email given)", {
        title: "Consultation request — call back",
        body: "Enquiry from {{name}} on page “{{page}}” — no email supplied, please reach out by phone.",
      }),
      node("n5", "action.notify.rm", "Alert the desk (email given)", {
        title: "New consultation request",
        body: "{{name}} ({{email}}) requested a consultation on page “{{page}}”. Confirmation email sent.",
      }),
      node("n6", "delay.duration", "Schedule pre-consultation reminder", {
        amount: 1,
        unit: "DAYS",
        note: "Send the pre-consultation preparation reminder",
      }),
      node("n7", "action.email.send", "Send the preparation reminder", {
        to: "{{email}}",
        subject: "Preparing for your Citizen Lane consultation",
        body: "Dear {{name}},\n\nAhead of your consultation it helps to have handy: your current citizenship(s), the source of investment funds, and your preferred timeline.\n\nWarm regards,\nCitizen Lane",
      }),
      node("n8", "action.audit.export", "Record the booking", {
        note: "Consultation booked from Lane Page",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3", label: "true" },
      { from: "n2", to: "n4", label: "false" },
      { from: "n3", to: "n5" },
      { from: "n5", to: "n6" },
      { from: "n6", to: "n7" },
      { from: "n7", to: "n8" },
      { from: "n4", to: "n8" },
    ],
  },

  // Mailchimp-style double opt-in, keyless and GDPR-clean: consent is recorded,
  // confirmation email is sent, frequency preferences are respected downstream.
  "tpl-newsletter-optin": {
    nodes: [
      node("n1", "trigger.page.submitted", "Newsletter form submitted"),
      node("n2", "condition.field.exists", "Did they consent with an email?", {
        left: "email",
      }),
      node("n3", "action.email.send", "Send the double opt-in email", {
        to: "{{email}}",
        subject: "Please confirm your Citizen Lane newsletter subscription",
        body: "Dear {{name}},\n\nPlease confirm your subscription to the Citizen Lane journal — monthly briefings on citizenship and residence by investment. You can unsubscribe at any time.\n\nCitizen Lane",
      }),
      node("n4", "action.audit.export", "Record the consent", {
        note: "Newsletter double opt-in requested (pending confirmation)",
      }),
      node("n5", "action.audit.export", "Record the skip", {
        note: "Newsletter signup without email — nothing stored",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3", label: "true" },
      { from: "n3", to: "n4" },
      { from: "n2", to: "n5", label: "false" },
    ],
  },

  // /contact-austria pattern: name + email → factsheet download → RM follow-up.
  "tpl-factsheet-lead": {
    nodes: [
      node("n1", "trigger.page.submitted", "Factsheet form submitted"),
      node("n2", "condition.field.exists", "Did they leave an email?", {
        left: "email",
      }),
      node("n3", "action.email.send", "Deliver the factsheet", {
        to: "{{email}}",
        subject: "Your Citizen Lane factsheet",
        body: "Dear {{name}},\n\nHere is your requested factsheet, including key facts, investment levels and processing times. Your relationship manager will follow up personally — only if you wish.\n\nCitizen Lane",
      }),
      node("n4", "action.notify.rm", "Flag the warm lead", {
        title: "Factsheet downloaded",
        body: "{{name}} ({{email}}) downloaded a factsheet on page “{{page}}” — a follow-up was emailed automatically.",
      }),
      node("n5", "action.audit.export", "Record the lead", {
        note: "Factsheet delivered",
      }),
      node("n6", "action.notify.rm", "Flag the lead (no email)", {
        title: "Factsheet requested — no email",
        body: "{{name}} requested a factsheet on page “{{page}}” without leaving an email.",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3", label: "true" },
      { from: "n3", to: "n4" },
      { from: "n4", to: "n5" },
      { from: "n2", to: "n6", label: "false" },
      { from: "n6", to: "n5" },
    ],
  },

  // Expo/expedition leads (Fortune, IREX, MPIRES…): meet → nurture → convert.
  "tpl-campaign-expo": {
    nodes: [
      node("n1", "trigger.page.submitted", "Event lead captured"),
      node("n2", "action.notify.rm", "Alert the event desk", {
        title: "New event lead",
        body: "Lead from {{name}} ({{email}}) on “{{page}}” — follow-up is scheduled automatically.",
      }),
      node("n3", "delay.duration", "Wait one day after the event", {
        amount: 1,
        unit: "DAYS",
        note: "Personal follow-up after the event conversation",
      }),
      node("n4", "condition.field.exists", "WhatsApp number available?", {
        left: "phone",
      }),
      node("n5", "action.whatsapp.send", "WhatsApp the personal follow-up", {
        to: "client",
        message:
          "It was a pleasure meeting you — this is your Citizen Lane contact. Shall we continue the conversation?",
      }),
      node("n6", "action.email.send", "Email the personal follow-up", {
        to: "{{email}}",
        subject: "Following up from {{page}}",
        body: "Dear {{name}},\n\nIt was a pleasure to meet you. As discussed, here is a summary of the residence and citizenship routes that fit your situation.\n\nCitizen Lane",
      }),
      node("n7", "action.audit.export", "Record the campaign touch", {
        note: "Event follow-up completed",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4" },
      { from: "n4", to: "n5", label: "true" },
      { from: "n4", to: "n6", label: "false" },
      { from: "n5", to: "n7" },
      { from: "n6", to: "n7" },
    ],
  },

  // The full RM × Client engagement from the product spec (APP Citizen Lane
  // docx): profile+OCR → RM secondary data approval → service choice approval →
  // document requests → dispatch gate → authority follow-up — one journey.
  "tpl-signature-journey": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.notify.client", "Welcome the client", {
        title: "Welcome to Citizen Lane",
        body: "Your private onboarding begins today — upload your passport(s) and your relationship manager takes it from there.",
      }),
      node(
        "n3",
        "approval.human.gate",
        "RM secondary approval of client data",
        { role: "RM" }
      ),
      node("n4", "action.create.request", "Request the core dossier", {
        docType: "CERTIFICATE_OF_REGISTRATION",
        title: "Onboarding documents",
        instructions:
          "Please upload your Certificate of Registration, National ID and Police Record — each one is reviewed individually by your relationship manager.",
        dueDays: 14,
        flexible: true,
      }),
      node(
        "n5",
        "approval.human.gate",
        "Senior RM approves the complete dossier",
        { role: "SENIOR_RM" }
      ),
      node(
        "n6",
        "action.notify.client",
        "Inform: dispatched to the authority",
        {
          title: "Dossier dispatched",
          body: "Your complete application is on its way to the authority — we follow up every six weeks and keep you informed throughout.",
        }
      ),
      node("n7", "delay.authority_followup", "Follow up with the authority", {
        weeks: 6,
      }),
      node("n8", "action.notify.rm", "Brief the desk after follow-up", {
        title: "Authority follow-up due",
        body: "The scheduled follow-up fell due — update the client with the authority's status.",
      }),
      node("n9", "action.audit.export", "Record the journey milestone", {
        note: "Signature journey checkpoint reached",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4" },
      { from: "n4", to: "n5" },
      { from: "n5", to: "n6" },
      { from: "n6", to: "n7" },
      { from: "n7", to: "n8" },
      { from: "n8", to: "n9" },
    ],
  },

  // ── Service journeys for EVERY service family on citizen-lane.com ──
  // The site sells 8 citizenship programmes, 10 residence programmes, the
  // Malta sub-programmes (MPRP, Global/Retirement/Startup Residence, Company
  // Set-Up) and property investment. Each journey below is the real RM ×
  // Client engagement for one service family: welcome → RM profile approval →
  // document requests → compliance sign-off → dispatch → scheduled authority
  // follow-up → client status update — the RM three-screen spec, per service.

  // Citizenship by Investment — Antigua & Barbuda, Austria, Cyprus, Malta,
  // Montenegro, St Kitts & Nevis, Turkey, Vanuatu (site's CBI programme list).
  "tpl-cbi-citizenship": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.notify.client", "Welcome the citizenship applicant", {
        title: "Welcome to Citizen Lane",
        body: "Your citizenship by investment journey begins today. Your relationship manager will guide you from document collection to your new passport.",
      }),
      node("n3", "approval.human.gate", "RM approves profile & programme fit", {
        role: "RM",
      }),
      node("n4", "action.create.request", "Request all applicants' passports", {
        docType: "PASSPORT",
        title: "Passports of all applicants",
        instructions:
          "Upload the passport of every applicant included in the citizenship application — each one is reviewed individually.",
        dueDays: 7,
        flexible: true,
      }),
      node("n5", "action.create.request", "Request proof of source of funds", {
        docType: "BANK_STATEMENT",
        title: "Source of investment funds",
        instructions:
          "Upload bank statements evidencing the source of the investment funds, as required by the government due-diligence unit.",
        dueDays: 10,
        flexible: true,
      }),
      node(
        "n6",
        "approval.human.gate",
        "Compliance approves the due-diligence file",
        { role: "SENIOR_RM" }
      ),
      node("n7", "action.notify.client", "Inform: dossier dispatched", {
        title: "Application submitted",
        body: "Your complete citizenship application is on its way to the government unit. We follow up every six weeks and keep you informed throughout.",
      }),
      node(
        "n8",
        "delay.authority_followup",
        "Follow up with the government unit",
        { weeks: 6 }
      ),
      node("n9", "action.notify.rm", "Brief the desk after follow-up", {
        title: "Government follow-up due",
        body: "The scheduled citizenship-application follow-up fell due — update the client with the authority's status.",
      }),
      node("n10", "action.audit.export", "Record the journey milestone", {
        note: "Citizenship by investment journey checkpoint reached",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4" },
      { from: "n4", to: "n5" },
      { from: "n5", to: "n6" },
      { from: "n6", to: "n7" },
      { from: "n7", to: "n8" },
      { from: "n8", to: "n9" },
      { from: "n9", to: "n10" },
    ],
  },

  // Residence by Investment — Armenia, Austria, Cyprus, Germany (flagship:
  // residence through business investment), Greece, Malta, Portugal, Spain,
  // Slovenia, USA (site's RBI programme list).
  "tpl-rbi-residence": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.notify.client", "Welcome the residence applicant", {
        title: "Welcome to Citizen Lane",
        body: "Your residence by investment journey begins today — your relationship manager will guide you from strategy to your residence permit.",
      }),
      node("n3", "approval.human.gate", "RM approves the residence strategy", {
        role: "RM",
      }),
      node("n4", "action.create.request", "Request identity documents", {
        docType: "NATIONAL_ID",
        title: "Identity documents",
        instructions:
          "Upload your national ID (and any family members' IDs) for the residence file — each one is reviewed individually.",
        dueDays: 7,
        flexible: true,
      }),
      node("n5", "action.create.request", "Request proof of investment funds", {
        docType: "BANK_STATEMENT",
        title: "Proof of investment funds",
        instructions:
          "Upload bank statements evidencing the funds for the business investment or deposit required by the programme.",
        dueDays: 10,
        flexible: true,
      }),
      node("n6", "approval.human.gate", "Senior approves the residence file", {
        role: "SENIOR_RM",
      }),
      node("n7", "action.notify.client", "Inform: lodged with the authority", {
        title: "Application lodged",
        body: "Your residence application has been lodged with the authority. We follow up every six weeks and keep you informed throughout.",
      }),
      node("n8", "delay.authority_followup", "Follow up with the authority", {
        weeks: 6,
      }),
      node("n9", "action.notify.rm", "Brief the desk after follow-up", {
        title: "Authority follow-up due",
        body: "The scheduled residence follow-up fell due — update the client with the authority's status.",
      }),
      node(
        "n10",
        "action.create.request",
        "Request the registration certificate",
        {
          docType: "CERTIFICATE_OF_REGISTRATION",
          title: "Address registration certificate",
          instructions:
            "After arriving, register your address and upload the registration certificate to complete your residence file.",
          dueDays: 14,
          flexible: true,
        }
      ),
      node("n11", "action.audit.export", "Record the journey milestone", {
        note: "Residence by investment journey checkpoint reached",
      }),
    ],
    edges: [...chainEdges(11)],
  },

  // Malta Permanent Residence Programme (MPRP) — the site's flagship Malta
  // programme (government contribution + property commitment, Residency Malta).
  "tpl-malta-mprp": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.notify.client", "Welcome the MPRP applicant", {
        title: "Welcome to Citizen Lane",
        body: "Your Malta Permanent Residence Programme journey begins today — your relationship manager will guide you from eligibility to your residence card.",
      }),
      node("n3", "approval.human.gate", "RM approves MPRP eligibility", {
        role: "RM",
      }),
      node("n4", "action.create.request", "Request passports", {
        docType: "PASSPORT",
        title: "Passports of all applicants",
        instructions:
          "Upload the passport of every applicant for the MPRP file — each one is reviewed individually.",
        dueDays: 7,
        flexible: true,
      }),
      node(
        "n5",
        "action.create.request",
        "Request the asset & wealth evidence",
        {
          docType: "BANK_STATEMENT",
          title: "Asset test evidence",
          instructions:
            "Upload bank statements meeting the MPRP asset test (capital + annual income), as required by Residency Malta.",
          dueDays: 10,
          flexible: true,
        }
      ),
      node("n6", "action.create.request", "Request police records", {
        docType: "POLICE_RECORD",
        title: "Police records",
        instructions:
          "Upload a police conduct certificate for every applicant aged 18+ — each one is reviewed individually.",
        dueDays: 10,
        flexible: true,
      }),
      node(
        "n7",
        "approval.human.gate",
        "Compliance sign-off for Residency Malta",
        { role: "SENIOR_RM" }
      ),
      node(
        "n8",
        "action.notify.client",
        "Inform: submitted to Residency Malta",
        {
          title: "MPRP application submitted",
          body: "Your application has been submitted to Residency Malta. We follow up every twelve weeks and keep you informed throughout.",
        }
      ),
      node("n9", "delay.duration", "Schedule the Residency Malta check-in", {
        amount: 12,
        unit: "WEEKS",
        note: "Residency Malta status check-in — update the client",
      }),
      node("n10", "action.notify.rm", "Brief the desk after check-in", {
        title: "Residency Malta check-in due",
        body: "The scheduled MPRP check-in fell due — update the client with the agency's status.",
      }),
      node("n11", "action.audit.export", "Record the journey milestone", {
        note: "Malta MPRP journey checkpoint reached",
      }),
    ],
    edges: [...chainEdges(11)],
  },

  // Malta Global Residence / Retirement / Startup Residence programmes —
  // the site's three special Malta residence routes share this engagement.
  "tpl-malta-residence-programmes": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.notify.client", "Welcome to the Malta programme", {
        title: "Welcome to Citizen Lane",
        body: "Your Malta residence programme journey (Global Residence, Retirement or Startup Residence) begins today — your relationship manager guides every step.",
      }),
      node("n3", "approval.human.gate", "RM approves programme eligibility", {
        role: "RM",
      }),
      node("n4", "action.create.request", "Request identity documents", {
        docType: "NATIONAL_ID",
        title: "Identity documents",
        instructions:
          "Upload your national ID (and family members' IDs) for the programme file — each one is reviewed individually.",
        dueDays: 7,
        flexible: true,
      }),
      node("n5", "action.create.request", "Request the property commitment", {
        docType: "OTHER",
        title: "Property lease or purchase",
        instructions:
          "Upload the signed property lease or purchase commitment meeting the programme's minimum annual value.",
        dueDays: 14,
        flexible: true,
      }),
      node("n6", "action.create.request", "Request police records", {
        docType: "POLICE_RECORD",
        title: "Police records",
        instructions:
          "Upload a police conduct certificate for every applicant aged 18+ — each one is reviewed individually.",
        dueDays: 10,
        flexible: true,
      }),
      node(
        "n7",
        "approval.human.gate",
        "Compliance approves the programme file",
        { role: "SENIOR_RM" }
      ),
      node("n8", "action.notify.client", "Inform: filed with the agency", {
        title: "Application filed",
        body: "Your Malta residence programme file is complete and filed with the agency. We follow up every eight weeks and keep you informed.",
      }),
      node("n9", "delay.duration", "Schedule the agency check-in", {
        amount: 8,
        unit: "WEEKS",
        note: "Malta residence agency status check-in — update the client",
      }),
      node("n10", "action.notify.rm", "Brief the desk after check-in", {
        title: "Malta agency check-in due",
        body: "The scheduled programme check-in fell due — update the client with the agency's status.",
      }),
      node("n11", "action.audit.export", "Record the journey milestone", {
        note: "Malta residence programme journey checkpoint reached",
      }),
    ],
    edges: [...chainEdges(11)],
  },

  // Malta Company Set-Up service — the site's company formation offering
  // (name reservation → deed → MBR registration → VAT & tax numbers).
  "tpl-malta-company-setup": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.notify.client", "Welcome the founder", {
        title: "Welcome to Citizen Lane",
        body: "Your Malta company set-up begins today — your relationship manager will take you from name reservation to a registered company with VAT and tax numbers.",
      }),
      node(
        "n3",
        "approval.human.gate",
        "RM approves structure & company name",
        { role: "RM" }
      ),
      node("n4", "action.create.request", "Request KYC identity documents", {
        docType: "NATIONAL_ID",
        title: "KYC — beneficial owners & directors",
        instructions:
          "Upload the identity document of every beneficial owner and director for the KYC pack — each one is reviewed individually.",
        dueDays: 7,
        flexible: true,
      }),
      node("n5", "action.create.request", "Request source of share capital", {
        docType: "BANK_STATEMENT",
        title: "Source of share capital",
        instructions:
          "Upload bank statements evidencing the source of the share capital, as required for the KYC pack.",
        dueDays: 10,
        flexible: true,
      }),
      node("n6", "approval.human.gate", "Compliance approves the KYC pack", {
        role: "SENIOR_RM",
      }),
      node(
        "n7",
        "action.notify.client",
        "Inform: name reservation & deed underway",
        {
          title: "Company formation underway",
          body: "Your KYC pack is approved — we are reserving the company name and drafting the deed. We will confirm registration within two weeks.",
        }
      ),
      node("n8", "delay.duration", "Schedule the registry check-in", {
        amount: 2,
        unit: "WEEKS",
        note: "Malta Business Registry registration check-in",
      }),
      node("n9", "action.notify.rm", "Brief the desk after check-in", {
        title: "Registry check-in due",
        body: "The scheduled company-formation check-in fell due — confirm registration status and VAT/tax numbers.",
      }),
      node(
        "n10",
        "action.notify.client",
        "Confirm registration to the client",
        {
          title: "Your company is registered",
          body: "Your Malta company is registered — VAT and tax numbers are issued and your corporate documents are in the portal.",
        }
      ),
      node("n11", "action.audit.export", "Record the journey milestone", {
        note: "Malta company set-up journey checkpoint reached",
      }),
    ],
    edges: [...chainEdges(11)],
  },

  // Property investment — the site's "Invest in properties with Citizen Lane"
  // / "Find your new home" / "Find investment opportunities" offering.
  "tpl-property-investment": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.notify.client", "Welcome the property client", {
        title: "Welcome to Citizen Lane",
        body: "Your property investment journey begins today — your relationship manager will curate opportunities that fit your brief and budget.",
      }),
      node("n3", "approval.human.gate", "RM approves the property brief", {
        role: "RM",
      }),
      node("n4", "action.create.request", "Request proof of funds", {
        docType: "BANK_STATEMENT",
        title: "Proof of funds",
        instructions:
          "Upload bank statements evidencing the budget for the property search so the shortlist matches your buying power.",
        dueDays: 7,
        flexible: true,
      }),
      node(
        "n5",
        "approval.human.gate",
        "Senior approves the shortlist & budget",
        { role: "SENIOR_RM" }
      ),
      node("n6", "action.notify.client", "Inform: shortlist ready", {
        title: "Your property shortlist is ready",
        body: "Your curated shortlist is ready — your relationship manager will arrange viewings, in person or virtual, this week.",
      }),
      node("n7", "delay.duration", "Schedule the viewing follow-up", {
        amount: 1,
        unit: "WEEKS",
        note: "Follow up on viewings and shortlist feedback",
      }),
      node("n8", "action.notify.rm", "Brief the desk after viewings", {
        title: "Viewing feedback due",
        body: "The scheduled viewing follow-up fell due — collect the client's feedback and refine the shortlist.",
      }),
      node("n9", "action.audit.export", "Record the journey milestone", {
        note: "Property investment journey checkpoint reached",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4" },
      { from: "n4", to: "n5" },
      { from: "n5", to: "n6" },
      { from: "n6", to: "n7" },
      { from: "n7", to: "n8" },
      { from: "n8", to: "n9" },
    ],
  },
  "tpl-document-review-automation": {
    nodes: [
      node("n1", "trigger.document.approved", "Document approved"),
      node("n2", "action.notify.client", "Thank the applicant", {
        title: "Document approved",
        body: "Your document passed verification — our team takes it from here.",
      }),
      node("n3", "condition.field.equals", "Passport only?", {
        left: "docType",
        value: "PASSPORT",
      }),
      node("n4", "action.case.transition", "Advance case to IN_PROGRESS", {
        status: "IN_PROGRESS",
        reason: "Passport verified — advanced by Document Review Automation",
      }),
    ],
    edges: [
      { from: "n1", to: "n2" },
      { from: "n2", to: "n3" },
      { from: "n3", to: "n4", label: "true" },
    ],
  },

  // ── Flagship service journeys (Germany + Austria) ─────────────────────
  // The two homepage services with a dedicated end-to-end journey, mirroring
  // the Malta/property templates so "Use template" yields a publishable draft.
  "tpl-germany-business": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.notify.client", "Welcome the investor", {
        title: "Welcome to Citizen Lane",
        body: "Your Germany business-investment journey begins — your relationship manager will guide the GmbH incorporation and the residence-permit application.",
      }),
      node("n3", "approval.human.gate", "RM approves the business plan", {
        role: "RM",
      }),
      node("n4", "action.create.request", "Request the business plan", {
        docType: "OTHER",
        title: "Business plan & CV",
        instructions:
          "Upload your business plan and curriculum vitae for the German entity — the plan must show a viable, sustainable business (AufenthG §21).",
        dueDays: 10,
        flexible: true,
      }),
      node("n5", "action.create.request", "Request proof of capital", {
        docType: "BANK_STATEMENT",
        title: "Source of capital",
        instructions:
          "Upload bank statements evidencing the share capital and the funds to sustain the business.",
        dueDays: 10,
        flexible: true,
      }),
      node(
        "n6",
        "approval.human.gate",
        "Senior approves the incorporation dossier",
        { role: "SENIOR_RM" }
      ),
      node(
        "n7",
        "action.notify.client",
        "Inform: GmbH incorporation underway",
        {
          title: "Company formation underway",
          body: "Your dossier is approved — we are drafting the articles and filing with the Handelsregister. We will confirm registration shortly.",
        }
      ),
      node("n8", "delay.duration", "Schedule the registry check-in", {
        amount: 3,
        unit: "WEEKS",
        note: "Handelsregister registration check-in",
      }),
      node("n9", "action.notify.rm", "Brief the desk after check-in", {
        title: "Registry check-in due",
        body: "The scheduled Handelsregister check-in fell due — confirm the trade-register extract and the residence-permit appointment.",
      }),
      node(
        "n10",
        "action.notify.client",
        "Confirm the lodgement to the client",
        {
          title: "Residence permit lodged",
          body: "Your GmbH is registered and the residence-permit application is lodged with the German authority — we will follow up on your behalf.",
        }
      ),
      node("n11", "action.audit.export", "Record the journey milestone", {
        note: "Germany business-investment journey checkpoint reached",
      }),
    ],
    edges: [...chainEdges(11)],
  },
  "tpl-austria-residence": {
    nodes: [
      node("n1", "trigger.case.created", "Case created"),
      node("n2", "action.notify.client", "Welcome the applicant", {
        title: "Welcome to Citizen Lane",
        body: "Your Austria Residence Permit B journey begins — your relationship manager will prepare the dossier for the Austrian authority.",
      }),
      node("n3", "approval.human.gate", "RM approves the residence plan", {
        role: "RM",
      }),
      node(
        "n4",
        "action.create.request",
        "Request proof of financial independence",
        {
          docType: "BANK_STATEMENT",
          title: "Proof of financial independence",
          instructions:
            "Upload bank statements and a declaration evidencing sufficient and sustained means (Residence Permit B).",
          dueDays: 10,
          flexible: true,
        }
      ),
      node(
        "n5",
        "action.create.request",
        "Request accommodation & health insurance",
        {
          docType: "OTHER",
          title: "Accommodation & health insurance",
          instructions:
            "Upload your Austrian accommodation proof (lease or property) and health-insurance confirmation.",
          dueDays: 14,
          flexible: true,
        }
      ),
      node("n6", "approval.human.gate", "Senior approves the dossier", {
        role: "SENIOR_RM",
      }),
      node(
        "n7",
        "action.notify.client",
        "Inform: lodged with the Austrian authority",
        {
          title: "Application lodged",
          body: "Your dossier is complete and lodged with the Austrian residence authority (MA35) — we will track the decision for you.",
        }
      ),
      node("n8", "delay.duration", "Schedule the authority follow-up", {
        amount: 6,
        unit: "WEEKS",
        note: "Austrian authority follow-up (MA35)",
      }),
      node("n9", "action.notify.rm", "Brief the desk after the follow-up", {
        title: "Authority follow-up due",
        body: "The scheduled MA35 follow-up fell due — check the file status and update the client.",
      }),
      node("n10", "action.notify.client", "Confirm the outcome to the client", {
        title: "Residence Permit B decision",
        body: "We have an update on your Residence Permit B — your relationship manager will confirm the next steps in the portal.",
      }),
      node("n11", "action.audit.export", "Record the journey milestone", {
        note: "Austria Residence Permit B journey checkpoint reached",
      }),
    ],
    edges: [...chainEdges(11)],
  },
};

/** Ordered gallery metadata — pieces derived from the actual graphs. */
export function templateGallery(): Array<{
  key: string;
  name: string;
  category: string;
  description: string;
  pieces: string[];
  duration: string;
  risk: string;
}> {
  const catalog = [
    {
      key: "tpl-onboarding",
      name: "New Client Onboarding",
      category: "Onboarding",
      description:
        "Case created → notify RM → RM acknowledgement → welcome client.",
      duration: "~2 min automated",
      risk: "INTERNAL",
    },
    {
      key: "tpl-ocr-review",
      name: "Passport OCR Review",
      category: "Documents",
      description:
        "Document uploaded → notify RM → senior approval gate → notify client of result.",
      duration: "~3 min automated",
      risk: "PII",
    },
    {
      key: "tpl-missing-docs",
      name: "Missing Document Request",
      category: "Documents",
      description:
        "Condition on missing docs → create a document request (skipped when data is complete) → inform the team.",
      duration: "~1 min automated",
      risk: "INTERNAL",
    },
    {
      key: "tpl-dhl-dispatch",
      name: "DHL Dispatch & Follow-up",
      category: "Dispatch",
      description:
        "Dispatch prepared → senior approval → 6-week authority follow-up → notify client.",
      duration: "6 weeks scheduled",
      risk: "RESTRICTED",
    },
    {
      key: "tpl-approval-letter",
      name: "Approval in Principle Upload",
      category: "Decision",
      description: "Letter uploaded → notify client → audit export entry.",
      duration: "~1 min automated",
      risk: "RESTRICTED",
    },
    {
      key: "tpl-document-review-automation",
      name: "Document Review Automation",
      category: "Automation",
      description:
        "Document approved → thank the applicant → passports only → advance the case to IN_PROGRESS. Event-hub reactive automation on the document decision.",
      duration: "<1 min automated",
      risk: "INTERNAL",
    },
    {
      key: "tpl-audit-export",
      name: "Audit Export (PII-safe)",
      category: "Governance",
      description: "Manual trigger → export capped audit events to CSV.",
      duration: "<1 min",
      risk: "INTERNAL",
    },
    {
      key: "tpl-residence-renewal",
      name: "Residence Renewal",
      category: "Retention",
      description:
        "Renewal window → client reminder → document request → senior review → audit entry.",
      duration: "~14 days scheduled",
      risk: "PII",
    },
    {
      key: "tpl-welcome-journey",
      name: "Welcome Journey (branching)",
      category: "Onboarding",
      description:
        "Welcome note → completeness condition → nudge request only when data is missing → RM flag.",
      duration: "~5 days scheduled",
      risk: "INTERNAL",
    },
    {
      key: "tpl-escalation",
      name: "High-Risk Escalation",
      category: "Governance",
      description:
        "Flagged upload → risk condition → senior review gate → compliance escalation.",
      duration: "~2 min automated",
      risk: "RESTRICTED",
    },
    {
      key: "tpl-deadline-chase",
      name: "Deadline Chase",
      category: "Retention",
      description:
        "Reminder due → desk chase → RM confirmation gate → client reminder → audit record.",
      duration: "~2 min automated",
      risk: "INTERNAL",
    },
    {
      key: "tpl-contact-enquiry",
      name: "Contact Enquiry Concierge",
      category: "Website",
      description:
        "Lane Page form → auto-reply email when an address is given → RM alert → audit record.",
      duration: "<1 min automated",
      risk: "INTERNAL",
    },
    {
      key: "tpl-whatsapp-approval",
      name: "Approval Letter via WhatsApp",
      category: "Decision",
      description:
        "Letter uploaded → WhatsApp the applicant → portal notification → audit entry.",
      duration: "~1 min automated",
      risk: "PII",
    },
    {
      key: "tpl-ai-welcome",
      name: "AI Personal Welcome",
      category: "Onboarding",
      description:
        "Case created → AI composes a personal welcome → delivered to the applicant.",
      duration: "<1 min automated",
      risk: "INTERNAL",
    },
    {
      key: "tpl-consultation-booking",
      name: "Consultation Booking Concierge",
      category: "Website",
      description:
        "Page form → confirmation email (or call-back flag when no email) → desk alert → next-day preparation reminder → audit record.",
      duration: "1 day scheduled",
      risk: "INTERNAL",
    },
    {
      key: "tpl-newsletter-optin",
      name: "Newsletter Double Opt-in",
      category: "Website",
      description:
        "Signup form → consent-conditioned confirmation email → audit-recorded consent. Nothing stored without an email.",
      duration: "<1 min automated",
      risk: "PII",
    },
    {
      key: "tpl-factsheet-lead",
      name: "Factsheet Lead Magnet",
      category: "Website",
      description:
        "Factsheet form → automatic delivery email → RM lead flag → audit entry. The /contact-austria pattern, keyless.",
      duration: "<1 min automated",
      risk: "INTERNAL",
    },
    {
      key: "tpl-campaign-expo",
      name: "Event Campaign Follow-up",
      category: "Website",
      description:
        "Expo lead captured → desk alert → 1-day delay → WhatsApp when a phone exists, email otherwise → audit record.",
      duration: "1 day scheduled",
      risk: "PII",
    },
    {
      key: "tpl-signature-journey",
      name: "Signature Client Journey (RM × Client)",
      category: "Onboarding",
      description:
        "The full engagement from the product spec: welcome → RM secondary data approval → document requests → senior dossier approval → dispatch → 6-week authority follow-up.",
      duration: "6 weeks scheduled",
      risk: "PII",
    },

    // ── Service journeys — one per service family sold on citizen-lane.com ──
    {
      key: "tpl-cbi-citizenship",
      name: "Citizenship by Investment Journey",
      category: "Service Journeys",
      description:
        "For all 8 site citizenship programmes (Antigua & Barbuda, Austria, Cyprus, Malta, Montenegro, St Kitts & Nevis, Turkey, Vanuatu): passports + source-of-funds requests → compliance sign-off → dispatch → 6-week government follow-ups.",
      duration: "6 weeks scheduled",
      risk: "PII",
    },
    {
      key: "tpl-rbi-residence",
      name: "Residence by Investment Journey",
      category: "Service Journeys",
      description:
        "For all 10 site residence programmes (Germany business-investment flagship): identity + funds requests → senior approval → authority lodgement → 6-week follow-ups → registration certificate.",
      duration: "6 weeks scheduled",
      risk: "PII",
    },
    {
      key: "tpl-malta-mprp",
      name: "Malta MPRP Journey",
      category: "Service Journeys",
      description:
        "Malta Permanent Residence Programme: passports, asset test and police records → Residency Malta sign-off → submission → 12-week agency check-ins.",
      duration: "12 weeks scheduled",
      risk: "PII",
    },
    {
      key: "tpl-malta-residence-programmes",
      name: "Malta Residence Programmes Journey",
      category: "Service Journeys",
      description:
        "Global Residence / Retirement / Startup Residence: identity, property commitment and police records → compliance sign-off → agency filing → 8-week check-ins.",
      duration: "8 weeks scheduled",
      risk: "PII",
    },
    {
      key: "tpl-malta-company-setup",
      name: "Malta Company Set-Up Journey",
      category: "Service Journeys",
      description:
        "The company formation service: structure & name approval → KYC pack (owners, share capital) → compliance sign-off → registry check-in → registration confirmation with VAT/tax numbers.",
      duration: "2 weeks scheduled",
      risk: "PII",
    },
    {
      key: "tpl-property-investment",
      name: "Property Investment Journey",
      category: "Service Journeys",
      description:
        "The site's property offering (“Find your new home”): brief approval → proof of funds → shortlist approval → viewing week → feedback follow-up.",
      duration: "1 week scheduled",
      risk: "PII",
    },
    {
      key: "tpl-germany-business",
      name: "Germany Business Investment Journey",
      category: "Service Journeys",
      description:
        "The German flagship: business-plan approval → business plan & source-of-capital requests → senior sign-off → GmbH registration check-in → residence-permit lodgement.",
      duration: "3 weeks scheduled",
      risk: "PII",
    },
    {
      key: "tpl-austria-residence",
      name: "Austria Residence Permit B Journey",
      category: "Service Journeys",
      description:
        "The Austrian flagship: residence-plan approval → financial-independence & accommodation requests → senior sign-off → MA35 lodgement → 6-week authority follow-ups.",
      duration: "6 weeks scheduled",
      risk: "PII",
    },
  ];
  return catalog.map((t) => ({
    ...t,
    pieces: [
      ...new Set(TEMPLATE_GRAPHS[t.key]?.nodes.map((n) => n.pieceKey) ?? []),
    ],
  }));
}
