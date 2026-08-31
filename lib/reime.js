/* Reimlogik: Anmerkungen, Vergleich, Silbensuche, Vorschlaege, Zaehlung.

   Getrennt von silben.js, weil dort nur steht, welche Kerne in einem Wort
   stecken. Hier kommt dazu, was der Benutzer daraus gemacht hat: Korrekturen
   und Anmerkungen. Beides haengt am Wort, nicht am einzelnen Vorkommen — wer
   bei "Steuer" einmal ein a anmerkt, will das ueberall so haben.

   Die Trefferregel ist bewusst einfach: eine Silbe ist getroffen, sobald der
   geschriebene Kern ODER eine ihrer Anmerkungen passt. Prioritaet und der
   Schalter "Buchstabe oder Anmerkung relevanter" entscheiden nur ueber Farbe
   und Rangfolge, nie darueber, ob etwas ueberhaupt trifft.                   */

import * as silben from './silben.js';

const PRIORITAETEN = ['wichtig', 'mittel', 'unwichtig'];
const PRIO_GEWICHT = { wichtig: 3, mittel: 2, unwichtig: 1 };
const RELEVANZ = ['buchstabe', 'anmerkung'];
const MAX_ANMERKUNGEN = 3;
const MAX_MUSTER = 10;

/* Dreizehn Toene, gleichmaessig ueber den Farbkreis verteilt, damit auch a und
   e auf dunklem Grund nicht ineinanderlaufen. `ie` sitzt bewusst weit weg von
   i — die beiden zu verwechseln waere hier am teuersten. Umstellbar in den
   Einstellungen; das hier ist nur der Anfangsstand. */
const FARBEN = {
  a: '#e96363', au: '#e9a163', i: '#e9de63', ü: '#b5e963',
  u: '#77e963', ei: '#63e98c', e: '#63e9ca', eu: '#63cae9',
  ie: '#638ce9', ö: '#7763e9', o: '#b563e9', ey: '#e963de',
  ä: '#e963a1'
};

const einmalig = (liste) => [...new Set(liste)];

/** Anmerkungen eines Wortes auf eine brauchbare Form bringen. */
const wortNormalisieren = (wert) => {
  const roh = wert && typeof wert === 'object' ? wert : {};
  const silbenListe = Array.isArray(roh.silben) ? roh.silben : [];
  return {
    silben: silbenListe.map((s) => {
      const eintrag = s && typeof s === 'object' ? s : {};
      const anmerkungen = (Array.isArray(eintrag.anmerkungen) ? eintrag.anmerkungen : [])
        .filter((a) => a && silben.LAUTE.includes(a.laut))
        .slice(0, MAX_ANMERKUNGEN)
        .map((a) => ({
          laut: a.laut,
          prioritaet: PRIORITAETEN.includes(a.prioritaet) ? a.prioritaet : 'mittel'
        }));
      return {
        korrektur: silben.LAUTE.includes(eintrag.korrektur) ? eintrag.korrektur : null,
        relevanz: RELEVANZ.includes(eintrag.relevanz) ? eintrag.relevanz : 'buchstabe',
        anmerkungen
      };
    })
  };
};

/** Was an einer Silbe haengt: zulaessige Laute, farbgebender Laut, Gewicht. */
const silbeAnreichern = (silbe, wortDaten) => {
  const zusatz = (wortDaten && wortDaten.silben && wortDaten.silben[silbe.silbeIndex]) || null;
  const anmerkungen = zusatz ? zusatz.anmerkungen : [];
  const kern = (zusatz && zusatz.korrektur) || silbe.kern;
  const relevanz = zusatz ? zusatz.relevanz : 'buchstabe';
  // Steht die Anmerkung vorn, faerbt die wichtigste Anmerkung die Silbe.
  const primaer = relevanz === 'anmerkung' && anmerkungen.length
    ? [...anmerkungen].sort((a, b) => PRIO_GEWICHT[b.prioritaet] - PRIO_GEWICHT[a.prioritaet])[0].laut
    : kern;

  return {
    ...silbe,
    kern,
    korrigiert: Boolean(zusatz && zusatz.korrektur),
    anmerkungen,
    relevanz,
    primaer,
    laute: einmalig([kern, ...anmerkungen.map((a) => a.laut)])
  };
};

/**
 * Silbenkette eines Eintrags, angereichert um alles, was am Wort haengt.
 * Die Ablage ist die woerter-Karte aus reime.json.
 */
const kette = (text, ablage = {}) => silben.kette(text)
  .map((s) => silbeAnreichern(s, ablage[s.schluessel] || null));

/** Treffen sich zwei Silben in mindestens einem Laut? */
const passt = (a, b) => a.laute.some((l) => b.laute.includes(l));

/** Wie schwer ein Treffer wiegt: auf dem relevanten Laut zaehlt er doppelt. */
const gewicht = (a, b) => (a.primaer === b.primaer ? 2 : 1);

/**
 * Laengste ununterbrochene Uebereinstimmung zweier Ketten.
 *
 * Die Rueckgabe traegt die Startstellen in beiden Ketten mit: die Ausrichtung
 * im Reime-Reiter schiebt die Zeilen genau daran zurecht.
 */
const vergleich = (a, b) => {
  let bestes = { laenge: 0, a: 0, b: 0, gewicht: 0 };
  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      let l = 0;
      let g = 0;
      while (i + l < a.length && j + l < b.length && passt(a[i + l], b[j + l])) {
        g += gewicht(a[i + l], b[j + l]);
        l += 1;
      }
      if (l > bestes.laenge || (l === bestes.laenge && l > 0 && g > bestes.gewicht)) {
        bestes = { laenge: l, a: i, b: j, gewicht: g };
      }
    }
  }
  return bestes;
};

/**
 * Silbensuche.
 *
 * Das Muster ist eine Folge von Lauten, die in dieser Reihenfolge vorkommen
 * muss. Das Budget sagt, wie viele fremde Silben dabei INSGESAMT uebersprungen
 * werden duerfen — und zwar nur zwischen den gesuchten Silben. Was davor oder
 * dahinter steht, bleibt frei, sonst fielen laengere Wortfolgen grundsaetzlich
 * heraus. Mit nurEnde muss die letzte Mustersilbe die letzte der Kette sein.
 *
 * Gesucht wird ueber eine Karte von Stelle zu guenstigstem Verbrauch; damit
 * bleibt die Laufzeit im Rahmen von Kettenlaenge mal Musterlaenge.
 */
const suchen = (muster, kette, wahl = {}) => {
  const budget = Math.max(0, Number(wahl.budget) || 0);
  const nurEnde = Boolean(wahl.nurEnde);
  const m = (Array.isArray(muster) ? muster : [])
    .filter((l) => silben.LAUTE.includes(l))
    .slice(0, MAX_MUSTER);
  if (!m.length || !kette.length) return null;

  const trifft = (silbe, laut) => silbe.laute.includes(laut);

  // Startstellen: jede Silbe, die die erste Mustersilbe traegt.
  let stand = new Map();
  for (let i = 0; i < kette.length; i += 1) {
    if (trifft(kette[i], m[0])) stand.set(i, { verbrauch: 0, stellen: [i] });
  }

  for (let j = 1; j < m.length; j += 1) {
    const naechster = new Map();
    for (const [pos, wert] of stand) {
      const grenze = Math.min(kette.length - 1, pos + 1 + (budget - wert.verbrauch));
      for (let p = pos + 1; p <= grenze; p += 1) {
        if (!trifft(kette[p], m[j])) continue;
        const verbrauch = wert.verbrauch + (p - pos - 1);
        const vorhanden = naechster.get(p);
        if (!vorhanden || vorhanden.verbrauch > verbrauch) {
          naechster.set(p, { verbrauch, stellen: [...wert.stellen, p] });
        }
      }
    }
    stand = naechster;
    if (!stand.size) return null;
  }

  let bestes = null;
  for (const [pos, wert] of stand) {
    if (nurEnde && pos !== kette.length - 1) continue;
    if (!bestes || wert.verbrauch < bestes.verbrauch) bestes = wert;
  }
  if (!bestes) return null;

  return {
    stellen: bestes.stellen,
    verbrauch: bestes.verbrauch,
    von: bestes.stellen[0],
    bis: bestes.stellen[bestes.stellen.length - 1]
  };
};

/**
 * Vorschlaege aus dem Bestand: alles, was mindestens so viele unmittelbar
 * aufeinanderfolgende Silben mit der Vorlage teilt wie verlangt. Wo im Wort das
 * liegt, ist egal — so tauchen auch Binnenreime auf.
 */
const vorschlaege = (vorlage, kandidaten, mindest = 2, grenze = 30) => kandidaten
  .map((k) => ({ ...k, treffer: vergleich(vorlage, k.kette) }))
  .filter((k) => k.treffer.laenge >= Math.max(1, mindest))
  .sort((a, b) => b.treffer.laenge - a.treffer.laenge
    || b.treffer.gewicht - a.treffer.gewicht
    || a.kette.length - b.kette.length)
  .slice(0, grenze);

/**
 * Zaehlung hinter einem Reim: wie viele Silben am Stueck zum Eintrag darueber
 * und zu dem darunter passen, und wie viele Silben er insgesamt hat.
 * Anmerkungen zaehlen dabei vollstaendig mit, auch die mit geringer Prioritaet.
 */
const zaehlung = (eigene, oben, unten) => ({
  oben: oben && oben.length ? vergleich(eigene, oben).laenge : 0,
  unten: unten && unten.length ? vergleich(eigene, unten).laenge : 0,
  gesamt: eigene.length
});

export {
  PRIORITAETEN, PRIO_GEWICHT, RELEVANZ, MAX_ANMERKUNGEN, MAX_MUSTER, FARBEN,
  wortNormalisieren, silbeAnreichern, kette, passt, vergleich, suchen, vorschlaege, zaehlung
};
