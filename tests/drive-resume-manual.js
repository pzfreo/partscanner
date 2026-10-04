// A scan that already failed to resume twice isn't resumed automatically; the
// library shows its progress and tapping it continues. Run with host page
// http://localhost:8765/testdata/ (the app is launched fresh in an iframe).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const blobs = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob())));
const xmls = await Promise.all([0, 1].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "stuck", title: "Stuck scan", created: 1, images: blobs, pages: [...xmls, null, null], pending: true, resumes: 2 }); tx.oncomplete = res; }; });
const f = document.createElement("iframe");
f.style.cssText = "width:412px;height:900px;border:0";
f.src = "/index.html";
document.body.prepend(f);
await waitFor(() => f.contentWindow.document.querySelector("#library small"), 20000, "launched");
const d = f.contentWindow.document, $ = (id) => d.getElementById(id);
await sleep(2000); // give a (wrong) auto-resume time to kick in
const r = {};
r.stayedHome = !$("home").hidden;
r.label = d.querySelector("#library small").textContent;
d.querySelector("#library button").click();
const seen = [];
await waitFor(() => { const m = $("status").textContent.match(/Page \d of 4/); if (m && seen.at(-1) !== m[0]) seen.push(m[0]); return !$("practice").hidden; }, 300000, "finished");
r.read = seen;
r.bars = $("to-bar").value;
window.result = r;
