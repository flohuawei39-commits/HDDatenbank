'use strict';

const crypto = require('crypto');
const store = require('./store');

const COOKIE = 'hdd_session';
const TAG_MS = 86400000;
const DAUER_KURZ = 12 * 3600 * 1000;
const DAUER_LANG = 30 * TAG_MS;
const MAX_VERSUCHE = 5;
const SPERRE_MS = 60000;

// Nur im Speicher: nach einem Neustart darf man wieder tippen.
const versuche = { anzahl: 0, gesperrtBis: 0 };

const hashen = (pin, salt) => crypto.scryptSync(String(pin), salt, 64).toString('hex');

const eingerichtet = () => Boolean(store.read('config.json').pinHash);

const einrichten = (pin) => {
  if (!/^\d{4,12}$/.test(String(pin || ''))) {
    return { ok: false, fehler: 'Die PIN muss aus 4 bis 12 Ziffern bestehen.' };
  }
  const config = store.read('config.json');
  if (config.pinHash) return { ok: false, fehler: 'Es ist bereits eine PIN gesetzt.' };
  const salt = crypto.randomBytes(16).toString('hex');
  store.write('config.json', {
    ...config,
    pinSalt: salt,
    pinHash: hashen(pin, salt),
    eingerichtetAm: store.jetzt()
  });
  return { ok: true };
};

const pinAendern = (alt, neu) => {
  if (!pruefen(alt).ok) return { ok: false, fehler: 'Die alte PIN stimmt nicht.' };
  if (!/^\d{4,12}$/.test(String(neu || ''))) return { ok: false, fehler: 'Die neue PIN muss aus 4 bis 12 Ziffern bestehen.' };
  const config = store.read('config.json');
  const salt = crypto.randomBytes(16).toString('hex');
  store.write('config.json', { ...config, pinSalt: salt, pinHash: hashen(neu, salt) });
  return { ok: true };
};

const pruefen = (pin) => {
  const now = Date.now();
  if (versuche.gesperrtBis > now) {
    return { ok: false, fehler: `Zu viele Fehlversuche. Noch ${Math.ceil((versuche.gesperrtBis - now) / 1000)} Sekunden warten.` };
  }
  const config = store.read('config.json');
  if (!config.pinHash) return { ok: false, fehler: 'Es ist noch keine PIN eingerichtet.' };

  const kandidat = Buffer.from(hashen(pin, config.pinSalt), 'hex');
  const erwartet = Buffer.from(config.pinHash, 'hex');
  const stimmt = kandidat.length === erwartet.length && crypto.timingSafeEqual(kandidat, erwartet);

  if (!stimmt) {
    versuche.anzahl += 1;
    if (versuche.anzahl >= MAX_VERSUCHE) {
      versuche.anzahl = 0;
      versuche.gesperrtBis = now + SPERRE_MS;
      return { ok: false, fehler: 'Zu viele Fehlversuche. Eine Minute Pause.' };
    }
    return { ok: false, fehler: 'PIN stimmt nicht.' };
  }

  versuche.anzahl = 0;
  return { ok: true };
};

const sessionsLesen = () => {
  const daten = store.read('sessions.json');
  const gueltig = (daten.sessions || []).filter((s) => new Date(s.laeuftAb).getTime() > Date.now());
  if (gueltig.length !== (daten.sessions || []).length) store.write('sessions.json', { sessions: gueltig });
  return gueltig;
};

const anmelden = (merken) => {
  const token = crypto.randomBytes(32).toString('hex');
  const laeuftAb = new Date(Date.now() + (merken ? DAUER_LANG : DAUER_KURZ)).toISOString();
  store.write('sessions.json', { sessions: [...sessionsLesen(), { token, laeuftAb, erstellt: store.jetzt() }] });
  return { token, laeuftAb, maxAge: Math.floor((merken ? DAUER_LANG : DAUER_KURZ) / 1000) };
};

const sessionGueltig = (token) => Boolean(token) && sessionsLesen().some((s) => s.token === token);

const abmelden = (token) => {
  store.write('sessions.json', { sessions: sessionsLesen().filter((s) => s.token !== token) });
};

const tokenAusCookie = (header) => {
  const treffer = String(header || '').match(new RegExp(`${COOKIE}=([a-f0-9]+)`));
  return treffer ? treffer[1] : null;
};

module.exports = { COOKIE, eingerichtet, einrichten, pruefen, pinAendern, anmelden, abmelden, sessionGueltig, tokenAusCookie };
