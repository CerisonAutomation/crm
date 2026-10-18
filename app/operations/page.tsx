import Link from "next/link";
import { ApprovalInbox } from "@/components/operations/approval-inbox";
import { ChannelInbox } from "@/components/operations/channel-inbox";

export const metadata = { title: "Operations · Citizen Lane", description: "Approval and communications operations." };

export default function OperationsPage() {
  return <main className="mx-auto max-w-7xl space-y-6 p-6"><header className="max-w-2xl"><Link href="/dashboard" className="text-sm font-medium text-primary">← Dashboard</Link><p className="mt-6 text-sm font-medium text-primary">Citizen Lane operations</p><h1 className="mt-2 text-3xl font-semibold tracking-tight">Decisions and communications</h1><p className="mt-3 text-muted-foreground">Review governed human tasks, then respond through the same workspace regardless of the originating channel.</p></header><ApprovalInbox /><ChannelInbox /></main>;
}
