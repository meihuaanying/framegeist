// FrameGeist offline cache (PRD G4): engine + fonts + manifests + page shell.
// Strategy:
//   - fonts / wasm / favicon  → cache-first (immutable)
//   - templates / layouts     → stale-while-revalidate
//   - page shell (html/js/css/manifest/json) → network-first (fall back to cache offline)
// v1.5.0: the cache bucket is named after the same constant the UI reports in
// Settings/About; keeping one literal in web/version.js stops the two from
// drifting apart. Loaded as a classic script because a service worker cannot
// import an ES module.
importScripts("./version.js");
const VERSION = `framegeist-${self.FG_VERSION}`;
const PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./editor.js",
  "./i18n.js",
  "./version.js",
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
  // v1.5.0 audit: `cache.addAll` rejects the whole batch on the first failure, so
  // one unavailable precache URL (a font that moved, an optional asset) kept
  // install pending forever and the worker never took over. Fetch each entry
  // independently so one 404 cannot block activation.
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.allSettled(PRECACHE.map((url) => c.add(url))))
      .then(() => self.skipWaiting())
  );
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
  // Never cache the GitHub API. `pathname.includes` also matched any *local*
  // path that merely contained that substring (a template id, a query echo),
  // which silently skipped caching for it. Match the host, and the same-origin
  // proxy prefix if one is ever added.
  if (url.hostname === "api.github.com" || url.hostname.endsWith(".api.github.com")) return;

  const isTemplateOrLayout = url.pathname.includes("/templates/") || url.pathname.includes("/layouts/");
  const isShell = e.request.mode === "navigate" || SHELL_RE.test(url.pathname);

  e.respondWith(
    caches.open(VERSION).then(async (cache) => {
      if (isTemplateOrLayout) {
        // stale-while-revalidate
        const cached = await cache.match(e.request);
        // v1.5.0: `refresh` used to resolve to whatever `cache.put` returns --
        // `undefined` for a miss-safe put, a boolean from `r.ok && ...` -- and
        // never to a Response. The cache-miss path therefore always fell
        // through to a *second* network request for the same asset. Return the
        // response and keep the put as a side effect.
        const refresh = fetch(e.request)
          .then((r) => {
            if (r.ok) cache.put(e.request, r.clone());
            return r;
          })
          .catch(() => null);
        if (cached) { e.waitUntil(refresh); return cached; }
        return (await refresh) || fetch(e.request);
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
