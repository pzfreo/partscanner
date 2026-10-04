// Bug report: from a score's settings, the report carries the description and
// diagnostics in an email to bugs@partsong.app; back closes it; home link works.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const pages = [await (await fetch("/testdata/huron_0.musicxml")).text()];
const images = [await (await fetch("/testdata/huron_0.png")).blob()];
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "h", title: "Huron", created: 1, pages, images, mine: 2 }); tx.oncomplete = res; }; });
$("new-scan").click(); history.back(); await sleep(400);
await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
await sleep(500);
$("from-bar").value = 7; $("from-bar").onchange();
$("settings").click(); await sleep(300);
document.querySelector("#panel .report-open").click(); await sleep(200);
const r = { open: !$("report").hidden };
const diag = $("report-diag").textContent;
r.diagHas = ["Partsong", "Score: \"Huron\"", "Position: Bar 7", "Parts:", "On: practice"].map((k) => [k, diag.includes(k)]);
$("report-text").value = "Altos get the soprano run in bar 20\nmore detail";
await shot(false);
$("report-send").click(); await sleep(300);
const href = $("report-send").dataset.href;
const u = new URL(href);
r.mail = { to: u.pathname, subject: u.searchParams.get("subject"), bodyStarts: u.searchParams.get("body").slice(0, 40), bodyHasDiag: u.searchParams.get("body").includes("Score: \"Huron\"") };
r.stillHere = !$("practice").hidden;
history.back(); await sleep(400);
r.backClosesReportOnly = $("report").hidden && !$("practice").hidden;
$("back").click(); await sleep(500);
document.querySelector("#home .report-open").click(); await sleep(200);
r.homeLink = !$("report").hidden && $("report-diag").textContent.includes("On: home");
$("report-close").click(); await sleep(300);
r.cancelCloses = $("report").hidden && !$("home").hidden;
window.result = r;
