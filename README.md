# Part Scanner

A PWA for learning a choral part: photograph each page of a score, and the phone
reads the music, splits it into parts (Soprano/Alto/Tenor/Bass, plus e.g. a solo
line), and plays it back with your part loud and the others quiet.

Everything runs on the phone. There is no server.

**Use it:** https://pzfreo.github.io/partscanner/ — open in Chrome on Android,
then *Add to Home screen*.

## How it works

- **Recognition**: [homr](https://github.com/liebharc/homr) (optical music
  recognition) runs unmodified in a module Web Worker under
  [Pyodide](https://pyodide.org). `omr/onnxruntime.py` replaces the
  `onnxruntime` package and forwards model calls to
  [onnxruntime-web](https://onnxruntime.ai) (WebGPU for the segmentation and
  encoder models when available, WASM for the decoder). Python blocks on those
  calls via JSPI, so it needs **Chrome/Edge 137+** (current Chrome on Android
  is fine).
- **Models**: ~157 MB, downloaded once on first scan and kept in Cache Storage.
- **Parts** (`score.js`): each page is recognised separately; parts are
  matched across pages by staff layout, so a solo staff that only appears on
  some pages doesn't break the merge. Each staff is split into an upper and a
  lower line by note onset (homr's voice numbers aren't reliable).
- **Playback** (`player.js`): Web Audio, per-part volume, tempo, bar range, loop.
- **Follow along**: homr records where each note sits in the photo
  (`<!-- imgpos -->` comments), so playback highlights the current bar on your
  own pages, with a playhead and a marker on your part's note, and auto-scrolls.
  Tap a bar to start from there.
- **PDF import** (`pdf-pages.js`): "Add images or PDF" renders each page with
  [pdf.js](https://mozilla.github.io/pdf.js/) at ~300 dpi and treats it like a photo.
- **Photo orientation** (`orient.js`): phones held flat over a page often save
  it sideways. Sideways pages are detected from the staff lines and turned the
  way a portrait photo would have been (using the stored pixels' EXIF tag);
  each thumbnail also has a ↻ button.
- **Navigation**: screens and the settings panel are history entries, so the
  phone's back button steps back through the app instead of closing it.
- **Library** (`db.js`): each score is saved on the device in IndexedDB with
  its original photos, the recognised MusicXML and your settings (part, tempo,
  mix), so it opens instantly without re-reading. MusicXML files can be opened
  directly, too.

## Develop

```sh
scripts/fetch-homr.sh          # pinned homr source -> vendor/, models -> models/
python3 -m http.server 8765    # then open http://localhost:8765
```

The service worker is skipped on `localhost`; use `http://127.0.0.1:8765` to
exercise it. A phone needs HTTPS (camera, caches), so test there via the deployed
site.

Headless browser tests (put score images/MusicXML in the gitignored `testdata/`;
the orientation tests also need simulated camera photos `cam_<page>_exif<tag>.jpg`:
each page's pixels turned 90° anticlockwise, saved with EXIF orientation 1, 3 or 6):

```sh
node scripts/headless-test.mjs "http://localhost:8765/tests/omr-test.html?page=huron_1.png" out.json
node scripts/headless-test.mjs "http://localhost:8765/tests/score-test.html" out.json 30
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 600 tests/drive-app.js shot
node scripts/headless-test.mjs "http://127.0.0.1:8765/index.html" out.json 600 tests/drive-offline.js shot
node scripts/headless-test.mjs "http://localhost:8765/testdata/" out.json 400 tests/drive-library.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-follow.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 400 tests/drive-nav.js shot
node scripts/headless-test.mjs "http://localhost:8765/tests/orient-test.html" out.json 100
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 450 tests/drive-pdf.js shot
```

## Deploy

`.github/workflows/pages.yml` fetches homr and the models and publishes to
GitHub Pages on every push to `main` (models aren't committed; GitHub release
downloads don't allow cross-origin fetches, so they're served with the site).

## Limits

- Recognition errors happen: check "Show what was read" against your copy.
  Dynamics, lyrics and repeats are ignored.
- Accuracy depends on the photo: flat page, even light, phone square-on.

## Licence

AGPL-3.0, because the app distributes homr (AGPL-3.0).
