// Opening a received .partsong.html (as from WhatsApp/email): its "Open in
// Partsong" button hands the full score to the app; the plain link (no script)
// carries it without photos. Both ask before adding.
// Run against http://localhost:8765/index.html with
// CHROME_FLAGS=--disable-popup-blocking (synthetic clicks aren't user gestures).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(150); } throw new Error("timeout waiting for " + label); };
const scores = () => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result); }; });
const { scoreFile } = await import("/share.js");
const pages = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
const images = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob())));
const file = await scoreFile({ id: "sent", title: "Huron (sent)", created: 3, pages, images, manual: { 1: 2 }, octave: -1, tempo: 70 });
const r = { fileMb: +(file.size / 1e6).toFixed(1) };

// 1. Open the file as a page and tap the button.
const f = document.createElement("iframe");
f.src = URL.createObjectURL(file);
document.body.append(f);
await waitFor(() => f.contentDocument?.getElementById("open"), 10000, "file page");
const link = f.contentDocument.getElementById("open");
r.linkLength = link.href.length;
let popup;
const realOpen = f.contentWindow.open.bind(f.contentWindow);
f.contentWindow.open = (...a) => (popup = realOpen(...a));
link.click();
await waitFor(() => popup?.document?.getElementById("import-offer") && !popup.document.getElementById("import-offer").hidden, 20000, "offer in app");
r.offer = popup.document.getElementById("import-question").textContent;
popup.document.getElementById("import-yes").click();
await waitFor(async () => (await scores()).some((e) => e.id === "sent"), 10000, "imported");
const got = (await scores()).find((e) => e.id === "sent");
r.viaButton = { images: got.images.length, pages: got.pages.length, manual: got.manual, octave: got.octave, tempo: got.tempo };
await waitFor(() => !popup.document.getElementById("practice").hidden, 10000, "score opened");
r.popupOpenedScore = popup.document.getElementById("title").value;
popup.close();

// 2. The plain link alone (as if the viewer blocked the script).
const g = document.createElement("iframe");
g.src = link.href;
document.body.append(g);
await waitFor(() => g.contentDocument?.getElementById("import-offer") && !g.contentDocument.getElementById("import-offer").hidden, 20000, "offer from link");
r.linkOffer = g.contentDocument.getElementById("import-question").textContent;
g.contentDocument.getElementById("import-yes").click();
await waitFor(() => !g.contentDocument.getElementById("practice").hidden, 10000, "link import opened");
const all = await scores();
const copy = all.find((e) => e.title === "Huron (sent) (2)");
r.viaLink = { images: copy.images.length, pages: copy.pages.length, manual: copy.manual, octave: copy.octave, newId: copy.id !== "sent" };
r.originalUntouched = all.find((e) => e.id === "sent").images.length === 2;
r.linkOpensAsRead = !g.contentDocument.getElementById("read-view").hidden;
// 3. The button's link where the app can't reach back to the file's page
// (as when an installed app catches it): falls back to the link's score.
const h = document.createElement("iframe");
h.src = link.href + "&receive";
document.body.append(h);
await waitFor(() => h.contentDocument?.getElementById("import-offer") && !h.contentDocument.getElementById("import-offer").hidden, 20000, "offer without opener");
r.noOpenerOffer = h.contentDocument.getElementById("import-question").textContent;
// An older file's bare #receive with no opener says what to do.
const k = document.createElement("iframe");
k.src = "/index.html#receive";
document.body.append(k);
r.oldFileNoOpener = await waitFor(() => k.contentDocument?.querySelector("#error-toast:not([hidden])")?.textContent, 10000, "old-file error");
// 4. Where the browser offers a share sheet, "Send it there" hands over the
// whole file, photos included (share stubbed: headless has no share sheet).
const { parseScoreFile } = await import("/share.js");
const stub = `<script>Object.defineProperty(navigator, "userAgent", { value: "Android" }); navigator.canShare = () => true; navigator.share = async (d) => { parent.sharedFile = d.files[0]; };</script>`;
const m = document.createElement("iframe");
m.src = URL.createObjectURL(new Blob([(await file.text()).replace("<head>", "<head>" + stub)], { type: "text/html" }));
document.body.append(m);
await waitFor(() => m.contentDocument?.getElementById("send") && !m.contentDocument.getElementById("send-box").hidden, 10000, "send button");
m.contentDocument.getElementById("send").click();
await waitFor(() => window.sharedFile, 5000, "shared file");
const resent = parseScoreFile(await window.sharedFile.text());
r.sendButton = { name: window.sharedFile.name, images: resent.images.length, pages: resent.pages.length, tempo: resent.tempo };
// Not on Android (desktop share menus can't reach the app): hidden.
r.sendHiddenWithoutShare = f.contentDocument.getElementById("send-box").hidden;
// A fresh device (score not present): the link imports without photos.
const { entryFromLink } = await import("/share.js");
const fresh = await entryFromLink(link.href.split("#import=")[1]);
r.linkAloneHasPhotos = fresh.images.length;
window.result = r;
