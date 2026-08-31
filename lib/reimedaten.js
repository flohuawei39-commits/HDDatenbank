/* Bestand fuer Reime, Zeilen und Texte.

   Aufgeteilt wie bei den Gemeinden und den Finanzen: reime.js rechnet, dieses
   Modul liest und schreibt. Die Silbenketten werden hier bei jeder Abfrage neu
   gerechnet und nie abgelegt — gespeichert ist nur der Text und das, was von
   Hand daran haengt.

   Der Pool, aus dem Vorschlaege und die Silbensuche schoepfen, ist der
   Reime-Reiter: alle Kopfbegriffe und alle Reime darunter. Zeilen und Texte
   bleiben aussen vor, weil sie zum Schreiben da sind und nicht zum
   Nachschlagen.                                                              */

import * as store from './store.js';
import * as R from './reime.js';
import * as silben from './silben.js';

const BEREICHE = ['reime', 'zeilen', 'texte'];
const MAX_TEXT = 400;

const text = (wert, max = MAX_TEXT) => String(wert == null ? '' : wert).trim().slice(0, max);

const kategorieNormalisieren = (wert) => ({
  id: text(wert.id, 40) || store.id('rkat'),
  name: text(wert.name, 60),
  farbe: /^#[0-9a-fA-F]{6}$/.test(String(wert.farbe || '')) ? wert.farbe : '#34e2e2',
  stichwoerter: (Array.isArray(wert.stichwoerter) ? wert.stichwoerter : [])
    .map((s) => text(s, 40).toLowerCase()).filter(Boolean).slice(0, 30)
});

const idListe = (wert) => (Array.isArray(wert) ? wert : []).map((i) => text(i, 40)).filter(Boolean).slice(0, 10);

/** Gesamtbestand in einer Form, auf die sich der Rest verlassen kann. */
const lesen = () => {
  const d = store.read('reime.json') || {};
  const kat = d.kategorien && typeof d.kategorien === 'object' ? d.kategorien : {};
  return {
    woerter: d.woerter && typeof d.woerter === 'object' ? d.woerter : {},
    gruppen: Array.isArray(d.gruppen) ? d.gruppen : [],
    zeilen: Array.isArray(d.zeilen) ? d.zeilen : [],
    texte: Array.isArray(d.texte) ? d.texte : [],
    kategorien: {
      reime: (Array.isArray(kat.reime) ? kat.reime : []).map(kategorieNormalisieren),
      zeilen: (Array.isArray(kat.zeilen) ? kat.zeilen : []).map(kategorieNormalisieren),
      texte: (Array.isArray(kat.texte) ? kat.texte : []).map(kategorieNormalisieren)
    },
    // Leere Ablage heisst Anfangsstand, nicht "keine Farben".
    farben: { ...R.FARBEN, ...(d.farben && typeof d.farben === 'object' ? d.farben : {}) },
    anzeige: {
      faerbenZeilen: Boolean(d.anzeige && d.anzeige.faerbenZeilen),
      faerbenTexte: Boolean(d.anzeige && d.anzeige.faerbenTexte),
      mindestKette: Math.min(6, Math.max(1, Number(d.anzeige && d.anzeige.mindestKette) || 2))
    }
  };
};

const schreiben = (d) => store.write('reime.json', d);

/* ------------------------------------------------------------------ Silben */

/** Kette samt allem, was die Oberflaeche zum Zeichnen braucht. */
const ketteFuer = (inhalt, woerter) => R.kette(inhalt, woerter).map((s) => ({
  kern: s.kern,
  primaer: s.primaer,
  laute: s.laute,
  anmerkungen: s.anmerkungen,
  korrigiert: s.korrigiert,
  relevanz: s.relevanz,
  wort: s.wort,
  schluessel: s.schluessel,
  wortIndex: s.wortIndex,
  silbeIndex: s.silbeIndex,
  wortAnfang: s.wortAnfang
}));

/** Alle Reim-Eintraege als flacher Pool: Kopfbegriffe und ihre Reime. */
const pool = (d) => {
  const liste = [];
  for (const g of d.gruppen) {
    liste.push({ id: g.id, gruppeId: g.id, kopf: true, text: g.kopf, kette: R.kette(g.kopf, d.woerter) });
    for (const e of (Array.isArray(g.eintraege) ? g.eintraege : [])) {
      liste.push({ id: e.id, gruppeId: g.id, kopf: false, text: e.text, kette: R.kette(e.text, d.woerter) });
    }
  }
  return liste;
};

/* ------------------------------------------------------------------ Ansicht */

/**
 * Eine Reimgruppe zum Zeichnen aufbereiten: Silben, Ausrichtung, Zaehlung.
 *
 * Der Versatz kommt aus dem Vergleich mit dem Kopfbegriff — jede Zeile wird so
 * weit geschoben, dass ihr passendes Stueck unter dem des Kopfes steht. Danach
 * wird die ganze Gruppe so weit nach rechts gerueckt, dass kein Versatz mehr
 * negativ ist; sonst raegte eine Zeile aus dem Raster heraus.
 */
const gruppeAufbereiten = (gruppe, d) => {
  const kopfKette = ketteFuer(gruppe.kopf, d.woerter);
  const eintraege = (Array.isArray(gruppe.eintraege) ? gruppe.eintraege : []).map((e) => {
    const kette = ketteFuer(e.text, d.woerter);
    const treffer = R.vergleich(kopfKette, kette);
    return { id: e.id, text: e.text, silben: kette, versatz: treffer.laenge ? treffer.a - treffer.b : 0, treffer };
  });

  const zeilen = [{ id: gruppe.id, kopf: true, text: gruppe.kopf, silben: kopfKette, versatz: 0 }, ...eintraege];
  const kleinster = Math.min(...zeilen.map((z) => z.versatz));
  for (const z of zeilen) z.versatz -= Math.min(0, kleinster);

  // Gezaehlt wird gegen die direkten Nachbarn in der angezeigten Reihenfolge.
  zeilen.forEach((z, i) => {
    z.zaehlung = R.zaehlung(
      z.silben,
      i > 0 ? zeilen[i - 1].silben : null,
      i < zeilen.length - 1 ? zeilen[i + 1].silben : null
    );
  });

  return {
    id: gruppe.id,
    kopf: gruppe.kopf,
    kategorien: idListe(gruppe.kategorien),
    zeilen
  };
};

/**
 * Ausrichtung ohne Kopfbegriff: jede Zeile wird gegen die Zeile darueber
 * geschoben, und der Versatz sammelt sich dabei auf. Anschliessend rutscht die
 * ganze Liste so weit nach rechts, dass keine Zeile mehr negativ steht.
 */
const ausrichten = (zeilen) => {
  let letzter = 0;
  zeilen.forEach((z, i) => {
    if (i === 0) { z.versatz = 0; return; }
    const t = R.vergleich(zeilen[i - 1].silben, z.silben);
    z.versatz = t.laenge ? letzter + (t.a - t.b) : letzter;
    letzter = z.versatz;
  });
  const kleinster = Math.min(0, ...zeilen.map((z) => z.versatz));
  for (const z of zeilen) z.versatz -= kleinster;
  return zeilen;
};

const passtZuKategorie = (eintrag, kategorie) => !kategorie || idListe(eintrag.kategorien).includes(kategorie);

/** Alles, was ein Unterreiter zum Zeichnen braucht. */
const ansicht = (bereich, kategorie) => {
  const d = lesen();
  const gewaehlt = BEREICHE.includes(bereich) ? bereich : 'reime';
  const basis = {
    bereich: gewaehlt,
    kategorie: kategorie || null,
    kategorien: d.kategorien[gewaehlt],
    farben: d.farben,
    anzeige: d.anzeige,
    laute: silben.LAUTE,
    prioritaeten: R.PRIORITAETEN
  };

  if (gewaehlt === 'reime') {
    return {
      ...basis,
      gruppen: d.gruppen.filter((g) => passtZuKategorie(g, kategorie)).map((g) => gruppeAufbereiten(g, d))
    };
  }

  if (gewaehlt === 'zeilen') {
    return {
      ...basis,
      zeilen: ausrichten(d.zeilen.filter((z) => passtZuKategorie(z, kategorie)).map((z) => ({
        id: z.id,
        text: z.text,
        kategorien: idListe(z.kategorien),
        silben: ketteFuer(z.text, d.woerter)
      })))
    };
  }

  return {
    ...basis,
    texte: d.texte.filter((t) => passtZuKategorie(t, kategorie)).map((t) => ({
      id: t.id,
      titel: t.titel,
      kategorien: idListe(t.kategorien),
      zeilen: ausrichten((Array.isArray(t.zeilen) ? t.zeilen : []).map((z) => ({
        id: z.id,
        text: z.text,
        silben: ketteFuer(z.text, d.woerter)
      })))
    }))
  };
};

/* ------------------------------------------------------------ Schreibzugriff */

const gruppeSpeichern = (koerper) => {
  const d = lesen();
  const kopf = text(koerper.kopf);
  if (!kopf) return { fehler: 'Ohne Begriff geht es nicht.' };

  const id = text(koerper.id, 40);
  const vorhanden = id ? d.gruppen.findIndex((g) => g.id === id) : -1;
  const kategorien = idListe(koerper.kategorien);

  if (vorhanden >= 0) {
    d.gruppen[vorhanden] = { ...d.gruppen[vorhanden], kopf, kategorien };
  } else {
    d.gruppen.unshift({ id: store.id('grp'), kopf, kategorien, eintraege: [] });
  }
  schreiben(d);
  return { ok: true };
};

const gruppeLoeschen = (id) => {
  const d = lesen();
  const rest = d.gruppen.filter((g) => g.id !== id);
  if (rest.length === d.gruppen.length) return { fehler: 'Gruppe nicht gefunden.' };
  schreiben({ ...d, gruppen: rest });
  return { ok: true };
};

const eintragSpeichern = (koerper) => {
  const d = lesen();
  const gruppe = d.gruppen.find((g) => g.id === text(koerper.gruppe, 40));
  if (!gruppe) return { fehler: 'Gruppe nicht gefunden.' };
  const inhalt = text(koerper.text);
  if (!inhalt) return { fehler: 'Ohne Text geht es nicht.' };

  gruppe.eintraege = Array.isArray(gruppe.eintraege) ? gruppe.eintraege : [];
  const id = text(koerper.id, 40);
  const stelle = id ? gruppe.eintraege.findIndex((e) => e.id === id) : -1;

  if (stelle >= 0) gruppe.eintraege[stelle] = { ...gruppe.eintraege[stelle], text: inhalt };
  else gruppe.eintraege.push({ id: store.id('rei'), text: inhalt });

  schreiben(d);
  return { ok: true };
};

const eintragLoeschen = (gruppeId, id) => {
  const d = lesen();
  const gruppe = d.gruppen.find((g) => g.id === gruppeId);
  if (!gruppe) return { fehler: 'Gruppe nicht gefunden.' };
  const vorher = (gruppe.eintraege || []).length;
  gruppe.eintraege = (gruppe.eintraege || []).filter((e) => e.id !== id);
  if (gruppe.eintraege.length === vorher) return { fehler: 'Reim nicht gefunden.' };
  schreiben(d);
  return { ok: true };
};

/**
 * Sortieren auf Knopfdruck: der beste Reim nach oben. Beste heisst laengste
 * ununterbrochene Uebereinstimmung mit dem Kopfbegriff, dann das schwerere
 * Gewicht (Treffer auf dem relevanten Laut), dann die kuerzere Zeile.
 */
const gruppeSortieren = (gruppeId) => {
  const d = lesen();
  const gruppe = d.gruppen.find((g) => g.id === gruppeId);
  if (!gruppe) return { fehler: 'Gruppe nicht gefunden.' };

  const kopfKette = R.kette(gruppe.kopf, d.woerter);
  gruppe.eintraege = (gruppe.eintraege || [])
    .map((e) => ({ e, k: R.kette(e.text, d.woerter) }))
    .map((x) => ({ ...x, t: R.vergleich(kopfKette, x.k) }))
    .sort((a, b) => b.t.laenge - a.t.laenge || b.t.gewicht - a.t.gewicht || a.k.length - b.k.length)
    .map((x) => x.e);

  schreiben(d);
  return { ok: true };
};

const zeileSpeichern = (koerper) => {
  const d = lesen();
  const inhalt = text(koerper.text);
  if (!inhalt) return { fehler: 'Ohne Text geht es nicht.' };
  const id = text(koerper.id, 40);
  const stelle = id ? d.zeilen.findIndex((z) => z.id === id) : -1;
  const kategorien = idListe(koerper.kategorien);

  if (stelle >= 0) d.zeilen[stelle] = { ...d.zeilen[stelle], text: inhalt, kategorien };
  else d.zeilen.unshift({ id: store.id('zei'), text: inhalt, kategorien });

  schreiben(d);
  return { ok: true };
};

const zeileLoeschen = (id) => {
  const d = lesen();
  const rest = d.zeilen.filter((z) => z.id !== id);
  if (rest.length === d.zeilen.length) return { fehler: 'Zeile nicht gefunden.' };
  schreiben({ ...d, zeilen: rest });
  return { ok: true };
};

/** Ein Text ist ein Titel und seine Zeilen; Leerzeilen bleiben als Trenner. */
const textSpeichern = (koerper) => {
  const d = lesen();
  const titel = text(koerper.titel, 120);
  if (!titel) return { fehler: 'Ohne Titel geht es nicht.' };

  const zeilen = String(koerper.inhalt == null ? '' : koerper.inhalt)
    .split(/\r?\n/)
    .slice(0, 500)
    .map((z) => ({ id: store.id('tz'), text: z.trim().slice(0, MAX_TEXT) }));

  const id = text(koerper.id, 40);
  const stelle = id ? d.texte.findIndex((t) => t.id === id) : -1;
  const kategorien = idListe(koerper.kategorien);

  if (stelle >= 0) d.texte[stelle] = { ...d.texte[stelle], titel, zeilen, kategorien };
  else d.texte.unshift({ id: store.id('txt'), titel, zeilen, kategorien });

  schreiben(d);
  return { ok: true };
};

const textLoeschen = (id) => {
  const d = lesen();
  const rest = d.texte.filter((t) => t.id !== id);
  if (rest.length === d.texte.length) return { fehler: 'Text nicht gefunden.' };
  schreiben({ ...d, texte: rest });
  return { ok: true };
};

/**
 * Anmerkungen und Korrektur einer Silbe. Gespeichert wird am Wort, nicht am
 * Vorkommen: dieselbe Silbe im selben Wort meint ueberall dieselbe Aussprache.
 */
const wortSpeichern = (koerper) => {
  const d = lesen();
  const schluessel = silben.normalisieren(koerper.wort);
  if (!schluessel) return { fehler: 'Kein Wort angegeben.' };

  const laenge = silben.kerne(schluessel).length;
  const index = Number(koerper.silbeIndex);
  if (!Number.isInteger(index) || index < 0 || index >= laenge) return { fehler: 'Silbe nicht gefunden.' };

  const vorhanden = R.wortNormalisieren(d.woerter[schluessel] || {});
  const silbenListe = [];
  for (let i = 0; i < laenge; i += 1) {
    silbenListe.push(vorhanden.silben[i] || { korrektur: null, relevanz: 'buchstabe', anmerkungen: [] });
  }
  silbenListe[index] = {
    korrektur: koerper.korrektur === null ? null : koerper.korrektur,
    relevanz: koerper.relevanz,
    anmerkungen: Array.isArray(koerper.anmerkungen) ? koerper.anmerkungen : []
  };

  const sauber = R.wortNormalisieren({ silben: silbenListe });
  const leer = sauber.silben.every((s) => !s.korrektur && !s.anmerkungen.length);

  const woerter = { ...d.woerter };
  // Wer alles wieder abwaehlt, soll keine Karteileiche hinterlassen.
  if (leer) delete woerter[schluessel];
  else woerter[schluessel] = sauber;

  schreiben({ ...d, woerter });
  return { ok: true, wort: schluessel, silben: sauber.silben };
};

const kategorieSpeichern = (koerper) => {
  const d = lesen();
  const bereich = BEREICHE.includes(koerper.bereich) ? koerper.bereich : 'reime';
  const name = text(koerper.name, 60);
  if (!name) return { fehler: 'Ohne Namen geht es nicht.' };

  const liste = d.kategorien[bereich];
  const id = text(koerper.id, 40);
  const stelle = id ? liste.findIndex((k) => k.id === id) : -1;
  const wert = kategorieNormalisieren({
    id: stelle >= 0 ? id : store.id('rkat'),
    name,
    farbe: koerper.farbe,
    stichwoerter: Array.isArray(koerper.stichwoerter)
      ? koerper.stichwoerter
      : String(koerper.stichwoerter || '').split(',')
  });

  if (stelle >= 0) liste[stelle] = wert;
  else liste.push(wert);

  schreiben(d);
  return { ok: true };
};

const kategorieLoeschen = (bereich, id) => {
  const d = lesen();
  const gewaehlt = BEREICHE.includes(bereich) ? bereich : 'reime';
  const traeger = gewaehlt === 'reime' ? d.gruppen : gewaehlt === 'zeilen' ? d.zeilen : d.texte;
  const benutzt = traeger.filter((e) => idListe(e.kategorien).includes(id)).length;
  if (benutzt) return { fehler: `Kategorie wird von ${benutzt} ${benutzt === 1 ? 'Eintrag' : 'Einträgen'} benutzt.` };

  d.kategorien[gewaehlt] = d.kategorien[gewaehlt].filter((k) => k.id !== id);
  schreiben(d);
  return { ok: true };
};

/* ---- Umzug zwischen den Reitern --------------------------------------------

   Reime, Zeilen und Texte halten dieselbe Sache in drei Formen. Beim Umzug wird
   deshalb umgeformt statt kopiert: eine Gruppe zerfaellt in ihren Kopfbegriff
   und die Reime darunter, ein Text in seine Zeilen, und eine Zeile wird zum
   Kopf einer neuen Gruppe. Kennungen werden dabei neu vergeben — der Eintrag
   ist danach ein anderes Ding im anderen Reiter, kein Verweis auf das alte.  */

const zielKategorien = (d, nach, ids) => idListe(ids)
  .filter((k) => d.kategorien[nach].some((x) => x.id === k));

/**
 * Einen Eintrag umhaengen. Arbeitet auf dem uebergebenen Bestand und schreibt
 * nicht selbst, damit ein Kategorieumzug viele Eintraege in einem Rutsch
 * bewegen kann.
 */
const umhaengen = (d, von, nach, id) => {
  const quelle = von === 'reime' ? d.gruppen : von === 'zeilen' ? d.zeilen : d.texte;
  const stelle = quelle.findIndex((e) => e.id === id);
  if (stelle < 0) return { fehler: 'Eintrag nicht gefunden.' };

  const [alt] = quelle.splice(stelle, 1);
  const kategorien = zielKategorien(d, nach, alt.kategorien);
  const kopf = text(von === 'reime' ? alt.kopf : von === 'zeilen' ? alt.text : alt.titel);
  const unter = (von === 'reime' ? (alt.eintraege || []) : von === 'texte' ? (alt.zeilen || []) : [])
    .map((e) => text(e.text)).filter(Boolean);

  if (nach === 'reime') {
    d.gruppen.unshift({
      id: store.id('grp'),
      kopf,
      kategorien,
      eintraege: unter.map((t) => ({ id: store.id('rei'), text: t }))
    });
  } else if (nach === 'zeilen') {
    // Kopf zuerst, danach was darunter stand: die Reihenfolge bleibt sichtbar.
    d.zeilen.unshift(...[kopf, ...unter].filter(Boolean)
      .map((t) => ({ id: store.id('zei'), text: t, kategorien })));
  } else {
    d.texte.unshift({
      id: store.id('txt'),
      titel: kopf.slice(0, 120),
      zeilen: unter.map((t) => ({ id: store.id('tz'), text: t })),
      kategorien
    });
  }
  return { ok: true };
};

const eintragVerschieben = (koerper) => {
  const d = lesen();
  const von = BEREICHE.includes(koerper.von) ? koerper.von : null;
  const nach = BEREICHE.includes(koerper.nach) ? koerper.nach : null;
  if (!von || !nach || von === nach) return { fehler: 'Kein anderer Reiter gewählt.' };

  const ergebnis = umhaengen(d, von, nach, text(koerper.id, 40));
  if (ergebnis.fehler) return ergebnis;
  schreiben(d);
  return { ok: true, anzahl: 1 };
};

/**
 * Eine Kategorie samt allem, was daran haengt, in einen anderen Reiter
 * verschieben. Die Kategorie wandert zuerst; sonst faende `zielKategorien` sie
 * im Ziel noch nicht und die Eintraege kaemen ohne ihre eigene Kategorie an.
 */
const kategorieVerschieben = (koerper) => {
  const d = lesen();
  const von = BEREICHE.includes(koerper.von) ? koerper.von : null;
  const nach = BEREICHE.includes(koerper.nach) ? koerper.nach : null;
  if (!von || !nach || von === nach) return { fehler: 'Kein anderer Reiter gewählt.' };

  const id = text(koerper.id, 40);
  const stelle = d.kategorien[von].findIndex((k) => k.id === id);
  if (stelle < 0) return { fehler: 'Kategorie nicht gefunden.' };

  const [kategorie] = d.kategorien[von].splice(stelle, 1);
  d.kategorien[nach].push(kategorie);

  const traeger = (von === 'reime' ? d.gruppen : von === 'zeilen' ? d.zeilen : d.texte)
    .filter((e) => idListe(e.kategorien).includes(id))
    .map((e) => e.id);

  let anzahl = 0;
  for (const eintragId of traeger) {
    if (umhaengen(d, von, nach, eintragId).ok) anzahl += 1;
  }

  schreiben(d);
  return { ok: true, anzahl };
};

const anzeigeSpeichern = (koerper) => {
  const d = lesen();
  const farben = { ...d.farben };
  if (koerper.farben && typeof koerper.farben === 'object') {
    for (const [laut, wert] of Object.entries(koerper.farben)) {
      if (silben.LAUTE.includes(laut) && /^#[0-9a-fA-F]{6}$/.test(String(wert))) farben[laut] = wert;
    }
  }
  schreiben({
    ...d,
    farben,
    anzeige: {
      faerbenZeilen: koerper.faerbenZeilen === undefined ? d.anzeige.faerbenZeilen : Boolean(koerper.faerbenZeilen),
      faerbenTexte: koerper.faerbenTexte === undefined ? d.anzeige.faerbenTexte : Boolean(koerper.faerbenTexte),
      mindestKette: Math.min(6, Math.max(1, Number(koerper.mindestKette) || d.anzeige.mindestKette))
    }
  });
  return { ok: true };
};

/* ------------------------------------------------------------ Suche und Rat */

/**
 * Silbensuche im Reime-Bestand. Der Treffer traegt die getroffenen Stellen mit,
 * damit die Oberflaeche genau diese Silben hervorheben kann.
 */
const suche = (muster, wahl = {}) => {
  const d = lesen();
  const liste = (Array.isArray(muster) ? muster : []).filter((l) => silben.LAUTE.includes(l));
  if (!liste.length) return { muster: [], treffer: [] };

  const treffer = [];
  for (const eintrag of pool(d)) {
    const gefunden = R.suchen(liste, eintrag.kette, wahl);
    if (!gefunden) continue;
    treffer.push({
      id: eintrag.id,
      gruppeId: eintrag.gruppeId,
      kopf: eintrag.kopf,
      text: eintrag.text,
      silben: eintrag.kette,
      stellen: gefunden.stellen,
      verbrauch: gefunden.verbrauch
    });
  }

  treffer.sort((a, b) => a.verbrauch - b.verbrauch || a.silben.length - b.silben.length);
  return { muster: liste, treffer: treffer.slice(0, 100) };
};

/** Passende Reime aus dem Bestand zu einem Text. */
const wortlaut = (wert) => text(wert).toLowerCase().replace(/\s+/g, ' ');

const rat = (inhalt, wahl = {}) => {
  const d = lesen();
  const vorlage = R.kette(text(inhalt), d.woerter);
  if (!vorlage.length) return { vorschlaege: [] };

  const ausser = new Set(idListe(wahl.ausser));

  /* Was in dieser Gruppe schon steht, ist kein Vorschlag mehr. Neben den
     Kennungen wird auch der Wortlaut verglichen: dasselbe Wort kann in einer
     anderen Gruppe liegen und haette sonst hier noch einmal angeboten. */
  const gruppeId = text(wahl.gruppe, 40);
  const gruppe = gruppeId ? d.gruppen.find((g) => g.id === gruppeId) : null;
  const drin = new Set(gruppe
    ? [gruppe.kopf, ...(Array.isArray(gruppe.eintraege) ? gruppe.eintraege : []).map((e) => e.text)].map(wortlaut)
    : []);
  drin.add(wortlaut(inhalt));

  const kandidaten = pool(d).filter((k) => !ausser.has(k.id)
    && !(gruppeId && k.gruppeId === gruppeId)
    && !drin.has(wortlaut(k.text)));
  const mindest = Math.max(1, Number(wahl.mindest) || d.anzeige.mindestKette);

  return {
    mindest,
    vorschlaege: R.vorschlaege(vorlage, kandidaten, mindest).map((v) => ({
      id: v.id,
      gruppeId: v.gruppeId,
      text: v.text,
      laenge: v.treffer.laenge,
      silben: v.kette
    }))
  };
};

export {
  BEREICHE, lesen, ansicht, pool, ketteFuer,
  gruppeSpeichern, gruppeLoeschen, gruppeSortieren,
  eintragSpeichern, eintragLoeschen,
  zeileSpeichern, zeileLoeschen,
  textSpeichern, textLoeschen,
  wortSpeichern, kategorieSpeichern, kategorieLoeschen, anzeigeSpeichern,
  eintragVerschieben, kategorieVerschieben,
  suche, rat
};
