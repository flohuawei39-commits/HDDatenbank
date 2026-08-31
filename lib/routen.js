/* Lokaler Vermittler.

   Frueher lief die Oberflaeche ueber HTTP gegen server.js. Der Server ist weg,
   die Routentabelle bleibt: ein Aufruf von ruf('GET', '/api/start') macht jetzt
   dasselbe wie frueher die Anfrage an den Server, nur ohne Netz dazwischen.

   Bewusst so gebaut, statt die Oberflaeche auf direkte Funktionsaufrufe
   umzuschreiben. Erstens bleiben damit rund 1.450 gepruefte Zeilen Bedienlogik
   unangetastet. Zweitens bleibt die Trennlinie zwischen Anzeige und Logik
   sichtbar, statt sich mit der Zeit zu verwischen.

   Was hier fehlt und frueher da war: die Anmelderouten. Die Anmeldung ist jetzt
   die Verschluesselung selbst und liegt in sync.js.                          */

import * as store from './store.js';
import * as D from './datum.js';
import * as wdh from './recurrence.js';
import { suche } from './search.js';
import * as quick from './quickparse.js';
import * as gemeindenModul from './gemeinden.js';
import * as mail from './mail.js';
import * as pdf from './pdf.js';
import * as banken from './banken.js';
import * as finanzen from './finanzen.js';
import * as reimedaten from './reimedaten.js';
import * as silben from './silben.js';
import * as eigene from './eigene.js';
import { sha256Hex } from './sha256.js';

const CAN_KATEGORIE = 'kat_can';
const FRIST_FENSTER = 14;
const PRIO_RANG = { hoch: 0, mittel: 1, gering: 2 };
const PRIOS = ['gering', 'mittel', 'hoch'];
const STATI = ['offen', 'laeuft', 'erledigt'];

const text = (wert, max = 2000) => String(wert == null ? '' : wert).trim().slice(0, max);
const datumOderNull = (wert) => (D.istISO(wert) ? wert : null);
const uhrzeitOderNull = (wert) => (/^\d{2}:\d{2}$/.test(String(wert || '')) ? wert : null);

const wiederholungPruefen = (wert) => {
  if (!wert || !wdh.TYPEN.includes(wert.typ)) return null;
  return {
    typ: wert.typ,
    intervall: Math.min(52, Math.max(1, Number(wert.intervall) || 1)),
    bis: datumOderNull(wert.bis)
  };
};

/**
 * Die Art eines Eintrags aus dem Altbestand ableiten.
 *
 * Ein gesetzter Fristhaken ist eindeutig. Sonst entscheidet die Uhrzeit: wer
 * sich eine Zeit notiert hat, hatte einen Termin im Sinn, alles andere war ein
 * Vorhaben. Nicht immer richtig, aber besser als alles in einen Topf zu werfen,
 * und von Hand jederzeit zu ändern.
 */
const artAusAltbestand = (eintrag) => {
  if (eintrag.istFrist) return store.ART_FRIST;
  return eintrag.uhrzeit ? store.ART_TERMIN : store.ART_AUFGABE;
};

const daten = () => {
  const e = store.read('entries.json');
  const t = store.read('tasks.json');
  const entries = Array.isArray(e.entries) ? e.entries : [];
  const arten = Array.isArray(e.arten) && e.arten.length ? e.arten : store.ARTEN.map((a) => ({ ...a }));

  // Einmalig nachtragen, was es vor der Art noch nicht gab. Geschrieben wird
  // das erst, wenn ohnehin etwas gespeichert wird.
  for (const eintrag of entries) {
    if (!eintrag.art) eintrag.art = artAusAltbestand(eintrag);
  }

  return {
    entries,
    arten,
    kategorien: Array.isArray(e.kategorien) ? e.kategorien : [],
    tasks: Array.isArray(t.tasks) ? t.tasks : []
  };
};

/** Alles, was Tagesmail und Suche brauchen. */
const bestand = () => ({ ...daten(), gemeinden: gemeindenModul.lesen() });

const entriesSchreiben = (entries, kategorien, arten = daten().arten) =>
  store.write('entries.json', { kategorien, arten, entries });
const tasksSchreiben = (tasks) => store.write('tasks.json', { tasks });

/** Ein Vorkommen in die Form bringen, die die Oberfläche anzeigt. */
const alsVorkommen = (eintrag, vorkommenDaten, tag) => ({
  id: eintrag.id,
  datum: tag,
  start: vorkommenDaten.start,
  ende: vorkommenDaten.ende,
  mehrtaegig: vorkommenDaten.start !== vorkommenDaten.ende,
  ersterTag: tag === vorkommenDaten.start,
  letzterTag: tag === vorkommenDaten.ende,
  uhrzeit: eintrag.uhrzeit,
  text: eintrag.text,
  kategorie: eintrag.kategorie,
  art: eintrag.art || artAusAltbestand(eintrag),
  prioritaet: eintrag.prioritaet,
  istFrist: Boolean(eintrag.istFrist),
  wiederkehrend: Boolean(eintrag.wiederholung),
  erledigt: erledigtAm(eintrag, vorkommenDaten.start)
});

const erledigtAm = (eintrag, start) => (eintrag.wiederholung
  ? (eintrag.erledigtAn || []).includes(start)
  : Boolean(eintrag.erledigt));

const nachTag = (entries, von, bis) => {
  const eimer = {};
  for (const eintrag of entries) {
    for (const v of wdh.vorkommen(eintrag, von, bis)) {
      for (const tag of v.tage) {
        if (tag < von || tag > bis) continue;
        (eimer[tag] = eimer[tag] || []).push(alsVorkommen(eintrag, v, tag));
      }
    }
  }
  for (const tag of Object.keys(eimer)) {
    eimer[tag].sort((a, b) => {
      if (a.istFrist !== b.istFrist) return a.istFrist ? -1 : 1;
      if (Boolean(a.uhrzeit) !== Boolean(b.uhrzeit)) return a.uhrzeit ? -1 : 1;
      if (a.uhrzeit && b.uhrzeit && a.uhrzeit !== b.uhrzeit) return a.uhrzeit < b.uhrzeit ? -1 : 1;
      return PRIO_RANG[a.prioritaet] - PRIO_RANG[b.prioritaet];
    });
  }
  return eimer;
};

// ---------------------------------------------------------------- Schreiboperationen

const eintragSpeichern = (koerper) => {
  const d = daten();
  const datum = datumOderNull(koerper.datum);
  if (!datum) return { fehler: 'Datum fehlt oder ist ungültig.' };
  const inhalt = text(koerper.text);
  if (!inhalt) return { fehler: 'Text fehlt.' };

  const bis = datumOderNull(koerper.datumBis);
  const uhrzeit = uhrzeitOderNull(koerper.uhrzeit);

  /* Die Art ist jetzt das Führende. `istFrist` bleibt als abgeleitetes Feld
     erhalten, damit Fristenkachel, Sortierung, Suche und Tagesmail nicht
     angefasst werden müssen. Kommt die Angabe aus der Schnellerfassung, steht
     dort noch der alte Fristhaken — der wird hier übersetzt. */
  const art = d.arten.some((a) => a.id === koerper.art)
    ? koerper.art
    : artAusAltbestand({ istFrist: koerper.istFrist, uhrzeit });

  const felder = {
    datum,
    datumBis: bis && bis >= datum ? bis : null,
    uhrzeit,
    text: inhalt,
    kategorie: d.kategorien.some((k) => k.id === koerper.kategorie) ? koerper.kategorie : null,
    art,
    prioritaet: PRIOS.includes(koerper.prioritaet) ? koerper.prioritaet : 'mittel',
    istFrist: art === store.ART_FRIST,
    wiederholung: wiederholungPruefen(koerper.wiederholung),
    geaendert: store.jetzt()
  };

  const vorhanden = d.entries.find((e) => e.id === koerper.id);
  if (vorhanden) {
    Object.assign(vorhanden, felder);
    if (!vorhanden.wiederholung) delete vorhanden.erledigtAn;
    entriesSchreiben(d.entries, d.kategorien);
    return { ok: true, eintrag: vorhanden };
  }

  const neu = {
    id: store.id('e'),
    ...felder,
    erledigt: false,
    erledigtAn: [],
    erstellt: store.jetzt()
  };
  entriesSchreiben([...d.entries, neu], d.kategorien);
  return { ok: true, eintrag: neu };
};

const erledigtSetzen = ({ id, datum, wert }) => {
  const d = daten();
  const eintrag = d.entries.find((e) => e.id === id);
  if (!eintrag) return { fehler: 'Eintrag nicht gefunden.' };

  if (eintrag.wiederholung) {
    const start = datumOderNull(datum);
    if (!start) return { fehler: 'Für eine Serie wird der Tag gebraucht.' };
    const liste = new Set(eintrag.erledigtAn || []);
    if (wert) liste.add(start); else liste.delete(start);
    eintrag.erledigtAn = [...liste].sort();
  } else {
    eintrag.erledigt = Boolean(wert);
  }
  eintrag.geaendert = store.jetzt();
  entriesSchreiben(d.entries, d.kategorien);
  return { ok: true };
};

const aufgabeSpeichern = (koerper) => {
  const tasks = daten().tasks;
  const titel = text(koerper.titel, 300);
  if (!titel) return { fehler: 'Titel fehlt.' };

  const felder = {
    titel,
    notiz: text(koerper.notiz, 4000),
    status: STATI.includes(koerper.status) ? koerper.status : 'offen',
    prioritaet: PRIOS.includes(koerper.prioritaet) ? koerper.prioritaet : 'mittel',
    faellig: datumOderNull(koerper.faellig),
    geaendert: store.jetzt()
  };

  const vorhanden = tasks.find((t) => t.id === koerper.id);
  if (vorhanden) {
    Object.assign(vorhanden, felder);
    tasksSchreiben(tasks);
    return { ok: true, aufgabe: vorhanden };
  }

  const neu = { id: store.id('t'), ...felder, erstellt: store.jetzt() };
  tasksSchreiben([...tasks, neu]);
  return { ok: true, aufgabe: neu };
};

const kategorieSpeichern = (koerper) => {
  const d = daten();
  const name = text(koerper.name, 60);
  if (!name) return { fehler: 'Name fehlt.' };
  const farbe = /^#[0-9a-f]{6}$/i.test(String(koerper.farbe || '')) ? koerper.farbe : store.NEON.cyan;

  const vorhanden = d.kategorien.find((k) => k.id === koerper.id);
  if (vorhanden) {
    vorhanden.name = name;
    vorhanden.farbe = farbe;
    entriesSchreiben(d.entries, d.kategorien);
    return { ok: true, kategorie: vorhanden };
  }

  const neu = { id: store.id('kat'), name, farbe };
  entriesSchreiben(d.entries, [...d.kategorien, neu]);
  return { ok: true, kategorie: neu };
};

const artSpeichern = (koerper) => {
  const d = daten();
  const name = text(koerper.name, 40);
  if (!name) return { fehler: 'Name fehlt.' };
  const farbe = /^#[0-9a-f]{6}$/i.test(String(koerper.farbe || '')) ? koerper.farbe : store.NEON.violett;

  const vorhanden = d.arten.find((a) => a.id === koerper.id);
  if (vorhanden) {
    vorhanden.name = name;
    vorhanden.farbe = farbe;
    entriesSchreiben(d.entries, d.kategorien, d.arten);
    return { ok: true, art: vorhanden };
  }

  const neu = { id: store.id('art'), name, farbe, fest: false };
  entriesSchreiben(d.entries, d.kategorien, [...d.arten, neu]);
  return { ok: true, art: neu };
};

// ---------------------------------------------------------------- Startseite

const startDaten = () => {
  const heute = store.heute();
  const morgen = D.plusTage(heute, 1);
  const fensterEnde = D.plusTage(heute, FRIST_FENSTER);
  const d = daten();
  const config = store.read('config.json');
  const reiter = store.reiterNormalisieren(config.reiter);

  /* Die Signalzeile fuehrt Fristen und Termine zusammen: beides ist ein fester
     Punkt in der Zukunft, an dem man irgendwo sein oder etwas fertig haben
     muss. Getrennt bleiben sie in der Anzeige ueber ihre Art. */
  const fristen = [];
  for (const eintrag of d.entries.filter((e) => e.istFrist || e.art === store.ART_TERMIN)) {
    const naechstes = wdh.naechstes(eintrag, heute);
    if (!naechstes || naechstes.start > fensterEnde) continue;
    if (erledigtAm(eintrag, naechstes.start)) continue;
    fristen.push({
      ...alsVorkommen(eintrag, naechstes, naechstes.start),
      tageBis: D.differenzTage(heute, naechstes.start)
    });
  }
  // Fristen aus den Gemeinde-Akten laufen in dieselbe Warnung.
  for (const frist of gemeindenModul.fristen(heute, fensterEnde)) {
    fristen.push({
      id: frist.id,
      gemeindeId: frist.gemeindeId,
      datum: frist.datum,
      start: frist.datum,
      ende: frist.datum,
      text: frist.text,
      kategorie: null,
      prioritaet: 'hoch',
      istFrist: true,
      istGemeinde: true,
      herkunft: frist.gemeinde,
      erledigt: false,
      tageBis: frist.tageBis
    });
  }
  // Nach Datum, und am selben Tag steht die Frist vor dem Termin.
  fristen.sort((a, b) => a.tageBis - b.tageBis
    || (a.istFrist === b.istFrist ? 0 : a.istFrist ? -1 : 1));

  const tage = nachTag(d.entries, heute, morgen);

  /* „Offene Aufgaben" führt beide Quellen zusammen: die eigenständige
     Aufgabenliste und die Kalendereinträge, die als Aufgabe markiert sind.
     Gespeichert bleiben sie getrennt — wer etwas als Aufgabe markiert, soll es
     aber unter den offenen Aufgaben wiederfinden und nicht nur im Kalender.
     `herkunft` sagt der Oberfläche, welcher Dialog sich beim Antippen öffnet. */
  const ausKalender = d.entries
    .filter((e) => e.art === store.ART_AUFGABE && !e.wiederholung && !e.erledigt)
    .map((e) => ({
      id: e.id,
      titel: e.text,
      faellig: e.datum,
      prioritaet: e.prioritaet,
      status: 'offen',
      herkunft: 'eintrag'
    }));

  const offeneAufgaben = [...d.tasks.filter((t) => t.status !== 'erledigt').map((t) => ({ ...t, herkunft: 'aufgabe' })), ...ausKalender]
    .sort((a, b) => {
      const p = PRIO_RANG[a.prioritaet] - PRIO_RANG[b.prioritaet];
      if (p) return p;
      if (a.faellig && b.faellig) return a.faellig < b.faellig ? -1 : 1;
      if (a.faellig) return -1;
      if (b.faellig) return 1;
      return 0;
    })
    .slice(0, 12);

  // Absteigend nach Datum, damit zukünftige Einträge oben stehen.
  const canListe = d.entries
    .filter((e) => e.kategorie === CAN_KATEGORIE)
    .sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0))
    .slice(0, 10)
    .map((e) => ({ id: e.id, datum: e.datum, text: e.text, tageHer: D.differenzTage(e.datum, heute) }));

  return {
    heute,
    morgen,
    fristen,
    heuteEintraege: tage[heute] || [],
    morgenEintraege: tage[morgen] || [],
    heuteAufgaben: d.tasks.filter((t) => t.status !== 'erledigt' && t.faellig && t.faellig <= heute),
    offeneAufgaben,
    canListe,
    canKategorie: d.kategorien.find((k) => k.id === CAN_KATEGORIE) || null,
    kategorien: d.kategorien,
    arten: d.arten,
    // Gemeinden, bei denen etwas offen ist oder liegen bleibt. Aufgaben ohne
    // Datum erreichen nur diese Kachel, nicht die Signalzeile und nicht die Mail.
    gemeinden: gemeindenModul.uebersicht(heute)
      .filter((g) => !['zusage', 'absage'].includes(g.stand)
        && (g.offeneAufgaben > 0 || g.tageStill === null || g.tageStill >= 14))
      .slice(0, 8)
      .map((g) => ({
        id: g.id,
        name: g.name,
        stand: g.stand,
        tageStill: g.tageStill,
        letzterSchritt: g.letzterSchritt,
        offeneAufgaben: g.offeneAufgaben,
        aufgaben: g.aufgabenListe
      })),
    finanzen: finanzen.kachel(heute),
    thema: config.thema || 'kante',
    reiter,
    // Je zugeschalteter eigener Reiter eine Kachel mit seinen letzten Eintraegen.
    eigenKacheln: reiter
      .filter((r) => r.typ === 'eigen' && r.kachel && r.kachel.aktiv)
      .map((r) => ({
        id: store.EIGEN_KACHEL(r.id),
        reiterId: r.id,
        name: r.name,
        zeilen: eigene.kachelZeilen(r, r.kachel.anzahl)
      })),
    startseite: store.startseiteNormalisieren(config.startseite, reiter)
  };
};

// ---------------------------------------------------------------- Reiter

const reiterLesen = () => store.reiterNormalisieren(store.read('config.json').reiter);

const reiterSchreiben = (reiter) => {
  const config = store.read('config.json');
  const sauber = store.reiterNormalisieren(reiter);
  store.write('config.json', {
    ...config,
    reiter: sauber,
    // Faellt eine Kachel weg oder kommt eine dazu, muss das Layout mitziehen.
    startseite: store.startseiteNormalisieren(config.startseite, sauber)
  });
  return sauber;
};

/**
 * Reiter anlegen oder aendern. Feste Reiter tragen nur Namen und Sichtbarkeit;
 * bei eigenen kommen Felder und Kachel dazu. `start` und `einstellungen` lassen
 * sich nicht ausblenden — darum kuemmert sich schon die Normalisierung.
 */
const reiterSpeichern = (koerper) => {
  const liste = reiterLesen();
  const id = text(koerper.id, 40);
  const stelle = id ? liste.findIndex((r) => r.id === id) : -1;
  const name = text(koerper.name, 60);

  if (stelle < 0) {
    if (!name) return { fehler: 'Ohne Namen geht es nicht.' };
    const neu = {
      id: store.id('rtr'),
      name,
      typ: 'eigen',
      sichtbar: true,
      felder: eigene.felderNormalisieren(koerper.felder),
      kachel: { aktiv: Boolean(koerper.kachel && koerper.kachel.aktiv), anzahl: 6 }
    };
    // Neue Reiter kommen vor die Einstellungen, nicht dahinter.
    const vorEinstellungen = liste.findIndex((r) => r.id === 'einstellungen');
    liste.splice(vorEinstellungen < 0 ? liste.length : vorEinstellungen, 0, neu);
    reiterSchreiben(liste);
    return { ok: true, id: neu.id };
  }

  const alt = liste[stelle];
  liste[stelle] = {
    ...alt,
    name: name || alt.name,
    sichtbar: koerper.sichtbar === undefined ? alt.sichtbar : Boolean(koerper.sichtbar),
    felder: alt.typ === 'eigen' && koerper.felder !== undefined
      ? eigene.felderNormalisieren(koerper.felder)
      : alt.felder,
    kachel: alt.typ === 'eigen'
      ? {
        aktiv: koerper.kachel && koerper.kachel.aktiv !== undefined
          ? Boolean(koerper.kachel.aktiv) : alt.kachel.aktiv,
        anzahl: koerper.kachel && koerper.kachel.anzahl ? Number(koerper.kachel.anzahl) : alt.kachel.anzahl
      }
      : null
  };
  reiterSchreiben(liste);
  return { ok: true, id: alt.id };
};

const reiterReihenfolge = (ids) => {
  const liste = reiterLesen();
  const folge = (Array.isArray(ids) ? ids : []).map((i) => text(i, 40));
  const sortiert = [
    ...folge.map((i) => liste.find((r) => r.id === i)).filter(Boolean),
    ...liste.filter((r) => !folge.includes(r.id))
  ];
  return { ok: true, reiter: reiterSchreiben(sortiert) };
};

const reiterLoeschen = (id) => {
  const liste = reiterLesen();
  const ziel = liste.find((r) => r.id === id);
  if (!ziel) return { fehler: 'Reiter nicht gefunden.' };
  if (ziel.typ !== 'eigen') return { fehler: `„${ziel.name}" gehört fest zur Anwendung und lässt sich nur ausblenden.` };

  eigene.reiterEntfernen(id);
  reiterSchreiben(liste.filter((r) => r.id !== id));
  return { ok: true };
};

// ---------------------------------------------------------------- Routentabelle

class RouteFehler extends Error {
  constructor(nachricht, status = 400) {
    super(nachricht);
    this.status = status;
  }
}

/**
 * Der Vermittler. `pfad` ist der frueherer Serverpfad samt Abfrageteil,
 * `koerper` das, was frueher als JSON im Rumpf stand.
 */
const ruf = async (methode, pfad, koerper = {}) => {
  const url = new URL(pfad, 'http://lokal');
  const p = url.pathname;
  const frage = url.searchParams;
  const M = methode.toUpperCase();

  // ---- Kalender und Aufgaben ---------------------------------------------

  if (p === '/api/daten' && M === 'GET') return { ...daten(), heute: store.heute() };

  if (p === '/api/monat' && M === 'GET') {
    const jahr = Number(frage.get('jahr'));
    const monat = Number(frage.get('monat'));
    if (!jahr || monat < 1 || monat > 12) throw new RouteFehler('Jahr oder Monat fehlt.');
    const gitter = D.monatsGitter(jahr, monat);
    const d = daten();
    const tage = nachTag(d.entries, gitter[0], gitter[gitter.length - 1]);
    const aufgaben = {};
    for (const t of d.tasks) {
      if (!t.faellig || t.status === 'erledigt') continue;
      if (t.faellig < gitter[0] || t.faellig > gitter[gitter.length - 1]) continue;
      (aufgaben[t.faellig] = aufgaben[t.faellig] || []).push({ id: t.id, titel: t.titel, prioritaet: t.prioritaet });
    }
    return { jahr, monat, gitter, tage, aufgaben, heute: store.heute() };
  }

  if (p === '/api/start' && M === 'GET') return startDaten();

  if (p === '/api/suche' && M === 'GET') {
    return suche(frage.get('q') || '', bestand(), frage.get('scope') || 'alle');
  }

  if (p === '/api/schnell' && M === 'POST') {
    return quick.parse(koerper.text, daten().kategorien, store.heute());
  }

  if (p === '/api/eintrag' && M === 'POST') return eintragSpeichern(koerper);

  if (p === '/api/eintrag' && M === 'DELETE') {
    const d = daten();
    const rest = d.entries.filter((e) => e.id !== frage.get('id'));
    if (rest.length === d.entries.length) throw new RouteFehler('Eintrag nicht gefunden.', 404);
    entriesSchreiben(rest, d.kategorien);
    return { ok: true };
  }

  if (p === '/api/eintrag/erledigt' && M === 'POST') return erledigtSetzen(koerper);

  if (p === '/api/aufgabe' && M === 'POST') return aufgabeSpeichern(koerper);

  if (p === '/api/aufgabe' && M === 'DELETE') {
    const tasks = daten().tasks;
    const rest = tasks.filter((t) => t.id !== frage.get('id'));
    if (rest.length === tasks.length) throw new RouteFehler('Aufgabe nicht gefunden.', 404);
    tasksSchreiben(rest);
    return { ok: true };
  }

  // ---- Tierschutzzentrum --------------------------------------------------

  if (p === '/api/gemeinden' && M === 'GET') {
    return { gemeinden: gemeindenModul.uebersicht(store.heute()), staende: store.STAENDE, heute: store.heute() };
  }

  if (p === '/api/gemeinde' && M === 'POST') return gemeindenModul.speichern(koerper);
  if (p === '/api/gemeinde' && M === 'DELETE') return gemeindenModul.loeschen(frage.get('id'));

  if (p === '/api/gemeinde/verlauf' && M === 'POST') return gemeindenModul.verlaufSpeichern(koerper);
  if (p === '/api/gemeinde/verlauf' && M === 'DELETE') {
    return gemeindenModul.verlaufLoeschen(frage.get('gemeinde'), frage.get('id'));
  }

  if (p === '/api/gemeinde/frist' && M === 'POST') return gemeindenModul.fristSpeichern(koerper);
  if (p === '/api/gemeinde/frist' && M === 'DELETE') {
    return gemeindenModul.fristLoeschen(frage.get('gemeinde'), frage.get('id'));
  }

  // Dokument: das PDF wird gelesen und verworfen, abgelegt wird nur der Text.
  if (p === '/api/gemeinde/dokument' && M === 'POST') return gemeindenModul.dokumentAblegen(koerper);
  if (p === '/api/gemeinde/dokument' && M === 'DELETE') {
    return gemeindenModul.dokumentLoeschen(frage.get('gemeinde'), frage.get('id'));
  }

  // ---- Finanzen -----------------------------------------------------------

  if (p === '/api/finanzen' && M === 'GET') {
    return finanzen.auswertung({
      von: datumOderNull(frage.get('von')),
      bis: datumOderNull(frage.get('bis')),
      bereich: finanzen.BEREICHE.includes(frage.get('bereich')) ? frage.get('bereich') : null
    });
  }

  if (p === '/api/finanzen/import' && M === 'POST') return finanzen.uebernehmen(koerper);
  if (p === '/api/finanzen/buchung' && M === 'POST') return finanzen.buchungAendern(koerper);
  if (p === '/api/finanzen/regel' && M === 'POST') return finanzen.regelSpeichern(koerper);
  if (p === '/api/finanzen/regel' && M === 'DELETE') return finanzen.regelLoeschen(frage.get('id'));

  if (p === '/api/finanzen/regeln' && M === 'GET') {
    const d = finanzen.lesen();
    return { regeln: d.regeln, kategorien: d.kategorien, importe: d.importe.slice(-10).reverse() };
  }

  if (p === '/api/finanzen/regeln/anwenden' && M === 'POST') {
    return finanzen.regelnAnwenden(koerper.nurLeere !== false);
  }

  if (p === '/api/finanzen/kategorie' && M === 'POST') return finanzen.kategorieSpeichern(koerper);
  if (p === '/api/finanzen/kategorie' && M === 'DELETE') return finanzen.kategorieLoeschen(frage.get('id'));

  // ---- Einstellungen und Mail ---------------------------------------------

  if (p === '/api/einstellungen' && M === 'GET') {
    const config = store.read('config.json');
    const m = config.mail || {};
    const reiter = store.reiterNormalisieren(config.reiter);
    return {
      thema: config.thema || 'kante',
      startseite: store.startseiteNormalisieren(config.startseite, reiter),
      kacheln: store.kachelListe(reiter),
      reiter,
      feldTypen: eigene.FELD_TYPEN,
      reime: (() => {
        const r = reimedaten.lesen();
        return { farben: r.farben, anzeige: r.anzeige, kategorien: r.kategorien, laute: silben.LAUTE };
      })(),
      vorlagen: Object.entries(store.VORLAGEN).map(([id, v]) => ({ id, name: v.name })),
      mail: {
        aktiv: Boolean(m.aktiv),
        empfaenger: m.empfaenger || null,
        uhrzeit: m.uhrzeit || '07:00',
        schluesselGesetzt: Boolean(mail.schluesselHolen(config)),
        ausUmgebung: false,
        letzterVersand: m.letzterVersand || null,
        letzterFehler: m.letzterFehler || null
      }
    };
  }

  if (p === '/api/einstellungen' && M === 'POST') {
    const config = store.read('config.json');
    const m = config.mail || {};
    const neu = { ...config };

    if (['kante', 'ruhe', 'linie'].includes(koerper.thema)) neu.thema = koerper.thema;

    const reiter = store.reiterNormalisieren(config.reiter);

    // "vorlage" allein setzt das ganze Layout zurueck, "startseite" einzelne Kacheln.
    if (typeof koerper.vorlage === 'string') {
      neu.startseite = store.startseiteNormalisieren(store.vorlage(koerper.vorlage), reiter);
    } else if (koerper.startseite) {
      neu.startseite = store.startseiteNormalisieren(koerper.startseite, reiter);
    }

    if (koerper.mail) {
      neu.mail = {
        ...m,
        aktiv: Boolean(koerper.mail.aktiv),
        empfaenger: text(koerper.mail.empfaenger, 200) || m.empfaenger || null,
        uhrzeit: uhrzeitOderNull(koerper.mail.uhrzeit) || m.uhrzeit || '07:00',
        // Leeres Feld bedeutet "unverändert lassen", nicht "löschen".
        schluessel: koerper.mail.schluessel === null ? null
          : (text(koerper.mail.schluessel, 200) || m.schluessel || null)
      };
    }

    store.write('config.json', neu);
    return { ok: true, startseite: store.startseiteNormalisieren(neu.startseite, reiter) };
  }

  if (p === '/api/mail/vorschau' && M === 'POST') {
    const nachricht = mail.bauen(bestand(), store.heute());
    return nachricht.leer ? { leer: true } : nachricht;
  }

  // Die Seite fragt, ob etwas zu verschicken ist, schickt es ab und meldet zurueck.
  if (p === '/api/mail/faellig' && M === 'GET') return mail.auftrag(bestand);
  if (p === '/api/mail/quittung' && M === 'POST') return mail.quittieren(Boolean(koerper.ok), koerper.fehler);
  if (p === '/api/mail/test' && M === 'POST') return mail.testAuftrag(bestand);

  // ---- Kalenderkategorien --------------------------------------------------

  if (p === '/api/kategorie' && M === 'POST') return kategorieSpeichern(koerper);

  if (p === '/api/kategorie' && M === 'DELETE') {
    const d = daten();
    const id = frage.get('id');
    const benutzt = d.entries.filter((e) => e.kategorie === id).length;
    if (benutzt) {
      throw new RouteFehler(`Kategorie wird von ${benutzt} ${benutzt === 1 ? 'Eintrag' : 'Einträgen'} benutzt.`, 409);
    }
    entriesSchreiben(d.entries, d.kategorien.filter((k) => k.id !== id));
    return { ok: true };
  }

  // ---- Eintragsarten -------------------------------------------------------

  if (p === '/api/art' && M === 'POST') return artSpeichern(koerper);

  if (p === '/api/art' && M === 'DELETE') {
    const d = daten();
    const id = frage.get('id');
    const art = d.arten.find((a) => a.id === id);
    if (!art) throw new RouteFehler('Art nicht gefunden.', 404);
    // Frist haengt an der Fristenkachel, der Sortierung und der Tagesmail.
    if (art.fest) throw new RouteFehler(`„${art.name}" ist fest und lässt sich nicht entfernen.`, 409);

    const benutzt = d.entries.filter((e) => e.art === id).length;
    if (benutzt) {
      throw new RouteFehler(`Art wird von ${benutzt} ${benutzt === 1 ? 'Eintrag' : 'Einträgen'} benutzt.`, 409);
    }
    entriesSchreiben(d.entries, d.kategorien, d.arten.filter((a) => a.id !== id));
    return { ok: true };
  }

  // ---- Reime, Zeilen und Texte ---------------------------------------------

  if (p === '/api/reime' && M === 'GET') {
    return reimedaten.ansicht(frage.get('bereich') || 'reime', frage.get('kategorie') || null);
  }

  if (p === '/api/reime/gruppe' && M === 'POST') return reimedaten.gruppeSpeichern(koerper);
  if (p === '/api/reime/gruppe' && M === 'DELETE') return reimedaten.gruppeLoeschen(frage.get('id'));
  if (p === '/api/reime/gruppe/sortieren' && M === 'POST') return reimedaten.gruppeSortieren(koerper.gruppe);

  if (p === '/api/reime/eintrag' && M === 'POST') return reimedaten.eintragSpeichern(koerper);
  if (p === '/api/reime/eintrag' && M === 'DELETE') {
    return reimedaten.eintragLoeschen(frage.get('gruppe'), frage.get('id'));
  }

  if (p === '/api/reime/zeile' && M === 'POST') return reimedaten.zeileSpeichern(koerper);
  if (p === '/api/reime/zeile' && M === 'DELETE') return reimedaten.zeileLoeschen(frage.get('id'));

  if (p === '/api/reime/text' && M === 'POST') return reimedaten.textSpeichern(koerper);
  if (p === '/api/reime/text' && M === 'DELETE') return reimedaten.textLoeschen(frage.get('id'));

  // Anmerkungen haengen am Wort und wirken damit ueberall gleichzeitig.
  if (p === '/api/reime/wort' && M === 'POST') return reimedaten.wortSpeichern(koerper);

  if (p === '/api/reime/kategorie' && M === 'POST') return reimedaten.kategorieSpeichern(koerper);
  if (p === '/api/reime/kategorie' && M === 'DELETE') {
    return reimedaten.kategorieLoeschen(frage.get('bereich'), frage.get('id'));
  }

  if (p === '/api/reime/verschieben' && M === 'POST') return reimedaten.eintragVerschieben(koerper);
  if (p === '/api/reime/kategorie/verschieben' && M === 'POST') return reimedaten.kategorieVerschieben(koerper);

  if (p === '/api/reime/anzeige' && M === 'POST') return reimedaten.anzeigeSpeichern(koerper);

  if (p === '/api/reime/suche' && M === 'GET') {
    return reimedaten.suche((frage.get('muster') || '').split(',').filter(Boolean), {
      budget: Number(frage.get('budget')) || 0,
      nurEnde: frage.get('nurEnde') === '1'
    });
  }

  if (p === '/api/reime/rat' && M === 'POST') {
    return reimedaten.rat(koerper.text, { ausser: koerper.ausser, gruppe: koerper.gruppe, mindest: koerper.mindest });
  }

  // ---- Reiter und eigene Bereiche ------------------------------------------

  if (p === '/api/reiter' && M === 'GET') {
    return { reiter: reiterLesen(), feldTypen: eigene.FELD_TYPEN, maxFelder: eigene.MAX_FELDER };
  }

  if (p === '/api/reiter' && M === 'POST') return reiterSpeichern(koerper);
  if (p === '/api/reiter/reihenfolge' && M === 'POST') return reiterReihenfolge(koerper.ids);
  if (p === '/api/reiter' && M === 'DELETE') return reiterLoeschen(frage.get('id'));

  if (p === '/api/eigen' && M === 'GET') {
    const reiter = reiterLesen().find((r) => r.id === frage.get('reiter'));
    if (!reiter || reiter.typ !== 'eigen') throw new RouteFehler('Reiter nicht gefunden.', 404);
    const felder = eigene.felderNormalisieren(reiter.felder);
    return {
      reiter: { id: reiter.id, name: reiter.name, kachel: reiter.kachel },
      felder,
      feldTypen: eigene.FELD_TYPEN,
      eintraege: eigene.abfragen(reiter.id, felder, {
        suche: frage.get('suche'),
        sortFeld: frage.get('sortFeld'),
        richtung: frage.get('richtung')
      })
    };
  }

  if (p === '/api/eigen' && M === 'POST') {
    const reiter = reiterLesen().find((r) => r.id === text(koerper.reiter, 40));
    if (!reiter || reiter.typ !== 'eigen') throw new RouteFehler('Reiter nicht gefunden.', 404);
    return eigene.speichern(reiter.id, eigene.felderNormalisieren(reiter.felder), koerper);
  }

  if (p === '/api/eigen' && M === 'DELETE') return eigene.loeschen(frage.get('reiter'), frage.get('id'));

  throw new RouteFehler(`Unbekannter Endpunkt: ${M} ${p}`, 404);
};

// ---------------------------------------------------------------- PDF

/**
 * Kontoauszug einlesen. Die Datei bleibt im Arbeitsspeicher und wird nach dem
 * Auslesen verworfen; gespeichert werden nur die erkannten Buchungen.
 */
const auszugLesen = async (puffer, dateiName) => {
  const bytes = new Uint8Array(puffer);
  if (!bytes.length) return { fehler: 'Die Datei ist leer.' };
  const anfang = String.fromCharCode(...bytes.slice(0, 5));
  if (anfang !== '%PDF-') return { fehler: 'Das ist keine PDF-Datei.' };

  const hash = sha256Hex(bytes).slice(0, 32);
  let seiten;
  try {
    seiten = await pdf.lesen(bytes);
  } catch (fehler) {
    return { fehler: `PDF nicht lesbar: ${fehler.message}` };
  }
  const auswertung = banken.auswerten(seiten);
  if (auswertung.fehler) return auswertung;
  return finanzen.vorschau(auswertung, hash, dateiName);
};

/**
 * Beliebiges PDF zu Text machen, fuer die Gemeinde-Akten. Kein Bankformat
 * noetig, es wird schlicht die Textebene ausgelesen.
 */
const dokumentLesen = async (puffer) => {
  const bytes = new Uint8Array(puffer);
  if (!bytes.length) return { fehler: 'Die Datei ist leer.' };
  if (String.fromCharCode(...bytes.slice(0, 5)) !== '%PDF-') return { fehler: 'Das ist keine PDF-Datei.' };

  let seiten;
  try {
    seiten = await pdf.lesen(bytes);
  } catch (fehler) {
    return { fehler: `PDF nicht lesbar: ${fehler.message}` };
  }
  const text = seiten
    .map((s) => s.zeilen.map((z) => z.text).join('\n'))
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    ok: true,
    seiten: seiten.length,
    text,
    // Eingescannte Schreiben haben keine Textebene; das muss die Oberflaeche sagen.
    leer: text.length === 0
  };
};

export { ruf, auszugLesen, dokumentLesen, RouteFehler, daten, bestand, startDaten };
