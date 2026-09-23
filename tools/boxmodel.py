"""
Modelo de caixas do Bedrock descrito por codigo: o mesmo dado gera a geometria
(.geo.json) e a textura (retangulos pro gen_textures), com o UV empacotado por
shelf packing. Usado pelo clone do Aizen e pela Daiguren do Hitsugaya.

Regras (as mesmas que o hollow_model.py aprendeu no jogo):
- tamanho de caixa e INTEIRO: o UV segue o tamanho real da caixa, e fracao de
  pixel desloca tudo que for pintado nela;
- origin e em espaco de MODELO, nao relativo ao osso (o pivo do osso so define
  o centro de rotacao).
"""
from __future__ import annotations

# rig do player (geometry.humanoid.custom): attachable casa osso por NOME com
# ele, e osso no pai errado nao acompanha a animacao - sem erro nenhum no jogo
PLAYER_RIG_BONES = {
    "root":     (None,    [0, 0, 0]),
    "waist":    ("root",  [0, 12, 0]),
    "body":     ("waist", [0, 24, 0]),
    "head":     ("body",  [0, 24, 0]),
    "rightArm": ("body",  [-5, 22, 0]),
    "leftArm":  ("body",  [5, 22, 0]),
    "rightLeg": ("root",  [-1.9, 12, 0]),
    "leftLeg":  ("root",  [1.9, 12, 0]),
}

FACE_SHADE = {
    "top": "", "bottom": "_deep", "north": "",
    "south": "_dark", "east": "_dark", "west": "_dark",
}


def faces(u, v, w, h, d):
    """as seis faces de um cubo no layout de UV do Bedrock (north = -Z)"""
    return {
        "top":    (u + d, v, w, d),
        "bottom": (u + d + w, v, w, d),
        "east":   (u, v + d, d, h),
        "north":  (u + d, v + d, w, h),
        "west":   (u + d + w, v + d, d, h),
        "south":  (u + d + w + d, v + d, w, h),
    }


class BoxModel:
    """cubes: (osso, origin, size, cor, inflate); bones: nome -> (pai, pivot)"""

    def __init__(self, identifier, cubes, bones, palette, texture_size, bounds=(2, 3, 1.25)):
        self.identifier = identifier
        self.cubes = cubes
        self.bones = bones
        self.palette = palette
        self.texture_size = texture_size
        self.bounds = bounds
        for bone, _origin, size, color, _inflate in cubes:
            if bone not in bones:
                raise ValueError(f"{identifier}: caixa no osso inexistente '{bone}'")
            if color not in palette:
                raise ValueError(f"{identifier}: cor '{color}' fora da paleta")
            for value in size:
                if float(value) != int(value):
                    raise ValueError(
                        f"{identifier}/{bone}: tamanho de caixa tem que ser INTEIRO ({size})"
                    )

    def shade(self, color, face):
        suffix = FACE_SHADE[face]
        return color + suffix if suffix and color + suffix in self.palette else color

    def pack_uvs(self):
        placements = []
        x, y, row = 0, 0, 0
        for index, (_, _, size, _, _) in enumerate(self.cubes):
            w, h, d = size
            fw, fh = 2 * (w + d), h + d
            if x + fw > self.texture_size:
                x, y, row = 0, y + row, 0
            if y + fh > self.texture_size:
                raise ValueError(f"{self.identifier}: o atlas encheu na caixa {index}")
            placements.append((x, y))
            x += fw
            row = max(row, fh)
        return placements

    def face_rect(self, index, face):
        u, v = self.pack_uvs()[index]
        return faces(u, v, *self.cubes[index][2])[face]

    def build_geometry(self):
        by_bone = {name: [] for name in self.bones}
        for (bone, origin, size, _color, inflate), (u, v) in zip(self.cubes, self.pack_uvs()):
            cube = {"origin": origin, "size": size, "uv": [u, v]}
            if inflate:
                cube["inflate"] = inflate
            by_bone[bone].append(cube)
        bones = []
        for name, (parent, pivot) in self.bones.items():
            bone = {"name": name, "pivot": pivot}
            if parent:
                bone["parent"] = parent
            if by_bone[name]:
                bone["cubes"] = by_bone[name]
            bones.append(bone)
        width, height, offset = self.bounds
        return {
            "format_version": "1.12.0",
            "minecraft:geometry": [{
                "description": {
                    "identifier": self.identifier,
                    "texture_width": self.texture_size,
                    "texture_height": self.texture_size,
                    "visible_bounds_width": width,
                    "visible_bounds_height": height,
                    "visible_bounds_offset": [0, offset, 0],
                },
                "bones": bones,
            }],
        }

    def base_rects(self):
        rects = []
        for (_bone, _origin, size, color, _inflate), (u, v) in zip(self.cubes, self.pack_uvs()):
            for face, (x, y, fw, fh) in faces(u, v, *size).items():
                rects.append([x, y, fw, fh, self.shade(color, face)])
        return rects

    def texture_spec(self, rects):
        return {"size": (self.texture_size, self.texture_size), "palette": self.palette, "rects": rects}
