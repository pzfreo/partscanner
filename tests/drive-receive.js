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

// 2. The plain link alone (as if the viewer blocked the script, or the
// installed app caught it): the score has photos, which a link can't carry,
// so the app explains instead of adding a copy without them.
const before = (await scores()).length;
const shown = async (src, label) => {
  const g = document.createElement("iframe");
  g.src = src;
  document.body.append(g);
  await waitFor(() => g.contentDocument?.getElementById("import-offer") && !g.contentDocument.getElementById("import-offer").hidden, 20000, label);
  return g;
};
let g = await shown(link.href, "notice from link");
r.linkNotice = { text: g.contentDocument.getElementById("import-question").textContent, addHidden: g.contentDocument.getElementById("import-yes").hidden, button: g.contentDocument.getElementById("import-no").textContent };
// 3. The same with &receive (the app button's link, no way back to the page).
const h = await shown(link.href + "&receive", "notice without opener");
r.noOpenerNotice = h.contentDocument.getElementById("import-question").textContent.slice(0, 40);
r.nothingAdded = (await scores()).length === before;
// A score with no photos comes through the link whole: offered and added.
const plain = await scoreFile({ id: "plain", title: "No photos", created: 4, pages, images: [], octave: -1 });
const pf = document.createElement("iframe");
pf.src = URL.createObjectURL(plain);
document.body.append(pf);
const plainLink = await waitFor(() => pf.contentDocument?.getElementById("open")?.href, 10000, "plain file page");
g = await shown(plainLink, "offer for photo-less score");
r.plainOffer = g.contentDocument.getElementById("import-question").textContent;
g.contentDocument.getElementById("import-yes").click();
await waitFor(() => !g.contentDocument.getElementById("practice").hidden, 10000, "link import opened");
const copy = (await scores()).find((e) => e.title === "No photos");
r.viaLink = { images: copy.images.length, pages: copy.pages.length, octave: copy.octave };
r.linkOpensAsRead = !g.contentDocument.getElementById("read-view").hidden;
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
