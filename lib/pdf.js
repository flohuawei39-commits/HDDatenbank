'use strict';

const { pathToFileURL } = require('url');
const path = require('path');

// pdfjs ist ein ES-Modul; einmal laden und merken.
let pdfjsCache = null;
const pdfjsLaden = async () => {
  if (!pdfjsCache) {
    const ziel = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs');
    pdfjsCache = await import(pathToFileURL(ziel).href);
  }
  return pdfjsCache;
};

const Y_TOLERANZ = 3;

/**
 * Liest die Textebene eines PDF und gruppiert sie zu Zeilen.
 * Jede Zeile behaelt die x-Positionen ihrer Teile — ohne die lassen sich
 * Spalten wie "Eingehend" und "Ausgehend" nicht auseinanderhalten.
 */
const lesen = async (puffer) => {
  const pdfjs = await pdfjsLaden();
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(puffer),
    useSystemFonts: false,
    isEvalSupported: false
  }).promise;

  const seiten = [];
  for (let nr = 1; nr <= doc.numPages; nr += 1) {
    const seite = await doc.getPage(nr);
    const inhalt = await seite.getTextContent();
    const roh = [];
    for (const item of inhalt.items) {
      if (!item.str || !item.str.trim()) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      roh.push({ x, y, breite: item.width || 0, rechts: x + (item.width || 0), text: item.str });
    }
    seiten.push({ nummer: nr, zeilen: zuZeilen(roh) });
  }
  await doc.destroy?.();
  return seiten;
};

/** Textstuecke mit fast gleicher Hoehe gehoeren zur selben Zeile. */
const zuZeilen = (teile) => {
  const sortiert = [...teile].sort((a, b) => b.y - a.y || a.x - b.x);
  const zeilen = [];
  for (const teil of sortiert) {
    const letzte = zeilen[zeilen.length - 1];
    if (letzte && Math.abs(letzte.y - teil.y) <= Y_TOLERANZ) letzte.teile.push(teil);
    else zeilen.push({ y: teil.y, teile: [teil] });
  }
  for (const zeile of zeilen) {
    zeile.teile.sort((a, b) => a.x - b.x);
    zeile.text = zeile.teile.map((t) => t.text).join(' ').replace(/\s+/g, ' ').trim();
  }
  return zeilen;
};

/** Deutsche Zahl mit Tausenderpunkt und Komma: "-1.064,35€" wird zu -1064.35 */
const zahl = (roh) => {
  if (roh == null) return null;
  const treffer = String(roh).match(/-?\+?\s*-?[\d.]+,\d{2}/);
  if (!treffer) return null;
  const sauber = treffer[0].replace(/\s/g, '').replace(/\./g, '').replace(',', '.');
  const wert = Number(sauber);
  return Number.isFinite(wert) ? wert : null;
};

/** Enthaelt das Textstueck einen Betrag, und endet es in der erwarteten Spalte? */
const betragInSpalte = (zeile, rechtsKante, spielraum = 12) => {
  for (const teil of zeile.teile) {
    if (Math.abs(teil.rechts - rechtsKante) > spielraum) continue;
    const wert = zahl(teil.text);
    if (wert !== null) return { wert, teil };
  }
  return null;
};

/** Alle Textstuecke links einer Grenze, zu einem Text verbunden. */
const linksVon = (zeile, grenze) => zeile.teile
  .filter((t) => t.x < grenze)
  .map((t) => t.text)
  .join(' ')
  .replace(/\s+/g, ' ')
  .trim();

const MONATE = {
  januar: 1, februar: 2, 'märz': 3, maerz: 3, april: 4, mai: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, dezember: 12
};

const p2 = (n) => String(n).padStart(2, '0');

/** "25. Juli 2026" wird zu "2026-07-25" */
const deutschesDatum = (text) => {
  const treffer = String(text || '').match(/(\d{1,2})\.\s*([A-Za-zÄÖÜäöüß]+)\s+(\d{4})/);
  if (!treffer) return null;
  const monat = MONATE[treffer[2].toLowerCase()];
  if (!monat) return null;
  return `${treffer[3]}-${p2(monat)}-${p2(Number(treffer[1]))}`;
};

/** "01.03.2026" wird zu "2026-03-01" */
const punktDatum = (text) => {
  const treffer = String(text || '').match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  if (!treffer) return null;
  return `${treffer[3]}-${treffer[2]}-${treffer[1]}`;
};

module.exports = { lesen, zuZeilen, zahl, betragInSpalte, linksVon, deutschesDatum, punktDatum, Y_TOLERANZ };
