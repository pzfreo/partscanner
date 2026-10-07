// Open PDF with ordinary sheet music: it's read as a new scan straight away,
// no Read music tap needed. Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(500);
const r = { label: $("open-xml").parentElement.textContent.trim() };
const pdf = new File([await (await fetch("/testdata/huron.pdf")).blob()], "Huron.pdf", { type: "application/pdf" });
const dt = new DataTransfer(); dt.items.add(pdf);
$("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
await waitFor(() => /Page 1 of 4/.test($("status").textContent), 60000, "reading started");
r.started = { screen: !$("scan").hidden, pages: document.querySelectorAll("#pages img").length, name: $("scan-name").value };
await shot(false);
await waitFor(() => !$("practice").hidden, 900000, "read");
r.read = { title: $("title").value, bars: $("to-bar").value };
window.result = r;
