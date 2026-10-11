// /js/localDb.js

const DB_NAME = "PoggiorealeLiveCollection";
const DB_VERSION = 1;

const STORE_META = "meta";
const STORE_COLLECTIONS = "collections";
const STORE_SONGS = "songs";


// ======================================================
// APERTURA DATABASE
// ======================================================

export function openLocalDb() {
    return new Promise((resolve, reject) => {

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => {
            reject(request.error);
        };

        request.onsuccess = () => {
            resolve(request.result);
        };

        request.onupgradeneeded = event => {

            const db = event.target.result;

            // Informazioni generali
            if (!db.objectStoreNames.contains(STORE_META)) {
                db.createObjectStore(STORE_META, {
                    keyPath: "key"
                });
            }

            // Elenco raccolte
            if (!db.objectStoreNames.contains(STORE_COLLECTIONS)) {
                db.createObjectStore(STORE_COLLECTIONS, {
                    keyPath: "name"
                });
            }

            // Cantici
            if (!db.objectStoreNames.contains(STORE_SONGS)) {

                const songsStore = db.createObjectStore(STORE_SONGS, {
                    keyPath: "localId"
                });

                songsStore.createIndex(
                    "byCollection",
                    "raccolta",
                    { unique: false }
                );
            }
        };
    });
}


// ======================================================
// CONTROLLO PRESENZA DATI
// ======================================================

export async function hasLocalSnapshot() {

    const db = await openLocalDb();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_META,
            "readonly"
        );

        const store = transaction.objectStore(STORE_META);

        const request = store.get("snapshotCompleted");

        request.onsuccess = () => {
            resolve(request.result?.value === true);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}


// ======================================================
// SALVATAGGIO SNAPSHOT COMPLETA
// ======================================================

export async function saveFullSnapshot({
    cliente,
    raccolte
}) {

    const db = await openLocalDb();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            [
                STORE_META,
                STORE_COLLECTIONS,
                STORE_SONGS
            ],
            "readwrite"
        );

        const metaStore =
            transaction.objectStore(STORE_META);

        const collectionsStore =
            transaction.objectStore(STORE_COLLECTIONS);

        const songsStore =
            transaction.objectStore(STORE_SONGS);


        // ---------------------------------------
        // RESET LOCALE
        // ---------------------------------------

        metaStore.clear();
        collectionsStore.clear();
        songsStore.clear();


        // ---------------------------------------
        // DOCUMENTO CLIENTE
        // ---------------------------------------

        metaStore.put({
            key: "cliente",
            value: cliente
        });


        // ---------------------------------------
        // RACCOLTE + CANTICI
        // ---------------------------------------

        for (const [nomeRaccolta, songs] of Object.entries(raccolte)) {

            collectionsStore.put({
                name: nomeRaccolta
            });

            for (const song of songs) {

                songsStore.put({
                    ...song,

                    raccolta: nomeRaccolta,

                    // evita collisioni tra ID uguali
                    // appartenenti a raccolte differenti
                    localId: `${nomeRaccolta}__${song.id}`
                });
            }
        }


        // ---------------------------------------
        // METADATI SNAPSHOT
        // ---------------------------------------

        metaStore.put({
            key: "lastFullSync",
            value: new Date().toISOString()
        });

        metaStore.put({
            key: "snapshotCompleted",
            value: true
        });


        transaction.oncomplete = () => {
            resolve();
        };

        transaction.onerror = () => {
            reject(transaction.error);
        };

        transaction.onabort = () => {
            reject(transaction.error);
        };
    });
}


// ======================================================
// LETTURA RACCOLTE
// la useremo nella fase 4
// ======================================================

export async function getLocalCollections() {

    const db = await openLocalDb();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_COLLECTIONS,
            "readonly"
        );

        const store =
            transaction.objectStore(STORE_COLLECTIONS);

        const request = store.getAll();

        request.onsuccess = () => {
            resolve(
                request.result.map(x => x.name)
            );
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}


// ======================================================
// LETTURA CANTICI DI UNA RACCOLTA
// la useremo nella fase 4
// ======================================================

export async function getLocalSongsByCollection(nomeRaccolta) {

    const db = await openLocalDb();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            STORE_SONGS,
            "readonly"
        );

        const store =
            transaction.objectStore(STORE_SONGS);

        const index =
            store.index("byCollection");

        const request =
            index.getAll(nomeRaccolta);

        request.onsuccess = () => {

            const songs = request.result.map(song => {

                const copy = { ...song };

                delete copy.localId;
                delete copy.raccolta;

                return copy;
            });

            resolve(songs);
        };

        request.onerror = () => {
            reject(request.error);
        };
    });
}


// ======================================================
// RESET MANUALE
// servirà per il pulsante futuro
// ======================================================

export async function clearLocalDatabase() {

    const db = await openLocalDb();

    return new Promise((resolve, reject) => {

        const transaction = db.transaction(
            [
                STORE_META,
                STORE_COLLECTIONS,
                STORE_SONGS
            ],
            "readwrite"
        );

        transaction.objectStore(STORE_META).clear();
        transaction.objectStore(STORE_COLLECTIONS).clear();
        transaction.objectStore(STORE_SONGS).clear();

        transaction.oncomplete = () => resolve();

        transaction.onerror = () =>
            reject(transaction.error);
    });
}