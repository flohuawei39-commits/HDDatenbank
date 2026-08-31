/* Silbenkerne aus der Schreibweise.

   Eine Silbe steuert genau einen Kern bei: den Vokal, Umlaut oder Doppellaut,
   der in ihr steckt. Konsonanten tauchen nie auf. "Hundesteuer" ergibt also
   u, e, eu, e und nicht mehr.

   Bewusst regelbasiert und ohne Woerterbuch: die Anwendung laeuft ohne Netz und
   ohne Server, und ein Aussprachewoerterbuch waere mehrere Megabyte schwer und
   haette bei Namen, Slang und Kunstwoertern trotzdem nichts zu sagen. Was die
   Regeln danebenlegen, laesst sich am Wort von Hand richtigstellen — siehe
   `korrektur` in reime.js.

   Zusammenfassungen, die fest verabredet sind:
     aeu -> eu,  ai und ay -> ei,  y -> i,  ie -> i
     Doppelvokale und Dehnungs-h fallen auf den Grundvokal zusammen.          */

/** Die zwoelf Laute, mit denen ueberall gerechnet wird. */
const LAUTE = ['a', 'e', 'i', 'o', 'u', 'ä', 'ö', 'ü', 'au', 'eu', 'ei', 'ey'];

/* Von lang nach kurz geprueft: die erste passende Gruppe gewinnt. Deshalb steht
   "äu" vor "ä" und "ie" vor "i" — umgekehrt wuerde jede Doppelform zerfallen. */
const GRUPPEN = [
  ['äu', 'eu'], ['eu', 'eu'], ['au', 'au'],
  ['ei', 'ei'], ['ai', 'ei'], ['ay', 'ei'], ['ey', 'ey'],
  ['ieh', 'i'], ['ie', 'i'],
  ['aa', 'a'], ['ee', 'e'], ['oo', 'o'],
  ['ah', 'a'], ['äh', 'ä'], ['eh', 'e'], ['ih', 'i'], ['oh', 'o'], ['uh', 'u'],
  ['öh', 'ö'], ['üh', 'ü'],
  ['a', 'a'], ['e', 'e'], ['i', 'i'], ['o', 'o'], ['u', 'u'],
  ['ä', 'ä'], ['ö', 'ö'], ['ü', 'ü'],
  ['y', 'i']
];

const VOKALE = 'aeiouäöüy';

/** Kleinschreiben und alles wegnehmen, was kein Buchstabe ist. */
const normalisieren = (wort) => String(wort == null ? '' : wort)
  .toLowerCase()
  .replace(/ß/g, 'ss')
  .replace(/[^a-zäöü]/g, '');

/**
 * Silbenkerne eines einzelnen Wortes.
 *
 * Zwei Sonderfaelle, die sonst falsche Kerne erzeugen wuerden:
 *   - nach `q` ist das `u` kein eigener Kern ("Quelle" hat e, e, nicht u, e, e);
 *   - `y` vor einem Vokal ist ein Mitlaut ("Yacht" hat a, nicht i, a).
 */
const kerne = (wort) => {
  const w = normalisieren(wort);
  const gefunden = [];
  let i = 0;

  while (i < w.length) {
    if (!VOKALE.includes(w[i])) { i += 1; continue; }

    // Das u in qu gehoert zum Mitlaut und traegt keinen eigenen Kern.
    if (w[i] === 'u' && i > 0 && w[i - 1] === 'q') { i += 1; continue; }
    // y vor einem Vokal ist selbst Mitlaut.
    if (w[i] === 'y' && VOKALE.includes(w[i + 1] || '')) { i += 1; continue; }

    let treffer = null;
    for (const [gruppe, laut] of GRUPPEN) {
      if (w.startsWith(gruppe, i)) { treffer = [gruppe, laut]; break; }
    }
    if (!treffer) { i += 1; continue; }

    gefunden.push(treffer[1]);
    i += treffer[0].length;
  }

  return gefunden;
};

/**
 * Einen Text in Woerter mit ihren Silbenkernen zerlegen. Woerter ohne Kern
 * (etwa "&" oder eine Zahl) fallen raus, damit sie die Kette nicht zerreissen.
 */
const woerter = (text) => String(text == null ? '' : text)
  .split(/\s+/)
  .map((roh) => ({ roh, schluessel: normalisieren(roh), silben: kerne(roh) }))
  .filter((w) => w.silben.length > 0);

/**
 * Durchlaufende Silbenkette eines Eintrags, ueber Wortgrenzen hinweg. Genau
 * darauf rechnen Suche, Vergleich und Zaehlung: eine Wortfolge ist nichts
 * anderes als ein Stueck dieser Kette.
 */
const kette = (text) => {
  const liste = [];
  woerter(text).forEach((w, wortIndex) => {
    w.silben.forEach((kern, silbeIndex) => {
      liste.push({
        kern,
        wortIndex,
        silbeIndex,
        wort: w.roh,
        schluessel: w.schluessel,
        wortAnfang: silbeIndex === 0
      });
    });
  });
  return liste;
};

export { LAUTE, GRUPPEN, normalisieren, kerne, woerter, kette };
