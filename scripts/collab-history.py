#!/usr/bin/env python3
"""collab-history — doorzoek en reconstrueer eerdere collab-sessies.

De uitkomst van een collab leek te verdampen omdat de samenvattingen in /tmp
staan. Dat is maar de helft van het verhaal: de volledige historie staat gewoon
in ~/.ensemble/ensemble/ (teams.json plus een feed per team), maanden terug. Er
was alleen geen enkele manier om erbij te komen zonder handmatig door tientallen
megabytes jsonl te ploegen.

Dit script bouwt daarom niets nieuws op. Het leest wat er al ligt en maakt de
samenvatting die er destijds niet gekomen is, op het moment dat je hem opvraagt.

    collab-history                       de laatste sessies
    collab-history example               everything about the example team
    collab-history --toon 3b880c02       samenvatting van die sessie
    collab-history --toon 3b880c02 --vol volledig transcript
    collab-history --zonder-samenvatting alleen wat nooit is samengevat
"""
import argparse
import json
import os
import re
import sys
from collections import Counter

BASE = os.path.expanduser("~/.ensemble/ensemble")
RUNTIME = "/tmp/ensemble"
# Regels van het systeem zelf: die zijn ruis bij het terugzoeken, en bij de teams
# met een doorgeslagen watchdog vormen ze 96% van het bestand.
SYSTEEM = {"ensemble", "user", "michel", ""}


def laad_teams():
    pad = os.path.join(BASE, "teams.json")
    if not os.path.exists(pad):
        sys.exit(f"geen teams.json in {BASE}")
    data = json.load(open(pad))
    teams = data if isinstance(data, list) else data.get("teams", [])
    return {t["id"]: t for t in teams if isinstance(t, dict) and t.get("id")}


def lees_feed(team_id):
    """Agentberichten van een team, ontdubbeld op id en zonder systeemruis."""
    pad = os.path.join(BASE, "messages", team_id, "feed.jsonl")
    if not os.path.exists(pad):
        return []
    uit, gezien = [], set()
    for regel in open(pad, errors="replace"):
        try:
            obj = json.loads(regel)
        except ValueError:
            continue
        for m in obj if isinstance(obj, list) else [obj]:
            if not isinstance(m, dict):
                continue
            mid = m.get("id")
            if mid and mid in gezien:
                continue
            if mid:
                gezien.add(mid)
            afzender = (m.get("from") or "").strip()
            inhoud = (m.get("content") or "").strip()
            if not inhoud or afzender in SYSTEEM:
                continue
            if "Watchdog" in inhoud or inhoud.startswith(("👀", "❌ Watchdog")):
                continue
            uit.append({"van": afzender, "tekst": inhoud, "tijd": m.get("timestamp") or ""})
    return uit


def heeft_samenvatting(team_id):
    return os.path.exists(os.path.join(RUNTIME, team_id, "summary.txt"))


def overzicht(teams, term=None, alleen_zonder=False, limiet=25):
    rijen = []
    for tid, t in teams.items():
        omschrijving = (t.get("description") or "").replace("\n", " ")
        berichten = None
        if term:
            # eerst goedkoop op de omschrijving, pas daarna door de feed
            if term.lower() not in omschrijving.lower():
                berichten = lees_feed(tid)
                if not any(term.lower() in b["tekst"].lower() for b in berichten):
                    continue
        if berichten is None:
            berichten = lees_feed(tid)
        if not berichten:
            continue
        if alleen_zonder and heeft_samenvatting(tid):
            continue
        rijen.append({
            "id": tid,
            "datum": (t.get("createdAt") or "")[:10],
            "n": len(berichten),
            "agents": sorted({b["van"].rsplit("-", 1)[0] for b in berichten}),
            "omschrijving": omschrijving,
            "sam": heeft_samenvatting(tid),
        })
    rijen.sort(key=lambda r: r["datum"], reverse=True)
    if not rijen:
        print("niets gevonden")
        return
    print(f"{len(rijen)} sessies" + (f" met '{term}'" if term else "") + f", nieuwste {min(limiet, len(rijen))}:\n")
    for r in rijen[:limiet]:
        merk = " " if r["sam"] else "*"
        print(f"  {merk}{r['id'][:8]}  {r['datum']}  {r['n']:>4} ber.  "
              f"{','.join(r['agents'])[:26]:<26} {r['omschrijving'][:58]}")
    if any(not r["sam"] for r in rijen[:limiet]):
        print("\n  * = hier is destijds nooit een samenvatting van geschreven")
    print(f"\n  volledig bekijken: collab-history --toon <id>")


def toon(teams, prefix, volledig=False):
    treffers = [tid for tid in teams if tid.startswith(prefix)]
    if not treffers:
        sys.exit(f"geen sessie die begint met {prefix}")
    if len(treffers) > 1:
        sys.exit("meerdere treffers: " + ", ".join(t[:8] for t in treffers))
    tid = treffers[0]
    t = teams[tid]
    berichten = lees_feed(tid)
    if not berichten:
        sys.exit("deze sessie heeft geen agentberichten")

    per = Counter(b["van"] for b in berichten)
    print("=" * 78)
    print(f"  {(t.get('description') or 'zonder omschrijving')[:200]}")
    print("=" * 78)
    print(f"  sessie {tid}   {(t.get('createdAt') or '')[:16]}   {len(berichten)} berichten")
    print(f"  deelnemers: {', '.join(f'{a} ({n})' for a, n in per.most_common())}")
    if not heeft_samenvatting(tid):
        print("  LET OP: hier is destijds geen samenvatting van geschreven.")
    print()

    if volledig:
        for b in berichten:
            print("-" * 78)
            print(f"{b['van']}  {b['tijd'][11:19]}")
            print(b["tekst"])
        return

    # Zelfde aanpak als de service: per agent de langste bijdragen, want daar zit
    # de inhoud. Korte berichten zijn vrijwel altijd afstemming.
    for agent, n in per.most_common():
        eigen = sorted((b for b in berichten if b["van"] == agent), key=lambda b: -len(b["tekst"]))
        print(f"── {agent} ({n} berichten)")
        for b in eigen[:2]:
            tekst = re.sub(r"\n{3,}", "\n\n", b["tekst"])
            print(f"   {tekst[:1100]}")
            if len(b["tekst"]) > 1100:
                print("   [...]")
            print()


def main():
    p = argparse.ArgumentParser(add_help=False)
    p.add_argument("term", nargs="?")
    p.add_argument("--toon", metavar="ID")
    p.add_argument("--vol", action="store_true")
    p.add_argument("--zonder-samenvatting", action="store_true")
    p.add_argument("-n", type=int, default=25)
    p.add_argument("-h", "--help", action="store_true")
    a = p.parse_args()
    if a.help:
        print(__doc__)
        return
    teams = laad_teams()
    if a.toon:
        toon(teams, a.toon, a.vol)
    else:
        overzicht(teams, a.term, a.zonder_samenvatting, a.n)


if __name__ == "__main__":
    main()
