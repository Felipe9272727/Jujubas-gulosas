/* =========================================================
   Perfil de custo do addon (o "lag").

   uso: node --import ./sim/register.mjs sim/profile.mjs loops  [ticks]
        node --import ./sim/register.mjs sim/profile.mjs skills [personagem,...]

   O que pesa no Bedrock e cada chamada da API nativa feita pelo script (busca
   de entidade, getComponent, propriedade dinamica, bloco, efeito, particula,
   comando). Este script conta essas chamadas no stub da simulacao:

   - loops:  mundo parado com varios personagens ativos; cada runInterval vira
             uma linha (arquivo:linha onde foi criado) com chamadas por tick.
   - skills: cada skill de cada personagem usada sozinha; mostra o total e o
             pico por tick de chamadas, particulas, buscas e blocos trocados.
   ========================================================= */

import * as stub from "./stubs/server.mjs";
import { queueFormResponse } from "./stubs/server-ui.mjs";

const { system, advanceTicks, createPlayer, createDummy, emit, ItemStack, overworld } = stub;
const MODE = process.argv[2] ?? "loops";

const stats = new Map(); // origem do loop -> { calls, methods }
let current = null;
const global = { calls: 0, particles: 0, searches: 0, blocks: 0, commands: 0 };

function origin() {
  const lines = new Error().stack.split("\n").slice(2);
  const line = lines.find((l) => l.includes("BP/scripts/") && !l.includes("system.runInterval"));
  const m = line?.match(/BP\/scripts\/([\w.]+):(\d+)/);
  return m ? `${m[1]}:${m[2]}` : "?";
}

const rawRunInterval = system.runInterval.bind(system);
system.runInterval = (cb, ticks) => {
  const key = origin();
  return rawRunInterval(() => {
    let s = stats.get(key);
    if (!s) stats.set(key, (s = { calls: 0, methods: new Map() }));
    const prev = current;
    current = s;
    try {
      cb();
    } finally {
      current = prev;
    }
  }, ticks);
};

const globalMethods = new Map();
function count(label, name) {
  global.calls++;
  const gk = `${label}.${name}`;
  globalMethods.set(gk, (globalMethods.get(gk) ?? 0) + 1);
  if (name === "spawnParticle") global.particles++;
  if (name === "getEntities" || name === "getPlayers" || name === "getEntitiesFromViewDirection") global.searches++;
  if (name === "setType" || name === "setPermutation") global.blocks++;
  if (name === "runCommand") global.commands++;
  if (current) {
    current.calls++;
    const k = `${label}.${name}`;
    current.methods.set(k, (current.methods.get(k) ?? 0) + 1);
  }
}

// toda chamada de metodo nos objetos nativos conta
function instrument(proto, label) {
  for (const name of Object.getOwnPropertyNames(proto)) {
    if (name === "constructor" || name.startsWith("_")) continue;
    const desc = Object.getOwnPropertyDescriptor(proto, name);
    if (!desc || typeof desc.value !== "function") continue;
    const raw = desc.value;
    proto[name] = function (...args) {
      count(label, name);
      return raw.apply(this, args);
    };
  }
}
instrument(stub.Entity.prototype, "Entity");
instrument(stub.Player.prototype, "Player");
instrument(stub.Dimension.prototype, "Dimension");
instrument(Object.getPrototypeOf(overworld.getBlock({ x: 0, y: 0, z: 0 })), "Block");
for (const name of ["getPlayers", "getAllPlayers", "getDynamicProperty", "setDynamicProperty", "getDimension"]) {
  const raw = stub.world[name];
  if (typeof raw !== "function") continue;
  stub.world[name] = function (...args) {
    count("world", name);
    return raw.apply(this, args);
  };
}

const game = await import("../BP/scripts/main.js");
const { RACES, TIERS, CHARACTER_RACE_TIER, CHARACTERS } = game;

async function settleForms() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function useItem(p, typeId) {
  emit("itemUse", { source: p, itemStack: new ItemStack(typeId, 1) });
}
async function pick(player, id) {
  const entry = CHARACTER_RACE_TIER[id];
  const raceIndex = RACES.findIndex((r) => r.id === entry.race);
  const tierIndex = TIERS.findIndex((t) => t.id === entry.tier);
  const roster = Object.entries(CHARACTER_RACE_TIER).filter(([, d]) => d.race === entry.race && d.tier === entry.tier).map(([k]) => k);
  const now = player.getDynamicProperty("mv:race") ?? 0;
  player.isSneaking = true;
  for (let i = 0; i < (raceIndex - now + RACES.length) % RACES.length; i++) useItem(player, "multiversal:character_selector");
  player.isSneaking = false;
  queueFormResponse(tierIndex);
  queueFormResponse(roster.indexOf(id));
  useItem(player, "multiversal:character_selector");
  await settleForms();
}
async function unpick(player) {
  queueFormResponse(TIERS.length);
  useItem(player, "multiversal:character_selector");
  await settleForms();
}

if (MODE === "loops") {
  const TICKS = Number(process.argv[3] ?? 400);
  const cast = (process.argv[4] ?? "ichigo_sf,komamura,aizen,yamamoto,starkk,chad,yoruichi,orihime").split(",");
  const players = cast.map((_, i) => {
    const p = createPlayer(`P${i}`, { x: i * 6, y: 64, z: 0 });
    emit("playerSpawn", { player: p, initialSpawn: true });
    return p;
  });
  for (let i = 0; i < 6; i++) createDummy(`Mob${i}`, { x: i * 4, y: 64, z: 8 }, 500);
  advanceTicks(5, "spawn");
  for (let i = 0; i < cast.length; i++) await pick(players[i], cast[i]);
  advanceTicks(40, "aquecer");
  stats.clear();
  const before = global.calls;
  advanceTicks(TICKS, "perfil");
  const rows = [...stats.entries()].map(([k, s]) => ({ k, perTick: s.calls / TICKS, s })).sort((a, b) => b.perTick - a.perTick);
  console.log(`${cast.length} players (${cast.join(", ")}), 6 mobs, ${TICKS} ticks parados`);
  console.log(`chamadas nativas por tick no total: ${((global.calls - before) / TICKS).toFixed(1)}\n`);
  for (const r of rows.slice(0, 30)) {
    const top = [...r.s.methods.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([m, n]) => `${m}×${(n / TICKS).toFixed(1)}`).join(" ");
    console.log(`${r.perTick.toFixed(1).padStart(7)}/tick  ${r.k.padEnd(28)} ${top}`);
  }
} else {
  const ids = process.argv[3] ? process.argv[3].split(",") : Object.keys(CHARACTER_RACE_TIER);
  const rows = [];
  let n = 0;
  for (const id of ids) {
    const base = { x: 100000 + n++ * 400, y: 64, z: 100000 };
    const p = createPlayer(`Prof_${id}`, base);
    emit("playerSpawn", { player: p, initialSpawn: true });
    advanceTicks(5, "spawn");
    await pick(p, id);
    advanceTicks(10, "ativar");
    const ch = CHARACTERS[id];
    const forms = [["base", ch.items]];
    if (ch.awakening?.items) forms.push(["awk", ch.awakening.items]);
    for (const [form, items] of forms) {
      if (form === "awk") {
        p.setDynamicProperty("mv:awakening", 100);
        p.isSneaking = true;
        useItem(p, ch.awakening.triggerItem ?? items[0]);
        p.isSneaking = false;
        advanceTicks(30, "awk");
      }
      for (const item of Object.values(items).slice(1)) {
        if (typeof item !== "string") continue;
        p.teleport(base);
        p._view = { x: 1, y: 0, z: 0 };
        const dummies = [0, 1, 2].map((k) => createDummy(`Alvo${k}`, { x: base.x + 4 + k * 6, y: 64, z: base.z + k - 1 }, 500000));
        p.setDynamicProperty("mv:cd_" + item.replace(":", "_"), undefined);
        // custo do mundo parado com esse player, pra descontar
        const idle0 = global.calls;
        advanceTicks(40, "base");
        const idlePerTick = (global.calls - idle0) / 40;
        const start = { ...global };
        const methods0 = new Map(globalMethods);
        let peak = 0;
        let peakParticles = 0;
        let last = { ...global };
        useItem(p, item);
        for (let t = 0; t < 240; t++) {
          advanceTicks(1, "skill");
          peak = Math.max(peak, global.calls - last.calls);
          peakParticles = Math.max(peakParticles, global.particles - last.particles);
          last = { ...global };
        }
        for (const d of dummies) d.kill();
        const diff = Object.fromEntries(Object.keys(global).map((k) => [k, global[k] - start[k]]));
        diff.calls = Math.round(diff.calls - idlePerTick * 240);
        const top = [...globalMethods.entries()].map(([k, v]) => [k, v - (methods0.get(k) ?? 0)]).sort((a, b) => b[1] - a[1]).slice(0, 5);
        rows.push({ id, item, peak: Math.round(peak - idlePerTick), peakParticles, top, ...diff });
      }
    }
    await unpick(p);
    advanceTicks(5, "sair");
    p.kill(); // sai do mundo: o proximo personagem mede sozinho
    advanceTicks(5, "saiu");
  }
  rows.sort((a, b) => b.peak - a.peak);
  console.log("pico/tick  total  partic(pico) buscas blocos cmds  skill");
  for (const r of rows.slice(0, Number(process.argv[4] ?? 40))) {
    console.log(
      `${String(r.peak).padStart(8)} ${String(r.calls).padStart(6)} ${String(r.particles).padStart(6)}(${String(r.peakParticles).padStart(3)}) ${String(r.searches).padStart(6)} ${String(r.blocks).padStart(6)} ${String(r.commands).padStart(4)}  ${r.item}`
    );
    if (process.env.DETAIL) console.log("           " + r.top.map(([k, v]) => `${k}×${v}`).join(" "));
  }
}
process.exit(0);
