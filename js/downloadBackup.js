import { doc, getDoc, collection, getDocs } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

function serializeValue(v) {
  if (v && typeof v === "object") {
    // Firestore Timestamp
    if (typeof v.toDate === "function") return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    if (Array.isArray(v)) return v.map(serializeValue);

    const out = {};
    for (const k of Object.keys(v)) out[k] = serializeValue(v[k]);
    return out;
  }
  return v;
}

/**
 * Scarica un backup JSON del cliente e di tutte le raccolte.
 * @param {object} params
 * @param {import("https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js").Firestore} params.db
 * @param {string} params.idCliente
 */
export async function downloadBackupJSON({ db, idCliente }) {
  const $btn = $("#btn-backup");
  $btn.prop("disabled", true);

  try {
    Swal.fire({
      title: "Backup in corso…",
      html: `
        <div class="text-start small mb-2" id="backup-status">Preparazione…</div>
        <div class="progress" style="height: 14px;">
          <div id="backup-progress" class="progress-bar progress-bar-striped progress-bar-animated" role="progressbar" style="width: 0%"></div>
        </div>
      `,
      allowOutsideClick: false,
      allowEscapeKey: false,
      showConfirmButton: false
    });

    const setStatus = (text) => {
      const el = document.getElementById("backup-status");
      if (el) el.textContent = text;
    };

    const setProgress = (pct) => {
      const bar = document.getElementById("backup-progress");
      if (bar) bar.style.width = `${pct}%`;
    };

    setStatus("Leggo documento cliente…");
    setProgress(5);

    const clienteRef = doc(db, "Clienti", idCliente);
    const clienteSnap = await getDoc(clienteRef);

    if (!clienteSnap.exists()) throw new Error("Cliente non trovato su Firestore.");

    const clienteDataRaw = clienteSnap.data();
    const raccolte = clienteDataRaw?.raccolte || [];
    const tot = raccolte.length || 1;

    const backup = {
      exportedAt: new Date().toISOString(),
      path: `Clienti/${idCliente}`,
      cliente: serializeValue(clienteDataRaw),
      raccolte: {}
    };

    for (let i = 0; i < raccolte.length; i++) {
      const nomeRaccolta = raccolte[i];

      setStatus(`Esporto raccolta: "${nomeRaccolta}" (${i + 1}/${tot})…`);
      setProgress(10 + Math.round(((i + 1) / tot) * 80));

      const colRef = collection(db, "Clienti", idCliente, nomeRaccolta);
      const snap = await getDocs(colRef);

      backup.raccolte[nomeRaccolta] = snap.docs.map(d => ({
        id: d.id,
        ...serializeValue(d.data())
      }));
    }

    setStatus("Creo file JSON…");
    setProgress(95);

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `firestore-backup-${idCliente}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    setProgress(100);
    Swal.fire("Fatto!", "Backup scaricato correttamente.", "success");
  } catch (err) {
    console.error("Backup error:", err);
    Swal.fire("Errore", err?.message || "Impossibile creare il backup.", "error");
  } finally {
    $btn.prop("disabled", false);
  }
}