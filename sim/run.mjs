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

// ids na mesma ordem do registro CHARACTERS (o menu usa Object.keys)
const CHARACTER_IDS = { ichigo: 0, byakuya: 1, kenpachi: 2, mayuri: 3 };

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
check(
  "form lista os 3 personagens",
  shownForms.length === 1 && shownForms[0].buttons.length === Object.keys(CHARACTER_IDS).length,
  `${shownForms[0]?.buttons.length} botões`
);
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

/* ================= Zaraki Kenpachi ================= */

scenario("Zaraki Kenpachi: ativação");
const kenpachi = createPlayer("KenpachiPlayer", { x: -80, y: 64, z: -80 });
// longe do caminho dos avancos e com vida alta: e alvo de teste, nao saco de pancada
const victim = createPlayer("Vítima", { x: -80, y: 64, z: -60 }, 4000);
const prey = createDummy("Presa", { x: -77, y: 64, z: -80 }, 5000);

mark = errors.length;
emit("playerSpawn", { player: kenpachi, initialSpawn: true });
emit("playerSpawn", { player: victim, initialSpawn: true });
advanceTicks(20, "spawn-kenpachi");
queueFormResponse(CHARACTER_IDS.kenpachi);
useItem(kenpachi, "multiversal:character_selector");
await Promise.resolve();
await Promise.resolve();
advanceTicks(20, "ativar-kenpachi");
noNewErrors("ativar Kenpachi sem erro", mark);
check("personagem salvo", kenpachi.getDynamicProperty(DP.character) === "kenpachi");
check("vida maxima 300", hp(kenpachi).effectiveMax === 300, `${hp(kenpachi).effectiveMax}`);
check(
  "5 itens do Kenpachi travados nos slots 0-4",
  JSON.stringify(slotIds(kenpachi, 5)) ===
    JSON.stringify([
      "kenpachi:m1_zanpakuto",
      "kenpachi:flash_slash",
      "kenpachi:stomp",
      "kenpachi:hunt",
      "kenpachi:hells_cut",
    ]),
  JSON.stringify(slotIds(kenpachi, 5))
);

scenario("Flash Slash: 3 avanços de 30");
mark = errors.length;
kenpachi.teleport({ x: -80, y: 64, z: -80 });
prey.teleport({ x: -77, y: 64, z: -80 });
kenpachi._view = { x: 1, y: 0, z: 0 }; // olhando pro +x
// cada avanco cobre 6 blocos, entao um alvo em cada trecho testa os tres
const alvoA = createDummy("AlvoA", { x: -77, y: 64, z: -80 }, 500);
const alvoB = createDummy("AlvoB", { x: -71, y: 64, z: -80 }, 500);
const alvoC = createDummy("AlvoC", { x: -65, y: 64, z: -80 }, 500);
let dmgBefore = log.damages.length;
useItem(kenpachi, "kenpachi:flash_slash");
advanceTicks(80, "flash-slash");
noNewErrors("Flash Slash executa limpo", mark);
const flashHits = log.damages.slice(dmgBefore).filter((d) => d.amount === 30);
check(
  "os 3 avanços acertam, 30 de dano cada",
  ["AlvoA", "AlvoB", "AlvoC"].every(
    (name) => flashHits.filter((d) => d.target === name).length === 1
  ),
  JSON.stringify(flashHits.map((d) => d.target))
);
for (const alvo of [alvoA, alvoB, alvoC]) alvo.kill();
check(
  "Kenpachi avançou pra frente",
  kenpachi.location.x > -80 + 3,
  `x=${kenpachi.location.x.toFixed(1)}`
);

scenario("Stomp: 45 de dano em 6x6 (alcance dobrado)");
mark = errors.length;
kenpachi.teleport({ x: -80, y: 64, z: -80 });
prey.teleport({ x: -79, y: 64, z: -80 }); // 1 bloco: dentro
dmgBefore = log.damages.length;
const partBefore = log.particles.length;
useItem(kenpachi, "kenpachi:stomp");
advanceTicks(10, "stomp");
noNewErrors("Stomp executa limpo", mark);
check(
  "45 de dano em quem está na área",
  log.damages.slice(dmgBefore).some((d) => d.target === "Presa" && d.amount === 45)
);
const stompParticles = log.particles.slice(partBefore);
check(
  "solta partícula de explosão",
  stompParticles.length >= 10 &&
    stompParticles.every((p) => p.particleId === "minecraft:large_explosion"),
  `${stompParticles.length} partículas`
);
check("NÃO explode de verdade (nenhum createExplosion)", log.explosions.length === 0);

// 2.5 blocos: fora do raio antigo (1.5), dentro do novo (3) - o teste do buff
prey.teleport({ x: -77.5, y: 64, z: -80 });
dmgBefore = log.damages.length;
kenpachi.setDynamicProperty("mv:cd_kenpachi_stomp", undefined);
useItem(kenpachi, "kenpachi:stomp");
advanceTicks(10, "stomp-alcance-novo");
check(
  "alcance dobrado: pega a 2.5 blocos (antes não pegava)",
  log.damages.slice(dmgBefore).some((d) => d.target === "Presa" && d.amount === 45)
);

prey.teleport({ x: -74, y: 64, z: -80 }); // 6 blocos: fora
dmgBefore = log.damages.length;
kenpachi.setDynamicProperty("mv:cd_kenpachi_stomp", undefined);
useItem(kenpachi, "kenpachi:stomp");
advanceTicks(10, "stomp-fora");
check(
  "quem está fora da área não leva dano",
  !log.damages.slice(dmgBefore).some((d) => d.target === "Presa")
);

scenario("Kenpachi's Hunt");
mark = errors.length;
kenpachi.teleport({ x: -80, y: 64, z: -80 });
victim.teleport({ x: -60, y: 64, z: -80 });
victim._view = { x: 1, y: 0, z: 0 }; // olhando pro +x
useItem(kenpachi, "kenpachi:hunt");
advanceTicks(10, "hunt");
noNewErrors("Hunt executa limpo", mark);
check(
  "teleportou ATRÁS do alvo (lado oposto ao que ele olha)",
  kenpachi.location.x < victim.location.x &&
    Math.abs(kenpachi.location.x - victim.location.x) <= 2,
  `kenpachi.x=${kenpachi.location.x.toFixed(2)} victim.x=${victim.location.x.toFixed(2)}`
);
check("alvo com slowness 5 (amplifier 4)", victim.getEffect("slowness")?.amplifier === 4);
check("alvo com darkness", !!victim.getEffect("darkness"));

mark = errors.length;
kenpachi.setDynamicProperty("mv:cd_kenpachi_hunt", undefined);
victim.teleport({ x: 500, y: 64, z: 500 }); // ninguém por perto
const huntPos = { ...kenpachi.location };
useItem(kenpachi, "kenpachi:hunt");
advanceTicks(5, "hunt-sem-alvo");
noNewErrors("Hunt sem alvo não lança", mark);
check(
  "sem alvo, não teleporta e não gasta cooldown",
  kenpachi.location.x === huntPos.x &&
    kenpachi.getDynamicProperty("mv:cd_kenpachi_hunt") === undefined
);

scenario("Hell's Cut");
mark = errors.length;
kenpachi.teleport({ x: -80, y: 64, z: -80 });
kenpachi._view = { x: 1, y: 0, z: 0 };
prey.teleport({ x: -75, y: 64, z: -80 });
dmgBefore = log.damages.length;
useItem(kenpachi, "kenpachi:hells_cut");
advanceTicks(30, "hells-cut");
noNewErrors("Hell's Cut executa limpo", mark);
check(
  "75 de dano (mesmo do Getsuga Tenshou)",
  log.damages.slice(dmgBefore).some((d) => d.target === "Presa" && d.amount === 75)
);

const farPrey = createDummy("Longe", { x: -65, y: 64, z: -80 }, 500); // 15 blocos
dmgBefore = log.damages.length;
kenpachi.setDynamicProperty("mv:cd_kenpachi_hells_cut", undefined);
useItem(kenpachi, "kenpachi:hells_cut");
advanceTicks(30, "hells-cut-alcance");
check(
  "alcance é metade do Getsuga (não chega a 15 blocos)",
  !log.damages.slice(dmgBefore).some((d) => d.target === "Longe")
);

scenario("Awakening: Pressão espiritual");
mark = errors.length;
kenpachi.teleport({ x: -80, y: 64, z: -80 });
victim.teleport({ x: -70, y: 64, z: -80 });
prey.teleport({ x: -75, y: 64, z: -80 });
hp(kenpachi).setCurrentValue(200); // não está cheio: o awakening não pode curar
kenpachi.setDynamicProperty(DP.awakening, 100);
const msgsBeforePressure = log.worldMessages.length;
kenpachi.isSneaking = true;
useItem(kenpachi, "kenpachi:m1_zanpakuto");
kenpachi.isSneaking = false;
advanceTicks(2, "pressao-inicio");
noNewErrors("ativar Pressão sem erro", mark);
check("awakened = true", kenpachi.getDynamicProperty(DP.awakened) === true);
check("vida máxima continua 300", hp(kenpachi).effectiveMax === 300, `${hp(kenpachi).effectiveMax}`);
check("awakening NÃO cura (vida continua 200)", hp(kenpachi).currentValue <= 200, `${hp(kenpachi).currentValue}`);
check(
  "itens continuam os mesmos",
  inv(kenpachi).getItem(0)?.typeId === "kenpachi:m1_zanpakuto" &&
    inv(kenpachi).getItem(4)?.typeId === "kenpachi:hells_cut"
);
check(
  "cada player preso 'fala' no chat",
  log.worldMessages
    .slice(msgsBeforePressure)
    .some((m) => m.message === "<Vítima> Que pressão espiritual tremenda!")
);

victim.teleport({ x: -20, y: 64, z: -80 }); // tenta fugir da pressão
advanceTicks(6, "pressao-prende");
check(
  "preso pela pressão volta pro lugar (fica parado)",
  Math.abs(victim.location.x - (-70)) < 0.01,
  `x=${victim.location.x.toFixed(2)}`
);
check("preso fica cego", !!victim.getEffect("blindness"));

dmgBefore = log.damages.length;
advanceTicks(60, "pressao-dot");
const pressureHits = log.damages.slice(dmgBefore).filter((d) => d.target === "Vítima" && d.amount === 10);
check("10 de dano por segundo durante a pressão", pressureHits.length >= 1, `${pressureHits.length} ticks de dano`);
noNewErrors("pressão roda os 3s sem erro", mark);

check("pressão soltou: enxerga de novo", !victim.getEffect("blindness"));
victim.teleport({ x: -20, y: 64, z: -80 });
advanceTicks(10, "pressao-soltou");
check(
  "pressão soltou: se mexe de novo",
  Math.abs(victim.location.x - (-20)) < 0.01,
  `x=${victim.location.x.toFixed(2)}`
);

scenario("Pressão: +50% de dano");
mark = errors.length;
kenpachi.teleport({ x: -80, y: 64, z: -80 });
prey.teleport({ x: -79, y: 64, z: -80 });
kenpachi.setDynamicProperty("mv:cd_kenpachi_stomp", undefined);
dmgBefore = log.damages.length;
useItem(kenpachi, "kenpachi:stomp");
advanceTicks(10, "stomp-buffado");
check(
  "Stomp com +50%: 45 → 67.5",
  log.damages.slice(dmgBefore).some((d) => d.target === "Presa" && Math.abs(d.amount - 67.5) < 0.01),
  JSON.stringify(log.damages.slice(dmgBefore).map((d) => d.amount))
);

dmgBefore = log.damages.length;
hitWith(kenpachi, prey, "kenpachi:m1_zanpakuto");
check(
  "m1 com +50%: bônus de 7 por cima do dano do item",
  log.damages.slice(dmgBefore).some((d) => d.amount === 7),
  JSON.stringify(log.damages.slice(dmgBefore).map((d) => d.amount))
);
noNewErrors("dano buffado sem erro", mark);

scenario("Hell's Cut de desespero (vida ≤ 60)");
mark = errors.length;
kenpachi.teleport({ x: -80, y: 64, z: -80 });
prey.teleport({ x: -75, y: 64, z: -80 });
hp(kenpachi).setCurrentValue(200);
kenpachi.setDynamicProperty("mv:cd_kenpachi_hells_cut", undefined);
dmgBefore = log.damages.length;
useItem(kenpachi, "kenpachi:hells_cut");
advanceTicks(30, "hells-cut-normal");
const normalHit = log.damages.slice(dmgBefore).find((d) => d.target === "Presa");
check("com vida alta: dano normal (75 x1.5 = 112.5)", normalHit && Math.abs(normalHit.amount - 112.5) < 0.01, `${normalHit?.amount}`);

hp(kenpachi).setCurrentValue(55); // abaixo do limite de 60
kenpachi.setDynamicProperty("mv:cd_kenpachi_hells_cut", undefined);
dmgBefore = log.damages.length;
useItem(kenpachi, "kenpachi:hells_cut");
advanceTicks(30, "hells-cut-desespero");
const desperateHit = log.damages.slice(dmgBefore).find((d) => d.target === "Presa");
check(
  "com vida ≤60: dano base triplica (225 x1.5 = 337.5)",
  desperateHit && Math.abs(desperateHit.amount - 337.5) < 0.01,
  `${desperateHit?.amount}`
);
noNewErrors("golpe de desespero sem erro", mark);

scenario("Kenpachi: fim do Awakening");
mark = errors.length;
kenpachi.setDynamicProperty(DP.awakening, 2);
hp(kenpachi).setCurrentValue(120);
advanceTicks(90, "drenar-pressao");
noNewErrors("reversão sem erro", mark);
check("awakened = false", kenpachi.getDynamicProperty(DP.awakened) === false);
check("vida máxima continua 300", hp(kenpachi).effectiveMax === 300);
check("NÃO curou ao reverter", hp(kenpachi).currentValue <= 120, `${hp(kenpachi).currentValue}`);

kenpachi.teleport({ x: -80, y: 64, z: -80 });
prey.teleport({ x: -79, y: 64, z: -80 });
kenpachi.setDynamicProperty("mv:cd_kenpachi_stomp", undefined);
dmgBefore = log.damages.length;
useItem(kenpachi, "kenpachi:stomp");
advanceTicks(10, "stomp-sem-buff");
check(
  "sem awakening o dano volta pra 45",
  log.damages.slice(dmgBefore).some((d) => d.target === "Presa" && d.amount === 45),
  JSON.stringify(log.damages.slice(dmgBefore).map((d) => d.amount))
);

/* ================= Mayuri Kurotsuchi ================= */

scenario("Mayuri Kurotsuchi: ativação");
const mayuri = createPlayer("MayuriPlayer", { x: 200, y: 64, z: 200 });
const cobaia = createDummy("Cobaia", { x: 203, y: 64, z: 200 }, 5000);

mark = errors.length;
emit("playerSpawn", { player: mayuri, initialSpawn: true });
advanceTicks(20, "spawn-mayuri");
queueFormResponse(CHARACTER_IDS.mayuri);
useItem(mayuri, "multiversal:character_selector");
await Promise.resolve();
await Promise.resolve();
advanceTicks(20, "ativar-mayuri");
noNewErrors("ativar Mayuri sem erro", mark);
check("personagem salvo", mayuri.getDynamicProperty(DP.character) === "mayuri");
check("vida maxima 180", hp(mayuri).effectiveMax === 180, `${hp(mayuri).effectiveMax}`);
check(
  "3 itens nos slots 0-2",
  JSON.stringify(slotIds(mayuri, 3)) ===
    JSON.stringify(["mayuri:m1_ashisogi_jizo", "mayuri:poison_slash", "mayuri:toxic_fog"]),
  JSON.stringify(slotIds(mayuri, 3))
);
check(
  "slots 3 e 4 ficam livres",
  inv(mayuri).getItem(3) === undefined && inv(mayuri).getItem(4) === undefined
);

scenario("Ashisogi Jizō: lentidão a cada 3 hits");
mark = errors.length;
mayuri.teleport({ x: 200, y: 64, z: 200 });
cobaia.teleport({ x: 201, y: 64, z: 200 });
hitWith(mayuri, cobaia, "mayuri:m1_ashisogi_jizo");
check("1º hit: sem lentidão", !cobaia.getEffect("slowness"));
hitWith(mayuri, cobaia, "mayuri:m1_ashisogi_jizo");
check("2º hit: sem lentidão", !cobaia.getEffect("slowness"));
hitWith(mayuri, cobaia, "mayuri:m1_ashisogi_jizo");
check("3º hit: aplica lentidão", !!cobaia.getEffect("slowness"));
check(
  "lentidão dura 3 segundos",
  (cobaia.getEffect("slowness")?.endTick ?? 0) - system.currentTick === 60,
  `${(cobaia.getEffect("slowness")?.endTick ?? 0) - system.currentTick} ticks`
);

cobaia.removeEffect("slowness");
hitWith(mayuri, cobaia, "mayuri:m1_ashisogi_jizo");
hitWith(mayuri, cobaia, "mayuri:m1_ashisogi_jizo");
check("contador reiniciou (4º e 5º hit sem lentidão)", !cobaia.getEffect("slowness"));
hitWith(mayuri, cobaia, "mayuri:m1_ashisogi_jizo");
check("6º hit: aplica de novo", !!cobaia.getEffect("slowness"));
noNewErrors("combo do m1 sem erro", mark);
cobaia.removeEffect("slowness");

scenario("Poison Slash: caixa de 4 pra frente x 3 de largura");
mark = errors.length;
mayuri.teleport({ x: 200, y: 64, z: 200 });
mayuri._view = { x: 1, y: 0, z: 0 }; // olhando pro +x
const naFrente = createDummy("NaFrente", { x: 203, y: 64, z: 200 }, 500);
const longeDemais = createDummy("LongeDemais", { x: 206, y: 64, z: 200 }, 500);
const deLado = createDummy("DeLado", { x: 202, y: 64, z: 203 }, 500);
const atras = createDummy("Atras", { x: 198, y: 64, z: 200 }, 500);
cobaia.teleport({ x: 500, y: 64, z: 500 });

dmgBefore = log.damages.length;
useItem(mayuri, "mayuri:poison_slash");
advanceTicks(10, "poison-slash");
noNewErrors("Poison Slash executa limpo", mark);
const slashHits = log.damages.slice(dmgBefore);
check(
  "20 de dano em quem está na frente",
  slashHits.some((d) => d.target === "NaFrente" && d.amount === 20)
);
check("não pega a 6 blocos (limite é 4)", !slashHits.some((d) => d.target === "LongeDemais"));
check("não pega a 3 blocos de lado (largura é 3 total)", !slashHits.some((d) => d.target === "DeLado"));
check("não pega quem está atrás", !slashHits.some((d) => d.target === "Atras"));
check(
  "aplica lentidão máxima por 2 segundos",
  naFrente.getEffect("slowness")?.amplifier === 255 &&
    (naFrente.getEffect("slowness")?.endTick ?? 0) - system.currentTick <= 40,
  `amp=${naFrente.getEffect("slowness")?.amplifier}`
);
for (const d of [longeDemais, deLado, atras]) d.kill();

scenario("Toxic Fog: 10x10, poison 10 + slowness 3 por 15s");
mark = errors.length;
mayuri.teleport({ x: 200, y: 64, z: 200 });
naFrente.teleport({ x: 203, y: 64, z: 200 }); // 3 blocos: dentro do raio 5
const foraDaNevoa = createDummy("ForaDaNevoa", { x: 208, y: 64, z: 200 }, 500);
naFrente.removeEffect("slowness");

const partBeforeFog = log.particles.length;
useItem(mayuri, "mayuri:toxic_fog");
advanceTicks(30, "fog-inicio");
noNewErrors("Toxic Fog executa limpo", mark);
check("poison 10 (amplifier 9) em quem está na neblina", naFrente.getEffect("poison")?.amplifier === 9);
check("slowness 3 (amplifier 2) em quem está na neblina", naFrente.getEffect("slowness")?.amplifier === 2);
check("quem está fora do 10x10 não é afetado", !foraDaNevoa.getEffect("poison"));
check("Mayuri não se envenena", !mayuri.getEffect("poison"));
const fogParticles = log.particles.slice(partBeforeFog);
check(
  "neblina roxa desenhada com a partícula customizada",
  fogParticles.length > 20 && fogParticles.every((p) => p.particleId === "mayuri:toxic_fog"),
  `${fogParticles.length} partículas`
);

mark = errors.length;
advanceTicks(300, "fog-fim");
noNewErrors("Toxic Fog roda os 15s sem erro", mark);
check(
  "neblina acaba sozinha",
  log.worldMessages.some((m) => m.to === "MayuriPlayer" && m.message.includes("se dissipou"))
);
advanceTicks(40, "fog-efeitos-expiram");
check("efeitos param de ser renovados depois que a neblina acaba", !naFrente.getEffect("poison"));

scenario("Mayuri não herda o carregamento do Senkei");
mark = errors.length;
mayuri.teleport({ x: 200, y: 64, z: 200 });
mayuri.setDynamicProperty(DP.awakening, 0);
const msgsBeforeCharge = log.worldMessages.length;
mayuri.isSneaking = true;
inv(mayuri).setItem(0, new ItemStack("mayuri:m1_ashisogi_jizo", 1));
advanceTicks(140, "carga-indevida"); // bem mais que os 5s de carga do Senkei
mayuri.isSneaking = false;
noNewErrors("segurar agachado com a m1 não lança", mark);
check(
  "não recebe o círculo de carga do Senkei",
  !log.worldMessages.slice(msgsBeforeCharge).some((m) => m.message.includes("Senkei carregado"))
);
check(
  "actionbar não mostra 'carregado'",
  !log.actionBars.slice(-8).some((a) => a.player === "MayuriPlayer" && a.text.includes("carregado"))
);

scenario("Bankai: Konjiki Ashisogi Jizō");
mark = errors.length;
mayuri.teleport({ x: 200, y: 64, z: 200 });
naFrente.teleport({ x: 218, y: 64, z: 200 }); // 18 blocos: dentro do 50x50
foraDaNevoa.teleport({ x: 240, y: 64, z: 200 }); // 40 blocos: fora
naFrente.removeEffect("poison");
naFrente.removeEffect("slowness");

// sem o medidor cheio a Bankai não sai
mayuri.setDynamicProperty(DP.awakening, 40);
mayuri.isSneaking = true;
useItem(mayuri, "mayuri:m1_ashisogi_jizo");
advanceTicks(15, "bankai-sem-medidor");
check("sem 100% de medidor a Bankai não sai", !naFrente.getEffect("poison"));
check("e o medidor não é consumido", mayuri.getDynamicProperty(DP.awakening) === 40);

mayuri.setDynamicProperty(DP.awakening, 100);
const partBeforeBankai = log.particles.length;
useItem(mayuri, "mayuri:m1_ashisogi_jizo");
mayuri.isSneaking = false;
advanceTicks(30, "bankai");
noNewErrors("Konjiki executa limpo", mark);
check("consumiu o medidor", mayuri.getDynamicProperty(DP.awakening) === 0);
check(
  "poison 20 (amplifier 19)",
  naFrente.getEffect("poison")?.amplifier === 19,
  `${naFrente.getEffect("poison")?.amplifier}`
);
check(
  "lentidão máxima (amplifier 255)",
  naFrente.getEffect("slowness")?.amplifier === 255,
  `${naFrente.getEffect("slowness")?.amplifier}`
);
check("alcança 18 blocos (área 50x50)", !!naFrente.getEffect("poison"));
check("não alcança 40 blocos", !foraDaNevoa.getEffect("poison"));
check("Mayuri não se envenena", !mayuri.getEffect("poison"));
const bankaiParticles = log.particles.slice(partBeforeBankai);
check(
  "neblina densa desenhada com a partícula customizada",
  bankaiParticles.length > 150 &&
    bankaiParticles.every((p) => p.particleId === "mayuri:toxic_fog"),
  `${bankaiParticles.length} partículas`
);

mark = errors.length;
advanceTicks(300, "bankai-fim");
noNewErrors("Konjiki roda os 15s sem erro", mark);
check(
  "Bankai acaba sozinha",
  log.worldMessages.some(
    (m) => m.to === "MayuriPlayer" && m.message.includes("Konjiki Ashisogi Jizō se dissipou")
  )
);
advanceTicks(40, "bankai-efeitos-expiram");
check("efeitos param de ser renovados quando a neblina acaba", !naFrente.getEffect("poison"));
check("Mayuri não vira forma persistente", !mayuri.getDynamicProperty(DP.awakened));
check("vida maxima continua 180", hp(mayuri).effectiveMax === 180);
naFrente.kill();
foraDaNevoa.kill();

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
queueFormResponse(Object.keys(CHARACTER_IDS).length); // botao "Desativar personagem"
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
