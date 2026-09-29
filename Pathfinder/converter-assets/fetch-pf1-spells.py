"""
fetch-pf1-spells.py — build a PF1e spell dataset from Archives of Nethys

Fetches the full PF1e spell index from aonprd.com (the 1e site, NOT
2e.aonprd.com), then fetches every SpellDisplay.aspx page it links to and
parses each spell into a flat record: name, source, school, subschool,
descriptors, per-class levels, the standard casting/effect/duration block,
a plain-text description, and (when present) mythic text.

Network etiquette: at most 4 concurrent requests, a per-request delay, a
descriptive User-Agent, retries with backoff, and a local disk cache keyed
by URL so a re-run only fetches pages it doesn't already have. The cache
defaults to a tmp directory (see CACHE_DIR below) — it is scratch space,
not repo content, and is never written under Pathfinder/.

Writes Pathfinder/converter-assets/data/pf1-spells.json: a JSON array
sorted by name, one compact object per line.

Usage:  python fetch-pf1-spells.py
        (set PF1_CACHE_DIR to reuse a specific cache directory across runs;
        set PF1_SPELL_LIMIT=50 to do a quick smoke run against the first
        50 spells instead of the full ~3,000)
Re-run any time; only new/changed pages are fetched from the network again
if the cache from a previous run is kept around.
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

# ---------------------------------------------------------------- paths
HERE = Path(__file__).resolve().parent
DEST = HERE / "data"
OUT_FILE = DEST / "pf1-spells.json"

CACHE_DIR = Path(os.environ.get("PF1_CACHE_DIR",
                                Path(tempfile.gettempdir()) / "pf1-spell-fetch-cache"))

BASE = "https://aonprd.com/"
INDEX_URL = BASE + "Spells.aspx?Class=All"

USER_AGENT = ("pf1-spell-dataset-builder/1.0 "
             "(one-off script for a PF1e->PF2e conversion tool; "
             "contact: devons.moore@gmail.com)")

MAX_WORKERS = 4
REQUEST_DELAY = 0.3          # politeness delay after every request, seconds
MAX_RETRIES = 3
RETRY_BACKOFF = 1.5          # seconds, doubles each retry

SPELL_LIMIT = int(os.environ.get("PF1_SPELL_LIMIT", "0")) or None

# Classes whose spell lists are worth normalizing "x/y"-style combined
# names into (defensive: this AoN site lists classes separately, but a
# combined token like "sorcerer/wizard" is handled if one ever shows up).


# ---------------------------------------------------------------- fetching
FIELD_ORDER = ["name", "level", "school", "subschool", "descriptors", "levels",
               "castingTime", "components", "range", "area", "target", "effect",
               "duration", "save", "sr", "source", "description", "mythic"]


def _cache_path(url: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9]+", "_", url)[-180:]
    return CACHE_DIR / f"{safe}.html"


def fetch(url: str) -> str:
    """Fetch a URL with retries/backoff, through a local disk cache."""
    cache_file = _cache_path(url)
    if cache_file.exists():
        return cache_file.read_text(encoding="utf-8", errors="ignore")

    last_err = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=25) as resp:
                data = resp.read().decode("utf-8", errors="ignore")
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(data, encoding="utf-8")
            time.sleep(REQUEST_DELAY)
            return data
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
            last_err = e
            time.sleep(RETRY_BACKOFF * attempt)
    raise RuntimeError(f"failed to fetch {url}: {last_err}")


# ---------------------------------------------------------------- index parsing
def get_spell_index() -> list[str]:
    """Return the sorted, de-duplicated list of exact spell names on the
    All Spells index page (the ItemName value used by SpellDisplay.aspx)."""
    html_text = fetch(INDEX_URL)
    names = re.findall(r'SpellDisplay\.aspx\?ItemName=([^"]+)"', html_text)
    names = sorted({html.unescape(n).strip() for n in names})
    return names


# ---------------------------------------------------------------- HTML -> text helpers
TAG_RE = re.compile(r"<[^>]+>")
BR_RE = re.compile(r"<br\s*/?>", re.I)
H3_FRAMING_RE = re.compile(r'<h3 class="framing">.*?</h3>', re.I | re.S)
TABLE_RE = re.compile(r"<table\b.*?</table>", re.I | re.S)
ROW_RE = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.I | re.S)
CELL_RE = re.compile(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", re.I | re.S)


def strip_tags(fragment: str) -> str:
    """Strip tags, unescape entities, normalize br->newline, collapse space."""
    fragment = BR_RE.sub("\n", fragment)
    fragment = TAG_RE.sub("", fragment)
    fragment = html.unescape(fragment)
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in fragment.split("\n")]
    return "\n".join(lines).strip()


def flatten_table(table_html: str) -> str:
    """Turn one <table> into plain text: cells joined by ' | ', rows by newline."""
    rows_out = []
    for row_html in ROW_RE.findall(table_html):
        cells = [strip_tags(c).replace("\n", " ").strip()
                for c in CELL_RE.findall(row_html)]
        cells = [c for c in cells if c != ""]
        if cells:
            rows_out.append(" | ".join(cells))
    return "\n".join(rows_out)


def html_to_text(fragment: str) -> str:
    """Convert a spell-description HTML fragment to plain text, with any
    tables flattened into pipe-joined rows, paragraphs separated by a
    blank line."""
    tables = TABLE_RE.findall(fragment)
    placeholders = {}
    for i, t in enumerate(tables):
        key = f"\x00TABLE{i}\x00"
        placeholders[key] = flatten_table(t)
        fragment = fragment.replace(t, key, 1)

    text = strip_tags(fragment)
    # collapse the br-derived single newlines that were meant as paragraph
    # breaks (the site uses <br /><br />) into a blank line, but leave
    # single newlines (e.g. inside a restored table placeholder) alone.
    text = re.sub(r"\n{2,}", "\n\n", text)

    for key, rendered in placeholders.items():
        text = text.replace(key, f"\n{rendered}\n")

    # tidy up stray blank-line runs left after substitution
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text


# ---------------------------------------------------------------- field parsing
FIELD_RE = re.compile(r"<b>([^<]+?)</b>\s*(.*?)(?=<b>|$)", re.S)

FIELD_KEY_MAP = {
    "source": "source",
    "school": None,          # handled specially
    "level": None,            # handled specially
    "casting time": "castingTime",
    "components": "components",
    "range": "range",
    "area": "area",
    "target": "target",
    "targets": "target",
    "effect": "effect",
    "duration": "duration",
    "saving throw": "save",
    "spell resistance": "sr",
}


def parse_school(raw_value: str) -> tuple[str, str | None, list[str]]:
    """raw_value is the tag-stripped text after '<b>School</b>', something
    like 'evocation [fire]' or 'illusion (figment) [mind-affecting]'."""
    text = strip_tags(raw_value)
    text = text.rstrip(";").strip()
    subschool = None
    descriptors: list[str] = []

    m = re.search(r"\(([^)]+)\)", text)
    if m:
        subschool = m.group(1).strip()
        text = text[:m.start()] + text[m.end():]

    m = re.search(r"\[([^\]]+)\]", text)
    if m:
        descriptors = [d.strip() for d in m.group(1).split(",") if d.strip()]
        text = text[:m.start()] + text[m.end():]

    school = text.strip().strip(";").strip()
    return school, subschool, descriptors


def parse_levels(raw_value: str) -> dict[str, int]:
    text = strip_tags(raw_value).rstrip(";").strip()
    levels: dict[str, int] = {}
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        m = re.match(r"(.+?)\s+(-?\d+)$", part)
        if not m:
            continue
        cls_raw, lvl = m.group(1).strip().lower(), int(m.group(2))
        # normalize combined "x/y" class names (defensive; not seen on this
        # site in practice, but the source data has done this historically)
        for cls in cls_raw.split("/"):
            cls = cls.strip()
            if cls:
                levels[cls] = lvl
    return levels


def parse_spell_block(block_html: str, log: list[str]) -> dict | None:
    """block_html runs from just after an <h1 class="title"> spell name
    (exclusive) to just before the next <h1 class="title"> or end of the
    containing span. Returns a spell dict, or None if unparseable."""
    desc_split = re.split(r'<h3 class="framing">Description</h3>', block_html, maxsplit=1)
    if len(desc_split) != 2:
        log.append("no Description section found")
        return None
    header_html, rest_html = desc_split

    # split off any h2 "variant" sections (Mythic X, X on Golarion, errata...)
    h2_parts = re.split(r'<h2 class="title">(.*?)</h2>', rest_html)
    description_html = h2_parts[0]
    mythic_chunks = []
    extra_chunks = []
    for i in range(1, len(h2_parts), 2):
        heading = strip_tags(h2_parts[i])
        body = h2_parts[i + 1] if i + 1 < len(h2_parts) else ""
        body_text = html_to_text(body)
        if heading.lower().startswith("mythic"):
            mythic_chunks.append(f"{heading}\n{body_text}" if body_text else heading)
        else:
            extra_chunks.append(f"{heading}\n{body_text}" if body_text else heading)

    description = html_to_text(description_html)
    if extra_chunks:
        description = (description + "\n\n" + "\n\n".join(extra_chunks)).strip()
    mythic = "\n\n".join(mythic_chunks) if mythic_chunks else None

    header_clean = H3_FRAMING_RE.sub("", header_html)
    fields = FIELD_RE.findall(header_clean)

    spell: dict = {}
    levels: dict[str, int] = {}
    for label, raw_value in fields:
        label_key = label.strip().lower()
        if label_key == "school":
            school, subschool, descriptors = parse_school(raw_value)
            spell["school"] = school
            spell["subschool"] = subschool
            spell["descriptors"] = descriptors
        elif label_key == "level":
            levels = parse_levels(raw_value)
        else:
            mapped = FIELD_KEY_MAP.get(label_key)
            if mapped:
                value = strip_tags(raw_value).rstrip(";").strip()
                spell[mapped] = value if value else None

    if not levels:
        log.append("no Level field parsed")
        return None

    spell["levels"] = levels
    spell["level"] = min(levels.values())
    spell["description"] = description
    if mythic:
        spell["mythic"] = mythic

    spell.setdefault("school", None)
    spell.setdefault("subschool", None)
    spell.setdefault("descriptors", [])
    for key in ("castingTime", "components", "range", "area", "target",
               "effect", "duration", "save", "sr", "source"):
        spell.setdefault(key, None)

    return spell


NAME_H1_RE = re.compile(
    r'<h1 class="title">(?:<img[^>]*>\s*)?(.*?)</h1>(.*?)(?=<h1 class="title">|$)',
    re.S,
)


def parse_page(page_html: str, want_name: str, log: list[str]) -> dict | None:
    """A SpellDisplay.aspx page can hold more than one <h1>-titled spell
    (aonprd's ItemName lookup is a partial match, e.g. ItemName=Fireball
    also returns "Controlled Fireball"). Pick the block whose title is an
    exact (case-insensitive) match for the spell we actually asked for."""
    span_matches = re.findall(
        r'<span id="MainContent_DataListTypes_LabelName_\d+">(.*?)</span>\s*</td>',
        page_html, re.S)
    content = "".join(s for s in span_matches if s.strip())
    if not content:
        log.append(f"{want_name}: empty result page")
        return None

    want_norm = want_name.strip().lower()
    candidates = []
    for m in NAME_H1_RE.finditer(content):
        title = strip_tags(m.group(1)).strip()
        candidates.append((title, m.group(2)))

    for title, body in candidates:
        if title.lower() == want_norm:
            spell = parse_spell_block(body, log)
            if spell is not None:
                spell["name"] = title
                return spell
            log.append(f"{want_name}: matched block but failed to parse")
            return None

    if len(candidates) == 1:
        # single block, name spelled slightly differently than the index
        # linked it (rare punctuation drift) -- take it anyway.
        title, body = candidates[0]
        spell = parse_spell_block(body, log)
        if spell is not None:
            spell["name"] = title
            return spell

    log.append(f"{want_name}: no exact title match among {[c[0] for c in candidates]}")
    return None


# ---------------------------------------------------------------- driver
def fetch_and_parse(name: str, log: list[str]) -> dict | None:
    url = BASE + "SpellDisplay.aspx?ItemName=" + urllib.parse.quote(name)
    try:
        page_html = fetch(url)
    except RuntimeError as e:
        log.append(str(e))
        return None
    return parse_page(page_html, name, log)


def main() -> None:
    print(f"Cache dir: {CACHE_DIR}")
    print("Fetching spell index...")
    names = get_spell_index()
    if SPELL_LIMIT:
        names = names[:SPELL_LIMIT]
    print(f"Found {len(names)} spell names on the index page.")

    spells: list[dict] = []
    failures: list[str] = []
    log: list[str] = []
    log_lock_list = log  # single-threaded appends only inside worker via GIL-safe list.append

    done = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as pool:
        futures = {pool.submit(fetch_and_parse, name, log_lock_list): name for name in names}
        for fut in as_completed(futures):
            name = futures[fut]
            done += 1
            try:
                spell = fut.result()
            except Exception as e:
                log.append(f"{name}: unhandled exception: {e}")
                spell = None
            if spell is None:
                failures.append(name)
            else:
                spells.append(spell)
            if done % 200 == 0 or done == len(names):
                print(f"  {done}/{len(names)} fetched ({len(failures)} failures so far)")

    # Name first and empty fields dropped, so each line reads as its spell.
    spells = [
        {**{k: s[k] for k in FIELD_ORDER if s.get(k) not in (None, "", [])},
         **{k: v for k, v in s.items() if k not in FIELD_ORDER}}
        for s in spells
    ]
    spells.sort(key=lambda s: s["name"].lower())

    DEST.mkdir(parents=True, exist_ok=True)
    with OUT_FILE.open("w", encoding="utf-8") as f:
        f.write("[\n")
        for i, s in enumerate(spells):
            line = json.dumps(s, ensure_ascii=False, separators=(",", ":"))
            f.write(line + (",\n" if i < len(spells) - 1 else "\n"))
        f.write("]\n")

    size_mb = OUT_FILE.stat().st_size / 1_048_576
    by_school = Counter(s.get("school") or "(none)" for s in spells)

    print(f"\nWrote {len(spells)} spells to {OUT_FILE} ({size_mb:.2f} MB)")
    print("By school:")
    for school, count in sorted(by_school.items(), key=lambda kv: (-kv[1], kv[0])):
        print(f"  {school:20} {count}")

    if failures:
        print(f"\n{len(failures)} spells failed to parse:")
        for name in failures[:50]:
            print(f"  {name}")
        if len(failures) > 50:
            print(f"  ... and {len(failures) - 50} more")

    if log:
        log_path = CACHE_DIR / "pf1-spells-fetch.log"
        log_path.write_text("\n".join(log), encoding="utf-8")
        print(f"\n{len(log)} parse notes logged to {log_path}")


if __name__ == "__main__":
    main()
