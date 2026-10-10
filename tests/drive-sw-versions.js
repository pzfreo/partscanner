// The service worker never mixes versions: on a slow connection a versioned
// file (?v=…, the app's scripts and the music reader) comes from the cache
// only at that same version; a newer version waits for the network (an old
// cached music reader once ran with a new app). Needs the hanging server:
// python3 scripts/hang-server.py 8766, then run against
// http://127.0.0.1:8766/index.html (the service worker is skipped on localhost).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const file = "/testdata/sw-version.txt";
const put = async (text) => { console.log(`__EXEC__ printf ${text} > testdata/sw-version.txt`); await sleep(500); };
const get = (v, ms) => Promise.race([fetch(`${file}?v=${v}`).then((r) => r.text()), sleep(ms).then(() => "(still waiting)")]);
const r = {};
await waitFor(() => navigator.serviceWorker.controller, 30000, "service worker");
await put("one");
r.v1Online = await get(1, 5000);
await put("two");
await fetch("/__hang?on");
r.v1Slow = await get(1, 8000); // its own version, from the cache: quick
r.v2Slow = await get(2, 8000); // a new version: not the old copy
await fetch("/__hang?off");
r.v2Later = await get(2, 40000);
window.result = r;
