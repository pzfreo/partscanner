// Usage counts: with GoatCounter stubbed, opening a score and pressing play
// several times counts one "play"; Try a sample counts "sample". Nothing sent
// carries a score title. Run against http://localhost:8765/index.html.
const events = []; window.goatcounter = { count: (e) => events.push(e) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const idx = [0, 1, 2, 3];
const entry = {
  id: "follow-test", title: "Follow test", created: Date.now(), mine: 1,
  pages: await Promise.all(idx.map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text()))),
  images: await Promise.all(idx.map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob()))),
};
await new Promise((res, rej) => {
  const q = indexedDB.open("partscanner", 1);
  q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" });
  q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put(entry); tx.oncomplete = res; tx.onerror = rej; };
});
const w = window, d = document, $ = (id) => d.getElementById(id);
$("back").click(); // re-render the library with the seeded score
await waitFor(() => d.querySelector("#library button"), 20000, "library");
d.querySelector("#library button").click();
await waitFor(() => !$("practice").hidden, 20000, "practice");
await sleep(500);
for (let i = 0; i < 4; i++) { $("play").click(); await sleep(300); }
$("play").click();
history.go(-10); await sleep(400); if ($("home").hidden) { $("back").click(); await sleep(300); }
d.querySelector("#home .try-sample").click(); await sleep(500);
window.result = { events, leaksTitle: JSON.stringify(events).includes(entry.title) };
