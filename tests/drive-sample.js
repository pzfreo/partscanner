// The sample score: import samples/joyful-joyful.pdf, read it, and compare the
// four parts with the source MusicXML it was engraved from (ground truth).
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const { parsePage, buildScore } = await import("/score.js");
const truth = buildScore([parsePage(await (await fetch("/samples/joyful-joyful.musicxml")).text())]);
$("new-scan").click();
const pdf = new File([await (await fetch("/samples/joyful-joyful.pdf")).blob()], "joyful-joyful.pdf", { type: "application/pdf" });
const dt = new DataTransfer(); dt.items.add(pdf);
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
await waitFor(() => document.querySelectorAll("#pages img").length === 2 && !$("recognise").disabled, 30000, "pages");
$("recognise").click();
await waitFor(() => !$("practice").hidden, 400000, "read");
// Rebuild what the app read, from the saved score.
const entry = await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").getAll(); g.onsuccess = () => res(g.result[0]); }; });
const read = buildScore(entry.pages.map(parsePage));
const r = { bars: [read.measures.length, truth.measures.length], labels: read.lines.map((l) => l.label) };
// Note-level comparison per part: same pitch at the same time.
const key = (n) => `${n.t}:${n.midi}`;
for (const name of ["Soprano", "Alto", "Tenor", "Bass"]) {
  const a = truth.lines.find((l) => l.label === name), b = read.lines.find((l) => l.label === name);
  if (!b) { r[name] = "missing"; continue; }
  const want = new Set(a.notes.map(key)), got = new Set(b.notes.map(key));
  const hit = [...want].filter((k) => got.has(k)).length;
  r[name] = { notes: want.size, correct: hit, extra: got.size - hit, pct: Math.round((100 * hit) / want.size) };
}
window.result = r;
