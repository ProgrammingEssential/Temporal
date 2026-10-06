# Juniper Salon: last-minute openings

When a client cancels, Lena or Carla enters the opening once. The system then texts matching waitlist clients **one at a time**, earliest on the list first, and holds the opening for each person in turn. If someone says no or doesn't answer, it moves on to the next person by itself, so only one person can ever get the spot.

Built on Temporal: every opening is one durable process that waits, retries failed texts, and carries on after a crash or restart. **Texts are simulated** (shown on a pretend phone on the page). Clients are made-up samples.

## Run it (one command)

Prerequisites: Node.js 20+ and Docker Desktop (running).

```bash
npm install && npm run dev
```

- Staff screen + pretend client phone: http://localhost:3000
- Temporal Web UI (every step of every opening): http://localhost:8233

**Stop:** press Ctrl+C, then `npm run stop` (stops the Temporal server container).

## Try it in 3 clicks

1. On http://localhost:3000, pick a stylist, a time later today and a length, then click **Start filling it**. The first matching client is texted (see the phone on the right) and holds the opening for 15 minutes (1 hour if the opening is tomorrow or later).
2. Click **Simulate: no reply (skip the wait)**, so you don't have to wait 15 minutes. The offer moves to the next client by itself.
3. On the phone, choose that client and click **Reply YES**. The opening is booked, a confirmation text appears, and they come off the waitlist. Now choose the first client and reply YES: they're told it's no longer available.

The staff screen also has **Give it to them by hand**, **Take off** (for the person holding the offer) and **Stop filling**. Sample number 555-0199 always fails to text (retried once, then skipped); 555-0142 fails once and the retry works.

## Tests and simulation

```bash
npm test           # 5 tests on Temporal's time-skipping test server (no Docker needed)
npm run typecheck
npm run simulate   # plays 4 openings with the real rules; 15-minute and 1-hour waits pass in seconds
```

Output of `npm run simulate` (every line comes from the process's own state or a reply result):

```text

Simulated clock: Tue 6 Oct, 8:30 am. Waitlist: 9 sample clients.

=== sim-1-lena-today-2pm: Lena, Tue 6 Oct, 2:00 pm, 60 min ===
  Ava Brooks is texted and holds the offer for 15 min
  Ava Brooks: no reply - timed out
  Ben Carter is texted and holds the offer for 15 min
    reply NO -> declined: Ben Carter said no and stays on the list.
  Ben Carter: said no
  Chloe Diaz: text failed twice - skipped
  Dev Patel is texted and holds the offer for 15 min
    reply YES -> booked: Dev Patel got the opening.
    reply YES -> no longer available: Ava Brooks replied too late and was told it's no longer available.
  Dev Patel: said yes - booked
  Ava Brooks later said yes after their turn - told no longer available
  Not offered: Emma Fox (Color needs 180 min; this opening is 60 min); Hana Ito (Wants Sample stylist C only); Iris Lowe (Only available Saturdays); Jon Moss (Color needs 180 min; this opening is 60 min)
  ! For Lena and Carla: Text to Chloe Diaz (555-0199) didn't go through after a retry. Moved on to the next person.
  ! For Lena and Carla: Booked Dev Patel for haircut with Lena on Tue 6 Oct, 2:00 pm. Confirmation text sent. Lena's chair is filled.
  RESULT: filled. Booked: Dev Patel (Haircut) with Lena on Tue 6 Oct, 2:00 pm.

=== sim-2-lena-tomorrow-10am: Lena, Wed 7 Oct, 10:00 am, 180 min ===
  Ben Carter is texted and holds the offer for 60 min
  Ben Carter: no reply - timed out
  Chloe Diaz: text failed twice - skipped
  Emma Fox is texted and holds the offer for 60 min
    reply YES -> booked: Emma Fox got the opening.
  Emma Fox: said yes - booked
  Not offered: Ava Brooks (Not available in the morning (afternoon / evening)); Hana Ito (Wants Sample stylist C only); Iris Lowe (Only available Saturdays)
  ! For Lena and Carla: Text to Chloe Diaz (555-0199) didn't go through after a retry. Moved on to the next person.
  ! For Lena and Carla: Booked Emma Fox for color with Lena on Wed 7 Oct, 10:00 am. Confirmation text sent. Lena's chair is filled.
  RESULT: filled. Booked: Emma Fox (Color) with Lena on Wed 7 Oct, 10:00 am.

=== sim-3-stylist-c-today-5pm: Sample stylist C, Tue 6 Oct, 5:00 pm, 45 min ===
  Ben Carter is texted and holds the offer for 15 min
    reply STOP -> opted out: Ben Carter replied STOP and was taken off the list. No more texts.
  Ben Carter: said STOP - off the list
  Chloe Diaz: text failed twice - skipped
  Hana Ito is texted and holds the offer for 15 min
  Hana Ito: no reply - timed out
  Not offered: Ava Brooks (Wants Lena only); Grace Kim (Blowout needs 60 min; this opening is 45 min); Iris Lowe (Blowout needs 60 min; this opening is 45 min); Jon Moss (Color needs 180 min; this opening is 45 min)
  ! For Lena and Carla: Text to Chloe Diaz (555-0199) didn't go through after a retry. Moved on to the next person.
  ! For Lena and Carla: Couldn't be filled: opening with Sample stylist C on Tue 6 Oct, 5:00 pm. Everyone who matches has been asked.
  RESULT: not filled. Everyone who matches has been asked.

=== sim-4-stylist-b-today-11am: Sample stylist B, Tue 6 Oct, 11:00 am, 60 min ===
  Chloe Diaz: text failed twice - skipped
  Grace Kim is texted and holds the offer for 15 min
  Staff give the opening to Iris Lowe by hand
  Grace Kim: offer ended - booked by staff
  Not offered: Ava Brooks (Wants Lena only); Hana Ito (Wants Sample stylist C only); Iris Lowe (Only available Saturdays); Jon Moss (Color needs 180 min; this opening is 60 min)
  ! For Lena and Carla: Text to Chloe Diaz (555-0199) didn't go through after a retry. Moved on to the next person.
  ! For Lena and Carla: Booked Iris Lowe for blowout with Sample stylist B on Tue 6 Oct, 11:00 am (by staff). Confirmation text sent. Sample stylist B's chair is filled.
  RESULT: filled. Booked: Iris Lowe (Blowout) with Sample stylist B on Tue 6 Oct, 11:00 am.

Waitlist now: 5 clients (booked clients and STOP replies are off the list).
Simulated texts written: 12 (none really sent).
```

## How it works

| Lena's rule | Where |
|---|---|
| One process per opening; one client holds it at a time; waits 15 min same-day / 1 hour for later (durable timer) | `src/workflows.ts` |
| Earliest on the waitlist first; service must fit the gap (haircut 45, blowout 60, color 180 min); preferred stylist required unless flexible; availability must fit | `src/salon.ts` |
| Client replies YES / NO / STOP are a Temporal Update: the answer is *booked*, *declined*, *no longer available* or *opted out* | `clientReply` in `src/workflows.ts` |
| Staff stop / take off / book by hand are Signals | `src/workflows.ts`, buttons in `public/` |
| Texts and waitlist changes are Activities; a failed text is retried once, then the next person is texted | `src/activities.ts` |
| The live waitlist is re-read before every offer, so a client booked elsewhere or who said STOP isn't texted | `loadWaitlist` |

Full requirement trace: [REQUIREMENTS.md](REQUIREMENTS.md). Chat transcript: [docs/customer-chat.md](docs/customer-chat.md). Web UI screenshot: [evidence/](evidence/).

## What's simulated or not included

- **Simulated:** text messages (written to `data/texts.json` and shown on the pretend phone; a texting service such as Twilio would send them). The waitlist is a sample file standing in for the Google Sheet.
- **Not connected:** Square (staff type the opening in) and the stylists' calendars (the staff screen says when a chair is filled).
- **Samples, to replace with the salon's own:** clients, stylist names other than Lena, the wording of availability. Opening hours and stylist schedules weren't available, so the prototype doesn't use them.
- **Not included (Lena: "leave out" for the first version):** online booking, deposits, no-show fees, reports.

Temporal keeps the process reliable: it waits, retries, resumes after a crash, and keeps one record of who was offered what. It does not send texts or store the client list; a texting service and the salon's booking system would do that.
