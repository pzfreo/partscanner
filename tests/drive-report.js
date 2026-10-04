// Report a problem: one share button with device-specific steps. With a score
// open it attaches the score file (phone: share sheet; desktop: download +
// email); from home, text only. Back, ✕ and tapping outside close it.
// Run against http://localhost:8765/index.html.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(100); } throw new Error("timeout waiting for " + label); };
const $ = (id) => document.getElementById(id);
const setPhone = (on) => Object.defineProperty(navigator, "userAgentData", { value: { mobile: on }, configurable: true });
const pages = [await (await fetch("/testdata/huron_0.musicxml")).text()];
const images = [await (await fetch("/testdata/huron_0.png")).blob()];
await new Promise((res) => { const q = indexedDB.open("partscanner", 1); q.onupgradeneeded = () => q.result.createObjectStore("scores", { keyPath: "id" }); q.onsuccess = () => { const tx = q.result.transaction("scores", "readwrite"); tx.objectStore("scores").put({ id: "h", title: "Huron", created: 1, pages, images, mine: 2 }); tx.oncomplete = res; }; });
$("new-scan").click(); history.back(); await sleep(400);
await waitFor(() => document.querySelector("#library button"), 5000, "library").then((b) => b.click());
await sleep(500);
$("from-bar").value = 7; $("from-bar").onchange();
const openFromSettings = async () => {
  if ($("panel").hidden) { $("settings").click(); await sleep(300); }
  document.querySelector("#panel .report-open").click(); await sleep(200);
};
const steps = () => [...$("report-steps").children].map((li) => li.textContent);
const r = {};

// Phone with a score.
setPhone(true);
navigator.canShare = () => true;
let shared;
navigator.share = async (d) => { shared = d; };
await openFromSettings();
r.onlyOneButton = $("report").querySelectorAll("button").length === 2; // share + ✕
r.phone = { button: $("report-share").textContent, steps: steps() };
$("report-text").value = "Altos get the soprano run in bar 20";
await shot(false);
$("report-share").click();
await waitFor(() => shared, 30000, "shared");
r.phone.shared = { file: shared.files[0].name, title: shared.title, textStart: shared.text.slice(0, 24), hasDetails: shared.text.includes("Position: Bar 7"), status: $("report-status").textContent };
$("report-close").click(); await sleep(300);
r.closeX = $("report").hidden && !$("practice").hidden;

// Desktop with a score.
setPhone(false);
await openFromSettings();
r.desktop = { steps: steps() };
let downloaded;
const origClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function () { if (this.download) downloaded = this.download; else origClick.call(this); };
$("report-share").click();
await waitFor(() => downloaded && $("report-share").dataset.href, 30000, "desktop");
HTMLAnchorElement.prototype.click = origClick;
const u = new URL($("report-share").dataset.href);
r.desktop.result = { downloaded, to: u.pathname, subject: u.searchParams.get("subject"), status: $("report-status").textContent };
$("report").dispatchEvent(new MouseEvent("click", { bubbles: true })); await sleep(300);
r.tapOutsideCloses = $("report").hidden;

// From home: text only.
$("panel-close").click(); await sleep(400);
$("back").click(); await sleep(500);
r.wentHome = !$("home").hidden;
setPhone(true);
shared = null;
document.querySelector("#home .report-open").click(); await sleep(200);
r.home = { button: $("report-share").textContent };
$("report-share").click();
await waitFor(() => shared, 10000, "home share");
r.home.sharedFiles = shared.files?.length ?? 0;
history.back(); await sleep(300);
r.backCloses = $("report").hidden && !$("home").hidden;
window.result = r;
