import * as store from './store.js';
import { sha256Hex } from './sha256.js';

const BEREICHE = ['privat', 'geschaeftlich'];

/* Sammelname für Buchungen, denen kein Einleser eine Bank angehängt hat. */
const OHNE_BANK = 'Sonstige';

/* Startkategorien: bewusst an der Einteilung von N26 ausgerichtet, damit die
   Kategorie aus dem Auszug beim ersten Import meistens direkt passt. */
const START_KATEGORIEN = [
  { id: 'fk_lebensmittel', name: 'Lebensmittel', farbe: '#3ddc84' },
  { id: 'fk_restaurant', name: 'Bars & Restaurants', farbe: '#ffb454' },
  { id: 'fk_transport', name: 'Transport', farbe: '#34e2e2' },
  { id: 'fk_shopping', name: 'Shopping', farbe: '#a988ff' },
  { id: 'fk_gesundheit', name: 'Gesundheit & Drogerien', farbe: '#ff5fd2' },
  { id: 'fk_sport', name: 'Sport', farbe: '#5fd39a' },
  { id: 'fk_tiere', name: 'Tiere & Haltung', farbe: '#56c8d8' },
  { id: 'fk_freizeit', name: 'Freizeit', farbe: '#e07ac2' },
  { id: 'fk_medien', name: 'Medien & Telekom', farbe: '#a08fd8' },
  { id: 'fk_wohnen', name: 'Wohnen & Nebenkosten', farbe: '#e0a86a' },
  { id: 'fk_versicherung', name: 'Versicherungen', farbe: '#8b9099' },
  { id: 'fk_beruf', name: 'Berufsausgaben', farbe: '#ff7a6b' },
  { id: 'fk_einnahme', name: 'Einnahmen', farbe: '#3ddc84' },
  { id: 'fk_sonstiges', name: 'Sonstiges', farbe: '#636872' }
];

const leer = () => ({ buchungen: [], kategorien: START_KATEGORIEN.map((k) => ({ ...k })), regeln: [], importe: [] });

const lesen = () => {
  const daten = store.read('finanzen.json');
  return {
    buchungen: Array.isArray(daten.buchungen) ? daten.buchungen : [],
    kategorien: Array.isArray(daten.kategorien) && daten.kategorien.length ? daten.kategorien : leer().kategorien,
    regeln: Array.isArray(daten.regeln) ? daten.regeln : [],
    importe: Array.isArray(daten.importe) ? daten.importe : []
  };
};

const schreiben = (daten) => store.write('finanzen.json', daten);

const rund = (n) => Math.round(n * 100) / 100;
const normal = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- Erkennung von Dubletten

/**
 * Kennung einer Buchung. Bewusst ohne laufende Nummer der Bank: die steht nicht
 * in jedem Auszug. Kommt dieselbe Kombination im selben Auszug mehrfach vor
 * (zweimal derselbe Betrag beim selben Händler am selben Tag), wird durchgezaehlt,
 * damit echte Doppelkäufe erhalten bleiben und nur Neu-Importe greifen.
 */
const kennung = (bank, konto, buchung, lauf = 0) => {
  const roh = [bank, konto || '', buchung.datum, buchung.betrag.toFixed(2), normal(buchung.text), lauf].join('|');
  return sha256Hex(roh).slice(0, 16);
};

const kennungenVergeben = (bank, konto, buchungen) => {
  const zaehler = new Map();
  return buchungen.map((b) => {
    let lauf = 0;
    let k = kennung(bank, konto, b, lauf);
    while (zaehler.has(k)) { lauf += 1; k = kennung(bank, konto, b, lauf); }
    zaehler.set(k, true);
    return { ...b, kennung: k };
  });
};

// ---------------------------------------------------------------- Regeln

const regelPasst = (regel, buchung) => {
  const heuhaufen = normal(`${buchung.text} ${buchung.verwendung || ''}`);
  return heuhaufen.includes(normal(regel.muster));
};

/* Zwei Bezeichnungen von N26 meinen eindeutig dasselbe wie eine eigene Kategorie.
   Alles andere bleibt bewusst offen und wird in der Kontrollansicht angezeigt,
   statt es zu raten. */
const ALIAS = new Map([
  ['gutschriften', 'Einnahmen'],
  ['cash26 einzahlung', 'Einnahmen']
]);

/** Kategorie und Bereich vorschlagen: erst eigene Regeln, dann die Angabe der Bank. */
const vorschlagen = (buchung, { regeln, kategorien }) => {
  for (const regel of regeln) {
    if (!regelPasst(regel, buchung)) continue;
    return {
      kategorie: regel.kategorie || null,
      bereich: regel.bereich || null,
      quelle: `Regel "${regel.muster}"`
    };
  }
  if (buchung.kategorieVorschlag) {
    const gesucht = ALIAS.get(normal(buchung.kategorieVorschlag)) || buchung.kategorieVorschlag;
    const treffer = kategorien.find((k) => normal(k.name) === normal(gesucht));
    if (treffer) return { kategorie: treffer.id, bereich: null, quelle: 'Kategorie aus dem Auszug' };
    return { kategorie: null, bereich: null, quelle: null, neueKategorie: buchung.kategorieVorschlag };
  }
  return { kategorie: null, bereich: null, quelle: null };
};

// ---------------------------------------------------------------- Import

/** Vorschau bauen: nichts wird gespeichert, alles ist noch änderbar. */
const vorschau = (auswertung, dateiHash, dateiName) => {
  const daten = lesen();
  const vorhanden = new Set(daten.buchungen.map((b) => b.kennung));
  const schonImportiert = daten.importe.find((i) => i.hash === dateiHash) || null;

  const mitKennung = kennungenVergeben(auswertung.bank, auswertung.konto, auswertung.buchungen);
  const zeilen = mitKennung.map((b) => {
    const v = vorschlagen(b, daten);
    return {
      ...b,
      kategorie: v.kategorie,
      bereich: v.bereich || 'privat',
      quelle: v.quelle,
      neueKategorie: v.neueKategorie || null,
      dublette: vorhanden.has(b.kennung),
      uebernehmen: !vorhanden.has(b.kennung)
    };
  });

  return {
    ok: true,
    bank: auswertung.bank,
    konto: auswertung.konto,
    waehrung: auswertung.waehrung,
    von: auswertung.von,
    bis: auswertung.bis,
    pruefung: auswertung.pruefung,
    dateiHash,
    dateiName,
    schonImportiert,
    dubletten: zeilen.filter((z) => z.dublette).length,
    zeilen,
    kategorien: daten.kategorien
  };
};

/** Bestätigten Import speichern. Nur was der Nutzer angehakt hat. */
const uebernehmen = (koerper) => {
  const daten = lesen();
  const vorhanden = new Set(daten.buchungen.map((b) => b.kennung));
  const gueltigeKat = new Set(daten.kategorien.map((k) => k.id));
  const bank = String(koerper.bank || '').slice(0, 40);
  const konto = koerper.konto ? String(koerper.konto).slice(0, 40) : null;

  const neu = [];
  for (const zeile of koerper.zeilen || []) {
    if (!zeile.uebernehmen) continue;
    if (!zeile.kennung || vorhanden.has(zeile.kennung)) continue;
    if (typeof zeile.betrag !== 'number' || !zeile.datum) continue;

    neu.push({
      id: store.id('b'),
      kennung: zeile.kennung,
      bank,
      konto,
      datum: zeile.datum,
      text: String(zeile.text || '').slice(0, 400),
      verwendung: zeile.verwendung ? String(zeile.verwendung).slice(0, 600) : null,
      betrag: rund(zeile.betrag),
      waehrung: String(zeile.waehrung || 'EUR').slice(0, 3),
      kategorie: gueltigeKat.has(zeile.kategorie) ? zeile.kategorie : null,
      bereich: BEREICHE.includes(zeile.bereich) ? zeile.bereich : 'privat',
      umbuchung: Boolean(zeile.umbuchung),
      importiert: store.jetzt()
    });
    vorhanden.add(zeile.kennung);
  }

  const importe = [...daten.importe, {
    id: store.id('i'),
    datei: String(koerper.dateiName || '').slice(0, 200),
    hash: koerper.dateiHash || null,
    bank,
    konto,
    von: koerper.von || null,
    bis: koerper.bis || null,
    anzahl: neu.length,
    uebersprungen: (koerper.zeilen || []).length - neu.length,
    zeit: store.jetzt()
  }].slice(-100);

  schreiben({ ...daten, buchungen: [...daten.buchungen, ...neu], importe });
  return { ok: true, uebernommen: neu.length, uebersprungen: (koerper.zeilen || []).length - neu.length };
};

// ---------------------------------------------------------------- Pflege

const buchungAendern = (koerper) => {
  const daten = lesen();
  const buchung = daten.buchungen.find((b) => b.id === koerper.id);
  if (!buchung) return { fehler: 'Buchung nicht gefunden.' };
  const gueltigeKat = new Set(daten.kategorien.map((k) => k.id));

  if ('kategorie' in koerper) buchung.kategorie = gueltigeKat.has(koerper.kategorie) ? koerper.kategorie : null;
  if ('bereich' in koerper && BEREICHE.includes(koerper.bereich)) buchung.bereich = koerper.bereich;
  if ('umbuchung' in koerper) buchung.umbuchung = Boolean(koerper.umbuchung);
  schreiben(daten);
  return { ok: true, buchung };
};

const regelSpeichern = (koerper) => {
  const daten = lesen();
  const muster = String(koerper.muster || '').trim().slice(0, 120);
  if (muster.length < 2) return { fehler: 'Das Muster braucht mindestens zwei Zeichen.' };
  const gueltigeKat = new Set(daten.kategorien.map((k) => k.id));

  const felder = {
    muster,
    kategorie: gueltigeKat.has(koerper.kategorie) ? koerper.kategorie : null,
    bereich: BEREICHE.includes(koerper.bereich) ? koerper.bereich : null
  };
  if (!felder.kategorie && !felder.bereich) return { fehler: 'Eine Regel ohne Kategorie und ohne Bereich bewirkt nichts.' };

  const vorhanden = daten.regeln.find((r) => r.id === koerper.id || normal(r.muster) === normal(muster));
  if (vorhanden) Object.assign(vorhanden, felder);
  else daten.regeln.push({ id: store.id('r'), ...felder, erstellt: store.jetzt() });

  schreiben(daten);
  return { ok: true };
};

const regelLoeschen = (id) => {
  const daten = lesen();
  schreiben({ ...daten, regeln: daten.regeln.filter((r) => r.id !== id) });
  return { ok: true };
};

/** Regeln nachträglich auf schon importierte Buchungen anwenden. */
const regelnAnwenden = (nurLeere = true) => {
  const daten = lesen();
  let geaendert = 0;
  for (const buchung of daten.buchungen) {
    if (nurLeere && buchung.kategorie) continue;
    for (const regel of daten.regeln) {
      if (!regelPasst(regel, buchung)) continue;
      if (regel.kategorie && buchung.kategorie !== regel.kategorie) { buchung.kategorie = regel.kategorie; geaendert += 1; }
      if (regel.bereich) buchung.bereich = regel.bereich;
      break;
    }
  }
  schreiben(daten);
  return { ok: true, geaendert };
};

const kategorieSpeichern = (koerper) => {
  const daten = lesen();
  const name = String(koerper.name || '').trim().slice(0, 60);
  if (!name) return { fehler: 'Name fehlt.' };
  const farbe = /^#[0-9a-f]{6}$/i.test(String(koerper.farbe || '')) ? koerper.farbe : '#636872';

  const vorhanden = daten.kategorien.find((k) => k.id === koerper.id);
  if (vorhanden) { vorhanden.name = name; vorhanden.farbe = farbe; }
  else daten.kategorien.push({ id: store.id('fk'), name, farbe });

  schreiben(daten);
  return { ok: true, kategorien: daten.kategorien };
};

const kategorieLoeschen = (id) => {
  const daten = lesen();
  const benutzt = daten.buchungen.filter((b) => b.kategorie === id).length;
  if (benutzt) return { fehler: `Kategorie wird von ${benutzt} ${benutzt === 1 ? 'Buchung' : 'Buchungen'} benutzt.` };
  schreiben({ ...daten, kategorien: daten.kategorien.filter((k) => k.id !== id), regeln: daten.regeln.filter((r) => r.kategorie !== id) });
  return { ok: true };
};

// ---------------------------------------------------------------- Auswertung

/**
 * Zahlen für einen Zeitraum. Umbuchungen zwischen eigenen Konten zählen weder
 * als Einnahme noch als Ausgabe — sonst erscheint verschobenes Geld als Umsatz.
 */
const auswertung = ({ von = null, bis = null, bereich = null, bank = null } = {}) => {
  const daten = lesen();
  const passend = daten.buchungen.filter((b) => {
    if (von && b.datum < von) return false;
    if (bis && b.datum > bis) return false;
    if (bereich && b.bereich !== bereich) return false;
    if (bank && (b.bank || OHNE_BANK) !== bank) return false;
    return true;
  });

  const gezaehlt = passend.filter((b) => !b.umbuchung);
  const einnahmen = rund(gezaehlt.filter((b) => b.betrag > 0).reduce((s, b) => s + b.betrag, 0));
  const ausgaben = rund(gezaehlt.filter((b) => b.betrag < 0).reduce((s, b) => s + b.betrag, 0));

  const jeKategorie = new Map();
  for (const b of gezaehlt) {
    if (b.betrag >= 0) continue;
    const schluessel = b.kategorie || 'ohne';
    const eintrag = jeKategorie.get(schluessel) || { kategorie: schluessel, summe: 0, anzahl: 0 };
    eintrag.summe = rund(eintrag.summe + Math.abs(b.betrag));
    eintrag.anzahl += 1;
    jeKategorie.set(schluessel, eintrag);
  }

  const jeMonat = new Map();
  for (const b of gezaehlt) {
    const monat = b.datum.slice(0, 7);
    const eintrag = jeMonat.get(monat) || { monat, einnahmen: 0, ausgaben: 0 };
    if (b.betrag > 0) eintrag.einnahmen = rund(eintrag.einnahmen + b.betrag);
    else eintrag.ausgaben = rund(eintrag.ausgaben + Math.abs(b.betrag));
    jeMonat.set(monat, eintrag);
  }

  return {
    von,
    bis,
    bereich,
    anzahl: passend.length,
    umbuchungen: passend.length - gezaehlt.length,
    einnahmen,
    ausgaben: rund(Math.abs(ausgaben)),
    saldo: rund(einnahmen + ausgaben),
    jeKategorie: [...jeKategorie.values()].sort((a, b) => b.summe - a.summe),
    jeMonat: [...jeMonat.values()].sort((a, b) => a.monat.localeCompare(b.monat)),
    kategorien: daten.kategorien,
    buchungen: passend.sort((a, b) => b.datum.localeCompare(a.datum)).slice(0, 400)
  };
};

/**
 * Kompakte Kachel für die Startseite: laufender Monat, zusätzlich je Konto.
 *
 * Die Konten werden nicht fest verdrahtet, sondern aus dem Feld `bank` der
 * Buchungen abgeleitet — heute N26 und Wise, morgen vielleicht ein drittes.
 * Buchungen, denen der Einleser keine Bank angehängt hat, sammeln sich unter
 * „Sonstige", damit sie in der Aufteilung nicht unsichtbar verschwinden und die
 * Einzelsummen wieder die Gesamtsumme ergeben.
 */
const kachel = (heute) => {
  const monat = heute.slice(0, 7);
  const von = `${monat}-01`;
  const bis = `${monat}-31`;
  const a = auswertung({ von, bis });
  const daten = lesen();

  const namen = [...new Set(
    daten.buchungen
      .filter((b) => b.datum >= von && b.datum <= bis)
      .map((b) => b.bank || OHNE_BANK)
  )].sort((x, y) => (x === OHNE_BANK ? 1 : y === OHNE_BANK ? -1 : x.localeCompare(y)));

  const konten = namen.map((name) => {
    const k = auswertung({ von, bis, bank: name });
    return { bank: name, einnahmen: k.einnahmen, ausgaben: k.ausgaben, saldo: k.saldo, anzahl: k.anzahl };
  });

  return {
    monat,
    einnahmen: a.einnahmen,
    ausgaben: a.ausgaben,
    saldo: a.saldo,
    anzahl: a.anzahl,
    konten,
    ohneKategorie: daten.buchungen.filter((b) => !b.kategorie && !b.umbuchung).length,
    hatDaten: daten.buchungen.length > 0
  };
};

export {
  BEREICHE, OHNE_BANK, START_KATEGORIEN, lesen, vorschau, uebernehmen, buchungAendern,
  regelSpeichern, regelLoeschen, regelnAnwenden, kategorieSpeichern, kategorieLoeschen,
  auswertung, kachel, kennung, kennungenVergeben, vorschlagen, regelPasst
};
