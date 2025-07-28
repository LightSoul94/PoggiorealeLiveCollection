import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getFirestore, onSnapshot, collection, doc, updateDoc, getDocs, getDoc, setDoc, deleteField, deleteDoc, Timestamp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { containsChord, transposeChord } from '/js/transposeUtils.js';


const idCliente = "POGGIOREALE"
let db;

let isSyncActive = true;

window.toggleSync = async function () {
    isSyncActive = !isSyncActive;

    if (isSyncActive) {
        $("#syncIcon").attr("class", "bi bi-cloud ms-2");
        $("#syncText").text("Live Sync Attiva");
    } else {
        $("#syncIcon").attr("class", "bi bi-cloud-slash ms-2");
        $("#syncText").text("Live Sync Disattiva");
    }
}


async function initializeFirebase() {
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

        if (!firebaseConfig) {
            throw new Error("Errore: Firebase non è stato inizializzato correttamente. Verifica la tua configurazione.");
        }


        // Inizializza l'app Firebase
        const app = initializeApp(firebaseConfig);

        // Ottieni i servizi di autenticazione e Firestore
        db = getFirestore(app);

        // Carica i dati in tempo reale dopo il successo del login
        loadAllSongsInRealtime();

        // MAIN
        // Riferimento alla barra di ricerca della raccolta
        // Caricamento cliente
        const clienteRef = doc(db, "Clienti", idCliente);


        // Funzione per esportare in PDF la lista completa o solo i risultati della ricerca
        window.exportToPDF = function () {
            Swal.fire({
                title: 'Esportazione in corso...',
                html: 'Attendi mentre stiamo generando il PDF.',
                allowOutsideClick: false,
                didOpen: () => {
                    Swal.showLoading();
                }
            });

            generatePDF();
        }

        // Funzione per generare il PDF
        async function generatePDF() {
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF();

            let element = document.getElementById('songs-list');
            let $element = $(element);

            if (!element) {
                Swal.fire('Errore', 'Non è stato trovato nessun contenuto per generare il PDF.', 'error');
                return;
            }

            // Trova solo le canzoni visibili nella lista
            let songsArray = [];
            $element.find('.list-group-item:visible').each(function () {
                const categorie = $(this).attr('categorie') || "Generica";
                const titolo = $(this).attr('titolo') || "Senza Titolo";
                const numero = $(this).attr('numero') || "0";

                // Ottieni il contenuto della canzone e processa gli span
                const contenuto = $(this).find(`#song-content-${$(this).attr("id")} p`).map(function () {
                    let htmlContent = $(this).html();

                    // Sostituzione dei tag <br> con \n
                    htmlContent = htmlContent.replace(/<br\s*\/?>/gi, '\n');

                    // Sostituzione degli &nbsp; con spazio normale
                    htmlContent = htmlContent.replace(/&nbsp;/gi, ' ');

                    // Rimozione di tutti i tag <span> mantenendo il contenuto interno
                    htmlContent = htmlContent.replace(/<\/?span[^>]*>/gi, '');

                    // Sostituzione degli <strong> per grassetto con formattazione asterisco
                    htmlContent = htmlContent.replace(/<strong>(.*?)<\/strong>/gi, (_match, content) => {
                        return `*${content.trim()}*`; // Simula il grassetto con asterischi
                    });

                    return htmlContent.trim();
                }).get().join('\n');

                songsArray.push({ categorie, titolo, numero, contenuto });
            });

            let y = 20; // Coordinata per il contenuto

            // Prima aggiungiamo tutte le canzoni
            songsArray.forEach((song, index) => {
                if (index > 0) {
                    pdf.addPage(); // Aggiungi una nuova pagina per ogni canzone se non è la prima
                    y = 20; // Reimposta la coordinata y all'inizio della pagina
                }

                // Aggiungi il titolo della canzone con font più grande
                pdf.setFontSize(16); // Font più grande per il titolo
                pdf.setTextColor(0, 0, 0);
                pdf.text(`${song.numero}. ${song.titolo}`, 10, y);
                y += 15; // Aumenta lo spazio verticale dopo il titolo

                // Ripristina la dimensione del font per il contenuto della canzone
                pdf.setFontSize(12);

                // Suddividi il testo della canzone in righe per evitare di sovraccaricare la pagina
                const lines = song.contenuto.split('\n');

                lines.forEach(line => {
                    // Suddividi la linea in parti: accordi, grassetto e testo normale
                    const parts = line.split(/(\|.*?\||\*.*?\*)/); // Suddivide in base agli accordi racchiusi tra pipe o il testo in grassetto tra asterischi
                    let x = 10;

                    parts.forEach(part => {
                        if (part.startsWith('|') && part.endsWith('|')) {
                            // Se è un accordo (racchiuso tra le pipe), imposta il colore rosso e font normale
                            pdf.setTextColor(237, 0, 0); // Rosso
                            pdf.setFont("helvetica", "normal");
                        } else if (part.startsWith('*') && part.endsWith('*')) {
                            // Se è del testo in grassetto (racchiuso tra gli asterischi), imposta il font in grassetto
                            pdf.setTextColor(0, 0, 0); // Nero
                            pdf.setFont("helvetica", "bold");
                            part = part.replace(/\*/g, ''); // Rimuovi gli asterischi
                        } else {
                            // Altrimenti, imposta il colore nero e font normale
                            pdf.setTextColor(0, 0, 0); // Nero
                            pdf.setFont("helvetica", "normal");
                        }

                        pdf.text(part.trim(), x, y);
                        x += pdf.getTextWidth(part) + 2; // Avanza la posizione x per il testo successivo
                    });

                    y += 8; // Prossima riga
                    if (y > 280) {
                        pdf.addPage(); // Aggiungi una nuova pagina se necessario
                        y = 20;
                    }
                });

                y += 10; // Spazio tra una canzone e l'altra
            });

            // Inserisci una pagina per l'indice all'inizio
            pdf.insertPage(1);
            pdf.setPage(1);
            pdf.setFontSize(14);
            pdf.text('Indice', 10, 10);
            pdf.setFontSize(10);

            y = 20; // Reimposta la coordinata per l'indice

            // Creare l'indice basato sul contenuto delle canzoni
            let indice = {};
            songsArray.forEach(song => {
                if (!indice[song.categorie]) {
                    indice[song.categorie] = [];
                }
                indice[song.categorie].push(`${song.numero}. ${song.titolo}`);
            });

            // Aggiungi l'indice alla pagina inserita
            Object.keys(indice).forEach(categorie => {
                pdf.text(categorie, 10, y);
                y += 6;

                // Se la coordinata y supera un certo limite, aggiungi una nuova pagina per continuare l'indice
                if (y > 280) {
                    pdf.addPage();
                    y = 20; // Reimposta la coordinata y all'inizio della nuova pagina
                }

                indice[categorie].forEach(titolo => {
                    pdf.text(`- ${titolo}`, 20, y);
                    y += 6;

                    // Se la coordinata y supera il limite, aggiungi una nuova pagina per continuare
                    if (y > 280) {
                        pdf.addPage();
                        y = 20; // Reimposta la coordinata y all'inizio della nuova pagina
                    }
                });
            });


            // Salva il PDF finale
            pdf.save('raccolta_poggioreale.pdf');
            Swal.close(); // Chiude la finestra di caricamento
        }

        // Nascondi funzioni admin se non è autorizzato
        $(document).ready(async function () {
            // Recupera l'ultima query di ricerca da Firestore all'apertura della pagina
            await initializeSearchDocument();
        });


        // Intercetta evento per cancellazione raccolta
        $(document).ready(function () {
            let clickCounter = 0;
            let lastClickedText = "";

            $('#raccolte-btnGroup').on('click contextmenu', '.btn', async function (e) {
                e.preventDefault(); // Blocca anche il menu del tasto destro

                const $btn = $(this);
                const currentText = $btn.text().trim();

                // Verifica che il pulsante cliccato sia attivo
                if (!$btn.hasClass('active')) {
                    console.log(`Click su "${currentText}" → NON attivo → ignoro e resetto`);
                    clickCounter = 0;
                    lastClickedText = "";
                    return;
                }

                // Se è lo stesso testo dell'ultimo click
                if (currentText === lastClickedText) {
                    clickCounter++;
                    console.log(`Click ripetuto su "${currentText}": ${clickCounter} / 2`);

                    if (clickCounter >= 2) {
                        clickCounter = 0;
                        lastClickedText = "";

                        try {
                            await confermaEliminazioneRaccolta(currentText);
                        } catch (err) {
                            console.error("Errore nella conferma:", err);
                        }
                    }
                } else {
                    // Primo click su un nuovo testo attivo
                    console.log(`Nuovo click su "${currentText}" → resetto contatore`);
                    clickCounter = 1;
                    lastClickedText = currentText;
                }
            });

            // Richiesta conferma eliminazione raccolta selezionata
            async function confermaEliminazioneRaccolta(nomeRaccolta) {
                const result = await Swal.fire({
                    title: `Vuoi davvero eliminare la raccolta "${nomeRaccolta}"?`,
                    text: "Tutti i brani in questa raccolta saranno cancellati.",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonText: 'Sì, elimina',
                    cancelButtonText: 'Annulla'
                });

                if (!result.isConfirmed) return;

                try {
                    const clienteRef = doc(db, "Clienti", idCliente);
                    const raccoltaRef = collection(db, "Clienti", idCliente, nomeRaccolta);
                    const snapshot = await getDocs(raccoltaRef);

                    // Elimina ogni documento nella sottocollezione
                    const deletePromises = snapshot.docs.map((doc) => deleteDoc(doc.ref));
                    await Promise.all(deletePromises);

                    // Rimuovi la raccolta dal documento cliente
                    const clienteSnap = await getDoc(clienteRef);
                    if (clienteSnap.exists()) {
                        let raccolteList = clienteSnap.data().raccolte || [];
                        raccolteList = raccolteList.filter(r => r !== nomeRaccolta);

                        // Se la raccolta eliminata era quella selezionata, scegli la prima disponibile
                        let nuovaSelezione = raccolteList.length > 0 ? raccolteList[0] : "-";

                        await updateDoc(clienteRef, {
                            raccolte: raccolteList,
                            "settings.raccoltaSelezionata": nuovaSelezione
                        });
                    }

                    Swal.fire("Eliminata!", `La raccolta "${nomeRaccolta}" è stata eliminata.`, "success");

                } catch (err) {
                    console.error("Errore nella cancellazione della raccolta:", err);
                    Swal.fire("Errore", "Si è verificato un errore durante la cancellazione della raccolta.", "error");
                }
            }
        });


        //Pulisci motore di ricerca e aggiorna Firestore
        window.clearSearchBar = async function () {
            const selectedRaccolta = $("#raccolte-btnGroup .btn.active").text().trim().toLowerCase();
            $('#wordSearch').prop('checked', false);
            document.getElementById('search-bar').value = '';
            filterSongs('', selectedRaccolta);

            try {
                const isWordSearch = $('#wordSearch').prop('checked');

                // Recupera il documento del cliente
                const clienteRef = doc(db, "Clienti", idCliente);
                const docSnap = await getDoc(clienteRef);

                // Aggiorna Firestore con la nuova query di ricerca
                if (docSnap.exists()) {
                    // Estrai i dati del documento
                    const clienteData = docSnap.data();

                    // Verifica se esiste il campo settings
                    if (clienteData.settings) {
                        if (!isSyncActive) return;
                        // Svuota filtri di ricerca
                        await updateDoc(clienteRef, {
                            "settings.query": '',
                            "settings.flgWordSearch": isWordSearch
                        });
                    } else {
                        Swal.fire({ icon: 'error', title: 'Oops...', text: "Il campo settings non esiste nel documento cliente" });
                    }
                }
            } catch (error) {
                console.error('Errore durante l\'aggiornamento della ricerca su Firestore:', error);
            }
        }


        //Inizializza motore di ricerca
        $(document).ready(function () {
            try {
                // Ascolta gli eventi di input nella barra di ricerca
                $('#search-bar').on('input', async function () {
                    const searchQuery = $(this).val().toLowerCase();
                    const selectedRaccolta = $("#raccolte-btnGroup .btn.active").text().trim().toLowerCase();

                    // Applica il filtro ai brani localmente
                    filterSongs(searchQuery, selectedRaccolta);

                    // Aggiorna Firestore solo se la sincronizzazione è attiva
                    try {
                        const clienteRef = doc(db, "Clienti", idCliente);
                        const docSnap = await getDoc(clienteRef);

                        if (docSnap.exists()) {
                            const clienteData = docSnap.data();

                            if (clienteData.settings) {
                                if (!isSyncActive) return;
                                await updateDoc(clienteRef, {
                                    "settings.query": searchQuery
                                });
                            } else {
                                Swal.fire({ icon: 'error', title: 'Oops...', text: "Il campo settings non esiste nel documento cliente" });
                            }
                        }
                    } catch (error) {
                        console.error('Errore durante l\'aggiornamento della query su Firestore:', error);
                    }
                });

            }
            catch (error) {
                console.error('Errore durante il salvataggio dell\'ultima ricerca effettuata:', error);
            }

            // Event listener per la checkbox di ricerca per parole contenute
            $('#wordSearch').on('click', async function () {
                // Ottieni il valore attuale della barra di ricerca per filtrare in seguito i risultati nella pagina
                const searchQuery = $('#search-bar').val().toLowerCase();

                // Aggiorna Firestore con il nuovo stato dell'opzione di ricerca
                if (isSyncActive) {
                    try {
                        const isWordSearch = $('#wordSearch').prop('checked');

                        // Recupera il documento del cliente
                        const clienteRef = doc(db, "Clienti", idCliente);
                        const docSnap = await getDoc(clienteRef);

                        // Aggiorna Firestore con la nuova query di ricerca
                        if (docSnap.exists()) {
                            // Estrai i dati del documento
                            const clienteData = docSnap.data();

                            // Verifica se esiste il campo settings
                            if (clienteData.settings) {
                                // Aggiorna solo il flag di ricerca per parole all'interno della mappa settings
                                await updateDoc(clienteRef, {
                                    "settings.flgWordSearch": isWordSearch
                                });
                            } else {
                                Swal.fire({ icon: 'error', title: 'Oops...', text: "Il campo settings non esiste nel documento cliente" });
                            }
                        }
                    } catch (error) {
                        console.error('Errore durante l\'aggiornamento delle opzioni di ricerca su Firestore:', error);
                    }
                }

                // Richiama la funzione di filtro per riflettere il nuovo stato
                filterSongs(searchQuery);
            });
        });


        // Funzione per inizializzare il documento di ricerca su Firestore
        async function initializeSearchDocument() {
            const clienteRef = doc(db, "Clienti", idCliente);
            try {
                const docSnap = await getDoc(clienteRef);
                if (!docSnap.exists()) {
                    // Se il documento non esiste, crea un nuovo documento con una query vuota
                    await setDoc(clienteRef, { query: "", wordSearch: isWordSearchStatus });
                    Swal.fire({ icon: 'error', title: 'Oops...', text: "Documento di ricerca inizializzato su Firestore." });
                } else {
                    // Ottieni i dati del documento
                    const data = docSnap.data();
                    // Recupera e imposta l'ultima query di ricerca
                    const searchQuery = data.settings.query.toLowerCase();
                    $('#search-bar').val(searchQuery); // Imposta il valore della barra di ricerca

                    // Recupera lo stato del flag e imposta il checkbox
                    const isWordSearch = docSnap.data().wordSearchEnabled;
                    if (typeof isWordSearch !== 'undefined') {
                        $('#wordSearch').prop('checked', isWordSearch); // Imposta lo stato del checkbox
                    }

                    // Applica automaticamente il filtro di ricerca
                    filterSongs(searchQuery);
                }
            } catch (error) {
                console.error('Errore durante l\'inizializzazione del documento di ricerca:', error);
            }
        }


        // Variabile per tenere traccia della trasposizione corrente
        let transposeValues = {};

        async function loadAllSongsInRealtime() {
            const clienteRef = doc(db, "Clienti", idCliente);

            // Recupera i settings per determinare quale raccolta caricare
            const clienteSnap = await getDoc(clienteRef);
            if (!clienteSnap.exists()) {
                Swal.fire({ icon: 'error', title: 'Oops...', text: "Il documento cliente non esiste." });
                return;
            } else {
                const selectedRaccolta = clienteSnap.data().settings.raccoltaSelezionata;
                const searchQuery = clienteSnap.data().settings.query.toLowerCase();
                await loadCollectionSongs(selectedRaccolta);
                filterSongs(searchQuery, selectedRaccolta);
            }

            // Aggiorna il contenuto in tempo reale
            onSnapshot(clienteRef, (doc) => {
                const raccolte = doc.data().raccolte;
                const lastSelectedCollection = doc.data().settings.raccoltaSelezionata;
                let newButton;

                // Aggiorna pagina del cliente
                if (raccolte && raccolte.length > 0) {
                    $('#raccolte-btnGroup').empty();

                    // Scorri tutte le raccolte
                    raccolte.sort().forEach((nomeRaccolta) => {
                        const isActive = nomeRaccolta === lastSelectedCollection;
                        newButton = $('<button/>', {
                            type: 'button',
                            class: `btn btn-custom me-0 mb-0 ${isActive ? 'active' : ''}`,
                            text: nomeRaccolta,
                            click: async function () {
                                // Rimuovi la classe 'active' da tutti i pulsanti
                                $('#raccolte-btnGroup .btn').removeClass('active');
                                // Aggiungi la classe 'active' al pulsante cliccato
                                $(this).addClass('active');

                                // Aggiorna la raccolta selezionata nel database
                                await aggiornaRaccoltaSelezionata(nomeRaccolta);

                                // Aggiorna la visualizzazione delle canzoni alla raccolta corrente
                                await loadCollectionSongs(nomeRaccolta);
                            }
                        });

                        // Aggiungi il nuovo pulsante al gruppo esistente
                        $('#raccolte-btnGroup').append(newButton);
                    });
                } else {
                    Swal.fire({ icon: 'error', title: 'Oops...', text: "Nessuna raccolta trovata." });
                    return;
                }

            }, (error) => {
                Swal.fire('Errore!', 'Non è stato possibile caricare i brani: ' + error.message, 'error');
            });

            // Aggiorna le opzioni di ricerca in tempo reale
            onSnapshot(clienteRef, (doc) => {
                if (doc.exists()) {
                    const searchQuery = doc.data().settings.query.toLowerCase();
                    const isWordSearch = doc.data().settings.flgWordSearch;
                    const selectedRaccolta = doc.data().settings.raccoltaSelezionata;

                    // Imposta il valore del campo di ricerca e lo stato del checkbox
                    $('#search-bar').val(searchQuery);
                    $('#wordSearch').prop('checked', isWordSearch);
                    $(`#raccolte-btnGroup button`).filter(function () {
                        return $(this).text().trim() === selectedRaccolta;
                    }).addClass('active', '');
                    // Applica i filtri alle canzoni
                    filterSongs(searchQuery, selectedRaccolta.toLowerCase());
                } else {
                    Swal.fire({ icon: 'error', title: 'Oops...', text: "Il documento 'current_search' non esiste." });
                }
            });
        }





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

        // Funzione che aggiorna la visualizzazione delle canzoni
        async function loadCollectionSongs(nomeRaccolta) {
            // Recupera i brani dalla sottocollezione
            const raccoltaRef = collection(db, "Clienti", idCliente, nomeRaccolta);
            const querySnapshot = await getDocs(raccoltaRef);
            const songsArray = querySnapshot.docs.map(doc => ({
                id: doc.id,
                tempo: doc.data().tempo,
                bpm: doc.data().bpm,
                numero: doc.data().numero,
                titolo: doc.data().titolo,
                categorie: doc.data().categorie,
                html: doc.data().html,
                transposeValue: doc.data().transVal || 0,
                dataInserimento: doc.data().dataInserimento ? formatDate(doc.data().dataInserimento.toDate()) : '-',
                ultimaModifica: doc.data().ultimaModifica ? formatDate(doc.data().ultimaModifica.toDate()) : '-'
            }));

            // Ordina l'array in base al numero in ordine crescente, se popolato
            if (songsArray.length > 0) {
                songsArray.sort((a, b) => a.numero - b.numero);
            }

            // Crea l'HTML per la lista dei brani ordinati
            let songListHTML = "<ul class='list-group'>";
            songsArray.forEach((song) => {
                transposeValues[song.id] = song.transposeValue;

                songListHTML += `
            <li class='list-group-item mb-2 p-0' id="${song.id}" categorie="${song.categorie}" tempo="${song.tempo ?? 'Seleziona il tempo'}" bpm="${song.bpm ?? ''}" titolo="${song.titolo}" numero="${song.numero}" dataInserimento="${song.dataInserimento}" ultimaModifica="${song.ultimaModifica}" raccolta="${nomeRaccolta}">
            
                <div class="d-flex align-items-center mb-3 p-2 border rounded bg-light" id="song-tempo-${song.id}" style="color: red;">
                    <span class="me-4 fs-4 fw-bold color-red">
                        <strong>Tempo: ${song.tempo ?? '-'} | BPM: ${song.bpm ?? '-'}</strong>
                    </span>
                </div>
            
                <div class="d-flex flex-row" id="div-title-${song.id}">
                    <h5 id="title-${song.id}" class="mb-4">
                        ${song.numero}. ${song.titolo}
                    </h5>
                </div>
                
                <div class="d-flex flex-row">
                    <div class="col-9 p-1" id="song-content-${song.id}">
                        ${song.html}
                    </div>
                    <div class="col-3 p-1 admin" id="editSection-${song.id}" style="display:none">
                        <button id="edit-button-${song.id}" class="btn btn-outline-secondary m-0 p-1 col-12 justify-content-center" style="height: 70px;" onclick="editSong('${song.id}')">
                            <i class="fa fa-pencil" aria-hidden="true"></i> Modifica
                        </button>
    
                        <div class="mt-5" id="transposer-${song.id}">
                            <button class="btn btn-outline-secondary m-0 p-3 col-12" onclick="transposeUp2('${song.id}')">
                            +2
                            </button>
                            <button class="btn btn-outline-secondary m-0 p-3 col-12" onclick="transposeUp('${song.id}')">
                            +1
                            </button>
                            <div class="text-center mt-4 mb-4">
                                <span id="transpose-value-${song.id}">${song.transposeValue}</span>
                            </div>
                            <button class="btn btn-outline-secondary m-0 p-3 col-12" onclick="transposeDown('${song.id}')">
                            -1
                            </button>
                            <button class="btn btn-outline-secondary m-0 p-3 col-12" onclick="transposeDown2('${song.id}')">
                            -2
                            </button>
                        </div>
                    </div>
                </div>
            </li>`;
            });
            songListHTML += "</ul>";

            $('#songs-list').html(songListHTML);

            // Aggiungi un listener su ciascun documento della raccolta se la sync è attiva
            if (isSyncActive) {
                querySnapshot.forEach((songDoc) => {
                    const songRef = doc(raccoltaRef, songDoc.id);
                    onSnapshot(songRef, (doc) => {
                        if (doc.exists()) {
                            const updatedData = doc.data();
                            const songHTML = updatedData.html;
                            const songId = doc.id;
                            // const songNumber = updatedData.numero ? updatedData.numero : 'Senza Numero';
                            // const songTitle = updatedData.titolo ? updatedData.titolo : 'Senza Titolo';


                            // Aggiorna il contenuto del brano nell’interfaccia
                            $(`#song-content-${songId}`).html(songHTML);


                            // Aggiorna eventuali altre informazioni come ultima modifica, trasposizione, ecc.
                            const lastEditDate = updatedData.ultimaModifica
                                ? updatedData.ultimaModifica.toDate().toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
                                : '-';

                            $(`#lastEditLabel-${songId}`).text(`Ultima modifica: ${lastEditDate}`);

                            $(`#transpose-value-${songId}`).text(updatedData.transVal || 0);
                        } else {
                            // Rimuovi il brano dall’interfaccia se non esiste più
                            $(`#${songDoc.id}`).remove();
                        }
                    });
                });
            }

            const adminCookie = getCookie("isAdmin");
            if (adminCookie === "1") {
                $('.admin').show();
                $('#open-auth').hide();
            } else {
                // Nascondi inizialmente gli elementi di amministrazione
                $('.admin').hide();
            }


        }

        // Aggiorna Firestore con la raccolta selezionata
        async function aggiornaRaccoltaSelezionata(nomeRaccolta) {
            if (isSyncActive) {
                const clienteRef = doc(db, "Clienti", idCliente);
                const docSnap = await getDoc(clienteRef);

                // Aggiorna Firestore con la nuova query di ricerca
                if (docSnap.exists()) {
                    // Estrai i dati del documento
                    const clienteData = docSnap.data();

                    // Verifica se esiste il campo settings
                    if (clienteData.settings) {
                        // Svuota filtri di ricerca
                        await updateDoc(clienteRef, {
                            'settings.raccoltaSelezionata': nomeRaccolta
                        }).catch((error) => {
                            console.error('Errore nell\'aggiornamento della raccolta selezionata:', error);
                        });
                    } else {
                        Swal.fire({ icon: 'error', title: 'Oops...', text: "Il campo settings non esiste nel documento cliente" });
                    }
                }
            }
        }

        // Funzione per gestire l'aumento di toni
        window.transposeUp2 = function (songId) {
            const currentSearchQuery = $('#search-bar').val().toLowerCase(); // Memorizza il valore di ricerca corrente
            transposeValues[songId] += 2; // Incrementa il valore di trasposizione per il brano specifico
            $('#transpose-value-' + songId).text(transposeValues[songId]); // Aggiorna la label visualizzata
            transpose(songId, 2); // Trasponi di 1 semitono per il brano specifico
            updateSongInFirestore(songId, currentSearchQuery); // Passa il valore di ricerca corrente
        };
        // Funzione per gestire l'incremento di semitoni
        window.transposeUp = function (songId) {
            const currentSearchQuery = $('#search-bar').val().toLowerCase(); // Memorizza il valore di ricerca corrente
            transposeValues[songId]++; // Incrementa il valore di trasposizione per il brano specifico
            $('#transpose-value-' + songId).text(transposeValues[songId]); // Aggiorna la label visualizzata
            transpose(songId, 1); // Trasponi di 1 semitono per il brano specifico
            updateSongInFirestore(songId, currentSearchQuery); // Passa il valore di ricerca corrente
        };

        // Funzione per gestire l'aumento di semitoni
        window.transposeDown = function (songId) {
            const currentSearchQuery = $('#search-bar').val().toLowerCase(); // Memorizza il valore di ricerca corrente
            transposeValues[songId]--; // Decrementa il valore di trasposizione per il brano specifico
            $('#transpose-value-' + songId).text(transposeValues[songId]); // Aggiorna la label visualizzata
            transpose(songId, -1); // Trasponi di -1 semitono per il brano specifico
            updateSongInFirestore(songId, currentSearchQuery); // Passa il valore di ricerca corrente
        };
        // Funzione per gestire la diminuzione di toni
        window.transposeDown2 = function (songId) {
            const currentSearchQuery = $('#search-bar').val().toLowerCase(); // Memorizza il valore di ricerca corrente
            transposeValues[songId] -= 2; // Decrementa il valore di trasposizione per il brano specifico
            $('#transpose-value-' + songId).text(transposeValues[songId]); // Aggiorna la label visualizzata
            transpose(songId, -2); // Trasponi di -2 semitoni per il brano specifico
            updateSongInFirestore(songId, currentSearchQuery); // Passa il valore di ricerca corrente
        };

        // Funzione per trasporre solo le note del brano con l'ID specifico
        function transpose(songId, semitone) {
            const songContentDiv = $(`#song-content-${songId}`);
            let htmlContent = songContentDiv.html(); // Ottieni il contenuto HTML del brano
            let transposedContent = transposeChords(htmlContent, semitone);
            songContentDiv.html(transposedContent); // Aggiorna il contenuto del brano

            // Colora di rosso tutti gli accordi nel testo
            songContentDiv.find('span.chord').css('color', 'red');
        }

        // Funzione per aggiornare il documento su Firestore
        async function updateSongInFirestore(songId, currentSearchQuery) {
            const songContentDiv = $(`#song-content-${songId}`);
            const updatedContent = songContentDiv.html();
            // const titoloBrano = $(`#${songId}`).attr("titolo");
            const raccoltaSelezionata = $(`#${songId}`).attr("raccolta");
            const currentDate = new Date();

            if (isSyncActive) {
                try {
                    const clienteRef = doc(db, "Clienti", idCliente);
                    const raccoltaRef = collection(clienteRef, raccoltaSelezionata);
                    const songDocRef = doc(raccoltaRef, songId);

                    const docSnap = await getDoc(songDocRef);

                    // Aggiorna Firestore con la nuova query di ricerca
                    if (docSnap.exists()) {
                        // Estrai il valore di trasposizione
                        const transpositionValue = $(`#transpose-value-${songId}`).text();

                        // Aggiorna il documento specifico della canzone nella sottocollezione
                        await updateDoc(songDocRef, {
                            // titolo: titoloBrano,
                            html: updatedContent,
                            transVal: transpositionValue,
                            ultimaModifica: Timestamp.fromDate(currentDate)
                        });
                    } else {
                        Swal.fire({ icon: 'error', title: 'Oops...', text: "Non è stato trovato questo brano" });
                    }

                    // Applica nuovamente il filtro di ricerca con il valore corrente
                    filterSongs(currentSearchQuery);

                } catch (error) {
                    console.error('Errore durante l\'aggiornamento su Firestore:', error);
                    Swal.fire('Errore!', 'Non è stato possibile aggiornare il brano su Firestore: ' + error.message, 'error');
                }
            }
        }

        // Funzione per filtrare i brani in base alla ricerca corrente
        function filterSongs(searchQuery, selectedRaccolta) {
            $('.list-group-item').each(function () {
                const numero = $(this).attr('numero') ? $(this).attr('numero').toLowerCase() : '';
                const titolo = $(this).attr('titolo') ? $(this).attr('titolo').toLowerCase() : '';
                const categorie = $(this).attr('categorie') ? $(this).attr('categorie').toLowerCase() : '';
                const raccolta = $(this).attr('raccolta') ? $(this).attr('raccolta').toLowerCase() : '';

                // Include il contenuto testuale di tutta la canzone
                const isWordSearch = $('#wordSearch').is(':checked');
                const parole = $(this).text().toLowerCase();

                // Mostra solo le canzoni che appartengono alla raccolta selezionata
                if (selectedRaccolta) {

                    if (selectedRaccolta !== raccolta) {
                        $(this).hide();
                        return; // Non proseguire se la raccolta non corrisponde
                    }

                    // Se è abilitata la ricerca per parole e la ricerca coincide
                    if (isWordSearch && parole.includes(searchQuery.toLowerCase())) {
                        $(this).show();
                    } else if (`${numero}. ${titolo}`.includes(searchQuery.toLowerCase()) || titolo.includes(searchQuery.toLowerCase()) || categorie.includes(searchQuery.toLowerCase())) {
                        // Altrimenti effettua ricerca classica per numero/titolo/categorie
                        $(this).show();
                    } else {
                        $(this).hide();
                    }
                }
            });
        }



        function transposeChords(html, semitone) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = html;

            // Seleziona titolo e escludilo dalla query
            const headers = tempDiv.querySelectorAll('h5');
            headers.forEach(header => header.remove());

            // Seleziona tutti gli altri elementi
            const elements = tempDiv.querySelectorAll('*');

            elements.forEach(el => {
                // Usa replace con una funzione di callback per trasporre solo gli accordi
                el.innerHTML = el.innerHTML.replace(/\|([^|]+)\|/g, (match, chordText) => {
                    const chord = chordText.trim();
                    if (containsChord(chord)) {
                        // Trasponi l'accordo e mantieni le barre, racchiudendo in uno span con classe 'chord'
                        const transposedChord = transposeChord(chord, semitone);
                        return `<span class="chord" style="color: red;">|${transposedChord}|</span>`;
                    }
                    // Se non è un accordo valido, mantieni l'originale
                    return match;
                });
            });

            return tempDiv.innerHTML;
        }



        // Funzione per modificare il brano selezionato
        window.editSong = async function (songId) {
            const songElement = $(`#${songId}`);
            const raccoltaSelezionata = songElement.attr("raccolta");
            const tempo = $(`#${songId}`).attr("tempo");
            const bpm = songElement.attr("bpm") || '';
            const interoTitolo = $(`#title-${songId}`).text().trim();
            const dataInserimento = songElement.attr("dataInserimento") ?? '-';
            const lastEdit = songElement.attr("ultimamodifica") ?? '-';
            const transpositionValue = $(`#transpose-value-${songId}`).text();

            // Splitta il titolo in numero e testo
            const [numero, titolo] = interoTitolo.split('. ', 2);

            // Adatta larghezza
            $(`#song-content-${songId}`).removeClass('col-9').addClass('col-12');

            // Nascondi sezioni non necessarie
            $('#exportSongs').hide();
            $('.admin').hide();

            // Rimuovi TinyMCE se già inizializzato
            if (tinymce.get(`edit-textarea-${songId}`)) {
                tinymce.get(`edit-textarea-${songId}`).remove();
            }

            // Sostituisci contenuto con il form
            const songContentDiv = $(`#song-content-${songId}`);
            songContentDiv.html(`
                <div class="col-12 p-0">
                    <div class="form-group">
                        <div class="d-flex justify-content-end mb-3">
                            <button class="btn btn-outline-danger" onclick="deleteSong('${songId}')">Elimina</button>
                        </div>
                        <div class="form-group mb-3">
                            <label for="song-collection">Seleziona una raccolta:</label>
                            <select id="song-collection" class="form-control">
                                <option value="" selected disabled>Seleziona una raccolta</option>
                                <option value="new">Crea nuova raccolta</option>
                            </select>
                        </div>
                        <div class="form-group mb-3">
                            <label for="song-category">Categorie:</label>
                            <input type="text" id="song-category" class="form-control" placeholder="Inserisci le categorie separandole con la virgola o con tab">
                        </div>
                    </div>
                    <div class="d-flex mb-3">
                        <div class="form-group me-3">
                            <label for="song-tempo-${songId}">Tempo:</label>
                            <select id="song-tempo-${songId}" class="form-control">
                                <option value="">Seleziona il tempo</option>
                                <option value="2/4">2/4</option>
                                <option value="3/4">3/4</option>
                                <option value="4/4">4/4</option>
                                <option value="6/8">6/8</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="bpm-${songId}">BPM:</label>
                            <input id="bpm-${songId}" class="form-control" type="number" min="40" max="300" placeholder="Inserisci BPM" value="${bpm}">
                        </div>
                    </div>
                    <div class="d-flex mb-3">
                        <div class="form-group me-3">
                            <input id="numero-${songId}" class="form-control" type="number" min="1" placeholder="N." value="${numero}">
                        </div>
                        <div class="form-group flex-grow-1">
                            <input id="titolo-${songId}" class="form-control" type="text" placeholder="Titolo" value="${titolo}">
                        </div>
                    </div>
                    <textarea id="edit-textarea-${songId}" transVal="${transpositionValue}" class="form-control" rows="5" style="height: 500px;">${songContentDiv.html()}</textarea>
                    <div class="d-flex justify-content-end mt-3">
                        <button class="btn btn-success me-2" onclick="saveSong('${songId}')">Salva</button>
                        <button class="btn btn-secondary" onclick="cancelEdit('${songId}')">Annulla</button>
                    </div>
                    <div class="mt-3">
                        <small class="text-muted">Data inserimento: ${dataInserimento}</small><br>
                        <small class="text-muted">Ultima modifica: ${lastEdit}</small>
                    </div>
                </div>
            `);

            // Carica tutte le raccolte e inizializza
            await loadAllCollections();
            $("#song-collection").val(raccoltaSelezionata);

            // Aggiunge l'attributo 'selected' all'opzione con valore '3/4'
            $(`#song-tempo-${songId} option[value="${tempo}"]`).attr('selected', 'selected');

            // Inizializza Tagify per le categorie
            initializeTagify(songId);

            // Inizializza TinyMCE
            tinymce.init({
                selector: `#edit-textarea-${songId}`,
                menubar: false,
                plugins: 'lists preview',
                toolbar: 'undo redo | bold italic | forecolor | fontsize | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | link',
                setup: function (editor) {
                    editor.on('keydown', function (e) {
                        if (e.keyCode === 13) {
                            e.preventDefault();
                            editor.execCommand('InsertLineBreak');
                        }
                    });
                    editor.on('paste', function (e) {
                        let clipboardData = e.clipboardData || e.originalEvent.clipboardData;
                        let pastedData = clipboardData.getData('text/html');
                        if (pastedData.includes('<p>')) {
                            e.preventDefault();
                            let newData = pastedData.replace(/<p[^>]*>/g, '<br><br>').replace(/<\/p>/g, '');
                            editor.insertContent(newData);
                        }
                    });
                }
            });

            $(`#div-title-${songId}`).remove();
            $(`#song-tempo-${songId}`).remove();
        };


        // Funzione per annullare la modifica
        window.cancelEdit = async function () {
            $('#exportSongs').show();
            try {
                await loadAllSongsInRealtime();
            } catch (error) {
                Swal.fire('Errore!', 'Errore durante il recupero del brano: ' + error.message, 'error');
            }
        };

        window.saveSong = async function (songId) {
            let raccoltaSelezionata = $('#song-collection').val();
            let raccoltaPrecedente = $(`#${songId}`).attr('raccolta');
            let categorie = [];
            $('.tagify__tag-text').each(function () {
                categorie.push($(this).text());
            });
            let tempo = $(`#song-tempo-${songId}`).val();
            let bpm = parseInt($(`#bpm-${songId}`).val(), 10);
            let transVal = parseInt($(`#edit-textarea-${songId}`).attr('transVal'));
            let number = parseInt($(`#numero-${songId}`).val(), 10);
            let title = $(`#titolo-${songId}`).val();
            let songHTML = tinymce.get(`edit-textarea-${songId}`).getContent();

            if (!songHTML.trim() || !title.trim() || (!tempo && tempo != "Seleziona il tempo") || !bpm || !number || categorie.length === 0 || !raccoltaSelezionata) {
                Swal.fire({
                    icon: 'warning',
                    title: 'Attenzione',
                    text: 'Tutti i campi devono essere compilati prima di salvare il brano!'
                });
                return;
            }

            try {
                const clienteRef = doc(db, "Clienti", idCliente);
                const currentDate = new Date();

                // Riferimento alla nuova sottocollezione con il nome della raccolta selezionata
                const nuovaRaccoltaRef = collection(clienteRef, raccoltaSelezionata);
                const songDocRef = doc(nuovaRaccoltaRef, songId);

                // Riferimento alla raccolta precedente (se esiste e diversa dalla selezionata)
                if (raccoltaPrecedente && raccoltaPrecedente !== raccoltaSelezionata) {
                    const raccoltaPrecedenteRef = doc(clienteRef, `${raccoltaPrecedente}`, songId);
                    await deleteDoc(raccoltaPrecedenteRef);

                    // Verifica se la raccolta precedente è ora vuota e la rimuove
                    const raccoltaPrecedenteColRef = collection(clienteRef, raccoltaPrecedente);
                    const snapshot = await getDocs(raccoltaPrecedenteColRef);
                    if (snapshot.empty) {
                        await deleteDoc(doc(clienteRef, raccoltaPrecedente));
                    }
                }

                // Recupera la data di inserimento della canzone esistente nella raccolta selezionata
                const songSnap = await getDoc(songDocRef);
                const dataInserimento = songSnap.exists() ? songSnap.data().dataInserimento : Timestamp.fromDate(currentDate);

                // Aggiungi o aggiorna la canzone nella sottocollezione
                await setDoc(songDocRef, {
                    tempo: tempo,
                    bpm: bpm,
                    numero: number,
                    titolo: title,
                    html: songHTML,
                    transVal: transVal,
                    ultimaModifica: Timestamp.fromDate(currentDate),
                    categorie: categorie,
                    dataInserimento: dataInserimento
                });

                // Aggiorna la raccolta selezionata in settings.raccoltaSelezionata
                await updateDoc(clienteRef, {
                    "settings.raccoltaSelezionata": raccoltaSelezionata
                });

                // Aggiorna la data di ultima modifica nell'interfaccia
                $(`#lastEditLabel-${songId}`).text(`Ultima modifica: ${currentDate.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}`);

                // Ricarica la schermata attuale
                $('#exportSongs').show();
                try {
                    await loadAllSongsInRealtime();
                } catch (error) {
                    Swal.fire('Errore!', 'Errore durante il recupero del brano: ' + error.message, 'error');
                }

            } catch (error) {
                console.error("Errore durante il salvataggio del brano:", error);
                Swal.fire({
                    icon: 'error',
                    title: 'Errore',
                    text: 'Si è verificato un errore durante il salvataggio del brano.'
                });
            }
        };





        // Funzione per eliminazione
        window.deleteSong = async function (songId) {
            try {
                const raccoltaSelezionata = $(`#${songId}`).attr("raccolta"); // Ottieni la raccolta selezionata dall'attributo

                // Chiedi conferma all'utente prima di procedere
                const result = await Swal.fire({
                    title: 'Sei sicuro?',
                    text: "Questa operazione non può essere annullata!",
                    icon: 'warning',
                    showCancelButton: true,
                    confirmButtonColor: '#3085d6',
                    cancelButtonColor: '#d33',
                    confirmButtonText: 'Sì, elimina!',
                    cancelButtonText: 'Annulla'
                });

                if (result.isConfirmed) {
                    const raccoltaRef = collection(db, "Clienti", idCliente, raccoltaSelezionata);
                    const docSnap = await getDocs(raccoltaRef);

                    if (!docSnap.empty) {
                        // Elimina la canzone o la raccolta
                        await deleteDoc(doc(raccoltaRef, songId));

                        // Verifica se la raccolta è vuota
                        const updatedDocSnap = await getDocs(raccoltaRef);

                        if (updatedDocSnap.empty) {
                            // Se la raccolta è vuota, elimina la raccolta o aggiorna il documento cliente come desiderato
                            let snapCliente = await getDoc(doc(db, "Clienti", idCliente));
                            let raccolteData = snapCliente.data();


                            let raccolteList = raccolteData.raccolte;
                            raccolteList = raccolteList.filter(item => item !== raccoltaSelezionata);


                            await updateDoc(clienteRef, {
                                "raccolte": raccolteList,
                                "settings.raccoltaSelezionata": raccolteList[0]
                            });


                            Swal.fire({ icon: 'info', title: 'Raccolta vuota', text: 'La raccolta è stata eliminata poiché vuota.' });
                        }
                    } else {
                        Swal.fire({ icon: 'error', title: 'Errore', text: 'Raccolta non trovata.' });
                    }

                    // Torna alla vista normale
                    window.cancelEdit();
                } else {
                    Swal.fire({ icon: 'error', title: 'Errore', text: 'Brano non trovato.' });
                }

            }
            catch (error) {
                console.error("Errore durante l'eliminazione del brano:", error);
                Swal.fire(
                    'Errore',
                    'Si è verificato un errore durante l\'eliminazione del brano.',
                    'error'
                );
            }
        }


        // Apri indice raccolta
        $('#open-index').click(async function () {
            try {
                const clienteRef = doc(db, "Clienti", idCliente);
                const clienteSnap = await getDoc(clienteRef);

                if (!clienteSnap.exists()) {
                    Swal.fire({ icon: 'error', title: 'Oops...', text: "Il documento cliente non esiste." });
                    return;
                }

                const clienteData = clienteSnap.data();
                const raccolte = clienteData.raccolte;
                const raccoltaSelezionata = clienteData.settings?.raccoltaSelezionata;
                let indice = {};

                // Verifica che raccolte e raccoltaSelezionata esistano e siano definiti
                if (raccolte && raccoltaSelezionata) {
                    // Recupera i documenti della raccolta selezionata
                    const raccoltaRef = collection(db, "Clienti", idCliente, raccoltaSelezionata);
                    const querySnapshot = await getDocs(raccoltaRef);

                    if (!querySnapshot.empty) {
                        querySnapshot.forEach((doc) => {
                            const canzone = doc.data();
                            const categorieCanzone = canzone.categorie || ["Generica"];
                            const titolo = canzone.titolo || "Senza Titolo";
                            const numero = canzone.numero ? `${canzone.numero}. ` : '';

                            categorieCanzone.forEach((categoria) => {
                                // Se la categoria non esiste nell'indice, la crea
                                if (!indice[categoria]) {
                                    indice[categoria] = [];
                                }

                                // Aggiunge un oggetto con titolo e numero per ogni categoria
                                indice[categoria].push({ titolo, numero });
                            });
                        });
                    } else {
                        Swal.fire({ icon: 'error', title: 'Oops...', text: "La raccolta selezionata non contiene brani." });
                    }
                } else {
                    Swal.fire({ icon: 'error', title: 'Oops...', text: "Nessuna raccolta trovata o raccolta selezionata non definita." });
                    return;
                }

                // Ordina i titoli all'interno di ogni categoria
                Object.keys(indice).forEach(categoria => {
                    indice[categoria].sort((a, b) => a.titolo.localeCompare(b.titolo));
                });

                // Funzione per creare l'HTML dell'indice con la funzionalità di collassamento/espansione
                const creaIndiceHTML = (indice) => {
                    let html = `<div class="text-start">`;
                    Object.keys(indice).forEach(categoria => {
                        html += `
                            <div class="categoria-item">
                                <button class="btn btn-link toggle-categoria" data-categoria="${categoria}" style="text-decoration:none;">
                                    <strong>${categoria}</strong>
                                </button>
                                <ul id="categoria-list-${categoria}" style="display:none;">`;

                        indice[categoria].forEach(canzone => {
                            html += `<li><a href="#" class="indice-titolo" data-titolo="${canzone.titolo}" data-numero="${canzone.numero}">${canzone.numero}${canzone.titolo}</a></li>`;
                        });

                        html += `</ul></div>`;
                    });
                    html += `</div>`;
                    return html;
                };

                // Crea l'HTML iniziale dell'indice
                let indiceHTML = `
                    <div class="btn-group mb-3" role="group" aria-label="Segmented button per ordinare">
                        <button type="button" class="btn btn-outline-primary m-0 active" id="btn-per-categorie">Per categorie</button>
                        <button type="button" class="btn btn-outline-primary m-0" id="btn-ordine-numerico">Ordine Numerico</button>
                        <button type="button" class="btn btn-outline-primary m-0" id="btn-ordine-alfabetico">Ordine Alfabetico</button>
                    </div>
                    <div id="indice-contenuto">
                        ${creaIndiceHTML(indice)}
                    </div>
                `;

                // Mostra l'indice con Swal
                Swal.fire({
                    title: 'Indice della Raccolta',
                    html: indiceHTML,
                    width: '600px',
                    showConfirmButton: false,
                    showCloseButton: true
                });

                // Rimuovi gli eventi click precedenti per evitare sovrapposizioni
                $(document).off('click', '.toggle-categoria');

                // Aggiungi gestore di eventi per espandere/collassare le categorie
                $(document).on('click', '.toggle-categoria', function () {
                    const categoria = $(this).data('categoria');
                    $(`#categoria-list-${categoria}`).slideToggle();  // Collassa/espandi la categoria
                });

                // Aggiungi gestore di eventi per i titoli cliccabili
                $(document).off('click', '.indice-titolo').on('click', '.indice-titolo', function (e) {
                    e.preventDefault();
                    const titoloSelezionato = `${$(this).data('numero')}${$(this).data('titolo')}`;
                    $('#search-bar').val(titoloSelezionato).trigger('input');
                    Swal.close();
                });

                // Gestore eventi per ordinamento
                $(document).off('click', '.btn-group .btn').on('click', '.btn-group .btn', function () {
                    $('#btn-per-categorie').removeClass('active');
                    $('#btn-ordine-numerico').removeClass('active');
                    $('#btn-ordine-alfabetico').removeClass('active');
                    $(this).addClass('active');

                    const selectedButtonId = $(this).attr('id');

                    if (selectedButtonId === 'btn-per-categorie') {
                        $('#sort-toggle').remove();
                        $('#btn-ordinamento-numerico').remove();
                        $('#btn-ordinamento-alfabetico').remove();
                        $('#indice-contenuto').html(creaIndiceHTML(indice));
                        $('#sort-alpha-toggle').remove();
                    } else if (selectedButtonId === 'btn-ordine-numerico') {
                        $('#sort-alpha-toggle').remove();

                        // Ordina numericamente
                        const indiceNumerico = [];
                        Object.keys(indice).forEach(categoria => {
                            indice[categoria].forEach(canzone => {
                                indiceNumerico.push({ categoria, ...canzone });
                            });
                        });

                        // Ordina i cantici in base al numero in modo crescente di default
                        indiceNumerico.sort((a, b) => parseInt(a.numero) - parseInt(b.numero));
                        let htmlNumerico = '<div class="text-start"><ul>';
                        indiceNumerico.forEach(canzone => {
                            htmlNumerico += `<li><a href="#" class="indice-titolo" data-titolo="${canzone.titolo}" data-numero="${canzone.numero}">${canzone.numero}${canzone.titolo}</a></li>`;
                        });
                        htmlNumerico += '</ul></div>';
                        $('#indice-contenuto').html(htmlNumerico);

                        // Aggiungi il pulsante per l'ordinamento crescente/decrescente
                        if (!$('#sort-toggle').length) {
                            $('#indice-contenuto').before('<div><button id="sort-toggle" class="btn btn-secondary mb-2">Ordina Crescente <i class="fas fa-sort-numeric-down"></i></button></div>');
                        }

                        // Gestione del click sul pulsante di ordinamento crescente/decrescente
                        $('#sort-toggle').off('click').on('click', function () {
                            const isAscending = $(this).find('i').hasClass('fa-sort-numeric-down');
                            indiceNumerico.sort((a, b) => isAscending ? parseInt(b.numero) - parseInt(a.numero) : parseInt(a.numero) - parseInt(b.numero));

                            // Cambia l'icona in base all'ordinamento
                            $(this).html(isAscending ? 'Ordina Decrescente <i class="fas fa-sort-numeric-up"></i>' : 'Ordina Crescente <i class="fas fa-sort-numeric-down"></i>');

                            // Rigenera l'HTML con l'ordinamento applicato
                            let htmlNumerico = '<div class="text-start"><ul>';
                            indiceNumerico.forEach(canzone => {
                                htmlNumerico += `<li><a href="#" class="indice-titolo" data-titolo="${canzone.titolo}" data-numero="${canzone.numero}">${canzone.numero}${canzone.titolo}</a></li>`;
                            });
                            htmlNumerico += '</ul></div>';
                            $('#indice-contenuto').html(htmlNumerico);
                        });

                    } else if (selectedButtonId === 'btn-ordine-alfabetico') {
                        $('#sort-toggle').remove();
                        $('#sort-alpha-toggle').remove();

                        // Ordina dalla A-Z
                        const indiceAlfabetico = [];
                        Object.keys(indice).forEach(categoria => {
                            indice[categoria].forEach(canzone => {
                                indiceAlfabetico.push({ categoria, ...canzone });
                            });
                        });

                        // Ordina i cantici in base al titolo in modo crescente di default
                        indiceAlfabetico.sort((a, b) => {
                            const titoloA = a.titolo.toLowerCase();
                            const titoloB = b.titolo.toLowerCase();

                            return titoloA < titoloB ? -1 : titoloA > titoloB ? 1 : 0;
                        });

                        let htmlAlfabetico = '<div class="text-start"><ul>';
                        indiceAlfabetico.forEach(canzone => {
                            htmlAlfabetico += `<li><a href="#" class="indice-titolo" data-titolo="${canzone.titolo}" data-numero="${canzone.numero}">${canzone.numero}${canzone.titolo}</a></li>`;
                        });
                        htmlAlfabetico += '</ul></div>';
                        $('#indice-contenuto').html(htmlAlfabetico);


                        // Aggiungi il pulsante per l'ordinamento crescente/decrescente
                        if (!$('#sort-toggle').length) {
                            $('#indice-contenuto').before('<div><button id="sort-alpha-toggle" class="btn btn-secondary mb-2">Ordina Crescente <i class="fas fa-sort-alpha-down"></i></button></div>');
                        }

                        $('#sort-alpha-toggle').off('click').on('click', function () {
                            const isAscending = $(this).find('i').hasClass('fa-sort-alpha-down');

                            // Ordina alfabeticamente i titoli in base all'ordine crescente o decrescente
                            indiceAlfabetico.sort((a, b) => {
                                const titoloA = a.titolo.toLowerCase();
                                const titoloB = b.titolo.toLowerCase();

                                if (isAscending) {
                                    return titoloA > titoloB ? -1 : titoloA < titoloB ? 1 : 0;
                                } else {
                                    return titoloA < titoloB ? -1 : titoloA > titoloB ? 1 : 0;
                                }
                            });

                            // Cambia l'icona in base all'ordinamento
                            $(this).html(isAscending ? 'Ordina Decrescente <i class="fas fa-sort-alpha-up"></i>' : 'Ordina Crescente <i class="fas fa-sort-alpha-down"></i>');

                            // Rigenera l'HTML con l'ordinamento applicato
                            let htmlAlfabetico = '<div class="text-start"><ul>';
                            indiceAlfabetico.forEach(canzone => {
                                htmlAlfabetico += `<li><a href="#" class="indice-titolo" data-titolo="${canzone.titolo}" data-numero="${canzone.numero}">${canzone.numero}${canzone.titolo}</a></li>`;
                            });
                            htmlAlfabetico += '</ul></div>';
                            $('#indice-contenuto').html(htmlAlfabetico);
                        });
                    }
                });

            } catch (error) {
                console.error('Errore durante il recupero dei brani da Firestore:', error);
                Swal.fire('Errore!', 'Non è stato possibile caricare l\'indice: ' + error.message, 'error');
            }
        });

    } catch (error) {
        console.error("Errore:", error);
    }
}

async function initializeTagify(songId) {
    // Inizializza Tagify
    const input = document.querySelector('#song-category');
    const tagify = new Tagify(input);

    // Ottieni le categorie già presenti dal DOM
    const categoriePreesistenti = $(`#${songId}`).attr("categorie") || "";
    const categorieArray = categoriePreesistenti.split(/\s+/);

    // Prepopola Tagify con le categorie preesistenti
    tagify.addTags(categorieArray);

    // Quando l'utente modifica le categorie
    tagify.on('add', onTagChange);
    tagify.on('remove', onTagChange);

    function onTagChange(e) {
        // Recupera l'array delle categorie aggiornate
        let categorie = tagify.value.map(tag => tag.value);
        window.categorie = categorie; // Aggiorna la variabile globale o fai ciò che serve
    }

}

// Inizializza componenti
initializeFirebase();

// Registra il Service Worker per abilitare la PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('js/service-worker.js')
            .then(reg => console.log('✅ Service Worker registrato correttamente:', reg))
            .catch(err => console.error('❌ Errore nella registrazione del Service Worker:', err));
    });
}


// Funzione per l'autenticazione permessi admin
$('#open-auth').click(function () {
    Swal.fire({
        title: 'Autenticazione',
        input: 'password',
        inputLabel: 'Inserisci la password',
        inputPlaceholder: 'Password',
        inputAttributes: {
            maxlength: 20,
            autocapitalize: 'off',
            autocorrect: 'off'
        },
        showCancelButton: true,
        confirmButtonText: 'Conferma',
        cancelButtonText: 'Annulla',
        reverseButtons: true
    }).then((result) => {
        if (result.isConfirmed) {
            const passwordInserita = result.value;
            // Controlla se la password è corretta
            verificaPassword(passwordInserita);
        }
    });
});

// Funzione per verificare la password
function verificaPassword(password) {
    const passwordCorretta = "1234"; // Cambia questa con la tua logica di autenticazione o fetch da Firestore
    if (password === passwordCorretta) {
        sbloccaAdmin();
        // Aggiungi eventuali altre funzioni di amministrazione
        console.log("Funzionalità amministrative sbloccate.");
    } else {
        Swal.fire('Oops!', 'Password sbagliata!', 'error');
    }
}

// Funzione per sbloccare le funzionalità di amministrazione
function sbloccaAdmin() {
    // Rendi visibili gli elementi di amministrazione
    $('.admin').show();

    // Imposta un cookie di amministratore valido per una settimana
    setCookie("isAdmin", "1", 7);

    // Nascondi tasto di sblocco
    $('#open-auth').hide();
    $('#auth').hide();
}

// Funzioni per la gestione dei cookie
function setCookie(nome, valore, giorni) {
    const data = new Date();
    data.setTime(data.getTime() + (giorni * 24 * 60 * 60 * 1000));
    const scadenza = "expires=" + data.toUTCString();
    document.cookie = nome + "=" + valore + ";" + scadenza + ";path=/";
}

function getCookie(nome) {
    const nomeCookie = nome + "=";
    const cookies = document.cookie.split(';');
    for (let i = 0; i < cookies.length; i++) {
        let c = cookies[i].trim();
        if (c.indexOf(nomeCookie) === 0) {
            return c.substring(nomeCookie.length, c.length);
        }
    }
    return "";
}

// Gestisci l'evento di ricaricamento forzato (Ctrl + F5)
$(window).on('keydown', function (event) {
    if (event.ctrlKey && event.key === 'F5') {
        deleteCookie("isAdmin"); // Cancella il cookie
    }
});

// Funzione per cancellare il cookie idCliente
function deleteCookie(name) {
    document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

// Funzione per formattare la data
function formatDate(date) {
    if (!date) return '-'; // Se la data è null o undefined, restituisci un trattino
    const options = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
    return date.toLocaleDateString('it-IT', options); // Formattazione italiana
}