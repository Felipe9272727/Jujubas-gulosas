#!/usr/bin/env python3
"""
Empacota BP + RP em BleachBattlegrounds.mcaddon.

Por padrao roda o pipeline inteiro antes de empacotar e se recusa a gerar o
arquivo se alguma etapa falhar:

    1. tools/validate.py          - JSON, itens, texturas, manifests
    2. node --check               - sintaxe do main.js
    3. tools/gen_textures.py      - texturas batem com os grids de origem
    4. sim/run.mjs                - simulacao completa fora do jogo

    python3 tools/build.py                 # valida e empacota em dist/
    python3 tools/build.py --out /caminho  # escolhe onde salvar
    python3 tools/build.py --skip-checks   # so empacota (use com cuidado)
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ADDON_NAME = "BleachBattlegrounds.mcaddon"

EXCLUDE_DIRS = {".git", "__pycache__", "node_modules", "dist"}
EXCLUDE_SUFFIXES = {".pyc"}

STEPS = [
    ("validacao estatica", [sys.executable, "tools/validate.py"]),
    ("sintaxe do main.js", ["node", "--check", "BP/scripts/main.js"]),
    ("texturas x grids", [sys.executable, "tools/gen_textures.py", "--check"]),
    ("geometria x modelo", [sys.executable, "tools/gen_model.py", "--check"]),
    ("simulacao no Node", ["node", "--import", "./sim/register.mjs", "sim/run.mjs"]),
]


def run_checks() -> bool:
    ok = True
    for label, command in STEPS:
        print(f"\n\033[1m── {label}\033[0m")
        result = subprocess.run(command, cwd=ROOT)
        if result.returncode != 0:
            print(f"\033[31m  ✘ {label} falhou (exit {result.returncode})\033[0m")
            ok = False
    return ok


def pack(out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    target = out_dir / ADDON_NAME
    if target.exists():
        target.unlink()

    files: list[tuple[Path, str]] = []
    for pack_dir in ("BP", "RP"):
        base = ROOT / pack_dir
        for path in sorted(base.rglob("*")):
            if not path.is_file():
                continue
            if any(part in EXCLUDE_DIRS for part in path.parts):
                continue
            if path.suffix in EXCLUDE_SUFFIXES:
                continue
            files.append((path, str(path.relative_to(ROOT))))

    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for path, arcname in files:
            zf.write(path, arcname)

    size_kb = target.stat().st_size / 1024
    version = json.loads((ROOT / "RP" / "manifest.json").read_text(encoding="utf-8"))
    version_text = ".".join(str(n) for n in version["header"]["version"])

    print(f"\n\033[32m✔ {target}\033[0m")
    print(f"  {len(files)} arquivos, {size_kb:.1f} KB, packs na versao {version_text}")
    print(
        "  \033[33mse mudou textura/item/script desde o ultimo release, rode\033[0m\n"
        "  \033[33m  python3 tools/bump_version.py minor\033[0m\n"
        "  \033[33melse quem ja tem o pack baixado continua vendo a versao velha\033[0m"
    )
    return target


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default=str(ROOT / "dist"), help="pasta de saida")
    parser.add_argument("--skip-checks", action="store_true")
    args = parser.parse_args()

    if not args.skip_checks and not run_checks():
        print("\n\033[31mbuild abortado: corrija as falhas acima\033[0m")
        return 1

    pack(Path(args.out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
