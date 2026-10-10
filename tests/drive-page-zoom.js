// Tapping a page thumbnail on the scan screen shows the page full-screen;
// Rotate there turns that page; Done or Back closes it.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(500);
document.querySelector("#library-empty .try-sample").click();
await waitFor(() => document.querySelectorAll("#pages img").length === 3 && !$("recognise").disabled, 30000, "sample pages");
document.querySelectorAll("#pages img")[1].click();
await sleep(400);
const img = $("page-zoom-img");
const r = { open: !$("page-zoom").hidden, label: $("page-zoom-num").textContent, size: [img.naturalWidth, img.naturalHeight] };
await shot(false);
$("page-zoom-rotate").click();
await waitFor(() => img.naturalWidth && img.naturalWidth > img.naturalHeight, 10000, "rotated");
r.rotated = [img.naturalWidth, img.naturalHeight];
await sleep(300);
await shot(false);
history.back();
await sleep(500);
r.closedByBack = $("page-zoom").hidden && !$("scan").hidden;
const thumb = document.querySelectorAll("#pages img")[1];
await waitFor(() => thumb.complete && thumb.naturalWidth, 5000, "thumb");
r.thumbRotated = thumb.naturalWidth > thumb.naturalHeight;
window.result = r;
