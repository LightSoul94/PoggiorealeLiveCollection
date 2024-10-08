import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getFirestore, collection, addDoc, doc, setDoc, getDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { containsChord, transposeChord } from './transposeUtils.js';

let db;
let auth;

try {
    // Ottieni il file di configurazione
    const response = await fetch('config.json');
    if (!response.ok) {
        throw new Error('Errore nel caricamento del file di configurazione');
    }

    // Converte la risposta in JSON
    const configurator = await response.json();

    // Ottieni le impostazioni dal configuratore
    const firebaseConfig = configurator['firebaseDB'];
    const authConfig = configurator['firebaseAuth'];

    if (!firebaseConfig || !authConfig) {
        throw new Error("Errore: Firebase non è stato inizializzato correttamente. Verifica la tua configurazione.");
    }

    // Inizializza l'app Firebase
    const app = initializeApp(firebaseConfig);

    // Ottieni i servizi di autenticazione e Firestore
    auth = getAuth(app);
    db = getFirestore(app);

    console.log("Firebase è stato inizializzato correttamente.");

    // Accedi al database
    const { email, password } = authConfig;
    signInWithEmailAndPassword(auth, email, password)
        .then(userCredential => {
            console.log("Login effettuato con successo.");
        })
        .catch(error => {
            console.error("Errore durante l'accesso:", error);
        });

} catch (error) {
    console.error("Errore:", error);
}

// Valore di trasposizione corrente
let transposeValue = 0;
// Valore contatore caratteri per auto-break
let charCounter = 0;

// Inizializza TinyMCE per l'editor di testo
tinymce.init({
    selector: '#song-editor',
    force_br_newlines: true,
    menubar: false,
    plugins: 'lists link image charmap preview anchor',
    toolbar: 'undo redo | bold italic | forecolor | fontsize | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | link',
    setup: function (editor) {
        editor.on('keydown', function (e) {
            if (e.keyCode === 13) {
                charCounter = 0;
                e.preventDefault(); // Prevent default behavior (inserting <p> tag)
                editor.execCommand('InsertLineBreak'); // Insert <br> tag instead
            }
            // Gestisce il decremento del contatore per backspace o cancella
            if (e.keyCode === 8 || e.keyCode === 46) { // Backspace o Delete
                charCounter = Math.max(0, charCounter - 1); // Decrementa ma non sotto zero
            } else if (e.keyCode != 13) { // New line
                charCounter++; // Incrementa il contatore per ogni altro tasto
            }
            // console.log(charCounter);
            if (charCounter == 39) {
                editor.execCommand('InsertLineBreak');
                charCounter = 1;
            }
        });
        editor.on('change', function () {
            editor.save();
            charCounter = 0;
        });
    },
    // Impostazione per mantenere i tag <br> e gli spazi non interrompibili
    force_br_newlines: true,  // Usa <br> per le nuove linee
    valid_elements: 'br[*],p[*],span[*],b,i,strong,em', // Consenti solo questi tag
    extended_valid_elements: 'span[class|style],br',  // Consenti tag aggiuntivi con attributi
    entity_encoding: 'raw' // Usa codifica RAW per mantenere &nbsp; e altri elementi speciali
});


$(document).ready(function () {
    // Gestisce l'aumento di semitoni
    $('#transpose-up').click(function () {
        transposeValue++;
        $('#transpose-value').text(transposeValue); // Aggiorna il valore visualizzato
        transpose(1); // Incrementa di 1 semitono
    });

    // Gestisce la diminuzione di semitoni
    $('#transpose-down').click(function () {
        transposeValue--;
        $('#transpose-value').text(transposeValue); // Aggiorna il valore visualizzato
        transpose(-1); // Decrementa di 1 semitono
    });

    $('#save-song').click(function () {
        let songHTML = tinymce.get('song-editor').getContent(); // Usa il contenuto HTML di TinyMCE per il salvataggio
        let category = $('#song-category').val(); // Ottiene la categoria selezionata

        // Estrae il titolo dal primo rigo del cantico
        let title = $('#titolo').val();
        let number = $('#numero').val();

        saveSong(songHTML, category, number, title);
    });

    function transpose(semitone) {
        let htmlContent = tinymce.get('song-editor').getContent(); // Ottieni il contenuto HTML dell'editor
        let transposedContent = transposeChords(htmlContent, semitone);
        tinymce.get('song-editor').setContent(transposedContent); // Aggiorna il contenuto di TinyMCE

        // Imposta la dimensione del testo a 14px per tutti gli elementi
        tinymce.activeEditor.dom.setStyles(tinymce.activeEditor.getBody(), { 'font-size': '14px' });

        // Colora di rosso gli accordi all'interno del testo
        tinymce.activeEditor.dom.select('span.chord').forEach(el => el.style.color = 'red');
    }

    function transposeChords(html, semitone) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        const elements = tempDiv.querySelectorAll('*');
        elements.forEach(el => {
            let text = el.innerHTML.trim(); // Usa innerHTML per preservare <br>

            const words = text.split('|');
            words.forEach(word => {
                if (containsChord(word.trim())) {
                    const transposedChord = transposeChord(word.trim(), semitone);
                    text = text.replace(`|${word.trim()}|`, `<span class="chord" style="color:red;">|${transposedChord}|</span>`);
                }
            });

            el.innerHTML = text; // Aggiorna il contenuto preservando i <br>
        });

        return tempDiv.innerHTML;
    }


    async function saveSong(songHTML, category, number, title) {
        try {
            // Controlla se esiste già un cantico con lo stesso numero o titolo
            const querySnapshot = await getDocs(collection(db, "culto"));
            let exists = false;
            let docId = null;
    
            querySnapshot.forEach((doc) => {
                if (doc.data().numero === number || doc.data().titolo === title) {
                    exists = true;
                    docId = doc.id;
                }
            });
    
            if (exists) {
                const confirmation = await Swal.fire({
                    title: 'Conferma richiesta',
                    text: `Esiste già un cantico con il numero ${number} o il titolo "${title}". Vuoi salvarne un altro comunque?`,
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Sì, conferma salvataggio duplicato',
                    cancelButtonText: 'Annulla'
                });
    
                if (!confirmation.isConfirmed) {
                    return;
                }
            }
    
            let docRef;
    
            // Procede con il salvataggio se non esiste o l'utente ha confermato
            if (exists && docId) {
                // Aggiorna il documento esistente
                docRef = doc(db, "culto", docId);
                await setDoc(docRef, {
                    numero: number,
                    titolo: title,
                    categoria: category,
                    html: songHTML,
                    transposeValue: 0,
                    UltimaModifica: serverTimestamp()
                }, { merge: true });
            } else {
                // Aggiungi un nuovo documento se non esiste
                docRef = await addDoc(collection(db, "culto"), {
                    numero: number,
                    titolo: title,
                    categoria: category,
                    html: songHTML,
                    transposeValue: 0,
                    dataInserimento: serverTimestamp()
                });
            }
    
            // Recupera il documento appena salvato per mostrare la data di inserimento
            const savedDoc = await getDoc(docRef);
            if (savedDoc.exists()) {
                const data = savedDoc.data();
                let dataInserimento = data.dataInserimento ? new Date(data.dataInserimento.toDate()).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : "Non disponibile";
                
                Swal.fire({
                    title: 'Salvato!',
                    html: `Cantico di ${category} aggiunto.<br>Data inserimento: ${dataInserimento}`,
                    icon: 'success',
                    timer: 2000,
                    timerProgressBar: true,
                    didClose: () => {
                        window.location.href = 'index.html';
                    }
                });
            }
        } catch (error) {
            Swal.fire('Errore!', `Non è stato possibile salvare questo cantico:\n\n${error.message}`, 'error');
        }
    }
});