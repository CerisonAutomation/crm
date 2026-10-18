"use client";

import { useEffect, useMemo, useState } from "react";
import { ApiError, get, post } from "@/lib/api-client";
import {
  formatSlotTime,
  groupSlotsByDay,
  type BookingSlotView,
} from "@/lib/booking-presentation";

type SlotResponse = { slots: BookingSlotView[] };
type BookingResponse = { ok: true; bookingId: string; startsAt: string; status: string };

export function BookingWorkspace() {
  const [slots, setSlots] = useState<BookingSlotView[]>([]);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    get<SlotResponse>("/api/bookings?days=15")
      .then((response) => {
        if (!active) return;
        setSlots(response.slots);
        setSelectedSlotId(response.slots.find((slot) => !slot.taken)?.slotId ?? null);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(reason instanceof ApiError ? reason.message : "Consultation availability could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const days = useMemo(() => groupSlotsByDay(slots), [slots]);
  const selected = slots.find((slot) => slot.slotId === selectedSlotId) ?? null;
  const canSubmit = Boolean(selected && !selected.taken && name.trim() && email.trim() && !submitting);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || !selected) return;
    setSubmitting(true);
    setError(null);
    setConfirmation(null);
    try {
      const result = await post<BookingResponse>("/api/bookings", {
        slotId: selected.slotId,
        clientName: name.trim(),
        clientEmail: email.trim(),
        note: note.trim() || undefined,
        channel: "PORTAL",
      });
      setConfirmation(`Request recorded for ${new Date(result.startsAt).toLocaleString()}. The desk will confirm it shortly.`);
      setSlots((current) => current.map((slot) => slot.slotId === selected.slotId ? { ...slot, taken: true } : slot));
      setSelectedSlotId(null);
      setNote("");
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "The consultation request could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-label="Consultation booking">
      <div className="rounded-lg border bg-card p-5 shadow-sm">
        <div className="flex items-baseline justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Choose a consultation time</h2>
            <p className="mt-1 text-sm text-muted-foreground">All times are shown in UTC. Unavailable times are retained for clarity.</p>
          </div>
          {!loading && <span className="text-sm text-muted-foreground">{slots.filter((slot) => !slot.taken).length} available</span>}
        </div>
        {loading && <p className="mt-6 text-sm text-muted-foreground" role="status">Loading availability…</p>}
        {error && !loading && <p className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{error}</p>}
        {!loading && !error && days.length === 0 && <p className="mt-6 text-sm text-muted-foreground">No consultation times are currently available. Please contact the desk.</p>}
        <div className="mt-6 space-y-5">
          {days.map((day) => (
            <fieldset key={day.key} className="border-0 p-0">
              <legend className="mb-2 text-sm font-medium">{day.label}</legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {day.slots.map((slot) => {
                  const selectedHere = selectedSlotId === slot.slotId;
                  return (
                    <button
                      key={slot.slotId}
                      type="button"
                      disabled={slot.taken}
                      aria-pressed={selectedHere}
                      onClick={() => setSelectedSlotId(slot.slotId)}
                      className={`min-h-11 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${slot.taken ? "cursor-not-allowed border-muted bg-muted text-muted-foreground line-through" : selectedHere ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:border-primary"}`}
                    >
                      {formatSlotTime(slot.startsAt)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>
      </div>
      <form className="rounded-lg border bg-card p-5 shadow-sm" onSubmit={submit}>
        <h2 className="text-lg font-semibold">Request this time</h2>
        <p className="mt-1 text-sm text-muted-foreground">{selected ? `${new Date(selected.startsAt).toLocaleString()} · ${selected.durationMin} minutes` : "Select an available time to continue."}</p>
        <label className="mt-5 block text-sm font-medium" htmlFor="booking-name">Full name</label>
        <input id="booking-name" className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
        <label className="mt-4 block text-sm font-medium" htmlFor="booking-email">Email address</label>
        <input id="booking-email" className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 text-sm" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" type="email" required />
        <label className="mt-4 block text-sm font-medium" htmlFor="booking-note">Note for the desk <span className="font-normal text-muted-foreground">(optional)</span></label>
        <textarea id="booking-note" className="mt-1 min-h-24 w-full rounded-md border bg-background px-3 py-2 text-sm" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} />
        {confirmation && <p className="mt-4 rounded-md border border-emerald-600/30 bg-emerald-600/10 p-3 text-sm text-emerald-800" role="status">{confirmation}</p>}
        <button className="mt-5 min-h-11 w-full rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50" type="submit" disabled={!canSubmit}>{submitting ? "Submitting request…" : "Request consultation"}</button>
      </form>
    </section>
  );
}
