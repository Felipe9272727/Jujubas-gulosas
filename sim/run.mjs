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

// espelho do registro ARCS do main.js: o menu so mostra o arco atual, entao o
// indice do botao e relativo ao arco, nao ao CHARACTERS inteiro
const CERO_METRALLETA_BULLETS = 6; // espelho da constante do main.js

const ROSTER = [
  { name: "Invasão à Soul Society", ids: ["ichigo", "byakuya", "kenpachi", "mayuri"] },
  { name: "Arrancar / Hueco Mundo", ids: ["grimmjow", "ulquiorra", "starkk", "yammy"] },
];

function locate(id) {
  for (let arcIndex = 0; arcIndex < ROSTER.length; arcIndex++) {
    const buttonIndex = ROSTER[arcIndex].ids.indexOf(id);
    if (buttonIndex !== -1) return { arcIndex, buttonIndex };
  }
  throw new Error(`personagem fora de qualquer arco: ${id}`);
}

// leva o player ate o arco certo (agachar + seletor) e escolhe o personagem
async function pickCharacter(player, id) {
  const { arcIndex, buttonIndex } = locate(id);
  const current = player.getDynamicProperty("mv:arc") ?? 0;
  const steps = (arcIndex - current + ROSTER.length) % ROSTER.length;

  player.isSneaking = true;
  for (let i = 0; i < steps; i++) useItem(player, "multiversal:character_selector");
  player.isSneaking = false;

  queueFormResponse(buttonIndex);
  useItem(player, "multiversal:character_selector");
  await Promise.resolve();
  await Promise.resolve();
}

// o botao "Desativar" fica logo depois dos personagens do arco atual
function deactivateButtonIndex(player) {
  const arcIndex = player.getDynamicProperty("mv:arc") ?? 0;
  return ROSTER[arcIndex].ids.length;
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
// vida maxima do jeito que o player enxerga: acima do teto do Bedrock o pool
// real e menor e a escala repoe a diferenca
// vida atual do jeito que o player enxerga
function virtualHp(p) {
  const scale = p.getDynamicProperty("mv:health_scale") ?? 1;
  return hp(p).currentValue * scale;
}

function virtualMax(p) {
  const scale = p.getDynamicProperty("mv:health_scale") ?? 1;
  return Math.round(hp(p).effectiveMax * scale);
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
await pickCharacter(ichigo, "ichigo");
advanceTicks(20, "ativar ichigo");
noNewErrors("abrir menu + escolher personagem sem erro", mark);
check(
  "form lista só os personagens do arco atual",
  shownForms.length === 1 && shownForms[0].buttons.length === ROSTER[0].ids.length,
  `${shownForms[0]?.buttons.length} botões`
);
check(
  "form mostra o nome do arco",
  (shownForms[0]?.body ?? "").includes(ROSTER[0].name),
  shownForms[0]?.body
);
check("personagem salvo", ichigo.getDynamicProperty(DP.character) === "ichigo");
check("vida maxima 200", virtualMax(ichigo) === 200, `${virtualMax(ichigo)}`);
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

await pickCharacter(byakuya, "byakuya");
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
check(
  "m1 aplica o dano base inteiro pelo script (8), não parcial pelo item",
  log.damages.slice(-10).every((d) => d.target === "Dummy" && d.amount === 8),
  JSON.stringify(log.damages.slice(-10).map((d) => d.amount))
);

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
check("vida maxima 400", virtualMax(ichigo) === 400, `${virtualMax(ichigo)}`);
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
check("vida maxima de volta pra 200", virtualMax(ichigo) === 200, `${virtualMax(ichigo)}`);
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
await pickCharacter(kenpachi, "kenpachi");
advanceTicks(20, "ativar-kenpachi");
noNewErrors("ativar Kenpachi sem erro", mark);
check("personagem salvo", kenpachi.getDynamicProperty(DP.character) === "kenpachi");
check("vida maxima 300", virtualMax(kenpachi) === 300, `${virtualMax(kenpachi)}`);
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
check("vida máxima continua 300", virtualMax(kenpachi) === 300, `${virtualMax(kenpachi)}`);
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
  "m1 com +50%: 14 vira 21, dano inteiro pelo script",
  log.damages.slice(dmgBefore).some((d) => d.amount === 21),
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
check("vida máxima continua 300", virtualMax(kenpachi) === 300);
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
await pickCharacter(mayuri, "mayuri");
advanceTicks(20, "ativar-mayuri");
noNewErrors("ativar Mayuri sem erro", mark);
check("personagem salvo", mayuri.getDynamicProperty(DP.character) === "mayuri");
check("vida maxima 180", virtualMax(mayuri) === 180, `${virtualMax(mayuri)}`);
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
  fogParticles.length > 20 && fogParticles.every((p) => p.particleId === "mayuri:poison_fog"),
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
    bankaiParticles.every((p) => p.particleId === "mayuri:poison_fog"),
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
check("vida maxima continua 180", virtualMax(mayuri) === 180);
naFrente.kill();
foraDaNevoa.kill();

/* ================= arcos do seletor ================= */

scenario("Seletor separado por arcos");
const explorador = createPlayer("Explorador", { x: -300, y: 64, z: -300 }, 400);
emit("playerSpawn", { player: explorador, initialSpawn: true });
advanceTicks(20, "spawn-explorador");

mark = errors.length;
useItem(explorador, "multiversal:character_selector"); // sem resposta na fila = cancela
let shown = shownForms[shownForms.length - 1];
check("começa no primeiro arco", shown.body.includes(ROSTER[0].name), shown.body);
check(
  `primeiro arco lista ${ROSTER[0].ids.length} personagens`,
  shown.buttons.length === ROSTER[0].ids.length,
  `${shown.buttons.length} botões`
);

explorador.isSneaking = true;
useItem(explorador, "multiversal:character_selector");
explorador.isSneaking = false;
check("agachar + seletor avança pro próximo arco", explorador.getDynamicProperty("mv:arc") === 1);
check(
  "avisa em qual arco entrou",
  log.worldMessages.some((m) => m.to === "Explorador" && m.message.includes(ROSTER[1].name))
);

useItem(explorador, "multiversal:character_selector");
shown = shownForms[shownForms.length - 1];
check(
  `segundo arco lista ${ROSTER[1].ids.length} personagem`,
  shown.buttons.length === ROSTER[1].ids.length,
  `${shown.buttons.length} botões`
);
check(
  "segundo arco traz os Arrancar",
  ["Grimmjow", "Ulquiorra", "Starkk", "Yammy"].every((n) => shown.buttons.join(" ").includes(n)),
  shown.buttons.join(", ")
);

explorador.isSneaking = true;
useItem(explorador, "multiversal:character_selector");
explorador.isSneaking = false;
check("dá a volta depois do último arco", explorador.getDynamicProperty("mv:arc") === 0);
noNewErrors("trocar de arco sem erro", mark);

// varre todos os arcos: ninguém pode ficar de fora nem aparecer duas vezes
const todosOsBotoes = [];
for (let a = 0; a < ROSTER.length; a++) {
  useItem(explorador, "multiversal:character_selector");
  todosOsBotoes.push(...shownForms[shownForms.length - 1].buttons);
  explorador.isSneaking = true;
  useItem(explorador, "multiversal:character_selector");
  explorador.isSneaking = false;
}
const totalEsperado = ROSTER.reduce((n, arc) => n + arc.ids.length, 0);
check(
  "os arcos juntos cobrem todo o elenco, sem repetição",
  todosOsBotoes.length === totalEsperado && new Set(todosOsBotoes).size === totalEsperado,
  `${todosOsBotoes.length} botões, ${new Set(todosOsBotoes).size} únicos`
);

/* ================= Grimmjow Jaegerjaquez ================= */

scenario("Grimmjow Jaegerjaquez: ativação");
const grimmjow = createPlayer("GrimmjowPlayer", { x: -300, y: 64, z: 300 });
const presaG = createDummy("PresaG", { x: -297, y: 64, z: 300 }, 50000);
emit("playerSpawn", { player: grimmjow, initialSpawn: true });
advanceTicks(20, "spawn-grimmjow");

mark = errors.length;
await pickCharacter(grimmjow, "grimmjow");
advanceTicks(20, "ativar-grimmjow");
noNewErrors("ativar Grimmjow sem erro", mark);
check("vida maxima 800", virtualMax(grimmjow) === 800, `${virtualMax(grimmjow)}`);
check(
  "4 itens nos slots 0-3",
  JSON.stringify(slotIds(grimmjow, 4)) ===
    JSON.stringify([
      "grimmjow:m1_zanpakuto",
      "grimmjow:desgarra",
      "grimmjow:raza",
      "grimmjow:gran_rey_cero",
    ]),
  JSON.stringify(slotIds(grimmjow, 4))
);
check("slot 4 livre na forma base", inv(grimmjow).getItem(4) === undefined);

scenario("Desgarra de la Pantera");
mark = errors.length;
grimmjow.teleport({ x: -300, y: 64, z: 300 });
grimmjow._view = { x: 1, y: 0, z: 0 };
presaG.teleport({ x: -297, y: 64, z: 300 });
const naLargura = createDummy("NaLargura", { x: -297, y: 64, z: 303 }, 500); // 3 de lado
const foraDoCorte = createDummy("ForaDoCorte", { x: -293, y: 64, z: 300 }, 500); // 7 à frente
dmgBefore = log.damages.length;
useItem(grimmjow, "grimmjow:desgarra");
advanceTicks(10, "desgarra");
noNewErrors("Desgarra executa limpo", mark);
let hits = log.damages.slice(dmgBefore);
check("100 de dano na frente", hits.some((d) => d.target === "PresaG" && d.amount === 100));
check("corte é largo: pega 3 blocos de lado", hits.some((d) => d.target === "NaLargura"));
check("não pega a 7 blocos (alcance é 5)", !hits.some((d) => d.target === "ForaDoCorte"));
naLargura.kill();
foraDoCorte.kill();

scenario("Raza de la Pantera");
mark = errors.length;
grimmjow.teleport({ x: -300, y: 64, z: 300 });
presaG.teleport({ x: -295, y: 64, z: 300 });
dmgBefore = log.damages.length;
useItem(grimmjow, "grimmjow:raza");
advanceTicks(11, "raza"); // 10 passos de 2 blocos
noNewErrors("Raza executa limpo", mark);
check(
  "200 de dano em quem está no caminho",
  log.damages.slice(dmgBefore).some((d) => d.target === "PresaG" && d.amount === 200)
);
check(
  "percorre os 20 blocos em 10 ticks (dobro da velocidade do Getsuga Run)",
  grimmjow.location.x >= -300 + 19.9,
  `andou ${(grimmjow.location.x + 300).toFixed(1)} blocos`
);

scenario("Gran Rey Cero");
mark = errors.length;
grimmjow.teleport({ x: -300, y: 64, z: 300 });
grimmjow._view = { x: 1, y: 0, z: 0 };
presaG.teleport({ x: -290, y: 64, z: 300 }); // 10 blocos à frente
const foraDoAlcance = createDummy("ForaDoAlcance", { x: -260, y: 64, z: 300 }, 500); // 40
dmgBefore = log.damages.length;
const partBeforeCero = log.particles.length;
useItem(grimmjow, "grimmjow:gran_rey_cero");
advanceTicks(40, "cero");
noNewErrors("Gran Rey Cero executa limpo", mark);
hits = log.damages.slice(dmgBefore);
check("350 de dano no alvo", hits.some((d) => d.target === "PresaG" && d.amount === 350));
check("não passa do alcance de 28 blocos", !hits.some((d) => d.target === "ForaDoAlcance"));
check(
  "esfera desenhada com a partícula azul do cero",
  log.particles.slice(partBeforeCero).some((p) => p.particleId === "grimmjow:cero")
);
check(
  "atinge cada alvo uma vez só",
  hits.filter((d) => d.target === "PresaG").length === 1,
  `${hits.filter((d) => d.target === "PresaG").length} acertos`
);
foraDoAlcance.kill();

scenario("Resurrección: La Pantera");
mark = errors.length;
grimmjow.teleport({ x: -300, y: 64, z: 300 });
hp(grimmjow).setCurrentValue(500);
grimmjow.setDynamicProperty(DP.awakening, 100);
const msgsBeforeRes = log.worldMessages.length;
grimmjow.isSneaking = true;
useItem(grimmjow, "grimmjow:m1_zanpakuto");
grimmjow.isSneaking = false;
advanceTicks(20, "resurreccion");
noNewErrors("Resurrección sem erro", mark);
check("awakened = true", grimmjow.getDynamicProperty(DP.awakened) === true);
check(
  'grita "Mutile, Pantera" no chat',
  log.worldMessages
    .slice(msgsBeforeRes)
    .some((m) => m.message === "<GrimmjowPlayer> Mutile, Pantera")
);
check("vida maxima 1200", virtualMax(grimmjow) === 1200, `${virtualMax(grimmjow)}`);
check("speed 5 (amplifier 4)", grimmjow.getEffect("speed")?.amplifier === 4, `${grimmjow.getEffect("speed")?.amplifier}`);
check("regen 4 (amplifier 3)", grimmjow.getEffect("regeneration")?.amplifier === 3, `${grimmjow.getEffect("regeneration")?.amplifier}`);
check(
  "5 itens de La Pantera",
  JSON.stringify(slotIds(grimmjow, 5)) ===
    JSON.stringify([
      "grimmjow:m1_garras",
      "grimmjow:destruir",
      "grimmjow:rugido",
      "grimmjow:arrancar_corazon",
      "grimmjow:disparo",
    ]),
  JSON.stringify(slotIds(grimmjow, 5))
);

scenario("Destruir de La Pantera");
mark = errors.length;
grimmjow.teleport({ x: -300, y: 64, z: 300 });
grimmjow._view = { x: 1, y: 0, z: 0 };
presaG.teleport({ x: -296, y: 64, z: 300 });
dmgBefore = log.damages.length;
useItem(grimmjow, "grimmjow:destruir");
advanceTicks(30, "destruir");
noNewErrors("Destruir executa limpo", mark);
check(
  "270 de dano",
  log.damages.slice(dmgBefore).some((d) => d.target === "PresaG" && d.amount === 270)
);
check(
  "três cortes desenhados",
  log.sounds.slice(-6).filter((s) => s.soundId === "mob.wither.shoot").length >= 3
);

scenario("Rugido de La Pantera");
mark = errors.length;
grimmjow.teleport({ x: -300, y: 64, z: 300 });
presaG.teleport({ x: -298, y: 64, z: 300 });
dmgBefore = log.damages.length;
useItem(grimmjow, "grimmjow:rugido");
advanceTicks(45, "rugido");
noNewErrors("Rugido executa limpo", mark);
const rugidoHits = log.damages
  .slice(dmgBefore)
  .filter((d) => d.target === "PresaG")
  .map((d) => d.amount);
check(
  "três sequências: 100, 150 e 200",
  JSON.stringify(rugidoHits) === JSON.stringify([100, 150, 200]),
  JSON.stringify(rugidoHits)
);

scenario("Arrancar Corazón");
mark = errors.length;
grimmjow.teleport({ x: -300, y: 64, z: 300 });
grimmjow._view = { x: 1, y: 0, z: 0 };
presaG.teleport({ x: 900, y: 64, z: 900 }); // dummy longe: a skill só pega player
const vitima = createPlayer("Vitima", { x: -297, y: 64, z: 300 }, 20000);
dmgBefore = log.damages.length;
const partBeforeHeart = log.particles.length;
useItem(grimmjow, "grimmjow:arrancar_corazon");
advanceTicks(10, "corazon-agarra");
check(
  "agarra o player no caminho",
  log.worldMessages.some((m) => m.message.includes(`agarrou ${vitima.name}`))
);
const grabDist = Math.hypot(
  vitima.location.x - grimmjow.location.x,
  vitima.location.z - grimmjow.location.z
);
check("segura a vítima na frente do Grimmjow", grabDist <= 2, `dist=${grabDist.toFixed(2)}`);
check("vítima não consegue se mexer", vitima.getEffect("slowness")?.amplifier === 255);
check(
  "partículas de sangue saindo da vítima",
  log.particles.slice(partBeforeHeart).some((p) => p.particleId === "minecraft:blood_particle")
);
check("ainda não causou o dano", !log.damages.slice(dmgBefore).some((d) => d.amount === 700));

advanceTicks(40, "corazon-arranca");
noNewErrors("Arrancar Corazón executa limpo", mark);
check(
  "700 de dano ao arrancar o coração",
  log.damages.slice(dmgBefore).some((d) => d.target === "Vitima" && d.amount === 700)
);
check("solta a vítima no fim", !vitima.getEffect("slowness"));

mark = errors.length;
grimmjow.setDynamicProperty("mv:cd_grimmjow_arrancar_corazon", undefined);
vitima.teleport({ x: 900, y: 64, z: 900 });
grimmjow.teleport({ x: -300, y: 64, z: 300 });
dmgBefore = log.damages.length;
useItem(grimmjow, "grimmjow:arrancar_corazon");
advanceTicks(15, "corazon-sem-alvo");
noNewErrors("avanço sem alvo não lança", mark);
check(
  "sem player no caminho, avisa e não agarra",
  log.worldMessages.some(
    (m) => m.to === "GrimmjowPlayer" && m.message.includes("não agarrou ninguém")
  ) && !log.damages.slice(dmgBefore).some((d) => d.amount === 700)
);

scenario("Disparo de La Pantera");
mark = errors.length;
useItem(grimmjow, "grimmjow:disparo");
advanceTicks(5, "disparo");
noNewErrors("Disparo executa limpo", mark);
check("speed 10 (amplifier 9)", grimmjow.getEffect("speed")?.amplifier === 9, `${grimmjow.getEffect("speed")?.amplifier}`);

advanceTicks(110, "disparo-acaba");
check(
  "quando o buff acaba, volta pro speed 5 da forma (não fica sem speed)",
  grimmjow.getEffect("speed")?.amplifier === 4,
  `${grimmjow.getEffect("speed")?.amplifier}`
);
check("e a vida maxima continua 1200", virtualMax(grimmjow) === 1200);

scenario("Fim da Resurrección");
mark = errors.length;
grimmjow.setDynamicProperty(DP.awakening, 2);
hp(grimmjow).setCurrentValue(600);
advanceTicks(90, "drenar-resurreccion");
noNewErrors("reversão sem erro", mark);
check("awakened = false", grimmjow.getDynamicProperty(DP.awakened) === false);
check("vida maxima volta pra 800", virtualMax(grimmjow) === 800, `${virtualMax(grimmjow)}`);
check("speed volta pro 2 base", grimmjow.getEffect("speed")?.amplifier === 1, `${grimmjow.getEffect("speed")?.amplifier}`);
check("regen volta pro 2 base", grimmjow.getEffect("regeneration")?.amplifier === 1, `${grimmjow.getEffect("regeneration")?.amplifier}`);
check("NÃO curou ao reverter", hp(grimmjow).currentValue <= 600, `${hp(grimmjow).currentValue}`);
check(
  "itens base restaurados",
  JSON.stringify(slotIds(grimmjow, 4)) ===
    JSON.stringify([
      "grimmjow:m1_zanpakuto",
      "grimmjow:desgarra",
      "grimmjow:raza",
      "grimmjow:gran_rey_cero",
    ]),
  JSON.stringify(slotIds(grimmjow, 4))
);

/* ================= Ulquiorra Cifer ================= */

scenario("Ulquiorra Cifer: ativação e vida acima do teto");
const ulquiorra = createPlayer("UlquiorraPlayer", { x: 600, y: 64, z: 600 });
const alvoU = createDummy("AlvoU", { x: 605, y: 64, z: 600 }, 500000);
emit("playerSpawn", { player: ulquiorra, initialSpawn: true });
advanceTicks(20, "spawn-ulquiorra");

mark = errors.length;
await pickCharacter(ulquiorra, "ulquiorra");
advanceTicks(20, "ativar-ulquiorra");
noNewErrors("ativar Ulquiorra sem erro", mark);
check("vida maxima 1600", virtualMax(ulquiorra) === 1600, `${virtualMax(ulquiorra)}`);
check(
  "pool real fica no teto do Bedrock (1044)",
  hp(ulquiorra).effectiveMax === 1044,
  `${hp(ulquiorra).effectiveMax}`
);
check(
  "health_boost dentro do range do Bedrock",
  ulquiorra.getEffect("health_boost")?.amplifier === 255,
  `${ulquiorra.getEffect("health_boost")?.amplifier}`
);
advanceTicks(10, "actionbar-ulquiorra");
check(
  "actionbar mostra os 1600 configurados",
  log.actionBars.slice(-10).some((a) => a.player === "UlquiorraPlayer" && a.text.includes("/1600")),
  log.actionBars.filter((a) => a.player === "UlquiorraPlayer").slice(-1)[0]?.text
);
check(
  "5 itens nos slots 0-4",
  JSON.stringify(slotIds(ulquiorra, 5)) ===
    JSON.stringify([
      "ulquiorra:m1_zanpakuto",
      "ulquiorra:gran_rey_cero",
      "ulquiorra:cero_bala",
      "ulquiorra:sonido",
      "ulquiorra:pesquisa",
    ]),
  JSON.stringify(slotIds(ulquiorra, 5))
);

scenario("Cero Bala");
mark = errors.length;
ulquiorra.teleport({ x: 600, y: 64, z: 600 });
ulquiorra._view = { x: 1, y: 0, z: 0 };
alvoU.teleport({ x: 610, y: 64, z: 600 });
dmgBefore = log.damages.length;
useItem(ulquiorra, "ulquiorra:cero_bala");
advanceTicks(60, "cero-bala");
noNewErrors("Cero Bala executa limpo", mark);
const balaHits = log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoU");
check(
  "4 tiros de 100 de dano",
  balaHits.length === 4 && balaHits.every((d) => d.amount === 100),
  JSON.stringify(balaHits.map((d) => d.amount))
);

scenario("Dano respeita a vida virtual do alvo");
mark = errors.length;
const escalado = createDummy("Escalado", { x: 608, y: 64, z: 600 }, 500000);
escalado.setDynamicProperty("mv:health_scale", 2); // finge o dobro de vida virtual
alvoU.teleport({ x: 900, y: 64, z: 900 });
ulquiorra.setDynamicProperty("mv:cd_ulquiorra_cero_bala", undefined);
dmgBefore = log.damages.length;
useItem(ulquiorra, "ulquiorra:cero_bala");
advanceTicks(60, "cero-bala-escalado");
const escaladoHits = log.damages.slice(dmgBefore).filter((d) => d.target === "Escalado");
check(
  "num alvo de escala 2, 100 nominal entra como 50 reais",
  escaladoHits.length === 4 && escaladoHits.every((d) => d.amount === 50),
  JSON.stringify(escaladoHits.map((d) => d.amount))
);
noNewErrors("dano escalado sem erro", mark);
escalado.kill();

scenario("Sonído");
mark = errors.length;
ulquiorra.teleport({ x: 600, y: 64, z: 600 });
const fugitivoU = createPlayer("FugitivoU", { x: 630, y: 64, z: 600 }, 5000);
useItem(ulquiorra, "ulquiorra:sonido");
advanceTicks(5, "sonido");
noNewErrors("Sonído executa limpo", mark);
const sonidoDist = Math.hypot(
  ulquiorra.location.x - fugitivoU.location.x,
  ulquiorra.location.z - fugitivoU.location.z
);
check("teleporta colado no player mais próximo", sonidoDist <= 2, `dist=${sonidoDist.toFixed(2)}`);

ulquiorra.setDynamicProperty("mv:cd_ulquiorra_sonido", undefined);
fugitivoU.teleport({ x: 2000, y: 64, z: 2000 });
ulquiorra.teleport({ x: 600, y: 64, z: 600 });
useItem(ulquiorra, "ulquiorra:sonido");
advanceTicks(5, "sonido-sem-alvo");
check(
  "sem player por perto não teleporta nem gasta cooldown",
  ulquiorra.location.x === 600 &&
    ulquiorra.getDynamicProperty("mv:cd_ulquiorra_sonido") === undefined
);

scenario("Pesquisa: marca quem está na mira");
mark = errors.length;
ulquiorra.teleport({ x: 600, y: 64, z: 600 });
ulquiorra._view = { x: 1, y: 0, z: 0 };
alvoU.teleport({ x: 606, y: 64, z: 600 });
useItem(ulquiorra, "ulquiorra:pesquisa");
advanceTicks(5, "pesquisa");
noNewErrors("Pesquisa executa limpo", mark);
check("marca o alvo que está na mira", (alvoU.getDynamicProperty("mv:marked_end") ?? 0) > system.currentTick);

ulquiorra.setDynamicProperty("mv:cd_ulquiorra_cero_bala", undefined);
dmgBefore = log.damages.length;
useItem(ulquiorra, "ulquiorra:cero_bala");
advanceTicks(60, "cero-bala-marcado");
const marcadoHits = log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoU");
check(
  "marcado recebe +50% de dano (100 vira 150)",
  marcadoHits.length === 4 && marcadoHits.every((d) => d.amount === 150),
  JSON.stringify(marcadoHits.map((d) => d.amount))
);

alvoU.setDynamicProperty("mv:marked_end", 0);
ulquiorra.setDynamicProperty("mv:cd_ulquiorra_cero_bala", undefined);
dmgBefore = log.damages.length;
useItem(ulquiorra, "ulquiorra:cero_bala");
advanceTicks(60, "cero-bala-sem-marca");
check(
  "sem marca o dano volta pro normal",
  log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoU").every((d) => d.amount === 100)
);

scenario("Resurrección: Murciélago");
mark = errors.length;
ulquiorra.teleport({ x: 600, y: 64, z: 600 });
ulquiorra.setDynamicProperty(DP.awakening, 100);
const msgsBeforeConfine = log.worldMessages.length;
ulquiorra.isSneaking = true;
useItem(ulquiorra, "ulquiorra:m1_zanpakuto");
ulquiorra.isSneaking = false;
advanceTicks(20, "murcielago");
noNewErrors("Resurrección sem erro", mark);
check(
  'grita "Confine, Murciélago" no chat',
  log.worldMessages
    .slice(msgsBeforeConfine)
    .some((m) => m.message === "<UlquiorraPlayer> Confine, Murciélago")
);
check("vida maxima 2000", virtualMax(ulquiorra) === 2000, `${virtualMax(ulquiorra)}`);
check(
  "5 itens do Murciélago",
  JSON.stringify(slotIds(ulquiorra, 5)) ===
    JSON.stringify([
      "ulquiorra:m1_garras",
      "ulquiorra:nihil",
      "ulquiorra:enigma",
      "ulquiorra:cero_oscuras",
      "ulquiorra:lanza",
    ]),
  JSON.stringify(slotIds(ulquiorra, 5))
);

scenario("Nihil: 30% da vida do alvo");
mark = errors.length;
ulquiorra.teleport({ x: 600, y: 64, z: 600 });
ulquiorra._view = { x: 1, y: 0, z: 0 };
const cobaiaNihil = createDummy("CobaiaNihil", { x: 603, y: 64, z: 600 }, 1000);
hp(cobaiaNihil).setCurrentValue(1000);
dmgBefore = log.damages.length;
useItem(ulquiorra, "ulquiorra:nihil");
advanceTicks(10, "nihil");
noNewErrors("Nihil executa limpo", mark);
const nihilHit = log.damages.slice(dmgBefore).find((d) => d.target === "CobaiaNihil");
check("tira 30% da vida atual (1000 -> 300)", nihilHit && Math.abs(nihilHit.amount - 300) < 0.01, `${nihilHit?.amount}`);

ulquiorra.setDynamicProperty("mv:cd_ulquiorra_nihil", undefined);
dmgBefore = log.damages.length;
useItem(ulquiorra, "ulquiorra:nihil");
advanceTicks(10, "nihil-2");
const nihilHit2 = log.damages.slice(dmgBefore).find((d) => d.target === "CobaiaNihil");
check(
  "é sobre a vida ATUAL: com 700 restantes tira 210",
  nihilHit2 && Math.abs(nihilHit2.amount - 210) < 0.01,
  `${nihilHit2?.amount}`
);
cobaiaNihil.kill();

scenario("Enigma: zona que anula regeneração e skills");
mark = errors.length;
ulquiorra.teleport({ x: 600, y: 64, z: 600 });
const intruso = createPlayer("Intruso", { x: 1200, y: 64, z: 1200 }, 5000);
emit("playerSpawn", { player: intruso, initialSpawn: true });
advanceTicks(20, "spawn-intruso");
await pickCharacter(intruso, "mayuri");
advanceTicks(20, "ativar-intruso");
check("intruso tem regeneração antes da zona", !!intruso.getEffect("regeneration"));

useItem(ulquiorra, "ulquiorra:enigma");
advanceTicks(10, "enigma-abre");
noNewErrors("Enigma executa limpo", mark);

intruso.teleport({ x: 604, y: 64, z: 600 }); // dentro do raio 10
advanceTicks(20, "enigma-pega-intruso");
check("dentro da Enigma a regeneração é anulada", !intruso.getEffect("regeneration"));

intruso.teleport({ x: 640, y: 64, z: 600 }); // sai da zona
advanceTicks(20, "enigma-saiu");
check("quem sai da zona recupera a regeneração na hora", !!intruso.getEffect("regeneration"));
intruso.teleport({ x: 604, y: 64, z: 600 }); // volta pra dentro
advanceTicks(20, "enigma-voltou");
check("e perde de novo ao voltar", !intruso.getEffect("regeneration"));

const msgsBeforeBlock = log.worldMessages.length;
useItem(intruso, "mayuri:poison_slash");
advanceTicks(5, "enigma-bloqueia");
check(
  "skill inimiga é bloqueada dentro da zona",
  log.worldMessages.slice(msgsBeforeBlock).some((m) => m.message.includes("Enigma anula suas skills"))
);

const msgsBeforeOwn = log.worldMessages.length;
ulquiorra.setDynamicProperty("mv:cd_ulquiorra_nihil", undefined);
useItem(ulquiorra, "ulquiorra:nihil");
advanceTicks(5, "enigma-dono");
check(
  "o Ulquiorra continua usando as skills dele lá dentro",
  !log.worldMessages.slice(msgsBeforeOwn).some((m) => m.message.includes("Enigma anula")) &&
    log.worldMessages.slice(msgsBeforeOwn).some((m) => m.message.includes("Nihil"))
);

mark = errors.length;
advanceTicks(420, "enigma-acaba");
noNewErrors("Enigma fecha sem erro", mark);
check(
  "zona acaba sozinha em 20s",
  log.worldMessages.some((m) => m.to === "UlquiorraPlayer" && m.message.includes("Enigma se desfez"))
);
advanceTicks(10, "enigma-devolve-regen");
check("regeneração volta quando a zona fecha", !!intruso.getEffect("regeneration"));

const msgsAfterZone = log.worldMessages.length;
useItem(intruso, "mayuri:toxic_fog");
advanceTicks(5, "enigma-liberou");
check(
  "e as skills voltam a funcionar",
  !log.worldMessages.slice(msgsAfterZone).some((m) => m.message.includes("Enigma anula"))
);
intruso.teleport({ x: 1200, y: 64, z: 1200 });

scenario("Cero Oscuras");
mark = errors.length;
ulquiorra.teleport({ x: 600, y: 64, z: 600 });
ulquiorra._view = { x: 1, y: 0, z: 0 };
alvoU.teleport({ x: 612, y: 64, z: 600 });
const naBordaOscuras = createDummy("NaBordaOscuras", { x: 612, y: 64, z: 606 }, 500000); // 6 de lado
dmgBefore = log.damages.length;
useItem(ulquiorra, "ulquiorra:cero_oscuras");
advanceTicks(50, "cero-oscuras");
noNewErrors("Cero Oscuras executa limpo", mark);
check(
  "1400 de dano (4x o Gran Rey Cero)",
  log.damages.slice(dmgBefore).some((d) => d.target === "AlvoU" && d.amount === 1400)
);
check(
  "esfera 4x maior: pega alvo a 6 blocos do eixo",
  log.damages.slice(dmgBefore).some((d) => d.target === "NaBordaOscuras")
);
naBordaOscuras.kill();

scenario("Lanza del Relámpago");
mark = errors.length;
ulquiorra.teleport({ x: 600, y: 64, z: 600 });
ulquiorra._view = { x: 1, y: 0, z: 0 };
alvoU.teleport({ x: 900, y: 64, z: 900 });
const perto = createDummy("Perto", { x: 615, y: 64, z: 600 }, 500000);
const longe = createDummy("Longe18", { x: 631, y: 64, z: 600 }, 500000); // 16 do impacto (~615)
const bemLonge = createDummy("BemLonge", { x: 660, y: 64, z: 600 }, 500000); // 45 do impacto
dmgBefore = log.damages.length;
useItem(ulquiorra, "ulquiorra:lanza");
advanceTicks(40, "lanza");
noNewErrors("Lanza executa limpo", mark);
hits = log.damages.slice(dmgBefore);
check("900 de dano na explosão", hits.some((d) => d.target === "Perto" && d.amount === 900));
check("explosão enorme: alcança ~18 blocos", hits.some((d) => d.target === "Longe18"));
check("mas não é infinita", !hits.some((d) => d.target === "BemLonge"));
for (const d of [perto, longe, bemLonge]) d.kill();

scenario("Fim da Resurrección do Ulquiorra");
mark = errors.length;
ulquiorra.setDynamicProperty(DP.awakening, 2);
advanceTicks(90, "drenar-murcielago");
noNewErrors("reversão sem erro", mark);
check("vida maxima volta pra 1600", virtualMax(ulquiorra) === 1600, `${virtualMax(ulquiorra)}`);
check(
  "itens base restaurados",
  inv(ulquiorra).getItem(0)?.typeId === "ulquiorra:m1_zanpakuto",
  String(inv(ulquiorra).getItem(0)?.typeId)
);

/* ================= Coyote Starkk ================= */

scenario("Coyote Starkk: ativação");
const starkk = createPlayer("StarkkPlayer", { x: -600, y: 64, z: -600 });
emit("playerSpawn", { player: starkk, initialSpawn: true });
advanceTicks(20, "spawn-starkk");

mark = errors.length;
await pickCharacter(starkk, "starkk");
advanceTicks(20, "ativar-starkk");
noNewErrors("ativar Starkk sem erro", mark);
check("vida maxima 4000", virtualMax(starkk) === 4000, `${virtualMax(starkk)}`);
check(
  "pool real no teto do Bedrock",
  hp(starkk).effectiveMax === 1044,
  `${hp(starkk).effectiveMax}`
);
check(
  "5 itens base nos slots 0-4",
  JSON.stringify(slotIds(starkk, 5)) ===
    JSON.stringify([
      "starkk:m1_zanpakuto",
      "starkk:slash_barrage",
      "starkk:sideway_cuts",
      "starkk:crescent_canines",
      "starkk:kamarada",
    ]),
  JSON.stringify(slotIds(starkk, 5))
);

scenario("Slash's Barrage: 5 cortes");
mark = errors.length;
starkk.teleport({ x: -600, y: 64, z: -600 });
starkk._view = { x: 1, y: 0, z: 0 };
const barragem = [];
for (let i = 0; i < 5; i++) {
  barragem.push(createDummy(`Barra${i}`, { x: -598.5 + i * 3, y: 64, z: -600 }, 500000));
}
dmgBefore = log.damages.length;
useItem(starkk, "starkk:slash_barrage");
advanceTicks(80, "slash-barrage");
noNewErrors("Slash's Barrage executa limpo", mark);
const barragemHits = log.damages.slice(dmgBefore).filter((d) => d.amount === 100);
check(
  "os 5 avanços acertam, 100 cada",
  barragem.every((d) => barragemHits.filter((h) => h.target === d.name).length === 1),
  JSON.stringify(barragemHits.map((d) => d.target))
);
check(
  "percorre os 15 blocos",
  starkk.location.x >= -600 + 14.9,
  `andou ${(starkk.location.x + 600).toFixed(1)}`
);
for (const d of barragem) d.kill();

scenario("Sideway Cuts: os dois lados do alvo");
mark = errors.length;
starkk.teleport({ x: -600, y: 64, z: -600 });
const alvoLado = createPlayer("AlvoLado", { x: -594, y: 64, z: -600 }, 500000);
dmgBefore = log.damages.length;
useItem(starkk, "starkk:sideway_cuts");
advanceTicks(20, "sideway-cuts");
noNewErrors("Sideway Cuts executa limpo", mark);
const ladoHits = log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoLado");
check(
  "dois cortes de 200 no alvo",
  ladoHits.length === 2 && ladoHits.every((d) => d.amount === 200),
  JSON.stringify(ladoHits.map((d) => d.amount))
);
const ladoDist = Math.hypot(
  starkk.location.x - alvoLado.location.x,
  starkk.location.z - alvoLado.location.z
);
check("termina colado no alvo", ladoDist <= 2.5, `dist=${ladoDist.toFixed(2)}`);

starkk.setDynamicProperty("mv:cd_starkk_sideway_cuts", undefined);
alvoLado.teleport({ x: 3000, y: 64, z: 3000 });
starkk.teleport({ x: -600, y: 64, z: -600 });
useItem(starkk, "starkk:sideway_cuts");
advanceTicks(10, "sideway-sem-alvo");
check(
  "sem player por perto não gasta cooldown",
  starkk.getDynamicProperty("mv:cd_starkk_sideway_cuts") === undefined &&
    starkk.location.x === -600
);

scenario("Crescent Canines: trajetória + explosão");
mark = errors.length;
starkk.teleport({ x: -600, y: 64, z: -600 });
starkk._view = { x: 1, y: 0, z: 0 };

// o canino do lado +18° cresce por 80 ticks andando 1.1/tick
const caninoAng = (18 * Math.PI) / 180;
const caninoTravel = 1.1 * 80;
const noCaminho = createDummy(
  "NoCaminho",
  { x: -600 + Math.cos(caninoAng) * 8, y: 64, z: -600 + Math.sin(caninoAng) * 8 },
  500000
);
const noEstouro = createDummy(
  "NoEstouro",
  {
    x: -600 + Math.cos(caninoAng) * caninoTravel,
    y: 64,
    z: -600 + Math.sin(caninoAng) * caninoTravel,
  },
  500000
);
dmgBefore = log.damages.length;
useItem(starkk, "starkk:crescent_canines");
advanceTicks(100, "crescent-canines");
noNewErrors("Crescent Canines executa limpo", mark);
hits = log.damages.slice(dmgBefore);
check(
  "150 em quem está na trajetória",
  hits.some((d) => d.target === "NoCaminho" && d.amount === 150)
);
check(
  "300 no estouro do fim",
  hits.some((d) => d.target === "NoEstouro" && d.amount === 300)
);
noCaminho.kill();
noEstouro.kill();

scenario("Kamarada: 5 lobos guiados");
mark = errors.length;
starkk.teleport({ x: -600, y: 64, z: -600 });
starkk._view = { x: 1, y: 0, z: 0 };
const presaLobo = createDummy("PresaLobo", { x: -592, y: 64, z: -600 }, 500000);
dmgBefore = log.damages.length;
useItem(starkk, "starkk:kamarada");
advanceTicks(60, "kamarada");
noNewErrors("Kamarada executa limpo", mark);
const loboHits = log.damages.slice(dmgBefore).filter((d) => d.target === "PresaLobo");
check(
  "os lobos alcançam o alvo e explodem (200 cada)",
  loboHits.length >= 1 && loboHits.every((d) => d.amount === 200),
  `${loboHits.length} explosões: ${JSON.stringify(loboHits.map((d) => d.amount))}`
);
presaLobo.kill();

mark = errors.length;
starkk.setDynamicProperty("mv:cd_starkk_kamarada", undefined);
dmgBefore = log.damages.length;
useItem(starkk, "starkk:kamarada");
advanceTicks(140, "kamarada-sem-alvo");
noNewErrors("lobos sem alvo se dissipam sem lançar", mark);
check("sem ninguém por perto, os lobos somem sem dano", log.damages.length === dmgBefore);

scenario("Resurrección: Los Lobos");
mark = errors.length;
starkk.teleport({ x: -600, y: 64, z: -600 });
starkk.setDynamicProperty(DP.awakening, 100);
const msgsBeforeLobos = log.worldMessages.length;
starkk.isSneaking = true;
useItem(starkk, "starkk:m1_zanpakuto");
starkk.isSneaking = false;
advanceTicks(20, "los-lobos");
noNewErrors("Resurrección sem erro", mark);
check(
  'grita "Kick About, Los Lobos" no chat',
  log.worldMessages
    .slice(msgsBeforeLobos)
    .some((m) => m.message === "<StarkkPlayer> Kick About, Los Lobos")
);
check("awakened = true", starkk.getDynamicProperty(DP.awakened) === true);
check("vida continua 4000 (a Resurrección não aumenta)", virtualMax(starkk) === 4000, `${virtualMax(starkk)}`);
check(
  "m1 vira os Cuchillos, as 4 skills continuam",
  JSON.stringify(slotIds(starkk, 5)) ===
    JSON.stringify([
      "starkk:m1_cuchillos",
      "starkk:slash_barrage",
      "starkk:sideway_cuts",
      "starkk:crescent_canines",
      "starkk:kamarada",
    ]),
  JSON.stringify(slotIds(starkk, 5))
);

scenario("Troca de persona: Starkk ↔ Lilynette");
mark = errors.length;
check("começa como Starkk", starkk.getDynamicProperty("mv:starkk_form") === "starkk");

starkk.isSneaking = true;
useItem(starkk, "starkk:m1_cuchillos");
starkk.isSneaking = false;
advanceTicks(20, "vira-lilynette");
noNewErrors("trocar de persona sem erro", mark);
check("virou Lilynette", starkk.getDynamicProperty("mv:starkk_form") === "lilynette");
check(
  "itens da Lilynette travados nos slots 0-3",
  JSON.stringify(slotIds(starkk, 4)) ===
    JSON.stringify([
      "starkk:lilynette_shot",
      "starkk:rifle",
      "starkk:escopeta",
      "starkk:cero_metralleta",
    ]),
  JSON.stringify(slotIds(starkk, 4))
);

starkk.isSneaking = true;
useItem(starkk, "starkk:lilynette_shot");
starkk.isSneaking = false;
advanceTicks(20, "volta-starkk");
check("volta pro Starkk", starkk.getDynamicProperty("mv:starkk_form") === "starkk");
check("e os Cuchillos voltam", inv(starkk).getItem(0)?.typeId === "starkk:m1_cuchillos");

// volta pra Lilynette pra testar as skills dela
starkk.isSneaking = true;
useItem(starkk, "starkk:m1_cuchillos");
starkk.isSneaking = false;
advanceTicks(20, "lilynette-de-novo");

scenario("Disparo da Lilynette");
mark = errors.length;
starkk.teleport({ x: -600, y: 64, z: -600 });
starkk._view = { x: 1, y: 0, z: 0 };
const alvoTiro = createDummy("AlvoTiro", { x: -585, y: 64, z: -600 }, 500000);
dmgBefore = log.damages.length;
const msgsBeforeShot = log.worldMessages.length;
useItem(starkk, "starkk:lilynette_shot");
advanceTicks(60, "lilynette-shot");
noNewErrors("Disparo executa limpo", mark);
check(
  "120 de dano",
  log.damages.slice(dmgBefore).some((d) => d.target === "AlvoTiro" && d.amount === 120)
);
check(
  "não manda mensagem no chat (senão spamaria)",
  !log.worldMessages.slice(msgsBeforeShot).some((m) => m.to === "*" && m.message.includes("Disparo"))
);

scenario("Rifle: mira no alvo, não na visão do player");
mark = errors.length;
starkk.teleport({ x: -600, y: 64, z: -600 });
starkk._view = { x: 0, y: 0, z: 1 }; // olhando pro +z, de costas pro alvo
alvoTiro.teleport({ x: -588, y: 64, z: -600 }); // alvo no +x
dmgBefore = log.damages.length;
useItem(starkk, "starkk:rifle");
advanceTicks(60, "rifle");
noNewErrors("Rifle executa limpo", mark);
const rifleHits = log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoTiro");
check(
  "3 tiros de 120 acertam mesmo com o player olhando pro outro lado",
  rifleHits.length === 3 && rifleHits.every((d) => d.amount === 120),
  JSON.stringify(rifleHits.map((d) => d.amount))
);

scenario("Escopeta: curto alcance, dobro do dano");
mark = errors.length;
starkk.teleport({ x: -600, y: 64, z: -600 });
starkk._view = { x: 1, y: 0, z: 0 };
alvoTiro.teleport({ x: -592, y: 64, z: -600 }); // 8 blocos: dentro do alcance 12
dmgBefore = log.damages.length;
useItem(starkk, "starkk:escopeta");
advanceTicks(30, "escopeta");
noNewErrors("Escopeta executa limpo", mark);
check(
  "240 de dano (dobro do disparo)",
  log.damages.slice(dmgBefore).some((d) => d.target === "AlvoTiro" && d.amount === 240)
);

starkk.setDynamicProperty("mv:cd_starkk_escopeta", undefined);
alvoTiro.teleport({ x: -580, y: 64, z: -600 }); // 20 blocos: fora do alcance
dmgBefore = log.damages.length;
useItem(starkk, "starkk:escopeta");
advanceTicks(30, "escopeta-longe");
check(
  "não alcança 20 blocos",
  !log.damages.slice(dmgBefore).some((d) => d.target === "AlvoTiro")
);

scenario("Cero Metralleta: chuveiro por 15s");
mark = errors.length;
starkk.teleport({ x: -600, y: 64, z: -600 });
starkk._view = { x: 1, y: 0, z: 0 };
alvoTiro.teleport({ x: -590, y: 64, z: -600 }); // 10 à frente, dentro da caixa
const foraDaCaixa = createDummy("ForaDaCaixa", { x: -590, y: 64, z: -594 }, 500000); // 6 de lado
dmgBefore = log.damages.length;
const partBeforeVolley = log.particles.length;
useItem(starkk, "starkk:cero_metralleta");
advanceTicks(18, "metralleta-primeira-fileira");
noNewErrors("Cero Metralleta executa limpo", mark);

// a primeira fileira sai inteira de uma vez: varias balas, nao uma seguida da outra
const primeiraFileira = log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoTiro");
check(
  "a fileira inteira acerta de uma vez (balas de 60)",
  primeiraFileira.length >= 2 && primeiraFileira.every((d) => d.amount === 60),
  `${primeiraFileira.length} balas de ${JSON.stringify([...new Set(primeiraFileira.map((d) => d.amount))])}`
);
check(
  "só uma fileira saiu até aqui",
  primeiraFileira.length <= CERO_METRALLETA_BULLETS,
  `${primeiraFileira.length} acertos`
);
check(
  "quem está fora da largura da fileira não leva",
  !log.damages.slice(dmgBefore).some((d) => d.target === "ForaDaCaixa")
);

// a proxima fileira so vem depois da pausa
dmgBefore = log.damages.length;
advanceTicks(30, "metralleta-segunda-fileira");
check(
  "vem outra fileira depois da pausa",
  log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoTiro").length >= 2
);

mark = errors.length;
advanceTicks(320, "metralleta-fim");
noNewErrors("Cero Metralleta roda os 15s sem erro", mark);
check(
  "para sozinha no fim",
  log.worldMessages.some((m) => m.to === "StarkkPlayer" && m.message.includes("Cero Metralleta parou"))
);
dmgBefore = log.damages.length;
advanceTicks(40, "metralleta-parou");
check("e não dispara mais depois", !log.damages.slice(dmgBefore).some((d) => d.target === "AlvoTiro"));
foraDaCaixa.kill();

scenario("Fim da Resurrección do Starkk");
mark = errors.length;
starkk.setDynamicProperty(DP.awakening, 2);
advanceTicks(90, "drenar-los-lobos");
noNewErrors("reversão sem erro", mark);
check("awakened = false", starkk.getDynamicProperty(DP.awakened) === false);
check("persona volta pro Starkk", starkk.getDynamicProperty("mv:starkk_form") === "starkk");
check("vida continua 4000", virtualMax(starkk) === 4000, `${virtualMax(starkk)}`);
check(
  "itens base restaurados",
  JSON.stringify(slotIds(starkk, 5)) ===
    JSON.stringify([
      "starkk:m1_zanpakuto",
      "starkk:slash_barrage",
      "starkk:sideway_cuts",
      "starkk:crescent_canines",
      "starkk:kamarada",
    ]),
  JSON.stringify(slotIds(starkk, 5))
);
alvoTiro.kill();

/* ================= Yammy Riyalgo ================= */

scenario("Yammy Riyalgo: ativação");
const yammy = createPlayer("YammyPlayer", { x: 1500, y: 64, z: 1500 });
const sacoDePancada = createDummy("SacoDePancada", { x: 1503, y: 64, z: 1500 }, 500000);
emit("playerSpawn", { player: yammy, initialSpawn: true });
advanceTicks(20, "spawn-yammy");

mark = errors.length;
await pickCharacter(yammy, "yammy");
advanceTicks(20, "ativar-yammy");
noNewErrors("ativar Yammy sem erro", mark);
check("vida maxima 1000", virtualMax(yammy) === 1000, `${virtualMax(yammy)}`);
check(
  "5 itens base nos slots 0-4",
  JSON.stringify(slotIds(yammy, 5)) ===
    JSON.stringify([
      "yammy:m1_punches",
      "yammy:punches_barrage",
      "yammy:face_hold",
      "yammy:wraths_smash",
      "yammy:wraths_punch",
    ]),
  JSON.stringify(slotIds(yammy, 5))
);

dmgBefore = log.damages.length;
hitWith(yammy, sacoDePancada, "yammy:m1_punches");
check(
  "m1 dá 20 de dano",
  log.damages.slice(dmgBefore).some((d) => d.target === "SacoDePancada" && d.amount === 20)
);

scenario("Punches Barrage");
mark = errors.length;
yammy.teleport({ x: 1500, y: 64, z: 1500 });
yammy._view = { x: 1, y: 0, z: 0 };
sacoDePancada.teleport({ x: 1502, y: 64, z: 1500 });
dmgBefore = log.damages.length;
useItem(yammy, "yammy:punches_barrage");
advanceTicks(50, "punches-barrage");
noNewErrors("Punches Barrage executa limpo", mark);
const socos = log.damages.slice(dmgBefore).filter((d) => d.target === "SacoDePancada");
check(
  "5 socos de 80 em quem fica na frente",
  socos.length === 5 && socos.every((d) => d.amount === 80),
  JSON.stringify(socos.map((d) => d.amount))
);

scenario("Face Hold: segura pelo rosto e arremessa");
mark = errors.length;
yammy.teleport({ x: 1500, y: 64, z: 1500 });
yammy._view = { x: 1, y: 0, z: 0 };
sacoDePancada.teleport({ x: 1504, y: 64, z: 1500 });
const kbBefore = log.knockbacks.length;
useItem(yammy, "yammy:face_hold");
advanceTicks(20, "face-hold-segurando");
noNewErrors("Face Hold executa limpo", mark);
const faceDist = Math.hypot(
  sacoDePancada.location.x - yammy.location.x,
  sacoDePancada.location.z - yammy.location.z
);
check("segura a vítima na frente do Yammy", faceDist <= 2.6, `dist=${faceDist.toFixed(2)}`);
check("vítima não consegue se mexer", sacoDePancada.getEffect("slowness")?.amplifier === 255);
check("ainda não arremessou", log.knockbacks.length === kbBefore);

advanceTicks(50, "face-hold-arremesso");
const arremesso = log.knockbacks.slice(kbBefore).find((k) => k.target === "SacoDePancada");
check("arremessa depois dos 3 segundos", !!arremesso);
check(
  "arremessa na direção em que o Yammy olha",
  arremesso && arremesso.horizontal.x > 4 && Math.abs(arremesso.horizontal.z) < 0.01,
  JSON.stringify(arremesso?.horizontal)
);
check("solta a vítima", !sacoDePancada.getEffect("slowness"));

scenario("Wrath's Smash: pula e esmaga");
mark = errors.length;
yammy.teleport({ x: 1500, y: 64, z: 1500 });
sacoDePancada.teleport({ x: 1502, y: 64, z: 1500 });
const naBorda = createDummy("NaBorda", { x: 1511, y: 64, z: 1500 }, 500000); // 11 do centro
const foraDoSmash = createDummy("ForaDoSmash", { x: 1520, y: 64, z: 1500 }, 500000);
const kbBeforeSmash = log.knockbacks.length;
dmgBefore = log.damages.length;
useItem(yammy, "yammy:wraths_smash");
advanceTicks(60, "wraths-smash");
noNewErrors("Wrath's Smash executa limpo", mark);
check(
  "o player é lançado pra cima",
  log.knockbacks.slice(kbBeforeSmash).some((k) => k.target === "YammyPlayer" && k.verticalStrength > 1)
);
hits = log.damages.slice(dmgBefore);
check(
  "quem está no centro come as ondas (60 cada)",
  hits.filter((d) => d.target === "SacoDePancada" && d.amount === 60).length >= 3,
  `${hits.filter((d) => d.target === "SacoDePancada").length} ondas`
);
check(
  "as ondas crescem: a borda só é pega pelas últimas",
  hits.filter((d) => d.target === "NaBorda").length >= 1 &&
    hits.filter((d) => d.target === "NaBorda").length <
      hits.filter((d) => d.target === "SacoDePancada").length
);
check("fora do alcance máximo não leva", !hits.some((d) => d.target === "ForaDoSmash"));
naBorda.kill();
foraDoSmash.kill();

scenario("Wrath's Punch");
mark = errors.length;
yammy.teleport({ x: 1500, y: 64, z: 1500 });
yammy._view = { x: 1, y: 0, z: 0 };
sacoDePancada.teleport({ x: 1503, y: 64, z: 1500 });
dmgBefore = log.damages.length;
const kbBeforePunch = log.knockbacks.length;
useItem(yammy, "yammy:wraths_punch");
advanceTicks(10, "wraths-punch");
noNewErrors("Wrath's Punch executa limpo", mark);
check(
  "200 de dano",
  log.damages.slice(dmgBefore).some((d) => d.target === "SacoDePancada" && d.amount === 200)
);
check(
  "knockback alto na direção do soco",
  log.knockbacks.slice(kbBeforePunch).some(
    (k) => k.target === "SacoDePancada" && k.horizontal.x > 6
  )
);

scenario("Resurrección: Ira");
mark = errors.length;
yammy.teleport({ x: 1500, y: 64, z: 1500 });
yammy.setDynamicProperty(DP.awakening, 100);
const msgsBeforeIra = log.worldMessages.length;
yammy.isSneaking = true;
useItem(yammy, "yammy:m1_punches");
yammy.isSneaking = false;
advanceTicks(20, "ira");
noNewErrors("Resurrección sem erro", mark);
check(
  "manda a fala no chat",
  log.worldMessages
    .slice(msgsBeforeIra)
    .some((m) => m.message === "<YammyPlayer> Os Espadas são numerados de 0-9, não de 1-10!")
);
check("vida maxima 10000", virtualMax(yammy) === 10000, `${virtualMax(yammy)}`);
check("speed 1 (amplifier 0)", yammy.getEffect("speed")?.amplifier === 0, `${yammy.getEffect("speed")?.amplifier}`);
check("lentidão 1 (amplifier 0)", yammy.getEffect("slowness")?.amplifier === 0, `${yammy.getEffect("slowness")?.amplifier}`);
check("fadiga 2 (amplifier 1)", yammy.getEffect("mining_fatigue")?.amplifier === 1, `${yammy.getEffect("mining_fatigue")?.amplifier}`);
check("sem regeneração passiva (a cura é em bloco)", !yammy.getEffect("regeneration"));
check(
  "marcador invisível travado na offhand (é ele que escala o modelo)",
  yammy.getComponent("minecraft:equippable").getEquipment("Offhand")?.typeId === "yammy:ira_marker",
  String(yammy.getComponent("minecraft:equippable").getEquipment("Offhand")?.typeId)
);
check(
  "4 itens da Ira",
  JSON.stringify(slotIds(yammy, 4)) ===
    JSON.stringify([
      "yammy:m1_ira",
      "yammy:quebramundos",
      "yammy:cero_barrage",
      "yammy:rugido_diablo",
    ]),
  JSON.stringify(slotIds(yammy, 4))
);

yammy.getComponent("minecraft:equippable").setEquipment("Offhand", undefined);
advanceTicks(15, "marcador-removido");
check(
  "o loop devolve o marcador se alguém tirar",
  yammy.getComponent("minecraft:equippable").getEquipment("Offhand")?.typeId === "yammy:ira_marker"
);

dmgBefore = log.damages.length;
hitWith(yammy, sacoDePancada, "yammy:m1_ira");
check(
  "Punhos de la Ira dão 300 por hit",
  log.damages.slice(dmgBefore).some((d) => d.target === "SacoDePancada" && d.amount === 300)
);

scenario("Ira: cura 100 a cada 4 segundos");
mark = errors.length;
hp(yammy).setCurrentValue(hp(yammy).effectiveMax * 0.3);
const vidaAntes = virtualHp(yammy);
advanceTicks(400, "cura-em-bloco"); // 20s = 5 intervalos de 4s
noNewErrors("cura em bloco sem erro", mark);
const ganho = virtualHp(yammy) - vidaAntes;
check(
  "cura ~100 de vida virtual a cada 4s (5 blocos em 20s)",
  ganho >= 400 && ganho <= 600,
  `curou ${ganho.toFixed(1)} em 20s`
);

// e em BLOCOS, nao aos pouquinhos: num segundo cura 0 ou 100, nunca no meio
const vidaMeio = virtualHp(yammy);
advanceTicks(20, "um-segundo");
const passo = virtualHp(yammy) - vidaMeio;
check(
  "a cura vem em bloco, não pingando",
  Math.abs(passo) < 1 || Math.abs(passo - 100) < 1,
  `mudou ${passo.toFixed(1)} em 1s`
);

scenario("Ira: visão lá de cima");
mark = errors.length;
const camBefore = log.cameras.length;
yammy.isSneaking = true;
useItem(yammy, "yammy:m1_ira");
yammy.isSneaking = false;
advanceTicks(10, "camera-alta");
noNewErrors("alternar a câmera sem erro", mark);
check("marca a visão alta", yammy.getDynamicProperty("mv:tall_view") === true);
const camSet = log.cameras.slice(camBefore).filter((c) => c.preset === "minecraft:free");
check("põe a câmera no modo livre", camSet.length >= 1);
check(
  "a câmera fica bem acima do player",
  camSet.length > 0 && camSet[camSet.length - 1].options.location.y - yammy.location.y >= 8,
  camSet.length ? `${(camSet[camSet.length - 1].options.location.y - yammy.location.y).toFixed(1)} acima` : "n/a"
);

yammy.isSneaking = true;
useItem(yammy, "yammy:m1_ira");
yammy.isSneaking = false;
advanceTicks(10, "camera-normal");
check("volta pra visão normal", !yammy.getDynamicProperty("mv:tall_view"));
check(
  "e limpa a câmera",
  log.cameras.slice(-3).some((c) => c.player === "YammyPlayer" && c.preset === undefined)
);

scenario("Quebramundos");
mark = errors.length;
yammy.teleport({ x: 1500, y: 64, z: 1500 });
sacoDePancada.teleport({ x: 1502, y: 64, z: 1500 });
const aVinteEQuatro = createDummy("AVinteEQuatro", { x: 1524, y: 64, z: 1500 }, 500000);
const aTrinta = createDummy("ATrinta", { x: 1530, y: 64, z: 1500 }, 500000);
dmgBefore = log.damages.length;
useItem(yammy, "yammy:quebramundos");
advanceTicks(10, "quebramundos");
noNewErrors("Quebramundos executa limpo", mark);
hits = log.damages.slice(dmgBefore);
check("1000 de dano", hits.some((d) => d.target === "SacoDePancada" && d.amount === 1000));
check(
  "alcança 24 blocos, mais que a Lanza del Relámpago (18)",
  hits.some((d) => d.target === "AVinteEQuatro")
);
check("mas não 30", !hits.some((d) => d.target === "ATrinta"));
aVinteEQuatro.kill();
aTrinta.kill();

scenario("Gran Rey Cero Barrage");
mark = errors.length;
yammy.teleport({ x: 1500, y: 64, z: 1500 });
yammy._view = { x: 1, y: 0, z: 0 };
sacoDePancada.teleport({ x: 1510, y: 64, z: 1500 });
dmgBefore = log.damages.length;
useItem(yammy, "yammy:cero_barrage");
advanceTicks(140, "cero-barrage");
noNewErrors("Barragem executa limpo", mark);
const ceros = log.damages.slice(dmgBefore).filter((d) => d.target === "SacoDePancada");
check(
  "10 Gran Rey Ceros de 350",
  ceros.length === 10 && ceros.every((d) => d.amount === 350),
  `${ceros.length} ceros: ${JSON.stringify([...new Set(ceros.map((d) => d.amount))])}`
);

scenario("Rugido del Diablo");
mark = errors.length;
yammy.teleport({ x: 1500, y: 64, z: 1500 });
sacoDePancada.teleport({ x: 1505, y: 64, z: 1500 });
const foraDoRugido = createDummy("ForaDoRugido", { x: 1520, y: 64, z: 1500 }, 500000);
dmgBefore = log.damages.length;
useItem(yammy, "yammy:rugido_diablo");
advanceTicks(70, "rugido");
noNewErrors("Rugido executa limpo", mark);
const diabloHits = log.damages.slice(dmgBefore).filter((d) => d.target === "SacoDePancada");
check(
  "50 de dano por tick durante 3 segundos (60 ticks)",
  diabloHits.length === 60 && diabloHits.every((d) => d.amount === 50),
  `${diabloHits.length} ticks de ${JSON.stringify([...new Set(diabloHits.map((d) => d.amount))])}`
);
check("fora do raio não leva", !log.damages.slice(dmgBefore).some((d) => d.target === "ForaDoRugido"));

dmgBefore = log.damages.length;
advanceTicks(40, "rugido-acabou");
check("para sozinho", !log.damages.slice(dmgBefore).some((d) => d.target === "SacoDePancada"));
foraDoRugido.kill();

scenario("Fim da Ira");
mark = errors.length;
yammy.setDynamicProperty(DP.awakening, 2);
advanceTicks(90, "drenar-ira");
noNewErrors("reversão sem erro", mark);
check("awakened = false", yammy.getDynamicProperty(DP.awakened) === false);
check("vida maxima volta pra 1000", virtualMax(yammy) === 1000, `${virtualMax(yammy)}`);
check("lentidão da forma some", !yammy.getEffect("slowness"));
check("fadiga da forma some", !yammy.getEffect("mining_fatigue"));
check("regeneração passiva volta", yammy.getEffect("regeneration")?.amplifier === 1);
check("visão alta desligada", !yammy.getDynamicProperty("mv:tall_view"));
check(
  "marcador sai da offhand (volta ao tamanho normal)",
  !yammy.getComponent("minecraft:equippable").getEquipment("Offhand")
);
check(
  "itens base restaurados",
  inv(yammy).getItem(0)?.typeId === "yammy:m1_punches",
  String(inv(yammy).getItem(0)?.typeId)
);
sacoDePancada.kill();

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

const droppedMarker = overworld.spawnEntity("minecraft:item", { x: 0, y: 64, z: 0 });
droppedMarker.itemStackComponent = { itemStack: new ItemStack("yammy:ira_marker", 1) };
emit("entitySpawn", { entity: droppedMarker });
check("marcador da Ira largado é removido", !droppedMarker.isValid);

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
check("vida do personagem reaplicada", virtualMax(ichigo) === 200 && hp(ichigo).currentValue === 200);

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
queueFormResponse(deactivateButtonIndex(ichigo)); // botao "Desativar personagem"
useItem(ichigo, "multiversal:character_selector");
await Promise.resolve();
await Promise.resolve();
advanceTicks(20, "desativar");
noNewErrors("desativar sem erro", mark);
check("personagem limpo", ichigo.getDynamicProperty(DP.character) === undefined);
check("vida normalizada em 20", virtualMax(ichigo) === 20 && hp(ichigo).currentValue === 20, `${hp(ichigo).currentValue}/${virtualMax(ichigo)}`);
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
await pickCharacter(ichigo, "ichigo");
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
