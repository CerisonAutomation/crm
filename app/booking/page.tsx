import Link from "next/link";
import { BookingWorkspace } from "@/components/booking/booking-workspace";

export const metadata = {
  title: "Book a consultation · Citizen Lane",
  description: "Request a private Citizen Lane consultation.",
};

export default function BookingPage() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header className="max-w-2xl">
        <Link href="/dashboard" className="text-sm font-medium text-primary">← Dashboard</Link>
        <p className="mt-6 text-sm font-medium text-primary">Citizen Lane consultations</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Book time with your advisory desk</h1>
        <p className="mt-3 text-muted-foreground">Choose an available time and send a request. A relationship manager confirms the appointment before it is final.</p>
      </header>
      <BookingWorkspace />
    </main>
  );
}
