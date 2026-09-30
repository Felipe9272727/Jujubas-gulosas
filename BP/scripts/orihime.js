import { world, system } from "@minecraft/server";

/* ---------------------------------------------------------
   Orihime Inoue - Tier 2 (Fullbringer)

   - Santen Kesshun: cupula fixa de 10s. Repele tudo de tier <= 4 que atinge
     quem esta dentro; fechada, ninguem de fora entra.
   - Soten Kisshun: devolve a vida perdida nos ultimos 10s (dela; agachado, de
     quem ela olha).
   - Koten Zanshun: corte de 20 blocos, 50 de dano que ignora reducao.
   - Shiten Koshun: usada COM o escudo aberto, arma o contra-ataque (guarda 50%
     do dano que o escudo segurar). Usada DEPOIS que o escudo acabou, solta o
     feixe com o que foi guardado.
   - Awakening (super, 100% do medidor): Soten Kisshun - Rejeicao Total.
   --------------------------------------------------------- */

export const ORIHIME = {
  health: 800,
  m1Item: "orihime:m1_rikka",
  santen: "orihime:santen_kesshun",
  soten: "orihime:soten_kisshun",
  koten: "orihime:koten_zanshun",
  shiten: "orihime:shiten_koshun",
  damage: { m1: 20, koten: 50 },
  shield: { radius: 5, ticks: 200, maxTier: 4 },
  rejectWindowTicks: 200, // "ultimos 10 segundos"
  koten_cfg: { range: 20, width: 2.4 },
  beam: { range: 20, width: 3.2, fraction: 0.5 },
  lookRange: 20,
  cooldowns: {
    "orihime:santen_kesshun": 700, // 35s
    "orihime:soten_kisshun": 500, // 25s
    "orihime:koten_zanshun": 300, // 15s
    "orihime:shiten_koshun": 600, // 30s (nao foi especificado)
  },
  names: {
    "orihime:santen_kesshun": "Santen Kesshun",
    "orihime:soten_kisshun": "Sōten Kisshun",
    "orihime:koten_zanshun": "Koten Zanshun",
    "orihime:shiten_koshun": "Shiten Kōshun",
  },
};

export function createOrihime(api) {
  const cfg = ORIHIME;
  // Map<idDaOrihime, { center, dimId, until, insiders:Set, absorbed, armed, stored, timer }>
  const shields = new Map();
  // energia guardada de um escudo ja encerrado: Map<idDaOrihime, dano do feixe>
  const stored = new Map();
  // Map<idDaEntidade, [{ tick, amount, sourceId }]> dano tomado, pro Soten Kisshun
  const taken = new Map();

  const isOrihime = (e) => {
    try {
      return e?.typeId === "minecraft:player" && api.getActiveCharacter(e)?.id === "orihime";
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
    } catch (err) {}
  };
  const sound = (dim, name, loc, volume, pitch) => {
    try {
      dim.playSound(name, loc, { volume, pitch });
    } catch (err) {}
  };
  const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const tierOf = (source) => {
    try {
      return source?.typeId === "minecraft:player" ? api.tierOfPlayer(source) : 0;
    } catch (err) {
      return 0;
    }
  };

  /* ---------- registro de dano (Soten Kisshun) ---------- */

  function onDamaged(target, source, amount) {
    try {
      if (!target?.id || !(amount > 0)) return;
      const now = system.currentTick;
      let list = taken.get(target.id);
      if (!list) {
        list = [];
        taken.set(target.id, list);
      }
      list.push({ tick: now, amount, sourceId: source?.id });
      while (list.length && now - list[0].tick > cfg.rejectWindowTicks) list.shift();
      if (list.length > 60) list.splice(0, list.length - 60);
    } catch (err) {}
  }

  function recentDamage(entity) {
    const list = taken.get(entity.id);
    if (!list) return 0;
    const now = system.currentTick;
    let sum = 0;
    for (const hit of list) if (now - hit.tick <= cfg.rejectWindowTicks) sum += hit.amount;
    return sum;
  }

  system.runInterval(() => {
    const now = system.currentTick;
    for (const [id, list] of taken) {
      while (list.length && now - list[0].tick > cfg.rejectWindowTicks) list.shift();
      if (!list.length) taken.delete(id);
    }
  }, 100);

  /* ---------- Santen Kesshun ---------- */

  // cupula que cobre a entidade (e o id da dona)
  function shieldAt(entity) {
    const now = system.currentTick;
    for (const [ownerId, s] of shields) {
      if (now >= s.until || s.dimId !== entity.dimension.id) continue;
      const l = entity.location;
      if (flat(l, s.center) <= cfg.shield.radius + 0.4 && Math.abs(l.y - s.center.y) <= cfg.shield.radius) {
        return { s, ownerId };
      }
    }
    return undefined;
  }

  // chamada pelo dealDamage. true = o golpe foi repelido. Quem esta dentro da
  // cupula nao toma dano de tier <= 4; so a dona ainda consegue acertar la dentro
  function blocksDamage(target, source, amount) {
    try {
      if (!target || !source || target.id === source.id) return false;
      const hit = shieldAt(target);
      if (!hit || source.id === hit.ownerId) return false;
      const s = hit.s;
      if (tierOf(source) > cfg.shield.maxTier) return false;
      s.absorbed += amount;
      if (s.armed) s.stored += amount * cfg.beam.fraction;
      const l = target.location;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        fx(target.dimension, "minecraft:villager_happy", { x: l.x + Math.cos(a) * 1.1, y: l.y + 1.2, z: l.z + Math.sin(a) * 1.1 });
      }
      sound(target.dimension, "random.glass", l, 0.6, 1.6);
      return true;
    } catch (err) {
      return false;
    }
  }

  function endShield(id, s) {
    if (s.timer !== undefined) system.clearRun(s.timer);
    if (shields.get(id) === s) shields.delete(id);
    if (s.armed && s.stored > 0) stored.set(id, s.stored);
  }

  function castSanten(player) {
    if (!api.tryUseSkill(player, cfg.santen)) return;
    const old = shields.get(player.id);
    if (old) endShield(player.id, old);
    stored.delete(player.id);
    const dim = player.dimension;
    const center = { x: player.location.x, y: player.location.y, z: player.location.z };
    const insiders = new Set();
    for (const e of dim.getEntities({ location: center, maxDistance: cfg.shield.radius + 1 })) {
      if (!e.getComponent("minecraft:health")) continue;
      if (flat(e.location, center) <= cfg.shield.radius) insiders.add(e.id);
    }
    insiders.add(player.id);
    const s = {
      center,
      dimId: dim.id,
      until: system.currentTick + cfg.shield.ticks,
      insiders,
      absorbed: 0,
      armed: false,
      stored: 0,
      timer: undefined,
    };
    shields.set(player.id, s);
    world.sendMessage(`§6${player.name} §7usou §eSanten Kesshun§7!`);
    sound(dim, "beacon.activate", center, 1.4, 1.5);
    let tick = 0;
    s.timer = system.runInterval(() => {
      tick += 2;
      let over = false;
      try {
        over = system.currentTick >= s.until || !isOrihime(player) || !alive(player);
      } catch (err) {
        over = true;
      }
      if (over) {
        sound(dim, "random.glass", center, 1.2, 0.6);
        endShield(player.id, s);
        try {
          player.sendMessage(
            s.armed && s.stored > 0
              ? `§6Santen Kesshun acabou. §fShiten Kōshun guardou §e${Math.round(s.stored)}§f de dano: use o item pra disparar.`
              : "§7Santen Kesshun acabou."
          );
        } catch (err) {}
        return;
      }
      // cupula: pontos numa meia esfera, girando devagar
      const r = cfg.shield.radius;
      for (let i = 0; i < 10; i++) {
        const t = Math.random() * Math.PI * 2;
        const f = Math.acos(Math.random());
        fx(dim, i % 3 === 0 ? "minecraft:endrod" : "minecraft:villager_happy", {
          x: center.x + r * Math.sin(f) * Math.cos(t),
          y: center.y + r * Math.cos(f),
          z: center.z + r * Math.sin(f) * Math.sin(t),
        });
      }
      // fechada: quem estava fora e tentou entrar volta pra borda
      for (const e of dim.getEntities({ location: center, maxDistance: r + 1 })) {
        try {
          if (s.insiders.has(e.id) || !e.getComponent("minecraft:health")) continue;
          const d = flat(e.location, center);
          if (d >= r) continue;
          const dx = e.location.x - center.x;
          const dz = e.location.z - center.z;
          const len = Math.hypot(dx, dz) || 1;
          e.teleport(
            { x: center.x + (dx / len) * (r + 0.6), y: e.location.y, z: center.z + (dz / len) * (r + 0.6) },
            { dimension: dim }
          );
          e.applyKnockback({ x: dx / len, z: dz / len }, 0.2);
        } catch (err) {}
      }
      // ataques de tier <= 4 que viajam ate a cupula sao desfeitos
      try {
        api.cancelAttacksNear(player, dim, { x: center.x, y: center.y + 1, z: center.z }, r, cfg.shield.maxTier, {
          label: "Santen Kesshun",
          particles: ["minecraft:villager_happy", "minecraft:endrod"],
        });
      } catch (err) {}
    }, 2);
  }

  /* ---------- Soten Kisshun ---------- */

  function castSoten(player) {
    const sneaking = player.isSneaking;
    const victim = sneaking ? api.targetInView(player, cfg.lookRange) : player;
    if (sneaking && !victim) {
      player.sendMessage("§eOlhe pra quem você quer curar (agachado).");
      return;
    }
    const amount = recentDamage(victim);
    if (amount <= 0) {
      player.sendMessage(
        sneaking
          ? `§7${api.nameOf(victim)} não tomou dano nos últimos 10s.`
          : "§7Você não tomou dano nos últimos 10s."
      );
      return;
    }
    if (!api.tryUseSkill(player, cfg.soten)) return;
    taken.delete(victim.id);
    const healed = api.healVirtual(victim, amount);
    world.sendMessage(`§6${player.name} §7usou §eSōten Kisshun§7!`);
    player.sendMessage(`§eSōten Kisshun: §f+${Math.round(healed)} de vida rejeitados${victim.id === player.id ? "" : ` de §b${api.nameOf(victim)}`}§f.`);
    try {
      if (victim.id !== player.id && victim.typeId === "minecraft:player") {
        victim.sendMessage(`§e${player.name} rejeitou o dano que você tomou.`);
      }
    } catch (err) {}
    ring(victim, "minecraft:villager_happy");
    sound(victim.dimension, "random.orb", victim.location, 1, 1.3);
  }

  function ring(entity, particle) {
    const l = entity.location;
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      fx(entity.dimension, particle, { x: l.x + Math.cos(a) * 0.9, y: l.y + 0.2 + (i % 4) * 0.5, z: l.z + Math.sin(a) * 0.9 });
    }
  }

  /* ---------- Koten Zanshun ---------- */

  function castKoten(player) {
    if (!api.tryUseSkill(player, cfg.koten)) return;
    world.sendMessage(`§6${player.name} §7usou §eKoten Zanshun§7!`);
    const dim = player.dimension;
    const origin = player.location;
    const dir = api.forwardDirection(player);
    sound(dim, "mob.wither.shoot", origin, 1, 1.6);
    for (let d = 1; d <= cfg.koten_cfg.range; d++) {
      const at = { x: origin.x + dir.x * d, y: origin.y + 1.2, z: origin.z + dir.z * d };
      fx(dim, "minecraft:endrod", at);
      if (d % 2 === 0) fx(dim, "minecraft:villager_happy", { x: at.x, y: at.y + 0.3, z: at.z });
    }
    const targets = api.entitiesInFrontBox(player, { forward: cfg.koten_cfg.range, width: cfg.koten_cfg.width, verticalReach: 2.5 });
    for (const e of targets) {
      try {
        api.dealDamage(e, cfg.damage.koten * api.dmgMultiplier(player), player, { ignoresReduction: true });
      } catch (err) {}
    }
  }

  /* ---------- Shiten Koshun ---------- */

  function castShiten(player) {
    const s = shields.get(player.id);
    if (s && system.currentTick < s.until) {
      if (s.armed) {
        player.sendMessage("§7Shiten Kōshun já está armado nesse escudo.");
        return;
      }
      s.armed = true;
      sound(player.dimension, "random.orb", player.location, 1, 0.8);
      ring(player, "minecraft:endrod");
      player.sendMessage("§6Shiten Kōshun armado: §fo escudo passa a guardar 50% do dano que segurar.");
      return;
    }
    const power = stored.get(player.id) ?? 0;
    if (power <= 0) {
      player.sendMessage("§7Shiten Kōshun não tem energia guardada. Use-o com o Santen Kesshun aberto.");
      return;
    }
    if (!api.tryUseSkill(player, cfg.shiten)) return;
    stored.delete(player.id);
    world.sendMessage(`§6${player.name} §7usou §eShiten Kōshun§7!`);
    const dim = player.dimension;
    const origin = player.location;
    const dir = api.forwardDirection(player);
    sound(dim, "random.explode", origin, 1.2, 1.5);
    for (let d = 1; d <= cfg.beam.range; d++) {
      const at = { x: origin.x + dir.x * d, y: origin.y + 1.2, z: origin.z + dir.z * d };
      fx(dim, "minecraft:endrod", at);
      fx(dim, "minecraft:villager_happy", at);
      if (d % 3 === 0) fx(dim, "minecraft:large_explosion", at);
    }
    const targets = api.entitiesInFrontBox(player, { forward: cfg.beam.range, width: cfg.beam.width, verticalReach: 2.5 });
    for (const e of targets) {
      try {
        api.dealDamage(e, power * api.dmgMultiplier(player), player);
      } catch (err) {}
    }
    player.sendMessage(`§eShiten Kōshun: §f${Math.round(power)} de dano disparado.`);
  }

  function cast(player, typeId) {
    switch (typeId) {
      case cfg.santen:
        return castSanten(player);
      case cfg.soten:
        return castSoten(player);
      case cfg.koten:
        return castKoten(player);
      case cfg.shiten:
        return castShiten(player);
    }
  }

  /* ---------- Awakening: Soten Kisshun - Rejeicao Total ---------- */

  function rejeicaoTotal(player) {
    if (api.getAwakening(player) < 100) return false;
    if (api.skillBlockingZoneFor(player)) return false;
    api.setAwakening(player, 0);
    const victim = api.targetInView(player, cfg.lookRange);
    world.sendMessage(`§6§l${player.name}: §e§lSōten Kisshun — Rejeição Total`);
    const targets = victim && alive(victim) ? [player, victim] : [player];
    for (const e of targets) {
      try {
        api.cleanseNegativeEffects(e);
        api.fullHeal(e);
        taken.delete(e.id);
        ring(e, "minecraft:villager_happy");
        ring(e, "minecraft:endrod");
        sound(e.dimension, "beacon.activate", e.location, 1.4, 1.8);
        if (e.id !== player.id && e.typeId === "minecraft:player") {
          e.sendMessage(`§e${player.name} rejeitou tudo o que te feriu.`);
        }
      } catch (err) {}
    }
    player.sendMessage(
      victim ? `§eRejeição Total: §fvida cheia e efeitos negativos removidos de você e de §b${api.nameOf(victim)}§f.` : "§eRejeição Total: §fvida cheia e efeitos negativos removidos."
    );
    return true;
  }

  /* ---------- hud e ciclo de vida ---------- */

  function hud(player) {
    const s = shields.get(player.id);
    if (s && system.currentTick < s.until) {
      const left = Math.ceil((s.until - system.currentTick) / 20);
      return `   §6✦Escudo ${left}s${s.armed ? " §e⚔Shiten" : ""}`;
    }
    const power = stored.get(player.id) ?? 0;
    return power > 0 ? `   §e⚔Shiten pronto (${Math.round(power)})` : "";
  }

  function reset(player) {
    const s = shields.get(player.id);
    if (s) {
      if (s.timer !== undefined) system.clearRun(s.timer);
      shields.delete(player.id);
    }
    stored.delete(player.id);
  }

  function leave(id) {
    const s = shields.get(id);
    if (s?.timer !== undefined) system.clearRun(s.timer);
    shields.delete(id);
    stored.delete(id);
    taken.delete(id);
  }

  return { cast, blocksDamage, onDamaged, rejeicaoTotal, hud, reset, leave };
}
