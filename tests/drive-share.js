// Share a score to a file and open it again. Seeds Huron (photos, a mark,
// settings) from testdata. Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const idb = (mode, fn) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out?.result ?? out); }; });
const pages = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
const images = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob())));
await idb("readwrite", (s) => s.put({ id: "hur-1", title: "Huron Carol", created: 5, pages, images, manual: { 4: 0 }, octave: -1, tempo: 96, others: 40, mine: 2, locked: true }));
$("new-scan").click(); history.back(); await sleep(400);
await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
await sleep(500);
const r = {};

// On a phone with a share sheet: capture what would be handed to WhatsApp/Drive.
let shared;
const setPhone = (on) => Object.defineProperty(navigator, "userAgentData", { value: { mobile: on }, configurable: true });
setPhone(true);
navigator.canShare = () => true;
navigator.share = async ({ files }) => { shared = files[0]; };
$("settings").click(); await sleep(300);
$("share").click();
await waitFor(() => shared, 60000, "share");
r.file = { name: shared.name, type: shared.type, mb: +(shared.size / 1e6).toFixed(1) };
r.status = await waitFor(() => $("share-status").textContent, 5000, "status");
// Opened outside the app it's a PDF of the page photos plus a page saying how
// to open it in Partsong.
const { pdfPages } = await import("/pdf-pages.js");
let pdfPageCount = 0;
await pdfPages(shared, async (blob, n, count) => { pdfPageCount = count; });
r.asPdf = { pages: pdfPageCount, head: await shared.slice(0, 5).text() };

// Desktop: a plain download even though a share menu is available.
let downloaded;
setPhone(false);
navigator.canShare = () => true;
const origClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () { if (this.download) downloaded = this.download; else origClick.call(this); };
$("share").click();
await waitFor(() => downloaded, 60000, "download");
r.downloadName = downloaded;
HTMLAnchorElement.prototype.click = origClick;

// Delete it, then open the shared file.
await idb("readwrite", (s) => s.delete("hur-1"));
$("settings").click(); await sleep(300);
$("back").click(); await sleep(500);
const open = (file) => { const dt = new DataTransfer(); dt.items.add(file); $("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change")); };
open(shared);
await waitFor(() => !$("practice").hidden, 20000, "opened");
const got = (await idb("readonly", (s) => s.getAll())).find((e) => e.id === "hur-1");
const dims = await Promise.all(got.images.map(async (b) => { const i = await createImageBitmap(b); return `${i.width}x${i.height}`; }));
r.restored = { title: got.title, pages: got.pages.length, images: dims, manual: got.manual, octave: got.octave, tempo: got.tempo, others: got.others, locked: got.locked };
await waitFor(() => document.querySelectorAll(".photo-list .mark").length, 10000, "mark shaded");
r.markShaded = document.querySelectorAll(".photo-list .mark").length;
r.tempoShown = $("tempo").value;
// Receiving it again adds a numbered copy; the first is untouched.
$("back").click(); await sleep(500);
open(shared);
await waitFor(() => !$("practice").hidden, 20000, "reopened");
await sleep(300);
const all = await idb("readonly", (s) => s.getAll());
r.afterSecondImport = all.map((e) => e.title).sort();
r.originalKept = all.some((e) => e.id === "hur-1" && e.title === "Huron Carol");
r.openedTitle = $("title").value;
// A third time: (3).
$("back").click(); await sleep(500);
open(shared);
await waitFor(() => !$("practice").hidden, 20000, "third");
r.thirdTitle = $("title").value;
// Not a score or MusicXML: refused with a message.
$("back").click(); await sleep(500);
open(new File(["hello"], "notes.txt", { type: "text/plain" }));
await sleep(500);
r.badFile = $("library-status").textContent;
// An ordinary PDF (not a Partsong score) starts a new scan.
open(new File([await (await fetch("/testdata/huron.pdf")).blob()], "huron.pdf", { type: "application/pdf" }));
await waitFor(() => !$("scan").hidden && document.querySelectorAll("#pages img").length === 4, 60000, "pdf scan");
r.plainPdfScanPages = document.querySelectorAll("#pages img").length;
window.result = r;
