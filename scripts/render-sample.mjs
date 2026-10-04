// Engraves samples/joyful-joyful.musicxml (via samples/render.html, Verovio)
// and prints it to samples/joyful-joyful.pdf with headless Chrome.
// Usage: python3 -m http.server 8765 (repo root) & node scripts/render-sample.mjs
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9334;
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "chrome-"))}`, "about:blank"]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) {
  await sleep(200);
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    const url = tabs.find((t) => t.type === "page")?.webSocketDebuggerUrl;
    if (url) ws = new WebSocket(url);
  } catch {}
}
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const m = JSON.parse(data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m.result);
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.navigate", { url: "http://localhost:8765/samples/render.html" });
let pages = 0;
for (let i = 0; i < 60 && !pages; i++) {
  await sleep(500);
  const r = await send("Runtime.evaluate", { expression: "window.result?.pages ?? 0", returnByValue: true });
  pages = r?.result?.value ?? 0;
}
const pdf = await send("Page.printToPDF", { paperWidth: 8.27, paperHeight: 11.69, marginTop: 0, marginBottom: 0, marginLeft: 0, marginRight: 0, printBackground: true, preferCSSPageSize: true });
writeFileSync("samples/joyful-joyful.pdf", Buffer.from(pdf.data, "base64"));
console.log(`samples/joyful-joyful.pdf: ${pages} page(s)`);
ws.close();
chrome.kill();
process.exit(0);
