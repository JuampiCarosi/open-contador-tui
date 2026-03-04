#!/usr/bin/env python3
"""Descarga la coleccion publica de Postman y regenera endpoints.md.

Uso:
  python3 .agents/skills/sos-contador/tools/sync_postman_collection.py
"""

from __future__ import annotations

import json
import urllib.request
from collections import defaultdict
from pathlib import Path

COLLECTION_URL = (
    "https://documenter.gw.postman.com/api/collections/1566360/SWTD6vnC"
    "?environment=1566360-d786fc26-392b-4893-8d0b-264b20de265d"
    "&segregateAuth=true&versionTag=latest"
)

SKILL_ROOT = Path(__file__).resolve().parents[1]
REFERENCE_FILE = SKILL_ROOT / "references" / "endpoints.md"
RAW_FILE = SKILL_ROOT / "references" / "collection.raw.json"


def fetch_collection() -> dict:
    req = urllib.request.Request(
        COLLECTION_URL,
        headers={"User-Agent": "opencode-sos-contador-skill/1.0"},
    )
    with urllib.request.urlopen(req, timeout=30) as response:
        payload = response.read().decode("utf-8")
    return json.loads(payload)


def endpoint_url(url_value: object) -> str:
    if isinstance(url_value, dict):
        raw = url_value.get("raw")
        return raw or ""
    return str(url_value or "")


def iter_requests(items: list, top_group: str | None = None):
    for item in items:
        if "item" in item:
            group = top_group or item.get("name") or "misc"
            yield from iter_requests(item["item"], group)
        elif "request" in item:
            req = item["request"]
            yield {
                "group": top_group or "misc",
                "name": item.get("name") or "(sin nombre)",
                "method": req.get("method") or "GET",
                "url": endpoint_url(req.get("url")),
            }


def normalize_path(raw_url: str) -> str:
    marker = "/api-comunidad"
    if marker in raw_url:
        return raw_url.split(marker, 1)[1] or "/"
    return raw_url


def write_references(collection: dict) -> None:
    requests = list(iter_requests(collection.get("item", [])))
    grouped: dict[str, list[dict]] = defaultdict(list)
    for req in requests:
        grouped[req["group"]].append(req)

    lines: list[str] = []
    lines.append("# SOS Contador - Endpoints")
    lines.append("")
    lines.append(
        f"Fuente: coleccion Postman publica `{collection.get('info', {}).get('name', 'N/A')}` ({len(requests)} requests)."
    )
    lines.append("")

    for group in sorted(grouped.keys()):
        entries = grouped[group]
        lines.append(f"## {group} ({len(entries)})")
        for req in entries:
            lines.append(f"- `{req['method']} {normalize_path(req['url'])}`")
        lines.append("")

    REFERENCE_FILE.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def main() -> None:
    payload = fetch_collection()
    RAW_FILE.write_text(json.dumps(payload, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
    write_references(payload)
    print(f"OK: actualizado {REFERENCE_FILE}")
    print(f"OK: guardado raw en {RAW_FILE}")


if __name__ == "__main__":
    main()
