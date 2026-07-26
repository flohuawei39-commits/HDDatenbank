'use strict';

const D = require('./datum');

const TYPEN = ['taeglich', 'woechentlich', 'monatlich', 'jaehrlich'];

/** Startdatum des k-ten Vorkommens, ausgehend vom Basisdatum. */
const startVon = (basis, wdh, k) => {
  const n = Math.max(1, Number(wdh.intervall) || 1) * k;
  if (wdh.typ === 'taeglich') return D.plusTage(basis, n);
  if (wdh.typ === 'woechentlich') return D.plusTage(basis, n * 7);
  if (wdh.typ === 'monatlich') return D.plusMonate(basis, n);
  if (wdh.typ === 'jaehrlich') return D.plusMonate(basis, n * 12);
  return basis;
};

/** Grober Sprung nach vorn, damit alte Serien nicht Tag für Tag durchlaufen werden. */
const schaetzeStart = (basis, wdh, von, dauer) => {
  const intervall = Math.max(1, Number(wdh.intervall) || 1);
  const tage = D.differenzTage(basis, von) - dauer;
  if (tage <= 0) return 0;
  const proSchritt = { taeglich: 1, woechentlich: 7, monatlich: 30.4, jaehrlich: 365.25 }[wdh.typ] || 1;
  return Math.max(0, Math.floor(tage / (proSchritt * intervall)) - 2);
};

/**
 * Vorkommen eines Eintrags im Zeitraum [von, bis].
 * Liefert je Vorkommen { start, ende, tage: [ISO, ...] }.
 */
const vorkommen = (entry, von, bis) => {
  if (!D.istISO(entry.datum)) return [];
  const ende = D.istISO(entry.datumBis) && entry.datumBis >= entry.datum ? entry.datumBis : entry.datum;
  const dauer = D.differenzTage(entry.datum, ende);
  const wdh = entry.wiederholung;

  if (!wdh || !TYPEN.includes(wdh.typ)) {
    if (ende < von || entry.datum > bis) return [];
    return [bauen(entry.datum, dauer)];
  }

  const grenze = D.istISO(wdh.bis) ? (wdh.bis < bis ? wdh.bis : bis) : bis;
  const treffer = [];
  let k = schaetzeStart(entry.datum, wdh, von, dauer);
  for (let i = 0; i < 800; i += 1) {
    const start = startVon(entry.datum, wdh, k);
    if (start > grenze) break;
    const stop = D.plusTage(start, dauer);
    if (stop >= von) treffer.push(bauen(start, dauer));
    if (treffer.length >= 400) break;
    k += 1;
  }
  return treffer;
};

const bauen = (start, dauer) => {
  const tage = [];
  for (let i = 0; i <= dauer; i += 1) tage.push(D.plusTage(start, i));
  return { start, ende: D.plusTage(start, dauer), tage };
};

/** Nächstes Vorkommen ab einem Stichtag, oder null. */
const naechstes = (entry, ab) => {
  const bis = D.plusTage(ab, 800);
  const alle = vorkommen(entry, ab, bis);
  return alle.length ? alle[0] : null;
};

module.exports = { TYPEN, vorkommen, naechstes };
