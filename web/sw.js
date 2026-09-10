// FrameGeist offline cache (PRD G4): engine + fonts + manifests + page shell.
// Template/layout JSONs are cached at runtime (cache-first, refreshed in bg).
const VERSION = "framegeist-v1";
const PRECACHE = [
  "./",
  "./index.html",
  "./pkg/framegeist_wasm.js",
  "./pkg/framegeist_wasm_bg.wasm",
  "./templates.json",
  "./layouts.json",
  "./templates/fonts/JetBrainsMono-Regular.ttf",
  "./manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api.github.com")) return;

  const isTemplateOrLayout =
    url.pathname.includes("/templates/") || url.pathname.includes("/layouts/");

  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      const cached = await cache.match(e.request);
      if (cached) {
        if (isTemplateOrLayout) {
          // stale-while-revalidate for template/layout JSONs
          fetch(e.request).then((r) => r.ok && cache.put(e.request, r.clone())).catch(() => {});
        }
        return cached;
      }
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    })
  );
});
