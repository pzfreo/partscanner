// A score saved by an older version can carry marks/part choices that point
// at lines that no longer exist after re-analysis. Playback and follow-along
// must keep running. Seeds Angelus with out-of-range references.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const errors = [];
addEventListener("error", (e) => errors.push(String(e.message)));
const pages = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => fetch(`/testdata/angelus_${i}.musicxml`).then((r) => r.text())));
const images = await Promise.all([0, 1, 2, 3, 4, 5].map((i) => fetch(`/testdata/angelus_${i}.png`).then((r) => r.blob())));
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "ang", title: "Old Angelus", created: 1, pages, images, mine: 9, manual: { 0: 12, 99: 1 }, excluded: [42] }); tx.oncomplete = res; }; });
$("new-scan").click(); history.back(); await sleep(400);
await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
await sleep(1000);
const r = {};
for (const view of ["pages", "read"]) {
  if (view === "read") { $("view-toggle").click(); await waitFor(() => document.querySelectorAll("#osmd svg").length >= 6, 60000, "osmd"); }
  $("tempo").value = 160; $("tempo").oninput();
  $("from-bar").value = 1; $("from-bar").onchange();
  $("play").click();
  const seen = [];
  for (let i = 0; i < 6; i++) { await sleep(500); seen.push($("position").textContent); }
  $("play").click();
  r[view] = seen;
}
r.errors = errors;
window.result = r;
