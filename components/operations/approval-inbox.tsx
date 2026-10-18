"use client";

import { useEffect, useState } from "react";
import { ApiError, get, patch } from "@/lib/api-client";

type HumanTask = {
  id: string;
  title: string;
  description: string;
  status: "PENDING" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  priority: "LOW" | "MEDIUM" | "HIGH";
  dueDate: string | null;
  caseId: string | null;
};

export function ApprovalInbox() {
  const [tasks, setTasks] = useState<HumanTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    get<{ tasks: HumanTask[] }>("/api/human-tasks")
      .then((response) => setTasks(response.tasks.filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status))))
      .catch((reason: unknown) => setError(reason instanceof ApiError ? reason.message : "Approval tasks could not be loaded."))
      .finally(() => setLoading(false));
  }, []);

  async function setStatus(task: HumanTask, status: HumanTask["status"]) {
    setUpdating(task.id);
    setError(null);
    try {
      const response = await patch<{ task: HumanTask }>(`/api/human-tasks/${task.id}`, { status });
      setTasks((current) => status === "COMPLETED" ? current.filter((item) => item.id !== task.id) : current.map((item) => item.id === task.id ? response.task : item));
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "The approval task could not be updated.");
    } finally {
      setUpdating(null);
    }
  }

  return <section className="rounded-lg border bg-card p-5 shadow-sm"><div className="flex items-baseline justify-between gap-4"><div><p className="text-sm font-medium text-primary">Governed work</p><h2 className="text-xl font-semibold">Approval inbox</h2></div><span className="rounded-full bg-muted px-3 py-1 text-sm">{tasks.length} open</span></div>{loading && <p className="mt-6 text-sm text-muted-foreground" role="status">Loading approvals…</p>}{error && <p className="mt-5 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}<div className="mt-5 divide-y">{tasks.map((task) => <article key={task.id} className="py-4 first:pt-0"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-medium">{task.title}</h3><p className="mt-1 text-sm text-muted-foreground">{task.description || "No additional decision context was supplied."}</p><p className="mt-2 text-xs text-muted-foreground">{task.priority} priority{task.dueDate ? ` · due ${new Date(task.dueDate).toLocaleDateString()}` : ""}</p></div><div className="flex gap-2"><button type="button" disabled={updating === task.id || task.status === "IN_PROGRESS"} onClick={() => setStatus(task, "IN_PROGRESS")} className="min-h-10 rounded-md border px-3 text-sm font-medium disabled:opacity-50">Start</button><button type="button" disabled={updating === task.id} onClick={() => setStatus(task, "COMPLETED")} className="min-h-10 rounded-md bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">Approve</button></div></div></article>)}{!loading && tasks.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No approval tasks are waiting.</p>}</div></section>;
}
