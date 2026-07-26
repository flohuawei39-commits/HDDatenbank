import * as P from './pdf.js';

/* Zwei Auszugsformate, je ein Leser. Beide arbeiten ueber Spaltenpositionen,
   nicht ueber Textreihenfolge — sonst rutschen Ein- und Ausgang durcheinander.
   Jeder Leser liefert zusaetzlich eine Kontrolle, mit der sich der Import
   gegen die Angaben im Auszug selbst pruefen laesst. */

// ---------------------------------------------------------------- N26

const N26_SPALTE_BETRAG = 552;
const N26_SPALTE_DATUM_AB = 350;

const istN26 = (seiten) => {
  const kopf = seiten.slice(0, 2).flatMap((s) => s.zeilen.map((z) => z.text)).join(' ');
  return /Kontoauszug\s+Nr\./i.test(kopf) || /NTSBDEB1XXX/.test(kopf);
};

const n26Zeitraum = (seiten) => {
  for (const zeile of seiten[0].zeilen) {
    const treffer = zeile.text.match(/(\d{2}\.\d{2}\.\d{4})\s+bis\s+(\d{2}\.\d{2}\.\d{4})/);
    if (treffer) return { von: P.punktDatum(treffer[1]), bis: P.punktDatum(treffer[2]) };
  }
  return { von: null, bis: null };
};

const n26Kontrolle = (seiten) => {
  const werte = { alterStand: null, ausgehend: null, eingehend: null, neuerStand: null };
  for (const seite of seiten) {
    for (let i = 0; i < seite.zeilen.length; i += 1) {
      const zeile = seite.zeilen[i];
      // Der Betrag steht mal in derselben Zeile, mal eine Zeile darueber.
      const betrag = P.zahl(zeile.text) ?? P.zahl((seite.zeilen[i - 1] || {}).text);
      if (betrag === null) continue;
      if (/alter Kontostand/i.test(zeile.text)) werte.alterStand = betrag;
      else if (/Ausgehende Transaktionen/i.test(zeile.text)) werte.ausgehend = betrag;
      else if (/Einkommende Transaktionen/i.test(zeile.text)) werte.eingehend = betrag;
      else if (/neuer Kontostand/i.test(zeile.text)) werte.neuerStand = betrag;
    }
  }
  return werte;
};

/**
 * Die eigene Kontonummer steht in der Fusszeile jeder Seite, fremde IBANs
 * tauchen nur einzeln bei Ueberweisungen auf. Deshalb: die haeufigste gewinnt.
 */
const haeufigsteIban = (seiten) => {
  const zaehler = new Map();
  for (const seite of seiten) {
    for (const zeile of seite.zeilen) {
      const treffer = zeile.text.match(/IBAN:\s*([A-Z]{2}[0-9A-Z ]{10,32})/);
      if (!treffer) continue;
      const iban = treffer[1].replace(/\s/g, '');
      zaehler.set(iban, (zaehler.get(iban) || 0) + 1);
    }
  }
  const sortiert = [...zaehler.entries()].sort((a, b) => b[1] - a[1]);
  return sortiert.length ? sortiert[0][0] : null;
};

const n26Lesen = (seiten) => {
  const buchungen = [];
  const { von, bis } = n26Zeitraum(seiten);
  const iban = haeufigsteIban(seiten);

  for (const seite of seiten) {
    const zeilen = seite.zeilen;
    for (let i = 0; i < zeilen.length; i += 1) {
      const zeile = zeilen[i];

      const betrag = P.betragInSpalte(zeile, N26_SPALTE_BETRAG, 14);
      if (!betrag) continue;
      const datumTeil = zeile.teile.find((t) => t.x > N26_SPALTE_DATUM_AB && P.punktDatum(t.text));
      if (!datumTeil) continue;

      const beschreibung = P.linksVon(zeile, N26_SPALTE_DATUM_AB);
      if (!beschreibung) continue;

      /* Folgezeilen bis einschliesslich der Wertstellung: damit endet ein Block.
         Ohne diesen Schlusspunkt zieht die letzte Buchung einer Seite die
         Fusszeile mit Name, Anschrift und Seitenzahl in den Verwendungszweck. */
      const zusatz = [];
      for (let j = i + 1; j < zeilen.length && zusatz.length < 8; j += 1) {
        const naechste = zeilen[j];
        const istBuchung = P.betragInSpalte(naechste, N26_SPALTE_BETRAG, 14)
          && naechste.teile.some((t) => t.x > N26_SPALTE_DATUM_AB && P.punktDatum(t.text));
        if (istBuchung) break;
        if (/^Kontoauszug|^Zusammenfassung|^Beschreibung$|^\d+ \/ \d+$/.test(naechste.text)) break;
        zusatz.push(naechste.text);
        if (/^Wertstellung/i.test(naechste.text)) break;
      }

      const wertstellung = zusatz.find((z) => /^Wertstellung/i.test(z));
      const erste = zusatz.find((z) => !/^Wertstellung/i.test(z)) || '';
      const kategorieVorschlag = erste.includes('•')
        ? erste.split('•').pop().trim()
        : (erste && erste.length <= 40 ? erste.trim() : null);
      const verwendung = zusatz
        .filter((z) => z !== erste && !/^Wertstellung/i.test(z))
        .join(' ')
        .trim();

      buchungen.push({
        datum: P.punktDatum(datumTeil.text),
        wertstellung: wertstellung ? P.punktDatum(wertstellung) : null,
        text: beschreibung,
        betrag: betrag.wert,
        waehrung: 'EUR',
        kategorieVorschlag,
        verwendung: verwendung || null,
        saldo: null
      });
    }
  }

  return { bank: 'N26', konto: iban, waehrung: 'EUR', von, bis, buchungen, kontrolle: n26Kontrolle(seiten) };
};

// ---------------------------------------------------------------- Wise

const WISE_EINGEHEND = 417;
const WISE_AUSGEHEND = 485;
const WISE_SALDO = 553;
const WISE_TEXT_GRENZE = 350;

const istWise = (seiten) => {
  const kopf = seiten[0].zeilen.map((z) => z.text).join(' ');
  return /Wise (Europe|Assets)/i.test(kopf) || /TRWIBEB/.test(kopf);
};

const wiseZeitraum = (seiten) => {
  for (const zeile of seiten[0].zeilen) {
    const treffer = zeile.text.match(/(\d{1,2}\.\s*\w+\s+\d{4}).*?-\s*(\d{1,2}\.\s*\w+\s+\d{4})/);
    if (treffer) return { von: P.deutschesDatum(treffer[1]), bis: P.deutschesDatum(treffer[2]) };
  }
  return { von: null, bis: null };
};

const wiseWaehrung = (seiten) => {
  for (const zeile of seiten[0].zeilen) {
    const treffer = zeile.text.match(/^([A-Z]{3})-Auszug/);
    if (treffer) return treffer[1];
  }
  return 'EUR';
};

const wiseLesen = (seiten) => {
  const buchungen = [];
  const { von, bis } = wiseZeitraum(seiten);
  const waehrung = wiseWaehrung(seiten);
  let iban = null;

  for (const seite of seiten) {
    const zeilen = seite.zeilen;
    for (let i = 0; i < zeilen.length; i += 1) {
      const zeile = zeilen[i];
      if (!iban) {
        const treffer = zeile.text.match(/\b([A-Z]{2}\d{2}(?:\s?[0-9A-Z]{4}){2,7})\b/);
        if (treffer && /BE|DE|LT/.test(treffer[1].slice(0, 2))) iban = treffer[1].replace(/\s/g, '');
      }

      const saldo = P.betragInSpalte(zeile, WISE_SALDO, 12);
      if (!saldo) continue;
      const ein = P.betragInSpalte(zeile, WISE_EINGEHEND, 12);
      const aus = P.betragInSpalte(zeile, WISE_AUSGEHEND, 12);
      if (!ein && !aus) continue;

      // Vorzeichen aus der Spalte ableiten, nicht aus dem Text: die Spalte ist eindeutig.
      const betrag = ein ? Math.abs(ein.wert) : -Math.abs(aus.wert);
      const beschreibung = P.linksVon(zeile, WISE_TEXT_GRENZE);

      /* Folgezeilen bis zur Datumszeile einsammeln. Nach ihr endet die Buchung —
         ohne dieses Kriterium verschluckt die letzte Buchung einer Seite den
         gesamten Seitenfuss mit Rechtstext und Seitenzahl. */
      const zusatz = [];
      for (let j = i + 1; j < zeilen.length && zusatz.length < 8; j += 1) {
        const naechste = zeilen[j];
        if (P.betragInSpalte(naechste, WISE_SALDO, 12)) break;
        zusatz.push(naechste.text);
        if (P.deutschesDatum(naechste.text)) break;
      }

      const metaZeile = zusatz.find((z) => P.deutschesDatum(z)) || '';
      const datum = P.deutschesDatum(metaZeile);
      if (!datum) continue;

      const referenz = (metaZeile.match(/Referenz:\s*(.+?)(?:\s+Transaktion:|$)/) || [])[1] || null;
      const transaktion = (metaZeile.match(/Transaktion:\s*([A-Z]+-\d+)/) || [])[1] || null;
      // Zeilen zum verzinsten Guthaben sind keine Zahlungen.
      const zusatzText = zusatz
        .filter((z) => z !== metaZeile && !/Einheiten (gekauft|verkauft)/i.test(z))
        .join(' ')
        .trim();

      buchungen.push({
        datum,
        wertstellung: null,
        text: [beschreibung, zusatzText].filter(Boolean).join(' ').trim(),
        betrag,
        waehrung,
        kategorieVorschlag: null,
        verwendung: referenz,
        transaktion,
        saldo: saldo.wert
      });
    }
  }

  const neuester = buchungen[0] || null;
  return {
    bank: 'Wise',
    konto: iban,
    waehrung,
    von,
    bis,
    buchungen,
    kontrolle: { neuerStand: neuester ? neuester.saldo : null, alterStand: null, eingehend: null, ausgehend: null }
  };
};

// ---------------------------------------------------------------- Auswahl

const LESER = [
  { name: 'N26', erkennt: istN26, lesen: n26Lesen },
  { name: 'Wise', erkennt: istWise, lesen: wiseLesen }
];

const auswerten = (seiten) => {
  if (!seiten.length) return { fehler: 'Das PDF enthält keine lesbaren Seiten.' };
  const leser = LESER.find((l) => l.erkennt(seiten));
  if (!leser) {
    return { fehler: 'Bank nicht erkannt. Unterstützt werden zurzeit N26 und Wise.' };
  }
  const ergebnis = leser.lesen(seiten);
  if (!ergebnis.buchungen.length) {
    return { fehler: `${leser.name} erkannt, aber keine Buchungen gefunden. Ist das ein Auszug mit Umsätzen?` };
  }
  const pruefung = pruefen(ergebnis);
  // Erst pruefen, dann sortieren: die Saldokette haengt an der Reihenfolge im Auszug.
  const buchungen = [...ergebnis.buchungen].sort((a, b) => a.datum.localeCompare(b.datum));
  return { ...ergebnis, buchungen, ...pruefung };
};

/**
 * Luecken finden, wo der Auszug keinen Anfangsstand nennt: fuehrt jede Zeile
 * einen laufenden Saldo, muss Saldo minus Betrag den Saldo der Vorzeile ergeben.
 * Bricht die Kette, fehlt eine Buchung oder ein Betrag wurde falsch gelesen.
 */
const saldoKette = (buchungen) => {
  const mitSaldo = buchungen.filter((b) => typeof b.saldo === 'number');
  if (mitSaldo.length < 2) return null;
  const rund = (n) => Math.round(n * 100) / 100;
  let brueche = 0;
  for (let i = 0; i < mitSaldo.length - 1; i += 1) {
    const vorher = rund(mitSaldo[i].saldo - mitSaldo[i].betrag);
    if (Math.abs(vorher - mitSaldo[i + 1].saldo) >= 0.01) brueche += 1;
  }
  return { geprueft: mitSaldo.length - 1, brueche };
};

/** Selbstkontrolle gegen die Zahlen, die im Auszug selbst stehen. */
const pruefen = (ergebnis) => {
  const summe = ergebnis.buchungen.reduce((s, b) => s + b.betrag, 0);
  const rund = (n) => Math.round(n * 100) / 100;
  const k = ergebnis.kontrolle || {};
  const pruefung = {
    anzahl: ergebnis.buchungen.length,
    summe: rund(summe),
    eingehend: rund(ergebnis.buchungen.filter((b) => b.betrag > 0).reduce((s, b) => s + b.betrag, 0)),
    ausgehend: rund(ergebnis.buchungen.filter((b) => b.betrag < 0).reduce((s, b) => s + b.betrag, 0)),
    stimmt: null,
    abweichung: null,
    hinweis: null
  };

  // Bewusst auf echte Zahlen pruefen: ein fehlendes Feld ist undefined, nicht null,
  // und wuerde die Rechnung sonst auf NaN laufen lassen.
  if (Number.isFinite(k.alterStand) && Number.isFinite(k.neuerStand)) {
    const erwartet = rund(k.alterStand + summe);
    pruefung.abweichung = rund(erwartet - k.neuerStand);
    pruefung.stimmt = Math.abs(pruefung.abweichung) < 0.01;
    pruefung.hinweis = pruefung.stimmt
      ? `Kontrolle stimmt: ${k.alterStand.toFixed(2)} + ${summe.toFixed(2)} = ${k.neuerStand.toFixed(2)}`
      : `Abweichung von ${pruefung.abweichung.toFixed(2)} gegenüber dem Auszug — bitte prüfen.`;
  } else {
    const kette = saldoKette(ergebnis.buchungen);
    if (kette) {
      pruefung.stimmt = kette.brueche === 0;
      pruefung.kette = kette;
      pruefung.hinweis = kette.brueche === 0
        ? `Der Auszug nennt keinen Anfangsstand. Stattdessen wurde die Saldokette geprüft: ${kette.geprueft} Übergänge, alle stimmig.`
        : `Die Saldokette bricht an ${kette.brueche} von ${kette.geprueft} Stellen — es fehlt vermutlich eine Buchung. Bitte prüfen.`;
    } else if (Number.isFinite(k.neuerStand)) {
      pruefung.hinweis = `Keine Gegenrechnung möglich. Endsaldo laut Auszug: ${k.neuerStand.toFixed(2)}.`;
    } else {
      pruefung.hinweis = 'Der Auszug enthält keine Zahlen zum Gegenrechnen — bitte stichprobenartig vergleichen.';
    }
  }

  return { pruefung };
};

export { auswerten, n26Lesen, wiseLesen, istN26, istWise, pruefen };
