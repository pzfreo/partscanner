// Back-button history and photo orientation. Needs testdata/cam_*_exif*.jpg
// (sensor-layout photos with EXIF tags) and huron_1.musicxml/png.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const screen = () => ["home", "scan", "practice"].find((s) => !$(s).hidden);
const back = async () => { history.back(); await sleep(400); };
const file = async (name) => new File([await (await fetch(`/testdata/${name}`)).blob()], name, { type: "image/jpeg" });
const addPhotos = async (names) => {
  const dt = new DataTransfer();
  for (const n of names) dt.items.add(await file(n));
  $("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
};
const thumbs = () => [...document.querySelectorAll("#pages img")];
const portrait = (img) => img.naturalHeight > img.naturalWidth;
const r = {};

// Orientation: a flat-phone photo (EXIF 1) is straightened; a normal portrait shot is left alone.
$("new-scan").click();
await addPhotos(["cam_0_exif1.jpg", "cam_1_exif6.jpg"]);
await waitFor(() => thumbs().length === 2 && thumbs().every((i) => i.complete && i.naturalWidth), 10000, "thumbs");
r.bothPortrait = thumbs().every(portrait);
document.querySelectorAll("#pages .rotate")[1].click();
await waitFor(() => thumbs()[1].naturalWidth && !portrait(thumbs()[1]), 10000, "rotated");
r.rotateTurnsIt = true;
await back();
r.backFromScan = screen();

// Seed a score, then: library -> practice (+panel) -> back closes panel -> back home.
const xml = await (await fetch("/testdata/huron_1.musicxml")).text();
const img = await (await fetch("/testdata/huron_1.png")).blob();
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "nav", title: "Nav test", created: 1, pages: [xml], images: [img] }); tx.oncomplete = res; }; });
$("new-scan").click(); await back();
await waitFor(() => document.querySelector("#library button"), 5000, "library");
document.querySelector("#library button").click(); await sleep(300);
r.newScoreOpensPanel = screen() === "practice" && !$("panel").hidden;
await back();
r.backClosesPanel = screen() === "practice" && $("panel").hidden;
await back();
r.backAgainHome = screen();
document.querySelector("#library button").click(); await sleep(300);
if ($("panel").hidden) $("settings").click();
$("back").click(); await sleep(500);
r.headerBackWithPanelHome = screen();
r.historyAtStart = history.state === null;

// Read a sideways photo; afterwards back goes home, not to the scan screen.
$("new-scan").click();
await addPhotos(["cam_1_exif3.jpg"]);
await waitFor(() => thumbs().length === 1 && thumbs()[0].naturalWidth, 10000, "thumb");
r.exif3Portrait = portrait(thumbs()[0]);
$("recognise").click();
await waitFor(() => screen() === "practice", 300000, "recognition");
r.linesFromRotatedPhoto = [...document.querySelectorAll("#lines .pick span:first-of-type")].map((s) => s.textContent);
r.followShown = !$("follow").hidden;
await back(); // closes the auto-opened panel
await back();
r.afterReadBackHome = screen();
window.result = r;
