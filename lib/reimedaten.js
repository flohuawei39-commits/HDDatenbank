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

/* Kategorien galten frueher je Reiter, jetzt ueberall. Aeltere Ablagen tragen
   noch die drei getrennten Listen; die werden hier einmal zusammengelegt, in
   der Reihenfolge Reime, Zeilen, Texte. Geschrieben wird nur noch flach. */
const kategorienListe = (wert) => {
  const roh = Array.isArray(wert)
    ? wert
    : (wert && typeof wert === 'object'
      ? [...(wert.reime || []), ...(wert.zeilen || []), ...(wert.texte || [])]
      : []);
  const gesehen = new Set();
  const liste = [];
  for (const k of roh) {
    const sauber = kategorieNormalisieren(k && typeof k === 'object' ? k : {});
    if (!sauber.name || gesehen.has(sauber.id)) continue;
    gesehen.add(sauber.id);
    liste.push(sauber);
  }
  return liste;
};

const idListe = (wert) => (Array.isArray(wert) ? wert : []).map((i) => text(i, 40)).filter(Boolean).slice(0, 10);

/* Der Schub ist die von Hand gesetzte Verschiebung einer Zeile, gemessen in
   Silbenzellen. Er kennt bewusst keine Grenze: beim Zeichnen rueckt die ganze
   Gruppe so weit nach rechts, dass nichts aus dem Raster faellt. */
const ganz = (wert) => (Number.isFinite(Number(wert)) ? Math.round(Number(wert)) : 0);

/* Neben dem Schub der ganzen Zeile gibt es den Schub einzelner Woerter: vor
   dem Wort mit dieser Nummer stehen so viele leere Zellen zusaetzlich. Damit
   laesst sich eine Zeile auch INNERHALB auseinanderziehen, zwischen den
   Woertern. Nie negativ — sonst schoebe sich ein Wort in das davor. */
const wortSchubListe = (wert) => {
  const roh = wert && typeof wert === 'object' ? wert : {};
  const liste = {};
  for (const [schluessel, wert2] of Object.entries(roh)) {
    const nummer = Number(schluessel);
    const weite = Math.max(0, ganz(wert2));
    if (Number.isInteger(nummer) && nummer > 0 && nummer < 500 && weite) liste[nummer] = weite;
  }
  return liste;
};

/**
 * Wie viele leere Zellen vor jeder Silbe zusaetzlich stehen. Aufsummiert, denn
 * eine Luecke schiebt alles nach hinten, was danach kommt.
 */
const vorsprung = (kette, wortSchub) => {
  const liste = wortSchubListe(wortSchub);
  const raus = [];
  let summe = 0;
  let letztes = -1;
  for (const silbe of kette) {
    if (silbe.wortIndex !== letztes) {
      summe += liste[silbe.wortIndex] || 0;
      letztes = silbe.wortIndex;
    }
    raus.push(summe);
  }
  return raus;
};

/** Spalte, in der eine Silbe tatsaechlich steht — Luecken eingerechnet. */
const spalte = (stelle, luecken) => stelle + (luecken[stelle] || 0);

/**
 * Spalte, in der die letzte Silbe einer Zeile steht. Daran richtet die
 * Endregel aus: die letzte Silbe soll unter der letzten der Zeile darueber
 * stehen. Gezaehlt wird die letzte MITZAEHLENDE Silbe — was in Klammern
 * hinterherlaeuft, gehoert nicht zum Reim und soll ihn nicht verschieben.
 */
const endSpalte = (kette, wortSchub) => {
  const luecken = vorsprung(kette, wortSchub);
  let stelle = -1;
  for (let i = 0; i < kette.length; i += 1) {
    if (kette[i].zaehlt !== false) stelle = i;
  }
  if (stelle < 0) stelle = kette.length - 1;
  return stelle < 0 ? 0 : spalte(stelle, luecken);
};

/** Gesamtbestand in einer Form, auf die sich der Rest verlassen kann. */
const lesen = () => {
  const d = store.read('reime.json') || {};
  return {
    woerter: d.woerter && typeof d.woerter === 'object' ? d.woerter : {},
    gruppen: Array.isArray(d.gruppen) ? d.gruppen : [],
    zeilen: Array.isArray(d.zeilen) ? d.zeilen : [],
    texte: Array.isArray(d.texte) ? d.texte : [],
    kategorien: kategorienListe(d.kategorien),
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
  zaehlt: s.zaehlt,
  zaehlWeise: s.zaehlWeise,
  klammer: s.klammer,
  wortWeg: s.wortWeg,
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
  const kopfLuecken = vorsprung(kopfKette, gruppe.wortSchub);
  const kopfSchub = ganz(gruppe.schub);

  /* Zwei Ausrichtungen nebeneinander. Neu geschriebene und geaenderte Zeilen
     tragen die Marke `amEnde` und stellen ihre letzte Silbe unter die letzte
     Silbe der Zeile darueber. Was vorher schon dastand, hat die Marke nicht
     und behaelt seine gerechnete Ausrichtung am laengsten gemeinsamen Stueck
     mit dem Kopfbegriff — sonst wuerde diese Neuerung bestehende Arbeit
     verschieben. */
  const eintraege = [];
  let vorher = { silben: kopfKette, wortSchub: gruppe.wortSchub, versatz: kopfSchub };
  for (const e of (Array.isArray(gruppe.eintraege) ? gruppe.eintraege : [])) {
    const kette = ketteFuer(e.text, d.woerter);
    const luecken = vorsprung(kette, e.wortSchub);
    const treffer = R.vergleich(kopfKette, kette);
    const schub = ganz(e.schub);
    const gerechnet = e.amEnde && kette.length && vorher.silben.length
      ? vorher.versatz + endSpalte(vorher.silben, vorher.wortSchub) - endSpalte(kette, e.wortSchub)
      // Verglichen wird auf Silben, geschoben wird auf Spalten: was innerhalb
      // der Zeile auseinandergezogen ist, muss hier mitgerechnet werden.
      : (treffer.laenge ? spalte(treffer.a, kopfLuecken) - spalte(treffer.b, luecken) : 0);

    const zeile = {
      id: e.id,
      text: e.text,
      silben: kette,
      wortSchub: wortSchubListe(e.wortSchub),
      versatz: gerechnet + schub,
      schub,
      treffer
    };
    eintraege.push(zeile);
    /* Weitergereicht wird die gerechnete Ausrichtung ohne den Schub: der gilt
       nur fuer die eigene Zeile, sonst wanderte beim Anfassen einer Zeile
       alles darunter mit. */
    vorher = { silben: kette, wortSchub: e.wortSchub, versatz: gerechnet };
  }
  const zeilen = [
    {
      id: gruppe.id,
      kopf: true,
      text: gruppe.kopf,
      silben: kopfKette,
      wortSchub: wortSchubListe(gruppe.wortSchub),
      versatz: kopfSchub,
      schub: kopfSchub
    },
    ...eintraege
  ];
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
  // Die letzte Zeile, die ueberhaupt Silben hatte: an ihr misst die Endregel.
  let volle = null;
  zeilen.forEach((z, i) => {
    // Eine Leerzeile trennt nur; sie zeigt kein Raster und richtet nichts aus.
    if (!z.silben.length) {
      z.versatz = 0;
      return;
    }
    // Der Schub gilt nur fuer die eigene Zeile: wer eine anfasst, will nicht,
    // dass alles darunter mitwandert.
    const gerechnet = i === 0 ? 0 : (() => {
      // Die Endregel gilt nur fuer neu geschriebene und geaenderte Zeilen.
      if (z.amEnde && volle) {
        return letzter + endSpalte(volle.silben, volle.wortSchub) - endSpalte(z.silben, z.wortSchub);
      }
      const darueber = zeilen[i - 1];
      const t = R.vergleich(darueber.silben, z.silben);
      if (!t.laenge) return letzter;
      const oben = vorsprung(darueber.silben, darueber.wortSchub);
      const hier = vorsprung(z.silben, z.wortSchub);
      return letzter + (spalte(t.a, oben) - spalte(t.b, hier));
    })();
    letzter = gerechnet;
    z.versatz = gerechnet + z.schub;
    volle = z;
  });
  const kleinster = Math.min(0, ...zeilen.map((z) => z.versatz));
  for (const z of zeilen) z.versatz -= kleinster;
  return zeilen;
};

/* Wie viele Eintraege in jedem Reiter an einer Kategorie haengen. Die Leiste
   steht ueberall gleich, also gehoert dazu, wo etwas zu holen ist. */
const kategorieZaehler = (d) => {
  const zaehler = {};
  const merken = (bereich, eintraege) => {
    for (const e of eintraege) {
      for (const k of idListe(e.kategorien)) {
        if (!zaehler[k]) zaehler[k] = { reime: 0, zeilen: 0, texte: 0 };
        zaehler[k][bereich] += 1;
      }
    }
  };
  merken('reime', d.gruppen);
  merken('zeilen', d.zeilen);
  merken('texte', d.texte);
  return zaehler;
};

const passtZuKategorie = (eintrag, kategorie) => !kategorie || idListe(eintrag.kategorien).includes(kategorie);

/** Alles, was ein Unterreiter zum Zeichnen braucht. */
const ansicht = (bereich, kategorie) => {
  const d = lesen();
  const gewaehlt = BEREICHE.includes(bereich) ? bereich : 'reime';
  const zaehler = kategorieZaehler(d);
  const basis = {
    bereich: gewaehlt,
    kategorie: kategorie || null,
    kategorien: d.kategorien.map((k) => ({
      ...k,
      anzahl: zaehler[k.id] || { reime: 0, zeilen: 0, texte: 0 }
    })),
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
        schub: ganz(z.schub),
        amEnde: Boolean(z.amEnde),
        wortSchub: wortSchubListe(z.wortSchub),
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
        schub: ganz(z.schub),
        amEnde: Boolean(z.amEnde),
        wortSchub: wortSchubListe(z.wortSchub),
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

  // Neu geschrieben oder geaendert heisst: ab jetzt nach der Endregel ausrichten.
  if (stelle >= 0) gruppe.eintraege[stelle] = { ...gruppe.eintraege[stelle], text: inhalt, amEnde: true };
  else gruppe.eintraege.push({ id: store.id('rei'), text: inhalt, amEnde: true });

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

  if (stelle >= 0) d.zeilen[stelle] = { ...d.zeilen[stelle], text: inhalt, kategorien, amEnde: true };
  else d.zeilen.unshift({ id: store.id('zei'), text: inhalt, kategorien, amEnde: true });

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

  const id = text(koerper.id, 40);
  const stelle = id ? d.texte.findIndex((t) => t.id === id) : -1;
  const kategorien = idListe(koerper.kategorien);
  const frueher = stelle >= 0 && Array.isArray(d.texte[stelle].zeilen) ? d.texte[stelle].zeilen : [];

  /* Steht an derselben Stelle noch derselbe Wortlaut, bleibt es dieselbe Zeile.
     Damit ueberleben Kennung und die von Hand gesetzten Verschiebungen das
     Aendern des Textes — sonst waere die Silbenarbeit nach einem Tippfehler
     verloren. */
  const zeilen = String(koerper.inhalt == null ? '' : koerper.inhalt)
    .split(/\r?\n/)
    .slice(0, 500)
    .map((z, i) => {
      const inhalt = z.trim().slice(0, MAX_TEXT);
      const alt = frueher[i];
      return alt && alt.text === inhalt ? alt : { id: store.id('tz'), text: inhalt, amEnde: true };
    });

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
  const zaehlung = koerper.zaehlung || null;
  // Sonst verschwaende das ganze Wort und waere nirgends mehr anzuklicken.
  if (zaehlung === 'weg' && laenge === 1) return { fehler: 'Die einzige Silbe eines Wortes bleibt stehen.' };

  const vorhanden = R.wortNormalisieren(d.woerter[schluessel] || {});
  const silbenListe = [];
  for (let i = 0; i < laenge; i += 1) {
    silbenListe.push(vorhanden.silben[i]
      || { korrektur: null, relevanz: 'buchstabe', zaehlung: null, anmerkungen: [] });
  }
  /* Mit `nurZaehlung` bleibt alles andere an der Silbe unangetastet. Genau das
     braucht das Zurueckholen einer gestrichenen Silbe: sie ist nicht sichtbar,
     ihre Korrektur und ihre Anmerkungen sollen aber bleiben. */
  silbenListe[index] = koerper.nurZaehlung
    ? { ...silbenListe[index], zaehlung }
    : {
      korrektur: koerper.korrektur === null ? null : koerper.korrektur,
      relevanz: koerper.relevanz,
      // Leer heisst: die Klammern im Text entscheiden.
      zaehlung,
      anmerkungen: Array.isArray(koerper.anmerkungen) ? koerper.anmerkungen : []
    };

  if (silbenListe.every((s) => s.zaehlung === 'weg')) {
    return { fehler: 'Die letzte Silbe eines Wortes bleibt stehen.' };
  }

  const sauber = R.wortNormalisieren({ silben: silbenListe });
  const leer = sauber.silben.every((s) => !s.korrektur && !s.zaehlung && !s.anmerkungen.length);

  const woerter = { ...d.woerter };
  // Wer alles wieder abwaehlt, soll keine Karteileiche hinterlassen.
  if (leer) delete woerter[schluessel];
  else woerter[schluessel] = sauber;

  schreiben({ ...d, woerter });
  return { ok: true, wort: schluessel, silben: sauber.silben };
};

const kategorieSpeichern = (koerper) => {
  const d = lesen();
  const name = text(koerper.name, 60);
  if (!name) return { fehler: 'Ohne Namen geht es nicht.' };

  const liste = d.kategorien;
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

const kategorieLoeschen = (id) => {
  const d = lesen();
  // Die Kategorie gilt ueberall, also zaehlt auch ueberall, was daran haengt.
  const benutzt = [...d.gruppen, ...d.zeilen, ...d.texte]
    .filter((e) => idListe(e.kategorien).includes(id)).length;
  if (benutzt) return { fehler: `Kategorie wird von ${benutzt} ${benutzt === 1 ? 'Eintrag' : 'Einträgen'} benutzt.` };

  const rest = d.kategorien.filter((k) => k.id !== id);
  if (rest.length === d.kategorien.length) return { fehler: 'Kategorie nicht gefunden.' };
  d.kategorien = rest;
  schreiben(d);
  return { ok: true };
};

/**
 * Eine Zeile von Hand um eine Silbenzelle schieben. Gesucht wird ueber die
 * Kennung: Kopfbegriffe, Reime und Zeilen tragen jeweils eigene.
 */
const zeileFinden = (d, id) => {
  for (const g of d.gruppen) {
    if (g.id === id) return g;
    const e = (Array.isArray(g.eintraege) ? g.eintraege : []).find((x) => x.id === id);
    if (e) return e;
  }
  for (const t of d.texte) {
    const z = (Array.isArray(t.zeilen) ? t.zeilen : []).find((x) => x.id === id);
    if (z) return z;
  }
  return d.zeilen.find((z) => z.id === id) || null;
};

/**
 * Die Liste, in der ein Eintrag steht, samt seiner Stelle darin. Gesucht wird
 * ueberall: Gruppen, Reime unter einer Gruppe, Zeilen, Texte und die Zeilen
 * eines Textes tragen alle eigene Kennungen.
 */
const listeMitId = (d, id) => {
  const suchen = (liste, gefiltert) => {
    const stelle = (Array.isArray(liste) ? liste : []).findIndex((e) => e && e.id === id);
    return stelle < 0 ? null : { liste, stelle, gefiltert };
  };

  // Die drei oberen Listen stehen unter dem Kategoriefilter, ihr Inneres nicht.
  const oben = suchen(d.gruppen, true) || suchen(d.zeilen, true) || suchen(d.texte, true);
  if (oben) return oben;

  for (const g of d.gruppen) {
    const treffer = suchen(g.eintraege, false);
    if (treffer) return treffer;
  }
  for (const t of d.texte) {
    const treffer = suchen(t.zeilen, false);
    if (treffer) return treffer;
  }
  return null;
};

/**
 * Einen Eintrag um eine Stelle nach oben oder unten schieben.
 *
 * Ist ein Kategoriefilter gesetzt, springt der Schritt ueber alles hinweg, was
 * gerade nicht dasteht — sonst sähe es aus, als bewege sich nichts, weil der
 * Nachbar unsichtbar ist.
 */
const ordnen = (koerper) => {
  const d = lesen();
  const treffer = listeMitId(d, text(koerper.id, 40));
  if (!treffer) return { fehler: 'Eintrag nicht gefunden.' };

  const { liste, stelle } = treffer;
  const richtung = ganz(koerper.schritt) < 0 ? -1 : 1;
  const kategorie = treffer.gefiltert ? text(koerper.kategorie, 40) : '';

  let ziel = stelle + richtung;
  while (ziel >= 0 && ziel < liste.length && !passtZuKategorie(liste[ziel], kategorie)) ziel += richtung;
  if (ziel < 0 || ziel >= liste.length) {
    return { fehler: richtung < 0 ? 'Steht schon ganz oben.' : 'Steht schon ganz unten.' };
  }

  const [weg] = liste.splice(stelle, 1);
  liste.splice(ziel, 0, weg);
  schreiben(d);
  return { ok: true, stelle: ziel };
};

const schubSetzen = (koerper) => {
  const d = lesen();
  const ziel = zeileFinden(d, text(koerper.id, 40));
  if (!ziel) return { fehler: 'Zeile nicht gefunden.' };

  /* Mit Wortnummer wird nur dieses Wort und alles dahinter geschoben, sonst die
     ganze Zeile. Das erste Wort hat keine eigene Luecke — es davor zu schieben
     ist genau der Schub der Zeile. */
  const wort = Number(koerper.wort);
  if (Number.isInteger(wort) && wort > 0) {
    const liste = wortSchubListe(ziel.wortSchub);
    liste[wort] = koerper.zuruecksetzen ? 0 : Math.max(0, (liste[wort] || 0) + ganz(koerper.schritt));
    if (!liste[wort]) delete liste[wort];
    if (Object.keys(liste).length) ziel.wortSchub = liste;
    else delete ziel.wortSchub;
    schreiben(d);
    return { ok: true, wortSchub: liste };
  }

  ziel.schub = koerper.zuruecksetzen ? 0 : ganz(ziel.schub) + ganz(koerper.schritt);
  if (!ziel.schub) delete ziel.schub;
  // Zuruecknehmen raeumt die ganze Zeile auf, auch die Luecken darin.
  if (koerper.zuruecksetzen) delete ziel.wortSchub;

  schreiben(d);
  return { ok: true, schub: ganz(ziel.schub) };
};

/* ---- Umzug zwischen den Reitern --------------------------------------------

   Reime, Zeilen und Texte halten dieselbe Sache in drei Formen. Beim Umzug wird
   deshalb umgeformt statt kopiert: eine Gruppe zerfaellt in ihren Kopfbegriff
   und die Reime darunter, ein Text in seine Zeilen, und eine Zeile wird zum
   Kopf einer neuen Gruppe. Kennungen werden dabei neu vergeben — der Eintrag
   ist danach ein anderes Ding im anderen Reiter, kein Verweis auf das alte.  */

const zielKategorien = (d, nach, ids) => idListe(ids)
  .filter((k) => d.kategorien.some((x) => x.id === k));

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
 * Alles, was an einer Kategorie haengt, in einen anderen Reiter verschieben.
 * Die Kategorie selbst bleibt, wo sie ist — sie gilt ohnehin ueberall.
 */
const kategorieVerschieben = (koerper) => {
  const d = lesen();
  const von = BEREICHE.includes(koerper.von) ? koerper.von : null;
  const nach = BEREICHE.includes(koerper.nach) ? koerper.nach : null;
  if (!von || !nach || von === nach) return { fehler: 'Kein anderer Reiter gewählt.' };

  const id = text(koerper.id, 40);
  if (!d.kategorien.some((k) => k.id === id)) return { fehler: 'Kategorie nicht gefunden.' };

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
  wortSpeichern, kategorieSpeichern, kategorieLoeschen, anzeigeSpeichern, schubSetzen, ordnen,
  eintragVerschieben, kategorieVerschieben,
  suche, rat
};
