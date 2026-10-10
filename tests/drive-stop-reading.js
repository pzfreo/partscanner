// Stop reading: while a scan is read, the Read music button stops it at once
// (mid-page); pages read so far are kept, the scan isn't carried on by itself
// next launch, and Read music carries on from the next page.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const db = await import("/db.js");
await sleep(500);
document.querySelector("#library-empty .try-sample").click();
await waitFor(() => document.querySelectorAll("#pages img").length === 3 && !$("recognise").disabled, 30000, "sample pages");
$("recognise").click();
const r = {};
await waitFor(() => /Page 2 of 3/.test($("status").textContent), 600000, "page 2");
r.whileReading = { label: $("recognise").textContent, enabled: !$("recognise").disabled };
await sleep(1500);
const t0 = performance.now();
$("recognise").click();
await waitFor(() => /Stopped/.test($("status").textContent), 10000, "stopped");
r.stopMs = Math.round(performance.now() - t0);
r.afterStop = { status: $("status").textContent, label: $("recognise").textContent, enabled: !$("recognise").disabled, screen: !$("scan").hidden };
await sleep(300);
const [entry] = await db.all();
r.saved = { stopped: entry.stopped, pending: entry.pending, pagesRead: entry.pages.filter(Boolean).length };
await shot(false);
$("recognise").click();
await waitFor(() => !$("practice").hidden, 600000, "read rest");
const [done] = await db.all();
r.finished = { pending: done.pending, stopped: done.stopped ?? null, pagesRead: done.pages.filter(Boolean).length, title: $("title").value };
window.result = r;
