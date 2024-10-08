import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";


// Carica la configurazione di Firebase dal file config.json
fetch('config.json')
    .then(response => {
        if (!response.ok) {
            throw new Error('Errore nel caricamento del file di configurazione');
        }
        return response.json();
    })
    .then(config => {
        // Ottieni le impostazioni dal configuratore
        const firebaseConfig = config['firebaseDB'];
        const authConfig = config['firebaseAuth'];

        // Inizializza Firebase con la configurazione caricata
        const app = initializeApp(firebaseConfig);

        // Ottieni i servizi di autenticazione e Firestore
        const auth = getAuth(app);
        const db = getFirestore(app);

        // Accedi al database
        const { email, password } = authConfig;
        signInWithEmailAndPassword(auth, email, password)
            .then(userCredential => {
                console.log("Login effettuato con successo.");
            })
            .catch(error => {
                console.error("Errore durante l'accesso:", error);
            });

        window.aggiornaFirestore = function (messaggio, colore) {
            const notificheCollection = collection(db, 'notifiche');
            const notificaDoc = doc(notificheCollection, 'notificaCorrente');
            setDoc(notificaDoc, {
                messaggio: messaggio,
                colore: colore
            })
                .then(() => {
                    console.log('Documento aggiornato con successo!');
                })
                .catch((error) => {
                    console.error('Errore durante l\'aggiornamento del documento: ', error);
                });
        };

    })
    .catch(error => {
        console.error('Errore nel caricamento del file di configurazione:', error);
    });
