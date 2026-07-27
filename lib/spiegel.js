/* Lokaler Spiegel des Datenbestands.

   Zweck: die App startet sofort mit dem letzten bekannten Stand, statt auf
   GitHub zu warten, und sie bleibt ohne Netz benutzbar.

   Bewusst IndexedDB statt localStorage: der ausgelesene Text von Gemeinde-
   Dokumenten waechst, und die rund 5 MB von localStorage waeren eine
   Zeitbombe, die erst nach Monaten zuschlaegt.

   Gespeichert wird das VERSCHLUESSELTE Kauderwelsch, nicht der Klartext. Sonst
   laege der ganze Bestand offen im Browserprofil, waehrend er bei GitHub
   verschluesselt ist — das waere die Tuer neben dem verriegelten Tor.

   Unter Node (Selbsttest) gibt es keine IndexedDB; dort haelt ein einfaches
   Speicherabbild her. Die Schnittstelle ist in beiden Faellen dieselbe.      */

const DB_NAME = 'hddatenbank';
const LADEN = 'stand';
const VERSION = 1;

const hatIndexedDB = typeof indexedDB !== 'undefined';

// --------------------------------------------------------------- IndexedDB

let dbCache = null;

const db = () => new Promise((gut, schlecht) => {
  if (dbCache) return gut(dbCache);
  const anfrage = indexedDB.open(DB_NAME, VERSION);
  anfrage.onupgradeneeded = () => {
    if (!anfrage.result.objectStoreNames.contains(LADEN)) anfrage.result.createObjectStore(LADEN);
  };
  anfrage.onsuccess = () => { dbCache = anfrage.result; gut(dbCache); };
  anfrage.onerror = () => schlecht(new Error('Der lokale Zwischenspeicher lässt sich nicht öffnen.'));
});

const imLaden = (modus, fn) => db().then((d) => new Promise((gut, schlecht) => {
  const t = d.transaction(LADEN, modus);
  const anfrage = fn(t.objectStore(LADEN));
  anfrage.onsuccess = () => gut(anfrage.result);
  anfrage.onerror = () => schlecht(new Error('Zugriff auf den lokalen Zwischenspeicher fehlgeschlagen.'));
}));

// --------------------------------------------------------------- Speicherabbild

const abbild = new Map();

// --------------------------------------------------------------- Schnittstelle

const holen = async (schluessel) => (hatIndexedDB
  ? imLaden('readonly', (s) => s.get(schluessel))
  : abbild.get(schluessel));

const setzen = async (schluessel, wert) => {
  if (!hatIndexedDB) { abbild.set(schluessel, wert); return wert; }
  await imLaden('readwrite', (s) => s.put(wert, schluessel));
  return wert;
};

const leeren = async () => {
  if (!hatIndexedDB) { abbild.clear(); return; }
  await imLaden('readwrite', (s) => s.clear());
};

/**
 * Der gespiegelte Stand: die verschluesselten Dateien, der Kopf-SHA, auf dem
 * sie beruhen, und ob seither lokal etwas geaendert wurde.
 */
const standHolen = async () => (await holen('stand')) || { dateien: {}, kopfSha: null, schmutzig: false, salz: null, zeit: null };

const standSetzen = (stand) => setzen('stand', stand);

export { standHolen, standSetzen, holen, setzen, leeren, hatIndexedDB };
