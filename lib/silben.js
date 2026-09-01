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
     aeu -> eu,  ai und ay -> ei,  y -> i
     Doppelvokale und Dehnungs-h fallen auf den Grundvokal zusammen.
     `ie` steht fuer sich und wird NICHT zu i: das lange ie klingt anders, und
     wer beides gleich behandeln will, merkt an der Silbe zusaetzlich i an.
     Das geschriebene `ih` bleibt beim i — hier zaehlt die Schreibweise.       */

/** Die dreizehn Laute, mit denen ueberall gerechnet wird. */
const LAUTE = ['a', 'e', 'i', 'o', 'u', 'ä', 'ö', 'ü', 'au', 'eu', 'ei', 'ie', 'ey'];

/* Von lang nach kurz geprueft: die erste passende Gruppe gewinnt. Deshalb steht
   "äu" vor "ä" und "ie" vor "i" — umgekehrt wuerde jede Doppelform zerfallen. */
const GRUPPEN = [
  ['äu', 'eu'], ['eu', 'eu'], ['au', 'au'],
  ['ei', 'ei'], ['ai', 'ei'], ['ay', 'ei'], ['ey', 'ey'],
  ['ieh', 'ie'], ['ie', 'ie'],
  ['aa', 'a'], ['ee', 'e'], ['oo', 'o'],
  ['ah', 'a'], ['äh', 'ä'], ['eh', 'e'], ['ih', 'i'], ['oh', 'o'], ['uh', 'u'],
  ['öh', 'ö'], ['üh', 'ü'],
  ['a', 'a'], ['e', 'e'], ['i', 'i'], ['o', 'o'], ['u', 'u'],
  ['ä', 'ä'], ['ö', 'ö'], ['ü', 'ü'],
  ['y', 'i']
];

const VOKALE = 'aeiouäöüy';

/**
 * Buchstaben eines Wortes, kleingeschrieben und ohne Beiwerk, dazu fuer jeden
 * Buchstaben die Stelle, an der er im geschriebenen Wort steht.
 *
 * Die Stellen braucht die Klammerrechnung: `(nur so)` faerbt die Silben darin
 * als nicht zaehlend ein, und dafuer muss jeder Kern wissen, wo er herkommt.
 * `ß` wird zu zwei s, beide zeigen auf dasselbe Zeichen.
 */
const buchstaben = (wort) => {
  const roh = String(wort == null ? '' : wort);
  const zeichen = [];
  const stellen = [];
  for (let i = 0; i < roh.length; i += 1) {
    const c = roh[i].toLowerCase();
    if (c === 'ß') { zeichen.push('s', 's'); stellen.push(i, i); continue; }
    if (/[a-zäöü]/.test(c)) { zeichen.push(c); stellen.push(i); }
  }
  return { wort: zeichen.join(''), stellen };
};

/** Kleinschreiben und alles wegnehmen, was kein Buchstabe ist. */
const normalisieren = (wort) => buchstaben(wort).wort;

/**
 * Silbenkerne eines einzelnen Wortes.
 *
 * Zwei Sonderfaelle, die sonst falsche Kerne erzeugen wuerden:
 *   - nach `q` ist das `u` kein eigener Kern ("Quelle" hat e, e, nicht u, e, e);
 *   - `y` vor einem Vokal ist ein Mitlaut ("Yacht" hat a, nicht i, a).
 */
const kerneStellen = (wort) => {
  const { wort: w, stellen } = buchstaben(wort);
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

    gefunden.push({ kern: treffer[1], stelle: stellen[i] });
    i += treffer[0].length;
  }

  return gefunden;
};

/** Nur die Kerne, ohne ihre Stellen — die haeufigere der beiden Fragen. */
const kerne = (wort) => kerneStellen(wort).map((k) => k.kern);

/**
 * Klammertiefe je Zeichen eines Textes. Die Klammern selbst zaehlen mit zum
 * Inneren, damit `(so)` vollstaendig als eingeklammert gilt.
 */
const klammertiefe = (text) => {
  const roh = String(text == null ? '' : text);
  const tiefen = [];
  let tiefe = 0;
  for (const c of roh) {
    if (c === '(') { tiefe += 1; tiefen.push(tiefe); continue; }
    if (c === ')') { tiefen.push(tiefe); tiefe = Math.max(0, tiefe - 1); continue; }
    tiefen.push(tiefe);
  }
  return tiefen;
};

/**
 * Einen Text in Woerter mit ihren Silbenkernen zerlegen. Woerter ohne Kern
 * (etwa "&" oder eine Zahl) fallen raus, damit sie die Kette nicht zerreissen.
 *
 * Jede Silbe weiss, ob sie in Klammern steht. Was in Klammern steht, gehoert
 * zur Aussage, aber nicht zur Zaehlung — entschieden wird das erst in reime.js,
 * hier wird nur festgehalten, was dasteht.
 */
const woerter = (text) => {
  const roh = String(text == null ? '' : text);
  const tiefen = klammertiefe(roh);
  const liste = [];
  const muster = /\S+/g;
  let treffer = muster.exec(roh);
  while (treffer) {
    const gefunden = kerneStellen(treffer[0]);
    if (gefunden.length) {
      liste.push({
        roh: treffer[0],
        schluessel: normalisieren(treffer[0]),
        silben: gefunden.map((k) => ({
          kern: k.kern,
          klammer: (tiefen[treffer.index + k.stelle] || 0) > 0
        }))
      });
    }
    treffer = muster.exec(roh);
  }
  return liste;
};

/**
 * Durchlaufende Silbenkette eines Eintrags, ueber Wortgrenzen hinweg. Genau
 * darauf rechnen Suche, Vergleich und Zaehlung: eine Wortfolge ist nichts
 * anderes als ein Stueck dieser Kette.
 */
const kette = (text) => {
  const liste = [];
  woerter(text).forEach((w, wortIndex) => {
    w.silben.forEach((silbe, silbeIndex) => {
      liste.push({
        kern: silbe.kern,
        klammer: silbe.klammer,
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

export { LAUTE, GRUPPEN, buchstaben, normalisieren, kerne, kerneStellen, klammertiefe, woerter, kette };
