import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

/* ---------------------------------------------------------
   Shukuro Tsukishima - Tier 3 (Fullbringer)

   Individualidade: no lugar do Awakening ele tem "Escritas". Cada opcao dos
   Books of the End (Alvo e Eu) gasta 1; ele comeca com 1 e ganha 1 a cada 25s
   (teto 5). Sem Escritas os dois Books nem abrem o menu.
   O m1 (Sword of the End) marca o player acertado e guarda um registro dele
   no Book of the End (Registros), congelado no momento da marcacao.
   --------------------------------------------------------- */

export const TSUKISHIMA = {
  m1Item: "tsukishima:m1_sword_of_the_end",
  registros: "tsukishima:book_registros",
  alvo: "tsukishima:book_alvo",
  eu: "tsukishima:book_eu",
  damage: { m1: 70 },
  writs: { start: 1, max: 5, regenSeconds: 25 },
  cutFraction: 0.2, // Cortar: 20% da vida maxima do alvo
  hitsAwakeningLoss: 5, // Hits nao tomados: -5% de awakening do alvo
  restHeal: 350, // Descansado
  friendTicks: 300, // Eu sou seu amigo: 15s
  falseMemoriesTicks: 300, // Falsas Memorias: nao foi especificado, 15s
  hitMemoryTicks: 1200, // por quanto tempo o "Hits nao tomados" lembra do golpe
  cooldowns: {
    "tsukishima:alvo.cortar": 200, // 10s
    "tsukishima:alvo.errar": 400, // 20s
    "tsukishima:alvo.zanpakuto": 600, // 30s
    "tsukishima:alvo.hits": 500, // 25s
    "tsukishima:eu.amigo": 700, // 35s
    "tsukishima:eu.descansado": 500, // 25s
    "tsukishima:eu.falsas": 700, // 35s
  },
  names: {
    "tsukishima:alvo.cortar": "Cortar",
    "tsukishima:alvo.errar": "Errar o ataque",
    "tsukishima:alvo.zanpakuto": "Recuperar Zanpakuto",
    "tsukishima:alvo.hits": "Hits não tomados",
    "tsukishima:eu.amigo": "Eu sou seu amigo",
    "tsukishima:eu.descansado": "Descansado",
    "tsukishima:eu.falsas": "Falsas Memórias",
  },
};

const DP_WRITS = "mv:tsukishima_writs";
const DIMENSION_NAMES = {
  "minecraft:overworld": "Overworld",
  "minecraft:nether": "Nether",
  "minecraft:the_end": "The End",
};

export function createTsukishima(api) {
  // Map<idDoTsukishima, Map<idDoAlvo, registro>>
  const marks = new Map();
  // Map<idDoTsukishima, Map<idDoAtacante, { skill, amount, tick }>>
  const hitsTaken = new Map();
  const friendUntil = new Map();
  const falseUntil = new Map();
  const progress = new Map(); // segundos ate a proxima Escrita

  const cfg = TSUKISHIMA;
  const alive = (e) => {
    try {
      return !!e && !api.isDownOrGone(e);
    } catch (err) {
      return false;
    }
  };
  const ours = (e) => {
    try {
      return e?.typeId === "minecraft:player" && api.getActiveCharacter(e)?.id === "tsukishima";
    } catch (err) {
      return false;
    }
  };
  const playerById = (id) => {
    try {
      return world.getPlayers().find((p) => p.id === id);
    } catch (err) {
      return undefined;
    }
  };

  /* ---------- Escritas ---------- */

  function writsOf(player) {
    const n = Number(player.getDynamicProperty(DP_WRITS));
    return Number.isFinite(n) ? Math.max(0, Math.min(cfg.writs.max, Math.floor(n))) : 0;
  }
  function setWrits(player, n) {
    player.setDynamicProperty(DP_WRITS, Math.max(0, Math.min(cfg.writs.max, n)));
  }
  function spendWrit(player) {
    setWrits(player, writsOf(player) - 1);
  }
  function noWrits(player) {
    player.sendMessage(
      `§7Você está sem Escritas. Ganha 1 a cada ${cfg.writs.regenSeconds}s (máximo ${cfg.writs.max}).`
    );
  }

  system.runInterval(() => {
    for (const player of world.getPlayers()) {
      if (!ours(player)) continue;
      try {
        const n = writsOf(player);
        if (n >= cfg.writs.max) {
          progress.set(player.id, 0);
          continue;
        }
        const seconds = (progress.get(player.id) ?? 0) + 1;
        if (seconds >= cfg.writs.regenSeconds) {
          setWrits(player, n + 1);
          progress.set(player.id, 0);
        } else {
          progress.set(player.id, seconds);
        }
      } catch (err) {
        // player saindo do mundo
      }
    }
  }, 20);

  function hud(player) {
    const friend = (friendUntil.get(player.id) ?? 0) > system.currentTick ? " §a✦Amigo" : "";
    const falseMem = (falseUntil.get(player.id) ?? 0) > system.currentTick ? " §5✦Falsas Memórias" : "";
    return `   §d✒ Escritas: ${writsOf(player)}/${cfg.writs.max}${friend}${falseMem}`;
  }

  /* ---------- ciclo de vida ---------- */

  function clearState(id) {
    marks.delete(id);
    hitsTaken.delete(id);
    friendUntil.delete(id);
    falseUntil.delete(id);
    progress.delete(id);
  }

  function onActivate(player) {
    clearState(player.id);
    setWrits(player, cfg.writs.start);
  }

  function reset(player) {
    if ((friendUntil.get(player.id) ?? 0) > system.currentTick) {
      try {
        player.removeEffect("resistance");
      } catch (err) {}
    }
    clearState(player.id);
  }

  function leave(playerId) {
    clearState(playerId);
  }

  function onSpawn(player, initialSpawn) {
    if (initialSpawn || !ours(player)) return;
    // morreu: os Books recomecam do zero
    clearState(player.id);
    setWrits(player, cfg.writs.start);
  }

  /* ---------- m1: marca e Falsas Memorias ---------- */

  function mark(player, target) {
    if (!ours(player) || target?.typeId !== "minecraft:player" || target.id === player.id) return;
    try {
      const own = marks.get(player.id) ?? new Map();
      marks.set(player.id, own);
      const first = !own.has(target.id);
      const attack = api.lastAttackOf(target);
      own.set(target.id, {
        id: target.id,
        name: target.name,
        hp: Math.round(api.virtualHealth(target)),
        max: Math.round(api.maxHealth(target)),
        x: Math.floor(target.location.x),
        y: Math.floor(target.location.y),
        z: Math.floor(target.location.z),
        dim: target.dimension.id,
        debuffs: api.debuffsOf(target),
        lastAttack: attack ? attack.name : null,
        awakening: Math.round(api.getAwakening(target)),
        awakened: api.isAwakened(target),
      });
      // o aviso sai so na primeira vez que o alvo entra no Book
      if (first) player.sendMessage(`§7[Book of the End] §f${target.name} §7foi registrado.`);
    } catch (err) {
      // alvo saiu do mundo no meio do golpe
    }
  }

  function m1Damage(player, target, base) {
    if ((falseUntil.get(player.id) ?? 0) <= system.currentTick) return base;
    if (target?.typeId !== "minecraft:player") return base;
    const theirs = api.m1DamageOf(target);
    return typeof theirs === "number" && theirs > 0 ? theirs : base;
  }

  /* ---------- Eu sou seu amigo + Hits nao tomados ---------- */

  // true = o golpe nao entra. Enquanto "Eu sou seu amigo" dura, o Tsukishima
  // nao causa nem recebe dano.
  function blocksDamage(target, source) {
    const now = system.currentTick;
    if (target && (friendUntil.get(target.id) ?? 0) > now && ours(target)) return true;
    if (source && (friendUntil.get(source.id) ?? 0) > now && ours(source)) return true;
    return false;
  }

  // chamado por dealDamage com o dano final que vai entrar
  function onDamaged(target, source, amount) {
    try {
      if (!ours(target) || source?.typeId !== "minecraft:player" || source.id === target.id) return;
      if (!(amount > 0)) return;
      const now = system.currentTick;
      const attack = api.lastAttackOf(source);
      const skill = attack && now - attack.tick <= 300 ? attack.name : "o ataque";
      const own = hitsTaken.get(target.id) ?? new Map();
      hitsTaken.set(target.id, own);
      own.set(source.id, { skill, amount, tick: now });
    } catch (err) {}
  }

  /* ---------- menus ---------- */

  function listOf(player) {
    return [...(marks.get(player.id)?.values() ?? [])];
  }

  function cooldownLine(player, key) {
    const total = cfg.cooldowns[key];
    if (!total) return "§8sem recarga";
    const left = api.cooldownLeftTicks(player, key);
    return left > 0 ? `§8${total / 20}s • §c${Math.ceil(left / 20)}s` : `§8${total / 20}s • §apronto`;
  }

  function openRegistros(player) {
    const list = listOf(player);
    if (!list.length) {
      player.sendMessage("§7O Book of the End ainda não tem registros. Acerte alguém com a espada.");
      return;
    }
    const form = new ActionFormData()
      .title("Book of the End — Registros")
      .body("§7Escolha um nome. O registro mostra o alvo no momento em que foi marcado, não agora.");
    for (const r of list) form.button(r.name);
    form.show(player).then((res) => {
      if (res.canceled || res.selection === undefined) return;
      const r = list[res.selection];
      if (r) showRecord(player, r);
    });
  }

  function showRecord(player, r) {
    const awkColor = r.awakened ? "§a" : "§c";
    const debuffs = r.debuffs.length ? r.debuffs.join(", ") : "Nenhum";
    const form = new ActionFormData()
      .title(r.name)
      .body(
        `§cHP: §f${r.hp}/${r.max}\n` +
          `§bCoordenadas: §f${r.x}, ${r.y}, ${r.z} §7(${DIMENSION_NAMES[r.dim] ?? r.dim})\n` +
          `§6Debuff: §f${debuffs}\n` +
          `§eÚltimo ataque: §f${r.lastAttack ?? "Nenhum"}\n` +
          `§dAwakening: ${awkColor}${r.awakening}%\n\n` +
          `§8Registro do momento da marcação.`
      )
      .button("Voltar");
    form.show(player).then((res) => {
      if (!res.canceled && res.selection === 0) openRegistros(player);
    });
  }

  const ALVO_OPTIONS = [
    { key: "tsukishima:alvo.cortar", label: (n) => `Cortar ${n}` },
    { key: "tsukishima:alvo.errar", label: () => "Errar o ataque" },
    { key: "tsukishima:alvo.zanpakuto", label: () => "Recuperar Zanpakuto" },
    { key: "tsukishima:alvo.hits", label: () => "Hits não tomados" },
    { key: "tsukishima:alvo.atacado", label: () => "Você foi atacado por..." },
  ];

  function openAlvo(player) {
    if (writsOf(player) < 1) {
      noWrits(player);
      return;
    }
    const list = listOf(player);
    if (!list.length) {
      player.sendMessage("§7Nenhum alvo marcado. Acerte alguém com a espada primeiro.");
      return;
    }
    const form = new ActionFormData()
      .title("Book of the End — Alvo")
      .body(`§7Escolha quem terá o passado alterado. Cada opção gasta 1 Escrita (você tem ${writsOf(player)}).`);
    for (const r of list) form.button(playerById(r.id) ? r.name : `${r.name}\n§8fora do mundo`);
    form.show(player).then((res) => {
      if (res.canceled || res.selection === undefined) return;
      const r = list[res.selection];
      if (r) openAlvoOptions(player, r);
    });
  }

  function openAlvoOptions(player, r) {
    if (writsOf(player) < 1) {
      noWrits(player);
      return;
    }
    const form = new ActionFormData()
      .title(`Alterar o passado de ${r.name}`)
      .body(`§7Cada opção gasta 1 Escrita (você tem ${writsOf(player)}).`);
    for (const opt of ALVO_OPTIONS) {
      form.button(`${opt.label(r.name)}\n${opt.key === "tsukishima:alvo.atacado" ? "§8sem recarga" : cooldownLine(player, opt.key)}`);
    }
    form.show(player).then((res) => {
      if (res.canceled || res.selection === undefined) return;
      const opt = ALVO_OPTIONS[res.selection];
      if (opt) execAlvo(player, opt.key, r);
    });
  }

  const EU_OPTIONS = [
    { key: "tsukishima:eu.amigo", label: "Eu sou seu amigo" },
    { key: "tsukishima:eu.descansado", label: "Descansado" },
    { key: "tsukishima:eu.falsas", label: "Falsas Memórias" },
  ];

  function openEu(player) {
    if (writsOf(player) < 1) {
      noWrits(player);
      return;
    }
    const form = new ActionFormData()
      .title("Book of the End — Eu")
      .body(`§7Cada opção gasta 1 Escrita (você tem ${writsOf(player)}).`);
    for (const opt of EU_OPTIONS) form.button(`${opt.label}\n${cooldownLine(player, opt.key)}`);
    form.show(player).then((res) => {
      if (res.canceled || res.selection === undefined) return;
      const opt = EU_OPTIONS[res.selection];
      if (opt) execEu(player, opt.key);
    });
  }

  /* ---------- Book of the End (Alvo) ---------- */

  const say = (player, text) => world.sendMessage(`§5${player.name}: §f${text}`);

  function friendActive(player) {
    return (friendUntil.get(player.id) ?? 0) > system.currentTick;
  }

  function execAlvo(player, key, r) {
    try {
      if (!ours(player) || api.isBlocked(player)) return;
      if (writsOf(player) < 1) {
        noWrits(player);
        return;
      }
      // Recuperar Zanpakuto depende do Yhwach (update futuro): por enquanto so avisa,
      // sem gastar Escrita nem entrar em recarga
      if (key === "tsukishima:alvo.zanpakuto") {
        player.sendMessage(
          `§7A zanpakuto de ${r.name} não foi destruída. Essa opção só terá efeito quando o Yhwach existir no addon.`
        );
        return;
      }
      const target = playerById(r.id);
      if (!target || !alive(target)) {
        player.sendMessage(`§7${r.name} não está no mundo agora.`);
        return;
      }
      if ((key === "tsukishima:alvo.cortar" || key === "tsukishima:alvo.atacado") && friendActive(player)) {
        player.sendMessage("§7Com \"Eu sou seu amigo\" ativo você não pode causar dano.");
        return;
      }
      switch (key) {
        case "tsukishima:alvo.cortar":
          return doCortar(player, target);
        case "tsukishima:alvo.errar":
          return doErrar(player, target);
        case "tsukishima:alvo.hits":
          return doHitsNaoTomados(player, target);
        case "tsukishima:alvo.atacado":
          return doAtacadoPor(player, target);
      }
    } catch (err) {
      // alvo saiu no meio da acao
    }
  }

  function doCortar(player, target) {
    if (!api.tryUseSkill(player, "tsukishima:alvo.cortar")) return;
    spendWrit(player);
    const damage = api.maxHealth(target) * cfg.cutFraction;
    try {
      const l = target.location;
      for (let i = 0; i < 8; i++) {
        target.dimension.spawnParticle("minecraft:crit_particle", {
          x: l.x + (Math.random() - 0.5) * 1.2,
          y: l.y + 0.4 + Math.random() * 1.4,
          z: l.z + (Math.random() - 0.5) * 1.2,
        });
      }
      target.dimension.playSound("item.trident.hit", l, { volume: 1, pitch: 0.8 });
    } catch (err) {}
    api.dealDamage(target, damage, player);
    say(player, `${target.name} deixou ser cortado por mim`);
  }

  function doErrar(player, target) {
    const ready = api.skillKeysOf(target).filter((k) => api.cooldownLeftTicks(target, k) <= 0);
    if (!ready.length) {
      player.sendMessage(`§7${target.name} não tem nenhuma skill pronta pra errar agora.`);
      return;
    }
    if (!api.tryUseSkill(player, "tsukishima:alvo.errar")) return;
    spendWrit(player);
    const key = ready[Math.floor(Math.random() * ready.length)];
    // so liga o recarrego da skill: ela nao chega a sair
    api.forceCooldown(target, key);
    say(player, `${target.name} errou a skill vergonhosamente`);
  }

  function doHitsNaoTomados(player, target) {
    const rec = hitsTaken.get(player.id)?.get(target.id);
    if (!rec || system.currentTick - rec.tick > cfg.hitMemoryTicks) {
      player.sendMessage(`§7Nenhuma skill de ${target.name} te acertou recentemente.`);
      return;
    }
    if (!api.tryUseSkill(player, "tsukishima:alvo.hits")) return;
    spendWrit(player);
    hitsTaken.get(player.id)?.delete(target.id);
    // recupera a vida que o golpe tirou do Tsukishima
    api.healVirtual(player, rec.amount);
    // e tira 5% do awakening do alvo
    try {
      const awk = api.getAwakening(target);
      if (awk > 0) api.setAwakening(target, Math.max(0, awk - cfg.hitsAwakeningLoss));
    } catch (err) {}
    say(player, `${rec.skill} nunca me atingiu`);
  }

  function doAtacadoPor(player, target) {
    const pool = api.attackPool.filter(
      (c) => c.id !== api.getActiveCharacter(target)?.id && c.skills.length
    );
    if (!pool.length) return;
    spendWrit(player);
    const attacker = pool[Math.floor(Math.random() * pool.length)];
    const [skillName, damage] = attacker.skills[Math.floor(Math.random() * attacker.skills.length)];
    say(player, `${target.name} foi atacado por ${attacker.name}, ele usou ${skillName}`);
    try {
      const l = target.location;
      target.dimension.playSound("random.explode", l, { volume: 0.6, pitch: 1.3 });
      for (let i = 0; i < 6; i++) {
        target.dimension.spawnParticle("minecraft:crit_particle", {
          x: l.x + (Math.random() - 0.5) * 1.2,
          y: l.y + 0.4 + Math.random() * 1.4,
          z: l.z + (Math.random() - 0.5) * 1.2,
        });
      }
    } catch (err) {}
    api.dealDamage(target, damage, player);
  }

  /* ---------- Book of the End (Eu) ---------- */

  function execEu(player, key) {
    try {
      if (!ours(player) || api.isBlocked(player)) return;
      if (writsOf(player) < 1) {
        noWrits(player);
        return;
      }
      if (!api.tryUseSkill(player, key)) return;
      spendWrit(player);
      const now = system.currentTick;
      switch (key) {
        case "tsukishima:eu.amigo": {
          const until = now + cfg.friendTicks;
          friendUntil.set(player.id, until);
          // dano de fora (DOT, queda etc.) que nao passe por dealDamage
          try {
            player.addEffect("resistance", cfg.friendTicks, { amplifier: 255, showParticles: false });
          } catch (err) {}
          player.sendMessage(
            `§a"Eu sou seu amigo": por ${cfg.friendTicks / 20}s ninguém te causa dano e você não causa dano a ninguém.`
          );
          system.runTimeout(() => {
            if (friendUntil.get(player.id) !== until) return;
            friendUntil.delete(player.id);
            try {
              player.sendMessage("§7\"Eu sou seu amigo\" acabou.");
            } catch (err) {}
          }, cfg.friendTicks);
          return;
        }
        case "tsukishima:eu.descansado":
          api.healVirtual(player, cfg.restHeal);
          return;
        case "tsukishima:eu.falsas": {
          const until = now + cfg.falseMemoriesTicks;
          falseUntil.set(player.id, until);
          player.sendMessage(
            `§5Falsas Memórias: por ${cfg.falseMemoriesTicks / 20}s seu m1 causa o dano do m1 de quem você acertar.`
          );
          system.runTimeout(() => {
            if (falseUntil.get(player.id) !== until) return;
            falseUntil.delete(player.id);
            try {
              player.sendMessage("§7As Falsas Memórias acabaram.");
            } catch (err) {}
          }, cfg.falseMemoriesTicks);
          return;
        }
      }
    } catch (err) {}
  }

  /* ---------- entrada dos itens ---------- */

  function cast(player, itemId) {
    if (!ours(player)) return;
    if (itemId === cfg.registros) {
      openRegistros(player);
      return;
    }
    if (api.isBlocked(player)) {
      player.sendMessage("§7Você está preso e não consegue usar os Books agora.");
      return;
    }
    if (itemId === cfg.alvo) openAlvo(player);
    else if (itemId === cfg.eu) openEu(player);
  }

  return { cast, hud, mark, m1Damage, blocksDamage, onDamaged, onActivate, reset, leave, onSpawn };
}
