// App shell: network-first so updates arrive, cache as offline fallback.
// CDN libraries (Pyodide, onnxruntime-web, OSMD) are versioned: cache-first.
// models/ is cached by omr-worker.js itself, so it passes straight through.
const SHELL = "partscanner-shell-v1";
const CDN = "partscanner-cdn-v1";

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
        return Response.redirect(new URL("./?inbox", self.registration.scope).href, 303);
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
    e.respondWith(
      // no-cache: revalidate with the server so app updates show up on the next
      // load instead of after the HTTP cache (10 min on GitHub Pages) expires.
      fetch(e.request.url, { cache: "no-cache" })
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request, { ignoreSearch: true })),
    );
  }
});
