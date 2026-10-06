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
- **Recognition speed** (one page, huron_1, desktop Chrome): 12.1 s → 7.4 s,
  same MusicXML. The decoder's key/value cache stays on the JS side between
  its ~340 steps instead of being copied to Python and back (`omr-worker.js`
  `run`/`keep`); the service worker adds COOP/COEP (`credentialless`) headers,
  which GitHub Pages can't, so the app is cross-origin isolated and the WASM
  decoder runs on 4 threads; `omr/runner.py` sweeps homr's pairwise shape merge
  by x-extent. The worker logs each page's time per model and in Python.
  Measured and rejected: the decoder is already int8-quantized, and batching
  staves changes results (its dynamic quantization scale spans the batch).
- **Models**: ~157 MB, downloaded once on first scan and kept in Cache Storage,
  in 4 MB pieces (HTTP range requests) so a dropped connection resumes rather
  than restarting; a stalled piece is retried.
- **Parts** (`score.js`): each page is recognised separately. Bars are lined up
  across a page's parts by position (homr occasionally splits a bar for one
  part). Each staff is split into an upper and a lower voice using homr's own
  per-note voice tags (upper/upper2, lower/lower2: stem-up and stem-down voices),
  which `omr/runner.py` keeps in the MusicXML as comments because homr's writer
  renumbers voices; scores read before that fall back to a pitch/onset guess.
  Bars are grouped into systems.
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
- **Share by link** (`share.js`, `relay/`): sharing uploads the score's PDF,
  encrypted on the phone (AES-GCM), to a Cloudflare Worker + R2 relay, and
  shares just the link `https://partsong.app/#s=<id>.<key>` (WhatsApp drops a
  message's text when a file comes with it). *Share as PDF* in a score's
  settings sends the file instead: a copy that doesn't expire. The key is only in the #fragment, which
  browsers never send, so the relay can't read scores. Tapping the link fetches
  and decrypts it and asks before adding, the same in Safari, Chrome or the
  installed app (also when Partsong is already open: `hashchange`). If the
  upload fails, the PDF is shared instead; if a link has expired (a year, by
  the bucket's lifecycle rule) or the relay is down, the app says so and what
  to do. `tests/drive-relay.js` (needs `wrangler dev`, see
  its header). The relay only accepts uploads from partsong.app, up to 40 MB,
  starting with the app's marker, and never overwrites.
- **Sharing** (`share.js`): the share icon (by the score title, or on each
  library row) makes one `.partsong.pdf`: a real PDF of the page photos (JPEG,
  marked `/PartsongPhoto n`) that any phone opens, with the recognised MusicXML,
  settings and marks attached as `partsong-score.json` (`/PartsongScore`,
  deflated), and a last page saying how to open it in Partsong. It goes to the
  share sheet (WhatsApp, Drive, email) or downloads; browsers only share a few
  file types, and PDF is the one that's readable everywhere and sent unchanged.
  *Open file* imports it (an ordinary PDF there starts a new scan). Imports never
  overwrite: if the score or its name is already in the library, it's added as
  "Title (2)" etc. The installed app is also a share target (manifest
  `share_target` → service worker inbox): shared score files are offered (and
  wait in the inbox until answered, since Android can launch the app twice),
  shared PDFs/photos start a new scan. Older `.partsong.html` files still open:
  via *Open file*, sharing, or their page's button (which posts the full score
  to the app); their link alone can't carry photos, so a score with photos isn't
  added that way and the app says to share the file to Partsong instead.
  Partsong is also registered to open PDFs (manifest `file_handlers` +
  `launchQueue`: desktop Chrome/Edge, and Android where Chrome supports it), so
  it appears under "Open with"; a score is offered, an ordinary PDF scanned
  (`tests/drive-open-with.js`).
  `tests/drive-share.js`, `tests/drive-receive.js` (with
  `tests/fixtures/legacy.partsong.html`), `tests/drive-share-target.js`.
- **Delete** (bin icon on each library row, or in a score's settings) asks to
  confirm; locked scores can't be deleted.
- **Make a copy** (copy icon on each library row): duplicates a score with its photos, marks and
  settings, e.g. to mark first and second sopranos as separate scores.
- **Report a problem** (home screen and score settings): emails
  bugs@partsong.app (forwarded via Namecheap) with the description plus the app
  version, device, current score/bar/part settings, recent errors and the
  reader's recent log, all shown to the user first; *Copy report* if there's no
  mail app. With a score open, *Share report with score* also attaches the score
  file (share sheet on phones, with the address copied to paste in; download +
  email on desktop).
- **Install and updates**: an install card on the home screen uses the browser's
  install prompt (Chrome/Edge); not offered on iPhone, where a home-screen app
  keeps a library apart from Safari's, which shared files open in; "Not
  now" snoozes it for a month. Installed apps rarely restart, so the app checks
  for a newer deploy (the version stamped into index.html) when it comes back to
  the screen and every 30 minutes, and offers an Update banner.
- **Library search**: from 6 scores a search box filters the list by title
  (every word must match; case and accents ignored). `tests/drive-search.js`.
- **Repeats**: repeat signs and 1st/2nd-time endings from homr's barlines
  (`repeatMarks`, `markRepeats`, `playOrder` in `score.js`); the player plays a
  list of score stretches in order (`player.js`), so a repeat plays twice and
  follow-along jumps back. homr can miss a forward repeat at the start of a
  line, so settings show each repeat's "goes back to bar" (saved per score),
  plus a *Play repeats* switch. `tests/drive-repeats.js` (needs
  `testdata/tallis_0..2.musicxml`, the sample as read).
- **Usage counts**: GoatCounter (partsong.goatcounter.com), cookie-free and
  anonymous: page views plus a few events via `track()` in `app.js` (sample,
  read-ok/read-failed with page count, first play per opened score, share,
  install, report). Never titles or music. Its script skips localhost.
  `tests/drive-analytics.js` checks the events with GoatCounter stubbed.
- **Sample score** (*Try a sample score*): `samples/tallis-if-ye-love-me.pdf`,
  Tallis's *If ye love me* (ed. K. Jaworski, CPDL licence), three pages: four
  vocal staves plus a piano reduction.
- **Vocal staves with a piano part**: one-staff parts alongside a two-staff part
  are named Soprano/Alto/Tenor/Bass (or Voice 1, 2…), and the piano lines start
  switched off so they don't double the voices. A tenor in treble clef is
  dropped an octave (the reader doesn't report the clef's little 8).
- **Lock**: a locked score can't have its part, title or existence changed
  (tempo, mix and bar range still work).
- **Playback** (`player.js`): Web Audio; each note's volume and octave come from
  the app at scheduling time; tempo, bar range, loop. Three synthesised sounds
  (*Sound*: piano, organ, voice), remembered per device;
  `tests/drive-instrument.js` renders each offline and returns them as WAV.
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
node scripts/headless-test.mjs "http://localhost:8765/tests/split-compare.html?set=huronv&n=4" out.json 30
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 600 tests/drive-app.js shot
node scripts/headless-test.mjs "http://127.0.0.1:8765/index.html" out.json 600 tests/drive-offline.js shot
node scripts/headless-test.mjs "http://localhost:8765/testdata/" out.json 400 tests/drive-library.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-follow.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 400 tests/drive-nav.js shot
node scripts/headless-test.mjs "http://localhost:8765/tests/orient-test.html" out.json 100
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 450 tests/drive-pdf.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-files.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 120 tests/drive-open-with.js shot
(cd relay && npx wrangler dev --port 8787 --var "ORIGINS:http://localhost:8765" &)
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 300 tests/drive-relay.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 180 tests/drive-manual.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-lock.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-views.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-read-follow.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 180 tests/drive-share.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 100 tests/drive-library-share.js shot
CHROME_FLAGS=--disable-popup-blocking node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 180 tests/drive-receive.js shot
node scripts/headless-test.mjs "http://127.0.0.1:8765/testdata/" out.json 180 tests/drive-share-target.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 60 tests/drive-hidden.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 60 tests/drive-panel.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 60 tests/drive-copy.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 60 tests/drive-delete.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 60 tests/drive-report.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 40 tests/drive-about.js shot
# update banner + install card: stamped build on :8770, see the test header
SITE=<site-dir> node scripts/headless-test.mjs "http://localhost:8770/testdata/" out.json 180 tests/drive-update.js shot
node scripts/headless-test.mjs "http://localhost:8765/index.html" out.json 180 tests/drive-stale.js shot
python3 scripts/flaky-server.py 8768 --flaky &   # breaks every 3rd model response
node scripts/headless-test.mjs "http://localhost:8768/tests/omr-test.html?page=huron_1.png" out.json 380
python3 scripts/flaky-server.py 8769 &
node scripts/headless-test.mjs "http://localhost:8769/testdata/" out.json 480 tests/drive-download-resume.js shot
python3 scripts/hang-server.py 8766 &   # /__hang?on makes requests hang, like a weak signal
node scripts/headless-test.mjs "http://127.0.0.1:8766/index.html" out.json 120 tests/drive-slow-start.js shot
CPU_THROTTLE=4 node scripts/headless-test.mjs "http://localhost:8765/index.html?view=switch" out.json 180 tests/drive-read-timing.js shot
node scripts/headless-test.mjs "http://localhost:8765/testdata/" out.json 700 tests/drive-resume.js shot
node scripts/headless-test.mjs "http://localhost:8765/testdata/" out.json 400 tests/drive-resume-manual.js shot
```

## Deploy

`.github/workflows/pages.yml` fetches homr and the models and publishes to
GitHub Pages (custom domain `partsong.app`, set in the repo's Pages settings) on
every push to `main`. `scripts/stamp-version.mjs` adds `?v=<commit>` to the app's
CSS/JS references so a deploy is never mixed with cached files from the last one (models aren't committed; GitHub release
downloads don't allow cross-origin fetches, so they're served with the site).

## Limits

- Recognition errors happen: check "Show what was read" against your copy.
  Dynamics, lyrics and repeats are ignored.
- Accuracy depends on the photo: flat page, even light, phone square-on.

## Licence

© 2026 Paul Fremantle. Partsong is free software under the GNU Affero General
Public License v3.0 (see `LICENSE`); it has to be, as it distributes homr. The
app's About page links here, which is the offer of source to its users.

Third-party components: [homr](https://github.com/liebharc/homr) (AGPL-3.0),
whose models build on [oemer](https://github.com/BreezeWhite/oemer) (MIT) and
[Polyphonic-TrOMR](https://github.com/NetEase/Polyphonic-TrOMR) (Apache-2.0);
[Pyodide](https://pyodide.org) (MPL-2.0) with NumPy (BSD-3-Clause), OpenCV
(Apache-2.0) and Pillow (MIT-CMU); [ONNX Runtime Web](https://onnxruntime.ai)
(MIT); [pdf.js](https://mozilla.github.io/pdf.js/) (Apache-2.0);
[OpenSheetMusicDisplay](https://opensheetmusicdisplay.org) (BSD-3-Clause).
