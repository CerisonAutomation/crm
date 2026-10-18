import Link from "next/link";
import { CalendarHub } from "@/components/operations/calendar-hub";

export const metadata = { title: "Calendar · Citizen Lane", description: "Subscribe to your Citizen Lane schedule." };

export default function CalendarPage() { return <main className="mx-auto max-w-4xl space-y-6 p-6"><header><Link href="/dashboard" className="text-sm font-medium text-primary">← Dashboard</Link><h1 className="mt-6 text-3xl font-semibold tracking-tight">Calendar integration</h1><p className="mt-3 text-muted-foreground">Keep confirmed consultations and case milestones in your calendar without sharing account credentials.</p></header><CalendarHub /></main>; }
