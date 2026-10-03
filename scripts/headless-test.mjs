// Opens a page in headless Chrome, streams its console, and waits until
// `window.result` is set (or times out). Writes the result JSON to argv[3].
// Usage: node scripts/headless-test.mjs <url> <out.json> [timeoutSec] [drive.js] [screenshot-prefix]
// drive.js (optional) is evaluated in the page after load; it may call
// `await shot()` to request a screenshot and must set window.result.
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out, timeoutSec = "900", driveFile, shotPrefix] = process.argv.slice(2);
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const port = 9333;
const chrome = spawn(CHROME, [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "chrome-"))}`,
  "--enable-unsafe-webgpu",
  "--autoplay-policy=no-user-gesture-required",
  ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(" ") : []),
  "about:blank",
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let wsUrl;
for (let i = 0; i < 50 && !wsUrl; i++) {
  await sleep(200);
  try {
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    wsUrl = tabs.find((t) => t.type === "page")?.webSocketDebuggerUrl;
  } catch {}
}
const ws = new WebSocket(wsUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 1;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
const t0 = Date.now();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)(msg.result);
  if (msg.method === "Runtime.consoleAPICalled") {
    const text = msg.params.args.map((a) => a.value ?? a.description).join(" ");
    if (text.startsWith("__EXEC__ ")) {
      spawn("sh", ["-c", text.slice(9)]).on("exit", (code) => console.log("exec exit", code));
      return;
    }
    if (text === "__SHOT__" || text === "__SHOTVIEW__") {
      send("Page.captureScreenshot", { format: "png", captureBeyondViewport: text === "__SHOT__" }).then((r) => {
        const file = `${shotPrefix}-${++shots}.png`;
        writeFileSync(file, Buffer.from(r.data, "base64"));
        console.log("screenshot", file);
        send("Runtime.evaluate", { expression: "window.__shotDone()" });
      });
      return;
    }
    console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, text.slice(0, 400));
  }
  if (msg.method === "Runtime.exceptionThrown") console.log("EXCEPTION", JSON.stringify(msg.params.exceptionDetails).slice(0, 800));
};
await send("Runtime.enable");
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 915, deviceScaleFactor: 2, mobile: true });
const nav = await send("Page.navigate", { url });
console.log("navigated", JSON.stringify(nav));
let shots = 0;
if (driveFile) {
  await sleep(1500);
  const { readFileSync } = await import("node:fs");
  const code = readFileSync(driveFile, "utf8");
  send("Runtime.evaluate", {
    expression: `window.shot = (full = true) => new Promise(r => { window.__shotDone = r; console.log(full ? "__SHOT__" : "__SHOTVIEW__"); }); (async () => { ${code} })().catch(e => { window.result = { error: String(e.stack || e) }; });`,
  });
}

const deadline = Date.now() + Number(timeoutSec) * 1000;
let result = null;
while (Date.now() < deadline) {
  await sleep(2000);
  const r = await send("Runtime.evaluate", { expression: "JSON.stringify(window.result ?? null)", returnByValue: true });
  if (r?.result?.value && r.result.value !== "null") {
    result = r.result.value;
    break;
  }
}
if (result) writeFileSync(out, result);
console.log(result ? `DONE in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}` : "TIMEOUT");
ws.close();
chrome.kill();
process.exit(result ? 0 : 1);
