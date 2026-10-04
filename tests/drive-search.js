// Library search: hidden for a short library, shown from 6 scores; every word
// must match the title, ignoring case and accents; "No scores match" when
// nothing does; deleting down to 5 hides it and clears the query.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const titles = ["Messiah: Hallelujah chorus", "Messiah: And the glory", "Fauré Requiem: Pie Jesu", "If ye love me", "Huron Carol", "Zadok the Priest", "Ave verum corpus"];
const pages = [await (await fetch("/testdata/huron_0.musicxml")).text()];
const put = (list) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); list.forEach((t, i) => tx.objectStore("scores").put({ id: "s" + i, title: t, created: i, pages, images: [] })); tx.oncomplete = res; }; });
const home = async () => { $("new-scan").click(); history.back(); await sleep(400); };
const visible = () => [...$("library").children].filter((li) => !li.hidden).map((li) => li.dataset.title);
const search = async (q) => { $("library-search").value = q; $("library-search").oninput(); await sleep(50); return visible(); };
const r = {};
await put(titles.slice(0, 5)); await home();
r.hiddenWith5 = $("library-search").hidden;
await put(titles); await home();
r.shownWith7 = !$("library-search").hidden;
r.messiah = await search("messiah");
r.twoWords = await search("hall messiah");
r.accent = await search("faure pie");
r.none = await search("brahms"); r.noneMsg = !$("library-none").hidden;
r.cleared = (await search("")).length;
await search("messiah"); await home();
r.keptAfterRerender = visible();
await shot(false);
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").delete("s5"); tx.objectStore("scores").delete("s6"); tx.oncomplete = res; }; });
await home();
r.after5 = { hidden: $("library-search").hidden, value: $("library-search").value, shown: visible().length };
window.result = r;
