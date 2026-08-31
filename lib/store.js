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

/* ------------------------------------------------------------ Eintragsarten

   Was fuer eine Sache ein Kalendereintrag ist: ein Termin, an dem man irgendwo
   sein muss, eine Frist, bis zu der etwas fertig sein muss, oder eine Aufgabe,
   die man sich vorgenommen hat. Frueher gab es dafuer nur den Haken `istFrist`;
   der bleibt im Datensatz, wird aber aus der Art abgeleitet, damit Fristenkachel,
   Sortierung, Suche und Schnellerfassung unveraendert weiterlaufen.

   Die Liste ist erweiterbar. Nur `Frist` ist fest: sie zu loeschen wuerde die
   Fristenkachel ins Leere laufen lassen.                                      */

const ART_FRIST = 'art_frist';
const ART_TERMIN = 'art_termin';
const ART_AUFGABE = 'art_aufgabe';

const ARTEN = [
  { id: ART_TERMIN, name: 'Termin', farbe: NEON.cyan, fest: false },
  { id: ART_FRIST, name: 'Frist', farbe: NEON.koralle, fest: true },
  { id: ART_AUFGABE, name: 'Aufgabe', farbe: NEON.gruen, fest: false }
];

/* ------------------------------------------------------------ Startseite

   Die Startseite besteht aus sieben festen Kacheln. Gespeichert wird nur, wo sie
   stehen, wie gross sie sind und ob sie sichtbar sind — nie ihr Inhalt.

   `spalte` ist eine der sechs Ablagen: 'links' und 'rechts' sind schmale
   Randleisten ueber die volle Hoehe, 'voll' ist die Zeile ueber den drei
   mittleren Spalten, 1 bis 3 sind diese Spalten. Die Reihenfolge im Array
   bestimmt die Reihenfolge innerhalb einer Ablage.

   `breite: 'halb'` gilt nur in der Vollzeile: zwei halbe Kacheln hintereinander
   ruecken dort nebeneinander. Ueberall sonst waere das sinnlos und wird beim
   Normalisieren still zu 'ganz'.

   `hoehe` ist ein MINDESTMASS in Pixeln, keine feste Hoehe. Kacheln wachsen bei
   Bedarf darueber hinaus — die Startseite soll alles zeigen, statt es hinter
   einem Scrollbalken zu verstecken. `null` heisst: richtet sich nach dem Inhalt. */

const KACHELN = [
  { id: 'fristen', name: 'Fristen und Termine' },
  { id: 'heute', name: 'Heute' },
  { id: 'morgen', name: 'Morgen' },
  { id: 'aufgaben', name: 'Offene Aufgaben' },
  { id: 'finanzen', name: 'Finanzen' },
  { id: 'can', name: 'Can' },
  { id: 'gemeinden', name: 'Gemeinden' }
];

const KACHEL_IDS = KACHELN.map((k) => k.id);
const SPALTEN = ['links', 'voll', 1, 2, 3, 'rechts'];

/* Eigene Reiter duerfen eine eigene Kachel mitbringen. Ihre Kennung wird aus
   der Reiterkennung gebildet, damit sie eindeutig ist und beim Entfernen des
   Reiters wieder von selbst aus dem Layout faellt. */
const EIGEN_KACHEL = (reiterId) => `eigen_${reiterId}`;

/** Alle Kacheln, die es gerade gibt: die sieben festen plus die zugeschalteten. */
const kachelListe = (reiter = []) => [
  ...KACHELN,
  ...(Array.isArray(reiter) ? reiter : [])
    .filter((r) => r && r.typ === 'eigen' && r.kachel && r.kachel.aktiv)
    .map((r) => ({ id: EIGEN_KACHEL(r.id), name: r.name, reiterId: r.id }))
];
const RANDLEISTEN = ['links', 'rechts'];
const BREITEN = ['ganz', 'halb'];
const MINDESTHOEHE = 120;

/* Am Handy zaehlt nicht die Spaltenanordnung, sondern die Dringlichkeit: es gibt
   nur eine Spalte, und was oben steht, sieht man zuerst. Was auf dem grossen
   Bildschirm in einer Randleiste liegt, rutscht dabei ans Ende. */
const HANDY_REIHENFOLGE = ['fristen', 'heute', 'morgen', 'aufgaben', 'gemeinden', 'finanzen', 'can'];

const platz = (id, spalte, breite = 'ganz', hoehe = null, sichtbar = true) =>
  ({ id, spalte, breite, hoehe, sichtbar });

const VORLAGEN = {
  signal: {
    name: 'Signalzeile oben',
    kacheln: [
      platz('fristen', 'voll', 'halb'), platz('aufgaben', 'voll', 'halb'),
      platz('heute', 'voll', 'halb'), platz('morgen', 'voll', 'halb'),
      platz('finanzen', 'links'),
      platz('gemeinden', 1),
      platz('can', 'rechts')
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
    name: 'Arbeitsfläche mit Randleisten',
    kacheln: [
      platz('fristen', 'voll', 'halb'), platz('aufgaben', 'voll', 'halb'),
      platz('heute', 1), platz('morgen', 2), platz('gemeinden', 3),
      platz('finanzen', 'links'), platz('can', 'rechts')
    ]
  }
};

const vorlage = (name) => {
  const gewaehlt = VORLAGEN[name] ? name : 'signal';
  return {
    vorlage: gewaehlt,
    kacheln: VORLAGEN[gewaehlt].kacheln.map((k) => ({ ...k })),
    finanzenAnsicht: 'einzeln'
  };
};

const hoeheNormalisieren = (wert) => {
  const n = Number(wert);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(MINDESTHOEHE, Math.round(n));
};

/**
 * Layout auf einen brauchbaren Stand bringen. Bewusst wegwerfend statt meldend:
 * eine Startseite darf an einer alten oder von Hand verbogenen config.json nicht
 * scheitern. Unbekannte Kacheln fliegen raus, fehlende kommen aus der Vorlage
 * dazu, unsinnige Spalten landen in Spalte 1.
 *
 * Ein Layout aus der Zeit vor den Randleisten erkennt man daran, dass keine
 * einzige Kachel ein `breite`-Feld hat. Ein solches Layout wird komplett durch
 * die aktuelle Vorlage ersetzt statt muehsam hochgerechnet — die Anordnung hat
 * sich grundlegend geaendert, und eine halbe Umstellung waere schlechter als
 * ein sauberer Neuanfang, von dem aus sich weiterschieben laesst.
 */
const startseiteNormalisieren = (wert, reiter = []) => {
  const roh = wert && typeof wert === 'object' ? wert : {};
  const name = VORLAGEN[roh.vorlage] ? roh.vorlage : 'signal';
  const liste = Array.isArray(roh.kacheln) ? roh.kacheln : [];
  const erlaubt = kachelListe(reiter);
  const erlaubteIds = erlaubt.map((k) => k.id);

  // Wie die Finanzkachel rechnet, gehoert zur Startseite und ueberlebt jede
  // Neuanordnung.
  const finanzenAnsicht = roh.finanzenAnsicht === 'gesamt' ? 'gesamt' : 'einzeln';

  const vorRandleisten = liste.length > 0
    && !liste.some((k) => k && typeof k === 'object' && BREITEN.includes(k.breite));
  if (vorRandleisten) return { ...vorlage(name), finanzenAnsicht };

  const gesehen = new Set();
  const kacheln = [];
  for (const eintrag of liste) {
    if (!eintrag || typeof eintrag !== 'object') continue;
    if (!erlaubteIds.includes(eintrag.id) || gesehen.has(eintrag.id)) continue;
    gesehen.add(eintrag.id);
    const spalte = SPALTEN.includes(eintrag.spalte) ? eintrag.spalte : 1;
    kacheln.push({
      id: eintrag.id,
      spalte,
      // Halbe Breite ergibt nur in der Vollzeile einen Sinn.
      breite: spalte === 'voll' && eintrag.breite === 'halb' ? 'halb' : 'ganz',
      hoehe: hoeheNormalisieren(eintrag.hoehe),
      sichtbar: eintrag.sichtbar !== false
    });
  }

  // Was fehlt, kommt an der Stelle nach, die die Vorlage dafuer vorsieht.
  for (const fehlt of VORLAGEN[name].kacheln) {
    if (!gesehen.has(fehlt.id)) kacheln.push({ ...fehlt });
  }

  // Die Vorlage kennt nur die festen Kacheln. Eine frisch zugeschaltete Kachel
  // eines eigenen Reiters landet deshalb in der ersten Spalte und wird von dort
  // aus verschoben.
  for (const kachel of erlaubt) {
    if (!gesehen.has(kachel.id) && !kacheln.some((k) => k.id === kachel.id)) {
      kacheln.push(platz(kachel.id, 1));
    }
  }

  return { vorlage: name, kacheln, finanzenAnsicht };
};

/**
 * Reihenfolge fuer die eine Spalte am Handy. Feste Rangfolge nach Dringlichkeit,
 * aber alles, was auf dem grossen Bildschirm in einer Randleiste liegt, wandert
 * ans Ende — dort steht Nachschlagbares, kein Tagesgeschaeft.
 */
const handyReihenfolge = (kacheln) => {
  const rang = (k) => {
    const grund = HANDY_REIHENFOLGE.indexOf(k.id);
    const basis = grund === -1 ? HANDY_REIHENFOLGE.length : grund;
    return RANDLEISTEN.includes(k.spalte) ? basis + 100 : basis;
  };
  return [...kacheln].sort((a, b) => rang(a) - rang(b)).map((k) => k.id);
};

/* ------------------------------------------------------------ Reiter

   Die Kopfleiste stand frueher fest im HTML. Jetzt kommt sie aus der
   Konfiguration: die vorhandenen Reiter lassen sich umbenennen, ausblenden und
   verschieben, und es duerfen eigene dazukommen.

   `start` und `einstellungen` sind unveraenderlich sichtbar und bleiben vorn
   beziehungsweise hinten. Ohne diese Klammer koennte man sich aus den
   Einstellungen aussperren und haette keinen Weg zurueck ausser ueber die
   Sicherungsdatei.                                                           */

const REITER_FEST = [
  { id: 'start', name: 'Start' },
  { id: 'kalender', name: 'Kalender' },
  { id: 'aufgaben', name: 'Aufgaben' },
  { id: 'tsz', name: 'Tierschutzzentrum' },
  { id: 'finanzen', name: 'Finanzen' },
  { id: 'reime', name: 'Reime' },
  { id: 'suche', name: 'Suche' },
  { id: 'einstellungen', name: 'Einstellungen' }
];

const REITER_FEST_IDS = REITER_FEST.map((r) => r.id);
const REITER_UNVERAENDERLICH = ['start', 'einstellungen'];

const reiterText = (wert, vorgabe, max = 60) => {
  const s = String(wert == null ? '' : wert).trim().slice(0, max);
  return s || vorgabe;
};

/**
 * Reiterliste auf einen brauchbaren Stand bringen — genauso wegwerfend wie das
 * Startseitenlayout: eine kaputte Liste darf die Kopfleiste nicht kosten.
 * Unbekannte feste Kennungen fliegen raus, fehlende kommen in der Vorgabe-
 * reihenfolge nach, eigene Reiter behalten ihre Felder unangetastet (geprueft
 * werden die in eigene.js).
 */
const reiterNormalisieren = (wert) => {
  const liste = Array.isArray(wert) ? wert : [];
  const gesehen = new Set();
  const reiter = [];

  for (const eintrag of liste) {
    if (!eintrag || typeof eintrag !== 'object') continue;
    const id = String(eintrag.id || '').trim();
    if (!id || gesehen.has(id)) continue;
    const fest = REITER_FEST_IDS.includes(id);
    if (!fest && eintrag.typ !== 'eigen') continue;
    gesehen.add(id);

    const vorgabe = REITER_FEST.find((r) => r.id === id);
    reiter.push({
      id,
      name: reiterText(eintrag.name, vorgabe ? vorgabe.name : id),
      typ: fest ? 'fest' : 'eigen',
      sichtbar: REITER_UNVERAENDERLICH.includes(id) ? true : eintrag.sichtbar !== false,
      felder: fest ? [] : (Array.isArray(eintrag.felder) ? eintrag.felder : []),
      kachel: fest ? null : {
        aktiv: Boolean(eintrag.kachel && eintrag.kachel.aktiv),
        anzahl: Math.min(20, Math.max(1, Number(eintrag.kachel && eintrag.kachel.anzahl) || 6))
      }
    });
  }

  for (const vorgabe of REITER_FEST) {
    if (!gesehen.has(vorgabe.id)) {
      reiter.push({ id: vorgabe.id, name: vorgabe.name, typ: 'fest', sichtbar: true, felder: [], kachel: null });
    }
  }

  // Start vorn, Einstellungen hinten — dazwischen zaehlt die gespeicherte Folge.
  const rang = (r) => (r.id === 'start' ? -1 : r.id === 'einstellungen' ? 1 : 0);
  return reiter.sort((a, b) => rang(a) - rang(b));
};

const defaults = {
  'entries.json': {
    arten: ARTEN.map((a) => ({ ...a })),
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
  /* Reime, Zeilen und Texte. Silbenketten stehen hier bewusst nicht drin: sie
     werden beim Zeichnen gerechnet. Dauerhaft liegen nur die Texte selbst und
     das, was von Hand daran haengt — Korrekturen und Anmerkungen am Wort. */
  'reime.json': {
    woerter: {},
    gruppen: [],
    zeilen: [],
    texte: [],
    kategorien: { reime: [], zeilen: [], texte: [] },
    farben: {},
    anzeige: { faerbenZeilen: false, faerbenTexte: false, mindestKette: 2 }
  },
  'eigene.json': { eintraege: {} },
  'config.json': {
    eingerichtetAm: null,
    thema: 'kante',
    reiter: reiterNormalisieren([]),
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
const DATEIEN = ['entries.json', 'tasks.json', 'gemeinden.json', 'finanzen.json', 'reime.json', 'eigene.json', 'config.json'];

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
  ARTEN, ART_FRIST, ART_TERMIN, ART_AUFGABE,
  KACHELN, KACHEL_IDS, SPALTEN, RANDLEISTEN, BREITEN, MINDESTHOEHE,
  EIGEN_KACHEL, kachelListe,
  REITER_FEST, REITER_FEST_IDS, REITER_UNVERAENDERLICH, reiterNormalisieren,
  VORLAGEN, vorlage, startseiteNormalisieren, handyReihenfolge,
  laden, alles, beiAenderungSetzen, read, write, id, jetzt, heute
};
