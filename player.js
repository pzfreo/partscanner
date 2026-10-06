// Web Audio playback of score lines. `mix(lineId, t)` decides each note's
// volume (0 = silent) and octave shift when it is scheduled, so your part can
// change from system to system.

// Seconds of notes queued ahead. Generous so a busy main thread (e.g. drawing
// the score on a phone) doesn't starve the audio; mix changes apply to notes
// queued after the change.
const LOOKAHEAD = 1.0;
const MAX_LATE = 0.03; // after a longer stall, skip overdue notes rather than burst
const TICK_MS = 50;

const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

export class Player {
  constructor(score) {
    this.score = score;
    this.bpm = 80;
    this.instrument = "piano";
    this.mix = () => ({ gain: 1, shift: 0 });
    this.ctx = null;
    this.playing = false;
    this.onPosition = null;
    this.onEnd = null;
  }

  ensureContext() {
    if (this.ctx) return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp).connect(this.ctx.destination);
  }

  setTempo(bpm) {
    const at = this.playing ? this.offset() : null;
    this.bpm = bpm;
    if (at != null) this.play(this.segments, at, this.loop);
  }

  // Playback runs through `segments`, stretches of the score in quarter notes
  // ({from, to}), in order: with repeats, the same stretch can come twice.
  // offset() is how far into them playback is; position() is where that is
  // in the score.
  offset() {
    if (!this.playing) return this.startOffset ?? 0;
    return this.startOffset + ((this.ctx.currentTime - this.startTime) * this.bpm) / 60;
  }

  position() {
    // Not before the start: during the short lead-in, offset() is slightly
    // less, which after a repeat would point at the end of the previous pass.
    const o = Math.max(this.startOffset ?? 0, this.offset());
    const seg = this.segments?.findLast((s) => s.at <= o + 1e-6) ?? this.segments?.[0];
    if (!seg) return 0;
    return Math.min(seg.to, seg.from + Math.max(0, o - seg.at));
  }

  play(segments, startOffset = 0, loop = false) {
    this.ensureContext();
    this.stop(false);
    this.ctx.resume();
    let at = 0;
    this.segments = segments.map((s) => {
      const seg = { ...s, at };
      at += s.to - s.from;
      return seg;
    });
    this.total = at;
    this.playing = true;
    this.loop = loop;
    this.startOffset = startOffset;
    this.startTime = this.ctx.currentTime + 0.1;
    this.scheduledUntil = startOffset;
    this.timer = setInterval(() => this.schedule(), TICK_MS);
    this.schedule();
    // A failing display update must not stop the loop (or the counter freezes).
    const frame = () => {
      if (!this.playing) return;
      this.raf = requestAnimationFrame(frame);
      try {
        this.onPosition?.(this.position());
      } catch (e) {
        reportError(e);
      }
    };
    frame();
  }

  stop(notify = true) {
    if (!this.playing) return;
    this.startOffset = this.offset();
    this.playing = false;
    clearInterval(this.timer);
    cancelAnimationFrame(this.raf);
    for (const o of this.active ?? []) o.stop();
    this.active = [];
    if (notify) this.onEnd?.();
  }

  schedule() {
    const secPerBeat = 60 / this.bpm;
    const horizon = this.startOffset + (this.ctx.currentTime + LOOKAHEAD - this.startTime) / secPerBeat;
    const from = this.scheduledUntil;
    const to = Math.min(horizon, this.total);
    if (to > from) {
      this.eachNote(this.segments, from, to, (midi, gain, o, dur) => {
        const when = this.startTime + (o - this.startOffset) * secPerBeat;
        if (when >= this.ctx.currentTime - MAX_LATE) this.note(midi, gain, when, dur * secPerBeat);
      });
      this.scheduledUntil = to;
    }
    if (horizon >= this.total) {
      if (this.loop) {
        // Restart the timeline so the start lands exactly at the end.
        this.startTime += (this.total - this.startOffset) * secPerBeat;
        this.startOffset = 0;
        this.scheduledUntil = 0;
      } else if (this.ctx.currentTime > this.startTime + (this.total - this.startOffset) * secPerBeat) {
        this.stop();
      }
    }
  }

  // Calls fn(midi, gain, offset, duration) for each audible note whose offset
  // along `segments` (with their `at`) is in [from, to), as mixed now.
  eachNote(segments, from, to, fn) {
    for (const seg of segments) {
      if (seg.at + (seg.to - seg.from) <= from || seg.at >= to) continue;
      this.score.lines.forEach((line, i) => {
        for (const n of line.notes) {
          if (n.t < seg.from || n.t >= seg.to) continue;
          const o = seg.at + (n.t - seg.from);
          if (o < from || o >= to) continue;
          const { gain, shift = 0 } = this.mix(i, n.t);
          if (gain > 0) fn(n.midi + shift, gain, o, Math.min(n.dur, seg.to - n.t));
        }
      });
    }
  }

  // The same playback rendered offline, as fast as it can (for an audio file):
  // mono AudioBuffer at `rate`, with the current mix, sound and tempo.
  async render(segments, rate = 22050) {
    const secPerBeat = 60 / this.bpm;
    let at = 0;
    const segs = segments.map((s) => {
      const seg = { ...s, at };
      at += s.to - s.from;
      return seg;
    });
    const ctx = new OfflineAudioContext(1, Math.ceil(rate * (at * secPerBeat + 1.5)), rate);
    const live = [this.ctx, this.master, this.waves, this.active];
    this.ctx = ctx;
    this.waves = {};
    this.active = [];
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(ctx.createDynamicsCompressor()).connect(ctx.destination);
    try {
      this.eachNote(segs, 0, at, (midi, gain, o, dur) => this.note(midi, gain, 0.1 + o * secPerBeat, dur * secPerBeat));
      return await ctx.startRendering();
    } finally {
      [this.ctx, this.master, this.waves, this.active] = live;
    }
  }

  // Three built-in sounds, synthesised (no sample downloads):
  // piano (struck, fading), organ (steady) and voice (a soft "oo" with vibrato).
  note(midi, gain, when, duration) {
    const ctx = this.ctx;
    const hz = midiToHz(midi);
    const end = when + Math.max(0.05, duration - 0.03);
    const osc = ctx.createOscillator();
    osc.frequency.value = hz;
    const env = ctx.createGain();
    const sources = [osc];
    let out = osc;
    env.gain.setValueAtTime(0, when);
    if (this.instrument === "organ") {
      osc.setPeriodicWave(this.wave("organ", [0, 1, 0.55, 0.3, 0.18, 0.08, 0.05]));
      env.gain.linearRampToValueAtTime(0.16 * gain, when + 0.03);
    } else if (this.instrument === "voice") {
      osc.type = "sawtooth";
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = Math.min(1100, hz * 2.5);
      filter.Q.value = 1.5;
      // Vibrato that eases in after the start of the note, as singers do.
      const lfo = ctx.createOscillator();
      const depth = ctx.createGain();
      lfo.frequency.value = 5.5;
      depth.gain.setValueAtTime(0, when);
      depth.gain.linearRampToValueAtTime(hz * 0.006, when + 0.4);
      lfo.connect(depth).connect(osc.frequency);
      lfo.start(when);
      lfo.stop(end + 0.3);
      sources.push(lfo);
      out = osc.connect(filter);
      env.gain.linearRampToValueAtTime(0.3 * gain, when + 0.08);
    } else {
      osc.setPeriodicWave(this.wave("piano", [0, 1, 0.45, 0.2, 0.12, 0.05]));
      env.gain.linearRampToValueAtTime(0.3 * gain, when + 0.008);
      env.gain.setTargetAtTime(0.06 * gain, when + 0.008, 0.35);
    }
    env.gain.setTargetAtTime(0, end, this.instrument === "piano" ? 0.05 : 0.04);
    out.connect(env).connect(this.master);
    osc.start(when);
    osc.stop(end + 0.3);
    this.active ??= [];
    this.active.push(...sources);
    osc.onended = () => {
      for (const s of sources) {
        const i = this.active.indexOf(s);
        if (i >= 0) this.active.splice(i, 1);
      }
    };
  }

  wave(name, harmonics) {
    this.waves ??= {};
    return (this.waves[name] ??= this.ctx.createPeriodicWave(new Float32Array(harmonics.length), new Float32Array(harmonics)));
  }
}
