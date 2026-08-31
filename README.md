# HDDatenbank

Persönliches Dashboard: Kalender, Aufgaben, Can-Protokoll, Gemeinde-Akten, Fristen und
Finanzen mit PDF-Import, dazu eine Reimwerkstatt und selbst angelegte Reiter. Läuft
vollständig im Browser, ohne Server.

Die Daten liegen verschlüsselt in einem privaten GitHub-Repository und stehen damit auf
jedem Gerät zur Verfügung. Verschlüsselt und entschlüsselt wird ausschließlich im Browser;
GitHub sieht nur Kauderwelsch.

## Aufbau

| Wo | Was |
| --- | --- |
| Dieses Repository, öffentlich | Der Programmcode. Er enthält keine Daten und keine Geheimnisse. |
| `HDDatenbank-daten`, privat | Der verschlüsselte Bestand. Wird von der App geschrieben. |
| Browser (IndexedDB) | Lokaler Spiegel, damit die App sofort startet und offline läuft. |

Es gibt keinen Server. `index.html` lädt `app.js`, das über `lib/routen.js` dieselben
Aufrufe bedient, die früher an einen Node-Server gingen.

## Reime, Zeilen, Texte

Der Reiter „Reime" hat drei Unterreiter. Gerechnet wird überall mit **Silbenkernen**: dem
Vokal, Umlaut oder Doppellaut, der in einer Silbe steckt. „Hundesteuer" ergibt u, e, eu, e.
Fest verabredet sind dabei äu → eu, ai und ay → ei, y → i; Doppelvokale und Dehnungs-h
fallen auf den Grundvokal zusammen. „ie" ist ein eigener Laut und wird **nicht** zu i —
wer beides gleich behandeln will, merkt an der Silbe zusätzlich i an. Das Regelwerk steht in `lib/silben.js` und
kommt ohne Wörterbuch aus — was daneben liegt, korrigierst du an der Silbe selbst.

- **Reime**: ein Kopfbegriff, darunter die Reime. Die Zeilen werden so verschoben, dass die
  passenden Silben untereinander stehen; hinter jeder steht, wie viele Silben zur Zeile
  darüber und darunter passen und wie viele es insgesamt sind. Der Haken unter einer Zeile
  klappt Vorschläge aus dem Bestand auf.
- **Zeilen** sammelt einzelne Zeilen, **Texte** ganze Stücke. Färbung und Ausrichtung gibt
  es dort auch, sind aber standardmäßig aus (Einstellungen › Silbenfarben).

Ein Klick auf eine Silbe öffnet ihre **Anmerkungen**: bis zu drei weitere Laute mit
Priorität, dazu der Schalter, ob der geschriebene Buchstabe oder die Anmerkung schwerer
wiegt. Getroffen ist eine Silbe, sobald der Kern **oder** eine Anmerkung passt — die
Priorität entscheidet nur über Farbe und Rangfolge. Anmerkungen hängen am Wort und gelten
damit überall.

Stimmt die gerechnete Ausrichtung einmal nicht, schieben die Pfeile ‹ und › eine Zeile von
Hand um je eine Silbenzelle — beliebig oft, ohne Grenze. Wandert eine Zeile über den linken
Rand hinaus, rückt die Gruppe nach, statt sie abzuschneiden. Ein gesetzter Schub hängt an
der Zeile und bringt den Knopf ⟲ mit, der die Rechnung wiederherstellt.

Ein Eintrag kann den Reiter wechseln: im Ändern-Fenster steht „Verschieben nach". Eine
Gruppe zerfällt dabei in ihren Kopfbegriff und die Reime darunter, ein Text in seine
Zeilen, eine Zeile wird zum Kopfbegriff einer neuen Gruppe. Kategorien wandern nur mit,
wenn es sie im Zielreiter gibt. Unter Einstellungen › Kategorien zieht das Feld „umziehen"
eine ganze Kategorie samt allem, was daran hängt, in einen anderen Reiter.

Enter schickt ab: in jedem Fenster ist das „Speichern", in einer Zeile der Einstellungen
ihr eigenes „Sichern", und die Felder unter einer Liste legen damit den neuen Eintrag an.
Mehrzeilige Felder bleiben außen vor — dort ist Enter der Zeilenumbruch.

Die **Silbensuche** nimmt bis zu zehn Silben in fester Reihenfolge. Die Zahl daneben sagt,
wie viele fremde Silben dazwischen übersprungen werden dürfen; was vor oder hinter dem
Muster steht, bleibt frei. Gesucht wird nur im Reime-Bestand.

## Eigene Reiter

Unter Einstellungen › Reiter lassen sich die vorhandenen Reiter umbenennen, ausblenden und
verschieben — außer Start und Einstellungen, sonst sperrt man sich aus. Dazu kommen eigene
Reiter mit selbst festgelegten Feldern (Text, mehrzeilig, Zahl, Geld, Datum, Auswahl,
Haken), wahlweise mit eigener Kachel auf der Startseite. Ein entferntes Feld nimmt seine
Werte nicht mit: legt man es wieder an, sind sie zurück.

## Einrichten

1. **Datenrepository anlegen.** Ein neues, **privates** Repository, zum Beispiel
   `HDDatenbank-daten`. Es darf leer bleiben.
2. **Zugriffsschlüssel erzeugen.** GitHub → Settings → Developer settings → Personal access
   tokens → Fine-grained tokens. Nur dieses eine Repository auswählen, als Recht genügt
   `Contents: Read and write`. Sonst nichts.
3. **App öffnen**, Passwort festlegen, unter Einstellungen › Abgleich mit GitHub Kontoname,
   Repository und Schlüssel eintragen.

Auf einem zweiten Gerät dieselbe Adresse öffnen und dasselbe Passwort samt Schlüssel
eintragen. Der Bestand kommt dann von selbst.

## Passwort

Das Passwort ist keine Abfrage, sondern der Schlüssel: daraus wird über PBKDF2 abgeleitet,
womit AES-GCM ver- und entschlüsselt. Deshalb gibt es **kein Zurücksetzen**. Ohne das
Passwort sind die Daten verloren, auch für jemanden mit vollem Zugriff auf das Repository.

Solange kein Zugriffsschlüssel hinterlegt ist, bleibt alles auf dem Gerät und jedes Passwort
ist erlaubt — auch das Startpasswort `HDD`. Sobald der Abgleich eingerichtet wird, verlangt
die App mindestens zwölf Zeichen und weist kürzere ab.

## Sicherung

Unter Einstellungen › Sicherung liegt der gesamte Bestand als eine Datei. Sie ist
**unverschlüsselt und lesbar** und ersetzt den früheren `data/`-Ordner: zum Umziehen auf ein
anderes Gerät und als Rückweg, falls etwas schiefgeht. Sie gehört nicht in eine Cloud und
nicht in ein Repository. Die `.gitignore` hält sie bewusst draußen.

## Abgleich, offline, Konflikte

Geschrieben wird über die Git-Data-Routen: alle geänderten Dateien landen in einem einzigen
Commit, und das Aktualisieren der Zweigreferenz läuft ohne `force`. Genau daran scheitert ein
veralteter Stand, und genau das ist die Konflikterkennung.

- **Ohne Netz** wird normal weitergearbeitet; die Änderungen sammeln sich im lokalen Spiegel
  und gehen beim nächsten Mal hoch.
- **Bei einem Konflikt** — zwei Geräte haben unabhängig geschrieben — wird nichts
  überschrieben. Es erscheint eine Gegenüberstellung beider Stände, und du entscheidest.
  Automatisch zusammengeführt wird bewusst nicht: bei widersprechenden Einträgen trifft das
  zuverlässig die falsche Wahl.
- Ein Klick auf die Statusanzeige oben rechts gleicht von Hand ab.

## Startseite

Sieben Kacheln: Fristen, Heute, Morgen, Offene Aufgaben, Finanzen, Can und Gemeinden. Unter
Einstellungen › Startseite anordnen liegt ein verkleinertes Abbild: Kachel am Griff `≡`
anfassen und ziehen, oder über die Knöpfe `‹ ›` die Spalte wechseln, `⬆ ⬇` verschieben,
`⊙` aus- und einblenden.

Drei Vorlagen: **Signalzeile oben** (Vorgabe), **Dreispalter**, **Arbeitsfläche mit
Randleiste**. Am Rechner scrollt die Startseite nicht — jede Kachel hat eine Höhengrenze und
scrollt bei Bedarf für sich. Unter 900 Pixel Breite fällt sie auf eine Spalte zurück.

## Schnelleingabe

Eine Zeile statt Formular:

```
morgen 14 Uhr Zahnarzt !hoch #Privat
3.8. Can gehäutet #Can
15.8. Förderantrag Musterdorf !frist !hoch #Tierschutzzentrum
1.8. bis 5.8. Urlaub
jeden montag Sport
monatlich 1.9. Versicherung !frist
```

Erkannt werden `heute`, `morgen`, `übermorgen`, Wochentage, `nächsten freitag`, `3.8.`,
`26.07.2026`, `14 Uhr`, `14:30`, `bis <Datum>`, `!hoch` `!mittel` `!gering`, `!frist`,
`#Kategorie`, `täglich` `wöchentlich` `monatlich` `jährlich` `jeden <Wochentag>`.

Vor dem Speichern kommt immer eine Vorschau — es wird nichts still geraten.

## Tierschutzzentrum

Je Gemeinde eine Akte mit Ansprechpartner, Stand, chronologischem Verlauf, Aufgaben und
Dokumenten.

**Ein Datum ist bei Aufgaben freiwillig.** Mit Datum erscheint die Aufgabe ab 14 Tagen vorher
in der Signalzeile und in der Tagesmail. Ohne Datum steht sie nur in der Akte und in der
Gemeinden-Kachel der Startseite. Dort ist jede Gemeinde eine aufklappbare Leiste; rechts steht
die Zahl offener Aufgaben, sonst wie bisher der Stillstand.

**Dokumente werden gelesen, nicht gespeichert.** Ein PDF wird eingelesen, der Text landet in
der Akte, die Datei wird verworfen. Der Text ist danach durchsuchbar, die Suche findet also
auch innerhalb von Förderbescheiden. Eingescannte Schreiben haben keine Textebene und liefern
nichts — das steht dann auch so in der Liste.

Im Datenmodell heißt das Aufgabenfeld weiterhin `fristen`; umbenannt wurde nur die Oberfläche,
damit der Bestand keine Migration braucht.

## Tagesmail

Eine Mail pro Tag über Web3Forms mit heute, morgen, in sieben Tagen und allen Fristen der
nächsten 14 Tage, aus Kalendereinträgen und Gemeinde-Akten. Steht nichts an, wird nichts
verschickt.

Verschickt wird aus der geöffneten Seite heraus — Web3Forms lehnt serverseitige Aufrufe im
Gratistarif mit 403 ab. Praktische Folge: die Mail geht raus, sobald das Dashboard offen ist.
War es um 07:00 zu, kommt sie beim nächsten Öffnen und ist als nachträglich gekennzeichnet.

## Finanzen

Kontoauszüge als PDF einlesen, unterstützt sind **N26** und **Wise**. Datei wählen,
Kontrollansicht prüfen, angehakte Buchungen übernehmen. Ohne diesen Schritt wird nichts
gespeichert. Die Datei wird gelesen und sofort verworfen; gespeichert werden nur die
erkannten Buchungen und eine Prüfsumme zur Doppelerkennung.

Jeder Import kontrolliert sich selbst gegen die Zahlen im Auszug:

- **N26** nennt alten Kontostand, Summen und neuen Kontostand. Geprüft wird, ob die Rechnung
  aufgeht.
- **Wise** nennt keinen Anfangsstand, führt aber je Zeile einen laufenden Saldo. Geprüft wird
  die Kette: bricht sie, fehlt eine Buchung.

Das Ergebnis steht als Ampel über der Kontrollansicht. Rot heißt nicht „Import unmöglich",
sondern „hier stimmt etwas nicht, sieh es dir an".

Eigene Kategorien legst du dort an, wo sie fehlen: im Auswahlfeld jeder Buchung und in jeder
Zeile der Importkontrolle steht `+ neue Kategorie …`. Verwaltet werden sie unter
Einstellungen › Kategorien (Finanzen). Geld zwischen eigenen Konten als „Umbuchung" markieren
— es zählt dann in keiner Summe mit.

**Was der Import nicht kann:** nur N26 und Wise, nur Text-PDFs ohne Scan, und Fremdwährungen
bei Wise werden mit dem Betrag aus dem Auszug übernommen ohne Umrechnung.

## Aussehen

Drei Entwürfe, umschaltbar unter Einstellungen: **Neonkante** (mattschwarz, kompakt, Farbe nur
als Rand), **Ruhige Karten** (hellerer Grund, mehr Luft), **Linie** (tiefes Schwarz, nur
Haarlinien und Typografie).

## Prüfen

```bash
npm test
```

217 Prüfungen: Datumsrechnung, Serien, Schnelleingabe, Suche, Kontoauszüge beider Banken,
Verschlüsselung, Passwortregel, Startseiten-Layout und Gemeinde-Dokumente. Der Bestand liegt
dabei nur im Speicher; der Test kann nichts außerhalb des Prozesses anfassen.

Örtlich ausprobieren:

```bash
python -m http.server 8790
```

## Grenzen

- **Kein Zurücksetzen des Passworts.** Das ist der Preis dafür, dass GitHub die Daten nicht
  lesen kann.
- Der Zugriffsschlüssel liegt im Browserspeicher, wenn „merken" angehakt ist. Auf fremden
  Geräten abwählen; er gilt dann nur bis zum Schließen.
- Die Tagesmail geht nur raus, wenn die Seite offen ist.
- Serien werden für die Anzeige berechnet, nicht gespeichert. Eine einzelne Ausnahme
  („dieser eine Termin fällt aus") ist nicht vorgesehen, nur abhaken.
- Der PDF-Import kennt nur N26 und Wise. Ändert eine der beiden ihr Format, bricht der
  jeweilige Leser in `lib/banken.js`. Die Selbstkontrolle meldet das, statt es zu verschlucken.
- Zusammengeführt wird bei Konflikten nicht, nur gewählt.
