/* Tagesmail ohne offene Seite.

   Bisher entschied zwar mail.js, WANN etwas ansteht, abgeschickt wurde es aber
   vom Browser — ohne geoeffnetes Dashboard kam nichts. Dieses Skript laeuft
   stattdessen zeitgesteuert bei GitHub Actions: es holt den verschluesselten
   Stand aus dem Datenrepo, entschluesselt ihn im Arbeitsspeicher, baut mit
   derselben mail.js dieselbe Nachricht und schickt sie ueber Web3Forms.

   Der Klartext wird nirgends abgelegt. Zurueck ins Repo geht nur das Datum des
   Versands in config.json — sonst schickt das naechste geoeffnete Dashboard
   dieselbe Mail ein zweites Mal.

   Zugangsdaten kommen ausschliesslich aus der Umgebung (GitHub-Secrets):
     HDD_DATEN_TOKEN   Zugriffsschluessel fuer das private Datenrepo
     HDD_PASSWORT      Passwort, mit dem der Bestand verschluesselt ist
     HDD_DATEN_REPO    "besitzer/repo" des Datenrepos
     HDD_DATEN_ZWEIG   optional, Vorgabe "main"                              */

import * as github from '../lib/github.js';
import * as krypto from '../lib/krypto.js';
import * as store from '../lib/store.js';
import * as mail from '../lib/mail.js';

const META = 'meta.json';
const endung = (datei) => `${datei}.enc`;

const umgebung = (name, pflicht = true) => {
  const wert = (process.env[name] || '').trim();
  if (!wert && pflicht) {
    console.error(`Fehlt: ${name}. Als GitHub-Secret hinterlegen.`);
    process.exit(1);
  }
  return wert || null;
};

/* Das Passwort wird bewusst NICHT beschnitten, sondern in beiden Fassungen
   probiert. Beim Einfuegen in die Secret-Maske haengt schnell ein Zeilenumbruch
   dran; genauso gut kann ein Passwort aber echt auf ein Leerzeichen enden. Nur
   eine der beiden Fassungen zu nehmen, hiesse den jeweils anderen Fall
   stillschweigend als "falsches Passwort" auszugeben. */
const passwortFassungen = () => {
  const roh = process.env.HDD_PASSWORT || '';
  return [...new Set([roh, roh.trim(), roh.replace(/[\r\n]+$/, '')])].filter(Boolean);
};

/** Mit einer Passwortfassung alles entschluesseln. `null`, wenn sie nicht passt. */
const entschluesselnMit = async (passwort, meta, dateien) => {
  const schluessel = await krypto.schluesselAbleiten(passwort, meta.salz, meta.runden || krypto.RUNDEN);
  const klar = {};
  try {
    for (const datei of store.DATEIEN) {
      const geheim = dateien[endung(datei)];
      if (geheim) klar[datei] = await krypto.entschluesseln(schluessel, geheim);
    }
  } catch {
    return null;
  }
  return { klar, schluessel };
};

const web3FormsSenden = async ({ schluessel, empfaenger, betreff, text }) => {
  const koerper = { access_key: schluessel, subject: betreff, from_name: 'HDDatenbank', message: text };
  if (empfaenger) koerper.email = empfaenger;
  const antwort = await fetch('https://api.web3forms.com/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(koerper)
  });
  const ergebnis = await antwort.json().catch(() => ({}));
  if (!antwort.ok || ergebnis.success === false) {
    throw new Error(ergebnis.message || `Web3Forms antwortete mit ${antwort.status}`);
  }
};

const lauf = async () => {
  const token = umgebung('HDD_DATEN_TOKEN');
  umgebung('HDD_PASSWORT');
  const [besitzer, repo] = umgebung('HDD_DATEN_REPO').split('/');
  const zweig = umgebung('HDD_DATEN_ZWEIG', false) || 'main';
  if (!besitzer || !repo) {
    console.error('HDD_DATEN_REPO muss die Form "besitzer/repo" haben.');
    process.exit(1);
  }

  const ablage = { token, besitzer, repo, zweig };
  const fern = await github.laden(ablage);
  if (fern.leer || !fern.dateien[META]) {
    console.log('Im Datenrepo liegt noch nichts. Nichts zu tun.');
    return;
  }

  const meta = JSON.parse(fern.dateien[META]);

  let geoeffnet = null;
  for (const fassung of passwortFassungen()) {
    geoeffnet = await entschluesselnMit(fassung, meta, fern.dateien);
    if (geoeffnet) break;
  }
  if (!geoeffnet) {
    console.error('Der Bestand lässt sich mit HDD_PASSWORT nicht entschlüsseln.');
    console.error('Erwartet wird das Anmeldepasswort der HDDatenbank — nicht der');
    console.error('Verzeichnisschutz von Hostinger und nicht der Zugriffsschlüssel.');
    // Keine Angaben zum Wert, auch keine Laenge: dieses Repo ist oeffentlich,
    // und damit sind es die Protokolle hier auch.
    process.exit(1);
  }

  const { klar, schluessel } = geoeffnet;
  store.laden(klar);

  const config = store.read('config.json');
  const m = config.mail || {};
  const heute = store.heute();

  if (!m.aktiv) return console.log('Tagesmail ist in den Einstellungen ausgeschaltet.');
  if (!m.schluessel) return console.log('Kein Web3Forms-Schlüssel hinterlegt.');
  if (m.letzterVersand === heute) return console.log(`Für ${heute} wurde bereits verschickt.`);

  /* Der Zeitplan bei GitHub laeuft in UTC und kennt keine Sommerzeit. Deshalb
     wird mehrmals am Tag nachgesehen und hier gegen die eingestellte Uhrzeit
     geprueft — mit TZ=Europe/Berlin ist das die Uhrzeit, die auch im Dashboard
     steht. Ist der Tag einmal vermerkt, laufen die restlichen Termine leer. */
  const jetzt = new Date();
  const uhr = `${String(jetzt.getHours()).padStart(2, '0')}:${String(jetzt.getMinutes()).padStart(2, '0')}`;
  if (uhr < (m.uhrzeit || '07:00')) return console.log(`Noch zu früh (${uhr} vor ${m.uhrzeit || '07:00'}).`);

  const nachricht = mail.bauen({ ...klar['entries.json'], tasks: klar['tasks.json']?.tasks || [], gemeinden: klar['gemeinden.json']?.gemeinden || [] }, heute);
  if (nachricht.leer) {
    console.log('Für heute steht nichts an.');
  } else {
    await web3FormsSenden({ schluessel: m.schluessel, empfaenger: m.empfaenger, betreff: nachricht.betreff, text: nachricht.text });
    console.log(`Verschickt: ${nachricht.betreff}`);
  }

  /* Auch ein leerer Tag wird vermerkt, sonst prueft das Dashboard den ganzen Tag
     weiter. Nur config.json geht zurueck — die uebrigen Dateien bleiben durch
     base_tree unangetastet. Schreibt gerade ein Geraet, scheitert das ohne
     Schaden; die Mail ist dann trotzdem raus. */
  const neu = { ...config, mail: { ...m, letzterVersand: heute, letzterFehler: null } };
  try {
    await github.speichern({
      ...ablage,
      dateien: { [endung('config.json')]: await krypto.verschluesseln(schluessel, neu) },
      elternSha: fern.kopfSha,
      nachricht: `Tagesmail ${heute} vermerkt`
    });
  } catch (fehler) {
    console.log(`Vermerk nicht abgelegt (${fehler.message}). Die Mail ist verschickt.`);
  }
};

lauf().catch((fehler) => {
  console.error(fehler.message);
  process.exit(1);
});
