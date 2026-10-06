// Shared types for Juniper Salon's opening filler. Requirement numbers (R#) refer to REQUIREMENTS.md.

export type Service = "Haircut" | "Blowout" | "Color";
export type TimeOfDay = "morning" | "afternoon" | "evening";
export type DaysOk = "any day" | "weekdays" | "Saturdays";

/** One row of the waitlist (R4): name, mobile, requested service, preferred stylist, general availability. */
export type Client = {
  id: string;
  name: string;
  phone: string;
  service: Service;
  preferredStylist: string | null; // null = any stylist
  flexible: boolean; // R37: a preferred stylist is required unless the client said they're flexible
  days: DaysOk;
  times: TimeOfDay[];
  joinedAt: string; // R7: earliest first
};

export type OpeningInput = {
  openingId: string;
  stylist: string;
  startMs: number;
  lengthMinutes: number;
  tzOffsetMinutes: number; // salon's local time offset from UTC, for wording and same-day checks
  waitSameDayMs: number; // R15: 15 minutes
  waitLaterMs: number; // R40: 1 hour
};

export type OfferOutcome =
  | "texting"
  | "holding the offer"
  | "said yes - booked"
  | "said no"
  | "no reply - timed out"
  | "text failed twice - skipped"
  | "said STOP - off the list"
  | "taken off by staff"
  | "offer ended - booked by staff"
  | "offer ended - stopped by staff";

export type OfferRow = {
  clientId: string;
  name: string;
  phone: string;
  service: Service;
  outcome: OfferOutcome;
  sentAtMs?: number;
  holdUntilMs?: number;
  lateReply?: string; // e.g. "said yes after timing out - told no longer available"
};

export type SkipRow = { clientId: string; name: string; reason: string };

export type OpeningPhase = "offering" | "filled" | "not filled" | "stopped by staff" | "opening time passed";

export type OpeningStatus = {
  openingId: string;
  stylist: string;
  startMs: number;
  lengthMinutes: number;
  tzOffsetMinutes: number;
  phase: OpeningPhase;
  message: string;
  offers: OfferRow[];
  skipped: SkipRow[];
  booked?: { clientId: string; name: string; service: Service; by: "client" | "staff" };
  notices: string[]; // for Lena and Carla (R44, R45)
};

export type ReplyAnswer = "yes" | "no" | "stop";
export type ReplyInput = { clientId: string; answer: ReplyAnswer };
export type ReplyResult = {
  outcome: "booked" | "declined" | "no longer available" | "not offered" | "already answered" | "opted out";
  message: string;
};

export type TextKind = "offer" | "confirmation" | "no longer available";
export type TextMessage = {
  atMs: number;
  openingId: string;
  clientId: string;
  name: string;
  to: string;
  kind: TextKind;
  body: string;
};

/** Live waitlist entry as the workflow sees it before each offer (one booking per client across openings). */
export type LiveClient = Client & { heldByOpening?: string };
