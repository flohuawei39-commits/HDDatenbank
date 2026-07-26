/* Ablage im privaten GitHub-Repo.

   Geschrieben wird ueber die Git-Data-Routen (blob, tree, commit, ref) statt
   ueber die bequemere Contents-Route. Zwei Gruende:

   1. Alle geaenderten Dateien landen in EINEM Commit. Ueber die Contents-Route
      waere jede Datei ein eigener Commit, und ein Abbruch mittendrin liesse
      einen halben Stand zurueck.
   2. Das Aktualisieren der Referenz ohne `force` scheitert, wenn der Kopf
      inzwischen woanders steht. Das ist die Konflikterkennung, ohne dass wir
      dafuer etwas erfinden muessten.

   Die Contents-Route liefert Inhalte ausserdem nur bis etwa 1 MB direkt mit;
   ueber die Blob-Route gibt es diese Grenze nicht.                          */

const WURZEL = 'https://api.github.com';

class GitHubFehler extends Error {
  constructor(nachricht, status, kennung) {
    super(nachricht);
    this.status = status;
    this.kennung = kennung;   // 'konflikt' | 'kein-zugriff' | 'leer' | null
  }
}

const ruf = async (token, pfad, optionen = {}) => {
  const antwort = await fetch(`${WURZEL}${pfad}`, {
    ...optionen,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${token}`,
      ...(optionen.body ? { 'Content-Type': 'application/json' } : {}),
      ...(optionen.headers || {})
    }
  });

  if (antwort.status === 204) return null;
  const daten = await antwort.json().catch(() => ({}));

  if (!antwort.ok) {
    if (antwort.status === 401 || antwort.status === 403) {
      throw new GitHubFehler('Der Zugriffsschlüssel wird abgelehnt. Ist er abgelaufen oder fehlen ihm Rechte?', antwort.status, 'kein-zugriff');
    }
    if (antwort.status === 404) {
      throw new GitHubFehler('Repository oder Datei nicht gefunden.', 404, 'leer');
    }
    if (antwort.status === 409) {
      // GitHub meldet so ein Repo ohne einen einzigen Commit.
      throw new GitHubFehler('Das Repository ist noch leer.', 409, 'leer');
    }
    if (antwort.status === 422) {
      throw new GitHubFehler('Auf einem anderen Gerät wurde inzwischen gespeichert.', 422, 'konflikt');
    }
    throw new GitHubFehler(daten.message || `GitHub antwortete mit ${antwort.status}`, antwort.status, null);
  }
  return daten;
};

const kodierer = new TextEncoder();
const dekodierer = new TextDecoder();

const zuBase64 = (text) => {
  const bytes = kodierer.encode(text);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const ausBase64 = (b64) => {
  const roh = atob(String(b64).replace(/\s/g, ''));
  const bytes = new Uint8Array(roh.length);
  for (let i = 0; i < roh.length; i += 1) bytes[i] = roh.charCodeAt(i);
  return dekodierer.decode(bytes);
};

// ---------------------------------------------------------------- Verbindung

/** Prueft Schluessel und Repo in einem Zug, bevor irgendetwas geschrieben wird. */
const pruefen = async ({ token, besitzer, repo }) => {
  const daten = await ruf(token, `/repos/${besitzer}/${repo}`);
  return {
    ok: true,
    privat: daten.private,
    zweig: daten.default_branch || 'main',
    // Ein oeffentliches Datenrepo waere ein Unfall und soll auffallen.
    warnung: daten.private ? null : 'Achtung: Dieses Repository ist öffentlich. Daten gehören in ein privates.'
  };
};

// ---------------------------------------------------------------- Lesen

/**
 * Alle Dateien des aktuellen Standes holen.
 * Gibt zusaetzlich den Kopf-SHA zurueck; der wird beim Speichern als Elternteil
 * gebraucht und entscheidet, ob inzwischen jemand anderes geschrieben hat.
 */
const laden = async ({ token, besitzer, repo, zweig = 'main' }) => {
  let ref;
  try {
    ref = await ruf(token, `/repos/${besitzer}/${repo}/git/ref/heads/${zweig}`);
  } catch (fehler) {
    if (fehler.kennung === 'leer') return { kopfSha: null, dateien: {}, leer: true };
    throw fehler;
  }

  const kopfSha = ref.object.sha;
  const commit = await ruf(token, `/repos/${besitzer}/${repo}/git/commits/${kopfSha}`);
  const baum = await ruf(token, `/repos/${besitzer}/${repo}/git/trees/${commit.tree.sha}?recursive=1`);

  const dateien = {};
  for (const eintrag of baum.tree || []) {
    if (eintrag.type !== 'blob') continue;
    const blob = await ruf(token, `/repos/${besitzer}/${repo}/git/blobs/${eintrag.sha}`);
    dateien[eintrag.path] = blob.encoding === 'base64' ? ausBase64(blob.content) : blob.content;
  }
  return { kopfSha, dateien, leer: false };
};

// ---------------------------------------------------------------- Schreiben

/**
 * Alle uebergebenen Dateien in einem Commit ablegen.
 * `elternSha` ist der Stand, auf dem gearbeitet wurde. Steht der Kopf inzwischen
 * woanders, schlaegt der letzte Schritt mit `konflikt` fehl und es wurde nichts
 * ueberschrieben — die losen Blobs bleiben unreferenziert liegen und werden von
 * GitHub selbst aufgeraeumt.
 */
/**
 * Den allerersten Commit anlegen.
 *
 * Noetig, weil GitHub die Git-Data-Routen in einem Repo ohne einen einzigen
 * Commit rundweg ablehnt: schon das Anlegen eines Blobs antwortet mit
 * "409 Git Repository is empty." Die Contents-Route darf das dagegen und legt
 * den Zweig gleich mit an. Danach greift der normale Weg.
 */
const ersterCommit = async ({ token, besitzer, repo, zweig, nachricht }) => {
  const antwort = await ruf(token, `/repos/${besitzer}/${repo}/contents/.hddatenbank`, {
    method: 'PUT',
    body: JSON.stringify({
      message: nachricht || 'HDDatenbank eingerichtet',
      content: zuBase64('Verschluesselter Datenbestand von HDDatenbank.\nNicht von Hand bearbeiten.\n'),
      branch: zweig
    })
  });
  return antwort.commit.sha;
};

const speichern = async ({ token, besitzer, repo, zweig = 'main', dateien, elternSha, nachricht }) => {
  const basis = `/repos/${besitzer}/${repo}/git`;

  // Leeres Repo zuerst bewohnbar machen.
  let eltern = elternSha;
  if (!eltern) eltern = await ersterCommit({ token, besitzer, repo, zweig, nachricht });

  const eintraege = [];
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    const blob = await ruf(token, `${basis}/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: zuBase64(inhalt), encoding: 'base64' })
    });
    eintraege.push({ path: pfad, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const elternCommit = await ruf(token, `${basis}/commits/${eltern}`);
  const baum = await ruf(token, `${basis}/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: elternCommit.tree.sha, tree: eintraege })
  });

  const commit = await ruf(token, `${basis}/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: nachricht || 'HDDatenbank', tree: baum.sha, parents: [eltern] })
  });

  // force bleibt aus: genau daran scheitert ein veralteter Stand, und genau das
  // ist die Konflikterkennung.
  await ruf(token, `${basis}/refs/heads/${zweig}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: commit.sha, force: false })
  });

  return { kopfSha: commit.sha };
};

export { GitHubFehler, pruefen, laden, speichern, zuBase64, ausBase64 };
