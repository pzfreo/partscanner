// Mark your part: on every system of every page, tapping the middle of each
// staff marks a line on that staff, and the shading covers that staff.
// Reads the sample, or ?markpdf=/path.pdf. Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const db = await import("/db.js");
const sc = await import("/score.js");
await sleep(500);
const pdfPath = new URLSearchParams(location.search).get("markpdf");
if (pdfPath) {
  const pdf = new File([await (await fetch(pdfPath)).blob()], "score.pdf", { type: "application/pdf" });
  const dt = new DataTransfer(); dt.items.add(pdf);
  $("open-xml").files = dt.files; $("open-xml").dispatchEvent(new Event("change"));
} else {
  document.querySelector("#library-empty .try-sample").click();
  await waitFor(() => document.querySelectorAll("#pages img").length === 3 && !$("recognise").disabled, 30000, "sample pages");
  $("recognise").click();
}
await waitFor(() => !$("practice").hidden, 1500000, "read");
const entry = await waitFor(async () => (await db.all()).find((e) => !e.pending && e.pages?.every(Boolean)), 30000, "saved");
const score = sc.buildScore(entry.pages.map(sc.parsePage));
const svgs = [...document.querySelectorAll("#photo-list .page svg")];
await waitFor(() => svgs.every((s) => s.getAttribute("viewBox")), 30000, "photos");
$("start-markup").click();
await sleep(300);
const r = { systems: score.systems.length, staves: 0, failures: [], labelled: [] };
for (const sys of score.systems) {
  if (!sys.box) continue;
  const svg = svgs[sys.page];
  const [, , w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
  for (const st of sys.staves) {
    r.staves++;
    // Already marked by a tap on the same staff in a system the reader split
    // this row into (one tap marks it in each): tapping again would unmark.
    const before = (await db.all()).find((e) => e.id === entry.id).manual?.[sys.index];
    if (st.lines.includes(Number(before)) && sys.index > 0) continue;
    const x = (sys.box.x0 + sys.box.x1) / 2;
    const y = (st.y0 + st.y1) / 2;
    const rect = svg.getBoundingClientRect();
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: rect.left + (x / w) * rect.width, clientY: rect.top + (y / h) * rect.height }));
    await sleep(60);
    const marked = (await db.all()).find((e) => e.id === entry.id).manual?.[sys.index];
    const shaded = [...svg.querySelectorAll("rect.mark")].some((m) => +m.getAttribute("y") <= y && y <= +m.getAttribute("y") + +m.getAttribute("height"));
    const label = [...svg.querySelectorAll("text.mark-label")].some((t) => Math.abs(+t.getAttribute("y") - st.y0) < h * 0.03);
    if (label) r.labelled.push(`${st.key}${st.lines.length > 1 ? "" : ` (one voice!) sys ${sys.index} y ${Math.round(st.y0)}`}`);
    if (!st.lines.includes(Number(marked)) || !shaded)
      r.failures.push({ sys: sys.index, page: sys.page + 1, staff: st.key, y: Math.round(y), lines: st.lines, marked, shaded });
  }
}
r.layout = score.systems.map((y) => `p${y.page + 1} bars ${y.bars[0].number}-${y.bars.at(-1).number}: ${y.staves.map((st) => `${st.key} ${Math.round(st.y0)}-${Math.round(st.y1)}`).join(" | ")}`);
r.parts = score.lines.map((l) => `${l.id} ${l.label} ${l.staffKey} ${l.voice}`);
window.result = r;
