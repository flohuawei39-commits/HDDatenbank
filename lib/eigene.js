/* Eigene Reiter: Feldschema und Eintraege.

   Was hier liegt, ist bewusst duenn. Ein eigener Reiter ist eine Liste von
   Eintraegen, und ein Eintrag ist eine Karte aus Feldwerten. Alles, was die
   festen Reiter koennen — Serien, Fristen, Kontoauszuege —, koennen die eigenen
   ausdruecklich nicht; sonst waere aus dem Dashboard eine halbe Datenbank
   geworden.

   Ein entferntes Feld nimmt seine Werte nicht mit: sie bleiben im Eintrag
   liegen und werden nur nicht mehr angezeigt. Wer sich vergreift, kann das Feld
   wieder anlegen und hat seine Werte zurueck.                                */

import * as store from './store.js';

const FELD_TYPEN = [
  { id: 'text', name: 'Text' },
  { id: 'mehrzeilig', name: 'Mehrzeiliger Text' },
  { id: 'zahl', name: 'Zahl' },
  { id: 'geld', name: 'Geld' },
  { id: 'datum', name: 'Datum' },
  { id: 'auswahl', name: 'Auswahl' },
  { id: 'haken', name: 'Haken' }
];

const TYP_IDS = FELD_TYPEN.map((t) => t.id);
const MAX_FELDER = 20;
const MAX_EINTRAEGE = 5000;

const text = (wert, max = 500) => String(wert == null ? '' : wert).trim().slice(0, max);
const istISO = (wert) => /^\d{4}-\d{2}-\d{2}$/.test(String(wert || ''));

/** Ein Feld auf eine brauchbare Form bringen. Ohne Namen ist es keins. */
const feldNormalisieren = (wert) => {
  const roh = wert && typeof wert === 'object' ? wert : {};
  const typ = TYP_IDS.includes(roh.typ) ? roh.typ : 'text';
  return {
    id: text(roh.id, 40) || store.id('feld'),
    name: text(roh.name, 60),
    typ,
    pflicht: Boolean(roh.pflicht),
    optionen: typ === 'auswahl'
      ? (Array.isArray(roh.optionen) ? roh.optionen : []).map((o) => text(o, 60)).filter(Boolean).slice(0, 30)
      : []
  };
};

const felderNormalisieren = (liste) => (Array.isArray(liste) ? liste : [])
  .slice(0, MAX_FELDER)
  .map(feldNormalisieren)
  .filter((f) => f.name);

/** Rohwert aus dem Dialog in die Form bringen, in der er abgelegt wird. */
const wertLesen = (feld, roh) => {
  switch (feld.typ) {
    case 'haken':
      return Boolean(roh);
    case 'zahl':
    case 'geld': {
      if (roh === '' || roh == null) return null;
      // Deutsche Schreibweise mit Komma soll genauso durchgehen.
      const zahl = Number(String(roh).replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(zahl) ? zahl : null;
    }
    case 'datum':
      return istISO(roh) ? roh : null;
    case 'auswahl':
      return feld.optionen.includes(text(roh, 60)) ? text(roh, 60) : null;
    case 'mehrzeilig':
      return text(roh, 4000) || null;
    default:
      return text(roh, 500) || null;
  }
};

/**
 * Eintrag gegen das Feldschema pruefen. Rueckgabe traegt entweder `fehler`
 * oder die fertigen `werte`; geschrieben wird erst danach.
 */
const eintragPruefen = (felder, koerper) => {
  const roh = (koerper && typeof koerper.werte === 'object' && koerper.werte) || {};
  const werte = {};
  for (const feld of felder) {
    const wert = wertLesen(feld, roh[feld.id]);
    if (feld.pflicht && (wert === null || wert === '' || wert === false)) {
      return { fehler: `„${feld.name}" ist ein Pflichtfeld.` };
    }
    werte[feld.id] = wert;
  }
  return { werte };
};

const lesen = () => {
  const d = store.read('eigene.json');
  return { eintraege: d && typeof d.eintraege === 'object' && d.eintraege ? d.eintraege : {} };
};

const schreiben = (eintraege) => store.write('eigene.json', { eintraege });

const listen = (reiterId) => {
  const alle = lesen().eintraege;
  return Array.isArray(alle[reiterId]) ? alle[reiterId] : [];
};

/**
 * Anlegen oder aendern. Alte Werte bleiben erhalten, damit ein zwischenzeitlich
 * entferntes Feld seine Inhalte behaelt.
 */
const speichern = (reiterId, felder, koerper) => {
  const geprueft = eintragPruefen(felder, koerper);
  if (geprueft.fehler) return geprueft;

  const alle = lesen().eintraege;
  const liste = Array.isArray(alle[reiterId]) ? [...alle[reiterId]] : [];
  const id = text(koerper.id, 40);
  const vorhanden = id ? liste.findIndex((e) => e.id === id) : -1;

  if (vorhanden >= 0) {
    liste[vorhanden] = {
      ...liste[vorhanden],
      werte: { ...liste[vorhanden].werte, ...geprueft.werte },
      geaendert: store.jetzt()
    };
  } else {
    if (liste.length >= MAX_EINTRAEGE) return { fehler: 'Dieser Reiter ist voll.' };
    liste.unshift({
      id: store.id('eig'),
      werte: geprueft.werte,
      angelegt: store.jetzt(),
      geaendert: store.jetzt()
    });
  }

  schreiben({ ...alle, [reiterId]: liste });
  return { ok: true };
};

const loeschen = (reiterId, id) => {
  const alle = lesen().eintraege;
  const liste = Array.isArray(alle[reiterId]) ? alle[reiterId] : [];
  const rest = liste.filter((e) => e.id !== id);
  if (rest.length === liste.length) return { fehler: 'Eintrag nicht gefunden.' };
  schreiben({ ...alle, [reiterId]: rest });
  return { ok: true };
};

/** Beim Entfernen eines Reiters: sein ganzer Bestand geht mit. */
const reiterEntfernen = (reiterId) => {
  const alle = { ...lesen().eintraege };
  delete alle[reiterId];
  schreiben(alle);
};

/**
 * Sortierte und gefilterte Sicht. Sortiert wird nach einem Feld oder nach dem
 * Anlagedatum; gesucht wird ueber alle Textfelder auf einmal.
 */
const abfragen = (reiterId, felder, wahl = {}) => {
  const suchwort = text(wahl.suche, 100).toLowerCase();
  const sortFeld = felder.find((f) => f.id === wahl.sortFeld) || null;
  const abwaerts = wahl.richtung === 'ab';

  let liste = listen(reiterId);

  if (suchwort) {
    liste = liste.filter((e) => Object.values(e.werte || {})
      .some((w) => typeof w === 'string' && w.toLowerCase().includes(suchwort)));
  }

  liste = [...liste].sort((a, b) => {
    const wa = sortFeld ? a.werte[sortFeld.id] : a.angelegt;
    const wb = sortFeld ? b.werte[sortFeld.id] : b.angelegt;
    // Leere Felder sammeln sich am Ende, statt die Sortierung zu zerreissen.
    if (wa == null && wb == null) return 0;
    if (wa == null) return 1;
    if (wb == null) return -1;
    if (typeof wa === 'number' && typeof wb === 'number') return abwaerts ? wb - wa : wa - wb;
    const va = String(wa);
    const vb = String(wb);
    return abwaerts ? vb.localeCompare(va, 'de') : va.localeCompare(vb, 'de');
  });

  return liste;
};

/** Einen Wert so hinschreiben, wie er gelesen werden soll. */
const alsText = (feld, wert) => {
  if (wert === null || wert === undefined || wert === '') return '';
  if (feld.typ === 'haken') return wert ? 'ja' : 'nein';
  if (feld.typ === 'geld') return `${Number(wert).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  if (feld.typ === 'zahl') return Number(wert).toLocaleString('de-DE');
  if (feld.typ === 'datum') return `${Number(wert.slice(8))}.${Number(wert.slice(5, 7))}.`;
  return String(wert);
};

/** Was die Startseiten-Kachel eines eigenen Reiters zeigt. */
const kachelZeilen = (reiter, anzahl = 6) => {
  const felder = felderNormalisieren(reiter.felder);
  const erstes = felder[0] || null;
  const zweites = felder.find((f) => f.id !== (erstes && erstes.id) && f.typ !== 'mehrzeilig') || null;
  return listen(reiter.id).slice(0, anzahl).map((e) => ({
    id: e.id,
    titel: (erstes && alsText(erstes, e.werte[erstes.id])) || '—',
    neben: zweites ? alsText(zweites, e.werte[zweites.id]) : ''
  }));
};

export {
  FELD_TYPEN, TYP_IDS, MAX_FELDER,
  feldNormalisieren, felderNormalisieren, wertLesen, eintragPruefen,
  lesen, listen, speichern, loeschen, reiterEntfernen, abfragen, alsText, kachelZeilen
};
