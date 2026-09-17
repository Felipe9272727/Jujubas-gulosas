# Bleach battlegrounds

Addon de PvP pra Minecraft Bedrock (BP + RP). Cada player escolhe um personagem
num menu, ganha vida, itens e skills próprias, e luta contra os outros.

O seletor é **separado por arcos**: ele mostra um arco por vez, e **agachar +
usar o seletor** passa pro próximo (dá a volta no último).

### Invasão à Soul Society

| Personagem | Vida | Awakening |
|---|---|---|
| **Ichigo Kurosaki** (Shikai) | 200 | Tensa Zangetsu (troca os 5 itens) + Máscara Hollow |
| **Byakuya Kuchiki** (Shikai) | 200 | Super ataque: Kageyoshi ou Senkei |
| **Zaraki Kenpachi** | 300 | Pressão (tapa-olho removido): burst + 50% de dano |
| **Mayuri Kurotsuchi** (Shikai) | 180 | Super ataque: Konjiki Ashisogi Jizō (Bankai) |

### Arrancar / Hueco Mundo

| Personagem | Vida | Awakening |
|---|---|---|
| **Grimmjow Jaegerjaquez** | 800 | Resurrección: La Pantera — "Mutile, Pantera" (1200 de vida, speed 5, regen 4) |
| **Ulquiorra Cifer** | 1600 | Resurrección: Murciélago — "Confine, Murciélago" (2000 de vida) |
| **Coyote Starkk** | 4000 | Resurrección: Los Lobos — "Kick About, Los Lobos" (alterna Starkk ↔ Lilynette) |
| **Yammy Llargo** | 1000 | Resurrección: Ira (10000 de vida, lento e pesado, cura 100 a cada 4s) |
| **Tier Harribel** | 2600 | Resurrección: Tiburón — "Reduce a cenizas, Tiburón" (3000 de vida) |
| **Barragan Louisenbairn** | 3000 | Resurrección: Arrogante — "Envelhece, Arrogante!" (mesma vida) |
| **Szayelaporro Granz** | 750 (752) | Resurrección: Fornicarás — "Sorva...Fornicarás" (1000, cura 40 a cada 6s) |

## Layout

```
BP/                     behavior pack
  manifest.json
  items/*.json          um arquivo por item (format_version 1.26.40)
  scripts/main.js       TODO o gameplay (@minecraft/server 2.0 + server-ui)
RP/                     resource pack
  manifest.json
  entity/               override do player (escala do modelo por Molang)
  particles/            partículas customizadas (sakura:leaf, mayuri:poison_fog, grimmjow:cero, ...)
  textures/items/*.png  uma textura por item
  textures/item_texture.json
tools/
  textures.py           grids de caracteres + paletas = fonte das texturas
  gen_textures.py       renderiza os grids em PNG (upscale nearest 4x)
  validate.py           JSON, itens, texturas, manifests, versões
  bump_version.py       sobe a versão dos packs e sincroniza as dependências
  build.py              roda tudo e empacota o .mcaddon
sim/
  stubs/                @minecraft/server e @minecraft/server-ui falsos
  run.mjs               simulação completa do main.js fora do jogo
```

## Build

```bash
python3 tools/build.py          # valida, simula e gera dist/BleachBattlegrounds.mcaddon
```

O build **falha de propósito** se qualquer etapa quebrar. As etapas também
rodam soltas:

```bash
python3 tools/validate.py                    # JSON, itens sem textura, manifests, versões
node --check BP/scripts/main.js              # sintaxe
python3 tools/gen_textures.py --check        # texturas batem com os grids
node --import ./sim/register.mjs sim/run.mjs # simulação
```

### Teto de vida do Bedrock

O Bedrock guarda o amplificador de efeito num **byte**: o máximo é 255. Como a
vida vem de `health_boost`, o teto real é **1044** (`20 + 256×4`). Pedir mais
que isso não dá erro visível — o efeito simplesmente **não aplica**, e o
personagem fica com a vida da forma anterior. Foi o que aconteceu com os 1200
do La Pantera.

Acima de 1044 a vida passa a ser **virtual**: o pool real fica no teto e
`healthScaleFor()` guarda a razão em `mv:health_scale`. Daí em diante:

- **todo** dano do addon passa por `dealDamage()`, que divide pela escala do
  alvo — "700 de dano" continua tirando 700 da vida que ele vê;
- a actionbar multiplica de volta, então o player enxerga o número configurado;
- comparações de vida (limiar da Máscara Hollow, golpe de desespero do
  Kenpachi) usam `virtualHealth()`.

O stub da simulação recusa `amplifier > 255`, então passar do teto quebra o
build em vez de virar bug silencioso no jogo.

O dano do m1 também passa pela escala: os itens de m1 têm
`minecraft:damage: 0` e o valor inteiro sai do script, via
`MELEE_WEAPONS[].baseDamage` → `dealDamage()`. (Sobra 1 de dano vanilla por
golpe, que é o soco base e não dá pra zerar — desprezível.)

### Player gigante (a forma Ira)

O Script API não tem setter de tamanho, e `minecraft:scale` no BP escalaria
**todo mundo**. O caminho que funciona é pelo **resource pack**: o client entity
do player tem `scripts.scale`, que aceita Molang e escala **só o modelo**.

`RP/entity/player.entity.json` é uma cópia do vanilla com uma linha trocada:

```json
"scale": "query.is_item_name_any('slot.weapon.offhand', 0, 'yammy:ira_marker') ? 5.208 : 0.9375"
```

O script trava um item invisível (`yammy:ira_marker`, textura 100% transparente)
na offhand enquanto a Ira está ativa — é o gatilho que o Molang lê. `0.9375` é a
escala vanilla e renderiza 1,8 bloco, então `5.208` dá **10 blocos**.

Duas consequências a saber:

- **A hitbox não muda.** `scripts.scale` é só visual; acertar o Yammy continua
  usando a caixa de 1,8 bloco. Mudar a hitbox exigiria `minecraft:scale` no BP,
  que pegaria todos os players.
- **Sobrescrever `player.entity.json` conflita** com qualquer outro addon que
  mexa no mesmo arquivo, e pode ficar defasado quando a Mojang atualizar o
  arquivo vanilla. O `validate.py` confere que as chaves principais do vanilla
  continuam lá e que o item citado no Molang existe.

Como o modelo fica gigante, a câmera do player fica dentro do peito dele — por
isso `awakening.tallView` (agachar + m1 da forma) joga a visão pro alto.

### Versão dos packs (multiplayer)

O cliente do Minecraft guarda cada pack por **(uuid, versão)**. Se o conteúdo
muda mas a versão fica igual, quem já baixou o pack antes continua usando a
cópia do cache — e itens novos aparecem **sem textura** só pra essa pessoa,
enquanto o host (que tem os arquivos locais) vê tudo normal.

Então todo release que mexe em textura, item ou script precisa de um bump:

```bash
python3 tools/bump_version.py minor   # conteúdo novo (personagem, item, skill)
python3 tools/bump_version.py patch   # correção
python3 tools/bump_version.py --show  # versões atuais
```

O script sobe o header e os módulos dos dois packs e ainda acerta as
dependências cruzadas (BP→RP e RP→BP), que precisam apontar pra versão exata do
outro pack. O `validate.py` falha se essas versões saírem de sincronia.

Depois de importar o `.mcaddon` novo, o host precisa **reativar o pack nas
configurações do mundo** pra ele passar a usar a versão nova.

### A simulação

`sim/` reimplementa o suficiente da API do Bedrock pra rodar o `main.js` no
Node: um scheduler de ticks de verdade (todo `runInterval`/`runTimeout` é
executado), entidades que ficam inválidas quando morrem, inventário, efeitos,
dynamic properties e formulários com resposta roteirizada.

O harness dispara todos os eventos (`playerSpawn`, `itemUse`,
`entityHitEntity`, `entitySpawn`, `playerLeave`), usa todas as skills dos quatro
personagens, ativa awakening/máscara/Kageyoshi/Senkei/Pressão, mata alvos no
meio de um DoT, simula reload do mundo e desconexão, e roda 2000 ticks livres
no fim. São
428 checks — qualquer exceção em qualquer callback é capturada e reportada.

Foi assim que apareceram os bugs de cooldown pós-reload, a máscara que nunca
era removida e o buraco na contenção do Senkei.

## Sistemas genéricos (reaproveite em vez de duplicar)

| Sistema | O que faz |
|---|---|
| `CHARACTERS` | Registro de personagens: `id`, `name`, `health`, `items` (slot → item), e opcionalmente `awakening` (forma persistente) ou `superAttack` |
| `awakening` | `health`, `speedAmplifier` e `items` são **opcionais** — omitir mantém os do personagem base (caso do Kenpachi). `damageMultiplier` dá buff permanente de dano; `onActivate` engata um efeito de entrada |
| `performDashStrike(player, opts)` | Avanço com dano ao longo do caminho — usado pelo Getsuga Run (1 avanço longo) e pelo Flash Slash (3 curtos) |
| `entitiesInFrontBox(player, box)` | Caixa retangular orientada pela visão (`forward`, `width`, `verticalReach`) — pra golpe direcional, quando esfera não serve |
| `MELEE_WEAPONS[].combo` | Efeito a cada N acertos da arma (`everyHits`, `effect`, `amplifier`, `durationTicks`) |
| `spawnPoisonCloud(player, cfg)` | Neblina venenosa parada onde foi solta — Toxic Fog e Konjiki Ashisogi Jizō são a mesma, com raio e intensidade diferentes |
| `superAttack.onTrigger` | Agachar + m1 com o medidor em 100%. Cada personagem escolhe seu efeito (`"byakuya"` → Kageyoshi/Senkei, `"konjiki"` → Bankai do Mayuri) |
| `awakening.altForm` | Troca de persona dentro da forma desperta: agachar + usar a arma atual alterna entre dois conjuntos de itens (Starkk ↔ Lilynette) |
| `nearestTarget` / `directionToward` | Alvo mais próximo com vida (não só player) e vetor fixo até ele, pra mirar tiro sem depender da mira |
| `awakening.extraEffects` | Efeitos permanentes só da forma desperta (lentidão e fadiga da Ira). Removidos ao reverter |
| `awakening.regenAmplifier: null` | Forma sem regeneração passiva, pra quem tem outra fonte de cura |
| `awakening.healPerInterval` | Cura em bloco (`amount` de vida **virtual** a cada `ticks`), dividida pela escala igual o `dealDamage` |
| `awakening.tallView` | Agachar + m1 da forma alterna a câmera pro alto da cabeça (`minecraft:free`, reposicionada a cada 2 ticks) |
| `awakening.onActivate` | Efeito de entrada da forma desperta (`"pressure"` → Kenpachi, `"resurreccion"` → Grimmjow) |
| `fireEnergySphere(player, opts)` | Esfera de energia que viaja pela direção da visão e some no primeiro alvo ou no fim do alcance (Gran Rey Cero) |
| `reapplyFormEffects(player)` | Devolve os efeitos permanentes da forma atual. Buff temporário **sobrescreve** o permanente em vez de somar, então todo buff que mexe em speed/regen precisa chamar isso ao acabar |
| `ARCS` | Agrupamento do seletor. Personagem que não estiver num arco **não aparece no menu** |
| `dealDamage(target, amount, source)` | Porta única de dano: aplica a escala de vida do alvo e a marca da Pesquisa. Nenhum `applyDamage` solto no código |
| `activeZones` | Zonas com regras: `blocksSkills`, `blocksOwnerSkills`, `traps`, `blocksRegen`. Senkei e Enigma são a mesma estrutura com flags diferentes |
| `entitiesInFrontBox(player, box)` / `drawSweep` | Caixa direcional e o corte desenhado em cima dela |
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
   **E registrar o id em `ARCS`**, no arco dele — quem fica fora de todo arco
   não aparece no seletor. A simulação falha se alguém sumir do elenco.
   Vida acima de **1044** entra no esquema de vida virtual descrito acima —
   funciona sozinho — o dano do m1 também escala.
2. **Criar os itens** em `BP/items/<nome>.json` — copie um existente; o ícone é
   uma string `"namespace:item"`. A arma de m1 leva **`minecraft:damage: 0`**:
   o dano dela sai inteiro do script, por `MELEE_WEAPONS[].baseDamage`.
3. **Desenhar as texturas** em `tools/textures.py`: um grid de 16 linhas × 16
   caracteres mais uma paleta `char → (R, G, B, A)`, `.` = transparente.
   Rode `python3 tools/gen_textures.py`.
4. **Registrar as texturas** em `RP/textures/item_texture.json`.
5. **Ligar as skills**: um `case` no `switch` do `itemUse`, cooldown em
   `SKILL_COOLDOWN_TICKS`, nome em `SKILL_NAMES`, dano em `DAMAGE`, e a arma de
   m1 em `MELEE_WEAPONS`.
6. **Cobrir na simulação** (`sim/run.mjs`): um cenário que usa todas as skills
   e checa que causam dano.
7. `python3 tools/bump_version.py minor` — sem isso, quem já tem o pack
   baixado não vê as texturas novas
8. `python3 tools/build.py`

O `validate.py` pega item sem textura, textura sem arquivo, item citado no
script sem definição no BP e ícone no formato antigo — rode antes de testar
no jogo.
