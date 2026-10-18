/**
 * Case facts — the GROUNDING LEDGER.
 *
 * `buildCaseContext` flattens live database reads into a prose string and hands
 * it to the agent. That string is the only thing the fallback replies are
 * grounded in, yet nothing about it is checkable: a sentence citing an absent
 * field is indistinguishable from one citing a real value.
 *
 * This module separates the two: `buildCaseFacts` returns a typed `CaseFact[]`
 * (the ledger — every entry points at one entity+field, carries a value or is
 * explicitly UNKNOWN, and names the SOURCE it was read from) PLUS the rendered
 * `text`, produced as a pure formatter over those facts. The prose is therefore
 * provably a projection of the ledger, and a model's claims can be checked
 * against the same entries.
 *
 * The formatter reproduces the historical `buildCaseContext` output exactly, so
 * swapping it in is behaviour-preserving: the ledger is added underneath, not in
 * place of, what agents already say.
 *
 * Prisma-free and pure, so it is unit-testable and importable anywhere.
 */

export type CaseFactEntity =
  | "Case"
  | "Client"
  | "Programme"
  | "Approval"
  | "Document"
  | "Request"
  | "Assignment"
  | "Dispatch"
  | "Letter"
  | "History";

export type CaseFactSourceKind =
  | "case"
  | "client"
  | "programme"
  | "document"
  | "request"
  | "dispatch"
  | "letter"
  | "history"
  | "assignment";

/** Where a fact was read from — the reference a citation points back at. */
export type CaseFactSource = {
  kind: CaseFactSourceKind;
  /** Stable reference an operator can act on (an entity id, or the case id). */
  ref: string;
  /** Human label for the citation chip. */
  label: string;
};

/**
 * One grounded claim. `value: null` marks a fact the row does NOT hold — the
 * honest representation of "unknown", never a placeholder string. The renderer
 * turns null into human wording ("none", "unassigned", "not recorded"), so the
 * ledger and the prose can never disagree about what was actually known.
 */
export type CaseFact = {
  id: string;
  entity: CaseFactEntity;
  field: string;
  value: string | null;
  source: CaseFactSource;
};

export type CaseFactsInput = {
  /** The case's own id — the `ref` for every case-level fact. */
  caseId: string;
  reference: string;
  /** Already-labelled status (caller owns the label vocabulary). */
  statusLabel: string;
  clientId: string;
  clientName: string;
  clientNationality: string | null;
  programmeId: string | null;
  programmeName: string | null;
  programmeCountry: string | null;
  dataApproval: string | null;
  serviceApproval: string | null;
  documents: ReadonlyArray<{ id: string; type: string; status: string }>;
  requests: ReadonlyArray<{ id: string; title: string; status: string; dueDate: Date | null }>;
  relationshipManagers: readonly string[];
  dispatch: { id: string; trackingId: string; status: string } | null;
  letterVersion: number | null;
  /** Already-labelled transitions, in the order they should read. */
  recentTransitions: readonly string[];
};

export type CaseFactsBundle = {
  /** The grounding ledger — one entry per entity/field read. */
  facts: CaseFact[];
  /** The prose projection agents consume today (byte-identical to before). */
  text: string;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

/** Build the ledger and its prose projection from a resolved case snapshot. */
export function buildCaseFacts(input: CaseFactsInput): CaseFactsBundle {
  const {
    caseId,
    reference,
    statusLabel,
    clientId,
    clientName,
    clientNationality,
    programmeId,
    programmeName,
    programmeCountry,
    dataApproval,
    serviceApproval,
    documents,
    requests,
    relationshipManagers,
    dispatch,
    letterVersion,
    recentTransitions,
  } = input;

  const caseSource: CaseFactSource = { kind: "case", ref: caseId, label: reference };
  const programmeSource: CaseFactSource = {
    kind: "programme",
    ref: programmeId ?? caseId,
    label: programmeName ?? "Programme",
  };

  const facts: CaseFact[] = [
    { id: "case.reference", entity: "Case", field: "reference", value: reference, source: caseSource },
    { id: "case.status", entity: "Case", field: "status", value: statusLabel, source: caseSource },
    {
      id: "client.name",
      entity: "Client",
      field: "name",
      value: clientName,
      source: { kind: "client", ref: clientId, label: clientName },
    },
    {
      id: "client.nationality",
      entity: "Client",
      field: "nationality",
      value: clientNationality,
      source: { kind: "client", ref: clientId, label: clientName },
    },
    { id: "programme.name", entity: "Programme", field: "name", value: programmeName, source: programmeSource },
    { id: "programme.country", entity: "Programme", field: "country", value: programmeCountry, source: programmeSource },
    { id: "approval.data", entity: "Approval", field: "dataApproval", value: dataApproval, source: caseSource },
    { id: "approval.service", entity: "Approval", field: "serviceApproval", value: serviceApproval, source: caseSource },
  ];

  documents.forEach((d, i) => {
    facts.push({
      id: `document.${i}`,
      entity: "Document",
      field: d.type,
      value: d.status,
      source: { kind: "document", ref: d.id, label: d.type },
    });
  });

  requests.forEach((r, i) => {
    const source: CaseFactSource = { kind: "request", ref: r.id, label: r.title };
    facts.push({ id: `request.${i}.status`, entity: "Request", field: r.title, value: r.status, source });
    facts.push({
      id: `request.${i}.due`,
      entity: "Request",
      field: `${r.title} due`,
      value: r.dueDate ? day(r.dueDate) : null,
      source,
    });
  });

  relationshipManagers.forEach((name, i) => {
    facts.push({
      id: `assignment.${i}`,
      entity: "Assignment",
      field: "user",
      value: name,
      source: { kind: "assignment", ref: caseId, label: name },
    });
  });

  if (dispatch) {
    const source: CaseFactSource = { kind: "dispatch", ref: dispatch.id, label: dispatch.trackingId };
    facts.push({ id: "dispatch.trackingId", entity: "Dispatch", field: "trackingId", value: dispatch.trackingId, source });
    facts.push({ id: "dispatch.status", entity: "Dispatch", field: "status", value: dispatch.status, source });
  } else {
    facts.push({
      id: "dispatch.trackingId",
      entity: "Dispatch",
      field: "trackingId",
      value: null,
      source: { kind: "dispatch", ref: caseId, label: "Dispatch" },
    });
  }

  facts.push({
    id: "letter.version",
    entity: "Letter",
    field: "version",
    value: letterVersion === null ? null : String(letterVersion),
    source: { kind: "letter", ref: caseId, label: "Approval letter" },
  });

  recentTransitions.forEach((t, i) => {
    facts.push({
      id: `history.${i}`,
      entity: "History",
      field: "to",
      value: t,
      source: { kind: "history", ref: caseId, label: "Status history" },
    });
  });

  const docs = documents.map((d) => `${d.type}=${d.status}`).join(", ") || "none";
  const reqs =
    requests
      .map((r) => {
        const due = r.dueDate ? `, due ${day(r.dueDate)}` : "";
        return `${r.title} (${r.status}${due})`;
      })
      .join("; ") || "none";
  const rm = relationshipManagers.join(", ") || "unassigned";

  const text = [
    `Case ${reference} — status ${statusLabel}.`,
    `Client: ${clientName}${clientNationality ? ` (${clientNationality})` : ""}.`,
    `Programme: ${programmeName ? `${programmeName} (${programmeCountry})` : "not selected"}.`,
    // An absent approval is NOT "pending" — "PENDING" is a real enum value.
    `Data approval: ${dataApproval ?? "not recorded"}; service approval: ${serviceApproval ?? "not recorded"}.`,
    `Documents: ${docs}.`,
    `Requests: ${reqs}.`,
    `Relationship manager(s): ${rm}.`,
    `Dispatch: ${dispatch ? `${dispatch.trackingId} (${dispatch.status})` : "none"}.`,
    `Approval letter: ${letterVersion !== null ? `v${letterVersion} on file` : "not uploaded"}.`,
    `Recent transitions: ${recentTransitions.join(" ← ") || "none"}.`,
  ].join("\n");

  return { facts, text };
}

/** Ledger entries that hold no value — the gaps a reply must not paper over. */
export function ungroundedFacts(facts: readonly CaseFact[]): CaseFact[] {
  return facts.filter((f) => f.value === null);
}

/** Confidence in a grounded answer: the share of the ledger that holds a value. */
export function ledgerConfidence(facts: readonly CaseFact[]): number {
  if (facts.length === 0) return 0;
  const known = facts.filter((f) => f.value !== null).length;
  return Math.round((known / facts.length) * 100) / 100;
}

/** One citable fact, as returned to a client. */
export type AgentCitation = {
  factId: string;
  entity: string;
  field: string;
  value: string | null;
  source: CaseFactSource;
};

export type ReplyCitationVerdict = {
  ok: boolean;
  /** Every ledger-shaped [id] the reply cited, in order. */
  citedIds: string[];
  /** Cited ids with no ledger entry — the reply states what was never read. */
  unknownIds: string[];
};

/**
 * E12 cited-only gate: a reply may cite ONLY facts in the ledger.
 *
 * The copilot prompt instructs the model to cite fact ids in square brackets
 * (e.g. [case.status]). Every bracketed token shaped like a fact id
 * (dotted path) is checked against the ledger; a citation with no entry
 * means the reply states what was never read, and the verdict fails. Tokens
 * without a dot ([80], [see above]) are prose, not citations, and are ignored.
 */
export function verifyReplyCitations(reply: string, facts: readonly CaseFact[]): ReplyCitationVerdict {
  const known = new Set(facts.map((f) => f.id));
  const citedIds: string[] = [];
  const seen = new Set<string>();
  const re = /\[([A-Za-z][\w]*(?:\.[\w-]+)+)\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(reply)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      citedIds.push(m[1]);
    }
  }
  const unknownIds = citedIds.filter((id) => !known.has(id));
  return { ok: unknownIds.length === 0, citedIds, unknownIds };
};
/** Project the ledger into citations (bounded, so a big case cannot bloat a response). */
export function toCitations(facts: readonly CaseFact[], limit = 24): AgentCitation[] {
  return facts.slice(0, limit).map((f) => ({
    factId: f.id,
    entity: f.entity,
    field: f.field,
    value: f.value,
    source: f.source,
  }));
}
