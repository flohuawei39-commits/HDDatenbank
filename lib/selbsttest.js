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
    { id: 'heute', spalte: 9, sichtbar: false },
    { id: 'quatsch', spalte: 1 },
    { id: 'heute', spalte: 2 }
  ]
});
pruefe('unbekannte Vorlage faellt zurueck', verbogen.vorlage, 'signal');
pruefe('unbekannte Kachel fliegt raus', verbogen.kacheln.some((k) => k.id === 'quatsch'), false);
pruefe('doppelte Kachel bleibt einmal', verbogen.kacheln.filter((k) => k.id === 'heute').length, 1);
pruefe('unsinnige Spalte landet in Spalte 1', verbogen.kacheln.find((k) => k.id === 'heute').spalte, 1);
pruefe('ausgeblendet bleibt ausgeblendet', verbogen.kacheln.find((k) => k.id === 'heute').sichtbar, false);
pruefe('fehlende Kacheln werden ergaenzt', verbogen.kacheln.length, store.KACHEL_IDS.length);
pruefe('volle Breite bleibt erhalten', store.startseiteNormalisieren(store.vorlage('signal')).kacheln[0].spalte, 'voll');

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

// ----------------------------------------------------------------

process.stdout.write(`\n${gelaufen - gescheitert} von ${gelaufen} Prüfungen bestanden.\n`);
process.exit(gescheitert ? 1 : 0);
