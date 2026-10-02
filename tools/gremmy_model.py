"""
O que o Gremmy imagina e vira entidade, em modelo de caixa:

    geometry.gremmy_ak47     a AK-47 (Bullet Barrage), cano pra -Z
    geometry.gremmy_missil   o míssil do m1 (a cada 4 acertos), ponta pra -Z
    geometry.gremmy_meteoro  a rocha do Meteoro (a client entity escala 14x)

E a skin do clone (layout 64x64 do geometry.humanoid.custom): cabelo loiro
bagunçado, olhos vermelhos, o sobretudo branco de Sternritter com capuz e gola
alta, cinto e botas pretas.

Tudo em pixel (16 = 1 bloco).
"""
from __future__ import annotations

from boxmodel import BoxModel
from yukio_model import _face, _fill

# ---------------------------------------------------------------------------
# AK-47
# ---------------------------------------------------------------------------
AK_PALETTE = {
    "metal":      (52, 54, 60, 255),
    "metal_dark": (36, 38, 42, 255),
    "metal_deep": (24, 25, 28, 255),
    "wood":       (150, 86, 40, 255),
    "wood_dark":  (118, 64, 28, 255),
    "wood_deep":  (90, 48, 20, 255),
    "mag":        (180, 92, 30, 255),
    "mag_dark":   (140, 70, 22, 255),
}

AK47 = [
    ("root", [-1, 8, -6], [2, 3, 12], "metal", 0.0),     # caixa da culatra
    ("root", [-1, 7, 6], [2, 3, 6], "wood", 0.0),        # coronha
    ("root", [-1, 5, 10], [2, 2, 2], "wood", 0.0),       # fim da coronha
    ("root", [-1, 8, -11], [2, 2, 5], "wood", 0.0),      # guarda-mão
    ("root", [-0.5, 9, -18], [1, 1, 7], "metal_dark", 0.0),  # cano
    ("root", [-0.5, 10, -16], [1, 1, 1], "metal_dark", 0.0), # massa de mira
    ("root", [-1, 5, 1], [2, 3, 2], "wood", 0.0),        # empunhadura
    ("root", [-1, 5, -4], [2, 3, 2], "mag", 0.0),        # carregador curvo
    ("root", [-1, 3, -5], [2, 2, 2], "mag", 0.0),
    ("root", [-1, 2, -6], [2, 1, 2], "mag", 0.0),
]

# ---------------------------------------------------------------------------
# míssil
# ---------------------------------------------------------------------------
MISSIL_PALETTE = {
    "body":      (210, 214, 220, 255),
    "body_dark": (170, 174, 182, 255),
    "body_deep": (130, 134, 142, 255),
    "tip":       (200, 40, 34, 255),
    "tip_dark":  (150, 28, 24, 255),
    "fin":       (60, 64, 72, 255),
    "fin_dark":  (40, 44, 50, 255),
    "jet":       (255, 170, 60, 255),
}

MISSIL = [
    ("root", [-2, 6, -7], [4, 4, 13], "body", 0.0),
    ("root", [-1.5, 6.5, -10], [3, 3, 3], "tip", 0.0),
    ("root", [-1, 7, -12], [2, 2, 2], "tip", 0.0),
    ("root", [-4, 7.5, 3], [8, 1, 3], "fin", 0.0),
    ("root", [-0.5, 4, 3], [1, 8, 3], "fin", 0.0),
    ("root", [-1.5, 6.5, 6], [3, 3, 1], "jet", 0.0),
]

# ---------------------------------------------------------------------------
# meteoro (uma bola de rocha irregular com rachaduras de lava)
# ---------------------------------------------------------------------------
METEORO_PALETTE = {
    "rock":       (92, 74, 64, 255),
    "rock_dark":  (70, 56, 48, 255),
    "rock_deep":  (255, 110, 30, 255),   # a face de baixo (a que vem na frente) em brasa
    "lava":       (255, 150, 40, 255),
    "crack":      (220, 70, 20, 255),
}

METEORO = [
    ("root", [-6, 2, -6], [12, 12, 12], "rock", 0.0),
    ("root", [-8, 5, -4], [16, 7, 8], "rock", 0.0),
    ("root", [-4, 0, -5], [8, 16, 9], "rock", 0.0),
    ("root", [-5, 4, -8], [9, 8, 16], "rock", 0.0),
    ("root", [3, 9, 2], [4, 4, 4], "rock", 0.0),
    ("root", [-7, 3, 1], [4, 4, 4], "rock", 0.0),
]

MODELS = {
    "gremmy_ak47": BoxModel("geometry.gremmy_ak47", AK47, {"root": (None, [0, 8, 0])}, AK_PALETTE, 64, bounds=(2, 2, 0.5)),
    "gremmy_missil": BoxModel("geometry.gremmy_missil", MISSIL, {"root": (None, [0, 8, 0])}, MISSIL_PALETTE, 64, bounds=(2, 2, 0.5)),
    "gremmy_meteoro": BoxModel("geometry.gremmy_meteoro", METEORO, {"root": (None, [0, 8, 0])}, METEORO_PALETTE, 128, bounds=(40, 40, 8)),
}


def _details(name, model):
    rects = model.base_rects()
    if name == "gremmy_meteoro":
        for index, (_b, _o, _size, color, _i) in enumerate(model.cubes):
            for face in ("north", "south", "east", "west", "top"):
                x, y, fw, fh = model.face_rect(index, face)
                # rachaduras de lava em zigue-zague
                for k in range(0, fw, 4):
                    yy = (k * 7 + index * 3) % max(1, fh)
                    rects.append([x + k, y + yy, 2, 1, "crack"])
                    if yy + 1 < fh:
                        rects.append([x + k + 1, y + yy + 1, 1, 1, "lava"])
    return rects


# ---------------------------------------------------------------------------
# clone: skin 64x64 do Gremmy
# ---------------------------------------------------------------------------
CLONE_PALETTE = {
    "skin":   (246, 222, 200, 255),
    "skin2":  (226, 198, 176, 255),
    "hair":   (246, 214, 110, 255),
    "hair2":  (214, 176, 70, 255),
    "eye":    (200, 30, 40, 255),
    "white":  (240, 242, 246, 255),
    "white2": (210, 214, 222, 255),
    "black":  (26, 26, 32, 255),
    "blue":   (90, 130, 200, 255),
}


def _clone_rects():
    rects = []
    head = _face(0, 0, 8, 8, 8)
    _fill(rects, head, "skin")
    _fill(rects, head, "hair", ("top", "back"))
    for side in ("right", "left"):
        x, y, w, h = head[side]
        rects.append([x, y, w, 5, "hair"])
        rects.append([x + 1, y + 5, 2, 1, "hair2"])
    fx, fy, _, _ = head["front"]
    rects += [
        [fx, fy, 8, 2, "hair"],             # franja bagunçada
        [fx + 1, fy + 2, 2, 1, "hair2"],
        [fx + 5, fy + 2, 1, 1, "hair2"],
        [fx + 7, fy + 2, 1, 2, "hair"],
        [fx, fy + 2, 1, 2, "hair"],
        [fx + 1, fy + 4, 2, 1, "white"],    # olhos vermelhos
        [fx + 2, fy + 4, 1, 1, "eye"],
        [fx + 5, fy + 4, 2, 1, "white"],
        [fx + 5, fy + 4, 1, 1, "eye"],
        [fx + 3, fy + 6, 2, 1, "skin2"],
    ]
    # capuz (camada de cima da cabeça): só a parte de trás e os lados
    hood = _face(32, 0, 8, 8, 8)
    _fill(rects, hood, "white", ("back", "top"))
    for side in ("right", "left"):
        x, y, w, h = hood[side]
        rects.append([x + 4, y, 4, h, "white"])
    body = _face(16, 16, 8, 12, 4)
    _fill(rects, body, "white")
    bx, by, _, _ = body["front"]
    rects += [
        [bx + 1, by, 6, 2, "white2"],       # gola alta
        [bx + 3, by + 2, 2, 10, "white2"],  # abertura do sobretudo
        [bx, by + 7, 8, 1, "black"],        # cinto
        [bx + 3, by + 3, 2, 2, "blue"],     # a cruz Quincy no peito
    ]
    for u, v in ((40, 16), (32, 48)):       # mangas brancas, luva preta
        arm = _face(u, v, 4, 12, 4)
        _fill(rects, arm, "white")
        for name in ("front", "back", "right", "left"):
            x, y, w, h = arm[name]
            rects.append([x, y + 10, w, 2, "black"])
    for u, v in ((0, 16), (16, 48)):        # calça branca, bota preta
        leg = _face(u, v, 4, 12, 4)
        _fill(rects, leg, "white2")
        for name in ("front", "back", "right", "left"):
            x, y, w, h = leg[name]
            rects.append([x, y + 8, w, 4, "black"])
    return rects


CLONE_TEXTURE = {"size": (64, 64), "palette": CLONE_PALETTE, "rects": _clone_rects()}


def geometry_builders():
    return {name: model.build_geometry for name, model in MODELS.items()}


TEXTURE_SPECS = {name: model.texture_spec(_details(name, model)) for name, model in MODELS.items()}
TEXTURE_SPECS["gremmy_clone"] = CLONE_TEXTURE
