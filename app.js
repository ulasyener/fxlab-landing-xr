// fxlab landing L1 — parallel WebXR prototype.
// Layout and sizes come from Figma frame "Landing · L1 · üç bölüm" (1 px = 1 dp; 1 dp is drawn as 1 mm).
// Data: snapshots of Barış's public fxlab evidence API (data/5h.json, 1d.json, 1w.json), read-only.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const S = 0.001;                 // metres per dp
const BW = 1520, BH = 1005;      // landing board size (dp)
const C = {
  ink:'#eceaf6', muted:'#a7a2c9', dim:'#6f6a94', pink:'#e2a8ee', blue:'#80a7dd', coral:'#e0907e',
  card:'#232042', cardEdge:'#2e2a54', line:'#3a3462', dark:'#1b1830',
};
const CURRENCIES = ['USD','EUR','GBP','JPY','AUD','NZD','CAD','CHF']; // ring order, clockwise from the back
const HORIZONS = [
  {id:'5h', icon:'timer', label:'5 hours', angle:-115, r:43.56},
  {id:'1d', icon:'sun', label:'1 day', angle:5, r:62.73},
  {id:'1w', icon:'calendar-blank', label:'1 week', angle:125, r:81.9},
];
const CITIES = [['TOKYO','Asia/Tokyo'],['LONDON','Europe/London'],['NEW YORK','America/New_York']];
const statusEl = document.getElementById('status'), enterBtn = document.getElementById('enter');

// ---------------------------------------------------------------- data
const data = {}; let dataMode = 'HELD', takenAt = null;
async function getJSON(url){ const r = await fetch(url,{cache:'no-cache'}); if(!r.ok) throw Error(url+' '+r.status); return r.json(); }
for (const h of ['5h','1d','1w']) {
  try { const d = await getJSON(`data/${h}.json`); if (d.state === 'ready' && d.observations?.length) data[h] = d; } catch {}
}
try { takenAt = (await getJSON('data/snapshot.json')).takenAt; } catch {}
if (!Object.keys(data).length) { data['5h'] = await getJSON('data/fixture.json'); dataMode = 'FIXTURE'; }
const obsOf = h => data[h] ? [...data[h].observations].sort((a,b)=>a.end<b.end?-1:1) : [];
const rowOf = (o,c) => o.rows.find(r=>r.currency===c);

const state = {
  horizon: HORIZONS.map(h=>h.id).find(h=>data[h]),
  currency: 'USD', hidden: false, scale: 1, desk: false, playing: true,
};
try { Object.assign(state, JSON.parse(localStorage.getItem('fxlab-landing') || '{}'), {hidden:false}); } catch {}
if (!data[state.horizon]) state.horizon = HORIZONS.map(h=>h.id).find(h=>data[h]);

// ---------------------------------------------------------------- fonts & icons
await Promise.all(['500 20px Manrope','700 20px Manrope','800 20px Manrope','400 20px "Kode Mono"','600 20px "Kode Mono"'].map(f=>document.fonts.load(f)));
const icons = new Map();
function icon(name, color){
  const key = name+color;
  if (!icons.has(key)) {
    icons.set(key, null);
    fetch(`icons/${name}.svg`).then(r=>r.text()).then(svg=>{
      const img = new Image();
      img.onload = () => { icons.set(key, img); panels.forEach(p=>p.dirty=true); };
      img.src = 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg.replace('fill="currentColor"',`fill="${color}"`));
    });
  }
  return icons.get(key);
}
function drawIcon(ctx, name, color, cx, cy, size){ const img = icon(name,color); if (img) ctx.drawImage(img, cx-size/2, cy-size/2, size, size); }

// ---------------------------------------------------------------- canvas helpers
function rr(ctx,x,y,w,h,r){ ctx.beginPath(); ctx.roundRect(x,y,w,h,r); }
function text(ctx,str,x,y,{font,color=C.ink,align='left',ls='0px'}){
  ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.letterSpacing = ls; ctx.fillText(str,x,y); ctx.letterSpacing = '0px';
  return ctx.measureText(str).width;
}
function card(ctx,w,h,r=24){
  rr(ctx,0,0,w,h,r); ctx.fillStyle = C.card; ctx.fill();
  ctx.lineWidth = 1; ctx.strokeStyle = C.cardEdge; ctx.stroke();
}
function groupLabel(ctx,num,name){
  const w = text(ctx,num,33.5,38.5,{font:'600 14px "Kode Mono"',color:C.muted});
  text(ctx,' · '+name,33.5+w,38.5,{font:'800 14px Manrope',color:C.muted,ls:'.4px'});
}
function glowDot(ctx,x,y,r,core,glow){
  const g = ctx.createRadialGradient(x,y,0,x,y,r*2.6);
  g.addColorStop(0,core); g.addColorStop(.35,glow); g.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x,y,r*2.6,0,Math.PI*2); ctx.fill();
  ctx.fillStyle = core; ctx.beginPath(); ctx.arc(x,y,r*.55,0,Math.PI*2); ctx.fill();
}
function circleButton(ctx,p,id,cx,cy,d,iconName,onTap,{iconSize=d*.42,iconColor=C.ink}={}){
  const hot = p.hover===id, down = p.press===id;
  ctx.save();
  if (hot||down) { ctx.shadowColor = C.pink; ctx.shadowBlur = down?22:14; }
  ctx.beginPath(); ctx.arc(cx,cy,d/2,0,Math.PI*2);
  ctx.fillStyle = down ? '#3a2f5c' : C.card; ctx.fill();
  ctx.lineWidth = hot||down ? 2 : 1.5; ctx.strokeStyle = hot||down ? C.pink : '#4a4470'; ctx.stroke();
  ctx.restore();
  drawIcon(ctx,iconName,hot||down?C.pink:iconColor,cx,cy,iconSize);
  p.region(id,cx-Math.max(d,48)/2,cy-Math.max(d,48)/2,Math.max(d,48),Math.max(d,48),onTap);
}

// ---------------------------------------------------------------- three.js scene
const renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));
renderer.setSize(innerWidth,innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(1.2);
document.getElementById('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene();
const desktopBg = new THREE.Color('#16152b'); scene.background = desktopBg;
const camera = new THREE.PerspectiveCamera(50,innerWidth/innerHeight,.01,50);
camera.position.set(0,1.45,1.75);
const orbit = new OrbitControls(camera,renderer.domElement);
orbit.target.set(0,1.4,0); orbit.enableDamping = true; orbit.update();
scene.add(new THREE.HemisphereLight('#cfd9ff','#2a2140',1.3));
const sun = new THREE.DirectionalLight('#ffffff',1.6); sun.position.set(1,3,2); scene.add(sun);

const boardRoot = new THREE.Group(); boardRoot.position.set(0,1.4,0); scene.add(boardRoot);
const board = new THREE.Group(); boardRoot.add(board);           // everything that hides with the eye button
const fixed = new THREE.Group(); boardRoot.add(fixed);           // bottom bar + toast stay visible
const panels = [];
let order = 0;

function panel({x,y,w,h,z=0,margin=0,res=2,draw,fps=0,parent=board,name}){
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((w+2*margin)*res); canvas.height = Math.round((h+2*margin)*res);
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry((w+2*margin)*S,(h+2*margin)*S),
    new THREE.MeshBasicMaterial({map:tex,transparent:true,toneMapped:false,depthWrite:false}));
  mesh.position.set((x+w/2-BW/2)*S,(BH/2-(y+h/2))*S,z);
  mesh.renderOrder = order++; mesh.name = name;
  const p = {name,x,y,w,h,margin,mesh,regions:[],hover:null,press:null,fps,last:0,dirty:true};
  p.region = (id,rx,ry,rw,rh,onTap)=>p.regions.push({id,x:rx,y:ry,w:rw,h:rh,onTap});
  p.redraw = (t=performance.now())=>{
    p.regions = [];
    ctx.setTransform(res,0,0,res,margin*res,margin*res);
    ctx.clearRect(-margin,-margin,w+2*margin,h+2*margin);
    draw(ctx,p,t/1000); tex.needsUpdate = true; p.dirty = false; p.last = t;
  };
  p.hit = uv => { const lx = uv.x*(w+2*margin)-margin, ly = (1-uv.y)*(h+2*margin)-margin;
    return {lx,ly,region:p.regions.findLast(r=>lx>=r.x&&lx<=r.x+r.w&&ly>=r.y&&ly<=r.y+r.h)||null}; };
  mesh.userData.panel = p; parent.add(mesh); panels.push(p); return p;
}

// ---------------------------------------------------------------- time helpers
const twoDigit = n => String(n).padStart(2,'0');
const DAYS = ['SU','MO','TU','WE','TH','FR','SA'];
function isoWeek(d){ const t = new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())); const day = t.getUTCDay()||7;
  t.setUTCDate(t.getUTCDate()+4-day); const y0 = new Date(Date.UTC(t.getUTCFullYear(),0,1)); return Math.ceil(((t-y0)/864e5+1)/7); }
const clock = zone => new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date());
function utcLabel(iso){ const d = new Date(iso);
  return `${twoDigit(d.getUTCDate())} ${d.toLocaleString('en-GB',{month:'short',timeZone:'UTC'}).toUpperCase()} ${twoDigit(d.getUTCHours())}:${twoDigit(d.getUTCMinutes())} UTC`; }
function tickLabel(obs,h){ const d = new Date(obs.end);
  if (h==='5h') return twoDigit(d.getUTCHours())+'h';
  if (h==='1w') return 'W'+isoWeek(new Date(obs.start));
  return DAYS[new Date(obs.start).getUTCDay()]; }

// ---------------------------------------------------------------- board + drops
panel({name:'board',x:0,y:0,w:BW,h:BH,margin:50,res:1,z:0,draw(ctx){
  ctx.save(); ctx.shadowColor = '#c99be0'; ctx.shadowBlur = 40;
  rr(ctx,0,0,BW,BH,48); const g = ctx.createLinearGradient(0,0,0,BH); g.addColorStop(0,'#211c3a'); g.addColorStop(1,'#16142b');
  ctx.fillStyle = g; ctx.fill(); ctx.restore();
  rr(ctx,0,0,BW,BH,48); ctx.lineWidth = 2; ctx.strokeStyle = '#c99be0'; ctx.stroke();
}});
for (const [x,w,num,name] of [[40,340,'01','TIME'],[410,700,'02','CHARTS'],[1140,340,'03','GAME']]) {
  panel({name:'drop '+name,x,y:40,w,h:790,res:1.5,z:.003,draw(ctx){
    ctx.save(); ctx.shadowColor = '#0b0a18'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
    rr(ctx,0,0,w,790,44); const g = ctx.createLinearGradient(0,0,0,790); g.addColorStop(0,'#30274a'); g.addColorStop(1,'#271f3f');
    ctx.fillStyle = g; ctx.fill(); ctx.restore();
    rr(ctx,0,0,w,790,44); ctx.lineWidth = 1.5; ctx.strokeStyle = '#4b3d63'; ctx.stroke();
    groupLabel(ctx,num,name);
  }});
}

// ---------------------------------------------------------------- 01 · TIME
const dateP = panel({name:'date',x:73.5,y:107.5,w:273,h:206,z:.006,draw(ctx){
  card(ctx,273,206); const d = new Date();
  text(ctx,twoDigit(d.getDate()),18,74,{font:'800 88px Manrope',ls:'-2px'});
  text(ctx,`${d.toLocaleString('en-GB',{month:'long'}).toUpperCase()} ${d.getFullYear()}`,20,144.5,{font:'800 21px Manrope',ls:'.3px'});
  text(ctx,`${DAYS[d.getDay()]} · WEEK ${isoWeek(d)}`,20,175.5,{font:'500 15px Manrope',color:C.muted,ls:'.4px'});
}});
let lastMinute = '';
const clocksP = panel({name:'clocks',x:73.5,y:329.5,w:273,h:222,z:.006,draw(ctx){
  card(ctx,273,222);
  const rows = [[0,8.5,0],[56,21.5,13],[125,21.5,13]];
  rows.forEach(([ry,ny,ty],i)=>{
    const y0 = 20+ry;
    if (i) { ctx.fillStyle = C.line; ctx.fillRect(14,y0,245,1); }
    ctx.fillStyle = C.pink; ctx.beginPath(); ctx.arc(14+4,y0+ny+13.5,4,0,Math.PI*2); ctx.fill();
    text(ctx,CITIES[i][0],14+18,y0+ny+13.5,{font:'700 20px Manrope',color:'#cfcae8'});
    text(ctx,clock(CITIES[i][1]),14+245,y0+ty+22,{font:'600 34px "Kode Mono"',align:'right'});
  });
}});
const horizonP = panel({name:'horizon ring',x:73.5,y:567.5,w:273,h:229,z:.006,fps:30,draw(ctx,p,t){
  card(ctx,273,229);
  const cx = 42+94.5, cy = 20+94.5, sel = HORIZONS.find(h=>h.id===state.horizon);
  for (const h of HORIZONS) {
    ctx.setLineDash([1.6,4.2]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(167,162,201,.45)';
    ctx.beginPath(); ctx.arc(cx,cy,h.r,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
  }
  // light arc travelling on the selected orbit
  const head = (t*2*Math.PI/14)%(2*Math.PI) - Math.PI/2, span = Math.PI*1.35, N = 48;
  ctx.save(); ctx.shadowColor = C.pink; ctx.shadowBlur = 10; ctx.lineCap = 'round';
  for (let i=0;i<N;i++) {
    const a0 = head-span+span*i/N, a1 = head-span+span*(i+1)/N;
    ctx.strokeStyle = `rgba(231,168,240,${(i/N)**1.6})`; ctx.lineWidth = 2+2.2*i/N;
    ctx.beginPath(); ctx.arc(cx,cy,sel.r,a0,a1+.01); ctx.stroke();
  }
  ctx.restore();
  glowDot(ctx,cx+Math.cos(head)*sel.r,cy+Math.sin(head)*sel.r,8.7,'#fff3ff','rgba(231,168,240,.75)');
  // centre: selected symbol + label
  drawIcon(ctx,sel.icon+'-fill',C.ink,cx,cy-9,26);
  if (sel.id==='1w') calendarNumber(ctx,cx,cy-9,26,C.card);
  text(ctx,sel.label,cx,cy+17,{font:'500 14px Manrope',color:C.muted,align:'center'});
  // orbit symbols, 120° apart; 48 dp touch targets
  for (const h of HORIZONS) {
    const a = h.angle*Math.PI/180, x = cx+Math.cos(a)*h.r, y = cy+Math.sin(a)*h.r;
    const on = h.id===state.horizon, hot = p.hover===h.id, off = !data[h.id];
    ctx.globalAlpha = off ? .35 : 1;
    ctx.beginPath(); ctx.arc(x,y,13,0,Math.PI*2); ctx.fillStyle = C.dark; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = hot ? C.pink : '#4a4470'; ctx.stroke();
    drawIcon(ctx,on?h.icon+'-fill':h.icon,on||hot?C.pink:C.ink,x,y,16);
    if (h.id==='1w') calendarNumber(ctx,x,y,16,on?C.dark:(hot?C.pink:C.ink));
    ctx.globalAlpha = 1;
    if (!off) p.region(h.id,x-24,y-24,48,48,()=>setHorizon(h.id));
  }
}});
function calendarNumber(ctx,cx,cy,size,color){ // "12" inside the calendar symbol (T1/T2/T3 still open)
  text(ctx,'12',cx,cy+size*.1,{font:`800 ${size*.34}px Manrope`,color,align:'center'});
}

// ---------------------------------------------------------------- 02 · CHARTS
panel({name:'diorama card',x:441.5,y:103.5,w:639,h:581,z:.006,draw(ctx){
  rr(ctx,0,0,639,581,24); const g = ctx.createLinearGradient(0,0,0,581);
  g.addColorStop(0,'#2b2852'); g.addColorStop(.55,'#201d40'); g.addColorStop(1,'#16152c');
  ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#3b3672'; ctx.stroke();
  text(ctx,'DIORAMA',25,32,{font:'800 14px Manrope',color:C.muted,ls:'.4px'});
  text(ctx,'3D',614,32,{font:'600 14px "Kode Mono"',color:C.muted,align:'right'});
}});
const loop = {obs:[], step:2.2, hold:1.6, idx:0};
function rebuildLoop(){ loop.obs = obsOf(state.horizon).slice(-7); }
rebuildLoop();
const timelineP = panel({name:'timeline',x:501.5,y:615.5,w:519,h:44,margin:16,z:.009,fps:30,draw(ctx){
  const n = loop.obs.length, f = n>1 ? loop.idx/(n-1) : 1, X = i => n>1 ? 519*i/(n-1) : 519;
  ctx.fillStyle = '#4a4470'; rr(ctx,0,6,519,2,1); ctx.fill();
  const g = ctx.createLinearGradient(0,0,519*f,0); g.addColorStop(0,'rgba(231,168,240,.25)'); g.addColorStop(1,C.pink);
  ctx.fillStyle = g; rr(ctx,0,6,Math.max(2,519*f),2,1); ctx.fill();
  loop.obs.forEach((o,i)=>{
    ctx.fillStyle = X(i)<=519*f+.5 ? C.pink : '#6f6a94'; ctx.fillRect(X(i)-.75,3,1.5,8);
    text(ctx,tickLabel(o,state.horizon),X(i),29,{font:'400 14px "Kode Mono"',color:C.muted,align:'center'});
  });
  glowDot(ctx,519*f,7,7,'#fff6ff','rgba(231,168,240,.6)');
}});
const dashP = panel({name:'dashboard',x:441.5,y:700.4,w:637,h:89,z:.006,draw(ctx,p){
  card(ctx,637,89);
  const obs = obsOf(state.horizon), last = obs.at(-1), row = last && rowOf(last,state.currency);
  text(ctx,'fxlab',24,33.5,{font:'800 23px Manrope',color:C.pink});
  text(ctx,`${dataMode} · ${last?utcLabel(last.end):'—'}`,24,62,{font:'500 13px Manrope',color:C.muted,ls:'.3px'});
  text(ctx,state.currency,215,33.5,{font:'800 22px Manrope'});
  const z = row ? row.strengthZ : NaN;
  text(ctx,isNaN(z)?'—':`${z>=0?'+':'−'}${Math.abs(z).toFixed(3)} z`,275,33.5,{font:'400 22px "Kode Mono"',color:C.blue});
  text(ctx,row?`#${row.rank} / 8 · ${z>=0?'EMERGED':'SUBMERGED'}`:'unavailable',215,62,{font:'500 13px Manrope',color:C.muted,ls:'.3px'});
  HORIZONS.forEach((h,i)=>{
    const x = 433+i*64, y = 20.5, on = h.id===state.horizon, hot = p.hover===h.id, off = !data[h.id];
    ctx.globalAlpha = off ? .35 : 1;
    ctx.save(); if (on||hot) { ctx.shadowColor = C.pink; ctx.shadowBlur = on?18:10; }
    rr(ctx,x,y,56,48,24); ctx.fillStyle = on ? C.pink : C.card; ctx.fill(); ctx.restore();
    if (!on) { rr(ctx,x,y,56,48,24); ctx.lineWidth = 1.5; ctx.strokeStyle = hot?C.pink:'#4b4470'; ctx.stroke(); }
    drawIcon(ctx,on?h.icon+'-fill':h.icon,on?C.dark:(hot?C.pink:C.ink),x+28,y+24,22);
    if (h.id==='1w') calendarNumber(ctx,x+28,y+24,22,on?C.pink:(hot?C.pink:C.ink));
    ctx.globalAlpha = 1;
    if (!off) p.region(h.id,x,y,56,48,()=>setHorizon(h.id));
  });
}});

// ---------------------------------------------------------------- 03 · GAME (sample content, as in Figma)
function openButton(ctx,p,id,label){ circleButton(ctx,p,id,22+181+24,20+24,48,'caret-right',()=>toast(`${label} window — detail view not built yet`),{iconSize:18,iconColor:C.pink}); }
const newsP = panel({name:'news',x:1173.5,y:107.5,w:273,h:273,z:.006,fps:20,draw(ctx,p,t){
  card(ctx,273,273);
  text(ctx,'NEWS',22,44,{font:'800 17px Manrope',ls:'.4px'});
  openButton(ctx,p,'news','News');
  const P = u => [22+u*232, 80+68-58*Math.sin(Math.PI*u)];
  const now = new Date(), nowU = (now.getUTCHours()*60+now.getUTCMinutes())/1440, evU = (12*60+30)/1440;
  ctx.setLineDash([1.4,4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(167,162,201,.5)';
  ctx.beginPath(); for (let i=0;i<=60;i++){ const [x,y] = P(i/60); i?ctx.lineTo(x,y):ctx.moveTo(x,y); } ctx.stroke(); ctx.setLineDash([]);
  ctx.save(); ctx.shadowColor = C.pink; ctx.shadowBlur = 8; ctx.lineWidth = 2; ctx.lineCap = 'round';
  const g = ctx.createLinearGradient(22,0,22+232*nowU,0); g.addColorStop(0,'rgba(231,168,240,.15)'); g.addColorStop(1,C.pink);
  ctx.strokeStyle = g; ctx.beginPath(); for (let i=0;i<=60;i++){ const [x,y] = P(nowU*i/60); i?ctx.lineTo(x,y):ctx.moveTo(x,y); } ctx.stroke(); ctx.restore();
  const [nx,ny] = P(nowU); ctx.fillStyle = 'rgba(231,168,240,.5)'; ctx.fillRect(nx-.5,ny,1,148-ny);
  glowDot(ctx,nx,ny,4.5,'#fff6ff','rgba(231,168,240,.7)');
  [.18,.27,.61,.72].forEach((u,i)=>{ const [x,y] = P(u); ctx.globalAlpha = .45+.45*Math.sin(t*2+i*1.7)**2;
    ctx.fillStyle = C.blue; ctx.beginPath(); ctx.arc(x,y,2,0,Math.PI*2); ctx.fill(); ctx.globalAlpha = 1; });
  const [ex,ey] = P(evU); ctx.strokeStyle = C.blue; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(ex,ey,6+Math.sin(t*3),0,Math.PI*2); ctx.stroke();
  glowDot(ctx,ex,ey,3.5,'#e8f0ff','rgba(128,167,221,.7)');
  text(ctx,'12:30 · USD',22,177,{font:'400 16px "Kode Mono"',color:C.blue});
  text(ctx,'EMPLOYMENT REPORT ·',22,212,{font:'800 20px Manrope'});
  text(ctx,'SAMPLE HEADLINE',22,239,{font:'800 20px Manrope'});
}});
const simP = panel({name:'simulator',x:1173.5,y:400.4,w:273,h:396,z:.006,fps:20,draw(ctx,p,t){
  card(ctx,273,396);
  text(ctx,'SIMULATOR',22,44,{font:'800 17px Manrope',ls:'.4px'});
  openButton(ctx,p,'sim','Simulator');
  const cx = 22+112, cy = 80+48;
  const orbits = [[104,20,-.06],[80,14,.08],[54,9,0]];
  ctx.setLineDash([1.4,4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(167,162,201,.4)';
  for (const [a,b,r] of orbits){ ctx.beginPath(); ctx.ellipse(cx,cy,a,b,r,0,Math.PI*2); ctx.stroke(); } ctx.setLineDash([]);
  const bodies = [[0,.11,'#7fb2ff',0],[0,.11,'#8fe0ff',2.4],[1,-.16,'#f2b35d',1],[1,-.16,'#e88a78',3.9],[2,.23,'#b9a2ff',.5]];
  for (const [o,sp,col,ph] of bodies) {
    const [a,b,r] = orbits[o], ang = ph+t*sp*2*Math.PI;
    const ex = a*Math.cos(ang), ey = b*Math.sin(ang);
    const x = cx+ex*Math.cos(r)-ey*Math.sin(r), y = cy+ex*Math.sin(r)+ey*Math.cos(r);
    const g = ctx.createLinearGradient(cx,cy,x,y); g.addColorStop(0,'rgba(231,168,240,.9)'); g.addColorStop(1,col);
    ctx.strokeStyle = g; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.quadraticCurveTo((cx+x)/2,cy-46,x,y); ctx.stroke();
    glowDot(ctx,x,y,3,'#ffffff',col);
  }
  glowDot(ctx,cx,cy,10,'#fff4ff','rgba(231,168,240,.8)');
  text(ctx,'PORTFOLIO',22,201,{font:'800 13px Manrope',color:C.muted,ls:'.5px'});
  text(ctx,'12 834',20,256,{font:'400 52px "Kode Mono"'});
  text(ctx,'+3.5%',22,315,{font:'400 22px "Kode Mono"',color:C.blue});
  const pr = 12/30, bx = 22, by = 357, bw = 232;
  ctx.fillStyle = '#4a4470'; ctx.fillRect(bx,by,bw,1);
  const g = ctx.createLinearGradient(bx,0,bx+bw*pr,0); g.addColorStop(0,'rgba(231,168,240,0)'); g.addColorStop(1,C.pink);
  ctx.fillStyle = g; ctx.fillRect(bx,by-.5,bw*pr,2);
  const sh = bx+((t*.5)%1)*bw*pr; const sg = ctx.createLinearGradient(sh-18,0,sh,0);
  sg.addColorStop(0,'rgba(255,255,255,0)'); sg.addColorStop(1,'rgba(255,255,255,.8)'); ctx.fillStyle = sg; ctx.fillRect(sh-18,by-.5,18,2);
  glowDot(ctx,bx+bw*pr,by+.5,3.2,'#fff6ff','rgba(231,168,240,.75)');
  text(ctx,'DAY 12 / 30',22,381,{font:'400 14px "Kode Mono"',color:C.muted});
}});

// ---------------------------------------------------------------- bottom bar + toast
const BAR = [
  ['eye','eye','Hide / show all',()=>{ state.hidden = !state.hidden; board.visible = dio.visible = !state.hidden; }],
  ['house','house','Default layout',()=>{ state.scale = 1; state.desk = false; place(); toast('Back to the default layout'); }],
  ['save','bookmark-simple','Save',()=>{ try{ localStorage.setItem('fxlab-landing',JSON.stringify({horizon:state.horizon,currency:state.currency,scale:state.scale,desk:state.desk})); toast('Layout saved on this headset'); }catch{ toast('Saving is not available in this browser'); } }],
  ['info','info','Info',()=>toast(`${dataMode==='HELD'?'HELD OBSERVATIONS':'FIXTURE (old held sample)'} · UPSTREAM FRESHNESS UNVERIFIED${takenAt?' · snapshot '+utcLabel(takenAt):''}`,6000)],
  ['settings','gear-six','Settings',()=>{ const s = [.8,.9,1,1.1]; state.scale = s[(s.indexOf(state.scale)+1)%s.length]||1; boardRoot.scale.setScalar(state.scale); toast(`Size ${Math.round(state.scale*100)} %`); }],
  ['desk','desk','Table / in the air',()=>{ state.desk = !state.desk; place(); toast(state.desk?'Lying on the table':'Standing in the air'); }],
  ['exit','x-circle','Exit MR',()=>{ const s = renderer.xr.getSession(); s ? s.end() : toast('Not in MR'); }],
];
const barP = panel({name:'bottom bar',x:410,y:860,w:700,h:104.6,margin:20,parent:fixed,z:.006,draw(ctx,p){
  ctx.save(); ctx.shadowColor = '#0b0a18'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 5;
  rr(ctx,0,0,700,104.6,52.3); ctx.fillStyle = '#262346'; ctx.fill(); ctx.restore();
  rr(ctx,0,0,700,104.6,52.3); ctx.lineWidth = 1.5; ctx.strokeStyle = '#3d3762'; ctx.stroke();
  BAR.forEach(([id,ic,,fn],i)=>circleButton(ctx,p,id,23.85+34.24+i*97.305,18.08+34.24,68.47,ic,fn,{iconSize:28.8}));
}});
let toastMsg = '', toastUntil = 0;
const toastP = panel({name:'toast',x:410,y:1025,w:700,h:52,margin:10,parent:fixed,z:.01,draw(ctx){
  if (!toastMsg) return;
  rr(ctx,0,0,700,52,26); ctx.fillStyle = 'rgba(35,32,66,.95)'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = C.pink; ctx.stroke();
  ctx.font = '700 15px Manrope'; let m = toastMsg; while (ctx.measureText(m).width>660 && m.length>4) m = m.slice(0,-2);
  text(ctx,m===toastMsg?m:m+'…',350,26,{font:'700 15px Manrope',align:'center'});
}});
toastP.mesh.visible = false;
function toast(msg,ms=3200){ toastMsg = msg; toastUntil = performance.now()+ms; toastP.mesh.visible = true; toastP.dirty = true; }

// ---------------------------------------------------------------- 3D diorama (Barış's data)
const DIO = {R:.17, U:.075, clamp:2.2};
const dio = new THREE.Group(); dio.name = 'diorama';
dio.position.set((761-BW/2)*S,(BH/2-375)*S,.17); dio.rotation.x = .42; board.add(dio);   // tilted toward the viewer, as drawn in Figma
function ringLine(r,y,color,opacity,dashed){
  const pts = []; for (let i=0;i<=128;i++){ const a = i/128*Math.PI*2; pts.push(new THREE.Vector3(Math.cos(a)*r,y,Math.sin(a)*r)); }
  const geo = new THREE.BufferGeometry().setFromPoints(pts);
  const mat = dashed ? new THREE.LineDashedMaterial({color,transparent:true,opacity,dashSize:.003,gapSize:.006})
                     : new THREE.LineBasicMaterial({color,transparent:true,opacity});
  const l = new THREE.Line(geo,mat); if (dashed) l.computeLineDistances(); dio.add(l); return l;
}
{ const water = new THREE.Mesh(new THREE.CylinderGeometry(DIO.R,DIO.R,DIO.U*1.6,64,1,true),
    new THREE.MeshBasicMaterial({color:'#4a63c8',transparent:true,opacity:.2,side:THREE.DoubleSide,depthWrite:false}));
  water.position.y = -DIO.U*.8; dio.add(water);
  const surf = new THREE.Mesh(new THREE.CircleGeometry(DIO.R,64),new THREE.MeshBasicMaterial({color:'#6d8fff',transparent:true,opacity:.18,side:THREE.DoubleSide,depthWrite:false}));
  surf.rotation.x = -Math.PI/2; dio.add(surf);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(DIO.R,.0011,8,128),new THREE.MeshBasicMaterial({color:'#9cbcff',toneMapped:false}));
  rim.rotation.x = Math.PI/2; dio.add(rim);
  ringLine(DIO.R*.62,0,'#8fb3ff',.55); ringLine(DIO.R*.3,0,'#8fb3ff',.4);
  ringLine(DIO.R,DIO.U,'#d79be6',.55,true); ringLine(DIO.R,-DIO.U,'#e0907e',.45,true);
}
function radialTexture(){ const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32,32,0,32,32,32); gr.addColorStop(0,'rgba(255,255,255,1)'); gr.addColorStop(.3,'rgba(255,255,255,.45)'); gr.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0,0,64,64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
const glowTex = radialTexture();
const UP = new THREE.Color('#9cbcff'), DOWN = new THREE.Color('#e0907e');
const marbles = CURRENCIES.map((cur,i)=>{
  const a = -Math.PI/2+i*Math.PI/4, x = Math.cos(a)*DIO.R*.78, z = Math.sin(a)*DIO.R*.78;
  const g = new THREE.Group(); g.position.set(x,0,z); dio.add(g);
  const mat = new THREE.MeshStandardMaterial({color:'#eef3ff',emissive:'#5d86ff',emissiveIntensity:.6,roughness:.2,metalness:.1});
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.0105,32,16),mat); g.add(ball);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:UP,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,opacity:.9}));
  glow.scale.setScalar(.065); ball.add(glow);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(.028,12,8),new THREE.MeshBasicMaterial({visible:false}));
  hit.userData.currency = cur; ball.add(hit);
  const halo = new THREE.Mesh(new THREE.RingGeometry(.009,.0112,40),new THREE.MeshBasicMaterial({color:UP,transparent:true,opacity:.8,side:THREE.DoubleSide,toneMapped:false}));
  halo.rotation.x = -Math.PI/2; g.add(halo);
  const sel = new THREE.Mesh(new THREE.TorusGeometry(.019,.0012,8,48),new THREE.MeshBasicMaterial({color:C.pink,toneMapped:false}));
  sel.rotation.x = Math.PI/2; ball.add(sel);
  const n = 14, pos = new Float32Array(n*3);
  const column = new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(pos,3)),
    new THREE.PointsMaterial({map:glowTex,color:UP,size:.006,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  g.add(column);
  return {cur,g,ball,mat,glow,hit,halo,sel,column,n,y:0};
});
const zAt = (o,cur) => { const r = o && rowOf(o,cur); return r ? Math.max(-DIO.clamp,Math.min(DIO.clamp,r.strengthZ)) : 0; };
function updateDiorama(t){
  const n = loop.obs.length;
  if (n>1 && state.playing) { const L = loop.step*(n-1)+loop.hold, s = (t%L)/loop.step; loop.idx = Math.min(n-1,s); }
  else loop.idx = n-1;
  const i0 = Math.floor(loop.idx), i1 = Math.min(n-1,i0+1), f = loop.idx-i0;
  const gap = loop.obs[i1]?.continuity==='gap', k = gap ? (f<.5?0:1) : f*f*(3-2*f);
  for (const m of marbles) {
    const z = zAt(loop.obs[i0],m.cur)*(1-k)+zAt(loop.obs[i1],m.cur)*k;
    const y = z*DIO.U; m.ball.position.y = y; m.y = y;
    const col = z>=0 ? UP : DOWN;
    m.glow.material.color.copy(col); m.halo.material.color.copy(col); m.column.material.color.copy(col);
    m.mat.emissive.set(z>=0?'#5d86ff':'#b5543f'); m.mat.color.set(z>=0?'#eef3ff':'#f2b0a2');
    m.sel.visible = m.cur===state.currency; m.sel.rotation.z = t*.8;
    const p = m.column.geometry.attributes.position;
    for (let j=0;j<m.n;j++){ const u = ((j/m.n)+t*.25)%1; p.setXYZ(j,0,y*u,0); }
    p.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- state changes
function setHorizon(h){ if (!data[h]) return; state.horizon = h; rebuildLoop(); [horizonP,timelineP,dashP].forEach(p=>p.dirty=true); }
function setCurrency(c){ state.currency = c; dashP.dirty = true; }

// ---------------------------------------------------------------- placement
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();
function place(){
  const xrCam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  xrCam.getWorldPosition(tmpV); const head = tmpV.clone();
  const dir = new THREE.Vector3(0,0,-1).applyQuaternion(xrCam.getWorldQuaternion(tmpQ)); dir.y = 0;
  if (dir.lengthSq()<1e-4) dir.set(0,0,-1); dir.normalize();
  const yaw = Math.atan2(-dir.x,-dir.z);
  boardRoot.scale.setScalar(state.scale);
  if (state.desk) {
    boardRoot.position.copy(head).addScaledVector(dir,.62); boardRoot.position.y = head.y-.5;
    boardRoot.rotation.set(0,0,0); boardRoot.rotateY(yaw); boardRoot.rotateX(-Math.PI*.3);
  } else {
    boardRoot.position.copy(head).addScaledVector(dir,1.15); boardRoot.position.y = head.y-.1;
    boardRoot.rotation.set(0,yaw,0);
  }
}

// ---------------------------------------------------------------- input: pinch-ray, poke, mouse
const raycaster = new THREE.Raycaster();
function targets(){ const list = []; for (const p of panels) if (p.mesh.visible && p.mesh.parent.visible) list.push(p.mesh);
  if (dio.visible && board.visible) for (const m of marbles) list.push(m.hit); return list; }
function pick(origin,dir){
  raycaster.set(origin,dir); raycaster.far = 6;
  for (const h of raycaster.intersectObjects(targets(),false)) {
    if (h.object.userData.currency) return {currency:h.object.userData.currency,point:h.point,distance:h.distance};
    const p = h.object.userData.panel, {lx,ly,region} = p.hit(h.uv);
    if (lx<0||ly<0||lx>p.w||ly>p.h) continue;           // transparent glow margin
    if (p.name==='toast') continue;
    return {panel:p,region,point:h.point,distance:h.distance};
  }
  return null;
}
function setHover(source,hit){
  const prev = source.hover, next = hit?.region ? {panel:hit.panel,id:hit.region.id} : null;
  if (prev?.panel===next?.panel && prev?.id===next?.id) return;
  source.hover = next;
  for (const p of new Set([prev?.panel,next?.panel].filter(Boolean))) { p.hover = sources.map(s=>s.hover).find(h=>h?.panel===p)?.id ?? null; p.dirty = true; }
}
function press(source,hit){
  if (!hit) return;
  if (hit.currency) { setCurrency(hit.currency); return; }
  if (hit.region) { source.pressed = {panel:hit.panel,id:hit.region.id}; hit.panel.press = hit.region.id; hit.panel.dirty = true; return; }
  if (source.controller) { source.controller.attach(boardRoot); source.grab = true; }   // grab the landing by any empty surface
}
function release(source,hit){
  if (source.grab) { scene.attach(boardRoot); const e = new THREE.Euler().setFromQuaternion(boardRoot.quaternion,'YXZ'); boardRoot.rotation.set(e.x,e.y,0,'YXZ'); source.grab = false; }
  const pr = source.pressed; source.pressed = null;
  if (!pr) return;
  pr.panel.press = null; pr.panel.dirty = true;
  if (hit?.panel===pr.panel && hit.region?.id===pr.id) hit.region.onTap();
}
const sources = [];
const rayMat = new THREE.LineBasicMaterial({color:C.pink,transparent:true,opacity:.55});
const dotGeo = new THREE.SphereGeometry(.004,12,8), dotMat = new THREE.MeshBasicMaterial({color:'#fff3ff'});
for (let i=0;i<2;i++){
  const controller = renderer.xr.getController(i); scene.add(controller);
  const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),rayMat);
  controller.add(ray);
  const cursor = new THREE.Mesh(dotGeo,dotMat); scene.add(cursor);
  const hand = renderer.xr.getHand(i); scene.add(hand);
  const tip = new THREE.Mesh(dotGeo,new THREE.MeshBasicMaterial({color:C.pink})); scene.add(tip);
  const s = {controller,ray,cursor,hand,tip,hover:null,pressed:null,grab:false,hit:null,poke:{latched:false}};
  controller.addEventListener('selectstart',()=>press(s,s.hit));
  controller.addEventListener('selectend',()=>release(s,s.hit));
  sources.push(s);
}
const mouse = {hover:null,pressed:null,hit:null,controller:null}; sources.push(mouse);
const ndc = new THREE.Vector2();
function mousePick(e){ ndc.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1); raycaster.setFromCamera(ndc,camera);
  return pick(raycaster.ray.origin.clone(),raycaster.ray.direction.clone()); }
renderer.domElement.addEventListener('pointermove',e=>{ mouse.hit = mousePick(e); setHover(mouse,mouse.hit);
  renderer.domElement.style.cursor = mouse.hit?.region||mouse.hit?.currency ? 'pointer' : ''; });
renderer.domElement.addEventListener('pointerdown',e=>{ mouse.hit = mousePick(e); if (mouse.hit?.region||mouse.hit?.currency) { orbit.enabled = false; press(mouse,mouse.hit); } });
addEventListener('pointerup',e=>{ mouse.hit = mousePick(e); release(mouse,mouse.hit); orbit.enabled = true; });

const tipPos = new THREE.Vector3(), local = new THREE.Vector3(), orig = new THREE.Vector3(), dirV = new THREE.Vector3();
function updateXRInput(){
  for (const s of sources) {
    if (!s.controller) continue;
    const c = s.controller, active = c.visible;
    // pinch-ray
    if (active) {
      orig.setFromMatrixPosition(c.matrixWorld); dirV.set(0,0,-1).transformDirection(c.matrixWorld);
      s.hit = s.grab ? null : pick(orig,dirV);
      const len = s.hit ? s.hit.distance : .6;
      s.ray.scale.z = len; s.cursor.visible = !!s.hit; if (s.hit) s.cursor.position.copy(s.hit.point);
    } else { s.hit = null; s.cursor.visible = false; }
    // index-finger poke
    const j = s.hand.joints?.['index-finger-tip'];
    if (!j || !j.visible) { s.tip.visible = false; setHover(s,active ? s.hit : null); continue; }
    j.getWorldPosition(tipPos); s.tip.position.copy(tipPos);
    let best = null;
    for (const m of marbles) if (board.visible && m.hit.getWorldPosition(local).distanceTo(tipPos)<.022) best = {currency:m.cur,touch:true};
    if (!best) for (const p of panels) {
      if (!p.mesh.visible || !p.mesh.parent.visible || !p.regions.length || p.name==='toast') continue;
      p.mesh.worldToLocal(local.copy(tipPos));
      const d = local.z*boardRoot.scale.x, lx = local.x/S+p.w/2, ly = p.h/2-(local.y/S);
      if (lx<0||ly<0||lx>p.w||ly>p.h||d>.05||d<-.03) continue;
      const region = p.regions.findLast(r=>lx>=r.x&&lx<=r.x+r.w&&ly>=r.y&&ly<=r.y+r.h);
      if (region) { best = {panel:p,region,touch:d<.008}; break; }
    }
    s.tip.visible = !!best;
    setHover(s,best?.panel ? best : (active ? s.hit : null));
    if (best?.touch && !s.poke.latched) {
      s.poke.latched = true;
      if (best.currency) setCurrency(best.currency);
      else { const bp = best.panel; bp.press = best.region.id; bp.dirty = true; best.region.onTap(); setTimeout(()=>{ bp.press = null; bp.dirty = true; },180); }
    }
    if (!best?.touch) s.poke.latched = false;
  }
}

// ---------------------------------------------------------------- session
let needsPlace = 0;
renderer.xr.addEventListener('sessionstart',()=>{ scene.background = null; renderer.setClearAlpha(0); needsPlace = 12; });
renderer.xr.addEventListener('sessionend',()=>{ scene.background = desktopBg; boardRoot.position.set(0,1.4,0); boardRoot.rotation.set(0,0,0); });
if (navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(()=>false)) {
  enterBtn.disabled = false; enterBtn.textContent = 'Enter MR';
  enterBtn.onclick = async () => {
    try { const session = await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['local-floor'],optionalFeatures:['hand-tracking']});
      await renderer.xr.setSession(session); }
    catch (e) { statusEl.textContent = 'MR could not start: '+e.message; }
  };
} else enterBtn.textContent = 'MR not available — desktop preview';

const counts = HORIZONS.map(h=>`${h.id.toUpperCase()} ${data[h.id]?obsOf(h.id).length+' obs':'—'}`).join(' · ');
statusEl.textContent = dataMode==='HELD'
  ? `Barış's held observations · ${counts}${takenAt?' · snapshot '+utcLabel(takenAt):''} · freshness unverified`
  : `No snapshot yet — showing the repo's old held sample (21 Aug 2026) · ${counts}`;

addEventListener('resize',()=>{ camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });
boardRoot.scale.setScalar(state.scale);

// ---------------------------------------------------------------- frame loop
renderer.setAnimationLoop((now)=>{
  const t = now/1000;
  if (needsPlace && renderer.xr.isPresenting && --needsPlace===0) place();
  updateXRInput();
  updateDiorama(t);
  const minute = new Date().getMinutes()+':'+new Date().getDate();
  if (minute!==lastMinute) { lastMinute = minute; clocksP.dirty = dateP.dirty = newsP.dirty = true; }
  if (toastMsg && now>toastUntil) { toastMsg = ''; toastP.mesh.visible = false; }
  for (const p of panels) {
    if (!p.mesh.visible) continue;
    if (p.dirty || (p.fps && now-p.last>1000/p.fps)) p.redraw(now);
  }
  if (!renderer.xr.isPresenting) orbit.update();
  renderer.render(scene,camera);
});
