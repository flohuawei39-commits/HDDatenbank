/* HDDatenbank — Oberflaeche. Kein Framework, bewusst nur DOM.

   Frueher lief alles ueber fetch gegen einen Node-Server. Der ist weg; die
   Aufrufe gehen jetzt an lib/routen.js im selben Fenster. Die Pfade und
   Rueckgaben sind dieselben geblieben, deshalb steht der Rest dieser Datei
   praktisch unveraendert da.                                                */

import { ruf, auszugLesen, dokumentLesen } from './lib/routen.js';
import { alles as storeAlles, handyReihenfolge, MINDESTHOEHE } from './lib/store.js';
import * as sync from './lib/sync.js';
import * as github from './lib/github.js';
import * as spiegel from './lib/spiegel.js';
import { FARBEN as ANFANGSFARBEN } from './lib/reime.js';
import { FASSUNG } from './lib/fassung.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

// Steht in den Einstellungen. Zeigt sie eine alte Kennung, haelt der Browser
// die Module unter lib/ noch fest — siehe lib/fassung.js.
$('#fassung').textContent = FASSUNG;

const S = {
  kategorien: [],
  arten: [],
  tasks: [],
  finKategorien: [],
  finBuchungen: [],
  importDaten: null,
  gemeinden: [],
  staende: [],
  akteId: null,
  thema: 'kante',
  heute: null,
  ansicht: 'start',
  startseite: null,
  finanzKachel: null,
  kachelNamen: [],
  vorlagen: [],
  offeneGemeinden: new Set(),
  kalJahr: 0,
  kalMonat: 0,
  monat: null,
  gewaehlterTag: null,
  vorschau: null,
  reiter: [],
  feldTypen: [],
  reimeBereich: 'reime',
  reimeKategorie: null,
  reimeDaten: null,
  reimeEinst: null,
  rkatBereich: 'reime',
  silbenRegister: [],
  eigenReiter: null,
  eigenDaten: null,
  eigenSuche: '',
  eigenSort: null,
  eigenRichtung: 'auf'
};

const PRIO_LABEL = { gering: 'gering', mittel: 'mittel', hoch: 'hoch' };
const WDH_LABEL = { taeglich: 'täglich', woechentlich: 'wöchentlich', monatlich: 'monatlich', jaehrlich: 'jährlich' };
const TAGE_LANG = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// ---------------------------------------------------------------- Werkzeug

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (z) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]
));

/* Derselbe Zuschnitt wie frueher die HTTP-Hilfe: Pfad rein, Daten raus,
   ein Fehlerfeld in der Antwort wird zur Ausnahme. Nur ohne Netz dazwischen. */
const api = async (pfad, optionen = {}) => {
  const daten = await ruf(optionen.method || 'GET', pfad, optionen.koerper || {});
  if (daten && daten.fehler) throw new Error(daten.fehler);
  return daten;
};

const post = (pfad, koerper) => api(pfad, { method: 'POST', koerper: koerper || {} });
const del = (pfad) => api(pfad, { method: 'DELETE' });

const toast = (nachricht, fehler = false) => {
  const el = $('#toast');
  el.textContent = nachricht;
  el.className = `toast${fehler ? ' toast-fehler' : ''}`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.add('versteckt'), 2600);
};

const fangen = (fn) => (...args) => Promise.resolve(fn(...args)).catch((f) => toast(f.message, true));

const heuteISO = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const formatDE = (iso) => (iso ? `${Number(iso.slice(8))}.${Number(iso.slice(5, 7))}.${iso.slice(0, 4)}` : '');
const formatKurz = (iso) => (iso ? `${Number(iso.slice(8))}.${Number(iso.slice(5, 7))}.` : '');

const wochentagIndex = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
};

const kategorie = (id) => S.kategorien.find((k) => k.id === id) || null;
const katFarbe = (id) => (kategorie(id) ? kategorie(id).farbe : null);

const relativ = (tage) => {
  if (tage === 0) return 'heute';
  if (tage === 1) return 'gestern';
  if (tage === -1) return 'morgen';
  if (tage > 1) return `vor ${tage} Tagen`;
  return `in ${Math.abs(tage)} Tagen`;
};

/* ---------------------------------------------------------------- Anmeldung

   Das Passwort ist kein Tuersteher mehr, sondern der Schluessel selbst: aus ihm
   wird abgeleitet, womit die Daten ver- und entschluesselt werden. Ein falsches
   Passwort scheitert deshalb nicht an einer Pruefung, sondern daran, dass sich
   die Daten nicht entschluesseln lassen. Es gibt kein Zuruecksetzen.        */

const ABLAGE_SCHLUESSEL = 'hdd_ablage';

/** Zugangsdaten der Fernablage. Der Token liegt hier, das Passwort nie. */
const ablageHolen = () => {
  for (const speicher of [localStorage, sessionStorage]) {
    try {
      const roh = speicher.getItem(ABLAGE_SCHLUESSEL);
      if (roh) return JSON.parse(roh);
    } catch { /* Speicher gesperrt, dann eben ohne */ }
  }
  return null;
};

const ablageSetzen = (wert, merken) => {
  localStorage.removeItem(ABLAGE_SCHLUESSEL);
  sessionStorage.removeItem(ABLAGE_SCHLUESSEL);
  if (!wert) return;
  (merken ? localStorage : sessionStorage).setItem(ABLAGE_SCHLUESSEL, JSON.stringify(wert));
};

const torZeigen = (ersteEinrichtung) => {
  $('#tor').classList.remove('versteckt');
  $('#app').classList.add('versteckt');
  const ablage = ablageHolen();
  $('#tor-text').textContent = ersteEinrichtung
    ? 'Ersteinrichtung: Passwort festlegen'
    : 'Passwort eingeben';
  $('#tor-pin2').classList.toggle('versteckt', !ersteEinrichtung);
  $('#tor-warnung').classList.toggle('versteckt', !ersteEinrichtung);
  $('#tor-form').dataset.modus = ersteEinrichtung ? 'setup' : 'login';
  $('#tor-ablage').textContent = ablage
    ? `Abgleich mit ${ablage.besitzer}/${ablage.repo}`
    : 'Nur auf diesem Gerät. Abgleich lässt sich in den Einstellungen einrichten.';
  $('#tor-pin').focus();
};

const appZeigen = async () => {
  $('#tor').classList.add('versteckt');
  $('#app').classList.remove('versteckt');
  await datenLaden();
  const jetzt = new Date();
  S.kalJahr = jetzt.getFullYear();
  S.kalMonat = jetzt.getMonth() + 1;
  await ansichtWechseln('start');
  abgleichAnzeigen(sync.zustand);   // Ausgangszustand einmal hinschreiben

  mailWecker();
  setInterval(mailWecker, 60000);
};

$('#tor-form').addEventListener('submit', fangen(async (ereignis) => {
  ereignis.preventDefault();
  const fehlerFeld = $('#tor-fehler');
  fehlerFeld.textContent = '';
  const passwort = $('#tor-pin').value;
  const ersteEinrichtung = $('#tor-form').dataset.modus === 'setup';

  let start;
  try {
    if (ersteEinrichtung && passwort !== $('#tor-pin2').value) {
      throw new Error('Die beiden Passwörter stimmen nicht überein.');
    }
    start = await sync.starten({ passwort, ablage: ablageHolen() });
    if (!start.ok) throw new Error(start.fehler);
  } catch (fehler) {
    fehlerFeld.textContent = fehler.message;
    $('#tor-pin').select();
    return;
  }

  $('#tor-pin').value = '';
  $('#tor-pin2').value = '';
  if (ersteEinrichtung) await sync.sichern('Erste Einrichtung');
  await appZeigen();

  // Ohne Verbindung gestartet: der Balken sagt dauerhaft, von wann der Stand ist.
  if (start.offline) ohneVerbindungSeit = start.standZeit;
  abgleichAnzeigen(sync.zustand);
  // Beide Seiten sind weitergelaufen — der einzige Fall, in dem gefragt wird.
  if (start.konflikt) await konfliktZeigen();
}));

$('#abmelden').addEventListener('click', fangen(async () => {
  await sync.sichern('Vor dem Abmelden gesichert').catch(() => {});
  await sync.abmelden();
  location.reload();
}));

// ---- Abgleichanzeige -------------------------------------------------------

const abgleichAnzeigen = (zustand) => {
  const el = $('#abgleich');
  if (!el) return;
  // Ohne Fernablage gibt es nichts zu holen.
  $('#aktualisieren').classList.toggle('versteckt', !sync.hatFernablage());
  if (zustand.letzterFehler) {
    el.textContent = `⚠ ${zustand.letzterFehler}`;
    el.className = 'abgleich abgleich-fehler';
  } else if (zustand.schmutzig) {
    el.textContent = '… wird gesichert';
    el.className = 'abgleich abgleich-offen';
  } else {
    el.textContent = sync.hatFernablage() ? '✓ abgeglichen' : '✓ lokal gesichert';
    el.className = 'abgleich';
  }
  warnbandPflegen(zustand);
};

sync.anmelden(abgleichAnzeigen);

/* ---- Warnband unter dem Kopf -------------------------------------------------

   Zwei Lagen darf man nicht uebersehen, und beide verschwinden nicht von selbst
   aus dem Blick: die Anwendung zeigt einen alten Stand, weil GitHub nicht
   erreichbar war, oder eigene Aenderungen liegen noch hier und sind drueben nie
   angekommen. Eine kurz eingeblendete Meldung reicht dafuer nicht — wer sie
   verpasst, haelt einen alten Stand fuer den aktuellen.                      */

let ohneVerbindungSeit = null;   // Zeitpunkt des Standes, der ersatzweise gilt
let wiederholung = null;         // Takt, laeuft nur solange etwas ansteht

const zeitpunkt = (iso) => {
  const d = new Date(iso || '');
  if (Number.isNaN(d.getTime())) return '';
  const zwei = (n) => String(n).padStart(2, '0');
  return `${d.getDate()}.${d.getMonth() + 1}., ${zwei(d.getHours())}:${zwei(d.getMinutes())}`;
};

const warnbandPflegen = (zustand) => {
  const band = $('#warnband');
  const knopf = $('#warnband-tat');

  if (zustand.letzterFehler && zustand.schmutzig) {
    $('#warnband-text').textContent = 'Änderungen sind noch nicht bei GitHub angekommen.';
    knopf.textContent = 'Jetzt hochladen';
    knopf.dataset.tat = 'sichern';
    band.classList.remove('versteckt');
  } else if (zustand.letzterFehler) {
    const wann = ohneVerbindungSeit ? ` — angezeigt wird der Stand vom ${zeitpunkt(ohneVerbindungSeit)}` : '';
    $('#warnband-text').textContent = `Ohne Verbindung zu GitHub${wann}.`;
    knopf.textContent = 'Erneut versuchen';
    knopf.dataset.tat = 'holen';
    band.classList.remove('versteckt');
  } else {
    ohneVerbindungSeit = null;
    band.classList.add('versteckt');
  }

  // Der Takt laeuft nur im Ausnahmefall und schaltet sich selbst wieder ab.
  const noetig = Boolean(zustand.letzterFehler) && sync.hatFernablage();
  if (noetig && !wiederholung) wiederholung = setInterval(() => { nachtragen(); }, 60000);
  if (!noetig && wiederholung) { clearInterval(wiederholung); wiederholung = null; }
};

/** Was ansteht, nachtragen: Eigenes geht hoch, sonst wird nur nachgesehen. */
const nachtragen = async () => {
  if (!sync.hatFernablage()) return;
  if (sync.zustand.schmutzig) await sync.sichern().catch(() => {});
  else await aktualisieren({ still: true }).catch(() => {});
};

$('#warnband-tat').addEventListener('click', fangen(async () => {
  if ($('#warnband-tat').dataset.tat === 'sichern') {
    const ergebnis = await sync.sichern();
    if (ergebnis.konflikt) return konfliktZeigen();
    if (!ergebnis.ok) throw new Error(ergebnis.fehler);
    toast('Bei GitHub angekommen');
  } else {
    await aktualisieren();
  }
}));

// Netz wieder da: sofort nachholen, nicht erst beim naechsten Takt.
window.addEventListener('online', () => { nachtragen(); });

/* ---- Konflikt --------------------------------------------------------------

   Zwei Geraete haben unabhaengig voneinander geschrieben. Es wird bewusst nicht
   zusammengefuehrt: bei widersprechenden Eintraegen trifft das zuverlaessig die
   falsche Wahl. Stattdessen beide Staende zeigen und den Menschen entscheiden
   lassen. Bis dahin ist nichts ueberschrieben.                                */

let konfliktLaeuft = false;

const konfliktZeigen = fangen(async () => {
  if (konfliktLaeuft) return;
  konfliktLaeuft = true;
  try {
    const staende = await sync.konfliktStaende();
    const zeile = (name, a, b) => `<tr><td>${esc(name)}</td><td class="${a.k !== b.k ? 'konflikt-anders' : ''}">${a.k}</td><td class="${a.k !== b.k ? 'konflikt-anders' : ''}">${b.k}</td></tr>`;
    const felder = [['Einträge', 'eintraege'], ['Aufgaben', 'aufgaben'], ['Gemeinden', 'gemeinden'], ['Buchungen', 'buchungen']];

    dialogOeffnen('Auf zwei Geräten geändert', `
      <p class="hinweis" style="margin-top:0">
        Seit dem letzten Abgleich wurde auch anderswo gespeichert. Es wurde nichts überschrieben.
        Wähle, welcher Stand gelten soll — der andere geht dabei verloren.
      </p>
      <table class="konflikt-tabelle">
        <thead><tr><th></th><th>dieses Gerät</th><th>bei GitHub</th></tr></thead>
        <tbody>${felder.map(([n, s]) => zeile(n, { k: staende.meiner[s] }, { k: staende.fern[s] })).join('')}</tbody>
      </table>
      <div class="reihe" style="margin-top:12px">
        <button class="knopf knopf-neon" id="konflikt-meiner">Dieses Gerät gilt</button>
        <button class="knopf knopf-still" id="konflikt-fern">Stand von GitHub gilt</button>
      </div>`, null, null);

    $('#konflikt-meiner').addEventListener('click', fangen(async () => {
      const r = await sync.meinenBehalten(staende.fernKopfSha);
      if (!r.ok) throw new Error(r.fehler);
      dialogSchliessen();
      toast('Stand dieses Geräts übernommen');
      await neuZeichnen();
    }));

    $('#konflikt-fern').addEventListener('click', fangen(async () => {
      if (!confirm('Die Änderungen auf diesem Gerät gehen dabei verloren. Fortfahren?')) return;
      await sync.fernenUebernehmen(staende);
      dialogSchliessen();
      toast('Stand von GitHub übernommen');
      await neuZeichnen();
    }));
  } finally {
    konfliktLaeuft = false;
  }
});

$('#abgleich').addEventListener('click', fangen(async () => {
  if (!sync.hatFernablage()) return;
  const ergebnis = await sync.sichern('Von Hand abgeglichen');
  if (ergebnis.konflikt) return konfliktZeigen();
  if (!ergebnis.ok) throw new Error(ergebnis.fehler);
  toast('Abgeglichen');
}));

/* ---- Aktualisieren ---------------------------------------------------------

   Die Gegenrichtung zum Abgleich-Knopf: erst hoch, was hier offen liegt, dann
   holen, was drueben neu ist. Ohne das bleibt der einzige Weg von Geraet zu
   Geraet die Sicherungsdatei von Hand.                                        */

let holenLaeuft = false;
let letzterAbruf = 0;

const aktualisieren = async ({ still = false } = {}) => {
  if (holenLaeuft || !sync.hatFernablage()) return;
  holenLaeuft = true;
  const knopf = $('#aktualisieren');
  const vorher = knopf.textContent;
  if (!still) { knopf.textContent = '… holt'; knopf.disabled = true; }
  try {
    const ergebnis = await sync.holen();
    letzterAbruf = Date.now();

    if (ergebnis.konflikt) return konfliktZeigen();
    if (!ergebnis.ok) {
      if (still) return;                       // offline im Hintergrund ist keine Meldung wert
      if (ergebnis.grund) return;
      throw new Error(ergebnis.fehler);
    }
    if (ergebnis.neu) {
      await neuZeichnen();
      toast('Neuer Stand übernommen');
    } else if (!still) {
      toast('Stand ist aktuell');
    }
  } finally {
    holenLaeuft = false;
    knopf.textContent = vorher;
    knopf.disabled = false;
  }
};

$('#aktualisieren').addEventListener('click', fangen(() => aktualisieren()));

// Kommt der Reiter zurueck in den Vordergrund, still nachsehen. Die Minute
// Abstand verhindert, dass blosses Fensterwechseln GitHub befragt.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  // Steht noch etwas offen, geht das vor: erst hochschieben, dann nachsehen.
  if (sync.zustand.letzterFehler) return void nachtragen();
  if (Date.now() - letzterAbruf < 60000) return;
  aktualisieren({ still: true }).catch(() => {});
});

// Ein Konflikt beim automatischen Sichern soll nicht still liegen bleiben.
sync.beiKonflikt(() => konfliktZeigen());

// ---------------------------------------------------------------- Navigation

const ansichtWechseln = async (name) => {
  // Ein eigener Reiter hat keine eigene Ansicht, sondern fuellt die eine
  // Listenansicht; welcher gemeint ist, steht in S.eigenReiter.
  const gewaehlt = S.reiter.find((r) => r.id === name);
  const eigen = Boolean(gewaehlt && gewaehlt.typ === 'eigen');
  const abschnitt = eigen ? 'eigen' : name;

  S.ansicht = name;
  S.eigenReiter = eigen ? name : null;
  if (eigen) { S.eigenSuche = ''; S.eigenSort = null; }

  $$('.tab').forEach((t) => t.classList.toggle('aktiv', t.dataset.ansicht === name));
  $$('.ansicht').forEach((a) => a.classList.toggle('versteckt', a.id !== `ansicht-${abschnitt}`));
  // Nur die Startseite laeuft ohne Seitenscrollen — siehe body.start-aktiv im CSS.
  document.body.classList.toggle('start-aktiv', name === 'start');
  if (name === 'start') await startLaden();
  if (name === 'kalender') await monatLaden();
  if (name === 'aufgaben') { await datenLaden(); aufgabenZeichnen(); }
  if (name === 'tsz') await tszLaden();
  if (name === 'finanzen') await finanzenLaden();
  if (name === 'reime') await reimeLaden();
  if (eigen) { $('#eigen-suche').value = ''; await eigenLaden(); }
  if (name === 'suche') { bereicheFuellen(); $('#such-feld').focus(); }
  if (name === 'einstellungen') { await datenLaden(); katZeichnen(); artZeichnen(); await finkatLaden(); ablageZeichnen(); await einstellungenLaden(); }
};

$$('.tab').forEach((tab) => tab.addEventListener('click', fangen(() => ansichtWechseln(tab.dataset.ansicht))));

const datenLaden = async () => {
  const daten = await api('/api/daten');
  S.kategorien = daten.kategorien;
  S.arten = daten.arten || [];
  S.tasks = daten.tasks;
  S.heute = daten.heute;
};

// ---------------------------------------------------------------- Schnelleingabe

const vorschauZeichnen = (v) => {
  S.vorschau = v;
  const kat = kategorie(v.kategorie);
  const teile = [
    `<span class="vp-zeile">Datum</span> <span class="vp-wert">${esc(formatDE(v.datum))}${v.datumBis ? ` bis ${esc(formatDE(v.datumBis))}` : ''}</span>`,
    v.uhrzeit ? `<span class="vp-zeile">Zeit</span> <span class="vp-wert">${esc(v.uhrzeit)} Uhr</span>` : '',
    `<span class="vp-zeile">Text</span> <span class="vp-wert">${esc(v.text || '—')}</span>`,
    kat ? `<span class="vp-zeile">Kategorie</span> <span class="vp-wert">${esc(kat.name)}</span>` : '',
    `<span class="vp-zeile">Priorität</span> <span class="vp-wert">${esc(PRIO_LABEL[v.prioritaet])}</span>`,
    v.istFrist ? '<span class="vp-wert">als Frist markiert</span>' : '',
    v.wiederholung ? `<span class="vp-zeile">Wiederholung</span> <span class="vp-wert">${esc(WDH_LABEL[v.wiederholung.typ])}</span>` : ''
  ].filter(Boolean);

  $('#schnell-vorschau').innerHTML = `
    ${teile.join(' &nbsp;·&nbsp; ')}
    ${v.hinweise.length ? `<div class="vp-hinweis">${v.hinweise.map(esc).join('<br>')}</div>` : ''}
    <div class="reihe">
      <button class="knopf knopf-neon" id="vp-speichern">Speichern</button>
      <button class="knopf knopf-still" id="vp-bearbeiten">Erst bearbeiten</button>
      <button class="knopf knopf-still" id="vp-abbrechen">Verwerfen</button>
    </div>`;
  $('#schnell-vorschau').classList.remove('versteckt');

  $('#vp-speichern').addEventListener('click', fangen(async () => {
    if (!v.text) throw new Error('Ohne Text kann nichts gespeichert werden.');
    await post('/api/eintrag', v);
    vorschauSchliessen();
    $('#schnell-feld').value = '';
    toast('Eintrag gespeichert');
    await neuZeichnen();
  }));
  $('#vp-bearbeiten').addEventListener('click', () => { vorschauSchliessen(); eintragDialog({ ...v, id: null }); });
  $('#vp-abbrechen').addEventListener('click', vorschauSchliessen);
};

const vorschauSchliessen = () => {
  S.vorschau = null;
  $('#schnell-vorschau').classList.add('versteckt');
  $('#schnell-vorschau').innerHTML = '';
};

const schnellPruefen = fangen(async () => {
  const text = $('#schnell-feld').value.trim();
  if (!text) return vorschauSchliessen();
  vorschauZeichnen(await post('/api/schnell', { text }));
});

$('#schnell-knopf').addEventListener('click', schnellPruefen);
$('#schnell-feld').addEventListener('keydown', (e) => { if (e.key === 'Enter') schnellPruefen(); });

// ---------------------------------------------------------------- Zeilenbau

const zeile = (v, optionen = {}) => {
  const klassen = ['zeile'];
  if (v.erledigt) klassen.push('zeile-erledigt');
  else if (optionen.dringend) klassen.push('zeile-dringend');
  else if (v.istFrist) klassen.push('zeile-frist');
  else if (v.prioritaet === 'hoch') klassen.push('zeile-hoch');

  const farbe = katFarbe(v.kategorie);
  const kat = kategorie(v.kategorie);
  const marken = [];
  // Termin, Frist oder Aufgabe — auf einen Blick unterscheidbar.
  const artDaten = S.arten.find((a) => a.id === v.art);
  if (artDaten) marken.push(`<span class="zeile-marke zeile-marke-neon" style="--ton:${esc(artDaten.farbe)}">${esc(artDaten.name)}</span>`);
  if (optionen.marke) marken.push(`<span class="zeile-marke">${esc(optionen.marke)}</span>`);
  if (optionen.herkunft) marken.push(`<span class="zeile-marke">${esc(optionen.herkunft)}</span>`);
  if (kat) marken.push(`<span class="zeile-marke zeile-marke-neon" style="--ton:${esc(kat.farbe)}">${esc(kat.name)}</span>`);
  if (v.wiederkehrend) marken.push('<span class="zeile-marke">Serie</span>');
  if (v.mehrtaegig) marken.push(`<span class="zeile-marke">${esc(formatKurz(v.start))}–${esc(formatKurz(v.ende))}</span>`);

  const zeit = v.uhrzeit ? esc(v.uhrzeit) : (optionen.zeitText ? esc(optionen.zeitText) : '');

  // Fristen aus einer Gemeinde-Akte fuehren in die Akte, nicht in den Eintragsdialog.
  if (v.istGemeinde) {
    return `<div class="${klassen.join(' ')}" data-springe-gemeinde="${esc(v.gemeindeId)}">
      ${zeit ? `<span class="zeile-zeit">${zeit}</span>` : ''}
      <span class="zeile-text">${esc(v.text)}</span>
      ${marken.join(' ')}
    </div>`;
  }

  return `<div class="${klassen.join(' ')}" style="${farbe ? `--kat:${esc(farbe)}` : ''}" data-id="${esc(v.id)}" data-datum="${esc(v.start || v.datum || '')}" data-art="eintrag">
    <button class="zeile-haken" data-haken="1" title="erledigt">${v.erledigt ? '✓' : ''}</button>
    ${zeit ? `<span class="zeile-zeit">${zeit}</span>` : ''}
    <span class="zeile-text">${esc(v.text)}</span>
    ${marken.join(' ')}
  </div>`;
};

const aufgabenZeile = (t) => {
  const klassen = ['zeile'];
  if (t.status === 'erledigt') klassen.push('zeile-erledigt');
  else if (t.prioritaet === 'hoch') klassen.push('zeile-hoch');
  const faellig = t.faellig
    ? `<span class="zeile-marke${t.faellig <= S.heute && t.status !== 'erledigt' ? ' zeile-marke-neon' : ''}" ${t.faellig <= S.heute ? 'style="--ton:var(--neon-koralle)"' : ''}>${esc(formatKurz(t.faellig))}</span>`
    : '';
  /* Die Kachel „Offene Aufgaben" zeigt beide Quellen. Stammt die Zeile aus dem
     Kalender, muss sie sich auch wie ein Kalendereintrag verhalten — Haken und
     Antippen laufen dann über den Eintragsweg statt über den Aufgabenweg. */
  const ausKalender = t.herkunft === 'eintrag';
  const kennzeichen = ausKalender
    ? `data-art="eintrag" data-datum="${esc(t.faellig || '')}"`
    : 'data-art="aufgabe"';

  return `<div class="${klassen.join(' ')}" data-id="${esc(t.id)}" ${kennzeichen}>
    <button class="zeile-haken" data-haken="1" title="erledigt">${t.status === 'erledigt' ? '✓' : ''}</button>
    <span class="zeile-text">${esc(t.titel)}</span>
    ${faellig}
    <span class="zeile-marke">${esc(PRIO_LABEL[t.prioritaet])}</span>
  </div>`;
};

const leer = (text) => `<p class="liste-leer">${esc(text)}</p>`;

// ---------------------------------------------------------------- Startseite

/**
 * Kacheln in ihre Ablage einsortieren und ihr Aussehen setzen. Die Abschnitte
 * selbst bleiben dieselben DOM-Knoten und behalten ihren Inhalt — verschoben
 * wird nur, wo sie haengen. Ausgeblendete wandern zurueck ins Lager, damit
 * leere Spalten einklappen.
 *
 * `--handy` traegt die Handy-Reihenfolge. Es ist bewusst eine eigene Eigenschaft
 * und nicht direkt `order`: die Vollzeile und die Spalten sind Flex-Behaelter,
 * ein gesetztes `order` wuerde also auch am grossen Bildschirm umsortieren und
 * die Paare auseinanderreissen. Zu `order` wird der Wert erst unter 900 Pixeln
 * im CSS, wo das Raster ohnehin zu einem einspaltigen Fluss zusammenfaellt.
 */
/**
 * Kacheln der eigenen Reiter erzeugen und fuellen. Sie stehen nicht im HTML,
 * weil es sie erst gibt, wenn jemand einen Reiter anlegt — und wieder nicht
 * mehr, wenn er ihn entfernt.
 */
const eigenKachelnBauen = (liste) => {
  const lager = $('#kachel-lager');
  const gueltig = new Set(liste.map((k) => k.id));

  for (const alt of $$('[data-kachel^="eigen_"]')) {
    if (!gueltig.has(alt.dataset.kachel)) alt.remove();
  }

  for (const k of liste) {
    let kachel = document.querySelector(`[data-kachel="${k.id}"]`);
    if (!kachel) {
      kachel = document.createElement('section');
      kachel.className = 'block';
      kachel.dataset.kachel = k.id;
      lager.appendChild(kachel);
    }
    kachel.innerHTML = `<h2 class="block-titel">${esc(k.name)}</h2>
      <div class="liste liste-dezent">${k.zeilen.length
    ? k.zeilen.map((z) => `<div class="zeile" data-eigen-sprung="${esc(k.reiterId)}">
            <span class="zeile-text">${esc(z.titel)}</span>
            ${z.neben ? `<span class="zeile-marke">${esc(z.neben)}</span>` : ''}
          </div>`).join('')
    : leer('Noch nichts eingetragen.')}</div>`;
  }
};

const kachelnEinsortieren = () => {
  const layout = S.startseite;
  if (!layout) return;
  const lager = $('#kachel-lager');
  const raster = $('#start-raster');
  const handy = handyReihenfolge(layout.kacheln);

  for (const platz of layout.kacheln) {
    const kachel = document.querySelector(`[data-kachel="${platz.id}"]`);
    if (!kachel) continue;

    const ziel = platz.sichtbar
      ? raster.querySelector(`[data-spalte="${platz.spalte}"]`)
      : lager;
    if (ziel) ziel.appendChild(kachel);

    kachel.classList.toggle('kachel-halb', platz.breite === 'halb' && platz.spalte === 'voll');
    kachel.style.minHeight = platz.hoehe ? `${platz.hoehe}px` : '';
    kachel.style.setProperty('--handy', String(handy.indexOf(platz.id)));
    griffSetzen(kachel, platz.id);
  }

  // Eine leere Randleiste soll keine Spur im Raster hinterlassen.
  for (const [seite, klasse] of [['links', 'ohne-links'], ['rechts', 'ohne-rechts']]) {
    const belegt = layout.kacheln.some((k) => k.sichtbar && k.spalte === seite);
    raster.classList.toggle(klasse, !belegt);
  }
};

/* ---- Ziehgriff --------------------------------------------------------------

   Die gespeicherte Hoehe ist ein Mindestmass. Das Ziehen setzt sie live, das
   Loslassen legt sie ab, ein Doppelklick nimmt sie wieder zurueck. Zeiger-
   ereignisse statt Maus, damit es auch am Stift und am Trackpad funktioniert —
   dieselbe Mechanik wie im Layout-Editor.                                     */

const griffSetzen = (kachel, id) => {
  if (kachel.querySelector(':scope > .kachel-griff')) return;
  const griff = document.createElement('div');
  griff.className = 'kachel-griff';
  griff.title = 'Höhe ziehen — Doppelklick setzt sie zurück';
  kachel.appendChild(griff);

  let start = 0;
  let ausgang = 0;

  griff.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    start = e.clientY;
    ausgang = kachel.getBoundingClientRect().height;
    griff.classList.add('zieht');
    griff.setPointerCapture(e.pointerId);
  });

  griff.addEventListener('pointermove', (e) => {
    if (!griff.classList.contains('zieht')) return;
    const neu = Math.max(MINDESTHOEHE, Math.round(ausgang + (e.clientY - start)));
    kachel.style.minHeight = `${neu}px`;
  });

  const beenden = fangen(async (e) => {
    if (!griff.classList.contains('zieht')) return;
    griff.classList.remove('zieht');
    griff.releasePointerCapture(e.pointerId);
    await hoeheAblegen(id, Math.round(parseFloat(kachel.style.minHeight) || 0));
  });
  griff.addEventListener('pointerup', beenden);
  griff.addEventListener('pointercancel', beenden);

  griff.addEventListener('dblclick', fangen(async () => {
    kachel.style.minHeight = '';
    await hoeheAblegen(id, null);
  }));
};

const hoeheAblegen = async (id, hoehe) => {
  const platz = (S.startseite?.kacheln || []).find((k) => k.id === id);
  if (!platz) return;
  platz.hoehe = hoehe;
  await layoutSichern();
};

/** Kachel ein- oder ausblenden, ohne die Spaltenzuordnung anzufassen. */
const kachelZeigen = (id, zeigen) => {
  const kachel = document.querySelector(`[data-kachel="${id}"]`);
  if (!kachel) return;
  const platz = (S.startseite?.kacheln || []).find((k) => k.id === id);
  // Vom Benutzer ausgeblendete Kacheln bleiben aus, auch wenn Daten da sind.
  kachel.classList.toggle('versteckt', !zeigen || !platz || !platz.sichtbar);
};

/**
 * Eine Gemeinde-Leiste. Rechtsbuendig steht die Zahl offener Aufgaben, wenn es
 * welche gibt, sonst der Stillstand an genau derselben Stelle wie vorher.
 * Ein Klick auf die Leiste klappt die Aufgaben auf, ein Klick auf den Namen
 * fuehrt in die Akte.
 */
const gemeindeLeiste = (g) => {
  const offen = g.aufgaben || [];
  const auf = S.offeneGemeinden.has(g.id) && offen.length > 0;
  const marke = offen.length
    ? `${offen.length} ${offen.length === 1 ? 'Aufgabe' : 'Aufgaben'}`
    : (g.tageStill === null ? 'noch kein Schritt' : `seit ${g.tageStill} Tagen still`);

  const aufgaben = auf ? `<div class="gem-aufgaben">${offen.map((a) => {
    const dringend = a.tageBis !== null && a.tageBis <= 3;
    const datum = a.datum
      ? `<span class="zeile-marke${dringend ? ' zeile-marke-neon' : ''}">${esc(formatKurz(a.datum))}</span>`
      : '<span class="zeile-marke zeile-marke-blass">ohne Datum</span>';
    return `<div class="zeile zeile-klein" data-gem-aufgabe="${esc(a.id)}" data-gemeinde="${esc(g.id)}" data-datum="${esc(a.datum || '')}">
      <button class="zeile-haken" data-gem-haken="1" title="erledigt"></button>
      <span class="zeile-text">${esc(a.text)}</span>
      ${datum}
    </div>`;
  }).join('')}</div>` : '';

  return `<div class="gem-block">
    <div class="zeile gem-leiste${offen.length ? ' gem-leiste-klickbar' : ''}" data-gem-leiste="${esc(g.id)}">
      <span class="gem-pfeil">${offen.length ? (auf ? '▾' : '▸') : '·'}</span>
      <span class="zeile-text" data-springe-gemeinde="${esc(g.id)}">${esc(g.name)}</span>
      <span class="zeile-marke">${esc(marke)}</span>
    </div>
    ${aufgaben}
  </div>`;
};

/* ---- Finanzkachel -----------------------------------------------------------

   Zwei Ansichten auf dieselben Zahlen: jedes Konto einzeln mit einer Summe
   darunter, oder nur die Summe. Die Einzelsummen ergeben immer die Gesamtsumme
   — Buchungen ohne erkannte Bank laufen unter „Sonstige" mit, statt still zu
   fehlen.                                                                      */

const finanzZahlen = (a) => `<div class="kachel-zahlen">
  <div class="kachel-wert"><span class="kachel-label">Einnahmen</span><span class="kachel-zahl kachel-plus">${esc(euro(a.einnahmen))}</span></div>
  <div class="kachel-wert"><span class="kachel-label">Ausgaben</span><span class="kachel-zahl kachel-minus">${esc(euro(a.ausgaben))}</span></div>
  <div class="kachel-wert"><span class="kachel-label">Saldo</span><span class="kachel-zahl ${a.saldo < 0 ? 'kachel-minus' : 'kachel-plus'}">${esc(euro(a.saldo))}</span></div>
</div>`;

const finanzKachelZeichnen = () => {
  const f = S.finanzKachel;
  if (!f) return;
  const ansicht = S.startseite?.finanzenAnsicht === 'gesamt' ? 'gesamt' : 'einzeln';
  $$('#finanz-wahl [data-finanz-ansicht]').forEach((b) => b.classList.toggle('aktiv', b.dataset.finanzAnsicht === ansicht));

  const konten = f.konten || [];
  // Bei nur einem Konto ist die Aufteilung dieselbe Zahl zweimal.
  const einzeln = ansicht === 'einzeln' && konten.length > 1;

  $('#finanz-konten').innerHTML = einzeln
    ? `${konten.map((k) => `<div class="finanz-konto">
        <span class="finanz-konto-name">${esc(k.bank)}</span>
        ${finanzZahlen(k)}
      </div>`).join('')}
      <div class="finanz-konto finanz-konto-summe">
        <span class="finanz-konto-name">Zusammen</span>
        ${finanzZahlen(f)}
      </div>`
    : finanzZahlen(f);
};

$('#finanz-wahl').addEventListener('click', fangen(async (e) => {
  const knopf = e.target.closest('[data-finanz-ansicht]');
  if (!knopf || !S.startseite) return;
  S.startseite.finanzenAnsicht = knopf.dataset.finanzAnsicht;
  finanzKachelZeichnen();
  await layoutSichern();
}));

const startLaden = async () => {
  const d = await api('/api/start');
  S.kategorien = d.kategorien;
  S.arten = d.arten || [];
  S.heute = d.heute;
  if (d.thema) themaSetzen(d.thema);
  kopfleisteZeichnen(d.reiter);
  eigenKachelnBauen(d.eigenKacheln || []);
  if (d.startseite) { S.startseite = d.startseite; kachelnEinsortieren(); }

  $('#heute-datum').textContent = `${TAGE_LANG[wochentagIndex(d.heute)]}, ${formatDE(d.heute)}`;

  kachelZeigen('fristen', d.fristen.length > 0);
  $('#fristen-liste').innerHTML = d.fristen
    .map((f) => zeile(f, {
      dringend: f.tageBis <= 3,
      marke: f.tageBis === 0 ? 'heute fällig' : `noch ${f.tageBis} Tage`,
      zeitText: formatKurz(f.start),
      herkunft: f.herkunft
    }))
    .join('');

  const f = d.finanzen || {};
  kachelZeigen('finanzen', Boolean(f.hatDaten));
  if (f.hatDaten) {
    S.finanzKachel = f;
    $('#finanz-monat').textContent = f.monat;
    finanzKachelZeichnen();
    $('#kachel-hinweis').textContent = f.ohneKategorie
      ? `${f.ohneKategorie} Buchungen ohne Kategorie — antippen führt zu den Finanzen.`
      : `${f.anzahl} Buchungen in diesem Monat.`;
  }

  const gemeinden = d.gemeinden || [];
  kachelZeigen('gemeinden', gemeinden.length > 0);
  $('#still-liste').innerHTML = gemeinden.map(gemeindeLeiste).join('');

  const heuteAlles = [
    ...d.heuteEintraege.map((e) => zeile(e)),
    ...d.heuteAufgaben.map((t) => aufgabenZeile(t))
  ];
  $('#heute-liste').innerHTML = heuteAlles.length ? heuteAlles.join('') : leer('Nichts eingetragen.');
  $('#morgen-liste').innerHTML = d.morgenEintraege.length ? d.morgenEintraege.map((e) => zeile(e)).join('') : leer('Nichts eingetragen.');
  $('#offen-liste').innerHTML = d.offeneAufgaben.length ? d.offeneAufgaben.map(aufgabenZeile).join('') : leer('Keine offenen Aufgaben.');

  // Ueber kachelZeigen wie alle anderen: sonst kaeme die Kachel zurueck, obwohl
  // sie im Editor ausgeblendet wurde.
  kachelZeigen('can', Boolean(d.canKategorie));
  if (d.canKategorie) {
    $('#can-titel').textContent = d.canKategorie.name;
    $('#can-liste').innerHTML = d.canListe.length
      ? d.canListe.map((c) => `<div class="zeile" style="--kat:${esc(d.canKategorie.farbe)}" data-id="${esc(c.id)}" data-datum="${esc(c.datum)}" data-art="eintrag">
          <span class="zeile-zeit">${esc(formatKurz(c.datum))}</span>
          <span class="zeile-text">${esc(c.text)}</span>
          <span class="zeile-marke">${esc(relativ(c.tageHer))}</span>
        </div>`).join('')
      : leer('Noch keine Einträge.');
  }
};

// ---------------------------------------------------------------- Kalender

const monatLaden = async () => {
  const d = await api(`/api/monat?jahr=${S.kalJahr}&monat=${S.kalMonat}`);
  S.monat = d;
  S.heute = d.heute;
  await datenLaden();
  kalenderZeichnen();
};

const kalenderZeichnen = () => {
  const d = S.monat;
  $('#kal-titel').textContent = `${MONATE[S.kalMonat - 1]} ${S.kalJahr}`;

  $('#kal-gitter').innerHTML = d.gitter.map((tag) => {
    const fremd = Number(tag.slice(5, 7)) !== S.kalMonat;
    const eintraege = d.tage[tag] || [];
    const aufgaben = d.aufgaben[tag] || [];
    const klassen = ['kal-tag'];
    if (fremd) klassen.push('kal-tag-fremd');
    if (tag === d.heute) klassen.push('kal-tag-heute');
    if (tag === S.gewaehlterTag) klassen.push('kal-tag-gewaehlt');

    const pillen = [];
    for (const e of eintraege.slice(0, 3)) {
      const p = ['kal-pille'];
      if (e.erledigt) p.push('kal-pille-erledigt');
      else if (e.istFrist) p.push('kal-pille-frist');
      else if (e.prioritaet === 'hoch') p.push('kal-pille-hoch');
      const farbe = katFarbe(e.kategorie);
      const vorn = e.mehrtaegig && !e.ersterTag ? '· ' : '';
      pillen.push(`<div class="${p.join(' ')}" style="${farbe ? `--kat:${esc(farbe)}` : ''}">${vorn}${e.uhrzeit ? `${esc(e.uhrzeit)} ` : ''}${esc(e.text)}</div>`);
    }
    for (const a of aufgaben.slice(0, 2)) {
      pillen.push(`<div class="kal-pille kal-pille-aufgabe">${esc(a.titel)}</div>`);
    }
    const rest = (eintraege.length + aufgaben.length) - pillen.length;

    return `<div class="${klassen.join(' ')}" data-tag="${tag}">
      <span class="kal-tag-nr">${Number(tag.slice(8))}</span>
      ${pillen.join('')}
      ${rest > 0 ? `<span class="kal-mehr">+${rest} weitere</span>` : ''}
    </div>`;
  }).join('');

  if (S.gewaehlterTag) tagZeichnen(S.gewaehlterTag);
};

const tagZeichnen = (tag) => {
  S.gewaehlterTag = tag;
  const eintraege = S.monat.tage[tag] || [];
  const aufgaben = (S.monat.aufgaben[tag] || []).map((a) => S.tasks.find((t) => t.id === a.id)).filter(Boolean);

  $('#tag-block').classList.remove('versteckt');
  $('#tag-titel').innerHTML = `${TAGE_LANG[wochentagIndex(tag)]}, ${formatDE(tag)}
    <span class="block-neben"><button class="knopf knopf-still" id="tag-neu">Eintrag für diesen Tag</button></span>`;

  const alles = [...eintraege.map((e) => zeile(e)), ...aufgaben.map(aufgabenZeile)];
  $('#tag-liste').innerHTML = alles.length ? alles.join('') : leer('Nichts eingetragen.');
  $('#tag-neu').addEventListener('click', () => eintragDialog({ datum: tag }));
};

$('#kal-gitter').addEventListener('click', (e) => {
  const tag = e.target.closest('.kal-tag');
  if (!tag) return;
  tagZeichnen(tag.dataset.tag);
  $$('.kal-tag').forEach((el) => el.classList.toggle('kal-tag-gewaehlt', el.dataset.tag === S.gewaehlterTag));
});

$('#kal-zurueck').addEventListener('click', fangen(() => {
  S.kalMonat -= 1;
  if (S.kalMonat < 1) { S.kalMonat = 12; S.kalJahr -= 1; }
  return monatLaden();
}));

$('#kal-vor').addEventListener('click', fangen(() => {
  S.kalMonat += 1;
  if (S.kalMonat > 12) { S.kalMonat = 1; S.kalJahr += 1; }
  return monatLaden();
}));

$('#kal-heute').addEventListener('click', fangen(() => {
  const jetzt = new Date();
  S.kalJahr = jetzt.getFullYear();
  S.kalMonat = jetzt.getMonth() + 1;
  S.gewaehlterTag = heuteISO();
  return monatLaden();
}));

$('#kal-neu').addEventListener('click', () => eintragDialog({ datum: S.gewaehlterTag || S.heute || heuteISO() }));

// ---------------------------------------------------------------- Aufgaben

const aufgabenZeichnen = () => {
  for (const status of ['offen', 'laeuft', 'erledigt']) {
    const liste = S.tasks
      .filter((t) => t.status === status)
      .sort((a, b) => {
        const rang = { hoch: 0, mittel: 1, gering: 2 };
        const p = rang[a.prioritaet] - rang[b.prioritaet];
        if (p) return p;
        return String(a.faellig || '9999').localeCompare(String(b.faellig || '9999'));
      });
    const ziel = document.querySelector(`[data-liste="${status}"]`);
    ziel.innerHTML = liste.length ? liste.map(aufgabenZeile).join('') : leer('—');
  }
};

$('#aufgabe-neu').addEventListener('click', () => aufgabeDialog({}));

// ---------------------------------------------------------------- Suche

const bereicheFuellen = () => {
  const aktuell = $('#such-bereich').value;
  $('#such-bereich').innerHTML = [
    '<option value="alle">überall</option>',
    '<option value="aufgaben">nur Aufgaben</option>',
    '<option value="dokumente">nur Gemeinde-Dokumente</option>',
    ...S.kategorien.map((k) => `<option value="${esc(k.id)}">nur ${esc(k.name)}</option>`)
  ].join('');
  if (aktuell) $('#such-bereich').value = aktuell;
};

const suchen = fangen(async () => {
  const q = $('#such-feld').value.trim();
  if (!q) {
    $('#such-treffer').innerHTML = '';
    $('#such-info').textContent = '';
    return;
  }
  const d = await api(`/api/suche?q=${encodeURIComponent(q)}&scope=${encodeURIComponent($('#such-bereich').value)}`);
  const teile = [];
  if (d.entries.length) {
    teile.push('<p class="treffer-gruppe">EINTRÄGE — neueste zuerst</p>');
    teile.push(d.entries.map((e) => zeile({
      ...e, start: e.datum, wiederkehrend: Boolean(e.wiederholung), mehrtaegig: Boolean(e.datumBis)
    }, { zeitText: formatKurz(e.datum) })).join(''));
  }
  if (d.tasks.length) {
    teile.push('<p class="treffer-gruppe">AUFGABEN</p>');
    teile.push(d.tasks.map(aufgabenZeile).join(''));
  }
  // Der ausgelesene Text der Gemeinde-Dokumente, mit Ausschnitt um die Fundstelle.
  if ((d.dokumente || []).length) {
    teile.push('<p class="treffer-gruppe">GEMEINDE-DOKUMENTE</p>');
    teile.push(d.dokumente.map((dok) => `
      <div class="zeile zeile-dok" data-springe-gemeinde="${esc(dok.gemeindeId)}">
        <span class="zeile-zeit">${esc(formatKurz(dok.datum))}</span>
        <span class="zeile-text">
          <strong>${esc(dok.name)}</strong>
          <span class="treffer-ausschnitt">${esc(dok.ausschnitt)}</span>
        </span>
        <span class="zeile-marke">${esc(dok.gemeinde)}</span>
      </div>`).join(''));
  }
  const gesamt = d.entries.length + d.tasks.length + (d.dokumente || []).length;
  $('#such-info').textContent = gesamt ? `${gesamt} Treffer für „${q}"` : `Keine Treffer für „${q}"`;
  $('#such-treffer').innerHTML = teile.join('');
});

$('#such-feld').addEventListener('input', () => { clearTimeout(suchen.t); suchen.t = setTimeout(suchen, 180); });
$('#such-bereich').addEventListener('change', suchen);

// ---------------------------------------------------------------- Kategorien

const katZeichnen = () => {
  $('#kat-liste').innerHTML = S.kategorien.map((k) => `
    <div class="kat-zeile" data-id="${esc(k.id)}">
      <input class="feld feld-farbe" type="color" value="${esc(k.farbe)}" data-farbe>
      <input class="feld" type="text" value="${esc(k.name)}" data-name>
      <button class="knopf knopf-still" data-speichern>Sichern</button>
      <button class="knopf knopf-gefahr" data-loeschen>Löschen</button>
    </div>`).join('');
};

$('#kat-liste').addEventListener('click', fangen(async (e) => {
  const zeileEl = e.target.closest('.kat-zeile');
  if (!zeileEl) return;
  const id = zeileEl.dataset.id;
  if (e.target.hasAttribute('data-speichern')) {
    await post('/api/kategorie', { id, name: zeileEl.querySelector('[data-name]').value, farbe: zeileEl.querySelector('[data-farbe]').value });
    await datenLaden();
    katZeichnen();
    toast('Kategorie gesichert');
  }
  if (e.target.hasAttribute('data-loeschen')) {
    await del(`/api/kategorie?id=${encodeURIComponent(id)}`);
    await datenLaden();
    katZeichnen();
    toast('Kategorie gelöscht');
  }
}));

$('#kat-anlegen').addEventListener('click', fangen(async () => {
  const name = $('#kat-name').value.trim();
  if (!name) throw new Error('Name fehlt.');
  await post('/api/kategorie', { name, farbe: $('#kat-farbe').value });
  $('#kat-name').value = '';
  await datenLaden();
  katZeichnen();
  toast('Kategorie angelegt');
}));

// ---- Eintragsarten verwalten ----------------------------------------------

const artZeichnen = () => {
  $('#art-liste').innerHTML = S.arten.map((a) => `
    <div class="kat-zeile" data-id="${esc(a.id)}">
      <input class="feld feld-farbe" type="color" value="${esc(a.farbe || '#34e2e2')}" data-farbe>
      <input class="feld" type="text" value="${esc(a.name)}" data-name>
      <button class="knopf knopf-still" data-speichern>Sichern</button>
      ${a.fest
    ? '<button class="knopf knopf-still" disabled title="fest — die Fristenkachel hängt daran">fest</button>'
    : '<button class="knopf knopf-gefahr" data-loeschen>Löschen</button>'}
    </div>`).join('');
};

$('#art-liste').addEventListener('click', fangen(async (e) => {
  const zeileEl = e.target.closest('.kat-zeile');
  if (!zeileEl) return;
  const id = zeileEl.dataset.id;
  if (e.target.hasAttribute('data-speichern')) {
    await post('/api/art', {
      id, name: zeileEl.querySelector('[data-name]').value, farbe: zeileEl.querySelector('[data-farbe]').value
    });
    await datenLaden();
    artZeichnen();
    toast('Art gesichert');
  }
  if (e.target.hasAttribute('data-loeschen')) {
    // Die Route sperrt das Loeschen, solange Eintraege daran haengen (409).
    await del(`/api/art?id=${encodeURIComponent(id)}`);
    await datenLaden();
    artZeichnen();
    toast('Art gelöscht');
  }
}));

$('#art-anlegen').addEventListener('click', fangen(async () => {
  const name = $('#art-name').value.trim();
  if (!name) throw new Error('Name fehlt.');
  await post('/api/art', { name, farbe: $('#art-farbe').value });
  $('#art-name').value = '';
  await datenLaden();
  artZeichnen();
  toast('Art angelegt');
}));

// ---- Finanzkategorien verwalten -------------------------------------------

const finkatZeichnen = () => {
  $('#finkat-liste').innerHTML = S.finKategorien.length
    ? S.finKategorien.map((k) => `
      <div class="kat-zeile" data-id="${esc(k.id)}">
        <input class="feld feld-farbe" type="color" value="${esc(k.farbe)}" data-farbe>
        <input class="feld" type="text" value="${esc(k.name)}" data-name>
        <button class="knopf knopf-still" data-speichern>Sichern</button>
        <button class="knopf knopf-gefahr" data-loeschen>Löschen</button>
      </div>`).join('')
    : leer('Noch keine Finanzkategorien — sie entstehen beim ersten Import.');
};

const finkatLaden = async () => {
  const d = await api('/api/finanzen');
  S.finKategorien = d.kategorien;
  finkatZeichnen();
};

$('#finkat-liste').addEventListener('click', fangen(async (e) => {
  const zeileEl = e.target.closest('.kat-zeile');
  if (!zeileEl) return;
  const id = zeileEl.dataset.id;
  if (e.target.hasAttribute('data-speichern')) {
    await post('/api/finanzen/kategorie', {
      id, name: zeileEl.querySelector('[data-name]').value, farbe: zeileEl.querySelector('[data-farbe]').value
    });
    await finkatLaden();
    toast('Kategorie gesichert');
  }
  if (e.target.hasAttribute('data-loeschen')) {
    // Der Server sperrt das Loeschen, solange Buchungen daran haengen (409).
    await del(`/api/finanzen/kategorie?id=${encodeURIComponent(id)}`);
    await finkatLaden();
    toast('Kategorie gelöscht');
  }
}));

$('#finkat-anlegen').addEventListener('click', fangen(async () => {
  const name = $('#finkat-name').value.trim();
  if (!name) throw new Error('Name fehlt.');
  await post('/api/finanzen/kategorie', { name, farbe: $('#finkat-farbe').value });
  $('#finkat-name').value = '';
  $('#finkat-farbe').value = naechsteFarbe();
  await finkatLaden();
  toast('Kategorie angelegt');
}));

/* ---- Sicherung als Datei ---------------------------------------------------

   Frueher lag der Bestand als JSON auf der Platte und liess sich einfach
   kopieren. Im Browser gibt es diesen Ordner nicht mehr, und die Daten haengen
   am Browserprofil. Ohne einen Weg heraus waere ein Geraetewechsel eine
   Sackgasse und ein Fehler nicht rueckgaengig zu machen.                     */

const BESTAND_FORMAT = 1;

$('#sich-export').addEventListener('click', fangen(async () => {
  const bestand = { format: BESTAND_FORMAT, erstellt: new Date().toISOString(), dateien: storeAlles() };
  const blob = new Blob([JSON.stringify(bestand, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hddatenbank-sicherung-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  $('#sich-info').textContent = 'Gesichert. Die Datei ist lesbar — bitte entsprechend aufbewahren.';
}));

$('#sich-import').addEventListener('click', () => $('#sich-datei').click());

$('#sich-datei').addEventListener('change', fangen(async (e) => {
  const datei = e.target.files[0];
  e.target.value = '';
  if (!datei) return;

  const roh = JSON.parse(await datei.text());
  const dateien = roh.dateien || roh;   // auch eine nackte Sammlung annehmen
  const zaehlen = (d) => [
    (d['entries.json']?.entries || []).length,
    (d['tasks.json']?.tasks || []).length,
    (d['gemeinden.json']?.gemeinden || []).length,
    (d['finanzen.json']?.buchungen || []).length
  ];
  const [e1, a1, g1, b1] = zaehlen(dateien);
  if (!e1 && !a1 && !g1 && !b1) throw new Error('Die Datei enthält keinen erkennbaren Bestand.');

  const [e0, a0, g0, b0] = zaehlen(storeAlles());
  const frage = `Einlesen ersetzt den gesamten jetzigen Bestand.\n\n`
    + `jetzt:  ${e0} Einträge, ${a0} Aufgaben, ${g0} Gemeinden, ${b0} Buchungen\n`
    + `danach: ${e1} Einträge, ${a1} Aufgaben, ${g1} Gemeinden, ${b1} Buchungen\n\nFortfahren?`;
  if (!confirm(frage)) return;

  await sync.bestandErsetzen(dateien);
  $('#sich-info').textContent = `Eingelesen: ${e1} Einträge, ${a1} Aufgaben, ${g1} Gemeinden, ${b1} Buchungen.`;
  toast('Bestand eingelesen');
  await neuZeichnen();
}));

// ---- Passwort und Fernablage ----------------------------------------------

$('#pin-aendern').addEventListener('click', fangen(async () => {
  const neu = $('#pin-neu').value;
  if (neu !== $('#pin-neu2').value) throw new Error('Die beiden Passwörter stimmen nicht überein.');
  if (!confirm('Passwort wirklich ändern? Ohne das neue Passwort sind die Daten nicht mehr lesbar — es gibt kein Zurücksetzen.')) return;

  const ergebnis = await sync.passwortWechseln(neu);
  if (!ergebnis.ok) throw new Error(ergebnis.fehler);
  $('#pin-neu').value = '';
  $('#pin-neu2').value = '';
  $('#pin-info').textContent = 'Passwort geändert, alle Daten neu verschlüsselt.';
  toast('Passwort geändert');
}));

const ablageZeichnen = () => {
  const a = ablageHolen();
  $('#ab-besitzer').value = a ? a.besitzer : '';
  $('#ab-repo').value = a ? a.repo : '';
  $('#ab-token').value = '';
  $('#ab-pin').value = '';
  $('#ab-token').placeholder = a ? 'hinterlegt — leer lassen, um ihn zu behalten' : 'Zugriffsschlüssel';
  $('#ab-info').textContent = a
    ? `Abgleich mit ${a.besitzer}/${a.repo}.`
    : 'Kein Abgleich eingerichtet. Die Daten liegen nur auf diesem Gerät.';
  $('#ab-loesen').classList.toggle('versteckt', !a);
};

/**
 * Im Repository liegt schon ein lesbarer Bestand. Beide Staende gegenueber-
 * stellen und entscheiden lassen. Rueckgabe: 'meiner', 'fern' oder null
 * (abgebrochen — dann wurde weder geschrieben noch etwas eingerichtet).
 */
const verbindenEntscheiden = (dort) => new Promise((aufloesen) => {
  const felder = [['Einträge', 'eintraege'], ['Aufgaben', 'aufgaben'], ['Gemeinden', 'gemeinden'], ['Buchungen', 'buchungen']];
  const zeile = ([name, s]) => {
    const anders = dort.meiner[s] !== dort.fern[s] ? ' class="konflikt-anders"' : '';
    return `<tr><td>${esc(name)}</td><td${anders}>${dort.meiner[s]}</td><td${anders}>${dort.fern[s]}</td></tr>`;
  };

  dialogOeffnen('Im Repository liegen bereits Daten', `
    <p class="hinweis" style="margin-top:0">
      Das Passwort passt, der Bestand ist also deiner. Es wurde noch nichts geschrieben.
      Wähle, welcher Stand künftig gilt — der andere geht dabei verloren.
    </p>
    <table class="konflikt-tabelle">
      <thead><tr><th></th><th>dieses Gerät</th><th>bei GitHub</th></tr></thead>
      <tbody>${felder.map(zeile).join('')}</tbody>
    </table>
    <div class="reihe" style="margin-top:12px">
      <button class="knopf knopf-neon" id="verb-fern">Stand von GitHub übernehmen</button>
      <button class="knopf knopf-still" id="verb-meiner">Dieses Gerät hochschieben</button>
    </div>`, null, null);

  let beantwortet = false;
  const antworten = (wahl) => { if (beantwortet) return; beantwortet = true; dialogSchliessen(); aufloesen(wahl); };

  $('#verb-fern').addEventListener('click', () => antworten('fern'));
  $('#verb-meiner').addEventListener('click', () => {
    if (!confirm('Der Stand bei GitHub geht dabei verloren. Fortfahren?')) return;
    antworten('meiner');
  });
  // Wegklicken oder Escape heisst: nichts tun.
  $('#dialog').addEventListener('click', (e) => { if (e.target.id === 'dialog') antworten(null); }, { once: true });
  $('#dialog-zu').addEventListener('click', () => antworten(null), { once: true });
});

$('#ab-sichern').addEventListener('click', fangen(async () => {
  const alt = ablageHolen();
  const besitzer = $('#ab-besitzer').value.trim();
  const repo = $('#ab-repo').value.trim();
  const token = $('#ab-token').value.trim() || (alt ? alt.token : '');
  const aktuellesPasswort = $('#ab-pin').value;
  if (!besitzer || !repo || !token) throw new Error('Kontoname, Repository und Zugriffsschlüssel werden alle drei gebraucht.');
  if (!aktuellesPasswort) throw new Error('Ohne dein Passwort lässt sich nicht prüfen, was im Repository liegt.');

  const geprueft = await github.pruefen({ token, besitzer, repo });
  if (geprueft.warnung && !confirm(`${geprueft.warnung}\n\nTrotzdem einrichten?`)) return;

  const ablage = { besitzer, repo, token, zweig: geprueft.zweig };

  /* Erst nachsehen, dann schreiben. Liegt drueben schon ein Bestand, wuerde ein
     blindes Hochschieben ihn ueberschreiben — und genau das faellt erst auf,
     wenn die Daten weg sind. Es wird hier nur gelesen. */
  $('#ab-info').textContent = 'Verbindung steht. Sehe nach, was im Repository liegt …';
  const dort = await sync.fernErkunden({ ablage, passwort: aktuellesPasswort });

  if (!dort.leer && !dort.lesbar) {
    $('#ab-info').textContent = '';
    throw new Error('Im Repository liegen bereits Daten, die zu diesem Passwort nicht passen. '
      + 'Es wurde nichts verändert. Melde dich mit dem Passwort an, das zu diesen Daten gehört, '
      + 'oder wähle ein leeres Repository.');
  }

  if (!dort.leer && dort.lesbar) {
    const entschieden = await verbindenEntscheiden(dort);
    if (!entschieden) { $('#ab-info').textContent = ''; return; }

    ablageSetzen(ablage, $('#ab-merken').checked);
    sync.zustand.ablage = ablage;

    if (entschieden === 'fern') {
      await sync.fernUebernehmen({ ...dort, kopfSha: dort.kopfSha });
      ablageZeichnen();
      toast('Stand von GitHub übernommen');
      await neuZeichnen();
      return;
    }
    // 'meiner': auf dem fremden Kopf aufsetzen, damit der Ref-Wechsel durchgeht.
    const durchgesetzt = await sync.meinenBehalten(dort.kopfSha);
    if (!durchgesetzt.ok) {
      ablageSetzen(alt, true);
      sync.zustand.ablage = alt;
      throw new Error(durchgesetzt.fehler);
    }
    ablageZeichnen();
    toast('Abgleich eingerichtet, Stand dieses Geräts gilt');
    return;
  }

  // Ab jetzt verlassen die Daten das Geraet — das Startpasswort reicht nicht mehr.
  $('#ab-info').textContent = 'Verbindung steht. Prüfe das Passwort …';
  ablageSetzen(ablage, $('#ab-merken').checked);
  sync.zustand.ablage = ablage;

  const ergebnis = await sync.sichern('Abgleich eingerichtet');
  if (!ergebnis.ok) {
    ablageSetzen(alt, true);
    sync.zustand.ablage = alt;
    throw new Error(ergebnis.fehler);
  }
  ablageZeichnen();
  toast('Abgleich eingerichtet');
  $('#pin-info').textContent = 'Wichtig: Das Passwort schützt jetzt Daten außerhalb dieses Geräts. '
    + 'Wechsle es unten auf mindestens 12 Zeichen, falls noch das Startpasswort gesetzt ist.';
}));

$('#ab-loesen').addEventListener('click', fangen(async () => {
  if (!confirm('Abgleich lösen? Die Daten bleiben auf diesem Gerät und im Repository liegen, werden aber nicht mehr abgeglichen.')) return;
  ablageSetzen(null);
  sync.zustand.ablage = null;
  ablageZeichnen();
  toast('Abgleich gelöst');
}));

// ---------------------------------------------------------------- Dialog

let dialogSpeichern = null;
let dialogLoeschen = null;

const dialogOeffnen = (titel, inhalt, speichern, loeschen) => {
  $('#dialog-titel').textContent = titel;
  $('#dialog-inhalt').innerHTML = inhalt;
  $('#dialog').classList.remove('versteckt');
  $('#dialog-loeschen').classList.toggle('versteckt', !loeschen);
  dialogSpeichern = speichern;
  dialogLoeschen = loeschen;
  const erstes = $('#dialog-inhalt').querySelector('input, textarea, select');
  if (erstes) erstes.focus();
};

const dialogSchliessen = () => {
  $('#dialog').classList.add('versteckt');
  $('#dialog-inhalt').innerHTML = '';
  dialogSpeichern = null;
  dialogLoeschen = null;
};

$('#dialog-zu').addEventListener('click', dialogSchliessen);
$('#dialog').addEventListener('click', (e) => { if (e.target.id === 'dialog') dialogSchliessen(); });
$('#dialog-speichern').addEventListener('click', fangen(async () => { if (dialogSpeichern) await dialogSpeichern(); }));
$('#dialog-loeschen').addEventListener('click', fangen(async () => { if (dialogLoeschen) await dialogLoeschen(); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#dialog').classList.contains('versteckt')) dialogSchliessen(); });

const wahlFeld = (name, werte, aktiv, toene = {}) => `
  <div class="wahl" data-wahl="${name}">
    ${werte.map(([wert, label]) => `<button type="button" data-wert="${esc(wert)}" class="${wert === aktiv ? 'aktiv' : ''}" style="${toene[wert] ? `--ton:${toene[wert]}` : ''}">${esc(label)}</button>`).join('')}
  </div>`;

$('#dialog-inhalt').addEventListener('click', (e) => {
  const knopf = e.target.closest('[data-wert]');
  if (!knopf) return;
  const gruppe = knopf.closest('[data-wahl]');
  [...gruppe.querySelectorAll('[data-wert]')].forEach((b) => b.classList.toggle('aktiv', b === knopf));
});

const wahlWert = (name) => {
  const aktiv = $(`[data-wahl="${name}"] .aktiv`);
  return aktiv ? aktiv.dataset.wert : null;
};

const PRIO_TOENE = { gering: 'var(--neon-cyan)', mittel: 'var(--neon-amber)', hoch: 'var(--neon-koralle)' };

/* ---- Listen, die sich selbst verwalten -------------------------------------

   Kategorie und Art bekommen im Auswahlfeld ein "+ neu …" — dasselbe Muster,
   das bei den Finanzkategorien schon laeuft. Statt `window.prompt` klappt eine
   Zeile unter dem Feld auf: `prompt` sieht am Telefon schlecht aus und
   erscheint in eingebetteten Browsern manchmal gar nicht.

   Entfernt wird nicht hier, sondern in den Einstellungen. Eine Loeschfunktion
   direkt neben der taeglichen Auswahl ist eine Falle, besonders am Handy.     */

const neuZeileFragen = (frage, feld) => new Promise((auf) => {
  const zeile = document.createElement('div');
  zeile.className = 'neu-zeile';
  zeile.innerHTML = `<input class="feld" type="text" placeholder="${esc(frage)}">
    <button type="button" class="knopf knopf-neon" data-neu-ok>Anlegen</button>
    <button type="button" class="knopf knopf-still" data-neu-ab>Abbrechen</button>`;
  feld.insertAdjacentElement('afterend', zeile);

  const eingabe = zeile.querySelector('input');
  const fertig = (wert) => { zeile.remove(); auf(wert); };
  zeile.querySelector('[data-neu-ok]').addEventListener('click', () => fertig(eingabe.value.trim() || null));
  zeile.querySelector('[data-neu-ab]').addEventListener('click', () => fertig(null));
  eingabe.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); fertig(eingabe.value.trim() || null); }
    // Escape darf nur diese Zeile schliessen, nicht den ganzen Dialog.
    if (ev.key === 'Escape') { ev.stopPropagation(); fertig(null); }
  });
  eingabe.focus();
});

const NEON_REIHE_KAL = ['#34e2e2', '#3ddc84', '#ff5fd2', '#ffb454', '#a988ff', '#ff7a6b'];

const NEU_QUELLEN = {
  kat: {
    frage: 'Name der neuen Kategorie',
    liste: () => S.kategorien,
    pfad: '/api/kategorie',
    feld: 'kategorie',
    leer: 'ohne',
    text: '+ neue Kategorie …'
  },
  art: {
    frage: 'Name der neuen Art',
    liste: () => S.arten,
    pfad: '/api/art',
    feld: 'art',
    leer: null,
    text: '+ neue Art …'
  }
};

const neuOptionen = (quelle, gewaehlt) => {
  const q = NEU_QUELLEN[quelle];
  return `${q.leer ? `<option value="">${esc(q.leer)}</option>` : ''}
    ${q.liste().map((k) => `<option value="${esc(k.id)}" ${k.id === gewaehlt ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
    <option value="${NEU_WERT}">${esc(q.text)}</option>`;
};

const neuFeldBehandeln = async (feld) => {
  const quelle = feld.dataset.neufeld;
  const q = NEU_QUELLEN[quelle];
  if (!q) return;
  if (feld.value !== NEU_WERT) { feld.dataset.vorher = feld.value; return; }

  const zurueck = feld.dataset.vorher || '';
  const name = await neuZeileFragen(q.frage, feld);
  if (!name) { feld.value = zurueck; return; }

  const farbe = NEON_REIHE_KAL[q.liste().length % NEON_REIHE_KAL.length];
  const antwort = await post(q.pfad, { name, farbe });
  const neu = antwort[q.feld];
  if (neu) q.liste().push(neu);

  feld.innerHTML = neuOptionen(quelle, neu ? neu.id : zurueck);
  feld.value = neu ? neu.id : zurueck;
  feld.dataset.vorher = feld.value;
  toast(quelle === 'art' ? 'Art angelegt' : 'Kategorie angelegt');
};

document.addEventListener('change', fangen(async (e) => {
  const feld = e.target.closest('[data-neufeld]');
  if (feld) await neuFeldBehandeln(feld);
}));

const eintragDialog = (vorgabe) => {
  const e = {
    id: null, datum: S.heute || heuteISO(), datumBis: null, uhrzeit: null, text: '',
    kategorie: null, art: null, prioritaet: 'mittel', istFrist: false, wiederholung: null, ...vorgabe
  };
  // Ohne Angabe: mit Uhrzeit ist es ein Termin, ohne eine Aufgabe.
  const art = e.art || (e.istFrist ? 'art_frist' : (e.uhrzeit ? 'art_termin' : 'art_aufgabe'));

  const inhalt = `
    <div class="dialog-feld">
      <label>Text</label>
      <input class="feld" id="d-text" type="text" value="${esc(e.text)}" placeholder="Worum geht es?">
    </div>
    <div class="dialog-paar">
      <div class="dialog-feld"><label>Datum</label><input class="feld" id="d-datum" type="date" value="${esc(e.datum)}"></div>
      <div class="dialog-feld"><label>bis (optional, mehrtägig)</label><input class="feld" id="d-bis" type="date" value="${esc(e.datumBis || '')}"></div>
    </div>
    <div class="dialog-paar">
      <div class="dialog-feld"><label>Uhrzeit (optional)</label><input class="feld" id="d-zeit" type="time" value="${esc(e.uhrzeit || '')}"></div>
      <div class="dialog-feld"><label>Art</label>
        <select class="feld" id="d-art" data-neufeld="art" data-vorher="${esc(art)}">${neuOptionen('art', art)}</select>
      </div>
    </div>
    <div class="dialog-feld"><label>Kategorie</label>
      <select class="feld" id="d-kat" data-neufeld="kat" data-vorher="${esc(e.kategorie || '')}">${neuOptionen('kat', e.kategorie)}</select>
    </div>
    <div class="dialog-feld"><label>Priorität</label>
      ${wahlFeld('prio', [['gering', 'gering'], ['mittel', 'mittel'], ['hoch', 'hoch']], e.prioritaet, PRIO_TOENE)}
    </div>
    <div class="dialog-feld"><label>Wiederholung</label>
      ${wahlFeld('wdh', [['', 'keine'], ['taeglich', 'täglich'], ['woechentlich', 'wöchentlich'], ['monatlich', 'monatlich'], ['jaehrlich', 'jährlich']], e.wiederholung ? e.wiederholung.typ : '')}
    </div>
    <div class="dialog-paar">
      <div class="dialog-feld"><label>jede(n) … (Intervall)</label><input class="feld" id="d-intervall" type="number" min="1" max="52" value="${e.wiederholung ? e.wiederholung.intervall : 1}"></div>
      <div class="dialog-feld"><label>Serie endet am (optional)</label><input class="feld" id="d-wdhbis" type="date" value="${esc(e.wiederholung && e.wiederholung.bis ? e.wiederholung.bis : '')}"></div>
    </div>
    <p class="hinweis" style="margin:0">Ein Eintrag der Art „Frist" erscheint 14 Tage vorher auf der Startseite,
      einer der Art „Aufgabe" unter den offenen Aufgaben.</p>`;

  dialogOeffnen(e.id ? 'Eintrag bearbeiten' : 'Neuer Eintrag', inhalt, async () => {
    const typ = wahlWert('wdh');
    await post('/api/eintrag', {
      id: e.id,
      text: $('#d-text').value,
      datum: $('#d-datum').value,
      datumBis: $('#d-bis').value || null,
      uhrzeit: $('#d-zeit').value || null,
      kategorie: $('#d-kat').value && $('#d-kat').value !== NEU_WERT ? $('#d-kat').value : null,
      art: $('#d-art').value && $('#d-art').value !== NEU_WERT ? $('#d-art').value : null,
      prioritaet: wahlWert('prio'),
      wiederholung: typ ? { typ, intervall: Number($('#d-intervall').value) || 1, bis: $('#d-wdhbis').value || null } : null
    });
    dialogSchliessen();
    toast('Gespeichert');
    await neuZeichnen();
  }, e.id ? async () => {
    await del(`/api/eintrag?id=${encodeURIComponent(e.id)}`);
    dialogSchliessen();
    toast('Gelöscht');
    await neuZeichnen();
  } : null);
};

const aufgabeDialog = (vorgabe) => {
  const t = { id: null, titel: '', notiz: '', status: 'offen', prioritaet: 'mittel', faellig: null, ...vorgabe };

  const inhalt = `
    <div class="dialog-feld"><label>Titel</label><input class="feld" id="a-titel" type="text" value="${esc(t.titel)}"></div>
    <div class="dialog-feld"><label>Notiz</label><textarea class="feld" id="a-notiz" rows="4">${esc(t.notiz)}</textarea></div>
    <div class="dialog-feld"><label>Status</label>
      ${wahlFeld('status', [['offen', 'Offen'], ['laeuft', 'Läuft'], ['erledigt', 'Erledigt']], t.status,
    { offen: 'var(--neon-cyan)', laeuft: 'var(--neon-amber)', erledigt: 'var(--neon-gruen)' })}
    </div>
    <div class="dialog-feld"><label>Priorität</label>
      ${wahlFeld('prio', [['gering', 'gering'], ['mittel', 'mittel'], ['hoch', 'hoch']], t.prioritaet, PRIO_TOENE)}
    </div>
    <div class="dialog-feld"><label>Fällig am (optional — erscheint dann im Kalender)</label>
      <input class="feld" id="a-faellig" type="date" value="${esc(t.faellig || '')}"></div>`;

  dialogOeffnen(t.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe', inhalt, async () => {
    await post('/api/aufgabe', {
      id: t.id,
      titel: $('#a-titel').value,
      notiz: $('#a-notiz').value,
      status: wahlWert('status'),
      prioritaet: wahlWert('prio'),
      faellig: $('#a-faellig').value || null
    });
    dialogSchliessen();
    toast('Gespeichert');
    await neuZeichnen();
  }, t.id ? async () => {
    await del(`/api/aufgabe?id=${encodeURIComponent(t.id)}`);
    dialogSchliessen();
    toast('Gelöscht');
    await neuZeichnen();
  } : null);
};

// ---------------------------------------------------------------- Klicks auf Zeilen

document.addEventListener('click', fangen(async (e) => {
  // Eine Zeile in der Kachel eines eigenen Reiters fuehrt in diesen Reiter.
  const eigenSprung = e.target.closest('[data-eigen-sprung]');
  if (eigenSprung) {
    await ansichtWechseln(eigenSprung.dataset.eigenSprung);
    return;
  }

  const ansichtSprung = e.target.closest('[data-ansicht-sprung]');
  if (ansichtSprung) {
    await ansichtWechseln(ansichtSprung.dataset.ansichtSprung);
    return;
  }

  const sprung = e.target.closest('[data-springe-gemeinde]');
  if (sprung) {
    S.akteId = sprung.dataset.springeGemeinde;
    await ansichtWechseln('tsz');
    return;
  }

  // Aufgabe direkt aus der Gemeinden-Kachel abhaken.
  const gemHaken = e.target.closest('[data-gem-haken]');
  if (gemHaken) {
    const aufgabe = gemHaken.closest('[data-gem-aufgabe]');
    await post('/api/gemeinde/frist', {
      gemeindeId: aufgabe.dataset.gemeinde,
      id: aufgabe.dataset.gemAufgabe,
      text: aufgabe.querySelector('.zeile-text').textContent,
      datum: aufgabe.dataset.datum || null, // Datum erhalten, nicht beim Abhaken loeschen
      erledigt: true
    });
    await startLaden();
    toast('Erledigt');
    return;
  }

  const leiste = e.target.closest('[data-gem-leiste]');
  if (leiste) {
    const id = leiste.dataset.gemLeiste;
    if (S.offeneGemeinden.has(id)) S.offeneGemeinden.delete(id);
    else S.offeneGemeinden.add(id);
    await startLaden();
    return;
  }

  const zeileEl = e.target.closest('.zeile');
  if (!zeileEl || !zeileEl.dataset.art) return;

  const haken = e.target.closest('[data-haken]');
  if (haken) {
    e.stopPropagation();
    if (zeileEl.dataset.art === 'aufgabe') {
      const t = S.tasks.find((x) => x.id === zeileEl.dataset.id);
      if (!t) return;
      await post('/api/aufgabe', { ...t, status: t.status === 'erledigt' ? 'offen' : 'erledigt' });
    } else {
      const erledigt = zeileEl.classList.contains('zeile-erledigt');
      await post('/api/eintrag/erledigt', { id: zeileEl.dataset.id, datum: zeileEl.dataset.datum, wert: !erledigt });
    }
    await neuZeichnen();
    return;
  }

  if (zeileEl.dataset.art === 'aufgabe') {
    const t = S.tasks.find((x) => x.id === zeileEl.dataset.id);
    if (t) aufgabeDialog(t);
    return;
  }

  const daten = await api('/api/daten');
  const eintrag = daten.entries.find((x) => x.id === zeileEl.dataset.id);
  if (eintrag) eintragDialog(eintrag);
}));

// ---------------------------------------------------------------- Tierschutzzentrum

const STAND_TON = {
  erstkontakt: 'var(--neon-cyan)',
  gespraech: 'var(--neon-violett)',
  antrag: 'var(--neon-amber)',
  zusage: 'var(--neon-gruen)',
  absage: 'var(--text-still)'
};

const tszLaden = async () => {
  const d = await api('/api/gemeinden');
  S.gemeinden = d.gemeinden;
  S.staende = d.staende;
  S.heute = d.heute;
  if (S.akteId && S.gemeinden.some((g) => g.id === S.akteId)) akteZeichnen();
  else { S.akteId = null; uebersichtZeichnen(); }
};

const standName = (id) => (S.staende.find((s) => s.id === id) || { name: id }).name;

const uebersichtZeichnen = () => {
  $('#tsz-uebersicht').classList.remove('versteckt');
  $('#tsz-akte').classList.add('versteckt');
  $('#tsz-zurueck').classList.add('versteckt');
  $('#tsz-titel').textContent = 'Tierschutzzentrum';

  if (!S.gemeinden.length) {
    $('#tsz-uebersicht').innerHTML = `<p class="liste-leer">Noch keine Gemeinde angelegt. Über „Neue Gemeinde" die erste Akte anlegen.</p>`;
    return;
  }

  $('#tsz-uebersicht').innerHTML = S.gemeinden.map((g) => {
    const still = g.tageStill === null
      ? 'noch kein Schritt festgehalten'
      : (g.tageStill === 0 ? 'heute zuletzt' : `seit ${g.tageStill} Tagen keine Bewegung`);
    const lange = g.tageStill === null || g.tageStill >= 21;
    const frist = g.naechsteFrist
      ? `<div class="karte-frist">Frist ${esc(formatDE(g.naechsteFrist.datum))} — ${esc(g.naechsteFrist.text)}</div>`
      : '';
    const offen = g.offeneAufgaben
      ? ` · ${g.offeneAufgaben} ${g.offeneAufgaben === 1 ? 'offene Aufgabe' : 'offene Aufgaben'}`
      : '';
    return `<article class="karte" data-gemeinde="${esc(g.id)}" style="--ton:${STAND_TON[g.stand] || 'var(--rand)'}">
      <div class="karte-kopf">
        <h3 class="karte-titel">${esc(g.name)}</h3>
        <span class="zeile-marke zeile-marke-neon" style="--ton:${STAND_TON[g.stand] || 'var(--rand)'}">${esc(standName(g.stand))}</span>
      </div>
      ${g.ansprechpartner ? `<div class="karte-zeile">${esc(g.ansprechpartner)}</div>` : ''}
      ${g.letzterSchritt ? `<div class="karte-zeile karte-still">zuletzt: ${esc(g.letzterSchritt)}</div>` : ''}
      <div class="karte-zeile ${lange ? 'karte-warnung' : 'karte-still'}">${esc(still)}</div>
      ${frist}
      <div class="karte-fuss">${g.anzahlSchritte} ${g.anzahlSchritte === 1 ? 'Schritt' : 'Schritte'} · ${g.anzahlDokumente} ${g.anzahlDokumente === 1 ? 'Dokument' : 'Dokumente'}${offen}</div>
    </article>`;
  }).join('');
};

$('#tsz-uebersicht').addEventListener('click', fangen(async (e) => {
  const karte = e.target.closest('[data-gemeinde]');
  if (!karte) return;
  S.akteId = karte.dataset.gemeinde;
  akteZeichnen();
}));

$('#tsz-zurueck').addEventListener('click', () => { S.akteId = null; uebersichtZeichnen(); });
$('#tsz-neu').addEventListener('click', () => gemeindeDialog({}));

const akteZeichnen = () => {
  const g = S.gemeinden.find((x) => x.id === S.akteId);
  if (!g) { S.akteId = null; return uebersichtZeichnen(); }

  $('#tsz-uebersicht').classList.add('versteckt');
  $('#tsz-akte').classList.remove('versteckt');
  $('#tsz-zurueck').classList.remove('versteckt');
  $('#tsz-titel').textContent = g.name;

  const verlauf = [...(g.verlauf || [])].sort((a, b) => (a.datum < b.datum ? 1 : -1));
  // Datierte zuerst nach Datum, undatierte ans Ende. Ein Datum ist freiwillig.
  const aufgaben = [...(g.fristen || [])].sort((a, b) => {
    if (a.datum && b.datum) return a.datum.localeCompare(b.datum);
    if (a.datum) return -1;
    if (b.datum) return 1;
    return 0;
  });
  const richtung = { raus: '→ verschickt', rein: '← erhalten', intern: '· intern' };

  $('#tsz-akte').innerHTML = `
    <section class="block">
      <h2 class="block-titel">Stammdaten
        <span class="block-neben"><button class="knopf knopf-still" data-tat="stamm">Bearbeiten</button></span>
      </h2>
      <div class="stamm">
        <div><span class="stamm-label">Stand</span><span class="zeile-marke zeile-marke-neon" style="--ton:${STAND_TON[g.stand]}">${esc(standName(g.stand))}</span></div>
        <div><span class="stamm-label">Ansprechpartner</span>${esc(g.ansprechpartner || '—')}</div>
        <div><span class="stamm-label">Kontakt</span>${esc(g.kontakt || '—')}</div>
      </div>
      ${g.notiz ? `<p class="stamm-notiz">${esc(g.notiz)}</p>` : ''}
    </section>

    <section class="block">
      <h2 class="block-titel">Verlauf
        <span class="block-neben"><button class="knopf knopf-still" data-tat="verlauf-neu">Schritt festhalten</button></span>
      </h2>
      <div class="liste">
        ${verlauf.length ? verlauf.map((v) => `
          <div class="zeile" data-tat="verlauf" data-id="${esc(v.id)}">
            <span class="zeile-zeit">${esc(formatKurz(v.datum))}</span>
            <span class="zeile-text">${esc(v.text)}</span>
            <span class="zeile-marke">${esc(richtung[v.richtung] || v.richtung)}</span>
          </div>`).join('') : leer('Noch nichts festgehalten.')}
      </div>
    </section>

    <section class="block">
      <h2 class="block-titel">Aufgaben
        <span class="block-neben"><button class="knopf knopf-still" data-tat="frist-neu">Aufgabe anlegen</button></span>
      </h2>
      <div class="liste">
        ${aufgaben.length ? aufgaben.map((f) => {
    // Ohne Datum gibt es weder Dringlichkeit noch Restlaufzeit.
    const tage = f.datum ? Math.round((new Date(f.datum) - new Date(S.heute)) / 86400000) : null;
    const klasse = f.erledigt ? 'zeile-erledigt'
      : (tage === null ? '' : (tage <= 3 ? 'zeile-dringend' : (tage <= 14 ? 'zeile-frist' : '')));
    const marke = f.erledigt ? 'erledigt'
      : (tage === null ? 'ohne Datum' : (tage < 0 ? `${Math.abs(tage)} Tage überfällig` : `noch ${tage} Tage`));
    return `<div class="zeile ${klasse}" data-tat="frist" data-id="${esc(f.id)}">
            <span class="zeile-zeit">${esc(formatKurz(f.datum))}</span>
            <span class="zeile-text">${esc(f.text)}</span>
            <span class="zeile-marke${tage === null && !f.erledigt ? ' zeile-marke-blass' : ''}">${esc(marke)}</span>
          </div>`;
  }).join('') : leer('Keine Aufgabe hinterlegt.')}
      </div>
    </section>

    <section class="block">
      <h2 class="block-titel">Dokumente
        <span class="block-neben"><button class="knopf knopf-still" data-tat="datei-neu">PDF einlesen</button></span>
      </h2>
      <input type="file" id="datei-feld" class="versteckt" accept="application/pdf" multiple>
      <p class="hinweis" style="margin-top:0">
        Das PDF wird gelesen und sofort verworfen, gespeichert wird nur der Text. Der ist
        danach durchsuchbar. Eingescannte Schreiben haben keine Textebene und liefern nichts.
      </p>
      <div class="liste">
        ${(g.dokumente || []).length ? g.dokumente.map((d) => `
          <div class="zeile dok-zeile ${d.leer ? 'zeile-warnung' : ''}" data-dok="${esc(d.id)}">
            <span class="zeile-zeit">${esc(formatKurz(d.datum))}</span>
            <span class="zeile-text">${esc(d.name)}</span>
            <span class="zeile-marke">${d.leer ? 'kein Text erkannt' : `${(d.text || '').length} Zeichen`}</span>
            <span class="zeile-marke" data-dok-weg="${esc(d.id)}">löschen</span>
          </div>
          <pre class="dok-text versteckt" data-dok-text="${esc(d.id)}">${esc(d.text || '')}</pre>`).join('')
    : leer('Noch kein Dokument eingelesen.')}
      </div>
    </section>

    <div class="reihe"><button class="knopf knopf-gefahr" data-tat="gemeinde-weg">Akte löschen</button></div>`;
};

$('#tsz-akte').addEventListener('click', fangen(async (e) => {
  const g = S.gemeinden.find((x) => x.id === S.akteId);
  if (!g) return;

  const weg = e.target.closest('[data-dok-weg]');
  if (weg) {
    const name = (g.dokumente.find((d) => d.id === weg.dataset.dokWeg) || {}).name || 'dieses Dokument';
    if (!confirm(`Den Text von „${name}" wirklich löschen?`)) return;
    await del(`/api/gemeinde/dokument?gemeinde=${encodeURIComponent(g.id)}&id=${encodeURIComponent(weg.dataset.dokWeg)}`);
    toast('Dokument gelöscht');
    return tszLaden();
  }

  // Klick auf die Zeile klappt den ausgelesenen Text auf.
  const dok = e.target.closest('[data-dok]');
  if (dok) {
    const feld = $(`[data-dok-text="${CSS.escape(dok.dataset.dok)}"]`);
    if (feld) feld.classList.toggle('versteckt');
    return;
  }

  const tat = e.target.closest('[data-tat]');
  if (!tat) return;
  const art = tat.dataset.tat;

  if (art === 'stamm') return gemeindeDialog(g);
  if (art === 'verlauf-neu') return verlaufDialog(g, {});
  if (art === 'frist-neu') return fristDialog(g, {});
  if (art === 'verlauf') return verlaufDialog(g, (g.verlauf || []).find((v) => v.id === tat.dataset.id) || {});
  if (art === 'frist') return fristDialog(g, (g.fristen || []).find((f) => f.id === tat.dataset.id) || {});
  if (art === 'datei-neu') return $('#datei-feld').click();
  if (art === 'gemeinde-weg') {
    if (!confirm(`Akte „${g.name}" mit ${(g.verlauf || []).length} Verlaufseinträgen wirklich löschen?`)) return;
    await del(`/api/gemeinde?id=${encodeURIComponent(g.id)}`);
    S.akteId = null;
    toast('Akte gelöscht');
    return tszLaden();
  }
  return null;
}));

$('#tsz-akte').addEventListener('change', fangen(async (e) => {
  if (e.target.id !== 'datei-feld') return;
  const g = S.gemeinden.find((x) => x.id === S.akteId);
  const dateien = [...e.target.files];
  e.target.value = '';

  let leere = 0;
  for (const datei of dateien) {
    toast(`${datei.name} wird gelesen …`);
    const gelesen = await dokumentLesen(await datei.arrayBuffer());
    if (gelesen.fehler) throw new Error(`${datei.name}: ${gelesen.fehler}`);
    if (gelesen.leer) leere += 1;
    await post('/api/gemeinde/dokument', {
      gemeindeId: g.id,
      name: datei.name,
      text: gelesen.text,
      seiten: gelesen.seiten
    });
  }

  toast(leere
    ? `${dateien.length} gelesen, davon ${leere} ohne Textebene (vermutlich ein Scan)`
    : `${dateien.length} ${dateien.length === 1 ? 'Dokument' : 'Dokumente'} eingelesen`, leere > 0);
  await tszLaden();
}));

const gemeindeDialog = (g) => {
  const inhalt = `
    <div class="dialog-feld"><label>Gemeinde</label><input class="feld" id="g-name" type="text" value="${esc(g.name || '')}"></div>
    <div class="dialog-feld"><label>Ansprechpartner</label><input class="feld" id="g-person" type="text" value="${esc(g.ansprechpartner || '')}" placeholder="Name, Amt"></div>
    <div class="dialog-feld"><label>Kontakt</label><input class="feld" id="g-kontakt" type="text" value="${esc(g.kontakt || '')}" placeholder="Telefon, Mail"></div>
    <div class="dialog-feld"><label>Stand</label>
      ${wahlFeld('stand', S.staende.map((s) => [s.id, s.name]), g.stand || 'erstkontakt', STAND_TON)}
    </div>
    <div class="dialog-feld"><label>Notiz</label><textarea class="feld" id="g-notiz" rows="4">${esc(g.notiz || '')}</textarea></div>`;

  dialogOeffnen(g.id ? 'Gemeinde bearbeiten' : 'Neue Gemeinde', inhalt, async () => {
    const antwort = await post('/api/gemeinde', {
      id: g.id || null,
      name: $('#g-name').value,
      ansprechpartner: $('#g-person').value,
      kontakt: $('#g-kontakt').value,
      stand: wahlWert('stand'),
      notiz: $('#g-notiz').value
    });
    dialogSchliessen();
    if (!g.id && antwort.gemeinde) S.akteId = antwort.gemeinde.id;
    toast('Gespeichert');
    await tszLaden();
  }, null);
};

const verlaufDialog = (g, v) => {
  const inhalt = `
    <div class="dialog-feld"><label>Was ist passiert?</label>
      <textarea class="feld" id="v-text" rows="3" placeholder="Förderantrag per Mail an das Bauamt geschickt">${esc(v.text || '')}</textarea></div>
    <div class="dialog-paar">
      <div class="dialog-feld"><label>Datum</label><input class="feld" id="v-datum" type="date" value="${esc(v.datum || S.heute)}"></div>
      <div class="dialog-feld"><label>Richtung</label>
        ${wahlFeld('richtung', [['raus', 'verschickt'], ['rein', 'erhalten'], ['intern', 'intern']], v.richtung || 'raus')}
      </div>
    </div>`;

  dialogOeffnen(v.id ? 'Schritt bearbeiten' : 'Schritt festhalten', inhalt, async () => {
    await post('/api/gemeinde/verlauf', {
      gemeindeId: g.id, id: v.id || null,
      text: $('#v-text').value, datum: $('#v-datum').value, richtung: wahlWert('richtung')
    });
    dialogSchliessen();
    toast('Festgehalten');
    await tszLaden();
  }, v.id ? async () => {
    await del(`/api/gemeinde/verlauf?gemeinde=${encodeURIComponent(g.id)}&id=${encodeURIComponent(v.id)}`);
    dialogSchliessen();
    toast('Gelöscht');
    await tszLaden();
  } : null);
};

const fristDialog = (g, f) => {
  const inhalt = `
    <div class="dialog-feld"><label>Aufgabe</label><input class="feld" id="f-text" type="text" value="${esc(f.text || '')}" placeholder="Antragsfrist Förderprogramm"></div>
    <div class="dialog-feld"><label>Datum (optional)</label><input class="feld" id="f-datum" type="date" value="${esc(f.datum || '')}"></div>
    <label class="dialog-schalter"><input type="checkbox" id="f-erledigt" ${f.erledigt ? 'checked' : ''}> erledigt</label>
    <p class="hinweis">
      Mit Datum erscheint die Aufgabe ab 14 Tagen vorher auf der Startseite und in der Tagesmail.
      Ohne Datum steht sie nur hier und in der Gemeinden-Kachel der Startseite.
    </p>`;

  dialogOeffnen(f.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe', inhalt, async () => {
    await post('/api/gemeinde/frist', {
      gemeindeId: g.id, id: f.id || null,
      text: $('#f-text').value, datum: $('#f-datum').value || null, erledigt: $('#f-erledigt').checked
    });
    dialogSchliessen();
    toast('Gespeichert');
    await tszLaden();
  }, f.id ? async () => {
    await del(`/api/gemeinde/frist?gemeinde=${encodeURIComponent(g.id)}&id=${encodeURIComponent(f.id)}`);
    dialogSchliessen();
    toast('Gelöscht');
    await tszLaden();
  } : null);
};

// ---------------------------------------------------------------- Finanzen

const euro = (n) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const finKategorie = (id) => (S.finKategorien || []).find((k) => k.id === id) || null;

const zeitraumWahl = () => {
  const jetzt = S.heute || heuteISO();
  const jahr = Number(jetzt.slice(0, 4));
  const monat = jetzt.slice(0, 7);
  const auswahl = [
    { wert: `${monat}-01|${monat}-31`, label: 'laufender Monat' },
    { wert: `${jahr}-01-01|${jahr}-12-31`, label: `Jahr ${jahr}` },
    { wert: `${jahr - 1}-01-01|${jahr - 1}-12-31`, label: `Jahr ${jahr - 1}` },
    { wert: '|', label: 'alles' }
  ];
  const feld = $('#fin-zeitraum');
  const vorher = feld.value;
  feld.innerHTML = auswahl.map((a) => `<option value="${esc(a.wert)}">${esc(a.label)}</option>`).join('');
  if (vorher && auswahl.some((a) => a.wert === vorher)) feld.value = vorher;
};

const finanzenLaden = async () => {
  if (!$('#fin-zeitraum').options.length) zeitraumWahl();
  const [von, bis] = ($('#fin-zeitraum').value || '|').split('|');
  const bereich = $('#fin-bereich').value;
  const suchparameter = new URLSearchParams();
  if (von) suchparameter.set('von', von);
  if (bis) suchparameter.set('bis', bis);
  if (bereich) suchparameter.set('bereich', bereich);

  const d = await api(`/api/finanzen?${suchparameter}`);
  S.finKategorien = d.kategorien;
  S.finBuchungen = d.buchungen;

  $('#fin-leer').classList.toggle('versteckt', d.anzahl > 0);
  finanzenZeichnen(d);
};

const finanzenZeichnen = (d) => {
  if (!d.anzahl) { $('#fin-uebersicht').innerHTML = ''; return; }

  const groesste = Math.max(...d.jeKategorie.map((k) => k.summe), 1);
  const balken = d.jeKategorie.map((k) => {
    const kat = finKategorie(k.kategorie);
    const farbe = kat ? kat.farbe : 'var(--rand-hell)';
    const name = kat ? kat.name : 'ohne Kategorie';
    return `<div class="bal-zeile">
      <span class="bal-name">${esc(name)}</span>
      <span class="bal-spur"><span class="bal-fuell" style="width:${(k.summe / groesste * 100).toFixed(1)}%;--ton:${esc(farbe)}"></span></span>
      <span class="bal-wert">${esc(euro(k.summe))}</span>
      <span class="bal-anzahl">${k.anzahl}</span>
    </div>`;
  }).join('');

  const monate = d.jeMonat.length > 1 ? `
    <section class="block">
      <h2 class="block-titel">Monate</h2>
      <div class="liste">
        ${d.jeMonat.map((m) => `<div class="zeile">
          <span class="zeile-zeit">${esc(m.monat)}</span>
          <span class="zeile-text"></span>
          <span class="zeile-marke zeile-marke-neon" style="--ton:var(--neon-gruen)">+${esc(euro(m.einnahmen))}</span>
          <span class="zeile-marke zeile-marke-neon" style="--ton:var(--neon-koralle)">−${esc(euro(m.ausgaben))}</span>
          <span class="zeile-marke">${esc(euro(m.einnahmen - m.ausgaben))}</span>
        </div>`).join('')}
      </div>
    </section>` : '';

  $('#fin-uebersicht').innerHTML = `
    <section class="block">
      <h2 class="block-titel">Übersicht <span class="block-neben">${d.anzahl} Buchungen${d.umbuchungen ? `, davon ${d.umbuchungen} Umbuchungen nicht gezählt` : ''}</span></h2>
      <div class="kachel-zahlen">
        <div class="kachel-wert"><span class="kachel-label">Einnahmen</span><span class="kachel-zahl kachel-plus">${esc(euro(d.einnahmen))}</span></div>
        <div class="kachel-wert"><span class="kachel-label">Ausgaben</span><span class="kachel-zahl kachel-minus">${esc(euro(d.ausgaben))}</span></div>
        <div class="kachel-wert"><span class="kachel-label">Saldo</span><span class="kachel-zahl">${esc(euro(d.saldo))}</span></div>
      </div>
    </section>

    <section class="block">
      <h2 class="block-titel">Ausgaben nach Kategorie</h2>
      <div class="balken">${balken || leer('Keine Ausgaben im Zeitraum.')}</div>
    </section>

    ${monate}

    <section class="block">
      <h2 class="block-titel">Buchungen <span class="block-neben">neueste zuerst, höchstens 400</span></h2>
      <div class="liste">
        ${d.buchungen.map((b) => {
    const kat = finKategorie(b.kategorie);
    return `<div class="zeile" data-buchung="${esc(b.id)}" style="${kat ? `--kat:${esc(kat.farbe)}` : ''}">
          <span class="zeile-zeit">${esc(formatKurz(b.datum))}</span>
          <span class="zeile-text">${esc(b.text)}</span>
          ${b.umbuchung ? '<span class="zeile-marke">Umbuchung</span>' : ''}
          ${b.bereich === 'geschaeftlich' ? '<span class="zeile-marke zeile-marke-neon" style="--ton:var(--neon-violett)">geschäftlich</span>' : ''}
          <span class="zeile-marke">${esc(kat ? kat.name : 'ohne Kategorie')}</span>
          <span class="zeile-marke">${esc(b.bank)}</span>
          <span class="bal-wert ${b.betrag < 0 ? 'kachel-minus' : 'kachel-plus'}">${esc(euro(b.betrag))}</span>
        </div>`;
  }).join('')}
      </div>
    </section>`;
};

$('#fin-zeitraum').addEventListener('change', fangen(finanzenLaden));
$('#fin-bereich').addEventListener('change', fangen(finanzenLaden));
$('#fin-import').addEventListener('click', () => $('#fin-datei').click());

$('#fin-uebersicht').addEventListener('click', fangen(async (e) => {
  const zeileEl = e.target.closest('[data-buchung]');
  if (!zeileEl) return;
  const buchung = S.finBuchungen.find((b) => b.id === zeileEl.dataset.buchung);
  if (buchung) buchungDialog(buchung);
}));

/* --------------------------------------------------- Finanzkategorien anlegen

   Ein "+ neue Kategorie" steht in jedem Auswahlfeld. Nach dem Anlegen werden
   alle offenen Felder neu gefuellt, damit eine im Importfenster erfundene
   Kategorie sofort auch in den anderen Zeilen waehlbar ist.                  */

const NEU_WERT = '__neu';

const katOptionen = (gewaehlt) => `
  <option value="">ohne</option>
  ${S.finKategorien.map((k) => `<option value="${esc(k.id)}" ${k.id === gewaehlt ? 'selected' : ''}>${esc(k.name)}</option>`).join('')}
  <option value="${NEU_WERT}">+ neue Kategorie …</option>`;

/** Der Platzhalter "+ neue Kategorie" ist nie ein gueltiger Wert. */
const katWert = (feld) => (feld && feld.value && feld.value !== NEU_WERT ? feld.value : null);

const NEON_REIHE = ['#3ddc84', '#34e2e2', '#ff5fd2', '#ffb454', '#a988ff', '#ff7a6b'];
const naechsteFarbe = () => NEON_REIHE[S.finKategorien.length % NEON_REIHE.length];

/** Alle Auswahlfelder neu fuellen, ohne die getroffene Wahl zu verlieren. */
const katFelderAuffrischen = (ausser = null) => {
  for (const feld of $$('[data-katfeld]')) {
    if (feld === ausser) continue;
    const wert = feld.value === NEU_WERT ? '' : feld.value;
    feld.innerHTML = katOptionen(wert);
    feld.value = wert;
  }
};

/**
 * Auf "+ neue Kategorie" reagieren: Namensfeld einblenden, anlegen, auswaehlen.
 * Bricht der Benutzer ab, faellt das Feld auf die vorige Wahl zurueck.
 */
const katFeldBehandeln = async (feld) => {
  if (feld.value !== NEU_WERT) { feld.dataset.vorher = feld.value; return; }

  const zurueck = feld.dataset.vorher || '';
  const name = window.prompt('Name der neuen Finanzkategorie:', '');
  if (!name || !name.trim()) { feld.value = zurueck; return; }

  const antwort = await post('/api/finanzen/kategorie', { name: name.trim(), farbe: naechsteFarbe() });
  S.finKategorien = antwort.kategorien;
  const neu = S.finKategorien.find((k) => k.name === name.trim());
  feld.innerHTML = katOptionen(neu ? neu.id : zurueck);
  feld.value = neu ? neu.id : zurueck;
  feld.dataset.vorher = feld.value;
  katFelderAuffrischen(feld);
  toast('Kategorie angelegt');
};

document.addEventListener('change', fangen(async (e) => {
  const feld = e.target.closest('[data-katfeld]');
  if (feld) await katFeldBehandeln(feld);
}));

const buchungDialog = (b) => {
  const inhalt = `
    <div class="dialog-feld"><label>Buchung</label>
      <p class="hinweis" style="margin:0">${esc(formatDE(b.datum))} · ${esc(b.bank)} · <strong>${esc(euro(b.betrag))}</strong><br>${esc(b.text)}${b.verwendung ? `<br><span class="vp-zeile">${esc(b.verwendung)}</span>` : ''}</p>
    </div>
    <div class="dialog-feld"><label>Kategorie</label>
      <select class="feld" id="b-kat" data-katfeld data-vorher="${esc(b.kategorie || '')}">${katOptionen(b.kategorie)}</select>
    </div>
    <div class="dialog-feld"><label>Bereich</label>
      ${wahlFeld('bereich', [['privat', 'privat'], ['geschaeftlich', 'geschäftlich']], b.bereich,
    { privat: 'var(--neon-cyan)', geschaeftlich: 'var(--neon-violett)' })}
    </div>
    <label class="dialog-schalter"><input type="checkbox" id="b-umbuchung" ${b.umbuchung ? 'checked' : ''}> Umbuchung zwischen eigenen Konten (zählt weder als Einnahme noch als Ausgabe)</label>
    <div class="dialog-feld"><label>Regel merken (optional)</label>
      <input class="feld" id="b-muster" type="text" placeholder="Textstück, z. B. REWE — leer lassen für keine Regel">
      <p class="hinweis" style="margin-top:4px">Künftige Buchungen mit diesem Textstück bekommen automatisch dieselbe Kategorie.</p>
    </div>`;

  dialogOeffnen('Buchung zuordnen', inhalt, async () => {
    const gewaehlt = $('#b-kat').value;
    const kategorie = (gewaehlt && gewaehlt !== NEU_WERT) ? gewaehlt : null;
    const bereich = wahlWert('bereich');
    await post('/api/finanzen/buchung', { id: b.id, kategorie, bereich, umbuchung: $('#b-umbuchung').checked });
    const muster = $('#b-muster').value.trim();
    if (muster) await post('/api/finanzen/regel', { muster, kategorie, bereich });
    dialogSchliessen();
    toast(muster ? 'Gespeichert, Regel angelegt' : 'Gespeichert');
    await finanzenLaden();
  }, null);
};

// ---- Import ---------------------------------------------------------------

$('#fin-datei').addEventListener('change', fangen(async (e) => {
  const dateien = [...e.target.files];
  e.target.value = '';
  for (const datei of dateien) {
    toast(`${datei.name} wird gelesen …`);
    const d = await auszugLesen(await datei.arrayBuffer(), datei.name);
    if (d.fehler) throw new Error(`${datei.name}: ${d.fehler}`);
    S.finKategorien = d.kategorien;
    importZeichnen(d);
    return; // eine Datei nach der anderen bestätigen
  }
}));

const importZeichnen = (d) => {
  S.importDaten = d;
  const block = $('#fin-import-block');
  block.classList.remove('versteckt');

  const pruefung = d.pruefung || {};
  const ampel = pruefung.stimmt === true ? 'gut' : (pruefung.stimmt === false ? 'schlecht' : 'unklar');

  block.innerHTML = `
    <h2 class="block-titel">Kontrolle vor der Übernahme
      <span class="block-neben">${esc(d.dateiName)} · ${esc(d.bank)}${d.konto ? ` · ${esc(d.konto)}` : ''}</span>
    </h2>
    <div class="pruef pruef-${ampel}">
      <div><strong>${d.zeilen.length}</strong> Buchungen erkannt, Zeitraum ${esc(formatDE(d.von) || '?')} bis ${esc(formatDE(d.bis) || '?')}</div>
      <div>Eingehend ${esc(euro(pruefung.eingehend || 0))} · Ausgehend ${esc(euro(Math.abs(pruefung.ausgehend || 0)))} · Summe ${esc(euro(pruefung.summe || 0))}</div>
      <div class="pruef-text">${esc(pruefung.hinweis || 'Keine Gegenprobe im Auszug gefunden — bitte stichprobenartig vergleichen.')}</div>
      ${d.schonImportiert ? `<div class="pruef-text">Diese Datei wurde am ${esc(formatDE(d.schonImportiert.zeit.slice(0, 10)))} schon einmal eingelesen.</div>` : ''}
      ${d.dubletten ? `<div class="pruef-text">${d.dubletten} Buchungen sind bereits vorhanden und sind nicht angehakt.</div>` : ''}
    </div>

    <div class="reihe" style="margin:10px 0">
      <button class="knopf knopf-still" data-alle="1">Alle anhaken</button>
      <button class="knopf knopf-still" data-alle="0">Alle abwählen</button>
      <span class="hinweis" id="import-zaehler"></span>
    </div>

    <div class="import-tabelle">
      ${d.zeilen.map((z, i) => `
        <div class="import-zeile ${z.dublette ? 'import-dublette' : ''}" data-i="${i}">
          <input type="checkbox" data-an ${z.uebernehmen ? 'checked' : ''}>
          <span class="import-datum">${esc(formatKurz(z.datum))}</span>
          <span class="import-text" title="${esc(z.verwendung || '')}">${esc(z.text)}</span>
          <select class="feld import-kat" data-kat data-katfeld data-vorher="${esc(z.kategorie || '')}">${katOptionen(z.kategorie)}</select>
          <select class="feld import-bereich" data-bereich>
            <option value="privat" ${z.bereich === 'privat' ? 'selected' : ''}>privat</option>
            <option value="geschaeftlich" ${z.bereich === 'geschaeftlich' ? 'selected' : ''}>geschäftlich</option>
          </select>
          <span class="bal-wert ${z.betrag < 0 ? 'kachel-minus' : 'kachel-plus'}">${esc(euro(z.betrag))}</span>
          <span class="import-quelle">${esc(z.dublette ? 'schon vorhanden' : (z.quelle || (z.neueKategorie ? `Auszug: ${z.neueKategorie}` : '—')))}</span>
        </div>`).join('')}
    </div>

    <div class="reihe" style="margin-top:12px">
      <button class="knopf knopf-neon" id="import-uebernehmen">Angehakte übernehmen</button>
      <button class="knopf knopf-still" id="import-abbrechen">Verwerfen</button>
    </div>`;

  zaehlerAktualisieren();
  block.scrollIntoView({ behavior: 'smooth', block: 'start' });
};

const zaehlerAktualisieren = () => {
  const an = $$('#fin-import-block [data-an]').filter((c) => c.checked).length;
  const zaehler = $('#import-zaehler');
  if (zaehler) zaehler.textContent = `${an} von ${S.importDaten.zeilen.length} ausgewählt`;
};

$('#fin-import-block').addEventListener('change', () => zaehlerAktualisieren());

$('#fin-import-block').addEventListener('click', fangen(async (e) => {
  const alle = e.target.closest('[data-alle]');
  if (alle) {
    $$('#fin-import-block [data-an]').forEach((c) => { c.checked = alle.dataset.alle === '1'; });
    zaehlerAktualisieren();
    return;
  }
  if (e.target.id === 'import-abbrechen') {
    S.importDaten = null;
    $('#fin-import-block').classList.add('versteckt');
    $('#fin-import-block').innerHTML = '';
    return;
  }
  if (e.target.id !== 'import-uebernehmen') return;

  const zeilen = $$('#fin-import-block .import-zeile').map((el) => {
    const quelle = S.importDaten.zeilen[Number(el.dataset.i)];
    return {
      ...quelle,
      uebernehmen: el.querySelector('[data-an]').checked,
      kategorie: katWert(el.querySelector('[data-kat]')),
      bereich: el.querySelector('[data-bereich]').value
    };
  });

  const ergebnis = await post('/api/finanzen/import', {
    bank: S.importDaten.bank,
    konto: S.importDaten.konto,
    von: S.importDaten.von,
    bis: S.importDaten.bis,
    dateiName: S.importDaten.dateiName,
    dateiHash: S.importDaten.dateiHash,
    zeilen
  });

  S.importDaten = null;
  $('#fin-import-block').classList.add('versteckt');
  $('#fin-import-block').innerHTML = '';
  toast(`${ergebnis.uebernommen} Buchungen übernommen, ${ergebnis.uebersprungen} übersprungen`);
  await finanzenLaden();
}));

// ---- Regeln ---------------------------------------------------------------

$('#fin-regeln').addEventListener('click', fangen(async () => {
  const block = $('#fin-regel-block');
  if (!block.classList.contains('versteckt')) {
    block.classList.add('versteckt');
    return;
  }
  const d = await api('/api/finanzen/regeln');
  block.classList.remove('versteckt');
  block.innerHTML = `
    <h2 class="block-titel">Regeln <span class="block-neben">greifen beim nächsten Import automatisch</span></h2>
    <div class="liste">
      ${d.regeln.length ? d.regeln.map((r) => {
    const kat = d.kategorien.find((k) => k.id === r.kategorie);
    return `<div class="zeile" data-regel="${esc(r.id)}">
        <span class="zeile-text">Text enthält „${esc(r.muster)}"</span>
        <span class="zeile-marke">${esc(kat ? kat.name : 'ohne Kategorie')}</span>
        ${r.bereich ? `<span class="zeile-marke">${esc(r.bereich === 'geschaeftlich' ? 'geschäftlich' : 'privat')}</span>` : ''}
        <span class="zeile-marke" data-regel-weg="${esc(r.id)}">löschen</span>
      </div>`;
  }).join('') : leer('Noch keine Regel. Eine entsteht, wenn du beim Zuordnen einer Buchung ein Textstück angibst.')}
    </div>
    <div class="reihe" style="margin-top:10px">
      <button class="knopf knopf-still" id="regeln-anwenden">Auf Buchungen ohne Kategorie anwenden</button>
    </div>
    ${d.importe.length ? `<h2 class="block-titel" style="margin-top:16px">Zuletzt eingelesen</h2>
      <div class="liste">${d.importe.map((i) => `<div class="zeile">
        <span class="zeile-zeit">${esc(formatKurz(i.zeit.slice(0, 10)))}</span>
        <span class="zeile-text">${esc(i.datei)}</span>
        <span class="zeile-marke">${esc(i.bank)}</span>
        <span class="zeile-marke">${i.anzahl} übernommen</span>
      </div>`).join('')}</div>` : ''}`;
}));

$('#fin-regel-block').addEventListener('click', fangen(async (e) => {
  const weg = e.target.closest('[data-regel-weg]');
  if (weg) {
    await del(`/api/finanzen/regel?id=${encodeURIComponent(weg.dataset.regelWeg)}`);
    toast('Regel gelöscht');
    $('#fin-regel-block').classList.add('versteckt');
    $('#fin-regeln').click();
    return;
  }
  if (e.target.id === 'regeln-anwenden') {
    const d = await post('/api/finanzen/regeln/anwenden', { nurLeere: true });
    toast(`${d.geaendert} Buchungen zugeordnet`);
    await finanzenLaden();
  }
}));

// ---------------------------------------------------------------- Einstellungen: Thema und Mail

const THEMA_TEXT = {
  kante: 'Neonkante — mattschwarz, kompakt, Farbe ausschließlich als Rand. Viel Information auf wenig Fläche.',
  ruhe: 'Ruhige Karten — etwas hellerer Grafitgrund, mehr Luft, größere Schrift, gedämpftere Ränder. Angenehmer über längere Zeit.',
  linie: 'Linie — tiefes Schwarz, keine Kartenflächen, nur feine Neonlinien und Typografie. Am reduziertesten, am wenigsten ablenkend.'
};

const themaSetzen = (thema) => {
  document.documentElement.dataset.thema = thema;
  S.thema = thema;
};

/* ------------------------------------------------------------ Kachel-Editor

   Verkleinertes Abbild derselben Layout-Daten, die auch die Startseite zeichnet.
   Gezogen wird ueber Pointer-Ereignisse statt HTML5-Drag-and-Drop: das
   funktioniert mit Maus und Finger gleichermassen und braucht nichts von aussen.
*/

const SPALTEN_TITEL = {
  links: 'Linke Randleiste', voll: 'Volle Breite',
  1: 'Spalte 1', 2: 'Spalte 2', 3: 'Spalte 3',
  rechts: 'Rechte Randleiste'
};
const SPALTEN_FOLGE = ['links', 'voll', 1, 2, 3, 'rechts'];

/** Aus dem Datenwert der Ablage die Form machen, in der sie gespeichert wird. */
const alsSpalte = (wert) => (['links', 'voll', 'rechts'].includes(String(wert)) ? String(wert) : Number(wert));

const kachelName = (id) => (S.kachelNamen.find((k) => k.id === id) || {}).name || id;

const editorZeichnen = () => {
  const layout = S.startseite;
  if (!layout) return;

  const spalte = (schluessel) => {
    const drin = layout.kacheln.filter((k) => String(k.spalte) === String(schluessel));
    const klasse = schluessel === 'voll' ? 'ed-spalte ed-voll' : 'ed-spalte';
    return `<div class="${klasse}" data-ed-spalte="${schluessel}">
      <span class="ed-spalte-kopf">${esc(SPALTEN_TITEL[schluessel])}</span>
      ${drin.map((k, i) => {
    const platz = SPALTEN_FOLGE.indexOf(alsSpalte(k.spalte));
    // Halbe Breite gibt es nur in der Vollzeile — anderswo waere der Knopf eine Lüge.
    const breite = schluessel === 'voll'
      ? `<button class="ed-knopf${k.breite === 'halb' ? ' aktiv' : ''}" data-ed-tat="breite"
           title="${k.breite === 'halb' ? 'auf volle Breite' : 'auf halbe Breite — zwei nebeneinander'}">${k.breite === 'halb' ? '◨' : '▬'}</button>`
      : '';
    return `<div class="ed-kachel${k.sichtbar ? '' : ' ed-kachel-aus'}" data-ed-kachel="${esc(k.id)}">
        <span class="ed-griff" data-ed-griff title="ziehen">≡</span>
        <span class="ed-name">${esc(kachelName(k.id))}${k.hoehe ? ` <span class="ed-hoehe">${k.hoehe}px</span>` : ''}</span>
        ${breite}
        <button class="ed-knopf" data-ed-tat="links" title="eine Ablage nach links" ${platz <= 0 ? 'disabled' : ''}>‹</button>
        <button class="ed-knopf" data-ed-tat="rechts" title="eine Ablage nach rechts" ${platz >= SPALTEN_FOLGE.length - 1 ? 'disabled' : ''}>›</button>
        <button class="ed-knopf" data-ed-tat="hoch" title="nach oben" ${i === 0 ? 'disabled' : ''}>⬆</button>
        <button class="ed-knopf" data-ed-tat="runter" title="nach unten" ${i === drin.length - 1 ? 'disabled' : ''}>⬇</button>
        <button class="ed-knopf" data-ed-tat="sicht" title="${k.sichtbar ? 'ausblenden' : 'einblenden'}">⊙</button>
      </div>`;
  }).join('')}
      ${drin.length ? '' : '<div class="ed-spalte-leer"></div>'}
    </div>`;
  };

  $('#ed-raster').innerHTML = SPALTEN_FOLGE.map(spalte).join('');
  $('#ed-vorlagen').innerHTML = S.vorlagen
    .map((v) => `<button type="button" data-ed-vorlage="${esc(v.id)}" class="${v.id === layout.vorlage ? 'aktiv' : ''}">${esc(v.name)}</button>`)
    .join('');
};

/** Layout sichern und beide Ansichten nachziehen. */
const layoutSichern = async () => {
  const antwort = await post('/api/einstellungen', { startseite: S.startseite });
  if (antwort.startseite) S.startseite = antwort.startseite;
  editorZeichnen();
  kachelnEinsortieren();
};

/** Kachel an eine Stelle setzen: gleiche Spalte verschieben oder Spalte wechseln. */
const kachelSetzen = (id, spalte, vorId = null) => {
  const liste = S.startseite.kacheln;
  const platz = liste.find((k) => k.id === id);
  if (!platz) return;
  platz.spalte = spalte;
  // Halbe Breite ueberlebt den Weg aus der Vollzeile heraus nicht.
  if (spalte !== 'voll') platz.breite = 'ganz';

  liste.splice(liste.indexOf(platz), 1);
  const ziel = vorId ? liste.findIndex((k) => k.id === vorId) : -1;
  if (ziel === -1) liste.push(platz);
  else liste.splice(ziel, 0, platz);
};

$('#ed-raster').addEventListener('click', fangen(async (e) => {
  const knopf = e.target.closest('[data-ed-tat]');
  if (!knopf) return;
  const id = knopf.closest('[data-ed-kachel]').dataset.edKachel;
  const platz = S.startseite.kacheln.find((k) => k.id === id);
  if (!platz) return;

  const tat = knopf.dataset.edTat;
  if (tat === 'sicht') platz.sichtbar = !platz.sichtbar;
  if (tat === 'breite') platz.breite = platz.breite === 'halb' ? 'ganz' : 'halb';

  if (tat === 'links' || tat === 'rechts') {
    const jetzt = SPALTEN_FOLGE.indexOf(alsSpalte(platz.spalte));
    const neu = SPALTEN_FOLGE[jetzt + (tat === 'rechts' ? 1 : -1)];
    if (neu !== undefined) kachelSetzen(id, neu, null);
  }

  if (tat === 'hoch' || tat === 'runter') {
    const nachbarn = S.startseite.kacheln.filter((k) => String(k.spalte) === String(platz.spalte));
    const i = nachbarn.indexOf(platz);
    const ziel = nachbarn[i + (tat === 'runter' ? 1 : -1)];
    if (ziel) {
      // Beim Runterschieben vor den uebernaechsten setzen, sonst landet man wieder oben.
      const dahinter = tat === 'runter' ? nachbarn[i + 2] : ziel;
      kachelSetzen(id, platz.spalte, dahinter ? dahinter.id : null);
    }
  }

  await layoutSichern();
}));

$('#ed-vorlagen').addEventListener('click', fangen(async (e) => {
  const knopf = e.target.closest('[data-ed-vorlage]');
  if (!knopf) return;
  const antwort = await post('/api/einstellungen', { vorlage: knopf.dataset.edVorlage });
  if (antwort.startseite) S.startseite = antwort.startseite;
  editorZeichnen();
  kachelnEinsortieren();
  toast('Vorlage übernommen');
}));

// ---- Ziehen ---------------------------------------------------------------

let zug = null;

$('#ed-raster').addEventListener('pointerdown', (e) => {
  const griff = e.target.closest('[data-ed-griff]');
  if (!griff) return;
  const kachel = griff.closest('[data-ed-kachel]');
  e.preventDefault();

  zug = { id: kachel.dataset.edKachel, schwebe: null, ziel: null };
  kachel.classList.add('ed-kachel-zieht');
  griff.setPointerCapture(e.pointerId);

  zug.schwebe = document.createElement('div');
  zug.schwebe.className = 'ed-schwebe';
  zug.schwebe.textContent = kachelName(zug.id);
  document.body.appendChild(zug.schwebe);
  zugBewegen(e);
});

const zugBewegen = (e) => {
  if (!zug) return;
  zug.schwebe.style.left = `${e.clientX + 12}px`;
  zug.schwebe.style.top = `${e.clientY + 12}px`;

  const unter = document.elementFromPoint(e.clientX, e.clientY);
  const spalte = unter && unter.closest('[data-ed-spalte]');
  $$('[data-ed-spalte]').forEach((s) => s.classList.toggle('ed-ziel', s === spalte));

  const ueber = unter && unter.closest('[data-ed-kachel]');
  zug.ziel = spalte
    ? { spalte: spalte.dataset.edSpalte, vor: ueber && ueber.dataset.edKachel !== zug.id ? ueber.dataset.edKachel : null }
    : null;
};

$('#ed-raster').addEventListener('pointermove', zugBewegen);

const zugBeenden = fangen(async () => {
  if (!zug) return;
  const { ziel, id } = zug;
  zug.schwebe.remove();
  zug = null;
  $$('[data-ed-spalte]').forEach((s) => s.classList.remove('ed-ziel'));
  $$('[data-ed-kachel]').forEach((k) => k.classList.remove('ed-kachel-zieht'));

  if (!ziel) return editorZeichnen();
  kachelSetzen(id, alsSpalte(ziel.spalte), ziel.vor);
  await layoutSichern();
});

$('#ed-raster').addEventListener('pointerup', zugBeenden);
$('#ed-raster').addEventListener('pointercancel', zugBeenden);

const einstellungenLaden = async () => {
  const d = await api('/api/einstellungen');
  themaSetzen(d.thema);
  S.startseite = d.startseite;
  S.kachelNamen = d.kacheln || [];
  S.vorlagen = d.vorlagen || [];
  S.feldTypen = d.feldTypen || [];
  S.reimeEinst = d.reime || null;
  kopfleisteZeichnen(d.reiter);
  editorZeichnen();
  reiterZeichnen();
  farbenZeichnen();
  rkatZeichnen();
  [...$('#thema-wahl').querySelectorAll('[data-wert]')].forEach((b) => b.classList.toggle('aktiv', b.dataset.wert === d.thema));
  $('#thema-text').textContent = THEMA_TEXT[d.thema] || '';

  $('#mail-aktiv').checked = d.mail.aktiv;
  $('#mail-empfaenger').value = d.mail.empfaenger || '';
  $('#mail-zeit').value = d.mail.uhrzeit;
  $('#mail-schluessel').placeholder = d.mail.schluesselGesetzt
    ? (d.mail.ausUmgebung ? 'aus Umgebungsvariable — Feld leer lassen' : 'hinterlegt — leer lassen, um ihn zu behalten')
    : 'Web3Forms-Zugangsschlüssel';

  const teile = [];
  if (d.mail.letzterVersand) teile.push(`Zuletzt verschickt: ${formatDE(d.mail.letzterVersand)}.`);
  if (d.mail.letzterFehler) teile.push(`Letzter Fehler — ${d.mail.letzterFehler}`);
  if (!d.mail.schluesselGesetzt) teile.push('Ohne Schlüssel wird nichts verschickt.');
  $('#mail-info').textContent = teile.join(' ');
};

$('#thema-wahl').addEventListener('click', fangen(async (e) => {
  const knopf = e.target.closest('[data-wert]');
  if (!knopf) return;
  [...$('#thema-wahl').querySelectorAll('[data-wert]')].forEach((b) => b.classList.toggle('aktiv', b === knopf));
  themaSetzen(knopf.dataset.wert);
  $('#thema-text').textContent = THEMA_TEXT[knopf.dataset.wert] || '';
  await post('/api/einstellungen', { thema: knopf.dataset.wert });
}));

$('#mail-sichern').addEventListener('click', fangen(async () => {
  await post('/api/einstellungen', {
    mail: {
      aktiv: $('#mail-aktiv').checked,
      empfaenger: $('#mail-empfaenger').value,
      uhrzeit: $('#mail-zeit').value,
      schluessel: $('#mail-schluessel').value
    }
  });
  $('#mail-schluessel').value = '';
  toast('Einstellungen gesichert');
  await einstellungenLaden();
}));

$('#mail-vorschau').addEventListener('click', fangen(async () => {
  const d = await post('/api/mail/vorschau');
  const ziel = $('#mail-text');
  ziel.classList.remove('versteckt');
  ziel.textContent = d.leer
    ? 'Für heute steht nichts an — es würde keine Mail verschickt.'
    : `Betreff: ${d.betreff}\n\n${d.text}`;
}));

/**
 * Versand über Web3Forms — bewusst aus der Seite heraus, nicht vom Server.
 * Der Gratistarif von Web3Forms lehnt serverseitige Aufrufe mit 403 ab.
 */
const web3FormsSenden = async ({ schluessel, empfaenger, betreff, text }) => {
  const koerper = { access_key: schluessel, subject: betreff, from_name: 'HDDatenbank', message: text };
  if (empfaenger) koerper.email = empfaenger;
  try {
    const antwort = await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(koerper)
    });
    const ergebnis = await antwort.json().catch(() => ({}));
    if (!antwort.ok || ergebnis.success === false) {
      return { ok: false, fehler: ergebnis.message || `Web3Forms antwortete mit ${antwort.status}` };
    }
    return { ok: true };
  } catch (fehler) {
    return { ok: false, fehler: `Keine Verbindung zu Web3Forms: ${fehler.message}` };
  }
};

$('#mail-test').addEventListener('click', fangen(async () => {
  if (!confirm('Jetzt eine echte Testmail verschicken?')) return;
  const auftrag = await post('/api/mail/test');
  const ergebnis = await web3FormsSenden(auftrag);
  toast(ergebnis.ok ? 'Testmail verschickt' : `Fehlgeschlagen: ${ergebnis.fehler}`, !ergebnis.ok);
  if (!ergebnis.ok) $('#mail-info').textContent = ergebnis.fehler;
}));

/**
 * Wecker: fragt den Server, ob die Tagesmail dran ist, und schickt sie ab.
 * Läuft, solange das Dashboard offen ist — der Autostart öffnet es bei jeder Anmeldung.
 */
const mailWecker = async () => {
  try {
    const auftrag = await api('/api/mail/faellig');
    if (!auftrag.faellig) return;
    const ergebnis = await web3FormsSenden(auftrag);
    await post('/api/mail/quittung', { ok: ergebnis.ok, fehler: ergebnis.fehler });
    if (ergebnis.ok) toast(auftrag.verspaetet ? 'Tagesmail nachträglich verschickt' : 'Tagesmail verschickt');
  } catch { /* ein Mailproblem darf die Oberfläche nicht stören */ }
};

/* ================================================================ Kopfleiste

   Die festen Ansichten bleiben statisches HTML — beweglich ist nur die Leiste
   davor. Name, Reihenfolge und Sichtbarkeit kommen aus der Konfiguration,
   eigene Reiter bekommen ihren Knopf zur Laufzeit dazu.                      */

const kopfleisteZeichnen = (reiter) => {
  if (!Array.isArray(reiter) || !reiter.length) return;
  S.reiter = reiter;
  const nav = $('.kopf-nav');

  for (const r of reiter) {
    let knopf = nav.querySelector(`[data-ansicht="${r.id}"]`);
    if (!knopf) {
      if (r.typ !== 'eigen') continue;
      knopf = document.createElement('button');
      knopf.className = 'tab';
      knopf.dataset.ansicht = r.id;
      knopf.addEventListener('click', fangen(() => ansichtWechseln(r.id)));
    }
    knopf.textContent = r.name;
    knopf.classList.toggle('versteckt', !r.sichtbar);
    // Anhaengen setzt den Knopf zugleich an seine Stelle in der Reihenfolge.
    nav.appendChild(knopf);
  }

  // Was es nicht mehr gibt — ein geloeschter eigener Reiter —, fliegt raus.
  for (const knopf of [...nav.querySelectorAll('.tab')]) {
    if (!reiter.some((r) => r.id === knopf.dataset.ansicht)) knopf.remove();
  }
};

/* ================================================================ Reime

   Drei Unterreiter auf einer Ansicht. Der Kern ist das Silbenraster: jede Silbe
   eine gleich breite Zelle, eingefaerbt nach ihrem relevanten Laut, und die
   Zeilen so weit verschoben, dass die passenden Silben untereinander stehen.
   Der Versatz kommt fertig gerechnet aus reimedaten.js.                      */

const REIME_TITEL = { reime: 'Reime', zeilen: 'Zeilen', texte: 'Texte' };

const laut = (l) => (S.reimeDaten && S.reimeDaten.farben[l]) || 'var(--rand-hell)';

/** Silbenzellen einer Zeile. Der Versatz wird als leere Zellen vorgesetzt. */
const silbenRaster = (silben, versatz = 0, treffer = null) => {
  const zellen = [];
  for (let i = 0; i < versatz; i += 1) zellen.push('<span class="silbe silbe-leer"></span>');

  silben.forEach((s, i) => {
    const platz = S.silbenRegister.push(s) - 1;
    const klassen = ['silbe'];
    if (s.wortAnfang && i > 0) klassen.push('silbe-wortanfang');
    if (s.anmerkungen.length) klassen.push('silbe-anmerkung');
    if (s.korrigiert) klassen.push('silbe-korrigiert');
    if (treffer && treffer.includes(i)) klassen.push('silbe-treffer');
    zellen.push(`<button type="button" class="${klassen.join(' ')}" style="--laut:${esc(laut(s.primaer))}"
      data-silbe="${platz}" title="${esc(s.wort)} — ${s.silbeIndex + 1}. Silbe">${esc(s.primaer)}</button>`);
  });

  return `<div class="silben-raster">${zellen.join('')}</div>`;
};

const zaehlerMarke = (z) => `<span class="reim-zaehler" title="passende Silben nach oben und nach unten, dann Silben insgesamt">
  ↑${z.zaehlung.oben} ↓${z.zaehlung.unten} · ${z.zaehlung.gesamt}</span>`;

const reimZeile = (z, gruppe) => `
  <div class="reim-zeile${z.kopf ? ' reim-zeile-kopf' : ''}" data-zeile="${esc(z.id)}" data-gruppe="${esc(gruppe.id)}">
    <div class="reim-kopfzeile">
      <span class="reim-text">${esc(z.text)}</span>
      ${zaehlerMarke(z)}
      <button class="reim-ausklapp" data-rat="${esc(z.text)}" data-rat-id="${esc(z.id)}"
        title="passende Reime aus dem Bestand">✓</button>
      ${z.kopf ? '' : `<button class="reim-weg" data-reim-weg="${esc(z.id)}" title="Reim entfernen">✕</button>`}
    </div>
    ${silbenRaster(z.silben, z.versatz)}
    <div class="reim-rat versteckt"></div>
  </div>`;

const katMarken = (ids) => (ids || [])
  .map((id) => (S.reimeDaten.kategorien || []).find((k) => k.id === id))
  .filter(Boolean)
  .map((k) => `<span class="zeile-marke zeile-marke-neon" style="--ton:${esc(k.farbe)}">${esc(k.name)}</span>`)
  .join(' ');

const reimeKategorienZeichnen = () => {
  const knopf = (id, name, farbe) => `<button type="button" class="kat-knopf${(S.reimeKategorie || '') === id ? ' aktiv' : ''}"
    data-rkat-wahl="${esc(id)}" style="--ton:${esc(farbe)}">${esc(name)}</button>`;
  $('#reime-kategorien').innerHTML = knopf('', 'Alles', 'var(--rand-hell)')
    + (S.reimeDaten.kategorien || []).map((k) => knopf(k.id, k.name, k.farbe)).join('');
};

const reimeZeichnen = () => {
  const d = S.reimeDaten;
  if (!d) return;
  S.silbenRegister = [];

  $$('#reime-bereiche [data-bereich]').forEach((b) => b.classList.toggle('aktiv', b.dataset.bereich === d.bereich));
  reimeKategorienZeichnen();

  // In Reimen ist die Faerbung fest an — dort ist sie der ganze Zweck.
  const faerben = d.bereich === 'reime'
    ? true
    : (d.bereich === 'zeilen' ? d.anzeige.faerbenZeilen : d.anzeige.faerbenTexte);
  $('#reime-faerben-schalter').classList.toggle('versteckt', d.bereich === 'reime');
  $('#reime-faerben').checked = faerben;
  $('#reime-such-auf').classList.toggle('versteckt', d.bereich !== 'reime');
  if (d.bereich !== 'reime') $('#reime-suchblock').classList.add('versteckt');
  $('#reime-neu').textContent = d.bereich === 'reime' ? 'Neue Gruppe' : (d.bereich === 'zeilen' ? 'Neue Zeile' : 'Neuer Text');

  const ziel = $('#reime-liste');

  if (d.bereich === 'reime') {
    ziel.innerHTML = d.gruppen.length ? d.gruppen.map((g) => `
      <section class="block reim-gruppe" data-gruppe="${esc(g.id)}">
        <h2 class="block-titel">
          ${esc(g.kopf)} ${katMarken(g.kategorien)}
          <span class="kachel-wahl">
            <button type="button" data-gruppe-reim>+ Reim</button>
            <button type="button" data-gruppe-sortieren title="besten Reim nach oben">Sortieren</button>
            <button type="button" data-gruppe-aendern>Ändern</button>
          </span>
        </h2>
        <div class="silben-lauf">${g.zeilen.map((z) => reimZeile(z, g)).join('')}</div>
      </section>`).join('')
      : leer('Noch keine Reimgruppe. Über „Neue Gruppe" einen Begriff anlegen.');
    return;
  }

  if (d.bereich === 'zeilen') {
    ziel.innerHTML = d.zeilen.length ? `
      <section class="block">
        <div class="silben-lauf">${d.zeilen.map((z) => `
          <div class="reim-zeile" data-zeile="${esc(z.id)}" data-typ="zeile">
            <div class="reim-kopfzeile">
              <span class="reim-text">${esc(z.text)}</span>
              ${katMarken(z.kategorien)}
              <button class="reim-weg" data-zeile-aendern="${esc(z.id)}" title="ändern">✎</button>
            </div>
            ${faerben ? silbenRaster(z.silben, z.versatz) : ''}
          </div>`).join('')}
        </div>
      </section>`
      : leer('Noch keine Zeilen. Über „Neue Zeile" anfangen.');
    return;
  }

  ziel.innerHTML = d.texte.length ? d.texte.map((t) => `
    <section class="block" data-text="${esc(t.id)}">
      <h2 class="block-titel">
        ${esc(t.titel)} ${katMarken(t.kategorien)}
        <span class="kachel-wahl"><button type="button" data-text-aendern="${esc(t.id)}">Ändern</button></span>
      </h2>
      <div class="silben-lauf">${t.zeilen.map((z) => `
        <div class="reim-zeile">
          <div class="reim-kopfzeile"><span class="reim-text">${esc(z.text || ' ')}</span></div>
          ${faerben && z.silben.length ? silbenRaster(z.silben, z.versatz) : ''}
        </div>`).join('')}
      </div>
    </section>`).join('')
    : leer('Noch keine Texte. Über „Neuer Text" anfangen.');
};

const reimeLaden = async () => {
  const teile = [`bereich=${encodeURIComponent(S.reimeBereich)}`];
  if (S.reimeKategorie) teile.push(`kategorie=${encodeURIComponent(S.reimeKategorie)}`);
  S.reimeDaten = await api(`/api/reime?${teile.join('&')}`);
  suchfelderBauen();
  reimeZeichnen();
};

/* ---- Kategorienhinweis ------------------------------------------------------

   Kein Ratespiel: der Hinweis haengt an den Stichwoertern, die an der Kategorie
   selbst stehen. Entschieden wird von Hand, angeboten wird nur.              */

const katHinweis = (text) => {
  const wort = String(text || '').toLowerCase();
  if (!wort) return [];
  return (S.reimeDaten.kategorien || []).filter((k) => k.stichwoerter.some((s) => s && wort.includes(s)));
};

const katKaestchen = (gewaehlt = []) => `
  <div class="kat-kaestchen">
    ${(S.reimeDaten.kategorien || []).map((k) => `
      <label class="dialog-schalter">
        <input type="checkbox" data-kat="${esc(k.id)}" ${gewaehlt.includes(k.id) ? 'checked' : ''}>
        <span class="zeile-marke zeile-marke-neon" style="--ton:${esc(k.farbe)}">${esc(k.name)}</span>
      </label>`).join('') || '<span class="hinweis">Noch keine Kategorien — anzulegen in den Einstellungen.</span>'}
  </div>
  <p class="hinweis" data-kat-hinweis></p>`;

const katGewaehlt = () => [...$('#dialog-inhalt').querySelectorAll('[data-kat]')]
  .filter((f) => f.checked).map((f) => f.dataset.kat);

const hinweisPflegen = (text) => {
  const feld = $('#dialog-inhalt').querySelector('[data-kat-hinweis]');
  if (!feld) return;
  const treffer = katHinweis(text);
  feld.textContent = treffer.length ? `Passt vielleicht zu: ${treffer.map((k) => k.name).join(', ')}` : '';
};

$('#dialog-inhalt').addEventListener('input', (e) => {
  if (e.target.matches('[data-hinweis-quelle]')) hinweisPflegen(e.target.value);
});

/* ---- Dialoge ----------------------------------------------------------- */

const gruppeDialog = (g) => {
  const vorhanden = Boolean(g);
  dialogOeffnen(vorhanden ? 'Reimgruppe ändern' : 'Neue Reimgruppe', `
    <label class="dialog-feld">Begriff
      <input class="feld" data-kopf data-hinweis-quelle type="text" value="${esc(g ? g.kopf : '')}" placeholder="zum Beispiel Hundesteuer">
    </label>
    ${katKaestchen(g ? g.kategorien : [])}`,
  async () => {
    await post('/api/reime/gruppe', {
      id: g ? g.id : null,
      kopf: $('#dialog-inhalt').querySelector('[data-kopf]').value,
      kategorien: katGewaehlt()
    });
    dialogSchliessen();
    await reimeLaden();
    toast(vorhanden ? 'Gruppe geändert' : 'Gruppe angelegt');
  },
  vorhanden ? async () => {
    if (!confirm(`„${g.kopf}" mit allen Reimen löschen?`)) return;
    await del(`/api/reime/gruppe?id=${encodeURIComponent(g.id)}`);
    dialogSchliessen();
    await reimeLaden();
    toast('Gruppe gelöscht');
  } : null);
};

const reimDialog = (gruppeId, vorgabe) => {
  dialogOeffnen(vorgabe ? 'Reim ändern' : 'Neuer Reim', `
    <label class="dialog-feld">Reim
      <input class="feld" data-reim type="text" value="${esc(vorgabe ? vorgabe.text : '')}" placeholder="Wort oder Wortfolge">
    </label>
    <p class="hinweis">Mehrere Wörter sind ausdrücklich erlaubt — die Silben laufen über die Wortgrenze hinweg weiter.</p>`,
  async () => {
    await post('/api/reime/eintrag', {
      gruppe: gruppeId,
      id: vorgabe ? vorgabe.id : null,
      text: $('#dialog-inhalt').querySelector('[data-reim]').value
    });
    dialogSchliessen();
    await reimeLaden();
    toast('Reim gesichert');
  }, null);
};

const zeileDialog = (z) => {
  dialogOeffnen(z ? 'Zeile ändern' : 'Neue Zeile', `
    <label class="dialog-feld">Zeile
      <input class="feld" data-zeilentext data-hinweis-quelle type="text" value="${esc(z ? z.text : '')}">
    </label>
    ${katKaestchen(z ? z.kategorien : [])}`,
  async () => {
    await post('/api/reime/zeile', {
      id: z ? z.id : null,
      text: $('#dialog-inhalt').querySelector('[data-zeilentext]').value,
      kategorien: katGewaehlt()
    });
    dialogSchliessen();
    await reimeLaden();
    toast('Zeile gesichert');
  },
  z ? async () => {
    await del(`/api/reime/zeile?id=${encodeURIComponent(z.id)}`);
    dialogSchliessen();
    await reimeLaden();
    toast('Zeile gelöscht');
  } : null);
};

const textDialog = (t) => {
  dialogOeffnen(t ? 'Text ändern' : 'Neuer Text', `
    <label class="dialog-feld">Titel
      <input class="feld" data-titel type="text" value="${esc(t ? t.titel : '')}">
    </label>
    <label class="dialog-feld">Text
      <textarea class="feld feld-hoch" data-inhalt data-hinweis-quelle rows="10">${esc(t ? t.zeilen.map((z) => z.text).join('\n') : '')}</textarea>
    </label>
    ${katKaestchen(t ? t.kategorien : [])}`,
  async () => {
    await post('/api/reime/text', {
      id: t ? t.id : null,
      titel: $('#dialog-inhalt').querySelector('[data-titel]').value,
      inhalt: $('#dialog-inhalt').querySelector('[data-inhalt]').value,
      kategorien: katGewaehlt()
    });
    dialogSchliessen();
    await reimeLaden();
    toast('Text gesichert');
  },
  t ? async () => {
    if (!confirm(`„${t.titel}" löschen?`)) return;
    await del(`/api/reime/text?id=${encodeURIComponent(t.id)}`);
    dialogSchliessen();
    await reimeLaden();
    toast('Text gelöscht');
  } : null);
};

/**
 * Das Silbenblatt. Alles hier haengt am Wort und wirkt sofort ueberall — die
 * Aussprache einer Silbe aendert sich nicht, nur weil das Wort in einer anderen
 * Zeile steht.
 */
const silbeDialog = (s) => {
  const lautWahl = (name, wert) => `<select class="feld" data-${name}>
      <option value="">—</option>
      ${S.reimeDaten.laute.map((l) => `<option value="${esc(l)}" ${l === wert ? 'selected' : ''}>${esc(l)}</option>`).join('')}
    </select>`;

  const zeilen = [0, 1, 2].map((i) => {
    const a = s.anmerkungen[i] || null;
    return `<div class="reihe anmerkung-zeile">
      ${lautWahl(`laut-${i}`, a ? a.laut : '')}
      <select class="feld" data-prio-${i}>
        ${S.reimeDaten.prioritaeten.map((p) => `<option value="${esc(p)}" ${(a ? a.prioritaet : 'mittel') === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
      </select>
    </div>`;
  }).join('');

  dialogOeffnen(`Silbe „${s.primaer}" in „${s.wort}"`, `
    <p class="hinweis" style="margin-top:0">
      Gilt für das Wort, nicht nur für diese Zeile. Getroffen ist die Silbe, sobald der
      geschriebene Kern oder eine der Anmerkungen passt; die Priorität entscheidet über
      Farbe und Rangfolge, nicht über den Treffer.
    </p>
    <label class="dialog-feld">Geschriebener Kern — abweichend gelesen als
      ${lautWahl('korrektur', s.korrigiert ? s.kern : '')}
    </label>
    <p class="hinweis">Leer heißt: so, wie es geschrieben steht.</p>
    <span class="dialog-feld">Anmerkungen, höchstens drei</span>
    ${zeilen}
    <span class="dialog-feld">Was wiegt schwerer?</span>
    ${wahlFeld('relevanz', [['buchstabe', 'der Buchstabe'], ['anmerkung', 'die Anmerkung']], s.relevanz)}`,
  async () => {
    const inhalt = $('#dialog-inhalt');
    const anmerkungen = [0, 1, 2]
      .map((i) => ({
        laut: inhalt.querySelector(`[data-laut-${i}]`).value,
        prioritaet: inhalt.querySelector(`[data-prio-${i}]`).value
      }))
      .filter((a) => a.laut);

    await post('/api/reime/wort', {
      wort: s.schluessel,
      silbeIndex: s.silbeIndex,
      korrektur: inhalt.querySelector('[data-korrektur]').value || null,
      relevanz: wahlWert('relevanz') || 'buchstabe',
      anmerkungen
    });
    dialogSchliessen();
    await reimeLaden();
    toast('Silbe gesichert');
  }, null);
};

/* ---- Bedienung der Reimeansicht ---------------------------------------- */

$('#reime-bereiche').addEventListener('click', fangen(async (e) => {
  const knopf = e.target.closest('[data-bereich]');
  if (!knopf) return;
  S.reimeBereich = knopf.dataset.bereich;
  S.reimeKategorie = null;
  await reimeLaden();
}));

$('#reime-kategorien').addEventListener('click', fangen(async (e) => {
  const knopf = e.target.closest('[data-rkat-wahl]');
  if (!knopf) return;
  S.reimeKategorie = knopf.dataset.rkatWahl || null;
  await reimeLaden();
}));

$('#reime-neu').addEventListener('click', fangen(() => {
  if (S.reimeBereich === 'reime') return gruppeDialog(null);
  if (S.reimeBereich === 'zeilen') return zeileDialog(null);
  return textDialog(null);
}));

$('#reime-faerben').addEventListener('change', fangen(async (e) => {
  const feld = S.reimeBereich === 'zeilen' ? 'faerbenZeilen' : 'faerbenTexte';
  await post('/api/reime/anzeige', { [feld]: e.target.checked });
  await reimeLaden();
}));

$('#reime-such-auf').addEventListener('click', () => {
  $('#reime-suchblock').classList.toggle('versteckt');
});

$('#reime-liste').addEventListener('click', fangen(async (e) => {
  const silbe = e.target.closest('[data-silbe]');
  if (silbe) return silbeDialog(S.silbenRegister[Number(silbe.dataset.silbe)]);

  const gruppeEl = e.target.closest('[data-gruppe]');
  const gruppeId = gruppeEl ? gruppeEl.dataset.gruppe : null;

  if (e.target.closest('[data-gruppe-reim]')) return reimDialog(gruppeId, null);

  if (e.target.closest('[data-gruppe-sortieren]')) {
    await post('/api/reime/gruppe/sortieren', { gruppe: gruppeId });
    await reimeLaden();
    return toast('Nach Übereinstimmung sortiert');
  }

  if (e.target.closest('[data-gruppe-aendern]')) {
    return gruppeDialog(S.reimeDaten.gruppen.find((g) => g.id === gruppeId));
  }

  const weg = e.target.closest('[data-reim-weg]');
  if (weg) {
    await del(`/api/reime/eintrag?gruppe=${encodeURIComponent(gruppeId)}&id=${encodeURIComponent(weg.dataset.reimWeg)}`);
    await reimeLaden();
    return toast('Reim entfernt');
  }

  const zeileAendern = e.target.closest('[data-zeile-aendern]');
  if (zeileAendern) {
    return zeileDialog(S.reimeDaten.zeilen.find((z) => z.id === zeileAendern.dataset.zeileAendern));
  }

  const textAendern = e.target.closest('[data-text-aendern]');
  if (textAendern) {
    return textDialog(S.reimeDaten.texte.find((t) => t.id === textAendern.dataset.textAendern));
  }

  const rat = e.target.closest('[data-rat]');
  if (rat) return ratZeigen(rat);
  return null;
}));

/** Der kleine Haken unter jedem Reim: klappt die Vorschlagsliste auf. */
const ratZeigen = async (knopf) => {
  const behaelter = knopf.closest('.reim-zeile').querySelector('.reim-rat');
  if (!behaelter.classList.contains('versteckt')) {
    behaelter.classList.add('versteckt');
    knopf.classList.remove('aktiv');
    return;
  }

  const zeile = knopf.closest('[data-gruppe]');
  const d = await post('/api/reime/rat', {
    text: knopf.dataset.rat,
    ausser: [knopf.dataset.ratId],
    gruppe: zeile ? zeile.dataset.gruppe : ''
  });
  behaelter.innerHTML = d.vorschlaege.length
    ? `<p class="hinweis" style="margin:0 0 6px">Aus dem Bestand, ab ${d.mindest} aufeinanderfolgenden Silben:</p>
       ${d.vorschlaege.map((v) => `<div class="rat-zeile">
          <span class="reim-text">${esc(v.text)}</span>
          <span class="zeile-marke">${v.laenge} Silben am Stück</span>
          <button class="knopf knopf-still" data-rat-uebernehmen="${esc(v.text)}">Übernehmen</button>
        </div>`).join('')}`
    : '<p class="hinweis" style="margin:0">Nichts Passendes im Bestand.</p>';
  behaelter.classList.remove('versteckt');
  knopf.classList.add('aktiv');
};

$('#reime-liste').addEventListener('click', fangen(async (e) => {
  const uebernehmen = e.target.closest('[data-rat-uebernehmen]');
  if (!uebernehmen) return;
  const gruppeId = uebernehmen.closest('[data-gruppe]').dataset.gruppe;
  await post('/api/reime/eintrag', { gruppe: gruppeId, text: uebernehmen.dataset.ratUebernehmen });
  await reimeLaden();
  toast('Reim übernommen');
}));

/* ---- Silbensuche -------------------------------------------------------- */

const suchfelderBauen = () => {
  if ($('#such-silben').children.length) return;
  $('#such-silben').innerHTML = Array.from({ length: 10 }, (unused, i) => `
    <select class="feld feld-silbe" data-suchsilbe="${i}">
      <option value="">—</option>
      ${(S.reimeDaten ? S.reimeDaten.laute : []).map((l) => `<option value="${esc(l)}">${esc(l)}</option>`).join('')}
    </select>`).join('');
};

const reimeSuchen = async () => {
  const muster = [...$$('#such-silben [data-suchsilbe]')].map((f) => f.value).filter(Boolean);
  if (!muster.length) {
    $('#such-reime-info').textContent = 'Mindestens eine Silbe auswählen.';
    $('#such-reime-treffer').innerHTML = '';
    return;
  }

  const budget = Math.max(0, Number($('#such-budget').value) || 0);
  const nurEnde = $('#such-ende').checked;
  const d = await api(`/api/reime/suche?muster=${encodeURIComponent(muster.join(','))}&budget=${budget}&nurEnde=${nurEnde ? 1 : 0}`);

  S.silbenRegister = [];
  $('#such-reime-info').textContent = d.treffer.length
    ? `${d.treffer.length} Treffer für ${muster.join(' · ')}, bis zu ${budget} übersprungene ${budget === 1 ? 'Silbe' : 'Silben'}.`
    : `Nichts gefunden für ${muster.join(' · ')}.`;

  $('#such-reime-treffer').innerHTML = d.treffer.map((t) => `
    <div class="reim-zeile">
      <div class="reim-kopfzeile">
        <span class="reim-text">${esc(t.text)}</span>
        ${t.verbrauch ? `<span class="zeile-marke">${t.verbrauch} übersprungen</span>` : ''}
      </div>
      ${silbenRaster(t.silben, 0, t.stellen)}
    </div>`).join('');
};

$('#such-start').addEventListener('click', fangen(reimeSuchen));
$('#such-leeren').addEventListener('click', () => {
  $$('#such-silben [data-suchsilbe]').forEach((f) => { f.value = ''; });
  $('#such-budget').value = '0';
  $('#such-ende').checked = false;
  $('#such-reime-info').textContent = '';
  $('#such-reime-treffer').innerHTML = '';
});
$('#such-reime-treffer').addEventListener('click', (e) => {
  const silbe = e.target.closest('[data-silbe]');
  if (silbe) silbeDialog(S.silbenRegister[Number(silbe.dataset.silbe)]);
});

/* ================================================================ Eigene Reiter

   Eine Ansicht fuer alle selbst angelegten Reiter. Was sie zeigt, steht im
   Feldschema des Reiters — deshalb wird hier nichts fest verdrahtet, sondern
   alles aus `S.eigenDaten.felder` gebaut.                                    */

const FELD_LEER = '—';

const feldAnzeige = (feld, wert) => {
  if (wert === null || wert === undefined || wert === '') return FELD_LEER;
  if (feld.typ === 'haken') return wert ? 'ja' : 'nein';
  if (feld.typ === 'geld') return euro(Number(wert));
  if (feld.typ === 'datum') return formatDE(wert);
  return String(wert);
};

const eigenZeichnen = () => {
  const d = S.eigenDaten;
  if (!d) return;
  $('#eigen-titel').textContent = d.reiter.name;
  $('#eigen-richtung').textContent = S.eigenRichtung === 'ab' ? '↓' : '↑';

  const sort = $('#eigen-sort');
  sort.innerHTML = `<option value="">zuletzt angelegt</option>
    ${d.felder.map((f) => `<option value="${esc(f.id)}" ${f.id === S.eigenSort ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}`;

  if (!d.felder.length) {
    $('#eigen-leer').textContent = 'Dieser Reiter hat noch keine Felder. Anzulegen in den Einstellungen unter „Reiter".';
    $('#eigen-liste').innerHTML = '';
    return;
  }

  $('#eigen-leer').textContent = d.eintraege.length ? '' : 'Noch nichts eingetragen.';
  $('#eigen-liste').innerHTML = d.eintraege.map((e) => `
    <article class="karte" data-eigen="${esc(e.id)}">
      <h3 class="karte-titel">${esc(feldAnzeige(d.felder[0], e.werte[d.felder[0].id]))}</h3>
      <div class="karte-werte">
        ${d.felder.slice(1).map((f) => `
          <span class="karte-feld"><span class="karte-name">${esc(f.name)}</span>
          <span class="karte-wert">${esc(feldAnzeige(f, e.werte[f.id]))}</span></span>`).join('')}
      </div>
    </article>`).join('');
};

const eigenLaden = async () => {
  if (!S.eigenReiter) return;
  const teile = [`reiter=${encodeURIComponent(S.eigenReiter)}`, `richtung=${S.eigenRichtung}`];
  if (S.eigenSuche) teile.push(`suche=${encodeURIComponent(S.eigenSuche)}`);
  if (S.eigenSort) teile.push(`sortFeld=${encodeURIComponent(S.eigenSort)}`);
  S.eigenDaten = await api(`/api/eigen?${teile.join('&')}`);
  eigenZeichnen();
};

const eigenFeldEingabe = (feld, wert) => {
  const w = wert === undefined ? null : wert;
  if (feld.typ === 'mehrzeilig') {
    return `<textarea class="feld feld-hoch" data-feld="${esc(feld.id)}" rows="4">${esc(w || '')}</textarea>`;
  }
  if (feld.typ === 'haken') {
    return `<input type="checkbox" data-feld="${esc(feld.id)}" ${w ? 'checked' : ''}>`;
  }
  if (feld.typ === 'auswahl') {
    return `<select class="feld" data-feld="${esc(feld.id)}">
      <option value="">—</option>
      ${feld.optionen.map((o) => `<option value="${esc(o)}" ${o === w ? 'selected' : ''}>${esc(o)}</option>`).join('')}
    </select>`;
  }
  /* Zahl und Geld bewusst als Textfeld: ein `number`-Feld verwirft in
     deutscher Schreibweise getippte Kommazahlen stillschweigend. Umgerechnet
     wird beim Speichern in eigene.js. */
  const zahlig = feld.typ === 'zahl' || feld.typ === 'geld';
  const typ = feld.typ === 'datum' ? 'date' : 'text';
  const modus = zahlig ? ' inputmode="decimal"' : '';
  return `<input class="feld" type="${typ}"${modus} data-feld="${esc(feld.id)}" value="${esc(w === null ? '' : w)}">`;
};

const eigenDialog = (eintrag) => {
  const d = S.eigenDaten;
  dialogOeffnen(eintrag ? `${d.reiter.name} ändern` : `Neu in ${d.reiter.name}`,
    d.felder.map((f) => `<label class="dialog-feld">${esc(f.name)}${f.pflicht ? ' *' : ''}
      ${eigenFeldEingabe(f, eintrag ? eintrag.werte[f.id] : null)}</label>`).join(''),
    async () => {
      const werte = {};
      for (const f of d.felder) {
        const feld = $('#dialog-inhalt').querySelector(`[data-feld="${f.id}"]`);
        werte[f.id] = f.typ === 'haken' ? feld.checked : feld.value;
      }
      await post('/api/eigen', { reiter: S.eigenReiter, id: eintrag ? eintrag.id : null, werte });
      dialogSchliessen();
      await eigenLaden();
      toast('Gesichert');
    },
    eintrag ? async () => {
      if (!confirm('Diesen Eintrag löschen?')) return;
      await del(`/api/eigen?reiter=${encodeURIComponent(S.eigenReiter)}&id=${encodeURIComponent(eintrag.id)}`);
      dialogSchliessen();
      await eigenLaden();
      toast('Gelöscht');
    } : null);
};

$('#eigen-neu').addEventListener('click', fangen(() => {
  if (!S.eigenDaten || !S.eigenDaten.felder.length) throw new Error('Erst Felder anlegen — in den Einstellungen unter „Reiter".');
  eigenDialog(null);
}));

$('#eigen-liste').addEventListener('click', fangen((e) => {
  const karte = e.target.closest('[data-eigen]');
  if (!karte) return;
  eigenDialog(S.eigenDaten.eintraege.find((e) => e.id === karte.dataset.eigen));
}));

$('#eigen-suche').addEventListener('input', fangen(async (e) => {
  S.eigenSuche = e.target.value.trim();
  await eigenLaden();
}));

$('#eigen-sort').addEventListener('change', fangen(async (e) => {
  S.eigenSort = e.target.value || null;
  await eigenLaden();
}));

$('#eigen-richtung').addEventListener('click', fangen(async () => {
  S.eigenRichtung = S.eigenRichtung === 'ab' ? 'auf' : 'ab';
  await eigenLaden();
}));

/* ================================================================ Einstellungen
   für Reiter, Silbenfarben und Reimkategorien                                */

const reiterZeichnen = () => {
  $('#reiter-liste').innerHTML = S.reiter.map((r) => {
    const unbeweglich = ['start', 'einstellungen'].includes(r.id);
    return `<div class="kat-zeile" data-reiter="${esc(r.id)}">
      <input class="feld" type="text" value="${esc(r.name)}" data-name>
      <button class="knopf knopf-still" data-hoch title="nach vorn" ${unbeweglich ? 'disabled' : ''}>‹</button>
      <button class="knopf knopf-still" data-runter title="nach hinten" ${unbeweglich ? 'disabled' : ''}>›</button>
      <label class="dialog-schalter" title="${unbeweglich ? 'bleibt immer sichtbar' : 'in der Kopfleiste zeigen'}">
        <input type="checkbox" data-sichtbar ${r.sichtbar ? 'checked' : ''} ${unbeweglich ? 'disabled' : ''}> sichtbar
      </label>
      ${r.typ === 'eigen' ? `
        <label class="dialog-schalter" title="eigene Kachel auf der Startseite">
          <input type="checkbox" data-kachel ${r.kachel && r.kachel.aktiv ? 'checked' : ''}> Kachel
        </label>
        <button class="knopf knopf-still" data-felder>Felder (${(r.felder || []).length})</button>` : ''}
      <button class="knopf knopf-still" data-speichern>Sichern</button>
      ${r.typ === 'eigen' ? '<button class="knopf knopf-gefahr" data-loeschen>Löschen</button>' : ''}
    </div>`;
  }).join('');
};

/** Feldschema eines eigenen Reiters. Entfernte Felder verlieren keine Werte. */

const feldSchemaZeile = (f) => `<div class="feld-zeile" data-feld-zeile>
    <input class="feld" type="text" data-fname value="${esc(f ? f.name : '')}" placeholder="Feldname">
    <select class="feld" data-ftyp>
      ${(S.feldTypen || []).map((t) => `<option value="${esc(t.id)}" ${f && f.typ === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
    </select>
    <input class="feld" type="text" data-foptionen value="${esc(f ? (f.optionen || []).join(', ') : '')}" placeholder="Auswahl, mit Komma">
    <label class="dialog-schalter"><input type="checkbox" data-fpflicht ${f && f.pflicht ? 'checked' : ''}> Pflicht</label>
    <button type="button" class="knopf knopf-gefahr" data-fweg title="Feld entfernen">✕</button>
    <input type="hidden" data-fid value="${esc(f ? f.id : '')}">
  </div>`;

/* Ein Zuhoerer fuer alle Feldschema-Dialoge. Ihn im Dialog selbst anzuhaengen
   wuerde ihn bei jedem Oeffnen erneut anhaengen. */
$('#dialog-inhalt').addEventListener('click', (e) => {
  if (e.target.closest('[data-feld-neu]')) {
    $('#dialog-inhalt').querySelector('[data-felder-liste]').insertAdjacentHTML('beforeend', feldSchemaZeile(null));
  }
  const weg = e.target.closest('[data-fweg]');
  if (weg) weg.closest('[data-feld-zeile]').remove();
});

const felderDialog = (reiter) => {
  dialogOeffnen(`Felder von „${reiter.name}“`, `
    <p class="hinweis" style="margin-top:0">
      Die Reihenfolge hier ist die Reihenfolge im Dialog; das erste Feld ist die Überschrift
      der Karte. Ein entferntes Feld nimmt seine Werte nicht mit — legst du es wieder an,
      sind sie zurück.
    </p>
    <div data-felder-liste>${(reiter.felder || []).map(feldSchemaZeile).join('')}</div>
    <button type="button" class="knopf knopf-still" data-feld-neu>+ Feld</button>`,
  async () => {
    const felder = [...$('#dialog-inhalt').querySelectorAll('[data-feld-zeile]')].map((z) => ({
      id: z.querySelector('[data-fid]').value || undefined,
      name: z.querySelector('[data-fname]').value,
      typ: z.querySelector('[data-ftyp]').value,
      pflicht: z.querySelector('[data-fpflicht]').checked,
      optionen: z.querySelector('[data-foptionen]').value.split(',').map((o) => o.trim()).filter(Boolean)
    }));
    await post('/api/reiter', { id: reiter.id, felder });
    dialogSchliessen();
    await einstellungenLaden();
    toast('Felder gesichert');
  }, null);
};

$('#reiter-liste').addEventListener('click', fangen(async (e) => {
  const zeileEl = e.target.closest('[data-reiter]');
  if (!zeileEl) return;
  const id = zeileEl.dataset.reiter;
  const reiter = S.reiter.find((r) => r.id === id);

  if (e.target.closest('[data-felder]')) return felderDialog(reiter);

  if (e.target.closest('[data-speichern]')) {
    await post('/api/reiter', {
      id,
      name: zeileEl.querySelector('[data-name]').value,
      sichtbar: zeileEl.querySelector('[data-sichtbar]').checked,
      kachel: zeileEl.querySelector('[data-kachel]')
        ? { aktiv: zeileEl.querySelector('[data-kachel]').checked }
        : undefined
    });
    await einstellungenLaden();
    return toast('Reiter gesichert');
  }

  if (e.target.closest('[data-loeschen]')) {
    if (!confirm(`„${reiter.name}" mit allen Einträgen löschen? Das lässt sich nicht rückgängig machen.`)) return;
    await del(`/api/reiter?id=${encodeURIComponent(id)}`);
    if (S.eigenReiter === id) await ansichtWechseln('einstellungen');
    await einstellungenLaden();
    return toast('Reiter gelöscht');
  }

  const hoch = e.target.closest('[data-hoch]');
  const runter = e.target.closest('[data-runter]');
  if (hoch || runter) {
    const ids = S.reiter.map((r) => r.id);
    const stelle = ids.indexOf(id);
    const ziel = hoch ? stelle - 1 : stelle + 1;
    // Start und Einstellungen sind die Klammer; dazwischen darf getauscht werden.
    if (ziel <= 0 || ziel >= ids.length - 1) return null;
    [ids[stelle], ids[ziel]] = [ids[ziel], ids[stelle]];
    await post('/api/reiter/reihenfolge', { ids });
    await einstellungenLaden();
    return null;
  }
  return null;
}));

$('#reiter-anlegen').addEventListener('click', fangen(async () => {
  const name = $('#reiter-name').value.trim();
  if (!name) throw new Error('Name fehlt.');
  await post('/api/reiter', { name });
  $('#reiter-name').value = '';
  await einstellungenLaden();
  toast('Reiter angelegt');
}));

const farbenZeichnen = () => {
  const r = S.reimeEinst;
  if (!r) return;
  $('#laut-farben').innerHTML = r.laute.map((l) => `
    <label class="laut-feld">
      <span class="laut-name">${esc(l)}</span>
      <input class="feld feld-farbe" type="color" value="${esc(r.farben[l])}" data-laut="${esc(l)}">
    </label>`).join('');
  $('#reime-mindest').value = r.anzeige.mindestKette;
  $('#reime-faerben-zeilen').checked = r.anzeige.faerbenZeilen;
  $('#reime-faerben-texte').checked = r.anzeige.faerbenTexte;
};

$('#laut-farben').addEventListener('change', fangen(async (e) => {
  const feld = e.target.closest('[data-laut]');
  if (!feld) return;
  await post('/api/reime/anzeige', { farben: { [feld.dataset.laut]: feld.value } });
  await einstellungenLaden();
}));

const ZUFALLSTON = () => {
  const winkel = Math.floor(Math.random() * 360);
  return `hsl(${winkel} 75% 65%)`;
};

/** Aus einem hsl-Ton eine Hex-Angabe machen — gespeichert wird nur Hex. */
const alsHex = (farbe) => {
  const probe = document.createElement('span');
  probe.style.color = farbe;
  document.body.appendChild(probe);
  const [r, g, b] = getComputedStyle(probe).color.match(/\d+/g).map(Number);
  probe.remove();
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
};

$('#laut-wuerfeln').addEventListener('click', fangen(async () => {
  const farben = {};
  // Gleichmaessig ueber den Farbkreis verteilt und dann gedreht: rein zufaellige
  // Toene liegen zu oft zu dicht beieinander.
  const start = Math.floor(Math.random() * 360);
  S.reimeEinst.laute.forEach((l, i) => {
    const winkel = (start + Math.round((360 / S.reimeEinst.laute.length) * i)) % 360;
    farben[l] = alsHex(`hsl(${winkel} 75% 65%)`);
  });
  await post('/api/reime/anzeige', { farben });
  await einstellungenLaden();
  toast('Farben neu gewürfelt');
}));

$('#laut-zurueck').addEventListener('click', fangen(async () => {
  await post('/api/reime/anzeige', { farben: ANFANGSFARBEN });
  await einstellungenLaden();
  toast('Anfangsstand hergestellt');
}));

$('#reime-mindest').addEventListener('change', fangen(async (e) => {
  await post('/api/reime/anzeige', { mindestKette: Number(e.target.value) });
  await einstellungenLaden();
}));

$('#reime-faerben-zeilen').addEventListener('change', fangen(async (e) => {
  await post('/api/reime/anzeige', { faerbenZeilen: e.target.checked });
}));

$('#reime-faerben-texte').addEventListener('change', fangen(async (e) => {
  await post('/api/reime/anzeige', { faerbenTexte: e.target.checked });
}));

const rkatZeichnen = () => {
  const r = S.reimeEinst;
  if (!r) return;
  $$('#rkat-bereiche [data-bereich]').forEach((b) => b.classList.toggle('aktiv', b.dataset.bereich === S.rkatBereich));
  const liste = r.kategorien[S.rkatBereich] || [];
  $('#rkat-liste').innerHTML = liste.length ? liste.map((k) => `
    <div class="kat-zeile" data-rkat="${esc(k.id)}">
      <input class="feld feld-farbe" type="color" value="${esc(k.farbe)}" data-farbe>
      <input class="feld" type="text" value="${esc(k.name)}" data-name>
      <input class="feld" type="text" value="${esc(k.stichwoerter.join(', '))}" data-stich placeholder="Stichwörter">
      <button class="knopf knopf-still" data-speichern>Sichern</button>
      <button class="knopf knopf-gefahr" data-loeschen>Löschen</button>
    </div>`).join('')
    : leer('Noch keine Kategorie in diesem Reiter.');
};

$('#rkat-bereiche').addEventListener('click', (e) => {
  const knopf = e.target.closest('[data-bereich]');
  if (!knopf) return;
  S.rkatBereich = knopf.dataset.bereich;
  rkatZeichnen();
});

$('#rkat-liste').addEventListener('click', fangen(async (e) => {
  const zeileEl = e.target.closest('[data-rkat]');
  if (!zeileEl) return;
  const id = zeileEl.dataset.rkat;

  if (e.target.closest('[data-speichern]')) {
    await post('/api/reime/kategorie', {
      id,
      bereich: S.rkatBereich,
      name: zeileEl.querySelector('[data-name]').value,
      farbe: zeileEl.querySelector('[data-farbe]').value,
      stichwoerter: zeileEl.querySelector('[data-stich]').value.split(',')
    });
    await einstellungenLaden();
    return toast('Kategorie gesichert');
  }

  if (e.target.closest('[data-loeschen]')) {
    await del(`/api/reime/kategorie?bereich=${S.rkatBereich}&id=${encodeURIComponent(id)}`);
    await einstellungenLaden();
    return toast('Kategorie gelöscht');
  }
  return null;
}));

$('#rkat-anlegen').addEventListener('click', fangen(async () => {
  const name = $('#rkat-name').value.trim();
  if (!name) throw new Error('Name fehlt.');
  await post('/api/reime/kategorie', {
    bereich: S.rkatBereich,
    name,
    farbe: $('#rkat-farbe').value,
    stichwoerter: $('#rkat-stich').value.split(',')
  });
  $('#rkat-name').value = '';
  $('#rkat-stich').value = '';
  await einstellungenLaden();
  toast('Kategorie angelegt');
}));

// ---------------------------------------------------------------- Neu zeichnen

const neuZeichnen = async () => {
  await datenLaden();
  if (S.ansicht === 'start') return startLaden();
  if (S.ansicht === 'kalender') return monatLaden();
  if (S.ansicht === 'aufgaben') return aufgabenZeichnen();
  if (S.ansicht === 'tsz') return tszLaden();
  if (S.ansicht === 'finanzen') return finanzenLaden();
  if (S.ansicht === 'reime') return reimeLaden();
  if (S.eigenReiter) return eigenLaden();
  if (S.ansicht === 'suche') return suchen();
  if (S.ansicht === 'einstellungen') return katZeichnen();
  return null;
};

// ---------------------------------------------------------------- Start

/* Es gibt keine Sitzung mehr, die man wiederherstellen koennte: ohne Passwort
   im Speicher gibt es keinen Schluessel und damit keine lesbaren Daten. Beim
   Laden steht also immer die Passwortabfrage. Zu klaeren ist nur, ob es sich um
   die Ersteinrichtung handelt. */

(async () => {
  try {
    const gespiegelt = await spiegel.standHolen();
    const hatLokal = Boolean(gespiegelt.salz);
    const hatFern = Boolean(ablageHolen());
    torZeigen(!hatLokal && !hatFern);
  } catch (fehler) {
    $('#tor-fehler').textContent = fehler.message;
    torZeigen(true);
  }
})();

// Vor dem Schliessen noch schnell wegschreiben, damit die letzten Sekunden
// Tipperei nicht verloren gehen.
window.addEventListener('beforeunload', () => {
  if (sync.zustand.schmutzig) sync.sichern('Beim Schließen gesichert');
});
