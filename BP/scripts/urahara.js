import { world, system, InputPermissionCategory } from "@minecraft/server";

export const URAHARA = {
  damage: { m1: 95, awakenedM1: 120, nake: 350, kirisaki: 540, orb: 200, shibari: 230, beam: 15 },
  cooldowns: {
    "urahara:nake": 200, "urahara:kirisaki": 500, "urahara:chikasumi": 400,
    "urahara:hiasobi": 700, "urahara:juzutsunagi": 200,
    "urahara:shibari": 400, "urahara:hado_91": 1200,
    "urahara:hyappo_rankan": 600, "urahara:kin": 3000,
  },
  names: {
    "urahara:nake": "Nake, Benihime", "urahara:kirisaki": "Kirisaki, Benihime",
    "urahara:chikasumi": "Chikasumi no Tate, Benihime", "urahara:hiasobi": "Hiasobi, Benihime",
    "urahara:juzutsunagi": "Juzutsunagi", "urahara:shibari": "Shibari, Benihime",
    "urahara:hado_91": "Hadō #91 — Senjū Kōten Taihō", "urahara:hyappo_rankan": "Bakudō #62 — Hyappo Rankan",
    "urahara:kin": "Bakudō #99 — Kin",
  },
  shield: { duration: 200, maxTier: 6 },
  orbs: { count: 5, duration: 300, range: 36, radius: 2.1, blastRadius: 3 },
  shibari: { range: 30, duration: 100 },
  hado: { range: 40, duration: 400, every: 4, blastRadius: 5 },
  rankan: { range: 36, duration: 200, flightTicks: 40, speed: 1.8 },
  kin: { range: 4, maxTier: 7, wait: 2400, impale: 200 },
  cut: { radius: 4.5, bulge: 1.8, thickness: 1.8, lateral: 1.4, speed: 3, range: 36,
    subSteps: 4, startAhead: 1.2, cancelsUpToTier: -1 },
  look: { coreParticle: "urahara:sangue", edgeParticle: "urahara:lamina", boltParticle: "urahara:faisca",
    points: 21, litePoints: 11, bolts: 2, boltSegments: 4, boltStep: .65 },
};

export function createUrahara(api) {
  const SEAL = "mv:urahara_kin_seal";
  const LOCK = "mv:urahara_hold";
  const shields = new Map(), orbits = new Map(), holds = new Map(), kin = new Map();
  const generations = new Map();
  const char = e => { try { return api.getActiveCharacter(e)?.id; } catch { return undefined; } };
  const alive = e => { try { return !!e && !api.isDownOrGone(e); } catch { return false; } };
  const isUrahara = e => char(e) === "urahara";
  const generation = e => generations.get(e.id) ?? 0;
  const active = (e, token) => alive(e) && isUrahara(e) && generation(e) === token;
  const sameDim = (a, b) => a.dimension.id === b.dimension.id;
  const copy = p => ({ x: p.x, y: p.y, z: p.z });
  const body = e => ({ x: e.location.x, y: e.location.y + 1.1, z: e.location.z });
  const unit = d => { const n = Math.hypot(d.x, d.y, d.z) || 1; return { x: d.x / n, y: d.y / n, z: d.z / n }; };
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const particle = (dim, id, p) => { try { dim.spawnParticle(id, p); } catch {} };
  const sound = (dim, id, p, pitch = 1, volume = 1) => { try { dim.playSound(id, p, { pitch, volume }); } catch {} };
  const remove = e => { try { e?.remove(); } catch {} };
  const valid = e => { try { return !!e && e.isValid !== false && !!e.location; } catch { return false; } };
  const query = (dim, p, r) => { try { return dim.getEntities({ location: p, maxDistance: r }); } catch { return []; } };
  const isSealed = e => { try { return typeof e?.getDynamicProperty(SEAL) === "string"; } catch { return false; } };
  const isBound = e => holds.has(e?.id) || isSealed(e);

  function say(player, item) {
    world.sendMessage(`§2${player.name}: §c§l${URAHARA.names[item]}`);
    try { api.playVizardAnimation(player, item === "urahara:kirisaki" ? "slash" : "cast"); } catch {}
  }
  function aim(player, range) {
    const target = api.targetInView(player, range);
    if (!alive(target) || target.id === player.id || target.typeId.startsWith("urahara:")) {
      player.sendMessage("§7Mire em um alvo dentro do alcance.");
      return undefined;
    }
    return target;
  }
  function line(dim, a, b, id = "urahara:lamina", step = .6) {
    const count = Math.min(42, Math.max(1, Math.ceil(distance(a, b) / step)));
    for (let i = 0; i <= count; i++) {
      const t = i / count;
      particle(dim, id, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    }
  }
  function burst(dim, at, radius, gold = false) {
    for (let i = 0; i < 18; i++) {
      const angle = i * Math.PI / 9, r = radius * (.4 + (i % 3) * .27);
      particle(dim, gold ? "urahara:kido" : i % 3 ? "urahara:sangue" : "urahara:faisca", {
        x: at.x + Math.cos(angle) * r, y: at.y + Math.sin(i * 1.7) * radius * .5, z: at.z + Math.sin(angle) * r,
      });
    }
    particle(dim, "minecraft:large_explosion", at);
  }
  function spawnVisual(type, dim, at, yaw = 0) {
    try { const e = dim.spawnEntity(type, at); e.teleport(at, { rotation: { x: 0, y: yaw }, keepVelocity: false }); return e; }
    catch { return undefined; }
  }
  function permission(player, category) {
    try { return player.inputPermissions.isPermissionCategoryEnabled(category); } catch { return true; }
  }
  function setPermission(player, category, enabled) {
    try { player.inputPermissions.setPermissionCategory(category, enabled); } catch {}
  }

  // Coordenada fixa, nao apenas Slowness: nem knockback desloca o alvo.
  function bind(target, ticks, style, anchor = target.location, dimension = target.dimension, previous) {
    const old = holds.get(target.id);
    if (old) {
      old.until = Math.max(old.until, system.currentTick + ticks);
      if (style === "sealed") { old.style = style; old.anchor = copy(anchor); old.dim = dimension; }
      return old;
    }
    const state = { target, anchor: copy(anchor), dim: dimension, until: system.currentTick + ticks,
      style, character: char(target), part: undefined,
      movement: previous?.movement ?? permission(target, InputPermissionCategory.Movement),
      jump: previous?.jump ?? permission(target, InputPermissionCategory.Jump) };
    holds.set(target.id, state);
    try { target.setDynamicProperty(LOCK, JSON.stringify({ movement: state.movement, jump: state.jump })); } catch {}
    return state;
  }
  function release(target, clearSeal = true) {
    const state = holds.get(target.id);
    const hadSeal = isSealed(target);
    holds.delete(target.id);
    remove(state?.part);
    let saved = state;
    try { if (!saved) saved = JSON.parse(target.getDynamicProperty(LOCK) ?? "null"); } catch {}
    try {
      target.setDynamicProperty(LOCK, undefined);
      if (clearSeal) target.setDynamicProperty(SEAL, undefined);
      if (state?.style === "sealed" || (clearSeal && hadSeal)) {
        target.removeEffect("mining_fatigue");
      }
      target.clearVelocity();
    } catch {}
    if (saved) {
      setPermission(target, InputPermissionCategory.Movement, saved.movement !== false);
      if (!api.otherJumpLock(target)) setPermission(target, InputPermissionCategory.Jump, saved.jump !== false);
    }
  }
  function holdAt(state) {
    const e = state.target;
    try {
      e.clearVelocity();
      e.teleport(state.anchor, { dimension: state.dim, keepVelocity: false });
      e.clearVelocity();
      setPermission(e, InputPermissionCategory.Movement, false);
      setPermission(e, InputPermissionCategory.Jump, false);
    } catch { return false; }
    if (state.style === "sealed") {
      if (!valid(state.part)) {
        state.part = spawnVisual("urahara:kin_cross", state.dim, state.anchor);
        try { state.part?.setDynamicProperty("urahara:target", e.id); } catch {}
      }
      if (system.currentTick % 20 === 0) {
        try { e.addEffect("mining_fatigue", 20000000, { amplifier: 255, showParticles: false }); } catch {}
      }
    } else if (system.currentTick % 5 === 0) {
      const c = body(e);
      if (state.style === "rankan") {
        for (let i = 0; i < 6; i++) {
          const a = i * Math.PI / 3;
          line(state.dim, { x: c.x + Math.cos(a) * 2, y: c.y + 1, z: c.z + Math.sin(a) * 2 }, c, "urahara:kido", .5);
        }
      } else if (state.style === "net") {
        for (let i = -2; i <= 2; i++) {
          line(state.dim, { x: c.x - 1.2, y: c.y + i * .5, z: c.z - 1 }, { x: c.x + 1.2, y: c.y + i * .5, z: c.z + 1 }, "urahara:fio", .4);
          line(state.dim, { x: c.x + i * .5, y: c.y - 1, z: c.z - 1 }, { x: c.x + i * .5, y: c.y + 1.5, z: c.z + 1 }, "urahara:fio", .4);
        }
      } else {
        // Cruzes vermelhas aparecem nas costas na fase de empalamento.
        const view = e.getViewDirection(), p = { x: c.x - view.x * .7, y: c.y, z: c.z - view.z * .7 };
        for (const shift of [-.65, .65]) {
          const x = p.x + view.z * shift, z = p.z - view.x * shift;
          line(state.dim, { x, y: p.y - .7, z }, { x, y: p.y + 1.8, z }, "urahara:lamina", .28);
          line(state.dim, { x: x - view.z * .6, y: p.y + 1, z: z + view.x * .6 }, { x: x + view.z * .6, y: p.y + 1, z: z - view.x * .6 }, "urahara:lamina", .25);
        }
      }
    }
    return true;
  }

  function shield(player) {
    if (!api.tryUseSkill(player, "urahara:chikasumi")) return;
    const old = shields.get(player.id); remove(old?.part);
    shields.set(player.id, { player, until: system.currentTick + URAHARA.shield.duration,
      part: spawnVisual("urahara:blood_shield", player.dimension, player.location, player.getRotation().y) });
    say(player, "urahara:chikasumi");
    sound(player.dimension, "beacon.activate", player.location, .65, 1.3);
  }
  function blocksDamage(target, source) {
    const shield = shields.get(target?.id);
    if (!shield || shield.until <= system.currentTick || source?.id === target.id || !source) return false;
    if (api.tierOfPlayer(source) > URAHARA.shield.maxTier) return false;
    particle(target.dimension, "urahara:sangue", body(target));
    if (system.currentTick % 4 === 0) sound(target.dimension, "random.glass", target.location, .7, .55);
    return true;
  }

  function orbPoints(state) {
    const c = body(state.target), spin = (system.currentTick - state.started) * .055;
    return Array.from({ length: URAHARA.orbs.count }, (_, i) => {
      const angle = spin + i * Math.PI * 2 / URAHARA.orbs.count;
      return { x: c.x + Math.cos(angle) * URAHARA.orbs.radius, y: c.y + .45 + Math.sin(angle * 2) * .6, z: c.z + Math.sin(angle) * URAHARA.orbs.radius };
    });
  }
  function hiasobi(player) {
    const target = aim(player, URAHARA.orbs.range);
    if (!target || !api.tryUseSkill(player, "urahara:hiasobi")) return;
    orbits.set(player.id, { player, target, until: system.currentTick + URAHARA.orbs.duration, started: system.currentTick });
    say(player, "urahara:hiasobi");
    sound(player.dimension, "mob.evocation_illager.prepare_attack", target.location, 1.5);
  }
  function detonate(player) {
    const state = orbits.get(player.id);
    if (!state || system.currentTick >= state.until || !alive(state.target) || !sameDim(player, state.target)) {
      player.sendMessage("§7Use Hiasobi primeiro: não há esferas ativas para detonar."); return;
    }
    if (!api.tryUseSkill(player, "urahara:juzutsunagi")) return;
    orbits.delete(player.id);
    say(player, "urahara:juzutsunagi");
    const dim = state.target.dimension, totals = new Map();
    for (const point of orbPoints(state)) {
      burst(dim, point, 2);
      for (const e of query(dim, point, URAHARA.orbs.blastRadius + 2)) {
        if (e.id === player.id || !alive(e) || distance(body(e), point) > URAHARA.orbs.blastRadius) continue;
        const entry = totals.get(e.id) ?? { e, damage: 0 };
        entry.damage += URAHARA.damage.orb; totals.set(e.id, entry);
      }
    }
    // Uma aplicacao por vitima conserva 5 x 200 sem perder explosoes nos i-frames.
    for (const { e, damage } of totals.values()) api.dealDamage(e, damage * api.dmgMultiplier(player), player);
    sound(dim, "random.explode", body(state.target), .65, 2);
    api.shakeNear(dim, state.target.location, 18, .25, .3);
  }

  function shibari(player) {
    const target = aim(player, URAHARA.shibari.range);
    if (!target || !api.tryUseSkill(player, "urahara:shibari")) return;
    say(player, "urahara:shibari");
    line(player.dimension, body(player), body(target), "urahara:fio");
    if (api.isIntocable(target) || blocksDamage(target, player)) return;
    api.dealDamage(target, URAHARA.damage.shibari * api.dmgMultiplier(player), player);
    if (alive(target)) bind(target, URAHARA.shibari.duration, "net");
  }
  function hado(player) {
    const target = aim(player, URAHARA.hado.range);
    if (!target || !api.tryUseSkill(player, "urahara:hado_91")) return;
    say(player, "urahara:hado_91");
    const token = generation(player), dim = player.dimension, pending = new Map();
    let elapsed = 0, beam = 0;
    const flush = () => {
      for (const { target: e, amount } of pending.values()) if (alive(e)) api.dealDamage(e, amount * api.dmgMultiplier(player), player);
      pending.clear();
    };
    const timer = system.runInterval(() => {
      if (!active(player, token) || !alive(target) || !sameDim(player, target)) { system.clearRun(timer); pending.clear(); return; }
      elapsed += URAHARA.hado.every;
      const c = body(target), a = beam++ * 2.39996;
      const start = { x: c.x + Math.cos(a) * 9, y: c.y + 6 + Math.sin(a * 2) * 3, z: c.z + Math.sin(a) * 9 };
      line(dim, start, c, "urahara:kido", .65);
      // Trilho duplo por feixe: cem impactos, duzentos rastros luminosos.
      line(dim, { x: start.x + .3, y: start.y, z: start.z }, { x: c.x + .3, y: c.y, z: c.z }, "urahara:brilho", .85);
      burst(dim, c, URAHARA.hado.blastRadius, true);
      sound(dim, "random.explode", c, 1.5, .45);
      for (const e of query(dim, c, URAHARA.hado.blastRadius + 2)) {
        if (e.id === player.id || !alive(e) || distance(body(e), c) > URAHARA.hado.blastRadius) continue;
        const hit = pending.get(e.id) ?? { target: e, amount: 0 };
        hit.amount += URAHARA.damage.beam; pending.set(e.id, hit);
      }
      if (elapsed % 20 === 0) { flush(); api.shakeNear(dim, c, 22, .15, .2); }
      if (elapsed >= URAHARA.hado.duration) { flush(); system.clearRun(timer); }
    }, URAHARA.hado.every);
  }
  function rankan(player) {
    const target = aim(player, URAHARA.rankan.range);
    if (!target || !api.tryUseSkill(player, "urahara:hyappo_rankan")) return;
    say(player, "urahara:hyappo_rankan");
    const token = generation(player), dim = player.dimension;
    const shot = api.trackAttack(player, .8);
    let pos = body(player), ticks = 0;
    const timer = system.runInterval(() => {
      if (!active(player, token) || !alive(target) || !sameDim(player, target) || shot.cancelled || ++ticks > URAHARA.rankan.flightTicks) {
        shot.cancelled = true; system.clearRun(timer); return;
      }
      const to = body(target), dist = distance(pos, to), d = unit({ x: to.x - pos.x, y: to.y - pos.y, z: to.z - pos.z });
      const next = { x: pos.x + d.x * Math.min(dist, URAHARA.rankan.speed), y: pos.y + d.y * Math.min(dist, URAHARA.rankan.speed), z: pos.z + d.z * Math.min(dist, URAHARA.rankan.speed) };
      const side = unit({ x: d.z, y: 0, z: -d.x });
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3, offset = Math.cos(a) * .8;
        const head = { x: next.x + side.x * offset, y: next.y + Math.sin(a) * .8, z: next.z + side.z * offset };
        line(dim, { x: head.x - d.x * 2, y: head.y - d.y * 2, z: head.z - d.z * 2 }, head, "urahara:kido", .45);
      }
      pos = next; api.touchAttack(shot, pos);
      if (dist <= URAHARA.rankan.speed + .7) {
        shot.cancelled = true; system.clearRun(timer);
        if (api.isIntocable(target) || blocksDamage(target, player)) return;
        bind(target, URAHARA.rankan.duration, "rankan");
        sound(dim, "random.anvil_land", target.location, 1.6, .75);
        if (target.typeId === "minecraft:player") target.sendMessage("§eHyappo Rankan fixou você nesta coordenada por 10 segundos.");
      }
    }, 1);
  }

  function implantKin(player) {
    const target = aim(player, URAHARA.kin.range);
    if (!target) return;
    if (target.typeId !== "minecraft:player" || !char(target) || api.tierOfPlayer(target) > URAHARA.kin.maxTier) {
      player.sendMessage("§7Kin só pode ser implantado em personagens de Tier 7 ou inferior, bem perto."); return;
    }
    if (isSealed(target) || kin.has(player.id) || [...kin.values()].some(s => s.target.id === target.id)) {
      player.sendMessage("§7Já existe um Kin aguardando neste alvo ou lançado por você."); return;
    }
    if (!api.tryUseSkill(player, "urahara:kin")) return;
    kin.set(player.id, { owner: player, target, targetCharacter: char(target), token: generation(player),
      phase: "pending", deadline: system.currentTick + URAHARA.kin.wait });
    say(player, "urahara:kin");
    particle(target.dimension, "urahara:selo", body(target));
    player.sendMessage("§cKin implantado. Sobreviva por 2 minutos para ativá-lo.");
    target.sendMessage("§cUma marca de Kidō foi implantada em você.");
  }
  function finishSeal(state) {
    const target = state.target, anchor = copy(target.location), dim = target.dimension;
    const held = bind(target, Infinity, "sealed", anchor, dim);
    try {
      target.setDynamicProperty(SEAL, JSON.stringify({ anchor, dim: dim.id, character: char(target), movement: held.movement, jump: held.jump }));
      target.addEffect("mining_fatigue", 20000000, { amplifier: 255, showParticles: false });
      target.sendMessage("§f§lBakudō #99 — Kin. §r§7O selo termina ao desativar seu personagem ou morrer.");
    } catch {}
    burst(dim, body(target), 3, true);
    sound(dim, "random.anvil_land", anchor, .45, 2);
    holdAt(held);
  }
  function hydrate(player) {
    if (!isSealed(player) || holds.has(player.id)) return;
    try {
      const data = JSON.parse(player.getDynamicProperty(SEAL));
      if (data.character !== char(player) || !alive(player)) { release(player); return; }
      bind(player, Infinity, "sealed", data.anchor, world.getDimension(data.dim), data);
    } catch { release(player); }
  }

  function cast(player, itemId) {
    if (!isUrahara(player) || isBound(player)) return;
    const awakenedSkill = ["urahara:shibari", "urahara:hado_91", "urahara:hyappo_rankan", "urahara:kin"].includes(itemId);
    if (api.isAwakened(player) !== awakenedSkill) return;
    switch (itemId) {
      case "urahara:nake":
        if (!api.tryUseSkill(player, itemId)) return;
        say(player, itemId); sound(player.dimension, "mob.blaze.shoot", player.location, .7, 1.4);
        api.fireEnergySphere(player, { radius: 1.1, range: 42, speed: 3, damage: URAHARA.damage.nake, particle: "urahara:sangue", shellParticles: 14 }); break;
      case "urahara:kirisaki":
        if (!api.tryUseSkill(player, itemId)) return;
        say(player, itemId); sound(player.dimension, "item.trident.throw", player.location, .65, 1.4);
        api.fireCrescent(player, URAHARA.cut, URAHARA.look, { damage: URAHARA.damage.kirisaki, horizontal: true }); break;
      case "urahara:chikasumi": shield(player); break;
      case "urahara:hiasobi": hiasobi(player); break;
      case "urahara:juzutsunagi": detonate(player); break;
      case "urahara:shibari": shibari(player); break;
      case "urahara:hado_91": hado(player); break;
      case "urahara:hyappo_rankan": rankan(player); break;
      case "urahara:kin": implantKin(player); break;
    }
  }

  function cleanupOwner(id) {
    generations.set(id, (generations.get(id) ?? 0) + 1);
    remove(shields.get(id)?.part); shields.delete(id); orbits.delete(id);
    // Apos 120s cumpridos, morrer na janela de empalamento nao desfaz o Kin.
    if (kin.get(id)?.phase === "pending") kin.delete(id);
  }
  function reset(player) {
    cleanupOwner(player.id);
    for (const [id, state] of kin) if (state.target.id === player.id) kin.delete(id);
    release(player);
  }
  function leave(id) {
    cleanupOwner(id);
    const state = holds.get(id);
    if (state) { remove(state.part); holds.delete(id); }
    for (const [key, pending] of kin) if (pending.target.id === id) kin.delete(key);
  }
  function onSpawn(player, initialSpawn) {
    if (!initialSpawn) reset(player);
    else if (isSealed(player)) hydrate(player);
    else release(player, false); // recupera input se desconectou durante um bind temporario
  }

  world.afterEvents.entityDie.subscribe(({ deadEntity }) => {
    if (isUrahara(deadEntity) || shields.has(deadEntity.id) || orbits.has(deadEntity.id) || kin.has(deadEntity.id)) cleanupOwner(deadEntity.id);
    for (const [id, state] of kin) if (state.target.id === deadEntity.id) kin.delete(id);
    release(deadEntity);
  });
  system.runInterval(() => {
    const now = system.currentTick;
    for (const p of world.getPlayers()) hydrate(p);
    for (const [id, state] of shields) {
      if (!alive(state.player) || !isUrahara(state.player) || now >= state.until) { remove(state.part); shields.delete(id); continue; }
      const p = state.player;
      if (!valid(state.part)) state.part = spawnVisual("urahara:blood_shield", p.dimension, p.location);
      try { state.part?.teleport(p.location, { dimension: p.dimension, rotation: { x: 0, y: p.getRotation().y }, keepVelocity: false }); } catch {}
      api.cancelAttacksNear(p, p.dimension, body(p), 2.2, URAHARA.shield.maxTier,
        { label: "Chikasumi no Tate", particles: ["urahara:sangue", "urahara:faisca"] });
    }
    for (const [id, state] of orbits) {
      if (!alive(state.player) || !isUrahara(state.player) || !alive(state.target) || !sameDim(state.player, state.target) || now >= state.until) { orbits.delete(id); continue; }
      if (now % 2 === 0) for (const p of orbPoints(state)) {
        particle(state.target.dimension, "urahara:esfera", p);
        for (let i = 0; i < 4; i++) {
          const a = now * .25 + i * Math.PI / 2;
          particle(state.target.dimension, "urahara:faisca", { x: p.x + Math.cos(a) * .3, y: p.y + Math.sin(a) * .3, z: p.z });
        }
      }
    }
    for (const [id, state] of kin) {
      if (!alive(state.target) || char(state.target) !== state.targetCharacter || api.tierOfPlayer(state.target) > URAHARA.kin.maxTier) {
        if (state.phase !== "pending") release(state.target);
        kin.delete(id); continue;
      }
      if (state.phase === "pending" && !active(state.owner, state.token)) { kin.delete(id); continue; }
      if (now < state.deadline) continue;
      if (state.phase === "pending") {
        state.phase = "impaling"; state.deadline = now + URAHARA.kin.impale;
        bind(state.target, URAHARA.kin.impale + 1, "impaling");
        sound(state.target.dimension, "item.trident.hit", state.target.location, .6, 1.5);
        state.target.sendMessage("§cAs cruzes do Kin te prenderam. O selo se fecha em 10 segundos.");
      } else { finishSeal(state); kin.delete(id); }
    }
    for (const [id, state] of holds) {
      if (!alive(state.target) || (state.target.typeId === "minecraft:player" && char(state.target) !== state.character) || now >= state.until) { release(state.target); continue; }
      if (!holdAt(state)) { remove(state.part); holds.delete(id); }
    }
    // Limpa entidades visuais orfas apos recarregar o mundo; o estado do player
    // e a fonte de verdade, portanto o selo pode ser reconstruido sem blocos.
    if (now % 40 === 0) for (const name of ["overworld", "nether", "the_end"]) {
      try {
        const dim = world.getDimension(name);
        for (const e of dim.getEntities({ type: "urahara:kin_cross" })) {
          if (![...holds.values()].some(s => s.part?.id === e.id)) remove(e);
        }
        for (const e of dim.getEntities({ type: "urahara:blood_shield" })) {
          if (![...shields.values()].some(s => s.part?.id === e.id)) remove(e);
        }
      } catch {}
    }
  }, 1);

  return { cast, isBound, isSealed, blocksDamage, reset, leave, onSpawn };
}
