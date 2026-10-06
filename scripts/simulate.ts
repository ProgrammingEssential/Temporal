// Plays four openings against the real Workflow code and rules (15 min same-day wait, 1 hour for tomorrow,
// service lengths, preferred stylist, earliest first), on Temporal's time-skipping test server so the waits pass
// in seconds. No Docker needed. Uses the SAMPLE waitlist; texts are simulated.
// Every line printed comes from the Workflow's own state (a query) or an update result.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { WorkflowHandle } from "@temporalio/client";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { DefaultLogger, Runtime, Worker } from "@temporalio/worker";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "juniper-sim-"));
Runtime.install({ logger: new DefaultLogger("ERROR") });

import * as activities from "../src/activities";
import { fmtWhen, matchWaitlist, WAIT_LATER_MS, WAIT_SAME_DAY_MS } from "../src/salon";
import { getTexts, getWaitlist } from "../src/store";
import type { OpeningStatus, ReplyAnswer } from "../src/types";
import { assignByHand, clientReply, getOpeningStatus, openingWorkflow } from "../src/workflows";

const MIN = 60_000;
const tz = -new Date().getTimezoneOffset();
type H = WorkflowHandle<typeof openingWorkflow>;
const log = (s: string) => console.log(s);

/** Local time on day `days` after the simulation's first morning, at hour:minute. */
const at = (day0: number, days: number, hour: number) => {
  const d = new Date(day0);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.getTime();
};

async function main(): Promise<void> {
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue: "sim", workflowsPath: require.resolve("../src/workflows"), activities });
    await worker.runUntil(async () => {
      // Start the simulated day at 8:30 tomorrow morning.
      const realNow = await env.currentTimeMs();
      const day0 = new Date(realNow);
      day0.setDate(day0.getDate() + 1);
      day0.setHours(8, 30, 0, 0);
      await env.sleep(day0.getTime() - realNow);
      log(`Simulated clock: ${fmtWhen(await env.currentTimeMs(), tz)}. Waitlist: ${getWaitlist().length} sample clients.`);

      const open = async (id: string, stylist: string, startMs: number, lengthMinutes: number): Promise<H> => {
        const h = await env.client.workflow.start(openingWorkflow, {
          workflowId: id,
          taskQueue: "sim",
          args: [{ openingId: id, stylist, startMs, lengthMinutes, tzOffsetMinutes: tz, waitSameDayMs: WAIT_SAME_DAY_MS, waitLaterMs: WAIT_LATER_MS }],
        });
        const s = await h.query(getOpeningStatus);
        log(`\n=== ${id}: ${s.stylist}, ${fmtWhen(s.startMs, tz)}, ${s.lengthMinutes} min ===`);
        return h;
      };
      const until = async (h: H, check: (s: OpeningStatus) => boolean): Promise<OpeningStatus> => {
        for (let i = 0; i < 2000; i++) {
          const s = await h.query(getOpeningStatus);
          if (check(s)) return s;
          await new Promise((r) => setTimeout(r, 20));
        }
        throw new Error("simulation got stuck: " + JSON.stringify(await h.query(getOpeningStatus)));
      };
      const holder = (s: OpeningStatus) => s.offers.find((o) => o.outcome === "holding the offer");
      /** Wait for the next client to be holding the offer; print what happened to the ones before. */
      let printed = new Set<string>();
      const nextHolder = async (h: H) => {
        const s = await until(h, (x) => !!holder(x) || x.phase !== "offering");
        for (const o of s.offers) if (o.outcome !== "holding the offer" && !printed.has(o.clientId)) {
          printed.add(o.clientId);
          log(`  ${o.name}: ${o.outcome}`);
        }
        const o = holder(s);
        if (o) log(`  ${o.name} is texted and holds the offer for ${Math.round(((o.holdUntilMs ?? 0) - (o.sentAtMs ?? 0)) / MIN)} min`);
        return o;
      };
      const reply = async (h: H, clientId: string, answer: ReplyAnswer) => {
        const r = await h.executeUpdate(clientReply, { args: [{ clientId, answer }] });
        log(`    reply ${answer.toUpperCase()} -> ${r.outcome}: ${r.message}`);
      };
      const noReply = async (h: H, waitMs: number) => {
        await env.sleep(waitMs + MIN);
      };
      const finish = async (h: H) => {
        const s = await until(h, (x) => x.phase !== "offering");
        for (const o of s.offers) if (!printed.has(o.clientId)) log(`  ${o.name}: ${o.outcome}`);
        for (const o of s.offers) if (o.lateReply) log(`  ${o.name} later ${o.lateReply}`);
        if (s.skipped.length) log(`  Not offered: ${s.skipped.map((k) => `${k.name} (${k.reason})`).join("; ")}`);
        for (const n of s.notices) log(`  ! For Lena and Carla: ${n}`);
        log(`  RESULT: ${s.phase}. ${s.message}`);
        printed = new Set();
      };

      // 1. Same-day haircut-length gap with Lena: no reply, a no, a text that fails twice, a retry that works, a yes, a late yes.
      let h = await open("sim-1-lena-today-2pm", "Lena", at(day0.getTime(), 0, 14), 60);
      let o = await nextHolder(h);
      await noReply(h, WAIT_SAME_DAY_MS);
      const timedOut = o!.clientId;
      o = await nextHolder(h);
      await reply(h, o!.clientId, "no");
      o = await nextHolder(h);
      await reply(h, o!.clientId, "yes");
      await reply(h, timedOut, "yes");
      await finish(h);

      // 2. Tomorrow, a 3-hour gap with Lena: color fits; each person gets 1 hour to answer.
      h = await open("sim-2-lena-tomorrow-10am", "Lena", at(day0.getTime(), 1, 10), 180);
      o = await nextHolder(h);
      await noReply(h, WAIT_LATER_MS);
      o = await nextHolder(h);
      await reply(h, o!.clientId, "yes");
      await finish(h);

      // 3. Same-day 45 minutes with Sample stylist C at 5 pm: a STOP, a failed text, no reply -> couldn't be filled.
      h = await open("sim-3-stylist-c-today-5pm", "Sample stylist C", at(day0.getTime(), 0, 17), 45);
      o = await nextHolder(h);
      await reply(h, o!.clientId, "stop");
      o = await nextHolder(h);
      await noReply(h, WAIT_SAME_DAY_MS);
      await finish(h);

      // 4. Same-day 3 hours with Lena at 11 am: while someone holds it, staff book another client who fits by hand.
      const start4 = at(day0.getTime(), 0, 11);
      h = await open("sim-4-lena-today-11am", "Lena", start4, 180);
      o = await nextHolder(h);
      const input4 = { openingId: "sim-4-lena-today-11am", stylist: "Lena", startMs: start4, lengthMinutes: 180, tzOffsetMinutes: tz, waitSameDayMs: WAIT_SAME_DAY_MS, waitLaterMs: WAIT_LATER_MS };
      const byHand = matchWaitlist(getWaitlist(), input4).fits.filter((c) => c.id !== o?.clientId).at(-1)!;
      log(`  Staff give the opening to ${byHand.name} by hand`);
      await h.signal(assignByHand, byHand.id);
      await finish(h);

      log(`\nWaitlist now: ${getWaitlist().length} clients (booked clients and STOP replies are off the list).`);
      log(`Simulated texts written: ${getTexts().length} (none really sent).`);
    });
  } finally {
    await env.teardown();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
