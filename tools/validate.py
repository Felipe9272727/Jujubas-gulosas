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


def version_text(version) -> str:
    if not isinstance(version, (list, tuple)):
        return str(version)
    return ".".join(str(n) for n in version)


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

    bp_version = bp_manifest["header"]["version"]
    rp_version = rp_manifest["header"]["version"]
    notes.append(
        f"versao dos packs: BP {version_text(bp_version)}, RP {version_text(rp_version)}"
    )

    # O cliente guarda cada pack por (uuid, versao). Dependencia apontando pra
    # uma versao que nao existe mais faz o jogo reclamar de pack faltando.
    for label, manifest, other_uuid, other_version in (
        ("BP", bp_manifest, rp_uuid, rp_version),
        ("RP", rp_manifest, bp_uuid, bp_version),
    ):
        for dependency in manifest.get("dependencies", []):
            if dependency.get("uuid") != other_uuid:
                continue
            if list(dependency.get("version", [])) != list(other_version):
                fail(
                    f"{label}/manifest.json depende da versao "
                    f"{version_text(dependency.get('version'))} do outro pack, mas ele "
                    f"esta na {version_text(other_version)} "
                    f"- rode python3 tools/bump_version.py"
                )

    # modulo fora de sincronia com o header bagunca o cache do cliente
    for label, manifest in (("BP", bp_manifest), ("RP", rp_manifest)):
        header_version = manifest["header"]["version"]
        for module in manifest.get("modules", []):
            if list(module.get("version", [])) != list(header_version):
                notes.append(
                    f"aviso: modulo {module.get('type')} do {label} esta na "
                    f"{version_text(module.get('version'))} e o header na "
                    f"{version_text(header_version)}"
                )

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

# ------------------------------------------- override do player no RP (escala)
player_entity = RP / "entity" / "player.entity.json"
if player_entity.exists():
    data = parsed.get(player_entity)
    if data:
        scale = (
            data.get("minecraft:client_entity", {})
            .get("description", {})
            .get("scripts", {})
            .get("scale")
        )
        if not scale:
            fail("RP/entity/player.entity.json nao define scripts.scale")
        else:
            notes.append(f"escala do player: {scale}")
            # o Molang olha um item na offhand; ele tem que existir de verdade
            for name in re.findall(r"'([a-z_]+:[a-z0-9_]+)'", scale):
                if name not in bp_items:
                    fail(
                        f"o scripts.scale do player cita o item '{name}', "
                        f"mas nao existe BP/items/*.json pra ele"
                    )
            for required in ("identifier", "geometry", "render_controllers", "textures"):
                if required not in data["minecraft:client_entity"]["description"]:
                    fail(f"RP/entity/player.entity.json perdeu a chave '{required}' do vanilla")

        # o client entity do player so aceita persona (Character Creator) com
        # min_engine_version <= 1.13.0
        engine = data.get("minecraft:client_entity", {}).get("description", {}).get(
            "min_engine_version"
        )
        if engine != "1.13.0":
            fail(
                "RP/entity/player.entity.json precisa de \"min_engine_version\": \"1.13.0\" "
                f"na description (achei: {engine!r}) - sem isso a skin de persona quebra"
            )

main_js_text = (BP / "scripts" / "main.js").read_text(encoding="utf-8")

# ------------------------------- vidas que o Bedrock nao consegue representar
# health_boost anda de 4 em 4 a partir de 20, entao todo teto de vida e 20+4k.
# Uma vida fora dessa grade e arredondada PRA CIMA e o personagem fica com 1 a 3
# de vida a mais do que o configurado.
for raw in sorted(set(re.findall(r"health:\s*(\d+)", main_js_text)), key=int):
    configured = int(raw)
    if (configured - 20) % 4 == 0:
        continue
    real = 20 + (-(-(configured - 20) // 4)) * 4
    notes.append(
        f"aviso: vida {configured} nao cai na grade do health_boost (20+4k), "
        f"o jogo vai dar {real}"
    )

# ------------------------------- itens que o script manda pra offhand
# O Bedrock recusa a offhand EM SILENCIO pra item sem minecraft:allow_off_hand.
# O marcador da forma gigante mora nessa slot: sem o componente, o modelo nunca
# escala e nada no jogo diz por que.
for marker in sorted(set(re.findall(r'offhandMarker:\s*"([^"]+)"', main_js_text))):
    path = bp_items.get(marker)
    if path is None:
        fail(f"offhandMarker '{marker}' nao tem BP/items/*.json")
        continue
    item = (parsed.get(path) or {}).get("minecraft:item", {})
    allow = item.get("components", {}).get("minecraft:allow_off_hand")
    value = allow.get("value") if isinstance(allow, dict) else allow
    if not value:
        fail(
            f"o item '{marker}' vai pra offhand mas nao declara "
            f"minecraft:allow_off_hand - o jogo vai recusar sem avisar"
        )
    else:
        notes.append(f"marcador de offhand ok: {marker}")

# ------------------------------------------------- attachables e animacoes
# Um attachable quebrado nao da erro no jogo: ele simplesmente nao aparece.
geometry_ids = set()
for path in sorted(RP.glob("models/entity/*.json")):
    data = parsed.get(path)
    if not data:
        continue
    for geo in data.get("minecraft:geometry", []):
        identifier = geo.get("description", {}).get("identifier")
        if identifier:
            geometry_ids.add(identifier)

declared_controllers = set()
for path in sorted(RP.glob("render_controllers/*.json")):
    data = parsed.get(path)
    if data:
        declared_controllers |= set(data.get("render_controllers", {}))

for path in sorted(RP.glob("attachables/*.json")):
    data = parsed.get(path)
    if not data:
        continue
    description = data.get("minecraft:attachable", {}).get("description", {})
    identifier = description.get("identifier")
    if not identifier:
        fail(f"{path.relative_to(ROOT)} nao declara um identifier")
        continue
    # o attachable se amarra num ITEM: sem o item ele nunca e vestido
    if identifier not in bp_items:
        fail(f"o attachable '{identifier}' nao tem BP/items/*.json correspondente")
    for name, tex in description.get("textures", {}).items():
        if tex.startswith("textures/misc/"):
            continue  # textura vanilla (glint)
        if not (RP / f"{tex}.png").exists():
            fail(f"o attachable '{identifier}' aponta pra textura inexistente: {tex}.png")
    for name, geo in description.get("geometry", {}).items():
        if geo not in geometry_ids:
            fail(
                f"o attachable '{identifier}' usa a geometria '{geo}' mas ela nao "
                f"esta em RP/models/entity"
            )
    for controller in description.get("render_controllers", []):
        cname = controller if isinstance(controller, str) else next(iter(controller))
        if cname not in declared_controllers:
            fail(
                f"o attachable '{identifier}' usa o render controller '{cname}' "
                f"mas ele nao esta em RP/render_controllers"
            )
    notes.append(f"attachable ok: {identifier}")

# animacao citada pelo script tem que existir de verdade no RP
animation_ids = set()
for path in sorted(RP.glob("animations/*.json")):
    data = parsed.get(path)
    if data:
        animation_ids |= set(data.get("animations", {}))

for animation in sorted(set(re.findall(r'"(animation\.[a-z0-9_.]+)"', main_js_text))):
    if animation not in animation_ids:
        fail(
            f"main.js toca a animacao '{animation}' mas ela nao esta definida "
            f"em RP/animations"
        )
if animation_ids:
    notes.append(f"animacoes: {', '.join(sorted(animation_ids))}")

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

# Identificadores de particula sao pegos pelo uso real, nao por prefixo: o
# namespace de uma particula customizada e o mesmo do personagem dono dela
# (grimmjow:cero, mayuri:toxic_fog), entao adivinhar por prefixo confunde
# particula com item.
particle_refs = set(re.findall(r'spawnParticle\(\s*"([^"]+)"', main_js))
particle_refs |= set(
    re.findall(r'(?:particle|burst|particleId|cryParticle)\s*:\s*"([^"]+)"', main_js)
)

for particle in sorted(particle_refs):
    if particle.startswith("minecraft:"):
        continue
    if particle not in particle_ids:
        fail(f"main.js usa a particula '{particle}' mas ela nao esta definida em RP/particles")

for particle in sorted(particle_ids):
    if particle not in particle_refs:
        notes.append(f"aviso: a particula {particle} esta definida mas o main.js nunca usa")

referenced_items = {
    i for i in referenced
    if not i.startswith(("minecraft:", "mv:")) and i not in particle_refs
}

for identifier in sorted(referenced_items):
    if identifier not in bp_items:
        fail(f"main.js usa o item '{identifier}' mas nao existe BP/items/*.json pra ele")

unused = sorted(set(bp_items) - referenced_items)
for identifier in unused:
    notes.append(f"aviso: {identifier} existe no BP mas o main.js nunca cita")

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
