import { world, system, InputPermissionCategory } from "@minecraft/server";

export const YORUICHI = {
  damage: { m1: 80, shunkoM1: 120, shunpo: 110, barrageTick: 10, showdown: 50, saw: 300, smash: 450, bolt: 560 },
  cooldowns: { "yoruichi:shunpo": 100, "yoruichi:punches_barrage": 600, "yoruichi:showdown": 400,
    "yoruichi:utsusemi": 300, "yoruichi:thundersaw": 500, "yoruichi:thunderous_smash": 600,
    "yoruichi:lightning_speed": 400, "yoruichi:lightning_bolt": 900 },
  names: { "yoruichi:shunpo": "Shunpo", "yoruichi:punches_barrage": "Punches Barrage",
    "yoruichi:showdown": "Showdown", "yoruichi:utsusemi": "Utsusemi", "yoruichi:thundersaw": "Thundersaw",
    "yoruichi:thunderous_smash": "Thunderous Smash", "yoruichi:lightning_speed": "Lightning Speed", "yoruichi:lightning_bolt": "Lightning Bolt" },
  shunpo: { range: 40, ticks: 5, radius: 1.6 }, barrage: { ticks: 40, range: 4, width: 2 },
  showdown: { range: 28, passes: 5, ticksPerPass: 10, radius: 5, cameraHeight: 19 },
  utsusemi: { ticks: 100, every: 4, imageTicks: 30 },
  saw: { range: 36, speed: 4, maxTicks: 30, stun: 60 },
  smash: { radius: 13, waves: 3, every: 5 },
  speed: { ticks: 100, amplifier: 9, radius: 1.8, stun: 140 },
  bolt: { riseTicks: Math.round(12 / 1.35), fallTicks: Math.round(40 / 1.35), height: 14, range: 28, damageRadius: 4, stunRadius: 15, stun: 200 },
};

export function createYoruichi(api) {
  const RECOVERY = "mv:yoruichi_motion";
  const CAMERA_RECOVERY = "mv:yoruichi_camera";
  const cameraEpoch = new Map();
  const motions = new Map(), stuns = new Map(), images = new Map(), mirages = new Map(), speeds = new Map(), combos = new Map();
  const owners = new Map(), generations = new Map();
  const alive = e => { try { return !!e && !api.isDownOrGone(e); } catch { return false; } };
  const char = e => { try { return api.getActiveCharacter(e)?.id; } catch { return undefined; } };
  const ours = e => char(e) === "yoruichi";
  const gen = e => generations.get(e.id) ?? 0;
  const active = (e, g) => alive(e) && ours(e) && gen(e) === g;
  const copy = p => ({ x: p.x, y: p.y, z: p.z });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const unit = d => { const n = Math.hypot(d.x, d.y, d.z) || 1; return { x: d.x/n, y: d.y/n, z: d.z/n }; };
  const body = e => ({ x:e.location.x, y:e.location.y+1, z:e.location.z });
  const lerp = (a,b,t) => ({ x:a.x+(b.x-a.x)*t, y:a.y+(b.y-a.y)*t, z:a.z+(b.z-a.z)*t });
  const sameDim = (a,b) => a.dimension.id === b.dimension.id;
  const emit = (dim,id,p) => { try { dim.spawnParticle(id,p); } catch {} };
  const sound = (dim,id,p,pitch=1,volume=1) => { try { dim.playSound(id,p,{pitch,volume}); } catch {} };
  const remove = e => { try { e?.remove(); } catch {} };
  const hp = e => { try { return e.getComponent("minecraft:health")?.currentValue ?? 0; } catch { return 0; } };
  const isBusy = e => motions.has(e?.id);
  const isStunned = e => (stuns.get(e?.id)?.until ?? 0) > system.currentTick;
  const canHit = (p,e) => alive(e) && e.id !== p.id && !e.typeId.startsWith("yoruichi:") && !api.isOwnSummon(p,e);
  function near(dim,at,r) { try { return dim.getEntities({location:at,maxDistance:r}); } catch { return []; } }
  function aim(p,r) {
    const e=api.targetInView(p,r);
    if (!canHit(p,e)) { p.sendMessage("§7Mire em um alvo dentro do alcance."); return; }
    return e;
  }
  function announce(p,id) {
    world.sendMessage(`§5${p.name}: §e§l${YORUICHI.names[id]}`);
    try { api.playVizardAnimation(p,"cast",id !== "yoruichi:utsusemi"); } catch {}
  }
  function streak(dim,a,b,id="yoruichi:flash",step=.6) {
    const n=Math.min(64,Math.max(1,Math.ceil(dist(a,b)/step)));
    for(let i=0;i<=n;i++)emit(dim,id,lerp(a,b,i/n));
  }
  function ring(dim,c,r,n=20,id="yoruichi:raio",vertical=false,dir={x:0,y:0,z:1}) {
    const side=unit({x:dir.z,y:0,z:-dir.x});
    for(let i=0;i<n;i++) {
      const a=i*Math.PI*2/n;
      emit(dim,id,vertical ? {x:c.x+side.x*Math.cos(a)*r,y:c.y+Math.sin(a)*r,z:c.z+side.z*Math.cos(a)*r}
        : {x:c.x+Math.cos(a)*r,y:c.y,z:c.z+Math.sin(a)*r});
    }
  }
  function arc(dim,a,b,seed=0) {
    let last=a; const n=Math.max(4,Math.min(15,Math.ceil(dist(a,b))));
    for(let i=1;i<=n;i++) {
      const p=lerp(a,b,i/n),j=i===n?0:.45;
      p.x+=Math.sin(i*6.3+seed)*j; p.z+=Math.cos(i*4.7+seed)*j;
      streak(dim,last,p,"yoruichi:raio",.4); last=p;
    }
  }
  function clearBody(dim,p) {
    try {
      for(const dx of [-.28,.28])for(const dz of [-.28,.28])for(const dy of [.05,1.7]) {
        const b=dim.getBlock({x:Math.floor(p.x+dx),y:Math.floor(p.y+dy),z:Math.floor(p.z+dz)});
        if(!b || (!b.isAir && !b.isLiquid))return false;
      }
      return true;
    } catch { return false; }
  }
  // Swept movement, including the player's width: no tunneling through thin walls.
  function sweep(dim,a,b) {
    const n=Math.max(1,Math.ceil(dist(a,b)/.4)); let reached=copy(a);
    for(let i=1;i<=n;i++) { const next=lerp(a,b,i/n); if(!clearBody(dim,next))return {pos:reached,blocked:true}; reached=next; }
    return {pos:reached,blocked:false};
  }
  function segmentDistance(p,a,b) {
    const d={x:b.x-a.x,y:b.y-a.y,z:b.z-a.z}; const n=d.x*d.x+d.y*d.y+d.z*d.z;
    const t=n?Math.max(0,Math.min(1,((p.x-a.x)*d.x+(p.y-a.y)*d.y+(p.z-a.z)*d.z)/n)):0;
    return dist(p,lerp(a,b,t));
  }
  function strike(p,e,amount,stunTicks=0) {
    if(!canHit(p,e))return false;
    const before=hp(e); api.dealDamage(e,amount*api.dmgMultiplier(p),p);
    const hit=hp(e)<before;
    if(hit && alive(e) && stunTicks)stun(p,e,stunTicks);
    return hit;
  }
  function stun(p,e,ticks) {
    if(!canHit(p,e) || api.blocksControl(e,p))return;
    const old=stuns.get(e.id);
    if(old) { old.until=Math.max(old.until,system.currentTick+ticks); return; }
    stuns.set(e.id,{e,at:copy(e.location),dim:e.dimension,character:char(e),until:system.currentTick+ticks});
    emit(e.dimension,"yoruichi:impacto",body(e));
  }
  function permission(p,k) { try { return p.inputPermissions.isPermissionCategoryEnabled(k); } catch { return true; } }
  function setPermission(p,k,v) { try { p.inputPermissions.setPermissionCategory(k,v); } catch {} }
  function restoreDefaultCamera(p) {
    const epoch=(cameraEpoch.get(p.id)??0)+1;
    cameraEpoch.set(p.id,epoch);
    // Repete depois do ultimo pacote da camera livre, sem atropelar uma nova cena.
    const clear=(last=false,forceCommand=false)=>{
      if(cameraEpoch.get(p.id)!==epoch || motions.get(p.id)?.camera)return;
      if(api.cameraClaimed?.(p)) {
        try { p.setDynamicProperty(CAMERA_RECOVERY,undefined); } catch {}
        return;
      }
      let ok=false;
      try { p.camera.clear();ok=true; } catch {}
      if(!ok||forceCommand)try {p.runCommand("camera @s clear");ok=true;}catch{}
      if(last&&ok)try {p.setDynamicProperty(CAMERA_RECOVERY,undefined);}catch{}
    };
    clear();
    system.runTimeout(()=>clear(),1);
    system.runTimeout(()=>clear(false,true),3);
    system.runTimeout(()=>clear(true,true),6);
  }
  function recover(p) {
    let saved; try { saved=JSON.parse(p.getDynamicProperty(RECOVERY)??"null"); } catch {}
    if(!saved) {
      try { if(p.getDynamicProperty(CAMERA_RECOVERY))restoreDefaultCamera(p); } catch {}
      return;
    }
    if(saved.camera)restoreDefaultCamera(p);
    if(api.isMovementBlocked(p)) {
      try { p.setDynamicProperty(RECOVERY,JSON.stringify({...saved,camera:false})); } catch {}
      return;
    }
    {
      setPermission(p,InputPermissionCategory.LateralMovement,saved.lateral);
      setPermission(p,InputPermissionCategory.Jump,saved.jump);
    }
    try { p.setDynamicProperty(RECOVERY,undefined); p.clearVelocity(); } catch {}
  }
  function begin(p,kind,camera=false) {
    if(isBusy(p))return;
    owners.set(p.id,p);
    const state={p,kind,dim:p.dimension,g:gen(p),tick:0,rotation:p.getRotation(),camera};
    if(kind!=="barrage") {
      const saved={lateral:permission(p,InputPermissionCategory.LateralMovement),jump:permission(p,InputPermissionCategory.Jump),camera};
      p.setDynamicProperty(RECOVERY,JSON.stringify(saved));
      setPermission(p,InputPermissionCategory.LateralMovement,false);setPermission(p,InputPermissionCategory.Jump,false);
    }
    motions.set(p.id,state);return state;
  }
  function finish(s) {
    if(motions.get(s.p.id)!==s)return;
    motions.delete(s.p.id);
    try { s.p.clearVelocity(); s.p.teleport(s.p.location,{rotation:s.rotation,keepVelocity:false}); } catch {}
    recover(s.p);
  }
  function teleport(s,pos,rotation) {
    s.p.clearVelocity();s.p.teleport(pos,{dimension:s.dim,keepVelocity:false,...(rotation?{rotation}: {})});
  }
  function segmentHits(p,a,b,r,hit,damage,stunTicks=0) {
    const aa={x:a.x,y:a.y+1,z:a.z},bb={x:b.x,y:b.y+1,z:b.z};
    for(const e of near(p.dimension,lerp(aa,bb,.5),dist(a,b)/2+r+2)) {
      if(!canHit(p,e)||hit.has(e.id)||segmentDistance(body(e),aa,bb)>r)continue;
      hit.add(e.id); if(damage)strike(p,e,damage,stunTicks);else stun(p,e,stunTicks);
    }
  }
  function shunpo(p) {
    if(!api.tryUseSkill(p,"yoruichi:shunpo"))return;
    announce(p,"yoruichi:shunpo");
    const s=begin(p,"shunpo");if(!s)return;
    const v=p.getViewDirection();s.dir=unit({x:v.x,y:Math.max(-.6,Math.min(.6,v.y)),z:v.z});s.hit=new Set();
    sound(s.dim,"item.trident.riptide_1",p.location,1.8,1.2);
  }
  function barrage(p) {
    if(!api.tryUseSkill(p,"yoruichi:punches_barrage"))return;
    announce(p,"yoruichi:punches_barrage");const s=begin(p,"barrage");s.pending=new Map();
  }
  function showdown(p) {
    const target=aim(p,YORUICHI.showdown.range);if(!target)return;
    // Check the camera before consuming charge; +90 degrees is straight down.
    const c=target.location;
    cameraEpoch.set(p.id,(cameraEpoch.get(p.id)??0)+1);
    try { p.camera.setCamera("minecraft:free",{location:{x:c.x,y:c.y+YORUICHI.showdown.cameraHeight,z:c.z},rotation:{x:90,y:0}}); }
    catch { p.sendMessage("§7A câmera de cima não está disponível nesta versão do jogo.");return; }
    p.setDynamicProperty(CAMERA_RECOVERY,true);
    if(!api.tryUseSkill(p,"yoruichi:showdown")) { restoreDefaultCamera(p);return; }
    const s=begin(p,"showdown",true);s.target=target;s.pass=-1;s.hit=new Set();
    announce(p,"yoruichi:showdown");sound(p.dimension,"mob.enderdragon.flap",p.location,1.6,1);
  }
  function utsusemi(p) {
    if(!api.tryUseSkill(p,"yoruichi:utsusemi"))return;
    announce(p,"yoruichi:utsusemi");owners.set(p.id,p);
    mirages.set(p.id,{p,dim:p.dimension,g:gen(p),tick:0,last:copy(p.location)});
  }
  function afterimage(p,loc) {
    try {
      const e=p.dimension.spawnEntity("yoruichi:afterimage",loc);
      e.nameTag=p.name;e.teleport(loc,{rotation:p.getRotation(),keepVelocity:false});
      images.set(e.id,{e,owner:p.id,until:system.currentTick+YORUICHI.utsusemi.imageTicks});
      sound(p.dimension,"random.fizz",loc,1.9,.35);
    }catch{}
  }
  function saw(p) {
    const target=aim(p,YORUICHI.saw.range);if(!target||!api.tryUseSkill(p,"yoruichi:thundersaw"))return;
    announce(p,"yoruichi:thundersaw");const s=begin(p,"saw");s.target=target;
    try { p.playAnimation("animation.yoruichi.thundersaw",{blendOutTime:.15,stopExpression:"query.anim_time > 1.5"}); } catch {}
  }
  function smash(p) {
    if(!api.tryUseSkill(p,"yoruichi:thunderous_smash"))return;
    announce(p,"yoruichi:thunderous_smash");const c=copy(p.location),dim=p.dimension,g=gen(p);
    for(const e of near(dim,c,YORUICHI.smash.radius+2))if(dist(e.location,c)<=YORUICHI.smash.radius)strike(p,e,YORUICHI.damage.smash);
    emit(dim,"minecraft:huge_explosion_emitter",c);sound(dim,"ambient.weather.thunder",c,.8,2);api.shakeNear(dim,c,25,.35,.5);
    for(let wave=0;wave<YORUICHI.smash.waves;wave++)system.runTimeout(()=>{
      if(!active(p,g))return;
      const r=5+wave*4;
      ring(dim,{x:c.x,y:c.y+.2,z:c.z},r,32,"yoruichi:onda");
      for(let i=0;i<8;i++) {
        const a=i*Math.PI/4,at=ground(dim,{x:c.x+Math.cos(a)*r,y:c.y+5,z:c.z+Math.sin(a)*r},c.y-12)??{x:c.x+Math.cos(a)*r,y:c.y,z:c.z+Math.sin(a)*r};
        arc(dim,{x:at.x,y:at.y+13,z:at.z},at,i+wave);
        // Raios vanilla reais, como pedido: conservam os efeitos nativos do Minecraft.
        try { dim.spawnEntity("minecraft:lightning_bolt",at); } catch {}
      }
    },1+wave*YORUICHI.smash.every);
  }
  function speed(p) {
    if(!api.tryUseSkill(p,"yoruichi:lightning_speed"))return;
    announce(p,"yoruichi:lightning_speed");owners.set(p.id,p);
    speeds.set(p.id,{p,g:gen(p),until:system.currentTick+YORUICHI.speed.ticks,last:copy(p.location),dim:p.dimension,hit:new Set()});
    api.setPermanentEffect(p,"speed",YORUICHI.speed.amplifier);
  }
  function ground(dim,p,minY) {
    try {
      for(let y=Math.floor(p.y);y>=Math.max(-63,Math.floor(minY));y--) {
        const b=dim.getBlock({x:Math.floor(p.x),y,z:Math.floor(p.z)});
        if(!b)return;
        if(!b.isAir&&!b.isLiquid) {
          const at={x:p.x,y:y+1,z:p.z};return clearBody(dim,at)?at:undefined;
        }
      }
    }catch{}
  }
  function nearestBoltTarget(p) {
    let target,best=YORUICHI.bolt.range;
    for(const e of near(p.dimension,p.location,best)) {
      if(!canHit(p,e))continue;
      const d=dist(p.location,e.location);
      if(d<best){best=d;target=e;}
    }
    return target;
  }
  function boltLanding(s,target) {
    if(!alive(target)||!sameDim(s.p,target)||dist(s.from,target.location)>YORUICHI.bolt.range+12)return;
    return ground(s.dim,{x:target.location.x,y:target.location.y+2,z:target.location.z},target.location.y-45);
  }
  function bolt(p) {
    const target=nearestBoltTarget(p);
    if(!target){p.sendMessage("§7Não há uma entidade ou jogador próximo para perseguir.");return;}
    const loc=copy(p.location);
    const landing=boltLanding({p,dim:p.dimension,from:loc},target);
    const ascent=sweep(p.dimension,loc,{x:loc.x,y:loc.y+YORUICHI.bolt.height,z:loc.z});
    if(!landing || ascent.pos.y-loc.y<2) { p.sendMessage("§7O salto precisa de espaço acima e de chão abaixo do alvo.");return; }
    if(!api.tryUseSkill(p,"yoruichi:lightning_bolt"))return;
    announce(p,"yoruichi:lightning_bolt");const s=begin(p,"bolt");s.from=loc;s.apex=ascent.pos;s.landing=landing;s.target=target;
    sound(p.dimension,"item.trident.riptide_3",loc,.8,1.5);
  }
  function boltImpact(s,at) {
    const p=s.p,dim=s.dim,c={x:at.x,y:at.y+.2,z:at.z};
    for(const e of near(dim,at,YORUICHI.bolt.stunRadius+2)) {
      if(!canHit(p,e))continue;const d=dist(e.location,at);
      if(d<=YORUICHI.bolt.damageRadius)strike(p,e,YORUICHI.damage.bolt,YORUICHI.bolt.stun);
      else if(d<=YORUICHI.bolt.stunRadius)stun(p,e,YORUICHI.bolt.stun);
    }
    emit(dim,"minecraft:huge_explosion_emitter",c);sound(dim,"ambient.weather.thunder",c,.65,2);api.shakeNear(dim,at,32,.5,.7);
    for(let i=0;i<8;i++){const a=i*Math.PI/4;arc(dim,{x:c.x+Math.cos(a)*4,y:c.y+10,z:c.z+Math.sin(a)*4},c,i);}
    const g=gen(p);for(let i=1;i<=10;i++)system.runTimeout(()=>{if(active(p,g))ring(dim,c,i*1.5,32,"yoruichi:onda");},i);
    finish(s);
  }
  function stepMotion(s) {
    const p=s.p;
    if(!active(p,s.g)||p.dimension.id!==s.dim.id||api.isMovementBlocked(p)||isStunned(p)) {finish(s);return;}
    s.tick++;
    if(s.kind==="shunpo") {
      const from=copy(p.location),n=YORUICHI.shunpo.range/YORUICHI.shunpo.ticks,to={x:from.x+s.dir.x*n,y:from.y+s.dir.y*n,z:from.z+s.dir.z*n},move=sweep(s.dim,from,to);
      streak(s.dim,body(p),{x:move.pos.x,y:move.pos.y+1,z:move.pos.z});
      segmentHits(p,from,move.pos,YORUICHI.shunpo.radius,s.hit,YORUICHI.damage.shunpo);teleport(s,move.pos);
      if(move.blocked||s.tick>=YORUICHI.shunpo.ticks)finish(s);
    }else if(s.kind==="barrage") {
      const f=unit(p.getViewDirection()),c=body(p);
      for(const e of near(s.dim,c,YORUICHI.barrage.range+2)) {
        if(!canHit(p,e))continue;const t=body(e),dx=t.x-c.x,dy=t.y-c.y,dz=t.z-c.z,along=dx*f.x+dy*f.y+dz*f.z;
        if(along<0||along>YORUICHI.barrage.range||Math.sqrt(Math.max(0,dx*dx+dy*dy+dz*dz-along*along))>YORUICHI.barrage.width)continue;
        const hit=s.pending.get(e.id)??{e,damage:0};hit.damage+=YORUICHI.damage.barrageTick;s.pending.set(e.id,hit);
      }
      const side={x:f.z,y:0,z:-f.x},sign=s.tick%2?1:-1;
      const start={x:c.x+side.x*.4*sign,y:c.y+.15,z:c.z+side.z*.4*sign},end={x:c.x+f.x*2+side.x*.25*sign,y:c.y+f.y*2,z:c.z+f.z*2+side.z*.25*sign};
      streak(s.dim,start,end,"yoruichi:soco",.4);emit(s.dim,"yoruichi:impacto",end);
      if(s.tick%5===0){sound(s.dim,"game.player.attack.strong",p.location,1.5,.6);try{api.playVizardAnimation(p,"slash");}catch{}}
      // 40 ticks x 10. Soma em janelas de 10 ticks para respeitar os i-frames.
      if(s.tick%10===0) {for(const h of s.pending.values())strike(p,h.e,h.damage);s.pending.clear();}
      if(s.tick>=YORUICHI.barrage.ticks)finish(s);
    }else if(s.kind==="showdown") {
      if(!alive(s.target)||!sameDim(p,s.target)||dist(p.location,s.target.location)>40){finish(s);return;}
      const pass=Math.floor((s.tick-1)/YORUICHI.showdown.ticksPerPass),phase=(s.tick-1)%YORUICHI.showdown.ticksPerPass;
      const c=s.target.location;
      p.camera.setCamera("minecraft:free",{location:{x:c.x,y:c.y+YORUICHI.showdown.cameraHeight,z:c.z},rotation:{x:90,y:0}});
      if(pass!==s.pass) {
        s.pass=pass;s.hit=new Set();const a=pass*Math.PI*2/5;
        s.entry={x:c.x+Math.cos(a)*5,y:c.y,z:c.z+Math.sin(a)*5};
        s.exit={x:c.x-Math.cos(a)*5,y:c.y,z:c.z-Math.sin(a)*5};s.from=copy(p.location);
      }
      const desired=phase<3?lerp(s.from,s.entry,(phase+1)/3):lerp(s.entry,s.exit,(phase-2)/7);
      const from=copy(p.location),move=sweep(s.dim,from,desired);streak(s.dim,body(p),{x:move.pos.x,y:move.pos.y+1,z:move.pos.z});
      teleport(s,move.pos,{x:0,y:-Math.atan2(c.x-move.pos.x,c.z-move.pos.z)*180/Math.PI});
      if(phase>=3 && !s.hit.has(s.target.id) && segmentDistance(body(s.target),{x:from.x,y:from.y+1,z:from.z},{x:move.pos.x,y:move.pos.y+1,z:move.pos.z})<1.7) {
        s.hit.add(s.target.id);strike(p,s.target,YORUICHI.damage.showdown);emit(s.dim,"yoruichi:impacto",body(s.target));sound(s.dim,"game.player.attack.strong",c,1.4,.8);
      }
      if(move.blocked||s.tick>=YORUICHI.showdown.passes*YORUICHI.showdown.ticksPerPass)finish(s);
    }else if(s.kind==="saw") {
      if(!alive(s.target)||!sameDim(p,s.target)||s.tick>YORUICHI.saw.maxTicks){finish(s);return;}
      const from=copy(p.location),to=s.target.location,d=dist(from,to),dir=unit({x:to.x-from.x,y:to.y-from.y,z:to.z-from.z}),move=sweep(s.dim,from,lerp(from,to,Math.min(1,YORUICHI.saw.speed/(d||1))));
      teleport(s,move.pos,{x:0,y:(s.rotation.y+s.tick*110)%360});ring(s.dim,body(p),1.5,22,"yoruichi:raio",true,dir);streak(s.dim,{x:from.x,y:from.y+1,z:from.z},body(p),"yoruichi:raio");
      if(segmentDistance(s.target.location,from,move.pos)<1.5){strike(p,s.target,YORUICHI.damage.saw,YORUICHI.saw.stun);finish(s);}
      else if(move.blocked)finish(s);
    }else if(s.kind==="bolt") {
      let landing=boltLanding(s,s.target);
      if(!landing) {s.target=nearestBoltTarget(p);landing=boltLanding(s,s.target);}
      if(landing)s.landing=landing; // acompanha o alvo; se ele sumir, termina no ultimo ponto valido
      if(s.tick<=YORUICHI.bolt.riseTicks) {
        const move=sweep(s.dim,p.location,lerp(s.from,s.apex,s.tick/YORUICHI.bolt.riseTicks));teleport(s,move.pos);
        if(move.blocked){s.apex=copy(p.location);s.tick=YORUICHI.bolt.riseTicks;}
        ring(s.dim,body(p),.8,12,"yoruichi:raio");
      }else {
        const t=Math.min(1,(s.tick-YORUICHI.bolt.riseTicks)/YORUICHI.bolt.fallTicks),from=copy(p.location),move=sweep(s.dim,from,lerp(s.apex,s.landing,t*t));
        teleport(s,move.pos);streak(s.dim,{x:from.x,y:from.y+1,z:from.z},body(p),"yoruichi:raio",.35);ring(s.dim,body(p),1,12,"yoruichi:raio",true,p.getViewDirection());
        if(move.blocked||t>=1)boltImpact(s,move.pos);
      }
    }
  }
  function restoreSpeed(p) { if(ours(p))api.setPermanentEffect(p,"speed",api.isAwakened(p)?6:3); }
  function endAwakening(p) {
    combos.delete(p.id);speeds.delete(p.id);
    const s=motions.get(p.id);if(s && ["saw","bolt"].includes(s.kind))finish(s);
  }
  function reset(p) {
    generations.set(p.id,gen(p)+1);const s=motions.get(p.id);if(s)finish(s);else recover(p);
    stuns.delete(p.id);speeds.delete(p.id);mirages.delete(p.id);combos.delete(p.id);owners.delete(p.id);
    for(const[id,im]of images)if(im.owner===p.id){remove(im.e);images.delete(id);}
  }
  function leave(id) {
    const p=owners.get(id);if(p)reset(p);stuns.delete(id);
  }
  function onSpawn(p) {reset(p);restoreSpeed(p);}
  function imageHit(e) {
    if(e?.typeId!=="yoruichi:afterimage")return false;
    emit(e.dimension,"yoruichi:flash",body(e));remove(e);images.delete(e.id);return true;
  }
  function melee(p,target) {
    if(!ours(p)||!api.isAwakened(p))return;
    const n=(combos.get(p.id)??0)+1;combos.set(p.id,n%2);
    if(n%2===0)stun(p,target,20);
  }
  function cast(p,id) {
    if(!ours(p)||isBusy(p)||isStunned(p))return;
    const awk=["yoruichi:thundersaw","yoruichi:thunderous_smash","yoruichi:lightning_speed","yoruichi:lightning_bolt"].includes(id);
    if(api.isAwakened(p)!==awk)return;
    ({"yoruichi:shunpo":shunpo,"yoruichi:punches_barrage":barrage,"yoruichi:showdown":showdown,"yoruichi:utsusemi":utsusemi,
      "yoruichi:thundersaw":saw,"yoruichi:thunderous_smash":smash,"yoruichi:lightning_speed":speed,"yoruichi:lightning_bolt":bolt})[id]?.(p);
  }
  system.runInterval(()=>{
    const now=system.currentTick;
    for(const p of world.getPlayers())if(!isBusy(p)&&(p.getDynamicProperty(RECOVERY)||(now%20===0&&p.getDynamicProperty(CAMERA_RECOVERY))))recover(p);
    for(const s of [...motions.values()]){try{stepMotion(s);}catch{finish(s);}}
    for(const[id,s]of stuns) {
      if(!alive(s.e)||now>=s.until||char(s.e)!==s.character){stuns.delete(id);continue;}
      try{s.e.clearVelocity();s.e.teleport(s.at,{dimension:s.dim,keepVelocity:false});if(now%4===0)arc(s.dim,body(s.e),{x:s.at.x+.5,y:s.at.y+2,z:s.at.z},now);}catch{stuns.delete(id);}
    }
    for(const[id,s]of mirages) {
      if(!active(s.p,s.g)||s.p.dimension.id!==s.dim.id){mirages.delete(id);continue;}
      s.tick++;
      if(s.tick%YORUICHI.utsusemi.every===0){if(s.p.isSprinting && dist(s.p.location,s.last)>.05)afterimage(s.p,s.last);s.last=copy(s.p.location);}
      if(s.tick>=YORUICHI.utsusemi.ticks)mirages.delete(id);
    }
    for(const[id,s]of images)if(now>=s.until){remove(s.e);images.delete(id);}
    for(const[id,s]of speeds) {
      if(!active(s.p,s.g)||!api.isAwakened(s.p)||now>=s.until||s.p.dimension.id!==s.dim.id){speeds.delete(id);restoreSpeed(s.p);continue;}
      if(!api.isMovementBlocked(s.p)&&!isStunned(s.p))segmentHits(s.p,s.last,s.p.location,YORUICHI.speed.radius,s.hit,0,YORUICHI.speed.stun);
      s.last=copy(s.p.location);
      if(s.p.getEffect("speed")?.amplifier!==YORUICHI.speed.amplifier)api.setPermanentEffect(s.p,"speed",YORUICHI.speed.amplifier);
    }
    if(now%3===0)for(const p of world.getPlayers())if(ours(p)&&api.isAwakened(p)&&alive(p)) {
      const c=body(p),a=now*.32;
      arc(p.dimension,{x:c.x+Math.cos(a)*.65,y:c.y+.8,z:c.z+Math.sin(a)*.65},{x:c.x-Math.sin(a)*.7,y:c.y-.7,z:c.z+Math.cos(a)*.7},now);
    }
    if(now%40===0)for(const name of ["overworld","nether","the_end"])try {
      for(const e of world.getDimension(name).getEntities({type:"yoruichi:afterimage"}))if(!images.has(e.id))remove(e);
    }catch{}
  },1);
  world.afterEvents.entityDie.subscribe(({deadEntity:e})=>{if(ours(e)||owners.has(e.id))reset(e);stuns.delete(e.id);});
  return {cast,melee,reset,leave,onSpawn,endAwakening,isBusy,isStunned,imageHit};
}
