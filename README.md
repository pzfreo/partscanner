# Partsong

A PWA for learning a choral part: photograph each page of a score, and the phone
reads the music, splits it into parts (Soprano/Alto/Tenor/Bass, plus e.g. a solo
line), and plays it back with your part loud and the others quiet.

Everything runs on the phone. There is no server.

**Use it:** https://partsong.app/ — open in Chrome on Android,
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
- **Parts** (`score.js`): each page is recognised separately. Bars are lined up
  across a page's parts by position (homr occasionally splits a bar for one
  part). Each staff is split into an upper and a lower voice by note onset
  (homr's voice numbers aren't reliable), and bars are grouped into systems.
- **Choosing your part**: pick it from the parts list (matched across pages by
  staff layout; fine for SATB on two staves), or, for scores whose voicing
  changes, *mark it on the music*: in mark-up mode, tap the staff you sing in
  each system (tap again on a shared staff for the lower voice, again to unmark).
  Marks are shaded on the photos and, when there are any, take precedence over
  the list; unmarked systems have no part of yours. Your part plays at full
  volume, the others at the "Other parts" level; a pitch option shifts your part
  an octave (homr doesn't know the tenor clef's octave).
- **Pages / As read** (button in the bottom bar): switch between your photos and the recognised score drawn
  with OpenSheetMusicDisplay (to spot recognition errors). Both follow along
  (bar highlight + playhead; the note marker and marking are on Pages) and take
  a tap on a bar as the start. Imported MusicXML opens on As read.
- **Sharing** (`share.js`): the share icon (by the score title, or on each
  library row) makes one `.partsong.html` file
  (recognised MusicXML, photos re-encoded as JPEG, settings and marks) and hands
  it to the share sheet (WhatsApp, Drive, email) or downloads it. Browsers only
  share a few file types, hence HTML; opened elsewhere it's a page linking to the
  app. *Open file* imports it; a score with the same id is replaced. Opened in a
  browser (tapping it in WhatsApp/email), the file shows *Open in Partsong*: it
  opens the app and posts the full score to it (`#receive`); without script the
  button is a link carrying the score minus photos (`#import=…`, gzipped). The
  app always asks before adding. The installed
  app is also a share target (manifest `share_target` → service worker inbox):
  shared score files open, shared PDFs/photos start a new scan.
- **Lock**: a locked score can't have its part, title or existence changed
  (tempo, mix and bar range still work).
- **Playback** (`player.js`): Web Audio; each note's volume and octave come from
  the app at scheduling time; tempo, bar range, loop.
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
- **Interrupted reading**: a scan is saved to the library as each page is read.
  If Android pauses or kills the tab, the app resumes from the next page when
  reopened (or from the library's "Reading… n of m" entry). The screen is kept
  awake while reading (Screen Wake Lock).
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
node scripts/headless-test.mjs "http://localhost:8765/tests/score-test.html?set=huron&n=4" out.json 30
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 600 tests/drive-app.js shot
node scripts/headless-test.mjs "http://127.0.0.1:8765/index.html" out.json 600 tests/drive-offline.js shot
node scripts/headless-test.mjs "http://localhost:8765/testdata/" out.json 400 tests/drive-library.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-follow.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 400 tests/drive-nav.js shot
node scripts/headless-test.mjs "http://localhost:8765/tests/orient-test.html" out.json 100
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 450 tests/drive-pdf.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-files.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 180 tests/drive-manual.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-lock.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-views.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-read-follow.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 180 tests/drive-share.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-library-share.js shot
CHROME_FLAGS=--disable-popup-blocking node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 180 tests/drive-receive.js shot
node scripts/headless-test.mjs "http://127.0.0.1:8765/index.html" out.json 180 tests/drive-share-target.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 60 tests/drive-hidden.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 180 tests/drive-stale.js shot
CPU_THROTTLE=4 node scripts/headless-test.mjs "http://localhost:8765/index.html?view=switch" out.json 180 tests/drive-read-timing.js shot
node scripts/headless-test.mjs "http://localhost:8765/testdata/" out.json 700 tests/drive-resume.js shot
node scripts/headless-test.mjs "http://localhost:8765/testdata/" out.json 400 tests/drive-resume-manual.js shot
```

## Deploy

`.github/workflows/pages.yml` fetches homr and the models and publishes to
GitHub Pages (custom domain `partsong.app`, set in the repo's Pages settings) on
every push to `main` (models aren't committed; GitHub release
downloads don't allow cross-origin fetches, so they're served with the site).

## Limits

- Recognition errors happen: check "Show what was read" against your copy.
  Dynamics, lyrics and repeats are ignored.
- Accuracy depends on the photo: flat page, even light, phone square-on.

## Licence

AGPL-3.0, because the app distributes homr (AGPL-3.0).
