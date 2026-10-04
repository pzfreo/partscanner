// Sound setting: the three sounds each render audible audio (first 16 bars of
// the sample, all parts, offline), and the choice is remembered on the device.
// Returns each rendering as base64 WAV for listening. Run against /index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $ = (id) => document.getElementById(id);
const { Player } = await import("/player.js");
const { parsePage, buildScore } = await import("/score.js");
const xml = await (await fetch("/samples/joyful-joyful.musicxml")).text();
const score = buildScore([parsePage(xml)]);
const r = { options: [...$("instrument").options].map((o) => o.value), sounds: {} };
const toWav = (buf) => {
  const d = buf.getChannelData(0), n = d.length, b = new DataView(new ArrayBuffer(44 + n * 2));
  const w = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  w(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); w(8, "WAVEfmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, buf.sampleRate, true); b.setUint32(28, buf.sampleRate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, "data"); b.setUint32(40, n * 2, true);
  let peak = 0; for (const v of d) peak = Math.max(peak, Math.abs(v));
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, d[i] / (peak || 1) * 0.9)) * 32767, true);
  let s = ""; const u = new Uint8Array(b.buffer); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
};
const BPM = 100, BEATS = 64;
for (const name of r.options) {
  const ctx = new OfflineAudioContext(1, 22050 * (BEATS * 60 / BPM + 1), 22050);
  const p = new Player(score);
  p.instrument = name; p.ctx = ctx; p.master = ctx.createGain(); p.master.gain.value = 0.8; p.master.connect(ctx.destination);
  score.lines.forEach((line) => { for (const n of line.notes) if (n.t < BEATS) p.note(n.midi, 1, n.t * 60 / BPM, n.dur * 60 / BPM); });
  const buf = await ctx.startRendering();
  const d = buf.getChannelData(0); let sq = 0, peak = 0; for (const v of d) { sq += v * v; peak = Math.max(peak, Math.abs(v)); }
  r.sounds[name] = { rms: +Math.sqrt(sq / d.length).toFixed(4), peak: +peak.toFixed(3), wav: toWav(buf) };
}
$("instrument").value = "organ"; $("instrument").dispatchEvent(new Event("change"));
r.saved = localStorage.getItem("partsong-instrument");
window.result = r;
