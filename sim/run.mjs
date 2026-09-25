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
import fs from "node:fs";

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

// O seletor e raca -> tier -> personagem. O main.js exporta o registro e os
// numeros de balanceamento (ver o fim do arquivo), entao a simulacao le tudo de
// la em vez de espelhar na mao e divergir do jogo em silencio.
let game;
let RACES;
let TIERS;
let RACE_TIER;

const CERO_METRALLETA_BULLETS = 6; // balas por fileira (espelho do main.js)
const CERO_METRALLETA_ROWS = 4; // fileiras por disparo (espelho do main.js)

// personagens de uma raca+tier, na ordem em que o menu mostra os botoes
function rosterOf(raceId, tierId) {
  return Object.entries(RACE_TIER)
    .filter(([, data]) => data.race === raceId && data.tier === tierId)
    .map(([id]) => id);
}

function locate(id) {
  const entry = RACE_TIER[id];
  if (!entry) throw new Error(`personagem fora do seletor: ${id}`);
  const raceIndex = RACES.findIndex((r) => r.id === entry.race);
  const tierIndex = TIERS.findIndex((t) => t.id === entry.tier);
  const buttonIndex = rosterOf(entry.race, entry.tier).indexOf(id);
  if (raceIndex === -1 || tierIndex === -1 || buttonIndex === -1) {
    throw new Error(`raca/tier invalidos para ${id}: ${JSON.stringify(entry)}`);
  }
  return { raceIndex, tierIndex, buttonIndex };
}

// microtarefas pra cadeia form.show().then(...) de dois menus terminar
async function settleForms() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

// gira a raca (agachar + seletor) e responde o menu de tiers e o de personagens
async function pickCharacter(player, id) {
  const { raceIndex, tierIndex, buttonIndex } = locate(id);
  const current = player.getDynamicProperty("mv:race") ?? 0;
  const steps = (raceIndex - current + RACES.length) % RACES.length;

  player.isSneaking = true;
  for (let i = 0; i < steps; i++) useItem(player, "multiversal:character_selector");
  player.isSneaking = false;

  queueFormResponse(tierIndex);
  queueFormResponse(buttonIndex);
  useItem(player, "multiversal:character_selector");
  await settleForms();
}

// com personagem ativo, o menu de tiers ganha "Desativar" depois dos tiers
function deactivateButtonIndex() {
  return TIERS.length;
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

// O log guarda o dano REAL. Acima do teto de vida do Bedrock ele foi dividido
// pela escala do alvo, entao pra ler o numero configurado ("500 de dano") tem
// que multiplicar de volta.
function virtualDamage(target, entry) {
  const scale = target.getDynamicProperty("mv:health_scale") ?? 1;
  return Math.round(entry.amount * scale);
}

// acima do teto do Bedrock a vida e virtual: setar o numero cru na componente
// nao e a mesma coisa que setar a vida que o player ve
function setVirtualHp(p, value) {
  const scale = p.getDynamicProperty("mv:health_scale") ?? 1;
  hp(p).setCurrentValue(value / scale);
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
game = await import("../BP/scripts/main.js");
({ RACES, TIERS, CHARACTER_RACE_TIER: RACE_TIER } = game);
noNewErrors("main.js importa sem lancar", bootMark);
check(
  "main.js exporta o registro e o balanceamento",
  !!game.CHARACTERS && !!game.DAMAGE && !!game.SKILL_COOLDOWN_TICKS && Array.isArray(RACES) && Array.isArray(TIERS)
);
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
  "primeiro menu lista os tiers, o segundo os personagens do tier",
  shownForms.length === 2 &&
    shownForms[0].buttons.length === TIERS.length &&
    shownForms[1].buttons.length === rosterOf(RACE_TIER.ichigo.race, RACE_TIER.ichigo.tier).length + 1,
  shownForms.map((f) => f.buttons.length).join(" / ")
);
check(
  "menu de tiers mostra a raça atual",
  (shownForms[0]?.body ?? "").includes(RACES[locate("ichigo").raceIndex].name),
  shownForms[0]?.body
);
check("personagem salvo", ichigo.getDynamicProperty(DP.character) === "ichigo");
const ICHIGO_HP = game.CHARACTERS.ichigo.health;
check(`vida maxima ${ICHIGO_HP}`, virtualMax(ichigo) === ICHIGO_HP, `${virtualMax(ichigo)}`);
check("vida cheia apos ativar", virtualHp(ichigo) === ICHIGO_HP, `${virtualHp(ichigo)}`);
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
const ICHIGO_M1 = game.MELEE_WEAPONS["ichigo:m1_zangetsu"].baseDamage;
check(
  `m1 aplica o dano base inteiro pelo script (${ICHIGO_M1}), não parcial pelo item`,
  log.damages.slice(-10).every((d) => d.target === "Dummy" && d.amount === ICHIGO_M1),
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
const TENSA_HP = game.CHARACTERS.ichigo.awakening.health;
check(`vida maxima ${TENSA_HP}`, virtualMax(ichigo) === TENSA_HP, `${virtualMax(ichigo)}`);
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
  !ichigo.getDynamicProperty(DP.maskEnd)
);
// agachar + m1 sem poder usar a máscara não pode virar tecla morta: vira guarda
check(
  "e a tecla vira bloqueio em vez de não fazer nada",
  ichigo.getDynamicProperty("mv:block_end") > 0,
  String(ichigo.getDynamicProperty("mv:block_end"))
);
ichigo.isSneaking = false;
useItem(ichigo, "ichigo:tensa_m1"); // baixa a guarda pra não atrapalhar o resto
ichigo.isSneaking = true;
ichigo.setDynamicProperty("mv:block_end", 0);
ichigo.setDynamicProperty("mv:cd_block", undefined);

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
check(`vida maxima de volta pra ${ICHIGO_HP}`, virtualMax(ichigo) === ICHIGO_HP, `${virtualMax(ichigo)}`);
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
for (const skill of ["byakuya:tripleshot", "byakuya:disperse", "byakuya:bloodshed"]) {
  mark = errors.length;
  byakuya.teleport({ x: 40, y: 64, z: 40 });
  dummy2.teleport({ x: 40, y: 64, z: 43 });
  const dmgBefore = log.damages.length;
  useItem(byakuya, skill);
  advanceTicks(60, skill);
  noNewErrors(`${skill} executa limpo`, mark);
  check(`${skill} causou dano`, log.damages.length > dmgBefore);
}

// Sakura's Distraction (substituiu o Coating): so pega player ou o Boneco de Teste
mark = errors.length;
const distraido = createPlayer("Distraido", { x: 40, y: 64, z: 46 }, 700);
emit("playerSpawn", { player: distraido, initialSpawn: true });
byakuya.teleport({ x: 40, y: 64, z: 40 });
dummy2.teleport({ x: 60, y: 64, z: 60 }); // tira o zumbi da mira
useItem(byakuya, "byakuya:sakura_distraction");
advanceTicks(20, "sakura-distraction");
noNewErrors("byakuya:sakura_distraction executa limpo", mark);
check("Sakura's Distraction cega o player mirado", !!distraido.getEffect("blindness"));
advanceTicks(200, "sakura-distraction-fim");
distraido.kill();
dummy2.teleport({ x: 40, y: 64, z: 43 });

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
const prey = createDummy("Presa", { x: -77, y: 64, z: -80 }, 500000);
const KENPACHI = game.CHARACTERS.kenpachi;
const KENPACHI_BUFF = KENPACHI.awakening.damageMultiplier;

mark = errors.length;
emit("playerSpawn", { player: kenpachi, initialSpawn: true });
emit("playerSpawn", { player: victim, initialSpawn: true });
advanceTicks(20, "spawn-kenpachi");
await pickCharacter(kenpachi, "kenpachi");
advanceTicks(20, "ativar-kenpachi");
noNewErrors("ativar Kenpachi sem erro", mark);
check("personagem salvo", kenpachi.getDynamicProperty(DP.character) === "kenpachi");
check(`vida maxima ${KENPACHI.health}`, virtualMax(kenpachi) === KENPACHI.health, `${virtualMax(kenpachi)}`);
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

scenario("Flash Slash: 3 avanços");
mark = errors.length;
kenpachi.teleport({ x: -80, y: 64, z: -80 });
prey.teleport({ x: -77, y: 64, z: -80 });
kenpachi._view = { x: 1, y: 0, z: 0 }; // olhando pro +x
// cada avanco cobre 6 blocos, entao um alvo em cada trecho testa os tres
const alvoA = createDummy("AlvoA", { x: -77, y: 64, z: -80 }, 50000);
const alvoB = createDummy("AlvoB", { x: -71, y: 64, z: -80 }, 50000);
const alvoC = createDummy("AlvoC", { x: -65, y: 64, z: -80 }, 50000);
let dmgBefore = log.damages.length;
useItem(kenpachi, "kenpachi:flash_slash");
advanceTicks(80, "flash-slash");
noNewErrors("Flash Slash executa limpo", mark);
const flashHits = log.damages.slice(dmgBefore).filter((d) => d.amount === game.DAMAGE.flashSlash);
check(
  `os 3 avanços acertam, ${game.DAMAGE.flashSlash} de dano cada`,
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

scenario("Stomp: dano em 6x6 (alcance dobrado)");
mark = errors.length;
kenpachi.teleport({ x: -80, y: 64, z: -80 });
prey.teleport({ x: -79, y: 64, z: -80 }); // 1 bloco: dentro
dmgBefore = log.damages.length;
const partBefore = log.particles.length;
useItem(kenpachi, "kenpachi:stomp");
advanceTicks(10, "stomp");
noNewErrors("Stomp executa limpo", mark);
check(
  `${game.DAMAGE.stomp} de dano em quem está na área`,
  log.damages.slice(dmgBefore).some((d) => d.target === "Presa" && d.amount === game.DAMAGE.stomp)
);
// desde a 1.23.1 o impacto e das particulas do proprio Kenpachi
const stompParticles = log.particles.slice(partBefore);
check(
  "solta as partículas de impacto do Kenpachi",
  stompParticles.length >= 3 &&
    stompParticles.some((p) => p.particleId === "kenpachi:spark") &&
    stompParticles.some((p) => p.particleId === "kenpachi:slash"),
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
  log.damages.slice(dmgBefore).some((d) => d.target === "Presa" && d.amount === game.DAMAGE.stomp)
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
  `${game.DAMAGE.hellsCut} de dano`,
  log.damages.slice(dmgBefore).some((d) => d.target === "Presa" && d.amount === game.DAMAGE.hellsCut)
);

const farPrey = createDummy("Longe", { x: -65, y: 64, z: -80 }, 50000); // 15 blocos
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
check(`vida máxima continua ${KENPACHI.health}`, virtualMax(kenpachi) === KENPACHI.health, `${virtualMax(kenpachi)}`);
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

scenario("Pressão: buff de dano da forma desperta");
mark = errors.length;
kenpachi.teleport({ x: -80, y: 64, z: -80 });
prey.teleport({ x: -79, y: 64, z: -80 });
kenpachi.setDynamicProperty("mv:cd_kenpachi_stomp", undefined);
dmgBefore = log.damages.length;
useItem(kenpachi, "kenpachi:stomp");
advanceTicks(10, "stomp-buffado");
check(
  `Stomp com o buff: ${game.DAMAGE.stomp} x${KENPACHI_BUFF}`,
  log.damages.slice(dmgBefore).some((d) => d.target === "Presa" && Math.abs(d.amount - game.DAMAGE.stomp * KENPACHI_BUFF) < 0.01),
  JSON.stringify(log.damages.slice(dmgBefore).map((d) => d.amount))
);

dmgBefore = log.damages.length;
hitWith(kenpachi, prey, "kenpachi:m1_zanpakuto");
check(
  `m1 com o buff: ${game.DAMAGE.kenpachiM1} x${KENPACHI_BUFF}, dano inteiro pelo script`,
  log.damages.slice(dmgBefore).some((d) => d.amount === game.DAMAGE.kenpachiM1 * KENPACHI_BUFF),
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
const HELLS_BUFFED = game.DAMAGE.hellsCut * KENPACHI_BUFF;
check(`com vida alta: dano normal (${HELLS_BUFFED})`, normalHit && Math.abs(normalHit.amount - HELLS_BUFFED) < 0.01, `${normalHit?.amount}`);

// 1700 de vida passa do teto do Bedrock: o limite de 60 e de vida VIRTUAL
setVirtualHp(kenpachi, 55); // abaixo do limite de 60
kenpachi.setDynamicProperty("mv:cd_kenpachi_hells_cut", undefined);
dmgBefore = log.damages.length;
useItem(kenpachi, "kenpachi:hells_cut");
advanceTicks(30, "hells-cut-desespero");
const desperateHit = log.damages.slice(dmgBefore).find((d) => d.target === "Presa");
const HELLS_DESPERATE = HELLS_BUFFED * KENPACHI.awakening.desperation.damageFactor;
check(
  `com vida ≤60: dano base triplica (${HELLS_DESPERATE})`,
  desperateHit && Math.abs(desperateHit.amount - HELLS_DESPERATE) < 0.01,
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
check(`vida máxima continua ${KENPACHI.health}`, virtualMax(kenpachi) === KENPACHI.health);
check("NÃO curou ao reverter", hp(kenpachi).currentValue <= 120, `${hp(kenpachi).currentValue}`);

kenpachi.teleport({ x: -80, y: 64, z: -80 });
prey.teleport({ x: -79, y: 64, z: -80 });
kenpachi.setDynamicProperty("mv:cd_kenpachi_stomp", undefined);
dmgBefore = log.damages.length;
useItem(kenpachi, "kenpachi:stomp");
advanceTicks(10, "stomp-sem-buff");
check(
  `sem awakening o dano volta pra ${game.DAMAGE.stomp}`,
  log.damages.slice(dmgBefore).some((d) => d.target === "Presa" && d.amount === game.DAMAGE.stomp),
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
const MAYURI = game.CHARACTERS.mayuri;
check(`vida maxima ${MAYURI.health}`, virtualMax(mayuri) === MAYURI.health, `${virtualMax(mayuri)}`);
check(
  "itens do registro nos slots 0-4",
  JSON.stringify(slotIds(mayuri, 5)) === JSON.stringify([0, 1, 2, 3, 4].map((i) => MAYURI.items[i])),
  JSON.stringify(slotIds(mayuri, 5))
);

// o veneno da Mayuri e um DoT proprio (nao o efeito vanilla): 1 golpe por segundo
function mayuriPoisonTicks(targetName, since, perSecond) {
  return log.damages
    .slice(since)
    .filter((d) => d.target === targetName && d.by === "MayuriPlayer" && d.amount === perSecond).length;
}

const ASHISOGI_COMBO = game.MELEE_WEAPONS["mayuri:m1_ashisogi_jizo"].combo;
scenario(`Ashisogi Jizō: lentidão a cada ${ASHISOGI_COMBO.everyHits} hits`);
mark = errors.length;
mayuri.teleport({ x: 200, y: 64, z: 200 });
cobaia.teleport({ x: 201, y: 64, z: 200 });
for (let i = 1; i < ASHISOGI_COMBO.everyHits; i++) {
  hitWith(mayuri, cobaia, "mayuri:m1_ashisogi_jizo");
  check(`${i}º hit: sem lentidão`, !cobaia.getEffect(ASHISOGI_COMBO.effect));
}
hitWith(mayuri, cobaia, "mayuri:m1_ashisogi_jizo");
check(`${ASHISOGI_COMBO.everyHits}º hit: aplica lentidão`, !!cobaia.getEffect(ASHISOGI_COMBO.effect));
check(
  `lentidão dura ${ASHISOGI_COMBO.durationTicks} ticks`,
  (cobaia.getEffect(ASHISOGI_COMBO.effect)?.endTick ?? 0) - system.currentTick === ASHISOGI_COMBO.durationTicks,
  `${(cobaia.getEffect(ASHISOGI_COMBO.effect)?.endTick ?? 0) - system.currentTick} ticks`
);

cobaia.removeEffect(ASHISOGI_COMBO.effect);
for (let i = 1; i < ASHISOGI_COMBO.everyHits; i++) hitWith(mayuri, cobaia, "mayuri:m1_ashisogi_jizo");
check("contador reiniciou (sem lentidão antes do próximo ciclo)", !cobaia.getEffect(ASHISOGI_COMBO.effect));
hitWith(mayuri, cobaia, "mayuri:m1_ashisogi_jizo");
check("fim do ciclo seguinte: aplica de novo", !!cobaia.getEffect(ASHISOGI_COMBO.effect));
noNewErrors("combo do m1 sem erro", mark);
cobaia.removeEffect(ASHISOGI_COMBO.effect);

scenario("Poison Slash: caixa de 4 pra frente x 3 de largura");
mark = errors.length;
mayuri.teleport({ x: 200, y: 64, z: 200 });
mayuri._view = { x: 1, y: 0, z: 0 }; // olhando pro +x
const naFrente = createDummy("NaFrente", { x: 203, y: 64, z: 200 }, 500000);
const longeDemais = createDummy("LongeDemais", { x: 206, y: 64, z: 200 }, 500000);
const deLado = createDummy("DeLado", { x: 202, y: 64, z: 203 }, 500000);
const atras = createDummy("Atras", { x: 198, y: 64, z: 200 }, 500000);
cobaia.teleport({ x: 500, y: 64, z: 500 });

dmgBefore = log.damages.length;
useItem(mayuri, "mayuri:poison_slash");
advanceTicks(10, "poison-slash");
noNewErrors("Poison Slash executa limpo", mark);
const slashHits = log.damages.slice(dmgBefore);
check(
  `${game.DAMAGE.poisonSlash} de dano em quem está na frente`,
  slashHits.some((d) => d.target === "NaFrente" && d.amount === game.DAMAGE.poisonSlash)
);
check("não pega a 6 blocos (limite é 4)", !slashHits.some((d) => d.target === "LongeDemais"));
check("não pega a 3 blocos de lado (largura é 3 total)", !slashHits.some((d) => d.target === "DeLado"));
check("não pega quem está atrás", !slashHits.some((d) => d.target === "Atras"));
dmgBefore = log.damages.length;
advanceTicks(60, "poison-slash-veneno");
check("envenena quem levou o corte (DoT da Mayuri)", mayuriPoisonTicks("NaFrente", dmgBefore, 10) >= 2);
for (const d of [longeDemais, deLado, atras]) d.kill();

const TOXIC = game.TOXIC_FOG;
scenario("Toxic Fog: 10x10, veneno + slowness 3 por 15s");
mark = errors.length;
mayuri.teleport({ x: 200, y: 64, z: 200 });
naFrente.teleport({ x: 203, y: 64, z: 200 }); // 3 blocos: dentro do raio 5
const foraDaNevoa = createDummy("ForaDaNevoa", { x: 208, y: 64, z: 200 }, 500000);
naFrente.removeEffect("slowness");

const partBeforeFog = log.particles.length;
dmgBefore = log.damages.length;
useItem(mayuri, "mayuri:toxic_fog");
advanceTicks(50, "fog-inicio");
noNewErrors("Toxic Fog executa limpo", mark);
check(
  `veneno de ${TOXIC.mayuriPoison.damagePerSecond}/s em quem está na neblina`,
  mayuriPoisonTicks("NaFrente", dmgBefore, TOXIC.mayuriPoison.damagePerSecond) >= 1
);
check(
  `slowness ${TOXIC.slownessAmplifier + 1} em quem está na neblina`,
  naFrente.getEffect("slowness")?.amplifier === TOXIC.slownessAmplifier
);
check("quem está fora do 10x10 não é afetado", mayuriPoisonTicks("ForaDaNevoa", dmgBefore, TOXIC.mayuriPoison.damagePerSecond) === 0);
check("Mayuri não se envenena", !log.damages.slice(dmgBefore).some((d) => d.target === "MayuriPlayer"));
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
advanceTicks(TOXIC.mayuriPoison.durationSeconds * 20 + 40, "fog-efeitos-expiram");
dmgBefore = log.damages.length;
advanceTicks(60, "fog-depois");
check("veneno para depois que a neblina acaba", mayuriPoisonTicks("NaFrente", dmgBefore, TOXIC.mayuriPoison.damagePerSecond) === 0);

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
naFrente.removeEffect("slowness");
const KONJIKI = MAYURI.superAttack.konjiki;

// sem o medidor cheio a Bankai não sai
mayuri.setDynamicProperty(DP.awakening, 40);
mayuri.isSneaking = true;
useItem(mayuri, "mayuri:m1_ashisogi_jizo");
advanceTicks(15, "bankai-sem-medidor");
check("sem 100% de medidor a Bankai não sai", naFrente.getEffect("slowness")?.amplifier !== KONJIKI.slownessAmplifier);
check("e o medidor não é consumido", mayuri.getDynamicProperty(DP.awakening) === 40);

mayuri.setDynamicProperty(DP.awakening, 100);
const partBeforeBankai = log.particles.length;
dmgBefore = log.damages.length;
useItem(mayuri, "mayuri:m1_ashisogi_jizo");
mayuri.isSneaking = false;
advanceTicks(50, "bankai");
noNewErrors("Konjiki executa limpo", mark);
check("consumiu o medidor", mayuri.getDynamicProperty(DP.awakening) === 0);
check(
  `veneno de ${KONJIKI.mayuriPoison.damagePerSecond}/s`,
  mayuriPoisonTicks("NaFrente", dmgBefore, KONJIKI.mayuriPoison.damagePerSecond) >= 1
);
check(
  "lentidão máxima (amplifier 255)",
  naFrente.getEffect("slowness")?.amplifier === 255,
  `${naFrente.getEffect("slowness")?.amplifier}`
);
check("alcança 18 blocos (área 50x50)", mayuriPoisonTicks("NaFrente", dmgBefore, KONJIKI.mayuriPoison.damagePerSecond) >= 1);
check("não alcança 40 blocos", mayuriPoisonTicks("ForaDaNevoa", dmgBefore, KONJIKI.mayuriPoison.damagePerSecond) === 0);
check("Mayuri não se envenena", !log.damages.slice(dmgBefore).some((d) => d.target === "MayuriPlayer"));
const bankaiParticles = log.particles
  .slice(partBeforeBankai)
  .filter((p) => p.particleId === "mayuri:poison_fog");
check(
  "neblina densa desenhada com a partícula customizada",
  bankaiParticles.length > 150,
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
advanceTicks(KONJIKI.mayuriPoison.durationSeconds * 20 + 40, "bankai-efeitos-expiram");
dmgBefore = log.damages.length;
advanceTicks(60, "bankai-depois");
check("veneno para quando a neblina acaba", mayuriPoisonTicks("NaFrente", dmgBefore, KONJIKI.mayuriPoison.damagePerSecond) === 0);
check("Mayuri não vira forma persistente", !mayuri.getDynamicProperty(DP.awakened));
check(`vida maxima continua ${MAYURI.health}`, virtualMax(mayuri) === MAYURI.health);
naFrente.kill();
foraDaNevoa.kill();

/* ================= raca -> tier -> personagem ================= */

scenario("Seletor por raça e tier");
const explorador = createPlayer("Explorador", { x: -300, y: 64, z: -300 }, 400);
emit("playerSpawn", { player: explorador, initialSpawn: true });
advanceTicks(20, "spawn-explorador");

mark = errors.length;
useItem(explorador, "multiversal:character_selector"); // sem resposta na fila = cancela
let shown = shownForms[shownForms.length - 1];
check("começa na primeira raça", shown.body.includes(RACES[0].name), shown.body);
check(
  `menu de tiers tem os ${TIERS.length} tiers`,
  shown.buttons.length === TIERS.length,
  `${shown.buttons.length} botões`
);

explorador.isSneaking = true;
useItem(explorador, "multiversal:character_selector");
explorador.isSneaking = false;
check("agachar + seletor avança pra próxima raça", explorador.getDynamicProperty("mv:race") === 1);
check(
  "avisa em qual raça entrou",
  log.worldMessages.some((m) => m.to === "Explorador" && m.message.includes(RACES[1].name))
);

explorador.isSneaking = true;
for (let i = 1; i < RACES.length; i++) useItem(explorador, "multiversal:character_selector");
explorador.isSneaking = false;
check("dá a volta depois da última raça", explorador.getDynamicProperty("mv:race") === 0);
noNewErrors("trocar de raça sem erro", mark);

// varre raca x tier: todo personagem do registro aparece exatamente uma vez
const todosOsBotoes = [];
for (let r = 0; r < RACES.length; r++) {
  for (let t = 0; t < TIERS.length; t++) {
    queueFormResponse(t);
    useItem(explorador, "multiversal:character_selector");
    await settleForms();
    const menu = shownForms[shownForms.length - 1];
    todosOsBotoes.push(...menu.buttons.slice(0, -1)); // o ultimo e "Voltar"
  }
  explorador.isSneaking = true;
  useItem(explorador, "multiversal:character_selector");
  explorador.isSneaking = false;
}
const totalEsperado = Object.keys(RACE_TIER).length;
check(
  "raças x tiers cobrem todo o elenco, sem repetição",
  todosOsBotoes.length === totalEsperado && new Set(todosOsBotoes).size === totalEsperado,
  `${todosOsBotoes.length} botões, ${new Set(todosOsBotoes).size} únicos, esperado ${totalEsperado}`
);
noNewErrors("varrer todos os menus sem erro", mark);

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
// a troca de persona é dona do agachar+m1 na Resurrección: aqui o bloqueio
// perde a disputa da tecla, e isso é escolha, não acidente
check(
  "a troca de persona ganha do bloqueio na mesma tecla",
  !starkk.getDynamicProperty("mv:block_end"),
  String(starkk.getDynamicProperty("mv:block_end"))
);
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
advanceTicks(5, "metralleta-primeira-fileira");
noNewErrors("Cero Metralleta executa limpo", mark);

// a primeira fileira sai inteira de uma vez: varias balas, nao uma seguida da outra
const primeiraFileira = log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoTiro");
check(
  "a fileira inteira acerta de uma vez (balas de 30)",
  primeiraFileira.length >= 2 && primeiraFileira.every((d) => d.amount === 30),
  `${primeiraFileira.length} balas de ${JSON.stringify([...new Set(primeiraFileira.map((d) => d.amount))])}`
);
check(
  "só uma fileira saiu até aqui",
  primeiraFileira.length <= CERO_METRALLETA_BULLETS,
  `${primeiraFileira.length} acertos`
);

// o disparo e um PENTE: as outras 3 fileiras vem logo atras, sem esperar a pausa
advanceTicks(13, "metralleta-resto-do-pente");
const pente = log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoTiro");
check(
  "cada disparo é um pente de 4 fileiras coladas",
  pente.length > primeiraFileira.length &&
    pente.length <= CERO_METRALLETA_BULLETS * CERO_METRALLETA_ROWS,
  `${pente.length} acertos no pente (${primeiraFileira.length} na 1ª fileira)`
);
check(
  "quem está fora da largura da fileira não leva",
  !log.damages.slice(dmgBefore).some((d) => d.target === "ForaDaCaixa")
);

// o proximo pente so vem depois da pausa
dmgBefore = log.damages.length;
advanceTicks(30, "metralleta-segundo-pente");
check(
  "vem outro pente depois da pausa",
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

/* ================= Yammy Llargo ================= */

scenario("Yammy Llargo: ativação");
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
// num player o teleport do mesmo tick engole o knockback (o cliente e dono da
// posicao dele), entao o arremesso TEM que sair depois do ultimo teleport
const ultimoTeleport = log.teleports
  .filter((t) => t.target === "SacoDePancada")
  .reduce((acc, t) => Math.max(acc, t.tick), -1);
check(
  "o arremesso não sai no mesmo tick do último teleport",
  arremesso && arremesso.tick > ultimoTeleport,
  `knockback no tick ${arremesso?.tick}, último teleport no ${ultimoTeleport}`
);

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
const IRA_HP = game.CHARACTERS.yammy.awakening.health;
check(`vida maxima ${IRA_HP}`, virtualMax(yammy) === IRA_HP, `${virtualMax(yammy)}`);
check("speed 1 (amplifier 0)", yammy.getEffect("speed")?.amplifier === 0, `${yammy.getEffect("speed")?.amplifier}`);
check("lentidão 1 (amplifier 0)", yammy.getEffect("slowness")?.amplifier === 0, `${yammy.getEffect("slowness")?.amplifier}`);
check("fadiga 2 (amplifier 1)", yammy.getEffect("mining_fatigue")?.amplifier === 1, `${yammy.getEffect("mining_fatigue")?.amplifier}`);
check("sem regeneração passiva (a cura é em bloco)", !yammy.getEffect("regeneration"));
check(
  "marcador invisível travado na offhand (é ele que escala o modelo)",
  yammy.getComponent("minecraft:equippable").getEquipment("Offhand")?.typeId === "yammy:ira_marker",
  String(yammy.getComponent("minecraft:equippable").getEquipment("Offhand")?.typeId)
);
// O marcador so serve se o RP realmente olhar pra ele. Nada amarrava os dois
// lados, e foi por isso que a forma gigante passou por todos os checks sem
// nunca escalar no jogo.
const playerEntity = JSON.parse(
  fs.readFileSync(new URL("../RP/entity/player.entity.json", import.meta.url), "utf-8")
);
const scaleExpr = playerEntity["minecraft:client_entity"].description.scripts.scale;
const marcadorNaOffhand = yammy
  .getComponent("minecraft:equippable")
  .getEquipment("Offhand")?.typeId;
check(
  "o scripts.scale do RP olha exatamente o item que está na offhand",
  !!marcadorNaOffhand && scaleExpr.includes(`'${marcadorNaOffhand}'`),
  `offhand=${marcadorNaOffhand} scale=${scaleExpr}`
);
// o modelo do player tem 1.8 blocos na escala vanilla 0.9375
const escalaGigante = Number((scaleExpr.match(/\?\s*([\d.]+)/) ?? [])[1]);
check(
  "a escala da forma gigante dá ~10 blocos de altura",
  Math.abs((escalaGigante * 1.8) / 0.9375 - 10) < 0.5,
  `escala ${escalaGigante} -> ${((escalaGigante * 1.8) / 0.9375).toFixed(2)} blocos`
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
// mesma disputa da persona do Starkk: na Ira o agachar+m1 é da câmera
check(
  "a câmera alta ganha do bloqueio na mesma tecla",
  !yammy.getDynamicProperty("mv:block_end"),
  String(yammy.getDynamicProperty("mv:block_end"))
);
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

/* ================= Tier Harribel ================= */

scenario("Tier Harribel: ativação");
const harribel = createPlayer("HarribelPlayer", { x: 2200, y: 64, z: 2200 });
const presa = createDummy("Presa", { x: 2203, y: 64, z: 2200 }, 500000);
emit("playerSpawn", { player: harribel, initialSpawn: true });
advanceTicks(20, "spawn-harribel");

mark = errors.length;
await pickCharacter(harribel, "harribel");
advanceTicks(20, "ativar-harribel");
noNewErrors("ativar Harribel sem erro", mark);
check("vida maxima 2600", virtualMax(harribel) === 2600, `${virtualMax(harribel)}`);
check("vida cheia ao ativar", Math.round(virtualHp(harribel)) === 2600, `${virtualHp(harribel)}`);
check(
  "5 itens base nos slots 0-4",
  JSON.stringify(slotIds(harribel, 5)) ===
    JSON.stringify([
      "harribel:m1_zanpakuto",
      "harribel:tiburon_slash",
      "harribel:shark_issues",
      "harribel:water_prison",
      "harribel:aquas_dash",
    ]),
  JSON.stringify(slotIds(harribel, 5))
);

dmgBefore = log.damages.length;
hitWith(harribel, presa, "harribel:m1_zanpakuto");
check(
  "m1 dá 50 de dano",
  log.damages.slice(dmgBefore).some((d) => d.target === "Presa" && d.amount === 50)
);

scenario("Tiburon's Slash: corte horizontal");
mark = errors.length;
harribel.teleport({ x: 2200, y: 64, z: 2200 });
harribel._view = { x: 1, y: 0, z: 0 };
presa.teleport({ x: 2208, y: 64, z: 2200 });
const foraDoCorteHarribel = createDummy("ForaDoCorte", { x: 2208, y: 64, z: 2215 }, 500000);
dmgBefore = log.damages.length;
const partBeforeCorte = log.particles.length;
useItem(harribel, "harribel:tiburon_slash");
advanceTicks(20, "tiburon-slash");
noNewErrors("Tiburon's Slash executa limpo", mark);
check(
  "180 de dano, uma vez só por alvo",
  log.damages.slice(dmgBefore).filter((d) => d.target === "Presa" && d.amount === 180).length === 1,
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "Presa"))
);
check("quem está longe do corte não leva", !log.damages.slice(dmgBefore).some((d) => d.target === "ForaDoCorte"));
const corteParticulas = log.particles.slice(partBeforeCorte).filter((p) => p.particleId === "harribel:agua");
check("desenha o corte com água", corteParticulas.length > 50, `${corteParticulas.length} partículas`);
// deitado: o arco abre pros LADOS, entao a variacao lateral e maior que a vertical
const espalhamentoZ = Math.max(...corteParticulas.map((p) => p.location.z)) -
  Math.min(...corteParticulas.map((p) => p.location.z));
const espalhamentoY = Math.max(...corteParticulas.map((p) => p.location.y)) -
  Math.min(...corteParticulas.map((p) => p.location.y));
check(
  "o corte é deitado (abre mais pros lados do que pra cima)",
  espalhamentoZ > espalhamentoY * 3,
  `lateral=${espalhamentoZ.toFixed(1)} vertical=${espalhamentoY.toFixed(1)}`
);

scenario("Shark Issues: 4 tubarões guiados");
mark = errors.length;
harribel.teleport({ x: 2200, y: 64, z: 2200 });
harribel._view = { x: 1, y: 0, z: 0 };
presa.teleport({ x: 2212, y: 64, z: 2204 }); // fora da mira, os tubarões curvam
dmgBefore = log.damages.length;
useItem(harribel, "harribel:shark_issues");
advanceTicks(60, "shark-issues");
noNewErrors("Shark Issues executa limpo", mark);
const tubaroes = log.damages.slice(dmgBefore).filter((d) => d.target === "Presa");
check(
  "os tubarões perseguem e acertam (100 cada)",
  tubaroes.length >= 1 && tubaroes.every((d) => d.amount === 100),
  `${tubaroes.length} acertos de ${JSON.stringify([...new Set(tubaroes.map((d) => d.amount))])}`
);
check(
  "no máximo 4 tubarões",
  tubaroes.length <= 4,
  `${tubaroes.length} acertos`
);
advanceTicks(140, "shark-issues-dissipa");
noNewErrors("os tubarões somem sozinhos", mark);
foraDoCorteHarribel.kill();

scenario("Water Prison: cela de água 3x3");
mark = errors.length;
harribel.teleport({ x: 2300, y: 64, z: 2300 });
harribel._view = { x: 1, y: 0, z: 0 };
presa.teleport({ x: 2306, y: 64, z: 2300 });
const blocosAntes = log.blocks.length;
useItem(harribel, "harribel:water_prison");
advanceTicks(5, "water-prison-fecha");
noNewErrors("Water Prison executa limpo", mark);
const aguaColocada = log.blocks.slice(blocosAntes).filter((b) => b.typeId === "minecraft:water");
check(
  "coloca uma cela 3x3x3 de água (27 blocos)",
  aguaColocada.length === 27,
  `${aguaColocada.length} blocos`
);
check("o alvo não consegue se mexer", presa.getEffect("slowness")?.amplifier === 255);

// tenta fugir: a cela puxa de volta
presa.teleport({ x: 2312, y: 64, z: 2300 });
advanceTicks(2, "water-prison-fuga");
const distDaCela = Math.abs(presa.location.x - 2306.5);
check("puxa de volta quem tenta sair", distDaCela < 1, `dist=${distDaCela.toFixed(2)}`);

const blocosAntesDeAbrir = log.blocks.length;
advanceTicks(210, "water-prison-abre");
const restaurados = log.blocks.slice(blocosAntesDeAbrir);
check(
  "depois de 10s apaga a água e devolve o que estava lá",
  restaurados.length === 27 && restaurados.every((b) => b.typeId === "minecraft:air"),
  `${restaurados.length} blocos, ${JSON.stringify([...new Set(restaurados.map((b) => b.typeId))])}`
);
check("e solta o alvo", !presa.getEffect("slowness"));

scenario("Water Prison: alvo morre antes da hora");
mark = errors.length;
harribel.teleport({ x: 2400, y: 64, z: 2400 });
harribel._view = { x: 1, y: 0, z: 0 };
const preso = createDummy("Preso", { x: 2404, y: 64, z: 2400 }, 100);
advanceTicks(600, "cooldown-water-prison");
let blocosMark = log.blocks.length;
useItem(harribel, "harribel:water_prison");
advanceTicks(5, "prender");
check(
  "cela levantada",
  log.blocks.slice(blocosMark).filter((b) => b.typeId === "minecraft:water").length === 27
);
blocosMark = log.blocks.length;
preso.kill();
advanceTicks(5, "alvo-morreu");
noNewErrors("morte do alvo não quebra a prisão", mark);
check(
  "a cela abre sozinha quando o alvo morre (não fica de pé pra sempre)",
  log.blocks.slice(blocosMark).length === 27 &&
    log.blocks.slice(blocosMark).every((b) => b.typeId === "minecraft:air"),
  `${log.blocks.slice(blocosMark).length} blocos devolvidos`
);

scenario("Aqua's Dash");
mark = errors.length;
harribel.teleport({ x: 2500, y: 64, z: 2500 });
harribel._view = { x: 1, y: 0, z: 0 };
useItem(harribel, "harribel:aquas_dash");
advanceTicks(20, "aquas-dash");
noNewErrors("Aqua's Dash executa limpo", mark);
check(
  "avança um dash grande (24 blocos)",
  Math.abs(harribel.location.x - 2524) < 1.5,
  `x=${harribel.location.x.toFixed(1)}`
);

scenario("Resurrección: Tiburón");
mark = errors.length;
harribel.teleport({ x: 2200, y: 64, z: 2200 });
harribel.setDynamicProperty(DP.awakening, 100);
const msgsBeforeTiburon = log.worldMessages.length;
harribel.isSneaking = true;
useItem(harribel, "harribel:m1_zanpakuto");
harribel.isSneaking = false;
advanceTicks(20, "tiburon");
noNewErrors("Resurrección sem erro", mark);
check(
  "manda a fala no chat",
  log.worldMessages
    .slice(msgsBeforeTiburon)
    .some((m) => m.message === "<HarribelPlayer> Reduce a cenizas, Tiburón")
);
check("awakened = true", harribel.getDynamicProperty(DP.awakened) === true);
check("vida maxima 3000", virtualMax(harribel) === 3000, `${virtualMax(harribel)}`);
check(
  "4 itens da Resurrección nos slots 0-3",
  JSON.stringify(slotIds(harribel, 4)) ===
    JSON.stringify([
      "harribel:m1_diente",
      "harribel:tsunami",
      "harribel:vortice",
      "harribel:maldita_agua",
    ]),
  JSON.stringify(slotIds(harribel, 4))
);

dmgBefore = log.damages.length;
presa.teleport({ x: 2203, y: 64, z: 2200 });
hitWith(harribel, presa, "harribel:m1_diente");
check(
  "m1 do dente de tubarão dá 90",
  log.damages.slice(dmgBefore).some((d) => d.target === "Presa" && d.amount === 90)
);

scenario("Tsunami");
mark = errors.length;
harribel.teleport({ x: 2600, y: 64, z: 2600 });
harribel._view = { x: 1, y: 0, z: 0 };
presa.teleport({ x: 2612, y: 64, z: 2600 });
const foraDaOnda = createDummy("ForaDaOnda", { x: 2612, y: 64, z: 2620 }, 500000);
dmgBefore = log.damages.length;
const kbAntesDaOnda = log.knockbacks.length;
blocosMark = log.blocks.length;
useItem(harribel, "harribel:tsunami");
advanceTicks(30, "tsunami");
noNewErrors("Tsunami executa limpo", mark);
const onda = log.damages.slice(dmgBefore).filter((d) => d.target === "Presa");
check(
  "750 de dano, uma vez só por alvo",
  onda.length === 1 && onda[0].amount === 750,
  JSON.stringify(onda)
);
check("empurra quem a onda pega", log.knockbacks.slice(kbAntesDaOnda).some((k) => k.target === "Presa"));
check("quem está fora da largura não leva", !log.damages.slice(dmgBefore).some((d) => d.target === "ForaDaOnda"));
check("a água NÃO fica (nenhum bloco colocado)", log.blocks.length === blocosMark, `${log.blocks.length - blocosMark} blocos`);
foraDaOnda.kill();

scenario("Vórtice de agua");
mark = errors.length;
harribel.teleport({ x: 2700, y: 64, z: 2700 });
harribel._view = { x: 1, y: 0, z: 0 };
presa.teleport({ x: 2706, y: 64, z: 2700 });
dmgBefore = log.damages.length;
useItem(harribel, "harribel:vortice");
advanceTicks(50, "vortice-metade");

// girar de verdade = orbitar o centro, com o angulo mudando a cada tick
const raioNoVortice = Math.hypot(presa.location.x - 2706, presa.location.z - 2700);
const anguloAntes = Math.atan2(presa.location.z - 2700, presa.location.x - 2706);
advanceTicks(1, "vortice-um-tick");
const anguloDepois = Math.atan2(presa.location.z - 2700, presa.location.x - 2706);
check(
  "joga o alvo pra fora do olho do vórtice",
  raioNoVortice > 2,
  `raio=${raioNoVortice.toFixed(2)}`
);
check(
  "gira o alvo em volta do centro",
  Math.abs(anguloDepois - anguloAntes) > 0.05,
  `ângulo ${anguloAntes.toFixed(2)} -> ${anguloDepois.toFixed(2)}`
);

advanceTicks(60, "vortice-fim");
noNewErrors("Vórtice executa limpo", mark);
const vortice = log.damages.slice(dmgBefore).filter((d) => d.target === "Presa");
check(
  "200 por segundo durante 5 segundos",
  vortice.length === 5 && vortice.every((d) => d.amount === 200),
  `${vortice.length} pulsos de ${JSON.stringify([...new Set(vortice.map((d) => d.amount))])}`
);
dmgBefore = log.damages.length;
advanceTicks(40, "vortice-acabou");
check("para sozinho", !log.damages.slice(dmgBefore).some((d) => d.target === "Presa"));

scenario("Maldita Água: não acaba sozinha");
mark = errors.length;
harribel.teleport({ x: 2800, y: 64, z: 2800 });
harribel._view = { x: 1, y: 0, z: 0 };
presa.teleport({ x: 2806, y: 64, z: 2800 });
dmgBefore = log.damages.length;
useItem(harribel, "harribel:maldita_agua");
advanceTicks(200, "maldita-agua-10s");
noNewErrors("Maldita Água executa limpo", mark);
const maldicao = log.damages.slice(dmgBefore).filter((d) => d.target === "Presa");
check(
  "20 de dano por segundo",
  maldicao.length === 10 && maldicao.every((d) => d.amount === 20),
  `${maldicao.length} pulsos de ${JSON.stringify([...new Set(maldicao.map((d) => d.amount))])}`
);
// mesmo passando do cooldown mais longo da addon, a maldicao continua
dmgBefore = log.damages.length;
advanceTicks(600, "maldita-agua-30s");
check(
  "continua queimando depois de 30s (não tem prazo)",
  log.damages.slice(dmgBefore).filter((d) => d.target === "Presa").length === 30
);
// e nem a reversão da Resurrección solta o alvo
harribel.setDynamicProperty(DP.awakening, 2);
advanceTicks(90, "drenar-tiburon");
check("awakened = false", harribel.getDynamicProperty(DP.awakened) === false);
check("vida maxima volta pra 2600", virtualMax(harribel) === 2600, `${virtualMax(harribel)}`);
check(
  "itens base restaurados",
  inv(harribel).getItem(0)?.typeId === "harribel:m1_zanpakuto",
  String(inv(harribel).getItem(0)?.typeId)
);
dmgBefore = log.damages.length;
advanceTicks(100, "maldita-agua-pos-reversao");
check(
  "sair da Resurrección não desfaz a maldição",
  log.damages.slice(dmgBefore).filter((d) => d.target === "Presa").length === 5
);

scenario("Maldita Água: acaba quando o alvo morre");
mark = errors.length;
presa.kill();
advanceTicks(40, "alvo-da-maldicao-morreu");
noNewErrors("morte do alvo não quebra a maldição", mark);
check(
  "avisa no chat que a maldição acabou",
  log.worldMessages.some(
    (m) => m.to === "*" && m.message.includes("maldição") && m.message.includes("se desfez")
  )
);
dmgBefore = log.damages.length;
advanceTicks(100, "sem-alvo");
check(
  "e para de queimar",
  !log.damages.slice(dmgBefore).some((d) => d.target === "Presa")
);

scenario("Maldita Água: acaba se a Harribel sai de personagem");
mark = errors.length;
const presa2 = createDummy("Presa2", { x: 2806, y: 64, z: 2800 }, 500000);
harribel.teleport({ x: 2800, y: 64, z: 2800 });
harribel._view = { x: 1, y: 0, z: 0 };
advanceTicks(3600, "cooldown-maldita-agua");
dmgBefore = log.damages.length;
useItem(harribel, "harribel:maldita_agua");
advanceTicks(60, "maldicao-nova");
check(
  "maldição nova em andamento",
  log.damages.slice(dmgBefore).filter((d) => d.target === "Presa2").length === 3
);
queueFormResponse(deactivateButtonIndex(harribel));
useItem(harribel, "multiversal:character_selector");
await Promise.resolve();
await Promise.resolve();
advanceTicks(10, "desativar-harribel");
dmgBefore = log.damages.length;
advanceTicks(100, "sem-personagem");
noNewErrors("desativar com maldição no ar sem erro", mark);
check(
  "remover o personagem corta a maldição",
  !log.damages.slice(dmgBefore).some((d) => d.target === "Presa2")
);
presa2.kill();

/* ================= Bloqueio universal ================= */

scenario("Bloqueio: agachar com o m1 corta metade do dano");
mark = errors.length;
const guardiao = createPlayer("Guardiao", { x: 3000, y: 64, z: 3000 });
const agressor = createPlayer("Agressor", { x: 3003, y: 64, z: 3000 });
emit("playerSpawn", { player: guardiao, initialSpawn: true });
emit("playerSpawn", { player: agressor, initialSpawn: true });
advanceTicks(20, "spawn-bloqueio");
await pickCharacter(guardiao, "ichigo");
await pickCharacter(agressor, "kenpachi");
advanceTicks(20, "ativar-bloqueio");
noNewErrors("dois personagens ativados sem erro", mark);

// sem guarda: dano cheio
dmgBefore = log.damages.length;
hitWith(agressor, guardiao, "kenpachi:m1_zanpakuto");
const KEN_M1 = game.DAMAGE.kenpachiM1;
const HALF = game.BLOCK.damageMultiplier;
check(
  `sem guarda o m1 do Kenpachi dá ${KEN_M1} cheios`,
  log.damages.slice(dmgBefore).some((d) => d.target === "Guardiao" && d.amount === KEN_M1),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "Guardiao"))
);

// agachar + m1 = bloquear
guardiao.isSneaking = true;
useItem(guardiao, "ichigo:m1_zangetsu");
guardiao.isSneaking = false;
check("guarda levantada", guardiao.getDynamicProperty("mv:block_end") > 0);

dmgBefore = log.damages.length;
hitWith(agressor, guardiao, "kenpachi:m1_zanpakuto");
check(
  `bloqueando, o mesmo golpe dá metade (${KEN_M1 * HALF})`,
  log.damages.slice(dmgBefore).some((d) => d.target === "Guardiao" && d.amount === KEN_M1 * HALF),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "Guardiao"))
);

// skill tambem e cortada pela metade, nao so o m1
agressor.teleport({ x: 3002, y: 64, z: 3000 });
agressor._view = { x: -1, y: 0, z: 0 };
guardiao.teleport({ x: 3000, y: 64, z: 3000 });
dmgBefore = log.damages.length;
useItem(agressor, "kenpachi:stomp");
advanceTicks(5, "stomp-bloqueado");
check(
  `a guarda vale pra skill também (Stomp de ${game.DAMAGE.stomp} vira ${game.DAMAGE.stomp * HALF})`,
  log.damages.slice(dmgBefore).some((d) => d.target === "Guardiao" && d.amount === game.DAMAGE.stomp * HALF),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "Guardiao"))
);

scenario("Bloqueio: dura 5s e só volta depois de 5s");
mark = errors.length;
advanceTicks(110, "guarda-expira");
noNewErrors("a guarda cai sozinha sem erro", mark);
check("guarda caiu depois de 5s", !guardiao.getDynamicProperty("mv:block_end"));
check(
  "avisa que a guarda caiu",
  log.worldMessages.some((m) => m.to === "Guardiao" && m.message.includes("guarda caiu"))
);

dmgBefore = log.damages.length;
hitWith(agressor, guardiao, "kenpachi:m1_zanpakuto");
check(
  "sem guarda o dano volta a ser cheio",
  log.damages.slice(dmgBefore).some((d) => d.target === "Guardiao" && d.amount === KEN_M1)
);

// o cooldown conta a partir de quando a guarda CAIU, nao da ativacao
guardiao.isSneaking = true;
useItem(guardiao, "ichigo:m1_zangetsu");
guardiao.isSneaking = false;
check(
  "não dá pra levantar a guarda de novo na hora",
  !guardiao.getDynamicProperty("mv:block_end"),
  String(guardiao.getDynamicProperty("mv:block_end"))
);

advanceTicks(110, "cooldown-da-guarda");
guardiao.isSneaking = true;
useItem(guardiao, "ichigo:m1_zangetsu");
guardiao.isSneaking = false;
check("depois dos 5s de recarga a guarda volta", guardiao.getDynamicProperty("mv:block_end") > 0);

scenario("Bloqueio: agachar de novo baixa a guarda");
guardiao.isSneaking = true;
useItem(guardiao, "ichigo:m1_zangetsu");
guardiao.isSneaking = false;
check("guarda baixada na hora", !guardiao.getDynamicProperty("mv:block_end"));
check(
  "avisa que baixou",
  log.worldMessages.some((m) => m.to === "Guardiao" && m.message.includes("baixou a guarda"))
);

scenario("Bloqueio: o awakening ganha da guarda na mesma tecla");
mark = errors.length;
guardiao.setDynamicProperty("mv:awakening", 100);
guardiao.isSneaking = true;
useItem(guardiao, "ichigo:m1_zangetsu");
guardiao.isSneaking = false;
advanceTicks(10, "awakening-vs-guarda");
noNewErrors("disputa da tecla sem erro", mark);
check("agachar + m1 com medidor cheio desperta", guardiao.getDynamicProperty(DP.awakened) === true);
check("e não levanta guarda", !guardiao.getDynamicProperty("mv:block_end"));
guardiao.setDynamicProperty("mv:awakening", 0);
advanceTicks(40, "reverter-ichigo");

/* ================= Barragan Louisenbairn ================= */

scenario("Barragan Louisenbairn: ativação");
const barragan = createPlayer("BarraganPlayer", { x: 3300, y: 64, z: 3300 });
const servo = createDummy("Servo", { x: 3303, y: 64, z: 3300 }, 500000);
emit("playerSpawn", { player: barragan, initialSpawn: true });
advanceTicks(20, "spawn-barragan");

mark = errors.length;
await pickCharacter(barragan, "barragan");
advanceTicks(20, "ativar-barragan");
noNewErrors("ativar Barragan sem erro", mark);
check("vida maxima 3000", virtualMax(barragan) === 3000, `${virtualMax(barragan)}`);
check(
  "5 itens base nos slots 0-4",
  JSON.stringify(slotIds(barragan, 5)) ===
    JSON.stringify([
      "barragan:m1_zanpakuto",
      "barragan:arrogante_slash",
      "barragan:el_rei_oco",
      "barragan:royal_cleave",
      "barragan:withers_slashes",
    ]),
  JSON.stringify(slotIds(barragan, 5))
);
dmgBefore = log.damages.length;
hitWith(barragan, servo, "barragan:m1_zanpakuto");
check(
  "m1 dá 60 de dano",
  log.damages.slice(dmgBefore).some((d) => d.target === "Servo" && d.amount === 60)
);

scenario("Arrogante's Slash: 3 cortes e enterra");
mark = errors.length;
barragan.teleport({ x: 3300, y: 64, z: 3300 });
barragan._view = { x: 1, y: 0, z: 0 };
servo.teleport({ x: 3303, y: 64, z: 3300 });
dmgBefore = log.damages.length;
useItem(barragan, "barragan:arrogante_slash");
advanceTicks(30, "arrogante-slash");
noNewErrors("Arrogante's Slash executa limpo", mark);
const cortes = log.damages.slice(dmgBefore).filter((d) => d.target === "Servo");
check(
  "3 cortes de 100 (300 no total)",
  cortes.length === 3 && cortes.every((d) => d.amount === 100),
  `${cortes.length} cortes de ${JSON.stringify([...new Set(cortes.map((d) => d.amount))])}`
);
check("enterra o alvo (afunda no chão)", servo.location.y < 64, `y=${servo.location.y.toFixed(2)}`);
check("e prende ele lá", servo.getEffect("slowness")?.amplifier === 255);

scenario("El Rei Oco: 8 direções x 5 rajadas");
mark = errors.length;
barragan.teleport({ x: 3400, y: 64, z: 3400 });
barragan._view = { x: 1, y: 0, z: 0 };
// atrasDoRei do Barragan: so acerta se os cerosRei saírem mesmo pros 8 lados
const atrasDoRei = createDummy("Atras", { x: 3392, y: 64, z: 3400 }, 500000);
servo.teleport({ x: 3500, y: 64, z: 3500 }); // fora do caminho
dmgBefore = log.damages.length;
useItem(barragan, "barragan:el_rei_oco");
advanceTicks(80, "el-rei-oco");
noNewErrors("El Rei Oco executa limpo", mark);
const cerosRei = log.damages.slice(dmgBefore).filter((d) => d.target === "Atras");
check(
  "acerta quem está ATRÁS (sai pros 8 lados), 40 por cero",
  cerosRei.length >= 2 && cerosRei.every((d) => d.amount === 40),
  `${cerosRei.length} cerosRei de ${JSON.stringify([...new Set(cerosRei.map((d) => d.amount))])}`
);
check(
  "5 rajadas no máximo por alvo",
  cerosRei.length <= 5,
  `${cerosRei.length} acertos`
);
advanceTicks(60, "el-rei-oco-fim");
dmgBefore = log.damages.length;
advanceTicks(40, "el-rei-oco-parou");
check("para sozinho", !log.damages.slice(dmgBefore).some((d) => d.target === "Atras"));
atrasDoRei.kill();

scenario("Royal Cleave: passa pela guarda");
mark = errors.length;
// 500 de dano mataria o Ichigo (200 de vida): o bloqueador precisa aguentar
queueFormResponse(deactivateButtonIndex(guardiao));
useItem(guardiao, "multiversal:character_selector");
await Promise.resolve();
await Promise.resolve();
advanceTicks(10, "trocar-bloqueador");
await pickCharacter(guardiao, "harribel");
advanceTicks(20, "bloqueador-tanque");

barragan.teleport({ x: 3000, y: 64, z: 3000 });
barragan._view = { x: 1, y: 0, z: 0 };
guardiao.teleport({ x: 3003, y: 64, z: 3000 });
// guarda levantada de propósito
advanceTicks(120, "liberar-guarda");
guardiao.isSneaking = true;
useItem(guardiao, "harribel:m1_zanpakuto");
guardiao.isSneaking = false;
check("guarda do alvo levantada", guardiao.getDynamicProperty("mv:block_end") > 0);

dmgBefore = log.damages.length;
useItem(barragan, "barragan:royal_cleave");
advanceTicks(5, "royal-cleave");
noNewErrors("Royal Cleave executa limpo", mark);
check(
  "500 cheios mesmo contra quem está bloqueando",
  log.damages
    .slice(dmgBefore)
    .some((d) => d.target === "Guardiao" && virtualDamage(guardiao, d) === 500),
  JSON.stringify(
    log.damages
      .slice(dmgBefore)
      .filter((d) => d.target === "Guardiao")
      .map((d) => virtualDamage(guardiao, d))
  )
);
// e o corte normal do Barragan continua sendo cortado pela metade
dmgBefore = log.damages.length;
hitWith(barragan, guardiao, "barragan:m1_zanpakuto");
check(
  "mas o m1 dele continua sendo bloqueado (30 em vez de 60)",
  log.damages
    .slice(dmgBefore)
    .some((d) => d.target === "Guardiao" && virtualDamage(guardiao, d) === 30),
  JSON.stringify(
    log.damages
      .slice(dmgBefore)
      .filter((d) => d.target === "Guardiao")
      .map((d) => virtualDamage(guardiao, d))
  )
);

scenario("Wither's Slashes: corte + deterioração");
mark = errors.length;
barragan.teleport({ x: 3300, y: 64, z: 3300 });
barragan._view = { x: 1, y: 0, z: 0 };
servo.teleport({ x: 3303, y: 64, z: 3300 });
dmgBefore = log.damages.length;
useItem(barragan, "barragan:withers_slashes");
advanceTicks(10, "withers-corte");
noNewErrors("Wither's Slashes executa limpo", mark);
check(
  "o corte dá 100",
  log.damages.slice(dmgBefore).some((d) => d.target === "Servo" && d.amount === 100)
);
dmgBefore = log.damages.length;
advanceTicks(70, "withers-deterioracao");
const podre = log.damages.slice(dmgBefore).filter((d) => d.target === "Servo");
check(
  "e 80 por segundo por 3 segundos",
  podre.length === 3 && podre.every((d) => d.amount === 80),
  `${podre.length} segundos de ${JSON.stringify([...new Set(podre.map((d) => d.amount))])}`
);
dmgBefore = log.damages.length;
advanceTicks(60, "withers-acabou");
check("a deterioração para sozinha", !log.damages.slice(dmgBefore).some((d) => d.target === "Servo"));

scenario("Resurrección: Arrogante");
mark = errors.length;
barragan.setDynamicProperty(DP.awakening, 100);
const msgsBeforeArrogante = log.worldMessages.length;
barragan.isSneaking = true;
useItem(barragan, "barragan:m1_zanpakuto");
barragan.isSneaking = false;
advanceTicks(20, "arrogante");
noNewErrors("Resurrección sem erro", mark);
check(
  "manda a fala no chat",
  log.worldMessages
    .slice(msgsBeforeArrogante)
    .some((m) => m.message === "<BarraganPlayer> Envelhece, Arrogante!")
);
check("awakened = true", barragan.getDynamicProperty(DP.awakened) === true);
check("vida maxima segue 3000", virtualMax(barragan) === 3000, `${virtualMax(barragan)}`);
check(
  "5 itens da Resurrección nos slots 0-4",
  JSON.stringify(slotIds(barragan, 5)) ===
    JSON.stringify([
      "barragan:m1_arrogante",
      "barragan:ruir_del_rey",
      "barragan:respira",
      "barragan:el_maldito",
      "barragan:la_muerte",
    ]),
  JSON.stringify(slotIds(barragan, 5))
);
dmgBefore = log.damages.length;
servo.teleport({ x: 3303, y: 64, z: 3300 });
hitWith(barragan, servo, "barragan:m1_arrogante");
check(
  "m1 da Resurrección dá 70",
  log.damages.slice(dmgBefore).some((d) => d.target === "Servo" && d.amount === 70)
);

scenario("Ruir del Rey: deterioração por 7 segundos");
mark = errors.length;
barragan.teleport({ x: 3300, y: 64, z: 3300 });
servo.teleport({ x: 3305, y: 64, z: 3300 });
dmgBefore = log.damages.length;
useItem(barragan, "barragan:ruir_del_rey");
advanceTicks(150, "ruir-del-rey");
noNewErrors("Ruir del Rey executa limpo", mark);
const ruina = log.damages.slice(dmgBefore).filter((d) => d.target === "Servo");
check(
  "80 por segundo por 7 segundos",
  ruina.length === 7 && ruina.every((d) => d.amount === 80),
  `${ruina.length} segundos de ${JSON.stringify([...new Set(ruina.map((d) => d.amount))])}`
);

scenario("Respira: engole cero e ataque de longe");
mark = errors.length;
barragan.teleport({ x: 3600, y: 64, z: 3600 });
useItem(barragan, "barragan:respira");
advanceTicks(5, "respira");
noNewErrors("Respira executa limpo", mark);
check("marca de imunidade ligada", barragan.getDynamicProperty("mv:respira_end") > 0);

// um Grimmjow mirando nele com o Gran Rey Cero
grimmjow.teleport({ x: 3590, y: 64, z: 3600 });
grimmjow._view = { x: 1, y: 0, z: 0 };
dmgBefore = log.damages.length;
useItem(grimmjow, "grimmjow:gran_rey_cero");
advanceTicks(30, "cero-na-respira");
check(
  "o Gran Rey Cero não encosta nele",
  !log.damages.slice(dmgBefore).some((d) => d.target === "BarraganPlayer"),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "BarraganPlayer"))
);

// corpo a corpo continua passando: a Respira é só contra longo alcance
dmgBefore = log.damages.length;
grimmjow.teleport({ x: 3598, y: 64, z: 3600 });
hitWith(grimmjow, barragan, "grimmjow:m1_zanpakuto");
check(
  "mas o corpo a corpo passa normal",
  log.damages.slice(dmgBefore).some((d) => d.target === "BarraganPlayer"),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "BarraganPlayer"))
);

advanceTicks(220, "respira-acaba");
dmgBefore = log.damages.length;
grimmjow.teleport({ x: 3590, y: 64, z: 3600 });
grimmjow._view = { x: 1, y: 0, z: 0 };
advanceTicks(600, "cooldown-gran-rey");
useItem(grimmjow, "grimmjow:gran_rey_cero");
advanceTicks(30, "cero-sem-respira");
check(
  "passados os 10s o cero volta a acertar",
  log.damages.slice(dmgBefore).some((d) => d.target === "BarraganPlayer"),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "BarraganPlayer"))
);

scenario("El Maldito: neblina preta 50x50");
mark = errors.length;
barragan.teleport({ x: 3700, y: 64, z: 3700 });
servo.teleport({ x: 3715, y: 64, z: 3700 }); // longe, mas dentro do raio 25
dmgBefore = log.damages.length;
const partBeforeMaldito = log.particles.length;
useItem(barragan, "barragan:el_maldito");
advanceTicks(20, "el-maldito");
noNewErrors("El Maldito executa limpo", mark);
check("cega quem está dentro", servo.getEffect("blindness")?.amplifier === 0);
check(
  "desenha a neblina preta",
  log.particles.slice(partBeforeMaldito).filter((p) => p.particleId === "barragan:podridao").length > 50
);
advanceTicks(100, "el-maldito-deterioracao");
const maldicaoHits = log.damages.slice(dmgBefore).filter((d) => d.target === "Servo");
check(
  "80 por segundo por 4 segundos, sem empilhar",
  maldicaoHits.length === 4 && maldicaoHits.every((d) => d.amount === 80),
  `${maldicaoHits.length} segundos de ${JSON.stringify([...new Set(maldicaoHits.map((d) => d.amount))])}`
);

scenario("La Muerte: o primeiro toque apodrece");
mark = errors.length;
barragan.teleport({ x: 3300, y: 64, z: 3300 });
servo.teleport({ x: 3303, y: 64, z: 3300 });
const segundoAlvo = createDummy("SegundoAlvo", { x: 3304, y: 64, z: 3300 }, 500000);
useItem(barragan, "barragan:la_muerte");
advanceTicks(5, "la-muerte-armada");
noNewErrors("La Muerte executa limpo", mark);
check("fica armada esperando o toque", barragan.getDynamicProperty("mv:muerte_armed") === true);

dmgBefore = log.damages.length;
hitWith(barragan, servo, "barragan:m1_arrogante");
check("gasta a carga no primeiro toque", barragan.getDynamicProperty("mv:muerte_armed") === false);
advanceTicks(420, "la-muerte-deterioracao");
const muerteHits = log.damages.slice(dmgBefore).filter((d) => d.target === "Servo" && d.amount === 80);
check(
  "80 por segundo por 20 segundos",
  muerteHits.length === 20,
  `${muerteHits.length} segundos`
);
dmgBefore = log.damages.length;
hitWith(barragan, segundoAlvo, "barragan:m1_arrogante");
advanceTicks(60, "segundo-alvo");
check(
  "o segundo alvo não pega nada (a carga já foi)",
  !log.damages.slice(dmgBefore).some((d) => d.target === "SegundoAlvo" && d.amount === 100),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "SegundoAlvo"))
);
segundoAlvo.kill();

scenario("Fim da Resurrección do Barragan");
mark = errors.length;
barragan.setDynamicProperty(DP.awakening, 2);
advanceTicks(90, "drenar-arrogante");
noNewErrors("reversão sem erro", mark);
check("awakened = false", barragan.getDynamicProperty(DP.awakened) === false);
check("vida maxima segue 3000", virtualMax(barragan) === 3000, `${virtualMax(barragan)}`);
check(
  "itens base restaurados",
  inv(barragan).getItem(0)?.typeId === "barragan:m1_zanpakuto",
  String(inv(barragan).getItem(0)?.typeId)
);
servo.kill();

/* ================= Szayelaporro Granz ================= */

scenario("Szayelaporro Granz: ativação");
const szayel = createPlayer("SzayelPlayer", { x: 4000, y: 64, z: 4000 });
const cobaiaSzayel = createDummy("Cobaia", { x: 4003, y: 64, z: 4000 }, 500000);
emit("playerSpawn", { player: szayel, initialSpawn: true });
advanceTicks(20, "spawn-szayel");

mark = errors.length;
await pickCharacter(szayel, "szayelaporro");
advanceTicks(20, "ativar-szayel");
noNewErrors("ativar Szayelaporro sem erro", mark);
// 750 nao cai na grade do health_boost (20+4k), entao o jogo arredonda pra 752
check("vida maxima 752 (750 arredondado)", virtualMax(szayel) === 752, `${virtualMax(szayel)}`);
check(
  "5 itens base nos slots 0-4",
  JSON.stringify(slotIds(szayel, 5)) ===
    JSON.stringify([
      "szayel:m1_zanpakuto",
      "szayel:rush_and_pierce",
      "szayel:ascendent_cut",
      "szayel:carbon_copy",
      "szayel:learn_and_adapt",
    ]),
  JSON.stringify(slotIds(szayel, 5))
);
dmgBefore = log.damages.length;
hitWith(szayel, cobaiaSzayel, "szayel:m1_zanpakuto");
check(
  "m1 dá 17 de dano",
  log.damages.slice(dmgBefore).some((d) => d.target === "Cobaia" && d.amount === 17)
);

scenario("Rush and Pierce: teleguiado, não erra");
mark = errors.length;
szayel.teleport({ x: 4000, y: 64, z: 4000 });
szayel._view = { x: 1, y: 0, z: 0 };
// de propósito FORA da mira: o avanço tem que curvar até ele
cobaiaSzayel.teleport({ x: 4008, y: 64, z: 4008 });
dmgBefore = log.damages.length;
useItem(szayel, "szayel:rush_and_pierce");
advanceTicks(20, "rush-and-pierce");
noNewErrors("Rush and Pierce executa limpo", mark);
check(
  "75 de dano mesmo com o alvo fora da mira",
  log.damages.slice(dmgBefore).some((d) => d.target === "Cobaia" && d.amount === 75),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "Cobaia"))
);
const distDoAlvo = Math.hypot(szayel.location.x - 4008, szayel.location.z - 4008);
check("e avança até o alvo", distDoAlvo < 4, `dist=${distDoAlvo.toFixed(2)}`);

scenario("Ascendent Cut");
mark = errors.length;
szayel.teleport({ x: 4100, y: 64, z: 4100 });
szayel._view = { x: 1, y: 0, z: 0 };
cobaiaSzayel.teleport({ x: 4108, y: 64, z: 4100 });
dmgBefore = log.damages.length;
const kbAntesDoCorte = log.knockbacks.length;
useItem(szayel, "szayel:ascendent_cut");
advanceTicks(20, "ascendent-cut");
noNewErrors("Ascendent Cut executa limpo", mark);
check(
  "50 de dano, uma vez só por alvo",
  log.damages.slice(dmgBefore).filter((d) => d.target === "Cobaia" && d.amount === 50)
    .length === 1,
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "Cobaia"))
);
check(
  "ascendente: joga o alvo pra cima",
  log.knockbacks
    .slice(kbAntesDoCorte)
    .some((k) => k.target === "Cobaia" && k.verticalStrength > 0),
  JSON.stringify(log.knockbacks.slice(kbAntesDoCorte).filter((k) => k.target === "Cobaia"))
);

scenario("Carbon-Copy: devolve o m1 do alvo nele mesmo");
mark = errors.length;
szayel.teleport({ x: 4200, y: 64, z: 4200 });
szayel._view = { x: 1, y: 0, z: 0 };
// alvo com personagem: a cópia tem que usar o m1 DELE (Kenpachi = 14)
const copiado = createPlayer("Copiado", { x: 4205, y: 64, z: 4200 });
emit("playerSpawn", { player: copiado, initialSpawn: true });
advanceTicks(20, "spawn-copiado");
await pickCharacter(copiado, "kenpachi");
advanceTicks(20, "ativar-copiado");
dmgBefore = log.damages.length;
useItem(szayel, "szayel:carbon_copy");
advanceTicks(120, "carbon-copy");
noNewErrors("Carbon-Copy executa limpo", mark);
// o Copiado e um Kenpachi de 1700: acima do teto do Bedrock, o log guarda o
// dano REAL e a comparacao tem que ser feita na escala virtual
const golpesDaCopia = log.damages.slice(dmgBefore).filter((d) => d.target === "Copiado");
check(
  `a cópia bate no alvo com o m1 do próprio alvo (${game.DAMAGE.kenpachiM1} do Kenpachi)`,
  golpesDaCopia.length >= 1 && golpesDaCopia.every((d) => virtualDamage(copiado, d) === game.DAMAGE.kenpachiM1),
  `${golpesDaCopia.length} golpes de ${JSON.stringify([
    ...new Set(golpesDaCopia.map((d) => virtualDamage(copiado, d))),
  ])}`
);
check(
  "e a cópia bate no ALVO, não no Szayelaporro",
  !log.damages.slice(dmgBefore).some((d) => d.target === "SzayelPlayer")
);
mark = errors.length;
advanceTicks(140, "carbon-copy-fim");
noNewErrors("a cópia se desfaz sozinha", mark);
dmgBefore = log.damages.length;
advanceTicks(60, "carbon-copy-sumiu");
check("e para de bater", !log.damages.slice(dmgBefore).some((d) => d.target === "Copiado"));

scenario("Learn and Adapt: dobra o dano recebido");
mark = errors.length;
szayel.teleport({ x: 4300, y: 64, z: 4300 });
szayel._view = { x: 1, y: 0, z: 0 };
copiado.teleport({ x: 4305, y: 64, z: 4300 });
useItem(szayel, "szayel:learn_and_adapt");
advanceTicks(5, "learn-and-adapt");
noNewErrors("Learn and Adapt executa limpo", mark);
dmgBefore = log.damages.length;
hitWith(szayel, copiado, "szayel:m1_zanpakuto");
const SZ_M1 = game.DAMAGE.szayelM1;
check(
  `o m1 de ${SZ_M1} vira ${SZ_M1 * 2} no alvo estudado`,
  log.damages.slice(dmgBefore).some((d) => d.target === "Copiado" && virtualDamage(copiado, d) === SZ_M1 * 2),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "Copiado"))
);
// a marca da Pesquisa do Ulquiorra continua sendo 1.5x, não 2x
advanceTicks(320, "marca-expira");
dmgBefore = log.damages.length;
hitWith(szayel, copiado, "szayel:m1_zanpakuto");
check(
  "passados os 15s o dano volta ao normal",
  log.damages.slice(dmgBefore).some((d) => d.target === "Copiado" && virtualDamage(copiado, d) === SZ_M1)
);

scenario("Resurrección: Fornicarás");
mark = errors.length;
szayel.setDynamicProperty(DP.awakening, 100);
const msgsBeforeFornicaras = log.worldMessages.length;
szayel.isSneaking = true;
useItem(szayel, "szayel:m1_zanpakuto");
szayel.isSneaking = false;
advanceTicks(20, "fornicaras");
noNewErrors("Resurrección sem erro", mark);
check(
  "manda a fala no chat",
  log.worldMessages
    .slice(msgsBeforeFornicaras)
    .some((m) => m.message === "<SzayelPlayer> Sorva...Fornicarás")
);
check("vida maxima 1000", virtualMax(szayel) === 1000, `${virtualMax(szayel)}`);
check(
  "4 itens da Resurrección nos slots 0-3",
  JSON.stringify(slotIds(szayel, 4)) ===
    JSON.stringify([
      "szayel:m1_fornicaras",
      "szayel:teatro_de_titeres",
      "szayel:posse",
      "szayel:gabriel",
    ]),
  JSON.stringify(slotIds(szayel, 4))
);
dmgBefore = log.damages.length;
cobaiaSzayel.teleport({ x: 4303, y: 64, z: 4300 });
hitWith(szayel, cobaiaSzayel, "szayel:m1_fornicaras");
check(
  "m1 da Resurrección dá 22",
  log.damages.slice(dmgBefore).some((d) => d.target === "Cobaia" && d.amount === 22)
);

scenario("Individualidade: 40 de vida a cada 6 segundos");
mark = errors.length;
// o contador da cura em bloco é por sessão e já estava rodando: espera a
// próxima cura cair pra zerar a janela antes de medir
hp(szayel).setCurrentValue(500);
let curaAlinhada = false;
for (let i = 0; i < 8 && !curaAlinhada; i++) {
  advanceTicks(20, "alinhar-cura");
  if (Math.round(virtualHp(szayel)) > 500) curaAlinhada = true;
}
check("a cura em bloco cai", curaAlinhada);

hp(szayel).setCurrentValue(500);
advanceTicks(100, "quase-6s");
check("não cura antes dos 6s", Math.round(virtualHp(szayel)) === 500, `${virtualHp(szayel)}`);
advanceTicks(40, "6s");
check("cura 40 aos 6s", Math.round(virtualHp(szayel)) === 540, `${virtualHp(szayel)}`);
advanceTicks(120, "12s");
check("e outros 40 aos 12s", Math.round(virtualHp(szayel)) === 580, `${virtualHp(szayel)}`);
noNewErrors("a cura em bloco roda sem erro", mark);

scenario("Teatro de Títeres: trava os dois e corta o coração");
mark = errors.length;
szayel.teleport({ x: 4400, y: 64, z: 4400 });
szayel._view = { x: 1, y: 0, z: 0 };
// alvo com personagem pra dar pra medir os -30% de vida máxima
const titere = createPlayer("Titere", { x: 4405, y: 64, z: 4400 });
emit("playerSpawn", { player: titere, initialSpawn: true });
advanceTicks(20, "spawn-titere");
await pickCharacter(titere, "yammy");
advanceTicks(20, "ativar-titere");
check("o títere começa com 1000 de vida máxima", virtualMax(titere) === 1000, `${virtualMax(titere)}`);

// o menu é o 4º botão: o coração
queueFormResponse(3);
useItem(szayel, "szayel:teatro_de_titeres");
advanceTicks(2, "teatro-abre");
await Promise.resolve();
await Promise.resolve();
advanceTicks(10, "teatro-escolhe");
noNewErrors("Teatro de Títeres executa limpo", mark);
check(
  "coração furado: -30% da vida máxima (1000 -> 700)",
  virtualMax(titere) === 700,
  `${virtualMax(titere)}`
);
check("e solta os dois depois da escolha", !szayel.getDynamicProperty("mv:frozen_end"));

scenario("Teatro de Títeres: uso único por Resurrección");
mark = errors.length;
advanceTicks(420, "cooldown-teatro");
const msgsBeforeSegundoTeatro = log.worldMessages.length;
useItem(szayel, "szayel:teatro_de_titeres");
advanceTicks(5, "segundo-teatro");
noNewErrors("recusa o segundo uso sem erro", mark);
check(
  "avisa que é uso único",
  log.worldMessages
    .slice(msgsBeforeSegundoTeatro)
    .some((m) => m.to === "SzayelPlayer" && m.message.includes("uso único")),
  JSON.stringify(log.worldMessages.slice(msgsBeforeSegundoTeatro).map((m) => m.message))
);

scenario("Teatro de Títeres: a mutilação cai quando um dos dois morre");
// o lado que morre aqui é o DONO da mutilação, pra dar pra ler o alvo depois
mark = errors.length;
const szayelSombra = createPlayer("SzayelSombra", { x: 4450, y: 64, z: 4450 });
const titere2 = createPlayer("Titere2", { x: 4455, y: 64, z: 4450 });
emit("playerSpawn", { player: szayelSombra, initialSpawn: true });
emit("playerSpawn", { player: titere2, initialSpawn: true });
advanceTicks(20, "spawn-sombra");
await pickCharacter(szayelSombra, "szayelaporro");
await pickCharacter(titere2, "yammy");
advanceTicks(20, "ativar-sombra");
szayelSombra.setDynamicProperty(DP.awakening, 100);
szayelSombra.isSneaking = true;
useItem(szayelSombra, "szayel:m1_zanpakuto");
szayelSombra.isSneaking = false;
advanceTicks(20, "sombra-desperta");
szayelSombra._view = { x: 1, y: 0, z: 0 };

queueFormResponse(3); // coração
useItem(szayelSombra, "szayel:teatro_de_titeres");
advanceTicks(2, "teatro-sombra");
await Promise.resolve();
await Promise.resolve();
advanceTicks(10, "teatro-sombra-escolhe");
check("coração furado no segundo títere", virtualMax(titere2) === 700, `${virtualMax(titere2)}`);

szayelSombra.kill();
advanceTicks(30, "dono-morreu");
noNewErrors("a morte do dono não quebra nada", mark);
check("a mutilação foi devolvida", !titere2.getDynamicProperty("mv:cut_heart"));
check(
  "e a vida máxima do alvo volta pros 1000",
  virtualMax(titere2) === 1000,
  `${virtualMax(titere2)}`
);
titere.kill();
titere2.kill();

scenario("Posse: entidades domadas caçam outro player");
mark = errors.length;
szayel.teleport({ x: 4500, y: 64, z: 4500 });
const domada = createDummy("Domada", { x: 4503, y: 64, z: 4500 }, 500000);
const presaDaPosse = createPlayer("PresaDaPosse", { x: 4510, y: 64, z: 4500 });
emit("playerSpawn", { player: presaDaPosse, initialSpawn: true });
advanceTicks(20, "spawn-presa-posse");
await pickCharacter(presaDaPosse, "ichigo");
advanceTicks(20, "ativar-presa-posse");
dmgBefore = log.damages.length;
useItem(szayel, "szayel:posse");
advanceTicks(200, "posse");
noNewErrors("Posse executa limpo", mark);
check(
  "a entidade domada anda até a presa",
  Math.abs(domada.location.x - 4510) < 3,
  `x=${domada.location.x.toFixed(2)}`
);
check(
  "e bate nela",
  log.damages.slice(dmgBefore).some((d) => d.target === "PresaDaPosse"),
  JSON.stringify(log.damages.slice(dmgBefore).map((d) => d.target))
);
check(
  "e não bate no Szayelaporro",
  !log.damages.slice(dmgBefore).some((d) => d.target === "SzayelPlayer")
);
mark = errors.length;
advanceTicks(450, "posse-acaba");
noNewErrors("a Posse acaba sozinha", mark);
dmgBefore = log.damages.length;
advanceTicks(80, "posse-acabou");
check(
  "e as entidades param",
  !log.damages.slice(dmgBefore).some((d) => d.target === "PresaDaPosse")
);

scenario("Gabriel: renasce de dentro do hospedeiro");
mark = errors.length;
szayel.teleport({ x: 4600, y: 64, z: 4600 });
const hospedeiro = createDummy("Hospedeiro", { x: 4620, y: 64, z: 4600 }, 500000);
useItem(szayel, "szayel:gabriel");
advanceTicks(5, "gabriel-armado");
check("fica armado", szayel.getDynamicProperty("mv:gabriel_armed") === true);

hitWith(szayel, hospedeiro, "szayel:m1_fornicaras");
advanceTicks(5, "gabriel-marca");
check("marca o hospedeiro no primeiro hit", szayel.getDynamicProperty("mv:gabriel_armed") === false);
check(
  "avisa quem é o hospedeiro",
  log.worldMessages.some((m) => m.message.includes("hospedeiro do"))
);

// ainda com vida: não renasce
advanceTicks(40, "gabriel-espera");
check("não renasce com vida cheia", Math.abs(szayel.location.x - 4600) < 1);

// agora sim, abaixo de 50
hp(szayel).setCurrentValue(30);
advanceTicks(30, "gabriel-renasce");
noNewErrors("o renascimento executa limpo", mark);
check(
  "teleporta no hospedeiro",
  Math.abs(szayel.location.x - 4620) < 1.5,
  `x=${szayel.location.x.toFixed(2)}`
);
check("explode o hospedeiro", !hospedeiro.isValid);
check(
  "e volta com a vida cheia",
  Math.round(virtualHp(szayel)) === 1000,
  `${virtualHp(szayel)}`
);

scenario("Fim da Resurrección do Szayelaporro");
mark = errors.length;
szayel.setDynamicProperty(DP.awakening, 2);
advanceTicks(90, "drenar-fornicaras");
noNewErrors("reversão sem erro", mark);
check("awakened = false", szayel.getDynamicProperty(DP.awakened) === false);
check("vida maxima volta pra 752", virtualMax(szayel) === 752, `${virtualMax(szayel)}`);
check(
  "itens base restaurados",
  inv(szayel).getItem(0)?.typeId === "szayel:m1_zanpakuto",
  String(inv(szayel).getItem(0)?.typeId)
);
cobaiaSzayel.kill();
domada.kill();

/* ================= Ichigo (pós-treino Vizard) ================= */

scenario("Ichigo Vizard: ativação");
const vizard = createPlayer("VizardPlayer", { x: 5000, y: 64, z: 5000 });
const alvoV = createDummy("AlvoV", { x: 5003, y: 64, z: 5000 }, 500000);
emit("playerSpawn", { player: vizard, initialSpawn: true });
advanceTicks(20, "spawn-vizard");

mark = errors.length;
await pickCharacter(vizard, "ichigo_vizard");
advanceTicks(20, "ativar-vizard");
noNewErrors("ativar Ichigo Vizard sem erro", mark);
const VIZARD = game.CHARACTERS.ichigo_vizard;
check(`vida maxima ${VIZARD.health}`, virtualMax(vizard) === VIZARD.health, `${virtualMax(vizard)}`);
check(
  "5 itens base nos slots 0-4",
  JSON.stringify(slotIds(vizard, 5)) ===
    JSON.stringify([
      "vizard:m1_bankai",
      "vizard:dash_n_slash",
      "vizard:getsuga_barrage",
      "vizard:descent_tensho",
      "vizard:super_nuke",
    ]),
  JSON.stringify(slotIds(vizard, 5))
);
dmgBefore = log.damages.length;
const animBefore = log.animations.length;
hitWith(vizard, alvoV, "vizard:m1_bankai");
check(
  `m1 dá ${game.DAMAGE.vizardM1} de dano`,
  log.damages.slice(dmgBefore).some((d) => d.target === "AlvoV" && d.amount === game.DAMAGE.vizardM1)
);
const animDoM1 = log.animations
  .slice(animBefore)
  .find((a) => a.target === "VizardPlayer" && a.animationName === "animation.vizard.slash");
check("e toca a animação de corte", !!animDoM1);
// sem controller a animação é engolida pelos animation controllers do player:
// ela dispara e some no mesmo tick, sem erro nenhum
check(
  "com controller próprio (senão o player engole a animação)",
  !!animDoM1?.options?.controller,
  JSON.stringify(animDoM1?.options)
);

scenario("Dash 'n Slash: dano por tick avançando");
mark = errors.length;
vizard.teleport({ x: 5000, y: 64, z: 5000 });
vizard._view = { x: 1, y: 0, z: 0 };
alvoV.teleport({ x: 5003, y: 64, z: 5000 });
dmgBefore = log.damages.length;
useItem(vizard, "vizard:dash_n_slash");
advanceTicks(30, "dash-n-slash");
noNewErrors("Dash 'n Slash executa limpo", mark);
const cortesV = log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoV");
check(
  `bate várias vezes, ${game.DAMAGE.dashNSlashTick} por tick`,
  cortesV.length >= 3 && cortesV.every((d) => d.amount === game.DAMAGE.dashNSlashTick),
  `${cortesV.length} ticks de ${JSON.stringify([...new Set(cortesV.map((d) => d.amount))])}`
);
check("e avança de verdade", vizard.location.x > 5010, `x=${vizard.location.x.toFixed(1)}`);

scenario("Getsuga Barrage: 6 getsugas");
mark = errors.length;
vizard.teleport({ x: 5100, y: 64, z: 5100 });
vizard._view = { x: 1, y: 0, z: 0 };
alvoV.teleport({ x: 5108, y: 64, z: 5100 });
dmgBefore = log.damages.length;
useItem(vizard, "vizard:getsuga_barrage");
advanceTicks(90, "getsuga-barrage");
noNewErrors("Getsuga Barrage executa limpo", mark);
const getsugas = log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoV");
check(
  `6 getsugas de ${game.DAMAGE.vizardBarrage}`,
  getsugas.length === 6 && getsugas.every((d) => d.amount === game.DAMAGE.vizardBarrage),
  `${getsugas.length} getsugas de ${JSON.stringify([...new Set(getsugas.map((d) => d.amount))])}`
);

scenario("Descent Tenshō: estoura no chão numa área grande");
mark = errors.length;
vizard.teleport({ x: 5200, y: 64, z: 5200 });
vizard._view = { x: 1, y: 0, z: 0 };
alvoV.teleport({ x: 5212, y: 64, z: 5200 });
const longeDoBaque = createDummy("LongeDoBaque", { x: 5212, y: 64, z: 5230 }, 500000);
dmgBefore = log.damages.length;
useItem(vizard, "vizard:descent_tensho");
advanceTicks(20, "descent-tensho");
noNewErrors("Descent Tenshō executa limpo", mark);
check(
  `${game.DAMAGE.descentTensho} de dano em quem está perto do impacto`,
  log.damages.slice(dmgBefore).some((d) => d.target === "AlvoV" && d.amount === game.DAMAGE.descentTensho),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoV"))
);
check(
  "quem está longe não leva",
  !log.damages.slice(dmgBefore).some((d) => d.target === "LongeDoBaque")
);
longeDoBaque.kill();

scenario("Super Nuke Tenshou: dobro da velocidade do Nuke");
mark = errors.length;
vizard.teleport({ x: 5300, y: 64, z: 5300 });
vizard._view = { x: 1, y: 0, z: 0 };
alvoV.teleport({ x: 5312, y: 64, z: 5300 });
dmgBefore = log.damages.length;
useItem(vizard, "vizard:super_nuke");
// 12 blocos a speed 6 = chega em 2 ticks; o Nuke original levaria 4
advanceTicks(3, "super-nuke-rapido");
noNewErrors("Super Nuke executa limpo", mark);
check(
  `${game.DAMAGE.superNuke} de dano e já chega em 3 ticks (velocidade 6)`,
  log.damages.slice(dmgBefore).some((d) => d.target === "AlvoV" && d.amount === game.DAMAGE.superNuke),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoV"))
);

scenario("Hollowficação: primeira fase");
mark = errors.length;
vizard.teleport({ x: 5000, y: 64, z: 5000 });
vizard.setDynamicProperty(DP.awakening, 100);
setVirtualHp(vizard, 600);
vizard.isSneaking = true;
useItem(vizard, "vizard:m1_bankai");
vizard.isSneaking = false;
advanceTicks(20, "hollowficacao");
noNewErrors("Hollowficação sem erro", mark);
check("awakened = true", vizard.getDynamicProperty(DP.awakened) === true);
check("ainda NÃO é a segunda fase", !vizard.getDynamicProperty("mv:true_form"));
check("speed 5 (amplifier 4)", vizard.getEffect("speed")?.amplifier === 4, `${vizard.getEffect("speed")?.amplifier}`);
check("vida maxima segue 1500", virtualMax(vizard) === 1500, `${virtualMax(vizard)}`);
// "cada awk recupera toda vida ao ser ativada"
check(
  "cura tudo ao ativar, mesmo sem mudar o teto",
  Math.round(virtualHp(vizard)) === 1500,
  `${virtualHp(vizard)}`
);
check(
  "veste o peitoral que troca a skin",
  vizard.getComponent("minecraft:equippable").getEquipment("Chest")?.typeId ===
    "vizard:hollow_chest",
  String(vizard.getComponent("minecraft:equippable").getEquipment("Chest")?.typeId)
);

scenario("Peitoral: não dá pra tirar, duplicar nem usar sem personagem");
mark = errors.length;
const equipV = () => vizard.getComponent("minecraft:equippable");
const invV = () => inv(vizard);

// tirar a peça e guardar na mochila: o loop devolve pro peito E some com a cópia
equipV().setEquipment("Chest", undefined);
invV().setItem(20, new ItemStack("vizard:hollow_chest", 1));
// a varredura da mochila roda no maximo a cada 40 ticks (por desempenho)
advanceTicks(45, "tentar-tirar-peitoral");
noNewErrors("a varredura roda limpo", mark);
check(
  "a peça volta pro peito sozinha",
  equipV().getEquipment("Chest")?.typeId === "vizard:hollow_chest",
  String(equipV().getEquipment("Chest")?.typeId)
);
check(
  "e a cópia na mochila some (nada de duplicar)",
  !invV().slots.some((i) => i?.typeId === "vizard:hollow_chest"),
  JSON.stringify(invV().slots.filter(Boolean).map((i) => i.typeId))
);

scenario("Hollowficação: getsuga maior e cura de 30 a cada 5s");
mark = errors.length;
vizard.teleport({ x: 5400, y: 64, z: 5400 });
vizard._view = { x: 1, y: 0, z: 0 };
// fora do alcance do getsuga normal (raio 3.4), dentro do aumentado (x1.6)
const naBordaViz = createDummy("NaBorda", { x: 5408, y: 64, z: 5404.6 }, 500000);
vizard.setDynamicProperty("mv:cd_vizard_getsuga_barrage", undefined); // a Barrage ainda estava recarregando
dmgBefore = log.damages.length;
useItem(vizard, "vizard:getsuga_barrage");
advanceTicks(90, "getsuga-maior");
noNewErrors("getsuga aumentado executa limpo", mark);
check(
  "o getsuga aumentado alcança quem estava fora do raio normal",
  log.damages.slice(dmgBefore).some((d) => d.target === "NaBorda"),
  JSON.stringify(log.damages.slice(dmgBefore).map((d) => d.target))
);
naBordaViz.kill();

setVirtualHp(vizard, 500);
let curaAlinhadaV = false;
for (let i = 0; i < 8 && !curaAlinhadaV; i++) {
  advanceTicks(20, "alinhar-cura-vizard");
  if (Math.round(virtualHp(vizard)) > 500) curaAlinhadaV = true;
}
check("a cura em bloco cai", curaAlinhadaV);
setVirtualHp(vizard, 500);
advanceTicks(80, "quase-5s");
check("não cura antes dos 5s", Math.round(virtualHp(vizard)) === 500, `${virtualHp(vizard)}`);
advanceTicks(40, "5s");
check("cura 30 aos 5s", Math.round(virtualHp(vizard)) === 530, `${virtualHp(vizard)}`);

scenario("TRUE AWAKENING: Vasto Lorde aos 100 de vida");
mark = errors.length;
const msgsBeforeVL = log.worldMessages.length;
const titlesBeforeVL = log.titles.length;
setVirtualHp(vizard, 90); // abaixo do limite de 100
advanceTicks(20, "vasto-lorde");
noNewErrors("a ascensão executa limpo", mark);
check("virou a segunda fase", vizard.getDynamicProperty("mv:true_form") === true);
check("vida maxima 3000", virtualMax(vizard) === 3000, `${virtualMax(vizard)}`);
check(
  "e recupera toda a vida ao ascender",
  Math.round(virtualHp(vizard)) === 3000,
  `${virtualHp(vizard)}`
);
check("speed 6 (amplifier 5)", vizard.getEffect("speed")?.amplifier === 5, `${vizard.getEffect("speed")?.amplifier}`);
check(
  "manda AHHHHHHH como title pra TODOS os players",
  log.titles.slice(titlesBeforeVL).filter((t) => t.title.includes("AHHHHHHH")).length >=
    world.getPlayers().length - 1,
  `${log.titles.slice(titlesBeforeVL).filter((t) => t.title.includes("AHHHHHHH")).length} titles`
);
check(
  "com o rugido do ender dragon",
  log.sounds.some((s) => s.soundId === "mob.enderdragon.growl")
);
check(
  "troca o peitoral pelo do Vasto Lorde",
  vizard.getComponent("minecraft:equippable").getEquipment("Chest")?.typeId ===
    "vizard:vasto_chest",
  String(vizard.getComponent("minecraft:equippable").getEquipment("Chest")?.typeId)
);
// (a aura constante saiu na 1.19: o main.js diz "o Vasto Lorde nao tem aura")
check(
  "4 skills novas + m1 do Vasto Lorde",
  JSON.stringify(slotIds(vizard, 5)) ===
    JSON.stringify([
      "vizard:m1_vasto",
      "vizard:whites_showdown",
      "vizard:bullet_hell",
      "vizard:everything_but_the_rain",
      "vizard:grito_del_diablo",
    ]),
  JSON.stringify(slotIds(vizard, 5))
);

scenario("Vasto Lorde: m1 com hit explosivo");
mark = errors.length;
vizard.teleport({ x: 5500, y: 64, z: 5500 });
alvoV.teleport({ x: 5502, y: 64, z: 5500 });
const respingo = createDummy("Respingo", { x: 5503.5, y: 64, z: 5500 }, 500000);
dmgBefore = log.damages.length;
hitWith(vizard, alvoV, "vizard:m1_vasto");
advanceTicks(2, "m1-vasto");
noNewErrors("o m1 explosivo executa limpo", mark);
check(
  `${game.DAMAGE.vastoM1} no alvo`,
  log.damages.slice(dmgBefore).some((d) => d.target === "AlvoV" && d.amount === game.DAMAGE.vastoM1)
);
check(
  "e o estouro pega quem está do lado",
  log.damages.slice(dmgBefore).some((d) => d.target === "Respingo" && d.amount === game.DAMAGE.vastoM1Blast),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "Respingo"))
);
respingo.kill();

scenario("White's Showdown: teleporta, enterra e solta ondas");
mark = errors.length;
vizard.teleport({ x: 5600, y: 64, z: 5600 });
const socado = createPlayer("Socado", { x: 5620, y: 64, z: 5600 });
emit("playerSpawn", { player: socado, initialSpawn: true });
advanceTicks(20, "spawn-socado");
await pickCharacter(socado, "yammy");
advanceTicks(20, "ativar-socado");
dmgBefore = log.damages.length;
useItem(vizard, "vizard:whites_showdown");
advanceTicks(30, "whites-showdown");
noNewErrors("White's Showdown executa limpo", mark);
check(
  "teleporta em cima do alvo",
  Math.abs(vizard.location.x - 5620) < 3,
  `x=${vizard.location.x.toFixed(1)}`
);
check("enterra o alvo dois blocos abaixo", socado.location.y <= 62, `y=${socado.location.y}`);
const ondas = log.damages.slice(dmgBefore).filter((d) => d.target === "Socado");
check(
  "e solta várias ondas de choque",
  ondas.length >= 3,
  `${ondas.length} ondas`
);

scenario("Bullet Hell: ceros por 10s com estouro em área");
mark = errors.length;
vizard.teleport({ x: 5700, y: 64, z: 5700 });
vizard._view = { x: 1, y: 0, z: 0 };
alvoV.teleport({ x: 5712, y: 64, z: 5700 });
// fora do cero, mas dentro do estouro (raio 9)
const naExplosao = createDummy("NaExplosao", { x: 5712, y: 64, z: 5706 }, 500000);
dmgBefore = log.damages.length;
useItem(vizard, "vizard:bullet_hell");
advanceTicks(60, "bullet-hell");
noNewErrors("Bullet Hell executa limpo", mark);
check(
  `os ceros acertam de ${game.DAMAGE.bulletHell}`,
  log.damages.slice(dmgBefore).some((d) => d.target === "AlvoV" && d.amount === game.DAMAGE.bulletHell)
);
check(
  "e o estouro pega quem está fora do cero",
  log.damages.slice(dmgBefore).some((d) => d.target === "NaExplosao" && d.amount === game.DAMAGE.bulletHell),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "NaExplosao"))
);
mark = errors.length;
advanceTicks(200, "bullet-hell-fim");
noNewErrors("Bullet Hell roda os 10s sem erro", mark);
dmgBefore = log.damages.length;
advanceTicks(60, "bullet-hell-parou");
check("para sozinho", !log.damages.slice(dmgBefore).some((d) => d.target === "AlvoV"));
naExplosao.kill();

scenario("Everything But the Rain: chuva de ceros");
mark = errors.length;
vizard.teleport({ x: 5800, y: 64, z: 5800 });
alvoV.teleport({ x: 5802, y: 64, z: 5800 });
dmgBefore = log.damages.length;
useItem(vizard, "vizard:everything_but_the_rain");
advanceTicks(260, "chuva-de-cero");
noNewErrors("Everything But the Rain executa limpo", mark);
const pingos = log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoV" && d.amount === game.DAMAGE.ceroRain);
check(
  `vários pingos de ${game.DAMAGE.ceroRain} caem do céu`,
  pingos.length >= 4,
  `${pingos.length} pingos`
);
mark = errors.length;
advanceTicks(200, "chuva-fim");
noNewErrors("a chuva acaba sozinha", mark);

scenario("Grito del Diablo: dano por tick por 10s, alcance absurdo");
mark = errors.length;
vizard.teleport({ x: 5900, y: 64, z: 5900 });
// 35 blocos de distância: dentro do raio 45
const bemLongeViz = createDummy("BemLonge", { x: 5935, y: 64, z: 5900 }, 500000);
alvoV.teleport({ x: 6200, y: 64, z: 6200 }); // fora do alcance
dmgBefore = log.damages.length;
useItem(vizard, "vizard:grito_del_diablo");
advanceTicks(210, "grito");
noNewErrors("Grito del Diablo executa limpo", mark);
const grito = log.damages.slice(dmgBefore).filter((d) => d.target === "BemLonge");
check(
  `${game.DAMAGE.gritoDiabloTick} por tick durante 10 segundos (200 ticks)`,
  grito.length === 200 && grito.every((d) => d.amount === game.DAMAGE.gritoDiabloTick),
  `${grito.length} ticks de ${JSON.stringify([...new Set(grito.map((d) => d.amount))])}`
);
check(
  "quem está a 300 blocos não leva",
  !log.damages.slice(dmgBefore).some((d) => d.target === "AlvoV")
);
dmgBefore = log.damages.length;
advanceTicks(60, "grito-acabou");
check("para sozinho", !log.damages.slice(dmgBefore).some((d) => d.target === "BemLonge"));
bemLongeViz.kill();

scenario("Cada ataque tem a animação dele");
mark = errors.length;
vizard.teleport({ x: 5450, y: 64, z: 5450 });
vizard._view = { x: 1, y: 0, z: 0 };
// o alvo do White's Showdown precisa ser um PLAYER vivo
const platoAnim = createPlayer("PlatoAnim", { x: 5456, y: 64, z: 5450 });
emit("playerSpawn", { player: platoAnim, initialSpawn: true });
advanceTicks(10, "spawn-plato-anim");
const esperado = [
  ["vizard:whites_showdown", "animation.vizard.slam"],
  ["vizard:bullet_hell", "animation.vizard.cast"],
  ["vizard:everything_but_the_rain", "animation.vizard.skyward"],
  ["vizard:grito_del_diablo", "animation.vizard.roar"],
];
for (const [skill, animacao] of esperado) {
  // zera o cooldown na mão: o teste é da animação, não da recarga
  vizard.setDynamicProperty("mv:cd_" + skill.replace(":", "_"), undefined);
  const antes = log.animations.length;
  useItem(vizard, skill);
  advanceTicks(3, `anim-${skill}`);
  check(
    `${skill} toca ${animacao}`,
    log.animations.slice(antes).some((a) => a.animationName === animacao),
    JSON.stringify(log.animations.slice(antes).map((a) => a.animationName))
  );
}
noNewErrors("as animações por ataque executam limpo", mark);
advanceTicks(280, "limpar-skills-da-animacao");

scenario("Vasto Lorde: o dash vira teleporte no alvo");
mark = errors.length;
// o awakening dura 100s e ja drenou nos testes acima: volta pra forma pra medir
vizard.setDynamicProperty(DP.awakening, 100);
vizard.isSneaking = true;
useItem(vizard, "vizard:m1_bankai");
vizard.isSneaking = false;
advanceTicks(20, "re-hollowficar");
setVirtualHp(vizard, 90);
advanceTicks(20, "re-ascender");
check("de volta no Vasto Lorde", vizard.getDynamicProperty("mv:true_form") === true);

vizard.teleport({ x: 6000, y: 64, z: 6000 });
socado.teleport({ x: 6025, y: 64, z: 6000 });
vizard.setDynamicProperty("mv:cd_dash", undefined);
const kbAntesDoDash = log.knockbacks.length;
vizard.isSneaking = false;
advanceTicks(4, "reset-dash-vl");
vizard._velocity = { x: 0, y: 0.5, z: 0 };
vizard.isSneaking = true;
advanceTicks(4, "dash-vl");
noNewErrors("o dash-teleporte executa limpo", mark);
check(
  "aparece em cima do alvo em vez de avançar",
  Math.abs(vizard.location.x - 6025) < 3,
  `x=${vizard.location.x.toFixed(1)}`
);
check(
  "e não usa knockback",
  !log.knockbacks.slice(kbAntesDoDash).some((k) => k.target === "VizardPlayer")
);
vizard.isSneaking = false;

scenario("Fim do awakening do Vizard");
mark = errors.length;
vizard.setDynamicProperty(DP.awakening, 2);
advanceTicks(90, "drenar-vizard");
noNewErrors("reversão sem erro", mark);
check("awakened = false", vizard.getDynamicProperty(DP.awakened) === false);
check("segunda fase limpa", !vizard.getDynamicProperty("mv:true_form"));
check("vida maxima volta pra 1500", virtualMax(vizard) === 1500, `${virtualMax(vizard)}`);
advanceTicks(15, "varredura-pos-reversao");
check(
  "o peitoral sai (a skin volta ao normal)",
  !vizard.getComponent("minecraft:equippable").getEquipment("Chest"),
  String(vizard.getComponent("minecraft:equippable").getEquipment("Chest")?.typeId)
);
check(
  "e não sobra nenhuma cópia na mochila",
  !inv(vizard).slots.some(
    (i) => i?.typeId === "vizard:hollow_chest" || i?.typeId === "vizard:vasto_chest"
  )
);
// e volta ao despertar de novo
vizard.setDynamicProperty(DP.awakening, 100);
vizard.isSneaking = true;
useItem(vizard, "vizard:m1_bankai");
vizard.isSneaking = false;
advanceTicks(20, "re-hollowficar-peitoral");
check(
  "e volta ao despertar de novo",
  vizard.getComponent("minecraft:equippable").getEquipment("Chest")?.typeId ===
    "vizard:hollow_chest",
  String(vizard.getComponent("minecraft:equippable").getEquipment("Chest")?.typeId)
);
check(
  "itens base restaurados",
  inv(vizard).getItem(0)?.typeId === "vizard:m1_bankai",
  String(inv(vizard).getItem(0)?.typeId)
);
alvoV.kill();

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
check(
  "vida do personagem reaplicada",
  virtualMax(ichigo) === ICHIGO_HP && virtualHp(ichigo) === ICHIGO_HP,
  `${virtualHp(ichigo)}/${virtualMax(ichigo)}`
);

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

/* ================= Sousuke Aizen (Captain's Fight) ================= */

const AIZEN_CFG = game.AIZEN;
const KYOKA = "aizen:m1_kyoka_suigetsu";
const KYOKA_OCULTA = "aizen:m1_kyoka_oculta";
const ichigoM1 = "ichigo:m1_zangetsu";

function aim(from, to) {
  const dx = to.location.x - from.location.x;
  const dz = to.location.z - from.location.z;
  const len = Math.hypot(dx, dz) || 1;
  from._view = { x: dx / len, y: 0, z: dz / len };
}
function clonesOf() {
  return overworld.getEntities({ type: "aizen:clone" });
}
function aizenLines(since) {
  return log.worldMessages.slice(since).filter((m) => m.to === "*" && m.message.includes("<AizenPlayer>"));
}
function fullHp(p) {
  setVirtualHp(p, virtualMax(p));
}
// depois de teleportar: olhando reto (pitch 0) e de frente pro alvo
function aimsLevelAt(p, target) {
  const rot = p.getRotation();
  const dx = target.location.x - p.location.x;
  const dz = target.location.z - p.location.z;
  const len = Math.hypot(dx, dz) || 1;
  const v = p.getViewDirection();
  return Math.abs(rot.x) < 0.01 && v.x * (dx / len) + v.z * (dz / len) > 0.999;
}

scenario("Sousuke Aizen: ativação (Shinigami, Tier 6)");
const aizen = createPlayer("AizenPlayer", { x: 8000, y: 64, z: 8000 });
const hinamori = createPlayer("Hinamori", { x: 8004, y: 64, z: 8000 });
emit("playerSpawn", { player: aizen, initialSpawn: true });
emit("playerSpawn", { player: hinamori, initialSpawn: true });
advanceTicks(20, "spawn-aizen");
mark = errors.length;
check("registro: Shinigami, Tier 6", RACE_TIER.aizen?.race === "shinigami" && RACE_TIER.aizen?.tier === 6, JSON.stringify(RACE_TIER.aizen));
await pickCharacter(aizen, "aizen");
await pickCharacter(hinamori, "ichigo");
advanceTicks(20, "ativar-aizen");
noNewErrors("ativar o Aizen pelo menu sem erro", mark);
const AIZEN_CHAR = game.CHARACTERS.aizen;
check("personagem salvo", aizen.getDynamicProperty(DP.character) === "aizen");
check("vida maxima 5500", virtualMax(aizen) === 5500, `${virtualMax(aizen)}`);
check(
  "Kyōka + 4 skills nos slots 0-4",
  JSON.stringify(slotIds(aizen, 5)) === JSON.stringify([0, 1, 2, 3, 4].map((i) => AIZEN_CHAR.items[i])),
  JSON.stringify(slotIds(aizen, 5))
);

scenario("Kyōka Suigetsu: m1 de 120 marca o alvo pra sempre");
mark = errors.length;
aizen.teleport({ x: 8000, y: 64, z: 8000 });
hinamori.teleport({ x: 8002, y: 64, z: 8000 });
check("Hinamori começa sem a marca", !hinamori.getDynamicProperty("mv:kyoka_mark"));
dmgBefore = log.damages.length;
const awkAntesKyoka = aizen.getDynamicProperty(DP.awakening) ?? 0;
hitWith(aizen, hinamori, KYOKA);
advanceTicks(2, "kyoka-m1");
noNewErrors("m1 da Kyōka sem erro", mark);
check(
  "120 de dano",
  log.damages.slice(dmgBefore).some((d) => d.target === "Hinamori" && virtualDamage(hinamori, d) === 120),
  JSON.stringify(log.damages.slice(dmgBefore))
);
check("o alvo fica marcado", hinamori.getDynamicProperty("mv:kyoka_mark") === true);
check(
  "o Aizen é avisado de quem entrou na ilusão",
  log.worldMessages.some((m) => m.to === "AizenPlayer" && m.message.includes("Hinamori"))
);
check("m1 enche o medidor da Kurohitsugi", (aizen.getDynamicProperty(DP.awakening) ?? 0) === awkAntesKyoka + 1);
const bonecoKyoka = createDummy("BonecoKyoka", { x: 8003, y: 64, z: 8003 }, 50000);
hitWith(aizen, bonecoKyoka, KYOKA);
check("mob também pode ser marcado", bonecoKyoka.getDynamicProperty("mv:kyoka_mark") === true);
bonecoKyoka.kill(); // sai do caminho da mira dos proximos cenarios
emit("playerSpawn", { player: hinamori, initialSpawn: false });
advanceTicks(5, "respawn-hinamori");
check("a marca sobrevive à morte (é pra sempre)", hinamori.getDynamicProperty("mv:kyoka_mark") === true);

scenario("Kyōka: bater num bloco marca o bloco; agachar 2x em 2s volta pra ele");
mark = errors.length;
const pedra = overworld.getBlock({ x: 8010, y: 63, z: 8000 });
pedra.setType("minecraft:stone");
emit("entityHitBlock", { damagingEntity: aizen, hitBlock: pedra, blockFace: "Up" });
noNewErrors("marcar bloco sem erro", mark);
check(
  "bloco guardado no Aizen",
  aizen.getDynamicProperty("mv:kyoka_block") === JSON.stringify({ x: 8010, y: 63, z: 8000, dim: "minecraft:overworld" }),
  String(aizen.getDynamicProperty("mv:kyoka_block"))
);
const outraPedra = overworld.getBlock({ x: 8030, y: 63, z: 8000 });
outraPedra.setType("minecraft:stone");
inv(aizen).setItem(aizen.selectedSlotIndex = 1, new ItemStack("aizen:illusions_mastery", 1));
emit("entityHitBlock", { damagingEntity: aizen, hitBlock: outraPedra, blockFace: "Up" });
check(
  "bater com outro item não marca",
  aizen.getDynamicProperty("mv:kyoka_block").includes("8010")
);
aizen.selectedSlotIndex = 0;
advanceTicks(10, "restaurar-slots");

async function tapSneak(p, holdTicks = 3, gapTicks = 3) {
  p.isSneaking = true;
  advanceTicks(holdTicks, "agachar");
  p.isSneaking = false;
  advanceTicks(gapTicks, "soltar");
}
aizen.teleport({ x: 8000, y: 64, z: 8000 });
await tapSneak(aizen);
check("um agachar só não teleporta", Math.abs(aizen.location.x - 8000) < 0.01);
await tapSneak(aizen);
check(
  "o segundo agachar em 2s leva pra cima do bloco marcado",
  Math.abs(aizen.location.x - 8010.5) < 0.01 && Math.abs(aizen.location.y - 64) < 0.01 && Math.abs(aizen.location.z - 8000.5) < 0.01,
  JSON.stringify(aizen.location)
);
aizen.teleport({ x: 8000, y: 64, z: 8000 });
await tapSneak(aizen);
advanceTicks(45, "passou-da-janela");
await tapSneak(aizen);
check("dois agachares com mais de 2s entre eles não teleportam", Math.abs(aizen.location.x - 8000) < 0.01);
advanceTicks(45, "zera-janela");
// agachar gasto na guarda (agachar + m1) não é um "toque"
aizen.isSneaking = true;
advanceTicks(2, "agachar-guarda");
useItem(aizen, KYOKA);
advanceTicks(2, "guarda");
aizen.isSneaking = false;
advanceTicks(3, "solta-guarda");
await tapSneak(aizen);
check("agachar que levantou a guarda não conta pro teleporte", Math.abs(aizen.location.x - 8000) < 0.01);
check("(e a guarda subiu normalmente)", aizen.getDynamicProperty("mv:block_end") > 0);
aizen.isSneaking = true;
useItem(aizen, KYOKA); // baixa a guarda
aizen.isSneaking = false;
aizen.setDynamicProperty("mv:block_end", 0);
aizen.setDynamicProperty("mv:cd_block", undefined);
advanceTicks(45, "zera-janela-2");
pedra.setType("minecraft:air");
await tapSneak(aizen);
await tapSneak(aizen);
check("bloco destruído: não teleporta e avisa", Math.abs(aizen.location.x - 8000) < 0.01 &&
  log.worldMessages.some((m) => m.to === "AizenPlayer" && m.message.includes("não existe mais")));
noNewErrors("agachar duplo sem erro", mark);

scenario("Illusion's Mastery: só funciona em quem viu a Kyōka");
mark = errors.length;
const intocado = createDummy("Intocado", { x: 8000, y: 64, z: 8006 }, 50000);
aizen.teleport({ x: 8000, y: 64, z: 8000 });
aim(aizen, intocado);
useItem(aizen, "aizen:illusions_mastery");
advanceTicks(2, "mastery-sem-marca");
check("alvo sem a marca: recusa", clonesOf().length === 0);
check("e não gasta o cooldown", aizen.getDynamicProperty("mv:cd_aizen_illusions_mastery") === undefined);
check(
  "explica que precisa acertar com a m1",
  log.worldMessages.some((m) => m.to === "AizenPlayer" && m.message.includes("nunca viu a Kyōka"))
);
aizen._view = { x: 0, y: 1, z: 0 }; // olhando pro céu
useItem(aizen, "aizen:illusions_mastery");
check("sem ninguém na mira: recusa sem gastar", aizen.getDynamicProperty("mv:cd_aizen_illusions_mastery") === undefined);
intocado.kill();
noNewErrors("recusas sem erro", mark);

scenario("Illusion's Mastery: invisível + 3 clones em triângulo em volta do alvo");
mark = errors.length;
fullHp(hinamori);
aizen.teleport({ x: 8000, y: 64, z: 8000 });
hinamori.teleport({ x: 8004, y: 64, z: 8000 });
aim(aizen, hinamori);
let linhasAntes = log.worldMessages.length;
useItem(aizen, "aizen:illusions_mastery");
advanceTicks(3, "mastery");
noNewErrors("Illusion's Mastery sem erro", mark);
let clones = clonesOf();
check("3 clones", clones.length === 3, `${clones.length}`);
check("cada clone leva o nome do Aizen", clones.every((c) => c.nameTag === "AizenPlayer"), clones.map((c) => c.nameTag).join(","));
check(
  "em triângulo em volta do alvo",
  clones.every((c) => Math.abs(Math.hypot(c.location.x - 8004, c.location.z - 8000) - AIZEN_CFG.mastery.radius) < 0.05),
  clones.map((c) => Math.hypot(c.location.x - 8004, c.location.z - 8000).toFixed(2)).join(",")
);
check("Aizen invisível", !!aizen.getEffect("invisibility"));
check("sem o nome em cima da cabeça", aizen.nameTag === "");
check("a Kyōka na mão fica invisível (textura vazia)", inv(aizen).getItem(0)?.typeId === KYOKA_OCULTA, inv(aizen).getItem(0)?.typeId);
hinamori.teleport({ x: 8010, y: 64, z: 8006 });
advanceTicks(2, "alvo-anda");
clones = clonesOf();
check(
  "os clones seguem o alvo",
  clones.every((c) => Math.abs(Math.hypot(c.location.x - 8010, c.location.z - 8006) - AIZEN_CFG.mastery.radius) < 0.05)
);
advanceTicks(10, "trava-itens");
check("o loop de itens mantém a Kyōka oculta no slot 0", inv(aizen).getItem(0)?.typeId === KYOKA_OCULTA);

scenario("Illusion's Mastery: acertar um clone custa 50 e ele some");
mark = errors.length;
fullHp(hinamori);
dmgBefore = log.damages.length;
linhasAntes = log.worldMessages.length;
const awkHinamori = hinamori.getDynamicProperty(DP.awakening) ?? 0;
hitWith(hinamori, clones[0], ichigoM1);
advanceTicks(3, "acertou-clone");
noNewErrors("acertar clone sem erro", mark);
check("o clone some", clonesOf().length === 2, `${clonesOf().length}`);
check(
  "quem acertou toma 50",
  log.damages.slice(dmgBefore).some((d) => d.target === "Hinamori" && virtualDamage(hinamori, d) === 50 && d.by === "AizenPlayer"),
  JSON.stringify(log.damages.slice(dmgBefore))
);
check("o clone não leva dano nenhum", !log.damages.slice(dmgBefore).some((d) => d.target === "aizen:clone"));
check("sem fala no chat (\"Errou...\" foi removido)", aizenLines(linhasAntes).length === 0);
check("bater na ilusão não enche o medidor", (hinamori.getDynamicProperty(DP.awakening) ?? 0) === awkHinamori);
check("com clone sobrando o Aizen continua invisível", !!aizen.getEffect("invisibility"));
// area de skill passa direto pelo clone
dmgBefore = log.damages.length;
hinamori.teleport({ x: 8010, y: 64, z: 8006 });
useItem(hinamori, "ichigo:getsuga_slam");
advanceTicks(5, "slam-nos-clones");
check("skill em área não derruba clone", clonesOf().length === 2);

scenario("Illusion's Mastery: m1 do Aizen no alvo = 300 + lentidão e a ilusão cai");
mark = errors.length;
fullHp(hinamori);
dmgBefore = log.damages.length;
linhasAntes = log.worldMessages.length;
const somAntes = log.sounds.length;
hitWith(aizen, hinamori, KYOKA_OCULTA);
advanceTicks(10, "golpe-da-ilusao");
noNewErrors("golpe da ilusão sem erro", mark);
check(
  "300 de dano",
  log.damages.slice(dmgBefore).some((d) => d.target === "Hinamori" && virtualDamage(hinamori, d) === 300),
  JSON.stringify(log.damages.slice(dmgBefore))
);
check("lentidão no alvo", hinamori.getEffect("slowness")?.amplifier === AIZEN_CFG.mastery.strikeSlownessAmplifier);
check("os clones somem", clonesOf().length === 0);
check("o Aizen volta a aparecer", !aizen.getEffect("invisibility"));
check("com o nome de volta", aizen.nameTag === "AizenPlayer", aizen.nameTag);
check("e a Kyōka de verdade na mão", inv(aizen).getItem(0)?.typeId === KYOKA, inv(aizen).getItem(0)?.typeId);
check("sem fala no chat (\"Tolo...\" foi removido)", aizenLines(linhasAntes).length === 0);
const vidros = log.sounds.slice(somAntes).filter((s) => s.soundId === "random.glass" && s.by);
check(
  "a Kyōka quebra: vidro pra TODOS os players",
  world.getPlayers().every((p) => vidros.some((s) => s.by === p.name)),
  `${new Set(vidros.map((s) => s.by)).size}/${world.getPlayers().length} players`
);
check(
  "o quebrar tem camadas (vidro + ametista)",
  log.sounds.slice(somAntes).some((s) => s.soundId === "break.amethyst_block") &&
    log.sounds.slice(somAntes).some((s) => s.soundId === "chime.amethyst_block")
);
hinamori.removeEffect("slowness");

scenario("Illusion's Mastery: acertar os 3 clones tira a invisibilidade");
mark = errors.length;
fullHp(hinamori);
aizen.teleport({ x: 8000, y: 64, z: 8000 });
hinamori.teleport({ x: 8004, y: 64, z: 8000 });
aizen.setDynamicProperty("mv:cd_aizen_illusions_mastery", undefined);
aim(aizen, hinamori);
useItem(aizen, "aizen:illusions_mastery");
advanceTicks(3, "mastery-2");
dmgBefore = log.damages.length;
linhasAntes = log.worldMessages.length;
check(
  "(a ilusão pegou quem ele mirou)",
  clonesOf().every((c) => Math.abs(Math.hypot(c.location.x - hinamori.location.x, c.location.z - hinamori.location.z) - AIZEN_CFG.mastery.radius) < 0.05)
);
for (const clone of clonesOf()) hitWith(hinamori, clone, ichigoM1);
advanceTicks(5, "tres-clones");
noNewErrors("três clones sem erro", mark);
check("150 no total (50 por clone)", log.damages.slice(dmgBefore).filter((d) => d.target === "Hinamori").reduce((n, d) => n + virtualDamage(hinamori, d), 0) === 150);
check("nenhuma fala no chat", aizenLines(linhasAntes).length === 0);
check("o Aizen perde a invisibilidade", !aizen.getEffect("invisibility") && aizen.nameTag === "AizenPlayer");

scenario("Illusion's Mastery: a rede de segurança do damage_sensor");
mark = errors.length;
fullHp(hinamori);
aizen.teleport({ x: 8000, y: 64, z: 8000 });
hinamori.teleport({ x: 8004, y: 64, z: 8000 });
aizen.setDynamicProperty("mv:cd_aizen_illusions_mastery", undefined);
aim(aizen, hinamori);
useItem(aizen, "aizen:illusions_mastery");
advanceTicks(3, "mastery-3");
dmgBefore = log.damages.length;
// só o evento do BP chega (como se o entityHitEntity não disparasse pro clone)
emit("dataDrivenEntityTrigger", { entity: clonesOf()[0], eventId: "aizen:golpeado" });
advanceTicks(4, "sensor");
check("o clone some pelo evento do damage_sensor", clonesOf().length === 2);
check(
  "e cobra os 50 de quem está preso na ilusão",
  log.damages.slice(dmgBefore).filter((d) => d.target === "Hinamori").length === 1,
  JSON.stringify(log.damages.slice(dmgBefore))
);
// os dois caminhos juntos: um golpe só
dmgBefore = log.damages.length;
const alvoDuplo = clonesOf()[0];
hitWith(hinamori, alvoDuplo, ichigoM1);
emit("dataDrivenEntityTrigger", { entity: alvoDuplo, eventId: "aizen:golpeado" });
advanceTicks(4, "sensor-duplo");
check("golpe visto pelos dois caminhos conta uma vez só", log.damages.slice(dmgBefore).filter((d) => d.target === "Hinamori").length === 1);
noNewErrors("sensor sem erro", mark);

scenario("Illusion's Mastery: acaba sozinha e o clone órfão some");
mark = errors.length;
advanceTicks(AIZEN_CFG.mastery.durationTicks, "mastery-tempo");
check("tempo esgotado: clones somem", clonesOf().length === 0);
check("e o Aizen reaparece", !aizen.getEffect("invisibility") && aizen.nameTag === "AizenPlayer");
const orfao = overworld.spawnEntity("aizen:clone", { x: 8050, y: 64, z: 8050 });
advanceTicks(45, "orfao");
check("clone sem dono (mundo recarregado) é removido", !orfao.isValid);
noNewErrors("fim da ilusão sem erro", mark);

scenario("Betrayal of the Illusioner: 5 teleportes pelas costas, m1 dobrado");
mark = errors.length;
fullHp(hinamori);
aizen.teleport({ x: 8000, y: 64, z: 8000 });
hinamori.teleport({ x: 8008, y: 64, z: 8000 });
hinamori._view = { x: -1, y: 0, z: 0 }; // olhando pro Aizen (-x): as costas ficam em +x
aim(aizen, hinamori);
const tpAntes = log.teleports.length;
useItem(aizen, "aizen:betrayal_of_the_illusioner");
advanceTicks(1, "betrayal-1");
check("olhando reto pro alvo (não pra cima)", aimsLevelAt(aizen, hinamori), JSON.stringify(aizen.getRotation()));
check(
  "o primeiro já aparece nas costas do alvo",
  aizen.location.x > hinamori.location.x && Math.abs(aizen.location.x - hinamori.location.x - AIZEN_CFG.betrayal.behind) < 0.05,
  `aizen.x=${aizen.location.x.toFixed(2)} alvo.x=${hinamori.location.x}`
);
dmgBefore = log.damages.length;
hitWith(aizen, hinamori, KYOKA);
check(
  "m1 dobrado durante o Betrayal (240)",
  log.damages.slice(dmgBefore).some((d) => d.target === "Hinamori" && virtualDamage(hinamori, d) === 240),
  JSON.stringify(log.damages.slice(dmgBefore))
);
// o alvo vira: o proximo teleporte segue as costas novas
hinamori._view = { x: 0, y: 0, z: 1 };
advanceTicks(20, "betrayal-2");
check(
  "cada teleporte segue as costas de agora",
  aizen.location.z < hinamori.location.z && Math.abs(aizen.location.x - hinamori.location.x) < 0.05,
  JSON.stringify(aizen.location)
);
advanceTicks(70, "betrayal-resto");
const saltos = log.teleports.slice(tpAntes).filter((t) => t.target === "AizenPlayer");
check("5 teleportes, 1s entre eles", saltos.length === 5 && saltos[1].tick - saltos[0].tick === 20 && saltos[4].tick - saltos[0].tick === 80, saltos.map((t) => t.tick).join(","));
advanceTicks(20, "betrayal-janela");
fullHp(hinamori);
dmgBefore = log.damages.length;
hitWith(aizen, hinamori, KYOKA);
check("passada a janela o m1 volta a 120", log.damages.slice(dmgBefore).some((d) => d.target === "Hinamori" && virtualDamage(hinamori, d) === 120));
noNewErrors("Betrayal sem erro", mark);

scenario("Bakudō #61: Rikujōkōrō paralisa por 5s");
mark = errors.length;
fullHp(hinamori);
hinamori.removeEffect("slowness");
aizen.teleport({ x: 8000, y: 64, z: 8000 });
hinamori.teleport({ x: 8006, y: 64, z: 8000 });
aim(aizen, hinamori);
linhasAntes = log.worldMessages.length;
const luzAntes = log.particles.length;
useItem(aizen, "aizen:bakudo_61");
advanceTicks(5, "bakudo");
noNewErrors("Bakudō sem erro", mark);
check(
  "anuncia a skill sem fala",
  aizenLines(linhasAntes).length === 0 &&
    log.worldMessages.slice(linhasAntes).some((m) => m.message.includes("Bakudō #61: Rikujōkōrō"))
);
check("alvo paralisado (lentidão máxima)", hinamori.getEffect("slowness")?.amplifier === 255);
// jump_boost 128 fazia o player voar no Bedrock atual: o pulo e travado pela permissao
check("sem jump_boost (o pulo gigante)", !hinamori.getEffect("jump_boost"));
check("pulo travado pela permissão de input", hinamori.inputPermissions.isPermissionCategoryEnabled(6) === false);
check(
  "seis barras de luz desenhadas",
  log.particles.slice(luzAntes).filter((p) => p.particleId === "aizen:luz").length >= 36,
  `${log.particles.slice(luzAntes).filter((p) => p.particleId === "aizen:luz").length}`
);
linhasAntes = log.worldMessages.length;
useItem(hinamori, "ichigo:getsuga_slash");
check(
  "paralisado não usa skill",
  log.worldMessages.slice(linhasAntes).some((m) => m.to === "Hinamori" && m.message.includes("paralisado"))
);
advanceTicks(100, "bakudo-fim");
check("depois de 5s a paralisia solta", !hinamori.getEffect("slowness"));
check("e o pulo volta", hinamori.inputPermissions.isPermissionCategoryEnabled(6) === true);

scenario("Fool's Trick: awakening falso, e 3s depois o corte pelas costas");
mark = errors.length;
fullHp(hinamori);
const naoMarcado = createDummy("NaoMarcado", { x: 8000, y: 64, z: 8005 }, 50000);
aizen.teleport({ x: 8000, y: 64, z: 8000 });
aim(aizen, naoMarcado);
useItem(aizen, "aizen:fools_trick");
check("alvo sem a marca: recusa sem gastar", aizen.getDynamicProperty("mv:cd_aizen_fools_trick") === undefined);
naoMarcado.kill();
hinamori.teleport({ x: 8008, y: 64, z: 8000 });
hinamori._view = { x: -1, y: 0, z: 0 };
aim(aizen, hinamori);
linhasAntes = log.worldMessages.length;
const somTrick = log.sounds.length;
useItem(aizen, "aizen:fools_trick");
advanceTicks(2, "trick-inicio");
check(
  "o awakening falso sai como anúncio de awakening (não como fala)",
  aizenLines(linhasAntes).length === 0 &&
    log.worldMessages.slice(linhasAntes).some((m) => m.message.includes("despertou: AWAKENING: Hadō 99: Goryūtenmetsu"))
);
check("com um barulho alto", log.sounds.slice(somTrick).some((s) => s.soundId === "mob.wither.spawn" && s.options?.volume >= 3));
check("durante a carga ele ainda não se mexeu", Math.abs(aizen.location.x - 8000) < 0.01);
dmgBefore = log.damages.length;
advanceTicks(60, "trick-revela");
check("3s depois: atrás do alvo", aizen.location.x > hinamori.location.x, `aizen.x=${aizen.location.x.toFixed(2)}`);
check("e olhando reto pro alvo", aimsLevelAt(aizen, hinamori), JSON.stringify(aizen.getRotation()));
check("alvo paralisado", hinamori.getEffect("slowness")?.amplifier === 255);
check("sem fala no chat (\"Achou mesmo...\" foi removido)", aizenLines(linhasAntes).length === 0);
advanceTicks(12, "trick-corte");
check(
  "o corte: 400 de dano",
  log.damages.slice(dmgBefore).some((d) => d.target === "Hinamori" && virtualDamage(hinamori, d) === 400),
  JSON.stringify(log.damages.slice(dmgBefore))
);
check("e náusea por 4s", (hinamori.getEffect("nausea")?.endTick ?? 0) - system.currentTick > 60);
noNewErrors("Fool's Trick sem erro", mark);
advanceTicks(40, "trick-solta");

scenario("Counter: 5 m1 em 3s no Aizen");
mark = errors.length;
fullHp(hinamori);
fullHp(aizen);
hinamori.removeEffect("slowness");
hinamori.removeEffect("jump_boost");
advanceTicks(20, "counter-prep");
aizen.teleport({ x: 8000, y: 64, z: 8000 });
hinamori.teleport({ x: 8002, y: 64, z: 8000 });
hinamori._view = { x: -1, y: 0, z: 0 };
const vidaCheia = virtualHp(aizen);
linhasAntes = log.worldMessages.length;
for (let i = 0; i < 4; i++) {
  hitWith(hinamori, aizen, ichigoM1);
  advanceTicks(4, "combo");
}
const vidaNoCombo = virtualHp(aizen);
check("os 4 primeiros golpes entram", vidaNoCombo < vidaCheia - 60, `${vidaCheia} -> ${vidaNoCombo}`);
hitWith(hinamori, aizen, ichigoM1);
advanceTicks(2, "counter");
noNewErrors("Counter sem erro", mark);
check("sem fala no chat (\"Você vencer...\" foi removido)", aizenLines(linhasAntes).length === 0);
check("recupera toda a vida perdida no combo", Math.abs(virtualHp(aizen) - vidaCheia) < 1, `${vidaCheia} -> ${virtualHp(aizen)}`);
check("aparece atrás do atacante", aizen.location.x > hinamori.location.x, `aizen.x=${aizen.location.x.toFixed(2)}`);
check("e olhando reto pro atacante", aimsLevelAt(aizen, hinamori), JSON.stringify(aizen.getRotation()));
check("atacante paralisado", hinamori.getEffect("slowness")?.amplifier === 255);
dmgBefore = log.damages.length;
hitWith(hinamori, aizen, ichigoM1);
check("paralisado não bate (a brecha pro ataque)", !log.damages.slice(dmgBefore).some((d) => d.target === "AizenPlayer"));
advanceTicks(70, "counter-solta");
// golpes espaçados demais nao contam
const tpAntesEspacado = log.teleports.length;
for (let i = 0; i < 5; i++) {
  hitWith(hinamori, aizen, ichigoM1);
  advanceTicks(20, "golpe-espacado");
}
check("5 golpes em mais de 3s não disparam", !log.teleports.slice(tpAntesEspacado).some((t) => t.target === "AizenPlayer"));
// quem nunca viu a Kyoka nao cai no Counter
const estranho = createPlayer("Estranho", { x: 8003, y: 64, z: 8000 });
emit("playerSpawn", { player: estranho, initialSpawn: true });
advanceTicks(10, "spawn-estranho");
await pickCharacter(estranho, "ichigo");
advanceTicks(20, "ativar-estranho");
const tpAntesEstranho = log.teleports.length;
for (let i = 0; i < 5; i++) {
  hitWith(estranho, aizen, ichigoM1);
  advanceTicks(3, "golpe-estranho");
}
check("quem nunca foi marcado não é afetado pelo Counter", !log.teleports.slice(tpAntesEstranho).some((t) => t.target === "AizenPlayer"));
noNewErrors("Counter (casos negativos) sem erro", mark);

scenario("Awakening: Hadō #90 Kurohitsugi");
mark = errors.length;
fullHp(aizen);
aizen.teleport({ x: 8200, y: 64, z: 8200 });
const caixao = createDummy("Caixao", { x: 8206, y: 64, z: 8200 }, 500000);
const vizinho = createDummy("Vizinho", { x: 8208, y: 64, z: 8202 }, 500000);
const deFora = createDummy("DeFora", { x: 8214, y: 64, z: 8200 }, 500000);
estranho.teleport({ x: 8300, y: 64, z: 8300 });
hinamori.teleport({ x: 8300, y: 64, z: 8310 });
// sem medidor: a tecla vira guarda
aizen.setDynamicProperty(DP.awakening, 40);
aim(aizen, caixao);
aizen.isSneaking = true;
useItem(aizen, KYOKA);
aizen.isSneaking = false;
check("sem 100% a Kurohitsugi não sai (a tecla vira guarda)", aizen.getDynamicProperty("mv:block_end") > 0 && aizen.getDynamicProperty(DP.awakening) === 40);
aizen.isSneaking = true;
useItem(aizen, KYOKA);
aizen.isSneaking = false;
aizen.setDynamicProperty("mv:block_end", 0);
aizen.setDynamicProperty("mv:cd_block", undefined);
// sem ninguem na mira: tambem cai pra guarda e nao gasta o medidor
aizen.setDynamicProperty(DP.awakening, 100);
aizen._view = { x: 0, y: 1, z: 0 };
aizen.isSneaking = true;
useItem(aizen, KYOKA);
aizen.isSneaking = false;
check("sem alvo na mira não gasta o medidor", aizen.getDynamicProperty(DP.awakening) === 100);
aizen.isSneaking = true;
useItem(aizen, KYOKA);
aizen.isSneaking = false;
aizen.setDynamicProperty("mv:block_end", 0);
aizen.setDynamicProperty("mv:cd_block", undefined);

aim(aizen, caixao);
linhasAntes = log.worldMessages.length;
const particulasAntesCaixa = log.particles.length;
const blocosAntesCaixa = log.blocks.length;
dmgBefore = log.damages.length;
aizen.isSneaking = true;
useItem(aizen, KYOKA);
aizen.isSneaking = false;
advanceTicks(12, "caixa-sobe");
check(
  "anuncia a Kurohitsugi sem fala",
  aizenLines(linhasAntes).length === 0 &&
    log.worldMessages.slice(linhasAntes).some((m) => m.message.includes("Hadō #90: Kurohitsugi"))
);
check("consome o medidor", aizen.getDynamicProperty(DP.awakening) === 0);
const pretos = log.blocks.slice(blocosAntesCaixa).filter((b) => b.typeId === "minecraft:black_concrete");
check("caixa 10x10x10 de concreto preto (488 blocos de casca)", pretos.length === 488, `${pretos.length}`);
const xs = pretos.map((b) => b.location.x);
check("10 de largura em volta do alvo", Math.max(...xs) - Math.min(...xs) === 9 && Math.min(...xs) <= 8206 && Math.max(...xs) >= 8206);
const paredeEvt = { block: overworld.getBlock(pretos[0].location), dimension: overworld, player: estranho, cancel: false };
world.beforeEvents.playerBreakBlock._emit(paredeEvt);
check("a parede da caixa não pode ser quebrada", paredeEvt.cancel === true);
const auraRoxa = log.particles
  .slice(particulasAntesCaixa)
  .filter((p) => p.particleId === "aizen:reiatsu" && (p.location.x < 8201 || p.location.x > 8211 || p.location.y > 72)).length;
check("aura roxa em volta da caixa", auraRoxa > 100, `${auraRoxa}`);
advanceTicks(110, "estocadas");
noNewErrors("Kurohitsugi sem erro", mark);
const golpesCaixao = log.damages.slice(dmgBefore).filter((d) => d.target === "Caixao" && d.by === "AizenPlayer");
const totalCaixao = golpesCaixao.reduce((n, d) => n + d.amount, 0);
check("50 ataques de 50 = 2500 em quem está dentro", totalCaixao === 2500, `${totalCaixao} em ${golpesCaixao.length} rajadas`);
check("pega todo mundo lá dentro", log.damages.slice(dmgBefore).filter((d) => d.target === "Vizinho").reduce((n, d) => n + d.amount, 0) === 2500);
check("quem está fora da caixa não toma", !log.damages.slice(dmgBefore).some((d) => d.target === "DeFora"));
check("o Aizen não se machuca", !log.damages.slice(dmgBefore).some((d) => d.target === "AizenPlayer"));
check(
  "lanças negras nas estocadas",
  log.particles.some((p) => p.particleId === "aizen:lanca")
);
const restauradosCaixa = log.blocks.slice(blocosAntesCaixa).filter((b) => b.typeId === "minecraft:air");
check("acabados os ataques a caixa some (tudo restaurado)", restauradosCaixa.length === 488, `${restauradosCaixa.length}`);
check("e o bloco volta a ser o que era", overworld.getBlock(pretos[0].location).typeId === "minecraft:air");
for (const d of [caixao, vizinho, deFora]) d.kill();

scenario("Aizen: teleporte pelas costas nunca entra em bloco");
mark = errors.length;
advanceTicks(100, "solta-paralisias");
fullHp(hinamori);
hinamori.teleport({ x: 8100.5, y: 64, z: 8100.5 });
hinamori._view = { x: -1, y: 0, z: 0 }; // costas pro +x
for (const x of [8101, 8102]) {
  for (const y of [64, 65]) overworld.getBlock({ x, y, z: 8100 }).setType("minecraft:stone");
}
aizen.teleport({ x: 8090, y: 64, z: 8100.5 });
aim(aizen, hinamori);
aizen.setDynamicProperty("mv:cd_aizen_betrayal_of_the_illusioner", undefined);
useItem(aizen, "aizen:betrayal_of_the_illusioner");
advanceTicks(1, "betrayal-parede");
const pes = overworld.getBlock(aizen.location);
check(
  "parede nas costas: aparece de lado, fora do bloco",
  pes.isAir && pes.above().isAir,
  `${JSON.stringify(aizen.location)} em ${pes.typeId}`
);
advanceTicks(100, "betrayal-parede-fim");
for (const x of [8101, 8102]) {
  for (const y of [64, 65]) overworld.getBlock({ x, y, z: 8100 }).setType("minecraft:air");
}
hinamori.nameTag = ""; // como se tivesse saído do jogo invisível
emit("playerSpawn", { player: hinamori, initialSpawn: true });
advanceTicks(5, "rejoin-nome");
check("quem volta ao mundo sem nome recupera o nome", hinamori.nameTag === "Hinamori", JSON.stringify(hinamori.nameTag));
noNewErrors("teleporte e rejoin sem erro", mark);

scenario("Aizen: desativar no meio da ilusão não deixa nada pendurado");
mark = errors.length;
fullHp(hinamori);
aizen.teleport({ x: 8000, y: 64, z: 8000 });
hinamori.teleport({ x: 8004, y: 64, z: 8000 });
hinamori.removeEffect("slowness");
aizen.setDynamicProperty("mv:cd_aizen_illusions_mastery", undefined);
aim(aizen, hinamori);
useItem(aizen, "aizen:illusions_mastery");
advanceTicks(3, "mastery-desativar");
check("(ilusão de pé)", clonesOf().length === 3 && aizen.nameTag === "");
queueFormResponse(deactivateButtonIndex());
useItem(aizen, "multiversal:character_selector");
await settleForms();
advanceTicks(20, "desativar-aizen");
noNewErrors("desativar o Aizen sem erro", mark);
check("clones removidos", clonesOf().length === 0);
check("visível e com nome", !aizen.getEffect("invisibility") && aizen.nameTag === "AizenPlayer");
check(
  "nenhuma Kyōka (nem a oculta) sobra no inventário",
  !inv(aizen).slots.some((i) => i && isKyokaId(i.typeId)),
  JSON.stringify(inv(aizen).slots.filter(Boolean).map((i) => i.typeId))
);
function isKyokaId(id) {
  return id === KYOKA || id === KYOKA_OCULTA;
}
check(
  "o Aizen (Captain's Fight) não fala nada no chat",
  !log.worldMessages.some((m) => m.message.includes("<AizenPlayer>"))
);
estranho.kill();

/* ================= Daiguren Hyōrinmaru: asas e cauda de partícula ================= */

scenario("Daiguren Hyōrinmaru: asas e cauda de partícula, sem modelo");
mark = errors.length;
const toshiro = createPlayer("ToshiroPlayer", { x: 9500, y: 64, z: 9500 });
emit("playerSpawn", { player: toshiro, initialSpawn: true });
advanceTicks(20, "spawn-toshiro");
await pickCharacter(toshiro, "hitsugaya");
advanceTicks(20, "ativar-toshiro");
toshiro.setDynamicProperty(DP.awakening, 100);
let linhasToshiro = log.worldMessages.length;
toshiro.isSneaking = true;
useItem(toshiro, "hitsugaya:m1_hyorinmaru");
toshiro.isSneaking = false;
const geloAntes = log.particles.length;
advanceTicks(30, "bankai-toshiro");
noNewErrors("Bankai sem erro", mark);
check("Bankai ativa", toshiro.getDynamicProperty(DP.awakened) === true);
check(
  "não veste peitoral nenhum (o modelo saiu)",
  !toshiro.getComponent("minecraft:equippable").getEquipment("Chest"),
  String(toshiro.getComponent("minecraft:equippable").getEquipment("Chest")?.typeId)
);
check(
  "não manda a mensagem da hollowficação do Vizard",
  !log.worldMessages.slice(linhasToshiro).some((m) => m.to === "ToshiroPlayer" && m.message.includes("hollowficação"))
);
check(
  "asas e cauda de partícula de gelo",
  log.particles.slice(geloAntes).filter((p) => p.particleId === "hitsugaya:gelo").length > 20
);
toshiro.setDynamicProperty(DP.awakening, 2);
advanceTicks(80, "bankai-acaba");
check("Bankai acabou", toshiro.getDynamicProperty(DP.awakened) === false);
noNewErrors("fim da Bankai sem erro", mark);
queueFormResponse(deactivateButtonIndex());
useItem(toshiro, "multiversal:character_selector");
await settleForms();
advanceTicks(10, "desativar-toshiro");
toshiro.kill();

/* ================= Sousuke Aizen (Hōgyoku) ================= */

const HOGY = game.HOGYOKU;
const HOGY_CHAR = game.CHARACTERS.aizen_hogyoku;
function hogyLines(since) {
  return log.worldMessages.slice(since).filter((m) => m.to === "*" && m.message.includes("<HogyokuPlayer>"));
}
function evoBonus(p) {
  return 1 + Math.floor((p.getDynamicProperty("mv:evolution") ?? 0) / 20) * 0.05;
}
function pickIllusion(p, index) {
  p.isSneaking = true;
  queueFormResponse(index);
  useItem(p, "aizen:illusions");
  p.isSneaking = false;
}
function hogyokuClones() {
  return overworld.getEntities({ type: "aizen:clone" });
}

scenario("Sousuke Aizen (Hōgyoku): ativação (Híbrido, Tier 7)");
mark = errors.length;
const hogy = createPlayer("HogyokuPlayer", { x: 12000, y: 64, z: 12000 });
const gin = createPlayer("GinAlvo", { x: 12006, y: 64, z: 12000 });
emit("playerSpawn", { player: hogy, initialSpawn: true });
emit("playerSpawn", { player: gin, initialSpawn: true });
advanceTicks(20, "spawn-hogyoku");
check("registro: Híbrido, Tier 7", RACE_TIER.aizen_hogyoku?.race === "hybrid" && RACE_TIER.aizen_hogyoku?.tier === 7);
await pickCharacter(hogy, "aizen_hogyoku");
await pickCharacter(gin, "kenpachi");
advanceTicks(20, "ativar-hogyoku");
noNewErrors("ativar o Aizen Hōgyoku sem erro", mark);
check("vida maxima 7000", virtualMax(hogy) === 7000, `${virtualMax(hogy)}`);
check(
  "Kyōka, Illusions, Kurohitsugi e Fragor nos slots 0-3",
  JSON.stringify(slotIds(hogy, 4)) === JSON.stringify([0, 1, 2, 3].map((i) => HOGY_CHAR.items[i])),
  JSON.stringify(slotIds(hogy, 4))
);
check("começa com Evolution 0%", (hogy.getDynamicProperty("mv:evolution") ?? 0) === 0);
advanceTicks(10, "actionbar");
const barraHogy = log.actionBars.filter((a) => a.player === "HogyokuPlayer").pop()?.text ?? "";
check("a barra mostra \"Evolution\" no lugar de \"Awakening\"", barraHogy.includes("Evolution: 0%") && !barraHogy.includes("Awakening"), barraHogy);

scenario("Hōgyoku: Kyōka de 160 que também marca");
mark = errors.length;
hogy.teleport({ x: 12000, y: 64, z: 12000 });
gin.teleport({ x: 12002, y: 64, z: 12000 });
dmgBefore = log.damages.length;
hitWith(hogy, gin, "aizen:m1_kyoka_suigetsu");
check(
  "160 de dano",
  log.damages.slice(dmgBefore).some((d) => d.target === "GinAlvo" && virtualDamage(gin, d) === 160),
  JSON.stringify(log.damages.slice(dmgBefore))
);
check("marca o alvo", gin.getDynamicProperty("mv:kyoka_mark") === true);
noNewErrors("m1 sem erro", mark);

scenario("Hōgyoku: cura 100 a cada 4s e Evolution +10% a cada 30s");
mark = errors.length;
setVirtualHp(hogy, 5000);
advanceTicks(81, "cura-hogyoku");
check("curou 100 em 4s", HOGY.regen.base === 100 && Math.round(virtualHp(hogy)) === 5100, `${virtualHp(hogy)}`);
hogy.setDynamicProperty("mv:evolution", 0);
advanceTicks(620, "evolution-30s");
check("30s depois: Evolution 10%", hogy.getDynamicProperty("mv:evolution") === 10, String(hogy.getDynamicProperty("mv:evolution")));
hogy.setDynamicProperty("mv:evolution", 40); // dois degraus de 20%
setVirtualHp(hogy, 5000);
advanceTicks(81, "cura-evoluida");
check("cada 20% soma 20 na cura (40% = 140)", Math.round(virtualHp(hogy)) === 5140, `${virtualHp(hogy)}`);
dmgBefore = log.damages.length;
hitWith(hogy, gin, "aizen:m1_kyoka_suigetsu");
check(
  "cada 20% soma 5% no dano (40% = 160 x1.1)",
  log.damages.slice(dmgBefore).some((d) => d.target === "GinAlvo" && Math.abs(virtualDamage(gin, d) - 176) < 0.6),
  JSON.stringify(log.damages.slice(dmgBefore).map((d) => virtualDamage(gin, d)))
);
hogy.setDynamicProperty("mv:evolution", 0);
noNewErrors("Evolution sem erro", mark);

scenario("Hōgyoku: item Illusions — agachar abre o menu, usar lança");
mark = errors.length;
let formsAntes = shownForms.length;
pickIllusion(hogy, 2);
await settleForms();
const menuIlusoes = shownForms[formsAntes];
check("agachar + usar abre o menu com as 3 ilusões", menuIlusoes?.buttons.length === 3, JSON.stringify(menuIlusoes?.buttons));
check(
  "Switch, False Skill e Kanzen Saimin, com o cooldown de cada",
  ["Switch", "False Skill", "Kanzen Saimin"].every((n, i) => menuIlusoes?.buttons[i]?.includes(n)) &&
    menuIlusoes.buttons[0].includes("30s") && menuIlusoes.buttons[1].includes("25s") && menuIlusoes.buttons[2].includes("45s"),
  JSON.stringify(menuIlusoes?.buttons)
);
check("escolha salva", hogy.getDynamicProperty("mv:aizen_illusion") === 2);
const naoMarcadoH = createDummy("NaoMarcadoH", { x: 12000, y: 64, z: 12005 }, 50000);
hogy.teleport({ x: 12000, y: 64, z: 12000 });
aim(hogy, naoMarcadoH);
useItem(hogy, "aizen:illusions");
check("alvo sem a marca: recusa sem gastar", hogy.getDynamicProperty("mv:cd_aizen_illusions.kanzen_saimin") === undefined);
naoMarcadoH.kill();
noNewErrors("menu sem erro", mark);

scenario("Hōgyoku — Switch: o clone fica atrás do alvo e troca de lugar com o Aizen");
mark = errors.length;
pickIllusion(hogy, 0);
await settleForms();
hogy.teleport({ x: 12000, y: 64, z: 12000 });
gin.teleport({ x: 12004, y: 64, z: 12000 });
gin._view = { x: -1, y: 0, z: 0 }; // olhando pro Aizen: costas em +x
aim(hogy, gin);
useItem(hogy, "aizen:illusions");
advanceTicks(2, "switch");
let cloneSw = hogyokuClones();
check("um clone", cloneSw.length === 1, `${cloneSw.length}`);
check(
  "atrás do alvo",
  cloneSw[0] && cloneSw[0].location.x > gin.location.x && Math.abs(cloneSw[0].location.x - gin.location.x - HOGY.switch.behind) < 0.05,
  JSON.stringify(cloneSw[0]?.location)
);
fullHp(hogy);
const vidaAntesSwitch = virtualHp(hogy);
const aizenAntes = hogy.location;
dmgBefore = log.damages.length;
hitWith(gin, hogy, "kenpachi:m1_zanpakuto");
advanceTicks(1, "golpe-no-aizen");
check("o golpe no Aizen não conta", !log.damages.slice(dmgBefore).some((d) => d.target === "HogyokuPlayer" && d.amount > 1) && Math.round(virtualHp(hogy)) >= Math.round(vidaAntesSwitch) - 1);
check("o Aizen vai pra trás do alvo", hogy.location.x > gin.location.x, JSON.stringify(hogy.location));
check("olhando reto pro alvo", aimsLevelAt(hogy, gin), JSON.stringify(hogy.getRotation()));
check(
  "e o clone pra frente (onde o Aizen estava)",
  Math.hypot(hogyokuClones()[0].location.x - aizenAntes.x, hogyokuClones()[0].location.z - aizenAntes.z) < 0.05
);
hitWith(gin, hogy, "kenpachi:m1_zanpakuto");
check("toda vez que o alvo tenta bater, troca de novo", hogy.location.x < gin.location.x, JSON.stringify(hogy.location));
advanceTicks(40, "clone-volta");
const somSwitch = log.sounds.length;
hitWith(gin, hogyokuClones()[0], "kenpachi:m1_zanpakuto");
advanceTicks(2, "acertou-clone-switch");
check("acertar o clone desfaz o Switch", hogyokuClones().length === 0);
check("com a Kyōka quebrando pra todos", world.getPlayers().every((p) => log.sounds.slice(somSwitch).some((s) => s.soundId === "random.glass" && s.by === p.name)));
dmgBefore = log.damages.length;
hitWith(gin, hogy, "kenpachi:m1_zanpakuto");
check("depois disso o golpe volta a entrar", log.damages.slice(dmgBefore).some((d) => d.target === "HogyokuPlayer"));
hogy.setDynamicProperty("mv:cd_aizen_illusions.switch", undefined);
useItem(hogy, "aizen:illusions");
advanceTicks(HOGY.switch.durationTicks + 5, "switch-tempo");
check("sozinho, o Switch acaba em 15s", hogyokuClones().length === 0);
noNewErrors("Switch sem erro", mark);

scenario("Hōgyoku — False Skill: finge a skill, não dá dano, aparece atrás e paralisa 1s");
mark = errors.length;
advanceTicks(40, "solta");
pickIllusion(hogy, 1);
await settleForms();
fullHp(gin);
hogy.teleport({ x: 12000, y: 64, z: 12000 });
gin.teleport({ x: 12006, y: 64, z: 12000 });
gin._view = { x: -1, y: 0, z: 0 };
aim(hogy, gin);
dmgBefore = log.damages.length;
let linhasFalse = log.worldMessages.length;
useItem(hogy, "aizen:illusions");
advanceTicks(2, "false-inicio");
check(
  "anuncia uma skill de verdade (Fragor ou o encantamento da Kurohitsugi)",
  log.worldMessages.slice(linhasFalse).some((m) => m.message.includes("Fragor") || m.message.includes("Ó rei das trevas"))
);
advanceTicks(HOGY.falseSkill.hitDelayTicks, "false-acerta");
check("sem dano nenhum", !log.damages.slice(dmgBefore).some((d) => d.by === "HogyokuPlayer"));
check("o Aizen aparece atrás do alvo", hogy.location.x > gin.location.x, JSON.stringify(hogy.location));
check("olhando reto pro alvo", aimsLevelAt(hogy, gin), JSON.stringify(hogy.getRotation()));
check("alvo paralisado", gin.getEffect("slowness")?.amplifier === 255);
advanceTicks(30, "false-solta");
check("por 1 segundo só", !gin.getEffect("slowness"));
noNewErrors("False Skill sem erro", mark);

scenario("Hōgyoku — Kanzen Saimin: invisível, clones em volta, m1 em dobro");
mark = errors.length;
pickIllusion(hogy, 2);
await settleForms();
fullHp(gin);
hogy.teleport({ x: 12000, y: 64, z: 12000 });
gin.teleport({ x: 12006, y: 64, z: 12000 });
aim(hogy, gin);
let linhasKanzen = log.worldMessages.length;
useItem(hogy, "aizen:illusions");
advanceTicks(3, "kanzen");
check(`${HOGY.kanzen.clones} clones em volta do alvo`, hogyokuClones().length === HOGY.kanzen.clones, `${hogyokuClones().length}`);
check(
  "em anel em volta do alvo",
  hogyokuClones().every((c) => Math.abs(Math.hypot(c.location.x - gin.location.x, c.location.z - gin.location.z) - HOGY.kanzen.radius) < 0.05)
);
check("invisível, sem nome e com a Kyōka oculta", !!hogy.getEffect("invisibility") && hogy.nameTag === "" && inv(hogy).getItem(0)?.typeId === "aizen:m1_kyoka_oculta");
check(
  "\"Encontre-me, se puder...\" em roxo",
  hogyLines(linhasKanzen).some((m) => m.message.startsWith("§5") && m.message.includes("Encontre-me, se puder..."))
);
dmgBefore = log.damages.length;
hitWith(gin, hogyokuClones()[0], "kenpachi:m1_zanpakuto");
check("acertar um clone só estoura ele", hogyokuClones().length === HOGY.kanzen.clones - 1 && !log.damages.slice(dmgBefore).some((d) => d.target === "GinAlvo"));
hitWith(hogy, gin, "aizen:m1_kyoka_oculta");
advanceTicks(3, "kanzen-golpe");
check(
  "o primeiro m1 dá o dobro (320)",
  log.damages.slice(dmgBefore).some((d) => d.target === "GinAlvo" && virtualDamage(gin, d) === 320),
  JSON.stringify(log.damages.slice(dmgBefore).map((d) => virtualDamage(gin, d)))
);
check("e desfaz a ilusão", hogyokuClones().length === 0 && !hogy.getEffect("invisibility") && hogy.nameTag === "HogyokuPlayer");
check("a Kyōka volta pra mão", inv(hogy).getItem(0)?.typeId === "aizen:m1_kyoka_suigetsu");
dmgBefore = log.damages.length;
hitWith(hogy, gin, "aizen:m1_kyoka_suigetsu");
check("o segundo m1 já é normal (160)", log.damages.slice(dmgBefore).some((d) => d.target === "GinAlvo" && virtualDamage(gin, d) === 160));
noNewErrors("Kanzen Saimin sem erro", mark);

scenario("Hōgyoku — Kurohitsugi encantada: caixa maior, 40 ataques de 90");
mark = errors.length;
hogy.teleport({ x: 12300, y: 64, z: 12300 });
gin.teleport({ x: 12600, y: 64, z: 12600 });
const presoH = createDummy("PresoH", { x: 12308, y: 64, z: 12300 }, 500000);
const vizinhoH = createDummy("VizinhoH", { x: 12312, y: 64, z: 12303 }, 500000);
aim(hogy, presoH);
let linhasCaixa = log.worldMessages.length;
const blocosCaixaH = log.blocks.length;
dmgBefore = log.damages.length;
useItem(hogy, "aizen:kurohitsugi_encantado");
advanceTicks(14, "caixa-h");
check(
  "o encantamento inteiro, em roxo",
  hogyLines(linhasCaixa).some((m) => m.message.startsWith("§5") && m.message.includes(HOGY.chant))
);
const pretosH = log.blocks.slice(blocosCaixaH).filter((b) => b.typeId === "minecraft:black_concrete");
const ladoH = HOGY.kurohitsugi.size;
check(`caixa ${ladoH}x${ladoH}x${ladoH}`, pretosH.length === ladoH ** 3 - (ladoH - 2) ** 3, `${pretosH.length}`);
advanceTicks(100, "estocadas-h");
const totalH = log.damages.slice(dmgBefore).filter((d) => d.target === "PresoH").reduce((n, d) => n + d.amount, 0);
check("40 x 90 = 3600", totalH === 3600, `${totalH}`);
check("pega todo mundo lá dentro", log.damages.slice(dmgBefore).filter((d) => d.target === "VizinhoH").reduce((n, d) => n + d.amount, 0) === 3600);
check("a caixa some no fim", log.blocks.slice(blocosCaixaH).filter((b) => b.typeId === "minecraft:air").length === pretosH.length);
presoH.kill();
vizinhoH.kill();
noNewErrors("Kurohitsugi encantada sem erro", mark);

scenario("Hōgyoku — Fragor: a maior explosão do addon, com 30 estilhaços");
mark = errors.length;
hogy.teleport({ x: 12800, y: 64, z: 12800 });
const pertoF = createDummy("PertoF", { x: 12825, y: 64, z: 12800 }, 500000);
const longeF = createDummy("LongeF", { x: 12800, y: 64, z: 12900 }, 500000);
const anelF = [];
for (let i = 0; i < 12; i++) {
  const a = (i / 12) * Math.PI * 2;
  anelF.push(createDummy(`AnelF${i}`, { x: 12800 + Math.cos(a) * 3, y: 64, z: 12800 + Math.sin(a) * 3 }, 500000));
}
dmgBefore = log.damages.length;
const partF = log.particles.length;
useItem(hogy, "aizen:fragor");
advanceTicks(40, "fragor");
check("maior que a Quebramundos do Yammy (raio 26)", HOGY.fragor.radius > 26);
check("1000 em quem está a 25 blocos", log.damages.slice(dmgBefore).some((d) => d.target === "PertoF" && d.amount === 1000));
check("não pega a 100 blocos", !log.damages.slice(dmgBefore).some((d) => d.target === "LongeF"));
check("o Aizen não se machuca", !log.damages.slice(dmgBefore).some((d) => d.target === "HogyokuPlayer"));
const estilhacosF = log.damages.slice(dmgBefore).filter((d) => d.target.startsWith("AnelF") && d.amount === 100);
check("os estilhaços acertam de 100", estilhacosF.length >= 1, `${estilhacosF.length} estilhaços`);
check("explosão e estilhaços roxos", log.particles.slice(partF).some((p) => p.particleId === "aizen:explosao") && log.particles.slice(partF).some((p) => p.particleId === "aizen:fragmento"));
for (const d of [pertoF, longeF, ...anelF]) d.kill();
noNewErrors("Fragor sem erro", mark);

scenario("Hōgyoku: Evolution 100% → casulo de 5s → Monster Aizen");
mark = errors.length;
hogy.teleport({ x: 13000.3, y: 64, z: 13000.7 });
setVirtualHp(hogy, 6000);
hogy.setDynamicProperty("mv:evolution", 100);
const blocosCasulo = log.blocks.length;
let linhasMeta = log.worldMessages.length;
advanceTicks(21, "casulo");
const brancos = log.blocks.slice(blocosCasulo).filter((b) => b.typeId === "minecraft:white_concrete");
check("fecha um casulo de blocos em volta dele", brancos.length === 34, `${brancos.length}`);
check("preso dentro (paralisado)", hogy.getEffect("slowness")?.amplifier === 255);
const casca = { block: overworld.getBlock(brancos[0].location), dimension: overworld, player: gin, cancel: false };
world.beforeEvents.playerBreakBlock._emit(casca);
check("o casulo não pode ser quebrado", casca.cancel === true);
check("ainda não é o Monster", hogy.getDynamicProperty(DP.awakened) !== true);
advanceTicks(HOGY.cocoonTicks, "casulo-abre");
noNewErrors("casulo e Metamorfose sem erro", mark);
check("5s depois o casulo abre", log.blocks.slice(blocosCasulo).filter((b) => b.typeId === "minecraft:air").length === 34);
check("e ele sai na Metamorfose", hogy.getDynamicProperty(DP.awakened) === true);
check("\"Aizen atingiu sua Metamorfose...\" pra todos", log.worldMessages.slice(linhasMeta).some((m) => m.to === "*" && m.message.includes("Aizen atingiu sua Metamorfose...")));
check("vida maxima 8000", virtualMax(hogy) === 8000, `${virtualMax(hogy)}`);
check(
  "Fragor Barrage e UltraFragor no lugar da Kurohitsugi e do Fragor",
  inv(hogy).getItem(2)?.typeId === "aizen:fragor_barrage" && inv(hogy).getItem(3)?.typeId === "aizen:ultra_fragor",
  JSON.stringify(slotIds(hogy, 4))
);
advanceTicks(10, "actionbar-meta");
check("a barra mostra a Metamorfose", (log.actionBars.filter((a) => a.player === "HogyokuPlayer").pop()?.text ?? "").includes("Metamorfose"));

scenario("Monster Aizen: Kyōka em dobro, cura 200, não drena");
mark = errors.length;
hogy.teleport({ x: 13000, y: 64, z: 13000 });
gin.teleport({ x: 13002, y: 64, z: 13000 });
fullHp(gin);
dmgBefore = log.damages.length;
hitWith(hogy, gin, "aizen:m1_kyoka_suigetsu");
const m1Monster = game.DAMAGE.aizenMonsterM1 * evoBonus(hogy);
check(
  `Kyōka em dobro (320, com a Evolution em 100%: ${m1Monster})`,
  log.damages.slice(dmgBefore).some((d) => d.target === "GinAlvo" && Math.abs(virtualDamage(gin, d) - m1Monster) < 0.6),
  JSON.stringify(log.damages.slice(dmgBefore).map((d) => virtualDamage(gin, d)))
);
setVirtualHp(hogy, 6000);
advanceTicks(81, "cura-monster");
check("cura 200 a cada 4s", HOGY.regen.monster === 200 && Math.round(virtualHp(hogy)) === 6200, `${virtualHp(hogy)}`);
advanceTicks(400, "nao-drena");
check("a Metamorfose não drena como awakening comum", hogy.getDynamicProperty(DP.awakened) === true);
noNewErrors("Monster sem erro", mark);

scenario("Monster Aizen: 5% menos dano a cada 60s, até 50%");
mark = errors.length;
hogy.setDynamicProperty("mv:monster_resist", 0);
let linhasResist = log.worldMessages.length;
advanceTicks(1210, "resist-60s");
check("depois de 60s: 5%", hogy.getDynamicProperty("mv:monster_resist") === 1, String(hogy.getDynamicProperty("mv:monster_resist")));
check("com mensagem global", log.worldMessages.slice(linhasResist).some((m) => m.to === "*" && m.message.includes("5%")));
fullHp(hogy);
dmgBefore = log.damages.length;
hitWith(gin, hogy, "kenpachi:m1_zanpakuto");
// o Kenpachi e tier 3: a reducao de tier do Aizen (7) entra por cima
const tierHogy = 1 - game.TIER_DAMAGE_REDUCTION[7];
check(
  "o dano recebido cai 5% (fora a redução de tier)",
  log.damages.slice(dmgBefore).some((d) => d.target === "HogyokuPlayer" && Math.abs(virtualDamage(hogy, d) - game.DAMAGE.kenpachiM1 * 0.95 * tierHogy) < 0.6),
  JSON.stringify(log.damages.slice(dmgBefore).map((d) => virtualDamage(hogy, d)))
);
hogy.setDynamicProperty("mv:monster_resist", 10);
advanceTicks(1210, "resist-teto");
check("para em 50%", hogy.getDynamicProperty("mv:monster_resist") === 10);
dmgBefore = log.damages.length;
hitWith(gin, hogy, "kenpachi:m1_zanpakuto");
check(
  "com 50% o golpe chega pela metade",
  log.damages.slice(dmgBefore).some((d) => d.target === "HogyokuPlayer" && Math.abs(virtualDamage(hogy, d) - game.DAMAGE.kenpachiM1 * 0.5 * tierHogy) < 0.6),
  JSON.stringify(log.damages.slice(dmgBefore).map((d) => virtualDamage(hogy, d)))
);
noNewErrors("resistência sem erro", mark);

scenario("Monster Aizen: UltraFragor e Fragor Barrage");
mark = errors.length;
hogy.teleport({ x: 13300, y: 64, z: 13300 });
gin.teleport({ x: 13900, y: 64, z: 13900 });
const alvoUltra = createDummy("AlvoUltra", { x: 13336, y: 64, z: 13300 }, 900000);
const alvoBarrage = createDummy("AlvoBarrage", { x: 13305, y: 64, z: 13300 }, 900000);
dmgBefore = log.damages.length;
useItem(hogy, "aizen:ultra_fragor");
advanceTicks(40, "ultrafragor");
const bonusM = evoBonus(hogy);
check("UltraFragor: raio maior que o Fragor", HOGY.ultraFragor.radius > HOGY.fragor.radius);
check(
  `dobro do dano do Fragor (2000 x${bonusM}) a 36 blocos`,
  log.damages.slice(dmgBefore).some((d) => d.target === "AlvoUltra" && Math.abs(d.amount - 2000 * bonusM) < 0.6),
  JSON.stringify(log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoUltra"))
);
alvoUltra.kill();
dmgBefore = log.damages.length;
useItem(hogy, "aizen:fragor_barrage");
advanceTicks(HOGY.fragorBarrage.gapTicks * 5 + 40, "barrage");
const explosoesBarrage = log.damages.slice(dmgBefore).filter((d) => d.target === "AlvoBarrage" && Math.abs(d.amount - 500 * bonusM) < 0.6);
check("Fragor Barrage: 5 explosões de metade do Fragor", explosoesBarrage.length === 5, `${explosoesBarrage.length}`);
alvoBarrage.kill();
noNewErrors("UltraFragor e Barrage sem erro", mark);

scenario("Hōgyoku: morrer volta pra forma base e zera a Evolution");
mark = errors.length;
emit("playerSpawn", { player: hogy, initialSpawn: false });
advanceTicks(20, "respawn-hogyoku");
noNewErrors("respawn sem erro", mark);
check("volta pra forma base", hogy.getDynamicProperty(DP.awakened) === false && virtualMax(hogy) === 7000, `${virtualMax(hogy)}`);
check("Evolution e resistência zeradas", (hogy.getDynamicProperty("mv:evolution") ?? 0) === 0 && (hogy.getDynamicProperty("mv:monster_resist") ?? 0) === 0);
check("itens da forma base de volta", inv(hogy).getItem(3)?.typeId === "aizen:fragor");

scenario("Hōgyoku: desativar no meio do Kanzen Saimin não deixa nada pendurado");
mark = errors.length;
advanceTicks(20, "solta-gin");
gin.teleport({ x: 12006, y: 64, z: 12000 });
hogy.teleport({ x: 12000, y: 64, z: 12000 });
hogy.setDynamicProperty("mv:cd_aizen_illusions.kanzen_saimin", undefined);
pickIllusion(hogy, 2);
await settleForms();
aim(hogy, gin);
useItem(hogy, "aizen:illusions");
advanceTicks(3, "kanzen-desativar");
check("(ilusão de pé)", hogyokuClones().length === HOGY.kanzen.clones);
queueFormResponse(deactivateButtonIndex());
useItem(hogy, "multiversal:character_selector");
await settleForms();
advanceTicks(20, "desativar-hogyoku");
noNewErrors("desativar sem erro", mark);
check("clones removidos", hogyokuClones().length === 0);
check("visível e com nome", !hogy.getEffect("invisibility") && hogy.nameTag === "HogyokuPlayer");
check("nenhuma Kyōka sobra", !inv(hogy).slots.some((i) => i && i.typeId.startsWith("aizen:")), JSON.stringify(inv(hogy).slots.filter(Boolean).map((i) => i.typeId)));
gin.kill();

/* ================= Ichigo Kurosaki (Dangai) ================= */

const DG = game.DANGAI;
function dangaiDamageTo(name, since) {
  return log.damages.slice(since).filter((d) => d.target === name);
}
function dangaiTotal(target, since) {
  return dangaiDamageTo(target.name, since).reduce((n, d) => n + virtualDamage(target, d), 0);
}

scenario("Ichigo Kurosaki (Dangai): ativação (Híbrido, Tier 7)");
mark = errors.length;
const dangai = createPlayer("DangaiPlayer", { x: 30000, y: 64, z: 30000 });
emit("playerSpawn", { player: dangai, initialSpawn: true });
advanceTicks(20, "spawn-dangai");
check("registro: Híbrido, Tier 7", RACE_TIER.ichigo_dangai?.race === "hybrid" && RACE_TIER.ichigo_dangai?.tier === 7);
check("Aizen Hōgyoku agora é Tier 7", RACE_TIER.aizen_hogyoku?.tier === 7);
await pickCharacter(dangai, "ichigo_dangai");
advanceTicks(20, "ativar-dangai");
noNewErrors("ativar o Ichigo (Dangai) sem erro", mark);
check("vida maxima 7500", virtualMax(dangai) === 7500, String(virtualMax(dangai)));
check(
  "Zangetsu, Getsuga, Omnidirectional, Counter e Let's fight nos slots 0-4",
  JSON.stringify(slotIds(dangai, 5)) ===
    JSON.stringify([
      "dangai:m1_zangetsu",
      "dangai:getsuga_tenshou",
      "dangai:omnidirectional_getsuga",
      "dangai:arrogants_counter",
      "dangai:lets_fight_somewhere_else",
    ]),
  JSON.stringify(slotIds(dangai, 5))
);

scenario("Dangai: m1 de 200 e speed 5 só correndo");
mark = errors.length;
const alvoD = createDummy("AlvoDangai", { x: 30002, y: 64, z: 30000 }, 500000);
dmgBefore = log.damages.length;
hitWith(dangai, alvoD, "dangai:m1_zangetsu");
check("200 de dano", dangaiDamageTo("AlvoDangai", dmgBefore).some((d) => d.amount === 200), JSON.stringify(dangaiDamageTo("AlvoDangai", dmgBefore)));
advanceTicks(8, "parado");
const speedParado = dangai.getEffect("speed")?.amplifier;
dangai.isSprinting = true;
advanceTicks(8, "correndo");
const speedCorrendo = dangai.getEffect("speed")?.amplifier;
dangai.isSprinting = false;
advanceTicks(8, "parou");
check("parado: speed 2 (o base)", speedParado === 1, String(speedParado));
check("correndo: speed 5", speedCorrendo === 4, String(speedCorrendo));
check("parou de correr: volta pro base", dangai.getEffect("speed")?.amplifier === 1, String(dangai.getEffect("speed")?.amplifier));
alvoD.kill();
noNewErrors("m1 e corrida sem erro", mark);

scenario("Dangai: o dash vira o teleporte do Vasto Lorde");
mark = errors.length;
dangai.teleport({ x: 30200, y: 64, z: 30000 });
const alvoDash = createDummy("AlvoDashD", { x: 30225, y: 64, z: 30000 }, 500000);
dangai.setDynamicProperty("mv:cd_dash", undefined);
const kbDashD = log.knockbacks.length;
dangai.isSneaking = false;
advanceTicks(4, "reset-dash-d");
dangai._velocity = { x: 0, y: 0.5, z: 0 };
dangai.isSneaking = true;
advanceTicks(4, "dash-d");
dangai.isSneaking = false;
dangai._velocity = { x: 0, y: 0, z: 0 };
check("aparece no alvo em vez de avançar", Math.abs(dangai.location.x - 30225) < 3, `x=${dangai.location.x.toFixed(1)}`);
check("e não usa knockback", !log.knockbacks.slice(kbDashD).some((k) => k.target === "DangaiPlayer"));
alvoDash.kill();
noNewErrors("dash sem erro", mark);

scenario("Dangai: a Pressão Espiritual não pega nele");
mark = errors.length;
// ninguem no elenco esta 2+ tiers acima do Dangai: sobe o tier de um Aizen de
// mentira so pro teste (e devolve no fim)
const pressor = createPlayer("PressorD", { x: 30400, y: 64, z: 30000 });
const controleP = createPlayer("ControleP", { x: 30405, y: 64, z: 30000 });
emit("playerSpawn", { player: pressor, initialSpawn: true });
emit("playerSpawn", { player: controleP, initialSpawn: true });
advanceTicks(10, "spawn-pressao");
await pickCharacter(pressor, "aizen_hogyoku");
await pickCharacter(controleP, "gin");
advanceTicks(20, "ativar-pressao");
dangai.teleport({ x: 30403, y: 64, z: 30000 });
const tierReal = RACE_TIER.aizen_hogyoku.tier;
RACE_TIER.aizen_hogyoku.tier = 9;
pressor.setDynamicProperty("mv:generic_pressure_until", system.currentTick + 200);
dmgBefore = log.damages.length;
advanceTicks(130, "pressao");
RACE_TIER.aizen_hogyoku.tier = tierReal;
pressor.setDynamicProperty("mv:generic_pressure_until", 0);
check(
  "o controle (Gin, tier 5, 4 abaixo) toma a pressão",
  dangaiDamageTo("ControleP", dmgBefore).length > 0 && controleP.getEffect("slowness")?.amplifier === 3
);
check("o Dangai (2 abaixo) não toma nada", dangaiDamageTo("DangaiPlayer", dmgBefore).length === 0, JSON.stringify(dangaiDamageTo("DangaiPlayer", dmgBefore)));
check("nem lentidão", !dangai.getEffect("slowness"));
noNewErrors("pressão sem erro", mark);

scenario("Dangai: as ilusões do Aizen não pegam nele");
mark = errors.length;
fullHp(pressor);
pressor.teleport({ x: 30600, y: 64, z: 30000 });
dangai.teleport({ x: 30602, y: 64, z: 30000 });
hitWith(pressor, dangai, "aizen:m1_kyoka_suigetsu");
check("a Kyōka não marca", dangai.getDynamicProperty("mv:kyoka_mark") !== true);
dangai.setDynamicProperty("mv:kyoka_mark", true); // marcado antes de virar o Dangai
aim(pressor, dangai);
let linhasIlusao = log.worldMessages.length;
useItem(pressor, "aizen:illusions");
advanceTicks(5, "ilusao-no-dangai");
check("nem com a marca de antes a ilusão entra", hogyokuClones().length === 0);
check(
  "o Aizen é avisado e não gasta a ilusão",
  log.worldMessages.slice(linhasIlusao).some((m) => m.to === "PressorD" && m.message.includes("nunca viu a Kyōka")) &&
    pressor.getDynamicProperty("mv:cd_aizen_illusions.switch") === undefined
);
dangai.setDynamicProperty("mv:kyoka_mark", undefined);
noNewErrors("ilusões sem erro", mark);

scenario("Getsuga Tenshou (Dangai): 750, rápido, grande, azul com raios pretos");
mark = errors.length;
dangai.teleport({ x: 30800, y: 64, z: 30000 });
dangai._view = { x: 1, y: 0, z: 0 };
const naFrenteDg = createDummy("NaFrenteD", { x: 30820, y: 64, z: 30000 }, 500000);
const noAlto = createDummy("NoAltoD", { x: 30812, y: 67, z: 30000 }, 500000);
const doLado = createDummy("DoLadoD", { x: 30815, y: 64, z: 30006 }, 500000);
const atrasDg = createDummy("AtrasD", { x: 30797, y: 64, z: 30000 }, 500000);
dmgBefore = log.damages.length;
const partG = log.particles.length;
useItem(dangai, "dangai:getsuga_tenshou");
advanceTicks(6, "getsuga-dangai");
check("chega a 20 blocos em 6 ticks (bem mais rápido)", dangaiDamageTo("NaFrenteD", dmgBefore).length === 1);
check("750 de dano", dangaiTotal(naFrenteDg, dmgBefore) === 750, String(dangaiTotal(naFrenteDg, dmgBefore)));
check("grande: pega quem está 3 blocos acima", dangaiTotal(noAlto, dmgBefore) === 750);
check("fino: não pega quem está 6 blocos pro lado", dangaiDamageTo("DoLadoD", dmgBefore).length === 0);
check("não pega quem está atrás", dangaiDamageTo("AtrasD", dmgBefore).length === 0);
const idsG = new Set(log.particles.slice(partG).map((p) => p.particleId));
check("azul, com fio claro e raios pretos", idsG.has("dangai:getsuga") && idsG.has("dangai:borda") && idsG.has("dangai:raio"), [...idsG].join(", "));
check("maior que o Getsuga do Shikai (raio 1,8)", DG.getsuga.radius > 1.8 && DG.getsuga.speed > 2);
advanceTicks(20, "getsuga-fim");
for (const d of [naFrenteDg, noAlto, doLado, atrasDg]) d.kill();
noNewErrors("Getsuga Dangai sem erro", mark);

scenario("Getsuga Dangai desfaz ataques de tier 4 ou menos");
mark = errors.length;
const grimD = createPlayer("GrimmjowD", { x: 31025, y: 64, z: 31000 });
emit("playerSpawn", { player: grimD, initialSpawn: true });
advanceTicks(10, "spawn-grimd");
await pickCharacter(grimD, "grimmjow");
advanceTicks(20, "ativar-grimd");
dangai.teleport({ x: 31000, y: 64, z: 31000 });
fullHp(dangai);
fullHp(grimD);
aim(dangai, grimD);
aim(grimD, dangai);
dmgBefore = log.damages.length;
let linhasCancel = log.worldMessages.length;
useItem(grimD, "grimmjow:gran_rey_cero");
advanceTicks(2, "cero-sai");
dangai.setDynamicProperty("mv:cd_dangai_getsuga_tenshou", undefined);
useItem(dangai, "dangai:getsuga_tenshou");
advanceTicks(40, "choque");
check("o Gran Rey Cero (tier 2) some no caminho", dangaiDamageTo("DangaiPlayer", dmgBefore).length === 0, JSON.stringify(dangaiDamageTo("DangaiPlayer", dmgBefore)));
check("e o Getsuga segue e acerta o Grimmjow", dangaiTotal(grimD, dmgBefore) === 750, String(dangaiTotal(grimD, dmgBefore)));
check("o dono do cero é avisado", log.worldMessages.slice(linhasCancel).some((m) => m.to === "GrimmjowD" && m.message.includes("desfeito")));
// o mesmo cero vindo de alguem tier 5 passa
const tierGrim = RACE_TIER.grimmjow.tier;
RACE_TIER.grimmjow.tier = 5;
fullHp(dangai);
fullHp(grimD);
grimD.setDynamicProperty("mv:cd_grimmjow_gran_rey_cero", undefined);
dangai.setDynamicProperty("mv:cd_dangai_getsuga_tenshou", undefined);
dmgBefore = log.damages.length;
useItem(grimD, "grimmjow:gran_rey_cero");
advanceTicks(2, "cero-sai-t5");
useItem(dangai, "dangai:getsuga_tenshou");
advanceTicks(40, "choque-t5");
RACE_TIER.grimmjow.tier = tierGrim;
check("o de tier 5 não é desfeito", dangaiDamageTo("DangaiPlayer", dmgBefore).length > 0);
noNewErrors("choque de ataques sem erro", mark);

scenario("Omnidirectional Getsuga: 8 getsugas pra todo lado");
mark = errors.length;
dangai.teleport({ x: 31200, y: 64, z: 31200 });
dangai._view = { x: 1, y: 0, z: 0 };
const anelD = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2;
  anelD.push(createDummy(`AnelD${i}`, { x: 31200 + Math.cos(a) * 12, y: 64, z: 31200 + Math.sin(a) * 12 }, 500000));
}
const coladoD = createDummy("ColadoD", { x: 31202, y: 64, z: 31201 }, 500000); // entre dois cortes
dmgBefore = log.damages.length;
const partO = log.particles.length;
useItem(dangai, "dangai:omnidirectional_getsuga");
advanceTicks(20, "omni");
check("acerta os 8 lados, 750 cada", anelD.every((d) => dangaiTotal(d, dmgBefore) === 750), anelD.map((d) => dangaiTotal(d, dmgBefore)).join(","));
check("quem está entre dois cortes toma um só", dangaiTotal(coladoD, dmgBefore) === 750, String(dangaiTotal(coladoD, dmgBefore)));
check("mesmo visual do Getsuga Dangai", log.particles.slice(partO).some((p) => p.particleId === "dangai:raio"));
for (const d of [...anelD, coladoD]) d.kill();
noNewErrors("Omnidirectional sem erro", mark);

scenario("Arrogant's Counter: parado 5s, quem bate cai no contra-ataque");
mark = errors.length;
dangai.teleport({ x: 31400, y: 64, z: 31400 });
pressor.teleport({ x: 31402, y: 64, z: 31400 });
fullHp(dangai);
fullHp(pressor);
// o Aizen (7000) aguenta os 1250 do contra-ataque inteiro
useItem(dangai, "dangai:arrogants_counter");
advanceTicks(10, "postura");
check("fica parado (lentidão máxima)", dangai.getEffect("slowness")?.amplifier === 255);
dmgBefore = log.damages.length;
hitWith(pressor, dangai, "aizen:m1_kyoka_suigetsu");
advanceTicks(1, "golpe-no-counter");
check("o golpe não entra", dangaiDamageTo("DangaiPlayer", dmgBefore).length === 0, JSON.stringify(dangaiDamageTo("DangaiPlayer", dmgBefore)));
const dxC = dangai.location.x - pressor.location.x;
check("aparece atrás de quem bateu", Math.abs(dxC - 1.6) < 0.6 || Math.hypot(dangai.location.x - pressor.location.x, dangai.location.z - pressor.location.z) < 2.5, `dx=${dxC.toFixed(2)}`);
check("olhando reto pro alvo", aimsLevelAt(dangai, pressor));
check("o atacante fica paralisado", pressor.getEffect("slowness")?.amplifier === 255);
check("e o Ichigo solta a postura", dangai.getEffect("slowness")?.amplifier !== 255);
advanceTicks(37, "espera-2s");
check("nada antes de 2s", dangaiDamageTo("PressorD", dmgBefore).length === 0, JSON.stringify(dangaiDamageTo("PressorD", dmgBefore)));
advanceTicks(30, "cortes-e-getsuga");
const golpesC = dangaiDamageTo("PressorD", dmgBefore).map((d) => virtualDamage(pressor, d));
check(
  "dois cortes seguidos de um Getsuga Dangai",
  golpesC.length === 3 && golpesC[0] === game.DAMAGE.dangaiCounterSlash && golpesC[1] === game.DAMAGE.dangaiCounterSlash && golpesC[2] === 750,
  JSON.stringify(golpesC)
);
// ninguem bate: acaba sozinho em 5s
dangai.setDynamicProperty("mv:cd_dangai_arrogants_counter", undefined);
let linhasC = log.worldMessages.length;
useItem(dangai, "dangai:arrogants_counter");
advanceTicks(105, "counter-vazio");
check("sem golpe em 5s: acaba sozinho", log.worldMessages.slice(linhasC).some((m) => m.to === "DangaiPlayer" && m.message.includes("Ninguém caiu")));
check("e ele volta a andar", dangai.getEffect("slowness")?.amplifier !== 255);
noNewErrors("Arrogant's Counter sem erro", mark);

scenario("\"Let's fight somewhere else.\": leva o alvo até bater num bloco");
mark = errors.length;
dangai.teleport({ x: 31600, y: 64, z: 31600 });
dangai._view = { x: 1, y: 0, z: 0 };
const levado = createDummy("LevadoD", { x: 31603, y: 64, z: 31600 }, 500000);
for (let y = 64; y <= 67; y++) {
  for (let z = 31597; z <= 31603; z++) overworld.getBlock({ x: 31620, y, z }).setType("minecraft:stone");
}
dmgBefore = log.damages.length;
let linhasF = log.worldMessages.length;
useItem(dangai, "dangai:lets_fight_somewhere_else");
advanceTicks(4, "arrastando");
check("fala a frase", log.worldMessages.slice(linhasF).some((m) => m.message.includes("Let's fight somewhere else.")));
check("segura o alvo na frente", levado.location.x > dangai.location.x + 1.5 && levado.getEffect("slowness")?.amplifier === 255);
advanceTicks(20, "ate-a-parede");
check("explode ao bater na parede: 400", dangaiTotal(levado, dmgBefore) === 400, String(dangaiTotal(levado, dmgBefore)));
check("parou antes da parede", levado.location.x < 31620 && levado.location.x > 31612, `x=${levado.location.x.toFixed(1)}`);
check("e solta o alvo", levado.getEffect("slowness")?.amplifier !== 255);
// sem ninguem na frente: nao gasta
dangai.teleport({ x: 31800, y: 64, z: 31800 });
levado.kill();
advanceTicks(2, "sozinho");
dangai.setDynamicProperty("mv:cd_dangai_lets_fight_somewhere_else", undefined);
useItem(dangai, "dangai:lets_fight_somewhere_else");
check("sem alvo: não gasta o cooldown", dangai.getDynamicProperty("mv:cd_dangai_lets_fight_somewhere_else") === undefined);
noNewErrors("Let's fight sem erro", mark);

scenario("Mugetsu: roupa, Getsuga Tenshou Final de 10000 e o Ichigo sai 5s depois");
mark = errors.length;
const aizenM = createPlayer("AizenMugetsu", { x: 32025, y: 64, z: 32000 });
emit("playerSpawn", { player: aizenM, initialSpawn: true });
advanceTicks(10, "spawn-aizen-m");
await pickCharacter(aizenM, "aizen_hogyoku");
advanceTicks(20, "ativar-aizen-m");
dangai.teleport({ x: 32000, y: 64, z: 32000 });
dangai._view = { x: 1, y: 0, z: 0 };
const vitimaM = createDummy("VitimaMugetsu", { x: 32060, y: 64, z: 32004 }, 500000);
fullHp(aizenM);
dangai.setDynamicProperty(DP.awakening, 100);
dmgBefore = log.damages.length;
const titulosM = log.titles.length;
dangai.isSneaking = true;
useItem(dangai, "dangai:m1_zangetsu");
dangai.isSneaking = false;
advanceTicks(2, "mugetsu");
const peitoM = dangai.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Chest)?.typeId;
check("veste a roupa do Mugetsu", peitoM === "dangai:mugetsu_chest", String(peitoM));
check("MUGETSU na tela de todo mundo por perto", log.titles.slice(titulosM).some((t) => t.player === "AizenMugetsu" && t.title.includes("MUGETSU")));
check("gasta o medidor", (dangai.getDynamicProperty(DP.awakening) ?? 0) === 0);
advanceTicks(40, "getsuga-final");
check("3x o tamanho do Super Nuke Tenshou", Math.abs(DG.mugetsu.radius - 16.2) < 0.01);
check("10000 em quem está no caminho", dangaiTotal(vitimaM, dmgBefore) === 10000, String(dangaiTotal(vitimaM, dmgBefore)));
check("partículas pretas", log.particles.some((p) => p.particleId === "dangai:mugetsu"));
const maxAizen = virtualMax(aizenM);
check("o Aizen Hōgyoku não morre: fica com 10%", Math.abs(virtualHp(aizenM) - maxAizen * 0.1) < 2, `${virtualHp(aizenM)} de ${maxAizen}`);
check("e não toma os 10000", dangaiDamageTo("AizenMugetsu", dmgBefore).length === 0);
check("lentidão 3", aizenM.getEffect("slowness")?.amplifier === 2);
// sem skill, sem dano, sem cura
let linhasW = log.worldMessages.length;
useItem(aizenM, "aizen:fragor");
check("não usa skill", log.worldMessages.slice(linhasW).some((m) => m.to === "AizenMugetsu" && m.message.includes("sem forças")) && aizenM.getDynamicProperty("mv:cd_aizen_fragor") === undefined);
const alvoW = createDummy("AlvoFraco", { x: 32027, y: 64, z: 32000 }, 500000);
const dmgW = log.damages.length;
hitWith(aizenM, alvoW, "aizen:m1_kyoka_suigetsu");
check("não dá dano", dangaiDamageTo("AlvoFraco", dmgW).length === 0);
const vidaFraco = virtualHp(aizenM);
advanceTicks(60, "espera-mugetsu"); // 102 ticks desde o Mugetsu
check("5s depois o Ichigo perde o personagem", dangai.getDynamicProperty("mv:character") === undefined);
check("e a roupa sai", dangai.getComponent("minecraft:equippable").getEquipment(EquipmentSlot.Chest)?.typeId !== "dangai:mugetsu_chest");
advanceTicks(81, "sem-cura");
check("o Aizen não regenera", Math.round(virtualHp(aizenM)) === Math.round(vidaFraco), `${virtualHp(aizenM)} vs ${vidaFraco}`);
check("nem evolui", (aizenM.getDynamicProperty("mv:evolution") ?? 0) === 0);
// morrer desfaz o enfraquecimento (o stub invalida quem morre: so o respawn)
emit("playerSpawn", { player: aizenM, initialSpawn: false });
advanceTicks(10, "respawn-aizen-m");
const alvoW2 = createDummy("AlvoForte", { x: 32029, y: 64, z: 32000 }, 500000);
const dmgW2 = log.damages.length;
hitWith(aizenM, alvoW2, "aizen:m1_kyoka_suigetsu");
check("depois de morrer volta ao normal", dangaiDamageTo("AlvoForte", dmgW2).length > 0);
for (const d of [vitimaM, alvoW, alvoW2]) d.kill();
noNewErrors("Mugetsu sem erro", mark);

scenario("Dangai: desativar no meio do Counter e do Let's fight não deixa nada preso");
mark = errors.length;
await pickCharacter(dangai, "ichigo_dangai");
advanceTicks(20, "reativar-dangai");
dangai.teleport({ x: 32400, y: 64, z: 32400 });
dangai._view = { x: 1, y: 0, z: 0 };
const presoD = createDummy("PresoD", { x: 32403, y: 64, z: 32400 }, 500000);
useItem(dangai, "dangai:lets_fight_somewhere_else");
advanceTicks(3, "arrastando-2");
queueFormResponse(deactivateButtonIndex());
useItem(dangai, "multiversal:character_selector");
await settleForms();
advanceTicks(10, "desativado");
check("o alvo é solto", presoD.getEffect("slowness")?.amplifier !== 255);
check("o Ichigo desativa", dangai.getDynamicProperty("mv:character") === undefined);
presoD.kill();
noNewErrors("desativar sem erro", mark);

/* ================= Yamamoto Genryūsai ================= */

const YM = game.YAMAMOTO;
function ymHits(target, since, amount) {
  return log.damages.slice(since).filter((d) => d.target === target.name && (amount === undefined || virtualDamage(target, d) === amount));
}
function ymTotal(target, since) {
  return log.damages.slice(since).filter((d) => d.target === target.name).reduce((n, d) => n + virtualDamage(target, d), 0);
}

scenario("Yamamoto Genryūsai: ativação (Shinigami, Tier 7)");
mark = errors.length;
const yama = createPlayer("YamamotoPlayer", { x: 40000, y: 64, z: 40000 });
emit("playerSpawn", { player: yama, initialSpawn: true });
advanceTicks(20, "spawn-yama");
check("registro: Shinigami, Tier 7", RACE_TIER.yamamoto?.race === "shinigami" && RACE_TIER.yamamoto?.tier === 7);
await pickCharacter(yama, "yamamoto");
advanceTicks(30, "ativar-yama");
noNewErrors("ativar o Yamamoto sem erro", mark);
check("vida maxima 8500", virtualMax(yama) === 8500, String(virtualMax(yama)));
check(
  "Ryūjin Jakka, Ennetsu, Ittō Kasō, Shunshin e Hell's Pierce nos slots 0-4",
  JSON.stringify(slotIds(yama, 5)) ===
    JSON.stringify([
      "yamamoto:m1_ryujin_jakka",
      "yamamoto:ennetsu_jigoku",
      "yamamoto:itto_kaso",
      "yamamoto:shunshin",
      "yamamoto:hells_pierce",
    ]),
  JSON.stringify(slotIds(yama, 5))
);
check("ganha a tag que os mortos respeitam", yama.hasTag(YM.tag));

scenario("Ryūjin Jakka: m1 de 170 + Queimadura de 5s (70/s)");
mark = errors.length;
const alvoY = createDummy("AlvoYama", { x: 40002, y: 64, z: 40000 }, 500000);
dmgBefore = log.damages.length;
const partY = log.particles.length;
yama.selectedSlotIndex = 0;
hitWith(yama, alvoY, "yamamoto:m1_ryujin_jakka");
advanceTicks(130, "queimadura");
check("170 do golpe", ymHits(alvoY, dmgBefore, 170).length === 1);
check("5 segundos de Queimadura, 70 cada", ymHits(alvoY, dmgBefore, 70).length === 5, JSON.stringify(ymHits(alvoY, dmgBefore).map((d) => d.amount)));
check("fogo em quem está queimando", log.particles.slice(partY).some((p) => p.particleId === "yamamoto:chama"));
alvoY.kill();
noNewErrors("m1 e Queimadura sem erro", mark);

scenario("Ennetsu Jigoku: 3 sequências de 3 colunas de fogo");
mark = errors.length;
yama.teleport({ x: 40200, y: 64, z: 40000 });
yama._view = { x: 1, y: 0, z: 0 };
const meioE = createDummy("MeioEnnetsu", { x: 40210, y: 64, z: 40000 }, 500000);
const ladoE = createDummy("LadoEnnetsu", { x: 40200 + Math.cos(0.35) * 10, y: 64, z: 40000 + Math.sin(0.35) * 10 }, 500000);
const foraE = createDummy("ForaEnnetsu", { x: 40200, y: 64, z: 40010 }, 500000);
dmgBefore = log.damages.length;
useItem(yama, "yamamoto:ennetsu_jigoku");
advanceTicks(30, "ennetsu");
check("no meio: uma coluna de cada sequência (3x 100)", ymHits(meioE, dmgBefore, 100).length === 3, JSON.stringify(ymHits(meioE, dmgBefore).map((d) => d.amount)));
check("de lado, na diagonal do leque: 3x 100", ymHits(ladoE, dmgBefore, 100).length === 3);
check("fora do leque: nada", ymHits(foraE, dmgBefore).length === 0);
advanceTicks(100, "ennetsu-queima");
check("e queima (70)", ymHits(meioE, dmgBefore, 70).length >= 3);
for (const d of [meioE, ladoE, foraE]) d.kill();
noNewErrors("Ennetsu sem erro", mark);

scenario("Hadō #96 Ittō Kasō: marca, e 3s depois a ponta de katana de fogo");
mark = errors.length;
yama.teleport({ x: 40400, y: 64, z: 40000 });
yama._view = { x: 1, y: 0, z: 0 };
const marcado = createDummy("MarcadoItto", { x: 40415, y: 64, z: 40000 }, 500000);
const vizinhoI = createDummy("VizinhoItto", { x: 40415, y: 64, z: 40007 }, 500000);
const longeI = createDummy("LongeItto", { x: 40415, y: 64, z: 40013 }, 500000);
dmgBefore = log.damages.length;
const partI = log.particles.length;
useItem(yama, "yamamoto:itto_kaso");
advanceTicks(55, "marcando");
check("nada antes de 3s", ymHits(marcado, dmgBefore).length === 0);
advanceTicks(15, "erupcao");
check("300 em quem está na área", ymHits(marcado, dmgBefore, 300).length === 1);
check("pega 7 blocos do centro", ymHits(vizinhoI, dmgBefore, 300).length === 1);
check("não pega a 13 blocos", ymHits(longeI, dmgBefore).length === 0);
const laminaI = log.particles.slice(partI).filter((p) => p.particleId === "yamamoto:lamina");
check("a lâmina de fogo sobe bem alto (katana gigante)", laminaI.some((p) => p.location.y > 64 + YM.ittoKaso.height * 0.8));
advanceTicks(140, "itto-queima");
check("6s de Queimadura", ymHits(marcado, dmgBefore, 70).length === 6, String(ymHits(marcado, dmgBefore, 70).length));
for (const d of [marcado, vizinhoI, longeI]) d.kill();
noNewErrors("Ittō Kasō sem erro", mark);

scenario("Shunshin: dash muito rápido cortando o caminho");
mark = errors.length;
yama.teleport({ x: 40600, y: 64, z: 40000 });
yama._view = { x: 1, y: 0, z: 0 };
const noCaminhoYm = [5, 11, 17].map((dx, i) => createDummy(`Caminho${i}`, { x: 40600 + dx, y: 64, z: 40000.5 }, 500000));
dmgBefore = log.damages.length;
useItem(yama, "yamamoto:shunshin");
advanceTicks(4, "shunshin");
check("20 blocos em 4 ticks", Math.abs(yama.location.x - 40620) < 0.6, `x=${yama.location.x.toFixed(1)}`);
check("corta todos no caminho (110)", noCaminhoYm.every((d) => ymHits(d, dmgBefore, 110).length === 1));
advanceTicks(80, "shunshin-queima");
check("3s de Queimadura", noCaminhoYm.every((d) => ymHits(d, dmgBefore, 70).length === 3));
for (const d of noCaminhoYm) d.kill();
// parede no caminho: para antes dela
yama.teleport({ x: 40700, y: 64, z: 40000 });
for (let y = 64; y <= 65; y++) overworld.getBlock({ x: 40708, y, z: 40000 }).setType("minecraft:stone");
yama.setDynamicProperty("mv:cd_yamamoto_shunshin", undefined);
useItem(yama, "yamamoto:shunshin");
advanceTicks(6, "shunshin-parede");
check("para na parede", yama.location.x < 40708 && yama.location.x > 40704, `x=${yama.location.x.toFixed(1)}`);
noNewErrors("Shunshin sem erro", mark);

scenario("Hell's Pierce: empala quem está na frente e explode");
mark = errors.length;
yama.teleport({ x: 40800, y: 64, z: 40000 });
yama._view = { x: 1, y: 0, z: 0 };
const empalado = createDummy("Empalado", { x: 40803, y: 64, z: 40000 }, 500000);
const pertoP = createDummy("PertoPierce", { x: 40805, y: 64, z: 40002 }, 500000);
const longeP = createDummy("LongePierce", { x: 40812, y: 64, z: 40000 }, 500000);
dmgBefore = log.damages.length;
useItem(yama, "yamamoto:hells_pierce");
advanceTicks(2, "empala");
check("350 no empalado", ymHits(empalado, dmgBefore, 350).length === 1);
check("a explosão vem depois", ymHits(pertoP, dmgBefore).length === 0);
advanceTicks(10, "explode");
check("250 em quem está perto", ymHits(pertoP, dmgBefore, 250).length === 1);
check("o empalado não leva a explosão também", ymHits(empalado, dmgBefore, 250).length === 0);
check("longe fica de fora", ymHits(longeP, dmgBefore).length === 0);
advanceTicks(150, "pierce-queima");
check("7s de Queimadura", ymHits(empalado, dmgBefore, 70).length === 7 && ymHits(pertoP, dmgBefore, 70).length === 7);
for (const d of [empalado, pertoP, longeP]) d.kill();
advanceTicks(2, "sem-alvo");
yama.setDynamicProperty("mv:cd_yamamoto_hells_pierce", undefined);
useItem(yama, "yamamoto:hells_pierce");
check("sem ninguém na frente: não gasta", yama.getDynamicProperty("mv:cd_yamamoto_hells_pierce") === undefined);
noNewErrors("Hell's Pierce sem erro", mark);

scenario("Bankai: Zanka no Tachi");
mark = errors.length;
yama.teleport({ x: 41000, y: 64, z: 41000 });
yama._view = { x: 1, y: 0, z: 0 };
yama.setDynamicProperty(DP.awakening, 100);
let linhasZ = log.worldMessages.length;
yama.isSneaking = true;
useItem(yama, "yamamoto:m1_ryujin_jakka");
yama.isSneaking = false;
advanceTicks(10, "bankai-yama");
check("desperta", yama.getDynamicProperty(DP.awakened) === true);
check("\"Zanka no Tachi...\"", log.worldMessages.slice(linhasZ).some((m) => m.message.includes("Zanka no Tachi...")));
check(
  "Minami, Nishi, Higashi e Kita no lugar das skills",
  JSON.stringify(slotIds(yama, 5)) ===
    JSON.stringify(["yamamoto:m1_zanka_no_tachi", "yamamoto:minami", "yamamoto:nishi", "yamamoto:higashi", "yamamoto:kita"]),
  JSON.stringify(slotIds(yama, 5))
);
noNewErrors("Bankai sem erro", mark);

scenario("Zanka no Tachi: m1 de 200 + Queimadura Infernal que ignora redução");
mark = errors.length;
const nnoY = createPlayer("NnoitraY", { x: 41002, y: 64, z: 41000 });
emit("playerSpawn", { player: nnoY, initialSpawn: true });
advanceTicks(10, "spawn-nno-y");
await pickCharacter(nnoY, "nnoitra");
advanceTicks(20, "ativar-nno-y");
nnoY.teleport({ x: 41002, y: 64, z: 41000 });
fullHp(nnoY);
dmgBefore = log.damages.length;
yama.selectedSlotIndex = 0;
hitWith(yama, nnoY, "yamamoto:m1_zanka_no_tachi");
advanceTicks(50, "infernal");
const golpesNno = ymHits(nnoY, dmgBefore).map((d) => virtualDamage(nnoY, d));
check("a lâmina sofre a redução do Nnoitra (200 → 180)", golpesNno[0] === 180, JSON.stringify(golpesNno));
check("2s de Queimadura Infernal com 100 cheio (ignora os 10%)", golpesNno.slice(1).length === 2 && golpesNno.slice(1).every((n) => n === 100), JSON.stringify(golpesNno));
noNewErrors("m1 do Bankai sem erro", mark);

scenario("Zanka no Tachi (passiva): m1 num bloco explode um triângulo na frente");
mark = errors.length;
yama.teleport({ x: 41200, y: 64, z: 41200 });
yama._view = { x: 1, y: 0, z: 0 };
const naFrenteT = createDummy("FrenteTriangulo", { x: 41206, y: 64, z: 41201 }, 500000);
const pontaT = createDummy("PontaTriangulo", { x: 41208, y: 64, z: 41203 }, 500000);
const ladoT = createDummy("LadoTriangulo", { x: 41202, y: 64, z: 41205 }, 500000);
const chaoY = overworld.getBlock({ x: 41201, y: 63, z: 41200 });
chaoY.setType("minecraft:stone");
dmgBefore = log.damages.length;
const partT = log.particles.length;
yama.selectedSlotIndex = 0;
emit("entityHitBlock", { damagingEntity: yama, hitBlock: chaoY, blockFace: "Up" });
advanceTicks(6, "triangulo");
check("200 em quem está no triângulo", ymHits(naFrenteT, dmgBefore, 200).length === 1);
check("o triângulo abre: pega a ponta larga", ymHits(pontaT, dmgBefore, 200).length === 1);
check("não pega do lado", ymHits(ladoT, dmgBefore).length === 0);
check("explosões", log.particles.slice(partT).some((p) => p.particleId === "minecraft:large_explosion"));
emit("entityHitBlock", { damagingEntity: yama, hitBlock: chaoY, blockFace: "Up" });
advanceTicks(6, "triangulo-2");
check("não dá pra spammar (1s entre explosões)", ymHits(naFrenteT, dmgBefore, 200).length === 1);
for (const d of [naFrenteT, pontaT, ladoT]) d.kill();
noNewErrors("passiva sem erro", mark);

scenario("Minami: 10 mortos incinerados que caçam quem não é Yamamoto");
mark = errors.length;
yama.teleport({ x: 41400, y: 64, z: 41400 });
nnoY.teleport({ x: 41500, y: 64, z: 41500 });
useItem(yama, "yamamoto:minami");
advanceTicks(2, "minami");
const mortos = overworld.getEntities({ type: "yamamoto:morto" });
check("10 mortos", mortos.length === 10, String(mortos.length));
const bpMorto = JSON.parse(fs.readFileSync(new URL("../BP/entities/yamamoto_morto.json", import.meta.url), "utf8"))["minecraft:entity"].components;
check("400 de vida cada", bpMorto["minecraft:health"].value === 400);
check(
  "o alvo vanilla é player sem a tag do Yamamoto",
  JSON.stringify(bpMorto["minecraft:behavior.nearest_attackable_target"]).includes(`"value":"${YM.tag}"`)
);
check("o golpe vanilla não dá dano (os 50 saem do script)", bpMorto["minecraft:attack"].damage === 0);
// um morto encostado no Yamamoto: nao bate nele
mortos[0].teleport({ x: 41401, y: 64, z: 41400 });
dmgBefore = log.damages.length;
advanceTicks(30, "morto-perto-do-dono");
check("não ataca o Yamamoto", ymHits(yama, dmgBefore).length === 0);
// encostado no Nnoitra: 50 por golpe, 1 por segundo
nnoY.teleport({ x: 41401, y: 64, z: 41410 });
mortos[1].teleport({ x: 41402, y: 64, z: 41410 });
fullHp(nnoY);
dmgBefore = log.damages.length;
const partM = log.particles.length;
advanceTicks(45, "morto-bate");
const golpesM = ymHits(nnoY, dmgBefore).map((d) => virtualDamage(nnoY, d));
check("50 por golpe (menos os 10% do Nnoitra)", golpesM.length >= 2 && golpesM.every((n) => n === 45), JSON.stringify(golpesM));
check("trilha de fogo", log.particles.slice(partM).some((p) => p.particleId === "yamamoto:chama"));
nnoY.teleport({ x: 41600, y: 64, z: 41600 });
noNewErrors("Minami sem erro", mark);

scenario("Nishi: fogo em volta queima quem chega perto e apaga ataques");
mark = errors.length;
const grimY = createPlayer("GrimmjowY", { x: 41820, y: 64, z: 41800 });
emit("playerSpawn", { player: grimY, initialSpawn: true });
advanceTicks(10, "spawn-grim-y");
await pickCharacter(grimY, "grimmjow");
advanceTicks(20, "ativar-grim-y");
yama.teleport({ x: 41800, y: 64, z: 41800 });
nnoY.teleport({ x: 41807, y: 64, z: 41805 });
const longeN = createDummy("LongeNishi", { x: 41800, y: 64, z: 41813 }, 500000);
fullHp(yama);
fullHp(nnoY);
useItem(yama, "yamamoto:nishi");
advanceTicks(2, "nishi");
aim(grimY, yama);
dmgBefore = log.damages.length;
useItem(grimY, "grimmjow:gran_rey_cero");
advanceTicks(40, "nishi-cero");
check("o Gran Rey Cero some antes de chegar", ymHits(yama, dmgBefore).length === 0, JSON.stringify(ymHits(yama, dmgBefore)));
check("quem está a 10 blocos queima (Infernal, 100 cheio)", ymHits(nnoY, dmgBefore, 100).length >= 1, JSON.stringify(ymHits(nnoY, dmgBefore).map((d) => virtualDamage(nnoY, d))));
check("quem está a 13 não", ymHits(longeN, dmgBefore).length === 0);
advanceTicks(200, "nishi-acaba");
const depoisN = log.damages.length;
advanceTicks(60, "nishi-acabou");
check("em 10s acaba (e a Queimadura some junto)", ymHits(nnoY, depoisN).length === 0);
longeN.kill();
noNewErrors("Nishi sem erro", mark);

scenario("Higashi: Getsuga de fogo, 650 e Queimadura Infernal de 8s");
mark = errors.length;
yama.teleport({ x: 42000, y: 64, z: 42000 });
yama._view = { x: 1, y: 0, z: 0 };
const alvoH = createDummy("AlvoHigashi", { x: 42030, y: 64, z: 42000 }, 500000);
const alemH = createDummy("AlemHigashi", { x: 42040, y: 64, z: 42000 }, 500000);
const meuMorto = overworld.getEntities({ type: "yamamoto:morto" })[2];
meuMorto.teleport({ x: 42010, y: 64, z: 42000 });
dmgBefore = log.damages.length;
const partH = log.particles.length;
useItem(yama, "yamamoto:higashi");
advanceTicks(12, "higashi");
check("650 a 30 blocos", ymHits(alvoH, dmgBefore, 650).length === 1);
check("alcance 35: não chega a 40", ymHits(alemH, dmgBefore).length === 0);
check("não acerta os próprios mortos", !log.damages.slice(dmgBefore).some((d) => d.target === meuMorto.name && d.amount >= 600));
check("corte de fogo", log.particles.slice(partH).some((p) => p.particleId === "yamamoto:lamina"));
advanceTicks(180, "higashi-queima");
check("8s de Queimadura Infernal", ymHits(alvoH, dmgBefore, 100).length === 8, String(ymHits(alvoH, dmgBefore, 100).length));
for (const d of [alvoH, alemH]) d.kill();
noNewErrors("Higashi sem erro", mark);

scenario("Kita: corte gigante parado, 6000 + Infernal de 20s, e o Bankai acaba");
mark = errors.length;
yama.teleport({ x: 42200, y: 64, z: 42200 });
yama._view = { x: 1, y: 0, z: 0 };
const frenteK = createDummy("FrenteKita", { x: 42214, y: 64, z: 42203 }, 500000);
const ladoK = createDummy("LadoKita", { x: 42201, y: 64, z: 42212 }, 500000);
const atrasK = createDummy("AtrasKita", { x: 42190, y: 64, z: 42200 }, 500000);
const longeK = createDummy("LongeKita", { x: 42225, y: 64, z: 42200 }, 500000);
dmgBefore = log.damages.length;
useItem(yama, "yamamoto:kita");
advanceTicks(1, "kita");
check("o Bankai acaba na hora", yama.getDynamicProperty(DP.awakened) === false && inv(yama).getItem(1)?.typeId === "yamamoto:ennetsu_jigoku");
advanceTicks(8, "kita-corte");
check("6000 na frente", ymHits(frenteK, dmgBefore, 6000).length === 1);
check("o corte é do tamanho do Mugetsu: pega de lado a 12 blocos", ymHits(ladoK, dmgBefore, 6000).length === 1);
check("não pega atrás", ymHits(atrasK, dmgBefore).length === 0);
check("nem além do raio", ymHits(longeK, dmgBefore).length === 0);
check("o corte não anda: raio do Mugetsu", Math.abs(YM.kita.radius - game.DANGAI.mugetsu.radius) < 0.01);
advanceTicks(20, "kita-mortos");
check("sem Bankai os mortos somem", overworld.getEntities({ type: "yamamoto:morto" }).length === 0);
advanceTicks(420, "kita-queima");
check("20s de Queimadura Infernal", ymHits(frenteK, dmgBefore, 100).length === 20, String(ymHits(frenteK, dmgBefore, 100).length));
for (const d of [frenteK, ladoK, atrasK, longeK]) d.kill();
noNewErrors("Kita sem erro", mark);

scenario("Yamamoto: desativar tira a tag e os mortos");
mark = errors.length;
yama.setDynamicProperty(DP.awakening, 100);
yama.isSneaking = true;
useItem(yama, "yamamoto:m1_ryujin_jakka");
yama.isSneaking = false;
advanceTicks(5, "bankai-de-novo");
yama.setDynamicProperty("mv:cd_yamamoto_minami", undefined);
useItem(yama, "yamamoto:minami");
advanceTicks(2, "minami-de-novo");
check("(mortos de pé)", overworld.getEntities({ type: "yamamoto:morto" }).length === 10);
queueFormResponse(deactivateButtonIndex());
useItem(yama, "multiversal:character_selector");
await settleForms();
advanceTicks(25, "desativar-yama");
check("mortos removidos", overworld.getEntities({ type: "yamamoto:morto" }).length === 0);
check("a tag sai", !yama.hasTag(YM.tag));
noNewErrors("desativar sem erro", mark);

/* ================= Retsu Unohana ================= */

const UH = game.UNOHANA;
function uhHits(target, since, amount) {
  return log.damages.slice(since).filter((d) => d.target === target.name && (amount === undefined || virtualDamage(target, d) === amount));
}
async function chooseSpell(p, book, index) {
  p.isSneaking = true;
  queueFormResponse(index);
  useItem(p, book);
  p.isSneaking = false;
  await settleForms();
}
function resetSpell(p, key) {
  p.setDynamicProperty("mv:cd_" + key.replace(":", "_"), undefined);
}
async function newPlayerAs(name, loc, characterId) {
  const p = createPlayer(name, loc);
  emit("playerSpawn", { player: p, initialSpawn: true });
  advanceTicks(5, `spawn-${name}`);
  if (characterId) {
    await pickCharacter(p, characterId);
    advanceTicks(10, `ativar-${name}`);
  }
  p.teleport(loc);
  return p;
}

scenario("Retsu Unohana: ativação (Shinigami, Tier 3)");
mark = errors.length;
// quem bate ANTES dela virar a Unohana ainda pode ser curado pelo Kaidō Expert
const uno = await newPlayerAs("UnohanaPlayer", { x: 50000, y: 64, z: 50000 }, "rukia");
const antes = await newPlayerAs("AntesUno", { x: 50002, y: 64, z: 50000 }, "grimmjow");
hitWith(antes, uno, "grimmjow:m1_zanpakuto");
advanceTicks(5, "antes-bate");
check("registro: Shinigami, Tier 3", RACE_TIER.unohana?.race === "shinigami" && RACE_TIER.unohana?.tier === 3);
// troca de personagem: desativa a Rukia e escolhe a Unohana
queueFormResponse(deactivateButtonIndex());
useItem(uno, "multiversal:character_selector");
await settleForms();
advanceTicks(5, "desativa-rukia");
await pickCharacter(uno, "unohana");
advanceTicks(20, "ativar-uno");
noNewErrors("ativar a Unohana sem erro", mark);
check("vida maxima 2000", virtualMax(uno) === 2000, String(virtualMax(uno)));
check(
  "Zanpakuto, Hadōs, Bakudōs e Kaidōs nos slots 0-3",
  JSON.stringify(slotIds(uno, 4)) === JSON.stringify(["unohana:m1_zanpakuto", "unohana:hados", "unohana:bakudos", "unohana:kaidos"]),
  JSON.stringify(slotIds(uno, 4))
);
const alvoUno = createDummy("AlvoUno", { x: 50000, y: 64, z: 50002 }, 500000);
dmgBefore = log.damages.length;
hitWith(uno, alvoUno, "unohana:m1_zanpakuto");
check("m1 Zanpakuto: 30", uhHits(alvoUno, dmgBefore, 30).length === 1);
alvoUno.kill();

scenario("Unohana: agachar + usar abre cada menu de kidō");
mark = errors.length;
for (const [book, n] of [
  ["unohana:hados", 3],
  ["unohana:bakudos", 3],
  ["unohana:kaidos", 5],
]) {
  const formsAntes = shownForms.length;
  await chooseSpell(uno, book, n - 1);
  const form = shownForms[formsAntes];
  check(`${book}: menu com ${n} kidōs`, form?.buttons?.length === n, JSON.stringify(form?.buttons));
  check(`${book}: a escolha fica salva`, uno.getDynamicProperty(UH.books[book].dp) === n - 1);
}
noNewErrors("menus sem erro", mark);

scenario("Hadōs: Byakurai, Sōkatsui e Sōren Sōkatsui");
mark = errors.length;
uno.teleport({ x: 50200, y: 64, z: 50000 });
uno._view = { x: 1, y: 0, z: 0 };
const alvoBUh = createDummy("AlvoByakurai", { x: 50215, y: 64, z: 50000 }, 500000);
const atrasB = createDummy("AtrasByakurai", { x: 50220, y: 64, z: 50000 }, 500000);
await chooseSpell(uno, "unohana:hados", 0);
dmgBefore = log.damages.length;
useItem(uno, "unohana:hados");
advanceTicks(5, "byakurai");
check("Byakurai: 40, rápido (15 blocos em 5 ticks)", uhHits(alvoBUh, dmgBefore, 40).length === 1);
check("é um disparo concentrado: para no primeiro", uhHits(atrasB, dmgBefore).length === 0);
check("cooldown de 10s", uno.getDynamicProperty("mv:cd_unohana_hados.byakurai") !== undefined);
alvoBUh.kill();
atrasB.kill();
const alvoS = createDummy("AlvoSokatsui", { x: 50210, y: 64, z: 50000 }, 500000);
const vizS = createDummy("VizinhoSokatsui", { x: 50211, y: 64, z: 50002 }, 500000);
const longeS = createDummy("LongeSokatsui", { x: 50210, y: 64, z: 50007 }, 500000);
await chooseSpell(uno, "unohana:hados", 1);
dmgBefore = log.damages.length;
useItem(uno, "unohana:hados");
advanceTicks(12, "sokatsui");
check("Sōkatsui: explosão azul de 70", uhHits(alvoS, dmgBefore, 70).length === 1 && uhHits(vizS, dmgBefore, 70).length === 1);
check("Sōkatsui não pega a 7 blocos", uhHits(longeS, dmgBefore).length === 0);
await chooseSpell(uno, "unohana:hados", 2);
dmgBefore = log.damages.length;
useItem(uno, "unohana:hados");
advanceTicks(12, "soren");
check("Sōren Sōkatsui: 140 e bem maior (pega a 4-5 blocos)", uhHits(alvoS, dmgBefore, 140).length === 1 && uhHits(vizS, dmgBefore, 140).length === 1);
check("fogo azul", log.particles.some((p) => p.particleId === "unohana:fogo_azul"));
for (const d of [alvoS, vizS, longeS]) d.kill();
noNewErrors("Hadōs sem erro", mark);

scenario("Bakudō #8 Seki: escudo que repele o que vem pela frente");
mark = errors.length;
const grimUno = await newPlayerAs("GrimUno", { x: 50402, y: 64, z: 50000 }, "grimmjow");
uno.teleport({ x: 50400, y: 64, z: 50000 });
uno._view = { x: 1, y: 0, z: 0 };
fullHp(uno);
await chooseSpell(uno, "unohana:bakudos", 0);
useItem(uno, "unohana:bakudos");
advanceTicks(2, "seki");
dmgBefore = log.damages.length;
const kbSeki = log.knockbacks.length;
hitWith(grimUno, uno, "grimmjow:m1_zanpakuto");
check("golpe de frente não entra", uhHits(uno, dmgBefore).length === 0);
check("e quem bateu é empurrado", log.knockbacks.slice(kbSeki).some((k) => k.target === "GrimUno"));
grimUno.teleport({ x: 50398, y: 64, z: 50000 });
hitWith(grimUno, uno, "grimmjow:m1_zanpakuto");
check("pelas costas o golpe entra (o escudo é pequeno)", uhHits(uno, dmgBefore).length === 1);
advanceTicks(100, "seki-acaba");
grimUno.teleport({ x: 50402, y: 64, z: 50000 });
dmgBefore = log.damages.length;
hitWith(grimUno, uno, "grimmjow:m1_zanpakuto");
check("depois de 5s o escudo some", uhHits(uno, dmgBefore).length === 1);
noNewErrors("Seki sem erro", mark);

scenario("Bakudō #63 Sajō Sabaku: prende e pausa os cooldowns (até tier 5)");
mark = errors.length;
fullHp(uno);
uno.teleport({ x: 50600, y: 64, z: 50000 });
grimUno.teleport({ x: 50608, y: 64, z: 50000 });
aim(uno, grimUno);
await chooseSpell(uno, "unohana:bakudos", 1);
let linhasSajo = log.worldMessages.length;
useItem(uno, "unohana:bakudos");
advanceTicks(2, "sajo");
check("o alvo fica preso", grimUno.getEffect("slowness")?.amplifier === 255);
check("os cooldowns dele param por 10s", log.worldMessages.slice(linhasSajo).some((m) => m.to === "GrimUno" && m.message.includes("pararam por 10s")));
advanceTicks(80, "sajo-solta");
check("a prisão solta depois de 3s", grimUno.getEffect("slowness")?.amplifier !== 255);
const fortao = await newPlayerAs("FortaoUno", { x: 50605, y: 64, z: 50003 }, "aizen");
fortao.teleport({ x: 50608, y: 64, z: 50000 });
grimUno.teleport({ x: 50700, y: 64, z: 50000 });
resetSpell(uno, "unohana:bakudos.sajo_sabaku");
linhasSajo = log.worldMessages.length;
useItem(uno, "unohana:bakudos");
check("tier 6 é forte demais: não prende", fortao.getEffect("slowness")?.amplifier !== 255);
check("e não gasta o cooldown", uno.getDynamicProperty("mv:cd_unohana_bakudos.sajo_sabaku") === undefined);
noNewErrors("Sajō Sabaku sem erro", mark);

scenario("Bakudō #81 Dankū: segura tudo de tier 6 pra baixo por 10s");
mark = errors.length;
fullHp(uno);
uno.teleport({ x: 50800, y: 64, z: 50000 });
fortao.teleport({ x: 50802, y: 64, z: 50000 });
grimUno.teleport({ x: 50798, y: 64, z: 50000 });
const forte7 = await newPlayerAs("DangaiUno", { x: 50800, y: 64, z: 50002 }, "ichigo_dangai");
forte7.teleport({ x: 50800, y: 64, z: 50002 });
await chooseSpell(uno, "unohana:bakudos", 2);
useItem(uno, "unohana:bakudos");
advanceTicks(2, "danku");
dmgBefore = log.damages.length;
hitWith(fortao, uno, "aizen:m1_kyoka_suigetsu");
hitWith(grimUno, uno, "grimmjow:m1_zanpakuto");
check("tier 6 e tier 2: nada entra, de qualquer lado", uhHits(uno, dmgBefore).length === 0);
hitWith(forte7, uno, "dangai:m1_zangetsu");
check("tier 7 atravessa a Dankū", uhHits(uno, dmgBefore).length === 1);
grimUno.teleport({ x: 50820, y: 64, z: 50000 });
fortao.teleport({ x: 50800, y: 64, z: 50030 }); // fora da linha do cero
forte7.teleport({ x: 50800, y: 64, z: 49970 });
aim(grimUno, uno);
fullHp(uno);
dmgBefore = log.damages.length;
let linhasDanku = log.worldMessages.length;
useItem(grimUno, "grimmjow:gran_rey_cero");
advanceTicks(30, "danku-cero");
check("o Gran Rey Cero é desfeito na barreira", uhHits(uno, dmgBefore).length === 0);
check("com aviso pro Grimmjow", log.worldMessages.slice(linhasDanku).some((m) => m.to === "GrimUno" && m.message.includes("Dankū")));
advanceTicks(180, "danku-acaba");
fortao.teleport({ x: 50802, y: 64, z: 50000 });
dmgBefore = log.damages.length;
hitWith(fortao, uno, "aizen:m1_kyoka_suigetsu");
check("depois de 10s acaba", uhHits(uno, dmgBefore).length === 1);
noNewErrors("Dankū sem erro", mark);

scenario("Kaidōs: Básico, Avançado e Chiyu");
mark = errors.length;
uno.teleport({ x: 51000, y: 64, z: 51000 });
setVirtualHp(uno, 500);
await chooseSpell(uno, "unohana:kaidos", 0);
useItem(uno, "unohana:kaidos");
advanceTicks(110, "kaido-basico");
check("Básico: 50/s por 5s (+250)", Math.round(virtualHp(uno)) === 750, `${virtualHp(uno)}`);
setVirtualHp(uno, 500);
await chooseSpell(uno, "unohana:kaidos", 1);
useItem(uno, "unohana:kaidos");
advanceTicks(210, "kaido-avancado");
check("Avançado: 100/s por 10s (+1000)", Math.round(virtualHp(uno)) === 1500, `${virtualHp(uno)}`);
setVirtualHp(uno, 500);
await chooseSpell(uno, "unohana:kaidos", 2);
useItem(uno, "unohana:kaidos");
check("Chiyu: +200 na hora", Math.round(virtualHp(uno)) === 700, `${virtualHp(uno)}`);
setVirtualHp(uno, 1950);
resetSpell(uno, "unohana:kaidos.chiyu");
useItem(uno, "unohana:kaidos");
check("não passa da vida máxima", Math.round(virtualHp(uno)) === 2000, `${virtualHp(uno)}`);
check("partícula de cura", log.particles.some((p) => p.particleId === "unohana:cura"));
noNewErrors("Kaidōs sem erro", mark);

scenario("Diagnóstico: tira queimadura, deterioração, veneno, fragilização e congelamento");
mark = errors.length;
fullHp(uno);
game.applyBurn(uno, forte7, 10, true);
game.applyDeterioration(uno, forte7, 30, 10);
game.applyMayuriPoison(uno, forte7, 10, 20);
game.addFragility(uno, 30);
game.freezeCooldowns(uno, 400);
uno.addEffect("slowness", 200, { amplifier: 1 });
uno.addEffect("weakness", 200, { amplifier: 0 });
advanceTicks(25, "efeitos");
check("(os efeitos estão machucando)", log.damages.some((d) => d.target === "UnohanaPlayer"));
await chooseSpell(uno, "unohana:kaidos", 3);
useItem(uno, "unohana:kaidos");
dmgBefore = log.damages.length;
advanceTicks(60, "depois-do-diagnostico");
check("nenhum dano depois do Diagnóstico", uhHits(uno, dmgBefore).length === 0, JSON.stringify(uhHits(uno, dmgBefore)));
check("sem lentidão nem fraqueza", !uno.getEffect("slowness") && !uno.getEffect("weakness"));
dmgBefore = log.damages.length;
hitWith(forte7, uno, "dangai:m1_zangetsu");
check("a fragilização saiu (o golpe chega normal)", uhHits(uno, dmgBefore, game.DAMAGE.dangaiM1).length === 1, JSON.stringify(uhHits(uno, dmgBefore).map((d) => virtualDamage(uno, d))));
noNewErrors("Diagnóstico sem erro", mark);

scenario("Tratamento em área: o Kaidō Básico em quem ela está olhando");
mark = errors.length;
const pacienteUno = createDummy("PacienteUno", { x: 51006, y: 64, z: 51000 }, 1000);
pacienteUno.getComponent("minecraft:health").setCurrentValue(400);
uno.teleport({ x: 51000, y: 64, z: 51000 });
uno._view = { x: 1, y: 0, z: 0 };
await chooseSpell(uno, "unohana:kaidos", 4);
useItem(uno, "unohana:kaidos");
advanceTicks(110, "tratamento");
check("+250 em quem ela olhou", Math.round(pacienteUno.getComponent("minecraft:health").currentValue) === 650, String(pacienteUno.getComponent("minecraft:health").currentValue));
pacienteUno.kill();
uno._view = { x: 0, y: 0, z: -1 };
resetSpell(uno, "unohana:kaidos.tratamento");
useItem(uno, "unohana:kaidos");
check("sem ninguém na mira: não gasta", uno.getDynamicProperty("mv:cd_unohana_kaidos.tratamento") === undefined);
noNewErrors("Tratamento sem erro", mark);

scenario("Kaidō Expert: cura total em 7x7, menos quem atacou a Unohana");
mark = errors.length;
uno.teleport({ x: 51200, y: 64, z: 51200 });
const atacante = await newPlayerAs("AtacanteUno", { x: 51202, y: 64, z: 51200 }, "grimmjow");
const amigo = await newPlayerAs("AmigoUno", { x: 51200, y: 64, z: 51202 }, "grimmjow");
antes.teleport({ x: 51198, y: 64, z: 51200 });
const bicho = createDummy("BichoUno", { x: 51201, y: 64, z: 51198 }, 1000);
const longeUno = createDummy("LongeUno", { x: 51206, y: 64, z: 51200 }, 1000);
hitWith(atacante, uno, "grimmjow:m1_zanpakuto");
advanceTicks(2, "atacante-bate");
for (const p of [atacante, amigo, antes]) setVirtualHp(p, 100);
setVirtualHp(uno, 300);
bicho.getComponent("minecraft:health").setCurrentValue(100);
longeUno.getComponent("minecraft:health").setCurrentValue(100);
uno.setDynamicProperty(DP.awakening, 100);
let linhasExpert = log.worldMessages.length;
uno.isSneaking = true;
useItem(uno, "unohana:m1_zanpakuto");
uno.isSneaking = false;
advanceTicks(2, "kaido-expert");
check("anuncia o Kaidō Expert", log.worldMessages.slice(linhasExpert).some((m) => m.message.includes("Kaidō Expert")));
check("cura ela mesma inteira", Math.round(virtualHp(uno)) === virtualMax(uno), `${virtualHp(uno)}`);
check("cura quem não atacou", Math.round(virtualHp(amigo)) === virtualMax(amigo), `${virtualHp(amigo)}`);
check("cura até entidade", bicho.getComponent("minecraft:health").currentValue === 1000);
check("quem atacou depois da escolha fica de fora", Math.round(virtualHp(atacante)) === 100, `${virtualHp(atacante)}`);
check("quem atacou ANTES dela virar a Unohana é curado", Math.round(virtualHp(antes)) === virtualMax(antes), `${virtualHp(antes)}`);
check("fora do 7x7 não", longeUno.getComponent("minecraft:health").currentValue === 100);
check("gasta o medidor", (uno.getDynamicProperty(DP.awakening) ?? 0) === 0);
for (const d of [bicho, longeUno]) d.kill();
noNewErrors("Kaidō Expert sem erro", mark);

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
