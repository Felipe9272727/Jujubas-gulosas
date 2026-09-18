#!/usr/bin/env python3
"""
Gera a geometria do attachable a partir de tools/hollow_model.py.

    python3 tools/gen_model.py           # escreve o .geo.json
    python3 tools/gen_model.py --check   # so confere se bate com o disco

O .geo.json nunca deve ser editado na mao: o UV dele e empacotado por codigo, e
mexer numa caixa sem repassar o packer sobrepoe UV de cubos diferentes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from hollow_model import build_geometry  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
TARGET = ROOT / "RP" / "models" / "entity" / "hollow_ichigo.geo.json"


def main() -> int:
    check_only = "--check" in sys.argv
    content = json.dumps(build_geometry(), indent=2, ensure_ascii=False) + "\n"

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else None

    if current == content:
        print("\033[32m✔ geometria em dia\033[0m")
        return 0

    if check_only:
        print("\033[31m✘ RP/models/entity/hollow_ichigo.geo.json esta diferente do modelo\033[0m")
        print("  rode: python3 tools/gen_model.py")
        return 1

    TARGET.write_text(content, encoding="utf-8")
    cubes = sum(len(b.get("cubes", [])) for b in build_geometry()["minecraft:geometry"][0]["bones"])
    print(f"\033[32m✔ geometria escrita\033[0m ({cubes} caixas)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
