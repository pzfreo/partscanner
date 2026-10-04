// The back arrow only shows off the home screen, and nothing marked hidden is
// displayed (CSS display rules can override the hidden attribute).
// Seeds Huron from testdata. Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const pages = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
const images = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.png`).then((r) => r.blob())));
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "hur", title: "Huron", created: 1, pages, images, mine: 2 }); tx.oncomplete = res; }; });
const backShown = () => getComputedStyle($("back")).display !== "none";
const leaks = () => [...document.querySelectorAll("[hidden]")].filter((el) => !el.classList.contains("panel") && getComputedStyle(el).display !== "none").map((el) => el.id || el.className || el.tagName);
const r = {};
r.home = { back: backShown(), leaks: leaks() };
$("new-scan").click(); await sleep(300);
r.scan = { back: backShown(), leaks: leaks() };
history.back(); await sleep(400);
await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
await waitFor(() => document.querySelectorAll(".photo-list svg[viewBox]").length >= 4, 10000, "practice");
r.practice = { back: backShown(), leaks: leaks() };
$("back").click(); await sleep(400);
r.homeAgain = { back: backShown(), onHome: !$("home").hidden };
window.result = r;
