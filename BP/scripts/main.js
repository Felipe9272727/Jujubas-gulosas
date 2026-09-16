import {
  world,
  system,
  EntityDamageCause,
  ItemStack,
  EquipmentSlot,
} from "@minecraft/server";
import { ActionFormData, MessageFormData } from "@minecraft/server-ui";

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
};

const BASE_SPEED_AMPLIFIER = 1; // speed 2 pra todo personagem
const REGEN_AMPLIFIER = 1; // regen 2 pra todo personagem

// declarado antes do CHARACTERS porque o registro referencia esse valor
const HOLLOW_MASK_DURATION_TICKS = 600; // 30s

// item que fica sempre locked no ultimo slot da hotbar (slot 8)
const SELECTOR_ITEM = "multiversal:character_selector";
const SELECTOR_SLOT = 8;

// registro de personagens - estrutura pensada pra crescer com o addon
const CHARACTERS = {
  ichigo: {
    id: "ichigo",
    name: "Ichigo Kurosaki (Shikai)",
    health: 200,
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
      health: 400,
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
    health: 200,
    items: {
      0: "byakuya:m1_senbonzakura",
      1: "byakuya:tripleshot",
      2: "byakuya:disperse",
      3: "byakuya:bloodshed",
      4: "byakuya:coating",
    },
    // super ataque no lugar de uma segunda forma persistente
    superAttack: {
      triggerItem: "byakuya:m1_senbonzakura",
      chargeTicksForSenkei: 100, // 5s agachado segurando a m1 = desbloqueia o Senkei
      kageyoshi: {
        radius: 15, // area 30x30
        dotPerSecond: 30,
        durationSeconds: 15,
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
    health: 300,
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
      damageMultiplier: 1.5, // +50% em todas as skills e no m1
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
    health: 180,
    // so 3 itens: os slots 3 e 4 ficam livres ate ele ganhar mais skills
    items: {
      0: "mayuri:m1_ashisogi_jizo",
      1: "mayuri:poison_slash",
      2: "mayuri:toxic_fog",
    },
  },
};

// armas m1 alternativas do byakuya (trocadas dinamicamente, nao ficam no registro "items" fixo)
const BYAKUYA_ALT_WEAPONS = [
  "byakuya:m1_senbonzakura_senkei",
  "byakuya:m1_senbonzakura_finisher",
];

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
  }
}
for (const weaponId of BYAKUYA_ALT_WEAPONS) {
  ITEM_OWNER[weaponId] = "byakuya";
}

const HEALTH_BOOST_LEVEL_FOR = (targetMaxHealth) => {
  // health_boost amplifier 0 = +4hp (nivel 1). cada nivel extra soma +4hp.
  const extra = targetMaxHealth - 20;
  const level = Math.max(0, Math.ceil(extra / 4) - 1);
  return level;
};

const SKILL_COOLDOWN_TICKS = {
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
  "byakuya:coating": 3600,
  "kenpachi:flash_slash": 360,
  "kenpachi:stomp": 240,
  "kenpachi:hunt": 400,
  "kenpachi:hells_cut": 400, // 20% a menos que o Getsuga Tenshou (500)
  "mayuri:poison_slash": 300, // 15s
  "mayuri:toxic_fog": 600, // 30s
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
  "byakuya:coating": "Sakura's Coating",
  "kenpachi:flash_slash": "Flash Slash",
  "kenpachi:stomp": "Stomp",
  "kenpachi:hunt": "Kenpachi's Hunt",
  "kenpachi:hells_cut": "Hell's Cut",
  "mayuri:poison_slash": "Poison Slash",
  "mayuri:toxic_fog": "Toxic Fog",
};

// dano aumentado
const DAMAGE = {
  // Ichigo (Shikai) - reduzido
  m1: 8,
  slam: 26,
  slash: 38,
  run: 34,
  tenshou: 75,
  // Ichigo (Tensa Zangetsu / Bankai) - reduzido mais forte
  tensaM1: 11,
  barrage: 70,
  tenshouBankai: 130,
  nuke: 170,
  // Byakuya - aumentado
  byakuyaM1: 12,
  tripleshot: 35,
  disperse: 42,
  bloodshed: 25,
  byakuyaSenkeiM1: 22,
  byakuyaFinisher: 130,
  // Zaraki Kenpachi
  kenpachiM1: 14,
  flashSlash: 30, // por avanco, sao 3 avancos
  stomp: 45,
  hellsCut: 75, // mesmo dano do Getsuga Tenshou, metade do alcance
  // Mayuri Kurotsuchi
  mayuriM1: 8,
  poisonSlash: 20,
};

// duracao do buff de dano do Sakura's Coating - nao foi especificada, assumi 30s
const COATING_DURATION_TICKS = 600;

const SLAM_RADIUS = 4.5; // area de dano aumentada

const DASH_COOLDOWN_TICKS = 80; // 4s
const DASH_HORIZONTAL_STRENGTH = 6.5; // impulso bem maior
const DASH_VERTICAL_STRENGTH = 0.25;

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
const TOXIC_FOG = {
  radius: 5, // area 10x10
  durationTicks: 300, // 15s
  tickInterval: 10,
  refreshTicks: 30, // um pouco maior que o intervalo pro efeito nao piscar
  poisonAmplifier: 9, // poison 10
  slownessAmplifier: 2, // slowness 3
  particlesPerTick: 14,
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
}

function setCooldown(player, key, currentTick) {
  player.setDynamicProperty(key, currentTick);
}

function cdKeyForSkill(itemId) {
  return "mv:cd_" + itemId.replace(":", "_");
}

function forceGiveLockedItem(container, slot, itemId) {
  const existing = container.getItem(slot);
  if (!existing || existing.typeId !== itemId) {
    container.setItem(slot, new ItemStack(itemId, 1));
  }
}

function healToMax(player, maxHealth) {
  const hp = player.getComponent("minecraft:health");
  if (hp) {
    hp.setCurrentValue(Math.min(maxHealth, hp.effectiveMax));
  }
}

function applyCharacterEffects(player, maxHealth, speedAmplifier) {
  const level = HEALTH_BOOST_LEVEL_FOR(maxHealth);
  player.addEffect("health_boost", 20000000, {
    amplifier: level,
    showParticles: false,
  });
  player.addEffect("speed", 20000000, {
    amplifier: speedAmplifier,
    showParticles: false,
  });
  player.addEffect("regeneration", 20000000, {
    amplifier: REGEN_AMPLIFIER,
    showParticles: false,
  });
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

  // formas despertas que dao buff permanente de dano (Pressao do Kenpachi)
  const character = getActiveCharacter(player);
  const awakenedBonus = character?.awakening?.damageMultiplier;
  if (awakenedBonus && isAwakened(player)) {
    multiplier *= awakenedBonus;
  }

  return multiplier;
}

// dano ao longo do tempo generico (sangramento) - reutilizavel por qualquer personagem
function applyDot(entity, player, perSecond, totalSeconds) {
  let ticks = 0;
  const dotInterval = system.runInterval(() => {
    ticks++;
    try {
      if (entity.getComponent("minecraft:health")) {
        entity.applyDamage(perSecond * dmgMultiplier(player), {
          cause: EntityDamageCause.entityAttack,
          damagingEntity: player,
        });
      }
    } catch (e) {
      system.clearRun(dotInterval);
      return;
    }
    if (ticks >= totalSeconds) {
      system.clearRun(dotInterval);
    }
  }, 20);
}

/* ---------------------------------------------------------
   Senkei: zonas ativas + estado da arma do Byakuya
   --------------------------------------------------------- */

// lista de zonas de Senkei ativas no mundo: { ownerId, center, radius }
const activeSenkeiZones = [];

function distance2D(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

function findSenkeiZoneAt(location) {
  for (const zone of activeSenkeiZones) {
    if (distance2D(location, zone.center) <= zone.radius) return zone;
  }
  return undefined;
}

function isInsideAnySenkeiZone(player) {
  return !!findSenkeiZoneAt(player.location);
}

function removeSenkeiZoneOwnedBy(ownerId) {
  const idx = activeSenkeiZones.findIndex((z) => z.ownerId === ownerId);
  if (idx !== -1) {
    system.clearRun(activeSenkeiZones[idx].intervalId);
    activeSenkeiZones.splice(idx, 1);
  }
}

// margem de busca em volta da arena. o scan antigo era radius + 10, e quem
// saisse alem disso entre dois ticks de contencao (dash, knockback forte,
// pearl) simplesmente nunca mais era encontrado e escapava de vez.
const SENKEI_SCAN_MARGIN = 48;

function pullBackIntoSenkei(zone, entity) {
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

// empurra de volta pra dentro da area qualquer entidade que tente sair do senkei
function containSenkeiZone(zone) {
  const nearby = zone.dimension.getEntities({
    location: zone.center,
    maxDistance: zone.radius + SENKEI_SCAN_MARGIN,
  });

  const seen = new Set();
  for (const entity of nearby) {
    seen.add(entity.id);
    pullBackIntoSenkei(zone, entity);
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
    if (escaped.includes(entity.id)) pullBackIntoSenkei(zone, entity);
  }
  for (const id of escaped) {
    if (!alive.has(id)) zone.trapped.delete(id);
  }
}

function getByakuyaWeaponState(player) {
  return player.getDynamicProperty(DP.byakuyaWeapon) ?? "base";
}

// decide quais itens devem estar travados nos slots do player nesse momento
function getActiveItemsForPlayer(player, character) {
  if (character.awakening && isAwakened(player)) {
    return character.awakening.items ?? character.items;
  }
  if (character.superAttack) {
    const weaponState = getByakuyaWeaponState(player);
    if (weaponState === "senkei") {
      return { ...character.items, 0: character.superAttack.senkei.weapon };
    }
    if (weaponState === "finisher") {
      return { ...character.items, 0: character.superAttack.senkei.finisherWeapon };
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
  clearComboCounters(player);

  applyCharacterEffects(player, character.health, BASE_SPEED_AMPLIFIER);

  const inv = getInv(player);
  for (const slot in character.items) {
    inv.setItem(Number(slot), new ItemStack(character.items[slot], 1));
  }

  system.runTimeout(() => {
    healToMax(player, character.health);
  }, 2);

  world.sendMessage(
    `§e${player.name}§r agora está usando §6${character.name}§r!`
  );
  player.sendMessage(`§aVocê ativou: §6${character.name}`);
}

function deactivateCharacter(player) {
  const character = getActiveCharacter(player);
  if (!character) return;

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
  for (const slot in activeItems) {
    const item = inv.getItem(Number(slot));
    if (item && item.typeId === activeItems[slot]) {
      inv.setItem(Number(slot), undefined);
    }
  }

  player.removeEffect("health_boost");
  player.removeEffect("speed");
  player.removeEffect("regeneration");
  player.setDynamicProperty(DP.character, undefined);
  player.setDynamicProperty(DP.awakened, false);
  player.setDynamicProperty(DP.awakening, 0);
  player.setDynamicProperty(DP.byakuyaWeapon, "base");
  clearComboCounters(player);
  removeSenkeiZoneOwnedBy(player.id);

  system.runTimeout(() => {
    const hp = player.getComponent("minecraft:health");
    if (hp) hp.setCurrentValue(Math.min(20, hp.effectiveMax));
  }, 2);

  player.sendMessage("§cPersonagem desativado. Vida normal restaurada.");
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
  applyCharacterEffects(player, health, form.speedAmplifier ?? BASE_SPEED_AMPLIFIER);

  const inv = getInv(player);
  for (const slot in items) {
    inv.setItem(Number(slot), new ItemStack(items[slot], 1));
  }

  // a cura existe pra encher o teto novo de vida (caso do Bankai). Um awakening
  // que mantem o teto nao pode virar cura de graca.
  if (health > character.health) {
    system.runTimeout(() => healToMax(player, health), 2);
  }

  world.sendMessage(`§d§l${player.name} despertou: ${form.name}!`);
  player.sendMessage(`§d§lAwakening ativado! §r§dVocê é agora ${form.name}.`);

  if (form.onActivate === "pressure") {
    activateSpiritualPressure(player, form.pressure);
  }
}

function revertAwakening(player, reason) {
  const character = getActiveCharacter(player);
  if (!character || !character.awakening) return;
  if (!isAwakened(player)) return;

  if (isMasked(player)) {
    deactivateHollowMask(player);
  }

  const hpBefore = player.getComponent("minecraft:health");
  const previousHealth = hpBefore ? hpBefore.currentValue : character.health;

  player.setDynamicProperty(DP.awakened, false);
  applyCharacterEffects(player, character.health, BASE_SPEED_AMPLIFIER);

  const inv = getInv(player);
  for (const slot in character.items) {
    inv.setItem(Number(slot), new ItemStack(character.items[slot], 1));
  }

  // mantem a vida atual do player, so limita ao novo maximo (nao cura)
  system.runTimeout(() => {
    const hp = player.getComponent("minecraft:health");
    if (hp) hp.setCurrentValue(Math.min(previousHealth, hp.effectiveMax));
  }, 2);

  player.sendMessage(
    reason === "manual"
      ? "§7Você encerrou o Awakening. Voltando à forma base."
      : "§7O Awakening acabou. Voltando à forma base."
  );
}

function tryTriggerAwakening(player) {
  const character = getActiveCharacter(player);
  if (!character || !character.awakening) return;
  if (isAwakened(player)) return;

  if (getAwakening(player) < 100) return;

  activateAwakening(player, character);
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

function openCharacterMenu(player) {
  const active = getActiveCharacter(player);

  const form = new ActionFormData()
    .title("Combates Multiversais")
    .body(
      active
        ? `Personagem atual: §6${active.name}§r\n\nDesative antes de escolher outro.`
        : "Escolha seu personagem:"
    );

  const ids = Object.keys(CHARACTERS);
  for (const id of ids) {
    form.button(CHARACTERS[id].name);
  }
  if (active) {
    form.button("§cDesativar personagem");
  }

  form.show(player).then((res) => {
    if (res.canceled || res.selection === undefined) return;

    if (active && res.selection === ids.length) {
      deactivateCharacter(player);
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

  if (initialSpawn) {
    player.runCommand("hud @s hide health");
    // o contador de ticks reinicia com o mundo, entao todo cooldown/deadline
    // gravado numa sessao anterior tem que morrer aqui
    clearSessionTimers(player);
    const inv = getInv(player);
    forceGiveLockedItem(inv, SELECTOR_SLOT, SELECTOR_ITEM);
  } else {
    // respawn depois de morrer: reaplica personagem se tinha um ativo
    // (awakening eh cancelado na morte, volta pra forma base)
    if (isAwakened(player)) {
      player.setDynamicProperty(DP.awakened, false);
    }
    player.setDynamicProperty(DP.maskEnd, 0);
    const character = getActiveCharacter(player);
    if (character) {
      applyCharacterEffects(player, character.health, BASE_SPEED_AMPLIFIER);
      system.runTimeout(() => healToMax(player, character.health), 2);
    }
  }
});

/* ---------------------------------------------------------
   Uso de itens
   --------------------------------------------------------- */

world.afterEvents.itemUse.subscribe((ev) => {
  const { source: player, itemStack } = ev;
  if (!player || player.typeId !== "minecraft:player") return;

  if (itemStack.typeId === SELECTOR_ITEM) {
    openCharacterMenu(player);
    return;
  }

  const character = getActiveCharacter(player);
  if (!character) return;

  // agachado + usar a zangetsu (m1) com awakening 100% = desperta o Awakening
  if (
    character.awakening &&
    itemStack.typeId === character.awakening.triggerItem &&
    player.isSneaking &&
    !isAwakened(player)
  ) {
    tryTriggerAwakening(player);
    return;
  }

  // agachado + usar a zangetsu bankai (tensa) com <=50 de vida = Mascara Hollow
  if (
    character.awakening?.hollowMask &&
    itemStack.typeId === character.awakening.hollowMask.triggerItem &&
    player.isSneaking &&
    isAwakened(player) &&
    !isMasked(player)
  ) {
    const hp = player.getComponent("minecraft:health");
    if (hp && hp.currentValue <= character.awakening.hollowMask.healthThreshold) {
      activateHollowMask(player, character);
    } else {
      player.sendMessage(
        `§7Você precisa estar com ${character.awakening.hollowMask.healthThreshold} de vida ou menos pra usar a Máscara Hollow.`
      );
    }
    return;
  }

  // agachado + usar a senbonzakura base com awakening 100% = Kageyoshi ou Senkei
  if (
    character.superAttack &&
    itemStack.typeId === character.superAttack.triggerItem &&
    player.isSneaking &&
    getByakuyaWeaponState(player) === "base"
  ) {
    tryTriggerByakuyaSuper(player, character);
    return;
  }

  // agachado + usar a senbonzakura do senkei = desativa a area e puxa a espada final
  if (
    character.superAttack &&
    itemStack.typeId === character.superAttack.senkei.weapon &&
    player.isSneaking &&
    getByakuyaWeaponState(player) === "senkei"
  ) {
    triggerSenkeiDeactivation(player, character);
    return;
  }

  // enquanto preso num senkei, ninguem pode usar skill - so a m1
  if (itemStack.typeId in SKILL_COOLDOWN_TICKS && isInsideAnySenkeiZone(player)) {
    player.sendMessage("§7Você está preso no Senkei! Só pode atacar com sua espada.");
    return;
  }

  switch (itemStack.typeId) {
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
    case "byakuya:coating":
      castSakuraCoating(player);
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
  }
});

/* ---------------------------------------------------------
   Skills do Ichigo
   --------------------------------------------------------- */

function tryUseSkill(player, itemId) {
  const now = system.currentTick;
  const key = cdKeyForSkill(itemId);
  let duration = SKILL_COOLDOWN_TICKS[itemId];

  const character = getActiveCharacter(player);
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
  if (!isAwakened(player)) {
    addAwakening(player, 5);
  }

  const skillName = SKILL_NAMES[itemId] ?? itemId;
  system.runTimeout(() => {
    try {
      player.sendMessage(`§a${skillName} §frecarregou e já pode ser usada de novo!`);
    } catch (e) {
      // player pode ter saido do mundo, ignora
    }
  }, duration);

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
    entity.applyDamage(finalDamage, {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: player,
    });
  }
}

function castGetsugaSlam(player) {
  if (!tryUseSkill(player, "ichigo:getsuga_slam")) return;
  const dim = player.dimension;
  const loc = player.location;

  dim.spawnParticle("minecraft:large_explosion", loc);
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

  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    const p = {
      x: origin.x + dir.x * (0.5 + t * 3),
      y: origin.y + 1 + Math.sin(t * Math.PI) * 0.6,
      z: origin.z + dir.z * (0.5 + t * 3),
    };
    dim.spawnParticle("minecraft:crit_particle", p);
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
      entity.applyDamage(finalDamage, {
        cause: EntityDamageCause.entityAttack,
        damagingEntity: player,
      });
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
  });
}

// funcao generica: dispara uma onda em formato de lua crescente pra frente
function fireCrescentWave(player, options) {
  const {
    radius,
    thickness,
    range,
    damage,
    speed = 2,
    particle = "minecraft:crit_particle",
    burst = "minecraft:large_explosion",
    rows = 12,
  } = options;

  const dim = player.dimension;
  const dir = forwardDirection(player);
  const perp = { x: -dir.z, z: dir.x };
  const origin = player.location;

  let travelled = 0;
  const hitEntities = new Set();

  const interval = system.runInterval(() => {
    for (let row = 0; row <= rows; row++) {
      const dy = -radius + (2 * radius * row) / rows;
      const outerReach = Math.sqrt(Math.max(0, radius * radius - dy * dy));
      const backLocal = -outerReach;
      const frontLocal = thickness - outerReach;

      for (let s = 0; s <= 2; s++) {
        const localX = backLocal + ((frontLocal - backLocal) * s) / 2;
        const p = {
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
    const nearby = dim.getEntities({ location: center, maxDistance: radius + 0.6 });
    for (const entity of nearby) {
      if (entity.id === player.id || hitEntities.has(entity.id)) continue;
      if (!entity.getComponent("minecraft:health")) continue;
      hitEntities.add(entity.id);
      entity.applyDamage(damage * dmgMultiplier(player), {
        cause: EntityDamageCause.entityAttack,
        damagingEntity: player,
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
    dim.spawnParticle("minecraft:crit_particle", p);
    if (i % 3 === 0) dim.spawnParticle("minecraft:large_explosion", p);
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
      damage: DAMAGE.tenshou,
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
  const interval = system.runInterval(() => {
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
        entity.applyDamage(DAMAGE.tripleshot * dmgMultiplier(player), {
          cause: EntityDamageCause.entityAttack,
          damagingEntity: player,
        });
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
    entity.applyDamage(DAMAGE.disperse * dmgMultiplier(player), {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: player,
    });
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
    entity.applyDamage(DAMAGE.bloodshed * dmgMultiplier(player), {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: player,
    });
    applyDot(entity, player, 10, 5);
  }
}

function castSakuraCoating(player) {
  if (!tryUseSkill(player, "byakuya:coating")) return;
  const now = system.currentTick;
  player.setDynamicProperty(DP.coatingEnd, now + COATING_DURATION_TICKS);

  world.sendMessage(
    `§d${player.name} §7ativou §5Sakura's Coating§7! §d(+20% de dano por 30s)`
  );
  player.dimension.playSound("random.levelup", player.location, {
    volume: 1,
    pitch: 1.4,
  });

  let elapsed = 0;
  const auraInterval = system.runInterval(() => {
    if (!isCoated(player)) {
      system.clearRun(auraInterval);
      return;
    }
    const loc = player.location;
    for (let i = 0; i < 5; i++) {
      const angle = Math.random() * Math.PI * 2;
      const p = {
        x: loc.x + Math.cos(angle) * 0.6,
        y: loc.y + Math.random() * 1.8,
        z: loc.z + Math.sin(angle) * 0.6,
      };
      try {
        player.dimension.spawnParticle("sakura:leaf", p);
      } catch (e) {}
    }
    elapsed += 10;
    if (elapsed >= COATING_DURATION_TICKS) {
      system.clearRun(auraInterval);
    }
  }, 10);
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

  // so as particulas da explosao - nenhum bloco e quebrado
  try {
    dim.spawnParticle("minecraft:large_explosion", {
      x: loc.x,
      y: loc.y + 0.2,
      z: loc.z,
    });
  } catch (e) {}
  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    try {
      dim.spawnParticle("minecraft:large_explosion", {
        x: loc.x + Math.cos(angle) * STOMP_RADIUS,
        y: loc.y + 0.2,
        z: loc.z + Math.sin(angle) * STOMP_RADIUS,
      });
    } catch (e) {}
  }

  damageNearbyEntities(player, loc, STOMP_RADIUS, DAMAGE.stomp);
}

function nearestPlayer(player, maxDistance) {
  const origin = player.location;
  let best;
  let bestDistance = Infinity;

  for (const other of player.dimension.getPlayers({ location: origin, maxDistance })) {
    if (other.id === player.id) continue;
    const dx = other.location.x - origin.x;
    const dy = other.location.y - origin.y;
    const dz = other.location.z - origin.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = other;
    }
  }

  return best;
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
    const hp = player.getComponent("minecraft:health");
    if (hp && hp.currentValue <= desperation.healthThreshold) {
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
    particle: desperate ? "minecraft:blood_particle" : "minecraft:crit_particle",
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
    try {
      dim.spawnParticle("mayuri:toxic_fog", {
        x: origin.x + dir.x * along + perp.x * lateral,
        y: origin.y + 1 + Math.sin(t * Math.PI) * 0.5,
        z: origin.z + dir.z * along + perp.z * lateral,
      });
    } catch (e) {}
  }

  const finalDamage = DAMAGE.poisonSlash * dmgMultiplier(player);
  for (const entity of entitiesInFrontBox(player, POISON_SLASH)) {
    entity.applyDamage(finalDamage, {
      cause: EntityDamageCause.entityAttack,
      damagingEntity: player,
    });
    try {
      entity.addEffect("slowness", POISON_SLASH.slownessTicks, {
        amplifier: POISON_SLASH.slownessAmplifier,
        showParticles: true,
      });
    } catch (e) {}
  }
}

function castToxicFog(player) {
  if (!tryUseSkill(player, "mayuri:toxic_fog")) return;
  const dim = player.dimension;
  const center = player.location;

  world.sendMessage(`§5${player.name} §7soltou §dToxic Fog§7!`);
  dim.playSound("mob.wither.spawn", center, { volume: 1.2, pitch: 1.7 });

  // a neblina fica onde foi solta, nao acompanha o Mayuri
  let elapsed = 0;
  const interval = system.runInterval(() => {
    for (let i = 0; i < TOXIC_FOG.particlesPerTick; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * TOXIC_FOG.radius;
      try {
        dim.spawnParticle("mayuri:toxic_fog", {
          x: center.x + Math.cos(angle) * dist,
          y: center.y + 0.2 + Math.random() * 2.2,
          z: center.z + Math.sin(angle) * dist,
        });
      } catch (e) {}
    }

    for (const entity of dim.getEntities({
      location: center,
      maxDistance: TOXIC_FOG.radius,
    })) {
      if (entity.id === player.id) continue;
      if (!entity.getComponent("minecraft:health")) continue;
      try {
        entity.addEffect("poison", TOXIC_FOG.refreshTicks, {
          amplifier: TOXIC_FOG.poisonAmplifier,
          showParticles: true,
        });
        entity.addEffect("slowness", TOXIC_FOG.refreshTicks, {
          amplifier: TOXIC_FOG.slownessAmplifier,
          showParticles: false,
        });
      } catch (e) {}
    }

    elapsed += TOXIC_FOG.tickInterval;
    if (elapsed >= TOXIC_FOG.durationTicks) {
      system.clearRun(interval);
      try {
        player.sendMessage("§7A Toxic Fog se dissipou.");
      } catch (e) {}
    }
  }, TOXIC_FOG.tickInterval);
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
          entity.applyDamage(cfg.dotPerSecond, {
            cause: EntityDamageCause.entityAttack,
            damagingEntity: player,
          });
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

    // dano de sangramento pra quem estiver na area (recalculado a cada segundo)
    const entities = dim.getEntities({ location: center, maxDistance: cfg.radius });
    for (const entity of entities) {
      if (entity.id === player.id) continue;
      if (!entity.getComponent("minecraft:health")) continue;
      entity.applyDamage(cfg.dotPerSecond * dmgMultiplier(player), {
        cause: EntityDamageCause.entityAttack,
        damagingEntity: player,
      });
    }

    elapsed++;
    if (elapsed >= cfg.durationSeconds) {
      system.clearRun(interval);
      player.sendMessage("§7Senbonzakura Kageyoshi terminou.");
    }
  }, 20);
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
      removeSenkeiZoneOwnedBy(player.id);
      try {
        player.setDynamicProperty(DP.byakuyaWeapon, "base");
        world.sendMessage(`§7O Senkei de ${player.name} se dissipou.`);
      } catch (e) {
        // dono saiu do mundo no meio do senkei: a arena ja foi removida acima
      }
    }
  }, 20);

  activeSenkeiZones.push({
    ownerId: player.id,
    center,
    radius: cfg.radius,
    dimension: dim,
    intervalId,
    trapped: new Set(),
  });
}

function tryTriggerByakuyaSuper(player, character) {
  if (getAwakening(player) < 100) return;
  if (getByakuyaWeaponState(player) !== "base") return;
  if (isInsideAnySenkeiZone(player)) return;

  const charged = senkeiChargeReady.has(player.id);
  player.setDynamicProperty(DP.awakening, 0);
  resetSenkeiCharge(player);

  if (charged) {
    activateSenkei(player, character);
  } else {
    activateKageyoshi(player, character);
  }
}

// crouch + usar a senbonzakura do senkei = desativa a area e puxa a espada final
function triggerSenkeiDeactivation(player, character) {
  removeSenkeiZoneOwnedBy(player.id);
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
  removeSenkeiZoneOwnedBy(player.id);

  try {
    player.addEffect("slowness", 200, { amplifier: 9, showParticles: false });
    player.addEffect("darkness", 200, { amplifier: 0, showParticles: false });
  } catch (e) {}

  world.sendMessage(
    `§7${player.name} usou tudo na Senbonzakura final e ficou vulnerável.`
  );
}

/* ---------------------------------------------------------
   m1 (hit basico com a zangetsu) - particula de corte
   --------------------------------------------------------- */

// registro generico de armas m1 - facilita adicionar novos personagens
const MELEE_WEAPONS = {
  "ichigo:m1_zangetsu": {
    baseDamage: DAMAGE.m1,
    particle: "minecraft:crit_particle",
    dot: null,
  },
  "ichigo:tensa_m1": {
    baseDamage: DAMAGE.tensaM1,
    particle: "minecraft:crit_particle",
    dot: null,
  },
  "byakuya:m1_senbonzakura": {
    baseDamage: DAMAGE.byakuyaM1,
    particle: "sakura:leaf",
    dot: { perSecond: 3, seconds: 2 },
  },
  "byakuya:m1_senbonzakura_senkei": {
    baseDamage: DAMAGE.byakuyaSenkeiM1,
    particle: "sakura:leaf",
    dot: null,
    awardsAwakening: false,
  },
  "byakuya:m1_senbonzakura_finisher": {
    baseDamage: DAMAGE.byakuyaFinisher,
    particle: "sakura:leaf",
    dot: null,
    awardsAwakening: false,
    onHit: "finisher",
  },
  "kenpachi:m1_zanpakuto": {
    baseDamage: DAMAGE.kenpachiM1,
    particle: "minecraft:crit_particle",
    dot: null,
  },
  "mayuri:m1_ashisogi_jizo": {
    baseDamage: DAMAGE.mayuriM1,
    particle: "mayuri:toxic_fog",
    dot: null,
    // a cada 3 acertos a lamina "corta os tendoes" e derruba a velocidade
    combo: {
      everyHits: 3,
      effect: "slowness",
      amplifier: 0, // slowness 1
      durationTicks: 60, // 3s
      message: "§5Ashisogi Jizō cortou os tendões!",
    },
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

  const equip = damagingEntity.getComponent("minecraft:equippable");
  const held = equip?.getEquipment(EquipmentSlot.Mainhand);
  if (!held) return;

  const awakened = isAwakened(damagingEntity);
  const weapon = MELEE_WEAPONS[held.typeId];

  if (weapon) {
    if (!awakened && weapon.awardsAwakening !== false) {
      addAwakening(damagingEntity, 1);
    }

    const dim = damagingEntity.dimension;
    const dir = forwardDirection(damagingEntity);
    const loc = damagingEntity.location;
    for (let i = -2; i <= 2; i++) {
      const p = {
        x: loc.x + dir.x * 1.2 - dir.z * (i * 0.2),
        y: loc.y + 1 + Math.cos(i) * 0.15,
        z: loc.z + dir.z * 1.2 + dir.x * (i * 0.2),
      };
      try {
        dim.spawnParticle(weapon.particle, p);
      } catch (e) {
        // particula invalida nao deve travar o hit
      }
    }

    if (hitEntity.getComponent("minecraft:health")) {
      // o dano base da arma vem do minecraft:damage do item, entao aqui so entra
      // o extra dos buffs ativos (Sakura's Coating, Pressao do Kenpachi, ...)
      const bonus = Math.round(weapon.baseDamage * (dmgMultiplier(damagingEntity) - 1));
      if (bonus > 0) {
        try {
          hitEntity.applyDamage(bonus, {
            cause: EntityDamageCause.entityAttack,
            damagingEntity,
          });
        } catch (e) {
          // ignora
        }
      }
      if (weapon.dot) {
        applyDot(hitEntity, damagingEntity, weapon.dot.perSecond, weapon.dot.seconds);
      }
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
    if (isInsideAnySenkeiZone(player)) continue;

    const vel = player.getVelocity();
    const horizontalSpeed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);
    // exige que seja um pulo "puro" (pouca velocidade horizontal) pra nao confundir
    // com o impulso recebido ao tomar um hit/knockback enquanto agachado
    const justJumped =
      player.isSneaking && vel.y > 0.28 && horizontalSpeed < 0.3;
    const wasAlready = wasSneakJumping.get(player.id) ?? false;

    if (justJumped && !wasAlready) {
      if (!onCooldown(player, DP.dashCd, DASH_COOLDOWN_TICKS, now)) {
        setCooldown(player, DP.dashCd, now);
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
    wasSneakJumping.set(player.id, justJumped);
  }
}, 2);

/* ---------------------------------------------------------
   Contencao do Senkei: empurra de volta qualquer um que tente fugir
   --------------------------------------------------------- */

system.runInterval(() => {
  for (const zone of activeSenkeiZones) {
    containSenkeiZone(zone);
  }
}, 4);

/* ---------------------------------------------------------
   Carregamento do Senkei: agachado segurando a m1 base por 5s
   --------------------------------------------------------- */

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const character = getActiveCharacter(player);
    if (!character || !character.superAttack) continue;
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
   Actionbar (saude + awakening) - sempre visivel
   --------------------------------------------------------- */

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    const hp = player.getComponent("minecraft:health");
    if (!hp) continue;
    const current = Math.max(0, Math.round(hp.currentValue));
    const max = Math.round(hp.effectiveMax);
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

    player.onScreenDisplay.setActionBar(
      `§c❤ ${current}/${max}   §b⚡ Awakening: ${awakening}%${awakenedTag}${senkeiTag}`
    );
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
    if (!character) continue;

    const activeItems = getActiveItemsForPlayer(player, character);

    for (const slot in activeItems) {
      forceGiveLockedItem(inv, Number(slot), activeItems[slot]);
    }
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
   Drena o awakening 1%/segundo enquanto ativo, desativa em 0%
   --------------------------------------------------------- */

system.runInterval(() => {
  for (const player of world.getPlayers()) {
    if (!isAwakened(player)) continue;

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

world.afterEvents.playerLeave.subscribe((ev) => {
  const playerId = ev.playerId;
  removeSenkeiZoneOwnedBy(playerId);
  senkeiChargeTicks.delete(playerId);
  senkeiChargeReady.delete(playerId);
  wasSneakJumping.delete(playerId);
});
