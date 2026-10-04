// Score files for sharing between devices or people (WhatsApp, Drive, email):
// an .html file (one of the few types browsers will hand to the share sheet)
// carrying the recognised MusicXML, page photos and practice settings as JSON.
// Opened anywhere else, it shows a note pointing to Partsong. (Internal ids
// keep the app's original name, Part Scanner, so older files still open.)

const FORMAT = "partscanner-score";
const SETTINGS = ["mine", "excluded", "manual", "octave", "tempo", "others", "locked"];
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
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(entry.title)} – Partsong score</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:36em;margin:2em auto;padding:0 16px;color:#1d1d1b}a{color:#1f4e5f}</style>
</head><body>
<h1>${escapeHtml(entry.title)}</h1>
<p>This is a <strong>Partsong</strong> score (${entry.pages.length} page${entry.pages.length === 1 ? "" : "s"}).
To practise with it, open <a href="${app}">${app.replace(/^https?:\/\//, "")}</a> and use <em>Open file</em>,
or share this file to the Partsong app.</p>
<script type="application/json" id="${FORMAT}">${JSON.stringify(doc).replaceAll("</", "<\\/")}</script>
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

// Android share sheet where available; otherwise a download. "retry" means
// the share sheet needs a fresh tap (browsers only allow it shortly after one).
export async function shareFile(file, title) {
  if (navigator.canShare?.({ files: [file] })) {
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
