// One Workflow per opening. It offers the opening to one matching client at a time, holds it for them, waits
// durably for a reply, and moves on by itself when nobody answers (R29), even if nobody is watching the screen (R20).
// Deterministic code only: time comes from Temporal's workflow clock (Date.now() inside a Workflow is replayed
// deterministically by the SDK), waits use condition(), and all side effects run in Activities.
import { allHandlersFinished, condition, defineQuery, defineSignal, defineUpdate, proxyActivities, setHandler } from "@temporalio/workflow";
import type * as activities from "./activities";
import { confirmationText, fmtTime, fmtWhen, holdMs, matchWaitlist, noLongerAvailableText, offerText } from "./salon";
import type { LiveClient, OfferRow, OpeningInput, OpeningStatus, ReplyInput, ReplyResult, Service, TextKind } from "./types";

// R41: retry once if a text doesn't go through, then move to the next person.
const { sendText } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: { initialInterval: "2 seconds", maximumAttempts: 2 },
});
const { loadWaitlist, setHold, clearHold, bookClient, removeFromWaitlist } = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 seconds",
  retry: { initialInterval: "1 second", maximumAttempts: 5 },
});

export const getOpeningStatus = defineQuery<OpeningStatus>("getOpeningStatus");
export const clientReply = defineUpdate<ReplyResult, [ReplyInput]>("clientReply");
// R33: staff can stop it, take someone off, or give the opening to someone by hand.
export const stopOpening = defineSignal("stopOpening");
export const takeOffOpening = defineSignal<[string]>("takeOffOpening");
export const assignByHand = defineSignal<[string]>("assignByHand");
// Demo only: end the current hold now, as if the wait ran out, so nobody has to wait 15 minutes.
export const simulateNoReply = defineSignal("simulateNoReply");

const now = (): number => Date.now(); // workflow clock (deterministic on replay)

export async function openingWorkflow(input: OpeningInput): Promise<OpeningStatus> {
  const tz = input.tzOffsetMinutes;
  const when = fmtWhen(input.startMs, tz);
  const status: OpeningStatus = {
    openingId: input.openingId,
    stylist: input.stylist,
    startMs: input.startMs,
    lengthMinutes: input.lengthMinutes,
    tzOffsetMinutes: tz,
    phase: "offering",
    message: "Checking the waitlist.",
    offers: [],
    skipped: [],
    notices: [],
  };
  let current: OfferRow | undefined; // the one client holding the offer right now
  let bookedId: string | undefined;
  let manualId: string | undefined;
  let stopRequested = false;
  let skipWait = false;
  let closed = false;
  const takenOff = new Set<string>();

  const text = (row: { clientId: string; name: string; phone: string }, kind: TextKind, body: string) =>
    sendText({ atMs: now(), openingId: input.openingId, clientId: row.clientId, name: row.name, to: row.phone, kind, body });

  setHandler(getOpeningStatus, () => status);
  setHandler(stopOpening, () => void (stopRequested = true));
  setHandler(assignByHand, (clientId) => void (manualId ??= clientId));
  setHandler(simulateNoReply, () => void (skipWait = true));
  setHandler(takeOffOpening, (clientId) => {
    takenOff.add(clientId);
    if (current?.clientId === clientId) current.outcome = "taken off by staff";
  });

  // R22: clients text back YES, NO or STOP (R42). Only the client holding the offer can book it (R29), so two
  // people can never both get it. A yes from anyone else hears "no longer available" (R19, R36).
  setHandler(clientReply, async ({ clientId, answer }): Promise<ReplyResult> => {
    const row = status.offers.find((o) => o.clientId === clientId);
    if (answer === "stop") {
      if (row && row === current) row.outcome = "said STOP - off the list";
      else if (row) row.lateReply = "replied STOP - taken off the list";
      takenOff.add(clientId);
      await removeFromWaitlist(clientId);
      return { outcome: "opted out", message: `${row?.name ?? "The client"} replied STOP and was taken off the list. No more texts.` };
    }
    if (!row || row.outcome === "texting" || row.outcome === "text failed twice - skipped")
      return { outcome: "not offered", message: "This client was not offered this opening." };
    const holding = row === current && row.outcome === "holding the offer" && !closed;
    if (holding && answer === "no") {
      row.outcome = "said no"; // R24: stays on the list
      return { outcome: "declined", message: `${row.name} said no and stays on the list.` };
    }
    if (holding && answer === "yes") {
      bookedId = clientId; // set before any await: the main loop sees it at once
      row.outcome = "said yes - booked";
      return { outcome: "booked", message: `${row.name} got the opening.` };
    }
    if (answer === "yes") {
      row.lateReply = "said yes after their turn - told no longer available";
      await text(row, "no longer available", noLongerAvailableText());
      return { outcome: "no longer available", message: `${row.name} replied too late and was told it's no longer available.` };
    }
    return { outcome: "already answered", message: `${row.name}'s turn is already over.` };
  });

  const finishedOffering = () => stopRequested || bookedId !== undefined || manualId !== undefined;
  let matchedAnyone = false;

  for (;;) {
  while (!finishedOffering()) {
    if (now() >= input.startMs) {
      status.phase = "opening time passed";
      break;
    }
    // Live list before every offer: opt-outs, staff removals and bookings in other openings all count.
    const live = await loadWaitlist();
    const asked = new Set(status.offers.map((o) => o.clientId));
    const { fits, skipped } = matchWaitlist(live.filter((c) => !asked.has(c.id) && !takenOff.has(c.id)), input);
    status.skipped = [
      ...skipped,
      ...live.filter((c) => takenOff.has(c.id) && !asked.has(c.id)).map((c) => ({ clientId: c.id, name: c.name, reason: "Taken off by staff" })),
    ];
    const next: LiveClient | undefined = fits[0];
    if (!next) break;
    matchedAnyone = true;

    if (!(await setHold(next.id, input.openingId))) continue; // just claimed by another opening: re-check the list
    const row: OfferRow = { clientId: next.id, name: next.name, phone: next.phone, service: next.service, outcome: "texting" };
    status.offers.push(row);
    status.message = `Texting ${next.name}.`;
    const offeredAt = now();
    const holdUntil = Math.min(offeredAt + holdMs(offeredAt, input), input.startMs);
    try {
      await text(row, "offer", offerText(next.service, input, holdUntil));
    } catch {
      row.outcome = "text failed twice - skipped"; // R41
      status.notices.push(`Text to ${next.name} (${next.phone}) didn't go through after a retry. Moved on to the next person.`);
      await clearHold(next.id, input.openingId);
      continue;
    }
    row.sentAtMs = offeredAt;
    row.holdUntilMs = holdUntil;
    row.outcome = "holding the offer";
    current = row;
    skipWait = false;
    status.message = `Held for ${next.name} until ${fmtTime(holdUntil, tz)}.`;

    // Durable timer: survives restarts. Ends early on a reply or a staff action.
    await condition(
      () => row.outcome !== "holding the offer" || finishedOffering() || skipWait,
      Math.max(1, holdUntil - now()),
    );
    current = undefined;
    if (row.outcome === "holding the offer") {
      row.outcome = stopRequested
        ? "offer ended - stopped by staff"
        : manualId !== undefined
          ? "offer ended - booked by staff"
          : "no reply - timed out"; // R24: stays on the list
    }
    if (bookedId !== next.id) await clearHold(next.id, input.openingId);
  }
  // One booking per client: staff can only book someone still on the list and not holding another opening.
  if (bookedId === undefined && !stopRequested && manualId !== undefined) {
    const chosen = (await loadWaitlist()).find((c) => c.id === manualId);
    if (!chosen || (chosen.heldByOpening && chosen.heldByOpening !== input.openingId)) {
      status.notices.push(`Couldn't book ${chosen?.name ?? "that client"} by hand: ${chosen ? "they're holding another opening right now" : "they're no longer on the waitlist"}. Carrying on with the list.`);
      manualId = undefined;
      continue;
    }
  }
  break;
  }

  const book = async (clientId: string, by: "client" | "staff") => {
    const live = await loadWaitlist();
    const offer = status.offers.find((o) => o.clientId === clientId);
    const client = live.find((c) => c.id === clientId);
    const who = { clientId, name: client?.name ?? offer?.name ?? clientId, phone: client?.phone ?? offer?.phone ?? "", service: (client?.service ?? offer?.service) as Service };
    await bookClient(clientId); // R43: comes off the waitlist
    status.booked = { clientId, name: who.name, service: who.service, by };
    try {
      await text(who, "confirmation", confirmationText(who.service, input)); // R44: automatic confirmation
      status.notices.push(`Booked ${who.name} for ${who.service.toLowerCase()} with ${input.stylist} on ${when}${by === "staff" ? " (by staff)" : ""}. Confirmation text sent. ${input.stylist}'s chair is filled.`);
    } catch {
      status.notices.push(`Booked ${who.name} with ${input.stylist} on ${when}, but the confirmation text didn't go through: please call them.`);
    }
    status.message = `Booked: ${who.name} (${who.service}) with ${input.stylist} on ${when}.`;
    status.phase = "filled";
  };

  if (bookedId !== undefined) await book(bookedId, "client");
  else if (manualId !== undefined) await book(manualId, "staff");
  else if (stopRequested) {
    status.phase = "stopped by staff";
    status.message = "Stopped by staff. No more texts for this opening.";
    status.notices.push(`Opening with ${input.stylist} on ${when} was stopped by staff.`);
  } else {
    if (status.phase !== "opening time passed") status.phase = "not filled";
    status.message = !matchedAnyone
      ? "No one on the waitlist matches this opening."
      : status.phase === "opening time passed"
        ? "The opening time arrived before anyone said yes."
        : "Everyone who matches has been asked.";
    status.notices.push(`Couldn't be filled: opening with ${input.stylist} on ${when}. ${status.message}`); // R45
  }
  closed = true;

  // Stay open until the appointment time so a late yes still gets a polite "no longer available" (R36).
  const untilStart = input.startMs - now();
  if (untilStart > 0) await condition(() => false, untilStart);
  await condition(allHandlersFinished);
  return status;
}
