'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const store = require('./lib/store');
const auth = require('./lib/auth');
const D = require('./lib/datum');
const wdh = require('./lib/recurrence');
const { suche } = require('./lib/search');
const quick = require('./lib/quickparse');
const backup = require('./lib/backup');
const gemeindenModul = require('./lib/gemeinden');
const mail = require('./lib/mail');
const pdf = require('./lib/pdf');
const banken = require('./lib/banken');
const finanzen = require('./lib/finanzen');

const PORT = Number(process.env.PORT || 8790);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const CAN_KATEGORIE = 'kat_can';
const FRIST_FENSTER = 14;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const PRIO_RANG = { hoch: 0, mittel: 1, gering: 2 };
const PRIOS = ['gering', 'mittel', 'hoch'];
const STATI = ['offen', 'laeuft', 'erledigt'];

// ---------------------------------------------------------------- Hilfsfunktionen

const sendJSON = (res, code, daten, kopfzeilen = {}) => {
  res.writeHead(code, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store', ...kopfzeilen });
  res.end(JSON.stringify(daten));
};

const koerperLesen = (req, maxBytes = 1_000_000) => new Promise((auf, ab) => {
  let roh = '';
  req.on('data', (stueck) => {
    roh += stueck;
    if (roh.length > maxBytes) { ab(new Error('Anfrage zu groß')); req.destroy(); }
  });
  req.on('end', () => {
    if (!roh) return auf({});
    try { auf(JSON.parse(roh)); } catch { ab(new Error('Ungültiges JSON')); }
  });
  req.on('error', ab);
});

const rohLesen = (req, maxBytes) => new Promise((auf, ab) => {
  const stuecke = [];
  let groesse = 0;
  req.on('data', (stueck) => {
    groesse += stueck.length;
    if (groesse > maxBytes) { ab(new Error(`Datei größer als ${Math.round(maxBytes / 1048576)} MB`)); req.destroy(); return; }
    stuecke.push(stueck);
  });
  req.on('end', () => auf(Buffer.concat(stuecke)));
  req.on('error', ab);
});

const text = (wert, max = 2000) => String(wert == null ? '' : wert).trim().slice(0, max);

const datumOderNull = (wert) => (D.istISO(wert) ? wert : null);

const uhrzeitOderNull = (wert) => (/^\d{2}:\d{2}$/.test(String(wert || '')) ? wert : null);

const wiederholungPruefen = (wert) => {
  if (!wert || !wdh.TYPEN.includes(wert.typ)) return null;
  return {
    typ: wert.typ,
    intervall: Math.min(52, Math.max(1, Number(wert.intervall) || 1)),
    bis: datumOderNull(wert.bis)
  };
};

const daten = () => {
  const e = store.read('entries.json');
  const t = store.read('tasks.json');
  return {
    entries: Array.isArray(e.entries) ? e.entries : [],
    kategorien: Array.isArray(e.kategorien) ? e.kategorien : [],
    tasks: Array.isArray(t.tasks) ? t.tasks : []
  };
};

/** Alles, was die Tagesmail braucht. */
const bestand = () => ({ ...daten(), gemeinden: gemeindenModul.lesen() });

const entriesSchreiben = (entries, kategorien) => store.write('entries.json', { kategorien, entries });
const tasksSchreiben = (tasks) => store.write('tasks.json', { tasks });

/** Ein Vorkommen in die Form bringen, die die Oberfläche anzeigt. */
const alsVorkommen = (eintrag, vorkommenDaten, tag) => ({
  id: eintrag.id,
  datum: tag,
  start: vorkommenDaten.start,
  ende: vorkommenDaten.ende,
  mehrtaegig: vorkommenDaten.start !== vorkommenDaten.ende,
  ersterTag: tag === vorkommenDaten.start,
  letzterTag: tag === vorkommenDaten.ende,
  uhrzeit: eintrag.uhrzeit,
  text: eintrag.text,
  kategorie: eintrag.kategorie,
  prioritaet: eintrag.prioritaet,
  istFrist: Boolean(eintrag.istFrist),
  wiederkehrend: Boolean(eintrag.wiederholung),
  erledigt: erledigtAm(eintrag, vorkommenDaten.start)
});

const erledigtAm = (eintrag, start) => (eintrag.wiederholung
  ? (eintrag.erledigtAn || []).includes(start)
  : Boolean(eintrag.erledigt));

const nachTag = (entries, von, bis) => {
  const eimer = {};
  for (const eintrag of entries) {
    for (const v of wdh.vorkommen(eintrag, von, bis)) {
      for (const tag of v.tage) {
        if (tag < von || tag > bis) continue;
        (eimer[tag] = eimer[tag] || []).push(alsVorkommen(eintrag, v, tag));
      }
    }
  }
  for (const tag of Object.keys(eimer)) {
    eimer[tag].sort((a, b) => {
      if (a.istFrist !== b.istFrist) return a.istFrist ? -1 : 1;
      if (Boolean(a.uhrzeit) !== Boolean(b.uhrzeit)) return a.uhrzeit ? -1 : 1;
      if (a.uhrzeit && b.uhrzeit && a.uhrzeit !== b.uhrzeit) return a.uhrzeit < b.uhrzeit ? -1 : 1;
      return PRIO_RANG[a.prioritaet] - PRIO_RANG[b.prioritaet];
    });
  }
  return eimer;
};

// ---------------------------------------------------------------- API

const api = async (req, res, url, angemeldet) => {
  const pfad = url.pathname;

  if (pfad === '/api/status' && req.method === 'GET') {
    return sendJSON(res, 200, { eingerichtet: auth.eingerichtet(), angemeldet });
  }

  if (pfad === '/api/setup' && req.method === 'POST') {
    const koerper = await koerperLesen(req);
    const ergebnis = auth.einrichten(koerper.pin);
    if (!ergebnis.ok) return sendJSON(res, 400, ergebnis);
    const sitzung = auth.anmelden(true);
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': cookie(sitzung) });
  }

  if (pfad === '/api/login' && req.method === 'POST') {
    const koerper = await koerperLesen(req);
    const ergebnis = auth.pruefen(koerper.pin);
    if (!ergebnis.ok) return sendJSON(res, 401, ergebnis);
    const sitzung = auth.anmelden(Boolean(koerper.merken));
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': cookie(sitzung) });
  }

  if (pfad === '/api/logout' && req.method === 'POST') {
    auth.abmelden(auth.tokenAusCookie(req.headers.cookie));
    return sendJSON(res, 200, { ok: true }, { 'Set-Cookie': `${auth.COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` });
  }

  if (!angemeldet) return sendJSON(res, 401, { fehler: 'Nicht angemeldet.' });

  if (pfad === '/api/pin' && req.method === 'POST') {
    const koerper = await koerperLesen(req);
    const ergebnis = auth.pinAendern(koerper.alt, koerper.neu);
    return sendJSON(res, ergebnis.ok ? 200 : 400, ergebnis);
  }

  if (pfad === '/api/daten' && req.method === 'GET') {
    const d = daten();
    return sendJSON(res, 200, { ...d, heute: store.heute() });
  }

  if (pfad === '/api/monat' && req.method === 'GET') {
    const jahr = Number(url.searchParams.get('jahr'));
    const monat = Number(url.searchParams.get('monat'));
    if (!jahr || monat < 1 || monat > 12) return sendJSON(res, 400, { fehler: 'Jahr oder Monat fehlt.' });
    const gitter = D.monatsGitter(jahr, monat);
    const d = daten();
    const tage = nachTag(d.entries, gitter[0], gitter[gitter.length - 1]);
    const aufgaben = {};
    for (const t of d.tasks) {
      if (!t.faellig || t.status === 'erledigt') continue;
      if (t.faellig < gitter[0] || t.faellig > gitter[gitter.length - 1]) continue;
      (aufgaben[t.faellig] = aufgaben[t.faellig] || []).push({ id: t.id, titel: t.titel, prioritaet: t.prioritaet });
    }
    return sendJSON(res, 200, { jahr, monat, gitter, tage, aufgaben, heute: store.heute() });
  }

  if (pfad === '/api/start' && req.method === 'GET') {
    return sendJSON(res, 200, startDaten());
  }

  if (pfad === '/api/suche' && req.method === 'GET') {
    const q = url.searchParams.get('q') || '';
    const scope = url.searchParams.get('scope') || 'alle';
    return sendJSON(res, 200, suche(q, daten(), scope));
  }

  if (pfad === '/api/schnell' && req.method === 'POST') {
    const koerper = await koerperLesen(req);
    return sendJSON(res, 200, quick.parse(koerper.text, daten().kategorien, store.heute()));
  }

  if (pfad === '/api/eintrag' && req.method === 'POST') {
    const koerper = await koerperLesen(req);
    return sendJSON(res, 200, eintragSpeichern(koerper));
  }

  if (pfad === '/api/eintrag' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    const d = daten();
    const rest = d.entries.filter((e) => e.id !== id);
    if (rest.length === d.entries.length) return sendJSON(res, 404, { fehler: 'Eintrag nicht gefunden.' });
    entriesSchreiben(rest, d.kategorien);
    return sendJSON(res, 200, { ok: true });
  }

  if (pfad === '/api/eintrag/erledigt' && req.method === 'POST') {
    const koerper = await koerperLesen(req);
    return sendJSON(res, 200, erledigtSetzen(koerper));
  }

  if (pfad === '/api/aufgabe' && req.method === 'POST') {
    const koerper = await koerperLesen(req);
    return sendJSON(res, 200, aufgabeSpeichern(koerper));
  }

  if (pfad === '/api/aufgabe' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    const tasks = daten().tasks;
    const rest = tasks.filter((t) => t.id !== id);
    if (rest.length === tasks.length) return sendJSON(res, 404, { fehler: 'Aufgabe nicht gefunden.' });
    tasksSchreiben(rest);
    return sendJSON(res, 200, { ok: true });
  }

  // ---- Tierschutzzentrum -------------------------------------------------

  if (pfad === '/api/gemeinden' && req.method === 'GET') {
    return sendJSON(res, 200, { gemeinden: gemeindenModul.uebersicht(store.heute()), staende: store.STAENDE, heute: store.heute() });
  }

  if (pfad === '/api/gemeinde' && req.method === 'POST') {
    return sendJSON(res, 200, gemeindenModul.speichern(await koerperLesen(req)));
  }

  if (pfad === '/api/gemeinde' && req.method === 'DELETE') {
    const ergebnis = gemeindenModul.loeschen(url.searchParams.get('id'));
    return sendJSON(res, ergebnis.ok ? 200 : 409, ergebnis);
  }

  if (pfad === '/api/gemeinde/verlauf' && req.method === 'POST') {
    return sendJSON(res, 200, gemeindenModul.verlaufSpeichern(await koerperLesen(req)));
  }

  if (pfad === '/api/gemeinde/verlauf' && req.method === 'DELETE') {
    return sendJSON(res, 200, gemeindenModul.verlaufLoeschen(url.searchParams.get('gemeinde'), url.searchParams.get('id')));
  }

  if (pfad === '/api/gemeinde/frist' && req.method === 'POST') {
    return sendJSON(res, 200, gemeindenModul.fristSpeichern(await koerperLesen(req)));
  }

  if (pfad === '/api/gemeinde/frist' && req.method === 'DELETE') {
    return sendJSON(res, 200, gemeindenModul.fristLoeschen(url.searchParams.get('gemeinde'), url.searchParams.get('id')));
  }

  if (pfad === '/api/gemeinde/datei' && req.method === 'POST') {
    const puffer = await rohLesen(req, 25 * 1024 * 1024);
    const name = decodeURIComponent(url.searchParams.get('name') || 'datei');
    return sendJSON(res, 200, gemeindenModul.dateiAblegen(url.searchParams.get('gemeinde'), name, puffer));
  }

  if (pfad === '/api/gemeinde/datei' && req.method === 'GET') {
    const gefunden = gemeindenModul.dateiPfad(url.searchParams.get('gemeinde'), url.searchParams.get('id'));
    if (!gefunden) return sendJSON(res, 404, { fehler: 'Datei nicht gefunden.' });
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(gefunden.name)}`,
      'Cache-Control': 'no-store'
    });
    return res.end(fs.readFileSync(gefunden.pfad));
  }

  if (pfad === '/api/gemeinde/datei' && req.method === 'DELETE') {
    return sendJSON(res, 200, gemeindenModul.dateiLoeschen(url.searchParams.get('gemeinde'), url.searchParams.get('id')));
  }

  // ---- Finanzen -----------------------------------------------------------

  if (pfad === '/api/finanzen' && req.method === 'GET') {
    return sendJSON(res, 200, finanzen.auswertung({
      von: datumOderNull(url.searchParams.get('von')),
      bis: datumOderNull(url.searchParams.get('bis')),
      bereich: finanzen.BEREICHE.includes(url.searchParams.get('bereich')) ? url.searchParams.get('bereich') : null
    }));
  }

  // PDF wird gelesen und sofort verworfen — gespeichert werden nur die Buchungen.
  if (pfad === '/api/finanzen/pdf' && req.method === 'POST') {
    const puffer = await rohLesen(req, 25 * 1024 * 1024);
    if (!puffer.length) return sendJSON(res, 400, { fehler: 'Die Datei ist leer.' });
    if (puffer.slice(0, 5).toString('latin1') !== '%PDF-') return sendJSON(res, 400, { fehler: 'Das ist keine PDF-Datei.' });

    const name = decodeURIComponent(url.searchParams.get('name') || 'auszug.pdf');
    const hash = crypto.createHash('sha256').update(puffer).digest('hex').slice(0, 32);
    let seiten;
    try {
      seiten = await pdf.lesen(puffer);
    } catch (fehler) {
      return sendJSON(res, 400, { fehler: `PDF nicht lesbar: ${fehler.message}` });
    }
    const auswertung = banken.auswerten(seiten);
    if (auswertung.fehler) return sendJSON(res, 400, auswertung);
    return sendJSON(res, 200, finanzen.vorschau(auswertung, hash, name));
  }

  if (pfad === '/api/finanzen/import' && req.method === 'POST') {
    return sendJSON(res, 200, finanzen.uebernehmen(await koerperLesen(req, 8 * 1024 * 1024)));
  }

  if (pfad === '/api/finanzen/buchung' && req.method === 'POST') {
    return sendJSON(res, 200, finanzen.buchungAendern(await koerperLesen(req)));
  }

  if (pfad === '/api/finanzen/regel' && req.method === 'POST') {
    return sendJSON(res, 200, finanzen.regelSpeichern(await koerperLesen(req)));
  }

  if (pfad === '/api/finanzen/regel' && req.method === 'DELETE') {
    return sendJSON(res, 200, finanzen.regelLoeschen(url.searchParams.get('id')));
  }

  if (pfad === '/api/finanzen/regeln' && req.method === 'GET') {
    const d = finanzen.lesen();
    return sendJSON(res, 200, { regeln: d.regeln, kategorien: d.kategorien, importe: d.importe.slice(-10).reverse() });
  }

  if (pfad === '/api/finanzen/regeln/anwenden' && req.method === 'POST') {
    const koerper = await koerperLesen(req);
    return sendJSON(res, 200, finanzen.regelnAnwenden(koerper.nurLeere !== false));
  }

  if (pfad === '/api/finanzen/kategorie' && req.method === 'POST') {
    return sendJSON(res, 200, finanzen.kategorieSpeichern(await koerperLesen(req)));
  }

  if (pfad === '/api/finanzen/kategorie' && req.method === 'DELETE') {
    const ergebnis = finanzen.kategorieLoeschen(url.searchParams.get('id'));
    return sendJSON(res, ergebnis.ok ? 200 : 409, ergebnis);
  }

  // ---- Einstellungen und Mail --------------------------------------------

  if (pfad === '/api/einstellungen' && req.method === 'GET') {
    const config = store.read('config.json');
    const m = config.mail || {};
    return sendJSON(res, 200, {
      thema: config.thema || 'kante',
      startseite: store.startseiteNormalisieren(config.startseite),
      kacheln: store.KACHELN,
      vorlagen: Object.entries(store.VORLAGEN).map(([id, v]) => ({ id, name: v.name })),
      mail: {
        aktiv: Boolean(m.aktiv),
        empfaenger: m.empfaenger || null,
        uhrzeit: m.uhrzeit || '07:00',
        schluesselGesetzt: Boolean(mail.schluesselHolen(config)),
        ausUmgebung: Boolean(process.env.HDD_WEB3FORMS_KEY),
        letzterVersand: m.letzterVersand || null,
        letzterFehler: m.letzterFehler || null
      }
    });
  }

  if (pfad === '/api/einstellungen' && req.method === 'POST') {
    const koerper = await koerperLesen(req);
    const config = store.read('config.json');
    const m = config.mail || {};
    const neu = { ...config };

    if (['kante', 'ruhe', 'linie'].includes(koerper.thema)) neu.thema = koerper.thema;

    // "vorlage" allein setzt das ganze Layout zurueck, "startseite" einzelne Kacheln.
    if (typeof koerper.vorlage === 'string') neu.startseite = store.vorlage(koerper.vorlage);
    else if (koerper.startseite) neu.startseite = store.startseiteNormalisieren(koerper.startseite);

    if (koerper.mail) {
      neu.mail = {
        ...m,
        aktiv: Boolean(koerper.mail.aktiv),
        empfaenger: text(koerper.mail.empfaenger, 200) || m.empfaenger || null,
        uhrzeit: /^\d{2}:\d{2}$/.test(String(koerper.mail.uhrzeit || '')) ? koerper.mail.uhrzeit : (m.uhrzeit || '07:00'),
        // Leeres Feld bedeutet "unverändert lassen", nicht "löschen".
        schluessel: koerper.mail.schluessel === null ? null
          : (text(koerper.mail.schluessel, 200) || m.schluessel || null)
      };
    }

    store.write('config.json', neu);
    return sendJSON(res, 200, { ok: true, startseite: store.startseiteNormalisieren(neu.startseite) });
  }

  if (pfad === '/api/mail/vorschau' && req.method === 'POST') {
    const nachricht = mail.bauen(bestand(), store.heute());
    if (nachricht.leer) return sendJSON(res, 200, { leer: true });
    return sendJSON(res, 200, nachricht);
  }

  // Der Browser fragt, ob etwas zu verschicken ist, schickt es ab und meldet zurueck.
  if (pfad === '/api/mail/faellig' && req.method === 'GET') {
    return sendJSON(res, 200, mail.auftrag(bestand));
  }

  if (pfad === '/api/mail/quittung' && req.method === 'POST') {
    const koerper = await koerperLesen(req);
    return sendJSON(res, 200, mail.quittieren(Boolean(koerper.ok), koerper.fehler));
  }

  if (pfad === '/api/mail/test' && req.method === 'POST') {
    const auftrag = mail.testAuftrag(bestand);
    return sendJSON(res, auftrag.fehler ? 400 : 200, auftrag);
  }

  if (pfad === '/api/kategorie' && req.method === 'POST') {
    const koerper = await koerperLesen(req);
    return sendJSON(res, 200, kategorieSpeichern(koerper));
  }

  if (pfad === '/api/kategorie' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    const d = daten();
    const benutzt = d.entries.filter((e) => e.kategorie === id).length;
    if (benutzt) return sendJSON(res, 409, { fehler: `Kategorie wird von ${benutzt} Einträgen benutzt.` });
    entriesSchreiben(d.entries, d.kategorien.filter((k) => k.id !== id));
    return sendJSON(res, 200, { ok: true });
  }

  return sendJSON(res, 404, { fehler: 'Unbekannter Endpunkt.' });
};

const cookie = (sitzung) => `${auth.COOKIE}=${sitzung.token}; Path=/; Max-Age=${sitzung.maxAge}; HttpOnly; SameSite=Lax`;

// ---------------------------------------------------------------- Schreiboperationen

const eintragSpeichern = (koerper) => {
  const d = daten();
  const datum = datumOderNull(koerper.datum);
  if (!datum) return { fehler: 'Datum fehlt oder ist ungültig.' };
  const inhalt = text(koerper.text);
  if (!inhalt) return { fehler: 'Text fehlt.' };

  const bis = datumOderNull(koerper.datumBis);
  const felder = {
    datum,
    datumBis: bis && bis >= datum ? bis : null,
    uhrzeit: uhrzeitOderNull(koerper.uhrzeit),
    text: inhalt,
    kategorie: d.kategorien.some((k) => k.id === koerper.kategorie) ? koerper.kategorie : null,
    prioritaet: PRIOS.includes(koerper.prioritaet) ? koerper.prioritaet : 'mittel',
    istFrist: Boolean(koerper.istFrist),
    wiederholung: wiederholungPruefen(koerper.wiederholung),
    geaendert: store.jetzt()
  };

  const vorhanden = d.entries.find((e) => e.id === koerper.id);
  if (vorhanden) {
    Object.assign(vorhanden, felder);
    if (!vorhanden.wiederholung) delete vorhanden.erledigtAn;
    entriesSchreiben(d.entries, d.kategorien);
    return { ok: true, eintrag: vorhanden };
  }

  const neu = {
    id: store.id('e'),
    ...felder,
    erledigt: false,
    erledigtAn: [],
    erstellt: store.jetzt()
  };
  entriesSchreiben([...d.entries, neu], d.kategorien);
  return { ok: true, eintrag: neu };
};

const erledigtSetzen = ({ id, datum, wert }) => {
  const d = daten();
  const eintrag = d.entries.find((e) => e.id === id);
  if (!eintrag) return { fehler: 'Eintrag nicht gefunden.' };

  if (eintrag.wiederholung) {
    const start = datumOderNull(datum);
    if (!start) return { fehler: 'Für eine Serie wird der Tag gebraucht.' };
    const liste = new Set(eintrag.erledigtAn || []);
    if (wert) liste.add(start); else liste.delete(start);
    eintrag.erledigtAn = [...liste].sort();
  } else {
    eintrag.erledigt = Boolean(wert);
  }
  eintrag.geaendert = store.jetzt();
  entriesSchreiben(d.entries, d.kategorien);
  return { ok: true };
};

const aufgabeSpeichern = (koerper) => {
  const tasks = daten().tasks;
  const titel = text(koerper.titel, 300);
  if (!titel) return { fehler: 'Titel fehlt.' };

  const felder = {
    titel,
    notiz: text(koerper.notiz, 4000),
    status: STATI.includes(koerper.status) ? koerper.status : 'offen',
    prioritaet: PRIOS.includes(koerper.prioritaet) ? koerper.prioritaet : 'mittel',
    faellig: datumOderNull(koerper.faellig),
    geaendert: store.jetzt()
  };

  const vorhanden = tasks.find((t) => t.id === koerper.id);
  if (vorhanden) {
    Object.assign(vorhanden, felder);
    tasksSchreiben(tasks);
    return { ok: true, aufgabe: vorhanden };
  }

  const neu = { id: store.id('t'), ...felder, erstellt: store.jetzt() };
  tasksSchreiben([...tasks, neu]);
  return { ok: true, aufgabe: neu };
};

const kategorieSpeichern = (koerper) => {
  const d = daten();
  const name = text(koerper.name, 60);
  if (!name) return { fehler: 'Name fehlt.' };
  const farbe = /^#[0-9a-f]{6}$/i.test(String(koerper.farbe || '')) ? koerper.farbe : store.NEON.cyan;

  const vorhanden = d.kategorien.find((k) => k.id === koerper.id);
  if (vorhanden) {
    vorhanden.name = name;
    vorhanden.farbe = farbe;
    entriesSchreiben(d.entries, d.kategorien);
    return { ok: true, kategorie: vorhanden };
  }

  const neu = { id: store.id('kat'), name, farbe };
  entriesSchreiben(d.entries, [...d.kategorien, neu]);
  return { ok: true, kategorie: neu };
};

// ---------------------------------------------------------------- Startseite

const startDaten = () => {
  const heute = store.heute();
  const morgen = D.plusTage(heute, 1);
  const fensterEnde = D.plusTage(heute, FRIST_FENSTER);
  const d = daten();
  const config = store.read('config.json');

  const fristen = [];
  for (const eintrag of d.entries.filter((e) => e.istFrist)) {
    const naechstes = wdh.naechstes(eintrag, heute);
    if (!naechstes || naechstes.start > fensterEnde) continue;
    if (erledigtAm(eintrag, naechstes.start)) continue;
    fristen.push({
      ...alsVorkommen(eintrag, naechstes, naechstes.start),
      tageBis: D.differenzTage(heute, naechstes.start)
    });
  }
  // Fristen aus den Gemeinde-Akten laufen in dieselbe Warnung.
  for (const frist of gemeindenModul.fristen(heute, fensterEnde)) {
    fristen.push({
      id: frist.id,
      gemeindeId: frist.gemeindeId,
      datum: frist.datum,
      start: frist.datum,
      ende: frist.datum,
      text: frist.text,
      kategorie: null,
      prioritaet: 'hoch',
      istFrist: true,
      istGemeinde: true,
      herkunft: frist.gemeinde,
      erledigt: false,
      tageBis: frist.tageBis
    });
  }
  fristen.sort((a, b) => a.tageBis - b.tageBis);

  const tage = nachTag(d.entries, heute, morgen);

  const offeneAufgaben = d.tasks
    .filter((t) => t.status !== 'erledigt')
    .sort((a, b) => {
      const p = PRIO_RANG[a.prioritaet] - PRIO_RANG[b.prioritaet];
      if (p) return p;
      if (a.faellig && b.faellig) return a.faellig < b.faellig ? -1 : 1;
      if (a.faellig) return -1;
      if (b.faellig) return 1;
      return 0;
    })
    .slice(0, 12);

  // Absteigend nach Datum, damit zukünftige Einträge oben stehen.
  const canListe = d.entries
    .filter((e) => e.kategorie === CAN_KATEGORIE)
    .sort((a, b) => (a.datum < b.datum ? 1 : a.datum > b.datum ? -1 : 0))
    .slice(0, 10)
    .map((e) => ({ id: e.id, datum: e.datum, text: e.text, tageHer: D.differenzTage(e.datum, heute) }));

  return {
    heute,
    morgen,
    fristen,
    heuteEintraege: tage[heute] || [],
    morgenEintraege: tage[morgen] || [],
    heuteAufgaben: d.tasks.filter((t) => t.status !== 'erledigt' && t.faellig && t.faellig <= heute),
    offeneAufgaben,
    canListe,
    canKategorie: d.kategorien.find((k) => k.id === CAN_KATEGORIE) || null,
    kategorien: d.kategorien,
    // Gemeinden, bei denen etwas offen ist oder liegen bleibt. Aufgaben ohne
    // Datum erreichen nur diese Kachel, nicht die Signalzeile und nicht die Mail.
    gemeinden: gemeindenModul.uebersicht(heute)
      .filter((g) => !['zusage', 'absage'].includes(g.stand)
        && (g.offeneAufgaben > 0 || g.tageStill === null || g.tageStill >= 14))
      .slice(0, 8)
      .map((g) => ({
        id: g.id,
        name: g.name,
        stand: g.stand,
        tageStill: g.tageStill,
        letzterSchritt: g.letzterSchritt,
        offeneAufgaben: g.offeneAufgaben,
        aufgaben: g.aufgabenListe
      })),
    finanzen: finanzen.kachel(heute),
    thema: config.thema || 'kante',
    startseite: store.startseiteNormalisieren(config.startseite)
  };
};

// ---------------------------------------------------------------- Statische Dateien

const statisch = (res, pfad) => {
  const name = pfad === '/' ? 'index.html' : pfad.replace(/^\/+/, '');
  const ziel = path.join(PUBLIC_DIR, name);
  if (!ziel.startsWith(PUBLIC_DIR) || !fs.existsSync(ziel) || !fs.statSync(ziel).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Nicht gefunden');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(ziel)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  return res.end(fs.readFileSync(ziel));
};

// ---------------------------------------------------------------- Server

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || HOST}`);

  try {
    if (url.pathname.startsWith('/api/')) {
      // Schreibende Zugriffe brauchen den eigenen Header. Eine fremde Seite im Browser
      // kann den ohne Freigabe nicht setzen und damit nichts über localhost auslösen.
      if (req.method !== 'GET' && req.headers['x-hdd'] !== '1') {
        return sendJSON(res, 403, { fehler: 'Fehlender Anfrage-Header.' });
      }
      const angemeldet = auth.sessionGueltig(auth.tokenAusCookie(req.headers.cookie));
      return await api(req, res, url, angemeldet);
    }
    return statisch(res, url.pathname);
  } catch (fehler) {
    return sendJSON(res, 500, { fehler: fehler.message });
  }
});

store.ensureDirs();
const gesichert = backup.taeglich();

server.listen(PORT, HOST, () => {
  process.stdout.write(`HDDatenbank laeuft auf http://${HOST}:${PORT}\n`);
  if (gesichert.erstellt) process.stdout.write(`Backup angelegt: backups/${gesichert.ordner}\n`);
  if (!auth.eingerichtet()) process.stdout.write('Noch keine PIN gesetzt — beim ersten Aufruf wird sie eingerichtet.\n');
});
