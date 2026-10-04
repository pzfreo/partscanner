// Renders each page of a PDF to a PNG for recognition, via pdf.js (loaded on
// first use; the service worker caches it for offline use).

const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/";
const TARGET_WIDTH = 2480; // about 300 dpi across an A4 page
const MAX_SIDE = 4200; // same cap as photos (see normalise() in app.js)

let pdfjs;

function load() {
  pdfjs ??= import(PDFJS_URL + "pdf.min.mjs").then((lib) => {
    lib.GlobalWorkerOptions.workerSrc = PDFJS_URL + "pdf.worker.min.mjs";
    return lib;
  });
  return pdfjs;
}

export const isPdf = (file) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);

// Calls onPage(blob, pageNumber, pageCount) for each page, in order.
export async function pdfPages(file, onPage) {
  const lib = await load();
  const task = lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(TARGET_WIDTH / base.width, MAX_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      page.cleanup();
      await onPage(await new Promise((r) => canvas.toBlob(r, "image/png")), n, doc.numPages);
    }
  } finally {
    task.destroy();
  }
}
