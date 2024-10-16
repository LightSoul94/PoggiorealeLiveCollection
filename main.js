import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getFirestore, collection, onSnapshot, doc, updateDoc, getDoc, setDoc, deleteDoc, getDocs, Timestamp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { containsChord, transposeChord } from './transposeUtils.js';

let isAdmin = 0;
let db;
let auth;

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

        // Effettua il login
        const { email, password } = authConfig;
        await signInWithEmailAndPassword(auth, email, password);
        console.log("Login effettuato con successo.");

        // Carica i dati in tempo reale dopo il successo del login
        loadAllSongsInRealtime();

        // MAIN
        // Riferimento alla barra di ricerca della raccolta
        const isWordSearch = doc(db, "settings", "wordSearchEnabled");
        // Riferimento al filtro di ricerca
        const searchRef = doc(db, "settings", "current_search");
        // Riferimento alla barra di ricerca dell'innario
        const pdfSearchRef = doc(db, "settings", "pdf_search");
        // Riferimento all'interruttore su Firestore
        const switchRef = doc(db, "settings", "switch_status");


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
                const categoria = $(this).attr('categoria') || "Generico";
                const titolo = $(this).attr('titolo') || "Senza Titolo";
                const numero = $(this).attr('numero') || "0";

                // Ottieni il contenuto della canzone e processa gli span
                const contenuto = $(this).find('div.col p').map(function () {
                    let htmlContent = $(this).html();

                    // Sostituzione dei tag <br> con \n
                    htmlContent = htmlContent.replace(/<br\s*\/?>/gi, '\n');

                    // Sostituzione degli &nbsp; con spazio normale
                    htmlContent = htmlContent.replace(/&nbsp;/gi, ' ');

                    // Rimozione di tutti i tag <span> mantenendo il contenuto interno
                    htmlContent = htmlContent.replace(/<\/?span[^>]*>/gi, '');

                    // Sostituzione degli <strong> per grassetto con formattazione asterisco
                    htmlContent = htmlContent.replace(/<strong>(.*?)<\/strong>/gi, (match, content) => {
                        return `*${content.trim()}*`; // Simula il grassetto con asterischi
                    });

                    return htmlContent.trim();
                }).get().join('\n');

                songsArray.push({ categoria, titolo, numero, contenuto });
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
                if (!indice[song.categoria]) {
                    indice[song.categoria] = [];
                }
                indice[song.categoria].push(`${song.numero}. ${song.titolo}`);
            });

            // Aggiungi l'indice alla pagina inserita
            Object.keys(indice).forEach(categoria => {
                pdf.text(categoria, 10, y);
                y += 6;

                // Se la coordinata y supera un certo limite, aggiungi una nuova pagina per continuare l'indice
                if (y > 280) {
                    pdf.addPage();
                    y = 20; // Reimposta la coordinata y all'inizio della nuova pagina
                }

                indice[categoria].forEach(titolo => {
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

        // Imposta il file PDF
        const url = 'inni.pdf'; // Cambia con il percorso del tuo file PDF
        let pdfDoc = null,
            pageNum = 1,
            pageRendering = false,
            pageNumPending = null,
            scale = 1.5,
            canvas = document.getElementById('pdf-render'),
            ctx = canvas.getContext('2d');

        // Nascondi funzioni admin se non è autorizzato
        $(document).ready(function () {
            // const searchRef = doc(db, "settings", "current_search");

            // Recupera l'ultima query di ricerca da Firestore all'apertura della pagina
            initializeSearchDocument();
            const adminCookie = getCookie("isAdmin");
            if (adminCookie === "1") {
                isAdmin = 1;
                sbloccaAdmin();
            } else {
                // Nascondi inizialmente gli elementi di amministrazione
                $('.admin').hide();
            }
        });

        //Pulisci motore di ricerca e aggiorna Firestore
        window.clearSearchBar = async function () {
            $('#wordSearch').prop('checked', false);
            document.getElementById('search-bar').value = '';
            filterSongs('');
            // Aggiorna Firestore con la nuova query di ricerca
            try {
                await updateDoc(searchRef, {
                    query: '',
                    wordSearchEnabled: false
                });
            } catch (error) {
                console.error('Errore durante l\'aggiornamento della ricerca su Firestore:', error);
            }
        }


        //Inizializza motore di ricerca
        $(document).ready(function () {
            // Ascolta gli eventi di input nella barra di ricerca
            $('#search-bar').on('input', async function () {
                const searchQuery = $(this).val().toLowerCase();
                const isWordSearch = $('#wordSearch').prop('checked');

                // Aggiorna Firestore con la nuova query di ricerca
                try {
                    await updateDoc(searchRef, {
                        query: searchQuery,
                        wordSearchEnabled: isWordSearch
                    });
                } catch (error) {
                    console.error('Errore durante l\'aggiornamento della ricerca su Firestore:', error);
                }
            });

            // Event listener per la checkbox di ricerca per parole contenute
            $('#wordSearch').on('click', async function () {
                // Ottieni il valore della checkbox (true/false se selezionata)
                const isWordSearchStatus = $(this).prop('checked');

                // Ottieni il valore attuale della barra di ricerca per filtrare in seguito i risultati nella pagina
                const searchQuery = $('#search-bar').val().toLowerCase();

                // Aggiorna Firestore con il nuovo stato dell'opzione di ricerca
                try {
                    await updateDoc(searchRef, {
                        wordSearchEnabled: isWordSearchStatus
                    });
                } catch (error) {
                    console.error('Errore durante l\'aggiornamento delle opzioni di ricerca su Firestore:', error);
                }

                // Richiama la funzione di filtro per riflettere il nuovo stato
                filterSongs(searchQuery);
            });
        });

        // Specifica il percorso del worker script di PDF.js
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.10.377/pdf.worker.min.js';


        // Carica il PDF usando PDF.js
        pdfjsLib.getDocument(url).promise.then((pdfDoc_) => {
            pdfDoc = pdfDoc_;
            document.getElementById('page-count').textContent = pdfDoc.numPages;

            // Renderizza la prima pagina dopo che il PDF è stato caricato
            renderPage(pageNum);
        }).catch((error) => {
            console.error("Errore durante il caricamento del PDF:", error);
        });


        // Gestione navigatore del PDF
        // Aggiungi event listener per i pulsanti di navigazione del PDF
        document.getElementById('prev-page').addEventListener('click', async () => {
            if (pageNum <= 1) return;
            pageNum--;
            await updatePDFPageOnFirestore(pageNum);
            renderPage(pageNum);
        });

        document.getElementById('next-page').addEventListener('click', async () => {
            if (pageNum >= pdfDoc.numPages) return;
            pageNum++;
            await updatePDFPageOnFirestore(pageNum);
            renderPage(pageNum);
        });


        async function updatePDFPageOnFirestore(pageNumber) {
            const pdfPageRef = doc(db, "settings", "pdf_page_status"); // Riferimento al documento su Firestore

            try {
                const docSnap = await getDoc(pdfPageRef);

                if (docSnap.exists()) {
                    // Aggiorna il documento se esiste
                    await updateDoc(pdfPageRef, { currentPage: pageNumber });
                    console.log("Stato della pagina PDF aggiornato su Firestore:", pageNumber);
                } else {
                    // Crea il documento se non esiste
                    await setDoc(pdfPageRef, { currentPage: pageNumber });
                    console.log("Documento 'pdf_page_status' creato su Firestore con pagina iniziale:", pageNumber);
                }
            } catch (error) {
                console.error("Errore durante l'aggiornamento dello stato della pagina PDF su Firestore:", error);
            }
        }

        async function initializePDFPageDocument() {
            const pdfPageRef = doc(db, "settings", "pdf_page_status");
            try {
                const docSnap = await getDoc(pdfPageRef);
                if (!docSnap.exists()) {
                    // Se il documento non esiste, crea un nuovo documento con la pagina iniziale impostata su 1
                    await setDoc(pdfPageRef, { currentPage: 1 });
                    console.log("Documento di stato della pagina PDF inizializzato su Firestore.");
                } else {
                    console.log("Documento di stato della pagina PDF già esistente su Firestore.");
                }
            } catch (error) {
                console.error('Errore durante l\'inizializzazione del documento di stato della pagina PDF su Firestore:', error);
            }
        }

        // Inizializza il documento di stato della pagina PDF all'apertura della pagina
        initializePDFPageDocument();


        onSnapshot(doc(db, "settings", "pdf_page_status"), (doc) => {
            if (doc.exists()) {
                const pageNumber = doc.data().currentPage;
                if (pageNumber !== pageNum) { // Verifica se la pagina attuale è diversa
                    pageNum = pageNumber;
                    renderPage(pageNum);
                }
            } else {
                console.log("Il documento 'pdf_page_status' non esiste.");
            }
        });



        // Funzione per inizializzare il documento di ricerca PDF su Firestore
        async function initializePDFSearchDocument() {
            try {
                const docSnap = await getDoc(pdfSearchRef);
                if (!docSnap.exists()) {
                    // Se il documento non esiste, crea un nuovo documento con una query vuota
                    await setDoc(pdfSearchRef, { query: "" });
                    console.log("Documento di ricerca PDF inizializzato su Firestore.");
                } else {
                    console.log("Documento di ricerca PDF già esistente su Firestore.");
                }
            } catch (error) {
                console.error('Errore durante l\'inizializzazione del documento di ricerca PDF su Firestore:', error);
            }
        }

        // Inizializza il documento di ricerca PDF all'apertura della pagina
        initializePDFSearchDocument();

        // Ascolta i cambiamenti nella query di ricerca del PDF in tempo reale
        onSnapshot(pdfSearchRef, (doc) => {
            if (doc.exists()) {
                const pdfSearchQuery = doc.data().query.toLowerCase();
                $('#pdf-search-bar').val(pdfSearchQuery); // Imposta la barra di ricerca PDF con l'ultima query
                searchInPDF(pdfSearchQuery); // Esegue la ricerca nel PDF e visualizza la pagina corretta
            }
        });

        // Event Listener per la barra di ricerca PDF
        $('#pdf-search-bar').on('input', async function () {
            const pdfSearchQuery = $(this).val().toLowerCase();
            try {
                await updateDoc(pdfSearchRef, { query: pdfSearchQuery });
            } catch (error) {
                console.error('Errore durante l\'aggiornamento della ricerca PDF su Firestore:', error);
            }
        });


        // Barra di ricerca per il pdf inni di lode
        // Gestisce la ricerca all'interno del PDF
        document.getElementById('pdf-search-bar').addEventListener('input', function () {
            const searchQuery = this.value.toLowerCase();
            searchInPDF(searchQuery);
        });

        function searchInPDF(query) {
            if (!pdfDoc) return;

            const numPages = pdfDoc.numPages;
            let currentPage = 1;
            let found = false;

            function searchNextPage() {
                pdfDoc.getPage(currentPage).then(function (page) {
                    page.getTextContent().then(function (textContent) {
                        const textItems = textContent.items;
                        let pageText = "";
                        for (let i = 0; i < textItems.length; i++) {
                            pageText += textItems[i].str + " ";
                        }
                        if (pageText.toLowerCase().includes(query)) {
                            found = true;
                            pageNum = currentPage;  // Aggiorna il numero di pagina corrente
                            renderPage(pageNum); // Mostra la pagina dove il testo è stato trovato
                            document.getElementById('pdf-search-bar').focus();
                            document.getElementById('page-num').textContent = pageNum;  // Aggiorna il numero di pagina visualizzato
                        } else if (currentPage < numPages) {
                            currentPage++;
                            searchNextPage(); // Cerca nella pagina successiva
                        } else if (!found) {
                            console.warn('Nessun risultato trovato', `La parola "${query}" non è presente nel documento.`, 'info');
                        }
                    });
                });
            }
            searchNextPage();
        }


        function renderPage(num) {
            if (!pdfDoc) {
                // console.log("Il documento PDF non è ancora caricato.");
                return;
            }

            if (pageRendering) {
                // Se è in corso un rendering, memorizza la pagina da renderizzare
                pageNumPending = num;
                return;
            }

            pageRendering = true; // Imposta lo stato di rendering a true

            // Ottieni la pagina
            pdfDoc.getPage(num).then((page) => {
                const viewport = page.getViewport({ scale: scale });
                canvas.height = viewport.height;
                canvas.width = viewport.width;

                // Renderizza la pagina
                const renderContext = {
                    canvasContext: ctx,
                    viewport: viewport,
                };
                const renderTask = page.render(renderContext);

                // Aggiusta quando la pagina è renderizzata
                renderTask.promise.then(() => {
                    pageRendering = false; // Il rendering è completato
                    if (pageNumPending !== null) {
                        // Se è stata richiesta una nuova pagina durante il rendering, renderizzala ora
                        renderPage(pageNumPending);
                        pageNumPending = null;
                    }
                }).catch((error) => {
                    console.error("Errore durante il rendering della pagina:", error);
                    pageRendering = false; // Assicurati che lo stato di rendering venga resettato in caso di errore
                });
            }).catch((error) => {
                console.error("Errore durante il caricamento della pagina PDF:", error);
                pageRendering = false; // Assicurati che lo stato di rendering venga resettato in caso di errore
            });

            // Aggiorna il numero di pagina
            document.getElementById('page-num').textContent = num;
        }

        //Pulisci motore di ricerca e aggiorna Firestore
        window.clearSearchPDF = async function () {
            document.getElementById('pdf-search-bar').value = '';
            searchInPDF('');
            // Aggiorna Firestore con la nuova query di ricerca
            try {
                await updateDoc(pdfSearchRef, {
                    query: ''
                });
            } catch (error) {
                console.error('Errore durante l\'aggiornamento della ricerca su Firestore:', error);
            }
        }



        // Cambia la pagina
        document.getElementById('prev-page').addEventListener('click', () => {
            if (pageNum <= 1) return;
            pageNum--;
            renderPage(pageNum);
        });

        document.getElementById('next-page').addEventListener('click', () => {
            if (pageNum >= pdfDoc.numPages) return;
            pageNum++;
            renderPage(pageNum);
        });


        // Funzione per inizializzare il documento di ricerca su Firestore
        async function initializeSearchDocument() {
            const searchRef = doc(db, "settings", "current_search");
            try {
                const docSnap = await getDoc(searchRef);
                if (!docSnap.exists()) {
                    // Se il documento non esiste, crea un nuovo documento con una query vuota
                    await setDoc(searchRef, { query: "", wordSearch: isWordSearchStatus });
                    console.log("Documento di ricerca inizializzato su Firestore.");
                } else {
                    // Recupera e imposta l'ultima query di ricerca
                    const searchQuery = docSnap.data().query.toLowerCase();
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

        function loadAllSongsInRealtime() {
            const adminCookie = getCookie("isAdmin");
            onSnapshot(collection(db, "culto"), (querySnapshot) => {
                let songsArray = [];

                // Raccogli i dati dei cantici in un array
                querySnapshot.forEach((doc) => {
                    const data = doc.data();
                    songsArray.push({
                        id: doc.id,
                        numero: data.numero,
                        titolo: data.titolo,
                        categoria: data.categoria,
                        html: data.html,
                        transposeValue: data.transposeValue || 0
                    });
                });

                // Ordina l'array in base al numero in ordine crescente
                songsArray.sort((a, b) => a.numero - b.numero);


                // Crea l'HTML per la lista dei cantici ordinati
                let songListHTML = "<ul class='list-group'>";
                songsArray.forEach((song) => {
                    transposeValues[song.id] = song.transposeValue;

                    songListHTML += `
                    <li class='list-group-item mb-2 p-0' id="${song.id}" categoria="${song.categoria}" titolo="${song.titolo}" numero="${song.numero}">
                        <div class="d-flex flex-row">
                            
                            <div class="col p-1" id="song-content-${song.id}">
                                <h5 id="title-${song.id}" class="mb-4">
                                    ${song.numero}. ${song.titolo}
                                </h5>
                                ${song.html}
                            </div>
                            <div class="col-3 p-1 admin" id="editSection-${song.id}" style="display:none">
                                <button id="edit-button-${song.id}" class="btn btn-outline-secondary m-0 p-1 col-12 justify-content-center" style="height: 70px;" onclick="editSong('${song.id}')">
                                    <i class="fa fa-pencil" aria-hidden="true"></i> Modifica
                                </button>
    
                                <div class="mt-5" id="transposer-${song.id}">
                                    <button class="btn btn-outline-secondary m-0 p-3 col-12" onclick="transposeUp('${song.id}')">
                                    +
                                    </button>
                                    <div class="text-center mt-4 mb-4">
                                        <span id="transpose-value-${song.id}">${song.transposeValue}</span>
                                    </div>
                                    <button class="btn btn-outline-secondary m-0 p-3 col-12" onclick="transposeDown('${song.id}')">
                                    -
                                    </button>
                                </div>
                            </div>
                        </div>
                    </li>`;
                });
                songListHTML += "</ul>";

                $('#songs-list').html(songListHTML);

                // Aggiorna vista in base all'ultima ricerca effettuata
                onSnapshot(searchRef, (doc) => {
                    if (doc.exists()) { // Controlla se il documento esiste
                        const searchQuery = doc.data().query.toLowerCase();
                        const isWordSearch = doc.data().wordSearchEnabled;
                        $('#search-bar').val(searchQuery);
                        $('#wordSearch').prop('checked', isWordSearch);

                        filterSongs(searchQuery);
                    } else {
                        console.log("Il documento 'current_search' non esiste.");
                    }
                });
                if (adminCookie === "1") {
                    sbloccaAdmin();
                }
            }, (error) => {
                Swal.fire('Errore!', 'Non è stato possibile caricare i cantici: ' + error.message, 'error');
            });
        }

        // });

        // Funzione per gestire l'aumento di semitoni
        window.transposeUp = function (songId) {
            const currentSearchQuery = $('#search-bar').val().toLowerCase(); // Memorizza il valore di ricerca corrente
            transposeValues[songId]++; // Incrementa il valore di trasposizione per il cantico specifico
            $('#transpose-value-' + songId).text(transposeValues[songId]); // Aggiorna la label visualizzata
            transpose(songId, 1); // Trasponi di 1 semitono per il cantico specifico
            updateSongInFirestore(songId, currentSearchQuery); // Passa il valore di ricerca corrente
        };

        // Funzione per gestire la diminuzione di semitoni
        window.transposeDown = function (songId) {
            const currentSearchQuery = $('#search-bar').val().toLowerCase(); // Memorizza il valore di ricerca corrente
            transposeValues[songId]--; // Decrementa il valore di trasposizione per il cantico specifico
            $('#transpose-value-' + songId).text(transposeValues[songId]); // Aggiorna la label visualizzata
            transpose(songId, -1); // Trasponi di -1 semitono per il cantico specifico
            updateSongInFirestore(songId, currentSearchQuery); // Passa il valore di ricerca corrente
        };

        // Funzione per trasporre solo le note del cantico con l'ID specifico
        function transpose(songId, semitone) {
            const songContentDiv = $(`#song-content-${songId}`);
            let htmlContent = songContentDiv.html(); // Ottieni il contenuto HTML del cantico
            let transposedContent = transposeChords(htmlContent, semitone);
            songContentDiv.html(transposedContent); // Aggiorna il contenuto del cantico

            // Colora di rosso tutti gli accordi nel testo
            songContentDiv.find('span.chord').css('color', 'red');
        }



        // Funzione per aggiornare il documento su Firestore
        async function updateSongInFirestore(songId, currentSearchQuery) {
            const songContentDiv = $(`#song-content-${songId}`);
            const updatedContent = songContentDiv.html(); // Ottieni il contenuto aggiornato
            const titoloCantico = $(`#${songId}`).attr("titolo"); // Ottieni titolo del cantico aggiornato

            try {
                await updateDoc(doc(db, "culto", songId), {
                    html: updatedContent,
                    transposeValue: transposeValues[songId] // Salva il valore di trasposizione
                });
                console.log(`Cantico ${titoloCantico} aggiornato su Firestore.`);

                // Applica nuovamente il filtro di ricerca con il valore corrente
                filterSongs(currentSearchQuery);

                if (isAdmin === 1) {
                    sbloccaAdmin();
                }
            } catch (error) {
                console.error('Errore durante l\'aggiornamento su Firestore:', error);
                Swal.fire('Errore!', 'Non è stato possibile aggiornare il cantico su Firestore: ' + error.message, 'error');
            }
        }

        // Funzione per filtrare i cantici in base alla ricerca corrente
        function filterSongs(searchQuery) {
            $('.list-group-item').each(function () {
                const numero = $(this).attr('numero') ? $(this).attr('numero').toLowerCase() : '';
                const titolo = $(this).attr('titolo') ? $(this).attr('titolo').toLowerCase() : '';
                const categoria = $(this).attr('categoria') ? $(this).attr('categoria').toLowerCase() : '';

                // Include il contenuto testuale di tutta la canzone
                const isWordSearch = $('#wordSearch').is(':checked');
                const parole = $(this).text().toLowerCase();

                // Se è abilitata la ricerca per parole e la ricerca coincide
                if (isWordSearch && parole.includes(searchQuery)) {
                    $(this).show();
                } else if (`${numero}. ${titolo}`.includes(searchQuery) || titolo.includes(searchQuery) || categoria.includes(searchQuery)) {
                    // Altrimenti effettua ricerca classica per numero/titolo/categoria
                    $(this).show();
                } else {
                    $(this).hide();
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



        // Funzione per modificare il cantico selezionato
        // Funzione per modificare il cantico selezionato
        window.editSong = async function (songId) {
            const objTitolo = $(`#title-${songId}`);
            const songContentDiv = $(`#song-content-${songId}`);
            const searchBar = $("#searchBarRaccolta");
            const editSection = $(`#editSection-${songId}`);

            // Ottieni il testo completo del titolo
            const interoTitolo = $(`#title-${songId}`).text().trim();

            // Splitta il titolo in numero e testo
            const [numero, titolo] = interoTitolo.split('. ', 2); // Usa il separatore ". "

            objTitolo.remove(); // Rimuovi titolo
            searchBar.hide(); // Nascondi campo di ricerca
            editSection.hide();

            const categoria = $(`#${songId}`).attr("categoria");

            // Distruggi TinyMCE se già inizializzato
            if (tinymce.get(`edit-textarea-${songId}`)) {
                tinymce.get(`edit-textarea-${songId}`).remove();
            }

            // Recupera la data di ultima modifica da Firestore
            let lastModifiedDate = "Non ancora salvato";
            let dataInserimento = "Sconosciuta";
            try {
                const docRef = doc(db, "culto", songId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data && data.dataInserimento) {
                        dataInserimento = new Date(data.dataInserimento.toDate()).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
                    }
                    if (data && data.ultimaModifica) {
                        lastModifiedDate = new Date(data.ultimaModifica.toDate()).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' });
                    }
                }
            } catch (error) {
                console.error("Errore nel recuperare la data di ultima modifica:", error);
            }

            // Inizializza TinyMCE sul textarea per la modifica
            songContentDiv.html(`
        <div class="col-12 p-0">
            <div class="form-group">
                <div class="d-flex justify-content-end">
                    <button class="btn btn-outline-danger d-flex " onclick="deleteSong('${songId}')">Elimina</button>
                </div>
                <label for="song-category">Categoria:</label>
                <select id="song-category" class="form-control">
                    <option value="Generico">Generico</option>
                    <option value="Apertura">Apertura</option>
                    <option value="Preghiera">Preghiera</option>
                    <option value="Lode">Lode</option>
                    <option value="Chiusura">Chiusura</option>
                    <option value="Piccolo">Piccolo</option>
                    <option value="Da Verificare">Da Verificare</option>
                </select>
            </div>
            <div class="d-flex col-12 mb-2 pr-2 pl-0">
                <input id="numero-${songId}" class="form-control col-md-2 mr-2" type="number" min="0" placeholder="N." value="${numero}" style="font-size:12px">
                <input id="titolo-${songId}" class="form-control col-10" type="text" placeholder="Titolo" value="${titolo}" style="font-size:12px">
            </div>
        </div>
        <textarea id="edit-textarea-${songId}" class="form-control" rows="5" style="height:500px">${songContentDiv.html()}</textarea>
        <button class="btn btn-success mt-2" onclick="saveSong('${songId}')">Salva</button>
        <button class="btn btn-secondary mt-2" onclick="cancelEdit('${songId}')">Annulla</button>
        <div class="mt-2">
            <label id="data-insert-label-${songId}" class="text-muted" style="font-size: 12px; color: lightgray; font-style: italic;">Data inserimento: ${dataInserimento} - </label>
            <label id="last-modified-label-${songId}" class="text-muted" style="font-size: 12px; color: lightgray; font-style: italic;">Ultima modifica: ${lastModifiedDate}</label>
        </div>
    `);

            $(`#song-category`).val(categoria);

            tinymce.init({
                selector: `#edit-textarea-${songId}`,
                force_br_newlines: true,
                menubar: false,
                plugins: 'lists link preview',
                toolbar: 'undo redo | bold italic | forecolor | fontsize | alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | link',
                setup: function (editor) {
                    editor.on('change', function () {
                        editor.save();
                    });
                }
            });
        };

        // Funzione per annullare la modifica
        window.cancelEdit = async function (songId) {
            const songContentDiv = $(`#song-content-${songId}`);
            const searchBar = $("#searchBarRaccolta");
            const editSection = $(`#editSection-${songId}`);
            // const editButton = $(`#edit-button-${songId}`);
            // const sezioneTransposer = $(`#transposer-${songId}`);

            searchBar.show(); // Mostra nuovamente campo di ricerca
            editSection.show();
            // editButton.prop('disabled', false); // Riabilita il pulsante "Modifica"
            // sezioneTransposer.show(); // Mostra nuovamente la sezione di trasposizione

            const songDoc = doc(db, "culto", songId);
            try {
                const docSnap = await getDoc(songDoc);
                if (docSnap.exists()) {
                    songContentDiv.html(docSnap.data().html); // Ripristina il contenuto originale

                    // Reinserisci titolo
                    const titleElement = `<h5 id="title-${songId}">${docSnap.data().numero}. ${docSnap.data().titolo}</h5>`;
                    songContentDiv.prepend(titleElement);

                } else {
                    Swal.fire('Errore!', 'Il cantico non esiste più nel database.', 'error');
                }
            } catch (error) {
                Swal.fire('Errore!', 'Errore durante il recupero del cantico: ' + error.message, 'error');
            }
        };


        // Funzione per salvare il cantico e aggiornare la data di ultima modifica
        window.saveSong = async function (songId) {
            try {
                // Crea un riferimento al documento
                const docRef = doc(db, "culto", songId);
                const currentDate = new Date();

                // Aggiorna il documento con le nuove informazioni, incluso "ultimaModifica"
                await setDoc(docRef, {
                    numero: $(`#numero-${songId}`).val(),
                    titolo: $(`#titolo-${songId}`).val(),
                    categoria: $(`#song-category`).val(),
                    html: tinymce.get(`edit-textarea-${songId}`).getContent(),
                    ultimaModifica: Timestamp.fromDate(currentDate)
                }, { merge: true });

                // Aggiorna la data di ultima modifica visualizzata nell'interfaccia
                $(`#last-modified-label-${songId}`).text(`Ultima modifica: ${currentDate.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}`);

                // Ricarica schermata attuale
                const searchBar = $("#searchBarRaccolta");
                const editSection = $(`#editSection-${songId}`);
                searchBar.show();
                editSection.show();
            } catch (error) {
                console.error("Errore durante il salvataggio del cantico:", error);
            }
        };

        // Funzione per eliminazione
        window.deleteSong = async function (songId) {
            try {
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
                    // Accedi alla raccolta
                    const docRef = doc(db, "culto", songId);
                    // Elimina il documento
                    await deleteDoc(docRef);
                    // Mostra un messaggio di successo
                    Swal.fire(
                        'Eliminato!',
                        'Il cantico è stato eliminato con successo.',
                        'success'
                    );
                    // Torna a vista normale
                    const searchBar = $("#searchBarRaccolta");
                    const editSection = $(`#editSection-${songId}`);
                    searchBar.show();
                    editSection.show();
                }
            } catch (error) {
                console.error("Errore durante l'eliminazione del cantico:", error);
                Swal.fire(
                    'Errore',
                    'Si è verificato un errore durante l\'eliminazione del cantico.',
                    'error'
                );
            }
        }


        // Switch raccolta
        document.getElementById('raccolta-btn').addEventListener('click', function (event) {
            event.stopPropagation(); // Previene la propagazione dell'evento
            handleSwitchClick(true);
            $('#raccolta').show();
            $('#inni').hide();
            this.classList.add('active');
            document.getElementById('inni-btn').classList.remove('active');
        });

        document.getElementById('inni-btn').addEventListener('click', function (event) {
            event.stopPropagation();  // Previene la propagazione dell'evento
            handleSwitchClick(false);
            $('#raccolta').hide();
            $('#inni').show();
            this.classList.add('active');
            document.getElementById('raccolta-btn').classList.remove('active');
        });


        // Funzione per gestire il click sul "segmented button"
        async function handleSwitchClick(isRaccoltaActive) {
            const switchRef = doc(db, "settings", "switch_status"); // Riferimento al documento Firestore

            try {
                // Controlla se il documento 'switch_status' esiste
                const docSnap = await getDoc(switchRef);
                if (docSnap.exists()) {
                    // Se esiste, aggiorna lo stato
                    await updateSwitchStatus(isRaccoltaActive);
                } else {
                    // Se non esiste, crea il documento con lo stato iniziale
                    await setDoc(switchRef, { status: isRaccoltaActive });
                    console.log("Documento 'switch_status' creato su Firestore con stato:", isRaccoltaActive);
                }
            } catch (error) {
                console.error("Errore durante la gestione del click sull'interruttore:", error);
            }
        }

        // Funzione per aggiornare lo stato dell'interruttore su Firestore
        async function updateSwitchStatus(isRaccoltaActive) {
            const switchRef = doc(db, "settings", "switch_status"); // Riferimento al documento Firestore

            try {
                await updateDoc(switchRef, { status: isRaccoltaActive });
                console.log("Stato dell'interruttore aggiornato:", isRaccoltaActive);
            } catch (error) {
                console.error("Errore durante l'aggiornamento dello stato dell'interruttore:", error);
            }
        }

        // Ascolta i cambiamenti allo stato dell'interruttore su Firestore
        onSnapshot(doc(db, "settings", "switch_status"), (doc) => {
            if (doc.exists()) {
                const switchStatus = doc.data().status;
                if (switchStatus) {
                    document.getElementById('raccolta-btn').classList.add('active');
                    document.getElementById('inni-btn').classList.remove('active');
                    document.getElementById('raccolta').style.display = 'block';
                    document.getElementById('inni').style.display = 'none';
                } else {
                    document.getElementById('inni-btn').classList.add('active');
                    document.getElementById('raccolta-btn').classList.remove('active');
                    document.getElementById('raccolta').style.display = 'none';
                    document.getElementById('inni').style.display = 'block';
                }
            } else {
                console.log("Il documento 'switch_status' non esiste.");
            }
        });

        // Ascolta i cambiamenti allo stato delle notifiche su Firestore
        onSnapshot(doc(db, "notifiche", "notificaCorrente"), (doc) => {
            if (doc.exists()) {
                const notifica = doc.data().messaggio;
                const colore = doc.data().colore;
                if (notifica != "") {
                    notificaPastore(notifica, colore);
                    //Svuota notifiche
                    svuotaNotifiche();
                }
            } else {
                console.log("Nessuna notifica in arrivo.");
            }
        });

        async function svuotaNotifiche() {
            try {
                await updateDoc(doc(db, "notifiche", "notificaCorrente"), {
                    messaggio: "",
                    colore: ""
                });
                console.log("Notifiche svuotate con successo.");
            } catch (error) {
                console.error("Errore durante lo svuotamento delle notifiche: ", error);
            }
        }


        // Gestione delle notifiche
        function notificaPastore(notifica, colore) {
            // Mappa dei colori predefiniti per le notifiche
            const coloriNotifica = {
                blu: "linear-gradient(to right, #2193b0, #6dd5ed)",
                verde: "linear-gradient(to right, #00b09b, #96c93d)",
                giallo: "linear-gradient(to right, #f7971e, #ffd200)",
                rosso: "linear-gradient(to right, #e53935, #e35d5b)",
                azzurro: "linear-gradient(to right, #00c6ff, #0072ff)"
            };

            // Usa il colore specificato o default a verde se il colore non è riconosciuto
            const backgroundColor = coloriNotifica[colore] || coloriNotifica.verde;

            // Mostra la notifica con il colore specificato
            Toastify({
                text: notifica,
                duration: 5000,
                gravity: "bottom",
                position: "center",
                backgroundColor: backgroundColor,
                stopOnFocus: true,
            }).showToast();
        }

        // Apri indice raccolta
        $('#open-index').click(async function () {
            try {
                // Recupera tutti i cantici da Firestore
                const querySnapshot = await getDocs(collection(db, "culto"));
                let indice = {};

                // Organizza i cantici per categoria e ordina alfabeticamente
                querySnapshot.forEach((doc) => {
                    const data = doc.data();
                    const categoria = data.categoria || "Generico";
                    const titolo = data.titolo || "Senza Titolo";
                    const numero = `${data.numero ? data.numero + '. ' : ''}`;

                    // Se la categoria non esiste nell'indice, la crea
                    if (!indice[categoria]) {
                        indice[categoria] = [];
                    }

                    // Aggiunge un oggetto con titolo e numero
                    indice[categoria].push({ titolo, numero });
                });

                // Ordina i titoli all'interno di ogni categoria
                Object.keys(indice).forEach(categoria => {
                    indice[categoria].sort((a, b) => a.titolo.localeCompare(b.titolo));
                });

                // Funzione per creare l'HTML dell'indice
                const creaIndiceHTML = (indice) => {
                    let html = `<div class="text-left">`;
                    Object.keys(indice).forEach(categoria => {
                        html += `<strong>${categoria}</strong><ul>`;
                        indice[categoria].forEach(canzone => {
                            html += `<li><a href="#" class="indice-titolo" data-titolo="${canzone.titolo}" data-numero="${canzone.numero}">${canzone.numero}${canzone.titolo}</a></li>`;
                        });
                        html += "</ul>";
                    });
                    html += "</div>";
                    return html;
                };

                // Crea l'HTML iniziale dell'indice
                let indiceHTML = `
            <div class="btn-group mb-3" role="group" aria-label="Segmented button per ordinare">
                <button type="button" class="btn btn-outline-primary m-0 active" id="btn-per-categoria">Per Categoria</button>
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

                // Aggiungi gestore di eventi per i titoli cliccabili
                $(document).off('click', '.indice-titolo').on('click', '.indice-titolo', function (e) {
                    e.preventDefault();
                    const titoloSelezionato = `${$(this).data('numero')}${$(this).data('titolo')}`;
                    $('#search-bar').val(titoloSelezionato).trigger('input');
                    Swal.close();
                });

                // Gestore eventi per intercettare il cambio di tipologia
                $(document).off('click', '.btn-group .btn').on('click', '.btn-group .btn', function () {
                    // Rimuove la classe 'active' solo da questo menu
                    $('#btn-per-categoria').removeClass('active');
                    $('#btn-ordine-numerico').removeClass('active');
                    $('#btn-ordine-alfabetico').removeClass('active');
                    $(this).addClass('active');

                    const selectedButtonId = $(this).attr('id');

                    if (selectedButtonId === 'btn-per-categoria') {
                        // Ordina per categoria alfabeticamente
                        Object.keys(indice).forEach(categoria => {
                            indice[categoria].sort((a, b) => a.titolo.localeCompare(b.titolo));
                        });
                        $('#indice-contenuto').html(creaIndiceHTML(indice));
                        $('#sort-toggle').remove(); // Rimuove il pulsante di ordinamento numerico, se presente
                        $('#sort-alpha-toggle').remove(); // Rimuove il pulsante di ordinamento alfabetico, se presente
                    } else if (selectedButtonId === 'btn-ordine-numerico') {
                        $('#sort-alpha-toggle').remove(); // Rimuove il pulsante di ordinamento alfabetico, se presente

                        // Ordina numericamente
                        const indiceNumerico = [];
                        Object.keys(indice).forEach(categoria => {
                            indice[categoria].forEach(canzone => {
                                indiceNumerico.push({ categoria, ...canzone });
                            });
                        });

                        // Ordina i cantici in base al numero in modo crescente di default
                        indiceNumerico.sort((a, b) => parseInt(a.numero) - parseInt(b.numero));
                        let htmlNumerico = '<div class="text-left"><ul>';
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
                            let htmlNumerico = '<div class="text-left"><ul>';
                            indiceNumerico.forEach(canzone => {
                                htmlNumerico += `<li><a href="#" class="indice-titolo" data-titolo="${canzone.titolo}" data-numero="${canzone.numero}">${canzone.numero}${canzone.titolo}</a></li>`;
                            });
                            htmlNumerico += '</ul></div>';
                            $('#indice-contenuto').html(htmlNumerico);
                        });

                    } else if (selectedButtonId === 'btn-ordine-alfabetico') {
                        $('#sort-toggle').remove(); // Rimuove il pulsante di ordinamento numerico, se presente
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

                        let htmlAlfabetico = '<div class="text-left"><ul>';
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
                            let htmlAlfabetico = '<div class="text-left"><ul>';
                            indiceAlfabetico.forEach(canzone => {
                                htmlAlfabetico += `<li><a href="#" class="indice-titolo" data-titolo="${canzone.titolo}" data-numero="${canzone.numero}">${canzone.numero}${canzone.titolo}</a></li>`;
                            });
                            htmlAlfabetico += '</ul></div>';
                            $('#indice-contenuto').html(htmlAlfabetico);
                        });
                    }
                });
            } catch (error) {
                console.error('Errore durante il recupero dei cantici da Firestore:', error);
                Swal.fire('Errore!', 'Non è stato possibile caricare l\'indice: ' + error.message, 'error');
            }
        });


    } catch (error) {
        console.error("Errore:", error);
    }
}

// Inizializza Firebase
initializeFirebase();


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
        isAdmin = 1;
        sbloccaAdmin();
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

    // Aggiungi eventuali altre funzioni di amministrazione
    console.log("Funzionalità amministrative sbloccate.");
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

function deleteCookie(nome) {
    document.cookie = nome + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}