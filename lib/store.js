/* Zentrale Ablage. Die Schnittstelle bleibt bewusst synchron (`read`/`write`),
   damit die gewachsene Logik in finanzen.js, gemeinden.js und mail.js
   unveraendert weiterlaeuft. Dahinter liegt jetzt aber kein Dateisystem mehr,
   sondern ein Speicherabbild, das der Abgleich fuellt und wegschreibt. */

const abbild = new Map();
let beiAenderung = null;   // wird von sync.js gesetzt

const NEON = {
  gruen: '#3ddc84',
  cyan: '#34e2e2',
  magenta: '#ff5fd2',
  amber: '#ffb454',
  violett: '#a988ff',
  koralle: '#ff7a6b'
};

/* ------------------------------------------------------------ Startseite

   Die Startseite besteht aus sieben festen Kacheln. Gespeichert wird nur, wo sie
   stehen und ob sie sichtbar sind — nie ihr Inhalt. `spalte: 'voll'` belegt eine
   eigene Zeile ueber die ganze Breite, die Reihenfolge im Array bestimmt die
   Reihenfolge innerhalb einer Spalte.                                        */

const KACHELN = [
  { id: 'fristen', name: 'Fristen' },
  { id: 'heute', name: 'Heute' },
  { id: 'morgen', name: 'Morgen' },
  { id: 'aufgaben', name: 'Offene Aufgaben' },
  { id: 'finanzen', name: 'Finanzen' },
  { id: 'can', name: 'Can' },
  { id: 'gemeinden', name: 'Gemeinden' }
];

const KACHEL_IDS = KACHELN.map((k) => k.id);
const SPALTEN = ['voll', 1, 2, 3];

const platz = (id, spalte, sichtbar = true) => ({ id, spalte, sichtbar });

const VORLAGEN = {
  signal: {
    name: 'Signalzeile oben',
    kacheln: [
      platz('fristen', 'voll'),
      platz('heute', 1), platz('aufgaben', 1),
      platz('morgen', 2), platz('finanzen', 2),
      platz('can', 3), platz('gemeinden', 3)
    ]
  },
  drei: {
    name: 'Dreispalter',
    kacheln: [
      platz('fristen', 1), platz('heute', 1),
      platz('morgen', 2), platz('aufgaben', 2),
      platz('finanzen', 3), platz('can', 3), platz('gemeinden', 3)
    ]
  },
  flaeche: {
    name: 'Arbeitsfläche mit Randleiste',
    kacheln: [
      platz('heute', 1), platz('morgen', 2),
      platz('aufgaben', 'voll'),
      platz('fristen', 3), platz('can', 3), platz('finanzen', 3), platz('gemeinden', 3)
    ]
  }
};

const vorlage = (name) => {
  const gewaehlt = VORLAGEN[name] ? name : 'signal';
  return { vorlage: gewaehlt, kacheln: VORLAGEN[gewaehlt].kacheln.map((k) => ({ ...k })) };
};

/**
 * Layout auf einen brauchbaren Stand bringen. Bewusst wegwerfend statt meldend:
 * eine Startseite darf an einer alten oder von Hand verbogenen config.json nicht
 * scheitern. Unbekannte Kacheln fliegen raus, fehlende kommen aus der Vorlage
 * dazu, unsinnige Spalten landen in Spalte 1.
 */
const startseiteNormalisieren = (wert) => {
  const roh = wert && typeof wert === 'object' ? wert : {};
  const name = VORLAGEN[roh.vorlage] ? roh.vorlage : 'signal';
  const liste = Array.isArray(roh.kacheln) ? roh.kacheln : [];

  const gesehen = new Set();
  const kacheln = [];
  for (const eintrag of liste) {
    if (!eintrag || typeof eintrag !== 'object') continue;
    if (!KACHEL_IDS.includes(eintrag.id) || gesehen.has(eintrag.id)) continue;
    gesehen.add(eintrag.id);
    kacheln.push({
      id: eintrag.id,
      spalte: SPALTEN.includes(eintrag.spalte) ? eintrag.spalte : 1,
      sichtbar: eintrag.sichtbar !== false
    });
  }

  // Was fehlt, kommt an der Stelle nach, die die Vorlage dafuer vorsieht.
  for (const fehlt of VORLAGEN[name].kacheln) {
    if (!gesehen.has(fehlt.id)) kacheln.push({ ...fehlt });
  }

  return { vorlage: name, kacheln };
};

const defaults = {
  'entries.json': {
    kategorien: [
      { id: 'kat_can', name: 'Can', farbe: NEON.gruen },
      { id: 'kat_privat', name: 'Privat', farbe: NEON.cyan },
      { id: 'kat_studio', name: 'Web Studio', farbe: NEON.violett },
      { id: 'kat_tsz', name: 'Tierschutzzentrum', farbe: NEON.magenta },
      { id: 'kat_gesundheit', name: 'Gesundheit', farbe: NEON.amber }
    ],
    entries: []
  },
  'tasks.json': { tasks: [] },
  'gemeinden.json': { gemeinden: [] },
  'finanzen.json': { buchungen: [], kategorien: [], regeln: [], importe: [] },
  'config.json': {
    eingerichtetAm: null,
    thema: 'kante',
    startseite: vorlage('signal'),
    mail: {
      aktiv: false,
      schluessel: null,      // Web3Forms; alternativ Umgebungsvariable HDD_WEB3FORMS_KEY
      empfaenger: null,
      uhrzeit: '07:00',
      letzterVersand: null,  // Datum der zuletzt verschickten Tagesmail
      letzterFehler: null
    }
  },
};

/** Die Dateien, die abgeglichen werden. Reihenfolge ist die Commit-Reihenfolge. */
const DATEIEN = ['entries.json', 'tasks.json', 'gemeinden.json', 'finanzen.json', 'config.json'];

const STAENDE = [
  { id: 'erstkontakt', name: 'Erstkontakt' },
  { id: 'gespraech', name: 'Im Gespräch' },
  { id: 'antrag', name: 'Antrag läuft' },
  { id: 'zusage', name: 'Zusage' },
  { id: 'absage', name: 'Absage' }
];

/** Alle Dateien auf einmal setzen, ohne den Abgleich erneut auszuloesen. */
const laden = (inhalte) => {
  abbild.clear();
  for (const [datei, wert] of Object.entries(inhalte || {})) abbild.set(datei, wert);
};

/** Aktueller Gesamtstand, so wie er weggeschrieben wird. */
const alles = () => Object.fromEntries(DATEIEN.map((d) => [d, read(d)]));

const beiAenderungSetzen = (fn) => { beiAenderung = fn; };

const read = (file) => {
  if (abbild.has(file)) return abbild.get(file);
  const vorgabe = structuredClone(defaults[file]);
  abbild.set(file, vorgabe);
  return vorgabe;
};

const write = (file, value) => {
  abbild.set(file, value);
  // Der Abgleich buendelt mehrere Schreibvorgaenge, deshalb nur melden statt speichern.
  if (beiAenderung) beiAenderung(file);
  return value;
};

const id = (prefix) => {
  const roh = new Uint8Array(6);
  globalThis.crypto.getRandomValues(roh);
  return `${prefix}_${[...roh].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
};

const jetzt = () => new Date().toISOString();

// Lokales Datum, nicht UTC — sonst springt der "heute"-Tag abends um.
const heute = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export {
  NEON, STAENDE, defaults, DATEIEN,
  KACHELN, KACHEL_IDS, SPALTEN, VORLAGEN, vorlage, startseiteNormalisieren,
  laden, alles, beiAenderungSetzen, read, write, id, jetzt, heute
};
