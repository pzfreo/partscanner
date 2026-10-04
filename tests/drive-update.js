// Update banner + install card, on a stamped build served at :8770 whose
// index.html the test runner restamps to v2 midway (via __EXEC__).
// Run with host page http://localhost:8770/testdata/ ; SITE env = site dir.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, ms, label) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await fn(); if (v) return v; } catch {} await sleep(250); } throw new Error("timeout waiting for " + label); };
const f = document.createElement("iframe");
f.style.cssText = "width:412px;height:900px;border:0";
f.src = "/index.html";
document.body.prepend(f);
await waitFor(() => f.contentDocument?.getElementById("update-banner") && f.contentWindow.document.readyState === "complete", 20000, "app");
const d = () => f.contentDocument, $ = (id) => d().getElementById(id);
const r = {};
await sleep(11000); // first check at 10 s: same version, no banner
r.noBannerWhenCurrent = $("update-banner").hidden;
console.log("__EXEC__ sed -i '' 's/?v=v1/?v=v2/g' \"$SITE/index.html\"");
await sleep(62000); // checks are at most once a minute
f.contentDocument.dispatchEvent(new Event("visibilitychange"));
await waitFor(() => !$("update-banner").hidden, 10000, "update banner");
r.bannerOnNewVersion = true;
$("update-now").click();
await sleep(500);
await waitFor(() => $("about-version") && f.contentWindow.document.readyState === "complete", 20000, "reloaded");
await sleep(1000);
$("about").hidden = false; // version shown on the About page
r.afterUpdate = { version: d().querySelector("script[src^='app.js']").getAttribute("src"), banner: $("update-banner").hidden ? "hidden" : "shown" };
// Install card.
let prompted = false;
const offer = () => { const ev = new Event("beforeinstallprompt"); ev.prompt = () => (prompted = true); ev.userChoice = Promise.resolve({ outcome: "accepted" }); f.contentWindow.dispatchEvent(ev); };
offer(); await sleep(200);
r.cardShown = !$("install-card").hidden;
$("install-now").click(); await sleep(300);
r.installPrompted = prompted && $("install-card").hidden;
offer(); await sleep(200);
$("install-later").click(); await sleep(200);
f.contentWindow.location.reload();
await sleep(2500);
offer(); await sleep(300);
r.snoozedAfterNotNow = $("install-card").hidden;
window.result = r;
