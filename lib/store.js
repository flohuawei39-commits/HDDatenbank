'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
// HDD_BASIS erlaubt eine zweite, isolierte Instanz (Test, Probelauf) neben dem Echtbetrieb.
const BASIS = process.env.HDD_BASIS || ROOT;
const DATA_DIR = path.join(BASIS, 'data');
const DOKUMENTE_DIR = path.join(BASIS, 'dokumente');
const BACKUP_DIR = path.join(BASIS, 'backups');

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
    pinHash: null,
    pinSalt: null,
    eingerichtetAm: null,
    letztesBackup: null,
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
  'sessions.json': { sessions: [] }
};

const STAENDE = [
  { id: 'erstkontakt', name: 'Erstkontakt' },
  { id: 'gespraech', name: 'Im Gespräch' },
  { id: 'antrag', name: 'Antrag läuft' },
  { id: 'zusage', name: 'Zusage' },
  { id: 'absage', name: 'Absage' }
];

const ensureDirs = () => {
  for (const dir of [DATA_DIR, DOKUMENTE_DIR, BACKUP_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }
};

const read = (file) => {
  const target = path.join(DATA_DIR, file);
  try {
    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : structuredClone(defaults[file]);
  } catch {
    return structuredClone(defaults[file]);
  }
};

// Temp-Datei plus rename: ein Absturz mitten im Schreiben kann die Datei nicht zerreissen.
const write = (file, value) => {
  ensureDirs();
  const target = path.join(DATA_DIR, file);
  const temp = `${target}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, target);
  return value;
};

const id = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;

const jetzt = () => new Date().toISOString();

// Lokales Datum, nicht UTC — sonst springt der "heute"-Tag abends um.
const heute = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

module.exports = {
  ROOT, DATA_DIR, DOKUMENTE_DIR, BACKUP_DIR, NEON, STAENDE, defaults,
  KACHELN, KACHEL_IDS, SPALTEN, VORLAGEN, vorlage, startseiteNormalisieren,
  ensureDirs, read, write, id, jetzt, heute
};
