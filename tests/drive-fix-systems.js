// Fix systems: on a page the reader grouped wrongly, tap the top and bottom
// staff of each system; Read again reads that page (only) with those systems,
// and the bands are kept with the score. Uses ?fixpdf= (default: There was a
// tree, page 1, whose piano the reader leaves out of the choir's systems).
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const db = await import("/db.js");
const sc = await import("/score.js");
await sleep(500);
const pdfPath = new URLSearchParams(location.search).get("fixpdf") || "/testdata/tree.pdf";
const pdf = new File([await (await fetch(pdfPath)).blob()], "score.pdf", { type: "application/pdf" });
const dt = new DataTransfer(); dt.items.add(pdf);
$("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
await waitFor(() => !$("practice").hidden, 1500000, "read");
const saved = async () => waitFor(async () => (await db.all()).find((e) => !e.pending && e.pages?.every(Boolean)), 30000, "saved");
let entry = await saved();
const layout = (e) => sc.buildScore(e.pages.map(sc.parsePage)).systems.filter((s) => s.page === 0).map((s) => s.staves.length);
const r = { before: layout(entry), pagesBefore: entry.pages.slice() };
const svgs = [...document.querySelectorAll("#photo-list .page svg")];
await waitFor(() => svgs[0].getAttribute("viewBox"), 30000, "photo");
$("start-fix").click();
await sleep(300);
r.bar = !$("fix-bar").hidden;
const svg = svgs[0];
const [, , w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
const tap = (y) => {
  const rc = svg.getBoundingClientRect();
  svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rc.left + 0.5 * rc.width, clientY: rc.top + (y / h) * rc.height }));
};
// Top and bottom staff of each system on page 1 (photo coordinates).
for (const [top, bottom] of [[605, 1380], [1720, 2050], [2390, 2870]]) { tap(top); tap(bottom); }
await sleep(200);
r.bands = svg.querySelectorAll("rect.fix-band").length;
r.outlines = svg.querySelectorAll("rect.fix-current").length;
await shot(false);
$("fix-done").click();
await waitFor(() => !$("scan").hidden, 5000, "reading");
await waitFor(() => !$("practice").hidden, 900000, "read again");
await sleep(500);
entry = await saved();
r.after = layout(entry);
r.hints = entry.systemHints && Object.keys(entry.systemHints);
r.otherPagesKept = entry.pages.slice(1).every((x, i) => x === r.pagesBefore[i + 1]);
r.page1Changed = entry.pages[0] !== r.pagesBefore[0];
delete r.pagesBefore;
window.result = r;
