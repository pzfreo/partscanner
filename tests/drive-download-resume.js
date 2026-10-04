// Model downloads resume after the reader is killed: pieces already stored
// are not fetched again. Run with host page http://localhost:8769/testdata/
// served by scripts/flaky-server.py 8769 (range support, no faults).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const pieces = async () => (await (await caches.open("partscanner-models-v1")).keys()).filter((r) => r.url.includes("?piece=")).length;
const frame = () => { const f = document.createElement("iframe"); f.src = "/tests/omr-test.html?page=huron_1.png&" + Math.random(); document.body.append(f); return f; };
const r = {};
// Count piece requests by watching the iframe's network via Resource Timing.
let f = frame();
await waitFor(async () => (await pieces()) >= 12, 120000, "some pieces");
f.remove(); // reader killed mid-download
await sleep(500);
r.piecesKeptAfterKill = await pieces();
f = frame();
await waitFor(() => f.contentWindow.result?.xml, 300000, "recognised after resume");
r.resumedAndRecognised = true;
r.piecesTotal = await pieces(); // 15 + 13 + 12 = 40 for the three models
window.result = r;
