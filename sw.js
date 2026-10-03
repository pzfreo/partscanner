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
      fetch(e.request)
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
