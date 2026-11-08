// Poggioreale: l'applicazione deve aprirsi dalla cache anche con Wi-Fi senza Internet.
const STATIC_CACHE = "poggioreale-static-v4";
const RUNTIME_CACHE = "poggioreale-runtime-v4";

// Risorse essenziali: non includere favicon o file opzionali che possano invalidare l'installazione.
const APP_SHELL = [
  "/", "/index.html", "/addSong.html", "/style.css", "/main.js",
  "/config.json", "/manifest.json", "/js/addSong.js",
  "/js/downloadBackup.js", "/js/importBackup.js", "/js/localDb.js",
  "/js/metronome.js", "/js/pwa.js", "/js/transposeUtils.js"
];
const OPTIONAL_ASSETS = [
  "/favicon.ico", "/resources/icons/icon-192.png", "/resources/icons/icon-512.png",
  "https://ajax.googleapis.com/ajax/libs/jquery/3.6.0/jquery.min.js",
  "https://code.jquery.com/jquery-3.5.1.js",
  "https://code.jquery.com/jquery-3.5.1.min.js",
  "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css",
  "https://cdn.jsdelivr.net/npm/bootstrap-icons/font/bootstrap-icons.css",
  "https://cdn.jsdelivr.net/npm/@yaireo/tagify/dist/tagify.css",
  "https://cdn.jsdelivr.net/npm/@yaireo/tagify/dist/tagify.min.js",
  "https://cdn.jsdelivr.net/npm/sweetalert2@10",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0-beta3/css/all.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/css/bootstrap.min.css",
  "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js",
  "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js"
];
const STATIC_EXTERNAL_HOSTS = new Set([
  "cdn.jsdelivr.net", "cdnjs.cloudflare.com", "ajax.googleapis.com",
  "code.jquery.com", "www.gstatic.com", "stackpath.bootstrapcdn.com"
]);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // In caso di errore su un asset essenziale, non sostituire il precedente SW funzionante.
    await cache.addAll(APP_SHELL);
    // Il vecchio runtime può contenere librerie CDN necessarie all'avvio offline.
    const previousRuntime = await caches.open("poggioreale-runtime-v3");
    const oldKeys = await previousRuntime.keys();
    await Promise.allSettled(oldKeys.map(async key => {
      const response = await previousRuntime.match(key);
      if (response && !(await cache.match(key))) await cache.put(key, response);
    }));
    await Promise.allSettled(OPTIONAL_ASSETS.map(path => cache.add(path)));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const all = await caches.keys();
    await Promise.all(all.filter(name => name.startsWith("poggioreale-") &&
      name !== STATIC_CACHE && name !== RUNTIME_CACHE).map(name => caches.delete(name)));
  })());
});

async function cacheFirst(request, fallback) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === "opaque") {
      const copy = response.clone();
      // Non bloccare la risposta per attendere il salvataggio della cache.
      caches.open(RUNTIME_CACHE).then(cache => cache.put(request, copy)).catch(console.warn);
    }
    return response;
  } catch (error) {
    if (fallback) {
      const page = await caches.match(fallback);
      if (page) return page;
    }
    throw error;
  }
}

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // Solo per la verifica Internet: niente cache, niente risposta artificiale del SW.
  if (url.origin === self.location.origin && url.searchParams.has("connectivity-probe")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.mode === "navigate") {
    // Cache First: la connessione X32 non deve ritardare il caricamento della PWA.
    const fallback = url.pathname === "/addSong.html" ? "/addSong.html" : "/index.html";
    event.respondWith((async () => {
      const cached = await caches.match(request, { ignoreSearch: true });
      if (cached) return cached;
      const shell = await caches.match(fallback);
      if (shell) return shell;
      return cacheFirst(request, fallback);
    })());
    return;
  }

  if (url.origin === self.location.origin || STATIC_EXTERNAL_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(request));
  }
});
