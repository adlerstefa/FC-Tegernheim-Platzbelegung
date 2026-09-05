# FC Tegernheim · Platzbelegung

Verwaltung der vier Fußballplätze inkl. Kabinenzuordnung, Serienterminen, Sperren, Genehmigungs-Ampel und E-Mail-Benachrichtigungen.

## Datenschutz (bitte lesen)

Das Repo ist öffentlich, damit der Belegungsplan ohne Anmeldung angezeigt werden kann. Deshalb gilt:

* **`data.json` enthält keine Personendaten.** Gespeichert werden nur Platz, Datum, Uhrzeit, Art, Mannschaft, Kabinen, Status, Sperren und eine optionale Notiz (z. B. Gastverein). Es gibt kein Trainer-Feld und keine Platzverantwortlichen mehr; alte Datenstände werden beim Laden automatisch bereinigt.
* **Keine Namen in Freitext.** Notiz, Ablehnungs- und Sperrgrund sind öffentlich sichtbar. Die App weist im Formular darauf hin.
* **Kontakte nur verschlüsselt.** Ansprechpartner (Name, optional) und E-Mail-Adressen je Mannschaft liegen AES-256-GCM-verschlüsselt in `data.json`; der Schlüssel liegt nur bei der Abteilungsleitung (Leitungs-Passwort) und als GitHub Secret `KONTAKT_SCHLUESSEL` für den Mailversand.
* **Impressum und Datenschutzerklärung** sind in der App über die Fußzeile erreichbar (Angaben nach www.fc-tegernheim.de, in `index.html` unter `VEREIN`). Bei Änderungen der Vereinsangaben dort nachziehen.
* **Mailversand** nur über ein Vereinspostfach (Auftragsverarbeitung geregelt), nicht über private Konten.
* Die Vereinsdokumente (Verzeichnis der Verarbeitungstätigkeiten, Trainer-Information, Löschkonzept, TOM) liegen beim Verein.
