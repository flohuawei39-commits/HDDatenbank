import * as store from './store.js';
import * as D from './datum.js';
import * as wdh from './recurrence.js';

const FRIST_FENSTER = 14;
const VORSCHAU_TAGE = 7;

/* Der Zugangsschluessel steht in der Konfiguration. Frueher konnte ihn eine
   Umgebungsvariable ueberschreiben; im Browser gibt es die nicht, und `process`
   existiert dort ueberhaupt nicht. */
const schluesselHolen = (config) => (config.mail && config.mail.schluessel) || null;

/** Alle Vorkommen an genau einem Tag. */
const amTag = (entries, tag) => {
  const treffer = [];
  for (const eintrag of entries) {
    for (const v of wdh.vorkommen(eintrag, tag, tag)) {
      const erledigt = eintrag.wiederholung ? (eintrag.erledigtAn || []).includes(v.start) : Boolean(eintrag.erledigt);
      if (erledigt) continue;
      treffer.push({ eintrag, start: v.start, laufend: v.start !== tag });
    }
  }
  return treffer.sort((a, b) => String(a.eintrag.uhrzeit || '99').localeCompare(String(b.eintrag.uhrzeit || '99')));
};

const zeileEintrag = ({ eintrag, laufend }, katName) => {
  const zeit = eintrag.uhrzeit ? eintrag.uhrzeit.padEnd(6) : '      ';
  const kat = eintrag.kategorie && katName.get(eintrag.kategorie) ? ` (${katName.get(eintrag.kategorie)})` : '';
  const prio = eintrag.prioritaet === 'hoch' ? ' [hoch]' : '';
  return `  ${zeit}${laufend ? '… ' : ''}${eintrag.text}${kat}${prio}`;
};

/** Fristen aus Einträgen und aus den Gemeinde-Akten, zusammengeführt und sortiert. */
const fristenSammeln = (bestand, heute) => {
  const ende = D.plusTage(heute, FRIST_FENSTER);
  const liste = [];

  for (const eintrag of (bestand.entries || []).filter((e) => e.istFrist)) {
    const naechstes = wdh.naechstes(eintrag, heute);
    if (!naechstes || naechstes.start > ende) continue;
    const erledigt = eintrag.wiederholung ? (eintrag.erledigtAn || []).includes(naechstes.start) : Boolean(eintrag.erledigt);
    if (erledigt) continue;
    liste.push({ datum: naechstes.start, text: eintrag.text, quelle: null, tageBis: D.differenzTage(heute, naechstes.start) });
  }

  for (const gemeinde of bestand.gemeinden || []) {
    for (const frist of gemeinde.fristen || []) {
      if (frist.erledigt || !frist.datum || frist.datum < heute || frist.datum > ende) continue;
      liste.push({ datum: frist.datum, text: frist.text, quelle: gemeinde.name, tageBis: D.differenzTage(heute, frist.datum) });
    }
  }

  return liste.sort((a, b) => a.tageBis - b.tageBis);
};

/**
 * Baut die Tagesmail. Gibt { leer } zurück, wenn es nichts zu melden gibt —
 * eine leere Erinnerung jeden Morgen wäre der schnellste Weg, sie zu ignorieren.
 */
const bauen = (bestand, heute, verspaetet = false) => {
  const morgen = D.plusTage(heute, 1);
  const inSieben = D.plusTage(heute, VORSCHAU_TAGE);
  const katName = new Map((bestand.kategorien || []).map((k) => [k.id, k.name]));
  const entries = bestand.entries || [];
  const tasks = bestand.tasks || [];

  const heuteListe = amTag(entries, heute);
  const morgenListe = amTag(entries, morgen);
  const siebenListe = amTag(entries, inSieben);
  const fristen = fristenSammeln(bestand, heute);
  const faellig = tasks.filter((t) => t.status !== 'erledigt' && t.faellig && t.faellig <= heute);
  const bald = tasks.filter((t) => t.status !== 'erledigt' && t.faellig && t.faellig > heute && t.faellig <= inSieben);

  const leer = !heuteListe.length && !morgenListe.length && !siebenListe.length && !fristen.length && !faellig.length && !bald.length;
  if (leer) return { leer: true };

  const teile = [`HDDatenbank — ${D.formatLang(heute)}`, ''];
  if (verspaetet) teile.push('(Nachträglich verschickt — der Rechner lief zum geplanten Zeitpunkt nicht.)', '');

  if (fristen.length) {
    teile.push(`FRISTEN BIS ${D.formatDE(D.plusTage(heute, FRIST_FENSTER))}`);
    for (const f of fristen) {
      const rest = f.tageBis === 0 ? 'HEUTE' : `noch ${f.tageBis} Tage`;
      teile.push(`  ${rest.padEnd(13)}${f.text}${f.quelle ? ` — ${f.quelle}` : ''} (${D.formatDE(f.datum)})`);
    }
    teile.push('');
  }

  teile.push('HEUTE');
  if (!heuteListe.length && !faellig.length) teile.push('  nichts eingetragen');
  for (const v of heuteListe) teile.push(zeileEintrag(v, katName));
  for (const t of faellig) {
    const seit = D.differenzTage(t.faellig, heute);
    teile.push(`  Aufgabe: ${t.titel} (${t.prioritaet}${seit > 0 ? `, überfällig seit ${seit} Tagen` : ''})`);
  }
  teile.push('');

  teile.push(`MORGEN — ${D.formatDE(morgen)}`);
  if (!morgenListe.length) teile.push('  nichts eingetragen');
  for (const v of morgenListe) teile.push(zeileEintrag(v, katName));
  teile.push('');

  if (siebenListe.length || bald.length) {
    teile.push(`IN ${VORSCHAU_TAGE} TAGEN — ${D.formatDE(inSieben)}`);
    for (const v of siebenListe) teile.push(zeileEintrag(v, katName));
    for (const t of bald) teile.push(`  Aufgabe fällig ${D.formatDE(t.faellig)}: ${t.titel}`);
    teile.push('');
  }

  const offen = tasks.filter((t) => t.status !== 'erledigt').length;
  teile.push(`Offene Aufgaben insgesamt: ${offen}`);

  return {
    leer: false,
    betreff: `HDDatenbank ${D.formatDE(heute)}${fristen.length ? ` — ${fristen.length} Frist${fristen.length > 1 ? 'en' : ''}` : ''}`,
    text: teile.join('\n')
  };
};

const jetztHHMM = () => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const addierteStunde = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${String(Math.min(23, h + 1)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// Web3Forms verweigert serverseitige Aufrufe im Gratistarif (403). Der Server entscheidet
// deshalb nur, WANN die Mail dran ist; abgeschickt wird sie von der geoeffneten Seite.
// Kurze Sperre, damit zwei offene Tabs nicht zwei Mails ausloesen.
const sperre = { bis: 0 };
const SPERRE_MS = 120000;

/**
 * Liegt ein Versandauftrag vor? Liefert den fertigen Text plus Schluessel,
 * damit der Browser ihn abschicken kann. Der Schluessel ist laut Web3Forms
 * ein oeffentlicher Wert und ausdruecklich fuer Client-Code vorgesehen.
 */
const auftrag = (bestandHolen, jetztZeit = null) => {
  const config = store.read('config.json');
  const mail = config.mail || {};
  const schluessel = schluesselHolen(config);

  if (!mail.aktiv) return { faellig: false, grund: 'Tagesmail ist ausgeschaltet.' };
  if (!schluessel) return { faellig: false, grund: 'Kein Zugangsschlüssel hinterlegt.' };

  const heute = store.heute();
  const uhr = jetztZeit || jetztHHMM();
  if (mail.letzterVersand === heute) return { faellig: false, grund: 'heute schon verschickt' };
  if (uhr < (mail.uhrzeit || '07:00')) return { faellig: false, grund: 'noch zu früh' };
  if (Date.now() < sperre.bis) return { faellig: false, grund: 'Versand läuft gerade' };

  const verspaetet = uhr > addierteStunde(mail.uhrzeit || '07:00');
  const nachricht = bauen(bestandHolen(), heute, verspaetet);

  if (nachricht.leer) {
    // Nichts zu melden: Tag als erledigt vermerken, damit nicht minuetlich neu geprueft wird.
    store.write('config.json', { ...config, mail: { ...mail, letzterVersand: heute, letzterFehler: null } });
    return { faellig: false, grund: 'für heute steht nichts an' };
  }

  sperre.bis = Date.now() + SPERRE_MS;
  return {
    faellig: true,
    verspaetet,
    betreff: nachricht.betreff,
    text: nachricht.text,
    schluessel,
    empfaenger: mail.empfaenger || null
  };
};

/** Rueckmeldung des Browsers: erst danach gilt der Tag als erledigt. */
const quittieren = (ok, fehler) => {
  const config = store.read('config.json');
  const mail = config.mail || {};
  sperre.bis = 0;
  store.write('config.json', {
    ...config,
    mail: {
      ...mail,
      letzterVersand: ok ? store.heute() : mail.letzterVersand,
      letzterFehler: ok ? null : `${store.jetzt()}: ${String(fehler || 'unbekannt').slice(0, 300)}`
    }
  });
  return { ok: true };
};

/** Einmaliger Testauftrag, unabhaengig von Uhrzeit und Tagesstand. */
const testAuftrag = (bestandHolen) => {
  const config = store.read('config.json');
  const mail = config.mail || {};
  const schluessel = schluesselHolen(config);
  if (!schluessel) return { fehler: 'Kein Zugangsschlüssel hinterlegt.' };

  const heute = store.heute();
  const nachricht = bauen(bestandHolen(), heute);
  return {
    ok: true,
    betreff: nachricht.leer ? `HDDatenbank Testmail ${D.formatDE(heute)}` : nachricht.betreff,
    text: nachricht.leer
      ? 'Testmail der HDDatenbank. Für heute steht nichts an — im Alltag stünde hier die Tagesübersicht.'
      : nachricht.text,
    schluessel,
    empfaenger: mail.empfaenger || null
  };
};

export { bauen, auftrag, quittieren, testAuftrag, schluesselHolen, FRIST_FENSTER, VORSCHAU_TAGE };
