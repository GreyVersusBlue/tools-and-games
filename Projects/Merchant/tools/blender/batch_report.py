"""Write reports/batch-N.md from the final-render logs and the files in out/,
and fill render times into the per-picture reports.

    python scripts/batch_report.py 1        (plain Python 3, no Blender needed)
"""
import glob
import json
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

BATCHES = {
    "1": {
        "files": ["look-test.webp", "look-test-dusk.webp", "desk-day.webp", "map-cairo.webp",
                  "map-cairo-geo.json", "token-caravan.webp", "good-pepper.webp", "good-silk.webp"],
        "logs": {"A00": ["a00"], "A01": ["a01-day"], "A03": ["a03"], "A04": ["a04-caravan"],
                 "A15": ["a15-pepper", "a15-silk"]},
    },
    "2": {
        "files": ['desk-dusk.webp', 'desk-night.webp', 'token-caravan.webp', 'token-dhow.webp', 'token-galley.webp', 'token-nileboat.webp', 'token-mules.webp', 'good-pepper.webp', 'good-silk.webp', 'good-gold.webp', 'good-salt.webp', 'good-porcelain.webp', 'good-glass.webp', 'good-paper.webp', 'good-linen.webp', 'good-sugar.webp', 'good-incense.webp', 'good-copper.webp', 'good-wool.webp', 'letter-sealed.webp', 'letter-open.webp', 'sheet-blank.webp', 'contract.webp', 'ledger-open.webp', 'coins-few.webp', 'coins-some.webp', 'coins-many.webp', 'seal-1.webp', 'seal-2.webp', 'seal-3.webp', 'seal-4.webp', 'seal-5.webp', 'seal-6.webp', 'seal-7.webp', 'seal-8.webp'],
        "logs": {"A02": ["a01-dusk", "a01-night"], "A04": ['a04-caravan', 'a04-dhow', 'a04-galley', 'a04-nileboat', 'a04-mules'],
                 "A15": ['a15-pepper', 'a15-silk', 'a15-gold', 'a15-salt', 'a15-porcelain', 'a15-glass', 'a15-paper', 'a15-linen', 'a15-sugar', 'a15-incense', 'a15-copper', 'a15-wool'], "A16": ["a16-all"]},
    },
    "3": {
        "files": ["cairo-gate-dawn.webp", "alexandria-harbour.webp", "redsea-port.webp", "sahara-dunes.webp",
                  "mountain-pass.webp", "caravanserai-night.webp", "sahel-town.webp", "bazaar.webp",
                  "malabar-harbour.webp", "venice-quay.webp"],
        "logs": {"A05": ["a05"], "A06": ["a06-full"], "A07": ["a07"], "A08": ["a08"], "A09": ["a09"],
                 "A10": ["a10"], "A11": ["a11"], "A12": ["a12"], "A13": ["a13"], "A14": ["a14"]},
    },
    "4": {
        "files": ["storm-sea.webp", "sandstorm.webp", "toll-gate.webp", "procession.webp", "harbour-empty.webp",
                  "title.webp", "title-wide.webp"],
        "logs": {"A17": ["a17-all"], "A18": ["a18"]},
    },
}
LIMITS = {"title-wide": 250, **{k: 400 for k in ["storm-sea", "sandstorm", "toll-gate", "procession", "harbour-empty", "title"]}, **{k: 400 for k in ["cairo-gate-dawn", "alexandria-harbour", "redsea-port", "sahara-dunes", "mountain-pass", "caravanserai-night", "sahel-town", "bazaar", "malabar-harbour", "venice-quay"]}, **{'desk-dusk': 400, 'desk-night': 400, 'token-caravan': 60, 'token-dhow': 60, 'token-galley': 60, 'token-nileboat': 60, 'token-mules': 60, 'good-pepper': 120, 'good-silk': 120, 'good-gold': 120, 'good-salt': 120, 'good-porcelain': 120, 'good-glass': 120, 'good-paper': 120, 'good-linen': 120, 'good-sugar': 120, 'good-incense': 120, 'good-copper': 120, 'good-wool': 120, 'letter-sealed': 150, 'letter-open': 150, 'sheet-blank': 150, 'contract': 150, 'ledger-open': 150, 'coins-few': 150, 'coins-some': 150, 'coins-many': 150, 'seal-1': 150, 'seal-2': 150, 'seal-3': 150, 'seal-4': 150, 'seal-5': 150, 'seal-6': 150, 'seal-7': 150, 'seal-8': 150}, "look-test": 400, "look-test-dusk": 400, "desk-day": 400, "map-cairo": 400,
          "token-caravan": 60, "good-pepper": 120, "good-silk": 120}


def webp_size(path):
    with open(path, "rb") as f:
        d = f.read(40)
    if d[12:16] == b"VP8X":
        w = 1 + int.from_bytes(d[24:27], "little")
        h = 1 + int.from_bytes(d[27:30], "little")
        return w, h
    if d[12:16] == b"VP8 ":
        w, h = struct.unpack("<HH", d[26:30])
        return w & 0x3FFF, h & 0x3FFF
    if d[12:16] == b"VP8L":
        b = int.from_bytes(d[21:25], "little")
        return (b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1
    return None


def main():
    n = sys.argv[1] if len(sys.argv) > 1 else "1"
    B = BATCHES[n]
    logs = {}
    gpu, blender = set(), set()
    for p in glob.glob(os.path.join(ROOT, "masters", "logs", "*-final.json")):
        rec = json.load(open(p))
        logs[rec["script"]] = rec
        g = rec.get("gpu") or {}
        gpu.add("%s (%s)" % (", ".join(g.get("devices") or ["NONE: CPU"]), g.get("type")))
        blender.add(rec["blender"])
    rows = []
    for f in B["files"]:
        p = os.path.join(ROOT, "out", f)
        if not os.path.exists(p):
            rows.append("| %s | missing | | |" % f)
            continue
        size = os.path.getsize(p)
        dims = webp_size(p) if f.endswith(".webp") else None
        lim = LIMITS.get(f.rsplit(".", 1)[0])
        ok = "" if lim is None else ("yes" if size <= lim * 1024 else "**NO**")
        rows.append("| `%s` | %s | %s bytes | %s |" % (f, "%d x %d" % dims if dims else "JSON",
                                                       format(size, ","), ok + (" (limit %d KB)" % lim if lim else "")))
    for pid, keys in B["logs"].items():
        parts = []
        for k in keys:
            rec = logs.get(k)
            if not rec:
                continue
            for s in rec["saves"]:
                parts.append("%s: %.0f s" % (s["name"], s["seconds"]))
        rp = os.path.join(ROOT, "reports", pid + ".md")
        if os.path.exists(rp) and parts:
            t = open(rp, encoding="utf-8").read()
            t = t.replace("RENDER_TIME_" + pid, "Final render (512 samples, adaptive, OpenImageDenoise) on the GPU: "
                          + "; ".join(parts) + ".")
            open(rp, "w", encoding="utf-8").write(t)
    out = ["# Batch %s report" % n, "",
           "Blender: %s. GPU: %s." % (", ".join(sorted(blender)), ", ".join(sorted(gpu))), "",
           "| File | Pixels | Size | Within limit |", "|---|---|---|---|"] + rows
    path = os.path.join(ROOT, "reports", "batch-%s.md" % n)
    tail_path = os.path.join(ROOT, "reports", "batch-%s-notes.md" % n)
    if os.path.exists(tail_path):
        out += ["", open(tail_path, encoding="utf-8").read()]
    open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
    print("wrote", path)


main()
