# Bleach battlegrounds — estado do projeto

Documento de passagem de sessão. O repositório é a fonte da verdade: tudo está
commitado e enviado.

- **Repo**: `Felipe9272727/Jujubas-gulosas`, branch `claude/blissful-keller-vni5lv`
- **Build**: `python3 tools/build.py` → `dist/BleachBattlegrounds.mcaddon`
- **Estado**: 428 checks na simulação, zero exceções. Packs na versão 1.8.0.

## Como trabalhar aqui

```bash
python3 tools/build.py          # valida + simula + empacota (falha se algo quebrar)
python3 tools/validate.py       # JSON, itens, texturas, manifests, versões
python3 tools/gen_textures.py   # renderiza os grids de tools/textures.py em PNG
python3 tools/bump_version.py minor   # OBRIGATÓRIO a cada release de conteúdo
node --import ./sim/register.mjs sim/run.mjs   # só a simulação
```

O `build.py` roda tudo e **se recusa a empacotar** se qualquer etapa falhar.

## Estrutura

```
BP/                     behavior pack
  manifest.json         versão dos packs (ver "cache de pack" abaixo)
  items/*.json          45 itens, um arquivo cada (format_version 1.26.40)
  scripts/main.js       ~3570 linhas: TODO o gameplay
RP/                     resource pack
  particles/*.json      sakura:leaf, mayuri:poison_fog, grimmjow:cero, ulquiorra:oscuras
  textures/items/*.png  45 texturas
  textures/item_texture.json
tools/
  textures.py           grids de caracteres + paletas = FONTE das texturas
  gen_textures.py       grid 16x16 -> PNG 64x64 (upscale nearest 4x)
  validate.py           checagem estática
  bump_version.py       sobe a versão dos dois packs e sincroniza dependências
  build.py              pipeline + empacotamento
sim/
  stubs/                @minecraft/server e server-ui falsos
  run.mjs               ~2200 linhas, 424 checks
```

### A simulação

`sim/` reimplementa o suficiente da API do Bedrock pra rodar o `main.js` no
Node: scheduler de ticks real (todo `runInterval`/`runTimeout` executa),
entidades que ficam inválidas ao morrer, efeitos que expiram, inventário,
dynamic properties, raycast e formulários com resposta roteirizada.

**O stub é propositalmente mais rígido que o jogo** em pontos onde o Bedrock
falha em silêncio — por exemplo, `addEffect` recusa `amplifier > 255`. Foi
assim que quase todos os bugs abaixo apareceram antes de ir pro jogo.

## Elenco

O seletor é separado por **arcos**; agachar + usar o seletor troca de arco.
Personagem que não estiver em `ARCS` **não aparece no menu**.

### Invasão à Soul Society
| Personagem | Vida | Awakening |
|---|---|---|
| Ichigo Kurosaki | 200 | Tensa Zangetsu (troca os 5 itens) + Máscara Hollow |
| Byakuya Kuchiki | 200 | Super ataque: Kageyoshi **ou** Senkei (carrega 5s agachado) |
| Zaraki Kenpachi | 300 | Pressão: burst 50x50 + 50% de dano |
| Mayuri Kurotsuchi | 180 | Super ataque: Konjiki Ashisogi Jizō |

### Arrancar / Hueco Mundo
| Personagem | Vida | Awakening |
|---|---|---|
| Grimmjow Jaegerjaquez | 800 | La Pantera — "Mutile, Pantera" (1200, speed 5, regen 4) |
| Ulquiorra Cifer | 1600 | Murciélago — "Confine, Murciélago" (2000) |
| Coyote Starkk | 4000 | Los Lobos — "Kick About, Los Lobos" (alterna Starkk ↔ Lilynette) |
| Yammy Llargo | 1000 | Ira (10000 de vida, lento e pesado, cura 100 a cada 4s) |
| Tier Harribel | 2600 | Tiburón — "Reduce a cenizas, Tiburón" (3000) |
| Barragan Louisenbairn | 3000 | Arrogante — "Envelhece, Arrogante!" (mesma vida) |
| Szayelaporro Granz | 750 (752) | Fornicarás — "Sorva...Fornicarás" (1000, cura 40 a cada 6s) |
| Ichigo (pós-treino Vizard) | 1500 | Hollowficação → Vasto Lorde aos 100 de vida (3000) |

## Sistemas genéricos (reusar, não duplicar)

| Sistema | O que faz |
|---|---|
| `CHARACTERS` | Registro: `health`, `items` (slot→item), `awakening` ou `superAttack` |
| `ARCS` | Agrupamento do seletor |
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

## Disputa da tecla agachar + m1

A mesma tecla faz cinco coisas. A ordem é: **awakening → máscara → super ataque
→ câmera alta / troca de persona → bloqueio**. As três primeiras só ficam com a
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

## Próximos passos sugeridos

1. **Resolver o item 1 dos bugs** (m1 escalado) antes de adicionar personagem com
   vida alta — é a inconsistência mais visível hoje.
2. **Mais arcos**: a estrutura já suporta. Falta o arco dos Fullbringers, o da
   Guerra Sangrenta, etc.
3. **Bankai do Mayuri troca a m1?** Hoje a Konjiki não muda arma nenhuma.
4. **Balancear entre arcos**: Soul Society vai de 180 a 300 de vida, Hueco Mundo
   de 800 a 2000. Um Ichigo não encosta num Ulquiorra. Talvez arcos não devam se
   enfrentar, ou o Ichigo precise de escalonamento.
5. **Som próprio**: hoje tudo reusa sons vanilla (`mob.wither.shoot`, etc).

## Receita: adicionar personagem novo

1. Registrar em `CHARACTERS` **e** em `ARCS` (senão não aparece no menu).
2. Criar os itens em `BP/items/*.json` (m1 leva `minecraft:damage: 0`).
3. Desenhar as texturas em `tools/textures.py` (grid 16×16 + paleta) e rodar
   `gen_textures.py`.
4. Registrar em `RP/textures/item_texture.json`.
5. Ligar as skills: `case` no switch do `itemUse`, cooldown, nome, dano,
   `MELEE_WEAPONS`.
6. Cobrir na simulação (`sim/run.mjs`).
7. `python3 tools/bump_version.py minor && python3 tools/build.py`
