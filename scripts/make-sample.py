"""Writes samples/joyful-joyful.musicxml: the demo score.

"Joyful, Joyful, We Adore Thee": melody Beethoven (Ode to Joy, 1824), words
Henry van Dyke (1907), both public domain; this four-part harmonisation was
written for Partsong and is dedicated to the public domain (CC0). Two verses,
one per page, laid out hymnbook-style: S/A on the treble staff, T/B on the
bass staff. Render to PDF with scripts/render-sample.mjs.
"""

import os
from xml.sax.saxutils import escape

DIV = 2  # divisions per quarter note: e = 1, q = 2, dq = 3, h = 4
DUR = {"e": 1, "q": 2, "dq": 3, "h": 4}
TYPE = {"e": ("eighth", 0), "q": ("quarter", 0), "dq": ("quarter", 1), "h": ("half", 0)}

# Bars of the verse; each voice is a list of (pitch, duration). G major.
B = {
    1: dict(S="B4 B4 C5 D5", A="G4 G4 G4 G4", T="D4 D4 E4 D4", Bs="G3 B2 C3 B2"),
    2: dict(S="D5 C5 B4 A4", A="G4 E4 D4 F#4", T="B3 C4 D4 D4", Bs="G2 A2 B2 D3"),
    3: dict(S="G4 G4 A4 B4", A="D4 E4 F#4 G4", T="B3 B3 A3 D4", Bs="G2 E3 D3 G2"),
    4: dict(S="B4:dq A4:e A4:h", A="G4:dq F#4:e F#4:h", T="D4:dq D4:e D4:h", Bs="G2:dq D3:e D2:h"),
    8: dict(S="A4:dq G4:e G4:h", A="F#4:dq D4:e D4:h", T="C4:dq B3:e B3:h", Bs="D3:dq G2:e G2:h"),
    9: dict(S="A4 A4 B4 G4", A="F#4 F#4 G4 E4", T="D4 D4 D4 B3", Bs="D3 D3 B2 E3"),
    10: dict(S="A4 B4:e C5:e B4 G4", A="F#4 G4 G4 E4", T="D4 D4 D4 B3", Bs="D3 G3 B2 E3"),
    11: dict(S="A4 B4:e C5:e B4 A4", A="F#4 G4 G4 F#4", T="D4 D4 D4 D4", Bs="D3 G2 G3 D3"),
    12: dict(S="G4 A4 D4:h", A="E4 F#4 A3:h", T="B3 A3 F#3:h", Bs="E3 D3 D2:h"),
}
VERSE = [1, 2, 3, 4, 1, 2, 3, 8, 9, 10, 11, 12, 1, 2, 3, 8]

# One syllable per soprano note; the slurred eighth pairs (bars 10, 11) share
# one. "-" at the end of a syllable means the word continues.
LYRICS = [
    "Joy- ful, joy- ful, we a- dore thee, God of glo- ry, Lord of love; "
    "Hearts un- fold like flow'rs be- fore thee, O- p'ning to the sun a- bove. "
    "Melt the clouds of sin and sad- ness; Drive the dark of doubt a- way; "
    "Giv- er of im- mor- tal glad- ness, Fill us with the light of day!",
    "All thy works with joy sur- round thee, Earth and heav'n re- flect thy rays, "
    "Stars and an- gels sing a- round thee, Cen- ter of un- brok- en praise. "
    "Field and for- est, vale and moun- tain, Flow'r- y mea- dow, flash- ing sea, "
    "Sing- ing bird and flow- ing foun- tain Call us to re- joice in thee.",
]


def notes(spec):
    out = []
    for tok in spec.split():
        p, _, d = tok.partition(":")
        out.append((p, d or "q"))
    return out


def pitch_xml(p):
    step, rest = p[0], p[1:]
    alter = 1 if rest.startswith("#") else 0
    octave = rest.lstrip("#")
    return f"<pitch><step>{step}</step>{'<alter>1</alter>' if alter else ''}<octave>{octave}</octave></pitch>"


def note_xml(p, d, voice, staff, stem, lyric=None, slur=None, beam=None):
    t, dots = TYPE[d]
    x = f"<note>{pitch_xml(p)}<duration>{DUR[d]}</duration><voice>{voice}</voice><type>{t}</type>"
    x += "<dot/>" * dots
    x += f"<stem>{stem}</stem><staff>{staff}</staff>"
    if beam:
        x += f'<beam number="1">{beam}</beam>'
    if slur:
        x += f'<notations><slur type="{slur}"/></notations>'
    if lyric:
        text, syl = lyric
        x += f'<lyric number="1"><syllabic>{syl}</syllabic><text>{escape(text)}</text></lyric>'
    return x + "</note>"


def syllables(text):
    out, cont = [], False
    for tok in text.split():
        more = tok.endswith("-")
        word = tok.rstrip("-")
        syl = ("middle" if more else "end") if cont else ("begin" if more else "single")
        out.append((word, syl))
        cont = more
    return out


def measure(num, bar, lyr, first, new_system, new_page, page_title):
    parts = [f'<measure number="{num}">']
    if new_page or new_system:
        parts.append(f'<print{" new-page=" + chr(34) + "yes" + chr(34) if new_page else ""}'
                     f'{" new-system=" + chr(34) + "yes" + chr(34) if new_system and not new_page else ""}/>')
    if page_title:
        parts.append(page_title)
    if first:
        parts.append(
            f"<attributes><divisions>{DIV}</divisions><key><fifths>1</fifths></key>"
            "<time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves>"
            '<clef number="1"><sign>G</sign><line>2</line></clef>'
            '<clef number="2"><sign>F</sign><line>4</line></clef></attributes>'
        )
    total = 4 * DIV
    voices = [("S", 1, 1, "up"), ("A", 2, 1, "down"), ("T", 5, 2, "up"), ("Bs", 6, 2, "down")]
    for i, (key, voice, staff, stem) in enumerate(voices):
        ns = notes(B[bar][key])
        eighths = [j for j, (_, d) in enumerate(ns) if d == "e"]
        for j, (p, d) in enumerate(ns):
            lyric = slur = beam = None
            if key == "S":
                if d == "e" and j == eighths[-1] and len(eighths) == 2 and ns[eighths[0]][0] != ns[j][0] and DUR[ns[eighths[0]][1]] == 1 and eighths[1] == eighths[0] + 1:
                    slur = "stop"  # second of a slurred pair: no new syllable
                else:
                    lyric = lyr.pop(0)
                    if d == "e" and len(eighths) == 2 and j == eighths[0] and eighths[1] == j + 1:
                        slur = "start"
            if d == "e" and len(eighths) == 2 and eighths[1] == eighths[0] + 1:
                beam = "begin" if j == eighths[0] else "end"
            parts.append(note_xml(p, d, voice, staff, stem, lyric, slur, beam))
        if i < 3:
            parts.append(f"<backup><duration>{total}</duration></backup>")
    parts.append("</measure>")
    return "".join(parts)


def build():
    body = []
    num = 0
    for v, text in enumerate(LYRICS):
        lyr = syllables(text)
        for k, bar in enumerate(VERSE):
            num += 1
            title = None
            if k == 0:
                title = (
                    '<direction placement="above"><direction-type><words font-weight="bold" font-size="12">'
                    f"Verse {v + 1}</words></direction-type></direction>"
                )
            body.append(measure(num, bar, lyr, num == 1, k % 4 == 0 and num > 1, k == 0 and v > 0, title))
        assert not lyr, f"verse {v + 1}: {len(lyr)} syllables left over"
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>Joyful, Joyful, We Adore Thee</work-title></work>
<identification>
<creator type="composer">Ludwig van Beethoven (1824)</creator>
<creator type="lyricist">Henry van Dyke (1907)</creator>
<creator type="arranger">Harmonisation: Partsong demo, public domain (CC0)</creator>
<rights>Public domain (CC0). Free to copy, share and perform.</rights>
</identification>
<part-list><score-part id="P1"><part-name>Choir</part-name></score-part></part-list>
<part id="P1">{"".join(body)}</part>
</score-partwise>
"""


if __name__ == "__main__":
    root = os.path.join(os.path.dirname(__file__), "..", "samples")
    os.makedirs(root, exist_ok=True)
    with open(os.path.join(root, "joyful-joyful.musicxml"), "w", encoding="utf-8") as f:
        f.write(build())
    print("wrote samples/joyful-joyful.musicxml")
