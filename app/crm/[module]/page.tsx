import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";

type Cell = string | number | null | undefined;
type ModuleData = { title: string; description: string; columns: string[]; rows: Array<{ id: string; cells: Cell[] }> };

const labels: Record<string, string> = { accounts: "Accounts", contacts: "Contacts", leads: "Leads", tasks: "Tasks", appointments: "Appointments", invoices: "Invoices", documents: "Documents", tickets: "Tickets", reports: "Reports" };
const date = (value: Date | null | undefined) => value ? new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(value) : "—";
const money = (cents: number, currency: string) => new Intl.NumberFormat("en", { style: "currency", currency }).format(cents / 100);

async function loadModule(module: string): Promise<ModuleData | null> {
  switch (module) {
    case "accounts": { const rows = await db.account.findMany({ orderBy: { updatedAt: "desc" }, take: 100 }); return { title: "Accounts", description: "Companies, partners, and introducers in the desk network.", columns: ["Name", "Type", "Industry", "Owner", "Updated"], rows: rows.map((row) => ({ id: row.id, cells: [row.name, row.type, row.industry, row.ownerId, date(row.updatedAt)] })) }; }
    case "contacts": { const rows = await db.contact.findMany({ include: { account: { select: { name: true } } }, orderBy: { updatedAt: "desc" }, take: 100 }); return { title: "Contacts", description: "People and company contacts linked to the CRM.", columns: ["Name", "Company", "Email", "Source", "Updated"], rows: rows.map((row) => ({ id: row.id, cells: [row.name, row.account?.name ?? row.company, row.email, row.source, date(row.updatedAt)] })) }; }
    case "leads": { const rows = await db.lead.findMany({ orderBy: { updatedAt: "desc" }, take: 100 }); return { title: "Leads", description: "Inbound opportunities and their sales progression.", columns: ["Name", "Email", "Source", "Stage", "Received"], rows: rows.map((row) => ({ id: row.id, cells: [row.name, row.email, row.source, row.stage, date(row.createdAt)] })) }; }
    case "tasks": { const rows = await db.crmTask.findMany({ orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }], take: 100 }); return { title: "Tasks", description: "Desk actions with ownership, priority, and deadlines.", columns: ["Task", "Priority", "Status", "Assignee", "Due"], rows: rows.map((row) => ({ id: row.id, cells: [row.title, row.priority, row.status, row.assigneeId, date(row.dueDate)] })) }; }
    case "appointments": { const rows = await db.meeting.findMany({ orderBy: { startedAt: "desc" }, take: 100 }); return { title: "Appointments", description: "Client consultations and internal meetings.", columns: ["Title", "Type", "Status", "Started", "Ended"], rows: rows.map((row) => ({ id: row.id, cells: [row.title, row.kind, row.status, date(row.startedAt), date(row.endedAt)] })) }; }
    case "invoices": { const rows = await db.invoice.findMany({ orderBy: { createdAt: "desc" }, take: 100 }); return { title: "Invoices", description: "Read-only finance ledger; issued invoices remain immutable.", columns: ["Number", "Title", "Amount", "Status", "Due"], rows: rows.map((row) => ({ id: row.id, cells: [row.number, row.title, money(row.amountCents, row.currency), row.status, date(row.dueAt)] })) }; }
    case "documents": { const rows = await db.document.findMany({ include: { case: { select: { reference: true } } }, orderBy: { updatedAt: "desc" }, take: 100 }); return { title: "Documents", description: "Case evidence with OCR and human-review state.", columns: ["Document", "Case", "Type", "Status", "Updated"], rows: rows.map((row) => ({ id: row.id, cells: [row.title, row.case.reference, row.type, row.status, date(row.updatedAt)] })) }; }
    case "tickets": { const rows = await db.workItem.findMany({ include: { case: { select: { reference: true } } }, orderBy: [{ priority: "asc" }, { updatedAt: "desc" }], take: 100 }); return { title: "Tickets", description: "Service issues are represented by the governed work queue until a dedicated support-ticket import is approved.", columns: ["Title", "Case", "Priority", "Status", "Due"], rows: rows.map((row) => ({ id: row.id, cells: [row.title, row.case?.reference, row.priority, row.status, date(row.dueDate)] })) }; }
    case "reports": { const [accounts, contacts, leads, tasks, invoices, cases] = await Promise.all([db.account.count(), db.contact.count(), db.lead.count(), db.crmTask.count({ where: { status: { not: "DONE" } } }), db.invoice.count({ where: { status: { not: "VOID" } } }), db.case.count()]); return { title: "Reports", description: "Live operational totals from the local CRM database.", columns: ["Metric", "Current value"], rows: [{ id: "accounts", cells: ["Accounts", accounts] }, { id: "contacts", cells: ["Contacts", contacts] }, { id: "leads", cells: ["Leads", leads] }, { id: "open-tasks", cells: ["Open tasks", tasks] }, { id: "active-invoices", cells: ["Active invoices", invoices] }, { id: "cases", cells: ["Cases", cases] }] }; }
    default: return null;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ module: string }> }) { const { module } = await params; return { title: `${labels[module] ?? "CRM"} · Citizen Lane` }; }

export default async function CrmModulePage({ params }: { params: Promise<{ module: string }> }) {
  const { module } = await params;
  const data = await loadModule(module);
  if (!data) notFound();
  return <main className="mx-auto max-w-7xl space-y-6 p-6"><header className="flex items-end justify-between gap-4"><div><Link href="/crm" className="text-sm font-medium text-primary">← CRM workspace</Link><h1 className="mt-3 text-3xl font-semibold tracking-tight">{data.title}</h1><p className="mt-2 text-muted-foreground">{data.description}</p></div><span className="rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground">{data.rows.length} shown</span></header><section className="overflow-hidden rounded-lg border bg-card"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-sm"><thead className="border-b bg-muted/50 text-muted-foreground"><tr>{data.columns.map((column) => <th key={column} className="whitespace-nowrap px-4 py-3 font-medium">{column}</th>)}</tr></thead><tbody>{data.rows.map((row) => <tr key={row.id} className="border-b last:border-0 hover:bg-accent/30">{row.cells.map((cell, index) => <td key={`${row.id}-${index}`} className="whitespace-nowrap px-4 py-3">{cell ?? "—"}</td>)}</tr>)}{data.rows.length === 0 && <tr><td colSpan={data.columns.length} className="px-4 py-10 text-center text-muted-foreground">No records yet.</td></tr>}</tbody></table></div></section></main>;
}
