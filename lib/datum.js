'use strict';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

const p2 = (n) => String(n).padStart(2, '0');

const istISO = (s) => typeof s === 'string' && ISO.test(s);

const zuDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const zuISO = (date) => `${date.getFullYear()}-${p2(date.getMonth() + 1)}-${p2(date.getDate())}`;

const plusTage = (iso, n) => {
  const d = zuDate(iso);
  d.setDate(d.getDate() + n);
  return zuISO(d);
};

const plusMonate = (iso, n) => {
  const d = zuDate(iso);
  const tag = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  // 31. Januar plus ein Monat gibt es nicht — auf den letzten Tag des Zielmonats klemmen.
  const letzter = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(tag, letzter));
  return zuISO(d);
};

const differenzTage = (von, bis) => Math.round((zuDate(bis) - zuDate(von)) / 86400000);

/** 0 = Montag, 6 = Sonntag */
const wochentag = (iso) => (zuDate(iso).getDay() + 6) % 7;

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const TAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const TAGE_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

const formatDE = (iso) => {
  const [y, m, d] = iso.split('-');
  return `${Number(d)}.${Number(m)}.${y}`;
};

const formatLang = (iso) => `${TAGE_LANG[wochentag(iso)]}, ${Number(iso.slice(8))}. ${MONATE[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/** Volle Wochen Montag bis Sonntag, die den Monat abdecken. */
const monatsGitter = (jahr, monat) => {
  const erster = `${jahr}-${p2(monat)}-01`;
  const start = plusTage(erster, -wochentag(erster));
  const tage = [];
  for (let i = 0; i < 42; i += 1) tage.push(plusTage(start, i));
  // Sechste Woche nur behalten, wenn sie noch zum Monat gehört.
  const sechste = tage.slice(35);
  return sechste.some((t) => Number(t.slice(5, 7)) === monat) ? tage : tage.slice(0, 35);
};

module.exports = {
  istISO, zuDate, zuISO, plusTage, plusMonate, differenzTage, wochentag,
  monatsGitter, formatDE, formatLang, MONATE, TAGE_KURZ, TAGE_LANG
};
