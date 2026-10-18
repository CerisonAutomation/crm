/**
 * Quiet-hours evaluation — pure, dependency-free, so it can be unit-tested
 * without pulling the notification service (and its DB/push/email adapters)
 * into a test process.
 *
 * A window is "HH:MM-HH:MM". Times are evaluated in the SERVER's local clock
 * (UTC on a Vercel deployment); a per-user time zone is a future
 * refinement, so this is a best-effort gate rather than an exact local-time one.
 */
export function inQuietHours(window: string | null | undefined, now: Date = new Date()): boolean {
  if (!window || !/^\d{2}:\d{2}-\d{2}:\d{2}$/.test(window)) return false;
  const [from, to] = window.split("-");
  const [fh, fm] = from.split(":").map(Number);
  const [th, tm] = to.split(":").map(Number);
  if (![fh, fm, th, tm].every((n) => Number.isFinite(n))) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const start = fh * 60 + fm;
  const end = th * 60 + tm;
  if (start === end) return false; // zero-length window — nothing is quiet
  if (start < end) return minutes >= start && minutes < end;
  return minutes >= start || minutes < end; // window crosses midnight
}
