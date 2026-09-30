import { world, system } from "@minecraft/server";

/* ---------------------------------------------------------
   Ichigo Kurosaki (Fullbringer) - Tier 3

   Base: vida 1200, manto de chamas negras (individualidade).
   - Dark Flame Sword (m1), Several Cuts, Shadow's Movement,
     Boomerang Substitute, False Getsuga
   Awakening "Fullbringer Completo": vida 1800 + armadura de osso.
   - Fullbringer's Blade (m1), Triple Action, Fullbringer Getsuga,
     Bringer Light, Pierce
   --------------------------------------------------------- */

export const ICHIGO_FB = {
  id: "ichigo_fullbringer",
  health: 1200,
  awakeningHealth: 1800,
  armor: "fbichigo:bone_chest",
  base: {
    m1: "fbichigo:dark_flame_sword",
    cuts: "fbichigo:several_cuts",
    shadow: "fbichigo:shadows_movement",
    boomerang: "fbichigo:boomerang_substitute",
    getsuga: "fbichigo:false_getsuga",
  },
  awk: {
    m1: "fbichigo:fullbringers_blade",
    triple: "fbichigo:triple_action",
    getsuga: "fbichigo:fullbringer_getsuga",
    light: "fbichigo:bringer_light",
    pierce: "fbichigo:pierce",
  },
  damage: {
    m1: 30,
    cut: 5, // por corte
    boomerang: 170,
    falseGetsuga: 250,
    m1Awk: 35,
    triple: 175, // por corte
    fullGetsuga: 400,
    pierce: 650,
  },
  cuts: { ticks: 20, perTick: 5, burstTicks: 10, reach: 4.5, width: 4 },
  shadow: { ticks: 100, speedAmplifier: 5 }, // speed 6 por 5s
  boomerang: { range: 20, speed: 1.3, hitRadius: 1.9 },
  falseGetsuga: { range: 32, speed: 2, radius: 2.4 },
  fullGetsuga: { range: 40, speed: 2.4, radius: 3.4 },
  triple: { radius: 5, cuts: 3, gapTicks: 10 },
  light: { pushes: 4, strengthMultiplier: 0.6, speedTicks: 100, speedAmplifier: 5 },
  pierce: { range: 32, step: 3, maxTicks: 24 },
  cooldowns: {
    "fbichigo:several_cuts": 400, // 20s
    "fbichigo:shadows_movement": 500, // 25s
    "fbichigo:boomerang_substitute": 600, // 30s
    "fbichigo:false_getsuga": 700, // 35s
    "fbichigo:triple_action": 300, // 15s
    "fbichigo:fullbringer_getsuga": 500, // 25s
    "fbichigo:bringer_light": 300, // 15s
    "fbichigo:pierce": 800, // 40s
  },
  names: {
    "fbichigo:several_cuts": "Several Cuts",
    "fbichigo:shadows_movement": "Shadow's Movement",
    "fbichigo:boomerang_substitute": "Boomerang Substitute",
    "fbichigo:false_getsuga": "False Getsuga",
    "fbichigo:triple_action": "Triple Action",
    "fbichigo:fullbringer_getsuga": "Fullbringer Getsuga",
    "fbichigo:bringer_light": "Bringer Light",
    "fbichigo:pierce": "Pierce",
  },
};

const FIRE = "fbichigo:chama"; // chama negra (preta mesmo, sem laranja)
const DARK = "isshin:negro"; // nucleo escuro
const CUT_DARK = "fbichigo:corte_negro"; // talho de verdade (preto/vinho, miolo branco)
const CUT_BLUE = "fbichigo:corte_azul"; // talho branco-azulado do Fullbring
const SPARK = "fbichigo:faisca"; // faisca de energia azul-branca

export function createIchigoFullbringer(api) {
  const cfg = ICHIGO_FB;
  const shadows = new Map(); // id -> { until, timer }
  const running = new Map(); // id -> Set de timers (limpos ao sair/resetar)

  const alive = (e) => {
    try {
      return !!e && !api.isDownOrGone(e);
    } catch (err) {
      return false;
    }
  };
  const mine = (e) => {
    try {
      return e?.typeId === "minecraft:player" && api.getActiveCharacter(e)?.id === cfg.id;
    } catch (err) {
      return false;
    }
  };
  const fx = (dim, name, at) => {
    try {
      dim.spawnParticle(name, at);
    } catch (err) {
      // particula invalida nao pode travar a skill
    }
  };
  const sound = (dim, name, at, volume, pitch) => {
    try {
      dim.playSound(name, at, { volume, pitch });
    } catch (err) {}
  };
  const damageOf = (player, base, options) => (entity) => {
    try {
      api.dealDamage(entity, base * api.dmgMultiplier(player), player, options);
    } catch (err) {}
  };
  const targetable = (player, e) => {
    try {
      return e.id !== player.id && !!e.getComponent("minecraft:health") && alive(e);
    } catch (err) {
      return false;
    }
  };
  const solidAt = (dim, at) => {
    try {
      const b = dim.getBlock({ x: Math.floor(at.x), y: Math.floor(at.y), z: Math.floor(at.z) });
      return !!b && !b.isAir && !b.isLiquid;
    } catch (err) {
      return false;
    }
  };

  // todo timer da skill passa por aqui, pra cair junto quando o player sai/reseta
  function track(player, id) {
    let set = running.get(player.id);
    if (!set) {
      set = new Set();
      running.set(player.id, set);
    }
    set.add(id);
    return id;
  }
  function stop(player, id) {
    try {
      system.clearRun(id);
    } catch (err) {}
    running.get(player.id)?.delete(id);
  }

  /* ---------- individualidade: manto de chamas negras ---------- */

  // discreto: chama preta subindo pelo corpo, quase sem brasa vermelha
  system.runInterval(() => {
    for (const player of world.getPlayers()) {
      try {
        if (!mine(player) || !alive(player) || shadows.has(player.id)) continue;
        const p = player.location;
        for (let i = 0; i < 2; i++) {
          fx(player.dimension, FIRE, {
            x: p.x + (Math.random() - 0.5) * 0.9,
            y: p.y + 0.1 + Math.random() * 1.8,
            z: p.z + (Math.random() - 0.5) * 0.9,
          });
        }
        if (Math.random() < 0.4) {
          fx(player.dimension, DARK, {
            x: p.x + (Math.random() - 0.5) * 0.7,
            y: p.y + 0.2 + Math.random() * 1.5,
            z: p.z + (Math.random() - 0.5) * 0.7,
          });
        }
      } catch (err) {}
    }
  }, 4);

  /* ---------- helpers de corte ---------- */

  function body(e, spread = 0.6) {
    const l = e.location;
    return {
      x: l.x + (Math.random() - 0.5) * spread * 2,
      y: l.y + 0.4 + Math.random() * 1.3,
      z: l.z + (Math.random() - 0.5) * spread * 2,
    };
  }

  // linha de particulas de a ate b
  function streak(dim, a, b, name, steps) {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      fx(dim, name, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }

  // um talho grande: o traço em si + faiscas do impacto
  function cutAt(dim, at, blue) {
    fx(dim, blue ? CUT_BLUE : CUT_DARK, at);
    fx(dim, "minecraft:crit_particle", at);
    fx(dim, "minecraft:crit_particle", { x: at.x + (Math.random() - 0.5) * 0.5, y: at.y + (Math.random() - 0.5) * 0.5, z: at.z + (Math.random() - 0.5) * 0.5 });
  }

  /* ---------- Several Cuts ---------- */

  function castCuts(player) {
    if (!api.tryUseSkill(player, cfg.base.cuts)) return;
    world.sendMessage(`§8${player.name} §7usou §fSeveral Cuts§7!`);
    const dim = player.dimension;
    let t = 0;
    const id = system.runInterval(() => {
      t++;
      if (t > cfg.cuts.ticks || !alive(player) || !mine(player)) {
        stop(player, id);
        return;
      }
      const o = player.location;
      const dir = api.forwardDirection(player);
      const perp = { x: -dir.z, z: dir.x };
      let targets = [];
      try {
        targets = api.entitiesInFrontBox(player, {
          forward: cfg.cuts.reach,
          width: cfg.cuts.width,
          verticalReach: 3,
        });
      } catch (err) {}
      // 5 cortes por tick: talhos de verdade, em cima dos alvos (ou no ar, se nao tem ninguem)
      for (let i = 0; i < cfg.cuts.perTick; i++) {
        let at;
        if (targets.length > 0 && Math.random() < 0.75) {
          at = body(targets[Math.floor(Math.random() * targets.length)]);
        } else {
          const d = 1.2 + Math.random() * (cfg.cuts.reach - 1.2);
          const lat = (Math.random() - 0.5) * cfg.cuts.width;
          at = {
            x: o.x + dir.x * d + perp.x * lat,
            y: o.y + 0.5 + Math.random() * 1.6,
            z: o.z + dir.z * d + perp.z * lat,
          };
        }
        cutAt(dim, at, false);
      }
      // um talho comprido varrendo a frente do player
      if (t % 3 === 0) {
        const s = (Math.random() - 0.5) * cfg.cuts.width;
        const e = -s;
        streak(dim, {
          x: o.x + dir.x * 2.2 + perp.x * s, y: o.y + 0.3 + Math.random() * 0.6, z: o.z + dir.z * 2.2 + perp.z * s,
        }, {
          x: o.x + dir.x * 3.6 + perp.x * e, y: o.y + 1.6 + Math.random() * 0.6, z: o.z + dir.z * 3.6 + perp.z * e,
        }, FIRE, 9);
      }
      // saraivada de cortes: varios "shhk" de uma vez
      sound(dim, "item.trident.throw", o, 0.7, 1.6 + Math.random() * 0.8);
      if (t % 2 === 0) sound(dim, "item.trident.hit", o, 0.6, 1.5 + Math.random() * 0.7);
      // o dano sai em rajadas (5 cortes x 5 de dano x ticks da rajada): golpe a golpe
      // a cada tick esbarraria na invulnerabilidade pos-dano do alvo, o total e o mesmo
      if (t % cfg.cuts.burstTicks === 0) {
        const total = cfg.damage.cut * cfg.cuts.perTick * cfg.cuts.burstTicks;
        const hit = damageOf(player, total);
        for (const e of targets) hit(e);
      }
    }, 1);
    track(player, id);
  }

  /* ---------- Shadow's Movement ---------- */

  function endShadow(player, silent) {
    const state = shadows.get(player.id);
    if (!state) return;
    if (state.timer !== undefined) stop(player, state.timer);
    shadows.delete(player.id);
    try {
      player.removeEffect("invisibility");
      player.removeEffect("speed");
    } catch (err) {}
    if (!silent) {
      try {
        player.sendMessage("§8Você saiu das sombras.");
      } catch (err) {}
    }
  }

  function castShadow(player) {
    if (!api.tryUseSkill(player, cfg.base.shadow)) return;
    world.sendMessage(`§8${player.name} §7usou §fShadow's Movement§7!`);
    endShadow(player, true);
    const dim = player.dimension;
    const until = system.currentTick + cfg.shadow.ticks;
    const state = { until, timer: undefined };
    shadows.set(player.id, state);
    try {
      player.addEffect("invisibility", cfg.shadow.ticks, { amplifier: 0, showParticles: false });
      player.addEffect("speed", cfg.shadow.ticks, {
        amplifier: cfg.shadow.speedAmplifier,
        showParticles: false,
      });
    } catch (err) {}
    sound(dim, "mob.enderman.portal", player.location, 0.8, 0.6);
    state.timer = system.runInterval(() => {
      if (!alive(player) || !mine(player) || system.currentTick >= until) {
        endShadow(player, !alive(player));
        return;
      }
      // rastro espesso e grande de escuridao no chao, que segue o player
      const p = player.location;
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * 1.7;
        const at = { x: p.x + Math.cos(a) * r, y: p.y + 0.1 + Math.random() * 0.3, z: p.z + Math.sin(a) * r };
        fx(dim, "minecraft:basic_smoke_particle", at);
        if (i % 2 === 0) fx(dim, DARK, at);
      }
    }, 2);
    track(player, state.timer);
  }

  // dentro da sombra nao entra dano (e, sem dano, tambem nao entra knockback)
  function blocksDamage(target) {
    const state = shadows.get(target?.id);
    return !!state && state.until > system.currentTick;
  }

  /* ---------- Boomerang Substitute ---------- */

  // Manji (卍) num plano vertical de frente pro player, girando
  function drawManji(dim, center, perp, angle) {
    const put = (u, v) =>
      fx(dim, FIRE, {
        x: center.x + perp.x * u,
        y: center.y + v,
        z: center.z + perp.z * u,
      });
    for (let k = 0; k < 4; k++) {
      const a = angle + (k * Math.PI) / 2;
      const ax = Math.cos(a);
      const ay = Math.sin(a);
      for (let r = 0.3; r <= 1.2; r += 0.3) put(ax * r, ay * r);
      const hx = Math.cos(a - Math.PI / 2);
      const hy = Math.sin(a - Math.PI / 2);
      const ex = ax * 1.2;
      const ey = ay * 1.2;
      put(ex + hx * 0.4, ey + hy * 0.4);
      put(ex + hx * 0.8, ey + hy * 0.8);
    }
    fx(dim, DARK, center);
  }

  function castBoomerang(player) {
    if (!api.tryUseSkill(player, cfg.base.boomerang)) return;
    world.sendMessage(`§8${player.name} §7usou §fBoomerang Substitute§7!`);
    const dim = player.dimension;
    const dir = api.forwardDirection(player);
    const perp = { x: -dir.z, z: dir.x };
    const o = player.location;
    const pos = { x: o.x + dir.x * 1.2, y: o.y + 1.2, z: o.z + dir.z * 1.2 };
    const hitOut = new Set();
    const hitBack = new Set();
    let phase = "out";
    let travelled = 0;
    let angle = 0;
    const hit = damageOf(player, cfg.damage.boomerang);
    sound(dim, "mob.wither.shoot", o, 0.8, 1.5);
    const id = system.runInterval(() => {
      if (!alive(player) || !mine(player)) {
        stop(player, id);
        return;
      }
      angle += 0.55;
      const speed = cfg.boomerang.speed;
      if (phase === "out") {
        pos.x += dir.x * speed;
        pos.z += dir.z * speed;
        travelled += speed;
        if (solidAt(dim, pos)) {
          pos.x -= dir.x * speed;
          pos.z -= dir.z * speed;
          phase = "back";
        } else if (travelled >= cfg.boomerang.range) {
          phase = "back";
        }
      } else {
        const me = player.location;
        const dx = me.x - pos.x;
        const dy = me.y + 1.2 - pos.y;
        const dz = me.z - pos.z;
        const d = Math.hypot(dx, dy, dz);
        if (d < 1.7) {
          stop(player, id);
          return;
        }
        pos.x += (dx / d) * speed * 1.15;
        pos.y += (dy / d) * speed * 1.15;
        pos.z += (dz / d) * speed * 1.15;
      }
      drawManji(dim, pos, perp, angle);
      const seen = phase === "out" ? hitOut : hitBack;
      try {
        for (const e of dim.getEntities({ location: pos, maxDistance: cfg.boomerang.hitRadius })) {
          if (!targetable(player, e) || seen.has(e.id)) continue;
          seen.add(e.id);
          hit(e);
          fx(dim, "minecraft:large_explosion", { x: e.location.x, y: e.location.y + 1, z: e.location.z });
        }
      } catch (err) {}
    }, 1);
    track(player, id);
  }

  /* ---------- Getsugas (False e Fullbringer) ---------- */

  // meia-lua que avanca. vertical = talho de cima pra baixo; horizontal = talho deitado
  function fireWave(player, opts) {
    const dim = player.dimension;
    const dir = api.forwardDirection(player);
    const perp = { x: -dir.z, z: dir.x };
    const o = player.location;
    const center = { x: o.x + dir.x * 1.6, y: o.y + 1.1, z: o.z + dir.z * 1.6 };
    const seen = new Set();
    const hit = damageOf(player, opts.damage);
    let travelled = 0;
    const N = 9;
    sound(dim, "mob.wither.shoot", o, 1, opts.pitch);
    const id = system.runInterval(() => {
      if (!alive(player) || travelled >= opts.range) {
        stop(player, id);
        return;
      }
      center.x += dir.x * opts.speed;
      center.z += dir.z * opts.speed;
      travelled += opts.speed;
      if (solidAt(dim, center)) {
        fx(dim, "minecraft:large_explosion", center);
        stop(player, id);
        return;
      }
      for (let i = -N; i <= N; i++) {
        const t = i / N;
        const theta = t * (Math.PI / 2.3);
        const lateral = Math.sin(theta) * opts.radius;
        const back = (1 - Math.cos(theta)) * opts.radius * 0.9;
        const at = {
          x: center.x - dir.x * back + (opts.horizontal ? perp.x * lateral : 0),
          y: center.y + (opts.horizontal ? 0 : lateral),
          z: center.z - dir.z * back + (opts.horizontal ? perp.z * lateral : 0),
        };
        fx(dim, Math.abs(i) >= N - 2 || i % 3 === 0 ? opts.edge : opts.core, at);
      }
      fx(dim, opts.core, center);
      try {
        for (const e of dim.getEntities({ location: center, maxDistance: opts.radius })) {
          if (!targetable(player, e) || seen.has(e.id)) continue;
          if (opts.horizontal && Math.abs(e.location.y + 1 - center.y) > 2.2) continue;
          seen.add(e.id);
          hit(e);
        }
      } catch (err) {}
    }, 1);
    track(player, id);
  }

  function castFalseGetsuga(player) {
    if (!api.tryUseSkill(player, cfg.base.getsuga)) return;
    world.sendMessage(`§8${player.name} §7usou §fFalse Getsuga§7!`);
    fireWave(player, {
      damage: cfg.damage.falseGetsuga,
      range: cfg.falseGetsuga.range,
      speed: cfg.falseGetsuga.speed,
      radius: cfg.falseGetsuga.radius,
      core: DARK,
      edge: FIRE,
      horizontal: false,
      pitch: 0.7,
    });
  }

  function castFullGetsuga(player) {
    if (!api.tryUseSkill(player, cfg.awk.getsuga)) return;
    world.sendMessage(`§b${player.name} §7usou §fFullbringer Getsuga§7!`);
    const dim = player.dimension;
    const dir = api.forwardDirection(player);
    const perp = { x: -dir.z, z: dir.x };
    const o = player.location;
    const center = { x: o.x + dir.x * 1.8, y: o.y + 1.1, z: o.z + dir.z * 1.8 };
    const g = cfg.fullGetsuga;
    const seen = new Set();
    const hit = damageOf(player, cfg.damage.fullGetsuga);
    let travelled = 0;
    let tick = 0;

    // arco de meia-lua no plano horizontal, "scale" encolhe pros aneis de dentro
    const arc = (c, scale, name, points, back) => {
      for (let i = -points; i <= points; i++) {
        const th = (i / points) * (Math.PI / 2.1);
        const lat = Math.sin(th) * g.radius * scale;
        const bk = (1 - Math.cos(th)) * g.radius * 0.95 * scale;
        fx(dim, name, {
          x: c.x - dir.x * (bk + back) + perp.x * lat,
          y: c.y,
          z: c.z - dir.z * (bk + back) + perp.z * lat,
        });
      }
    };

    // estouro na saida: anel de faiscas e onda de choque
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * Math.PI * 2;
      fx(dim, SPARK, { x: o.x + Math.cos(a) * 1.6, y: o.y + 1, z: o.z + Math.sin(a) * 1.6 });
    }
    fx(dim, "minecraft:huge_explosion_emitter", { x: center.x, y: center.y, z: center.z });
    sound(dim, "mob.warden.sonic_boom", o, 1.2, 1.1);
    sound(dim, "item.trident.thunder", o, 1, 1.3);

    const id = system.runInterval(() => {
      tick++;
      if (!alive(player) || travelled >= g.range) {
        stop(player, id);
        return;
      }
      center.x += dir.x * g.speed;
      center.z += dir.z * g.speed;
      travelled += g.speed;
      if (solidAt(dim, center)) {
        // bateu na parede: estouro grande
        fx(dim, "minecraft:huge_explosion_emitter", center);
        for (let i = 0; i < 40; i++) fx(dim, SPARK, center);
        sound(dim, "random.explode", center, 1.2, 0.9);
        stop(player, id);
        return;
      }
      // camadas: borda ciano, miolo branco, nucleo azul - bem mais densas que antes
      arc(center, 1.0, "isshin:azul", 26, 0);
      arc(center, 0.86, SPARK, 22, 0.15);
      arc(center, 0.7, "ichigo:getsuga", 16, 0.3);
      arc(center, 0.5, SPARK, 12, 0.45);
      // rastro: copias mais fracas do arco ficando pra tras
      arc(center, 0.95, "isshin:azul", 14, g.speed * 1.0);
      arc(center, 0.9, "isshin:azul", 10, g.speed * 2.0);
      arc(center, 0.85, SPARK, 8, g.speed * 3.0);
      // faiscas e raios soltos ao redor da lamina
      for (let i = 0; i < 14; i++) {
        const lat = (Math.random() * 2 - 1) * g.radius * 1.05;
        const th = Math.asin(Math.max(-1, Math.min(1, lat / (g.radius * 1.05))));
        const bk = (1 - Math.cos(th)) * g.radius * 0.95;
        fx(dim, i % 3 === 0 ? "minecraft:electric_spark_particle" : SPARK, {
          x: center.x - dir.x * bk + perp.x * lat + (Math.random() - 0.5) * 0.8,
          y: center.y + (Math.random() - 0.5) * 1.8,
          z: center.z - dir.z * bk + perp.z * lat + (Math.random() - 0.5) * 0.8,
        });
      }
      // talho vertical brilhante na ponta e poeira levantada no chao
      fx(dim, CUT_BLUE, { x: center.x + dir.x * 0.4, y: center.y, z: center.z + dir.z * 0.4 });
      if (tick % 2 === 0) {
        const lat = (Math.random() * 2 - 1) * g.radius * 0.8;
        fx(dim, "minecraft:large_explosion", { x: center.x + perp.x * lat, y: o.y + 0.2, z: center.z + perp.z * lat });
      }
      if (tick % 3 === 0) sound(dim, "mob.wither.shoot", center, 0.5, 1.7);
      try {
        for (const e of dim.getEntities({ location: center, maxDistance: g.radius })) {
          if (!targetable(player, e) || seen.has(e.id)) continue;
          if (Math.abs(e.location.y + 1 - center.y) > 2.4) continue;
          seen.add(e.id);
          hit(e);
          const l = e.location;
          fx(dim, "minecraft:huge_explosion_emitter", { x: l.x, y: l.y + 1, z: l.z });
          for (let k = 0; k < 12; k++) fx(dim, SPARK, { x: l.x, y: l.y + 1, z: l.z });
        }
      } catch (err) {}
    }, 1);
    track(player, id);
  }

  /* ---------- Triple Action ---------- */

  function castTriple(player) {
    const dim = player.dimension;
    const targets = [];
    try {
      for (const e of dim.getEntities({ location: player.location, maxDistance: cfg.triple.radius })) {
        if (targetable(player, e)) targets.push(e);
      }
    } catch (err) {}
    if (targets.length === 0) {
      player.sendMessage("§7Nenhum alvo num raio de 5 blocos.");
      return;
    }
    if (!api.tryUseSkill(player, cfg.awk.triple)) return;
    world.sendMessage(`§b${player.name} §7usou §fTriple Action§7!`);
    const hit = damageOf(player, cfg.damage.triple);
    // os cortes vao de alvo em alvo, em sequencia, em vez de tudo no mesmo instante
    const stagger = Math.max(1, Math.min(3, Math.floor(8 / targets.length)));

    const cutTarget = (e, round) => {
      if (!alive(e) || !alive(player) || !mine(player)) return;
      const from = player.location;
      const c = e.location;
      const center = { x: c.x, y: c.y + 1, z: c.z };
      // rastro do golpe: do player ate o alvo
      streak(dim, { x: from.x, y: from.y + 1.1, z: from.z }, center, "isshin:azul", 8);
      streak(dim, { x: from.x, y: from.y + 1.1, z: from.z }, center, SPARK, 4);
      // tres talhos cruzados no corpo (um a cada angulo) - o "X" mais um corte reto
      for (let k = 0; k < 3; k++) {
        cutAt(dim, { x: center.x + (Math.random() - 0.5) * 0.7, y: center.y + (Math.random() - 0.5) * 0.9, z: center.z + (Math.random() - 0.5) * 0.7 }, true);
      }
      for (let k = 0; k < 6; k++) fx(dim, SPARK, center);
      fx(dim, "ichigo:reiatsu", center);
      sound(dim, "item.trident.hit", c, 1, 1.2 + round * 0.25);
      sound(dim, "mob.wither.shoot", c, 0.35, 1.9);
      hit(e);
    };

    let round = 0;
    const doRound = () => {
      const r = round;
      targets.forEach((e, i) => {
        if (i === 0) cutTarget(e, r);
        else system.runTimeout(() => cutTarget(e, r), i * stagger);
      });
      round++;
    };
    doRound();
    // so termina quando todo mundo do raio levou os tres cortes
    const id = system.runInterval(() => {
      if (round >= cfg.triple.cuts || !alive(player) || !mine(player)) {
        stop(player, id);
        return;
      }
      doRound();
    }, cfg.triple.gapTicks);
    track(player, id);
  }

  /* ---------- Bringer Light ---------- */

  function castLight(player) {
    if (!api.tryUseSkill(player, cfg.awk.light)) return;
    world.sendMessage(`§a${player.name} §7usou §fBringer Light§7!`);
    const dim = player.dimension;
    const dir = api.forwardDirection(player);
    const strength = api.dashStrength * cfg.light.strengthMultiplier;
    sound(dim, "mob.enderdragon.flap", player.location, 1, 1.8);
    let n = 0;
    const id = system.runInterval(() => {
      if (n >= cfg.light.pushes || !alive(player) || !mine(player)) {
        stop(player, id);
        return;
      }
      n++;
      try {
        player.applyKnockback({ x: dir.x * strength, z: dir.z * strength }, n === 1 ? 0.15 : 0);
      } catch (err) {}
      const p = player.location;
      for (let i = 0; i < 5; i++) {
        const at = {
          x: p.x + (Math.random() - 0.5) * 1.2,
          y: p.y + 0.2 + Math.random() * 1.8,
          z: p.z + (Math.random() - 0.5) * 1.2,
        };
        fx(dim, "minecraft:villager_happy", at);
        if (i % 2 === 0) fx(dim, "minecraft:electric_spark_particle", at);
      }
    }, 1);
    track(player, id);
    try {
      player.addEffect("speed", cfg.light.speedTicks, {
        amplifier: cfg.light.speedAmplifier,
        showParticles: false,
      });
    } catch (err) {}
  }

  /* ---------- Pierce ---------- */

  function nearestTarget(player) {
    let best;
    let bestDist = Infinity;
    try {
      const o = player.location;
      for (const e of player.dimension.getEntities({ location: o, maxDistance: cfg.pierce.range })) {
        if (!targetable(player, e)) continue;
        const d = Math.hypot(e.location.x - o.x, e.location.y - o.y, e.location.z - o.z);
        if (d < bestDist) {
          best = e;
          bestDist = d;
        }
      }
    } catch (err) {}
    return best;
  }

  function castPierce(player) {
    const target = nearestTarget(player);
    if (!target) {
      player.sendMessage("§7Nenhum alvo ao alcance do Pierce.");
      return;
    }
    if (!api.tryUseSkill(player, cfg.awk.pierce)) return;
    world.sendMessage(`§b${player.name} §7usou §fPierce§7!`);
    const dim = player.dimension;
    const hit = damageOf(player, cfg.damage.pierce, { ignoresReduction: true });

    // impacto: coluna de luz, aneis de choque expandindo, lanca de talhos cruzados
    const impact = (goal) => {
      hit(target);
      fx(dim, "minecraft:huge_explosion_emitter", goal);
      sound(dim, "mob.warden.sonic_boom", goal, 1.3, 1.3);
      sound(dim, "random.explode", goal, 1, 1.1);
      for (let k = 0; k < 5; k++) cutAt(dim, { x: goal.x + (Math.random() - 0.5) * 0.8, y: goal.y + (Math.random() - 0.5) * 1.2, z: goal.z + (Math.random() - 0.5) * 0.8 }, true);
      for (let y = 0; y < 8; y += 0.5) {
        fx(dim, "isshin:azul", { x: goal.x, y: goal.y - 1 + y, z: goal.z });
        fx(dim, SPARK, { x: goal.x + (Math.random() - 0.5) * 0.6, y: goal.y - 1 + y, z: goal.z + (Math.random() - 0.5) * 0.6 });
      }
      for (let ring = 1; ring <= 6; ring++) {
        system.runTimeout(() => {
          const r = ring * 1.1;
          const n = 16 + ring * 6;
          for (let i = 0; i < n; i++) {
            const a = (i / n) * Math.PI * 2;
            const at = { x: goal.x + Math.cos(a) * r, y: goal.y - 0.6 + ring * 0.05, z: goal.z + Math.sin(a) * r };
            fx(dim, i % 2 ? SPARK : "isshin:azul", at);
            if (i % 5 === 0) fx(dim, "minecraft:electric_spark_particle", at);
          }
        }, ring);
      }
    };

    // carga de 6 ticks: energia converge no player e uma lanca se forma na frente
    let charge = 0;
    const startPos = player.location;
    sound(dim, "beacon.activate", startPos, 1, 1.8);
    const chargeId = system.runInterval(() => {
      charge++;
      if (!alive(player) || !mine(player) || !alive(target)) {
        stop(player, chargeId);
        return;
      }
      const p = player.location;
      const dirT = { x: target.location.x - p.x, z: target.location.z - p.z };
      const l = Math.hypot(dirT.x, dirT.z) || 1;
      const d = { x: dirT.x / l, z: dirT.z / l };
      const rad = 3.2 - charge * 0.45;
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2 + charge * 0.5;
        fx(dim, i % 2 ? SPARK : "isshin:azul", { x: p.x + Math.cos(a) * rad, y: p.y + 1 + Math.sin(a * 2) * 0.6, z: p.z + Math.sin(a) * rad });
      }
      // a lanca se formando a frente
      for (let s = 0; s < charge * 2; s++) {
        fx(dim, s % 3 === 0 ? "ichigo:getsuga" : "isshin:azul", { x: p.x + d.x * (1 + s * 0.35), y: p.y + 1.1, z: p.z + d.z * (1 + s * 0.35) });
      }
      if (charge >= 6) {
        stop(player, chargeId);
        launch();
      }
    }, 1);
    track(player, chargeId);

    function launch() {
      sound(dim, "mob.endermen.portal", player.location, 1, 1.7);
      sound(dim, "item.trident.throw", player.location, 1, 1.4);
      fx(dim, "minecraft:huge_explosion_emitter", { x: player.location.x, y: player.location.y + 1, z: player.location.z });
      let n = 0;
      const id = system.runInterval(() => {
        n++;
        if (n > cfg.pierce.maxTicks || !alive(player) || !mine(player) || !alive(target)) {
          stop(player, id);
          return;
        }
        const me = player.location;
        const t = target.location;
        const goal = { x: t.x, y: t.y + 0.9, z: t.z };
        const dx = goal.x - me.x;
        const dy = goal.y - (me.y + 0.9);
        const dz = goal.z - me.z;
        const d = Math.hypot(dx, dy, dz);
        if (d <= 2.3) {
          impact(goal);
          stop(player, id);
          return;
        }
        const step = Math.min(cfg.pierce.step, d - 1.6);
        const ux = dx / d, uy = dy / d, uz = dz / d;
        const next = { x: me.x + ux * step, y: me.y + uy * step, z: me.z + uz * step };
        // eixos perpendiculares pra desenhar a helice em volta do caminho
        const px = -uz, pz = ux;
        const pl = Math.hypot(px, pz) || 1;
        const hx = px / pl, hz = pz / pl;
        const samples = 12;
        for (let k = 0; k <= samples; k++) {
          const f = k / samples;
          const c = { x: me.x + (next.x - me.x) * f, y: me.y + 1 + (next.y - me.y) * f, z: me.z + (next.z - me.z) * f };
          const ang = (n * 3 + k) * 0.9;
          const off = Math.cos(ang) * 0.75;
          const up = Math.sin(ang) * 0.75;
          fx(dim, "isshin:azul", c);
          fx(dim, k % 2 ? SPARK : "ichigo:getsuga", { x: c.x + hx * off, y: c.y + up, z: c.z + hz * off });
          fx(dim, SPARK, { x: c.x - hx * off, y: c.y - up, z: c.z - hz * off });
          if (k % 4 === 0) fx(dim, "minecraft:electric_spark_particle", c);
        }
        // um talho grande atravessando o caminho a cada passo
        cutAt(dim, { x: (me.x + next.x) / 2, y: me.y + 1 + (next.y - me.y) / 2, z: (me.z + next.z) / 2 }, true);
        try {
          player.teleport(next, { keepVelocity: false, facingLocation: goal });
        } catch (err) {}
      }, 1);
      track(player, id);
    }
  }

  /* ---------- despacho / ciclo de vida ---------- */

  function cast(player, typeId) {
    switch (typeId) {
      case cfg.base.cuts:
        return castCuts(player);
      case cfg.base.shadow:
        return castShadow(player);
      case cfg.base.boomerang:
        return castBoomerang(player);
      case cfg.base.getsuga:
        return castFalseGetsuga(player);
      case cfg.awk.triple:
        return castTriple(player);
      case cfg.awk.getsuga:
        return castFullGetsuga(player);
      case cfg.awk.light:
        return castLight(player);
      case cfg.awk.pierce:
        return castPierce(player);
    }
  }

  function clearState(id, player) {
    const set = running.get(id);
    if (set) {
      for (const timer of set) {
        try {
          system.clearRun(timer);
        } catch (err) {}
      }
      running.delete(id);
    }
    if (player) endShadow(player, true);
    else shadows.delete(id);
  }

  function reset(player) {
    clearState(player.id, player);
  }

  function leave(id) {
    clearState(id);
  }

  return { cast, blocksDamage, reset, leave };
}
