// Follow-along on the As read (OSMD) view. Seeds Huron from testdata.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const pages = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
const images = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob())));
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "hur", title: "Huron", created: 1, pages, images, mine: 2 }); tx.oncomplete = res; }; });
$("new-scan").click(); history.back(); await sleep(400);
await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
await sleep(500);
$("view-read").click();
await waitFor(() => document.querySelectorAll("#osmd svg").length >= 4, 30000, "osmd");
await sleep(300);
const marks = (cls) => [...document.querySelectorAll(".read-page")].map((p) => !p.querySelector("." + cls).hidden);
const r = {};
r.bar1 = marks("read-bar");
$("from-bar").value = 23; $("from-bar").onchange(); await sleep(100);
r.bar23 = marks("read-bar");
$("tempo").value = 60; $("tempo").oninput();
const scrollBefore = scrollY;
$("play").click(); await sleep(600);
const ph = () => document.querySelectorAll(".read-page")[1].querySelector(".read-playhead");
const x1 = parseFloat(ph().style.left);
await sleep(700);
const x2 = parseFloat(ph().style.left);
r.playheadMoves = [Math.round(x1), Math.round(x2)];
r.scrolled = scrollY > scrollBefore;
r.position = $("position").textContent;
await shot(false);
$("play").click(); await sleep(200);
// Tap the middle of the highlighted bar 30.
$("from-bar").value = 30; $("from-bar").onchange(); await sleep(100);
const hb = document.querySelectorAll(".read-page")[1].querySelector(".read-bar").getBoundingClientRect();
$("from-bar").value = 1; $("from-bar").onchange(); await sleep(100);
document.querySelectorAll(".read-page")[1].dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: hb.left + hb.width / 2, clientY: hb.top + hb.height / 2 }));
r.tapSetsFrom = $("from-bar").value;
window.result = r;
