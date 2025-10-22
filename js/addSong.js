import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { getFirestore, collection, updateDoc, addDoc, doc, setDoc, getDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";
import { containsChord, transposeChord } from '/js/transposeUtils.js';

const idCliente = "POGGIOREALE";
let db;

// Init Firebase
try {
  const response = await fetch('config.json');
  if (!response.ok) throw new Error('Errore nel caricamento del file di configurazione');

  const configurator = await response.json();
  const firebaseConfig = configurator['firebaseDB'];
  if (!firebaseConfig) throw new Error("Errore: Firebase non è stato inizializzato correttamente. Verifica la tua configurazione.");

  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
} catch (error) {
  console.error("Errore:", error);
}

// Carica raccolte
async function loadAllCollections() {
  const clienteRef = doc(db, "Clienti", idCliente);
  const docSnap = await getDoc(clienteRef);
  const raccolte = [];

  if (docSnap.exists()) {
    const raccolteCliente = docSnap.data().raccolte;
    if (raccolteCliente) {
      raccolteCliente.forEach(r => raccolte.push(r));
      const $select = $("#song-collection");
      $.each(raccolte, (_, r) => $select.append(new Option(r, r)));
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
        inputValidator: v => (!v ? 'Devi inserire un nome per la raccolta!' : undefined)
      }).then(result => {
        if (result.isConfirmed) {
          const nuovaRaccolta = result.value.trim();
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

// Tagify
async function initializeTagify() {
  const input = document.querySelector('#song-categories');
  const tagify = new Tagify(input);
  // Prepopola se vuoi: tagify.addTags([...]);

  tagify.on('add', onTagChange);
  tagify.on('remove', onTagChange);

  function onTagChange() {
    const categorie = tagify.value.map(t => t.value);
    window.categorie = categorie; // opzionale
  }
}

// Trasposizione
let transposeValue = 0;

function transpose(semitone) {
  const htmlContent = $('#song-editor').html();
  const transposedContent = transposeChords(htmlContent, semitone);
  $('#song-editor').html(transposedContent);

  // Stile base e colore accordi
  $('#song-editor').css('font-size', '14px');
  $('#song-editor .chord').css('color', 'red');
}

function transposeChords(html, semitone) {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = html;

  const elements = tempDiv.querySelectorAll('*');
  elements.forEach(el => {
    let text = el.innerHTML.trim();
    const words = text.split('|');
    words.forEach(word => {
      const w = word.trim();
      if (w && containsChord(w)) {
        const transposedChord = transposeChord(w, semitone);
        text = text.replace(`|${w}|`, `<span class="chord" style="color:red;">|${transposedChord}|</span>`);
      }
    });
    el.innerHTML = text;
  });

  return tempDiv.innerHTML;
}

// Salvataggio
async function saveSong(raccolta, categories, tempo, bpm, number, title, songHTML) {
  try {
    const clienteRef = doc(db, "Clienti", idCliente);
    const clienteDoc = await getDoc(clienteRef);

    if (clienteDoc.exists()) {
      const clienteData = clienteDoc.data();
      const raccolte = clienteData.raccolte || [];
      if (!raccolte.includes(raccolta)) {
        raccolte.push(raccolta);
        await updateDoc(clienteRef, { raccolte });
      }
    }

    const snapRaccolta = collection(db, "Clienti", idCliente, raccolta);
    const snapCanzoni = await getDocs(snapRaccolta);
    let exists = false;
    let docId = null;

    snapCanzoni.forEach((d) => {
      const data = d.data();
      if (data.numero === number || data.titolo === title) {
        exists = true;
        docId = d.id;
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

      if (!confirmation.isConfirmed) return;
    }

    let docRef;
    if (exists && docId) {
      docRef = doc(snapRaccolta, docId);
      await setDoc(docRef, {
        tempo, bpm, numero: number, titolo: title,
        categorie: categories,
        html: songHTML,
        transposeValue: 0,
        UltimaModifica: serverTimestamp()
      }, { merge: true });
    } else {
      docRef = await addDoc(snapRaccolta, {
        tempo, bpm, numero: number, titolo: title,
        categorie: categories,
        html: songHTML,
        transposeValue: 0,
        dataInserimento: serverTimestamp()
      });
    }

    const savedDoc = await getDoc(docRef);
    const data = savedDoc.exists() ? savedDoc.data() : null;
    const dataInserimento = data?.dataInserimento
      ? new Date(data.dataInserimento.toDate()).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
      : "Non disponibile";

    Swal.fire({
      title: 'Salvato!',
      html: `Cantico di ${categories?.join(', ') || '-'} aggiunto.<br>Data inserimento: ${dataInserimento}`,
      icon: 'success',
      timer: 2000,
      timerProgressBar: true,
      didClose: () => { window.location.href = 'index.html'; }
    });
  } catch (error) {
    Swal.fire('Errore!', `Non è stato possibile salvare questo cantico:\n\n${error.message}`, 'error');
  }
}

// Document ready
$(document).ready(async function () {
  if (db) {
    await loadAllCollections();
    await initializeTagify();
  }

  // Trasposizione: handlers
  $('#transpose-up2').on('click', function () {
    transposeValue += 2;
    $('#transpose-value').text(transposeValue);
    transpose(2);
  });
  $('#transpose-up').on('click', function () {
    transposeValue += 1;
    $('#transpose-value').text(transposeValue);
    transpose(1);
  });
  $('#transpose-down').on('click', function () {
    transposeValue -= 1;
    $('#transpose-value').text(transposeValue);
    transpose(-1);
  });
  $('#transpose-down2').on('click', function () {
    transposeValue -= 2;
    $('#transpose-value').text(transposeValue);
    transpose(-2);
  });

  // Salva
  $('#save-song').on('click', function () {
    const raccolta = $('#song-collection').val();
    const categoriesMap = $('#song-categories').val();
    const tempo = $('#tempo').val();
    const bpm = parseInt($('#bpm').val(), 10);
    const number = parseInt($('#numero').val(), 10);
    const title = $('#titolo').val();
    const songHTML = $('#song-editor').html();

    if (!raccolta || !categoriesMap || !tempo || !bpm || !number || !title || !songHTML) {
      Swal.fire({ title: 'Errore!', text: 'Per favore, compila tutti i campi prima di salvare.', icon: 'error', confirmButtonText: 'OK' });
      return;
    }

    let categories = [];
    try {
      const parsedCategories = JSON.parse(categoriesMap);
      categories = parsedCategories.map(item => Object.values(item)[0]);
    } catch {
      // Se Tagify non restituisce JSON (fallback): usa split semplice
      categories = (categoriesMap || '').split(',').map(s => s.trim()).filter(Boolean);
    }

    saveSong(raccolta, categories, tempo, bpm, number, title, songHTML);
  });
});

// --- TOOLBAR senza ID ---
// Bold/Italic/Underline
$(document).on('click', '[data-cmd]', function (e) {
  e.preventDefault();
  document.execCommand($(this).data('cmd'), false, null);
  $('#song-editor').focus();
});

// Font size
$(document).on('change', 'select[data-role="font-size"]', function () {
  const value = $(this).val(); // es. "14px"
  document.execCommand('fontSize', false, '7'); // placeholder
  $('#song-editor font[size="7"]').removeAttr('size').css('font-size', value);
  $('#song-editor').focus();
});

// Font color
$(document).on('change', 'input[type="color"][data-role="font-color"]', function () {
  document.execCommand('foreColor', false, $(this).val());
  $('#song-editor').focus();
});
