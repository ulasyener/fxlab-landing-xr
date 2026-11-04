// fxlab landing L1 — parallel WebXR prototype.
// Layout and sizes come from Figma frame "Landing · L1 · üç bölüm" (1 px = 1 dp; 1 dp is drawn as 1 mm).
// Data: snapshots of Barış's public fxlab evidence API (data/5h.json, 1d.json, 1w.json), read-only.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {KTX2Loader} from 'three/addons/loaders/KTX2Loader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {XRHandModelFactory} from 'three/addons/webxr/XRHandModelFactory.js';

const BUILD = '19';               // shown in the status line, so a cached old version is easy to spot
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
  dioOnTable: false, dioI: null, dioJ: null, dioN: 1, grid: true, room: true, gridLift: 0, gridLinked: false, dioQ: null,
  dioView: 'persp', dioYaw: .6, view2D: 'top',   // table diorama: tilt preset + turn · window 2D view while it is on the table
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
  text(ctx,state.dioOnTable?'2D':'3D',614,32,{font:'600 14px "Kode Mono"',color:C.muted,align:'right'});
  // while the diorama is on the table the window shows it flat: top ↔ front
  if (state.dioOnTable) { const x = 118, y = 14, w = 152, h = 34;
    rr(ctx,x,y,w,h,17); ctx.fillStyle = C.card; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#4b4470'; ctx.stroke();
    [['top','TOP'],['front','FRONT']].forEach(([id,label],k)=>{ const sx = x+3+k*73, on = state.view2D===id, hot = p.hover==='v2'+id;
      if (on) { ctx.save(); ctx.shadowColor = C.pink; ctx.shadowBlur = 12; rr(ctx,sx,y+3,73,h-6,14); ctx.fillStyle = C.pink; ctx.fill(); ctx.restore(); }
      text(ctx,label,sx+36.5,y+h/2+1,{font:'800 12px Manrope',color:on?C.dark:(hot?C.pink:C.ink),align:'center',ls:'.4px'});
      p.region('v2'+id,sx,y-8,73,h+16,()=>{ state.view2D = id; p.dirty = true; viewDirty = true; }); }); }
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
  // bring the diorama into the room: onto the table grid, and back into the window
  { const x = 290, y = 14, w = 150, h = 34, on = state.dioOnTable, hot = p.hover==='table';
    ctx.save(); if (hot) { ctx.shadowColor = C.pink; ctx.shadowBlur = 12; }
    rr(ctx,x,y,w,h,17); ctx.fillStyle = C.card; ctx.fill(); ctx.restore();
    rr(ctx,x,y,w,h,17); ctx.lineWidth = 1.5; ctx.strokeStyle = hot?C.pink:'#4b4470'; ctx.stroke();
    const ink = hot ? C.pink : C.ink;
    drawIcon(ctx,'desk',ink,x+22,y+h/2,18);
    text(ctx,on?'BACK TO WINDOW':'PLACE ON TABLE',x+38,y+h/2+1,{font:'800 12px Manrope',color:ink,ls:'.4px'});
    p.region('table',x-4,y-8,w+8,h+16,()=>{ state.dioOnTable ? dioToWindow() : dioToTable(); toast(state.dioOnTable?'Diorama on the table · pinch it to move, pull a corner to scale':'Diorama back in its window'); }); }
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
  ['eye','eye','Hide / show all',()=>{ state.hidden = !state.hidden; board.visible = !state.hidden; }],
  ['house','house','Default layout',()=>{ state.scale = 1; state.desk = false; place(); placeGrid(); toast('Back to the default layout'); }],
  ['save','bookmark-simple','Save',()=>{ try{ localStorage.setItem('fxlab-landing',JSON.stringify({horizon:state.horizon,currency:state.currency,scale:state.scale,desk:state.desk,allLinks:state.allLinks,dioOnTable:state.dioOnTable,dioI:state.dioI,dioJ:state.dioJ,dioN:state.dioN,grid:state.grid,room:state.room,gridLift:state.gridLift,gridLinked:state.gridLinked,dioQ:state.dioQ,dioView:state.dioView,dioYaw:state.dioYaw,view2D:state.view2D})); toast('Layout saved on this headset'); }catch{ toast('Saving is not available in this browser'); } }],
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
// FPS: bottom-right corner of the landing, aligned with the GAME column
const FPS = {hist:new Array(120).fill(null), acc:0, n:0, t0:0, last:0, now:0, ms:0, target:60};   // 120 samples × 0.25 s = last 30 s
function fpsTick(now){
  if (FPS.last) { const dt = now-FPS.last; if (dt>0 && dt<1000) { FPS.acc += dt; FPS.n++; } }
  FPS.last = now;
  if (now-FPS.t0>=250 && FPS.n) { FPS.ms = FPS.acc/FPS.n; FPS.now = 1000/FPS.ms; FPS.hist.push(FPS.now); FPS.hist.shift(); FPS.acc = FPS.n = 0; FPS.t0 = now; fpsP.dirty = true; }
}
const fpsP = panel({name:'fps',x:1173.5,y:860,w:273,h:104.6,margin:12,z:.006,draw(ctx){
  card(ctx,273,104.6);
  const has = FPS.now>0, low = has && FPS.now<FPS.target*.85, col = low ? C.coral : C.pink;
  text(ctx,'FPS',22,28,{font:'800 13px Manrope',color:C.muted,ls:'.5px'});
  text(ctx,has?`${FPS.ms.toFixed(1)} ms · ${Math.round(FPS.target)} Hz`:'—',60,28.5,{font:'400 13px "Kode Mono"',color:C.dim});
  text(ctx,has?String(Math.round(FPS.now)):'—',251,30,{font:'600 30px "Kode Mono"',color:low?C.coral:C.ink,align:'right'});
  const gx = 22, gy = 52, gw = 229, gh = 34, vals = FPS.hist.filter(v=>v!=null);
  const top = Math.max(FPS.target,...vals)*1.12, Y = v => gy+gh-gh*Math.min(1,v/top), N = FPS.hist.length, X = i => gx+gw*i/(N-1);
  ctx.setLineDash([1.4,4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(167,162,201,.5)';
  ctx.beginPath(); ctx.moveTo(gx,Y(FPS.target)); ctx.lineTo(gx+gw,Y(FPS.target)); ctx.stroke(); ctx.setLineDash([]);   // display refresh rate
  ctx.fillStyle = '#4a4470'; ctx.fillRect(gx,gy+gh,gw,1);
  const i0 = FPS.hist.findIndex(v=>v!=null); if (i0<0 || i0>N-2) return;
  ctx.beginPath(); for (let i=i0;i<N;i++) i===i0 ? ctx.moveTo(X(i),Y(FPS.hist[i])) : ctx.lineTo(X(i),Y(FPS.hist[i]));
  ctx.save(); ctx.lineTo(X(N-1),gy+gh); ctx.lineTo(X(i0),gy+gh); ctx.closePath();
  const g = ctx.createLinearGradient(0,gy,0,gy+gh); g.addColorStop(0,low?'rgba(224,144,126,.35)':'rgba(231,168,240,.32)'); g.addColorStop(1,'rgba(231,168,240,0)');
  ctx.fillStyle = g; ctx.fill(); ctx.restore();
  ctx.save(); ctx.shadowColor = col; ctx.shadowBlur = 8; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.strokeStyle = col;
  ctx.beginPath(); for (let i=i0;i<N;i++) i===i0 ? ctx.moveTo(X(i),Y(FPS.hist[i])) : ctx.lineTo(X(i),Y(FPS.hist[i])); ctx.stroke(); ctx.restore();
  glowDot(ctx,X(N-1),Y(FPS.hist[N-1]),3.2,'#fff6ff',low?'rgba(224,144,126,.75)':'rgba(231,168,240,.75)');
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
// window box: open front, walls in the card's colours. It is only drawn while the board hides it completely
// (seen through the window from the front); from the side or from behind it disappears together with the diorama.
const winBox = new THREE.Group(); winBox.name = 'window box'; board.add(winBox);
{ const W = WIN.w*S, H = WIN.h*S, D = WIN.depth, cx = (WIN.x+WIN.w/2-BW/2)*S, cy = (BH/2-(WIN.y+WIN.h/2))*S;
  const wall = (w,h,color,pos,rot) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color,toneMapped:false}));
    m.position.set(cx+pos[0],cy+pos[1],pos[2]); m.rotation.set(...rot); winBox.add(m); return m; };
  wall(W,H,'#14132a',[0,0,-D],[0,0,0]);                         // back
  wall(W,D,'#1b1934',[0,-H/2,-D/2],[-Math.PI/2,0,0]);           // floor
  wall(W,D,'#242150',[0,H/2,-D/2],[Math.PI/2,0,0]);             // ceiling
  wall(D,H,'#1e1c3e',[-W/2,0,-D/2],[0,Math.PI/2,0]);            // left
  wall(D,H,'#1e1c3e',[W/2,0,-D/2],[0,-Math.PI/2,0]);            // right
}
// rear cover: the board's back is a closed, quiet panel (the front panels are one-sided)
{ const w = BW*S, h = BH*S, r = 48*S, sh = new THREE.Shape();
  sh.moveTo(-w/2+r,-h/2); sh.lineTo(w/2-r,-h/2); sh.absarc(w/2-r,-h/2+r,r,-Math.PI/2,0); sh.lineTo(w/2,h/2-r); sh.absarc(w/2-r,h/2-r,r,0,Math.PI/2);
  sh.lineTo(-w/2+r,h/2); sh.absarc(-w/2+r,h/2-r,r,Math.PI/2,Math.PI); sh.lineTo(-w/2,-h/2+r); sh.absarc(-w/2+r,-h/2+r,r,Math.PI,Math.PI*1.5);
  const back = new THREE.Mesh(new THREE.ShapeGeometry(sh,12),new THREE.MeshBasicMaterial({color:'#1b1830',toneMapped:false}));
  back.rotation.y = Math.PI; back.position.z = -.0015; back.name = 'board back'; board.add(back);
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(sh.getPoints(12)),new THREE.LineBasicMaterial({color:'#c99be0',transparent:true,opacity:.45,toneMapped:false}));
  edge.rotation.y = Math.PI; edge.position.z = -.0016; board.add(edge);
}
// is the box fully hidden behind the board from where the viewer stands? (camera in board space; back corners projected onto the board plane)
const camW = new THREE.Vector3(), camB = new THREE.Vector3();
function windowSeen(){
  (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).getWorldPosition(camW);
  board.updateMatrixWorld(); board.worldToLocal(camB.copy(camW));
  if (camB.z<.01) return false;
  const l = (WIN.x-BW/2)*S, r = (WIN.x+WIN.w-BW/2)*S, t = (BH/2-WIN.y)*S, b = (BH/2-WIN.y-WIN.h)*S, hx = BW/2*S-.02, hy = BH/2*S-.02;
  const k = camB.z/(camB.z+WIN.depth);
  for (const x of [l,r]) for (const y of [b,t]) { if (Math.abs(camB.x+(x-camB.x)*k)>hx || Math.abs(camB.y+(y-camB.y)*k)>hy) return false; }
  return true;
}
// clip everything in the diorama to the box (planes in board space, moved to world space every frame)
const winPlanesLocal = (()=>{ const l = (WIN.x-BW/2)*S, r = (WIN.x+WIN.w-BW/2)*S, t = (BH/2-WIN.y)*S, b = (BH/2-WIN.y-WIN.h)*S;
  return [new THREE.Plane(new THREE.Vector3(1,0,0),-l), new THREE.Plane(new THREE.Vector3(-1,0,0),r),
          new THREE.Plane(new THREE.Vector3(0,-1,0),t), new THREE.Plane(new THREE.Vector3(0,1,0),-b),
          new THREE.Plane(new THREE.Vector3(0,0,-1),0), new THREE.Plane(new THREE.Vector3(0,0,1),WIN.depth)]; })();
const winPlanes = winPlanesLocal.map(p=>p.clone());
function updateWindowClip(){ board.updateMatrixWorld(); winPlanesLocal.forEach((p,i)=>winPlanes[i].copy(p).applyMatrix4(board.matrixWorld)); }
function clipToWindow(root){ root.traverse(o=>{ if (o.material) for (const m of [o.material].flat()) { m.clippingPlanes = state.dioOnTable ? null : winPlanes; m.needsUpdate = true; } }); }
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
const UP = new THREE.Color('#9cbcff'), DOWN = new THREE.Color('#e0907e'), PINK = new THREE.Color(C.pink), WHITE = new THREE.Color('#ffffff');
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
const HALO = {r:[.024,.031,.038], spread:.0016, min:110, max:300, size:.0044, glow:1.25, swirl:.35, rim:.5, rimR:.043,
              breath:.35, period:4.2};   // three clearly separated shells · breathing depth (0–1) and period (s), each shell on its own beat
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
function marbleRimMaterial(){
  // additive fresnel shell: transparent in the middle (the coin stays visible), glowing toward the silhouette
  return new THREE.ShaderMaterial({
    uniforms:{uColor:{value:new THREE.Color('#9cbcff')}, uStrength:{value:1}},
    vertexShader:`#include <clipping_planes_pars_vertex>
      varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mvPosition = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mvPosition.xyz);
        gl_Position = projectionMatrix*mvPosition;
        #include <clipping_planes_vertex>
      }`,
    fragmentShader:`#include <clipping_planes_pars_fragment>
      uniform vec3 uColor; uniform float uStrength; varying vec3 vN; varying vec3 vV;
      void main(){
        #include <clipping_planes_fragment>
        float f = 1.-abs(dot(normalize(vN),normalize(vV)));
        float a = pow(f,2.2)*.9+pow(f,7.)*1.4;
        gl_FragColor = vec4(uColor*a*uStrength,1.);
      }`,
    transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, clipping:true, toneMapped:false,
  });
}
function makeHalo(cur){
  const cot = cotOf(cur), shells = [];
  let total = 0;
  COT_GROUPS.forEach((id,k)=>{
    const g = cot?.groups[k], share = g ? Math.min(1,Math.abs(g.pctOi)/50) : .15;
    const n = Math.round(HALO.min+(HALO.max-HALO.min)*share);
    shells.push({id, n, start:total, dir: g ? Math.sign(g.net)||1 : 1,
      speed: g ? .35+1.6*Math.min(1,Math.abs(g.change)/.04) : .35, r:HALO.r[k]}); total += n;
  });
  const pts = additivePoints(HALO.size,total);
  const dirs = new Float32Array(total*3), phase = new Float32Array(total);
  for (let i=0;i<total;i++){                                     // even spread on the sphere (Fibonacci), random phase
    const y = 1-2*(i+.5)/total, r = Math.sqrt(1-y*y), a = i*2.39996323;
    dirs[i*3] = Math.cos(a)*r; dirs[i*3+1] = y; dirs[i*3+2] = Math.sin(a)*r; phase[i] = Math.random();
  }
  pts.geometry.setDrawRange(0,total);
  const ext = cot ? Math.max(0,(Math.abs(cot.p52-50)-35)/15) : 0;   // 0 inside 15–85 %, 1 at the extremes
  const size = cot ? .85+.3*cot.oiN : .9;
  const rim = new THREE.Mesh(new THREE.SphereGeometry(HALO.rimR*size,48,24),marbleRimMaterial());   // glass-marble edge glow
  return {pts, rim, shells, dirs, phase, total, size, bright:1+ext*.45, tight:1-ext*.3};
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
  const halo = makeHalo(cur); ball.add(halo.pts); ball.add(halo.rim);
  const sel = new THREE.Mesh(new THREE.TorusGeometry(.054,.0012,8,96),new THREE.MeshBasicMaterial({color:C.pink,transparent:true,toneMapped:false}));
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
const LINK = {rise:.012, riseLen:.03, lane:.03, ceilGap:.012, round:.016, bead:.0026, beadSize:.0042, flowSize:.0095, glow:1.8, sway:.0016,
              maxBeads:320, maxFlow:56, nodeLift:.7};
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
  const sel = m.cur===state.currency ? 1.15 : 1, w = 2*Math.PI/HALO.period;
  const beat = ph => 1-HALO.breath+HALO.breath*(.5+.5*Math.sin(t*w+ph));        // slow breathing instead of sparkle
  h.pts.rotation.y = t*HALO.swirl+m.phase; h.pts.rotation.z = Math.sin(t*.2+m.phase)*.15;
  h.rim.material.uniforms.uColor.value.copy(col).lerp(PINK,.2);
  h.rim.material.uniforms.uStrength.value = HALO.rim*h.bright*sel*beat(m.phase);
  h.shells.forEach((s,k)=>{
    // three readable shells: inner (commercial) near white · middle (speculators) pink · outer (small traders) up/down tint
    tmpCol.copy(col); if (k===0) tmpCol.lerp(WHITE,.6); else if (k===1) tmpCol.lerp(PINK,.6).lerp(WHITE,.1);
    const br = beat(m.phase+k*2.1);
    const R = s.r*h.size, spread = HALO.spread*h.tight;
    for (let j=0;j<s.n;j++){
      const i = s.start+j;
      h.phase[i] = (h.phase[i]+dt*s.speed*(.6+.8*((i*7919)%13)/13))%1;
      const u = h.phase[i], rr = R+spread*(s.dir>0 ? u : 1-u)-spread*.5;   // long: drift outward · short: drift inward
      const wob = 1+.015*Math.sin(t*.9+i*.37);
      pos[i*3] = h.dirs[i*3]*rr*wob; pos[i*3+1] = h.dirs[i*3+1]*rr*wob; pos[i*3+2] = h.dirs[i*3+2]*rr*wob;
      const a = (.3+.7*Math.sin(Math.PI*u))*br*HALO.glow*h.bright*sel;   // fade in and out along the drift
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
  if (state.dioOnTable) return .3;
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
      along(j*LINK.bead,pt); const jj = j*3, J = .0012, s = j/nBeads;
      const sw = LINK.sway*Math.sin(Math.PI*s)*(.6+cotGap);           // the cable undulates, more when positioning differs
      bp[nb*3] = pt[0]+beadJitter[jj]*J+sw*Math.sin(t*2.6+s*16+pi); bp[nb*3+1] = pt[1]+beadJitter[jj+1]*J+sw*Math.sin(t*3.1+s*13+pi*.7);
      bp[nb*3+2] = pt[2]+beadJitter[jj+2]*J+sw*Math.cos(t*2.3+s*15+pi);
      const dirS = gap>=0 ? s : 1-s, packet = Math.pow(.5+.5*Math.sin(dirS*26-t*(3+5*gapN)),6);   // light packets running weak → strong
      const shimmer = .45+.25*Math.sin(t*4-s*18+pi)+.9*packet;
      const a = LINK.glow*breath*shimmer*dim*(.35+.65*Math.sin(Math.PI*Math.min(1,s*1.15+.0)));
      bc[nb*3] = tmpCol.r*a; bc[nb*3+1] = tmpCol.g*a; bc[nb*3+2] = tmpCol.b*a; nb++;
    }
    // flowing particles: weak → strong, speed and count from the strength gap
    const forward = gap>=0;                                          // to is stronger → flow from → to
    const nFlow = Math.round(8+(LINK.maxFlow-8)*gapN), v = .07+.16*gapN;
    seg = 0;
    const order = [];
    for (let j=0;j<nFlow;j++){ const u = ((j/nFlow)+t*v/Math.max(len,.01))%1; order.push(forward ? u : 1-u); }
    order.sort((x,y)=>x-y);
    for (const u of order){
      along(u*len,pt); fp[nf*3] = pt[0]; fp[nf*3+1] = pt[1]; fp[nf*3+2] = pt[2];
      const a = Math.sin(Math.PI*u)*(.7+.3*breath)*dim*1.9;
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
const COIN = {dia:.04, spin:.6, env:.2, rough:2.2, metal:.8, tint:'#d6c3ad'};   // diameter m, spin rad/s, reflections, roughness ×, metalness ×, aged warm tint
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
    coin.traverse(o => { if (o.isMesh) { const mt = o.material; mt.envMap = coinEnv; mt.envMapIntensity = COIN.env;
      mt.roughness = COIN.rough; mt.metalness = Math.min(mt.metalness,1)*COIN.metal; mt.color.multiply(new THREE.Color(COIN.tint)); } });
    m.spin.add(holder); m.coin = holder; m.sphere.visible = false; clipToWindow(holder);
  }, undefined, err => console.warn('coin', m.cur, err));
}

// ---------------------------------------------------------------- 3D table workspace: wireframe grid, room scan, diorama on the table
// Grid: 2 m × 1 m in real size, fixed 25 cm cells (8 × 4). Origin at the grid centre on the table surface,
// x along the 2 m side, +z toward the user, y up. Each visualisation arrives one cell in size (1x) and
// scales from its corner nodes in whole-cell steps.
const DESK = {cols:8, rows:4, cell:.25, maxN:4, lineA:.16, borderA:.42, crossA:.5, glowR:.2, tableH:.74, ahead:.72};
const DESK_W = DESK.cols*DESK.cell, DESK_D = DESK.rows*DESK.cell;
const deskGrid = new THREE.Group(); deskGrid.name = 'table grid'; scene.add(deskGrid);
const deskLines = new THREE.Group(); deskGrid.add(deskLines);      // what the GRID toggle hides
const gridUniforms = {uHand0:{value:new THREE.Vector3(0,99,0)}, uHand1:{value:new THREE.Vector3(0,99,0)}, uTime:{value:0},
  uBase:{value:new THREE.Color('#8fb0ff')}, uHot:{value:new THREE.Color(C.pink)}};
function gridMaterial(){
  return new THREE.ShaderMaterial({
    uniforms:gridUniforms, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, toneMapped:false,
    vertexShader:`attribute float aA; varying float vA; varying vec3 vP;
      void main(){ vA = aA; vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`uniform vec3 uHand0; uniform vec3 uHand1; uniform vec3 uBase; uniform vec3 uHot; uniform float uTime;
      varying float vA; varying vec3 vP;
      void main(){
        float d = min(distance(vP,uHand0),distance(vP,uHand1));
        float g = smoothstep(${DESK.glowR.toFixed(3)},0.,d);                // lines light up near the hand
        float edge = smoothstep(0.,.12,min(${(DESK_W/2).toFixed(3)}-abs(vP.x),${(DESK_D/2).toFixed(3)}-abs(vP.z))+.06);
        float a = vA*(.85+.15*sin(uTime*1.3+vP.x*3.1+vP.z*2.3))*edge + g*.55;
        gl_FragColor = vec4(mix(uBase,uHot,g)*a,1.);
      }`,
  });
}
{ const pos = [], aA = [], seg = (x0,z0,x1,z1,a) => { pos.push(x0,0,z0,x1,0,z1); aA.push(a,a); };
  const hx = DESK_W/2, hz = DESK_D/2;
  for (let i=1;i<DESK.cols;i++) { const x = -hx+i*DESK.cell; seg(x,-hz,x,hz,DESK.lineA); }
  for (let j=1;j<DESK.rows;j++) { const z = -hz+j*DESK.cell; seg(-hx,z,hx,z,DESK.lineA); }
  seg(-hx,-hz,hx,-hz,DESK.borderA); seg(hx,-hz,hx,hz,DESK.borderA); seg(hx,hz,-hx,hz,DESK.borderA); seg(-hx,hz,-hx,-hz,DESK.borderA);
  // small crosses on every intersection (node marks)
  const k = .012;
  for (let i=0;i<=DESK.cols;i++) for (let j=0;j<=DESK.rows;j++) { const x = -hx+i*DESK.cell, z = -hz+j*DESK.cell;
    seg(x-k,z,x+k,z,DESK.crossA); seg(x,z-k,x,z+k,DESK.crossA); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('aA',new THREE.Float32BufferAttribute(aA,1));
  const lines = new THREE.LineSegments(g,gridMaterial()); lines.position.y = .001; lines.frustumCulled = false; deskLines.add(lines);
}
// target cells while something is carried
const dropFill = new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:C.pink,transparent:true,opacity:.1,
  depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
dropFill.rotation.x = -Math.PI/2; dropFill.position.y = .002; dropFill.visible = false; deskGrid.add(dropFill);
const dropEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1,1)),new THREE.LineBasicMaterial({color:C.pink,transparent:true,opacity:.8,toneMapped:false}));
dropEdge.rotation.x = -Math.PI/2; dropEdge.position.y = .003; dropEdge.visible = false; deskGrid.add(dropEdge);

// footprint of the diorama on the table: outline, a pinch surface to move it, corner nodes to scale it
const deskItem = new THREE.Group(); deskItem.name = 'diorama on table'; deskGrid.add(deskItem);
const itemEdge = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(1,1)),new THREE.LineBasicMaterial({color:'#b9c9ff',transparent:true,opacity:.45,toneMapped:false}));
itemEdge.rotation.x = -Math.PI/2; itemEdge.position.y = .003; deskItem.add(itemEdge);
const itemPad = new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({visible:false}));
itemPad.rotation.x = -Math.PI/2; itemPad.position.y = .004; itemPad.userData.kind = 'dioMove'; deskItem.add(itemPad);
const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([sx,sz])=>{
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.009,16,10),new THREE.MeshBasicMaterial({color:'#fff3ff',toneMapped:false}));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:C.pink,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  glow.scale.setScalar(.05); ball.add(glow);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(.03,10,8),new THREE.MeshBasicMaterial({visible:false}));
  hit.userData.kind = 'dioScale'; hit.userData.corner = [sx,sz]; ball.add(hit);
  deskItem.add(ball); return {ball,glow,hit,sx,sz};
});
const holder3D = new THREE.Group(); deskItem.add(holder3D);           // the diorama is re-parented here
deskItem.visible = false;

const DIO_FOOT = .40;                                                    // diorama width incl. halos (dio units)
// tilt presets on the table; the turn (state.dioYaw) works in all of them. lift keeps the lowest point above the table (dio units)
const TABLE_VIEWS = {top:{tilt:Math.PI/2, lift:.21, label:'TOP'}, front:{tilt:0, lift:.2, label:'FRONT'}, persp:{tilt:.35, lift:.24, label:'PERSP'}};
const tableView = () => TABLE_VIEWS[state.dioView] || TABLE_VIEWS.persp;
const dioTargetQ = new THREE.Quaternion(), dioEuler = new THREE.Euler(0,0,0,'XYZ');
const dioWindowPose = {pos:dio.position.clone(), rotX:dio.rotation.x, scale:dio.scale.x};
const cellCentre = (i,n) => (i+n/2)*DESK.cell;
function layoutDeskItem(i,j,n,instant){
  const x = cellCentre(i,n)-DESK_W/2, z = cellCentre(j,n)-DESK_D/2, w = n*DESK.cell;
  deskItem.userData.target = new THREE.Vector3(x,0,z); if (instant) deskItem.position.set(x,0,z);
  itemEdge.scale.set(w*.98,w*.98,1); itemPad.scale.set(w,w,1);
  for (const c of corners) c.ball.position.set(c.sx*w/2,.006,c.sz*w/2);
  const s = w/DIO_FOOT; dio.scale.setScalar(s); freeLift();
  if (instant) { dio.position.set(0,dio.userData.lift,0); dio.quaternion.copy(state.dioQ ? qH.fromArray(state.dioQ) : tableTargetQ()); }
  rotRing.scale.setScalar(w); knob.scale.setScalar(1/w);
  tableViewP.mesh.position.set(0,.02,w/2+.07);
}
function tableTargetQ(){ dioEuler.set(tableView().tilt,state.dioYaw||0,0,'XYZ'); return dioTargetQ.setFromEuler(dioEuler); }   // turn about its own up axis, then tilt toward the user
function setDioClip(on){ dio.traverse(o=>{ if (o.material) for (const m of [o.material].flat()) { m.clippingPlanes = on ? winPlanes : null; m.needsUpdate = true; } }); }
function dioToTable(){
  state.dioOnTable = true; deskItem.visible = true; holder3D.add(dio);
  const n = Math.min(DESK.maxN,state.dioN||1);
  state.dioN = n; state.dioI = Math.min(DESK.cols-n,state.dioI ?? Math.floor((DESK.cols-n)/2)); state.dioJ = Math.min(DESK.rows-n,state.dioJ ?? DESK.rows-n);
  layoutDeskItem(state.dioI,state.dioJ,n,true); setDioClip(false); dioCardP.dirty = true;
}
function dioToWindow(){
  state.dioOnTable = false; deskItem.visible = false; board.add(dio);
  dio.position.copy(dioWindowPose.pos); dio.rotation.set(dioWindowPose.rotX,0,0); dio.scale.setScalar(dioWindowPose.scale);
  setDioClip(true); dioCardP.dirty = true;
}

// turning ring around the footprint: pinch it and drag around to turn the diorama
const RING = {r:.85, in:.79, out:.95};                                   // × item width
const rotRing = new THREE.Group(); rotRing.position.y = .006; deskItem.add(rotRing);
{ const pts = []; for (let i=0;i<=128;i++){ const a = i/128*Math.PI*2; pts.push(new THREE.Vector3(Math.sin(a)*RING.r,0,Math.cos(a)*RING.r)); }
  const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineDashedMaterial({color:'#b9c9ff',transparent:true,opacity:.4,dashSize:.012,gapSize:.018,toneMapped:false}));
  l.computeLineDistances(); rotRing.add(l);
  const hit = new THREE.Mesh(new THREE.RingGeometry(RING.in,RING.out,64),new THREE.MeshBasicMaterial({visible:false}));
  hit.rotation.x = -Math.PI/2; hit.userData.kind = 'dioRotate'; rotRing.add(hit); rotRing.userData.hit = hit; }
const knob = new THREE.Mesh(new THREE.SphereGeometry(.008,16,10),new THREE.MeshBasicMaterial({color:'#fff3ff',toneMapped:false}));
{ const g = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:C.pink,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  g.scale.setScalar(.045); knob.add(g); } rotRing.add(knob);

// tilt presets strip, at the item's front edge, tilted toward the user
const tableViewP = panel({name:'table views',x:0,y:0,w:262,h:52,margin:8,parent:deskItem,z:0,draw(ctx,p){
  rr(ctx,0,0,262,52,26); ctx.fillStyle = 'rgba(35,32,66,.92)'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#3d3762'; ctx.stroke();
  ['top','front','persp'].forEach((id,k)=>{
    const x = 9+k*82, y = 9, w = 78, h = 34, on = !state.dioQ && state.dioView===id, hot = p.hover===id;
    ctx.save(); if (on||hot) { ctx.shadowColor = C.pink; ctx.shadowBlur = on?14:8; }
    rr(ctx,x,y,w,h,17); ctx.fillStyle = on ? C.pink : C.card; ctx.fill(); ctx.restore();
    if (!on) { rr(ctx,x,y,w,h,17); ctx.lineWidth = 1.5; ctx.strokeStyle = hot?C.pink:'#4b4470'; ctx.stroke(); }
    text(ctx,TABLE_VIEWS[id].label,x+w/2,y+h/2+1,{font:'800 12px Manrope',color:on?C.dark:(hot?C.pink:C.ink),align:'center',ls:'.5px'});
    p.region(id,x,y,w,h,()=>setTableView(id));
  });
}});
tableViewP.mesh.rotation.x = -1.05;
function setTableView(id){
  state.dioView = id; state.dioQ = null; state.dioYaw = id==='persp' ? (Math.abs(state.dioYaw)<.05 ? .6 : state.dioYaw) : 0;
  freeLift(); tableViewP.dirty = true;
}

// ---- 2D view in the window while the diorama is on the table (live orthographic render: top or front)
const VIEW = {w:896, fps:20, bg:'#14132a', top:{half:.21, cy:0}, front:{half:.22, cy:.04}};
const viewRT = new THREE.WebGLRenderTarget(VIEW.w,Math.round(VIEW.w*WIN.h/WIN.w),{samples:2});
viewRT.texture.colorSpace = THREE.SRGBColorSpace;
const viewScene = new THREE.Scene(); viewScene.background = new THREE.Color(VIEW.bg);
viewScene.add(new THREE.HemisphereLight('#cfd9ff','#2a2140',1.3));
{ const l = new THREE.DirectionalLight('#ffffff',1.6); l.position.set(1,3,2); viewScene.add(l); }   // same lights as the room scene
const viewCam = new THREE.OrthographicCamera(-1,1,1,-1,.01,5);
const viewPlane = new THREE.Mesh(new THREE.PlaneGeometry(WIN.w*S,WIN.h*S),new THREE.MeshBasicMaterial({map:viewRT.texture,toneMapped:false}));
viewPlane.position.set((WIN.x+WIN.w/2-BW/2)*S,(BH/2-(WIN.y+WIN.h/2))*S,-.004); viewPlane.renderOrder = -1; viewPlane.visible = false; viewPlane.name = 'window 2D view'; board.add(viewPlane);
let viewDirty = true, viewLast = 0;
const saveP = new THREE.Vector3(), saveQ = new THREE.Quaternion(), saveS = new THREE.Vector3(), viewPts = [];
function renderView(now){
  if (!state.dioOnTable || state.hidden) return;
  if (!viewDirty && now-viewLast<1000/VIEW.fps) return; viewDirty = false; viewLast = now;
  const top = state.view2D!=='front', v = top ? VIEW.top : VIEW.front, aspect = WIN.w/WIN.h;
  viewCam.left = -v.half*aspect; viewCam.right = v.half*aspect; viewCam.top = v.cy+v.half; viewCam.bottom = v.cy-v.half;
  if (top) { viewCam.position.set(0,2,0); viewCam.up.set(0,0,-1); } else { viewCam.position.set(0,0,2); viewCam.up.set(0,1,0); }
  viewCam.lookAt(0,0,0); viewCam.updateProjectionMatrix();
  // borrow the diorama for a moment, in a neutral pose
  const parent = dio.parent; saveP.copy(dio.position); saveQ.copy(dio.quaternion); saveS.copy(dio.scale);
  viewScene.add(dio); dio.position.set(0,0,0); dio.quaternion.identity(); dio.scale.setScalar(1);
  // points are sized in pixels under an orthographic camera: convert their world size
  const px = viewRT.height/(2*v.half)/renderer.getPixelRatio(); viewPts.length = 0;
  dio.traverse(o=>{ if (o.isPoints) { viewPts.push([o.material,o.material.size]); o.material.size *= px; } });
  const xrOn = renderer.xr.enabled, old = renderer.getRenderTarget();
  renderer.xr.enabled = false; renderer.setRenderTarget(viewRT); renderer.render(viewScene,viewCam);
  renderer.setRenderTarget(old); renderer.xr.enabled = xrOn;
  for (const [m,sz] of viewPts) m.size = sz;
  parent.add(dio); dio.position.copy(saveP); dio.quaternion.copy(saveQ); dio.scale.copy(saveS);
}

// grid controls: a small strip at the near-left corner, tilted toward the user
const deskCtlP = panel({name:'grid controls',x:0,y:0,w:400,h:52,margin:8,parent:deskGrid,z:0,draw(ctx,p){
  rr(ctx,0,0,400,52,26); ctx.fillStyle = 'rgba(35,32,66,.92)'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#3d3762'; ctx.stroke();
  [['grid','GRID',state.grid!==false],['room','ROOM',state.room!==false]].forEach(([id,label,on],k)=>{
    const x = 10+k*120, y = 9, w = 110, h = 34, hot = p.hover===id;
    ctx.save(); if (on||hot) { ctx.shadowColor = C.pink; ctx.shadowBlur = on?14:8; }
    rr(ctx,x,y,w,h,17); ctx.fillStyle = on ? C.pink : C.card; ctx.fill(); ctx.restore();
    if (!on) { rr(ctx,x,y,w,h,17); ctx.lineWidth = 1.5; ctx.strokeStyle = hot?C.pink:'#4b4470'; ctx.stroke(); }
    text(ctx,label,x+w/2,y+h/2+1,{font:'800 13px Manrope',color:on?C.dark:(hot?C.pink:C.ink),align:'center',ls:'.5px'});
    p.region(id,x,y,w,h,()=>{ state[id] = !(state[id]!==false); applyDeskToggles(); p.dirty = true; });
  });
  // grid height: lower / raise in 5 cm steps (kept with Save)
  circleButton(ctx,p,'gridDown',272,26,34,'caret-down',()=>liftGrid(-GRID_STEP));
  circleButton(ctx,p,'gridUp',320,26,34,'caret-up',()=>liftGrid(GRID_STEP));
  // link the table grid to the window: linked, they move together; apart, each moves on its own
  circleButton(ctx,p,'gridLink',368,26,34,state.gridLinked?'link-simple':'link-simple-break',()=>setGridLinked(!state.gridLinked),
    {iconColor:state.gridLinked?C.pink:C.ink});
}});
const GRID_STEP = .05, GRID_LIFT = [-.6,.3];   // metres: step, lowest / highest offset from the table or default height
function liftGrid(d){
  const v = Math.min(GRID_LIFT[1],Math.max(GRID_LIFT[0],Math.round(((state.gridLift||0)+d)*100)/100));
  deskGrid.position.y += v-(state.gridLift||0); state.gridLift = v; relinkGrid();
  toast(v===0?'Grid at table height':`Grid ${v>0?'+':'−'}${Math.round(Math.abs(v)*100)} cm`);
}
deskCtlP.mesh.position.set(-DESK_W/2+.21,.02,DESK_D/2+.05); deskCtlP.mesh.rotation.x = -1.05;
function applyDeskToggles(){ deskLines.visible = state.grid!==false; roomGroup.visible = state.room!==false; }

// room scan: Quest's scene mesh (mesh-detection) or, without it, detected plane outlines — thin light edges
const roomGroup = new THREE.Group(); roomGroup.name = 'room wireframe'; scene.add(roomGroup);
const roomMat = new THREE.LineBasicMaterial({color:'#8f9fe0',transparent:true,opacity:.22,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false});
const roomItems = new Map();
function roomLines(key,changed,build){
  let it = roomItems.get(key);
  if (!it || it.changed!==changed) {
    if (it) { roomGroup.remove(it.lines); it.lines.geometry.dispose(); }
    const lines = new THREE.LineSegments(build(),roomMat); lines.matrixAutoUpdate = false; lines.frustumCulled = false;
    roomGroup.add(lines); it = {lines,changed}; roomItems.set(key,it);
  }
  it.seen = true; return it.lines;
}
let tablePlane = null;
function updateRoom(frame){
  const ref = renderer.xr.getReferenceSpace(); if (!frame || !ref) return;
  for (const it of roomItems.values()) it.seen = false;
  const meshes = frame.detectedMeshes;
  if (meshes && meshes.size) for (const m of meshes) {
    const lines = roomLines(m,m.lastChangedTime,()=>{ const g = new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(m.vertices),3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(m.indices),1));
      const e = new THREE.EdgesGeometry(g,28); g.dispose(); return e; });
    const pose = frame.getPose(m.meshSpace,ref); if (pose) lines.matrix.fromArray(pose.transform.matrix);
  }
  tablePlane = null; let best = 1e9;
  const head = renderer.xr.getCamera().getWorldPosition(new THREE.Vector3());
  if (frame.detectedPlanes) for (const pl of frame.detectedPlanes) {
    const pose = frame.getPose(pl.planeSpace,ref); if (!pose) continue;
    if (!(meshes && meshes.size)) {
      const lines = roomLines(pl,pl.lastChangedTime,()=>{ const pts = [];
        pl.polygon.forEach((p,i,arr)=>{ const q = arr[(i+1)%arr.length]; pts.push(p.x,p.y,p.z,q.x,q.y,q.z); });
        return new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(pts,3)); });
      lines.matrix.fromArray(pose.transform.matrix);
    }
    const p = pose.transform.position, label = pl.semanticLabel;
    const tableLike = label==='table' || (pl.orientation==='horizontal' && p.y>.45 && p.y<1.15 && label!=='floor' && label!=='ceiling');
    if (!tableLike) continue;
    const d = Math.hypot(p.x-head.x,p.z-head.z) - (label==='table'?.5:0);   // prefer labelled tables
    if (d<best && d<2.5) { best = d; tablePlane = {pl,pose}; }
  }
  for (const [k,it] of roomItems) if (!it.seen) { roomGroup.remove(it.lines); it.lines.geometry.dispose(); roomItems.delete(k); }
}
// put the grid on the detected table, or at table height in front of the user
let gridOnTable = false, gridPlacedAt = 0;
function placeGrid(){
  if (gridHeld) return;
  const xrCam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  const head = xrCam.getWorldPosition(new THREE.Vector3());
  const dir = new THREE.Vector3(0,0,-1).applyQuaternion(xrCam.getWorldQuaternion(new THREE.Quaternion())); dir.y = 0;
  if (dir.lengthSq()<1e-4) dir.set(0,0,-1); dir.normalize();
  if (tablePlane) {
    const m = new THREE.Matrix4().fromArray(tablePlane.pose.transform.matrix), c = new THREE.Vector3();
    for (const p of tablePlane.pl.polygon) c.x += p.x/tablePlane.pl.polygon.length, c.z += p.z/tablePlane.pl.polygon.length;
    c.applyMatrix4(m); deskGrid.position.set(c.x,c.y+.002,c.z);
    const toUser = new THREE.Vector3(head.x-c.x,0,head.z-c.z); deskGrid.rotation.set(0,Math.atan2(toUser.x,toUser.z),0);
    gridOnTable = true;
  } else if (renderer.xr.isPresenting) {
    deskGrid.position.copy(head).addScaledVector(dir,DESK.ahead); deskGrid.position.y = DESK.tableH;
    deskGrid.rotation.set(0,Math.atan2(-dir.x,-dir.z),0); gridOnTable = false;
  } else { deskGrid.position.set(0,1.0,.62); deskGrid.rotation.set(0,0,0); gridOnTable = false; }   // desktop preview
  deskGrid.position.y += state.gridLift||0;
  gridPlacedAt = performance.now(); relinkGrid();
}
// ---- window ↔ table link. Linked: the grid keeps its offset (position + turn) to the window and follows it.
let gridHeld = false;                                                   // the grid itself is in a hand
const linkRel = {pos:new THREE.Vector3(), yaw:0};
const lV = new THREE.Vector3(), lQ = new THREE.Quaternion(), lE = new THREE.Euler();
function boardYaw(){ boardRoot.getWorldQuaternion(lQ); return lE.setFromQuaternion(lQ,'YXZ').y; }
function relinkGrid(){
  if (!state.gridLinked) return;
  boardRoot.updateMatrixWorld(); boardRoot.getWorldPosition(lV); const y = boardYaw();
  linkRel.pos.copy(deskGrid.position).sub(lV).applyAxisAngle(Y_AXIS,-y); linkRel.yaw = deskGrid.rotation.y-y;
}
function followBoard(){
  if (!state.gridLinked || gridHeld) return;
  boardRoot.updateMatrixWorld(); boardRoot.getWorldPosition(lV); const y = boardYaw();
  deskGrid.position.copy(linkRel.pos).applyAxisAngle(Y_AXIS,y).add(lV); deskGrid.rotation.set(0,y+linkRel.yaw,0);
}
function setGridLinked(on){ state.gridLinked = on; relinkGrid(); deskCtlP.dirty = true;
  toast(on?'Table linked to the window · they move together':'Table apart · pinch the grid edge to move it'); }
const Y_AXIS = new THREE.Vector3(0,1,0);
// grid edge: an invisible frame around the grid to pinch and carry the table on its own
const gridFrame = [];
{ const F = .08, mat = new THREE.MeshBasicMaterial({visible:false});
  [[DESK_W+2*F,F,0,-(DESK_D+F)/2],[DESK_W+2*F,F,0,(DESK_D+F)/2],[F,DESK_D,-(DESK_W+F)/2,0],[F,DESK_D,(DESK_W+F)/2,0]].forEach(([w,d,x,z])=>{
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w,d),mat); m.rotation.x = -Math.PI/2; m.position.set(x,.004,z);
    m.userData.kind = 'gridMove'; deskGrid.add(m); gridFrame.push(m); }); }
placeGrid();

// carrying: ray → grid plane → cells
const invGrid = new THREE.Matrix4(), rO = new THREE.Vector3(), rD = new THREE.Vector3();
function rayOnGrid(o,d){
  deskGrid.updateMatrixWorld(); invGrid.copy(deskGrid.matrixWorld).invert();
  rO.copy(o).applyMatrix4(invGrid); rD.copy(d).transformDirection(invGrid);
  if (Math.abs(rD.y)<1e-4) return null; const t = -rO.y/rD.y; if (t<0) return null;
  return rO.clone().addScaledVector(rD,t);
}
const clampI = (v,n,max) => Math.max(0,Math.min(max-n,v));
function dragUpdate(s,o,d){
  const p = rayOnGrid(o,d); if (!p) return;
  const dr = s.drag;
  if (dr.kind==='dioRotate') { const da = wrapA(ringAngle(p)-dr.a0);
    if (dr.q0) state.dioQ = new THREE.Quaternion().setFromAxisAngle(Y_AXIS,da).multiply(dr.q0).toArray(); else state.dioYaw = dr.yaw0+da; return; }
  if (dr.kind==='dioMove') {
    const n = state.dioN;
    dr.i = clampI(Math.round((p.x+DESK_W/2)/DESK.cell-n/2),n,DESK.cols); dr.j = clampI(Math.round((p.z+DESK_D/2)/DESK.cell-n/2),n,DESK.rows); dr.n = n;
    deskItem.userData.target.set(p.x,0,p.z);                                  // follows the hand, snaps on release
  } else {
    // scale from a corner node, the opposite corner stays put
    const ax = dr.anchor[0], az = dr.anchor[1];
    const n = Math.max(1,Math.min(DESK.maxN,DESK.rows,Math.round(Math.max(Math.abs(p.x-ax),Math.abs(p.z-az))/DESK.cell)));
    const x0 = dr.sx>0 ? ax : ax-n*DESK.cell, z0 = dr.sz>0 ? az : az-n*DESK.cell;
    dr.n = n; dr.i = clampI(Math.round((x0+DESK_W/2)/DESK.cell),n,DESK.cols); dr.j = clampI(Math.round((z0+DESK_D/2)/DESK.cell),n,DESK.rows);
    if (n!==state.dioN) { state.dioN = n; layoutDeskItem(dr.i,dr.j,n,false); }
  }
  showDrop(dr);
}
function showDrop(dr){
  const w = dr.n*DESK.cell; dropFill.visible = dropEdge.visible = true;
  dropFill.scale.set(w,w,1); dropEdge.scale.set(w,w,1);
  dropFill.position.x = dropEdge.position.x = cellCentre(dr.i,dr.n)-DESK_W/2; dropFill.position.z = dropEdge.position.z = cellCentre(dr.j,dr.n)-DESK_D/2;
}
const ringAngle = p => Math.atan2(p.x-deskItem.position.x,p.z-deskItem.position.z);
const wrapA = a => Math.atan2(Math.sin(a),Math.cos(a));
// direct hand grab: pinch inside the diorama's volume, move it over the grid, turn the hand to turn it
const gp = new THREE.Vector3(), jA = new THREE.Vector3(), jB = new THREE.Vector3();
function pinchPoint(s,out){ const j = s.hand.joints; j['index-finger-tip'].getWorldPosition(jA); j['thumb-tip'].getWorldPosition(jB);
  return out.copy(jA).add(jB).multiplyScalar(.5).applyMatrix4(invGrid); }
function handYaw(s){ const j = s.hand.joints; if (!j['wrist']?.visible || !j['middle-finger-metacarpal']?.visible) return 0;
  j['wrist'].getWorldPosition(jA).applyMatrix4(invGrid); j['middle-finger-metacarpal'].getWorldPosition(jB).applyMatrix4(invGrid);
  return Math.atan2(jB.x-jA.x,jB.z-jA.z); }
const qH = new THREE.Quaternion(), qGi = new THREE.Quaternion();
function handQ(s,out){ s.hand.joints['wrist'].getWorldQuaternion(out); deskGrid.getWorldQuaternion(qGi); return out.premultiply(qGi.invert()); }   // wrist turn in grid space
const FREE_LIFT = .25;                                                   // lift after a free turn (dio units): clears the table in any pose
function freeLift(){ dio.userData.lift = (state.dioQ ? FREE_LIFT : tableView().lift)*dio.scale.x; }
function handGrabStart(s){
  const j = s.hand?.joints; if (!j?.['index-finger-tip']?.visible || !j['thumb-tip']?.visible) return false;
  deskGrid.updateMatrixWorld(); invGrid.copy(deskGrid.matrixWorld).invert(); pinchPoint(s,gp);
  const w = state.dioN*DESK.cell, c = deskItem.position;
  if (Math.abs(gp.x-c.x)>w/2+.04 || Math.abs(gp.z-c.z)>w/2+.04 || gp.y<-.03 || gp.y>w*1.2+.05) return false;
  const turn = !!j['wrist']?.visible;
  s.drag = {kind:'dioGrab',i:state.dioI,j:state.dioJ,n:state.dioN,off:[gp.x-c.x,gp.z-c.z],y0:gp.y,
    turn, q0i:turn?handQ(s,new THREE.Quaternion()).invert():null, dq0:dio.quaternion.clone()};
  if (turn) { state.dioQ = dio.quaternion.toArray(); freeLift(); tableViewP.dirty = true; }
  return true;
}
function grabUpdate(s){
  const j = s.hand.joints; if (!j['index-finger-tip']?.visible || !j['thumb-tip']?.visible) { dragEnd(s); return; }
  pinchPoint(s,gp); const dr = s.drag, n = state.dioN, x = gp.x-dr.off[0], z = gp.z-dr.off[1];
  dr.i = clampI(Math.round((x+DESK_W/2)/DESK.cell-n/2),n,DESK.cols); dr.j = clampI(Math.round((z+DESK_D/2)/DESK.cell-n/2),n,DESK.rows); dr.n = n;
  deskItem.userData.target.set(x,Math.max(0,Math.min(.2,gp.y-dr.y0))+.015,z);          // lifts a little in the hand
  if (dr.turn && j['wrist']?.visible) {                                  // the diorama turns exactly as the hand turns, in every direction
    const q = handQ(s,qH).multiply(dr.q0i).multiply(dr.dq0); state.dioQ = q.toArray(); dio.quaternion.copy(q); }
  showDrop(dr);
}
// two-hand scale: while one hand holds the diorama, pinch with the other and open / close the hands (1x steps of a cell)
const gp2 = new THREE.Vector3();
function pinchScaleStart(s){
  const other = sources.find(o=>o!==s && o.drag?.kind==='dioGrab'); if (!other) return false;
  const j = s.hand?.joints; if (!j?.['index-finger-tip']?.visible || !j['thumb-tip']?.visible) return false;
  deskGrid.updateMatrixWorld(); invGrid.copy(deskGrid.matrixWorld).invert();
  const d0 = pinchPoint(s,gp2).distanceTo(pinchPoint(other,gp)); if (d0<.02) return false;
  s.drag = {kind:'dioPinchScale',other,d0,n0:state.dioN}; return true;
}
function pinchScaleUpdate(s){
  const dr = s.drag, o = dr.other, j = s.hand.joints;
  if (o.drag?.kind!=='dioGrab' || !j['index-finger-tip']?.visible || !j['thumb-tip']?.visible) { s.drag = null; return; }
  const d = pinchPoint(s,gp2).distanceTo(pinchPoint(o,gp));
  const n = Math.max(1,Math.min(DESK.maxN,DESK.rows,Math.round(dr.n0*d/dr.d0)));
  if (n!==state.dioN) { state.dioN = n; const g = o.drag; g.n = n; layoutDeskItem(g.i,g.j,n,false); freeLift(); toast(`${n}× · ${n*25} cm`,1200); }
}
function dragStart(s,hit){
  if (hit.kind==='gridMove') { gridGrabStart(s); return; }
  if (hit.kind==='dioRotate') { const p = hit.point.clone().applyMatrix4(invGrid.copy(deskGrid.matrixWorld).invert());
    s.drag = {kind:'dioRotate',a0:ringAngle(p),yaw0:state.dioYaw||0,q0:state.dioQ?new THREE.Quaternion().fromArray(state.dioQ):null}; return; }
  if (hit.kind==='dioMove') s.drag = {kind:'dioMove',i:state.dioI,j:state.dioJ,n:state.dioN};
  else { const [sx,sz] = hit.object.userData.corner, w = state.dioN*DESK.cell;
    const cx = cellCentre(state.dioI,state.dioN)-DESK_W/2, cz = cellCentre(state.dioJ,state.dioN)-DESK_D/2;
    s.drag = {kind:'dioScale',sx,sz,anchor:[cx-sx*w/2,cz-sz*w/2],i:state.dioI,j:state.dioJ,n:state.dioN}; }
}
// carry the grid on its own (apart), or the window with the grid (linked)
function gridGrabStart(s){
  if (!s.controller) return;                                             // desktop mouse: no carrying
  if (state.gridLinked) { s.controller.attach(boardRoot); s.grab = true; return; }
  s.controller.attach(deskGrid); gridHeld = true; s.drag = {kind:'gridMove'};
}
function gridGrabEnd(s){
  scene.attach(deskGrid); const e = new THREE.Euler().setFromQuaternion(deskGrid.quaternion,'YXZ');
  deskGrid.rotation.set(0,e.y,0); gridHeld = false; gridPlacedAt = 0; tablePlaneLock = true;   // stays where the user put it
}
let tablePlaneLock = false;
function dragEnd(s){
  const dr = s.drag; s.drag = null; dropFill.visible = dropEdge.visible = false;
  if (dr.kind==='dioRotate' || dr.kind==='dioPinchScale') return;
  if (dr.kind==='gridMove') { gridGrabEnd(s,dr); return; }
  state.dioI = dr.i; state.dioJ = dr.j; state.dioN = dr.n; layoutDeskItem(dr.i,dr.j,dr.n,false);
}
const handLocal = new THREE.Vector3();
function updateDesk(t,frame){
  gridUniforms.uTime.value = t;
  if (renderer.xr.isPresenting) {
    updateRoom(frame);
    if (tablePlane && !gridOnTable && !tablePlaneLock && performance.now()-gridPlacedAt<15000) placeGrid();   // a table showed up after entry
  }
  // hand / pointer glow, in grid space
  deskGrid.updateMatrixWorld(); invGrid.copy(deskGrid.matrixWorld).invert();
  const hs = [gridUniforms.uHand0.value,gridUniforms.uHand1.value]; hs.forEach(h=>h.set(0,99,0));
  let k = 0;
  for (const s of sources) {
    if (k>1) break;
    if (s.hand) { const j = s.hand.joints?.['index-finger-tip']; if (j && j.visible) { j.getWorldPosition(handLocal).applyMatrix4(invGrid); hs[k++].copy(handLocal); continue; } }
    if (s.controller?.visible) { handLocal.setFromMatrixPosition(s.controller.matrixWorld).applyMatrix4(invGrid); if (handLocal.y<.3) hs[k++].copy(handLocal); }
    else if (!s.controller && s.ray) { const p = rayOnGrid(s.ray.o,s.ray.d); if (p) hs[k++].copy(p); }
  }
  // drags
  for (const s of sources) if (s.drag) {
    if (s.drag.kind==='dioGrab') { grabUpdate(s); continue; }
    if (s.drag.kind==='dioPinchScale') { pinchScaleUpdate(s); continue; }
    if (s.drag.kind==='gridMove') { if (!s.controller?.visible) dragEnd(s); continue; }
    if (s.controller) { if (!s.controller.visible) { dragEnd(s); continue; }
      rO.setFromMatrixPosition(s.controller.matrixWorld); rD.set(0,0,-1).transformDirection(s.controller.matrixWorld); dragUpdate(s,rO.clone(),rD.clone()); }
    else if (s.ray) dragUpdate(s,s.ray.o,s.ray.d);
  }
  if (deskItem.visible && deskItem.userData.target) deskItem.position.lerp(deskItem.userData.target,.25);
  if (state.dioOnTable && dio.parent===holder3D) {                       // ease toward the tilt preset, turn and lift
    const held = sources.some(o=>o.drag?.kind==='dioGrab');
    if (!held) dio.quaternion.slerp(state.dioQ ? qH.fromArray(state.dioQ) : tableTargetQ(),.18);
    dio.position.y += ((dio.userData.lift ?? 0)-dio.position.y)*.18; }
  followBoard();
  const yaw = state.dioYaw||0; knob.position.set(Math.sin(yaw)*RING.r,0,Math.cos(yaw)*RING.r);
  for (const c of corners) c.glow.material.opacity = .55+.35*Math.sin(t*3+c.sx+c.sz*2);
}
applyDeskToggles(); if (state.dioOnTable) dioToTable();

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
  if (state.dioOnTable && dio.visible) { list.push(itemPad,rotRing.userData.hit); for (const c of corners) list.push(c.hit); }
  if (deskGrid.visible) list.push(...gridFrame);
  if (dio.visible && (board.visible || state.dioOnTable)) for (const m of marbles) list.push(m.hit); return list; }
function pick(origin,dir){
  raycaster.set(origin,dir); raycaster.far = 6;
  for (const h of raycaster.intersectObjects(targets(),false)) {
    if (h.object.userData.currency) return {currency:h.object.userData.currency,point:h.point,distance:h.distance};
    if (h.object.userData.kind) return {kind:h.object.userData.kind,object:h.object,point:h.point,distance:h.distance};
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
  if (source.hand && state.dioOnTable && !state.hidden && pinchScaleStart(source)) return;    // second hand while the first holds
  if ((hit?.kind==='dioScale' || hit?.kind==='dioRotate' || hit?.kind==='gridMove') && hit.distance<.15) { dragStart(source,hit); return; }   // a handle right at the fingers wins over the body grab
  if (source.hand && state.dioOnTable && !state.hidden && handGrabStart(source)) return;
  if (!hit) return;
  if (hit.currency) { setCurrency(hit.currency); return; }
  if (hit.kind) { dragStart(source,hit); return; }
  if (hit.region) { source.pressed = {panel:hit.panel,id:hit.region.id}; hit.panel.press = hit.region.id; hit.panel.dirty = true; return; }
  if (hit.panel?.mesh.parent===deskGrid) { dragStart(source,{kind:'gridMove'}); return; }        // empty part of the grid strip = grid handle
  if (source.controller) { source.controller.attach(boardRoot); source.grab = true; }   // grab the landing by any empty surface
}
function release(source,hit){
  if (source.drag) { dragEnd(source); return; }
  if (source.grab) { scene.attach(boardRoot); const e = new THREE.Euler().setFromQuaternion(boardRoot.quaternion,'YXZ'); boardRoot.rotation.set(e.x,e.y,0,'YXZ'); source.grab = false; }
  const pr = source.pressed; source.pressed = null;
  if (!pr) return;
  pr.panel.press = null; pr.panel.dirty = true;
  if (hit?.panel===pr.panel && hit.region?.id===pr.id) hit.region.onTap();
}
const sources = [];
// visible hands in the headset: Meta-style hand mesh (WebXR generic-hand), translucent in the palette ink with a soft pink rim
const HAND = {color:C.ink, opacity:.32, rim:C.pink, rimA:.9};
const handFactory = new XRHandModelFactory(); handFactory.setPath('assets/hands/');
const handMat = new THREE.MeshStandardMaterial({color:HAND.color, transparent:true, opacity:HAND.opacity, roughness:.6, metalness:0, depthWrite:false});
handMat.onBeforeCompile = sh=>{ sh.uniforms.uRim = {value:new THREE.Color(HAND.rim)}; sh.uniforms.uRimA = {value:HAND.rimA};
  sh.fragmentShader = 'uniform vec3 uRim; uniform float uRimA;\n' + sh.fragmentShader.replace('#include <dithering_fragment>',
    '#include <dithering_fragment>\n  float fr = pow(1.0-abs(dot(normalize(normal),normalize(vViewPosition))),2.0);\n  gl_FragColor.rgb += uRim*fr*uRimA; gl_FragColor.a = max(gl_FragColor.a, fr*uRimA*.8);'); };
const rayMat = new THREE.LineBasicMaterial({color:C.pink,transparent:true,opacity:.55});
const dotGeo = new THREE.SphereGeometry(.004,12,8), dotMat = new THREE.MeshBasicMaterial({color:'#fff3ff'});
for (let i=0;i<2;i++){
  const controller = renderer.xr.getController(i); scene.add(controller);
  const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,0,-1)]),rayMat);
  controller.add(ray);
  const cursor = new THREE.Mesh(dotGeo,dotMat); scene.add(cursor);
  const hand = renderer.xr.getHand(i); scene.add(hand);
  hand.add(handFactory.createHandModel(hand,'mesh',obj=>{ obj.traverse(o=>{ if (o.isMesh) { o.material = handMat; o.renderOrder = 10; } }); }));
  const tip = new THREE.Mesh(dotGeo,new THREE.MeshBasicMaterial({color:C.pink})); scene.add(tip);
  const s = {controller,ray,cursor,hand,tip,hover:null,pressed:null,grab:false,hit:null,poke:{latched:false}};
  controller.addEventListener('selectstart',()=>press(s,s.hit));
  controller.addEventListener('selectend',()=>release(s,s.hit));
  sources.push(s);
}
const mouse = {hover:null,pressed:null,hit:null,controller:null}; sources.push(mouse);
const ndc = new THREE.Vector2();
function mousePick(e){ ndc.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1); raycaster.setFromCamera(ndc,camera);
  mouse.ray = {o:raycaster.ray.origin.clone(),d:raycaster.ray.direction.clone()};
  return pick(raycaster.ray.origin.clone(),raycaster.ray.direction.clone()); }
renderer.domElement.addEventListener('pointermove',e=>{ mouse.hit = mousePick(e); setHover(mouse,mouse.hit);
  renderer.domElement.style.cursor = mouse.drag ? 'grabbing' : mouse.hit?.kind ? 'grab' : mouse.hit?.region||mouse.hit?.currency ? 'pointer' : ''; });
renderer.domElement.addEventListener('pointerdown',e=>{ mouse.hit = mousePick(e); if (mouse.hit?.region||mouse.hit?.currency||mouse.hit?.kind) { orbit.enabled = false; press(mouse,mouse.hit); } });
addEventListener('pointerup',e=>{ mouse.hit = mousePick(e); release(mouse,mouse.hit); orbit.enabled = true; });

const tipPos = new THREE.Vector3(), local = new THREE.Vector3(), orig = new THREE.Vector3(), dirV = new THREE.Vector3();
function updateXRInput(){
  for (const s of sources) {
    if (!s.controller) continue;
    const c = s.controller, active = c.visible;
    // pinch-ray
    if (active) {
      orig.setFromMatrixPosition(c.matrixWorld); dirV.set(0,0,-1).transformDirection(c.matrixWorld);
      s.hit = s.grab||s.drag ? null : pick(orig,dirV);
      const len = s.hit ? s.hit.distance : .6;
      s.ray.scale.z = len; s.cursor.visible = !!s.hit; if (s.hit) s.cursor.position.copy(s.hit.point);
    } else { s.hit = null; s.cursor.visible = false; }
    // index-finger poke
    const j = s.hand.joints?.['index-finger-tip'];
    if (!j || !j.visible) { s.tip.visible = false; setHover(s,active ? s.hit : null); continue; }
    j.getWorldPosition(tipPos); s.tip.position.copy(tipPos);
    let best = null;
    for (const m of marbles) if ((board.visible||state.dioOnTable) && dio.visible && m.hit.getWorldPosition(local).distanceTo(tipPos)<.022) best = {currency:m.cur,touch:true};
    if (!best) for (const p of panels) {
      if (!p.mesh.visible || !p.mesh.parent.visible || !p.regions.length || p.name==='toast') continue;
      p.mesh.worldToLocal(local.copy(tipPos));
      const d = local.z*(p.mesh.parent===board||p.mesh.parent===fixed ? boardRoot.scale.x : 1), lx = local.x/S+p.w/2, ly = p.h/2-(local.y/S);
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
renderer.xr.addEventListener('sessionstart',()=>{ scene.background = null; renderer.setClearAlpha(0); needsPlace = 12;
  FPS.target = renderer.xr.getSession()?.frameRate || 72; });
renderer.xr.addEventListener('sessionend',()=>{ scene.background = desktopBg; FPS.target = 60; boardRoot.position.set(0,1.4,0); boardRoot.rotation.set(0,0,0);
  for (const it of roomItems.values()) { roomGroup.remove(it.lines); it.lines.geometry.dispose(); } roomItems.clear(); tablePlane = null; placeGrid(); });
if (navigator.xr && await navigator.xr.isSessionSupported('immersive-ar').catch(()=>false)) {
  enterBtn.disabled = false; enterBtn.textContent = 'Enter MR';
  enterBtn.onclick = async () => {
    try { const session = await navigator.xr.requestSession('immersive-ar',{requiredFeatures:['local-floor'],optionalFeatures:['hand-tracking','plane-detection','mesh-detection']});
      await renderer.xr.setSession(session); }
    catch (e) { statusEl.textContent = 'MR could not start: '+e.message; }
  };
} else enterBtn.textContent = 'MR not available — desktop preview';

const counts = HORIZONS.map(h=>`${h.id.toUpperCase()} ${data[h.id]?obsOf(h.id).length+' obs':'—'}`).join(' · ');
statusEl.textContent = `build ${BUILD} · ` + (dataMode==='HELD'
  ? `Barış's held observations · ${counts}${takenAt?' · snapshot '+utcLabel(takenAt):''} · freshness unverified`
  : `No snapshot yet — showing the repo's old held sample (21 Aug 2026) · ${counts}`);

addEventListener('resize',()=>{ camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth,innerHeight); });
boardRoot.scale.setScalar(state.scale);

// ---------------------------------------------------------------- frame loop
renderer.setAnimationLoop((now,frame)=>{
  const t = now/1000;
  fpsTick(now);
  if (needsPlace && renderer.xr.isPresenting && --needsPlace===0) { place(); placeGrid(); }
  updateXRInput();
  updateDiorama(t);
  updateDesk(t,frame);
  // diorama in the window only while the board hides its box; on the table it is always there and the window shows the 2D view
  const seen = state.dioOnTable || windowSeen();
  winBox.visible = !state.dioOnTable && seen; viewPlane.visible = state.dioOnTable;
  dio.visible = !state.hidden && seen; deskItem.visible = state.dioOnTable && !state.hidden;
  const minute = new Date().getMinutes()+':'+new Date().getDate();
  if (minute!==lastMinute) { lastMinute = minute; clocksP.dirty = dateP.dirty = newsP.dirty = true; }
  if (toastMsg && now>toastUntil) { toastMsg = ''; toastP.mesh.visible = false; }
  for (const p of panels) {
    if (!p.mesh.visible) continue;
    if (p.dirty || (p.fps && now-p.last>1000/p.fps)) p.redraw(now);
  }
  renderView(now);
  if (!renderer.xr.isPresenting) orbit.update();
  renderer.render(scene,camera);
});
