// Salon facts and matching rules. Pure functions only: safe to import from Workflow code.
// Facts from the chat: services and lengths (R10, R13, R39), five stylists including Lena (R11).
// Stylist names other than Lena were not given in the chat, so they are labelled samples (R21).
import type { Client, DaysOk, LiveClient, OpeningInput, Service, SkipRow, TimeOfDay } from "./types";

export const SALON = "Juniper Salon";

/** R13 + R39: haircut ~45 min, blowout ~1 hour, color counted as 3 hours so a gap is never too short. */
export const SERVICE_MINUTES: Record<Service, number> = { Haircut: 45, Blowout: 60, Color: 180 };

/** R11: five stylists including Lena. The other four names are samples: replace with yours. */
export const STYLISTS = ["Lena", "Sample stylist B", "Sample stylist C", "Sample stylist D", "Sample stylist E"];

export const WAIT_SAME_DAY_MS = 15 * 60_000; // R15
export const WAIT_LATER_MS = 60 * 60_000; // R40

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Shift a UTC instant into the salon's local wall-clock time (read it back with getUTC* methods). */
function local(ms: number, tzOffsetMinutes: number): Date {
  return new Date(ms + tzOffsetMinutes * 60_000);
}

export function fmtWhen(ms: number, tzOffsetMinutes: number): string {
  const d = local(ms, tzOffsetMinutes);
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${DAY[d.getUTCDay()]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}, ${hh}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

export function fmtTime(ms: number, tzOffsetMinutes: number): string {
  return fmtWhen(ms, tzOffsetMinutes).split(", ")[1];
}

export function isSameDay(aMs: number, bMs: number, tzOffsetMinutes: number): boolean {
  const a = local(aMs, tzOffsetMinutes);
  const b = local(bMs, tzOffsetMinutes);
  return a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth() && a.getUTCDate() === b.getUTCDate();
}

/** R15 + R40: 15 minutes for a same-day opening, 1 hour for tomorrow or later. */
export function holdMs(nowMs: number, input: OpeningInput): number {
  return isSameDay(nowMs, input.startMs, input.tzOffsetMinutes) ? input.waitSameDayMs : input.waitLaterMs;
}

export function timeOfDay(ms: number, tzOffsetMinutes: number): TimeOfDay {
  const h = local(ms, tzOffsetMinutes).getUTCHours();
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}

function dayFits(days: DaysOk, ms: number, tzOffsetMinutes: number): boolean {
  const wd = local(ms, tzOffsetMinutes).getUTCDay();
  if (days === "weekdays") return wd >= 1 && wd <= 5;
  if (days === "Saturdays") return wd === 6;
  return true;
}

export function availabilityText(c: Client): string {
  return `${c.days}, ${c.times.join(" / ")}`;
}

/**
 * Why a client can't be offered this opening, or null if they fit.
 * R3: service, timing and stylist preference. R14: the opening must be long enough. R37: preferred stylist required
 * unless flexible. One booking per client: someone holding another opening is not offered a second one at once.
 */
export function skipReason(c: LiveClient, input: OpeningInput): string | null {
  const need = SERVICE_MINUTES[c.service];
  if (need > input.lengthMinutes) return `${c.service} needs ${need} min; this opening is ${input.lengthMinutes} min`;
  if (c.preferredStylist && c.preferredStylist !== input.stylist && !c.flexible)
    return `Wants ${c.preferredStylist} only`;
  if (!dayFits(c.days, input.startMs, input.tzOffsetMinutes)) return `Only available ${c.days}`;
  const tod = timeOfDay(input.startMs, input.tzOffsetMinutes);
  if (!c.times.includes(tod)) return `Not available in the ${tod} (${c.times.join(" / ")})`;
  if (c.heldByOpening && c.heldByOpening !== input.openingId) return "Currently holding another opening";
  return null;
}

/** R7: earliest on the waitlist first, among those who fit. Returns who fits (in order) and why the rest don't. */
export function matchWaitlist(waitlist: LiveClient[], input: OpeningInput): { fits: LiveClient[]; skipped: SkipRow[] } {
  const ordered = [...waitlist].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
  const fits: LiveClient[] = [];
  const skipped: SkipRow[] = [];
  for (const c of ordered) {
    const reason = skipReason(c, input);
    if (reason) skipped.push({ clientId: c.id, name: c.name, reason });
    else fits.push(c);
  }
  return { fits, skipped };
}

/** R38: service and appointment time only. No prices, nothing beyond what identifies the opening. */
export function offerText(service: Service, input: OpeningInput, holdUntilMs: number): string {
  return `${SALON}: an opening for your ${service.toLowerCase()} on ${fmtWhen(input.startMs, input.tzOffsetMinutes)}. Reply YES to take it or NO to pass (held for you until ${fmtTime(holdUntilMs, input.tzOffsetMinutes)}). Reply STOP for no more texts.`;
}

export function confirmationText(service: Service, input: OpeningInput): string {
  return `${SALON}: you're booked for your ${service.toLowerCase()} on ${fmtWhen(input.startMs, input.tzOffsetMinutes)}. See you then!`;
}

export function noLongerAvailableText(): string {
  return `${SALON}: sorry, that opening is no longer available. You're still on our list.`;
}
