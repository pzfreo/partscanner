import { buildScore, parsePage } from "./score.js";
import { Player } from "./player.js";
import * as db from "./db.js";

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
function show(name) {
  for (const s of screens) $(s).hidden = s !== name;
  $("back").hidden = name === "home";
  if (name !== "practice") {
    player?.stop();
    releasePhotos("practice");
    $("photo-list").replaceChildren();
  }
  if (name === "home") renderLibrary();
  window.scrollTo(0, 0);
}
$("back").onclick = () => show("home");

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
        b.innerHTML = `<span class="thumb"></span><span class="name"></span><small>${entry.pages.length} page${entry.pages.length > 1 ? "s" : ""}</small>`;
        b.querySelector(".name").textContent = entry.title;
        if (entry.images?.length) {
          const img = document.createElement("img");
          img.alt = "";
          img.src = photoUrl("library", entry.images[0]);
          b.querySelector(".thumb").append(img);
        }
        b.onclick = () => openScore(entry);
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

$("new-scan").onclick = () => {
  pages.forEach((p) => URL.revokeObjectURL(p.url));
  pages = [];
  pageStatus = "";
  $("scan-name").value = "";
  renderPages();
  show("scan");
  startWorker();
};

function addFiles(files) {
  for (const f of files) pages.push({ blob: f, url: URL.createObjectURL(f) });
  renderPages();
}
$("camera").onchange = (e) => {
  addFiles(e.target.files);
  e.target.value = "";
};
$("gallery").onchange = (e) => {
  addFiles(e.target.files);
  e.target.value = "";
};

function renderPages() {
  $("pages").replaceChildren(
    ...pages.map((p, i) => {
      const li = document.createElement("li");
      li.innerHTML = `<img alt="Page ${i + 1}"><span class="num">${i + 1}</span><button class="remove" aria-label="Remove page ${i + 1}">&times;</button>`;
      li.querySelector("img").src = p.url;
      li.querySelector("button").onclick = () => {
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

$("recognise").onclick = async () => {
  $("recognise").disabled = true;
  const xmls = [];
  try {
    startWorker();
    await workerReady;
    const t0 = performance.now();
    for (let i = 0; i < pages.length; i++) {
      pageLabel = `Page ${i + 1} of ${pages.length}`;
      setPageStatus("finding staves…");
      xmls.push(await recognisePage(await normalise(pages[i].blob)));
    }
    pageLabel = "";
    setPageStatus(`Done in ${Math.round((performance.now() - t0) / 1000)} s`);
  } catch (e) {
    pageLabel = "";
    setPageStatus(`Couldn't read ${xmls.length ? `page ${xmls.length + 1}` : "the music"}: ${e.message}`);
    $("recognise").disabled = false;
    return;
  }
  const entry = {
    id: crypto.randomUUID(),
    title: $("scan-name").value.trim() || `Scan ${new Date().toLocaleDateString()}`,
    created: Date.now(),
    pages: xmls,
    images: pages.map((p) => p.blob),
  };
  try {
    await db.put(entry);
  } catch (e) {
    setPageStatus(`Read OK, but couldn't save it on this phone (${e?.name || e}).`);
  }
  openScore(entry);
};

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

function openScore(entry) {
  current = entry;
  score = buildScore(entry.pages.map(parsePage));
  player?.stop();
  player = new Player(score);
  player.onPosition = (beat) => {
    $("position").textContent = `Bar ${barAt(beat).number}`;
    follow(beat);
  };
  player.onEnd = () => ($("play").textContent = "Play");

  $("title").value = entry.title;
  $("to-bar").value = score.measures.length;
  $("from-bar").value = 1;
  $("from-bar").max = $("to-bar").max = score.measures.length;
  $("tempo").value = entry.tempo ?? 80;
  $("others").value = entry.others ?? 25;
  const soprano = score.lines.findIndex((l) => l.label === "Soprano");
  current.mine = Math.min(entry.mine ?? Math.max(0, soprano), score.lines.length - 1);
  current.excluded = entry.excluded ?? [];
  renderLines();
  applyMix();
  updateLabels();
  player.bpm = Number($("tempo").value);
  $("position").textContent = "Bar 1";
  $("play").textContent = "Play";
  $("score-view").open = false;
  $("osmd").replaceChildren();
  show("practice");
  renderFollow();
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
      const view = { svg, bar: svgEl("rect", "bar"), playhead: svgEl("line", "playhead"), note: svgEl("circle", "note") };
      svg.append(view.bar, view.playhead, view.note);
      img.onload = () => {
        const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
        view.w = img.naturalWidth * scale;
        view.h = img.naturalHeight * scale;
        svg.setAttribute("viewBox", `0 0 ${view.w} ${view.h}`);
        if (p === 0) showBar(barRange()[0]);
      };
      svg.onclick = (e) => pickBar(p, e);
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

  const note = score.lines[current.mine].notes.find((n) => n.t <= beat + 1e-6 && beat < n.t + n.dur);
  if (note?.pos && note.pos.page === bar.page) {
    showEl(view.note, { cx: note.pos.x, cy: note.pos.y, r: view.w * 0.011 });
  } else hide(view.note);
}

function showBar(beat) {
  followedBar = null;
  follow(beat, false);
}

function keepInView(el) {
  const r = el.getBoundingClientRect();
  const top = document.querySelector("header").offsetHeight;
  const bottom = window.innerHeight - document.querySelector(".transport").offsetHeight;
  if (r.top >= top && r.bottom <= bottom) return;
  window.scrollBy({ top: r.top - top - Math.max(0, (bottom - top - r.height) / 3), behavior: "smooth" });
}

// Tap a bar on a photo to start from it.
function pickBar(page, e) {
  const view = pageViews[page];
  const rect = view.svg.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * view.w;
  const y = ((e.clientY - rect.top) / rect.height) * view.h;
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
}

function applyMix() {
  const others = Number($("others").value) / 100;
  for (const line of score.lines) {
    const gain = current.excluded.includes(line.id) ? 0 : line.id === current.mine ? 1 : others;
    player.setGain(line.id, gain);
  }
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

$("play").onclick = () => {
  if (player.playing) {
    player.stop();
    return;
  }
  const [from, to] = barRange();
  player.play(from, to, $("loop").checked);
  $("play").textContent = "Stop";
};
for (const id of ["from-bar", "to-bar", "loop"]) {
  $(id).onchange = () => {
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
  db.remove(current.id).finally(() => show("home"));
};

// Rendering is only for checking recognition, so load OSMD on demand.
let osmdLoaded;
$("score-view").ontoggle = async () => {
  if (!$("score-view").open || $("osmd").childElementCount) return;
  osmdLoaded ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = OSMD_URL;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Couldn't load the score viewer (offline?)"));
    document.head.append(s);
  });
  try {
    await osmdLoaded;
    for (const xml of current.pages) {
      const div = document.createElement("div");
      $("osmd").append(div);
      const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(div, {
        autoResize: false,
        drawTitle: false,
        drawPartNames: false,
      });
      await osmd.load(xml);
      osmd.zoom = 0.6;
      osmd.render();
    }
  } catch (e) {
    $("osmd").textContent = e.message;
  }
};

if ("serviceWorker" in navigator && location.hostname !== "localhost") {
  navigator.serviceWorker.register("sw.js");
}

renderLibrary();
