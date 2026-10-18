import Link from "next/link";

const modules = [
  ["accounts", "Accounts", "Companies, introducers, and partners"],
  ["contacts", "Contacts", "People and company relationships"],
  ["leads", "Leads", "Prospects and pipeline stages"],
  ["tasks", "Tasks", "Assigned desk actions and due dates"],
  ["appointments", "Appointments", "Client meetings and consultations"],
  ["invoices", "Invoices", "Finance ledger and payment state"],
  ["documents", "Documents", "Case evidence and review state"],
  ["tickets", "Tickets", "Service queue and resolution work"],
  ["reports", "Reports", "Live operational totals"],
] as const;

export const metadata = { title: "CRM · Citizen Lane" };

export default function CrmHubPage() {
  return <main className="mx-auto max-w-7xl space-y-8 p-6">
    <header><p className="text-sm font-medium text-primary">Citizen Lane Operations</p><h1 className="text-3xl font-semibold tracking-tight">CRM workspace</h1><p className="mt-2 max-w-2xl text-muted-foreground">A data-backed operational surface for the seeded CRM records.</p></header>
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {modules.map(([slug, title, description]) => <Link key={slug} href={`/crm/${slug}`} className="rounded-lg border bg-card p-5 transition-colors hover:border-primary hover:bg-accent/40"><h2 className="font-semibold">{title}</h2><p className="mt-2 text-sm text-muted-foreground">{description}</p><span className="mt-4 inline-block text-sm font-medium text-primary">Open {title} →</span></Link>)}
    </section>
  </main>;
}
