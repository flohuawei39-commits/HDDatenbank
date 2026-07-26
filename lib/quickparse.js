import * as D from './datum.js';

const WOCHENTAGE = {
  montag: 0, mo: 0, dienstag: 1, di: 1, mittwoch: 2, mi: 2, donnerstag: 3, do: 3,
  freitag: 4, fr: 4, samstag: 5, sa: 5, sonnabend: 5, sonntag: 6, so: 6
};

const PRIO = {
  hoch: 'hoch', h: 'hoch', wichtig: 'hoch',
  mittel: 'mittel', m: 'mittel',
  gering: 'gering', g: 'gering', niedrig: 'gering'
};

const raus = (text, regex) => {
  let treffer = null;
  const rest = text.replace(regex, (...args) => {
    if (treffer) return args[0];
    treffer = args.slice(0, -2);
    return ' ';
  });
  return treffer ? { treffer, rest } : { treffer: null, rest: text };
};

const naechsterWochentag = (heute, ziel, heuteErlaubt) => {
  const diff = (ziel - D.wochentag(heute) + 7) % 7;
  if (diff === 0) return heuteErlaubt ? heute : D.plusTage(heute, 7);
  return D.plusTage(heute, diff);
};

const jahrAusZwei = (n) => (n < 100 ? 2000 + n : n);

/**
 * Wandelt eine Zeile wie "morgen 14 Uhr Zahnarzt !hoch #Privat" in einen Eintragsentwurf.
 * Erkennt nichts sicher? Dann bleibt das Feld leer und der Text bleibt stehen —
 * geraten wird nicht, die Vorschau zeigt dem Nutzer immer, was ankommt.
 */
const parse = (eingabe, kategorien = [], heute = null) => {
  const stichtag = heute || D.zuISO(new Date());
  const hinweise = [];
  let rest = ` ${String(eingabe || '')} `;

  let prioritaet = null;
  let istFrist = false;
  let kategorie = null;
  let uhrzeit = null;
  let datum = null;
  let datumBis = null;
  let wiederholung = null;

  // !frist
  const frist = raus(rest, /\s!frist\b/i);
  if (frist.treffer) { istFrist = true; rest = frist.rest; }

  // !hoch / !m / ...
  const prio = raus(rest, /\s!([a-zäöü]+)/i);
  if (prio.treffer) {
    const wort = prio.treffer[1].toLowerCase();
    if (PRIO[wort]) { prioritaet = PRIO[wort]; rest = prio.rest; }
  }

  // #Kategorie — Präfixtreffer reicht, damit #can und #Can gleich gut funktionieren.
  const kat = raus(rest, /\s#([\wäöüß-]+)/i);
  if (kat.treffer) {
    const gesucht = kat.treffer[1].toLowerCase();
    const gefunden = kategorien.find((k) => k.name.toLowerCase() === gesucht)
      || kategorien.find((k) => k.name.toLowerCase().startsWith(gesucht));
    if (gefunden) { kategorie = gefunden.id; rest = kat.rest; }
    else hinweise.push(`Kategorie "${kat.treffer[1]}" gibt es nicht — Eintrag bleibt ohne Kategorie.`);
  }

  // Wiederholung
  const wdhMuster = [
    [/\s(t[aä]glich|jeden tag)\b/i, 'taeglich'],
    [/\s(w[oö]chentlich|jede woche)\b/i, 'woechentlich'],
    [/\s(monatlich|jeden monat)\b/i, 'monatlich'],
    [/\s(j[aä]hrlich|jedes jahr)\b/i, 'jaehrlich']
  ];
  for (const [regex, typ] of wdhMuster) {
    const treffer = raus(rest, regex);
    if (treffer.treffer) { wiederholung = { typ, intervall: 1, bis: null }; rest = treffer.rest; break; }
  }
  if (!wiederholung) {
    const jeden = raus(rest, /\sjeden\s+([a-zäöü]+)/i);
    if (jeden.treffer && WOCHENTAGE[jeden.treffer[1].toLowerCase()] !== undefined) {
      wiederholung = { typ: 'woechentlich', intervall: 1, bis: null };
      datum = naechsterWochentag(stichtag, WOCHENTAGE[jeden.treffer[1].toLowerCase()], true);
      rest = jeden.rest;
    }
  }

  // Uhrzeit zuerst, sonst frisst die Datumserkennung "14.30".
  const zeitMuster = [
    /\s(\d{1,2}):(\d{2})\s*(?:uhr)?/i,
    /\s(\d{1,2})[.](\d{2})\s*uhr/i,
    /\s(?:um\s+)?(\d{1,2})\s*uhr/i
  ];
  for (const regex of zeitMuster) {
    const treffer = raus(rest, regex);
    if (treffer.treffer) {
      const std = Number(treffer.treffer[1]);
      const min = Number(treffer.treffer[2] || 0);
      if (std < 24 && min < 60) {
        uhrzeit = `${String(std).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
        rest = treffer.rest;
      }
      break;
    }
  }

  const datumLesen = (text) => {
    let arbeit = text;

    const iso = raus(arbeit, /\s(\d{4}-\d{2}-\d{2})\b/);
    if (iso.treffer) return { datum: iso.treffer[1], rest: iso.rest };

    const punkt = raus(arbeit, /\s(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/);
    if (punkt.treffer) {
      const tag = Number(punkt.treffer[1]);
      const monat = Number(punkt.treffer[2]);
      if (tag >= 1 && tag <= 31 && monat >= 1 && monat <= 12) {
        let jahr = punkt.treffer[3] ? jahrAusZwei(Number(punkt.treffer[3])) : Number(stichtag.slice(0, 4));
        let wert = `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
        if (!punkt.treffer[3] && D.differenzTage(wert, stichtag) > 60) {
          jahr += 1;
          wert = `${jahr}-${String(monat).padStart(2, '0')}-${String(tag).padStart(2, '0')}`;
          hinweise.push(`Ohne Jahresangabe und deutlich in der Vergangenheit — als ${D.formatDE(wert)} gelesen.`);
        }
        return { datum: wert, rest: punkt.rest };
      }
    }

    const relativ = raus(arbeit, /\s(heute|morgen|übermorgen|uebermorgen|gestern)\b/i);
    if (relativ.treffer) {
      const wort = relativ.treffer[1].toLowerCase();
      const versatz = { heute: 0, morgen: 1, übermorgen: 2, uebermorgen: 2, gestern: -1 }[wort];
      return { datum: D.plusTage(stichtag, versatz), rest: relativ.rest };
    }

    const naechst = raus(arbeit, /\sn[aä]chste[nr]?\s+([a-zäöü]+)/i);
    if (naechst.treffer && WOCHENTAGE[naechst.treffer[1].toLowerCase()] !== undefined) {
      return { datum: naechsterWochentag(stichtag, WOCHENTAGE[naechst.treffer[1].toLowerCase()], false), rest: naechst.rest };
    }

    const tag = raus(arbeit, /\s(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonnabend|sonntag)\b/i);
    if (tag.treffer) {
      return { datum: naechsterWochentag(stichtag, WOCHENTAGE[tag.treffer[1].toLowerCase()], true), rest: tag.rest };
    }

    return { datum: null, rest: arbeit };
  };

  // "bis <datum>" vor dem Startdatum auflösen, sonst schnappt sich der Start den zweiten Termin.
  const bisTeil = rest.match(/\sbis\s+(.+)$/i);
  if (bisTeil) {
    const gelesen = datumLesen(` ${bisTeil[1]} `);
    if (gelesen.datum) {
      datumBis = gelesen.datum;
      rest = `${rest.slice(0, bisTeil.index)} ${gelesen.rest} `;
    }
  }

  if (!datum) {
    const gelesen = datumLesen(rest);
    datum = gelesen.datum;
    rest = gelesen.rest;
  }

  const text = rest.replace(/\s+/g, ' ').trim();

  if (!datum) { datum = stichtag; hinweise.push('Kein Datum erkannt — auf heute gesetzt.'); }
  if (datumBis && datumBis < datum) { datumBis = null; hinweise.push('Enddatum lag vor dem Startdatum und wurde verworfen.'); }
  if (!text) hinweise.push('Kein Text erkannt.');

  return {
    datum,
    datumBis,
    uhrzeit,
    text,
    kategorie,
    prioritaet: prioritaet || 'mittel',
    istFrist,
    wiederholung,
    hinweise
  };
};

export { parse };
