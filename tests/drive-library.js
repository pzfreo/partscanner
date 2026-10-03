// Library persistence: legacy localStorage migration, photos saved with the
// recognised score, settings surviving a reload, delete. Each step loads the
// app fresh in an iframe. Needs testdata/huron_1.png and huron_1.musicxml.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
async function freshApp() {
  document.querySelector("iframe")?.remove();
  const f = document.createElement("iframe");
  f.style.cssText = "width:412px;height:900px;border:0";
  f.src = "/index.html?" + Math.random();
  document.body.append(f);
  await waitFor(() => f.contentWindow.document.getElementById("library") && f.contentWindow.document.readyState === "complete", 20000, "app");
  await sleep(800);
  const w = f.contentWindow;
  return { w, $: (id) => w.document.getElementById(id), names: () => [...w.document.querySelectorAll("#library .name")].map((n) => n.textContent) };
}
const r = {};
const xml = await (await fetch("/testdata/huron_1.musicxml")).text();
localStorage.setItem("partscanner.library.v1", JSON.stringify([{ id: "legacy-1", title: "Legacy score", created: 1, pages: [xml], tempo: 66 }]));

let app = await freshApp();
r.migrated = app.names();
r.legacyKeyRemoved = localStorage.getItem("partscanner.library.v1") === null;

app.$("new-scan").click();
const blob = await (await fetch("/testdata/huron_1.png")).blob();
const dt = new app.w.DataTransfer(); dt.items.add(new app.w.File([blob], "p.png", { type: "image/png" }));
app.$("gallery").files = dt.files; app.$("gallery").dispatchEvent(new app.w.Event("change"));
app.$("recognise").click();
await waitFor(() => !app.$("practice").hidden, 300000, "recognition");
app.$("title").value = "Huron p2"; app.$("title").dispatchEvent(new app.w.Event("change"));
app.$("tempo").value = 100; app.$("tempo").dispatchEvent(new app.w.Event("change"));
await sleep(500);

app = await freshApp();
r.afterReload = app.names();
r.thumbs = app.w.document.querySelectorAll("#library .thumb img").length;
await shot();
[...app.w.document.querySelectorAll("#library button")].find((b) => b.textContent.includes("Huron p2")).click();
await sleep(300);
r.tempoKept = app.$("tempo").value;
r.photosShown = !app.$("photos").hidden;
app.$("photos").open = true;
r.photoWidth = await waitFor(() => app.w.document.querySelector("#photo-list img")?.naturalWidth, 10000, "photo");
r.lines = [...app.w.document.querySelectorAll("#lines .pick span:first-of-type")].map((s) => s.textContent);
await shot();
app.$("back").click();
await sleep(300);
[...app.w.document.querySelectorAll("#library button")].find((b) => b.textContent.includes("Legacy")).click();
await sleep(300);
r.legacyTempo = app.$("tempo").value;
r.legacyPhotosHidden = app.$("photos").hidden;
app.$("delete").click(); app.$("delete").click();
await sleep(800);
app = await freshApp();
r.afterDelete = app.names();
window.result = r;
