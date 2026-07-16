"""
build_packs.py — consolidate ALL pf2e pack folders into one JSON file per document type

Walks every folder under packs/pf2e in the Foundry pf2e repo, reads every
document, groups by its `type` field (spell, feat, npc, equipment, ...),
strips non-display data, and writes one consolidated file per type
(spell.json, feat.json, npc.json, ...) plus a manifest.json summarizing
what was built.

Usage:  python build_packs.py
Re-run any time you pull a fresh copy of the pf2e repo.
"""

import json
from collections import defaultdict
from pathlib import Path

# ---------------------------------------------------------------- paths
SOURCE = Path(r"C:\Users\devon\OneDrive\Documents\GitHub\pf2e\packs\pf2e")
DEST   = Path(r"C:\Users\devon\OneDrive\Documents\GitHub\tools-and-games\Pathfinder\data")

# Document types to skip entirely (Foundry plumbing, not reference content)
SKIP_TYPES = {"script", "effect", "character"}
# effect  = Foundry automation effect icons
# script  = macros
# character = pregen PC sheets (flip to keep if you ever want pregens)

# Top-level keys to keep on every document
KEEP_TOP = {"_id", "name", "type"}

# system.* keys to drop everywhere — automation/bookkeeping, not display data
DROP_SYSTEM = {"rules", "slug", "_migration", "schema"}

# Keys to drop from embedded items (NPC attacks/spells) — these embed a LOT
DROP_EMBEDDED = {"img", "folder", "sort", "flags", "_stats", "ownership",
                 "effects"}


def clean_system(system: dict) -> dict:
    return {k: v for k, v in system.items() if k not in DROP_SYSTEM}


def clean_embedded_item(item: dict) -> dict:
    """Lighter cleaning for items embedded inside actors (NPC attacks etc.)."""
    out = {k: v for k, v in item.items() if k not in DROP_EMBEDDED}
    if isinstance(out.get("system"), dict):
        out["system"] = clean_system(out["system"])
    return out


def clean_entry(raw: dict, source_pack: str) -> dict:
    entry = {k: raw[k] for k in KEEP_TOP if k in raw}
    entry["sourcePack"] = source_pack          # which of the 97 folders it came from

    if isinstance(raw.get("system"), dict):
        entry["system"] = clean_system(raw["system"])
        # level lives at system.level.value for items, system.details.level.value for actors
        level = entry["system"].get("level")
        if not isinstance(level, dict):
            level = entry["system"].get("details", {}).get("level") \
                if isinstance(entry["system"].get("details"), dict) else None
        if isinstance(level, dict) and "value" in level:
            entry["level"] = level["value"]    # top-level copy for fast filtering

    # Actors (npc, hazard, vehicle, ...) embed their items; keep them but slim
    if isinstance(raw.get("items"), list):
        entry["items"] = [clean_embedded_item(i) for i in raw["items"]
                          if isinstance(i, dict)]

    return entry


def write_npc_shards(entries: list, manifest: dict) -> float:
    """Write NPCs into DEST/npcs/, one file per creature level.

    The npcs folder is emptied first so removed/renamed shards from a
    previous run never linger.
    """
    npc_dir = DEST / "npcs"
    npc_dir.mkdir(parents=True, exist_ok=True)
    for old in npc_dir.glob("*.json"):
        old.unlink()

    by_level = defaultdict(list)
    for e in entries:
        by_level[e.get("level", 0)].append(e)

    shards = {}
    total_mb = 0.0
    for level in sorted(by_level):
        # levels run -1 .. 25+; keep filenames filesystem-friendly
        label = f"minus{abs(level)}" if level < 0 else str(level)
        out_path = npc_dir / f"npc-level-{label}.json"
        out_path.write_text(json.dumps(by_level[level], ensure_ascii=False,
                                       separators=(",", ":")),
                            encoding="utf-8")
        size_mb = out_path.stat().st_size / 1_048_576
        total_mb += size_mb
        shards[str(level)] = {"count": len(by_level[level]),
                              "file": f"npcs/{out_path.name}",
                              "sizeMB": round(size_mb, 2)}
    manifest["npc"] = {"count": len(entries),
                       "sharded": True,
                       "shards": shards,
                       "sizeMB": round(total_mb, 2)}
    print(f"  {'npc':16} {len(entries):6}  {total_mb:7.2f} MB  "
          f"({len(shards)} level shards in npcs/)")
    return total_mb


def main() -> None:
    if not SOURCE.is_dir():
        raise SystemExit(f"Source folder not found: {SOURCE}")
    DEST.mkdir(parents=True, exist_ok=True)

    groups: dict[str, list] = defaultdict(list)
    skipped_types = defaultdict(int)
    unreadable = []

    for path in sorted(SOURCE.rglob("*.json")):
        # top-level pack folder name, e.g. "spells", "pathfinder-bestiary"
        source_pack = path.relative_to(SOURCE).parts[0]
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            unreadable.append((str(path), str(e)))
            continue

        if not isinstance(raw, dict):
            continue                      # _folders.json metadata files
        doc_type = raw.get("type")
        if doc_type is None:
            skipped_types["journal/other"] += 1
            continue
        if doc_type in SKIP_TYPES:
            skipped_types[doc_type] += 1
            continue

        groups[doc_type].append(clean_entry(raw, source_pack))

    manifest = {}
    total_mb = 0.0
    for doc_type, entries in sorted(groups.items()):
        entries.sort(key=lambda e: (e.get("level") or 0, e.get("name", "")))

        if doc_type == "npc":
            total_mb += write_npc_shards(entries, manifest)
            continue

        out_path = DEST / f"{doc_type}.json"
        out_path.write_text(json.dumps(entries, ensure_ascii=False,
                                       separators=(",", ":")),
                            encoding="utf-8")
        size_mb = out_path.stat().st_size / 1_048_576
        total_mb += size_mb
        manifest[doc_type] = {"count": len(entries),
                              "file": out_path.name,
                              "sizeMB": round(size_mb, 2)}
        print(f"  {doc_type:16} {len(entries):6}  {size_mb:7.2f} MB")

    (DEST / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8")

    print(f"\nTotal: {sum(m['count'] for m in manifest.values())} entries, "
          f"{total_mb:.1f} MB across {len(manifest)} files -> {DEST}")
    if skipped_types:
        print("Skipped:", dict(skipped_types))
    if unreadable:
        print(f"Unreadable files: {len(unreadable)}")
        for name, err in unreadable[:10]:
            print(f"  {name}: {err}")


if __name__ == "__main__":
    main()