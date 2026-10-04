// Locking a score. Seeds Huron (with one mark) from testdata.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const pages = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
const images = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob())));
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "hur", title: "Huron", created: 1, pages, images, manual: { 0: 2 }, mine: 2 }); tx.oncomplete = res; }; });
const open = async () => {
  if ($("home").hidden) { $("back").click(); await sleep(400); } else { $("new-scan").click(); history.back(); await sleep(400); }
  await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
  await waitFor(() => document.querySelectorAll(".photo-list .page svg[viewBox]").length >= 4, 10000, "photos");
  await sleep(300);
};
const disabled = () => Object.fromEntries(["octave", "start-markup", "edit-markup", "clear-marks", "delete", "tempo", "others"].map((id) => [id, $(id).disabled]));
const r = {};
await open();
$("settings").click(); await sleep(300);
$("lock").click(); await sleep(200);
r.lockedDisabled = disabled();
await shot(false);
r.titleReadOnly = $("title").readOnly;
$("delete").click(); $("delete").click(); await sleep(300);
r.deleteIgnored = !$("practice").hidden;
$("settings").click(); await sleep(300);
const svg = document.querySelectorAll(".photo-list svg")[0];
svg.scrollIntoView({ block: "center" });
const b = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal;
svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: b.left + (1500 / vb.width) * b.width, clientY: b.top + (680 / vb.height) * b.height }));
await sleep(200);
r.tapStillSetsStart = $("from-bar").value;
r.marksIntact = $("marked-count").textContent;
await open(); // reopen
r.libraryShowsLock = null;
r.reopenedLocked = $("lock").checked && $("title").readOnly;
$("back").click(); await sleep(400);
r.libraryShowsLock = document.querySelector("#library .name").textContent;
document.querySelector("#library button").click(); await sleep(500);
$("settings").click(); await sleep(300);
$("lock").click(); await sleep(200);
r.unlockedDisabled = disabled();
r.titleEditable = !$("title").readOnly;
window.result = r;
