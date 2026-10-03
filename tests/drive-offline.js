// Scans a page online, kills the local server, then scans again in a fresh
// app frame served only from the service worker and caches. Run against
// http://127.0.0.1:8765 (the app skips the service worker on "localhost").
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return; await sleep(500); } throw new Error("timeout waiting for " + label); };
async function scanIn(win) {
  const $ = (id) => win.document.getElementById(id);
  await waitFor(() => $("new-scan"), 20000, "app load");
  $("new-scan").click();
  const blob = await (await fetch("/testdata/huron_1.png")).blob();
  const dt = new win.DataTransfer(); dt.items.add(new win.File([blob], "p.png", { type: "image/png" }));
  $("gallery").files = dt.files; $("gallery").dispatchEvent(new win.Event("change"));
  await waitFor(() => !$("recognise").disabled, 10000, "page added");
  $("recognise").click();
  await waitFor(() => !$("practice").hidden || /Couldn't/.test($("status").textContent), 300000, "recognition");
  return { status: $("status").textContent, lines: [...win.document.querySelectorAll("#lines .pick span:first-of-type")].map((s) => s.textContent) };
}
await waitFor(() => navigator.serviceWorker.controller, 20000, "sw control");
const online = await scanIn(window);
console.log("__EXEC__ pkill -f 'http.server 8765'");
await sleep(1500);
const frame = document.createElement("iframe");
frame.src = "/index.html";
document.body.append(frame);
await waitFor(() => frame.contentWindow.document.getElementById("new-scan"), 20000, "iframe app");
let offline;
try { offline = await scanIn(frame.contentWindow); } catch (e) { offline = { error: String(e) }; }
window.result = { online, offline };
