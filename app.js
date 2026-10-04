import { buildScore, parsePage } from "./score.js";
import { Player } from "./player.js";
import * as db from "./db.js";
import { rotateBlob, uprightPhoto } from "./orient.js";
import { isPdf, pdfPages } from "./pdf-pages.js";

const $ = (id) => document.getElementById(id);
const OSMD_URL = "https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@2.2.0/build/opensheetmusicdisplay.min.js";
const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

// ---------- library (per-device, in IndexedDB; see db.js) ----------

const updateEntry = (id, changes) => db.update(id, changes).catch((e) => console.error("save failed", e));

// Object URLs for photos currently on screen, released when re-rendered.
const photoUrls = { library: [], practice: [] };
function photoUrl(group, blob) {
  const url = URL.createObjectURL(blob);
  photoUrls[group].push(url);
  return url;
}
function releasePhotos(group) {
  photoUrls[group].forEach((u) => URL.revokeObjectURL(u));
  photoUrls[group] = [];
}

// ---------- navigation ----------

const screens = ["home", "scan", "practice"];
// Each screen (and the open settings panel) is a history entry, so the phone's
// back button steps back through the app instead of leaving it.
// nav: "push" a new entry, "replace" the current one, or "none" (from popstate).
function show(name, nav = "push") {
  for (const s of screens) $(s).hidden = s !== name;
  $("back").hidden = name === "home";
  if (name !== "practice") {
    player?.stop();
    endMarkup(false);
    releasePhotos("practice");
    $("photo-list").replaceChildren();
    $("panel").hidden = true;
  }
  if (name === "home") renderLibrary();
  if (name !== "home" && nav === "push") history.pushState({ screen: name }, "");
  if (name !== "home" && nav === "replace") history.replaceState({ screen: name }, "");
  window.scrollTo(0, 0);
}

function goHome() {
  const depth = history.state?.panel || history.state?.markup ? 2 : history.state?.screen ? 1 : 0;
  if (depth) history.go(-depth);
  else show("home", "none");
}
$("back").onclick = goHome;

window.addEventListener("popstate", (e) => {
  if (e.state?.screen === "practice" && !$("practice").hidden) {
    setPanel(false, false);
    endMarkup(false);
  } else show("home", "none");
});

async function renderLibrary() {
  const lib = await db.all().catch(() => []);
  releasePhotos("library");
  $("library-empty").hidden = lib.length > 0;
  $("library").replaceChildren(
    ...lib
      .slice()
      .sort((a, b) => b.created - a.created)
      .map((entry) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        const n = entry.pages.length;
        const done = entry.pages.filter(Boolean).length;
        const info = entry.pending ? `Reading… ${done} of ${n}` : `${n} page${n > 1 ? "s" : ""}`;
        b.innerHTML = `<span class="thumb"></span><span class="name"></span><small>${info}</small>`;
        b.querySelector(".name").textContent = (entry.locked ? "🔒 " : "") + entry.title;
        if (entry.images?.length) {
          const img = document.createElement("img");
          img.alt = "";
          img.src = photoUrl("library", entry.images[0]);
          b.querySelector(".thumb").append(img);
        }
        b.onclick = () => (entry.pending ? resumeScan(entry) : openScore(entry));
        li.append(b);
        return li;
      }),
  );
}

// ---------- scanning ----------

let pages = []; // { blob, url }
let worker;
let workerReady;
const pending = new Map();
const download = new Map();

function startWorker() {
  if (worker) return;
  worker = new Worker("omr-worker.js", { type: "module" });
  workerReady = new Promise((resolve, reject) => {
    worker.onmessage = ({ data }) => {
      if (data.type === "progress" && data.stage === "download") {
        download.set(data.name, data);
        const loaded = [...download.values()].reduce((s, d) => s + d.loaded, 0);
        setEngineStatus(`Downloading music reader (once only): ${Math.round(loaded / 1e6)} / ${Math.round(data.total / 1e6)} MB`);
      } else if (data.type === "progress" && data.stage === "python") {
        setEngineStatus("Starting music reader…");
      } else if (data.type === "ready") {
        setEngineStatus("");
        resolve();
      } else if (data.type === "log") {
        console.log("[omr]", data.msg);
        const m = /Running TrOmr inference on staff image (\d+)/.exec(data.msg);
        if (m) setPageStatus(`reading staff ${Number(m[1]) + 1}`);
        else if (/Found \d+ connected staffs/.test(data.msg)) setPageStatus("found the staves");
      } else if (data.type === "result" || data.type === "error") {
        const p = pending.get(data.id);
        if (!p) return reject(new Error(data.msg));
        pending.delete(data.id);
        data.type === "result" ? p.resolve(data.xml) : p.reject(new Error(data.msg));
      }
    };
  });
  worker.postMessage({ type: "init" });
}

let engineStatus = "";
let pageStatus = "";
function setEngineStatus(s) {
  engineStatus = s;
  $("status").textContent = [engineStatus, pageStatus].filter(Boolean).join("\n");
}
let pageLabel = "";
function setPageStatus(s) {
  pageStatus = pageLabel ? `${pageLabel}: ${s}` : s;
  setEngineStatus(engineStatus);
}

// The scan being read is saved to the library page by page (pending: true),
// so if Android pauses or kills the tab, reading resumes from the next page.
let scanId = null;
let scanCreated = null;
let reading = false;

function loadScan(images = [], xmls = [], id = null, created = null, title = "") {
  pages.forEach((p) => URL.revokeObjectURL(p.url));
  pages = images.map((blob, i) => ({ blob, url: URL.createObjectURL(blob), xml: xmls[i] ?? undefined }));
  scanId = id;
  scanCreated = created;
  pageStatus = "";
  $("scan-name").value = title;
  renderPages();
  show("scan");
  startWorker();
}

$("new-scan").onclick = () => (reading ? show("scan") : loadScan());

function resumeScan(entry) {
  if (reading) return show("scan");
  loadScan(entry.images, entry.pages, entry.id, entry.created, entry.title);
  readScan();
}

// On launch, carry on with a scan that was interrupted, unless it has already
// been resumed twice without progress (e.g. the phone keeps running out of memory).
async function resumeUnfinished() {
  const entry = (await db.all().catch(() => [])).find((e) => e.pending);
  if (!entry || (entry.resumes ?? 0) >= 2) return;
  await db.update(entry.id, { resumes: (entry.resumes ?? 0) + 1 }).catch(() => {});
  resumeScan(entry);
}

function scanEntry(pending) {
  return {
    id: scanId,
    title: $("scan-name").value.trim() || `Scan ${new Date().toLocaleDateString()}`,
    created: scanCreated,
    images: pages.map((p) => p.blob),
    pages: pages.map((p) => p.xml ?? null),
    pending,
  };
}

$("discard-scan").onclick = async () => {
  if (reading) return;
  if (scanId) await db.remove(scanId).catch(() => {});
  loadScan();
  goHome();
};

// Keeps the screen on while reading; the lock lapses when the app is hidden,
// so it's taken again on return.
function keepAwake() {
  let lock = null;
  const acquire = async () => {
    if (document.visibilityState === "visible") lock = await navigator.wakeLock?.request("screen").catch(() => null);
  };
  document.addEventListener("visibilitychange", acquire);
  acquire();
  return () => {
    document.removeEventListener("visibilitychange", acquire);
    lock?.release().catch(() => {});
  };
}

async function addPage(image) {
  const blob = await uprightPhoto(image);
  pages.push({ blob, url: URL.createObjectURL(blob) });
  renderPages();
}

// Why a picked file can't be used, in words a user can act on.
async function unreadableReason(file) {
  if (file.size === 0) return "the file is empty. If it's in Google Photos or Drive, download it to the phone first";
  const head = String.fromCharCode(...new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (/ftyp(heic|heix|hevc|heif|mif1|msf1)/.test(head)) {
    return "it's a HEIC photo, which Chrome can't open. Use Take photo, or set the camera to save JPEG";
  }
  return "it isn't an image or PDF this browser can open";
}

async function addFiles(files) {
  const problems = [];
  for (const f of files) {
    const name = f.name || "file";
    if (await isPdf(f)) {
      if (!$("scan-name").value.trim()) $("scan-name").value = name.replace(/\.pdf$/i, "");
      try {
        await pdfPages(f, async (blob, n, count) => {
          setPageStatus(`Opening ${name}: page ${n} of ${count}`);
          await addPage(blob);
        });
      } catch (e) {
        problems.push(`Couldn't open ${name}: ${e.message}`);
      }
      continue;
    }
    try {
      await addPage(f);
    } catch {
      problems.push(`Couldn't add ${name}: ${await unreadableReason(f)}.`);
    }
  }
  setPageStatus(problems.join("\n"));
}

$("camera").onchange = (e) => {
  addFiles([...e.target.files]);
  e.target.value = "";
};
$("gallery").onchange = (e) => {
  addFiles([...e.target.files]);
  e.target.value = "";
};

function renderPages() {
  $("pages").replaceChildren(
    ...pages.map((p, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<img alt="Page ${i + 1}"><span class="num">${i + 1}</span>
        <button class="rotate" aria-label="Rotate page ${i + 1}">&#8635;</button>
        <button class="remove" aria-label="Remove page ${i + 1}">&times;</button>`;
      li.querySelector("img").src = p.url;
      li.querySelector(".rotate").onclick = async () => {
        p.blob = await rotateBlob(p.blob, 90);
        delete p.xml;
        URL.revokeObjectURL(p.url);
        p.url = URL.createObjectURL(p.blob);
        renderPages();
      };
      li.querySelector(".remove").onclick = () => {
        URL.revokeObjectURL(p.url);
        pages.splice(i, 1);
        renderPages();
      };
      return li;
    }),
  );
  $("recognise").disabled = pages.length === 0;
}

// Apply EXIF rotation and cap the size. homr autocrops before resizing to
// 1920 px wide, so keep typical phone resolution (~4000 px) intact.
async function normalise(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const scale = Math.min(1, 4200 / Math.max(bmp.width, bmp.height));
  const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();
}

let requestId = 0;
function recognisePage(image) {
  const id = ++requestId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: "recognise", id, image }, [image]);
  });
}

$("recognise").onclick = () => readScan();

async function readScan() {
  if (reading) return;
  reading = true;
  $("recognise").disabled = true;
  const release = keepAwake();
  scanId ??= crypto.randomUUID();
  scanCreated ??= Date.now();
  let saved = await db.put(scanEntry(true)).then(() => true, () => false);
  try {
    startWorker();
    await workerReady;
    const t0 = performance.now();
    for (let i = 0; i < pages.length; i++) {
      if (pages[i].xml) continue;
      pageLabel = `Page ${i + 1} of ${pages.length}`;
      setPageStatus("finding staves…");
      pages[i].xml = await recognisePage(await normalise(pages[i].blob));
      if (saved) await db.update(scanId, { pages: pages.map((p) => p.xml ?? null), resumes: 0 }).catch(() => {});
    }
    pageLabel = "";
    setPageStatus(`Done in ${Math.round((performance.now() - t0) / 1000)} s`);
  } catch (e) {
    pageLabel = "";
    setPageStatus(`Couldn't read page ${pages.findIndex((p) => !p.xml) + 1}: ${e.message}`);
    $("recognise").disabled = false;
    return;
  } finally {
    reading = false;
    release();
  }
  const entry = scanEntry(false);
  saved = await db.put(entry).then(() => true, () => false);
  if (!saved) setPageStatus("Read OK, but couldn't save it on this phone (storage full?).");
  scanId = null;
  // If they've gone back to the library meanwhile, it's just added there.
  if (!$("scan").hidden) openScore(entry, "replace");
  else renderLibrary();
}

$("open-xml").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  try {
    const xmls = await Promise.all(files.map((f) => f.text()));
    const title = parsePage(xmls[0]).title || files[0].name.replace(/\.(musicxml|xml)$/i, "");
    const entry = { id: crypto.randomUUID(), title, created: Date.now(), pages: xmls, images: [] };
    await db.put(entry);
    openScore(entry);
  } catch (err) {
    $("library-empty").hidden = false;
    $("library-empty").textContent = `Couldn't open that file: ${err.message}`;
  }
};

// ---------- practice ----------

let player;
let current; // library entry
let score;

function openScore(entry, nav = "push") {
  const partChosen = entry.mine != null || Object.keys(entry.manual ?? {}).length > 0; // before defaults below
  current = entry;
  score = buildScore(entry.pages.map(parsePage));
  player?.stop();
  player = new Player(score);
  player.onPosition = (beat) => {
    $("position").textContent = `Bar ${barAt(beat).number}`;
    follow(beat);
    followRead(beat);
  };
  player.onEnd = () => setPlaying(false);
  player.mix = (lineId, t) => {
    if (lineId === myLineAt(t)) return { gain: 1, shift: 12 * current.octave };
    if (!hasMarks() && current.excluded.includes(lineId)) return { gain: 0 };
    return { gain: othersGain, shift: 0 };
  };

  $("title").value = entry.title;
  $("to-bar").value = score.measures.length;
  $("from-bar").value = 1;
  $("from-bar").max = $("to-bar").max = score.measures.length;
  $("tempo").value = entry.tempo ?? 80;
  $("others").value = entry.others ?? 25;
  const soprano = score.lines.findIndex((l) => l.label === "Soprano");
  current.mine = Math.min(entry.mine ?? Math.max(0, soprano), score.lines.length - 1);
  current.excluded = entry.excluded ?? [];
  current.manual = entry.manual ?? {};
  current.octave = entry.octave ?? 0;
  $("octave").value = String(current.octave);
  renderLines();
  renderPartChoice();
  applyLock();
  applyMix();
  updateLabels();
  player.bpm = Number($("tempo").value);
  $("position").textContent = "Bar 1";
  setPlaying(false);
  resumeAt = null;
  $("osmd").replaceChildren();
  osmdFor = null;
  show("practice", nav);
  // New scans (no part chosen yet) and photo-less scores start with settings open.
  $("panel").hidden = true;
  setPanel(!partChosen || !entry.images?.length);
  renderFollow();
  // Pages (photos) when there are any to follow along on; otherwise the read score.
  $("view-toggle").hidden = $("follow").hidden;
  setView($("follow").hidden ? "read" : "pages");
}

// ---------- following along on the photos ----------

const SVG = "http://www.w3.org/2000/svg";
const MAX_SIDE = 4200; // must match normalise(): homr's coordinates are in that space
let pageViews = []; // per page: { svg, bar, playhead, note, w, h }
let followedBar = null;

function svgEl(tag, cls) {
  const el = document.createElementNS(SVG, tag);
  el.setAttribute("class", cls);
  el.style.display = "none";
  return el;
}

function renderFollow() {
  releasePhotos("practice");
  followedBar = null;
  pageViews = [];
  const images = current.images ?? [];
  $("follow").hidden = !images.length || !score.measures.some((m) => m.box);
  $("photo-list").replaceChildren(
    ...images.map((blob, p) => {
      const div = document.createElement("div");
      div.className = "page";
      const img = document.createElement("img");
      img.alt = `Page ${p + 1}`;
      img.src = photoUrl("practice", blob);
      const svg = document.createElementNS(SVG, "svg");
      svg.setAttribute("preserveAspectRatio", "none");
      const view = { svg, marks: document.createElementNS(SVG, "g"), bar: svgEl("rect", "bar"), playhead: svgEl("line", "playhead"), note: svgEl("circle", "note") };
      svg.append(view.marks, view.bar, view.playhead, view.note);
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        view.w = img.naturalWidth * scale;
        view.h = img.naturalHeight * scale;
        svg.setAttribute("viewBox", `0 0 ${view.w} ${view.h}`);
        if (p === 0) showBar(barRange()[0]);
        renderMarks();
      };
      svg.onclick = (e) => (marking ? toggleMark(p, e) : pickBar(p, e));
      pageViews.push(view);
      div.append(img, svg);
      return div;
    }),
  );
}

function padded(box, view) {
  const px = view.w * 0.015;
  const py = view.h * 0.025;
  return { x: box.x0 - px, y: box.y0 - py, w: box.x1 - box.x0 + 2 * px, h: box.y1 - box.y0 + 2 * py };
}

function showEl(el, attrs) {
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.style.display = "";
}
const hide = (el) => (el.style.display = "none");

// Highlights the bar at `beat`; while playing also moves the playhead and
// marks the note your part is singing.
function follow(beat, playing = true) {
  const bar = barAt(beat);
  if (!bar.box) return;
  const view = pageViews[bar.page];
  if (!view?.w) return;
  if (bar !== followedBar) {
    for (const v of pageViews) [v.bar, v.playhead, v.note].forEach(hide);
    const r = padded(bar.box, view);
    showEl(view.bar, { x: r.x, y: r.y, width: r.w, height: r.h, rx: view.w * 0.006 });
    followedBar = bar;
    if (playing) keepInView(view.bar);
  }
  if (!playing) return;

  const r = padded(bar.box, view);
  const onsets = bar.onsets;
  const i = onsets.findLastIndex((o) => o.t <= beat + 1e-6);
  const from = i >= 0 ? onsets[i] : { t: bar.start, x: r.x };
  const to = onsets[i + 1] ?? { t: bar.start + bar.length, x: r.x + r.w };
  const x = from.x + ((to.x - from.x) * (beat - from.t)) / Math.max(1e-6, to.t - from.t);
  showEl(view.playhead, { x1: x, x2: x, y1: r.y, y2: r.y + r.h });

  const mine = myLineAt(beat);
  const note = mine != null && score.lines[mine].notes.find((n) => n.t <= beat + 1e-6 && beat < n.t + n.dur);
  if (note?.pos && note.pos.page === bar.page) {
    showEl(view.note, { cx: note.pos.x, cy: note.pos.y, r: view.w * 0.011 });
  } else hide(view.note);
}

function showBar(beat) {
  followedBar = null;
  follow(beat, false);
  readBar = null;
  followRead(beat, false);
}

function keepInView(el) {
  const r = el.getBoundingClientRect();
  const top = document.querySelector("header").offsetHeight;
  const bottom = $("panel").hidden
    ? window.innerHeight - document.querySelector(".transport").offsetHeight
    : $("panel").getBoundingClientRect().top;
  if (r.top >= top && r.bottom <= bottom) return;
  window.scrollBy({ top: r.top - top - Math.max(0, (bottom - top - r.height) / 3), behavior: "smooth" });
}

// Tap position in the photo's coordinates.
function tapPoint(page, e) {
  const view = pageViews[page];
  const rect = view.svg.getBoundingClientRect();
  return { view, x: ((e.clientX - rect.left) / rect.width) * view.w, y: ((e.clientY - rect.top) / rect.height) * view.h };
}

// Tap a bar on a photo to start from it.
function pickBar(page, e) {
  const { view, x, y } = tapPoint(page, e);
  let best = null;
  let bestDist = Infinity;
  for (const bar of score.measures) {
    if (bar.page !== page || !bar.box) continue;
    const r = padded(bar.box, view);
    const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
    const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
    const d = dx * dx + dy * dy;
    if (d < bestDist) [best, bestDist] = [bar, d];
  }
  if (!best) return;
  $("from-bar").value = best.number;
  if (Number($("to-bar").value) < best.number) $("to-bar").value = score.measures.length;
  $("from-bar").onchange();
}

// ---------- your part: auto (one line) or manual (marked per system) ----------

let othersGain = 0.25;

// Marks (staff per system, set in mark-up mode) take precedence over the
// list choice whenever there are any, so nothing is lost by a stray tap.
const hasMarks = () => Object.keys(current.manual).length > 0;

function myLineAt(beat) {
  if (!hasMarks()) return current.mine;
  return current.manual[barAt(beat).system] ?? null;
}

function renderPartChoice() {
  const marked = Object.keys(current.manual).length;
  $("auto-part").hidden = marked > 0;
  $("marked-part").hidden = marked === 0;
  $("marked-count").textContent = `${marked} of ${score.systems.length} systems`;
  $("tap-hint").textContent = marking ? "Tap the staff you sing in each system." : "Tap a bar to start from there.";
}

$("octave").onchange = () => {
  current.octave = Number($("octave").value);
  updateEntry(current.id, { octave: current.octave });
};

function setMarks(manual) {
  current.manual = manual;
  updateEntry(current.id, { manual });
  renderPartChoice();
  renderMarks();
}

$("clear-marks").onclick = () => {
  const b = $("clear-marks");
  if (b.dataset.confirm !== "1") {
    b.dataset.confirm = "1";
    b.textContent = "Tap again to clear";
    setTimeout(() => {
      b.dataset.confirm = "";
      b.textContent = "Clear marks";
    }, 3000);
    return;
  }
  b.dataset.confirm = "";
  b.textContent = "Clear marks";
  setMarks({});
};

// ---------- mark-up mode ----------

let marking = false;

function startMarkup() {
  if ($("view-toggle").hidden) return;
  setView("pages");
  player.stop();
  // Reuse the open panel's history entry (going back then pushing would race).
  const fromPanel = history.state?.panel;
  setPanel(false, false);
  marking = true;
  document.body.classList.add("marking");
  $("markup-bar").hidden = false;
  const state = { screen: "practice", markup: true };
  if (fromPanel) history.replaceState(state, "");
  else history.pushState(state, "");
  renderPartChoice();
  window.scrollTo({ top: $("follow").offsetTop - 60, behavior: "smooth" });
}
$("start-markup").onclick = startMarkup;
$("edit-markup").onclick = startMarkup;

// nav=false when the back button already left the mark-up history entry.
function endMarkup(nav = true) {
  if (!marking) return;
  marking = false;
  document.body.classList.remove("marking");
  $("markup-bar").hidden = true;
  if (nav && history.state?.markup) history.back();
  renderPartChoice();
}
$("markup-done").onclick = () => endMarkup();

// Tap a staff to mark it as yours in that system. Tapping the marked staff
// again steps upper voice -> lower voice -> unmarked (one-voice staff: unmarks).
function toggleMark(page, e) {
  const { view, y } = tapPoint(page, e);
  const gap = (y0, y1) => Math.max(y0 - y, 0, y - y1);
  const pad = view.h * 0.03;
  const sys = score.systems
    .filter((s) => s.page === page && s.box && s.staves.length)
    .sort((a, b) => gap(a.box.y0 - pad, a.box.y1 + pad) - gap(b.box.y0 - pad, b.box.y1 + pad))[0];
  if (!sys) return;
  const staff = sys.staves.slice().sort((a, b) => gap(a.y0, a.y1) - gap(b.y0, b.y1))[0];
  const order = { upper: 0, only: 1, lower: 2 };
  const choices = staff.lines.slice().sort((a, b) => order[score.lines[a].voice] - order[score.lines[b].voice]);
  const now = choices.indexOf(current.manual[sys.index]);
  const next = now < 0 ? choices[0] : choices[now + 1];
  const { [sys.index]: _, ...rest } = current.manual;
  setMarks(next == null ? rest : { ...rest, [sys.index]: next });
}

// Shades the staff you've marked in each system.
function renderMarks() {
  for (const [p, view] of pageViews.entries()) {
    view.marks.replaceChildren();
    if (!view.w) continue;
    for (const [sysIndex, lineId] of Object.entries(current.manual)) {
      const sys = score.systems[sysIndex];
      const line = score.lines[lineId];
      const staff = sys?.page === p && sys.staves.find((st) => st.key === line?.staffKey);
      if (!staff) continue;
      const px = view.w * 0.015;
      const py = view.h * 0.012;
      const rect = document.createElementNS(SVG, "rect");
      rect.setAttribute("class", "mark");
      rect.setAttribute("x", sys.box.x0 - px);
      rect.setAttribute("y", staff.y0 - py);
      rect.setAttribute("width", sys.box.x1 - sys.box.x0 + 2 * px);
      rect.setAttribute("height", staff.y1 - staff.y0 + 2 * py);
      rect.setAttribute("rx", view.w * 0.006);
      view.marks.append(rect);
      if (line.voice !== "only") {
        const label = document.createElementNS(SVG, "text");
        label.setAttribute("class", "mark-label");
        label.setAttribute("x", sys.box.x1 + px - view.w * 0.005);
        label.setAttribute("y", staff.y0 - py - view.h * 0.004);
        label.setAttribute("text-anchor", "end");
        label.setAttribute("font-size", view.w * 0.03);
        label.textContent = line.voice === "upper" ? "upper voice" : "lower voice";
        view.marks.append(label);
      }
    }
  }
}

function barAt(beat) {
  let lo = 0;
  let hi = score.measures.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (score.measures[mid].start <= beat + 1e-6) lo = mid;
    else hi = mid - 1;
  }
  return score.measures[lo];
}

// ---------- lock: stops accidental changes to the part, title and delete ----------

function applyLock() {
  const locked = !!current.locked;
  $("lock").checked = locked;
  $("panel").classList.toggle("locked", locked);
  $("title").readOnly = locked;
  $("title-icon").textContent = locked ? "🔒" : "✎";
  for (const el of [
    ...document.querySelectorAll("#lines input"),
    $("octave"),
    $("start-markup"),
    $("edit-markup"),
    $("clear-marks"),
    $("delete"),
  ]) el.disabled = locked;
}

$("lock").onchange = () => {
  current.locked = $("lock").checked;
  updateEntry(current.id, { locked: current.locked });
  applyLock();
};

function renderLines() {
  $("lines").replaceChildren(
    ...score.lines.map((line) => {
      const li = document.createElement("li");
      li.className = line.id === current.mine ? "mine" : "";
      const midis = line.notes.map((n) => n.midi);
      const range = `${noteName(Math.min(...midis))}–${noteName(Math.max(...midis))}`;
      li.innerHTML = `
        <label class="pick"><input type="radio" name="mine"><span></span><span class="range">${range}</span></label>
        <label class="include"><input type="checkbox"> play</label>`;
      li.querySelector(".pick span").textContent = line.label;
      const radio = li.querySelector('input[type="radio"]');
      radio.checked = line.id === current.mine;
      radio.onchange = () => {
        current.mine = line.id;
        updateEntry(current.id, { mine: line.id });
        renderLines();
        applyMix();
      };
      const include = li.querySelector('input[type="checkbox"]');
      include.checked = !current.excluded.includes(line.id);
      include.onchange = () => {
        current.excluded = include.checked
          ? current.excluded.filter((x) => x !== line.id)
          : [...current.excluded, line.id];
        updateEntry(current.id, { excluded: current.excluded });
        applyMix();
      };
      return li;
    }),
  );
  if (current.locked) for (const el of document.querySelectorAll("#lines input")) el.disabled = true;
}

// Takes effect from the next notes scheduled (within a quarter second).
function applyMix() {
  othersGain = Number($("others").value) / 100;
}

function updateLabels() {
  $("others-val").textContent = `${$("others").value}%`;
  $("tempo-val").textContent = $("tempo").value;
}

$("others").oninput = () => {
  updateLabels();
  applyMix();
};
$("others").onchange = () => updateEntry(current.id, { others: Number($("others").value) });
$("tempo").oninput = () => {
  updateLabels();
  player.setTempo(Number($("tempo").value));
};
$("tempo").onchange = () => updateEntry(current.id, { tempo: Number($("tempo").value) });
$("title").onchange = () => {
  current.title = $("title").value.trim() || current.title;
  $("title").value = current.title;
  updateEntry(current.id, { title: current.title });
};

function barRange() {
  const n = score.measures.length;
  const from = Math.min(Math.max(1, Number($("from-bar").value) || 1), n);
  const to = Math.min(Math.max(from, Number($("to-bar").value) || n), n);
  const last = score.measures[to - 1];
  return [score.measures[from - 1].start, last.start + last.length];
}

let resumeAt = null; // beat to continue from after a pause

function setPlaying(on) {
  $("play").classList.toggle("playing", on);
  $("play").setAttribute("aria-label", on ? "Pause" : "Play");
}

// nav=false when responding to the back button (history already moved).
function setPanel(open, nav = true) {
  const wasOpen = !$("panel").hidden;
  $("panel").hidden = !open;
  $("settings").setAttribute("aria-expanded", String(open));
  if (!nav || open === wasOpen) return;
  if (open) history.pushState({ screen: "practice", panel: true }, "");
  else if (history.state?.panel) history.back();
}
$("settings").onclick = () => setPanel($("panel").hidden);

$("play").onclick = () => {
  if (player.playing) {
    resumeAt = player.position();
    player.stop();
    return;
  }
  const [from, to] = barRange();
  const start = resumeAt != null && resumeAt >= from && resumeAt < to ? resumeAt : from;
  resumeAt = null;
  player.play(start, to, $("loop").checked, from);
  setPlaying(true);
};

$("rewind").onclick = () => {
  resumeAt = null;
  const [from, to] = barRange();
  if (player.playing) player.play(from, to, $("loop").checked);
  else {
    showBar(from);
    $("position").textContent = `Bar ${barAt(from).number}`;
  }
};

for (const id of ["from-bar", "to-bar", "loop"]) {
  $(id).onchange = () => {
    resumeAt = null;
    const [from, to] = barRange();
    if (player.playing) player.play(from, to, $("loop").checked);
    else {
      showBar(from);
      $("position").textContent = `Bar ${barAt(from).number}`;
    }
  };
}

$("delete").onclick = () => {
  if ($("delete").dataset.confirm !== "1") {
    $("delete").dataset.confirm = "1";
    $("delete").textContent = "Tap again to delete";
    setTimeout(() => {
      $("delete").dataset.confirm = "";
      $("delete").textContent = "Delete score";
    }, 3000);
    return;
  }
  $("delete").dataset.confirm = "";
  $("delete").textContent = "Delete score";
  db.remove(current.id).finally(goHome);
};

// ---------- Pages / As read ----------

// Follow-along on the As read view: OSMD knows where it drew each bar.
let readViews = []; // per page: { osmd, div, bar, playhead }
let readBar = null;

function readMark(cls) {
  const el = document.createElement("div");
  el.className = cls;
  el.hidden = true;
  return el;
}

// Bar `i` of a rendered page, in pixels within its container.
function readBarBox(view, i) {
  const staves = view.osmd.GraphicSheet?.MeasureList?.[i];
  if (!staves) return null;
  const unit = 10 * view.osmd.zoom; // OSMD units -> px
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  let lead = 0; // clef/key/time at the start of a system
  for (const m of staves) {
    const ps = m?.PositionAndShape;
    if (!ps) continue;
    lead = Math.max(lead, m.beginInstructionsWidth || 0);
    x0 = Math.min(x0, ps.AbsolutePosition.x + ps.BorderLeft);
    x1 = Math.max(x1, ps.AbsolutePosition.x + ps.BorderRight);
    y0 = Math.min(y0, ps.AbsolutePosition.y + ps.BorderTop);
    y1 = Math.max(y1, ps.AbsolutePosition.y + ps.BorderBottom);
  }
  if (x0 === Infinity) return null;
  const pad = 6;
  const svg = view.div.querySelector("svg");
  const ox = svg ? svg.getBoundingClientRect().left - view.div.getBoundingClientRect().left : 0;
  const oy = svg ? svg.getBoundingClientRect().top - view.div.getBoundingClientRect().top : 0;
  return { x: ox + x0 * unit, y: oy + y0 * unit - pad, w: (x1 - x0) * unit, h: (y1 - y0) * unit + 2 * pad, lead: lead * unit };
}

function place(el, { x, y, w, h }) {
  Object.assign(el.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });
  el.hidden = false;
}

function followRead(beat, playing = true) {
  if ($("read-view").hidden || !readViews.length) return;
  const bar = barAt(beat);
  const view = readViews[bar.sheet];
  const box = view && readBarBox(view, bar.sheetBar);
  if (!box) return;
  if (bar !== readBar) {
    for (const v of readViews) v.bar.hidden = v.playhead.hidden = true;
    place(view.bar, box);
    readBar = bar;
    if (playing) keepInView(view.bar);
  }
  if (!playing) return;
  const from = box.x + box.lead;
  const x = from + ((box.w - box.lead) * Math.min(1, Math.max(0, beat - bar.start))) / bar.length;
  place(view.playhead, { x: x - 1.5, y: box.y, w: 3, h: box.h });
}

// homr numbers each page's bars from 1; renumber to match the bar counter.
function numberBars(xml, first) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  for (const part of doc.querySelectorAll("part")) {
    [...part.children].filter((m) => m.tagName === "measure").forEach((m, i) => m.setAttribute("number", first + i));
  }
  return new XMLSerializer().serializeToString(doc);
}

// Tap a bar in the As read view to start from it.
function pickReadBar(sheet, e) {
  const view = readViews[sheet];
  const r = view.div.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  let best = null;
  let bestDist = Infinity;
  for (const bar of score.measures) {
    if (bar.sheet !== sheet) continue;
    const b = readBarBox(view, bar.sheetBar);
    if (!b) continue;
    const dx = Math.max(b.x - x, 0, x - (b.x + b.w));
    const dy = Math.max(b.y - y, 0, y - (b.y + b.h));
    if (dx * dx + dy * dy < bestDist) [best, bestDist] = [bar, dx * dx + dy * dy];
  }
  if (!best) return;
  $("from-bar").value = best.number;
  if (Number($("to-bar").value) < best.number) $("to-bar").value = score.measures.length;
  $("from-bar").onchange();
}

// Where you are: the playing position, else where you paused, else the start bar.
const currentBeat = () => (player?.playing ? player.position() : resumeAt ?? barRange()[0]);

function setView(view) {
  const pages = view === "pages";
  $("follow").hidden = !pages;
  $("read-view").hidden = pages;
  const t = $("view-toggle");
  t.classList.toggle("on-read", !pages);
  $("view-toggle-label").textContent = pages ? "As read" : "Pages";
  t.setAttribute("aria-label", pages ? "Show the music as read" : "Show your pages");
  if (pages) {
    followedBar = null;
    follow(currentBeat(), !!player?.playing);
  } else {
    renderRead();
    readBar = null;
    followRead(currentBeat(), !!player?.playing);
  }
  revealCurrentBar();
}
$("view-toggle").onclick = () => setView($("read-view").hidden ? "read" : "pages");

// Scrolls the highlighted bar of the visible view into the middle of the screen.
function revealCurrentBar() {
  const bar = barAt(currentBeat());
  const el = $("read-view").hidden ? pageViews[bar.page]?.bar : readViews[bar.sheet]?.bar;
  if (el && el.style.display !== "none" && !el.hidden) el.scrollIntoView({ block: "center" });
}

// Draws the recognised MusicXML with OSMD, loaded on first use.
let osmdLoaded;
let osmdFor = null; // the score currently drawn
async function renderRead() {
  if (osmdFor === current) return;
  const entry = (osmdFor = current);
  $("osmd").replaceChildren();
  readViews = [];
  readBar = null;
  osmdLoaded ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = OSMD_URL;
    s.onload = resolve;
    s.onerror = () => {
      osmdLoaded = null;
      reject(new Error("Couldn't load the score viewer (offline?)"));
    };
    document.head.append(s);
  });
  try {
    await osmdLoaded;
    for (const xml of entry.pages) {
      // Draw a page at a time so playback and scrolling get a turn in between.
      await new Promise((r) => setTimeout(r, 0));
      if (osmdFor !== entry) return; // another score was opened meanwhile
      const div = document.createElement("div");
      div.className = "read-page";
      $("osmd").append(div);
      const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(div, {
        autoResize: false,
        drawTitle: false,
        drawPartNames: false,
      });
      osmd.EngravingRules.UseXMLMeasureNumbers = true;
      await osmd.load(numberBars(xml, score.measures.find((b) => b.sheet === readViews.length)?.number ?? 1));
      osmd.zoom = 0.6;
      osmd.render();
      const sheet = readViews.length;
      const view = { osmd, div, bar: readMark("read-bar"), playhead: readMark("read-playhead") };
      div.append(view.bar, view.playhead);
      div.onclick = (e) => pickReadBar(sheet, e);
      readViews.push(view);
    }
    showBar(currentBeat());
    if (!$("read-view").hidden) revealCurrentBar();
  } catch (e) {
    osmdFor = null;
    $("osmd").textContent = e.message;
  }
}

if ("serviceWorker" in navigator && location.hostname !== "localhost") {
  navigator.serviceWorker.register("sw.js");
}

renderLibrary().then(resumeUnfinished);
