// Tiny JSON-file store standing in for the salon's Google Sheet and a texting service's log.
// Used by the API and by Activities only (never by Workflow code).
import fs from "node:fs";
import path from "node:path";
import { SAMPLE_WAITLIST } from "./sample-data";
import type { Client, TextMessage } from "./types";

function dir(): string {
  const d = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function read<T>(file: string, fallback: T): T {
  const p = path.join(dir(), file);
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}
function write(file: string, value: unknown): void {
  fs.writeFileSync(path.join(dir(), file), JSON.stringify(value, null, 2));
}

export const getWaitlist = (): Client[] => read("waitlist.json", SAMPLE_WAITLIST);
export const saveWaitlist = (w: Client[]): void => write("waitlist.json", w);

/** clientId -> openingId currently holding an offer for them. */
export const getHolds = (): Record<string, string> => read("holds.json", {} as Record<string, string>);
export const saveHolds = (h: Record<string, string>): void => write("holds.json", h);

export const getTexts = (): TextMessage[] => read("texts.json", [] as TextMessage[]);
export function addText(t: TextMessage): void {
  write("texts.json", [...getTexts(), t]);
}

export const getOpeningIds = (): string[] => read("openings.json", [] as string[]);
export function addOpeningId(id: string): void {
  write("openings.json", [id, ...getOpeningIds()]);
}

export function resetAll(): void {
  for (const f of ["waitlist.json", "holds.json", "texts.json", "openings.json"]) fs.rmSync(path.join(dir(), f), { force: true });
}
