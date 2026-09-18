"""
Modelos dos attachables do Ichigo Vizard: a Hollowficacao e o Vasto Lorde.

POR QUE ISSO E CODIGO E NAO UM .geo.json ESCRITO A MAO
------------------------------------------------------
Com ~35 caixas por variante, posicionar UV na mao e onde o modelo quebra em
silencio. Aqui as caixas sao descritas uma vez e o mesmo dado gera a geometria
E a textura, com o UV empacotado por codigo.

REGRA DURA: TAMANHO DE CAIXA E INTEIRO
--------------------------------------
O Bedrock mapeia o UV pelo tamanho REAL da caixa. Uma caixa de largura 8.4
ocupa 8.4 pixels de UV, e como a textura so tem pixel inteiro, todo detalhe
pintado nela sai deslocado - foi exatamente isso que borrou a mascara na
primeira versao. O `origin` pode ser fracionario a vontade (ele so move a peca,
nao mexe no UV); o `size`, nao. Tem um assert no fim do arquivo.

Convencoes do Bedrock: 1 bloco = 16 unidades, -Z e a FRENTE, o player tem a
cabeca em y 24..32, o corpo em 12..24 e as pernas em 0..12.
"""
from __future__ import annotations

import math

TEXTURE_SIZE = 128

PALETTE = {
    "bone":        (238, 236, 226, 255),
    "bone_dark":   (198, 194, 180, 255),
    "bone_deep":   (160, 156, 144, 255),
    "black":       (28, 28, 34, 255),
    "black_dark":  (18, 18, 24, 255),
    "black_deep":  (11, 11, 15, 255),
    "red":         (176, 26, 26, 255),
    "red_dark":    (132, 18, 18, 255),
    "red_deep":    (94, 12, 12, 255),
    "orange":      (228, 122, 36, 255),
    "orange_dark": (186, 92, 24, 255),
    "orange_deep": (140, 66, 16, 255),
    "white":       (236, 236, 240, 255),
    "white_dark":  (196, 196, 202, 255),
    "white_deep":  (156, 156, 164, 255),
    "eye":         (10, 10, 12, 255),
    "iris":        (222, 190, 40, 255),
}

# ---------------------------------------------------------------------------
# corpo comum as duas formas: (osso, origin, size, cor, inflate)
# ---------------------------------------------------------------------------
def _base_cubes(robe, robe_dark, accent, accent_dark):
    return [
        # cabeca
        ("head",  [-4, 24, -4],      [8, 8, 8],  "bone",      0.35),   # cranio
        ("head",  [-4.5, 25, -5.5],  [9, 6, 2],  "bone",      0.0),    # MASCARA
        ("head",  [-3, 23.5, -5.5],  [6, 2, 2],  "bone_dark", 0.0),    # mandibula
        # torso
        ("body",  [-4, 12, -2],      [8, 12, 4], robe,        0.3),
        ("body",  [-4.5, 16.5, -3.5],[9, 6, 2],  robe_dark,   0.0),    # peitoral
        ("body",  [-2.5, 18, -4.5],  [5, 3, 1],  accent,      0.0),    # placa
        ("body",  [-4.5, 14.5, -2.5],[9, 2, 5],  "white",     0.0),    # faixa
        ("body",  [-4.5, 20.5, 1.5], [9, 3, 2],  robe_dark,   0.0),    # gola
        # ombreiras
        ("body",  [-7.5, 21, -3],    [4, 3, 6],  accent,      0.0),
        ("body",  [3.5, 21, -3],     [4, 3, 6],  accent,      0.0),
        # saia
        ("waist", [-5, 7, -3],       [10, 6, 6], robe_dark,   0.0),
        ("waist", [-5.5, 3, -3.5],   [11, 4, 7], "black_deep",0.0),
        # bracos
        ("rightArm", [-8, 12, -2],     [4, 12, 4], robe,      0.3),
        ("rightArm", [-8.5, 18.5, -2.5],[5, 4, 5], robe_dark, 0.0),    # manga
        ("rightArm", [-8.5, 12, -2.5], [5, 3, 5],  accent,    0.0),    # punho
        ("rightArm", [-8.5, 10.5, -2.5],[5, 2, 5], accent_dark,0.0),   # mao
        ("leftArm",  [4, 12, -2],      [4, 12, 4], robe,      0.3),
        ("leftArm",  [3.5, 18.5, -2.5],[5, 4, 5],  robe_dark, 0.0),
        ("leftArm",  [3.5, 12, -2.5],  [5, 3, 5],  accent,    0.0),
        ("leftArm",  [3.5, 10.5, -2.5],[5, 2, 5],  accent_dark,0.0),
        # pernas
        ("rightLeg", [-3.9, 0, -2],    [4, 12, 4], robe,      0.3),
        ("rightLeg", [-4.4, 0, -2.5],  [5, 2, 5],  "black_deep",0.0),  # sandalia
        ("leftLeg",  [-0.1, 0, -2],    [4, 12, 4], robe,      0.3),
        ("leftLeg",  [-0.6, 0, -2.5],  [5, 2, 5],  "black_deep",0.0),
    ]


# ---------------------------------------------------------------------------
# variantes
# ---------------------------------------------------------------------------
VARIANTS = {
    # Hollowficacao: cabelo laranja, shihakusho preto, osso nos detalhes
    "hollow": {
        "identifier": "geometry.hollow_ichigo",
        "cubes": _base_cubes("black", "black_dark", "bone", "bone_dark") + [
            ("head",  [-4.5, 30.5, -4.5], [9, 2, 9],  "orange",      0.0),  # topo
            ("head",  [-4.5, 26, 3.5],    [9, 5, 2],  "orange_dark", 0.0),  # nuca
            ("hornR", [-3.5, 29.5, -2.5], [2, 6, 2],  "bone",        0.0),
            ("hornR", [-3, 34.5, -2],     [1, 3, 1],  "bone_dark",   0.0),
            ("hornL", [1.5, 29.5, -2.5],  [2, 6, 2],  "bone",        0.0),
            ("hornL", [2, 34.5, -2],      [1, 3, 1],  "bone_dark",   0.0),
            ("spikeA", [-1.5, 29.5, 1.5], [3, 7, 3],  "orange",      0.0),
            ("spikeB", [-4, 29.5, 1.5],   [2, 6, 2],  "orange_dark", 0.0),
            ("spikeC", [2, 29.5, 1.5],    [2, 6, 2],  "orange_dark", 0.0),
            ("spikeD", [-1, 30, -3.5],    [2, 5, 2],  "orange",      0.0),
        ],
        "horn_tilt": ([-12, 0, -16], [-12, 0, 16]),
    },
    # Vasto Lorde: osso por cima de tudo, chifres o dobro, juba e espinhos
    "vasto": {
        "identifier": "geometry.vasto_lorde",
        "cubes": _base_cubes("black_deep", "black", "bone", "bone_dark") + [
            ("head",  [-4.5, 30.5, -4.5], [9, 2, 9],  "bone",       0.0),  # crista
            ("head",  [-5, 25, 3.5],      [10, 7, 3], "white_dark", 0.0),  # juba
            ("head",  [-5, 23, 4.5],      [10, 4, 2], "white_deep", 0.0),
            # chifres longos, com uma terceira ponta
            ("hornR", [-4, 29, -2.5],     [3, 10, 3], "bone",       0.0),
            ("hornR", [-3.5, 38, -2],     [2, 5, 2],  "bone_dark",  0.0),
            ("hornL", [1, 29, -2.5],      [3, 10, 3], "bone",       0.0),
            ("hornL", [1.5, 38, -2],      [2, 5, 2],  "bone_dark",  0.0),
            ("spikeA", [-2, 29.5, 1],     [4, 9, 4],  "bone",       0.0),
            ("spikeB", [-5, 29.5, 1],     [3, 8, 3],  "bone_dark",  0.0),
            ("spikeC", [2, 29.5, 1],      [3, 8, 3],  "bone_dark",  0.0),
            ("spikeD", [-1.5, 30, -4],    [3, 6, 3],  "bone",       0.0),
            # espinhos saindo dos ombros e do peito
            ("body",  [-8, 23.5, -1],     [3, 5, 3],  "bone",       0.0),
            ("body",  [5, 23.5, -1],      [3, 5, 3],  "bone",       0.0),
            ("body",  [-4.5, 12.5, -4],   [9, 4, 1],  "bone_dark",  0.0),  # costelas
        ],
        "horn_tilt": ([-20, 0, -24], [-20, 0, 24]),
    },
}


def bones_for(variant: str):
    """
    Espelha o rig do player (geometry.humanoid.custom) osso por osso.

        root -> waist -> body -> head / leftArm / rightArm
        root -> leftLeg / rightLeg      <- as pernas saem da RAIZ

    Attachable casa osso por NOME com o rig do pai: osso faltando, ou no pai
    errado, nao acompanha a animacao - e isso nao da erro nenhum no jogo.
    """
    right_tilt, left_tilt = VARIANTS[variant]["horn_tilt"]
    return {
        "root":     (None,     [0, 0, 0],        None),
        "waist":    ("root",   [0, 12, 0],       None),
        "body":     ("waist",  [0, 24, 0],       None),
        "head":     ("body",   [0, 24, 0],       None),
        "rightArm": ("body",   [-5, 22, 0],      None),
        "leftArm":  ("body",   [5, 22, 0],       None),
        "rightLeg": ("root",   [-1.9, 12, 0],    None),
        "leftLeg":  ("root",   [1.9, 12, 0],     None),
        # ossos proprios: o pivot fica na BASE da peca, entao a rotacao inclina
        # em vez de arrancar do lugar
        "hornR":    ("head",   [-2.5, 30, -1.5], right_tilt),
        "hornL":    ("head",   [2.5, 30, -1.5],  left_tilt),
        "spikeA":   ("head",   [0, 30, 2.5],     [36, 0, 0]),
        "spikeB":   ("head",   [-3, 30, 2.5],    [30, -18, -14]),
        "spikeC":   ("head",   [3, 30, 2.5],     [30, 18, 14]),
        "spikeD":   ("head",   [0, 30, -3],      [-28, 0, 0]),
    }


FACE_SHADE = {
    "top": "", "bottom": "_deep", "north": "",
    "south": "_dark", "east": "_dark", "west": "_dark",
}


def _shade(color: str, face: str) -> str:
    suffix = FACE_SHADE[face]
    if not suffix:
        return color
    if color + suffix in PALETTE:
        return color + suffix
    base = color.rsplit("_", 1)[0]
    for option in (base + "_deep", base + "_dark", base, color):
        if option in PALETTE:
            return option
    return color


def _faces(u, v, w, h, d):
    """as seis faces de um cubo no layout de UV do Bedrock"""
    return {
        "top":    (u + d, v, w, d),
        "bottom": (u + d + w, v, w, d),
        "east":   (u, v + d, d, h),
        "north":  (u + d, v + d, w, h),
        "west":   (u + d + w, v + d, d, h),
        "south":  (u + d + w + d, v + d, w, h),
    }


def pack_uvs(variant: str):
    """empacota o UV de cada caixa por linhas (shelf packing)"""
    cubes = VARIANTS[variant]["cubes"]
    placements = []
    x, y, row = 0, 0, 0
    for index, (_, _, size, _, _) in enumerate(cubes):
        w, h, d = size
        fw, fh = 2 * (w + d), h + d
        if x + fw > TEXTURE_SIZE:
            x, y, row = 0, y + row, 0
        if y + fh > TEXTURE_SIZE:
            raise ValueError(f"o atlas encheu na caixa {index} da variante {variant}")
        placements.append((x, y))
        x += fw
        row = max(row, fh)
    return placements


def build_geometry() -> dict:
    """as duas variantes moram no mesmo .geo.json"""
    geometries = []
    for variant, spec in VARIANTS.items():
        bones_spec = bones_for(variant)
        by_bone = {name: [] for name in bones_spec}

        for (bone, origin, size, color, inflate), (u, v) in zip(
            spec["cubes"], pack_uvs(variant)
        ):
            cube = {"origin": origin, "size": size, "uv": [u, v]}
            if inflate:
                cube["inflate"] = inflate
            by_bone[bone].append(cube)

        bones = []
        for name, (parent, pivot, rotation) in bones_spec.items():
            bone = {"name": name, "pivot": pivot}
            if parent:
                bone["parent"] = parent
            if rotation:
                bone["rotation"] = rotation
            if by_bone[name]:
                bone["cubes"] = by_bone[name]
            bones.append(bone)

        geometries.append({
            "description": {
                "identifier": spec["identifier"],
                "texture_width": TEXTURE_SIZE,
                "texture_height": TEXTURE_SIZE,
                "visible_bounds_width": 3,
                "visible_bounds_height": 4,
                "visible_bounds_offset": [0, 1.5, 0],
            },
            "bones": bones,
        })

    return {"format_version": "1.12.0", "minecraft:geometry": geometries}


def _paint_mask(rects, u, v, w, h, d):
    """
    A cara da mascara, na face da frente da placa (9x6).

    So funciona porque a caixa tem tamanho INTEIRO: com 8.4 de largura o
    Bedrock leria o UV em fracao de pixel e tudo isso sairia deslocado.
    """
    mx, my = u + d, v + d
    rects.append([mx + 1, my, 1, h, "red"])          # listras verticais
    rects.append([mx + w - 2, my, 1, h, "red"])
    rects.append([mx + 2, my + 2, 2, 2, "eye"])      # orbitas
    rects.append([mx + w - 4, my + 2, 2, 2, "eye"])
    rects.append([mx + 2, my + 3, 1, 1, "iris"])     # brilho dentro do olho
    rects.append([mx + w - 3, my + 3, 1, 1, "iris"])
    for tooth in range(2, w - 2, 2):                 # dentada
        rects.append([mx + tooth, my + h - 1, 1, 1, "eye"])


def build_texture_rects(variant: str):
    placements = pack_uvs(variant)
    cubes = VARIANTS[variant]["cubes"]
    rects = []

    for (bone, origin, size, color, inflate), (u, v) in zip(cubes, placements):
        w, h, d = size
        for face, (x, y, fw, fh) in _faces(u, v, w, h, d).items():
            rects.append([x, y, fw, fh, _shade(color, face)])

    # a caixa 1 e sempre a placa da mascara
    (u, v), (_, _, size, _, _) = placements[1], cubes[1]
    _paint_mask(rects, u, v, *size)
    return rects


# o assert que impede a regressao que borrou a mascara
for _variant, _spec in VARIANTS.items():
    for _bone, _origin, _size, _color, _inflate in _spec["cubes"]:
        for _value in _size:
            if float(_value) != int(_value):
                raise ValueError(
                    f"{_variant}/{_bone}: tamanho de caixa tem que ser INTEIRO "
                    f"(size={_size}). Tamanho fracionario faz o UV cair em fracao "
                    f"de pixel e desloca tudo que for pintado na caixa."
                )

TEXTURE_SPECS = {
    variant: {
        "size": (TEXTURE_SIZE, TEXTURE_SIZE),
        "palette": PALETTE,
        "rects": build_texture_rects(variant),
    }
    for variant in VARIANTS
}
