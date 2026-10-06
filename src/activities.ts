// Activities: the only place with side effects. Texting is SIMULATED: messages are written to data/texts.json and
// shown on the pretend phone in the browser. A real version would call a texting service (e.g. Twilio) here;
// Temporal retries it. The waitlist file stands in for the salon's Google Sheet.
import { Context } from "@temporalio/activity";
import { addText, getHolds, getWaitlist, saveHolds, saveWaitlist } from "./store";
import type { LiveClient, TextMessage } from "./types";

// Sample numbers that show failure handling: 555-0199 always fails; 555-0142 fails once, then works on retry.
const ALWAYS_FAILS = new Set(["555-0199"]);
const FAILS_ONCE = new Set(["555-0142"]);

export async function sendText(message: TextMessage): Promise<void> {
  const attempt = Context.current().info.attempt;
  if (ALWAYS_FAILS.has(message.to)) throw new Error(`Text to ${message.to} did not go through (simulated)`);
  if (FAILS_ONCE.has(message.to) && attempt === 1)
    throw new Error(`Text to ${message.to} did not go through on the first try (simulated); Temporal retries it`);
  addText(message);
}

/** The live list, read before every offer, so opt-outs, removals and bookings in other openings count. */
export async function loadWaitlist(): Promise<LiveClient[]> {
  const holds = getHolds();
  return getWaitlist().map((c) => ({ ...c, heldByOpening: holds[c.id] }));
}

export async function setHold(clientId: string, openingId: string): Promise<void> {
  saveHolds({ ...getHolds(), [clientId]: openingId });
}

export async function clearHold(clientId: string, openingId: string): Promise<void> {
  const holds = getHolds();
  if (holds[clientId] === openingId) {
    delete holds[clientId];
    saveHolds(holds);
  }
}

/** R43: once someone accepts they come off the waitlist. Returns false if they were no longer on it. */
export async function bookClient(clientId: string): Promise<boolean> {
  const list = getWaitlist();
  if (!list.some((c) => c.id === clientId)) return false;
  saveWaitlist(list.filter((c) => c.id !== clientId));
  const holds = getHolds();
  delete holds[clientId];
  saveHolds(holds);
  return true;
}

/** R34 + R42: someone who replies STOP (or asks not to be texted) comes off the list. */
export async function removeFromWaitlist(clientId: string): Promise<void> {
  saveWaitlist(getWaitlist().filter((c) => c.id !== clientId));
}
