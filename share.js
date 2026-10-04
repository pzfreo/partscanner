// Score files for sharing between devices or people (WhatsApp, Drive, email):
// an .html file (one of the few types browsers will hand to the share sheet)
// carrying the recognised MusicXML, page photos and practice settings as JSON.
// Opened anywhere else, it shows a note pointing to Partsong. (Internal ids
// keep the app's original name, Part Scanner, so older files still open.)

const FORMAT = "partscanner-score";
const SETTINGS = ["mine", "excluded", "manual", "octave", "tempo", "others", "locked", "repeats", "playRepeats"];
const PHOTO_QUALITY = 0.85;

async function toBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(data, type) {
  const s = atob(data);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Blob([bytes], { type });
}

// Same size, so note positions on the photo still line up.
async function asJpeg(blob) {
  const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  canvas.getContext("2d").drawImage(bmp, 0, 0);
  bmp.close();
  return canvas.convertToBlob({ type: "image/jpeg", quality: PHOTO_QUALITY });
}

// The score without photos, gzipped into a URL-safe string: small enough for a
// link (#import=...) that works even where the page's script can't run.
async function linkPayload(doc) {
  const json = JSON.stringify({ ...doc, images: [] });
  const gz = new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip")));
  return (await toBase64(await gz.blob())).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export async function entryFromLink(payload) {
  const gz = fromBase64(payload.replaceAll("-", "+").replaceAll("_", "/"), "application/gzip");
  const json = await new Response(gz.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return parseScoreFile(json);
}

export async function scoreFile(entry) {
  const images = [];
  for (const blob of entry.images ?? []) images.push(await toBase64(await asJpeg(blob)));
  const doc = {
    format: FORMAT,
    version: 1,
    id: entry.id,
    title: entry.title,
    created: entry.created,
    pages: entry.pages,
    images,
    settings: Object.fromEntries(SETTINGS.filter((k) => entry[k] !== undefined).map((k) => [k, entry[k]])),
  };
  const title = entry.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "Score";
  const app = new URL("./", location.href).href;
  const pages = `${entry.pages.length} page${entry.pages.length === 1 ? "" : "s"}`;
  // Opened from WhatsApp/email, the button is a link carrying the score minus
  // photos. With script, it also asks the app to fetch the photos from this
  // page; if the app can't reach back (e.g. an installed app catches the link),
  // it still has the score from the link.
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(entry.title)} – Partsong score</title>
<style>
body{font:17px/1.5 system-ui,sans-serif;max-width:36em;margin:2em auto;padding:0 16px;color:#1d1d1b;background:#f6f0e4}
h1{font-size:1.5rem;margin:0 0 .25em}
.open{display:block;margin:1.5em 0 .75em;padding:16px;border-radius:12px;background:#2b2870;color:#fff;text-align:center;font-weight:600;font-size:1.1rem;text-decoration:none}
.small{font-size:.9rem;color:#6b6a66}
a{color:#2b2870}
</style>
</head><body>
<h1>${escapeHtml(entry.title)}</h1>
<p>A <strong>Partsong</strong> score (${pages}) for learning your part.</p>
<a id="open" class="open" href="${app}#import=${await linkPayload(doc)}">Open in Partsong</a>
<p class="small">Partsong (<a href="${app}">${app.replace(/^https?:\/\//, "")}</a>) opens and asks to add the score to your library.</p>
<script type="application/json" id="${FORMAT}">${JSON.stringify(doc).replaceAll("</", "<\\/")}</script>
<script>
document.getElementById("open").addEventListener("click", (e) => {
  const json = document.getElementById("${FORMAT}").textContent;
  const app = window.open(e.currentTarget.href + "&receive", "_blank");
  if (!app) return; // popup blocked: follow the link instead
  e.preventDefault();
  addEventListener("message", function send(ev) {
    if (ev.source !== app || ev.data !== "partsong-ready") return;
    app.postMessage({ type: "partsong-score", json }, "*");
    removeEventListener("message", send);
  });
});
</script>
</body></html>
`;
  return new File([html], `${title}.partsong.html`, { type: "text/html" });
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

// Returns a library entry, or null if the text isn't a score file.
export function parseScoreFile(text) {
  const embedded = text.match(new RegExp(`<script type="application/json" id="${FORMAT}">([\\s\\S]*?)</script>`));
  const json = embedded ? embedded[1] : text.trimStart().startsWith("{") ? text : null;
  if (!json) return null;
  let doc;
  try {
    doc = JSON.parse(json);
  } catch {
    return null;
  }
  if (doc?.format !== FORMAT || !Array.isArray(doc.pages)) return null;
  return {
    ...doc.settings,
    id: doc.id || crypto.randomUUID(),
    title: doc.title || "Shared score",
    created: doc.created || Date.now(),
    pages: doc.pages,
    images: (doc.images ?? []).map((d) => fromBase64(d, "image/jpeg")),
  };
}

export const isMobile = () => navigator.userAgentData?.mobile ?? /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// Phones: the share sheet (WhatsApp, Drive, email). Desktop: a plain download,
// even where the browser offers a share menu (e.g. Chrome on macOS).
// "retry" means the share sheet needs a fresh tap (browsers only allow it
// shortly after one).
export async function shareFile(file, title) {
  if (isMobile() && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if (e.name === "AbortError") return "cancelled";
      if (e.name === "NotAllowedError") return "retry";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(file);
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return "downloaded";
}
