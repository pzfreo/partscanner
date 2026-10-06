// Sharing by link through the relay, and falling back to the PDF alone.
// Needs the relay running locally: in relay/,
//   npx wrangler dev --port 8787 --var "ORIGINS:http://localhost:8765"
// then run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const idb = (mode, fn) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out?.result ?? out); }; });
const pages = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
const images = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob())));
await idb("readwrite", (s) => s.put({ id: "rel-1", title: "Relay test", created: 5, pages, images, manual: { 1: 2 }, octave: -1, tempo: 80 }));
localStorage.setItem("partsong.relay", "http://localhost:8787");
const r = {};

// Share on a phone: capture what the share sheet would get.
let shared;
Object.defineProperty(navigator, "userAgentData", { value: { mobile: true }, configurable: true });
navigator.canShare = () => true;
navigator.share = async (data) => { shared = data; };
const share = async (button = "share", statusId = "share-status") => {
  shared = null;
  $("new-scan").click(); history.back(); await sleep(400);
  await waitFor(() => document.querySelector('#library li[data-id="rel-1"] button'), 5000, "library").then((b) => b.click());
  await sleep(500);
  $("settings").click(); await sleep(300);
  $(button).click();
  await waitFor(() => shared, 90000, "share");
  return { status: await waitFor(() => $(statusId).textContent, 5000, "status"), shared };
};
const pdfHasLink = async (file) => (await file.text()).includes("/URI");

// 1. Relay up: just the link (WhatsApp drops text that comes with a file).
let s = await share();
const link = s.shared.text?.match(/https?:\S+#s=\S+/)?.[0];
r.relayUp = { status: s.status, text: s.shared.text?.replace(/#s=\S+/, "#s=…"), files: s.shared.files?.length ?? 0 };
// Share as PDF: the file, no link anywhere.
s = await share("share-pdf", "share-pdf-status");
r.asPdf = { status: s.status, text: s.shared.text ?? null, file: s.shared.files[0].name, pdfHasLink: await pdfHasLink(s.shared.files[0]) };

// 2. The link opened elsewhere: the whole score is offered and added.
const frame = (src) => { const f = document.createElement("iframe"); f.src = src; document.body.append(f); return f; };
const offerIn = (f, label) => waitFor(() => !f.contentDocument.getElementById("import-offer").hidden && f.contentDocument.getElementById("import-question").textContent, 20000, label);
const before = (await idb("readonly", (st) => st.getAll())).length;
let f = frame(link);
r.linkOffer = await offerIn(f, "link offer");
f.contentDocument.getElementById("import-yes").click();
await waitFor(async () => (await idb("readonly", (st) => st.getAll())).length === before + 1, 10000, "added");
const got = (await idb("readonly", (st) => st.getAll())).find((e) => e.title === "Relay test (2)");
r.viaLink = { images: got.images.length, pages: got.pages.length, manual: got.manual, octave: got.octave, tempo: got.tempo };

// 3. Tapped while Partsong is already open: only the fragment changes.
f = frame("/index.html");
await waitFor(() => f.contentDocument?.getElementById("library"), 10000, "app open");
await sleep(1000);
f.contentWindow.location.hash = link.split("#")[1];
r.whileOpenOffer = await offerIn(f, "offer while open");

// 4. An unknown or expired link: says where the full score is.
f = frame(link.replace(/#s=[\w-]{22}/, "#s=ZZZZZZZZZZZZZZZZZZZZZZ"));
r.expiredNotice = await offerIn(f, "expired notice");

// 5. Relay down when sharing: the PDF instead, no link anywhere.
localStorage.setItem("partsong.relay", "http://localhost:9");
s = await share();
r.relayDown = { status: s.status, text: s.shared.text ?? null, file: s.shared.files[0].name, pdfHasLink: await pdfHasLink(s.shared.files[0]) };
localStorage.removeItem("partsong.relay");
window.result = r;
