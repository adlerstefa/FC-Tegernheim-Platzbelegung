#!/usr/bin/env python3
"""E-Mail-Benachrichtigungen bei Änderungen an data.json (läuft als GitHub Action).

Vergleicht den Stand vor und nach dem Push, leitet daraus Ereignisse ab und schickt
je Empfängergruppe (Abteilungsleitung, je Mannschaft) eine gesammelte E-Mail.

Benötigte Secrets: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_VON, KONTAKT_SCHLUESSEL
Wer den Push ausgelöst hat, steht als Präfix in der Commit-Nachricht: "[leitung] …" oder "[trainer] …".
Datenschutz: data.json ist öffentlich und enthält keine Personennamen; Kontakte (Namen, Adressen) liegen nur
verschlüsselt vor und werden hier ausschließlich für den Versand entschlüsselt. Die Mails enthalten nur Belegungsdaten.
"""
import base64
import datetime
import json
import os
import smtplib
import subprocess
import sys
from email.message import EmailMessage

TAGE = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"]
TAGE_KURZ = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]
FELDER = ["platzId", "datum", "von", "bis", "typ", "mannschaft", "kabinen", "notiz"]
FELD_NAMEN = {"platzId": "Platz", "datum": "Datum", "von": "Von", "bis": "Bis", "typ": "Art",
              "mannschaft": "Mannschaft", "kabinen": "Kabinen", "notiz": "Notiz"}


# ---------------------------------------------------------------- Hilfen
def log(*a):
    print(*a, flush=True)


def git_datei(ref):
    if not ref or set(ref) == {"0"}:
        return None
    try:
        raw = subprocess.check_output(["git", "show", f"{ref}:data.json"], stderr=subprocess.DEVNULL)
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return None


def normalisiere(d):
    d = d or {}
    d.setdefault("config", {})
    d["config"].setdefault("plaetze", [])
    d.setdefault("buchungen", [])
    d.setdefault("sperren", [])
    d.setdefault("serien", [])
    for b in d["buchungen"]:
        if not isinstance(b.get("kabinen"), list):
            b["kabinen"] = [b["kabine"]] if b.get("kabine") else []
        b.setdefault("status", "genehmigt")
        b.setdefault("grund", "")
        b.setdefault("notiz", "")
    return d


def de_datum(iso):
    j, m, t = iso.split("-")
    return f"{t}.{m}.{j}"


def de_zeitpunkt(dt):
    d, _, t = str(dt).partition("T")
    return de_datum(d) + (" " + t if t else "")


def wochentag(iso):
    return TAGE[datetime.date.fromisoformat(iso).weekday()]


def platz_name(d, pid):
    for p in d["config"]["plaetze"]:
        if p.get("id") == pid:
            return p.get("name", pid)
    return pid


def ueberlappt(a, b):
    return a["datum"] == b["datum"] and a["von"] < b["bis"] and b["von"] < a["bis"]


def sperre_trifft(sp, b):
    a, e = b["datum"] + "T" + b["von"], b["datum"] + "T" + b["bis"]
    if not (sp["von"] < e and a < sp["bis"]):
        return False
    if sp["art"] == "anlage":
        return True
    if sp["art"] == "platz":
        return sp.get("ziel") == b["platzId"]
    if sp["art"] == "kabine":
        return sp.get("ziel") in b["kabinen"]
    return False


def sperre_ziel(d, sp):
    return {"anlage": "Gesamte Anlage", "platz": platz_name(d, sp.get("ziel")), "kabine": "Kabine " + str(sp.get("ziel"))}.get(sp["art"], "?")


def sperre_text(d, sp):
    return f"{sperre_ziel(d, sp)} · {de_zeitpunkt(sp['von'])} bis {de_zeitpunkt(sp['bis'])}" + (f" · {sp['grund']}" if sp.get("grund") else "")


def beschreibe(d, b):
    s = f"{b['typ']} {b['mannschaft']} · {wochentag(b['datum'])}, {de_datum(b['datum'])} {b['von']}–{b['bis']} · {platz_name(d, b['platzId'])}"
    if b["kabinen"]:
        s += " · " + ", ".join(b["kabinen"])
    if b.get("notiz"):
        s += f" · {b['notiz']}"
    return s


def beschreibe_gruppe(d, gruppe):
    """Eine Buchung oder eine Serie (mehrere Buchungen mit gleicher serieId) als eine Zeile."""
    gruppe = sorted(gruppe, key=lambda x: (x["datum"], x["von"]))
    if len(gruppe) == 1:
        return beschreibe(d, gruppe[0])
    b = gruppe[0]
    tage = sorted({datetime.date.fromisoformat(x["datum"]).weekday() for x in gruppe})
    s = f"Serie {b['typ']} {b['mannschaft']} · {'/'.join(TAGE_KURZ[t] for t in tage)} {b['von']}–{b['bis']} · {platz_name(d, b['platzId'])}"
    if b["kabinen"]:
        s += " · " + ", ".join(b["kabinen"])
    s += f" · {len(gruppe)} Termine vom {de_datum(gruppe[0]['datum'])} bis {de_datum(gruppe[-1]['datum'])}"
    return s


def gruppiere(liste):
    gruppen = {}
    for b in liste:
        gruppen.setdefault(b.get("serieId") or b["id"], []).append(b)
    return list(gruppen.values())


def unterschiede(d, alt, neu):
    diff = []
    for f in FELDER:
        a, n = alt.get(f), neu.get(f)
        if f == "kabinen":
            a, n = ", ".join(a or []) or "–", ", ".join(n or []) or "–"
        elif f == "platzId":
            a, n = platz_name(d, a), platz_name(d, n)
        elif f == "datum":
            a, n = de_datum(a), de_datum(n)
        if str(a or "") != str(n or ""):
            diff.append(f"{FELD_NAMEN[f]}: {a or '–'} → {n or '–'}")
    return diff


# ---------------------------------------------------------------- Ereignisse
class Post:
    def __init__(self):
        self.leitung = []
        self.teams = {}

    def an_leitung(self, zeile):
        self.leitung.append(zeile)

    def an_team(self, mannschaft, zeile):
        self.teams.setdefault(mannschaft, []).append(zeile)

    def leer(self):
        return not self.leitung and not self.teams


def ereignisse(vorher, nachher, rolle):
    post = Post()
    vb = {b["id"]: b for b in vorher["buchungen"]}
    nb = {b["id"]: b for b in nachher["buchungen"]}

    # Neue Buchungen
    for gruppe in gruppiere([b for i, b in nb.items() if i not in vb]):
        text = beschreibe_gruppe(nachher, gruppe)
        konflikte = sum(1 for b in gruppe if b.get("konflikt"))
        status = gruppe[0]["status"]
        if rolle == "leitung":
            if status != "abgelehnt":
                post.an_team(gruppe[0]["mannschaft"], f"Neue Buchung durch die Abteilungsleitung: {text}")
        else:
            zeile = f"Neue Anfrage: {text}"
            if konflikte:
                zeile += f" ⚠ {konflikte} Termin(e) mit Überschneidung"
            post.an_leitung(zeile)

    # Gelöschte Buchungen
    for gruppe in gruppiere([b for i, b in vb.items() if i not in nb]):
        text = beschreibe_gruppe(vorher, gruppe)
        if rolle == "leitung":
            if gruppe[0]["status"] != "abgelehnt":
                post.an_team(gruppe[0]["mannschaft"], f"Gestrichen durch die Abteilungsleitung: {text}")
        else:
            post.an_leitung(f"Vom Trainer gelöscht: {text}")

    # Geänderte Buchungen (nach Serie und Art der Änderung gebündelt)
    buendel = {}
    for i, neu in nb.items():
        alt = vb.get(i)
        if not alt:
            continue
        diff = unterschiede(nachher, alt, neu)
        status_alt, status_neu = alt["status"], neu["status"]
        konflikt_neu = bool(neu.get("konflikt")) and not alt.get("konflikt")
        if not diff and status_alt == status_neu and not konflikt_neu and alt.get("grund", "") == neu.get("grund", ""):
            continue
        schluessel = (neu.get("serieId") or i, status_alt, status_neu, tuple(diff), konflikt_neu, neu.get("grund", ""))
        buendel.setdefault(schluessel, []).append((alt, neu))

    for (sid, status_alt, status_neu, diff, konflikt_neu, grund), paare in buendel.items():
        neue = [n for _, n in paare]
        text = beschreibe_gruppe(nachher, neue)
        team = neue[0]["mannschaft"]
        diff_text = f" ({'; '.join(diff)})" if diff else ""
        if status_neu == "genehmigt" and status_alt != "genehmigt":
            post.an_team(team, f"✅ Genehmigt: {text}{diff_text}")
        elif status_neu == "abgelehnt" and status_alt != "abgelehnt":
            post.an_team(team, f"❌ Abgelehnt: {text}" + (f" · Grund: {grund}" if grund else ""))
        elif rolle == "trainer" and status_neu == "angefragt" and status_alt == "genehmigt":
            post.an_leitung(f"Genehmigte Buchung geändert, erneute Freigabe nötig: {text}{diff_text}")
        elif rolle == "trainer" and diff:
            post.an_leitung(f"Anfrage geändert: {text}{diff_text}")
        elif rolle == "leitung" and diff:
            post.an_team(team, f"Geändert durch die Abteilungsleitung: {text}{diff_text}")
            alte_teams = {a["mannschaft"] for a, _ in paare} - {team}
            for t in alte_teams:
                post.an_team(t, f"Buchung an andere Mannschaft übertragen: {text}{diff_text}")
        if konflikt_neu and rolle == "trainer":
            post.an_leitung(f"⚠ Überschneidung: {text}")

    # Sperren
    vs = {s["id"]: s for s in vorher["sperren"]}
    ns = {s["id"]: s for s in nachher["sperren"]}
    for i, sp in ns.items():
        if i in vs:
            continue
        betroffene = [b for b in nachher["buchungen"] if b["status"] != "abgelehnt" and sperre_trifft(sp, b)]
        pro_team = {}
        for b in betroffene:
            pro_team.setdefault(b["mannschaft"], []).append(b)
        for team, bs in pro_team.items():
            zeilen = "\n".join("     - " + beschreibe(nachher, b) for b in sorted(bs, key=lambda x: (x["datum"], x["von"])))
            post.an_team(team, f"⛔ Sperre betrifft eure Buchung(en): {sperre_text(nachher, sp)}\n{zeilen}")
        if rolle != "leitung":
            post.an_leitung(f"Sperre eingetragen: {sperre_text(nachher, sp)}")
    for i, sp in vs.items():
        if i in ns:
            continue
        betroffene = [b for b in nachher["buchungen"] if b["status"] != "abgelehnt" and sperre_trifft(sp, b)]
        for team in sorted({b["mannschaft"] for b in betroffene}):
            post.an_team(team, f"Sperre aufgehoben: {sperre_text(vorher, sp)}")
    return post


# ---------------------------------------------------------------- Kontakte & Versand
def entschluessele_kontakte(d):
    key_b64 = os.environ.get("KONTAKT_SCHLUESSEL", "").strip()
    k = d.get("kontakte")
    if not key_b64:
        log("Kein Secret KONTAKT_SCHLUESSEL gesetzt – Kontakte in der App speichern.")
        return None
    if not isinstance(k, dict):
        log("Keine Kontakte in data.json hinterlegt.")
        return None
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    klar = AESGCM(base64.b64decode(key_b64)).decrypt(base64.b64decode(k["iv"]), base64.b64decode(k["blob"]), None)
    return json.loads(klar.decode("utf-8"))


def smtp_konfig():
    host = os.environ.get("SMTP_HOST", "").strip()
    if not host:
        return None
    return {
        "host": host,
        "port": int(os.environ.get("SMTP_PORT", "587").strip() or "587"),
        "user": os.environ.get("SMTP_USER", "").strip(),
        "pass": os.environ.get("SMTP_PASS", ""),
        "von": os.environ.get("MAIL_VON", "").strip() or os.environ.get("SMTP_USER", "").strip(),
    }


def maskiere(adresse):
    """E-Mail-Adresse für das Log unkenntlich machen: Actions-Logs sind bei öffentlichen Repos einsehbar."""
    name, _, domain = str(adresse).partition("@")
    return (name[:1] + "***@" + domain) if domain else "***"


def sende(konfig, an, betreff, text, anhang=None):
    """Verschickt eine Text-Mail; anhang = (Dateiname, Bytes) hängt eine JSON-Datei an (Sicherung)."""
    msg = EmailMessage()
    msg["From"] = konfig["von"]
    msg["To"] = ", ".join(an)
    msg["Subject"] = betreff
    msg.set_content(text)
    if anhang:
        name, daten = anhang
        msg.add_attachment(daten, maintype="application", subtype="json", filename=name)
    if konfig["port"] == 465:
        server = smtplib.SMTP_SSL(konfig["host"], konfig["port"], timeout=30)
    else:
        server = smtplib.SMTP(konfig["host"], konfig["port"], timeout=30)
        server.ehlo()
        try:
            server.starttls()
            server.ehlo()
        except smtplib.SMTPNotSupportedError:
            log("Hinweis: Server unterstützt kein STARTTLS.")
    with server:
        if konfig["user"]:
            server.login(konfig["user"], konfig["pass"])
        server.send_message(msg)
    log(f"Mail an {len(an)} Empfänger ({', '.join(maskiere(a) for a in an)}): {betreff}")


def app_url(repo):
    besitzer, _, name = repo.partition("/")
    return f"https://{besitzer}.github.io/{name}/"


def baue_text(zeilen, url):
    return ("Hallo,\n\nin der Platzbelegung des FC Tegernheim gibt es folgende Änderungen:\n\n"
            + "\n".join("  • " + z for z in zeilen)
            + f"\n\nZur Platzbelegung: {url}\n\nDiese Nachricht wurde automatisch erzeugt.\n")


def main():
    repo = os.environ.get("REPO", "")
    url = app_url(repo) if repo else ""
    ereignis = os.environ.get("EREIGNIS", "push")
    konfig = smtp_konfig()
    nachher = normalisiere(git_datei(os.environ.get("NACHHER") or "HEAD"))
    if nachher is None:
        log("data.json nicht lesbar.")
        return 0
    kontakte = entschluessele_kontakte(nachher)

    if ereignis == "workflow_dispatch":
        if not konfig:
            log("FEHLER: Postfach (SMTP_HOST usw.) nicht als Secrets hinterlegt.")
            return 1
        if not kontakte or not kontakte.get("leitung"):
            log("FEHLER: Keine Kontaktadresse der Abteilungsleitung hinterlegt.")
            return 1
        sende(konfig, kontakte["leitung"], "Platzbelegung FC Tegernheim: Test-Mail",
              baue_text(["Das ist eine Test-Mail. Postfach und Kontakte sind korrekt eingerichtet."], url))
        return 0

    vorher = git_datei(os.environ.get("VORHER", ""))
    if vorher is None:
        log("Kein Vorgänger-Stand (erster Commit) – nichts zu vergleichen.")
        return 0
    vorher = normalisiere(vorher)
    commit = os.environ.get("COMMIT_TEXT", "")
    rolle = "leitung" if commit.startswith("[leitung]") else "trainer" if commit.startswith("[trainer]") else "unbekannt"
    post = ereignisse(vorher, nachher, rolle)
    if post.leer():
        log("Keine benachrichtigungswürdigen Änderungen.")
        return 0

    if not konfig:
        log("Postfach nicht eingerichtet. Ereignisse wären gewesen:")
        for z in post.leitung:
            log("  Leitung:", z)
        for t, zs in post.teams.items():
            for z in zs:
                log(f"  {t}:", z)
        return 0
    if not kontakte:
        log("Kontakte nicht verfügbar – keine Mails verschickt.")
        return 0

    leitung = kontakte.get("leitung") or []
    teams = kontakte.get("mannschaften") or {}
    fehler = 0
    for team, zeilen in post.teams.items():
        an = teams.get(team) or []
        if not an:
            post.an_leitung(f"(Keine Kontaktadresse für „{team}“ hinterlegt) " + zeilen[0] + (f" … und {len(zeilen)-1} weitere" if len(zeilen) > 1 else ""))
            continue
        try:
            sende(konfig, an, f"Platzbelegung FC Tegernheim: {len(zeilen)} Änderung{'en' if len(zeilen) != 1 else ''} für {team}", baue_text(zeilen, url))
        except Exception as e:  # noqa: BLE001
            log(f"FEHLER beim Versand an {team}: {type(e).__name__}")
            fehler += 1
    if post.leitung:
        if leitung:
            try:
                sende(konfig, leitung, f"Platzbelegung FC Tegernheim: {len(post.leitung)} Meldung{'en' if len(post.leitung) != 1 else ''}", baue_text(post.leitung, url))
            except Exception as e:  # noqa: BLE001
                log(f"FEHLER beim Versand an die Leitung: {type(e).__name__}")
                fehler += 1
        else:
            log("Keine Kontaktadresse der Abteilungsleitung hinterlegt; Meldungen:", *post.leitung, sep="\n  ")
    return 1 if fehler else 0


if __name__ == "__main__":
    sys.exit(main())
