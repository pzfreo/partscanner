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

// The reader also records homr's own voice tag (omr/runner.py): upper/lower
// for the first (stem-up) voice on a staff, upper2/lower2 for the second.
function voiceTag(note) {
  for (const c of note.childNodes) {
    const m = c.nodeType === Node.COMMENT_NODE && /homr-voice:\s*(\w+)/.exec(c.data);
    if (m) return m[1];
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
    let clef = null; // the top staff's first clef sign (G, F, C)
    const measures = [...part.children].filter((m) => m.tagName === "measure").map((measure) => {
      const notes = [];
      let pos = 0;
      let maxPos = 0;
      let lastStart = 0;
      for (const el of measure.children) {
        if (el.tagName === "attributes") {
          divisions = num(el, "divisions", divisions);
          staves = Math.max(staves, num(el, "staves", staves));
          const c = el.querySelector('clef[number="1"], clef:not([number])');
          clef ??= c?.querySelector("sign")?.textContent ?? null;
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
            step: pitch ? 7 * num(pitch, "octave") + "CDEFGAB".indexOf(pitch.querySelector("step").textContent) : null,
            tieStart: !!el.querySelector('tie[type="start"]'),
            tieStop: !!el.querySelector('tie[type="stop"]'),
            pos: imagePosition(el),
            tag: voiceTag(el),
          });
        }
        maxPos = Math.max(maxPos, pos);
      }
      return { notes, length: maxPos || timeLength };
    });
    for (let staff = 1; staff <= staves; staff++) placeNoteheads(measures, staff);
    return { staves, measures, clef };
  });
  return { title, parts };
}

// homr's note positions come from where its model was looking, so they wander
// up or down the stem. Within one staff of one system, a notehead's height is a
// straight-line function of its pitch, so fit that line (allowing for a fixed
// lean per voice, as first-voice stems point up and second-voice ones down)
// and move each position onto its notehead. Photos are often tilted, so the
// staff may also slope across the page.
function placeNoteheads(measures, staff) {
  const groups = [];
  let lastX = -Infinity;
  for (const m of measures) {
    const notes = m.notes.filter((n) => n.staff === staff && n.pos && n.step != null);
    if (!notes.length) continue;
    const x0 = Math.min(...notes.map((n) => n.pos.x));
    if (x0 < lastX || !groups.length) groups.push([]); // back to the left: a new system
    groups.at(-1).push(...notes);
    lastX = Math.max(...notes.map((n) => n.pos.x));
  }
  for (const notes of groups) {
    const lean = (n) => (n.tag ? (n.tag.endsWith("2") ? 1 : -1) : 0);
    const steps = new Set(notes.map((n) => n.step));
    if (notes.length < 6 || steps.size < 3) continue;
    const both = new Set(notes.map(lean)).size > 1;
    const fit = leastSquares(notes.map((n) => [1, n.step, n.pos.x / 1000, ...(both ? [lean(n)] : [])]), notes.map((n) => n.pos.y));
    if (!fit || fit[1] >= 0) continue; // higher notes must sit higher up the page
    for (const n of notes) n.pos.y = Math.round(fit[0] + fit[1] * n.step + (fit[2] * n.pos.x) / 1000);
  }
}

function leastSquares(rows, ys) {
  const k = rows[0].length;
  const a = Array.from({ length: k }, (_, i) => [
    ...Array.from({ length: k }, (_, j) => rows.reduce((s, r) => s + r[i] * r[j], 0)),
    rows.reduce((s, r, n) => s + r[i] * ys[n], 0),
  ]);
  for (let i = 0; i < k; i++) {
    const p = a.reduce((best, row, r) => (r >= i && Math.abs(row[i]) > Math.abs(a[best][i]) ? r : best), i);
    [a[i], a[p]] = [a[p], a[i]];
    if (Math.abs(a[i][i]) < 1e-9) return null;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = a[r][i] / a[i][i];
      for (let c = i; c <= k; c++) a[r][c] -= f * a[i][c];
    }
  }
  return a.map((row, i) => row[k] / row[i]);
}

// Splits one staff's notes in one bar into an upper and a lower line, by
// homr's voice tags when the score has them (first voice -> upper, second ->
// lower; a bar with only one voice is sung by both).
function splitStaff(notes) {
  if (notes.length && notes.every((n) => n.tag)) {
    const second = notes.filter((n) => n.tag.endsWith("2"));
    const first = notes.filter((n) => !n.tag.endsWith("2"));
    if (!second.length) return { high: pickFromChords(first, true), low: pickFromChords(first, false) };
    return { high: pickFromChords(first, true), low: pickFromChords(second, false) };
  }
  return splitByPitch(notes);
}

// One onset group -> a single note: top for the upper line, bottom for lower.
function pickFromChords(notes, pickHigh) {
  const byStart = new Map();
  for (const n of notes) {
    if (n.midi == null) continue;
    const cur = byStart.get(n.start);
    if (!cur || (pickHigh ? n.midi > cur.midi : n.midi < cur.midi)) byStart.set(n.start, n);
  }
  return [...byStart.values()];
}

// Scores read before voice tags were kept: homr's MusicXML voice numbers
// aren't reliable within a bar, so assignment is by onset: of notes starting together, the top goes up and the bottom down; a
// note starting alone is compared with whatever is still sounding on the
// staff, else follows how its voice was assigned elsewhere in the bar, else
// it's sung by both (unison).
function splitByPitch(notes) {
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

const barX0 = (m) => {
  const xs = m.notes.filter((n) => n.pos).map((n) => n.pos.x);
  return xs.length ? Math.min(...xs) : null;
};

// homr sometimes splits one bar in two for a single part, shifting that part
// against the others for the rest of the page. When parts on a page disagree
// on bar count, a bar is merged into the previous one if it starts on the
// same row but clearly before the reference part's next bar.
function alignBars(page) {
  const counts = page.parts.map((p) => p.measures.length);
  if (new Set(counts).size < 2) return;
  const mode = counts.sort((a, b) => counts.filter((c) => c === b).length - counts.filter((c) => c === a).length)[0];
  const ref = page.parts.find((p) => p.measures.length === mode).measures.map(barX0);
  const xs = page.parts.flatMap((p) => p.measures.flatMap((m) => m.notes.filter((n) => n.pos).map((n) => n.pos.x)));
  const tol = (Math.max(...xs) - Math.min(...xs)) * 0.03;
  for (const part of page.parts) {
    if (part.measures.length <= mode) continue;
    const out = [];
    for (const m of part.measures) {
      const prev = out.at(-1);
      const x0 = barX0(m);
      const nextRef = ref[out.length];
      const px0 = prev && barX0(prev);
      if (prev && x0 != null && px0 != null && nextRef != null && x0 > px0 && x0 < nextRef - tol) {
        prev.notes.push(...m.notes.map((n) => ({ ...n, start: n.start + prev.length })));
        prev.length += m.length;
      } else out.push({ ...m, notes: [...m.notes] });
    }
    part.measures = out;
  }
}

// pages: array of parsePage() results, in page order.
export function buildScore(pages) {
  pages.forEach(alignBars);
  // Match parts across pages by staff layout: the k-th 2-staff part on each
  // page is the same part, etc. Pages may lack a part (e.g. a solo line).
  const partInfo = new Map();
  pages.forEach((page, p) => {
    const seen = {};
    page.parts.forEach((part, idx) => {
      const k = (seen[part.staves] = (seen[part.staves] ?? -1) + 1);
      part.key = `${part.staves}#${k}`;
      const info = partInfo.get(part.key) ?? { key: part.key, staves: part.staves, order: [], clef: part.clef };
      info.order.push(idx / Math.max(1, page.parts.length - 1));
      partInfo.set(part.key, info);
    });
  });

  // Global bar list: each bar is as long as its longest part on that page.
  const measures = [];
  const pageMeasureStart = [];
  let t = 0;
  pages.forEach((page, sheet) => {
    pageMeasureStart.push(measures.length);
    const count = Math.max(0, ...page.parts.map((p) => p.measures.length));
    for (let i = 0; i < count; i++) {
      const length = Math.max(...page.parts.map((p) => p.measures[i]?.length ?? 0)) || 2;
      // sheet/sheetBar: which page's MusicXML, and which bar in it (for the As read view)
      measures.push({ number: measures.length + 1, start: t, length, sheet, sheetBar: i });
      t += length;
    }
  });

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
  const built = [];
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
      const twoVoices = l.length && !sameLine(h, l);
      const staffKey = `${info.key}/${staff}`;
      if (h.length) partLines.push({ staff, staffKey, voice: twoVoices ? "upper" : "only", notes: h });
      if (twoVoices) partLines.push({ staff, staffKey, voice: "lower", notes: l });
    }
    built.push({ info, partLines });
  }
  // Separate one-staff vocal parts with a two-staff part (a piano reduction or
  // accompaniment): name the voices, and mark the piano lines so they don't
  // double the voices by default.
  const singing = built.filter((b) => b.info.staves === 1 && b.partLines.length === 1);
  const piano = built.filter((b) => b.info.staves > 1);
  if (singing.length >= 2 && piano.length) {
    const names = singing.length === 4 ? ["Soprano", "Alto", "Tenor", "Bass"] : singing.map((_, i) => `Voice ${i + 1}`);
    for (const b of built) {
      if (singing.includes(b)) {
        const line = { ...b.partLines[0], label: names[singing.indexOf(b)], fixedLabel: true };
        // A tenor part in treble clef is always the octave-lower treble clef,
        // whose little 8 the reader doesn't report.
        if (line.label === "Tenor" && b.info.clef === "G") line.notes = line.notes.map((n) => ({ ...n, midi: n.midi - 12 }));
        lines.push(line);
      }
      else if (piano.includes(b)) {
        const plural = b.partLines.length > 1;
        lines.push(...b.partLines.map((l, i) => ({ ...l, label: plural ? `Piano ${i + 1}` : "Piano", fixedLabel: true, accompaniment: true })));
      } else lines.push(...labelLines(b.partLines, b.info, built.length));
    }
  } else for (const b of built) lines.push(...labelLines(b.partLines, b.info, built.length));
  if (lines.length === 4 && lines.every((l) => !l.fixedLabel)) {
    ["Soprano", "Alto", "Tenor", "Bass"].forEach((name, i) => (lines[i].label = name));
  }
  lines.forEach((l, i) => (l.id = i));
  const systems = findSystems(measures, lines);
  return { title: pages.find((p) => p.title)?.title || "", measures, lines, systems, length: t };
}

// Groups bars into systems (one row of music on a page): a new system starts
// on a new page or when a bar sits left of the previous one. For each system,
// lists its staves top to bottom with their extent on the photo and the lines
// (voices) on each, so a tap can be mapped to a staff and voice.
function findSystems(measures, lines) {
  const systems = [];
  let cur = null;
  let lastBox = null;
  let lastPage = null;
  for (const bar of measures) {
    const startsRow = bar.box && (bar.page !== lastPage || bar.box.x0 < lastBox.x0);
    if (!cur || startsRow) {
      cur = { index: systems.length, page: bar.page ?? lastPage, start: bar.start, bars: [] };
      systems.push(cur);
    }
    cur.bars.push(bar);
    cur.end = bar.start + bar.length;
    bar.system = cur.index;
    if (bar.box) {
      const b = bar.box;
      cur.box = cur.box
        ? { x0: Math.min(cur.box.x0, b.x0), y0: Math.min(cur.box.y0, b.y0), x1: Math.max(cur.box.x1, b.x1), y1: Math.max(cur.box.y1, b.y1) }
        : { ...b };
      lastBox = b;
      lastPage = bar.page;
    }
  }
  for (const sys of systems) {
    const staves = new Map();
    for (const line of lines) {
      for (const n of line.notes) {
        if (n.t < sys.start || n.t >= sys.end || n.pos?.page !== sys.page) continue;
        const st = staves.get(line.staffKey) ?? { key: line.staffKey, y0: Infinity, y1: -Infinity, lines: new Set() };
        st.y0 = Math.min(st.y0, n.pos.y);
        st.y1 = Math.max(st.y1, n.pos.y);
        st.lines.add(line.id);
        staves.set(line.staffKey, st);
      }
    }
    sys.staves = [...staves.values()].map((st) => ({ ...st, lines: [...st.lines] })).sort((a, b) => a.y0 - b.y0);
  }
  return systems;
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
