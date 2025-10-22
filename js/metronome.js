// metronome.js
// ———————————————————————————————————————————————
// Modulo ES per metronomo con scheduler look-ahead
// ———————————————————————————————————————————————
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const metronomes = new Map(); // songId -> { metro, tempoBar, btn }

function parseBeatsPerMeasure(tempoStr) {
  if (!tempoStr) return 4;
  const n = parseInt(String(tempoStr).split("/")[0], 10);
  return Number.isFinite(n) ? n : 4;
}

class Metronome {
  constructor({ bpm, beatsPerMeasure, onBeat }) {
    this.setParams(bpm, beatsPerMeasure);
    this.onBeat = onBeat || (() => {});
    this.isRunning = false;

    this.lookahead = 0.025;       // 25ms
    this.scheduleAheadTime = 0.1; // 100ms
    this.nextNoteTime = 0;
    this.currentBeat = 0;
    this._timer = null;
  }

  setParams(bpm, beatsPerMeasure) {
    this.bpm = Number(bpm);
    this.beatsPerMeasure = Number(beatsPerMeasure);
    this.secondsPerBeat = 60 / this.bpm;
  }

  _tick(time) {
    const accented = (this.currentBeat % this.beatsPerMeasure) === 0;

    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = "square";
    osc.frequency.value = accented ? 1000 : 750;
    gain.gain.setValueAtTime(accented ? 0.25 : 0.12, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.09);

    this.onBeat({ accented, time, beatIndex: this.currentBeat });
  }

  _schedule() {
    while (this.nextNoteTime < audioCtx.currentTime + this.scheduleAheadTime) {
      this._tick(this.nextNoteTime);
      this.nextNoteTime += this.secondsPerBeat;
      this.currentBeat++;
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.currentBeat = 0;
    this.nextNoteTime = audioCtx.currentTime + 0.05;
    this._timer = setInterval(() => this._schedule(), this.lookahead * 1000);
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    clearInterval(this._timer);
    this._timer = null;
  }
}

// ———————————————————————————————————————————————
// API pubblica
// ———————————————————————————————————————————————

function getSongNodes(songId) {
  const li = document.getElementById(songId);
  if (!li) throw new Error(`Song <li> non trovato: ${songId}`);
  const bpm = Number(li.getAttribute("bpm")) || 120;
  const beatsPerMeasure = parseBeatsPerMeasure(li.getAttribute("tempo"));
  const tempoBar = document.getElementById(`song-tempo-${songId}`);
  const btn = document.querySelector(`[data-metronome-btn="${songId}"]`)
         || document.getElementById(`metronome-btn-${songId}`); // compat vecchia
  return { bpm, beatsPerMeasure, tempoBar, btn };
}

function createOrUpdate(songId) {
  const { bpm, beatsPerMeasure, tempoBar, btn } = getSongNodes(songId);

  let entry = metronomes.get(songId);
  if (!entry) {
    const metro = new Metronome({
      bpm,
      beatsPerMeasure,
      onBeat: ({ accented, time }) => {
        if (!tempoBar) return;
        const delay = Math.max(0, (time - audioCtx.currentTime) * 1000);
        setTimeout(() => {
          tempoBar.classList.remove("metronome-pulse");
          void tempoBar.offsetWidth; // reflow
          tempoBar.classList.add("metronome-pulse");
          if (accented) tempoBar.style.outline = "2px solid rgba(255,0,0,0.35)";
          setTimeout(() => (tempoBar.style.outline = ""), 90);
        }, delay);
      },
    });
    entry = { metro, tempoBar, btn };
    metronomes.set(songId, entry);
  } else {
    entry.metro.setParams(bpm, beatsPerMeasure);
  }
  return entry;
}

function stopAllExcept(songId) {
  metronomes.forEach((entry, id) => {
    if (id !== songId) {
      entry.metro.stop();
      if (entry.btn) entry.btn.textContent = "▶️ Metronomo";
    }
  });
}

export function toggleMetronome(songId) {
  const entry = createOrUpdate(songId);
  const { metro, btn } = entry;

  stopAllExcept(songId);
  if (audioCtx.state === "suspended") audioCtx.resume();

  if (metro.isRunning) {
    metro.stop();
    if (btn) btn.textContent = "▶️ Metronomo";
  } else {
    metro.start();
    if (btn) btn.textContent = "⏸️ Stop";
  }
}

export function refreshMetronomeParams(songId) {
  const entry = metronomes.get(songId);
  if (!entry) return;
  const { bpm, beatsPerMeasure } = getSongNodes(songId);
  entry.metro.setParams(bpm, beatsPerMeasure);
}

export function attachButtons(container = document) {
  // Aggiungi data-metronome-btn="ID_BRANO" ai bottoni
  container.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-metronome-btn]");
    if (!btn) return;
    const songId = btn.getAttribute("data-metronome-btn");
    // collega il riferimento del bottone per il cambio label
    const entry = metronomes.get(songId);
    if (entry) entry.btn = btn;
    else metronomes.set(songId, { ...createOrUpdate(songId), btn });
    toggleMetronome(songId);
  });
}

// (opzionale) esponi per debug in console
export const _debug = { audioCtx, metronomes };



// ———————————————————————————————————————————————
// Modalità editing quando si modifica il brano
// ———————————————————————————————————————————————

let _editingEntry = null; // { metro, tempoBar, btn }

/**
 * Attiva/ferma il metronomo in fase di editing.
 * @param {Object} opts
 * @param {number} opts.bpm                  - BPM desiderati (es. 96).
 * @param {string|number} [opts.tempo=4/4]   - Tempo in forma "X/Y" (es. "3/4", "4/4") o numero (battiti per misura).
 * @param {HTMLElement} [opts.tempoBar]      - Nodo da pulsare ad ogni beat (es. #song-tempo-editor).
 * @param {HTMLElement} [opts.btn]           - Bottone per cambiare etichetta (⏸️/▶️).
 */
export function toggleMetronomeInEditing({ bpm, tempo, tempoBar, btn, songId } = {}) {
  // Se bpm o tempo sono vuoti o "0/0", leggili dal DOM
  if (!bpm || bpm <= 0) {
    const bpmInput = document.getElementById(`bpm-${songId}`);
    bpm = bpmInput ? Number(bpmInput.value) || 120 : 120;
  }

  if (!tempo || tempo === "0/0" || tempo === 'undefined') {
    const tempoInput = document.getElementById(`song-tempo-edit-${songId}`);
    tempo = tempoInput ? tempoInput.value || "4/4" : "4/4";
  }

  // Calcola beatsPerMeasure partendo da "tempo"
  let beatsPerMeasure;
  if (typeof tempo === "number") {
    beatsPerMeasure = Number(tempo) || 4;
  } else {
    beatsPerMeasure = parseBeatsPerMeasure(tempo);
  }

  // Crea o aggiorna l'istanza
  if (!_editingEntry) {
    const metro = new Metronome({
      bpm: Number(bpm),
      beatsPerMeasure,
      onBeat: ({ accented, time }) => {
        const barEl = _editingEntry?.tempoBar;
        if (!barEl) return;
        const delay = Math.max(0, (time - audioCtx.currentTime) * 1000);
        setTimeout(() => {
          barEl.classList.remove("metronome-pulse");
          void barEl.offsetWidth; // reflow
          barEl.classList.add("metronome-pulse");
          if (accented) barEl.style.outline = "2px solid rgba(0,128,255,0.35)";
          setTimeout(() => (barEl.style.outline = ""), 90);
        }, delay);
      },
    });
    _editingEntry = { metro, tempoBar: tempoBar || null, btn: btn || null };
  } else {
    _editingEntry.metro.setParams(Number(bpm), beatsPerMeasure);
    if (tempoBar) _editingEntry.tempoBar = tempoBar;
    if (btn) _editingEntry.btn = btn;
  }

  stopAllExcept("__editing__");

  if (audioCtx.state === "suspended") audioCtx.resume();

  // Toggle
  if (_editingEntry.metro.isRunning) {
    _editingEntry.metro.stop();
    if (_editingEntry.btn) _editingEntry.btn.textContent = "▶️ Metronomo";
  } else {
    _editingEntry.metro.start();
    if (_editingEntry.btn) _editingEntry.btn.textContent = "⏸️ Stop";
  }
}


/**
 * Aggiorna i parametri del metronomo in editing senza togglare lo stato.
 * Utile quando l’utente cambia BPM/tempo mentre è già acceso.
 * @param {Object} opts
 * @param {number} [opts.bpm]
 * @param {string|number} [opts.tempo]
 */
export function refreshEditingMetronomeParams({ bpm, tempo } = {}) {
  if (!_editingEntry) return;
  const newBpm = Number(bpm) || _editingEntry.metro.bpm;

  let beatsPerMeasure;
  if (typeof tempo === "number") {
    beatsPerMeasure = Number(tempo) || _editingEntry.metro.beatsPerMeasure;
  } else if (typeof tempo === "string") {
    beatsPerMeasure = parseBeatsPerMeasure(tempo);
  } else {
    beatsPerMeasure = _editingEntry.metro.beatsPerMeasure;
  }

  _editingEntry.metro.setParams(newBpm, beatsPerMeasure);
}

/**
 * Ferma esplicitamente il metronomo in editing (se serve).
 */
export function stopEditingMetronome() {
  if (!_editingEntry) return;
  _editingEntry.metro.stop();
  if (_editingEntry.btn) _editingEntry.btn.textContent = "▶️ Metronomo";
}


// ————————————————————————————————————————————————————
// Modalità ADDING (creazione nuovo brano, senza songId)
// ————————————————————————————————————————————————————
let _addingMetro = {
  on: false,
  timer: null,
  bpm: 120,
  beatsPerBar: 4,
  beatIndex: 0,
  targetEl: null, // nodo che "pulsa" (es. bottone)
};

// Parsing robusto del tempo (es. "4/4", "3/4", fallback 4)
function parseBeatsPerBarFromTempoStr(tstr) {
  if (!tstr || typeof tstr !== 'string') return 4;
  const m = tstr.match(/^\s*(\d+)\s*\/\s*\d+\s*$/);
  const num = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(num) && num > 0 ? num : 4;
}

// Fornisci un piccolo feedback visivo sul beat
function pulse(el) {
  if (!el) return;
  el.classList.remove('metronome-pulse');
  // reflow per riavviare l'animazione
  void el.offsetWidth;
  el.classList.add('metronome-pulse');
}

// Click sonoro (facoltativo, non blocca se AudioContext non esiste)
function tickSound(accent = false) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!tickSound.ctx) tickSound.ctx = new AudioCtx();
    const ctx = tickSound.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 1200 : 900;
    g.gain.value = accent ? 0.04 : 0.03;
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.05);
  } catch { /* no-op */ }
}

// Avvia il loop in base ai parametri correnti
function _startAddingLoop() {
  const intervalMs = 60000 / _addingMetro.bpm;

  _addingMetro.timer = setInterval(() => {
    const accent = (_addingMetro.beatIndex % _addingMetro.beatsPerBar) === 0;
    pulse(_addingMetro.targetEl || document.getElementById('metronome-btn-adding'));
    tickSound(accent);
    _addingMetro.beatIndex = (_addingMetro.beatIndex + 1) % Math.max(1, _addingMetro.beatsPerBar);
  }, Math.max(30, intervalMs));
}

// Ferma il loop
export function stopMetronomeInAdding() {
  if (_addingMetro.timer) clearInterval(_addingMetro.timer);
  _addingMetro.timer = null;
  _addingMetro.on = false;
  _addingMetro.beatIndex = 0;
}

// Toggle principale: legge #tempo e #bpm dal DOM (senza songId)
export function toggleMetronomeInAdding(opts = {}) {
  // LEGGE DAL DOM: tempo e bpm
  const tempoStr = $('#tempo').val() ?? '4/4';
  const bpmVal = parseInt($('#bpm').val(), 10);
  const bpm = Number.isFinite(bpmVal) && bpmVal > 0 ? bpmVal : 120;

  // Opzionale: un target custom da far “pulsare”
  _addingMetro.targetEl = opts.tempoBar || opts.btn || document.getElementById('metronome-btn-adding');

  // Aggiorna stato
  _addingMetro.bpm = bpm;
  _addingMetro.beatsPerBar = parseBeatsPerBarFromTempoStr(tempoStr);

  if (_addingMetro.on) {
    // se era acceso: spegni
    stopMetronomeInAdding();
  } else {
    // accendi
    _addingMetro.on = true;
    _startAddingLoop();
  }
}

// Aggiornamento "live" se l'utente cambia i campi mentre il metronomo è acceso
export function refreshMetronomeParamsInAdding(partial = {}) {
  if (!_addingMetro.on) return;
  let needRestart = false;

  if (typeof partial.bpm !== 'undefined') {
    const b = parseInt(partial.bpm, 10);
    if (Number.isFinite(b) && b > 0 && b !== _addingMetro.bpm) {
      _addingMetro.bpm = b;
      needRestart = true;
    }
  }
  if (typeof partial.tempo !== 'undefined') {
    const beats = parseBeatsPerBarFromTempoStr(partial.tempo);
    if (beats !== _addingMetro.beatsPerBar) {
      _addingMetro.beatsPerBar = beats;
      _addingMetro.beatIndex = 0;
      // intervallo non cambia qui, ma resetto l’accento
    }
  }
  if (needRestart) {
    clearInterval(_addingMetro.timer);
    _startAddingLoop();
  }
}
