#!/usr/bin/env python3
"""
Validacao estatica do addon Combates Multiversais.

Checa o que o simulador nao ve: JSON malformado, item sem textura,
textura sem arquivo, item citado no main.js sem definicao no BP,
manifests inconsistentes.

    python3 tools/validate.py
"""
from __future__ import annotations

import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BP = ROOT / "BP"
RP = ROOT / "RP"

problems: list[str] = []
notes: list[str] = []


def fail(msg: str) -> None:
    problems.append(msg)


def load_json(path: Path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        fail(f"JSON invalido em {path.relative_to(ROOT)}: {exc}")
        return None


def png_size(path: Path) -> tuple[int, int] | None:
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    width, height = struct.unpack(">II", data[16:24])
    return width, height


# as texturas sao desenhadas num grid 16x16 e salvas com upscale nearest 4x
ITEM_GRID = 16
ITEM_TEXTURE_PX = 64


# ---------------------------------------------------------------- JSON valido
all_json = sorted(list(BP.rglob("*.json")) + list(RP.rglob("*.json")))
parsed = {p: load_json(p) for p in all_json}
notes.append(f"{len(all_json)} arquivos JSON analisados")

# ---------------------------------------------------------------- manifests
bp_manifest = parsed.get(BP / "manifest.json")
rp_manifest = parsed.get(RP / "manifest.json")

if bp_manifest and rp_manifest:
    bp_uuid = bp_manifest["header"]["uuid"]
    rp_uuid = rp_manifest["header"]["uuid"]

    bp_deps = {d.get("uuid") for d in bp_manifest.get("dependencies", [])}
    rp_deps = {d.get("uuid") for d in rp_manifest.get("dependencies", [])}

    if rp_uuid not in bp_deps:
        fail("BP/manifest.json nao depende do UUID do RP")
    if bp_uuid not in rp_deps:
        fail("RP/manifest.json nao depende do UUID do BP")

    uuids = [bp_uuid, rp_uuid] + [
        m["uuid"] for m in bp_manifest.get("modules", []) + rp_manifest.get("modules", [])
    ]
    if len(uuids) != len(set(uuids)):
        fail("UUID repetido entre header/modules dos manifests")

    script_modules = [m for m in bp_manifest.get("modules", []) if m.get("type") == "script"]
    if not script_modules:
        fail("BP/manifest.json nao declara um modulo script")
    else:
        entry = BP / script_modules[0]["entry"]
        if not entry.exists():
            fail(f"entry do modulo script nao existe: {script_modules[0]['entry']}")

    module_deps = {
        d["module_name"]: d["version"]
        for d in bp_manifest.get("dependencies", [])
        if "module_name" in d
    }
    for required in ("@minecraft/server", "@minecraft/server-ui"):
        if required not in module_deps:
            fail(f"BP/manifest.json nao declara dependencia de {required}")
    notes.append(f"modulos de script: {', '.join(f'{k}@{v}' for k, v in module_deps.items())}")

# ---------------------------------------------------------------- itens do BP
item_files = sorted(BP.glob("items/*.json"))
bp_items: dict[str, Path] = {}
for path in item_files:
    data = parsed.get(path)
    if not data:
        continue
    try:
        item = data["minecraft:item"]
        identifier = item["description"]["identifier"]
    except KeyError:
        fail(f"{path.relative_to(ROOT)} nao tem minecraft:item/description/identifier")
        continue

    if identifier in bp_items:
        fail(f"identificador duplicado {identifier} ({path.name} e {bp_items[identifier].name})")
    bp_items[identifier] = path

    icon = item.get("components", {}).get("minecraft:icon")
    if icon is None:
        fail(f"{identifier} nao tem minecraft:icon")
    elif not isinstance(icon, str):
        fail(f"{identifier}: minecraft:icon precisa ser string no format_version novo (achei {type(icon).__name__})")

    if "minecraft:display_name" not in item.get("components", {}):
        fail(f"{identifier} nao tem minecraft:display_name")

notes.append(f"{len(bp_items)} itens definidos no BP")

# ---------------------------------------------------------------- texturas
tex_json = parsed.get(RP / "textures" / "item_texture.json")
texture_data = (tex_json or {}).get("texture_data", {})

for identifier, path in sorted(bp_items.items()):
    icon = parsed[path]["minecraft:item"]["components"].get("minecraft:icon")
    if isinstance(icon, str) and icon not in texture_data:
        fail(f"{identifier}: icon '{icon}' nao esta registrado em item_texture.json")

for key, entry in sorted(texture_data.items()):
    rel = entry["textures"] if isinstance(entry, dict) else entry
    if isinstance(rel, list):
        rel = rel[0]
    png = RP / f"{rel}.png"
    if not png.exists():
        fail(f"item_texture.json aponta pra textura inexistente: {rel}.png (chave {key})")
        continue
    size = png_size(png)
    if size is None:
        fail(f"{png.relative_to(ROOT)} nao e um PNG valido")
    elif size[0] != size[1]:
        fail(f"{png.relative_to(ROOT)} nao e quadrada ({size[0]}x{size[1]})")
    elif size != (ITEM_TEXTURE_PX, ITEM_TEXTURE_PX):
        fail(
            f"{png.relative_to(ROOT)} tem {size[0]}x{size[1]}, esperado "
            f"{ITEM_TEXTURE_PX}x{ITEM_TEXTURE_PX} (grid {ITEM_GRID}x{ITEM_GRID} com upscale 4x)"
        )

orphan_textures = sorted(
    p for p in (RP / "textures" / "items").glob("*.png")
    if f"textures/items/{p.stem}" not in {
        (e["textures"] if isinstance(e, dict) else e) for e in texture_data.values()
    }
)
for png in orphan_textures:
    notes.append(f"aviso: {png.relative_to(ROOT)} nao e usada por nenhum item")

# ------------------------------------------------ texturas x grids de origem
try:
    sys.path.insert(0, str(ROOT / "tools"))
    from textures import TEXTURES  # noqa: E402

    for key in sorted(TEXTURES):
        png = RP / "textures" / f"{key}.png"
        if not png.exists():
            fail(f"tools/textures.py define '{key}' mas {png.relative_to(ROOT)} nao existe")
    for png in sorted((RP / "textures" / "items").glob("*.png")):
        if f"items/{png.stem}" not in TEXTURES:
            notes.append(f"aviso: {png.relative_to(ROOT)} nao tem grid de origem em tools/textures.py")
    notes.append(f"{len(TEXTURES)} texturas com grid de origem em tools/textures.py")
except ImportError:
    notes.append("aviso: tools/textures.py nao pode ser importado")

# ---------------------------------------------------------------- particulas
particle_ids = set()
for path in sorted(RP.glob("particles/*.json")):
    data = parsed.get(path)
    if not data:
        continue
    identifier = data.get("particle_effect", {}).get("description", {}).get("identifier")
    if not identifier:
        fail(f"{path.relative_to(ROOT)} nao declara um identifier de particula")
        continue
    particle_ids.add(identifier)
    tex = data["particle_effect"]["description"].get("basic_render_parameters", {}).get("texture")
    if tex and not (RP / f"{tex}.png").exists():
        fail(f"particula {identifier} aponta pra textura inexistente: {tex}.png")
notes.append(f"particulas customizadas: {', '.join(sorted(particle_ids)) or 'nenhuma'}")

# ---------------------------------------------------------------- main.js
main_js = (BP / "scripts" / "main.js").read_text(encoding="utf-8")

referenced = set(re.findall(r'"([a-z_]+:[a-z0-9_]+)"', main_js))
KNOWN_NON_ITEM_PREFIXES = ("minecraft:", "sakura:", "mv:")
referenced_items = {
    i for i in referenced
    if not i.startswith(KNOWN_NON_ITEM_PREFIXES) and not i.startswith("multiversal:")
}
referenced_items |= {i for i in referenced if i.startswith("multiversal:")}

for identifier in sorted(referenced_items):
    if identifier not in bp_items:
        fail(f"main.js usa o item '{identifier}' mas nao existe BP/items/*.json pra ele")

unused = sorted(set(bp_items) - referenced_items)
for identifier in unused:
    notes.append(f"aviso: {identifier} existe no BP mas o main.js nunca cita")

used_particles = {p for p in referenced if p.startswith("sakura:")}
for particle in sorted(used_particles):
    if particle not in particle_ids:
        fail(f"main.js usa a particula '{particle}' mas ela nao esta definida em RP/particles")

# cooldown do item (visual) x cooldown do script
for identifier, path in sorted(bp_items.items()):
    components = parsed[path]["minecraft:item"]["components"]
    cooldown = components.get("minecraft:cooldown")
    if not cooldown:
        continue
    match = re.search(
        rf'"{re.escape(identifier)}":\s*(\d+),?\s*(?://.*)?$',
        main_js,
        re.MULTILINE,
    )
    if not match:
        continue
    script_seconds = int(match.group(1)) / 20
    item_seconds = cooldown["duration"]
    if abs(script_seconds - item_seconds) > 0.05:
        notes.append(
            f"aviso: {identifier} tem cooldown visual de {item_seconds}s "
            f"mas o script usa {script_seconds:g}s"
        )

# ---------------------------------------------------------------- relatorio
print(f"\n\033[1mValidacao de {ROOT.name}\033[0m")
for note in notes:
    marker = "\033[33m  !\033[0m" if note.startswith("aviso:") else "\033[36m  i\033[0m"
    print(f"{marker} {note}")

if problems:
    print(f"\n\033[31m{len(problems)} problema(s):\033[0m")
    for p in problems:
        print(f"  \033[31m✘\033[0m {p}")
    sys.exit(1)

print("\n\033[32m✔ nenhum problema encontrado\033[0m")
