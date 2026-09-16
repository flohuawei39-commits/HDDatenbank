/* Kalenderbetraege als Buchungen.

   Ein Kalendereintrag mit Betrag (Miete, Gehalt, Zahnarzt) ist Geld, das
   kommt oder geht — nur steht es nicht im Kontoauszug, sondern im Kalender,
   oft bevor die Bank es sieht. Hier werden diese Eintraege in dieselbe Form
   gebracht wie Buchungen aus dem Auszug, damit Finanzen und Startseite sie
   mitzaehlen, ohne dass irgendwo etwas doppelt gepflegt werden muss.

   Es wird nichts gespeichert: die Buchungen entstehen bei jedem Lesen neu aus
   den Eintraegen. Geaendert wird im Kalender, nicht in den Finanzen.        */

import * as store from './store.js';
import * as D from './datum.js';
import * as wdh from './recurrence.js';

/** So heisst das "Konto", unter dem die Kalenderbetraege laufen. */
const BANK = 'Kalender';

const normal = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Buchungen aus dem Kalender im Zeitraum [von, bis]. Ohne Grenzen: vom
 * aeltesten Eintrag bis Jahresende — was danach im Kalender steht, ist noch
 * keine Finanzfrage. Serien zaehlen je Vorkommen, mehrtaegiges am ersten Tag.
 *
 * Die Kategorie kommt ueber den Namen: heisst die Kalenderkategorie wie eine
 * Finanzkategorie, wird sie uebernommen, sonst bleibt die Buchung ohne.
 */
const buchungen = (von = null, bis = null, finKategorien = []) => {
  const e = store.read('entries.json');
  const entries = (Array.isArray(e.entries) ? e.entries : []).filter((x) => Number.isFinite(x.betrag));
  if (!entries.length) return [];

  const heute = store.heute();
  const start = von || entries.map((x) => x.datum).filter(D.istISO).sort()[0] || heute;
  const ende = bis || `${heute.slice(0, 4)}-12-31`;
  if (start > ende) return [];

  const kalKategorien = new Map((Array.isArray(e.kategorien) ? e.kategorien : []).map((k) => [k.id, normal(k.name)]));
  const finNachName = new Map(finKategorien.map((k) => [normal(k.name), k.id]));

  const liste = [];
  for (const eintrag of entries) {
    const kategorie = finNachName.get(kalKategorien.get(eintrag.kategorie)) || null;
    for (const v of wdh.vorkommen(eintrag, start, ende)) {
      if (v.start < start || v.start > ende) continue;
      liste.push({
        id: `kal_${eintrag.id}_${v.start}`,
        datum: v.start,
        text: eintrag.text,
        betrag: eintrag.betrag,
        bank: BANK,
        kategorie,
        bereich: 'privat',
        umbuchung: false,
        quelle: 'kalender',
        eintragId: eintrag.id
      });
    }
  }
  return liste;
};

export { BANK, buchungen };
