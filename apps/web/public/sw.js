// MusicOrbit App-Shell Service Worker
// Caches static UI shell assets while strictly bypassing /api/*, auth, uploads, and Range audio streams.

const CACHE_NAME = "musicorbit-shell-v1";
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never intercept API calls, auth cookies, cover updates, or HTTP 206 byte-range audio streams
  if (url.pathname.startsWith("/api/") || request.headers.has("range")) return;

  // Navigation requests: network-first with cached app shell fallback
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match("/");
        return cached ?? Response.error();
      }),
    );
    return;
  }

  // Hashed Vite assets & static icons: cache-first, populate cache on miss
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
  }
});
