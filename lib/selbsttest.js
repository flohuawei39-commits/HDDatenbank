/* Prueft die Teile, bei denen ein Fehler still bleibt: Datumsrechnung, Serien,
   Schnelleingabe, Kontoauszuege, Verschluesselung und Tagesmail.
   Aufruf: node lib/selbsttest.js

   Der Bestand liegt nur im Speicher (siehe store.js), der Test kann also gar
   nichts anfassen, was ausserhalb dieses Prozesses liegt. */

import * as D from './datum.js';
import * as wdh from './recurrence.js';
import * as quick from './quickparse.js';
import { suche } from './search.js';
import * as store from './store.js';
import * as mail from './mail.js';
import * as P from './pdf.js';
import * as banken from './banken.js';
import * as fin from './finanzen.js';
import * as gem from './gemeinden.js';
import * as krypto from './krypto.js';
import * as silben from './silben.js';
import * as reim from './reime.js';
import * as reimedaten from './reimedaten.js';
import * as eigene from './eigene.js';
import { sha256Hex } from './sha256.js';
import { createHash } from 'crypto';

let gelaufen = 0;
let gescheitert = 0;

const pruefe = (name, ist, soll) => {
  gelaufen += 1;
  const a = JSON.stringify(ist);
  const b = JSON.stringify(soll);
  if (a === b) return;
  gescheitert += 1;
  process.stdout.write(`FEHLER  ${name}\n        erwartet ${b}\n        bekommen ${a}\n`);
};

// ---------------------------------------------------------------- Datum

pruefe('plusTage über Monatsgrenze', D.plusTage('2026-07-31', 1), '2026-08-01');
pruefe('plusTage über Jahresgrenze', D.plusTage('2026-12-31', 1), '2027-01-01');
pruefe('plusMonate klemmt auf Monatsende', D.plusMonate('2026-01-31', 1), '2026-02-28');
pruefe('plusMonate im Schaltjahr', D.plusMonate('2028-01-31', 1), '2028-02-29');
pruefe('differenzTage', D.differenzTage('2026-07-25', '2026-08-04'), 10);
pruefe('wochentag Montag ist 0', D.wochentag('2026-07-27'), 0);
pruefe('wochentag Sonntag ist 6', D.wochentag('2026-07-26'), 6);

const gitter = D.monatsGitter(2026, 7);
pruefe('Monatsgitter beginnt an einem Montag', D.wochentag(gitter[0]), 0);
pruefe('Monatsgitter deckt den Monatsanfang ab', gitter.includes('2026-07-01'), true);
pruefe('Monatsgitter deckt das Monatsende ab', gitter.includes('2026-07-31'), true);
pruefe('Monatsgitter ist ein Vielfaches von sieben', gitter.length % 7, 0);

// Februar 2026 beginnt an einem Sonntag — der Fall, der gern zu kurz gerät.
const feb = D.monatsGitter(2026, 2);
pruefe('Februar deckt den 28. ab', feb.includes('2026-02-28'), true);

// ---------------------------------------------------------------- Serien

const einmalig = { datum: '2026-08-03', datumBis: null };
pruefe('einmaliger Eintrag im Zeitraum', wdh.vorkommen(einmalig, '2026-08-01', '2026-08-31').length, 1);
pruefe('einmaliger Eintrag ausserhalb', wdh.vorkommen(einmalig, '2026-09-01', '2026-09-30').length, 0);

const mehrtaegig = { datum: '2026-08-01', datumBis: '2026-08-05' };
pruefe('mehrtaegig deckt fuenf Tage', wdh.vorkommen(mehrtaegig, '2026-08-01', '2026-08-31')[0].tage.length, 5);
pruefe('mehrtaegig ragt in den Zeitraum hinein', wdh.vorkommen(mehrtaegig, '2026-08-04', '2026-08-31').length, 1);

const woechentlich = { datum: '2026-08-03', datumBis: null, wiederholung: { typ: 'woechentlich', intervall: 1, bis: null } };
pruefe('woechentlich im August', wdh.vorkommen(woechentlich, '2026-08-01', '2026-08-31').map((v) => v.start),
  ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24', '2026-08-31']);

const zweiwoechig = { datum: '2026-08-03', datumBis: null, wiederholung: { typ: 'woechentlich', intervall: 2, bis: null } };
pruefe('jede zweite Woche', wdh.vorkommen(zweiwoechig, '2026-08-01', '2026-08-31').map((v) => v.start),
  ['2026-08-03', '2026-08-17', '2026-08-31']);

const mitEnde = { datum: '2026-08-03', datumBis: null, wiederholung: { typ: 'woechentlich', intervall: 1, bis: '2026-08-15' } };
pruefe('Serienende wird eingehalten', wdh.vorkommen(mitEnde, '2026-08-01', '2026-08-31').map((v) => v.start),
  ['2026-08-03', '2026-08-10']);

const monatlich = { datum: '2026-01-31', datumBis: null, wiederholung: { typ: 'monatlich', intervall: 1, bis: null } };
pruefe('monatlich vom 31. trifft Februar', wdh.vorkommen(monatlich, '2026-02-01', '2026-02-28').map((v) => v.start), ['2026-02-28']);

// Alte Serie, weit entfernter Zeitraum: der Sprung nach vorn darf nichts verlieren.
const alt = { datum: '2020-01-01', datumBis: null, wiederholung: { typ: 'taeglich', intervall: 1, bis: null } };
pruefe('alte Tagesserie liefert genau die Zeitraumtage', wdh.vorkommen(alt, '2026-07-01', '2026-07-07').length, 7);

const jaehrlich = { datum: '2020-03-15', datumBis: null, wiederholung: { typ: 'jaehrlich', intervall: 1, bis: null } };
pruefe('jaehrlich trifft das Zieljahr', wdh.vorkommen(jaehrlich, '2026-01-01', '2026-12-31').map((v) => v.start), ['2026-03-15']);

pruefe('naechstes Vorkommen ab heute', wdh.naechstes(woechentlich, '2026-08-04').start, '2026-08-10');

// ---------------------------------------------------------------- Schnelleingabe

const KATS = [{ id: 'kat_can', name: 'Can' }, { id: 'kat_privat', name: 'Privat' }];
const HEUTE = '2026-07-25'; // ein Samstag

const p1 = quick.parse('morgen 14 Uhr Zahnarzt !hoch #Privat', KATS, HEUTE);
pruefe('morgen wird gelesen', p1.datum, '2026-07-26');
pruefe('Uhrzeit wird gelesen', p1.uhrzeit, '14:00');
pruefe('Prioritaet wird gelesen', p1.prioritaet, 'hoch');
pruefe('Kategorie wird gelesen', p1.kategorie, 'kat_privat');
pruefe('Resttext bleibt sauber', p1.text, 'Zahnarzt');

/* Die Art. `!frist` gab es schon vor den Arten und muss beides setzen, sonst
   verschwinden bestehende Fristen aus der Fristenkachel. Die Marken werden vor
   der Prioritaet ausgewertet, weil deren `!wort` sie sonst wegschluckt. */
const pArt = quick.parse('!termin morgen 14:30 Tierarzt', KATS, HEUTE);
pruefe('!termin setzt die Art', pArt.art, store.ART_TERMIN);
pruefe('und laesst den Text in Ruhe', pArt.text, 'Tierarzt');
pruefe('und die Uhrzeit auch', pArt.uhrzeit, '14:30');

const pAufgabe = quick.parse('!aufgabe !hoch Steuer sortieren', KATS, HEUTE);
pruefe('!aufgabe setzt die Art', pAufgabe.art, store.ART_AUFGABE);
pruefe('neben der Prioritaet', pAufgabe.prioritaet, 'hoch');
pruefe('Text bleibt sauber', pAufgabe.text, 'Steuer sortieren');

const pFrist = quick.parse('!frist 30.09.2026 Antrag abgeben', KATS, HEUTE);
pruefe('!frist setzt die Art', pFrist.art, store.ART_FRIST);
pruefe('und weiterhin den alten Haken', pFrist.istFrist, true);
pruefe('ohne Marke bleibt die Art offen', quick.parse('irgendwas', KATS, HEUTE).art, null);

const p2 = quick.parse('3.8. Can gehäutet #can', KATS, HEUTE);
pruefe('Tag.Monat wird gelesen', p2.datum, '2026-08-03');
pruefe('Kategorie unabhaengig von Gross- und Kleinschreibung', p2.kategorie, 'kat_can');
pruefe('Text ohne Kategoriemarke', p2.text, 'Can gehäutet');

const p3 = quick.parse('26.07.2026 10:30 Gemeinde Musterdorf', KATS, HEUTE);
pruefe('volles Datum wird gelesen', p3.datum, '2026-07-26');
pruefe('Doppelpunkt-Zeit wird gelesen', p3.uhrzeit, '10:30');

const p4 = quick.parse('1.8. bis 5.8. Urlaub', KATS, HEUTE);
pruefe('Zeitraum Start', p4.datum, '2026-08-01');
pruefe('Zeitraum Ende', p4.datumBis, '2026-08-05');
pruefe('Zeitraum Text', p4.text, 'Urlaub');

const p5 = quick.parse('jeden montag Sport', KATS, HEUTE);
pruefe('jeden Montag setzt Wochenserie', p5.wiederholung.typ, 'woechentlich');
pruefe('jeden Montag trifft den naechsten Montag', p5.datum, '2026-07-27');

const p6 = quick.parse('15.8. Förderantrag !frist', KATS, HEUTE);
pruefe('Fristmarke wird erkannt', p6.istFrist, true);
pruefe('Fristtext bleibt', p6.text, 'Förderantrag');

const p7 = quick.parse('3.1. Steuer', KATS, HEUTE);
pruefe('Datum weit in der Vergangenheit rollt ins Folgejahr', p7.datum, '2027-01-03');

const p8 = quick.parse('montag 9 Uhr Termin', KATS, HEUTE);
pruefe('Wochentag ohne Zusatz trifft den naechsten', p8.datum, '2026-07-27');
pruefe('Stunde ohne Minuten', p8.uhrzeit, '09:00');

const p9 = quick.parse('Rückruf Amt', KATS, HEUTE);
pruefe('ohne Datum faellt auf heute zurueck', p9.datum, HEUTE);
pruefe('und sagt es auch', p9.hinweise.length > 0, true);

const p10 = quick.parse('morgen 14.30 Uhr Physio', KATS, HEUTE);
pruefe('Punktzeit mit Uhr wird nicht als Datum gelesen', p10.datum, '2026-07-26');
pruefe('Punktzeit ergibt die Uhrzeit', p10.uhrzeit, '14:30');

const p11 = quick.parse('morgen Sport #Sportverein', KATS, HEUTE);
pruefe('unbekannte Kategorie warnt statt zu raten', p11.hinweise.length > 0, true);

// ---------------------------------------------------------------- Suche

const bestand = {
  entries: [
    { id: 'a', datum: '2026-07-01', text: 'Futter Maus angenommen', kategorie: 'kat_can' },
    { id: 'b', datum: '2026-07-20', text: 'Futter verweigert', kategorie: 'kat_can' },
    { id: 'c', datum: '2026-07-10', text: 'Zahnarzt', kategorie: 'kat_privat' }
  ],
  kategorien: KATS,
  tasks: [{ id: 't1', titel: 'Futter bestellen', notiz: '', faellig: '2026-08-01', erstellt: '2026-07-01' }]
};

const s1 = suche('futter', bestand, 'alle');
pruefe('Suche findet beide Eintraege', s1.entries.map((e) => e.id), ['b', 'a']);
pruefe('Suche findet auch die Aufgabe', s1.tasks.length, 1);

const s2 = suche('futter', bestand, 'kat_privat');
pruefe('Suche in einer Kategorie grenzt ein', s2.entries.length, 0);

const s3 = suche('gehäutet', { entries: [{ id: 'x', datum: '2026-07-05', text: 'Can gehaeutet' }], kategorien: [], tasks: [] }, 'alle');
pruefe('Umlaute und Umschrift finden einander', s3.entries.length, 1);

const s4 = suche('futter maus', bestand, 'alle');
pruefe('mehrere Woerter muessen alle passen', s4.entries.map((e) => e.id), ['a']);

// ---------------------------------------------------------------- Tagesmail


pruefe('leerer Bestand ergibt keine Mail', mail.bauen({ entries: [], tasks: [], gemeinden: [], kategorien: [] }, HEUTE).leer, true);

const mailBestand = {
  kategorien: KATS,
  entries: [
    { id: 'e1', datum: HEUTE, uhrzeit: '09:00', text: 'Zahnarzt', kategorie: 'kat_privat', prioritaet: 'hoch' },
    { id: 'e2', datum: '2026-07-26', uhrzeit: null, text: 'Sport', prioritaet: 'mittel' },
    { id: 'e3', datum: '2026-08-01', text: 'Steuervorauszahlung', istFrist: true, prioritaet: 'hoch' },
    { id: 'e4', datum: '2026-08-01', text: 'in genau sieben Tagen', prioritaet: 'gering' },
    { id: 'e5', datum: HEUTE, text: 'schon erledigt', erledigt: true, prioritaet: 'mittel' }
  ],
  tasks: [
    { id: 't1', titel: 'Förderrichtlinien lesen', status: 'offen', prioritaet: 'hoch', faellig: '2026-07-23' },
    { id: 't2', titel: 'irgendwann', status: 'offen', prioritaet: 'gering', faellig: null }
  ],
  gemeinden: [
    { id: 'g1', name: 'Musterdorf', fristen: [
      { id: 'f1', datum: '2026-07-28', text: 'Antragsfrist', erledigt: false },
      { id: 'f2', datum: '2026-07-27', text: 'längst erledigt', erledigt: true },
      { id: 'f3', datum: '2026-09-30', text: 'weit weg', erledigt: false }
    ] }
  ]
};

const nachricht = mail.bauen(mailBestand, HEUTE);
pruefe('Mail wird gebaut', nachricht.leer, false);
pruefe('Betreff nennt die Fristenzahl', nachricht.betreff, 'HDDatenbank 25.7.2026 — 2 Fristen');
pruefe('Termin von heute steht drin', nachricht.text.includes('09:00 Zahnarzt'), true);
pruefe('erledigter Termin steht nicht drin', nachricht.text.includes('schon erledigt'), false);
pruefe('Gemeindefrist steht drin mit Quelle', nachricht.text.includes('Antragsfrist — Musterdorf'), true);
pruefe('erledigte Gemeindefrist fehlt', nachricht.text.includes('längst erledigt'), false);
pruefe('Frist ausserhalb von 14 Tagen fehlt', nachricht.text.includes('weit weg'), false);
pruefe('ueberfaellige Aufgabe wird als solche benannt', nachricht.text.includes('überfällig seit 2 Tagen'), true);
pruefe('Morgen-Block ist da', nachricht.text.includes('MORGEN — 26.7.2026'), true);
pruefe('Sieben-Tage-Block ist da', nachricht.text.includes('IN 7 TAGEN — 1.8.2026'), true);
pruefe('Aufgabe ohne Datum taucht nicht als faellig auf', nachricht.text.includes('irgendwann'), false);

const verspaetet = mail.bauen(mailBestand, HEUTE, true);
pruefe('verspaetete Mail sagt es', verspaetet.text.includes('Nachträglich verschickt'), true);

// Versandauftrag: der Server entscheidet nur, WANN. Geschickt wird im Browser.
const holen = () => mailBestand;
const configSetzen = (m) => store.write('config.json', { eingerichtetAm: 'x', mail: m });

configSetzen({ aktiv: false, schluessel: 'k', empfaenger: 'a@b.de', uhrzeit: '07:00' });
pruefe('ausgeschaltet ergibt keinen Auftrag', mail.auftrag(holen, '09:00').faellig, false);

configSetzen({ aktiv: true, schluessel: null, empfaenger: 'a@b.de', uhrzeit: '07:00' });
pruefe('ohne Schluessel kein Auftrag', mail.auftrag(holen, '09:00').grund, 'Kein Zugangsschlüssel hinterlegt.');

configSetzen({ aktiv: true, schluessel: 'k', empfaenger: 'a@b.de', uhrzeit: '07:00' });
pruefe('vor der Uhrzeit kein Auftrag', mail.auftrag(holen, '06:30').grund, 'noch zu früh');

configSetzen({ aktiv: true, schluessel: 'k', empfaenger: 'a@b.de', uhrzeit: '07:00' });
const a1 = mail.auftrag(holen, '07:05');
pruefe('nach der Uhrzeit gibt es einen Auftrag', a1.faellig, true);
pruefe('Auftrag traegt den Schluessel fuer den Browser', a1.schluessel, 'k');
pruefe('punktlich gilt nicht als verspaetet', a1.verspaetet, false);
pruefe('zweiter Abruf ist waehrend des Versands gesperrt', mail.auftrag(holen, '07:05').grund, 'Versand läuft gerade');

mail.quittieren(false, 'Netzwerk weg');
const a2 = mail.auftrag(holen, '07:05');
pruefe('nach Fehlschlag darf erneut versucht werden', a2.faellig, true);
pruefe('Fehler wird vermerkt', store.read('config.json').mail.letzterFehler.includes('Netzwerk weg'), true);

mail.quittieren(true);
pruefe('nach Erfolg ist der Tag erledigt', mail.auftrag(holen, '08:00').grund, 'heute schon verschickt');
pruefe('Fehler ist nach Erfolg geloescht', store.read('config.json').mail.letzterFehler, null);

configSetzen({ aktiv: true, schluessel: 'k', empfaenger: 'a@b.de', uhrzeit: '07:00' });
pruefe('deutlich spaeter gilt als verspaetet', mail.auftrag(holen, '14:00').verspaetet, true);

// Leerer Bestand: der Tag wird abgehakt, ohne dass etwas verschickt wird.
mail.quittieren(false, 'Test raeumt die Sperre auf');
configSetzen({ aktiv: true, schluessel: 'k', empfaenger: 'a@b.de', uhrzeit: '07:00' });
const leerAuftrag = mail.auftrag(() => ({ entries: [], tasks: [], gemeinden: [], kategorien: [] }), '09:00');
pruefe('ohne Inhalt kein Versand', leerAuftrag.faellig, false);
pruefe('und der Tag gilt trotzdem als erledigt', store.read('config.json').mail.letzterVersand, store.heute());


// ---------------------------------------------------------------- Zahlen und Daten aus PDF


pruefe('deutsche Zahl mit Tausenderpunkt', P.zahl('-1.064,35€'), -1064.35);
pruefe('positive Zahl mit Plus', P.zahl('+2,42€'), 2.42);
pruefe('Zahl ohne Waehrung', P.zahl('910,98'), 910.98);
pruefe('kein Betrag in reinem Text', P.zahl('Referenz: Ruckzahlung'), null);
pruefe('Datum lang', P.deutschesDatum('25. Juli 2026'), '2026-07-25');
pruefe('Datum lang mit Umlaut', P.deutschesDatum('3. März 2026'), '2026-03-03');
pruefe('Datum mit Punkten', P.punktDatum('01.03.2026'), '2026-03-01');
pruefe('kein Datum', P.punktDatum('kein Datum hier'), null);

// Zeilenbildung: Text und Betrag liegen wenige Punkte auseinander und gehoeren zusammen.
const zeilen = P.zuZeilen([
  { x: 44, y: 672, breite: 106, rechts: 150, text: 'REWE Stuttgart/Sta' },
  { x: 391, y: 670, breite: 57, rechts: 448, text: '01.03.2026' },
  { x: 514, y: 670, breite: 38, rechts: 552, text: '-11,09€' },
  { x: 44, y: 658, breite: 158, rechts: 202, text: 'Business Mastercard • Lebensmittel' }
]);
pruefe('nahe Hoehen ergeben eine Zeile', zeilen.length, 2);
pruefe('Zeileninhalt in x-Reihenfolge', zeilen[0].text, 'REWE Stuttgart/Sta 01.03.2026 -11,09€');
pruefe('Betrag wird in seiner Spalte gefunden', P.betragInSpalte(zeilen[0], 552, 14).wert, -11.09);
pruefe('in der falschen Spalte nicht', P.betragInSpalte(zeilen[0], 417, 12), null);
pruefe('Text links der Grenze', P.linksVon(zeilen[0], 350), 'REWE Stuttgart/Sta');

// ---------------------------------------------------------------- Auszugsleser


// Seite aus Textstuecken bauen: [x, y, breite, Text]
const seite = (stuecke) => ({
  nummer: 1,
  zeilen: P.zuZeilen(stuecke.map(([x, y, breite, text]) => ({ x, y, breite, rechts: x + breite, text })))
});

const N26_FUSS = [
  [43, 69, 129, 'FLORIAN LUDWIG KURATLE'],
  [43, 54, 185, 'Ottmarsheimer Straße 18, 70439 Stuttgart'],
  [43, 38, 243, 'IBAN: DE60100110012626063244 • BIC: NTSBDEB1XXX'],
  [524, 21, 29, '1 / 2']
];

const n26Seiten = [
  seite([
    [44, 784, 191, 'Kontoauszug Nr. 03/2026'],
    [44, 750, 118, '01.03.2026 bis 31.03.2026'],
    [45, 698, 73, 'Beschreibung'], [342, 698, 106, 'Verbuchungsdatum'], [515, 698, 36, 'Betrag'],

    [44, 672, 106, 'REWE Stuttgart/Sta'],
    [391, 670, 57, '01.03.2026'], [514, 670, 38, '-11,09€'],
    [44, 658, 158, 'Business Mastercard • Lebensmittel'],
    [44, 642, 107, 'Wertstellung 28.02.2026'],

    // Letzte Buchung der Seite — direkt vor der Fusszeile.
    [44, 268, 77, 'TOM BERODT'],
    [388, 266, 60, '04.03.2026'], [500, 266, 52, '+100,00€'],
    [44, 255, 55, 'Gutschriften'],
    [44, 239, 248, 'IBAN: DE32200505501501208316 • BIC: HASPDEHHXXX'],
    [44, 223, 38, 'Leihgeld'],
    [44, 207, 108, 'Wertstellung 04.03.2026'],
    ...N26_FUSS
  ]),
  seite(N26_FUSS)
];

pruefe('N26 wird erkannt', banken.istN26(n26Seiten), true);
const n26 = banken.n26Lesen(n26Seiten);
pruefe('N26 findet beide Buchungen', n26.buchungen.length, 2);
pruefe('N26 liest Ausgabe mit Vorzeichen', n26.buchungen[0].betrag, -11.09);
pruefe('N26 liest Einnahme', n26.buchungen[1].betrag, 100);
pruefe('N26 liest die Kategorie nach dem Trennzeichen', n26.buchungen[0].kategorieVorschlag, 'Lebensmittel');
pruefe('N26 nimmt eine Kategorie auch ohne Trennzeichen', n26.buchungen[1].kategorieVorschlag, 'Gutschriften');
pruefe('N26 liest die Wertstellung', n26.buchungen[0].wertstellung, '2026-02-28');
// Der Fehler, der hier abgesichert wird: die letzte Buchung einer Seite zog die Fusszeile mit.
pruefe('N26 laesst die Fusszeile draußen', /KURATLE|Ottmarsheimer/.test(n26.buchungen[1].verwendung || ''), false);
pruefe('N26 behaelt den echten Verwendungszweck', n26.buchungen[1].verwendung.includes('Leihgeld'), true);
pruefe('N26 nimmt die eigene IBAN, nicht die des Gegenkontos', n26.konto, 'DE60100110012626063244');
pruefe('N26 liest den Zeitraum', `${n26.von}/${n26.bis}`, '2026-03-01/2026-03-31');

const WISE_FUSS = [
  [42, 100, 468, 'Wise ist der Handelsname von Wise Europe SA, einem in Belgien autorisierten Zahlungsinstitut.'],
  [42, 80, 121, 'ref:7e6d9e24-ac97-483c-5fbb-b1d6126b3732'],
  [520, 60, 24, '2 / 2']
];

const wiseSeiten = [seite([
  [42, 762, 107, 'Wise Europe SA'],
  [42, 652, 107, 'EUR-Auszug'],
  [42, 626, 252, '1. Juli 2026 [GMT+02:00] - 26. Juli 2026 [GMT+02:00]'],
  [228, 554, 75, 'BE79 9058 7215 8733'],
  [43, 409, 49, 'Beschreibung'], [379, 409, 37, 'Eingehend'], [444, 409, 40, 'Ausgehend'], [529, 409, 24, 'Betrag'],

  [42, 385, 153, 'Geld überwiesen an Domenick Schmidt'],
  [462, 383, 23, '-12,00'], [529, 383, 24, '910,98'],
  [42, 372, 200, '25. Juli 2026 Transaktion: TRANSFER-2270398955 Referenz: Danke'],

  [42, 312, 275, 'Einzahlung von STEFAN REMMERT'],
  [392, 310, 25, '250,00'], [528, 310, 26, '922,98'],
  [42, 299, 200, '20. Juli 2026 Transaktion: TRANSFER-2259949891'],

  // Zeile zum verzinsten Guthaben — keine Zahlung, darf nicht als Buchung zaehlen.
  [42, 288, 276, '2.3157 Einheiten gekauft für 107.96 EUR pro Einheit am 20. Juli 2026 | Asset 1'],

  // Letzte Buchung vor dem Seitenfuss.
  [42, 200, 143, 'Gebühr von Wise Assets Europe'],
  [467, 198, 18, '-0,03'], [528, 198, 25, '672,98'],
  [42, 188, 160, '2. Juli 2026 Transaktion: FEE-1'],
  ...WISE_FUSS
])];

pruefe('Wise wird erkannt', banken.istWise(wiseSeiten), true);
const wise = banken.wiseLesen(wiseSeiten);
pruefe('Wise findet drei Buchungen', wise.buchungen.length, 3);
pruefe('Spalte Ausgehend ergibt ein Minus', wise.buchungen[0].betrag, -12);
pruefe('Spalte Eingehend ergibt ein Plus', wise.buchungen[1].betrag, 250);
pruefe('Wise liest das Datum aus der Folgezeile', wise.buchungen[0].datum, '2026-07-25');
pruefe('Wise liest die Referenz', wise.buchungen[0].verwendung, 'Danke');
pruefe('Wise merkt sich den laufenden Saldo', wise.buchungen[0].saldo, 910.98);
// Derselbe Fehler wie oben, andere Bank.
pruefe('Wise laesst den Seitenfuss draußen', wise.buchungen[2].text, 'Gebühr von Wise Assets Europe');
pruefe('Wise ignoriert Zeilen zum verzinsten Guthaben',
  wise.buchungen.some((b) => /Einheiten gekauft/.test(b.text)), false);
pruefe('Wise liest die eigene IBAN', wise.konto, 'BE79905872158733');

// Saldokette: eine fehlende Buchung muss auffallen.
const heil = banken.pruefen({ buchungen: [
  { betrag: -12, saldo: 910.98 }, { betrag: 250, saldo: 922.98 }
], kontrolle: {} });
pruefe('heile Saldokette gilt als stimmig', heil.pruefung.stimmt, true);

const kaputt = banken.pruefen({ buchungen: [
  { betrag: -12, saldo: 910.98 }, { betrag: 250, saldo: 700.00 }
], kontrolle: {} });
pruefe('gebrochene Saldokette faellt auf', kaputt.pruefung.stimmt, false);
pruefe('und wird benannt', /bricht an 1/.test(kaputt.pruefung.hinweis), true);

pruefe('fremdes PDF wird abgelehnt', Boolean(banken.auswerten([seite([[10, 700, 50, 'Irgendein Brief']])]).fehler), true);

// ---------------------------------------------------------------- Finanzen


const B1 = { datum: '2026-03-01', text: 'REWE Stuttgart/Sta', betrag: -11.09, waehrung: 'EUR' };
const B2 = { datum: '2026-03-01', text: 'REWE Stuttgart/Sta', betrag: -11.09, waehrung: 'EUR' };
const mitKennung = fin.kennungenVergeben('N26', 'DE60', [B1, B2]);
pruefe('gleiche Buchung zweimal am selben Tag bekommt zwei Kennungen',
  mitKennung[0].kennung !== mitKennung[1].kennung, true);
pruefe('dieselbe Liste ergibt wieder dieselben Kennungen',
  fin.kennungenVergeben('N26', 'DE60', [B1, B2]).map((b) => b.kennung), mitKennung.map((b) => b.kennung));
pruefe('anderes Konto ergibt andere Kennung',
  fin.kennungenVergeben('N26', 'DE99', [B1])[0].kennung !== mitKennung[0].kennung, true);

const regeln = [{ id: 'r1', muster: 'REWE', kategorie: 'fk_lebensmittel', bereich: null }];
pruefe('Regel trifft unabhaengig von Gross- und Kleinschreibung',
  fin.regelPasst(regeln[0], { text: 'rewe markt', verwendung: null }), true);
pruefe('Regel trifft auch im Verwendungszweck',
  fin.regelPasst(regeln[0], { text: 'Kartenzahlung', verwendung: 'REWE Filiale 42' }), true);
pruefe('Regel trifft Fremdes nicht',
  fin.regelPasst(regeln[0], { text: 'Aldi', verwendung: null }), false);

const kategorien = fin.START_KATEGORIEN;
pruefe('eigene Regel schlaegt die Angabe der Bank',
  fin.vorschlagen({ text: 'REWE', kategorieVorschlag: 'Shopping' }, { regeln, kategorien }).kategorie, 'fk_lebensmittel');
pruefe('ohne Regel gilt die Kategorie aus dem Auszug',
  fin.vorschlagen({ text: 'Rossmann', kategorieVorschlag: 'Gesundheit & Drogerien' }, { regeln: [], kategorien }).kategorie, 'fk_gesundheit');
pruefe('unbekannte Kategorie wird gemeldet statt geraten',
  fin.vorschlagen({ text: 'X', kategorieVorschlag: 'Völlig neu' }, { regeln: [], kategorien }).neueKategorie, 'Völlig neu');
pruefe('ohne alles bleibt es leer',
  fin.vorschlagen({ text: 'X', kategorieVorschlag: null }, { regeln: [], kategorien }).kategorie, null);

// Auswertung inklusive Umbuchung — Geld zwischen eigenen Konten ist kein Umsatz.
store.write('finanzen.json', {
  kategorien,
  regeln: [],
  importe: [],
  buchungen: [
    { id: 'b1', datum: '2026-03-05', text: 'Lohn', betrag: 2000, kategorie: 'fk_einnahme', bereich: 'privat', umbuchung: false, bank: 'N26' },
    { id: 'b2', datum: '2026-03-06', text: 'REWE', betrag: -50, kategorie: 'fk_lebensmittel', bereich: 'privat', umbuchung: false, bank: 'N26' },
    { id: 'b3', datum: '2026-03-07', text: 'Hosting', betrag: -20, kategorie: 'fk_beruf', bereich: 'geschaeftlich', umbuchung: false, bank: 'N26' },
    { id: 'b4', datum: '2026-03-08', text: 'zu Wise', betrag: -500, kategorie: null, bereich: 'privat', umbuchung: true, bank: 'N26' },
    { id: 'b5', datum: '2026-04-02', text: 'anderer Monat', betrag: -9, kategorie: null, bereich: 'privat', umbuchung: false, bank: 'N26' }
  ]
});

const maerz = fin.auswertung({ von: '2026-03-01', bis: '2026-03-31' });
pruefe('Einnahmen im Monat', maerz.einnahmen, 2000);
pruefe('Ausgaben ohne die Umbuchung', maerz.ausgaben, 70);
pruefe('Saldo', maerz.saldo, 1930);
pruefe('Umbuchung wird gezaehlt, aber nicht gewertet', maerz.umbuchungen, 1);
pruefe('anderer Monat bleibt draussen', maerz.anzahl, 4);
pruefe('groesste Ausgabenkategorie zuerst', maerz.jeKategorie[0].kategorie, 'fk_lebensmittel');

const nurGeschaeft = fin.auswertung({ von: '2026-03-01', bis: '2026-03-31', bereich: 'geschaeftlich' });
pruefe('Filter auf geschaeftlich', nurGeschaeft.ausgaben, 20);
pruefe('und keine privaten Einnahmen', nurGeschaeft.einnahmen, 0);

const alles = fin.auswertung({});
pruefe('ohne Zeitraum alle Buchungen', alles.anzahl, 5);
pruefe('zwei Monate in der Monatsreihe', alles.jeMonat.length, 2);

const k = fin.kachel('2026-03-15');
pruefe('Kachel nimmt den laufenden Monat', k.monat, '2026-03');
// Bewusst ueber den ganzen Bestand gezaehlt, nicht nur den Monat: das ist eine Aufgabenzahl.
// Umbuchungen bleiben aussen vor, die brauchen keine Kategorie.
pruefe('Kachel zaehlt offene Zuordnungen ohne Umbuchungen', k.ohneKategorie, 1);
pruefe('Kachel erkennt, dass Daten da sind', k.hatDaten, true);

// ------------------------------------------------- Finanzkategorien anlegen

const vorher = fin.lesen().kategorien.length;
const angelegt = fin.kategorieSpeichern({ name: 'Tierarzt', farbe: '#ff5fd2' });
pruefe('Kategorie wird angelegt', angelegt.kategorien.length, vorher + 1);

const neueId = angelegt.kategorien[angelegt.kategorien.length - 1].id;
pruefe('mit der gewaehlten Farbe', angelegt.kategorien[angelegt.kategorien.length - 1].farbe, '#ff5fd2');
pruefe('Kategorie ohne Namen wird abgelehnt', Boolean(fin.kategorieSpeichern({ name: '  ' }).fehler), true);
pruefe('unsinnige Farbe faellt auf Grau zurueck',
  fin.kategorieSpeichern({ id: neueId, name: 'Tierarzt', farbe: 'blau' }).kategorien.find((x) => x.id === neueId).farbe, '#636872');
pruefe('Umbenennen legt nichts Neues an',
  fin.kategorieSpeichern({ id: neueId, name: 'Tierarztkosten', farbe: '#ff5fd2' }).kategorien.length, vorher + 1);
pruefe('freie Kategorie laesst sich loeschen', fin.kategorieLoeschen(neueId).ok, true);
// fk_lebensmittel haengt an Buchungen aus dem Abschnitt darueber.
pruefe('belegte Kategorie ist gesperrt', Boolean(fin.kategorieLoeschen('fk_lebensmittel').fehler), true);

// ------------------------------------------------- Gemeinde-Aufgaben

store.write('gemeinden.json', { gemeinden: [] });

const angelegteGemeinde = gem.speichern({ name: 'Musterdorf', stand: 'gespraech' }).gemeinde;
const G = angelegteGemeinde.id;

pruefe('Aufgabe ohne Datum wird angenommen',
  gem.fristSpeichern({ gemeindeId: G, text: 'Förderrichtlinie lesen', datum: null }).ok, true);
pruefe('Aufgabe ohne Text wird abgelehnt',
  Boolean(gem.fristSpeichern({ gemeindeId: G, text: '  ', datum: null }).fehler), true);
pruefe('Aufgabe mit Datum wird angenommen',
  gem.fristSpeichern({ gemeindeId: G, text: 'Antrag abgeben', datum: '2026-08-04' }).ok, true);
pruefe('erledigte Aufgabe wird angenommen',
  gem.fristSpeichern({ gemeindeId: G, text: 'alter Punkt', datum: '2026-07-01', erledigt: true }).ok, true);

const status = gem.mitStatus(gem.lesen()[0], HEUTE);
pruefe('offene Aufgaben werden gezaehlt, erledigte nicht', status.offeneAufgaben, 2);
pruefe('datierte Aufgabe steht vorn', status.aufgabenListe[0].text, 'Antrag abgeben');
pruefe('undatierte Aufgabe steht hinten', status.aufgabenListe[1].datum, null);
pruefe('undatierte Aufgabe hat keine Restlaufzeit', status.aufgabenListe[1].tageBis, null);
pruefe('naechste Frist sieht nur datierte', status.naechsteFrist.text, 'Antrag abgeben');

// Der springende Punkt: ohne Datum kein Auftritt in Signalzeile und Tagesmail.
const imFenster = gem.fristen(HEUTE, D.plusTage(HEUTE, 14));
pruefe('Fristenfenster enthaelt nur die datierte Aufgabe', imFenster.map((f) => f.text), ['Antrag abgeben']);
pruefe('erledigte Aufgabe bleibt draussen', imFenster.some((f) => f.text === 'alter Punkt'), false);

const mailMitGemeinde = mail.bauen({
  entries: [], tasks: [], kategorien: [], gemeinden: gem.lesen()
}, HEUTE);
pruefe('Tagesmail nennt die datierte Aufgabe', mailMitGemeinde.text.includes('Antrag abgeben'), true);
pruefe('Tagesmail nennt die undatierte nicht', mailMitGemeinde.text.includes('Förderrichtlinie lesen'), false);

// ------------------------------------------------- Startseiten-Layout

pruefe('Vorgabe ist die Signalzeile', store.startseiteNormalisieren(null).vorlage, 'signal');
pruefe('Vorgabe enthaelt alle Kacheln', store.startseiteNormalisieren(null).kacheln.length, store.KACHEL_IDS.length);

for (const [name, v] of Object.entries(store.VORLAGEN)) {
  const ids = v.kacheln.map((k) => k.id).sort();
  pruefe(`Vorlage ${name} enthaelt jede Kachel genau einmal`, ids, [...store.KACHEL_IDS].sort());
}

const verbogen = store.startseiteNormalisieren({
  vorlage: 'gibtsnicht',
  kacheln: [
    { id: 'heute', spalte: 9, breite: 'ganz', sichtbar: false },
    { id: 'quatsch', spalte: 1, breite: 'ganz' },
    { id: 'heute', spalte: 2, breite: 'ganz' }
  ]
});
pruefe('unbekannte Vorlage faellt zurueck', verbogen.vorlage, 'signal');
pruefe('unbekannte Kachel fliegt raus', verbogen.kacheln.some((k) => k.id === 'quatsch'), false);
pruefe('doppelte Kachel bleibt einmal', verbogen.kacheln.filter((k) => k.id === 'heute').length, 1);
pruefe('unsinnige Spalte landet in Spalte 1', verbogen.kacheln.find((k) => k.id === 'heute').spalte, 1);
pruefe('ausgeblendet bleibt ausgeblendet', verbogen.kacheln.find((k) => k.id === 'heute').sichtbar, false);
pruefe('fehlende Kacheln werden ergaenzt', verbogen.kacheln.length, store.KACHEL_IDS.length);
pruefe('volle Breite bleibt erhalten', store.startseiteNormalisieren(store.vorlage('signal')).kacheln[0].spalte, 'voll');

/* Randleisten, halbe Breite und Mindesthoehe — dazugekommen mit dem Umbau der
   Startseite. Ein Layout aus der Zeit davor erkennt man daran, dass keine
   einzige Kachel ein `breite`-Feld hat; es wird komplett ersetzt, weil sich die
   Anordnung grundlegend geaendert hat. */
const altesLayout = store.startseiteNormalisieren({
  vorlage: 'signal',
  kacheln: [{ id: 'fristen', spalte: 'voll', sichtbar: true }, { id: 'heute', spalte: 1, sichtbar: true }]
});
pruefe('Layout ohne breite-Feld wird auf die Vorlage umgestellt', altesLayout.kacheln.length, store.KACHEL_IDS.length);
pruefe('und liegt danach in den Randleisten', altesLayout.kacheln.find((k) => k.id === 'can').spalte, 'rechts');
pruefe('Finanzen sitzt links', altesLayout.kacheln.find((k) => k.id === 'finanzen').spalte, 'links');
pruefe('Fristen bleibt oben und halb', altesLayout.kacheln.find((k) => k.id === 'fristen').breite, 'halb');

const gerandet = store.startseiteNormalisieren({
  vorlage: 'signal',
  kacheln: [
    { id: 'can', spalte: 'rechts', breite: 'halb', hoehe: 400, sichtbar: true },
    { id: 'fristen', spalte: 'voll', breite: 'halb', hoehe: 12, sichtbar: true },
    { id: 'heute', spalte: 2, breite: 'unsinn', hoehe: 'viel', sichtbar: true }
  ]
});
pruefe('Randleiste bleibt erhalten', gerandet.kacheln.find((k) => k.id === 'can').spalte, 'rechts');
pruefe('halbe Breite ausserhalb der Vollzeile wird ganz', gerandet.kacheln.find((k) => k.id === 'can').breite, 'ganz');
pruefe('halbe Breite in der Vollzeile bleibt', gerandet.kacheln.find((k) => k.id === 'fristen').breite, 'halb');
pruefe('zu kleine Hoehe wird angehoben', gerandet.kacheln.find((k) => k.id === 'fristen').hoehe, store.MINDESTHOEHE);
pruefe('gueltige Hoehe bleibt', gerandet.kacheln.find((k) => k.id === 'can').hoehe, 400);
pruefe('unsinnige Hoehe wird nichts', gerandet.kacheln.find((k) => k.id === 'heute').hoehe, null);
pruefe('unsinnige Breite wird ganz', gerandet.kacheln.find((k) => k.id === 'heute').breite, 'ganz');
pruefe('Finanzansicht wird mitgefuehrt', gerandet.finanzenAnsicht, 'einzeln');
pruefe('Finanzansicht gesamt bleibt', store.startseiteNormalisieren({ finanzenAnsicht: 'gesamt' }).finanzenAnsicht, 'gesamt');

/* Am Handy zaehlt die Dringlichkeit, und was in einer Randleiste liegt, rutscht
   ans Ende — unabhaengig davon, welche Kachel das gerade ist. */
const handy = store.handyReihenfolge(store.vorlage('signal').kacheln);
pruefe('Fristen steht am Handy oben', handy[0], 'fristen');
pruefe('Randleisten stehen am Handy hinten', handy.slice(-2).sort(), ['can', 'finanzen']);
const umgehaengt = store.vorlage('signal').kacheln.map((k) => (k.id === 'heute' ? { ...k, spalte: 'links' } : k));
pruefe('eine Kachel in der Randleiste rutscht mit ans Ende', store.handyReihenfolge(umgehaengt).at(-1) !== 'heute', true);
pruefe('aber vor nichts anderem als Randleisten', store.handyReihenfolge(umgehaengt).indexOf('heute') > store.handyReihenfolge(umgehaengt).indexOf('aufgaben'), true);

// ------------------------------------------------- SHA-256 im Eigenbau

/* Die Kennung einer Buchung entscheidet ueber die Dubletten-Erkennung. Weicht
   das neue Rechenwerk auch nur in einem Bit von Nodes crypto ab, gelten alle
   bereits gespeicherten Buchungen beim naechsten Import als neu. Deshalb wird
   ausdruecklich gegen Node geprueft, an den Blockgrenzen von 56 und 64 Byte. */
const sha256Proben = [
  '', 'abc', 'HDDatenbank',
  'N26|DE60|2026-03-01|-11.09|rewe stuttgart/sta|0',
  'Umlaute äöüß und ein € Zeichen',
  'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(57),
  'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65),
  'x'.repeat(119), 'x'.repeat(120), 'x'.repeat(2000)
];
for (const probe of sha256Proben) {
  pruefe(`SHA-256 stimmt mit Node ueberein (Laenge ${probe.length})`,
    sha256Hex(probe), createHash('sha256').update(probe).digest('hex'));
}
pruefe('bekannter Pruefwert fuer "abc"', sha256Hex('abc'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

// ------------------------------------------------- Verschluesselung

const salz = krypto.neuesSalz();
const schluessel = await krypto.schluesselAbleiten('einlangesTestpasswort', salz);

const gehaltvoll = {
  entries: [{ id: 'a', text: 'Zahnarzt äöü €', datum: '2026-08-01' }],
  zahl: -1064.35,
  tief: { a: [1, 2, { b: null }] },
  leer: [],
  wahrheit: false
};
const geheim = await krypto.verschluesseln(schluessel, gehaltvoll);
pruefe('Rundlauf liefert exakt die Ausgangsdaten',
  await krypto.entschluesseln(schluessel, geheim), gehaltvoll);
pruefe('das Kauderwelsch enthaelt den Klartext nicht', geheim.includes('Zahnarzt'), false);

// Zweimal dasselbe verschluesselt darf nicht zweimal gleich aussehen,
// sonst waere an den Wiederholungen ablesbar, was sich nicht geaendert hat.
pruefe('zweimal verschluesselt ergibt zweimal anderes Kauderwelsch',
  (await krypto.verschluesseln(schluessel, gehaltvoll)) === geheim, false);

const falscherSchluessel = await krypto.schluesselAbleiten('einlangesTestpasswortX', salz);
let falschGescheitert = false;
try { await krypto.entschluesseln(falscherSchluessel, geheim); } catch { falschGescheitert = true; }
pruefe('falsches Passwort scheitert, statt Unsinn zu liefern', falschGescheitert, true);

const anderesSalz = await krypto.schluesselAbleiten('einlangesTestpasswort', krypto.neuesSalz());
let salzGescheitert = false;
try { await krypto.entschluesseln(anderesSalz, geheim); } catch { salzGescheitert = true; }
pruefe('gleiches Passwort mit anderem Salz passt nicht', salzGescheitert, true);

// AES-GCM soll Manipulation bemerken, nicht nur falsche Passwoerter.
const gedreht = `${geheim.slice(0, 40)}${geheim[40] === 'A' ? 'B' : 'A'}${geheim.slice(41)}`;
let manipulationErkannt = false;
try { await krypto.entschluesseln(schluessel, gedreht); } catch { manipulationErkannt = true; }
pruefe('veraendertes Kauderwelsch wird erkannt', manipulationErkannt, true);

// ------------------------------------------------- Passwortregel

pruefe('HDD ist erlaubt, solange nichts das Geraet verlaesst', krypto.passwortPruefen('HDD', false).ok, true);
pruefe('HDD ist gesperrt, sobald die Daten zu GitHub gehen', krypto.passwortPruefen('HDD', true).ok, false);
pruefe('die Sperre sagt auch warum', krypto.passwortPruefen('HDD', true).fehler.includes('12'), true);
pruefe('elf Zeichen reichen nicht', krypto.passwortPruefen('abcdefghijk', true).ok, false);
pruefe('zwoelf Zeichen reichen', krypto.passwortPruefen('abcdefghijkl', true).ok, true);
pruefe('leeres Passwort ist auch lokal nicht erlaubt', krypto.passwortPruefen('', false).ok, false);

// ------------------------------------------------- Gemeinde-Dokumente

store.write('gemeinden.json', { gemeinden: [] });
const dokGemeinde = gem.speichern({ name: 'Dokumentdorf', stand: 'gespraech' }).gemeinde;

pruefe('Dokument mit Text wird angenommen',
  gem.dokumentAblegen({ gemeindeId: dokGemeinde.id, name: 'Bescheid.pdf', text: 'Förderung bewilligt', seiten: 2 }).ok, true);
pruefe('Dokument ohne Namen wird abgelehnt',
  Boolean(gem.dokumentAblegen({ gemeindeId: dokGemeinde.id, name: '  ', text: 'x' }).fehler), true);

// Ein eingescanntes Schreiben hat keine Textebene und liefert nichts.
const scan = gem.dokumentAblegen({ gemeindeId: dokGemeinde.id, name: 'Scan.pdf', text: '' });
pruefe('leerer Textauszug wird als solcher vermerkt', scan.dokument.leer, true);

const mitDok = gem.mitStatus(gem.lesen()[0], HEUTE);
pruefe('Dokumente werden gezaehlt', mitDok.anzahlDokumente, 2);
pruefe('Loeschen ist gesperrt, solange Dokumente in der Akte liegen',
  Boolean(gem.loeschen(dokGemeinde.id).fehler), true);

// Den leeren Scan wieder wegwerfen, das Bescheid-Dokument bleibt fuer die Suche.
const scanId = gem.lesen()[0].dokumente.find((d) => d.name === 'Scan.pdf').id;
pruefe('Dokument laesst sich loeschen', gem.dokumentLoeschen(dokGemeinde.id, scanId).ok, true);
pruefe('danach ist eines weniger da', gem.mitStatus(gem.lesen()[0], HEUTE).anzahlDokumente, 1);

// Der ausgelesene Text muss auffindbar sein, sonst waere der Umbau sinnlos.
const dokTreffer = suche('bewilligt', { gemeinden: gem.lesen() });
pruefe('Dokumenttext ist durchsuchbar', dokTreffer.dokumente.length, 1);
pruefe('der Treffer nennt die Gemeinde', dokTreffer.dokumente[0].gemeinde, 'Dokumentdorf');
pruefe('der Treffer nennt die Datei', dokTreffer.dokumente[0].name, 'Bescheid.pdf');
pruefe('Umlaute finden auch ohne Umlaut', suche('foerderung', { gemeinden: gem.lesen() }).dokumente.length, 1);
pruefe('ein Wort ohne Treffer liefert nichts', suche('abgelehnt', { gemeinden: gem.lesen() }).dokumente.length, 0);

// Bei langen Schreiben braucht die Trefferliste einen Ausschnitt statt der Wueste.
const langerText = `${'Vorspann. '.repeat(60)}Die Bewilligung erfolgt zum 1. September.${' Nachspann.'.repeat(60)}`;
const kurz = suche('bewilligung', { gemeinden: [{ id: 'g', name: 'X', dokumente: [{ id: 'd', name: 'lang.pdf', datum: '2026-07-01', text: langerText }] }] });
pruefe('der Ausschnitt bleibt kurz', kurz.dokumente[0].ausschnitt.length < 200, true);
pruefe('und enthaelt die Fundstelle', kurz.dokumente[0].ausschnitt.includes('Bewilligung'), true);

// ------------------------------------------------- Speicherabbild

let gemeldet = [];
store.beiAenderungSetzen((datei) => gemeldet.push(datei));
store.write('tasks.json', { tasks: [{ id: 'x' }] });
pruefe('eine Schreibung wird genau einmal gemeldet', gemeldet, ['tasks.json']);
pruefe('und ist sofort wieder lesbar', store.read('tasks.json').tasks.length, 1);
pruefe('alles() liefert genau die abzugleichenden Dateien',
  Object.keys(store.alles()).sort(), [...store.DATEIEN].sort());
store.beiAenderungSetzen(null);

// ------------------------------------------------- Abgleich und Uebernahme

/* Ohne Fernablage laeuft alles gegen den lokalen Spiegel; unter Node ist das
   ein Speicherabbild. Damit laesst sich der Weg pruefen, den auch die
   Uebernahme des alten Bestands nimmt. */

const sync = await import('./sync.js');

const start = await sync.starten({ passwort: 'HDD', ablage: null });
pruefe('Start ohne Fernablage nimmt HDD an', start.ok, true);
pruefe('und meldet die Ersteinrichtung', start.ersteEinrichtung, true);
pruefe('ohne Fernablage kein Fernfehler', start.offline, false);

const bestandDrin = {
  'entries.json': { kategorien: [{ id: 'kat_can', name: 'Can', farbe: '#3ddc84' }], entries: [{ id: 'e1', datum: '2026-08-01', text: 'Übernommen äöü' }] },
  'tasks.json': { tasks: [{ id: 't1', titel: 'Aufgabe' }] },
  'gemeinden.json': { gemeinden: [{ id: 'g1', name: 'Musterdorf', fristen: [], verlauf: [], dokumente: [] }] },
  'finanzen.json': { buchungen: [{ id: 'b1', datum: '2026-07-01', text: 'x', betrag: -1, kategorie: null }], kategorien: [], regeln: [], importe: [] },
  'config.json': { thema: 'ruhe', mail: { aktiv: true, empfaenger: 'a@b.c' } },
  'fremd.json': { soll: 'ignoriert werden' }
};
const uebernommen = await sync.bestandErsetzen(bestandDrin);
pruefe('Uebernahme gelingt', uebernommen.ok, true);
pruefe('Eintraege sind da', store.read('entries.json').entries.length, 1);
pruefe('Umlaute unversehrt', store.read('entries.json').entries[0].text, 'Übernommen äöü');
pruefe('Aufgaben sind da', store.read('tasks.json').tasks.length, 1);
pruefe('Gemeinden sind da', store.read('gemeinden.json').gemeinden.length, 1);
pruefe('Buchungen sind da', store.read('finanzen.json').buchungen.length, 1);
pruefe('Thema wird uebernommen', store.read('config.json').thema, 'ruhe');
// Eine fremde Datei in der Sicherungsdatei darf nicht in den Bestand rutschen.
pruefe('unbekannte Datei wird verworfen', Object.keys(store.alles()).includes('fremd.json'), false);
pruefe('genau die bekannten Dateien liegen vor', Object.keys(store.alles()).sort(), [...store.DATEIEN].sort());

// Nach dem Abmelden und erneuten Anmelden muss alles unveraendert zurueckkommen.
await sync.abmelden();
const wieder = await sync.starten({ passwort: 'HDD', ablage: null });
pruefe('erneutes Anmelden gelingt', wieder.ok, true);
pruefe('keine Ersteinrichtung mehr', wieder.ersteEinrichtung, false);
pruefe('Bestand kommt vollstaendig zurueck', store.read('entries.json').entries[0].text, 'Übernommen äöü');

await sync.abmelden();
let falschesPasswortScheitert = false;
try { await sync.starten({ passwort: 'ANDERS', ablage: null }); } catch { falschesPasswortScheitert = true; }
pruefe('falsches Passwort kommt nicht an den Bestand', falschesPasswortScheitert, true);

// ------------------------------------------------- Eintragsart und Aufgaben

/* Die Art ist neu; `istFrist` bleibt daneben bestehen, weil Fristenkachel,
   Sortierung, Suche und Tagesmail daran haengen. Geprueft wird deshalb vor
   allem, dass beide nie auseinanderlaufen. */

const routen = await import('./routen.js');

store.laden({
  'entries.json': {
    kategorien: [{ id: 'kat_x', name: 'X', farbe: '#3ddc84' }],
    entries: [
      { id: 'alt1', datum: '2026-08-01', text: 'alte Frist', istFrist: true, prioritaet: 'mittel' },
      { id: 'alt2', datum: '2026-08-02', text: 'alter Termin', uhrzeit: '10:00', prioritaet: 'mittel' },
      { id: 'alt3', datum: '2026-08-03', text: 'altes Vorhaben', prioritaet: 'mittel' }
    ]
  },
  'tasks.json': { tasks: [{ id: 't9', titel: 'Aus der Liste', status: 'offen', prioritaet: 'mittel', faellig: '2026-08-05' }] }
});

const nachMigration = (await routen.ruf('GET', '/api/daten')).entries;
pruefe('Altbestand mit Fristhaken wird Frist', nachMigration.find((e) => e.id === 'alt1').art, store.ART_FRIST);
pruefe('Altbestand mit Uhrzeit wird Termin', nachMigration.find((e) => e.id === 'alt2').art, store.ART_TERMIN);
pruefe('Altbestand ohne beides wird Aufgabe', nachMigration.find((e) => e.id === 'alt3').art, store.ART_AUFGABE);
pruefe('Startarten stehen bereit', (await routen.ruf('GET', '/api/daten')).arten.length, store.ARTEN.length);

const alsFrist = await routen.ruf('POST', '/api/eintrag', { text: 'Neue Frist', datum: '2026-09-01', art: store.ART_FRIST });
pruefe('Art Frist setzt den abgeleiteten Haken', alsFrist.eintrag.istFrist, true);
const alsTermin = await routen.ruf('POST', '/api/eintrag', { id: alsFrist.eintrag.id, text: 'Doch ein Termin', datum: '2026-09-01', art: store.ART_TERMIN });
pruefe('Umstellen auf Termin nimmt den Haken zurueck', alsTermin.eintrag.istFrist, false);
const ausSchnell = await routen.ruf('POST', '/api/eintrag', { text: 'Aus der Schnelleingabe', datum: '2026-09-02', istFrist: true });
pruefe('alter Fristhaken ohne Art ergibt die Art Frist', ausSchnell.eintrag.art, store.ART_FRIST);

let artGesperrt = false;
try { await routen.ruf('DELETE', '/api/art?id=art_frist'); } catch { artGesperrt = true; }
pruefe('die feste Art Frist laesst sich nicht loeschen', artGesperrt, true);

const neueArt = await routen.ruf('POST', '/api/art', { name: 'Erinnerung', farbe: '#a988ff' });
pruefe('eine Art laesst sich anlegen', neueArt.art.name, 'Erinnerung');
await routen.ruf('POST', '/api/eintrag', { text: 'haengt dran', datum: '2026-09-03', art: neueArt.art.id });
let benutzteArtGesperrt = false;
try { await routen.ruf('DELETE', `/api/art?id=${neueArt.art.id}`); } catch { benutzteArtGesperrt = true; }
pruefe('eine benutzte Art laesst sich nicht loeschen', benutzteArtGesperrt, true);

// Kachel "Offene Aufgaben": beide Quellen, getrennt gespeichert.
const startKachel = await routen.ruf('GET', '/api/start');
const offen = startKachel.offeneAufgaben;
pruefe('die eigenstaendige Aufgabe ist dabei', offen.some((a) => a.id === 't9' && a.herkunft === 'aufgabe'), true);
pruefe('der Kalendereintrag der Art Aufgabe auch', offen.some((a) => a.id === 'alt3' && a.herkunft === 'eintrag'), true);
pruefe('ein Termin gehoert nicht dazu', offen.some((a) => a.id === 'alt2'), false);

// ------------------------------------------------- Finanzkachel je Konto

store.laden({
  'finanzen.json': {
    buchungen: [
      { id: 'f1', datum: '2026-07-03', text: 'a', betrag: 100, bank: 'N26', kategorie: null },
      { id: 'f2', datum: '2026-07-04', text: 'b', betrag: -40, bank: 'N26', kategorie: null },
      { id: 'f3', datum: '2026-07-05', text: 'c', betrag: -10, bank: 'Wise', kategorie: null },
      { id: 'f4', datum: '2026-07-06', text: 'd', betrag: -5, kategorie: null }
    ],
    kategorien: [], regeln: [], importe: []
  }
});

const fk = fin.kachel('2026-07-15');
pruefe('jedes Konto taucht auf', fk.konten.map((k) => k.bank), ['N26', 'Wise', fin.OHNE_BANK]);
pruefe('N26 wird richtig gerechnet', [fk.konten[0].einnahmen, fk.konten[0].ausgaben], [100, 40]);
pruefe('Buchung ohne Bank landet unter Sonstige', fk.konten[2].ausgaben, 5);
// Der Sinn der Aufteilung: die Einzelsummen muessen die Gesamtsumme ergeben.
pruefe('Einzelsalden ergeben den Gesamtsaldo',
  Math.round(fk.konten.reduce((s, k) => s + k.saldo, 0) * 100) / 100, fk.saldo);

// ------------------------------------------------- Start gegen GitHub

/* Ab hier laeuft eine Attrappe von GitHub im Speicher: Blobs, Baeume, Commits
   und eine Referenz, die sich — wie das Original — nur vorspulen laesst. Damit
   ist die Fallunterscheidung in `starten` pruefbar, ohne etwas zu erfinden:
   verschluesselt und entschluesselt wird echt, nur die Leitung ist gestellt. */

const spiegel = await import('./spiegel.js');

const GH = { kopf: null, objekte: new Map(), zaehler: 0, erreichbar: true };
const ghSha = () => `sha${(GH.zaehler += 1)}`;
const ghAntwort = (daten, status = 200) => ({
  status, ok: status >= 200 && status < 300, json: async () => daten
});

globalThis.fetch = async (url, optionen = {}) => {
  if (!GH.erreichbar) throw new TypeError('fetch failed');
  const pfad = String(url).replace('https://api.github.com', '');
  const methode = optionen.method || 'GET';
  const koerper = optionen.body ? JSON.parse(optionen.body) : null;

  if (pfad.includes('/git/ref/heads/')) {
    return GH.kopf ? ghAntwort({ object: { sha: GH.kopf } }) : ghAntwort({ message: 'leer' }, 409);
  }
  // Der allererste Commit laeuft ueber die Contents-Route, weil GitHub die
  // Git-Data-Routen in einem Repo ohne Commit ablehnt.
  if (methode === 'PUT' && pfad.includes('/contents/')) {
    const blob = ghSha();
    GH.objekte.set(blob, { encoding: 'base64', content: koerper.content });
    const baum = ghSha();
    GH.objekte.set(baum, { tree: [{ path: pfad.split('/contents/')[1], type: 'blob', sha: blob }] });
    const commit = ghSha();
    GH.objekte.set(commit, { tree: { sha: baum }, parents: GH.kopf ? [GH.kopf] : [] });
    GH.kopf = commit;
    return ghAntwort({ commit: { sha: commit } });
  }
  if (methode === 'PATCH' && pfad.includes('/git/refs/heads/')) {
    // Kein force: wer nicht auf dem aktuellen Kopf aufsetzt, wird abgewiesen.
    const commit = GH.objekte.get(koerper.sha);
    if ((commit.parents[0] || null) !== GH.kopf) return ghAntwort({ message: 'nicht vorspulbar' }, 422);
    GH.kopf = koerper.sha;
    return ghAntwort({ object: { sha: GH.kopf } });
  }
  if (methode === 'POST' && pfad.endsWith('/git/blobs')) {
    const sha = ghSha();
    GH.objekte.set(sha, { encoding: 'base64', content: koerper.content });
    return ghAntwort({ sha });
  }
  if (methode === 'POST' && pfad.endsWith('/git/trees')) {
    const sha = ghSha();
    const baum = koerper.base_tree ? [...(GH.objekte.get(koerper.base_tree).tree || [])] : [];
    for (const e of koerper.tree) {
      const i = baum.findIndex((a) => a.path === e.path);
      if (i >= 0) baum[i] = { ...e, type: 'blob' }; else baum.push({ ...e, type: 'blob' });
    }
    GH.objekte.set(sha, { tree: baum });
    return ghAntwort({ sha });
  }
  if (methode === 'POST' && pfad.endsWith('/git/commits')) {
    const sha = ghSha();
    GH.objekte.set(sha, { tree: { sha: koerper.tree }, parents: koerper.parents || [] });
    return ghAntwort({ sha });
  }
  if (pfad.includes('/git/commits/')) return ghAntwort(GH.objekte.get(pfad.split('/git/commits/')[1]));
  if (pfad.includes('/git/trees/')) return ghAntwort(GH.objekte.get(pfad.split('/git/trees/')[1].split('?')[0]));
  if (pfad.includes('/git/blobs/')) return ghAntwort(GH.objekte.get(pfad.split('/git/blobs/')[1]));
  return ghAntwort({ message: `unbekannt: ${methode} ${pfad}` }, 404);
};

const ABLAGE = { token: 't', besitzer: 'wer', repo: 'daten', zweig: 'main' };
const FERNWORT = 'HDDatenbank-Pruefwort-2026';
const textVon = () => (store.read('entries.json').entries[0] || {}).text;
const eintragSetzen = (text) => store.laden({ 'entries.json': { kategorien: [], arten: [], entries: [{ id: 'e1', datum: '2026-08-01', text }] } });

// Der Spiegel aus dem Abschnitt davor gehoert zu einem anderen Passwort.
await sync.abmelden();
await spiegel.leeren();
pruefe('Start gegen leeres Repo gelingt', (await sync.starten({ passwort: FERNWORT, ablage: ABLAGE })).ok, true);
eintragSetzen('Stand eins');
await sync.sichern('eins');
const K1 = GH.kopf;
const S1 = structuredClone(await spiegel.holen('stand'));

eintragSetzen('Stand zwei');
await sync.sichern('zwei');
const K2 = GH.kopf;
const S2 = structuredClone(await spiegel.holen('stand'));
pruefe('zwei Staende ergeben zwei Koepfe', K1 !== K2, true);

// Sauberer Spiegel auf altem Kopf: der Fernstand gilt, ohne Rueckfrage.
await sync.abmelden();
await spiegel.setzen('stand', { ...S1, schmutzig: false });
const holtFern = await sync.starten({ passwort: FERNWORT, ablage: ABLAGE });
pruefe('sauberer Spiegel wird vom Fernstand ueberholt', textVon(), 'Stand zwei');
pruefe('und es gibt dabei nichts zu entscheiden', Boolean(holtFern.konflikt), false);

// Eigenes auf gleichem Kopf: geht hoch, statt beim Start zu verschwinden.
GH.kopf = K1;
await sync.abmelden();
await spiegel.setzen('stand', { ...S2, kopfSha: K1, schmutzig: true });
const traegtNach = await sync.starten({ passwort: FERNWORT, ablage: ABLAGE });
pruefe('Ungesichertes bleibt erhalten', textVon(), 'Stand zwei');
pruefe('und ist nach dem Start abgelegt', traegtNach.ungesichert, false);
pruefe('dafuer ist der Kopf weitergerueckt', GH.kopf !== K1, true);
pruefe('ohne dass gefragt werden musste', Boolean(traegtNach.konflikt), false);

// Beide Seiten weitergelaufen: melden, nichts ueberschreiben.
GH.kopf = K2;
await sync.abmelden();
await spiegel.setzen('stand', { ...S1, kopfSha: 'shaFremd', schmutzig: true });
const streit = await sync.starten({ passwort: FERNWORT, ablage: ABLAGE });
pruefe('abweichende Koepfe werden gemeldet', streit.konflikt, true);
pruefe('und der Fernstand bleibt unangetastet', GH.kopf, K2);
pruefe('gezeigt wird solange der eigene Stand', textVon(), 'Stand eins');

// Ohne Verbindung: starten, aber sagen, von wann der Stand ist.
GH.erreichbar = false;
await sync.abmelden();
await spiegel.setzen('stand', { ...S2, schmutzig: false });
const ohneNetz = await sync.starten({ passwort: FERNWORT, ablage: ABLAGE });
pruefe('ohne Verbindung wird trotzdem gestartet', ohneNetz.ok, true);
pruefe('und das auch gesagt', ohneNetz.offline, true);
pruefe('der lokale Stand steht bereit', textVon(), 'Stand zwei');
pruefe('mit Zeitpunkt fuer die Anzeige', typeof ohneNetz.standZeit, 'string');
GH.erreichbar = true;

// Ein Spiegel aus einer aelteren Fassung hat keinen Zeitstempel und muss lesbar bleiben.
await sync.abmelden();
const { zeit, ...ohneZeit } = S2;
await spiegel.setzen('stand', { ...ohneZeit, schmutzig: false });
const altSpiegel = await sync.starten({ passwort: FERNWORT, ablage: ABLAGE });
pruefe('Spiegel ohne Zeitstempel bleibt brauchbar', altSpiegel.ok, true);
pruefe('und meldet den fehlenden Zeitpunkt sauber', altSpiegel.standZeit, null);


// ---------------------------------------------------------------- Silbenkerne

/* Der Kern der Reimlogik: eine Silbe steuert genau einen Vokal, Umlaut oder
   Doppellaut bei. Die Faelle hier sind die, an denen ein Regelwerk
   erfahrungsgemaess scheitert. */

const kette = (w) => silben.kerne(w).join(',');

pruefe('Hundesteuer', kette('Hundesteuer'), 'u,e,eu,e');
pruefe('Maeuseplage — aeu gilt als eu', kette('Mäuseplage'), 'eu,e,a,e');
pruefe('ai wird zu ei', kette('Mai'), 'ei');
pruefe('ay wird zu ei', kette('Bayern'), 'ei,e');
pruefe('y als Kern wird zu i', kette('Symbol'), 'i,o');
pruefe('y vor Vokal ist ein Mitlaut', kette('Yacht'), 'a');
pruefe('ie ist ein eigener Laut', kette('ziehen'), 'ie,e');
pruefe('ieh ebenso', kette('Vieh'), 'ie');
pruefe('ie trifft nicht auf i', reim.vergleich(reim.kette('Lied', {}), reim.kette('mit', {})).laenge, 0);
pruefe('geschriebenes ih bleibt beim i', kette('ihn'), 'i');
pruefe('Dehnungs-h faellt mit dem Vokal zusammen', kette('Ahorn'), 'a,o');
pruefe('Doppelvokal ist ein Kern', kette('Aal'), 'a');
pruefe('das u nach q traegt keinen Kern', kette('Quelle'), 'e,e');
pruefe('ei bleibt ei', kette('Freiheit'), 'ei,ei');
pruefe('au bleibt au', kette('Bauer'), 'au,e');
pruefe('Umlaute bleiben eigenstaendig', kette('Öfen'), 'ö,e');
pruefe('Ziffern und Zeichen zaehlen nicht', kette('§12'), '');

pruefe('Wortfolge laeuft ueber die Wortgrenze', silben.kette('neue Feier').map((x) => x.kern).join(','), 'eu,e,ei,e');
pruefe('und weiss, wo ein Wort anfaengt', silben.kette('neue Feier').map((x) => (x.wortAnfang ? 1 : 0)).join(''), '1010');

// ---------------------------------------------------------------- Reimlogik

const K = (t, ablage) => reim.kette(t, ablage || {});

pruefe('laengste Uebereinstimmung', reim.vergleich(K('Hundesteuer'), K('Mäuseplage')).laenge, 2);
pruefe('und wo sie beginnt', reim.vergleich(K('Hundesteuer'), K('Mäuseplage')).a, 2);
pruefe('gegenueber sich selbst passt alles', reim.vergleich(K('Hundesteuer'), K('Hundesteuer')).laenge, 4);
pruefe('ohne Gemeinsamkeit bleibt null', reim.vergleich(K('Ohr'), K('Bau')).laenge, 0);

// Suche: das Budget zaehlt nur zwischen den gesuchten Silben.
pruefe('Muster ohne Luecke gefunden', reim.suchen(['eu', 'e'], K('Hundesteuer'), { budget: 0 }).von, 2);
pruefe('Muster mit Luecke braucht Budget', reim.suchen(['u', 'eu'], K('Hundesteuer'), { budget: 0 }), null);
pruefe('mit Budget wird es gefunden', reim.suchen(['u', 'eu'], K('Hundesteuer'), { budget: 1 }).verbrauch, 1);
pruefe('vor dem Muster darf beliebig viel stehen', reim.suchen(['eu', 'e'], K('Hundesteuer'), { budget: 0 }).stellen.join(','), '2,3');
pruefe('Endungszwang trifft am Wortende', reim.suchen(['eu', 'e'], K('Hundesteuer'), { budget: 0, nurEnde: true }).bis, 3);
pruefe('Endungszwang schlaegt sonst fehl', reim.suchen(['u', 'e'], K('Hundesteuer'), { budget: 0, nurEnde: true }), null);
pruefe('zehn Silben sind die Obergrenze', reim.MAX_MUSTER, 10);

// Anmerkungen erweitern die zulaessigen Laute, ohne den Kern zu ersetzen.
const mitAnmerkung = {
  ohr: { silben: [{ korrektur: null, relevanz: 'buchstabe', anmerkungen: [{ laut: 'a', prioritaet: 'unwichtig' }] }] }
};
pruefe('Anmerkung macht die Silbe zusaetzlich treffbar', reim.suchen(['a'], K('Ohr', mitAnmerkung), {}) !== null, true);
pruefe('der geschriebene Kern trifft weiterhin', reim.suchen(['o'], K('Ohr', mitAnmerkung), {}) !== null, true);
pruefe('auch eine unwichtige Anmerkung zaehlt voll', reim.vergleich(K('Ohr', mitAnmerkung), K('Bahn')).laenge, 1);
pruefe('die Farbe bleibt beim Buchstaben', K('Ohr', mitAnmerkung)[0].primaer, 'o');

const anmerkungVorn = {
  ohr: { silben: [{ korrektur: null, relevanz: 'anmerkung', anmerkungen: [{ laut: 'a', prioritaet: 'wichtig' }] }] }
};
pruefe('steht die Anmerkung vorn, faerbt sie', K('Ohr', anmerkungVorn)[0].primaer, 'a');

const korrigiert = { ohr: { silben: [{ korrektur: 'u', relevanz: 'buchstabe', anmerkungen: [] }] } };
pruefe('eine Korrektur ersetzt den Kern', K('Ohr', korrigiert)[0].kern, 'u');
pruefe('und der alte Kern trifft dann nicht mehr', reim.suchen(['o'], K('Ohr', korrigiert), {}), null);

pruefe('Zaehlung nach oben und unten', JSON.stringify(reim.zaehlung(K('Hundesteuer'), K('Mäuseplage'), null)), '{"oben":2,"unten":0,"gesamt":4}');

const kandidaten = [
  { id: 'a', text: 'Mäuseplage', kette: K('Mäuseplage') },
  { id: 'b', text: 'Uhr', kette: K('Uhr') }
];
pruefe('Vorschlaege ab zwei Silben', reim.vorschlaege(K('Hundesteuer'), kandidaten, 2).map((v) => v.id).join(','), 'a');
pruefe('ab einer Silbe kommt mehr', reim.vorschlaege(K('Hundesteuer'), kandidaten, 1).length, 2);

// ---------------------------------------------------------------- Reimbestand

store.write('reime.json', structuredClone(store.defaults['reime.json']));
reimedaten.gruppeSpeichern({ kopf: 'Hundesteuer' });
const gruppeId = reimedaten.lesen().gruppen[0].id;
reimedaten.eintragSpeichern({ gruppe: gruppeId, text: 'Mäuseplage' });
reimedaten.eintragSpeichern({ gruppe: gruppeId, text: 'Ohr' });

const sicht = reimedaten.ansicht('reime', null);
pruefe('eine Gruppe mit drei Zeilen', sicht.gruppen[0].zeilen.length, 3);
pruefe('der Kopf steht oben', sicht.gruppen[0].zeilen[0].kopf, true);
pruefe('die Reime stehen ausgerichtet', sicht.gruppen[0].zeilen[1].versatz, 2);
pruefe('was nicht passt, wird nicht verschoben', sicht.gruppen[0].zeilen[2].versatz, 0);
pruefe('Silben kommen mitgerechnet', sicht.gruppen[0].zeilen[0].silben.map((x) => x.kern).join(','), 'u,e,eu,e');

reimedaten.gruppeSortieren(gruppeId);
pruefe('Sortieren stellt den besten Reim nach oben', reimedaten.lesen().gruppen[0].eintraege[0].text, 'Mäuseplage');

pruefe('Silbensuche findet im Bestand', reimedaten.suche(['eu', 'e'], { budget: 0 }).treffer.length, 2);
pruefe('Vorschlaege kommen aus dem Bestand', reimedaten.rat('Abenteuer').vorschlaege[0].text, 'Hundesteuer');

reimedaten.wortSpeichern({
  wort: 'Ohr', silbeIndex: 0, korrektur: null, relevanz: 'buchstabe',
  anmerkungen: [{ laut: 'eu', prioritaet: 'mittel' }]
});
pruefe('Anmerkung haengt am Wort', Object.keys(reimedaten.lesen().woerter).join(','), 'ohr');
pruefe('und wirkt sofort in der Suche', reimedaten.suche(['eu'], {}).treffer.length, 3);

reimedaten.wortSpeichern({ wort: 'Ohr', silbeIndex: 0, korrektur: null, relevanz: 'buchstabe', anmerkungen: [] });
pruefe('leergeraeumte Woerter hinterlassen nichts', Object.keys(reimedaten.lesen().woerter).length, 0);
pruefe('eine Silbe, die es nicht gibt, wird abgelehnt', Boolean(reimedaten.wortSpeichern({ wort: 'Ohr', silbeIndex: 7 }).fehler), true);

reimedaten.kategorieSpeichern({ bereich: 'reime', name: 'Battle', stichwoerter: 'steuer, amt' });
pruefe('Kategorie angelegt', reimedaten.lesen().kategorien.reime.length, 1);
pruefe('mit gesaeuberten Stichwoertern', reimedaten.lesen().kategorien.reime[0].stichwoerter.join('|'), 'steuer|amt');

const vorZeilen = reimedaten.lesen().gruppen.length;
reimedaten.zeileSpeichern({ text: 'erste Zeile ohne Kategorie' });
pruefe('Zeilen liegen getrennt von Reimen', reimedaten.lesen().zeilen.length, 1);
pruefe('Reime bleiben davon unberuehrt', reimedaten.lesen().gruppen.length, vorZeilen);

reimedaten.textSpeichern({ titel: 'Strophe', inhalt: 'erste Zeile\nzweite Zeile' });
pruefe('ein Text behaelt seine Zeilen', reimedaten.lesen().texte[0].zeilen.length, 2);
pruefe('Texte werden auch ausgerichtet', typeof reimedaten.ansicht('texte', null).texte[0].zeilen[1].versatz, 'number');

pruefe('was in der Gruppe steht, wird nicht mehr vorgeschlagen',
  reimedaten.rat('Abenteuer', { gruppe: gruppeId }).vorschlaege.length, 0);

reimedaten.gruppeSpeichern({ kopf: 'Ungeheuer' });
const zweiteGruppe = reimedaten.lesen().gruppen.find((g) => g.kopf === 'Ungeheuer').id;
const kommtVor = (id) => reimedaten.rat('Abenteuer', { gruppe: id })
  .vorschlaege.some((v) => v.text.toLowerCase() === 'hundesteuer');
pruefe('in einer anderen Gruppe kommt derselbe Reim weiterhin', kommtVor(zweiteGruppe), true);
reimedaten.eintragSpeichern({ gruppe: zweiteGruppe, text: 'hundesteuer' });
pruefe('nach dem Uebernehmen nicht mehr, auch anders geschrieben', kommtVor(zweiteGruppe), false);

// ---- Umzug zwischen den Reitern

store.write('reime.json', structuredClone(store.defaults['reime.json']));
reimedaten.kategorieSpeichern({ bereich: 'reime', name: 'Vergleiche', stichwoerter: 'wie' });
const umzugKat = reimedaten.lesen().kategorien.reime[0].id;
reimedaten.gruppeSpeichern({ kopf: 'Wüstenfuchs', kategorien: [umzugKat] });
const umzugGruppe = reimedaten.lesen().gruppen[0].id;
reimedaten.eintragSpeichern({ gruppe: umzugGruppe, text: 'Überschuss' });
reimedaten.gruppeSpeichern({ kopf: 'ohne Kategorie' });

const umzug = reimedaten.kategorieVerschieben({ von: 'reime', nach: 'zeilen', id: umzugKat });
pruefe('die Kategorie liegt danach bei den Zeilen', reimedaten.lesen().kategorien.zeilen[0].name, 'Vergleiche');
pruefe('und nicht mehr bei den Reimen', reimedaten.lesen().kategorien.reime.length, 0);
pruefe('die Gruppe zerfaellt in Kopf und Reim', reimedaten.lesen().zeilen.map((z) => z.text).join(','), 'Wüstenfuchs,Überschuss');
pruefe('die Kategorie wandert mit', reimedaten.lesen().zeilen[0].kategorien[0], umzugKat);
pruefe('gezaehlt wird der Eintrag, nicht die Zeile', umzug.anzahl, 1);
pruefe('was nicht daran hing, bleibt stehen', reimedaten.lesen().gruppen.map((g) => g.kopf).join(','), 'ohne Kategorie');

const umzugZeile = reimedaten.lesen().zeilen[1].id;
reimedaten.eintragVerschieben({ von: 'zeilen', nach: 'reime', id: umzugZeile });
pruefe('eine einzelne Zeile wird zum Kopfbegriff', reimedaten.lesen().gruppen[0].kopf, 'Überschuss');
pruefe('die Kategorie bleibt zurueck, weil es sie dort nicht gibt', reimedaten.lesen().gruppen[0].kategorien.length, 0);
pruefe('und die Zeile ist weg', reimedaten.lesen().zeilen.length, 1);
pruefe('ein Umzug in den eigenen Reiter wird abgelehnt',
  Boolean(reimedaten.eintragVerschieben({ von: 'zeilen', nach: 'zeilen', id: umzugZeile }).fehler), true);

reimedaten.textSpeichern({ titel: 'Strophe', inhalt: 'erste Zeile\nzweite Zeile' });
reimedaten.eintragVerschieben({ von: 'texte', nach: 'zeilen', id: reimedaten.lesen().texte[0].id });
pruefe('ein Text zerfaellt in Titel und Zeilen',
  reimedaten.lesen().zeilen.slice(0, 3).map((z) => z.text).join(','), 'Strophe,erste Zeile,zweite Zeile');
pruefe('und ist danach nicht mehr da', reimedaten.lesen().texte.length, 0);

// ---- Zeilen von Hand schieben

store.write('reime.json', structuredClone(store.defaults['reime.json']));
reimedaten.gruppeSpeichern({ kopf: 'Hundesteuer' });
const schubGruppe = reimedaten.lesen().gruppen[0].id;
reimedaten.eintragSpeichern({ gruppe: schubGruppe, text: 'Mäuseplage' });
const schubReim = reimedaten.lesen().gruppen[0].eintraege[0].id;
const schubStand = () => reimedaten.ansicht('reime', null).gruppen[0].zeilen;

pruefe('ohne Schub gilt die gerechnete Ausrichtung', schubStand()[1].versatz, 2);
reimedaten.schubSetzen({ id: schubReim, schritt: 1 });
pruefe('ein Schritt nach rechts', schubStand()[1].versatz, 3);
pruefe('der Kopf bleibt dabei stehen', schubStand()[0].versatz, 0);

for (let i = 0; i < 4; i += 1) reimedaten.schubSetzen({ id: schubReim, schritt: -1 });
pruefe('nach links gibt es kein Maximum', reimedaten.lesen().gruppen[0].eintraege[0].schub, -3);
pruefe('die Gruppe rueckt nach, statt aus dem Raster zu fallen', schubStand()[0].versatz, 1);
pruefe('die geschobene Zeile steht ganz links', schubStand()[1].versatz, 0);

reimedaten.schubSetzen({ id: schubReim, zuruecksetzen: true });
pruefe('zuruecksetzen stellt die Rechnung wieder her', schubStand()[1].versatz, 2);
pruefe('und hinterlaesst keine Karteileiche', 'schub' in reimedaten.lesen().gruppen[0].eintraege[0], false);

reimedaten.schubSetzen({ id: schubGruppe, schritt: 2 });
pruefe('auch der Kopfbegriff laesst sich schieben', schubStand()[0].versatz, 2);
pruefe('eine unbekannte Kennung wird abgelehnt', Boolean(reimedaten.schubSetzen({ id: 'gibtsnicht' }).fehler), true);

reimedaten.zeileSpeichern({ text: 'Hundesteuer' });
reimedaten.zeileSpeichern({ text: 'Mäuseplage' });
const schubZeile = reimedaten.lesen().zeilen[0].id;
const zeilenStand = () => reimedaten.ansicht('zeilen', null).zeilen;
const abstand = () => zeilenStand()[0].versatz - zeilenStand()[1].versatz;
const abstandVorher = abstand();
reimedaten.schubSetzen({ id: schubZeile, schritt: 1 });
pruefe('auch eine Zeile laesst sich schieben', abstand() - abstandVorher, 1);
pruefe('die Zeile darunter bleibt, wo sie war', zeilenStand()[1].versatz, 0);

// ---------------------------------------------------------------- Reiter und eigene Bereiche

const reiterStandard = store.reiterNormalisieren([]);
pruefe('acht Reiter im Anfangsstand', reiterStandard.length, 8);
pruefe('Start steht vorn', reiterStandard[0].id, 'start');
pruefe('Einstellungen stehen hinten', reiterStandard[reiterStandard.length - 1].id, 'einstellungen');
pruefe('Start laesst sich nicht ausblenden', store.reiterNormalisieren([{ id: 'start', sichtbar: false }])[0].sichtbar, true);
pruefe('ein anderer Reiter schon', store.reiterNormalisieren([{ id: 'suche', sichtbar: false }]).find((r) => r.id === 'suche').sichtbar, false);
pruefe('erfundene feste Kennungen fliegen raus', store.reiterNormalisieren([{ id: 'unfug' }]).length, 8);

const mitEigenem = store.reiterNormalisieren([{ id: 'r1', typ: 'eigen', name: 'Bücher', kachel: { aktiv: true } }]);
pruefe('ein eigener Reiter bleibt erhalten', mitEigenem.find((r) => r.id === 'r1').typ, 'eigen');
pruefe('seine Kachel taucht in der Kachelliste auf', store.kachelListe(mitEigenem).some((k) => k.id === 'eigen_r1'), true);
pruefe('ohne zugeschaltete Kachel nicht', store.kachelListe(store.reiterNormalisieren([{ id: 'r1', typ: 'eigen', name: 'B' }])).length, 7);

const layoutMitEigen = store.startseiteNormalisieren(null, mitEigenem);
pruefe('die neue Kachel landet im Layout', layoutMitEigen.kacheln.some((k) => k.id === 'eigen_r1'), true);
pruefe('eine Kachel ohne Reiter faellt weg', store.startseiteNormalisieren(layoutMitEigen, []).kacheln.some((k) => k.id === 'eigen_r1'), false);
pruefe('die sieben festen bleiben', store.startseiteNormalisieren(layoutMitEigen, []).kacheln.length, 7);

const felder = eigene.felderNormalisieren([
  { name: 'Titel', typ: 'text', pflicht: true },
  { name: 'Preis', typ: 'geld' },
  { name: 'Gelesen', typ: 'haken' },
  { name: '', typ: 'text' }
]);
pruefe('Felder ohne Namen zaehlen nicht', felder.length, 3);
pruefe('unbekannte Typen werden zu Text', eigene.felderNormalisieren([{ name: 'x', typ: 'quatsch' }])[0].typ, 'text');

store.write('eigene.json', { eintraege: {} });
pruefe('Pflichtfeld wird eingefordert', Boolean(eigene.speichern('r1', felder, { werte: {} }).fehler), true);

eigene.speichern('r1', felder, { werte: { [felder[0].id]: 'Buch A', [felder[1].id]: '12,50', [felder[2].id]: true } });
pruefe('Eintrag liegt im richtigen Reiter', eigene.listen('r1').length, 1);
pruefe('Komma wird als Dezimaltrennzeichen gelesen', eigene.listen('r1')[0].werte[felder[1].id], 12.5);

eigene.speichern('r1', felder, { werte: { [felder[0].id]: 'Buch B' } });
pruefe('sortiert nach einem Feld', eigene.abfragen('r1', felder, { sortFeld: felder[0].id }).map((e) => e.werte[felder[0].id]).join(','), 'Buch A,Buch B');
pruefe('und andersherum', eigene.abfragen('r1', felder, { sortFeld: felder[0].id, richtung: 'ab' }).map((e) => e.werte[felder[0].id]).join(','), 'Buch B,Buch A');
pruefe('Suche geht ueber alle Textfelder', eigene.abfragen('r1', felder, { suche: 'buch b' }).length, 1);

pruefe('ein entferntes Feld nimmt seine Werte nicht mit', eigene.listen('r1').some((e) => e.werte[felder[1].id] === 12.5), true);
pruefe('angezeigt wird es trotzdem nicht mehr', eigene.abfragen('r1', [felder[0]], {}).length, 2);

eigene.reiterEntfernen('r1');
pruefe('mit dem Reiter geht sein Bestand', eigene.listen('r1').length, 0);

// ---------------------------------------------------------------- Fristen und Termine

store.write('reime.json', structuredClone(store.defaults['reime.json']));
store.write('gemeinden.json', { gemeinden: [] });
store.write('tasks.json', { tasks: [] });
store.write('config.json', { eingerichtetAm: 'x' });
store.write('entries.json', {
  arten: store.ARTEN.map((a) => ({ ...a })),
  kategorien: [],
  entries: [
    { id: 'e1', datum: D.plusTage(store.heute(), 3), text: 'Widerspruch abgeben', art: store.ART_FRIST, istFrist: true, prioritaet: 'hoch' },
    { id: 'e2', datum: D.plusTage(store.heute(), 3), text: 'Zahnarzt', art: store.ART_TERMIN, uhrzeit: '14:00', prioritaet: 'mittel' },
    { id: 'e3', datum: D.plusTage(store.heute(), 2), text: 'Küche aufräumen', art: store.ART_AUFGABE, prioritaet: 'gering' },
    { id: 'e4', datum: D.plusTage(store.heute(), 40), text: 'weit weg', art: store.ART_TERMIN, prioritaet: 'mittel' }
  ]
});

const startStand = routen.startDaten();
pruefe('Frist und Termin stehen zusammen in der Kachel', startStand.fristen.map((f) => f.id).join(','), 'e1,e2');
pruefe('am selben Tag steht die Frist vorn', startStand.fristen[0].istFrist, true);
pruefe('die Art wird mitgeliefert', startStand.fristen[1].art, store.ART_TERMIN);
pruefe('ausserhalb der vierzehn Tage bleibt es draussen', startStand.fristen.some((f) => f.id === 'e4'), false);
pruefe('eine Aufgabe gehoert nicht in die Signalzeile', startStand.fristen.some((f) => f.id === 'e3'), false);
pruefe('sie steht bei den offenen Aufgaben', startStand.offeneAufgaben.some((a) => a.id === 'e3'), true);
pruefe('die Reiterliste kommt mit', startStand.reiter.length, 8);

// ----------------------------------------------------------------

process.stdout.write(`\n${gelaufen - gescheitert} von ${gelaufen} Prüfungen bestanden.\n`);
process.exit(gescheitert ? 1 : 0);
