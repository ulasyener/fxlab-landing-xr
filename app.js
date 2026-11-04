// fxlab landing L1 — parallel WebXR prototype.
// Layout and sizes come from Figma frame "Landing · L1 · üç bölüm" (1 px = 1 dp; 1 dp is drawn as 1 mm).
// Data: snapshots of Barış's public fxlab evidence API (data/5h.json, 1d.json, 1w.json), read-only.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';

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
  currency: 'USD', hidden: false, scale: 1, desk: false, playing: true, allLinks: false,
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
renderer.localClippingEnabled = true;
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
// Diorama window: a hole through the board, drop and card; the diorama sits in a box behind it.
const WIN = {x:457.5, y:155.5, w:607, h:448, r:16, depth:.52, fill:1.45};   // fill: diorama scale inside the box
function cutWindow(ctx,ox,oy){ ctx.save(); ctx.globalCompositeOperation = 'destination-out';
  rr(ctx,WIN.x-ox,WIN.y-oy,WIN.w,WIN.h,WIN.r); ctx.fill(); ctx.restore(); }
const inWindow = (bx,by) => bx>=WIN.x && bx<=WIN.x+WIN.w && by>=WIN.y && by<=WIN.y+WIN.h;
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
  cutWindow(ctx,0,0);
}});
for (const [x,w,num,name] of [[40,340,'01','TIME'],[410,700,'02','CHARTS'],[1140,340,'03','GAME']]) {
  panel({name:'drop '+name,x,y:40,w,h:790,res:1.5,z:.003,draw(ctx){
    ctx.save(); ctx.shadowColor = '#0b0a18'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
    rr(ctx,0,0,w,790,44); const g = ctx.createLinearGradient(0,0,0,790); g.addColorStop(0,'#30274a'); g.addColorStop(1,'#271f3f');
    ctx.fillStyle = g; ctx.fill(); ctx.restore();
    rr(ctx,0,0,w,790,44); ctx.lineWidth = 1.5; ctx.strokeStyle = '#4b3d63'; ctx.stroke();
    groupLabel(ctx,num,name);
    if (name==='CHARTS') cutWindow(ctx,x,40);
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
const dioCardP = panel({name:'diorama card',x:441.5,y:103.5,w:639,h:581,z:.006,draw(ctx,p){
  rr(ctx,0,0,639,581,24); const g = ctx.createLinearGradient(0,0,0,581);
  g.addColorStop(0,'#2b2852'); g.addColorStop(.55,'#201d40'); g.addColorStop(1,'#16152c');
  ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#3b3672'; ctx.stroke();
  text(ctx,'DIORAMA',25,32,{font:'800 14px Manrope',color:C.muted,ls:'.4px'});
  text(ctx,'3D',614,32,{font:'600 14px "Kode Mono"',color:C.muted,align:'right'});
  // links toggle: selected coin only ↔ all pairs (neural view)
  { const x = 452, y = 14, w = 128, h = 34, on = state.allLinks, hot = p.hover==='links';
    ctx.save(); if (on||hot) { ctx.shadowColor = C.pink; ctx.shadowBlur = on?16:10; }
    rr(ctx,x,y,w,h,17); ctx.fillStyle = on ? C.pink : C.card; ctx.fill(); ctx.restore();
    if (!on) { rr(ctx,x,y,w,h,17); ctx.lineWidth = 1.5; ctx.strokeStyle = hot?C.pink:'#4b4470'; ctx.stroke(); }
    const ink = on ? C.dark : (hot ? C.pink : C.ink), cy = y+h/2;
    // little node graph: three dots, wired to one (selected) or to each other (all)
    const d = [[x+20,cy-7],[x+20,cy+7],[x+34,cy]];
    ctx.strokeStyle = ink; ctx.lineWidth = 1.3; ctx.beginPath();
    ctx.moveTo(...d[2]); ctx.lineTo(...d[0]); ctx.moveTo(...d[2]); ctx.lineTo(...d[1]); if (on) { ctx.moveTo(...d[0]); ctx.lineTo(...d[1]); } ctx.stroke();
    ctx.fillStyle = ink; for (const [a,b] of d) { ctx.beginPath(); ctx.arc(a,b,3,0,Math.PI*2); ctx.fill(); }
    text(ctx,on?'ALL LINKS':'SELECTED',x+48,cy+1,{font:'800 12px Manrope',color:ink,ls:'.4px'});
    p.region('links',x-6,y-8,w+12,h+16,()=>{ state.allLinks = !state.allLinks; p.dirty = true; }); }
  cutWindow(ctx,441.5,103.5);
  rr(ctx,WIN.x-441.5,WIN.y-103.5,WIN.w,WIN.h,WIN.r); ctx.lineWidth = 1.5; ctx.strokeStyle = '#3b3672'; ctx.stroke();
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
  ['save','bookmark-simple','Save',()=>{ try{ localStorage.setItem('fxlab-landing',JSON.stringify({horizon:state.horizon,currency:state.currency,scale:state.scale,desk:state.desk,allLinks:state.allLinks})); toast('Layout saved on this headset'); }catch{ toast('Saving is not available in this browser'); } }],
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
const DIO = {R:.17, U:.06, clamp:2.2};
const dio = new THREE.Group(); dio.name = 'diorama';
dio.position.set((WIN.x+WIN.w/2-BW/2)*S,(BH/2-(WIN.y+WIN.h/2))*S,-WIN.depth/2); dio.rotation.x = .42; dio.scale.setScalar(WIN.fill); board.add(dio);   // inside the window box, tilted toward the viewer
// window box: open front, walls in the card's colours
{ const W = WIN.w*S, H = WIN.h*S, D = WIN.depth, cx = (WIN.x+WIN.w/2-BW/2)*S, cy = (BH/2-(WIN.y+WIN.h/2))*S;
  const wall = (w,h,color,pos,rot) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color,toneMapped:false}));
    m.position.set(cx+pos[0],cy+pos[1],pos[2]); m.rotation.set(...rot); board.add(m); return m; };
  wall(W,H,'#14132a',[0,0,-D],[0,0,0]);                         // back
  wall(W,D,'#1b1934',[0,-H/2,-D/2],[-Math.PI/2,0,0]);           // floor
  wall(W,D,'#242150',[0,H/2,-D/2],[Math.PI/2,0,0]);             // ceiling
  wall(D,H,'#1e1c3e',[-W/2,0,-D/2],[0,Math.PI/2,0]);            // left
  wall(D,H,'#1e1c3e',[W/2,0,-D/2],[0,-Math.PI/2,0]);            // right
}
// clip everything in the diorama to the box (planes in board space, moved to world space every frame)
const winPlanesLocal = (()=>{ const l = (WIN.x-BW/2)*S, r = (WIN.x+WIN.w-BW/2)*S, t = (BH/2-WIN.y)*S, b = (BH/2-WIN.y-WIN.h)*S;
  return [new THREE.Plane(new THREE.Vector3(1,0,0),-l), new THREE.Plane(new THREE.Vector3(-1,0,0),r),
          new THREE.Plane(new THREE.Vector3(0,-1,0),t), new THREE.Plane(new THREE.Vector3(0,1,0),-b),
          new THREE.Plane(new THREE.Vector3(0,0,-1),0), new THREE.Plane(new THREE.Vector3(0,0,1),WIN.depth)]; })();
const winPlanes = winPlanesLocal.map(p=>p.clone());
function updateWindowClip(){ board.updateMatrixWorld(); winPlanesLocal.forEach((p,i)=>winPlanes[i].copy(p).applyMatrix4(board.matrixWorld)); }
function clipToWindow(root){ root.traverse(o=>{ if (o.material) for (const m of [o.material].flat()) { m.clippingPlanes = winPlanes; m.needsUpdate = true; } }); }
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
const UP = new THREE.Color('#9cbcff'), DOWN = new THREE.Color('#e0907e'), PINK = new THREE.Color(C.pink);
const additivePoints = (size,n) => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(n*3),3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color',new THREE.BufferAttribute(new Float32Array(n*3),3).setUsage(THREE.DynamicDrawUsage));
  geo.setDrawRange(0,0);
  const pts = new THREE.Points(geo,new THREE.PointsMaterial({map:glowTex,size,vertexColors:true,transparent:true,
    blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
  pts.frustumCulled = false; return pts;
};

// ---- COT halo: three nested particle shells around each coin, one per trader group (Barış's weekly CoT context)
// inner = commercial (hedgers), middle = noncommercial (speculators), outer = nonreportable (small traders)
// count ← |net| share of open interest · flow ← sign of net (long out / short in) · speed ← weekly change of net
// overall radius ← open interest (log, relative to the other currencies) · brightness ← 52-week percentile extremity
const HALO = {r:[.032,.043,.055], spread:.0055, min:50, max:320, size:.0042, glow:1.25, swirl:.25};
const COT_GROUPS = ['commercial','noncommercial','nonreportable'];
const cotOf = (() => {
  const src = Object.values(data).find(d=>d.contexts?.cot)?.contexts.cot || [], out = {};
  for (const c of src) {
    if (c.state!=='available') continue;
    const d = c.data, oi = d.openInterest || 1, prev = d.previousReport?.state==='available' ? d.previousReport.data.groups : [];
    const p52 = d.statistics?.find(s=>s.window===52)?.percentile;
    out[c.currency] = {
      oi, report:d.reportDate, p52: p52?.state==='available' ? p52.value : 50,
      groups: COT_GROUPS.map(id => {
        const g = d.groups.find(x=>x.id===id) || {long:0,short:0}, pg = prev.find(x=>x.id===id);
        const net = g.net ?? (g.long-g.short), pnet = pg ? pg.long-pg.short : net;
        return {id, net, pctOi: g.netPctOi ?? net/oi*100, change:(net-pnet)/oi};
      }),
    };
  }
  const ois = Object.values(out).map(c=>Math.log(c.oi)), lo = Math.min(...ois), hi = Math.max(...ois);
  for (const c of Object.values(out)) c.oiN = hi>lo ? (Math.log(c.oi)-lo)/(hi-lo) : .5;
  return cur => out[cur] || null;
})();
function makeHalo(cur){
  const cot = cotOf(cur), shells = [];
  let total = 0;
  COT_GROUPS.forEach((id,k)=>{
    const g = cot?.groups[k], share = g ? Math.min(1,Math.abs(g.pctOi)/50) : .15;
    const n = Math.round(HALO.min+(HALO.max-HALO.min)*share);
    shells.push({id, n, start:total, dir: g ? Math.sign(g.net)||1 : 1,
      speed: g ? .12+.9*Math.min(1,Math.abs(g.change)/.04) : .12, r:HALO.r[k]}); total += n;
  });
  const pts = additivePoints(HALO.size,total);
  const dirs = new Float32Array(total*3), phase = new Float32Array(total);
  for (let i=0;i<total;i++){                                     // even spread on the sphere (Fibonacci), random phase
    const y = 1-2*(i+.5)/total, r = Math.sqrt(1-y*y), a = i*2.39996323;
    dirs[i*3] = Math.cos(a)*r; dirs[i*3+1] = y; dirs[i*3+2] = Math.sin(a)*r; phase[i] = Math.random();
  }
  pts.geometry.setDrawRange(0,total);
  const ext = cot ? Math.max(0,(Math.abs(cot.p52-50)-35)/15) : 0;   // 0 inside 15–85 %, 1 at the extremes
  return {pts, shells, dirs, phase, total, size: cot ? .85+.3*cot.oiN : .9, bright:1+ext*.9, tight:1-ext*.4};
}
const marbles = CURRENCIES.map((cur,i)=>{
  const a = -Math.PI/2+i*Math.PI/4, x = Math.cos(a)*DIO.R*.78, z = Math.sin(a)*DIO.R*.78;
  const g = new THREE.Group(); g.position.set(x,0,z); dio.add(g);
  const mat = new THREE.MeshStandardMaterial({color:'#eef3ff',emissive:'#5d86ff',emissiveIntensity:.6,roughness:.2,metalness:.1});
  const ball = new THREE.Group(); g.add(ball);
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(.02,32,16),mat); ball.add(sphere);   // fallback until the coin loads
  const spin = new THREE.Group(); ball.add(spin);                                                // coin turns on its vertical axis
  const hit = new THREE.Mesh(new THREE.SphereGeometry(.03,12,8),new THREE.MeshBasicMaterial({visible:false}));
  hit.userData.currency = cur; ball.add(hit);
  const halo = makeHalo(cur); ball.add(halo.pts);
  const sel = new THREE.Mesh(new THREE.TorusGeometry(.062,.0012,8,96),new THREE.MeshBasicMaterial({color:C.pink,transparent:true,toneMapped:false}));
  sel.rotation.x = Math.PI/2; ball.add(sel);
  const n = 14, pos = new Float32Array(n*3);
  const column = new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(pos,3)),
    new THREE.PointsMaterial({map:glowTex,color:UP,size:.008,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  g.add(column);
  return {cur,i,g,ball,sphere,spin,coin:null,phase:i*.7,mat,hit,halo,sel,column,n,y:0,z:0};
});
const zAt = (o,cur) => { const r = o && rowOf(o,cur); return r ? Math.max(-DIO.clamp,Math.min(DIO.clamp,r.strengthZ)) : 0; };

// ---- links: particle cables from the selected coin's halo to the others (or all pairs)
// route: up from a node on the outer halo shell, across in x, across in z, down to the target node — soft rounded corners
// flow ← direction weak → strong, speed and density ← strength gap · breathing ← speculator CoT positioning gap
const LINK = {rise:.012, riseLen:.03, lane:.03, ceilGap:.012, round:.016, bead:.0026, beadSize:.0034, flowSize:.0068, glow:.95,
              maxBeads:320, maxFlow:36, nodeLift:.7};
const pairs = []; for (let a=0;a<8;a++) for (let b=a+1;b<8;b++) pairs.push([a,b]);
const linkBeads = additivePoints(LINK.beadSize,pairs.length*LINK.maxBeads); dio.add(linkBeads);
const linkFlow = additivePoints(LINK.flowSize,pairs.length*(LINK.maxFlow+2)); dio.add(linkFlow);
const beadJitter = Float32Array.from({length:LINK.maxBeads*3},()=>Math.random()-.5);
clipToWindow(dio); dio.traverse(o=>{ o.renderOrder = -1; });   // drawn before the panels, seen through the window

function updateDiorama(t){
  updateWindowClip();
  const n = loop.obs.length;
  if (n>1 && state.playing) { const L = loop.step*(n-1)+loop.hold, s = (t%L)/loop.step; loop.idx = Math.min(n-1,s); }
  else loop.idx = n-1;
  const i0 = Math.floor(loop.idx), i1 = Math.min(n-1,i0+1), f = loop.idx-i0;
  const gap = loop.obs[i1]?.continuity==='gap', k = gap ? (f<.5?0:1) : f*f*(3-2*f);
  const dt = Math.min(.1,Math.max(0,t-(updateDiorama.last ?? t))); updateDiorama.last = t;
  for (const m of marbles) {
    const z = zAt(loop.obs[i0],m.cur)*(1-k)+zAt(loop.obs[i1],m.cur)*k;
    const y = z*DIO.U; m.ball.position.y = y; m.y = y; m.z = z;
    const col = z>=0 ? UP : DOWN;
    m.column.material.color.copy(col);
    m.mat.emissive.set(z>=0?'#5d86ff':'#b5543f'); m.mat.color.set(z>=0?'#eef3ff':'#f2b0a2');
    m.spin.rotation.y = t*COIN.spin+m.phase;
    m.sel.visible = m.cur===state.currency; m.sel.rotation.z = t*.8; m.sel.material.opacity = .45+.25*Math.sin(t*2.4);
    const p = m.column.geometry.attributes.position;
    for (let j=0;j<m.n;j++){ const u = ((j/m.n)+t*.25)%1; p.setXYZ(j,0,y*u,0); }
    p.needsUpdate = true;
    updateHalo(m,t,dt,col);
  }
  updateLinks(t);
}

const tmpCol = new THREE.Color();
function updateHalo(m,t,dt,col){
  const h = m.halo, pos = h.pts.geometry.attributes.position.array, cl = h.pts.geometry.attributes.color.array;
  const sel = m.cur===state.currency ? 1.25 : 1;
  h.pts.rotation.y = t*HALO.swirl+m.phase; h.pts.rotation.z = Math.sin(t*.3+m.phase)*.25;
  h.shells.forEach((s,k)=>{
    // shell colour: inner whiter, outer carries the up/down tint
    tmpCol.copy(col).lerp(PINK,k===1?.25:0).lerp(new THREE.Color('#ffffff'),k===0?.45:k===1?.15:0);
    const R = s.r*h.size, spread = HALO.spread*h.tight;
    for (let j=0;j<s.n;j++){
      const i = s.start+j;
      h.phase[i] = (h.phase[i]+dt*s.speed*(.6+.8*((i*7919)%13)/13))%1;
      const u = h.phase[i], rr = R+spread*(s.dir>0 ? u : 1-u)-spread*.5;   // long: drift outward · short: drift inward
      const wob = 1+.06*Math.sin(t*1.7+i*.37);
      pos[i*3] = h.dirs[i*3]*rr*wob; pos[i*3+1] = h.dirs[i*3+1]*rr*wob; pos[i*3+2] = h.dirs[i*3+2]*rr*wob;
      const a = Math.sin(Math.PI*u)*(.55+.45*Math.sin(t*3+i))*HALO.glow*h.bright*sel;   // fade in and out along the drift
      cl[i*3] = tmpCol.r*a; cl[i*3+1] = tmpCol.g*a; cl[i*3+2] = tmpCol.b*a;
    }
  });
  h.pts.geometry.attributes.position.needsUpdate = true; h.pts.geometry.attributes.color.needsUpdate = true;
}

// halo node on the outer shell, leaning toward the target (TouchDesigner-style connector ball)
function nodePoint(m,toward,out){
  const R = (HALO.r[2]+HALO.spread*.5)*m.halo.size;
  let dx = toward.g.position.x-m.g.position.x, dz = toward.g.position.z-m.g.position.z; const l = Math.hypot(dx,dz)||1; dx/=l; dz/=l;
  const c = Math.cos(LINK.nodeLift), s = Math.sin(LINK.nodeLift);
  out.set(m.g.position.x+dx*c*R, m.y+s*R, m.g.position.z+dz*c*R); return out;
}
const pathPts = [], cum = [];
function pushPt(x,y,z){ const n = pathPts.length; if (n>=3 && Math.abs(pathPts[n-3]-x)+Math.abs(pathPts[n-2]-y)+Math.abs(pathPts[n-1]-z)<1e-6) return; pathPts.push(x,y,z); }
function buildRoute(A,B,H){
  // orthogonal corners, each softened with a quadratic curve
  const c = [[A.x,A.y,A.z],[A.x,H,A.z],[B.x,H,A.z],[B.x,H,B.z],[B.x,B.y,B.z]]
    .filter((p,i,arr)=>!i || Math.abs(p[0]-arr[i-1][0])+Math.abs(p[1]-arr[i-1][1])+Math.abs(p[2]-arr[i-1][2])>1e-5);
  pathPts.length = 0; pushPt(...c[0]);
  for (let i=1;i<c.length-1;i++){
    const P = c[i], Q = c[i-1], N = c[i+1];
    const lq = Math.hypot(Q[0]-P[0],Q[1]-P[1],Q[2]-P[2]), ln = Math.hypot(N[0]-P[0],N[1]-P[1],N[2]-P[2]);
    const r = Math.min(LINK.round,lq/2,ln/2);
    const p1 = P.map((v,j)=>v+(Q[j]-v)/lq*r), p2 = P.map((v,j)=>v+(N[j]-v)/ln*r);
    for (let s=0;s<=8;s++){ const u = s/8, a = (1-u)*(1-u), b = 2*u*(1-u), d = u*u;
      pushPt(a*p1[0]+b*P[0]+d*p2[0], a*p1[1]+b*P[1]+d*p2[1], a*p1[2]+b*P[2]+d*p2[2]); }
  }
  pushPt(...c.at(-1));
  cum.length = 0; cum.push(0);
  for (let i=3;i<pathPts.length;i+=3) cum.push(cum.at(-1)+Math.hypot(pathPts[i]-pathPts[i-3],pathPts[i+1]-pathPts[i-2],pathPts[i+2]-pathPts[i-1]));
  return cum.at(-1);
}
let seg = 0;
function along(d,out){                       // point at arc length d (monotone calls → walking index)
  if (d<=0) seg = 0; while (seg<cum.length-2 && cum[seg+1]<d) seg++; while (seg>0 && cum[seg]>d) seg--;
  const l = cum[seg+1]-cum[seg] || 1, f = Math.max(0,Math.min(1,(d-cum[seg])/l)), i = seg*3;
  out[0] = pathPts[i]+(pathPts[i+3]-pathPts[i])*f; out[1] = pathPts[i+1]+(pathPts[i+4]-pathPts[i+1])*f; out[2] = pathPts[i+2]+(pathPts[i+5]-pathPts[i+2])*f;
}
const nA = new THREE.Vector3(), nB = new THREE.Vector3(), pt = [0,0,0];
// highest diorama-local y that is still inside the window box at depth z (box ceiling and front opening, tilt included)
function ceilAt(z){
  const a = dio.rotation.x, f = dio.scale.y, half = WIN.h*S/2/f, front = -dio.position.z/f;
  return Math.min((half+z*Math.sin(a))/Math.cos(a), (front-z*Math.cos(a))/Math.sin(a));
}
function updateLinks(t){
  const bp = linkBeads.geometry.attributes.position.array, bc = linkBeads.geometry.attributes.color.array;
  const fp = linkFlow.geometry.attributes.position.array, fc = linkFlow.geometry.attributes.color.array;
  let nb = 0, nf = 0;
  const selIdx = CURRENCIES.indexOf(state.currency);
  pairs.forEach(([ia,ib],pi)=>{
    const involvesSel = ia===selIdx || ib===selIdx;
    if (!state.allLinks && !involvesSel) return;
    // orient the pair: from the selected coin outward (or the lower index when neither is selected)
    const from = involvesSel ? marbles[selIdx] : marbles[ia], to = involvesSel ? marbles[ia===selIdx?ib:ia] : marbles[ib];
    nodePoint(from,to,nA); nodePoint(to,from,nB);
    const dist = Math.hypot(nB.x-nA.x,nB.z-nA.z);
    // rise: longer links climb higher; each link gets its own lane so cables never touch; stays under the window ceiling
    const lane = involvesSel ? to.i : pi, lanes = involvesSel ? 8 : pairs.length;
    const base = Math.max(nA.y,nB.y)+.006, top = Math.max(base,ceilAt(Math.min(nA.z,nB.z))-LINK.ceilGap);
    const H = Math.min(top,base+LINK.rise+LINK.riseLen*dist/(DIO.R*1.56)+LINK.lane*(lane+1)/lanes);
    const len = buildRoute(nA,nB,H);
    // colour: selected stronger → up tint, weaker → down tint; pairs without the selected coin → soft pink
    const gap = to.z-from.z, gapN = Math.min(1,Math.abs(gap)/2);
    if (involvesSel) tmpCol.copy(from.z>=to.z ? UP : DOWN); else tmpCol.copy(PINK);
    const dim = involvesSel ? 1 : .45;
    // breathing ← difference in speculator positioning (% of OI) between the two currencies
    const ca = cotOf(from.cur), cb = cotOf(to.cur);
    const cotGap = ca && cb ? Math.min(1,Math.abs(ca.groups[1].pctOi-cb.groups[1].pctOi)/60) : 0;
    const breath = .55+(.15+.45*cotGap)*Math.sin(t*(1.4+cotGap*1.6)+pi);
    // beads: the cable itself
    const nBeads = Math.min(LINK.maxBeads,Math.floor(len/LINK.bead));
    seg = 0;
    for (let j=0;j<nBeads;j++){
      along(j*LINK.bead,pt); const jj = j*3, J = .0012;
      bp[nb*3] = pt[0]+beadJitter[jj]*J; bp[nb*3+1] = pt[1]+beadJitter[jj+1]*J; bp[nb*3+2] = pt[2]+beadJitter[jj+2]*J;
      const s = j/nBeads, shimmer = .75+.25*Math.sin(t*4-s*18+pi);
      const a = LINK.glow*breath*shimmer*dim*(.35+.65*Math.sin(Math.PI*Math.min(1,s*1.15+.0)));
      bc[nb*3] = tmpCol.r*a; bc[nb*3+1] = tmpCol.g*a; bc[nb*3+2] = tmpCol.b*a; nb++;
    }
    // flowing particles: weak → strong, speed and count from the strength gap
    const forward = gap>=0;                                          // to is stronger → flow from → to
    const nFlow = Math.round(3+(LINK.maxFlow-3)*gapN), v = .025+.07*gapN;
    seg = 0;
    const order = [];
    for (let j=0;j<nFlow;j++){ const u = ((j/nFlow)+t*v/Math.max(len,.01))%1; order.push(forward ? u : 1-u); }
    order.sort((x,y)=>x-y);
    for (const u of order){
      along(u*len,pt); fp[nf*3] = pt[0]; fp[nf*3+1] = pt[1]; fp[nf*3+2] = pt[2];
      const a = Math.sin(Math.PI*u)*(.7+.3*breath)*dim*1.1;
      fc[nf*3] = Math.min(1,tmpCol.r*a+.25*a); fc[nf*3+1] = Math.min(1,tmpCol.g*a+.25*a); fc[nf*3+2] = Math.min(1,tmpCol.b*a+.25*a); nf++;
    }
    // node balls on both halos
    for (const N of [nA,nB]){ fp[nf*3] = N.x; fp[nf*3+1] = N.y; fp[nf*3+2] = N.z;
      const a = (.8+.2*Math.sin(t*3+pi))*dim; fc[nf*3] = Math.min(1,.6*a+tmpCol.r*.5); fc[nf*3+1] = Math.min(1,.6*a+tmpCol.g*.5); fc[nf*3+2] = Math.min(1,.6*a+tmpCol.b*.5); nf++; }
  });
  linkBeads.geometry.setDrawRange(0,nb); linkFlow.geometry.setDrawRange(0,nf);
  for (const g of [linkBeads.geometry,linkFlow.geometry]) { g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; }
}

// ---------------------------------------------------------------- 3D coins (assets/coins/<CODE>.glb, KTX2 + meshopt)
const COIN = {dia:.04, spin:.6, env:.4};        // diameter in metres, spin rad/s, reflection strength
const coinEnv = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(),.04).texture;
const ktx2 = new KTX2Loader().setTranscoderPath('./vendor/addons/libs/basis/').detectSupport(renderer);
const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
for (const m of marbles) {
  gltfLoader.load(`assets/coins/${m.cur}.glb`, gltf => {
    const coin = gltf.scene;
    const box = new THREE.Box3().setFromObject(coin), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
    coin.position.sub(mid);                                   // centre the mesh (the export carries an offset from 3ds Max)
    const holder = new THREE.Group(); holder.add(coin);
    holder.scale.setScalar(COIN.dia/Math.max(size.x,size.z));
    holder.rotation.x = Math.PI/2;                            // coin lies flat in the file; stand it upright
    coin.traverse(o => { if (o.isMesh) { o.material.envMap = coinEnv; o.material.envMapIntensity = COIN.env; } });
    m.spin.add(holder); m.coin = holder; m.sphere.visible = false; clipToWindow(holder);
  }, undefined, err => console.warn('coin', m.cur, err));
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
const holePanels = new Set(['board','drop CHARTS','diorama card']);
function targets(){ const list = []; for (const p of panels) if (p.mesh.visible && p.mesh.parent.visible) list.push(p.mesh);
  if (dio.visible && board.visible) for (const m of marbles) list.push(m.hit); return list; }
function pick(origin,dir){
  raycaster.set(origin,dir); raycaster.far = 6;
  for (const h of raycaster.intersectObjects(targets(),false)) {
    if (h.object.userData.currency) return {currency:h.object.userData.currency,point:h.point,distance:h.distance};
    const p = h.object.userData.panel, {lx,ly,region} = p.hit(h.uv);
    if (lx<0||ly<0||lx>p.w||ly>p.h) continue;           // transparent glow margin
    if (holePanels.has(p.name) && inWindow(p.x+lx,p.y+ly)) continue;   // looking through the diorama window
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
