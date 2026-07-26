const falten = (s) => String(s || '')
  .toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');

const begriffe = (q) => falten(q).split(/\s+/).filter(Boolean);

const passt = (heuhaufen, worte) => {
  const feld = falten(heuhaufen);
  return worte.every((w) => feld.includes(w));
};

/**
 * Ausschnitt um die erste Fundstelle. Ein Foerderbescheid hat mehrere tausend
 * Zeichen; ohne Ausschnitt waere die Trefferliste unlesbar.
 */
const ausschnitt = (text, worte, breite = 160) => {
  const gefaltet = falten(text);
  let stelle = -1;
  for (const w of worte) {
    const i = gefaltet.indexOf(w);
    if (i !== -1 && (stelle === -1 || i < stelle)) stelle = i;
  }
  if (stelle === -1) return text.slice(0, breite);
  const von = Math.max(0, stelle - Math.floor(breite / 3));
  const bis = Math.min(text.length, von + breite);
  return `${von > 0 ? '… ' : ''}${text.slice(von, bis).trim()}${bis < text.length ? ' …' : ''}`;
};

/**
 * Freitextsuche über Einträge, Aufgaben und Gemeinde-Dokumente.
 * scope: 'alle' | 'aufgaben' | 'dokumente' | eine Kategorie-ID.
 * Sortierung: nach Datum absteigend, damit der jüngste Treffer oben steht.
 */
const suche = (q, { entries = [], kategorien = [], tasks = [], gemeinden = [] }, scope = 'alle') => {
  const worte = begriffe(q);
  if (!worte.length) return { entries: [], tasks: [], dokumente: [], begriffe: [] };

  const katName = new Map(kategorien.map((k) => [k.id, k.name]));
  const alles = scope === 'alle';

  const trefferEntries = (alles || (scope !== 'aufgaben' && scope !== 'dokumente')) ? entries
    .filter((e) => (alles || e.kategorie === scope))
    .filter((e) => passt(`${e.text} ${katName.get(e.kategorie) || ''}`, worte))
    .sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0)) : [];

  const trefferTasks = (alles || scope === 'aufgaben')
    ? tasks
      .filter((t) => passt(`${t.titel} ${t.notiz || ''}`, worte))
      .sort((a, b) => String(b.faellig || b.erstellt).localeCompare(String(a.faellig || a.erstellt)))
    : [];

  // Der ausgelesene Text der Gemeinde-Dokumente ist der Grund, warum beim
  // Hochladen ueberhaupt gelesen statt gespeichert wird.
  const trefferDokumente = [];
  if (alles || scope === 'dokumente') {
    for (const g of gemeinden) {
      for (const d of g.dokumente || []) {
        if (!passt(`${d.name} ${d.text || ''}`, worte)) continue;
        trefferDokumente.push({
          id: d.id,
          gemeindeId: g.id,
          gemeinde: g.name,
          name: d.name,
          datum: d.datum,
          ausschnitt: ausschnitt(d.text || '', worte)
        });
      }
    }
    trefferDokumente.sort((a, b) => String(b.datum).localeCompare(String(a.datum)));
  }

  return { entries: trefferEntries, tasks: trefferTasks, dokumente: trefferDokumente, begriffe: worte };
};

export { suche, falten, ausschnitt };
