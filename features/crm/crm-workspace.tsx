"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Check, CirclePlus, Clock3, ContactRound, ListTodo, Loader2, RefreshCw, Search, UserRound } from "lucide-react";
import { api } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { useDebouncedValue } from "@/hooks";
import { toast } from "@/hooks/use-toast";

type Contact = NonNullable<Awaited<ReturnType<typeof api.crm>>["contacts"]>[number];
type Task = NonNullable<Awaited<ReturnType<typeof api.crm>>["tasks"]>[number];
type ActivityRow = NonNullable<Awaited<ReturnType<typeof api.crm>>["activity"]>[number];

/**
 * CRM command centre: relationship context, prioritised work, and one timeline.
 * It deliberately consumes the existing tenant-scoped CRM API rather than
 * creating a second contact/case model.
 */
export function CrmWorkspace() {
  const { t } = useI18n();
  const [tab, setTab] = useState("contacts");
  const [q, setQ] = useState("");
  const dq = useDebouncedValue(q, 300);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const [c, tasksResponse, a] = await Promise.all([
        api.crm("contacts", { q: dq }),
        api.crm("tasks", { q: dq }),
        api.crm("activity", { q: dq }),
      ]);
      setContacts(c.contacts ?? []);
      setTasks(tasksResponse.tasks ?? []);
      setActivity(a.activity ?? []);
    } catch (error) {
      toast({ title: t("common.error"), description: error instanceof Error ? error.message : "Could not load the relationship desk.", variant: "destructive" });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dq, t]);

  useEffect(() => { void load(); }, [load]);

  const openTasks = useMemo(() => tasks.filter((task) => task.status === "OPEN"), [tasks]);
  const overdue = useMemo(() => openTasks.filter((task) => task.dueDate && new Date(task.dueDate).getTime() < Date.now()).length, [openTasks]);

  async function completeTask(task: Task) {
    try {
      await api.crmWrite({ kind: "task.status", taskId: task.id, status: "DONE" });
      await load(true);
      toast({ title: "Task completed", description: task.title });
    } catch (error) {
      toast({ title: t("common.error"), description: error instanceof Error ? error.message : "Could not complete task.", variant: "destructive" });
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 py-6 md:px-8 md:py-8">
      <header className="flex flex-col gap-4 border-b border-border/70 pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-gold-ink">Relationship intelligence</p>
          <h1 className="mt-2 font-editorial text-3xl text-cobble-ink md:text-4xl">Relationship desk</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">One place for customer context, today’s work, and the complete relationship timeline.</p>
        </div>
        <Button variant="outline" onClick={() => void load(true)} disabled={refreshing} className="min-h-11 self-start lg:self-auto">
          {refreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Refresh desk
        </Button>
      </header>

      <section className="mt-6 grid gap-3 sm:grid-cols-3" aria-label="Relationship desk summary">
        <Summary icon={ContactRound} label="Contacts" value={contacts.length} />
        <Summary icon={ListTodo} label="Open tasks" value={openTasks.length} tone={openTasks.length > 0 ? "gold" : "default"} />
        <Summary icon={Clock3} label="Overdue" value={overdue} tone={overdue > 0 ? "danger" : "default"} />
      </section>

      <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search people, tasks, or activity" aria-label="Search relationship desk" className="min-h-11 pl-9" />
        </div>
        <p className="flex items-center gap-2 text-xs text-muted-foreground"><CirclePlus className="h-4 w-4 text-gold-ink" aria-hidden />Create tasks from a case or customer record</p>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="contacts">People</TabsTrigger>
          <TabsTrigger value="tasks">My work <span className="ml-1 text-xs text-muted-foreground">{openTasks.length}</span></TabsTrigger>
          <TabsTrigger value="activity">Timeline</TabsTrigger>
        </TabsList>
        <TabsContent value="contacts" className="mt-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {contacts.map((contact) => <ContactCard key={contact.id} contact={contact} />)}
          </div>
          {!loading && contacts.length === 0 && <Empty title="No contacts found" body="Promote a lead or create a contact to start a relationship timeline." />}
        </TabsContent>
        <TabsContent value="tasks" className="mt-4">
          <div className="space-y-2">
            {tasks.map((task) => (
              <article key={task.id} className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0"><p className="font-medium text-cobble-ink">{task.title}</p><p className="mt-1 text-xs text-muted-foreground">{task.priority} · {task.dueDate ? new Date(task.dueDate).toLocaleDateString() : "No due date"}</p></div>
                {task.status === "OPEN" ? <Button variant="outline" className="min-h-11 shrink-0" onClick={() => void completeTask(task)}><Check className="mr-2 h-4 w-4" />Complete</Button> : <span className="text-xs font-semibold uppercase tracking-wider text-olive-ink">{task.status}</span>}
              </article>
            ))}
          </div>
          {!loading && tasks.length === 0 && <Empty title="No work queued" body="The relationship desk is clear." />}
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <div className="divide-y divide-border rounded-md border border-border bg-card">
            {activity.map((row) => <div key={row.id} className="flex gap-3 p-4"><Activity className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" aria-hidden /><div><p className="text-sm text-cobble-ink">{row.summary}</p><p className="mt-1 text-xs text-muted-foreground">{row.kind} · {new Date(row.createdAt).toLocaleString()}</p></div></div>)}
          </div>
          {!loading && activity.length === 0 && <Empty title="No activity yet" body="Calls, notes, messages, documents, and stage changes will appear here." />}
        </TabsContent>
      </Tabs>
    </main>
  );
}

function Summary({ icon: Icon, label, value, tone = "default" }: { icon: typeof Activity; label: string; value: number; tone?: "default" | "gold" | "danger" }) {
  return <div className="rounded-md border border-border bg-card p-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4 text-gold-ink" aria-hidden />{label}</div><p className={cn("mt-2 font-editorial text-2xl", tone === "danger" ? "text-coral-ink" : tone === "gold" ? "text-gold-ink" : "text-cobble-ink")}>{value}</p></div>;
}

function ContactCard({ contact }: { contact: Contact }) {
  return <article className="rounded-md border border-border bg-card p-4"><div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold-ink"><UserRound className="h-4 w-4" aria-hidden /></div><div className="min-w-0"><h2 className="truncate font-medium text-cobble-ink">{contact.name}</h2><p className="truncate text-xs text-muted-foreground">{contact.company ?? contact.email ?? "No contact detail"}</p></div></div><div className="mt-4 flex flex-wrap gap-2 text-[10px] uppercase tracking-wider text-muted-foreground"><span>{contact.source}</span><span>·</span><span>{contact.activities.length} recent events</span></div></article>;
}

function Empty({ title, body }: { title: string; body: string }) {
  return <div className="mt-4 rounded-md border border-dashed border-border px-5 py-12 text-center"><p className="font-editorial text-lg text-cobble-ink">{title}</p><p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p></div>;
}
