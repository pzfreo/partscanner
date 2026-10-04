// Marking your part on the music. Seeds Angelus (6 pages) and Huron (4 pages)
// from testdata; checks mark-up mode, tap cycling, playback mix (recording the
// notes Web Audio is asked to play), octave, clearing and persistence.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const shown = (el) => getComputedStyle(el).display !== "none" && !el.hidden;

const played = [];
const origOsc = AudioContext.prototype.createOscillator;
AudioContext.prototype.createOscillator = function () { const o = origOsc.call(this); played.push({ osc: o }); return o; };
const origRamp = AudioParam.prototype.linearRampToValueAtTime;
let ramps = 0;
AudioParam.prototype.linearRampToValueAtTime = function (v, t) { played[ramps++].peak = v; return origRamp.call(this, v, t); };
const resetPlayed = () => { played.length = 0; ramps = 0; };

async function seed(id, set, n, title) {
  const pages = await Promise.all([...Array(n).keys()].map((i) => fetch(`/testdata/${set}_${i}.musicxml`).then((r) => r.text())));
  const images = await Promise.all([...Array(n).keys()].map((i) => fetch(`/testdata/${set}_${i}.png`).then((r) => r.blob())));
  await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id, title, created: id === "ang" ? 2 : 1, pages, images }); tx.oncomplete = res; }; });
}
await seed("ang", "angelus", 6, "Angelus");
await seed("hur", "huron", 4, "Huron");
const open = async (title) => {
  if ($("home").hidden) { $("back").click(); await sleep(400); } else { $("new-scan").click(); history.back(); await sleep(400); }
  await waitFor(() => [...document.querySelectorAll("#library button")].find((b) => b.textContent.includes(title)), 5000, "library " + title).then((b) => b.click());
  await waitFor(() => document.querySelectorAll(".photo-list .page svg[viewBox]").length >= 4, 10000, "photos");
  await sleep(300);
};
const tap = (p, x, y) => {
  const svg = document.querySelectorAll(".photo-list svg")[p];
  svg.scrollIntoView({ block: "center" });
  const vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
  svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + (x / vb.width) * r.width, clientY: r.top + (y / vb.height) * r.height }));
};
const marks = (p) => document.querySelectorAll(".photo-list .page")[p].querySelectorAll(".mark").length;
const labels = (p) => [...document.querySelectorAll(".photo-list .page")[p].querySelectorAll(".mark-label")].map((t) => t.textContent);
const r = {};

await open("Angelus");
r.listShownWithoutMarks = shown($("auto-part")) && !shown($("marked-part"));
$("start-markup").click(); await sleep(300);
r.markupMode = { bar: shown($("markup-bar")), transportHidden: !shown(document.querySelector(".transport")), panelClosed: $("panel").hidden, hint: $("tap-hint").textContent };
tap(1, 1200, 535); await sleep(100); // page 2, system 1, second staff (T.)
r.markedOnce = $("marked-count").textContent;
tap(1, 1200, 535); await sleep(100);
r.tapAgainUnmarks = $("marked-count").textContent;
tap(1, 1200, 535); await sleep(100);
history.back(); await sleep(400); // phone back button ends mark-up
r.backEndsMarkup = !shown($("markup-bar")) && shown(document.querySelector(".transport")) && !$("practice").hidden;
r.panelNowShowsMarks = shown($("marked-part")) && !shown($("auto-part"));
// Play phase: a tap sets the start bar and leaves marks alone.
tap(1, 1200, 535); await sleep(100);
r.playTapSetsStart = $("from-bar").value;
r.marksUnchanged = $("marked-count").textContent;
$("octave").value = "-1"; $("octave").dispatchEvent(new Event("change"));
$("others").value = 25; $("others").oninput();
$("tempo").value = 150; $("tempo").oninput();
$("from-bar").value = 23; $("from-bar").onchange();
resetPlayed();
$("play").click(); await sleep(1500); $("play").click(); await sleep(300);
r.loudFreqs = played.filter((n) => n.peak > 0.2).map((n) => Math.round(n.osc.frequency.value)).slice(0, 5);
r.quietPeaks = [...new Set(played.filter((n) => n.peak <= 0.2).map((n) => +n.peak.toFixed(4)))];
resetPlayed();
$("from-bar").value = 29; $("from-bar").onchange();
$("play").click(); await sleep(1200); $("play").click(); await sleep(300);
r.unmarkedSystemLoud = played.filter((n) => n.peak > 0.2).length;

await open("Huron");
$("start-markup").click(); await sleep(300);
const cycle = [];
for (let i = 0; i < 3; i++) { tap(0, 1200, 680); await sleep(100); cycle.push(labels(0)[0] ?? (marks(0) ? "marked" : "none")); }
r.sharedStaffCycle = cycle;
tap(0, 1200, 680); await sleep(100); tap(0, 1200, 680); await sleep(100); // lower voice again
$("markup-done").click(); await sleep(400);
r.doneEndsMarkup = !shown($("markup-bar"));
await shot(false);
// Clearing needs a second tap, then the list is back and auto mixing applies.
$("settings").click(); await sleep(300);
$("clear-marks").click(); await sleep(100);
r.oneTapKeepsMarks = $("marked-count").textContent;
$("clear-marks").click(); await sleep(200);
r.clearedShowsList = shown($("auto-part"));
[...document.querySelectorAll("#lines li")].find((li) => li.querySelector(".pick span").textContent === "Alto").querySelector('input[type="radio"]').click();
$("settings").click(); await sleep(300);
resetPlayed();
$("from-bar").value = 1; $("from-bar").onchange();
$("play").click(); await sleep(500); $("play").click(); await sleep(300);
const peakAt = (hz) => played.filter((n) => Math.round(n.osc.frequency.value) === hz).map((n) => +n.peak.toFixed(4))[0];
r.listAltoC4 = peakAt(262);
r.listSopranoA4 = peakAt(440);

await open("Angelus");
r.persisted = { marks: $("marked-count").textContent, octave: $("octave").value, shaded: marks(1), panelShowsMarks: shown($("marked-part")) };
window.result = r;
