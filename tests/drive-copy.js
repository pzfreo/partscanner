// Make a copy (from the library list): same photos/music/marks/settings, unlocked, numbered name,
// title ready to rename; original untouched; back goes to the library.
// Seeds a marked, locked Huron. Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const scores = () => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result); }; });
const pages = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
const images = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob())));
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "orig", title: "Huron", created: 1, pages, images, manual: { 0: 1, 4: 1 }, octave: 0, tempo: 90, locked: true }); tx.oncomplete = res; }; });
$("new-scan").click(); history.back(); await sleep(400);
await shot(false);
await waitFor(() => document.querySelector("#library button"), 5000, "library");
const r0 = { rowButtons: [...document.querySelector("#library li").querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || "row") };
document.querySelector('#library button[aria-label="Make a copy of Huron"]').click();
await waitFor(() => document.querySelectorAll("#library li").length === 2, 5000, "copy listed");
await sleep(200);
const r = { ...r0 };
r.afterCopy = {
  stayedOnList: !$("home").hidden,
  names: [...document.querySelectorAll("#library .name")].map((n) => n.textContent),
  highlighted: document.querySelector("#library li.just-added .name")?.textContent,
  status: $("library-status").textContent,
};
await shot(false);
// Open the copy, rename it and change its marks; the original must not change.
document.querySelector("#library li.just-added button").click();
await sleep(500);
r.copyEditable = !$("title").readOnly;
$("title").value = "Huron S2"; $("title").dispatchEvent(new Event("change"));
$("settings").click(); await sleep(300);
$("clear-marks").click(); $("clear-marks").click(); await sleep(300);
$("panel-close").click(); await sleep(400);
const all = await scores();
const orig = all.find((e) => e.id === "orig"), copy = all.find((e) => e.id !== "orig");
r.copy = { title: copy.title, images: copy.images.length, pages: copy.pages.length, tempo: copy.tempo, manual: copy.manual, locked: copy.locked };
r.original = { title: orig.title, manual: orig.manual, locked: orig.locked };
// Back goes to the library (not to the original score).
history.back(); await sleep(500);
r.backGoesHome = !$("home").hidden;
r.library = [...document.querySelectorAll("#library .name")].map((n) => n.textContent);
window.result = r;
