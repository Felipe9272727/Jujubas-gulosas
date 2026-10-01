"""
As coisas do Yukio que viram entidade, em modelo de caixa:

    geometry.yukio_barril    o barril do Donkey Kong (deitado, rola no eixo X)
    geometry.yukio_cogumelo  o Super Cogumelo vermelho do Mario
    geometry.yukio_pacman    o Pac-Man voxel do filme Pixels (duas metades: a
                             de cima abre e fecha a boca)

E a textura do clone digital, no layout de skin 64x64 do
geometry.humanoid.custom (o modelo do player): não dá pra copiar a skin de
quem está jogando numa entidade, então o clone tem a cara do Yukio com as
linhas de varredura de tela por cima.

Tudo em pixel (16 = 1 bloco); a client entity escala o resto.
"""
from __future__ import annotations

import math

from boxmodel import BoxModel

# ---------------------------------------------------------------------------
# barril
# ---------------------------------------------------------------------------
BARRIL_PALETTE = {
    "wood":       (176, 104, 46, 255),
    "wood_dark":  (138, 78, 32, 255),
    "wood_deep":  (104, 58, 24, 255),
    "band":       (60, 52, 50, 255),
    "band_dark":  (40, 34, 32, 255),
    "band_deep":  (28, 24, 22, 255),
    "line":       (120, 68, 28, 255),
}

# o pivo fica no centro do barril (y 6): a animação gira em volta do eixo X
BARRIL = [
    ("rolo", [-7, 1, -4], [14, 10, 8], "wood", 0.0),
    ("rolo", [-7, 2, -5], [14, 8, 10], "wood", 0.0),
    ("rolo", [-6, 0, -3], [12, 12, 6], "wood", 0.0),
    ("rolo", [-6, 3, -6], [12, 6, 12], "wood", 0.0),
    # aros de ferro
    ("rolo", [-5, 0, -3], [1, 12, 6], "band", 0.2),
    ("rolo", [-5, 3, -6], [1, 6, 12], "band", 0.2),
    ("rolo", [4, 0, -3], [1, 12, 6], "band", 0.2),
    ("rolo", [4, 3, -6], [1, 6, 12], "band", 0.2),
]

# ---------------------------------------------------------------------------
# cogumelo
# ---------------------------------------------------------------------------
COGUMELO_PALETTE = {
    "cap":        (226, 36, 30, 255),
    "cap_dark":   (186, 24, 22, 255),
    "cap_deep":   (140, 16, 16, 255),
    "spot":       (250, 250, 246, 255),
    "spot_dark":  (222, 222, 216, 255),
    "stem":       (246, 222, 176, 255),
    "stem_dark":  (222, 194, 146, 255),
    "stem_deep":  (196, 166, 120, 255),
    "eye":        (20, 20, 24, 255),
}

COGUMELO = [
    ("root", [-3, 0, -3], [6, 6, 6], "stem", 0.0),
    ("root", [-1.8, 2, -3.2], [1, 3, 1], "eye", 0.0),
    ("root", [0.8, 2, -3.2], [1, 3, 1], "eye", 0.0),
    ("root", [-6, 6, -6], [12, 3, 12], "cap", 0.0),
    ("root", [-5, 9, -5], [10, 2, 10], "cap", 0.0),
    ("root", [-3, 11, -3], [6, 1, 6], "cap", 0.0),
    # as pintas brancas: frente, lados, trás e em cima
    ("root", [-2, 7, -6.3], [4, 3, 1], "spot", 0.0),
    ("root", [-6.3, 7, -1.5], [1, 3, 3], "spot", 0.0),
    ("root", [5.3, 7, -1.5], [1, 3, 3], "spot", 0.0),
    ("root", [-2, 7, 5.3], [4, 3, 1], "spot", 0.0),
    ("root", [-1.5, 11.3, -1.5], [3, 1, 3], "spot", 0.0),
]

# ---------------------------------------------------------------------------
# Pac-Man (bola voxel de raio 8, a boca virada pra -Z)
# ---------------------------------------------------------------------------
PACMAN_PALETTE = {
    "yellow":      (255, 226, 40, 255),
    "yellow_dark": (236, 196, 20, 255),
    "yellow_deep": (60, 20, 10, 255),   # o lado de baixo da metade de cima: o céu da boca
    "mouth":       (70, 20, 12, 255),
    "eye":         (16, 16, 20, 255),
}


def _pacman():
    cubes = []
    radius = 8
    # fatias de 2 pixels: cada uma é um quadrado inscrito no círculo daquela altura
    for y0 in range(0, radius, 2):
        y_mid = y0 + 1
        r = int(round(math.sqrt(radius * radius - y_mid * y_mid)))
        if r <= 0:
            continue
        cubes.append(("cima", [-r, 8 + y0, -r], [2 * r, 2, 2 * r], "yellow", 0.0))
        cubes.append(("baixo", [-r, 8 - y0 - 2, -r], [2 * r, 2, 2 * r], "yellow", 0.0))
    # chão da boca (o lado de cima da metade de baixo)
    cubes.append(("baixo", [-7, 7, -7], [14, 1, 13], "mouth", 0.0))
    # olhos
    cubes.append(("cima", [-6, 11, -7.5], [2, 3, 1], "eye", 0.0))
    cubes.append(("cima", [4, 11, -7.5], [2, 3, 1], "eye", 0.0))
    return cubes


PACMAN = _pacman()

MODELS = {
    "yukio_barril": BoxModel("geometry.yukio_barril", BARRIL, {"rolo": (None, [0, 6, 0])}, BARRIL_PALETTE, 128, bounds=(2, 2, 0.5)),
    "yukio_cogumelo": BoxModel("geometry.yukio_cogumelo", COGUMELO, {"root": (None, [0, 0, 0])}, COGUMELO_PALETTE, 128, bounds=(2, 2, 0.5)),
    "yukio_pacman": BoxModel(
        "geometry.yukio_pacman",
        PACMAN,
        {"baixo": (None, [0, 8, 6]), "cima": (None, [0, 8, 6])},
        PACMAN_PALETTE,
        128,
        bounds=(8, 8, 4),
    ),
}


def _details(name, model):
    rects = model.base_rects()
    if name == "yukio_barril":
        for index, (_bone, _o, _size, color, _i) in enumerate(model.cubes):
            if not color.startswith("wood"):
                continue
            for face in ("north", "south", "top", "bottom"):
                x, y, fw, fh = model.face_rect(index, face)
                # tábuas: risco a cada 3 pixels ao longo do barril
                for row in range(1, fh, 3):
                    rects.append([x, y + row, fw, 1, "line"])
    return rects


# ---------------------------------------------------------------------------
# clone: skin 64x64 do Yukio (cabelo loiro, casaco escuro de gola branca,
# calça cinza) com linhas de varredura ciano por cima
# ---------------------------------------------------------------------------
CLONE_PALETTE = {
    "skin":   (240, 206, 178, 255),
    "skin2":  (222, 186, 156, 255),
    "hair":   (236, 200, 96, 255),
    "hair2":  (206, 164, 64, 255),
    "eye":    (40, 110, 190, 255),
    "white":  (238, 240, 244, 255),
    "coat":   (34, 36, 44, 255),
    "coat2":  (24, 26, 32, 255),
    "pants":  (78, 80, 92, 255),
    "shoe":   (20, 20, 24, 255),
    "scan":   (90, 230, 255, 255),
    "game":   (120, 120, 140, 255),
}


def _face(u, v, w, h, d):
    """retangulos das 6 faces no layout de skin (mesmo do boxmodel.faces)"""
    return {
        "top": (u + d, v, w, d),
        "bottom": (u + d + w, v, w, d),
        "right": (u, v + d, d, h),
        "front": (u + d, v + d, w, h),
        "left": (u + d + w, v + d, d, h),
        "back": (u + d + w + d, v + d, w, h),
    }


def _fill(rects, faces, color, which=None):
    for name, (x, y, w, h) in faces.items():
        if which and name not in which:
            continue
        rects.append([x, y, w, h, color])


def _clone_rects():
    rects = []
    head = _face(0, 0, 8, 8, 8)
    _fill(rects, head, "skin")
    _fill(rects, head, "hair", ("top", "back"))
    for side in ("right", "left"):
        x, y, w, h = head[side]
        rects.append([x, y, w, 4, "hair"])
    fx, fy, _, _ = head["front"]
    rects += [
        [fx, fy, 8, 2, "hair"],            # franja
        [fx, fy + 2, 1, 2, "hair2"],
        [fx + 7, fy + 2, 1, 2, "hair2"],
        [fx + 3, fy + 2, 2, 1, "hair2"],
        [fx + 1, fy + 4, 2, 1, "white"],   # olhos
        [fx + 2, fy + 4, 1, 1, "eye"],
        [fx + 5, fy + 4, 2, 1, "white"],
        [fx + 5, fy + 4, 1, 1, "eye"],
        [fx + 3, fy + 6, 2, 1, "skin2"],   # boca
    ]
    body = _face(16, 16, 8, 12, 4)
    _fill(rects, body, "coat")
    bx, by, _, _ = body["front"]
    rects += [
        [bx + 2, by, 4, 2, "white"],       # gola branca
        [bx + 3, by + 2, 2, 10, "coat2"],  # zíper
        [bx + 1, by + 6, 3, 3, "game"],    # o videogame na mão/peito
    ]
    for u, v in ((40, 16), (32, 48)):      # braços (direito e esquerdo)
        arm = _face(u, v, 4, 12, 4)
        _fill(rects, arm, "coat")
        for name in ("front", "back", "right", "left"):
            x, y, w, h = arm[name]
            rects.append([x, y + 9, w, 3, "skin"])  # mão
            rects.append([x, y + 8, w, 1, "white"])  # punho
    for u, v in ((0, 16), (16, 48)):       # pernas
        leg = _face(u, v, 4, 12, 4)
        _fill(rects, leg, "pants")
        for name in ("front", "back", "right", "left"):
            x, y, w, h = leg[name]
            rects.append([x, y + 10, w, 2, "shoe"])
    # linhas de varredura de tela (o "digital") no corpo, braços e pernas. Só
    # nas regiões da camada de baixo: a de cima (casaco/chapéu) fica vazia, senão
    # as linhas flutuariam em volta do clone
    for x0, y0, w, h in ((0, 16, 56, 16), (16, 48, 32, 16)):
        for y in range(y0 + 1, y0 + h, 4):
            rects.append([x0, y, w, 1, "scan"])
    return rects


CLONE_TEXTURE = {"size": (64, 64), "palette": CLONE_PALETTE, "rects": _clone_rects()}


def geometry_builders():
    return {name: model.build_geometry for name, model in MODELS.items()}


TEXTURE_SPECS = {name: model.texture_spec(_details(name, model)) for name, model in MODELS.items()}
TEXTURE_SPECS["yukio_clone"] = CLONE_TEXTURE
