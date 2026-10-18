export type BookingSlotView = {
  slotId: string;
  startsAt: string;
  durationMin: number;
  taken: boolean;
};

export type BookingDay = {
  key: string;
  label: string;
  slots: BookingSlotView[];
};

/**
 * Keeps API ordering while giving the booking UI stable calendar-day groups.
 * The API emits ISO timestamps, so the UTC date is deterministic regardless
 * of the viewer's browser locale.
 */
export function groupSlotsByDay(slots: BookingSlotView[]): BookingDay[] {
  const groups = new Map<string, BookingDay>();

  for (const slot of slots) {
    const parsed = new Date(slot.startsAt);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = parsed.toISOString().slice(0, 10);
    const existing = groups.get(key);
    if (existing) {
      existing.slots.push(slot);
      continue;
    }
    groups.set(key, {
      key,
      label: new Intl.DateTimeFormat("en", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(parsed),
      slots: [slot],
    });
  }

  return Array.from(groups.values());
}

export function formatSlotTime(startsAt: string): string {
  const parsed = new Date(startsAt);
  if (Number.isNaN(parsed.getTime())) return "Unavailable";
  return new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(parsed);
}
