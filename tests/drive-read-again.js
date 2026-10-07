// "Read again" on a score re-reads its saved photos into the same score,
// keeping its title and settings; the old music stays saved until the new
// reading is done. Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const db = await import("/db.js");
await sleep(500);
document.querySelector("#library-empty .try-sample").click();
await waitFor(() => document.querySelectorAll("#pages img").length === 3 && !$("recognise").disabled, 30000, "sample pages");
$("recognise").click();
await waitFor(() => !$("practice").hidden, 900000, "read");
const r = { button: !$("read-again").hidden && !$("read-again").disabled };
$("title").value = "Renamed"; $("title").dispatchEvent(new Event("change"));
$("tempo").value = 120; $("tempo").dispatchEvent(new Event("change"));
await sleep(500);
const [before] = await db.all();
$("read-again").click();
await waitFor(() => !$("scan").hidden, 5000, "scan screen");
r.during = { name: $("scan-name").value, pages: document.querySelectorAll("#pages img").length };
const mid = await db.all();
r.midSaved = mid.length === 1 && mid[0].pages.every(Boolean) && !mid[0].pending;
await shot(false);
await waitFor(() => !$("practice").hidden, 900000, "read again");
await sleep(500);
const after = await db.all();
r.after = { count: after.length, sameId: after[0].id === before.id, title: after[0].title, tempo: after[0].tempo, pending: after[0].pending, pages: after[0].pages.filter(Boolean).length, shownTitle: $("title").value, shownTempo: $("tempo").value };
$("settings").click();
await sleep(500);
$("delete").scrollIntoView({ block: "center" });
await sleep(300);
await shot(false);
window.result = r;
