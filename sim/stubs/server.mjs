/* =========================================================
   Stub de @minecraft/server para simulacao fora do jogo.
   Modela so o que o main.js usa, mas com validacao de estado
   (entidade removida vira invalida e lanca, igual no jogo).
   ========================================================= */

import fs from "node:fs";

export const errors = [];
export const log = {
  worldMessages: [],
  particles: [],
  sounds: [],
  commands: [],
  damages: [],
  effects: [],
  actionBars: [],
  titles: [],
  explosions: [],
  knockbacks: [],
  teleports: [],
  blocks: [],
  rejectedEquipment: [],
  animations: [],
  cameras: [],
};

function record(err, phase) {
  errors.push({ phase, message: err?.message ?? String(err), stack: err?.stack });
}

// O main.js embrulha todo runInterval num try/catch "anti-lag" que troca a
// excecao por um console.warn. No jogo isso evita spam no log; aqui cegaria a
// simulacao, que reprova justamente por excecao. O aviso volta a ser erro.
const rawWarn = console.warn.bind(console);
console.warn = (...args) => {
  const text = args.map((a) => String(a)).join(" ");
  if (text.startsWith("[anti-lag]")) record(new Error(text), "loop engolido pelo anti-lag");
  else rawWarn(...args);
};

/* ---------------- scheduler ---------------- */

let currentTick = 0;
let nextRunId = 1;
const runs = new Map();

export const system = {
  get currentTick() {
    return currentTick;
  },
  runInterval(cb, ticks = 1) {
    const id = nextRunId++;
    runs.set(id, { cb, period: Math.max(1, ticks), next: currentTick + Math.max(1, ticks), repeat: true });
    return id;
  },
  runTimeout(cb, ticks = 1) {
    const id = nextRunId++;
    runs.set(id, { cb, period: Math.max(1, ticks), next: currentTick + Math.max(1, ticks), repeat: false });
    return id;
  },
  run(cb) {
    return system.runTimeout(cb, 1);
  },
  clearRun(id) {
    runs.delete(id);
  },
};

export function advanceTicks(count, phase = "tick") {
  for (let i = 0; i < count; i++) {
    currentTick++;
    for (const [id, run] of [...runs.entries()]) {
      if (!runs.has(id)) continue;
      if (run.next > currentTick) continue;
      if (run.repeat) run.next = currentTick + run.period;
      else runs.delete(id);
      try {
        run.cb();
      } catch (e) {
        record(e, `${phase} (tick ${currentTick}, run #${id})`);
      }
    }
  }
}

export function scheduledRunCount() {
  return runs.size;
}

export function resetScheduler() {
  runs.clear();
  currentTick = 0;
}

/* ---------------- enums ---------------- */

export const EntityDamageCause = {
  entityAttack: "entityAttack",
  entityExplosion: "entityExplosion",
  magic: "magic",
  fire: "fire",
  void: "void",
  suicide: "suicide",
};

export const EquipmentSlot = {
  Head: "Head",
  Chest: "Chest",
  Legs: "Legs",
  Feet: "Feet",
  Mainhand: "Mainhand",
  Offhand: "Offhand",
};

export const GameMode = { survival: "survival", creative: "creative" };

export const InputPermissionCategory = {
  Camera: 1,
  Movement: 2,
  LateralMovement: 4,
  Sneak: 5,
  Jump: 6,
  Mount: 7,
  Dismount: 8,
  MoveForward: 9,
  MoveBackward: 10,
  MoveLeft: 11,
  MoveRight: 12,
};

class PlayerInputPermissions {
  constructor(entity) {
    this.entity = entity;
    this.disabled = new Set();
  }
  isPermissionCategoryEnabled(category) {
    this.entity._assertValid();
    return !this.disabled.has(category);
  }
  setPermissionCategory(category, isEnabled) {
    this.entity._assertValid();
    if (!Object.values(InputPermissionCategory).includes(category)) {
      throw new Error(`categoria de input desconhecida: ${category}`);
    }
    if (isEnabled) this.disabled.delete(category);
    else this.disabled.add(category);
  }
}

export class ItemStack {
  constructor(typeId, amount = 1) {
    if (typeof typeId !== "string" || !typeId.includes(":")) {
      throw new Error(`ItemStack typeId invalido: ${typeId}`);
    }
    this.typeId = typeId;
    this.amount = amount;
    this.nameTag = undefined;
  }
  clone() {
    return new ItemStack(this.typeId, this.amount);
  }
}

/* ---------------- components ---------------- */

class HealthComponent {
  constructor(entity) {
    this.entity = entity;
  }
  get currentValue() {
    this.entity._assertValid();
    return this.entity._health;
  }
  get effectiveMax() {
    this.entity._assertValid();
    const boost = this.entity._activeEffect("health_boost");
    const extra = boost ? (boost.amplifier + 1) * 4 : 0;
    return this.entity._baseMaxHealth + extra;
  }
  setCurrentValue(value) {
    this.entity._assertValid();
    this.entity._health = Math.max(0, Math.min(value, this.effectiveMax));
  }
  resetToMaxValue() {
    this.setCurrentValue(this.effectiveMax);
  }
}

class Container {
  constructor(size = 36) {
    this.size = size;
    this.slots = new Array(size).fill(undefined);
  }
  getItem(slot) {
    if (slot < 0 || slot >= this.size) throw new Error(`slot fora do range: ${slot}`);
    return this.slots[slot];
  }
  setItem(slot, item) {
    if (slot < 0 || slot >= this.size) throw new Error(`slot fora do range: ${slot}`);
    this.slots[slot] = item;
  }
  addItem(item) {
    const idx = this.slots.findIndex((s) => s === undefined);
    if (idx !== -1) this.slots[idx] = item;
  }
  getSlot(slot) {
    if (slot < 0 || slot >= this.size) throw new Error(`slot fora do range: ${slot}`);
    return new ContainerSlot(this, slot);
  }
}

// Referencia viva pra uma slot (API 2.0). Ler dado de item numa slot vazia
// lanca no jogo, por isso quem usa pergunta hasItem() antes.
class ContainerSlot {
  constructor(container, slot) {
    this.container = container;
    this.slot = slot;
  }
  hasItem() {
    return this.container.slots[this.slot] !== undefined;
  }
  getItem() {
    return this.container.slots[this.slot];
  }
  setItem(item) {
    this.container.slots[this.slot] = item;
  }
  _item() {
    const item = this.container.slots[this.slot];
    if (!item) throw new Error(`ContainerSlot ${this.slot} vazia: nao tem item pra ler`);
    return item;
  }
  get typeId() {
    return this._item().typeId;
  }
  get amount() {
    return this._item().amount;
  }
  get nameTag() {
    return this._item().nameTag;
  }
  get isValid() {
    return true;
  }
}

// O Bedrock RECUSA a offhand pra item que nao declara minecraft:allow_off_hand,
// e a recusa e muda: setEquipment devolve false, nao lanca nada. O stub le os
// BP/items de verdade pra reproduzir isso - foi exatamente esse silencio que
// deixou a forma gigante do Yammy sem nunca escalar.
const offHandAllowed = new Set();
const wearableSlot = new Map();
try {
  const itemsDir = new URL("../../BP/items/", import.meta.url);
  for (const file of fs.readdirSync(itemsDir)) {
    if (!file.endsWith(".json")) continue;
    const data = JSON.parse(fs.readFileSync(new URL(file, itemsDir), "utf-8"));
    const item = data["minecraft:item"];
    const components = item?.components ?? {};

    const allow = components["minecraft:allow_off_hand"];
    const value = typeof allow === "object" ? allow?.value : allow;
    if (value) offHandAllowed.add(item.description.identifier);

    const wearable = components["minecraft:wearable"];
    if (wearable?.slot) wearableSlot.set(item.description.identifier, wearable.slot);
  }
} catch (e) {
  throw new Error(`stub nao conseguiu ler BP/items pra saber o que veste: ${e.message}`);
}

// slot de equipamento -> slot que o minecraft:wearable precisa declarar
const ARMOR_SLOTS = {
  Head: "slot.armor.head",
  Chest: "slot.armor.chest",
  Legs: "slot.armor.legs",
  Feet: "slot.armor.feet",
};

class EquippableComponent {
  constructor(entity) {
    this.entity = entity;
    this.map = new Map();
  }
  getEquipment(slot) {
    this.entity._assertValid();
    if (slot === EquipmentSlot.Mainhand) {
      return this.entity._inventory.container.getItem(this.entity.selectedSlotIndex);
    }
    return this.map.get(slot);
  }
  setEquipment(slot, item) {
    this.entity._assertValid();
    if (slot === EquipmentSlot.Mainhand) {
      this.entity._inventory.container.setItem(this.entity.selectedSlotIndex, item);
      return true;
    }
    if (slot === EquipmentSlot.Offhand && item && !offHandAllowed.has(item.typeId)) {
      log.rejectedEquipment.push({ target: this.entity.name, slot, typeId: item.typeId });
      return false; // igual ao jogo: nao entra e nao avisa
    }

    // Slot de armadura so aceita item com minecraft:wearable apontando pra ela.
    // Mesma recusa muda da offhand: sem isso, um peitoral sem o componente
    // "funciona" na simulacao e nao veste nada no jogo.
    const needed = ARMOR_SLOTS[slot];
    if (needed && item) {
      const vanilla = item.typeId.startsWith("minecraft:");
      if (!vanilla && wearableSlot.get(item.typeId) !== needed) {
        log.rejectedEquipment.push({ target: this.entity.name, slot, typeId: item.typeId });
        return false;
      }
    }
    if (item === undefined) this.map.delete(slot);
    else this.map.set(slot, item);
    return true;
  }
}

// Camera do player. No jogo o preset "minecraft:free" solta a camera do corpo,
// entao quem usa tem que reposicionar sempre - o stub so guarda o ultimo estado.
class PlayerCamera {
  constructor(entity) {
    this.entity = entity;
    this.preset = undefined;
    this.options = undefined;
  }
  setCamera(preset, options) {
    this.entity._assertValid();
    if (typeof preset !== "string" || !preset.includes(":")) {
      throw new Error(`preset de camera invalido: ${preset}`);
    }
    this.preset = preset;
    this.options = options;
    log.cameras.push({ player: this.entity.name, preset, options });
  }
  clear() {
    this.entity._assertValid();
    this.preset = undefined;
    this.options = undefined;
    log.cameras.push({ player: this.entity.name, preset: undefined });
  }
}

class OnScreenDisplay {
  constructor(entity) {
    this.entity = entity;
  }
  setActionBar(text) {
    this.entity._assertValid();
    log.actionBars.push({ player: this.entity.name, text });
  }
  setTitle(title, options) {
    this.entity._assertValid();
    log.titles.push({ player: this.entity.name, title, options });
  }
}

/* ---------------- entities ---------------- */

let nextEntityId = 1;

export class Entity {
  constructor({ typeId = "minecraft:zombie", name, dimension, location = { x: 0, y: 64, z: 0 }, maxHealth = 20 } = {}) {
    this.id = String(nextEntityId++);
    this.typeId = typeId;
    this.name = name ?? typeId;
    this.nameTag = this.name;
    this.dimension = dimension ?? overworld;
    this._location = { ...location };
    this._tags = new Set();
    this.isSneaking = false;
    this.isSprinting = false;
    this.isOnGround = true;
    this.selectedSlotIndex = 0;

    this._valid = true;
    this._baseMaxHealth = maxHealth;
    this._health = maxHealth;
    this._effects = new Map();
    this._dynamic = new Map();
    this._velocity = { x: 0, y: 0, z: 0 };
    this._view = { x: 0, y: 0, z: 1 };
    this._inventory = { container: new Container(36) };
    this._health_c = new HealthComponent(this);
    this._equippable = new EquippableComponent(this);
    this.onScreenDisplay = new OnScreenDisplay(this);
    this.camera = new PlayerCamera(this);
    this.itemStackComponent = undefined; // usado por entidades minecraft:item

    this.dimension._entities.add(this);
  }

  _assertValid() {
    if (!this._valid) throw new Error("Failed to get property because entity is invalid.");
  }

  // no jogo, player.location devolve uma copia nova a cada acesso - guardar a
  // referencia nao faz o valor "seguir" a entidade. o stub precisa imitar isso.
  get location() {
    this._assertValid();
    return { ...this._location };
  }

  set location(value) {
    this._location = { x: value.x, y: value.y, z: value.z };
  }

  get isValid() {
    return this._valid;
  }

  getComponent(name) {
    this._assertValid();
    switch (name) {
      case "minecraft:health":
      case "health":
        return this._health > 0 ? this._health_c : this._health_c;
      case "minecraft:inventory":
      case "inventory":
        return this._inventory;
      case "minecraft:equippable":
      case "equippable":
        return this._equippable;
      case "minecraft:item":
      case "item":
        return this.itemStackComponent;
      default:
        return undefined;
    }
  }

  getDynamicProperty(key) {
    this._assertValid();
    return this._dynamic.get(key);
  }

  setDynamicProperty(key, value) {
    this._assertValid();
    if (value === undefined) this._dynamic.delete(key);
    else this._dynamic.set(key, value);
  }

  getDynamicPropertyIds() {
    return [...this._dynamic.keys()];
  }

  applyDamage(amount, options = {}) {
    this._assertValid();
    if (typeof amount !== "number" || Number.isNaN(amount)) {
      throw new Error(`applyDamage com valor invalido: ${amount}`);
    }
    log.damages.push({
      target: this.name,
      amount,
      cause: options.cause,
      by: options.damagingEntity?.name,
    });
    this._health = Math.max(0, this._health - amount);
    if (this._health <= 0) this.kill();
    return true;
  }

  kill() {
    if (!this._valid) return;
    this._valid = false;
    this.dimension._entities.delete(this);
  }

  remove() {
    this._assertValid();
    this._valid = false;
    this.dimension._entities.delete(this);
  }

  addTag(tag) {
    this._assertValid();
    if (this._tags.has(tag)) return false;
    this._tags.add(tag);
    return true;
  }
  removeTag(tag) {
    this._assertValid();
    return this._tags.delete(tag);
  }
  hasTag(tag) {
    this._assertValid();
    return this._tags.has(tag);
  }
  getTags() {
    this._assertValid();
    return [...this._tags];
  }

  addEffect(effectType, duration, options = {}) {
    this._assertValid();
    if (typeof effectType !== "string") throw new Error("addEffect precisa de um id de efeito");
    const amplifier = options.amplifier ?? 0;
    // no Bedrock o amplificador e um byte: acima de 255 o efeito nao aplica
    if (!Number.isInteger(amplifier) || amplifier < 0 || amplifier > 255) {
      throw new Error(
        `amplifier fora do range do Bedrock (0-255): ${effectType} amplifier ${amplifier}`
      );
    }
    // jump_boost 128 ja foi o truque de "travar o pulo"; o Bedrock atual le o
    // amplificador sem sinal e o player sai voando. Trava de pulo e holdJump.
    if (effectType === "jump_boost" && amplifier > 10) {
      throw new Error(`jump_boost ${amplifier} vira pulo gigante no jogo: use holdJump`);
    }
    // No Bedrock o efeito novo so substitui o que ja esta ativo quando o
    // amplifier e MAIOR OU IGUAL. Aplicar health_boost 244 por cima de um 255
    // ativo simplesmente nao faz nada - era isso que devolvia o teto errado
    // (e os +44 de vida) ao sair de um awakening.
    const active = this._activeEffect(effectType);
    if (active && active.amplifier > amplifier) {
      log.effects.push({ target: this.name, effectType, duration, amplifier, ignored: true });
      return false;
    }

    this._effects.set(effectType, { amplifier, endTick: currentTick + duration });
    this._clampHealthToMax();
    log.effects.push({ target: this.name, effectType, duration, amplifier });
    return true;
  }

  removeEffect(effectType) {
    this._assertValid();
    this._effects.delete(effectType);
    // tirar o health_boost derruba o teto e o jogo corta a vida atual junto
    this._clampHealthToMax();
    return true;
  }

  // teto real considerando o health_boost ativo (espelha HealthComponent)
  _clampHealthToMax() {
    if (typeof this._baseMaxHealth !== "number") return;
    const boost = this._activeEffect("health_boost");
    const max = this._baseMaxHealth + (boost ? (boost.amplifier + 1) * 4 : 0);
    if (this._health > max) this._health = max;
  }

  // no jogo o efeito some sozinho quando a duracao acaba; sem isso o stub
  // guardaria o efeito pra sempre e esconderia bug de duracao
  _activeEffect(effectType) {
    const effect = this._effects.get(effectType);
    if (!effect) return undefined;
    if (currentTick >= effect.endTick) {
      this._effects.delete(effectType);
      return undefined;
    }
    return effect;
  }

  getEffect(effectType) {
    this._assertValid();
    return this._activeEffect(effectType);
  }

  getVelocity() {
    this._assertValid();
    return { ...this._velocity };
  }

  // raycast simples pela direcao da visao, ordenado do mais perto pro mais longe
  getEntitiesFromViewDirection(options = {}) {
    this._assertValid();
    const maxDistance = options.maxDistance ?? 16;
    const view = this._view;
    const length =
      Math.sqrt(view.x * view.x + view.y * view.y + view.z * view.z) || 1;
    const step = { x: view.x / length, y: view.y / length, z: view.z / length };
    const origin = this._location;

    const hits = [];
    for (const entity of this.dimension.getEntities()) {
      if (entity.id === this.id) continue;
      const dx = entity._location.x - origin.x;
      const dy = entity._location.y - origin.y;
      const dz = entity._location.z - origin.z;

      const along = dx * step.x + dy * step.y + dz * step.z;
      if (along < 0 || along > maxDistance) continue;

      const px = dx - step.x * along;
      const py = dy - step.y * along;
      const pz = dz - step.z * along;
      if (Math.sqrt(px * px + py * py + pz * pz) > 1.8) continue;

      hits.push({ entity, distance: along });
    }
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  }

  getViewDirection() {
    this._assertValid();
    return { ...this._view };
  }

  // {x: pitch, y: yaw} em graus, derivado da direcao da visao
  getRotation() {
    this._assertValid();
    const v = this._view;
    const len = Math.hypot(v.x, v.y, v.z) || 1;
    return {
      x: (-Math.asin(v.y / len) * 180) / Math.PI,
      y: (Math.atan2(-v.x, v.z) * 180) / Math.PI,
    };
  }

  applyKnockback(horizontal, verticalStrength) {
    this._assertValid();
    log.knockbacks.push({
      target: this.name,
      horizontal: { ...horizontal },
      verticalStrength,
      tick: currentTick,
    });
    // API 2.0: applyKnockback(VectorXZ, number)
    if (typeof horizontal !== "object" || horizontal === null) {
      throw new Error("applyKnockback espera um objeto {x, z} na API 2.0");
    }
    if (typeof horizontal.x !== "number" || typeof horizontal.z !== "number") {
      throw new Error("applyKnockback: {x, z} precisam ser numeros");
    }
    if (typeof verticalStrength !== "number") {
      throw new Error("applyKnockback: verticalStrength precisa ser numero");
    }
    return true;
  }

  playAnimation(animationName, options) {
    this._assertValid();
    if (typeof animationName !== "string" || !animationName.startsWith("animation.")) {
      throw new Error(`playAnimation com nome invalido: ${animationName}`);
    }
    // No jogo, animacao tocada SEM controller e sobrescrita na hora pelos
    // animation controllers do proprio player: ela dispara e some no mesmo
    // tick. Isso nao da erro nenhum - simplesmente nao aparece. O stub recusa
    // pra esse silencio nao voltar.
    if (!options || typeof options.controller !== "string" || !options.controller) {
      throw new Error(
        `playAnimation sem controller: ${animationName} seria engolida pelos ` +
          `animation controllers do player`
      );
    }
    log.animations.push({ target: this.name, animationName, options });
    return true;
  }

  applyImpulse(vector) {
    this._assertValid();
    return true;
  }

  teleport(location, options = {}) {
    this._assertValid();
    if (!location || typeof location.x !== "number" || typeof location.y !== "number" || typeof location.z !== "number") {
      throw new Error("teleport com location invalida");
    }
    // rotacao explicita (pitch, yaw) ou mirar num ponto a partir dos PES, como
    // o jogo faz com o facingLocation
    if (options.rotation) {
      const yaw = (options.rotation.y * Math.PI) / 180;
      const pitch = (options.rotation.x * Math.PI) / 180;
      this._view = { x: -Math.sin(yaw) * Math.cos(pitch), y: -Math.sin(pitch), z: Math.cos(yaw) * Math.cos(pitch) };
    } else if (options.facingLocation) {
      const f = options.facingLocation;
      const dx = f.x - location.x;
      const dy = f.y - location.y;
      const dz = f.z - location.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      this._view = { x: dx / len, y: dy / len, z: dz / len };
    }
    if (options.dimension && options.dimension !== this.dimension) {
      this.dimension._entities.delete(this);
      this.dimension = options.dimension;
      this.dimension._entities.add(this);
    }
    this._location = { x: location.x, y: location.y, z: location.z };
    log.teleports.push({ target: this.name, tick: currentTick, options });
    return true;
  }

  sendMessage(message) {
    this._assertValid();
    log.worldMessages.push({ to: this.name, message });
  }

  runCommand(command) {
    this._assertValid();
    log.commands.push({ by: this.name, command });
    return { successCount: 1 };
  }

  runCommandAsync(command) {
    return Promise.resolve(this.runCommand(command));
  }

  playSound(soundId, options) {
    this._assertValid();
    log.sounds.push({ soundId, options, by: this.name });
  }
}

export class Player extends Entity {
  constructor(opts = {}) {
    super({ ...opts, typeId: "minecraft:player" });
    this.inputPermissions = new PlayerInputPermissions(this);
  }
  // particula que so este player ve
  spawnParticle(particleId, location) {
    this._assertValid();
    if (typeof particleId !== "string" || !particleId.includes(":")) {
      throw new Error(`particula com id invalido: ${particleId}`);
    }
    log.particles.push({ particleId, location: { ...location }, onlyFor: this.name });
  }
}

/* ---------------- dimension ---------------- */

function dist3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class BlockPermutation {
  constructor(typeId) {
    this.type = { id: typeId };
  }
  static resolve(typeId) {
    if (typeof typeId !== "string" || !typeId.includes(":")) {
      throw new Error(`BlockPermutation.resolve com id invalido: ${typeId}`);
    }
    return new BlockPermutation(typeId);
  }
  get typeId() {
    return this.type.id;
  }
}

class Block {
  constructor(dimension, location) {
    this.dimension = dimension;
    this.location = { ...location };
    this._permutation = BlockPermutation.resolve("minecraft:air");
  }
  get typeId() {
    return this._permutation.typeId;
  }
  get isAir() {
    return this.typeId === "minecraft:air";
  }
  get permutation() {
    return this._permutation;
  }
  get isLiquid() {
    return /water|lava/.test(this.typeId);
  }
  above(steps = 1) {
    return this.dimension.getBlock({ x: this.location.x, y: this.location.y + steps, z: this.location.z });
  }
  below(steps = 1) {
    return this.dimension.getBlock({ x: this.location.x, y: this.location.y - steps, z: this.location.z });
  }
  setType(typeId) {
    this.setPermutation(BlockPermutation.resolve(typeId));
  }
  setPermutation(permutation) {
    if (!(permutation instanceof BlockPermutation)) {
      throw new Error("setPermutation espera um BlockPermutation");
    }
    this._permutation = permutation;
    log.blocks.push({
      location: { ...this.location },
      typeId: permutation.typeId,
      tick: currentTick,
    });
  }
}

export class Dimension {
  constructor(id) {
    this.id = id;
    this._entities = new Set();
    this._blocks = new Map();
  }

  // o jogo devolve o bloco pela coordenada inteira, e undefined em chunk
  // descarregado - quem usa tem que aguentar os dois casos
  getBlock(location) {
    if (!location || typeof location.x !== "number" || Number.isNaN(location.x) ||
        typeof location.y !== "number" || Number.isNaN(location.y) ||
        typeof location.z !== "number" || Number.isNaN(location.z)) {
      throw new Error("getBlock com location invalida");
    }
    const key = `${Math.floor(location.x)},${Math.floor(location.y)},${Math.floor(location.z)}`;
    let block = this._blocks.get(key);
    if (!block) {
      block = new Block(this, {
        x: Math.floor(location.x),
        y: Math.floor(location.y),
        z: Math.floor(location.z),
      });
      this._blocks.set(key, block);
    }
    return block;
  }

  spawnParticle(particleId, location, molang) {
    if (typeof particleId !== "string" || !particleId.includes(":")) {
      throw new Error(`particula com id invalido: ${particleId}`);
    }
    if (!location || typeof location.x !== "number" || Number.isNaN(location.x) ||
        typeof location.y !== "number" || Number.isNaN(location.y) ||
        typeof location.z !== "number" || Number.isNaN(location.z)) {
      throw new Error(`spawnParticle com location invalida para ${particleId}`);
    }
    log.particles.push({ particleId, location: { ...location } });
  }

  playSound(soundId, location, options) {
    if (typeof soundId !== "string") throw new Error("playSound sem id");
    log.sounds.push({ soundId, location, options });
  }

  getEntities(options = {}) {
    let list = [...this._entities].filter((e) => e._valid);
    if (options.location && typeof options.maxDistance === "number") {
      list = list.filter((e) => dist3(e._location, options.location) <= options.maxDistance);
    }
    if (options.type) list = list.filter((e) => e.typeId === options.type);
    if (options.excludeTypes) list = list.filter((e) => !options.excludeTypes.includes(e.typeId));
    return list;
  }

  getPlayers(options = {}) {
    return this.getEntities({ ...options, type: "minecraft:player" });
  }

  spawnEntity(typeId, location) {
    const e = new Entity({ typeId, dimension: this, location });
    world.afterEvents.entitySpawn._emit({ entity: e, cause: "Spawned" });
    return e;
  }

  // existe pra provar que NINGUEM chama: o Stomp so pode soltar particula
  createExplosion(location, radius, options) {
    log.explosions.push({ location, radius, options });
    return true;
  }

  runCommand(command) {
    log.commands.push({ by: `dimension:${this.id}`, command });
    return { successCount: 1 };
  }
}

export const overworld = new Dimension("minecraft:overworld");
const dimensions = new Map([
  ["minecraft:overworld", overworld],
  ["overworld", overworld],
  ["minecraft:nether", new Dimension("minecraft:nether")],
  ["minecraft:the_end", new Dimension("minecraft:the_end")],
]);

/* ---------------- events ---------------- */

class EventSignal {
  constructor(name) {
    this.name = name;
    this.listeners = [];
  }
  subscribe(cb, options) {
    this.listeners.push(cb);
    return cb;
  }
  unsubscribe(cb) {
    const i = this.listeners.indexOf(cb);
    if (i !== -1) this.listeners.splice(i, 1);
  }
  _emit(ev) {
    for (const cb of [...this.listeners]) {
      try {
        cb(ev);
      } catch (e) {
        record(e, `evento ${this.name}`);
      }
    }
  }
  get listenerCount() {
    return this.listeners.length;
  }
}

const afterEvents = {
  playerSpawn: new EventSignal("playerSpawn"),
  playerLeave: new EventSignal("playerLeave"),
  itemUse: new EventSignal("itemUse"),
  entityHitEntity: new EventSignal("entityHitEntity"),
  entitySpawn: new EventSignal("entitySpawn"),
  entityDie: new EventSignal("entityDie"),
  entityHurt: new EventSignal("entityHurt"),
  playerBreakBlock: new EventSignal("playerBreakBlock"),
  entityHitBlock: new EventSignal("entityHitBlock"),
  dataDrivenEntityTrigger: new EventSignal("dataDrivenEntityTrigger"),
  playerButtonInput: new EventSignal("playerButtonInput"),
};

const beforeEvents = {
  itemUse: new EventSignal("before:itemUse"),
  playerBreakBlock: new EventSignal("before:playerBreakBlock"),
  playerLeave: new EventSignal("before:playerLeave"),
  chatSend: new EventSignal("before:chatSend"),
};

export const world = {
  afterEvents,
  beforeEvents,
  _players: [],
  _dynamic: new Map(),
  getPlayers(options = {}) {
    let list = world._players.filter((p) => p._valid);
    if (options.name) list = list.filter((p) => p.name === options.name);
    return list;
  },
  getAllPlayers() {
    return world.getPlayers();
  },
  getDimension(id) {
    const d = dimensions.get(id);
    if (!d) throw new Error(`dimensao desconhecida: ${id}`);
    return d;
  },
  sendMessage(message) {
    log.worldMessages.push({ to: "*", message });
  },
  getDynamicProperty(key) {
    return world._dynamic.get(key);
  },
  setDynamicProperty(key, value) {
    if (value === undefined) world._dynamic.delete(key);
    else world._dynamic.set(key, value);
  },
};

/* ---------------- helpers pro harness ---------------- */

export function createPlayer(name, location = { x: 0, y: 64, z: 0 }, maxHealth = 20) {
  const p = new Player({ name, dimension: overworld, location, maxHealth });
  world._players.push(p);
  return p;
}

export function createDummy(name, location = { x: 0, y: 64, z: 0 }, maxHealth = 500) {
  return new Entity({ typeId: "minecraft:zombie", name, dimension: overworld, location, maxHealth });
}

export function emit(eventName, payload) {
  const signal = afterEvents[eventName];
  if (!signal) throw new Error(`evento desconhecido no stub: ${eventName}`);
  signal._emit(payload);
}

export function clearLogs() {
  for (const key of Object.keys(log)) log[key].length = 0;
}
