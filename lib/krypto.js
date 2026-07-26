/* Verschluesselung der Daten, bevor sie das Geraet verlassen.

   Web Crypto, kein Fremdcode. Laeuft im Browser und unter Node ab Version 20
   identisch, weil beide `globalThis.crypto.subtle` mitbringen.

   Verfahren: PBKDF2-SHA256 leitet aus dem Passwort einen Schluessel ab, AES-GCM
   verschluesselt damit. AES-GCM ist bewusst gewaehlt, weil es nicht nur
   verschluesselt, sondern auch merkt, wenn jemand am Kauderwelsch gedreht hat:
   ein veraenderter Block entschluesselt nicht, statt stillschweigend Unsinn zu
   liefern. Das falsche Passwort scheitert aus demselben Grund sauber.

   Das Salz ist kein Geheimnis und liegt im Klartext in meta.json. Es sorgt nur
   dafuer, dass zwei gleiche Passwoerter nicht denselben Schluessel ergeben. */

const RUNDEN = 250000;
const SALZ_BYTES = 16;
const IV_BYTES = 12;      // Standardlaenge fuer AES-GCM

const subtle = () => {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('Dieser Browser kann keine Verschlüsselung. Bitte einen aktuellen Browser verwenden.');
  return c.subtle;
};

const zufall = (n) => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
};

const kodierer = new TextEncoder();
const dekodierer = new TextDecoder();

// --------------------------------------------------------------- Base64

const zuBase64 = (bytes) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const ausBase64 = (text) => {
  const roh = atob(text);
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i += 1) bytes[i] = roh.charCodeAt(i);
  return bytes;
};

// --------------------------------------------------------------- Schluessel

const neuesSalz = () => zuBase64(zufall(SALZ_BYTES));

/**
 * Schluessel aus Passwort und Salz ableiten. Das Ergebnis bleibt im
 * Arbeitsspeicher und wird nie abgelegt; `extractable` steht deshalb auf false.
 */
const schluesselAbleiten = async (passwort, salzBase64, runden = RUNDEN) => {
  const roh = await subtle().importKey('raw', kodierer.encode(passwort), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey(
    { name: 'PBKDF2', salt: ausBase64(salzBase64), iterations: runden, hash: 'SHA-256' },
    roh,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

// --------------------------------------------------------------- Ein Wert

/** Beliebiges JSON verschluesseln. Rueckgabe ist reiner Text, versandfertig. */
const verschluesseln = async (schluessel, wert) => {
  const iv = zufall(IV_BYTES);
  const klar = kodierer.encode(JSON.stringify(wert));
  const geheim = await subtle().encrypt({ name: 'AES-GCM', iv }, schluessel, klar);
  // IV vorne anhaengen: er ist kein Geheimnis, muss aber zum Entschluesseln dabei sein.
  const zusammen = new Uint8Array(iv.length + geheim.byteLength);
  zusammen.set(iv);
  zusammen.set(new Uint8Array(geheim), iv.length);
  return zuBase64(zusammen);
};

/** Zurueckverwandeln. Wirft, wenn das Passwort falsch ist oder jemand gedreht hat. */
const entschluesseln = async (schluessel, text) => {
  const zusammen = ausBase64(text);
  const iv = zusammen.slice(0, IV_BYTES);
  const geheim = zusammen.slice(IV_BYTES);
  let klar;
  try {
    klar = await subtle().decrypt({ name: 'AES-GCM', iv }, schluessel, geheim);
  } catch {
    // AES-GCM meldet Passwortfehler und Manipulation ununterscheidbar. Das ist
    // gewollt, hier wird daraus eine verstaendliche Meldung.
    throw new Error('Falsches Passwort, oder die Daten wurden verändert.');
  }
  return JSON.parse(dekodierer.decode(klar));
};

// --------------------------------------------------------------- Passwortregel

const MINDESTLAENGE_FERN = 12;

/**
 * Solange alles auf dem eigenen Rechner bleibt, ist jedes Passwort in Ordnung —
 * auch das Startpasswort HDD. Sobald ein Zugriffsschluessel hinterlegt ist,
 * verlassen die Daten das Geraet, und dann sind drei Zeichen keine
 * Verschluesselung mehr, sondern Zierde.
 */
const passwortPruefen = (passwort, mitFernablage) => {
  const p = String(passwort || '');
  if (!p) return { ok: false, fehler: 'Passwort fehlt.' };
  if (!mitFernablage) return { ok: true };
  if (p.length < MINDESTLAENGE_FERN) {
    return {
      ok: false,
      fehler: `Sobald die Daten zu GitHub gehen, sind mindestens ${MINDESTLAENGE_FERN} Zeichen nötig. `
        + 'Das Startpasswort reicht dafür nicht.'
    };
  }
  return { ok: true };
};

export {
  RUNDEN, MINDESTLAENGE_FERN,
  neuesSalz, schluesselAbleiten, verschluesseln, entschluesseln, passwortPruefen,
  zuBase64, ausBase64
};
