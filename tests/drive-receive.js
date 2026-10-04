// Older .partsong.html files (shared before .partsong.pdf) opened in a browser,
// as from WhatsApp/email: their "Open in Partsong" button hands the full score
// to the app; the link alone (no script, or an installed app that can't reach
// back to the page) can't carry photos, so a score with photos isn't added
// that way. tests/fixtures/legacy.partsong.html is such a file (one photo).
// Run against http://localhost:8765/index.html with
// CHROME_FLAGS=--disable-popup-blocking (synthetic clicks aren't user gestures).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(150); } throw new Error("timeout waiting for " + label); };
const scores = () => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result); }; });
// The fixture points at the server it was made on; point it at this one.
const html = (await (await fetch("/tests/fixtures/legacy.partsong.html")).text()).replace(/https?:\/\/[\w.:]+\//g, location.origin + "/");
const file = new File([html], "Legacy (sent).partsong.html", { type: "text/html" });
const r = {};

// 1. Open the file as a page and tap the button.
const f = document.createElement("iframe");
f.src = URL.createObjectURL(file);
document.body.append(f);
await waitFor(() => f.contentDocument?.getElementById("open"), 10000, "file page");
const link = f.contentDocument.getElementById("open");
let popup;
const realOpen = f.contentWindow.open.bind(f.contentWindow);
f.contentWindow.open = (...a) => (popup = realOpen(...a));
link.click();
await waitFor(() => popup?.document?.getElementById("import-offer") && !popup.document.getElementById("import-offer").hidden, 20000, "offer in app");
r.offer = popup.document.getElementById("import-question").textContent;
popup.document.getElementById("import-yes").click();
await waitFor(async () => (await scores()).some((e) => e.id === "legacy-1"), 10000, "imported");
const got = (await scores()).find((e) => e.id === "legacy-1");
r.viaButton = { images: got.images.length, pages: got.pages.length, manual: got.manual, octave: got.octave, tempo: got.tempo };
popup.close();

// 2. The link alone: the score has a photo, which a link can't carry, so the
// app explains instead of adding a copy without it.
const before = (await scores()).length;
const shown = async (src, label) => {
  const g = document.createElement("iframe");
  g.src = src;
  document.body.append(g);
  await waitFor(() => g.contentDocument?.getElementById("import-offer") && !g.contentDocument.getElementById("import-offer").hidden, 20000, label);
  return g;
};
const g = await shown(link.href, "notice from link");
r.linkNotice = { text: g.contentDocument.getElementById("import-question").textContent, addHidden: g.contentDocument.getElementById("import-yes").hidden, button: g.contentDocument.getElementById("import-no").textContent };
// 3. The same with &receive (the button's link, no way back to the page).
const h = await shown(link.href + "&receive", "notice without opener");
r.noOpenerNotice = h.contentDocument.getElementById("import-question").textContent.slice(0, 40);
r.nothingAdded = (await scores()).length === before;
// An even older file's bare #receive with no opener says what to do.
const k = document.createElement("iframe");
k.src = "/index.html#receive";
document.body.append(k);
r.oldFileNoOpener = await waitFor(() => k.contentDocument?.querySelector("#error-toast:not([hidden])")?.textContent, 10000, "old-file error");
// 4. Open file with the older file: imported whole, photo included.
const { readScoreFile } = await import("/share.js");
const read = await readScoreFile(file);
r.openFileReads = { title: read.title, images: read.images.length, pages: read.pages.length };
window.result = r;
