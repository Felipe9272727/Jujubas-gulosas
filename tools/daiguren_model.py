"""
Daiguren Hyorinmaru (Bankai do Hitsugaya): asas de gelo, cauda e o braco do
dragao, como attachable num peitoral - igual a Segunda Etapa do Ulquiorra.

Antes as asas e a cauda eram so particula (hitsugaya:gelo), redesenhada a cada
0,3s com uma textura quase toda transparente: fraco demais, e qualquer pack de
particula/shader apagava de vez. Aqui e geometria de verdade; as particulas
continuam por cima como geada.

O modelo NAO cobre corpo nem cabeca: a skin do player continua aparecendo e o
gelo nasce das costas, da cintura e do braco direito. Tudo e caixa alinhada aos
eixos (sem rotacao de osso), entao a posicao e exatamente o origin em espaco de
modelo. Player: costas em +Z, lado direito em -X, corpo de y 12 a 24.
"""
from __future__ import annotations

from boxmodel import PLAYER_RIG_BONES, BoxModel

TEXTURE_SIZE = 64
IDENTIFIER = "geometry.daiguren"

PALETTE = {
    "ice":        (196, 234, 252, 255),
    "ice_dark":   (132, 192, 236, 255),
    "ice_deep":   (82, 140, 204, 255),
    "shine":      (246, 252, 255, 255),
    "crack":      (104, 168, 222, 255),
}


def _wing(side):
    """asa direita (side=-1, lado -X) ou esquerda (+1): espelhada no X"""
    parts = [
        # osso da asa: escada subindo pra fora a partir da escapula
        ([-7, 20, 3], [5, 3, 1]),
        ([-11, 23, 3], [5, 3, 1]),
        ([-15, 26, 3], [5, 3, 1]),
        ([-18, 29, 3], [4, 2, 1]),
        # penas de gelo penduradas no osso
        ([-6, 11, 4], [3, 10, 1]),
        ([-10, 12, 4], [3, 12, 1]),
        ([-14, 14, 4], [3, 13, 1]),
        ([-17, 18, 4], [3, 11, 1]),
        # pontas afinando
        ([-5, 9, 4], [1, 2, 1]),
        ([-9, 10, 4], [1, 2, 1]),
        ([-13, 12, 4], [1, 2, 1]),
        ([-16, 16, 4], [1, 2, 1]),
    ]
    cubes = []
    for index, (origin, size) in enumerate(parts):
        x = origin[0] if side < 0 else -(origin[0] + size[0])
        color = "ice_dark" if index < 4 else "ice"
        cubes.append(("body", [x, origin[1], origin[2]], size, color, 0.0))
    return cubes


CUBES = (
    _wing(-1)
    + _wing(+1)
    + [
        # cauda: sai da base da coluna, desce e afina pra tras
        ("waist", [-1.5, 10, 2], [3, 3, 5], "ice_dark", 0.0),
        ("waist", [-1, 8, 6], [2, 3, 5], "ice", 0.0),
        ("waist", [-1, 6, 10], [2, 2, 5], "ice", 0.0),
        ("waist", [-0.5, 5, 14], [1, 2, 4], "ice", 0.0),
        # cristais em cima da cauda
        ("waist", [-0.5, 13, 3], [1, 2, 2], "shine", 0.0),
        ("waist", [-0.5, 11, 7], [1, 2, 2], "shine", 0.0),
        ("waist", [-0.5, 8, 11], [1, 2, 2], "shine", 0.0),
        # braco do dragao (direito): manga de gelo, ombreira e tres garras
        ("rightArm", [-8.5, 12, -2.5], [5, 6, 5], "ice_dark", 0.0),
        ("rightArm", [-9, 22, -1], [2, 3, 2], "ice", 0.0),
        ("rightArm", [-8, 9, -3], [1, 3, 1], "shine", 0.0),
        ("rightArm", [-6.5, 9, -3], [1, 3, 1], "shine", 0.0),
        ("rightArm", [-5, 9, -3], [1, 3, 1], "shine", 0.0),
    ]
)

MODEL = BoxModel(IDENTIFIER, CUBES, dict(PLAYER_RIG_BONES), PALETTE, TEXTURE_SIZE, bounds=(5, 4, 1.4))


def build_geometry() -> dict:
    return MODEL.build_geometry()


def build_texture_rects():
    rects = MODEL.base_rects()
    for index, (_bone, _origin, size, color, _inflate) in enumerate(CUBES):
        w, h, _d = size
        # veio de brilho e uma rachadura nas faces grandes (frente e costas)
        for face in ("north", "south"):
            x, y, fw, fh = MODEL.face_rect(index, face)
            if fh >= 6:
                rects.append([x + (fw // 2), y + 1, 1, fh - 2, "shine"])
            if fw >= 3 and fh >= 3:
                rects.append([x, y + fh - 1, fw, 1, "crack"])
    return rects


TEXTURE_SPEC = MODEL.texture_spec(build_texture_rects())
