self.addEventListener("install", () => {
    console.log("[Service Worker] Installazione");
    self.skipWaiting();
});

self.addEventListener("activate", event => {
    console.log("[Service Worker] Attivazione");

    event.waitUntil(self.clients.claim());
});