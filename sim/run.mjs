/* =========================================================
   Simulacao do main.js fora do Minecraft.
   Dispara todos os eventos e roda todos os intervals/timeouts
   registrados, checando que nada lanca excecao.

   uso: node --import ./sim/register.mjs sim/run.mjs
   ========================================================= */

import {
  world,
  system,
  advanceTicks,
  createPlayer,
  createDummy,
  emit,
  errors,
  log,
  overworld,
  ItemStack,
  EquipmentSlot,
  scheduledRunCount,
} from "./stubs/server.mjs";
import { queueFormResponse, shownForms } from "./stubs/server-ui.mjs";

const checks = [];
let currentScenario = "boot";

function scenario(name) {
  currentScenario = name;
  process.stdout.write(`\n\x1b[1m▶ ${name}\x1b[0m\n`);
}

function check(label, condition, detail = "") {
  checks.push({ scenario: currentScenario, label, ok: !!condition, detail });
  const mark = condition ? "\x1b[32m  ✔\x1b[0m" : "\x1b[31m  ✘\x1b[0m";
  process.stdout.write(`${mark} ${label}${condition || !detail ? "" : ` — ${detail}`}\n`);
}

function errorsSince(mark) {
  return errors.slice(mark);
}

function noNewErrors(label, mark) {
  const fresh = errorsSince(mark);
  check(
    label,
    fresh.length === 0,
    fresh.map((e) => `[${e.phase}] ${e.message}`).join(" | ")
  );
}

const DP = {
  character: "mv:character",
  awakening: "mv:awakening",
  awakened: "mv:awakened",
  byakuyaWeapon: "mv:byakuya_weapon",
  maskEnd: "mv:mask_end",
  coatingEnd: "mv:coating_end",
};

function inv(p) {
  return p.getComponent("minecraft:inventory").container;
}
function hp(p) {
  return p.getComponent("minecraft:health");
}
function slotIds(p, count = 9) {
  return Array.from({ length: count }, (_, i) => inv(p).getItem(i)?.typeId);
}
function useItem(p, typeId) {
  emit("itemUse", { source: p, itemStack: new ItemStack(typeId, 1) });
}
function hitWith(attacker, target, typeId) {
  const slot = inv(attacker).slots.findIndex((s) => s?.typeId === typeId);
  attacker.selectedSlotIndex = slot === -1 ? 0 : slot;
  if (slot === -1) inv(attacker).setItem(0, new ItemStack(typeId, 1));
  emit("entityHitEntity", { damagingEntity: attacker, hitEntity: target });
}

/* ================= carregar o addon ================= */

scenario("Carregar main.js");
let bootMark = errors.length;
await import("../BP/scripts/main.js");
noNewErrors("main.js importa sem lancar", bootMark);
check(
  "handlers registrados (playerSpawn/itemUse/entityHitEntity/entitySpawn)",
  world.afterEvents.playerSpawn.listenerCount === 1 &&
    world.afterEvents.itemUse.listenerCount === 1 &&
    world.afterEvents.entityHitEntity.listenerCount === 1 &&
    world.afterEvents.entitySpawn.listenerCount === 1
);
check("loops de sistema registrados", scheduledRunCount() >= 5, `${scheduledRunCount()} runs`);

/* ================= entrar no mundo ================= */

scenario("Entrada no mundo");
const ichigo = createPlayer("IchigoPlayer", { x: 0, y: 64, z: 0 });
const byakuya = createPlayer("ByakuyaPlayer", { x: 40, y: 64, z: 40 });
const dummy = createDummy("Dummy", { x: 0, y: 64, z: 3 }, 5000);
const dummy2 = createDummy("Dummy2", { x: 40, y: 64, z: 43 }, 5000);

let mark = errors.length;
emit("playerSpawn", { player: ichigo, initialSpawn: true });
emit("playerSpawn", { player: byakuya, initialSpawn: true });
advanceTicks(20, "pos-spawn");
noNewErrors("playerSpawn inicial sem erro", mark);
check(
  "seletor travado no slot 8",
  inv(ichigo).getItem(8)?.typeId === "multiversal:character_selector",
  String(inv(ichigo).getItem(8)?.typeId)
);
check(
  "corações do HUD escondidos",
  log.commands.some((c) => c.command.includes("hud") && c.command.includes("hide health"))
);

/* ================= selecionar personagem ================= */

scenario("Menu do seletor");
mark = errors.length;
queueFormResponse(0); // Ichigo
useItem(ichigo, "multiversal:character_selector");
await Promise.resolve();
await Promise.resolve();
advanceTicks(20, "ativar ichigo");
noNewErrors("abrir menu + escolher personagem sem erro", mark);
check("form exibido", shownForms.length === 1 && shownForms[0].buttons.length >= 2);
check("personagem salvo", ichigo.getDynamicProperty(DP.character) === "ichigo");
check("vida maxima 200", hp(ichigo).effectiveMax === 200, `${hp(ichigo).effectiveMax}`);
check("vida cheia apos ativar", hp(ichigo).currentValue === 200, `${hp(ichigo).currentValue}`);
check(
  "5 itens do Ichigo travados nos slots 0-4",
  JSON.stringify(slotIds(ichigo, 5)) ===
    JSON.stringify([
      "ichigo:m1_zangetsu",
      "ichigo:getsuga_slam",
      "ichigo:getsuga_slash",
      "ichigo:getsuga_run",
      "ichigo:getsuga_tenshou",
    ]),
  JSON.stringify(slotIds(ichigo, 5))
);

queueFormResponse(1); // Byakuya
useItem(byakuya, "multiversal:character_selector");
await Promise.resolve();
await Promise.resolve();
advanceTicks(20, "ativar byakuya");
check("Byakuya ativado", byakuya.getDynamicProperty(DP.character) === "byakuya");

/* ================= skills do Ichigo (shikai) ================= */

scenario("Skills do Ichigo (Shikai)");
const ichigoSkills = [
  "ichigo:getsuga_slam",
  "ichigo:getsuga_slash",
  "ichigo:getsuga_run",
  "ichigo:getsuga_tenshou",
];
for (const skill of ichigoSkills) {
  mark = errors.length;
  const dmgBefore = log.damages.length;
  ichigo.teleport({ x: 0, y: 64, z: 0 });
  dummy.teleport({ x: 0, y: 64, z: 3 });
  useItem(ichigo, skill);
  advanceTicks(60, skill);
  noNewErrors(`${skill} executa limpo`, mark);
  check(`${skill} causou dano`, log.damages.length > dmgBefore);
}

mark = errors.length;
const msgsBeforeCd = log.worldMessages.length;
useItem(ichigo, "ichigo:getsuga_tenshou"); // recem usado (cd 500): em recarga
advanceTicks(5, "cooldown");
noNewErrors("skill em cooldown avisa sem lancar", mark);
check("aviso de recarga mostrado", log.titles.some((t) => t.options?.subtitle?.includes("Recarregando")));
check(
  "skill em recarga não dispara de novo",
  !log.worldMessages.slice(msgsBeforeCd).some((m) => m.message.includes("GETSUGA TENSHOU"))
);

scenario("m1 do Ichigo + ganho de awakening");
mark = errors.length;
ichigo.setDynamicProperty(DP.awakening, 0);
for (let i = 0; i < 10; i++) hitWith(ichigo, dummy, "ichigo:m1_zangetsu");
advanceTicks(5, "m1");
noNewErrors("m1 sem erro", mark);
check("m1 acumula awakening (+1 por hit)", ichigo.getDynamicProperty(DP.awakening) === 10, String(ichigo.getDynamicProperty(DP.awakening)));

/* ================= Awakening / Bankai ================= */

scenario("Awakening: Tensa Zangetsu");
mark = errors.length;
ichigo.setDynamicProperty(DP.awakening, 100);
ichigo.isSneaking = true;
useItem(ichigo, "ichigo:m1_zangetsu");
advanceTicks(20, "awakening");
ichigo.isSneaking = false;
noNewErrors("ativar awakening sem erro", mark);
check("awakened = true", ichigo.getDynamicProperty(DP.awakened) === true);
check("vida maxima 400", hp(ichigo).effectiveMax === 400, `${hp(ichigo).effectiveMax}`);
check(
  "itens trocados pelos da bankai",
  JSON.stringify(slotIds(ichigo, 5)) ===
    JSON.stringify([
      "ichigo:tensa_m1",
      "ichigo:getsuga_barrage",
      "ichigo:getsuga_tenshou_bankai",
      "ichigo:double_getsuga",
      "ichigo:nuke_tenshou",
    ]),
  JSON.stringify(slotIds(ichigo, 5))
);

const awakeningAtStart = ichigo.getDynamicProperty(DP.awakening);
hitWith(ichigo, dummy, "ichigo:tensa_m1");
check("awakening NAO sobe durante a forma desperta", ichigo.getDynamicProperty(DP.awakening) <= awakeningAtStart);

for (const skill of [
  "ichigo:getsuga_barrage",
  "ichigo:getsuga_tenshou_bankai",
  "ichigo:double_getsuga",
  "ichigo:nuke_tenshou",
]) {
  mark = errors.length;
  const dmgBefore = log.damages.length;
  ichigo.teleport({ x: 0, y: 64, z: 0 });
  dummy.teleport({ x: 0, y: 64, z: 3 });
  useItem(ichigo, skill);
  advanceTicks(80, skill);
  noNewErrors(`${skill} executa limpo`, mark);
  check(`${skill} causou dano`, log.damages.length > dmgBefore);
}

/* ================= Mascara Hollow ================= */

scenario("Máscara Hollow");
mark = errors.length;
ichigo.setDynamicProperty(DP.awakening, 100);
hp(ichigo).setCurrentValue(300);
ichigo.isSneaking = true;
useItem(ichigo, "ichigo:tensa_m1"); // vida alta: deve recusar
advanceTicks(2, "mascara-recusa");
check(
  "recusa a máscara acima do limite de vida",
  !ichigo.getDynamicProperty(DP.maskEnd) &&
    log.worldMessages.some((m) => m.to === "IchigoPlayer" && m.message.includes("50 de vida ou menos"))
);

hp(ichigo).setCurrentValue(40);
useItem(ichigo, "ichigo:tensa_m1");
advanceTicks(2, "mascara");
ichigo.isSneaking = false;
noNewErrors("ativar máscara sem erro", mark);
check("máscara ativa", (ichigo.getDynamicProperty(DP.maskEnd) ?? 0) > system.currentTick);
check(
  "abóbora equipada na cabeça",
  ichigo.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Head)?.typeId === "minecraft:carved_pumpkin"
);
check("strength 2 aplicado", ichigo.getEffect("strength")?.amplifier === 1);
check("regen 6 aplicado", ichigo.getEffect("regeneration")?.amplifier === 5);

mark = errors.length;
advanceTicks(130, "pos-regen-burst");
noNewErrors("burst de regen volta ao regen base sem erro", mark);
check("regen voltou pro nível base (2)", ichigo.getEffect("regeneration")?.amplifier === 1, String(ichigo.getEffect("regeneration")?.amplifier));

mark = errors.length;
advanceTicks(600, "mascara-expira");
noNewErrors("expiração da máscara sem erro", mark);
check("máscara removida no fim", !ichigo.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Head));

/* ================= drenar awakening ================= */

scenario("Drenagem do Awakening → volta pra forma base");
mark = errors.length;
ichigo.setDynamicProperty(DP.awakening, 3);
hp(ichigo).setCurrentValue(150);
advanceTicks(120, "drenagem");
noNewErrors("drenagem + reversão sem erro", mark);
check("awakened = false", ichigo.getDynamicProperty(DP.awakened) === false);
check("vida maxima de volta pra 200", hp(ichigo).effectiveMax === 200, `${hp(ichigo).effectiveMax}`);
check("NAO curou ao reverter (só clampou)", hp(ichigo).currentValue <= 150, `${hp(ichigo).currentValue}`);
check(
  "itens base restaurados",
  JSON.stringify(slotIds(ichigo, 5)) ===
    JSON.stringify([
      "ichigo:m1_zangetsu",
      "ichigo:getsuga_slam",
      "ichigo:getsuga_slash",
      "ichigo:getsuga_run",
      "ichigo:getsuga_tenshou",
    ]),
  JSON.stringify(slotIds(ichigo, 5))
);

/* ================= Byakuya ================= */

scenario("Skills do Byakuya");
for (const skill of ["byakuya:tripleshot", "byakuya:disperse", "byakuya:bloodshed", "byakuya:coating"]) {
  mark = errors.length;
  byakuya.teleport({ x: 40, y: 64, z: 40 });
  dummy2.teleport({ x: 40, y: 64, z: 43 });
  const dmgBefore = log.damages.length;
  useItem(byakuya, skill);
  advanceTicks(60, skill);
  noNewErrors(`${skill} executa limpo`, mark);
  if (skill !== "byakuya:coating") check(`${skill} causou dano`, log.damages.length > dmgBefore);
}
check("Sakura's Coating ativo", (byakuya.getDynamicProperty(DP.coatingEnd) ?? 0) > system.currentTick);

mark = errors.length;
hitWith(byakuya, dummy2, "byakuya:m1_senbonzakura");
advanceTicks(80, "m1-byakuya-sangramento");
noNewErrors("m1 do Byakuya + sangramento sem erro", mark);
check("sangramento aplicou dano ao longo do tempo", log.damages.filter((d) => d.by === "ByakuyaPlayer").length >= 2);

scenario("Senbonzakura Kageyoshi (super)");
mark = errors.length;
byakuya.setDynamicProperty(DP.awakening, 100);
byakuya.isSneaking = true;
useItem(byakuya, "byakuya:m1_senbonzakura");
byakuya.isSneaking = false;
const kageyoshiDmgBefore = log.damages.length;
advanceTicks(340, "kageyoshi");
noNewErrors("Kageyoshi executa limpo do começo ao fim", mark);
check("Kageyoshi causou dano por segundo", log.damages.length > kageyoshiDmgBefore);
check("awakening zerado ao usar o super", byakuya.getDynamicProperty(DP.awakening) < 100);
check("Kageyoshi terminou sozinho", log.worldMessages.some((m) => m.message.includes("Kageyoshi terminou")));

/* ================= Senkei ================= */

scenario("Senkei (carregar 5s → ativar)");
mark = errors.length;
byakuya.setDynamicProperty(DP.awakening, 100);
byakuya.isSneaking = true;
inv(byakuya).setItem(0, new ItemStack("byakuya:m1_senbonzakura", 1));
advanceTicks(120, "carregar-senkei");
noNewErrors("carregamento do Senkei sem erro", mark);
check(
  "círculo de carga formado",
  log.worldMessages.some((m) => m.to === "ByakuyaPlayer" && m.message.includes("Senkei carregado"))
);

mark = errors.length;
useItem(byakuya, "byakuya:m1_senbonzakura");
byakuya.isSneaking = false;
advanceTicks(40, "ativar-senkei");
noNewErrors("ativar Senkei sem erro", mark);
check("estado da arma = senkei", byakuya.getDynamicProperty(DP.byakuyaWeapon) === "senkei");
check(
  "m1 do Senkei travada no slot 0",
  inv(byakuya).getItem(0)?.typeId === "byakuya:m1_senbonzakura_senkei",
  String(inv(byakuya).getItem(0)?.typeId)
);

scenario("Senkei: contenção e bloqueio de skills");
mark = errors.length;
dummy2.teleport({ x: 40, y: 64, z: 40 });
advanceTicks(20, "lentidao");
check("preso leva lentidão forte", (dummy2.getEffect("slowness")?.amplifier ?? -1) >= 6);

dummy2.teleport({ x: 80, y: 64, z: 40 }); // tenta fugir pra fora do raio 15
advanceTicks(8, "contencao");
const distFromCenter = Math.hypot(dummy2.location.x - 40, dummy2.location.z - 40);
check("fugitivo teleportado de volta pra dentro", distFromCenter <= 15, `dist=${distFromCenter.toFixed(2)}`);

dummy2.teleport({ x: 540, y: 64, z: 40 }); // fuga longa (dash/pearl): 500 blocos
advanceTicks(8, "contencao-longa");
const distFar = Math.hypot(dummy2.location.x - 40, dummy2.location.z - 40);
check("fuga longa também é puxada de volta", distFar <= 15, `dist=${distFar.toFixed(2)}`);

const bystander = createDummy("Curioso", { x: 70, y: 64, z: 40 }, 200); // 30 blocos do centro, nunca entrou
advanceTicks(12, "bystander");
const bystanderDist = Math.hypot(bystander.location.x - 40, bystander.location.z - 40);
check(
  "quem está fora e nunca entrou NÃO é sugado pra dentro",
  bystanderDist > 15,
  `dist=${bystanderDist.toFixed(2)}`
);
noNewErrors("loop de contenção sem erro", mark);

mark = errors.length;
const msgsBefore = log.worldMessages.length;
useItem(byakuya, "byakuya:disperse"); // preso na propria arena: deve bloquear
advanceTicks(5, "skill-bloqueada");
check(
  "skills bloqueadas dentro do Senkei",
  log.worldMessages.slice(msgsBefore).some((m) => m.message.includes("preso no Senkei"))
);
noNewErrors("bloqueio de skill sem erro", mark);

scenario("Senkei: golpe final");
mark = errors.length;
byakuya.isSneaking = true;
useItem(byakuya, "byakuya:m1_senbonzakura_senkei");
byakuya.isSneaking = false;
advanceTicks(20, "desativar-senkei");
noNewErrors("desativar Senkei sem erro", mark);
check("estado da arma = finisher", byakuya.getDynamicProperty(DP.byakuyaWeapon) === "finisher");
check(
  "espada final travada no slot 0",
  inv(byakuya).getItem(0)?.typeId === "byakuya:m1_senbonzakura_finisher",
  String(inv(byakuya).getItem(0)?.typeId)
);
dummy2.teleport({ x: 120, y: 64, z: 40 });
advanceTicks(12, "arena-aberta");
check(
  "arena realmente fechou (ninguém mais é puxado de volta)",
  Math.hypot(dummy2.location.x - 40, dummy2.location.z - 40) > 15
);

mark = errors.length;
hitWith(byakuya, dummy2, "byakuya:m1_senbonzakura_finisher");
advanceTicks(20, "finisher");
noNewErrors("golpe final sem erro", mark);
check("voltou pra m1 base", byakuya.getDynamicProperty(DP.byakuyaWeapon) === "base");
check("Byakuya stunado (slowness alta)", (byakuya.getEffect("slowness")?.amplifier ?? -1) >= 9);
check("Byakuya com darkness", !!byakuya.getEffect("darkness"));
advanceTicks(30, "pos-finisher");
check(
  "m1 base restaurada no slot 0",
  inv(byakuya).getItem(0)?.typeId === "byakuya:m1_senbonzakura",
  String(inv(byakuya).getItem(0)?.typeId)
);

/* ================= dash universal ================= */

scenario("Dash universal (agachar + pular)");
mark = errors.length;
ichigo._velocity = { x: 0, y: 0.5, z: 0 };
ichigo.isSneaking = true;
advanceTicks(4, "dash");
noNewErrors("dash dispara sem erro", mark);
check("som do dash tocado", log.sounds.some((s) => s.soundId === "mob.enderdragon.flap"));

ichigo._velocity = { x: 0.9, y: 0.5, z: 0.9 }; // knockback, nao pulo puro
const soundsBefore = log.sounds.length;
ichigo.isSneaking = false;
advanceTicks(4, "reset-dash");
ichigo.isSneaking = true;
advanceTicks(4, "dash-knockback");
check(
  "knockback com velocidade horizontal alta NAO vira dash",
  log.sounds.slice(soundsBefore).filter((s) => s.soundId === "mob.enderdragon.flap").length === 0
);
ichigo.isSneaking = false;
ichigo._velocity = { x: 0, y: 0, z: 0 };

/* ================= itens travados ================= */

scenario("Itens travados não podem ser dropados");
mark = errors.length;
const droppedLocked = overworld.spawnEntity("minecraft:item", { x: 0, y: 64, z: 0 });
droppedLocked.itemStackComponent = { itemStack: new ItemStack("ichigo:m1_zangetsu", 1) };
emit("entitySpawn", { entity: droppedLocked });
check("item do personagem largado é removido", !droppedLocked.isValid);

const droppedSelector = overworld.spawnEntity("minecraft:item", { x: 0, y: 64, z: 0 });
droppedSelector.itemStackComponent = { itemStack: new ItemStack("multiversal:character_selector", 1) };
emit("entitySpawn", { entity: droppedSelector });
check("seletor largado é removido", !droppedSelector.isValid);

const droppedVanilla = overworld.spawnEntity("minecraft:item", { x: 0, y: 64, z: 0 });
droppedVanilla.itemStackComponent = { itemStack: new ItemStack("minecraft:dirt", 1) };
emit("entitySpawn", { entity: droppedVanilla });
check("item vanilla NÃO é removido", droppedVanilla.isValid);
noNewErrors("listener de drop sem erro", mark);

inv(ichigo).setItem(3, undefined);
advanceTicks(15, "reposicao");
check("item removido do slot é devolvido pelo loop", inv(ichigo).getItem(3)?.typeId === "ichigo:getsuga_run");

/* ================= morte / respawn ================= */

scenario("Morte e respawn");
mark = errors.length;
ichigo.setDynamicProperty(DP.awakened, true);
emit("playerSpawn", { player: ichigo, initialSpawn: false });
advanceTicks(20, "respawn");
noNewErrors("respawn sem erro", mark);
check("awakening cancelado no respawn", ichigo.getDynamicProperty(DP.awakened) === false);
check("vida do personagem reaplicada", hp(ichigo).effectiveMax === 200 && hp(ichigo).currentValue === 200);

scenario("Alvo morrendo no meio de um DoT");
mark = errors.length;
const frail = createDummy("Frágil", { x: 40, y: 64, z: 41 }, 6);
hitWith(byakuya, frail, "byakuya:m1_senbonzakura");
advanceTicks(120, "dot-alvo-morto");
noNewErrors("DoT limpa sozinho quando o alvo morre", mark);
check("alvo frágil morreu", !frail.isValid);

/* ================= desativar ================= */

scenario("Desativar personagem");
mark = errors.length;
queueFormResponse(2); // botao "Desativar personagem"
useItem(ichigo, "multiversal:character_selector");
await Promise.resolve();
await Promise.resolve();
advanceTicks(20, "desativar");
noNewErrors("desativar sem erro", mark);
check("personagem limpo", ichigo.getDynamicProperty(DP.character) === undefined);
check("vida normalizada em 20", hp(ichigo).effectiveMax === 20 && hp(ichigo).currentValue === 20, `${hp(ichigo).currentValue}/${hp(ichigo).effectiveMax}`);
check("itens do personagem removidos", slotIds(ichigo, 5).every((id) => id === undefined), JSON.stringify(slotIds(ichigo, 5)));
check("seletor continua no slot 8", inv(ichigo).getItem(8)?.typeId === "multiversal:character_selector");

/* ================= estabilidade longa ================= */

scenario("Estabilidade: 2000 ticks livres");
mark = errors.length;
advanceTicks(2000, "idle");
noNewErrors("nenhum loop lança depois de 100s", mark);

/* ================= particulas usadas ================= */

scenario("Partículas e sons referenciados");
const VANILLA_PARTICLES = new Set([
  "minecraft:large_explosion",
  "minecraft:crit_particle",
  "minecraft:blood_particle",
  "minecraft:basic_flame_particle",
  "minecraft:heart_particle",
  "minecraft:totem_particle",
  "minecraft:villager_happy",
  "minecraft:redstone_wire_dust_particle",
  "minecraft:knockback_roar_particle",
  "minecraft:sonic_explosion",
  "minecraft:dragon_breath_fire",
  "minecraft:electric_spark_particle",
  "minecraft:obsidian_glow_dust_particle",
]);
const { readdirSync, readFileSync } = await import("node:fs");
const customParticles = new Set(
  readdirSync(new URL("../RP/particles", import.meta.url))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(new URL(`../RP/particles/${f}`, import.meta.url), "utf8")))
    .map((j) => j.particle_effect?.description?.identifier)
    .filter(Boolean)
);
const usedParticles = [...new Set(log.particles.map((p) => p.particleId))].sort();
const unknownParticles = usedParticles.filter((p) => !VANILLA_PARTICLES.has(p) && !customParticles.has(p));
process.stdout.write(`  partículas usadas: ${usedParticles.join(", ")}\n`);
check("toda partícula usada é vanilla conhecida ou vem do RP", unknownParticles.length === 0, unknownParticles.join(", "));
check("a partícula customizada sakura:leaf foi realmente usada", usedParticles.includes("sakura:leaf"));

/* ================= reload do mundo ================= */

scenario("Reload do mundo (o tick volta a zero, a dynamic property não)");
mark = errors.length;
queueFormResponse(0);
useItem(ichigo, "multiversal:character_selector");
await Promise.resolve();
await Promise.resolve();
advanceTicks(20, "reativar-ichigo");
check("Ichigo reativado pro teste", ichigo.getDynamicProperty(DP.character) === "ichigo");

// simula um stamp gravado numa sessão anterior, quando o tick estava bem mais alto
const staleTick = system.currentTick + 500000;
ichigo.setDynamicProperty("mv:cd_ichigo_getsuga_tenshou", staleTick);
const msgsBeforeStale = log.worldMessages.length;
useItem(ichigo, "ichigo:getsuga_tenshou");
advanceTicks(40, "skill-pos-reload");
noNewErrors("usar skill com cooldown de outra sessão sem erro", mark);
check(
  "skill NÃO fica travada pra sempre depois de um reload",
  log.worldMessages.slice(msgsBeforeStale).some((m) => m.message.includes("GETSUGA TENSHOU"))
);
check(
  "stamp velho foi descartado",
  ichigo.getDynamicProperty("mv:cd_ichigo_getsuga_tenshou") < staleTick
);

mark = errors.length;
ichigo.setDynamicProperty(DP.coatingEnd, system.currentTick + 500000);
hitWith(ichigo, dummy, "ichigo:m1_zangetsu");
advanceTicks(5, "coating-stale");
check("Coating de outra sessão não fica ativo pra sempre", ichigo.getDynamicProperty(DP.coatingEnd) === 0);

mark = errors.length;
ichigo.setDynamicProperty(DP.maskEnd, system.currentTick + 500000);
ichigo.setDynamicProperty(DP.coatingEnd, system.currentTick + 500000);
emit("playerSpawn", { player: ichigo, initialSpawn: true });
advanceTicks(10, "rejoin");
noNewErrors("rejoin limpa os timers sem erro", mark);
check(
  "rejoin zera os cooldowns de skill",
  ichigo.getDynamicProperty("mv:cd_ichigo_getsuga_tenshou") === undefined
);
check("rejoin zera a máscara pendente", !ichigo.getDynamicProperty(DP.maskEnd));
check("rejoin zera o coating pendente", !ichigo.getDynamicProperty(DP.coatingEnd));

/* ================= desconexão no meio do Senkei ================= */

scenario("Byakuya desconecta com o Senkei aberto");
mark = errors.length;
byakuya.setDynamicProperty(DP.awakening, 100);
byakuya.teleport({ x: 40, y: 64, z: 40 });
byakuya.isSneaking = true;
inv(byakuya).setItem(0, new ItemStack("byakuya:m1_senbonzakura", 1));
advanceTicks(120, "recarregar-senkei");
useItem(byakuya, "byakuya:m1_senbonzakura");
byakuya.isSneaking = false;
advanceTicks(20, "senkei-aberto");
check("Senkei reaberto pro teste", byakuya.getDynamicProperty(DP.byakuyaWeapon) === "senkei");

const prisoner = createDummy("Preso", { x: 40, y: 64, z: 45 }, 500);
advanceTicks(12, "prender");
emit("playerLeave", { playerId: byakuya.id, playerName: byakuya.name });
prisoner.teleport({ x: 200, y: 64, z: 40 });
advanceTicks(40, "pos-desconexao");
noNewErrors("nada lança depois da desconexão do dono", mark);
check(
  "arena some junto com o dono (não prende ninguém pra sempre)",
  Math.hypot(prisoner.location.x - 40, prisoner.location.z - 40) > 15,
  `dist=${Math.hypot(prisoner.location.x - 40, prisoner.location.z - 40).toFixed(2)}`
);

/* ================= relatorio ================= */

const failed = checks.filter((c) => !c.ok);
process.stdout.write(
  `\n\x1b[1m${"─".repeat(58)}\x1b[0m\n` +
    `Checks: ${checks.length - failed.length}/${checks.length} passaram\n` +
    `Exceções capturadas: ${errors.length}\n`
);

if (errors.length) {
  process.stdout.write("\n\x1b[31mExceções:\x1b[0m\n");
  for (const e of errors) process.stdout.write(`  • [${e.phase}] ${e.message}\n`);
}
if (failed.length) {
  process.stdout.write("\n\x1b[31mChecks que falharam:\x1b[0m\n");
  for (const f of failed) process.stdout.write(`  • (${f.scenario}) ${f.label}${f.detail ? ` — ${f.detail}` : ""}\n`);
}

process.exit(failed.length || errors.length ? 1 : 0);
