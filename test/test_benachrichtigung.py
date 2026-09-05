"""Tests für die Ereignisableitung der E-Mail-Benachrichtigung. Ausführen mit:
   python3 -m unittest discover -s test -p "test_*.py" -v
"""
import importlib.util
import pathlib
import unittest

SKRIPT = pathlib.Path(__file__).resolve().parent.parent / ".github" / "scripts" / "benachrichtigung.py"
spec = importlib.util.spec_from_file_location("benachrichtigung", SKRIPT)
ben = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ben)


def stand(buchungen=(), sperren=()):
    return ben.normalisiere({
        "config": {"plaetze": [{"id": "p1", "name": "Platz 1"}, {"id": "p2", "name": "Platz 2"}]},
        "buchungen": [dict(b) for b in buchungen],
        "sperren": [dict(s) for s in sperren],
        "serien": [],
    })


def buchung(**o):
    b = {"id": "b1", "platzId": "p1", "datum": "2026-09-12", "von": "18:00", "bis": "19:30", "typ": "Training",
         "mannschaft": "1. Mannschaft", "kabinen": ["Heim 1"], "notiz": "", "status": "angefragt", "grund": ""}
    b.update(o)
    return b


class Ereignisse(unittest.TestCase):
    def test_neue_anfrage_eines_trainers_geht_an_die_leitung(self):
        post = ben.ereignisse(stand(), stand([buchung()]), "trainer")
        self.assertEqual(len(post.leitung), 1)
        self.assertTrue(post.leitung[0].startswith("Neue Anfrage:"))
        self.assertEqual(post.teams, {})

    def test_genehmigung_geht_an_die_mannschaft(self):
        post = ben.ereignisse(stand([buchung()]), stand([buchung(status="genehmigt")]), "leitung")
        self.assertEqual(post.leitung, [])
        self.assertTrue(post.teams["1. Mannschaft"][0].startswith("✅ Genehmigt:"))

    def test_ablehnung_nennt_den_grund(self):
        post = ben.ereignisse(stand([buchung()]), stand([buchung(status="abgelehnt", grund="Platz gesperrt")]), "leitung")
        zeile = post.teams["1. Mannschaft"][0]
        self.assertTrue(zeile.startswith("❌ Abgelehnt:"))
        self.assertIn("Grund: Platz gesperrt", zeile)

    def test_aenderung_einer_genehmigten_buchung_braucht_erneute_freigabe(self):
        vorher = stand([buchung(status="genehmigt")])
        nachher = stand([buchung(status="angefragt", von="19:00", bis="20:30")])
        post = ben.ereignisse(vorher, nachher, "trainer")
        self.assertEqual(len(post.leitung), 1)
        self.assertIn("erneute Freigabe nötig", post.leitung[0])
        self.assertIn("Von: 18:00 → 19:00", post.leitung[0])

    def test_neue_sperre_informiert_betroffene_mannschaft(self):
        sperre = {"id": "x1", "art": "platz", "ziel": "p1", "von": "2026-09-12T00:00", "bis": "2026-09-12T23:59", "grund": "Platzpflege"}
        post = ben.ereignisse(stand([buchung(status="genehmigt")]), stand([buchung(status="genehmigt")], [sperre]), "leitung")
        self.assertTrue(post.teams["1. Mannschaft"][0].startswith("⛔ Sperre betrifft eure Buchung(en)"))
        self.assertEqual(post.leitung, [])

    def test_unveraenderter_stand_erzeugt_keine_post(self):
        post = ben.ereignisse(stand([buchung()]), stand([buchung()]), "trainer")
        self.assertTrue(post.leer())

    def test_serie_wird_als_eine_zeile_gemeldet(self):
        neue = [buchung(id=f"b{i}", datum=d, serieId="s1") for i, d in enumerate(["2026-09-07", "2026-09-14", "2026-09-21"])]
        post = ben.ereignisse(stand(), stand(neue), "trainer")
        self.assertEqual(len(post.leitung), 1)
        self.assertIn("3 Termine", post.leitung[0])


class Hilfen(unittest.TestCase):
    def test_maskiere_verbirgt_den_lokalen_teil(self):
        self.assertEqual(ben.maskiere("max.mustermann@example.org"), "m***@example.org")
        self.assertEqual(ben.maskiere("kaputt"), "***")


if __name__ == "__main__":
    unittest.main()
