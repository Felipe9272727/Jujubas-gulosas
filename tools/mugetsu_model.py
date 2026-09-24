"""
Mugetsu (o Getsuga Tenshou Final do Ichigo Dangai): cabelo preto comprido ate
o meio das pernas, pano cobrindo a boca, faixas pretas enroladas no peito e no
braco direito (com duas pontas soltas balancando do pulso) e a hakama preta
rasgada. Attachable num peitoral, igual a Hollowficacao do Vizard: o super
veste a peca, e ela sai junto com o personagem 5s depois.

Tudo e caixa alinhada aos eixos (sem rotacao de osso), entao a posicao e o
origin em espaco de modelo. Player: frente em -Z, costas em +Z, lado direito
em -X, cabeca em y 24..32, corpo em 12..24, pernas em 0..12.
"""
from __future__ import annotations

from boxmodel import PLAYER_RIG_BONES, BoxModel

TEXTURE_SIZE = 128
IDENTIFIER = "geometry.mugetsu"

PALETTE = {
    "hair":       (16, 16, 20, 255),
    "hair_dark":  (9, 9, 12, 255),
    "hair_deep":  (5, 5, 7, 255),
    "gleam":      (52, 60, 88, 255),
    "cloth":      (30, 30, 34, 255),
    "cloth_dark": (21, 21, 25, 255),
    "cloth_deep": (13, 13, 16, 255),
    "band":       (40, 38, 44, 255),
    "band_dark":  (27, 26, 30, 255),
    "band_deep":  (17, 16, 19, 255),
    "line":       (50, 49, 56, 255),
}

HEAD = [
    # cabelo: topo, nuca, lados e franja picada caindo na testa
    ("head", [-4.5, 31, -4.5], [9, 2, 9], "hair", 0.0),
    ("head", [-4.5, 24, 3.5], [9, 8, 1], "hair", 0.0),
    ("head", [-4.5, 25, -3.5], [1, 7, 8], "hair", 0.0),
    ("head", [3.5, 25, -3.5], [1, 7, 8], "hair", 0.0),
    ("head", [-4.5, 29, -4.6], [9, 2, 1], "hair", 0.0),
    ("head", [-3.5, 27, -4.7], [1, 2, 1], "hair", 0.0),
    ("head", [-1, 27.5, -4.7], [1, 2, 1], "hair", 0.0),
    ("head", [2, 27, -4.7], [1, 2, 1], "hair", 0.0),
    # o pano preto que cobre a boca
    ("head", [-4, 24, -4.6], [8, 3, 1], "cloth", 0.2),
]

BODY = [
    # o cabelo comprido descendo pelas costas ate o meio das pernas
    ("body", [-4.5, 6, 2.2], [9, 18, 1], "hair", 0.0),
    ("body", [-3.5, 3, 2.2], [7, 3, 1], "hair", 0.0),
    ("body", [-2, 1, 2.2], [4, 2, 1], "hair_dark", 0.0),
    # tronco enrolado em faixas + a faixa grossa da cintura
    ("body", [-4, 12, -2], [8, 12, 4], "cloth_dark", 0.28),
    ("body", [-4, 12, -2], [8, 2, 4], "band", 0.45),
] + [
    # faixa diagonal no peito, do ombro direito ate o quadril esquerdo
    ("body", [-4 + i * 1.15, 22 - i * 1.3, -2.8], [2, 1, 1], "band", 0.0)
    for i in range(7)
]

ARMS = [
    # braco direito todo enfaixado, duas voltas grossas e duas pontas soltas
    ("rightArm", [-8, 12, -2], [4, 12, 4], "cloth", 0.3),
    ("rightArm", [-8, 14, -2], [4, 1, 4], "band", 0.5),
    ("rightArm", [-8, 19, -2], [4, 1, 4], "band", 0.5),
    ("rightArm", [-7.5, 5, 0.5], [1, 7, 1], "band", 0.0),
    ("rightArm", [-5.5, 7, -1.5], [1, 5, 1], "band_dark", 0.0),
    # braco esquerdo: manga rasgada no alto e uma volta no antebraco
    ("leftArm", [4, 17, -2], [4, 7, 4], "cloth_dark", 0.3),
    ("leftArm", [4, 13, -2], [4, 1, 4], "band", 0.45),
]

LEGS = [
    # hakama preta, rasgada na barra
    ("rightLeg", [-3.9, 1, -2], [4, 11, 4], "cloth", 0.32),
    ("leftLeg", [-0.1, 1, -2], [4, 11, 4], "cloth", 0.32),
    ("rightLeg", [-3.6, 0, -2.4], [1, 1, 1], "cloth_dark", 0.0),
    ("rightLeg", [-1.4, 0, 1.4], [1, 1, 1], "cloth_dark", 0.0),
    ("leftLeg", [0.4, 0, 1.4], [1, 1, 1], "cloth_dark", 0.0),
    ("leftLeg", [2.6, 0, -2.4], [1, 1, 1], "cloth_dark", 0.0),
]

CUBES = HEAD + BODY + ARMS + LEGS

MODEL = BoxModel(IDENTIFIER, CUBES, dict(PLAYER_RIG_BONES), PALETTE, TEXTURE_SIZE, bounds=(3, 3.5, 1.4))


def build_geometry() -> dict:
    return MODEL.build_geometry()


def build_texture_rects():
    rects = MODEL.base_rects()
    for index, (bone, _origin, size, color, _inflate) in enumerate(CUBES):
        for face in ("north", "south", "east", "west"):
            x, y, fw, fh = MODEL.face_rect(index, face)
            if color.startswith("hair") and fh >= 4:
                # mechas: riscos verticais escuros; um brilho azulado so na cabeca
                for col in range(0, fw, 2):
                    rects.append([x + col, y, 1, fh, "hair_deep"])
                if bone == "head" and fw >= 5:
                    rects.append([x + fw // 2 + 1, y + 1, 1, 2, "gleam"])
            elif bone in ("body", "rightArm") and color.startswith("cloth") and fh >= 6:
                # faixas enroladas (so no peito e no braco direito): uma linha
                # discreta a cada 3 pixels, escorregando pra dar a volta torta
                for row in range(1, fh, 3):
                    shift = (row // 3) % 3
                    rects.append([x + shift, y + row, max(1, fw - 3), 1, "line"])
    return rects


TEXTURE_SPEC = MODEL.texture_spec(build_texture_rects())
