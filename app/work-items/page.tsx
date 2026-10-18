import { db } from "@/lib/db";

export const metadata = {
  title: "Work Queue · Citizen Lane",
  description: "RM/compliance work items — to do, in progress, blocked, done.",
};

export default async function WorkItemsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { status, priority, assignedTo, limit = "50" } = await searchParams;
  const items = await db.workItem.findMany({
    where: { ...(status ? { status } : {}), ...(priority ? { priority } : {}), ...(assignedTo ? { assignedTo } : {}) },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: Math.min(parseInt(limit as string, 10), 100),
    include: { case: { select: { id: true, reference: true, stage: true } } },
  });
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Work Queue</h1><a href="/work-items/new" className="inline-flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90">New Item</a></div>
      <div className="overflow-x-auto border rounded-md">
        <table className="w-full text-sm">
          <thead><tr className="border-b"><th className="text-left pb-2 font-medium">Title</th><th className="text-left pb-2 font-medium">Type</th><th className="text-left pb-2 font-medium">Priority</th><th className="text-left pb-2 font-medium">Status</th><th className="text-left pb-2 font-medium">Case</th><th className="text-left pb-2 font-medium">Assigned To</th><th className="text-right pb-2 font-medium">Due</th></tr></thead>
          <tbody>
            {items.map((wi) => (
              <tr key={wi.id} className="border-b hover:bg-accent/50 cursor-pointer group" onClick={() => { window.location.href = `/work-items/${wi.id}`; }}>
                <td className="pb-3 text-sm">{wi.title}</td><td className="pb-3 text-sm">{wi.type}</td><td className="pb-3 text-sm">{wi.priority}</td><td className="pb-3 text-sm">{wi.status}</td><td className="pb-3 text-sm">{wi.case ? wi.case.reference : "—"}</td><td className="pb-3 text-sm">{wi.assignedTo ?? "—"}</td><td className="pb-3 text-right text-sm">{wi.dueDate ? new Date(wi.dueDate).toLocaleDateString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length === 0 && <p className="text-muted-foreground text-sm">No work items found.</p>}
    </div>
  );
}