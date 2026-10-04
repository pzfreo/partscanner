// Android share sheet -> installed app: posts a score file and a PDF to
// ./share-target (as the OS does) and checks the service worker hands them to
// the app. Run against http://127.0.0.1:8765/index.html (the app skips its
// service worker on "localhost").
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const frame = (src) => { const f = document.createElement("iframe"); f.style.cssText = "width:412px;height:900px;border:0"; f.src = src; document.body.prepend(f); return f; };
// 1. Install: this page is the app; wait for its service worker.
await waitFor(() => navigator.serviceWorker.controller, 20000, "service worker");
// 2. Make a score file to share, with the app's own exporter.
const { scoreFile } = await import("/share.js");
const pages = [await (await fetch("/testdata/huron_1.musicxml")).text()];
const images = [await (await fetch("/testdata/huron_1.png")).blob()];
const shared = await scoreFile({ id: "sent-1", title: "From WhatsApp", created: 1, pages, images, tempo: 72 });
const pdf = new File([await (await fetch("/testdata/huron.pdf")).blob()], "huron.pdf", { type: "application/pdf" });
// 3. Share both to the app: a multipart POST navigation to ./share-target.
const b = frame("about:blank");
await sleep(200);
const d = b.contentDocument;
const form = d.createElement("form");
form.method = "POST"; form.enctype = "multipart/form-data"; form.action = "/share-target";
const input = d.createElement("input"); input.type = "file"; input.name = "files"; input.multiple = true;
const dt = new DataTransfer(); dt.items.add(shared); dt.items.add(pdf); input.files = dt.files;
form.append(input); d.body.append(form); form.submit();
// 4. The app opens: it offers the score, and the PDF becomes a new scan.
await waitFor(() => b.contentWindow.location.pathname === "/" || b.contentWindow.location.pathname === "/index.html", 20000, "redirect");
const $ = (id) => b.contentDocument.getElementById(id);
const r0 = {};
await waitFor(() => $("scan") && !$("scan").hidden && b.contentDocument.querySelectorAll("#pages img").length === 4, 60000, "pdf pages in scan");
// The score asks first, as from its page's link, and waits in the inbox till answered.
r0.offer = await waitFor(() => !$("import-offer").hidden && $("import-question").textContent, 20000, "offer");
r0.waitingBeforeAnswer = (await (await caches.open("partscanner-inbox")).keys()).length;
$("import-yes").click();
await waitFor(async () => (await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result); }; })).some((e) => e.id === "sent-1"), 10000, "score added");
const lib = await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result); }; });
window.result = {
  ...r0,
  landedOn: b.contentWindow.location.href,
  importedScore: lib.filter((e) => e.id === "sent-1").map((e) => ({ title: e.title, pages: e.pages.length, images: e.images.length, tempo: e.tempo })),
  pdfPagesInScan: b.contentDocument.querySelectorAll("#pages img").length,
  scanName: $("scan-name").value,
  inboxEmpty: (await (await caches.open("partscanner-inbox")).keys()).length === 0,
};
