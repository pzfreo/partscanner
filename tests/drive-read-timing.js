// Playback timing while following along. Records how late each note is
// scheduled (Web Audio start time vs the clock) and the longest gap between
// animation frames. Run with CPU_THROTTLE=4 to approximate a phone.
// ?view=read|pages|switch (switch = start on Pages, change to As read while
// playing). Run against http://localhost:8765/index.html?view=read.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const view = new URLSearchParams(location.search).get("view") || "read";
const late = [];
const origStart = OscillatorNode.prototype.start;
OscillatorNode.prototype.start = function (when) { late.push(this.context.currentTime - when); return origStart.call(this, when); };
const pages = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
const images = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob())));
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "hur", title: "Huron", created: 1, pages, images, mine: 2 }); tx.oncomplete = res; }; });
$("new-scan").click(); history.back(); await sleep(400);
await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
await sleep(800);
if (view === "read") { $("view-toggle").click(); await waitFor(() => document.querySelectorAll("#osmd svg").length >= 4, 60000, "osmd"); }
await sleep(1000);
$("tempo").value = 120; $("tempo").oninput();
let maxGap = 0, last = performance.now(), frames = 0, running = true;
const tick = (t) => { maxGap = Math.max(maxGap, t - last); last = t; frames++; if (running) requestAnimationFrame(tick); };
requestAnimationFrame(tick);
late.length = 0;
$("play").click();
if (view === "switch") { await sleep(1500); $("view-toggle").click(); await sleep(6500); } else await sleep(8000);
$("play").click();
running = false;
const ms = late.map((x) => x * 1000);
window.result = {
  view,
  notes: ms.length,
  lateNotes: ms.filter((x) => x > 0).length,
  lateBy: ms.filter((x) => x > 0).map(Math.round),
  worstLateMs: Math.round(Math.max(...ms)),
  maxFrameGapMs: Math.round(maxGap),
  fps: Math.round(frames / 8),
  position: $("position").textContent,
};
