if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
        try {
            const registration = await navigator.serviceWorker.register(
                "/service-worker.js"
            );

            console.log(
                "Service Worker registrato correttamente:",
                registration.scope
            );
        } catch (error) {
            console.error(
                "Errore durante la registrazione del Service Worker:",
                error
            );
        }
    });
}