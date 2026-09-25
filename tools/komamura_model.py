"""
Myō'ō, o gigante do Sajin Komamura, em quatro modelos de caixa:

    geometry.komamura_braco   braço direito de samurai segurando a katana
                              (m1 a cada 3 golpes, Barrage, Destructive Slash)
    geometry.komamura_punho   o mesmo braço de punho fechado (Ora Ora Ora, Punch)
    geometry.komamura_guarda  os dois braços fechados em volta dele (Giant's Shield)
    geometry.komamura_myoo    a armadura de samurai do Bankai, num peitoral
                              (attachable no rig do player, que o marcador da
                              offhand escala até o tamanho do gigante)

Os três primeiros são entidades próprias com UM osso ("ombro" ou "root"): o
script só nasce, posiciona e remove; o movimento é a animação do RP.
Convenção do braço: o ombro fica na origem e o braço aponta pra -Z (a frente
da entidade). Tudo em pixel (16 = 1 bloco); a client entity escala o resto.
"""
from __future__ import annotations

from boxmodel import PLAYER_RIG_BONES, BoxModel

PALETTE = {
    "armor":       (30, 32, 40, 255),
    "armor_dark":  (20, 21, 28, 255),
    "armor_deep":  (12, 12, 17, 255),
    "gold":        (206, 164, 62, 255),
    "gold_dark":   (160, 122, 40, 255),
    "gold_deep":   (118, 88, 26, 255),
    "red":         (150, 30, 30, 255),
    "red_dark":    (110, 20, 20, 255),
    "steel":       (214, 218, 228, 255),
    "steel_dark":  (160, 166, 180, 255),
    "steel_deep":  (120, 126, 140, 255),
    "wrap":        (54, 40, 70, 255),
    "eye":         (255, 190, 60, 255),
}

ARM_BONES = {"ombro": (None, [0, 0, 0])}


def _arm_base():
    """ombro, braço, cotovelo e antebraço blindados apontando pra -Z"""
    return [
        ("ombro", [-8, -6, -6], [16, 12, 12], "armor", 0.0),        # ombro
        ("ombro", [-9, 4, -7], [18, 3, 14], "gold", 0.0),           # placa do ombro
        ("ombro", [-10, -6, -7], [2, 10, 14], "armor_dark", 0.0),   # sode (placa lateral)
        ("ombro", [-6, -5, -24], [12, 10, 18], "armor_dark", 0.0),  # braço
        ("ombro", [-7, -6, -29], [14, 12, 5], "gold", 0.0),         # cotovelo
        ("ombro", [-6, -5, -45], [12, 10, 16], "armor", 0.0),       # antebraço (kote)
        ("ombro", [-6.5, -5.5, -40], [13, 11, 2], "red", 0.0),      # cordão
    ]


BRACO = _arm_base() + [
    ("ombro", [-7, -7, -53], [14, 14, 8], "armor_dark", 0.0),       # mão fechada no cabo
    ("ombro", [-2, -2, -57], [4, 4, 4], "wrap", 0.0),               # cabo
    ("ombro", [-5, -5, -58], [10, 10, 1], "gold", 0.0),             # tsuba
    ("ombro", [-1, -3, -110], [2, 6, 52], "steel", 0.0),            # lâmina
    ("ombro", [-1, -2, -115], [2, 4, 5], "steel", 0.0),             # ponta
    ("ombro", [-1, 2, -110], [2, 1, 52], "steel_dark", 0.0),        # costas da lâmina
]

PUNHO = _arm_base() + [
    ("ombro", [-9, -9, -57], [18, 18, 12], "armor_dark", 0.0),      # punho fechado
    ("ombro", [-9.5, -6, -58], [19, 8, 2], "gold", 0.0),            # placa dos nós
]


def _guard_arm(side):
    """side=+1 braço esquerdo (+X), -1 direito: sai das costas e fecha na frente"""
    parts = [
        ([12, 6, 4], [10, 10, 10], "armor"),       # ombro atrás
        ([13, 7, -14], [8, 8, 18], "armor_dark"),  # braço indo pra frente
        ([12, 6, -18], [10, 10, 4], "gold"),       # cotovelo
        ([0, 7, -24], [14, 8, 8], "armor"),        # antebraço fechando pra dentro
        ([-3, 5, -27], [6, 12, 12], "armor_dark"), # mão
    ]
    cubes = []
    for origin, size, color in parts:
        x = origin[0] if side > 0 else -(origin[0] + size[0])
        cubes.append(("root", [x, origin[1], origin[2]], size, color, 0.0))
    return cubes


GUARDA = _guard_arm(+1) + _guard_arm(-1)

# armadura do Bankai no rig do player: kabuto com o crescente dourado, máscara
# fechada de olhos acesos, peitoral, sode, kusazuri (a saia de placas) e caneleiras
MYOO = [
    ("head", [-4, 24, -4], [8, 8, 8], "armor", 0.5),               # elmo fechado
    ("head", [-5, 31, -5], [10, 2, 10], "armor_dark", 0.0),        # copa
    ("head", [-6, 25, -3], [12, 3, 8], "armor_dark", 0.0),         # shikoro (proteção da nuca)
    ("head", [-4, 32, -5.8], [1, 6, 1], "gold", 0.0),              # crescente esquerdo
    ("head", [3, 32, -5.8], [1, 6, 1], "gold", 0.0),               # crescente direito
    ("head", [-1, 31, -5.8], [2, 3, 1], "gold", 0.0),              # centro do crescente
    ("head", [-4, 24.5, -4.9], [8, 3, 1], "armor_deep", 0.0),      # máscara (boca)
    ("head", [-3, 28, -4.9], [2, 1, 1], "eye", 0.0),               # olho
    ("head", [1, 28, -4.9], [2, 1, 1], "eye", 0.0),                # olho
    ("body", [-4, 12, -2], [8, 12, 4], "armor", 0.45),             # dō
    ("body", [-4, 17, -2], [8, 1, 4], "gold", 0.6),                # faixa dourada
    ("body", [-4, 21, -2], [8, 1, 4], "red", 0.6),                 # cordão
    ("body", [-5, 6, -3], [10, 6, 1], "armor_dark", 0.0),          # kusazuri frente
    ("body", [-5, 6, 2], [10, 6, 1], "armor_dark", 0.0),           # kusazuri trás
    ("body", [-5.5, 6, -2], [1, 6, 4], "armor_dark", 0.0),         # kusazuri lado
    ("body", [4.5, 6, -2], [1, 6, 4], "armor_dark", 0.0),          # kusazuri lado
    ("body", [-5, 11, -3.2], [10, 1, 1], "gold", 0.0),             # borda da saia
    ("rightArm", [-8, 12, -2], [4, 12, 4], "armor_dark", 0.3),     # manga
    ("rightArm", [-9.5, 17, -3], [5, 8, 6], "armor", 0.0),         # sode direito
    ("rightArm", [-9.6, 17, -3.1], [1, 1, 6], "gold", 0.0),
    ("leftArm", [4, 12, -2], [4, 12, 4], "armor_dark", 0.3),
    ("leftArm", [4.5, 17, -3], [5, 8, 6], "armor", 0.0),           # sode esquerdo
    ("leftArm", [8.6, 17, -3.1], [1, 1, 6], "gold", 0.0),
    ("rightLeg", [-3.9, 0, -2], [4, 12, 4], "armor_dark", 0.35),   # haidate/suneate
    ("rightLeg", [-4.2, 1, -2.6], [4, 5, 1], "gold_dark", 0.0),
    ("leftLeg", [-0.1, 0, -2], [4, 12, 4], "armor_dark", 0.35),
    ("leftLeg", [0.2, 1, -2.6], [4, 5, 1], "gold_dark", 0.0),
]

MODELS = {
    "komamura_braco": BoxModel("geometry.komamura_braco", BRACO, dict(ARM_BONES), PALETTE, 256, bounds=(16, 16, 0)),
    "komamura_punho": BoxModel("geometry.komamura_punho", PUNHO, dict(ARM_BONES), PALETTE, 128, bounds=(10, 10, 0)),
    "komamura_guarda": BoxModel("geometry.komamura_guarda", GUARDA, {"root": (None, [0, 0, 0])}, PALETTE, 128, bounds=(6, 4, 0.8)),
    "komamura_myoo": BoxModel("geometry.komamura_myoo", MYOO, dict(PLAYER_RIG_BONES), PALETTE, 128, bounds=(3, 3.5, 1.4)),
}


def _details(model):
    rects = model.base_rects()
    for index, (_bone, _origin, size, color, _inflate) in enumerate(model.cubes):
        if not color.startswith("armor"):
            continue
        for face in ("north", "south", "east", "west", "top"):
            x, y, fw, fh = model.face_rect(index, face)
            # laminas de armadura: faixas horizontais mais claras a cada 3 pixels
            for row in range(2, fh, 3):
                rects.append([x, y + row, fw, 1, "armor_dark" if color == "armor" else "armor"])
    return rects


def geometry_builders():
    return {name: model.build_geometry for name, model in MODELS.items()}


TEXTURE_SPECS = {name: model.texture_spec(_details(model)) for name, model in MODELS.items()}
