// Installed app on a connection that hangs rather than fails: it must still
// open, from the cache, within a few seconds; and a share whose launch never
// finished is picked up on the next start. Needs a server that can hang:
// python3 scripts/hang-server.py 8766, then run against
// http://127.0.0.1:8766/index.html (the service worker is skipped on localhost).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const scores = () => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result); }; });
const r = {};
await waitFor(() => navigator.serviceWorker.controller, 30000, "service worker");
await waitFor(async () => (await (await caches.open("partscanner-shell-v1")).keys()).length >= 19, 60000, "shell cached");
const { scoreFile } = await import("/share.js");
const xml = await (await fetch("/testdata/huron_1.musicxml")).text();

// 1. Every request now hangs for 30 s.
await fetch("/__hang?on");
const t0 = performance.now();
const f = document.createElement("iframe");
f.src = "/";
document.body.append(f);
await waitFor(() => f.contentDocument?.getElementById("new-scan") && f.contentWindow.getComputedStyle(f.contentDocument.body).fontFamily.includes("Jakarta"), 25000, "app shown");
r.shownWhileHangingMs = Math.round(performance.now() - t0);
await fetch("/__hang?off");

// 2. A share left in the inbox by a launch that never finished.
const file = await scoreFile({ id: "left", title: "Left in inbox", created: 1, pages: [xml], images: [] });
await (await caches.open("partscanner-inbox")).put("inbox/1-0", new Response(file, { headers: { "content-type": "application/pdf", "x-name": "x.partsong.pdf" } }));
const g = document.createElement("iframe");
g.src = "/";
document.body.append(g);
await waitFor(() => !g.contentDocument.getElementById("import-offer").hidden, 20000, "inbox offer");
// Android can launch the app twice for one share: a reload before answering
// must ask again, not lose the score.
g.contentWindow.location.reload();
await sleep(500);
await waitFor(() => !g.contentDocument.getElementById("import-offer").hidden, 20000, "offer after reload");
r.askedAgainAfterReload = true;
g.contentDocument.getElementById("import-yes").click();
await waitFor(async () => (await scores()).some((e) => e.title === "Left in inbox"), 10000, "inbox picked up");
r.leftoverShareImported = true;
r.inboxEmptyAfter = (await (await caches.open("partscanner-inbox")).keys()).length === 0;
window.result = r;
