import { world, system } from "@minecraft/server";

export const ISSHIN = {
  damage: { m1: 70, tensho: 450, cross: 615, engetsu: 220, family: 1500, sun: 3000, burn: 20 },
  cooldowns: { "isshin:getsuga_tensho": 500, "isshin:getsuga_x": 700, "isshin:engetsu": 260, "isshin:pai_e_filho": 1600 },
  names: { "isshin:getsuga_tensho": "Getsuga Tenshō", "isshin:getsuga_x": "Getsuga X", "isshin:engetsu": "Engetsu", "isshin:pai_e_filho": "Getsuga Pai e Filho" },
  // O padrao do Ichigo anda 2 blocos/tick; Super Nuke e o mais rapido anterior (6).
  blue: { radius: 1.8, thickness: .9, lateral: .65, bulge: 1.5, speed: 1.4, range: 28, startAhead: .8 },
  fire: { radius: 2.4, thickness: 1.2, lateral: .9, bulge: 2, speed: 8, range: 48, startAhead: 1 },
  family: { radius: 6, thickness: 3, lateral: 2.5, bulge: 4.5, speed: 4, range: 60, startAhead: 1.5, charge: 30 },
  cross: { radius: 3.4, thickness: 1.2, lateral: .65, bulge: .8, offset: 2.5, duration: 10 },
  sunScale: 3, sunCharge: 20,
  looks: {
    blue: { coreParticle: "ichigo:getsuga", edgeParticle: "ichigo:reiatsu", boltParticle: "isshin:azul", points: 15, litePoints: 9, bolts: 0, boltSegments: 0, boltStep: .3 },
    fire: { coreParticle: "isshin:chama", edgeParticle: "isshin:lamina", boltParticle: "isshin:brasa", points: 21, litePoints: 11, bolts: 3, boltSegments: 4, boltStep: .5 },
    family: { coreParticle: "isshin:negro", edgeParticle: "isshin:fogo_negro", boltParticle: "isshin:brasa", points: 25, litePoints: 15, bolts: 4, boltSegments: 5, boltStep: .65 },
    sun: { coreParticle: "isshin:chama", edgeParticle: "isshin:sol", boltParticle: "isshin:brasa", points: 29, litePoints: 17, bolts: 4, boltSegments: 5, boltStep: .8 },
  },
};

export function createIsshin(api) {
  const ETERNAL = "mv:isshin_eternal", TAG = "isshin_eternal";
  const burns = new Map(), charges = new Map(), projectiles = new Set(), combos = new Map(), generations = new Map();
  const alive = e => { try { return !!e && !api.isDownOrGone(e); } catch { return false; } };
  const char = e => { try { return api.getActiveCharacter(e)?.id; } catch { return undefined; } };
  const ours = e => char(e) === "isshin";
  const generation = p => generations.get(p.id) ?? 0;
  const active = (p,g) => alive(p) && ours(p) && generation(p) === g;
  const copy = p => ({x:p.x,y:p.y,z:p.z});
  const body = e => ({x:e.location.x,y:e.location.y+1,z:e.location.z});
  const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,a.z-b.z);
  const lerp = (a,b,t) => ({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});
  const emit = (dim,id,at) => { try { dim.spawnParticle(id,at); } catch {} };
  const sound = (dim,id,at,pitch=1,volume=1) => { try { dim.playSound(id,at,{pitch,volume}); } catch {} };
  const remove = e => { try { e?.remove(); } catch {} };
  const near = (dim,at,r) => { try { return dim.getEntities({location:at,maxDistance:r}); } catch { return []; } };
  const canHit = (p,e) => alive(e) && e.id!==p.id && !e.typeId.startsWith("isshin:") && !api.isOwnSummon(p,e);
  const hp = e => { try { return e.getComponent("minecraft:health")?.currentValue ?? 0; } catch { return 0; } };
  const lifeKey = id => "mv:isshin_life_"+String(id).replace(/[^a-zA-Z0-9_]/g,"_");
  const life = id => { try { return Number(world.getDynamicProperty(lifeKey(id))) || 0; } catch { return 0; } };
  const currentOwner = id => world.getPlayers().find(p=>p.id===id);
  function saveBurns(state) {
    const entries=[...state.sources.values()].filter(b=>b.remaining===-1).map(b=>({owner:b.owner,life:b.life}));
    try {
      state.e.setDynamicProperty(ETERNAL,entries.length?JSON.stringify(entries):undefined);
      if(entries.length)state.e.addTag(TAG);else state.e.removeTag(TAG);
    } catch {}
  }
  function ignite(e,p,seconds,eternal=false) {
    if(!canHit(p,e))return;
    let state=burns.get(e.id);
    if(!state){state={e,sources:new Map()};burns.set(e.id,state);}
    const prior=state.sources.get(p.id);
    if(prior?.remaining===-1 && prior.life===life(p.id))return;
    state.sources.set(p.id,{owner:p.id,source:p,life:life(p.id),remaining:eternal?-1:Math.max(seconds,prior?.remaining??0),next:prior?.next??system.currentTick+20});
    if(eternal)saveBurns(state);
  }
  function hydrate(e) {
    if(!alive(e))return;
    let data;try{data=JSON.parse(e.getDynamicProperty(ETERNAL)??"null");}catch{return;}
    if(!Array.isArray(data))return;
    let state=burns.get(e.id);if(!state){state={e,sources:new Map()};burns.set(e.id,state);}
    for(const b of data)if(typeof b.owner==="string"&&life(b.owner)===b.life&&!state.sources.has(b.owner))
      state.sources.set(b.owner,{owner:b.owner,source:currentOwner(b.owner),life:b.life,remaining:-1,next:system.currentTick+20});
    saveBurns(state);
    if(!state.sources.size)burns.delete(e.id);
  }
  function burnTick() {
    const now=system.currentTick;
    for(const[id,state]of burns) {
      if(!alive(state.e)){burns.delete(id);continue;}
      let changed=false;
      for(const[key,b]of state.sources) {
        if(b.remaining===-1&&life(b.owner)!==b.life){state.sources.delete(key);changed=true;continue;}
        if(now<b.next)continue;
        b.next=now+20;
        const source=currentOwner(b.owner)??(alive(b.source)?b.source:undefined);
        let multiplier=1;try{if(source)multiplier=api.dmgMultiplier(source);}catch{}
        try{api.dealDamage(state.e,ISSHIN.damage.burn*multiplier,source,{burn:true});}
        catch{try{api.dealDamage(state.e,ISSHIN.damage.burn,undefined,{burn:true});}catch{}}
        if(b.remaining!==-1 && --b.remaining<=0)state.sources.delete(key);
      }
      if(changed)saveBurns(state);
      if(!state.sources.size)burns.delete(id);
      else if(now%4===0){const c=body(state.e);emit(state.e.dimension,"isshin:chama",{x:c.x+.3*Math.sin(now),y:c.y-.5,z:c.z});emit(state.e.dimension,"isshin:brasa",{x:c.x-.3,y:c.y+.3,z:c.z});}
    }
  }
  function strike(p,e,damage,seconds=0,eternal=false) {
    if(!canHit(p,e))return false;
    const before=hp(e);api.dealDamage(e,damage*api.dmgMultiplier(p),p);
    const hit=hp(e)<before;
    if(hit&&seconds)ignite(e,p,seconds,eternal);
    return hit;
  }
  function announce(p,name) {
    world.sendMessage(`§6${p.name}: §l${name}`);
    try{api.playVizardAnimation(p,"slash",false);}catch{}
    sound(p.dimension,"mob.wither.shoot",p.location,.65,1.5);
  }
  function cutHits(e,c,frame,cfg) {
    const b=body(e),dx=b.x-c.x,dy=b.y-c.y,dz=b.z-c.z;
    const along=dx*frame.dir.x+dy*frame.dir.y+dz*frame.dir.z;
    const v=dx*frame.up.x+dy*frame.up.y+dz*frame.up.z;
    const lat=dx*frame.side.x+dy*frame.side.y+dz*frame.side.z;
    if(Math.abs(v)>cfg.radius+.6||Math.abs(lat)>cfg.lateral+.35)return false;
    const front=api.arcAlong(cfg,v);
    return along<=front+.6 && along>=front-cfg.thickness-.6;
  }
  function fire(p,cfg,look,damage,seconds=0,eternal=false,opts={}) {
    const dim=p.dimension,g=generation(p),frame=api.crescentFrame(opts.direction??p.getViewDirection());
    const pos=opts.origin??p.location,start={x:pos.x,y:pos.y+1.1,z:pos.z};
    const at=d=>({x:start.x+frame.dir.x*d,y:start.y+frame.dir.y*d,z:start.z+frame.dir.z*d});
    const attack=api.trackAttack(p,cfg.radius);const state={p,g,attack,hit:new Set(),done:opts.done};projectiles.add(state);
    let travel=cfg.startAhead??0;
    const finish=()=>{attack.cancelled=true;projectiles.delete(state);system.clearRun(state.timer);state.done?.();};
    state.finish=finish;
    state.timer=system.runInterval(()=>{
      if(!active(p,g)||p.dimension.id!==dim.id||attack.cancelled){finish();return;}
      const from=travel;travel=Math.min(cfg.range,travel+cfg.speed);
      const center=at(travel);api.touchAttack(attack,center,cfg.radius);
      api.drawCrescent(dim,center,frame,cfg,look,false,travel-from);
      const candidates=near(dim,at((from+travel)/2),cfg.radius+cfg.thickness+cfg.lateral+cfg.speed+3);
      // Sub-passos menores que a lamina evitam atravessar alvos com o Engetsu de 8 blocos/tick.
      const steps=Math.max(1,Math.ceil((travel-from)/.4));
      for(const e of candidates) {
        if(!canHit(p,e)||state.hit.has(e.id))continue;
        const b=body(e),relative={x:b.x-start.x,y:b.y-start.y,z:b.z-start.z};
        if(relative.x*frame.dir.x+relative.y*frame.dir.y+relative.z*frame.dir.z<-.5)continue;
        let intersect=false;
        for(let k=0;k<=steps;k++)if(cutHits(e,at(from+(travel-from)*k/steps),frame,cfg)){intersect=true;break;}
        if(!intersect)continue;
        state.hit.add(e.id);
        if(api.isRespiring(e)){api.showRespiraGuard(e);continue;}
        strike(p,e,damage,seconds,eternal);
      }
      if(travel>=cfg.range)finish();
    },1);
    return state;
  }
  function cross(p) {
    if(!api.tryUseSkill(p,"isshin:getsuga_x"))return;
    announce(p,"Getsuga X");
    const dim=p.dimension,cfg=ISSHIN.cross,base=api.crescentFrame(p.getViewDirection()),origin=copy(p.location),g=generation(p);
    const center={x:origin.x+base.dir.x*cfg.offset,y:origin.y+1.1+base.dir.y*cfg.offset,z:origin.z+base.dir.z*cfg.offset};
    const frames=[-1,1].map(sign=>{
      const co=Math.SQRT1_2,si=sign*Math.SQRT1_2;
      return {dir:base.dir,up:{x:base.up.x*co+base.side.x*si,y:base.up.y*co+base.side.y*si,z:base.up.z*co+base.side.z*si},side:{x:base.side.x*co-base.up.x*si,y:base.side.y*co-base.up.y*si,z:base.side.z*co-base.up.z*si}};
    });
    for(const e of near(dim,center,cfg.radius+cfg.thickness+2))if(canHit(p,e)&&frames.some(f=>cutHits(e,center,f,cfg)))strike(p,e,ISSHIN.damage.cross);
    let ticks=0;
    const timer=system.runInterval(()=>{
      if(!active(p,g)||p.dimension.id!==dim.id){system.clearRun(timer);return;}
      for(const frame of frames)api.drawCrescent(dim,center,frame,cfg,ISSHIN.looks.blue,false,0);
      if(++ticks>=cfg.duration/2)system.clearRun(timer);
    },2);
    api.shakeNear(dim,center,12,.15,.25);
  }
  function sideSpot(p) {
    const f=api.crescentFrame(p.getViewDirection()),l=p.location;
    for(const sign of [1,-1]) {
      const spot={x:l.x+f.side.x*1.8*sign,y:l.y,z:l.z+f.side.z*1.8*sign};
      try{let clear=true;for(const dy of [.1,1.8]){const b=p.dimension.getBlock({x:Math.floor(spot.x),y:Math.floor(spot.y+dy),z:Math.floor(spot.z)});if(!b||(!b.isAir&&!b.isLiquid))clear=false;}if(clear)return spot;}catch{}
    }
  }
  function finishCharge(state) {
    if(charges.get(state.p.id)===state)charges.delete(state.p.id);
    remove(state.son);
  }
  function charge(p,kind,son) {
    const state={p,kind,son,g:generation(p),life:life(p.id),dim:p.dimension,start:system.currentTick,launched:false};charges.set(p.id,state);
    if(kind==="family")announce(p,"Getsuga Pai e Filho!");else announce(p,"Meu Sol: Masaka!");
    return state;
  }
  function family(p) {
    const spot=sideSpot(p);
    if(!spot){p.sendMessage("§7Deixe espaço ao lado para o Ichigo aparecer.");return;}
    let son;try{son=p.dimension.spawnEntity("isshin:ichigo",spot);son.teleport(spot,{rotation:p.getRotation(),keepVelocity:false});son.nameTag="§6Ichigo Kurosaki";}catch{remove(son);return;}
    if(!api.tryUseSkill(p,"isshin:pai_e_filho")){remove(son);return;}
    charge(p,"family",son);
  }
  function triggerSun(p) {
    if(!ours(p)||!alive(p)||charges.has(p.id)||api.getAwakening(p)<100||api.isBlocked(p))return false;
    api.setAwakening(p,0);charge(p,"sun");return true;
  }
  function stepCharge(s) {
    const p=s.p;
    if(!active(p,s.g)||p.dimension.id!==s.dim.id||life(p.id)!==s.life||(!s.launched&&api.isBlocked(p))){finishCharge(s);return;}
    const elapsed=system.currentTick-s.start;
    if(s.launched)return;
    if(s.son) {
      const spot=sideSpot(p);if(spot)try{s.son.teleport(spot,{rotation:p.getRotation(),keepVelocity:false});}catch{finishCharge(s);return;}
      if(elapsed%3===0){emit(s.dim,"isshin:fogo_negro",body(s.son));emit(s.dim,"isshin:chama",body(p));}
    }else if(elapsed%2===0) {
      const c=body(p);for(let i=0;i<10;i++){const a=i*Math.PI/5+elapsed*.15;emit(s.dim,"isshin:sol",{x:c.x+Math.cos(a)*1.1,y:c.y+Math.sin(a)*1.1,z:c.z});}
    }
    const chargeTicks=s.kind==="family"?ISSHIN.family.charge:ISSHIN.sunCharge;
    if(elapsed<chargeTicks)return;
    s.launched=true;
    try{api.playVizardAnimation(p,"slash",false);s.son?.playAnimation("animation.isshin.ichigo_slash",{controller:"isshin_slash",stopExpression:"query.anim_time > 0.7",blendOutTime:.2});}catch{}
    sound(s.dim,"mob.enderdragon.growl",p.location,.65,1.4);api.shakeNear(s.dim,p.location,30,s.kind==="sun"?.4:.25,.5);
    if(s.kind==="family") {
      const from=s.son?lerp(p.location,s.son.location,.5):copy(p.location);
      fire(p,ISSHIN.family,ISSHIN.looks.family,ISSHIN.damage.family,10,false,{origin:from,done:()=>finishCharge(s)});
    }else {
      const k=ISSHIN.sunScale,cfg={...ISSHIN.fire,radius:ISSHIN.fire.radius*k,thickness:ISSHIN.fire.thickness*k,lateral:ISSHIN.fire.lateral*k,bulge:ISSHIN.fire.bulge*k};
      fire(p,cfg,ISSHIN.looks.sun,ISSHIN.damage.sun,1,true,{done:()=>finishCharge(s)});
    }
  }
  function melee(p,target) {
    if(!ours(p))return;
    const n=(combos.get(p.id)??0)+1;combos.set(p.id,n%3);
    if(n%3===0)ignite(target,p,2);
  }
  function cast(p,id) {
    if(!ours(p)||!alive(p)||charges.has(p.id)||api.isBlocked(p))return;
    if(id==="isshin:getsuga_x"){cross(p);return;}
    if(id==="isshin:pai_e_filho"){family(p);return;}
    if(id!=="isshin:getsuga_tensho"&&id!=="isshin:engetsu")return;
    if(!api.tryUseSkill(p,id))return;
    announce(p,ISSHIN.names[id]);
    if(id==="isshin:getsuga_tensho")fire(p,ISSHIN.blue,ISSHIN.looks.blue,ISSHIN.damage.tensho);
    else fire(p,ISSHIN.fire,ISSHIN.looks.fire,ISSHIN.damage.engetsu,5);
  }
  function reset(p) {
    generations.set(p.id,generation(p)+1);combos.delete(p.id);
    const s=charges.get(p.id);if(s)finishCharge(s);
    for(const shot of [...projectiles])if(shot.p.id===p.id)shot.finish();
    // A marca eterna nao depende da selecao de personagem: so a morte a desfaz.
  }
  function leave(id) {
    const s=charges.get(id);if(s)finishCharge(s);
    generations.set(id,(generations.get(id)??0)+1);combos.delete(id);
    for(const shot of [...projectiles])if(shot.p.id===id)shot.finish();
    burns.delete(id); // propriedade persistente permite reidratar a vitima ao entrar
  }
  function onSpawn(p,initialSpawn) {
    reset(p);
    if(!initialSpawn) {const state=burns.get(p.id);if(state)state.sources.clear();burns.delete(p.id);try{p.setDynamicProperty(ETERNAL,undefined);p.removeTag(TAG);}catch{}}
    else hydrate(p);
    if(ours(p))api.setPermanentEffect(p,"fire_resistance",0);
  }
  function cleanse(e) {
    const state=burns.get(e.id);if(!state)return;
    for(const[key,b]of state.sources)if(b.remaining!==-1)state.sources.delete(key);
    if(!state.sources.size)burns.delete(e.id);
  }
  world.afterEvents.entityDie.subscribe(({deadEntity:e})=>{
    if(e.typeId==="minecraft:player") {
      try{world.setDynamicProperty(lifeKey(e.id),life(e.id)+1);}catch{}
      reset(e);
      for(const state of burns.values()) {
        const b=state.sources.get(e.id);
        if(b?.remaining===-1){state.sources.delete(e.id);saveBurns(state);}
      }
    }
    burns.delete(e.id);try{e.setDynamicProperty(ETERNAL,undefined);e.removeTag(TAG);}catch{}
  });
  system.runInterval(()=>{
    burnTick();
    for(const s of [...charges.values()])try{stepCharge(s);}catch{finishCharge(s);}
    if(system.currentTick%40===0)for(const name of ["overworld","nether","the_end"])try {
      const dim=world.getDimension(name);
      for(const e of dim.getEntities({tags:[TAG]}))hydrate(e);
      for(const e of dim.getEntities({type:"isshin:ichigo"}))if(![...charges.values()].some(s=>s.son?.id===e.id))remove(e);
    }catch{}
  },1);
  return {cast,melee,triggerSun,reset,leave,onSpawn,cleanse,isBusy:e=>charges.has(e?.id),isBurning:e=>!!burns.get(e?.id)?.sources.size};
}
