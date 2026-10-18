import { db } from "@/lib/db";

export const metadata = {
  title: "Work Queue · Citizen Lane",
  description: "RM/compliance work items — to do, in progress, blocked, done.",
};

/** A search param may arrive repeated; the first value wins. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function WorkItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const status = first(params.status);
  const priority = first(params.priority);
  const assignedTo = first(params.assignedTo);
  const limit = Math.min(Number(first(params.limit) ?? 50) || 50, 100);

  const items = await db.workItem.findMany({
    where: {
      ...(status ? { status } : undefined),
      ...(priority ? { priority } : undefined),
      ...(assignedTo ? { assigneeId: assignedTo } : undefined),
    },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    take: limit,
    include: { case: { select: { id: true, reference: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Work Queue</h1>
        <a
          href="/work-items/new"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          New Item
        </a>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="pb-2 text-left font-medium">Title</th>
              <th className="pb-2 text-left font-medium">Priority</th>
              <th className="pb-2 text-left font-medium">Status</th>
              <th className="pb-2 text-left font-medium">Case</th>
              <th className="pb-2 text-left font-medium">Assigned To</th>
              <th className="pb-2 text-right font-medium">Due</th>
            </tr>
          </thead>
          <tbody>
            {items.map((wi) => (
              <tr key={wi.id} className="border-b">
                <td className="pb-3 text-sm">{wi.title}</td>
                <td className="pb-3 text-sm">{wi.priority}</td>
                <td className="pb-3 text-sm">{wi.status}</td>
                <td className="pb-3 text-sm">
                  {wi.case ? wi.case.reference : "—"}
                </td>
                <td className="pb-3 text-sm">{wi.assigneeId ?? "—"}</td>
                <td className="pb-3 text-right text-sm">
                  {wi.dueDate ? wi.dueDate.toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length === 0 && (
        <p className="text-sm text-muted-foreground">No work items found.</p>
      )}
    </div>
  );
}
