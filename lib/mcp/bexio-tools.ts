/**
 * Bexio MCP tool catalogue.
 *
 * The full capability surface of the official bexio-mcp-server
 * (https://github.com/PromptPartner/bexio-mcp-server), re-exposed through the
 * Citizen Lane MCP server under the `bexio_` namespace so any MCP client can
 * drive the Bexio accounting ledger through the platform.
 *
 * Every tool is REAL: each call authenticates against Bexio and hits the live
 * API. When the connector is not configured the tool answers with a structured
 * `configured: false` result rather than throwing — the platform never breaks
 * because an external provider is missing in a sandbox.
 */

import {
  getBexioConfig,
  getBexioSession,
  bexioGet,
  bexioPost,
  bexioPut,
  bexioPatch,
  bexioDelete,
  requestVersioned,
  BexioNotConfiguredError,
  type BexioSession,
} from "@/lib/services/bexio";
import type { IntegrationConfig } from "@/lib/integrations";

export interface BexioMcpTool {
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
  where: str("optional Bexio 'where' filter, e.g. status=='DRAFT'"),
  page: num("1-based page number for paginated collections"),
  order: str("optional order clause, e.g. date DESC"),
};

const idProp = { id: str("Bexio record id (the integer id from a list call)") };

/* ── tool catalogue ─────────────────────────────────────────── */

export const BEXIO_MCP_TOOLS: BexioMcpTool[] = [
  // ── reference ──
  { name: "bexio_list_currencies", description: "Retrieve currencies.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_list_taxes", description: "Retrieve tax rates.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_list_payment_types", description: "Retrieve payment types.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_list_account_types", description: "Retrieve account types.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_list_document_types", description: "Retrieve document types.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_list_salutations", description: "Retrieve salutations.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_list_titles", description: "Retrieve titles.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_list_languages", description: "Retrieve languages.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_list_countries", description: "Retrieve countries.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_list_time_units", description: "Retrieve time units.", inputSchema: { type: "object", properties: listProps } },

  // ── company ──
  { name: "bexio_get_company_profile", description: "Retrieve the connected Bexio company profile.", inputSchema: { type: "object", properties: {} } },
  { name: "bexio_list_company_users", description: "Retrieve company users.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_company_settings", description: "Retrieve company settings.", inputSchema: { type: "object", properties: {} } },

  // ── banking ──
  { name: "bexio_list_bank_accounts", description: "Retrieve bank accounts.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_bank_account", description: "Retrieve a single bank account by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_bank_transactions", description: "Retrieve bank transactions.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_bank_transaction", description: "Retrieve a single bank transaction by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_bank_account_transactions", description: "Retrieve transactions for a bank account.", inputSchema: { type: "object", properties: { ...listProps, bankAccountId: str("bank account id") }, required: ["bankAccountId"] } },
  { name: "bexio_create_bank_transaction", description: "Create a bank transaction.", inputSchema: { type: "object", properties: { bankAccountId: str("bank account id"), amount: num("amount"), date: str("date (YYYY-MM-DD)"), description: str("optional description") }, required: ["bankAccountId", "amount", "date"] } },
  { name: "bexio_update_bank_transaction", description: "Update a bank transaction.", inputSchema: { type: "object", properties: { ...idProp, amount: num("amount"), date: str("date (YYYY-MM-DD)"), description: str("optional description") }, required: ["id"] } },
  { name: "bexio_delete_bank_transaction", description: "Delete a bank transaction.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_bank_account_balances", description: "Retrieve bank account balances.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_bank_account_balance", description: "Retrieve a single bank account balance by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_bank_account_statements", description: "Retrieve bank account statements.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_bank_account_statement", description: "Retrieve a single bank account statement by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_bank_account_statement", description: "Create a bank account statement.", inputSchema: { type: "object", properties: { bankAccountId: str("bank account id"), date: str("date (YYYY-MM-DD)"), balance: num("balance") }, required: ["bankAccountId", "date", "balance"] } },
  { name: "bexio_update_bank_account_statement", description: "Update a bank account statement.", inputSchema: { type: "object", properties: { ...idProp, balance: num("balance") }, required: ["id"] } },
  { name: "bexio_delete_bank_account_statement", description: "Delete a bank account statement.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── projects ──
  { name: "bexio_list_projects", description: "Retrieve projects.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_project", description: "Retrieve a single project by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_project", description: "Create a project.", inputSchema: { type: "object", properties: { name: str("project name"), projectTypeId: str("optional project type id"), projectStateId: str("optional project state id"), description: str("optional description") }, required: ["name"] } },
  { name: "bexio_update_project", description: "Update an existing project.", inputSchema: { type: "object", properties: { ...idProp, name: str("project name"), description: str("optional description"), projectStateId: str("optional project state id") }, required: ["id"] } },
  { name: "bexio_delete_project", description: "Delete a project.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_project_types", description: "Retrieve project types.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_project_type", description: "Retrieve a single project type by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_project_states", description: "Retrieve project states.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_project_state", description: "Retrieve a single project state by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_project_tasks", description: "Retrieve tasks for a project.", inputSchema: { type: "object", properties: { ...listProps, projectId: str("project id") }, required: ["projectId"] } },
  { name: "bexio_get_project_task", description: "Retrieve a single project task by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_project_task", description: "Create a project task.", inputSchema: { type: "object", properties: { projectId: str("project id"), title: str("task title"), description: str("optional description"), dueDate: str("optional due date (YYYY-MM-DD)") }, required: ["projectId", "title"] } },
  { name: "bexio_update_project_task", description: "Update a project task.", inputSchema: { type: "object", properties: { ...idProp, title: str("task title"), description: str("optional description"), dueDate: str("optional due date (YYYY-MM-DD)") }, required: ["id"] } },
  { name: "bexio_delete_project_task", description: "Delete a project task.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_project_timesheets", description: "Retrieve timesheets for a project.", inputSchema: { type: "object", properties: { ...listProps, projectId: str("project id") }, required: ["projectId"] } },

  // ── timetracking ──
  { name: "bexio_list_timesheets", description: "Retrieve timesheets.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_timesheet", description: "Retrieve a single timesheet by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_timesheet", description: "Create a timesheet entry.", inputSchema: { type: "object", properties: { contactId: str("contact id"), clientServiceId: str("optional client service id"), date: str("date (YYYY-MM-DD)"), duration: num("duration in minutes"), description: str("optional description") }, required: ["contactId", "date"] } },
  { name: "bexio_update_timesheet", description: "Update an existing timesheet entry.", inputSchema: { type: "object", properties: { ...idProp, duration: num("duration in minutes"), description: str("optional description") }, required: ["id"] } },
  { name: "bexio_delete_timesheet", description: "Delete a timesheet entry.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_client_services", description: "Retrieve client services (for timetracking).", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_client_service", description: "Retrieve a single client service by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_client_service", description: "Create a client service.", inputSchema: { type: "object", properties: { name: str("service name"), description: str("optional description"), hourlyRate: num("optional hourly rate") }, required: ["name"] } },
  { name: "bexio_update_client_service", description: "Update a client service.", inputSchema: { type: "object", properties: { ...idProp, name: str("service name"), description: str("optional description"), hourlyRate: num("optional hourly rate") }, required: ["id"] } },
  { name: "bexio_delete_client_service", description: "Delete a client service.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_time_entries", description: "Retrieve time entries.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_time_entry", description: "Retrieve a single time entry by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_time_entry", description: "Create a time entry.", inputSchema: { type: "object", properties: { timesheetId: str("timesheet id"), date: str("date (YYYY-MM-DD)"), duration: num("duration in minutes"), description: str("optional description") }, required: ["timesheetId", "date", "duration"] } },
  { name: "bexio_update_time_entry", description: "Update a time entry.", inputSchema: { type: "object", properties: { ...idProp, duration: num("duration in minutes"), description: str("optional description") }, required: ["id"] } },
  { name: "bexio_delete_time_entry", description: "Delete a time entry.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── accounting ──
  { name: "bexio_list_accounts", description: "Retrieve the chart of accounts.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_account", description: "Retrieve a single account by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_manual_entries", description: "Retrieve manual accounting entries.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_manual_entry", description: "Retrieve a single manual entry by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_manual_entry", description: "Create a manual accounting entry.", inputSchema: { type: "object", properties: { date: str("optional date (YYYY-MM-DD)"), lines: obj("array of { account_id, description, debit, credit }") }, required: ["lines"] } },
  { name: "bexio_update_manual_entry", description: "Update a manual accounting entry.", inputSchema: { type: "object", properties: { ...idProp, date: str("optional date (YYYY-MM-DD)"), lines: obj("array of { account_id, description, debit, credit }") }, required: ["id"] } },
  { name: "bexio_delete_manual_entry", description: "Delete a manual accounting entry.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_journal", description: "Retrieve journal entries.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_journal_entry", description: "Retrieve a single journal entry by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_account_balances", description: "Retrieve account balances.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_account_balance", description: "Retrieve a single account balance by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_account_statements", description: "Retrieve account statements.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_account_statement", description: "Retrieve a single account statement by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_account_statement", description: "Create an account statement.", inputSchema: { type: "object", properties: { accountId: str("account id"), date: str("date (YYYY-MM-DD)"), balance: num("balance") }, required: ["accountId", "date", "balance"] } },
  { name: "bexio_update_account_statement", description: "Update an account statement.", inputSchema: { type: "object", properties: { ...idProp, balance: num("balance") }, required: ["id"] } },
  { name: "bexio_delete_account_statement", description: "Delete an account statement.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_account_transactions", description: "Retrieve account transactions.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_account_transaction", description: "Retrieve a single account transaction by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_account_transaction", description: "Create an account transaction.", inputSchema: { type: "object", properties: { accountId: str("account id"), amount: num("amount"), date: str("date (YYYY-MM-DD)"), description: str("optional description") }, required: ["accountId", "amount", "date"] } },
  { name: "bexio_delete_account_transaction", description: "Delete an account transaction.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── purchase ──
  { name: "bexio_list_bills", description: "Retrieve purchase bills (v4.0).", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_bill", description: "Retrieve a single bill by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_bill", description: "Create a purchase bill.", inputSchema: { type: "object", properties: { supplierId: str("supplier id"), date: str("date (YYYY-MM-DD)"), dueDate: str("optional due date (YYYY-MM-DD)"), lineItems: obj("array of { description, quantity, unit_amount, tax_rate_id }") }, required: ["supplierId", "date", "lineItems"] } },
  { name: "bexio_update_bill", description: "Update a purchase bill.", inputSchema: { type: "object", properties: { ...idProp, date: str("date (YYYY-MM-DD)"), dueDate: str("optional due date (YYYY-MM-DD)"), lineItems: obj("array of { description, quantity, unit_amount, tax_rate_id }") }, required: ["id"] } },
  { name: "bexio_delete_bill", description: "Delete a purchase bill.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_expenses", description: "Retrieve expenses (v4.0).", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_expense", description: "Retrieve a single expense by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_expense", description: "Create an expense.", inputSchema: { type: "object", properties: { date: str("date (YYYY-MM-DD)"), amount: num("amount"), description: str("optional description"), categoryId: str("optional category id") }, required: ["date", "amount"] } },
  { name: "bexio_update_expense", description: "Update an expense.", inputSchema: { type: "object", properties: { ...idProp, date: str("date (YYYY-MM-DD)"), amount: num("amount"), description: str("optional description"), categoryId: str("optional category id") }, required: ["id"] } },
  { name: "bexio_delete_expense", description: "Delete an expense.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_purchase_orders", description: "Retrieve purchase orders (v3.0).", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_purchase_order", description: "Retrieve a single purchase order by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_purchase_order", description: "Create a purchase order.", inputSchema: { type: "object", properties: { supplierId: str("supplier id"), date: str("date (YYYY-MM-DD)"), lineItems: obj("array of { description, quantity, unit_amount, tax_rate_id }") }, required: ["supplierId", "date", "lineItems"] } },
  { name: "bexio_update_purchase_order", description: "Update a purchase order.", inputSchema: { type: "object", properties: { ...idProp, date: str("date (YYYY-MM-DD)"), lineItems: obj("array of { description, quantity, unit_amount, tax_rate_id }") }, required: ["id"] } },
  { name: "bexio_delete_purchase_order", description: "Delete a purchase order.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_suppliers", description: "Retrieve suppliers.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_supplier", description: "Retrieve a single supplier by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_supplier", description: "Create a supplier.", inputSchema: { type: "object", properties: { name: str("supplier name"), email: str("optional email"), phone: str("optional phone") }, required: ["name"] } },
  { name: "bexio_update_supplier", description: "Update a supplier.", inputSchema: { type: "object", properties: { ...idProp, name: str("supplier name"), email: str("optional email"), phone: str("optional phone") }, required: ["id"] } },
  { name: "bexio_delete_supplier", description: "Delete a supplier.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── files ──
  { name: "bexio_list_files", description: "Retrieve files.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_file", description: "Retrieve a single file by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_file", description: "Create a file.", inputSchema: { type: "object", properties: { name: str("file name"), content: str("file content (base64)"), categoryId: str("optional category id") }, required: ["name", "content"] } },
  { name: "bexio_update_file", description: "Update a file.", inputSchema: { type: "object", properties: { ...idProp, name: str("file name"), content: str("file content (base64)") }, required: ["id"] } },
  { name: "bexio_delete_file", description: "Delete a file.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_file_categories", description: "Retrieve file categories.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_file_category", description: "Retrieve a single file category by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_file_category", description: "Create a file category.", inputSchema: { type: "object", properties: { name: str("category name") }, required: ["name"] } },
  { name: "bexio_update_file_category", description: "Update a file category.", inputSchema: { type: "object", properties: { ...idProp, name: str("category name") }, required: ["id"] } },
  { name: "bexio_delete_file_category", description: "Delete a file category.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── payroll ──
  { name: "bexio_list_payroll_runs", description: "Retrieve payroll runs.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_payroll_run", description: "Retrieve a single payroll run by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_payroll_run", description: "Create a payroll run.", inputSchema: { type: "object", properties: { date: str("date (YYYY-MM-DD)"), description: str("optional description") }, required: ["date"] } },
  { name: "bexio_update_payroll_run", description: "Update a payroll run.", inputSchema: { type: "object", properties: { ...idProp, date: str("date (YYYY-MM-DD)"), description: str("optional description") }, required: ["id"] } },
  { name: "bexio_delete_payroll_run", description: "Delete a payroll run.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_payroll_items", description: "Retrieve payroll items.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_payroll_item", description: "Retrieve a single payroll item by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_payroll_item", description: "Create a payroll item.", inputSchema: { type: "object", properties: { payrollRunId: str("payroll run id"), description: str("description"), amount: num("amount") }, required: ["payrollRunId", "description", "amount"] } },
  { name: "bexio_update_payroll_item", description: "Update a payroll item.", inputSchema: { type: "object", properties: { ...idProp, description: str("description"), amount: num("amount") }, required: ["id"] } },
  { name: "bexio_delete_payroll_item", description: "Delete a payroll item.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── contacts ──
  { name: "bexio_list_contacts", description: "Retrieve contacts from Bexio.", inputSchema: { type: "object", properties: { ...listProps, contactId: str("optional contact id to scope the result") } } },
  { name: "bexio_get_contact", description: "Retrieve a single contact by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_contact", description: "Create a contact.", inputSchema: { type: "object", properties: { name: str("contact / organisation name"), email: str("optional email"), phone: str("optional phone"), type: str("optional: person or company") }, required: ["name"] } },
  { name: "bexio_update_contact", description: "Update an existing contact.", inputSchema: { type: "object", properties: { ...idProp, name: str("contact / organisation name"), email: str("optional email"), phone: str("optional phone") }, required: ["id"] } },
  { name: "bexio_delete_contact", description: "Delete a contact.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_contact_groups", description: "Retrieve contact groups.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_contact_group", description: "Retrieve a single contact group by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_contact_group", description: "Create a contact group.", inputSchema: { type: "object", properties: { name: str("group name") }, required: ["name"] } },
  { name: "bexio_update_contact_group", description: "Update a contact group.", inputSchema: { type: "object", properties: { ...idProp, name: str("group name") }, required: ["id"] } },
  { name: "bexio_delete_contact_group", description: "Delete a contact group.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_contact_addresses", description: "Retrieve contact addresses.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_contact_address", description: "Retrieve a single contact address by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_contact_address", description: "Create a contact address.", inputSchema: { type: "object", properties: { contactId: str("contact id"), street: str("street"), city: str("city"), zip: str("zip code"), country: str("country") }, required: ["contactId", "street", "city"] } },
  { name: "bexio_update_contact_address", description: "Update a contact address.", inputSchema: { type: "object", properties: { ...idProp, street: str("street"), city: str("city"), zip: str("zip code"), country: str("country") }, required: ["id"] } },
  { name: "bexio_delete_contact_address", description: "Delete a contact address.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── invoices ──
  { name: "bexio_list_invoices", description: "Retrieve invoices (draft, paid, overdue).", inputSchema: { type: "object", properties: { ...listProps, contactId: str("optional contact id filter"), status: str("optional status filter, e.g. PAID") } } },
  { name: "bexio_get_invoice", description: "Retrieve a single invoice by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_invoice", description: "Create an invoice.", inputSchema: { type: "object", properties: { contactId: str("contact id"), lineItems: obj("array of { description, quantity, unit_amount, tax_rate_id }"), date: str("optional date (YYYY-MM-DD)"), dueDate: str("optional due date (YYYY-MM-DD)"), reference: str("optional reference") }, required: ["contactId", "lineItems"] } },
  { name: "bexio_update_invoice", description: "Update an existing invoice.", inputSchema: { type: "object", properties: { ...idProp, lineItems: obj("array of { description, quantity, unit_amount, tax_rate_id }"), dueDate: str("optional due date (YYYY-MM-DD)") }, required: ["id"] } },
  { name: "bexio_delete_invoice", description: "Delete an invoice.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_invoice_payments", description: "Retrieve invoice payments.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_invoice_payment", description: "Retrieve a single invoice payment by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_invoice_payment", description: "Record a payment against an invoice.", inputSchema: { type: "object", properties: { invoiceId: str("invoice id"), bankAccountId: str("bank account id"), amount: num("amount to pay"), date: str("optional date (YYYY-MM-DD)") }, required: ["invoiceId", "bankAccountId", "amount"] } },
  { name: "bexio_update_invoice_payment", description: "Update an invoice payment.", inputSchema: { type: "object", properties: { ...idProp, amount: num("amount to pay"), date: str("optional date (YYYY-MM-DD)") }, required: ["id"] } },
  { name: "bexio_delete_invoice_payment", description: "Delete an invoice payment.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_invoice_positions", description: "Retrieve invoice positions.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_invoice_position", description: "Retrieve a single invoice position by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_invoice_position", description: "Create an invoice position.", inputSchema: { type: "object", properties: { invoiceId: str("invoice id"), description: str("description"), quantity: num("quantity"), unitAmount: num("unit amount"), taxRateId: str("optional tax rate id") }, required: ["invoiceId", "description", "quantity", "unitAmount"] } },
  { name: "bexio_update_invoice_position", description: "Update an invoice position.", inputSchema: { type: "object", properties: { ...idProp, description: str("description"), quantity: num("quantity"), unitAmount: num("unit amount"), taxRateId: str("optional tax rate id") }, required: ["id"] } },
  { name: "bexio_delete_invoice_position", description: "Delete an invoice position.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── orders ──
  { name: "bexio_list_orders", description: "Retrieve orders.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_order", description: "Retrieve a single order by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_order", description: "Create an order.", inputSchema: { type: "object", properties: { contactId: str("contact id"), lineItems: obj("array of { description, quantity, unit_amount, tax_rate_id }"), date: str("optional date (YYYY-MM-DD)") }, required: ["contactId", "lineItems"] } },
  { name: "bexio_update_order", description: "Update an existing order.", inputSchema: { type: "object", properties: { ...idProp, lineItems: obj("array of { description, quantity, unit_amount, tax_rate_id }") }, required: ["id"] } },
  { name: "bexio_delete_order", description: "Delete an order.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_order_positions", description: "Retrieve order positions.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_order_position", description: "Retrieve a single order position by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_order_position", description: "Create an order position.", inputSchema: { type: "object", properties: { orderId: str("order id"), description: str("description"), quantity: num("quantity"), unitAmount: num("unit amount"), taxRateId: str("optional tax rate id") }, required: ["orderId", "description", "quantity", "unitAmount"] } },
  { name: "bexio_update_order_position", description: "Update an order position.", inputSchema: { type: "object", properties: { ...idProp, description: str("description"), quantity: num("quantity"), unitAmount: num("unit amount"), taxRateId: str("optional tax rate id") }, required: ["id"] } },
  { name: "bexio_delete_order_position", description: "Delete an order position.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── quotes ──
  { name: "bexio_list_quotes", description: "Retrieve quotes/offers.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_quote", description: "Retrieve a single quote by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_quote", description: "Create a quote/offer.", inputSchema: { type: "object", properties: { contactId: str("contact id"), lineItems: obj("array of { description, quantity, unit_amount, tax_rate_id }"), date: str("optional date (YYYY-MM-DD)") }, required: ["contactId", "lineItems"] } },
  { name: "bexio_update_quote", description: "Update an existing quote.", inputSchema: { type: "object", properties: { ...idProp, lineItems: obj("array of { description, quantity, unit_amount, tax_rate_id }") }, required: ["id"] } },
  { name: "bexio_delete_quote", description: "Delete a quote.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_quote_positions", description: "Retrieve quote positions.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_quote_position", description: "Retrieve a single quote position by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_quote_position", description: "Create a quote position.", inputSchema: { type: "object", properties: { quoteId: str("quote id"), description: str("description"), quantity: num("quantity"), unitAmount: num("unit amount"), taxRateId: str("optional tax rate id") }, required: ["quoteId", "description", "quantity", "unitAmount"] } },
  { name: "bexio_update_quote_position", description: "Update a quote position.", inputSchema: { type: "object", properties: { ...idProp, description: str("description"), quantity: num("quantity"), unitAmount: num("unit amount"), taxRateId: str("optional tax rate id") }, required: ["id"] } },
  { name: "bexio_delete_quote_position", description: "Delete a quote position.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── payments ──
  { name: "bexio_list_payments", description: "Retrieve payments.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_payment", description: "Retrieve a single payment by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_payment", description: "Create a payment.", inputSchema: { type: "object", properties: { invoiceId: str("invoice id"), bankAccountId: str("bank account id"), amount: num("amount"), date: str("date (YYYY-MM-DD)") }, required: ["invoiceId", "bankAccountId", "amount", "date"] } },
  { name: "bexio_update_payment", description: "Update a payment.", inputSchema: { type: "object", properties: { ...idProp, amount: num("amount"), date: str("date (YYYY-MM-DD)") }, required: ["id"] } },
  { name: "bexio_delete_payment", description: "Delete a payment.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_payment_methods", description: "Retrieve payment methods.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_payment_method", description: "Retrieve a single payment method by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_payment_method", description: "Create a payment method.", inputSchema: { type: "object", properties: { name: str("method name") }, required: ["name"] } },
  { name: "bexio_update_payment_method", description: "Update a payment method.", inputSchema: { type: "object", properties: { ...idProp, name: str("method name") }, required: ["id"] } },
  { name: "bexio_delete_payment_method", description: "Delete a payment method.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── reminders ──
  { name: "bexio_list_reminders", description: "Retrieve payment reminders.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_reminder", description: "Retrieve a single reminder by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_reminder", description: "Create a payment reminder.", inputSchema: { type: "object", properties: { invoiceId: str("invoice id"), date: str("date (YYYY-MM-DD)"), message: str("optional message") }, required: ["invoiceId", "date"] } },
  { name: "bexio_update_reminder", description: "Update a payment reminder.", inputSchema: { type: "object", properties: { ...idProp, date: str("date (YYYY-MM-DD)"), message: str("optional message") }, required: ["id"] } },
  { name: "bexio_delete_reminder", description: "Delete a payment reminder.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_reminder_templates", description: "Retrieve reminder templates.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_reminder_template", description: "Retrieve a single reminder template by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_reminder_template", description: "Create a reminder template.", inputSchema: { type: "object", properties: { name: str("template name"), message: str("message") }, required: ["name", "message"] } },
  { name: "bexio_update_reminder_template", description: "Update a reminder template.", inputSchema: { type: "object", properties: { ...idProp, name: str("template name"), message: str("message") }, required: ["id"] } },
  { name: "bexio_delete_reminder_template", description: "Delete a reminder template.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── deliveries ──
  { name: "bexio_list_deliveries", description: "Retrieve deliveries.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_delivery", description: "Retrieve a single delivery by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_delivery", description: "Create a delivery.", inputSchema: { type: "object", properties: { orderId: str("order id"), date: str("date (YYYY-MM-DD)"), lineItems: obj("array of { description, quantity }") }, required: ["orderId", "date", "lineItems"] } },
  { name: "bexio_update_delivery", description: "Update a delivery.", inputSchema: { type: "object", properties: { ...idProp, date: str("date (YYYY-MM-DD)"), lineItems: obj("array of { description, quantity }") }, required: ["id"] } },
  { name: "bexio_delete_delivery", description: "Delete a delivery.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_delivery_positions", description: "Retrieve delivery positions.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_delivery_position", description: "Retrieve a single delivery position by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_delivery_position", description: "Create a delivery position.", inputSchema: { type: "object", properties: { deliveryId: str("delivery id"), description: str("description"), quantity: num("quantity") }, required: ["deliveryId", "description", "quantity"] } },
  { name: "bexio_update_delivery_position", description: "Update a delivery position.", inputSchema: { type: "object", properties: { ...idProp, description: str("description"), quantity: num("quantity") }, required: ["id"] } },
  { name: "bexio_delete_delivery_position", description: "Delete a delivery position.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── items ──
  { name: "bexio_list_articles", description: "Retrieve articles/items.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_article", description: "Retrieve a single article by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_article", description: "Create an article/item.", inputSchema: { type: "object", properties: { name: str("article name"), code: str("optional article code"), description: str("optional description"), purchasePrice: num("optional purchase price"), salesPrice: num("optional sales price") }, required: ["name"] } },
  { name: "bexio_update_article", description: "Update an existing article.", inputSchema: { type: "object", properties: { ...idProp, name: str("article name"), description: str("optional description"), purchasePrice: num("optional purchase price"), salesPrice: num("optional sales price") }, required: ["id"] } },
  { name: "bexio_delete_article", description: "Delete an article.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_article_categories", description: "Retrieve article categories.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_article_category", description: "Retrieve a single article category by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_article_category", description: "Create an article category.", inputSchema: { type: "object", properties: { name: str("category name") }, required: ["name"] } },
  { name: "bexio_update_article_category", description: "Update an article category.", inputSchema: { type: "object", properties: { ...idProp, name: str("category name") }, required: ["id"] } },
  { name: "bexio_delete_article_category", description: "Delete an article category.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_article_prices", description: "Retrieve article prices.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_article_price", description: "Retrieve a single article price by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_article_price", description: "Create an article price.", inputSchema: { type: "object", properties: { articleId: str("article id"), price: num("price"), currency: str("optional currency") }, required: ["articleId", "price"] } },
  { name: "bexio_update_article_price", description: "Update an article price.", inputSchema: { type: "object", properties: { ...idProp, price: num("price"), currency: str("optional currency") }, required: ["id"] } },
  { name: "bexio_delete_article_price", description: "Delete an article price.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── reports ──
  { name: "bexio_list_reports", description: "Retrieve available reports.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_report", description: "Retrieve a single report by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_report_templates", description: "Retrieve report templates.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_report_template", description: "Retrieve a single report template by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_report_template", description: "Create a report template.", inputSchema: { type: "object", properties: { name: str("template name"), description: str("optional description") }, required: ["name"] } },
  { name: "bexio_update_report_template", description: "Update a report template.", inputSchema: { type: "object", properties: { ...idProp, name: str("template name"), description: str("optional description") }, required: ["id"] } },
  { name: "bexio_delete_report_template", description: "Delete a report template.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_report_schedules", description: "Retrieve report schedules.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_report_schedule", description: "Retrieve a single report schedule by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_report_schedule", description: "Create a report schedule.", inputSchema: { type: "object", properties: { reportTemplateId: str("report template id"), frequency: str("frequency (daily, weekly, monthly)"), recipients: obj("array of recipient emails") }, required: ["reportTemplateId", "frequency", "recipients"] } },

  // ── users ──
  { name: "bexio_list_users", description: "Retrieve users.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_user", description: "Retrieve a single user by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_user", description: "Create a user.", inputSchema: { type: "object", properties: { firstName: str("first name"), lastName: str("last name"), email: str("email") }, required: ["firstName", "lastName", "email"] } },
  { name: "bexio_update_user", description: "Update a user.", inputSchema: { type: "object", properties: { ...idProp, firstName: str("first name"), lastName: str("last name"), email: str("email") }, required: ["id"] } },
  { name: "bexio_delete_user", description: "Delete a user.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_user_roles", description: "Retrieve user roles.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_user_role", description: "Retrieve a single user role by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_user_role", description: "Create a user role.", inputSchema: { type: "object", properties: { name: str("role name") }, required: ["name"] } },
  { name: "bexio_update_user_role", description: "Update a user role.", inputSchema: { type: "object", properties: { ...idProp, name: str("role name") }, required: ["id"] } },
  { name: "bexio_delete_user_role", description: "Delete a user role.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── misc ──
  { name: "bexio_list_communication_kinds", description: "Retrieve communication kinds.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_communication_kind", description: "Retrieve a single communication kind by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_communication_kind", description: "Create a communication kind.", inputSchema: { type: "object", properties: { name: str("kind name") }, required: ["name"] } },
  { name: "bexio_update_communication_kind", description: "Update a communication kind.", inputSchema: { type: "object", properties: { ...idProp, name: str("kind name") }, required: ["id"] } },
  { name: "bexio_delete_communication_kind", description: "Delete a communication kind.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_tags", description: "Retrieve tags.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_tag", description: "Retrieve a single tag by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_tag", description: "Create a tag.", inputSchema: { type: "object", properties: { name: str("tag name") }, required: ["name"] } },
  { name: "bexio_update_tag", description: "Update a tag.", inputSchema: { type: "object", properties: { ...idProp, name: str("tag name") }, required: ["id"] } },
  { name: "bexio_delete_tag", description: "Delete a tag.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── notes ──
  { name: "bexio_list_notes", description: "Retrieve notes.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_note", description: "Retrieve a single note by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_note", description: "Create a note on a contact.", inputSchema: { type: "object", properties: { contactId: str("contact id"), content: str("note content") }, required: ["contactId", "content"] } },
  { name: "bexio_update_note", description: "Update a note.", inputSchema: { type: "object", properties: { ...idProp, content: str("note content") }, required: ["id"] } },
  { name: "bexio_delete_note", description: "Delete a note.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_note_categories", description: "Retrieve note categories.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_note_category", description: "Retrieve a single note category by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_note_category", description: "Create a note category.", inputSchema: { type: "object", properties: { name: str("category name") }, required: ["name"] } },
  { name: "bexio_update_note_category", description: "Update a note category.", inputSchema: { type: "object", properties: { ...idProp, name: str("category name") }, required: ["id"] } },
  { name: "bexio_delete_note_category", description: "Delete a note category.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── tasks ──
  { name: "bexio_list_tasks", description: "Retrieve tasks.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_task", description: "Retrieve a single task by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_task", description: "Create a task.", inputSchema: { type: "object", properties: { title: str("task title"), description: str("optional description"), dueDate: str("optional due date (YYYY-MM-DD)"), contactId: str("optional contact id") }, required: ["title"] } },
  { name: "bexio_update_task", description: "Update a task.", inputSchema: { type: "object", properties: { ...idProp, title: str("task title"), description: str("optional description"), dueDate: str("optional due date (YYYY-MM-DD)") }, required: ["id"] } },
  { name: "bexio_delete_task", description: "Delete a task.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_task_categories", description: "Retrieve task categories.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_task_category", description: "Retrieve a single task category by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_task_category", description: "Create a task category.", inputSchema: { type: "object", properties: { name: str("category name") }, required: ["name"] } },
  { name: "bexio_update_task_category", description: "Update a task category.", inputSchema: { type: "object", properties: { ...idProp, name: str("category name") }, required: ["id"] } },
  { name: "bexio_delete_task_category", description: "Delete a task category.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── stock ──
  { name: "bexio_list_stock", description: "Retrieve stock entries.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_stock", description: "Retrieve a single stock entry by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_stock", description: "Create a stock entry.", inputSchema: { type: "object", properties: { articleId: str("article id"), quantity: num("quantity"), locationId: str("optional location id") }, required: ["articleId", "quantity"] } },
  { name: "bexio_update_stock", description: "Update a stock entry.", inputSchema: { type: "object", properties: { ...idProp, quantity: num("quantity"), locationId: str("optional location id") }, required: ["id"] } },
  { name: "bexio_delete_stock", description: "Delete a stock entry.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_stock_locations", description: "Retrieve stock locations.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_stock_location", description: "Retrieve a single stock location by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_stock_location", description: "Create a stock location.", inputSchema: { type: "object", properties: { name: str("location name") }, required: ["name"] } },
  { name: "bexio_update_stock_location", description: "Update a stock location.", inputSchema: { type: "object", properties: { ...idProp, name: str("location name") }, required: ["id"] } },
  { name: "bexio_delete_stock_location", description: "Delete a stock location.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── docs ──
  { name: "bexio_list_documents", description: "Retrieve documents.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_document", description: "Retrieve a single document by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_document", description: "Create a document.", inputSchema: { type: "object", properties: { name: str("document name"), content: str("document content"), categoryId: str("optional category id") }, required: ["name", "content"] } },
  { name: "bexio_update_document", description: "Update a document.", inputSchema: { type: "object", properties: { ...idProp, name: str("document name"), content: str("document content") }, required: ["id"] } },
  { name: "bexio_delete_document", description: "Delete a document.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_document_categories", description: "Retrieve document categories.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_document_category", description: "Retrieve a single document category by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_document_category", description: "Create a document category.", inputSchema: { type: "object", properties: { name: str("category name") }, required: ["name"] } },
  { name: "bexio_update_document_category", description: "Update a document category.", inputSchema: { type: "object", properties: { ...idProp, name: str("category name") }, required: ["id"] } },
  { name: "bexio_delete_document_category", description: "Delete a document category.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },

  // ── positions ──
  { name: "bexio_list_positions", description: "Retrieve positions (document line items).", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_position", description: "Retrieve a single position by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_position", description: "Create a position.", inputSchema: { type: "object", properties: { documentId: str("document id"), description: str("description"), quantity: num("quantity"), unitAmount: num("unit amount"), taxRateId: str("optional tax rate id") }, required: ["documentId", "description", "quantity", "unitAmount"] } },
  { name: "bexio_update_position", description: "Update a position.", inputSchema: { type: "object", properties: { ...idProp, description: str("description"), quantity: num("quantity"), unitAmount: num("unit amount"), taxRateId: str("optional tax rate id") }, required: ["id"] } },
  { name: "bexio_delete_position", description: "Delete a position.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_list_position_types", description: "Retrieve position types.", inputSchema: { type: "object", properties: listProps } },
  { name: "bexio_get_position_type", description: "Retrieve a single position type by id.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
  { name: "bexio_create_position_type", description: "Create a position type.", inputSchema: { type: "object", properties: { name: str("type name") }, required: ["name"] } },
  { name: "bexio_update_position_type", description: "Update a position type.", inputSchema: { type: "object", properties: { ...idProp, name: str("type name") }, required: ["id"] } },
  { name: "bexio_delete_position_type", description: "Delete a position type.", inputSchema: { type: "object", properties: idProp, required: ["id"] } },
];

/* ── query-string builder ───────────────────────────────────── */

function buildQuery(args: Record<string, unknown>, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null || v === "") continue;
    if (["where", "page", "order", "contactId", "status"].includes(k)) {
      params.set(k, String(v));
    }
  }
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Unwrap the primary collection from a Bexio list response. */
function unwrap<T>(body: Record<string, unknown>, key: string): T[] {
  const value = body[key];
  return Array.isArray(value) ? (value as T[]) : [];
}

/* ── handlers ───────────────────────────────────────────────── */

type Handler = (args: Record<string, unknown>, session: BexioSession, config: IntegrationConfig) => Promise<Record<string, unknown>>;

const handlers: Record<string, Handler> = {
  // ── reference ──
  bexio_list_currencies: async (a, s) => ({ currencies: unwrap(await bexioGet(`/currencies${buildQuery(a)}`, s), "data") }),
  bexio_list_taxes: async (a, s) => ({ taxes: unwrap(await bexioGet(`/tax${buildQuery(a)}`, s), "data") }),
  bexio_list_payment_types: async (a, s) => ({ paymentTypes: unwrap(await bexioGet(`/payment_type${buildQuery(a)}`, s), "data") }),
  bexio_list_account_types: async (a, s) => ({ accountTypes: unwrap(await bexioGet(`/account_type${buildQuery(a)}`, s), "data") }),
  bexio_list_document_types: async (a, s) => ({ documentTypes: unwrap(await bexioGet(`/document_type${buildQuery(a)}`, s), "data") }),
  bexio_list_salutations: async (a, s) => ({ salutations: unwrap(await bexioGet(`/salutation${buildQuery(a)}`, s), "data") }),
  bexio_list_titles: async (a, s) => ({ titles: unwrap(await bexioGet(`/title${buildQuery(a)}`, s), "data") }),
  bexio_list_languages: async (a, s) => ({ languages: unwrap(await bexioGet(`/language${buildQuery(a)}`, s), "data") }),
  bexio_list_countries: async (a, s) => ({ countries: unwrap(await bexioGet(`/country${buildQuery(a)}`, s), "data") }),
  bexio_list_time_units: async (a, s) => ({ timeUnits: unwrap(await bexioGet(`/time_unit${buildQuery(a)}`, s), "data") }),

  // ── company ──
  bexio_get_company_profile: async (_a, s) => bexioGet("/company_profile", s),
  bexio_list_company_users: async (a, s) => ({ companyUsers: unwrap(await bexioGet(`/company_user${buildQuery(a)}`, s), "data") }),
  bexio_get_company_settings: async (_a, s) => bexioGet("/company_settings", s),

  // ── banking ──
  bexio_list_bank_accounts: async (a, s) => ({ bankAccounts: unwrap(await bexioGet("/banking/accounts", s), "data") }),
  bexio_get_bank_account: async (a, s) => bexioGet(`/banking/accounts/${String(a.id)}`, s),
  bexio_list_bank_transactions: async (a, s) => ({ bankTransactions: unwrap(await bexioGet("/banking/transactions", s), "data") }),
  bexio_get_bank_transaction: async (a, s) => bexioGet(`/banking/transactions/${String(a.id)}`, s),
  bexio_list_bank_account_transactions: async (a, s) => ({ bankTransactions: unwrap(await bexioGet(`/banking/accounts/${String(a.bankAccountId)}/transactions`, s), "data") }),
  bexio_create_bank_transaction: async (a, s) => bexioPost("/banking/transactions", s, { bank_account_id: a.bankAccountId, amount: a.amount, date: a.date, description: a.description }),
  bexio_update_bank_transaction: async (a, s) => bexioPut(`/banking/transactions/${String(a.id)}`, s, { amount: a.amount, date: a.date, description: a.description }),
  bexio_delete_bank_transaction: async (a, s) => { await bexioDelete(`/banking/transactions/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_bank_account_balances: async (a, s) => ({ bankAccountBalances: unwrap(await bexioGet("/banking/account_balances", s), "data") }),
  bexio_get_bank_account_balance: async (a, s) => bexioGet(`/banking/account_balances/${String(a.id)}`, s),
  bexio_list_bank_account_statements: async (a, s) => ({ bankAccountStatements: unwrap(await bexioGet("/banking/account_statements", s), "data") }),
  bexio_get_bank_account_statement: async (a, s) => bexioGet(`/banking/account_statements/${String(a.id)}`, s),
  bexio_create_bank_account_statement: async (a, s) => bexioPost("/banking/account_statements", s, { bank_account_id: a.bankAccountId, date: a.date, balance: a.balance }),
  bexio_update_bank_account_statement: async (a, s) => bexioPut(`/banking/account_statements/${String(a.id)}`, s, { balance: a.balance }),
  bexio_delete_bank_account_statement: async (a, s) => { await bexioDelete(`/banking/account_statements/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── projects ──
  bexio_list_projects: async (a, s) => ({ projects: unwrap(await bexioGet(`/pr_project${buildQuery(a)}`, s), "data") }),
  bexio_get_project: async (a, s) => bexioGet(`/pr_project/${String(a.id)}`, s),
  bexio_create_project: async (a, s) => bexioPost("/pr_project", s, { name: a.name, project_type_id: a.projectTypeId, project_state_id: a.projectStateId, description: a.description }),
  bexio_update_project: async (a, s) => bexioPut(`/pr_project/${String(a.id)}`, s, { name: a.name, description: a.description, project_state_id: a.projectStateId }),
  bexio_delete_project: async (a, s) => { await bexioDelete(`/pr_project/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_project_types: async (a, s) => ({ projectTypes: unwrap(await bexioGet(`/pr_project_type${buildQuery(a)}`, s), "data") }),
  bexio_get_project_type: async (a, s) => bexioGet(`/pr_project_type/${String(a.id)}`, s),
  bexio_list_project_states: async (a, s) => ({ projectStates: unwrap(await bexioGet(`/pr_project_state${buildQuery(a)}`, s), "data") }),
  bexio_get_project_state: async (a, s) => bexioGet(`/pr_project_state/${String(a.id)}`, s),
  bexio_list_project_tasks: async (a, s) => ({ projectTasks: unwrap(await bexioGet(`/pr_project/${String(a.projectId)}/task`, s), "data") }),
  bexio_get_project_task: async (a, s) => bexioGet(`/pr_project_task/${String(a.id)}`, s),
  bexio_create_project_task: async (a, s) => bexioPost(`/pr_project/${String(a.projectId)}/task`, s, { title: a.title, description: a.description, due_date: a.dueDate }),
  bexio_update_project_task: async (a, s) => bexioPut(`/pr_project_task/${String(a.id)}`, s, { title: a.title, description: a.description, due_date: a.dueDate }),
  bexio_delete_project_task: async (a, s) => { await bexioDelete(`/pr_project_task/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_project_timesheets: async (a, s) => ({ projectTimesheets: unwrap(await bexioGet(`/pr_project/${String(a.projectId)}/timesheet`, s), "data") }),

  // ── timetracking ──
  bexio_list_timesheets: async (a, s) => ({ timesheets: unwrap(await bexioGet(`/timesheet${buildQuery(a)}`, s), "data") }),
  bexio_get_timesheet: async (a, s) => bexioGet(`/timesheet/${String(a.id)}`, s),
  bexio_create_timesheet: async (a, s) => bexioPost("/timesheet", s, { contact_id: a.contactId, client_service_id: a.clientServiceId, date: a.date, duration: a.duration, description: a.description }),
  bexio_update_timesheet: async (a, s) => bexioPut(`/timesheet/${String(a.id)}`, s, { duration: a.duration, description: a.description }),
  bexio_delete_timesheet: async (a, s) => { await bexioDelete(`/timesheet/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_client_services: async (a, s) => ({ clientServices: unwrap(await bexioGet(`/client_service${buildQuery(a)}`, s), "data") }),
  bexio_get_client_service: async (a, s) => bexioGet(`/client_service/${String(a.id)}`, s),
  bexio_create_client_service: async (a, s) => bexioPost("/client_service", s, { name: a.name, description: a.description, hourly_rate: a.hourlyRate }),
  bexio_update_client_service: async (a, s) => bexioPut(`/client_service/${String(a.id)}`, s, { name: a.name, description: a.description, hourly_rate: a.hourlyRate }),
  bexio_delete_client_service: async (a, s) => { await bexioDelete(`/client_service/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_time_entries: async (a, s) => ({ timeEntries: unwrap(await bexioGet(`/time_entry${buildQuery(a)}`, s), "data") }),
  bexio_get_time_entry: async (a, s) => bexioGet(`/time_entry/${String(a.id)}`, s),
  bexio_create_time_entry: async (a, s) => bexioPost("/time_entry", s, { timesheet_id: a.timesheetId, date: a.date, duration: a.duration, description: a.description }),
  bexio_update_time_entry: async (a, s) => bexioPut(`/time_entry/${String(a.id)}`, s, { duration: a.duration, description: a.description }),
  bexio_delete_time_entry: async (a, s) => { await bexioDelete(`/time_entry/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── accounting ──
  bexio_list_accounts: async (a, s) => ({ accounts: unwrap(await bexioGet(`/accounts${buildQuery(a)}`, s), "data") }),
  bexio_get_account: async (a, s) => bexioGet(`/accounts/${String(a.id)}`, s),
  bexio_list_manual_entries: async (a, s) => ({ manualEntries: unwrap(await bexioGet("/accounting/manual_entries", s), "data") }),
  bexio_get_manual_entry: async (a, s) => bexioGet(`/accounting/manual_entries/${String(a.id)}`, s),
  bexio_create_manual_entry: async (a, s) => bexioPost("/accounting/manual_entries", s, { date: a.date, lines: a.lines }),
  bexio_update_manual_entry: async (a, s) => bexioPut(`/accounting/manual_entries/${String(a.id)}`, s, { date: a.date, lines: a.lines }),
  bexio_delete_manual_entry: async (a, s) => { await bexioDelete(`/accounting/manual_entries/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_journal: async (a, s) => ({ journal: unwrap(await bexioGet("/accounting/journal", s), "data") }),
  bexio_get_journal_entry: async (a, s) => bexioGet(`/accounting/journal/${String(a.id)}`, s),
  bexio_list_account_balances: async (a, s) => ({ accountBalances: unwrap(await bexioGet("/accounting/account_balances", s), "data") }),
  bexio_get_account_balance: async (a, s) => bexioGet(`/accounting/account_balances/${String(a.id)}`, s),
  bexio_list_account_statements: async (a, s) => ({ accountStatements: unwrap(await bexioGet("/accounting/account_statements", s), "data") }),
  bexio_get_account_statement: async (a, s) => bexioGet(`/accounting/account_statements/${String(a.id)}`, s),
  bexio_create_account_statement: async (a, s) => bexioPost("/accounting/account_statements", s, { account_id: a.accountId, date: a.date, balance: a.balance }),
  bexio_update_account_statement: async (a, s) => bexioPut(`/accounting/account_statements/${String(a.id)}`, s, { balance: a.balance }),
  bexio_delete_account_statement: async (a, s) => { await bexioDelete(`/accounting/account_statements/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_account_transactions: async (a, s) => ({ accountTransactions: unwrap(await bexioGet("/accounting/account_transactions", s), "data") }),
  bexio_get_account_transaction: async (a, s) => bexioGet(`/accounting/account_transactions/${String(a.id)}`, s),
  bexio_create_account_transaction: async (a, s) => bexioPost("/accounting/account_transactions", s, { account_id: a.accountId, amount: a.amount, date: a.date, description: a.description }),
  bexio_delete_account_transaction: async (a, s) => { await bexioDelete(`/accounting/account_transactions/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── purchase ──
  bexio_list_bills: async (a, s) => ({ bills: unwrap(await requestVersioned("4.0", "GET", "purchase/bills", s, a), "data") }),
  bexio_get_bill: async (a, s) => requestVersioned("4.0", "GET", `purchase/bills/${String(a.id)}`, s),
  bexio_create_bill: async (a, s) => requestVersioned("4.0", "POST", "purchase/bills", s, undefined, { supplier_id: a.supplierId, date: a.date, due_date: a.dueDate, positions: a.lineItems }),
  bexio_update_bill: async (a, s) => requestVersioned("4.0", "PUT", `purchase/bills/${String(a.id)}`, s, undefined, { date: a.date, due_date: a.dueDate, positions: a.lineItems }),
  bexio_delete_bill: async (a, s) => { await requestVersioned("4.0", "DELETE", `purchase/bills/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_expenses: async (a, s) => ({ expenses: unwrap(await requestVersioned("4.0", "GET", "expenses", s, a), "data") }),
  bexio_get_expense: async (a, s) => requestVersioned("4.0", "GET", `expenses/${String(a.id)}`, s),
  bexio_create_expense: async (a, s) => requestVersioned("4.0", "POST", "expenses", s, undefined, { date: a.date, amount: a.amount, description: a.description, category_id: a.categoryId }),
  bexio_update_expense: async (a, s) => requestVersioned("4.0", "PUT", `expenses/${String(a.id)}`, s, undefined, { date: a.date, amount: a.amount, description: a.description, category_id: a.categoryId }),
  bexio_delete_expense: async (a, s) => { await requestVersioned("4.0", "DELETE", `expenses/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_purchase_orders: async (a, s) => ({ purchaseOrders: unwrap(await requestVersioned("3.0", "GET", "purchase_orders", s, a), "data") }),
  bexio_get_purchase_order: async (a, s) => requestVersioned("3.0", "GET", `purchase_orders/${String(a.id)}`, s),
  bexio_create_purchase_order: async (a, s) => requestVersioned("3.0", "POST", "purchase_orders", s, undefined, { supplier_id: a.supplierId, date: a.date, positions: a.lineItems }),
  bexio_update_purchase_order: async (a, s) => requestVersioned("3.0", "PUT", `purchase_orders/${String(a.id)}`, s, undefined, { date: a.date, positions: a.lineItems }),
  bexio_delete_purchase_order: async (a, s) => { await requestVersioned("3.0", "DELETE", `purchase_orders/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_suppliers: async (a, s) => ({ suppliers: unwrap(await bexioGet(`/supplier${buildQuery(a)}`, s), "data") }),
  bexio_get_supplier: async (a, s) => bexioGet(`/supplier/${String(a.id)}`, s),
  bexio_create_supplier: async (a, s) => bexioPost("/supplier", s, { name: a.name, email: a.email, phone: a.phone }),
  bexio_update_supplier: async (a, s) => bexioPut(`/supplier/${String(a.id)}`, s, { name: a.name, email: a.email, phone: a.phone }),
  bexio_delete_supplier: async (a, s) => { await bexioDelete(`/supplier/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── files ──
  bexio_list_files: async (a, s) => ({ files: unwrap(await bexioGet("/files", s), "data") }),
  bexio_get_file: async (a, s) => bexioGet(`/files/${String(a.id)}`, s),
  bexio_create_file: async (a, s) => bexioPost("/files", s, { name: a.name, content: a.content, category_id: a.categoryId }),
  bexio_update_file: async (a, s) => bexioPut(`/files/${String(a.id)}`, s, { name: a.name, content: a.content }),
  bexio_delete_file: async (a, s) => { await bexioDelete(`/files/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_file_categories: async (a, s) => ({ fileCategories: unwrap(await bexioGet("/file_categories", s), "data") }),
  bexio_get_file_category: async (a, s) => bexioGet(`/file_categories/${String(a.id)}`, s),
  bexio_create_file_category: async (a, s) => bexioPost("/file_categories", s, { name: a.name }),
  bexio_update_file_category: async (a, s) => bexioPut(`/file_categories/${String(a.id)}`, s, { name: a.name }),
  bexio_delete_file_category: async (a, s) => { await bexioDelete(`/file_categories/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── payroll ──
  bexio_list_payroll_runs: async (a, s) => ({ payrollRuns: unwrap(await bexioGet("/payroll/runs", s), "data") }),
  bexio_get_payroll_run: async (a, s) => bexioGet(`/payroll/runs/${String(a.id)}`, s),
  bexio_create_payroll_run: async (a, s) => bexioPost("/payroll/runs", s, { date: a.date, description: a.description }),
  bexio_update_payroll_run: async (a, s) => bexioPut(`/payroll/runs/${String(a.id)}`, s, { date: a.date, description: a.description }),
  bexio_delete_payroll_run: async (a, s) => { await bexioDelete(`/payroll/runs/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_payroll_items: async (a, s) => ({ payrollItems: unwrap(await bexioGet("/payroll/items", s), "data") }),
  bexio_get_payroll_item: async (a, s) => bexioGet(`/payroll/items/${String(a.id)}`, s),
  bexio_create_payroll_item: async (a, s) => bexioPost("/payroll/items", s, { payroll_run_id: a.payrollRunId, description: a.description, amount: a.amount }),
  bexio_update_payroll_item: async (a, s) => bexioPut(`/payroll/items/${String(a.id)}`, s, { description: a.description, amount: a.amount }),
  bexio_delete_payroll_item: async (a, s) => { await bexioDelete(`/payroll/items/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── contacts ──
  bexio_list_contacts: async (a, s) => ({ contacts: unwrap(await bexioGet(`/contact${buildQuery(a)}`, s), "data") }),
  bexio_get_contact: async (a, s) => bexioGet(`/contact/${String(a.id)}`, s),
  bexio_create_contact: async (a, s) => bexioPost("/contact", s, { name: a.name, email: a.email, phone: a.phone, type: a.type }),
  bexio_update_contact: async (a, s) => bexioPut(`/contact/${String(a.id)}`, s, { name: a.name, email: a.email, phone: a.phone }),
  bexio_delete_contact: async (a, s) => { await bexioDelete(`/contact/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_contact_groups: async (a, s) => ({ contactGroups: unwrap(await bexioGet(`/contact_group${buildQuery(a)}`, s), "data") }),
  bexio_get_contact_group: async (a, s) => bexioGet(`/contact_group/${String(a.id)}`, s),
  bexio_create_contact_group: async (a, s) => bexioPost("/contact_group", s, { name: a.name }),
  bexio_update_contact_group: async (a, s) => bexioPut(`/contact_group/${String(a.id)}`, s, { name: a.name }),
  bexio_delete_contact_group: async (a, s) => { await bexioDelete(`/contact_group/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_contact_addresses: async (a, s) => ({ contactAddresses: unwrap(await bexioGet(`/contact_address${buildQuery(a)}`, s), "data") }),
  bexio_get_contact_address: async (a, s) => bexioGet(`/contact_address/${String(a.id)}`, s),
  bexio_create_contact_address: async (a, s) => bexioPost("/contact_address", s, { contact_id: a.contactId, street: a.street, city: a.city, zip: a.zip, country: a.country }),
  bexio_update_contact_address: async (a, s) => bexioPut(`/contact_address/${String(a.id)}`, s, { street: a.street, city: a.city, zip: a.zip, country: a.country }),
  bexio_delete_contact_address: async (a, s) => { await bexioDelete(`/contact_address/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── invoices ──
  bexio_list_invoices: async (a, s) => ({ invoices: unwrap(await bexioGet(`/kb_invoice${buildQuery(a)}`, s), "data") }),
  bexio_get_invoice: async (a, s) => bexioGet(`/kb_invoice/${String(a.id)}`, s),
  bexio_create_invoice: async (a, s) => bexioPost("/kb_invoice", s, { contact_id: a.contactId, date: a.date, due_date: a.dueDate, reference: a.reference, positions: a.lineItems }),
  bexio_update_invoice: async (a, s) => bexioPut(`/kb_invoice/${String(a.id)}`, s, { positions: a.lineItems, due_date: a.dueDate }),
  bexio_delete_invoice: async (a, s) => { await bexioDelete(`/kb_invoice/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_invoice_payments: async (a, s) => ({ invoicePayments: unwrap(await bexioGet(`/kb_invoice/${String(a.invoiceId)}/payment`, s), "data") }),
  bexio_get_invoice_payment: async (a, s) => bexioGet(`/kb_invoice_payment/${String(a.id)}`, s),
  bexio_create_invoice_payment: async (a, s) => bexioPost(`/kb_invoice/${String(a.invoiceId)}/payment`, s, { bank_account_id: a.bankAccountId, amount: a.amount, date: a.date }),
  bexio_update_invoice_payment: async (a, s) => bexioPut(`/kb_invoice_payment/${String(a.id)}`, s, { amount: a.amount, date: a.date }),
  bexio_delete_invoice_payment: async (a, s) => { await bexioDelete(`/kb_invoice_payment/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_invoice_positions: async (a, s) => ({ invoicePositions: unwrap(await bexioGet(`/kb_invoice/${String(a.invoiceId)}/position`, s), "data") }),
  bexio_get_invoice_position: async (a, s) => bexioGet(`/kb_invoice_position/${String(a.id)}`, s),
  bexio_create_invoice_position: async (a, s) => bexioPost(`/kb_invoice/${String(a.invoiceId)}/position`, s, { description: a.description, quantity: a.quantity, unit_amount: a.unitAmount, tax_rate_id: a.taxRateId }),
  bexio_update_invoice_position: async (a, s) => bexioPut(`/kb_invoice_position/${String(a.id)}`, s, { description: a.description, quantity: a.quantity, unit_amount: a.unitAmount, tax_rate_id: a.taxRateId }),
  bexio_delete_invoice_position: async (a, s) => { await bexioDelete(`/kb_invoice_position/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── orders ──
  bexio_list_orders: async (a, s) => ({ orders: unwrap(await bexioGet(`/kb_order${buildQuery(a)}`, s), "data") }),
  bexio_get_order: async (a, s) => bexioGet(`/kb_order/${String(a.id)}`, s),
  bexio_create_order: async (a, s) => bexioPost("/kb_order", s, { contact_id: a.contactId, date: a.date, positions: a.lineItems }),
  bexio_update_order: async (a, s) => bexioPut(`/kb_order/${String(a.id)}`, s, { positions: a.lineItems }),
  bexio_delete_order: async (a, s) => { await bexioDelete(`/kb_order/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_order_positions: async (a, s) => ({ orderPositions: unwrap(await bexioGet(`/kb_order/${String(a.orderId)}/position`, s), "data") }),
  bexio_get_order_position: async (a, s) => bexioGet(`/kb_order_position/${String(a.id)}`, s),
  bexio_create_order_position: async (a, s) => bexioPost(`/kb_order/${String(a.orderId)}/position`, s, { description: a.description, quantity: a.quantity, unit_amount: a.unitAmount, tax_rate_id: a.taxRateId }),
  bexio_update_order_position: async (a, s) => bexioPut(`/kb_order_position/${String(a.id)}`, s, { description: a.description, quantity: a.quantity, unit_amount: a.unitAmount, tax_rate_id: a.taxRateId }),
  bexio_delete_order_position: async (a, s) => { await bexioDelete(`/kb_order_position/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── quotes ──
  bexio_list_quotes: async (a, s) => ({ quotes: unwrap(await bexioGet(`/kb_offer${buildQuery(a)}`, s), "data") }),
  bexio_get_quote: async (a, s) => bexioGet(`/kb_offer/${String(a.id)}`, s),
  bexio_create_quote: async (a, s) => bexioPost("/kb_offer", s, { contact_id: a.contactId, date: a.date, positions: a.lineItems }),
  bexio_update_quote: async (a, s) => bexioPut(`/kb_offer/${String(a.id)}`, s, { positions: a.lineItems }),
  bexio_delete_quote: async (a, s) => { await bexioDelete(`/kb_offer/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_quote_positions: async (a, s) => ({ quotePositions: unwrap(await bexioGet(`/kb_offer/${String(a.quoteId)}/position`, s), "data") }),
  bexio_get_quote_position: async (a, s) => bexioGet(`/kb_offer_position/${String(a.id)}`, s),
  bexio_create_quote_position: async (a, s) => bexioPost(`/kb_offer/${String(a.quoteId)}/position`, s, { description: a.description, quantity: a.quantity, unit_amount: a.unitAmount, tax_rate_id: a.taxRateId }),
  bexio_update_quote_position: async (a, s) => bexioPut(`/kb_offer_position/${String(a.id)}`, s, { description: a.description, quantity: a.quantity, unit_amount: a.unitAmount, tax_rate_id: a.taxRateId }),
  bexio_delete_quote_position: async (a, s) => { await bexioDelete(`/kb_offer_position/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── payments ──
  bexio_list_payments: async (a, s) => ({ payments: unwrap(await bexioGet(`/payment${buildQuery(a)}`, s), "data") }),
  bexio_get_payment: async (a, s) => bexioGet(`/payment/${String(a.id)}`, s),
  bexio_create_payment: async (a, s) => bexioPost("/payment", s, { invoice_id: a.invoiceId, bank_account_id: a.bankAccountId, amount: a.amount, date: a.date }),
  bexio_update_payment: async (a, s) => bexioPut(`/payment/${String(a.id)}`, s, { amount: a.amount, date: a.date }),
  bexio_delete_payment: async (a, s) => { await bexioDelete(`/payment/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_payment_methods: async (a, s) => ({ paymentMethods: unwrap(await bexioGet(`/payment_method${buildQuery(a)}`, s), "data") }),
  bexio_get_payment_method: async (a, s) => bexioGet(`/payment_method/${String(a.id)}`, s),
  bexio_create_payment_method: async (a, s) => bexioPost("/payment_method", s, { name: a.name }),
  bexio_update_payment_method: async (a, s) => bexioPut(`/payment_method/${String(a.id)}`, s, { name: a.name }),
  bexio_delete_payment_method: async (a, s) => { await bexioDelete(`/payment_method/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── reminders ──
  bexio_list_reminders: async (a, s) => ({ reminders: unwrap(await bexioGet(`/reminder${buildQuery(a)}`, s), "data") }),
  bexio_get_reminder: async (a, s) => bexioGet(`/reminder/${String(a.id)}`, s),
  bexio_create_reminder: async (a, s) => bexioPost("/reminder", s, { invoice_id: a.invoiceId, date: a.date, message: a.message }),
  bexio_update_reminder: async (a, s) => bexioPut(`/reminder/${String(a.id)}`, s, { date: a.date, message: a.message }),
  bexio_delete_reminder: async (a, s) => { await bexioDelete(`/reminder/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_reminder_templates: async (a, s) => ({ reminderTemplates: unwrap(await bexioGet(`/reminder_template${buildQuery(a)}`, s), "data") }),
  bexio_get_reminder_template: async (a, s) => bexioGet(`/reminder_template/${String(a.id)}`, s),
  bexio_create_reminder_template: async (a, s) => bexioPost("/reminder_template", s, { name: a.name, message: a.message }),
  bexio_update_reminder_template: async (a, s) => bexioPut(`/reminder_template/${String(a.id)}`, s, { name: a.name, message: a.message }),
  bexio_delete_reminder_template: async (a, s) => { await bexioDelete(`/reminder_template/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── deliveries ──
  bexio_list_deliveries: async (a, s) => ({ deliveries: unwrap(await bexioGet(`/delivery${buildQuery(a)}`, s), "data") }),
  bexio_get_delivery: async (a, s) => bexioGet(`/delivery/${String(a.id)}`, s),
  bexio_create_delivery: async (a, s) => bexioPost("/delivery", s, { order_id: a.orderId, date: a.date, positions: a.lineItems }),
  bexio_update_delivery: async (a, s) => bexioPut(`/delivery/${String(a.id)}`, s, { date: a.date, positions: a.lineItems }),
  bexio_delete_delivery: async (a, s) => { await bexioDelete(`/delivery/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_delivery_positions: async (a, s) => ({ deliveryPositions: unwrap(await bexioGet(`/delivery/${String(a.deliveryId)}/position`, s), "data") }),
  bexio_get_delivery_position: async (a, s) => bexioGet(`/delivery_position/${String(a.id)}`, s),
  bexio_create_delivery_position: async (a, s) => bexioPost(`/delivery/${String(a.deliveryId)}/position`, s, { description: a.description, quantity: a.quantity }),
  bexio_update_delivery_position: async (a, s) => bexioPut(`/delivery_position/${String(a.id)}`, s, { description: a.description, quantity: a.quantity }),
  bexio_delete_delivery_position: async (a, s) => { await bexioDelete(`/delivery_position/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── items ──
  bexio_list_articles: async (a, s) => ({ articles: unwrap(await bexioGet(`/article${buildQuery(a)}`, s), "data") }),
  bexio_get_article: async (a, s) => bexioGet(`/article/${String(a.id)}`, s),
  bexio_create_article: async (a, s) => bexioPost("/article", s, { name: a.name, code: a.code, description: a.description, purchase_price: a.purchasePrice, sales_price: a.salesPrice }),
  bexio_update_article: async (a, s) => bexioPut(`/article/${String(a.id)}`, s, { name: a.name, description: a.description, purchase_price: a.purchasePrice, sales_price: a.salesPrice }),
  bexio_delete_article: async (a, s) => { await bexioDelete(`/article/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_article_categories: async (a, s) => ({ articleCategories: unwrap(await bexioGet(`/article_category${buildQuery(a)}`, s), "data") }),
  bexio_get_article_category: async (a, s) => bexioGet(`/article_category/${String(a.id)}`, s),
  bexio_create_article_category: async (a, s) => bexioPost("/article_category", s, { name: a.name }),
  bexio_update_article_category: async (a, s) => bexioPut(`/article_category/${String(a.id)}`, s, { name: a.name }),
  bexio_delete_article_category: async (a, s) => { await bexioDelete(`/article_category/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_article_prices: async (a, s) => ({ articlePrices: unwrap(await bexioGet(`/article_price${buildQuery(a)}`, s), "data") }),
  bexio_get_article_price: async (a, s) => bexioGet(`/article_price/${String(a.id)}`, s),
  bexio_create_article_price: async (a, s) => bexioPost("/article_price", s, { article_id: a.articleId, price: a.price, currency: a.currency }),
  bexio_update_article_price: async (a, s) => bexioPut(`/article_price/${String(a.id)}`, s, { price: a.price, currency: a.currency }),
  bexio_delete_article_price: async (a, s) => { await bexioDelete(`/article_price/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── reports ──
  bexio_list_reports: async (a, s) => ({ reports: unwrap(await bexioGet(`/report${buildQuery(a)}`, s), "data") }),
  bexio_get_report: async (a, s) => bexioGet(`/report/${String(a.id)}`, s),
  bexio_list_report_templates: async (a, s) => ({ reportTemplates: unwrap(await bexioGet(`/report_template${buildQuery(a)}`, s), "data") }),
  bexio_get_report_template: async (a, s) => bexioGet(`/report_template/${String(a.id)}`, s),
  bexio_create_report_template: async (a, s) => bexioPost("/report_template", s, { name: a.name, description: a.description }),
  bexio_update_report_template: async (a, s) => bexioPut(`/report_template/${String(a.id)}`, s, { name: a.name, description: a.description }),
  bexio_delete_report_template: async (a, s) => { await bexioDelete(`/report_template/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_report_schedules: async (a, s) => ({ reportSchedules: unwrap(await bexioGet(`/report_schedule${buildQuery(a)}`, s), "data") }),
  bexio_get_report_schedule: async (a, s) => bexioGet(`/report_schedule/${String(a.id)}`, s),
  bexio_create_report_schedule: async (a, s) => bexioPost("/report_schedule", s, { report_template_id: a.reportTemplateId, frequency: a.frequency, recipients: a.recipients }),

  // ── users ──
  bexio_list_users: async (a, s) => ({ users: unwrap(await bexioGet("/users", s), "data") }),
  bexio_get_user: async (a, s) => bexioGet(`/users/${String(a.id)}`, s),
  bexio_create_user: async (a, s) => bexioPost("/users", s, { first_name: a.firstName, last_name: a.lastName, email: a.email }),
  bexio_update_user: async (a, s) => bexioPut(`/users/${String(a.id)}`, s, { first_name: a.firstName, last_name: a.lastName, email: a.email }),
  bexio_delete_user: async (a, s) => { await bexioDelete(`/users/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_user_roles: async (a, s) => ({ userRoles: unwrap(await bexioGet(`/user_role${buildQuery(a)}`, s), "data") }),
  bexio_get_user_role: async (a, s) => bexioGet(`/user_role/${String(a.id)}`, s),
  bexio_create_user_role: async (a, s) => bexioPost("/user_role", s, { name: a.name }),
  bexio_update_user_role: async (a, s) => bexioPut(`/user_role/${String(a.id)}`, s, { name: a.name }),
  bexio_delete_user_role: async (a, s) => { await bexioDelete(`/user_role/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── misc ──
  bexio_list_communication_kinds: async (a, s) => ({ communicationKinds: unwrap(await bexioGet(`/communication_kind${buildQuery(a)}`, s), "data") }),
  bexio_get_communication_kind: async (a, s) => bexioGet(`/communication_kind/${String(a.id)}`, s),
  bexio_create_communication_kind: async (a, s) => bexioPost("/communication_kind", s, { name: a.name }),
  bexio_update_communication_kind: async (a, s) => bexioPut(`/communication_kind/${String(a.id)}`, s, { name: a.name }),
  bexio_delete_communication_kind: async (a, s) => { await bexioDelete(`/communication_kind/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_tags: async (a, s) => ({ tags: unwrap(await bexioGet(`/tag${buildQuery(a)}`, s), "data") }),
  bexio_get_tag: async (a, s) => bexioGet(`/tag/${String(a.id)}`, s),
  bexio_create_tag: async (a, s) => bexioPost("/tag", s, { name: a.name }),
  bexio_update_tag: async (a, s) => bexioPut(`/tag/${String(a.id)}`, s, { name: a.name }),
  bexio_delete_tag: async (a, s) => { await bexioDelete(`/tag/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── notes ──
  bexio_list_notes: async (a, s) => ({ notes: unwrap(await bexioGet(`/note${buildQuery(a)}`, s), "data") }),
  bexio_get_note: async (a, s) => bexioGet(`/note/${String(a.id)}`, s),
  bexio_create_note: async (a, s) => bexioPost(`/contact/${String(a.contactId)}/note`, s, { content: a.content }),
  bexio_update_note: async (a, s) => bexioPut(`/note/${String(a.id)}`, s, { content: a.content }),
  bexio_delete_note: async (a, s) => { await bexioDelete(`/note/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_note_categories: async (a, s) => ({ noteCategories: unwrap(await bexioGet(`/note_category${buildQuery(a)}`, s), "data") }),
  bexio_get_note_category: async (a, s) => bexioGet(`/note_category/${String(a.id)}`, s),
  bexio_create_note_category: async (a, s) => bexioPost("/note_category", s, { name: a.name }),
  bexio_update_note_category: async (a, s) => bexioPut(`/note_category/${String(a.id)}`, s, { name: a.name }),
  bexio_delete_note_category: async (a, s) => { await bexioDelete(`/note_category/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── tasks ──
  bexio_list_tasks: async (a, s) => ({ tasks: unwrap(await bexioGet(`/task${buildQuery(a)}`, s), "data") }),
  bexio_get_task: async (a, s) => bexioGet(`/task/${String(a.id)}`, s),
  bexio_create_task: async (a, s) => bexioPost("/task", s, { title: a.title, description: a.description, due_date: a.dueDate, contact_id: a.contactId }),
  bexio_update_task: async (a, s) => bexioPut(`/task/${String(a.id)}`, s, { title: a.title, description: a.description, due_date: a.dueDate }),
  bexio_delete_task: async (a, s) => { await bexioDelete(`/task/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_task_categories: async (a, s) => ({ taskCategories: unwrap(await bexioGet(`/task_category${buildQuery(a)}`, s), "data") }),
  bexio_get_task_category: async (a, s) => bexioGet(`/task_category/${String(a.id)}`, s),
  bexio_create_task_category: async (a, s) => bexioPost("/task_category", s, { name: a.name }),
  bexio_update_task_category: async (a, s) => bexioPut(`/task_category/${String(a.id)}`, s, { name: a.name }),
  bexio_delete_task_category: async (a, s) => { await bexioDelete(`/task_category/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── stock ──
  bexio_list_stock: async (a, s) => ({ stock: unwrap(await bexioGet(`/stock${buildQuery(a)}`, s), "data") }),
  bexio_get_stock: async (a, s) => bexioGet(`/stock/${String(a.id)}`, s),
  bexio_create_stock: async (a, s) => bexioPost("/stock", s, { article_id: a.articleId, quantity: a.quantity, location_id: a.locationId }),
  bexio_update_stock: async (a, s) => bexioPut(`/stock/${String(a.id)}`, s, { quantity: a.quantity, location_id: a.locationId }),
  bexio_delete_stock: async (a, s) => { await bexioDelete(`/stock/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_stock_locations: async (a, s) => ({ stockLocations: unwrap(await bexioGet(`/stock_location${buildQuery(a)}`, s), "data") }),
  bexio_get_stock_location: async (a, s) => bexioGet(`/stock_location/${String(a.id)}`, s),
  bexio_create_stock_location: async (a, s) => bexioPost("/stock_location", s, { name: a.name }),
  bexio_update_stock_location: async (a, s) => bexioPut(`/stock_location/${String(a.id)}`, s, { name: a.name }),
  bexio_delete_stock_location: async (a, s) => { await bexioDelete(`/stock_location/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── docs ──
  bexio_list_documents: async (a, s) => ({ documents: unwrap(await bexioGet(`/document${buildQuery(a)}`, s), "data") }),
  bexio_get_document: async (a, s) => bexioGet(`/document/${String(a.id)}`, s),
  bexio_create_document: async (a, s) => bexioPost("/document", s, { name: a.name, content: a.content, category_id: a.categoryId }),
  bexio_update_document: async (a, s) => bexioPut(`/document/${String(a.id)}`, s, { name: a.name, content: a.content }),
  bexio_delete_document: async (a, s) => { await bexioDelete(`/document/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_document_categories: async (a, s) => ({ documentCategories: unwrap(await bexioGet(`/document_category${buildQuery(a)}`, s), "data") }),
  bexio_get_document_category: async (a, s) => bexioGet(`/document_category/${String(a.id)}`, s),
  bexio_create_document_category: async (a, s) => bexioPost("/document_category", s, { name: a.name }),
  bexio_update_document_category: async (a, s) => bexioPut(`/document_category/${String(a.id)}`, s, { name: a.name }),
  bexio_delete_document_category: async (a, s) => { await bexioDelete(`/document_category/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },

  // ── positions ──
  bexio_list_positions: async (a, s) => ({ positions: unwrap(await bexioGet(`/position${buildQuery(a)}`, s), "data") }),
  bexio_get_position: async (a, s) => bexioGet(`/position/${String(a.id)}`, s),
  bexio_create_position: async (a, s) => bexioPost("/position", s, { document_id: a.documentId, description: a.description, quantity: a.quantity, unit_amount: a.unitAmount, tax_rate_id: a.taxRateId }),
  bexio_update_position: async (a, s) => bexioPut(`/position/${String(a.id)}`, s, { description: a.description, quantity: a.quantity, unit_amount: a.unitAmount, tax_rate_id: a.taxRateId }),
  bexio_delete_position: async (a, s) => { await bexioDelete(`/position/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
  bexio_list_position_types: async (a, s) => ({ positionTypes: unwrap(await bexioGet(`/position_type${buildQuery(a)}`, s), "data") }),
  bexio_get_position_type: async (a, s) => bexioGet(`/position_type/${String(a.id)}`, s),
  bexio_create_position_type: async (a, s) => bexioPost("/position_type", s, { name: a.name }),
  bexio_update_position_type: async (a, s) => bexioPut(`/position_type/${String(a.id)}`, s, { name: a.name }),
  bexio_delete_position_type: async (a, s) => { await bexioDelete(`/position_type/${String(a.id)}`, s); return { deleted: true, id: String(a.id) }; },
};

/* ── dispatcher ─────────────────────────────────────────────── */

/**
 * Invoke one Bexio MCP tool. Reads the connector configuration, authenticates
 * and dispatches to the handler. A missing credential yields a structured
 * `configured: false` result rather than an error.
 */
export async function callBexioTool(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const config = await getBexioConfig();
  try {
    const session = await getBexioSession(config);
    const handler = handlers[name];
    if (!handler) throw new Error(`Unknown Bexio tool: ${name}`);
    return await handler(args ?? {}, session, config);
  } catch (err) {
    if (err instanceof BexioNotConfiguredError) {
      return { configured: false, note: err.message };
    }
    throw err;
  }
}
