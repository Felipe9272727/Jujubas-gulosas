import { world, system, ItemStack, EquipmentSlot, InputPermissionCategory } from "@minecraft/server";

// Shinji is isolated from the legacy roster. All damage still goes through
// the addon's virtual-health/block/mark pipeline.
export const SHINJI = Object.freeze({
  tripleDamage: 200, rushDamage: 300, ceroDamage: 400,
  maskTicks: 600, inversionTicks: 300, inversionRange: 30,
  rushRange: 24, rushSteps: 5, ceroRange: 38, ceroRadius: 2.6,
});
const COOLDOWNS = {
  "shinji:triple_slash": 400, "shinji:sakanas_cut": 500,
  "shinji:hollow_mask": 1300, "shinji:cero": 200,
};
const LABELS = {
  "shinji:triple_slash": "Triple Slash", "shinji:sakanas_cut": "Sakana's Cut",
  "shinji:hollow_mask": "Hollow Mask", "shinji:cero": "Cero",
};
const RECOVERY = "shinji:input_restore";
const MASK_ITEM = "shinji:mask_visual";
const GOLD = "shinji:gold", RED = "shinji:red", WHITE = "shinji:white";
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const wrap = x => ((x + 180) % 360 + 360) % 360 - 180;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export function invertedRotation(rotation) {
  // Equivalent to a 180 degree roll without an unsupported rotation.z:
  // Ry(yaw + 180) Rx(180 - pitch) preserves the forward vector, flips up/right.
  return { x: wrap(180 - rotation.x), y: wrap(rotation.y + 180) };
}
export function reversedMovement(input, yaw, speed) {
  const a = yaw * Math.PI / 180;
  const magnitude = Math.max(1, Math.hypot(input.x, input.y));
  // Bedrock movement vector: x positive = left, y positive = forward.
  const x = input.x / magnitude, y = input.y / magnitude;
  return { x: (Math.sin(a) * y - Math.cos(a) * x) * speed,
    z: (-Math.cos(a) * y - Math.sin(a) * x) * speed };
}

export function createShinji(api) {
  const states = new Map();
  const inversions = new Map(); // target -> one owner; replacing restores first
  const logged = new Set();
  const warn = (key, error) => {
    if (logged.has(key)) return;
    logged.add(key);
    console.warn(`[Shinji/${key}] ${error}`);
  };
  function state(p) {
    let s = states.get(p.id);
    if (!s) { s = { player: p, cds: new Map(), maskEnd: 0, generation: 0, awakeEnd: 0 }; states.set(p.id, s); }
    return s;
  }
  function alive(p) {
    try { return p.isValid && p.getComponent("minecraft:health")?.currentValue > 0; }
    catch { return false; }
  }
  function ownerUp(p) { return alive(p) && api.getActiveCharacter(p)?.id === "shinji"; }
  function masked(p) { return (states.get(p.id)?.maskEnd ?? 0) > system.currentTick; }
  function emit(dim, kind, p) { try { dim.spawnParticle(kind, p); } catch (e) { warn(kind, e); } }
  function sound(p, name, pitch = 1, volume = 1) {
    try { p.dimension.playSound(name, p.location, { pitch, volume }); } catch (e) { warn(name, e); }
  }
  function ring(p, radius, count = 20, kind = GOLD, y = 1) {
    const loc = p.location;
    for (let i = 0; i < count; i++) {
      const a = i * Math.PI * 2 / count;
      emit(p.dimension, kind, { x: loc.x + Math.cos(a) * radius, y: loc.y + y, z: loc.z + Math.sin(a) * radius });
    }
  }
  function animation(p, key) {
    try { p.playAnimation(`animation.shinji.${key}`, { controller: `shinji_${key}`,
      blendOutTime: 0.12, stopExpression: `query.anim_time > ${key === "release" ? 1 : 0.55}` }); }
    catch (e) { warn("animation", e); }
  }
  function nativeCd(p, id, ticks) {
    try { p.startItemCooldown(id.replace(":", "_"), Math.max(0, Math.ceil(ticks))); }
    catch (e) { warn("cooldown", e); }
  }
  function ready(p, id) {
    const remaining = (state(p).cds.get(id) ?? 0) - system.currentTick;
    if (remaining <= 0) return true;
    p.sendMessage(`§7${LABELS[id]}: §e${Math.ceil(remaining / 20)}s§7 para recarregar.`);
    return false;
  }
  function commit(p, id) {
    const ticks = COOLDOWNS[id] / (masked(p) && id !== "shinji:hollow_mask" ? 2 : 1);
    state(p).cds.set(id, system.currentTick + ticks);
    nativeCd(p, id, ticks);
    if (!api.isAwakened(p)) api.addAwakening(p, 5);
  }
  function activeCast(p, s, generation, dimension) {
    return ownerUp(p) && states.get(p.id) === s && s.generation === generation &&
      p.dimension.id === dimension && !api.isFrozen(p) && !api.skillBlockingZoneFor(p);
  }
  function after(p, delay, fn) {
    const s = state(p), generation = s.generation, dimension = p.dimension.id;
    system.runTimeout(() => {
      try { if (activeCast(p, s, generation, dimension)) fn(); }
      catch (e) { warn("cast", e); }
    }, delay);
  }
  function hurt(p, victim, damage) {
    try { if (alive(victim)) api.dealDamage(victim, damage * api.dmgMultiplier(p), p); }
    catch (e) { warn("damage", e); }
  }
  function slash(p, index) {
    const loc = p.location, a = p.getRotation().y * Math.PI / 180;
    const f = { x: -Math.sin(a), z: Math.cos(a) }, r = { x: Math.cos(a), z: Math.sin(a) };
    const tilt = [-0.6, 0.6, 0][index];
    for (let i = 0; i <= 28; i++) {
      const t = -1.3 + 2.6 * i / 28;
      const side = Math.sin(t) * 2.6, front = 0.7 + Math.cos(t) * 3.6;
      const pos = { x: loc.x + f.x * front + r.x * side,
        y: loc.y + 1.4 + side * tilt * 0.4, z: loc.z + f.z * front + r.z * side };
      emit(p.dimension, GOLD, pos);
      if (i % 3 === 0) emit(p.dimension, WHITE, { ...pos, y: pos.y + 0.05 });
    }
    sound(p, "mob.enderdragon.flap", 1.5 + index * 0.2, 0.8);
    animation(p, "slash");
  }
  function triple(p) {
    commit(p, "shinji:triple_slash");
    // >10 ticks between hits avoids vanilla hurt-invulnerability eating cuts.
    [0, 11, 22].forEach((delay, i) => after(p, delay, () => {
      slash(p, i);
      for (const victim of api.entitiesInFrontBox(p, { forward: 5, width: 5.5, verticalReach: 2.7 }))
        hurt(p, victim, [67, 67, 66][i]);
    }));
  }
  function rush(p) {
    // Mesmo comportamento de Rush and Pierce: fixa o alvo mais próximo antes
    // do avanço e recalcula a direção a cada tick. Usa teleport() porque é a
    // mesma API já comprovadamente usada pelo Rush and Pierce do Szayelaporro.
    const victim = api.nearestTarget(p, SHINJI.rushRange);
    if (!victim) { p.sendMessage("§7Ninguém ao alcance do Sakana's Cut."); return; }
    if (api.trappingZoneFor(p) || api.isFrozen(p)) return;
    if (!alive(victim)) return;
    commit(p, "shinji:sakanas_cut");
    animation(p, "thrust");
    sound(p, "mob.endermen.portal", 1.5, 0.8);
    const s = state(p), generation = s.generation, dimension = p.dimension.id;
    let step = 0;
    const job = system.runInterval(() => {
      try {
        if (!activeCast(p, s, generation, dimension) || !alive(victim) || victim.dimension.id !== dimension) {
          system.clearRun(job); return;
        }
        step++;
        const from = p.location;
        const to = victim.location;
        const dx = to.x - from.x, dz = to.z - from.z;
        const dy = (to.y + 0.8) - (from.y + 1.0);
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const dir = { x: dx / len, y: dy / len, z: dz / len };
        const gap = Math.hypot(dx, dz);
        const advance = Math.max(0, Math.min(5, gap - 1.2, gap / Math.max(1, SHINJI.rushSteps - step + 1)));
        if (advance > 0.05) {
          p.teleport(
            { x: from.x + dir.x * advance, y: from.y, z: from.z + dir.z * advance },
            { keepVelocity: false, facingLocation: to }
          );
        }
        // Somente partículas próprias do Shinji.
        for (let i = 0; i < 5; i++) {
          emit(p.dimension, GOLD, {
            x: p.location.x + (Math.random() - 0.5) * 0.9,
            y: p.location.y + 0.8 + Math.random() * 1.0,
            z: p.location.z + (Math.random() - 0.5) * 0.9,
          });
        }
        if (gap <= 2.8 || step >= SHINJI.rushSteps) {
          hurt(p, victim, SHINJI.rushDamage);
          slash(p, 2);
          ring(victim, 1.2, 18, WHITE);
          sound(victim, "random.anvil_land", 1.8, 0.7);
          system.clearRun(job);
        }
      } catch (e) {
        system.clearRun(job);
        warn("rush", e);
      }
    }, 1);
  }
  function stopMask(p, s) {
    s.maskEnd = 0;
    try {
      const equip = p.getComponent("minecraft:equippable");
      if (equip?.getEquipment(EquipmentSlot.Head)?.typeId === MASK_ITEM)
        equip.setEquipment(EquipmentSlot.Head, s.oldHelmet);
      s.oldHelmet = undefined;
      // Restore only our Speed V, do not erase a later stronger unrelated buff.
      const speed = p.getEffect("speed");
      if (!speed || speed.amplifier === 4) api.reapplyFormEffects(p);
    } catch (e) { warn("mask-cleanup", e); }
  }
  function mask(p) {
    if (masked(p)) return;
    const s = state(p), now = system.currentTick;
    // The mask's own cooldown stays 65s; it cannot halve itself.
    commit(p, "shinji:hollow_mask");
    s.maskEnd = now + SHINJI.maskTicks;
    for (const [id, deadline] of s.cds) {
      if (id === "shinji:hollow_mask" || deadline <= now) continue;
      const reduced = Math.ceil((deadline - now) / 2);
      s.cds.set(id, now + reduced); nativeCd(p, id, reduced);
    }
    p.addEffect("speed", SHINJI.maskTicks, { amplifier: 4, showParticles: false });
    try {
      const equip = p.getComponent("minecraft:equippable");
      // Never hide somebody's equipment in transient JS memory: it would be
      // lost on a world reload. An occupied head slot keeps its original item.
      if (!equip?.getEquipment(EquipmentSlot.Head)) {
        const helmet = new ItemStack(MASK_ITEM);
        helmet.lockMode = "slot"; helmet.keepOnDeath = false;
        equip?.setEquipment(EquipmentSlot.Head, helmet);
      }
    } catch (e) { warn("mask-model", e); }
    animation(p, "release");
    ring(p, 1.4, 32, WHITE, 1.7); ring(p, 2.5, 32, GOLD, 0.15);
    sound(p, "mob.enderdragon.growl", 0.85, 1.2);
    p.onScreenDisplay.setTitle("§fHOLLOW §6MASK", { subtitle: "§7Speed V • recargas ÷2 • 30s",
      fadeInDuration: 3, stayDuration: 28, fadeOutDuration: 12 });
  }
  function cero(p) {
    if (!masked(p)) { p.sendMessage("§cO Cero exige a Hollow Mask ativa."); return; }
    commit(p, "shinji:cero");
    animation(p, "cero");
    sound(p, "beacon.activate", 0.65, 0.8);
    for (let t = 0; t < 12; t += 2) after(p, t, () => {
      if (!masked(p)) return;
      const v = p.getViewDirection(), eye = p.getHeadLocation();
      const center = { x: eye.x + v.x * 1.3, y: eye.y + v.y * 1.3 - 0.15, z: eye.z + v.z * 1.3 };
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6 + t * 0.3, r = 0.45 * (1 - t / 14);
        emit(p.dimension, RED, { x: center.x + Math.cos(a) * r, y: center.y + Math.sin(a) * r, z: center.z });
      }
    });
    after(p, 12, () => {
      if (!masked(p)) return;
      const dim = p.dimension, origin = p.getHeadLocation(), v = p.getViewDirection();
      let range = SHINJI.ceroRange;
      try {
        const hit = dim.getBlockFromRay(origin, v, { maxDistance: range, includeLiquidBlocks: false, includePassableBlocks: false });
        if (hit) range = dist(origin, { x: hit.block.location.x + hit.faceLocation.x,
          y: hit.block.location.y + hit.faceLocation.y, z: hit.block.location.z + hit.faceLocation.z });
      } catch (e) { warn("cero-ray", e); }
      sound(p, "mob.wither.shoot", 0.45, 1.6);
      const hitIds = new Set(), horizontal = Math.hypot(v.x, v.z) || 1;
      const right = { x: v.z / horizontal, y: 0, z: -v.x / horizontal };
      const up = { x: -v.y * right.z, y: v.z * right.x - v.x * right.z, z: v.y * right.x };
      for (let frame = 0; frame < 10; frame += 2) after(p, frame, () => {
        const growth = Math.min(1, (frame + 2) / 4);
        for (let d = 1; d < range; d += 1.35) {
          const c = { x: origin.x + v.x * d, y: origin.y + v.y * d, z: origin.z + v.z * d };
          emit(dim, WHITE, c);
          const radius = Math.min(SHINJI.ceroRadius, 0.3 + d * 0.22) * growth;
          for (let j = 0; j < 6; j++) {
            const a = j * Math.PI / 3 + d * 0.25 + frame * 0.15;
            emit(dim, RED, { x: c.x + (right.x * Math.cos(a) + up.x * Math.sin(a)) * radius,
              y: c.y + up.y * Math.sin(a) * radius,
              z: c.z + (right.z * Math.cos(a) + up.z * Math.sin(a)) * radius });
          }
        }
        for (const target of dim.getEntities({ location: origin, maxDistance: range + 3 })) {
          if (target.id === p.id || hitIds.has(target.id) || !alive(target)) continue;
          const at = target.location, dx = at.x - origin.x, dy = at.y + 1 - origin.y, dz = at.z - origin.z;
          const along = dx * v.x + dy * v.y + dz * v.z;
          if (along < 0 || along > range) continue;
          const radius = Math.min(SHINJI.ceroRadius, 0.3 + along * 0.22) * growth + 0.5;
          if (Math.hypot(dx - along * v.x, dy - along * v.y, dz - along * v.z) > radius) continue;
          const targetDistance = Math.hypot(dx, dy, dz);
          if (targetDistance > 0.1) {
            const obstruction = dim.getBlockFromRay(origin,
              { x: dx / targetDistance, y: dy / targetDistance, z: dz / targetDistance },
              { maxDistance: targetDistance, includeLiquidBlocks: false, includePassableBlocks: false });
            if (obstruction) continue;
          }
          hitIds.add(target.id);
          if (api.isRespiring(target)) { api.showRespiraGuard(target); continue; }
          hurt(p, target, SHINJI.ceroDamage);
        }
      });
    });
  }

  function restoreInput(p) {
    const saved = p.getDynamicProperty(RECOVERY);
    if (typeof saved !== "boolean") return;
    // Camera failure must not prevent control recovery, or vice versa.
    let inputRestored = false, cameraRestored = false;
    try { p.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, saved); inputRestored = true; }
    catch (e) { warn("input-restore", e); }
    try { p.camera.clear(); cameraRestored = true; }
    catch (e) { warn("camera-restore", e); }
    if (inputRestored && cameraRestored) p.setDynamicProperty(RECOVERY, undefined);
  }
  function endInversion(id) {
    const entry = inversions.get(id);
    if (!entry) return;
    inversions.delete(id);
    try { restoreInput(entry.target); } catch (e) { warn("restore", e); }
  }
  function clearOwned(id) {
    for (const [targetId, entry] of inversions) if (entry.owner.id === id) endInversion(targetId);
  }
  function endAwakening(p) {
    clearOwned(p.id);
    const s = states.get(p.id);
    if (s) s.awakeEnd = 0;
    try { p.setDynamicProperty("mv:awakening", 0); } catch {}
  }
  function cleanupId(id) {
    clearOwned(id); endInversion(id);
    const s = states.get(id);
    if (!s) return;
    s.generation++;
    if (s.maskEnd) stopMask(s.player, s);
    states.delete(id);
  }
  function reset(p) {
    cleanupId(p.id);
    try {
      restoreInput(p);
      const equip = p.getComponent("minecraft:equippable");
      if (equip?.getEquipment(EquipmentSlot.Head)?.typeId === MASK_ITEM) equip.setEquipment(EquipmentSlot.Head, undefined);
      if (api.getActiveCharacter(p)?.id === "shinji") {
        p.setDynamicProperty("mv:awakened", false);
        p.setDynamicProperty("mv:awakening", 0);
        api.reapplyFormEffects(p);
        for (const id of Object.keys(COOLDOWNS)) nativeCd(p, id, 0);
      }
    } catch (e) { warn("spawn-recovery", e); }
  }
  function updateCamera(target) {
    const eye = target.getHeadLocation(), v = target.getViewDirection();
    // Place just in front of the face so the free camera is not inside a head.
    const location = { x: eye.x + v.x * 0.35, y: eye.y + v.y * 0.35, z: eye.z + v.z * 0.35 };
    target.camera.setCamera("minecraft:free", { location,
      rotation: invertedRotation(target.getRotation()) });
  }
  function awaken(p) {
    if (!ownerUp(p) || api.isAwakened(p) || api.getAwakening(p) < 100) return false;
    if (api.isFrozen(p) || api.skillBlockingZoneFor(p)) return false;
    const hit = p.getEntitiesFromViewDirection({ maxDistance: SHINJI.inversionRange, ignoreBlockCollision: false })
      .find(h => h.entity.typeId === "minecraft:player" && h.entity.id !== p.id && alive(h.entity));
    const target = hit?.entity;
    if (!target) { p.sendMessage("§eMire em outro jogador a até 30 blocos para inverter o mundo."); return false; }
    endInversion(target.id);
    try {
      // Preflight before spending charge; failure restores the victim immediately.
      target.inputInfo.getMovementVector();
      const previous = target.inputPermissions.isPermissionCategoryEnabled(InputPermissionCategory.LateralMovement);
      if (!previous) { p.sendMessage("§7Este alvo já está com o movimento bloqueado."); return false; }
      target.setDynamicProperty(RECOVERY, previous);
      updateCamera(target);
      target.inputPermissions.setPermissionCategory(InputPermissionCategory.LateralMovement, false);
    } catch (e) {
      try { restoreInput(target); } catch {}
      warn("inversion-unavailable", e);
      p.sendMessage("§cEsta versão não aceitou a câmera/controle do Sakanade. A carga foi preservada.");
      return false;
    }
    const end = system.currentTick + SHINJI.inversionTicks;
    inversions.set(target.id, { target, owner: p, end, dimension: p.dimension.id });
    api.activateAwakening(p, api.getActiveCharacter(p));
    state(p).awakeEnd = end;
    animation(p, "release");
    sound(p, "portal.travel", 0.7, 0.65);
    ring(p, 3, 36, GOLD, 0.2); ring(target, 2, 24, GOLD);
    target.onScreenDisplay.setTitle("§6SAKANADE", { subtitle: "§fBem-vindo ao mundo invertido.",
      fadeInDuration: 4, stayDuration: 30, fadeOutDuration: 12 });
    p.sendMessage(`§6${target.name}§7: mundo invertido por §f15 segundos§7.`);
    return true;
  }
  function moveInverted(entry) {
    const p = entry.target;
    if (api.isFrozen(p) || api.trappingZoneFor(p) || p.getDynamicProperty("mv:cut_leg")) return;
    const input = p.inputInfo.getMovementVector();
    if (Math.hypot(input.x, input.y) < 0.03) return;
    const speed = p.getEffect("speed"), slow = p.getEffect("slowness");
    let distance = 0.215 * (p.isSprinting ? 1.3 : 1) * (p.isSneaking ? 0.3 : 1);
    if (speed) distance *= 1 + 0.2 * (speed.amplifier + 1);
    if (slow) distance *= Math.max(0, 1 - 0.15 * (slow.amplifier + 1));
    const delta = reversedMovement(input, p.getRotation().y, Math.min(distance, 0.7));
    const from = p.location;
    const opts = { checkForBlocks: true, keepVelocity: true };
    if (!p.tryTeleport({ x: from.x + delta.x, y: from.y, z: from.z + delta.z }, opts)) {
      // Wall sliding without noclip. Native gravity and jump remain untouched.
      if (!p.tryTeleport({ x: from.x + delta.x, y: from.y, z: from.z }, opts))
        p.tryTeleport({ x: from.x, y: from.y, z: from.z + delta.z }, opts);
    }
  }
  system.runInterval(() => {
    const now = system.currentTick;
    for (const [id, s] of states) {
      const p = s.player;
      if (!ownerUp(p)) { cleanupId(id); continue; }
      if (s.maskEnd && now >= s.maskEnd) {
        stopMask(p, s); p.sendMessage("§7A Hollow Mask se desfez.");
      }
      if (s.awakeEnd && now >= s.awakeEnd) {
        // A inversão dura 15s, mas o Awakening continua ativo e passa a usar
        // a drenagem global de 1% por segundo.
        clearOwned(p.id);
        s.awakeEnd = 0;
      }
      if (s.maskEnd > now && now % 5 === 0) {
        // Keep the mask buff if generic form restoration ran during awakening.
        if (p.getEffect("speed")?.amplifier !== 4)
          p.addEffect("speed", s.maskEnd - now, { amplifier: 4, showParticles: false });
        const loc = p.location, a = now * 0.18;
        emit(p.dimension, GOLD, { x: loc.x + Math.cos(a) * 0.6, y: loc.y + 1.4, z: loc.z + Math.sin(a) * 0.6 });
      }
    }
    for (const [id, e] of inversions) {
      try {
        if (now >= e.end || !alive(e.target) || !ownerUp(e.owner) || !api.isAwakened(e.owner) ||
          e.target.dimension.id !== e.dimension || e.owner.dimension.id !== e.dimension) {
          endInversion(id); continue;
        }
        moveInverted(e); updateCamera(e.target);
      } catch (error) { endInversion(id); warn("inversion-tick", error); }
    }
  }, 1);
  world.afterEvents.entityDie.subscribe(ev => {
    if (ev.deadEntity.typeId === "minecraft:player") cleanupId(ev.deadEntity.id);
  });
  // Hot script reload recovery: never leave a player with disabled controls.
  system.run(() => { for (const p of world.getPlayers()) reset(p); });
  return {
    awaken, endAwakening, reset, cleanupId,
    melee: p => animation(p, "slash"),
    cleanup: p => cleanupId(p.id), isInverted: p => inversions.has(p.id),
    cast(p, id) {
      if (!ownerUp(p) || !ready(p, id)) return;
      ({ "shinji:triple_slash": triple, "shinji:sakanas_cut": rush,
        "shinji:hollow_mask": mask, "shinji:cero": cero })[id]?.(p);
    },
    hud(p) {
      let text = "";
      const s = states.get(p.id), inverse = inversions.get(p.id);
      if (s?.maskEnd > system.currentTick) text += ` §6◈ MASK ${Math.ceil((s.maskEnd - system.currentTick) / 20)}s`;
      if (inverse) text += ` §d↕ INVERTIDO ${Math.ceil((inverse.end - system.currentTick) / 20)}s`;
      if (api.getActiveCharacter(p)?.id === "shinji") {
        const selected = p.getComponent("minecraft:inventory")?.container?.getItem(p.selectedSlotIndex)?.typeId;
        if (COOLDOWNS[selected]) {
          const left = Math.max(0, (s?.cds.get(selected) ?? 0) - system.currentTick);
          text += ` §8| §f${LABELS[selected]} §${left ? "e" : "a"}${left ? Math.ceil(left / 20) + "s" : "PRONTO"}`;
        }
      }
      return text;
    },
  };
}
