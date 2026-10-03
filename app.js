import { buildScore, parsePage } from "./score.js";
import { Player } from "./player.js";

const $ = (id) => document.getElementById(id);
const OSMD_URL = "https://cdn.jsdelivr.net/npm/opensheetmusicdisplay@2.2.0/build/opensheetmusicdisplay.min.js";
const LIBRARY_KEY = "partscanner.library.v1";
const NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const noteName = (m) => NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1);

// ---------- library (per-device, in localStorage) ----------

function loadLibrary() {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_KEY)) ?? [];
  } catch {
    return [];
  }
}
function saveLibrary(lib) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
    return true;
  } catch {
    return false;
  }
}
function updateEntry(id, changes) {
  const lib = loadLibrary();
  const entry = lib.find((e) => e.id === id);
  if (entry) {
    Object.assign(entry, changes);
    saveLibrary(lib);
  }
}

// ---------- navigation ----------

const screens = ["home", "scan", "practice"];
function show(name) {
  for (const s of screens) $(s).hidden = s !== name;
  $("back").hidden = name === "home";
  if (name !== "practice") player?.stop();
  if (name === "home") renderLibrary();
  window.scrollTo(0, 0);
}
$("back").onclick = () => show("home");

function renderLibrary() {
  const lib = loadLibrary();
  $("library-empty").hidden = lib.length > 0;
  $("library").replaceChildren(
    ...lib
      .slice()
      .sort((a, b) => b.created - a.created)
      .map((entry) => {
        const li = document.createElement("li");
        const b = document.createElement("button");
        b.innerHTML = `<span></span><small>${entry.pages.length} page${entry.pages.length > 1 ? "s" : ""}</small>`;
        b.firstChild.textContent = entry.title;
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
        const total = [...download.values()].reduce((s, d) => s + d.total, 0);
        const of = [...download.values()].every((d) => d.total) ? ` / ${Math.round(total / 1e6)}` : "";
        setEngineStatus(`Downloading music reader (once only): ${Math.round(loaded / 1e6)}${of} MB`);
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
    title: `Scan ${new Date().toLocaleDateString()}`,
    created: Date.now(),
    pages: xmls,
  };
  const lib = loadLibrary();
  lib.push(entry);
  if (!saveLibrary(lib)) setPageStatus("Read OK, but the phone's storage is full so it won't be kept.");
  openScore(entry);
};

$("open-xml").onchange = async (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  if (!files.length) return;
  try {
    const xmls = await Promise.all(files.map((f) => f.text()));
    const title = parsePage(xmls[0]).title || files[0].name.replace(/\.(musicxml|xml)$/i, "");
    const entry = { id: crypto.randomUUID(), title, created: Date.now(), pages: xmls };
    const lib = loadLibrary();
    lib.push(entry);
    saveLibrary(lib);
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
  player.onPosition = (beat) => ($("position").textContent = `Bar ${barAt(beat).number}`);
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
$("title").onchange = () => updateEntry(current.id, { title: $("title").value.trim() || current.title });

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
    if (!player.playing) return;
    const [from, to] = barRange();
    player.play(from, to, $("loop").checked);
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
  saveLibrary(loadLibrary().filter((e) => e.id !== current.id));
  show("home");
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
