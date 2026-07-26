'use strict';

const fs = require('fs');
const path = require('path');
const store = require('./store');
const D = require('./datum');

const RICHTUNGEN = ['raus', 'rein', 'intern'];
const STAND_IDS = store.STAENDE.map((s) => s.id);

const lesen = () => {
  const daten = store.read('gemeinden.json');
  return Array.isArray(daten.gemeinden) ? daten.gemeinden : [];
};

const schreiben = (gemeinden) => store.write('gemeinden.json', { gemeinden });

const text = (wert, max = 4000) => String(wert == null ? '' : wert).trim().slice(0, max);
const datumOderNull = (wert) => (D.istISO(wert) ? wert : null);

/**
 * Dateiname entschaerfen. Bewusst konservativ: Pfadwechsel und die Zeichen, die
 * Windows im Dateinamen verbietet, werden ersetzt. Leerzeichen, Bindestriche und
 * Umlaute bleiben, damit "Brief an Gemeinde 2026-07-25.pdf" lesbar bleibt.
 */
const VERBOTEN = /[<>:"|?*]/g;

// Steuerzeichen ueber den Codepoint aussieben statt ueber eine Zeichenklasse:
// so steht kein einziges Steuerzeichen im Quelltext.
const ohneSteuerzeichen = (s) => [...s]
  .filter((z) => { const c = z.codePointAt(0); return c > 31 && c !== 127; })
  .join('');

const sichererName = (name) => {
  const roh = ohneSteuerzeichen(String(name == null ? '' : name))
    .replace(/[\\/]/g, '_')
    .replace(VERBOTEN, '_')
    .replace(/^\.+/, '_')
    .replace(/\.+$/, '')
    .trim()
    .slice(0, 120);
  return roh || 'datei';
};

const ordnerFuer = (gemeindeId) => {
  const ziel = path.join(store.DOKUMENTE_DIR, gemeindeId);
  if (!ziel.startsWith(store.DOKUMENTE_DIR)) throw new Error('Ungültiger Ordner.');
  if (!fs.existsSync(ziel)) fs.mkdirSync(ziel, { recursive: true });
  return ziel;
};

// ---------------------------------------------------------------- Übersicht

/**
 * Offene Aufgaben einer Akte, datierte zuerst nach Datum, undatierte danach.
 * Ohne Datum ist ausdruecklich erlaubt — solche Aufgaben erreichen die
 * Signalzeile und die Tagesmail nicht, nur die Gemeinden-Kachel und die Akte.
 */
const offeneAufgaben = (gemeinde) => [...(gemeinde.fristen || [])]
  .filter((f) => !f.erledigt)
  .sort((a, b) => {
    if (a.datum && b.datum) return a.datum.localeCompare(b.datum);
    if (a.datum) return -1;
    if (b.datum) return 1;
    return 0;
  });

/** Anreicherung für die Listenansicht: seit wann still, welche Frist als nächstes. */
const mitStatus = (gemeinde, heute) => {
  const verlauf = [...(gemeinde.verlauf || [])].sort((a, b) => (a.datum < b.datum ? 1 : -1));
  const letzte = verlauf[0] || null;
  const offen = offeneAufgaben(gemeinde);
  const datiert = offen.filter((f) => f.datum);
  const naechsteFrist = datiert.find((f) => f.datum >= heute) || datiert[0] || null;

  return {
    ...gemeinde,
    letzteAktivitaet: letzte ? letzte.datum : null,
    letzterSchritt: letzte ? letzte.text : null,
    tageStill: letzte ? D.differenzTage(letzte.datum, heute) : null,
    naechsteFrist,
    offeneAufgaben: offen.length,
    aufgabenListe: offen.map((f) => ({
      id: f.id,
      text: f.text,
      datum: f.datum || null,
      tageBis: f.datum ? D.differenzTage(heute, f.datum) : null
    })),
    anzahlDateien: (gemeinde.dateien || []).length,
    anzahlSchritte: (gemeinde.verlauf || []).length
  };
};

const uebersicht = (heute) => {
  const rang = Object.fromEntries(STAND_IDS.map((id, i) => [id, i]));
  return lesen()
    .map((g) => mitStatus(g, heute))
    .sort((a, b) => {
      const s = (rang[a.stand] ?? 9) - (rang[b.stand] ?? 9);
      if (s) return s;
      return (b.tageStill ?? -1) - (a.tageStill ?? -1);
    });
};

/** Offene Fristen aller Gemeinden im Fenster — speist Startseite und Tagesmail. */
const fristen = (heute, bisTag) => {
  const raus = [];
  for (const gemeinde of lesen()) {
    for (const frist of gemeinde.fristen || []) {
      if (frist.erledigt || !frist.datum || frist.datum < heute || frist.datum > bisTag) continue;
      raus.push({
        id: frist.id,
        gemeindeId: gemeinde.id,
        gemeinde: gemeinde.name,
        datum: frist.datum,
        text: frist.text,
        tageBis: D.differenzTage(heute, frist.datum)
      });
    }
  }
  return raus.sort((a, b) => a.tageBis - b.tageBis);
};

// ---------------------------------------------------------------- Stammdaten

const speichern = (koerper) => {
  const gemeinden = lesen();
  const name = text(koerper.name, 120);
  if (!name) return { fehler: 'Name fehlt.' };

  const felder = {
    name,
    ansprechpartner: text(koerper.ansprechpartner, 200),
    kontakt: text(koerper.kontakt, 300),
    stand: STAND_IDS.includes(koerper.stand) ? koerper.stand : 'erstkontakt',
    notiz: text(koerper.notiz, 8000),
    geaendert: store.jetzt()
  };

  const vorhanden = gemeinden.find((g) => g.id === koerper.id);
  if (vorhanden) {
    Object.assign(vorhanden, felder);
    schreiben(gemeinden);
    return { ok: true, gemeinde: vorhanden };
  }

  const neu = { id: store.id('g'), ...felder, verlauf: [], fristen: [], dateien: [], erstellt: store.jetzt() };
  schreiben([...gemeinden, neu]);
  return { ok: true, gemeinde: neu };
};

const loeschen = (id) => {
  const gemeinden = lesen();
  const ziel = gemeinden.find((g) => g.id === id);
  if (!ziel) return { fehler: 'Gemeinde nicht gefunden.' };
  if ((ziel.dateien || []).length) {
    return { fehler: `Es liegen noch ${ziel.dateien.length} Dateien in dieser Akte. Erst die Dateien löschen.` };
  }
  schreiben(gemeinden.filter((g) => g.id !== id));
  return { ok: true };
};

/* ------------------------------------------------------- Verlauf und Aufgaben

   Der Speicherschluessel heisst weiter `fristen`, obwohl die Oberflaeche
   "Aufgaben" sagt. Bewusst so gelassen: der Bestand enthaelt bereits Eintraege,
   und ein Umbenennen des Schluessels waere eine Datenmigration ohne Gegenwert.
   Eine Aufgabe mit Datum verhaelt sich wie die frueheren Fristen (Signalzeile,
   Tagesmail), eine ohne Datum lebt nur in der Akte und der Gemeinden-Kachel.  */

const holen = (gemeinden, id) => gemeinden.find((g) => g.id === id);

const verlaufSpeichern = (koerper) => {
  const gemeinden = lesen();
  const gemeinde = holen(gemeinden, koerper.gemeindeId);
  if (!gemeinde) return { fehler: 'Gemeinde nicht gefunden.' };
  const inhalt = text(koerper.text, 2000);
  if (!inhalt) return { fehler: 'Text fehlt.' };

  const felder = {
    datum: datumOderNull(koerper.datum) || store.heute(),
    text: inhalt,
    richtung: RICHTUNGEN.includes(koerper.richtung) ? koerper.richtung : 'raus'
  };

  gemeinde.verlauf = gemeinde.verlauf || [];
  const vorhanden = gemeinde.verlauf.find((v) => v.id === koerper.id);
  if (vorhanden) Object.assign(vorhanden, felder);
  else gemeinde.verlauf.push({ id: store.id('v'), ...felder, erstellt: store.jetzt() });

  gemeinde.geaendert = store.jetzt();
  schreiben(gemeinden);
  return { ok: true };
};

const verlaufLoeschen = (gemeindeId, id) => {
  const gemeinden = lesen();
  const gemeinde = holen(gemeinden, gemeindeId);
  if (!gemeinde) return { fehler: 'Gemeinde nicht gefunden.' };
  gemeinde.verlauf = (gemeinde.verlauf || []).filter((v) => v.id !== id);
  schreiben(gemeinden);
  return { ok: true };
};

const fristSpeichern = (koerper) => {
  const gemeinden = lesen();
  const gemeinde = holen(gemeinden, koerper.gemeindeId);
  if (!gemeinde) return { fehler: 'Gemeinde nicht gefunden.' };
  const datum = datumOderNull(koerper.datum); // freiwillig — null ist gueltig
  const inhalt = text(koerper.text, 300);
  if (!inhalt) return { fehler: 'Text fehlt.' };

  const felder = { datum, text: inhalt, erledigt: Boolean(koerper.erledigt) };
  gemeinde.fristen = gemeinde.fristen || [];
  const vorhanden = gemeinde.fristen.find((f) => f.id === koerper.id);
  if (vorhanden) Object.assign(vorhanden, felder);
  else gemeinde.fristen.push({ id: store.id('f'), ...felder, erstellt: store.jetzt() });

  gemeinde.geaendert = store.jetzt();
  schreiben(gemeinden);
  return { ok: true };
};

const fristLoeschen = (gemeindeId, id) => {
  const gemeinden = lesen();
  const gemeinde = holen(gemeinden, gemeindeId);
  if (!gemeinde) return { fehler: 'Gemeinde nicht gefunden.' };
  gemeinde.fristen = (gemeinde.fristen || []).filter((f) => f.id !== id);
  schreiben(gemeinden);
  return { ok: true };
};

// ---------------------------------------------------------------- Dateien

const dateiAblegen = (gemeindeId, dateiname, puffer) => {
  const gemeinden = lesen();
  const gemeinde = holen(gemeinden, gemeindeId);
  if (!gemeinde) return { fehler: 'Gemeinde nicht gefunden.' };
  if (!puffer || !puffer.length) return { fehler: 'Datei ist leer.' };

  const ordner = ordnerFuer(gemeindeId);
  const basis = sichererName(dateiname);
  const id = store.id('d');
  const gespeichert = `${id}__${basis}`;
  fs.writeFileSync(path.join(ordner, gespeichert), puffer);

  gemeinde.dateien = gemeinde.dateien || [];
  gemeinde.dateien.push({
    id,
    name: basis,
    datei: gespeichert,
    groesse: puffer.length,
    hochgeladen: store.jetzt()
  });
  gemeinde.geaendert = store.jetzt();
  schreiben(gemeinden);
  return { ok: true, datei: gemeinde.dateien[gemeinde.dateien.length - 1] };
};

const dateiPfad = (gemeindeId, id) => {
  const gemeinde = holen(lesen(), gemeindeId);
  if (!gemeinde) return null;
  const eintrag = (gemeinde.dateien || []).find((d) => d.id === id);
  if (!eintrag) return null;
  const voll = path.join(store.DOKUMENTE_DIR, gemeindeId, eintrag.datei);
  if (!voll.startsWith(store.DOKUMENTE_DIR) || !fs.existsSync(voll)) return null;
  return { pfad: voll, name: eintrag.name };
};

const dateiLoeschen = (gemeindeId, id) => {
  const gemeinden = lesen();
  const gemeinde = holen(gemeinden, gemeindeId);
  if (!gemeinde) return { fehler: 'Gemeinde nicht gefunden.' };
  const eintrag = (gemeinde.dateien || []).find((d) => d.id === id);
  if (!eintrag) return { fehler: 'Datei nicht gefunden.' };

  const voll = path.join(store.DOKUMENTE_DIR, gemeindeId, eintrag.datei);
  if (voll.startsWith(store.DOKUMENTE_DIR) && fs.existsSync(voll)) fs.rmSync(voll);

  gemeinde.dateien = gemeinde.dateien.filter((d) => d.id !== id);
  gemeinde.geaendert = store.jetzt();
  schreiben(gemeinden);
  return { ok: true };
};

module.exports = {
  RICHTUNGEN, lesen, uebersicht, fristen, offeneAufgaben, speichern, loeschen,
  verlaufSpeichern, verlaufLoeschen, fristSpeichern, fristLoeschen,
  dateiAblegen, dateiPfad, dateiLoeschen, sichererName, mitStatus
};
