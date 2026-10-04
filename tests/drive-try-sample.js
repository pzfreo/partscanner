// "Try a sample score" opens the scan screen with the sample's three pages and
// name, then reads it. Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
await sleep(500);
const r = { shownWhenEmpty: !$("library-empty").hidden };
await shot(false);
document.querySelector("#library-empty .try-sample").click();
await waitFor(() => document.querySelectorAll("#pages img").length === 3 && !$("recognise").disabled, 30000, "sample pages");
r.scan = { pages: document.querySelectorAll("#pages img").length, name: $("scan-name").value, status: $("status").textContent };
await shot(false);
$("recognise").click();
await waitFor(() => !$("practice").hidden, 900000, "read");
const rows = [...document.querySelectorAll("#lines li")];
r.read = {
  title: $("title").value, bars: $("to-bar").value,
  parts: rows.map((li) => `${li.querySelector(".pick span").textContent}${li.querySelector(".include input").checked ? "" : " (off)"}${li.querySelector('input[type="radio"]').checked ? " *" : ""}`),
  repeats: [...$("repeat-list").children].map((li) => `${li.querySelector("span").textContent} -> ${li.querySelector("input").value}`),
  tenor: rows.find((li) => li.querySelector(".pick span").textContent === "Tenor")?.querySelector(".range").textContent,
};
history.back(); history.back(); await sleep(600);
r.footerLinkWhenNotEmpty = !!document.querySelector("#home .report-link .try-sample") && $("library-empty").hidden;
window.result = r;
