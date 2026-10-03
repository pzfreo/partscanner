# Part Scanner

A PWA for learning a choral part: photograph each page of a score, and the phone
reads the music, splits it into parts (Soprano/Alto/Tenor/Bass, plus e.g. a solo
line), and plays it back with your part loud and the others quiet.

Everything runs on the phone. There is no server.

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
- Scores are kept on the device (localStorage). MusicXML files can be opened
  directly, too.

## Develop

```sh
scripts/fetch-homr.sh          # pinned homr source -> vendor/, models -> models/
python3 -m http.server 8765    # then open http://localhost:8765
```

The service worker is skipped on `localhost`; use `http://127.0.0.1:8765` to
exercise it. A phone needs HTTPS (camera, caches), so test there via the deployed
site.

Headless browser tests (put score images/MusicXML in the gitignored `testdata/`):

```sh
node scripts/headless-test.mjs "http://localhost:8765/tests/omr-test.html?page=huron_1.png" out.json
node scripts/headless-test.mjs "http://localhost:8765/tests/score-test.html" out.json 30
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 600 tests/drive-app.js shot
node scripts/headless-test.mjs "http://127.0.0.1:8765/index.html" out.json 600 tests/drive-offline.js shot
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
