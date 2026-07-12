# FC Tegernheim · Platzbelegung

Verwaltung der vier Fußballplätze (Platz 1, Platz 2, Platz Am Damm, Kleinfeld) inkl.
Kabinenzuordnung — nach derselben Infrastruktur wie die Birchinger Tracking App:

- **Interner QR-Code** → schaltet den Trainer-Zugang frei (Buchen + Bearbeiten)
- **Externer QR-Code** → öffentlicher, schreibgeschützter Belegungsplan
- **GitHub Pages** als Hosting, `data.json` im Repo als gemeinsamer Datenspeicher
- **Stammdaten editierbar**: Platznamen, Verantwortliche, Mannschaften (Standard: 6), Trainer, Kabinennamen

## Deploy (komplett im Browser, ~5 Minuten)

1. **Repo anlegen:** Auf [github.com/new](https://github.com/new) ein neues Repository
   `fct-platzbelegung` erstellen (**Public**, ohne README).
2. **Dateien hochladen:** Im neuen Repo auf *„uploading an existing file"* klicken und diese
   vier Dateien aus dem Ordner hineinziehen, dann *Commit changes*:
   - `index.html`
   - `data.json`
   - `qrcode.min.js`
   - `logo.png`
3. **Pages aktivieren:** Repo → *Settings* → *Pages* → Source: *Deploy from a branch* →
   Branch `main` / `/ (root)` → *Save*. Nach 1–2 Minuten läuft die App unter
   `https://<benutzername>.github.io/fct-platzbelegung/`
4. **Zugangsschlüssel erstellen:** GitHub → *Settings* → *Developer settings* →
   *Personal access tokens* → *Fine-grained tokens* → *Generate new token*:
   - **Repository access:** *Only select repositories* → `fct-platzbelegung`
   - **Permissions:** *Contents* → **Read and write** (sonst nichts)
   - Ablaufdatum großzügig wählen (z. B. 1 Jahr), Token kopieren
5. **App einrichten:** Die Pages-URL öffnen → Menüpunkt **⚙ Zugang** → Token einfügen →
   *Übernehmen*. Damit ist dieses Gerät freigeschaltet und die Seite zeigt beide QR-Codes.
6. **QR-Codes drucken:** Auf der QR-Seite *🖨 drucken*.
   - **Intern** (roter Rahmen): enthält den Schlüssel → nur an Trainer / ins Vereinsheim.
   - **Extern** (schwarzer Rahmen): reine Plan-Ansicht → Aushang, Website, Gastvereine.

## Hinweise

- Das Repo ist öffentlich → Buchungsdaten (Trainer-Namen, Zeiten) sind öffentlich lesbar.
  Das entspricht dem externen Plan-QR und ist gewollt; keine sensiblen Daten eintragen.
- Schreiben können nur Geräte mit dem Token (interner QR). Token kompromittiert?
  Auf GitHub widerrufen, neues erstellen, neuen internen QR drucken.
- Gleichzeitige Buchungen werden zusammengeführt (die App wendet Änderungen immer auf den
  aktuellsten Server-Stand an und wiederholt bei Konflikt).
- Konfliktwarnung bei Doppelbelegung von Platz oder Kabine (kann bewusst übersteuert werden).
- Ohne verbundenes Repo läuft die App im lokalen Modus (Speicherung nur auf dem Gerät) —
  praktisch zum Testen.
