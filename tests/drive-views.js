// Pages / As read switch. Seeds Huron (with photos) from testdata, and imports
// a MusicXML file (no photos). Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const shown = (el) => !el.hidden && getComputedStyle(el).display !== "none";
const pages = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
const images = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob())));
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "hur", title: "Huron", created: 1, pages, images, mine: 2 }); tx.oncomplete = res; }; });
$("new-scan").click(); history.back(); await sleep(400);
await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
await waitFor(() => document.querySelectorAll(".photo-list .page svg[viewBox]").length >= 4, 10000, "photos");
const r = {};
r.opensOnPages = shown($("view-switch")) && shown($("follow")) && !shown($("read-view"));
$("view-read").click();
await waitFor(() => document.querySelectorAll("#osmd svg").length >= 4, 30000, "osmd");
r.asRead = { readShown: shown($("read-view")), pagesHidden: !shown($("follow")), svgs: document.querySelectorAll("#osmd svg").length };
await shot(false);
// Marking from the As read view switches back to the pages.
$("settings").click(); await sleep(300);
r.markButtonAboveList = !!($("start-markup").compareDocumentPosition($("lines")) & Node.DOCUMENT_POSITION_FOLLOWING);
$("start-markup").click(); await sleep(300);
r.markupSwitchesToPages = shown($("follow")) && shown($("markup-bar"));
$("markup-done").click(); await sleep(300);
$("view-pages").click();
r.backToPages = shown($("follow")) && !shown($("read-view"));
// MusicXML import: no photos, so it opens on the read view with no switch.
$("back").click(); await sleep(400);
const dt = new DataTransfer(); dt.items.add(new File([pages[0]], "page1.musicxml", { type: "application/xml" }));
$("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
await waitFor(() => !$("practice").hidden, 5000, "practice");
await waitFor(() => document.querySelectorAll("#osmd svg").length >= 1, 30000, "osmd import");
r.importOpensRead = { switchHidden: !shown($("view-switch")), readShown: shown($("read-view")), pagesHidden: !shown($("follow")) };
window.result = r;
