# Requirements trace (Lena, Juniper Salon)

Every need, rule or problem Lena stated in the chat ([docs/customer-chat.md](docs/customer-chat.md)), turn number, and what the prototype does.
Status: **Built** / **Simulated** (works in the demo; a real outside service would replace it) / **Not included** (with reason).

| # | Lena said (her words) | Turn | What the prototype does | Where you can see it | Status |
|---|---|---|---|---|---|
| R1 | "A simple way to handle that without all the back-and-forth" | 0 | Staff enter the opening once; the system texts, waits, moves on and books by itself | Staff screen; `src/workflows.ts` | Built |
| R2 | "We notice the cancellation in Square" | 1 | Staff type the opening in (stylist, time, length); Square is not connected | New opening form | Not included (next step: read cancellations from Square) |
| R3 | "We look at the service, timing, and stylist preference" | 1 | Matching checks service length, day/time availability and preferred stylist | `src/salon.ts` `skipReason`; "Not offered and why" | Built |
| R4 | Sheet has "name, mobile number, requested service, preferred stylist, and general availability" | 1 | Waitlist has exactly these fields (plus date joined) | Waitlist table | Simulated (sample clients stand in for the Google Sheet) |
| R5 | "People get on it when they ask us to let them know about an earlier appointment" | 1 | Uses the existing list; adding people stays with staff | Waitlist table | Not included (next step: add/edit form or read the Google Sheet) |
| R6 | "Text likely matches from the salon phone" | 1 | Texts are written to a log and shown on a pretend phone | Client's phone panel | Simulated |
| R7 | "Who joined the waitlist earliest, as long as the service and availability fit" | 2 | Sorted by date joined; first who fits is offered first | `matchWaitlist`; test "matching" | Built |
| R8 | "We've been texting several people at once" | 2 | Replaced by one at a time (she chose this in turn 5, R29) | Staff screen | Built |
| R9 | "Most cancellations are inside 48 hours, around 8 to 12 a week" | 2 | Same-day and tomorrow openings handled with different waits | Simulation scenarios 1 and 2 | Built |
| R10 | "Haircuts, color, and blowouts … 30 minutes to about three hours" | 2 | These three services, with lengths from R13/R39 | `SERVICE_MINUTES` | Built |
| R11 | "Five stylists including me" | 2 | Five stylists: Lena plus four labelled samples | Stylist dropdown | Built (names other than Lena are samples) |
| R12 | "Stylists mainly need to know when their chair is filled or canceled" | 2 | Notice: "Lena's chair is filled" on the staff screen. Cancellations still reach stylists through Square as today | Staff screen notices | Simulated (calendar not connected) |
| R13 | "Haircuts … 45 minutes, blowouts about an hour, color two to three hours" | 3 | 45 / 60 / 180 minutes | `SERVICE_MINUTES` | Built |
| R14 | "A shorter opening generally isn't suitable for a longer service" | 3 | Client skipped if their service is longer than the gap; reason shown | "Not offered and why"; test "matching" | Built |
| R15 | "I'd wait about 15 minutes for a same-day opening" | 3 | 15-minute durable hold for same-day openings | Held until column; test 2 | Built |
| R16 | "No strict cutoff … depends on how late it is" | 3 | No cut-off; offers stop when the opening time arrives | `workflows.ts` | Built |
| R17 | Two yeses today: "tell one of them it's no longer available" | 3 | Only the person holding the offer can book; anyone else gets "no longer available" | Test "only one person gets the opening" | Built |
| R18 | "The front desk confirms it manually, and the stylist sees it on the calendar" | 3 | Confirmation is now automatic (R44); staff see the booking | Staff screen notice | Built |
| R19 | Biggest problem: "someone can say yes after another person has already taken the slot" | 3 | Late yes gets "no longer available" text; spot never double-booked | Phone panel; simulation 1 | Built |
| R20 | "When we're busy it's easy to forget the next follow-up" | 3 | Moves to the next person by itself when the hold runs out, even with nobody watching | Simulation 1–3; Web UI timers | Built |
| R21 | Opening hours and stylist names: "I don't have a fixed answer" | 4 | Stylist names labelled as samples; opening hours not used | Banner on the page | Not included (no data given) |
| R22 | "People usually just text back 'yes' or 'no'" | 4 | Reply YES / NO on the phone panel | Phone panel | Simulated (texts) |
| R23 | Tomorrow or later: "I'd probably give them longer" | 4 | 1 hour (pinned in R40) | Test 4 | Built |
| R24 | "If someone declines, they should stay on the list. A missed reply shouldn't remove them either." | 4 | No and no-reply stay on the waitlist | Waitlist table; test 2 | Built |
| R25 | See "who was contacted, who declined or timed out, who currently holds the offer, and whether the appointment is filled" | 4 | Opening card: contacted list with outcome, who holds it, held-until time, status badge | Staff screen | Built |
| R26 | "The people who didn't get it don't need a separate message" | 4 | No message to others (only a late yes gets a reply) | Phone panel | Built |
| R27 | Success: "filling more gaps with less chasing and fewer mix-ups" | 4 | One holder at a time, automatic follow-up, one record per opening | Slides | Built |
| R28 | "I don't have a typical appointment value worked out" | 4 | No money figures used | Slides | n/a |
| R29 | "One person at a time sounds safer if it keeps moving on its own" | 5 | One holder at a time; moves on automatically | `workflows.ts` loop | Built |
| R30 | "I don't have set quiet hours or a firm cutoff" | 5 | No quiet hours, no cut-off | — | Built (none needed) |
| R31 | "Leave out online booking, deposits, no-show fees, and reports" | 5 | Not built | README, slides | Not included (her request) |
| R32 | "No special short-notice exclusions or different client priorities" | 5 | Everyone ordered the same way (earliest first) | `matchWaitlist` | Built |
| R33 | "Carla or I should be able to stop the process, remove someone, or assign the opening manually" | 5 | Buttons: Stop filling, Take off (the person holding the offer, for this opening), Give it to them by hand (also after "couldn't be filled"). Removing someone from the whole list happens via STOP or a booking | Staff screen; tests 5 and 6 | Built |
| R34 | "If someone doesn't want texts anymore, we should take them off the list" | 5 | STOP takes them off the list, whether or not an offer is open | Phone panel; test 4 | Built |
| R35 | "The stylists work different schedules, not all five every day" | 5 | Staff enter openings for a stylist's own cancelled slot, so schedules aren't needed | — | Not included (no schedules given) |
| R36 | "That summary sounds right" (late yes told no longer available) | 6 | As R19 | Simulation 1 | Built |
| R37 | "A preferred stylist should be treated as required unless the client has said they're flexible" | 6 | Skipped with "Wants X only" unless flexible | "Not offered and why"; test "matching" | Built |
| R38 | Text includes "the service and appointment time, but not prices or anything beyond what's needed" | 6 | Offer text: service + time only | Phone panel; `offerText` | Built |
| R39 | "Use three hours for color" | 7 | Color = 180 minutes | `SERVICE_MINUTES` | Built |
| R40 | "Waiting an hour for tomorrow or later seems reasonable" | 7 | 1-hour hold for openings not today | Test 4; simulation 2 | Built |
| R41 | "Retry once if a text doesn't go through, then move to the next person" | 8 | Text activity: 2 attempts, then next person + staff notice | Web UI attempt 2; test 3 | Built (texts simulated) |
| R42 | "Replying 'STOP' should remove them from the list" | 8 | STOP removes them; no more texts | Test 4; simulation 3 | Built |
| R43 | "Once they accept, they should come off the waitlist" | 9 | Booked client removed from the list | Waitlist table; test 2 | Built |
| R44 | "They should get an automatic confirmation, and the front desk should see it too" | 9 | Confirmation text + staff notice | Phone panel; notices | Built (text simulated) |
| R45 | "If nobody accepts, Carla or I should be notified that it couldn't be filled" | 9 | "Couldn't be filled" notice on the staff screen; staff can still book by hand, and a later yes still fills it while the time is ahead | Simulation 3; test 4 | Built |
