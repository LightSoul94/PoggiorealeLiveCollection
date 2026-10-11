const STATIC_CACHE = "poggioreale-static-v1";
const RUNTIME_CACHE = "poggioreale-runtime-v1";

const APP_SHELL = [
    "/",
    "/index.html",
    "/addSong.html",
    "/style.css",
    "/main.js",
    "/config.json",
    "/manifest.json",
    "/favicon.ico",

    "/js/addSong.js",
    "/js/downloadBackup.js",
    "/js/importBackup.js",
    "/js/metronome.js",
    "/js/pwa.js",
    "/js/transposeUtils.js",

    "/resources/icons/icon-192.png",
    "/resources/icons/icon-512.png"
];

const STATIC_EXTERNAL_HOSTS = [
    "cdn.jsdelivr.net",
    "cdnjs.cloudflare.com",
    "ajax.googleapis.com",
    "code.jquery.com",
    "www.gstatic.com"
];


// =========================
// INSTALL
// =========================
self.addEventListener("install", event => {

    console.log("[Service Worker] Installazione");

    event.waitUntil(
        caches
            .open(STATIC_CACHE)
            .then(cache => {
                console.log("[Service Worker] Cache applicazione");
                return cache.addAll(APP_SHELL);
            })
    );

    self.skipWaiting();
});


// =========================
// ACTIVATE
// =========================
self.addEventListener("activate", event => {

    console.log("[Service Worker] Attivazione");

    event.waitUntil(
        caches.keys().then(cacheNames => {

            return Promise.all(
                cacheNames
                    .filter(cacheName =>
                        cacheName !== STATIC_CACHE &&
                        cacheName !== RUNTIME_CACHE
                    )
                    .map(cacheName => {
                        console.log(
                            "[Service Worker] Elimino vecchia cache:",
                            cacheName
                        );

                        return caches.delete(cacheName);
                    })
            );
        })
    );

    self.clients.claim();
});


// =========================
// FETCH
// =========================
self.addEventListener("fetch", event => {

    const request = event.request;

    if (request.method !== "GET") {
        return;
    }

    const url = new URL(request.url);


    // ---------------------------------
    // NAVIGAZIONE HTML
    // Network First
    // ---------------------------------
    if (request.mode === "navigate") {

        event.respondWith(
            fetch(request)
                .then(response => {

                    const clone = response.clone();

                    caches.open(RUNTIME_CACHE)
                        .then(cache => cache.put(request, clone));

                    return response;
                })
                .catch(async () => {

                    const cachedPage = await caches.match(request);

                    if (cachedPage) {
                        return cachedPage;
                    }

                    return caches.match("/index.html");
                })
        );

        return;
    }


    // ---------------------------------
    // FILE LOCALI
    // Cache First
    // ---------------------------------
    if (url.origin === self.location.origin) {

        event.respondWith(
            caches.match(request)
                .then(cachedResponse => {

                    if (cachedResponse) {
                        return cachedResponse;
                    }

                    return fetch(request)
                        .then(response => {

                            if (!response || !response.ok) {
                                return response;
                            }

                            const clone = response.clone();

                            caches.open(RUNTIME_CACHE)
                                .then(cache => {
                                    cache.put(request, clone);
                                });

                            return response;
                        });
                })
        );

        return;
    }


    // ---------------------------------
    // CDN / FIREBASE JS
    // Cache First
    // ---------------------------------
    if (STATIC_EXTERNAL_HOSTS.includes(url.hostname)) {

        event.respondWith(
            caches.match(request)
                .then(cachedResponse => {

                    if (cachedResponse) {
                        return cachedResponse;
                    }

                    return fetch(request)
                        .then(response => {

                            const clone = response.clone();

                            caches.open(RUNTIME_CACHE)
                                .then(cache => {
                                    cache.put(request, clone);
                                });

                            return response;
                        });
                })
        );
    }

});