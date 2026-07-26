/* Abgleich zwischen Speicherabbild, lokalem Spiegel und GitHub.

   Die Reihenfolge ist immer dieselbe:
     store (Klartext im Speicher)  →  krypto  →  spiegel + GitHub

   Der Klartext verlaesst diese Datei nie. Alles, was abgelegt wird, ist
   bereits verschluesselt.

   Konflikte werden erkannt, nicht geloest: liegt bei GitHub ein neuerer Stand,
   meldet `abgleichen` das zurueck und ueberschreibt nichts. Automatisches
   Zusammenfuehren waere bei widersprechenden Eintraegen zuverlaessig falsch,
   deshalb entscheidet der Mensch.                                           */

import * as store from './store.js';
import * as krypto from './krypto.js';
import * as github from './github.js';
import * as spiegel from './spiegel.js';

const META = 'meta.json';
const endung = (datei) => `${datei}.enc`;

const zustand = {
  schluessel: null,       // abgeleiteter Krypto-Schluessel, nur im Speicher
  salz: null,
  ablage: null,           // { token, besitzer, repo, zweig } oder null
  kopfSha: null,
  schmutzig: false,
  letzterFehler: null
};

// Verzoegertes Wegschreiben: mehrere Aenderungen kurz hintereinander ergeben
// einen Commit statt fuenf.
let stift = null;
const WARTEN_MS = 2500;
let beiAenderungGemeldet = null;
let beiKonfliktGemeldet = null;

const anmelden = (fn) => { beiAenderungGemeldet = fn; };
const beiKonflikt = (fn) => { beiKonfliktGemeldet = fn; };

store.beiAenderungSetzen(() => {
  zustand.schmutzig = true;
  if (beiAenderungGemeldet) beiAenderungGemeldet(zustand);
  clearTimeout(stift);
  stift = setTimeout(() => { sichern().catch(() => {}); }, WARTEN_MS);
});

const hatFernablage = () => Boolean(zustand.ablage && zustand.ablage.token);

// ---------------------------------------------------------------- Ver- und Entschluesseln

const verschluesselnAlle = async () => {
  const klar = store.alles();
  const raus = {};
  for (const [datei, wert] of Object.entries(klar)) {
    raus[endung(datei)] = await krypto.verschluesseln(zustand.schluessel, wert);
  }
  raus[META] = JSON.stringify({ salz: zustand.salz, runden: krypto.RUNDEN, format: 1 }, null, 2);
  return raus;
};

const entschluesselnAlle = async (dateien) => {
  const klar = {};
  for (const datei of store.DATEIEN) {
    const geheim = dateien[endung(datei)];
    if (!geheim) continue;
    klar[datei] = await krypto.entschluesseln(zustand.schluessel, geheim);
  }
  return klar;
};

// ---------------------------------------------------------------- Start

/**
 * Anmelden und den Bestand herstellen.
 * Zuerst der lokale Spiegel, damit die Oberflaeche sofort steht; danach, wenn
 * eine Fernablage eingerichtet ist, der Abgleich mit GitHub.
 */
const starten = async ({ passwort, ablage }) => {
  zustand.ablage = ablage && ablage.token ? ablage : null;

  const pruefung = krypto.passwortPruefen(passwort, hatFernablage());
  if (!pruefung.ok) return { ok: false, fehler: pruefung.fehler };

  const gespiegelt = await spiegel.standHolen();
  let salz = gespiegelt.salz;

  // Salz aus der Fernablage hat Vorrang: sonst passt der Schluessel nicht zu
  // dem, was dort liegt.
  let fern = null;
  if (hatFernablage()) {
    try {
      fern = await github.laden(zustand.ablage);
      if (fern.dateien[META]) salz = JSON.parse(fern.dateien[META]).salz;
    } catch (fehler) {
      if (fehler.kennung === 'kein-zugriff') return { ok: false, fehler: fehler.message };
      zustand.letzterFehler = fehler.message;   // offline ist kein Abbruchgrund
    }
  }

  const ersteEinrichtung = !salz;
  if (ersteEinrichtung) salz = krypto.neuesSalz();
  zustand.salz = salz;
  zustand.schluessel = await krypto.schluesselAbleiten(passwort, salz);

  // Fern gewinnt, wenn lokal nichts Ungesichertes liegt.
  const quelle = (fern && !fern.leer && !gespiegelt.schmutzig) ? fern.dateien : gespiegelt.dateien;
  zustand.kopfSha = fern && !fern.leer ? fern.kopfSha : gespiegelt.kopfSha;

  if (Object.keys(quelle).length) {
    const klar = await entschluesselnAlle(quelle);   // wirft bei falschem Passwort
    store.laden(klar);
  } else {
    store.laden({});
  }

  zustand.schmutzig = Boolean(gespiegelt.schmutzig);
  await spiegelSchreiben(quelle);

  return {
    ok: true,
    ersteEinrichtung,
    offline: Boolean(zustand.letzterFehler),
    ungesichert: zustand.schmutzig,
    hinweis: zustand.letzterFehler
  };
};

const spiegelSchreiben = (dateien) => spiegel.standSetzen({
  dateien,
  kopfSha: zustand.kopfSha,
  schmutzig: zustand.schmutzig,
  salz: zustand.salz
});

// ---------------------------------------------------------------- Sichern

/**
 * Aktuellen Stand ablegen: immer lokal, zusaetzlich bei GitHub, falls
 * eingerichtet und erreichbar.
 */
const sichern = async (nachricht = 'Stand aktualisiert') => {
  if (!zustand.schluessel) return { ok: false, fehler: 'Nicht angemeldet.' };

  const dateien = await verschluesselnAlle();

  if (!hatFernablage()) {
    // Ohne Fernablage ist der lokale Spiegel der Bestand, nicht nur ein Abbild.
    zustand.schmutzig = false;
    await spiegelSchreiben(dateien);
    if (beiAenderungGemeldet) beiAenderungGemeldet(zustand);
    return { ok: true, nurLokal: true };
  }

  // Erst lokal festhalten: bricht der Weg zu GitHub ab, ist nichts verloren.
  await spiegelSchreiben(dateien);

  try {
    const { kopfSha } = await github.speichern({
      ...zustand.ablage,
      dateien,
      elternSha: zustand.kopfSha,
      nachricht
    });
    zustand.kopfSha = kopfSha;
    zustand.schmutzig = false;
    zustand.letzterFehler = null;
    await spiegelSchreiben(dateien);
    if (beiAenderungGemeldet) beiAenderungGemeldet(zustand);
    return { ok: true, kopfSha };
  } catch (fehler) {
    zustand.letzterFehler = fehler.message;
    if (beiAenderungGemeldet) beiAenderungGemeldet(zustand);
    // Konflikt und Netzausfall bleiben unterscheidbar: beim Konflikt liegt
    // drueben ein echter neuerer Stand, offline liegt gar nichts vor.
    const konflikt = fehler.kennung === 'konflikt';
    // Beim verzoegerten Sichern hoert niemand auf den Rueckgabewert, deshalb melden.
    if (konflikt && beiKonfliktGemeldet) beiKonfliktGemeldet();
    return { ok: false, konflikt, fehler: fehler.message };
  }
};

// ---------------------------------------------------------------- Konflikt

/**
 * Bei einem Konflikt beide Staende zum Vergleich holen. Es wird nichts
 * geaendert; die Entscheidung faellt in der Oberflaeche.
 */
const konfliktStaende = async () => {
  const fern = await github.laden(zustand.ablage);
  const fernKlar = await entschluesselnAlle(fern.dateien);
  const zaehlen = (d) => ({
    eintraege: (d['entries.json']?.entries || []).length,
    aufgaben: (d['tasks.json']?.tasks || []).length,
    gemeinden: (d['gemeinden.json']?.gemeinden || []).length,
    buchungen: (d['finanzen.json']?.buchungen || []).length
  });
  return { meiner: zaehlen(store.alles()), fern: zaehlen(fernKlar), fernKopfSha: fern.kopfSha, fernKlar };
};

/** Den eigenen Stand durchsetzen: auf dem fremden Kopf aufsetzen und schreiben. */
const meinenBehalten = async (fernKopfSha) => {
  zustand.kopfSha = fernKopfSha;
  return sichern('Stand von diesem Gerät übernommen');
};

/** Den fremden Stand uebernehmen und die eigenen Aenderungen verwerfen. */
const fernenUebernehmen = async ({ fernKlar, fernKopfSha }) => {
  store.laden(fernKlar);
  zustand.kopfSha = fernKopfSha;
  zustand.schmutzig = false;
  await spiegelSchreiben(await verschluesselnAlle());
  return { ok: true };
};

// ---------------------------------------------------------------- Sicherung

/** Den gesamten Bestand ersetzen, etwa aus einer Sicherungsdatei. */
const bestandErsetzen = async (dateien) => {
  const sauber = {};
  for (const datei of store.DATEIEN) {
    if (dateien[datei] && typeof dateien[datei] === 'object') sauber[datei] = dateien[datei];
  }
  store.laden(sauber);
  zustand.schmutzig = true;
  return sichern('Bestand aus Sicherung eingelesen');
};

// ---------------------------------------------------------------- Passwort

/** Passwort wechseln: neues Salz, alles neu verschluesseln, einmal ablegen. */
const passwortWechseln = async (neu) => {
  const pruefung = krypto.passwortPruefen(neu, hatFernablage());
  if (!pruefung.ok) return { ok: false, fehler: pruefung.fehler };
  zustand.salz = krypto.neuesSalz();
  zustand.schluessel = await krypto.schluesselAbleiten(neu, zustand.salz);
  return sichern('Passwort gewechselt');
};

const abmelden = async () => {
  clearTimeout(stift);
  zustand.schluessel = null;
  zustand.salz = null;
};

export {
  zustand, starten, sichern, anmelden, beiKonflikt, hatFernablage, bestandErsetzen,
  konfliktStaende, meinenBehalten, fernenUebernehmen, passwortWechseln, abmelden
};
