"""
Casaco da Tensa Zangetsu na versão Fullbring (Ichigo SF), attachable num
peitoral igual ao Mugetsu: o Bankai veste a peça e ela sai junto.

- casaco preto até o tornozelo, forro vermelho na borda da abertura e gola alta;
- peito aberto: a camisa de baixo aparece, com listras pretas;
- mangas pretas com listras brancas nos antebraços.

Player: frente em -Z, costas em +Z, lado direito em -X, cabeça em y 24..32,
corpo em 12..24, pernas em 0..12. A saia do casaco fica no osso do corpo
(cai reta, igual casaco longo), então as pernas passam por dentro dela.
"""
from __future__ import annotations

from boxmodel import PLAYER_RIG_BONES, BoxModel

TEXTURE_SIZE = 128
IDENTIFIER = "geometry.tensa_sf"

PALETTE = {
    "coat":        (22, 22, 26, 255),
    "coat_dark":   (15, 15, 18, 255),
    "coat_deep":   (9, 9, 11, 255),
    "lining":      (150, 24, 28, 255),
    "lining_dark": (110, 16, 20, 255),
    "shirt":       (226, 228, 234, 255),
    "shirt_dark":  (196, 198, 206, 255),
    "stripe":      (12, 12, 14, 255),
    "white":       (238, 240, 244, 255),
    "fold":        (34, 34, 40, 255),
}

BODY = [
    # camisa de baixo (aparece no peito aberto)
    ("body", [-4, 12, -2], [8, 12, 4], "shirt", 0.15),
    # costas e laterais do casaco
    ("body", [-4.5, 12, 2.2], [9, 12, 1], "coat", 0.2),
    ("body", [-4.8, 12, -2.4], [1, 12, 5], "coat", 0.2),
    ("body", [3.8, 12, -2.4], [1, 12, 5], "coat", 0.2),
    # as duas bandas da frente, abertas no meio
    ("body", [-4.6, 12, -2.8], [3, 12, 1], "coat", 0.0),
    ("body", [1.6, 12, -2.8], [3, 12, 1], "coat", 0.0),
    # forro vermelho na borda de cada banda
    ("body", [-1.7, 12, -2.9], [1, 12, 1], "lining", 0.0),
    ("body", [0.7, 12, -2.9], [1, 12, 1], "lining", 0.0),
    # gola alta
    ("body", [-4.6, 23, -2.9], [9, 3, 1], "coat", 0.0),
    ("body", [-4.6, 23, 2.4], [9, 3, 1], "coat", 0.0),
    ("body", [-4.9, 23, -2.9], [1, 3, 6], "coat", 0.0),
    ("body", [3.9, 23, -2.9], [1, 3, 6], "coat", 0.0),
    # a saia do casaco até o tornozelo: costas, lados e as duas abas da frente
    ("body", [-4.8, 0, 2.4], [10, 12, 1], "coat", 0.0),
    ("body", [-5.1, 0, -2.6], [1, 12, 5], "coat", 0.0),
    ("body", [4.1, 0, -2.6], [1, 12, 5], "coat", 0.0),
    ("body", [-4.8, 0, -3.0], [4, 12, 1], "coat", 0.0),
    ("body", [0.8, 0, -3.0], [4, 12, 1], "coat", 0.0),
    ("body", [-1.2, 1, -3.1], [1, 11, 1], "lining", 0.0),
    ("body", [0.2, 1, -3.1], [1, 11, 1], "lining", 0.0),
]

ARMS = [
    # mangas pretas
    ("rightArm", [-8, 12, -2], [4, 12, 4], "coat", 0.3),
    ("leftArm", [4, 12, -2], [4, 12, 4], "coat", 0.3),
    # punho da manga um pouco mais largo
    ("rightArm", [-8, 12, -2], [4, 2, 4], "coat", 0.5),
    ("leftArm", [4, 12, -2], [4, 2, 4], "coat", 0.5),
]

CUBES = BODY + ARMS

MODEL = BoxModel(IDENTIFIER, CUBES, dict(PLAYER_RIG_BONES), PALETTE, TEXTURE_SIZE, bounds=(3, 3.5, 1.4))


def build_geometry() -> dict:
    return MODEL.build_geometry()


def build_texture_rects():
    rects = MODEL.base_rects()
    for index, (bone, _origin, size, color, _inflate) in enumerate(CUBES):
        for face in ("north", "south", "east", "west"):
            x, y, fw, fh = MODEL.face_rect(index, face)
            if color == "shirt":
                # listras pretas na camisa do peito aberto
                for row in range(1, fh, 2):
                    rects.append([x, y + row, fw, 1, "stripe"])
            elif bone in ("rightArm", "leftArm") and fh >= 12:
                # antebraço (metade de baixo da manga): listras brancas
                for row in range(fh // 2 + 1, fh - 1, 2):
                    rects.append([x, y + row, fw, 1, "white"])
            elif color == "coat" and fh >= 12 and fw >= 3:
                # dobras verticais discretas no tecido
                for col in range(1, fw, 3):
                    rects.append([x + col, y, 1, fh, "fold"])
    return rects


TEXTURE_SPEC = MODEL.texture_spec(build_texture_rects())
