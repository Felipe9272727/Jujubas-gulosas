#!/usr/bin/env python3
"""
Gera as PNGs do resource pack a partir dos grids de caracteres em textures.py.

    python3 tools/gen_textures.py            # escreve as PNGs
    python3 tools/gen_textures.py --check    # so confere se batem com o disco

Pra criar a textura de um item novo: adicione uma entrada em TEXTURES com a
chave "items/<nome_do_arquivo>", uma paleta char -> (R, G, B, A) e um grid de
16 linhas de 16 caracteres ('.' = transparente). Depois rode esse script e
registre a textura no RP/textures/item_texture.json.
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from textures import ITEM_SCALE, PARTICLE_SCALE, TEXTURES  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RP_TEXTURES = ROOT / "RP" / "textures"


def render(spec: dict) -> Image.Image:
    grid = spec["grid"]
    palette = spec["palette"]

    height = len(grid)
    width = len(grid[0])
    if any(len(row) != width for row in grid):
        raise ValueError("todas as linhas do grid precisam ter o mesmo tamanho")

    img = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    px = img.load()
    for y, row in enumerate(grid):
        for x, char in enumerate(row):
            if char == ".":
                continue
            if char not in palette:
                raise ValueError(f"caractere '{char}' nao esta na paleta")
            px[x, y] = palette[char]
    return img


def scale_for(name: str) -> int:
    return PARTICLE_SCALE if name.startswith("particle/") else ITEM_SCALE


def main() -> int:
    check_only = "--check" in sys.argv
    written, mismatched, unchanged = [], [], []

    for name, spec in sorted(TEXTURES.items()):
        img = render(spec)
        scale = scale_for(name)
        upscaled = img.resize((img.width * scale, img.height * scale), Image.NEAREST)

        target = RP_TEXTURES / f"{name}.png"
        target.parent.mkdir(parents=True, exist_ok=True)

        if target.exists():
            existing = Image.open(target).convert("RGBA")
            if existing.size == upscaled.size and existing.tobytes() == upscaled.tobytes():
                unchanged.append(name)
                continue
            mismatched.append(name)

        if check_only:
            continue

        upscaled.save(target)
        written.append(name)

    print(f"\n\033[1mTexturas ({len(TEXTURES)} no total)\033[0m")
    print(f"\033[36m  i\033[0m {len(unchanged)} iguais ao que ja esta no disco")
    if written:
        print(f"\033[32m  ✔\033[0m {len(written)} escritas: {', '.join(written)}")
    if check_only and mismatched:
        print(f"\033[31m  ✘\033[0m {len(mismatched)} diferentes do disco: {', '.join(mismatched)}")
        print("\n  rode sem --check pra regravar")
        return 1
    if not written and not mismatched:
        print("\033[32m\n✔ tudo em dia\033[0m")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
