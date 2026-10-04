// "Try a sample score" opens the scan screen with the sample's two pages and
// name, then reads it. Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(500);
const r = { shownWhenEmpty: !$("library-empty").hidden };
await shot(false);
document.querySelector("#library-empty .try-sample").click();
await waitFor(() => document.querySelectorAll("#pages img").length === 2 && !$("recognise").disabled, 30000, "sample pages");
r.scan = { pages: document.querySelectorAll("#pages img").length, name: $("scan-name").value, status: $("status").textContent };
await shot(false);
$("recognise").click();
await waitFor(() => !$("practice").hidden, 400000, "read");
r.read = { title: $("title").value, bars: $("to-bar").value, parts: [...document.querySelectorAll("#lines .pick span:first-of-type")].map((s) => s.textContent) };
history.back(); history.back(); await sleep(600);
r.footerLinkWhenNotEmpty = !!document.querySelector("#home .report-link .try-sample") && $("library-empty").hidden;
window.result = r;
