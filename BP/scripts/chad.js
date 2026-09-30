import { world, system, ItemStack } from "@minecraft/server";

/* ---------------------------------------------------------
   Yasutora "Chad" Sado - Tier 3 (Fullbringer)

   Vida 1000. Dois braços que se alternam pelo item "Change Arm" (cd 5s):
   - Brazo Derecha del Gigante: M1, Blindaje, El Directo, Carga Reiatsu
   - Brazo Izquierda del Diablo: M1, Trituradora de Tierra, Bater de Palmas
     del Diablo, La Muerte
   Awakening "Brazos del Gigante": junta duas skills em uma e ganha o
   El Golpe del Gigante. O Change Arm nao faz nada no awakening.
   --------------------------------------------------------- */

export const CHAD = {
  health: 1000,
  changeArm: "chad:change_arm",
  right: {
    m1: "chad:m1_direito",
    blindaje: "chad:blindaje",
    directo: "chad:el_directo",
    carga: "chad:carga_reiatsu",
  },
  left: {
    m1: "chad:m1_esquerdo",
    trituradora: "chad:trituradora_de_tierra",
    palmas: "chad:bater_de_palmas",
    muerte: "chad:la_muerte",
  },
  giant: {
    m1: "chad:m1_gigante",
    blindajePalmas: "chad:blindaje_palmas",
    cargaDirecto: "chad:carga_directo",
    golpe: "chad:golpe_do_gigante",
  },
  damage: {
    m1Right: 35,
    m1Left: 40,
    m1Giant: 65,
    directo: 200,
    directoPointBlank: 300,
    trituradora: 250,
    palmas: 340,
    muerte: 410,
    golpe: 450,
  },
  armSwitchTicks: 100, // Change Arm: 5s
  blindaje: { ticks: 100, damageTaken: 0.55 }, // -45% por 5s
  carga: { ticks: 200, damageMultiplier: 1.3 }, // +30% por 10s
  directo: { range: 15, width: 2.6, pointBlankRange: 2.5 },
  trituradora: { radius: 7 },
  palmas: { radius: 6, stunTicks: 100 }, // atordoa 5s
  muerte: { range: 14, width: 6 },
  golpe: { reach: 4.5, width: 4, lift: 1.8 },
  cooldowns: {
    "chad:blindaje": 300, // 15s
    "chad:el_directo": 600, // 30s
    "chad:carga_reiatsu": 900, // 45s
    "chad:trituradora_de_tierra": 400, // 20s
    "chad:bater_de_palmas": 600, // 30s
    "chad:la_muerte": 1000, // 50s
    "chad:blindaje_palmas": 500, // 25s
    "chad:carga_directo": 560, // 28s
    "chad:golpe_do_gigante": 500, // 25s
  },
  names: {
    "chad:blindaje": "Blindaje",
    "chad:el_directo": "El Directo",
    "chad:carga_reiatsu": "Carga Reiatsu",
    "chad:trituradora_de_tierra": "Trituradora de Tierra",
    "chad:bater_de_palmas": "Bater de Palmas del Diablo",
    "chad:la_muerte": "La Muerte",
    "chad:blindaje_palmas": "Blindaje + Bater de Palmas",
    "chad:carga_directo": "Carga de Reiatsu + El Directo",
    "chad:golpe_do_gigante": "El Golpe del Gigante",
  },
};

const DP_ARM = "mv:chad_arm"; // 0 = direito, 1 = esquerdo

export function createChad(api) {
  const cfg = CHAD;
  const shield = new Map(); // id -> { until, timer }
  const charge = new Map(); // id -> { until, timer }
  const armCooldown = new Map(); // id -> tick liberado

  const isChad = (e) => {
    try {
      return e?.typeId === "minecraft:player" && api.getActiveCharacter(e)?.id === "chad";
    } catch (err) {
      return false;
    }
  };
  const alive = (e) => {
    try {
      return !!e && !api.isDownOrGone(e);
    } catch (err) {
      return false;
    }
  };
  const fx = (dim, name, loc) => {
    try {
      dim.spawnParticle(name, loc);
    } catch (err) {
      // particula invalida nao pode travar a skill
    }
  };
  const sound = (dim, name, loc, volume, pitch) => {
    try {
      dim.playSound(name, loc, { volume, pitch });
    } catch (err) {}
  };
  const hit = (player, entity, base) => {
    try {
      api.dealDamage(entity, base * api.dmgMultiplier(player), player);
    } catch (err) {}
  };
  const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  /* ---------- braco ativo ---------- */

  function armOf(player) {
    try {
      return player.getDynamicProperty(DP_ARM) === 1 ? "left" : "right";
    } catch (err) {
      return "right";
    }
  }

  function armItems(arm) {
    const set = arm === "left" ? cfg.left : cfg.right;
    const values = Object.values(set);
    return { 0: values[0], 1: values[1], 2: values[2], 3: values[3], 4: cfg.changeArm };
  }

  // itens travados nos slots agora (a forma desperta tem prioridade la no main)
  function activeItems(player, baseItems) {
    return armOf(player) === "left" ? armItems("left") : baseItems;
  }

  function setArm(player, arm) {
    try {
      player.setDynamicProperty(DP_ARM, arm === "left" ? 1 : 0);
    } catch (err) {}
  }

  function changeArm(player) {
    if (api.isAwakened(player)) {
      player.sendMessage("§7O Change Arm não tem efeito durante o Awakening.");
      return;
    }
    const now = system.currentTick;
    const free = armCooldown.get(player.id) ?? 0;
    if (now < free) {
      player.sendMessage(`§cRecarregando... §7(${Math.ceil((free - now) / 20)}s)`);
      return;
    }
    armCooldown.set(player.id, now + cfg.armSwitchTicks);
    const next = armOf(player) === "right" ? "left" : "right";
    setArm(player, next);
    try {
      const inv = api.getInv(player);
      const items = armItems(next);
      for (const slot of [0, 1, 2, 3]) inv.setItem(slot, new ItemStack(items[slot], 1));
    } catch (err) {}
    sound(player.dimension, "random.anvil_land", player.location, 0.6, 1.4);
    player.sendMessage(
      next === "left"
        ? "§4Brazo Izquierda del Diablo"
        : "§9Brazo Derecha del Gigante"
    );
    system.runTimeout(() => {
      try {
        player.sendMessage("§aChange Arm §frecarregou e já pode ser usado de novo!");
      } catch (err) {}
    }, cfg.armSwitchTicks);
  }

  /* ---------- multiplicadores lidos pelo main ---------- */

  function takenMultiplier(entity) {
    return (shield.get(entity?.id)?.until ?? 0) > system.currentTick ? cfg.blindaje.damageTaken : 1;
  }

  function damageMultiplier(player) {
    return (charge.get(player?.id)?.until ?? 0) > system.currentTick ? cfg.carga.damageMultiplier : 1;
  }

  function hud(player) {
    const arm = api.isAwakened(player)
      ? "§6Brazos del Gigante"
      : armOf(player) === "left"
        ? "§4Izquierdo"
        : "§9Derecho";
    const guard = takenMultiplier(player) < 1 ? " §b✦Blindaje" : "";
    const boost = damageMultiplier(player) > 1 ? " §e✦Reiatsu" : "";
    return `   §7✊ ${arm}${guard}${boost}`;
  }

  /* ---------- blindaje / carga ---------- */

  function startBlindaje(player, onEnd) {
    const old = shield.get(player.id);
    if (old?.timer !== undefined) system.clearRun(old.timer);
    const until = system.currentTick + cfg.blindaje.ticks;
    const state = { until, timer: undefined };
    shield.set(player.id, state);
    sound(player.dimension, "random.anvil_land", player.location, 0.8, 0.7);
    state.timer = system.runInterval(() => {
      let over = false;
      try {
        over = !alive(player) || system.currentTick >= until || !isChad(player);
        if (!over) {
          const p = player.location;
          const dir = player.getViewDirection();
          for (let i = 0; i < 3; i++) {
            fx(player.dimension, "minecraft:blue_flame_particle", {
              x: p.x + dir.x * 0.9 + (Math.random() - 0.5) * 0.8,
              y: p.y + 0.6 + Math.random() * 1.2,
              z: p.z + dir.z * 0.9 + (Math.random() - 0.5) * 0.8,
            });
          }
        }
      } catch (err) {
        over = true;
      }
      if (!over) return;
      system.clearRun(state.timer);
      if (shield.get(player.id) === state) shield.delete(player.id);
      if (onEnd && alive(player) && isChad(player)) onEnd();
    }, 4);
  }

  function startCarga(player) {
    const old = charge.get(player.id);
    if (old?.timer !== undefined) system.clearRun(old.timer);
    const until = system.currentTick + cfg.carga.ticks;
    const state = { until, timer: undefined };
    charge.set(player.id, state);
    sound(player.dimension, "random.orb", player.location, 1, 0.5);
    state.timer = system.runInterval(() => {
      let over = false;
      try {
        over = !alive(player) || system.currentTick >= until || !isChad(player);
        if (!over) {
          const p = player.location;
          for (let i = 0; i < 3; i++) {
            fx(player.dimension, "minecraft:electric_spark_particle", {
              x: p.x + (Math.random() - 0.5) * 1.2,
              y: p.y + Math.random() * 2,
              z: p.z + (Math.random() - 0.5) * 1.2,
            });
          }
        }
      } catch (err) {
        over = true;
      }
      if (!over) return;
      system.clearRun(state.timer);
      if (charge.get(player.id) === state) charge.delete(player.id);
    }, 5);
  }

  /* ---------- ataques ---------- */

  function fireDirecto(player) {
    const dim = player.dimension;
    const origin = player.location;
    const dir = api.forwardDirection(player);
    sound(dim, "random.explode", origin, 1.2, 1.4);
    for (let d = 1; d <= cfg.directo.range; d++) {
      const at = { x: origin.x + dir.x * d, y: origin.y + 1.2, z: origin.z + dir.z * d };
      fx(dim, "minecraft:electric_spark_particle", at);
      fx(dim, d % 3 === 0 ? "minecraft:large_explosion" : "minecraft:blue_flame_particle", at);
    }
    const targets = api.entitiesInFrontBox(player, {
      forward: cfg.directo.range,
      width: cfg.directo.width,
      verticalReach: 2.5,
    });
    for (const entity of targets) {
      const close = horizontal(entity.location, origin) <= cfg.directo.pointBlankRange;
      hit(player, entity, close ? cfg.damage.directoPointBlank : cfg.damage.directo);
    }
  }

  function castBlindaje(player) {
    if (!api.tryUseSkill(player, "chad:blindaje")) return;
    world.sendMessage(`§9${player.name} §7usou §fBlindaje§7!`);
    startBlindaje(player);
  }

  function castDirecto(player) {
    if (!api.tryUseSkill(player, "chad:el_directo")) return;
    world.sendMessage(`§9${player.name} §7usou §fEl Directo§7!`);
    fireDirecto(player);
  }

  function castCarga(player) {
    if (!api.tryUseSkill(player, "chad:carga_reiatsu")) return;
    world.sendMessage(`§e${player.name} §7usou §fCarga Reiatsu§7!`);
    startCarga(player);
  }

  function castTrituradora(player) {
    if (!api.tryUseSkill(player, "chad:trituradora_de_tierra")) return;
    world.sendMessage(`§4${player.name} §7usou §fTrituradora de Tierra§7!`);
    const dim = player.dimension;
    const center = player.location;
    sound(dim, "random.explode", center, 1.5, 0.6);
    // ondas de reiatsu saindo do chao em aneis
    for (let ring = 1; ring <= 4; ring++) {
      const r = (cfg.trituradora.radius * ring) / 4;
      system.runTimeout(() => {
        for (let i = 0; i < 20 + ring * 6; i++) {
          const a = (i / (20 + ring * 6)) * Math.PI * 2;
          const at = { x: center.x + Math.cos(a) * r, y: center.y + 0.2, z: center.z + Math.sin(a) * r };
          fx(dim, "minecraft:large_explosion", at);
          if (i % 2 === 0) fx(dim, "minecraft:crit_particle", at);
        }
      }, ring * 2);
    }
    for (const entity of dim.getEntities({ location: center, maxDistance: cfg.trituradora.radius })) {
      if (entity.id === player.id) continue;
      if (!entity.getComponent("minecraft:health")) continue;
      if (Math.abs(entity.location.y - center.y) > 3.5) continue;
      hit(player, entity, cfg.damage.trituradora);
    }
  }

  function doPalmas(player) {
    const dim = player.dimension;
    const center = player.location;
    sound(dim, "random.explode", center, 1.4, 0.9);
    fx(dim, "minecraft:huge_explosion_emitter", { x: center.x, y: center.y + 1, z: center.z });
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      fx(dim, "minecraft:large_explosion", {
        x: center.x + Math.cos(a) * cfg.palmas.radius * 0.6,
        y: center.y + 1,
        z: center.z + Math.sin(a) * cfg.palmas.radius * 0.6,
      });
    }
    for (const entity of dim.getEntities({ location: center, maxDistance: cfg.palmas.radius })) {
      if (entity.id === player.id) continue;
      if (!entity.getComponent("minecraft:health")) continue;
      hit(player, entity, cfg.damage.palmas);
      if (api.isIntocable(entity)) continue;
      try {
        api.paralyzeFor(entity, cfg.palmas.stunTicks, "§eVocê foi atordoado pelas palmas do Diablo!");
      } catch (err) {}
    }
  }

  function castPalmas(player) {
    if (!api.tryUseSkill(player, "chad:bater_de_palmas")) return;
    world.sendMessage(`§4${player.name} §7usou §fBater de Palmas del Diablo§7!`);
    doPalmas(player);
  }

  function castMuerte(player) {
    if (!api.tryUseSkill(player, "chad:la_muerte")) return;
    world.sendMessage(`§4§l${player.name} §r§7usou §4La Muerte§7!`);
    const dim = player.dimension;
    const origin = player.location;
    const dir = api.forwardDirection(player);
    sound(dim, "mob.wither.shoot", origin, 1.4, 0.5);
    for (let d = 1; d <= cfg.muerte.range; d++) {
      const at = { x: origin.x + dir.x * d, y: origin.y + 1.2, z: origin.z + dir.z * d };
      fx(dim, "minecraft:huge_explosion_emitter", at);
      fx(dim, "minecraft:large_explosion", { x: at.x, y: at.y - 0.6, z: at.z });
    }
    const targets = api.entitiesInFrontBox(player, {
      forward: cfg.muerte.range,
      width: cfg.muerte.width,
      verticalReach: 3,
    });
    for (const entity of targets) hit(player, entity, cfg.damage.muerte);
  }

  function castGolpe(player) {
    if (!api.tryUseSkill(player, "chad:golpe_do_gigante")) return;
    world.sendMessage(`§6${player.name} §7usou §fEl Golpe del Gigante§7!`);
    const dim = player.dimension;
    const origin = player.location;
    const dir = api.forwardDirection(player);
    sound(dim, "random.explode", origin, 1.3, 0.8);
    for (let h = 0; h < 6; h++) {
      fx(dim, "minecraft:large_explosion", {
        x: origin.x + dir.x * 2,
        y: origin.y + 0.5 + h * 0.7,
        z: origin.z + dir.z * 2,
      });
    }
    const targets = api.entitiesInFrontBox(player, {
      forward: cfg.golpe.reach,
      width: cfg.golpe.width,
      verticalReach: 2.5,
    });
    for (const entity of targets) {
      hit(player, entity, cfg.damage.golpe);
      try {
        entity.applyKnockback({ x: 0, z: 0 }, cfg.golpe.lift);
      } catch (err) {}
    }
  }

  // Blindaje + Bater de Palmas: ao parar de proteger, faz as palmas
  function castBlindajePalmas(player) {
    if (!api.tryUseSkill(player, "chad:blindaje_palmas")) return;
    world.sendMessage(`§6${player.name} §7usou §fBlindaje + Bater de Palmas§7!`);
    startBlindaje(player, () => doPalmas(player));
  }

  // Carga de Reiatsu + El Directo: carrega e lanca o El Directo
  function castCargaDirecto(player) {
    if (!api.tryUseSkill(player, "chad:carga_directo")) return;
    world.sendMessage(`§6${player.name} §7usou §fCarga de Reiatsu + El Directo§7!`);
    startCarga(player);
    system.runTimeout(() => {
      if (alive(player) && isChad(player)) fireDirecto(player);
    }, 10);
  }

  function cast(player, typeId) {
    switch (typeId) {
      case cfg.changeArm:
        return changeArm(player);
      case "chad:blindaje":
        return castBlindaje(player);
      case "chad:el_directo":
        return castDirecto(player);
      case "chad:carga_reiatsu":
        return castCarga(player);
      case "chad:trituradora_de_tierra":
        return castTrituradora(player);
      case "chad:bater_de_palmas":
        return castPalmas(player);
      case "chad:la_muerte":
        return castMuerte(player);
      case "chad:blindaje_palmas":
        return castBlindajePalmas(player);
      case "chad:carga_directo":
        return castCargaDirecto(player);
      case "chad:golpe_do_gigante":
        return castGolpe(player);
    }
  }

  /* ---------- ciclo de vida ---------- */

  function clearState(id) {
    const s = shield.get(id);
    if (s?.timer !== undefined) system.clearRun(s.timer);
    const c = charge.get(id);
    if (c?.timer !== undefined) system.clearRun(c.timer);
    shield.delete(id);
    charge.delete(id);
    armCooldown.delete(id);
  }

  function reset(player) {
    clearState(player.id);
    setArm(player, "right");
  }

  function leave(id) {
    clearState(id);
  }

  return {
    activeItems,
    armOf,
    setArm,
    cast,
    reset,
    leave,
    hud,
    takenMultiplier,
    damageMultiplier,
  };
}
