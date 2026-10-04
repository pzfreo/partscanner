// Repeats: the Tallis (testdata/tallis_0..2, as read by the app) has a repeat
// at bar 26 with 1st/2nd endings; the reader missed its start (bar 14), so it
// defaults to bar 1. Correct it to 14 in settings, play bars 24-27 fast and
// watch the counter: 24 25 26 24 25 27. Pausing on the second time through
// and resuming carries on to 27, not back round; a loop repeats the whole
// order. Run against /index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const pages = await Promise.all([0, 1, 2].map((i) => fetch(`/testdata/tallis_${i}.musicxml`).then((r) => r.text())));
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "t", title: "Tallis", created: 1, pages, images: [], mine: 0 }); tx.oncomplete = res; }; });
$("new-scan").click(); history.back(); await sleep(400);
await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
await waitFor(() => !$("practice").hidden, 5000, "practice");
await sleep(300);
const r = {};
const rows = () => [...$("repeat-list").children].map((li) => `${li.querySelector("span").textContent} -> ${li.querySelector("input").value}`);
r.shown = !$("repeats").hidden; r.before = rows();
const input = $("repeat-list").querySelector("input");
input.value = "14"; input.onchange();
r.after = rows();
$("tempo").value = "180"; $("tempo").oninput();
$("from-bar").value = "24"; $("to-bar").value = "27"; $("from-bar").onchange();
const seen = [];
const watch = () => { const b = $("position").textContent.replace("Bar ", ""); if (seen.at(-1) !== b) seen.push(b); };
$("play").click();
await waitFor(() => { watch(); return !$("play").classList.contains("playing"); }, 20000, "end");
r.order = seen.join(" ");
// Pause on the second time through bar 24, then resume.
seen.length = 0;
$("play").click();
await waitFor(() => { watch(); return seen.join(" ").startsWith("24 25 26 24"); }, 15000, "second pass");
$("play").click(); await sleep(500);
r.pausedAt = $("position").textContent;
$("play").click();
await waitFor(() => { watch(); return !$("play").classList.contains("playing"); }, 15000, "end 2");
r.resumed = seen.join(" ");
// Saved with the score.
const entry = await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const g = q.result.transaction("scores").objectStore("scores").get("t"); g.onsuccess = () => res(g.result); }; });
r.saved = entry.repeats;
$("play-repeats").click();
seen.length = 0; $("play").click();
await waitFor(() => { watch(); return !$("play").classList.contains("playing"); }, 15000, "end 3");
r.repeatsOff = seen.join(" ");
// Loop bars 25-27 with repeats on: each time round is 25 26 25 27.
$("play-repeats").click();
$("from-bar").value = "25"; $("to-bar").value = "27"; $("loop").checked = true; $("loop").onchange();
seen.length = 0; $("play").click();
await waitFor(() => { watch(); return seen.length >= 9; }, 20000, "loop");
$("play").click();
r.loop = seen.slice(0, 9).join(" ");
window.result = r;
