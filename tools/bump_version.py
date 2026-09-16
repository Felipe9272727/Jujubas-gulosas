#!/usr/bin/env python3
"""
Sobe a versao do BP e do RP e mantem as dependencias cruzadas em sincronia.

POR QUE ISSO IMPORTA: o cliente do Minecraft guarda cada pack por
(uuid, versao). Se o conteudo muda mas a versao nao, quem ja tinha o pack
baixado continua usando a copia velha do cache - itens novos aparecem sem
textura pra ele. Todo release que mexe em textura, item ou script precisa de um
bump, senao so quem instala do zero ve a mudanca.

    python3 tools/bump_version.py minor    # 1.0.0 -> 1.1.0 (conteudo novo)
    python3 tools/bump_version.py patch    # 1.0.0 -> 1.0.1 (correcao)
    python3 tools/bump_version.py major    # 1.0.0 -> 2.0.0
    python3 tools/bump_version.py --show   # so mostra as versoes atuais
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKS = {"BP": ROOT / "BP" / "manifest.json", "RP": ROOT / "RP" / "manifest.json"}
PARTS = {"major": 0, "minor": 1, "patch": 2}


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def save(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def as_text(version: list[int]) -> str:
    return ".".join(str(n) for n in version)


def main() -> int:
    arg = sys.argv[1] if len(sys.argv) > 1 else "--show"
    manifests = {name: load(path) for name, path in PACKS.items()}

    if arg == "--show":
        for name, data in manifests.items():
            print(f"{name}: {as_text(data['header']['version'])}  ({data['header']['name']})")
        return 0

    if arg not in PARTS:
        print(f"parte invalida: {arg} (use major, minor, patch ou --show)")
        return 1

    index = PARTS[arg]
    uuid_to_version: dict[str, list[int]] = {}

    for name, data in manifests.items():
        version = list(data["header"]["version"])
        version[index] += 1
        for i in range(index + 1, 3):
            version[i] = 0

        old = data["header"]["version"]
        data["header"]["version"] = version
        # os modulos acompanham o header pra nao ficar um numero por pack
        for module in data.get("modules", []):
            module["version"] = list(version)

        uuid_to_version[data["header"]["uuid"]] = version
        print(f"{name}: {as_text(old)} -> {as_text(version)}")

    # dependencia cruzada precisa apontar pra versao nova do outro pack, senao o
    # jogo reclama de dependencia faltando
    for name, data in manifests.items():
        for dependency in data.get("dependencies", []):
            uuid = dependency.get("uuid")
            if uuid in uuid_to_version:
                dependency["version"] = list(uuid_to_version[uuid])
                print(f"{name}: dependencia {uuid[:8]}… -> {as_text(uuid_to_version[uuid])}")

    for name, path in PACKS.items():
        save(path, manifests[name])

    print("\nlembre o host de reimportar o .mcaddon e reativar o pack no mundo")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
