"""Runs homr on one page image inside Pyodide and returns its MusicXML."""

import sys
import types


def _stub(name, **attrs):
    module = types.ModuleType(name)
    module.__dict__.update(attrs)
    sys.modules[name] = module


# Optional homr features (title OCR, PDF input, model download) whose
# dependencies are not available in Pyodide. Title detection is disabled below.
_stub("rapidocr", RapidOCR=type("RapidOCR", (), {}))
_stub("pypdfium2")
_stub("requests", exceptions=types.SimpleNamespace(RequestException=Exception))

import xml.etree.ElementTree as ET  # noqa: E402

from homr import music_xml_generator  # noqa: E402
from homr.debug import Debug  # noqa: E402
from homr.main import ProcessingConfig, process_image  # noqa: E402
from homr.music_xml_generator import XmlGeneratorArguments  # noqa: E402

# homr's model tags every note with its voice on the staff (upper/upper2 on the
# top staff, lower/lower2 on the bottom: stem-up vs stem-down voices), but the
# MusicXML writer renumbers voices by rhythm and loses that. Keep it as a
# comment, next to the image-position comment, for the app's part split.
_build_image_position = music_xml_generator.build_image_position


def _build_image_position_and_voice(xml, symbol):
    _build_image_position(xml, symbol)
    xml.append(ET.Comment(f" homr-voice: {symbol.position} "))


music_xml_generator.build_image_position = _build_image_position_and_voice

# The model sometimes predicts a grace note with no pitch. homr's writer treats
# that as a zero-length rest and fails an assertion, losing the whole page. A
# rest that takes no time means nothing, so drop it before writing the chord.
_build_note_chord = music_xml_generator.build_note_chord
_no_pitch = (music_xml_generator.empty, music_xml_generator.nonote)


def _build_note_chord_without_zero_rests(note_chord, state, chord_duration):
    groups = music_xml_generator._group_notes(note_chord.symbols)
    zero_rests = [s for s in groups.get(0, []) if s.pitch in _no_pitch]
    if zero_rests:
        kept = [s for s in note_chord.symbols if s not in zero_rests]
        if not kept:
            return []
        note_chord = music_xml_generator.SymbolChord(kept, note_chord.tuplet_mark)
    return _build_note_chord(note_chord, state, chord_duration)


music_xml_generator.build_note_chord = _build_note_chord_without_zero_rests

# homr merges overlapping shapes by testing every pair of groups (O(n^2), about
# 2 s of Python per page in Pyodide). Two shapes can only touch if their
# centres are within the sum of their major axes horizontally (homr's own
# _can_shapes_possibly_touch), so sort groups by that x-extent and only test
# pairs whose extents overlap. Same groups, same order.
from homr import bounding_boxes  # noqa: E402


def _x_extent(group):
    lo, hi = float("inf"), float("-inf")
    for box in group:
        (cx, _), axes, _ = box.rotated_box if isinstance(box, bounding_boxes.BoundingBox) else box.box
        r = max(axes)
        lo, hi = min(lo, cx - r), max(hi, cx + r)
    return lo, hi


def _merge_groups_swept(groups):
    n = len(groups)
    uf = bounding_boxes.UnionFind(n)
    extents = [_x_extent(g) for g in groups]
    order = sorted(range(n), key=lambda i: extents[i][0])
    for a, i in enumerate(order):
        hi = extents[i][1]
        for j in order[a + 1 :]:
            if extents[j][0] > hi:
                break
            if bounding_boxes._do_groups_overlap(groups[min(i, j)], groups[max(i, j)]):
                uf.union(min(i, j), max(i, j))
    merged = {}
    for i in range(n):
        merged.setdefault(uf.find(i), []).extend(groups[i])
    return list(merged.values())


bounding_boxes._merge_groups_optimized = _merge_groups_swept

# homr assumes every system on a page has the same staves and drops staves at
# the top or bottom of the page that don't fit (e.g. a solo line that stops,
# so the last systems are just the choir). Keep them instead: split the page
# into runs of systems that share a layout, read each run, and give a part that
# is missing from a run empty bars there, so every part keeps the same bars.
from homr import main as homr_main, staff_parsing  # noqa: E402
from homr.staff_regions import StaffRegions  # noqa: E402
from homr.transformer.vocabulary import EncodedSymbol, remove_duplicated_symbols  # noqa: E402

_parse_staffs = staff_parsing.parse_staffs


def _layout_runs(rows):
    flat = staff_parsing._flatten_staffs(rows)
    uniform = len({len(r.staffs) for r in rows}) == 1 and len(rows[0].staffs) > 1
    core = None if uniform else staff_parsing._find_periodic_core(flat)
    if core is None or core[1] == core[2] == 0:
        return [staff_parsing._ensure_same_number_of_staffs(rows)]
    _, front, back = core
    cuts = (front, len(flat) - back)
    piece_of = lambda k: (k >= cuts[0]) + (k >= cuts[1])  # noqa: E731
    pieces = [[], [], []]
    i = 0
    for row in rows:
        whole = piece_of(i) == piece_of(i + len(row.staffs) - 1)
        for part in [row] if whole else row.break_apart():
            pieces[piece_of(i)].append(part)
            i += len(part.staffs)
    return [run for piece in pieces if piece for run in _layout_runs(piece)]


def _bar_count(symbols):
    bars, open_bar = 0, False
    for s in symbols:
        if "barline" in s.rhythm or s.rhythm.startswith("repeat"):
            bars, open_bar = bars + 1, False
        elif s.rhythm.startswith(("note", "rest")):
            open_bar = True
    return bars + open_bar


def _parse_staffs_by_layout(debug, staffs, image, config, selected_staff=-1, page_to_input_image=staff_parsing.identity):
    runs = _layout_runs(staffs)
    if len(runs) == 1:
        return _parse_staffs(debug, staffs, image, config, selected_staff, page_to_input_image)
    regions = StaffRegions([row for run in runs for row in run])
    parts = {}  # (grand staff?, k-th of that kind) -> symbols
    order = []
    index = 0
    for run in runs:
        seen = {}
        keys = []
        for staff in run[0].staffs:
            kind = staff.is_grandstaff
            seen[kind] = seen.get(kind, -1) + 1
            keys.append((kind, seen[kind]))
        # A part first seen here goes before the next part it sits above.
        for n, key in enumerate(keys):
            if key not in order:
                later = [order.index(k) for k in keys[n + 1 :] if k in order]
                order.insert(min(later, default=len(order)), key)
        for row in run:
            read = {}
            for key, staff in zip(keys, row.staffs):
                symbols = staff_parsing.parse_staff_image(debug, index, staff, image, regions, config, page_to_input_image)
                index += 1
                if symbols:
                    read[key] = symbols
            bars = max((_bar_count(s) for s in read.values()), default=0)
            for key in order:
                filler = [EncodedSymbol("barline") for _ in range(bars)]
                parts.setdefault(key, []).extend(read.get(key, filler) + [EncodedSymbol("newline")])
    # Parts first seen in a later run need empty bars for the earlier runs too.
    total = max(_bar_count(s) for s in parts.values())
    for key in order:
        missing = total - _bar_count(parts[key])
        parts[key] = [EncodedSymbol("barline") for _ in range(missing)] + parts[key]
    return [remove_duplicated_symbols(parts[key]) for key in order]


homr_main.parse_staffs = _parse_staffs_by_layout

# Skip writing the preview PNG; the app shows the original photo instead.
Debug.write_teaser = lambda *args, **kwargs: None

_CONFIG = ProcessingConfig(
    enable_debug=False,
    enable_cache=False,
    write_staff_positions=False,
    read_staff_positions=False,
    selected_staff=-1,
    transformer_use_gpu=False,
    segnet_use_gpu=False,
    coreml_encoder=False,
    title_detection=False,
)


def recognise(image_path):
    xml_path = process_image(image_path, _CONFIG, XmlGeneratorArguments())
    with open(xml_path, encoding="utf-8") as f:
        return f.read()


def recognise_profiled(image_path):  # TEMPORARY profiling
    import cProfile, io, pstats
    pr = cProfile.Profile()
    pr.enable()
    out = recognise(image_path)
    pr.disable()
    s = io.StringIO()
    st = pstats.Stats(pr, stream=s)
    st.sort_stats("cumtime").print_callers("is_overlapping|_can_shapes_possibly_touch")
    st.sort_stats("cumtime").print_stats(30)
    print(s.getvalue())
    return out
