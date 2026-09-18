"""Cosecha logs reales de gimnasio publicados en GitHub.

No existe (a 2026-09) un dataset publico grande de entrenamientos de fuerza
sesion a sesion. Lo que si hay son exports personales de Strong y FitNotes que
sus duenos subieron a repositorios publicos. Este script los busca por la
cabecera exacta de cada formato, se baja los CSV y descarta los que sean
plantillas de prueba o historiales demasiado cortos.

Los CSV **no** se guardan en el repo: son datos de terceros. Se bajan a donde
diga --out y se usan ahi.

Requiere `gh` autenticado (la busqueda de codigo de GitHub necesita token).

Uso:
    python scripts/backtest/gym_fetch.py --out /tmp/gymlogs --per-query 60
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import subprocess
import urllib.parse
import urllib.request
from pathlib import Path

# Cabeceras exactas de cada exportador.
QUERIES = [
    ('"Date,Exercise,Category,Weight (kgs),Reps" extension:csv', "fitnotes"),
    ('"Date,Exercise,Category,Weight (lbs),Reps" extension:csv', "fitnotes"),
    ('"Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps" extension:csv', "strong"),
    ('"Date;Workout Name;Duration;Exercise Name;Set Order;Weight;Reps" extension:csv', "strong"),
]

MIN_SESSION_DAYS = 40  # por debajo de esto no da para un backtest


def gh_json(args: list[str]) -> dict:
    out = subprocess.run(["gh", *args], capture_output=True, text=True, check=False)
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip()[:400])
    return json.loads(out.stdout)


def search(query: str, per_page: int) -> list[tuple[str, str]]:
    """(repo, path) de los CSV que casan con la cabecera."""
    found: list[tuple[str, str]] = []
    page = 1
    while len(found) < per_page:
        payload = gh_json(
            [
                "api",
                "-X",
                "GET",
                "search/code",
                "-f",
                f"q={query}",
                "-f",
                "per_page=100",
                "-f",
                f"page={page}",
            ]
        )
        items = payload.get("items", [])
        if not items:
            break
        for item in items:
            found.append((item["repository"]["full_name"], item["path"]))
            if len(found) >= per_page:
                break
        page += 1
        if page > 3:  # la busqueda de codigo tampoco pagina indefinidamente
            break
    return found


def download(repo: str, path: str) -> bytes | None:
    try:
        meta = gh_json(["api", f"repos/{repo}/contents/{urllib.parse.quote(path)}"])
    except RuntimeError:
        return None
    url = meta.get("download_url")
    if not url:
        return None
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            return response.read()
    except Exception:
        return None


def session_days(raw: bytes) -> int:
    """Dias distintos con registros: es el tamano real del historial."""
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        return 0
    sample = text[:4096]
    delimiter = ";" if sample.count(";") > sample.count(",") else ","
    reader = csv.DictReader(io.StringIO(text), delimiter=delimiter)
    days = set()
    for row in reader:
        value = row.get("Date") or row.get("date")
        if value:
            days.add(value[:10])
    return len(days)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--per-query", type=int, default=60)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    seen_hashes: set[str] = set()
    kept = 0
    index: list[dict] = []

    for query, flavor in QUERIES:
        try:
            hits = search(query, args.per_query)
        except RuntimeError as err:
            print(f"busqueda fallida ({flavor}): {err}")
            continue
        print(f"{flavor}: {len(hits)} candidatos")

        for repo, path in hits:
            raw = download(repo, path)
            if not raw:
                continue
            digest = hashlib.sha256(raw).hexdigest()[:16]
            if digest in seen_hashes:
                continue
            seen_hashes.add(digest)

            days = session_days(raw)
            if days < MIN_SESSION_DAYS:
                continue

            name = f"{flavor}_{digest}.csv"
            (args.out / name).write_bytes(raw)
            index.append({"file": name, "flavor": flavor, "repo": repo, "path": path, "days": days})
            kept += 1
            print(f"  guardado {name}  dias={days}  ({repo}/{path})")

    (args.out / "index.json").write_text(
        json.dumps(index, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    print(f"logs utiles: {kept} en {args.out}")


if __name__ == "__main__":
    main()
