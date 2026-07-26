'use strict';

const falten = (s) => String(s || '')
  .toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

const begriffe = (q) => falten(q).split(/\s+/).filter(Boolean);

const passt = (heuhaufen, worte) => {
  const feld = falten(heuhaufen);
  return worte.every((w) => feld.includes(w));
};

/**
 * Freitextsuche über Einträge und Aufgaben.
 * scope: 'alle' | 'aufgaben' | eine Kategorie-ID.
 * Sortierung: nach Datum absteigend, damit der jüngste Treffer oben steht.
 */
const suche = (q, { entries = [], kategorien = [], tasks = [] }, scope = 'alle') => {
  const worte = begriffe(q);
  if (!worte.length) return { entries: [], tasks: [], begriffe: [] };

  const katName = new Map(kategorien.map((k) => [k.id, k.name]));

  const trefferEntries = scope === 'aufgaben' ? [] : entries
    .filter((e) => (scope === 'alle' || e.kategorie === scope))
    .filter((e) => passt(`${e.text} ${katName.get(e.kategorie) || ''}`, worte))
    .sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0));

  const trefferTasks = (scope === 'alle' || scope === 'aufgaben')
    ? tasks
      .filter((t) => passt(`${t.titel} ${t.notiz || ''}`, worte))
      .sort((a, b) => String(b.faellig || b.erstellt).localeCompare(String(a.faellig || a.erstellt)))
    : [];

  return { entries: trefferEntries, tasks: trefferTasks, begriffe: worte };
};

module.exports = { suche, falten };
