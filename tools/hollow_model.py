"""
Modelo do Ichigo hollowficado (attachable do peitoral).

POR QUE ISSO E UM ARQUIVO DE CODIGO E NAO UM .geo.json ESCRITO A MAO:
a geometria do Bedrock e um monte de caixa com UV manual. Com ~30 caixas,
posicionar UV na mao e onde o modelo quebra silenciosamente (face esticada,
UV sobreposta, textura de um cubo em cima do outro). Aqui as caixas sao
descritas uma vez, e o mesmo dado gera:

  - RP/models/entity/hollow_ichigo.geo.json  (a geometria)
  - RP/textures/entity/hollow_ichigo.png     (a textura, via textures.py)

O UV e empacotado automaticamente, entao adicionar uma caixa nao exige
recalcular nada na mao.

Convencoes do Bedrock: 1 bloco = 16 unidades, -Z e a FRENTE, o player tem a
cabeca em y 24..32, o corpo em 12..24 e as pernas em 0..12. Os nomes dos ossos
TEM que bater com o rig do player, senao o attachable nao acompanha a animacao.
"""
from __future__ import annotations

TEXTURE_SIZE = 128

# paleta: cada cubo escolhe uma cor base e as faces ganham sombreamento proprio
PALETTE = {
    "bone":       (238, 236, 226, 255),
    "bone_dark":  (198, 194, 180, 255),
    "bone_deep":  (162, 158, 146, 255),
    "black":      (28, 28, 34, 255),
    "black_dark": (18, 18, 24, 255),
    "black_deep": (11, 11, 15, 255),
    "red":        (176, 26, 26, 255),
    "red_dark":   (132, 18, 18, 255),
    "red_deep":   (96, 12, 12, 255),
    "orange":     (228, 122, 36, 255),
    "orange_dark":(186, 92, 24, 255),
    "orange_deep":(140, 66, 16, 255),
    "white":      (236, 236, 240, 255),
    "white_dark": (196, 196, 202, 255),
    "white_deep": (158, 158, 166, 255),
}

# cada cubo: (osso, origin[x,y,z], size[w,h,d], cor, inflate)
# A profundidade vem daqui: placas que se projetam pra frente, ombreiras que
# saem pros lados, chifres, espinhos de cabelo com rotacao propria e a saia do
# shihakusho abrindo. Um humanoide de 6 caixas fica chapado; isso tem 31.
CUBES = [
    # ---------------- cabeca (x -4..4, y 24..32, z -4..4; -Z e a cara) --------
    ("head",  [-4, 24, -4],       [8, 8, 8],      "bone",       0.35),  # cranio
    ("head",  [-4.2, 25, -5.6],   [8.4, 6, 1.7],  "bone",       0.0),   # mascara
    ("head",  [-3, 23.6, -5.6],   [6, 1.8, 1.7],  "bone_dark",  0.0),   # mandibula
    ("head",  [-4.5, 30.8, -4.5], [9, 1.8, 9],    "orange",     0.0),   # topo do cabelo
    ("head",  [-4.5, 26, 3.6],    [9, 5.4, 1.6],  "orange_dark",0.0),   # nuca
    # ---------------- chifres (nascem no alto da testa) ----------------------
    ("hornR", [-3.6, 29.6, -2.6], [1.8, 6, 1.8],  "bone",       0.0),
    ("hornR", [-3.4, 34.8, -2.4], [1.4, 3, 1.4],  "bone_dark",  0.0),
    ("hornL", [1.8, 29.6, -2.6],  [1.8, 6, 1.8],  "bone",       0.0),
    ("hornL", [2.0, 34.8, -2.4],  [1.4, 3, 1.4],  "bone_dark",  0.0),
    # ---------------- espinhos de cabelo (topo e nuca) -----------------------
    ("spikeA", [-1.4, 29.8, 1.6], [2.8, 7, 2.6],  "orange",     0.0),
    ("spikeB", [-4.2, 29.6, 1.4], [2.4, 6, 2.2],  "orange_dark",0.0),
    ("spikeC", [1.8, 29.6, 1.4],  [2.4, 6, 2.2],  "orange_dark",0.0),
    ("spikeD", [-1.0, 30.2, -3.6],[2.0, 5, 2.0],  "orange",     0.0),
    # ---------------- torso (x -4..4, y 12..24, z -2..2) --------------------
    ("body",  [-4, 12, -2],       [8, 12, 4],     "black",      0.3),
    ("body",  [-4.2, 16.6, -3.3], [8.4, 6.4, 1.5],"black_dark", 0.0),   # peitoral
    ("body",  [-2.4, 18.2, -4.1], [4.8, 3.4, 1.1],"bone",       0.0),   # placa de osso
    ("body",  [-4.4, 14.4, -2.5], [8.8, 2, 5.2],  "white",      0.0),   # faixa
    ("body",  [-4.4, 20.6, 1.7],  [8.8, 3.4, 1.5],"black_dark", 0.0),   # gola
    # ---------------- ombreiras (encostadas no braco e no torso) ------------
    ("body",  [-7.4, 21, -3],     [4, 3, 6],      "bone",       0.0),
    ("body",  [3.4, 21, -3],      [4, 3, 6],      "bone",       0.0),
    # ---------------- saia do shihakusho ------------------------------------
    ("waist", [-4.8, 7, -2.8],    [9.6, 6, 5.6],  "black_dark", 0.0),
    ("waist", [-5.6, 3.4, -3.4],  [11.2, 4.2, 6.8],"black_deep",0.0),
    # ---------------- bracos -------------------------------------------------
    ("rightArm", [-8, 12, -2],    [4, 12, 4],     "black",      0.3),
    ("rightArm", [-8.7, 18.4, -2.7],[5.4, 4.4, 5.4],"black_dark",0.0),  # manga
    ("rightArm", [-8.5, 12.2, -2.5],[5, 3.2, 5],  "bone",       0.0),   # punho
    ("rightArm", [-8.3, 10.8, -2.3],[4.6, 1.6, 4.6],"bone_dark",0.0),   # mao
    ("leftArm",  [4, 12, -2],     [4, 12, 4],     "black",      0.3),
    ("leftArm",  [3.3, 18.4, -2.7],[5.4, 4.4, 5.4],"black_dark",0.0),
    ("leftArm",  [3.5, 12.2, -2.5],[5, 3.2, 5],   "bone",       0.0),
    ("leftArm",  [3.7, 10.8, -2.3],[4.6, 1.6, 4.6],"bone_dark", 0.0),
    # ---------------- pernas -------------------------------------------------
    ("rightLeg", [-3.9, 0, -2],   [4, 12, 4],     "black",      0.3),
    ("rightLeg", [-4.1, 0, -2.2], [4.4, 3, 4.4],  "black_deep", 0.0),   # sandalia
    ("leftLeg",  [-0.1, 0, -2],   [4, 12, 4],     "black",      0.3),
    ("leftLeg",  [-0.3, 0, -2.2], [4.4, 3, 4.4],  "black_deep", 0.0),
]

# ossos: nome -> (pai, pivot, rotacao)
# Os seis primeiros sao o rig do player. Os de baixo sao meus, pra dar angulo
# aos chifres e aos espinhos - e a rotacao que tira o modelo do plano.
# Ossos: nome -> (pai, pivot, rotacao).
#
# Os sete primeiros ESPELHAM o rig do player (geometry.humanoid.custom), pai por
# pai. Attachable casa osso por NOME com o rig do pai: osso que nao existe la, ou
# pendurado no pai errado, nao acompanha a animacao. O rig do player e:
#     root -> waist -> body -> head / leftArm / rightArm
#     root -> leftLeg / rightLeg        <- as pernas saem da RAIZ, nao da cintura
# Eu tinha esquecido o `root` e pendurado as pernas no `waist`.
BONES = {
    "root":     (None,     [0, 0, 0],         None),
    "waist":    ("root",   [0, 12, 0],        None),
    "body":     ("waist",  [0, 24, 0],        None),
    "head":     ("body",   [0, 24, 0],        None),
    "rightArm": ("body",   [-5, 22, 0],       None),
    "leftArm":  ("body",   [5, 22, 0],        None),
    "rightLeg": ("root",   [-1.9, 12, 0],     None),
    "leftLeg":  ("root",   [1.9, 12, 0],      None),
    # ossos meus, pendurados na cabeca: inclinam chifre e espinho sem arrancar
    # a peca do lugar
    "hornR":    ("head",   [-2.7, 30, -1.7],  [-12, 0, -16]),
    "hornL":    ("head",   [2.7, 30, -1.7],   [-12, 0, 16]),
    "spikeA":   ("head",   [0, 30.2, 2.6],    [36, 0, 0]),
    "spikeB":   ("head",   [-3, 30, 2.4],     [30, -18, -14]),
    "spikeC":   ("head",   [3, 30, 2.4],      [30, 18, 14]),
    "spikeD":   ("head",   [0, 30.4, -2.8],   [-28, 0, 0]),
}

# cada face de um cubo ganha um tom: topo mais claro, base mais escura
FACE_SHADE = {
    "top": "",
    "bottom": "_deep",
    "north": "",
    "south": "_dark",
    "east": "_dark",
    "west": "_dark",
}


def _shade(color: str, face: str) -> str:
    """cor da face; cai na cor base quando o tom nao existe na paleta"""
    suffix = FACE_SHADE[face]
    if not suffix:
        return color
    # "bone_dark" + "_dark" nao existe: usa o tom mais fundo que existir
    candidate = color + suffix
    if candidate in PALETTE:
        return candidate
    base = color.rsplit("_", 1)[0]
    for option in (base + "_deep", base + "_dark", base, color):
        if option in PALETTE:
            return option
    return color


def _footprint(size):
    """espaco que o UV de um cubo ocupa: 2*(w+d) por (h+d)"""
    w, h, d = size
    import math
    return math.ceil(2 * (w + d)), math.ceil(h + d)


def pack_uvs():
    """
    Empacota o UV de cada cubo no atlas por linhas (shelf packing).

    E o ponto do arquivo: com 31 cubos, posicionar UV na mao e o que quebra o
    modelo em silencio. Aqui adicionar um cubo nao exige recalcular nada.
    """
    placements = []
    cursor_x, cursor_y, row_height = 0, 0, 0

    for index, (bone, origin, size, color, inflate) in enumerate(CUBES):
        fw, fh = _footprint(size)
        if cursor_x + fw > TEXTURE_SIZE:
            cursor_x = 0
            cursor_y += row_height
            row_height = 0
        if cursor_y + fh > TEXTURE_SIZE:
            raise ValueError(
                f"o atlas de {TEXTURE_SIZE}x{TEXTURE_SIZE} encheu no cubo {index}"
            )
        placements.append((cursor_x, cursor_y))
        cursor_x += fw
        row_height = max(row_height, fh)

    return placements


def build_geometry() -> dict:
    placements = pack_uvs()
    by_bone: dict[str, list] = {name: [] for name in BONES}

    for (bone, origin, size, color, inflate), (u, v) in zip(CUBES, placements):
        cube = {"origin": origin, "size": size, "uv": [u, v]}
        if inflate:
            cube["inflate"] = inflate
        by_bone[bone].append(cube)

    bones = []
    for name, (parent, pivot, rotation) in BONES.items():
        bone = {"name": name, "pivot": pivot}
        if parent:
            bone["parent"] = parent
        if rotation:
            bone["rotation"] = rotation
        if by_bone[name]:
            bone["cubes"] = by_bone[name]
        bones.append(bone)

    return {
        "format_version": "1.12.0",
        "minecraft:geometry": [
            {
                "description": {
                    "identifier": "geometry.hollow_ichigo",
                    "texture_width": TEXTURE_SIZE,
                    "texture_height": TEXTURE_SIZE,
                    "visible_bounds_width": 3,
                    "visible_bounds_height": 4,
                    "visible_bounds_offset": [0, 1.5, 0],
                },
                "bones": bones,
            }
        ],
    }


def build_texture_rects():
    """pinta cada face de cada cubo na posicao que o packer deu"""
    import math

    placements = pack_uvs()
    rects = []

    for (bone, origin, size, color, inflate), (u, v) in zip(CUBES, placements):
        w, h, d = (math.ceil(v) for v in size)
        faces = {
            "top":    (u + d, v, w, d),
            "bottom": (u + d + w, v, w, d),
            "east":   (u, v + d, d, h),
            "north":  (u + d, v + d, w, h),
            "west":   (u + d + w, v + d, d, h),
            "south":  (u + d + w + d, v + d, w, h),
        }
        for face, (x, y, fw, fh) in faces.items():
            rects.append([x, y, fw, fh, _shade(color, face)])

    # detalhes pintados por cima: a cara da mascara
    mask = placements[1]
    mx, my = mask[0] + 2, mask[1] + 2  # face north da placa da mascara
    rects.append([mx + 1, my, 1, 6, "red"])
    rects.append([mx + 6, my, 1, 6, "red"])
    rects.append([mx + 2, my + 1, 4, 1, "red"])
    rects.append([mx + 2, my + 2, 2, 2, "black_deep"])
    rects.append([mx + 4, my + 2, 2, 2, "black_deep"])
    for tooth in range(0, 8, 2):
        rects.append([mx + tooth, my + 5, 1, 1, "black_deep"])

    return rects


TEXTURE_SPEC = {
    "size": (TEXTURE_SIZE, TEXTURE_SIZE),
    "palette": PALETTE,
    "rects": build_texture_rects(),
}
