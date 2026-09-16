# Bleach battlegrounds — estado do projeto

Documento de passagem de sessão. O repositório é a fonte da verdade: tudo está
commitado e enviado.

- **Repo**: `Felipe9272727/Jujubas-gulosas`, branch `claude/blissful-keller-vni5lv`
- **Build**: `python3 tools/build.py` → `dist/BleachBattlegrounds.mcaddon`
- **Estado**: 316 checks na simulação, zero exceções. Packs na versão 1.5.1.

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
  run.mjs               ~1740 linhas, 316 checks
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

## Bugs conhecidos / limitações em aberto

1. **Dano do m1 não escala com vida virtual.** O dano base do m1 vem do
   `minecraft:damage` do item, que é vanilla e não passa pelo `dealDamage`.
   Contra personagem escalado (La Pantera, Ulquiorra) o m1 pesa até ~1,9× mais.
   *Correção*: zerar `minecraft:damage` nos itens de m1 e aplicar o dano todo
   pelo script no `entityHitEntity`. Também elimina a sincronia manual do "-1".
2. **Awakening de todo mundo dura 100s** (drena 1%/s). Isso é o sistema
   genérico, nunca foi pedido personagem por personagem.
3. **Medidor de awakening enche sem parar** para quem não tem forma desperta —
   hoje todos têm, então não aparece.
4. **Pesquisa marca qualquer entidade**, não só player, e o +50% vale pro dano
   de **todos**, não só do Ulquiorra. Foi leitura minha do texto.
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
2. Criar os itens em `BP/items/*.json` (m1 leva `minecraft:damage` = dano − 1).
3. Desenhar as texturas em `tools/textures.py` (grid 16×16 + paleta) e rodar
   `gen_textures.py`.
4. Registrar em `RP/textures/item_texture.json`.
5. Ligar as skills: `case` no switch do `itemUse`, cooldown, nome, dano,
   `MELEE_WEAPONS`.
6. Cobrir na simulação (`sim/run.mjs`).
7. `python3 tools/bump_version.py minor && python3 tools/build.py`
