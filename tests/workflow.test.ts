import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { DefaultLogger, Runtime, Worker } from "@temporalio/worker";

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "juniper-test-"));
Runtime.install({ logger: new DefaultLogger("ERROR") });

import * as activities from "../src/activities";
import { matchWaitlist } from "../src/salon";
import { SAMPLE_WAITLIST } from "../src/sample-data";
import { getWaitlist, resetAll } from "../src/store";
import type { OpeningInput, OpeningStatus } from "../src/types";
import { assignByHand, clientReply, getOpeningStatus, openingWorkflow, stopOpening } from "../src/workflows";

const MIN = 60_000;
const tz = 0;

// A fixed afternoon (UTC) 'days' after the current test-server time.
function afternoon(nowMs: number, days: number, hour = 14): number {
  const d = new Date(nowMs);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.getTime();
}

function opening(id: string, stylist: string, startMs: number, lengthMinutes: number): OpeningInput {
  return { openingId: id, stylist, startMs, lengthMinutes, tzOffsetMinutes: tz, waitSameDayMs: 15 * MIN, waitLaterMs: 60 * MIN };
}

/** One time-skipping environment per test (avoids hangs). Each test starts with the sample waitlist. */
async function withEnv(run: (env: TestWorkflowEnvironment) => Promise<void>): Promise<void> {
  resetAll();
  const env = await TestWorkflowEnvironment.createTimeSkipping();
  try {
    const worker = await Worker.create({ connection: env.nativeConnection, taskQueue: "test", workflowsPath: require.resolve("../src/workflows"), activities });
    await worker.runUntil(async () => {
      // Start every test at 8 am (UTC) tomorrow so results don't depend on when the tests are run.
      const real = await env.currentTimeMs();
      const morning = new Date(real);
      morning.setUTCDate(morning.getUTCDate() + 1);
      morning.setUTCHours(8, 0, 0, 0);
      await env.sleep(morning.getTime() - real);
      await run(env);
    });
  } finally {
    await env.teardown();
  }
}

async function until(h: { query: (q: typeof getOpeningStatus) => Promise<OpeningStatus> }, check: (s: OpeningStatus) => boolean): Promise<OpeningStatus> {
  for (let i = 0; i < 1200; i++) {
    const s = await h.query(getOpeningStatus);
    if (check(s)) return s;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting for state");
}
const holding = (name: string) => (s: OpeningStatus) => s.offers.some((o) => o.name === name && o.outcome === "holding the offer");

test("matching: service length, preferred stylist unless flexible, availability, earliest first", () => {
  const start = afternoon(Date.UTC(2026, 9, 5), 2); // Wed 7 Oct 2026, 2 pm
  const { fits, skipped } = matchWaitlist(SAMPLE_WAITLIST, opening("m", "Lena", start, 60));
  assert.deepEqual(fits.map((c) => c.name), ["Ava Brooks", "Ben Carter", "Chloe Diaz", "Dev Patel", "Grace Kim"]);
  const why = Object.fromEntries(skipped.map((s) => [s.name, s.reason]));
  assert.match(why["Emma Fox"], /Color needs 180 min/);
  assert.match(why["Hana Ito"], /Wants Sample stylist C only/);
  assert.match(why["Iris Lowe"], /Only available Saturdays/);
});

test("no reply moves to the next client after 15 minutes (same day); a late yes is told no longer available", async () => {
  await withEnv(async (env) => {
    const start = afternoon(await env.currentTimeMs(), 0); // 2 pm today
    const h = await env.client.workflow.start(openingWorkflow, { workflowId: "t1", taskQueue: "test", args: [opening("t1", "Lena", start, 60)] });
    await until(h, holding("Ava Brooks"));
    await env.sleep(16 * MIN); // Ava doesn't answer
    const s = await until(h, holding("Ben Carter"));
    assert.equal(s.offers[0].outcome, "no reply - timed out");
    const late = await h.executeUpdate(clientReply, { args: [{ clientId: "c1", answer: "yes" }] });
    assert.equal(late.outcome, "no longer available");
    const ben = await h.executeUpdate(clientReply, { args: [{ clientId: "c2", answer: "yes" }] });
    assert.equal(ben.outcome, "booked");
    const done = await until(h, (x) => x.phase === "filled");
    assert.equal(done.booked?.name, "Ben Carter");
    assert.ok(!getWaitlist().some((c) => c.id === "c2"), "booked client comes off the waitlist");
    assert.ok(getWaitlist().some((c) => c.id === "c1"), "timed-out client stays on the waitlist");
  });
});

test("only one person gets the opening, and a failed text is retried once then skipped", async () => {
  await withEnv(async (env) => {
    const start = afternoon(await env.currentTimeMs(), 0);
    const h = await env.client.workflow.start(openingWorkflow, { workflowId: "t2", taskQueue: "test", args: [opening("t2", "Lena", start, 60)] });
    await until(h, holding("Ava Brooks"));
    assert.equal((await h.executeUpdate(clientReply, { args: [{ clientId: "c1", answer: "no" }] })).outcome, "declined");
    await until(h, holding("Ben Carter"));
    await env.sleep(16 * MIN);
    // Chloe's number always fails: retried once, then skipped. Dev's fails once, then the retry works.
    const s = await until(h, holding("Dev Patel"));
    assert.equal(s.offers.find((o) => o.name === "Chloe Diaz")?.outcome, "text failed twice - skipped");
    assert.equal((await h.executeUpdate(clientReply, { args: [{ clientId: "c4", answer: "yes" }] })).outcome, "booked");
    assert.equal((await h.executeUpdate(clientReply, { args: [{ clientId: "c2", answer: "yes" }] })).outcome, "no longer available");
    const done = await until(h, (x) => x.phase === "filled");
    assert.equal(done.booked?.name, "Dev Patel");
    assert.equal(done.offers.filter((o) => o.outcome === "said yes - booked").length, 1);
  });
});

test("tomorrow's opening waits 1 hour per person; nobody accepts -> staff told it couldn't be filled; STOP opts out", async () => {
  await withEnv(async (env) => {
    const start = afternoon(await env.currentTimeMs(), 1, 18); // tomorrow evening, 45 min with Sample stylist C
    const h = await env.client.workflow.start(openingWorkflow, { workflowId: "t3", taskQueue: "test", args: [opening("t3", "Sample stylist C", start, 45)] });
    const first = await until(h, (s) => s.offers.some((o) => o.outcome === "holding the offer"));
    const row = first.offers.find((o) => o.outcome === "holding the offer")!;
    assert.equal((row.holdUntilMs ?? 0) - (row.sentAtMs ?? 0), 60 * MIN);
    assert.equal((await h.executeUpdate(clientReply, { args: [{ clientId: row.clientId, answer: "stop" }] })).outcome, "opted out");
    assert.ok(!getWaitlist().some((c) => c.id === row.clientId), "STOP takes them off the list");
    for (let i = 0; i < 6; i++) await env.sleep(61 * MIN);
    const done = await until(h, (s) => s.phase === "not filled");
    assert.ok(done.notices.some((n) => n.startsWith("Couldn't be filled")));
  });
});

test("staff can book someone by hand, and can stop an opening", async () => {
  await withEnv(async (env) => {
    const start = afternoon(await env.currentTimeMs(), 0);
    const h = await env.client.workflow.start(openingWorkflow, { workflowId: "t4", taskQueue: "test", args: [opening("t4", "Lena", start, 60)] });
    await until(h, holding("Ava Brooks"));
    await h.signal(assignByHand, "c6");
    const done = await until(h, (s) => s.phase === "filled");
    assert.deepEqual([done.booked?.name, done.booked?.by], ["Grace Kim", "staff"]);
    assert.equal(done.offers[0].outcome, "offer ended - booked by staff");

    const h2 = await env.client.workflow.start(openingWorkflow, { workflowId: "t5", taskQueue: "test", args: [opening("t5", "Lena", start, 60)] });
    await until(h2, (s) => s.offers.some((o) => o.outcome === "holding the offer"));
    await h2.signal(stopOpening);
    assert.equal((await until(h2, (s) => s.phase === "stopped by staff")).phase, "stopped by staff");
  });
});

test("one booking per client: a client holding one opening isn't offered or booked by hand into another", async () => {
  await withEnv(async (env) => {
    const now = await env.currentTimeMs();
    const a = await env.client.workflow.start(openingWorkflow, { workflowId: "t6a", taskQueue: "test", args: [opening("t6a", "Lena", afternoon(now, 0), 60)] });
    await until(a, holding("Ava Brooks"));
    const b = await env.client.workflow.start(openingWorkflow, { workflowId: "t6b", taskQueue: "test", args: [opening("t6b", "Lena", afternoon(now, 0, 15), 60)] });
    const s = await until(b, holding("Ben Carter"));
    assert.equal(s.skipped.find((k) => k.name === "Ava Brooks")?.reason, "Currently holding another opening");
    await b.signal(assignByHand, "c1");
    const after = await until(b, (x) => x.notices.some((n) => n.startsWith("Couldn't book Ava Brooks by hand")));
    assert.equal(after.phase, "offering");
    assert.equal((await a.executeUpdate(clientReply, { args: [{ clientId: "c1", answer: "yes" }] })).outcome, "booked");
    assert.equal((await until(a, (x) => x.phase === "filled")).booked?.name, "Ava Brooks");
  });
});
