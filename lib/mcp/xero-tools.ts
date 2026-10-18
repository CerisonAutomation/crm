/**
 * Xero MCP tool catalogue.
 *
 * The full capability surface of the official Xero MCP server
 * (https://github.com/XeroAPI/xero-mcp-server), re-exposed through the
 * Citizen Lane MCP server under the `xero_` namespace so any MCP client can
 * drive the accounting ledger through the platform.
 *
 * Every tool is REAL: each call authenticates against Xero (Custom Connection
 * or bearer token) and hits the live API. When the connector is not
 * configured the tool answers with a structured `configured: false` result
 * rather than throwing — the platform never breaks because an external
 * provider is missing in a sandbox.
 */

import {
  getXeroConfig,
  getXeroSession,
  xeroGet,
  xeroPost,
  xeroDelete,
  payrollBase,
  XeroNotConfiguredError,
  type XeroSession,
} from "@/lib/services/xero";
import type { IntegrationConfig } from "@/lib/integrations";

export interface XeroMcpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/* ── schema helpers ─────────────────────────────────────────── */

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "number", description });
const bool = (description: string) => ({ type: "boolean", description });
const obj = (description: string) => ({ type: "object", description });

/** Common list parameters shared by every collection endpoint. */
const listProps = {
  where: str("optional Xero 'where' filter, e.g. Status==\"AUTHORISED\""),
  page: num("1-based page number for paginated collections"),
  order: str("optional order clause, e.g. Date DESC"),
  unitdp: num("unit decimal places (0-4) for amounts"),
};

const idProp = { id: str("Xero record id (the UUID from a list call)") };

/* ── tool catalogue ─────────────────────────────────────────── */

export const XERO_MCP_TOOLS: XeroMcpTool[] = [
  // ── list ──
  { name: "xero_list_accounts", description: "Retrieve the chart of accounts.", inputSchema: { type: "object", properties: listProps } },
  { name: "xero_list_contacts", description: "Retrieve contacts from Xero.", inputSchema: { type: "object", properties: { ...listProps, contactId: str("optional contact id to scope the result") } } },
  { name: "xero_list_credit_notes", description: "Retrieve credit notes.", inputSchema: { type: "object", properties: listProps } },
  { name: "xero_list_invoices", description: "Retrieve invoices (draft, authorised, paid).", inputSchema: { type: "object", properties: { ...listProps, contactId: str("optional contact id filter"), status: str("optional status filter, e.g. AUTHORISED") } } },
  { name: "xero_list_items", description: "Retrieve items (products and services).", inputSchema: { type: "object", properties: listProps } },
  { name: "xero_list_manual_journals", description: "Retrieve manual journals.", inputSchema: { type: "object", properties: listProps } },
  { name: "xero_list_organisation_details", description: "Retrieve details about the connected organisation.", inputSchema: { type: "object", properties: {} } },
  { name: "xero_list_profit_and_loss", description: "Retrieve a profit and loss report.", inputSchema: { type: "object", properties: { dateFrom: str("optional start date (YYYY-MM-DD)"), dateTo: str("optional end date (YYYY-MM-DD)"), periods: num("optional number of periods to compare") } } },
  { name: "xero_list_quotes", description: "Retrieve quotes.", inputSchema: { type: "object", properties: listProps } },
  { name: "xero_list_tax_rates", description: "Retrieve tax rates.", inputSchema: { type: "object", properties: listProps } },
  { name: "xero_list_payments", description: "Retrieve payments.", inputSchema: { type: "object", properties: listProps } },
  { name: "xero_list_trial_balance", description: "Retrieve a trial balance report.", inputSchema: { type: "object", properties: { dateTo: str("optional as-at date (YYYY-MM-DD)"), periods: num("optional number of periods to compare") } } },
  { name: "xero_list_bank_transactions", description: "Retrieve bank account transactions.", inputSchema: { type: "object", properties: listProps } },
  { name: "xero_list_payroll_employees", description: "Retrieve payroll employees.", inputSchema: { type: "object", properties: listProps } },
  { name: "xero_list_report_balance_sheet", description: "Retrieve a balance sheet report.", inputSchema: { type: "object", properties: { dateTo: str("optional as-at date (YYYY-MM-DD)"), periods: num("optional number of periods to compare") } } },
  { name: "xero_list_payroll_employee_leave", description: "Retrieve a payroll employee's leave records.", inputSchema: { type: "object", properties: { employeeId: str("payroll employee id"), ...listProps }, required: ["employeeId"] } },
  { name: "xero_list_payroll_employee_leave_balances", description: "Retrieve a payroll employee's leave balances.", inputSchema: { type: "object", properties: { employeeId: str("payroll employee id") }, required: ["employeeId"] } },
  { name: "xero_list_payroll_employee_leave_types", description: "Retrieve the leave types for a payroll employee.", inputSchema: { type: "object", properties: { employeeId: str("payroll employee id") }, required: ["employeeId"] } },
  { name: "xero_list_payroll_leave_periods", description: "Retrieve a payroll employee's leave periods.", inputSchema: { type: "object", properties: { employeeId: str("payroll employee id"), ...listProps }, required: ["employeeId"] } },
  { name: "xero_list_payroll_leave_types", description: "Retrieve every leave type available in Xero Payroll.", inputSchema: { type: "object", properties: listProps } },
  { name: "xero_list_timesheets", description: "Retrieve payroll timesheets.", inputSchema: { type: "object", properties: listProps } },
  { name: "xero_list_aged_receivables_by_contact", description: "Retrieve aged receivables for a contact.", inputSchema: { type: "object", properties: { contactId: str("contact id"), dateTo: str("optional as-at date (YYYY-MM-DD)") }, required: ["contactId"] } },
  { name: "xero_list_aged_payables_by_contact", description: "Retrieve aged payables for a contact.", inputSchema: { type: "object", properties: { contactId: str("contact id"), dateTo: str("optional as-at date (YYYY-MM-DD)") }, required: ["contactId"] } },
  { name: "xero_list_contact_groups", description: "Retrieve contact groups.", inputSchema: { type: "object", properties: listProps } },
  { name: "xero_list_tracking_categories", description: "Retrieve tracking categories.", inputSchema: { type: "object", properties: listProps } },

  // ── create ──
  { name: "xero_create_bank_transaction", description: "Create a bank transaction.", inputSchema: { type: "object", properties: { bankAccountId: str("bank account id"), type: str("RECEIVE or SPEND"), contactId: str("contact id"), lineAmounts: obj("array of { description, quantity, unitAmount, taxType }"), date: str("optional date (YYYY-MM-DD)") }, required: ["bankAccountId", "type", "contactId", "lineAmounts"] } },
  { name: "xero_create_contact", description: "Create a contact.", inputSchema: { type: "object", properties: { name: str("contact / organisation name"), email: str("optional email"), phone: str("optional phone") }, required: ["name"] } },
  { name: "xero_create_credit_note", description: "Create a credit note.", inputSchema: { type: "object", properties: { contactId: str("contact id"), lineAmounts: obj("array of { description, quantity, unitAmount, taxType }"), date: str("optional date (YYYY-MM-DD)") }, required: ["contactId", "lineAmounts"] } },
  { name: "xero_create_invoice", description: "Create an invoice (DRAFT by default).", inputSchema: { type: "object", properties: { contactId: str("contact id"), type: str("ACCREC or ACCPAY"), lineAmounts: obj("array of { description, quantity, unitAmount, taxType }"), date: str("optional date (YYYY-MM-DD)"), dueDate: str("optional due date (YYYY-MM-DD)"), reference: str("optional reference") }, required: ["contactId", "type", "lineAmounts"] } },
  { name: "xero_create_item", description: "Create an item.", inputSchema: { type: "object", properties: { name: str("item name"), code: str("optional item code"), description: str("optional description"), purchasePrice: num("optional purchase price"), salesPrice: num("optional sales price") }, required: ["name"] } },
  { name: "xero_create_manual_journal", description: "Create a manual journal.", inputSchema: { type: "object", properties: { date: str("optional date (YYYY-MM-DD)"), lines: obj("array of { accountCode, description, lineAmount, taxType }"), status: str("optional DRAFT or POSTED") }, required: ["lines"] } },
  { name: "xero_create_payment", description: "Create a payment against an invoice or bill.", inputSchema: { type: "object", properties: { invoiceId: str("invoice id"), bankAccountId: str("bank account id"), amount: num("amount to pay"), date: str("optional date (YYYY-MM-DD)") }, required: ["invoiceId", "bankAccountId", "amount"] } },
  { name: "xero_create_quote", description: "Create a quote.", inputSchema: { type: "object", properties: { contactId: str("contact id"), lineAmounts: obj("array of { description, quantity, unitAmount, taxType }"), date: str("optional date (YYYY-MM-DD)"), expiryDate: str("optional expiry date (YYYY-MM-DD)") }, required: ["contactId", "lineAmounts"] } },
  { name: "xero_create_payroll_timesheet", description: "Create a payroll timesheet.", inputSchema: { type: "object", properties: { employeeId: str("payroll employee id"), startDate: str("timesheet start date (YYYY-MM-DD)"), lines: obj("array of { earningsRateId, numberOfUnits }") }, required: ["employeeId", "startDate", "lines"] } },
  { name: "xero_create_tracking_category", description: "Create a tracking category.", inputSchema: { type: "object", properties: { name: str("tracking category name") }, required: ["name"] } },
  { name: "xero_create_tracking_option", description: "Create an option on a tracking category.", inputSchema: { type: "object", properties: { trackingCategoryId: str("tracking category id"), name: str("option name") }, required: ["trackingCategoryId", "name"] } },

  // ── update ──
  { name: "xero_update_bank_transaction", description: "Update an existing bank transaction.", inputSchema: { type: "object", properties: { ...idProp, lineAmounts: obj("array of { description, quantity, unitAmount, taxType }"), type: str("RECEIVE or SPEND") }, required: ["id"] } },
  { name: "xero_update_contact", description: "Update an existing contact.", inputSchema: { type: "object", properties: { ...idProp, name: str("contact / organisation name"), email: str("optional email"), phone: str("optional phone") }, required: ["id"] } },
  { name: "xero_update_invoice", description: "Update an existing draft invoice.", inputSchema: { type: "object", properties: { ...idProp, lineAmounts: obj("array of { description, quantity, unitAmount, taxType }"), type: str("ACCREC or ACCPAY"), dueDate: str("optional due date (YYYY-MM-DD)") }, required: ["id"] } },
  { name: "xero_update_item", description: "Update an existing item.", inputSchema: { type: "object", properties: { ...idProp, name: str("item name"), description: str("optional description"), purchasePrice: num("optional purchase price"), salesPrice: num("optional sales price") }, required: ["id"] } },
  { name: "xero_update_manual_journal", description: "Update an existing manual journal.", inputSchema: { type: "object", properties: { ...idProp, lines: obj("array of { accountCode, description, lineAmount, taxType }"), status: str("optional DRAFT or POSTED") }, required: ["id"] } },
  { name: "xero_update_quote", description: "Update an existing draft quote.", inputSchema: { type: "object", properties: { ...idProp, lineAmounts: obj("array of { description, quantity, unitAmount, taxType }"), expiryDate: str("optional expiry date (YYYY-MM-DD)") }, required: ["id"] } },
  { name: "xero_update_credit_note", description: "Update an existing draft credit note.", inputSchema: { type: "object", properties: { ...idProp, lineAmounts: obj("array of { description, quantity, unitAmount, taxType }") }, required: ["id"] } },
  { name: "xero_update_tracking_category", description: "Update an existing tracking category.", inputSchema: { type: "object", properties: { ...idProp, name: str("tracking category name") }, required: ["id"] } },
  { name: "xero_update_tracking_options", description: "Update a tracking option.", inputSchema: { type: "object", properties: { trackingCategoryId: str("tracking category id"), optionId: str("option id"), name: str("option name") }, required: ["trackingCategoryId", "optionId", "name"] } },
  { name: "xero_update_payroll_timesheet_line", description: "Update a line on an existing payroll timesheet.", inputSchema: { type: "object", properties: { timesheetId: str("timesheet id"), lineId: str("timesheet line id"), numberOfUnits: num("units for the line") }, required: ["timesheetId", "lineId", "numberOfUnits"] } },
  { name: "xero_approve_payroll_timesheet", description: "Approve a payroll timesheet.", inputSchema: { type: "object", properties: { timesheetId: str("timesheet id") }, required: ["timesheetId"] } },
  { name: "xero_revert_payroll_timesheet", description: "Revert an approved payroll timesheet to draft.", inputSchema: { type: "object", properties: { timesheetId: str("timesheet id") }, required: ["timesheetId"] } },
  { name: "xero_add_payroll_timesheet_line", description: "Add a line to an existing payroll timesheet.", inputSchema: { type: "object", properties: { timesheetId: str("timesheet id"), earningsRateId: str("earnings rate id"), numberOfUnits: num("units for the line") }, required: ["timesheetId", "earningsRateId", "numberOfUnits"] } },

  // ── delete ──
  { name: "xero_delete_payroll_timesheet", description: "Delete a payroll timesheet.", inputSchema: { type: "object", properties: { timesheetId: str("timesheet id") }, required: ["timesheetId"] } },

  // ── get ──
  { name: "xero_get_payroll_timesheet", description: "Retrieve a single payroll timesheet.", inputSchema: { type: "object", properties: { timesheetId: str("timesheet id") }, required: ["timesheetId"] } },
];

/* ── query-string builder ───────────────────────────────────── */

function buildQuery(args: Record<string, unknown>, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null || v === "") continue;
    if (k === "where" || k === "page" || k === "order" || k === "unitdp" || k === "periods" || k === "dateFrom" || k === "dateTo" || k === "contactId" || k === "employeeId" || k === "status") {
      params.set(k, String(v));
    }
  }
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Unwrap the primary collection from a Xero list response. */
function unwrap<T>(body: Record<string, unknown>, key: string): T[] {
  const value = body[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

/* ── handlers ───────────────────────────────────────────────── */

type Handler = (args: Record<string, unknown>, session: XeroSession, config: IntegrationConfig) => Promise<Record<string, unknown>>;

const handlers: Record<string, Handler> = {
  // ── list ──
  xero_list_accounts: async (_a, s) => ({ accounts: unwrap(await xeroGet("/Accounts", s), "Accounts") }),
  xero_list_contacts: async (a, s) => ({ contacts: unwrap(await xeroGet(`/Contacts${buildQuery(a)}`, s), "Contacts") }),
  xero_list_credit_notes: async (a, s) => ({ creditNotes: unwrap(await xeroGet(`/CreditNotes${buildQuery(a)}`, s), "CreditNotes") }),
  xero_list_invoices: async (a, s) => ({ invoices: unwrap(await xeroGet(`/Invoices${buildQuery(a)}`, s), "Invoices") }),
  xero_list_items: async (a, s) => ({ items: unwrap(await xeroGet(`/Items${buildQuery(a)}`, s), "Items") }),
  xero_list_manual_journals: async (a, s) => ({ manualJournals: unwrap(await xeroGet(`/ManualJournals${buildQuery(a)}`, s), "ManualJournals") }),
  xero_list_organisation_details: async (_a, s) => xeroGet("/Organisation", s),
  xero_list_profit_and_loss: async (a, s) => xeroGet(`/Reports/ProfitAndLoss${buildQuery(a)}`, s),
  xero_list_quotes: async (a, s) => ({ quotes: unwrap(await xeroGet(`/Quotes${buildQuery(a)}`, s), "Quotes") }),
  xero_list_tax_rates: async (a, s) => ({ taxRates: unwrap(await xeroGet(`/TaxRates${buildQuery(a)}`, s), "TaxRates") }),
  xero_list_payments: async (a, s) => ({ payments: unwrap(await xeroGet(`/Payments${buildQuery(a)}`, s), "Payments") }),
  xero_list_trial_balance: async (a, s) => xeroGet(`/Reports/TrialBalance${buildQuery(a)}`, s),
  xero_list_bank_transactions: async (a, s) => ({ bankTransactions: unwrap(await xeroGet(`/BankTransactions${buildQuery(a)}`, s), "BankTransactions") }),
  xero_list_payroll_employees: async (a, s, c) => ({ employees: unwrap(await xeroGet(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Employees${buildQuery(a)}`, s), "Employees") }),
  xero_list_report_balance_sheet: async (a, s) => xeroGet(`/Reports/BalanceSheet${buildQuery(a)}`, s),
  xero_list_payroll_employee_leave: async (a, s, c) => ({ leave: unwrap(await xeroGet(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Employees/${String(a.employeeId)}/Leave${buildQuery(a)}`, s), "Leave") }),
  xero_list_payroll_employee_leave_balances: async (a, s, c) => xeroGet(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Employees/${String(a.employeeId)}/LeaveBalances`, s),
  xero_list_payroll_employee_leave_types: async (a, s, c) => ({ leaveTypes: unwrap(await xeroGet(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Employees/${String(a.employeeId)}/LeaveTypes`, s), "LeaveTypes") }),
  xero_list_payroll_leave_periods: async (a, s, c) => ({ leavePeriods: unwrap(await xeroGet(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Employees/${String(a.employeeId)}/LeavePeriods${buildQuery(a)}`, s), "LeavePeriods") }),
  xero_list_payroll_leave_types: async (a, s, c) => ({ leaveTypes: unwrap(await xeroGet(`${payrollBase(String(c.payrollRegion ?? "AU"))}/LeaveTypes${buildQuery(a)}`, s), "LeaveTypes") }),
  xero_list_timesheets: async (a, s, c) => ({ timesheets: unwrap(await xeroGet(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Timesheets${buildQuery(a)}`, s), "Timesheets") }),
  xero_list_aged_receivables_by_contact: async (a, s) => xeroGet(`/Reports/AgedReceivablesByContact${buildQuery(a)}`, s),
  xero_list_aged_payables_by_contact: async (a, s) => xeroGet(`/Reports/AgedPayablesByContact${buildQuery(a)}`, s),
  xero_list_contact_groups: async (a, s) => ({ contactGroups: unwrap(await xeroGet(`/ContactGroups${buildQuery(a)}`, s), "ContactGroups") }),
  xero_list_tracking_categories: async (a, s) => ({ trackingCategories: unwrap(await xeroGet(`/TrackingCategories${buildQuery(a)}`, s), "TrackingCategories") }),

  // ── create ──
  xero_create_bank_transaction: async (a, s) => xeroPost("/BankTransactions", s, { BankAccountID: a.bankAccountId, Type: a.type, Contact: { ContactID: a.contactId }, LineItems: a.lineAmounts, Date: a.date }),
  xero_create_contact: async (a, s) => xeroPost("/Contacts", s, { Name: a.name, EmailAddress: a.email, Phone: a.phone }),
  xero_create_credit_note: async (a, s) => xeroPost("/CreditNotes", s, { Contact: { ContactID: a.contactId }, LineItems: a.lineAmounts, Date: a.date }),
  xero_create_invoice: async (a, s) => xeroPost("/Invoices", s, { Contact: { ContactID: a.contactId }, Type: a.type, LineItems: a.lineAmounts, Date: a.date, DueDate: a.dueDate, Reference: a.reference }),
  xero_create_item: async (a, s) => xeroPost("/Items", s, { Name: a.name, Code: a.code, Description: a.description, PurchaseDetails: { UnitPrice: a.purchasePrice }, SalesDetails: { UnitPrice: a.salesPrice } }),
  xero_create_manual_journal: async (a, s) => xeroPost("/ManualJournals", s, { Date: a.date, Lines: a.lines, Status: a.status }),
  xero_create_payment: async (a, s) => xeroPost("/Payments", s, { Invoice: { InvoiceID: a.invoiceId }, Account: { AccountID: a.bankAccountId }, Amount: a.amount, Date: a.date }),
  xero_create_quote: async (a, s) => xeroPost("/Quotes", s, { Contact: { ContactID: a.contactId }, LineItems: a.lineAmounts, Date: a.date, ExpiryDate: a.expiryDate }),
  xero_create_payroll_timesheet: async (a, s, c) => xeroPost(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Timesheets`, s, { EmployeeID: a.employeeId, StartDate: a.startDate, TimesheetLines: a.lines }),
  xero_create_tracking_category: async (a, s) => xeroPost("/TrackingCategories", s, { Name: a.name }),
  xero_create_tracking_option: async (a, s) => xeroPost(`/TrackingCategories/${String(a.trackingCategoryId)}/Options`, s, { Name: a.name }),

  // ── update ──
  xero_update_bank_transaction: async (a, s) => xeroPost(`/BankTransactions/${String(a.id)}`, s, { Type: a.type, LineItems: a.lineAmounts }),
  xero_update_contact: async (a, s) => xeroPost(`/Contacts/${String(a.id)}`, s, { Name: a.name, EmailAddress: a.email, Phone: a.phone }),
  xero_update_invoice: async (a, s) => xeroPost(`/Invoices/${String(a.id)}`, s, { Type: a.type, LineItems: a.lineAmounts, DueDate: a.dueDate }),
  xero_update_item: async (a, s) => xeroPost(`/Items/${String(a.id)}`, s, { Name: a.name, Description: a.description, PurchaseDetails: { UnitPrice: a.purchasePrice }, SalesDetails: { UnitPrice: a.salesPrice } }),
  xero_update_manual_journal: async (a, s) => xeroPost(`/ManualJournals/${String(a.id)}`, s, { Lines: a.lines, Status: a.status }),
  xero_update_quote: async (a, s) => xeroPost(`/Quotes/${String(a.id)}`, s, { LineItems: a.lineAmounts, ExpiryDate: a.expiryDate }),
  xero_update_credit_note: async (a, s) => xeroPost(`/CreditNotes/${String(a.id)}`, s, { LineItems: a.lineAmounts }),
  xero_update_tracking_category: async (a, s) => xeroPost(`/TrackingCategories/${String(a.id)}`, s, { Name: a.name }),
  xero_update_tracking_options: async (a, s) => xeroPost(`/TrackingCategories/${String(a.trackingCategoryId)}/Options/${String(a.optionId)}`, s, { Name: a.name }),
  xero_update_payroll_timesheet_line: async (a, s, c) => xeroPost(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Timesheets/${String(a.timesheetId)}/Lines/${String(a.lineId)}`, s, { NumberOfUnits: a.numberOfUnits }),
  xero_approve_payroll_timesheet: async (a, s, c) => xeroPost(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Timesheets/${String(a.timesheetId)}/Approve`, s, {}),
  xero_revert_payroll_timesheet: async (a, s, c) => xeroPost(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Timesheets/${String(a.timesheetId)}/RevertToDraft`, s, {}),
  xero_add_payroll_timesheet_line: async (a, s, c) => xeroPost(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Timesheets/${String(a.timesheetId)}/Lines`, s, { EarningsRateID: a.earningsRateId, NumberOfUnits: a.numberOfUnits }),

  // ── delete ──
  xero_delete_payroll_timesheet: async (a, s, c) => {
    await xeroDelete(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Timesheets/${String(a.timesheetId)}`, s);
    return { deleted: true, timesheetId: String(a.timesheetId) };
  },

  // ── get ──
  xero_get_payroll_timesheet: async (a, s, c) => xeroGet(`${payrollBase(String(c.payrollRegion ?? "AU"))}/Timesheets/${String(a.timesheetId)}`, s),
};

/* ── dispatcher ─────────────────────────────────────────────── */

/**
 * Invoke one Xero MCP tool. Reads the connector configuration, authenticates
 * and dispatches to the handler. A missing credential yields a structured
 * `configured: false` result rather than an error.
 */
export async function callXeroTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = await getXeroConfig();
  try {
    const session = await getXeroSession(config);
    const handler = handlers[name];
    if (!handler) throw new Error(`Unknown Xero tool: ${name}`);
    return await handler(args ?? {}, session, config);
  } catch (err) {
    if (err instanceof XeroNotConfiguredError) {
      return { configured: false, note: err.message };
    }
    throw err;
  }
}
