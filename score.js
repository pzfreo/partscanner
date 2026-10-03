// Turns per-page MusicXML (from homr or any other source) into playable lines.
// Times are in quarter notes from the start of the piece.

const STEPS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function num(el, tag, fallback = 0) {
  const v = el.querySelector(tag)?.textContent;
  return v == null ? fallback : Number(v);
}

// homr writes each note's position in the input photo as a comment.
function imagePosition(note) {
  for (const c of note.childNodes) {
    const m = c.nodeType === Node.COMMENT_NODE && /imgpos:\s*(-?\d+),\s*(-?\d+)/.exec(c.data);
    if (m) return { x: Number(m[1]), y: Number(m[2]) };
  }
  return null;
}

export function parsePage(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Not valid MusicXML");
  const title = doc.querySelector("work-title, movement-title")?.textContent?.trim() || "";
  const parts = [...doc.querySelectorAll("score-partwise > part")].map((part) => {
    let divisions = 1;
    let staves = 1;
    let timeLength = 4;
    const measures = [...part.children].filter((m) => m.tagName === "measure").map((measure) => {
      const notes = [];
      let pos = 0;
      let maxPos = 0;
      let lastStart = 0;
      for (const el of measure.children) {
        if (el.tagName === "attributes") {
          divisions = num(el, "divisions", divisions);
          staves = Math.max(staves, num(el, "staves", staves));
          const time = el.querySelector("time");
          if (time) timeLength = (num(time, "beats", 4) * 4) / num(time, "beat-type", 4);
        } else if (el.tagName === "backup") {
          pos -= num(el, "duration") / divisions;
        } else if (el.tagName === "forward") {
          pos += num(el, "duration") / divisions;
        } else if (el.tagName === "note") {
          if (el.querySelector("grace")) continue;
          const dur = num(el, "duration") / divisions;
          const chord = !!el.querySelector("chord");
          const start = chord ? lastStart : pos;
          if (!chord) {
            lastStart = pos;
            pos += dur;
          }
          const pitch = el.querySelector("pitch");
          notes.push({
            start,
            dur,
            staff: num(el, "staff", 1),
            voice: el.querySelector("voice")?.textContent || "1",
            midi: pitch
              ? 12 * (num(pitch, "octave") + 1) + STEPS[pitch.querySelector("step").textContent] + num(pitch, "alter")
              : null,
            tieStart: !!el.querySelector('tie[type="start"]'),
            tieStop: !!el.querySelector('tie[type="stop"]'),
            pos: imagePosition(el),
          });
        }
        maxPos = Math.max(maxPos, pos);
      }
      return { notes, length: maxPos || timeLength };
    });
    return { staves, measures };
  });
  return { title, parts };
}

// Splits one staff's notes in one bar into an upper and a lower line.
// homr's voice numbers aren't reliable within a bar, so assignment is by
// onset: of notes starting together, the top goes up and the bottom down; a
// note starting alone is compared with whatever is still sounding on the
// staff, else follows how its voice was assigned elsewhere in the bar, else
// it's sung by both (unison).
function splitStaff(notes) {
  const pitched = notes.filter((n) => n.midi != null);
  const onsets = new Map();
  for (const n of pitched) {
    if (!onsets.has(n.start)) onsets.set(n.start, []);
    onsets.get(n.start).push(n);
  }
  const high = [];
  const low = [];
  const votes = new Map(); // voice -> +1 per high, -1 per low
  const vote = (n, d) => votes.set(n.voice, (votes.get(n.voice) ?? 0) + d);
  const deferred = [];
  for (const [start, group] of [...onsets].sort((a, b) => a[0] - b[0])) {
    group.sort((a, b) => b.midi - a.midi);
    const top = group[0];
    const bottom = group.at(-1);
    if (top.midi !== bottom.midi) {
      high.push(top);
      low.push(bottom);
      vote(top, 1);
      vote(bottom, -1);
      continue;
    }
    if (group.length > 1) {
      high.push(top);
      low.push(bottom);
      continue;
    }
    const sounding = pitched.filter((o) => o.start < start && o.start + o.dur > start + 1e-6);
    if (sounding.length) {
      const ref = Math.max(...sounding.map((o) => o.midi));
      (top.midi > ref ? high : low).push(top);
      vote(top, top.midi > ref ? 1 : -1);
    } else deferred.push(top);
  }
  for (const n of deferred) {
    const v = votes.get(n.voice) ?? 0;
    if (v >= 0) high.push(n);
    if (v <= 0) low.push(n);
  }
  return { high, low };
}

function mergeTies(notes) {
  notes.sort((a, b) => a.t - b.t);
  const out = [];
  for (const n of notes) {
    const prev = n.tieStop && out.findLast((p) => p.midi === n.midi && p.tieStart && Math.abs(p.t + p.dur - n.t) < 1e-6);
    if (prev) {
      prev.dur += n.dur;
      prev.tieStart = n.tieStart;
    } else out.push({ ...n });
  }
  return out;
}

const sameLine = (a, b) =>
  a.length === b.length && a.every((n, i) => n.t === b[i].t && n.midi === b[i].midi && n.dur === b[i].dur);

// pages: array of parsePage() results, in page order.
export function buildScore(pages) {
  // Match parts across pages by staff layout: the k-th 2-staff part on each
  // page is the same part, etc. Pages may lack a part (e.g. a solo line).
  const partInfo = new Map();
  pages.forEach((page, p) => {
    const seen = {};
    page.parts.forEach((part, idx) => {
      const k = (seen[part.staves] = (seen[part.staves] ?? -1) + 1);
      part.key = `${part.staves}#${k}`;
      const info = partInfo.get(part.key) ?? { key: part.key, staves: part.staves, order: [] };
      info.order.push(idx / Math.max(1, page.parts.length - 1));
      partInfo.set(part.key, info);
    });
  });

  // Global bar list: each bar is as long as its longest part on that page.
  const measures = [];
  const pageMeasureStart = [];
  let t = 0;
  for (const page of pages) {
    pageMeasureStart.push(measures.length);
    const count = Math.max(0, ...page.parts.map((p) => p.measures.length));
    for (let i = 0; i < count; i++) {
      const length = Math.max(...page.parts.map((p) => p.measures[i]?.length ?? 0)) || 2;
      measures.push({ number: measures.length + 1, start: t, length });
      t += length;
    }
  }

  // Where each bar sits on its photo: a box around its notes, and the x of
  // each onset so a playhead can move through it.
  pages.forEach((page, p) => {
    for (const part of page.parts) {
      part.measures.forEach((m, i) => {
        const bar = measures[pageMeasureStart[p] + i];
        for (const n of m.notes) {
          if (!n.pos) continue;
          const { x, y } = n.pos;
          bar.page = p;
          bar.box ??= { x0: x, y0: y, x1: x, y1: y };
          bar.box.x0 = Math.min(bar.box.x0, x);
          bar.box.y0 = Math.min(bar.box.y0, y);
          bar.box.x1 = Math.max(bar.box.x1, x);
          bar.box.y1 = Math.max(bar.box.y1, y);
          bar.onsetXs ??= new Map();
          bar.onsetXs.set(n.start, [...(bar.onsetXs.get(n.start) ?? []), x]);
        }
      });
    }
  });
  for (const bar of measures) {
    if (!bar.onsetXs) continue;
    bar.onsets = [...bar.onsetXs]
      .map(([start, xs]) => ({ t: bar.start + start, x: xs.reduce((a, b) => a + b, 0) / xs.length }))
      .sort((a, b) => a.t - b.t);
    delete bar.onsetXs;
  }

  const orderedParts = [...partInfo.values()].sort(
    (a, b) => a.order.reduce((s, x) => s + x, 0) / a.order.length - b.order.reduce((s, x) => s + x, 0) / b.order.length,
  );

  const lines = [];
  for (const info of orderedParts) {
    const partLines = [];
    for (let staff = 1; staff <= info.staves; staff++) {
      const high = [];
      const low = [];
      pages.forEach((page, p) => {
        const part = page.parts.find((x) => x.key === info.key);
        if (!part) return;
        part.measures.forEach((m, i) => {
          const offset = measures[pageMeasureStart[p] + i].start;
          const split = splitStaff(m.notes.filter((n) => n.staff === staff));
          const place = (n) => ({
            t: offset + n.start,
            dur: n.dur,
            midi: n.midi,
            tieStart: n.tieStart,
            tieStop: n.tieStop,
            pos: n.pos && { page: p, ...n.pos },
          });
          high.push(...split.high.map(place));
          low.push(...split.low.map(place));
        });
      });
      const h = mergeTies(high);
      const l = mergeTies(low);
      if (h.length) partLines.push({ staff, notes: h });
      if (l.length && !sameLine(h, l)) partLines.push({ staff, notes: l });
    }
    lines.push(...labelLines(partLines, info, orderedParts.length));
  }
  if (lines.length === 4 && lines.every((l) => !l.fixedLabel)) {
    ["Soprano", "Alto", "Tenor", "Bass"].forEach((name, i) => (lines[i].label = name));
  }
  lines.forEach((l, i) => (l.id = i));
  return { title: pages.find((p) => p.title)?.title || "", measures, lines, length: t };
}

function labelLines(partLines, info, partCount) {
  if (partLines.length === 4) {
    return partLines.map((l, i) => ({ ...l, label: ["Soprano", "Alto", "Tenor", "Bass"][i], fixedLabel: true }));
  }
  if (partLines.length === 1) {
    return [{ ...partLines[0], label: partCount > 1 ? "Solo" : "Melody" }];
  }
  return partLines.map((l, i) => ({ ...l, label: `Part ${info.key.replace("#", ".")} line ${i + 1}` }));
}
