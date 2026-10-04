// Manual part marking. Seeds Angelus (6 pages) and Huron (4 pages) from
// testdata, then checks the staff menu, marks, playback mix (by recording the
// notes Web Audio is asked to play), octave shift and persistence.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);

// Record every note: oscillator frequency + envelope peak, in creation order.
const played = [];
const origOsc = AudioContext.prototype.createOscillator;
AudioContext.prototype.createOscillator = function () { const o = origOsc.call(this); played.push({ osc: o }); return o; };
const origRamp = AudioParam.prototype.linearRampToValueAtTime;
let ramps = 0;
AudioParam.prototype.linearRampToValueAtTime = function (v, t) { played[ramps++].peak = v; return origRamp.call(this, v, t); };

async function seed(id, set, n, title) {
  const pages = await Promise.all([...Array(n).keys()].map((i) => fetch(`/testdata/${set}_${i}.musicxml`).then((r) => r.text())));
  const images = await Promise.all([...Array(n).keys()].map((i) => fetch(`/testdata/${set}_${i}.png`).then((r) => r.blob())));
  await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id, title, created: id === "ang" ? 2 : 1, pages, images }); tx.oncomplete = res; }; });
}
await seed("ang", "angelus", 6, "Angelus");
await seed("hur", "huron", 4, "Huron");
const open = async (title) => {
  $("back").click(); await sleep(300); if (!$("home").hidden === false) history.back();
  await waitFor(() => [...document.querySelectorAll("#library button")].find((b) => b.textContent.includes(title)), 5000, "library " + title).then((b) => b.click());
  await waitFor(() => document.querySelectorAll(".photo-list .page svg[viewBox]").length >= 4, 10000, "photos");
  await sleep(300);
};
// Tap a point given in photo coordinates on page p.
const tap = (p, x, y) => {
  const svg = document.querySelectorAll(".photo-list svg")[p];
  svg.scrollIntoView({ block: "center" });
  const vb = svg.viewBox.baseVal, r = svg.getBoundingClientRect();
  svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + (x / vb.width) * r.width, clientY: r.top + (y / vb.height) * r.height }));
};
const menuItems = () => [...$("staff-menu").querySelectorAll("button")].map((b) => b.textContent);
const clickItem = (text) => [...$("staff-menu").querySelectorAll("button")].find((b) => b.textContent === text).click();
const r = {};

await open("Angelus");
r.panelOpenForNewScore = !$("panel").hidden;
document.querySelector('input[name="mode"][value="manual"]').click();
r.manualHidesList = $("lines").hidden && !$("manual-help").hidden;
r.countBefore = $("marked-count").textContent;
$("settings").click(); await sleep(300); // close panel
tap(1, 1200, 535); // page 2, first system, second staff (T.)
await sleep(200);
r.singleVoiceMenu = menuItems();
clickItem("My part");
await sleep(200);
r.countAfter = $("marked-count").textContent;
r.markOnPage2 = document.querySelectorAll(".photo-list .page")[1].querySelectorAll(".mark").length;
$("octave").value = "-1"; $("octave").dispatchEvent(new Event("change"));
$("others").value = 25; $("others").oninput();
$("from-bar").value = 23; $("from-bar").onchange();
$("tempo").value = 150; $("tempo").oninput();
$("play").click(); await sleep(1500);
const nm = document.querySelectorAll(".photo-list .page")[1].querySelector(".note");
r.noteMarkerY = nm.style.display === "none" ? null : Math.round(nm.getAttribute("cy"));
$("play").click(); await sleep(300);
const loud = played.filter((n) => n.peak > 0.2).map((n) => Math.round(n.osc.frequency.value));
const quiet = played.filter((n) => n.peak <= 0.2 && n.peak > 0).map((n) => +n.peak.toFixed(4));
r.loudFreqs = loud.slice(0, 6);
r.quietPeaks = [...new Set(quiet)];
// Unmarked system: no part of yours, marker hidden.
played.length = 0; ramps = 0;
$("from-bar").value = 29; $("from-bar").onchange();
$("play").click(); await sleep(1200); $("play").click(); await sleep(300);
r.unmarkedSystemLoudNotes = played.filter((n) => n.peak > 0.2).length;
r.unmarkedSystemQuietNotes = played.filter((n) => n.peak > 0 && n.peak <= 0.2).length;

await open("Huron");
document.querySelector('input[name="mode"][value="manual"]').click();
if (!$("panel").hidden) { $("settings").click(); await sleep(300); }
tap(0, 1200, 680); // page 1, first system, S/A staff
await sleep(200);
r.twoVoiceMenu = menuItems();
clickItem("Lower voice");
await sleep(200);
r.lowerLabel = [...document.querySelectorAll(".photo-list .page")[0].querySelectorAll(".mark-label")].map((t) => t.textContent);

// Auto mode still mixes by the chosen line: Alto loud, Soprano faded (bar 1: S A4, A C4).
document.querySelector('input[name="mode"][value="auto"]').click();
[...document.querySelectorAll("#lines li")].find((li) => li.querySelector(".pick span").textContent === "Alto").querySelector('input[type="radio"]').click();
$("octave").value = "0"; $("octave").dispatchEvent(new Event("change"));
played.length = 0; ramps = 0;
$("from-bar").value = 1; $("from-bar").onchange();
$("play").click(); await sleep(500); $("play").click(); await sleep(300);
const peakAt = (hz) => played.filter((n) => Math.round(n.osc.frequency.value) === hz).map((n) => +n.peak.toFixed(4));
r.autoAltoC4 = peakAt(262).slice(0, 1);
r.autoSopranoA4 = peakAt(440).slice(0, 1);

await open("Angelus");
r.menuClosed = getComputedStyle($("staff-menu")).display === "none";
r.hint = $("tap-hint").textContent;
r.persisted = { mode: document.querySelector('input[name="mode"]:checked').value, octave: $("octave").value, count: $("marked-count").textContent, marks: document.querySelectorAll(".photo-list .mark").length };
await shot(false);
window.result = r;
