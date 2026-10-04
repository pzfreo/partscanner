// App shell: network-first so updates arrive, cache as offline fallback.
// CDN libraries (Pyodide, onnxruntime-web, OSMD) are versioned: cache-first.
// models/ is cached by omr-worker.js itself, so it passes straight through.
const SHELL = "partscanner-shell-v1";
const CDN = "partscanner-cdn-v1";
const NETWORK_WAIT = 3000; // ms before a hanging request falls back to the cache
let slowUntil = 0; // after a fallback, use the cache at once for a while

const SHELL_FILES = [
  "./",
  "index.html",
  "app.js",
  "score.js",
  "player.js",
  "db.js",
  "orient.js",
  "pdf-pages.js",
  "share.js",
  "styles.css",
  "omr-worker.js",
  "omr/onnxruntime.py",
  "omr/runner.py",
  "vendor/homr.zip",
  "manifest.webmanifest",
  "icon.svg",
  "icon-192.png",
  "fonts/plus-jakarta-sans-latin-wght.woff2",
  "samples/tallis-if-ye-love-me.pdf",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
});
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Android share sheet -> installed app (manifest share_target): stash the
  // files for the page to pick up, then open the app.
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith(
      (async () => {
        const form = await e.request.formData();
        const cache = await caches.open("partscanner-inbox");
        let i = 0;
        for (const f of form.getAll("files")) {
          if (!(f instanceof File)) continue;
          const headers = { "content-type": f.type, "x-name": encodeURIComponent(f.name) };
          await cache.put(`inbox/${Date.now()}-${i++}`, new Response(f, { headers }));
        }
        // A score can come as shared text rather than a file: keep long text too.
        for (const key of ["text", "title"]) {
          const t = form.get(key);
          if (typeof t === "string" && t.length > 1000) {
            const headers = { "content-type": "text/html", "x-name": "shared.partsong.html" };
            await cache.put(`inbox/${Date.now()}-${i++}`, new Response(t, { headers }));
          }
        }
        // TEMPORARY share check: every field received, name:type:size.
        const fields = [...form.entries()]
          .map(([k, v]) => (typeof v === "string" ? `${k}:text:${v.length}` : `${k}:${v.type || "?"}:${v.size}`))
          .join(",");
        // Android can launch the app twice for one share, and the page may
        // already have looked in the inbox: tell open pages it has changed.
        for (const c of await self.clients.matchAll({ type: "window" })) c.postMessage({ type: "inbox" });
        // ?inbox=<files stored> (the count is for the temporary share check).
        return Response.redirect(new URL(`./?inbox=${i}&fields=${encodeURIComponent(fields || "none")}`, self.registration.scope).href, 303);
      })(),
    );
    return;
  }
  if (e.request.method !== "GET") return;
  if (url.hostname === "cdn.jsdelivr.net") {
    e.respondWith(
      caches.open(CDN).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }),
    );
  } else if (url.origin === location.origin && !url.pathname.includes("/models/")) {
    // no-cache: revalidate with the server so app updates show up on the next
    // load instead of after the HTTP cache (10 min on GitHub Pages) expires.
    const fresh = fetch(e.request.url, { cache: "no-cache" }).then((res) => {
      slowUntil = 0;
      if (res.ok) {
        const copy = res.clone();
        e.waitUntil(caches.open(SHELL).then((c) => c.put(e.request, copy)));
      }
      return res;
    });
    // The exact version the page asked for (?v=…) first, so files match.
    const cached = async () => (await caches.match(e.request)) || caches.match(e.request, { ignoreSearch: true });
    // On a weak connection the network can hang rather than fail: after a few
    // seconds use the cached copy (the fetch still refreshes the cache, and the
    // Update banner offers the new version).
    const wait = Date.now() < slowUntil ? 0 : NETWORK_WAIT;
    const slow = new Promise((r) => setTimeout(r, wait)).then(cached);
    e.respondWith(
      Promise.race([
        fresh.catch(cached),
        slow.then((hit) => {
          if (hit) slowUntil = Date.now() + 30000;
          return hit || fresh;
        }),
      ]).then((res) => res || fresh),
    );
    e.waitUntil(fresh.catch(() => {}));
  }
});
