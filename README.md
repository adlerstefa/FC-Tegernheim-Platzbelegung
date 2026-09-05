# FC Tegernheim · Platzbelegung

Verwaltung der vier Fußballplätze inkl. Kabinenzuordnung, Serienterminen, Sperren, Genehmigungs-Ampel und E-Mail-Benachrichtigungen.

## Datenschutz (bitte lesen)

Das Repo ist öffentlich, damit der Belegungsplan ohne Anmeldung angezeigt werden kann. Deshalb gilt:

* **`data.json` enthält keine Personendaten.** Gespeichert werden nur Platz, Datum, Uhrzeit, Art, Mannschaft, Kabinen, Status, Sperren und eine optionale Notiz (z. B. Gastverein). Es gibt kein Trainer-Feld und keine Platzverantwortlichen mehr; alte Datenstände werden beim Laden automatisch bereinigt.
* **Keine Namen in Freitext.** Notiz, Ablehnungs- und Sperrgrund sind öffentlich sichtbar. Die App weist im Formular darauf hin.
* **Kontakte nur verschlüsselt.** Ansprechpartner (Name, optional) und E-Mail-Adressen je Mannschaft liegen AES-256-GCM-verschlüsselt in `data.json`; der Schlüssel liegt nur bei der Abteilungsleitung (Leitungs-Passwort) und als GitHub Secret `KONTAKT_SCHLUESSEL` für den Mailversand.
* **Impressum und Datenschutzerklärung** sind in der App über die Fußzeile erreichbar (Angaben nach www.fc-tegernheim.de, in `index.html` unter `VEREIN`). Bei Änderungen der Vereinsangaben dort nachziehen.
* **Git-Historie.** Frühere Versionen der `data.json` sind öffentlich. Vor dem ersten Deploy dieser Version muss die Historie bereinigt werden, falls dort noch Namen stehen (siehe Deploy-Checkliste im Kundenordner).
* **Mailversand** nur über ein Vereinspostfach (Auftragsverarbeitung geregelt), nicht über private Konten.
* Die Vereinsdokumente (Verzeichnis der Verarbeitungstätigkeiten, Trainer-Information, Löschkonzept, TOM) liegen beim Verein bzw. im Kundenordner „Datenschutz“.

## Dateien

| Datei | Zweck |
|---|---|
| `index.html` | Die komplette App inkl. Impressum und Datenschutzerklärung (ohne Build-Schritt) |
| `data.json` | Belegungsdaten: Konfiguration, Buchungen, Serien, Sperren, verschlüsselte Zugänge und Kontakte |
| `logo.png` | Vereinswappen |
| `qrcode.min.js`, `nacl-fast.min.js` | QR-Codes bzw. Verschlüsselung für GitHub Secrets (lokal eingebunden, keine CDN) |
| `.github/workflows/benachrichtigung.yml` | GitHub Action: verschickt E-Mails bei Änderungen an `data.json` |
| `.github/scripts/benachrichtigung.py` | Das Skript dazu |

## Rollen (Ampelsystem)

| Rolle | Anmeldung | Darf |
|---|---|---|
| Ansicht | ohne Passwort / QR „für alle“ | Plan ansehen |
| Trainer | Trainer-Passwort / Trainer-QR | Buchungen und Serien anlegen (erscheinen **orange** = reserviert), eigene Änderungen. Änderungen an genehmigten Buchungen müssen erneut freigegeben werden. |
| Abteilungsleitung | Leitungs-Passwort / Leitungs-QR | Alles: genehmigen/ablehnen (**grün**/abgelehnt), Sperren (**rot**), Stammdaten, Passwörter, QR-Codes, Kontakte, Benachrichtigungen |

Das eingegebene Passwort entscheidet über die Rolle. Trainer und Leitung verwenden getrennte GitHub-Tokens: das Trainer-Token hat nur *Contents: Read and write*, das Leitungs-Token zusätzlich *Secrets* und *Actions*. Die Rollentrennung gilt in der App (kein Server, der sie erzwingt). Jede Änderung ist in der Git-Historie mit Rolle und Zeitpunkt nachvollziehbar (Commit-Präfix `[trainer]` bzw. `[leitung]`), nicht mit Personennamen.

## Einrichtung

1. **Dateien ins Repo übernehmen** (alle außer `data.json`, sofern die bestehende Datei bleiben soll – sie wird beim ersten Speichern automatisch auf Version 2 gehoben und von Personendaten bereinigt).
2. **Token der Leitung anlegen:** GitHub → Settings → Developer settings → Fine-grained tokens. Nur dieses Repo, Berechtigungen:
   *Contents: Read and write*, *Secrets: Read and write*, *Actions: Read and write*.
3. **Token der Trainer anlegen:** zweites Fine-grained Token, nur dieses Repo, nur *Contents: Read and write*.
4. **Anmelden:** In der App unter „Anmelden“ das Leitungs-Token eingeben → Rolle Leitung. Unter „QR & Zugang“ → Technik das Trainer-Token eintragen und übernehmen.
5. **Passwörter:** „QR & Zugang“ → Leitungs-Passwort und Trainer-Passwort setzen. Danach erscheinen die drei QR-Codes. Trainer- und Leitungs-QR sind vertraulich (der QR enthält das Passwort).
6. **Postfach:** SMTP-Server, Port, Benutzer, Passwort, Absender des Vereinspostfachs eintragen → „In GitHub Secrets speichern“.
7. **Kontakte:** Ansprechpartner und E-Mail-Adressen der Leitung und je Mannschaft eintragen → „Kontakte speichern“ (legt auch das Secret `KONTAKT_SCHLUESSEL` an).
8. **Test-Mail senden** – das Ergebnis steht im Postfach der Leitung bzw. unter GitHub → Actions.

Wer sich nur mit dem Token (statt Leitungs-Passwort) anmeldet, kann Kontakte nicht lesen und keine QR-Codes für Trainer/Leitung erzeugen.

## Benachrichtigungen

Bei jedem Push auf `data.json` vergleicht die Action den alten und neuen Stand.

* **Leitung** erhält: neue Anfragen, geänderte oder gelöschte Anfragen der Trainer, Überschneidungen.
* **Mannschaft** (Adressen der Verantwortlichen) erhält: Genehmigung, Ablehnung mit Begründung, Änderungen oder Streichungen durch die Leitung, Sperren, die eigene Buchungen betreffen.

Je Push und Empfänger geht eine gesammelte Mail raus (eine Serie = eine Zeile). Die Mails enthalten nur Belegungsdaten, keine Namen.

## Datenmodell (Version 2)

* Buchung: `platzId`, `datum`, `von`, `bis`, `typ`, `mannschaft`, `kabinen` (Liste), `notiz`, `status` (`genehmigt` | `angefragt` | `abgelehnt`), `grund`, `serieId`, `konflikt`, `erstelltVon` (Rolle), `geaendertAm`.
* `serien`: Wiederholungsregel (Wochentage, wöchentlich / alle 2 Wochen / monatlich, optionales Ende). Termine werden als einzelne Buchungen angelegt; fortlaufende Serien werden automatisch 6 Monate im Voraus verlängert.
* `sperren`: Anlage, Platz oder Kabine, mit Zeitraum und Grund. Harte Sperre: keine neue Buchung möglich; bestehende Buchungen bleiben markiert stehen.
* `zugang` (Trainer), `zugangLeitung` (Leitung), `kontakte` (verschlüsselt: `leitung`, `mannschaften`, `namen`).

Die Datei wird über die GitHub-API gelesen; ab etwa 3.000 Buchungen (~1 MB) sollten alte Saisons archiviert werden. Nach dem Löschkonzept des Vereins werden Buchungen abgelaufener Saisons spätestens zum Ende der Folgesaison aus `data.json` entfernt.
