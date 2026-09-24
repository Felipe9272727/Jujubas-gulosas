# Bleach battlegrounds — estado do projeto

Documento de passagem de sessão. O repositório é a fonte da verdade: tudo está
commitado e enviado.

- **Repo**: `Felipe9272727/Jujubas-gulosas`, branch `claude/blissful-keller-vni5lv`
- **Build**: `python3 tools/build.py` → `dist/BleachBattlegrounds.mcaddon`
- **Estado**: 991 checks na simulação, zero exceções. Packs na versão 1.22.0.
- **Base**: a partir da 1.20.0 o repo parte da **1.19.25 (TosenVisored)** que o
  usuário mandou em `.mcaddon` — ela descende da 1.14.0 daqui (mesmos UUIDs) e foi
  desenvolvida fora deste branch. Foi importada byte a byte no commit
  `b9719db`; tudo depois disso está no histórico normal.

## Como trabalhar aqui

```bash
python3 tools/build.py          # valida + simula + empacota (falha se algo quebrar)
python3 tools/validate.py       # JSON, itens, texturas, manifests, sons, entidades
python3 tools/gen_textures.py   # renderiza os grids de tools/textures.py em PNG
python3 tools/gen_model.py      # geometrias feitas por código (Vizard, clone do Aizen, Daiguren, Mugetsu)
python3 tools/bump_version.py minor   # OBRIGATÓRIO a cada release de conteúdo
node --import ./sim/register.mjs sim/run.mjs   # só a simulação
```

O `build.py` roda tudo e **se recusa a empacotar** se qualquer etapa falhar.

## Estrutura

```
BP/                     behavior pack
  manifest.json         versão dos packs (ver "cache de pack" abaixo)
  items/*.json          202 itens, um arquivo cada (format_version 1.26.40)
  entities/*.json       boneco de teste, clone do Aizen
  scripts/main.js       ~17 mil linhas: TODO o gameplay (menos o Shinji)
  scripts/shinji.js     o Shinji Hirako, importado pelo main.js
RP/                     resource pack
  particles/*.json      partículas customizadas (uma por arquivo)
  entity/*.json         client entities (player override, boneco, clone)
  textures/...          itens, partículas, entidades
tools/
  textures.py           grids de caracteres + paletas = FONTE das texturas do addon
  boxmodel.py           base comum dos modelos de caixa (rig do player, UV, textura)
  hollow_model.py       modelo dos attachables do Ichigo Vizard
  aizen_clone_model.py  modelo do clone dos dois Aizen
  daiguren_model.py     asas, cauda e braço de gelo da Daiguren Hyōrinmaru
  mugetsu_model.py      cabelo, faixas e hakama do Mugetsu (Ichigo Dangai)
  gen_textures.py       grids -> PNG (e --check)
  gen_model.py          modelos -> .geo.json (e --check)
  vanilla_sounds.txt    IDs de som do Bedrock (Mojang/bedrock-samples)
  validate.py           checagem estática
  bump_version.py       sobe a versão dos dois packs e sincroniza dependências
  build.py              pipeline + empacotamento
sim/
  stubs/                @minecraft/server e server-ui falsos
  run.mjs               ~5500 linhas, 991 checks
```

### A simulação

`sim/` reimplementa o suficiente da API do Bedrock pra rodar o `main.js` no
Node: scheduler de ticks real (todo `runInterval`/`runTimeout` executa),
entidades que ficam inválidas ao morrer, efeitos que expiram, inventário,
dynamic properties, raycast e formulários com resposta roteirizada.

**O stub é propositalmente mais rígido que o jogo** em pontos onde o Bedrock
falha em silêncio — por exemplo, `addEffect` recusa `amplifier > 255`. Foi
assim que quase todos os bugs abaixo apareceram antes de ir pro jogo.

**Os números não são copiados.** O fim do `main.js` exporta `CHARACTERS`,
`DAMAGE`, `SKILL_COOLDOWN_TICKS`, `MELEE_WEAPONS` etc. (no jogo ninguém importa
o main.js, então exportar não muda nada) e os checks provam que **o valor
configurado é o que chega no alvo**. Rebalancear não quebra a simulação; mudar
mecânica quebra, que é o que ela tem que pegar.

**O anti-lag do main.js engole erro de loop** (todo `runInterval` vira
try/catch com `console.warn`). O stub transforma esse aviso de volta em erro —
senão a simulação ficaria cega pra exceção dentro de loop, que é justamente onde
o bug do `tierOfPlayer` estava escondido.

## Elenco

O seletor é **raça → tier → personagem**: agachar + usar o seletor troca a
raça; usar abre os 9 tiers; o tier abre os personagens daquela raça naquele
tier. Personagem que não estiver em `CHARACTER_RACE_TIER` **não aparece no
menu**. Tabela gerada do registro do `main.js`:

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

## Sistemas genéricos (reusar, não duplicar)

| Sistema | O que faz |
|---|---|
| `CHARACTERS` | Registro: `health`, `items` (slot→item), `awakening` ou `superAttack` |
| `CHARACTER_RACE_TIER` | Raça e tier de cada personagem: é o que o seletor lista |
| `tierOfPlayer` | Tier do personagem ativo (0 sem personagem) |
| `paralyzeFor(alvo, ticks, msg)` | Paralisia por tempo fixo, pelas travas do `isFrozen()` |
| `iceTrack` / `iceSet` / `iceRestore` | Livro-caixa de blocos: coloca, lembra o que tinha e devolve. Concreto preto registrado não pode ser quebrado (Enma Kōrogi, Kurohitsugi) |
| `kyokaShatter` | O som da Kyōka quebrando, pra todos os players |
| `dealDamage(target, amount, source)` | **Porta única de dano**: aplica escala de vida e marca da Pesquisa. Não existe `applyDamage` solto |
| `MELEE_WEAPONS` | Armas de m1: `baseDamage`, `particle`, `dot`, `combo`, `onHit` |
| `activeZones` | Zonas com flags: `blocksSkills`, `blocksOwnerSkills`, `traps`, `blocksRegen`. Senkei e Enigma são a mesma estrutura |
| `fireCrescentWave` | Onda em lua crescente (Getsuga e derivados) |
| `fireEnergySphere` | Projétil esférico com sub-passos e colisão no corpo |
| `performDashStrike` | Avanço com dano no caminho (Getsuga Run, Flash Slash, Raza) |
| `entitiesInFrontBox` / `drawSweep` | Caixa direcional + o corte desenhado em cima dela |
| `spawnPoisonCloud` | Neblina parada (Toxic Fog e Konjiki) |
| `applyDot` | Dano por segundo, limpa sozinho se o alvo morre |
| `applyDeterioration` | `applyDot` + a marca visual do envelhecimento (5 skills do Barragan) |
| `BLOCK` / `isBlocking` | Guarda universal. `dealDamage` corta metade; `{breaksBlock:true}` passa direto |
| `isRespiring` | Imunidade a longo alcance: consultada pelos 3 sistemas de projétil |
| `markTarget` / `markMultiplierOf` | Marca de dano recebido. Pesquisa = 1.5x, Learn and Adapt = 2x |
| `activeMutilations` | Mutilações sem prazo do Teatro de Títeres; caem quando um dos dois morre |
| `cutHealthFor` | Aplica o coração furado (-30%) em toda troca de forma, não só no corte |
| `activeFormOf` | **Qual forma está valendo agora**: 2ª fase > 1ª fase > base. Tudo que lê "a forma" passa aqui |
| `awakening.trueForm` | Segunda fase automática por vida baixa (Vasto Lorde) |
| `awakening.waveScale` | Multiplica raio/espessura de toda onda crescente da forma |
| `awakening.armorPiece` | Peitoral que troca a skin do player via attachable |
| `awakening.castAnimation` | Animação tocada com `playAnimation` ao conjurar |
| `MELEE_WEAPONS[].blast` | m1 com estouro em área (Zangetsu do Vasto Lorde) |
| `fireEnergySphere({blast})` | Cero que estoura em área ao acertar ou ao acabar o alcance |
| `summonHomingBeast` | Fera guiada que explode ao encostar (Lobos, Tubarões) |
| `spawnPoisonCloud` | Neblina parada; aceita partícula, cegueira e deterioração próprias |
| `reapplyFormEffects` | Devolve os efeitos permanentes da forma |
| `awakening.onActivate` | Efeito de entrada: `"pressure"`, `"battlecry"` |
| `superAttack.onTrigger` | Agachar + m1 com medidor cheio: `"byakuya"`, `"konjiki"` |

Balanceamento vive em `DAMAGE` e `SKILL_COOLDOWN_TICKS`, no topo do `main.js`.

## Armadilhas do Bedrock já aprendidas (não repetir)

1. **Teto de vida = 1044.** O amplificador de efeito é um byte (máx 255), então
   `health_boost` chega em `20 + 256×4`. Pedir mais **não dá erro** — o efeito
   não aplica. Acima disso a vida é virtual (`mv:health_scale`) e `dealDamage`
   divide pela escala do alvo.
2. **Cache de pack.** O cliente guarda o pack por `(uuid, versão)`. Mudou
   conteúdo e não mudou versão → quem já baixou continua com o pack velho e vê
   itens novos **sem textura**. O host não percebe (lê os arquivos locais).
   Sempre `bump_version.py`, e reativar o pack no mundo depois de importar.
3. **`system.currentTick` reinicia com o mundo, dynamic property não.** Prazo
   gravado como tick absoluto vira lixo depois de um reload. Usar
   `onCooldown()` / `readTickDeadline()` / `clearSessionTimers()`.
4. **`getEntities` mede até os PÉS da entidade.** Projétil que voa na altura do
   peito precisa medir até o meio do corpo, senão nunca acerta ninguém no chão.
5. **Efeito temporário SOBRESCREVE o permanente**, não soma. Todo buff que mexe
   em speed/regen tem que chamar `reapplyFormEffects` ao acabar.
6. **`runTimeout` dispara no tick exato do fim.** Guard do tipo
   `if (!estáAtivo()) return` faz a limpeza nunca rodar.
7. **Efeito mais fraco não substitui o mais forte.** `addEffect` só troca o
   efeito ativo quando o amplifier é **maior ou igual**. Voltar de um awakening
   aplicando `health_boost` 244 por cima do 255 da forma desperta não fazia
   nada: o teto continuava o antigo (era daí que vinham os "+44 de vida" do
   Yammy, e o speed/regen que não voltavam ao base). Por isso
   `setPermanentEffect` **remove antes de aplicar**. E como tirar o
   `health_boost` derruba o teto pra 20 — e o jogo corta a vida atual junto —
   `setMaxHealth` guarda a vida antes e devolve depois, limitada pelo teto
   **calculado** (`realMaxHealthFor`), não pelo `effectiveMax`, que pode levar
   um tick pra acompanhar.
8. **Teleportar e empurrar no mesmo tick não funciona em player.** Num mob o
   servidor manda na posição, mas o cliente é dono da posição do player: o
   pacote de teleport chega depois e engole o `applyKnockback`. Era isso que
   fazia o Face Hold arremessar mob e não arremessar player. A skill para de
   teleportar, solta a lentidão e só empurra alguns ticks depois.
9. **A offhand recusa item em silêncio.** O Bedrock só aceita na off hand item
   que declara `minecraft:allow_off_hand` (item format_version ≥ 1.20.30).
   `setEquipment` devolve `false` e **não lança nada** — o marcador da forma
   gigante nunca chegava lá, então o Molang do RP nunca via nada e o Yammy
   nunca crescia. `setOffhandMarker` agora **lê a slot de volta** em vez de
   confiar na chamada, e avisa no chat quando falha. O `validate.py` exige o
   componente em todo item citado como `offhandMarker`, e o stub da simulação
   lê os `BP/items` de verdade pra recusar igual ao jogo.
10. **Vida só existe na grade `20 + 4k`.** `health_boost` anda de 4 em 4 a partir
   de 20, então um valor fora dessa grade é arredondado **pra cima**: os 750 do
   Szayelaporro viram 752 no jogo. É o único do elenco fora da grade; o
   `validate.py` avisa quando entra outro.
11. **O client entity do player precisa de `min_engine_version: "1.13.0"`.**
   Acima disso as skins de persona (Character Creator) quebram. O `format_version`
   do arquivo pode ser alto normalmente — é o `min_engine_version` que trava.
12. **Player gigante só pelo resource pack.** Não existe setter de tamanho no
   Script API e `minecraft:scale` no BP pega todo mundo. O jeito que funciona é
   `scripts.scale` no client entity do player (`RP/entity/player.entity.json`),
   que aceita Molang e escala **só o modelo**. O gatilho é um item invisível
   travado na offhand, lido por `query.is_item_name_any`. A **hitbox não muda** —
   isso é inerente ao método.

13. **Som com ID errado toca silêncio.** Nenhum erro, nenhum aviso. A Soi Fon
   usava `mob.enderman.teleport` (o certo é `mob.endermen.portal`) e a Harribel
   `mob.guardian.attack`/`mob.guardian.curse` — essas skills estavam mudas. O
   `validate.py` agora confere todo ID de som dos scripts contra
   `tools/vanilla_sounds.txt` (lista oficial da Mojang).
14. **Não existe `ItemDyeableComponent` na API estável 2.0.0.** Não dá pra
   tingir couro por script nem por comando. Por isso os clones do Aizen são uma
   entidade própria com o visual pintado, e não armor stands vanilla (que ainda
   quebram com dois golpes e dropam a armadura).
15. **`Block.isSolid` não existe na estável 2.0.0.** O `ginBlockInfo` testa
   `block.isSolid === false`, que é sempre falso: na prática "passável" é só ar
   ou líquido. Não quebra nada (é conservador), mas não conte com isso.
16. **Client entity com geometria/textura errada fica invisível** e a entidade
   continua existindo (leva golpe, tem nome). O `validate.py` confere toda
   entidade do addon.
17. **`teleport` com `facingLocation` mira a partir dos PÉS.** Apontar pro peito
   do alvo fazia o Aizen aparecer olhando pra cima em todo teleporte. Pra
   aparecer com a mira reta, passar `rotation: levelRotationToward(de, para)`
   (pitch 0, yaw = `atan2(-dx, dz)`); o stub da simulação respeita os dois e
   os checks conferem "olhando reto pro alvo".
18. **Partícula não substitui modelo.** A Daiguren era só geada de partícula:
   com qualquer outro resource pack por cima (ou partículas no mínimo) as asas
   e a cauda simplesmente não apareciam. Visual que *precisa* aparecer vai em
   attachable.

## Disputa da tecla agachar + m1

A mesma tecla faz várias coisas. A ordem é: **awakening → máscara → super ataque
→ câmera alta / troca de persona → bloqueio**. No Aizen, o super (Kurohitsugi)
só pega a tecla com medidor cheio **e alguém na mira**; sem alvo ela cai pra
guarda sem gastar o medidor. As três primeiras só ficam com a
tecla quando realmente disparam (medidor cheio, vida baixa); se não disparam, a
tecla cai pro bloqueio em vez de morrer. As duas do meio (câmera da Ira do Yammy,
persona do Starkk) sempre disparam, então **nessas duas formas despertas não dá
pra bloquear** — está travado na simulação de propósito.

## Teatro de Títeres (o mais complicado do addon)

Uso único **por Resurrección** (`DP.teatroUsed` zera em `activateAwakening`).
Ao usar num alvo, os **dois lados** ficam presos (`DP.frozenEnd`): ninguém ataca
nem usa skill, nem o próprio Szayelaporro. Um `ActionFormData` abre com as
quatro escolhas; fechar sem escolher **solta os dois** (senão o Teatro trancaria
os dois de graça até o prazo). As mutilações não têm prazo: valem até um dos dois
cair, e um loop de 20 ticks devolve tudo quando isso acontece.

| Escolha | Como é feito |
|---|---|
| Olhos | `darkness` **reaplicada** a cada 20 ticks — qualquer darkness curta de outra skill substituiria a permanente |
| Perna | `DP.legCut`, lido pelo loop do dash |
| Braço | `DP.armCut`, lido por `dmgMultiplier` |
| Coração | `DP.heartCut`, lido por `cutHealthFor` dentro de `applyCharacterEffects` — vale em toda troca de forma, não só no momento do corte |

## Visual da Hollowficação (attachable)

A skin não é trocada por script — **não existe setter de skin no Bedrock**. O que
existe é um attachable amarrado a um item de peitoral:

| Arquivo | Papel |
|---|---|
| `BP/items/vizard_hollow_chest.json` | o item, com `minecraft:wearable` no peito |
| `RP/attachables/hollow_ichigo.json` | liga o item à geometria e à textura |
| `RP/models/entity/hollow_ichigo.geo.json` | **gerado** por `tools/gen_model.py` — nunca editar à mão |
| `RP/textures/entity/hollow_ichigo.png` | **gerada** da mesma fonte (128×128) |
| `tools/hollow_model.py` | a fonte: duas variantes (Hollowficação 34 caixas, Vasto Lorde 38), ossos e empacotador de UV |
| `RP/render_controllers/hollow_ichigo.json` | o render controller do attachable |

O attachable casa osso por **nome** com o rig do pai. O rig do player
(`geometry.humanoid.custom`) é:

```
root ─┬─ waist ─── body ─┬─ head
      │                  ├─ leftArm
      │                  └─ rightArm
      ├─ leftLeg
      └─ rightLeg          <- as pernas saem da RAIZ, não da cintura
```

A primeira versão do modelo **não tinha `root`** e pendurava as pernas no
`waist`. Osso faltando ou no pai errado não acompanha a animação do player — e
isso **não dá erro nenhum no jogo**, só não aparece direito. O `validate.py`
agora compara o rig do attachable com o do player osso por osso.

O peitoral é reposto pelo loop de travar itens a cada 10 ticks, igual ao marcador
da offhand do Yammy: tirar a peça não desfaz a forma. E `equipArmorPiece` **lê a
slot de volta** em vez de confiar no `setEquipment` — slot de equipamento recusa
item em silêncio, exatamente como a offhand fez. O stub da simulação recusa
qualquer item sem `minecraft:wearable` apontando pra slot certa.

### Existem DOIS Ichigos

| Menu | Personagem | Tem armadura/animação? |
|---|---|---|
| Arco 1, botão 0 | Ichigo Kurosaki (Shikai), 200 | não |
| Arco 2, botão 7 | Ichigo (pós-treino Vizard), 1500 | **sim** |

O awakening avisa no chat qual forma entrou (`despertou: Tensa Zangetsu` vs
`despertou: Hollowficação`) — é por aí que se sabe qual dos dois está ativo.

### Tamanho de caixa TEM que ser inteiro

O Bedrock mapeia o UV pelo tamanho **real** da caixa. Uma caixa de largura `8.4`
ocupa 8.4 pixels de UV, e como a textura só tem pixel inteiro, todo detalhe
pintado nela sai deslocado — foi isso que borrou a máscara na primeira versão.
O `origin` pode ser fracionário à vontade (só move a peça); o `size`, não.
`hollow_model.py` tem um assert que reprova tamanho fracionário.

### Armadura de forma não vira item de inventário

`sweepFormArmor` roda no loop de travar itens **para todo player, com ou sem
personagem**: a peça certa fica no peito, qualquer cópia solta some da mochila,
e peça de forma que não está valendo sai do peito. É o que impede tirar a
armadura (ganhando uma cópia), acumular, e usar sem personagem — e é o que faz
ela sumir quando o awakening acaba e voltar quando ele volta.

### Por que o modelo é código e não um .geo.json

Com 34 caixas, posicionar UV à mão é onde o modelo quebra **em silêncio**: face
esticada, UV de um cubo em cima do outro, nada disso dá erro no jogo. Em
`tools/hollow_model.py` as caixas são descritas uma vez e o mesmo dado gera a
geometria **e** a textura, com o UV empacotado por código (shelf packing num
atlas 128×128). Adicionar uma caixa não exige recalcular nada.

O `build.py` roda `gen_model.py --check`, então geometria editada à mão sem
passar pelo modelo reprova o build.

### Blender: serve como OLHO, não como exportador

As ferramentas 3D produzem GLB e o Bedrock não carrega mesh — geometria de addon
é caixa com UV de pixel, então não existe "exportar do Blender pro Bedrock". Mas
o Blender serve pra **ver**: as mesmas caixas de `hollow_model.py` são montadas
em `bpy` e renderizadas de vários ângulos.

Isso já pagou na primeira rodada: o render mostrou os chifres e os espinhos de
cabelo **nascendo nos pés**. No Bedrock o `origin` do cubo é em espaço de
MODELO, não relativo ao osso — o pivô do osso só define o centro de rotação. Eu
tinha escrito os chifres em `y=0`. Sem o render isso ia pro jogo.

## Sousuke Aizen (Captain's Fight)

Tier 6, Shinigami, 5500 de vida. Itens: Kyōka Suigetsu (m1, 120), Illusion's
Mastery, Betrayal of the Illusioner, Bakudō #61 e Fool's Trick. Super:
Hadō #90 Kurohitsugi. **Ele não fala mais no chat** (pedido do usuário na
1.21.0): sobraram só os anúncios de skill pra todos (Bakudō, Kurohitsugi e o
falso awakening do Fool's Trick). Todo teleporte que vira o Aizen pra um alvo
(Betrayal, Fool's Trick, Counter e as ilusões do Hōgyoku) chega com a mira
reta (armadilha 17); o da marca de bloco mantém a mira que ele já tinha.

### A marca da Kyōka (individualidade)

O m1 grava `mv:kyoka_mark` no alvo — player ou mob — e **nunca apaga**
(sobrevive à morte e à troca de personagem: "permanente"). Três coisas são
**ilusões** e só funcionam em quem tem a marca: **Illusion's Mastery**,
**Fool's Trick** e o **Counter**. As outras (Betrayal, Bakudō, Kurohitsugi) são
físicas e pegam qualquer um. Toda ilusão termina com a Kyōka quebrando: vidro +
ametista em camadas, tocado **na posição de cada player** (todo mundo ouve) e
cacos de vidro (`aizen:estilhaco`).

Bater num bloco com a Kyōka (`entityHitBlock`) marca o bloco (`mv:kyoka_block`,
que brilha só pra ele). **Agachar duas vezes em 2s** leva o Aizen pra cima dele.
O agachar conta ao **soltar**, e só se não foi gasto em outra coisa: agachar pra
levantar a guarda, disparar a Kurohitsugi ou dar o dash não conta. Sem isso,
baixar a guarda e agachar de novo teleportava sem querer. A espada tem
`can_destroy_in_creative: false`, senão no criativo o golpe quebrava o bloco em
vez de marcar.

### Illusion's Mastery e os clones

O clone **não é armor stand** (ver armadilha 14): é a entidade `aizen:clone`,
com modelo de armor stand vestindo couro branco completo gerado por
`tools/aizen_clone_model.py` (medidas do `geometry.armor_stand` da Mojang),
imune a dano, sem loot e com o nome do Aizen sempre visível. Três clones giram
em triângulo em volta do alvo (reposicionados todo tick). O Aizen fica
invisível, o nome some da cabeça e a Kyōka do slot 0 vira a **Kyōka oculta**
(mesma arma, textura vazia), senão a espada flutuando entregaria onde ele está.

Acertar um clone: quem acertou toma 50 e o clone some. Os três: o Aizen
reaparece. M1 dele no alvo: 300 + lentidão e a ilusão cai. Dano de skill/área passa direto
pelo clone (`dealDamage` ignora o tipo): só golpe de verdade conta.

**Duas rotas pro golpe no clone**: o `entityHitEntity` (principal, sabe quem
bateu) e o `damage_sensor` do clone, que dispara o evento `aizen:golpeado`
(`dataDrivenEntityTrigger`). Se o jogo não mandar `entityHitEntity` pra uma
entidade que não toma dano, o evento desfaz o clone do mesmo jeito, cobrando de
quem está preso na ilusão. Um golpe visto pelas duas rotas conta uma vez só.

### Counter

5 m1 **do mesmo atacante** em 3s no Aizen (e o atacante tem que ter a marca):
ele aparece atrás, paralisa 3s e volta pra **maior vida registrada desde o
primeiro golpe** (o loop do Aizen guarda a vida dos últimos 4s). Recupera dano
de qualquer fonte nessa janela, não só dos m1.

### Kurohitsugi

Caixa oca 10×10×10 de concreto preto em volta do alvo mirado, montada de baixo
pra cima e registrada no livro-caixa de blocos (a parede não quebra e tudo volta
ao normal no fim). Só troca célula de ar/líquido. 50 estocadas de 50 em todo
mundo lá dentro menos o Aizen, uma a cada 2 ticks; **o dano é aplicado em
rajadas de 5 golpes a cada 10 ticks** (250 por vez) porque golpe a golpe a
cada 2 ticks poderia esbarrar na invulnerabilidade pós-dano do alvo. O total é
o mesmo (2500).

## Sousuke Aizen (Hōgyoku)

Tier 7, **Híbrido**, 7000 de vida, cura 100 a cada 4s. Itens: Kyōka Suigetsu
(m1, 160, também marca), **Illusions**, Hadō #90 Kurohitsugi (Encantado) e
Fragor. Divide com o Aizen Capitão a marca da Kyōka, o clone (`aizen:clone`),
a Kyōka oculta, o som da Kyōka quebrando e o `runKurohitsugi` (parametrizado
por `cfg`). Tudo dele vive no bloco `HOGYOKU` do `main.js`.

### Illusions (um item, três ilusões)

Agachar + usar abre o menu (`openIllusionsMenu`); usar sem agachar lança a
escolhida. Cada ilusão tem **cooldown próprio** (chaves
`aizen:illusions.switch` etc. em `SKILL_COOLDOWN_TICKS` — o ponto no meio é
de propósito, pro validador não achar que é item), então o item não tem
cooldown visual. As três são ilusões: só funcionam em quem tem a marca da
Kyōka, e mirar em alguém sem ela recusa **sem gastar** o cooldown.

- **Switch** (30s): um clone fica sempre atrás do alvo. Quando o alvo acerta
  o Aizen com m1, o golpe não entra: o Aizen vai pro lugar do clone (atrás
  dele) e o clone vem pra frente, onde o Aizen estava, e segura ali 1,5s antes
  de voltar pras costas. Troca toda vez. Acaba em 15s ou quando o alvo acerta
  o clone (Kyōka quebrando).
- **False Skill** (25s): finge uma skill de verdade do Hōgyoku (Fragor ou a
  Kurohitsugi encantada; no Monster, UltraFragor ou Fragor Barrage) com o
  mesmo anúncio e visual, **sem dano**. Meio segundo depois, se o alvo está no
  alcance da skill fingida, o Aizen aparece atrás dele e paralisa 1s.
- **Kanzen Saimin** (45s): o Aizen fica invisível, sem nome e com a Kyōka
  oculta; 8 clones giram em anel (raio 3,2) em volta do alvo e ele fala
  "Encontre-me, se puder..." em roxo. Acertar clone só estoura o clone. O
  primeiro m1 do Aizen dá o dobro e desfaz a ilusão. Máximo 15s.

### Kurohitsugi (Encantado) e Fragor

- **Kurohitsugi (Encantado)** (70s): mesma caixa do Capitão, só que 14×14×14,
  40 golpes de 90 (3600), e antes o encantamento inteiro no chat em roxo.
- **Fragor** (50s): raio 30 (a Quebramundos do Yammy tem 26), 1000 de dano,
  30 estilhaços roxos (`aizen:fragmento`) em espiral de Fibonacci, 100 cada,
  alcance 45, param no primeiro bloco sólido. Um loop só pra todos os
  estilhaços, com uma busca de entidades por tick.

### Evolution → casulo → Monster Aizen

O Hōgyoku não usa o medidor de Awakening: a barra mostra **Evolution**
(`mv:evolution`), que sobe 10% a cada 30s sozinha. Cada 20% soma 20 na cura e
5% no dano (`hogyokuDamageBonus` entra no `dmgMultiplier`). Em 100% um
**casulo** 3×4×3 de concreto branco fecha em volta dele (livro-caixa de
blocos, inquebrável, `LEDGER_PROTECTED_BLOCKS`), paralisado; 5s depois o
casulo abre e a **Metamorfose** ativa na hora.

**Monster Aizen** é awakening **permanente** (`awakening.permanent`: o loop de
drenar pula ele): 8000 de vida, cura 200/4s, "Aizen atingiu sua
Metamorfose..." pra todos, Kyōka em dobro (320; com o +25% da Evolution cheia,
400). Fragor vira **UltraFragor** (60s, 2000, raio 40, estilhaços de 200 com
alcance 60) e a Kurohitsugi vira **Fragor Barrage** (60s, 5 Fragors de metade
do raio e do dano, 0,6s entre eles, centrados no Aizen). A cada 60s ele ganha
5% de redução de dano recebido (`hogyokuResistMultiplier` no
`damageTakenMultiplierOf`), com mensagem global, até 50%.

Morrer, desativar ou trocar de personagem zera Evolution e resistência
(`resetHogyoku`) e desfaz Switch, Kanzen e casulo (`hogyokuCleanup`, chamado
pelo `aizenCleanup`). O cheat "Dar Awakening" enche a Evolution.

## Daiguren Hyōrinmaru (attachable)

Na 1.19.25 as asas e a cauda eram só partícula de geada — com outro resource
pack junto elas não apareciam (armadilha 18). Agora a Bankai veste o peitoral
`hitsugaya:daiguren_chest`, igual à Hollowficação do Vizard: attachable
`RP/attachables/daiguren.json` com geometria e textura **geradas** por
`tools/daiguren_model.py` (36 caixas: asas em escadinha presas no `body`,
cauda no `waist`, manga de gelo e garras no `rightArm`). A geada de partícula
continua por cima. A peça segue as mesmas regras de armadura de forma
(`sweepFormArmor`, lida de volta da slot, some quando a Bankai acaba).

`tools/boxmodel.py` virou a base comum dos modelos de caixa: rig do player,
empacotador de UV e textura. O clone do Aizen foi migrado pra ela (saída
idêntica byte a byte).

## Ichigo Kurosaki (Dangai)

Tier 7, **Híbrido**, 7500 de vida. Itens: Zangetsu (m1, 200), Getsuga Tenshou
(Dangai), Omnidirectional Getsuga, Arrogant's Counter e "Let's fight
somewhere else.". Super: **Mugetsu**. Tudo dele vive no bloco `DANGAI` do
`main.js`.

**Individualidade** — flags no registro, lidas por quem precisa:
`pressureImmune` (a Pressão Espiritual genérica e a do Kenpachi pulam ele),
`illusionImmune` (`hasKyokaMark` devolve falso pra ele mesmo com a marca de
antes, e a Kyōka não marca), `sprintSpeedAmplifier` (um loop troca pra speed 5
quando `isSprinting` liga e volta pro base quando desliga) e `dashTeleports` no
personagem base (o dash universal já lia isso da forma do Vasto Lorde).

### O corte (`fireCrescent`)

Getsuga Dangai e Getsuga Final são o mesmo motor: um arco vertical que anda na
mira 3D, com o meio na frente e as pontas pra trás. O acerto é medido no
referencial do corte (`crescentFrame`: frente, altura, largura), não numa
esfera — por isso ele pega quem está 3 blocos acima e não pega quem está 6 pro
lado. Anda 4 blocos por tick em 5 sub-passos. O visual é fio claro
(`dangai:borda`), corpo azul espalhado pelo trecho andado no tick (senão vira
um carimbo a cada 4 blocos) e raios pretos em zigue-zague (`dangai:raio`).
O Omnidirectional usa o modo `lite` (menos partícula por corte) porque são 8
de uma vez e o anti-lag corta o que passa de ~80 partículas por tick.

### Desfazer ataques de tier ≤ 4

Os ataques que viajam se registram em `travellingAttacks` (`trackAttack` +
`touchAttack` a cada tick com posição e raio): `fireCrescentWave` (todos os
getsugas antigos), `fireEnergySphere` (todos os ceros), Lanza del Relámpago,
Tripleshot do Byakuya, Tsunami, estacas do Hitsugaya, projéteis da White Wave
e o míssil do Jakuhō. O corte do Dangai, a cada sub-passo, desfaz o que estiver
no caminho com dono de tier ≤ 4: o loop do ataque vê `cancelled` e para sem
dano nem explosão, e o dono recebe aviso. Ataque que para de dar
`touchAttack` sai do registro sozinho em 2s. **Ataque novo que viaja deve se
registrar**, senão atravessa o Getsuga.

### Arrogant's Counter

5s parado (lentidão 255 + pulo travado). O primeiro dano que alguém tenta dar
nele (`dangaiCounterIntercept`, no topo do `dealDamage`) não entra: ele aparece
atrás de quem bateu, com a mira reta, e paralisa o atacante 3,5s. 2s depois,
dois cortes de 250 e um Getsuga Dangai à queima-roupa.

### "Let's fight somewhere else."

Pega quem está na mira (ou o mais perto a 5 blocos), segura na frente na
altura do rosto como o Face Hold, e avança 1,5 bloco por tick na mira. Quando
o corpo do alvo ou o dele encosta num bloco sólido (grama, flor, tocha e afins
não contam), explode: 400 no alvo, e solta. Sem bloco em 60 blocos, explode no
ar.

### Mugetsu

Agachar + usar a Zangetsu com o medidor em 100%: veste o peitoral
`dangai:mugetsu_chest` (attachable gerado por `tools/mugetsu_model.py`: cabelo
até o meio das pernas, pano na boca, faixas no peito e no braço direito,
hakama rasgada), "MUGETSU" na tela de quem está a 120 blocos (e escuridão de
3s em quem não é ele), e 1s depois o **Getsuga Tenshou Final**: preto, raio
3× o do Super Nuke (16,2), 10000 de dano, atravessa Respira, Intocable e
guarda, e desfaz qualquer ataque no caminho. **5s depois do Mugetsu o
personagem é desativado** (`endMugetsu`), mesmo se ele morrer no meio.

O **Aizen Hōgyoku** atingido não toma os 10000: fica com 10% da vida máxima e
**enfraquecido** (`mugetsuWeakened`): não cura (o loop do Hōgyoku pula e a
regeneração é arrancada todo segundo), lentidão 3, não usa item nenhum (o
`itemUse` barra antes de tudo, sem gastar cooldown) e não causa dano (o
`dealDamage` ignora quem ele for a fonte). Switch, Kanzen e casulo são
desfeitos e a Evolution para. Dura até ele morrer, desativar ou sair —
preparado pro selamento do próximo update.

## Animações

`RP/animations/vizard.animation.json` define cinco animações e cada ataque tem
a sua:

| Animação | Quem usa |
|---|---|
| `cast` | Getsuga Barrage, Super Nuke, Bullet Hell |
| `slash` | m1 (Bankai e Vasto Lorde), Dash 'n Slash |
| `slam` | Descent Tenshō, White's Showdown |
| `skyward` | Everything But the Rain |
| `roar` | Grito del Diablo, ascensão pro Vasto Lorde |

**A armadilha:** `playAnimation` SEM `controller` é sobrescrito na hora pelos
animation controllers do próprio player — a animação dispara e some no mesmo
tick, sem erro nenhum. Cada uma aqui tem o controller dela (e por isso duas
podem se sobrepor). O stub da simulação **recusa** `playAnimation` sem
controller, pra esse silêncio não voltar. O `validate.py` confere que toda
animação citada no script existe no RP.

**Limite conhecido:** isso anima o modelo em **terceira pessoa**. O braço em
primeira pessoa é renderizado separado pelo Bedrock e não segue `playAnimation`,
então quem lança não vê a própria mão — quem está olhando vê (e o próprio
jogador vê em F5). Por isso `playVizardAnimation` também solta um clarão de
partícula na altura da mão (`flashCastingHand`): é o único retorno visual do
ataque que aparece em primeira pessoa.

## Bugs conhecidos / limitações em aberto

**Achados na 1.19.25 importada** (o validador/simulação pegaram):

- ~~`tierOfPlayer` não existia~~ **RESOLVIDO** — Pressão Espiritual, Air Step,
  troca de skill genérica e skills do Gin/Shunsui lançavam ReferenceError
  engolido pelo anti-lag.
- ~~Sons inexistentes na Soi Fon e na Harribel~~ **RESOLVIDO** (armadilha 13).
- ~~Máscara do Shinji sem os ossos pais do rig~~ **RESOLVIDO** — não
  acompanhava o corpo ao agachar/nadar.
- **Cooldown visual ≠ cooldown do script** em 12 itens: as 8 skills do Vizard
  (o script ficou 10s mais longo que o item) e as 4 do Shinji (item com 0.05s).
  O item mostra "pronto" antes da hora. Não mexi: `validate.py` lista.
- **Poison Slash (Mayuri) não aplica mais a lentidão** — `POISON_SLASH` ainda
  tem `slownessAmplifier`/`slownessTicks`, mas nada lê. Pode ter sido de
  propósito.
- **Sakura's Distraction gasta o cooldown antes de conferir o alvo**: mirando
  em mob (não player/boneco) ela avisa e recarrega do mesmo jeito.
- Sobras inofensivas: `byakuya_coating.png` sem item, partículas `shinji:red` e
  `shinji:white` sem uso, `training_dummy_spawn_egg` nunca citado no script.

1. ~~Dano do m1 não escala com vida virtual.~~ **RESOLVIDO.** Os 13 itens de m1
   têm `minecraft:damage: 0` e o dano sai inteiro do script. Sobra 1 de dano
   vanilla por golpe (o soco base, que não dá pra zerar) — desprezível, e o
   simulador não modela dano vanilla, então esse 1 não aparece nos checks.
2. **Awakening de todo mundo dura 100s** (drena 1%/s). Isso é o sistema
   genérico, nunca foi pedido personagem por personagem.
3. **Medidor de awakening enche sem parar** para quem não tem forma desperta —
   hoje todos têm, então não aparece.
4. **Pesquisa marca qualquer entidade**, não só player, e o +50% vale pro dano
   de **todos**, não só do Ulquiorra. Foi leitura minha do texto.
5. ~~A forma Ira não fica grande no jogo.~~ **RESOLVIDO.** Era a armadilha 9: o
   marcador não entrava na offhand. Ver acima.
6. **O "dente de tubarão no braço" da Harribel é um item, não um attachable.**
   O addon não usa attachable em lugar nenhum; a arma da Resurrección é o item
   `harribel:m1_diente` na mão, com textura de dente.
7. **A hitbox do Yammy gigante continua 1,8 bloco.** O modelo escala pra 10
   blocos, mas acertar ele usa a caixa normal. Ver a armadilha 7.
6. **O addon sobrescreve `RP/entity/player.entity.json`**, então conflita com
   outro addon que mexa no mesmo arquivo e pode defasar quando a Mojang mudar o
   vanilla. O `validate.py` confere que as chaves principais continuam lá.
5. **Sem limite de um personagem por player no servidor** — dois players podem
   escolher o mesmo.
6. **`fireCrescentWave` usa `dmgMultiplier(player)` dentro do interval** sem
   try/catch: se o lançador sair do mundo no meio da onda, lança uma vez.

## Números que EU escolhi (não foram especificados)

Tunar à vontade — estão em `DAMAGE` e `SKILL_COOLDOWN_TICKS`.

| Skill | O que chutei |
|---|---|
| Flash Slash / Stomp / Hunt (Kenpachi) | cooldown 18s / 12s / 20s |
| Poison Slash (Mayuri) | "lentidão inf" = amplifier 255 |
| Destruir (Grimmjow) | 270 **no total**, não por corte; cd 20s |
| Rugido (Grimmjow) | cd 25s, raio 6 |
| Pesquisa (Ulquiorra) | dura 15s, cd 20s |
| Nihil | 30% da vida **atual** (não da máxima); cd 25s |
| Enigma | cd 40s |
| Cero Oscuras | cd 35s |
| Lanza del Relámpago | 900 de dano, raio 18, cd 60s |
| Hell's Cut desespero (Kenpachi) | 3× base **e** o +50% por cima = 337,5 |
| Bloqueio | cooldown conta do fim da guarda, não da ativação; faísca + tag na actionbar |
| Ruir del Rey (Barragan) | área não especificada: raio 12 em volta dele |
| El Maldito (Barragan) | li "4 segundos" como a duração da névoa **e** da deterioração |
| La Muerte (Barragan) | cooldown 2 min (não especificado) |
| Resurrección: Arrogante | vida não especificada: mantém os 3000 da base, sem cura de graça |
| White's Showdown (Vizard) | 150 por onda, 4 ondas = 600 no total |
| Everything But the Rain | metade dos pingos mira perto de alguém; espalhados de verdade acertavam ~1 vez |
| Dash 'n Slash | 6 mini avanços de 4 ticks |
| Hollowficação | mantém os 1500 da base (só o Vasto Lorde sobe pra 3000) |
| Deterioração (Barragan) | 80/s em todas as cinco skills (era 100) |
| Carbon-Copy (Szayelaporro) | dura 10s, bate a cada 1,5s; 20 de dano se o alvo não tem personagem |
| Learn and Adapt | dura 15s, igual à Pesquisa |
| Posse (Szayelaporro) | 20 de dano por investida, raio 20, alcance de caça 40 |
| Gabriel (Szayelaporro) | o estouro do hospedeiro dá 100 num raio de 4 |
| Cero Metralleta (Starkk) | 30 por bala (era 60 com 1 fileira; agora são 4 por disparo) |
| Aqua's Dash (Harribel) | 80 de dano de contato, 24 blocos |
| M1 do Dente de Tubarão (Harribel) | 90 de dano |
| Tsunami / Vórtice (Harribel) | largura 14 e altura 6; raio do vórtice 7 |
| Illusion's Mastery (Aizen) | dura 10s; triângulo de raio 2,2 girando; "lentidão" do golpe = Lentidão III por 3s |
| Betrayal (Aizen) | 1,6 bloco atrás; m1 dobrado por 5s (do 1º teleporte até 1s depois do 5º) |
| Fool's Trick (Aizen) | paralisia de 1,5s (só até o corte), corte 0,5s depois do "Achou mesmo ser digno?" |
| Counter (Aizen) | conta por atacante; sem cooldown próprio (a paralisia de 3s já segura) |
| Kurohitsugi (Aizen) | caixa também com 10 de altura; dano em rajadas de 250 a cada 0,5s |
| Ilusões (Aizen) | quais exigem a marca: Mastery, Fool's Trick e Counter — Betrayal ficou "física" |
| Illusions (Hōgyoku) | as três exigem a marca da Kyōka; mirar em quem não tem recusa sem gastar |
| Switch (Hōgyoku) | clone 1,6 bloco atrás do alvo; depois da troca ele segura 1,5s na frente; só o m1 do alvo troca |
| False Skill (Hōgyoku) | a skill fingida é sorteada; o teleporte vem 0,5s depois e só se o alvo está no alcance dela |
| Kanzen Saimin (Hōgyoku) | 8 clones em anel de raio 3,2; dura no máximo 15s; clone golpeado só some |
| Kurohitsugi Encantada | caixa 14 (a do Capitão é 10) |
| Fragor | raio 30 (maior do addon); estilhaços com alcance 45 que param em bloco |
| UltraFragor | raio 40, estilhaços de 200 com alcance 60 |
| Fragor Barrage | 5 explosões de raio 15, 0,6s entre elas, centradas no Aizen |
| Evolution | o bônus de dano (+25% em 100%) continua valendo no Monster; a cura do Monster é 200 fixa (os +20 por degrau ficam na forma base) |
| Casulo | 3×4×3 de concreto branco, inquebrável |
| Monster Aizen | permanente (não drena); aura roxa |
| Getsuga Dangai | 8 blocos de altura, 4 blocos por tick, alcance 56; respeita Respira, Intocable e guarda do alvo (desfazer é só pra ataque, não pra defesa) |
| Omnidirectional | o primeiro corte sai pra onde ele olha; quem está entre dois cortes toma um só |
| Arrogant's Counter | qualquer dano de alguém dispara (skill e DoT também); cortes de 250; atacante paralisado 3,5s |
| Let's fight somewhere else | 1,5 bloco por tick, no máximo 60 blocos (sem parede, explode no ar); só o alvo toma os 400 |
| Mugetsu | Getsuga Final 1s depois; desfaz ataque de qualquer tier; escuridão de 3s em quem está perto |
| Aizen enfraquecido | o estado dura até morrer/desativar; outros golpes ainda podem matar ele |

## Próximos passos sugeridos

1. **Testar o Aizen no jogo**, principalmente o que a simulação não enxerga: o
   visual do clone, se o nome do Aizen some mesmo quando ele fica invisível, e
   se o golpe no clone chega pelo `entityHitEntity` ou pela rede de segurança
   do `damage_sensor`.
   No Hōgyoku: se a troca do Switch fica natural com o ping, o tamanho visual
   do Fragor/UltraFragor (muita partícula de uma vez — o anti-lag corta a
   `large_explosion`) e o casulo em terreno irregular.
   Na Daiguren: se as asas/cauda aparecem com o outro resource pack ativo.
   No Dangai: o visual do Getsuga (e o do Final, que é enorme) com o anti-lag,
   o arrastão do "Let's fight" em terreno irregular e a roupa do Mugetsu.
2. **Invulnerabilidade pós-dano**: várias skills do addon batem a cada tick
   (Grito del Diablo, Rugido del Diablo) ou a cada 4–6 ticks (Palacio de las
   Espadas, Los Nueve Aspectos). Se o `applyDamage` respeitar a janela de
   invulnerabilidade do Bedrock, elas entregam bem menos do que o número diz.
   A Kurohitsugi já soma em rajadas de 10 ticks por isso; vale medir no jogo
   antes de mexer nas outras.
3. **Sincronizar os cooldowns visuais** do Vizard e do Shinji com o script
   (lista no `validate.py`).
4. **Raças vazias**: Quincy e Fullbringer existem no seletor sem ninguém.
5. **Som próprio**: hoje tudo reusa sons vanilla.

## Receita: adicionar personagem novo

1. Registrar em `CHARACTERS` **e** em `CHARACTER_RACE_TIER` (senão não aparece no menu).
2. Criar os itens em `BP/items/*.json` (m1 leva `minecraft:damage: 0`).
3. Desenhar as texturas em `tools/textures.py` (grid 16×16 + paleta) e rodar
   `gen_textures.py`.
4. Registrar em `RP/textures/item_texture.json`.
5. Ligar as skills: `case` no switch do `itemUse`, cooldown, nome, dano,
   `MELEE_WEAPONS`.
6. Skill que lança algo que **viaja** (onda, cero, projétil): registrar com
   `trackAttack` + `touchAttack` e parar quando `attack.cancelled`, senão o
   Getsuga do Dangai não consegue desfazer ela.
7. Cobrir na simulação (`sim/run.mjs`).
8. `python3 tools/bump_version.py minor && python3 tools/build.py`
