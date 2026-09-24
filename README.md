# Bleach battlegrounds

Addon de PvP pra Minecraft Bedrock (BP + RP). Cada player escolhe um personagem
num menu, ganha vida, itens e skills próprias, e luta contra os outros.

O seletor é **raça → tier → personagem**: agachar + usar o seletor troca a
raça (Shinigami, Hollow, Quincy, Fullbringer, Híbrido), usar abre os 9 tiers, e
o tier abre os personagens daquela raça naquele tier.

### Shinigami
| Tier | Personagem | Vida | Awakening / super |
|---|---|---|---|
| 2 | Byakuya Kuchiki (Shikai) | 700 | super: Kageyoshi ou Senkei |
| 2 | Mayuri Kurotsuchi (Shikai) | 600 | super: Konjiki Ashisogi Jizō |
| 2 | Rukia Kuchiki (Sode no Shirayuki) | 600 | super |
| 3 | Zaraki Kenpachi | 1700 | Pressão (tapa-olho removido) |
| 4 | Toshiro Hitsugaya (Hyōrinmaru) | 2500 | Daiguren Hyōrinmaru (3000), asas/cauda em attachable |
| 4 | Soi Fon (Suzumebachi) | 2000 | super: Jakuhō Raikōben |
| 5 | Gin Ichimaru | 4000 | super: Kamishini no Yari |
| 5 | Shunsui Kyoraku (Katen Kyokotsu) | 4500 | super: Karamatsu Shinjū |
| 5 | Jūshiro Ukitake (Sōgyo no Kotowari) | 4400 | super |
| 6 | **Sousuke Aizen (Captain's Fight)** | 5500 | super: Hadō #90 Kurohitsugi |

### Hollow
| Tier | Personagem | Vida | Awakening / super |
|---|---|---|---|
| 2 | Grimmjow Jaegerjaquez | 800 | La Pantera (1200) |
| 2 | Szayelaporro Granz | 750 (752) | Fornicarás (1000) |
| 2 | Aaroniero Arruruerie (Espada 9) | 700 | Glotonería (1100) |
| 3 | Nnoitra Gilga | 1300 | Santa Teresa (1600) |
| 3 | Ulquiorra Cifer | 1600 | Murciélago (2000) → Segunda Etapa |
| 3 | Tier Harribel | 2600 | Tiburón (3000) |
| 4 | Barragan Louisenbairn | 3000 | Arrogante |
| 4 | Coyote Starkk | 4000 | Los Lobos (4000) |
| 5 | Yammy Llargo | 1000 | Ira (6000) |

### Híbrido
| Tier | Personagem | Vida | Awakening / super |
|---|---|---|---|
| 2 | Ichigo Kurosaki (Shikai) | 700 | Tensa Zangetsu (1100) + Máscara |
| 3 | Kaname Tōsen (Suzumushi) | 1500 | super: Enma Kōrogi; Visored como forma alternativa |
| 4 | Shinji Hirako | 2600 | Sakanade (em `shinji.js`) |
| 4 | Ichigo (pós-treino Vizard) | 1500 | Hollowficação → Vasto Lorde aos 100 de vida (3000) |
| 7 | **Sousuke Aizen (Hōgyoku)** | 7000 | Evolution → casulo → Monster Aizen (8000), permanente |
| 7 | **Ichigo Kurosaki (Dangai)** | 7500 | super: Mugetsu (Getsuga Tenshou Final) |

O **tier** não é só etiqueta: a Pressão Espiritual (skill genérica do slot 7)
machuca quem está 2+ tiers abaixo e **mata na hora** quem está 5+ abaixo, e o
Air Step exige tier 5+. O Aizen (6) apaga qualquer tier 1 dentro de 60 blocos
com a pressão ligada; o Aizen Hōgyoku (7) apaga até o tier 2. O Ichigo (Dangai)
é imune à pressão de qualquer tier.

## Layout

```
BP/                     behavior pack
  manifest.json
  items/*.json          um arquivo por item (format_version 1.26.40)
  entities/*.json       boneco de teste, clone do Aizen
  scripts/main.js       TODO o gameplay (@minecraft/server 2.0 + server-ui)
  scripts/shinji.js     o Shinji Hirako (importado pelo main.js)
RP/                     resource pack
  manifest.json
  entity/               override do player (escala do modelo por Molang), boneco, clone
  attachables/          Hollowficação/Vasto Lorde (Vizard), Daiguren (Hitsugaya) e Mugetsu (Dangai)
  particles/            partículas customizadas (sakura:leaf, mayuri:poison_fog, grimmjow:cero, ...)
  textures/items/*.png  uma textura por item
  textures/item_texture.json
tools/
  textures.py           grids de caracteres + paletas = fonte das texturas
  gen_textures.py       renderiza os grids em PNG (upscale nearest 4x)
  boxmodel.py           base dos modelos de caixa (rig do player, UV, textura)
  hollow_model.py       modelo do Ichigo Vizard (attachable)
  aizen_clone_model.py  modelo do clone dos dois Aizen
  daiguren_model.py     asas, cauda e braço de gelo da Daiguren (attachable)
  mugetsu_model.py      roupa do Mugetsu do Ichigo Dangai (attachable)
  gen_model.py          renderiza os modelos em .geo.json
  vanilla_sounds.txt    IDs de som do Bedrock, pra validar os sons do script
  validate.py           JSON, itens, texturas, manifests, versões, sons, entidades
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
`entityHitEntity`, `entityHitBlock`, `entitySpawn`, `playerLeave`...), usa as
skills, ativa awakenings e supers, mata alvos no meio de um DoT, simula reload
do mundo e desconexão, e roda 2000 ticks livres no fim. São 991 checks —
qualquer exceção em qualquer callback é capturada e reportada, inclusive a que
o anti-lag do `main.js` engole dentro dos loops. Os números vêm do próprio
`main.js` (ele exporta o registro), então rebalancear não quebra a simulação.

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
| `CHARACTER_RACE_TIER` | Raça e tier de cada personagem. Quem não estiver aqui **não aparece no menu** |
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
   **E registrar o id em `CHARACTER_RACE_TIER`** com raça e tier — quem fica
   fora não aparece no seletor. A simulação falha se alguém sumir do elenco.
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
script sem definição no BP, ícone no formato antigo, som que não existe no
Bedrock e entidade apontando pra geometria/textura inexistente — rode antes de
testar no jogo.
