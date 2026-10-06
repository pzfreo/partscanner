// Share audio: what Play plays, rendered offline to an .m4a (AAC) where the
// browser can encode it, else .wav. Seeds Huron from testdata.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const idb = (mode, fn) => new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", mode); const out = fn(tx.objectStore("scores")); tx.oncomplete = () => res(out?.result ?? out); }; });
const pages = await Promise.all([0, 1, 2, 3].map((i) => fetch(`/testdata/huron_${i}.musicxml`).then((r) => r.text())));
await idb("readwrite", (s) => s.put({ id: "aud-1", title: "Huron Carol", created: 5, pages, images: [], mine: 2, tempo: 120, others: 25 }));
$("new-scan").click(); history.back(); await sleep(400);
await waitFor(() => document.querySelector('#library li[data-id="aud-1"] button'), 5000, "library").then((b) => b.click());
await sleep(800);

let shared;
Object.defineProperty(navigator, "userAgentData", { value: { mobile: true }, configurable: true });
// As Chrome's share sheet: only its permitted file types (audio/mp4 isn't one).
const PERMITTED = ["audio/x-m4a", "audio/wav", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/webm", "audio/flac"];
navigator.canShare = ({ files }) => files.every((f) => PERMITTED.includes(f.type));
navigator.share = async ({ files, title }) => { shared = { file: files[0], title }; };
const shareAudio = async () => {
  shared = null;
  $("settings").click(); await sleep(300);
  const t0 = performance.now();
  // As on a phone where making the file outlasts the tap: the share sheet
  // refuses the first time, so it says it's ready and the next tap shares.
  const realShare = navigator.share;
  navigator.share = async () => { throw new DOMException("expired", "NotAllowedError"); };
  $("share-audio").click();
  const preparing = await waitFor(() => $("share-audio-status").textContent, 5000, "preparing");
  const ready = await waitFor(() => /Ready|Couldn't/.test($("share-audio-status").textContent) && $("share-audio-status").textContent, 120000, "ready");
  const ms = Math.round(performance.now() - t0);
  navigator.share = realShare;
  $("share-audio").click();
  await waitFor(() => shared || $("share-audio-status").textContent.startsWith("Couldn't"), 10000, "audio share");
  const before = preparing, after = ready, label = $("share-audio").textContent;
  $("panel-close").click(); await sleep(200);
  if (!shared) return { error: $("share-audio-status").textContent };
  const buf = await new AudioContext().decodeAudioData(await shared.file.arrayBuffer());
  const d = buf.getChannelData(0);
  let sq = 0; for (const v of d) sq += v * v;
  return { label, statuses: [before, after, $("share-audio-status").textContent], name: shared.file.name, type: shared.file.type, kb: Math.round(shared.file.size / 1024), seconds: +buf.duration.toFixed(1), rms: +Math.sqrt(sq / d.length).toFixed(4), title: shared.title, ms };
};
const r = {};
const bars = Number($("to-bar").value);
r.expectedSeconds = null;
r.m4a = await shareAudio();
r.status = $("share-audio-status").textContent;
// Part alone: others at 0 makes a quieter file of the same length.
$("others").value = 0; $("others").dispatchEvent(new Event("input"));
r.partAlone = await shareAudio();
// Without AAC encoding (e.g. Firefox): WAV.
const enc = window.AudioEncoder;
delete window.AudioEncoder;
$("others").value = 25; $("others").dispatchEvent(new Event("input"));
$("tempo").value = 121; $("tempo").dispatchEvent(new Event("input")); // a change, so it renders again
r.wav = await shareAudio();
// Reopening the panel with nothing changed: still ready to share.
$("settings").click(); await sleep(300);
r.reopenedStatus = $("share-audio-status").textContent;
$("panel-close").click(); await sleep(200);
window.AudioEncoder = enc;
r.bars = bars;
window.result = r;
