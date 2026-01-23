// /js/importBackup.js
import {
  doc,
  collection,
  writeBatch,
  setDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

export function wireImportUI({ db, idCliente, bootstrapFromClienteDoc }) {
  const input = document.getElementById("importBackupFile");
  if (!input) return;

  // evita doppi listener se wireImportUI viene richiamata
  input.value = "";
  input.onchange = null;

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      Swal.fire({ title: "Import in corso...", allowOutsideClick: false, didOpen: () => Swal.showLoading() });

      const raw = JSON.parse(await file.text());

      // ✅ normalizza formato
      const normalized = normalizeBackup(raw);

      await importToFirestore({ db, idCliente, backup: normalized });

      Swal.fire("Import completato", "Backup caricato su Firestore.", "success");
      await bootstrapFromClienteDoc();

    } catch (e) {
      console.error(e);
      Swal.fire("Errore", String(e?.message || e), "error");
    } finally {
      input.value = "";
    }
  });
}

/**
 * Supporta:
 * A) { raccolte: ["R1"], songs: { "R1": [...] } }
 * B) { cliente: { raccolte: [...], settings: {...} }, raccolte: { "R1": [...] } }
 */
function normalizeBackup(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Backup non valido (JSON).");

  // Formato A
  if (Array.isArray(raw.raccolte) && raw.songs && typeof raw.songs === "object") {
    return {
      raccolteList: raw.raccolte,
      songsByCollection: raw.songs,
      settings: raw.cliente?.settings || {}
    };
  }

  // Formato B (quello del tuo file export)
  if (raw.cliente?.raccolte && raw.raccolte && typeof raw.raccolte === "object") {
    return {
      raccolteList: raw.cliente.raccolte,
      songsByCollection: raw.raccolte,
      settings: raw.cliente.settings || {}
    };
  }

  // Variante B senza cliente (solo raccolte oggetto)
  if (raw.raccolte && typeof raw.raccolte === "object" && !Array.isArray(raw.raccolte)) {
    const keys = Object.keys(raw.raccolte);
    return {
      raccolteList: keys,
      songsByCollection: raw.raccolte,
      settings: raw.settings || {}
    };
  }

  throw new Error("Backup non valido: formato non riconosciuto.");
}

function toTimestamp(val, fallbackNow = true) {
  try {
    if (!val) return fallbackNow ? Timestamp.now() : null;

    // già Timestamp
    if (val instanceof Timestamp) return val;

    // Firestore-like object {seconds, nanoseconds}
    if (typeof val === "object" && typeof val.seconds === "number") {
      return new Timestamp(val.seconds, val.nanoseconds || 0);
    }

    // ISO string / date string
    if (typeof val === "string") {
      const d = new Date(val);
      if (!isNaN(d.getTime())) return Timestamp.fromDate(d);
    }

    // Date
    if (val instanceof Date && !isNaN(val.getTime())) {
      return Timestamp.fromDate(val);
    }
  } catch { /* ignore */ }

  return fallbackNow ? Timestamp.now() : null;
}

async function importToFirestore({ db, idCliente, backup }) {
  const batchSize = 450;
  const clienteRef = doc(db, "Clienti", idCliente);

  const raccolteList = backup.raccolteList || [];
  const songsByCollection = backup.songsByCollection || {};
  const settings = backup.settings || {};

  if (!Array.isArray(raccolteList) || raccolteList.length === 0) {
    throw new Error("Backup valido ma senza raccolte.");
  }

  // ✅ 1) aggiorna doc cliente (raccolte + settings)
  // non sovrascrivo tutto settings: faccio merge e imposto raccoltaSelezionata sensata
  const raccoltaSelezionata =
    settings.raccoltaSelezionata && raccolteList.includes(settings.raccoltaSelezionata)
      ? settings.raccoltaSelezionata
      : (raccolteList[0] ?? "-");

  await setDoc(clienteRef, {
    raccolte: raccolteList,
    settings: {
      ...settings,
      raccoltaSelezionata
    }
  }, { merge: true });

  // ✅ 2) scrivi canzoni in batch
  let batch = writeBatch(db);
  let opCount = 0;

  for (const nomeRaccolta of raccolteList) {
    const list = Array.isArray(songsByCollection[nomeRaccolta]) ? songsByCollection[nomeRaccolta] : [];

    for (const song of list) {
      const songId = song?.id || crypto.randomUUID();
      const songRef = doc(collection(clienteRef, nomeRaccolta), songId);

      const cleanSong = {
        ...song,
        // coerenti con Firestore
        dataInserimento: toTimestamp(song?.dataInserimento, true),
        ultimaModifica: toTimestamp(song?.ultimaModifica, true)
      };

      batch.set(songRef, cleanSong, { merge: true });
      opCount++;

      if (opCount >= batchSize) {
        await batch.commit();
        batch = writeBatch(db);
        opCount = 0;
      }
    }
  }

  if (opCount > 0) await batch.commit();
}