// Closing the settings panel: Done, tapping the dimmed music, swiping the
// handle down. Play stays usable while it's open. Seeds Huron from testdata.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const pages = [await (await fetch("/testdata/huron_0.musicxml")).text()];
const images = [await (await fetch("/testdata/huron_0.png")).blob()];
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "h", title: "Huron", created: 1, pages, images, mine: 2 }); tx.oncomplete = res; }; });
$("new-scan").click(); history.back(); await sleep(400);
await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
await sleep(600);
const open = async () => { $("settings").click(); await sleep(350); return !$("panel").hidden && !$("panel-backdrop").hidden; };
const closed = () => $("panel").hidden && $("panel-backdrop").hidden && !history.state?.panel && !$("practice").hidden;
const r = {};
r.opens = await open();
await shot(false);
// Play works while the panel is open.
$("play").click(); await sleep(400);
r.playWhileOpen = $("play").classList.contains("playing");
$("play").click();
$("panel-close").click(); await sleep(350);
r.doneCloses = closed();
await open();
const bd = $("panel-backdrop");
bd.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 200, clientY: 150 }));
await sleep(350);
r.tapMusicCloses = closed();
await open();
const head = $("panel-head");
const y = head.getBoundingClientRect().top + 10;
head.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientY: y, pointerId: 1 }));
head.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientY: y + 120, pointerId: 1 }));
head.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientY: y + 120, pointerId: 1 }));
await sleep(350);
r.swipeCloses = closed();
await open();
head.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientY: y, pointerId: 1 }));
head.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientY: y + 20, pointerId: 1 }));
await sleep(200);
r.smallDragStaysOpen = !$("panel").hidden;
$("panel-close").click(); await sleep(350);
window.result = r;
