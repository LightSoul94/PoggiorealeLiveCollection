// main.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import {
  getFirestore,
  onSnapshot,
  collection,
  doc,
  updateDoc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

import { containsChord, transposeChord } from "/js/transposeUtils.js";

// metronomo
import {
  toggleMetronome,
  toggleMetronomeInEditing,
  refreshEditingMetronomeParams
} from "/js/metronome.js";

// tasto per download backup
import { downloadBackupJSON } from "/js/downloadBackup.js";

// tasto per caricare backup
import { wireImportUI } from "/js/importBackup.js";



window.toggleMetronome = toggleMetronome;
window.toggleMetronomeInEditing = toggleMetronomeInEditing;
window.refreshEditingMetronomeParams = refreshEditingMetronomeParams;

// ========================
// CONFIG / GLOBALS
// ========================
const idCliente = "POGGIOREALE";
let db = null;

let isSyncActive = true;
let isRemoteSearchUpdate = false;
let isTypingSearch = false;
let timerCronologiaRicerca = null;

// stato corrente UI / sync
let currentSelectedRaccolta = null;
let currentSearchQuery = "";
let currentFlgWordSearch = false;

// trasposizione locale (per UI)
let transposeValues = {};

// listener cleanup
let unsubscribeCliente = null;
let unsubscribeSongsCollection = null; // opzionale (se un giorno vuoi usare onSnapshot sulla collection)
let songUnsubMap = new Map(); // songId -> unsubscribe

// ========================
// SYNC TOGGLE
// ========================
window.toggleSync = async function () {
  isSyncActive = !isSyncActive;

  if (isSyncActive) {
    $("#syncIcon").attr("class", "bi bi-cloud ms-2");
    $("#syncText").text("Live Sync Attiva");
  } else {
    $("#syncIcon").attr("class", "bi bi-cloud-slash ms-2");
    $("#syncText").text("Live Sync Disattiva");
  }
};

// ========================
// INIT FIREBASE
// ========================
async function initializeFirebase() {
  try {
    const response = await fetch("config.json");
    if (!response.ok) throw new Error("Errore nel caricamento del file di configurazione");

    const configurator = await response.json();
    const firebaseConfig = configurator["firebaseDB"];
    if (!firebaseConfig) {
      throw new Error("Errore: Firebase config mancante (configurator['firebaseDB']).");
    }

    // const app = initializeApp(firebaseConfig);
    // db = getFirestore(app);

    // // eventi UI
    // wireSearchUI();

    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);

    // eventi UI
    wireSearchUI();
    // wireImportUI({ bootstrapFromClienteDoc }); // ✅ QUI
    // tasto per caricare backup
    wireImportUI({ db, idCliente, bootstrapFromClienteDoc });


    // Apri menu di esportazione / importazione
    $('#exportMenu').on('click', function () {
      Swal.fire({
        title: 'Gestione dati',
        html: `
              <div class="d-grid gap-2 mt-3">

                  <!-- EXPORT -->
                  <button id="swal-export-pdf" class="btn btn-outline-danger">
                      <i class="fa fa-file-pdf me-2"></i> Esporta PDF
                  </button>

                  <button id="swal-export-json" class="btn btn-outline-primary">
                      <i class="bi bi-download me-2"></i> Scarica Backup JSON
                  </button>

                  <!-- DIVIDER -->
                  <hr class="my-3">

                  <!-- IMPORT -->
                  <button id="swal-import-json" class="btn btn-outline-success">
                      <i class="bi bi-upload me-2"></i> Importa Backup JSON
                  </button>

                  <small class="text-muted text-start">
                      ⚠️ L’import sovrascriverà i dati esistenti nella destinazione selezionata.
                  </small>
              </div>
          `,
        showConfirmButton: false,
        showCancelButton: true,
        cancelButtonText: 'Chiudi',
        didOpen: () => {

          // EXPORT PDF
          document.getElementById('swal-export-pdf')
            .addEventListener('click', () => {
              Swal.close();
              exportToPDF();
            });

          // EXPORT JSON
          document.getElementById('swal-export-json')
            .addEventListener('click', () => {
              Swal.close();
              downloadBackupJSON({ db, idCliente });
            });

          // IMPORT JSON
          document.getElementById('swal-import-json')
            .addEventListener('click', () => {
              Swal.close();
              // $('#importBackupFile').val('');
              // $('#importBackupFile').trigger('click');
              const input = document.getElementById('importBackupFile');
              input.value = '';
              input.click();
            });
        }
      });
    });



    // export PDF
    window.exportToPDF = function () {
      Swal.fire({
        title: "Esportazione in corso...",
        html: "Attendi mentre stiamo generando il PDF.",
        allowOutsideClick: false,
        didOpen: () => Swal.showLoading()
      });
      generatePDF().catch((e) => {
        console.error(e);
        Swal.fire("Errore", "Errore durante la generazione del PDF.", "error");
      });
    };

    // indice
    wireIndexUI();

    // auth admin
    wireAdminAuth();

    // bootstrap iniziale + listener realtime
    await bootstrapFromClienteDoc();
    startClienteRealtime();

  } catch (error) {
    console.error("Errore initializeFirebase:", error);
    Swal.fire("Errore", String(error?.message || error), "error");
  }
}

// ========================
// BOOTSTRAP (carica stato iniziale)
// ========================
async function bootstrapFromClienteDoc() {
  const clienteRef = doc(db, "Clienti", idCliente);
  const snap = await getDoc(clienteRef);

  if (!snap.exists()) {
    Swal.fire("Errore", "Il documento cliente non esiste.", "error");
    return;
  }

  const data = snap.data() || {};
  const settings = data.settings || {};

  // garantisci settings minimi (senza rompere nulla se mancano)
  const patch = {};
  if (!data.settings) patch["settings"] = {};
  if (settings.query == null) patch["settings.query"] = "";
  if (settings.flgWordSearch == null) patch["settings.flgWordSearch"] = false;
  if (settings.raccoltaSelezionata == null) patch["settings.raccoltaSelezionata"] = (data.raccolte?.[0] ?? "-");

  if (Object.keys(patch).length) {
    await updateDoc(clienteRef, patch).catch(() => { /* ignora */ });
  }

  // ricarica dopo eventuale patch
  const snap2 = await getDoc(clienteRef);
  const data2 = snap2.data() || {};
  const settings2 = data2.settings || {};

  currentSelectedRaccolta = settings2.raccoltaSelezionata || (data2.raccolte?.[0] ?? "-");
  currentSearchQuery = String(settings2.query || "").toLowerCase().trim();
  currentFlgWordSearch = !!settings2.flgWordSearch;

  // UI: search + checkbox
  isRemoteSearchUpdate = true;
  $("#search-bar").val(currentSearchQuery);
  $("#wordSearch").prop("checked", currentFlgWordSearch);
  isRemoteSearchUpdate = false;

  // UI: raccolte
  renderRaccolteButtons(data2.raccolte || [], currentSelectedRaccolta);

  // carica brani raccolta selezionata
  if (currentSelectedRaccolta && currentSelectedRaccolta !== "-") {
    await loadCollectionSongs(currentSelectedRaccolta);
    filterSongs(currentSearchQuery, currentSelectedRaccolta.toLowerCase());
  }
}

// ========================
// REALTIME: DOC CLIENTE (UNICO LISTENER)
// ========================
function startClienteRealtime() {
  const clienteRef = doc(db, "Clienti", idCliente);

  if (unsubscribeCliente) unsubscribeCliente();
  unsubscribeCliente = onSnapshot(clienteRef, async (snap) => {
    if (!snap.exists()) return;

    const data = snap.data() || {};
    const settings = data.settings || {};

    const newRaccolte = data.raccolte || [];
    const newSelected = settings.raccoltaSelezionata || (newRaccolte[0] ?? "-");
    const newQuery = String(settings.query || "").toLowerCase().trim();
    const newWord = !!settings.flgWordSearch;

    // 1) aggiorna bottoni raccolte sempre se cambia lista o selezione
    renderRaccolteButtons(newRaccolte, newSelected);

    // 2) aggiorna search + checkbox (senza triggerare scrittura)
    // if (newQuery !== currentSearchQuery) {
    //   currentSearchQuery = newQuery;
    //   isRemoteSearchUpdate = true;
    //   $("#search-bar").val(newQuery);
    //   isRemoteSearchUpdate = false;
    // }

    if (newQuery !== currentSearchQuery) {
      currentSearchQuery = newQuery;

      // NON sovrascrivere mentre l'utente sta scrivendo
      if (!isTypingSearch) {
        isRemoteSearchUpdate = true;

        const input = $("#search-bar");

        // aggiorna solo se realmente diverso
        if (input.val() !== newQuery) {
          input.val(newQuery);
        }

        isRemoteSearchUpdate = false;
      }
    }

    if (newWord !== currentFlgWordSearch) {
      currentFlgWordSearch = newWord;
      $("#wordSearch").prop("checked", newWord);
    }

    // 3) se cambia raccolta selezionata, ricarica i brani (questo è il punto chiave)
    if (newSelected !== currentSelectedRaccolta) {
      currentSelectedRaccolta = newSelected;
      if (newSelected && newSelected !== "-") {
        await loadCollectionSongs(newSelected);
      }
    }

    // 4) applica filtro sempre (ma usando raccolta selezionata)
    if (currentSelectedRaccolta && currentSelectedRaccolta !== "-") {
      filterSongs(currentSearchQuery, currentSelectedRaccolta.toLowerCase());
    }

  }, (err) => {
    console.error("onSnapshot clienteRef error:", err);
    Swal.fire("Errore", "Realtime cliente fallito: " + err.message, "error");
  });
}

// ========================
// UI: RENDER RACCOLTE
// ========================
function renderRaccolteButtons(raccolte, selected) {
  if (!Array.isArray(raccolte) || raccolte.length === 0) return;

  const $group = $("#raccolte-btnGroup");

  $group.empty();

  [...raccolte].sort().forEach((nomeRaccolta) => {
    const isActive = nomeRaccolta === selected;

    const $btn = $("<button/>", {
      type: "button",
      class: `btn btn-custom me-0 mb-0 ${isActive ? "active" : ""}`,
      text: nomeRaccolta
    });

    $btn.on("click", async function () {
      $("#raccolte-btnGroup .btn").removeClass("active");
      $(this).addClass("active");

      // aggiorna selezione su firestore se sync on
      await aggiornaRaccoltaSelezionata(nomeRaccolta);

      // carica brani subito in locale (anche se sync off)
      currentSelectedRaccolta = nomeRaccolta;
      await loadCollectionSongs(nomeRaccolta);

      // rifiltra in base alla query corrente
      const q = String($("#search-bar").val() || "").toLowerCase().trim();
      filterSongs(q, nomeRaccolta.toLowerCase());
    });

    $group.append($btn);
  });

  // hook: menu raccolta su doppio click / contextmenu
  wireCollectionGesture();
}

// ========================
// COLLECTION ACTION GESTURE
// ========================
function wireCollectionGesture() {
  // evita doppio bind
  $("#raccolte-btnGroup").off("click contextmenu", ".btn");

  let clickCounter = 0;
  let lastClickedText = "";

  $("#raccolte-btnGroup").on("click contextmenu", ".btn", async function (e) {
    e.preventDefault();

    const $btn = $(this);
    const currentText = $btn.text().trim();

    // procede solo sulla raccolta attiva
    if (!$btn.hasClass("active")) {
      clickCounter = 0;
      lastClickedText = "";
      return;
    }

    if (currentText === lastClickedText) {
      clickCounter++;

      if (clickCounter >= 2) {
        clickCounter = 0;
        lastClickedText = "";
        await menuRaccolta(currentText);
      }
    } else {
      clickCounter = 1;
      lastClickedText = currentText;
    }
  });
}

// ========================
// COLLECTION ACTION MENU
// ========================
async function menuRaccolta(nomeRaccolta) {

  const html = `
    <div class="d-flex flex-column gap-2">
      <button type="button" class="btn btn-outline-primary action-btn mb-2" data-action="rename">
        ✏️ Rinomina raccolta
      </button>

      <button type="button" class="btn btn-outline-danger action-btn mb-2" data-action="delete">
        🗑️ Elimina raccolta
      </button>

      <button type="button" class="btn btn-outline-secondary action-btn" data-action="duplicate">
        📄 Duplica raccolta
      </button>
    </div>
  `;

  await Swal.fire({
    title: `Gestisci "${nomeRaccolta}"`,
    html: html,
    showConfirmButton: false,
    showCloseButton: true,
    didOpen: () => {
      const container = Swal.getHtmlContainer();
      if (!container) return;

      container.querySelectorAll(".action-btn").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const action = btn.dataset.action;

          Swal.close();

          await handleCollectionAction(action, nomeRaccolta);
        });
      });
    }
  });
}

// ========================
// COLLECTION ACTION DISPATCHER
// ========================
async function handleCollectionAction(action, nomeRaccolta) {
  switch (action) {
    case "rename":
      await confermaRinominaRaccolta(nomeRaccolta);
      break;

    case "delete":
      await confermaEliminazioneRaccolta(nomeRaccolta);
      break;

    case "duplicate":
      await duplicaRaccolta(nomeRaccolta);
      break;

    default:
      console.warn("Azione non gestita:", action);
      break;
  }
}

// ========================
// ADMIN PASSWORD REQUEST
// ========================
async function richiediPasswordAdmin() {
  try {
    const clienteRef = doc(db, "Clienti", idCliente);
    const clienteSnap = await getDoc(clienteRef);

    if (!clienteSnap.exists()) {
      await Swal.fire("Errore", "Cliente non trovato.", "error");
      return false;
    }

    const dataCliente = clienteSnap.data() || {};
    const settings = dataCliente.settings || {};
    const passSalvata = settings.passEliminazione || "";

    const { isConfirmed } = await Swal.fire({
      title: "Conferma operazione",
      text: "Inserisci la password amministratore",
      icon: "warning",
      input: "password",
      inputPlaceholder: "Inserisci la password",
      showCancelButton: true,
      confirmButtonText: "Conferma",
      cancelButtonText: "Annulla",
      preConfirm: (val) => {
        if (!val) {
          Swal.showValidationMessage("Inserisci la password.");
          return false;
        }

        if (val !== passSalvata) {
          Swal.showValidationMessage("Password errata.");
          return false;
        }

        return true;
      }
    });

    return isConfirmed;
  } catch (err) {
    console.error("Errore nella verifica password admin:", err);
    await Swal.fire("Errore", "Impossibile verificare la password.", "error");
    return false;
  }
}

// ========================
// RENAME COLLECTION
// ========================
async function confermaRinominaRaccolta(nomeRaccolta) {
  const isAdmin = getCookie("isAdmin") === "1";
  if (!isAdmin) return;

  try {
    const okPassword = await richiediPasswordAdmin();
    if (!okPassword) return;

    const clienteRef = doc(db, "Clienti", idCliente);
    const clienteSnap = await getDoc(clienteRef);

    if (!clienteSnap.exists()) {
      await Swal.fire("Errore", "Cliente non trovato.", "error");
      return;
    }

    const dataCliente = clienteSnap.data() || {};
    const raccolteAttuali = dataCliente.raccolte || [];

    const { isConfirmed, value } = await Swal.fire({
      title: "Rinomina raccolta",
      input: "text",
      inputLabel: "Nuovo nome raccolta",
      inputValue: nomeRaccolta,
      inputPlaceholder: "Inserisci il nuovo nome",
      showCancelButton: true,
      confirmButtonText: "Rinomina",
      cancelButtonText: "Annulla",
      inputValidator: (val) => {
        const nuovoNome = String(val || "").trim();

        if (!nuovoNome) {
          return "Inserisci un nome valido.";
        }

        if (nuovoNome === nomeRaccolta) {
          return "Il nuovo nome deve essere diverso da quello attuale.";
        }

        if (raccolteAttuali.includes(nuovoNome)) {
          return "Esiste già una raccolta con questo nome.";
        }

        return null;
      }
    });

    if (!isConfirmed) return;

    const nuovoNome = String(value || "").trim();

    Swal.fire({
      title: "Rinomina in corso...",
      html: "Attendi mentre la raccolta viene rinominata.",
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    await renameCollectionRequest({
      idCliente,
      oldName: nomeRaccolta,
      newName: nuovoNome
    });

    Swal.close();

    await Swal.fire("Fatto!", `La raccolta è stata rinominata in "${nuovoNome}".`, "success");

    currentSelectedRaccolta = nuovoNome;
    await loadCollectionSongs(nuovoNome);

    filterSongs(
      String($("#search-bar").val() || "").toLowerCase().trim(),
      nuovoNome.toLowerCase()
    );

  } catch (err) {
    console.error("Errore nella rinomina raccolta:", err);
    Swal.close();
    await Swal.fire("Errore", err.message || "Si è verificato un errore durante la rinomina.", "error");
  }
}

// ========================
// DUPLICATE COLLECTION
// ========================
async function duplicaRaccolta(nomeRaccolta) {
  const isAdmin = getCookie("isAdmin") === "1";
  if (!isAdmin) return;

  try {
    const okPassword = await richiediPasswordAdmin();
    if (!okPassword) return;

    const clienteRef = doc(db, "Clienti", idCliente);
    const clienteSnap = await getDoc(clienteRef);

    if (!clienteSnap.exists()) {
      await Swal.fire("Errore", "Cliente non trovato.", "error");
      return;
    }

    const dataCliente = clienteSnap.data() || {};
    const raccolteAttuali = dataCliente.raccolte || [];

    const { isConfirmed, value } = await Swal.fire({
      title: "Duplica raccolta",
      input: "text",
      inputLabel: "Nome nuova raccolta",
      inputValue: `${nomeRaccolta} - Copia`,
      inputPlaceholder: "Inserisci il nome della copia",
      showCancelButton: true,
      confirmButtonText: "Duplica",
      cancelButtonText: "Annulla",
      inputValidator: (val) => {
        const nuovoNome = String(val || "").trim();

        if (!nuovoNome) {
          return "Inserisci un nome valido.";
        }

        if (nuovoNome === nomeRaccolta) {
          return "Il nome della copia deve essere diverso da quello originale.";
        }

        if (raccolteAttuali.includes(nuovoNome)) {
          return "Esiste già una raccolta con questo nome.";
        }

        return null;
      }
    });

    if (!isConfirmed) return;

    const nuovoNome = String(value || "").trim();

    Swal.fire({
      title: "Duplicazione in corso...",
      html: "Attendi mentre la raccolta viene duplicata.",
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    await duplicateCollectionRequest({
      idCliente,
      sourceName: nomeRaccolta,
      targetName: nuovoNome
    });

    Swal.close();

    await Swal.fire(
      "Fatto!",
      `La raccolta "${nomeRaccolta}" è stata duplicata in "${nuovoNome}".`,
      "success"
    );

  } catch (err) {
    console.error("Errore nella duplicazione raccolta:", err);
    Swal.close();
    await Swal.fire(
      "Errore",
      err.message || "Si è verificato un errore durante la duplicazione.",
      "error"
    );
  }
}

async function duplicateCollectionRequest({ idCliente, sourceName, targetName }) {
  try {
    console.log("=== DUPLICATE START ===", { idCliente, sourceName, targetName });

    if (!idCliente || !sourceName || !targetName) {
      throw new Error("Parametri duplicazione non validi.");
    }

    const source = String(sourceName).trim();
    const target = String(targetName).trim();

    if (!source || !target) {
      throw new Error("Nome raccolta sorgente o destinazione non valido.");
    }

    if (source === target) {
      throw new Error("Il nome della raccolta duplicata deve essere diverso da quello originale.");
    }

    const clienteRef = doc(db, "Clienti", idCliente);
    const clienteSnap = await getDoc(clienteRef);

    if (!clienteSnap.exists()) {
      throw new Error("Cliente non trovato.");
    }

    const dataCliente = clienteSnap.data() || {};
    const raccolteAttuali = Array.isArray(dataCliente.raccolte) ? dataCliente.raccolte : [];

    if (!raccolteAttuali.includes(source)) {
      throw new Error(`La raccolta sorgente "${source}" non esiste.`);
    }

    if (raccolteAttuali.includes(target)) {
      throw new Error(`Esiste già una raccolta con il nome "${target}".`);
    }

    const sourceRef = collection(db, "Clienti", idCliente, source);
    const targetRef = collection(db, "Clienti", idCliente, target);

    const snapshot = await getDocs(sourceRef);
    console.log("Documenti trovati nella raccolta sorgente:", snapshot.docs.length);

    const batch = writeBatch(db);

    snapshot.docs.forEach((songDoc) => {
      const newDocRef = doc(targetRef, songDoc.id);

      batch.set(newDocRef, {
        ...songDoc.data(),
        ultimaModifica: serverTimestamp()
      });
    });

    batch.update(clienteRef, {
      raccolte: [...raccolteAttuali, target]
    });

    await batch.commit();

    console.log("=== DUPLICATE COMMIT OK ===");
    return true;

  } catch (err) {
    console.error("=== DUPLICATE ERROR ===", err);
    throw err;
  }
}

// ========================
// RENAME REQUEST WRAPPER
// ========================
async function renameCollectionRequest({ idCliente, oldName, newName }) {
  try {
    console.log("=== RENAME START ===", { idCliente, oldName, newName });

    if (!idCliente || !oldName || !newName) {
      throw new Error("Parametri rinomina non validi.");
    }

    const source = String(oldName).trim();
    const target = String(newName).trim();

    if (!source || !target) {
      throw new Error("Nome raccolta vecchio o nuovo non valido.");
    }

    if (source === target) {
      throw new Error("Il nuovo nome deve essere diverso da quello attuale.");
    }

    const clienteRef = doc(db, "Clienti", idCliente);
    const clienteSnap = await getDoc(clienteRef);

    if (!clienteSnap.exists()) {
      throw new Error("Cliente non trovato.");
    }

    const dataCliente = clienteSnap.data() || {};
    const raccolteAttuali = Array.isArray(dataCliente.raccolte) ? dataCliente.raccolte : [];
    const raccoltaSelezionata = dataCliente.settings?.raccoltaSelezionata || "-";

    if (!raccolteAttuali.includes(source)) {
      throw new Error(`La raccolta sorgente "${source}" non esiste.`);
    }

    if (raccolteAttuali.includes(target)) {
      throw new Error(`Esiste già una raccolta con il nome "${target}".`);
    }

    // 1. Duplica la raccolta
    await duplicateCollectionRequest({
      idCliente,
      sourceName: source,
      targetName: target
    });

    console.log("Duplicazione completata con successo.");

    // 2. Elimina tutti i documenti dalla vecchia raccolta
    const sourceRef = collection(db, "Clienti", idCliente, source);
    const snapshot = await getDocs(sourceRef);

    const deleteBatch = writeBatch(db);

    snapshot.docs.forEach((songDoc) => {
      deleteBatch.delete(songDoc.ref);
    });

    // 3. Aggiorna raccolta selezionata se necessario
    if (raccoltaSelezionata === source) {
      deleteBatch.update(clienteRef, {
        "settings.raccoltaSelezionata": target
      });
    }

    await deleteBatch.commit();

    console.log("=== RENAME COMPLETED OK ===");
    return true;

  } catch (err) {
    console.error("=== RENAME ERROR ===", err);
    throw err;
  }
}

// ========================
// DELETE REQUEST WRAPPER
// ========================
async function confermaEliminazioneRaccolta(nomeRaccolta) {
  if ($("#open-auth").is(":hidden")) return;

  try {
    const clienteRef = doc(db, "Clienti", idCliente);
    const clienteSnap = await getDoc(clienteRef);

    if (!clienteSnap.exists()) {
      await Swal.fire("Errore", "Cliente non trovato.", "error");
      return;
    }

    const dataCliente = clienteSnap.data() || {};
    const settings = dataCliente.settings || {};
    const raccolteAttuali = dataCliente.raccolte || [];
    const passSalvata = settings.passEliminazione || "";

    const { isConfirmed } = await Swal.fire({
      title: `Vuoi davvero eliminare la raccolta "${nomeRaccolta}"?`,
      text: "Tutti i brani in questa raccolta saranno cancellati.",
      icon: "warning",
      input: "password",
      inputPlaceholder: "Inserisci la password",
      showCancelButton: true,
      confirmButtonText: "Conferma",
      cancelButtonText: "Annulla",
      preConfirm: (val) => {
        if (!val) return Swal.showValidationMessage("Inserisci la password.");
        if (val !== passSalvata) return Swal.showValidationMessage("Password errata.");
        return true;
      }
    });

    if (!isConfirmed) return;

    // elimina tutti i brani della sottocollezione
    const raccoltaRef = collection(db, "Clienti", idCliente, nomeRaccolta);
    const snapshot = await getDocs(raccoltaRef);
    await Promise.all(snapshot.docs.map((d) => deleteDoc(d.ref)));

    // aggiorna lista raccolte + selezione
    const nuoveRaccolte = raccolteAttuali.filter((r) => r !== nomeRaccolta);
    const nuovaSelezione = nuoveRaccolte.length ? nuoveRaccolte[0] : "-";

    await updateDoc(clienteRef, {
      raccolte: nuoveRaccolte,
      "settings.raccoltaSelezionata": nuovaSelezione
    });

    await Swal.fire("Eliminata!", `La raccolta "${nomeRaccolta}" è stata eliminata.`, "success");

    // ricarica UI
    if (nuovaSelezione !== "-") {
      currentSelectedRaccolta = nuovaSelezione;
      await loadCollectionSongs(nuovaSelezione);
      filterSongs(String($("#search-bar").val() || "").toLowerCase().trim(), nuovaSelezione.toLowerCase());
    } else {
      $("#songs-list").empty();
    }

  } catch (err) {
    console.error("Errore nella cancellazione raccolta:", err);
    await Swal.fire("Errore", "Si è verificato un errore durante la cancellazione della raccolta.", "error");
  }
}

// ========================
// SEARCH UI + SYNC (DEBOUNCE)
// ========================
function wireSearchUI() {
  let searchDebounceTimer = null;
  let lastSearchSent = null;

  $("#search-bar")
    .off("focus blur input")
    .on("focus", function () {
      isTypingSearch = true;
    })
    .on("blur", function () {
      setTimeout(() => {
        isTypingSearch = false;
      }, 200);
    })
    .on("input", function () {
      if (isRemoteSearchUpdate) return;

      isTypingSearch = true;

      const searchQuery = String($(this).val() || "").toLowerCase().trim();
      const selectedRaccolta = ($("#raccolte-btnGroup .btn.active").text() || "").trim().toLowerCase();

      filterSongs(searchQuery, selectedRaccolta);

      clearTimeout(timerCronologiaRicerca);

      timerCronologiaRicerca = setTimeout(async () => {
        isTypingSearch = false;

        if (searchQuery.length >= 2) {
          await salvaCronologiaRicerche(searchQuery);
        }
      }, 1200);

      if (!isSyncActive) return;

      clearTimeout(searchDebounceTimer);

      searchDebounceTimer = setTimeout(async () => {
        if (searchQuery === lastSearchSent) return;

        lastSearchSent = searchQuery;

        try {
          await updateDoc(doc(db, "Clienti", idCliente), {
            "settings.query": searchQuery
          });
        } catch (err) {
          console.error("Errore update settings.query:", err);
        }
      }, 400);
    });

  $("#wordSearch").off("change").on("change", async function () {
    const isWordSearch = $(this).prop("checked");
    const searchQuery = String($("#search-bar").val() || "").toLowerCase().trim();
    const selectedRaccolta = ($("#raccolte-btnGroup .btn.active").text() || "").trim().toLowerCase();

    // rifiltra subito locale
    filterSongs(searchQuery, selectedRaccolta);

    if (!isSyncActive) return;

    try {
      await updateDoc(doc(db, "Clienti", idCliente), {
        "settings.flgWordSearch": isWordSearch
      });
    } catch (err) {
      console.error("Errore update settings.flgWordSearch:", err);
    }
  });

  window.clearSearchBar = async function () {
    const selectedRaccolta = ($("#raccolte-btnGroup .btn.active").text() || "").trim().toLowerCase();

    $("#wordSearch").prop("checked", false);
    $("#search-bar").val("").focus();

    filterSongs("", selectedRaccolta);

    if (!isSyncActive) return;

    try {
      await updateDoc(doc(db, "Clienti", idCliente), {
        "settings.query": "",
        "settings.flgWordSearch": false
      });
    } catch (error) {
      console.error("Errore clearSearchBar:", error);
    }
  };

  //Mostra finestra cronologia ultime 5 ricerche
  $("#open-search-history").off("click").on("click", async function () {
    try {
      const clienteSnap = await getDoc(doc(db, "Clienti", idCliente));
  
      if (!clienteSnap.exists()) return;
  
      const settings = clienteSnap.data()?.settings || {};
      const ultimeRicerche = Array.isArray(settings.ultimeRicerche)
        ? settings.ultimeRicerche
        : [];
  
      if (ultimeRicerche.length === 0) {
        Swal.fire("Cronologia vuota", "Non ci sono ricerche recenti.", "info");
        return;
      }
  
      const html = `
        <div class="list-group text-start">
          ${ultimeRicerche.map(q => `
            <button type="button"
                    class="list-group-item list-group-item-action search-history-item"
                    data-query="${q}">
              <i class="bi bi-clock-history me-2"></i>${q}
            </button>
          `).join("")}
        </div>
      `;
  
      await Swal.fire({
        title: "Ultime ricerche",
        html,
        showConfirmButton: false,
        showCloseButton: true,
        width: "400px",
        didOpen: () => {
          $(".search-history-item").off("click").on("click", function () {
            const query = $(this).data("query");
  
            $("#search-bar").val(query).trigger("input");
            Swal.close();
          });
        }
      });
  
    } catch (error) {
      console.error("Errore apertura cronologia ricerche:", error);
      Swal.fire("Errore", "Impossibile caricare la cronologia.", "error");
    }
  });
}

// ========================
// GESTIONE CRONOLOGIA
// ========================
async function salvaCronologiaRicerche(searchQuery) {
  try {

    const clienteRef = doc(db, "Clienti", idCliente);
    const clienteSnap = await getDoc(clienteRef);

    if (!clienteSnap.exists()) return;

    const data = clienteSnap.data() || {};
    const settings = data.settings || {};

    let ultimeRicerche = Array.isArray(settings.ultimeRicerche)
      ? settings.ultimeRicerche
      : [];

    // pulizia
    searchQuery = String(searchQuery || "").trim().toLowerCase();

    if (!searchQuery) return;

    // rimuove eventuale duplicato
    ultimeRicerche = ultimeRicerche.filter(q => q !== searchQuery);

    // inserisce in cima
    ultimeRicerche.unshift(searchQuery);

    // massimo 5
    ultimeRicerche = ultimeRicerche.slice(0, 5);

    await updateDoc(clienteRef, {
      "settings.ultimeRicerche": ultimeRicerche
    });

  } catch (error) {
    console.error("Errore salvataggio cronologia:", error);
  }
}

// ========================
// LOAD SONGS + LISTENERS (NO LEAK)
// ========================
async function loadCollectionSongs(nomeRaccolta) {
  if (!nomeRaccolta || nomeRaccolta === "-") return;

  // kill vecchi listener per-brano
  cleanupSongListeners();

  const raccoltaRef = collection(db, "Clienti", idCliente, nomeRaccolta);
  const querySnapshot = await getDocs(raccoltaRef);

  const songsArray = querySnapshot.docs.map((d) => {
    const data = d.data() || {};
    return {
      id: d.id,
      tempo: data.tempo,
      bpm: data.bpm,
      numero: data.numero,
      titolo: data.titolo,
      categorie: data.categorie,
      html: data.html,
      transposeValue: Number(data.transVal) || 0,
      dataInserimento: data.dataInserimento ? formatDate(data.dataInserimento.toDate()) : "-",
      ultimaModifica: data.ultimaModifica ? formatDate(data.ultimaModifica.toDate()) : "-"
    };
  });

  if (songsArray.length) songsArray.sort((a, b) => (a.numero ?? 999999) - (b.numero ?? 999999));

  renderSongs(nomeRaccolta, songsArray);

  // realtime per-brano SOLO se sync on (come volevi)
  if (isSyncActive) {
    querySnapshot.forEach((songDoc) => {
      const songId = songDoc.id;
      const songRef = doc(raccoltaRef, songId);

      const unsub = onSnapshot(songRef, (snap) => {
        if (!snap.exists()) {
          $(`#${songId}`).remove();
          songUnsubMap.delete(songId);
          return;
        }

        const updatedData = snap.data() || {};
        const songHTML = updatedData.html ?? "";

        $(`#song-content-${songId}`).html(songHTML);

        const lastEditDate = updatedData.ultimaModifica
          ? updatedData.ultimaModifica.toDate().toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })
          : "-";

        $(`#lastEditLabel-${songId}`).text(`Ultima modifica: ${lastEditDate}`);
        $(`#transpose-value-${songId}`).text(updatedData.transVal || 0);
      });

      songUnsubMap.set(songId, unsub);
    });
  }

  applyAdminVisibility();
}

function cleanupSongListeners() {
  for (const [, unsub] of songUnsubMap.entries()) {
    try { unsub(); } catch { }
  }
  songUnsubMap.clear();
}

function renderSongs(nomeRaccolta, songsArray) {
  let html = "<ul class='list-group'>";

  songsArray.forEach((song) => {
    transposeValues[song.id] = Number(song.transposeValue) || 0;

    html += `
      <li class='list-group-item mb-2 p-0'
          id="${song.id}"
          categorie="${Array.isArray(song.categorie) ? song.categorie.join(" ") : (song.categorie ?? "")}"
          tempo="${song.tempo ?? ""}"
          bpm="${song.bpm ?? ""}"
          titolo="${song.titolo ?? ""}"
          numero="${song.numero ?? ""}"
          dataInserimento="${song.dataInserimento}"
          ultimaModifica="${song.ultimaModifica}"
          raccolta="${nomeRaccolta}">

        <div class="d-flex align-items-center mb-3 p-2 border rounded bg-light" id="song-tempo-${song.id}" style="color: red;">
          <span class="me-4 fs-6 fw-bold color-red">
            <strong>Tempo: ${song.tempo ?? "-"} | BPM: ${song.bpm ?? "-"}</strong>
            <button class="btn btn-outline-primary ms-4 mt-2"
                    onclick="toggleMetronome('${song.id}')"
                    id="metronome-btn-${song.id}">
              ▶️
            </button>
          </span>
        </div>

        <div class="d-flex flex-row" id="div-title-${song.id}">
          <h5 id="title-${song.id}" class="mb-3">
            ${song.numero ?? ""}. ${song.titolo ?? ""}
          </h5>
        </div>

        <div class="d-flex flex-row">
          <div class="col-9 p-1" id="song-content-${song.id}">
            ${song.html ?? ""}
          </div>

          <div class="col-3 p-1 admin" id="editSection-${song.id}" style="display:none">
            <button id="edit-button-${song.id}"
                    class="btn btn-outline-secondary m-0 p-1 col-12 justify-content-center"
                    style="height: 70px;"
                    onclick="editSong('${song.id}')">
              <i class="fa fa-pencil" aria-hidden="true"></i> Modifica
            </button>

            <div class="mt-5" id="transposer-${song.id}">
              <button class="btn btn-outline-secondary m-0 p-3 col-12" onclick="transposeUp2('${song.id}')">+2</button>
              <button class="btn btn-outline-secondary m-0 p-3 col-12" onclick="transposeUp('${song.id}')">+1</button>
              <div class="text-center mt-4 mb-4">
                <span id="transpose-value-${song.id}">${song.transposeValue}</span>
              </div>
              <button class="btn btn-outline-secondary m-0 p-3 col-12" onclick="transposeDown('${song.id}')">-1</button>
              <button class="btn btn-outline-secondary m-0 p-3 col-12" onclick="transposeDown2('${song.id}')">-2</button>
            </div>

            <div class="mt-2">
              <small id="lastEditLabel-${song.id}" class="text-muted">Ultima modifica: ${song.ultimaModifica}</small>
            </div>
          </div>
        </div>
      </li>
    `;
  });

  html += "</ul>";
  $("#songs-list").html(html);
}

// ========================
// UPDATE RACCOLTA SELEZIONATA (SYNC)
// ========================
async function aggiornaRaccoltaSelezionata(nomeRaccolta) {
  if (!isSyncActive) return;

  try {
    await updateDoc(doc(db, "Clienti", idCliente), {
      "settings.raccoltaSelezionata": nomeRaccolta
    });
  } catch (error) {
    console.error("Errore aggiornaRaccoltaSelezionata:", error);
  }
}

// ========================
// TRANSPOSE + UPDATE SONG
// ========================
window.transposeUp2 = function (songId) {
  const q = String($("#search-bar").val() || "").toLowerCase().trim();
  transposeValues[songId] += 2;
  $(`#transpose-value-${songId}`).text(transposeValues[songId]);
  transpose(songId, 2);
  updateSongInFirestore(songId, q);
};

window.transposeUp = function (songId) {
  const q = String($("#search-bar").val() || "").toLowerCase().trim();
  transposeValues[songId] += 1;
  $(`#transpose-value-${songId}`).text(transposeValues[songId]);
  transpose(songId, 1);
  updateSongInFirestore(songId, q);
};

window.transposeDown = function (songId) {
  const q = String($("#search-bar").val() || "").toLowerCase().trim();
  transposeValues[songId] -= 1;
  $(`#transpose-value-${songId}`).text(transposeValues[songId]);
  transpose(songId, -1);
  updateSongInFirestore(songId, q);
};

window.transposeDown2 = function (songId) {
  const q = String($("#search-bar").val() || "").toLowerCase().trim();
  transposeValues[songId] -= 2;
  $(`#transpose-value-${songId}`).text(transposeValues[songId]);
  transpose(songId, -2);
  updateSongInFirestore(songId, q);
};

function transpose(songId, semitone) {
  const $div = $(`#song-content-${songId}`);
  const html = $div.html();
  const transposed = transposeChords(html, semitone);
  $div.html(transposed);
  $div.find("span.chord").css("color", "red");
}

async function updateSongInFirestore(songId, currentSearchQuery) {
  const $song = $(`#${songId}`);
  const raccoltaSelezionata = $song.attr("raccolta");
  const updatedContent = $(`#song-content-${songId}`).html();
  const currentDate = new Date();

  if (!isSyncActive) {
    // applica filtro locale comunque
    filterSongs(currentSearchQuery, (raccoltaSelezionata || "").toLowerCase());
    return;
  }

  try {
    const clienteRef = doc(db, "Clienti", idCliente);
    const raccoltaRef = collection(clienteRef, raccoltaSelezionata);
    const songDocRef = doc(raccoltaRef, songId);

    const snap = await getDoc(songDocRef);
    if (!snap.exists()) {
      Swal.fire({ icon: "error", title: "Oops...", text: "Non è stato trovato questo brano" });
      return;
    }

    const transpositionValue = Number($(`#transpose-value-${songId}`).text() || 0);

    await updateDoc(songDocRef, {
      html: updatedContent,
      transVal: transpositionValue,
      ultimaModifica: Timestamp.fromDate(currentDate)
    });

    filterSongs(currentSearchQuery, (raccoltaSelezionata || "").toLowerCase());

  } catch (error) {
    console.error("Errore updateSongInFirestore:", error);
    Swal.fire("Errore!", "Non è stato possibile aggiornare il brano: " + error.message, "error");
  }
}

// ========================
// FILTER SONGS
// ========================
function filterSongs(searchQuery, selectedRaccolta) {
  const q = String(searchQuery || "").toLowerCase();
  const selected = (selectedRaccolta || ($("#raccolte-btnGroup .btn.active").text() || "")).trim().toLowerCase();
  const isWordSearch = $("#wordSearch").is(":checked");

  $(".list-group-item").each(function () {
    const numero = String($(this).attr("numero") || "").toLowerCase();
    const titolo = String($(this).attr("titolo") || "").toLowerCase();
    const categorie = String($(this).attr("categorie") || "").toLowerCase();
    const raccolta = String($(this).attr("raccolta") || "").toLowerCase();
    const parole = $(this).text().toLowerCase();

    // vincolo raccolta
    if (selected && selected !== raccolta) {
      $(this).hide();
      return;
    }

    // ricerca
    if (!q) {
      $(this).show();
      return;
    }

    if (isWordSearch) {
      $(this).toggle(parole.includes(q));
      return;
    }

    const label = `${numero}. ${titolo}`;
    const ok = label.includes(q) || titolo.includes(q) || categorie.includes(q);
    $(this).toggle(ok);
  });
}

// ========================
// TRANSPOSE CHORDS INSIDE |...|
// ========================
function transposeChords(html, semitone) {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;

  // escludi eventuali h5 (sicurezza)
  tempDiv.querySelectorAll("h5").forEach((h) => h.remove());

  const elements = tempDiv.querySelectorAll("*");
  elements.forEach((el) => {
    el.innerHTML = el.innerHTML.replace(/\|([^|]+)\|/g, (match, chordText) => {
      const chord = chordText.trim();
      if (containsChord(chord)) {
        const transposedChord = transposeChord(chord, semitone);
        return `<span class="chord" style="color: red;">|${transposedChord}|</span>`;
      }
      return match;
    });
  });

  return tempDiv.innerHTML;
}

// ========================
// ADMIN VISIBILITY
// ========================
function applyAdminVisibility() {
  const adminCookie = getCookie("isAdmin");
  if (adminCookie === "1") {
    $(".admin").show();
    $("#open-auth").css("opacity", "0");
  } else {
    $(".admin").hide();
  }
}

// ========================
// EDIT SONG
// ========================
window.editSong = async function (songId) {
  const $li = $(`#${songId}`);
  if ($li.data("edit-mode")) return;
  $li.data("edit-mode", true);

  // dati base
  const raccoltaSelezionata = $li.attr("raccolta") || "";
  const tempo = $li.attr("tempo") || "";
  const bpm = $li.attr("bpm") || "";
  const dataInserimento = $li.attr("datainserimento") ?? "-";
  const lastEdit = $li.attr("ultimamodifica") ?? "-";

  const interoTitolo = $(`#title-${songId}`).text().trim();
  const [numero, titolo] = interoTitolo.split(". ", 2);

  const $row = $li.find("> .d-flex.flex-row").last();
  const $content = $(`#song-content-${songId}`);
  const $admin = $row.find(".admin");

  // layout
  $content.removeClass("col-9").addClass("p-1 col-8");
  $admin.addClass("col-3");

  if (!$content.data("backup")) $content.data("backup", $content.html());

  $(`#div-title-${songId}`).remove();
  $(`#song-tempo-${songId}`).remove();

  const headerHtml = `
    <div class="song-edit-header ms-2 me-2">
      <div class="d-flex justify-content-end mt-3">
        <button class="btn btn-outline-danger" onclick="deleteSong('${songId}')">Elimina</button>
      </div>

      <label for="song-collection">Seleziona una raccolta:</label>
      <select id="song-collection" class="form-control mb-3">
        <option value="" selected disabled>Seleziona una raccolta</option>
        <option value="new">Crea nuova raccolta</option>
      </select>

      <div class="form-group mb-3">
        <label for="song-category">Categorie:</label>
        <input type="text" id="song-category" class="form-control" placeholder="virgola o TAB per separare">
      </div>

      <div class="d-flex mb-3 align-items-end">
        <div class="form-group me-3">
          <label for="song-tempo-edit-${songId}">Tempo:</label>
          <select id="song-tempo-edit-${songId}" class="form-control">
            <option value="2/4">2/4</option>
            <option value="3/4">3/4</option>
            <option value="4/4">4/4</option>
            <option value="6/8">6/8</option>
          </select>
        </div>

        <div class="form-group me-3">
          <label for="bpm-${songId}">BPM:</label>
          <input id="bpm-${songId}" class="form-control" type="number" min="40" max="300" value="${bpm}">
        </div>

        <button class="btn btn-outline-primary"
          onclick="toggleMetronomeInEditing({
            songId: '${songId}',
            bpm: ${Number(bpm || 0)},
            tempo: '${tempo || "0/0"}',
            tempoBar: null,
            btn: this
          })"
          id="metronome-btn-${songId}">
          ▶️
        </button>
      </div>

      <div class="d-flex mb-2">
        <div class="form-group me-3">
          <input id="numero-${songId}" class="form-control" type="number" min="1" placeholder="N." value="${numero || ""}">
        </div>
        <div class="form-group flex-grow-1">
          <input id="titolo-${songId}" class="form-control" type="text" placeholder="Titolo" value="${titolo || interoTitolo}">
        </div>
      </div>

      <div class="d-flex align-items-center gap-2 mt-3 mb-2 flex-wrap" id="format-toolbar-${songId}">
        <div class="btn-group me-2" role="group">
          <button type="button" class="btn btn-outline-secondary btn-sm" data-cmd="bold"><b>B</b></button>
          <button type="button" class="btn btn-outline-secondary btn-sm" data-cmd="italic"><i>I</i></button>
          <button type="button" class="btn btn-outline-secondary btn-sm" data-cmd="underline"><u>U</u></button>
        </div>
        <div class="d-flex align-items-center me-2">
          <label class="me-1 mb-0 small">Dimensione</label>
          <select class="form-select form-select-sm" id="font-size-${songId}" style="width:auto">
            <option value="8px">8</option>
            <option value="12px">12</option>
            <option value="14px">14</option>
            <option value="16px">16</option>
            <option value="18px">18</option>
            <option value="20px">20</option>
            <option value="24px">24</option>
          </select>
        </div>
        <div class="d-flex align-items-center">
          <label class="me-1 mb-0 small">Color</label>
          <input type="color" id="font-color-${songId}" class="p-1" value="#000000">
        </div>
      </div>
    </div>
  `;

  $li.find(".song-edit-header").remove();
  $li.prepend(headerHtml);

  $content.attr({ contenteditable: "true", spellcheck: "false" }).addClass("editable-area");

  if (!document.getElementById("edit-style")) {
    const style = document.createElement("style");
    style.id = "edit-style";
    style.textContent = `
      .editable-area[contenteditable="true"] {
        border: 2px dashed #9aa0a6;
        border-radius: .5rem;
        background: #fff;
        padding: 1rem;
        min-height: 220px;
        outline: none;
      }
      .editable-area:focus { border-color: #0d6efd; }
    `;
    document.head.appendChild(style);
  }

  const footerHtml = `
    <div class="song-edit-footer mt-2">
      <div class="d-flex justify-content-end mt-3 col-11">
        <button class="btn btn-success me-2 mb-0" onclick="saveSong('${songId}')">Salva</button>
        <button class="btn btn-secondary mb-0" onclick="cancelEdit('${songId}')">Annulla</button>
      </div>
      <div>
        <small class="text-muted">Data inserimento: ${dataInserimento}</small><br>
        <small class="text-muted">Ultima modifica: ${lastEdit}</small>
      </div>
    </div>
  `;
  $li.find(".song-edit-footer").remove();
  $li.append(footerHtml);

  await loadAllCollections();
  $("#song-collection").val(raccoltaSelezionata);
  $(`#song-tempo-edit-${songId}`).val(tempo);

  initializeTagify(songId);

  // UX: enter/paste plain
  $content.off("keydown").on("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertLineBreak"); }
  });
  $content.off("paste").on("paste", (e) => {
    e.preventDefault();
    const t = (e.originalEvent || e).clipboardData.getData("text/plain");
    document.execCommand("insertText", false, t);
  });

  // toolbar
  let lastRange = null;

  const saveSelection = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if ($content[0].contains(range.commonAncestorContainer)) {
      lastRange = range.cloneRange();
    }
  };

  const restoreSelection = () => {
    if (!lastRange) return false;
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(lastRange);
    return true;
  };

  function mergeAdjacentStyledSpans(node) {
    const prev = node.previousSibling;
    const next = node.nextSibling;
    const sameStyle = (a, b) =>
      a && b && a.nodeType === 1 && b.nodeType === 1 &&
      a.tagName === "SPAN" && b.tagName === "SPAN" &&
      a.getAttribute("style") === b.getAttribute("style");

    if (sameStyle(prev, node)) {
      while (node.firstChild) prev.appendChild(node.firstChild);
      node.remove();
      return mergeAdjacentStyledSpans(prev);
    }
    if (sameStyle(node, next)) {
      while (next.firstChild) node.appendChild(next.firstChild);
      next.remove();
      return mergeAdjacentStyledSpans(node);
    }
  }

  function applyInlineStyle(styleObj) {
    if (!restoreSelection()) { $content.focus(); return; }
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;

    const frag = range.extractContents();
    const span = document.createElement("span");
    Object.assign(span.style, styleObj);
    span.appendChild(frag);
    range.insertNode(span);

    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
    saveSelection();
    mergeAdjacentStyledSpans(span);
  }

  function applyColor(color) {
    if (!restoreSelection()) { $content.focus(); return; }
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return;

    const frag = range.extractContents();
    const walker = document.createTreeWalker(frag, NodeFilter.SHOW_ELEMENT, null);
    let node;
    while ((node = walker.nextNode())) {
      if (node.style) node.style.color = "";
      if (node.hasAttribute?.("color")) node.removeAttribute("color");
    }

    const span = document.createElement("span");
    span.style.color = color;
    span.appendChild(frag);
    range.insertNode(span);

    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
    saveSelection();
    mergeAdjacentStyledSpans(span);
  }

  $content.on("mouseup keyup", saveSelection);

  $(`#format-toolbar-${songId} [data-cmd]`).off("click").on("click", function () {
    if (!restoreSelection()) $content.focus();
    document.execCommand("styleWithCSS", true);
    document.execCommand($(this).data("cmd"), false, null);
    saveSelection();
    $content.trigger("focus");
  });

  $(`#font-size-${songId}`).off("change").on("change", function () {
    const val = $(this).val();
    if (!val) return;
    applyInlineStyle({ fontSize: val });
  });

  $(`#font-color-${songId}`).off("input").on("input", function () {
    applyColor($(this).val());
  });
};

// ✅ UNA SOLA cancelEdit (NO DUPLICATI)
window.cancelEdit = function (songId) {
  const $li = $(`#${songId}`);
  const $content = $(`#song-content-${songId}`);

  const backup = $content.data("backup");
  if (backup != null) $content.html(backup);

  $content.removeAttr("contenteditable spellcheck")
    .removeClass("editable-area p-1 col-8")
    .addClass("col-9");

  $li.find(".song-edit-header").remove();
  $li.find(".song-edit-footer").remove();

  $li.removeData("edit-mode");
};

// ========================
// LOAD ALL COLLECTIONS (per select edit)
// ========================
async function loadAllCollections() {
  const clienteRef = doc(db, "Clienti", idCliente);
  const snap = await getDoc(clienteRef);

  const raccolte = (snap.exists() ? snap.data().raccolte : []) || [];
  const $select = $("#song-collection");
  $select.find("option:not([value='']):not([value='new'])").remove();

  raccolte.forEach((r) => {
    $select.append(new Option(r, r));
  });

  $select.off("change").on("change", function () {
    if ($(this).val() === "new") {
      Swal.fire({
        title: "Aggiungi nuova raccolta",
        input: "text",
        inputLabel: "Nome nuova raccolta",
        inputPlaceholder: "Inserisci il nome della nuova raccolta",
        showCancelButton: true,
        confirmButtonText: "Aggiungi",
        cancelButtonText: "Annulla",
        inputValidator: (value) => !value ? "Devi inserire un nome per la raccolta!" : null
      }).then((result) => {
        if (result.isConfirmed) {
          const nuova = result.value.trim();
          $select.append(new Option(nuova, nuova));
          $select.val(nuova);
        } else {
          $select.val("");
        }
      });
    }
  });
}

// ========================
// TAGIFY
// ========================
async function initializeTagify(songId) {
  const input = document.querySelector("#song-category");
  const tagify = new Tagify(input);

  const raw = $(`#${songId}`).attr("categorie") || "";
  const categorieArray = raw.split(/\s+/).filter(Boolean);
  tagify.addTags(categorieArray);

  tagify.on("add", onTagChange);
  tagify.on("remove", onTagChange);

  function onTagChange() {
    window.categorie = tagify.value.map((t) => t.value);
  }
}

// ========================
// SAVE SONG
// ========================
window.saveSong = async function (songId) {
  const raccoltaSelezionata = $("#song-collection").val();
  const raccoltaPrecedente = $(`#${songId}`).attr("raccolta");

  const categorie = [];
  $(".tagify__tag-text").each(function () { categorie.push($(this).text()); });

  const tempo = $(`#song-tempo-edit-${songId}`).val();
  const bpm = parseInt($(`#bpm-${songId}`).val(), 10);
  const transVal = parseInt($(`#transpose-value-${songId}`).text(), 10);
  const number = parseInt($(`#numero-${songId}`).val(), 10);
  const title = $(`#titolo-${songId}`).val();
  const songHTML = $(`#song-content-${songId}`).html();

  if (!songHTML?.trim() || !title?.trim() || !tempo || !bpm || !number || categorie.length === 0 || !raccoltaSelezionata) {
    Swal.fire({ icon: "warning", title: "Attenzione", text: "Tutti i campi devono essere compilati prima di salvare il brano!" });
    return;
  }

  try {
    const clienteRef = doc(db, "Clienti", idCliente);
    const currentDate = new Date();

    const nuovaRaccoltaRef = collection(clienteRef, raccoltaSelezionata);
    const songDocRef = doc(nuovaRaccoltaRef, songId);

    // se cambio raccolta: copia in nuova e cancella da vecchia
    if (raccoltaPrecedente && raccoltaPrecedente !== raccoltaSelezionata) {
      const oldRef = doc(clienteRef, `${raccoltaPrecedente}`, songId);
      await deleteDoc(oldRef).catch(() => { /* ignora */ });
    }

    // conserva data inserimento se esistente
    const snap = await getDoc(songDocRef);
    const dataInserimento = snap.exists() ? snap.data().dataInserimento : Timestamp.fromDate(currentDate);

    await setDoc(songDocRef, {
      tempo,
      bpm,
      numero: number,
      titolo: title,
      html: songHTML,
      transVal,
      ultimaModifica: Timestamp.fromDate(currentDate),
      categorie,
      dataInserimento
    });

    // set raccolta selezionata (sync)
    await updateDoc(clienteRef, {
      "settings.raccoltaSelezionata": raccoltaSelezionata
    });

    $("#exportSongs").show();

    // ricarica vista raccolta selezionata
    currentSelectedRaccolta = raccoltaSelezionata;
    await loadCollectionSongs(raccoltaSelezionata);

    // riapplica filtro
    const q = String($("#search-bar").val() || "").toLowerCase().trim();
    filterSongs(q, raccoltaSelezionata.toLowerCase());

  } catch (error) {
    console.error("Errore saveSong:", error);
    Swal.fire({ icon: "error", title: "Errore", text: "Si è verificato un errore durante il salvataggio del brano." });
  }
};

// ========================
// DELETE SONG
// ========================
window.deleteSong = async function (songId) {
  try {
    const raccoltaSelezionata = $(`#${songId}`).attr("raccolta");

    const result = await Swal.fire({
      title: "Sei sicuro?",
      text: "Questa operazione non può essere annullata!",
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#3085d6",
      cancelButtonColor: "#d33",
      confirmButtonText: "Sì, elimina!",
      cancelButtonText: "Annulla"
    });

    if (!result.isConfirmed) return;

    const clienteRef = doc(db, "Clienti", idCliente);
    const raccoltaRef = collection(db, "Clienti", idCliente, raccoltaSelezionata);

    await deleteDoc(doc(raccoltaRef, songId));

    // se raccolta rimasta vuota => rimuovila dall'array "raccolte"
    const updated = await getDocs(raccoltaRef);
    if (updated.empty) {
      const snapCliente = await getDoc(clienteRef);
      const data = snapCliente.data() || {};
      const list = (data.raccolte || []).filter((x) => x !== raccoltaSelezionata);

      await updateDoc(clienteRef, {
        raccolte: list,
        "settings.raccoltaSelezionata": list[0] ?? "-"
      });

      Swal.fire({ icon: "info", title: "Raccolta vuota", text: "La raccolta è stata rimossa perché vuota." });
    }

    // esci da edit
    window.cancelEdit(songId);

  } catch (error) {
    console.error("Errore deleteSong:", error);
    Swal.fire("Errore", "Si è verificato un errore durante l'eliminazione del brano.", "error");
  }
};

// ========================
// EXPORT PDF (la tua logica, invariata)
// ========================
async function generatePDF() {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF();

  const element = document.getElementById("songs-list");
  const $element = $(element);

  if (!element) {
    Swal.fire("Errore", "Non è stato trovato nessun contenuto per generare il PDF.", "error");
    return;
  }

  const songsArray = [];
  $element.find(".list-group-item:visible").each(function () {
    const categorie = $(this).attr("categorie") || "Generica";
    const titolo = $(this).attr("titolo") || "Senza Titolo";
    const numero = $(this).attr("numero") || "0";

    const contenuto = $(this).find(`#song-content-${$(this).attr("id")} p`).map(function () {
      let htmlContent = $(this).html();
      htmlContent = htmlContent.replace(/<br\s*\/?>/gi, "\n");
      htmlContent = htmlContent.replace(/&nbsp;/gi, " ");
      htmlContent = htmlContent.replace(/<\/?span[^>]*>/gi, "");
      htmlContent = htmlContent.replace(/<strong>(.*?)<\/strong>/gi, (_m, content) => `*${content.trim()}*`);
      return htmlContent.trim();
    }).get().join("\n");

    songsArray.push({ categorie, titolo, numero, contenuto });
  });

  let y = 20;

  songsArray.forEach((song, index) => {
    if (index > 0) {
      pdf.addPage();
      y = 20;
    }

    pdf.setFontSize(16);
    pdf.setTextColor(0, 0, 0);
    pdf.text(`${song.numero}. ${song.titolo}`, 10, y);
    y += 15;

    pdf.setFontSize(12);
    const lines = song.contenuto.split("\n");

    lines.forEach((line) => {
      const parts = line.split(/(\|.*?\||\*.*?\*)/);
      let x = 10;

      parts.forEach((part) => {
        if (part.startsWith("|") && part.endsWith("|")) {
          pdf.setTextColor(237, 0, 0);
          pdf.setFont("helvetica", "normal");
        } else if (part.startsWith("*") && part.endsWith("*")) {
          pdf.setTextColor(0, 0, 0);
          pdf.setFont("helvetica", "bold");
          part = part.replace(/\*/g, "");
        } else {
          pdf.setTextColor(0, 0, 0);
          pdf.setFont("helvetica", "normal");
        }

        const clean = part.trim();
        if (clean) {
          pdf.text(clean, x, y);
          x += pdf.getTextWidth(clean) + 2;
        }
      });

      y += 8;
      if (y > 280) {
        pdf.addPage();
        y = 20;
      }
    });

    y += 10;
  });

  pdf.insertPage(1);
  pdf.setPage(1);
  pdf.setFontSize(14);
  pdf.text("Indice", 10, 10);
  pdf.setFontSize(10);

  y = 20;

  const indice = {};
  songsArray.forEach((song) => {
    if (!indice[song.categorie]) indice[song.categorie] = [];
    indice[song.categorie].push(`${song.numero}. ${song.titolo}`);
  });

  Object.keys(indice).forEach((cat) => {
    pdf.text(cat, 10, y);
    y += 6;

    if (y > 280) {
      pdf.addPage();
      y = 20;
    }

    indice[cat].forEach((t) => {
      pdf.text(`- ${t}`, 20, y);
      y += 6;

      if (y > 280) {
        pdf.addPage();
        y = 20;
      }
    });
  });

  pdf.save("raccolta_poggioreale.pdf");
  Swal.close();
}

// ========================
// INDICE UI (la tua logica, con dedupe)
// ========================
function wireIndexUI() {
  $("#open-index").off("click").on("click", async function () {
    try {
      const clienteRef = doc(db, "Clienti", idCliente);
      const clienteSnap = await getDoc(clienteRef);

      if (!clienteSnap.exists()) {
        Swal.fire({ icon: "error", title: "Oops...", text: "Il documento cliente non esiste." });
        return;
      }

      const clienteData = clienteSnap.data();
      const raccoltaSelezionata = clienteData.settings?.raccoltaSelezionata;

      if (!raccoltaSelezionata || raccoltaSelezionata === "-") {
        Swal.fire({ icon: "error", title: "Oops...", text: "Nessuna raccolta selezionata." });
        return;
      }

      const raccoltaRef = collection(db, "Clienti", idCliente, raccoltaSelezionata);
      const querySnapshot = await getDocs(raccoltaRef);

      if (querySnapshot.empty) {
        Swal.fire({ icon: "error", title: "Oops...", text: "La raccolta selezionata non contiene brani." });
        return;
      }

      let indice = {};
      querySnapshot.forEach((d) => {
        const canzone = d.data() || {};
        const categorieCanzone = canzone.categorie || ["Generica"];
        const titolo = canzone.titolo || "Senza Titolo";
        const numero = canzone.numero ? `${canzone.numero}. ` : "";

        categorieCanzone.forEach((categoria) => {
          if (!indice[categoria]) indice[categoria] = [];
          indice[categoria].push({ titolo, numero });
        });
      });

      Object.keys(indice).forEach((categoria) => {
        indice[categoria].sort((a, b) => a.titolo.localeCompare(b.titolo));
      });

      const creaIndiceHTML = (idx) => {
        let html = `<div class="text-start">`;
        Object.keys(idx).forEach((categoria) => {
          html += `
            <div class="categoria-item">
              <button class="btn btn-link toggle-categoria" data-categoria="${categoria}" style="text-decoration:none;">
                <strong>${categoria}</strong>
              </button>
              <ul id="categoria-list-${categoria}" style="display:none;">`;

          idx[categoria].forEach((c) => {
            html += `<li><a href="#" class="indice-titolo" data-titolo="${c.titolo}" data-numero="${c.numero}">${c.numero}${c.titolo}</a></li>`;
          });

          html += `</ul></div>`;
        });
        html += `</div>`;
        return html;
      };

      let indiceHTML = `
        <div class="btn-group mb-3" role="group">
          <button type="button" class="btn btn-outline-primary m-0 active" id="btn-per-categorie">Per categorie</button>
          <button type="button" class="btn btn-outline-primary m-0" id="btn-ordine-numerico">Ordine Numerico</button>
          <button type="button" class="btn btn-outline-primary m-0" id="btn-ordine-alfabetico">Ordine Alfabetico</button>
        </div>
        <div id="indice-contenuto">${creaIndiceHTML(indice)}</div>
      `;

      Swal.fire({
        title: "Indice della Raccolta",
        html: indiceHTML,
        width: "600px",
        showConfirmButton: false,
        showCloseButton: true
      });

      $(document).off("click", ".toggle-categoria").on("click", ".toggle-categoria", function () {
        const categoria = $(this).data("categoria");
        $(`#categoria-list-${categoria}`).slideToggle();
      });

      $(document).off("click", ".indice-titolo").on("click", ".indice-titolo", function (e) {
        e.preventDefault();
        const titoloSelezionato = `${$(this).data("numero")}${$(this).data("titolo")}`;
        $("#search-bar").val(titoloSelezionato).trigger("input");
        Swal.close();
      });

      $(document).off("click", ".btn-group .btn").on("click", ".btn-group .btn", function () {
        $("#btn-per-categorie, #btn-ordine-numerico, #btn-ordine-alfabetico").removeClass("active");
        $(this).addClass("active");

        const id = $(this).attr("id");
        $("#sort-toggle").remove();
        $("#sort-alpha-toggle").remove();

        if (id === "btn-per-categorie") {
          $("#indice-contenuto").html(creaIndiceHTML(indice));
          return;
        }

        if (id === "btn-ordine-numerico") {
          const list = buildUniqueListFromIndex(indice);
          list.sort((a, b) => (parseInt(a.numero) || 999999) - (parseInt(b.numero) || 999999));

          const render = () => {
            let h = '<div class="text-start"><ul>';
            list.forEach((c) => {
              h += `<li><a href="#" class="indice-titolo" data-titolo="${c.titolo}" data-numero="${c.numero}">${c.numero}${c.titolo}</a></li>`;
            });
            h += "</ul></div>";
            $("#indice-contenuto").html(h);
          };

          $("#indice-contenuto").before('<div><button id="sort-toggle" class="btn btn-secondary mb-2">Ordina Crescente <i class="fas fa-sort-numeric-down"></i></button></div>');
          $("#sort-toggle").off("click").on("click", function () {
            const isAsc = $(this).find("i").hasClass("fa-sort-numeric-down");
            list.sort((a, b) => isAsc
              ? (parseInt(b.numero) || 999999) - (parseInt(a.numero) || 999999)
              : (parseInt(a.numero) || 999999) - (parseInt(b.numero) || 999999)
            );
            $(this).html(isAsc ? 'Ordina Decrescente <i class="fas fa-sort-numeric-up"></i>' : 'Ordina Crescente <i class="fas fa-sort-numeric-down"></i>');
            render();
          });

          render();
          return;
        }

        if (id === "btn-ordine-alfabetico") {
          const list = buildUniqueListFromIndex(indice);
          list.sort((a, b) => a.titolo.toLowerCase().localeCompare(b.titolo.toLowerCase()));

          const render = () => {
            let h = '<div class="text-start"><ul>';
            list.forEach((c) => {
              h += `<li><a href="#" class="indice-titolo" data-titolo="${c.titolo}" data-numero="${c.numero}">${c.numero}${c.titolo}</a></li>`;
            });
            h += "</ul></div>";
            $("#indice-contenuto").html(h);
          };

          $("#indice-contenuto").before('<div><button id="sort-alpha-toggle" class="btn btn-secondary mb-2">Ordina Crescente <i class="fas fa-sort-alpha-down"></i></button></div>');
          $("#sort-alpha-toggle").off("click").on("click", function () {
            const isAsc = $(this).find("i").hasClass("fa-sort-alpha-down");
            list.sort((a, b) => isAsc
              ? b.titolo.toLowerCase().localeCompare(a.titolo.toLowerCase())
              : a.titolo.toLowerCase().localeCompare(b.titolo.toLowerCase())
            );
            $(this).html(isAsc ? 'Ordina Decrescente <i class="fas fa-sort-alpha-up"></i>' : 'Ordina Crescente <i class="fas fa-sort-alpha-down"></i>');
            render();
          });

          render();
          return;
        }
      });

    } catch (error) {
      console.error("Errore indice:", error);
      Swal.fire("Errore!", "Non è stato possibile caricare l'indice: " + error.message, "error");
    }
  });
}

// ========================
// ADMIN AUTH (come avevi, sistemato bind)
// ========================
function wireAdminAuth() {
  $("#open-auth").off("click").on("click", function () {
    Swal.fire({
      title: "Autenticazione",
      input: "password",
      inputLabel: "Inserisci la password",
      inputPlaceholder: "Password",
      inputAttributes: {
        maxlength: 20,
        autocapitalize: "off",
        autocorrect: "off"
      },
      showCancelButton: true,
      confirmButtonText: "Conferma",
      cancelButtonText: "Annulla",
      reverseButtons: true
    }).then((result) => {
      if (result.isConfirmed) {
        verificaPassword(result.value);
      }
    });
  });
}

function verificaPassword(password) {
  const passwordCorretta = "1234"; // TODO: spostala su Firestore/Cloud Function
  if (password === passwordCorretta) {
    sbloccaAdmin();
  } else {
    Swal.fire("Oops!", "Password sbagliata!", "error");
  }
}

function sbloccaAdmin() {
  $(".admin").show();
  setCookie("isAdmin", "1", 7);
  $("#open-auth, #auth").css("opacity", "0").css("pointer-events", "none");
}

// ========================
// COOKIE HELPERS
// ========================
function setCookie(nome, valore, giorni) {
  const data = new Date();
  data.setTime(data.getTime() + giorni * 24 * 60 * 60 * 1000);
  document.cookie = `${nome}=${valore};expires=${data.toUTCString()};path=/`;
}

function getCookie(nome) {
  const nomeCookie = nome + "=";
  const cookies = document.cookie.split(";");
  for (let i = 0; i < cookies.length; i++) {
    let c = cookies[i].trim();
    if (c.indexOf(nomeCookie) === 0) return c.substring(nomeCookie.length);
  }
  return "";
}

function deleteCookie(name) {
  document.cookie = name + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
}

// Cancella cookie admin su Ctrl+F5
$(window).on("keydown", function (event) {
  if (event.ctrlKey && event.key === "F5") {
    deleteCookie("isAdmin");
  }
});

// ========================
// DEDUPE INDICE
// ========================
function buildUniqueListFromIndex(indice) {
  const seen = new Set();
  const list = [];

  Object.keys(indice).forEach((categoria) => {
    indice[categoria].forEach((canzone) => {
      const key = `${String(canzone.numero || "").trim()}__${String(canzone.titolo || "").trim().toLowerCase()}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push({ categoria, ...canzone });
      }
    });
  });

  return list;
}

// ========================
// DATE FORMAT
// ========================
function formatDate(date) {
  if (!date) return "-";
  const options = { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" };
  return date.toLocaleDateString("it-IT", options);
}

// ========================
// START
// ========================
initializeFirebase();