// About page: opens from home and from a score's settings, shows version,
// licence + source link and credits; back closes it. Run against /index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const pages = [await (await fetch("/testdata/huron_0.musicxml")).text()];
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "h", title: "Huron", created: 1, pages, images: [], mine: 2 }); tx.oncomplete = res; }; });
$("new-scan").click(); history.back(); await sleep(400);
const r = {};
document.querySelector("#home .about-open").click(); await sleep(200);
const links = [...$("about").querySelectorAll("a")].map((a) => a.href);
r.fromHome = { open: !$("about").hidden, version: $("about-version").textContent, agpl: links.some((l) => l.includes("agpl-3.0")), source: links.includes("https://github.com/pzfreo/partsong"), credits: $("about").querySelectorAll(".credits li").length };
await shot(false);
history.back(); await sleep(300);
r.backCloses = $("about").hidden && !$("home").hidden;
await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
await sleep(400);
$("settings").click(); await sleep(300);
document.querySelector("#panel .about-open").click(); await sleep(200);
r.fromSettings = !$("about").hidden;
$("about-close").click(); await sleep(300);
r.closeKeepsScore = $("about").hidden && !$("practice").hidden;
window.result = r;
