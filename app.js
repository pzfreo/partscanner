import { buildScore, parsePage, playOrder } from "./score.js";
import { Player } from "./player.js";
import { AUDIO_RATE, audioFile } from "./audio.js";
import * as db from "./db.js";
import { rotateBlob, uprightPhoto } from "./orient.js";
import { isPdf, pdfPages } from "./pdf-pages.js";
import { entryFromLink, entryFromRelay, isMobile, parseScoreFile, readScoreFile, scoreFile, shareableScore, shareFile, shareLink } from "./share.js";

const $ = (id) => document.getElementById(id);

// Unexpected errors show briefly on screen, so a problem on the phone can be
// screenshotted rather than just looking like a freeze.
// Recent errors and reader log lines, for bug reports.
const recentErrors = [];
const readerLog = [];
const remember = (list, item, max) => {
  list.push(`${new Date().toISOString().slice(11, 19)} ${item}`);
  if (list.length > max) list.shift();
};

function showError(message) {
  remember(recentErrors, message, 10);
  const el = $("error-toast");
  el.textContent = `Something went wrong: ${message}`;
  el.hidden = false;
  clearTimeout(showError.timer);
  showError.timer = setTimeout(() => (el.hidden = true), 8000);
}
window.addEventListener("error", (e) => showError(e.message));
window.addEventListener("unhandledrejection", (e) => showError(e.reason?.message ?? String(e.reason)));
window.reportError ??= (e) => showError(e?.message ?? String(e));
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
    $("panel").hidden = $("panel-backdrop").hidden = true;
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

// Back/forward: make the screen match the history entry landed on (overlays,
// settings panel and mark-up mode are part of the entry), rather than closing
// things blindly, so they never get out of step with the history.
window.addEventListener("popstate", (e) => {
  const st = e.state ?? {};
  if (!st.report) closeReport(false);
  if (!st.about) closeAbout(false);
  if (st.screen && !$(st.screen).hidden) {
    if (st.screen === "practice") {
      setPanel(!!st.panel, false);
      if (!st.markup) endMarkup(false);
    }
  } else show("home", "none");
});

// ---------- bug reports (emailed to bugs@partsong.app) ----------

const REPORT_TO = "bugs@partsong.app";
const VERSION = new URL(import.meta.url).searchParams.get("v") || "dev";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

function diagnostics() {
  const screen = ["home", "scan", "practice"].find((s) => !$(s).hidden) || "?";
  const lines = [
    `Partsong ${VERSION} · ${location.host}`,
    `Device: ${navigator.userAgent}`,
    `Screen: ${innerWidth}×${innerHeight} @${devicePixelRatio}x` +
      (navigator.deviceMemory ? ` · ${navigator.deviceMemory} GB RAM` : "") +
      ` · ${navigator.onLine ? "online" : "offline"}`,
    `On: ${screen}`,
  ];
  if (screen === "practice" && current && score) {
    const marks = Object.keys(current.manual ?? {}).length;
    lines.push(
      `Score: "${current.title}" · ${plural(current.pages.length, "page")} · ${plural(current.images?.length ?? 0, "photo")} · ${plural(score.measures.length, "bar")}`,
      `Position: ${$("position").textContent} · from bar ${$("from-bar").value} to ${$("to-bar").value}`,
      `Part: ${marks ? `${marks} of ${score.systems.length} systems marked` : score.lines[current.mine]?.label ?? "?"}` +
        ` · pitch ${current.octave} · sound ${$("instrument").value} · tempo ${$("tempo").value} · others ${$("others").value}%` +
        ` · view ${$("read-view").hidden ? "pages" : "as read"}`,
      `Parts: ${score.lines.map((l) => l.label).join(", ")}`,
    );
  }
  if (screen === "scan") lines.push(`Scan: ${pages.length} pages · status: ${$("status").textContent.replace(/\n/g, " | ")}`);
  if (recentErrors.length) lines.push("", "Recent errors:", ...recentErrors);
  if (readerLog.length) lines.push("", "Music reader log:", ...readerLog.slice(-25));
  return lines.join("\n");
}

function openReport() {
  $("report-diag").textContent = diagnostics();
  const withScore = !$("practice").hidden && !!current;
  const phone = isMobile() && !!navigator.canShare;
  const button = withScore ? "Share report with score" : "Share report";
  $("report-share").textContent = button;
  $("report-status").textContent = "";
  const steps = phone
    ? [
        "Describe what happened above.",
        `Tap <b>${button}</b>.`,
        "Choose Gmail or your email app.",
        `In <b>To</b>, paste <b>${REPORT_TO}</b> (it's copied for you).`,
        "Send.",
      ]
    : [
        "Describe what happened above.",
        `Click <b>${button}</b>: an email to <b>${REPORT_TO}</b> opens${withScore ? " and the score file downloads" : ""}.`,
        ...(withScore ? ["Attach the downloaded file to the email."] : []),
        "Send.",
      ];
  $("report-steps").innerHTML = steps.map((s) => `<li>${s}</li>`).join("");
  $("report").hidden = false;
  history.pushState({ ...history.state, report: true }, "");
  $("report-text").focus();
}
for (const b of document.querySelectorAll(".report-open")) b.onclick = openReport;

function closeReport(nav = true) {
  $("report").hidden = true;
  if (nav && history.state?.report) history.back();
}
$("report-close").onclick = () => closeReport();
$("report").onclick = (e) => e.target === $("report") && closeReport();

// About: version, privacy, licence (AGPL: the source link is the offer of
// source to network users) and third-party credits.
function openAbout() {
  $("about-version").textContent = VERSION;
  $("about").hidden = false;
  history.pushState({ ...history.state, about: true }, "");
}
for (const b of document.querySelectorAll(".about-open")) b.onclick = openAbout;
function closeAbout(nav = true) {
  $("about").hidden = true;
  if (nav && history.state?.about) history.back();
}
$("about-close").onclick = () => closeAbout();

function reportText() {
  return `${$("report-text").value.trim() || "(no description)"}\n\n---\n${$("report-diag").textContent}`;
}

// One button: the report (plus the open score as a file, when there is one).
// Phones: the share sheet; the address is copied to paste in, since a web app
// can't fill in the recipient. Desktop: an email opens (and the score file
// downloads, to attach).
let reportPrepared = null; // { id, file }
$("report-share").onclick = async () => {
  track("report");
  const button = $("report-share");
  const status = $("report-status");
  navigator.clipboard?.writeText(REPORT_TO).catch(() => {});
  const what = $("report-text").value.trim().split("\n")[0].slice(0, 60);
  const title = `Partsong problem${what ? `: ${what}` : ""}`;
  const withScore = !$("practice").hidden && !!current;
  button.disabled = true;
  try {
    let file = null;
    if (withScore) {
      if (reportPrepared?.id !== current.id) {
        status.textContent = "Preparing the score…";
        const entry = (await db.all()).find((e) => e.id === current.id) ?? current;
        reportPrepared = { id: current.id, file: await scoreFile(entry) };
      }
      file = reportPrepared.file;
    }
    const text = `To: ${REPORT_TO}\n\n${reportText()}`;
    const share = file ? { files: [file], title, text } : { title, text };
    if (isMobile() && navigator.canShare?.(share)) {
      try {
        await navigator.share(share);
        reportPrepared = null;
        status.textContent = `Thanks! Remember to paste ${REPORT_TO} into To.`;
      } catch (e) {
        status.textContent =
          e.name === "NotAllowedError" ? `Ready. Tap ${button.textContent} again.` : e.name === "AbortError" ? "" : `Couldn't share: ${e.message}`;
      }
    } else {
      if (file) await shareFile(file, title); // downloads on desktop
      reportPrepared = null;
      let body = reportText();
      if (body.length > 6000) body = body.slice(0, 6000) + "\n…(trimmed)";
      const url = `mailto:${REPORT_TO}?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
      button.dataset.href = url; // what was handed to the mail app (also used by tests)
      location.href = url;
      status.textContent = file
        ? `Attach ${file.name} (in your Downloads) to the email, then send.`
        : `If no email opened, write to ${REPORT_TO} and paste the details below.`;
    }
  } catch (e) {
    reportPrepared = null;
    status.textContent = `Couldn't prepare the report: ${e.message}`;
  } finally {
    button.disabled = false;
  }
};

// ---------- updates: tell people (installed apps rarely restart) ----------

// A deploy stamps its version into index.html (scripts/stamp-version.mjs).
// When the app comes back to the screen, or every 30 minutes, fetch the page
// fresh and compare; if it's newer, offer a reload rather than forcing one.
let lastUpdateCheck = 0;
async function checkForUpdate() {
  if (VERSION === "dev" || !navigator.onLine || Date.now() - lastUpdateCheck < 60000) return;
  lastUpdateCheck = Date.now();
  try {
    const html = await (await fetch(`./?check=${Date.now()}`, { cache: "no-store" })).text();
    const live = /app\.js\?v=(\w+)/.exec(html)?.[1];
    if (live && live !== VERSION) $("update-banner").hidden = false;
  } catch {}
}
$("update-now").onclick = () => location.reload();
$("update-later").onclick = () => ($("update-banner").hidden = true);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkForUpdate());
setInterval(checkForUpdate, 30 * 60000);
setTimeout(checkForUpdate, 10000);

// ---------- install prompt ----------

const INSTALL_SNOOZE_KEY = "partsong.install.snoozed";
const installed = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const snoozed = () => {
  try {
    return Date.now() - Number(localStorage.getItem(INSTALL_SNOOZE_KEY) || 0) < 30 * 864e5;
  } catch {
    return false;
  }
};
let installPrompt = null;
function showInstallCard() {
  if (installed() || snoozed()) return;
  $("install-card").hidden = false;
}
// Chrome/Edge (Android, desktop): use the browser's own install prompt.
addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  showInstallCard();
});
// Not suggested on iPhone/iPad: a home-screen app there keeps a library
// separate from Safari's, so scores opened from shared files (which open in
// Safari) wouldn't show up in it.
$("install-now").onclick = async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  const { outcome } = await installPrompt.userChoice;
  installPrompt = null;
  if (outcome === "accepted") {
    $("install-card").hidden = true;
    track("install");
  }
};
$("install-later").onclick = () => {
  $("install-card").hidden = true;
  try {
    localStorage.setItem(INSTALL_SNOOZE_KEY, String(Date.now()));
  } catch {}
};
addEventListener("appinstalled", () => ($("install-card").hidden = true));

const DELETE_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';

// Swaps a library row for a "are you sure?" check before deleting.
function confirmDelete(li, entry) {
  const box = document.createElement("div");
  box.className = "confirm-delete";
  box.setAttribute("role", "alertdialog");
  box.innerHTML = `<p></p><div class="actions"><button class="danger-solid">Delete</button><button>Cancel</button></div>`;
  box.querySelector("p").textContent = `Delete “${entry.title}”? This can't be undone.`;
  const [yes, no] = box.querySelectorAll("button");
  yes.onclick = async () => {
    await db.remove(entry.id);
    await renderLibrary();
    $("library-status").textContent = `Deleted “${entry.title}”.`;
    clearTimeout(shareScore.timer);
    shareScore.timer = setTimeout(() => ($("library-status").textContent = ""), 4000);
  };
  no.onclick = () => renderLibrary();
  li.replaceChildren(box);
  no.focus();
}

const COPY_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';

// Search appears once the library is long enough to need it. Every word typed
// must appear in the title (ignoring case and accents).
const SEARCH_FROM = 6;
const fold = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

function filterLibrary() {
  const words = fold($("library-search").value).split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const li of $("library").children) {
    const match = words.every((w) => fold(li.dataset.title ?? "").includes(w));
    li.hidden = !match;
    shown += match;
  }
  $("library-none").hidden = shown > 0 || !$("library").children.length;
}
$("library-search").oninput = filterLibrary;

async function renderLibrary() {
  const lib = await db.all().catch(() => []);
  $("library-search").hidden = lib.length < SEARCH_FROM;
  if (lib.length < SEARCH_FROM) $("library-search").value = "";
  releasePhotos("library");
  $("library-empty").hidden = lib.length > 0;
  $("intro-more").hidden = lib.length > 0; // the explanation is for newcomers
  document.querySelector("#home .footer-sample").hidden = lib.length === 0; // the big button shows instead
  $("library").replaceChildren(
    ...lib
      .slice()
      .sort((a, b) => b.created - a.created)
      .map((entry) => {
        const li = document.createElement("li");
        li.dataset.id = entry.id;
        li.dataset.title = entry.title;
        const b = document.createElement("button");
        const n = entry.pages.length;
        const done = entry.pages.filter(Boolean).length;
        const marked = Object.keys(entry.manual ?? {}).length;
        const info = entry.pending
          ? `Reading… ${done} of ${n}`
          : `${n} page${n > 1 ? "s" : ""}${marked ? ` · ${marked} system${marked > 1 ? "s" : ""} marked` : ""}`;
        b.innerHTML = `<span class="thumb"></span><span class="meta"><span class="name"></span><small>${info}</small></span>`;
        b.querySelector(".name").textContent = (entry.locked ? "🔒 " : "") + entry.title;
        if (entry.images?.length) {
          const img = document.createElement("img");
          img.alt = "";
          img.src = photoUrl("library", entry.images[0]);
          b.querySelector(".thumb").append(img);
        }
        b.onclick = () => (entry.pending ? resumeScan(entry) : openScore(entry));
        li.append(b);
        if (!entry.pending) {
          const copy = document.createElement("button");
          copy.className = "share-btn";
          copy.setAttribute("aria-label", `Make a copy of ${entry.title}`);
          copy.title = "Make a copy";
          copy.innerHTML = COPY_ICON;
          copy.onclick = () => copyScore(entry.id);
          const share = document.createElement("button");
          share.className = "share-btn";
          share.setAttribute("aria-label", `Share ${entry.title}`);
          share.title = "Share";
          share.innerHTML = $("share").innerHTML;
          share.onclick = () => shareScore(entry.id, share, $("library-status"));
          li.append(copy, share);
        } else {
          for (let i = 0; i < 2; i++) li.append(Object.assign(document.createElement("span"), { className: "share-spacer" }));
        }
        const del = document.createElement("button");
        del.className = "share-btn delete-btn";
        del.setAttribute("aria-label", `Delete ${entry.title}`);
        del.title = entry.locked ? "Locked: unlock it to delete" : "Delete";
        del.innerHTML = DELETE_ICON;
        // Locked scores can't be deleted, nor the scan being read right now.
        del.disabled = !!entry.locked || (reading && entry.id === scanId);
        del.onclick = () => confirmDelete(li, entry);
        li.append(del);
        return li;
      }),
  );
  filterLibrary();
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
        const mb = loaded < 10e6 ? (loaded / 1e6).toFixed(1) : Math.round(loaded / 1e6);
        setEngineStatus(`Downloading music reader (once only): ${mb} / ${Math.round(data.total / 1e6)} MB`);
      } else if (data.type === "progress" && data.stage === "retry") {
        setEngineStatus(`${engineStatus.split(" · ")[0]} · connection dropped, retrying (${data.attempt})…`);
      } else if (data.type === "progress" && data.stage === "python") {
        setEngineStatus("Starting music reader…");
      } else if (data.type === "ready") {
        setEngineStatus("");
        resolve();
      } else if (data.type === "log") {
        console.log("[omr]", data.msg);
        remember(readerLog, String(data.msg).slice(0, 200), 40);
        const m = /Running TrOmr inference on staff image (\d+)/.exec(data.msg);
        if (m) setPageStatus(`reading staff ${Number(m[1]) + 1}`);
        else if (/Found \d+ connected staffs/.test(data.msg)) setPageStatus("found the staves");
      } else if (data.type === "result" || data.type === "error") {
        const p = pending.get(data.id);
        if (!p) {
          resetWorker();
          return reject(new Error(data.msg));
        }
        pending.delete(data.id);
        data.type === "result" ? p.resolve(data.xml) : p.reject(new Error(data.msg));
      }
    };
    // A crashed worker (e.g. the phone ran out of memory) fails everything waiting
    // on it; the next attempt starts a fresh one (downloads resume, see worker).
    worker.onerror = (e) => {
      const err = new Error(e.message || "the music reader stopped (low memory?)");
      for (const p of pending.values()) p.reject(err);
      pending.clear();
      resetWorker();
      reject(err);
    };
  });
  worker.postMessage({ type: "init" });
}

function resetWorker() {
  worker?.terminate();
  worker = null;
  download.clear();
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

let scanSettings = {}; // settings to save with the scan (the sample's)

function loadScan(images = [], xmls = [], id = null, created = null, title = "") {
  pages.forEach((p) => URL.revokeObjectURL(p.url));
  pages = images.map((blob, i) => ({ blob, url: URL.createObjectURL(blob), xml: xmls[i] ?? undefined }));
  scanId = id;
  scanCreated = created;
  scanSettings = {};
  pageStatus = "";
  $("scan-name").value = title;
  renderPages();
  show("scan");
  startWorker();
}

$("new-scan").onclick = () => (reading ? show("scan") : loadScan());

// The sample score (samples/tallis-if-ye-love-me.pdf, from CPDL):
// opens the scan screen with its pages added, ready for Read music.
// Anonymous usage counts (GoatCounter, no cookies; see index.html): which
// features get used, never titles or music. Silent if blocked or offline.
function track(name, title = name) {
  try {
    window.goatcounter?.count?.({ path: name, title, event: true });
  } catch {}
}

async function trySample() {
  track("sample");
  if (reading) return show("scan");
  loadScan();
  $("scan-name").value = "If ye love me (sample)";
  // The reader misses the forward repeat at the start of bar 14.
  scanSettings = { repeats: { 26: 14 } };
  setPageStatus("Opening the sample…");
  try {
    const blob = await (await fetch("samples/tallis-if-ye-love-me.pdf")).blob();
    await addFiles([new File([blob], "If ye love me (sample).pdf", { type: "application/pdf" })]);
    setPageStatus("Tap Read music to read the sample.");
  } catch (e) {
    setPageStatus(`Couldn't open the sample: ${e.message}`);
  }
}
for (const b of document.querySelectorAll(".try-sample")) b.onclick = trySample;

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
    ...scanSettings,
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
    track("read-ok", `${pages.length} page${pages.length === 1 ? "" : "s"}`);
  } catch (e) {
    pageLabel = "";
    track("read-failed");
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
  if (files.length) openFiles(files);
};

// Score files (shared from Partsong) and MusicXML, from the picker or the
// share sheet; an ordinary PDF starts a new scan.
async function openFiles(files) {
  try {
    const xmls = [];
    const pdfs = [];
    let name = "";
    for (const f of files) {
      const shared = await readScoreFile(f);
      if (shared) {
        await importScore(shared);
        continue;
      }
      if (await isPdf(f)) {
        pdfs.push(f);
        continue;
      }
      const text = await f.text();
      try {
        parsePage(text);
      } catch {
        throw new Error(`${f.name || "it"} isn't a Partsong score, a PDF or a MusicXML file`);
      }
      xmls.push(text);
      name ||= f.name.replace(/\.(musicxml|xml)$/i, "");
    }
    if (pdfs.length) {
      loadScan();
      await addFiles(pdfs);
    }
    if (!xmls.length) return;
    const title = parsePage(xmls[0]).title || name || "Imported score";
    await importScore({ id: crypto.randomUUID(), title, created: Date.now(), pages: xmls, images: [] });
  } catch (err) {
    $("library-status").textContent = `Couldn't open that file: ${err.message}`;
  }
}

// Imports never overwrite: a score already here (same id or same name) is
// kept, and the new one gets a fresh id and a numbered name, "Title (2)".
async function asNewScore(entry) {
  const lib = await db.all();
  if (lib.some((e) => e.id === entry.id)) entry.id = crypto.randomUUID();
  const titles = new Set(lib.map((e) => e.title));
  const base = entry.title;
  for (let n = 2; titles.has(entry.title); n++) entry.title = `${base} (${n})`;
  return entry;
}

async function importScore(entry) {
  await db.put(await asNewScore(entry));
  openScore(entry);
}

// Shares a library score as a link (through the relay, see share.js), or as
// the PDF when asked or when the relay couldn't take it. Preparing can outlast
// the browser's "just tapped" window for the share sheet; then it's kept and
// the next tap shares it straight away.
let prepared = null; // { id, asPdf, file, link, title }
async function shareScore(id, button, status, asPdf = false) {
  button.disabled = true;
  try {
    if (prepared?.id !== id || prepared.asPdf !== asPdf) {
      status.textContent = "Preparing…";
      const entry = (await db.all()).find((e) => e.id === id);
      const made = asPdf ? { file: await scoreFile(entry), link: null } : await shareableScore(entry);
      prepared = { id, asPdf, ...made, title: entry.title };
    }
    const linked = !!prepared.link;
    const how = linked ? await shareLink(prepared.link, prepared.title) : await shareFile(prepared.file, prepared.title);
    if (how === "shared" || how === "downloaded" || how === "copied") track(linked ? "share" : "share-pdf");
    if (how !== "retry") prepared = null;
    status.textContent = {
      shared: linked || asPdf ? "Shared." : "Shared as a PDF (the link service didn't respond).",
      copied: "Link copied: paste it into a message.",
      downloaded: "Saved to Downloads.",
      cancelled: "",
      retry: "Ready. Tap share again.",
    }[how];
  } catch (e) {
    prepared = null;
    status.textContent = `Couldn't share: ${e.message}`;
  } finally {
    button.disabled = false;
    clearTimeout(shareScore.timer);
    if (!prepared) shareScore.timer = setTimeout(() => (status.textContent = ""), 4000);
  }
}

$("share").onclick = () => shareScore(current.id, $("share"), $("share-status"));
// An audio file of what Play plays (bars, repeats, your part, the others'
// volume, sound, tempo and pitch), rendered offline, to share: e.g. for
// someone to learn their part from on the way to rehearsal. Two taps: the
// share sheet only opens within a few seconds of a tap, and rendering can take
// longer on a phone, so "Prepare audio" makes the file and the button becomes
// "Share audio". Changing anything that's heard makes it "Prepare audio" again.
let preparedAudio = null; // { key, file, part }
function audioKey() {
  return JSON.stringify([current?.id, playSegments(), current.mine, current.manual, current.excluded, current.octave, othersGain, $("instrument").value, $("tempo").value]);
}
// Called when the settings panel opens: the label follows what's prepared.
function updateAudioButton() {
  const ready = preparedAudio && preparedAudio.key === audioKey();
  $("share-audio").textContent = ready ? "Share audio" : "Prepare audio";
  if (!ready) $("share-audio-status").textContent = "";
}
$("share-audio").onclick = async () => {
  const button = $("share-audio");
  const status = $("share-audio-status");
  button.disabled = true;
  try {
    const key = audioKey();
    if (preparedAudio?.key !== key) {
      status.textContent = "Making the audio…";
      const part = hasMarks() ? "my part" : (score.lines[current.mine]?.label ?? "part");
      const renderer = new Player(score);
      renderer.mix = player.mix;
      renderer.bpm = Number($("tempo").value);
      renderer.instrument = $("instrument").value;
      const name = `${current.title} - ${part}`.replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
      preparedAudio = { key, part, file: await audioFile(await renderer.render(playSegments(), AUDIO_RATE), name) };
      button.textContent = "Share audio";
      status.textContent = "Ready.";
      return;
    }
    const how = await shareFile(preparedAudio.file, `${current.title} (${preparedAudio.part})`);
    if (how === "shared" || how === "downloaded") track("share-audio");
    status.textContent = { shared: "Shared.", downloaded: "Saved to Downloads.", cancelled: "", retry: "Tap Share audio again." }[how];
  } catch (e) {
    preparedAudio = null;
    button.textContent = "Prepare audio";
    status.textContent = `Couldn't make the audio: ${e.message}`;
  } finally {
    button.disabled = false;
  }
};

// The PDF itself: a copy that keeps working after the link expires.
$("share-pdf").onclick = () => shareScore(current.id, $("share-pdf"), $("share-pdf-status"), true);

// A copy of a score (photos, music, marks, settings), unlocked and named
// "Title (2)", added to the list (rename it when you open it), e.g. to mark up
// first and second sopranos as separate scores.
async function copyScore(id) {
  const original = (await db.all()).find((e) => e.id === id);
  const copy = await asNewScore({ ...original, id: crypto.randomUUID(), created: Date.now(), locked: false });
  await db.put(copy);
  await renderLibrary();
  document.querySelector(`#library li[data-id="${copy.id}"]`)?.classList.add("just-added");
  $("library-status").textContent = `Copied as “${copy.title}”. Open it to rename.`;
  clearTimeout(shareScore.timer);
  shareScore.timer = setTimeout(() => ($("library-status").textContent = ""), 5000);
}

// A score shared by link (#s=<id>.<key>): fetched from the relay and
// decrypted, then offered like any other. If the relay can't supply it, say
// what to do: try again, or ask for it again (a link lasts a year).
async function receiveFromRelay() {
  const fragment = location.hash.slice(1);
  history.replaceState(null, "", location.pathname);
  $("library-status").textContent = "Fetching the shared score…";
  let entry = null;
  let failure = "";
  for (let attempt = 0; attempt < 2 && !entry && !failure.includes("404"); attempt++) {
    entry = await entryFromRelay(fragment).catch((e) => ((failure = e.message), null));
    if (!entry && !attempt) await new Promise((r) => setTimeout(r, 3000));
  }
  $("library-status").textContent = "";
  if (entry) offerImport(entry);
  else
    showNotice(
      failure.includes("404")
        ? "This link has expired. Ask for the score to be shared again (or sent with Share Partsong score, which doesn't expire)."
        : "Couldn't fetch this score just now. Check your connection and tap the link again.",
    );
}

// A score handed over by an older .partsong.html file opened in the browser (from
// WhatsApp, email…): carried in the link itself (#import=…, without photos)
// and, with &receive, posted in full by the page that opened us when it can
// (an installed app opened from the link has no way back to that page). Older
// files sent only #receive. Always asks first, since any page could try this.
async function receiveFromPage() {
  const hash = location.hash;
  history.replaceState(null, "", location.pathname);
  let entry = null;
  try {
    const [, payload, receive] = hash.match(/^#import=([\w-]+)(&receive)?/) ?? [];
    // Files from before the link carried the score: nothing to fall back on.
    if (hash === "#receive" && !window.opener) throw new Error("it was sent from an older version of Partsong. Ask for it to be shared again");
    if ((receive || hash === "#receive") && window.opener) {
      const json = await fromOpener().catch(() => null);
      if (json) entry = parseScoreFile(json);
    }
    if (!entry && payload) entry = await entryFromLink(payload);
    if (!entry) throw new Error("the score didn't arrive");
  } catch (e) {
    showError(`Couldn't open the shared score: ${e.message}`);
  }
  if (entry?.photosLeftOut) {
    // Only the music came through the link (the installed app can't reach the
    // file's page): don't add a copy without its photos.
    showNotice(
      `“${entry.title}” has photos of its pages, which can't come across this way. ` +
        "Go back to the message, press and hold the file, tap Share and choose Partsong.",
    );
  } else if (entry) offerImport(entry);
}

function showNotice(text) {
  $("import-question").textContent = text;
  $("import-yes").hidden = true;
  $("import-no").textContent = "OK";
  $("import-no").onclick = () => ($("import-offer").hidden = true);
  $("import-offer").hidden = false;
}

// The full score (with photos) posted by the .partsong.html page that opened us.
function fromOpener() {
  return new Promise((resolve, reject) => {
    addEventListener("message", (e) => {
      if (e.source !== window.opener || e.data?.type !== "partsong-score") return;
      clearInterval(ping);
      resolve(e.data.json);
    });
    const ping = setInterval(() => window.opener?.postMessage("partsong-ready", "*"), 250);
    setTimeout(() => {
      clearInterval(ping);
      reject(new Error("the score didn't arrive"));
    }, 8000);
  });
}

// done() runs once the question is answered either way; if it returns false
// the score is no longer on offer (another window took it).
async function offerImport(entry, done = () => {}) {
  await asNewScore(entry);
  const pages = `${entry.pages.length} page${entry.pages.length === 1 ? "" : "s"}`;
  $("import-question").textContent = `Add “${entry.title}” (${pages}) to your scores?`;
  $("import-yes").hidden = false;
  $("import-no").textContent = "Cancel";
  $("import-offer").hidden = false;
  $("import-yes").onclick = async () => {
    $("import-offer").hidden = true;
    if ((await done()) === false) return;
    await importScore(entry);
  };
  $("import-no").onclick = () => {
    $("import-offer").hidden = true;
    done();
  };
}

// Files shared to the installed app arrive via the service worker's inbox.
// A score file asks first, as from its page's link, and stays in the inbox
// until answered: Android can launch the app twice for one share, and the
// second launch reloads the page.
async function openInbox() {
  const cache = await caches.open("partscanner-inbox");
  const keys = await cache.keys();
  if (!keys.length) return;
  const scans = [];
  const others = [];
  for (const req of keys) {
    const res = await cache.match(req);
    const name = decodeURIComponent(res.headers.get("x-name") || "shared");
    const f = new File([await res.blob()], name, { type: res.headers.get("content-type") || "" });
    const shared = await readScoreFile(f).catch(() => null);
    if (shared) {
      await offerImport(shared, () => cache.delete(req));
      continue;
    }
    if (!(await cache.delete(req))) continue; // another window took it
    if (f.type.startsWith("image/") || (await isPdf(f))) scans.push(f);
    else others.push(f);
  }
  if (others.length) await openFiles(others);
  if (scans.length) {
    loadScan();
    await addFiles(scans);
  }
}

// A share can land after the page has looked (see above), or while it's in
// the background: look again when told, and when it comes back to the screen.
navigator.serviceWorker?.addEventListener("message", (e) => e.data?.type === "inbox" && openInbox());
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && "caches" in window && openInbox());

// ---------- practice ----------

let player;
let playTracked = false; // count the first play of each opened score only
let current; // library entry
let score;

function openScore(entry, nav = "push") {
  const partChosen = entry.mine != null || Object.keys(entry.manual ?? {}).length > 0; // before defaults below
  current = entry;
  score = buildScore(entry.pages.map(parsePage));
  player?.stop();
  player = new Player(score);
  playTracked = false;
  player.onPosition = (beat) => {
    $("position").textContent = `Bar ${barAt(beat).number}`;
    follow(beat);
    followRead(beat);
  };
  player.onEnd = () => setPlaying(false);
  player.mix = (lineId, t) => {
    if (lineId === myLineAt(t)) return { gain: 1, shift: 12 * current.octave };
    // Marked scores play every line, except a piano part left switched off.
    if (current.excluded.includes(lineId) && (!hasMarks() || score.lines[lineId].accompaniment)) return { gain: 0 };
    return { gain: othersGain, shift: 0 };
  };

  $("title").value = entry.title;
  $("share-status").textContent = "";
  $("share-pdf-status").textContent = "";
  $("share-audio-status").textContent = "";
  $("to-bar").value = score.measures.length;
  $("from-bar").value = 1;
  $("from-bar").max = $("to-bar").max = score.measures.length;
  $("tempo").value = entry.tempo ?? 80;
  $("others").value = entry.others ?? 25;
  const soprano = score.lines.findIndex((l) => l.label === "Soprano");
  current.mine = Math.min(entry.mine ?? Math.max(0, soprano), score.lines.length - 1);
  current.excluded = entry.excluded ?? score.lines.filter((l) => l.accompaniment).map((l) => l.id);
  current.manual = entry.manual ?? {};
  repairReferences();
  current.octave = entry.octave ?? 0;
  $("octave").value = String(current.octave);
  current.repeats = entry.repeats ?? {};
  current.playRepeats = entry.playRepeats ?? true;
  renderRepeats();
  renderLines();
  renderPartChoice();
  applyLock();
  applyMix();
  updateLabels();
  player.bpm = Number($("tempo").value);
  player.instrument = $("instrument").value;
  $("position").textContent = "Bar 1";
  setPlaying(false);
  resumeAt = null;
  $("osmd").replaceChildren();
  osmdFor = null;
  show("practice", nav);
  // New scans (no part chosen yet) and photo-less scores start with settings open.
  $("panel").hidden = $("panel-backdrop").hidden = true;
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
  const note = mine != null && score.lines[mine]?.notes.find((n) => n.t <= beat + 1e-6 && beat < n.t + n.dur);
  if (note?.pos && note.pos.page === bar.page) {
    // Across the bar, the onset's average position is steadier than one note's.
    const cx = onsets.find((o) => Math.abs(o.t - note.t) < 1e-6)?.x ?? note.pos.x;
    showEl(view.note, { cx, cy: note.pos.y, r: view.w * 0.011 });
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

// Scores saved by an older version can refer to lines or systems that no
// longer exist once the music is re-analysed; drop those references.
function repairReferences() {
  const okLine = (id) => Number.isInteger(Number(id)) && Number(id) >= 0 && Number(id) < score.lines.length;
  const manual = Object.fromEntries(
    Object.entries(current.manual).filter(([sys, id]) => okLine(id) && Number(sys) < score.systems.length),
  );
  const excluded = current.excluded.filter(okLine);
  const changed = Object.keys(manual).length !== Object.keys(current.manual).length || excluded.length !== current.excluded.length;
  if (!okLine(current.mine)) {
    const soprano = score.lines.findIndex((l) => l.label === "Soprano");
    current.mine = Math.max(0, soprano);
  }
  current.manual = manual;
  current.excluded = excluded;
  if (changed) updateEntry(current.id, { manual, excluded, mine: current.mine });
}

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

// The sound is a preference for this device, not part of a score.
const INSTRUMENT_KEY = "partsong-instrument";
try {
  const saved = localStorage.getItem(INSTRUMENT_KEY);
  if ([...$("instrument").options].some((o) => o.value === saved)) $("instrument").value = saved;
} catch {}
$("instrument").onchange = () => {
  if (player) player.instrument = $("instrument").value;
  try {
    localStorage.setItem(INSTRUMENT_KEY, $("instrument").value);
  } catch {}
};

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

// Each repeat the reader found, with the bar it goes back to. A forward repeat
// at the start of a line is easy to miss, so the start can be corrected here.
function renderRepeats() {
  const ends = score.measures.filter((m) => m.repeatBackward);
  $("repeats").hidden = !ends.length;
  $("play-repeats").checked = current.playRepeats !== false;
  $("repeat-list").replaceChildren(
    ...ends.map((m) => {
      const li = document.createElement("li");
      li.innerHTML = `<span></span> goes back to bar <input type="number" min="1" inputmode="numeric">`;
      li.querySelector("span").textContent = `Repeat at bar ${m.number}`;
      const input = li.querySelector("input");
      input.max = m.number;
      input.value = current.repeats[m.number] ?? m.repeatTo + 1;
      input.disabled = current.playRepeats === false;
      input.onchange = () => {
        const bar = Math.min(m.number, Math.max(1, Math.round(Number(input.value)) || m.repeatTo + 1));
        input.value = bar;
        current.repeats = { ...current.repeats, [m.number]: bar };
        updateEntry(current.id, { repeats: current.repeats });
        restartIfPlaying();
      };
      return li;
    }),
  );
}
$("play-repeats").onchange = () => {
  current.playRepeats = $("play-repeats").checked;
  updateEntry(current.id, { playRepeats: current.playRepeats });
  renderRepeats();
  restartIfPlaying();
};

function restartIfPlaying() {
  resumeAt = null;
  if (player?.playing) startPlayback();
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

function barNumbers() {
  const n = score.measures.length;
  const from = Math.min(Math.max(1, Number($("from-bar").value) || 1), n);
  const to = Math.min(Math.max(from, Number($("to-bar").value) || n), n);
  return [from, to];
}

function barRange() {
  const [from, to] = barNumbers();
  const last = score.measures[to - 1];
  return [score.measures[from - 1].start, last.start + last.length];
}

// What to play for the chosen bars: stretches of the score in order, taking
// repeats (unless switched off) with any corrected repeat starts.
function playSegments() {
  const [from, to] = barNumbers();
  const targets = Object.fromEntries(Object.entries(current.repeats ?? {}).map(([bar, toBar]) => [bar - 1, toBar - 1]));
  const order = current.playRepeats === false
    ? Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i)
    : playOrder(score.measures, from - 1, to - 1, targets);
  const segments = [];
  for (const i of order) {
    const m = score.measures[i];
    const last = segments.at(-1);
    if (last && Math.abs(last.to - m.start) < 1e-6) last.to = m.start + m.length;
    else segments.push({ from: m.start, to: m.start + m.length });
  }
  return segments;
}

// After a pause: where playback stopped (in the score and along the play
// order), so play carries on from there, including on a repeat's second time.
let resumeAt = null; // { beat, offset, key }
const rangeKey = () => JSON.stringify([barNumbers(), current.repeats, current.playRepeats]);

function startPlayback(offset = 0) {
  // Treat the first bar as new, so it's scrolled into view.
  followedBar = null;
  readBar = null;
  player.play(playSegments(), offset, $("loop").checked);
}

function setPlaying(on) {
  $("play").classList.toggle("playing", on);
  $("play").setAttribute("aria-label", on ? "Pause" : "Play");
}

// nav=false when responding to the back button (history already moved).
function setPanel(open, nav = true) {
  const wasOpen = !$("panel").hidden;
  $("panel").hidden = !open;
  $("panel-backdrop").hidden = !open;
  $("settings").setAttribute("aria-expanded", String(open));
  if (open && current) updateAudioButton();
  if (!nav || open === wasOpen) return;
  if (open) history.pushState({ screen: "practice", panel: true }, "");
  else if (history.state?.panel) history.back();
}
$("settings").onclick = () => setPanel($("panel").hidden);
// "?" buttons show and hide the explanation they point at.
for (const q of document.querySelectorAll(".q")) {
  q.onclick = () => {
    const help = $(q.getAttribute("aria-controls"));
    help.hidden = !help.hidden;
    q.setAttribute("aria-expanded", String(!help.hidden));
  };
}
// A change to anything that's heard means the audio needs preparing again.
for (const type of ["input", "change"]) $("panel").addEventListener(type, () => current && updateAudioButton());
$("panel-close").onclick = () => setPanel(false);
$("panel-backdrop").onclick = () => setPanel(false);

// Swipe the panel's handle down to close it.
{
  let startY = null;
  const head = $("panel-head");
  head.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button")) return;
    startY = e.clientY;
    try {
      head.setPointerCapture(e.pointerId);
    } catch {}
  });
  head.addEventListener("pointermove", (e) => {
    if (startY == null) return;
    $("panel").style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`;
  });
  const end = (e) => {
    if (startY == null) return;
    const dragged = e.clientY - startY;
    startY = null;
    $("panel").style.transform = "";
    if (dragged > 60) setPanel(false);
  };
  head.addEventListener("pointerup", end);
  head.addEventListener("pointercancel", end);
}

$("play").onclick = () => {
  if (player.playing) {
    player.stop();
    resumeAt = { beat: player.position(), offset: player.offset(), key: rangeKey() };
    return;
  }
  const offset = resumeAt?.key === rangeKey() ? resumeAt.offset : 0;
  resumeAt = null;
  startPlayback(offset);
  setPlaying(true);
  if (!playTracked) track("play", hasMarks() ? "play (marked)" : "play");
  playTracked = true;
};

$("rewind").onclick = () => {
  resumeAt = null;
  const [from, to] = barRange();
  if (player.playing) startPlayback();
  else {
    showBar(from);
    $("position").textContent = `Bar ${barAt(from).number}`;
  }
};

for (const id of ["from-bar", "to-bar", "loop"]) {
  $(id).onchange = () => {
    resumeAt = null;
    const [from, to] = barRange();
    if (player.playing) startPlayback();
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
      $("delete").textContent = "Delete";
    }, 3000);
    return;
  }
  $("delete").dataset.confirm = "";
  $("delete").textContent = "Delete";
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
const currentBeat = () => (player?.playing ? player.position() : resumeAt?.beat ?? barRange()[0]);

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

if (location.hash.startsWith("#s=")) {
  renderLibrary().then(receiveFromRelay);
} else if (/^#(receive|import=)/.test(location.hash)) {
  renderLibrary().then(receiveFromPage);
} else if (new URLSearchParams(location.search).has("inbox")) {
  history.replaceState(null, "", location.pathname);
  renderLibrary()
    .then(openInbox)
    .catch((e) => showError(`Couldn't open the shared file: ${e.message}`));
} else if (new URLSearchParams(location.search).has("open-file")) {
  // The files themselves come through launchQueue (above).
  history.replaceState(null, "", location.pathname);
  renderLibrary();
} else {
  // A share whose launch never finished (e.g. stuck offline) is still waiting.
  renderLibrary().then(async () => ((await (await caches.open("partscanner-inbox")).keys()).length ? openInbox() : resumeUnfinished()));
}

// PDFs opened with Partsong from the system's "Open with" (manifest
// file_handlers: desktop Chrome/Edge, and Android where Chrome supports it):
// a score file is offered, an ordinary PDF starts a new scan.
window.launchQueue?.setConsumer(async ({ files: handles }) => {
  const scans = [];
  for (const handle of handles ?? []) {
    const f = await handle.getFile();
    const shared = await readScoreFile(f).catch(() => null);
    if (shared) await offerImport(shared);
    else scans.push(f);
  }
  if (scans.length) {
    loadScan();
    await addFiles(scans);
  }
});

// A link tapped while Partsong is already open (e.g. the installed app) only
// changes the #fragment, without reloading.
addEventListener("hashchange", () => {
  if (location.hash.startsWith("#s=")) receiveFromRelay();
  else if (/^#(receive|import=)/.test(location.hash)) receiveFromPage();
});
