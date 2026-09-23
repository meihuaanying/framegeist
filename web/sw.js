// FrameGeist offline cache (PRD G4): engine + fonts + manifests + page shell.
// Strategy:
//   - fonts / wasm / favicon  → cache-first (immutable)
//   - templates / layouts     → stale-while-revalidate
//   - page shell (html/js/css/manifest/json) → network-first (fall back to cache offline)
const VERSION = "framegeist-0.9.3";
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./editor.js",
  "./i18n.js",
  "./pkg/framegeist_wasm.js",
  "./pkg/framegeist_wasm_bg.wasm",
  "./templates.json",
  "./layouts.json",
  "./favicon.svg",
  "./manifest.webmanifest",
  "./fonts/host-grotesk-latin.woff2",
  "./fonts/dm-sans-400.woff2",
  "./fonts/dm-sans-500.woff2",
  "./templates/fonts/JetBrainsMono-Regular.ttf",
];

// Tauri custom-protocol origin: never cache there (and self-destruct if an
// older build registered us on it).
const IS_TAURI = self.location.hostname === "tauri.localhost" || self.location.hostname.endsWith(".tauri.localhost");

const SHELL_RE = /\.(?:html|js|css|json|webmanifest|svg)$/;

self.addEventListener("install", (e) => {
  if (IS_TAURI) { self.skipWaiting(); return; }
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  if (IS_TAURI) {
    e.waitUntil(
      caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
    );
    return;
  }
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (IS_TAURI) return;
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api.github.com")) return;

  const isTemplateOrLayout = url.pathname.includes("/templates/") || url.pathname.includes("/layouts/");
  const isShell = e.request.mode === "navigate" || SHELL_RE.test(url.pathname);

  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      if (isTemplateOrLayout) {
        // stale-while-revalidate
        const cached = await cache.match(e.request);
        const refresh = fetch(e.request).then((r) => r.ok && cache.put(e.request, r.clone())).catch(() => {});
        if (cached) { e.waitUntil(refresh); return cached; }
        const res = await refresh;
        return res || fetch(e.request);
      }
      if (isShell) {
        // network-first: always pick up new builds when online
        try {
          const res = await fetch(e.request);
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        } catch {
          const cached = await cache.match(e.request);
          if (cached) return cached;
          return fetch(e.request);
        }
      }
      const cached = await cache.match(e.request);
      if (cached) return cached;
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    })
  );
});
