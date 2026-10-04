// Run against http://localhost:8765/index.html.
// "Open with Partsong": launchQueue stubbed (headless has no OS file handling).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(150); } throw new Error("timeout waiting for " + label); };
const { scoreFile } = await import("/share.js");
const pages = [await (await fetch("/testdata/huron_1.musicxml")).text()];
const images = [await (await fetch("/testdata/huron_1.png")).blob()];
const score = await scoreFile({ id: "ow-1", title: "Opened with", created: 1, pages, images });
const plain = new File([await (await fetch("/testdata/huron.pdf")).blob()], "huron.pdf", { type: "application/pdf" });
const page = (await (await fetch("/index.html")).text()).replace("<head>", `<head><script>Object.defineProperty(window, "launchQueue", { value: { setConsumer(fn) { window.__consume = fn; } } });</script>`);
const launch = async (file) => {
  const f = document.createElement("iframe");
  f.srcdoc = page;
  document.body.append(f);
  await waitFor(() => f.contentWindow.__consume, 10000, "consumer");
  f.contentWindow.__consume({ files: [{ getFile: async () => file }] });
  return f;
};
const r = {};
let f = await launch(score);
const $ = (id) => f.contentDocument.getElementById(id);
r.offer = await waitFor(() => !$("import-offer").hidden && $("import-question").textContent, 10000, "offer");
f = await launch(plain);
r.plainScanPages = await waitFor(() => !f.contentDocument.getElementById("scan").hidden && f.contentDocument.querySelectorAll("#pages img").length === 4 && 4, 60000, "scan");
window.result = r;
