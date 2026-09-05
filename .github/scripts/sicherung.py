#!/usr/bin/env python3
"""Sicherung der Datendatei per E-Mail (läuft als GitHub Action, monatlich und auf Knopfdruck).

Schickt data.json als Anhang an die Adressen der Abteilungsleitung (verschlüsselt hinterlegte Kontakte) und
zusätzlich an das optionale Secret SICHERUNG_AN (mehrere Adressen mit Komma). Benötigt dieselben Secrets wie
die Benachrichtigung: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_VON, KONTAKT_SCHLUESSEL.
"""
import datetime
import importlib.util
import json
import os
import pathlib
import sys

HIER = pathlib.Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("benachrichtigung", HIER / "benachrichtigung.py")
ben = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ben)


def main():
    pfad = pathlib.Path("data.json")
    if not pfad.exists():
        ben.log("FEHLER: data.json nicht gefunden.")
        return 1
    roh = pfad.read_bytes()
    daten = json.loads(roh.decode("utf-8"))
    konfig = ben.smtp_konfig()
    kontakte = ben.entschluessele_kontakte(daten) or {}
    an = list(kontakte.get("leitung") or [])
    an += [a.strip() for a in os.environ.get("SICHERUNG_AN", "").split(",") if a.strip()]
    an = sorted(set(an))
    if not konfig:
        ben.log("FEHLER: Postfach (SMTP_HOST usw.) nicht als Secrets hinterlegt.")
        return 1
    if not an:
        ben.log("FEHLER: Keine Empfängeradresse (Kontakte der Leitung oder Secret SICHERUNG_AN).")
        return 1
    heute = datetime.date.today().isoformat()
    text = (
        f"Hallo,\n\nanbei die Sicherung der Platzbelegung vom {ben.de_datum(heute)}.\n\n"
        f"  • Buchungen: {len(daten.get('buchungen', []))}\n"
        f"  • Serien: {len(daten.get('serien', []))}\n"
        f"  • Sperren: {len(daten.get('sperren', []))}\n"
        f"  • Stand (Commit): {os.environ.get('GITHUB_SHA', '')[:7] or 'unbekannt'}\n\n"
        "Bitte diese Mail ablegen. Zum Wiederherstellen die angehängte Datei als data.json ins Repository hochladen.\n\n"
        "Diese Nachricht wurde automatisch erzeugt.\n"
    )
    ben.sende(konfig, an, f"Platzbelegung FC Tegernheim: Sicherung {ben.de_datum(heute)}", text, anhang=(f"data-{heute}.json", roh))
    return 0


if __name__ == "__main__":
    sys.exit(main())
