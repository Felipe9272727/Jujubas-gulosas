# Combates Multiversais

Addon de PvP pra Minecraft Bedrock (BP + RP) com personagens de multiversos
diferentes. Cada player escolhe um personagem num menu, ganha vida, itens e
skills próprias, e luta contra os outros.

Personagens atuais: **Ichigo Kurosaki (Shikai → Tensa Zangetsu)** e
**Byakuya Kuchiki (Shikai → Kageyoshi / Senkei)**.

## Layout

```
BP/                     behavior pack
  manifest.json
  items/*.json          um arquivo por item (format_version 1.26.40)
  scripts/main.js       TODO o gameplay (@minecraft/server 2.0 + server-ui)
RP/                     resource pack
  manifest.json
  particles/            partículas customizadas (sakura:leaf)
  textures/items/*.png  uma textura por item
  textures/item_texture.json
tools/
  textures.py           grids de caracteres + paletas = fonte das texturas
  gen_textures.py       renderiza os grids em PNG (upscale nearest 4x)
  validate.py           JSON, itens, texturas, manifests
  build.py              roda tudo e empacota o .mcaddon
sim/
  stubs/                @minecraft/server e @minecraft/server-ui falsos
  run.mjs               simulação completa do main.js fora do jogo
```

## Build

```bash
python3 tools/build.py          # valida, simula e gera dist/CombatesMultiversais.mcaddon
```

O build **falha de propósito** se qualquer etapa quebrar. As etapas também
rodam soltas:

```bash
python3 tools/validate.py                    # JSON, itens sem textura, manifests
node --check BP/scripts/main.js              # sintaxe
python3 tools/gen_textures.py --check        # texturas batem com os grids
node --import ./sim/register.mjs sim/run.mjs # simulação
```

### A simulação

`sim/` reimplementa o suficiente da API do Bedrock pra rodar o `main.js` no
Node: um scheduler de ticks de verdade (todo `runInterval`/`runTimeout` é
executado), entidades que ficam inválidas quando morrem, inventário, efeitos,
dynamic properties e formulários com resposta roteirizada.

O harness dispara todos os eventos (`playerSpawn`, `itemUse`,
`entityHitEntity`, `entitySpawn`, `playerLeave`), usa todas as skills dos dois
personagens, ativa awakening/máscara/Kageyoshi/Senkei, mata alvos no meio de um
DoT, simula reload do mundo e desconexão, e roda 2000 ticks livres no fim. São
122 checks — qualquer exceção em qualquer callback é capturada e reportada.

Foi assim que apareceram os bugs de cooldown pós-reload, a máscara que nunca
era removida e o buraco na contenção do Senkei.

## Sistemas genéricos (reaproveite em vez de duplicar)

| Sistema | O que faz |
|---|---|
| `CHARACTERS` | Registro de personagens: `id`, `name`, `health`, `items` (slot → item), e opcionalmente `awakening` (forma persistente) ou `superAttack` |
| `MELEE_WEAPONS` | Toda arma de m1: `baseDamage`, `particle`, `dot`, `awardsAwakening`, `onHit` — centraliza o hit corpo-a-corpo |
| `applyDot(entity, player, perSecond, totalSeconds)` | Dano por segundo (sangramento), limpa sozinho se o alvo morre |
| `dmgMultiplier(player)` | Multiplicador de dano por buff ativo (hoje só o Sakura's Coating, +20%) |
| `fireCrescentWave(player, opts)` | Onda em lua crescente de verdade (dois arcos de círculo), com raio/alcance/dano/partícula configuráveis |
| `damageNearbyEntities(...)` | Dano em área já com o multiplicador aplicado |
| `tryUseSkill(player, itemId)` | Cooldown + aviso de recarga + ganho de awakening |
| Dash universal | Agachar + pular, cooldown 4s, filtra knockback pra não confundir com pulo |

Balanceamento fica em `DAMAGE` e `SKILL_COOLDOWN_TICKS`, no topo do `main.js`.

### Cooldowns e o tick do mundo

`system.currentTick` **volta a zero quando o mundo recarrega**, mas dynamic
property não. Por isso todo prazo (cooldown de skill, dash, coating, máscara)
passa por `onCooldown()` / `readTickDeadline()`, que descartam stamp de sessão
anterior, e por `clearSessionTimers()` quando o player entra no mundo. Se for
guardar um novo prazo em tick absoluto, use esses helpers.

## Adicionar um personagem novo

1. **Registrar em `CHARACTERS`** (`BP/scripts/main.js`) com `id`, `name`,
   `health`, `items` (slots 0–4) e, se tiver, `awakening` ou `superAttack`.
   O slot 8 é sempre do seletor.
2. **Criar os itens** em `BP/items/<nome>.json` — copie um existente; o ícone é
   uma string `"namespace:item"`, e a arma de m1 leva `minecraft:damage` igual
   ao dano desejado **menos 1** (o jogo soma 1 de soco).
3. **Desenhar as texturas** em `tools/textures.py`: um grid de 16 linhas × 16
   caracteres mais uma paleta `char → (R, G, B, A)`, `.` = transparente.
   Rode `python3 tools/gen_textures.py`.
4. **Registrar as texturas** em `RP/textures/item_texture.json`.
5. **Ligar as skills**: um `case` no `switch` do `itemUse`, cooldown em
   `SKILL_COOLDOWN_TICKS`, nome em `SKILL_NAMES`, dano em `DAMAGE`, e a arma de
   m1 em `MELEE_WEAPONS`.
6. **Cobrir na simulação** (`sim/run.mjs`): um cenário que usa todas as skills
   e checa que causam dano.
7. `python3 tools/build.py`

O `validate.py` pega item sem textura, textura sem arquivo, item citado no
script sem definição no BP e ícone no formato antigo — rode antes de testar
no jogo.
