import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getFirestore, collection, updateDoc, addDoc, doc, setDoc, getDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { containsChord, transposeChord } from './transposeUtils.js';

const idCliente = "POGGIOREALE";
let db;

try {
    // Ottieni il file di configurazione
    const response = await fetch('config.json');
    if (!response.ok) {
        throw new Error('Errore nel caricamento del file di configurazione');
    }

    // Converte la risposta in JSON
    const configurator = await response.json();
    const firebaseConfig = configurator['firebaseDB'];

    if (!firebaseConfig) {
        throw new Error("Errore: Firebase non è stato inizializzato correttamente. Verifica la tua configurazione.");
    }

    // Inizializza l'app Firebase
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
} catch (error) {
    console.error("Errore:", error);
}

// Funzione per caricare tutte le raccolte
async function loadAllCollections() {
    const clienteRef = doc(db, "Clienti", idCliente);
    const docSnap = await getDoc(clienteRef);
    const raccolte = [];

    if (docSnap.exists()) {
        const raccolteCliente = docSnap.data().raccolte;
        if (raccolteCliente) {
            raccolteCliente.forEach(function (raccolta) {
                raccolte.push(raccolta);
            });

            let $select = $("#song-collection");
            $.each(raccolte, function (index, raccolta) {
                $select.append(new Option(raccolta, raccolta));
            });
        }
    }

    $("#song-collection").on("change", function () {
        if ($(this).val() === "new") {
            Swal.fire({
                title: 'Aggiungi nuova raccolta',
                input: 'text',
                inputLabel: 'Nome nuova raccolta',
                inputPlaceholder: 'Inserisci il nome della nuova raccolta',
                showCancelButton: true,
                confirmButtonText: 'Aggiungi',
                cancelButtonText: 'Annulla',
                inputValidator: function (value) {
                    if (!value) return 'Devi inserire un nome per la raccolta!';
                }
            }).then(function (result) {
                if (result.isConfirmed) {
                    let nuovaRaccolta = result.value;
                    $('#song-collection').data('nuovaRaccolta', nuovaRaccolta);
                    $('#song-collection').append(new Option(nuovaRaccolta, nuovaRaccolta));
                    $('#song-collection').val(nuovaRaccolta);
                } else {
                    $("#song-collection").val("");
                }
            });
        }
    });
}

// Inizializza Tagify
async function initializeTagify() {
    const input = document.querySelector('#song-categories');
    const tagify = new Tagify(input);

    // Prepopola Tagify con le categorie preesistenti
    tagify.addTags();

    // Quando l'utente modifica le categorie
    tagify.on('add', onTagChange);
    tagify.on('remove', onTagChange);

    function onTagChange(e) {
        // Recupera l'array delle categorie aggiornate
        let categorie = tagify.value.map(tag => tag.value);
        window.categorie = categorie; // Aggiorna la variabile globale o fai ciò che serve
    }
}

// Valore di trasposizione corrente
let transposeValue = 0;

// Inizializza TinyMCE per l'editor di testo
tinymce.init({
    selector: "#song-editor",
    content_style: "body { min-height: 293px;}",
    menubar: false,
    plugins: 'lists preview',
    toolbar: 'undo redo | bold italic | forecolor | fontsize | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | link',
    setup: function (editor) {
        //Auto break-line
        editor.on('keydown', function (e) {
            if (e.keyCode === 13) {
                e.preventDefault(); // Prevent default behavior (inserting <p> tag)
                editor.execCommand('InsertLineBreak'); // Insert <br> tag instead
            }
        });
        // Evento per intercettare l'azione di incollamento
        editor.on('paste', function (e) {
            let clipboardData = e.clipboardData || e.originalEvent.clipboardData;
            let pastedData = clipboardData.getData('text/html'); // Recupera il contenuto incollato come HTML

            // Se il contenuto contiene <p>, sostituisci i <p> con <br><br>
            if (pastedData.includes('<p>')) {
                e.preventDefault(); // Previeni l'incollamento predefinito

                // Sostituisci ogni apertura <p> con <br><br> e chiusura </p> con una stringa vuota
                let newData = pastedData.replace(/<p[^>]*>/g, '<br><br>').replace(/<\/p>/g, '');

                // Incolla il nuovo contenuto manipolato
                editor.insertContent(newData);
            }
        });
    }
});

// Document ready
$(document).ready(async function () {
    // Carica tutte le raccolte solo se il database è stato inizializzato
    if (db) {
        await loadAllCollections();
        await initializeTagify();
    }

    // Gestisce l'aumento di semitoni
    $('#transpose-up').click(function () {
        transposeValue++;
        $('#transpose-value').text(transposeValue);
        transpose(1);
    });

    // Gestisce la diminuzione di semitoni
    $('#transpose-down').click(function () {
        transposeValue--;
        $('#transpose-value').text(transposeValue);
        transpose(-1);
    });

    $('#save-song').click(function () {
        let raccolta = $('#song-collection').val();

        //Estrai categorie
        let categoriesMap = $('#song-categories').val();
        let parsedCategories = JSON.parse(categoriesMap);
        let categories = parsedCategories.map(item => Object.values(item)[0]);

        let number = $('#numero').val();
        let title = $('#titolo').val();
        let songHTML = tinymce.get('song-editor').getContent();

        saveSong(raccolta, categories, number, title, songHTML);
    });

    function transpose(semitone) {
        let htmlContent = tinymce.get('song-editor').getContent();
        let transposedContent = transposeChords(htmlContent, semitone);
        tinymce.get('song-editor').setContent(transposedContent);

        tinymce.activeEditor.dom.setStyles(tinymce.activeEditor.getBody(), { 'font-size': '14px' });
        tinymce.activeEditor.dom.select('span.chord').forEach(el => el.style.color = 'red');
    }

    function transposeChords(html, semitone) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = html;

        const elements = tempDiv.querySelectorAll('*');
        elements.forEach(el => {
            let text = el.innerHTML.trim();
            const words = text.split('|');
            words.forEach(word => {
                if (containsChord(word.trim())) {
                    const transposedChord = transposeChord(word.trim(), semitone);
                    text = text.replace(`|${word.trim()}|`, `<span class="chord" style="color:red;">|${transposedChord}|</span>`);
                }
            });

            el.innerHTML = text;
        });

        return tempDiv.innerHTML;
    }

    async function saveSong(raccolta, categories, number, title, songHTML) {
        try {
            const clienteRef = doc(db, "Clienti", idCliente);
            const clienteDoc = await getDoc(clienteRef);
        
            if (clienteDoc.exists()) {
                const clienteData = clienteDoc.data();
                
                // Verifica se la raccolta è già presente
                const raccolte = clienteData.raccolte || [];
                if (!raccolte.includes(raccolta)) {
                    // Se la raccolta non esiste, aggiungila all'array
                    raccolte.push(raccolta);
                    await updateDoc(clienteRef, { raccolte });
                }
            }
        
            const snapRaccolta = collection(db, "Clienti", idCliente, raccolta);
            const snapCanzoni = await getDocs(snapRaccolta);
            let exists = false;
            let docId = null;
        
            snapCanzoni.forEach((doc) => {
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
        
            if (exists && docId) {
                await setDoc(doc(snapRaccolta, docId), {
                    numero: number,
                    titolo: title,
                    categorie: categories,
                    html: songHTML,
                    transposeValue: 0,
                    UltimaModifica: serverTimestamp()
                }, { merge: true });
            } else {
                docRef = await addDoc(snapRaccolta, {
                    numero: number,
                    titolo: title,
                    categorie: categories,
                    html: songHTML,
                    transposeValue: 0,
                    dataInserimento: serverTimestamp()
                });
            }
        
            const savedDoc = await getDoc(docRef);
            if (savedDoc.exists()) {
                const data = savedDoc.data();
                let dataInserimento = data.dataInserimento ? new Date(data.dataInserimento.toDate()).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' }) : "Non disponibile";
        
                Swal.fire({
                    title: 'Salvato!',
                    html: `Cantico di ${categories} aggiunto.<br>Data inserimento: ${dataInserimento}`,
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