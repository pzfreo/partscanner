// Interrupted reading: start a 4-page scan in an iframe, kill the iframe after
// page 2, then load a fresh app and check it resumes from page 3 and finishes.
// Run with host page http://localhost:8765/testdata/.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const app = async () => {
  const f = document.createElement("iframe");
  f.style.cssText = "width:412px;height:900px;border:0";
  f.src = "/index.html?" + Math.random();
  document.body.prepend(f);
  await waitFor(() => f.contentWindow.document.getElementById("new-scan"), 20000, "app");
  return { f, w: f.contentWindow, $: (id) => f.contentWindow.document.getElementById(id) };
};
const scans = () => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result); }; });
const r = {};

let a = await app();
const wakeCalls = [];
const origReq = a.w.navigator.wakeLock?.request.bind(a.w.navigator.wakeLock);
if (origReq) a.w.navigator.wakeLock.request = (t) => { wakeCalls.push(t); return origReq(t); };
a.$("new-scan").click();
const dt = new a.w.DataTransfer();
for (const i of [0, 1, 2, 3]) dt.items.add(new a.w.File([await (await fetch(`/testdata/huron_${i}.png`)).blob()], `p${i}.png`, { type: "image/png" }));
a.$("gallery").files = dt.files; a.$("gallery").dispatchEvent(new a.w.Event("change"));
await waitFor(() => !a.$("recognise").disabled, 20000, "pages added");
a.$("scan-name").value = "Interrupted";
a.$("recognise").click();
await waitFor(() => /Page 3 of 4/.test(a.$("status").textContent), 300000, "page 3 started");
r.wakeLockRequested = wakeCalls;
a.f.remove(); // the tab is killed mid-read
await sleep(500);
const mid = (await scans()).find((e) => e.title === "Interrupted");
r.savedMidway = { pending: mid?.pending, done: mid?.pages.filter(Boolean).length, of: mid?.pages.length, images: mid?.images.length };

let b = await app(); // reopening the app
const seen = [];
await waitFor(() => { const t = b.$("status").textContent; const m = t.match(/Page \d of 4/); if (m && seen.at(-1) !== m[0]) seen.push(m[0]); return !b.$("practice").hidden; }, 300000, "resumed and finished");
r.pagesReadAfterResume = seen;
r.bars = b.$("to-bar").value;
r.lines = [...b.w.document.querySelectorAll("#lines .pick span:first-of-type")].map((s) => s.textContent);
const done = (await scans()).find((e) => e.title === "Interrupted");
r.final = { pending: done.pending, done: done.pages.filter(Boolean).length, resumes: done.resumes };
window.result = r;
