import path from "node:path";
import { Client, Connection, WorkflowNotFoundError } from "@temporalio/client";
import express, { type NextFunction, type Request, type Response } from "express";
import { SERVICE_MINUTES, STYLISTS, WAIT_LATER_MS, WAIT_SAME_DAY_MS } from "./salon";
import { addOpeningId, getOpeningIds, getTexts, getWaitlist, resetAll } from "./store";
import type { OpeningInput, OpeningStatus, ReplyAnswer, ReplyResult } from "./types";
import { assignByHand, clientReply, getOpeningStatus, openingWorkflow, simulateNoReply, stopOpening, takeOffOpening } from "./workflows";

const TASK_QUEUE = "juniper-salon";
const app = express();
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

let clientPromise: Promise<Client> | undefined;
function getClient(): Promise<Client> {
  clientPromise ??= Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  }).then((connection) => new Client({ connection, namespace: "default" }));
  return clientPromise;
}

app.get("/api/config", (_request, response) => {
  response.json({ stylists: STYLISTS, serviceMinutes: SERVICE_MINUTES, waitSameDayMs: WAIT_SAME_DAY_MS, waitLaterMs: WAIT_LATER_MS });
});

app.get("/api/waitlist", (_request, response) => {
  response.json(getWaitlist());
});

// Staff enter an opening they saw in Square (R2). One Workflow per opening.
app.post("/api/openings", async (request, response) => {
  const { stylist, startMs, lengthMinutes, tzOffsetMinutes } = request.body as Partial<OpeningInput>;
  if (!stylist || !STYLISTS.includes(stylist) || !Number.isFinite(startMs) || !Number.isFinite(lengthMinutes)) {
    response.status(400).json({ error: "Please choose a stylist, a start time and a length." });
    return;
  }
  if ((startMs as number) <= Date.now()) {
    response.status(400).json({ error: "That time has already passed." });
    return;
  }
  const openingId = `opening-${stylist.replace(/\W+/g, "-").toLowerCase()}-${new Date(startMs as number).toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${Date.now().toString(36)}`;
  const input: OpeningInput = {
    openingId,
    stylist,
    startMs: startMs as number,
    lengthMinutes: lengthMinutes as number,
    tzOffsetMinutes: Number(tzOffsetMinutes ?? 0),
    waitSameDayMs: WAIT_SAME_DAY_MS,
    waitLaterMs: WAIT_LATER_MS,
  };
  const client = await getClient();
  await client.workflow.start(openingWorkflow, { workflowId: openingId, taskQueue: TASK_QUEUE, args: [input] });
  addOpeningId(openingId);
  response.status(201).json({ openingId });
});

app.get("/api/openings", async (_request, response) => {
  const client = await getClient();
  const statuses: OpeningStatus[] = [];
  for (const id of getOpeningIds()) {
    try {
      statuses.push(await client.workflow.getHandle(id).query(getOpeningStatus));
    } catch (error) {
      if (!(error instanceof WorkflowNotFoundError)) console.error(error);
    }
  }
  response.json(statuses);
});

// Simulated phone: a client's reply goes to the opening their latest offer text was about.
app.post("/api/reply", async (request, response) => {
  const { clientId, answer } = request.body as { clientId: string; answer: ReplyAnswer };
  const lastOffer = [...getTexts()].reverse().find((t) => t.clientId === clientId && t.kind === "offer");
  if (!lastOffer) {
    response.json({ outcome: "not offered", message: "This client hasn't been sent an offer yet." } satisfies ReplyResult);
    return;
  }
  const client = await getClient();
  try {
    const result = await client.workflow.getHandle(lastOffer.openingId).executeUpdate(clientReply, { args: [{ clientId, answer }] });
    response.json(result);
  } catch {
    response.json({ outcome: "no longer available", message: "That opening has already closed." } satisfies ReplyResult);
  }
});

app.get("/api/texts", (_request, response) => {
  response.json(getTexts());
});

const staffAction = (name: string, run: (id: string, body: { clientId?: string }) => Promise<void>) =>
  app.post(`/api/openings/:id/${name}`, async (request, response) => {
    await run(String(request.params.id), request.body ?? {});
    response.status(202).json({ accepted: true });
  });
staffAction("stop", async (id) => (await getClient()).workflow.getHandle(id).signal(stopOpening));
staffAction("take-off", async (id, b) => (await getClient()).workflow.getHandle(id).signal(takeOffOpening, String(b.clientId)));
staffAction("assign", async (id, b) => (await getClient()).workflow.getHandle(id).signal(assignByHand, String(b.clientId)));
staffAction("simulate-no-reply", async (id) => (await getClient()).workflow.getHandle(id).signal(simulateNoReply));

// Demo only: put the sample waitlist back and forget openings/texts (running Workflows are left to finish).
app.post("/api/reset", (_request, response) => {
  resetAll();
  response.json({ ok: true });
});

app.use(
  (error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    console.error(error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unexpected error",
    });
  },
);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => console.log(`Juniper Salon openings are available at http://localhost:${port}`));
