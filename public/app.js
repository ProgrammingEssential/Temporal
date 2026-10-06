const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const fmt = (ms) => {
  const d = new Date(ms);
  return `${DAY[d.getDay()]} ${d.getDate()} ${d.toLocaleString("en", { month: "short" })}, ${d.toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" })}`;
};
const time = (ms) => new Date(ms).toLocaleTimeString("en", { hour: "numeric", minute: "2-digit" });

const post = async (url, body) => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  return r.json();
};

const everyone = new Map(); // all clients ever seen, for the pretend phone
const myReplies = []; // replies typed on the pretend phone (shown as bubbles)
let waitlist = [];

async function loadConfig() {
  const config = await (await fetch("/api/config")).json();
  $("stylist").innerHTML = config.stylists.map((s) => `<option>${esc(s)}</option>`).join("");
  const d = new Date(Date.now() + 2 * 3600_000);
  d.setMinutes(0, 0, 0);
  $("start").value = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function renderWaitlist() {
  $("waitlist").innerHTML = waitlist
    .map(
      (c) => `<tr><td>${esc(c.joinedAt)}</td><td>${esc(c.name)}</td><td>${esc(c.phone)}</td><td>${esc(c.service)}</td>
      <td>${c.preferredStylist ? esc(c.preferredStylist) + (c.flexible ? " (flexible)" : " only") : "Any"}</td>
      <td>${esc(c.days)}, ${esc(c.times.join(" / "))}</td></tr>`,
    )
    .join("");
  const sel = $("phone-client");
  const chosen = sel.value;
  sel.innerHTML = [...everyone.values()].map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.phone)})</option>`).join("");
  if (chosen) sel.value = chosen;
}

const outcomeClass = (o) => (o === "holding the offer" ? "outcome-holding" : /failed|STOP|taken off|stopped/.test(o) ? "outcome-bad" : "");
const badgeClass = (p) => (p === "filled" ? "filled" : p === "not filled" || p === "opening time passed" ? "not-filled" : p.startsWith("stopped") ? "stopped" : "");

function renderOpening(s) {
  const open = s.phase === "offering";
  const holder = s.offers.find((o) => o.outcome === "holding the offer");
  const rows = s.offers
    .map(
      (o) => `<tr><td>${esc(o.name)}</td><td>${esc(o.service)}</td>
      <td class="${outcomeClass(o.outcome)}">${esc(o.outcome)}${o.lateReply ? `<span class="late">Then: ${esc(o.lateReply)}</span>` : ""}</td>
      <td>${o.sentAtMs ? time(o.sentAtMs) : ""}</td><td>${o.holdUntilMs ? time(o.holdUntilMs) : ""}</td>
      <td>${open && o.outcome === "holding the offer" ? `<button class="ghost" data-act="take-off" data-id="${s.openingId}" data-client="${o.clientId}">Take off</button>` : ""}</td></tr>`,
    )
    .join("");
  const assignable = waitlist.map((c) => `<option value="${c.id}">${esc(c.name)} (${esc(c.service)})</option>`).join("");
  return `<div class="card">
    <div class="opening-head">
      <h2>${esc(s.stylist)} · ${fmt(s.startMs)} · ${s.lengthMinutes} min</h2>
      <span class="badge ${badgeClass(s.phase)}">${esc(s.phase)}</span>
    </div>
    <p class="message">${esc(s.message)}</p>
    ${rows ? `<table><thead><tr><th>Contacted</th><th>Service</th><th>What happened</th><th>Texted</th><th>Held until</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : `<p class="hint">Nobody contacted yet.</p>`}
    ${s.skipped.length ? `<details data-for="${s.openingId}"><summary>Not offered (${s.skipped.length}) and why</summary><ul>${s.skipped.map((k) => `<li>${esc(k.name)}: ${esc(k.reason)}</li>`).join("")}</ul></details>` : ""}
    ${s.notices.length ? `<ul class="notices">${s.notices.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
    ${
      open || s.phase === "not filled"
        ? `<div class="actions">
        ${holder ? `<button class="ghost" data-act="simulate-no-reply" data-id="${s.openingId}">Simulate: no reply (skip the wait)</button>` : ""}
        <select data-assign-for="${s.openingId}">${assignable}</select>
        <button class="ghost" data-act="assign" data-id="${s.openingId}">Give it to them by hand</button>
        ${open ? `<button class="secondary" data-act="stop" data-id="${s.openingId}">Stop filling</button>` : ""}
      </div>`
        : ""
    }
  </div>`;
}

async function refresh() {
  try {
    waitlist = await (await fetch("/api/waitlist")).json();
    for (const c of waitlist) everyone.set(c.id, c);
    const openings = await (await fetch("/api/openings")).json();
    const texts = await (await fetch("/api/texts")).json();

    const assignChoice = {};
    document.querySelectorAll("[data-assign-for]").forEach((el) => (assignChoice[el.dataset.assignFor] = el.value));
    renderWaitlist();
    // Only redraw when something changed, so open menus and "Not offered and why" stay open.
    const openingsHtml = openings.map(renderOpening).join("");
    if ($("openings").dataset.html !== openingsHtml) {
      const openDetails = new Set([...document.querySelectorAll("details[open]")].map((d) => d.dataset.for));
      $("openings").innerHTML = openingsHtml;
      $("openings").dataset.html = openingsHtml;
      document.querySelectorAll("details").forEach((d) => openDetails.has(d.dataset.for) && (d.open = true));
    }
    document.querySelectorAll("[data-assign-for]").forEach((el) => {
      if (assignChoice[el.dataset.assignFor]) el.value = assignChoice[el.dataset.assignFor];
    });

    const who = $("phone-client").value;
    const items = [
      ...texts.filter((t) => t.clientId === who).map((t) => ({ at: t.atMs, me: false, body: t.body })),
      ...myReplies.filter((r) => r.clientId === who).map((r) => ({ at: r.at, me: true, body: r.body })),
    ].sort((a, b) => a.at - b.at);
    const box = $("messages");
    const html = items.length
      ? items.map((m) => `<div class="bubble ${m.me ? "me" : ""}">${esc(m.body)}<small>${time(m.at)}</small></div>`).join("")
      : `<p class="hint">No texts for this client yet.</p>`;
    if (box.dataset.html !== html) {
      box.innerHTML = html;
      box.dataset.html = html;
      box.scrollTop = box.scrollHeight;
    }
  } catch (e) {
    console.error(e);
  }
}

$("new-opening").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("form-error").textContent = "";
  const r = await post("/api/openings", {
    stylist: $("stylist").value,
    startMs: new Date($("start").value).getTime(),
    lengthMinutes: Number($("length").value),
    tzOffsetMinutes: -new Date().getTimezoneOffset(),
  });
  if (r.error) $("form-error").textContent = r.error;
  refresh();
});

document.addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]");
  if (!b) return;
  const body = {};
  if (b.dataset.client) body.clientId = b.dataset.client;
  if (b.dataset.act === "assign") body.clientId = document.querySelector(`[data-assign-for="${b.dataset.id}"]`).value;
  b.disabled = true;
  await post(`/api/openings/${b.dataset.id}/${b.dataset.act}`, body);
  setTimeout(refresh, 300);
});

document.querySelectorAll(".reply-buttons button").forEach((b) =>
  b.addEventListener("click", async () => {
    const clientId = $("phone-client").value;
    const answer = b.dataset.answer;
    myReplies.push({ clientId, at: Date.now(), body: answer.toUpperCase() });
    const r = await post("/api/reply", { clientId, answer });
    $("reply-result").textContent = r.message;
    refresh();
  }),
);
$("phone-client").addEventListener("change", () => {
  $("reply-result").textContent = "";
  refresh();
});
$("reset").addEventListener("click", async () => {
  await post("/api/reset");
  myReplies.length = 0;
  refresh();
});

async function poll() {
  await refresh();
  setTimeout(poll, 1500); // next poll only after this one finishes, so requests never pile up
}
loadConfig().then(poll);
