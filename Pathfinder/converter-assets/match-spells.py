"""
match-spells.py — shortlist PF2e candidates for every PF1e spell

Reads data/pf1-spells.json (from fetch-pf1-spells.py) and the Archive's
../data/spell.json, and writes a candidate file for hand curation:
for every PF1e spell, the six PF2e spells whose name and text look most alike,
with a score. The curated result is data/spell-map.json; this file only feeds
the people (or agents) writing it, and is not read by the page.

Usage:  python match-spells.py [out.json]
        (default out: a candidates file in the system temp folder)
"""

import json
import math
import re
import sys
import tempfile
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
PF1 = HERE / "data" / "pf1-spells.json"
PF2 = HERE.parent / "data" / "spell.json"
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.gettempdir()) / "pf1-pf2-candidates.json"

STOP = set("""a an the of to and or in on for with by is are be as at it its this that
you your each any all can if not no from into than then their them they one two
creature creatures target targets spell spells level round rounds minute minutes
hour hours day days feet foot ft save saving throw dc per caster check bonus
penalty may must also has have would will which who when while within up
other such only more less additional additionally""".split())

def words(text):
    return [w for w in re.findall(r"[a-z]+", (text or "").lower()) if len(w) > 2 and w not in STOP]

def norm_name(n):
    n = n.lower()
    n = re.sub(r",\s*(greater|lesser|mass|communal|improved)$", r" \1", n)
    n = re.sub(r"\(.*?\)", "", n)
    return re.sub(r"[^a-z ]", "", n).strip()

def strip_html(s):
    return re.sub(r"<[^>]+>", " ", s or "")

def main():
    pf1 = json.loads(PF1.read_text(encoding="utf-8"))
    pf2_all = json.loads(PF2.read_text(encoding="utf-8"))
    pf2 = [s for s in pf2_all if "focus" not in s["system"]["traits"]["value"]]

    docs2 = []
    for s in pf2:
        sy = s["system"]
        text = strip_html(sy["description"]["value"])
        docs2.append({
            "name": s["name"],
            "rank": sy["level"]["value"],
            "cantrip": "cantrip" in sy["traits"]["value"],
            "traits": sy["traits"]["value"],
            "traditions": sy["traits"].get("traditions", []),
            "remaster": sy["publication"].get("remaster", False),
            "norm": norm_name(s["name"]),
            "tf": Counter(words(s["name"]) * 4 + words(text)),
        })

    df = Counter()
    for d in docs2:
        df.update(set(d["tf"]))
    n = len(docs2)
    idf = lambda w: math.log((n + 1) / (df.get(w, 0) + 1)) + 1

    def vec(tf):
        v = {w: c * idf(w) for w, c in tf.items()}
        norm = math.sqrt(sum(x * x for x in v.values())) or 1
        return {w: x / norm for w, x in v.items()}

    for d in docs2:
        d["vec"] = vec(d["tf"])

    out = []
    for s in pf1:
        tf = Counter(words(s["name"]) * 4 + words(s.get("description", ""))
                     + words(" ".join(s.get("descriptors") or [])) * 2)
        v = vec(tf)
        nn = norm_name(s["name"])
        scored = []
        for d in docs2:
            sc = sum(x * d["vec"].get(w, 0) for w, x in v.items())
            if d["norm"] == nn:
                sc += 1.0
            elif nn and (nn in d["norm"] or d["norm"] in nn):
                sc += 0.3
            if d["remaster"]:
                sc += 0.02
            scored.append((sc, d))
        scored.sort(key=lambda t: -t[0])
        out.append({
            "pf1": s["name"],
            "level": s.get("level"),
            "school": s.get("school"),
            "descriptors": s.get("descriptors"),
            "summary": (s.get("description") or "")[:300],
            "candidates": [
                {"name": d["name"], "rank": 0 if d["cantrip"] else d["rank"],
                 "remaster": d["remaster"], "score": round(sc, 3)}
                for sc, d in scored[:6]
            ],
        })
    OUT.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"{len(out)} PF1e spells shortlisted against {n} PF2e spells -> {OUT}")

if __name__ == "__main__":
    main()
