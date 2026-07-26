# HDDatenbank

Persönliches Dashboard: Kalender, Aufgaben, Can-Protokoll, Fristen. Läuft lokal auf dem
eigenen Rechner, ohne Cloud und ohne Fremdabhängigkeiten.

Stand: Stufe 1 bis 3. Kalender, Aufgaben, Can-Protokoll, Gemeinde-Akten, Fristen,
Tagesmail und Finanzen mit PDF-Import sind fertig.

## Starten

```powershell
node server.js
```

Dann `http://127.0.0.1:8790/` im Browser öffnen. Beim allerersten Aufruf wird die PIN
festgelegt (4 bis 12 Ziffern). Der Server hört nur auf `127.0.0.1`, ist also aus dem
Netzwerk nicht erreichbar.

## Autostart

Rechtsklick auf `autostart-einrichten.ps1` → „Mit PowerShell ausführen". Danach startet
der Server beim Anmelden unsichtbar und das Dashboard öffnet sich einmal im Browser.

Wieder entfernen:

```powershell
Unregister-ScheduledTask -TaskName "HDDatenbank" -Confirm:$false
```

## Schnelleingabe

Eine Zeile statt Formular. Beispiele:

```
morgen 14 Uhr Zahnarzt !hoch #Privat
3.8. Can gehäutet #Can
15.8. Förderantrag Musterdorf !frist !hoch #Tierschutzzentrum
1.8. bis 5.8. Urlaub
jeden montag Sport
monatlich 1.9. Versicherung !frist
```

Erkannt werden: `heute`, `morgen`, `übermorgen`, Wochentage, `nächsten freitag`, `3.8.`,
`26.07.2026`, `14 Uhr`, `14:30`, `bis <Datum>`, `!hoch` `!mittel` `!gering`, `!frist`,
`#Kategorie`, `täglich` `wöchentlich` `monatlich` `jährlich` `jeden <Wochentag>`.

Vor dem Speichern kommt immer eine Vorschau — es wird nichts still geraten.

## Tierschutzzentrum

Je Gemeinde eine Akte mit Ansprechpartner, Stand (Erstkontakt, Im Gespräch, Antrag läuft,
Zusage, Absage), chronologischem Verlauf, Aufgaben und Dateien. Die Übersicht sortiert nach
Stand und zeigt, seit wie vielen Tagen sich nichts bewegt hat.

**Ein Datum ist bei Aufgaben freiwillig.** Mit Datum verhält sich eine Aufgabe wie eine Frist:
sie erscheint ab 14 Tagen vorher in der Signalzeile der Startseite und in der Tagesmail. Ohne
Datum steht sie nur in der Akte und in der Gemeinden-Kachel der Startseite. Dort ist jede
Gemeinde eine Leiste, die sich aufklappen lässt; rechts steht die Zahl offener Aufgaben, und
wenn keine offen ist, wie bisher der Stillstand. Abhaken geht direkt aus der Kachel.

Im Datenmodell heißt das Feld weiterhin `fristen` — umbenannt wurde nur die Oberfläche, damit
der Bestand keine Migration braucht.

Hochgeladene Dateien werden nach `dokumente/<Gemeinde-ID>/` kopiert, nicht nur verlinkt.
Verschiebst du das Original, bleibt die Akte vollständig.

## Tagesmail

Eine Mail pro Tag über Web3Forms mit heute, morgen, in sieben Tagen und allen Fristen der
nächsten 14 Tage — aus Kalendereinträgen *und* Gemeinde-Akten. Steht nichts an, wird auch
nichts verschickt.

Einzurichten unter Einstellungen: Empfänger, Uhrzeit, Zugangsschlüssel, Haken bei
„Tagesmail verschicken". Vor dem ersten Versand lohnt „Vorschau ansehen".

**Wichtig zur Arbeitsweise:** Web3Forms lehnt Aufrufe vom Server im Gratistarif mit
403 ab — die Schnittstelle ist für den Browser gedacht. Deshalb entscheidet der Server
nur, *wann* die Mail dran ist (`GET /api/mail/faellig`); abgeschickt wird sie von der
geöffneten Dashboard-Seite, die anschließend zurückmeldet (`POST /api/mail/quittung`).
Erst nach erfolgreicher Rückmeldung gilt der Tag als erledigt.

Praktische Folge: die Mail geht raus, sobald das Dashboard geöffnet ist. Der Autostart
öffnet es bei jeder Anmeldung. War es um 07:00 zu, kommt sie beim nächsten Öffnen und
ist im Text als nachträglich gekennzeichnet. Verpasste Tage werden nicht einzeln
aufgerollt — es kommt eine Mail mit dem aktuellen Stand.

Zwei offene Tabs lösen keine zwei Mails aus: ein Auftrag ist zwei Minuten gesperrt,
und ein gemeldeter Fehlschlag gibt ihn sofort wieder frei.

Der Zugangsschlüssel liegt in `data/config.json`. Wer ihn dort nicht haben will, setzt
stattdessen die Umgebungsvariable `HDD_WEB3FORMS_KEY`; sie hat Vorrang.

## Finanzen

Kontoauszüge als PDF einlesen, unterstützt sind **N26** und **Wise**. Ablauf: Datei
wählen, Kontrollansicht prüfen, angehakte Buchungen übernehmen. Ohne diesen Schritt
wird nichts gespeichert.

**Die PDF-Datei wird gelesen und sofort verworfen.** Gespeichert werden nur die
erkannten Buchungen und eine Prüfsumme der Datei, damit ein zweiter Import derselben
Datei auffällt. Kontoauszüge liegen also kein zweites Mal auf der Platte.

Jeder Import kontrolliert sich selbst gegen die Zahlen im Auszug:

- **N26** nennt alten Kontostand, Summe eingehend, Summe ausgehend und neuen Kontostand.
  Geprüft wird, ob alter Stand plus Summe den neuen Stand ergibt.
- **Wise** nennt keinen Anfangsstand, führt aber je Zeile einen laufenden Saldo. Geprüft
  wird die Kette: Saldo minus Betrag muss den Saldo der Vorzeile ergeben. Bricht sie,
  fehlt eine Buchung.

Das Ergebnis steht als Ampel über der Kontrollansicht. Rot heißt nicht „Import
unmöglich", sondern „hier stimmt etwas nicht, sieh es dir an".

### Kategorien und Regeln

N26 liefert je Buchung eine eigene Kategorie mit, die als Vorschlag übernommen wird.
Wise liefert keine. Ordnest du eine Buchung selbst zu, kannst du ein Textstück angeben
(etwa `REWE`) — daraus entsteht eine Regel, die bei künftigen Importen automatisch greift.
Eigene Regeln haben Vorrang vor der Kategorie aus dem Auszug.

Eigene Kategorien legst du dort an, wo sie fehlen: im Auswahlfeld jeder Buchung und in jeder
Zeile der Importkontrolle steht `+ neue Kategorie …`. Die Farbe kommt reihum aus der
Neonpalette. Umbenennen, umfärben und löschen geht unter Einstellungen › Kategorien (Finanzen);
gelöscht wird nur, was an keiner Buchung mehr hängt.

Über „Regeln" lassen sich bestehende Regeln ansehen, löschen und nachträglich auf alle
Buchungen ohne Kategorie anwenden.

### Umbuchungen und Bereiche

Geld, das du zwischen N26 und Wise verschiebst, ist keine Einnahme und keine Ausgabe.
Solche Buchungen als „Umbuchung" markieren — sie erscheinen weiter in der Liste, zählen
aber in keiner Summe mit. Jede Buchung ist zusätzlich privat oder geschäftlich, mit
eigenem Filter in der Übersicht.

### Was der Import nicht kann

- Nur N26 und Wise. Andere Banken brauchen einen eigenen Leser.
- Nur Text-PDFs, keine eingescannten Auszüge.
- Fremdwährungen bei Wise werden mit dem Betrag übernommen, der im Auszug steht;
  es wird nicht umgerechnet.

## Aussehen

Drei Entwürfe, umschaltbar unter Einstellungen:

- **Neonkante** — mattschwarz, kompakt, Farbe ausschließlich als Rand.
- **Ruhige Karten** — hellerer Grafitgrund, mehr Luft, größere Schrift, gedämpfte Ränder.
- **Linie** — tiefes Schwarz, keine Kartenflächen, nur Haarlinien und Typografie.

## Startseite anordnen

Die Startseite besteht aus sieben Kacheln: Fristen, Heute, Morgen, Offene Aufgaben, Finanzen,
Can und Gemeinden. Unter Einstellungen › Startseite anordnen liegt ein verkleinertes Abbild:
Kachel am Griff `≡` anfassen und ziehen, oder über die Knöpfe `‹ ›` die Spalte wechseln,
`⬆ ⬇` in der Spalte verschieben, `⊙` aus- und einblenden. Gespeichert wird sofort.

Drei Vorlagen als Ausgangspunkt:

- **Signalzeile oben** (Vorgabe) — Fristen breit über die volle Breite, darunter drei Spalten.
- **Dreispalter** — drei gleichwertige Spalten, nichts sticht heraus.
- **Arbeitsfläche mit Randleiste** — links der Tag, Aufgaben über die volle Breite, rechts eine
  schmale Leiste.

Am Rechner scrollt die Startseite nicht: jede Kachel hat eine Höhengrenze und scrollt bei Bedarf
für sich. Unter 900 Pixel Breite fällt sie auf eine Spalte und normales Seitenscrollen zurück —
sieben Kacheln passen am Handy nicht in ein Bild.

## Daten

| Ort | Inhalt |
| --- | --- |
| `data/entries.json` | Kalendereinträge und Kategorien |
| `data/tasks.json` | Aufgaben |
| `data/gemeinden.json` | Gemeinde-Akten mit Verlauf und Fristen |
| `data/finanzen.json` | Buchungen, Finanzkategorien, Regeln, Importverlauf |
| `data/config.json` | PIN-Hash, Thema, Mail-Einstellungen, Backup-Stand |
| `data/sessions.json` | offene Anmeldungen |
| `dokumente/<Gemeinde-ID>/` | hochgeladene Dateien |
| `backups/JJJJ-MM-TT/` | tägliche Kopie, die letzten 30 Tage |

`data/` gehört nicht in eine Versionsverwaltung: dort liegen PIN-Hash und
Mail-Zugangsschlüssel.

Für einen Probelauf ohne Berührung der echten Daten lässt sich mit der Umgebungsvariable
`HDD_BASIS` ein anderer Ordner für `data/`, `dokumente/` und `backups/` setzen.

Das Backup wird beim Serverstart angelegt, einmal pro Tag. Läuft der Rechner tagelang
durch, entsteht auch nur ein Stand — dann hilft ein Neustart des Servers.

## Prüfen

```powershell
node --check server.js
node lib/selbsttest.js
```

Der Selbsttest legt seine Daten in einem eigenen Ordner im Temp-Verzeichnis an und
rührt den Echtbestand nicht an.

Beim ersten Start werden die Abhängigkeiten gebraucht:

```powershell
npm install
```

Einzige Fremdabhängigkeit ist `pdfjs-dist` von Mozilla für das Auslesen der
Kontoauszüge. Sie läuft lokal, ohne Internet.

## Grenzen des aktuellen Stands

- Die PIN schützt lokal wenig. Vor einem Fernzugriff muss sie durch ein richtiges
  Passwort ersetzt werden; die Anmeldung liegt dafür gekapselt in `lib/auth.js`.
- Die Tagesmail geht nur raus, wenn das Dashboard im Browser offen ist. Soll sie
  unabhängig davon laufen, braucht es einen Maildienst für Serverbetrieb (Brevo, Resend)
  oder SMTP über ein eigenes Postfach — beides wäre ein Austausch von `lib/mail.js`
  und dem Versandteil in `public/app.js`.
- Serien werden für die Anzeige berechnet, nicht gespeichert. Eine einzelne Ausnahme
  („dieser eine Termin fällt aus") ist noch nicht vorgesehen, nur abhaken.
- Der PDF-Import kennt nur N26 und Wise. Ändert eine der beiden ihr Auszugsformat,
  bricht der jeweilige Leser in `lib/banken.js` und muss angepasst werden. Die
  Selbstkontrolle würde das melden, statt es still zu verschlucken.
