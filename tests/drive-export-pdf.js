// Export PDF saves the score as a .partsong.pdf (a download on desktop) that
// Open PDF brings back as the same score. Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(300); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const share = await import("/share.js");
await sleep(500);
document.querySelector("#library-empty .try-sample").click();
await waitFor(() => document.querySelectorAll("#pages img").length === 3 && !$("recognise").disabled, 30000, "sample pages");
$("recognise").click();
await waitFor(() => !$("practice").hidden, 900000, "read");
$("tempo").value = 110; $("tempo").dispatchEvent(new Event("input"));
let saved = null;
const click = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () { if (this.download) saved = { name: this.download, href: this.href }; else click.call(this); };
$("export-pdf").click();
const r = {};
await waitFor(() => saved && $("export-pdf").textContent !== "Preparing…", 60000, "export");
r.button = $("export-pdf").textContent;
const blob = await (await fetch(saved.href)).blob();
const file = new File([blob], saved.name, { type: "application/pdf" });
const back = await share.readScoreFile(file);
r.file = { name: saved.name, mb: +(blob.size / 1e6).toFixed(1), isPdf: await (await import("/pdf-pages.js")).isPdf(file) };
r.back = back && { title: back.title, pages: back.pages?.length, images: back.images?.length, tempo: back.tempo };
if ($("panel").hidden) $("settings").click();
await sleep(600);
r.panelOpen = !$("panel").hidden;
await shot(false);
window.result = r;
