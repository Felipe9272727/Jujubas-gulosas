import {
  world,
  system,
  EntityDamageCause,
  ItemStack,
  EquipmentSlot,
  BlockPermutation,
  Dimension,
  InputPermissionCategory,
} from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";
import { createShinji } from "./shinji.js";

/* =========================================================
   OTIMIZAÇÃO ANTI-LAG
   Tudo aqui é protegido por try/catch: se alguma parte não puder ser aplicada
   nessa versão do jogo, o addon roda igual, só sem aquela otimização.
   ========================================================= */

// Tempo real entre um tick e outro. Se o mundo está engasgando, o addon desenha
// MENOS partículas em vez de piorar o lag (e de derrubar quem joga no celular).
let __lastTickMs = Date.now();
let __tickGapMs = 50;
system.runInterval(() => {
  const nowMs = Date.now();
  __tickGapMs = nowMs - __lastTickMs;
  __lastTickMs = nowMs;
}, 1);

// Loops criados DURANTE o jogo (as skills) que erram 20 ticks seguidos são
// desligados, e o erro de qualquer loop vira um único aviso no log. Antes um
// loop quebrado gritava no log todo tick, pra sempre.
let __bootDone = false;
system.run(() => {
  __bootDone = true;
});
try {
  const rawRunInterval = system.runInterval.bind(system);
  system.runInterval = (callback, tickInterval) => {
    const createdDuringGame = __bootDone;
    let failures = 0;
    let id;
    id = rawRunInterval(() => {
      try {
        callback();
        failures = 0;
      } catch (e) {
        failures++;
        if (failures === 1) console.warn(`[anti-lag] erro num loop: ${e}`);
        if (createdDuringGame && failures >= 20) {
          try {
            system.clearRun(id);
          } catch (e2) {}
        }
      }
    }, tickInterval);
    return id;
  };
} catch (e) {}

// Limite de partículas em "balde de fichas". O limite antigo cortava tudo que
// passava de 80 por tick e, como os círculos (Enigma, Senkei) são desenhados de
// uma vez só, saía só uma parte do círculo. Agora o balde enche a cada tick e
// permite rajadas grandes (um círculo inteiro cabe folgado); só o gasto CONTÍNUO
// alto (várias skills ao mesmo tempo) é limitado, e quando o balde esvazia as
// partículas são reduzidas de forma espalhada, sem sumir um pedaço inteiro.
// O dano NÃO depende de partícula: só o visual fica mais enxuto.
try {
  const rawSpawnParticle = Dimension.prototype.spawnParticle;
  const HEAVY_PARTICLES = new Set([
    "minecraft:large_explosion",
    "minecraft:huge_explosion_emitter",
  ]);
  let tokens = 320;
  let lastRefillTick = system.currentTick;
  let pHeavy = 0;
  Dimension.prototype.spawnParticle = function (effectName, location, molang) {
    const now = system.currentTick;
    if (now !== lastRefillTick) {
      // rendimento cai sozinho se o mundo está lento
      const rate = __tickGapMs > 90 ? 20 : __tickGapMs > 65 ? 45 : 80;
      const cap = __tickGapMs > 90 ? 110 : __tickGapMs > 65 ? 200 : 320;
      tokens = Math.min(cap, tokens + Math.min(10, now - lastRefillTick) * rate);
      lastRefillTick = now;
      pHeavy = 0;
    }
    if (tokens < 1) return;
    // balde baixo: reduz de forma espalhada em vez de cortar um pedaço da forma
    if (tokens < 60 && Math.random() > tokens / 60) return;
    // explosão grande é a partícula mais pesada do jogo: só 1 em cada 3
    if (HEAVY_PARTICLES.has(effectName) && pHeavy++ % 3 !== 0) return;
    tokens -= 1;
    return molang
      ? rawSpawnParticle.call(this, effectName, location, molang)
      : rawSpawnParticle.call(this, effectName, location);
  };
} catch (e) {}

// getEntities sem filtro devolve item no chão, orbe de xp, flecha... e o addon
// só quer quem tem vida. Excluir esses tipos na busca poupa o loop de cada skill.
try {
  const rawGetEntities = Dimension.prototype.getEntities;
  const SKIPPED_ENTITY_TYPES = [
    "minecraft:item",
    "minecraft:xp_orb",
    "minecraft:arrow",
    "minecraft:falling_block",
    "minecraft:snowball",
    "minecraft:egg",
    "minecraft:ender_pearl",
    "minecraft:fishing_hook",
    // partes do Myō'ō do Komamura: so visual, nunca alvo
    "komamura:braco",
    "komamura:punho",
    "komamura:guarda",
  ];
  Dimension.prototype.getEntities = function (options) {
    if (!options) {
      return rawGetEntities.call(this, { excludeTypes: SKIPPED_ENTITY_TYPES });
    }
    if (options.type || options.excludeTypes || options.families) {
      return rawGetEntities.call(this, options);
    }
    return rawGetEntities.call(this, {
      ...options,
      excludeTypes: SKIPPED_ENTITY_TYPES,
    });
  };
} catch (e) {}

/* =========================================================
   COMBATES MULTIVERSAIS - main.js
   Sistema de personagens multiversais (PvP-ready, multiplayer)
   ========================================================= */

const DP = {
  character: "mv:character",
  awakening: "mv:awakening",
  awakened: "mv:awakened",
  dashCd: "mv:cd_dash",
  coatingEnd: "mv:coating_end",
  maskEnd: "mv:mask_end",
  byakuyaWeapon: "mv:byakuya_weapon", // "base" | "senkei" | "finisher"
  starkkForm: "mv:starkk_form", // "starkk" | "lilynette"
  tallView: "mv:tall_view", // camera alta da forma gigante
  race: "mv:race", // indice da raça escolhida no seletor
  healthScale: "mv:health_scale", // vida virtual / vida real
  markedEnd: "mv:marked_end", // marca da Pesquisa do Ulquiorra
  blockEnd: "mv:block_end", // bloqueio universal (agachar + m1)
  blockCd: "mv:cd_block",
  respiraEnd: "mv:respira_end", // imunidade a longo alcance do Barragan
  muerteArmed: "mv:muerte_armed", // La Muerte esperando o primeiro toque
  markMultiplier: "mv:mark_mult", // quanto a marca multiplica o dano recebido
  teatroUsed: "mv:teatro_used", // Teatro de Títeres e uso unico por awakening
  frozenEnd: "mv:frozen_end", // preso no Teatro: nao ataca nem usa skill
  eyesCut: "mv:cut_eyes", // mutilacoes do Teatro, valem ate alguem morrer
  legCut: "mv:cut_leg",
  armCut: "mv:cut_arm",
  heartCut: "mv:cut_heart",
  gabrielArmed: "mv:gabriel_armed", // Gabriel esperando marcar um hospedeiro
  trueForm: "mv:true_form", // segunda fase do awakening (Vasto Lorde)
  hierroEnd: "mv:hierro_end", // Hierro do Nnoitra: dano recebido reduzido
  pressureEnabled: "mv:pressure_enabled",
  genericSkill: "mv:generic_skill",
  pressureActiveUntil: "mv:generic_pressure_until",
  pressureCooldown: "mv:generic_pressure_cd",
  airStepActive: "mv:air_step_active",
  airStepBlock: "mv:air_step_block",
  infiniteAwakening: "mv:infinite_awakening",
  intocableEnd: "mv:intocable_end", // Declaración del Intocable
  aaronieroAbsorbed: "mv:aaroniero_absorbed",
  aaronieroMaskEnd: "mv:aaroniero_mask_end",
  aaronieroDevouredCount: "mv:aaroniero_devoured_count",
  tosenVisored: "mv:tosen_visored", // Visored do Tosen: forma alternativa (nao usa o medidor de awakening)
  mayuriParalysis: "mv:mayuri_paralysis",
  mayuriParalysisX: "mv:mayuri_paralysis_x",
  mayuriParalysisY: "mv:mayuri_paralysis_y",
  mayuriParalysisZ: "mv:mayuri_paralysis_z",
  noDash: "mv:cd_nodash", // Ice Age do Hitsugaya: sem dash por um tempo
  kyokaMark: "mv:kyoka_mark", // viu a Kyōka Suigetsu (m1 do Aizen): pra sempre sob as ilusões
  kyokaBlock: "mv:kyoka_block", // bloco marcado pela Kyōka ({x,y,z,dim}), destino do agachar duplo
  evolution: "mv:evolution", // Evolution do Aizen Hōgyoku (0-100)
  aizenIllusion: "mv:aizen_illusion", // ilusao escolhida no item Illusions (0-2)
  monsterResist: "mv:monster_resist", // passos de 5% de resistencia do Monster Aizen
};

// Paralisia do Piercing Shinso do Gin: id da entidade -> tick limite. O isFrozen()
// tambem le esse mapa, entao o paralisado fica preso pelas mesmas travas do Teatro.
const ginParalyzed = new Map();

const BASE_SPEED_AMPLIFIER = 1; // speed 2 pra todo personagem
const REGEN_AMPLIFIER = 1; // regen 2 pra todo personagem

// declarado antes do CHARACTERS porque o registro referencia esse valor
const HOLLOW_MASK_DURATION_TICKS = 600; // 30s

// item que fica sempre locked no ultimo slot da hotbar (slot 8)
const SELECTOR_ITEM = "multiversal:character_selector";
const SELECTOR_SLOT = 8;
const CHEAT_OPTIONS_ITEM = "multiversal:cheat_options";
const GENERIC_SKILL_ITEM = "multiversal:generic_skills";
const GENERIC_SKILL_SLOT = 7;

// registro de personagens - estrutura pensada pra crescer com o addon
const CHARACTERS = {
  ichigo: {
    id: "ichigo",
    name: "Ichigo Kurosaki (Shikai)",
    health: 700,
    // slot do hotbar -> item id
    items: {
      0: "ichigo:m1_zangetsu",
      1: "ichigo:getsuga_slam",
      2: "ichigo:getsuga_slash",
      3: "ichigo:getsuga_run",
      4: "ichigo:getsuga_tenshou",
    },
    awakening: {
      name: "Tensa Zangetsu (Awakening)",
      health: 1100,
      speedAmplifier: 3, // speed 4
      triggerItem: "ichigo:m1_zangetsu", // agachado + usar esse item com awakening 100%
      items: {
        0: "ichigo:tensa_m1",
        1: "ichigo:getsuga_barrage",
        2: "ichigo:getsuga_tenshou_bankai",
        3: "ichigo:double_getsuga",
        4: "ichigo:nuke_tenshou",
      },
      hollowMask: {
        triggerItem: "ichigo:tensa_m1", // agachado + usar a zangetsu bankai
        healthThreshold: 50,
        durationTicks: HOLLOW_MASK_DURATION_TICKS,
        bigRegenTicks: 120, // 6s
        bigRegenAmplifier: 5, // regen 6
        cooldownHalvedItems: [
          "ichigo:getsuga_barrage",
          "ichigo:getsuga_tenshou_bankai",
          "ichigo:double_getsuga",
          "ichigo:nuke_tenshou",
        ],
      },
    },
  },
  byakuya: {
    id: "byakuya",
    name: "Byakuya Kuchiki (Shikai)",
    health: 700,
    items: {
      0: "byakuya:m1_senbonzakura",
      1: "byakuya:tripleshot",
      2: "byakuya:disperse",
      3: "byakuya:bloodshed",
      4: "byakuya:sakura_distraction",
    },
    // super ataque no lugar de uma segunda forma persistente
    superAttack: {
      onTrigger: "byakuya",
      triggerItem: "byakuya:m1_senbonzakura",
      chargeTicksForSenkei: 100, // 5s agachado segurando a m1 = desbloqueia o Senkei
      kageyoshi: {
        radius: 15, // area 30x30
        dotPerSecond: 70,
        durationSeconds: 12,
        slownessAmplifier: 1,
        blocksDash: true,
      },
      senkei: {
        radius: 15, // area 30x30
        weapon: "byakuya:m1_senbonzakura_senkei",
        finisherWeapon: "byakuya:m1_senbonzakura_finisher",
        maxDurationTicks: 1800, // 90s - trava de seguranca caso ninguem desative manualmente
      },
    },
  },
  kenpachi: {
    id: "kenpachi",
    name: "Zaraki Kenpachi",
    health: 1700,
    items: {
      0: "kenpachi:m1_zanpakuto",
      1: "kenpachi:flash_slash",
      2: "kenpachi:stomp",
      3: "kenpachi:hunt",
      4: "kenpachi:hells_cut",
    },
    // o awakening dele nao troca item nem aumenta vida: e um burst de pressao
    // espiritual seguido de um buff permanente de dano
    awakening: {
      name: "Pressão (tapa-olho removido)",
      triggerItem: "kenpachi:m1_zanpakuto",
      damageMultiplier: 2, // dobra o dano de todas as skills e do m1
      onActivate: "pressure",
      pressure: {
        radius: 25, // area 50x50
        durationTicks: 60, // 3s parados e cegos
        dotPerSecond: 10,
        chatLine: "Que pressão espiritual tremenda!",
      },
      // com pouca vida, o Hell's Cut vira golpe de desespero
      desperation: {
        skill: "kenpachi:hells_cut",
        healthThreshold: 60,
        damageFactor: 3,
      },
    },
  },
  mayuri: {
    id: "mayuri",
    name: "Mayuri Kurotsuchi (Shikai)",
    health: 600,
    items: {
      0: "mayuri:m1_ashisogi_jizo",
      1: "mayuri:poison_slash",
      2: "mayuri:toxic_fog",
      3: "mayuri:regenerate",
      4: "mayuri:envenenar",
    },
    // Bankai como super ataque (nao troca item nem vida, igual ao Kageyoshi):
    // agachar + usar a m1 com o medidor em 100%
    superAttack: {
      onTrigger: "konjiki",
      triggerItem: "mayuri:m1_ashisogi_jizo",
      // mesma neblina da Toxic Fog, so que gigante e muito mais forte
      konjiki: {
        radius: 30, // area 60x60
        height: 3.2,
        durationTicks: 300, // 15s
        tickInterval: 10,
        refreshTicks: 30,
        mayuriPoison: { durationSeconds: 15, damagePerSecond: 40 },
        slownessAmplifier: 255, // "lentidao inf"
        particlesPerTick: 60, // area 25x maior que a da Toxic Fog
        endMessage: "§7A Konjiki Ashisogi Jizō se dissipou.",
      },
    },
  },
  grimmjow: {
    id: "grimmjow",
    name: "Grimmjow Jaegerjaquez",
    health: 800,
    items: {
      0: "grimmjow:m1_zanpakuto",
      1: "grimmjow:desgarra",
      2: "grimmjow:raza",
      3: "grimmjow:gran_rey_cero",
    },
    awakening: {
      name: "Resurrección: La Pantera",
      triggerItem: "grimmjow:m1_zanpakuto",
      health: 1200,
      speedAmplifier: 4, // speed 5
      regenAmplifier: 3, // regen 4
      onActivate: "battlecry",
      chatLine: "Mutile, Pantera",
      cryParticle: "grimmjow:cero",
      items: {
        0: "grimmjow:m1_garras",
        1: "grimmjow:destruir",
        2: "grimmjow:rugido",
        3: "grimmjow:arrancar_corazon",
        4: "grimmjow:disparo",
      },
    },
  },
  aaroniero: {
    id: "aaroniero",
    name: "Aaroniero Arruruerie (Espada 9)",
    health: 700,
    items: {
      0: "aaroniero:m1",
      1: "aaroniero:cero_metalico",
      2: "aaroniero:nejibana",
      3: "aaroniero:devorar",
      4: "aaroniero:mascara_kaien",
    },
    awakening: {
      name: "Awakening: Glotonería",
      triggerItem: "aaroniero:m1",
      health: 1100,
      items: {
        0: "aaroniero:m1_glotoneria",
        1: "aaroniero:tentaculos",
        2: "aaroniero:tridente_kaien",
        3: "aaroniero:cero_metalico_gloton",
        4: "aaroniero:banquete",
        5: "aaroniero:glotoneria",
      },
    },
  },
  ulquiorra: {
    id: "ulquiorra",
    name: "Ulquiorra Cifer",
    health: 1600,
    items: {
      0: "ulquiorra:m1_zanpakuto",
      1: "ulquiorra:gran_rey_cero",
      2: "ulquiorra:cero_bala",
      3: "ulquiorra:sonido",
      4: "ulquiorra:pesquisa",
    },
    awakening: {
      name: "Resurrección: Murciélago",
      triggerItem: "ulquiorra:m1_zanpakuto",
      health: 2000,
      onActivate: "battlecry",
      chatLine: "Confine, Murciélago",
      cryParticle: "ulquiorra:oscuras",
      cryPitch: 0.7,
      items: {
        0: "ulquiorra:m1_garras",
        1: "ulquiorra:nihil",
        2: "ulquiorra:enigma",
        3: "ulquiorra:cero_oscuras",
        4: "ulquiorra:lanza",
      },
      canFly: true,
      // Segunda Etapa: só pode ser ativada depois da Ressurrección, com 50%
      // do medidor restante. Agachar + usar a M1 novamente transforma a forma.
      trueForm: {
        name: "TRUE AWAKENING: Segunda Etapa",
        triggerItem: "ulquiorra:m1_garras",
        health: 2800,
        speedAmplifier: 2,
        canFly: true,
        armorPiece: "ulquiorra:segunda_chest",
        items: {
          0: "ulquiorra:m1_garras",
          1: "ulquiorra:cero_oscuras_triplo",
          2: "ulquiorra:nihil",
          3: "ulquiorra:enigma",
          4: "ulquiorra:lanza",
        },
      },
    },
  },
  starkk: {
    id: "starkk",
    name: "Coyote Starkk",
    health: 4000,
    items: {
      0: "starkk:m1_zanpakuto",
      1: "starkk:slash_barrage",
      2: "starkk:sideway_cuts",
      3: "starkk:crescent_canines",
      4: "starkk:kamarada",
    },
    // a Resurrección nao muda o teto de vida - so troca a forma de lutar.
    // agachado + usar a arma atual alterna entre Starkk (corpo a corpo,
    // reaproveita as 4 skills base) e a Lilynette (a distancia)
    awakening: {
      name: "Resurrección: Los Lobos",
      triggerItem: "starkk:m1_zanpakuto",
      health: 4000,
      onActivate: "battlecry",
      chatLine: "Kick About, Los Lobos",
      cryParticle: "starkk:reiatsu",
      items: {
        0: "starkk:m1_cuchillos",
        1: "starkk:slash_barrage",
        2: "starkk:sideway_cuts",
        3: "starkk:crescent_canines",
        4: "starkk:kamarada",
      },
      altForm: {
        starkkWeapon: "starkk:m1_cuchillos",
        lilynetteWeapon: "starkk:lilynette_shot",
        items: {
          0: "starkk:lilynette_shot",
          1: "starkk:rifle",
          2: "starkk:escopeta",
          3: "starkk:cero_metralleta",
        },
      },
    },
  },
  yammy: {
    id: "yammy",
    name: "Yammy Llargo",
    health: 1000,
    items: {
      0: "yammy:m1_punches",
      1: "yammy:punches_barrage",
      2: "yammy:face_hold",
      3: "yammy:wraths_smash",
      4: "yammy:wraths_punch",
    },
    awakening: {
      name: "Resurrección: Ira",
      triggerItem: "yammy:m1_punches",
      health: 6000,
      speedAmplifier: 0, // speed 1
      // a Ira troca a regeneracao passiva por uma cura em bloco
      regenAmplifier: null,
      onActivate: "battlecry",
      chatLine: "Os Espadas são numerados de 0-9, não de 1-10!",
      cryParticle: "yammy:wrath",
      cryPitch: 0.5,
      // individualidade da forma: lento e pesado, mas se cura em blocos
      extraEffects: [
        { effect: "slowness", amplifier: 0 }, // lentidao 1
        { effect: "mining_fatigue", amplifier: 1 }, // fadiga 2
      ],
      healPerInterval: { amount: 100, ticks: 80 }, // 100 de vida a cada 4s
      // Item invisivel travado na offhand. O player.entity.json do RP olha essa
      // slot por Molang e escala o modelo pra 10 blocos enquanto ele estiver la.
      // E o unico jeito de escalar UM player: nao existe setter de tamanho no
      // Script API, e mexer no minecraft:scale escalaria todo mundo.
      offhandMarker: "yammy:ira_marker",
      // agachar + usar os Punhos de la Ira alterna a camera pro alto da cabeca
      tallView: {
        triggerItem: "yammy:m1_ira",
        height: 9,
        back: 6,
      },
      items: {
        0: "yammy:m1_ira",
        1: "yammy:quebramundos",
        2: "yammy:cero_barrage",
        3: "yammy:rugido_diablo",
      },
    },
  },
  harribel: {
    id: "harribel",
    name: "Tier Harribel",
    health: 2600,
    items: {
      0: "harribel:m1_zanpakuto",
      1: "harribel:tiburon_slash",
      2: "harribel:shark_issues",
      3: "harribel:water_prison",
      4: "harribel:aquas_dash",
    },
    awakening: {
      name: "Resurrección: Tiburón",
      triggerItem: "harribel:m1_zanpakuto",
      health: 3000,
      onActivate: "battlecry",
      chatLine: "Reduce a cenizas, Tiburón",
      cryParticle: "harribel:agua",
      cryPitch: 1.4,
      items: {
        0: "harribel:m1_diente",
        1: "harribel:tsunami",
        2: "harribel:vortice",
        3: "harribel:maldita_agua",
      },
    },
  },
  barragan: {
    id: "barragan",
    name: "Barragan Louisenbairn",
    health: 3000,
    items: {
      0: "barragan:m1_zanpakuto",
      1: "barragan:arrogante_slash",
      2: "barragan:el_rei_oco",
      3: "barragan:royal_cleave",
      4: "barragan:withers_slashes",
    },
    awakening: {
      name: "Resurrección: Arrogante",
      triggerItem: "barragan:m1_zanpakuto",
      // a vida nao foi especificada pra Resurreccion: fica a mesma da base,
      // igual a Pressao do Kenpachi (e sem virar cura de graca)
      onActivate: "battlecry",
      chatLine: "Envelhece, Arrogante!",
      cryParticle: "barragan:podridao",
      cryPitch: 0.4,
      items: {
        0: "barragan:m1_arrogante",
        1: "barragan:ruir_del_rey",
        2: "barragan:respira",
        3: "barragan:el_maldito",
        4: "barragan:la_muerte",
      },
    },
  },
  szayelaporro: {
    id: "szayelaporro",
    name: "Szayelaporro Granz",
    health: 750,
    items: {
      0: "szayel:m1_zanpakuto",
      1: "szayel:rush_and_pierce",
      2: "szayel:ascendent_cut",
      3: "szayel:carbon_copy",
      4: "szayel:learn_and_adapt",
    },
    awakening: {
      name: "Resurrección: Fornicarás",
      triggerItem: "szayel:m1_zanpakuto",
      health: 1000,
      onActivate: "battlecry",
      chatLine: "Sorva...Fornicarás",
      cryParticle: "szayel:esporo",
      cryPitch: 1.2,
      // individualidade: 40 de vida a cada 6s (mesmo sistema da Ira do Yammy)
      healPerInterval: { amount: 40, ticks: 120 },
      items: {
        0: "szayel:m1_fornicaras",
        1: "szayel:teatro_de_titeres",
        2: "szayel:posse",
        3: "szayel:gabriel",
      },
    },
  },
  ichigo_vizard: {
    id: "ichigo_vizard",
    name: "Ichigo (pós-treino Vizard)",
    health: 1500,
    items: {
      0: "vizard:m1_bankai",
      1: "vizard:dash_n_slash",
      2: "vizard:getsuga_barrage",
      3: "vizard:descent_tensho",
      4: "vizard:super_nuke",
    },
    awakening: {
      name: "Hollowficação",
      triggerItem: "vizard:m1_bankai",
      // a Hollowficação nao muda o teto de vida: ela muda velocidade, cura e o
      // tamanho dos getsugas. Mas cura tudo ao ativar, como o pedido pede.
      speedAmplifier: 4, // speed 5
      healOnActivate: true,
      healPerInterval: { amount: 30, ticks: 100 }, // 30 a cada 5s
      waveScale: 1.6, // getsugas maiores
      armorPiece: "vizard:hollow_chest", // peitoral que troca a skin
      armorMessage: "§8§lA hollowficação tomou seu corpo. §r§7(máscara, chifres e shihakusho)",
      onActivate: "battlecry",
      chatLine: "Não me subestime.",
      cryParticle: "vizard:cero",
      cryPitch: 0.7,
      // Segunda fase: dispara sozinha quando a vida cai ate o limite.
      trueForm: {
        name: "TRUE AWAKENING: Vasto Lorde",
        healthThreshold: 100,
        health: 3000,
        speedAmplifier: 5, // speed 6
        healOnActivate: true,
        healPerInterval: { amount: 300, ticks: 160 }, // 300 a cada 8s
        waveScale: 2.2,
        dashTeleports: true, // o dash vira teleporte no alvo
        armorPiece: "vizard:vasto_chest",
        titleForAll: "AHHHHHHH",
        titleSound: "mob.enderdragon.growl",
        items: {
          0: "vizard:m1_vasto",
          1: "vizard:whites_showdown",
          2: "vizard:bullet_hell",
          3: "vizard:everything_but_the_rain",
          4: "vizard:grito_del_diablo",
        },
      },
    },
  },
  nnoitra: {
    id: "nnoitra",
    name: "Nnoitra Gilga",
    health: 1300,
    // individualidade: recebe 10% menos dano de todo ataque (vale o tempo todo)
    damageTakenMultiplier: 0.9,
    items: {
      0: "nnoitra:m1_zanpakuto",
      1: "nnoitra:duro_slash",
      2: "nnoitra:spinning_blade",
      3: "nnoitra:beyblade",
      4: "nnoitra:hierro",
    },
    awakening: {
      name: "Resurrección: Santa Teresa",
      triggerItem: "nnoitra:m1_zanpakuto",
      health: 1600,
      onActivate: "battlecry",
      chatLine: "¡Ruega, Santa Teresa!",
      cryParticle: "nnoitra:corte",
      cryPitch: 0.7,
      // individualidade da Resurrección: ignora 30% do dano de todos os ataques
      awakeningDamageTakenMultiplier: 0.7,
      items: {
        0: "nnoitra:m1_zanpakuto",
        1: "nnoitra:muerte_multiple",
        2: "nnoitra:avance_fatal",
        3: "nnoitra:meteorito_de_hierro",
        4: "nnoitra:declaracion_del_intocable",
      },
    },
  },
  gin: {
    id: "gin",
    name: "Gin Ichimaru",
    health: 4000,
    items: {
      0: "gin:m1_shinso",
      1: "gin:extended_blade",
      2: "gin:spiral",
      3: "gin:pursuing_blade",
      4: "gin:piercing_shinso",
    },
    // Bankai como super ataque (nao troca item nem vida): agachar + usar a m1
    // com o medidor em 100%
    superAttack: {
      onTrigger: "gin",
      triggerItem: "gin:m1_shinso",
    },
  },
  hitsugaya: {
    id: "hitsugaya",
    name: "Toshiro Hitsugaya (Hyōrinmaru)",
    health: 2500,
    items: {
      0: "hitsugaya:m1_hyorinmaru",
      1: "hitsugaya:ryusenka",
      2: "hitsugaya:sennen_hyoro",
      3: "hitsugaya:guncho_tsurara",
      4: "hitsugaya:tenso_jurin",
    },
    // Awk-Bankai: agachar + usar a m1 com o medidor em 100%
    awakening: {
      name: "Daiguren Hyōrinmaru (Bankai)",
      health: 3000,
      triggerItem: "hitsugaya:m1_hyorinmaru",
      canFly: true, // asas de gelo: voa (mesmo mecanismo do Ulquiorra)
      // asas e cauda sao de particula (loop "Individualidade do Bankai")
      onActivate: "battlecry",
      chatLine: "Bankai: Daiguren Hyōrinmaru",
      cryParticle: "hitsugaya:gelo",
      items: {
        0: "hitsugaya:m1_daiguren",
        1: "hitsugaya:dragons_breath",
        2: "hitsugaya:ice_age",
        3: "hitsugaya:ice_barrier",
        4: "hitsugaya:ice_explosion",
      },
    },
  },
  shunsui: {
    id: "shunsui",
    name: "Shunsui Kyoraku (Katen Kyokotsu)",
    health: 4500,
    items: {
      0: "shunsui:m1_katen_kyokotsu",
      1: "shunsui:kageoni",
      2: "shunsui:takaoni",
      3: "shunsui:irooni",
      4: "shunsui:jokenpo",
    },
    // Awk-Bankai como super ataque: agachar + m1 com o medidor em 100%
    superAttack: {
      onTrigger: "shunsui",
      triggerItem: "shunsui:m1_katen_kyokotsu",
    },
  },
  soifon: {
    id: "soifon",
    name: "Soi Fon (Suzumebachi)",
    health: 2000,
    items: {
      0: "soifon:m1_suzumebachi",
      1: "soifon:shunpo",
      2: "soifon:stealthy",
      3: "soifon:shunko",
      4: "soifon:nigeki_kessatsu",
    },
    // Bankai como super ataque: agachar + m1 com o medidor em 100%
    superAttack: {
      onTrigger: "soifon",
      triggerItem: "soifon:m1_suzumebachi",
    },
  },
  rukia: {
    id: "rukia",
    name: "Rukia Kuchiki (Sode no Shirayuki)",
    health: 600,
    items: {
      0: "rukia:m1_zanpakuto",
      1: "rukia:white_moon",
      2: "rukia:white_wave",
      3: "rukia:white_sword",
      4: "rukia:juhaku",
    },
    // Awk: Hadō #73 como super ataque: agachar + m1 com o medidor em 100%
    superAttack: {
      onTrigger: "rukia",
      triggerItem: "rukia:m1_zanpakuto",
    },
  },
  shinji: {
    id: "shinji",
    name: "§6Shinji Hirako §8[Tier 4]§r",
    health: 2600,
    items: {
      0: "shinji:m1_sakanade",
      1: "shinji:triple_slash",
      2: "shinji:sakanas_cut",
      3: "shinji:hollow_mask",
      4: "shinji:cero",
    },
    awakening: {
      name: "Sakanade — Inverter o Mundo",
      triggerItem: "shinji:m1_sakanade",
    },
  },
  ukitake: {
    id: "ukitake",
    name: "Jūshiro Ukitake (Sōgyo no Kotowari)",
    health: 4400,
    items: {
      0: "ukitake:m1_sogyo_no_kotowari",
      1: "ukitake:throw_n_pull",
      2: "ukitake:double_slam",
      3: "ukitake:ying_yang",
      4: "ukitake:stagnation",
      5: "ukitake:absorb",
    },
    // Awk: Hansha como super ataque: agachar + m1 com o medidor em 100%
    superAttack: {
      onTrigger: "ukitake",
      triggerItem: "ukitake:m1_sogyo_no_kotowari",
    },
  },
  tosen: {
    id: "tosen",
    name: "Kaname Tōsen (Suzumushi)",
    health: 1500,
    items: {
      0: "tosen:m1_suzumushi",
      1: "tosen:nake",
      2: "tosen:benihiko",
      3: "tosen:hado_88",
      4: "tosen:silent_cut",
    },
    // Awk-Bankai (Enma Kōrogi) como super ataque: agachar + m1 com o medidor em 100%
    superAttack: {
      onTrigger: "tosen",
      triggerItem: "tosen:m1_suzumushi",
    },
  },
  aizen: {
    id: "aizen",
    name: "Sousuke Aizen (Captain's Fight)",
    health: 5500,
    items: {
      0: "aizen:m1_kyoka_suigetsu",
      1: "aizen:illusions_mastery",
      2: "aizen:betrayal_of_the_illusioner",
      3: "aizen:bakudo_61",
      4: "aizen:fools_trick",
    },
    // Hadō #90 Kurohitsugi como super ataque: agachar + usar a Kyōka com o
    // medidor em 100%, mirando no alvo
    superAttack: {
      onTrigger: "aizen",
      triggerItem: "aizen:m1_kyoka_suigetsu",
    },
  },
  aizen_hogyoku: {
    id: "aizen_hogyoku",
    name: "Sousuke Aizen (Hōgyoku)",
    health: 7000,
    items: {
      0: "aizen:m1_kyoka_suigetsu",
      1: "aizen:illusions",
      2: "aizen:kurohitsugi_encantado",
      3: "aizen:fragor",
    },
    // A Metamorfose nao vem do medidor: a Evolution chega a 100%, o casulo
    // fecha por 5s e ela entra sozinha. Sem triggerItem (agachar + m1 nao
    // desperta) e permanente (nao drena).
    awakening: {
      name: "Monster Aizen (Metamorfose)",
      health: 8000,
      permanent: true,
      onActivate: "metamorphosis",
      aura: { particle: "aizen:reiatsu", radius: 1.3, height: 2.6, perTick: 3 },
      items: {
        0: "aizen:m1_kyoka_suigetsu",
        1: "aizen:illusions",
        2: "aizen:fragor_barrage",
        3: "aizen:ultra_fragor",
      },
    },
  },
  ichigo_dangai: {
    id: "ichigo_dangai",
    name: "Ichigo Kurosaki (Dangai)",
    health: 7500,
    // individualidade: a Pressão Espiritual e as ilusões do Aizen não pegam
    // nele, corre com speed 5 e o dash vira o teleporte do Vasto Lorde
    pressureImmune: true,
    illusionImmune: true,
    sprintSpeedAmplifier: 4, // speed 5 correndo
    dashTeleports: true,
    items: {
      0: "dangai:m1_zangetsu",
      1: "dangai:getsuga_tenshou",
      2: "dangai:omnidirectional_getsuga",
      3: "dangai:arrogants_counter",
      4: "dangai:lets_fight_somewhere_else",
    },
    // Awk-Mugetsu como super: agachar + usar a Zangetsu com o medidor em 100%
    superAttack: {
      onTrigger: "mugetsu",
      triggerItem: "dangai:m1_zangetsu",
    },
  },
  yamamoto: {
    id: "yamamoto",
    name: "Yamamoto Genryūsai",
    health: 8500,
    items: {
      0: "yamamoto:m1_ryujin_jakka",
      1: "yamamoto:ennetsu_jigoku",
      2: "yamamoto:itto_kaso",
      3: "yamamoto:shunshin",
      4: "yamamoto:hells_pierce",
    },
    // Awk-Bankai: agachar + usar a Ryūjin Jakka com o medidor em 100%
    awakening: {
      name: "Bankai: Zanka no Tachi",
      triggerItem: "yamamoto:m1_ryujin_jakka",
      onActivate: "battlecry",
      chatLine: "Zanka no Tachi...",
      cryParticle: "yamamoto:chama",
      cryPitch: 0.6,
      // o fogo fica preso na lamina: so brasa subindo em volta
      aura: { particle: "yamamoto:brasa", radius: 0.9, height: 2.2, perTick: 1 },
      items: {
        0: "yamamoto:m1_zanka_no_tachi",
        1: "yamamoto:minami",
        2: "yamamoto:nishi",
        3: "yamamoto:higashi",
        4: "yamamoto:kita",
      },
    },
  },
  unohana: {
    id: "unohana",
    name: "Retsu Unohana",
    health: 2000,
    items: {
      0: "unohana:m1_zanpakuto",
      1: "unohana:hados",
      2: "unohana:bakudos",
      3: "unohana:kaidos",
    },
    // Awk: Kaidō Expert como super - agachar + usar a zanpakuto com 100%
    superAttack: {
      onTrigger: "kaido_expert",
      triggerItem: "unohana:m1_zanpakuto",
    },
  },
  komamura: {
    id: "komamura",
    name: "Sajin Komamura",
    health: 2300,
    items: {
      0: "komamura:m1_tenken",
      1: "komamura:myoo_barrage",
      2: "komamura:destructive_slash",
      3: "komamura:giants_shield",
      4: "komamura:ora_ora_ora",
    },
    // Bankai: o player vira o Myō'ō (marcador na offhand escala o modelo e a
    // armadura de samurai vai no peito)
    awakening: {
      name: "Bankai: Kokujō Tengen Myō'ō",
      triggerItem: "komamura:m1_tenken",
      health: 3000,
      awakeningDamageTakenMultiplier: 0.7, // 30% a menos de todo dano
      onActivate: "battlecry",
      chatLine: "Bankai: Kokujō Tengen Myō'ō!",
      cryParticle: "komamura:poeira",
      cryPitch: 0.4,
      offhandMarker: "komamura:myoo_marker",
      armorPiece: "komamura:myoo_chest",
      armorMessage: "§6§lO Myō'ō se manifesta por inteiro.",
      // agachar + usar a katana do gigante alterna a camera pro alto da cabeca
      tallView: {
        triggerItem: "komamura:m1_myoo",
        height: 11,
        back: 7,
      },
      items: {
        0: "komamura:m1_myoo",
        1: "komamura:titanic_slash",
        2: "komamura:stomp",
        3: "komamura:punch",
        4: "komamura:susanoo_cut",
      },
    },
  },
};

// armas m1 alternativas do byakuya (trocadas dinamicamente, nao ficam no registro "items" fixo)
const BYAKUYA_ALT_WEAPONS = [
  "byakuya:m1_senbonzakura_senkei",
  "byakuya:m1_senbonzakura_finisher",
];

// itens da persona Lilynette do Starkk (so existem no registro "items" quando
// a persona esta ativa, entao precisam de registro proprio pro ITEM_OWNER)
// itens que nao ficam em slot de hotbar mas precisam de dono (pra nao serem dropados)
const EXTRA_OWNED_ITEMS = {
  "shinji:mask_visual": "shinji",
  "yammy:ira_marker": "yammy",
  "vizard:hollow_chest": "ichigo_vizard",
  "vizard:vasto_chest": "ichigo_vizard",
  "ulquiorra:segunda_chest": "ulquiorra",
  "dangai:mugetsu_chest": "ichigo_dangai",
  // a Kyōka "oculta" (textura vazia) fica no slot 0 enquanto o Aizen esta invisivel
  "aizen:m1_kyoka_oculta": "aizen",
};

const STARKK_ALT_WEAPONS = [
  "starkk:lilynette_shot",
  "starkk:rifle",
  "starkk:escopeta",
  "starkk:cero_metralleta",
];

// Seletor por raça + tier. Agachar + usar o seletor passa para a próxima raça.
// Ao abrir o seletor, o primeiro menu mostra os tiers; ao escolher um tier,
// aparecem somente os personagens daquela raça e daquele tier.
const RACES = [
  { id: "shinigami", name: "Shinigami" },
  { id: "hollow", name: "Hollow" },
  { id: "quincy", name: "Quincy" },
  { id: "fullbringer", name: "Fullbringer" },
  { id: "hybrid", name: "Híbrido" },
];

const TIERS = [
  { id: 1, name: "Tier 1", subtitle: "Nível Tenente" },
  { id: 2, name: "Tier 2", subtitle: "Nível Capitão baixo" },
  { id: 3, name: "Tier 3", subtitle: "Nível Capitão médio" },
  { id: 4, name: "Tier 4", subtitle: "Nível Sternritter" },
  { id: 5, name: "Tier 5", subtitle: "Nível Capitão alto" },
  { id: 6, name: "Tier 6", subtitle: "Nível Elite Sternritter" },
  { id: 7, name: "Tier 7", subtitle: "Nível Capitão Geral" },
  { id: 8, name: "Tier 8", subtitle: "Nível Divisão Zero" },
  { id: 9, name: "Tier 9", subtitle: "Transcendente" },
];

// Classificação atual dos personagens disponíveis no seletor.
const CHARACTER_RACE_TIER = {
  byakuya: { race: "shinigami", tier: 2 },
  kenpachi: { race: "shinigami", tier: 3 },
  mayuri: { race: "shinigami", tier: 2 },
  gin: { race: "shinigami", tier: 5 },
  hitsugaya: { race: "shinigami", tier: 4 },
  shunsui: { race: "shinigami", tier: 5 },
  soifon: { race: "shinigami", tier: 4 },
  rukia: { race: "shinigami", tier: 2 },
  ukitake: { race: "shinigami", tier: 5 },
  shinji: { race: "hybrid", tier: 4 },
  tosen: { race: "hybrid", tier: 3 },
  aizen: { race: "shinigami", tier: 6 },
  aizen_hogyoku: { race: "hybrid", tier: 7 },
  ichigo_dangai: { race: "hybrid", tier: 7 },
  yamamoto: { race: "shinigami", tier: 7 },
  unohana: { race: "shinigami", tier: 3 },
  komamura: { race: "shinigami", tier: 4 },

  grimmjow: { race: "hollow", tier: 2 },
  szayelaporro: { race: "hollow", tier: 2 },
  aaroniero: { race: "hollow", tier: 2 },
  nnoitra: { race: "hollow", tier: 3 },
  ulquiorra: { race: "hollow", tier: 3 },
  harribel: { race: "hollow", tier: 3 },
  barragan: { race: "hollow", tier: 4 },
  starkk: { race: "hollow", tier: 4 },
  yammy: { race: "hollow", tier: 5 },

  ichigo: { race: "hybrid", tier: 2 },
  ichigo_vizard: { race: "hybrid", tier: 4 },
};

// Tier do personagem ATIVO (0 sem personagem). A Pressao Espiritual, o Air Step,
// a troca de skill generica e as skills do Gin e do Shunsui comparam tiers por
// aqui. A funcao era chamada em dez lugares e nao existia: cada chamada lancava
// ReferenceError, que o anti-lag dos loops engolia em silencio.
function tierOfPlayer(entity) {
  const id = entity?.getDynamicProperty?.(DP.character);
  return CHARACTER_RACE_TIER[id]?.tier ?? 0;
}

// Jurisdição dos mais fortes: tiers altos (7/8/9) reduzem o dano recebido de
// quem for de tier ESTRITAMENTE menor. Contra tier igual ou maior o dano vai
// 100% (a redução "não segura" um golpe de quem é do mesmo nível ou acima).
// Personagens que já têm redução de dano própria (ex.: a individualidade do
// Nnoitra, via damageTakenMultiplier fixo no personagem) NÃO acumulam com
// essa redução genérica de tier - a deles substitui a genérica.
const TIER_DAMAGE_REDUCTION = { 7: 0.2, 8: 0.3, 9: 0.4 };
function tierDamageReductionMultiplierOf(target, source) {
  try {
    if (target?.typeId !== "minecraft:player") return 1;
    const character = getActiveCharacter(target);
    if (!character || character.damageTakenMultiplier != null) return 1;
    const defTier = tierOfPlayer(target);
    const pct = TIER_DAMAGE_REDUCTION[defTier];
    if (!pct) return 1;
    const atkTier = source?.typeId === "minecraft:player" ? tierOfPlayer(source) : 0;
    if (atkTier >= defTier) return 1;
    return 1 - pct;
  } catch (e) {
    return 1;
  }
}

const SPIRITUAL_PRESSURE = { durationTicks: 200, cooldownTicks: 600, intervalTicks: 60, effectDurationTicks: 70, radii: {1:10,2:15,3:20,4:30,5:40,6:60,7:80,8:100,9:200}, effects: {2:{amplifier:1,damage:10},3:{amplifier:2,damage:20},4:{amplifier:3,damage:50}} };
function isSpiritualPressureEnabled(player){ return player.getDynamicProperty(DP.pressureEnabled)!==false; }
function setSpiritualPressureEnabled(player,enabled){ player.setDynamicProperty(DP.pressureEnabled,!!enabled); }
function isInfiniteAwakening(player){ return player.getDynamicProperty(DP.infiniteAwakening)===true; }
function genericSkillIndex(player){const n=Number(player.getDynamicProperty(DP.genericSkill));return n===1||n===2?n:0;}
function genericSkillName(player){return ["Pressão Espiritual","Air Step","Reiatsu Jump"][genericSkillIndex(player)];}
function cycleGenericSkill(player){const tier=tierOfPlayer(player),cur=genericSkillIndex(player),next=tier>=5?(cur+1)%3:(cur===0?2:0);player.setDynamicProperty(DP.genericSkill,next);player.sendMessage(`§bSkill: §f${genericSkillName(player)}`);}
function activateGenericSpiritualPressure(player){if(onCooldown(player,DP.pressureCooldown,SPIRITUAL_PRESSURE.cooldownTicks,system.currentTick)){player.sendMessage("§cPressão Espiritual em cooldown.");return;}player.setDynamicProperty(DP.pressureActiveUntil,system.currentTick+SPIRITUAL_PRESSURE.durationTicks);setCooldown(player,DP.pressureCooldown,system.currentTick);player.sendMessage("§4§lPressão Espiritual ativada! §r§7(10s)");}
function removeAirStepBlock(player){const raw=player.getDynamicProperty(DP.airStepBlock);if(raw){try{const p=JSON.parse(raw),b=player.dimension.getBlock(p);if(b?.typeId==="minecraft:barrier")b.setType("minecraft:air");}catch(e){}}player.setDynamicProperty(DP.airStepBlock,undefined);}
function setAirStepBlock(player){const l=player.location,pos={x:Math.floor(l.x),y:Math.floor(l.y-1),z:Math.floor(l.z)},raw=player.getDynamicProperty(DP.airStepBlock);if(raw){try{const o=JSON.parse(raw);if(o.x===pos.x&&o.y===pos.y&&o.z===pos.z)return;const b=player.dimension.getBlock(o);if(b?.typeId==="minecraft:barrier")b.setType("minecraft:air");}catch(e){}}try{const b=player.dimension.getBlock(pos);if(!b?.isAir)return;b.setType("minecraft:barrier");player.setDynamicProperty(DP.airStepBlock,JSON.stringify(pos));}catch(e){}}
function toggleGenericAirStep(player){if(tierOfPlayer(player)<5){player.sendMessage("§cAir Step exige Tier 5 ou superior.");return;}const on=player.getDynamicProperty(DP.airStepActive)===true;player.setDynamicProperty(DP.airStepActive,!on);if(on){removeAirStepBlock(player);player.sendMessage("§7Air Step desativado.");}else{setAirStepBlock(player);player.sendMessage("§bAir Step ativado.");}}
function activateReiatsuJump(player){const now=system.currentTick,last=tickOf(player,"mv:reiatsu_jump_cd");if(typeof last==="number"&&now-last<200){player.sendMessage("§cReiatsu Jump em cooldown.");return;}const c=Number(player.getDynamicProperty("mv:reiatsu_jump_charge"))||0;const amp=c>=120?2:c>=80?1:0;player.addEffect("jump_boost",2,{amplifier:amp,showParticles:false});player.setDynamicProperty("mv:reiatsu_jump_cd",now);player.setDynamicProperty("mv:reiatsu_jump_charge",0);}
function handleGenericSkillUse(player){const i=genericSkillIndex(player);if(i===0)activateGenericSpiritualPressure(player);else if(i===1)toggleGenericAirStep(player);else activateReiatsuJump(player);}

// Todo peitoral de forma que existe, pra poder varrer os que estao sobrando.
// Sem isso da pra tirar a peca, ficar com uma copia na mochila e vestir ela
// depois sem personagem nenhum.
const FORM_ARMOR_PIECES = new Set();
for (const key in CHARACTERS) {
  const form = CHARACTERS[key].awakening;
  if (form?.armorPiece) FORM_ARMOR_PIECES.add(form.armorPiece);
  if (form?.trueForm?.armorPiece) FORM_ARMOR_PIECES.add(form.trueForm.armorPiece);
}
// a roupa do Mugetsu vem do super, nao de um awakening
FORM_ARMOR_PIECES.add("dangai:mugetsu_chest");

// mapa reverso: itemId -> personagem dono (pra saber o que pode ser dropado/travado)
const ITEM_OWNER = {};
for (const key in CHARACTERS) {
  const c = CHARACTERS[key];
  for (const slot in c.items) {
    ITEM_OWNER[c.items[slot]] = c.id;
  }
  if (c.awakening) {
    for (const slot in c.awakening.items) {
      ITEM_OWNER[c.awakening.items[slot]] = c.id;
    }
    if (c.awakening.trueForm?.items) {
      for (const slot in c.awakening.trueForm.items) {
        ITEM_OWNER[c.awakening.trueForm.items[slot]] = c.id;
      }
    }
  }
}
for (const weaponId of BYAKUYA_ALT_WEAPONS) {
  ITEM_OWNER[weaponId] = "byakuya";
}
for (const weaponId of STARKK_ALT_WEAPONS) {
  ITEM_OWNER[weaponId] = "starkk";
}
for (const itemId in EXTRA_OWNED_ITEMS) {
  ITEM_OWNER[itemId] = EXTRA_OWNED_ITEMS[itemId];
}

// O Bedrock guarda o amplificador de efeito num byte, entao o teto e 255. Com
// health_boost 255 a vida real maxima e 20 + 256*4 = 1044. Personagem
// configurado acima disso NAO cabe no medidor real: passar de 255 faz o efeito
// simplesmente nao aplicar (foi o que aconteceu com os 1200 do La Pantera).
// marca da Pesquisa do Ulquiorra: quem esta marcado recebe mais dano de todo
// mundo, nao so do Ulquiorra
const PESQUISA = {
  range: 40,
  durationTicks: 300, // 15s - nao especificado
  damageMultiplier: 1.5, // +50% de dano recebido
};

function isMarked(entity) {
  try {
    return (
      system.currentTick <
      readTickDeadline(entity, DP.markedEnd, PESQUISA.durationTicks)
    );
  } catch (e) {
    return false;
  }
}

const MAX_EFFECT_AMPLIFIER = 255;
const MAX_REAL_HEALTH = 20 + (MAX_EFFECT_AMPLIFIER + 1) * 4; // 1044

const HEALTH_BOOST_LEVEL_FOR = (targetMaxHealth) => {
  // health_boost amplifier 0 = +4hp (nivel 1). cada nivel extra soma +4hp.
  const extra = Math.min(targetMaxHealth, MAX_REAL_HEALTH) - 20;
  const level = Math.max(0, Math.ceil(extra / 4) - 1);
  return Math.min(level, MAX_EFFECT_AMPLIFIER);
};

// teto REAL que esse maxHealth vira depois de arredondar pro nivel do efeito
function realMaxHealthFor(virtualMaxHealth) {
  return 20 + (HEALTH_BOOST_LEVEL_FOR(virtualMaxHealth) + 1) * 4;
}

// Acima do teto a vida vira "virtual": o pool real fica em 1044 e todo dano do
// addon e dividido por essa escala antes de entrar. Pra quem cabe no teto a
// escala e 1 e nada muda.
function healthScaleFor(virtualMaxHealth) {
  return virtualMaxHealth > MAX_REAL_HEALTH
    ? virtualMaxHealth / MAX_REAL_HEALTH
    : 1;
}

function healthScaleOf(entity) {
  try {
    const scale = entity.getDynamicProperty(DP.healthScale);
    return typeof scale === "number" && scale > 0 ? scale : 1;
  } catch (e) {
    return 1;
  }
}

// vida do jeito que o player enxerga (ja multiplicada pela escala)
function virtualHealth(entity) {
  const hp = entity.getComponent("minecraft:health");
  if (!hp) return 0;
  return hp.currentValue * healthScaleOf(entity);
}

// Bloqueio universal: agachar + m1. Corta metade do dano de TUDO - so nao vale
// contra golpe marcado como quebra-bloqueio (hoje a Royal Cleave do Barragan e
// o Duro Slash do Nnoitra).
const BLOCK = {
  durationTicks: 100, // 5s no maximo segurando a guarda
  cooldownTicks: 100, // 5s, contados de quando o bloqueio ACABA
  damageMultiplier: 0.5,
};

function isBlocking(entity) {
  try {
    return (
      system.currentTick < readTickDeadline(entity, DP.blockEnd, BLOCK.durationTicks)
    );
  } catch (e) {
    return false;
  }
}

// faisca no golpe aparado: sem isso ninguem percebe que o bloqueio funcionou
function showBlockSpark(target) {
  try {
    const loc = target.location;
    for (let i = 0; i < 3; i++) {
      target.dimension.spawnParticle("minecraft:crit_particle", {
        x: loc.x + (Math.random() - 0.5) * 0.9,
        y: loc.y + 1.1 + Math.random() * 0.5,
        z: loc.z + (Math.random() - 0.5) * 0.9,
      });
    }
  } catch (e) {}
}

// TODO dano do addon passa por aqui. Divide pela escala do ALVO pra que
// "700 de dano" continue significando 700 da vida que ele ve na actionbar,
// aplica a marca da Pesquisa do Ulquiorra e o bloqueio do alvo.
// options.breaksBlock = golpe que passa direto pela guarda.
// A marca guarda o proprio multiplicador: a Pesquisa do Ulquiorra da 1.5x e a
// Learn and Adapt do Szayelaporro da 2x, na mesma estrutura.
function markTarget(target, durationTicks, multiplier) {
  target.setDynamicProperty(DP.markedEnd, system.currentTick + durationTicks);
  target.setDynamicProperty(DP.markMultiplier, multiplier);
}

function markMultiplierOf(entity) {
  if (!isMarked(entity)) return 1;
  try {
    const stored = entity.getDynamicProperty(DP.markMultiplier);
    return typeof stored === "number" && stored > 0
      ? stored
      : PESQUISA.damageMultiplier;
  } catch (e) {
    return PESQUISA.damageMultiplier;
  }
}

function isIntocable(entity) {
  try {
    return (
      system.currentTick <
      readTickDeadline(entity, DP.intocableEnd, INTocable.durationTicks)
    );
  } catch (e) {
    return false;
  }
}

function dealDamage(target, amount, source, options) {
  // clone da Illusion's Mastery: area e skill passam direto por ele; so o golpe
  // corpo a corpo (entityHitEntity) conta como "acertar o clone"
  if (target?.typeId === AIZEN.cloneType) return;
  // o Aizen enfraquecido pelo Getsuga Tenshou Final nao causa dano nenhum
  if (source && isMugetsuWeakened(source)) return;
  // Kaidō Expert: a Unohana lembra de quem tentou machucar ela (mesmo barrado)
  recordUnohanaAttacker(target, source);
  // Arrogant's Counter do Ichigo (Dangai): o golpe nao entra e vira o contra-ataque
  if (source && dangaiCounterIntercept(target, source)) return;
  // Seki e Dankū da Unohana
  if (source && unohanaBarrierBlocks(target, source)) return;
  if (isIntocable(target)) {
    if (!options?.bypassesIntocable) {
      try {
        showIntocableGuard(target);
      } catch (e) {}
      return;
    }
    // so o golpe que quebra a defesa (o Hell's Cut do Zaraki) chega aqui: a
    // defesa cai (senao o Resistance total do Intocable engoliria o dano)
    endIntocable(target, true);
  }

  // Karamatsu Shinjū: quem esta na peca so toma dano da propria peca
  if (karamatsuProtected.has(target.id) && !options?.karamatsu) return;

  // Ice Barrier do Hitsugaya: a parede virada pro golpe segura ele inteiro
  if (absorbIceBarrier(target, source)) return;

  // Jokenpo do Shunsui: quem perdeu toma mais dano por um tempo
  const marked =
    markMultiplierOf(target) * vulnerabilityMultiplierOf(target) * fragilityMultiplierOf(target);

  const guarded = !options?.breaksBlock && !options?.ignoresReduction && isBlocking(target);
  if (guarded) showBlockSpark(target);

  const blocked = guarded ? BLOCK.damageMultiplier : 1;
  // individualidade e Hierro do Nnoitra: valem contra TUDO, ate contra o golpe
  // que quebra a guarda (a guarda e uma coisa, a pele dele e outra). So a
  // Queimadura Infernal do Yamamoto passa por cima de reducao.
  let resisted = damageTakenMultiplierOf(target) * tierDamageReductionMultiplierOf(target, source);
  if (options?.ignoresReduction) resisted = Math.max(1, resisted);
  const finalAmount = amount * marked * blocked * resisted;
  // Absorb do Ukitake: imune ao dano, que fica guardado pro Hansha
  if (absorbUkitakeDamage(target, finalAmount)) return;
  target.applyDamage(finalAmount / healthScaleOf(target), {
    cause: EntityDamageCause.entityAttack,
    damagingEntity: source,
  });
}

const SKILL_COOLDOWN_TICKS = {
  "shinji:triple_slash": 400,
  "shinji:sakanas_cut": 500,
  "shinji:hollow_mask": 1300,
  "shinji:cero": 200,
  "ichigo:getsuga_slam": 200,
  "ichigo:getsuga_slash": 320,
  "ichigo:getsuga_run": 320,
  "ichigo:getsuga_tenshou": 500,
  "ichigo:getsuga_barrage": 300,
  "ichigo:getsuga_tenshou_bankai": 400,
  "ichigo:double_getsuga": 440,
  "ichigo:nuke_tenshou": 700,
  "byakuya:tripleshot": 300,
  "byakuya:disperse": 440,
  "byakuya:bloodshed": 600,
  "byakuya:sakura_distraction": 3600,
  "kenpachi:flash_slash": 360,
  "kenpachi:stomp": 240,
  "kenpachi:hunt": 400,
  "kenpachi:hells_cut": 400, // 20% a menos que o Getsuga Tenshou (500)
  "mayuri:poison_slash": 300,
  "mayuri:toxic_fog": 600,
  "mayuri:regenerate": 800,
  "mayuri:envenenar": 400,
  "grimmjow:desgarra": 300, // 15s
  "grimmjow:raza": 400, // 20s
  "grimmjow:gran_rey_cero": 600, // 30s
  "grimmjow:destruir": 400, // 20s - nao especificado
  "grimmjow:rugido": 500, // 25s - nao especificado
  "grimmjow:arrancar_corazon": 2400, // 2 min
  "grimmjow:disparo": 200, // 10s
  "ulquiorra:gran_rey_cero": 600, // 30s, igual ao do Grimmjow
  "ulquiorra:cero_bala": 300, // 15s
  "ulquiorra:sonido": 160, // 8s
  "ulquiorra:pesquisa": 400, // 20s - nao especificado
  "ulquiorra:nihil": 500, // 25s - nao especificado
  "ulquiorra:enigma": 800, // 40s na primeira etapa; 20s na Segunda Etapa
  "ulquiorra:cero_oscuras": 700,
  "ulquiorra:cero_oscuras_triplo": 600, // 30s // 35s - nao especificado
  "ulquiorra:lanza": 1200, // 60s - nao especificado
  "starkk:slash_barrage": 460, // 23s
  "starkk:sideway_cuts": 360, // 18s
  "starkk:crescent_canines": 700, // 35s
  "starkk:kamarada": 1000, // 50s
  "starkk:lilynette_shot": 40, // 2s
  "starkk:rifle": 400, // 20s
  "starkk:escopeta": 360, // 18s
  "starkk:cero_metralleta": 800, // 40s
  "yammy:punches_barrage": 300, // 15s
  "yammy:face_hold": 300, // 15s
  "yammy:wraths_smash": 400, // 20s
  "yammy:wraths_punch": 600, // 30s
  "yammy:quebramundos": 800, // 40s - nao especificado
  "yammy:cero_barrage": 700, // 35s - nao especificado
  "yammy:rugido_diablo": 600, // 30s - nao especificado
  "harribel:tiburon_slash": 160, // 8s
  "harribel:shark_issues": 180, // 9s
  "harribel:water_prison": 600, // 30s
  "harribel:aquas_dash": 200, // 10s
  "harribel:tsunami": 200, // 10s
  "harribel:vortice": 500, // 25s
  "harribel:maldita_agua": 3600, // 180s
  "barragan:arrogante_slash": 400, // 20s
  "barragan:el_rei_oco": 400, // 20s
  "barragan:royal_cleave": 400, // 20s
  "barragan:withers_slashes": 500, // 25s
  "barragan:ruir_del_rey": 500, // 25s
  "barragan:respira": 400, // 20s
  "barragan:el_maldito": 360, // 18s
  "barragan:la_muerte": 2400, // 2 min - nao especificado
  "szayel:rush_and_pierce": 340, // 17s
  "szayel:ascendent_cut": 300, // 15s
  "szayel:carbon_copy": 700, // 35s
  "szayel:learn_and_adapt": 900, // 45s
  "szayel:teatro_de_titeres": 700, // 35s - e ainda por cima uso unico por awakening
  "szayel:posse": 800, // 40s
  "szayel:gabriel": 900, // 45s
  "vizard:dash_n_slash": 600,
  "vizard:getsuga_barrage": 800,
  "vizard:descent_tensho": 500,
  "vizard:super_nuke": 1100,
  "vizard:whites_showdown": 600,
  "vizard:bullet_hell": 800,
  "vizard:everything_but_the_rain": 1000,
  "vizard:grito_del_diablo": 4200,
  "aaroniero:cero_metalico": 340,
  "aaroniero:nejibana": 300,
  "aaroniero:devorar": 240,
  "aaroniero:mascara_kaien": 800,
  "aaroniero:tentaculos": 360,
  "aaroniero:tridente_kaien": 440,
  "aaroniero:cero_metalico_gloton": 560,
  "aaroniero:banquete": 2400,
  "aaroniero:glotoneria": 400,
  "nnoitra:duro_slash": 200, // 10s
  "nnoitra:spinning_blade": 400, // 20s
  "nnoitra:beyblade": 600, // 30s
  "nnoitra:hierro": 700, // 35s
  "nnoitra:muerte_multiple": 400, // 20s
  "nnoitra:avance_fatal": 400, // 20s
  "nnoitra:meteorito_de_hierro": 600, // 30s
  "nnoitra:declaracion_del_intocable": 1200, // 60s
  "gin:extended_blade": 200, // 10s
  "gin:spiral": 400, // 20s
  "gin:pursuing_blade": 500, // 25s
  "gin:piercing_shinso": 600, // 30s
  "hitsugaya:ryusenka": 300, // 15s
  "hitsugaya:sennen_hyoro": 700, // 35s
  "hitsugaya:guncho_tsurara": 500, // 25s
  "hitsugaya:tenso_jurin": 900, // 45s
  "hitsugaya:dragons_breath": 500, // 25s
  "hitsugaya:ice_age": 800, // 40s
  "hitsugaya:ice_barrier": 400, // 20s
  "hitsugaya:ice_explosion": 1200, // 60s
  "shunsui:kageoni": 300, // 15s
  "shunsui:takaoni": 500, // 25s
  "shunsui:irooni": 600, // 30s
  "shunsui:jokenpo": 800, // 40s
  "soifon:shunpo": 100, // 5s
  "soifon:stealthy": 300, // 15s
  "soifon:shunko": 600, // 30s (nao foi especificado)
  "soifon:nigeki_kessatsu": 1600, // 80s
  "rukia:white_moon": 500, // 25s
  "rukia:white_wave": 400, // 20s
  "rukia:white_sword": 600, // 30s
  "rukia:juhaku": 800, // 40s (nao foi especificado)
  "ukitake:throw_n_pull": 300, // 15s
  "ukitake:double_slam": 400, // 20s
  "ukitake:ying_yang": 400, // 20s
  "ukitake:stagnation": 700, // 35s
  "ukitake:absorb": 800, // 40s
  "tosen:nake": 400, // 20s
  "tosen:benihiko": 600, // 30s
  "tosen:hado_88": 900, // 45s
  "tosen:silent_cut": 600, // 30s
  "tosen:palacio_de_las_espadas": 360, // 18s
  "tosen:ecolocalizacion": 400, // 20s
  "tosen:cero": 800, // 40s
  "tosen:los_nueve_aspectos": 900, // 45s
  "aizen:illusions_mastery": 500, // 25s
  "aizen:betrayal_of_the_illusioner": 600, // 30s
  "aizen:bakudo_61": 500, // 25s
  "aizen:fools_trick": 700, // 35s
  // Aizen (Hōgyoku): as tres ilusoes tem cooldown proprio dentro do item Illusions
  "aizen:illusions.switch": 600, // 30s
  "aizen:illusions.false_skill": 500, // 25s
  "aizen:illusions.kanzen_saimin": 900, // 45s
  "aizen:kurohitsugi_encantado": 1400, // 70s
  "aizen:fragor": 1000, // 50s
  "aizen:ultra_fragor": 1200, // 60s
  "aizen:fragor_barrage": 1200, // 60s
  "dangai:getsuga_tenshou": 400, // 20s
  "dangai:omnidirectional_getsuga": 700, // 35s
  "dangai:arrogants_counter": 500, // 25s
  "dangai:lets_fight_somewhere_else": 300, // 15s
  "yamamoto:ennetsu_jigoku": 500, // 25s
  "yamamoto:itto_kaso": 700, // 35s
  "yamamoto:shunshin": 400, // 20s
  "yamamoto:hells_pierce": 800, // 40s
  "yamamoto:minami": 600, // 30s
  "yamamoto:nishi": 500, // 25s
  "yamamoto:higashi": 800, // 40s
  "yamamoto:kita": 100, // o Bankai acaba junto: o cooldown de verdade e encher o medidor de novo
  // Unohana: cada kidō do menu tem o proprio cooldown (o ponto evita que o
  // validador ache que e um item)
  "unohana:hados.byakurai": 200, // 10s
  "unohana:hados.sokatsui": 300, // 15s
  "unohana:hados.soren_sokatsui": 500, // 25s
  "unohana:bakudos.seki": 300, // 15s
  "unohana:bakudos.sajo_sabaku": 500, // 25s
  "unohana:bakudos.danku": 800, // 40s
  "unohana:kaidos.basico": 600, // 30s
  "unohana:kaidos.avancado": 1000, // 50s
  "unohana:kaidos.chiyu": 300, // 15s
  "unohana:kaidos.diagnostico": 200, // 10s
  "unohana:kaidos.tratamento": 600, // 30s (o mesmo do Kaidō Básico)
  "komamura:myoo_barrage": 400, // 20s
  "komamura:destructive_slash": 500, // 25s
  "komamura:giants_shield": 400, // 20s
  "komamura:ora_ora_ora": 600, // 30s
  "komamura:titanic_slash": 500, // 25s
  "komamura:stomp": 700, // 35s
  "komamura:punch": 340, // 17s
  "komamura:susanoo_cut": 1200, // 60s
};

const SKILL_NAMES = {
  "ichigo:getsuga_slam": "Getsuga Slam",
  "ichigo:getsuga_slash": "Getsuga Slash",
  "ichigo:getsuga_run": "Getsuga Run",
  "ichigo:getsuga_tenshou": "Getsuga Tenshou",
  "ichigo:getsuga_barrage": "Getsuga Barrage",
  "ichigo:getsuga_tenshou_bankai": "Getsuga Tenshou (Bankai)",
  "ichigo:double_getsuga": "Double Getsuga",
  "ichigo:nuke_tenshou": "Nuke Tenshou",
  "byakuya:tripleshot": "Senbonzakura Tripleshot",
  "byakuya:disperse": "Senbonzakura Disperse",
  "byakuya:bloodshed": "Senbonzakura Bloodshed",
  "byakuya:sakura_distraction": "Sakura's Distraction",
  "kenpachi:flash_slash": "Flash Slash",
  "kenpachi:stomp": "Stomp",
  "kenpachi:hunt": "Kenpachi's Hunt",
  "kenpachi:hells_cut": "Hell's Cut",
  "mayuri:poison_slash": "Poison Slash",
  "mayuri:toxic_fog": "Toxic Fog",
  "mayuri:regenerate": "Regenerate",
  "mayuri:envenenar": "Envenenar",
  "grimmjow:desgarra": "Desgarra de la Pantera",
  "grimmjow:raza": "Raza de la Pantera",
  "grimmjow:gran_rey_cero": "Gran Rey Cero",
  "grimmjow:destruir": "Destruir de La Pantera",
  "grimmjow:rugido": "Rugido de La Pantera",
  "grimmjow:arrancar_corazon": "Arrancar Corazón",
  "grimmjow:disparo": "Disparo de La Pantera",
  "ulquiorra:gran_rey_cero": "Gran Rey Cero",
  "ulquiorra:cero_bala": "Cero Bala",
  "ulquiorra:sonido": "Sonído",
  "ulquiorra:pesquisa": "Pesquisa",
  "ulquiorra:nihil": "Nihil",
  "ulquiorra:enigma": "Enigma",
  "ulquiorra:cero_oscuras": "Cero Oscuras",
  "ulquiorra:lanza": "Lanza del Relámpago",
  "starkk:slash_barrage": "Slash's Barrage",
  "starkk:sideway_cuts": "Sideway Cuts",
  "starkk:crescent_canines": "Crescent Canines",
  "starkk:kamarada": "Kamarada",
  "starkk:lilynette_shot": "Disparo da Lilynette",
  "starkk:rifle": "Rifle",
  "starkk:escopeta": "Escopeta",
  "starkk:cero_metralleta": "Cero Metralleta",
  "yammy:punches_barrage": "Punches Barrage",
  "yammy:face_hold": "Face Hold",
  "yammy:wraths_smash": "Wrath's Smash",
  "yammy:wraths_punch": "Wrath's Punch",
  "yammy:quebramundos": "Quebramundos",
  "yammy:cero_barrage": "Gran Rey Cero Barrage",
  "yammy:rugido_diablo": "Rugido del Diablo",
  "harribel:tiburon_slash": "Tiburon's Slash",
  "harribel:shark_issues": "Shark Issues",
  "harribel:water_prison": "Water Prison",
  "harribel:aquas_dash": "Aqua's Dash",
  "harribel:tsunami": "Tsunami",
  "harribel:vortice": "Vórtice de Agua",
  "harribel:maldita_agua": "Maldita Água",
  "barragan:arrogante_slash": "Arrogante's Slash",
  "barragan:el_rei_oco": "El Rei Oco",
  "barragan:royal_cleave": "Royal Cleave",
  "barragan:withers_slashes": "Wither's Slashes",
  "barragan:ruir_del_rey": "Ruir del Rey",
  "barragan:respira": "Respira",
  "barragan:el_maldito": "El Maldito",
  "barragan:la_muerte": "La Muerte",
  "szayel:rush_and_pierce": "Rush and Pierce",
  "szayel:ascendent_cut": "Ascendent Cut",
  "szayel:carbon_copy": "Carbon-Copy",
  "szayel:learn_and_adapt": "Learn and Adapt",
  "szayel:teatro_de_titeres": "Teatro de Títeres",
  "szayel:posse": "Posse",
  "szayel:gabriel": "Gabriel",
  "vizard:dash_n_slash": "Dash 'n Slash",
  "vizard:getsuga_barrage": "Getsuga Barrage",
  "vizard:descent_tensho": "Descent Tenshō!",
  "vizard:super_nuke": "Super Nuke Tenshou",
  "vizard:whites_showdown": "White's Showdown",
  "vizard:bullet_hell": "Bullet Hell",
  "vizard:everything_but_the_rain": "Everything But the Rain",
  "vizard:grito_del_diablo": "Grito del Diablo",
  "aaroniero:cero_metalico": "Cero Metálico",
  "aaroniero:nejibana": "Nejibana",
  "aaroniero:devorar": "Devorar",
  "aaroniero:mascara_kaien": "Máscara do Kaien",
  "aaroniero:tentaculos": "Tentáculos",
  "aaroniero:tridente_kaien": "Tridente de Kaien",
  "aaroniero:cero_metalico_gloton": "Cero Metálico Glotón",
  "aaroniero:banquete": "Banquete",
  "aaroniero:glotoneria": "Glotonería",
  "nnoitra:duro_slash": "Duro Slash",
  "nnoitra:spinning_blade": "Spinning Blade",
  "nnoitra:beyblade": "Beyblade",
  "nnoitra:hierro": "Hierro",
  "nnoitra:muerte_multiple": "Muerte Múltiple",
  "nnoitra:avance_fatal": "Avance Fatal",
  "nnoitra:meteorito_de_hierro": "Meteorito de Hierro",
  "nnoitra:declaracion_del_intocable": "Declaración del Intocable",
  "gin:extended_blade": "Extended Blade",
  "gin:spiral": "Spiral",
  "gin:pursuing_blade": "Pursuing Blade",
  "gin:piercing_shinso": "Piercing Shinso",
  "hitsugaya:ryusenka": "Ryūsenka",
  "hitsugaya:sennen_hyoro": "Sennen Hyōrō",
  "hitsugaya:guncho_tsurara": "Guncho Tsurara",
  "hitsugaya:tenso_jurin": "Tensō Jūrin",
  "hitsugaya:dragons_breath": "Dragon's Breath",
  "hitsugaya:ice_age": "Ice Age",
  "hitsugaya:ice_barrier": "Ice Barrier",
  "hitsugaya:ice_explosion": "Ice Explosion",
  "shunsui:kageoni": "Kageoni",
  "shunsui:takaoni": "Takaoni",
  "shunsui:irooni": "Irooni",
  "shunsui:jokenpo": "Jokenpo",
  "soifon:shunpo": "Shunpo",
  "soifon:stealthy": "Stealthy",
  "soifon:shunko": "Shunkō",
  "soifon:nigeki_kessatsu": "Nigeki Kessatsu",
  "rukia:white_moon": "White Moon",
  "rukia:white_wave": "White Wave",
  "rukia:white_sword": "White Sword",
  "rukia:juhaku": "Juhaku",
  "ukitake:throw_n_pull": "Throw 'n Pull",
  "ukitake:double_slam": "Double Slam",
  "ukitake:ying_yang": "Ying Yang",
  "ukitake:stagnation": "Stagnation",
  "ukitake:absorb": "Absorb",
  "tosen:nake": "Nake",
  "tosen:benihiko": "Benihikō",
  "tosen:hado_88": "Hadō #88",
  "tosen:silent_cut": "Silent Cut",
  "tosen:palacio_de_las_espadas": "Palacio de las Espadas",
  "tosen:ecolocalizacion": "Ecolocalización",
  "tosen:cero": "Cero",
  "tosen:los_nueve_aspectos": "Los Nueve Aspectos",
  "aizen:illusions_mastery": "Illusion's Mastery",
  "aizen:betrayal_of_the_illusioner": "Betrayal of the Illusioner",
  "aizen:bakudo_61": "Bakudō #61: Rikujōkōrō",
  "aizen:fools_trick": "Fool's Trick",
  "aizen:illusions.switch": "Switch",
  "aizen:illusions.false_skill": "False Skill",
  "aizen:illusions.kanzen_saimin": "Kanzen Saimin",
  "aizen:kurohitsugi_encantado": "Hadō #90: Kurohitsugi (Encantado)",
  "aizen:fragor": "Fragor",
  "aizen:ultra_fragor": "UltraFragor",
  "aizen:fragor_barrage": "Fragor Barrage",
  "dangai:getsuga_tenshou": "Getsuga Tenshou (Dangai)",
  "dangai:omnidirectional_getsuga": "Omnidirectional Getsuga",
  "dangai:arrogants_counter": "Arrogant's Counter",
  "dangai:lets_fight_somewhere_else": "Let's fight somewhere else.",
  "yamamoto:ennetsu_jigoku": "Ennetsu Jigoku",
  "yamamoto:itto_kaso": "Hadō #96: Ittō Kasō",
  "yamamoto:shunshin": "Shunshin",
  "yamamoto:hells_pierce": "Hell's Pierce",
  "yamamoto:minami": "Minami — Kaka Jūmanokushi Daisōjin",
  "yamamoto:nishi": "Nishi — Zanjitsu Gokui",
  "yamamoto:higashi": "Higashi — Kyokujitsujin",
  "yamamoto:kita": "Kita — Tenchi Kaijin",
  "unohana:hados.byakurai": "Hadō #4 — Byakurai",
  "unohana:hados.sokatsui": "Hadō #33 — Sōkatsui",
  "unohana:hados.soren_sokatsui": "Hadō #73 — Sōren Sōkatsui",
  "unohana:bakudos.seki": "Bakudō #8 — Seki",
  "unohana:bakudos.sajo_sabaku": "Bakudō #63 — Sajō Sabaku",
  "unohana:bakudos.danku": "Bakudō #81 — Dankū",
  "unohana:kaidos.basico": "Kaidō Básico",
  "unohana:kaidos.avancado": "Kaidō Avançado",
  "unohana:kaidos.chiyu": "Chiyu",
  "unohana:kaidos.diagnostico": "Diagnóstico",
  "unohana:kaidos.tratamento": "Tratamento em área",
  "komamura:myoo_barrage": "Myō'ō's Barrage",
  "komamura:destructive_slash": "Destructive Slash",
  "komamura:giants_shield": "Giant's Shield",
  "komamura:ora_ora_ora": "Ora Ora Ora!",
  "komamura:titanic_slash": "Titanic Slash",
  "komamura:stomp": "Stomp",
  "komamura:punch": "Punch",
  "komamura:susanoo_cut": "Susano'o's Cut",
};

// dano aumentado
const DAMAGE = {
  // Ichigo (Shikai) - reduzido
  m1: 17,
  slam: 60,
  slash: 87,
  run: 77,
  tenshou: 145,
  // Ichigo (Tensa Zangetsu / Bankai)
  tensaM1: 22,
  barrage: 150,
  tenshouBankai: 280,
  doubleGetsuga: 300,
  nuke: 500,
  // Byakuya
  byakuyaM1: 18,
  tripleshot: 35,
  disperse: 100,
  bloodshed: 125,
  byakuyaSenkeiM1: 26,
  byakuyaFinisher: 650,
  // Zaraki Kenpachi
  kenpachiM1: 40,
  flashSlash: 150,
  stomp: 200,
  hellsCut: 400,
  // Mayuri Kurotsuchi
  mayuriM1: 16,
  poisonSlash: 60,
  // Grimmjow Jaegerjaquez
  grimmjowM1: 20,
  desgarra: 100,
  raza: 200,
  granReyCero: 350,
  // La Pantera (Resurreccion)
  garras: 40,
  destruir: 270,
  rugido: [100, 150, 200], // tres sequencias
  arrancarCorazon: 700,
  // Ulquiorra Cifer
  ulquiorraM1: 45,
  ceroBala: 100, // por tiro, sao 4
  // Murcielago (Resurreccion)
  garrasMurcielago: 60,
  ceroOscuras: 1400, // original
  ceroOscurasTriplo: 1120, // 20% menos que a Cero Oscuras original
  lanza: 900,
  // Coyote Starkk
  starkkM1: 80,
  slashBarrage: 100, // por corte, sao 5
  sidewayCuts: 200, // por lado, sao 2
  crescentCaninesHit: 150, // por canino na trajetoria
  crescentCaninesExplosion: 300, // por canino ao explodir
  kamarada: 200, // por lobo
  // Resurreccion: Los Lobos
  cuchillosM1: 100,
  lilynetteShot: 120, // tambem usado pelo Rifle, por tiro
  escopeta: 240, // dobro do disparo comum
  ceroMetralletaBullet: 30, // por bala; 6 por fileira, 4 fileiras por disparo, 15 disparos
  // Yammy Llargo
  yammyM1: 20,
  punchesBarrage: 80, // por soco
  wrathsSmash: 60, // por explosao da onda
  wrathsPunch: 200,
  // Resurreccion: Ira
  iraM1: 300,
  quebramundos: 1000,
  rugidoDiabloTick: 50, // por tick, por 3s
  // Tier Harribel
  harribelM1: 50,
  tiburonSlash: 180,
  sharkIssues: 100, // por tubarao, sao 4
  aquasDash: 80, // nao especificado
  // Resurreccion: Tiburon
  dienteM1: 90, // nao especificado
  tsunami: 750,
  vorticePerSecond: 200, // por segundo, por 5s
  malditaAguaPerSecond: 20, // por segundo, ate alguem morrer
  // Barragan Louisenbairn
  barraganM1: 60,
  arroganteSlash: 100, // por corte, sao 3 (300 no total)
  elReiOco: 40, // por cero; 8 direcoes x 5 rajadas
  royalCleave: 500, // unico golpe da addon que ignora bloqueio
  withersSlashesCut: 100, // o corte; a deterioracao vem por cima
  deterioration: 80, // por segundo, em toda deterioracao do Barragan
  // Resurreccion: Arrogante
  arroganteM1: 70,
  // Szayelaporro Granz
  szayelM1: 17,
  rushAndPierce: 75,
  ascendentCut: 50,
  // Resurreccion: Fornicaras
  fornicarasM1: 22,
  posseHit: 20, // por investida da entidade domada - nao especificado
  // Aaroniero Arruruerie
  aaronieroM1: 16,
  aaronieroAwkM1: 20,
  ceroMetalico: 110,
  nejibana: 70,
  devorar: 45,
  tentaculos: 45,
  tridenteKaien: 160,
  ceroMetalicoGloton: 260,
  banquete: 400,
  // Nnoitra Gilga
  nnoitraM1: 40,
  nnoitraResM1: 50,
  muerteMultipleHit: 20,
  avanceFatal: 200,
  duroSlash: 100, // quebra a guarda
  spinningBladeHit: 40, // por corte da lamina girando
  beybladeHit: 60, // por corte da lamina arremessada
  // Gin Ichimaru
  ginM1: 90,
  ginExtendedBlade: 150,
  ginSpiralHit: 100, // por hit da lamina girando
  ginPursuingBlade: 300,
  ginPiercingShinso: 350, // por alvo atravessado
  // Toshiro Hitsugaya
  hitsugayaM1: 50,
  hitsugayaBankaiM1: 90,
  ryusenka: 100,
  gunchoTsurara: 50, // por estaca
  dragonsBreath: 300,
  iceExplosion: 500,
  // Shunsui Kyoraku
  shunsuiM1: 100,
  kageoni: 150, // dividido nos dois cortes
  takaoni: 300,
  irooni: 400,
  // Soi Fon
  soifonM1: 65,
  jakuho: 2000, // Jakuhō Raikōben (super)
  // Rukia Kuchiki
  rukiaM1: 15,
  whiteWave: 30, // por projetil
  whiteSword: 180,
  hado73: 270, // dobra com o encantamento
  // Jūshiro Ukitake
  ukitakeM1: 100,
  throwPull: 180,
  doubleSlam: 240,
  yingYang: 100, // por giro
  // Kaname Tosen
  tosenM1: 30,
  nake: 150,
  benihiko: 250, // total por alvo, dividido entre as laminas
  hado88: 450,
  silentCut: 200,
  silentCutGrimmjow: 400,
  // Kaname Tosen (Visored)
  tosenM1Visored: 40,
  tosenPalacio: 85, // por espada, ate 8 vezes no mesmo alvo
  tosenCero: 400,
  tosenNueveAspectos: 50, // por ataque, ate 10 vezes
  // Ichigo (pos-treino Vizard) - entre Ulquiorra base e Murcielago
  vizardM1: 50,
  dashNSlashTick: 12,
  vizardBarrage: 70,
  descentTensho: 150,
  superNuke: 400,
  // TRUE AWAKENING: Vasto Lorde - reduzido para equilibrar com Barragan
  vastoM1: 65,
  vastoM1Blast: 25,
  whitesShowdown: 100,
  bulletHell: 45,
  ceroRain: 10,
  gritoDiabloTick: 6,
  // Sousuke Aizen (Captain's Fight)
  aizenM1: 120, // Kyōka Suigetsu
  aizenIllusionStrike: 300, // m1 no alvo preso na Illusion's Mastery
  aizenCloneBacklash: 50, // quem acerta um clone
  aizenFoolsTrick: 400, // o corte do Fool's Trick
  aizenKurohitsugiHit: 50, // por ataque; 50 ataques
  // Sousuke Aizen (Hōgyoku)
  aizenHogyokuM1: 160,
  aizenMonsterM1: 320, // Monster Aizen: Kyōka em dobro
  hogyokuKurohitsugiHit: 90, // por ataque; 40 ataques = 3600
  fragor: 1000,
  fragorFragment: 100, // por estilhaco, 30 estilhacos
  ultraFragor: 2000,
  ultraFragorFragment: 200,
  fragorBarrage: 500, // metade do Fragor, 5 explosoes
  fragorBarrageFragment: 50,
  // Ichigo (Dangai)
  dangaiM1: 200,
  dangaiGetsuga: 750,
  dangaiCounterSlash: 250,
  dangaiFightElsewhere: 400,
  getsugaFinal: 10000,
  // Yamamoto Genryūsai
  yamamotoM1: 170,
  zankaM1: 200,
  ennetsuColumn: 100,
  ittoKaso: 300,
  shunshin: 110,
  hellsPierceImpale: 350,
  hellsPierceBlast: 250,
  zankaBlockBlast: 200,
  minamiHit: 50,
  higashi: 650,
  kita: 6000,
  // Retsu Unohana
  unohanaM1: 30,
  byakurai: 40,
  sokatsui: 70,
  sorenSokatsui: 140,
  // Sajin Komamura
  tenkenM1: 45,
  myooBarrageCut: 50,
  destructiveSlash: 250,
  oraPunch: 10,
  myooM1: 45,
  titanicSlash: 500,
  myooStomp: 200,
  myooPunch: 100,
  susanooCut: 750,
};

// duracao do buff de dano do Sakura's Coating - nao foi especificada, assumi 30s
const COATING_DURATION_TICKS = 600;

const SLAM_RADIUS = 4.5; // area de dano aumentada

const DASH_COOLDOWN_TICKS = 80; // 4s
const DASH_HORIZONTAL_STRENGTH = 6.5; // impulso bem maior
const DASH_VERTICAL_STRENGTH = 0.25;
const DASH_TELEPORT_RANGE = 40; // alcance do dash-teleporte do Vasto Lorde

// Zaraki Kenpachi
const FLASH_SLASH = {
  advances: 3,
  distancePerAdvance: 6,
  stepsPerAdvance: 6,
  gapTicks: 8, // "pequeno intervalo" entre um avanco e o proximo
};
const STOMP_RADIUS = 3; // area 6x6 blocos (dobro do alcance original)
const HELLS_CUT_RANGE = 10; // metade do alcance do Getsuga Tenshou (20)
const KENPACHI_HUNT = {
  searchRadius: 40,
  behindDistance: 1.5,
  slownessAmplifier: 4, // slowness 5
  slownessTicks: 60, // 3s
  darknessTicks: 80, // 4s
};

// Mayuri Kurotsuchi
const POISON_SLASH = {
  forward: 4, // blocos pra frente
  width: 3, // largura total da caixa (1.5 pra cada lado)
  verticalReach: 3,
  slownessAmplifier: 255, // "lentidao inf": no maximo o alvo nao sai do lugar
  slownessTicks: 40, // 2s
};
// Grimmjow Jaegerjaquez
const DESGARRA = { forward: 5, width: 7, verticalReach: 2.5 };
const RAZA = { distance: 20, steps: 10 }; // 2 blocos por tick = dobro do Getsuga Run
const GRAN_REY_CERO = { radius: 2, range: 28, speed: 1.2 }; // raio 2 = tamanho de ghast
const DESTRUIR = { forward: 6, width: 5, verticalReach: 4, cuts: 3, gapTicks: 6 };
const RUGIDO = { radius: 6, gapTicks: 14 };
const ARRANCAR_CORAZON = {
  dashDistance: 5,
  dashSteps: 5,
  searchRadius: 2.2,
  holdDistance: 1.6,
  grabTicks: 40, // 2s segurando antes de arrancar
};
const DISPARO = { speedAmplifier: 9, durationTicks: 100 }; // speed 10 por 5s

// Ulquiorra Cifer
const CERO_BALA = { shots: 4, gapTicks: 5, radius: 0.9, range: 26, speed: 2.6 };
const SONIDO = { searchRadius: 50, distance: 1.6 };
const NIHIL = {
  forward: 5,
  width: 4,
  verticalReach: 3,
  healthFraction: 0.3, // tira 30% da vida atual do alvo
};
const ENIGMA = {
  radius: 10, // area 20x20
  durationTicks: 400, // 20s
  tickInterval: 10,
};
// "4x MAIOR" que o Gran Rey Cero (raio 2 -> 8) e 4x o dano
const CERO_OSCURAS = { radius: 8, range: 30, speed: 1.1, shellParticles: 60 };
const LANZA = { speed: 2.2, range: 34, blastRadius: 18 }; // maior explosao do addon

const TOXIC_FOG = {
  radius: 5, // area 10x10
  height: 2.2,
  durationTicks: 300, // 15s
  tickInterval: 10,
  refreshTicks: 30, // um pouco maior que o intervalo pro efeito nao piscar
  mayuriPoison: { durationSeconds: 10, damagePerSecond: 10 },
  slownessAmplifier: 2, // slowness 3
  particlesPerTick: 14,
  endMessage: "§7A Toxic Fog se dissipou.",
};

// Coyote Starkk
const SLASH_BARRAGE = {
  advances: 5,
  distancePerAdvance: 3,
  stepsPerAdvance: 3,
  gapTicks: 4,
};
const SIDEWAY_CUTS = { searchRadius: 20, distance: 1.8, gapTicks: 5 };
const CRESCENT_CANINES = {
  angleDeg: 18, // abertura do V a partir da direcao que o player olha
  growTicks: 80, // 4s crescendo
  startRadius: 0.8,
  endRadius: 3.5,
  speed: 1.1,
  explosionRadius: 5,
};
const KAMARADA = {
  count: 5,
  searchRadius: 30,
  speed: 1.3,
  maxTicks: 100, // tempo de vida maximo caso nao acerte nada
  hitRadius: 2,
  turnRate: 0.35, // quao forte cada lobo corrige rumo ao alvo por tick
  particle: "grimmjow:cero",
  // funcao porque o DAMAGE e declarado depois desse bloco
  damage: () => DAMAGE.kamarada,
};
// Resurreccion: Los Lobos (persona Lilynette)
const LILYNETTE_SHOT = {
  radius: 2, // "do tamanho do gran rey cero"
  range: 56, // dobro do alcance do gran rey cero (28)
  speed: 1.2,
};
const RIFLE = { shots: 3, gapTicks: 4, radius: 0.9, range: 26, speed: 1.6, searchRadius: 30 };
const ESCOPETA = { radius: 1.3, range: 12, speed: 2 };
// dispara FILEIRAS de balas: varias de uma vez, pausa, outra fileira
// Yammy Llargo
const PUNCHES_BARRAGE = { punches: 5, gapTicks: 6, forward: 4, width: 3, blastRadius: 2.5 };
const FACE_HOLD = {
  searchRadius: 12,
  holdDistance: 2.2,
  holdTicks: 60, // 3s segurando pelo rosto
  launchHorizontal: 5.5,
  launchVertical: 1.4,
  launchDelayTicks: 3, // folga entre o ultimo teleport e o arremesso
};
const WRATHS_SMASH = {
  jumpStrength: 2.2,
  maxAirTicks: 70,
  rings: 4,
  ringGapTicks: 6,
  maxRadius: 12,
};
const WRATHS_PUNCH = {
  forward: 5,
  width: 4,
  knockbackHorizontal: 6.5,
  knockbackVertical: 1.1,
};
// Resurreccion: Ira
const QUEBRAMUNDOS = { blastRadius: 26 }; // maior que a Lanza del Relampago (18)
const CERO_BARRAGE = { shots: 10, gapTicks: 8 };
const RUGIDO_DIABLO = { radius: 12, durationTicks: 60 }; // 50 por tick por 3s

// Tier Harribel
const TIBURON_SLASH = { radius: 4, thickness: 1.3, range: 26, speed: 2.2 };
const SHARK_ISSUES = {
  count: 4,
  searchRadius: 30,
  speed: 1.3,
  maxTicks: 120,
  hitRadius: 2.2,
  turnRate: 0.35,
  particle: "harribel:agua",
  summonSound: "mob.dolphin.splash",
  damage: () => DAMAGE.sharkIssues,
};
const WATER_PRISON = {
  range: 30, // alcance da mira
  radius: 1, // 1 bloco pra cada lado = caixa 3x3
  durationTicks: 200, // 10s
  leash: 0.7, // se andar mais que isso, volta pro centro da cela
};
const AQUAS_DASH = { distance: 24, steps: 12 };
// Resurreccion: Tiburon
const TSUNAMI = {
  width: 14,
  height: 6,
  range: 30,
  speed: 1.5,
  knockbackHorizontal: 3.2,
  knockbackVertical: 0.9,
};
const VORTICE = {
  range: 30,
  radius: 7,
  durationTicks: 100, // 5s
  tickInterval: 20, // 200 de dano por segundo
  spinSpeed: 0.4, // radianos por tick que o alvo gira em volta do centro
  minOrbit: 2.5, // quem esta no olho do vortice e jogado pra fora pra girar
};
const MALDITA_AGUA = { range: 30, tickInterval: 20 }; // 20 por segundo, sem prazo

// Ichigo (pos-treino Vizard)
const DASH_N_SLASH = {
  dashes: 6,
  ticksPerDash: 4,
  distancePerTick: 0.9,
  forward: 4.5,
  width: 4,
  verticalReach: 3,
};
const VIZARD_BARRAGE = {
  shots: 6,
  gapTicks: 10,
  radius: 3.4,
  thickness: 1.4,
  range: 26,
  speed: 2.4,
};
const DESCENT_TENSHO = { travel: 12, steps: 8, blastRadius: 12 };
// "dobro da velocidade" do Nuke Tenshou original (speed 3)
const SUPER_NUKE = { radius: 5.4, thickness: 2.7, range: 34, speed: 6, rows: 18 };
// TRUE AWAKENING: Vasto Lorde
const WHITES_SHOWDOWN = {
  searchRadius: 40,
  behind: 1.4,
  rings: 4,
  ringGapTicks: 6,
  maxRadius: 14,
  buryDepth: 2, // dois blocos abaixo, como o pedido pede
  buryTicks: 40,
};
const BULLET_HELL = {
  durationTicks: 200, // 10s cuspindo cero
  gapTicks: 12,
  radius: 2.4,
  range: 34,
  speed: 1.8,
  blastRadius: 9, // "area BEM GRANDE"
};
const CERO_RAIN = {
  skyHeight: 42,
  drops: 320,
  gapTicks: 1,
  spreadRadius: 30,
  fallSpeed: 2.8,
  hitRadius: 4.5,
  // metade dos pingos cai perto de alguem em vez de num ponto qualquer: sem
  // isso 60 pingos espalhados num raio grande acertam ~1 vez e a skill nao faz
  // nada, que nao e o que "sao varios entao tudo bem" quer dizer
  aimedShare: 0.5,
  aimScatter: 4.5,
};
const GRITO_DIABLO = { radius: 45, durationTicks: 200 }; // alcance absurdo, 10s

// Szayelaporro Granz
const RUSH_AND_PIERCE = { searchRadius: 24, steps: 10, hitRadius: 2.6 };
const ASCENDENT_CUT = { radius: 3.2, thickness: 1.2, range: 24, speed: 2, lift: 0.9 };
const CARBON_COPY = {
  searchRadius: 30,
  durationTicks: 200, // 10s de vida da copia - nao especificado
  strikeIntervalTicks: 30,
  speed: 0.9,
  hitRadius: 2.2,
  fallbackDamage: 20, // alvo sem personagem ativo nao tem m1 pra copiar
};
const LEARN_AND_ADAPT = {
  range: 40,
  durationTicks: 300, // 15s, igual a Pesquisa - nao especificado
  damageMultiplier: 2, // dobra o dano que o alvo recebe
};
// Resurreccion: Fornicaras
const TEATRO = {
  range: 24,
  freezeTicks: 200, // 10s parados enquanto o menu esta aberto
  armDamageCut: 0.2, // braco: -20% de dano do inimigo
  heartHealthCut: 0.3, // coracao: -30% da vida maxima
};
const POSSE = {
  radius: 20,
  searchRadius: 40,
  durationTicks: 600, // 30s domadas
  tickInterval: 10,
  hitRadius: 2.5,
  speed: 0.9,
};
const GABRIEL = { healthThreshold: 50, blastRadius: 4, blastDamage: 100 }; // dano do estouro nao especificado

// Barragan Louisenbairn
const ARROGANTE_SLASH = {
  forward: 5,
  width: 5,
  verticalReach: 3,
  cuts: 3,
  gapTicks: 6,
  buryDepth: 1.1, // quanto o alvo afunda no chao no ultimo corte
  buryTicks: 40, // 2s preso la embaixo
};
const EL_REI_OCO = {
  directions: 8,
  volleys: 5,
  gapTicks: 12,
  radius: 1.1,
  range: 22,
  speed: 1.6,
};
const ROYAL_CLEAVE = { forward: 6, width: 4, verticalReach: 4 };
const WITHERS_SLASHES = { forward: 5, width: 5, verticalReach: 3, seconds: 3 };
// Resurreccion: Arrogante
const RUIR_DEL_REY = { radius: 12, seconds: 7 }; // area nao especificada
const RESPIRA = { durationTicks: 200 }; // 10s imune a longo alcance
const EL_MALDITO = {
  radius: 25, // mesmo tamanho da Konjiki do Mayuri (50x50)
  height: 3.2,
  durationTicks: 80, // 4s: "cega e causa deterioracao por 4 segundos"
  tickInterval: 10,
  refreshTicks: 30,
  blindnessAmplifier: 0,
  particlesPerTick: 60,
  particle: "barragan:podridao",
  deterioration: { perSecond: 80, seconds: 4 },
  endMessage: "§7A neblina do El Maldito se dissipou.",
};
const LA_MUERTE = { seconds: 20 };

// Nnoitra Gilga
const DURO_SLASH = { forward: 6, width: 9, verticalReach: 3 }; // corte deitado, largo
// A Spinning Blade e a Beyblade sao a MESMA lamina dupla (pedido: mesmo
// tamanho), entao o tamanho mora num lugar so. radius = alcance de cada ponta,
// ou seja, a area toda tem 12 blocos de ponta a ponta.
const DOUBLE_BLADE = { radius: 6, reachBelow: 1.3, reachAbove: 1.9 };
const SPINNING_BLADE = {
  durationTicks: 200, // 10s
  degreesPerTick: 18, // 1 volta por segundo: uma ponta passa a cada meio segundo
  hitIntervalTicks: 8, // o mesmo alvo so leva "por hit" de novo depois disso
};
const BEYBLADE = {
  startDistance: 2,
  range: 28,
  speed: 0.8, // blocos por tick
  degreesPerTick: 30, // gira mais rapido que a Spinning Blade, e um piao
  hitIntervalTicks: 5,
};
const HIERRO = {
  durationTicks: 200, // 10s
  damageTakenMultiplier: 0.7, // recebe 70% do dano; soma (multiplica) com a individualidade
};

const CERO_METRALLETA = {
  volleys: 15,
  volleyGapTicks: 20, // 15 disparos em 15s
  rowsPerVolley: 4, // cada disparo e um pente de 4 fileiras, nao uma so
  rowGapTicks: 3, // as fileiras do mesmo disparo saem coladas
  rowHeightStep: 0.45, // cada fileira sai um pouco mais alta que a anterior
  bulletsPerRow: 6,
  rowWidth: 4, // largura da fileira, as balas saem lado a lado
  radius: 0.8,
  range: 40,
  speed: 2.5,
};


/* ---------------------------------------------------------
   Utils
   --------------------------------------------------------- */

function getInv(player) {
  return player.getComponent("minecraft:inventory").container;
}

function getActiveCharacter(player) {
  const id = player.getDynamicProperty(DP.character);
  return id ? CHARACTERS[id] : undefined;
}

function getAwakening(player) {
  return player.getDynamicProperty(DP.awakening) ?? 0;
}

function addAwakening(player, amount) {
  // personagem sem awakening nem super ataque (o Nnoitra) nao tem o que encher
  const character = getActiveCharacter(player);
  if (character && !character.awakening && !character.superAttack) return;

  const cur = getAwakening(player);
  const next = Math.min(100, cur + amount);
  player.setDynamicProperty(DP.awakening, next);
}

function tickOf(player, key) {
  const value = player.getDynamicProperty(key);
  return typeof value === "number" ? value : undefined;
}

// Os cooldowns sao gravados como "tick absoluto do ultimo uso", mas o
// system.currentTick volta pra zero toda vez que o mundo recarrega enquanto a
// dynamic property sobrevive. Sem esse tratamento acontecem duas coisas:
//   - skill nunca usada fica travada no comeco do mundo (now - 0 < duracao);
//   - skill ja usada fica travada pra sempre depois de um reload, porque o
//     stamp gravado fica "no futuro" e a subtracao da negativo.
// Um stamp maior que o tick atual so pode ter vindo de outra sessao.
function onCooldown(player, key, durationTicks, currentTick) {
  const last = tickOf(player, key);
  if (last === undefined) return false;
  if (last > currentTick) {
    player.setDynamicProperty(key, undefined);
    return false;
  }
  return currentTick - last < durationTicks;
}

// mesma historia pros "fins" absolutos (coating / mascara): qualquer deadline
// mais distante que a duracao maxima do efeito e lixo de uma sessao anterior
function readTickDeadline(player, key, maxDurationTicks) {
  const end = player.getDynamicProperty(key);
  if (typeof end !== "number" || end <= 0) return 0;
  if (end > system.currentTick + maxDurationTicks) {
    player.setDynamicProperty(key, 0);
    return 0;
  }
  return end;
}

// zera tudo que e medido em tick absoluto - chamado quando o player entra no
// mundo, ja que o contador de ticks reinicia junto com o mundo
function clearSessionTimers(player) {
  for (const itemId in SKILL_COOLDOWN_TICKS) {
    player.setDynamicProperty(cdKeyForSkill(itemId), undefined);
  }
  player.setDynamicProperty(DP.dashCd, undefined);
  player.setDynamicProperty(DP.coatingEnd, 0);
  player.setDynamicProperty(DP.maskEnd, 0);
  player.setDynamicProperty(DP.blockEnd, 0);
  player.setDynamicProperty(DP.blockCd, undefined);
  player.setDynamicProperty(DP.respiraEnd, 0);
  player.setDynamicProperty(DP.hierroEnd, 0);
  player.setDynamicProperty(DP.intocableEnd, 0);
  player.setDynamicProperty(DP.muerteArmed, false);
  player.setDynamicProperty(DP.mayuriParalysis, false);
  player.setDynamicProperty("mv:mayuri_poison_gabriel", false);
  player.setDynamicProperty(DP.frozenEnd, 0);
  player.setDynamicProperty(DP.genericSkill,0);player.setDynamicProperty(DP.pressureActiveUntil,0);player.setDynamicProperty(DP.pressureCooldown,undefined);player.setDynamicProperty(DP.airStepActive,false);player.setDynamicProperty("mv:reiatsu_jump_cd",undefined);player.setDynamicProperty("mv:reiatsu_jump_charge",0);
  player.setDynamicProperty(DP.gabrielArmed, false);
  player.setDynamicProperty(DP.aaronieroMaskEnd, 0);
  player.setDynamicProperty(DP.aaronieroAbsorbed, JSON.stringify([]));
  player.setDynamicProperty(DP.aaronieroDevouredCount, 0);
  player.setDynamicProperty("mv:aaroniero_selected", 0);
}

function setCooldown(player, key, currentTick) {
  player.setDynamicProperty(key, currentTick);
}

function cdKeyForSkill(itemId) {
  return "mv:cd_" + itemId.replace(":", "_");
}

function forceGiveLockedItem(container, slot, itemId) {
  // getSlot/hasItem/typeId NAO cria ItemStack: esse loop roda pra todo player
  // varias vezes por segundo
  let has = false;
  try {
    const cs = container.getSlot(slot);
    has = cs.hasItem() && cs.typeId === itemId;
  } catch (e) {
    const existing = container.getItem(slot);
    has = !!existing && existing.typeId === itemId;
  }
  if (!has) container.setItem(slot, new ItemStack(itemId, 1));
}

function healToMax(player, maxHealth) {
  const hp = player.getComponent("minecraft:health");
  if (hp) {
    hp.setCurrentValue(Math.min(maxHealth, hp.effectiveMax));
  }
}

// Um efeito novo so substitui o que ja esta ativo quando o amplifier e MAIOR OU
// IGUAL: aplicar health_boost 244 (os 1000 do Yammy base) por cima do 255 da Ira
// nao fazia NADA, entao o player saia do awakening com o teto da forma desperta
// - eram esses os +44 de vida. Valia pro speed e pro regen tambem. Por isso todo
// efeito permanente e removido antes de ser reaplicado.
const PERMANENT_EFFECT_TICKS = 20000000;

function setPermanentEffect(player, effect, amplifier) {
  try {
    player.removeEffect(effect);
  } catch (e) {}
  try {
    player.addEffect(effect, PERMANENT_EFFECT_TICKS, {
      amplifier,
      showParticles: false,
    });
  } catch (e) {}
}

// Tirar o health_boost derruba o teto pra 20 e o jogo corta a vida atual junto,
// entao a vida e guardada antes e devolvida logo depois. O limite usado e o teto
// CALCULADO da forma nova, nao o effectiveMax: o jogo pode levar um tick pra
// atualizar o atributo e nesse meio tempo ele ainda reporta o teto antigo.
function setMaxHealth(player, maxHealth) {
  const before = player.getComponent("minecraft:health")?.currentValue ?? 0;

  setPermanentEffect(player, "health_boost", HEALTH_BOOST_LEVEL_FOR(maxHealth));

  const hp = player.getComponent("minecraft:health");
  if (hp) hp.setCurrentValue(Math.min(before, realMaxHealthFor(maxHealth)));
}

// O coracao cortado pelo Teatro de Títeres derruba o teto de vida em 30%. Entra
// aqui pra valer em TODA troca de forma (ativar, despertar, reverter, respawn)
// em vez de so no momento do corte.
function cutHealthFor(player, maxHealth) {
  try {
    if (player.getDynamicProperty(DP.heartCut)) {
      return Math.round(maxHealth * (1 - TEATRO.heartHealthCut));
    }
  } catch (e) {}
  return maxHealth;
}

function applyCharacterEffects(
  player,
  configuredMaxHealth,
  speedAmplifier,
  regenAmplifier = REGEN_AMPLIFIER,
  extraEffects
) {
  let adjustedConfiguredHealth = configuredMaxHealth;
  if (getActiveCharacter(player)?.id === "aaroniero") {
    const absorbed = getAaronieroDevouredCount(player);
    adjustedConfiguredHealth = Math.round(configuredMaxHealth * (1 + absorbed * 0.05));
  }
  const maxHealth = cutHealthFor(player, adjustedConfiguredHealth);
  player.setDynamicProperty(DP.healthScale, healthScaleFor(maxHealth));

  setMaxHealth(player, maxHealth);
  setPermanentEffect(player, "speed", speedAmplifier);
  // Individualidade do Tosen: cegueira permanente (so some durante a Enma Korogi)
  if (getActiveCharacter(player)?.id === "tosen" && !tosenEnma.has(player.id)) {
    setPermanentEffect(player, "blindness", 0);
  }

  // regenAmplifier null = forma sem regeneracao passiva. A Ira do Yammy troca
  // ela por uma cura em bloco a cada 4s; somar as duas descaracterizaria o numero.
  if (regenAmplifier === null) {
    try {
      player.removeEffect("regeneration");
    } catch (e) {}
  } else {
    setPermanentEffect(player, "regeneration", regenAmplifier);
  }

  // efeitos permanentes proprios da forma (lentidao e fadiga da Ira)
  for (const extra of extraEffects ?? []) {
    setPermanentEffect(player, extra.effect, extra.amplifier ?? 0);
  }
}

function isTrueForm(player) {
  try {
    return !!player.getDynamicProperty(DP.trueForm);
  } catch (e) {
    return false;
  }
}

// Forma ativa do personagem. A segunda fase (o Vasto Lorde do Ichigo Vizard)
// ganha da primeira, que ganha da forma base. TUDO que precisa saber "qual forma
// esta valendo agora" passa por aqui, senao cada lugar decide diferente.
function activeFormOf(player, character = getActiveCharacter(player)) {
  if (!character || !character.awakening || !isAwakened(player)) return undefined;
  const form = character.awakening;
  if (form.trueForm && isTrueForm(player)) return form.trueForm;
  return form;
}

// Reaplica os efeitos permanentes da forma atual. Um buff temporario (o Disparo
// de La Pantera, por exemplo) SOBRESCREVE o efeito permanente em vez de somar,
// entao quando ele acaba o player ficaria sem nada se ninguem reaplicasse.
function reapplyFormEffects(player) {
  const character = getActiveCharacter(player);
  if (!character) return;

  const form = activeFormOf(player, character);
  applyCharacterEffects(
    player,
    form?.health ?? character.health,
    form?.speedAmplifier ?? BASE_SPEED_AMPLIFIER,
    form && "regenAmplifier" in form ? form.regenAmplifier : REGEN_AMPLIFIER,
    form?.extraEffects
  );
}

// avisado uma vez por player, e rearmado assim que o marcador entra
const warnedOffhand = new Set();

// O marcador na offhand e a UNICA coisa que faz o modelo ficar gigante: o
// player.entity.json do RP le essa slot por Molang. Se ele nao chegar la, nao
// tem escala nenhuma - e o Bedrock RECUSA a offhand em silencio pra item sem
// minecraft:allow_off_hand (setEquipment devolve false e nao lanca). Por isso
// aqui a slot e LIDA DE VOLTA: a chamada nao e prova de nada.
function setOffhandMarker(player, itemId) {
  try {
    const equip = player.getComponent("minecraft:equippable");
    if (!equip) return false;

    const current = equip.getEquipment(EquipmentSlot.Offhand);
    if (!itemId) {
      if (current) equip.setEquipment(EquipmentSlot.Offhand, undefined);
      return true;
    }
    if (current?.typeId === itemId) return true;

    equip.setEquipment(EquipmentSlot.Offhand, new ItemStack(itemId, 1));

    const landed = equip.getEquipment(EquipmentSlot.Offhand)?.typeId === itemId;
    if (landed) {
      warnedOffhand.delete(player.id);
    } else if (!warnedOffhand.has(player.id)) {
      // sem isso a forma gigante simplesmente nao acontece e nada diz por que
      warnedOffhand.add(player.id);
      player.sendMessage(
        `§cA forma gigante não conseguiu ocupar a offhand (§7${itemId}§c): ` +
          `§7o item precisa de minecraft:allow_off_hand.`
      );
    }
    return landed;
  } catch (e) {
    return false; // sem equippable ou player invalido
  }
}

// Peitoral da forma: e ele que troca a skin do player no cliente (o RP tem um
// attachable com a geometria e a textura do Ichigo hollowficado amarrados nesse
// item). Sem ele a forma acontece so nos numeros.
// avisado uma vez por player, rearmado assim que a peca entra
const warnedArmor = new Set();

function equipArmorPiece(player, itemId) {
  try {
    const equip = player.getComponent("minecraft:equippable");
    if (!equip) return false;

    const current = equip.getEquipment(EquipmentSlot.Chest);
    if (current?.typeId === itemId) return true;

    equip.setEquipment(EquipmentSlot.Chest, new ItemStack(itemId, 1));

    // LE DE VOLTA. O Bedrock recusa slot de equipamento em silencio quando o
    // item nao serve pra ela (foi exatamente isso com o marcador da offhand do
    // Yammy): setEquipment devolve false e nao lanca nada.
    const landed = equip.getEquipment(EquipmentSlot.Chest)?.typeId === itemId;
    if (landed) {
      warnedArmor.delete(player.id);
    } else if (!warnedArmor.has(player.id)) {
      warnedArmor.add(player.id);
      player.sendMessage(
        `§cO peitoral da forma não entrou no peito (§7${itemId}§c). ` +
          `§7Sem ele a skin não troca — o item precisa de minecraft:wearable.`
      );
    }
    return landed;
  } catch (e) {
    return false;
  }
}

/* O peitoral da forma nao pode virar item de inventario. Tirando ele, o loop
   devolvia uma copia pro peito e a que saiu ficava na mochila: dava pra
   acumular e ate vestir sem personagem nenhum. Agora a peca certa fica no
   peito, qualquer copia solta some, e peca de forma que nao esta valendo sai
   do peito tambem - e por isso que a armadura some quando o awakening acaba. */
// a mochila inteira so precisa ser varrida de tempos em tempos (o peitoral que
// sobrou some em ate 2s), nao a cada 10 ticks pra cada player
const lastArmorSweepTick = new Map();

function sweepFormArmor(player, wanted) {
  const nowTick = system.currentTick;
  if (
    FORM_ARMOR_PIECES.size > 0 &&
    nowTick - (lastArmorSweepTick.get(player.id) ?? -1000) >= 40
  ) {
    lastArmorSweepTick.set(player.id, nowTick);
    try {
      const inv = getInv(player);
      for (let slot = 0; slot < inv.size; slot++) {
        const cs = inv.getSlot(slot);
        if (cs.hasItem() && FORM_ARMOR_PIECES.has(cs.typeId)) cs.setItem(undefined);
      }
    } catch (e) {}
  }

  try {
    const equip = player.getComponent("minecraft:equippable");
    const chest = equip?.getEquipment(EquipmentSlot.Chest);
    if (chest && FORM_ARMOR_PIECES.has(chest.typeId) && chest.typeId !== wanted) {
      equip.setEquipment(EquipmentSlot.Chest, undefined);
    }
  } catch (e) {}

  if (wanted) equipArmorPiece(player, wanted);
}

function clearArmorPiece(player, itemId) {
  try {
    const equip = player.getComponent("minecraft:equippable");
    if (!equip) return;
    if (equip.getEquipment(EquipmentSlot.Chest)?.typeId !== itemId) return;
    equip.setEquipment(EquipmentSlot.Chest, undefined);
  } catch (e) {}
}

// tira os efeitos permanentes que so existiam na forma desperta
function clearFormExtras(player, form) {
  for (const extra of form?.extraEffects ?? []) {
    try {
      player.removeEffect(extra.effect);
    } catch (e) {}
  }
  if (form?.offhandMarker) setOffhandMarker(player, undefined);
  // a peca pode ter vindo da primeira OU da segunda fase
  if (form?.armorPiece) clearArmorPiece(player, form.armorPiece);
  if (form?.trueForm?.armorPiece) clearArmorPiece(player, form.trueForm.armorPiece);
  disableTallView(player);
}

/* ---------------------------------------------------------
   Bloqueio universal (agachar + m1) - todo personagem tem
   --------------------------------------------------------- */

// quem estava bloqueando no passe anterior, pra saber QUANDO o prazo acabou
const blockingNow = new Set();

function startBlock(player) {
  const now = system.currentTick;

  if (onCooldown(player, DP.blockCd, BLOCK.cooldownTicks, now)) {
    const last = tickOf(player, DP.blockCd) ?? now;
    const remaining = Math.ceil((BLOCK.cooldownTicks - (now - last)) / 20);
    player.onScreenDisplay.setTitle("", {
      subtitle: `§cGuarda recarregando... §7(${remaining}s)`,
      fadeInDuration: 0,
      fadeOutDuration: 5,
      staySeconds: 10,
    });
    return;
  }

  player.setDynamicProperty(DP.blockEnd, now + BLOCK.durationTicks);
  blockingNow.add(player.id);
  try {
    player.dimension.playSound("item.shield.block", player.location, {
      volume: 1,
      pitch: 0.9,
    });
  } catch (e) {}
  player.sendMessage(
    `§aBloqueando! §7Metade do dano por até ${BLOCK.durationTicks / 20}s.`
  );
}

// O cooldown so comeca quando a guarda CAI - se contasse da ativacao, os 5s de
// bloqueio e os 5s de recarga andariam juntos e daria pra bloquear sem intervalo.
function endBlock(player, reason) {
  player.setDynamicProperty(DP.blockEnd, 0);
  player.setDynamicProperty(DP.blockCd, system.currentTick);
  blockingNow.delete(player.id);
  try {
    player.sendMessage(
      reason === "manual" ? "§7Você baixou a guarda." : "§7Sua guarda caiu."
    );
  } catch (e) {}
}

function toggleBlock(player) {
  if (isBlocking(player)) endBlock(player, "manual");
  else startBlock(player);
}

function isAwakened(player) {
  return !!player.getDynamicProperty(DP.awakened);
}

function isCoated(player) {
  return (
    system.currentTick <
    readTickDeadline(player, DP.coatingEnd, COATING_DURATION_TICKS)
  );
}

function isMasked(player) {
  return (
    system.currentTick <
    readTickDeadline(player, DP.maskEnd, HOLLOW_MASK_DURATION_TICKS)
  );
}

function dmgMultiplier(player) {
  let multiplier = isCoated(player) ? 1.2 : 1;

  // braco cortado pelo Teatro de Títeres do Szayelaporro
  try {
    if (player.getDynamicProperty(DP.armCut)) multiplier *= 1 - TEATRO.armDamageCut;
  } catch (e) {}

  // formas despertas que dao buff permanente de dano (Pressao do Kenpachi)
  const character = getActiveCharacter(player);
  if (character?.id === "aaroniero" && system.currentTick < readTickDeadline(player, DP.aaronieroMaskEnd, 240)) {
    multiplier *= 1.15;
  }
  const awakenedBonus = character?.awakening?.damageMultiplier;
  if (awakenedBonus && isAwakened(player)) {
    multiplier *= awakenedBonus;
  }
  // Evolution do Aizen Hōgyoku: +5% a cada 20%
  if (character?.id === "aizen_hogyoku") multiplier *= hogyokuDamageBonus(player);

  return multiplier;
}

// dano ao longo do tempo generico (sangramento) - reutilizavel por qualquer personagem
// DoTs e marcas visuais ativos por alvo: o Diagnóstico da Unohana limpa tudo
const activeDots = new Map(); // id do alvo -> Set de ids de interval

function trackDot(entity, intervalId) {
  let set = activeDots.get(entity.id);
  if (!set) {
    set = new Set();
    activeDots.set(entity.id, set);
  }
  set.add(intervalId);
}

function untrackDot(entity, intervalId) {
  const set = activeDots.get(entity?.id);
  if (!set) return;
  set.delete(intervalId);
  if (!set.size) activeDots.delete(entity.id);
}

function clearDots(entityId) {
  const set = activeDots.get(entityId);
  if (!set) return;
  for (const id of set) system.clearRun(id);
  activeDots.delete(entityId);
}

function applyDot(entity, player, perSecond, totalSeconds) {
  let ticks = 0;
  const dotInterval = system.runInterval(() => {
    ticks++;
    try {
      if (entity.getComponent("minecraft:health")) {
        dealDamage(entity, perSecond * dmgMultiplier(player), player);
      }
    } catch (e) {
      system.clearRun(dotInterval);
      untrackDot(entity, dotInterval);
      return;
    }
    if (ticks >= totalSeconds) {
      system.clearRun(dotInterval);
      untrackDot(entity, dotInterval);
    }
  }, 20);
  trackDot(entity, dotInterval);
}

/* ---------------------------------------------------------
   Deterioração e Respira (Barragan)
   --------------------------------------------------------- */

// Cinco skills do Barragan causam "deterioracao": e o applyDot generico com a
// marca visual do envelhecimento por cima, num lugar so.
function applyDeterioration(target, player, perSecond, seconds) {
  applyDot(target, player, perSecond, seconds);

  let ticks = 0;
  const interval = system.runInterval(() => {
    ticks += 5;
    try {
      const loc = target.location;
      for (let i = 0; i < 3; i++) {
        target.dimension.spawnParticle("barragan:podridao", {
          x: loc.x + (Math.random() - 0.5) * 0.9,
          y: loc.y + 0.3 + Math.random() * 1.8,
          z: loc.z + (Math.random() - 0.5) * 0.9,
        });
      }
    } catch (e) {
      system.clearRun(interval); // alvo morreu ou saiu do mundo
      untrackDot(target, interval);
      return;
    }
    if (ticks >= seconds * 20) {
      system.clearRun(interval);
      untrackDot(target, interval);
    }
  }, 5);
  trackDot(target, interval);
}

// A Respira come todo ataque de longo alcance: os tres sistemas genericos de
// projetil (esfera de energia, onda crescente e fera guiada) consultam isso
// antes de causar dano. Golpe corpo a corpo passa normal.
function isRespiring(entity) {
  // Nishi do Yamamoto: o fogo em volta dele queima o que vem voando
  if (isNishiActive(entity)) return true;
  try {
    return (
      system.currentTick < readTickDeadline(entity, DP.respiraEnd, RESPIRA.durationTicks)
    );
  } catch (e) {
    return false;
  }
}

function showRespiraGuard(entity) {
  if (isNishiActive(entity)) {
    try {
      const l = entity.location;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        entity.dimension.spawnParticle(i % 2 ? YAMAMOTO.infernalParticle : "yamamoto:chama", {
          x: l.x + Math.cos(a) * 1.2,
          y: l.y + 1.2,
          z: l.z + Math.sin(a) * 1.2,
        });
      }
    } catch (e) {}
    return;
  }
  try {
    const loc = entity.location;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      entity.dimension.spawnParticle("barragan:podridao", {
        x: loc.x + Math.cos(angle) * 1.2,
        y: loc.y + 1.2,
        z: loc.z + Math.sin(angle) * 1.2,
      });
    }
  } catch (e) {}
}

/* ---------------------------------------------------------
   Senkei: zonas ativas + estado da arma do Byakuya
   --------------------------------------------------------- */

// Zonas ativas no mundo. O Senkei do Byakuya e a Enigma do Ulquiorra sao a
// mesma estrutura com regras diferentes:
//   blocksSkills      - quem esta dentro so pode usar o m1
//   blocksOwnerSkills - se a regra acima vale tambem pro dono da zona
//   traps             - puxa de volta quem tentar sair
//   blocksRegen       - tira a regeneracao de quem esta dentro
const activeZones = [];

function distance2D(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

// zonas que contem essa entidade agora
function zonesAt(entity) {
  const location = entity.location;
  const dimensionId = entity.dimension.id;
  return activeZones.filter(
    (zone) =>
      zone.dimension.id === dimensionId &&
      distance2D(location, zone.center) <= zone.radius
  );
}

// zona que esta travando as skills desse player (undefined se nenhuma)
function skillBlockingZoneFor(player) {
  for (const zone of zonesAt(player)) {
    if (!zone.blocksSkills) continue;
    if (!zone.blocksOwnerSkills && zone.ownerId === player.id) continue;
    return zone;
  }
  return undefined;
}

// zona que prende esse player no lugar (usada pra travar o dash)
function trappingZoneFor(player) {
  return zonesAt(player).find((zone) => zone.traps || zone.blocksDash);
}

function removeZonesOwnedBy(ownerId) {
  for (let i = activeZones.length - 1; i >= 0; i--) {
    if (activeZones[i].ownerId !== ownerId) continue;
    system.clearRun(activeZones[i].intervalId);
    if (activeZones[i].onRemove) {
      try {
        activeZones[i].onRemove();
      } catch (e) {}
    }
    activeZones.splice(i, 1);
  }
}

// margem de busca em volta da arena. o scan antigo era radius + 10, e quem
// saisse alem disso entre dois ticks de contencao (dash, knockback forte,
// pearl) simplesmente nunca mais era encontrado e escapava de vez.
const ZONE_SCAN_MARGIN = 48;

function pullBackIntoZone(zone, entity) {
  if (entity.id === zone.ownerId) return;

  const dx = entity.location.x - zone.center.x;
  const dz = entity.location.z - zone.center.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist <= zone.radius) {
    // entrou (ou continua) na area: passa a ser responsabilidade da arena
    zone.trapped.add(entity.id);
    return;
  }

  // quem nunca esteve dentro nao e puxado pra dentro - so quem tenta fugir
  if (!zone.trapped.has(entity.id)) return;

  const ratio = (zone.radius - 1) / (dist || 1);
  try {
    entity.teleport(
      {
        x: zone.center.x + dx * ratio,
        y: entity.location.y,
        z: zone.center.z + dz * ratio,
      },
      { keepVelocity: false }
    );
  } catch (e) {}
}

// empurra de volta pra dentro da area qualquer entidade que tente sair
function containZone(zone) {
  const nearby = zone.dimension.getEntities({
    location: zone.center,
    maxDistance: zone.radius + ZONE_SCAN_MARGIN,
  });

  const seen = new Set();
  for (const entity of nearby) {
    seen.add(entity.id);
    pullBackIntoZone(zone, entity);
  }

  // alguem preso sumiu do scan largo: fugiu longe demais ou morreu. so nesse
  // caso (raro) vale a varredura completa da dimensao.
  let escaped;
  for (const id of zone.trapped) {
    if (!seen.has(id)) (escaped ??= []).push(id);
  }
  if (!escaped) return;

  const all = zone.dimension.getEntities();
  const alive = new Set();
  for (const entity of all) {
    alive.add(entity.id);
    if (escaped.includes(entity.id)) pullBackIntoZone(zone, entity);
  }
  for (const id of escaped) {
    if (!alive.has(id)) zone.trapped.delete(id);
  }
}

function getByakuyaWeaponState(player) {
  return player.getDynamicProperty(DP.byakuyaWeapon) ?? "base";
}

function getStarkkForm(player) {
  return player.getDynamicProperty(DP.starkkForm) ?? "starkk";
}

// agachado + usar a arma atual do Starkk desperto troca de persona - o item de
// verdade so troca no proximo passo do loop de travamento (getActiveItemsForPlayer)
function toggleStarkkForm(player) {
  const next = getStarkkForm(player) === "lilynette" ? "starkk" : "lilynette";
  player.setDynamicProperty(DP.starkkForm, next);

  try {
    player.dimension.playSound("mob.endermen.portal", player.location, {
      volume: 1,
      pitch: next === "lilynette" ? 1.6 : 0.9,
    });
  } catch (e) {}

  if (next === "lilynette") {
    world.sendMessage(`§9${player.name} chamou a Lilynette pra frente!`);
    player.sendMessage("§9Você agora está controlando a Lilynette.");
  } else {
    player.sendMessage("§6Você voltou a ser Coyote Starkk.");
  }
}

// decide quais itens devem estar travados nos slots do player nesse momento
function getActiveItemsForPlayer(player, character) {
  // Aizen invisivel (Illusion's Mastery / Kanzen Saimin): a Kyōka da mao vira
  // a oculta, em qualquer forma
  if (
    (character.id === "aizen" && aizenIllusions.has(player.id)) ||
    (character.id === "aizen_hogyoku" && hogyokuKanzen.has(player.id))
  ) {
    const form = activeFormOf(player, character);
    return { ...(form?.items ?? character.items), 0: AIZEN.kyokaHidden };
  }
  const form = activeFormOf(player, character);
  if (form) {
    if (form.altForm && getStarkkForm(player) === "lilynette") {
      return form.altForm.items;
    }
    return form.items ?? character.items;
  }
  if (character.id === "tosen" && isTosenVisored(player)) {
    return TOSEN_VISORED.items;
  }
  if (character.superAttack) {
    const weaponState = getByakuyaWeaponState(player);
    if (weaponState === "senkei") {
      return { ...character.items, 0: character.superAttack.senkei?.weapon };
    }
    if (weaponState === "finisher") {
      return { ...character.items, 0: character.superAttack.senkei?.finisherWeapon };
    }
  }
  return character.items;
}

function activateCharacter(player, characterId) {
  const character = CHARACTERS[characterId];
  if (!character) return;

  player.setDynamicProperty(DP.character, characterId);
  player.setDynamicProperty(DP.awakened, false);
  player.setDynamicProperty(DP.byakuyaWeapon, "base");
  player.setDynamicProperty(DP.starkkForm, "starkk");
  if (characterId === "aaroniero") { clearAaronieroDevoured(player); player.setDynamicProperty("mv:aaroniero_selected", 0); player.setDynamicProperty(DP.aaronieroMaskEnd, 0); }
  if (characterId === "aizen_hogyoku") resetHogyoku(player);
  // o Kaidō Expert conta ataques so a partir de agora
  if (characterId === "unohana") unohanaAttackers.set(player.id, new Set());
  clearComboCounters(player);

  applyCharacterEffects(player, character.health, BASE_SPEED_AMPLIFIER);

  const inv = getInv(player);
  for (const slot in character.items) {
    inv.setItem(Number(slot), new ItemStack(character.items[slot], 1));
  }
  player.setDynamicProperty(DP.genericSkill,0);
  player.setDynamicProperty(DP.pressureActiveUntil,0);
  player.setDynamicProperty(DP.airStepActive,false);
  removeAirStepBlock(player);
  forceGiveLockedItem(inv,GENERIC_SKILL_SLOT,GENERIC_SKILL_ITEM);

  system.runTimeout(() => {
    healToMax(player, character.health);
  }, 2);

  world.sendMessage(
    `§e${player.name}§r agora está usando §6${character.name}§r!`
  );
  player.sendMessage(`§aVocê ativou: §6${character.name}`);
}

function deactivateCharacter(player) {
  soiClearNigeki(player.id);
  const character = getActiveCharacter(player);
  if (!character) return;
  if (character.id === "aizen" || character.id === "aizen_hogyoku") aizenCleanup(player.id);
  if (character.id === "aizen_hogyoku") resetHogyoku(player);
  if (character.id === "ichigo_dangai") dangaiCleanup(player, true);
  if (character.id === "yamamoto") yamamotoCleanup(player.id);
  if (character.id === "unohana") unohanaCleanup(player.id, true);
  if (character.id === "komamura") komamuraCleanup(player.id);

  if (isMasked(player)) {
    try {
      player.removeEffect("strength");
      player.removeEffect("resistance");
      const equip = player.getComponent("minecraft:equippable");
      equip?.setEquipment(EquipmentSlot.Head, undefined);
    } catch (e) {}
  }
  player.setDynamicProperty(DP.maskEnd, 0);

  const activeItems = getActiveItemsForPlayer(player, character);

  const inv = getInv(player);
  if(inv.getItem(GENERIC_SKILL_SLOT)?.typeId===GENERIC_SKILL_ITEM) inv.setItem(GENERIC_SKILL_SLOT,undefined);
  player.setDynamicProperty(DP.airStepActive,false);removeAirStepBlock(player);player.setDynamicProperty(DP.pressureActiveUntil,0);
  for (const slot in activeItems) {
    const item = inv.getItem(Number(slot));
    if (item && item.typeId === activeItems[slot]) {
      inv.setItem(Number(slot), undefined);
    }
  }

  if (character.id === "ulquiorra" || character.id === "hitsugaya") setUlquiorraFlight(player, false);
  clearFormExtras(player, character.awakening);
  player.removeEffect("health_boost");
  player.removeEffect("speed");
  if (character.id === "tosen") player.removeEffect("blindness");
  if (character.id === "tosen") {
    player.setDynamicProperty(DP.tosenVisored, false);
    resetTosenVisoredCharge(player);
    tosenOldHelmet.delete(player.id);
  }
  player.removeEffect("regeneration");
  player.setDynamicProperty(DP.healthScale, 1);
  player.setDynamicProperty(DP.markedEnd, 0);
  player.setDynamicProperty(DP.character, undefined);
  player.setDynamicProperty(DP.awakened, false);
  player.setDynamicProperty(DP.trueForm, false);
  player.setDynamicProperty(DP.awakening, 0);
  player.setDynamicProperty(DP.byakuyaWeapon, "base");
  player.setDynamicProperty(DP.starkkForm, "starkk");
  if (character.id === "aaroniero") { clearAaronieroDevoured(player); player.setDynamicProperty("mv:aaroniero_selected", 0); player.setDynamicProperty(DP.aaronieroMaskEnd, 0); }
  clearComboCounters(player);
  removeZonesOwnedBy(player.id);
  removeCursesBy(player.id);
  removeMutilationsBy(player.id);
  gabrielHosts.delete(player.id);
  player.setDynamicProperty(DP.blockEnd, 0);
  player.setDynamicProperty(DP.respiraEnd, 0);
  player.setDynamicProperty(DP.hierroEnd, 0);
  endIntocable(player);
  player.setDynamicProperty(DP.muerteArmed, false);
  player.setDynamicProperty(DP.mayuriParalysis, false);
  player.setDynamicProperty("mv:mayuri_poison_gabriel", false);
  blockingNow.delete(player.id);

  system.runTimeout(() => {
    const hp = player.getComponent("minecraft:health");
    if (hp) hp.setCurrentValue(Math.min(20, hp.effectiveMax));
  }, 2);

  player.sendMessage("§cPersonagem desativado. Vida normal restaurada.");
}

/* ---------------------------------------------------------
   Voo do Ulquiorra (somente enquanto uma forma desperta estiver ativa)
   --------------------------------------------------------- */

function setUlquiorraFlight(player, enabled) {
  try {
    const flightId = getActiveCharacter(player)?.id;
    if (flightId !== "ulquiorra" && flightId !== "hitsugaya") return;
    player.runCommand(`ability @s mayfly ${enabled ? "true" : "false"}`);
  } catch (e) {}
}

/* ---------------------------------------------------------
   Awakening (Tensa Zangetsu)
   --------------------------------------------------------- */

function activateAwakening(player, character) {
  const form = character.awakening;
  if (!form) return;

  // nem todo awakening muda vida, velocidade ou itens: o do Kenpachi mantem
  // os tres e entrega um burst de pressao espiritual + buff de dano
  const health = form.health ?? character.health;
  const items = form.items ?? character.items;

  player.setDynamicProperty(DP.awakened, true);
  // Toda ativacao entra pela PRIMEIRA fase. O medidor continua em 100% e
  // passa a drenar normalmente como qualquer outro Awakening. A Segunda Etapa
  // so pode ser ativada depois, quando o medidor chegar a 50%.
  player.setDynamicProperty(DP.trueForm, false);
  if (character.id === "ulquiorra") {
    player.setDynamicProperty(DP.awakening, 100);
  }
  // o Teatro de Títeres e uso unico por Resurreccion, entao o crédito volta aqui
  player.setDynamicProperty(DP.teatroUsed, false);
  applyCharacterEffects(
    player,
    health,
    form.speedAmplifier ?? BASE_SPEED_AMPLIFIER,
    "regenAmplifier" in form ? form.regenAmplifier : REGEN_AMPLIFIER,
    form.extraEffects
  );

  const inv = getInv(player);
  for (const slot in items) {
    inv.setItem(Number(slot), new ItemStack(items[slot], 1));
  }

  // a cura existe pra encher o teto novo de vida (caso do Bankai). Um awakening
  // que mantem o teto nao pode virar cura de graca - a menos que a forma peca
  // isso de proposito (healOnActivate), que e o caso das do Ichigo Vizard.
  if (form.healOnActivate || health > character.health) {
    system.runTimeout(() => healToMax(player, cutHealthFor(player, health)), 2);
  }

  world.sendMessage(`§d§l${player.name} despertou: ${form.name}!`);
  player.sendMessage(`§d§lAwakening ativado! §r§dVocê é agora ${form.name}.`);

  // o marcador da offhand e o que faz o modelo ficar gigante no cliente
  if (form.offhandMarker) setOffhandMarker(player, form.offhandMarker);
  // e o peitoral e o que troca a skin
  if (form.armorPiece && equipArmorPiece(player, form.armorPiece) && form.armorMessage) {
    player.sendMessage(form.armorMessage);
  }

  if (form.canFly) setUlquiorraFlight(player, true);

  switch (form.onActivate) {
    case "pressure":
      activateSpiritualPressure(player, form.pressure);
      break;
    case "battlecry":
      announceBattleCry(player, form);
      break;
    case "metamorphosis":
      world.sendMessage("§5§lAizen atingiu sua Metamorfose...");
      break;
  }
}

function revertAwakening(player, reason) {
  const character = getActiveCharacter(player);
  if (!character || !character.awakening) return;
  if (!isAwakened(player)) return;

  if (character.id === "shinji") shinji.endAwakening(player);

  if (isMasked(player)) {
    deactivateHollowMask(player);
  }

  const hpBefore = player.getComponent("minecraft:health");
  const previousHealth = hpBefore ? hpBefore.currentValue : character.health;

  if (character.id === "ulquiorra" || character.id === "hitsugaya") setUlquiorraFlight(player, false);
  player.setDynamicProperty(DP.awakened, false);
  player.setDynamicProperty(DP.trueForm, false);
  player.setDynamicProperty(DP.starkkForm, "starkk");
  clearFormExtras(player, character.awakening);
  applyCharacterEffects(player, character.health, BASE_SPEED_AMPLIFIER);

  const inv = getInv(player);
  for (const slot in character.items) {
    inv.setItem(Number(slot), new ItemStack(character.items[slot], 1));
  }

  // mantem a vida atual do player, so limita ao novo maximo (nao cura). O teto
  // vem do calculo da forma base porque o effectiveMax pode demorar um tick pra
  // acompanhar o health_boost novo e ainda reportar o da forma desperta.
  system.runTimeout(() => {
    const hp = player.getComponent("minecraft:health");
    if (hp) {
      hp.setCurrentValue(
        Math.min(previousHealth, realMaxHealthFor(character.health))
      );
    }
  }, 2);

  player.sendMessage(
    reason === "manual"
      ? "§7Você encerrou o Awakening. Voltando à forma base."
      : "§7O Awakening acabou. Voltando à forma base."
  );
}

function activateTrueAwakening(player, character) {
  const form = character.awakening?.trueForm;
  if (!form || !isAwakened(player) || isTrueForm(player)) return false;

  // A Segunda Etapa é liberada quando Ulquiorra chega a 1000 de vida ou menos.
  // O medidor de Awakening continua independente e segue drenando normalmente.
  // virtualHealth() respeita a escala de vida usada pelo addon.
  if (virtualHealth(player) > 1000 || virtualHealth(player) <= 0) return false;

  player.setDynamicProperty(DP.trueForm, true);

  const health = form.health ?? character.awakening.health ?? character.health;
  applyCharacterEffects(
    player,
    health,
    form.speedAmplifier ?? BASE_SPEED_AMPLIFIER,
    "regenAmplifier" in form ? form.regenAmplifier : REGEN_AMPLIFIER,
    form.extraEffects
  );

  const inv = getInv(player);
  for (const slot in form.items ?? {}) {
    inv.setItem(Number(slot), new ItemStack(form.items[slot], 1));
  }

  if (form.healOnActivate || health > character.awakening.health) {
    system.runTimeout(() => healToMax(player, cutHealthFor(player, health)), 2);
  }

  if (form.armorPiece) equipArmorPiece(player, form.armorPiece);
  if (form.canFly) setUlquiorraFlight(player, true);

  world.sendMessage(`§5§l${player.name} atingiu: ${form.name}!`);
  player.sendMessage("§5§lA Segunda Etapa foi despertada! §r§dO poder de Ulquiorra atingiu um novo nível.");
  try {
    player.dimension.playSound("mob.wither.death", player.location, { volume: 2, pitch: 0.45 });
  } catch (e) {}
  return true;
}

// devolve se REALMENTE despertou: agachar + m1 tambem e a tecla do bloqueio,
// entao quando o medidor nao estava cheio a tecla tem que sobrar pra guarda
function tryTriggerAwakening(player) {
  const character = getActiveCharacter(player);
  if (!character || !character.awakening) return false;
  if (isAwakened(player)) return false;
  if (getAwakening(player) < 100) return false;

  activateAwakening(player, character);
  return true;
}

/* ---------------------------------------------------------
   Mascara Hollow (Ichigo) - so pode ativar com <=50 de vida
   durante a Tensa Zangetsu
   --------------------------------------------------------- */

function activateHollowMask(player, character) {
  const mask = character.awakening.hollowMask;
  const now = system.currentTick;

  player.setDynamicProperty(DP.maskEnd, now + mask.durationTicks);

  try {
    const equip = player.getComponent("minecraft:equippable");
    equip?.setEquipment(EquipmentSlot.Head, new ItemStack("minecraft:carved_pumpkin", 1));
  } catch (e) {}

  player.addEffect("strength", mask.durationTicks, {
    amplifier: 1,
    showParticles: false,
  });
  player.addEffect("resistance", mask.durationTicks, {
    amplifier: 0,
    showParticles: false,
  });
  player.addEffect("regeneration", mask.bigRegenTicks, {
    amplifier: mask.bigRegenAmplifier,
    showParticles: false,
  });

  world.sendMessage(`§5§l${player.name} colocou a Máscara Hollow!`);
  player.dimension.playSound("mob.enderdragon.growl", player.location, {
    volume: 1.3,
    pitch: 0.7,
  });

  // depois do burst de regen 6, volta o regen 3 padrao do personagem
  system.runTimeout(() => {
    if (getActiveCharacter(player)) {
      try {
        player.addEffect("regeneration", 20000000, {
          amplifier: REGEN_AMPLIFIER,
          showParticles: false,
        });
      } catch (e) {}
    }
  }, mask.bigRegenTicks);

  system.runTimeout(() => {
    deactivateHollowMask(player);
  }, mask.durationTicks);
}

function deactivateHollowMask(player) {
  // de proposito NAO usa isMasked(): o runTimeout dispara exatamente no tick do
  // fim, e nesse tick isMasked() ja e false. Com o guard antigo a limpeza nunca
  // acontecia e a abobora ficava presa na cabeca do player pra sempre.
  const end = player.getDynamicProperty(DP.maskEnd);
  if (typeof end !== "number" || end <= 0) return;
  player.setDynamicProperty(DP.maskEnd, 0);

  try {
    const equip = player.getComponent("minecraft:equippable");
    equip?.setEquipment(EquipmentSlot.Head, undefined);
  } catch (e) {}

  try {
    player.removeEffect("strength");
    player.removeEffect("resistance");
  } catch (e) {}

  player.sendMessage("§7A Máscara Hollow se desfez.");
}

/* ---------------------------------------------------------
   Menu do seletor de personagens
   --------------------------------------------------------- */

function getRaceIndex(player) {
  const stored = player.getDynamicProperty(DP.race);
  if (typeof stored !== "number" || stored < 0 || stored >= RACES.length) return 0;
  return stored;
}

function cycleRace(player) {
  const next = (getRaceIndex(player) + 1) % RACES.length;
  player.setDynamicProperty(DP.race, next);

  const race = RACES[next];
  const count = Object.values(CHARACTER_RACE_TIER).filter((data) => data.race === race.id).length;
  player.sendMessage(
    `§6Raça: §e${race.name} §7(${count} personagem${count === 1 ? "" : "s"})`
  );
  player.onScreenDisplay.setTitle("", {
    subtitle: `§6${race.name}`,
    fadeInDuration: 0,
    fadeOutDuration: 5,
    staySeconds: 10,
  });
  player.dimension.playSound("random.orb", player.location, {
    volume: 0.7,
    pitch: 1.4,
  });
}

function openTierMenu(player) {
  const active = getActiveCharacter(player);
  const race = RACES[getRaceIndex(player)];

  const form = new ActionFormData()
    .title("Bleach battlegrounds")
    .body(
      `§6Raça: §e${race.name}§r\n§7(agache + use o seletor para trocar de raça)\n\n` +
        (active
          ? `Personagem atual: §6${active.name}§r\n\nDesative antes de escolher outro.`
          : "Escolha um tier:")
    );

  for (const tier of TIERS) {
    const count = Object.values(CHARACTER_RACE_TIER).filter(
      (data) => data.race === race.id && data.tier === tier.id
    ).length;
    form.button(`${tier.name}\n§7${tier.subtitle} §8(${count})`);
  }

  if (active) form.button("§cDesativar personagem");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;

    if (active && res.selection === TIERS.length) {
      deactivateCharacter(player);
      return;
    }

    const tier = TIERS[res.selection];
    if (!tier) return;

    if (active) {
      player.sendMessage(
        "§cVocê já tem um personagem ativado! Desative primeiro."
      );
      return;
    }

    openCharacterTierMenu(player, race.id, tier.id);
  });
}

function openCharacterTierMenu(player, raceId, tierId) {
  const race = RACES.find((r) => r.id === raceId);
  const tier = TIERS.find((t) => t.id === tierId);
  if (!race || !tier) return;

  const active = getActiveCharacter(player);
  const ids = Object.entries(CHARACTER_RACE_TIER)
    .filter(([, data]) => data.race === raceId && data.tier === tierId)
    .map(([id]) => id)
    .filter((id) => CHARACTERS[id]);

  const form = new ActionFormData()
    .title(`${race.name} — ${tier.name}`)
    .body(
      `§6${race.name} §7• §e${tier.name}§r\n§7${tier.subtitle}\n\n` +
        (ids.length
          ? "Escolha seu personagem:"
          : "§8Nenhum personagem disponível neste tier.")
    );

  for (const id of ids) form.button(CHARACTERS[id].name);
  form.button("§7Voltar aos tiers");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    if (res.selection === ids.length) {
      openTierMenu(player);
      return;
    }

    const chosenId = ids[res.selection];
    if (!chosenId) return;

    if (active) {
      player.sendMessage(
        "§cVocê já tem um personagem ativado! Desative primeiro."
      );
      return;
    }

    activateCharacter(player, chosenId);
  });
}

/* ---------------------------------------------------------
   Join / spawn: dar o seletor e restaurar personagem ativo
   --------------------------------------------------------- */

world.afterEvents.playerSpawn.subscribe((ev) => {
  const { player, initialSpawn } = ev;
  shinji.reset(player);

  if (initialSpawn) {
    player.runCommand("hud @s hide health");
    // saiu do jogo invisivel na Illusion's Mastery do Aizen: o nome volta
    try {
      if (player.nameTag === "") player.nameTag = player.name;
    } catch (e) {}
    // o contador de ticks reinicia com o mundo, entao todo cooldown/deadline
    // gravado numa sessao anterior tem que morrer aqui
    clearSessionTimers(player);
    // saiu do mundo paralisado: o pulo volta
    jumpLockUntil.delete(player.id);
    try {
      player.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, true);
    } catch (e) {}
    const inv = getInv(player);
    forceGiveLockedItem(inv, SELECTOR_SLOT, SELECTOR_ITEM);
  } else {
    soiClearNigeki(player.id);
    aizenCleanup(player.id);
    if (getActiveCharacter(player)?.id === "aizen_hogyoku") resetHogyoku(player);
    dangaiCleanup(player, false); // o Mugetsu continua contando depois da morte
    yamamotoCleanup(player.id);
    burns.delete(player.id);
    unohanaCleanup(player.id, false); // quem atacou antes de morrer continua marcado
    komamuraCleanup(player.id);
    unohanaHeals.delete(player.id);
    clearDots(player.id);
    ukitakeAbsorb.delete(player.id);
    player.setDynamicProperty(UKITAKE_STORED, 0);
    // respawn depois de morrer: reaplica personagem se tinha um ativo
    // (awakening eh cancelado na morte, volta pra forma base)
    if (isAwakened(player)) {
      if (["ulquiorra", "hitsugaya"].includes(getActiveCharacter(player)?.id)) {
        setUlquiorraFlight(player, false);
      }
      player.setDynamicProperty(DP.awakened, false);
      player.setDynamicProperty(DP.trueForm, false);
      player.setDynamicProperty(DP.awakening, 0);
    }
    player.setDynamicProperty(DP.maskEnd, 0);
    player.setDynamicProperty(DP.hierroEnd, 0);
    player.setDynamicProperty(DP.intocableEnd, 0);
    player.setDynamicProperty(DP.mayuriParalysis, false);
    player.setDynamicProperty("mv:mayuri_poison_gabriel", false);
    if (getActiveCharacter(player)?.id === "aaroniero") { clearAaronieroDevoured(player); player.setDynamicProperty("mv:aaroniero_selected", 0); player.setDynamicProperty(DP.aaronieroMaskEnd, 0); }
    const character = getActiveCharacter(player);
    if (character) {
      forceGiveLockedItem(getInv(player),GENERIC_SKILL_SLOT,GENERIC_SKILL_ITEM);
      player.setDynamicProperty(DP.genericSkill,0);
      applyCharacterEffects(player, character.health, BASE_SPEED_AMPLIFIER);
      system.runTimeout(() => healToMax(player, character.health), 2);
    }
  }
});

function openCheatOptionsMenu(player) {
  const pressure = isSpiritualPressureEnabled(player);
  const infiniteAwk = isInfiniteAwakening(player);
  const form = new ActionFormData()
    .title("Opções / Cheats")
    .body(
      "§6Configurações de combate\\n\\n" +
      `Pressão Espiritual: ${pressure ? "§aATIVADA" : "§cDESATIVADA"}\\n` +
      `Awk infinito: ${infiniteAwk ? "§aATIVADO" : "§cDESATIVADO"}`
    )
    .button(pressure ? "§cDesligar Pressão Espiritual" : "§aLigar Pressão Espiritual")
    .button("§eDar Awakening (100%)")
    .button(infiniteAwk ? "§cDesligar Awk Infinito" : "§aLigar Awk Infinito")
    .button("§bZerar cooldowns")
    .button("§7Fechar");

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    if (res.selection === 0) {
      setSpiritualPressureEnabled(player, !pressure);
      openCheatOptionsMenu(player);
    } else if (res.selection === 1) {
      const awkCharacter = getActiveCharacter(player);
      if (awkCharacter?.id === "aizen_hogyoku") {
        player.setDynamicProperty(DP.evolution, 100);
        player.sendMessage("§aEvolution preenchida em 100%!");
      } else if (!awkCharacter?.awakening && !awkCharacter?.superAttack) {
        player.sendMessage("§cVocê precisa estar usando um personagem com Awakening ou Super.");
      } else {
        player.setDynamicProperty(DP.awakening, 100);
        player.sendMessage("§aAwakening preenchido em 100%!");
      }
      openCheatOptionsMenu(player);
    } else if (res.selection === 2) {
      player.setDynamicProperty(DP.infiniteAwakening, !infiniteAwk);
      openCheatOptionsMenu(player);
    } else if (res.selection === 3) {
      for (const itemId in SKILL_COOLDOWN_TICKS) player.setDynamicProperty(cdKeyForSkill(itemId), undefined);
      player.setDynamicProperty(DP.dashCd, undefined);
      player.setDynamicProperty(DP.blockCd, undefined);
      player.setDynamicProperty(DP.noDash, undefined); // Ice Age do Hitsugaya
      cdFrozen.delete(player.id); // cooldown congelado (Hitsugaya)
      player.sendMessage("§bTodos os cooldowns foram zerados!");
      openCheatOptionsMenu(player);
    }
  });
}

system.runInterval(()=>{
  const players=world.getPlayers();
  for(const source of players){const until=source.getDynamicProperty(DP.pressureActiveUntil);if(!getActiveCharacter(source)||typeof until!=="number"||until<=system.currentTick)continue;const tier=tierOfPlayer(source),radius=SPIRITUAL_PRESSURE.radii[tier];if(!radius)continue;for(const target of players){if(target.id===source.id||target.dimension.id!==source.dimension.id||!getActiveCharacter(target)||isPressureImmune(target))continue;const diff=tier-tierOfPlayer(target);if(diff<2)continue;const dx=source.location.x-target.location.x,dy=source.location.y-target.location.y,dz=source.location.z-target.location.z;if(dx*dx+dy*dy+dz*dz>radius*radius)continue;if(diff>=5){try{target.kill();}catch(e){}continue;}const cfg=SPIRITUAL_PRESSURE.effects[diff];if(!cfg)continue;try{target.addEffect("slowness",SPIRITUAL_PRESSURE.intervalTicks+10,{amplifier:cfg.amplifier,showParticles:false});dealDamage(target,cfg.damage,source);}catch(e){}}}
},SPIRITUAL_PRESSURE.intervalTicks);
const genericSneakState=new Map();
system.runInterval(()=>{for(const player of world.getPlayers()){const held=getInv(player).getItem(GENERIC_SKILL_SLOT),holding=held?.typeId===GENERIC_SKILL_ITEM,sneak=player.isSneaking,prev=genericSneakState.get(player.id)===true;if(holding&&sneak&&!prev&&getActiveCharacter(player))cycleGenericSkill(player);genericSneakState.set(player.id,sneak);if(player.getDynamicProperty(DP.airStepActive)===true){if(tierOfPlayer(player)<5||!getActiveCharacter(player)){player.setDynamicProperty(DP.airStepActive,false);removeAirStepBlock(player);continue;}try{const v=player.getVelocity();if(sneak)player.teleport({x:player.location.x,y:player.location.y-0.12,z:player.location.z},{keepVelocity:false});else if(v.y>0.08)player.teleport({x:player.location.x,y:player.location.y+0.12,z:player.location.z},{keepVelocity:false});}catch(e){}setAirStepBlock(player);}if(holding&&genericSkillIndex(player)===2&&sneak&&getActiveCharacter(player))player.setDynamicProperty("mv:reiatsu_jump_charge",Math.min(120,(Number(player.getDynamicProperty("mv:reiatsu_jump_charge"))||0)+2));}},2);

/* ---------------------------------------------------------
   Uso de itens
   --------------------------------------------------------- */

world.afterEvents.itemUse.subscribe((ev) => {
  const { source: player, itemStack } = ev;
  if (!player || player.typeId !== "minecraft:player") return;

  if (itemStack.typeId === SELECTOR_ITEM) {
    if (player.isSneaking) {
      cycleRace(player);
    } else {
      openTierMenu(player);
    }
    return;
  }

  if (itemStack.typeId === CHEAT_OPTIONS_ITEM) {
    openCheatOptionsMenu(player);
    return;
  }

  // o Aizen que sobreviveu ao Getsuga Tenshou Final nao usa mais nada
  if (isMugetsuWeakened(player)) {
    player.sendMessage("§8O Getsuga Tenshou Final te deixou sem forças pra usar qualquer skill.");
    return;
  }

  if (itemStack.typeId === GENERIC_SKILL_ITEM) {
    handleGenericSkillUse(player);
    return;
  }

  const character = getActiveCharacter(player);
  if (!character) return;

  // Aizen: agachar pra usar item (guarda, Kurohitsugi) nao e um "toque" do
  // agachar duplo que teleporta pro bloco marcado
  if (character.id === "aizen" && player.isSneaking) aizenSneakSpent(player);

  // Ulquiorra: a Segunda Etapa agora depende da VIDA REAL/virtual, não do
  // percentual do medidor. Durante a Murciélago, com 1000 de vida ou menos,
  // agachar + usar a M1 da própria forma (m1_garras) transforma.
  if (
    character.id === "ulquiorra" &&
    character.awakening?.trueForm &&
    isAwakened(player) &&
    !isTrueForm(player) &&
    player.isSneaking &&
    itemStack.typeId === character.awakening.trueForm.triggerItem
  ) {
    if (activateTrueAwakening(player, character)) return;
  }

  // agachado + usar a m1 do Shinji com awakening 100% = Sakanade
  if (
    character.id === "shinji" &&
    character.awakening &&
    itemStack.typeId === character.awakening.triggerItem &&
    player.isSneaking &&
    !isAwakened(player)
  ) {
    if (getAwakening(player) >= 100 && shinji.awaken(player)) return;
  }

  // agachado + usar a m1 com awakening 100% = desperta o Awakening
  if (
    character.awakening &&
    itemStack.typeId === character.awakening.triggerItem &&
    player.isSneaking &&
    !isAwakened(player)
  ) {
    if (tryTriggerAwakening(player)) return;
  }

  // agachado + usar a zangetsu bankai (tensa) com <=50 de vida = Mascara Hollow
  if (
    character.awakening?.hollowMask &&
    itemStack.typeId === character.awakening.hollowMask.triggerItem &&
    player.isSneaking &&
    isAwakened(player) &&
    !isMasked(player)
  ) {
    if (virtualHealth(player) <= character.awakening.hollowMask.healthThreshold) {
      activateHollowMask(player, character);
      return;
    }
    // vida alta demais pra mascara: a tecla vira bloqueio em vez de nao fazer nada
  }

  // agachado (5s) + usar a Suzumushi base com a mascara carregada = Visored
  if (
    character.id === "tosen" &&
    itemStack.typeId === "tosen:m1_suzumushi" &&
    player.isSneaking &&
    tosenVisoredReady.has(player.id) &&
    !isTosenVisored(player)
  ) {
    resetTosenVisoredCharge(player);
    activateTosenVisored(player, character);
    return;
  }

  // agachado + usar a Suzumushi do Visored = tira a mascara e volta ao normal
  if (
    character.id === "tosen" &&
    itemStack.typeId === "tosen:m1_visored" &&
    player.isSneaking &&
    isTosenVisored(player)
  ) {
    deactivateTosenVisored(player, "manual");
    return;
  }

  // agachado + usar a senbonzakura base com awakening 100% = Kageyoshi ou Senkei
  if (
    character.superAttack &&
    itemStack.typeId === character.superAttack.triggerItem &&
    player.isSneaking &&
    getByakuyaWeaponState(player) === "base"
  ) {
    // pra quem nao tem arma alternativa o estado e sempre "base"
    if (tryTriggerSuperAttack(player, character)) return;
  }

  // agachado + usar a senbonzakura do senkei = desativa a area e puxa a espada final
  if (
    character.superAttack &&
    itemStack.typeId === character.superAttack.senkei?.weapon &&
    player.isSneaking &&
    getByakuyaWeaponState(player) === "senkei"
  ) {
    triggerSenkeiDeactivation(player, character);
    return;
  }

  // agachado + usar o m1 da forma gigante alterna a camera pro alto da cabeca
  if (
    character.awakening?.tallView &&
    isAwakened(player) &&
    player.isSneaking &&
    itemStack.typeId === character.awakening.tallView.triggerItem
  ) {
    toggleTallView(player, character.awakening.tallView);
    return;
  }

  // agachado + usar a arma m1 atual (Cuchillos ou disparo da Lilynette) com a
  // Resurrección ativa alterna entre as duas personas
  if (
    character.awakening?.altForm &&
    isAwakened(player) &&
    player.isSneaking &&
    (itemStack.typeId === character.awakening.altForm.starkkWeapon ||
      itemStack.typeId === character.awakening.altForm.lilynetteWeapon)
  ) {
    toggleStarkkForm(player);
    return;
  }

  // agachar com o m1 = bloquear. Vale pra todo personagem, e vem DEPOIS das
  // outras regras de agachar+m1: awakening, mascara, super ataque, camera alta
  // e troca de persona ganham do bloqueio quando disputam a mesma tecla.
  if (player.isSneaking && MELEE_WEAPONS[itemStack.typeId]) {
    toggleBlock(player);
    return;
  }

  // preso no Teatro de Títeres: ninguem usa skill, nem quem abriu o Teatro
  if (
    itemStack.typeId in SKILL_COOLDOWN_TICKS &&
    isFrozen(player) &&
    itemStack.typeId !== "mayuri:regenerate"
  ) {
    player.sendMessage(
      ginParalyzed.has(player.id)
        ? "§7Você está paralisado e não consegue usar skills."
        : "§7O Teatro de Títeres trava as skills enquanto está aberto."
    );
    return;
  }
  if (isMayuriParalyzed(player) && itemStack.typeId !== "mayuri:regenerate") return;

  // enquanto preso num senkei, ninguem pode usar skill - so a m1
  if (itemStack.typeId in SKILL_COOLDOWN_TICKS) {
    const blocking = skillBlockingZoneFor(player);
    if (blocking) {
      player.sendMessage(blocking.blockMessage);
      return;
    }
  }

  switch (itemStack.typeId) {
    case "shinji:triple_slash":
    case "shinji:sakanas_cut":
    case "shinji:hollow_mask":
    case "shinji:cero":
      shinji.cast(player, itemStack.typeId);
      break;
    case "ichigo:getsuga_slam":
      castGetsugaSlam(player);
      break;
    case "ichigo:getsuga_slash":
      castGetsugaSlash(player);
      break;
    case "ichigo:getsuga_run":
      castGetsugaRun(player);
      break;
    case "ichigo:getsuga_tenshou":
      castGetsugaTenshou(player);
      break;
    case "ichigo:getsuga_barrage":
      castGetsugaBarrage(player);
      break;
    case "ichigo:getsuga_tenshou_bankai":
      castGetsugaTenshouBankai(player);
      break;
    case "ichigo:double_getsuga":
      castDoubleGetsuga(player);
      break;
    case "ichigo:nuke_tenshou":
      castNukeTenshou(player);
      break;
    case "byakuya:tripleshot":
      castByakuyaTripleshot(player);
      break;
    case "byakuya:disperse":
      castByakuyaDisperse(player);
      break;
    case "byakuya:bloodshed":
      castByakuyaBloodshed(player);
      break;
    case "byakuya:sakura_distraction":
      castSakuraDistraction(player);
      break;
    case "kenpachi:flash_slash":
      castFlashSlash(player);
      break;
    case "kenpachi:stomp":
      castKenpachiStomp(player);
      break;
    case "kenpachi:hunt":
      castKenpachiHunt(player);
      break;
    case "kenpachi:hells_cut":
      castHellsCut(player);
      break;
    case "mayuri:poison_slash":
      castPoisonSlash(player);
      break;
    case "mayuri:toxic_fog":
      castToxicFog(player);
      break;
    case "mayuri:regenerate":
      castMayuriRegenerate(player);
      break;
    case "mayuri:envenenar":
      castMayuriEnvenenar(player);
      break;
    case "grimmjow:desgarra":
      castDesgarra(player);
      break;
    case "grimmjow:raza":
      castRaza(player);
      break;
    case "grimmjow:gran_rey_cero":
      castGranReyCero(player);
      break;
    case "grimmjow:destruir":
      castDestruir(player);
      break;
    case "grimmjow:rugido":
      castRugido(player);
      break;
    case "grimmjow:arrancar_corazon":
      castArrancarCorazon(player);
      break;
    case "grimmjow:disparo":
      castDisparo(player);
      break;
    case "aaroniero:cero_metalico":
      castAaronieroCeroMetalico(player);
      break;
    case "aaroniero:nejibana":
      castAaronieroNejibana(player);
      break;
    case "aaroniero:devorar":
      castAaronieroDevorar(player);
      break;
    case "aaroniero:mascara_kaien":
      castAaronieroMascara(player);
      break;
    case "aaroniero:tentaculos":
      castAaronieroTentaculos(player);
      break;
    case "aaroniero:tridente_kaien":
      castAaronieroTridente(player);
      break;
    case "aaroniero:cero_metalico_gloton":
      castAaronieroCeroGloton(player);
      break;
    case "aaroniero:banquete":
      castAaronieroBanquete(player);
      break;
    case "aaroniero:glotoneria":
      castAaronieroGlotoneria(player);
      break;
    case "ulquiorra:gran_rey_cero":
      castGranReyCero(player, "ulquiorra:gran_rey_cero");
      break;
    case "ulquiorra:cero_bala":
      castCeroBala(player);
      break;
    case "ulquiorra:sonido":
      castSonido(player);
      break;
    case "ulquiorra:pesquisa":
      castPesquisa(player);
      break;
    case "ulquiorra:nihil":
      castNihil(player);
      break;
    case "ulquiorra:enigma":
      activateEnigma(player);
      break;
    case "ulquiorra:cero_oscuras":
      castCeroOscuras(player);
      break;
    case "ulquiorra:cero_oscuras_triplo":
      castCeroOscurasTriplo(player);
      break;
    case "ulquiorra:lanza":
      castLanza(player);
      break;
    case "starkk:slash_barrage":
      castSlashBarrage(player);
      break;
    case "starkk:sideway_cuts":
      castSidewayCuts(player);
      break;
    case "starkk:crescent_canines":
      castCrescentCanines(player);
      break;
    case "starkk:kamarada":
      castKamarada(player);
      break;
    case "starkk:lilynette_shot":
      castLilynetteShot(player);
      break;
    case "starkk:rifle":
      castRifle(player);
      break;
    case "starkk:escopeta":
      castEscopeta(player);
      break;
    case "starkk:cero_metralleta":
      castCeroMetralleta(player);
      break;
    case "yammy:punches_barrage":
      castPunchesBarrage(player);
      break;
    case "yammy:face_hold":
      castFaceHold(player);
      break;
    case "yammy:wraths_smash":
      castWrathsSmash(player);
      break;
    case "yammy:wraths_punch":
      castWrathsPunch(player);
      break;
    case "yammy:quebramundos":
      castQuebramundos(player);
      break;
    case "yammy:cero_barrage":
      castCeroBarrage(player);
      break;
    case "yammy:rugido_diablo":
      castRugidoDiablo(player);
      break;
    case "harribel:tiburon_slash":
      castTiburonSlash(player);
      break;
    case "harribel:shark_issues":
      castSharkIssues(player);
      break;
    case "harribel:water_prison":
      castWaterPrison(player);
      break;
    case "harribel:aquas_dash":
      castAquasDash(player);
      break;
    case "harribel:tsunami":
      castTsunami(player);
      break;
    case "harribel:vortice":
      castVortice(player);
      break;
    case "harribel:maldita_agua":
      castMalditaAgua(player);
      break;
    case "barragan:arrogante_slash":
      castArroganteSlash(player);
      break;
    case "barragan:el_rei_oco":
      castElReiOco(player);
      break;
    case "barragan:royal_cleave":
      castRoyalCleave(player);
      break;
    case "barragan:withers_slashes":
      castWithersSlashes(player);
      break;
    case "barragan:ruir_del_rey":
      castRuirDelRey(player);
      break;
    case "barragan:respira":
      castRespira(player);
      break;
    case "barragan:el_maldito":
      castElMaldito(player);
      break;
    case "barragan:la_muerte":
      castLaMuerte(player);
      break;
    case "szayel:rush_and_pierce":
      castRushAndPierce(player);
      break;
    case "szayel:ascendent_cut":
      castAscendentCut(player);
      break;
    case "szayel:carbon_copy":
      castCarbonCopy(player);
      break;
    case "szayel:learn_and_adapt":
      castLearnAndAdapt(player);
      break;
    case "szayel:teatro_de_titeres":
      castTeatroDeTiteres(player);
      break;
    case "szayel:posse":
      castPosse(player);
      break;
    case "szayel:gabriel":
      castGabriel(player);
      break;
    case "vizard:dash_n_slash":
      castDashNSlash(player);
      break;
    case "vizard:getsuga_barrage":
      castVizardBarrage(player);
      break;
    case "vizard:descent_tensho":
      castDescentTensho(player);
      break;
    case "vizard:super_nuke":
      castSuperNuke(player);
      break;
    case "vizard:whites_showdown":
      castWhitesShowdown(player);
      break;
    case "vizard:bullet_hell":
      castBulletHell(player);
      break;
    case "vizard:everything_but_the_rain":
      castEverythingButTheRain(player);
      break;
    case "vizard:grito_del_diablo":
      castGritoDelDiablo(player);
      break;
    case "nnoitra:duro_slash":
      castDuroSlash(player);
      break;
    case "nnoitra:spinning_blade":
      castSpinningBlade(player);
      break;
    case "nnoitra:beyblade":
      castBeyblade(player);
      break;
    case "nnoitra:hierro":
      castHierro(player);
      break;
    case "nnoitra:muerte_multiple":
      castMuerteMultiple(player);
      break;
    case "nnoitra:avance_fatal":
      castAvanceFatal(player);
      break;
    case "nnoitra:meteorito_de_hierro":
      castMeteoritoDeHierro(player);
      break;
    case "nnoitra:declaracion_del_intocable":
      castDeclaracionDelIntocable(player);
      break;
    case "gin:extended_blade":
      castExtendedBlade(player);
      break;
    case "gin:spiral":
      castSpiral(player);
      break;
    case "gin:pursuing_blade":
      castPursuingBlade(player);
      break;
    case "gin:piercing_shinso":
      castPiercingShinso(player);
      break;
    case "hitsugaya:ryusenka":
      castRyusenka(player);
      break;
    case "hitsugaya:sennen_hyoro":
      castSennenHyoro(player);
      break;
    case "hitsugaya:guncho_tsurara":
      castGunchoTsurara(player);
      break;
    case "hitsugaya:tenso_jurin":
      castTensoJurin(player);
      break;
    case "hitsugaya:dragons_breath":
      castDragonsBreath(player);
      break;
    case "hitsugaya:ice_age":
      castIceAge(player);
      break;
    case "hitsugaya:ice_barrier":
      castIceBarrier(player);
      break;
    case "hitsugaya:ice_explosion":
      castIceExplosion(player);
      break;
    case "shunsui:kageoni":
      castKageoni(player);
      break;
    case "shunsui:takaoni":
      castTakaoni(player);
      break;
    case "shunsui:irooni":
      castIrooni(player);
      break;
    case "shunsui:jokenpo":
      castJokenpo(player);
      break;
    case "soifon:shunpo":
      castShunpo(player);
      break;
    case "soifon:stealthy":
      castStealthy(player);
      break;
    case "soifon:shunko":
      castShunko(player);
      break;
    case "soifon:nigeki_kessatsu":
      castNigekiKessatsu(player);
      break;
    case "rukia:white_moon":
      castWhiteMoon(player);
      break;
    case "rukia:white_wave":
      castWhiteWave(player);
      break;
    case "rukia:white_sword":
      castWhiteSword(player);
      break;
    case "rukia:juhaku":
      castJuhaku(player);
      break;
    case "ukitake:throw_n_pull":
      castThrowPull(player);
      break;
    case "ukitake:double_slam":
      castDoubleSlam(player);
      break;
    case "ukitake:ying_yang":
      castYingYang(player);
      break;
    case "ukitake:stagnation":
      castStagnation(player);
      break;
    case "ukitake:absorb":
      castAbsorb(player);
      break;
    case "tosen:nake":
      castNake(player);
      break;
    case "tosen:benihiko":
      castBenihiko(player);
      break;
    case "tosen:hado_88":
      castHado88(player);
      break;
    case "tosen:silent_cut":
      castSilentCut(player);
      break;
    case "tosen:palacio_de_las_espadas":
      castPalacioDeLasEspadas(player);
      break;
    case "tosen:ecolocalizacion":
      castEcolocalizacion(player);
      break;
    case "tosen:cero":
      castTosenCero(player);
      break;
    case "tosen:los_nueve_aspectos":
      castLosNueveAspectos(player);
      break;
    case "aizen:illusions_mastery":
      castIllusionsMastery(player);
      break;
    case "aizen:betrayal_of_the_illusioner":
      castBetrayal(player);
      break;
    case "aizen:bakudo_61":
      castBakudo61(player);
      break;
    case "aizen:fools_trick":
      castFoolsTrick(player);
      break;
    case "aizen:illusions":
      if (player.isSneaking) openIllusionsMenu(player);
      else castSelectedIllusion(player);
      break;
    case "aizen:kurohitsugi_encantado":
      castKurohitsugiEncantado(player);
      break;
    case "aizen:fragor":
      castFragor(player);
      break;
    case "aizen:ultra_fragor":
      castUltraFragor(player);
      break;
    case "aizen:fragor_barrage":
      castFragorBarrage(player);
      break;
    case "dangai:getsuga_tenshou":
      castDangaiGetsuga(player);
      break;
    case "dangai:omnidirectional_getsuga":
      castOmnidirectionalGetsuga(player);
      break;
    case "dangai:arrogants_counter":
      castArrogantsCounter(player);
      break;
    case "dangai:lets_fight_somewhere_else":
      castFightSomewhereElse(player);
      break;
    case "yamamoto:ennetsu_jigoku":
      castEnnetsuJigoku(player);
      break;
    case "yamamoto:itto_kaso":
      castIttoKaso(player);
      break;
    case "yamamoto:shunshin":
      castShunshin(player);
      break;
    case "yamamoto:hells_pierce":
      castHellsPierce(player);
      break;
    case "yamamoto:minami":
      castMinami(player);
      break;
    case "yamamoto:nishi":
      castNishi(player);
      break;
    case "yamamoto:higashi":
      castHigashi(player);
      break;
    case "yamamoto:kita":
      castKita(player);
      break;
    case "unohana:hados":
    case "unohana:bakudos":
    case "unohana:kaidos":
      if (player.isSneaking) openSpellBook(player, itemStack.typeId);
      else castFromBook(player, itemStack.typeId);
      break;
    case "komamura:myoo_barrage":
      castMyooBarrage(player);
      break;
    case "komamura:destructive_slash":
      castDestructiveSlash(player);
      break;
    case "komamura:giants_shield":
      castGiantsShield(player);
      break;
    case "komamura:ora_ora_ora":
      castOraOraOra(player);
      break;
    case "komamura:titanic_slash":
      castTitanicSlash(player);
      break;
    case "komamura:stomp":
      castMyooStomp(player);
      break;
    case "komamura:punch":
      castMyooPunch(player);
      break;
    case "komamura:susanoo_cut":
      castSusanooCut(player);
      break;
  }
});

/* ---------------------------------------------------------
   Skills do Ichigo
   --------------------------------------------------------- */

function tryUseSkill(player, itemId, overrideDuration) {
  const now = system.currentTick;
  const key = cdKeyForSkill(itemId);
  let duration = SKILL_COOLDOWN_TICKS[itemId];

  const character = getActiveCharacter(player);
  if (character?.id === "ulquiorra" && isTrueForm(player) && itemId === "ulquiorra:enigma") {
    duration = Math.floor(duration / 2);
  }
  const mask = character?.awakening?.hollowMask;
  if (mask && isMasked(player) && mask.cooldownHalvedItems.includes(itemId)) {
    duration = Math.floor(duration / 2);
  }

  if (onCooldown(player, key, duration, now)) {
    const last = tickOf(player, key) ?? now;
    const remaining = Math.ceil((duration - (now - last)) / 20);
    player.onScreenDisplay.setTitle("", {
      subtitle: `§cRecarregando... §7(${remaining}s)`,
      fadeInDuration: 0,
      fadeOutDuration: 5,
      staySeconds: 10,
    });
    return false;
  }
  setCooldown(player, key, now);
  // cooldown menor que o da tabela (Hadō #73 sem encantamento): adianta o carimbo
  if (overrideDuration !== undefined && overrideDuration < duration) {
    setCooldown(player, key, now - (duration - overrideDuration));
    duration = overrideDuration;
  }
  if (!isAwakened(player)) {
    addAwakening(player, 5);
  }

  const skillName = SKILL_NAMES[itemId] ?? itemId;
  const notifyReady = () => {
    try {
      // cooldown congelado (Hitsugaya): espera o que falta antes de avisar
      if (onCooldown(player, key, duration, system.currentTick)) {
        const last = tickOf(player, key) ?? system.currentTick;
        system.runTimeout(notifyReady, Math.max(1, duration - (system.currentTick - last)));
        return;
      }
      player.sendMessage(`§a${skillName} §frecarregou e já pode ser usada de novo!`);
    } catch (e) {
      // player pode ter saido do mundo, ignora
    }
  };
  system.runTimeout(notifyReady, duration);

  return true;
}

function forwardDirection(player) {
  const v = player.getViewDirection();
  const len = Math.sqrt(v.x * v.x + v.z * v.z) || 1;
  return { x: v.x / len, z: v.z / len };
}

function damageNearbyEntities(player, center, radius, damage, excludeSelf = true) {
  const dim = player.dimension;
  const entities = dim.getEntities({
    location: center,
    maxDistance: radius,
  });
  const finalDamage = damage * dmgMultiplier(player);
  for (const entity of entities) {
    if (excludeSelf && entity.id === player.id) continue;
    if (!entity.getComponent("minecraft:health")) continue;
    dealDamage(entity, finalDamage, player);
  }
}

function castGetsugaSlam(player) {
  if (!tryUseSkill(player, "ichigo:getsuga_slam")) return;
  const dim = player.dimension;
  const loc = player.location;

  // explosao de reiatsu azul no centro + anel de cortes se espalhando pra fora
  try {
    dim.spawnParticle("ichigo:reiatsu", { x: loc.x, y: loc.y + 0.3, z: loc.z });
  } catch (e) {}
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const r = SLAM_RADIUS * 0.55;
    try {
      dim.spawnParticle("ichigo:getsuga", {
        x: loc.x + Math.cos(angle) * r,
        y: loc.y + 0.3 + Math.random() * 0.6,
        z: loc.z + Math.sin(angle) * r,
      });
      if (i % 2 === 0) {
        dim.spawnParticle("ichigo:reiatsu", {
          x: loc.x + Math.cos(angle) * r * 0.5,
          y: loc.y + 0.3,
          z: loc.z + Math.sin(angle) * r * 0.5,
        });
      }
    } catch (e) {}
  }
  dim.playSound("mob.wither.shoot", loc, { volume: 1.5, pitch: 0.6 });
  world.sendMessage(`§b${player.name} §7usou §6Getsuga Slam§7!`);

  // area de dano aumentada
  damageNearbyEntities(player, loc, SLAM_RADIUS, DAMAGE.slam);
}

function castGetsugaSlash(player) {
  if (!tryUseSkill(player, "ichigo:getsuga_slash")) return;
  const dim = player.dimension;
  const dir = forwardDirection(player);
  const origin = player.location;
  const center = {
    x: origin.x + dir.x * 1.5,
    y: origin.y + 1,
    z: origin.z + dir.z * 1.5,
  };

  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    const p = {
      x: origin.x + dir.x * (0.5 + t * 3),
      y: origin.y + 1 + Math.sin(t * Math.PI) * 0.6,
      z: origin.z + dir.z * (0.5 + t * 3),
    };
    try {
      dim.spawnParticle("ichigo:getsuga", p);
      if (i % 3 === 0) dim.spawnParticle("ichigo:reiatsu", p);
    } catch (e) {}
  }
  dim.playSound("mob.wither.shoot", origin, { volume: 1.2, pitch: 1.1 });
  world.sendMessage(`§b${player.name} §7usou §6Getsuga Slash§7!`);

  // area 3x2 na frente
  damageNearbyEntities(player, center, 2.2, DAMAGE.slash);
}

// Avanco com dano ao longo do caminho: o player desliza pra frente por teleport
// incremental e atinge cada entidade uma vez so. Usado pelo Getsuga Run (um
// avanco longo) e pelo Flash Slash (tres avancos curtos em sequencia).
function performDashStrike(player, options) {
  const {
    distance,
    steps,
    damage,
    hitRadius = 1.6,
    particle = "minecraft:crit_particle",
    burst = "minecraft:large_explosion",
    onFinish,
  } = options;

  const dim = player.dimension;
  const dir = forwardDirection(player);
  const distancePerStep = distance / steps;
  const hitEntities = new Set();

  let traveled = 0;
  const interval = system.runInterval(() => {
    traveled += distancePerStep;

    let next;
    try {
      const base = player.location;
      next = {
        x: base.x + dir.x * distancePerStep,
        y: base.y,
        z: base.z + dir.z * distancePerStep,
      };
      player.teleport(next, { keepVelocity: false });
    } catch (e) {
      system.clearRun(interval);
      return;
    }

    // rastro de "deslizar" no chao, atras do player
    try {
      dim.spawnParticle(particle, {
        x: next.x - dir.x * 0.6,
        y: next.y + 0.1,
        z: next.z - dir.z * 0.6,
      });
      if (burst) {
        dim.spawnParticle(burst, {
          x: next.x - dir.x * 0.9,
          y: next.y + 0.2,
          z: next.z - dir.z * 0.9,
        });
      }
    } catch (e) {
      // particula invalida nao deve travar o avanco
    }

    const hitLocation = { x: next.x, y: next.y + 1, z: next.z };
    const nearby = dim.getEntities({ location: hitLocation, maxDistance: hitRadius });
    const finalDamage = damage * dmgMultiplier(player);
    for (const entity of nearby) {
      if (entity.id === player.id || hitEntities.has(entity.id)) continue;
      if (!entity.getComponent("minecraft:health")) continue;
      hitEntities.add(entity.id);
      dealDamage(entity, finalDamage, player);
    }

    if (traveled >= distance) {
      system.clearRun(interval);
      if (onFinish) onFinish();
    }
  }, 1);
}

function castGetsugaRun(player) {
  if (!tryUseSkill(player, "ichigo:getsuga_run")) return;

  player.dimension.playSound("mob.enderdragon.flap", player.location, {
    volume: 1,
    pitch: 1.4,
  });
  world.sendMessage(`§b${player.name} §7usou §6Getsuga Run§7!`);

  performDashStrike(player, {
    distance: 20,
    steps: 20, // 1 bloco por tick = deslize suave
    damage: DAMAGE.run,
    particle: "ichigo:getsuga",
    burst: "ichigo:reiatsu",
  });
}

// funcao generica: dispara uma onda em formato de lua crescente pra frente
function fireCrescentWave(player, options) {
  // a Hollowficação aumenta o tamanho dos getsugas; quem nao tem waveScale
  // continua com 1 e nada muda
  const scale = activeFormOf(player)?.waveScale ?? 1;
  const {
    radius: baseRadius,
    thickness: baseThickness,
    range,
    damage,
    speed = 2,
    particle = "minecraft:crit_particle",
    burst = "minecraft:large_explosion",
    rows = 12,
    bypassesIntocable = false,
    // corte deitado: o arco abre pros lados em vez de pra cima e pra baixo
    horizontal = false,
  } = options;

  const radius = baseRadius * scale;
  const thickness = baseThickness * scale;

  const dim = player.dimension;
  const dir = forwardDirection(player);
  const perp = { x: -dir.z, z: dir.x };
  const origin = player.location;

  let travelled = 0;
  const hitEntities = new Set();
  // o Getsuga do Ichigo (Dangai) desfaz a onda no caminho
  const attack = trackAttack(player, radius);

  const interval = system.runInterval(() => {
    if (attack.cancelled) {
      system.clearRun(interval);
      return;
    }
    for (let row = 0; row <= rows; row++) {
      const dy = -radius + (2 * radius * row) / rows;
      const outerReach = Math.sqrt(Math.max(0, radius * radius - dy * dy));
      const backLocal = -outerReach;
      const frontLocal = thickness - outerReach;

      for (let s = 0; s <= 2; s++) {
        const localX = backLocal + ((frontLocal - backLocal) * s) / 2;
        const p = horizontal
          ? {
              x: origin.x + dir.x * (travelled + localX) + perp.x * dy,
              y: origin.y + 1.1,
              z: origin.z + dir.z * (travelled + localX) + perp.z * dy,
            }
          : {
              x: origin.x + dir.x * (travelled + localX) + perp.x * 0.1,
              y: origin.y + 1 + dy,
              z: origin.z + dir.z * (travelled + localX) + perp.z * 0.1,
            };
        try {
          dim.spawnParticle(particle, p);
          if (s === 2) {
            dim.spawnParticle(burst, p);
          }
        } catch (e) {
          // particula invalida nao deve travar o efeito inteiro
        }
      }
    }

    const center = {
      x: origin.x + dir.x * travelled,
      y: origin.y + 1,
      z: origin.z + dir.z * travelled,
    };
    touchAttack(attack, center);
    const nearby = dim.getEntities({ location: center, maxDistance: radius + 0.6 });
    for (const entity of nearby) {
      if (entity.id === player.id || hitEntities.has(entity.id)) continue;
      if (!entity.getComponent("minecraft:health")) continue;
      hitEntities.add(entity.id);
      if (isRespiring(entity)) {
        showRespiraGuard(entity); // a onda passa por ele sem encostar
        continue;
      }
      dealDamage(entity, damage * dmgMultiplier(player), player, {
        bypassesIntocable,
      });
    }

    travelled += speed;
    if (travelled >= range) {
      system.clearRun(interval);
    }
  }, 1);
}

function castGetsugaTenshou(player) {
  if (!tryUseSkill(player, "ichigo:getsuga_tenshou")) return;
  world.sendMessage(`§c${player.name}: §lGETSUGA TENSHOU!`);
  player.dimension.playSound("mob.wither.shoot", player.location, {
    volume: 1.5,
    pitch: 0.5,
  });
  // raio 1.8 = diametro 3.6, o dobro da altura do player
  fireCrescentWave(player, {
    radius: 1.8,
    thickness: 0.9,
    range: 20,
    damage: DAMAGE.tenshou,
    particle: "ichigo:getsuga",
    burst: "ichigo:reiatsu",
  });
}

function castGetsugaBarrage(player) {
  if (!tryUseSkill(player, "ichigo:getsuga_barrage")) return;
  const dim = player.dimension;
  const loc = player.location;
  const RADIUS = 7.5; // area 15x15

  world.sendMessage(`§b${player.name} §7usou §6Getsuga Barrage§7!`);
  dim.playSound("mob.wither.shoot", loc, { volume: 1.4, pitch: 1.3 });

  for (let i = 0; i < 26; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * RADIUS;
    const p = {
      x: loc.x + Math.cos(angle) * dist,
      y: loc.y + 0.3 + Math.random() * 2.2,
      z: loc.z + Math.sin(angle) * dist,
    };
    dim.spawnParticle("ichigo:getsuga", p);
    if (i % 3 === 0) dim.spawnParticle("ichigo:reiatsu", p);
  }

  damageNearbyEntities(player, loc, RADIUS, DAMAGE.barrage);
}

function castGetsugaTenshouBankai(player) {
  if (!tryUseSkill(player, "ichigo:getsuga_tenshou_bankai")) return;
  world.sendMessage(`§4${player.name}: §l§4BANKAI GETSUGA TENSHOU!`);
  player.dimension.playSound("mob.wither.shoot", player.location, {
    volume: 2,
    pitch: 0.35,
  });
  // dobro de tamanho, alcance e dano do getsuga normal
  fireCrescentWave(player, {
    radius: 3.6,
    thickness: 1.8,
    range: 40,
    damage: DAMAGE.tenshouBankai,
    speed: 3,
    rows: 16,
    particle: "ichigo:getsuga",
    burst: "ichigo:reiatsu",
  });
}

function castDoubleGetsuga(player) {
  if (!tryUseSkill(player, "ichigo:double_getsuga")) return;
  world.sendMessage(`§c${player.name}: §lGETSUGA TENSHOU! §7(x2)`);
  player.dimension.playSound("mob.wither.shoot", player.location, {
    volume: 1.5,
    pitch: 0.5,
  });

  const wave = () =>
    fireCrescentWave(player, {
      radius: 1.8,
      thickness: 0.9,
      range: 20,
      damage: DAMAGE.doubleGetsuga,
      particle: "ichigo:getsuga",
      burst: "ichigo:reiatsu",
    });

  wave();
  system.runTimeout(wave, 8);
}

function castNukeTenshou(player) {
  if (!tryUseSkill(player, "ichigo:nuke_tenshou")) return;
  world.sendMessage(`§4§l${player.name}: NUKE TENSHOU!!!`);
  player.dimension.playSound("mob.wither.death", player.location, {
    volume: 2,
    pitch: 0.3,
  });
  fireCrescentWave(player, {
    radius: 5.4,
    thickness: 2.7,
    range: 30,
    damage: DAMAGE.nuke,
    speed: 3,
    particle: "minecraft:blood_particle",
    burst: "minecraft:large_explosion",
    rows: 18,
  });
}

/* ---------------------------------------------------------
   Skills do Byakuya Kuchiki (Senbonzakura)
   --------------------------------------------------------- */

function castByakuyaTripleshot(player) {
  if (!tryUseSkill(player, "byakuya:tripleshot")) return;
  const dim = player.dimension;
  const dir = forwardDirection(player);
  const perp = { x: -dir.z, z: dir.x };
  const origin = player.location;
  const RANGE = 14;
  // tres linhas: diagonal esquerda, reta, diagonal direita
  const LINES = [-0.5, 0, 0.5];
  const hitEntities = new Set();

  world.sendMessage(`§d${player.name} §7usou §5Senbonzakura Tripleshot§7!`);
  dim.playSound("mob.wither.shoot", origin, { volume: 1.2, pitch: 1.6 });

  let travelled = 0;
  const attack = trackAttack(player, 1.3);
  const interval = system.runInterval(() => {
    if (attack.cancelled) {
      system.clearRun(interval);
      return;
    }
    // o leque abre: o raio pra desfazer cresce junto
    touchAttack(
      attack,
      { x: origin.x + dir.x * travelled, y: origin.y + 1, z: origin.z + dir.z * travelled },
      1.3 + 0.5 * travelled
    );
    for (const offset of LINES) {
      const p = {
        x: origin.x + dir.x * travelled + perp.x * offset * travelled,
        y: origin.y + 1,
        z: origin.z + dir.z * travelled + perp.z * offset * travelled,
      };
      try {
        dim.spawnParticle("sakura:leaf", p);
      } catch (e) {}

      const nearby = dim.getEntities({ location: p, maxDistance: 1.3 });
      for (const entity of nearby) {
        if (entity.id === player.id || hitEntities.has(entity.id)) continue;
        if (!entity.getComponent("minecraft:health")) continue;
        hitEntities.add(entity.id);
        dealDamage(entity, DAMAGE.tripleshot * dmgMultiplier(player), player);
        applyDot(entity, player, 5, 3);
      }
    }

    travelled += 1.5;
    if (travelled >= RANGE) {
      system.clearRun(interval);
    }
  }, 1);
}

function castByakuyaDisperse(player) {
  if (!tryUseSkill(player, "byakuya:disperse")) return;
  const dim = player.dimension;
  const loc = player.location;
  const RADIUS = 7.5; // 15x15

  world.sendMessage(`§d${player.name} §7usou §5Senbonzakura Disperse§7!`);
  dim.playSound("mob.wither.shoot", loc, { volume: 1.4, pitch: 1.2 });

  for (let i = 0; i < 30; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.random() * RADIUS;
    const p = {
      x: loc.x + Math.cos(angle) * dist,
      y: loc.y + 0.3 + Math.random() * 2,
      z: loc.z + Math.sin(angle) * dist,
    };
    try {
      dim.spawnParticle("sakura:leaf", p);
    } catch (e) {}
  }

  const entities = dim.getEntities({ location: loc, maxDistance: RADIUS });
  for (const entity of entities) {
    if (entity.id === player.id) continue;
    if (!entity.getComponent("minecraft:health")) continue;
    dealDamage(entity, DAMAGE.disperse * dmgMultiplier(player), player);
    applyDot(entity, player, 6, 3);
  }
}

function castByakuyaBloodshed(player) {
  if (!tryUseSkill(player, "byakuya:bloodshed")) return;
  const dim = player.dimension;
  const dir = forwardDirection(player);
  const origin = player.location;
  const center = {
    x: origin.x + dir.x * 2.5,
    y: origin.y + 1,
    z: origin.z + dir.z * 2.5,
  };

  world.sendMessage(`§d${player.name} §7usou §5Senbonzakura Bloodshed§7!`);
  dim.playSound("mob.wither.shoot", origin, { volume: 1.5, pitch: 0.8 });

  for (let i = 0; i < 24; i++) {
    const t = i / 23;
    const p = {
      x: origin.x + dir.x * (1 + t * 4.5),
      y: origin.y + 1 + Math.sin(t * Math.PI) * 1.3,
      z: origin.z + dir.z * (1 + t * 4.5),
    };
    try {
      dim.spawnParticle("sakura:leaf", p);
    } catch (e) {}
  }

  const entities = dim.getEntities({ location: center, maxDistance: 3 });
  for (const entity of entities) {
    if (entity.id === player.id) continue;
    if (!entity.getComponent("minecraft:health")) continue;
    dealDamage(entity, DAMAGE.bloodshed * dmgMultiplier(player), player);
    applyDot(entity, player, 10, 5);
  }
}

function castSakuraDistraction(player) {
  if (!tryUseSkill(player, "byakuya:sakura_distraction")) return;
  const target = targetInView(player, 30);
  if (!target || (target.typeId !== "minecraft:player" && target.typeId !== "multiversal:training_dummy")) {
    player.sendMessage("§7A Sakura's Distraction precisa mirar em um player ou no Boneco de Teste.");
    return;
  }
  const dim = player.dimension;
  world.sendMessage(`§d${player.name} §7usou §5Sakura's Distraction§7 em §f${nameOf(target)}§7!`);
  try { target.addEffect("blindness", 200, { amplifier: 0, showParticles: false }); } catch (e) {}
  let elapsed=0;
  const interval=system.runInterval(()=>{
    try {
      const c=target.location;
      for(let i=0;i<55;i++){
        const a=Math.random()*Math.PI*2, d=Math.sqrt(Math.random())*4.5;
        dim.spawnParticle("sakura:leaf",{x:c.x+Math.cos(a)*d,y:c.y+0.2+Math.random()*2.3,z:c.z+Math.sin(a)*d});
      }
      target.addEffect("blindness",30,{amplifier:0,showParticles:false});
    } catch(e){ system.clearRun(interval); return; }
    elapsed+=10;
    if(elapsed>=200) system.clearRun(interval);
  },10);
}

/* ---------------------------------------------------------
   Skills do Zaraki Kenpachi
   --------------------------------------------------------- */

function castFlashSlash(player) {
  if (!tryUseSkill(player, "kenpachi:flash_slash")) return;

  world.sendMessage(`§6${player.name} §7usou §eFlash Slash§7!`);

  // Tres avancos. Cada um remira na direcao em que o player esta olhando na hora
  // e tem seu proprio conjunto de alvos ja atingidos, entao dar os 30 tres vezes
  // no mesmo alvo depende de virar pra ele entre um avanco e outro - um alvo
  // parado no caminho de um unico avanco leva so aquele.
  let advance = 0;
  const strike = () => {
    advance++;
    try {
      player.dimension.playSound("mob.enderdragon.flap", player.location, {
        volume: 1.1,
        pitch: 1.4 + advance * 0.15,
      });
    } catch (e) {
      return; // player saiu do mundo no meio da sequencia
    }

    performDashStrike(player, {
      distance: FLASH_SLASH.distancePerAdvance,
      steps: FLASH_SLASH.stepsPerAdvance,
      damage: DAMAGE.flashSlash,
      particle: "kenpachi:slash",
      burst: null,
      onFinish: () => {
        if (advance < FLASH_SLASH.advances) {
          system.runTimeout(strike, FLASH_SLASH.gapTicks);
        }
      },
    });
  };

  strike();
}

function castKenpachiStomp(player) {
  if (!tryUseSkill(player, "kenpachi:stomp")) return;
  const dim = player.dimension;
  const loc = player.location;

  world.sendMessage(`§6${player.name} §7usou §eStomp§7!`);
  dim.playSound("random.explode", loc, { volume: 1.6, pitch: 0.7 });

  // explosao de impacto no centro + anel de cortes se espalhando pra fora
  try {
    dim.spawnParticle("kenpachi:spark", {
      x: loc.x,
      y: loc.y + 0.2,
      z: loc.z,
    });
  } catch (e) {}
  for (let i = 0; i < 14; i++) {
    const angle = (i / 14) * Math.PI * 2;
    const r = STOMP_RADIUS * (0.4 + (i % 2) * 0.6);
    try {
      dim.spawnParticle("kenpachi:slash", {
        x: loc.x + Math.cos(angle) * r,
        y: loc.y + 0.2 + Math.random() * 0.5,
        z: loc.z + Math.sin(angle) * r,
      });
      if (i % 3 === 0) {
        dim.spawnParticle("kenpachi:spark", {
          x: loc.x + Math.cos(angle) * r,
          y: loc.y + 0.2,
          z: loc.z + Math.sin(angle) * r,
        });
      }
    } catch (e) {}
  }

  damageNearbyEntities(player, loc, STOMP_RADIUS, DAMAGE.stomp);
}

function nearestPlayer(player, maxDistance, origin = player.location) {
  let best;
  let bestDistance = Infinity;
  for (const other of player.dimension.getEntities({ location: origin, maxDistance })) {
    if (other.id === player.id) continue;
    if (other.typeId !== "minecraft:player" && other.typeId !== "multiversal:training_dummy") continue;
    if (!other.getComponent("minecraft:health")) continue;
    const dx = other.location.x-origin.x, dy=other.location.y-origin.y, dz=other.location.z-origin.z;
    const distance=Math.sqrt(dx*dx+dy*dy+dz*dz);
    if(distance<bestDistance){bestDistance=distance;best=other;}
  }
  return best;
}

// igual ao nearestPlayer, mas pega qualquer entidade com vida (nao so player)
function nearestTarget(player, maxDistance, origin = player.location) {
  let best;
  let bestDistance = Infinity;

  for (const entity of player.dimension.getEntities({ location: origin, maxDistance })) {
    if (entity.id === player.id) continue;
    if (!entity.getComponent("minecraft:health")) continue;
    const dx = entity.location.x - origin.x;
    const dy = entity.location.y - origin.y;
    const dz = entity.location.z - origin.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = entity;
    }
  }

  return best;
}

// vetor normalizado de "from" ate "to", usado pra mirar tiros num alvo fixo
// em vez de na direcao que o player esta olhando
function directionToward(from, to) {
  const dx = to.x - from.x;
  const dy = to.y + 1 - (from.y + 1.4);
  const dz = to.z - from.z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
  return { x: dx / len, y: dy / len, z: dz / len };
}

function castKenpachiHunt(player) {
  // procura o alvo ANTES de gastar o cooldown: sem ninguem por perto a skill
  // nao e consumida
  const target = nearestPlayer(player, KENPACHI_HUNT.searchRadius);
  if (!target) {
    player.sendMessage("§7Nenhum player por perto pra caçar.");
    return;
  }
  if (!tryUseSkill(player, "kenpachi:hunt")) return;

  const view = target.getViewDirection();
  const length = Math.sqrt(view.x * view.x + view.z * view.z) || 1;
  const targetLocation = target.location;
  const behind = {
    x: targetLocation.x - (view.x / length) * KENPACHI_HUNT.behindDistance,
    y: targetLocation.y,
    z: targetLocation.z - (view.z / length) * KENPACHI_HUNT.behindDistance,
  };

  try {
    player.teleport(behind, { keepVelocity: false, facingLocation: targetLocation });
  } catch (e) {
    player.sendMessage("§7Não deu pra aparecer atrás do alvo.");
    return;
  }

  world.sendMessage(
    `§6${player.name} §7caçou §c${target.name}§7 com §eKenpachi's Hunt§7!`
  );
  player.dimension.playSound("mob.endermen.portal", behind, {
    volume: 1.2,
    pitch: 0.6,
  });
  try {
    for (let i = 0; i < 6; i++) {
      player.dimension.spawnParticle("kenpachi:spark", {
        x: behind.x + (Math.random() - 0.5) * 0.6,
        y: behind.y + 0.5 + Math.random() * 1.2,
        z: behind.z + (Math.random() - 0.5) * 0.6,
      });
    }
  } catch (e) {}

  try {
    target.addEffect("slowness", KENPACHI_HUNT.slownessTicks, {
      amplifier: KENPACHI_HUNT.slownessAmplifier,
      showParticles: true,
    });
    target.addEffect("darkness", KENPACHI_HUNT.darknessTicks, {
      amplifier: 0,
      showParticles: false,
    });
    target.sendMessage("§8Algo apareceu atrás de você...");
  } catch (e) {
    // alvo saiu do mundo entre a busca e o teleport
  }
}

function castHellsCut(player) {
  if (!tryUseSkill(player, "kenpachi:hells_cut")) return;

  const character = getActiveCharacter(player);
  const desperation = character?.awakening?.desperation;
  let damage = DAMAGE.hellsCut;
  let desperate = false;

  // com o awakening ativo e pouca vida, o dano base triplica
  if (desperation && desperation.skill === "kenpachi:hells_cut" && isAwakened(player)) {
    if (virtualHealth(player) <= desperation.healthThreshold) {
      damage *= desperation.damageFactor;
      desperate = true;
    }
  }

  world.sendMessage(
    desperate
      ? `§4§l${player.name}: HELL'S CUT!!! §r§c(golpe de desespero)`
      : `§6${player.name}: §lHELL'S CUT!`
  );
  player.dimension.playSound("mob.wither.shoot", player.location, {
    volume: 1.6,
    pitch: desperate ? 0.35 : 0.6,
  });

  // mesma onda do Getsuga Tenshou, com metade do alcance
  fireCrescentWave(player, {
    radius: 1.8,
    thickness: 0.9,
    range: HELLS_CUT_RANGE,
    damage,
    particle: desperate ? "minecraft:blood_particle" : "kenpachi:slash",
    burst: desperate ? "minecraft:large_explosion" : "kenpachi:spark",
    bypassesIntocable: true,
  });
}

/* ---------------------------------------------------------
   Skills do Mayuri Kurotsuchi
   --------------------------------------------------------- */

// Caixa retangular na frente do player. As outras skills usam esfera; um corte
// "4 pra frente e 3 de largura" so faz sentido como caixa orientada pela visao.
function entitiesInFrontBox(player, box) {
  const { forward, width, verticalReach = 3 } = box;
  const dir = forwardDirection(player);
  const perp = { x: -dir.z, z: dir.x };
  const origin = player.location;
  const half = width / 2;

  // busca grossa por esfera e depois filtra pela caixa de verdade
  const searchRadius = Math.sqrt(forward * forward + half * half) + verticalReach;
  const found = [];

  for (const entity of player.dimension.getEntities({
    location: origin,
    maxDistance: searchRadius,
  })) {
    if (entity.id === player.id) continue;
    if (!entity.getComponent("minecraft:health")) continue;

    const dx = entity.location.x - origin.x;
    const dy = entity.location.y - origin.y;
    const dz = entity.location.z - origin.z;

    const along = dx * dir.x + dz * dir.z;
    const lateral = dx * perp.x + dz * perp.z;

    if (along < 0 || along > forward) continue;
    if (Math.abs(lateral) > half) continue;
    if (dy < -verticalReach || dy > verticalReach) continue;

    found.push(entity);
  }

  return found;
}

const activeMayuriPoisons = new Map();

function applyMayuriPoison(target, source, durationSeconds, damagePerSecond) {
  if (!target || !target.getComponent("minecraft:health")) return;
  const now=system.currentTick;
  const old=activeMayuriPoisons.get(target.id);
  const end=now+durationSeconds*20;
  if(!old || end>old.endTick || damagePerSecond>old.damagePerSecond){
    activeMayuriPoisons.set(target.id,{entity:target,source,endTick:end,damagePerSecond});
  } else old.endTick=end;
}

function isMayuriParalyzed(entity) {
  try { return entity.typeId === "minecraft:player" && !!entity.getDynamicProperty(DP.mayuriParalysis); } catch(e){ return false; }
}

function removeMutilationsAffecting(player) {
  for(let i=activeMutilations.length-1;i>=0;i--){
    const entry=activeMutilations[i];
    if(entry.ownerId===player.id || entry.victim?.id===player.id) liftMutilation(i);
  }
  player.setDynamicProperty(DP.frozenEnd,0);
  try{player.removeEffect("darkness");player.removeEffect("slowness");}catch(e){}
}

function castMayuriRegenerate(player) {
  if(!tryUseSkill(player,"mayuri:regenerate")) return;
  removeMutilationsAffecting(player);
  const hp=player.getComponent("minecraft:health");
  if(hp){ const scale=healthScaleOf(player); hp.setCurrentValue(Math.min(hp.effectiveMax,hp.currentValue+200/scale)); }
  world.sendMessage(`§5${player.name} §7usou §dRegenerate§7 e recuperou 200 de vida!`);
}

function castMayuriEnvenenar(player) {
  const target=targetInView(player,15);
  if(!target || target.typeId!=="minecraft:player"){ player.sendMessage("§7Mire em um player para usar Envenenar."); return; }
  const c=getActiveCharacter(target);
  if(!c || c.id!=="szayelaporro" || !isAwakened(target)){ player.sendMessage("§7Envenenar só pode marcar um Szayelaporro em Ressurreição."); return; }
  if(!tryUseSkill(player,"mayuri:envenenar")) return;
  target.setDynamicProperty("mv:mayuri_poison_gabriel",true);
  player.sendMessage(`§5${target.name} §7foi marcado com Envenenar. O próximo Gabriel será condenado.`);
}

function castPoisonSlash(player) {
  if (!tryUseSkill(player, "mayuri:poison_slash")) return;
  const dim = player.dimension;
  const dir = forwardDirection(player);
  const perp = { x: -dir.z, z: dir.x };
  const origin = player.location;
  const half = POISON_SLASH.width / 2;

  world.sendMessage(`§5${player.name} §7usou §dPoison Slash§7!`);
  dim.playSound("mob.wither.shoot", origin, { volume: 1.2, pitch: 1.3 });

  // desenha o corte cobrindo exatamente a caixa que da dano
  for (let step = 0; step <= 8; step++) {
    const t = step / 8;
    const along = 0.5 + t * (POISON_SLASH.forward - 0.5);
    const lateral = Math.cos(t * Math.PI) * half;
    const p = {
      x: origin.x + dir.x * along + perp.x * lateral,
      y: origin.y + 1 + Math.sin(t * Math.PI) * 0.5,
      z: origin.z + dir.z * along + perp.z * lateral,
    };
    try {
      dim.spawnParticle("mayuri:blade", p);
      if (step % 2 === 0) dim.spawnParticle("mayuri:poison_fog", p);
    } catch (e) {}
  }

  const finalDamage = DAMAGE.poisonSlash * dmgMultiplier(player);
  for (const entity of entitiesInFrontBox(player, POISON_SLASH)) {
    dealDamage(entity, finalDamage, player);
    applyMayuriPoison(entity, player, 5, 10);
  }
}

// Neblina venenosa que fica parada onde foi solta. A Toxic Fog e a Konjiki
// Ashisogi Jizo sao a mesma coisa com raio, intensidade e densidade diferentes.
function spawnPoisonCloud(player, cfg) {
  const dim = player.dimension;
  const center = player.location;
  // a deterioracao e por ENTIDADE, nao por passe: sem isso cada varredura
  // empilharia um DoT novo em quem ficasse parado na neblina
  const rotted = new Set();

  let elapsed = 0;
  const interval = system.runInterval(() => {
    for (let i = 0; i < cfg.particlesPerTick; i++) {
      const angle = Math.random() * Math.PI * 2;
      // sqrt espalha por area; sem ele a neblina fica amontoada no centro
      const dist = cfg.radius * Math.sqrt(Math.random());
      try {
        dim.spawnParticle(cfg.particle ?? "mayuri:poison_fog", {
          x: center.x + Math.cos(angle) * dist,
          y: center.y + 0.2 + Math.random() * cfg.height,
          z: center.z + Math.sin(angle) * dist,
        });
      } catch (e) {}
    }

    for (const entity of dim.getEntities({
      location: center,
      maxDistance: cfg.radius,
    })) {
      if (entity.id === player.id) continue;
      if (!entity.getComponent("minecraft:health")) continue;
      try {
        if (cfg.mayuriPoison) {
          applyMayuriPoison(entity, player, cfg.mayuriPoison.durationSeconds, cfg.mayuriPoison.damagePerSecond);
        }
        if (cfg.slownessAmplifier !== undefined) {
          entity.addEffect("slowness", cfg.refreshTicks, {
            amplifier: cfg.slownessAmplifier,
            showParticles: false,
          });
        }
        if (cfg.blindnessAmplifier !== undefined) {
          entity.addEffect("blindness", cfg.refreshTicks, {
            amplifier: cfg.blindnessAmplifier,
            showParticles: false,
          });
        }
        if (cfg.deterioration && !rotted.has(entity.id)) {
          rotted.add(entity.id);
          applyDeterioration(
            entity,
            player,
            cfg.deterioration.perSecond,
            cfg.deterioration.seconds
          );
        }
      } catch (e) {}
    }

    elapsed += cfg.tickInterval;
    if (elapsed >= cfg.durationTicks) {
      system.clearRun(interval);
      if (cfg.endMessage) {
        try {
          player.sendMessage(cfg.endMessage);
        } catch (e) {}
      }
    }
  }, cfg.tickInterval);
}

function castToxicFog(player) {
  if (!tryUseSkill(player, "mayuri:toxic_fog")) return;

  world.sendMessage(`§5${player.name} §7soltou §dToxic Fog§7!`);
  player.dimension.playSound("mob.wither.spawn", player.location, {
    volume: 1.2,
    pitch: 1.7,
  });

  spawnPoisonCloud(player, TOXIC_FOG);
}

/* ---------------------------------------------------------
   Bankai do Mayuri: Konjiki Ashisogi Jizo
   --------------------------------------------------------- */

function activateKonjiki(player, cfg) {
  world.sendMessage(
    `§5§lBANKAI: KONJIKI ASHISOGI JIZŌ! §r§dA neblina de ${player.name} cobre tudo.`
  );
  player.dimension.playSound("mob.wither.spawn", player.location, {
    volume: 2,
    pitch: 0.5,
  });

  spawnPoisonCloud(player, cfg);
}

function tryTriggerKonjiki(player, character) {
  if (getAwakening(player) < 100) return false;
  if (skillBlockingZoneFor(player)) return false;

  player.setDynamicProperty(DP.awakening, 0);
  activateKonjiki(player, character.superAttack.konjiki);
  return true;
}

// Cada personagem com super ataque decide o que acontece ao agachar + usar a m1
// com o medidor cheio.
function tryTriggerSuperAttack(player, character) {
  switch (character.superAttack.onTrigger) {
    case "byakuya":
      return tryTriggerByakuyaSuper(player, character);
    case "konjiki":
      return tryTriggerKonjiki(player, character);
    case "gin":
      return tryTriggerKamishini(player);
    case "shunsui":
      return tryTriggerKaramatsu(player);
    case "soifon":
      return tryTriggerJakuho(player);
    case "rukia":
      return tryTriggerHado(player);
    case "ukitake":
      return tryTriggerHansha(player);
    case "tosen":
      return tryTriggerEnma(player);
    case "aizen":
      return tryTriggerKurohitsugi(player);
    case "mugetsu":
      return tryTriggerMugetsu(player);
    case "kaido_expert":
      return tryTriggerKaidoExpert(player);
  }
  return false;
}

/* ---------------------------------------------------------
   Skills do Grimmjow Jaegerjaquez
   --------------------------------------------------------- */

// Esfera de energia que viaja pra frente e some no primeiro alvo ou no fim do
// alcance. Usa a direcao 3D da visao, entao da pra mirar pra cima e pra baixo.
function fireEnergySphere(player, options) {
  const {
    radius,
    range,
    speed = 1.5,
    damage,
    particle = "grimmjow:cero",
    shellParticles = 22,
    direction,
    origin: customOrigin,
    blast, // { radius, damage }: estoura em area ao acertar ou ao acabar
  } = options;

  const dim = player.dimension;
  const view = direction ?? player.getViewDirection();
  const length =
    Math.sqrt(view.x * view.x + view.y * view.y + view.z * view.z) || 1;
  const step = { x: view.x / length, y: view.y / length, z: view.z / length };
  // origem customizada deixa varias balas sairem lado a lado, formando fileira
  const origin = customOrigin ?? player.location;

  let travelled = radius;
  let swallowed = false; // a Respira do Barragan comeu o projetil
  let detonated = false; // cero com estouro ja abriu: nao abre duas vezes
  const hitEntities = new Set();

  const centerAt = (distance) => ({
    x: origin.x + step.x * distance,
    y: origin.y + 1.4 + step.y * distance,
    z: origin.z + step.z * distance,
  });

  // Colisao de um projetil pequeno e rapido tem dois furos classicos:
  //   - getEntities mede ate os PES da entidade, mas a esfera voa na altura do
  //     peito. Sem corrigir, um cero de raio menor que 1.4 nunca acerta ninguem
  //     que esteja no chao.
  //   - andando `speed` de uma vez, um alvo no meio de dois passos e atravessado.
  // Entao a checagem mede ate o meio do corpo e o avanco e feito em sub-passos
  // nunca maiores que o raio.
  const hitAround = (center) => {
    const finalDamage = damage * dmgMultiplier(player);
    for (const entity of dim.getEntities({
      location: center,
      maxDistance: radius + 2.5,
    })) {
      if (entity.id === player.id || hitEntities.has(entity.id)) continue;
      if (!entity.getComponent("minecraft:health")) continue;

      const loc = entity.location;
      const dx = loc.x - center.x;
      const dy = loc.y + 1 - center.y; // meio do corpo, nao os pes
      const dz = loc.z - center.z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > radius + 0.6) continue;

      hitEntities.add(entity.id);

      // a Respira nao aparia o cero: ela desmancha ele, sem dano nenhum
      if (isRespiring(entity)) {
        swallowed = true;
        showRespiraGuard(entity);
        return;
      }

      dealDamage(entity, finalDamage, player);
      if (blast) {
        detonated = true;
        detonateSphere(player, center, blast);
      }
    }
  };

  const attack = trackAttack(player, radius);

  const interval = system.runInterval(() => {
    if (attack.cancelled) {
      system.clearRun(interval);
      return;
    }
    const center = centerAt(travelled);
    touchAttack(attack, center);

    // casca da esfera: pontos espalhados na superficie
    for (let i = 0; i < shellParticles; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = radius * (0.72 + Math.random() * 0.28);
      try {
        dim.spawnParticle(particle, {
          x: center.x + r * Math.sin(phi) * Math.cos(theta),
          y: center.y + r * Math.cos(phi),
          z: center.z + r * Math.sin(phi) * Math.sin(theta),
        });
      } catch (e) {}
    }

    const subSteps = Math.max(1, Math.ceil(speed / Math.max(0.5, radius)));
    for (let s = 1; s <= subSteps; s++) {
      hitAround(centerAt(travelled + (speed * s) / subSteps));
      if (swallowed || detonated) break;
    }

    travelled += speed;
    if (swallowed || detonated || travelled >= range) {
      system.clearRun(interval);
      if (blast && !swallowed && !detonated) {
        detonateSphere(player, centerAt(travelled), blast);
      }
    }
  }, 1);
}

// estouro em area de um cero que tem `blast` configurado
function detonateSphere(player, center, blast) {
  try {
    player.dimension.playSound("random.explode", center, { volume: 1.6, pitch: 0.7 });
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = blast.radius * Math.sqrt(Math.random());
      player.dimension.spawnParticle("minecraft:large_explosion", {
        x: center.x + Math.cos(angle) * dist,
        y: center.y + (Math.random() - 0.5) * 2,
        z: center.z + Math.sin(angle) * dist,
      });
    }
  } catch (e) {}
  damageNearbyEntities(player, center, blast.radius, blast.damage);
}

// Corte reto desenhado na frente, cobrindo a mesma caixa que da dano.
function drawSweep(player, box, particle, vertical) {
  const dim = player.dimension;
  const dir = forwardDirection(player);
  const perp = { x: -dir.z, z: dir.x };
  const origin = player.location;
  const half = box.width / 2;

  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const lateral = vertical ? 0 : -half + t * box.width;
    const height = vertical ? 0.2 + t * box.verticalReach : 1.1;
    const along = box.forward * (vertical ? 0.75 : 0.55);
    try {
      dim.spawnParticle(particle, {
        x: origin.x + dir.x * along + perp.x * lateral,
        y: origin.y + height,
        z: origin.z + dir.z * along + perp.z * lateral,
      });
    } catch (e) {}
  }
}

function castDesgarra(player) {
  if (!tryUseSkill(player, "grimmjow:desgarra")) return;

  world.sendMessage(`§b${player.name} §7usou §9Desgarra de la Pantera§7!`);
  player.dimension.playSound("mob.wither.shoot", player.location, {
    volume: 1.3,
    pitch: 1.4,
  });

  drawSweep(player, DESGARRA, "grimmjow:cero", false);

  const finalDamage = DAMAGE.desgarra * dmgMultiplier(player);
  for (const entity of entitiesInFrontBox(player, DESGARRA)) {
    dealDamage(entity, finalDamage, player);
  }
}

function castRaza(player) {
  if (!tryUseSkill(player, "grimmjow:raza")) return;

  world.sendMessage(`§b${player.name} §7usou §9Raza de la Pantera§7!`);
  player.dimension.playSound("mob.enderdragon.flap", player.location, {
    volume: 1.2,
    pitch: 1.8,
  });

  // mesmo deslize do Getsuga Run, com o dobro da velocidade
  performDashStrike(player, {
    distance: RAZA.distance,
    steps: RAZA.steps,
    damage: DAMAGE.raza,
    particle: "grimmjow:cero",
    burst: null,
  });
}

function castGranReyCero(player, skillId = "grimmjow:gran_rey_cero") {
  if (!tryUseSkill(player, skillId)) return;

  world.sendMessage(`§9§l${player.name}: GRAN REY CERO!`);
  player.dimension.playSound("mob.wither.death", player.location, {
    volume: 1.8,
    pitch: 0.6,
  });

  fireEnergySphere(player, {
    radius: GRAN_REY_CERO.radius,
    range: GRAN_REY_CERO.range,
    speed: GRAN_REY_CERO.speed,
    damage: DAMAGE.granReyCero,
  });
}

/* ---------------------------------------------------------
   La Pantera (Resurreccion)
   --------------------------------------------------------- */

// grito de liberacao: aparece no chat como se o proprio personagem falasse
function announceBattleCry(player, form) {
  world.sendMessage(`<${player.name}> ${form.chatLine}`);
  player.dimension.playSound("mob.enderdragon.growl", player.location, {
    volume: 1.8,
    pitch: form.cryPitch ?? 1.3,
  });

  // Algumas formas têm partículas de liberação; o Vasto Lorde não tem aura.
  if (form.cryParticle) {
    const loc = player.location;
    for (let i = 0; i < 40; i++) {
      const angle = (i / 40) * Math.PI * 2;
      try {
        player.dimension.spawnParticle(form.cryParticle, {
          x: loc.x + Math.cos(angle) * 2.2,
          y: loc.y + 0.2 + (i % 8) * 0.35,
          z: loc.z + Math.sin(angle) * 2.2,
        });
      } catch (e) {}
    }
  }
}

function castDestruir(player) {
  if (!tryUseSkill(player, "grimmjow:destruir")) return;

  world.sendMessage(`§b${player.name} §7usou §9Destruir de La Pantera§7!`);
  player.dimension.playSound("mob.wither.shoot", player.location, {
    volume: 1.5,
    pitch: 0.9,
  });

  // tres cortes verticais em sequencia; o dano e o da skill inteira, aplicado
  // uma vez so junto com o primeiro corte
  for (let cut = 0; cut < DESTRUIR.cuts; cut++) {
    system.runTimeout(() => {
      try {
        drawSweep(player, DESTRUIR, "grimmjow:cero", true);
        player.dimension.playSound("mob.wither.shoot", player.location, {
          volume: 0.9,
          pitch: 1.2 + cut * 0.2,
        });
      } catch (e) {}
    }, cut * DESTRUIR.gapTicks + 1);
  }

  const finalDamage = DAMAGE.destruir * dmgMultiplier(player);
  for (const entity of entitiesInFrontBox(player, DESTRUIR)) {
    dealDamage(entity, finalDamage, player);
  }
}

function castRugido(player) {
  if (!tryUseSkill(player, "grimmjow:rugido")) return;

  world.sendMessage(`§b${player.name} §7usou §9Rugido de La Pantera§7!`);

  // tres sequencias de explosao em volta, cada uma mais forte que a anterior
  DAMAGE.rugido.forEach((damage, index) => {
    system.runTimeout(() => {
      let loc;
      try {
        loc = player.location;
        player.dimension.playSound("random.explode", loc, {
          volume: 1.5,
          pitch: 1.1 - index * 0.2,
        });
      } catch (e) {
        return; // player saiu do mundo no meio da sequencia
      }

      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const dist = RUGIDO.radius * (0.4 + Math.random() * 0.6);
        try {
          player.dimension.spawnParticle("minecraft:large_explosion", {
            x: loc.x + Math.cos(angle) * dist,
            y: loc.y + 0.3 + Math.random() * 1.5,
            z: loc.z + Math.sin(angle) * dist,
          });
        } catch (e) {}
      }

      damageNearbyEntities(player, loc, RUGIDO.radius, damage);
    }, index * RUGIDO.gapTicks + 1);
  });
}

// segura o alvo na frente do Grimmjow e arranca o coracao
function seizeAndRipHeart(player, victim) {
  const dim = player.dimension;

  world.sendMessage(`§4§l${player.name} agarrou ${victim.name}!`);
  dim.playSound("mob.enderdragon.growl", player.location, {
    volume: 1.5,
    pitch: 1.7,
  });

  let elapsed = 0;
  const interval = system.runInterval(() => {
    elapsed++;

    let heldAt;
    try {
      const dir = forwardDirection(player);
      const anchor = player.location;
      heldAt = {
        x: anchor.x + dir.x * ARRANCAR_CORAZON.holdDistance,
        y: anchor.y,
        z: anchor.z + dir.z * ARRANCAR_CORAZON.holdDistance,
      };
      // preso de frente pro Grimmjow, sem conseguir sair
      victim.teleport(heldAt, { keepVelocity: false, facingLocation: anchor });
      victim.addEffect("slowness", 20, { amplifier: 255, showParticles: false });
    } catch (e) {
      system.clearRun(interval);
      return;
    }

    for (let i = 0; i < 4; i++) {
      try {
        dim.spawnParticle("minecraft:blood_particle", {
          x: heldAt.x + (Math.random() - 0.5) * 0.8,
          y: heldAt.y + 0.9 + Math.random() * 0.7,
          z: heldAt.z + (Math.random() - 0.5) * 0.8,
        });
      } catch (e) {}
    }

    if (elapsed < ARRANCAR_CORAZON.grabTicks) return;

    system.clearRun(interval);
    try {
      victim.removeEffect("slowness");
      for (let i = 0; i < 30; i++) {
        dim.spawnParticle("minecraft:blood_particle", {
          x: heldAt.x + (Math.random() - 0.5) * 1.4,
          y: heldAt.y + 0.6 + Math.random() * 1.4,
          z: heldAt.z + (Math.random() - 0.5) * 1.4,
        });
      }
      dealDamage(victim, DAMAGE.arrancarCorazon * dmgMultiplier(player), player);
      world.sendMessage(
        `§4§l${player.name} arrancou o coração de ${victim.name}!`
      );
    } catch (e) {
      // alvo saiu do mundo antes do golpe final
    }
  }, 1);
}

function castArrancarCorazon(player) {
  if (!tryUseSkill(player, "grimmjow:arrancar_corazon")) return;
  const dim = player.dimension;
  const dir = forwardDirection(player);

  world.sendMessage(`§b${player.name} §7usou §9Arrancar Corazón§7!`);
  dim.playSound("mob.enderdragon.flap", player.location, {
    volume: 1.2,
    pitch: 0.8,
  });

  const perStep = ARRANCAR_CORAZON.dashDistance / ARRANCAR_CORAZON.dashSteps;
  let steps = 0;

  const interval = system.runInterval(() => {
    steps++;

    let position;
    try {
      const base = player.location;
      position = {
        x: base.x + dir.x * perStep,
        y: base.y,
        z: base.z + dir.z * perStep,
      };
      player.teleport(position, { keepVelocity: false });
      dim.spawnParticle("grimmjow:cero", {
        x: position.x,
        y: position.y + 1,
        z: position.z,
      });
    } catch (e) {
      system.clearRun(interval);
      return;
    }

    // so agarra player, como pedido
    const victim = nearestPlayer(player, ARRANCAR_CORAZON.searchRadius, position);
    if (victim) {
      system.clearRun(interval);
      seizeAndRipHeart(player, victim);
      return;
    }

    if (steps >= ARRANCAR_CORAZON.dashSteps) {
      system.clearRun(interval);
      player.sendMessage("§7Você avançou, mas não agarrou ninguém.");
    }
  }, 1);
}

function castDisparo(player) {
  if (!tryUseSkill(player, "grimmjow:disparo")) return;

  world.sendMessage(`§b${player.name} §7usou §9Disparo de La Pantera§7!`);
  player.dimension.playSound("random.orb", player.location, {
    volume: 1.2,
    pitch: 1.9,
  });

  player.addEffect("speed", DISPARO.durationTicks, {
    amplifier: DISPARO.speedAmplifier,
    showParticles: true,
  });

  // o buff SOBRESCREVE o speed permanente da forma, entao tem que devolver
  system.runTimeout(() => {
    try {
      reapplyFormEffects(player);
    } catch (e) {
      // player saiu do mundo
    }
  }, DISPARO.durationTicks);
}

/* ---------------------------------------------------------
   Aaroniero Arruruerie
   --------------------------------------------------------- */

const AARONIERO_SIGNATURES = {
  grimmjow: { item: "grimmjow:desgarra", name: "Desgarra de la Pantera", kind: "sweep", damage: 100 },
  szayelaporro: { item: "szayel:ascendent_cut", name: "Ascendent Cut", kind: "wave", damage: 50 },
  nnoitra: { item: "nnoitra:avance_fatal", name: "Avance Fatal", kind: "dash", damage: 200 },
  ulquiorra: { item: "ulquiorra:cero_oscuras", name: "Cero Oscuras", kind: "cero", damage: 1400 },
  harribel: { item: "harribel:tsunami", name: "Tsunami", kind: "tsunami", damage: 750 },
  barragan: { item: "barragan:el_rei_oco", name: "El Rei Oco", kind: "reioco", damage: 40 },
  starkk: { item: "starkk:kamarada", name: "Kamarada", kind: "kamarada", damage: 200 },
  yammy: { item: "yammy:quebramundos", name: "Quebramundos", kind: "quebramundos", damage: 1000 },
};

function getAaronieroAbsorbed(player) {
  try {
    const raw = player.getDynamicProperty(DP.aaronieroAbsorbed);
    if (typeof raw === "string") {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    }
  } catch (e) {}
  return [];
}

function setAaronieroAbsorbed(player, arr) {
  player.setDynamicProperty(DP.aaronieroAbsorbed, JSON.stringify(arr.slice(0, 3)));
}

function clearAaronieroAbsorbed(player) {
  setAaronieroAbsorbed(player, []);
}

function getAaronieroDevouredCount(player) {
  try {
    const n = player.getDynamicProperty(DP.aaronieroDevouredCount);
    return typeof n === "number" && n > 0 ? Math.floor(n) : 0;
  } catch (e) {
    return 0;
  }
}

function setAaronieroDevouredCount(player, n) {
  player.setDynamicProperty(DP.aaronieroDevouredCount, Math.max(0, Math.floor(n)));
}

function clearAaronieroDevoured(player) {
  clearAaronieroAbsorbed(player);
  setAaronieroDevouredCount(player, 0);
}

function isEspadaPlayer(entity) {
  if (!entity || entity.typeId !== "minecraft:player") return false;
  const id = entity.getDynamicProperty(DP.character);
  return !!AARONIERO_SIGNATURES[id];
}

function currentConfiguredMaxHealth(entity) {
  const c = getActiveCharacter(entity);
  const form = activeFormOf(entity, c);
  return form?.health ?? c?.health ?? 20;
}

function absorbEspada(player, target) {
  const targetId = target.getDynamicProperty(DP.character);
  const signature = AARONIERO_SIGNATURES[targetId];
  if (!signature) return false;

  const max = currentConfiguredMaxHealth(target);
  if (virtualHealth(target) >= max * 0.25) return false;

  const absorbed = getAaronieroAbsorbed(player);
  const entry = { source: targetId, item: signature.item, name: signature.name, kind: signature.kind, damage: signature.damage };
  if (absorbed.length >= 3) absorbed.shift();
  absorbed.push(entry);
  setAaronieroAbsorbed(player, absorbed);
  setAaronieroDevouredCount(player, getAaronieroDevouredCount(player) + 1);

  try { target.kill(); } catch (e) {}
  applyCharacterEffects(
    player,
    isAwakened(player) ? getActiveCharacter(player).awakening.health : getActiveCharacter(player).health,
    isAwakened(player) ? (activeFormOf(player)?.speedAmplifier ?? BASE_SPEED_AMPLIFIER) : BASE_SPEED_AMPLIFIER,
    isAwakened(player) ? ("regenAmplifier" in activeFormOf(player) ? activeFormOf(player).regenAmplifier : REGEN_AMPLIFIER) : REGEN_AMPLIFIER,
    isAwakened(player) ? activeFormOf(player)?.extraEffects : undefined
  );
  player.sendMessage(`§5Glotonería absorveu §d${signature.name}§5 de ${target.name}.`);
  player.sendMessage(`§7Habilidades absorvidas: ${getAaronieroAbsorbed(player).map(x => x.name).join(", ")}`);
  return true;
}

function castAaronieroCeroMetalico(player) {
  if (!tryUseSkill(player, "aaroniero:cero_metalico")) return;
  world.sendMessage(`§5${player.name} §7usou §dCero Metálico§7!`);
  fireEnergySphere(player, { radius: 1.5, range: 30, speed: 1.5, damage: DAMAGE.ceroMetalico, particle: "barragan:cero_rojo", shellParticles: 18 });
}

function castAaronieroNejibana(player) {
  if (!tryUseSkill(player, "aaroniero:nejibana")) return;
  world.sendMessage(`§5${player.name} §7usou §3Nejibana§7!`);
  performDashStrike(player, { distance: 14, steps: 14, damage: DAMAGE.nejibana, particle: "harribel:agua", burst: "harribel:agua" });
}

function castAaronieroDevorar(player) {
  const target = nearestPlayer(player, 12);
  if (!target) { player.sendMessage("§7Nenhum alvo próximo para Devorar."); return; }
  if (!tryUseSkill(player, "aaroniero:devorar")) return;
  if (isEspadaPlayer(target) && absorbEspada(player, target)) {
    try { player.dimension.spawnParticle("mayuri:poison_fog", target.location); } catch (e) {}
    return;
  }
  dealDamage(target, DAMAGE.devorar * dmgMultiplier(player), player);
}

function castAaronieroMascara(player) {
  if (!tryUseSkill(player, "aaroniero:mascara_kaien")) return;
  player.setDynamicProperty(DP.aaronieroMaskEnd, system.currentTick + 240);
  setPermanentEffect(player, "speed", 2);
  player.sendMessage("§3Máscara do Kaien ativa: velocidade e +15% de dano por 12s!");
  try { player.dimension.spawnParticle("harribel:agua", player.location); } catch (e) {}
}

function castAaronieroTentaculos(player) {
  if (!tryUseSkill(player, "aaroniero:tentaculos")) return;
  const dim = player.dimension;
  const center = player.location;
  world.sendMessage(`§5§l${player.name}: TENTÁCULOS!`);
  let hit = 0;
  const timer = system.runInterval(() => {
    if (hit >= 4) { system.clearRun(timer); return; }
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 9;
      try { dim.spawnParticle("mayuri:poison_fog", {x:center.x+Math.cos(a)*r,y:center.y+1,z:center.z+Math.sin(a)*r}); } catch(e){}
    }
    damageNearbyEntities(player, center, 9, DAMAGE.tentaculos);
    hit++;
  }, 4);
}

function castAaronieroTridente(player) {
  const target = nearestPlayer(player, 15);
  if (!target) { player.sendMessage("§7Nenhum alvo próximo para o Tridente de Kaien."); return; }
  if (!tryUseSkill(player, "aaroniero:tridente_kaien")) return;
  dealDamage(target, DAMAGE.tridenteKaien * dmgMultiplier(player), player);
  const anchor = {x: target.location.x, y: target.location.y, z: target.location.z};
  let ticks = 0;
  const timer = system.runInterval(() => {
    ticks += 2;
    try {
      target.addEffect("slowness", 10, {amplifier:255, showParticles:false});
      target.teleport(anchor, {keepVelocity:false});
      target.dimension.spawnParticle("harribel:agua", {x:anchor.x,y:anchor.y+1,z:anchor.z});
    } catch(e) { system.clearRun(timer); return; }
    if (ticks >= 60) system.clearRun(timer);
  }, 2);
}

function castAaronieroCeroGloton(player) {
  if (!tryUseSkill(player, "aaroniero:cero_metalico_gloton")) return;
  const count = getAaronieroDevouredCount(player);
  const damage = Math.min(335, DAMAGE.ceroMetalicoGloton + count * 15);
  world.sendMessage(`§5§l${player.name}: CERO METÁLICO GLOTÓN! §7(${damage})`);
  fireEnergySphere(player, {radius:2.2, range:35, speed:1.25, damage, particle:"barragan:cero_rojo", shellParticles:30});
}

function castAaronieroBanquete(player) {
  if (!tryUseSkill(player, "aaroniero:banquete")) return;
  const count = getAaronieroAbsorbed(player).length;
  const center = player.location;
  world.sendMessage(`§5§l${player.name}: BANQUETE! §7Consumidos: ${count}`);
  for (let i=0;i<80;i++) {
    const a=Math.random()*Math.PI*2, r=12*Math.sqrt(Math.random());
    try { player.dimension.spawnParticle("mayuri:poison_fog", {x:center.x+Math.cos(a)*r,y:center.y+Math.random()*3,z:center.z+Math.sin(a)*r}); } catch(e){}
  }
  damageNearbyEntities(player, center, 12, DAMAGE.banquete);
  const hp=player.getComponent("minecraft:health");
  if(hp){ const scale=healthScaleOf(player); hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + 100/scale)); }
  clearAaronieroDevoured(player);
  const c=getActiveCharacter(player);
  if(c){ const f=activeFormOf(player,c); applyCharacterEffects(player, f?.health ?? c.health, f?.speedAmplifier ?? BASE_SPEED_AMPLIFIER, "regenAmplifier" in (f??{}) ? f.regenAmplifier : REGEN_AMPLIFIER, f?.extraEffects); }
}

function castAaronieroGlotoneria(player) {
  const absorbed = getAaronieroAbsorbed(player);
  if (!absorbed.length) { player.sendMessage("§7Glotonería: nenhuma habilidade absorvida."); return; }
  if (!tryUseSkill(player, "aaroniero:glotoneria")) return;
  const idx = player.getDynamicProperty("mv:aaroniero_selected") ?? 0;
  const entry = absorbed[Math.max(0, Math.min(absorbed.length-1, Number(idx)))];
  const next = (Number(idx) + 1) % absorbed.length;
  player.setDynamicProperty("mv:aaroniero_selected", next);
  const d = entry.damage * 0.7;
  world.sendMessage(`§5${player.name} usou §d${entry.name}§5 absorvido! §7(70% do dano)`);
  switch(entry.kind) {
    case "sweep": drawSweep(player, DESGARRA, "grimmjow:cero", false); for(const e of entitiesInFrontBox(player, DESGARRA)) dealDamage(e,d,player); break;
    case "wave": fireCrescentWave(player,{radius:ASCENDENT_CUT.radius,thickness:ASCENDENT_CUT.thickness,range:ASCENDENT_CUT.range,speed:ASCENDENT_CUT.speed,damage:d,particle:"szayel:esporo",burst:"szayel:esporo"}); break;
    case "dash": performDashStrike(player,{distance:AVANCE_FATAL.maxDistancePerTick*AVANCE_FATAL.dashTicks,steps:AVANCE_FATAL.dashTicks,damage:d,particle:"nnoitra:corte",burst:null}); break;
    case "cero": fireEnergySphere(player,{radius:CERO_OSCURAS.radius,range:CERO_OSCURAS.range,speed:CERO_OSCURAS.speed,damage:d,particle:"ulquiorra:oscuras",shellParticles:40}); break;
    case "tsunami": performDashStrike(player,{distance:20,steps:10,damage:d,particle:"harribel:agua",burst:"harribel:agua"}); break;
    case "reioco": for(let i=0;i<8;i++){const a=(i/8)*Math.PI*2; fireEnergySphere(player,{radius:EL_REI_OCO.radius,range:EL_REI_OCO.range,speed:EL_REI_OCO.speed,damage:d,particle:"barragan:cero_rojo",shellParticles:8,direction:{x:Math.cos(a),y:0,z:Math.sin(a)}});} break;
    case "kamarada": { const cfg={...KAMARADA,count:3,damage:()=>d}; for(let i=0;i<cfg.count;i++) summonHomingBeast(player,i,cfg); break; }
    case "quebramundos": damageNearbyEntities(player,player.location,QUEBRAMUNDOS.blastRadius,d); break;
  }
}

/* ---------------------------------------------------------
   Skills do Ulquiorra Cifer
   --------------------------------------------------------- */

function castCeroBala(player) {
  if (!tryUseSkill(player, "ulquiorra:cero_bala")) return;

  world.sendMessage(`§2${player.name} §7usou §aCero Bala§7!`);

  // quatro tiros rapidos em sequencia, cada um remirando pra onde o player olha
  for (let shot = 0; shot < CERO_BALA.shots; shot++) {
    system.runTimeout(() => {
      try {
        player.dimension.playSound("mob.wither.shoot", player.location, {
          volume: 1,
          pitch: 1.8,
        });
        fireEnergySphere(player, {
          radius: CERO_BALA.radius,
          range: CERO_BALA.range,
          speed: CERO_BALA.speed,
          damage: DAMAGE.ceroBala,
          particle: "ulquiorra:oscuras",
          shellParticles: 8,
        });
      } catch (e) {
        // player saiu do mundo no meio da rajada
      }
    }, shot * CERO_BALA.gapTicks + 1);
  }
}

function castSonido(player) {
  // procura antes de gastar o cooldown
  const target = nearestPlayer(player, SONIDO.searchRadius);
  if (!target) {
    player.sendMessage("§7Nenhum player por perto pro Sonído.");
    return;
  }
  if (!tryUseSkill(player, "ulquiorra:sonido")) return;

  const from = player.location;
  const to = target.location;
  const dx = from.x - to.x;
  const dz = from.z - to.z;
  const distance = Math.sqrt(dx * dx + dz * dz) || 1;

  // aparece colado no alvo, do lado de onde estava vindo
  const spot = {
    x: to.x + (dx / distance) * SONIDO.distance,
    y: to.y,
    z: to.z + (dz / distance) * SONIDO.distance,
  };

  try {
    player.teleport(spot, { keepVelocity: false, facingLocation: to });
  } catch (e) {
    return;
  }

  world.sendMessage(`§2${player.name} §7apareceu ao lado de §a${target.name}§7 com Sonído.`);
  for (const at of [from, spot]) {
    for (let i = 0; i < 10; i++) {
      try {
        player.dimension.spawnParticle("ulquiorra:oscuras", {
          x: at.x + (Math.random() - 0.5) * 1.2,
          y: at.y + Math.random() * 2,
          z: at.z + (Math.random() - 0.5) * 1.2,
        });
      } catch (e) {}
    }
  }
  player.dimension.playSound("mob.endermen.portal", spot, { volume: 1, pitch: 1.4 });
}

function castPesquisa(player) {
  const seen = player.getEntitiesFromViewDirection({ maxDistance: PESQUISA.range });
  const target = seen
    .map((hit) => hit.entity)
    .find((entity) => entity && entity.id !== player.id && entity.getComponent("minecraft:health"));

  if (!target) {
    player.sendMessage("§7Você não está olhando pra ninguém.");
    return;
  }
  if (!tryUseSkill(player, "ulquiorra:pesquisa")) return;

  markTarget(target, PESQUISA.durationTicks, PESQUISA.damageMultiplier);

  const name = target.typeId === "minecraft:player" ? target.name : target.typeId;
  world.sendMessage(
    `§2${player.name} §7analisou §a${name}§7: §c+50% de dano recebido §7por ${
      PESQUISA.durationTicks / 20
    }s.`
  );
  player.dimension.playSound("random.orb", player.location, { volume: 1, pitch: 0.6 });

  // marca visivel em volta do alvo enquanto durar
  let elapsed = 0;
  const interval = system.runInterval(() => {
    elapsed += 5;
    if (elapsed > PESQUISA.durationTicks || !isMarked(target)) {
      system.clearRun(interval);
      return;
    }
    try {
      const loc = target.location;
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2 + elapsed / 10;
        target.dimension.spawnParticle("ulquiorra:oscuras", {
          x: loc.x + Math.cos(angle) * 0.9,
          y: loc.y + 2.2,
          z: loc.z + Math.sin(angle) * 0.9,
        });
      }
    } catch (e) {
      system.clearRun(interval);
    }
  }, 5);
}

/* ---------------------------------------------------------
   Murcielago (Resurreccion)
   --------------------------------------------------------- */

function castNihil(player) {
  if (!tryUseSkill(player, "ulquiorra:nihil")) return;

  world.sendMessage(`§2${player.name} §7usou §aNihil§7!`);
  player.dimension.playSound("mob.wither.shoot", player.location, {
    volume: 1.3,
    pitch: 0.5,
  });

  drawSweep(player, NIHIL, "ulquiorra:oscuras", true);

  for (const entity of entitiesInFrontBox(player, NIHIL)) {
    // Segunda Etapa aumenta o Nihil de 30% para 40% da vida atual.
    const fraction = isTrueForm(player) ? 0.4 : NIHIL.healthFraction;
    const toll = virtualHealth(entity) * fraction;
    if (toll > 0) dealDamage(entity, toll, player);
  }
}

function activateEnigma(player) {
  if (!tryUseSkill(player, "ulquiorra:enigma")) return;
  const dim = player.dimension;
  const center = player.location;
  const stripped = new Set();

  world.sendMessage(
    `§2§l${player.name} selou a área com Enigma! §r§7(sem regeneração e sem skills lá dentro)`
  );
  dim.playSound("mob.wither.spawn", center, { volume: 1.4, pitch: 1.1 });

  let elapsed = 0;
  const intervalId = system.runInterval(() => {
    // parede verde marcando o perimetro
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2;
      for (let h = 0; h < 4; h++) {
        try {
          dim.spawnParticle("ulquiorra:oscuras", {
            x: center.x + Math.cos(angle) * ENIGMA.radius,
            y: center.y + h * 1.2,
            z: center.z + Math.sin(angle) * ENIGMA.radius,
          });
        } catch (e) {}
      }
    }

    elapsed += ENIGMA.tickInterval;
    if (elapsed >= ENIGMA.durationTicks) {
      removeZonesOwnedBy(player.id);
      try {
        player.sendMessage("§7A Enigma se desfez.");
      } catch (e) {}
    }
  }, ENIGMA.tickInterval);

  activeZones.push({
    ownerId: player.id,
    kind: "enigma",
    center,
    radius: ENIGMA.radius,
    dimension: dim,
    intervalId,
    trapped: new Set(),
    stripped,
    blocksSkills: true,
    blocksOwnerSkills: false, // "skills inimigas": o Ulquiorra continua usando as dele
    traps: false,
    blocksRegen: true,
    blockMessage: "§7A Enigma anula suas skills aqui dentro.",
    onRemove: () => {
      // devolve a regeneracao pra quem ficou sem ela dentro da zona
      for (const other of world.getPlayers()) {
        if (!stripped.has(other.id)) continue;
        try {
          reapplyFormEffects(other);
        } catch (e) {}
      }
    },
  });
}

function castCeroOscuras(player) {
  if (!tryUseSkill(player, "ulquiorra:cero_oscuras")) return;

  world.sendMessage(`§2§l${player.name}: CERO OSCURAS!`);
  player.dimension.playSound("mob.wither.death", player.location, {
    volume: 2,
    pitch: 0.3,
  });

  fireEnergySphere(player, {
    radius: CERO_OSCURAS.radius,
    range: CERO_OSCURAS.range,
    speed: CERO_OSCURAS.speed,
    damage: DAMAGE.ceroOscuras,
    particle: "ulquiorra:oscuras",
    shellParticles: CERO_OSCURAS.shellParticles,
  });
}

function castCeroOscurasTriplo(player) {
  if (!tryUseSkill(player, "ulquiorra:cero_oscuras_triplo")) return;

  const dim = player.dimension;
  const dir = forwardDirection(player);
  const perp = { x: -dir.z, z: dir.x };
  const origin = player.location;
  world.sendMessage(`§2§l${player.name}: CERO OSCURAS TRIPLO!`);
  dim.playSound("mob.wither.death", origin, { volume: 2.2, pitch: 0.25 });

  const offsets = [-3.2, 0, 3.2];
  for (const lateral of offsets) {
    fireEnergySphere(player, {
      radius: 6.5,
      range: 34,
      speed: 1.25,
      damage: DAMAGE.ceroOscurasTriplo,
      particle: "ulquiorra:oscuras",
      shellParticles: 48,
      origin: {
        x: origin.x + perp.x * lateral,
        y: origin.y,
        z: origin.z + perp.z * lateral,
      },
    });
  }
}

function explodeLanza(player, center) {
  const dim = player.dimension;

  try {
    dim.playSound("mob.wither.death", center, { volume: 2, pitch: 0.2 });
  } catch (e) {}

  // cascas concentricas ate o raio cheio: a maior explosao do addon
  for (let ring = 1; ring <= 6; ring++) {
    const radius = (LANZA.blastRadius * ring) / 6;
    const points = 12 + ring * 6;
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      for (const height of [0.3, 2, 4]) {
        try {
          dim.spawnParticle(
            ring > 4 ? "ulquiorra:oscuras" : "minecraft:large_explosion",
            {
              x: center.x + Math.cos(angle) * radius,
              y: center.y + height,
              z: center.z + Math.sin(angle) * radius,
            }
          );
        } catch (e) {}
      }
    }
  }

  damageNearbyEntities(player, center, LANZA.blastRadius, DAMAGE.lanza);
}

function explodeLanzaSecondStage(player, center) {
  const dim = player.dimension;

  // A Lanza da Segunda Etapa mantém a grande explosão da Lanza original;
  // os raios são um efeito adicional, não um substituto da explosão.
  try {
    dim.playSound("mob.wither.death", center, { volume: 2.2, pitch: 0.2 });
    for (let ring = 1; ring <= 8; ring++) {
      const rr = 26 * ring / 8;
      const pts = 18 + ring * 6;
      for (let i=0;i<pts;i++) {
        const a=(i/pts)*Math.PI*2;
        dim.spawnParticle("ulquiorra:oscuras", {x:center.x+Math.cos(a)*rr,y:center.y+0.4,z:center.z+Math.sin(a)*rr});
      }
    }
  } catch (e) {}
  const secondBlastRadius = 26;
  damageNearbyEntities(player, center, secondBlastRadius, 1200);

  const count = 24;
  const radius = 26;
  let strike = 0;

  world.sendMessage(`§2§l${player.name}: os raios da Lanza cercam a área!`);

  const interval = system.runInterval(() => {
    if (strike >= count) {
      system.clearRun(interval);
      return;
    }

    const angle = (strike / count) * Math.PI * 2 + 0.15;
    const dist = radius * (0.35 + Math.random() * 0.65);
    const point = {
      x: center.x + Math.cos(angle) * dist,
      y: center.y,
      z: center.z + Math.sin(angle) * dist,
    };

    // coluna de partículas para simular um raio caindo naquele ponto
    for (let h = 0; h < 8; h++) {
      try {
        dim.spawnParticle("ulquiorra:lightning", {
          x: point.x + (Math.random() - 0.5) * 0.35,
          y: point.y + h * 1.1,
          z: point.z + (Math.random() - 0.5) * 0.35,
        });
      } catch (e) {}
    }
    try {
      dim.playSound("mob.wither.shoot", point, { volume: 0.7, pitch: 1.8 });
      dim.spawnParticle("minecraft:large_explosion", { x: point.x, y: point.y + 0.2, z: point.z });
    } catch (e) {}

    damageNearbyEntities(player, point, 2.2, 40);
    strike++;
  }, 4);
}

function castLanza(player) {
  if (!tryUseSkill(player, "ulquiorra:lanza")) return;
  const dim = player.dimension;
  const view = player.getViewDirection();
  const length =
    Math.sqrt(view.x * view.x + view.y * view.y + view.z * view.z) || 1;
  const step = { x: view.x / length, y: view.y / length, z: view.z / length };
  const origin = player.location;

  world.sendMessage(`§2§l${player.name}: LANZA DEL RELÁMPAGO!`);
  dim.playSound("mob.wither.shoot", origin, { volume: 2, pitch: 0.4 });

  let travelled = 2;
  const attack = trackAttack(player, 2);
  const interval = system.runInterval(() => {
    if (attack.cancelled) {
      system.clearRun(interval);
      return;
    }
    const tip = {
      x: origin.x + step.x * travelled,
      y: origin.y + 1.4 + step.y * travelled,
      z: origin.z + step.z * travelled,
    };
    touchAttack(attack, tip);

    // corpo da lanca arrastando atras da ponta
    for (let t = 0; t < 10; t++) {
      try {
        dim.spawnParticle("ulquiorra:oscuras", {
          x: tip.x - step.x * t * 0.45,
          y: tip.y - step.y * t * 0.45,
          z: tip.z - step.z * t * 0.45,
        });
      } catch (e) {}
    }

    const struck = dim
      .getEntities({ location: tip, maxDistance: 2 })
      .some(
        (entity) =>
          entity.id !== player.id && entity.getComponent("minecraft:health")
      );

    travelled += LANZA.speed;
    if (struck || travelled >= LANZA.range) {
      system.clearRun(interval);
      if (isTrueForm(player)) {
        explodeLanzaSecondStage(player, tip);
      } else {
        explodeLanza(player, tip);
      }
    }
  }, 1);
}

/* ---------------------------------------------------------
   Skills do Coyote Starkk
   --------------------------------------------------------- */

function castSlashBarrage(player) {
  if (!tryUseSkill(player, "starkk:slash_barrage")) return;

  world.sendMessage(`§6${player.name} §7usou §eSlash's Barrage§7!`);

  // mesma mecanica do Flash Slash do Kenpachi: cada avanco remira pra onde o
  // player esta olhando na hora e tem sua propria lista de alvos ja atingidos
  let advance = 0;
  const strike = () => {
    advance++;
    try {
      player.dimension.playSound("mob.wither.shoot", player.location, {
        volume: 1,
        pitch: 1.3 + advance * 0.12,
      });
    } catch (e) {
      return; // player saiu do mundo no meio da sequencia
    }

    performDashStrike(player, {
      distance: SLASH_BARRAGE.distancePerAdvance,
      steps: SLASH_BARRAGE.stepsPerAdvance,
      damage: DAMAGE.slashBarrage,
      burst: null,
      onFinish: () => {
        if (advance < SLASH_BARRAGE.advances) {
          system.runTimeout(strike, SLASH_BARRAGE.gapTicks);
        }
      },
    });
  };

  strike();
}

function castSidewayCuts(player) {
  // procura antes de gastar o cooldown
  const target = nearestPlayer(player, SIDEWAY_CUTS.searchRadius);
  if (!target) {
    player.sendMessage("§7Nenhum player por perto pro Sideway Cuts.");
    return;
  }
  if (!tryUseSkill(player, "starkk:sideway_cuts")) return;

  world.sendMessage(`§6${player.name} §7usou §eSideway Cuts§7!`);

  const from = player.location;
  const to = target.location;
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const length = Math.sqrt(dx * dx + dz * dz) || 1;
  // perpendicular a linha atacante-alvo: da os dois lados do alvo
  const perp = { x: -dz / length, z: dx / length };

  const strikeSide = (side) => {
    let spot;
    try {
      const anchor = target.location;
      spot = {
        x: anchor.x + perp.x * SIDEWAY_CUTS.distance * side,
        y: anchor.y,
        z: anchor.z + perp.z * SIDEWAY_CUTS.distance * side,
      };
      player.teleport(spot, { keepVelocity: false, facingLocation: anchor });
      player.dimension.playSound("mob.wither.shoot", spot, {
        volume: 1.2,
        pitch: side > 0 ? 1.2 : 0.9,
      });
    } catch (e) {
      return; // alvo ou player sumiu entre um lado e o outro
    }

    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      try {
        player.dimension.spawnParticle("minecraft:crit_particle", {
          x: spot.x + perp.x * (t - 0.5) * 3 * -side,
          y: spot.y + 0.4 + t * 1.6,
          z: spot.z + perp.z * (t - 0.5) * 3 * -side,
        });
      } catch (e) {}
    }

    damageNearbyEntities(player, spot, SIDEWAY_CUTS.distance + 1.4, DAMAGE.sidewayCuts);
  };

  strikeSide(1);
  system.runTimeout(() => strikeSide(-1), SIDEWAY_CUTS.gapTicks);
}

// um "canino": cresce de raio enquanto avanca e explode no fim do crescimento
function launchCrescentCanine(player, angleRad) {
  const dim = player.dimension;
  const dir = forwardDirection(player);
  // gira a direcao da visao no plano XZ pra abrir o V
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const step = {
    x: dir.x * cos - dir.z * sin,
    z: dir.x * sin + dir.z * cos,
  };
  const origin = player.location;
  const hitEntities = new Set();

  let ticks = 0;
  const interval = system.runInterval(() => {
    ticks++;

    const grow = Math.min(1, ticks / CRESCENT_CANINES.growTicks);
    const radius =
      CRESCENT_CANINES.startRadius +
      (CRESCENT_CANINES.endRadius - CRESCENT_CANINES.startRadius) * grow;
    const travelled = CRESCENT_CANINES.speed * ticks;
    const center = {
      x: origin.x + step.x * travelled,
      y: origin.y + 1.2,
      z: origin.z + step.z * travelled,
    };

    // o canino desenhado como um arco vertical que vai abrindo
    const perp = { x: -step.z, z: step.x };
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const spread = (t - 0.5) * 2 * radius;
      try {
        dim.spawnParticle("grimmjow:cero", {
          x: center.x + perp.x * spread,
          y: center.y + Math.cos(t * Math.PI) * radius * 0.4,
          z: center.z + perp.z * spread,
        });
      } catch (e) {}
    }

    const finalDamage = DAMAGE.crescentCaninesHit * dmgMultiplier(player);
    for (const entity of dim.getEntities({
      location: center,
      maxDistance: radius + 2,
    })) {
      if (entity.id === player.id || hitEntities.has(entity.id)) continue;
      if (!entity.getComponent("minecraft:health")) continue;

      const loc = entity.location;
      const ex = loc.x - center.x;
      const ey = loc.y + 1 - center.y; // meio do corpo, nao os pes
      const ez = loc.z - center.z;
      if (Math.sqrt(ex * ex + ey * ey + ez * ez) > radius + 0.6) continue;

      hitEntities.add(entity.id);
      dealDamage(entity, finalDamage, player);
    }

    if (ticks < CRESCENT_CANINES.growTicks) return;

    system.clearRun(interval);

    // estouro no fim do crescimento
    try {
      dim.playSound("random.explode", center, { volume: 1.5, pitch: 0.8 });
    } catch (e) {}
    for (let ring = 1; ring <= 3; ring++) {
      const ringRadius = (CRESCENT_CANINES.explosionRadius * ring) / 3;
      for (let i = 0; i < 14; i++) {
        const angle = (i / 14) * Math.PI * 2;
        try {
          dim.spawnParticle("minecraft:large_explosion", {
            x: center.x + Math.cos(angle) * ringRadius,
            y: center.y + (ring - 2) * 0.6,
            z: center.z + Math.sin(angle) * ringRadius,
          });
        } catch (e) {}
      }
    }
    damageNearbyEntities(
      player,
      center,
      CRESCENT_CANINES.explosionRadius,
      DAMAGE.crescentCaninesExplosion
    );
  }, 1);
}

function castCrescentCanines(player) {
  if (!tryUseSkill(player, "starkk:crescent_canines")) return;

  world.sendMessage(`§6${player.name} §7usou §eCrescent Canines§7!`);
  player.dimension.playSound("mob.wither.shoot", player.location, {
    volume: 1.4,
    pitch: 0.7,
  });

  // os dois caninos do V, um pra cada lado da direcao da visao
  const angle = (CRESCENT_CANINES.angleDeg * Math.PI) / 180;
  launchCrescentCanine(player, angle);
  launchCrescentCanine(player, -angle);
}

// uma fera guiada: persegue o alvo mais proximo com correcao gradual de rumo e
// explode ao encostar. Os Lobos do Starkk e os Tubaroes da Harribel sao a mesma
// coisa com particula, contagem e dano diferentes.
function summonHomingBeast(player, index, cfg) {
  const dim = player.dimension;
  const dir = forwardDirection(player);
  const perp = { x: -dir.z, z: dir.x };
  const origin = player.location;

  // saem em leque pra nao virar uma bola so
  const spread = (index - (cfg.count - 1) / 2) * 0.6;
  let position = {
    x: origin.x + dir.x * 1.5 + perp.x * spread,
    y: origin.y + 1,
    z: origin.z + dir.z * 1.5 + perp.z * spread,
  };
  let heading = { x: dir.x, y: 0, z: dir.z };

  let ticks = 0;
  const interval = system.runInterval(() => {
    ticks++;

    // mira em qualquer entidade com vida, nao so player
    const target = nearestTarget(player, cfg.searchRadius, position);
    if (target) {
      try {
        const loc = target.location;
        const wx = loc.x - position.x;
        const wy = loc.y + 1 - position.y;
        const wz = loc.z - position.z;
        const want = Math.sqrt(wx * wx + wy * wy + wz * wz) || 1;

        // correcao gradual: o lobo curva rumo ao alvo em vez de virar de uma vez
        heading = {
          x: heading.x + (wx / want - heading.x) * cfg.turnRate,
          y: heading.y + (wy / want - heading.y) * cfg.turnRate,
          z: heading.z + (wz / want - heading.z) * cfg.turnRate,
        };
        const norm =
          Math.sqrt(
            heading.x * heading.x + heading.y * heading.y + heading.z * heading.z
          ) || 1;
        heading = { x: heading.x / norm, y: heading.y / norm, z: heading.z / norm };
      } catch (e) {
        // alvo sumiu: segue reto
      }
    }

    position = {
      x: position.x + heading.x * cfg.speed,
      y: position.y + heading.y * cfg.speed,
      z: position.z + heading.z * cfg.speed,
    };

    for (let i = 0; i < 4; i++) {
      try {
        dim.spawnParticle(cfg.particle, {
          x: position.x + (Math.random() - 0.5) * 0.7,
          y: position.y + (Math.random() - 0.5) * 0.7,
          z: position.z + (Math.random() - 0.5) * 0.7,
        });
      } catch (e) {}
    }

    // explode ao encostar em alguem
    const nearby = dim
      .getEntities({ location: position, maxDistance: cfg.hitRadius })
      .filter(
        (entity) =>
          entity.id !== player.id && entity.getComponent("minecraft:health")
      );

    // a Respira desmancha a fera antes dela chegar a explodir
    const guarded = nearby.find((entity) => isRespiring(entity));
    if (guarded) {
      system.clearRun(interval);
      showRespiraGuard(guarded);
      return;
    }

    if (nearby.length > 0) {
      system.clearRun(interval);
      try {
        dim.playSound("random.explode", position, { volume: 1.2, pitch: 1.3 });
        for (let i = 0; i < 8; i++) {
          dim.spawnParticle("minecraft:large_explosion", {
            x: position.x + (Math.random() - 0.5) * 2,
            y: position.y + (Math.random() - 0.5) * 2,
            z: position.z + (Math.random() - 0.5) * 2,
          });
        }
      } catch (e) {}
      damageNearbyEntities(player, position, cfg.hitRadius, cfg.damage());
      return;
    }

    // sem acertar ninguem a fera se dissipa, sem dano
    if (ticks >= cfg.maxTicks) {
      system.clearRun(interval);
    }
  }, 1);
}

function castKamarada(player) {
  if (!tryUseSkill(player, "starkk:kamarada")) return;

  world.sendMessage(`§6${player.name} §7soltou os §eLobos§7!`);
  player.dimension.playSound("mob.wolf.growl", player.location, {
    volume: 1.5,
    pitch: 0.7,
  });

  for (let i = 0; i < KAMARADA.count; i++) {
    summonHomingBeast(player, i, KAMARADA);
  }
}

/* ---------------------------------------------------------
   Resurrección: Los Lobos (persona Lilynette)
   --------------------------------------------------------- */

function castLilynetteShot(player) {
  // m1 da Lilynette: sem mensagem no chat, o cooldown de 2s ja spamaria
  if (!tryUseSkill(player, "starkk:lilynette_shot")) return;

  player.dimension.playSound("mob.wither.shoot", player.location, {
    volume: 0.9,
    pitch: 1.6,
  });

  fireEnergySphere(player, {
    radius: LILYNETTE_SHOT.radius,
    range: LILYNETTE_SHOT.range,
    speed: LILYNETTE_SHOT.speed,
    damage: DAMAGE.lilynetteShot,
    particle: "grimmjow:cero",
  });
}

function castRifle(player) {
  if (!tryUseSkill(player, "starkk:rifle")) return;

  world.sendMessage(`§9${player.name} §7usou §bRifle§7!`);

  // tres tiros mirados: cada um remira no alvo mais proximo na hora do disparo
  for (let shot = 0; shot < RIFLE.shots; shot++) {
    system.runTimeout(() => {
      let direction;
      try {
        const target = nearestTarget(player, RIFLE.searchRadius);
        if (target) direction = directionToward(player.location, target.location);

        player.dimension.playSound("mob.wither.shoot", player.location, {
          volume: 1,
          pitch: 1.9,
        });
      } catch (e) {
        return; // player saiu do mundo no meio da rajada
      }

      // sem alvo por perto o tiro sai na mira do player
      fireEnergySphere(player, {
        radius: RIFLE.radius,
        range: RIFLE.range,
        speed: RIFLE.speed,
        damage: DAMAGE.lilynetteShot,
        particle: "grimmjow:cero",
        shellParticles: 10,
        direction,
      });
    }, shot * RIFLE.gapTicks + 1);
  }
}

function castEscopeta(player) {
  if (!tryUseSkill(player, "starkk:escopeta")) return;

  world.sendMessage(`§9${player.name} §7usou §bEscopeta§7!`);
  player.dimension.playSound("mob.wither.shoot", player.location, {
    volume: 1.5,
    pitch: 0.8,
  });

  // curto alcance, dobro do dano do disparo comum
  fireEnergySphere(player, {
    radius: ESCOPETA.radius,
    range: ESCOPETA.range,
    speed: ESCOPETA.speed,
    damage: DAMAGE.escopeta,
    particle: "grimmjow:cero",
    shellParticles: 26,
  });
}

function castCeroMetralleta(player) {
  if (!tryUseSkill(player, "starkk:cero_metralleta")) return;
  const dim = player.dimension;

  world.sendMessage(`§9§l${player.name}: CERO METRALLETA!`);
  dim.playSound("mob.wither.death", player.location, { volume: 1.6, pitch: 1.4 });

  // Uma fileira = varias balas saindo lado a lado no mesmo instante. Um disparo
  // e um PENTE de fileiras coladas (4 delas, cada uma um pouco mais alta), e a
  // rajada e uma sequencia desses pentes.
  const fireRow = (rowIndex) => {
    let origin;
    let dir;
    try {
      origin = player.location;
      dir = forwardDirection(player);
      dim.playSound("mob.wither.shoot", origin, { volume: 1.1, pitch: 1.9 });
    } catch (e) {
      return false; // player saiu do mundo no meio da rajada
    }

    const perp = { x: -dir.z, z: dir.x };
    const half = CERO_METRALLETA.rowWidth / 2;
    // fileiras empilhadas em volta da linha de tiro, sem subir o pente inteiro
    const height =
      (rowIndex - (CERO_METRALLETA.rowsPerVolley - 1) / 2) *
      CERO_METRALLETA.rowHeightStep;

    for (let i = 0; i < CERO_METRALLETA.bulletsPerRow; i++) {
      const t =
        CERO_METRALLETA.bulletsPerRow === 1
          ? 0.5
          : i / (CERO_METRALLETA.bulletsPerRow - 1);
      const lateral = -half + t * CERO_METRALLETA.rowWidth;

      fireEnergySphere(player, {
        radius: CERO_METRALLETA.radius,
        range: CERO_METRALLETA.range,
        speed: CERO_METRALLETA.speed,
        damage: DAMAGE.ceroMetralletaBullet,
        particle: "grimmjow:cero",
        shellParticles: 6,
        origin: {
          x: origin.x + perp.x * lateral,
          y: origin.y + height,
          z: origin.z + perp.z * lateral,
        },
      });
    }

    return true;
  };

  // dispara as 4 fileiras do pente com alguns ticks entre elas
  const fireVolley = () => {
    if (!fireRow(0)) return false;
    for (let row = 1; row < CERO_METRALLETA.rowsPerVolley; row++) {
      system.runTimeout(() => fireRow(row), row * CERO_METRALLETA.rowGapTicks);
    }
    return true;
  };

  let volley = 1; // o primeiro pente sai na hora, logo abaixo
  const interval = system.runInterval(() => {
    if (volley >= CERO_METRALLETA.volleys) {
      system.clearRun(interval);
      try {
        player.sendMessage("§7O Cero Metralleta parou.");
      } catch (e) {}
      return;
    }
    volley++;
    if (!fireVolley()) system.clearRun(interval);
  }, CERO_METRALLETA.volleyGapTicks);

  fireVolley();
}

/* ---------------------------------------------------------
   Skills do Yammy Llargo
   --------------------------------------------------------- */

function castPunchesBarrage(player) {
  if (!tryUseSkill(player, "yammy:punches_barrage")) return;

  world.sendMessage(`§c${player.name} §7usou §4Punches Barrage§7!`);

  let punch = 0;
  const throwPunch = () => {
    punch++;
    let origin;
    let dir;
    try {
      origin = player.location;
      dir = forwardDirection(player);
      player.dimension.playSound("random.explode", origin, {
        volume: 1.1,
        pitch: 1.1 + punch * 0.08,
      });
    } catch (e) {
      return; // player saiu do mundo no meio da sequencia
    }

    const impact = {
      x: origin.x + dir.x * (PUNCHES_BARRAGE.forward * 0.6),
      y: origin.y + 1.1,
      z: origin.z + dir.z * (PUNCHES_BARRAGE.forward * 0.6),
    };
    for (let i = 0; i < 6; i++) {
      try {
        player.dimension.spawnParticle("minecraft:large_explosion", {
          x: impact.x + (Math.random() - 0.5) * PUNCHES_BARRAGE.blastRadius,
          y: impact.y + (Math.random() - 0.5) * 1.4,
          z: impact.z + (Math.random() - 0.5) * PUNCHES_BARRAGE.blastRadius,
        });
      } catch (e) {}
    }

    // cada soco tem sua propria caixa: ficar na frente os 5 leva os 5
    const finalDamage = DAMAGE.punchesBarrage * dmgMultiplier(player);
    for (const entity of entitiesInFrontBox(player, PUNCHES_BARRAGE)) {
      dealDamage(entity, finalDamage, player);
    }

    if (punch < PUNCHES_BARRAGE.punches) {
      system.runTimeout(throwPunch, PUNCHES_BARRAGE.gapTicks);
    }
  };

  throwPunch();
}

function castFaceHold(player) {
  // pega qualquer entidade com vida, nao so player
  const victim = nearestTarget(player, FACE_HOLD.searchRadius);
  if (!victim) {
    player.sendMessage("§7Não tem ninguém por perto pra agarrar.");
    return;
  }
  if (!tryUseSkill(player, "yammy:face_hold")) return;

  const victimName = victim.typeId === "minecraft:player" ? victim.name : victim.typeId;
  world.sendMessage(`§c${player.name} §7agarrou §4${victimName}§7 pelo rosto!`);
  try {
    player.dimension.playSound("mob.enderdragon.growl", player.location, {
      volume: 1.4,
      pitch: 0.6,
    });
  } catch (e) {}

  let held = 0;
  const interval = system.runInterval(() => {
    held++;

    let grip;
    try {
      const anchor = player.location;
      const dir = forwardDirection(player);
      // preso na frente do Yammy, na altura do rosto, seguindo a mira dele
      grip = {
        x: anchor.x + dir.x * FACE_HOLD.holdDistance,
        y: anchor.y + 1,
        z: anchor.z + dir.z * FACE_HOLD.holdDistance,
      };
      victim.teleport(grip, { keepVelocity: false, facingLocation: anchor });
      victim.addEffect("slowness", 20, { amplifier: 255, showParticles: false });

      for (let i = 0; i < 3; i++) {
        player.dimension.spawnParticle("yammy:wrath", {
          x: grip.x + (Math.random() - 0.5) * 0.8,
          y: grip.y + 0.6 + Math.random() * 0.6,
          z: grip.z + (Math.random() - 0.5) * 0.8,
        });
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }

    if (held < FACE_HOLD.holdTicks) return;

    system.clearRun(interval);
    launchFaceHold(player, victim, victimName, grip);
  }, 1);
}

// O arremesso NAO pode sair no mesmo tick do ultimo teleport. Num mob isso passa
// porque o servidor manda na posicao dele, mas o player e dono da propria
// posicao: o pacote de teleport (que zera a velocidade) chega depois e engole o
// knockback - por isso o Face Hold so arremessava entidades. Soltamos a lentidao,
// paramos de teleportar e so entao, alguns ticks depois, empurramos.
function launchFaceHold(player, victim, victimName, grip) {
  let dir;
  try {
    dir = forwardDirection(player);
    victim.removeEffect("slowness");
  } catch (e) {
    return; // player ou alvo saiu do mundo enquanto segurava
  }

  system.runTimeout(() => {
    try {
      victim.applyKnockback(
        {
          x: dir.x * FACE_HOLD.launchHorizontal,
          z: dir.z * FACE_HOLD.launchHorizontal,
        },
        FACE_HOLD.launchVertical
      );
    } catch (e) {
      return; // alvo saiu do mundo antes do arremesso
    }
    try {
      player.dimension.playSound("random.explode", grip, { volume: 1.4, pitch: 0.9 });
    } catch (e) {}
    world.sendMessage(`§c${player.name} §7arremessou §4${victimName}§7!`);
  }, FACE_HOLD.launchDelayTicks);
}

function castWrathsSmash(player) {
  if (!tryUseSkill(player, "yammy:wraths_smash")) return;

  world.sendMessage(`§c${player.name} §7usou §4Wrath's Smash§7!`);

  try {
    // pulo bem alto: knockback so na vertical
    player.applyKnockback({ x: 0, z: 0 }, WRATHS_SMASH.jumpStrength);
    player.dimension.playSound("mob.enderdragon.flap", player.location, {
      volume: 1.4,
      pitch: 0.6,
    });
  } catch (e) {
    return;
  }

  // espera voltar pro chao (ou desiste depois de maxAirTicks)
  let airTicks = 0;
  const falling = system.runInterval(() => {
    airTicks++;

    let landed = false;
    try {
      landed = airTicks > 10 && player.isOnGround;
    } catch (e) {
      system.clearRun(falling);
      return;
    }

    if (!landed && airTicks < WRATHS_SMASH.maxAirTicks) return;

    system.clearRun(falling);
    smashShockwave(player);
  }, 1);
}

// ondas de explosao que vao crescendo a partir do ponto de impacto
function smashShockwave(player) {
  let impact;
  try {
    impact = player.location;
    player.dimension.playSound("random.explode", impact, { volume: 2, pitch: 0.5 });
  } catch (e) {
    return;
  }

  for (let ring = 1; ring <= WRATHS_SMASH.rings; ring++) {
    system.runTimeout(() => {
      const radius = (WRATHS_SMASH.maxRadius * ring) / WRATHS_SMASH.rings;
      try {
        const points = 10 + ring * 6;
        for (let i = 0; i < points; i++) {
          const angle = (i / points) * Math.PI * 2;
          player.dimension.spawnParticle("minecraft:large_explosion", {
            x: impact.x + Math.cos(angle) * radius,
            y: impact.y + 0.4,
            z: impact.z + Math.sin(angle) * radius,
          });
        }
        player.dimension.playSound("random.explode", impact, {
          volume: 1.4,
          pitch: 1.1 - ring * 0.15,
        });
      } catch (e) {
        return;
      }

      // cada onda bate em quem estiver dentro dela: quem fica no centro come todas
      damageNearbyEntities(player, impact, radius, DAMAGE.wrathsSmash);
    }, (ring - 1) * WRATHS_SMASH.ringGapTicks + 1);
  }
}

function castWrathsPunch(player) {
  if (!tryUseSkill(player, "yammy:wraths_punch")) return;

  world.sendMessage(`§c§l${player.name}: WRATH'S PUNCH!`);
  try {
    player.dimension.playSound("random.explode", player.location, {
      volume: 2,
      pitch: 0.4,
    });
  } catch (e) {}

  drawSweep(player, WRATHS_PUNCH, "yammy:wrath", false);

  const dir = forwardDirection(player);
  const finalDamage = DAMAGE.wrathsPunch * dmgMultiplier(player);
  for (const entity of entitiesInFrontBox(player, WRATHS_PUNCH)) {
    dealDamage(entity, finalDamage, player);
    try {
      entity.applyKnockback(
        {
          x: dir.x * WRATHS_PUNCH.knockbackHorizontal,
          z: dir.z * WRATHS_PUNCH.knockbackHorizontal,
        },
        WRATHS_PUNCH.knockbackVertical
      );
    } catch (e) {}
  }
}

/* ---------------------------------------------------------
   Resurrección: Ira
   --------------------------------------------------------- */

function castQuebramundos(player) {
  if (!tryUseSkill(player, "yammy:quebramundos")) return;

  world.sendMessage(`§4§l${player.name}: QUEBRAMUNDOS!`);

  let impact;
  try {
    impact = player.location;
    player.dimension.playSound("mob.wither.death", impact, { volume: 2, pitch: 0.2 });
  } catch (e) {
    return;
  }

  // a maior explosao do addon ate agora, acima da Lanza del Relampago
  for (let ring = 1; ring <= 7; ring++) {
    const radius = (QUEBRAMUNDOS.blastRadius * ring) / 7;
    const points = 14 + ring * 6;
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2;
      for (const height of [0.3, 2.5, 5]) {
        try {
          player.dimension.spawnParticle(
            ring > 5 ? "yammy:wrath" : "minecraft:large_explosion",
            {
              x: impact.x + Math.cos(angle) * radius,
              y: impact.y + height,
              z: impact.z + Math.sin(angle) * radius,
            }
          );
        } catch (e) {}
      }
    }
  }

  damageNearbyEntities(player, impact, QUEBRAMUNDOS.blastRadius, DAMAGE.quebramundos);
}

function castCeroBarrage(player) {
  if (!tryUseSkill(player, "yammy:cero_barrage")) return;

  world.sendMessage(`§4${player.name} §7disparou uma §cbarragem de Gran Rey Ceros§7!`);

  for (let shot = 0; shot < CERO_BARRAGE.shots; shot++) {
    system.runTimeout(() => {
      try {
        player.dimension.playSound("mob.wither.death", player.location, {
          volume: 1.3,
          pitch: 0.6,
        });
      } catch (e) {
        return; // player saiu do mundo no meio da barragem
      }

      // o mesmo Gran Rey Cero, dez vezes seguidas
      fireEnergySphere(player, {
        radius: GRAN_REY_CERO.radius,
        range: GRAN_REY_CERO.range,
        speed: GRAN_REY_CERO.speed,
        damage: DAMAGE.granReyCero,
      });
    }, shot * CERO_BARRAGE.gapTicks + 1);
  }
}

function castRugidoDiablo(player) {
  if (!tryUseSkill(player, "yammy:rugido_diablo")) return;

  world.sendMessage(`§4§l${player.name} rugiu!`);
  try {
    player.dimension.playSound("mob.enderdragon.growl", player.location, {
      volume: 2,
      pitch: 0.3,
    });
  } catch (e) {}

  let ticks = 0;
  const interval = system.runInterval(() => {
    ticks++;

    let center;
    try {
      center = player.location;
    } catch (e) {
      system.clearRun(interval);
      return;
    }

    if (ticks % 4 === 1) {
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        const dist = RUGIDO_DIABLO.radius * (0.3 + Math.random() * 0.7);
        try {
          player.dimension.spawnParticle("yammy:wrath", {
            x: center.x + Math.cos(angle) * dist,
            y: center.y + 0.5 + Math.random() * 3,
            z: center.z + Math.sin(angle) * dist,
          });
        } catch (e) {}
      }
    }

    damageNearbyEntities(player, center, RUGIDO_DIABLO.radius, DAMAGE.rugidoDiabloTick);

    if (ticks >= RUGIDO_DIABLO.durationTicks) {
      system.clearRun(interval);
    }
  }, 1);
}

/* ---------------------------------------------------------
   Skills da Tier Harribel
   --------------------------------------------------------- */

// alvo NA MIRA (nao o mais proximo): a Water Prison, o Vortice e a Maldita Agua
// escolhem quem o player esta olhando
function targetInView(player, range) {
  try {
    return player
      .getEntitiesFromViewDirection({ maxDistance: range })
      .map((hit) => hit.entity)
      .find(
        (entity) =>
          entity && entity.id !== player.id && entity.getComponent("minecraft:health")
      );
  } catch (e) {
    return undefined;
  }
}

function nameOf(entity) {
  try {
    return entity.typeId === "minecraft:player" ? entity.name : entity.typeId === "multiversal:training_dummy" ? "Boneco de Teste" : entity.typeId;
  } catch (e) {
    return "alguém";
  }
}

function castTiburonSlash(player) {
  if (!tryUseSkill(player, "harribel:tiburon_slash")) return;

  world.sendMessage(`§b${player.name} §7usou §3Tiburon's Slash§7!`);
  try {
    player.dimension.playSound("mob.guardian.attack_loop", player.location, {
      volume: 1.3,
      pitch: 1.2,
    });
  } catch (e) {}

  // mesma onda crescente do Getsuga, so que DEITADA: o arco abre pros lados
  fireCrescentWave(player, {
    radius: TIBURON_SLASH.radius,
    thickness: TIBURON_SLASH.thickness,
    range: TIBURON_SLASH.range,
    speed: TIBURON_SLASH.speed,
    damage: DAMAGE.tiburonSlash,
    particle: "harribel:agua",
    burst: "harribel:agua",
    horizontal: true,
  });
}

function castSharkIssues(player) {
  if (!tryUseSkill(player, "harribel:shark_issues")) return;

  world.sendMessage(`§b${player.name} §7soltou os §3Tubarões§7!`);
  try {
    player.dimension.playSound(SHARK_ISSUES.summonSound, player.location, {
      volume: 1.4,
      pitch: 0.8,
    });
  } catch (e) {}

  // mesma fera guiada dos Lobos do Starkk, com agua no lugar do cero
  for (let i = 0; i < SHARK_ISSUES.count; i++) {
    summonHomingBeast(player, i, SHARK_ISSUES);
  }
}

// apaga a agua e devolve o que estava no lugar. Roda tambem quando o alvo morre
// no meio da prisao: a cela nao pode ficar de pe pra sempre.
function releaseWaterPrison(victim, placed) {
  for (const entry of placed) {
    try {
      entry.block.setPermutation(entry.was);
    } catch (e) {}
  }
  try {
    victim.removeEffect("slowness");
    victim.dimension.playSound("random.splash", victim.location, {
      volume: 1,
      pitch: 1.4,
    });
  } catch (e) {}
}

function castWaterPrison(player) {
  const victim = targetInView(player, WATER_PRISON.range);
  if (!victim) {
    player.sendMessage("§7Você não está olhando pra ninguém.");
    return;
  }
  if (!tryUseSkill(player, "harribel:water_prison")) return;

  const dim = player.dimension;
  const loc0 = victim.location;
  // centro do bloco em que o alvo esta, pra cela nascer alinhada
  const anchor = {
    x: Math.floor(loc0.x) + 0.5,
    y: Math.floor(loc0.y),
    z: Math.floor(loc0.z) + 0.5,
  };

  // guarda o que estava ali pra devolver quando a cela abrir
  const placed = [];
  const water = BlockPermutation.resolve("minecraft:water");
  const r = WATER_PRISON.radius;
  for (let dx = -r; dx <= r; dx++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dy = 0; dy <= 2 * r; dy++) {
        try {
          const block = dim.getBlock({
            x: anchor.x + dx,
            y: anchor.y + dy,
            z: anchor.z + dz,
          });
          if (!block) continue;
          placed.push({ block, was: block.permutation });
          block.setPermutation(water);
        } catch (e) {
          // chunk descarregado: pula esse bloco em vez de derrubar a skill
        }
      }
    }
  }

  const victimName = nameOf(victim);
  world.sendMessage(
    `§b${player.name} §7prendeu §3${victimName}§7 numa §3Water Prison§7!`
  );
  try {
    dim.playSound("random.splash", anchor, { volume: 1.3, pitch: 0.8 });
  } catch (e) {}

  let elapsed = 0;
  const interval = system.runInterval(() => {
    elapsed++;

    let up = true;
    try {
      // travado: lentidao no maximo e puxao de volta se tentar andar pra fora
      victim.addEffect("slowness", 40, { amplifier: 255, showParticles: false });
      const loc = victim.location;
      const drift = Math.sqrt(
        (loc.x - anchor.x) * (loc.x - anchor.x) + (loc.z - anchor.z) * (loc.z - anchor.z)
      );
      if (drift > WATER_PRISON.leash) {
        victim.teleport({ x: anchor.x, y: loc.y, z: anchor.z }, { keepVelocity: false });
      }

      for (let i = 0; i < 3; i++) {
        dim.spawnParticle("harribel:agua", {
          x: anchor.x + (Math.random() - 0.5) * 2,
          y: anchor.y + Math.random() * 3,
          z: anchor.z + (Math.random() - 0.5) * 2,
        });
      }
    } catch (e) {
      up = false; // alvo morreu ou saiu do mundo
    }

    if (up && elapsed < WATER_PRISON.durationTicks) return;

    system.clearRun(interval);
    releaseWaterPrison(victim, placed);
    world.sendMessage(`§7A Water Prison se abriu e soltou §3${victimName}§7.`);
  }, 1);
}

function castAquasDash(player) {
  if (!tryUseSkill(player, "harribel:aquas_dash")) return;

  world.sendMessage(`§b${player.name} §7usou §3Aqua's Dash§7!`);
  try {
    player.dimension.playSound("random.splash", player.location, {
      volume: 1.3,
      pitch: 1.3,
    });
  } catch (e) {}

  performDashStrike(player, {
    distance: AQUAS_DASH.distance,
    steps: AQUAS_DASH.steps,
    damage: DAMAGE.aquasDash,
    particle: "harribel:agua",
    burst: "harribel:agua",
  });
}

/* ---------------------------------------------------------
   Resurrección: Tiburón
   --------------------------------------------------------- */

function castTsunami(player) {
  if (!tryUseSkill(player, "harribel:tsunami")) return;

  const dim = player.dimension;
  world.sendMessage(`§b§l${player.name}: TSUNAMI!`);
  try {
    dim.playSound("ambient.weather.rain", player.location, { volume: 1.6, pitch: 0.6 });
  } catch (e) {}

  const origin = player.location;
  const dir = forwardDirection(player);
  const perp = { x: -dir.z, z: dir.x };
  const half = TSUNAMI.width / 2;
  const hitEntities = new Set();

  let travelled = 0;
  const attack = trackAttack(player, half);
  const interval = system.runInterval(() => {
    if (attack.cancelled) {
      system.clearRun(interval);
      return;
    }
    touchAttack(attack, { x: origin.x + dir.x * travelled, y: origin.y + 1, z: origin.z + dir.z * travelled });
    // parede de agua avancando. Sao SO particulas: a onda passa e nao deixa
    // bloco de agua nenhum pra tras, como o pedido pede.
    for (let c = -half; c <= half; c += 1.5) {
      for (let h = 0; h < TSUNAMI.height; h += 1.2) {
        try {
          dim.spawnParticle("harribel:agua", {
            x: origin.x + dir.x * travelled + perp.x * c,
            y: origin.y + h,
            z: origin.z + dir.z * travelled + perp.z * c,
          });
        } catch (e) {}
      }
    }

    const center = {
      x: origin.x + dir.x * travelled,
      y: origin.y + 1,
      z: origin.z + dir.z * travelled,
    };
    const finalDamage = DAMAGE.tsunami * dmgMultiplier(player);

    for (const entity of dim.getEntities({ location: center, maxDistance: TSUNAMI.width })) {
      if (entity.id === player.id || hitEntities.has(entity.id)) continue;
      if (!entity.getComponent("minecraft:health")) continue;

      const loc = entity.location;
      const dx = loc.x - center.x;
      const dz = loc.z - center.z;
      const along = dx * dir.x + dz * dir.z; // profundidade dentro da onda
      const lateral = dx * perp.x + dz * perp.z; // posicao na largura
      const height = loc.y - origin.y;
      if (Math.abs(along) > TSUNAMI.speed + 1) continue;
      if (Math.abs(lateral) > half) continue;
      if (height > TSUNAMI.height || height < -3) continue;

      hitEntities.add(entity.id);
      dealDamage(entity, finalDamage, player);
      try {
        entity.applyKnockback(
          {
            x: dir.x * TSUNAMI.knockbackHorizontal,
            z: dir.z * TSUNAMI.knockbackHorizontal,
          },
          TSUNAMI.knockbackVertical
        );
      } catch (e) {}
    }

    travelled += TSUNAMI.speed;
    if (travelled >= TSUNAMI.range) {
      system.clearRun(interval);
      try {
        player.sendMessage("§7A onda passou. §8(a água não fica)");
      } catch (e) {}
    }
  }, 1);
}

function castVortice(player) {
  const victim = targetInView(player, VORTICE.range);
  if (!victim) {
    player.sendMessage("§7Você não está olhando pra ninguém.");
    return;
  }
  if (!tryUseSkill(player, "harribel:vortice")) return;

  const dim = player.dimension;
  const center = { ...victim.location };

  world.sendMessage(
    `§b${player.name} §7abriu um §3Vórtice de Agua §7em volta de §3${nameOf(victim)}§7!`
  );
  try {
    dim.playSound("mob.elderguardian.curse", center, { volume: 1.5, pitch: 0.7 });
  } catch (e) {}

  let elapsed = 0;
  const interval = system.runInterval(() => {
    elapsed++;

    // funil: aneis de agua girando, mais apertados quanto mais alto
    for (let ring = 0; ring < 4; ring++) {
      const radius = VORTICE.radius * (1 - ring * 0.18);
      for (let i = 0; i < 8; i++) {
        const angle = (i / 8) * Math.PI * 2 + elapsed * VORTICE.spinSpeed;
        try {
          dim.spawnParticle("harribel:agua", {
            x: center.x + Math.cos(angle) * radius,
            y: center.y + ring * 1.4,
            z: center.z + Math.sin(angle) * radius,
          });
        } catch (e) {}
      }
    }

    // gira de verdade quem esta dentro: cada um orbita o centro do vortice
    for (const entity of dim.getEntities({ location: center, maxDistance: VORTICE.radius })) {
      if (entity.id === player.id) continue;
      try {
        if (!entity.getComponent("minecraft:health")) continue;
        const loc = entity.location;
        const dx = loc.x - center.x;
        const dz = loc.z - center.z;
        const angle = Math.atan2(dz, dx) + VORTICE.spinSpeed;
        const orbit = Math.max(VORTICE.minOrbit, Math.sqrt(dx * dx + dz * dz));
        entity.teleport(
          {
            x: center.x + Math.cos(angle) * orbit,
            y: loc.y,
            z: center.z + Math.sin(angle) * orbit,
          },
          { keepVelocity: false }
        );
      } catch (e) {
        // entidade saiu do mundo no meio do giro
      }
    }

    // 200 por SEGUNDO, nao por tick
    if (elapsed % VORTICE.tickInterval === 0) {
      damageNearbyEntities(player, center, VORTICE.radius, DAMAGE.vorticePerSecond);
    }

    if (elapsed >= VORTICE.durationTicks) {
      system.clearRun(interval);
      try {
        player.sendMessage("§7O vórtice se desfez.");
      } catch (e) {}
    }
  }, 1);
}

/* ---------------------------------------------------------
   Maldita Água: a unica skill sem prazo. So acaba quando a
   Harribel morre, troca de personagem ou sai do mundo, ou
   quando o proprio alvo cai.
   --------------------------------------------------------- */

const activeCurses = [];

function removeCursesBy(ownerId) {
  for (let i = activeCurses.length - 1; i >= 0; i--) {
    if (activeCurses[i].ownerId !== ownerId) continue;
    system.clearRun(activeCurses[i].intervalId);
    activeCurses.splice(i, 1);
  }
}

function isCurseOwnerUp(player) {
  try {
    if (getActiveCharacter(player)?.id !== "harribel") return false;
    const hp = player.getComponent("minecraft:health");
    return !!hp && hp.currentValue > 0;
  } catch (e) {
    return false; // saiu do mundo
  }
}

function endMalditaAgua(ownerId, message) {
  removeCursesBy(ownerId);
  world.sendMessage(message);
}

function castMalditaAgua(player) {
  const victim = targetInView(player, MALDITA_AGUA.range);
  if (!victim) {
    player.sendMessage("§7Você não está olhando pra ninguém.");
    return;
  }
  if (!tryUseSkill(player, "harribel:maldita_agua")) return;

  const ownerId = player.id;
  const victimName = nameOf(victim);

  world.sendMessage(
    `§b§l${player.name} amaldiçoou ${victimName}: §r§9ficou sem respirar§7.`
  );
  try {
    player.dimension.playSound("mob.elderguardian.curse", player.location, {
      volume: 1.4,
      pitch: 0.5,
    });
  } catch (e) {}

  const intervalId = system.runInterval(() => {
    if (!isCurseOwnerUp(player)) {
      endMalditaAgua(ownerId, `§7A maldição sobre §3${victimName}§7 se desfez.`);
      return;
    }

    try {
      const hp = victim.getComponent("minecraft:health");
      if (!hp || hp.currentValue <= 0) {
        endMalditaAgua(ownerId, `§3${victimName}§7 se afogou. A maldição acabou.`);
        return;
      }

      dealDamage(victim, DAMAGE.malditaAguaPerSecond * dmgMultiplier(player), player);

      const loc = victim.location;
      for (let i = 0; i < 6; i++) {
        victim.dimension.spawnParticle("harribel:agua", {
          x: loc.x + (Math.random() - 0.5) * 0.9,
          y: loc.y + 1.5 + Math.random() * 0.7,
          z: loc.z + (Math.random() - 0.5) * 0.9,
        });
      }
    } catch (e) {
      endMalditaAgua(ownerId, `§7A maldição sobre §3${victimName}§7 se desfez.`);
    }
  }, MALDITA_AGUA.tickInterval);

  activeCurses.push({ ownerId, intervalId });
}

/* ---------------------------------------------------------
   Skills do Barragan Louisenbairn
   --------------------------------------------------------- */

// enterra o alvo: afunda no chao e prende por 2s
function buryTarget(player, victim) {
  try {
    const loc = victim.location;
    victim.teleport(
      { x: loc.x, y: loc.y - ARROGANTE_SLASH.buryDepth, z: loc.z },
      { keepVelocity: false }
    );
    victim.addEffect("slowness", ARROGANTE_SLASH.buryTicks, {
      amplifier: 255,
      showParticles: false,
    });
    for (let i = 0; i < 10; i++) {
      player.dimension.spawnParticle("barragan:podridao", {
        x: loc.x + (Math.random() - 0.5) * 1.8,
        y: loc.y + Math.random() * 0.7,
        z: loc.z + (Math.random() - 0.5) * 1.8,
      });
    }
    player.dimension.playSound("dig.gravel", loc, { volume: 1.2, pitch: 0.6 });
  } catch (e) {
    // alvo saiu do mundo entre o corte e o enterro
  }
}

function castArroganteSlash(player) {
  if (!tryUseSkill(player, "barragan:arrogante_slash")) return;

  world.sendMessage(`§8${player.name} §7usou §5Arrogante's Slash§7!`);
  try {
    player.dimension.playSound("mob.wither.shoot", player.location, {
      volume: 1.3,
      pitch: 0.6,
    });
  } catch (e) {}

  for (let cut = 0; cut < ARROGANTE_SLASH.cuts; cut++) {
    system.runTimeout(() => {
      let victims;
      try {
        // alterna deitado/em pe pra ler como tres cortes, nao um so repetido
        drawSweep(player, ARROGANTE_SLASH, "barragan:podridao", cut % 2 === 0);
        victims = entitiesInFrontBox(player, ARROGANTE_SLASH);
      } catch (e) {
        return; // player saiu do mundo entre os cortes
      }

      const finalDamage = DAMAGE.arroganteSlash * dmgMultiplier(player);
      for (const victim of victims) dealDamage(victim, finalDamage, player);

      // o ultimo corte e o que enterra quem sobrou
      if (cut === ARROGANTE_SLASH.cuts - 1) {
        for (const victim of victims) buryTarget(player, victim);
      }
    }, cut * ARROGANTE_SLASH.gapTicks);
  }
}

function castElReiOco(player) {
  if (!tryUseSkill(player, "barragan:el_rei_oco")) return;

  world.sendMessage(`§8${player.name} §7usou §cEl Rei Oco§7!`);

  // um anel de ceros saindo pros 8 lados de uma vez, repetido 5 vezes
  const fireRing = () => {
    try {
      player.dimension.playSound("mob.wither.shoot", player.location, {
        volume: 1.2,
        pitch: 1.1,
      });
    } catch (e) {
      return false; // player saiu do mundo no meio da rajada
    }

    for (let i = 0; i < EL_REI_OCO.directions; i++) {
      const angle = (i / EL_REI_OCO.directions) * Math.PI * 2;
      fireEnergySphere(player, {
        radius: EL_REI_OCO.radius,
        range: EL_REI_OCO.range,
        speed: EL_REI_OCO.speed,
        damage: DAMAGE.elReiOco,
        particle: "barragan:cero_rojo",
        shellParticles: 10,
        direction: { x: Math.cos(angle), y: 0, z: Math.sin(angle) },
      });
    }
    return true;
  };

  let volley = 1; // o primeiro anel sai na hora, logo abaixo
  const interval = system.runInterval(() => {
    if (volley >= EL_REI_OCO.volleys) {
      system.clearRun(interval);
      return;
    }
    volley++;
    if (!fireRing()) system.clearRun(interval);
  }, EL_REI_OCO.gapTicks);

  fireRing();
}

function castRoyalCleave(player) {
  if (!tryUseSkill(player, "barragan:royal_cleave")) return;

  world.sendMessage(`§8${player.name}: §5§lROYAL CLEAVE! §r§7(passa pela guarda)`);
  try {
    player.dimension.playSound("mob.wither.death", player.location, {
      volume: 1.4,
      pitch: 0.7,
    });
  } catch (e) {}

  drawSweep(player, ROYAL_CLEAVE, "barragan:podridao", true);

  const finalDamage = DAMAGE.royalCleave * dmgMultiplier(player);
  for (const victim of entitiesInFrontBox(player, ROYAL_CLEAVE)) {
    // o unico golpe da addon que passa direto pelo bloqueio
    dealDamage(victim, finalDamage, player, { breaksBlock: true });
  }
}

function castWithersSlashes(player) {
  if (!tryUseSkill(player, "barragan:withers_slashes")) return;

  world.sendMessage(`§8${player.name} §7usou §2Wither's Slashes§7!`);
  try {
    player.dimension.playSound("mob.wither.ambient", player.location, {
      volume: 1.3,
      pitch: 0.8,
    });
  } catch (e) {}

  drawSweep(player, WITHERS_SLASHES, "barragan:podridao", false);

  const finalDamage = DAMAGE.withersSlashesCut * dmgMultiplier(player);
  for (const victim of entitiesInFrontBox(player, WITHERS_SLASHES)) {
    dealDamage(victim, finalDamage, player);
    applyDeterioration(victim, player, DAMAGE.deterioration, WITHERS_SLASHES.seconds);
  }
}

/* ---------------------------------------------------------
   Resurrección: Arrogante
   --------------------------------------------------------- */

function castRuirDelRey(player) {
  if (!tryUseSkill(player, "barragan:ruir_del_rey")) return;

  const dim = player.dimension;
  const center = player.location;

  world.sendMessage(`§8§l${player.name}: RUIR DEL REY!`);
  try {
    dim.playSound("mob.wither.spawn", center, { volume: 1.6, pitch: 0.5 });
  } catch (e) {}

  // onda de velhice saindo do rei: pura deterioracao, sem golpe
  for (let i = 0; i < 40; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = RUIR_DEL_REY.radius * Math.sqrt(Math.random());
    try {
      dim.spawnParticle("barragan:podridao", {
        x: center.x + Math.cos(angle) * dist,
        y: center.y + 0.2 + Math.random() * 3,
        z: center.z + Math.sin(angle) * dist,
      });
    } catch (e) {}
  }

  for (const victim of dim.getEntities({
    location: center,
    maxDistance: RUIR_DEL_REY.radius,
  })) {
    if (victim.id === player.id) continue;
    if (!victim.getComponent("minecraft:health")) continue;
    applyDeterioration(victim, player, DAMAGE.deterioration, RUIR_DEL_REY.seconds);
  }
}

function castRespira(player) {
  if (!tryUseSkill(player, "barragan:respira")) return;

  player.setDynamicProperty(DP.respiraEnd, system.currentTick + RESPIRA.durationTicks);

  world.sendMessage(
    `§8${player.name} §7soltou a §8§lRespira§r§7: cero e ataque de longe não chegam nele por ${
      RESPIRA.durationTicks / 20
    }s.`
  );
  try {
    player.dimension.playSound("mob.wither.ambient", player.location, {
      volume: 1.5,
      pitch: 0.4,
    });
  } catch (e) {}
}

function castElMaldito(player) {
  if (!tryUseSkill(player, "barragan:el_maldito")) return;

  world.sendMessage(`§8§l${player.name} soltou o El Maldito!`);
  try {
    player.dimension.playSound("mob.wither.spawn", player.location, {
      volume: 1.8,
      pitch: 0.4,
    });
  } catch (e) {}

  // mesma neblina generica da Konjiki do Mayuri, com cegueira e deterioracao
  // no lugar do veneno
  spawnPoisonCloud(player, EL_MALDITO);
}

function castLaMuerte(player) {
  if (!tryUseSkill(player, "barragan:la_muerte")) return;

  player.setDynamicProperty(DP.muerteArmed, true);

  world.sendMessage(
    `§8§l${player.name}: La Muerte! §r§7O primeiro que ele encostar apodrece por ${LA_MUERTE.seconds}s.`
  );
  try {
    player.dimension.playSound("mob.wither.death", player.location, {
      volume: 1.4,
      pitch: 0.4,
    });
  } catch (e) {}
}

// disparado no m1: gasta a carga no PRIMEIRO alvo tocado
function tryLaMuerteTouch(player, victim) {
  if (!player.getDynamicProperty(DP.muerteArmed)) return;
  try {
    // o m1 pode ter matado o alvo neste mesmo tick: ai ele ja e invalido
    if (!victim.getComponent("minecraft:health")) return;
  } catch (e) {
    return;
  }

  player.setDynamicProperty(DP.muerteArmed, false);
  applyDeterioration(victim, player, DAMAGE.deterioration, LA_MUERTE.seconds);
  world.sendMessage(
    `§8${nameOf(victim)} §7foi tocado por §5La Muerte§7 e começou a apodrecer.`
  );
}

/* ---------------------------------------------------------
   Skills do Szayelaporro Granz
   --------------------------------------------------------- */

// dano do m1 QUE O ALVO usaria: a Carbon-Copy devolve o golpe dele nele mesmo
function m1DamageOf(entity) {
  try {
    const character = getActiveCharacter(entity);
    if (!character) return CARBON_COPY.fallbackDamage;

    const items = getActiveItemsForPlayer(entity, character);
    const weapon = MELEE_WEAPONS[items[0]];
    return weapon ? weapon.baseDamage : CARBON_COPY.fallbackDamage;
  } catch (e) {
    return CARBON_COPY.fallbackDamage; // nao e player ou saiu do mundo
  }
}

function castRushAndPierce(player) {
  const victim = nearestTarget(player, RUSH_AND_PIERCE.searchRadius);
  if (!victim) {
    player.sendMessage("§7Não tem ninguém por perto pra perfurar.");
    return;
  }
  if (!tryUseSkill(player, "szayel:rush_and_pierce")) return;

  world.sendMessage(`§d${player.name} §7usou §5Rush and Pierce§7!`);
  try {
    player.dimension.playSound("mob.enderdragon.flap", player.location, {
      volume: 1.1,
      pitch: 1.7,
    });
  } catch (e) {}

  // teleguiado: a cada passo o rumo e recalculado pro alvo, entao ele nao
  // escapa desviando no meio do avanco
  let step = 0;
  const interval = system.runInterval(() => {
    step++;

    let arrived = false;
    try {
      const from = player.location;
      const to = victim.location;
      const dir = directionToward(from, to);
      const gap = Math.sqrt(
        (to.x - from.x) * (to.x - from.x) + (to.z - from.z) * (to.z - from.z)
      );
      const advance = Math.min(gap - 1.2, gap / (RUSH_AND_PIERCE.steps - step + 1));

      if (advance > 0.05) {
        player.teleport(
          { x: from.x + dir.x * advance, y: from.y, z: from.z + dir.z * advance },
          { keepVelocity: false, facingLocation: to }
        );
      }

      for (let i = 0; i < 4; i++) {
        player.dimension.spawnParticle("szayel:esporo", {
          x: from.x + (Math.random() - 0.5) * 0.9,
          y: from.y + 0.8 + Math.random() * 0.9,
          z: from.z + (Math.random() - 0.5) * 0.9,
        });
      }

      arrived = gap <= RUSH_AND_PIERCE.hitRadius;
    } catch (e) {
      system.clearRun(interval); // player ou alvo saiu do mundo
      return;
    }

    if (!arrived && step < RUSH_AND_PIERCE.steps) return;

    system.clearRun(interval);

    // certeiro: chegou perto ou acabaram os passos, o golpe sai de qualquer jeito
    try {
      dealDamage(victim, DAMAGE.rushAndPierce * dmgMultiplier(player), player);
      player.dimension.playSound("random.anvil_land", victim.location, {
        volume: 1.1,
        pitch: 1.6,
      });
    } catch (e) {}
  }, 1);
}

function castAscendentCut(player) {
  if (!tryUseSkill(player, "szayel:ascendent_cut")) return;

  world.sendMessage(`§d${player.name} §7usou §5Ascendent Cut§7!`);
  try {
    player.dimension.playSound("mob.wither.shoot", player.location, {
      volume: 1.1,
      pitch: 1.6,
    });
  } catch (e) {}

  // mesma onda crescente do Getsuga, em pe e comprida
  fireCrescentWave(player, {
    radius: ASCENDENT_CUT.radius,
    thickness: ASCENDENT_CUT.thickness,
    range: ASCENDENT_CUT.range,
    speed: ASCENDENT_CUT.speed,
    damage: DAMAGE.ascendentCut,
    particle: "szayel:esporo",
    burst: "szayel:esporo",
  });

  // ascendente: quem for pego sobe junto com o corte
  system.runTimeout(() => {
    try {
      for (const victim of player.dimension.getEntities({
        location: player.location,
        maxDistance: ASCENDENT_CUT.range,
      })) {
        if (victim.id === player.id) continue;
        if (!victim.getComponent("minecraft:health")) continue;
        victim.applyKnockback({ x: 0, z: 0 }, ASCENDENT_CUT.lift);
      }
    } catch (e) {}
  }, 2);
}

// A copia nao e uma entidade: o Bedrock nao deixa spawnar um player, entao ela e
// um fantasma desenhado com particula que persegue o alvo e devolve o m1 DELE
// nele mesmo.
function castCarbonCopy(player) {
  const victim = targetInView(player, CARBON_COPY.searchRadius) ??
    nearestTarget(player, CARBON_COPY.searchRadius);
  if (!victim) {
    player.sendMessage("§7Não tem ninguém por perto pra copiar.");
    return;
  }
  if (!tryUseSkill(player, "szayel:carbon_copy")) return;

  const victimName = nameOf(victim);
  const copyDamage = m1DamageOf(victim);

  world.sendMessage(
    `§d${player.name} §7fez uma §5Carbon-Copy §7de §5${victimName}§7 (${copyDamage} por golpe).`
  );
  try {
    player.dimension.playSound("mob.slime.big", player.location, {
      volume: 1.1,
      pitch: 1.4,
    });
  } catch (e) {}

  let position;
  try {
    const start = victim.location;
    position = { x: start.x + 2, y: start.y, z: start.z + 2 };
  } catch (e) {
    return;
  }

  let ticks = 0;
  let sinceStrike = 0;
  const interval = system.runInterval(() => {
    ticks++;
    sinceStrike++;

    try {
      const target = victim.location;
      const dir = directionToward(position, target);
      const gap = Math.sqrt(
        (target.x - position.x) * (target.x - position.x) +
          (target.z - position.z) * (target.z - position.z)
      );

      if (gap > CARBON_COPY.hitRadius) {
        position = {
          x: position.x + dir.x * CARBON_COPY.speed,
          y: target.y,
          z: position.z + dir.z * CARBON_COPY.speed,
        };
      }

      // silhueta: uma coluna de particulas do tamanho de um player
      for (let i = 0; i < 6; i++) {
        player.dimension.spawnParticle("szayel:esporo", {
          x: position.x + (Math.random() - 0.5) * 0.7,
          y: position.y + (i / 6) * 1.9,
          z: position.z + (Math.random() - 0.5) * 0.7,
        });
      }

      if (gap <= CARBON_COPY.hitRadius && sinceStrike >= CARBON_COPY.strikeIntervalTicks) {
        sinceStrike = 0;
        dealDamage(victim, copyDamage * dmgMultiplier(player), player);
        player.dimension.playSound("game.player.attack.strong", position, {
          volume: 0.9,
          pitch: 1.3,
        });
      }
    } catch (e) {
      system.clearRun(interval); // alvo morreu ou saiu do mundo
      return;
    }

    if (ticks >= CARBON_COPY.durationTicks) {
      system.clearRun(interval);
      try {
        player.sendMessage(`§7A cópia de §5${victimName}§7 se desfez.`);
      } catch (e) {}
    }
  }, 1);
}

function castLearnAndAdapt(player) {
  const victim = targetInView(player, LEARN_AND_ADAPT.range);
  if (!victim) {
    player.sendMessage("§7Você não está olhando pra ninguém.");
    return;
  }
  if (!tryUseSkill(player, "szayel:learn_and_adapt")) return;

  // mesma marca da Pesquisa do Ulquiorra, com multiplicador proprio
  markTarget(victim, LEARN_AND_ADAPT.durationTicks, LEARN_AND_ADAPT.damageMultiplier);

  world.sendMessage(
    `§d${player.name} §7estudou §5${nameOf(victim)}§7: §cdobro do dano recebido §7por ${
      LEARN_AND_ADAPT.durationTicks / 20
    }s.`
  );
  try {
    player.dimension.playSound("random.orb", player.location, { volume: 1, pitch: 1.8 });
  } catch (e) {}

  let elapsed = 0;
  const interval = system.runInterval(() => {
    elapsed += 5;
    if (elapsed > LEARN_AND_ADAPT.durationTicks || !isMarked(victim)) {
      system.clearRun(interval);
      return;
    }
    try {
      const loc = victim.location;
      for (let i = 0; i < 5; i++) {
        const angle = (i / 5) * Math.PI * 2 + elapsed / 8;
        victim.dimension.spawnParticle("szayel:esporo", {
          x: loc.x + Math.cos(angle) * 0.9,
          y: loc.y + 2.2,
          z: loc.z + Math.sin(angle) * 0.9,
        });
      }
    } catch (e) {
      system.clearRun(interval);
    }
  }, 5);
}

/* ---------------------------------------------------------
   Resurrección: Fornicarás
   --------------------------------------------------------- */

function isDownOrGone(entity) {
  try {
    const hp = entity.getComponent("minecraft:health");
    return !hp || hp.currentValue <= 0;
  } catch (e) {
    return true; // saiu do mundo
  }
}

// Preso no Teatro de Títeres: nem o alvo nem o Szayelaporro atacam ou usam
// skill. Vale pros dois lados, e por isso e um estado e nao um efeito.
function isFrozen(entity) {
  try {
    // paralisado pelo Piercing Shinso do Gin
    if ((ginParalyzed.get(entity.id) ?? 0) > system.currentTick) return true;
    for (const duel of soiNigekiDuels.values()) { if (duel.target?.id === entity.id) return true; }
    if (soiNigekiDuels.has(entity.id)) return true;
    return (
      system.currentTick < readTickDeadline(entity, DP.frozenEnd, TEATRO.freezeTicks)
    );
  } catch (e) {
    return false;
  }
}

/* As mutilacoes do Teatro valem ate UM DOS DOIS cair - nao tem prazo. Ficam
   aqui em vez de num efeito porque o Bedrock nao tem efeito pra "sem dash" nem
   pra "-30% de vida maxima". */
const activeMutilations = [];

const MUTILATIONS = {
  eyes: {
    label: "§8Acertar os olhos §7(cegueira até alguém cair)",
    property: "eyesCut",
    announce: "ficou cego",
  },
  leg: {
    label: "§8Cortar uma perna §7(sem dash e sem skill de movimento)",
    property: "legCut",
    announce: "perdeu uma perna: sem dash",
  },
  arm: {
    label: "§8Cortar um braço §7(-20% de dano)",
    property: "armCut",
    announce: "perdeu um braço: -20% de dano",
  },
  heart: {
    label: "§8Furar o coração §7(-30% de vida máxima)",
    property: "heartCut",
    announce: "levou o coração furado: -30% de vida máxima",
  },
};

const MUTILATION_ORDER = ["eyes", "leg", "arm", "heart"];

function applyMutilation(player, victim, kind) {
  const spec = MUTILATIONS[kind];
  if (!spec) return;

  victim.setDynamicProperty(DP[spec.property], true);
  activeMutilations.push({ ownerId: player.id, owner: player, victim, kind });

  // o coracao muda o teto de vida, entao a forma precisa ser reaplicada
  if (kind === "heart") {
    try {
      reapplyFormEffects(victim);
    } catch (e) {}
  }

  world.sendMessage(`§d${nameOf(victim)} §7${spec.announce}§7.`);
}

function liftMutilation(index) {
  const entry = activeMutilations[index];
  activeMutilations.splice(index, 1);

  const spec = MUTILATIONS[entry.kind];
  try {
    entry.victim.setDynamicProperty(DP[spec.property], false);
    if (entry.kind === "eyes") entry.victim.removeEffect("darkness");
    if (entry.kind === "heart") reapplyFormEffects(entry.victim);
  } catch (e) {
    // alvo ja saiu do mundo: nao tem o que devolver
  }
}

function removeMutilationsBy(ownerId) {
  for (let i = activeMutilations.length - 1; i >= 0; i--) {
    if (activeMutilations[i].ownerId !== ownerId) continue;
    liftMutilation(i);
  }
}

function castTeatroDeTiteres(player) {
  if (player.getDynamicProperty(DP.teatroUsed)) {
    player.sendMessage("§7O Teatro de Títeres é uso único por Resurrección.");
    return;
  }

  const victim = targetInView(player, TEATRO.range);
  if (!victim) {
    player.sendMessage("§7Você não está olhando pra ninguém.");
    return;
  }
  if (!tryUseSkill(player, "szayel:teatro_de_titeres")) return;

  player.setDynamicProperty(DP.teatroUsed, true);

  const until = system.currentTick + TEATRO.freezeTicks;
  player.setDynamicProperty(DP.frozenEnd, until);
  victim.setDynamicProperty(DP.frozenEnd, until);

  const victimName = nameOf(victim);
  world.sendMessage(
    `§d§l${player.name} abriu o Teatro de Títeres §r§7em §5${victimName}§7. Ninguém ataca enquanto ele escolhe.`
  );
  try {
    player.dimension.playSound("mob.slime.big", player.location, {
      volume: 1.3,
      pitch: 0.7,
    });
  } catch (e) {}

  const form = new ActionFormData()
    .title("Teatro de Títeres")
    .body(`§7O que cortar em §5${victimName}§7?\n§8Vale até um dos dois cair.`);
  for (const kind of MUTILATION_ORDER) form.button(MUTILATIONS[kind].label);

  form.show(player).then((res) => {
    // menu fechado sem escolher: solta os dois, senao o Teatro tranca os dois
    // de graca ate o prazo acabar
    const kind =
      res.canceled || res.selection === undefined
        ? undefined
        : MUTILATION_ORDER[res.selection];

    releaseTeatro(player, victim);
    if (!kind) {
      try {
        player.sendMessage("§7Você fechou o Teatro sem cortar nada.");
      } catch (e) {}
      return;
    }
    applyMutilation(player, victim, kind);
  });
}

function releaseTeatro(player, victim) {
  for (const side of [player, victim]) {
    try {
      side.setDynamicProperty(DP.frozenEnd, 0);
      side.removeEffect("slowness");
    } catch (e) {}
  }
}

function castPosse(player) {
  if (!tryUseSkill(player, "szayel:posse")) return;

  const dim = player.dimension;
  const origin = player.location;

  // so entidade que nao e player: "domar" outro player nao foi pedido
  const tamed = dim
    .getEntities({ location: origin, maxDistance: POSSE.radius })
    .filter(
      (entity) =>
        entity.id !== player.id &&
        entity.typeId !== "minecraft:player" &&
        entity.getComponent("minecraft:health")
    );

  if (tamed.length === 0) {
    player.sendMessage("§7Não tem nenhuma entidade por perto pra domar.");
    return;
  }

  world.sendMessage(
    `§d${player.name} §7domou §5${tamed.length}§7 ${
      tamed.length === 1 ? "entidade" : "entidades"
    } §7com a §5Posse§7.`
  );
  try {
    dim.playSound("mob.slime.big", origin, { volume: 1.2, pitch: 0.9 });
  } catch (e) {}

  let elapsed = 0;
  const interval = system.runInterval(() => {
    elapsed += POSSE.tickInterval;

    for (const pet of tamed) {
      try {
        const from = pet.location;
        // o player mais proximo que NAO e o Szayelaporro
        const prey = nearestPlayer(player, POSSE.searchRadius, from);
        if (!prey) continue;

        const to = prey.location;
        const dir = directionToward(from, to);
        const gap = Math.sqrt(
          (to.x - from.x) * (to.x - from.x) + (to.z - from.z) * (to.z - from.z)
        );

        if (gap > POSSE.hitRadius) {
          pet.teleport(
            {
              x: from.x + dir.x * POSSE.speed,
              y: from.y,
              z: from.z + dir.z * POSSE.speed,
            },
            { keepVelocity: false, facingLocation: to }
          );
        } else {
          dealDamage(prey, DAMAGE.posseHit * dmgMultiplier(player), player);
        }

        dim.spawnParticle("szayel:esporo", {
          x: from.x,
          y: from.y + 1.4,
          z: from.z,
        });
      } catch (e) {
        // entidade domada morreu ou saiu do mundo
      }
    }

    if (elapsed >= POSSE.durationTicks) {
      system.clearRun(interval);
      try {
        player.sendMessage("§7As entidades voltaram ao normal.");
      } catch (e) {}
    }
  }, POSSE.tickInterval);
}

// hospedeiro marcado pelo Gabriel, por player. Nao vale gravar em dynamic
// property porque o que precisamos guardar e a ENTIDADE, nao um numero.
const gabrielHosts = new Map();

function castGabriel(player) {
  if (!tryUseSkill(player, "szayel:gabriel")) return;

  player.setDynamicProperty(DP.gabrielArmed, true);
  player.sendMessage(
    `§dGabriel armado. §7Bata numa entidade (não player) pra marcar o hospedeiro.`
  );
  try {
    player.dimension.playSound("mob.slime.small", player.location, {
      volume: 1,
      pitch: 0.8,
    });
  } catch (e) {}
}

// disparado no m1: marca o hospedeiro, mas so em entidade que nao e player
function tryGabrielMark(player, victim) {
  if (!player.getDynamicProperty(DP.gabrielArmed)) return;
  if (victim.typeId === "minecraft:player") return;
  try {
    if (!victim.getComponent("minecraft:health")) return;
  } catch (e) {
    return; // o proprio m1 matou o alvo neste tick
  }

  player.setDynamicProperty(DP.gabrielArmed, false);
  gabrielHosts.set(player.id, victim);
  world.sendMessage(
    `§d${player.name} §7marcou §5${nameOf(victim)}§7 como hospedeiro do §5Gabriel§7.`
  );
}

// O renascimento e automatico: quando a vida cai abaixo do limite, ele
// teleporta no hospedeiro, estoura ele e volta cheio.
function tryGabrielRebirth(player) {
  const host = gabrielHosts.get(player.id);
  if (!host) return;

  const character = getActiveCharacter(player);
  if (!character) {
    gabrielHosts.delete(player.id);
    return;
  }

  let hostLocation;
  try {
    if (isDownOrGone(host)) {
      gabrielHosts.delete(player.id);
      return; // hospedeiro morreu antes de servir
    }
    hostLocation = host.location;
    if (virtualHealth(player) >= GABRIEL.healthThreshold) return;
  } catch (e) {
    gabrielHosts.delete(player.id);
    return;
  }

  gabrielHosts.delete(player.id);

  try {
    player.teleport(hostLocation, { keepVelocity: false });
    for (let i = 0; i < 20; i++) {
      player.dimension.spawnParticle("szayel:esporo", {
        x: hostLocation.x + (Math.random() - 0.5) * 3,
        y: hostLocation.y + Math.random() * 2.5,
        z: hostLocation.z + (Math.random() - 0.5) * 3,
      });
    }
    player.dimension.playSound("random.explode", hostLocation, {
      volume: 1.5,
      pitch: 0.8,
    });
  } catch (e) {}

  // o estouro do hospedeiro pega quem estiver em volta (dano nao especificado)
  try {
    damageNearbyEntities(player, hostLocation, GABRIEL.blastRadius, GABRIEL.blastDamage);
    host.kill();
  } catch (e) {}

  // renasce cheio: a forma desperta tem teto proprio
  const form = isAwakened(player) ? character.awakening : undefined;
  healToMax(player, cutHealthFor(player, form?.health ?? character.health));

  if (player.getDynamicProperty("mv:mayuri_poison_gabriel")) {
    player.setDynamicProperty("mv:mayuri_poison_gabriel", false);
    player.setDynamicProperty(DP.mayuriParalysis, true);
    player.setDynamicProperty(DP.mayuriParalysisX, player.location.x);
    player.setDynamicProperty(DP.mayuriParalysisY, player.location.y);
    player.setDynamicProperty(DP.mayuriParalysisZ, player.location.z);
    player.sendMessage("Porque eu não morro logo?isso demora tanto...que dor...");
  }

  world.sendMessage(
    `§d§l${player.name} renasceu de dentro do hospedeiro! §r§7(Gabriel)`
  );
}

/* ---------------------------------------------------------
   Ichigo (pós-treino Vizard)
   --------------------------------------------------------- */

/* Um playAnimation SEM controller e engolido na hora pelos animation controllers
   do proprio player: a animacao dispara e some no mesmo tick, entao parece que
   o codigo funciona e no jogo nao aparece nada. Cada animacao aqui tem o
   controller dela, o que tambem deixa duas se sobreporem (um corte durante um
   grito, por exemplo) em vez de uma cancelar a outra. */
const VIZARD_ANIMATIONS = {
  cast: { id: "animation.vizard.cast", controller: "vizard_cast", length: 0.65 },
  slash: { id: "animation.vizard.slash", controller: "vizard_slash", length: 0.45 },
  slam: { id: "animation.vizard.slam", controller: "vizard_slam", length: 0.6 },
  skyward: { id: "animation.vizard.skyward", controller: "vizard_skyward", length: 0.9 },
  roar: { id: "animation.vizard.roar", controller: "vizard_roar", length: 1.2 },
};

/* A animacao acima e do MODELO: quem esta de fora ve. O braco em primeira pessoa
   o Bedrock renderiza separado e nao segue playAnimation, entao quem lanca nao
   veria nada. Esse clarao sai na altura da mao, na frente da camera - e o que da
   retorno visual pra quem esta jogando. */
function flashCastingHand(player) {
  try {
    const loc = player.location;
    const dir = forwardDirection(player);
    const perp = { x: -dir.z, z: dir.x };
    for (let i = 0; i < 10; i++) {
      const reach = 0.9 + Math.random() * 1.1;
      player.dimension.spawnParticle("vizard:cero", {
        x: loc.x + dir.x * reach + perp.x * (0.45 + Math.random() * 0.3),
        y: loc.y + 1.25 + (Math.random() - 0.5) * 0.5,
        z: loc.z + dir.z * reach + perp.z * (0.45 + Math.random() * 0.3),
      });
    }
  } catch (e) {}
}

function playVizardAnimation(player, key) {
  const anim = VIZARD_ANIMATIONS[key];
  if (!anim) return;

  flashCastingHand(player);
  try {
    player.playAnimation(anim.id, {
      controller: anim.controller,
      blendOutTime: 0.15,
      stopExpression: `query.anim_time > ${anim.length}`,
    });
  } catch (e) {
    // animacao ausente no RP nao pode derrubar a skill
  }
}

function castDashNSlash(player) {
  if (!tryUseSkill(player, "vizard:dash_n_slash")) return;

  world.sendMessage(`§f${player.name} §7usou §fDash 'n Slash§7!`);
  try {
    player.dimension.playSound("mob.enderdragon.flap", player.location, {
      volume: 1.1,
      pitch: 1.8,
    });
  } catch (e) {}

  const totalTicks = DASH_N_SLASH.dashes * DASH_N_SLASH.ticksPerDash;
  let tick = 0;

  const interval = system.runInterval(() => {
    tick++;
    // cada mini dash recomeca o rumo: e uma sequencia de avancos, nao um so
    const restarting = tick % DASH_N_SLASH.ticksPerDash === 1;

    try {
      const dir = forwardDirection(player);
      const from = player.location;
      player.teleport(
        {
          x: from.x + dir.x * DASH_N_SLASH.distancePerTick,
          y: from.y,
          z: from.z + dir.z * DASH_N_SLASH.distancePerTick,
        },
        { keepVelocity: false }
      );

      drawSweep(player, DASH_N_SLASH, "minecraft:crit_particle", restarting);
      if (restarting) {
        playVizardAnimation(player, "slash");
        player.dimension.playSound("mob.enderdragon.flap", from, {
          volume: 0.7,
          pitch: 2,
        });
      }
    } catch (e) {
      system.clearRun(interval); // player saiu do mundo no meio da sequencia
      return;
    }

    // 20 de dano POR TICK em quem estiver na frente
    const finalDamage = DAMAGE.dashNSlashTick * dmgMultiplier(player);
    for (const victim of entitiesInFrontBox(player, DASH_N_SLASH)) {
      dealDamage(victim, finalDamage, player);
    }

    if (tick >= totalTicks) system.clearRun(interval);
  }, 1);
}

function castVizardBarrage(player) {
  if (!tryUseSkill(player, "vizard:getsuga_barrage")) return;

  world.sendMessage(`§f${player.name}: §b§lGETSUGA BARRAGE!`);

  for (let shot = 0; shot < VIZARD_BARRAGE.shots; shot++) {
    system.runTimeout(() => {
      try {
        player.dimension.playSound("mob.wither.shoot", player.location, {
          volume: 1.2,
          pitch: 1.3,
        });
      } catch (e) {
        return; // player saiu do mundo no meio da rajada
      }
      playVizardAnimation(player, "cast");
      fireCrescentWave(player, {
        radius: VIZARD_BARRAGE.radius,
        thickness: VIZARD_BARRAGE.thickness,
        range: VIZARD_BARRAGE.range,
        speed: VIZARD_BARRAGE.speed,
        damage: DAMAGE.vizardBarrage,
        particle: "vizard:cero",
        burst: "minecraft:large_explosion",
      });
    }, shot * VIZARD_BARRAGE.gapTicks);
  }
}

function castDescentTensho(player) {
  if (!tryUseSkill(player, "vizard:descent_tensho")) return;

  world.sendMessage(`§f${player.name}: §b§lDESCENT TENSHŌ!`);
  playVizardAnimation(player, "slam");

  const dim = player.dimension;
  const dir = forwardDirection(player);
  const origin = player.location;

  // o corte desce em direcao ao chao em vez de sair reto
  let step = 0;
  const interval = system.runInterval(() => {
    step++;
    const travelled = (DESCENT_TENSHO.travel * step) / DESCENT_TENSHO.steps;
    const drop = (travelled / DESCENT_TENSHO.travel) * 3.5;
    const point = {
      x: origin.x + dir.x * travelled,
      y: origin.y + 3 - drop,
      z: origin.z + dir.z * travelled,
    };

    try {
      for (let i = 0; i < 10; i++) {
        dim.spawnParticle("vizard:cero", {
          x: point.x + (Math.random() - 0.5) * 2.4,
          y: point.y + (Math.random() - 0.5) * 1.4,
          z: point.z + (Math.random() - 0.5) * 2.4,
        });
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }

    if (step < DESCENT_TENSHO.steps) return;
    system.clearRun(interval);

    // estoura no chao numa area grande
    const impact = { x: point.x, y: point.y, z: point.z };
    try {
      dim.playSound("random.explode", impact, { volume: 2, pitch: 0.6 });
      for (let i = 0; i < 26; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = DESCENT_TENSHO.blastRadius * Math.sqrt(Math.random());
        dim.spawnParticle("minecraft:large_explosion", {
          x: impact.x + Math.cos(angle) * dist,
          y: impact.y + Math.random() * 2,
          z: impact.z + Math.sin(angle) * dist,
        });
      }
    } catch (e) {}

    damageNearbyEntities(player, impact, DESCENT_TENSHO.blastRadius, DAMAGE.descentTensho);
  }, 1);
}

function castSuperNuke(player) {
  if (!tryUseSkill(player, "vizard:super_nuke")) return;

  world.sendMessage(`§4§l${player.name}: SUPER NUKE TENSHOU!!!`);
  try {
    player.dimension.playSound("mob.wither.death", player.location, {
      volume: 2,
      pitch: 0.25,
    });
  } catch (e) {}
  playVizardAnimation(player, "cast");

  fireCrescentWave(player, {
    radius: SUPER_NUKE.radius,
    thickness: SUPER_NUKE.thickness,
    range: SUPER_NUKE.range,
    speed: SUPER_NUKE.speed, // dobro da velocidade do Nuke original
    damage: DAMAGE.superNuke,
    particle: "vizard:cero",
    burst: "minecraft:large_explosion",
    rows: SUPER_NUKE.rows,
  });
}

/* ---------------------------------------------------------
   TRUE AWAKENING: Vasto Lorde
   --------------------------------------------------------- */

function castWhitesShowdown(player) {
  const victim = nearestPlayer(player, WHITES_SHOWDOWN.searchRadius);
  if (!victim) {
    player.sendMessage("§7Não tem nenhum player por perto.");
    return;
  }
  if (!tryUseSkill(player, "vizard:whites_showdown")) return;

  world.sendMessage(`§f§l${player.name}: WHITE'S SHOWDOWN!`);
  playVizardAnimation(player, "slam");

  let impact;
  try {
    const target = victim.location;
    const dir = directionToward(player.location, target);
    // aparece colado nele
    impact = {
      x: target.x - dir.x * WHITES_SHOWDOWN.behind,
      y: target.y,
      z: target.z - dir.z * WHITES_SHOWDOWN.behind,
    };
    player.teleport(impact, { keepVelocity: false, facingLocation: target });
    player.dimension.playSound("mob.enderdragon.growl", impact, {
      volume: 1.6,
      pitch: 1.4,
    });
  } catch (e) {
    return; // alvo saiu do mundo entre a mira e o soco
  }

  // ondas crescentes, mesma ideia do Quebramundos
  for (let ring = 1; ring <= WHITES_SHOWDOWN.rings; ring++) {
    system.runTimeout(() => {
      const radius = (WHITES_SHOWDOWN.maxRadius * ring) / WHITES_SHOWDOWN.rings;
      try {
        const points = 12 + ring * 6;
        for (let i = 0; i < points; i++) {
          const angle = (i / points) * Math.PI * 2;
          player.dimension.spawnParticle("minecraft:large_explosion", {
            x: impact.x + Math.cos(angle) * radius,
            y: impact.y + 0.4,
            z: impact.z + Math.sin(angle) * radius,
          });
        }
        player.dimension.playSound("random.explode", impact, {
          volume: 1.5,
          pitch: 1.1 - ring * 0.15,
        });
      } catch (e) {
        return;
      }
      damageNearbyEntities(player, impact, radius, DAMAGE.whitesShowdown);
    }, (ring - 1) * WHITES_SHOWDOWN.ringGapTicks + 1);
  }

  // e o alvo do soco vai pro chao
  try {
    const loc = victim.location;
    victim.teleport(
      { x: loc.x, y: loc.y - WHITES_SHOWDOWN.buryDepth, z: loc.z },
      { keepVelocity: false }
    );
    victim.addEffect("slowness", WHITES_SHOWDOWN.buryTicks, {
      amplifier: 255,
      showParticles: false,
    });
  } catch (e) {}
}

function castBulletHell(player) {
  if (!tryUseSkill(player, "vizard:bullet_hell")) return;

  world.sendMessage(`§f§l${player.name}: BULLET HELL!`);

  const fireCero = () => {
    try {
      player.dimension.playSound("mob.wither.shoot", player.location, {
        volume: 1.2,
        pitch: 0.8,
      });
    } catch (e) {
      return false; // player saiu do mundo no meio da chuva
    }
    playVizardAnimation(player, "cast");

    // cada cero estoura numa area bem grande quando acaba o alcance ou acerta
    fireEnergySphere(player, {
      radius: BULLET_HELL.radius,
      range: BULLET_HELL.range,
      speed: BULLET_HELL.speed,
      damage: DAMAGE.bulletHell,
      particle: "vizard:cero",
      shellParticles: 18,
      blast: { radius: BULLET_HELL.blastRadius, damage: DAMAGE.bulletHell },
    });
    return true;
  };

  let elapsed = 0;
  const interval = system.runInterval(() => {
    elapsed += BULLET_HELL.gapTicks;
    if (!fireCero()) {
      system.clearRun(interval);
      return;
    }
    if (elapsed >= BULLET_HELL.durationTicks) {
      system.clearRun(interval);
      try {
        player.sendMessage("§7O Bullet Hell parou.");
      } catch (e) {}
    }
  }, BULLET_HELL.gapTicks);

  // o primeiro cero sai na hora: sem isso a skill tem 12 ticks de silencio
  fireCero();
}

// um pingo da chuva de ceros: cai do ceu e estoura em quem estiver embaixo
function dropCeroRain(player, center) {
  const dim = player.dimension;
  const angle = Math.random() * Math.PI * 2;
  const dist = CERO_RAIN.spreadRadius * Math.sqrt(Math.random());
  let ground = {
    x: center.x + Math.cos(angle) * dist,
    z: center.z + Math.sin(angle) * dist,
  };

  // parte dos pingos mira perto de quem esta embaixo
  if (Math.random() < CERO_RAIN.aimedShare) {
    try {
      const below = dim
        .getEntities({ location: center, maxDistance: CERO_RAIN.spreadRadius })
        .filter((e) => e.id !== player.id && e.getComponent("minecraft:health"));
      if (below.length > 0) {
        const pick = below[Math.floor(Math.random() * below.length)].location;
        ground = {
          x: pick.x + (Math.random() - 0.5) * CERO_RAIN.aimScatter,
          z: pick.z + (Math.random() - 0.5) * CERO_RAIN.aimScatter,
        };
      }
    } catch (e) {
      // sem ninguem por perto: o pingo cai no ponto aleatorio mesmo
    }
  }

  let height = CERO_RAIN.skyHeight;
  const interval = system.runInterval(() => {
    height -= CERO_RAIN.fallSpeed;
    const point = { x: ground.x, y: center.y + height, z: ground.z };

    try {
      for (let i = 0; i < 3; i++) {
        dim.spawnParticle("vizard:cero", {
          x: point.x + (Math.random() - 0.5) * 0.6,
          y: point.y + Math.random() * 0.8,
          z: point.z + (Math.random() - 0.5) * 0.6,
        });
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }

    if (height > 0) return;

    system.clearRun(interval);
    try {
      dim.spawnParticle("minecraft:large_explosion", {
        x: point.x,
        y: center.y + 0.4,
        z: point.z,
      });
    } catch (e) {}
    damageNearbyEntities(
      player,
      { x: point.x, y: center.y + 1, z: point.z },
      CERO_RAIN.hitRadius,
      DAMAGE.ceroRain
    );
  }, 1);
}

function castEverythingButTheRain(player) {
  if (!tryUseSkill(player, "vizard:everything_but_the_rain")) return;

  const dim = player.dimension;
  world.sendMessage(`§f§l${player.name}: EVERYTHING BUT THE RAIN!`);
  playVizardAnimation(player, "skyward");

  let center;
  try {
    center = player.location;
    dim.playSound("mob.wither.death", center, { volume: 2, pitch: 0.5 });
  } catch (e) {
    return;
  }

  // primeiro o cero gigante sobe pro ceu
  fireEnergySphere(player, {
    radius: 3.4,
    range: CERO_RAIN.skyHeight,
    speed: 3,
    damage: 0,
    particle: "vizard:cero",
    shellParticles: 26,
    direction: { x: 0, y: 1, z: 0 },
  });

  // e depois ele volta em pingos
  for (let drop = 0; drop < CERO_RAIN.drops; drop++) {
    system.runTimeout(() => {
      try {
        dropCeroRain(player, center);
      } catch (e) {}
    }, 20 + drop * CERO_RAIN.gapTicks);
  }
}

function castGritoDelDiablo(player) {
  if (!tryUseSkill(player, "vizard:grito_del_diablo")) return;

  world.sendMessage(
    `§4§l${player.name} soltou o GRITO DEL DIABLO! §r§7(${
      GRITO_DIABLO.radius
    } blocos, ${GRITO_DIABLO.durationTicks / 20}s)`
  );
  playVizardAnimation(player, "roar");

  let ticks = 0;
  const interval = system.runInterval(() => {
    ticks++;

    let center;
    try {
      center = player.location;
      if (ticks % 10 === 1) {
        player.dimension.playSound("mob.enderdragon.growl", center, {
          volume: 2,
          pitch: 0.4,
        });
      }
      for (let i = 0; i < 6; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = GRITO_DIABLO.radius * Math.sqrt(Math.random());
        player.dimension.spawnParticle("vizard:cero", {
          x: center.x + Math.cos(angle) * dist,
          y: center.y + 0.5 + Math.random() * 4,
          z: center.z + Math.sin(angle) * dist,
        });
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }

    damageNearbyEntities(player, center, GRITO_DIABLO.radius, DAMAGE.gritoDiabloTick);

    if (ticks >= GRITO_DIABLO.durationTicks) system.clearRun(interval);
  }, 1);
}

/* ---------------------------------------------------------
   Segunda fase: a vida caindo ate o limite vira o Vasto Lorde
   --------------------------------------------------------- */

function ascendToTrueForm(player, character, form) {
  const trueForm = form.trueForm;

  player.setDynamicProperty(DP.trueForm, true);
  applyCharacterEffects(
    player,
    trueForm.health ?? character.health,
    trueForm.speedAmplifier ?? BASE_SPEED_AMPLIFIER,
    "regenAmplifier" in trueForm ? trueForm.regenAmplifier : REGEN_AMPLIFIER,
    trueForm.extraEffects
  );

  const inv = getInv(player);
  for (const slot in trueForm.items ?? {}) {
    inv.setItem(Number(slot), new ItemStack(trueForm.items[slot], 1));
  }

  // "cada awk recupera toda vida ao ser ativada"
  system.runTimeout(
    () => healToMax(player, cutHealthFor(player, trueForm.health ?? character.health)),
    2
  );

  if (trueForm.armorPiece) equipArmorPiece(player, trueForm.armorPiece);

  // o grito vai como TITLE pra todo mundo, nao so no chat
  if (trueForm.titleForAll) {
    for (const other of world.getPlayers()) {
      try {
        other.onScreenDisplay.setTitle(`§4§l${trueForm.titleForAll}`, {
          subtitle: `§c${player.name}`,
          fadeInDuration: 5,
          fadeOutDuration: 20,
          staySeconds: 3,
        });
      } catch (e) {}
    }
  }

  playVizardAnimation(player, "roar");

  try {
    if (trueForm.titleSound) {
      player.dimension.playSound(trueForm.titleSound, player.location, {
        volume: 2,
        pitch: 0.4,
      });
    }

  } catch (e) {}

  world.sendMessage(`§4§l${player.name} virou ${trueForm.name}!`);
}

/* ---------------------------------------------------------
   Camera alta da forma gigante
   --------------------------------------------------------- */

function disableTallView(player) {
  try {
    if (!player.getDynamicProperty(DP.tallView)) return;
    player.setDynamicProperty(DP.tallView, false);
    player.camera.clear();
  } catch (e) {
    // sem camera disponivel ou player invalido
  }
}

function toggleTallView(player, cfg) {
  const next = !player.getDynamicProperty(DP.tallView);
  player.setDynamicProperty(DP.tallView, next);

  if (next) {
    player.sendMessage("§6Visão lá de cima: você enxerga como um gigante.");
  } else {
    try {
      player.camera.clear();
    } catch (e) {}
    player.sendMessage("§7Visão normal de volta.");
  }
}

/* ---------------------------------------------------------
   Awakening do Kenpachi: Pressao espiritual (tapa-olho removido)
   --------------------------------------------------------- */

function releaseSpiritualPressure(held) {
  for (const { entity } of held) {
    try {
      entity.removeEffect("blindness");
      entity.removeEffect("slowness");
    } catch (e) {
      // alvo morreu ou saiu do mundo durante a pressao
    }
  }
}

function activateSpiritualPressure(player, cfg) {
  const dim = player.dimension;
  const center = player.location;

  world.sendMessage(
    `§4§l${player.name} arrancou o tapa-olho! §r§cA pressão espiritual cobre tudo.`
  );
  dim.playSound("mob.enderdragon.growl", center, { volume: 2, pitch: 0.4 });

  // ancora cada um onde estava: a lentidao sozinha nao prende de verdade, entao
  // a pressao segura pela posicao (mesma ideia da contencao do Senkei)
  const held = [];
  for (const entity of dim.getEntities({ location: center, maxDistance: cfg.radius })) {
    if (entity.id === player.id) continue;
    if (!entity.getComponent("minecraft:health")) continue;
    if (isPressureImmune(entity)) continue; // Ichigo (Dangai): a pressao nao pega
    held.push({ entity, anchor: entity.location });
    if (entity.typeId === "minecraft:player") {
      world.sendMessage(`<${entity.name}> ${cfg.chatLine}`);
    }
  }

  if (!held.length) return;

  let elapsed = 0;
  const interval = system.runInterval(() => {
    elapsed++;

    for (const { entity, anchor } of held) {
      try {
        entity.teleport(anchor, { keepVelocity: false });
        entity.addEffect("blindness", 40, { amplifier: 0, showParticles: false });
        entity.addEffect("slowness", 40, { amplifier: 9, showParticles: false });
        if (elapsed % 20 === 0) {
          // dano cru: o +50% do awakening vale pras skills e pro m1, nao pra
          // pressao em si
          dealDamage(entity, cfg.dotPerSecond, player);
        }
      } catch (e) {
        // alvo morreu ou saiu: ignora e segue com o resto
      }
    }

    if (elapsed >= cfg.durationTicks) {
      system.clearRun(interval);
      releaseSpiritualPressure(held);
      try {
        player.sendMessage(
          "§cA pressão se assentou. §r§6+50% de dano enquanto o Awakening durar."
        );
      } catch (e) {}
    }
  }, 1);
}

/* ---------------------------------------------------------
   Super ataque do Byakuya: Senbonzakura Kageyoshi / Senkei
   --------------------------------------------------------- */

// controla o "carregamento" de 5s (agachado segurando a m1 base)
const senkeiChargeTicks = new Map(); // playerId -> ticks acumulados
const senkeiChargeReady = new Set(); // playerId com o circulo ja formado

function resetSenkeiCharge(player) {
  senkeiChargeTicks.delete(player.id);
  senkeiChargeReady.delete(player.id);
}

function activateKageyoshi(player, character) {
  const cfg = character.superAttack.kageyoshi;
  const dim = player.dimension;
  const center = player.location;

  world.sendMessage(
    `§d§l${player.name} usou Senbonzakura Kageyoshi!`
  );
  player.dimension.playSound("mob.wither.spawn", center, {
    volume: 1.5,
    pitch: 1.2,
  });

  let elapsed = 0;
  const interval = system.runInterval(() => {
    // espalha folhas de sakura pela area toda (30x30)
    for (let i = 0; i < 18; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * cfg.radius;
      const p = {
        x: center.x + Math.cos(angle) * dist,
        y: center.y + 0.2 + Math.random() * 2.5,
        z: center.z + Math.sin(angle) * dist,
      };
      try {
        dim.spawnParticle("sakura:leaf", p);
      } catch (e) {}
    }

    const entities = dim.getEntities({ location: center, maxDistance: cfg.radius });
    for (const entity of entities) {
      if (entity.id === player.id) continue;
      if (!entity.getComponent("minecraft:health")) continue;
      dealDamage(entity, cfg.dotPerSecond * dmgMultiplier(player), player);
      try { entity.addEffect("slowness", 40, { amplifier: cfg.slownessAmplifier ?? 1, showParticles: false }); } catch(e) {}
    }

    elapsed++;
    if (elapsed >= cfg.durationSeconds) {
      system.clearRun(interval);
      removeZonesOwnedBy(player.id);
      player.sendMessage("§7Senbonzakura Kageyoshi terminou.");
    }
  }, 20);

  activeZones.push({
    ownerId: player.id, kind: "kageyoshi", center, radius: cfg.radius, dimension: dim,
    intervalId: interval, trapped: new Set(), blocksSkills: false, blocksOwnerSkills: false,
    blocksDash: true, traps: false, blocksRegen: false,
    blockMessage: "§dVocê está dentro do Kageyoshi: o dash está bloqueado.",
  });
}

function drawSenkeiBarrier(dim, center, radius) {
  // "espadas" gigantes ao redor do perimetro quadrado de 30x30
  const steps = 24;
  for (let i = 0; i < steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const edgeX = Math.cos(t) * radius;
    const edgeZ = Math.sin(t) * radius;
    for (let h = 0; h < 6; h++) {
      const p = {
        x: center.x + edgeX,
        y: center.y + h * 1.2,
        z: center.z + edgeZ,
      };
      try {
        dim.spawnParticle("sakura:leaf", p);
        if (h % 2 === 0) dim.spawnParticle("minecraft:crit_particle", p);
      } catch (e) {}
    }
  }
}

function activateSenkei(player, character) {
  const cfg = character.superAttack.senkei;
  const dim = player.dimension;
  const center = player.location;

  player.setDynamicProperty(DP.byakuyaWeapon, "senkei");

  world.sendMessage(
    `§4§lSENKEI: SENBONZAKURA KAGEYOSHI! §r§d${player.name} fechou a arena!`
  );
  player.dimension.playSound("mob.wither.spawn", center, {
    volume: 2,
    pitch: 0.6,
  });

  drawSenkeiBarrier(dim, center, cfg.radius);

  let elapsed = 0;
  const intervalId = system.runInterval(() => {
    drawSenkeiBarrier(dim, center, cfg.radius);

    const entities = dim.getEntities({ location: center, maxDistance: cfg.radius });
    for (const entity of entities) {
      if (entity.id === player.id) continue;
      try {
        entity.addEffect("slowness", 40, { amplifier: 6, showParticles: false });
      } catch (e) {}
      if (entity.typeId === "minecraft:player") {
        try {
          entity.removeEffect("speed");
        } catch (e) {}
      }
    }

    elapsed += 20;
    if (elapsed >= cfg.maxDurationTicks) {
      // trava de seguranca: se ninguem desativar manualmente, acaba sozinho
      removeZonesOwnedBy(player.id);
      try {
        player.setDynamicProperty(DP.byakuyaWeapon, "base");
        world.sendMessage(`§7O Senkei de ${player.name} se dissipou.`);
      } catch (e) {
        // dono saiu do mundo no meio do senkei: a arena ja foi removida acima
      }
    }
  }, 20);

  activeZones.push({
    ownerId: player.id,
    kind: "senkei",
    center,
    radius: cfg.radius,
    dimension: dim,
    intervalId,
    trapped: new Set(),
    blocksSkills: true,
    blocksOwnerSkills: true, // no Senkei nem o Byakuya pode usar skill
    traps: true,
    blocksRegen: false,
    blockMessage: "§7Você está preso no Senkei! Só pode atacar com sua espada.",
  });
}

function tryTriggerByakuyaSuper(player, character) {
  if (getAwakening(player) < 100) return false;
  if (getByakuyaWeaponState(player) !== "base") return false;
  if (skillBlockingZoneFor(player)) return false;

  const charged = senkeiChargeReady.has(player.id);
  player.setDynamicProperty(DP.awakening, 0);
  resetSenkeiCharge(player);

  if (charged) {
    activateSenkei(player, character);
  } else {
    activateKageyoshi(player, character);
  }
  return true;
}

// crouch + usar a senbonzakura do senkei = desativa a area e puxa a espada final
function triggerSenkeiDeactivation(player, character) {
  removeZonesOwnedBy(player.id);
  player.setDynamicProperty(DP.byakuyaWeapon, "finisher");
  player.setDynamicProperty(DP.awakening, 0);
  player.sendMessage(
    "§d§lVocê puxou a Senbonzakura final! Um golpe e tudo acaba - inclusive pra você."
  );
  world.sendMessage(`§7A arena de ${player.name} se abriu novamente...`);
}

// ao acertar alguem com a senbonzakura final: acaba o awakening e o Byakuya fica stunado
function finishByakuyaSuper(player) {
  player.setDynamicProperty(DP.byakuyaWeapon, "base");
  player.setDynamicProperty(DP.awakening, 0);
  removeZonesOwnedBy(player.id);

  try {
    player.addEffect("slowness", 200, { amplifier: 9, showParticles: false });
    player.addEffect("darkness", 200, { amplifier: 0, showParticles: false });
  } catch (e) {}

  world.sendMessage(
    `§7${player.name} usou tudo na Senbonzakura final e ficou vulnerável.`
  );
}

const INTocable = {
  durationTicks: 200, // 10s
};

const MUERTE_MULTIPLE = {
  attacks: 20,
  gapTicks: 1,
  searchRadius: 7,
};

const AVANCE_FATAL = {
  searchRadius: 35,
  dashTicks: 5,
  maxDistancePerTick: 6,
  hitRadius: 4.5,
};

const METEORITO_DE_HIERRO = {
  searchRadius: 40,
  launchHeight: 14,
  descentTicks: 5,
  impactRadius: 5,
};

// brilho defensivo usado enquanto Declaración del Intocable está ativa
function showIntocableGuard(entity) {
  const loc = entity.location;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    try {
      entity.dimension.spawnParticle("minecraft:crit_particle", {
        x: loc.x + Math.cos(angle) * 1.1,
        y: loc.y + 0.9 + (i % 3) * 0.35,
        z: loc.z + Math.sin(angle) * 1.1,
      });
    } catch (e) {}
  }
}

function isIntocableActive(entity) {
  return isIntocable(entity);
}

// Encerra a Declaración del Intocable. `broken` = quebrada pelo Zaraki.
function endIntocable(entity, broken = false) {
  let wasActive = false;
  try {
    wasActive = isIntocable(entity);
    entity.setDynamicProperty(DP.intocableEnd, 0);
  } catch (e) {}
  if (!wasActive) return;
  try {
    entity.removeEffect("resistance");
  } catch (e) {}
  if (broken) {
    try {
      world.sendMessage("§c§lA defesa do Nnoitra foi quebrada!");
      entity.dimension.playSound("random.anvil_break", entity.location, {
        volume: 1.2,
        pitch: 1.2,
      });
    } catch (e) {}
  }
}

/* ---------------------------------------------------------
   Nnoitra Gilga
   --------------------------------------------------------- */

// Individualidade + Hierro. Tudo que o addon causa passa por dealDamage, que
// chama isto: 90% sempre, e 70% em cima disso enquanto o Hierro durar (os dois
// se multiplicam: com o Hierro ligado ele recebe 63% do dano bruto).
function isHierro(entity) {
  try {
    return (
      system.currentTick < readTickDeadline(entity, DP.hierroEnd, HIERRO.durationTicks)
    );
  } catch (e) {
    return false;
  }
}

function damageTakenMultiplierOf(entity) {
  try {
    if (entity.typeId !== "minecraft:player") return 1;
    const character = getActiveCharacter(entity);
    let multiplier = character?.damageTakenMultiplier ?? 1;
    const form = activeFormOf(entity, character);
    if (form?.awakeningDamageTakenMultiplier) {
      multiplier *= form.awakeningDamageTakenMultiplier;
    }
    if (isHierro(entity)) multiplier *= HIERRO.damageTakenMultiplier;
    if (character?.id === "aizen_hogyoku") multiplier *= hogyokuResistMultiplier(entity);
    if (character?.id === "komamura") multiplier *= komamuraShieldMultiplier(entity);
    return multiplier;
  } catch (e) {
    return 1;
  }
}


function castMuerteMultiple(player) {
  const target = nearestTarget(player, MUERTE_MULTIPLE.searchRadius);
  if (!target) {
    player.sendMessage("§7Não há ninguém por perto para a Muerte Múltiple.");
    return;
  }
  if (!tryUseSkill(player, "nnoitra:muerte_multiple")) return;

  world.sendMessage(`§8${player.name} §7usou §fMuerte Múltiple§7!`);
  player.dimension.playSound("item.trident.throw", player.location, {
    volume: 1.2,
    pitch: 0.8,
  });

  let attacks = 0;
  const hitCooldown = new Map();

  const strike = () => {
    attacks++;
    try {
      // remira no alvo mais próximo a cada golpe
      const victim = nearestTarget(player, MUERTE_MULTIPLE.searchRadius);
      if (victim) {
        const now = system.currentTick;
        if (now - (hitCooldown.get(victim.id) ?? -1000) >= 1) {
          hitCooldown.set(victim.id, now);
          const loc = victim.location;
          for (let i = 0; i < 5; i++) {
            const angle = (i / 5) * Math.PI * 2;
            try {
              player.dimension.spawnParticle("nnoitra:corte", {
                x: loc.x + Math.cos(angle) * 0.9,
                y: loc.y + 0.4 + Math.random() * 1.4,
                z: loc.z + Math.sin(angle) * 0.9,
              });
            } catch (e) {}
          }
          dealDamage(victim, DAMAGE.muerteMultipleHit * dmgMultiplier(player), player);
        }
      }
    } catch (e) {}

    if (attacks < MUERTE_MULTIPLE.attacks) {
      system.runTimeout(strike, MUERTE_MULTIPLE.gapTicks);
    }
  };

  strike();
}

function castAvanceFatal(player) {
  const target = nearestPlayer(player, AVANCE_FATAL.searchRadius);
  if (!target) {
    player.sendMessage("§7Não há player por perto para o Avance Fatal.");
    return;
  }
  if (!tryUseSkill(player, "nnoitra:avance_fatal")) return;

  world.sendMessage(`§8${player.name} §f§lAVANCE FATAL!`);
  try {
    player.dimension.playSound("mob.wither.shoot", player.location, {
      volume: 1.4,
      pitch: 1.15,
    });
  } catch (e) {}

  let ticks = 0;
  const interval = system.runInterval(() => {
    ticks++;
    try {
      const to = target.location;
      const from = player.location;
      const dir = directionToward(from, {
        x: to.x,
        y: to.y,
        z: to.z,
      });
      const distance = Math.sqrt(
        (to.x - from.x) ** 2 +
        (to.y - from.y) ** 2 +
        (to.z - from.z) ** 2
      );

      const step = Math.min(AVANCE_FATAL.maxDistancePerTick, Math.max(0, distance - 1.8));
      player.teleport(
        {
          x: from.x + dir.x * step,
          y: from.y + dir.y * step,
          z: from.z + dir.z * step,
        },
        { keepVelocity: false, facingLocation: to }
      );

      for (let cut = 0; cut < 4; cut++) {
        const side = (cut - 1.5) * 0.45;
        try {
          player.dimension.spawnParticle("nnoitra:corte", {
            x: player.location.x + side,
            y: player.location.y + 0.7 + cut * 0.25,
            z: player.location.z + 1.2,
          });
        } catch (e) {}
      }

      if (distance <= AVANCE_FATAL.hitRadius || ticks >= AVANCE_FATAL.dashTicks) {
        if (distance <= AVANCE_FATAL.hitRadius + 1) {
          dealDamage(target, DAMAGE.avanceFatal * dmgMultiplier(player), player);
        }
        system.clearRun(interval);
      }
    } catch (e) {
      system.clearRun(interval);
    }
  }, 1);
}

function castMeteoritoDeHierro(player) {
  const target = nearestPlayer(player, METEORITO_DE_HIERRO.searchRadius);
  if (!target) {
    player.sendMessage("§7Não há player por perto para o Meteorito de Hierro.");
    return;
  }
  if (!tryUseSkill(player, "nnoitra:meteorito_de_hierro")) return;

  world.sendMessage(`§8${player.name} §f§lMETEORITO DE HIERRO!`);
  const start = player.location;
  let phase = 0;
  let ticks = 0;

  // subida imediata
  try {
    player.teleport(
      { x: start.x, y: start.y + METEORITO_DE_HIERRO.launchHeight, z: start.z },
      { keepVelocity: false }
    );
  } catch (e) {}

  const interval = system.runInterval(() => {
    ticks++;
    try {
      const targetLoc = target.location;
      const current = player.location;

      // durante a queda, o ponto de impacto acompanha o alvo
      const impact = {
        x: targetLoc.x,
        y: targetLoc.y + 0.2,
        z: targetLoc.z,
      };

      if (ticks <= METEORITO_DE_HIERRO.descentTicks) {
        const t = ticks / METEORITO_DE_HIERRO.descentTicks;
        // queda acelerada: começa controlada e termina muito rápida
        const eased = t * t;
        player.teleport(
          {
            x: current.x + (impact.x - current.x) * 0.75,
            y: start.y + METEORITO_DE_HIERRO.launchHeight * (1 - eased),
            z: current.z + (impact.z - current.z) * 0.75,
          },
          { keepVelocity: false, facingLocation: impact }
        );

        for (let i = 0; i < 5; i++) {
          try {
            player.dimension.spawnParticle("minecraft:large_explosion", {
              x: player.location.x + (Math.random() - 0.5) * 1.4,
              y: player.location.y,
              z: player.location.z + (Math.random() - 0.5) * 1.4,
            });
          } catch (e) {}
        }
      } else {
        player.teleport(
          { x: impact.x, y: impact.y, z: impact.z },
          { keepVelocity: false, facingLocation: targetLoc }
        );

        // Explosão apenas visual: partículas, sem quebrar blocos.
        for (let ring = 0; ring < 3; ring++) {
          for (let i = 0; i < 18; i++) {
            const angle = (i / 18) * Math.PI * 2;
            const radius = METEORITO_DE_HIERRO.impactRadius * ((ring + 1) / 3);
            try {
              player.dimension.spawnParticle("minecraft:large_explosion", {
                x: impact.x + Math.cos(angle) * radius,
                y: impact.y + 0.15 + ring * 0.25,
                z: impact.z + Math.sin(angle) * radius,
              });
            } catch (e) {}
          }
        }

        system.clearRun(interval);
      }
    } catch (e) {
      system.clearRun(interval);
    }
  }, 1);
}

function castDeclaracionDelIntocable(player) {
  if (!tryUseSkill(player, "nnoitra:declaracion_del_intocable")) return;

  player.setDynamicProperty(
    DP.intocableEnd,
    system.currentTick + INTocable.durationTicks
  );
  // IMUNIDADE DE VERDADE: o dealDamage so barra o dano do addon. Dano normal
  // (soco, mob, fogo, queda...) passava. Resistance no maximo zera todo dano
  // comum durante os 10s.
  try {
    player.addEffect("resistance", INTocable.durationTicks + 5, {
      amplifier: 255,
      showParticles: false,
    });
  } catch (e) {}
  world.sendMessage("§6Minha defesa é impenetrável!");

  const interval = system.runInterval(() => {
    try {
      if (!isIntocableActive(player)) {
        system.clearRun(interval);
        return;
      }
      showIntocableGuard(player);
    } catch (e) {
      system.clearRun(interval);
    }
  }, 4);
}

function castDuroSlash(player) {
  if (!tryUseSkill(player, "nnoitra:duro_slash")) return;

  world.sendMessage(`§8${player.name}: §f§lDURO SLASH! §r§7(passa pela guarda)`);
  try {
    player.dimension.playSound("random.anvil_land", player.location, {
      volume: 1.2,
      pitch: 1.5,
    });
  } catch (e) {}

  // corte deitado: tres fileiras de faisca na largura toda do golpe
  const dim = player.dimension;
  const dir = forwardDirection(player);
  const perp = { x: -dir.z, z: dir.x };
  const origin = player.location;
  const half = DURO_SLASH.width / 2;
  for (const height of [0.7, 1.1, 1.5]) {
    for (let i = 0; i <= 14; i++) {
      const lateral = -half + (i / 14) * DURO_SLASH.width;
      // as pontas ficam um pouco mais atras: o corte desenha um arco
      const along = DURO_SLASH.forward * 0.65 - Math.abs(lateral) * 0.25;
      try {
        dim.spawnParticle(i % 2 === 0 ? "nnoitra:corte" : "minecraft:crit_particle", {
          x: origin.x + dir.x * along + perp.x * lateral,
          y: origin.y + height,
          z: origin.z + dir.z * along + perp.z * lateral,
        });
      } catch (e) {}
    }
  }

  const finalDamage = DAMAGE.duroSlash * dmgMultiplier(player);
  for (const victim of entitiesInFrontBox(player, DURO_SLASH)) {
    // segundo golpe da addon que passa direto pela guarda (o outro e a Royal Cleave)
    dealDamage(victim, finalDamage, player, { breaksBlock: true });
  }
}

/* --- lamina dupla: Spinning Blade e Beyblade ------------------------ */

const TWO_PI = Math.PI * 2;

// a - b normalizado pra [-PI, PI)
function angleDiff(a, b) {
  let d = (a - b) % TWO_PI;
  if (d >= Math.PI) d -= TWO_PI;
  if (d < -Math.PI) d += TWO_PI;
  return d;
}

// `angle` e pra onde o braco A aponta agora; `sweep` e quanto a lamina girou
// desde o tick passado (radianos). O alvo e cortado se algum dos dois bracos
// passou por ele NESTE tick. Olhar so o angulo atual deixaria passar quem
// estivesse "entre" dois ticks: a ponta anda mais de 2 blocos por tick.
function doubleBladeReaches(center, angle, sweep, entity) {
  const loc = entity.location;
  const dy = loc.y - center.y;
  if (dy < -DOUBLE_BLADE.reachBelow || dy > DOUBLE_BLADE.reachAbove) return false;

  const dx = loc.x - center.x;
  const dz = loc.z - center.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > DOUBLE_BLADE.radius + 0.5) return false;
  if (dist < 0.4) return true; // em cima do eixo, qualquer braco encosta

  const facing = Math.atan2(dz, dx);
  // folga angular: a largura do corpo vista dessa distancia
  const slack = Math.atan2(0.6, dist);
  for (let arm = 0; arm < 2; arm++) {
    const passed = angleDiff(angle + arm * Math.PI, facing);
    if (passed >= -slack && passed <= sweep + slack) return true;
  }
  return false;
}

function spawnBladePoint(dim, center, angle, distance, particle) {
  try {
    dim.spawnParticle(particle, {
      x: center.x + Math.cos(angle) * distance,
      y: center.y + 1.2,
      z: center.z + Math.sin(angle) * distance,
    });
  } catch (e) {}
}

function drawDoubleBlade(dim, center, angle, sweep) {
  const bladeStart = DOUBLE_BLADE.radius - 1.5;
  for (let arm = 0; arm < 2; arm++) {
    const base = angle + arm * Math.PI;
    // cabo: do centro ate onde comeca a lamina
    for (let i = 1; i <= 5; i++) {
      spawnBladePoint(dim, center, base, bladeStart * (i / 5), "minecraft:crit_particle");
    }
    // lamina: os ultimos blocos, com um rastro atras
    for (let trail = 0; trail < 2; trail++) {
      for (let i = 0; i < 4; i++) {
        spawnBladePoint(
          dim,
          center,
          base - sweep * 0.5 * trail,
          bladeStart + 1.5 * (i / 3),
          "nnoitra:corte"
        );
      }
    }
  }
}

function showBladeSpark(entity) {
  try {
    const loc = entity.location;
    for (let i = 0; i < 4; i++) {
      entity.dimension.spawnParticle("nnoitra:corte", {
        x: loc.x + (Math.random() - 0.5) * 0.9,
        y: loc.y + 0.6 + Math.random() * 1.0,
        z: loc.z + (Math.random() - 0.5) * 0.9,
      });
    }
  } catch (e) {}
}

// Corta quem a lamina alcancou neste tick. `lastHit` guarda o tick do ultimo
// corte por alvo: a lamina passa varias vezes por segundo, e sem isso o "X por
// hit" sairia todo tick.
function bladeCutTargets(player, center, angle, sweep, damage, hitInterval, lastHit, ranged) {
  const now = system.currentTick;
  const finalDamage = damage * dmgMultiplier(player);

  for (const entity of player.dimension.getEntities({
    location: center,
    maxDistance: DOUBLE_BLADE.radius + 3,
  })) {
    if (entity.id === player.id) continue;
    if (!entity.getComponent("minecraft:health")) continue;
    if (now - (lastHit.get(entity.id) ?? -1000) < hitInterval) continue;
    if (!doubleBladeReaches(center, angle, sweep, entity)) continue;

    lastHit.set(entity.id, now);
    // a Respira do Barragan come ataque de longo alcance: so a Beyblade, que e
    // arremessada, cai nessa regra. A Spinning Blade e corpo a corpo.
    if (ranged && isRespiring(entity)) {
      showRespiraGuard(entity);
      continue;
    }
    dealDamage(entity, finalDamage, player);
    showBladeSpark(entity);
  }
}

function castSpinningBlade(player) {
  if (!tryUseSkill(player, "nnoitra:spinning_blade")) return;

  world.sendMessage(`§8${player.name} §7girou a lâmina: §fSpinning Blade§7!`);
  try {
    player.dimension.playSound("item.trident.throw", player.location, {
      volume: 1.3,
      pitch: 0.6,
    });
  } catch (e) {}

  const sweep = (SPINNING_BLADE.degreesPerTick * Math.PI) / 180;
  const lastHit = new Map();
  const dir = forwardDirection(player);
  let angle = Math.atan2(dir.z, dir.x);
  let elapsed = 0;

  const interval = system.runInterval(() => {
    elapsed++;
    try {
      const hp = player.getComponent("minecraft:health");
      // morreu ou trocou de personagem: a lamina some junto
      if (!hp || hp.currentValue <= 0 || getActiveCharacter(player)?.id !== "nnoitra") {
        system.clearRun(interval);
        return;
      }

      // a lamina acompanha o Nnoitra: ele pode andar e usar outras skills
      const center = player.location;
      angle += sweep;
      drawDoubleBlade(player.dimension, center, angle, sweep);
      bladeCutTargets(
        player,
        center,
        angle,
        sweep,
        DAMAGE.spinningBladeHit,
        SPINNING_BLADE.hitIntervalTicks,
        lastHit,
        false
      );
    } catch (e) {
      // player saiu do mundo no meio do giro
      system.clearRun(interval);
      return;
    }

    if (elapsed >= SPINNING_BLADE.durationTicks) {
      system.clearRun(interval);
      try {
        player.sendMessage("§7A Spinning Blade parou de girar.");
      } catch (e) {}
    }
  }, 1);
}

function castBeyblade(player) {
  if (!tryUseSkill(player, "nnoitra:beyblade")) return;

  world.sendMessage(`§8${player.name}: §f§lBEYBLADE!`);
  try {
    player.dimension.playSound("item.trident.throw", player.location, {
      volume: 1.4,
      pitch: 1.1,
    });
  } catch (e) {}

  const dir = forwardDirection(player);
  const origin = player.location;
  const sweep = (BEYBLADE.degreesPerTick * Math.PI) / 180;
  const lastHit = new Map();
  let angle = Math.atan2(dir.z, dir.x);
  let travelled = BEYBLADE.startDistance;

  const interval = system.runInterval(() => {
    try {
      const center = {
        x: origin.x + dir.x * travelled,
        y: origin.y,
        z: origin.z + dir.z * travelled,
      };
      angle += sweep;
      drawDoubleBlade(player.dimension, center, angle, sweep);
      bladeCutTargets(
        player,
        center,
        angle,
        sweep,
        DAMAGE.beybladeHit,
        BEYBLADE.hitIntervalTicks,
        lastHit,
        true
      );
    } catch (e) {
      // player saiu do mundo com a lamina no ar
      system.clearRun(interval);
      return;
    }

    travelled += BEYBLADE.speed;
    if (travelled >= BEYBLADE.range) system.clearRun(interval);
  }, 1);
}

function castHierro(player) {
  if (!tryUseSkill(player, "nnoitra:hierro")) return;

  player.setDynamicProperty(DP.hierroEnd, system.currentTick + HIERRO.durationTicks);

  world.sendMessage(`§8${player.name} §7endureceu a pele: §fHierro§7!`);
  try {
    player.dimension.playSound("random.anvil_land", player.location, {
      volume: 1.4,
      pitch: 0.8,
    });
  } catch (e) {}

  // aura de ferro em volta dele enquanto durar
  const interval = system.runInterval(() => {
    try {
      if (!isHierro(player)) {
        system.clearRun(interval);
        player.sendMessage("§7O Hierro se desfez.");
        return;
      }
      const loc = player.location;
      for (let i = 0; i < 6; i++) {
        const angle = Math.random() * Math.PI * 2;
        player.dimension.spawnParticle(
          i % 2 === 0 ? "minecraft:crit_particle" : "nnoitra:corte",
          {
            x: loc.x + Math.cos(angle) * 0.7,
            y: loc.y + 0.2 + Math.random() * 1.7,
            z: loc.z + Math.sin(angle) * 0.7,
          }
        );
      }
    } catch (e) {
      system.clearRun(interval);
    }
  }, 4);
}

/* ---------------------------------------------------------
   Gin Ichimaru (Tier 6) - Shinso, a lamina retratil
   Tudo aqui e desenhado com particula: a lamina e uma linha de "gin:lamina"
   da mao do Gin ate a ponta, redesenhada a cada tick. Ela estende e se
   retrai de verdade (o comprimento cresce e encolhe tick a tick).
   --------------------------------------------------------- */

const EXTENDED_BLADE = {
  range: 20,
  extendTicks: 4, // 5 blocos por tick
  holdTicks: 3,
  retractTicks: 4,
  hitRadius: 1.1, // espessura de acerto da lamina
  maxBreaks: 40, // teto de blocos quebrados por uso
};
const SPIRAL = {
  radius: 8, // comprimento da lamina girando - nao foi especificado
  durationTicks: 100, // 5s - nao foi especificado
  extendTicks: 4,
  retractTicks: 4,
  degreesPerTick: 30, // uma volta a cada 12 ticks
  hitIntervalTicks: 10, // o mesmo alvo leva "100 por hit" de novo depois disso
  bob: 0.5, // a lamina sobe e desce enquanto gira
};
// Pursuing Blade e Piercing Shinso usam o mesmo motor: a ponta anda em RETAS e a
// cada "perna" ela mira de novo no alvo mais proximo. Se o rumo muda, a lamina
// dobra ali (uma junta na cadeia) - viradas secas, nunca curva.
const GIN_PATH_DEFAULTS = {
  pathfind: true, // contorna blocos; sem caminho, quebra os blocos no meio
  // 1a busca: o caminho MAIS CURTO. 2a (so se a 1a estourar o limite): aceita um
  // caminho um pouco maior numa area bem mais larga. So depois das duas falharem
  // a lamina quebra bloco.
  pathMargin: 12, // folga da area de busca em volta do trecho ponta-alvo
  pathNodeLimit: 2500, // teto da busca (trava o lag em terreno grande)
  pathFallbackMargin: 40,
  pathFallbackNodeLimit: 10000,
  pathFallbackWeight: 1.6, // >1 = acha um caminho bem mais rapido, mas nao o menor
  replanTicks: 8, // de quanto em quanto tempo refaz o caminho se o alvo se mexe
  maxBreaks: 40, // teto de blocos quebrados por ataque
};
const PURSUING_BLADE = {
  searchRadius: 40,
  speed: 2.4, // blocos por tick
  legTicks: 4,
  hitRadius: 1.3,
  maxLength: 70,
  maxTicks: 100,
  holdTicks: 0,
  retractTicks: 6, // recolhe rapido: 0,3s
  retractMinSpeed: 1.5,
  drawEvery: 1,
  drawBudget: 32,
  ...GIN_PATH_DEFAULTS,
};
const PIERCING_SHINSO = {
  searchRadius: 40,
  speed: 2.8,
  legTicks: 3,
  hitRadius: 1.3,
  maxLength: 120,
  maxTicks: 200, // 10s no maximo
  // a paralisia dura ate a lamina terminar de voltar: depois do ultimo acerto a
  // lamina fica esticada (todo mundo espetado) por 1s e so entao recolhe
  holdTicks: 20,
  retractTicks: 8,
  retractMinSpeed: 1.5,
  maxTargets: 20,
  drawEvery: 2,
  drawBudget: 40,
  ...GIN_PATH_DEFAULTS,
};
const KAMISHINI = {
  range: 200, // 10x o Extended Blade (20). Na pratica vai ate onde houver chunk carregado
  extendTicks: 6, // ~33 blocos por tick
  holdTicks: 14,
  retractTicks: 8,
  hitRadius: 1.6, // "encostou, morreu"
  damageFraction: 0.5, // tier igual ou maior: metade da vida maxima
  drawEvery: 2,
};
const GIN_TURN_COS = Math.cos((10 * Math.PI) / 180); // menos que 10 graus nao vira junta
const GIN_PARALYSIS_SAFETY_TICKS = 40; // a paralisia expira sozinha se o loop do ataque morrer

function ginHandOf(player) {
  const l = player.location;
  return { x: l.x, y: l.y + 1.15, z: l.z };
}

// ponto que o player esta mirando, a `dist` blocos do olho
function ginAimPoint(player, dist) {
  const h = player.getHeadLocation();
  const v = player.getViewDirection();
  return { x: h.x + v.x * dist, y: h.y + v.y * dist, z: h.z + v.z * dist };
}

function ginDist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function ginUnit(from, to) {
  const d = ginDist(from, to) || 1;
  return { x: (to.x - from.x) / d, y: (to.y - from.y) / d, z: (to.z - from.z) / d };
}

// meio do tronco: e pra la que a lamina mira
function ginBodyOf(entity) {
  const l = entity.location;
  return { x: l.x, y: l.y + 0.9, z: l.z };
}

// distancia do ponto p ao segmento a-b e em que ponto do segmento (0..1) fica o mais proximo
function ginSegmentReach(p, a, b) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = 0;
  if (len2 > 1e-9) {
    t = ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
  }
  const dx = p.x - (a.x + abx * t);
  const dy = p.y - (a.y + aby * t);
  const dz = p.z - (a.z + abz * t);
  return { dist: Math.sqrt(dx * dx + dy * dy + dz * dz), t };
}

// o corpo tem altura: testa pes, tronco e cabeca e fica com o mais perto
function ginBodyReach(entity, a, b) {
  const l = entity.location;
  let best = { dist: Infinity, t: 1 };
  for (const h of [0.3, 0.95, 1.6]) {
    const r = ginSegmentReach({ x: l.x, y: l.y + h, z: l.z }, a, b);
    if (r.dist < best.dist) best = r;
  }
  return best;
}

// quem a lamina (segmento a-b, com espessura `radius`) encosta, na ordem em que
// ela passa por eles
function ginEntitiesOnSegment(player, a, b, radius, ignore) {
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
  const search = ginDist(a, b) / 2 + radius + 2.5;
  const found = [];
  for (const entity of player.dimension.getEntities({ location: mid, maxDistance: search })) {
    if (entity.id === player.id) continue;
    if (ignore && ignore.has(entity.id)) continue;
    if (!entity.getComponent("minecraft:health")) continue;
    if (isDownOrGone(entity)) continue;
    const reach = ginBodyReach(entity, a, b);
    if (reach.dist > radius) continue;
    found.push({ entity, t: reach.t });
  }
  found.sort((x, y) => x.t - y.t);
  return found.map((f) => f.entity);
}

// entidade viva mais proxima de `from` que ainda nao foi cortada
function ginNearestTarget(player, from, radius, exclude) {
  let best;
  let bestDist = Infinity;
  for (const entity of player.dimension.getEntities({ location: from, maxDistance: radius })) {
    if (entity.id === player.id) continue;
    if (exclude && exclude.has(entity.id)) continue;
    if (!entity.getComponent("minecraft:health")) continue;
    if (isDownOrGone(entity)) continue;
    const d = ginDist(from, ginBodyOf(entity));
    if (d < bestDist) {
      bestDist = d;
      best = entity;
    }
  }
  return best;
}

// Desenha a lamina ao longo de uma linha quebrada. O espacamento cresce se a
// lamina fica comprida, entao o gasto de particula por desenho tem teto (`budget`).
function ginDrawBlade(dim, points, budget, mainParticle = "gin:lamina", tipParticle = "gin:ponta") {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += ginDist(points[i - 1], points[i]);
  if (total < 0.05) return;

  const spacing = Math.max(0.6, total / budget);
  let next = 0;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = ginDist(a, b);
    if (seg < 1e-6) continue;
    while (next <= walked + seg) {
      const t = (next - walked) / seg;
      try {
        dim.spawnParticle(mainParticle, {
          x: a.x + (b.x - a.x) * t,
          y: a.y + (b.y - a.y) * t,
          z: a.z + (b.z - a.z) * t,
        });
      } catch (e) {
        return;
      }
      next += spacing;
    }
    walked += seg;
  }
  try {
    dim.spawnParticle(tipParticle, points[points.length - 1]);
  } catch (e) {}
}

function showGinSpark(entity) {
  try {
    const l = entity.location;
    for (let i = 0; i < 4; i++) {
      entity.dimension.spawnParticle(i % 2 === 0 ? "minecraft:crit_particle" : "gin:ponta", {
        x: l.x + (Math.random() - 0.5) * 0.9,
        y: l.y + 0.5 + Math.random() * 1.1,
        z: l.z + (Math.random() - 0.5) * 0.9,
      });
    }
  } catch (e) {}
}

// Corta o alvo. `ranged` = ataque de longo alcance: a Respira do Barragan come
// esse tipo de golpe (so a Spiral, que gira colada no Gin, e corpo a corpo).
// Devolve true se o golpe entrou.
function ginStrike(player, entity, damage, ranged) {
  if (ranged && isRespiring(entity)) {
    showRespiraGuard(entity);
    return false;
  }
  dealDamage(entity, damage * dmgMultiplier(player), player);
  showGinSpark(entity);
  return true;
}

function ginPlaySound(player, sound, volume, pitch) {
  try {
    player.dimension.playSound(sound, player.location, { volume, pitch });
  } catch (e) {}
}

function ginStillAlive(player) {
  return !isDownOrGone(player) && getActiveCharacter(player)?.id === "gin";
}

/* Paralisia do Piercing Shinso: fica no mapa `ginParalyzed` (id -> tick limite),
   que o isFrozen() tambem le. Com isso o paralisado nao usa skill, nao bate e
   nao da dash pelas MESMAS travas que ja existem. O tick limite e curto e o
   ataque renova: se o loop morrer por qualquer motivo, a paralisia acaba sozinha. */
function ginParalyze(entity) {
  ginParalyzed.set(entity.id, system.currentTick + GIN_PARALYSIS_SAFETY_TICKS);
  ginHoldParalysis(entity);
  try {
    if (entity.typeId === "minecraft:player") {
      entity.sendMessage("§7O Shinso te atravessou: §fparalisado§7 até o fim do ataque!");
    }
  } catch (e) {}
}

// Travar o pulo. O jeito antigo era jump_boost 128, que o Bedrock lia como
// "pulo negativo"; hoje o amplificador e lido sem sinal e 128 vira um pulo
// altissimo. Agora o pulo do player e desligado pela permissao de input e volta
// sozinho quando ninguem renova a trava (mob nao precisa: a lentidao segura).
const jumpLockUntil = new Map(); // id do player -> tick em que o pulo volta

function holdJump(entity, ticks) {
  if (entity?.typeId !== "minecraft:player") return;
  const until = system.currentTick + ticks;
  jumpLockUntil.set(entity.id, Math.max(jumpLockUntil.get(entity.id) ?? 0, until));
  try {
    entity.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, false);
  } catch (e) {}
}

function releaseJump(entity) {
  if (!entity || !jumpLockUntil.has(entity.id)) return;
  jumpLockUntil.delete(entity.id);
  try {
    entity.inputPermissions.setPermissionCategory(InputPermissionCategory.Jump, true);
  } catch (e) {}
}

system.runInterval(() => {
  if (!jumpLockUntil.size) return;
  const now = system.currentTick;
  for (const player of world.getPlayers()) {
    const until = jumpLockUntil.get(player.id);
    if (until !== undefined && now >= until) releaseJump(player);
  }
}, 2);

function ginHoldParalysis(entity) {
  ginParalyzed.set(entity.id, system.currentTick + GIN_PARALYSIS_SAFETY_TICKS);
  try {
    entity.addEffect("slowness", 10, { amplifier: 255, showParticles: false });
  } catch (e) {}
  holdJump(entity, 10);
}

function ginRelease(entity) {
  ginParalyzed.delete(entity.id);
  // nao tira a lentidao de quem ainda esta preso por outra coisa (Teatro)
  if (isFrozen(entity)) return;
  try {
    entity.removeEffect("slowness");
  } catch (e) {}
  releaseJump(entity);
}

/* ---------- Extended Blade ---------- */

function castExtendedBlade(player) {
  if (!tryUseSkill(player, "gin:extended_blade")) return;

  world.sendMessage(`§7${player.name}: §f§lExtended Blade`);
  ginPlaySound(player, "item.trident.throw", 1.2, 1.7);

  const cfg = EXTENDED_BLADE;
  const dim = player.dimension;
  const dir = ginUnit(ginHandOf(player), ginAimPoint(player, cfg.range));
  const hit = new Set();
  const blockCache = new Map();
  const attackTicks = cfg.extendTicks + cfg.holdTicks;
  const total = attackTicks + cfg.retractTicks;
  let cap = cfg.range; // alcance real: encurta se bater em bloco que nao quebra
  let reachedLen = 0; // ate onde a lamina ja abriu caminho
  let broken = 0;
  let tick = 0;

  const interval = system.runInterval(() => {
    tick++;
    try {
      if (!ginStillAlive(player)) {
        system.clearRun(interval);
        return;
      }

      let length;
      if (tick <= cfg.extendTicks) length = (cfg.range * tick) / cfg.extendTicks;
      else if (tick <= attackTicks) length = cfg.range;
      else length = cfg.range * Math.max(0, 1 - (tick - attackTicks) / cfg.retractTicks);

      const hand = ginHandOf(player);
      const at = (d) => ({ x: hand.x + dir.x * d, y: hand.y + dir.y * d, z: hand.z + dir.z * d });

      // enquanto estende, quebra os blocos que a ponta encosta
      if (tick <= cfg.extendTicks && reachedLen < cap) {
        const want = Math.min(length, cap);
        const res = ginBreakBlocks(dim, blockCache, at(reachedLen), at(want), cfg.maxBreaks - broken);
        broken += res.count;
        if (res.blocked) cap = reachedLen + res.reach; // bloco que nao quebra: a lamina para ali
        reachedLen = Math.min(want, cap);
      }
      length = Math.min(length, cap);

      if (length > 0.2) {
        const tip = at(length);
        ginDrawBlade(dim, [hand, tip], 34);

        // so corta enquanto estende e segura; encolhendo ela nao acerta mais ninguem
        if (tick <= attackTicks) {
          for (const entity of ginEntitiesOnSegment(player, hand, tip, cfg.hitRadius, hit)) {
            hit.add(entity.id);
            ginStrike(player, entity, DAMAGE.ginExtendedBlade, true);
          }
        }
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }

    if (tick >= total) system.clearRun(interval);
  }, 1);
}

/* ---------- Spiral ---------- */

// `passed` e quanto a lamina ja andou depois de passar pelo alvo neste tick: o
// alvo e cortado se ela passou por ele ENTRE o tick passado e este (a ponta anda
// mais de 4 blocos por tick, olhar so o angulo atual deixaria gente passar).
function ginSpiralCut(player, center, angle, sweep, length, bladeY, lastHit) {
  const now = system.currentTick;
  for (const entity of player.dimension.getEntities({
    location: center,
    maxDistance: length + 3,
  })) {
    if (entity.id === player.id) continue;
    if (!entity.getComponent("minecraft:health")) continue;
    if (now - (lastHit.get(entity.id) ?? -1000) < SPIRAL.hitIntervalTicks) continue;

    const loc = entity.location;
    if (bladeY < loc.y - 0.3 || bladeY > loc.y + 2.0) continue;

    const dx = loc.x - center.x;
    const dz = loc.z - center.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > length + 0.5) continue;
    if (dist >= 0.4) {
      const facing = Math.atan2(dz, dx);
      const slack = Math.atan2(0.6, dist); // largura do corpo vista dessa distancia
      const passed = angleDiff(angle, facing);
      if (passed < -slack || passed > sweep + slack) continue;
    }

    lastHit.set(entity.id, now);
    ginStrike(player, entity, DAMAGE.ginSpiralHit, false);
  }
}

function castSpiral(player) {
  if (!tryUseSkill(player, "gin:spiral")) return;

  world.sendMessage(`§7${player.name}: §f§lSpiral`);
  ginPlaySound(player, "item.trident.throw", 1.3, 0.9);

  const cfg = SPIRAL;
  const dim = player.dimension;
  const sweep = (cfg.degreesPerTick * Math.PI) / 180;
  const lastHit = new Map();
  const view = forwardDirection(player);
  let angle = Math.atan2(view.z, view.x);
  let tick = 0;

  const interval = system.runInterval(() => {
    tick++;
    try {
      if (!ginStillAlive(player)) {
        system.clearRun(interval);
        return;
      }

      let length = cfg.radius;
      if (tick <= cfg.extendTicks) length = (cfg.radius * tick) / cfg.extendTicks;
      else if (tick > cfg.durationTicks - cfg.retractTicks) {
        length = (cfg.radius * Math.max(0, cfg.durationTicks - tick)) / cfg.retractTicks;
      }

      if (length > 0.2) {
        angle += sweep;
        // a lamina acompanha o Gin: ele pode andar e usar outras skills
        const hand = ginHandOf(player);
        const y = hand.y + Math.sin(tick * 0.4) * cfg.bob;
        const tipAt = (a) => ({
          x: hand.x + Math.cos(a) * length,
          y,
          z: hand.z + Math.sin(a) * length,
        });

        ginDrawBlade(dim, [hand, tipAt(angle)], 16);
        // rastro: a mesma lamina meio passo atras, mais rala
        ginDrawBlade(dim, [hand, tipAt(angle - sweep * 0.5)], 6);

        ginSpiralCut(player, hand, angle, sweep, length, y, lastHit);
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }

    if (tick >= cfg.durationTicks) {
      system.clearRun(interval);
      try {
        player.sendMessage("§7A Spiral parou de girar.");
      } catch (e) {}
    }
  }, 1);
}

/* ---------- Pursuing Blade e Piercing Shinso (mesmo motor) ---------- */

/* ---------- Caminho da lamina em volta dos blocos (Pursuing Blade e Piercing Shinso) ---------- */

// blocos que a lamina nao consegue quebrar
const GIN_UNBREAKABLE = new Set([
  "minecraft:bedrock",
  "minecraft:barrier",
  "minecraft:command_block",
  "minecraft:chain_command_block",
  "minecraft:repeating_command_block",
  "minecraft:structure_block",
  "minecraft:structure_void",
  "minecraft:jigsaw",
  "minecraft:border_block",
  "minecraft:allow",
  "minecraft:deny",
  "minecraft:light_block",
  "minecraft:end_portal",
  "minecraft:end_portal_frame",
  "minecraft:end_gateway",
  "minecraft:portal",
  "minecraft:reinforced_deepslate",
]);

// Info do bloco na celula (com cache por ataque). Chunk descarregado conta como
// parede que nao da pra quebrar.
function ginBlockInfo(dim, cache, x, y, z) {
  const key = x + "," + y + "," + z;
  let info = cache.get(key);
  if (info) return info;
  try {
    const block = dim.getBlock({ x, y, z });
    if (!block) {
      info = { passable: false, breakable: false };
    } else {
      info = {
        passable: block.isAir || block.isLiquid || block.isSolid === false,
        breakable: !GIN_UNBREAKABLE.has(block.typeId),
      };
    }
  } catch (e) {
    info = { passable: false, breakable: false };
  }
  cache.set(key, info);
  return info;
}

// a linha reta a-b passa so por espaco livre? (as celulas da ponta e do inicio
// nao contam: a mao pode estar colada na parede e o alvo pode estar num degrau)
function ginClear(dim, cache, a, b) {
  const len = ginDist(a, b);
  const steps = Math.max(1, Math.ceil(len / 0.4));
  const sx = Math.floor(a.x);
  const sy = Math.floor(a.y);
  const sz = Math.floor(a.z);
  const gx = Math.floor(b.x);
  const gy = Math.floor(b.y);
  const gz = Math.floor(b.z);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.floor(a.x + (b.x - a.x) * t);
    const y = Math.floor(a.y + (b.y - a.y) * t);
    const z = Math.floor(a.z + (b.z - a.z) * t);
    if ((x === sx && y === sy && z === sz) || (x === gx && y === gy && z === gz)) continue;
    if (!ginBlockInfo(dim, cache, x, y, z).passable) return false;
  }
  return true;
}

function ginPathLength(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += ginDist(points[i - 1], points[i]);
  return sum;
}

const GIN_NEIGHBORS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/* Menor caminho ate o alvo por espaco livre (A* em celulas, andando so pelas
   faces). Depois "puxa o fio": tira as celulas do meio sempre que da pra ir reto,
   sobrando so as dobras necessarias - viradas secas em retas, sem curva.
   Devolve a lista de pontos (o ultimo e o alvo) ou null se nao ha caminho. */
function ginFindPath(dim, cache, from, to, cfg, margin, nodeLimit, weight) {
  const sx = Math.floor(from.x);
  const sy = Math.floor(from.y);
  const sz = Math.floor(from.z);
  const gx = Math.floor(to.x);
  const gy = Math.floor(to.y);
  const gz = Math.floor(to.z);
  const minX = Math.min(sx, gx) - margin;
  const maxX = Math.max(sx, gx) + margin;
  const minY = Math.min(sy, gy) - Math.ceil(margin / 2);
  const maxY = Math.max(sy, gy) + Math.ceil(margin / 2);
  const minZ = Math.min(sz, gz) - margin;
  const maxZ = Math.max(sz, gz) + margin;
  const W = maxX - minX + 1;
  const H = maxY - minY + 1;
  const keyOf = (x, y, z) => ((x - minX) * H + (y - minY)) * (maxZ - minZ + 1) + (z - minZ);

  // manhattan: e a distancia exata em espaco livre andando so pelas faces (com a
  // euclidiana a busca abre uma bolha enorme e estoura o limite em paredes grandes)
  const heuristic = (x, y, z) => (Math.abs(x - gx) + Math.abs(y - gy) + Math.abs(z - gz)) * weight;
  const heap = []; // [f, x, y, z]
  const push = (node) => {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  const cost = new Map();
  const parent = new Map();
  const startKey = keyOf(sx, sy, sz);
  cost.set(startKey, 0);
  push([heuristic(sx, sy, sz), sx, sy, sz]);

  let expanded = 0;
  let found = false;
  const closed = new Set();
  while (heap.length && expanded < nodeLimit) {
    const [, x, y, z] = pop();
    const k = keyOf(x, y, z);
    if (closed.has(k)) continue;
    closed.add(k);
    expanded++;
    if (x === gx && y === gy && z === gz) {
      found = true;
      break;
    }
    const g = cost.get(k);
    for (const [dx, dy, dz] of GIN_NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      if (nx < minX || nx > maxX || ny < minY || ny > maxY || nz < minZ || nz > maxZ) continue;
      const nk = keyOf(nx, ny, nz);
      if (closed.has(nk)) continue;
      const isGoal = nx === gx && ny === gy && nz === gz;
      if (!isGoal && !ginBlockInfo(dim, cache, nx, ny, nz).passable) continue;
      const ng = g + 1;
      if (cost.has(nk) && cost.get(nk) <= ng) continue;
      cost.set(nk, ng);
      parent.set(nk, k);
      push([ng + heuristic(nx, ny, nz), nx, ny, nz]);
    }
  }
  if (!found) return null;

  // volta pelos pais montando as celulas (do alvo ate o inicio)
  const cells = [];
  let cx = gx;
  let cy = gy;
  let cz = gz;
  let ck = keyOf(cx, cy, cz);
  const decode = (key) => {
    const D = maxZ - minZ + 1;
    const z = (key % D) + minZ;
    const rest = Math.floor(key / D);
    const y = (rest % H) + minY;
    const x = Math.floor(rest / H) + minX;
    return [x, y, z];
  };
  while (ck !== startKey) {
    cells.push([cx, cy, cz]);
    ck = parent.get(ck);
    [cx, cy, cz] = decode(ck);
  }
  cells.reverse();

  const pts = [{ ...from }];
  for (let i = 0; i < cells.length - 1; i++) {
    pts.push({ x: cells[i][0] + 0.5, y: cells[i][1] + 0.5, z: cells[i][2] + 0.5 });
  }
  pts.push({ ...to });

  const out = [];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !ginClear(dim, cache, pts[i], pts[j])) j--;
    out.push(pts[j]);
    i = j;
  }
  if (ginPathLength([from, ...out]) > cfg.maxLength * 0.9) return null; // nem a lamina inteira da conta
  return out;
}

// caminho livre em duas tentativas (ver GIN_PATH_DEFAULTS); null = nao ha, quebra
function ginPlanPath(dim, cache, from, to, cfg) {
  return (
    ginFindPath(dim, cache, from, to, cfg, cfg.pathMargin, cfg.pathNodeLimit, 1) ??
    ginFindPath(
      dim,
      cache,
      from,
      to,
      cfg,
      cfg.pathFallbackMargin,
      cfg.pathFallbackNodeLimit,
      cfg.pathFallbackWeight
    )
  );
}

// Quebra (com drop) os blocos que a linha a-b atravessa. Devolve quantos quebrou
// e se bateu em algo que nao quebra ou estourou o limite do ataque.
function ginBreakBlocks(dim, cache, a, b, allowed) {
  const len = ginDist(a, b);
  const steps = Math.max(1, Math.ceil(len / 0.4));
  const seen = new Set();
  let count = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = Math.floor(a.x + (b.x - a.x) * t);
    const y = Math.floor(a.y + (b.y - a.y) * t);
    const z = Math.floor(a.z + (b.z - a.z) * t);
    const key = x + "," + y + "," + z;
    if (seen.has(key)) continue;
    seen.add(key);
    const info = ginBlockInfo(dim, cache, x, y, z);
    if (info.passable) continue;
    if (!info.breakable || count >= allowed) return { count, blocked: true, reach: t * len };
    let broken = false;
    try {
      const res = dim.runCommand(`setblock ${x} ${y} ${z} air [] destroy`);
      broken = !res || res.successCount > 0;
    } catch (e) {}
    if (!broken) {
      try {
        dim.getBlock({ x, y, z }).setType("minecraft:air");
        broken = true;
      } catch (e) {}
    }
    if (!broken) return { count, blocked: true, reach: t * len };
    cache.set(key, { passable: true, breakable: true });
    count++;
  }
  return { count, blocked: false, reach: len };
}

// options.pierce = atravessa e segue pro proximo; senao para no primeiro acerto
function launchSeekingBlade(player, cfg, options) {
  const dim = player.dimension;
  const hitSet = new Set();
  const victims = [];
  const blockCache = new Map();
  const hand0 = ginHandOf(player);
  // cadeia da lamina: [ancora na mao, juntas..., ponta]. A ancora acompanha o Gin.
  const chain = [{ ...hand0 }, { ...hand0 }];
  let dir;
  let target;
  let legLeft = 0;
  let mode = "seek";
  let hits = 0;
  let tick = 0;
  let retractStep = 0; // blocos por tick, calculado quando a lamina comeca a voltar
  let retractHold = -1; // ticks parada esticada antes de recolher (-1 = ainda nao comecou)
  let route = null; // pontos de um caminho que contorna os blocos
  let breach = false; // sem caminho livre: abre os blocos no meio
  let replanLeft = 0;
  let broken = 0;
  let lastPlanTick = -100;

  const finish = () => {
    for (const victim of victims) ginRelease(victim);
    victims.length = 0;
  };

  const chainLength = () => ginPathLength(chain);

  // vira pra `to`. Se o rumo mudou de verdade, a lamina dobra (junta) na ponta.
  const steer = (to) => {
    const tip = chain[chain.length - 1];
    const next = ginUnit(tip, to);
    if (dir && dir.x * next.x + dir.y * next.y + dir.z * next.z < GIN_TURN_COS) {
      chain.push({ ...tip });
    }
    dir = next;
  };

  const reaim = () => {
    const tip = chain[chain.length - 1];
    target = ginNearestTarget(player, tip, cfg.searchRadius, hitSet);
    if (!target) return false;
    const goal = ginBodyOf(target);
    const keepBreaching = breach && tick - lastPlanTick < 80; // nao refaz a busca inutil toda hora
    route = null;
    breach = false;
    if (!cfg.pathfind || ginClear(dim, blockCache, tip, goal)) {
      steer(goal);
    } else {
      const path = keepBreaching ? null : ginPlanPath(dim, blockCache, tip, goal, cfg);
      lastPlanTick = keepBreaching ? lastPlanTick : tick;
      if (path) {
        route = path;
        steer(route[0]);
      } else {
        breach = true;
        steer(goal);
      }
    }
    legLeft = cfg.legTicks;
    replanLeft = cfg.replanTicks;
    return true;
  };

  const interval = system.runInterval(() => {
    tick++;
    try {
      if (!ginStillAlive(player)) {
        system.clearRun(interval);
        finish();
        return;
      }

      chain[0] = ginHandOf(player);
      if (tick % 10 === 0) blockCache.clear(); // os blocos mudam

      if (mode === "seek") {
        const tip = chain[chain.length - 1];
        const routing = !!(route && route.length);
        const targetGone = !target || isDownOrGone(target) || hitSet.has(target.id);
        const closeToTarget =
          !routing &&
          !breach &&
          target &&
          !targetGone &&
          ginDist(tip, ginBodyOf(target)) < cfg.speed * 2;
        const stale = routing || breach ? replanLeft <= 0 : legLeft <= 0;

        if (!dir || targetGone || closeToTarget || stale) {
          if (!reaim()) mode = "retract";
        }

        if (mode === "seek") {
          const from = { ...chain[chain.length - 1] };
          let stepLen = cfg.speed;
          let reached = false;
          if (route && route.length) {
            const d = ginDist(from, route[0]);
            if (d <= stepLen) {
              stepLen = d; // nao passa da dobra
              reached = true;
            }
          }
          const to = {
            x: from.x + dir.x * stepLen,
            y: from.y + dir.y * stepLen,
            z: from.z + dir.z * stepLen,
          };

          if (breach) {
            const res = ginBreakBlocks(dim, blockCache, from, to, cfg.maxBreaks - broken);
            broken += res.count;
            if (res.blocked) mode = "retract"; // bloco que nao quebra (ou limite): volta
          }

          if (mode === "seek") {
            chain[chain.length - 1] = to;
            legLeft--;
            replanLeft--;

            for (const entity of ginEntitiesOnSegment(player, from, to, cfg.hitRadius, hitSet)) {
              hitSet.add(entity.id);
              const landed = ginStrike(player, entity, options.damage, true);

              if (!options.pierce) {
                mode = "retract"; // Pursuing Blade: acertou (ou foi barrada), volta
                break;
              }
              if (landed) {
                hits++;
                if (!isIntocable(entity)) {
                  ginParalyze(entity);
                  victims.push(entity);
                }
                if (hits >= cfg.maxTargets) {
                  mode = "retract";
                  break;
                }
              }
              legLeft = 0; // atravessou: ja mira no proximo
              route = null;
              breach = false;
            }

            if (mode === "seek" && reached && route) {
              route.shift();
              if (route.length) steer(route[0]);
              else {
                route = null;
                legLeft = 0;
              }
            }

            if (mode === "seek" && (tick >= cfg.maxTicks || chainLength() > cfg.maxLength)) {
              mode = "retract";
            }
          }
        }
      }

      if (mode === "retract" && retractHold < 0) retractHold = cfg.holdTicks;
      if (mode === "retract" && retractHold > 0) {
        retractHold--;
      } else if (mode === "retract") {
        // a ponta volta pelo mesmo caminho, desfazendo cada dobra
        if (retractStep === 0) {
          retractStep = Math.max(cfg.retractMinSpeed, chainLength() / cfg.retractTicks);
        }
        let remaining = retractStep;
        while (remaining > 0 && chain.length > 1) {
          const tip = chain[chain.length - 1];
          const prev = chain[chain.length - 2];
          const seg = ginDist(prev, tip);
          if (seg <= remaining) {
            remaining -= seg;
            chain.pop();
          } else {
            const k = remaining / seg;
            tip.x += (prev.x - tip.x) * k;
            tip.y += (prev.y - tip.y) * k;
            tip.z += (prev.z - tip.z) * k;
            remaining = 0;
          }
        }
      }

      if (chain.length > 1 && (tick % cfg.drawEvery === 0 || mode === "retract")) {
        ginDrawBlade(dim, chain, cfg.drawBudget);
      }

      // segura os paralisados e solta quem caiu
      if (victims.length && tick % 4 === 0) {
        for (let i = victims.length - 1; i >= 0; i--) {
          if (isDownOrGone(victims[i])) {
            ginRelease(victims[i]);
            victims.splice(i, 1);
          } else {
            ginHoldParalysis(victims[i]);
          }
        }
      }

      if (mode === "retract" && chain.length <= 1) {
        system.clearRun(interval);
        finish();
        if (options.pierce) {
          try {
            player.sendMessage("§7O Shinso se retraiu.");
          } catch (e) {}
        }
      }
    } catch (e) {
      system.clearRun(interval);
      finish();
    }
  }, 1);
}

function castPursuingBlade(player) {
  const hand = ginHandOf(player);
  if (!ginNearestTarget(player, hand, PURSUING_BLADE.searchRadius)) {
    player.sendMessage("§7Não tem ninguém por perto pra perseguir.");
    return;
  }
  if (!tryUseSkill(player, "gin:pursuing_blade")) return;

  world.sendMessage(`§7${player.name}: §f§lPursuing Blade`);
  ginPlaySound(player, "item.trident.throw", 1.3, 1.4);
  launchSeekingBlade(player, PURSUING_BLADE, { damage: DAMAGE.ginPursuingBlade, pierce: false });
}

function castPiercingShinso(player) {
  const hand = ginHandOf(player);
  if (!ginNearestTarget(player, hand, PIERCING_SHINSO.searchRadius)) {
    player.sendMessage("§7Não tem ninguém por perto pra atravessar.");
    return;
  }
  if (!tryUseSkill(player, "gin:piercing_shinso")) return;

  world.sendMessage(`§7${player.name}: §f§lPiercing Shinso`);
  ginPlaySound(player, "item.trident.throw", 1.5, 1.1);
  launchSeekingBlade(player, PIERCING_SHINSO, { damage: DAMAGE.ginPiercingShinso, pierce: true });
}

/* ---------- Bankai: Kamishini no Yari (super, gatilho: agachar + m1 com o medidor em 100%) ---------- */

// desenha a lanca: bem densa perto do Gin e cada vez mais rala longe, pra
// 200 blocos nao estourarem o limite de particulas
function ginDrawSpear(dim, hand, dir, length) {
  let d = 0;
  while (d <= length) {
    try {
      dim.spawnParticle("gin:yari", {
        x: hand.x + dir.x * d,
        y: hand.y + dir.y * d,
        z: hand.z + dir.z * d,
      });
    } catch (e) {
      return;
    }
    d += d < 30 ? 0.9 : d < 80 ? 2 : 3.5;
  }
  try {
    dim.spawnParticle("gin:ponta", {
      x: hand.x + dir.x * length,
      y: hand.y + dir.y * length,
      z: hand.z + dir.z * length,
    });
  } catch (e) {}
}

// Quem encosta na lamina: entidade morre; player de tier MENOR que o do Gin
// morre; tier igual ou maior toma metade da vida maxima em dano.
function ginKamishiniStrike(player, entity) {
  if (isRespiring(entity)) {
    showRespiraGuard(entity);
    return;
  }
  if (isIntocable(entity)) {
    try {
      showIntocableGuard(entity);
    } catch (e) {}
    return;
  }

  if (entity.typeId === "minecraft:player" && tierOfPlayer(entity) >= tierOfPlayer(player)) {
    const hp = entity.getComponent("minecraft:health");
    const maxVirtual = (hp?.effectiveMax ?? 20) * healthScaleOf(entity);
    dealDamage(entity, maxVirtual * KAMISHINI.damageFraction, player, { breaksBlock: true });
    showGinSpark(entity);
    return;
  }

  showGinSpark(entity);
  try {
    entity.kill();
  } catch (e) {}
}

function activateKamishini(player) {
  const cfg = KAMISHINI;
  world.sendMessage(`§f§lBANKAI: KAMISHINI NO YARI! §r§7${player.name}: §fIkorose, Shinsō.`);
  ginPlaySound(player, "item.trident.throw", 2, 0.6);

  const dim = player.dimension;
  const dir = ginUnit(ginHandOf(player), ginAimPoint(player, cfg.range));
  const hit = new Set();
  const attackTicks = cfg.extendTicks + cfg.holdTicks;
  const total = attackTicks + cfg.retractTicks;
  let tick = 0;
  let testedUpTo = 0; // ate onde a lamina ja foi testada (na extensao so testa o trecho novo)

  const interval = system.runInterval(() => {
    tick++;
    try {
      if (!ginStillAlive(player)) {
        system.clearRun(interval);
        return;
      }

      let length;
      if (tick <= cfg.extendTicks) length = (cfg.range * tick) / cfg.extendTicks;
      else if (tick <= attackTicks) length = cfg.range;
      else length = cfg.range * Math.max(0, 1 - (tick - attackTicks) / cfg.retractTicks);

      if (length > 0.2) {
        const hand = ginHandOf(player);
        const at = (d) => ({ x: hand.x + dir.x * d, y: hand.y + dir.y * d, z: hand.z + dir.z * d });

        if (tick % cfg.drawEvery === 0 || tick === 1) ginDrawSpear(dim, hand, dir, length);

        if (tick <= attackTicks) {
          let from = 0;
          let to = length;
          if (tick <= cfg.extendTicks) from = testedUpTo; // so o trecho novo
          else if (tick % 3 !== 0) to = 0; // segurando: o blade inteiro, de 3 em 3 ticks
          if (to > from) {
            const a = at(from);
            const b = at(to);
            for (const entity of ginEntitiesOnSegment(player, a, b, cfg.hitRadius, hit)) {
              hit.add(entity.id);
              ginKamishiniStrike(player, entity);
            }
            testedUpTo = Math.max(testedUpTo, to);
          }
        }
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }

    if (tick >= total) system.clearRun(interval);
  }, 1);
}

function tryTriggerKamishini(player) {
  if (getAwakening(player) < 100) return false;
  if (skillBlockingZoneFor(player)) return false;

  player.setDynamicProperty(DP.awakening, 0);
  activateKamishini(player);
  return true;
}

/* ---------------------------------------------------------
   Toshiro Hitsugaya (Tier 4) - Hyōrinmaru / Daiguren Hyōrinmaru
   --------------------------------------------------------- */

const HITSUGAYA = {
  cdFreezeTicks: 60, // 3s: congelamento de cooldown do Ryūsenka e do Guncho Tsurara
  ryusenka: { range: 6, radius: 1.5, slowAmplifier: 2, slowTicks: 60 },
  sennen: { range: 40, height: 4, durationTicks: 200 }, // prende por 10s
  guncho: { waves: 3, perWave: 5, waveGapTicks: 3, speed: 2.4, lifeTicks: 24, radius: 0.9, spread: 0.06 },
  tenso: { durationTicks: 400, slowAmplifier: 1, dashCooldownMultiplier: 2 }, // chuva de 20s
  breath: { length: 30, halfWidth: 12, growTicks: 10, cdFreezeTicks: 200, restoreTicks: 600 },
  iceAge: { radius: 12, growTicks: 8, paralysisTicks: 100, noDashTicks: 300, restoreTicks: 600 },
  barrier: { walls: 4, durationTicks: 160, radius: 2 }, // 4 paredes, cada uma segura 1 golpe
  explosion: { radius: 40, reach: 3, yRange: 24, maxBursts: 60 },
  freezeSurface: { up: 3, down: 4 }, // quanto acima/abaixo do player procura o chao pra congelar
};

const cdFrozen = new Map(); // id -> { end, ticks } cooldowns parados
const iceBarriers = new Map(); // id -> { end, walls: [bool x4] }
let hitsugayaRain; // { until, ownerId }

// blocos que a magia de gelo nunca troca (tem inventario/estado que se perderia)
const ICE_KEEP =
  /chest|barrel|shulker|furnace|smoker|hopper|dropper|dispenser|spawner|_bed$|sign|door|command|banner|beacon|brewing|lectern|jukebox|sculk|structure|portal|frame/;

function isHitsugayaPlayer(entity) {
  try {
    return entity.typeId === "minecraft:player" && getActiveCharacter(entity)?.id === "hitsugaya";
  } catch (e) {
    return false;
  }
}

function hitsuFlat(player) {
  const v = player.getViewDirection();
  const h = Math.hypot(v.x, v.z) || 1;
  return { x: v.x / h, z: v.z / h };
}

/* ---------- blocos de gelo (com registro pra devolver depois) ---------- */

// todo gelo (e la) feito pelas skills fica registrado em "ledgers" com o bloco
// original. O Ice Explosion apaga o gelo lendo esses registros.
const iceRegistry = new Set();
function iceTrack(ledger) {
  iceRegistry.add(ledger);
  return ledger;
}
const ICE_TRAIL = iceTrack([]); // gelo da individualidade (agua por onde o Bankai anda)

function iceCanReplace(block) {
  if (!block) return false;
  if (GIN_UNBREAKABLE.has(block.typeId)) return false;
  return !ICE_KEEP.test(block.typeId);
}

function iceSet(ledger, dim, x, y, z, type) {
  try {
    const block = dim.getBlock({ x, y, z });
    if (!iceCanReplace(block) || block.typeId === type) return false;
    ledger.push({ dim, x, y, z, was: block.permutation });
    block.setType(type);
    return true;
  } catch (e) {
    return false;
  }
}

function iceRestoreEntry(e) {
  if (e.done) return;
  e.done = true;
  try {
    const block = e.dim.getBlock({ x: e.x, y: e.y, z: e.z });
    if (block) block.setPermutation(e.was);
  } catch (err) {}
}

function iceRestore(ledger) {
  for (let i = ledger.length - 1; i >= 0; i--) iceRestoreEntry(ledger[i]);
  ledger.length = 0;
  iceRegistry.delete(ledger);
}

// congela o primeiro bloco de verdade (agua ou solido) que achar de cima pra baixo
function iceFreezeColumn(dim, ledger, x, z, yTop, yBottom, forceType) {
  for (let y = yTop; y >= yBottom; y--) {
    let block;
    try {
      block = dim.getBlock({ x, y, z });
    } catch (e) {
      return false;
    }
    if (!block || block.isAir) continue;
    if (!block.isLiquid && block.isSolid === false) continue; // mato, flor: passa direto
    if (forceType) return iceSet(ledger, dim, x, y, z, forceType);
    if (block.typeId === "minecraft:packed_ice" || block.typeId === "minecraft:ice") return false;
    return iceSet(ledger, dim, x, y, z, block.isLiquid ? "minecraft:ice" : "minecraft:packed_ice");
  }
  return false;
}

/* ---------- efeitos de status ---------- */

function showIceSpark(entity) {
  try {
    const l = entity.location;
    for (let i = 0; i < 4; i++) {
      entity.dimension.spawnParticle(i % 2 === 0 ? "hitsugaya:gelo" : "hitsugaya:neve", {
        x: l.x + (Math.random() - 0.5) * 0.9,
        y: l.y + 0.4 + Math.random() * 1.2,
        z: l.z + (Math.random() - 0.5) * 0.9,
      });
    }
  } catch (e) {}
}

// Pausa os cooldowns de skill do player. Sem stack: enquanto um congelamento esta
// ativo, outro do mesmo tamanho (ou menor) e ignorado; so um MAIOR (o do Dragon's
// Breath, 10s) toma o lugar.
function freezeCooldowns(entity, ticks, message) {
  try {
    if (entity.typeId !== "minecraft:player") return;
    const now = system.currentTick;
    const cur = cdFrozen.get(entity.id);
    if (cur && cur.end > now && ticks <= cur.ticks) return;
    cdFrozen.set(entity.id, { end: now + ticks, ticks });
    entity.sendMessage(message ?? `§b❄ Seus cooldowns foram congelados por ${Math.round(ticks / 20)}s!`);
  } catch (e) {}
}

// a cada 4 ticks empurra o carimbo de cada cooldown em andamento: ele fica parado
// (inclusive skill usada durante o congelamento) e retoma quando acaba
system.runInterval(() => {
  const now = system.currentTick;
  for (const player of world.getPlayers()) {
    const state = cdFrozen.get(player.id);
    if (!state) continue;
    if (now >= state.end) {
      cdFrozen.delete(player.id);
      try {
        player.sendMessage("§7Seus cooldowns voltaram a correr.");
      } catch (e) {}
      continue;
    }
    for (const itemId in SKILL_COOLDOWN_TICKS) {
      const key = cdKeyForSkill(itemId);
      const stamp = tickOf(player, key);
      if (stamp === undefined || stamp > now) continue;
      if (now - stamp >= SKILL_COOLDOWN_TICKS[itemId]) continue; // nao estava em cooldown
      player.setDynamicProperty(key, Math.min(stamp + 4, now));
    }
  }
}, 4);

// paralisia por tempo fixo, pelas mesmas travas do isFrozen()
function paralyzeFor(entity, ticks, message) {
  const end = system.currentTick + ticks;
  ginParalyzed.set(entity.id, Math.max(ginParalyzed.get(entity.id) ?? 0, end));
  ginHoldParalysis(entity);
  ginParalyzed.set(entity.id, Math.max(ginParalyzed.get(entity.id) ?? 0, end));
  try {
    if (entity.typeId === "minecraft:player") entity.sendMessage(message ?? "§b❄ Você está congelado e paralisado!");
  } catch (e) {}
  const interval = system.runInterval(() => {
    if (isDownOrGone(entity) || system.currentTick >= end) {
      system.clearRun(interval);
      ginRelease(entity);
      return;
    }
    ginHoldParalysis(entity);
    ginParalyzed.set(entity.id, Math.max(ginParalyzed.get(entity.id) ?? 0, end));
  }, 4);
}

// golpe de gelo: dano, e (opcional) lentidao e congelamento de cooldown
function hitsuStrike(player, entity, damage, opts) {
  if (opts.ranged !== false && isRespiring(entity)) {
    showRespiraGuard(entity);
    return false;
  }
  dealDamage(entity, damage * dmgMultiplier(player), player);
  showIceSpark(entity);
  if (isIntocable(entity)) return false;
  if (opts.freezeTicks) freezeCooldowns(entity, opts.freezeTicks);
  if (opts.slowAmplifier != null) {
    try {
      entity.addEffect("slowness", opts.slowTicks, { amplifier: opts.slowAmplifier, showParticles: false });
    } catch (e) {}
  }
  return true;
}

/* ---------- Ryūsenka ---------- */

function castRyusenka(player) {
  if (!tryUseSkill(player, "hitsugaya:ryusenka")) return;

  world.sendMessage(`§b${player.name}: §f§lRyūsenka`);
  ginPlaySound(player, "random.glass", 1.3, 0.6);

  const cfg = HITSUGAYA.ryusenka;
  const dim = player.dimension;
  const hand = ginHandOf(player);
  const dir = ginUnit(hand, ginAimPoint(player, cfg.range));
  const tip = { x: hand.x + dir.x * cfg.range, y: hand.y + dir.y * cfg.range, z: hand.z + dir.z * cfg.range };

  // o gelo brota da mao ate a ponta em 3 ticks
  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    try {
      const reach = Math.min(1, tick / 3);
      const end = {
        x: hand.x + (tip.x - hand.x) * reach,
        y: hand.y + (tip.y - hand.y) * reach,
        z: hand.z + (tip.z - hand.z) * reach,
      };
      for (let d = 0; d <= ginDist(hand, end); d += 0.5) {
        dim.spawnParticle("hitsugaya:gelo", {
          x: hand.x + dir.x * d,
          y: hand.y + dir.y * d,
          z: hand.z + dir.z * d,
        });
      }
    } catch (e) {}
    if (tick >= 6) system.clearRun(interval);
  }, 1);

  for (const entity of ginEntitiesOnSegment(player, hand, tip, cfg.radius, null)) {
    hitsuStrike(player, entity, DAMAGE.ryusenka, {
      ranged: false,
      freezeTicks: HITSUGAYA.cdFreezeTicks,
      slowAmplifier: cfg.slowAmplifier,
      slowTicks: cfg.slowTicks,
    });
  }
}

/* ---------- Sennen Hyōrō: jaula de pilares de gelo ---------- */

function castSennenHyoro(player) {
  const cfg = HITSUGAYA.sennen;
  const target = targetInView(player, cfg.range);
  if (!target) {
    player.sendMessage("§7Mire em alguém pra prender.");
    return;
  }
  if (!tryUseSkill(player, "hitsugaya:sennen_hyoro")) return;

  world.sendMessage(`§b${player.name}: §f§lSennen Hyōrō §7(${nameOf(target)})`);
  ginPlaySound(player, "random.glass", 1.5, 0.5);

  const dim = target.dimension;
  const bx = Math.floor(target.location.x);
  const by = Math.floor(target.location.y);
  const bz = Math.floor(target.location.z);
  const ledger = iceTrack([]);
  const ICE = "minecraft:packed_ice";

  // centraliza o alvo na celula: com o corpo cruzando duas celulas os pilares
  // nasceriam dentro dele
  try {
    target.teleport({ x: bx + 0.5, y: target.location.y, z: bz + 0.5 }, { keepVelocity: false });
  } catch (e) {}

  const placeCell = (x, y, z) => {
    if (!ginBlockInfo(dim, new Map(), x, y, z).passable) return; // ja e parede
    iceSet(ledger, dim, x, y, z, ICE);
  };
  const ringLayer = (y) => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        placeCell(bx + dx, y, bz + dz);
      }
    }
    try {
      for (let i = 0; i < 6; i++) {
        dim.spawnParticle("hitsugaya:neve", {
          x: bx + 0.5 + (Math.random() - 0.5) * 3,
          y: y + 0.5,
          z: bz + 0.5 + (Math.random() - 0.5) * 3,
        });
      }
    } catch (e) {}
  };

  // os pilares sobem camada por camada, e no fim fecha o teto (e o chao)
  for (let h = 0; h < cfg.height; h++) {
    system.runTimeout(() => ringLayer(by + h), h * 2);
  }
  system.runTimeout(() => {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        placeCell(bx + dx, by + cfg.height, bz + dz);
        placeCell(bx + dx, by - 1, bz + dz);
      }
    }
  }, cfg.height * 2);

  system.runTimeout(() => {
    iceRestore(ledger);
    try {
      world.sendMessage(`§7A jaula de gelo se desfez e soltou §b${nameOf(target)}§7.`);
    } catch (e) {}
  }, cfg.durationTicks);
}

/* ---------- Guncho Tsurara: chuva de estacas ---------- */

function launchIceShard(player, dir, cache) {
  const cfg = HITSUGAYA.guncho;
  const dim = player.dimension;
  const head = player.getHeadLocation();
  let pos = { x: head.x + dir.x * 0.8, y: head.y - 0.2 + dir.y * 0.8, z: head.z + dir.z * 0.8 };
  let life = 0;
  const attack = trackAttack(player, cfg.radius);

  const interval = system.runInterval(() => {
    if (attack.cancelled) {
      system.clearRun(interval);
      return;
    }
    life++;
    touchAttack(attack, pos);
    try {
      const from = { ...pos };
      const to = { x: from.x + dir.x * cfg.speed, y: from.y + dir.y * cfg.speed, z: from.z + dir.z * cfg.speed };

      // bateu em bloco: estilhaca
      if (!ginBlockInfo(dim, cache, Math.floor(to.x), Math.floor(to.y), Math.floor(to.z)).passable) {
        dim.spawnParticle("hitsugaya:neve", from);
        system.clearRun(interval);
        return;
      }

      const [first] = ginEntitiesOnSegment(player, from, to, cfg.radius, null);
      if (first) {
        hitsuStrike(player, first, DAMAGE.gunchoTsurara, { freezeTicks: HITSUGAYA.cdFreezeTicks });
        system.clearRun(interval);
        return;
      }

      pos = to;
      dim.spawnParticle("hitsugaya:gelo", to);
      dim.spawnParticle("hitsugaya:gelo", { x: to.x - dir.x * 0.9, y: to.y - dir.y * 0.9, z: to.z - dir.z * 0.9 });
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (life >= cfg.lifeTicks) system.clearRun(interval);
  }, 1);
}

function castGunchoTsurara(player) {
  if (!tryUseSkill(player, "hitsugaya:guncho_tsurara")) return;

  world.sendMessage(`§b${player.name}: §f§lGuncho Tsurara`);
  ginPlaySound(player, "random.glass", 1.5, 1.3);

  const cfg = HITSUGAYA.guncho;
  const cache = new Map();
  for (let w = 0; w < cfg.waves; w++) {
    system.runTimeout(() => {
      try {
        if (isDownOrGone(player)) return;
        const view = player.getViewDirection();
        for (let i = 0; i < cfg.perWave; i++) {
          const d = {
            x: view.x + (Math.random() - 0.5) * 2 * cfg.spread * 1.5,
            y: view.y + (Math.random() - 0.5) * 2 * cfg.spread,
            z: view.z + (Math.random() - 0.5) * 2 * cfg.spread * 1.5,
          };
          const len = Math.hypot(d.x, d.y, d.z) || 1;
          launchIceShard(player, { x: d.x / len, y: d.y / len, z: d.z / len }, cache);
        }
      } catch (e) {}
    }, w * cfg.waveGapTicks);
  }
}

/* ---------- Tensō Jūrin: chuva ---------- */

function dashCooldownFor(player) {
  if (hitsugayaRain && system.currentTick < hitsugayaRain.until && !isHitsugayaPlayer(player)) {
    return DASH_COOLDOWN_TICKS * HITSUGAYA.tenso.dashCooldownMultiplier;
  }
  return DASH_COOLDOWN_TICKS;
}

function castTensoJurin(player) {
  if (!tryUseSkill(player, "hitsugaya:tenso_jurin")) return;

  const cfg = HITSUGAYA.tenso;
  world.sendMessage(`§b${player.name}: §f§lTensō Jūrin §7- começou a chover!`);
  ginPlaySound(player, "ambient.weather.thunder", 1, 1.2);
  try {
    player.dimension.runCommand(`weather rain ${cfg.durationTicks}`);
  } catch (e) {}

  const until = system.currentTick + cfg.durationTicks;
  hitsugayaRain = { until, ownerId: player.id, dim: player.dimension };
}

// enquanto chove: TODO ser vivo da dimensao (player, mob...) que nao e player de
// Hitsugaya fica com lentidao 2, ate a chuva acabar
system.runInterval(() => {
  if (!hitsugayaRain) return;
  if (system.currentTick >= hitsugayaRain.until) {
    hitsugayaRain = undefined;
    return;
  }
  try {
    for (const entity of hitsugayaRain.dim.getEntities({})) {
      if (isHitsugayaPlayer(entity)) continue;
      if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
      entity.addEffect("slowness", 20, { amplifier: HITSUGAYA.tenso.slowAmplifier, showParticles: false });
    }
  } catch (e) {}
}, 5);

/* ---------- Bankai: Dragon's Breath ---------- */

// colunas (x,z) de um raio de gelo ordenadas por distancia, pra ele "crescer"
function castDragonsBreath(player) {
  if (!tryUseSkill(player, "hitsugaya:dragons_breath")) return;

  world.sendMessage(`§b${player.name}: §f§lDragon's Breath`);
  ginPlaySound(player, "mob.enderdragon.growl", 1.5, 1.5);

  const cfg = HITSUGAYA.breath;
  const dim = player.dimension;
  const o = player.location;
  const f = hitsuFlat(player);
  const r = { x: -f.z, z: f.x };
  const columns = [];
  const seen = new Set();
  for (let a = 1; a <= cfg.length; a++) {
    const w = (cfg.halfWidth * a) / cfg.length;
    for (let b = -Math.floor(w); b <= Math.floor(w); b++) {
      const x = Math.floor(o.x + f.x * a + r.x * b);
      const z = Math.floor(o.z + f.z * a + r.z * b);
      const key = x + "," + z;
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push({ x, z, a });
    }
  }

  const ledger = iceTrack([]);
  const hit = new Set();
  const yTop = Math.floor(o.y) + HITSUGAYA.freezeSurface.up;
  const yBottom = Math.floor(o.y) - HITSUGAYA.freezeSurface.down;
  let idx = 0;
  let tick = 0;

  const interval = system.runInterval(() => {
    tick++;
    try {
      const front = (cfg.length * tick) / cfg.growTicks;
      while (idx < columns.length && columns[idx].a <= front) {
        const c = columns[idx];
        iceFreezeColumn(dim, ledger, c.x, c.z, yTop, yBottom);
        if (idx % 4 === 0) {
          dim.spawnParticle("hitsugaya:neve", { x: c.x + 0.5, y: o.y + 0.6 + Math.random(), z: c.z + 0.5 });
        }
        idx++;
      }

      for (const entity of dim.getEntities({ location: o, maxDistance: front + 3 })) {
        if (entity.id === player.id || hit.has(entity.id)) continue;
        if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
        const dx = entity.location.x - o.x;
        const dz = entity.location.z - o.z;
        const a = dx * f.x + dz * f.z;
        const b = dx * r.x + dz * r.z;
        if (a < 0 || a > front) continue;
        if (Math.abs(b) > (cfg.halfWidth * Math.max(a, 1)) / cfg.length + 0.8) continue;
        if (Math.abs(entity.location.y - o.y) > 6) continue;
        hit.add(entity.id);
        hitsuStrike(player, entity, DAMAGE.dragonsBreath, { freezeTicks: cfg.cdFreezeTicks });
      }
    } catch (e) {
      system.clearRun(interval);
      system.runTimeout(() => iceRestore(ledger), cfg.restoreTicks);
      return;
    }
    if (tick >= cfg.growTicks) {
      system.clearRun(interval);
      system.runTimeout(() => iceRestore(ledger), cfg.restoreTicks);
    }
  }, 1);
}

/* ---------- Bankai: Ice Age ---------- */

function castIceAge(player) {
  if (!tryUseSkill(player, "hitsugaya:ice_age")) return;

  world.sendMessage(`§b${player.name}: §f§lIce Age`);
  ginPlaySound(player, "random.glass", 2, 0.5);

  const cfg = HITSUGAYA.iceAge;
  const dim = player.dimension;
  const o = player.location;
  const columns = [];
  for (let dx = -cfg.radius; dx <= cfg.radius; dx++) {
    for (let dz = -cfg.radius; dz <= cfg.radius; dz++) {
      const d = Math.hypot(dx, dz);
      if (d <= cfg.radius) columns.push({ x: Math.floor(o.x) + dx, z: Math.floor(o.z) + dz, d });
    }
  }
  columns.sort((a, b) => a.d - b.d);

  // quem esta na area congela na hora
  for (const entity of dim.getEntities({ location: o, maxDistance: cfg.radius })) {
    if (entity.id === player.id) continue;
    if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
    paralyzeFor(entity, cfg.paralysisTicks);
    showIceSpark(entity);
    if (entity.typeId === "minecraft:player") {
      setCooldown(entity, DP.noDash, system.currentTick);
      try {
        entity.sendMessage("§b❄ Você ficou sem dash por 15s!");
      } catch (e) {}
    }
  }

  const ledger = iceTrack([]);
  const yTop = Math.floor(o.y) + HITSUGAYA.freezeSurface.up;
  const yBottom = Math.floor(o.y) - HITSUGAYA.freezeSurface.down;
  let idx = 0;
  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    try {
      const front = (cfg.radius * tick) / cfg.growTicks;
      while (idx < columns.length && columns[idx].d <= front) {
        const c = columns[idx];
        iceFreezeColumn(dim, ledger, c.x, c.z, yTop, yBottom);
        if (idx % 5 === 0) {
          dim.spawnParticle("hitsugaya:neve", { x: c.x + 0.5, y: o.y + 0.5 + Math.random() * 1.5, z: c.z + 0.5 });
        }
        idx++;
      }
    } catch (e) {
      tick = cfg.growTicks;
    }
    if (tick >= cfg.growTicks) {
      system.clearRun(interval);
      system.runTimeout(() => iceRestore(ledger), cfg.restoreTicks);
    }
  }, 1);
}

/* ---------- Bankai: Ice Barrier ---------- */

const BARRIER_DIRS = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
];

// chamada pelo dealDamage: uma parede segura um golpe inteiro (qualquer dano)
function absorbIceBarrier(target, source) {
  const barrier = iceBarriers.get(target.id);
  if (!barrier) return false;
  if (system.currentTick >= barrier.end) {
    iceBarriers.delete(target.id);
    return false;
  }

  // a parede que quebra e a que esta virada pra quem bateu
  let pick = barrier.walls.findIndex(Boolean);
  try {
    if (source && source.location) {
      const ang = Math.atan2(source.location.z - target.location.z, source.location.x - target.location.x);
      let best = Infinity;
      BARRIER_DIRS.forEach((d, i) => {
        if (!barrier.walls[i]) return;
        const diff = Math.abs(angleDiff(ang, Math.atan2(d.z, d.x)));
        if (diff < best) {
          best = diff;
          pick = i;
        }
      });
    }
  } catch (e) {}
  if (pick < 0) return false;

  barrier.walls[pick] = false;
  try {
    const d = BARRIER_DIRS[pick];
    const l = target.location;
    for (let i = 0; i < 10; i++) {
      target.dimension.spawnParticle("hitsugaya:gelo", {
        x: l.x + d.x * HITSUGAYA.barrier.radius + (Math.random() - 0.5) * 2,
        y: l.y + 0.3 + Math.random() * 2.2,
        z: l.z + d.z * HITSUGAYA.barrier.radius + (Math.random() - 0.5) * 2,
      });
    }
    target.dimension.playSound("random.glass", l, { volume: 1.2, pitch: 0.8 });
  } catch (e) {}
  if (!barrier.walls.some(Boolean)) {
    iceBarriers.delete(target.id);
    try {
      if (target.typeId === "minecraft:player") target.sendMessage("§7O Ice Barrier se quebrou por completo.");
    } catch (e) {}
  }
  return true;
}

function castIceBarrier(player) {
  if (!tryUseSkill(player, "hitsugaya:ice_barrier")) return;

  const cfg = HITSUGAYA.barrier;
  world.sendMessage(`§b${player.name}: §f§lIce Barrier`);
  ginPlaySound(player, "random.glass", 1.5, 0.7);

  const end = system.currentTick + cfg.durationTicks;
  const barrier = { end, walls: BARRIER_DIRS.map(() => true) };
  iceBarriers.set(player.id, barrier);

  const interval = system.runInterval(() => {
    try {
      if (iceBarriers.get(player.id) !== barrier || system.currentTick >= end || isDownOrGone(player)) {
        system.clearRun(interval);
        if (iceBarriers.get(player.id) === barrier) iceBarriers.delete(player.id);
        return;
      }
      const l = player.location;
      BARRIER_DIRS.forEach((d, i) => {
        if (!barrier.walls[i]) return;
        // painel de 3 de largura por 3 de altura, a `radius` blocos do player
        for (let s = -1; s <= 1; s++) {
          for (let h = 0; h < 3; h++) {
            player.dimension.spawnParticle("hitsugaya:gelo", {
              x: l.x + d.x * cfg.radius + -d.z * s * 0.9,
              y: l.y + 0.3 + h * 0.9,
              z: l.z + d.z * cfg.radius + d.x * s * 0.9,
            });
          }
        }
      });
    } catch (e) {
      system.clearRun(interval);
    }
  }, 4);
}

/* ---------- Bankai: Ice Explosion ---------- */

// O gelo que as skills do Hitsugaya fizeram (e o da individualidade) na area explode
// e some (volta ao bloco que era: chao, agua...). Quem esta colado no gelo leva o dano.
function castIceExplosion(player) {
  if (!tryUseSkill(player, "hitsugaya:ice_explosion")) return;

  world.sendMessage(`§b${player.name}: §f§lIce Explosion`);
  ginPlaySound(player, "random.explode", 2, 0.7);

  const cfg = HITSUGAYA.explosion;
  const dim = player.dimension;
  const o = player.location;

  const found = [];
  for (const ledger of iceRegistry) {
    for (const e of ledger) {
      if (e.done || e.dim !== dim) continue;
      if (Math.hypot(e.x + 0.5 - o.x, e.z + 0.5 - o.z) > cfg.radius) continue;
      if (Math.abs(e.y - o.y) > cfg.yRange) continue;
      found.push(e);
    }
  }
  const cells = new Set(found.map((e) => e.x + "," + e.y + "," + e.z));
  const touchesIce = (entity) => {
    const bx = Math.floor(entity.location.x);
    const by = Math.floor(entity.location.y);
    const bz = Math.floor(entity.location.z);
    const r = cfg.reach;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (cells.has(bx + dx + "," + (by + dy) + "," + (bz + dz))) return true;
        }
      }
    }
    return false;
  };

  // quem esta no gelo (ou encostado nele) explode; player de Harribel no meio da
  // area explode de qualquer jeito
  for (const entity of dim.getEntities({ location: o, maxDistance: cfg.radius })) {
    if (entity.id === player.id) continue;
    if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
    const harribel = entity.typeId === "minecraft:player" && getActiveCharacter(entity)?.id === "harribel";
    if (!harribel && !touchesIce(entity)) continue;
    hitsuStrike(player, entity, DAMAGE.iceExplosion, { ranged: false });
    try {
      dim.spawnParticle("hitsugaya:explosao", { x: entity.location.x, y: entity.location.y + 1, z: entity.location.z });
    } catch (e) {}
  }

  // o gelo vai explodindo e sumindo em fatias (com um estouro visual a cada tantos)
  const slices = 6;
  const perSlice = Math.max(1, Math.ceil(found.length / slices));
  const stride = Math.max(1, Math.floor(found.length / cfg.maxBursts));
  let idx = 0;
  let bursts = 0;
  const interval = system.runInterval(() => {
    try {
      for (let n = 0; n < perSlice && idx < found.length; n++, idx++) {
        const e = found[idx];
        if (idx % stride === 0 && bursts < cfg.maxBursts) {
          bursts++;
          dim.spawnParticle("hitsugaya:explosao", { x: e.x + 0.5, y: e.y + 0.7, z: e.z + 0.5 });
          if (bursts % 6 === 0) dim.playSound("random.explode", { x: e.x, y: e.y, z: e.z }, { volume: 0.8, pitch: 1 });
        }
        iceRestoreEntry(e);
      }
    } catch (err) {
      system.clearRun(interval);
      return;
    }
    if (idx >= found.length) system.clearRun(interval);
  }, 1);
}

/* ---------- Individualidade do Bankai: asas, cauda e agua que congela ---------- */

system.runInterval(() => {
  const now = system.currentTick;
  for (const player of world.getPlayers()) {
    try {
      if (!isHitsugayaPlayer(player) || !isAwakened(player)) continue;
      const dim = player.dimension;
      const l = player.location;

      // a agua por onde ele anda vira gelo (ate 2 blocos ao redor e 1 abaixo)
      const bx = Math.floor(l.x);
      const by = Math.floor(l.y);
      const bz = Math.floor(l.z);
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          if (dx * dx + dz * dz > 5) continue;
          for (let dy = -1; dy <= 0; dy++) {
            const block = dim.getBlock({ x: bx + dx, y: by + dy, z: bz + dz });
            if (block && block.isLiquid && block.typeId.includes("water")) {
              iceSet(ICE_TRAIL, dim, bx + dx, by + dy, bz + dz, "minecraft:ice");
            }
          }
        }
      }

      if (ICE_TRAIL.length > 3000) ICE_TRAIL.splice(0, 500); // so os mais recentes ficam explodiveis
      if (now % 6 !== 0) continue;
      const yaw = (player.getRotation().y * Math.PI) / 180;
      const back = { x: Math.sin(yaw), z: -Math.cos(yaw) }; // costas do player
      const side = { x: Math.cos(yaw), z: Math.sin(yaw) };
      const shoulder = { x: l.x + back.x * 0.35, y: l.y + 1.35, z: l.z + back.z * 0.35 };
      const flap = Math.sin(now * 0.12) * 0.18;

      // duas asas de tres penas
      for (const s of [-1, 1]) {
        [0.35, 0.8, 1.25].forEach((angle, i) => {
          const a = angle + flap;
          const len = 2.4 - i * 0.5;
          for (let k = 1; k <= 4; k++) {
            const d = (len * k) / 4;
            dim.spawnParticle("hitsugaya:gelo", {
              x: shoulder.x + side.x * s * Math.sin(a) * d + back.x * d * 0.35,
              y: shoulder.y + Math.cos(a) * d,
              z: shoulder.z + side.z * s * Math.sin(a) * d + back.z * d * 0.35,
            });
          }
        });
      }

      // cauda ondulando pra tras
      const waist = { x: l.x + back.x * 0.3, y: l.y + 0.9, z: l.z + back.z * 0.3 };
      for (let k = 1; k <= 8; k++) {
        const wave = Math.sin(k * 0.6 + now * 0.1);
        dim.spawnParticle("hitsugaya:gelo", {
          x: waist.x + back.x * k * 0.4 + side.x * wave * 0.3,
          y: waist.y - k * 0.06 + Math.sin(k * 0.5 + now * 0.08) * 0.2,
          z: waist.z + back.z * k * 0.4 + side.z * wave * 0.3,
        });
      }
    } catch (e) {}
  }
}, 2);

function showShunsuiSpark(entity) {
  try {
    const l = entity.location;
    for (let i = 0; i < 4; i++) {
      entity.dimension.spawnParticle(i % 2 === 0 ? "shunsui:corte" : "shunsui:sombra", {
        x: l.x + (Math.random() - 0.5) * 0.9,
        y: l.y + 0.4 + Math.random() * 1.2,
        z: l.z + (Math.random() - 0.5) * 0.9,
      });
    }
  } catch (e) {}
}

/* ---------------------------------------------------------
   Shunsui Kyoraku (Tier 5) - Katen Kyokotsu
   Takaoni, Irooni e Jokenpo sao "jogos": enquanto um esta rolando, o Shunsui
   nao usa outra skill.
   --------------------------------------------------------- */

const SHUNSUI = {
  kageoni: { range: 30, slashes: 2, gapTicks: 4, behind: [1.6, 2.4, 1.0] },
  takaoni: { half: 12.5, warnTicks: 100 }, // area de 25x25, 5s pra subir
  irooni: { arena: 20, tile: 5, affectRadius: 50, warnTicks: 100 }, // 5s pra ir na cor
  jokenpo: {
    range: 40,
    answerTicks: 400, // 20s pra escolher em cada rodada
    maxRounds: 15,
    penaltyCooldownTicks: 100, // perdedor: +5s em todas as skills
    vulnerableTicks: 200, // e 10s tomando mais dano
    vulnerableMultiplier: 1.5,
  },
};

const shunsuiInGame = new Set(); // ids de quem esta no meio de um jogo
const vulnerableUntil = new Map(); // id -> tick (Jokenpo: perdedor toma 50% a mais)

// chamada pelo dealDamage
function vulnerabilityMultiplierOf(entity) {
  const end = vulnerableUntil.get(entity.id);
  if (end === undefined) return 1;
  if (system.currentTick >= end) {
    vulnerableUntil.delete(entity.id);
    return 1;
  }
  return SHUNSUI.jokenpo.vulnerableMultiplier;
}

function shunsuiGate(player) {
  if (shunsuiInGame.has(player.id)) {
    player.sendMessage("§7Termine o jogo atual antes de usar outra skill.");
    return false;
  }
  return true;
}

// soma `ticks` ao que falta de cooldown de cada skill do personagem (a que estava
// livre passa a ter `ticks` de cooldown). O carimbo nao passa do cooldown cheio.
function extendCooldowns(entity, ticks) {
  try {
    if (entity.typeId !== "minecraft:player") return;
    const character = getActiveCharacter(entity);
    if (!character) return;
    const now = system.currentTick;
    const ids = [
      ...Object.values(character.items ?? {}),
      ...Object.values(character.awakening?.items ?? {}),
    ];
    for (const itemId of new Set(ids)) {
      const duration = SKILL_COOLDOWN_TICKS[itemId];
      if (!duration) continue;
      const key = cdKeyForSkill(itemId);
      const stamp = tickOf(entity, key);
      const remaining = stamp !== undefined && stamp <= now ? Math.max(0, duration - (now - stamp)) : 0;
      const next = Math.min(duration, remaining + ticks);
      entity.setDynamicProperty(key, now - (duration - next));
    }
  } catch (e) {}
}

function shunsuiTitle(player, title, subtitle) {
  try {
    player.onScreenDisplay.setTitle(title, {
      subtitle,
      fadeInDuration: 3,
      stayDuration: 60,
      fadeOutDuration: 6,
    });
  } catch (e) {}
}

/* ---------- Kageoni ---------- */

function castKageoni(player) {
  if (!shunsuiGate(player)) return;
  const cfg = SHUNSUI.kageoni;
  const target = targetInView(player, cfg.range);
  if (!target) {
    player.sendMessage("§7Mire em alguém pra aparecer nas costas.");
    return;
  }
  if (!tryUseSkill(player, "shunsui:kageoni")) return;

  world.sendMessage(`§c${player.name}: §f§lKageoni §7(${nameOf(target)})`);
  const dim = player.dimension;
  const from = player.location;
  const t = target.location;

  // ponto livre nas costas do alvo (o lado pra onde ele NAO olha). Sem espaco atras
  // (parede), tenta as laterais e por ultimo a frente.
  const view = target.getViewDirection();
  const h = Math.hypot(view.x, view.z) || 1;
  const back = { x: -view.x / h, z: -view.z / h };
  const dirs = [
    back,
    { x: -back.z, z: back.x },
    { x: back.z, z: -back.x },
    { x: -back.x, z: -back.z },
  ];
  const cache = new Map();
  const free = (x, z) => {
    const fx = Math.floor(x);
    const fy = Math.floor(t.y);
    const fz = Math.floor(z);
    return ginBlockInfo(dim, cache, fx, fy, fz).passable && ginBlockInfo(dim, cache, fx, fy + 1, fz).passable;
  };
  let dest;
  for (const dir of dirs) {
    for (const d of cfg.behind) {
      if (free(t.x + dir.x * d, t.z + dir.z * d)) {
        dest = { x: t.x + dir.x * d, y: t.y, z: t.z + dir.z * d };
        break;
      }
    }
    if (dest) break;
  }
  dest = dest ?? { x: t.x + back.x * cfg.behind[0], y: t.y, z: t.z + back.z * cfg.behind[0] };

  try {
    dim.spawnParticle("shunsui:sombra", { x: from.x, y: from.y + 1, z: from.z });
    player.teleport(dest, { facingLocation: { x: t.x, y: t.y + 1.2, z: t.z } });
    dim.spawnParticle("shunsui:sombra", { x: dest.x, y: dest.y + 1, z: dest.z });
  } catch (e) {}
  ginPlaySound(player, "mob.endermen.portal", 1, 1.4);

  // duplo corte em X: cada diagonal e um corte (metade do dano em cada)
  const perHit = (DAMAGE.kageoni / cfg.slashes) * dmgMultiplier(player);
  for (let i = 0; i < cfg.slashes; i++) {
    system.runTimeout(() => {
      try {
        if (isDownOrGone(target)) return;
        const c = target.location;
        const side = i % 2 === 0 ? 1 : -1;
        const dx = dest.x - c.x;
        const dz = dest.z - c.z;
        const len = Math.hypot(dx, dz) || 1;
        const rx = -dz / len; // perpendicular a linha player-alvo
        const rz = dx / len;
        for (let k = -1.4; k <= 1.4; k += 0.2) {
          dim.spawnParticle("shunsui:corte", {
            x: c.x + rx * k * side,
            y: c.y + 1 + k * 0.9,
            z: c.z + rz * k * side,
          });
        }
        dealDamage(target, perHit, player);
        showShunsuiSpark(target);
      } catch (e) {}
    }, i * cfg.gapTicks + 1);
  }
}

/* ---------- Takaoni ---------- */

function castTakaoni(player) {
  if (!shunsuiGate(player)) return;
  if (!tryUseSkill(player, "shunsui:takaoni")) return;

  const cfg = SHUNSUI.takaoni;
  const dim = player.dimension;
  const c = { x: player.location.x, y: player.location.y, z: player.location.z };
  shunsuiInGame.add(player.id);
  world.sendMessage(
    `§c${player.name}: §f§lTakaoni §7- quem estiver mais alto se safa, o resto leva ${DAMAGE.takaoni}! (${cfg.warnTicks / 20}s)`
  );

  const inArea = (entity) =>
    Math.abs(entity.location.x - c.x) <= cfg.half && Math.abs(entity.location.z - c.z) <= cfg.half;

  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    try {
      // contorno da area, pra todo mundo ver os limites
      if (tick % 10 === 1) {
        for (let d = -cfg.half; d <= cfg.half; d += 2.5) {
          for (const [x, z] of [
            [c.x + d, c.z - cfg.half],
            [c.x + d, c.z + cfg.half],
            [c.x - cfg.half, c.z + d],
            [c.x + cfg.half, c.z + d],
          ]) {
            dim.spawnParticle("shunsui:sombra", { x, y: c.y + 0.4, z });
          }
        }
      }
      if (tick % 20 === 0 && tick < cfg.warnTicks) {
        const left = Math.round((cfg.warnTicks - tick) / 20);
        for (const p of dim.getPlayers({ location: c, maxDistance: cfg.half * 2 })) {
          if (inArea(p)) p.onScreenDisplay.setActionBar(`§cTakaoni: §fsuba! §e${left}s`);
        }
      }
    } catch (e) {}

    if (tick < cfg.warnTicks) return;
    system.clearRun(interval);

    try {
      const inside = [];
      for (const entity of dim.getEntities({ location: c, maxDistance: cfg.half * 2 + 60 })) {
        if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
        if (inArea(entity)) inside.push(entity);
      }
      // o(s) mais alto(s) se safa(m); Shunsui entra na conta como qualquer um
      const top = inside.reduce((best, e) => Math.max(best, e.location.y), -Infinity);
      const bottom = inside.reduce((best, e) => Math.min(best, e.location.y), Infinity);
      // todo mundo na mesma altura (com pelo menos 2 em cena): ninguem esta "mais alto", todos levam
      const allSameHeight = inside.length >= 2 && top - bottom <= 0.05;
      let hitCount = 0;
      for (const entity of inside) {
        if (!allSameHeight && entity.location.y >= top - 0.05) {
          entity.dimension.spawnParticle("shunsui:sombra", { x: entity.location.x, y: entity.location.y + 2.2, z: entity.location.z });
          continue;
        }
        dealDamage(entity, DAMAGE.takaoni, isDownOrGone(player) ? undefined : player);
        showShunsuiSpark(entity);
        hitCount++;
      }
      world.sendMessage(`§7Takaoni acabou: §f${hitCount}§7 levaram o golpe.`);
    } catch (e) {}
    shunsuiInGame.delete(player.id);
  }, 1);
}

/* ---------- Irooni ---------- */

const IROONI_COLORS = [
  { name: "AZUL", code: "§9", block: "minecraft:blue_wool" },
  { name: "VERMELHA", code: "§c", block: "minecraft:red_wool" },
  { name: "PRETA", code: "§8", block: "minecraft:black_wool" },
  { name: "BRANCA", code: "§f", block: "minecraft:white_wool" },
];

function castIrooni(player) {
  if (!shunsuiGate(player)) return;
  if (!tryUseSkill(player, "shunsui:irooni")) return;

  const cfg = SHUNSUI.irooni;
  const dim = player.dimension;
  const o = player.location;
  shunsuiInGame.add(player.id);
  world.sendMessage(`§c${player.name}: §f§lIrooni §7- cada um vai pra lã da sua cor! (${cfg.warnTicks / 20}s)`);

  // arena de 20x20 em quadrados de 5x5 (4x4 = 16), 4 de cada cor, embaralhados
  const tiles = cfg.arena / cfg.tile;
  const palette = [];
  for (let i = 0; i < tiles * tiles; i++) palette.push(i % IROONI_COLORS.length);
  for (let i = palette.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [palette[i], palette[j]] = [palette[j], palette[i]];
  }
  const ledger = iceTrack([]);
  const x0 = Math.floor(o.x) - cfg.arena / 2;
  const z0 = Math.floor(o.z) - cfg.arena / 2;
  const yTop = Math.floor(o.y) + 3;
  const yBottom = Math.floor(o.y) - 4;
  for (let dx = 0; dx < cfg.arena; dx++) {
    for (let dz = 0; dz < cfg.arena; dz++) {
      const color = IROONI_COLORS[palette[Math.floor(dz / cfg.tile) * tiles + Math.floor(dx / cfg.tile)]];
      iceFreezeColumn(dim, ledger, x0 + dx, z0 + dz, yTop, yBottom, color.block);
    }
  }

  // sorteia uma cor pra cada player na area de 50 blocos (Shunsui incluso)
  const assigned = new Map();
  const players = dim.getPlayers({ location: o, maxDistance: cfg.affectRadius });
  for (const p of players) {
    if (isDownOrGone(p)) continue;
    const color = IROONI_COLORS[Math.floor(Math.random() * IROONI_COLORS.length)];
    assigned.set(p.id, { player: p, color });
    shunsuiTitle(p, `${color.code}§l${color.name}`, `§7Fique na lã ${color.name.toLowerCase()} em ${cfg.warnTicks / 20}s!`);
    p.sendMessage(`§eSua cor: ${color.code}§lLÃ ${color.name}`);
  }

  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    try {
      if (tick % 20 === 0 && tick < cfg.warnTicks) {
        const left = Math.round((cfg.warnTicks - tick) / 20);
        for (const { player: p, color } of assigned.values()) {
          if (!isDownOrGone(p)) p.onScreenDisplay.setActionBar(`${color.code}§l${color.name} §e${left}s`);
        }
      }
    } catch (e) {}
    if (tick < cfg.warnTicks) return;
    system.clearRun(interval);

    let punished = 0;
    for (const { player: p, color } of assigned.values()) {
      try {
        if (isDownOrGone(p)) continue;
        const l = p.location;
        const under = p.dimension.getBlock({
          x: Math.floor(l.x),
          y: Math.floor(l.y - 0.1),
          z: Math.floor(l.z),
        });
        if (under?.typeId === color.block) continue;
        dealDamage(p, DAMAGE.irooni, isDownOrGone(player) ? undefined : player);
        showShunsuiSpark(p);
        punished++;
      } catch (e) {}
    }
    // acabou o jogo: as la somem e voltam a ser o bloco que estava ali
    iceRestore(ledger);
    world.sendMessage(`§7Irooni acabou: §f${punished}§7 na cor errada.`);
    shunsuiInGame.delete(player.id);
  }, 1);
}

/* ---------- Jokenpo ---------- */

const JOKENPO = ["Pedra", "Papel", "Tesoura"];

// 1 = a vence, -1 = b vence, 0 = empate (0 pedra, 1 papel, 2 tesoura)
function jokenpoResult(a, b) {
  if (a === b) return 0;
  return (a - b + 3) % 3 === 1 ? 1 : -1;
}

function sleepTicks(ticks) {
  return new Promise((resolve) => system.runTimeout(resolve, ticks));
}

// Abre o menu e espera a escolha. Fechou o menu ou estava ocupado? abre de novo.
// Estourou o tempo? null (perde por WO).
async function askJokenpo(player, foe, deadline) {
  const form = new ActionFormData()
    .title("§l§6Jokenpô")
    .body(`§7Você contra §e${foe.name}§7\nEscolha:`)
    .button("§lPedra")
    .button("§lPapel")
    .button("§lTesoura");
  while (system.currentTick < deadline) {
    if (isDownOrGone(player)) return null;
    const left = deadline - system.currentTick;
    let res;
    try {
      res = await Promise.race([form.show(player), sleepTicks(left).then(() => ({ timeout: true }))]);
    } catch (e) {
      return null;
    }
    if (res?.timeout) return null;
    if (res && !res.canceled && res.selection !== undefined) return res.selection;
    await sleepTicks(10);
  }
  return null;
}

async function runJokenpo(caster, target) {
  const cfg = SHUNSUI.jokenpo;
  try {
    for (let round = 1; round <= cfg.maxRounds; round++) {
      const deadline = system.currentTick + cfg.answerTicks;
      const [a, b] = await Promise.all([
        askJokenpo(caster, target, deadline),
        askJokenpo(target, caster, deadline),
      ]);

      if (a === null && b === null) {
        world.sendMessage("§7Jokenpô cancelado: ninguém escolheu.");
        return;
      }
      let result;
      if (a === null) result = -1;
      else if (b === null) result = 1;
      else result = jokenpoResult(a, b);

      world.sendMessage(
        `§6[Jokenpô] §e${caster.name} §f${a === null ? "(nada)" : JOKENPO[a]} §7x §f${b === null ? "(nada)" : JOKENPO[b]} §e${target.name}`
      );
      if (result === 0) {
        world.sendMessage("§6[Jokenpô] §7Empate! Outra rodada.");
        continue;
      }

      const loser = result > 0 ? target : caster;
      const winner = result > 0 ? caster : target;
      world.sendMessage(`§6[Jokenpô] §a${winner.name} §fvenceu! §c${loser.name}§f perdeu.`);
      try {
        extendCooldowns(loser, cfg.penaltyCooldownTicks);
        vulnerableUntil.set(loser.id, system.currentTick + cfg.vulnerableTicks);
        loser.sendMessage(
          `§cVocê perdeu: +${cfg.penaltyCooldownTicks / 20}s de cooldown em todas as skills e ${Math.round((cfg.vulnerableMultiplier - 1) * 100)}% mais dano por ${cfg.vulnerableTicks / 20}s!`
        );
        showShunsuiSpark(loser);
      } catch (e) {}
      return;
    }
    world.sendMessage("§7Jokenpô encerrado: rodadas demais sem vencedor.");
  } finally {
    shunsuiInGame.delete(caster.id);
  }
}

function castJokenpo(player) {
  if (!shunsuiGate(player)) return;
  const cfg = SHUNSUI.jokenpo;
  const target = targetInView(player, cfg.range);
  if (!target || target.typeId !== "minecraft:player") {
    player.sendMessage("§7Mire em um player pra jogar Jokenpô.");
    return;
  }
  if (!tryUseSkill(player, "shunsui:jokenpo")) return;

  shunsuiInGame.add(player.id);
  world.sendMessage(`§6${player.name}: §f§lJokenpô §7contra §e${target.name}§7!`);
  runJokenpo(player, target);
}

/* ---------- Awk-Bankai: Karamatsu Shinjū (super, gatilho: agachar + m1 com o medidor em 100%) ---------- */

const KARAMATSU = {
  radius: 50,
  // ticks entre a fala de cada ato e o efeito dele
  speechToEffect: [60, 40, 60, 40],
  actGapTicks: 100, // a troca de atos demora 5s
  healthFraction: 0.5, // 1o ato
  bleed: { damage: 50, times: 5 }, // 2o ato: 50 por segundo, por 5s
  sameTierDamage: 800, // 4o ato: tier igual leva isso, tier menor morre
  afterKillTicks: 40, // depois do fim da peça a agua ainda fica um pouco
  // 3o ato: cada player da peca fica dentro de uma caixa de agua
  boxHalf: 2, // 5x5
  boxBelow: 1,
  boxAbove: 3, // e 5 de altura
  leakMargin: 6, // a agua corrente que escorre da caixa e limpa nessa folga
  cleanupPasses: 2,
};
const KARAMATSU_LINES = [
  "“Quando duas pessoas se envolvem nessa tragédia, os ferimentos de uma acabam sendo compartilhados pela outra.”",
  "“As feridas continuam se acumulando, e o corpo começa a perder sangue, como se a própria doença da tragédia estivesse consumindo você.”",
  "“Agora, somos arrastados para o fundo de um sofrimento sem fim, como se estivéssemos afundando em um oceano de tristeza.”",
  "“E, finalmente, chega o último ato. Depois de todo esse sofrimento, resta apenas o fim da peça.”",
];
const KARAMATSU_ACTS = ["Primeiro Ato", "Segundo Ato", "Terceiro Ato", "Quarto Ato"];

// quem esta dentro da peca nao toma dano de ninguem (so da propria peca)
const karamatsuProtected = new Set();

// empurra pra fora da area quem tem tier maior que o do Shunsui
function karamatsuPushOut(player, center, cfg, dim) {
  const l = player.location;
  const dx = l.x - center.x;
  const dz = l.z - center.z;
  const d = Math.hypot(dx, dz);
  if (d >= cfg.radius) return;
  const ux = d < 0.01 ? 1 : dx / d;
  const uz = d < 0.01 ? 0 : dz / d;
  const x = center.x + ux * (cfg.radius + 3);
  const z = center.z + uz * (cfg.radius + 3);
  const cache = new Map();
  for (let up = 0; up <= 12; up++) {
    const fy = Math.floor(l.y) + up;
    if (
      ginBlockInfo(dim, cache, Math.floor(x), fy, Math.floor(z)).passable &&
      ginBlockInfo(dim, cache, Math.floor(x), fy + 1, Math.floor(z)).passable
    ) {
      try {
        player.teleport({ x, y: fy, z });
        player.sendMessage("§7A peça está em cena: quem tem tier maior não entra na área.");
      } catch (e) {}
      return;
    }
  }
}

async function runKaramatsu(shun) {
  const cfg = KARAMATSU;
  const dim = shun.dimension;
  const center = { x: shun.location.x, y: shun.location.y, z: shun.location.z };
  const myTier = tierOfPlayer(shun);
  const inArea = (e) => Math.hypot(e.location.x - center.x, e.location.z - center.z) <= cfg.radius;
  const alive = (e) => {
    try {
      return !isDownOrGone(e);
    } catch (err) {
      return false;
    }
  };

  // quem participa: todo ser vivo da area, menos player de tier MAIOR (esse fica de fora)
  const affected = [];
  for (const entity of dim.getEntities({ location: center, maxDistance: cfg.radius })) {
    if (!entity.getComponent("minecraft:health") || !alive(entity)) continue;
    if (entity.typeId === "minecraft:player" && tierOfPlayer(entity) > myTier) continue;
    affected.push(entity);
  }
  if (!affected.includes(shun)) affected.push(shun);

  shunsuiInGame.add(shun.id);
  for (const e of affected) karamatsuProtected.add(e.id);
  const floodCells = []; // celulas que viraram agua (so as que eram ar)
  const boxes = [];

  world.sendMessage(`§4§lKaramatsu Shinjū §r§7- a peça começou! §f(${affected.length} em cena)`);

  // segura os espectadores no lugar e mantem os de tier maior fora da area
  const guard = system.runInterval(() => {
    try {
      for (const e of affected) {
        if (e !== shun && alive(e)) ginHoldParalysis(e);
      }
      for (const p of dim.getPlayers({ location: center, maxDistance: cfg.radius + 5 })) {
        if (p.id !== shun.id && tierOfPlayer(p) > myTier && !affected.includes(p)) {
          karamatsuPushOut(p, center, cfg, dim);
        }
      }
    } catch (e) {}
  }, 10);

  const say = (act) => {
    world.sendMessage(`§c<${shun.name}> §f${KARAMATSU_LINES[act]}`);
    for (const e of affected) {
      if (e.typeId === "minecraft:player" && alive(e)) shunsuiTitle(e, `§4§l${KARAMATSU_ACTS[act]}`, "§7Karamatsu Shinjū");
    }
  };

  try {
    // ---- 1o ato: todos ficam com 50% de vida ----
    say(0);
    await sleepTicks(cfg.speechToEffect[0]);
    if (!alive(shun)) return;
    for (const e of affected) {
      if (!alive(e)) continue;
      const hp = e.getComponent("minecraft:health");
      const half = hp.effectiveMax * cfg.healthFraction;
      if (hp.currentValue > half) hp.setCurrentValue(half);
      try {
        dim.spawnParticle("shunsui:sombra", { x: e.location.x, y: e.location.y + 1, z: e.location.z });
      } catch (err) {}
    }
    await sleepTicks(cfg.actGapTicks);
    if (!alive(shun)) return;

    // ---- 2o ato: 50 de dano por segundo, por 5s ----
    say(1);
    await sleepTicks(cfg.speechToEffect[1]);
    for (let i = 0; i < cfg.bleed.times; i++) {
      if (!alive(shun)) return;
      for (const e of affected) {
        if (!alive(e) || isIntocable(e)) continue;
        dealDamage(e, cfg.bleed.damage, shun, { karamatsu: true, breaksBlock: true });
        try {
          dim.spawnParticle("shunsui:sombra", { x: e.location.x, y: e.location.y + 1.3, z: e.location.z });
        } catch (err) {}
      }
      await sleepTicks(20);
    }
    await sleepTicks(Math.max(0, cfg.actGapTicks - 20));
    if (!alive(shun)) return;

    // ---- 3o ato: cada player da peca fica dentro de uma caixa de agua 5x5 ----
    say(2);
    await sleepTicks(cfg.speechToEffect[2]);
    if (!alive(shun)) return;
    for (const e of affected) {
      if (e.typeId !== "minecraft:player" || !alive(e)) continue;
      const bx = Math.floor(e.location.x);
      const by = Math.floor(e.location.y);
      const bz = Math.floor(e.location.z);
      const box = {
        xa: bx - cfg.boxHalf,
        xb: bx + cfg.boxHalf,
        za: bz - cfg.boxHalf,
        zb: bz + cfg.boxHalf,
        ya: by - cfg.boxBelow,
        yb: by + cfg.boxAbove,
      };
      boxes.push(box);
      // so troca AR por agua e anota cada celula, pra devolver exatamente
      for (let x = box.xa; x <= box.xb; x++) {
        for (let y = box.ya; y <= box.yb; y++) {
          for (let z = box.za; z <= box.zb; z++) {
            try {
              const b = dim.getBlock({ x, y, z });
              if (b && b.isAir) {
                b.setType("minecraft:water");
                floodCells.push([x, y, z]);
              }
            } catch (err) {}
          }
        }
      }
    }
    shun.addEffect("water_breathing", 1200, { amplifier: 0, showParticles: false }); // so o Shunsui respira
    await sleepTicks(cfg.actGapTicks);
    if (!alive(shun)) return;

    // ---- 4o ato: fim da peca ----
    say(3);
    await sleepTicks(cfg.speechToEffect[3]);
    if (!alive(shun)) return;
    let dead = 0;
    for (const e of affected) {
      if (e === shun || !alive(e) || isIntocable(e)) continue;
      try {
        if (e.typeId === "minecraft:player" && tierOfPlayer(e) >= myTier) {
          // mesmo tier: nao morre, mas leva 800
          dealDamage(e, cfg.sameTierDamage, shun, { karamatsu: true, breaksBlock: true });
        } else {
          e.kill();
          dead++;
        }
        dim.spawnParticle("shunsui:corte", { x: e.location.x, y: e.location.y + 1, z: e.location.z });
      } catch (err) {}
    }
    world.sendMessage(`§4Fim da peça. §7${dead} não resistiram.`);
    await sleepTicks(cfg.afterKillTicks);
  } finally {
    system.clearRun(guard);
    // solta todo mundo primeiro; a limpeza da agua continua em segundo plano
    for (const e of affected) {
      karamatsuProtected.delete(e.id);
      try {
        ginRelease(e);
      } catch (err) {}
    }
    shunsuiInGame.delete(shun.id);
    try {
      shun.removeEffect("water_breathing");
    } catch (e) {}
    await karamatsuCleanFlood(dim, cfg, floodCells, boxes);
  }
}

// Apaga a agua da peca: as celulas que viraram agua voltam a ser ar (uma por uma) e a
// agua corrente que escorreu da caixa e limpa por fill na folga em volta.
async function karamatsuCleanFlood(dim, cfg, floodCells, boxes) {
  for (const [x, y, z] of floodCells) {
    try {
      const b = dim.getBlock({ x, y, z });
      if (b && b.typeId.includes("water")) b.setType("minecraft:air");
    } catch (e) {}
  }
  floodCells.length = 0;
  const M = cfg.leakMargin;
  for (let pass = 0; pass < cfg.cleanupPasses; pass++) {
    for (const b of boxes) {
      try {
        dim.runCommand(
          `fill ${b.xa - M} ${b.ya - 3} ${b.za - M} ${b.xb + M} ${b.yb + 2} ${b.zb + M} air [] replace flowing_water`
        );
      } catch (e) {}
    }
    if (pass < cfg.cleanupPasses - 1) await sleepTicks(40);
  }
}

function tryTriggerKaramatsu(player) {
  if (getAwakening(player) < 100) return false;
  if (skillBlockingZoneFor(player)) return false;
  if (shunsuiInGame.has(player.id)) return false;

  player.setDynamicProperty(DP.awakening, 0);
  runKaramatsu(player);
  return true;
}

/* ---------------------------------------------------------
   Soi Fon (Tier 4) - Suzumebachi / Jakuhō Raikōben
   --------------------------------------------------------- */

const SOIFON = {
  shunpo: { distance: 20 },
  stealthy: { ticks: 60, speedAmplifier: 4 }, // 3s, speed 5
  shunko: { ticks: 200, speedAmplifier: 5 }, // 10s, speed 6
  nigeki: {
    minAwakening: 50,
    windowTicks: 100, // 5s para acertar com a Zanpakuto
    cooldownTicks: 1600, // 80s, iniciado ao fim da janela
    sameTierDamage: 800,
  },
  jakuho: {
    chargeTicks: 15,
    speed: 3,
    maxTicks: 45,
    hitRadius: 1.3,
    blastRadius: 25, // raio da explosao
    growTicks: 10,
  },
};

const soiNigekiDuels = new Map(); // id da Soi Fon -> { target, start, windowEnd, phase, frozenPositions }
const soiSpeed = new Map(); // id -> { amp, until }

function soiRestoreBaseSpeed(player) {
  try {
    const c = getActiveCharacter(player);
    if (!c) return;
    const f = activeFormOf(player, c);
    setPermanentEffect(player, "speed", f?.speedAmplifier ?? BASE_SPEED_AMPLIFIER);
  } catch (e) {}
}

// buff de speed temporario: o speed base do personagem e permanente, entao ao
// acabar o buff ele e reposto. Buff mais forte nao e rebaixado por um mais fraco.
function soiSpeedBuff(player, amplifier, ticks) {
  const now = system.currentTick;
  const cur = soiSpeed.get(player.id);
  const active = cur && cur.until > now ? cur : undefined;
  const amp = active ? Math.max(active.amp, amplifier) : amplifier;
  const until = Math.max(active?.until ?? 0, now + ticks);
  soiSpeed.set(player.id, { amp, until });
  try {
    player.addEffect("speed", until - now, { amplifier: amp, showParticles: false });
  } catch (e) {}
  system.runTimeout(() => {
    const st = soiSpeed.get(player.id);
    if (st && st.until <= system.currentTick) {
      soiSpeed.delete(player.id);
      soiRestoreBaseSpeed(player);
    }
  }, until - now + 1);
}

// anda em linha reta ate `maxDist` blocos e para colado no primeiro bloco no caminho
function soiDashEnd(player, dir, maxDist) {
  const dim = player.dimension;
  const start = player.location;
  const cache = new Map();
  let last = { x: start.x, y: start.y, z: start.z };
  for (let d = 0.5; d <= maxDist; d += 0.5) {
    const p = { x: start.x + dir.x * d, y: start.y + dir.y * d, z: start.z + dir.z * d };
    const fx = Math.floor(p.x);
    const fy = Math.floor(p.y);
    const fz = Math.floor(p.z);
    if (!ginBlockInfo(dim, cache, fx, fy, fz).passable || !ginBlockInfo(dim, cache, fx, fy + 1, fz).passable) break;
    last = p;
  }
  return last;
}

function soiTrail(dim, a, b) {
  const len = ginDist(a, b);
  for (let d = 0; d <= len; d += 1) {
    const t = len ? d / len : 0;
    try {
      dim.spawnParticle("soifon:rastro", {
        x: a.x + (b.x - a.x) * t,
        y: a.y + 1 + (b.y - a.y) * t,
        z: a.z + (b.z - a.z) * t,
      });
    } catch (e) {
      return;
    }
  }
}

function soiViewDir(player) {
  const v = player.getViewDirection();
  const y = Math.max(-0.6, Math.min(0.6, v.y));
  const h = Math.hypot(v.x, v.z) || 1;
  const k = Math.sqrt(Math.max(0, 1 - y * y)) / h;
  return { x: v.x * k, y, z: v.z * k };
}

/* ---------- Shunpo ---------- */

function castShunpo(player) {
  if (!tryUseSkill(player, "soifon:shunpo")) return;
  world.sendMessage(`§e${player.name}: §f§lShunpo`);
  const from = { ...player.location };
  const end = soiDashEnd(player, soiViewDir(player), SOIFON.shunpo.distance);
  const dx = end.x - from.x, dy = end.y - from.y, dz = end.z - from.z;
  const steps = 5;
  let step = 0;
  const dash = system.runInterval(() => {
    step++;
    try {
      const t = step / steps;
      const pos = { x: from.x + dx * t, y: from.y + dy * t, z: from.z + dz * t };
      player.teleport(pos);
      soiTrail(player.dimension, { x: from.x + dx * Math.max(0, (step - 1) / steps), y: from.y + dy * Math.max(0, (step - 1) / steps), z: from.z + dz * Math.max(0, (step - 1) / steps) }, pos);
    } catch (e) { system.clearRun(dash); return; }
    if (step >= steps) system.clearRun(dash);
  }, 1);
  ginPlaySound(player, "mob.endermen.portal", 0.8, 1.8);
}

/* ---------- Stealthy ---------- */

function castStealthy(player) {
  if (!tryUseSkill(player, "soifon:stealthy")) return;
  const cfg = SOIFON.stealthy;
  world.sendMessage(`§e${player.name}: §f§lStealthy`);
  try {
    player.addEffect("invisibility", cfg.ticks, { amplifier: 0, showParticles: false });
  } catch (e) {}
  soiSpeedBuff(player, cfg.speedAmplifier, cfg.ticks);
  ginPlaySound(player, "mob.endermen.portal", 0.6, 1.6);
}

/* ---------- Shunko ---------- */

function castShunko(player) {
  if (!tryUseSkill(player, "soifon:shunko")) return;
  const cfg = SOIFON.shunko;
  world.sendMessage(`§e${player.name}: §f§lShunkō`);
  soiSpeedBuff(player, cfg.speedAmplifier, cfg.ticks);
  try {
    const l = player.location;
    for (let i = 0; i < 10; i++) {
      player.dimension.spawnParticle("soifon:rastro", {
        x: l.x + (Math.random() - 0.5) * 1.2,
        y: l.y + Math.random() * 2,
        z: l.z + (Math.random() - 0.5) * 1.2,
      });
    }
  } catch (e) {}
  ginPlaySound(player, "random.fizz", 1, 1.6);
}

/* ---------- Nigeki Kessatsu ---------- */

// Nigeki tem duas etapas. Usar a habilidade abre uma janela de 5s para o
// usuario acertar alguem com a Zanpakuto. O primeiro acerto marca o alvo.
// Depois, usar Nigeki novamente no mesmo alvo abre outra janela de 5s; se a
// Zanpakuto acertar o mesmo alvo, o golpe final e aplicado.
// A marca nao expira por tempo: so desaparece se Soi Fon ou o alvo morrer/resetar.
const soiNigekiPending = new Map(); // Soi Fon id -> { target, expiresAt, stage }
const soiMarks = new Map(); // Soi Fon id -> { target }

function soiClearNigeki(playerId) {
  soiMarks.delete(playerId);
  soiNigekiPending.delete(playerId);
}

function soiClearPendingOnly(playerId) {
  soiNigekiPending.delete(playerId);
}

function soiStartNigekiWindow(player, target) {
  const now = system.currentTick;
  const stage = target ? 2 : 1;
  const expiresAt = now + SOIFON.nigeki.windowTicks;
  soiNigekiPending.set(player.id, { target: target ?? null, expiresAt, stage });

  if (target) {
    player.sendMessage("§eNigeki Kessatsu: §f5 segundos para acertar o alvo marcado com a Zanpakuto!");
    try { target.sendMessage("§cNigeki Kessatsu: §fSoi Fon preparou o golpe final!"); } catch (e) {}
  } else {
    player.sendMessage("§eNigeki Kessatsu: §fVocê tem 5 segundos para marcar alguém com a Zanpakuto!");
  }

  // O cooldown de 80s começa quando a janela termina.
  system.runTimeout(() => {
    const pending = soiNigekiPending.get(player.id);
    // Se a janela ainda estiver aberta, ela termina agora. Mesmo que o M1
    // tenha acertado antes e fechado a janela, o cooldown de 80s começa aqui.
    if (pending && pending.expiresAt === expiresAt) {
      soiNigekiPending.delete(player.id);
    }
    player.setDynamicProperty(cdKeyForSkill("soifon:nigeki_kessatsu"), system.currentTick);
    try { player.sendMessage("§7Nigeki Kessatsu entrou em cooldown por 80s."); } catch (e) {}
  }, SOIFON.nigeki.windowTicks);
}

// Retorna true quando o M1 foi consumido pela mecanica do Nigeki, evitando o M1 normal.
function soiHandleNigekiM1(player, target) {
  const pending = soiNigekiPending.get(player.id);
  if (!pending) return false;

  if (system.currentTick > pending.expiresAt || isDownOrGone(target)) {
    soiClearPendingOnly(player.id);
    return false;
  }

  if (pending.stage === 2) {
    // Na segunda etapa, somente o mesmo alvo marcado pode ser executado.
    if (!pending.target || pending.target.id !== target.id) return false;

    soiClearPendingOnly(player.id);
    soiMarks.delete(player.id);

    if (isIntocable(target)) {
      try { dealDamage(target, 1, player); } catch (e) {}
      player.setDynamicProperty(DP.awakening, 0);
      return true;
    }

    try {
      target.dimension.spawnParticle("soifon:marca", {
        x: target.location.x,
        y: target.location.y + 2.3,
        z: target.location.z,
      });
    } catch (e) {}

    if (target.typeId === "minecraft:player" && tierOfPlayer(target) >= tierOfPlayer(player)) {
      dealDamage(target, SOIFON.nigeki.sameTierDamage, player, { breaksBlock: true });
      player.sendMessage("§eNigeki Kessatsu: §fO alvo resistiu e recebeu 800 de dano.");
    } else {
      try { target.kill(); } catch (e) {}
    }

    // Um Nigeki concluido consome todo o Awakening.
    player.setDynamicProperty(DP.awakening, 0);
    return true;
  }

  // Primeira etapa: o acerto da Zanpakuto aplica a marca permanente.
  soiNigekiPending.delete(player.id);
  soiMarks.set(player.id, { target });
  try {
    target.dimension.spawnParticle("soifon:marca", {
      x: target.location.x,
      y: target.location.y + 2.3,
      z: target.location.z,
    });
  } catch (e) {}
  player.sendMessage("§eNigeki Kessatsu: §fAlvo marcado! Use Nigeki novamente e acerte-o com a Zanpakuto para executar.");
  try { target.sendMessage("§cVocê foi marcado por Nigeki Kessatsu."); } catch (e) {}
  return true;
}

function castNigekiKessatsu(player) {
  const now = system.currentTick;
  const key = cdKeyForSkill("soifon:nigeki_kessatsu");

  // Cada ativacao exige pelo menos 50% de Awakening.
  if (getAwakening(player) < SOIFON.nigeki.minAwakening) {
    player.sendMessage("§cNigeki Kessatsu requer pelo menos 50% de Awakening.");
    return;
  }

  if (soiNigekiPending.has(player.id)) {
    player.sendMessage("§cNigeki Kessatsu: §7a janela de 5s ainda está ativa.");
    return;
  }

  const duration = SOIFON.nigeki.cooldownTicks;
  if (onCooldown(player, key, duration, now)) {
    const last = tickOf(player, key) ?? now;
    const remaining = Math.ceil((duration - (now - last)) / 20);
    player.sendMessage(`§cNigeki Kessatsu: §7recarregando (${remaining}s).`);
    return;
  }

  const mark = soiMarks.get(player.id);
  const marked = mark && !isDownOrGone(mark.target) ? mark.target : undefined;
  if (mark && !marked) soiMarks.delete(player.id);

  world.sendMessage(`§e${player.name}: §f§lNigeki Kessatsu`);
  soiStartNigekiWindow(player, marked ?? null);
}

// Limpeza das marcas permanentes quando Soi Fon ou o alvo morre/resetar.
system.runInterval(() => {
  for (const [id, mark] of soiMarks) {
    try {
      const player = [...world.getPlayers()].find(p => p.id === id);
      if (!player || isDownOrGone(player) || isDownOrGone(mark.target)) {
        soiClearNigeki(id);
        continue;
      }
      const l = mark.target.location;
      mark.target.dimension.spawnParticle("soifon:marca", {
        x: l.x,
        y: l.y + 2.4,
        z: l.z,
      });
    } catch (e) {
      soiClearNigeki(id);
    }
  }
}, 1);

/* ---------- Bankai: Jakuhō Raikōben (super, gatilho: agachar + m1 com o medidor em 100%) ---------- */

function soiStrike(player, entity, damage) {
  if (isRespiring(entity)) {
    showRespiraGuard(entity);
    return;
  }
  dealDamage(entity, damage * dmgMultiplier(player), player);
  try {
    entity.dimension.spawnParticle("soifon:explosao", { x: entity.location.x, y: entity.location.y + 1, z: entity.location.z });
  } catch (e) {}
}

// pontos de uma esfera (espiral de Fibonacci) pra desenhar a casca da explosao
function soiSpherePoints(count) {
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count;
    const r = Math.sqrt(1 - y * y);
    const a = i * golden;
    pts.push({ x: Math.cos(a) * r, y, z: Math.sin(a) * r });
  }
  return pts;
}

function jakuhoExplode(player, dim, center) {
  const cfg = SOIFON.jakuho;
  world.sendMessage(`§6§lJAKUHŌ RAIKŌBEN §r§7- círculo de fogo!`);
  try { dim.playSound("random.explode", center, { volume: 4, pitch: 0.7 }); } catch (e) {}

  // O impacto cria um anel de fogo que cresce para fora. Cada entidade é atingida
  // quando a borda do círculo passa por sua posição, como a Lanza del Relámpago.
  const hitIds = new Set();
  const shell = soiSpherePoints(18);
  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    try {
      const r = (cfg.blastRadius * tick) / cfg.growTicks;
      for (let i = 0; i < 36; i++) {
        const a = (i / 36) * Math.PI * 2;
        const x = center.x + Math.cos(a) * r;
        const z = center.z + Math.sin(a) * r;
        dim.spawnParticle("soifon:missil", { x, y: center.y + 0.25, z });
        if (i % 3 === 0) dim.spawnParticle("soifon:onda", { x, y: center.y + 0.35, z });
      }
      for (const entity of dim.getEntities({ location: center, maxDistance: cfg.blastRadius + 1 })) {
        if (entity.id === player.id || hitIds.has(entity.id)) continue;
        if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
        const dx = entity.location.x - center.x;
        const dz = entity.location.z - center.z;
        const dist = Math.hypot(dx, dz);
        // acertado quando a borda chega nele; quem esta no centro (o alvo do missil) entra no 1o tick
        if (dist <= r + 1.6) {
          hitIds.add(entity.id);
          soiStrike(player, entity, DAMAGE.jakuho);
        }
      }
    } catch (e) { system.clearRun(interval); return; }
    if (tick >= cfg.growTicks) system.clearRun(interval);
  }, 1);
}

function runJakuho(player) {
  const cfg = SOIFON.jakuho;
  const dim = player.dimension;
  world.sendMessage(`§6§lBANKAI: JAKUHŌ RAIKŌBEN! §r§7${player.name}`);
  ginPlaySound(player, "beacon.activate", 2, 0.6);

  let charge = 0;
  const chargeInterval = system.runInterval(() => {
    charge++;
    try {
      if (isDownOrGone(player)) {
        system.clearRun(chargeInterval);
        return;
      }
      const h = ginHandOf(player);
      for (let i = 0; i < 4; i++) {
        dim.spawnParticle("soifon:missil", {
          x: h.x + (Math.random() - 0.5) * 1.6,
          y: h.y + (Math.random() - 0.5) * 1.6,
          z: h.z + (Math.random() - 0.5) * 1.6,
        });
      }
    } catch (e) {}
    if (charge < cfg.chargeTicks) return;
    system.clearRun(chargeInterval);
    if (isDownOrGone(player)) return;

    // dispara: o missil segue reto na mira e explode no primeiro bloco/ser vivo (ou no fim do alcance)
    const hand = ginHandOf(player);
    const dir = ginUnit(hand, ginAimPoint(player, 100));
    let pos = { x: hand.x + dir.x * 1.5, y: hand.y + dir.y * 1.5, z: hand.z + dir.z * 1.5 };
    const cache = new Map();
    let life = 0;
    const attack = trackAttack(player, cfg.hitRadius + 0.6);
    const missile = system.runInterval(() => {
      if (attack.cancelled) {
        system.clearRun(missile);
        return;
      }
      life++;
      touchAttack(attack, pos);
      try {
        const from = { ...pos };
        const to = { x: from.x + dir.x * cfg.speed, y: from.y + dir.y * cfg.speed, z: from.z + dir.z * cfg.speed };

        if (!ginBlockInfo(dim, cache, Math.floor(to.x), Math.floor(to.y), Math.floor(to.z)).passable) {
          system.clearRun(missile);
          jakuhoExplode(player, dim, from);
          return;
        }
        const [hit] = ginEntitiesOnSegment(player, from, to, cfg.hitRadius, null);
        if (hit) {
          system.clearRun(missile);
          jakuhoExplode(player, dim, ginBodyOf(hit));
          return;
        }
        pos = to;
        dim.spawnParticle("soifon:missil", to);
        dim.spawnParticle("soifon:missil", { x: to.x - dir.x * 1.2, y: to.y - dir.y * 1.2, z: to.z - dir.z * 1.2 });
        dim.spawnParticle("soifon:rastro", { x: to.x - dir.x * 2.4, y: to.y - dir.y * 2.4, z: to.z - dir.z * 2.4 });
        if (life >= cfg.maxTicks) {
          system.clearRun(missile);
          jakuhoExplode(player, dim, to);
        }
      } catch (e) {
        system.clearRun(missile);
      }
    }, 1);
  }, 1);
}

function tryTriggerJakuho(player) {
  if (getAwakening(player) < 100) return false;
  if (skillBlockingZoneFor(player)) return false;

  player.setDynamicProperty(DP.awakening, 0);
  runJakuho(player);
  return true;
}

/* ---------------------------------------------------------
   Rukia Kuchiki (Tier 2) - Sode no Shirayuki
   Fragilizacao: o gelo dela faz o alvo tomar mais dano (todo dano) por um tempo.
   --------------------------------------------------------- */

const RUKIA = {
  fragilityTicks: 200, // 10s (o unico tempo informado, do White Moon; vale pra todas)
  fragilityCap: 150, // teto do total somado (%)
  moon: { radius: 10, pct: 10, growTicks: 6, restoreTicks: 600 },
  wave: { waves: 3, perWave: 3, gapTicks: 8, speed: 2.2, lifeTicks: 26, radius: 1.0, pct: 5, spread: 0.1 },
  sword: { range: 10, extendTicks: 4, holdTicks: 3, retractTicks: 4, hitRadius: 1.1, pct: 20, maxBreaks: 40 },
  hado: {
    range: 40,
    radius: 2.2,
    extendTicks: 3,
    holdTicks: 6,
    fadeTicks: 4,
    slowAmplifier: 2, // lentidao enquanto canalizado
    sneakTicks: 40, // agachar 2s com a m1 na mao encanta
    chantTimeoutTicks: 400, // o encantamento aguenta 20s
    chantedMultiplier: 2,
  },
  juhaku: {
    length: 15,
    width: 6,
    growTicks: 8,
    pct: 60,
    rootTicks: 200, // pernas presas por 10s
    restoreTicks: 600,
    wallRadius: 3, // gigante: muralha a 3 blocos
    wallHeight: 6,
  },
};

const RUKIA_M1_ID = "rukia:m1_zanpakuto";
const HADO_CHANT = "“Trovão e gelo, converjam no firmamento; que vossa luz destrua aqueles que se opõem a mim.”";
const HADO_NAME_LINE = "“Hadō #73: Sōren Sōkatsui!”";

/* ---------- Fragilizacao ---------- */

const fragility = new Map(); // id -> [{ pct, end }]

function fragilityTotal(entity) {
  const list = fragility.get(entity.id);
  if (!list) return 0;
  const now = system.currentTick;
  const alive = list.filter((f) => f.end > now);
  if (alive.length !== list.length) {
    if (alive.length) fragility.set(entity.id, alive);
    else fragility.delete(entity.id);
  }
  return Math.min(alive.reduce((sum, f) => sum + f.pct, 0), RUKIA.fragilityCap);
}

// chamada pelo dealDamage: 10% de fragilizacao = 1,10x de dano recebido
function fragilityMultiplierOf(entity) {
  return 1 + fragilityTotal(entity) / 100;
}

// cada aplicacao soma (com o teto) e dura `fragilityTicks` por conta propria
function addFragility(entity, pct) {
  const list = fragility.get(entity.id) ?? [];
  list.push({ pct, end: system.currentTick + RUKIA.fragilityTicks });
  fragility.set(entity.id, list);
  try {
    if (entity.typeId === "minecraft:player") {
      entity.sendMessage(`§b❄ Fragilizado: §f+${fragilityTotal(entity)}% §bde dano recebido`);
    }
  } catch (e) {}
}

function showRukiaSpark(entity) {
  try {
    const l = entity.location;
    for (let i = 0; i < 4; i++) {
      entity.dimension.spawnParticle(i % 2 === 0 ? "rukia:gelo" : "rukia:neve", {
        x: l.x + (Math.random() - 0.5) * 0.9,
        y: l.y + 0.4 + Math.random() * 1.2,
        z: l.z + (Math.random() - 0.5) * 0.9,
      });
    }
  } catch (e) {}
}

// golpe de gelo da Rukia: dano + fragilizacao (Respira barra ataque a distancia)
function rukiaStrike(player, entity, damage, pct, ranged) {
  if (ranged && isRespiring(entity)) {
    showRespiraGuard(entity);
    return false;
  }
  dealDamage(entity, damage * dmgMultiplier(player), player);
  showRukiaSpark(entity);
  if (pct && !isIntocable(entity)) addFragility(entity, pct);
  return true;
}

/* ---------- White Moon ---------- */

function castWhiteMoon(player) {
  if (!tryUseSkill(player, "rukia:white_moon")) return;

  world.sendMessage(`§f${player.name}: §b§lWhite Moon`);
  ginPlaySound(player, "random.glass", 1.5, 0.6);

  const cfg = RUKIA.moon;
  const dim = player.dimension;
  const o = player.location;
  const ledger = iceTrack([]);
  const columns = [];
  for (let dx = -cfg.radius; dx <= cfg.radius; dx++) {
    for (let dz = -cfg.radius; dz <= cfg.radius; dz++) {
      const d = Math.hypot(dx, dz);
      if (d <= cfg.radius) columns.push({ x: Math.floor(o.x) + dx, z: Math.floor(o.z) + dz, d });
    }
  }
  columns.sort((a, b) => a.d - b.d);

  // tudo dentro do circulo congela: fragilizacao de 10%
  for (const entity of dim.getEntities({ location: o, maxDistance: cfg.radius })) {
    if (entity.id === player.id) continue;
    if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
    addFragility(entity, cfg.pct);
    showRukiaSpark(entity);
  }

  const yTop = Math.floor(o.y) + HITSUGAYA.freezeSurface.up;
  const yBottom = Math.floor(o.y) - HITSUGAYA.freezeSurface.down;
  let idx = 0;
  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    try {
      const front = (cfg.radius * tick) / cfg.growTicks;
      while (idx < columns.length && columns[idx].d <= front) {
        const c = columns[idx];
        iceFreezeColumn(dim, ledger, c.x, c.z, yTop, yBottom);
        if (idx % 5 === 0) dim.spawnParticle("rukia:neve", { x: c.x + 0.5, y: o.y + 0.5 + Math.random() * 1.2, z: c.z + 0.5 });
        idx++;
      }
      // borda do circulo crescendo
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI * 2;
        dim.spawnParticle("rukia:gelo", { x: o.x + Math.cos(a) * front, y: o.y + 0.3, z: o.z + Math.sin(a) * front });
      }
    } catch (e) {
      tick = cfg.growTicks;
    }
    if (tick >= cfg.growTicks) {
      system.clearRun(interval);
      system.runTimeout(() => iceRestore(ledger), cfg.restoreTicks);
    }
  }, 1);
}

/* ---------- White Wave ---------- */

function launchFrostBolt(player, dir, cache) {
  const cfg = RUKIA.wave;
  const dim = player.dimension;
  const head = player.getHeadLocation();
  let pos = { x: head.x + dir.x * 0.8, y: head.y - 0.2 + dir.y * 0.8, z: head.z + dir.z * 0.8 };
  let life = 0;
  const attack = trackAttack(player, cfg.radius);

  const interval = system.runInterval(() => {
    if (attack.cancelled) {
      system.clearRun(interval);
      return;
    }
    life++;
    touchAttack(attack, pos);
    try {
      const from = { ...pos };
      const to = { x: from.x + dir.x * cfg.speed, y: from.y + dir.y * cfg.speed, z: from.z + dir.z * cfg.speed };
      if (!ginBlockInfo(dim, cache, Math.floor(to.x), Math.floor(to.y), Math.floor(to.z)).passable) {
        dim.spawnParticle("rukia:neve", from);
        system.clearRun(interval);
        return;
      }
      const [first] = ginEntitiesOnSegment(player, from, to, cfg.radius, null);
      if (first) {
        rukiaStrike(player, first, DAMAGE.whiteWave, cfg.pct, true);
        system.clearRun(interval);
        return;
      }
      pos = to;
      dim.spawnParticle("rukia:gelo", to);
      dim.spawnParticle("rukia:gelo", { x: to.x - dir.x * 0.9, y: to.y - dir.y * 0.9, z: to.z - dir.z * 0.9 });
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (life >= cfg.lifeTicks) system.clearRun(interval);
  }, 1);
}

function castWhiteWave(player) {
  if (!tryUseSkill(player, "rukia:white_wave")) return;

  world.sendMessage(`§f${player.name}: §b§lWhite Wave`);
  ginPlaySound(player, "random.glass", 1.4, 1.3);

  const cfg = RUKIA.wave;
  const cache = new Map();
  for (let w = 0; w < cfg.waves; w++) {
    system.runTimeout(() => {
      try {
        if (isDownOrGone(player)) return;
        const view = player.getViewDirection();
        // cada rajada e um leque de projeteis (centro e dois lados)
        for (let i = 0; i < cfg.perWave; i++) {
          const off = (i - (cfg.perWave - 1) / 2) * cfg.spread * 2;
          const d = { x: view.x - view.z * off, y: view.y, z: view.z + view.x * off };
          const len = Math.hypot(d.x, d.y, d.z) || 1;
          launchFrostBolt(player, { x: d.x / len, y: d.y / len, z: d.z / len }, cache);
        }
        ginPlaySound(player, "random.glass", 0.8, 1.6);
      } catch (e) {}
    }, w * cfg.gapTicks);
  }
}

/* ---------- White Sword (a lamina retratil da Extended Blade, com metade do alcance) ---------- */

function castWhiteSword(player) {
  if (!tryUseSkill(player, "rukia:white_sword")) return;

  world.sendMessage(`§f${player.name}: §b§lWhite Sword`);
  ginPlaySound(player, "random.glass", 1.2, 1.5);

  const cfg = RUKIA.sword;
  const dim = player.dimension;
  const dir = ginUnit(ginHandOf(player), ginAimPoint(player, cfg.range));
  const hit = new Set();
  const blockCache = new Map();
  const attackTicks = cfg.extendTicks + cfg.holdTicks;
  const total = attackTicks + cfg.retractTicks;
  let cap = cfg.range;
  let reachedLen = 0;
  let broken = 0;
  let tick = 0;

  const interval = system.runInterval(() => {
    tick++;
    try {
      if (isDownOrGone(player) || getActiveCharacter(player)?.id !== "rukia") {
        system.clearRun(interval);
        return;
      }
      let length;
      if (tick <= cfg.extendTicks) length = (cfg.range * tick) / cfg.extendTicks;
      else if (tick <= attackTicks) length = cfg.range;
      else length = cfg.range * Math.max(0, 1 - (tick - attackTicks) / cfg.retractTicks);

      const hand = ginHandOf(player);
      const at = (d) => ({ x: hand.x + dir.x * d, y: hand.y + dir.y * d, z: hand.z + dir.z * d });

      // como a Extended Blade: quebra os blocos que a ponta encosta
      if (tick <= cfg.extendTicks && reachedLen < cap) {
        const want = Math.min(length, cap);
        const res = ginBreakBlocks(dim, blockCache, at(reachedLen), at(want), cfg.maxBreaks - broken);
        broken += res.count;
        if (res.blocked) cap = reachedLen + res.reach;
        reachedLen = Math.min(want, cap);
      }
      length = Math.min(length, cap);

      if (length > 0.2) {
        const tip = at(length);
        ginDrawBlade(dim, [hand, tip], 30, "rukia:gelo", "rukia:neve");
        if (tick <= attackTicks) {
          for (const entity of ginEntitiesOnSegment(player, hand, tip, cfg.hitRadius, hit)) {
            hit.add(entity.id);
            rukiaStrike(player, entity, DAMAGE.whiteSword, cfg.pct, true);
          }
        }
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (tick >= total) system.clearRun(interval);
  }, 1);
}

/* ---------- Hadō #73: Sōren Sōkatsui ---------- */

const rukiaChant = new Map(); // id -> tick em que o encantamento comecou
const rukiaSneakSince = new Map(); // id -> tick em que comecou a agachar com a m1

function rukiaCancelChant(player, message) {
  rukiaChant.delete(player.id);
  rukiaSneakSince.delete(player.id);
  try {
    player.removeEffect("slowness");
    if (message) player.sendMessage(message);
  } catch (e) {}
}

// Agachar 2s com a m1 na mao (com o Awk cheio) encanta o Hadō: fala o encantamento,
// fica lenta, e o Awk sai com o dobro de dano. Sem isso, o Hadō sai normal.
system.runInterval(() => {
  const cfg = RUKIA.hado;
  const now = system.currentTick;
  for (const player of world.getPlayers()) {
    try {
      if (getActiveCharacter(player)?.id !== "rukia") {
        if (rukiaChant.has(player.id) || rukiaSneakSince.has(player.id)) rukiaCancelChant(player);
        continue;
      }
      const held = player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand)?.typeId;
      const holding = held === RUKIA_M1_ID;
      const since = rukiaChant.get(player.id);
      if (since !== undefined) {
        if (!holding || now - since > cfg.chantTimeoutTicks) {
          rukiaCancelChant(player, "§7Você desfez o encantamento.");
          continue;
        }
        player.addEffect("slowness", 20, { amplifier: cfg.slowAmplifier, showParticles: false });
        continue;
      }
      if (!holding || !player.isSneaking || isFrozen(player) || getAwakening(player) < 100) {
        rukiaSneakSince.delete(player.id);
        continue;
      }
      const start = rukiaSneakSince.get(player.id);
      if (start === undefined) {
        rukiaSneakSince.set(player.id, now);
      } else if (now - start >= cfg.sneakTicks) {
        rukiaChant.set(player.id, now);
        world.sendMessage(`§b<${player.name}> §f${HADO_CHANT}`);
        player.addEffect("slowness", 20, { amplifier: cfg.slowAmplifier, showParticles: false });
      }
    } catch (e) {}
  }
}, 4);

// Awk: Hadō #73 Sōren Sōkatsui (super, gatilho: agachar + m1 com o medidor em 100%)
function tryTriggerHado(player) {
  if (getAwakening(player) < 100) return false;
  if (skillBlockingZoneFor(player)) return false;

  const chanted = rukiaChant.has(player.id);
  player.setDynamicProperty(DP.awakening, 0);
  if (chanted) {
    rukiaCancelChant(player);
    world.sendMessage(`§b<${player.name}> §f${HADO_NAME_LINE}`);
  } else {
    rukiaSneakSince.delete(player.id);
    world.sendMessage(`§f${player.name}: §b§lAWK: Hadō #73: Sōren Sōkatsui`);
  }
  fireHado(player, chanted);
  return true;
}

function fireHado(player, chanted) {
  const cfg = RUKIA.hado;
  const damage = DAMAGE.hado73 * (chanted ? cfg.chantedMultiplier : 1);
  ginPlaySound(player, "beacon.activate", 2, 1.4);

  const dim = player.dimension;
  const hand = ginHandOf(player);
  const dir = ginUnit(hand, ginAimPoint(player, cfg.range));
  // a rajada para no primeiro bloco
  const cache = new Map();
  let length = cfg.range;
  for (let d = 1; d <= cfg.range; d += 0.5) {
    if (!ginBlockInfo(dim, cache, Math.floor(hand.x + dir.x * d), Math.floor(hand.y + dir.y * d), Math.floor(hand.z + dir.z * d)).passable) {
      length = Math.max(0, d - 0.5);
      break;
    }
  }
  const hit = new Set();
  const attackTicks = cfg.extendTicks + cfg.holdTicks;
  const total = attackTicks + cfg.fadeTicks;
  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    try {
      const reach = tick <= cfg.extendTicks ? (length * tick) / cfg.extendTicks : length;
      const start = ginHandOf(player);
      const tip = { x: start.x + dir.x * reach, y: start.y + dir.y * reach, z: start.z + dir.z * reach };
      ginDrawBlade(dim, [start, tip], 26, "rukia:energia", "rukia:energia");
      if (tick <= attackTicks) {
        for (const entity of ginEntitiesOnSegment(player, start, tip, cfg.radius, hit)) {
          hit.add(entity.id);
          if (isRespiring(entity)) {
            showRespiraGuard(entity);
            continue;
          }
          dealDamage(entity, damage * dmgMultiplier(player), player);
          showRukiaSpark(entity);
        }
      }
      if (tick === attackTicks) {
        for (let i = 0; i < 5; i++) {
          dim.spawnParticle("rukia:energia", { x: tip.x + (Math.random() - 0.5) * 2, y: tip.y + (Math.random() - 0.5) * 2, z: tip.z + (Math.random() - 0.5) * 2 });
        }
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (tick >= total) system.clearRun(interval);
  }, 1);
}

/* ---------- Juhaku (skill 4): trilha de gelo ---------- */

// gigante = forma com marcador na offhand (Resurrección Ira do Yammy)
function isGiantPlayer(entity) {
  try {
    return entity.typeId === "minecraft:player" && !!activeFormOf(entity)?.offhandMarker;
  } catch (e) {
    return false;
  }
}

// prende as pernas: bloco de gelo em volta da metade de baixo do corpo (os 8 vizinhos
// no nivel dos pes) + raiz; gigante leva muralha alta em volta
function juhakuFreezeLegs(entity, ledger) {
  const cfg = RUKIA.juhaku;
  const dim = entity.dimension;
  const bx = Math.floor(entity.location.x);
  const by = Math.floor(entity.location.y);
  const bz = Math.floor(entity.location.z);
  const cache = new Map();
  const place = (x, y, z) => {
    if (ginBlockInfo(dim, cache, x, y, z).passable) iceSet(ledger, dim, x, y, z, "minecraft:packed_ice");
  };
  if (isGiantPlayer(entity)) {
    const r = cfg.wallRadius;
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; // so o perimetro
        for (let h = 0; h < cfg.wallHeight; h++) place(bx + dx, by + h, bz + dz);
      }
    }
  } else {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0) continue;
        place(bx + dx, by, bz + dz);
      }
    }
  }
  // pernas presas: nao anda nem pula (mas ainda pode usar skill)
  const end = system.currentTick + cfg.rootTicks;
  const interval = system.runInterval(() => {
    try {
      if (isDownOrGone(entity) || system.currentTick >= end) {
        system.clearRun(interval);
        return;
      }
      entity.addEffect("slowness", 10, { amplifier: 255, showParticles: false });
      holdJump(entity, 10);
    } catch (e) {
      system.clearRun(interval);
    }
  }, 4);
}

function runJuhaku(player) {
  const cfg = RUKIA.juhaku;
  const dim = player.dimension;
  world.sendMessage(`§f${player.name}: §b§lJuhaku`);
  ginPlaySound(player, "random.glass", 2, 0.5);

  const o = player.location;
  const f = hitsuFlat(player);
  const r = { x: -f.z, z: f.x };
  const columns = [];
  const seen = new Set();
  for (let a = 1; a <= cfg.length; a++) {
    for (let b = -cfg.width / 2; b < cfg.width / 2; b++) {
      const x = Math.floor(o.x + f.x * a + r.x * (b + 0.5));
      const z = Math.floor(o.z + f.z * a + r.z * (b + 0.5));
      const key = x + "," + z;
      if (seen.has(key)) continue;
      seen.add(key);
      columns.push({ x, z, a });
    }
  }

  const trail = iceTrack([]); // a trilha volta ao normal com o tempo
  const legs = iceTrack([]); // o gelo das pernas/muralhas
  const hit = new Set();
  const yTop = Math.floor(o.y) + HITSUGAYA.freezeSurface.up;
  const yBottom = Math.floor(o.y) - HITSUGAYA.freezeSurface.down;
  let idx = 0;
  let tick = 0;

  const interval = system.runInterval(() => {
    tick++;
    try {
      const front = (cfg.length * tick) / cfg.growTicks;
      while (idx < columns.length && columns[idx].a <= front) {
        const c = columns[idx];
        iceFreezeColumn(dim, trail, c.x, c.z, yTop, yBottom);
        if (idx % 3 === 0) dim.spawnParticle("rukia:neve", { x: c.x + 0.5, y: o.y + 0.5 + Math.random(), z: c.z + 0.5 });
        idx++;
      }
      for (const entity of dim.getEntities({ location: o, maxDistance: front + 4 })) {
        if (entity.id === player.id || hit.has(entity.id)) continue;
        if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
        const dx = entity.location.x - o.x;
        const dz = entity.location.z - o.z;
        const a = dx * f.x + dz * f.z;
        const b = dx * r.x + dz * r.z;
        if (a < 0 || a > front || Math.abs(b) > cfg.width / 2 + 0.4) continue;
        if (Math.abs(entity.location.y - o.y) > 6) continue;
        hit.add(entity.id);
        if (isRespiring(entity)) {
          showRespiraGuard(entity);
          continue;
        }
        if (isIntocable(entity)) continue;
        addFragility(entity, cfg.pct);
        showRukiaSpark(entity);
        juhakuFreezeLegs(entity, legs);
      }
    } catch (e) {
      tick = cfg.growTicks;
    }
    if (tick >= cfg.growTicks) {
      system.clearRun(interval);
      system.runTimeout(() => iceRestore(trail), cfg.restoreTicks);
      system.runTimeout(() => iceRestore(legs), cfg.rootTicks);
    }
  }, 1);
}

function castJuhaku(player) {
  if (!tryUseSkill(player, "rukia:juhaku")) return;
  runJuhaku(player);
}

/* ---------------------------------------------------------
   Jūshiro Ukitake (Tier 5) - Sōgyo no Kotowari
   --------------------------------------------------------- */

const UKITAKE = {
  throwPull: { range: 30, speed: 3, radius: 1.2, pullTicks: 6, stopDistance: 1.8 },
  slam: { radius: 8, growTicks: 5 },
  yinYang: { radius: 7, spinTicks: 14, pauseTicks: 4 }, // dois giros de 14 ticks
  stagnation: {
    lines: 5,
    range: 40,
    launchGapTicks: 2,
    speed: 1.8,
    lifeTicks: 45,
    turn: 0.35, // o quanto a linha vira pro alvo a cada tick (teleguiada)
    radius: 1.0,
    paralysisTicks: 100, // 5s (nao foi especificado)
    steal: 10, // % de awakening
  },
  absorb: { ticks: 200 }, // 10s
};

const UKITAKE_STORED = "mv:ukitake_stored"; // dano guardado pelo Absorb (vira o Hansha)
const ukitakeAbsorb = new Map(); // id -> tick em que o Absorb acaba

function ukitakeStoredOf(player) {
  return Number(player.getDynamicProperty(UKITAKE_STORED) ?? 0);
}

// chamada pelo dealDamage: com o Absorb ativo o dano nao entra, fica guardado
function absorbUkitakeDamage(target, amount) {
  const end = ukitakeAbsorb.get(target.id);
  if (end === undefined) return false;
  if (system.currentTick >= end) {
    ukitakeAbsorb.delete(target.id);
    return false;
  }
  const total = ukitakeStoredOf(target) + amount;
  try {
    target.setDynamicProperty(UKITAKE_STORED, total);
    const l = target.location;
    for (let i = 0; i < 4; i++) {
      target.dimension.spawnParticle("ukitake:energia", {
        x: l.x + (Math.random() - 0.5) * 1.6,
        y: l.y + 0.3 + Math.random() * 1.6,
        z: l.z + (Math.random() - 0.5) * 1.6,
      });
    }
    if (target.typeId === "minecraft:player") {
      target.onScreenDisplay.setActionBar(`§bAbsorb: §f+${Math.round(amount)} §7(guardado: ${Math.round(total)})`);
    }
  } catch (e) {}
  return true;
}

function showUkitakeSpark(entity) {
  try {
    const l = entity.location;
    for (let i = 0; i < 4; i++) {
      entity.dimension.spawnParticle(i % 2 === 0 ? "ukitake:hilo" : "ukitake:energia", {
        x: l.x + (Math.random() - 0.5) * 0.9,
        y: l.y + 0.4 + Math.random() * 1.2,
        z: l.z + (Math.random() - 0.5) * 0.9,
      });
    }
  } catch (e) {}
}

/* ---------- Throw 'n Pull ---------- */

function castThrowPull(player) {
  if (!tryUseSkill(player, "ukitake:throw_n_pull")) return;

  world.sendMessage(`§b${player.name}: §f§lThrow 'n Pull`);
  ginPlaySound(player, "item.trident.throw", 1.3, 1.1);

  const cfg = UKITAKE.throwPull;
  const dim = player.dimension;
  const hand0 = ginHandOf(player);
  const dir = ginUnit(hand0, ginAimPoint(player, cfg.range));
  const cache = new Map();
  let pos = { ...hand0 };
  let life = 0;

  const interval = system.runInterval(() => {
    life++;
    try {
      if (isDownOrGone(player)) {
        system.clearRun(interval);
        return;
      }
      const from = { ...pos };
      const to = { x: from.x + dir.x * cfg.speed, y: from.y + dir.y * cfg.speed, z: from.z + dir.z * cfg.speed };
      const hand = ginHandOf(player);

      if (!ginBlockInfo(dim, cache, Math.floor(to.x), Math.floor(to.y), Math.floor(to.z)).passable) {
        system.clearRun(interval);
        return;
      }
      const [hit] = ginEntitiesOnSegment(player, from, to, cfg.radius, null);
      if (hit) {
        system.clearRun(interval);
        ukitakePull(player, hit);
        return;
      }
      pos = to;
      ginDrawBlade(dim, [hand, to], 20, "ukitake:hilo", "ukitake:energia"); // a zanpakuto e a corrente
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (life >= Math.ceil(cfg.range / cfg.speed)) system.clearRun(interval);
  }, 1);
}

function ukitakePull(player, target) {
  const cfg = UKITAKE.throwPull;
  if (isRespiring(target)) {
    showRespiraGuard(target);
    return;
  }
  dealDamage(target, DAMAGE.throwPull * dmgMultiplier(player), player);
  showUkitakeSpark(target);
  if (isIntocable(target)) return; // a guarda dele segura o puxao tambem

  const dim = target.dimension;
  const cache = new Map();
  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    try {
      if (isDownOrGone(player) || isDownOrGone(target)) {
        system.clearRun(interval);
        return;
      }
      const p = player.location;
      const t = target.location;
      const dx = t.x - p.x;
      const dz = t.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      // ponto colado no Ukitake (na direcao de onde o alvo veio)
      const dest = { x: p.x + (dx / len) * cfg.stopDistance, y: p.y, z: p.z + (dz / len) * cfg.stopDistance };
      const k = 1 / (cfg.pullTicks - tick + 1);
      const next = { x: t.x + (dest.x - t.x) * k, y: t.y + (dest.y - t.y) * k, z: t.z + (dest.z - t.z) * k };
      const fx = Math.floor(next.x);
      const fy = Math.floor(next.y);
      const fz = Math.floor(next.z);
      if (ginBlockInfo(dim, cache, fx, fy, fz).passable && ginBlockInfo(dim, cache, fx, fy + 1, fz).passable) {
        target.teleport(next);
      }
      ginDrawBlade(dim, [ginHandOf(player), ginBodyOf(target)], 14, "ukitake:hilo", "ukitake:energia");
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (tick >= cfg.pullTicks) system.clearRun(interval);
  }, 1);
}

/* ---------- Double Slam ---------- */

function castDoubleSlam(player) {
  if (!tryUseSkill(player, "ukitake:double_slam")) return;

  world.sendMessage(`§b${player.name}: §f§lDouble Slam`);
  ginPlaySound(player, "random.explode", 1.5, 0.8);

  const cfg = UKITAKE.slam;
  const dim = player.dimension;
  const o = { ...player.location };
  const hit = new Set();
  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    try {
      const r = (cfg.radius * tick) / cfg.growTicks;
      if (tick === 1) {
        for (let i = 0; i < 6; i++) {
          dim.spawnParticle("ukitake:energia", { x: o.x + (Math.random() - 0.5) * 2, y: o.y + 0.3 + Math.random(), z: o.z + (Math.random() - 0.5) * 2 });
        }
      }
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        dim.spawnParticle("ukitake:onda", { x: o.x + Math.cos(a) * r, y: o.y + 0.3, z: o.z + Math.sin(a) * r });
      }
      // a onda da explosao acerta quem esta dentro do raio (uma vez)
      for (const entity of dim.getEntities({ location: o, maxDistance: cfg.radius + 1 })) {
        if (entity.id === player.id || hit.has(entity.id)) continue;
        if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
        if (Math.hypot(entity.location.x - o.x, entity.location.z - o.z) > r + 0.5) continue;
        if (Math.abs(entity.location.y - o.y) > 6) continue;
        hit.add(entity.id);
        dealDamage(entity, DAMAGE.doubleSlam * dmgMultiplier(player), player);
        showUkitakeSpark(entity);
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (tick >= cfg.growTicks) system.clearRun(interval);
  }, 1);
}

/* ---------- Ying Yang: giro horario e depois anti-horario ---------- */

function castYingYang(player) {
  if (!tryUseSkill(player, "ukitake:ying_yang")) return;

  world.sendMessage(`§b${player.name}: §f§lYing Yang`);
  ginPlaySound(player, "item.trident.throw", 1.3, 0.8);

  const cfg = UKITAKE.yinYang;
  const dim = player.dimension;
  const sweep = (Math.PI * 2) / cfg.spinTicks;
  const view = forwardDirection(player);
  let angle = Math.atan2(view.z, view.x);
  const spins = [
    { sign: 1, hit: new Set() }, // horario (visto de cima)
    { sign: -1, hit: new Set() }, // anti-horario
  ];
  const total = cfg.spinTicks * 2 + cfg.pauseTicks;
  let tick = 0;

  const interval = system.runInterval(() => {
    tick++;
    try {
      if (isDownOrGone(player) || getActiveCharacter(player)?.id !== "ukitake") {
        system.clearRun(interval);
        return;
      }
      let spin;
      if (tick <= cfg.spinTicks) spin = spins[0];
      else if (tick > cfg.spinTicks + cfg.pauseTicks) spin = spins[1];
      if (spin) {
        angle += spin.sign * sweep;
        const hand = ginHandOf(player);
        // duas zanpakutos, uma de cada lado
        for (const arm of [0, Math.PI]) {
          const a = angle + arm;
          ginDrawBlade(dim, [hand, { x: hand.x + Math.cos(a) * cfg.radius, y: hand.y, z: hand.z + Math.sin(a) * cfg.radius }], 12, "ukitake:hilo", "ukitake:energia");
        }
        for (const entity of dim.getEntities({ location: hand, maxDistance: cfg.radius + 2 })) {
          if (entity.id === player.id || spin.hit.has(entity.id)) continue;
          if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
          const loc = entity.location;
          if (hand.y < loc.y - 0.3 || hand.y > loc.y + 2.0) continue;
          const dx = loc.x - hand.x;
          const dz = loc.z - hand.z;
          const dist = Math.hypot(dx, dz);
          if (dist > cfg.radius + 0.5) continue;
          const facing = Math.atan2(dz, dx);
          const slack = dist < 0.4 ? Math.PI : Math.atan2(0.6, dist);
          let swept = false;
          for (const arm of [0, Math.PI]) {
            const passed = spin.sign * angleDiff(angle + arm, facing);
            if (passed >= -slack && passed <= sweep + slack) swept = true;
          }
          if (!swept) continue;
          spin.hit.add(entity.id);
          dealDamage(entity, DAMAGE.yingYang * dmgMultiplier(player), player);
          showUkitakeSpark(entity);
        }
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (tick >= total) system.clearRun(interval);
  }, 1);
}

/* ---------- Stagnation ---------- */

function castStagnation(player) {
  const cfg = UKITAKE.stagnation;
  const target = ginNearestTarget(player, ginHandOf(player), cfg.range);
  if (!target) {
    player.sendMessage("§7Não tem ninguém por perto.");
    return;
  }
  if (!tryUseSkill(player, "ukitake:stagnation")) return;

  world.sendMessage(`§b${player.name}: §f§lStagnation §7(${nameOf(target)})`);
  ginPlaySound(player, "item.trident.throw", 1.0, 1.7);

  const dim = player.dimension;
  const cache = new Map();
  let landed = false;

  for (let n = 0; n < cfg.lines; n++) {
    system.runTimeout(() => {
      try {
        if (isDownOrGone(player)) return;
        const hand = ginHandOf(player);
        const view = player.getViewDirection();
        // sai em leque e depois vira pro alvo
        let dir = ginUnit({ x: 0, y: 0, z: 0 }, {
          x: view.x + (Math.random() - 0.5) * 1.2,
          y: view.y + (Math.random() - 0.3) * 0.8,
          z: view.z + (Math.random() - 0.5) * 1.2,
        });
        let pos = { ...hand };
        let life = 0;
        const interval = system.runInterval(() => {
          life++;
          try {
            if (isDownOrGone(target)) {
              system.clearRun(interval);
              return;
            }
            const goal = ginUnit(pos, ginBodyOf(target));
            dir = ginUnit({ x: 0, y: 0, z: 0 }, {
              x: dir.x * (1 - cfg.turn) + goal.x * cfg.turn,
              y: dir.y * (1 - cfg.turn) + goal.y * cfg.turn,
              z: dir.z * (1 - cfg.turn) + goal.z * cfg.turn,
            });
            const from = { ...pos };
            const to = { x: from.x + dir.x * cfg.speed, y: from.y + dir.y * cfg.speed, z: from.z + dir.z * cfg.speed };
            if (!ginBlockInfo(dim, cache, Math.floor(to.x), Math.floor(to.y), Math.floor(to.z)).passable) {
              system.clearRun(interval);
              return;
            }
            const reach = ginBodyReach(target, from, to);
            if (reach.dist <= cfg.radius) {
              system.clearRun(interval);
              if (!landed) {
                landed = true;
                ukitakeStagnate(player, target);
              }
              return;
            }
            pos = to;
            ginDrawBlade(dim, [from, to], 6, "ukitake:hilo", "ukitake:energia");
          } catch (e) {
            system.clearRun(interval);
            return;
          }
          if (life >= cfg.lifeTicks) system.clearRun(interval);
        }, 1);
      } catch (e) {}
    }, n * cfg.launchGapTicks);
  }
}

function ukitakeStagnate(player, target) {
  const cfg = UKITAKE.stagnation;
  if (isRespiring(target)) {
    showRespiraGuard(target);
    return;
  }
  if (isIntocable(target)) return;
  paralyzeFor(target, cfg.paralysisTicks, "§b❄ As linhas te prenderam: você está paralisado!");
  showUkitakeSpark(target);

  // suga 10% do awakening do alvo e passa pro Ukitake
  if (target.typeId === "minecraft:player") {
    const cur = getAwakening(target);
    const stolen = Math.min(cfg.steal, cur);
    if (stolen > 0) {
      target.setDynamicProperty(DP.awakening, cur - stolen);
      player.setDynamicProperty(DP.awakening, Math.min(100, getAwakening(player) + stolen));
      player.sendMessage(`§bSugou §f${stolen}%§b de awakening de ${nameOf(target)}!`);
    }
  }
}

/* ---------- Absorb ---------- */

function castAbsorb(player) {
  if (!tryUseSkill(player, "ukitake:absorb")) return;

  const cfg = UKITAKE.absorb;
  world.sendMessage(`§b${player.name}: §f§lAbsorb`);
  ginPlaySound(player, "beacon.activate", 1.2, 1.6);

  const end = system.currentTick + cfg.ticks;
  ukitakeAbsorb.set(player.id, end);
  const interval = system.runInterval(() => {
    try {
      if (isDownOrGone(player) || system.currentTick >= end || ukitakeAbsorb.get(player.id) !== end) {
        system.clearRun(interval);
        if (ukitakeAbsorb.get(player.id) === end) ukitakeAbsorb.delete(player.id);
        if (!isDownOrGone(player)) player.sendMessage(`§bAbsorb acabou. §7Dano guardado pro Hansha: §f${Math.round(ukitakeStoredOf(player))}`);
        return;
      }
      const l = player.location;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + system.currentTick * 0.15;
        player.dimension.spawnParticle("ukitake:energia", { x: l.x + Math.cos(a) * 1.4, y: l.y + 1 + Math.sin(a * 2) * 0.6, z: l.z + Math.sin(a) * 1.4 });
      }
    } catch (e) {
      system.clearRun(interval);
    }
  }, 4);
}

/* ---------- Awk: Hansha (super, gatilho: agachar + m1 com o medidor em 100%) ---------- */

function tryTriggerHansha(player) {
  if (getAwakening(player) < 100) return false;
  if (skillBlockingZoneFor(player)) return false;
  const stored = ukitakeStoredOf(player);
  if (stored <= 0) {
    player.sendMessage("§7Nenhum dano guardado: use o Absorb antes do Hansha.");
    return false;
  }

  player.setDynamicProperty(DP.awakening, 0);
  player.setDynamicProperty(UKITAKE_STORED, 0);
  world.sendMessage(`§b§lAWK: HANSHA §r§7- ${player.name} devolve §f${Math.round(stored)}§7 de dano!`);
  ginPlaySound(player, "beacon.activate", 2, 1.4);

  const cfg = RUKIA.hado; // mesma rajada larga do Hadō (alcance e espessura)
  const dim = player.dimension;
  const hand = ginHandOf(player);
  const dir = ginUnit(hand, ginAimPoint(player, cfg.range));
  const cache = new Map();
  let length = cfg.range;
  for (let d = 1; d <= cfg.range; d += 0.5) {
    if (!ginBlockInfo(dim, cache, Math.floor(hand.x + dir.x * d), Math.floor(hand.y + dir.y * d), Math.floor(hand.z + dir.z * d)).passable) {
      length = Math.max(0, d - 0.5);
      break;
    }
  }
  const hit = new Set();
  const attackTicks = cfg.extendTicks + cfg.holdTicks;
  const total = attackTicks + cfg.fadeTicks;
  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    try {
      const reach = tick <= cfg.extendTicks ? (length * tick) / cfg.extendTicks : length;
      const start = ginHandOf(player);
      const tip = { x: start.x + dir.x * reach, y: start.y + dir.y * reach, z: start.z + dir.z * reach };
      ginDrawBlade(dim, [start, tip], 26, "ukitake:energia", "ukitake:energia");
      if (tick <= attackTicks) {
        for (const entity of ginEntitiesOnSegment(player, start, tip, cfg.radius, hit)) {
          hit.add(entity.id);
          if (isRespiring(entity)) {
            showRespiraGuard(entity);
            continue;
          }
          dealDamage(entity, stored, player);
          showUkitakeSpark(entity);
        }
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (tick >= total) system.clearRun(interval);
  }, 1);
  return true;
}

/* ---------------------------------------------------------
   Kaname Tōsen (Tier 3) - Suzumushi / Enma Kōrogi
   Individualidade: cegueira permanente (aplicada em applyCharacterEffects).
   As skills funcionam "no escuro": area ao redor, laminas teleguiadas, avanco
   que acha quem estiver na frente.
   --------------------------------------------------------- */

const TOSEN = {
  nake: { radius: 12, growTicks: 5, paralysisTicks: 120 }, // 6s
  benihiko: { blades: 6, launchGapTicks: 2, speed: 2.0, lifeTicks: 50, turn: 0.35, radius: 1.0, nauseaTicks: 120, range: 40 },
  hado88: { radius: 15, flashTicks: 8, bolts: 5, damageDelayTicks: 4 },
  silentCut: { distance: 14, touchRadius: 1.4, stopBefore: 1.0 },
  enma: {
    radius: 20, // esfera "enorme"
    buildTicks: 10, // a esfera sobe de baixo pra cima
    durationTicks: 600, // 30s
    blindEvery: 20,
    lineEvery: 5,
    lineHeight: 6,
  },
};

// Visored (forma alternativa): NAO usa o medidor de awakening. Ativa
// carregando agachado com a Suzumushi base por 5s e depois usando ela.
// Enquanto ativo continua com a cegueira da individualidade (igual a forma
// base), so ganha a cura por segundo e a mascara.
const TOSEN_VISORED = {
  chargeTicksNeeded: 100, // 5s
  health: 2000,
  healPerInterval: { amount: 10, ticks: 20 }, // 10 de vida a cada 1s
  items: {
    0: "tosen:m1_visored",
    1: "tosen:palacio_de_las_espadas",
    2: "tosen:ecolocalizacion",
    3: "tosen:cero",
    4: "tosen:los_nueve_aspectos",
  },
  palacio: { swords: 8, range: 22, gapTicks: 4, radius: 6 },
  eco: { radius: 30, durationTicks: 100, lineEvery: 4 }, // 5s
  cero: { radius: 1.6, range: 45, speed: 2.3 },
  nueve: { radius: 12, attacks: 10, gapTicks: 6 },
};

const tosenVisoredCharge = new Map(); // playerId -> ticks segurando
const tosenVisoredReady = new Set(); // playerId com a mascara pronta pra ativar
const tosenOldHelmet = new Map(); // playerId -> item que estava no capacete antes da mascara

function resetTosenVisoredCharge(player) {
  tosenVisoredCharge.delete(player.id);
  tosenVisoredReady.delete(player.id);
}

function resetTosenVisoredChargeId(playerId) {
  tosenVisoredCharge.delete(playerId);
  tosenVisoredReady.delete(playerId);
}

function isTosenVisored(player) {
  try {
    return getActiveCharacter(player)?.id === "tosen" && !!player.getDynamicProperty(DP.tosenVisored);
  } catch (e) {
    return false;
  }
}

function activateTosenVisored(player, character) {
  player.setDynamicProperty(DP.tosenVisored, true);

  applyCharacterEffects(player, TOSEN_VISORED.health, BASE_SPEED_AMPLIFIER);

  const inv = getInv(player);
  for (const slot in TOSEN_VISORED.items) {
    inv.setItem(Number(slot), new ItemStack(TOSEN_VISORED.items[slot], 1));
  }

  system.runTimeout(() => healToMax(player, cutHealthFor(player, TOSEN_VISORED.health)), 2);

  try {
    const equip = player.getComponent("minecraft:equippable");
    if (equip) {
      tosenOldHelmet.set(player.id, equip.getEquipment(EquipmentSlot.Head));
      equip.setEquipment(EquipmentSlot.Head, new ItemStack("shinji:mask_visual", 1));
    }
  } catch (e) {}

  world.sendMessage(`§8§l${player.name} despertou: Visored!`);
  player.sendMessage("§8§lA máscara tomou seu rosto. §r§7Você é agora o Tōsen Visored.");
  try {
    player.dimension.playSound("mob.wither.spawn", player.location, { volume: 1.4, pitch: 1.3 });
  } catch (e) {}
}

function deactivateTosenVisored(player, reason) {
  if (!isTosenVisored(player)) return;
  const character = getActiveCharacter(player);
  if (!character) return;

  player.setDynamicProperty(DP.tosenVisored, false);

  const hpBefore = player.getComponent("minecraft:health");
  const previousHealth = hpBefore ? hpBefore.currentValue : character.health;

  applyCharacterEffects(player, character.health, BASE_SPEED_AMPLIFIER);

  const inv = getInv(player);
  for (const slot in character.items) {
    inv.setItem(Number(slot), new ItemStack(character.items[slot], 1));
  }

  try {
    const equip = player.getComponent("minecraft:equippable");
    if (equip) equip.setEquipment(EquipmentSlot.Head, tosenOldHelmet.get(player.id));
  } catch (e) {}
  tosenOldHelmet.delete(player.id);

  system.runTimeout(() => {
    const hp = player.getComponent("minecraft:health");
    if (hp) hp.setCurrentValue(Math.min(previousHealth, realMaxHealthFor(character.health)));
  }, 2);

  player.sendMessage(
    reason === "manual"
      ? "§7Você tirou a máscara. Voltando à Suzumushi normal."
      : "§7O Visored acabou. Voltando à Suzumushi normal."
  );
}

const tosenEnma = new Map(); // id do Tosen -> { until }

function isTosenPlayer(entity) {
  try {
    return entity.typeId === "minecraft:player" && getActiveCharacter(entity)?.id === "tosen";
  } catch (e) {
    return false;
  }
}

// particula que so o Tosen enxerga (o wall hack); se a API nao tiver, cai na normal
function tosenSee(player, name, loc) {
  try {
    if (typeof player.spawnParticle === "function") player.spawnParticle(name, loc);
    else player.dimension.spawnParticle(name, loc);
  } catch (e) {}
}

function showTosenSpark(entity) {
  try {
    const l = entity.location;
    for (let i = 0; i < 4; i++) {
      entity.dimension.spawnParticle(i % 2 === 0 ? "tosen:corte" : "tosen:rayo", {
        x: l.x + (Math.random() - 0.5) * 0.9,
        y: l.y + 0.4 + Math.random() * 1.2,
        z: l.z + (Math.random() - 0.5) * 0.9,
      });
    }
  } catch (e) {}
}

/* ---------- Nake ---------- */

function castNake(player) {
  if (!tryUseSkill(player, "tosen:nake")) return;

  world.sendMessage(`§5${player.name}: §f§lNake`);
  ginPlaySound(player, "note.bell", 3, 2);

  const cfg = TOSEN.nake;
  const dim = player.dimension;
  const o = { ...player.location };
  const hit = new Set();
  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    try {
      const r = (cfg.radius * tick) / cfg.growTicks;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2;
        dim.spawnParticle("tosen:onda", { x: o.x + Math.cos(a) * r, y: o.y + 1, z: o.z + Math.sin(a) * r });
      }
      // o som incapacita quem esta dentro do raio: dano e paralisia de 6s
      for (const entity of dim.getEntities({ location: o, maxDistance: cfg.radius + 1 })) {
        if (entity.id === player.id || hit.has(entity.id)) continue;
        if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
        if (Math.hypot(entity.location.x - o.x, entity.location.z - o.z) > r + 0.5) continue;
        if (Math.abs(entity.location.y - o.y) > 6) continue;
        hit.add(entity.id);
        dealDamage(entity, DAMAGE.nake * dmgMultiplier(player), player);
        showTosenSpark(entity);
        if (!isDownOrGone(entity) && !isIntocable(entity)) {
          paralyzeFor(entity, cfg.paralysisTicks, "§5♪ O som te incapacitou por 6s!");
        }
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (tick >= cfg.growTicks) system.clearRun(interval);
  }, 1);
}

/* ---------- Benihikō ---------- */

function castBenihiko(player) {
  const cfg = TOSEN.benihiko;
  const target = ginNearestTarget(player, ginHandOf(player), cfg.range);
  if (!target) {
    player.sendMessage("§7Não tem ninguém por perto.");
    return;
  }
  if (!tryUseSkill(player, "tosen:benihiko")) return;

  world.sendMessage(`§5${player.name}: §f§lBenihikō`);
  ginPlaySound(player, "random.orb", 2, 0.6);

  const dim = player.dimension;
  const cache = new Map();
  const perBlade = DAMAGE.benihiko / cfg.blades; // os 250 se dividem entre as laminas

  for (let n = 0; n < cfg.blades; n++) {
    system.runTimeout(() => {
      try {
        if (isDownOrGone(player)) return;
        const hand = ginHandOf(player);
        const view = player.getViewDirection();
        // sai em leque e depois vira pro alvo (teleguiada)
        let dir = ginUnit(
          { x: 0, y: 0, z: 0 },
          {
            x: view.x + (Math.random() - 0.5) * 1.4,
            y: view.y + (Math.random() - 0.2) * 0.9,
            z: view.z + (Math.random() - 0.5) * 1.4,
          }
        );
        let pos = { ...hand };
        let life = 0;
        const interval = system.runInterval(() => {
          life++;
          try {
            if (isDownOrGone(target)) {
              system.clearRun(interval);
              return;
            }
            const goal = ginUnit(pos, ginBodyOf(target));
            dir = ginUnit(
              { x: 0, y: 0, z: 0 },
              {
                x: dir.x * (1 - cfg.turn) + goal.x * cfg.turn,
                y: dir.y * (1 - cfg.turn) + goal.y * cfg.turn,
                z: dir.z * (1 - cfg.turn) + goal.z * cfg.turn,
              }
            );
            const from = { ...pos };
            const to = { x: from.x + dir.x * cfg.speed, y: from.y + dir.y * cfg.speed, z: from.z + dir.z * cfg.speed };
            if (!ginBlockInfo(dim, cache, Math.floor(to.x), Math.floor(to.y), Math.floor(to.z)).passable) {
              system.clearRun(interval);
              return;
            }
            if (ginBodyReach(target, from, to).dist <= cfg.radius) {
              system.clearRun(interval);
              if (isRespiring(target)) {
                showRespiraGuard(target);
                return;
              }
              dealDamage(target, perBlade * dmgMultiplier(player), player);
              showTosenSpark(target);
              if (!isDownOrGone(target) && !isIntocable(target)) {
                try {
                  target.addEffect("nausea", cfg.nauseaTicks, { amplifier: 0, showParticles: false });
                } catch (e) {}
              }
              return;
            }
            pos = to;
            ginDrawBlade(dim, [from, to], 5, "tosen:lamina", "tosen:lamina");
          } catch (e) {
            system.clearRun(interval);
            return;
          }
          if (life >= cfg.lifeTicks) system.clearRun(interval);
        }, 1);
      } catch (e) {}
    }, n * cfg.launchGapTicks);
  }
}

/* ---------- Hadō #88: Hiryū Gekizoku Shinten Raihō ---------- */

function castHado88(player) {
  if (!tryUseSkill(player, "tosen:hado_88")) return;

  world.sendMessage(`§e${player.name}: §f§lHadō #88: Hiryū Gekizoku Shinten Raihō`);
  ginPlaySound(player, "ambient.weather.thunder", 3, 0.8);

  const cfg = TOSEN.hado88;
  const dim = player.dimension;
  const o = { ...player.location };
  const hit = new Set();
  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    try {
      // raios em zigue-zague partindo do centro
      for (let b = 0; b < cfg.bolts; b++) {
        const a = Math.random() * Math.PI * 2;
        const elev = (Math.random() - 0.3) * 0.9;
        const len = cfg.radius * (0.6 + Math.random() * 0.4);
        const dx = Math.cos(a);
        const dz = Math.sin(a);
        for (let d = 0; d <= len; d += 1.4) {
          dim.spawnParticle("tosen:rayo", {
            x: o.x + dx * d + (Math.random() - 0.5) * 0.9,
            y: o.y + 1 + elev * d + (Math.random() - 0.5) * 0.9,
            z: o.z + dz * d + (Math.random() - 0.5) * 0.9,
          });
        }
      }
      dim.spawnParticle("tosen:rayo", { x: o.x, y: o.y + 1, z: o.z });

      // a descarga acerta todo mundo no raio (uma vez)
      if (tick === cfg.damageDelayTicks) {
        for (const entity of dim.getEntities({ location: o, maxDistance: cfg.radius + 1 })) {
          if (entity.id === player.id || hit.has(entity.id)) continue;
          if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
          if (Math.hypot(entity.location.x - o.x, entity.location.z - o.z) > cfg.radius) continue;
          if (Math.abs(entity.location.y - o.y) > 8) continue;
          hit.add(entity.id);
          dealDamage(entity, DAMAGE.hado88 * dmgMultiplier(player), player);
          showTosenSpark(entity);
        }
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (tick >= cfg.flashTicks) system.clearRun(interval);
  }, 1);
}

/* ---------- Silent Cut ---------- */

function tosenDashEnd(player, dir, maxDist) {
  const dim = player.dimension;
  const start = player.location;
  const cache = new Map();
  let last = { x: start.x, y: start.y, z: start.z };
  for (let d = 0.5; d <= maxDist; d += 0.5) {
    const p = { x: start.x + dir.x * d, y: start.y + dir.y * d, z: start.z + dir.z * d };
    const fx = Math.floor(p.x);
    const fy = Math.floor(p.y);
    const fz = Math.floor(p.z);
    if (!ginBlockInfo(dim, cache, fx, fy, fz).passable || !ginBlockInfo(dim, cache, fx, fy + 1, fz).passable) break;
    last = p;
  }
  return last;
}

function castSilentCut(player) {
  if (!tryUseSkill(player, "tosen:silent_cut")) return; // o cooldown corre mesmo se nao achar ninguem

  const cfg = TOSEN.silentCut;
  world.sendMessage(`§5${player.name}: §f§lSilent Cut`);
  const dim = player.dimension;
  const from = { ...player.location };
  const v = player.getViewDirection();
  const y = Math.max(-0.5, Math.min(0.5, v.y));
  const h = Math.hypot(v.x, v.z) || 1;
  const k = Math.sqrt(Math.max(0, 1 - y * y)) / h;
  const dir = { x: v.x * k, y, z: v.z * k };

  let end = tosenDashEnd(player, dir, cfg.distance);
  const a = { x: from.x, y: from.y + 1, z: from.z };
  const b = { x: end.x, y: end.y + 1, z: end.z };
  const [target] = ginEntitiesOnSegment(player, a, b, cfg.touchRadius, null);
  if (target) {
    // o avanco para colado em quem esta no caminho
    const reach = ginBodyReach(target, a, b);
    const total = ginDist(from, end) || 1;
    const stop = Math.max(0, reach.t * total - cfg.stopBefore);
    end = { x: from.x + ((end.x - from.x) * stop) / total, y: end.y, z: from.z + ((end.z - from.z) * stop) / total };
  }
  try {
    player.teleport(end);
  } catch (e) {}
  for (let d = 0; d <= ginDist(from, end); d += 1) {
    const t = ginDist(from, end) ? d / ginDist(from, end) : 0;
    try {
      dim.spawnParticle("tosen:corte", { x: from.x + (end.x - from.x) * t, y: from.y + 1, z: from.z + (end.z - from.z) * t });
    } catch (e) {
      break;
    }
  }
  ginPlaySound(player, "item.trident.throw", 1.2, 1.9);
  if (!target) return; // so ficou em cooldown

  const grimm = target.typeId === "minecraft:player" && getActiveCharacter(target)?.id === "grimmjow";
  dealDamage(target, (grimm ? DAMAGE.silentCutGrimmjow : DAMAGE.silentCut) * dmgMultiplier(player), player);
  showTosenSpark(target);
  if (grimm) world.sendMessage(`<${target.name}> AIIII MEU BRAÇO FDP`);
}

/* ---------- Visored: Palacio de las Espadas ---------- */

// 8 espadas gigantes convergem no alvo mais proximo, uma a uma, cada uma
// causando dano + um pulso de onda sonora que paralisa por um instante.
function castPalacioDeLasEspadas(player) {
  if (!tryUseSkill(player, "tosen:palacio_de_las_espadas")) return;

  const cfg = TOSEN_VISORED.palacio;
  const target = nearestTarget(player, cfg.range);
  world.sendMessage(`§8${player.name}: §f§lPalacio de las Espadas`);
  ginPlaySound(player, "mob.wither.shoot", 1.4, 0.8);

  if (!target) return; // so ficou em cooldown

  const dim = player.dimension;
  let sword = 0;
  const interval = system.runInterval(() => {
    try {
      if (isDownOrGone(player) || !isTosenVisored(player) || isDownOrGone(target)) {
        system.clearRun(interval);
        return;
      }
      const angle = Math.random() * Math.PI * 2;
      const start = {
        x: target.location.x + Math.cos(angle) * 8,
        y: target.location.y + 5 + Math.random() * 3,
        z: target.location.z + Math.sin(angle) * 8,
      };
      const tip = { x: target.location.x, y: target.location.y + 1, z: target.location.z };
      ginDrawBlade(dim, [start, tip], 6, "tosen:lamina", "tosen:lamina");
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        dim.spawnParticle("tosen:onda", {
          x: tip.x + Math.cos(a) * cfg.radius * 0.5,
          y: tip.y,
          z: tip.z + Math.sin(a) * cfg.radius * 0.5,
        });
      }
      if (!isDownOrGone(target)) {
        dealDamage(target, DAMAGE.tosenPalacio * dmgMultiplier(player), player);
        showTosenSpark(target);
        if (!isIntocable(target)) paralyzeFor(target, 20, "§8As ondas sonoras te paralisaram!");
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    sword++;
    if (sword >= cfg.swords) system.clearRun(interval);
  }, cfg.gapTicks);
}

/* ---------- Visored: Ecolocalización ---------- */

// marca todo player ao redor com wall hack literal (o Tosen ve mesmo atraves
// de paredes) por alguns segundos.
function castEcolocalizacion(player) {
  if (!tryUseSkill(player, "tosen:ecolocalizacion")) return;

  const cfg = TOSEN_VISORED.eco;
  world.sendMessage(`§8${player.name}: §f§lEcolocalización`);
  ginPlaySound(player, "note.bell", 2, 1.8);
  try {
    player.dimension.spawnParticle("tosen:onda", { x: player.location.x, y: player.location.y + 1, z: player.location.z });
  } catch (e) {}

  let tick = 0;
  const interval = system.runInterval(() => {
    tick += cfg.lineEvery;
    try {
      if (isDownOrGone(player) || !isTosenVisored(player) || tick >= cfg.durationTicks) {
        system.clearRun(interval);
        return;
      }
      for (const p of player.dimension.getPlayers({ location: player.location, maxDistance: cfg.radius })) {
        if (p.id === player.id || isDownOrGone(p)) continue;
        const l = p.location;
        for (let h = 0; h < 3; h++) {
          tosenSee(player, "tosen:rayo", { x: l.x, y: l.y + h, z: l.z });
        }
      }
    } catch (e) {
      system.clearRun(interval);
    }
  }, cfg.lineEvery);
}

/* ---------- Visored: Cero ---------- */

function castTosenCero(player) {
  if (!tryUseSkill(player, "tosen:cero")) return;

  const cfg = TOSEN_VISORED.cero;
  world.sendMessage(`§8${player.name}: §f§lCero`);
  ginPlaySound(player, "mob.wither.shoot", 1.6, 1.1);

  fireEnergySphere(player, {
    radius: cfg.radius,
    range: cfg.range,
    speed: cfg.speed,
    damage: DAMAGE.tosenCero,
    particle: "vizard:cero",
  });
}

/* ---------- Visored: Los Nueve Aspectos ---------- */

// 10 cortes omnidirecionais em area, um a um, acertando todo mundo perto
// (menos o Tosen) a cada pulso.
function castLosNueveAspectos(player) {
  if (!tryUseSkill(player, "tosen:los_nueve_aspectos")) return;

  const cfg = TOSEN_VISORED.nueve;
  world.sendMessage(`§8${player.name}: §f§lLos Nueve Aspectos`);
  ginPlaySound(player, "mob.wither.spawn", 1.5, 1.4);

  const dim = player.dimension;
  const o = { ...player.location };
  let attack = 0;
  const interval = system.runInterval(() => {
    try {
      if (isDownOrGone(player) || !isTosenVisored(player)) {
        system.clearRun(interval);
        return;
      }
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + attack * 0.3;
        for (let r = 1; r <= cfg.radius; r += 2) {
          dim.spawnParticle("tosen:corte", { x: o.x + Math.cos(a) * r, y: o.y + 1, z: o.z + Math.sin(a) * r });
        }
      }
      for (const entity of dim.getEntities({ location: o, maxDistance: cfg.radius })) {
        if (entity.id === player.id || isDownOrGone(entity)) continue;
        if (!entity.getComponent("minecraft:health")) continue;
        dealDamage(entity, DAMAGE.tosenNueveAspectos * dmgMultiplier(player), player);
        showTosenSpark(entity);
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    attack++;
    if (attack >= cfg.attacks) system.clearRun(interval);
  }, cfg.gapTicks);
}

/* ---------- Awk-Bankai: Suzukushi Tsuishiki: Enma Kōrogi (super) ---------- */

// as particulas do wall hack: uma coluna em cima de cada um dentro da esfera, so o Tosen ve
function tosenDrawLines(tosen, center, cfg) {
  for (const entity of tosen.dimension.getEntities({ location: center, maxDistance: cfg.radius })) {
    if (entity.id === tosen.id) continue;
    if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
    const l = entity.location;
    for (let h = 0; h <= cfg.lineHeight; h += 0.75) {
      tosenSee(tosen, "tosen:rayo", { x: l.x, y: l.y + h, z: l.z });
    }
  }
}

function runEnma(player) {
  const cfg = TOSEN.enma;
  const dim = player.dimension;
  const center = { ...player.location };
  const R = cfg.radius;
  const ledger = iceTrack([]);
  const state = { until: system.currentTick + cfg.durationTicks };
  tosenEnma.set(player.id, state);

  world.sendMessage(`§0§lBANKAI: Suzukushi Tsuishiki: Enma Kōrogi §r§7- ${player.name}`);
  ginPlaySound(player, "mob.wither.spawn", 2, 0.6);

  // ele "ve" pelas linhas: a cegueira da individualidade sai enquanto a esfera existe
  try {
    player.removeEffect("blindness");
  } catch (e) {}

  // a casca da esfera (espessura ~1,5), de baixo pra cima; so troca celula sem bloco
  const cells = [];
  const cx = Math.floor(center.x);
  const cy = Math.floor(center.y);
  const cz = Math.floor(center.z);
  for (let dx = -R - 1; dx <= R + 1; dx++) {
    for (let dy = -R - 1; dy <= R + 1; dy++) {
      for (let dz = -R - 1; dz <= R + 1; dz++) {
        const d = Math.hypot(dx + 0.5, dy + 0.5, dz + 0.5);
        if (d >= R - 1.0 && d <= R + 0.5) cells.push([cx + dx, cy + dy, cz + dz]);
      }
    }
  }
  cells.sort((a, b) => a[1] - b[1]);
  const perTick = Math.max(1, Math.ceil(cells.length / cfg.buildTicks));
  const cache = new Map();
  let idx = 0;
  let tick = 0;

  const finish = () => {
    system.clearRun(interval);
    iceRestore(ledger); // a esfera some (volta o que estava ali)
    tosenEnma.delete(player.id);
    for (const p of dim.getPlayers({ location: center, maxDistance: R + 10 })) {
      try {
        if (p.id !== player.id) p.removeEffect("blindness");
      } catch (e) {}
    }
    try {
      if (isTosenPlayer(player)) {
        setPermanentEffect(player, "blindness", 0);
        player.sendMessage("§7A esfera se desfez e a escuridão voltou só pra você.");
      }
    } catch (e) {}
    world.sendMessage("§8A esfera negra desapareceu.");
  };

  const interval = system.runInterval(() => {
    tick++;
    try {
      if (isDownOrGone(player) || !isTosenPlayer(player) || system.currentTick >= state.until) {
        finish();
        return;
      }
      for (let n = 0; n < perTick && idx < cells.length; n++, idx++) {
        const [x, y, z] = cells[idx];
        if (ginBlockInfo(dim, cache, x, y, z).passable) iceSet(ledger, dim, x, y, z, "minecraft:black_concrete");
      }
      // todos la dentro ficam sem visao
      if (tick % cfg.blindEvery === 1) {
        for (const p of dim.getPlayers({ location: center, maxDistance: R })) {
          if (p.id === player.id || isDownOrGone(p)) continue;
          p.addEffect("blindness", cfg.blindEvery * 3, { amplifier: 0, showParticles: false });
        }
      }
      if (tick % cfg.lineEvery === 0) tosenDrawLines(player, center, cfg);
    } catch (e) {
      finish();
    }
  }, 1);
}

function tryTriggerEnma(player) {
  if (getAwakening(player) < 100) return false;
  if (skillBlockingZoneFor(player)) return false;
  if (tosenEnma.has(player.id)) return false;

  player.setDynamicProperty(DP.awakening, 0);
  runEnma(player);
  return true;
}

/* ---------------------------------------------------------
   Sousuke Aizen (Captain's Fight) - Tier 6

   Individualidade: a Kyōka Suigetsu. Quem leva um m1 dela fica marcado PRA
   SEMPRE (dynamic property no alvo) e passa a poder ser afetado pelas ilusões;
   quem nunca foi acertado não é. Bater num bloco com ela marca o bloco, e
   agachar duas vezes em 2s leva o Aizen até ele.

   Ilusões (exigem a marca e terminam com a Kyōka se partindo pra todo mundo):
     Illusion's Mastery, Fool's Trick e o Counter.
   Físicas (não exigem nada): Betrayal of the Illusioner, Bakudō #61 e a
   Kurohitsugi (Hadō #90).
   Toda fala do Aizen no chat sai em roxo.
   --------------------------------------------------------- */

const AIZEN = {
  cloneType: "aizen:clone",
  kyoka: "aizen:m1_kyoka_suigetsu",
  kyokaHidden: "aizen:m1_kyoka_oculta",
  targetRange: 32,
  mastery: {
    durationTicks: 200, // nao especificado: 10s ate a ilusao se desfazer sozinha
    clones: 3,
    radius: 2.2,
    spinPerTick: 3, // graus: o triangulo gira devagar em volta do alvo
    strikeSlownessAmplifier: 2, // "lentidao" sem nivel: Lentidão III
    strikeSlownessTicks: 60, // nao especificado: 3s
  },
  betrayal: { teleports: 5, gapTicks: 20, behind: 1.6, windowTicks: 100, m1Multiplier: 2 },
  bakudo: { paralysisTicks: 100, bars: 6, slamTicks: 3, refreshTicks: 4 },
  foolsTrick: { revealDelayTicks: 60, slashDelayTicks: 10, paralysisTicks: 30, nauseaTicks: 80 },
  counter: { hits: 5, windowTicks: 60, paralysisTicks: 60 },
  doubleSneakTicks: 40,
  kurohitsugi: {
    size: 10, // caixa 10x10x10
    hits: 50,
    strikeEveryTicks: 2,
    // o dano sai em rajadas: 5 golpes somados a cada 10 ticks. Golpe a golpe a
    // cada 2 ticks poderia esbarrar na invulnerabilidade pos-dano do alvo; o
    // total (50 x 50) chega igual
    damageEveryTicks: 10,
    buildTicks: 10,
    hitDamage: DAMAGE.aizenKurohitsugiHit,
  },
};

const aizenIllusions = new Map(); // id do Aizen -> ilusao ativa
const aizenCloneOwner = new Map(); // id do clone -> id do Aizen
// id do clone -> "mastery" (Captain's Fight), "switch" ou "kanzen" (Hōgyoku)
const aizenCloneKind = new Map();
const aizenCloneHitTick = new Map(); // id do clone -> tick do ultimo golpe visto
const aizenBetrayals = new Map(); // id do Aizen -> { until, timer }
const aizenTricks = new Map(); // id do Aizen -> Fool's Trick em andamento
const aizenCoffins = new Map(); // id do Aizen -> Kurohitsugi em andamento
const aizenCounterHits = new Map(); // id do Aizen -> Map(atacante -> ticks)
const aizenTrack = new Map(); // id do Aizen -> { hp: [...], agachar duplo }

function isAizen(entity) {
  try {
    return entity?.typeId === "minecraft:player" && getActiveCharacter(entity)?.id === "aizen";
  } catch (e) {
    return false;
  }
}

function isKyoka(typeId) {
  return typeId === AIZEN.kyoka || typeId === AIZEN.kyokaHidden;
}

// toda fala do Aizen no chat e roxa
function aizenSay(player, text, bold = false) {
  let name = "Aizen";
  try {
    name = player.name;
  } catch (e) {}
  world.sendMessage(`§5${bold ? "§l" : ""}<${name}> ${text}`);
}

function aizenTrackOf(player) {
  let track = aizenTrack.get(player.id);
  if (!track) {
    track = { hp: [], sneaking: false, sneakStart: 0, sneakSpent: false, lastTap: undefined };
    aizenTrack.set(player.id, track);
  }
  return track;
}

function aizenSneakSpent(player) {
  aizenTrackOf(player).sneakSpent = true;
}

function hasKyokaMark(entity) {
  // Ichigo (Dangai): as ilusoes do Aizen nao pegam nele, com marca ou sem
  if (isIllusionImmune(entity)) return false;
  try {
    return entity.getDynamicProperty(DP.kyokaMark) === true;
  } catch (e) {
    return false;
  }
}

function aizenPuff(dim, loc, count = 8, spread = 0.6) {
  for (let i = 0; i < count; i++) {
    try {
      dim.spawnParticle("aizen:reiatsu", {
        x: loc.x + (Math.random() - 0.5) * spread * 2,
        y: loc.y + 0.3 + Math.random() * 1.6,
        z: loc.z + (Math.random() - 0.5) * spread * 2,
      });
    } catch (e) {}
  }
}

// "a Kyōka quebrando": vidro em camadas, com ametista por cima pra soar como
// cristal/espelho e o beacon apagando no fim. Toca na posicao de CADA player,
// entao todo mundo ouve igual, perto ou longe.
const KYOKA_SHATTER = [
  [0, "random.glass", 0.7, 1],
  [0, "break.amethyst_block", 0.6, 0.9],
  [2, "random.glass", 1.0, 0.9],
  [2, "chime.amethyst_block", 1.2, 1],
  [4, "random.glass", 1.35, 0.8],
  [4, "break.amethyst_cluster", 1.0, 0.8],
  [7, "chime.amethyst_block", 0.8, 0.7],
  [7, "beacon.deactivate", 1.4, 0.5],
];

function kyokaShatter(dim, center) {
  if (dim && center) {
    for (let i = 0; i < 3; i++) {
      try {
        dim.spawnParticle("aizen:estilhaco", {
          x: center.x + (Math.random() - 0.5),
          y: center.y + 0.8 + Math.random(),
          z: center.z + (Math.random() - 0.5),
        });
      } catch (e) {}
    }
  }
  for (const [delay, sound, pitch, volume] of KYOKA_SHATTER) {
    const play = () => {
      for (const p of world.getPlayers()) {
        try {
          p.playSound(sound, { pitch, volume });
        } catch (e) {}
      }
    };
    if (delay) system.runTimeout(play, delay);
    else play();
  }
}

// alvo na mira do Aizen, pulando os proprios clones
function aizenTargetInView(player, range = AIZEN.targetRange) {
  try {
    return player
      .getEntitiesFromViewDirection({ maxDistance: range })
      .map((hit) => hit.entity)
      .find(
        (entity) =>
          entity &&
          entity.id !== player.id &&
          entity.typeId !== AIZEN.cloneType &&
          entity.getComponent("minecraft:health") &&
          !isDownOrGone(entity)
      );
  } catch (e) {
    return undefined;
  }
}

function aizenStandable(dim, loc) {
  try {
    const feet = dim.getBlock({ x: Math.floor(loc.x), y: Math.floor(loc.y), z: Math.floor(loc.z) });
    const head = feet?.above();
    return !!feet && !!head && (feet.isAir || feet.isLiquid) && (head.isAir || head.isLiquid);
  } catch (e) {
    return false;
  }
}

// atras do alvo, do lado oposto ao que ele olha. Parede nas costas: tenta mais
// perto, depois os lados; sem espaco nenhum, aparece colado no proprio alvo
// (o jogo separa os dois) em vez de dentro de um bloco
function aizenSpotBehind(target, distance) {
  const view = target.getViewDirection();
  const length = Math.hypot(view.x, view.z) || 1;
  const bx = -view.x / length;
  const bz = -view.z / length;
  const t = target.location;
  const options = [
    [bx * distance, bz * distance],
    [bx * distance * 0.6, bz * distance * 0.6],
    [bz * distance, -bx * distance], // lado direito
    [-bz * distance, bx * distance], // lado esquerdo
  ];
  for (const [dx, dz] of options) {
    const spot = { x: t.x + dx, y: t.y, z: t.z + dz };
    if (aizenStandable(target.dimension, spot)) return spot;
  }
  return { x: t.x, y: t.y, z: t.z };
}

// Rotacao olhando reto pro alvo: so o giro horizontal, inclinacao zero. O
// facingLocation mira a partir dos PES de quem teleporta, entao apontar pro
// peito do alvo deixava o Aizen olhando pra cima depois de cada teleporte.
function levelRotationToward(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  // yaw do Bedrock: 0 = +Z (sul), 90 = -X (oeste); direcao = (-sin, cos)
  return { x: 0, y: (Math.atan2(-dx, dz) * 180) / Math.PI };
}

function aizenBlinkBehind(player, target, distance) {
  const from = player.location;
  const spot = aizenSpotBehind(target, distance);
  const t = target.location;
  player.teleport(spot, {
    dimension: target.dimension,
    keepVelocity: false,
    rotation: levelRotationToward(spot, t),
  });
  aizenPuff(player.dimension, from, 6, 0.4);
  aizenPuff(target.dimension, spot, 6, 0.4);
  target.dimension.playSound("mob.endermen.portal", spot, { volume: 0.7, pitch: 1.5 });
  return spot;
}

function setVirtualHealth(entity, value) {
  const hp = entity.getComponent("minecraft:health");
  if (!hp) return;
  hp.setCurrentValue(Math.max(1, Math.min(hp.effectiveMax, value / healthScaleOf(entity))));
}

/* ---------- individualidade: a marca da Kyōka ---------- */

function markWithKyoka(aizen, target) {
  if (!target || target.id === aizen.id || target.typeId === AIZEN.cloneType) return;
  if (isIllusionImmune(target)) return;
  if (hasKyokaMark(target)) return;
  try {
    target.setDynamicProperty(DP.kyokaMark, true);
  } catch (e) {
    return;
  }
  try {
    aizen.sendMessage(`§5A Kyōka Suigetsu marcou §d${nameOf(target)}§5: as ilusões agora funcionam nele.`);
    aizenPuff(target.dimension, target.location, 10, 0.5);
  } catch (e) {}
}

function aizenMarkBlock(player, block) {
  const loc = block.location;
  const mark = JSON.stringify({ x: loc.x, y: loc.y, z: loc.z, dim: block.dimension.id });
  if (player.getDynamicProperty(DP.kyokaBlock) === mark) return;
  player.setDynamicProperty(DP.kyokaBlock, mark);
  aizenPuff(block.dimension, { x: loc.x + 0.5, y: loc.y + 0.6, z: loc.z + 0.5 }, 10, 0.5);
  try {
    player.playSound("chime.amethyst_block", { pitch: 1.5, volume: 0.8 });
  } catch (e) {}
  player.sendMessage("§5Bloco marcado pela Kyōka Suigetsu. §7(agache duas vezes em 2s pra voltar até ele)");
}

function aizenMarkedBlock(player) {
  const raw = player.getDynamicProperty(DP.kyokaBlock);
  if (typeof raw !== "string") return undefined;
  try {
    return JSON.parse(raw);
  } catch (e) {
    player.setDynamicProperty(DP.kyokaBlock, undefined);
    return undefined;
  }
}

function aizenTeleportToBlock(player) {
  const mark = aizenMarkedBlock(player);
  if (!mark) {
    player.sendMessage("§5Nenhum bloco marcado: bata num bloco com a Kyōka Suigetsu.");
    return false;
  }
  if (isFrozen(player) || isMayuriParalyzed(player) || trappingZoneFor(player)) {
    player.sendMessage("§5Preso: a Kyōka não consegue te tirar daqui.");
    return false;
  }
  let dim;
  let block;
  try {
    dim = world.getDimension(mark.dim);
    block = dim.getBlock({ x: mark.x, y: mark.y, z: mark.z });
  } catch (e) {}
  if (!block) {
    player.sendMessage("§5O bloco marcado está longe demais (fora da área carregada).");
    return false;
  }
  if (block.isAir || block.isLiquid) {
    player.setDynamicProperty(DP.kyokaBlock, undefined);
    player.sendMessage("§5O bloco marcado não existe mais.");
    return false;
  }
  const dest = { x: mark.x + 0.5, y: mark.y + 1, z: mark.z + 0.5 };
  if (!aizenStandable(dim, dest)) {
    player.sendMessage("§5O bloco marcado está coberto: não há espaço em cima dele.");
    return false;
  }
  const from = player.location;
  const fromDim = player.dimension;
  player.teleport(dest, { dimension: dim, keepVelocity: false });
  aizenPuff(fromDim, from, 10, 0.5);
  aizenPuff(dim, dest, 10, 0.5);
  fromDim.playSound("mob.endermen.portal", from, { volume: 0.8, pitch: 1.3 });
  dim.playSound("mob.endermen.portal", dest, { volume: 0.8, pitch: 1.3 });
  return true;
}

/* ---------- Illusion's Mastery ---------- */

function aizenCloneSpot(target, index, angle) {
  const a = ((angle + index * 120) * Math.PI) / 180;
  const t = target.location;
  return {
    x: t.x + Math.cos(a) * AIZEN.mastery.radius,
    y: t.y,
    z: t.z + Math.sin(a) * AIZEN.mastery.radius,
  };
}

function aizenHide(player, state, ticks) {
  try {
    player.addEffect("invisibility", ticks + 20, { amplifier: 0, showParticles: false });
  } catch (e) {}
  try {
    state.nameTag = player.nameTag;
    player.nameTag = ""; // o nome em cima da cabeca entregaria a posicao
  } catch (e) {}
  try {
    forceGiveLockedItem(getInv(player), 0, AIZEN.kyokaHidden);
  } catch (e) {}
}

function aizenReveal(player, state) {
  try {
    player.removeEffect("invisibility");
  } catch (e) {}
  try {
    player.nameTag = state.nameTag || player.name;
  } catch (e) {}
  try {
    if (isAnyAizen(player)) forceGiveLockedItem(getInv(player), 0, AIZEN.kyoka);
  } catch (e) {}
}

function castIllusionsMastery(player) {
  if (aizenIllusions.has(player.id)) {
    player.sendMessage("§5A ilusão já está de pé.");
    return;
  }
  const target = aizenTargetInView(player);
  if (!target) {
    player.sendMessage("§5Mire em alguém pra prender na ilusão.");
    return;
  }
  if (!hasKyokaMark(target)) {
    player.sendMessage(
      `§5${nameOf(target)} nunca viu a Kyōka Suigetsu: acerte com a m1 primeiro pra ele cair nas ilusões.`
    );
    return;
  }
  if (!tryUseSkill(player, "aizen:illusions_mastery")) return;

  const cfg = AIZEN.mastery;
  const dim = target.dimension;
  const state = {
    aizen: player,
    aizenId: player.id,
    target,
    dim,
    clones: [],
    angle: 0,
    until: system.currentTick + cfg.durationTicks,
  };
  for (let i = 0; i < cfg.clones; i++) {
    try {
      const spot = aizenCloneSpot(target, i, 0);
      const clone = dim.spawnEntity(AIZEN.cloneType, spot);
      clone.nameTag = player.name;
      state.clones.push({ entity: clone, id: clone.id, popped: false });
      aizenCloneOwner.set(clone.id, player.id);
      aizenCloneKind.set(clone.id, "mastery");
      aizenPuff(dim, spot, 8, 0.4);
    } catch (e) {}
  }
  aizenIllusions.set(player.id, state);
  aizenHide(player, state, cfg.durationTicks);

  world.sendMessage(`§5${player.name} usou §lIllusion's Mastery§r§5 em ${nameOf(target)}.`);
  dim.playSound("mob.evocation_illager.prepare_summon", target.location, { volume: 1.2, pitch: 1.3 });
}

function endIllusion(state, reason) {
  if (state.ended) return;
  state.ended = true;
  aizenIllusions.delete(state.aizenId);
  for (const clone of state.clones) {
    aizenCloneOwner.delete(clone.id);
    aizenCloneKind.delete(clone.id);
    if (clone.popped) continue;
    try {
      aizenPuff(state.dim, clone.entity.location, 6, 0.3);
      clone.entity.remove();
    } catch (e) {}
  }
  aizenReveal(state.aizen, state);
  let center;
  try {
    center = state.target.location;
  } catch (e) {
    try {
      center = state.aizen.location;
    } catch (e2) {}
  }
  kyokaShatter(state.dim, center);
}

function stepIllusion(state, now) {
  const { aizen, target } = state;
  if (isDownOrGone(aizen) || !isAizen(aizen) || isDownOrGone(target)) {
    endIllusion(state, "gone");
    return;
  }
  try {
    if (target.dimension.id !== state.dim.id) {
      endIllusion(state, "gone");
      return;
    }
  } catch (e) {}
  if (now >= state.until) {
    endIllusion(state, "timeout");
    return;
  }
  state.angle = (state.angle + AIZEN.mastery.spinPerTick) % 360;
  const t = target.location;
  state.clones.forEach((clone, index) => {
    if (clone.popped) return;
    try {
      const spot = aizenCloneSpot(target, index, state.angle);
      clone.entity.teleport(spot, { keepVelocity: false, rotation: levelRotationToward(spot, t) });
    } catch (e) {
      clone.popped = true; // sumiu por fora (chunk, /kill): conta como desfeito
    }
  });
  if (state.clones.every((clone) => clone.popped)) endIllusion(state, "clones");
}

// alguem acertou um clone (entityHitEntity)
function aizenCloneStruck(entity, attacker) {
  const id = entity.id;
  aizenCloneHitTick.set(id, system.currentTick);
  const kind = aizenCloneKind.get(id);
  if (kind === "switch" || kind === "kanzen") {
    hogyokuCloneStruck(entity, attacker, kind);
    return;
  }
  const state = aizenIllusions.get(aizenCloneOwner.get(id));
  const clone = state?.clones.find((c) => c.id === id);
  if (!state || !clone) {
    try {
      entity.remove(); // clone orfao (ilusao ja acabou)
    } catch (e) {}
    return;
  }
  if (attacker.id === state.aizenId) return; // o proprio Aizen nao desfaz o clone
  popClone(state, clone, attacker);
}

function popClone(state, clone, attacker) {
  if (clone.popped) return;
  clone.popped = true;
  aizenCloneOwner.delete(clone.id);
  aizenCloneKind.delete(clone.id);
  let loc;
  try {
    loc = clone.entity.location;
    clone.entity.remove();
  } catch (e) {}
  if (loc) {
    try {
      state.dim.spawnParticle("aizen:estilhaco", { x: loc.x, y: loc.y + 1.1, z: loc.z });
      state.dim.playSound("random.glass", loc, { volume: 0.9, pitch: 1.2 });
    } catch (e) {}
  }
  // quem ataca a ilusao se machuca: 50 por clone
  try {
    dealDamage(attacker, DAMAGE.aizenCloneBacklash, state.aizen);
  } catch (e) {
    try {
      dealDamage(attacker, DAMAGE.aizenCloneBacklash);
    } catch (e2) {}
  }
  if (state.clones.every((c) => c.popped)) endIllusion(state, "clones");
}

// rede de seguranca: o damage_sensor do clone manda "aizen:golpeado". Se o
// entityHitEntity ja tratou esse golpe, nao faz nada; senao desfaz o clone
// cobrando de quem esta preso na ilusao
function aizenCloneSensorHit(entity) {
  let id;
  try {
    id = entity.id;
  } catch (e) {
    return;
  }
  const seenAt = system.currentTick;
  system.runTimeout(() => {
    if ((aizenCloneHitTick.get(id) ?? -1000) >= seenAt - 1) return;
    const kind = aizenCloneKind.get(id);
    if (kind === "switch" || kind === "kanzen") {
      const hogyoku = hogyokuStateOfClone(id);
      if (hogyoku) hogyokuCloneStruck(entity, hogyoku.target, kind);
      return;
    }
    const state = aizenIllusions.get(aizenCloneOwner.get(id));
    const clone = state?.clones.find((c) => c.id === id);
    if (state && clone) popClone(state, clone, state.target);
  }, 2);
}

/* ---------- m1 da Kyōka ---------- */

function aizenKyokaStrike(aizen, target) {
  markWithKyoka(aizen, target);
  if (isHogyoku(aizen)) {
    let damage = isAwakened(aizen) ? DAMAGE.aizenMonsterM1 : DAMAGE.aizenHogyokuM1;
    // Kanzen Saimin: o primeiro m1 dobra e desfaz a ilusao
    const kanzen = hogyokuKanzen.get(aizen.id);
    if (kanzen) damage *= HOGYOKU.kanzen.m1Multiplier;
    return { damage, kanzen };
  }
  let damage = DAMAGE.aizenM1;
  const illusion = aizenIllusions.get(aizen.id);
  const caught = illusion && illusion.target.id === target.id ? illusion : undefined;
  if (caught) damage = DAMAGE.aizenIllusionStrike;
  const betrayal = aizenBetrayals.get(aizen.id);
  if (betrayal && system.currentTick < betrayal.until) damage *= AIZEN.betrayal.m1Multiplier;
  return { damage, illusion: caught };
}

function aizenAfterKyokaStrike(aizen, target, strike) {
  if (strike.kanzen) endKanzen(strike.kanzen);
  if (!strike.illusion) return;
  try {
    target.addEffect("slowness", AIZEN.mastery.strikeSlownessTicks, {
      amplifier: AIZEN.mastery.strikeSlownessAmplifier,
      showParticles: true,
    });
  } catch (e) {}
  endIllusion(strike.illusion, "strike");
}

/* ---------- Betrayal of the Illusioner ---------- */

function castBetrayal(player) {
  const target = aizenTargetInView(player);
  if (!target) {
    player.sendMessage("§5Mire em alguém pra aparecer nas costas dele.");
    return;
  }
  if (!tryUseSkill(player, "aizen:betrayal_of_the_illusioner")) return;

  const cfg = AIZEN.betrayal;
  world.sendMessage(`§5${player.name} usou §lBetrayal of the Illusioner§r§5!`);
  const state = { until: system.currentTick + cfg.windowTicks, jumps: 0 };
  aizenBetrayals.set(player.id, state);

  const jump = () => {
    if (aizenBetrayals.get(player.id) !== state) return; // cancelado
    if (isDownOrGone(player) || !isAizen(player) || isDownOrGone(target) || isFrozen(player)) return;
    state.jumps++;
    try {
      aizenBlinkBehind(player, target, cfg.behind);
    } catch (e) {
      return;
    }
    if (state.jumps < cfg.teleports) state.timer = system.runTimeout(jump, cfg.gapTicks);
  };
  jump();
}

/* ---------- Bakudō #61: Rikujōkōrō ---------- */

function drawRikujokoro(dim, loc, bars, slam) {
  for (const bar of bars) {
    const out = slam * 0.8; // as barras chegam de fora e batem na cintura
    for (let step = 0; step <= 5; step++) {
      const r = 0.45 + out + step * 0.28;
      const lift = (step / 5 - 0.5) * 0.3 * bar.tilt;
      try {
        dim.spawnParticle("aizen:luz", {
          x: loc.x + Math.cos(bar.angle) * r,
          y: loc.y + 1.0 + lift,
          z: loc.z + Math.sin(bar.angle) * r,
        });
      } catch (e) {}
    }
  }
}

function castBakudo61(player) {
  const target = aizenTargetInView(player);
  if (!target) {
    player.sendMessage("§5Mire em alguém pra prender com o Rikujōkōrō.");
    return;
  }
  if (!tryUseSkill(player, "aizen:bakudo_61")) return;

  const cfg = AIZEN.bakudo;
  world.sendMessage(`§5${player.name} usou §lBakudō #61: Rikujōkōrō§r§5!`);
  // kido de longe: a Respira do Barragan e o Intocable do Nnoitra seguram
  if (isRespiring(target)) {
    showRespiraGuard(target);
    return;
  }
  if (isIntocable(target)) {
    showIntocableGuard(target);
    return;
  }

  paralyzeFor(target, cfg.paralysisTicks, "§e✦ Rikujōkōrō: seis barras de luz te prenderam!");
  const base = Math.random() * Math.PI * 2;
  const bars = Array.from({ length: cfg.bars }, (_, k) => ({
    angle: base + (k * Math.PI * 2) / cfg.bars,
    tilt: k % 2 === 0 ? 1 : -1,
  }));
  const dim = target.dimension;
  dim.playSound("beacon.power", target.location, { volume: 1.2, pitch: 1.6 });
  for (let k = 0; k < cfg.bars; k++) {
    system.runTimeout(() => {
      try {
        dim.playSound("item.trident.hit", target.location, { volume: 0.8, pitch: 1.5 + k * 0.08 });
      } catch (e) {}
    }, 1 + Math.floor(k / 2));
  }

  let tick = 0;
  const interval = system.runInterval(() => {
    tick++;
    if (isDownOrGone(target) || tick > cfg.paralysisTicks) {
      system.clearRun(interval);
      return;
    }
    try {
      const loc = target.location;
      if (tick <= cfg.slamTicks) drawRikujokoro(dim, loc, bars, cfg.slamTicks - tick);
      else if (tick % cfg.refreshTicks === 0) drawRikujokoro(dim, loc, bars, 0);
    } catch (e) {
      system.clearRun(interval);
    }
  }, 1);
}

/* ---------- Fool's Trick ---------- */

function castFoolsTrick(player) {
  if (aizenTricks.has(player.id)) return;
  const target = aizenTargetInView(player);
  if (!target) {
    player.sendMessage("§5Mire em alguém pra enganar.");
    return;
  }
  if (!hasKyokaMark(target)) {
    player.sendMessage(
      `§5${nameOf(target)} nunca viu a Kyōka Suigetsu: acerte com a m1 primeiro pra ele cair nas ilusões.`
    );
    return;
  }
  if (!tryUseSkill(player, "aizen:fools_trick")) return;

  const cfg = AIZEN.foolsTrick;
  // o awakening falso: no formato de anuncio de awakening (nao e fala), com
  // barulho alto e a carga de reiatsu - tudo de mentira
  world.sendMessage(`§d§l${player.name} despertou: AWAKENING: Hadō 99: Goryūtenmetsu!`);
  const origin = player.location;
  player.dimension.playSound("mob.wither.spawn", origin, { volume: 4, pitch: 0.6 });
  player.dimension.playSound("ambient.weather.thunder", origin, { volume: 3, pitch: 0.7 });

  const state = { target };
  aizenTricks.set(player.id, state);
  let tick = 0;
  state.run = system.runInterval(() => {
    tick += 2;
    if (aizenTricks.get(player.id) !== state) {
      system.clearRun(state.run);
      return;
    }
    if (isDownOrGone(player) || !isAizen(player)) {
      system.clearRun(state.run);
      aizenTricks.delete(player.id);
      return;
    }
    try {
      const l = player.location;
      for (let i = 0; i < 3; i++) {
        const a = tick * 0.35 + (i * Math.PI * 2) / 3;
        player.dimension.spawnParticle("aizen:reiatsu", {
          x: l.x + Math.cos(a) * 1.3,
          y: l.y + (tick / cfg.revealDelayTicks) * 2.4,
          z: l.z + Math.sin(a) * 1.3,
        });
      }
    } catch (e) {}
    if (tick < cfg.revealDelayTicks) return;
    system.clearRun(state.run);

    // a ilusao cai: ele ja estava atras do alvo
    if (isDownOrGone(target)) {
      aizenTricks.delete(player.id);
      kyokaShatter(player.dimension, player.location);
      return;
    }
    try {
      aizenBlinkBehind(player, target, 1.3);
    } catch (e) {}
    if (!isIntocable(target)) paralyzeFor(target, cfg.paralysisTicks, "§5Você não consegue se mexer...");
    kyokaShatter(target.dimension, target.location);

    state.slash = system.runTimeout(() => {
      aizenTricks.delete(player.id);
      if (isDownOrGone(target) || isDownOrGone(player) || !isAizen(player)) return;
      dealDamage(target, DAMAGE.aizenFoolsTrick * dmgMultiplier(player), player);
      try {
        target.addEffect("nausea", cfg.nauseaTicks, { amplifier: 0, showParticles: false });
      } catch (e) {}
      try {
        const l = target.location;
        const dim = target.dimension;
        for (let i = -4; i <= 4; i++) {
          dim.spawnParticle("minecraft:crit_particle", {
            x: l.x + i * 0.18,
            y: l.y + 1.1 + i * 0.12,
            z: l.z,
          });
        }
        dim.playSound("item.trident.hit", l, { volume: 1.2, pitch: 0.7 });
        dim.playSound("random.glass", l, { volume: 0.6, pitch: 1.8 });
      } catch (e) {}
    }, cfg.slashDelayTicks);
  }, 2);
}

/* ---------- Counter (passiva) ---------- */

// Chamado pelo m1 de qualquer um. So conta golpe em Aizen, e so de quem esta
// sob a Kyōka: a vitoria "sempre foi uma ilusao" pra quem viu a liberacao.
function aizenCountHit(aizen, attacker) {
  if (!isAizen(aizen) || !attacker || attacker.id === aizen.id) return;
  if (!hasKyokaMark(attacker)) return;
  if (isFrozen(aizen) || isDownOrGone(aizen)) return;

  const cfg = AIZEN.counter;
  const now = system.currentTick;
  let perAttacker = aizenCounterHits.get(aizen.id);
  if (!perAttacker) {
    perAttacker = new Map();
    aizenCounterHits.set(aizen.id, perAttacker);
  }
  const hits = (perAttacker.get(attacker.id) ?? []).filter((t) => now - t <= cfg.windowTicks);
  hits.push(now);
  if (hits.length < cfg.hits) {
    perAttacker.set(attacker.id, hits);
    return;
  }
  perAttacker.delete(attacker.id);
  triggerAizenCounter(aizen, attacker, hits[0]);
}

function triggerAizenCounter(aizen, attacker, since) {
  const cfg = AIZEN.counter;
  // toda a vida perdida nesse tempo: a maior vida registrada desde o 1º golpe
  let best = virtualHealth(aizen);
  for (const sample of aizenTrackOf(aizen).hp) {
    if (sample.tick >= since - 2 && sample.hp > best) best = sample.hp;
  }
  try {
    aizenBlinkBehind(aizen, attacker, 1.4);
  } catch (e) {}
  if (!isIntocable(attacker)) paralyzeFor(attacker, cfg.paralysisTicks, "§5A ilusão te prendeu!");
  try {
    setVirtualHealth(aizen, best);
  } catch (e) {}
  kyokaShatter(aizen.dimension, aizen.location);
}

/* ---------- Awakening (super): Hadō #90 Kurohitsugi ---------- */

function tryTriggerKurohitsugi(player) {
  if (getAwakening(player) < 100) return false;
  if (skillBlockingZoneFor(player)) return false;
  if (aizenCoffins.has(player.id)) return false;
  // sem ninguem na mira a tecla cai pra guarda, como nos outros supers
  const target = aizenTargetInView(player, 40);
  if (!target) return false;
  player.setDynamicProperty(DP.awakening, 0);
  world.sendMessage(`§5${player.name} usou §lHadō #90: Kurohitsugi§r§5!`);
  runKurohitsugi(player, target, AIZEN.kurohitsugi);
  return true;
}

function runKurohitsugi(player, target, cfg) {
  const dim = target.dimension;
  const t = target.location;
  const half = Math.floor(cfg.size / 2);
  const min = { x: Math.floor(t.x) - half, y: Math.floor(t.y) - 1, z: Math.floor(t.z) - half };
  const max = { x: min.x + cfg.size - 1, y: min.y + cfg.size - 1, z: min.z + cfg.size - 1 };
  const inside = (l) =>
    l.x >= min.x + 1 && l.x < max.x && l.z >= min.z + 1 && l.z < max.z && l.y >= min.y + 0.99 && l.y < max.y;

  // a casca da caixa, de baixo pra cima; so troca celula livre (ar/liquido)
  const cells = [];
  for (let x = min.x; x <= max.x; x++) {
    for (let y = min.y; y <= max.y; y++) {
      for (let z = min.z; z <= max.z; z++) {
        if (x === min.x || x === max.x || y === min.y || y === max.y || z === min.z || z === max.z) {
          cells.push([x, y, z]);
        }
      }
    }
  }
  cells.sort((a, b) => a[1] - b[1]);
  const perTick = Math.ceil(cells.length / cfg.buildTicks);
  const auraPerTick = Math.round(18 * (cfg.size / 10) ** 2);
  const ledger = iceTrack([]);
  const cache = new Map();
  const state = { ledger, dim, min, max };
  aizenCoffins.set(player.id, state);

  dim.playSound("block.end_portal.spawn", t, { volume: 2, pitch: 0.5 });
  dim.playSound("beacon.activate", t, { volume: 2, pitch: 0.5 });

  const center = { x: (min.x + max.x + 1) / 2, y: (min.y + max.y + 1) / 2, z: (min.z + max.z + 1) / 2 };
  const pending = new Map(); // id -> { entity, amount }
  let idx = 0;
  let tick = 0;
  let strikes = 0;

  const flush = () => {
    for (const { entity, amount } of pending.values()) {
      if (isDownOrGone(entity)) continue;
      try {
        dealDamage(entity, amount * dmgMultiplier(player), player);
      } catch (e) {}
    }
    pending.clear();
  };

  const finish = () => {
    system.clearRun(state.run);
    flush();
    iceRestore(ledger); // a caixa some e devolve o que estava ali
    aizenCoffins.delete(player.id);
    try {
      dim.playSound("random.explode", center, { volume: 1.5, pitch: 0.5 });
      dim.playSound("beacon.deactivate", center, { volume: 1.5, pitch: 0.6 });
      for (let i = 0; i < 16; i++) {
        dim.spawnParticle("aizen:reiatsu", {
          x: center.x + (Math.random() - 0.5) * cfg.size,
          y: min.y + 1 + Math.random() * (cfg.size - 2),
          z: center.z + (Math.random() - 0.5) * cfg.size,
        });
      }
    } catch (e) {}
  };
  state.finish = finish;

  state.run = system.runInterval(() => {
    tick++;
    try {
      if (isDownOrGone(player) || !isAnyAizen(player)) {
        finish();
        return;
      }
      // sobe a caixa
      for (let n = 0; n < perTick && idx < cells.length; n++, idx++) {
        const [x, y, z] = cells[idx];
        if (ginBlockInfo(dim, cache, x, y, z).passable) iceSet(ledger, dim, x, y, z, "minecraft:black_concrete");
      }
      // aura roxa colada por fora das paredes
      for (let i = 0; i < auraPerTick; i++) {
        const face = Math.floor(Math.random() * 5); // 4 paredes + teto
        const u = min.x + Math.random() * cfg.size;
        const v = min.y + Math.random() * cfg.size;
        const w = min.z + Math.random() * cfg.size;
        const p =
          face === 0 ? { x: min.x - 0.4, y: v, z: w }
          : face === 1 ? { x: max.x + 1.4, y: v, z: w }
          : face === 2 ? { x: u, y: v, z: min.z - 0.4 }
          : face === 3 ? { x: u, y: v, z: max.z + 1.4 }
          : { x: u, y: max.y + 1.4, z: w };
        dim.spawnParticle("aizen:reiatsu", p);
      }
      if (tick <= cfg.buildTicks) return;

      // as estocadas: 50, uma a cada 2 ticks, em todo mundo la dentro menos o Aizen
      if ((tick - cfg.buildTicks) % cfg.strikeEveryTicks === 0 && strikes < cfg.hits) {
        strikes++;
        for (const entity of dim.getEntities({ location: center, maxDistance: cfg.size })) {
          if (entity.id === player.id || entity.typeId === AIZEN.cloneType) continue;
          if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
          const l = entity.location;
          if (!inside(l)) continue;
          const entry = pending.get(entity.id) ?? { entity, amount: 0 };
          entry.amount += cfg.hitDamage;
          pending.set(entity.id, entry);
          // lanca negra vindo de um ponto aleatorio na direcao do peito
          const a = Math.random() * Math.PI * 2;
          const from = { x: l.x + Math.cos(a) * 2.6, y: l.y + 0.4 + Math.random() * 2, z: l.z + Math.sin(a) * 2.6 };
          for (let s = 0; s < 6; s++) {
            const k = s / 5;
            dim.spawnParticle("aizen:lanca", {
              x: from.x + (l.x - from.x) * k,
              y: from.y + (l.y + 1.1 - from.y) * k,
              z: from.z + (l.z - from.z) * k,
            });
          }
          dim.playSound("item.trident.hit", l, { volume: 0.6, pitch: 0.6 + Math.random() * 0.5 });
        }
      }
      if ((tick - cfg.buildTicks) % cfg.damageEveryTicks === 0) flush();
      if (strikes >= cfg.hits) finish();
    } catch (e) {
      finish();
    }
  }, 1);
}

/* ---------- loop do Aizen ---------- */

system.runInterval(() => {
  const now = system.currentTick;
  for (const player of world.getPlayers()) {
    if (!isAizen(player)) {
      aizenTrack.delete(player.id);
      continue;
    }
    const track = aizenTrackOf(player);

    // vida dos ultimos 4s pro Counter devolver "toda a vida perdida nesse tempo"
    try {
      track.hp.push({ tick: now, hp: virtualHealth(player) });
      while (track.hp.length && now - track.hp[0].tick > 80) track.hp.shift();
    } catch (e) {}

    // agachar duas vezes em 2s: conta o agachar ao SOLTAR, e so se ele nao foi
    // gasto em outra coisa (guarda, Kurohitsugi, dash)
    const sneaking = player.isSneaking;
    if (sneaking && !track.sneaking) {
      track.sneakStart = now;
      track.sneakSpent = false;
    }
    if (sneaking) {
      try {
        if (player.getVelocity().y > 0.28) track.sneakSpent = true;
      } catch (e) {}
    }
    if (!sneaking && track.sneaking && !track.sneakSpent) {
      if (track.lastTap !== undefined && track.sneakStart - track.lastTap <= AIZEN.doubleSneakTicks) {
        track.lastTap = undefined;
        aizenTeleportToBlock(player);
      } else {
        track.lastTap = track.sneakStart;
      }
    }
    track.sneaking = sneaking;

    // o bloco marcado brilha so pra ele
    if (now % 20 === 0) {
      const mark = aizenMarkedBlock(player);
      try {
        const l = player.location;
        if (
          mark &&
          mark.dim === player.dimension.id &&
          Math.hypot(mark.x - l.x, mark.y - l.y, mark.z - l.z) < 64
        ) {
          for (let h = 0; h < 3; h++) {
            tosenSee(player, "aizen:reiatsu", { x: mark.x + 0.5, y: mark.y + 1.1 + h * 0.5, z: mark.z + 0.5 });
          }
        }
      } catch (e) {}
    }
  }

  for (const state of [...aizenIllusions.values()]) stepIllusion(state, now);
}, 1);

// clone sem dono (mundo recarregado no meio da ilusao) some sozinho
system.runInterval(() => {
  for (const id of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    let dim;
    try {
      dim = world.getDimension(id);
    } catch (e) {
      continue;
    }
    for (const entity of dim.getEntities({ type: AIZEN.cloneType })) {
      try {
        if (!aizenCloneOwner.has(entity.id)) entity.remove();
      } catch (e) {}
    }
  }
}, 40);

world.afterEvents.entityHitBlock.subscribe((ev) => {
  const player = ev.damagingEntity;
  if (!isAizen(player)) return;
  try {
    const held = player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
    if (!held || !isKyoka(held.typeId)) return;
    aizenMarkBlock(player, ev.hitBlock);
  } catch (e) {}
});

world.afterEvents.dataDrivenEntityTrigger.subscribe(
  (ev) => {
    if (ev.eventId !== "aizen:golpeado") return;
    aizenCloneSensorHit(ev.entity);
  },
  { entityTypes: [AIZEN.cloneType], eventTypes: ["aizen:golpeado"] }
);

// desativar, morrer, sair: nada do Aizen pode ficar pendurado no mundo
function aizenCleanup(playerId) {
  const illusion = aizenIllusions.get(playerId);
  if (illusion) endIllusion(illusion, "gone");
  const betrayal = aizenBetrayals.get(playerId);
  if (betrayal?.timer !== undefined) system.clearRun(betrayal.timer);
  aizenBetrayals.delete(playerId);
  const trick = aizenTricks.get(playerId);
  if (trick) {
    if (trick.run !== undefined) system.clearRun(trick.run);
    if (trick.slash !== undefined) system.clearRun(trick.slash);
    aizenTricks.delete(playerId);
  }
  aizenCoffins.get(playerId)?.finish?.();
  aizenCounterHits.delete(playerId);
  for (const perAttacker of aizenCounterHits.values()) perAttacker.delete(playerId);
  aizenTrack.delete(playerId);
  hogyokuCleanup(playerId);
  // morreu, trocou de personagem ou saiu: o enfraquecimento do Mugetsu acaba
  clearMugetsuWeakness(playerId);
}

/* ---------------------------------------------------------
   Sousuke Aizen (Hōgyoku) - Tier 7 (Híbrido)

   7000 de vida, cura 300 a cada 4s. A Kyōka (160) tambem marca o alvo, e as
   tres ilusões do item Illusions (Switch, False Skill, Kanzen Saimin) seguem
   a mesma regra do outro Aizen: exigem a marca e terminam com a Kyōka
   quebrando pra todo mundo.

   Evolution no lugar do Awakening: +10% a cada 30s. Cada 20% da +20 de cura e
   +5% de dano. Em 100% o Hōgyoku fecha um casulo em volta dele por 5s e ele
   sai na Metamorfose (Monster Aizen): 8000 de vida, cura 400, Kyōka em dobro,
   UltraFragor e Fragor Barrage, e a cada 60s 5% a menos de dano recebido (ate
   50%). A Metamorfose usa o awakening do addon, mas nao drena e nao dispara
   por agachar + m1: so pela Evolution.
   --------------------------------------------------------- */

const HOGYOKU = {
  regen: { everyTicks: 80, base: 100, monster: 200 },
  evolution: { stepPercent: 10, stepSeconds: 30, bonusEvery: 20, regenPerBonus: 20, damagePerBonus: 0.05 },
  cocoonTicks: 100,
  monsterResist: { everySeconds: 60, step: 0.05, max: 0.5 },
  illusions: [
    { key: "aizen:illusions.switch", name: "Switch" },
    { key: "aizen:illusions.false_skill", name: "False Skill" },
    { key: "aizen:illusions.kanzen_saimin", name: "Kanzen Saimin" },
  ],
  switch: { durationTicks: 300, behind: 1.6, frontHoldTicks: 30 },
  falseSkill: { hitDelayTicks: 10, paralysisTicks: 20 },
  kanzen: { durationTicks: 300, clones: 8, radius: 3.2, spinPerTick: 2, m1Multiplier: 2 },
  chant:
    "Ó rei das trevas, cubra os céus. Que o silêncio engula a luz e que o abismo aprisione tudo diante de mim... Hadō #90: Kurohitsugi.",
  kurohitsugi: {
    size: 14, // maior que a do outro Aizen (10)
    hits: 40,
    strikeEveryTicks: 2,
    damageEveryTicks: 10,
    buildTicks: 12,
    hitDamage: DAMAGE.hogyokuKurohitsugiHit,
  },
  // Fragor: a maior explosao do addon (a Quebramundos do Yammy tem raio 26)
  fragor: { label: "Fragor", radius: 30, damage: DAMAGE.fragor, fragments: 30, fragmentDamage: DAMAGE.fragorFragment, fragmentRange: 45 },
  ultraFragor: { label: "UltraFragor", radius: 40, damage: DAMAGE.ultraFragor, fragments: 30, fragmentDamage: DAMAGE.ultraFragorFragment, fragmentRange: 60 },
  fragorBarrage: { label: "Fragor Barrage", blasts: 5, gapTicks: 12, radius: 15, damage: DAMAGE.fragorBarrage, fragments: 30, fragmentDamage: DAMAGE.fragorBarrageFragment, fragmentRange: 22 },
};

const hogyokuSwitches = new Map(); // id do Aizen -> Switch ativo
const hogyokuKanzen = new Map(); // id do Aizen -> Kanzen Saimin ativo
const hogyokuCocoons = new Map(); // id do Aizen -> casulo fechado
const hogyokuClock = new Map(); // id do Aizen -> segundos contados (Evolution, cura, resistencia)

function isHogyoku(entity) {
  try {
    return entity?.typeId === "minecraft:player" && getActiveCharacter(entity)?.id === "aizen_hogyoku";
  } catch (e) {
    return false;
  }
}

function isAnyAizen(entity) {
  return isAizen(entity) || isHogyoku(entity);
}

function evolutionOf(player) {
  const value = Number(player.getDynamicProperty(DP.evolution));
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function evolutionBonusSteps(player) {
  return Math.floor(evolutionOf(player) / HOGYOKU.evolution.bonusEvery);
}

// chamada pelo dmgMultiplier: +5% de dano a cada 20% de Evolution
function hogyokuDamageBonus(player) {
  return 1 + evolutionBonusSteps(player) * HOGYOKU.evolution.damagePerBonus;
}

// chamada pelo damageTakenMultiplierOf: a resistencia que o Monster acumula
function hogyokuResistMultiplier(player) {
  if (!isAwakened(player)) return 1;
  const steps = Number(player.getDynamicProperty(DP.monsterResist)) || 0;
  return 1 - Math.min(HOGYOKU.monsterResist.max, steps * HOGYOKU.monsterResist.step);
}

function spawnAizenClone(aizen, dim, spot, kind, facing) {
  const clone = dim.spawnEntity(AIZEN.cloneType, spot);
  clone.nameTag = aizen.name;
  aizenCloneOwner.set(clone.id, aizen.id);
  aizenCloneKind.set(clone.id, kind);
  if (facing) {
    try {
      clone.teleport(spot, { keepVelocity: false, rotation: levelRotationToward(spot, facing) });
    } catch (e) {}
  }
  aizenPuff(dim, spot, 6, 0.4);
  return { entity: clone, id: clone.id, popped: false };
}

function removeAizenClone(dim, clone) {
  aizenCloneOwner.delete(clone.id);
  aizenCloneKind.delete(clone.id);
  if (clone.popped) return;
  clone.popped = true;
  try {
    aizenPuff(dim, clone.entity.location, 5, 0.3);
    clone.entity.remove();
  } catch (e) {}
}

/* ---------- Illusions: agachar abre o menu, usar lanca a escolhida ---------- */

function selectedIllusion(player) {
  const index = Number(player.getDynamicProperty(DP.aizenIllusion));
  return index >= 0 && index < HOGYOKU.illusions.length ? index : 0;
}

function openIllusionsMenu(player) {
  const current = selectedIllusion(player);
  const now = system.currentTick;
  const form = new ActionFormData()
    .title("Illusions")
    .body("§5Escolha a ilusão.§r\n§7Usar o item lança a escolhida; agachar + usar abre este menu.");
  HOGYOKU.illusions.forEach((mode, index) => {
    const key = cdKeyForSkill(mode.key);
    const duration = SKILL_COOLDOWN_TICKS[mode.key];
    const last = tickOf(player, key);
    const waiting = onCooldown(player, key, duration, now)
      ? `§c${Math.ceil((duration - (now - (last ?? now))) / 20)}s`
      : "§apronta";
    form.button(`${index === current ? "§5▶ " : ""}${mode.name}\n§8${duration / 20}s • ${waiting}`);
  });
  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    const mode = HOGYOKU.illusions[res.selection];
    if (!mode) return;
    player.setDynamicProperty(DP.aizenIllusion, res.selection);
    player.sendMessage(`§5Ilusão escolhida: §d${mode.name}`);
  });
}

function castSelectedIllusion(player) {
  if (isFrozen(player) || isMayuriParalyzed(player)) {
    player.sendMessage("§7Você está paralisado e não consegue usar skills.");
    return;
  }
  const blocking = skillBlockingZoneFor(player);
  if (blocking) {
    player.sendMessage(blocking.blockMessage);
    return;
  }
  const mode = HOGYOKU.illusions[selectedIllusion(player)];
  const target = aizenTargetInView(player);
  if (!target) {
    player.sendMessage(`§5Mire em alguém pra usar ${mode.name}.`);
    return;
  }
  if (!hasKyokaMark(target)) {
    player.sendMessage(
      `§5${nameOf(target)} nunca viu a Kyōka Suigetsu: acerte com a m1 primeiro pra ele cair nas ilusões.`
    );
    return;
  }
  if (mode.key === "aizen:illusions.switch") castSwitch(player, target);
  else if (mode.key === "aizen:illusions.false_skill") castFalseSkill(player, target);
  else castKanzenSaimin(player, target);
}

/* ---------- 1 - Switch ---------- */

function castSwitch(player, target) {
  if (hogyokuSwitches.has(player.id)) {
    player.sendMessage("§5O Switch já está de pé.");
    return;
  }
  if (!tryUseSkill(player, "aizen:illusions.switch")) return;
  const cfg = HOGYOKU.switch;
  const dim = target.dimension;
  const spot = aizenSpotBehind(target, cfg.behind);
  const state = {
    aizen: player,
    aizenId: player.id,
    target,
    dim,
    clone: spawnAizenClone(player, dim, spot, "switch", target.location),
    until: system.currentTick + cfg.durationTicks,
    frontUntil: 0,
    frontSpot: undefined,
  };
  hogyokuSwitches.set(player.id, state);
  world.sendMessage(`§5${player.name} usou §lSwitch§r§5 em ${nameOf(target)}.`);
  dim.playSound("mob.evocation_illager.prepare_summon", spot, { volume: 1, pitch: 1.5 });
}

// o alvo tentou bater no Aizen: ele troca de lugar com o clone (e o golpe nao conta)
function aizenSwitchIntercept(aizen, attacker) {
  const state = hogyokuSwitches.get(aizen?.id);
  if (!state || state.ended || state.target.id !== attacker?.id || state.clone.popped) return false;
  let aizenAt;
  let cloneAt;
  try {
    aizenAt = aizen.location;
    cloneAt = state.clone.entity.location;
  } catch (e) {
    return false;
  }
  const t = attacker.location;
  try {
    aizen.teleport(cloneAt, { dimension: state.dim, keepVelocity: false, rotation: levelRotationToward(cloneAt, t) });
    state.clone.entity.teleport(aizenAt, { keepVelocity: false, rotation: levelRotationToward(aizenAt, t) });
  } catch (e) {
    return false;
  }
  state.frontSpot = aizenAt;
  state.frontUntil = system.currentTick + HOGYOKU.switch.frontHoldTicks;
  try {
    state.dim.playSound("random.glass", aizenAt, { volume: 0.5, pitch: 1.7 });
  } catch (e) {}
  return true;
}

function stepSwitch(state, now) {
  const { aizen, target } = state;
  if (isDownOrGone(aizen) || !isHogyoku(aizen) || isDownOrGone(target) || now >= state.until) {
    endSwitch(state);
    return;
  }
  try {
    const t = target.location;
    const spot = now < state.frontUntil ? state.frontSpot : aizenSpotBehind(target, HOGYOKU.switch.behind);
    state.clone.entity.teleport(spot, { keepVelocity: false, rotation: levelRotationToward(spot, t) });
  } catch (e) {
    endSwitch(state);
  }
}

function endSwitch(state) {
  if (state.ended) return;
  state.ended = true;
  hogyokuSwitches.delete(state.aizenId);
  let center;
  try {
    center = state.clone.entity.location;
  } catch (e) {}
  removeAizenClone(state.dim, state.clone);
  kyokaShatter(state.dim, center);
}

/* ---------- 2 - False Skill ---------- */

function drawCoffinOutline(dim, t, size) {
  const half = size / 2;
  for (let i = 0; i <= 12; i++) {
    const k = -half + (size * i) / 12;
    for (const [x, z] of [[k, -half], [k, half], [-half, k], [half, k]]) {
      for (const y of [0, size - 1]) {
        try {
          dim.spawnParticle("aizen:lanca", { x: t.x + x, y: t.y + y, z: t.z + z });
        } catch (e) {}
      }
    }
  }
}

function castFalseSkill(player, target) {
  if (!tryUseSkill(player, "aizen:illusions.false_skill")) return;
  const cfg = HOGYOKU.falseSkill;
  // finge uma das skills que NAO sao ilusao, igualzinha a de verdade
  const options = isAwakened(player) ? ["ultraFragor", "fragorBarrage"] : ["fragor", "kurohitsugi"];
  const fake = options[Math.floor(Math.random() * options.length)];
  const dim = player.dimension;
  const origin = player.location;
  let reach = Infinity;
  if (fake === "kurohitsugi") {
    aizenSay(player, HOGYOKU.chant);
    drawCoffinOutline(target.dimension, target.location, HOGYOKU.kurohitsugi.size);
  } else {
    const blast = HOGYOKU[fake];
    reach = blast.radius;
    world.sendMessage(`§5${player.name} usou §l${blast.label}§r§5!`);
    fragorBlast(player, origin, blast, true);
  }
  system.runTimeout(() => {
    if (isDownOrGone(player) || !isHogyoku(player) || isDownOrGone(target)) return;
    let distance = Infinity;
    try {
      const l = target.location;
      distance = Math.hypot(l.x - origin.x, l.y - origin.y, l.z - origin.z);
    } catch (e) {}
    // "ao ela acertar": sem dano; ele aparece atras e o alvo trava 1s
    if (distance <= reach) {
      try {
        aizenBlinkBehind(player, target, 1.4);
      } catch (e) {}
      if (!isIntocable(target)) paralyzeFor(target, cfg.paralysisTicks, "§5Era uma ilusão: você não consegue se mexer!");
    }
    kyokaShatter(dim, target.location);
  }, cfg.hitDelayTicks);
}

/* ---------- 3 - Kanzen Saimin ---------- */

function castKanzenSaimin(player, target) {
  if (hogyokuKanzen.has(player.id)) {
    player.sendMessage("§5A ilusão já está de pé.");
    return;
  }
  if (!tryUseSkill(player, "aizen:illusions.kanzen_saimin")) return;
  const cfg = HOGYOKU.kanzen;
  const dim = target.dimension;
  const state = {
    aizen: player,
    aizenId: player.id,
    target,
    dim,
    clones: [],
    angle: 0,
    until: system.currentTick + cfg.durationTicks,
  };
  for (let i = 0; i < cfg.clones; i++) {
    try {
      state.clones.push(spawnAizenClone(player, dim, kanzenSpot(target, i, 0), "kanzen", target.location));
    } catch (e) {}
  }
  hogyokuKanzen.set(player.id, state);
  aizenHide(player, state, cfg.durationTicks);
  aizenSay(player, "Encontre-me, se puder...");
  dim.playSound("mob.evocation_illager.prepare_summon", target.location, { volume: 1.3, pitch: 1.1 });
}

function kanzenSpot(target, index, angle) {
  const cfg = HOGYOKU.kanzen;
  const a = ((angle + (index * 360) / cfg.clones) * Math.PI) / 180;
  const t = target.location;
  return { x: t.x + Math.cos(a) * cfg.radius, y: t.y, z: t.z + Math.sin(a) * cfg.radius };
}

function stepKanzen(state, now) {
  const { aizen, target } = state;
  if (isDownOrGone(aizen) || !isHogyoku(aizen) || isDownOrGone(target) || now >= state.until) {
    endKanzen(state);
    return;
  }
  state.angle = (state.angle + HOGYOKU.kanzen.spinPerTick) % 360;
  const t = target.location;
  state.clones.forEach((clone, index) => {
    if (clone.popped) return;
    try {
      const spot = kanzenSpot(target, index, state.angle);
      clone.entity.teleport(spot, { keepVelocity: false, rotation: levelRotationToward(spot, t) });
    } catch (e) {
      clone.popped = true;
    }
  });
}

function endKanzen(state) {
  if (state.ended) return;
  state.ended = true;
  hogyokuKanzen.delete(state.aizenId);
  for (const clone of state.clones) removeAizenClone(state.dim, clone);
  aizenReveal(state.aizen, state);
  let center;
  try {
    center = state.target.location;
  } catch (e) {}
  kyokaShatter(state.dim, center);
}

function hogyokuStateOfClone(id) {
  const ownerId = aizenCloneOwner.get(id);
  return hogyokuSwitches.get(ownerId) ?? hogyokuKanzen.get(ownerId);
}

function hogyokuCloneStruck(entity, attacker, kind) {
  const ownerId = aizenCloneOwner.get(entity.id);
  if (attacker?.id === ownerId) return; // o proprio Aizen nao desfaz
  if (kind === "switch") {
    // acertar o clone desfaz o Switch
    const state = hogyokuSwitches.get(ownerId);
    if (state) endSwitch(state);
    else {
      try {
        entity.remove();
      } catch (e) {}
    }
    return;
  }
  const state = hogyokuKanzen.get(ownerId);
  const clone = state?.clones.find((c) => c.id === entity.id);
  if (!state || !clone) {
    try {
      entity.remove();
    } catch (e) {}
    return;
  }
  if (clone.popped) return;
  let loc;
  try {
    loc = entity.location;
  } catch (e) {}
  removeAizenClone(state.dim, clone);
  if (loc) {
    try {
      state.dim.spawnParticle("aizen:estilhaco", { x: loc.x, y: loc.y + 1.1, z: loc.z });
      state.dim.playSound("random.glass", loc, { volume: 0.7, pitch: 1.4 });
    } catch (e) {}
  }
  if (state.clones.every((c) => c.popped)) endKanzen(state);
}

/* ---------- Hadō #90 Kurohitsugi (Encantado) ---------- */

function castKurohitsugiEncantado(player) {
  const target = aizenTargetInView(player, 40);
  if (!target) {
    player.sendMessage("§5Mire em alguém pra fechar a Kurohitsugi.");
    return;
  }
  if (aizenCoffins.has(player.id)) return;
  if (!tryUseSkill(player, "aizen:kurohitsugi_encantado")) return;
  aizenSay(player, HOGYOKU.chant);
  runKurohitsugi(player, target, HOGYOKU.kurohitsugi);
}

/* ---------- Fragor, UltraFragor, Fragor Barrage ---------- */

// estilhacos roxos pra todo lado: um loop so pra todos, com uma busca de
// entidades por tick (e nao uma por estilhaco)
function launchFragments(player, center, cfg, harmless) {
  const dim = player.dimension;
  const shards = [];
  for (let i = 0; i < cfg.fragments; i++) {
    // espiral de fibonacci: direcoes espalhadas por igual, mais pro alto e pros
    // lados do que pro chao
    const y = 0.85 - ((i + 0.5) / cfg.fragments) * 1.15;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * 2.39996;
    shards.push({
      pos: { x: center.x, y: center.y + 1.2, z: center.z },
      dir: { x: Math.cos(phi) * r, y, z: Math.sin(phi) * r },
      travelled: 0,
      alive: true,
    });
  }
  const cache = new Map();
  const run = system.runInterval(() => {
    let candidates = [];
    if (!harmless) {
      try {
        candidates = dim
          .getEntities({ location: center, maxDistance: cfg.fragmentRange + 3 })
          .filter(
            (e) =>
              e.id !== player.id &&
              e.typeId !== AIZEN.cloneType &&
              e.getComponent("minecraft:health") &&
              !isDownOrGone(e)
          );
      } catch (e) {}
    }
    let alive = 0;
    for (const shard of shards) {
      if (!shard.alive) continue;
      for (let sub = 0; sub < 3 && shard.alive; sub++) {
        shard.pos.x += shard.dir.x * 0.5;
        shard.pos.y += shard.dir.y * 0.5;
        shard.pos.z += shard.dir.z * 0.5;
        shard.travelled += 0.5;
        if (shard.travelled >= cfg.fragmentRange) {
          shard.alive = false;
          break;
        }
        const bx = Math.floor(shard.pos.x);
        const by = Math.floor(shard.pos.y);
        const bz = Math.floor(shard.pos.z);
        if (!ginBlockInfo(dim, cache, bx, by, bz).passable) {
          shard.alive = false; // bateu em bloco
          break;
        }
        const victim = candidates.find((e) => {
          const l = e.location;
          return Math.hypot(l.x - shard.pos.x, l.y + 1 - shard.pos.y, l.z - shard.pos.z) < 1.3;
        });
        if (victim) {
          shard.alive = false;
          if (isRespiring(victim)) showRespiraGuard(victim);
          else dealDamage(victim, cfg.fragmentDamage * dmgMultiplier(player), player);
        }
      }
      if (shard.alive) {
        alive++;
        try {
          dim.spawnParticle("aizen:fragmento", shard.pos);
        } catch (e) {}
      }
    }
    if (!alive) system.clearRun(run);
  }, 1);
}

function fragorBlast(player, center, cfg, harmless = false) {
  const dim = player.dimension;
  try {
    dim.playSound("mob.warden.sonic_boom", center, { volume: 4, pitch: cfg.radius > 30 ? 0.45 : 0.6 });
    dim.playSound("random.explode", center, { volume: 4, pitch: 0.5 });
  } catch (e) {}
  // aneis roxos subindo: explosao de energia, nao de TNT
  for (let ring = 1; ring <= 5; ring++) {
    const radius = (cfg.radius * ring) / 5;
    const points = 12 + ring * 4;
    for (let i = 0; i < points; i++) {
      const angle = (i / points) * Math.PI * 2 + ring * 0.3;
      for (const height of [0.4, 2.2 + ring * 0.5]) {
        try {
          dim.spawnParticle("aizen:explosao", {
            x: center.x + Math.cos(angle) * radius,
            y: center.y + height,
            z: center.z + Math.sin(angle) * radius,
          });
        } catch (e) {}
      }
    }
  }
  try {
    dim.spawnParticle("minecraft:large_explosion", { x: center.x, y: center.y + 1, z: center.z });
  } catch (e) {}
  if (!harmless) damageNearbyEntities(player, center, cfg.radius, cfg.damage);
  launchFragments(player, center, cfg, harmless);
}

function castFragor(player) {
  if (!tryUseSkill(player, "aizen:fragor")) return;
  world.sendMessage(`§5${player.name} usou §lFragor§r§5!`);
  fragorBlast(player, player.location, HOGYOKU.fragor);
}

function castUltraFragor(player) {
  if (!tryUseSkill(player, "aizen:ultra_fragor")) return;
  world.sendMessage(`§5${player.name} usou §lUltraFragor§r§5!`);
  fragorBlast(player, player.location, HOGYOKU.ultraFragor);
}

function castFragorBarrage(player) {
  if (!tryUseSkill(player, "aizen:fragor_barrage")) return;
  const cfg = HOGYOKU.fragorBarrage;
  world.sendMessage(`§5${player.name} usou §lFragor Barrage§r§5!`);
  for (let i = 0; i < cfg.blasts; i++) {
    system.runTimeout(() => {
      if (isDownOrGone(player) || !isHogyoku(player)) return;
      fragorBlast(player, player.location, cfg);
    }, 1 + i * cfg.gapTicks);
  }
}

/* ---------- Evolution, casulo e Metamorfose ---------- */

function startHogyokuCocoon(player) {
  const character = CHARACTERS.aizen_hogyoku;
  const dim = player.dimension;
  const l = player.location;
  const bx = Math.floor(l.x);
  const by = Math.floor(l.y);
  const bz = Math.floor(l.z);
  try {
    player.teleport({ x: bx + 0.5, y: by, z: bz + 0.5 }, { keepVelocity: false });
  } catch (e) {}
  // casca 3x4x3 em volta dele (o espaco de dentro e so o dele)
  const ledger = iceTrack([]);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 2; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (dx === 0 && dz === 0 && (dy === 0 || dy === 1)) continue;
        iceSet(ledger, dim, bx + dx, by + dy, bz + dz, "minecraft:white_concrete");
      }
    }
  }
  paralyzeFor(player, HOGYOKU.cocoonTicks, "§5O Hōgyoku fecha um casulo em volta de você...");
  const center = { x: bx + 0.5, y: by + 1, z: bz + 0.5 };
  let tick = 0;
  const state = { ledger };
  hogyokuCocoons.set(player.id, state);
  const finish = (transform) => {
    system.clearRun(state.run);
    iceRestore(ledger);
    hogyokuCocoons.delete(player.id);
    if (!transform) return;
    try {
      activateAwakening(player, character);
      aizenPuff(dim, center, 20, 1.2);
    } catch (e) {}
  };
  state.finish = finish;
  state.run = system.runInterval(() => {
    tick += 5;
    if (isDownOrGone(player) || !isHogyoku(player)) {
      finish(false);
      return;
    }
    try {
      if (tick % 20 === 0) dim.playSound("mob.warden.heartbeat", center, { volume: 2, pitch: 0.8 });
      aizenPuff(dim, { x: center.x, y: by, z: center.z }, 6, 1.4);
    } catch (e) {}
    if (tick >= HOGYOKU.cocoonTicks) finish(true);
  }, 5);
}

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    if (!isHogyoku(player)) {
      hogyokuClock.delete(player.id);
      continue;
    }
    if (isDownOrGone(player)) continue;
    if (isMugetsuWeakened(player)) continue;
    const clock = hogyokuClock.get(player.id) ?? { evolution: 0, regen: 0, resist: 0 };
    hogyokuClock.set(player.id, clock);
    const monster = isAwakened(player);

    // cura: 100 a cada 4s (+20 por 20% de Evolution); Monster: 200
    clock.regen += 20;
    if (clock.regen >= HOGYOKU.regen.everyTicks) {
      clock.regen = 0;
      const amount = monster
        ? HOGYOKU.regen.monster
        : HOGYOKU.regen.base + evolutionBonusSteps(player) * HOGYOKU.evolution.regenPerBonus;
      try {
        const hp = player.getComponent("minecraft:health");
        const max = hp.effectiveMax * healthScaleOf(player);
        setVirtualHealth(player, Math.min(max, virtualHealth(player) + amount));
      } catch (e) {}
    }

    if (monster) {
      // Monster: 5% a menos de dano recebido a cada 60s, ate 50%
      clock.resist++;
      const steps = Number(player.getDynamicProperty(DP.monsterResist)) || 0;
      const maxSteps = Math.round(HOGYOKU.monsterResist.max / HOGYOKU.monsterResist.step);
      if (clock.resist >= HOGYOKU.monsterResist.everySeconds && steps < maxSteps) {
        clock.resist = 0;
        player.setDynamicProperty(DP.monsterResist, steps + 1);
        world.sendMessage(
          `§5§lAizen evolui: §r§d${Math.round((steps + 1) * HOGYOKU.monsterResist.step * 100)}% §5a menos de dano recebido.`
        );
      }
      continue;
    }
    if (hogyokuCocoons.has(player.id)) continue;

    // Evolution: +10% a cada 30s; em 100% vem o casulo
    if (evolutionOf(player) >= 100) {
      startHogyokuCocoon(player);
      continue;
    }
    clock.evolution++;
    if (clock.evolution >= HOGYOKU.evolution.stepSeconds) {
      clock.evolution = 0;
      player.setDynamicProperty(DP.evolution, Math.min(100, evolutionOf(player) + HOGYOKU.evolution.stepPercent));
    }
  }

}, 20);

// Switch e Kanzen reposicionam os clones todo tick (o de cima so conta tempo)
system.runInterval(() => {
  const now = system.currentTick;
  for (const state of [...hogyokuSwitches.values()]) stepSwitch(state, now);
  for (const state of [...hogyokuKanzen.values()]) stepKanzen(state, now);
}, 1);

// Evolution, resistencia e ilusao escolhida voltam ao zero (ativar, morrer, desativar)
function resetHogyoku(player) {
  try {
    player.setDynamicProperty(DP.evolution, 0);
    player.setDynamicProperty(DP.monsterResist, 0);
  } catch (e) {}
  hogyokuClock.delete(player.id);
}

function hogyokuCleanup(playerId) {
  const sw = hogyokuSwitches.get(playerId);
  if (sw) endSwitch(sw);
  const kanzen = hogyokuKanzen.get(playerId);
  if (kanzen) endKanzen(kanzen);
  hogyokuCocoons.get(playerId)?.finish?.(false);
  hogyokuClock.delete(playerId);
}

/* ---------------------------------------------------------
   Ichigo Kurosaki (Dangai) - Tier 7 (Híbrido)
   Individualidade: imune à Pressão Espiritual e às ilusões do Aizen, speed 5
   correndo e o dash vira o teleporte do Vasto Lorde (flags no registro).
   --------------------------------------------------------- */

const DANGAI = {
  getsuga: {
    radius: 4, // meia altura do corte: 8 blocos de ponta a ponta
    bulge: 1.6, // quanto o meio do arco vai na frente das pontas
    thickness: 1.6,
    lateral: 2.2, // meia largura que ainda conta como acerto
    speed: 4, // blocos por tick (o Getsuga do Shikai anda 2, o da Bankai 3)
    range: 56,
    subSteps: 5,
    startAhead: 1.5,
    cancelsUpToTier: 4,
  },
  omni: { count: 8 },
  counter: {
    stanceTicks: 100, // 5s parado
    behind: 1.6,
    delayTicks: 40, // 2s depois do teleporte vem o primeiro corte
    slashGapTicks: 6,
    paralysisTicks: 70,
  },
  fightElsewhere: {
    searchRange: 12,
    grabRange: 5,
    holdDistance: 2.2,
    speed: 1.5,
    maxTicks: 40, // 60 blocos sem bater em nada: explode no ar
    blastRadius: 3,
  },
  mugetsu: {
    armorPiece: "dangai:mugetsu_chest",
    chargeTicks: 20,
    deactivateTicks: 100, // 5s depois do Mugetsu o Ichigo perde o personagem
    // "3x o tamanho do Super Nuke Tenshou"
    radius: SUPER_NUKE.radius * 3,
    bulge: SUPER_NUKE.radius * 1.2,
    thickness: SUPER_NUKE.thickness * 3,
    lateral: 7,
    speed: 4,
    range: 100,
    subSteps: 6,
    startAhead: 2,
    cancelsUpToTier: 9,
    hogyokuHealthFraction: 0.1,
    weaknessSlowAmplifier: 2, // lentidao 3
  },
};

/* ---------- ataques que viajam (e podem ser desfeitos no caminho) ---------- */

// getsugas, ceros, lancas, estacas e misseis se registram aqui e avisam onde
// estao a cada tick (touchAttack). O Getsuga do Dangai desfaz os de tier <= 4.
const travellingAttacks = new Set();

function trackAttack(owner, radius) {
  const attack = {
    owner,
    ownerId: owner.id,
    dimId: owner.dimension.id,
    radius,
    pos: undefined,
    seen: system.currentTick,
    cancelled: false,
  };
  travellingAttacks.add(attack);
  return attack;
}

function touchAttack(attack, pos, radius) {
  attack.pos = pos;
  attack.seen = system.currentTick;
  if (radius !== undefined) attack.radius = radius;
}

// ataque que parou de avisar onde esta ja acabou (bateu, sumiu ou o loop caiu)
system.runInterval(() => {
  const now = system.currentTick;
  for (const attack of travellingAttacks) {
    if (attack.cancelled || now - attack.seen > 40) travellingAttacks.delete(attack);
  }
}, 20);

function cancelAttacksNear(player, dim, center, reach, maxTier, look = {}) {
  const label = look.label ?? "Getsuga";
  const particles = look.particles ?? ["dangai:borda", "dangai:raio"];
  const now = system.currentTick;
  for (const attack of travellingAttacks) {
    if (attack.cancelled || !attack.pos || now - attack.seen > 2) continue;
    if (attack.ownerId === player.id || attack.dimId !== dim.id) continue;
    let tier = 0;
    try {
      tier = tierOfPlayer(attack.owner);
    } catch (e) {}
    if (tier > maxTier) continue;
    const dx = attack.pos.x - center.x;
    const dy = attack.pos.y - center.y;
    const dz = attack.pos.z - center.z;
    if (Math.sqrt(dx * dx + dy * dy + dz * dz) > reach + attack.radius) continue;
    attack.cancelled = true;
    travellingAttacks.delete(attack);
    try {
      for (let i = 0; i < 8; i++) {
        dim.spawnParticle(particles[i % 2], {
          x: attack.pos.x + (Math.random() - 0.5) * 1.6,
          y: attack.pos.y + (Math.random() - 0.5) * 1.6,
          z: attack.pos.z + (Math.random() - 0.5) * 1.6,
        });
      }
      dim.playSound("random.fizz", attack.pos, { volume: 1.2, pitch: 0.6 });
      dim.playSound("random.glass", attack.pos, { volume: 0.8, pitch: 1.4 });
    } catch (e) {}
    try {
      attack.owner.sendMessage(`§7Seu ataque foi desfeito pelo ${label} de §b${player.name}§7.`);
    } catch (e) {}
  }
}

/* ---------- individualidade ---------- */

function isPressureImmune(entity) {
  try {
    return entity?.typeId === "minecraft:player" && getActiveCharacter(entity)?.pressureImmune === true;
  } catch (e) {
    return false;
  }
}

function isIllusionImmune(entity) {
  try {
    return entity?.typeId === "minecraft:player" && getActiveCharacter(entity)?.illusionImmune === true;
  } catch (e) {
    return false;
  }
}

// speed 5 so enquanto corre: troca o efeito quando o player comeca/para de correr
const dangaiSprinting = new Map();
system.runInterval(() => {
  for (const player of world.getPlayers()) {
    let character;
    try {
      character = getActiveCharacter(player);
    } catch (e) {
      continue;
    }
    const amplifier = character?.sprintSpeedAmplifier;
    if (amplifier === undefined) {
      dangaiSprinting.delete(player.id);
      continue;
    }
    let sprinting = false;
    try {
      sprinting = player.isSprinting === true;
    } catch (e) {}
    const was = dangaiSprinting.get(player.id);
    let current = -1;
    try {
      current = player.getEffect("speed")?.amplifier ?? -1;
    } catch (e) {}
    // correndo: garante o speed 5 mesmo se outra coisa reaplicou o efeito base
    if (sprinting && current < amplifier) {
      setPermanentEffect(player, "speed", amplifier);
    } else if (!sprinting && was === true) {
      setPermanentEffect(player, "speed", activeFormOf(player, character)?.speedAmplifier ?? BASE_SPEED_AMPLIFIER);
    }
    dangaiSprinting.set(player.id, sprinting);
  }
}, 4);

/* ---------- o corte (Getsuga Dangai e Getsuga Tenshou Final) ---------- */

function unitVector(v) {
  const length = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

// referencial do corte: dir (pra onde anda), up (altura do arco), side (largura)
function crescentFrame(direction) {
  const dir = unitVector(direction);
  let side = { x: -dir.z, y: 0, z: dir.x }; // cross(dir, cima) com o sinal do Bedrock
  const sideLength = Math.sqrt(side.x * side.x + side.z * side.z);
  side = sideLength < 1e-3 ? { x: 1, y: 0, z: 0 } : { x: side.x / sideLength, y: 0, z: side.z / sideLength };
  const up = {
    x: side.y * dir.z - side.z * dir.y,
    y: side.z * dir.x - side.x * dir.z,
    z: side.x * dir.y - side.y * dir.x,
  };
  // up tem que apontar pro ceu
  if (up.y < 0) {
    up.x = -up.x;
    up.y = -up.y;
    up.z = -up.z;
  }
  return { dir, up, side };
}

function framePoint(c, frame, along, vert, lat) {
  const { dir, up, side } = frame;
  return {
    x: c.x + dir.x * along + up.x * vert + side.x * lat,
    y: c.y + dir.y * along + up.y * vert + side.y * lat,
    z: c.z + dir.z * along + up.z * vert + side.z * lat,
  };
}

// o arco: o meio vai na frente, as pontas ficam pra tras
function arcAlong(cfg, vert) {
  const t = Math.max(-1, Math.min(1, vert / cfg.radius));
  return cfg.bulge * Math.sqrt(1 - t * t);
}

const CRESCENT_LOOKS = {
  dangai: {
    coreParticle: "dangai:getsuga",
    edgeParticle: "dangai:borda",
    boltParticle: "dangai:raio",
    points: 15,
    litePoints: 7,
    bolts: 3,
    boltSegments: 5,
    boltStep: 0.55,
  },
  mugetsu: {
    coreParticle: "dangai:mugetsu",
    edgeParticle: "dangai:mugetsu_borda",
    boltParticle: "dangai:raio",
    points: 21,
    litePoints: 21,
    bolts: 4,
    boltSegments: 6,
    boltStep: 1.4,
  },
};

function drawCrescent(dim, c, frame, cfg, look, lite, smear) {
  const points = lite ? look.litePoints : look.points;
  for (let i = 0; i < points; i++) {
    const t = -0.92 + (1.84 * i) / Math.max(1, points - 1);
    const vert = t * cfg.radius;
    const front = arcAlong(cfg, vert);
    const thick = cfg.thickness * (1 - t * t * 0.7); // afina nas pontas
    try {
      dim.spawnParticle(look.edgeParticle, framePoint(c, frame, front, vert, 0));
      // corpo: espalhado pelo trecho que o corte andou neste tick, pra nao
      // ficar um "carimbo" a cada 4 blocos
      dim.spawnParticle(
        look.coreParticle,
        framePoint(c, frame, front - thick * 0.5 - Math.random() * smear, vert, (Math.random() - 0.5) * cfg.lateral * 0.5)
      );
      if (!lite) {
        dim.spawnParticle(
          look.coreParticle,
          framePoint(c, frame, front - thick * Math.random() - Math.random() * smear, vert, (Math.random() - 0.5) * cfg.lateral * 0.4)
        );
      }
    } catch (e) {}
  }
  // raios pretos saindo do corte, em zigue-zague
  const bolts = lite ? 1 : look.bolts;
  for (let b = 0; b < bolts; b++) {
    const t = (Math.random() * 2 - 1) * 0.9;
    const vert = t * cfg.radius;
    let along = arcAlong(cfg, vert) - cfg.thickness * 0.5;
    let v = vert;
    let lat = 0;
    const heading = {
      along: -0.2 - Math.random() * 0.6,
      vert: Math.sign(t || 1) * (0.3 + Math.random() * 0.7),
      lat: (Math.random() - 0.5) * 2,
    };
    for (let s = 0; s < look.boltSegments; s++) {
      along += heading.along * look.boltStep + (Math.random() - 0.5) * look.boltStep * 0.7;
      v += heading.vert * look.boltStep + (Math.random() - 0.5) * look.boltStep * 0.7;
      lat += heading.lat * look.boltStep + (Math.random() - 0.5) * look.boltStep * 0.7;
      try {
        dim.spawnParticle(look.boltParticle, framePoint(c, frame, along, v, lat));
      } catch (e) {}
    }
  }
}

// dispara um corte. options: direction, origin, lite, hitSet, startAhead,
// onHit(entity) -> true quando o golpe ja foi tratado (Getsuga Final no Hōgyoku)
function fireCrescent(player, cfg, look, options = {}) {
  const dim = player.dimension;
  const origin = options.origin ?? player.location;
  let frame = crescentFrame(options.direction ?? player.getViewDirection());
  // corte deitado (Susano'o's Cut): o arco abre pros lados e a espessura vira altura
  if (options.horizontal) frame = { dir: frame.dir, up: frame.side, side: frame.up };
  const hit = options.hitSet ?? new Set();
  const lite = options.lite === true;
  const start = { x: origin.x, y: origin.y + (options.startHeight ?? 1.1), z: origin.z };
  const centerAt = (d) => ({
    x: start.x + frame.dir.x * d,
    y: start.y + frame.dir.y * d,
    z: start.z + frame.dir.z * d,
  });
  let travelled = options.startAhead ?? cfg.startAhead;

  const strikeAround = (c) => {
    for (const entity of dim.getEntities({ location: c, maxDistance: cfg.radius + cfg.lateral + 2 })) {
      if (entity.id === player.id || hit.has(entity.id)) continue;
      if (!entity.getComponent("minecraft:health")) continue;
      if (options.ignore?.(entity)) continue;
      const l = entity.location;
      const mid = { x: l.x - c.x, y: l.y + 1 - c.y, z: l.z - c.z };
      const along = mid.x * frame.dir.x + mid.y * frame.dir.y + mid.z * frame.dir.z;
      const vert = mid.x * frame.up.x + mid.y * frame.up.y + mid.z * frame.up.z;
      const lat = mid.x * frame.side.x + mid.y * frame.side.y + mid.z * frame.side.z;
      if (Math.abs(vert) > cfg.radius + 0.9 || Math.abs(lat) > cfg.lateral + 0.3) continue;
      const front = arcAlong(cfg, vert);
      if (along > front + 0.6 || along < front - cfg.thickness - 0.6) continue;
      // so pra frente de quem lancou
      const back = { x: l.x - start.x, y: l.y + 1 - start.y, z: l.z - start.z };
      if (back.x * frame.dir.x + back.y * frame.dir.y + back.z * frame.dir.z < -0.5) continue;
      hit.add(entity.id);
      if (options.onHit?.(entity)) continue;
      // o Getsuga Final atravessa tudo (Respira, Intocable, guarda); o Getsuga
      // do Dangai respeita as defesas como qualquer golpe
      if (!options.pierce && isRespiring(entity)) {
        showRespiraGuard(entity);
        continue;
      }
      try {
        dealDamage(entity, options.damage * dmgMultiplier(player), player, {
          bypassesIntocable: options.pierce === true,
          breaksBlock: options.pierce === true,
        });
      } catch (e) {}
      options.afterHit?.(entity);
    }
  };

  const interval = system.runInterval(() => {
    try {
      if (isDownOrGone(player)) {
        system.clearRun(interval);
        return;
      }
      const from = travelled;
      travelled = Math.min(cfg.range, travelled + cfg.speed);
      drawCrescent(dim, centerAt(travelled), frame, cfg, look, lite, travelled - from);
      for (let k = 1; k <= cfg.subSteps; k++) {
        const c = centerAt(from + ((travelled - from) * k) / cfg.subSteps);
        cancelAttacksNear(player, dim, c, cfg.radius, cfg.cancelsUpToTier);
        strikeAround(c);
        options.onStep?.(c, frame);
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (travelled >= cfg.range) system.clearRun(interval);
  }, 1);
}

function fireDangaiGetsuga(player, options = {}) {
  fireCrescent(player, DANGAI.getsuga, CRESCENT_LOOKS.dangai, { damage: DAMAGE.dangaiGetsuga, ...options });
}

function getsugaSound(player, pitch = 0.6) {
  try {
    const dim = player.dimension;
    const at = player.location;
    dim.playSound("mob.wither.shoot", at, { volume: 1.6, pitch });
    dim.playSound("item.trident.thunder", at, { volume: 0.7, pitch: 1.6 });
  } catch (e) {}
}

/* ---------- Getsuga Tenshou (Dangai) ---------- */

function castDangaiGetsuga(player) {
  if (!tryUseSkill(player, "dangai:getsuga_tenshou")) return;
  world.sendMessage(`§3${player.name}: §b§lGETSUGA TENSHOU!`);
  getsugaSound(player);
  fireDangaiGetsuga(player);
}

/* ---------- Omnidirectional Getsuga ---------- */

function castOmnidirectionalGetsuga(player) {
  if (!tryUseSkill(player, "dangai:omnidirectional_getsuga")) return;
  world.sendMessage(`§3${player.name}: §b§lOMNIDIRECTIONAL GETSUGA!`);
  getsugaSound(player, 0.45);
  // oito cortes em volta, o primeiro pra onde ele olha; quem esta perto de
  // dois cortes toma um so
  const view = player.getViewDirection();
  const base = Math.atan2(view.z, view.x);
  const hit = new Set();
  for (let i = 0; i < DANGAI.omni.count; i++) {
    const a = base + (i / DANGAI.omni.count) * Math.PI * 2;
    fireDangaiGetsuga(player, { direction: { x: Math.cos(a), y: 0, z: Math.sin(a) }, lite: true, hitSet: hit });
  }
}

/* ---------- Arrogant's Counter ---------- */

const dangaiCounters = new Map(); // id do Ichigo -> postura (5s parado)
const dangaiCounterStrikes = new Map(); // id do Ichigo -> contra-ataque em andamento

function castArrogantsCounter(player) {
  if (dangaiCounters.has(player.id) || dangaiCounterStrikes.has(player.id)) {
    player.sendMessage("§7O Arrogant's Counter já está de pé.");
    return;
  }
  if (!tryUseSkill(player, "dangai:arrogants_counter")) return;
  const cfg = DANGAI.counter;
  const stance = { player, until: system.currentTick + cfg.stanceTicks, triggered: false };
  dangaiCounters.set(player.id, stance);
  world.sendMessage(`§3${player.name} §7ficou parado... §b§lArrogant's Counter`);
  try {
    player.dimension.playSound("item.trident.return", player.location, { volume: 1.2, pitch: 0.6 });
  } catch (e) {}
  stance.run = system.runInterval(() => {
    if (
      isDownOrGone(player) ||
      getActiveCharacter(player)?.id !== "ichigo_dangai" ||
      system.currentTick >= stance.until
    ) {
      endCounterStance(stance, "tempo");
      return;
    }
    try {
      player.addEffect("slowness", 6, { amplifier: 255, showParticles: false });
      holdJump(player, 6);
      const l = player.location;
      const a = (system.currentTick % 20) * (Math.PI / 10);
      for (let i = 0; i < 3; i++) {
        const b = a + (i * Math.PI * 2) / 3;
        player.dimension.spawnParticle("dangai:getsuga", { x: l.x + Math.cos(b) * 1.1, y: l.y + 0.2, z: l.z + Math.sin(b) * 1.1 });
      }
    } catch (e) {}
  }, 2);
}

function endCounterStance(stance, reason) {
  if (dangaiCounters.get(stance.player.id) === stance) dangaiCounters.delete(stance.player.id);
  system.clearRun(stance.run);
  try {
    if (!isFrozen(stance.player)) {
      stance.player.removeEffect("slowness");
      releaseJump(stance.player);
    }
    if (reason === "tempo") stance.player.sendMessage("§7Ninguém caiu no Arrogant's Counter.");
  } catch (e) {}
}

// chamada pelo dealDamage: qualquer golpe de alguem durante a postura vira o
// contra-ataque, e o golpe em si nao entra
function dangaiCounterIntercept(target, source) {
  const stance = dangaiCounters.get(target?.id);
  if (!stance || stance.triggered) return false;
  if (!source || source.id === target.id) return false;
  try {
    if (!source.getComponent("minecraft:health") || isDownOrGone(source)) return false;
  } catch (e) {
    return false;
  }
  stance.triggered = true;
  endCounterStance(stance, "golpe");
  runCounterStrike(target, source);
  return true;
}

function dangaiSlashAt(player, target, tilt) {
  try {
    const dim = player.dimension;
    const from = player.location;
    const to = target.location;
    const dir = unitVector({ x: to.x - from.x, y: 0, z: to.z - from.z });
    const side = { x: -dir.z, z: dir.x };
    for (let i = 0; i <= 8; i++) {
      const k = i / 8 - 0.5;
      const p = {
        x: to.x - dir.x * 0.4 + side.x * k * 2.4,
        y: to.y + 1 + k * 2.4 * tilt,
        z: to.z - dir.z * 0.4 + side.z * k * 2.4,
      };
      dim.spawnParticle(i % 2 ? "dangai:borda" : "dangai:getsuga", p);
    }
    dim.playSound("item.trident.riptide_3", to, { volume: 1, pitch: 1.4 });
  } catch (e) {}
}

function runCounterStrike(player, attacker) {
  const cfg = DANGAI.counter;
  world.sendMessage(`§3${player.name}: §b§lArrogant's Counter!`);
  try {
    const spot = aizenSpotBehind(attacker, cfg.behind);
    player.teleport(spot, {
      dimension: attacker.dimension,
      keepVelocity: false,
      rotation: levelRotationToward(spot, attacker.location),
    });
    player.dimension.playSound("mob.endermen.portal", spot, { volume: 1, pitch: 0.7 });
  } catch (e) {}
  if (!isIntocable(attacker)) paralyzeFor(attacker, cfg.paralysisTicks, "§3Você caiu no Arrogant's Counter!");

  const strike = { timers: [] };
  dangaiCounterStrikes.set(player.id, strike);
  const alive = () =>
    dangaiCounterStrikes.get(player.id) === strike &&
    !isDownOrGone(player) &&
    !isDownOrGone(attacker) &&
    getActiveCharacter(player)?.id === "ichigo_dangai";
  const slash = (tilt) => {
    if (!alive()) return;
    dangaiSlashAt(player, attacker, tilt);
    try {
      dealDamage(attacker, DAMAGE.dangaiCounterSlash * dmgMultiplier(player), player, { breaksBlock: true });
    } catch (e) {}
  };
  strike.timers.push(system.runTimeout(() => slash(1), cfg.delayTicks));
  strike.timers.push(system.runTimeout(() => slash(-1), cfg.delayTicks + cfg.slashGapTicks));
  strike.timers.push(
    system.runTimeout(() => {
      if (alive()) {
        try {
          const from = player.location;
          const to = attacker.location;
          getsugaSound(player);
          fireDangaiGetsuga(player, {
            direction: { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z },
            startAhead: 0,
          });
        } catch (e) {}
      }
      if (dangaiCounterStrikes.get(player.id) === strike) dangaiCounterStrikes.delete(player.id);
    }, cfg.delayTicks + 2 * cfg.slashGapTicks)
  );
}

/* ---------- "Let's fight somewhere else." ---------- */

const dangaiCarries = new Map(); // id do Ichigo -> carregando alguem

// grama, flor, tocha e afins nao sao "bater num bloco"
const DANGAI_SOFT_BLOCKS =
  /^minecraft:(short_grass|tallgrass|tall_grass|fern|large_fern|dead_bush|snow_layer|vine|.*flower.*|.*tulip|dandelion|poppy|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|wither_rose|sunflower|lilac|rose_bush|peony|.*sapling|.*torch|.*carpet|.*_button|lever|.*sign|seagrass|kelp|web|.*rail|.*pressure_plate|sweet_berry_bush|wheat|carrots|potatoes|beetroot|.*mushroom)$/;

function dangaiCellSolid(dim, cache, x, y, z) {
  const key = `${x},${y},${z}`;
  if (cache.has(key)) return cache.get(key);
  let solid = false;
  try {
    const block = dim.getBlock({ x, y, z });
    if (!block) solid = true;
    else solid = !(block.isAir || block.isLiquid) && !DANGAI_SOFT_BLOCKS.test(block.typeId);
  } catch (e) {
    solid = true;
  }
  cache.set(key, solid);
  return solid;
}

// corpo de dois blocos de altura a partir dos pes
function dangaiBodyBlocked(dim, cache, feet) {
  const x = Math.floor(feet.x);
  const y = Math.floor(feet.y + 0.1);
  const z = Math.floor(feet.z);
  return dangaiCellSolid(dim, cache, x, y, z) || dangaiCellSolid(dim, cache, x, y + 1, z);
}

function castFightSomewhereElse(player) {
  const cfg = DANGAI.fightElsewhere;
  if (dangaiCarries.has(player.id)) return;
  const victim = targetInView(player, cfg.searchRange) ?? nearestTarget(player, cfg.grabRange);
  if (!victim) {
    player.sendMessage("§7Não tem ninguém na frente pra levar.");
    return;
  }
  if (!tryUseSkill(player, "dangai:lets_fight_somewhere_else")) return;
  world.sendMessage(`§3${player.name}: §b§o"Let's fight somewhere else."`);
  try {
    player.dimension.playSound("mob.enderdragon.flap", player.location, { volume: 1.4, pitch: 0.8 });
  } catch (e) {}
  const state = { player, victim, dim: player.dimension, ticks: 0, cache: new Map() };
  dangaiCarries.set(player.id, state);
  state.run = system.runInterval(() => stepCarry(state), 1);
}

function stepCarry(state) {
  const cfg = DANGAI.fightElsewhere;
  const { player, victim, dim } = state;
  if (isDownOrGone(player) || isDownOrGone(victim) || getActiveCharacter(player)?.id !== "ichigo_dangai") {
    endCarry(state, null);
    return;
  }
  state.ticks++;
  let next;
  let grip;
  try {
    const view = unitVector(player.getViewDirection());
    const at = player.location;
    next = { x: at.x + view.x * cfg.speed, y: at.y + view.y * cfg.speed, z: at.z + view.z * cfg.speed };
    // preso na frente, na altura do rosto (igual ao Face Hold do Yammy)
    grip = {
      x: next.x + view.x * cfg.holdDistance,
      y: next.y + view.y * cfg.holdDistance + 1,
      z: next.z + view.z * cfg.holdDistance,
    };
  } catch (e) {
    endCarry(state, null);
    return;
  }
  // o alvo vai na frente: e ele que bate primeiro
  if (dangaiBodyBlocked(dim, state.cache, grip) || dangaiBodyBlocked(dim, state.cache, next)) {
    endCarry(state, "parede");
    return;
  }
  if (state.ticks > cfg.maxTicks) {
    endCarry(state, "ar");
    return;
  }
  try {
    player.teleport(next, { keepVelocity: false });
    victim.teleport(grip, { keepVelocity: false, rotation: levelRotationToward(grip, next) });
    victim.addEffect("slowness", 10, { amplifier: 255, showParticles: false });
    state.last = grip;
    dim.spawnParticle("dangai:getsuga", { x: next.x, y: next.y + 1, z: next.z });
    if (state.ticks % 2 === 0) dim.spawnParticle("dangai:raio", { x: grip.x, y: grip.y + 0.5, z: grip.z });
  } catch (e) {
    endCarry(state, null);
  }
}

function endCarry(state, reason) {
  system.clearRun(state.run);
  if (dangaiCarries.get(state.player.id) === state) dangaiCarries.delete(state.player.id);
  const { player, victim, dim } = state;
  try {
    if (!isFrozen(victim)) victim.removeEffect("slowness");
  } catch (e) {}
  if (!reason) return;
  const cfg = DANGAI.fightElsewhere;
  let at = state.last;
  try {
    at = victim.location;
  } catch (e) {}
  if (!at) return;
  try {
    dim.playSound("random.explode", at, { volume: 2, pitch: 0.8 });
    dim.playSound("item.trident.thunder", at, { volume: 0.8, pitch: 1.2 });
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const r = cfg.blastRadius * (0.4 + Math.random() * 0.6);
      const p = { x: at.x + Math.cos(a) * r, y: at.y + 0.5 + Math.random() * 1.8, z: at.z + Math.sin(a) * r };
      dim.spawnParticle(i % 3 === 0 ? "minecraft:large_explosion" : i % 3 === 1 ? "dangai:getsuga" : "dangai:raio", p);
    }
  } catch (e) {}
  try {
    dealDamage(victim, DAMAGE.dangaiFightElsewhere * dmgMultiplier(player), player);
  } catch (e) {}
}

/* ---------- Awk-Mugetsu: Getsuga Tenshou Final ---------- */

const dangaiMugetsu = new Map(); // id do Ichigo -> Mugetsu em andamento (5s)
const mugetsuWeakened = new Set(); // ids dos Aizen Hōgyoku que sobreviveram

function isMugetsuWeakened(entity) {
  return !!entity && mugetsuWeakened.has(entity.id);
}

function clearMugetsuWeakness(playerId) {
  mugetsuWeakened.delete(playerId);
}

// a roupa do Mugetsu so vale enquanto ele dura
function mugetsuArmorOf(player) {
  if (!dangaiMugetsu.has(player.id)) return undefined;
  try {
    if (getActiveCharacter(player)?.id !== "ichigo_dangai") return undefined;
  } catch (e) {
    return undefined;
  }
  return DANGAI.mugetsu.armorPiece;
}

function tryTriggerMugetsu(player) {
  if (getAwakening(player) < 100) return false;
  if (skillBlockingZoneFor(player)) return false;
  if (dangaiMugetsu.has(player.id)) return false;
  player.setDynamicProperty(DP.awakening, 0);
  startMugetsu(player);
  return true;
}

function startMugetsu(player) {
  const cfg = DANGAI.mugetsu;
  const state = { timers: [] };
  dangaiMugetsu.set(player.id, state);
  equipArmorPiece(player, cfg.armorPiece);
  world.sendMessage(`§8§l${player.name}: §0§lMUGETSU`);
  const dim = player.dimension;
  const center = player.location;
  try {
    dim.playSound("mob.wither.spawn", center, { volume: 2, pitch: 0.4 });
    dim.playSound("ambient.weather.thunder", center, { volume: 2, pitch: 0.5 });
  } catch (e) {}
  for (const other of world.getPlayers()) {
    try {
      if (other.dimension.id !== dim.id) continue;
      const l = other.location;
      if (Math.hypot(l.x - center.x, l.y - center.y, l.z - center.z) > 120) continue;
      other.onScreenDisplay.setTitle("§0§lMUGETSU", {
        subtitle: "§8Getsuga Tenshou Final",
        fadeInDuration: 5,
        stayDuration: 30,
        fadeOutDuration: 10,
      });
      if (other.id !== player.id) other.addEffect("darkness", 60, { amplifier: 0, showParticles: false });
    } catch (e) {}
  }
  // aura preta subindo enquanto carrega
  state.aura = system.runInterval(() => {
    try {
      const l = player.location;
      for (let i = 0; i < 4; i++) {
        dim.spawnParticle("dangai:mugetsu", {
          x: l.x + (Math.random() - 0.5) * 1.6,
          y: l.y + Math.random() * 2.4,
          z: l.z + (Math.random() - 0.5) * 1.6,
        });
      }
    } catch (e) {}
  }, 2);
  state.timers.push(
    system.runTimeout(() => {
      system.clearRun(state.aura);
      if (dangaiMugetsu.get(player.id) !== state || isDownOrGone(player)) return;
      fireGetsugaFinal(player);
    }, cfg.chargeTicks)
  );
  state.timers.push(system.runTimeout(() => endMugetsu(player, state), cfg.deactivateTicks));
}

function fireGetsugaFinal(player) {
  const cfg = DANGAI.mugetsu;
  world.sendMessage(`§8§l${player.name}: §0§lGETSUGA TENSHOU FINAL!`);
  try {
    const at = player.location;
    player.dimension.playSound("mob.warden.sonic_boom", at, { volume: 2, pitch: 0.5 });
    player.dimension.playSound("mob.wither.death", at, { volume: 2, pitch: 0.3 });
  } catch (e) {}
  fireCrescent(player, cfg, CRESCENT_LOOKS.mugetsu, {
    damage: DAMAGE.getsugaFinal,
    pierce: true,
    onHit: (entity) => {
      // o Aizen Hōgyoku nao morre: fica com 10% e sem forcas
      if (!isHogyoku(entity)) return false;
      weakenHogyoku(entity, player);
      return true;
    },
  });
}

function weakenHogyoku(aizen, ichigo) {
  const cfg = DANGAI.mugetsu;
  try {
    const hp = aizen.getComponent("minecraft:health");
    const max = hp.effectiveMax * healthScaleOf(aizen);
    setVirtualHealth(aizen, Math.min(virtualHealth(aizen), max * cfg.hogyokuHealthFraction));
  } catch (e) {}
  // desfaz Switch, Kanzen e casulo; a Evolution para onde estava
  hogyokuCleanup(aizen.id);
  mugetsuWeakened.add(aizen.id);
  applyMugetsuWeakness(aizen);
  world.sendMessage(`§8§l${aizen.name} sobreviveu ao Getsuga Tenshou Final... §r§7mas ficou sem forças.`);
  try {
    aizen.sendMessage("§8Você não regenera, está lento e não consegue usar skills nem causar dano.");
    ichigo.sendMessage("§8O Hōgyoku não deixou o Aizen morrer.");
  } catch (e) {}
}

function applyMugetsuWeakness(aizen) {
  try {
    aizen.removeEffect("regeneration");
    aizen.addEffect("slowness", 40, {
      amplifier: DANGAI.mugetsu.weaknessSlowAmplifier,
      showParticles: false,
    });
  } catch (e) {}
}

system.runInterval(() => {
  for (const id of [...mugetsuWeakened]) {
    const aizen = world.getPlayers().find((p) => p.id === id);
    if (!aizen || !isHogyoku(aizen)) {
      mugetsuWeakened.delete(id);
      continue;
    }
    applyMugetsuWeakness(aizen);
  }
}, 20);

function endMugetsu(player, state) {
  if (dangaiMugetsu.get(player.id) !== state) return;
  dangaiMugetsu.delete(player.id);
  system.clearRun(state.aura);
  try {
    clearArmorPiece(player, DANGAI.mugetsu.armorPiece);
    if (getActiveCharacter(player)?.id !== "ichigo_dangai") return;
    world.sendMessage(`§8${player.name} usou tudo no Getsuga Tenshou Final e perdeu os poderes de Shinigami.`);
    deactivateCharacter(player);
  } catch (e) {}
}

/* ---------- limpeza ---------- */

// full = trocou de personagem ou saiu. Morrer (full = false) solta a postura e
// o arrasto, mas o Mugetsu continua contando: ele tira o Ichigo mesmo assim.
function dangaiCleanup(player, full) {
  const id = player.id;
  const stance = dangaiCounters.get(id);
  if (stance) endCounterStance(stance, "limpeza");
  const strike = dangaiCounterStrikes.get(id);
  if (strike) {
    for (const timer of strike.timers) system.clearRun(timer);
    dangaiCounterStrikes.delete(id);
  }
  const carry = dangaiCarries.get(id);
  if (carry) endCarry(carry, null);
  if (!full) return;
  const mugetsu = dangaiMugetsu.get(id);
  if (mugetsu) {
    dangaiMugetsu.delete(id);
    for (const timer of mugetsu.timers) system.clearRun(timer);
    system.clearRun(mugetsu.aura);
  }
  try {
    clearArmorPiece(player, DANGAI.mugetsu.armorPiece);
  } catch (e) {}
  dangaiSprinting.delete(id);
}

function dangaiCleanupId(playerId) {
  const stance = dangaiCounters.get(playerId);
  if (stance) {
    dangaiCounters.delete(playerId);
    system.clearRun(stance.run);
  }
  const strike = dangaiCounterStrikes.get(playerId);
  if (strike) for (const timer of strike.timers) system.clearRun(timer);
  dangaiCounterStrikes.delete(playerId);
  const carry = dangaiCarries.get(playerId);
  if (carry) endCarry(carry, null);
  const mugetsu = dangaiMugetsu.get(playerId);
  if (mugetsu) {
    for (const timer of mugetsu.timers) system.clearRun(timer);
    system.clearRun(mugetsu.aura);
  }
  dangaiMugetsu.delete(playerId);
  dangaiSprinting.delete(playerId);
}

/* ---------------------------------------------------------
   Yamamoto Genryūsai - Tier 7 (Shinigami)
   Ryūjin Jakka e o Bankai Zanka no Tachi. Quase tudo queima: Queimadura
   (70/s) e Queimadura Infernal (100/s, ignora redução de dano).
   --------------------------------------------------------- */

const YAMAMOTO = {
  tag: "mv_yamamoto", // os mortos do Minami nao atacam quem tem essa tag
  infernalParticle: "yamamoto:infernal", // fogo vermelho-escuro da Queimadura Infernal
  burn: { perSecond: 70 },
  infernal: { perSecond: 100 },
  ennetsu: {
    volleys: 3,
    volleyGapTicks: 5,
    angles: [-0.35, 0, 0.35], // leque do Tripleshot, em radianos
    speed: 2,
    range: 16,
    height: 4.5,
    hitRadius: 1.3,
    burnSeconds: 3,
  },
  ittoKaso: { range: 40, markTicks: 60, radius: 9, height: 22, baseHalfWidth: 4, riseTicks: 8, burnSeconds: 6 },
  shunshin: { distance: 20, ticks: 4, hitRadius: 1.8, burnSeconds: 3 },
  hellsPierce: { reach: 5, blastDelayTicks: 8, blastRadius: 4.5, burnSeconds: 7 },
  // passiva do Bankai: m1 num bloco explode um triangulo na frente
  passive: { length: 9, halfWidth: 4, cooldownTicks: 20, growTicks: 4 },
  bankaiInfernalSeconds: 2,
  minami: {
    entity: "yamamoto:morto",
    count: 10,
    ringRadius: 3,
    lifetimeTicks: 600, // 30s, o mesmo do cooldown
    hitCooldownTicks: 20,
    reach: 1.9,
  },
  nishi: { durationTicks: 200, radius: 10, eraseRadius: 5 },
  higashi: {
    radius: 3,
    bulge: 1.2,
    thickness: 1.4,
    lateral: 2.2,
    speed: 5,
    range: 35,
    subSteps: 5,
    startAhead: 1.5,
    cancelsUpToTier: -1, // corte de fogo nao desfaz ataque (quem faz isso e o Nishi)
    infernalSeconds: 8,
  },
  // Kita: parado, do tamanho do Mugetsu do Ichigo
  kita: { radius: DANGAI.mugetsu.radius, height: 8, sweepTicks: 6, infernalSeconds: 20 },
};

function isYamamoto(entity) {
  try {
    return entity?.typeId === "minecraft:player" && getActiveCharacter(entity)?.id === "yamamoto";
  } catch (e) {
    return false;
  }
}

/* ---------- Queimadura e Queimadura Infernal ---------- */

// id -> { entity, normal: { hits, source }, infernal: { hits, source } }
// Conta golpes (um por segundo) em vez de prazo: "5 segundos de queimadura" da
// exatamente 5 golpes, nao importa em que tick do loop ela comecou.
const burns = new Map();

function applyBurn(entity, source, seconds, infernal = false) {
  if (!entity || seconds <= 0 || entity.typeId === AIZEN.cloneType) return;
  if (isDownOrGone(entity)) return;
  let state = burns.get(entity.id);
  if (!state) {
    state = { entity };
    burns.set(entity.id, state);
  }
  const key = infernal ? "infernal" : "normal";
  const current = state[key];
  if (!current || current.hits < seconds) state[key] = { hits: seconds, source };
}

function isBurning(entity, infernal) {
  const state = burns.get(entity?.id);
  if (!state) return false;
  return infernal === undefined ? !!(state.normal || state.infernal) : !!state[infernal ? "infernal" : "normal"];
}

system.runInterval(() => {
  for (const [id, state] of burns) {
    const entity = state.entity;
    if (isDownOrGone(entity)) {
      burns.delete(id);
      continue;
    }
    for (const key of ["normal", "infernal"]) {
      const burn = state[key];
      if (!burn) continue;
      burn.hits--;
      const cfg = key === "infernal" ? YAMAMOTO.infernal : YAMAMOTO.burn;
      let multiplier = 1;
      try {
        multiplier = dmgMultiplier(burn.source);
      } catch (e) {}
      // a Infernal ignora redução de dano (guarda, Hierro, resistências)
      const options = { ignoresReduction: key === "infernal" };
      try {
        dealDamage(entity, cfg.perSecond * multiplier, burn.source, options);
      } catch (e) {
        // quem pos fogo saiu do mundo: o fogo continua queimando sem dono
        try {
          dealDamage(entity, cfg.perSecond, undefined, options);
        } catch (e2) {}
      }
      if (burn.hits <= 0) delete state[key];
    }
    if (!state.normal && !state.infernal) burns.delete(id);
  }
}, 20);

// fogo em quem esta queimando (vermelho escuro na Infernal)
system.runInterval(() => {
  for (const state of burns.values()) {
    try {
      const l = state.entity.location;
      const particle = state.infernal ? YAMAMOTO.infernalParticle : "yamamoto:chama";
      for (let i = 0; i < 2; i++) {
        state.entity.dimension.spawnParticle(particle, {
          x: l.x + (Math.random() - 0.5) * 0.8,
          y: l.y + 0.2 + Math.random() * 1.6,
          z: l.z + (Math.random() - 0.5) * 0.8,
        });
      }
    } catch (e) {}
  }
}, 4);

/* ---------- a tag que os mortos respeitam ---------- */

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    try {
      const should = isYamamoto(player);
      const has = player.hasTag(YAMAMOTO.tag);
      if (should && !has) player.addTag(YAMAMOTO.tag);
      else if (!should && has) player.removeTag(YAMAMOTO.tag);
    } catch (e) {}
  }
}, 20);

/* ---------- mortos do Minami ---------- */

const yamamotoSummons = new Map(); // id do morto -> { entity, ownerId, until, lastHit }

// os proprios mortos nao levam dano das skills de quem os invocou
function isOwnSummon(player, entity) {
  return yamamotoSummons.get(entity?.id)?.ownerId === player?.id;
}

// dano de fogo em area, pulando o dono e os mortos dele
function yamamotoStrike(player, entity, damage, burnSeconds, infernal = false, options) {
  if (!entity || entity.id === player.id || isOwnSummon(player, entity)) return false;
  try {
    if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) return false;
  } catch (e) {
    return false;
  }
  try {
    dealDamage(entity, damage * dmgMultiplier(player), player, options);
  } catch (e) {}
  applyBurn(entity, player, burnSeconds, infernal);
  return true;
}

function flameBurst(dim, at, count, spread, particle = "yamamoto:chama") {
  try {
    for (let i = 0; i < count; i++) {
      dim.spawnParticle(particle, {
        x: at.x + (Math.random() - 0.5) * spread,
        y: at.y + Math.random() * spread * 0.8,
        z: at.z + (Math.random() - 0.5) * spread,
      });
    }
  } catch (e) {}
}

/* ---------- Ennetsu Jigoku ---------- */

function castEnnetsuJigoku(player) {
  if (!tryUseSkill(player, "yamamoto:ennetsu_jigoku")) return;
  const cfg = YAMAMOTO.ennetsu;
  world.sendMessage(`§6${player.name}: §c§lEnnetsu Jigoku`);
  for (let v = 0; v < cfg.volleys; v++) {
    system.runTimeout(() => {
      if (isDownOrGone(player)) return;
      try {
        player.dimension.playSound("mob.blaze.shoot", player.location, { volume: 1.4, pitch: 0.7 + v * 0.1 });
      } catch (e) {}
      const f = forwardDirection(player);
      const base = Math.atan2(f.z, f.x);
      const origin = player.location;
      for (const offset of cfg.angles) {
        const a = base + offset;
        launchFireColumn(player, origin, { x: Math.cos(a), z: Math.sin(a) }, cfg);
      }
    }, v * cfg.volleyGapTicks);
  }
}

// uma coluna de fogo andando no chao (como uma linha do Tripleshot)
function launchFireColumn(player, origin, dir, cfg) {
  const dim = player.dimension;
  const hit = new Set();
  let travelled = 1.5;
  const interval = system.runInterval(() => {
    try {
      const at = { x: origin.x + dir.x * travelled, y: origin.y, z: origin.z + dir.z * travelled };
      for (let h = 0; h < cfg.height; h += 1) {
        dim.spawnParticle(h % 2 ? "yamamoto:brasa" : "yamamoto:chama", {
          x: at.x + (Math.random() - 0.5) * 0.6,
          y: at.y + h,
          z: at.z + (Math.random() - 0.5) * 0.6,
        });
      }
      for (const entity of dim.getEntities({ location: at, maxDistance: cfg.hitRadius + cfg.height })) {
        if (hit.has(entity.id)) continue;
        const l = entity.location;
        if (Math.hypot(l.x - at.x, l.z - at.z) > cfg.hitRadius) continue;
        if (l.y < at.y - 1.5 || l.y > at.y + cfg.height) continue;
        if (yamamotoStrike(player, entity, DAMAGE.ennetsuColumn, cfg.burnSeconds)) hit.add(entity.id);
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    travelled += cfg.speed;
    if (travelled > cfg.range) system.clearRun(interval);
  }, 1);
}

/* ---------- Hadō #96: Ittō Kasō ---------- */

function ittoKasoPoint(player, range) {
  const target = targetInView(player, range);
  if (target) return { ...target.location };
  try {
    const hit = player.getBlockFromViewDirection({ maxDistance: range });
    if (hit?.block) {
      const b = hit.block.location;
      return { x: b.x + 0.5, y: b.y + 1, z: b.z + 0.5 };
    }
  } catch (e) {}
  const l = player.location;
  const f = forwardDirection(player);
  return { x: l.x + f.x * 20, y: l.y, z: l.z + f.z * 20 };
}

function castIttoKaso(player) {
  if (!tryUseSkill(player, "yamamoto:itto_kaso")) return;
  const cfg = YAMAMOTO.ittoKaso;
  const dim = player.dimension;
  const center = ittoKasoPoint(player, cfg.range);
  const f = forwardDirection(player);
  const side = { x: -f.z, z: f.x }; // a lamina fica de frente pra quem lancou
  world.sendMessage(`§6${player.name} usou §c§lHadō #96: Ittō Kasō§r§6!`);
  try {
    dim.playSound("fire.ignite", center, { volume: 2, pitch: 0.5 });
  } catch (e) {}

  // 3s marcando a area
  let tick = 0;
  const mark = system.runInterval(() => {
    tick += 5;
    try {
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + tick * 0.05;
        dim.spawnParticle("yamamoto:lamina", {
          x: center.x + Math.cos(a) * cfg.radius * 0.6,
          y: center.y + 0.15,
          z: center.z + Math.sin(a) * cfg.radius * 0.6,
        });
      }
      if (tick % 20 === 0) dim.playSound("fire.fire", center, { volume: 2, pitch: 0.6 });
    } catch (e) {}
    if (tick >= cfg.markTicks) {
      system.clearRun(mark);
      eruptIttoKaso(player, dim, center, side, cfg);
    }
  }, 5);
}

// a ponta de uma katana gigante subindo do chao, feita de fogo vermelho
function eruptIttoKaso(player, dim, center, side, cfg) {
  try {
    dim.playSound("random.explode", center, { volume: 3, pitch: 0.5 });
    dim.playSound("mob.ghast.fireball", center, { volume: 2, pitch: 0.5 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      dim.spawnParticle(i % 3 === 0 ? "minecraft:large_explosion" : "yamamoto:chama", {
        x: center.x + Math.cos(a) * cfg.radius * 0.5,
        y: center.y + 0.5,
        z: center.z + Math.sin(a) * cfg.radius * 0.5,
      });
    }
  } catch (e) {}
  for (const entity of dim.getEntities({ location: center, maxDistance: cfg.radius + cfg.height })) {
    const l = entity.location;
    if (Math.hypot(l.x - center.x, l.z - center.z) > cfg.radius) continue;
    if (l.y < center.y - 2 || l.y > center.y + cfg.height) continue;
    yamamotoStrike(player, entity, DAMAGE.ittoKaso, cfg.burnSeconds);
  }
  let k = 0;
  const rise = system.runInterval(() => {
    k++;
    try {
      const top = (cfg.height * k) / cfg.riseTicks;
      const from = (cfg.height * (k - 1)) / cfg.riseTicks;
      for (let y = from; y < top; y += 0.9) {
        const t = y / cfg.height;
        // o fio curva de leve pro lado, como o kissaki de uma katana
        const half = cfg.baseHalfWidth * Math.pow(1 - t, 1.4);
        const lean = cfg.baseHalfWidth * 0.5 * t * t;
        for (const u of [-half, -half * 0.3, half * 0.3, half]) {
          dim.spawnParticle(Math.abs(u) === half ? "yamamoto:lamina" : "yamamoto:chama", {
            x: center.x + side.x * (u + lean),
            y: center.y + y,
            z: center.z + side.z * (u + lean),
          });
        }
      }
    } catch (e) {}
    if (k >= cfg.riseTicks) system.clearRun(rise);
  }, 1);
}

/* ---------- Shunshin ---------- */

function castShunshin(player) {
  if (!tryUseSkill(player, "yamamoto:shunshin")) return;
  const cfg = YAMAMOTO.shunshin;
  const dim = player.dimension;
  const f = forwardDirection(player);
  const perTick = cfg.distance / cfg.ticks;
  const hit = new Set();
  const cache = new Map();
  let done = 0;
  world.sendMessage(`§6${player.name}: §c§lShunshin`);
  try {
    dim.playSound("item.trident.riptide_1", player.location, { volume: 1.5, pitch: 1.4 });
  } catch (e) {}
  const interval = system.runInterval(() => {
    try {
      if (isDownOrGone(player)) {
        system.clearRun(interval);
        return;
      }
      const start = player.location;
      let reached = start;
      // anda em passos de 1 bloco: para no primeiro bloco solido
      for (let s = 1; s <= Math.ceil(perTick); s++) {
        const step = Math.min(s, perTick);
        const next = { x: start.x + f.x * step, y: start.y, z: start.z + f.z * step };
        if (dangaiBodyBlocked(dim, cache, next)) {
          done = cfg.distance;
          break;
        }
        reached = next;
        dim.spawnParticle(s % 2 ? "yamamoto:chama" : "yamamoto:brasa", { x: next.x, y: next.y + 1, z: next.z });
        for (const entity of dim.getEntities({ location: { x: next.x, y: next.y + 1, z: next.z }, maxDistance: cfg.hitRadius })) {
          if (hit.has(entity.id)) continue;
          if (yamamotoStrike(player, entity, DAMAGE.shunshin, cfg.burnSeconds)) hit.add(entity.id);
        }
      }
      player.teleport(reached, { keepVelocity: false });
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    done += perTick;
    if (done >= cfg.distance) system.clearRun(interval);
  }, 1);
}

/* ---------- Hell's Pierce ---------- */

function castHellsPierce(player) {
  const cfg = YAMAMOTO.hellsPierce;
  const target =
    targetInView(player, cfg.reach) ??
    (() => {
      const near = nearestTarget(player, cfg.reach - 1);
      if (!near || isOwnSummon(player, near)) return undefined;
      return near;
    })();
  if (!target || isOwnSummon(player, target)) {
    player.sendMessage("§7Não tem ninguém na frente pra empalar.");
    return;
  }
  if (!tryUseSkill(player, "yamamoto:hells_pierce")) return;
  const dim = player.dimension;
  world.sendMessage(`§6${player.name}: §4§lHell's Pierce`);
  try {
    const from = player.location;
    const to = target.location;
    const d = unitVector({ x: to.x - from.x, y: 0, z: to.z - from.z });
    // a lamina atravessa o alvo e sai 2 blocos do outro lado
    const length = Math.hypot(to.x - from.x, to.z - from.z) + 2;
    for (let s = 0.6; s <= length; s += 0.35) {
      dim.spawnParticle(s > length - 2.4 ? "yamamoto:lamina" : "yamamoto:chama", {
        x: from.x + d.x * s,
        y: from.y + 1.2,
        z: from.z + d.z * s,
      });
    }
    dim.playSound("item.trident.throw", to, { volume: 1.4, pitch: 0.6 });
  } catch (e) {}
  yamamotoStrike(player, target, DAMAGE.hellsPierceImpale, cfg.burnSeconds);
  system.runTimeout(() => {
    let at;
    try {
      at = target.location;
    } catch (e) {
      return;
    }
    try {
      dim.playSound("random.explode", at, { volume: 2, pitch: 0.7 });
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const r = cfg.blastRadius * (0.3 + Math.random() * 0.7);
        dim.spawnParticle(i % 3 === 0 ? "minecraft:large_explosion" : "yamamoto:chama", {
          x: at.x + Math.cos(a) * r,
          y: at.y + 0.4 + Math.random() * 1.6,
          z: at.z + Math.sin(a) * r,
        });
      }
    } catch (e) {}
    // quem foi empalado ja levou os 350: a explosao pega os outros
    for (const entity of dim.getEntities({ location: at, maxDistance: cfg.blastRadius })) {
      if (entity.id === target.id) continue;
      yamamotoStrike(player, entity, DAMAGE.hellsPierceBlast, cfg.burnSeconds);
    }
  }, cfg.blastDelayTicks);
}

/* ---------- Bankai: passiva do m1 num bloco ---------- */

const yamamotoPassiveTick = new Map();

function yamamotoBlockBlast(player) {
  const cfg = YAMAMOTO.passive;
  const now = system.currentTick;
  if (now - (yamamotoPassiveTick.get(player.id) ?? -1000) < cfg.cooldownTicks) return;
  yamamotoPassiveTick.set(player.id, now);
  const dim = player.dimension;
  const o = player.location;
  const f = forwardDirection(player);
  const r = { x: -f.z, z: f.x };
  const hit = new Set();
  let k = 0;
  try {
    dim.playSound("random.explode", o, { volume: 1.2, pitch: 1.1 });
  } catch (e) {}
  const interval = system.runInterval(() => {
    k++;
    const front = (cfg.length * k) / cfg.growTicks;
    const back = (cfg.length * (k - 1)) / cfg.growTicks;
    try {
      // explosoes abrindo em triangulo (como o Dragon's Breath do Hitsugaya)
      for (let a = Math.max(1.5, back); a <= front; a += 1.5) {
        const w = (cfg.halfWidth * a) / cfg.length;
        for (const b of [-w, 0, w]) {
          const p = { x: o.x + f.x * a + r.x * b, y: o.y + 0.6, z: o.z + f.z * a + r.z * b };
          dim.spawnParticle(b === 0 ? "minecraft:large_explosion" : "yamamoto:chama", p);
          dim.spawnParticle("yamamoto:brasa", { x: p.x, y: p.y + 0.8, z: p.z });
        }
      }
      for (const entity of dim.getEntities({ location: o, maxDistance: front + 2 })) {
        if (hit.has(entity.id)) continue;
        const l = entity.location;
        const dx = l.x - o.x;
        const dz = l.z - o.z;
        const a = dx * f.x + dz * f.z;
        const b = dx * r.x + dz * r.z;
        if (a < 0 || a > front) continue;
        if (Math.abs(b) > (cfg.halfWidth * Math.max(a, 1)) / cfg.length + 0.8) continue;
        if (Math.abs(l.y - o.y) > 4) continue;
        if (yamamotoStrike(player, entity, DAMAGE.zankaBlockBlast, 0)) hit.add(entity.id);
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (k >= cfg.growTicks) system.clearRun(interval);
  }, 1);
}

world.afterEvents.entityHitBlock.subscribe((ev) => {
  const player = ev.damagingEntity;
  if (!isYamamoto(player) || !isAwakened(player)) return;
  try {
    const held = player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
    if (held?.typeId !== "yamamoto:m1_zanka_no_tachi") return;
  } catch (e) {
    return;
  }
  yamamotoBlockBlast(player);
});

/* ---------- Minami: Kaka Jūmanokushi Daisōjin ---------- */

function castMinami(player) {
  if (!tryUseSkill(player, "yamamoto:minami")) return;
  const cfg = YAMAMOTO.minami;
  const dim = player.dimension;
  const o = player.location;
  world.sendMessage(`§6${player.name}: §c§lMinami — Kaka Jūmanokushi Daisōjin`);
  try {
    dim.playSound("mob.wither.spawn", o, { volume: 1.6, pitch: 0.7 });
  } catch (e) {}
  for (let i = 0; i < cfg.count; i++) {
    const a = (i / cfg.count) * Math.PI * 2;
    const spot = { x: o.x + Math.cos(a) * cfg.ringRadius, y: o.y, z: o.z + Math.sin(a) * cfg.ringRadius };
    try {
      const dead = dim.spawnEntity(cfg.entity, spot);
      dead.nameTag = "§6Morto Incinerado";
      yamamotoSummons.set(dead.id, {
        entity: dead,
        ownerId: player.id,
        until: system.currentTick + cfg.lifetimeTicks,
        lastHit: -1000,
      });
      flameBurst(dim, spot, 6, 1.2);
    } catch (e) {}
  }
}

function removeSummon(id, summon) {
  yamamotoSummons.delete(id);
  try {
    flameBurst(summon.entity.dimension, summon.entity.location, 5, 1);
    summon.entity.remove();
  } catch (e) {}
}

// o morto some no fim do tempo, e quando o Bankai do dono acaba
function removeSummonsOf(ownerId) {
  for (const [id, summon] of yamamotoSummons) {
    if (summon.ownerId === ownerId) removeSummon(id, summon);
  }
}

// trilha de fogo + golpe de 50 (o ataque vanilla do esqueleto nao da dano)
system.runInterval(() => {
  const now = system.currentTick;
  const cfg = YAMAMOTO.minami;
  for (const [id, summon] of yamamotoSummons) {
    const dead = summon.entity;
    let owner;
    try {
      if (!dead.isValid || isDownOrGone(dead)) {
        yamamotoSummons.delete(id);
        continue;
      }
      owner = world.getPlayers().find((p) => p.id === summon.ownerId);
    } catch (e) {
      yamamotoSummons.delete(id);
      continue;
    }
    if (now >= summon.until || !owner || !isYamamoto(owner) || !isAwakened(owner)) {
      removeSummon(id, summon);
      continue;
    }
    try {
      const l = dead.location;
      dead.dimension.spawnParticle("yamamoto:chama", { x: l.x + (Math.random() - 0.5) * 0.4, y: l.y + 0.1, z: l.z + (Math.random() - 0.5) * 0.4 });
      dead.dimension.spawnParticle("yamamoto:brasa", { x: l.x, y: l.y + 1 + Math.random(), z: l.z });
      if (now - summon.lastHit < cfg.hitCooldownTicks) continue;
      let victim;
      let best = cfg.reach;
      for (const player of dead.dimension.getPlayers({ location: l, maxDistance: cfg.reach + 1 })) {
        if (isYamamoto(player) || isDownOrGone(player)) continue;
        const d = Math.hypot(player.location.x - l.x, player.location.z - l.z);
        if (d <= best && Math.abs(player.location.y - l.y) < 2) {
          best = d;
          victim = player;
        }
      }
      if (!victim) continue;
      summon.lastHit = now;
      dealDamage(victim, DAMAGE.minamiHit, dead);
    } catch (e) {}
  }
}, 5);

/* ---------- Nishi: Zanjitsu Gokui ---------- */

const yamamotoNishi = new Map(); // id -> tick em que acaba

function isNishiActive(entity) {
  return (yamamotoNishi.get(entity?.id) ?? 0) > system.currentTick;
}

function castNishi(player) {
  if (!tryUseSkill(player, "yamamoto:nishi")) return;
  const cfg = YAMAMOTO.nishi;
  yamamotoNishi.set(player.id, system.currentTick + cfg.durationTicks);
  world.sendMessage(`§6${player.name}: §c§lNishi — Zanjitsu Gokui`);
  try {
    player.dimension.playSound("mob.blaze.breathe", player.location, { volume: 2, pitch: 0.5 });
  } catch (e) {}
}

system.runInterval(() => {
  const now = system.currentTick;
  const cfg = YAMAMOTO.nishi;
  for (const [id, until] of yamamotoNishi) {
    const player = world.getPlayers().find((p) => p.id === id);
    if (!player || now >= until || !isYamamoto(player) || !isAwakened(player) || isDownOrGone(player)) {
      yamamotoNishi.delete(id);
      continue;
    }
    try {
      const dim = player.dimension;
      const l = player.location;
      // o corpo envolto em fogo
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        dim.spawnParticle(i % 2 ? "yamamoto:chama" : YAMAMOTO.infernalParticle, {
          x: l.x + Math.cos(a) * 0.8,
          y: l.y + Math.random() * 2.2,
          z: l.z + Math.sin(a) * 0.8,
        });
      }
      // como a Respira: o que vem voando e queimado antes de chegar
      cancelAttacksNear(player, dim, { x: l.x, y: l.y + 1, z: l.z }, cfg.eraseRadius, 99, {
        label: "Zanjitsu Gokui",
        particles: ["yamamoto:chama", YAMAMOTO.infernalParticle],
      });
      // quem esta a 10 blocos queima (Infernal) enquanto ficar ali
      if (now % 20 === 0) {
        for (const entity of dim.getEntities({ location: l, maxDistance: cfg.radius })) {
          if (entity.id === player.id || isOwnSummon(player, entity)) continue;
          if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
          applyBurn(entity, player, 1, true);
        }
      }
    } catch (e) {}
  }
}, 2);

/* ---------- Higashi: Kyokujitsujin ---------- */

CRESCENT_LOOKS.fogo = {
  coreParticle: "yamamoto:chama",
  edgeParticle: "yamamoto:lamina",
  boltParticle: "yamamoto:brasa",
  points: 15,
  litePoints: 7,
  bolts: 2,
  boltSegments: 3,
  boltStep: 0.5,
};

function castHigashi(player) {
  if (!tryUseSkill(player, "yamamoto:higashi")) return;
  const cfg = YAMAMOTO.higashi;
  world.sendMessage(`§6${player.name}: §c§lHigashi — Kyokujitsujin`);
  try {
    player.dimension.playSound("mob.ghast.fireball", player.location, { volume: 2, pitch: 0.6 });
    player.dimension.playSound("item.trident.riptide_1", player.location, { volume: 1, pitch: 1.6 });
  } catch (e) {}
  fireCrescent(player, cfg, CRESCENT_LOOKS.fogo, {
    damage: DAMAGE.higashi,
    ignore: (entity) => isOwnSummon(player, entity),
    afterHit: (entity) => applyBurn(entity, player, cfg.infernalSeconds, true),
  });
}

/* ---------- Kita: Tenchi Kaijin ---------- */

function castKita(player) {
  if (!tryUseSkill(player, "yamamoto:kita")) return;
  const cfg = YAMAMOTO.kita;
  const dim = player.dimension;
  const o = player.location;
  const f = forwardDirection(player);
  const r = { x: -f.z, z: f.x };
  const hit = new Set();
  world.sendMessage(`§6§l${player.name}: §4§lKita — Tenchi Kaijin!`);
  try {
    dim.playSound("mob.warden.sonic_boom", o, { volume: 2, pitch: 0.4 });
    dim.playSound("mob.ghast.fireball", o, { volume: 2, pitch: 0.3 });
  } catch (e) {}
  // o Bankai acaba na hora; o corte termina sozinho
  player.setDynamicProperty(DP.awakening, 0);
  revertAwakening(player, "kita");
  let k = 0;
  const interval = system.runInterval(() => {
    k++;
    // o corte varre meio circulo na frente, de um lado ao outro
    const fromAngle = -Math.PI / 2 + (Math.PI * (k - 1)) / cfg.sweepTicks;
    const toAngle = -Math.PI / 2 + (Math.PI * k) / cfg.sweepTicks;
    try {
      for (let a = fromAngle; a <= toAngle + 1e-6; a += Math.PI / 30) {
        const c = Math.cos(a);
        const s = Math.sin(a);
        for (let rad = 3; rad <= cfg.radius; rad += 1.6) {
          dim.spawnParticle(rad >= cfg.radius - 1.6 ? "yamamoto:lamina" : "yamamoto:chama", {
            x: o.x + (f.x * c + r.x * s) * rad,
            y: o.y + 1.2 + Math.sin(rad) * 0.4,
            z: o.z + (f.z * c + r.z * s) * rad,
          });
        }
      }
      for (const entity of dim.getEntities({ location: o, maxDistance: cfg.radius + 1 })) {
        if (hit.has(entity.id)) continue;
        const l = entity.location;
        const dx = l.x - o.x;
        const dz = l.z - o.z;
        const along = dx * f.x + dz * f.z;
        const across = dx * r.x + dz * r.z;
        if (along < 0 || Math.hypot(dx, dz) > cfg.radius + 0.6 || Math.abs(l.y - o.y) > cfg.height) continue;
        const angle = Math.atan2(across, along);
        if (angle > toAngle + 0.05) continue; // o corte ainda nao chegou ali
        if (yamamotoStrike(player, entity, DAMAGE.kita, cfg.infernalSeconds, true)) hit.add(entity.id);
      }
    } catch (e) {
      system.clearRun(interval);
      return;
    }
    if (k >= cfg.sweepTicks) system.clearRun(interval);
  }, 1);
}

/* ---------- limpeza ---------- */

function yamamotoCleanup(playerId) {
  removeSummonsOf(playerId);
  yamamotoNishi.delete(playerId);
  yamamotoPassiveTick.delete(playerId);
}

/* ---------------------------------------------------------
   Retsu Unohana - Tier 3 (Shinigami)
   Três livros de kidō (Hadōs, Bakudōs, Kaidōs): agachar + usar abre o menu,
   usar lança a escolhida - igual ao Illusions do Aizen Hōgyoku. Super:
   Kaidō Expert.
   --------------------------------------------------------- */

const UNOHANA = {
  books: {
    "unohana:hados": {
      title: "Hadōs",
      color: "§b",
      dp: "mv:unohana_hado",
      spells: [
        { key: "unohana:hados.byakurai", name: "Hadō #4 — Byakurai" },
        { key: "unohana:hados.sokatsui", name: "Hadō #33 — Sōkatsui" },
        { key: "unohana:hados.soren_sokatsui", name: "Hadō #73 — Sōren Sōkatsui" },
      ],
    },
    "unohana:bakudos": {
      title: "Bakudōs",
      color: "§e",
      dp: "mv:unohana_bakudo",
      spells: [
        { key: "unohana:bakudos.seki", name: "Bakudō #8 — Seki" },
        { key: "unohana:bakudos.sajo_sabaku", name: "Bakudō #63 — Sajō Sabaku" },
        { key: "unohana:bakudos.danku", name: "Bakudō #81 — Dankū" },
      ],
    },
    "unohana:kaidos": {
      title: "Kaidōs",
      color: "§a",
      dp: "mv:unohana_kaido",
      spells: [
        { key: "unohana:kaidos.basico", name: "Kaidō Básico" },
        { key: "unohana:kaidos.avancado", name: "Kaidō Avançado" },
        { key: "unohana:kaidos.chiyu", name: "Chiyu" },
        { key: "unohana:kaidos.diagnostico", name: "Diagnóstico" },
        { key: "unohana:kaidos.tratamento", name: "Tratamento em área" },
      ],
    },
  },
  byakurai: { range: 30, speed: 4, hitRadius: 0.8 },
  sokatsui: { range: 22, speed: 1.6, radius: 0.8, blastRadius: 3, shell: 10 },
  soren: { range: 28, speed: 1.8, radius: 1.4, blastRadius: 5, shell: 20 },
  seki: { durationTicks: 100, frontCos: 0.3, repelRange: 5, repelStrength: 1.6, distance: 1.3 },
  sajo: { range: 20, maxTier: 5, restrainTicks: 60, pauseTicks: 200 },
  danku: { durationTicks: 200, maxTier: 6, radius: 3 },
  kaido: {
    basico: { perSecond: 50, seconds: 5 },
    avancado: { perSecond: 100, seconds: 10 },
    chiyu: 200,
    tratamentoRange: 20,
  },
  // os efeitos que o Diagnóstico tira (os do addon ficam em mapas próprios)
  negativeEffects: [
    "slowness",
    "weakness",
    "poison",
    "fatal_poison",
    "wither",
    "blindness",
    "nausea",
    "hunger",
    "mining_fatigue",
    "darkness",
    "levitation",
  ],
  expert: { half: 3.5, height: 3 }, // 7x7
};

function isUnohana(entity) {
  try {
    return entity?.typeId === "minecraft:player" && getActiveCharacter(entity)?.id === "unohana";
  } catch (e) {
    return false;
  }
}

/* ---------- os três menus ---------- */

function selectedSpell(player, book) {
  const index = Number(player.getDynamicProperty(book.dp));
  return index >= 0 && index < book.spells.length ? index : 0;
}

function openSpellBook(player, itemId) {
  const book = UNOHANA.books[itemId];
  if (!book) return;
  const current = selectedSpell(player, book);
  const now = system.currentTick;
  const form = new ActionFormData()
    .title(book.title)
    .body(`${book.color}Escolha o kidō.§r\n§7Usar o item lança o escolhido; agachar + usar abre este menu.`);
  book.spells.forEach((spell, index) => {
    const key = cdKeyForSkill(spell.key);
    const duration = SKILL_COOLDOWN_TICKS[spell.key];
    const last = tickOf(player, key);
    const waiting = onCooldown(player, key, duration, now)
      ? `§c${Math.ceil((duration - (now - (last ?? now))) / 20)}s`
      : "§apronto";
    form.button(`${index === current ? `${book.color}▶ ` : ""}${spell.name}\n§8${duration / 20}s • ${waiting}`);
  });
  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;
    const spell = book.spells[res.selection];
    if (!spell) return;
    player.setDynamicProperty(book.dp, res.selection);
    player.sendMessage(`${book.color}Escolhido: §f${spell.name}`);
  });
}

function castFromBook(player, itemId) {
  const book = UNOHANA.books[itemId];
  if (!book) return;
  if (isFrozen(player) || isMayuriParalyzed(player)) {
    player.sendMessage("§7Você está paralisado e não consegue usar skills.");
    return;
  }
  const blocking = skillBlockingZoneFor(player);
  if (blocking) {
    player.sendMessage(blocking.blockMessage);
    return;
  }
  switch (book.spells[selectedSpell(player, book)].key) {
    case "unohana:hados.byakurai":
      return castByakurai(player);
    case "unohana:hados.sokatsui":
      return castSokatsui(player, false);
    case "unohana:hados.soren_sokatsui":
      return castSokatsui(player, true);
    case "unohana:bakudos.seki":
      return castSeki(player);
    case "unohana:bakudos.sajo_sabaku":
      return castSajoSabaku(player);
    case "unohana:bakudos.danku":
      return castDanku(player);
    case "unohana:kaidos.basico":
      return castKaidoGradual(player, "unohana:kaidos.basico", UNOHANA.kaido.basico, "Kaidō Básico");
    case "unohana:kaidos.avancado":
      return castKaidoGradual(player, "unohana:kaidos.avancado", UNOHANA.kaido.avancado, "Kaidō Avançado");
    case "unohana:kaidos.chiyu":
      return castChiyu(player);
    case "unohana:kaidos.diagnostico":
      return castDiagnostico(player);
    case "unohana:kaidos.tratamento":
      return castTratamento(player);
  }
}

/* ---------- Hadōs ---------- */

// alguem (com vida) encostado no ponto, medindo o corpo inteiro e nao so os pes
function kidoVictimAt(player, dim, point, radius) {
  for (const entity of dim.getEntities({ location: point, maxDistance: radius + 2.5 })) {
    if (entity.id === player.id) continue;
    try {
      if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
    } catch (e) {
      continue;
    }
    const l = entity.location;
    if (Math.hypot(l.x - point.x, l.z - point.z) > radius + 0.3) continue;
    if (point.y < l.y - 0.3 || point.y > l.y + 2.1) continue;
    return entity;
  }
  return undefined;
}

function kidoOrigin(player) {
  const dir = unitVector(player.getViewDirection());
  const head = player.getHeadLocation();
  return { dir, pos: { x: head.x + dir.x * 0.8, y: head.y - 0.25 + dir.y * 0.8, z: head.z + dir.z * 0.8 } };
}

function castByakurai(player) {
  if (!tryUseSkill(player, "unohana:hados.byakurai")) return;
  const cfg = UNOHANA.byakurai;
  const dim = player.dimension;
  world.sendMessage(`§b${player.name}: §f§lHadō #4 — Byakurai`);
  try {
    dim.playSound("ambient.weather.lightning.impact", player.location, { volume: 0.5, pitch: 2 });
  } catch (e) {}
  let { dir, pos } = kidoOrigin(player);
  const cache = new Map();
  const attack = trackAttack(player, 0.6);
  let travelled = 0;
  const interval = system.runInterval(() => {
    if (attack.cancelled) {
      system.clearRun(interval);
      return;
    }
    touchAttack(attack, pos);
    try {
      // um raio fino e rapido: anda de bloco em bloco pra nao atravessar ninguem
      for (let s = 0; s < cfg.speed; s++) {
        const next = { x: pos.x + dir.x, y: pos.y + dir.y, z: pos.z + dir.z };
        if (dangaiCellSolid(dim, cache, Math.floor(next.x), Math.floor(next.y), Math.floor(next.z))) {
          dim.spawnParticle("unohana:raio", pos);
          system.clearRun(interval);
          return;
        }
        const victim = kidoVictimAt(player, dim, next, cfg.hitRadius);
        if (victim) {
          if (isRespiring(victim)) showRespiraGuard(victim);
          else dealDamage(victim, DAMAGE.byakurai * dmgMultiplier(player), player);
          for (let i = 0; i < 4; i++) dim.spawnParticle("unohana:raio", next);
          system.clearRun(interval);
          return;
        }
        pos = next;
        travelled++;
        dim.spawnParticle("unohana:raio", pos);
        if (travelled >= cfg.range) {
          system.clearRun(interval);
          return;
        }
      }
    } catch (e) {
      system.clearRun(interval);
    }
  }, 1);
}

// bola de fogo azul que estoura no primeiro que tocar (Sōkatsui e Sōren)
function castSokatsui(player, soren) {
  const key = soren ? "unohana:hados.soren_sokatsui" : "unohana:hados.sokatsui";
  if (!tryUseSkill(player, key)) return;
  const cfg = soren ? UNOHANA.soren : UNOHANA.sokatsui;
  const damage = soren ? DAMAGE.sorenSokatsui : DAMAGE.sokatsui;
  const dim = player.dimension;
  world.sendMessage(
    soren ? `§b${player.name}: §9§lHadō #73 — Sōren Sōkatsui` : `§b${player.name}: §9§lHadō #33 — Sōkatsui`
  );
  try {
    dim.playSound("mob.blaze.shoot", player.location, { volume: 1.4, pitch: soren ? 0.6 : 1 });
  } catch (e) {}
  let { dir, pos } = kidoOrigin(player);
  const cache = new Map();
  const attack = trackAttack(player, cfg.radius);
  let travelled = 0;
  const step = Math.min(cfg.speed, cfg.radius);
  const explode = (at) => {
    system.clearRun(interval);
    try {
      dim.playSound("random.explode", at, { volume: soren ? 2 : 1.3, pitch: soren ? 0.7 : 1.1 });
      const n = soren ? 26 : 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = cfg.blastRadius * (0.3 + Math.random() * 0.7);
        dim.spawnParticle(i % 5 === 0 ? "minecraft:large_explosion" : "unohana:fogo_azul", {
          x: at.x + Math.cos(a) * r,
          y: at.y - 0.6 + Math.random() * 1.8,
          z: at.z + Math.sin(a) * r,
        });
      }
    } catch (e) {}
    for (const entity of dim.getEntities({ location: at, maxDistance: cfg.blastRadius + 2 })) {
      if (entity.id === player.id) continue;
      try {
        if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
        const l = entity.location;
        if (Math.hypot(l.x - at.x, l.y + 1 - at.y, l.z - at.z) > cfg.blastRadius + 0.6) continue;
        if (isRespiring(entity)) {
          showRespiraGuard(entity);
          continue;
        }
        dealDamage(entity, damage * dmgMultiplier(player), player);
      } catch (e) {}
    }
  };
  const interval = system.runInterval(() => {
    if (attack.cancelled) {
      system.clearRun(interval);
      return;
    }
    touchAttack(attack, pos);
    try {
      for (let i = 0; i < cfg.shell; i++) {
        const t = Math.random() * Math.PI * 2;
        const f = Math.acos(2 * Math.random() - 1);
        const r = cfg.radius * (0.6 + Math.random() * 0.4);
        dim.spawnParticle("unohana:fogo_azul", {
          x: pos.x + r * Math.sin(f) * Math.cos(t),
          y: pos.y + r * Math.cos(f),
          z: pos.z + r * Math.sin(f) * Math.sin(t),
        });
      }
      for (let moved = 0; moved < cfg.speed; moved += step) {
        const next = { x: pos.x + dir.x * step, y: pos.y + dir.y * step, z: pos.z + dir.z * step };
        if (dangaiCellSolid(dim, cache, Math.floor(next.x), Math.floor(next.y), Math.floor(next.z))) {
          explode(pos);
          return;
        }
        if (kidoVictimAt(player, dim, next, cfg.radius)) {
          explode(next);
          return;
        }
        pos = next;
        travelled += step;
        if (travelled >= cfg.range) {
          explode(pos);
          return;
        }
      }
    } catch (e) {
      system.clearRun(interval);
    }
  }, 1);
}

/* ---------- Bakudōs ---------- */

const unohanaSeki = new Map(); // id -> tick em que acaba
const unohanaDanku = new Map();

function castSeki(player) {
  if (!tryUseSkill(player, "unohana:bakudos.seki")) return;
  unohanaSeki.set(player.id, system.currentTick + UNOHANA.seki.durationTicks);
  world.sendMessage(`§e${player.name}: §6§lBakudō #8 — Seki`);
  try {
    player.dimension.playSound("random.anvil_land", player.location, { volume: 0.6, pitch: 1.8 });
  } catch (e) {}
}

function castDanku(player) {
  if (!tryUseSkill(player, "unohana:bakudos.danku")) return;
  unohanaDanku.set(player.id, system.currentTick + UNOHANA.danku.durationTicks);
  world.sendMessage(`§e${player.name}: §6§lBakudō #81 — Dankū`);
  try {
    player.dimension.playSound("beacon.activate", player.location, { volume: 1.5, pitch: 1.4 });
  } catch (e) {}
}

function barrierSpark(entity, particle) {
  try {
    const l = entity.location;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      entity.dimension.spawnParticle(particle, { x: l.x + Math.cos(a) * 1.1, y: l.y + 1.2, z: l.z + Math.sin(a) * 1.1 });
    }
    entity.dimension.playSound("random.glass", l, { volume: 0.5, pitch: 1.8 });
  } catch (e) {}
}

// chamada pelo dealDamage: Dankū segura tudo de tier <= 6; Seki segura o que
// vem pela frente e empurra quem estiver perto
function unohanaBarrierBlocks(target, source) {
  if (!target || !source || source.id === target.id) return false;
  const now = system.currentTick;
  if ((unohanaDanku.get(target.id) ?? 0) > now) {
    let tier = 0;
    try {
      tier = source.typeId === "minecraft:player" ? tierOfPlayer(source) : 0;
    } catch (e) {}
    if (tier <= UNOHANA.danku.maxTier) {
      barrierSpark(target, "unohana:escudo");
      return true;
    }
  }
  if ((unohanaSeki.get(target.id) ?? 0) > now) {
    const cfg = UNOHANA.seki;
    try {
      const view = forwardDirection(target);
      const l = target.location;
      const s = source.location;
      const dx = s.x - l.x;
      const dz = s.z - l.z;
      const length = Math.hypot(dx, dz) || 1;
      if ((dx * view.x + dz * view.z) / length >= cfg.frontCos) {
        barrierSpark(target, "unohana:escudo");
        if (length <= cfg.repelRange) {
          source.applyKnockback({ x: (dx / length) * cfg.repelStrength, z: (dz / length) * cfg.repelStrength }, 0.35);
        }
        return true;
      }
    } catch (e) {}
  }
  return false;
}

// visual das barreiras e os ataques que viajam sendo segurados
system.runInterval(() => {
  const now = system.currentTick;
  for (const [map, isDanku] of [
    [unohanaSeki, false],
    [unohanaDanku, true],
  ]) {
    for (const [id, until] of map) {
      const player = world.getPlayers().find((p) => p.id === id);
      if (!player || now >= until || !isUnohana(player) || isDownOrGone(player)) {
        map.delete(id);
        continue;
      }
      try {
        const dim = player.dimension;
        const l = player.location;
        const chest = { x: l.x, y: l.y + 1.2, z: l.z };
        if (isDanku) {
          const r = UNOHANA.danku.radius;
          for (let i = 0; i < 12; i++) {
            const t = Math.random() * Math.PI * 2;
            const f = Math.acos(Math.random() * 1.6 - 0.6); // mais cupula que esfera
            dim.spawnParticle("unohana:escudo", {
              x: l.x + r * Math.sin(f) * Math.cos(t),
              y: l.y + 0.2 + r * Math.cos(f),
              z: l.z + r * Math.sin(f) * Math.sin(t),
            });
          }
          cancelAttacksNear(player, dim, chest, r, UNOHANA.danku.maxTier, {
            label: "Bakudō #81: Dankū",
            particles: ["unohana:escudo", "unohana:raio"],
          });
        } else {
          const cfg = UNOHANA.seki;
          const frame = crescentFrame(player.getViewDirection());
          const c = framePoint(chest, frame, cfg.distance, 0, 0);
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            dim.spawnParticle("unohana:escudo", framePoint(c, frame, 0, Math.sin(a) * 0.9, Math.cos(a) * 0.9));
          }
          cancelAttacksNear(player, dim, c, 1.4, 99, {
            label: "Bakudō #8: Seki",
            particles: ["unohana:escudo", "unohana:raio"],
          });
        }
      } catch (e) {}
    }
  }
}, 2);

function castSajoSabaku(player) {
  const cfg = UNOHANA.sajo;
  const target = targetInView(player, cfg.range);
  if (!target) {
    player.sendMessage("§eMire em alguém pra prender com o Sajō Sabaku.");
    return;
  }
  let tier = 0;
  try {
    tier = target.typeId === "minecraft:player" ? tierOfPlayer(target) : 0;
  } catch (e) {}
  if (tier > cfg.maxTier) {
    player.sendMessage(`§e${nameOf(target)} é forte demais pro Sajō Sabaku §7(tier ${tier}; só pega até o tier ${cfg.maxTier}).`);
    return;
  }
  if (!tryUseSkill(player, "unohana:bakudos.sajo_sabaku")) return;
  const dim = player.dimension;
  world.sendMessage(`§e${player.name}: §6§lBakudō #63 — Sajō Sabaku`);
  try {
    const from = player.getHeadLocation();
    const to = target.location;
    const length = Math.hypot(to.x - from.x, to.y + 1 - from.y, to.z - from.z);
    for (let s = 0.5; s < length; s += 0.6) {
      const k = s / length;
      dim.spawnParticle("unohana:corrente", {
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y + 1 - from.y) * k,
        z: from.z + (to.z - from.z) * k,
      });
    }
    dim.playSound("random.anvil_land", to, { volume: 0.8, pitch: 1.2 });
  } catch (e) {}
  if (!isIntocable(target)) paralyzeFor(target, cfg.restrainTicks, "§6Sajō Sabaku: correntes de energia te prendem!");
  freezeCooldowns(target, cfg.pauseTicks, `§6Sajō Sabaku: seus cooldowns pararam por ${cfg.pauseTicks / 20}s!`);
  // as correntes enroladas no alvo enquanto ele esta preso
  let tick = 0;
  const chains = system.runInterval(() => {
    tick += 4;
    try {
      if (isDownOrGone(target) || tick > cfg.restrainTicks) {
        system.clearRun(chains);
        return;
      }
      const l = target.location;
      for (const h of [0.6, 1.1, 1.6]) {
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + tick * 0.2;
          dim.spawnParticle("unohana:corrente", { x: l.x + Math.cos(a) * 0.55, y: l.y + h, z: l.z + Math.sin(a) * 0.55 });
        }
      }
    } catch (e) {
      system.clearRun(chains);
    }
  }, 4);
}

/* ---------- Kaidōs ---------- */

const unohanaHeals = new Map(); // id -> { entity, list: [{ perSecond, left }] }

function healVirtual(entity, amount) {
  try {
    const hp = entity.getComponent("minecraft:health");
    if (!hp || isDownOrGone(entity)) return 0;
    const max = hp.effectiveMax * healthScaleOf(entity);
    const before = virtualHealth(entity);
    const after = Math.min(max, before + amount);
    if (after > before) setVirtualHealth(entity, after);
    const l = entity.location;
    for (let i = 0; i < 4; i++) {
      entity.dimension.spawnParticle("unohana:cura", {
        x: l.x + (Math.random() - 0.5) * 0.9,
        y: l.y + 0.3 + Math.random() * 1.6,
        z: l.z + (Math.random() - 0.5) * 0.9,
      });
    }
    return after - before;
  } catch (e) {
    return 0;
  }
}

function fullHeal(entity) {
  try {
    const hp = entity.getComponent("minecraft:health");
    if (!hp) return;
    healVirtual(entity, hp.effectiveMax * healthScaleOf(entity));
  } catch (e) {}
}

// cura gradual: exatamente `seconds` curas, uma por segundo
function startHealOverTime(entity, perSecond, seconds) {
  let state = unohanaHeals.get(entity.id);
  if (!state) {
    state = { entity, list: [] };
    unohanaHeals.set(entity.id, state);
  }
  state.list.push({ perSecond, left: seconds });
}

system.runInterval(() => {
  for (const [id, state] of unohanaHeals) {
    if (isDownOrGone(state.entity)) {
      unohanaHeals.delete(id);
      continue;
    }
    for (const heal of state.list) {
      healVirtual(state.entity, heal.perSecond);
      heal.left--;
    }
    state.list = state.list.filter((heal) => heal.left > 0);
    if (!state.list.length) unohanaHeals.delete(id);
  }
}, 20);

function castKaidoGradual(player, key, cfg, label) {
  if (!tryUseSkill(player, key)) return;
  player.sendMessage(`§a${label}: §f${cfg.perSecond} de vida por segundo por ${cfg.seconds}s.`);
  try {
    player.dimension.playSound("beacon.power", player.location, { volume: 0.8, pitch: 1.6 });
  } catch (e) {}
  startHealOverTime(player, cfg.perSecond, cfg.seconds);
}

function castChiyu(player) {
  if (!tryUseSkill(player, "unohana:kaidos.chiyu")) return;
  const healed = healVirtual(player, UNOHANA.kaido.chiyu);
  player.sendMessage(`§aChiyu: §f+${Math.round(healed)} de vida.`);
  try {
    player.dimension.playSound("random.orb", player.location, { volume: 1, pitch: 1.4 });
  } catch (e) {}
}

// tira os efeitos ruins, os vanilla e os unicos do addon
function cleanseNegativeEffects(entity) {
  for (const effect of UNOHANA.negativeEffects) {
    try {
      entity.removeEffect(effect);
    } catch (e) {}
  }
  const id = entity.id;
  burns.delete(id); // Queimadura / Queimadura Infernal (Yamamoto)
  clearDots(id); // Deterioração (Barragan) e os outros DoTs
  activeMayuriPoisons.delete(id); // veneno do Mayuri
  fragility.delete(id); // Fragilização (Rukia)
  cdFrozen.delete(id); // cooldowns congelados (Hitsugaya)
  vulnerableUntil.delete(id); // Jokenpo do Shunsui
  try {
    entity.setDynamicProperty(DP.noDash, undefined); // Ice Age: sem dash
    entity.setDynamicProperty(DP.markedEnd, 0); // Pesquisa do Ulquiorra
  } catch (e) {}
}

function castDiagnostico(player) {
  if (!tryUseSkill(player, "unohana:kaidos.diagnostico")) return;
  cleanseNegativeEffects(player);
  player.sendMessage("§aDiagnóstico: §fos efeitos negativos foram tratados.");
  try {
    const l = player.location;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      player.dimension.spawnParticle("unohana:cura", { x: l.x + Math.cos(a) * 0.9, y: l.y + 0.2 + (i % 4) * 0.5, z: l.z + Math.sin(a) * 0.9 });
    }
    player.dimension.playSound("random.orb", l, { volume: 1, pitch: 0.8 });
  } catch (e) {}
}

function castTratamento(player) {
  const target = targetInView(player, UNOHANA.kaido.tratamentoRange);
  if (!target) {
    player.sendMessage("§aOlhe pra quem você quer tratar.");
    return;
  }
  if (!tryUseSkill(player, "unohana:kaidos.tratamento")) return;
  const cfg = UNOHANA.kaido.basico;
  player.sendMessage(`§aTratamento em área: §f${nameOf(target)} recebe ${cfg.perSecond} de vida por segundo por ${cfg.seconds}s.`);
  try {
    if (target.typeId === "minecraft:player") target.sendMessage(`§a${player.name} está tratando você.`);
  } catch (e) {}
  startHealOverTime(target, cfg.perSecond, cfg.seconds);
}

/* ---------- Awk: Kaidō Expert ---------- */

// quem atacou a Unohana DESDE que ela escolheu a personagem nao e curado
const unohanaAttackers = new Map(); // id da Unohana -> Set de ids

function recordUnohanaAttacker(target, source) {
  const set = unohanaAttackers.get(target?.id);
  if (!set || !source || source.id === target.id) return;
  set.add(source.id);
}

function tryTriggerKaidoExpert(player) {
  if (getAwakening(player) < 100) return false;
  if (skillBlockingZoneFor(player)) return false;
  player.setDynamicProperty(DP.awakening, 0);
  const cfg = UNOHANA.expert;
  const dim = player.dimension;
  const o = player.location;
  const attackers = unohanaAttackers.get(player.id) ?? new Set();
  world.sendMessage(`§a${player.name}: §2§lKaidō Expert`);
  let healed = 0;
  let refused = 0;
  for (const entity of dim.getEntities({ location: o, maxDistance: cfg.half * 1.5 + cfg.height })) {
    try {
      const l = entity.location;
      if (Math.abs(l.x - o.x) > cfg.half || Math.abs(l.z - o.z) > cfg.half || Math.abs(l.y - o.y) > cfg.height) continue;
      if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
      if (entity.typeId === AIZEN.cloneType) continue;
      if (attackers.has(entity.id)) {
        refused++;
        if (entity.typeId === "minecraft:player") entity.sendMessage("§7O Kaidō Expert não cura quem atacou a Unohana.");
        continue;
      }
      fullHeal(entity);
      healed++;
    } catch (e) {}
  }
  try {
    dim.playSound("beacon.activate", o, { volume: 1.6, pitch: 1.6 });
    // o quadrado de 7x7 no chao, e a cura subindo dentro dele
    for (let u = -cfg.half; u <= cfg.half; u += 0.7) {
      for (const [x, z] of [
        [u, -cfg.half],
        [u, cfg.half],
        [-cfg.half, u],
        [cfg.half, u],
      ]) {
        dim.spawnParticle("unohana:cura", { x: o.x + x, y: o.y + 0.2, z: o.z + z });
      }
    }
  } catch (e) {}
  player.sendMessage(`§aKaidō Expert: §f${healed} curado(s)${refused ? `, §7${refused} que te atacaram ficaram de fora` : ""}.`);
  return true;
}

/* ---------- limpeza ---------- */

function unohanaCleanup(playerId, full) {
  unohanaSeki.delete(playerId);
  unohanaDanku.delete(playerId);
  if (full) unohanaAttackers.delete(playerId);
}

/* ---------------------------------------------------------
   Sajin Komamura - Tier 4 (Shinigami)
   Tenken: partes do gigante Myō'ō aparecem pra atacar (entidades com modelo
   e animação: braço com katana, punho e os braços da guarda). No Bankai o
   player VIRA o gigante (marcador na offhand + armadura), e os ataques saem
   do tamanho dele, não da hitbox do player.
   Os ataques que "destroem blocos" quebram de verdade e o terreno volta
   sozinho depois de 1 minuto (livro-caixa de blocos, restaurado aos poucos).
   --------------------------------------------------------- */

const KOMAMURA = {
  visual: { braco: "komamura:braco", punho: "komamura:punho", guarda: "komamura:guarda" },
  // o braco nasce atras e acima do ombro direito e desce cortando a frente
  arm: { lifeTicks: 16, back: 1.0, side: 1.3, up: 1.4, reach: 8, halfWidth: 2.8, height: 5, strikeDelayTicks: 5 },
  m1EveryHits: 3,
  armMultiplier: 1.25,
  barrage: { cuts: 3, gapTicks: 9 },
  destructive: {
    radius: DANGAI.mugetsu.radius, // "do tamanho do Mugetsu"
    bulge: 4,
    thickness: 3,
    lateral: 2.5,
    speed: 3,
    range: 25,
    subSteps: 3,
    startAhead: 2,
    startHeight: 2.5,
    cancelsUpToTier: -1,
    carveWidth: 1,
    carveDepth: 3,
    carveUp: 12,
    blastEvery: 3,
    blastRadius: 3,
    craterRadius: 2,
  },
  shield: { durationTicks: 100, multiplier: 0.7 },
  ora: { durationTicks: 200, everyTicks: 4, range: 30, blastRadius: 3, craterRadius: 2, shakeRadius: 24 },
  bankaiScale: 6.25, // o mesmo numero do player.entity.json
  titanic: {
    radius: DANGAI.mugetsu.radius * 2, // "algumas vezes o tamanho"
    bulge: 8,
    thickness: 5,
    lateral: 4,
    speed: 4,
    range: 50,
    subSteps: 4,
    startAhead: 3,
    startHeight: 7, // sai da katana do gigante, nao do pe
    cancelsUpToTier: -1,
    carveWidth: 2,
    carveDepth: 4,
    carveUp: 24,
    blastEvery: 4,
    blastRadius: 4,
    craterRadius: 3,
    slowTicks: 100,
    slowAmplifier: 1, // lentidao 2
  },
  stomp: { range: 40, delayTicks: 10, radius: 6, height: 6, craterRadius: 3 },
  punch: { range: 40, delayTicks: 6, radius: 3.5, height: 5, craterRadius: 2 },
  susanoo: {
    radius: 40, // maior que o Mugetsu (16,2) e que o Titanic Slash (32,4)
    bulge: 10,
    thickness: 4,
    lateral: 3,
    speed: 4,
    range: 60,
    subSteps: 4,
    startAhead: 3,
    startHeight: 2,
    cancelsUpToTier: -1,
    carveUp: 4,
  },
  giantM1: { reach: 6, arcCos: 0.35, cooldownTicks: 8 },
  restoreTicks: 1200,
  restorePerTick: 300,
};

CRESCENT_LOOKS.myoo = {
  coreParticle: "komamura:corte",
  edgeParticle: "komamura:brilho",
  boltParticle: "komamura:poeira",
  points: 21,
  litePoints: 9,
  bolts: 3,
  boltSegments: 4,
  boltStep: 1.2,
};

function isKomamura(entity) {
  try {
    return entity?.typeId === "minecraft:player" && getActiveCharacter(entity)?.id === "komamura";
  } catch (e) {
    return false;
  }
}

/* ---------- terreno: quebra de verdade e volta em 1 minuto ---------- */

function komamuraBreak(ledger, dim, x, y, z, seen) {
  const key = `${x},${y},${z}`;
  if (seen.has(key)) return;
  seen.add(key);
  try {
    const block = dim.getBlock({ x, y, z });
    if (!block || block.isAir || block.isLiquid) return;
    // bedrock, bau, porta, cama... e os blocos de outras skills (caixa, gelo)
    if (!iceCanReplace(block) || LEDGER_PROTECTED_BLOCKS.has(block.typeId) || block.typeId.includes("ice")) return;
    ledger.push({ dim, x, y, z, was: block.permutation });
    block.setType("minecraft:air");
  } catch (e) {}
}

function komamuraCrater(ledger, dim, at, radius, seen) {
  const cx = Math.floor(at.x);
  const cy = Math.floor(at.y);
  const cz = Math.floor(at.z);
  const r = Math.ceil(radius);
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
        komamuraBreak(ledger, dim, cx + dx, cy + dy, cz + dz, seen);
      }
    }
  }
}

// devolve o terreno aos poucos (muitos blocos de uma vez travariam o tick)
function scheduleRestore(ledger) {
  system.runTimeout(() => {
    let i = ledger.length - 1;
    const run = system.runInterval(() => {
      for (let n = 0; n < KOMAMURA.restorePerTick && i >= 0; n++, i--) iceRestoreEntry(ledger[i]);
      if (i < 0) system.clearRun(run);
    }, 1);
  }, KOMAMURA.restoreTicks);
}

function shakeNear(dim, at, radius, intensity, seconds) {
  for (const player of world.getPlayers()) {
    try {
      if (player.dimension.id !== dim.id) continue;
      const l = player.location;
      if (Math.hypot(l.x - at.x, l.y - at.y, l.z - at.z) > radius) continue;
      player.runCommand(`camerashake add @s ${intensity} ${seconds} positional`);
    } catch (e) {}
  }
}

function blastVisual(dim, at, radius) {
  try {
    dim.playSound("random.explode", at, { volume: 1.6, pitch: 0.8 });
    const n = 8 + Math.round(radius * 3);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = radius * (0.3 + Math.random() * 0.7);
      const p = { x: at.x + Math.cos(a) * r, y: at.y + 0.3 + Math.random() * radius * 0.6, z: at.z + Math.sin(a) * r };
      dim.spawnParticle(i % 4 === 0 ? "minecraft:large_explosion" : i % 2 ? "komamura:poeira" : "komamura:brilho", p);
    }
  } catch (e) {}
}

// dano em area a partir de um ponto (cilindro), cada um uma vez por `hit`
function komamuraAreaHit(player, at, radius, height, damage, hit, after) {
  for (const entity of player.dimension.getEntities({ location: at, maxDistance: radius + height })) {
    if (entity.id === player.id || hit.has(entity.id)) continue;
    try {
      if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
      const l = entity.location;
      if (Math.hypot(l.x - at.x, l.z - at.z) > radius + 0.4) continue;
      if (l.y < at.y - 2 || l.y > at.y + height) continue;
      hit.add(entity.id);
      if (isRespiring(entity)) {
        showRespiraGuard(entity);
        continue;
      }
      dealDamage(entity, damage * dmgMultiplier(player), player);
      after?.(entity);
    } catch (e) {}
  }
}

// onde o gigante vai bater: quem esta na mira, o bloco mirado, ou a frente
function komamuraAimPoint(player, range) {
  const target = targetInView(player, range);
  if (target) return { ...target.location };
  try {
    const hit = player.getBlockFromViewDirection({ maxDistance: range });
    if (hit?.block) {
      const b = hit.block.location;
      return { x: b.x + 0.5, y: b.y + 1, z: b.z + 0.5 };
    }
  } catch (e) {}
  const v = unitVector(player.getViewDirection());
  const l = player.location;
  return { x: l.x + v.x * range * 0.5, y: l.y + 1 + v.y * range * 0.5, z: l.z + v.z * range * 0.5 };
}

/* ---------- partes do Myō'ō (entidades so de visual) ---------- */

const komamuraVisuals = new Map(); // id da entidade -> { entity, ownerId, until }

function spawnMyooPart(player, type, at, yaw, lifeTicks) {
  try {
    const part = player.dimension.spawnEntity(type, at);
    part.teleport(at, { keepVelocity: false, rotation: { x: 0, y: yaw } });
    komamuraVisuals.set(part.id, { entity: part, ownerId: player.id, until: system.currentTick + lifeTicks });
    return part;
  } catch (e) {
    return undefined;
  }
}

function removeMyooPart(part) {
  if (!part) return;
  komamuraVisuals.delete(part.id);
  try {
    part.remove();
  } catch (e) {}
}

system.runInterval(() => {
  const now = system.currentTick;
  for (const [id, part] of komamuraVisuals) {
    if (now >= part.until) removeMyooPart(part.entity);
    else if (!part.entity.isValid) komamuraVisuals.delete(id);
  }
}, 1);

// sobra de sessao anterior (o mundo fechou com um braço no ar)
system.runInterval(() => {
  for (const id of ["overworld", "nether", "the_end"]) {
    let dim;
    try {
      dim = world.getDimension(id);
    } catch (e) {
      continue;
    }
    for (const type of Object.values(KOMAMURA.visual)) {
      try {
        for (const entity of dim.getEntities({ type })) {
          if (!komamuraVisuals.has(entity.id)) entity.remove();
        }
      } catch (e) {}
    }
  }
}, 40);

function rightOf(f) {
  return { x: -f.z, z: f.x };
}

// o braço direito do gigante com a katana: nasce atras do ombro e corta a frente
function tenkenSlash(player, damage, onStrike) {
  const cfg = KOMAMURA.arm;
  const l = player.location;
  const f = forwardDirection(player);
  const r = rightOf(f);
  const yaw = player.getRotation().y;
  const at = { x: l.x - f.x * cfg.back + r.x * cfg.side, y: l.y + cfg.up, z: l.z - f.z * cfg.back + r.z * cfg.side };
  spawnMyooPart(player, KOMAMURA.visual.braco, at, yaw, cfg.lifeTicks);
  try {
    player.dimension.playSound("item.trident.riptide_2", l, { volume: 1.2, pitch: 0.6 });
  } catch (e) {}
  system.runTimeout(() => {
    if (isDownOrGone(player)) return;
    const dim = player.dimension;
    const o = player.location;
    const hit = new Set();
    // o arco do corte no chao, na frente dele
    try {
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const a = 1 + t * (cfg.reach - 1);
        const b = (0.5 - t) * cfg.halfWidth * 1.4;
        dim.spawnParticle(i % 2 ? "komamura:corte" : "komamura:brilho", {
          x: o.x + f.x * a + r.x * b,
          y: o.y + 0.6 + (1 - t) * 2.5,
          z: o.z + f.z * a + r.z * b,
        });
      }
      dim.playSound("random.explode", o, { volume: 0.6, pitch: 1.4 });
    } catch (e) {}
    for (const entity of dim.getEntities({ location: o, maxDistance: cfg.reach + 2 })) {
      if (entity.id === player.id || hit.has(entity.id)) continue;
      try {
        if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
        const e = entity.location;
        const dx = e.x - o.x;
        const dz = e.z - o.z;
        const along = dx * f.x + dz * f.z;
        const across = dx * r.x + dz * r.z;
        if (along < 0 || along > cfg.reach || Math.abs(across) > cfg.halfWidth) continue;
        if (e.y < o.y - 1.5 || e.y > o.y + cfg.height) continue;
        hit.add(entity.id);
        dealDamage(entity, damage * dmgMultiplier(player), player);
        onStrike?.(entity);
      } catch (e) {}
    }
  }, cfg.strikeDelayTicks);
}

/* ---------- m1 Tenken: o braço vem a cada 3 golpes ---------- */

const tenkenHits = new Map(); // id -> golpes desde o ultimo braço

function komamuraTenkenHit(player) {
  if (isAwakened(player)) return;
  const n = (tenkenHits.get(player.id) ?? 0) + 1;
  if (n < KOMAMURA.m1EveryHits) {
    tenkenHits.set(player.id, n);
    return;
  }
  tenkenHits.set(player.id, 0);
  tenkenSlash(player, DAMAGE.tenkenM1 * KOMAMURA.armMultiplier);
}

/* ---------- Myō'ō's Barrage ---------- */

function castMyooBarrage(player) {
  if (!tryUseSkill(player, "komamura:myoo_barrage")) return;
  const cfg = KOMAMURA.barrage;
  world.sendMessage(`§6${player.name}: §e§lMyō'ō's Barrage`);
  for (let i = 0; i < cfg.cuts; i++) {
    system.runTimeout(() => {
      if (isDownOrGone(player) || !isKomamura(player)) return;
      tenkenSlash(player, DAMAGE.myooBarrageCut);
    }, i * cfg.gapTicks);
  }
}

/* ---------- os cortes gigantes (Destructive, Titanic e Susano'o) ---------- */

// quebra o fio do corte por onde ele passa e abre explosoes no chao
function carvingSlash(player, cfg, damage, extra = {}) {
  const dim = player.dimension;
  const ground = Math.floor(player.location.y);
  const ledger = [];
  const seen = new Set();
  const hit = new Set();
  let travelled = 0;
  let lastBlast = -Infinity;
  const f = forwardDirection(player);
  fireCrescent(player, cfg, CRESCENT_LOOKS.myoo, {
    damage,
    direction: { x: f.x, y: 0, z: f.z },
    horizontal: !!extra.horizontal,
    startHeight: cfg.startHeight,
    hitSet: hit,
    afterHit: extra.afterHit,
    onStep: (c, frame) => {
      travelled += cfg.speed / cfg.subSteps;
      if (extra.horizontal) {
        // corte deitado: tira uma faixa do chao ate carveUp, no arco inteiro
        for (let v = -cfg.radius; v <= cfg.radius; v += 1) {
          const along = arcAlong(cfg, v);
          const p = framePoint(c, frame, along, v, 0);
          for (let y = ground; y <= ground + cfg.carveUp; y++) {
            komamuraBreak(ledger, dim, Math.floor(p.x), y, Math.floor(p.z), seen);
          }
        }
        return;
      }
      // corte em pe: o fio do arco, um pouco abaixo do chao ate carveUp
      for (let v = -cfg.radius; v <= cfg.radius; v += 1) {
        const along = arcAlong(cfg, v);
        for (let l = -cfg.carveWidth; l <= cfg.carveWidth; l += 1) {
          const p = framePoint(c, frame, along, v, l);
          if (p.y < ground - cfg.carveDepth || p.y > ground + cfg.carveUp) continue;
          komamuraBreak(ledger, dim, Math.floor(p.x), Math.floor(p.y), Math.floor(p.z), seen);
        }
      }
      if (travelled - lastBlast >= cfg.blastEvery) {
        lastBlast = travelled;
        const v0 = ground - c.y;
        const front = arcAlong(cfg, v0);
        const at = { x: c.x + frame.dir.x * front, y: ground, z: c.z + frame.dir.z * front };
        blastVisual(dim, at, cfg.blastRadius);
        komamuraCrater(ledger, dim, at, cfg.craterRadius, seen);
        komamuraAreaHit(player, at, cfg.blastRadius, cfg.blastRadius, damage, hit, extra.afterHit);
        shakeNear(dim, at, 20, 0.3, 0.4);
      }
    },
  });
  scheduleRestore(ledger);
}

function castDestructiveSlash(player) {
  if (!tryUseSkill(player, "komamura:destructive_slash")) return;
  world.sendMessage(`§6${player.name}: §e§lDestructive Slash`);
  // o braço do gigante desce, e o corte sai da katana dele
  const l = player.location;
  const f = forwardDirection(player);
  const r = rightOf(f);
  const cfg = KOMAMURA.arm;
  spawnMyooPart(
    player,
    KOMAMURA.visual.braco,
    { x: l.x - f.x * cfg.back + r.x * cfg.side, y: l.y + cfg.up, z: l.z - f.z * cfg.back + r.z * cfg.side },
    player.getRotation().y,
    cfg.lifeTicks + 6
  );
  try {
    player.dimension.playSound("mob.wither.shoot", l, { volume: 1.6, pitch: 0.5 });
  } catch (e) {}
  system.runTimeout(() => {
    if (isDownOrGone(player) || !isKomamura(player)) return;
    carvingSlash(player, KOMAMURA.destructive, DAMAGE.destructiveSlash);
  }, cfg.strikeDelayTicks);
}

/* ---------- Giant's Shield ---------- */

const komamuraShield = new Map(); // id -> { until, part }

function komamuraShieldMultiplier(entity) {
  return (komamuraShield.get(entity?.id)?.until ?? 0) > system.currentTick ? KOMAMURA.shield.multiplier : 1;
}

function castGiantsShield(player) {
  if (!tryUseSkill(player, "komamura:giants_shield")) return;
  const cfg = KOMAMURA.shield;
  world.sendMessage(`§6${player.name}: §e§lGiant's Shield`);
  const part = spawnMyooPart(player, KOMAMURA.visual.guarda, player.location, player.getRotation().y, cfg.durationTicks);
  komamuraShield.set(player.id, { until: system.currentTick + cfg.durationTicks, part });
  try {
    player.dimension.playSound("random.anvil_land", player.location, { volume: 1, pitch: 0.5 });
  } catch (e) {}
}

/* ---------- Ora Ora Ora! ---------- */

const komamuraOra = new Map(); // id -> { until, tick, part }

function castOraOraOra(player) {
  if (!tryUseSkill(player, "komamura:ora_ora_ora")) return;
  const cfg = KOMAMURA.ora;
  world.sendMessage(`§6${player.name}: §e§lORA ORA ORA!`);
  const part = spawnMyooPart(player, KOMAMURA.visual.punho, player.location, player.getRotation().y, cfg.durationTicks);
  komamuraOra.set(player.id, { until: system.currentTick + cfg.durationTicks, tick: 0, part, ledger: [], seen: new Set() });
}

function endOra(playerId) {
  const state = komamuraOra.get(playerId);
  if (!state) return;
  komamuraOra.delete(playerId);
  removeMyooPart(state.part);
  scheduleRestore(state.ledger);
}

/* ---------- loop: guarda e punho seguindo o Komamura ---------- */

system.runInterval(() => {
  const now = system.currentTick;
  for (const [id, state] of komamuraShield) {
    const player = world.getPlayers().find((p) => p.id === id);
    if (!player || now >= state.until || !isKomamura(player) || isDownOrGone(player)) {
      komamuraShield.delete(id);
      removeMyooPart(state.part);
      continue;
    }
    try {
      state.part?.teleport(player.location, { keepVelocity: false, rotation: { x: 0, y: player.getRotation().y } });
    } catch (e) {}
  }
  const cfg = KOMAMURA.ora;
  for (const [id, state] of komamuraOra) {
    const player = world.getPlayers().find((p) => p.id === id);
    if (!player || now >= state.until || !isKomamura(player) || isDownOrGone(player)) {
      endOra(id);
      continue;
    }
    state.tick++;
    try {
      const dim = player.dimension;
      const at = komamuraAimPoint(player, cfg.range);
      const l = player.location;
      const d = unitVector({ x: at.x - l.x, y: 0, z: at.z - l.z });
      // o punho gigante fica acima e atras do ponto, martelando ali
      const fist = { x: at.x - d.x * 4, y: at.y + 2.5, z: at.z - d.z * 4 };
      const yaw = (Math.atan2(-d.x, d.z) * 180) / Math.PI;
      state.part?.teleport(fist, { keepVelocity: false, rotation: { x: 0, y: yaw } });
      if (state.tick % cfg.everyTicks !== 0) continue;
      blastVisual(dim, at, cfg.blastRadius);
      komamuraCrater(state.ledger, dim, { x: at.x, y: at.y - 1, z: at.z }, cfg.craterRadius, state.seen);
      komamuraAreaHit(player, at, cfg.blastRadius, cfg.blastRadius + 1, DAMAGE.oraPunch, new Set());
      if (state.tick % (cfg.everyTicks * 2) === 0) shakeNear(dim, at, cfg.shakeRadius, 0.25, 0.3);
    } catch (e) {}
  }
}, 1);

/* ---------- Bankai: m1 do gigante ---------- */

const giantSweepTick = new Map();

// o golpe do gigante pega tudo na frente dele, nao so quem foi acertado
function komamuraGiantSweep(player, alreadyHit) {
  const cfg = KOMAMURA.giantM1;
  const now = system.currentTick;
  if (now - (giantSweepTick.get(player.id) ?? -1000) < cfg.cooldownTicks) return;
  giantSweepTick.set(player.id, now);
  const o = player.location;
  const f = forwardDirection(player);
  try {
    for (let i = 0; i < 8; i++) {
      const a = -0.8 + (1.6 * i) / 7;
      const c = Math.cos(a);
      const s = Math.sin(a);
      player.dimension.spawnParticle("komamura:corte", {
        x: o.x + (f.x * c - f.z * s) * cfg.reach * 0.8,
        y: o.y + 1.5,
        z: o.z + (f.z * c + f.x * s) * cfg.reach * 0.8,
      });
    }
  } catch (e) {}
  for (const entity of player.dimension.getEntities({ location: o, maxDistance: cfg.reach })) {
    if (entity.id === player.id || entity.id === alreadyHit?.id) continue;
    try {
      if (!entity.getComponent("minecraft:health") || isDownOrGone(entity)) continue;
      const e = entity.location;
      const dx = e.x - o.x;
      const dz = e.z - o.z;
      const len = Math.hypot(dx, dz) || 1;
      if ((dx * f.x + dz * f.z) / len < cfg.arcCos || Math.abs(e.y - o.y) > 6) continue;
      dealDamage(entity, DAMAGE.myooM1 * dmgMultiplier(player), player);
    } catch (e) {}
  }
}

world.afterEvents.entityHitBlock.subscribe((ev) => {
  const player = ev.damagingEntity;
  if (!isKomamura(player) || !isAwakened(player)) return;
  try {
    const held = player.getComponent("minecraft:equippable")?.getEquipment(EquipmentSlot.Mainhand);
    if (held?.typeId !== "komamura:m1_myoo") return;
  } catch (e) {
    return;
  }
  komamuraGiantSweep(player);
});

/* ---------- Bankai: Titanic Slash, Stomp, Punch e Susano'o's Cut ---------- */

function castTitanicSlash(player) {
  if (!tryUseSkill(player, "komamura:titanic_slash")) return;
  const cfg = KOMAMURA.titanic;
  world.sendMessage(`§6§l${player.name}: §e§lTitanic Slash!`);
  try {
    player.dimension.playSound("mob.wither.shoot", player.location, { volume: 2, pitch: 0.3 });
  } catch (e) {}
  carvingSlash(player, cfg, DAMAGE.titanicSlash, {
    afterHit: (entity) => {
      try {
        entity.addEffect("slowness", cfg.slowTicks, { amplifier: cfg.slowAmplifier, showParticles: true });
      } catch (e) {}
    },
  });
}

function castSusanooCut(player) {
  if (!tryUseSkill(player, "komamura:susanoo_cut")) return;
  world.sendMessage(`§6§l${player.name}: §e§lSusano'o's Cut!`);
  try {
    player.dimension.playSound("mob.warden.sonic_boom", player.location, { volume: 2, pitch: 0.4 });
  } catch (e) {}
  shakeNear(player.dimension, player.location, 40, 0.5, 1);
  carvingSlash(player, KOMAMURA.susanoo, DAMAGE.susanooCut, { horizontal: true });
}

// pisao e soco: marcam o ponto mirado e explodem ali depois de um instante
function giantImpact(player, cfg, damage, key, label, withFist) {
  if (!tryUseSkill(player, key)) return;
  const dim = player.dimension;
  const at = komamuraAimPoint(player, cfg.range);
  world.sendMessage(`§6${player.name}: §e§l${label}`);
  let fist;
  if (withFist) {
    const l = player.location;
    const d = unitVector({ x: at.x - l.x, y: 0, z: at.z - l.z });
    const yaw = (Math.atan2(-d.x, d.z) * 180) / Math.PI;
    fist = spawnMyooPart(player, KOMAMURA.visual.punho, { x: at.x - d.x * 5, y: at.y + 3, z: at.z - d.z * 5 }, yaw, cfg.delayTicks + 8);
  }
  // a sombra do pe/punho chegando
  let tick = 0;
  const warn = system.runInterval(() => {
    tick += 2;
    try {
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        dim.spawnParticle("komamura:poeira", { x: at.x + Math.cos(a) * cfg.radius, y: at.y + 0.2, z: at.z + Math.sin(a) * cfg.radius });
      }
    } catch (e) {}
    if (tick >= cfg.delayTicks) system.clearRun(warn);
  }, 2);
  system.runTimeout(() => {
    const ledger = [];
    const seen = new Set();
    blastVisual(dim, at, cfg.radius);
    komamuraCrater(ledger, dim, { x: at.x, y: at.y - 1, z: at.z }, cfg.craterRadius, seen);
    komamuraAreaHit(player, at, cfg.radius, cfg.height, damage, new Set());
    shakeNear(dim, at, 30, 0.45, 0.6);
    scheduleRestore(ledger);
  }, cfg.delayTicks);
}

function castMyooStomp(player) {
  giantImpact(player, KOMAMURA.stomp, DAMAGE.myooStomp, "komamura:stomp", "Stomp", false);
}

function castMyooPunch(player) {
  giantImpact(player, KOMAMURA.punch, DAMAGE.myooPunch, "komamura:punch", "Punch", true);
}

/* ---------- limpeza ---------- */

function komamuraCleanup(playerId) {
  tenkenHits.delete(playerId);
  giantSweepTick.delete(playerId);
  const shield = komamuraShield.get(playerId);
  if (shield) {
    komamuraShield.delete(playerId);
    removeMyooPart(shield.part);
  }
  endOra(playerId);
  for (const part of [...komamuraVisuals.values()]) {
    if (part.ownerId === playerId) removeMyooPart(part.entity);
  }
}

/* ---------------------------------------------------------
   m1 (hit basico com a zangetsu) - particula de corte
   --------------------------------------------------------- */

// registro generico de armas m1 - facilita adicionar novos personagens
const MELEE_WEAPONS = {
  // Tenken: a cada 3 golpes o braço do Myō'ō corta a frente (125%)
  "komamura:m1_tenken": {
    baseDamage: DAMAGE.tenkenM1,
    particle: "komamura:brilho",
    dot: null,
    tenken: true,
  },
  // no Bankai o golpe e do gigante: pega tudo na frente dele
  "komamura:m1_myoo": {
    baseDamage: DAMAGE.myooM1,
    particle: "komamura:corte",
    dot: null,
    giant: true,
  },
  "unohana:m1_zanpakuto": {
    baseDamage: DAMAGE.unohanaM1,
    particle: "minecraft:crit_particle",
    dot: null,
  },
  // Ryūjin Jakka: Queimadura de 5s; no Bankai, Queimadura Infernal de 2s
  "yamamoto:m1_ryujin_jakka": {
    baseDamage: DAMAGE.yamamotoM1,
    particle: "yamamoto:chama",
    dot: null,
    burn: { seconds: 5, infernal: false },
  },
  "yamamoto:m1_zanka_no_tachi": {
    baseDamage: DAMAGE.zankaM1,
    particle: "yamamoto:brasa",
    dot: null,
    burn: { seconds: 2, infernal: true },
  },
  "dangai:m1_zangetsu": {
    baseDamage: DAMAGE.dangaiM1,
    particle: "dangai:getsuga",
    dot: null,
  },
  "aizen:m1_kyoka_suigetsu": {
    baseDamage: DAMAGE.aizenM1,
    particle: "aizen:reiatsu",
    dot: null,
  },
  // a mesma Kyōka enquanto ele esta invisivel: sem particula, que entregaria
  // onde o Aizen esta
  "aizen:m1_kyoka_oculta": {
    baseDamage: DAMAGE.aizenM1,
    particle: null,
    dot: null,
  },
  "shinji:m1_sakanade": {
    baseDamage: 75,
    particle: "shinji:gold",
    dot: null,
    animation: "slash",
  },
  "ichigo:m1_zangetsu": {
    baseDamage: DAMAGE.m1,
    particle: ["ichigo:getsuga", "ichigo:reiatsu"],
    dot: null,
  },
  "ichigo:tensa_m1": {
    baseDamage: DAMAGE.tensaM1,
    particle: ["ichigo:getsuga", "ichigo:reiatsu"],
    dot: null,
  },
  "byakuya:m1_senbonzakura": {
    baseDamage: DAMAGE.byakuyaM1,
    particle: ["sakura:leaf", "byakuya:blade"],
    dot: { perSecond: 3, seconds: 2 },
  },
  "byakuya:m1_senbonzakura_senkei": {
    baseDamage: DAMAGE.byakuyaSenkeiM1,
    particle: ["sakura:leaf", "byakuya:blade"],
    dot: null,
    awardsAwakening: false,
  },
  "byakuya:m1_senbonzakura_finisher": {
    baseDamage: DAMAGE.byakuyaFinisher,
    particle: ["sakura:leaf", "byakuya:blade"],
    dot: null,
    awardsAwakening: false,
    onHit: "finisher",
  },
  "kenpachi:m1_zanpakuto": {
    baseDamage: DAMAGE.kenpachiM1,
    particle: ["kenpachi:slash", "kenpachi:spark"],
    dot: null,
  },
  "grimmjow:m1_zanpakuto": {
    baseDamage: DAMAGE.grimmjowM1,
    particle: "grimmjow:cero",
    dot: null,
  },
  "grimmjow:m1_garras": {
    baseDamage: DAMAGE.garras,
    particle: "grimmjow:cero",
    dot: null,
  },
  "ulquiorra:m1_zanpakuto": {
    baseDamage: DAMAGE.ulquiorraM1,
    particle: "ulquiorra:oscuras",
    dot: null,
  },
  "ulquiorra:m1_garras": {
    baseDamage: DAMAGE.garrasMurcielago,
    particle: "ulquiorra:oscuras",
    dot: null,
  },
  "aaroniero:m1": {
    baseDamage: DAMAGE.aaronieroM1,
    particle: "mayuri:poison_fog",
    dot: null,
  },
  "aaroniero:m1_glotoneria": {
    baseDamage: DAMAGE.aaronieroAwkM1,
    particle: "mayuri:poison_fog",
    dot: null,
  },
  "mayuri:m1_ashisogi_jizo": {
    baseDamage: DAMAGE.mayuriM1,
    particle: ["mayuri:poison_fog", "mayuri:blade"],
    dot: null,
    // a cada 5 acertos a lamina "corta os tendoes"
    combo: {
      everyHits: 5,
      effect: "slowness",
      amplifier: 1, // Lentidão II
      durationTicks: 20, // 1s
      message: "§5Ashisogi Jizō cortou os tendões!",
    },
  },
  "yammy:m1_punches": {
    baseDamage: DAMAGE.yammyM1,
    particle: "yammy:wrath",
    dot: null,
  },
  "yammy:m1_ira": {
    baseDamage: DAMAGE.iraM1,
    particle: "yammy:wrath",
    dot: null,
  },
  "harribel:m1_zanpakuto": {
    baseDamage: DAMAGE.harribelM1,
    particle: "harribel:agua",
    dot: null,
  },
  "harribel:m1_diente": {
    baseDamage: DAMAGE.dienteM1,
    particle: "harribel:agua",
    dot: null,
  },
  "barragan:m1_zanpakuto": {
    baseDamage: DAMAGE.barraganM1,
    particle: "barragan:podridao",
    dot: null,
  },
  "barragan:m1_arrogante": {
    baseDamage: DAMAGE.arroganteM1,
    particle: "barragan:podridao",
    dot: null,
  },
  "szayel:m1_zanpakuto": {
    baseDamage: DAMAGE.szayelM1,
    particle: "szayel:esporo",
    dot: null,
  },
  "szayel:m1_fornicaras": {
    baseDamage: DAMAGE.fornicarasM1,
    particle: "szayel:esporo",
    dot: null,
  },
  "vizard:m1_bankai": {
    baseDamage: DAMAGE.vizardM1,
    particle: "minecraft:crit_particle",
    dot: null,
    animation: "slash",
  },
  "vizard:m1_vasto": {
    baseDamage: DAMAGE.vastoM1,
    particle: "vizard:cero",
    dot: null,
    // "hits explosivos": cada golpe estoura em volta do alvo
    blast: { radius: 3, damage: DAMAGE.vastoM1Blast },
    animation: "slash",
  },
  "starkk:m1_zanpakuto": {
    baseDamage: DAMAGE.starkkM1,
    particle: "minecraft:crit_particle",
    dot: null,
  },
  "starkk:m1_cuchillos": {
    baseDamage: DAMAGE.cuchillosM1,
    particle: "grimmjow:cero",
    dot: null,
  },
  "nnoitra:m1_zanpakuto": {
    baseDamage: DAMAGE.nnoitraM1,
    particle: "nnoitra:corte",
    dot: null,
  },
  "gin:m1_shinso": {
    baseDamage: DAMAGE.ginM1,
    particle: "gin:lamina",
    dot: null,
  },
  "hitsugaya:m1_hyorinmaru": {
    baseDamage: DAMAGE.hitsugayaM1,
    particle: "hitsugaya:gelo",
    dot: null,
  },
  "hitsugaya:m1_daiguren": {
    baseDamage: DAMAGE.hitsugayaBankaiM1,
    particle: "hitsugaya:gelo",
    dot: null,
  },
  "shunsui:m1_katen_kyokotsu": {
    baseDamage: DAMAGE.shunsuiM1,
    particle: "shunsui:corte",
    dot: null,
  },
  "soifon:m1_suzumebachi": {
    baseDamage: DAMAGE.soifonM1,
    particle: "soifon:rastro",
    dot: null,
  },
  "rukia:m1_zanpakuto": {
    baseDamage: DAMAGE.rukiaM1,
    particle: "rukia:gelo",
    dot: null,
  },
  "ukitake:m1_sogyo_no_kotowari": {
    baseDamage: DAMAGE.ukitakeM1,
    particle: "ukitake:hilo",
    dot: null,
  },
  "tosen:m1_suzumushi": {
    baseDamage: DAMAGE.tosenM1,
    particle: "tosen:corte",
    dot: null,
  },
  "tosen:m1_visored": {
    baseDamage: DAMAGE.tosenM1Visored,
    particle: "tosen:lamina",
    dot: null,
  },
};

function comboKeyFor(weaponId) {
  return "mv:combo_" + weaponId.replace(":", "_");
}

// conta os acertos da arma e dispara o efeito a cada N. O contador e por player
// (nao por alvo), entao trocar de alvo no meio da sequencia nao zera.
function applyMeleeCombo(player, target, weaponId, combo) {
  const key = comboKeyFor(weaponId);
  const stored = player.getDynamicProperty(key);
  const hits = (typeof stored === "number" ? stored : 0) + 1;

  if (hits < combo.everyHits) {
    player.setDynamicProperty(key, hits);
    return;
  }

  player.setDynamicProperty(key, 0);
  try {
    target.addEffect(combo.effect, combo.durationTicks, {
      amplifier: combo.amplifier,
      showParticles: true,
    });
    if (combo.message) player.sendMessage(combo.message);
  } catch (e) {
    // alvo morreu com o hit que fechou o combo
  }
}

function clearComboCounters(player) {
  for (const weaponId in MELEE_WEAPONS) {
    if (MELEE_WEAPONS[weaponId].combo) {
      player.setDynamicProperty(comboKeyFor(weaponId), 0);
    }
  }
}

world.afterEvents.entityHitEntity.subscribe((ev) => {
  const { damagingEntity, hitEntity } = ev;
  if (!damagingEntity || damagingEntity.typeId !== "minecraft:player") return;

  // preso no Teatro de Títeres: o golpe nao sai (vale pros dois lados)
  if (isFrozen(damagingEntity) || isMayuriParalyzed(damagingEntity)) return;

  // bater num clone do Aizen (ate de mao vazia) e errar o golpe
  if (hitEntity?.typeId === AIZEN.cloneType) {
    aizenCloneStruck(hitEntity, damagingEntity);
    return;
  }
  // Switch (Aizen Hōgyoku): quem esta na ilusao acerta o clone, nao o Aizen
  if (aizenSwitchIntercept(hitEntity, damagingEntity)) return;

  const equip = damagingEntity.getComponent("minecraft:equippable");
  const held = equip?.getEquipment(EquipmentSlot.Mainhand);
  if (!held) return;

  const awakened = isAwakened(damagingEntity);
  const weapon = MELEE_WEAPONS[held.typeId];

  if (held.typeId === "shinji:m1_sakanade") shinji.melee(damagingEntity);

  // Se Nigeki estiver aguardando um acerto, a Zanpakuto confirma a etapa.
  if (held.typeId === "soifon:m1_suzumebachi") {
    if (soiHandleNigekiM1(damagingEntity, hitEntity)) return;
  }

  if (weapon) {
    if (!awakened && weapon.awardsAwakening !== false) {
      addAwakening(damagingEntity, 1);
    }

    if (weapon.animation) playVizardAnimation(damagingEntity, weapon.animation);

    const dim = damagingEntity.dimension;
    const dir = forwardDirection(damagingEntity);
    const loc = damagingEntity.location;
    for (let i = -2; i <= 2 && weapon.particle; i++) {
      const p = {
        x: loc.x + dir.x * 1.2 - dir.z * (i * 0.2),
        y: loc.y + 1 + Math.cos(i) * 0.15,
        z: loc.z + dir.z * 1.2 + dir.x * (i * 0.2),
      };
      // weapon.particle pode ser uma unica particula ou uma lista, alternando
      // uma por posicao do leque (corte + brilho, por exemplo)
      const particleName = Array.isArray(weapon.particle)
        ? weapon.particle[(i + 2) % weapon.particle.length]
        : weapon.particle;
      try {
        dim.spawnParticle(particleName, p);
      } catch (e) {
        // particula invalida nao deve travar o hit
      }
    }

    if (hitEntity.getComponent("minecraft:health")) {
      // TODO o dano do m1 agora vem daqui - o item tem minecraft:damage = 0,
      // entao passa certinho pela escala de vida virtual do alvo (dealDamage)
      // em vez de sair direto da engine como dano real fixo
      let baseDamage = weapon.baseDamage;
      if (
        held.typeId === "nnoitra:m1_zanpakuto" &&
        getActiveCharacter(damagingEntity)?.id === "nnoitra" &&
        isAwakened(damagingEntity)
      ) {
        baseDamage = DAMAGE.nnoitraResM1;
      }
      if (
        held.typeId === "ulquiorra:m1_garras" &&
        getActiveCharacter(damagingEntity)?.id === "ulquiorra" &&
        isTrueForm(damagingEntity)
      ) {
        baseDamage = 70;
      }
      // Kyōka Suigetsu: marca o alvo, e o golpe muda na ilusao e no Betrayal
      const kyokaStrike = isKyoka(held.typeId) ? aizenKyokaStrike(damagingEntity, hitEntity) : null;
      if (kyokaStrike) baseDamage = kyokaStrike.damage;
      const totalDamage = baseDamage * dmgMultiplier(damagingEntity);
      try {
        dealDamage(hitEntity, totalDamage, damagingEntity);
      } catch (e) {
        // ignora
      }
      if (kyokaStrike) aizenAfterKyokaStrike(damagingEntity, hitEntity, kyokaStrike);
      // Counter: m1 seguidos no Aizen
      aizenCountHit(hitEntity, damagingEntity);
      if (weapon.dot) {
        applyDot(hitEntity, damagingEntity, weapon.dot.perSecond, weapon.dot.seconds);
      }
      if (weapon.burn) applyBurn(hitEntity, damagingEntity, weapon.burn.seconds, weapon.burn.infernal);
      if (weapon.tenken) komamuraTenkenHit(damagingEntity);
      if (weapon.giant) komamuraGiantSweep(damagingEntity, hitEntity);
      // m1 com estouro (o Zangetsu do Vasto Lorde)
      if (weapon.blast) {
        try {
          const loc = hitEntity.location;
          for (let i = 0; i < 6; i++) {
            dim.spawnParticle("minecraft:large_explosion", {
              x: loc.x + (Math.random() - 0.5) * 2,
              y: loc.y + 1 + (Math.random() - 0.5) * 1.5,
              z: loc.z + (Math.random() - 0.5) * 2,
            });
          }
          damageNearbyEntities(
            damagingEntity,
            { x: loc.x, y: loc.y + 1, z: loc.z },
            weapon.blast.radius,
            weapon.blast.damage
          );
        } catch (e) {
          // o proprio golpe pode ter matado o alvo neste tick
        }
      }

      tryLaMuerteTouch(damagingEntity, hitEntity);
      tryGabrielMark(damagingEntity, hitEntity);
      if (weapon.combo) {
        applyMeleeCombo(damagingEntity, hitEntity, held.typeId, weapon.combo);
      }
    }

    if (weapon.onHit === "finisher") {
      finishByakuyaSuper(damagingEntity);
    }
  } else if (ITEM_OWNER[held.typeId]) {
    if (!awakened) addAwakening(damagingEntity, 1);
  }
});

/* ---------------------------------------------------------
   Dash universal: agachar + pular
   --------------------------------------------------------- */

const wasSneakJumping = new Map();

system.runInterval(() => {
  const now = system.currentTick;
  for (const player of world.getPlayers()) {
    const character = getActiveCharacter(player);
    if (!character) continue;
    if (trappingZoneFor(player)) continue;
    // perna cortada pelo Teatro de Títeres: sem dash
    if (player.getDynamicProperty(DP.legCut)) continue;
    if (isFrozen(player)) continue;
    // Ice Age do Hitsugaya: sem dash por um tempo
    if (onCooldown(player, DP.noDash, HITSUGAYA.iceAge.noDashTicks, now)) continue;

    const vel = player.getVelocity();
    const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    // exige que seja um pulo "puro" (pouca velocidade horizontal) pra nao confundir
    // com o impulso recebido ao tomar um hit/knockback enquanto agachado
    const justJumped =
      player.isSneaking && vel.y > 0.28 && horizontalSpeed < 0.3;
    const wasAlready = wasSneakJumping.get(player.id) ?? false;

    if (justJumped && !wasAlready) {
      if (!onCooldown(player, DP.dashCd, dashCooldownFor(player), now)) {
        setCooldown(player, DP.dashCd, now);

        // o Vasto Lorde nao avanca: ele aparece em cima do alvo
        const teleportTarget =
          activeFormOf(player)?.dashTeleports || character.dashTeleports
            ? nearestTarget(player, DASH_TELEPORT_RANGE)
            : undefined;

        if (teleportTarget) {
          try {
            const to = teleportTarget.location;
            const dir = directionToward(player.location, to);
            player.teleport(
              { x: to.x - dir.x * 1.4, y: to.y, z: to.z - dir.z * 1.4 },
              { keepVelocity: false, facingLocation: to }
            );
            player.dimension.playSound("mob.endermen.portal", to, {
              volume: 1,
              pitch: 0.8,
            });
          } catch (e) {}
        } else {
          const dir = forwardDirection(player);
          player.applyKnockback(
            { x: dir.x * DASH_HORIZONTAL_STRENGTH, z: dir.z * DASH_HORIZONTAL_STRENGTH },
            DASH_VERTICAL_STRENGTH
          );
          player.dimension.playSound("mob.enderdragon.flap", player.location, {
            volume: 0.8,
            pitch: 1.6,
          });
        }
      }
    }
    wasSneakJumping.set(player.id, justJumped);
  }
}, 2);

/* ---------------------------------------------------------
   Contencao do Senkei: empurra de volta qualquer um que tente fugir
   --------------------------------------------------------- */

system.runInterval(() => {
  for (const zone of activeZones) {
    if (zone.traps) containZone(zone);
    if (!zone.blocksRegen) continue;

    const inside = new Set();
    for (const entity of zone.dimension.getEntities({
      location: zone.center,
      maxDistance: zone.radius,
    })) {
      if (!zone.blocksOwnerSkills && entity.id === zone.ownerId) continue;
      inside.add(entity.id);
      try {
        entity.removeEffect("regeneration");
        zone.stripped?.add(entity.id);
      } catch (e) {}
    }

    // quem saiu da area recupera a regeneracao na hora. Sem isso so o fim da
    // zona devolvia, e quem fugisse ficava ate 20s sem regenerar.
    if (!zone.stripped) continue;
    for (const id of [...zone.stripped]) {
      if (inside.has(id)) continue;
      zone.stripped.delete(id);
      const escapee = world.getPlayers().find((p) => p.id === id);
      if (!escapee) continue;
      try {
        reapplyFormEffects(escapee);
      } catch (e) {}
    }
  }
}, 4);

/* ---------------------------------------------------------
   Carregamento do Senkei: agachado segurando a m1 base por 5s
   --------------------------------------------------------- */

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const character = getActiveCharacter(player);
    // so o Byakuya carrega Senkei; outros supers nao tem pose de carregamento
    if (!character?.superAttack?.senkei) continue;
    if (getByakuyaWeaponState(player) !== "base") {
      resetSenkeiCharge(player);
      continue;
    }

    const inv = getInv(player);
    const held = inv.getItem(0);
    const holdingBaseM1 =
      held && held.typeId === character.superAttack.triggerItem;

    if (player.isSneaking && holdingBaseM1) {
      const current = (senkeiChargeTicks.get(player.id) ?? 0) + 4;
      senkeiChargeTicks.set(player.id, current);

      if (
        current >= character.superAttack.chargeTicksForSenkei &&
        !senkeiChargeReady.has(player.id)
      ) {
        senkeiChargeReady.add(player.id);
        // circulo de folhas de sakura no chao ao redor do player
        const loc = player.location;
        for (let i = 0; i < 20; i++) {
          const angle = (i / 20) * Math.PI * 2;
          const p = {
            x: loc.x + Math.cos(angle) * 2.2,
            y: loc.y + 0.1,
            z: loc.z + Math.sin(angle) * 2.2,
          };
          try {
            player.dimension.spawnParticle("sakura:leaf", p);
          } catch (e) {}
        }
        player.sendMessage(
          "§d§lSenkei carregado! Use a Senbonzakura pra ativar."
        );
      } else if (senkeiChargeReady.has(player.id) && current % 20 === 0) {
        // mantem o circulo pulsando enquanto o player segura a pose
        const loc = player.location;
        for (let i = 0; i < 10; i++) {
          const angle = Math.random() * Math.PI * 2;
          const p = {
            x: loc.x + Math.cos(angle) * 2.2,
            y: loc.y + 0.1,
            z: loc.z + Math.sin(angle) * 2.2,
          };
          try {
            player.dimension.spawnParticle("sakura:leaf", p);
          } catch (e) {}
        }
      }
    } else {
      resetSenkeiCharge(player);
    }
  }
}, 4);

/* ---------------------------------------------------------
   Carregamento do Visored (Tosen): agachado segurando a Suzumushi
   base por 5s. Diferente do Awakening normal, isso nao depende do
   medidor - e um gatilho proprio, independente.
   --------------------------------------------------------- */

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const character = getActiveCharacter(player);
    if (character?.id !== "tosen" || isTosenVisored(player)) {
      if (tosenVisoredCharge.has(player.id) || tosenVisoredReady.has(player.id)) {
        resetTosenVisoredCharge(player);
      }
      continue;
    }

    const inv = getInv(player);
    const held = inv.getItem(0);
    const holdingBaseM1 = held && held.typeId === "tosen:m1_suzumushi";

    if (player.isSneaking && holdingBaseM1) {
      const current = (tosenVisoredCharge.get(player.id) ?? 0) + 4;
      tosenVisoredCharge.set(player.id, current);

      if (current >= TOSEN_VISORED.chargeTicksNeeded && !tosenVisoredReady.has(player.id)) {
        tosenVisoredReady.add(player.id);
        player.sendMessage("§8§lA máscara está pronta. Use a Suzumushi pra se transformar.");
        try {
          player.dimension.playSound("mob.wither.spawn", player.location, { volume: 0.6, pitch: 1.7 });
          for (let i = 0; i < 10; i++) {
            const a = Math.random() * Math.PI * 2;
            player.dimension.spawnParticle("tosen:onda", {
              x: player.location.x + Math.cos(a) * 1.4,
              y: player.location.y + 1,
              z: player.location.z + Math.sin(a) * 1.4,
            });
          }
        } catch (e) {}
      }
    } else {
      resetTosenVisoredCharge(player);
    }
  }
}, 4);

/* ---------------------------------------------------------
   Teatro de Títeres: segura quem esta preso, mantem a mutilacao
   e devolve tudo quando um dos dois cai. E o Gabriel renasce aqui.
   --------------------------------------------------------- */

system.runInterval(() => {
  // segura quem esta preso no Teatro
  for (const player of world.getPlayers()) {
    if (!isFrozen(player)) continue;
    try {
      player.addEffect("slowness", 40, { amplifier: 255, showParticles: false });
    } catch (e) {}
  }

  for (let i = activeMutilations.length - 1; i >= 0; i--) {
    const entry = activeMutilations[i];

    // "vale ate um dos dois cair": qualquer um dos lados encerra
    if (isDownOrGone(entry.owner) || isDownOrGone(entry.victim)) {
      liftMutilation(i);
      continue;
    }

    // a cegueira e reaplicada de proposito: qualquer darkness curta de outra
    // skill substituiria a permanente e devolveria a visao antes da hora
    if (entry.kind === "eyes") {
      try {
        entry.victim.addEffect("darkness", 200, { amplifier: 0, showParticles: false });
      } catch (e) {}
    }
  }

  for (const player of world.getPlayers()) {
    tryGabrielRebirth(player);
  }
}, 20);

/* ---------------------------------------------------------
   Aura da forma: anel de reiatsu em volta de quem esta numa
   forma que pede aura (o Vasto Lorde)
   --------------------------------------------------------- */

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const aura = activeFormOf(player)?.aura;
    if (!aura) continue;

    try {
      const loc = player.location;
      // o raio pulsa: aura de raio fixo parece anel parado
      const pulse = 0.75 + Math.sin(system.currentTick / 7) * 0.25;
      for (let i = 0; i < aura.perTick; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = aura.radius * pulse * (0.7 + Math.random() * 0.3);
        player.dimension.spawnParticle(aura.particle, {
          x: loc.x + Math.cos(angle) * dist,
          y: loc.y + Math.random() * aura.height,
          z: loc.z + Math.sin(angle) * dist,
        });
      }
      // e uma coluna subindo no meio
      player.dimension.spawnParticle(aura.particle, {
        x: loc.x + (Math.random() - 0.5) * 0.5,
        y: loc.y + aura.height * Math.random(),
        z: loc.z + (Math.random() - 0.5) * 0.5,
      });
    } catch (e) {}
  }
}, 2);

/* ---------------------------------------------------------
   Guarda: desenha o escudo e derruba o bloqueio no fim do prazo
   (e no fim do prazo que o cooldown comeca a contar)
   --------------------------------------------------------- */

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    if (!isBlocking(player)) {
      if (blockingNow.has(player.id)) endBlock(player, "expired");
      continue;
    }
    blockingNow.add(player.id);

    try {
      const loc = player.location;
      const dir = forwardDirection(player);
      for (let i = 0; i < 4; i++) {
        const angle = (i / 4) * Math.PI * 2 + system.currentTick / 5;
        player.dimension.spawnParticle("minecraft:crit_particle", {
          x: loc.x + dir.x * 0.9 + Math.cos(angle) * 0.55,
          y: loc.y + 1.1 + Math.sin(angle) * 0.55,
          z: loc.z + dir.z * 0.9 + Math.cos(angle) * 0.55,
        });
      }
    } catch (e) {}
  }
}, 4);

/* ---------------------------------------------------------
   Individualidade do Mayuri + veneno próprio
   --------------------------------------------------------- */
system.runInterval(()=>{
  const now=system.currentTick;
  for(const player of world.getPlayers()){
    // Paralisia do Envenenar: a marca fica no ALVO (o Szayelaporro), entao a
    // checagem vale pra qualquer personagem. Antes ela ficava depois do
    // "continue" que so deixava passar o Mayuri, e por isso nunca paralisava.
    if(isMayuriParalyzed(player)){
      try{
        dealDamage(player, 20, player);
        player.addEffect("slowness",40,{amplifier:255,showParticles:false});
        holdJump(player,40);
        const x=player.getDynamicProperty(DP.mayuriParalysisX),y=player.getDynamicProperty(DP.mayuriParalysisY),z=player.getDynamicProperty(DP.mayuriParalysisZ);
        if([x,y,z].every(v=>typeof v==="number")) player.teleport({x,y,z},{keepVelocity:false});
      }catch(e){}
    }
    const c=getActiveCharacter(player);
    if(c?.id!=="mayuri") continue;
    const last=player.getDynamicProperty("mv:mayuri_regen_tick");
    if(typeof last!=="number" || now-last>=200){
      player.setDynamicProperty("mv:mayuri_regen_tick",now);
      const hp=player.getComponent("minecraft:health");
      if(hp){const scale=healthScaleOf(player);hp.setCurrentValue(Math.min(hp.effectiveMax,hp.currentValue+50/scale));}
    }
  }
  for(const [id,e] of activeMayuriPoisons){
    try{
      const hp=e.entity.getComponent("minecraft:health");
      if(!hp || hp.currentValue<=0 || now>=e.endTick){activeMayuriPoisons.delete(id);continue;}
      dealDamage(e.entity,e.damagePerSecond,e.source);
      const l=e.entity.location;
      for(let i=0;i<4;i++) e.entity.dimension.spawnParticle("mayuri:poison_fog",{x:l.x+(Math.random()-.5)*.8,y:l.y+.4+Math.random()*1.6,z:l.z+(Math.random()-.5)*.8});
    }catch(err){activeMayuriPoisons.delete(id);}
  }
},20);

/* ---------------------------------------------------------
   Máscara do Kaien: expiração
   --------------------------------------------------------- */
system.runInterval(() => {
  for (const player of world.getPlayers()) {
    if (getActiveCharacter(player)?.id !== "aaroniero") continue;
    const end = readTickDeadline(player, DP.aaronieroMaskEnd, 240);
    if (system.currentTick >= end && player.getDynamicProperty(DP.aaronieroMaskEnd)) {
      player.setDynamicProperty(DP.aaronieroMaskEnd, 0);
      const c = getActiveCharacter(player);
      if (c) {
        const f = activeFormOf(player, c);
        applyCharacterEffects(
          player,
          f?.health ?? c.health,
          f?.speedAmplifier ?? BASE_SPEED_AMPLIFIER,
          "regenAmplifier" in (f ?? {}) ? f.regenAmplifier : REGEN_AMPLIFIER,
          f?.extraEffects
        );
      }
      player.sendMessage("§7A Máscara do Kaien terminou.");
    }
  }
}, 5);

/* ---------------------------------------------------------
   Actionbar (saude + awakening) - sempre visivel
   --------------------------------------------------------- */

const lastActionBar = new Map();

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const hp = player.getComponent("minecraft:health");
    if (!hp) continue;
    // acima do teto do Bedrock a vida e virtual: a actionbar mostra o numero
    // configurado, nao o pool real
    const scale = healthScaleOf(player);
    const current = Math.max(0, Math.round(hp.currentValue * scale));
    const max = Math.round(hp.effectiveMax * scale);
    const awakening = getAwakening(player);
    const awakenedTag = isAwakened(player) ? " §d✦AWAKENING" : "";
    const weaponState = getByakuyaWeaponState(player);
    const senkeiTag =
      weaponState === "senkei"
        ? " §4✦SENKEI"
        : weaponState === "finisher"
        ? " §c✦GOLPE FINAL"
        : senkeiChargeReady.has(player.id)
        ? " §d✦carregado"
        : "";

    const blockTag = isBlocking(player) ? " §a🛡 GUARDA" : "";
    const hierroTag = isHierro(player) ? " §7🛡 HIERRO" : "";

    // quem nao tem awakening nem super ataque (o Nnoitra) nao ganha medidor
    const character = getActiveCharacter(player);
    const canAwaken = !character || !!character.awakening || !!character.superAttack;
    let awakeningPart = canAwaken
      ? `   §b⚡ Awakening: ${awakening}%${awakenedTag}${senkeiTag}`
      : "";
    if (character?.id === "aizen_hogyoku") {
      const resist = Number(player.getDynamicProperty(DP.monsterResist)) || 0;
      awakeningPart = isAwakened(player)
        ? `   §5✦ Metamorfose${resist ? ` §d-${Math.round(resist * HOGYOKU.monsterResist.step * 100)}% dano` : ""}`
        : `   §5🧬 Evolution: ${evolutionOf(player)}%${hogyokuCocoons.has(player.id) ? " §d✦casulo" : ""}`;
    }

    // so manda pro cliente quando o texto muda (ou a cada 1,5s pra nao sumir)
    const barText =
      `§c❤ ${current}/${max}${awakeningPart}${hierroTag}${blockTag}` +
      (character?.id === "shinji" ? shinji.hud(player) : "");
    const lastBar = lastActionBar.get(player.id);
    const barNow = system.currentTick;
    if (!lastBar || lastBar.text !== barText || barNow - lastBar.tick >= 30) {
      player.onScreenDisplay.setActionBar(barText);
      lastActionBar.set(player.id, { text: barText, tick: barNow });
    }
  }
}, 5);

/* ---------------------------------------------------------
   Travar itens: seletor sempre no slot 8, itens do personagem
   sempre nos slots designados enquanto o personagem tiver ativo
   --------------------------------------------------------- */

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const inv = getInv(player);
    forceGiveLockedItem(inv, SELECTOR_SLOT, SELECTOR_ITEM);

    const character = getActiveCharacter(player);

    // roda mesmo sem personagem: e assim que a peca sobrando some da mochila
    sweepFormArmor(player, mugetsuArmorOf(player) ?? activeFormOf(player, character)?.armorPiece);

    if (!character) continue;

    const activeItems = getActiveItemsForPlayer(player, character);

    for (const slot in activeItems) {
      forceGiveLockedItem(inv, Number(slot), activeItems[slot]);
    }

    // o marcador da offhand precisa continuar la: e ele que segura a escala
    const marker = character.awakening?.offhandMarker;
    if (marker && isAwakened(player)) setOffhandMarker(player, marker);
  }
}, 10);

// impede que os itens travados sejam dropados (Q)
world.afterEvents.entitySpawn.subscribe((ev) => {
  const entity = ev.entity;
  if (entity.typeId !== "minecraft:item") return;
  const itemComp = entity.getComponent("minecraft:item");
  if (!itemComp) return;
  const typeId = itemComp.itemStack.typeId;

  if (typeId === SELECTOR_ITEM || ITEM_OWNER[typeId]) {
    entity.remove();
  }
});

/* ---------------------------------------------------------
   Cura em bloco da forma desperta (a Ira do Yammy)
   --------------------------------------------------------- */

// contador por sessao: nao vale gravar em dynamic property porque o tick
// reinicia com o mundo
const formHealTicks = new Map();

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const heal = activeFormOf(player)?.healPerInterval ?? (isTosenVisored(player) ? TOSEN_VISORED.healPerInterval : undefined);

    if (!heal) {
      formHealTicks.delete(player.id);
      continue;
    }

    const elapsed = (formHealTicks.get(player.id) ?? 0) + 20;
    if (elapsed < heal.ticks) {
      formHealTicks.set(player.id, elapsed);
      continue;
    }
    formHealTicks.set(player.id, 0);

    try {
      const hp = player.getComponent("minecraft:health");
      if (!hp) continue;
      // a cura e em vida VIRTUAL: divide pela escala igual o dealDamage faz
      const gain = heal.amount / healthScaleOf(player);
      hp.setCurrentValue(Math.min(hp.effectiveMax, hp.currentValue + gain));
    } catch (e) {
      formHealTicks.delete(player.id);
    }
  }
}, 20);

/* ---------------------------------------------------------
   Camera alta: reposiciona toda hora pra acompanhar o player
   --------------------------------------------------------- */

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    let on;
    try {
      on = player.getDynamicProperty(DP.tallView);
    } catch (e) {
      continue;
    }
    if (!on) continue;

    // se saiu da forma desperta, a camera volta ao normal sozinha
    if (!isAwakened(player) || !getActiveCharacter(player)?.awakening?.tallView) {
      disableTallView(player);
      continue;
    }

    const cfg = getActiveCharacter(player).awakening.tallView;
    try {
      const loc = player.location;
      const view = player.getViewDirection();
      player.camera.setCamera("minecraft:free", {
        location: {
          x: loc.x - view.x * cfg.back,
          y: loc.y + cfg.height,
          z: loc.z - view.z * cfg.back,
        },
        facingLocation: {
          x: loc.x + view.x * 10,
          y: loc.y + 1 + view.y * 10,
          z: loc.z + view.z * 10,
        },
      });
    } catch (e) {
      // API de camera indisponivel: desliga em vez de insistir todo tick
      disableTallView(player);
    }
  }
}, 2);

/* ---------------------------------------------------------
   Segunda fase do awakening: a vida caindo ate o limite vira
   a forma verdadeira sozinha (o Vasto Lorde do Ichigo Vizard)
   --------------------------------------------------------- */

system.runInterval(() => {
  // Apenas o Vasto Lorde do Ichigo Vizard usa ascensão automática por vida.
  // A Segunda Etapa do Ulquiorra é EXCLUSIVAMENTE manual: 50% de Awakening +
  // agachar + usar a M1 da Resurrección.
  for (const player of world.getPlayers()) {
    if (!isAwakened(player) || isTrueForm(player)) continue;

    const character = getActiveCharacter(player);
    if (character?.id !== "ichigo_vizard") continue;

    const form = character.awakening;
    const trueForm = form?.trueForm;
    if (!trueForm || typeof trueForm.healthThreshold !== "number") continue;

    try {
      if (virtualHealth(player) > trueForm.healthThreshold) continue;
      ascendToTrueForm(player, character, form);
    } catch (e) {
      // player saiu do mundo entre a checagem e a ascensao
    }
  }
}, 10);

/* ---------------------------------------------------------
   Drena o awakening 1%/segundo enquanto ativo, desativa em 0%
   --------------------------------------------------------- */

// Awk infinito pra quem tem SUPER (nao se transforma): o medidor volta pra 100% logo
// depois de usar
system.runInterval(() => {
  for (const player of world.getPlayers()) {
    try {
      if (!isInfiniteAwakening(player) || isAwakened(player)) continue;
      if (getActiveCharacter(player)?.superAttack && getAwakening(player) < 100) {
        player.setDynamicProperty(DP.awakening, 100);
      }
    } catch (e) {}
  }
}, 5);

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    if (!isAwakened(player)) continue;
    // Metamorfose do Aizen Hōgyoku: dura ate morrer ou desativar
    if (getActiveCharacter(player)?.awakening?.permanent) continue;

    if (isInfiniteAwakening(player)) {
      player.setDynamicProperty(DP.awakening, 100);
      continue;
    }

    const current = getAwakening(player);
    const next = Math.max(0, current - 1);
    player.setDynamicProperty(DP.awakening, next);

    if (next <= 0) {
      revertAwakening(player, "drained");
    }
  }
}, 20);

/* ---------------------------------------------------------
   Saida do mundo: limpa estado preso ao playerId
   (sem isso, um Byakuya que desconecta no meio do Senkei
   deixa a arena aberta prendendo todo mundo pra sempre)
   --------------------------------------------------------- */

/* ---------------------------------------------------------
   Black concrete das habilidades (ex: esfera da bankai do Tosen)
   e inquebravel: cancela o break se o bloco pertence a algum
   ledger ativo (iceRegistry). Se por algum motivo ele ja tiver
   sumido do ledger mas ainda for black_concrete "orfao", nao
   mexe - so protege o que esta de fato marcado como temporario.
   --------------------------------------------------------- */

// blocos de skill que ninguem quebra enquanto o livro-caixa estiver aberto:
// a Enma Kōrogi e a Kurohitsugi (concreto preto) e o casulo do Hōgyoku (branco)
const LEDGER_PROTECTED_BLOCKS = new Set(["minecraft:black_concrete", "minecraft:white_concrete"]);

world.beforeEvents.playerBreakBlock.subscribe((ev) => {
  try {
    const block = ev.block;
    if (!block || !LEDGER_PROTECTED_BLOCKS.has(block.typeId)) return;
    const dim = ev.dimension;
    const { x, y, z } = block.location;
    for (const ledger of iceRegistry) {
      for (const e of ledger) {
        if (e.done || e.dim !== dim) continue;
        if (e.x === x && e.y === y && e.z === z) {
          ev.cancel = true;
          return;
        }
      }
    }
  } catch (err) {}
});

world.afterEvents.playerLeave.subscribe((ev) => {
  const playerId = ev.playerId;
  removeZonesOwnedBy(playerId);
  removeCursesBy(playerId);
  warnedOffhand.delete(playerId);
  warnedArmor.delete(playerId);
  soiClearNigeki(playerId);
  shinji.cleanupId(playerId);
  blockingNow.delete(playerId);
  removeMutilationsBy(playerId);
  gabrielHosts.delete(playerId);
  senkeiChargeTicks.delete(playerId);
  senkeiChargeReady.delete(playerId);
  wasSneakJumping.delete(playerId);
  formHealTicks.delete(playerId);
  lastActionBar.delete(playerId);
  lastArmorSweepTick.delete(playerId);
  resetTosenVisoredChargeId(playerId);
  tosenOldHelmet.delete(playerId);
  aizenCleanup(playerId);
  dangaiCleanupId(playerId);
  jumpLockUntil.delete(playerId);
  yamamotoCleanup(playerId);
  burns.delete(playerId);
  unohanaCleanup(playerId, true);
  unohanaHeals.delete(playerId);
  clearDots(playerId);
  komamuraCleanup(playerId);
});


const shinji = createShinji({
  getActiveCharacter, getAwakening, isAwakened, addAwakening,
  activateAwakening, revertAwakening, reapplyFormEffects,
  dealDamage, dmgMultiplier, entitiesInFrontBox, nearestTarget,
  isFrozen, trappingZoneFor, skillBlockingZoneFor, isRespiring, showRespiraGuard,
});

/* ---------------------------------------------------------
   Registro exposto pra simulacao
   --------------------------------------------------------- */
// sim/run.mjs le os numeros daqui em vez de copiar: rebalancear nao quebra a
// simulacao, e ela continua provando que o numero configurado e o que chega no
// alvo. No jogo ninguem importa o main.js, entao exportar nao muda nada.
export {
  CHARACTERS,
  CHARACTER_RACE_TIER,
  RACES,
  TIERS,
  DAMAGE,
  SKILL_COOLDOWN_TICKS,
  MELEE_WEAPONS,
  BLOCK,
  TOXIC_FOG,
  AIZEN,
  HOGYOKU,
  DANGAI,
  YAMAMOTO,
  TIER_DAMAGE_REDUCTION,
  UNOHANA,
  KOMAMURA,
  // efeitos negativos pro Diagnóstico da Unohana ter o que limpar na simulacao
  applyBurn,
  applyDeterioration,
  applyMayuriPoison,
  addFragility,
  freezeCooldowns,
};
