// Follow-along on the photos: seeds the library with testdata/huron_0..3
// (png + musicxml), then checks highlight, playhead, note marker, auto-scroll
// and tap-to-pick-bar. Run against http://localhost:8765/index.html.
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
const visible = (p, cls) => { const el = d.querySelectorAll(".photo-list .page")[p]?.querySelector("." + cls); return el && el.style.display !== "none"; };
const r = {};
await waitFor(() => visible(0, "bar"), 10000, "bar 1 highlight");
r.pages = d.querySelectorAll(".photo-list .page").length;
r.bar1Highlighted = visible(0, "bar");
$("from-bar").value = 23; $("from-bar").onchange();
r.from23OnPage2 = visible(1, "bar") && !visible(0, "bar");
$("tempo").value = 60; $("tempo").oninput();
const scrollBefore = w.scrollY;
$("play").click();
await sleep(2500);
r.playheadOnPage2 = visible(1, "playhead");
r.noteMarker = visible(1, "note");
r.position = $("position").textContent;
r.scrolled = w.scrollY > scrollBefore;
const ph = d.querySelectorAll(".photo-list .page")[1].querySelector(".playhead");
const nm = d.querySelectorAll(".photo-list .page")[1].querySelector(".note");
r.playheadX = Math.round(ph.getAttribute("x1")); r.noteAt = [Math.round(nm.getAttribute("cx")), Math.round(nm.getAttribute("cy"))];
await shot(false);
$("play").click();
// Tap the middle of bar 30's highlight box.
$("from-bar").value = 30; $("from-bar").onchange();
const box = d.querySelectorAll(".photo-list .page")[1].querySelector(".bar").getBoundingClientRect();
$("from-bar").value = 1; $("from-bar").onchange();
const svg = d.querySelectorAll(".photo-list svg")[1];
svg.dispatchEvent(new w.MouseEvent("click", { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true }));
r.tappedFromBar = $("from-bar").value;
r.panelClosedForConfiguredScore = $("panel").hidden;
// Pause resumes where it stopped; rewind goes back to the start bar.
$("from-bar").value = 23; $("from-bar").onchange();
$("tempo").value = 120; $("tempo").oninput();
const bar = () => Number($("position").textContent.replace(/\D/g, ""));
$("play").click(); await sleep(2100);
$("play").click(); const paused = bar();
await sleep(1000); r.heldWhilePaused = bar() === paused;
$("play").click(); await sleep(2100);
r.resumed = [paused, bar()];
$("rewind").click(); await sleep(300);
r.rewoundTo = bar();
$("play").click(); await sleep(200);
await shot(false);
$("settings").click(); await sleep(400);
r.panelOpens = !$("panel").hidden && d.querySelector(".panel").getBoundingClientRect().top < w.innerHeight - 100;
await shot(false);
$("settings").click();
window.result = r;
