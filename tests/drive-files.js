// File picking: content-sniffed PDFs, and clear refusals for files the browser
// can't decode (empty, HEIC, not an image). Run against /index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(200); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const fetchBlob = async (p) => (await fetch(p)).blob();
const heic = new Uint8Array([0, 0, 0, 24, ...new TextEncoder().encode("ftypheic"), 0, 0, 0, 0, ...new Array(64).fill(1)]);
const files = [
  new File([await fetchBlob("/testdata/huron.pdf")], "document", { type: "" }),
  new File([], "IMG_0001.jpg", { type: "image/jpeg" }),
  new File([heic], "IMG_0002.HEIC", { type: "image/heic" }),
  new File(["just text"], "notes.txt", { type: "text/plain" }),
  new File([await fetchBlob("/testdata/cam_0_exif6.jpg")], "IMG_0003.jpg", { type: "image/jpeg" }),
];
$("new-scan").click();
const dt = new DataTransfer(); files.forEach((f) => dt.items.add(f));
$("gallery").files = dt.files; $("gallery").dispatchEvent(new Event("change"));
const imgs = () => [...document.querySelectorAll("#pages img")];
await waitFor(() => /notes\.txt/.test($("status").textContent), 60000, "all files processed")
  .catch((e) => { throw new Error(`${e.message} | status=${$("status").textContent} | pages=${imgs().length}`); });
await waitFor(() => imgs().every((i) => i.complete), 10000, "thumbs");
await shot(false);
window.result = {
  pagesAdded: imgs().length,
  allDecodable: imgs().every((i) => i.naturalWidth > 0),
  name: $("scan-name").value,
  status: $("status").textContent.split("\n"),
};
