"""Descarga atletas del GoldenCheetah OpenData Project (OSF 6hfpz).

Cada atleta es un zip con un JSON de resumen (una entrada por sesion, con sus
metricas ya calculadas) y los CSV segundo a segundo de cada entreno. Para el
backtest solo hace falta el JSON, pero OSF sirve el zip entero.

Los zips NO van al repo: se guardan donde diga --out (por defecto, un directorio
temporal).

Uso:
    python scripts/backtest/gc_fetch.py --out /tmp/gc --athletes 25
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from pathlib import Path

OSF_NODE = "6hfpz"
LIST_URL = f"https://api.osf.io/v2/nodes/{OSF_NODE}/files/osfstorage/?page[size]=100"


def list_files(min_size: int, max_size: int, limit: int) -> list[tuple[str, str, int]]:
    """(nombre, url de descarga, bytes) de los zips dentro del rango de tamano.

    El tamano es el mejor proxy barato de "cuantas sesiones trae": los zips de
    pocos cientos de KB son atletas con un punado de entrenos.
    """
    out: list[tuple[str, str, int]] = []
    url: str | None = LIST_URL
    while url and len(out) < limit:
        with urllib.request.urlopen(url) as response:
            payload = json.load(response)
        for item in payload["data"]:
            attrs = item["attributes"]
            size = attrs.get("size") or 0
            if attrs.get("kind") != "file" or not attrs["name"].endswith(".zip"):
                continue
            if min_size <= size <= max_size:
                out.append((attrs["name"], item["links"]["download"], size))
                if len(out) >= limit:
                    break
        url = payload["links"].get("next")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--athletes", type=int, default=25)
    parser.add_argument("--min-mb", type=float, default=5.0)
    parser.add_argument("--max-mb", type=float, default=25.0)
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    files = list_files(int(args.min_mb * 1e6), int(args.max_mb * 1e6), args.athletes)
    print(f"candidatos: {len(files)}")

    for name, url, size in files:
        target = args.out / name
        if target.exists():
            print(f"ya estaba: {name}")
            continue
        print(f"bajando {name} ({size / 1e6:.1f} MB)")
        urllib.request.urlretrieve(url, target)

    print(f"listo en {args.out}")


if __name__ == "__main__":
    main()
