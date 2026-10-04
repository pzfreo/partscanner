// PDF import: testdata/huron.pdf (4 pages) -> page images -> read -> parts.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const r = {};
$("new-scan").click();
const pdf = new File([await (await fetch("/testdata/huron.pdf")).blob()], "Huron Carol.pdf", { type: "application/pdf" });
const dt = new DataTransfer(); dt.items.add(pdf);
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
const imgs = () => [...document.querySelectorAll("#pages img")];
await waitFor(() => imgs().length === 4 && imgs().every((i) => i.complete && i.naturalWidth), 60000, "4 pdf pages");
r.pages = imgs().length;
r.sizes = imgs().map((i) => `${i.naturalWidth}x${i.naturalHeight}`);
r.name = $("scan-name").value;
r.status = $("status").textContent;
await shot(false);
$("recognise").click();
await waitFor(() => !$("practice").hidden, 400000, "recognition");
r.title = $("title").value;
r.bars = $("to-bar").value;
r.lines = [...document.querySelectorAll("#lines .pick span:first-of-type")].map((s) => s.textContent);
r.follow = !$("follow").hidden;
window.result = r;
