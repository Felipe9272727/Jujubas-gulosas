"""
Clone da Illusion's Mastery do Aizen: um armor stand vestindo armadura de couro
BRANCA completa, com o nome do Aizen em cima.

POR QUE NAO E UM ARMOR STAND DE VERDADE
---------------------------------------
Na API estavel 2.0.0 nao existe ItemDyeableComponent: nao da pra tingir couro
de branco por script (nem por comando). E o armor stand vanilla quebra com dois
golpes e DROPA a armadura - cada clone acertado viraria loot. Entao o clone e
uma entidade propria (aizen:clone, imune a dano e sem loot) com este modelo,
copiado das medidas do armor stand vanilla (geometry.armor_stand da Mojang) com
as camadas de armadura do humanoide por cima.

Mesma regra do hollow_model.py: caixa com tamanho INTEIRO (o UV do Bedrock
segue o tamanho real da caixa), origin pode ser fracionario.
"""
from __future__ import annotations

from boxmodel import BoxModel, faces

TEXTURE_SIZE = 64
IDENTIFIER = "geometry.aizen_clone"

PALETTE = {
    "leather":      (242, 242, 238, 255),
    "leather_dark": (214, 214, 208, 255),
    "leather_deep": (182, 182, 176, 255),
    "stitch":       (150, 150, 144, 255),
    "void":         (26, 24, 30, 255),
    "wood":         (128, 94, 56, 255),
    "wood_dark":    (96, 68, 38, 255),
    "stone":        (170, 170, 170, 255),
    "stone_dark":   (134, 134, 134, 255),
    "stone_deep":   (102, 102, 102, 255),
}

# (osso, origin, size, cor, inflate). Os inflates sao os da armadura vanilla:
# capacete e mangas 1.0, peitoral 1.01 (senao a frente dele briga com a das
# mangas), calca 0.5 e bota 1.0 por cima da calca.
CUBES = [
    ("baseplate", [-6, 0, -6],     [12, 1, 12], "stone",   0.0),   # 0 base de pedra
    ("head",      [-4, 24, -4],    [8, 8, 8],   "leather", 1.0),   # 1 capacete
    ("body",      [-4, 12, -2],    [8, 12, 4],  "leather", 1.01),  # 2 peitoral
    ("rightarm",  [-8, 12, -2],    [4, 12, 4],  "leather", 1.0),   # 3 manga direita
    ("leftarm",   [4, 12, -2],     [4, 12, 4],  "leather", 1.0),   # 4 manga esquerda
    ("rightleg",  [-3.9, 1, -2],   [4, 11, 4],  "leather", 0.5),   # 5 calca direita
    ("leftleg",   [-0.1, 1, -2],   [4, 11, 4],  "leather", 0.5),   # 6 calca esquerda
    ("rightleg",  [-3.9, 1, -2],   [4, 4, 4],   "leather", 1.0),   # 7 bota direita
    ("leftleg",   [-0.1, 1, -2],   [4, 4, 4],   "leather", 1.0),   # 8 bota esquerda
]

# ossos com os nomes e pivots do armor stand vanilla
BONES = {
    "baseplate": (None,        [0, 0, 0]),
    "waist":     ("baseplate", [0, 12, 0]),
    "body":      ("waist",     [0, 24, 0]),
    "head":      ("body",      [0, 24, 0]),
    "rightarm":  ("body",      [-5, 22, 0]),
    "leftarm":   ("body",      [5, 22, 0]),
    "rightleg":  ("body",      [-1.9, 12, 0]),
    "leftleg":   ("body",      [1.9, 12, 0]),
}

_MODEL = BoxModel(IDENTIFIER, CUBES, BONES, PALETTE, TEXTURE_SIZE, bounds=(2, 3, 1.25))
_faces = faces


def pack_uvs():
    return _MODEL.pack_uvs()


def build_geometry() -> dict:
    return _MODEL.build_geometry()


def _front(placement, size):
    (u, v), (w, h, d) = placement, size
    return u + d, v + d, w, h


def build_texture_rects():
    placements = pack_uvs()
    rects = _MODEL.base_rects()

    # base: borda escura em cima, como a laje do armor stand
    (u, v), (w, _h, d) = placements[0], CUBES[0][2]
    rects.append([u + d, v, w, 1, "stone_dark"])
    rects.append([u + d, v + d - 1, w, 1, "stone_dark"])
    rects.append([u + d, v, 1, d, "stone_dark"])
    rects.append([u + d + w - 1, v, 1, d, "stone_dark"])

    # capacete: testa de couro, costura, e a abertura do rosto mostrando o
    # interior escuro com a haste de madeira do armor stand no meio
    x, y, w, h = _front(placements[1], CUBES[1][2])
    rects.append([x, y + 2, w, 1, "stitch"])
    rects.append([x + 1, y + 3, w - 2, h - 3, "void"])
    rects.append([x + 3, y + 3, 2, h - 3, "wood"])
    rects.append([x + 4, y + 3, 1, h - 3, "wood_dark"])
    for face in ("east", "west", "south"):
        fx, fy, fw, _fh = _faces(*placements[1], *CUBES[1][2])[face]
        rects.append([fx, fy + 6, fw, 1, "stitch"])  # barra do capacete

    # peitoral: gola em V, tres botoes e o cinto
    x, y, w, h = _front(placements[2], CUBES[2][2])
    rects.append([x + 2, y, 4, 1, "stitch"])
    rects.append([x + 3, y + 1, 2, 1, "stitch"])
    for row in (3, 6, 9):
        rects.append([x + 3, y + row, 2, 1, "stitch"])
    rects.append([x, y + h - 2, w, 1, "leather_deep"])
    rects.append([x + 3, y + h - 2, 2, 1, "stitch"])  # fivela

    # mangas: punho
    for index in (3, 4):
        x, y, w, h = _front(placements[index], CUBES[index][2])
        for face in ("east", "north", "west", "south"):
            fx, fy, fw, fh = _faces(*placements[index], *CUBES[index][2])[face]
            rects.append([fx, fy + fh - 3, fw, 1, "stitch"])

    # calcas: cos e joelheira
    for index in (5, 6):
        x, y, w, h = _front(placements[index], CUBES[index][2])
        rects.append([x, y, w, 1, "stitch"])
        rects.append([x, y + 5, w, 2, "leather_dark"])

    # botas: cadarco na frente e sola
    for index in (7, 8):
        x, y, w, h = _front(placements[index], CUBES[index][2])
        rects.append([x + 1, y + 1, 2, 1, "stitch"])
        for face in ("east", "north", "west", "south"):
            fx, fy, fw, fh = _faces(*placements[index], *CUBES[index][2])[face]
            rects.append([fx, fy + fh - 1, fw, 1, "leather_deep"])
    return _grain(rects)


def _grain(rects):
    """
    Couro liso demais parece plastico. Textura de Minecraft tem ruido: aqui um
    pontilhado deterministico (mesmo resultado a cada build, senao o
    gen_textures --check nunca bateria) escurece alguns pixels de couro.
    """
    painted = {}
    for x0, y0, w, h, key in rects:
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                painted[(x, y)] = key
    grain = []
    for (x, y), key in painted.items():
        if key != "leather":
            continue
        if (x * 7 + y * 13 + (x * y) % 5) % 11 == 0:
            grain.append([x, y, 1, 1, "leather_dark"])
    return rects + grain


TEXTURE_SPEC = _MODEL.texture_spec(build_texture_rects())
