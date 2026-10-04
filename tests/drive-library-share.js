// Share from the library list, including the "tap again" path when the
// browser refuses the share sheet because the tap was too long ago.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const pages = [await (await fetch("/testdata/huron_0.musicxml")).text()];
const images = [await (await fetch("/testdata/huron_0.png")).blob()];
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); const s = tx.objectStore("scores");
  s.put({ id: "done", title: "A very long score title that should not push the share icon off the row", created: 2, pages, images });
  s.put({ id: "busy", title: "Still reading", created: 1, pages: [pages[0], null], images: [images[0], images[0]], pending: true, resumes: 2 });
  tx.oncomplete = res; }; });
$("new-scan").click(); history.back(); await sleep(500);
await waitFor(() => document.querySelectorAll("#library li").length === 2, 5000, "library");
const r = {};
r.shareButtons = document.querySelectorAll('#library button[aria-label^="Share"]').length;
const btn = document.querySelector('#library button[aria-label^="Share"]');
const row = btn.closest("li").getBoundingClientRect(), b = btn.getBoundingClientRect();
r.iconInsideRow = b.right <= row.right + 1 && b.left > row.left;
await shot(false);
// First attempt: the browser refuses (tap too long ago); second tap shares.
const shared = [];
let calls = 0;
Object.defineProperty(navigator, "userAgentData", { value: { mobile: true }, configurable: true });
navigator.canShare = () => true;
navigator.share = async ({ files }) => { calls++; if (calls === 1) throw new DOMException("no activation", "NotAllowedError"); shared.push(files[0]); };
const statuses = [];
const obs = new MutationObserver(() => statuses.push($("library-status").textContent));
obs.observe($("library-status"), { childList: true, characterData: true, subtree: true });
btn.click();
await waitFor(() => /Tap share again/.test($("library-status").textContent), 30000, "retry prompt");
btn.click();
await waitFor(() => shared.length, 10000, "shared");
r.statuses = [...new Set(statuses.filter(Boolean))];
r.file = shared[0].name;
r.stayedOnHome = !$("home").hidden;
window.result = r;
