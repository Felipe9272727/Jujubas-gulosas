#!/usr/bin/env python3
"""
Gera as geometrias feitas por codigo:

    tools/hollow_model.py        -> RP/models/entity/hollow_ichigo.geo.json
    tools/aizen_clone_model.py   -> RP/models/entity/aizen_clone.geo.json
    tools/mugetsu_model.py       -> RP/models/entity/mugetsu.geo.json
    tools/komamura_model.py      -> RP/models/entity/komamura_*.geo.json (4)

    python3 tools/gen_model.py           # escreve os .geo.json
    python3 tools/gen_model.py --check   # so confere se batem com o disco

Os .geo.json nunca devem ser editados na mao: o UV deles e empacotado por
codigo, e mexer numa caixa sem repassar o packer sobrepoe UV de cubos
diferentes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import aizen_clone_model  # noqa: E402
import hollow_model  # noqa: E402
import komamura_model  # noqa: E402
import mugetsu_model  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "RP" / "models" / "entity"

TARGETS = {
    MODELS / "hollow_ichigo.geo.json": hollow_model.build_geometry,
    MODELS / "aizen_clone.geo.json": aizen_clone_model.build_geometry,
    MODELS / "mugetsu.geo.json": mugetsu_model.build_geometry,
    **{MODELS / f"{name}.geo.json": build for name, build in komamura_model.geometry_builders().items()},
}


def main() -> int:
    check_only = "--check" in sys.argv
    failed = False

    for target, build in TARGETS.items():
        geometry = build()
        content = json.dumps(geometry, indent=2, ensure_ascii=False) + "\n"
        current = target.read_text(encoding="utf-8") if target.exists() else None
        rel = target.relative_to(ROOT)

        if current == content:
            print(f"\033[32m✔ {rel} em dia\033[0m")
            continue

        if check_only:
            print(f"\033[31m✘ {rel} esta diferente do modelo\033[0m")
            failed = True
            continue

        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        cubes = sum(
            len(bone.get("cubes", []))
            for geo in geometry["minecraft:geometry"]
            for bone in geo["bones"]
        )
        print(f"\033[32m✔ {rel} escrita\033[0m ({cubes} caixas)")

    if failed:
        print("  rode: python3 tools/gen_model.py")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
