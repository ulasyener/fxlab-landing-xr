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

const BUILD = '40';               // shown in the status line, so a cached old version is easy to spot
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
  stick: false, boardOff: [0,0,0],                // joystick shown · landing moved by the joystick from its default spot: [right, up, forward] m
  winView: 'diorama', maniYaw: 0, maniTilt: null, maniZoom: 1, maniOnTable: false, maniI: null, maniJ: null, maniRoom: false,   // diorama window: which visualisation · manifold hologram turn, tilt, zoom
  stickTurn: false, boardRot: [0,0],              // joystick in angle mode · landing turned / tilted by the joystick: [turn, tilt] rad
  gridCols: 8, gridRows: 4, gridOff: false, gridFloor: false, gridTableY: null, gridBlocks: {},   // … · grid lowered to the floor (and its table height to go back to) · raised cells {'i,j': height m}     // table grid size in 25 cm cells (pulled from its edges / corners) · whole table grid switched off
  roomOn: false, roomPaused: false, roomCoins: null, roomMin: false,   // roomMin: main screen folded into the small widget   // room orbit: coins circle the user · orbits stopped · per coin [orbit radius m, angle rad, height from the head m]
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
  const dioView = state.winView!=='manifold';                             // the window shows the diorama, or another visualisation from the tabs
  text(ctx,dioView?'DIORAMA':'MANIFOLD',25,32,{font:'800 14px Manrope',color:C.muted,ls:'.4px'});
  text(ctx,state.dioOnTable&&dioView?'2D':'3D',614,32,{font:'600 14px "Kode Mono"',color:C.muted,align:'right'});
  // while the diorama is on the table the window shows it flat: top ↔ front
  if (state.dioOnTable && dioView) { const x = 118, y = 14, w = 152, h = 34;
    rr(ctx,x,y,w,h,17); ctx.fillStyle = C.card; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#4b4470'; ctx.stroke();
    [['top','TOP'],['front','FRONT']].forEach(([id,label],k)=>{ const sx = x+3+k*73, on = state.view2D===id, hot = p.hover==='v2'+id;
      if (on) { ctx.save(); ctx.shadowColor = C.pink; ctx.shadowBlur = 12; rr(ctx,sx,y+3,73,h-6,14); ctx.fillStyle = C.pink; ctx.fill(); ctx.restore(); }
      text(ctx,label,sx+36.5,y+h/2+1,{font:'800 12px Manrope',color:on?C.dark:(hot?C.pink:C.ink),align:'center',ls:'.4px'});
      p.region('v2'+id,sx,y-8,73,h+16,()=>{ state.view2D = id; p.dirty = true; viewDirty = true; }); }); }
  // links toggle: selected coin only ↔ all pairs (neural view)
  if (dioView) { const x = 452, y = 14, w = 128, h = 34, on = state.allLinks, hot = p.hover==='links';
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
  // manifold: step inside it ↔ step out
  if (!dioView && MANI_DATA) { const x = 452, y = 14, w = 128, h = 34, on = state.maniRoom, hot = p.hover==='inside';
    ctx.save(); if (on||hot) { ctx.shadowColor = C.pink; ctx.shadowBlur = on?16:10; }
    rr(ctx,x,y,w,h,17); ctx.fillStyle = on ? C.pink : C.card; ctx.fill(); ctx.restore();
    if (!on) { rr(ctx,x,y,w,h,17); ctx.lineWidth = 1.5; ctx.strokeStyle = hot?C.pink:'#4b4470'; ctx.stroke(); }
    const ink = on ? C.dark : (hot ? C.pink : C.ink);
    drawIcon(ctx,on?'sign-out':'person-simple-walk',ink,x+22,y+h/2,18);
    text(ctx,on?'STEP OUT':'STEP INSIDE',x+38,y+h/2+1,{font:'800 12px Manrope',color:ink,ls:'.4px'});
    p.region('inside',x-6,y-8,w+12,h+16,()=>{ state.maniRoom ? maniFromRoom() : maniToRoom(); p.dirty = true; }); }
  // bring the diorama into the room: onto the table grid, and back into the window
  { const x = 290, y = 14, w = 150, h = 34, on = dioView ? state.dioOnTable : state.maniOnTable, hot = p.hover==='table';
    ctx.save(); if (hot) { ctx.shadowColor = C.pink; ctx.shadowBlur = 12; }
    rr(ctx,x,y,w,h,17); ctx.fillStyle = C.card; ctx.fill(); ctx.restore();
    rr(ctx,x,y,w,h,17); ctx.lineWidth = 1.5; ctx.strokeStyle = hot?C.pink:'#4b4470'; ctx.stroke();
    const ink = hot ? C.pink : C.ink;
    drawIcon(ctx,'desk',ink,x+22,y+h/2,18);
    text(ctx,on?'BACK TO WINDOW':'PLACE ON TABLE',x+38,y+h/2+1,{font:'800 12px Manrope',color:ink,ls:'.4px'});
    p.region('table',x-4,y-8,w+8,h+16,()=>{
      if (!dioView) { if (!MANI_DATA) return; if (state.maniRoom) { state.maniRoom = false; maniInfo(null); }
        state.maniOnTable ? maniToWindow() : maniToTable();
        toast(state.maniOnTable?'Manifold on the table · drag it to turn and tilt, two hands to zoom, pinch its frame to move':'Manifold back in its window'); return; }
      state.dioOnTable ? dioToWindow() : dioToTable(); toast(state.dioOnTable?'Diorama on the table · pinch it to move, pull a corner to scale':'Diorama back in its window'); }); }
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
  ['house','house','Default layout',()=>{ state.scale = 1; state.desk = false; state.boardOff = [0,0,0]; state.boardRot = [0,0]; state.maniYaw = 0; state.maniTilt = null; state.maniZoom = 1; applyManiPose(); place(); placeGrid(); state.roomPaused = false; pauseP.dirty = true; roomDefaults(); toast('Back to the default layout'); }],
  ['save','bookmark-simple','Save',()=>{ try{ localStorage.setItem('fxlab-landing',JSON.stringify({horizon:state.horizon,currency:state.currency,scale:state.scale,desk:state.desk,allLinks:state.allLinks,dioOnTable:state.dioOnTable,dioI:state.dioI,dioJ:state.dioJ,dioN:state.dioN,grid:state.grid,room:state.room,gridLift:state.gridLift,gridLinked:state.gridLinked,dioQ:state.dioQ,dioView:state.dioView,dioYaw:state.dioYaw,view2D:state.view2D,boardOff:state.boardOff,boardRot:state.boardRot,stickTurn:state.stickTurn,winView:state.winView,maniYaw:state.maniYaw,maniTilt:state.maniTilt,maniZoom:state.maniZoom,maniOnTable:state.maniOnTable,maniI:state.maniI,maniJ:state.maniJ,roomOn:state.roomOn,roomPaused:state.roomPaused,roomCoins:state.roomCoins,roomMin:state.roomMin,gridCols:state.gridCols,gridRows:state.gridRows,gridOff:state.gridOff,gridFloor:state.gridFloor,gridTableY:state.gridTableY,gridBlocks:state.gridBlocks})); toast('Layout saved on this headset'); }catch{ toast('Saving is not available in this browser'); } }],
  ['info','info','Info',()=>toast(`${dataMode==='HELD'?'HELD OBSERVATIONS':'FIXTURE (old held sample)'} · UPSTREAM FRESHNESS UNVERIFIED${takenAt?' · snapshot '+utcLabel(takenAt):''}`,6000)],
  ['settings','gear-six','Settings',()=>{ const s = [.8,.9,1,1.1]; state.scale = s[(s.indexOf(state.scale)+1)%s.length]||1; boardRoot.scale.setScalar(state.scale); toast(`Size ${Math.round(state.scale*100)} %`); }],
  ['desk','desk','Table / in the air',()=>{ state.desk = !state.desk; place(); toast(state.desk?'Lying on the table':'Standing in the air'); }],
  ['grid','grid-nine','Table grid on / off',()=>setGridOff(!state.gridOff)],
  ['room','planet','Coins around you',()=>setRoom(!state.roomOn)],
  ['stick','joystick','Move the landing',()=>{ state.stick = !state.stick; stickP.mesh.visible = turnP.mesh.visible = state.stick; toast(state.stick?(state.stickTurn?STICK_TIP.turn:STICK_TIP.move):'Joystick hidden'); }],
  ['exit','x-circle','Exit MR',()=>{ const s = renderer.xr.getSession(); s ? s.end() : toast('Not in MR'); }],
];
const barP = panel({name:'bottom bar',x:410,y:860,w:700,h:104.6,margin:20,parent:fixed,z:.006,draw(ctx,p){
  ctx.save(); ctx.shadowColor = '#0b0a18'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 5;
  rr(ctx,0,0,700,104.6,52.3); ctx.fillStyle = '#262346'; ctx.fill(); ctx.restore();
  rr(ctx,0,0,700,104.6,52.3); ctx.lineWidth = 1.5; ctx.strokeStyle = '#3d3762'; ctx.stroke();
  const step = (700-2*23.85-68.47)/(BAR.length-1);                     // equal spacing (A), whatever the number of buttons
  BAR.forEach(([id,ic,,fn],i)=>{ const on = (id==='stick'&&state.stick) || (id==='room'&&state.roomOn) || (id==='grid'&&!state.gridOff);
    circleButton(ctx,p,id,23.85+34.24+i*step,18.08+34.24,68.47,on?ic+'-fill':ic,fn,{iconSize:28.8,iconColor:on?C.pink:C.ink}); });
}});
// room orbit pause / play: one small button right above the room button, only while the coins are in the room
const ROOM_BTN = (() => { const i = BAR.findIndex(b=>b[0]==='room'), step = (700-2*23.85-68.47)/(BAR.length-1); return 410+23.85+34.24+i*step; })();
const pauseP = panel({name:'room pause',x:ROOM_BTN-66,y:793,w:132,h:64,margin:12,parent:fixed,z:.006,draw(ctx,p){
  circleButton(ctx,p,'pause',32,32,56,state.roomPaused?'play':'pause',roomTogglePause,{iconSize:24,iconColor:state.roomPaused?C.pink:C.ink});
  circleButton(ctx,p,'fold',100,32,56,'arrows-in-simple',()=>setRoomMin(true),{iconSize:24});
}});
pauseP.mesh.visible = false;
function roomTogglePause(){ state.roomPaused = !state.roomPaused; pauseP.dirty = widgetP.dirty = true;
  toast(state.roomPaused?'Orbits stopped · arrange the coins, then play':'Orbits running'); }
// main screen folded: a small widget where the bottom bar was — pause / play and open the screen again
const widgetGroup = new THREE.Group(); widgetGroup.name = 'room widget'; widgetGroup.visible = false; boardRoot.add(widgetGroup);
const WG = 364;                                                          // widget width: fxlab + z, then grid · pause · open
const widgetP = panel({name:'room widget',x:BW/2-WG/2,y:870,w:WG,h:84,margin:20,parent:widgetGroup,z:.006,draw(ctx,p){
  ctx.save(); ctx.shadowColor = '#0b0a18'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 5;
  rr(ctx,0,0,WG,84,42); ctx.fillStyle = '#262346'; ctx.fill(); ctx.restore();
  rr(ctx,0,0,WG,84,42); ctx.lineWidth = 1.5; ctx.strokeStyle = '#3d3762'; ctx.stroke();
  text(ctx,'fxlab',30,38,{font:'800 22px Manrope',color:C.pink});
  const rc = roomCoins.find(c=>c.cur===state.currency), z = rc ? rc.z : 0;
  text(ctx,`${state.currency} ${z>=0?'+':'−'}${Math.abs(z).toFixed(2)} z`,30,60,{font:'400 13px "Kode Mono"',color:C.muted});
  circleButton(ctx,p,'grid',WG-42-128,42,56,state.gridOff?'grid-nine':'grid-nine-fill',()=>setGridOff(!state.gridOff),{iconSize:24,iconColor:state.gridOff?C.ink:C.pink});
  circleButton(ctx,p,'pause',WG-42-64,42,56,state.roomPaused?'play':'pause',roomTogglePause,{iconSize:24,iconColor:state.roomPaused?C.pink:C.ink});
  circleButton(ctx,p,'open',WG-42,42,56,'arrows-out-simple',()=>setRoomMin(false),{iconSize:24});
}});
function setRoomMin(on){ state.roomMin = on; widgetP.dirty = pauseP.dirty = true; }
// ---- joystick: move the landing like a mobile FPS thumbstick (right of the bottom bar, shown with the joystick button)
// pad: up = away from you, down = toward you, sideways = left / right · slider: up / down · speed grows with the push, springs back on release
// angle mode (button right of the joystick): sideways = turn left / right, up / down = tilt the top away / toward you · slider still lifts
const STICK = {speed:.35, lift:.25, turn:.8, tilt:.6, tiltMax:Math.PI/2, dead:.12, curve:1.6, pad:{cx:68,cy:62.5,r:46,knob:17}, rail:{x:176,y0:20,y1:105,knob:13}};
const STICK_TIP = {move:'Joystick · push to move forward / back / sideways, slide to lift', turn:'Joystick · angles: sideways to turn, up / down to tilt, slide to lift'};
const stickP = panel({name:'joystick',x:1130,y:850,w:222,h:125,margin:20,parent:fixed,z:.006,draw(ctx,p){
  ctx.save(); ctx.shadowColor = '#0b0a18'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 5;
  rr(ctx,0,0,222,125,44); ctx.fillStyle = '#262346'; ctx.fill(); ctx.restore();
  rr(ctx,0,0,222,125,44); ctx.lineWidth = 1.5; ctx.strokeStyle = '#3d3762'; ctx.stroke();
  const dr = sources.find(s=>s.drag?.kind==='stick')?.drag, v = dr?.v || [0,0,0];
  // pad: light ring, dashed inner orbit, four chevrons, glowing knob
  const {cx,cy,r,knob} = STICK.pad, padOn = dr?.part==='pad', padHot = p.hover==='pad';
  ctx.save(); if (padOn||padHot) { ctx.shadowColor = C.pink; ctx.shadowBlur = padOn?18:10; }
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fillStyle = C.card; ctx.fill();
  ctx.lineWidth = padOn||padHot ? 2 : 1.5; ctx.strokeStyle = padOn||padHot ? C.pink : '#4a4470'; ctx.stroke(); ctx.restore();
  ctx.setLineDash([1.4,4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(167,162,201,.45)';
  ctx.beginPath(); ctx.arc(cx,cy,r*.62,0,Math.PI*2); ctx.stroke(); ctx.setLineDash([]);
  const turn = state.stickTurn;
  if (turn) drawIcon(ctx,'arrows-clockwise',padOn?C.pink:'rgba(167,162,201,.35)',cx,cy,22);   // angle mode mark under the knob
  [['caret-up',0,-1],['caret-down',0,1],['caret-left',-1,0],['caret-right',1,0]].forEach(([ic,dx,dy])=>{
    const lit = padOn && (dx ? Math.sign(v[0])===dx && Math.abs(v[0])>STICK.dead : Math.sign(-v[1])===dy && Math.abs(v[1])>STICK.dead);
    drawIcon(ctx,ic,lit?C.pink:C.dim,cx+dx*r*.8,cy+dy*r*.8,13); });
  const kx = cx+v[0]*r*.62, ky = cy-v[1]*r*.62;
  if (padOn) { ctx.strokeStyle = 'rgba(226,168,238,.55)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(cx,cy); ctx.lineTo(kx,ky); ctx.stroke(); }
  glowDot(ctx,kx,ky,padOn?knob*.62:knob*.5,padOn?'#fff3ff':'#d9d3f2',padOn?'rgba(231,168,240,.85)':'rgba(231,168,240,.35)');
  p.region('pad',cx-r,cy-r,2*r,2*r,()=>{});
  // lift rail
  const {x,y0,y1} = STICK.rail, mid = (y0+y1)/2, railOn = dr?.part==='lift', railHot = p.hover==='lift';
  ctx.save(); if (railOn||railHot) { ctx.shadowColor = C.pink; ctx.shadowBlur = railOn?16:9; }
  rr(ctx,x-13,y0-8,26,y1-y0+16,13); ctx.fillStyle = C.card; ctx.fill();
  ctx.lineWidth = railOn||railHot ? 2 : 1.5; ctx.strokeStyle = railOn||railHot ? C.pink : '#4a4470'; ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#4a4470'; ctx.fillRect(x-.5,y0+14,1,y1-y0-28);
  drawIcon(ctx,'caret-up',railOn&&v[2]>STICK.dead?C.pink:C.dim,x,y0+5,12); drawIcon(ctx,'caret-down',railOn&&v[2]<-STICK.dead?C.pink:C.dim,x,y1-5,12);
  const ly = mid-v[2]*(y1-y0)/2*.62;
  glowDot(ctx,x,ly,railOn?8:6.5,railOn?'#fff3ff':'#d9d3f2',railOn?'rgba(231,168,240,.85)':'rgba(231,168,240,.35)');
  p.region('lift',x-24,y0-10,48,y1-y0+20,()=>{});
}});
// angle button: right of the joystick, switches the pad between moving and turning / tilting the landing
const turnP = panel({name:'joystick angles',x:1372,y:860,w:104.6,h:104.6,margin:20,parent:fixed,z:.006,draw(ctx,p){
  ctx.save(); ctx.shadowColor = '#0b0a18'; ctx.shadowBlur = 20; ctx.shadowOffsetY = 5;
  rr(ctx,0,0,104.6,104.6,52.3); ctx.fillStyle = '#262346'; ctx.fill(); ctx.restore();
  rr(ctx,0,0,104.6,104.6,52.3); ctx.lineWidth = 1.5; ctx.strokeStyle = '#3d3762'; ctx.stroke();
  circleButton(ctx,p,'turn',52.3,52.3,68.47,state.stickTurn?'arrows-clockwise-fill':'arrows-clockwise',
    ()=>{ state.stickTurn = !state.stickTurn; stickP.dirty = true; toast(state.stickTurn?STICK_TIP.turn:STICK_TIP.move); },
    {iconSize:28.8,iconColor:state.stickTurn?C.pink:C.ink});
}});
stickP.mesh.visible = turnP.mesh.visible = state.stick;
const stickPlane = new THREE.Plane(), stickHit = new THREE.Vector3(), stickN = new THREE.Vector3();
function stickStart(s,part){
  stickP.mesh.updateMatrixWorld();                                       // freeze the pad where it is: the landing moves away under the hand
  stickN.set(0,0,1).transformDirection(stickP.mesh.matrixWorld);
  stickPlane.setFromNormalAndCoplanarPoint(stickN,stickHit.setFromMatrixPosition(stickP.mesh.matrixWorld));
  s.drag = {kind:'stick',part,plane:stickPlane.clone(),inv:stickP.mesh.matrixWorld.clone().invert(),v:[0,0,0]};
  stickP.dirty = true;
}
function stickUpdate(s,o,d){
  const dr = s.drag; raycaster.set(o,d); if (!raycaster.ray.intersectPlane(dr.plane,stickHit)) return;
  stickFromLocal(dr,stickHit.applyMatrix4(dr.inv));
}
function stickFromLocal(dr,pt){                                          // panel-local metres → panel px → stick values
  const px = pt.x/S+stickP.w/2, py = stickP.h/2-pt.y/S;
  if (dr.part==='pad') { const {cx,cy,r} = STICK.pad; let x = (px-cx)/(r*.62), y = -(py-cy)/(r*.62); const l = Math.hypot(x,y); if (l>1) { x /= l; y /= l; } dr.v[0] = x; dr.v[1] = y; }
  else { const {y0,y1} = STICK.rail; dr.v[2] = Math.max(-1,Math.min(1,-(py-(y0+y1)/2)/((y1-y0)/2*.62))); }
  stickP.dirty = true;
}
const stickF = new THREE.Vector3(), stickR = new THREE.Vector3(), stickUp = new THREE.Vector3(0,1,0), stickE = new THREE.Euler();
const stickCurve = a => { const m = Math.abs(a); return m<STICK.dead ? 0 : Math.sign(a)*Math.pow((m-STICK.dead)/(1-STICK.dead),STICK.curve); };
function updateStick(dt){
  const dr = sources.find(s=>s.drag?.kind==='stick')?.drag; if (!dr || !dt) return;
  const turn = state.stickTurn && dr.part==='pad';
  const r = turn ? 0 : stickCurve(dr.v[0])*STICK.speed*dt, f = turn ? 0 : stickCurve(dr.v[1])*STICK.speed*dt, u = stickCurve(dr.v[2])*STICK.lift*dt;
  const rot = state.boardRot || (state.boardRot = [0,0]);
  if (turn) {
    const a = -stickCurve(dr.v[0])*STICK.turn*dt;                         // push right = turn right
    const t0 = rot[1], t1 = Math.max(-STICK.tiltMax,Math.min(STICK.tiltMax,t0-stickCurve(dr.v[1])*STICK.tilt*dt));   // push up = top away from you
    if (a) { boardRoot.rotateOnWorldAxis(stickUp,a); rot[0] += a; }
    if (t1!==t0) { boardRoot.rotateX(t1-t0); rot[1] = t1; }
  }
  if (!r && !f && !u) return;
  stickE.setFromQuaternion(boardRoot.quaternion,'YXZ');                   // the landing's heading, whatever its tilt
  stickF.set(-Math.sin(stickE.y),0,-Math.cos(stickE.y)); stickR.set(-stickF.z,0,stickF.x);   // away from you / to the right, level
  boardRoot.position.addScaledVector(stickR,r).addScaledVector(stickF,f); boardRoot.position.y += u;
  const b = stickE.y-rot[0], bx = Math.cos(b), bz = -Math.sin(b);         // offsets are kept in the default spot's frame (place() applies them there)
  const dx = stickR.x*r+stickF.x*f, dz = stickR.z*r+stickF.z*f;
  const o = state.boardOff || (state.boardOff = [0,0,0]); o[0] += dx*bx+dz*bz; o[1] += u; o[2] += dx*-Math.sin(b)+dz*-Math.cos(b);
}

// FPS: bottom-left corner of the landing, aligned with the TIME column
const FPS = {hist:new Array(120).fill(null), acc:0, n:0, t0:0, last:0, now:0, ms:0, target:60};   // 120 samples × 0.25 s = last 30 s
function fpsTick(now){
  if (FPS.last) { const dt = now-FPS.last; if (dt>0 && dt<1000) { FPS.acc += dt; FPS.n++; } }
  FPS.last = now;
  if (now-FPS.t0>=250 && FPS.n) { FPS.ms = FPS.acc/FPS.n; FPS.now = 1000/FPS.ms; FPS.hist.push(FPS.now); FPS.hist.shift(); FPS.acc = FPS.n = 0; FPS.t0 = now; fpsP.dirty = true; }
}
const fpsP = panel({name:'fps',x:73.5,y:860,w:273,h:104.6,margin:12,z:.006,draw(ctx){
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
toastP.mesh.visible = false; boardRoot.add(toastP.mesh);   // stays visible when the screen is folded into the widget
function toast(msg,ms=3200){ toastMsg = msg; toastUntil = performance.now()+ms; toastP.mesh.visible = true; toastP.dirty = true; }

// ---------------------------------------------------------------- 3D diorama (Barış's data)
const DIO = {R:.17, U:.05, clamp:2.2};   // U: height of one strength unit (dio units) — ±clamp stays inside the half-full tank
const dio = new THREE.Group(); dio.name = 'diorama';
dio.position.set((WIN.x+WIN.w/2-BW/2)*S,(BH/2-(WIN.y+WIN.h/2))*S,-WIN.depth/2); dio.scale.setScalar(WIN.fill); board.add(dio);   // inside the window box, level: the box is the aquarium, the water surface is zero
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

// ---- water tank: the pool is a box half full of water; the surface is zero (above = stronger, below = weaker)
// light for MR: one wavy surface (vertex waves, caustic shimmer, fresnel sheen, glowing meniscus), a depth-tinted body, a few rising bubbles
// window: the tank IS the window box (level aquarium) · table: a glass cube on the diorama's footprint, always level — only the contents turn
const WATER = {amp:.0022, speed:1, alpha:.24, deepAlpha:.5, caustic:.55, sheen:.9, edge:.9, bubbles:36, bubbleSize:.0032, bubbleRise:.025,
               shallow:'#4d66d6', deep:'#100f33', glow:'#9cbcff', sheenCol:'#d9b8ff', glass:'#c99be0'};
const waterUniforms = {uTime:{value:0}};
function makeTank({w,h,d,unit=1,glass=false,bubbles=WATER.bubbles}){
  // group origin = centre of the water surface; water fills -h/2…0, the glass box spans -h/2…+h/2
  const g = new THREE.Group(); g.name = 'water tank';
  const shared = {uTime:waterUniforms.uTime, uUnit:{value:unit}, uHalf:{value:new THREE.Vector2(w/2,d/2)}};
  const surf = new THREE.Mesh(new THREE.PlaneGeometry(w,d,64,48).rotateX(-Math.PI/2), new THREE.ShaderMaterial({
    uniforms:{...shared, uAmp:{value:WATER.amp/unit}, uAlpha:{value:WATER.alpha}, uCaustic:{value:WATER.caustic}, uSheen:{value:WATER.sheen},
      uEdge:{value:WATER.edge}, uCol:{value:new THREE.Color(WATER.shallow)}, uGlow:{value:new THREE.Color(WATER.glow)}, uSheenCol:{value:new THREE.Color(WATER.sheenCol)}},
    vertexShader:`uniform float uTime,uUnit,uAmp; varying vec3 vN,vW; varying vec2 vP,vL;
      float wave(vec2 p,float t){ return sin(p.x*21.+t*1.3)*.5+sin(p.y*17.-t*1.1)*.35+sin((p.x+p.y)*29.+t*.8)*.25+sin((p.x-p.y)*41.-t*1.7)*.12; }
      void main(){ vec2 p = position.xz*uUnit; float t = uTime, e = .004;
        float h = wave(p,t), hx = wave(p+vec2(e,0.),t), hz = wave(p+vec2(0.,e),t);
        vec3 pos = position; pos.y += h*uAmp;
        vN = normalize(mat3(modelMatrix)*normalize(vec3(-(hx-h)*uAmp*uUnit/e,1.,-(hz-h)*uAmp*uUnit/e)));
        vec4 wp = modelMatrix*vec4(pos,1.); vW = wp.xyz; vP = p; vL = position.xz;
        gl_Position = projectionMatrix*viewMatrix*wp; }`,
    fragmentShader:`uniform float uTime,uAlpha,uCaustic,uSheen,uEdge; uniform vec2 uHalf; uniform vec3 uCol,uGlow,uSheenCol; varying vec3 vN,vW; varying vec2 vP,vL;
      void main(){ float t = uTime;
        float c = sin(vP.x*38.+sin(vP.y*27.+t*.9)*1.7+t*.5)*sin(vP.y*33.+sin(vP.x*23.-t*.7)*1.7-t*.4);
        float caustic = smoothstep(.72,1.,abs(c));
        vec3 v = normalize(cameraPosition-vW); vec3 n = normalize(vN); if (!gl_FrontFacing) n = -n;
        float fres = pow(1.-abs(dot(n,v)),3.);
        vec2 q = uHalf-abs(vL); float edge = exp(-min(q.x,q.y)/(.012*max(uHalf.x,uHalf.y)/.3));
        vec3 col = uCol*.55+uGlow*caustic*uCaustic+uSheenCol*fres*uSheen+uGlow*edge*uEdge;
        float a = uAlpha+caustic*uCaustic*.35+fres*.35+edge*.6;
        gl_FragColor = vec4(col,clamp(a,0.,.95)); }`,
    transparent:true, depthWrite:false, side:THREE.DoubleSide, toneMapped:false}));
  surf.renderOrder = -2; g.add(surf);
  // body: five faces of the water volume (no lid), tinted darker with depth, slow light shafts
  const bodyGeo = new THREE.BoxGeometry(w,h/2,d); bodyGeo.translate(0,-h/4,0);
  { const idx = bodyGeo.index.array, keep = []; for (let i=0;i<idx.length;i+=6) if (i!==12) keep.push(...idx.slice(i,i+6)); bodyGeo.setIndex(keep); }   // drop +y
  const body = new THREE.Mesh(bodyGeo, new THREE.ShaderMaterial({
    uniforms:{...shared, uH:{value:h/2}, uAlpha:{value:WATER.alpha*.55}, uDeepA:{value:WATER.deepAlpha}, uShallow:{value:new THREE.Color(WATER.shallow)}, uDeep:{value:new THREE.Color(WATER.deep)}, uGlow:{value:new THREE.Color(WATER.glow)}},
    vertexShader:`uniform float uUnit; varying vec3 vL; void main(){ vL = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`uniform float uTime,uH,uAlpha,uDeepA,uUnit; uniform vec3 uShallow,uDeep,uGlow; varying vec3 vL;
      void main(){ float k = clamp(-vL.y/uH,0.,1.);
        float shaft = pow(.5+.5*sin((vL.x+vL.z*.6)*uUnit*26.+sin(uTime*.35)*2.+vL.y*uUnit*6.),6.)*(1.-k);
        vec3 col = mix(uShallow*.7,uDeep,k)+uGlow*shaft*.18;
        gl_FragColor = vec4(col,mix(uAlpha,uDeepA,k)+shaft*.05); }`,
    transparent:true, depthWrite:false, side:THREE.DoubleSide, toneMapped:false}));
  body.renderOrder = -3; g.add(body);
  // bubbles: a few slow glowing beads rising to the surface
  const bub = additivePoints(WATER.bubbleSize*unit,bubbles); bub.geometry.setDrawRange(0,bubbles); bub.renderOrder = -2; g.add(bub);
  const seed = Float32Array.from({length:bubbles*4},()=>Math.random());
  const bc = bub.geometry.attributes.color; for (let i=0;i<bubbles;i++) bc.setXYZ(i,.55,.62,1); bc.needsUpdate = true;
  // glass (table only): faint walls and bright edges, as tall as it is wide
  if (glass) {
    const box = new THREE.BoxGeometry(w,h,d);
    const walls = new THREE.Mesh(box,new THREE.MeshBasicMaterial({color:WATER.glass,transparent:true,opacity:.045,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}));
    walls.renderOrder = -4; g.add(walls);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(box),new THREE.LineBasicMaterial({color:WATER.glass,transparent:true,opacity:.5,toneMapped:false}));
    g.add(edges);
  }
  g.userData.update = t => {
    const p = bub.geometry.attributes.position, rise = WATER.bubbleRise/unit;
    for (let i=0;i<bubbles;i++){
      const u = (seed[i*4+3]+t*rise*(.6+seed[i*4+2])/(h/2))%1, y = -h/2+u*h/2*.98;
      p.setXYZ(i,(seed[i*4]-.5)*w*.92+Math.sin(t*1.7+i)*.004/unit,y,(seed[i*4+1]-.5)*d*.92);
    }
    p.needsUpdate = true;
  };
  return g;
}
// window tank: exactly the window box, 1 mm inside its walls, water up to the middle
const winTank = makeTank({w:WIN.w*S-.002, h:WIN.h*S-.002, d:WIN.depth-.002});
winTank.position.set((WIN.x+WIN.w/2-BW/2)*S,(BH/2-(WIN.y+WIN.h/2))*S,-WIN.depth/2); winBox.add(winTank);

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
function makeHalo(cur,density=1){
  const cot = cotOf(cur), shells = [];
  let total = 0;
  COT_GROUPS.forEach((id,k)=>{
    const g = cot?.groups[k], share = g ? Math.min(1,Math.abs(g.pctOi)/50) : .15;
    const n = Math.round((HALO.min+(HALO.max-HALO.min)*share)*density);
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

const coinUpQ = new THREE.Quaternion();
function updateDiorama(t){
  updateWindowClip();
  waterUniforms.uTime.value = t*WATER.speed;
  if (state.dioOnTable) tableTank.userData.update(t); else winTank.userData.update(t);
  const n = loop.obs.length;
  if (n>1 && state.playing) { const L = loop.step*(n-1)+loop.hold, s = (t%L)/loop.step; loop.idx = Math.min(n-1,s); }
  else loop.idx = n-1;
  const i0 = Math.floor(loop.idx), i1 = Math.min(n-1,i0+1), f = loop.idx-i0;
  const gap = loop.obs[i1]?.continuity==='gap', k = gap ? (f<.5?0:1) : f*f*(3-2*f);
  const dt = Math.min(.1,Math.max(0,t-(updateDiorama.last ?? t))); updateDiorama.last = t;
  coinUpQ.copy(dio.quaternion).invert();                          // coins float upright in the level water, whatever way the contents are turned
  for (const m of marbles) {
    m.ball.quaternion.copy(coinUpQ);
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
  const gk = m.glowK ?? 1, rk = m.rimK ?? 1;                                   // room coins: quieter halo so the coin reads
  h.rim.material.uniforms.uStrength.value = HALO.rim*h.bright*sel*beat(m.phase)*rk;
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
      const a = (.3+.7*Math.sin(Math.PI*u))*br*HALO.glow*h.bright*sel*gk;   // fade in and out along the drift
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
  if (state.dioOnTable) return DIO_FOOT/2;                               // tank lid (the tank is as tall as it is wide)
  const a = dio.rotation.x; if (Math.abs(a)<1e-3) return WIN.h*S/2/dio.scale.y;   // level aquarium: under the box ceiling
  const f = dio.scale.y, half = WIN.h*S/2/f, front = -dio.position.z/f;
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

const COIN = {dia:.04, spin:.6, env:.55, envBlur:.04, rough:1, metal:1};   // diameter m, spin rad/s, reflection strength, studio-reflection softness, roughness ×, metalness × (the shared aged-bronze texture carries the matte look)
// One shared aged-bronze texture set (Substance: Bronz_Taban + Bronz_Kir + Bronz_Cila) for every coin; each coin keeps its own relief normal map.
// Every coin has the same metal and surface, only the tone differs: the tone multiplies the shared base colour. Tones assigned at random (Ulaş, session 21).
const coinHolders = {}; let maniCoinReady = null;                       // loaded coins, for the manifold's small coins (built later)
const COIN_ROLL = {CHF:Math.PI};                                         // CHF relief is upside down in its export
const COIN_TONE = {USD:'#DCC68E', EUR:'#D99A80', GBP:'#E6DFD3', JPY:'#A9BFA6', AUD:'#D6BC7E', NZD:'#D8A9A0', CAD:'#D9B48A', CHF:'#A88E72', BTC:'#9E9A94'};
// USD brass · EUR red copper · GBP white bronze · JPY green patina · AUD aged gold · NZD rose bronze · CAD classic bronze · CHF dark bronze · BTC gunmetal
// ---------------------------------------------------------------- room orbit: the coins circle the user like a solar system (no water in the room)
// centre = the user (head position, eased, so walking keeps you in the middle) · orbit distance = the user's interest:
// grab a coin (pinch near it, or pinch-ray and push / pull the hand) and let it go nearer or farther — it keeps orbiting there
// orbit speed ← strength (latest observation of the chosen horizon): stronger = faster, weaker = slower, all slow · pause stops every orbit
const ROOM = {coin:.08, r0:.7, lane:.12, rMin:.35, rMax:3.2, dy:-.15, dyMin:-1.2, dyMax:.8, w:.05, zSpan:2.2, ease:.6,
              bob:.008, follow:2.5, grabNear:.09, push:4, appear:.8,
              haloRim:.85, haloLight:.45,                                       // room halo = only the glowing glass-marble sphere (no particles) · brighter, and lifted toward white so it reads light, not dark
              coinEnv:COIN.env, coinMetal:1, coinTint:1,                        // room copies use the same aged-bronze look as the window's coins
              snap:12, throwMin:.55, throwGain:1.8, throwMax:4, drag:1.6, dragY:5, settle:.12, spinBoost:6};   // grab glides into the fingers · flick: release speed m/s → flight, slows down, takes the orbit where it stops   // coin Ø m · default lanes · speed: w rad/s at zero, ×2 per +zSpan, ÷2 per −zSpan
function crispTexture(){ const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');   // hard-edged dot, no glow falloff
  const gr = g.createRadialGradient(32,32,0,32,32,30); gr.addColorStop(0,'#fff'); gr.addColorStop(.8,'#fff'); gr.addColorStop(1,'rgba(255,255,255,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(32,32,30,0,Math.PI*2); g.fill(); return new THREE.CanvasTexture(c); }
const crispTex = crispTexture();
const orbitRoot = new THREE.Group(); orbitRoot.name = 'room orbit'; orbitRoot.visible = false; scene.add(orbitRoot);
const orbitCentre = new THREE.Vector3(); let orbitSnap = true;
const ROOM_K = ROOM.coin/COIN.dia;                                           // coin + halo scale against the diorama's
const roomCoins = CURRENCIES.map((cur,i)=>{
  const g = new THREE.Group(); g.scale.setScalar(0); orbitRoot.add(g);
  const fallback = new THREE.Mesh(new THREE.SphereGeometry(.02,32,16),new THREE.MeshStandardMaterial({color:'#eef3ff',emissive:'#5d86ff',emissiveIntensity:.6,roughness:.2,metalness:.1}));
  g.add(fallback);
  const spin = new THREE.Group(); g.add(spin);
  const halo = makeHalo(cur,.05);                                            // only its rim is used in the room: no particles around the coin
  halo.pts.geometry.dispose(); halo.pts.material.dispose(); halo.pts = null;
  g.add(halo.rim);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(.03,12,8),new THREE.MeshBasicMaterial({visible:false})); g.add(hit);
  const rc = {cur,i,g,fallback,spin,halo,hit,phase:i*.7,r:ROOM.r0+i*ROOM.lane,a:0,dy:ROOM.dy,w:ROOM.w,held:false,z:0,
              fly:null, spinA:0, spinV:COIN.spin};
  hit.userData.roomCoin = rc; return rc;
});
function roomAddCoin(cur,holder){                                            // a copy of the window's coin, with its own (unclipped) materials
  const rc = roomCoins.find(c=>c.cur===cur); if (!rc) return;
  const copy = holder.clone(true);
  copy.traverse(o=>{ if (o.isMesh) { const mt = o.material = o.material.clone(); mt.clippingPlanes = null;
    mt.envMapIntensity = ROOM.coinEnv; mt.metalness *= ROOM.coinMetal; mt.color.multiplyScalar(ROOM.coinTint); } });
  rc.spin.add(copy); rc.fallback.visible = false;
}
const roomHead = new THREE.Vector3(), roomFwd = new THREE.Vector3(), roomQ = new THREE.Quaternion();
function headPose(){
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(roomHead); roomFwd.set(0,0,-1).applyQuaternion(cam.getWorldQuaternion(roomQ)); roomFwd.y = 0;
  if (roomFwd.lengthSq()<1e-4) roomFwd.set(0,0,-1); roomFwd.normalize();
}
function roomDefaults(){                                                     // lanes in ring order, spread around, the first one straight ahead
  headPose(); const yaw = Math.atan2(roomFwd.x,-roomFwd.z);
  roomCoins.forEach((rc,i)=>{ rc.r = ROOM.r0+i*ROOM.lane; rc.a = yaw+i*Math.PI/4; rc.dy = ROOM.dy; });
  state.roomCoins = null; orbitSnap = true;
}
function roomRestore(){
  const saved = state.roomCoins; if (!saved) { roomDefaults(); return; }
  for (const rc of roomCoins) { const v = saved[rc.cur]; if (v) [rc.r,rc.a,rc.dy] = v; }
}
let roomFade = 0;                                                            // 0 hidden … 1 shown (grow-in / shrink-out)
function setRoom(on){
  state.roomOn = on;
  if (on) { roomRestore(); orbitSnap = true; toast('Coins around you · grab one to bring it closer or push it away'); }
  else { state.roomMin = false; toast('Coins back in the window'); }
  barP.dirty = pauseP.dirty = true; pauseP.mesh.visible = on;
}
function roomPos(rc,t,out){
  return out.set(orbitCentre.x+Math.sin(rc.a)*rc.r, orbitCentre.y+rc.dy+ROOM.bob*Math.sin(t*.7+rc.phase), orbitCentre.z-Math.cos(rc.a)*rc.r);
}
// faint orbit of the coin in the hand, so the user sees where it will circle
const heldRing = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length:128},(_,k)=>new THREE.Vector3(Math.sin(k/128*Math.PI*2),0,-Math.cos(k/128*Math.PI*2)))),
  new THREE.LineBasicMaterial({color:C.pink,transparent:true,opacity:.35,depthWrite:false,toneMapped:false}));
heldRing.visible = false; orbitRoot.add(heldRing);
const roomV = new THREE.Vector3(), roomO = new THREE.Vector3(), roomD = new THREE.Vector3();
function roomHandGrab(s){                                                    // pinch right at a coin: it follows the hand
  if (!state.roomOn || state.hidden || !s.hand) return false;
  const j = s.hand.joints; if (!j?.['index-finger-tip']?.visible || !j['thumb-tip']?.visible) return false;
  pinchW(s,roomV); let best = null, bd = ROOM.grabNear;
  for (const rc of roomCoins) { const d = rc.g.position.distanceTo(roomV); if (d<bd && !rc.held) { bd = d; best = rc; } }
  if (!best) return false;
  best.held = true; best.fly = null; s.drag = {kind:'roomCoin',rc:best,mode:'hand',off:best.g.position.clone().sub(roomV),hist:[],t0:performance.now(),from:roomV.clone()}; return true;
}
function rayHeadDist(s){ roomO.setFromMatrixPosition(s.controller.matrixWorld); return Math.hypot(roomO.x-roomHead.x,roomO.z-roomHead.z); }
function roomRayGrab(s,hit){                                                 // pinch-ray: push the hand away to send it farther, pull it in to bring it closer
  const rc = hit.roomCoin; if (rc.held) return;
  rc.held = true; rc.fly = null; headPose();
  s.drag = {kind:'roomCoin',rc,mode:'ray',dist:hit.distance,d0:s.controller ? rayHeadDist(s) : 0, dist0:hit.distance, hist:[],t0:performance.now(),from:hit.point.clone()};
}
function roomDragUpdate(s){
  const dr = s.drag, rc = dr.rc;
  if (dr.mode==='hand') {
    const j = s.hand.joints; if (!j['index-finger-tip']?.visible || !j['thumb-tip']?.visible) { dragEnd(s); return; }
    const now = performance.now()/1000, dt = Math.min(.1,now-(dr.last ?? now)); dr.last = now;
    dr.off.multiplyScalar(Math.exp(-ROOM.snap*dt));                       // the coin glides into the fingers
    rc.g.position.copy(pinchW(s,roomV)).add(dr.off);
  } else if (s.controller) {
    if (!s.controller.visible) { dragEnd(s); return; }
    headPose(); roomO.setFromMatrixPosition(s.controller.matrixWorld); roomD.set(0,0,-1).transformDirection(s.controller.matrixWorld);
    dr.dist = Math.max(.15,Math.min(ROOM.rMax+.5,dr.dist0+(rayHeadDist(s)-dr.d0)*ROOM.push));
    rc.g.position.copy(roomO).addScaledVector(roomD,dr.dist);
  } else if (s.ray) rc.g.position.copy(s.ray.o).addScaledVector(s.ray.d,dr.dist);   // desktop: drag, wheel = nearer / farther
  const tNow = performance.now()/1000; dr.hist.push([tNow,rc.g.position.x,rc.g.position.y,rc.g.position.z]);
  while (dr.hist.length>2 && tNow-dr.hist[0][0]>.1) dr.hist.shift();     // last 0.1 s → release velocity
  const x = rc.g.position.x-orbitCentre.x, z = rc.g.position.z-orbitCentre.z, r = Math.max(ROOM.rMin,Math.min(ROOM.rMax,Math.hypot(x,z)));
  heldRing.visible = true; heldRing.position.set(orbitCentre.x,rc.g.position.y,orbitCentre.z); heldRing.scale.setScalar(r);
}
function roomRelease(dr){                                                  // a flick sends the coin flying; a calm release just leaves it there
  const rc = dr.rc, h = dr.hist || [];
  const hand = dr.mode==='hand' && dr.src?.hand ? pinchW(dr.src,roomV) : rc.g.position;
  if (performance.now()-dr.t0<350 && hand.distanceTo(dr.from)<.025) {   // a quick pinch without moving = tap: select it, it stays on its orbit
    rc.held = false; heldRing.visible = roomCoins.some(c=>c.held||c.fly); setCurrency(rc.cur); return; }
  if (h.length>1) { const a = h[0], b = h[h.length-1], dt = b[0]-a[0];
    if (dt>.01) { const v = new THREE.Vector3(b[1]-a[1],b[2]-a[2],b[3]-a[3]).divideScalar(dt);
      if (v.length()>ROOM.throwMin) { v.multiplyScalar(ROOM.throwGain); if (v.length()>ROOM.throwMax) v.setLength(ROOM.throwMax);
        rc.fly = v; rc.held = false; rc.spinV = COIN.spin*ROOM.spinBoost; return; } } }
  roomDrop(rc);
}
function roomDrop(rc){
  const x = rc.g.position.x-orbitCentre.x, z = rc.g.position.z-orbitCentre.z;
  rc.r = Math.max(ROOM.rMin,Math.min(ROOM.rMax,Math.hypot(x,z))); rc.a = Math.atan2(x,-z);
  rc.dy = Math.max(ROOM.dyMin,Math.min(ROOM.dyMax,rc.g.position.y-orbitCentre.y));
  rc.held = false; rc.fly = null; heldRing.visible = roomCoins.some(c=>c.held||c.fly);
  toast(`${rc.cur} · ${Math.round(rc.r*100)} cm from you`,1600);
}
addEventListener('wheel',e=>{ if (mouse.drag?.kind==='roomCoin' && mouse.drag.mode==='ray') { mouse.drag.dist = Math.max(.15,Math.min(ROOM.rMax+.5,mouse.drag.dist-e.deltaY*.002)); e.preventDefault(); } },{passive:false});
// ---- room network (Ulaş, session 20 · ref. 4 "What it takes to go to space"): Sankey-style cubic Bezier bands between every pair
// each end has a tangent: horizontal (along the orbit, around the user) or vertical · the strands sit side by side at the coin
// (like a Sankey node bar) and fan out a little in the middle · always there but faint, the selected coin's bands bright ·
// strength ← z gap (chosen horizon, latest observation): more strands, wider fan, more and faster pulses · colour flows from
// one currency's own colour to the other's · pulses weak → strong · strands thin out with distance from the head
// mode (?links= in the URL to compare): 'h' leave + arrive horizontally · 'v' leave + arrive vertically · 'hv' leave horizontally, arrive vertically
const CUR_COL = {USD:'#8fb4ff', EUR:'#b39dff', GBP:'#e2a8ee', JPY:'#ff9fb3', AUD:'#ffbe85', NZD:'#efe08a', CAD:'#9be3ae', CHF:'#8adfe6'};   // Claude's placeholder palette — awaiting Ulaş
const curCol = Object.fromEntries(Object.entries(CUR_COL).map(([k,v])=>[k,new THREE.Color(v)]));
const RLINK = {mode:'h',
               hReach:.5, vReach:.3, vReachPer:.55,      // tangent length: horizontal ← share of the arc between the coins · vertical ← m + share of the distance (varied per pair)
               port:.7, fan:1.4, fanPer:1.6,             // strands stacked across this share of the glass sphere at each end · extra spread in the middle (× port), more for a wider gap
               strandsMax:9, strandsDim:3,               // strands per band: selected / others
               bead:.009, beadSize:.0034, beadsMax:260,  // hair: dense tiny dots
               glow:.5, faint:.12,                       // selected bands · all other bands
               pulseSize:.011, pulses:5, speed:.12, speedPer:.45, pulseGlow:1.1,
               fadeNear:1.2, fadeFar:4};
{ const m = new URLSearchParams(location.search).get('links'); if (['h','v','hv'].includes(m)) RLINK.mode = m; }
const roomPairs = []; for (let a=0;a<8;a++) for (let b=a+1;b<8;b++) roomPairs.push([a,b]);
const rBeads = additivePoints(RLINK.beadSize,roomPairs.length*RLINK.strandsMax*(RLINK.beadsMax+1));
const rFlow = additivePoints(RLINK.pulseSize,roomPairs.length*RLINK.strandsMax*RLINK.pulses);
rBeads.material.map = crispTex; orbitRoot.add(rBeads,rFlow);
const pairSeed = roomPairs.map((_,i)=>((i*7919)%29)/28);                         // fixed 0…1 per pair: varied heights, no shared top
const P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), P2 = new THREE.Vector3(), P3 = new THREE.Vector3(), rP = new THREE.Vector3();
const tA = new THREE.Vector3(), tB = new THREE.Vector3(), oA = new THREE.Vector3(), oB = new THREE.Vector3(), Y_UP = new THREE.Vector3(0,1,0);
const cub = (u,a,b,c,d,out) => { const k = 1-u, k3 = k*k*k, k2 = 3*k*k*u, u2 = 3*k*u*u, u3 = u*u*u;
  return out.set(k3*a.x+k2*b.x+u2*c.x+u3*d.x, k3*a.y+k2*b.y+u2*c.y+u3*d.y, k3*a.z+k2*b.z+u2*c.z+u3*d.z); };
const fadeAt = p => { const d = Math.hypot(p.x-roomHead.x,p.y-roomHead.y,p.z-roomHead.z);
  return 1-Math.max(0,Math.min(1,(d-RLINK.fadeNear)/(RLINK.fadeFar-RLINK.fadeNear)))*.85; };
const orbitTan = (rc,sgn,out) => {                                                 // direction along the orbit at the coin (around the user)
  const x = rc.g.position.x-orbitCentre.x, z = rc.g.position.z-orbitCentre.z, l = Math.hypot(x,z)||1; return out.set(-z/l*sgn,0,x/l*sgn); };
function updateRoomLinks(t){
  const bp = rBeads.geometry.attributes.position.array, bc = rBeads.geometry.attributes.color.array;
  const fp = rFlow.geometry.attributes.position.array, fc = rFlow.geometry.attributes.color.array;
  let nb = 0, nf = 0; const selIdx = CURRENCIES.indexOf(state.currency), mode = RLINK.mode;
  roomPairs.forEach(([ia,ib],pi)=>{
    const hot = ia===selIdx || ib===selIdx;
    const A = roomCoins[ia], B = roomCoins[ib], pa = A.g.position, pb = B.g.position;
    const aA = Math.atan2(pa.z-orbitCentre.z,pa.x-orbitCentre.x), aB = Math.atan2(pb.z-orbitCentre.z,pb.x-orbitCentre.x);
    let d = aB-aA; d = Math.atan2(Math.sin(d),Math.cos(d)); const sgn = d>=0 ? 1 : -1;   // the short way around
    const rAv = .5*(Math.hypot(pa.x-orbitCentre.x,pa.z-orbitCentre.z)+Math.hypot(pb.x-orbitCentre.x,pb.z-orbitCentre.z));
    const hLen = RLINK.hReach*Math.abs(d)*rAv+.05, vLen = (RLINK.vReach+RLINK.vReachPer*pa.distanceTo(pb))*(.55+.9*pairSeed[pi]);
    const RA = HALO.rimR*A.halo.size*A.g.scale.x, RB = HALO.rimR*B.halo.size*B.g.scale.x;
    // end tangents and the axis the strands are stacked along at each end (across the tangent)
    if (mode==='v') { tA.copy(Y_UP); tB.copy(Y_UP).negate(); }                          // up out of A … down into B
    else { orbitTan(A,sgn,tA); if (mode==='h') orbitTan(B,sgn,tB); else tB.copy(Y_UP).negate(); }
    if (tA.y) orbitTan(A,1,oA); else oA.copy(Y_UP);
    if (tB.y) orbitTan(B,1,oB); else oB.copy(Y_UP);
    const lA = tA.y ? vLen : hLen, lB = tB.y ? vLen : hLen;
    const gap = B.z-A.z, gapN = Math.min(1,Math.abs(gap)/2);                          // z gap → link strength
    const strands = hot ? 1+Math.round((RLINK.strandsMax-1)*gapN) : Math.max(1,Math.round(RLINK.strandsDim*gapN));
    const fan = RLINK.fan+RLINK.fanPer*gapN, base = (hot ? RLINK.glow : RLINK.faint)/Math.sqrt(strands);
    const cA = curCol[A.cur], cB = curCol[B.cur];
    const len = pa.distanceTo(pb)+.6*(lA+lB), n = Math.min(RLINK.beadsMax,Math.max(16,Math.floor(len/RLINK.bead)));
    const fwd = gap>=0, v = (RLINK.speed+RLINK.speedPer*gapN)/Math.max(len,.01);    // pulses: weaker → stronger
    const nP = hot ? 1+Math.round((RLINK.pulses-1)*gapN) : 0;
    for (let k=0;k<strands;k++){
      const o = strands>1 ? k/(strands-1)*2-1 : 0;                                   // −1 … 1 across the band
      const wob = .12*Math.sin(t*.5+k*1.3+pi);                                       // slow drift inside the band
      P0.copy(pa).addScaledVector(tA,RA*.8).addScaledVector(oA,o*RA*RLINK.port);
      P3.copy(pb).addScaledVector(tB,-RB*.8).addScaledVector(oB,o*RB*RLINK.port);
      P1.copy(P0).addScaledVector(tA,lA).addScaledVector(oA,(o+wob)*RA*RLINK.port*fan);
      P2.copy(P3).addScaledVector(tB,-lB).addScaledVector(oB,(o-wob)*RB*RLINK.port*fan);
      for (let j=0;j<=n;j++){ const s = j/n; cub(s,P0,P1,P2,P3,rP);
        bp[nb*3] = rP.x; bp[nb*3+1] = rP.y; bp[nb*3+2] = rP.z;
        const a = base*(.6+.4*Math.sin(Math.PI*s))*fadeAt(rP);
        bc[nb*3] = (cA.r+(cB.r-cA.r)*s)*a; bc[nb*3+1] = (cA.g+(cB.g-cA.g)*s)*a; bc[nb*3+2] = (cA.b+(cB.b-cA.b)*s)*a; nb++; }
      for (let j=0;j<nP;j++){ let u = (j/nP+k*.137+t*v)%1; if (!fwd) u = 1-u; cub(u,P0,P1,P2,P3,rP);
        fp[nf*3] = rP.x; fp[nf*3+1] = rP.y; fp[nf*3+2] = rP.z;
        const a = Math.sin(Math.PI*u)*RLINK.pulseGlow*fadeAt(rP)/Math.sqrt(strands);
        fc[nf*3] = Math.min(1,(cA.r+(cB.r-cA.r)*u)*a+.25*a); fc[nf*3+1] = Math.min(1,(cA.g+(cB.g-cA.g)*u)*a+.25*a); fc[nf*3+2] = Math.min(1,(cA.b+(cB.b-cA.b)*u)*a+.25*a); nf++; }
    }
  });
  rBeads.geometry.setDrawRange(0,nb); rFlow.geometry.setDrawRange(0,nf);
  for (const g of [rBeads.geometry,rFlow.geometry]) { g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; }
}
function updateRoomRim(rc,t){                                                     // glass-marble glow only (no particles) · selected one a little brighter
  const h = rc.halo, w = 2*Math.PI/HALO.period, beat = 1-HALO.breath+HALO.breath*(.5+.5*Math.sin(t*w+rc.phase));
  h.rim.material.uniforms.uColor.value.copy(rc.z>=0?UP:DOWN).lerp(PINK,.2).lerp(WHITE,ROOM.haloLight);
  h.rim.material.uniforms.uStrength.value = HALO.rim*h.bright*beat*ROOM.haloRim*(rc.cur===state.currency?1.35:1);
}
let roomLast = null;
function updateRoomOrbit(t){
  const dt = Math.min(.1,Math.max(0,t-(roomLast ?? t))); roomLast = t;
  const show = state.roomOn && !state.hidden;
  roomFade = Math.max(0,Math.min(1,roomFade+(show?1:-1)*dt/ROOM.appear));
  orbitRoot.visible = roomFade>0;
  if (!orbitRoot.visible) { orbitSnap = true; return; }
  headPose();
  if (orbitSnap) { orbitCentre.copy(roomHead); orbitSnap = false; }
  else orbitCentre.lerp(roomHead,1-Math.exp(-ROOM.follow*dt));
  const last = loop.obs[loop.obs.length-1], e = roomFade*roomFade*(3-2*roomFade), saved = state.roomCoins || (state.roomCoins = {});
  for (const rc of roomCoins) {
    rc.z = zAt(last,rc.cur);
    const target = ROOM.w*Math.pow(2,rc.z/ROOM.zSpan);                      // stronger → faster, weaker → slower
    rc.w += (target-rc.w)*Math.min(1,dt/ROOM.ease);
    if (rc.fly) {                                                          // thrown: glides, slows down, takes the orbit where it stops
      const v = rc.fly, p = rc.g.position; p.addScaledVector(v,dt);
      v.x *= Math.exp(-ROOM.drag*dt); v.z *= Math.exp(-ROOM.drag*dt); v.y *= Math.exp(-ROOM.dragY*dt);
      const x = p.x-orbitCentre.x, z = p.z-orbitCentre.z, r = Math.hypot(x,z);
      heldRing.visible = true; heldRing.position.set(orbitCentre.x,p.y,orbitCentre.z); heldRing.scale.setScalar(Math.max(ROOM.rMin,Math.min(ROOM.rMax,r)));
      if (v.length()<ROOM.settle || r>=ROOM.rMax || r<=ROOM.rMin) roomDrop(rc);
    } else if (!rc.held) { if (!state.roomPaused) rc.a += rc.w*dt; roomPos(rc,t,rc.g.position); }
    rc.spinV += (COIN.spin-rc.spinV)*Math.min(1,dt*1.2); rc.spinA += rc.spinV*dt;   // a flick spins it up, it calms back down
    rc.g.scale.setScalar(ROOM_K*e);
    rc.spin.rotation.y = rc.spinA+rc.phase;
    updateRoomRim(rc,t);
    const v = saved[rc.cur] || (saved[rc.cur] = [0,0,0]); v[0] = rc.r; v[1] = rc.a; v[2] = rc.dy;
  }
  updateRoomLinks(t);
  if (state.roomMin && Math.floor(t*2)!==updateRoomOrbit.tick) { updateRoomOrbit.tick = Math.floor(t*2); widgetP.dirty = true; }   // widget's z readout
}

// ---------------------------------------------------------------- 3D coins (assets/coins/<CODE>.glb, KTX2 + meshopt)
const coinEnv = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(),COIN.envBlur).texture;   // soft studio reflections
const texLoader = new THREE.TextureLoader();
function bronzeTex(file,srgb){ const t = texLoader.load(`assets/coins/${file}`); t.flipY = false; t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; }
const bronzeBase = bronzeTex('bronze_baseColor.webp',true), bronzeOrm = bronzeTex('bronze_orm.webp',false);   // ORM: R occlusion · G roughness · B metalness
const ktx2 = new KTX2Loader().setTranscoderPath('./vendor/addons/libs/basis/').detectSupport(renderer);
const gltfLoader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
for (const m of marbles) {
  gltfLoader.load(`assets/coins/${m.cur}.glb`, gltf => {
    const coin = gltf.scene;
    const box = new THREE.Box3().setFromObject(coin), size = box.getSize(new THREE.Vector3()), mid = box.getCenter(new THREE.Vector3());
    coin.position.sub(mid);                                   // centre the mesh (the export carries an offset from 3ds Max)
    const holder = new THREE.Group(), roll = new THREE.Group(); roll.add(coin); holder.add(roll);
    roll.rotation.y = COIN_ROLL[m.cur]||0;                    // per-coin turn in the face plane (file's up = face normal)
    holder.scale.setScalar(COIN.dia/Math.max(size.x,size.z));
    holder.rotation.x = Math.PI/2;                            // coin lies flat in the file; stand it upright
    coin.traverse(o => { if (o.isMesh) { const mt = o.material;
      for (const k of ['map','aoMap','roughnessMap','metalnessMap']) if (mt[k] && mt[k]!==bronzeBase && mt[k]!==bronzeOrm) mt[k].dispose();   // the GLB's own colour/ORM give way to the shared bronze
      mt.map = bronzeBase; mt.aoMap = bronzeOrm; mt.roughnessMap = bronzeOrm; mt.metalnessMap = bronzeOrm; mt.aoMapIntensity = 1;
      mt.envMap = coinEnv; mt.envMapIntensity = COIN.env;
      mt.roughness = COIN.rough; mt.metalness = COIN.metal; mt.color.set(COIN_TONE[m.cur]||'#ffffff'); mt.needsUpdate = true; } });
    roomAddCoin(m.cur,holder);                                // its copy for the room orbit, before the window clipping is set
    coinHolders[m.cur] = holder; maniCoinReady?.(m.cur);      // and one for the manifold terrain
    m.spin.add(holder); m.coin = holder; m.sphere.visible = false; clipToWindow(holder);
  }, undefined, err => console.warn('coin', m.cur, err));
}

// ---------------------------------------------------------------- 3D table workspace: wireframe grid, room scan, diorama on the table
// Grid: fixed 25 cm cells, 2 m × 1 m (8 × 4) by default; the user pulls its edges / corners to make it any size in whole cells.
// Origin at the grid centre on the table surface, x along the long side, +z toward the user, y up. Each visualisation
// arrives one cell in size (1x) and scales from its corner nodes in whole-cell steps.
const DESK = {cols:8, rows:4, cell:.25, maxN:4, lineA:.16, borderA:.42, crossA:.5, glowR:.2, tableH:.74, ahead:.72, belowBoard:.08,   // belowBoard: without a detected table the grid starts this far under the window's bottom edge
  minC:2, maxCols:16, maxRows:12};                                       // grid size limits in cells: 50 cm × 50 cm … 4 m × 3 m
DESK.cols = Math.min(DESK.maxCols,Math.max(DESK.minC,Math.round(state.gridCols)||8)); DESK.rows = Math.min(DESK.maxRows,Math.max(DESK.minC,Math.round(state.gridRows)||4));
let DESK_W = DESK.cols*DESK.cell, DESK_D = DESK.rows*DESK.cell;
const deskGrid = new THREE.Group(); deskGrid.name = 'table grid'; scene.add(deskGrid);
const deskLines = new THREE.Group(); deskGrid.add(deskLines);      // what the GRID toggle hides
const gridUniforms = {uHand0:{value:new THREE.Vector3(0,99,0)}, uHand1:{value:new THREE.Vector3(0,99,0)}, uTime:{value:0},
  uBase:{value:new THREE.Color('#8fb0ff')}, uHot:{value:new THREE.Color(C.pink)}, uHalf:{value:new THREE.Vector2(DESK_W/2,DESK_D/2)}};
function gridMaterial(){
  return new THREE.ShaderMaterial({
    uniforms:gridUniforms, transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, toneMapped:false,
    vertexShader:`attribute float aA; varying float vA; varying vec3 vP;
      void main(){ vA = aA; vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader:`uniform vec3 uHand0; uniform vec3 uHand1; uniform vec3 uBase; uniform vec3 uHot; uniform float uTime; uniform vec2 uHalf;
      varying float vA; varying vec3 vP;
      void main(){
        float d = min(distance(vP,uHand0),distance(vP,uHand1));
        float g = smoothstep(${DESK.glowR.toFixed(3)},0.,d);                // lines light up near the hand
        float edge = smoothstep(0.,.12,min(uHalf.x-abs(vP.x),uHalf.y-abs(vP.z))+.06);
        float a = vA*(.85+.15*sin(uTime*1.3+vP.x*3.1+vP.z*2.3))*edge + g*.55;
        gl_FragColor = vec4(mix(uBase,uHot,g)*a,1.);
      }`,
  });
}
const gridLines = new THREE.LineSegments(new THREE.BufferGeometry(),gridMaterial()); gridLines.position.y = .001; gridLines.frustumCulled = false; deskLines.add(gridLines);
function buildGridLines(){
  const pos = [], aA = [], seg = (x0,z0,x1,z1,a) => { pos.push(x0,0,z0,x1,0,z1); aA.push(a,a); };
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
  gridLines.geometry.dispose(); gridLines.geometry = g; gridUniforms.uHalf.value.set(hx,hz);
}
buildGridLines();
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
// table tank: a glass cube on the footprint (one cell, scaled by the cell count), half full; the diorama's zero sits on its surface
const tableTank = makeTank({w:DESK.cell, h:DESK.cell, d:DESK.cell, glass:true, bubbles:24}); deskItem.add(tableTank);
deskItem.visible = false;

const DIO_FOOT = .40;                                                    // diorama width incl. halos (dio units)
// tilt presets on the table; the turn (state.dioYaw) works in all of them. They turn only the contents: the tank and its water stay level
const TABLE_VIEWS = {top:{tilt:Math.PI/2, label:'TOP'}, front:{tilt:0, label:'FRONT'}, persp:{tilt:0, label:'PERSP'}};
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
  tableTank.scale.setScalar(n); tableTank.position.y = w/2;
  if (instant) { dio.position.set(0,dio.userData.lift,0); dio.quaternion.copy(state.dioQ ? qH.fromArray(state.dioQ) : tableTargetQ()); }
  rotRing.scale.setScalar(w); knob.scale.setScalar(1/w);
  tableViewP.mesh.position.set(0,.02,w/2+.07);
}
function tableTargetQ(){ dioEuler.set(tableView().tilt,state.dioYaw||0,0,'XYZ'); return dioTargetQ.setFromEuler(dioEuler); }   // turn about its own up axis, then tilt toward the user
function setDioClip(on){ dio.traverse(o=>{ if (o.material) for (const m of [o.material].flat()) { m.clippingPlanes = on ? winPlanes : null; m.needsUpdate = true; } }); }
function dioToTable(){
  state.dioOnTable = true; deskItem.visible = true; holder3D.add(dio);
  if (state.dioQ || state.dioView!=='persp') { state.dioQ = null; state.dioView = 'persp'; tableViewP.dirty = true; }   // always arrives level: coins' zero on the water surface
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
tableViewP.mesh.rotation.x = -1.05; tableViewP.mesh.visible = false;   // no TOP / FRONT / PERSP on the table: it stays level with the water, the user walks around it
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
const deskCtlP = panel({name:'grid controls',x:0,y:0,w:496,h:52,margin:8,parent:deskGrid,z:0,draw(ctx,p){
  rr(ctx,0,0,496,52,26); ctx.fillStyle = 'rgba(35,32,66,.92)'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#3d3762'; ctx.stroke();
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
  // down to the floor / back to the table · extrude mode (tap or brush cells, pull the handle up)
  circleButton(ctx,p,'gridFloor',416,26,34,'arrow-line-down',()=>setGridFloor(!state.gridFloor),{iconColor:state.gridFloor?C.pink:C.ink});
  circleButton(ctx,p,'gridEdit',464,26,34,state.gridEdit?'cube-fill':'cube',()=>setGridEdit(!state.gridEdit),{iconColor:state.gridEdit?C.pink:C.ink});
}});
const GRID_STEP = .05, GRID_LIFT = [-.6,.3];   // metres: step, lowest / highest offset from the table or default height
function liftGrid(d){
  const v = Math.min(GRID_LIFT[1],Math.max(GRID_LIFT[0],Math.round(((state.gridLift||0)+d)*100)/100));
  deskGrid.position.y += v-(state.gridLift||0); state.gridLift = v; relinkGrid();
  toast(v===0?'Grid at table height':`Grid ${v>0?'+':'−'}${Math.round(Math.abs(v)*100)} cm`);
}
deskCtlP.mesh.rotation.x = -1.05;
// GRID / ROOM on the strip hide the lines / the room scan; the grid button (bottom bar, room widget) switches the whole table grid
// off — lines, nodes, strip, edge handles. Visualisations standing on the table stay where they are.
function applyDeskToggles(){
  deskLines.visible = state.grid!==false && !state.gridOff; roomGroup.visible = state.room!==false;
  gridHandles.visible = deskCtlP.mesh.visible = !state.gridOff; blockGroup.visible = !state.gridOff;
}
function setGridOff(off){ state.gridOff = off; if (off) setGridEdit(false,true); applyDeskToggles(); barP.dirty = widgetP.dirty = true;
  toast(off?'Table grid off':'Table grid on'); }
// floor: one button lowers the whole grid (and what stands on it) to the floor; again, back to where it was
const floorY = () => .002;                                               // local-floor space: the floor is y = 0
function setGridFloor(on){
  if (on===!!state.gridFloor) return;
  if (on) { state.gridTableY = deskGrid.position.y; deskGrid.position.y = floorY(); }
  else deskGrid.position.y = state.gridTableY ?? DESK.tableH+(state.gridLift||0);
  state.gridFloor = on; tablePlaneLock = true; relinkGrid(); deskCtlP.dirty = true;
  toast(on?'Grid on the floor':'Grid back at table height');
}

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
  if (!gridOnTable) {                                                     // no real table: never above the window's bottom edge
    boardRoot.updateMatrixWorld(); const bottom = boardRoot.localToWorld(new THREE.Vector3(0,-BH/2*S,0)).y;
    deskGrid.position.y = Math.min(deskGrid.position.y,bottom-DESK.belowBoard); }
  deskGrid.position.y += state.gridLift||0;
  if (state.gridFloor) { state.gridTableY = deskGrid.position.y; deskGrid.position.y = floorY(); }
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
const gridFrame = [], GF = .08;
{ const mat = new THREE.MeshBasicMaterial({visible:false}), geo = new THREE.PlaneGeometry(1,1);
  for (let k=0;k<4;k++) { const m = new THREE.Mesh(geo,mat); m.rotation.x = -Math.PI/2; m.userData.kind = 'gridMove'; deskGrid.add(m); gridFrame.push(m); } }
// size handles: a node on each corner and on the middle of each edge — pinch and pull, the grid grows / shrinks
// in whole 25 cm cells while the opposite edge stays put
const gridHandles = new THREE.Group(); gridHandles.name = 'grid size handles'; deskGrid.add(gridHandles);
const sizeNodes = [[-1,-1],[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0]].map(([sx,sz])=>{
  const corner = sx && sz, r = corner ? .011 : .008;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(r,16,10),new THREE.MeshBasicMaterial({color:'#fff3ff',toneMapped:false}));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:C.pink,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  glow.scale.setScalar(corner?.06:.045); ball.add(glow);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(.035,10,8),new THREE.MeshBasicMaterial({visible:false}));
  hit.userData.kind = 'gridResize'; hit.userData.side = [sx,sz]; ball.add(hit);
  gridHandles.add(ball); return {ball,glow,hit,sx,sz};
});
function layoutGridChrome(){
  const hx = DESK_W/2, hz = DESK_D/2;
  [[DESK_W+2*GF,GF,0,-hz-GF/2],[DESK_W+2*GF,GF,0,hz+GF/2],[GF,DESK_D,-hx-GF/2,0],[GF,DESK_D,hx+GF/2,0]].forEach(([w,d,x,z],k)=>{
    const m = gridFrame[k]; m.scale.set(w,d,1); m.position.set(x,.004,z); });
  for (const n of sizeNodes) n.ball.position.set(n.sx*hx,.008,n.sz*hz);
  deskCtlP.mesh.position.set(-hx+.26,.02,hz+.10);                       // a little out from the near edge: clear of the size nodes
}
layoutGridChrome();

// ---- raised cells: in extrude mode the user taps / brushes cells to select them, then pulls the handle up — each selected
// cell becomes a wireframe box of that height (5 cm steps, up to 2 m), e.g. to box in a sofa, a coffee table, a desk.
// Height 0 lowers them again. Kept with Save; they live in the grid, so they follow it to the floor and when it moves.
const EXT = {step:.05, max:2, fillA:.05, handleUp:.08};
const blockGroup = new THREE.Group(); blockGroup.name = 'raised cells'; deskGrid.add(blockGroup);
const blockLines = new THREE.LineSegments(new THREE.BufferGeometry(),gridMaterial()); blockLines.frustumCulled = false; blockGroup.add(blockLines);
const blockFill = new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1).translate(0,.5,0),
  new THREE.MeshBasicMaterial({color:'#8fb0ff',transparent:true,opacity:EXT.fillA,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}),
  DESK.maxCols*DESK.maxRows); blockFill.count = 0; blockFill.frustumCulled = false; blockGroup.add(blockFill);
const selFill = new THREE.InstancedMesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),
  new THREE.MeshBasicMaterial({color:C.pink,transparent:true,opacity:.22,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}),
  DESK.maxCols*DESK.maxRows); selFill.count = 0; selFill.frustumCulled = false; gridHandles.add(selFill);
const cellPad = new THREE.Mesh(new THREE.PlaneGeometry(1,1).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({visible:false}));
cellPad.position.y = .0015; cellPad.userData.kind = 'gridCell'; gridHandles.add(cellPad);
const blockHits = [];                                                    // invisible boxes: a raised cell is picked by its volume
const extHandle = new THREE.Group(); gridHandles.add(extHandle); extHandle.visible = false;
{ const ball = new THREE.Mesh(new THREE.SphereGeometry(.013,16,10),new THREE.MeshBasicMaterial({color:'#fff3ff',toneMapped:false}));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:C.pink,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  glow.scale.setScalar(.075); ball.add(glow); extHandle.add(ball); extHandle.userData.glow = glow;
  const hit = new THREE.Mesh(new THREE.SphereGeometry(.04,10,8),new THREE.MeshBasicMaterial({visible:false}));
  hit.userData.kind = 'gridExtrude'; extHandle.add(hit); extHandle.userData.hit = hit;
  const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,-1,0)]),
    new THREE.LineDashedMaterial({color:C.pink,transparent:true,opacity:.6,dashSize:.01,gapSize:.012,toneMapped:false}));
  extHandle.add(stem); extHandle.userData.stem = stem; }
const gridSel = new Set();
const cellKey = (i,j) => i+','+j;
const blockH = (i,j) => (i<0||j<0||i>=DESK.cols||j>=DESK.rows) ? 0 : (state.gridBlocks?.[cellKey(i,j)]||0);
const cellX = i => -DESK_W/2+(i+.5)*DESK.cell, cellZ = j => -DESK_D/2+(j+.5)*DESK.cell;
const _m4 = new THREE.Matrix4();
function buildBlocks(){
  const c = DESK.cell, hx = DESK_W/2, hz = DESK_D/2, pos = [], aA = [], A = DESK.borderA;
  const seg = (x0,y0,z0,x1,y1,z1) => { pos.push(x0,y0,z0,x1,y1,z1); aA.push(A,A); };
  let k = 0; for (const h of blockHits) h.parent?.remove(h); blockHits.length = 0;
  for (let i=0;i<DESK.cols;i++) for (let j=0;j<DESK.rows;j++) { const h = blockH(i,j); if (!h) continue;
    blockFill.setMatrixAt(k++,_m4.makeScale(c,h,c).setPosition(cellX(i),0,cellZ(j)));
    const b = new THREE.Mesh(new THREE.BoxGeometry(c,h,c).translate(0,h/2,0),new THREE.MeshBasicMaterial({visible:false}));
    b.position.set(cellX(i),0,cellZ(j)); b.userData.kind = 'gridCell'; b.userData.cell = [i,j]; gridHandles.add(b); blockHits.push(b); }
  blockFill.count = k; blockFill.instanceMatrix.needsUpdate = true;
  // edges only where the heights change: top rims, the creases where a lower cell meets a taller one, outer corners
  for (let i=0;i<=DESK.cols;i++) for (let j=0;j<DESK.rows;j++) {           // edges along z (between cell i-1 and i)
    const a = blockH(i-1,j), b = blockH(i,j); if (a===b) continue; const x = -hx+i*c, z0 = -hz+j*c, z1 = z0+c;
    seg(x,Math.max(a,b),z0,x,Math.max(a,b),z1); if (Math.min(a,b)>0) seg(x,Math.min(a,b),z0,x,Math.min(a,b),z1); }
  for (let j=0;j<=DESK.rows;j++) for (let i=0;i<DESK.cols;i++) {           // edges along x (between cell j-1 and j)
    const a = blockH(i,j-1), b = blockH(i,j); if (a===b) continue; const z = -hz+j*c, x0 = -hx+i*c, x1 = x0+c;
    seg(x0,Math.max(a,b),z,x1,Math.max(a,b),z); if (Math.min(a,b)>0) seg(x0,Math.min(a,b),z,x1,Math.min(a,b),z); }
  for (let i=0;i<=DESK.cols;i++) for (let j=0;j<=DESK.rows;j++) {          // vertical edges at the vertices that are real corners
    const q = [blockH(i-1,j-1),blockH(i,j-1),blockH(i-1,j),blockH(i,j)], lo = Math.min(...q), hi = Math.max(...q); if (hi===lo) continue;
    const wallX = q[0]===q[2] && q[1]===q[3], wallZ = q[0]===q[1] && q[2]===q[3]; if (wallX || wallZ) continue;   // straight wall runs through
    seg(-hx+i*c,lo,-hz+j*c,-hx+i*c,hi,-hz+j*c); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('aA',new THREE.Float32BufferAttribute(aA,1));
  blockLines.geometry.dispose(); blockLines.geometry = g;
  layoutSelection();
}
function layoutSelection(){
  const c = DESK.cell; let k = 0, sx = 0, sz = 0, top = 0;
  for (const key of gridSel) { const [i,j] = key.split(',').map(Number), h = blockH(i,j);
    selFill.setMatrixAt(k++,_m4.makeScale(c*.94,1,c*.94).setPosition(cellX(i),h+.003,cellZ(j))); sx += cellX(i); sz += cellZ(j); top = Math.max(top,h); }
  selFill.count = k; selFill.instanceMatrix.needsUpdate = true;
  extHandle.visible = !!state.gridEdit && k>0;
  if (k) { extHandle.position.set(sx/k,top+EXT.handleUp,sz/k); const st = extHandle.userData.stem;
    st.geometry.setFromPoints([new THREE.Vector3(),new THREE.Vector3(0,-(top+EXT.handleUp),0)]); st.computeLineDistances(); }
  cellPad.scale.set(DESK_W,1,DESK_D);
}
function setGridEdit(on,quiet){ state.gridEdit = on; if (!on) gridSel.clear(); layoutSelection(); deskCtlP.dirty = true;
  if (!quiet) toast(on?'Extrude · tap or brush cells, then pull the handle up':'Extrude off'); }
// select: pinch a cell toggles it; keep pinching and sweep to brush more cells the same way
function cellUnder(o,d){
  raycaster.set(o,d); raycaster.far = 8;
  const h = raycaster.intersectObjects([...blockHits,cellPad],false)[0]; if (!h) return null;
  if (h.object.userData.cell) return h.object.userData.cell;
  const p = h.point.clone().applyMatrix4(invGrid.copy(deskGrid.matrixWorld).invert());
  const i = Math.floor((p.x+DESK_W/2)/DESK.cell), j = Math.floor((p.z+DESK_D/2)/DESK.cell);
  return (i<0||j<0||i>=DESK.cols||j>=DESK.rows) ? null : [i,j];
}
function cellBrush(dr,cell){ if (!cell) return; const key = cellKey(...cell); if (dr.done.has(key)) return; dr.done.add(key);
  dr.add ? gridSel.add(key) : gridSel.delete(key); layoutSelection(); }
function cellSelectStart(s,hit){
  const cell = hit.object.userData.cell || cellUnder(hit.point.clone().add(new THREE.Vector3(0,.3,0)),new THREE.Vector3(0,-1,0));
  if (!cell) return; s.drag = {kind:'gridCell',add:!gridSel.has(cellKey(...cell)),done:new Set()}; cellBrush(s.drag,cell);
}
// pull: the handle follows the ray on an upright plane through it, facing the user; heights snap to 5 cm
const _pl = new THREE.Plane(), _n = new THREE.Vector3(), _hp = new THREE.Vector3(), _ray = new THREE.Ray();
function extrudeStart(s){ s.drag = {kind:'gridExtrude'}; }
function extrudeUpdate(s,o,d){
  extHandle.getWorldPosition(_hp); _n.set(o.x-_hp.x,0,o.z-_hp.z); if (_n.lengthSq()<1e-6) return; _n.normalize();
  _pl.setFromNormalAndCoplanarPoint(_n,_hp); _ray.set(o,d); const p = _ray.intersectPlane(_pl,new THREE.Vector3()); if (!p) return;
  p.applyMatrix4(invGrid.copy(deskGrid.matrixWorld).invert());
  const h = Math.min(EXT.max,Math.max(0,Math.round((p.y-EXT.handleUp)/EXT.step)*EXT.step));
  const bl = state.gridBlocks || (state.gridBlocks = {}); let changed = false;
  for (const key of gridSel) if ((bl[key]||0)!==h) { h ? bl[key] = h : delete bl[key]; changed = true; }
  if (changed) { buildBlocks(); toast(h?`${Math.round(h*100)} cm`:'Flat',900); }
}
// grid resized: raised cells keep their place in the room
function shiftBlocks(di,dj){
  const out = {}; for (const [key,h] of Object.entries(state.gridBlocks||{})) { const [i,j] = key.split(',').map(Number), ni = i+di, nj = j+dj;
    if (ni>=0 && nj>=0 && ni<DESK.cols && nj<DESK.rows) out[cellKey(ni,nj)] = h; }
  state.gridBlocks = out; const sel = [...gridSel]; gridSel.clear();
  for (const key of sel) { const [i,j] = key.split(',').map(Number); if (i+di>=0 && j+dj>=0 && i+di<DESK.cols && j+dj<DESK.rows) gridSel.add(cellKey(i+di,j+dj)); }
}
buildBlocks();
placeGrid();

// ---- grid size: pull an edge / corner node. Whole cells; the opposite edge stays put in the room, and the visualisations
// standing on the table stay where they are (an edge can't be pulled across them).
function tableItems(){ const l = [];
  if (state.dioOnTable) l.push({k:'dio',i:state.dioI,j:state.dioJ,n:state.dioN});
  if (state.maniOnTable) l.push({k:'mani',i:state.maniI,j:state.maniJ,n:MANI_T.n});
  for (const key of Object.keys(state.gridBlocks||{})) { const [i,j] = key.split(',').map(Number); l.push({k:'block',i,j,n:1}); }   // raised cells are never cut off
  return l; }
function gridResizeStart(s,hit){
  deskGrid.updateMatrixWorld(); const [sx,sz] = hit.object.userData.side; tablePlaneLock = true;   // no re-placing on a found table mid-pull
  s.drag = {kind:'gridResize',sx,sz,M:deskGrid.matrixWorld.clone(),Mi:deskGrid.matrixWorld.clone().invert(),
    c0:DESK.cols,r0:DESK.rows,x0:-DESK_W/2,x1:DESK_W/2,z0:-DESK_D/2,z1:DESK_D/2,items:tableItems()};
}
function gridResizeUpdate(s,o,d){
  const dr = s.drag, c = DESK.cell;
  rO.copy(o).applyMatrix4(dr.Mi); rD.copy(d).transformDirection(dr.Mi);   // in the grid's space as it was when the pull began
  if (Math.abs(rD.y)<1e-4) return; const t = -rO.y/rD.y; if (t<0) return;
  const px = rO.x+rD.x*t, pz = rO.z+rD.z*t;
  // smallest size that keeps every visualisation on the table whole
  let minC = DESK.minC, minR = DESK.minC;
  for (const it of dr.items) {
    minC = Math.max(minC, dr.sx>0 ? it.i+it.n : dr.sx<0 ? dr.c0-it.i : 0);
    minR = Math.max(minR, dr.sz>0 ? it.j+it.n : dr.sz<0 ? dr.r0-it.j : 0); }
  let cols = dr.c0, rows = dr.r0;
  if (dr.sx>0) cols = Math.round((px-dr.x0)/c); else if (dr.sx<0) cols = Math.round((dr.x1-px)/c);
  if (dr.sz>0) rows = Math.round((pz-dr.z0)/c); else if (dr.sz<0) rows = Math.round((dr.z1-pz)/c);
  cols = Math.min(DESK.maxCols,Math.max(minC,cols)); rows = Math.min(DESK.maxRows,Math.max(minR,rows));
  if (cols===DESK.cols && rows===DESK.rows) return;
  const cx = dr.sx>0 ? dr.x0+cols*c/2 : dr.sx<0 ? dr.x1-cols*c/2 : 0;
  const cz = dr.sz>0 ? dr.z0+rows*c/2 : dr.sz<0 ? dr.z1-rows*c/2 : 0;
  deskGrid.position.set(cx,0,cz).applyMatrix4(dr.M);                    // the turn stays, the centre slides
  DESK.cols = cols; DESK.rows = rows;
  const di = dr.sx<0 ? cols-dr.c0 : 0, dj = dr.sz<0 ? rows-dr.r0 : 0;   // pulling the left / far edge shifts the cell numbers under the items
  for (const it of dr.items) {
    if (it.k==='dio') { state.dioI = it.i+di; state.dioJ = it.j+dj; }
    else if (it.k==='mani') { state.maniI = it.i+di; state.maniJ = it.j+dj; } }
  const bi = di-(dr.bi||0), bj = dj-(dr.bj||0); if (bi||bj) { shiftBlocks(bi,bj); dr.bi = di; dr.bj = dj; }   // blocks shift by the change since the last step
  rebuildGrid();
  toast(`${cols} × ${rows} · ${(cols*c).toFixed(2)} m × ${(rows*c).toFixed(2)} m`,1400);
}
function rebuildGrid(){
  DESK_W = DESK.cols*DESK.cell; DESK_D = DESK.rows*DESK.cell; state.gridCols = DESK.cols; state.gridRows = DESK.rows;
  buildGridLines(); layoutGridChrome(); buildBlocks();
  if (state.dioOnTable) { layoutDeskItem(state.dioI,state.dioJ,state.dioN,false); deskItem.position.copy(deskItem.userData.target); }
  if (state.maniOnTable) layoutManiDesk();
  relinkGrid();
}

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
  if (s.drag.kind==='stick') { stickUpdate(s,o,d); return; }
  if (s.drag.kind==='maniSpin') { maniSpinUpdate(s,o,d); return; }
  if (s.drag.kind==='maniGrow') { maniGrowUpdate(s,o,d); return; }
  if (s.drag.kind==='maniPopMove') { popMoveUpdate(s,o,d); return; }
  if (s.drag.kind==='gridResize') { gridResizeUpdate(s,o,d); return; }
  if (s.drag.kind==='gridExtrude') { extrudeUpdate(s,o,d); return; }
  if (s.drag.kind==='gridCell') { cellBrush(s.drag,cellUnder(o,d)); return; }
  const p = rayOnGrid(o,d); if (!p) return;
  const dr = s.drag;
  if (dr.kind==='maniMove') { const n = MANI_T.n;                          // the manifold follows the hand cell by cell
    state.maniI = clampI(Math.round((p.x+DESK_W/2)/DESK.cell-n/2),n,DESK.cols); state.maniJ = clampI(Math.round((p.z+DESK_D/2)/DESK.cell-n/2),n,DESK.rows); layoutManiDesk(); return; }
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
function freeLift(){ dio.userData.lift = DIO_FOOT/2*dio.scale.x; }       // centre of the tank = water surface = zero, in every pose
function handGrabStart(s){
  const j = s.hand?.joints; if (!j?.['index-finger-tip']?.visible || !j['thumb-tip']?.visible) return false;
  deskGrid.updateMatrixWorld(); invGrid.copy(deskGrid.matrixWorld).invert(); pinchPoint(s,gp);
  const w = state.dioN*DESK.cell, c = deskItem.position;
  if (Math.abs(gp.x-c.x)>w/2+.04 || Math.abs(gp.z-c.z)>w/2+.04 || gp.y<-.03 || gp.y>w*1.2+.05) return false;
  const turn = !!j['wrist']?.visible && !!j['middle-finger-metacarpal']?.visible;
  s.drag = {kind:'dioGrab',i:state.dioI,j:state.dioJ,n:state.dioN,off:[gp.x-c.x,gp.z-c.z],y0:gp.y,
    turn, h0:turn?handYaw(s):0, yaw0:state.dioYaw||0};
  state.dioQ = null; state.dioView = 'persp';
  return true;
}
function grabUpdate(s){
  const j = s.hand.joints; if (!j['index-finger-tip']?.visible || !j['thumb-tip']?.visible) { dragEnd(s); return; }
  pinchPoint(s,gp); const dr = s.drag, n = state.dioN, x = gp.x-dr.off[0], z = gp.z-dr.off[1];
  dr.i = clampI(Math.round((x+DESK_W/2)/DESK.cell-n/2),n,DESK.cols); dr.j = clampI(Math.round((z+DESK_D/2)/DESK.cell-n/2),n,DESK.rows); dr.n = n;
  deskItem.userData.target.set(x,Math.max(0,Math.min(.2,gp.y-dr.y0))+.015,z);          // lifts a little in the hand
  if (dr.turn && j['wrist']?.visible && j['middle-finger-metacarpal']?.visible) {   // turning the hand turns the diorama about the vertical only: it stays level with the water
    state.dioYaw = dr.yaw0+wrapA(handYaw(s)-dr.h0); dio.quaternion.copy(tableTargetQ()); }
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
  if (hit.kind==='gridResize') { gridResizeStart(s,hit); return; }
  if (hit.kind==='gridExtrude') { extrudeStart(s); return; }
  if (hit.kind==='gridCell') { cellSelectStart(s,hit); return; }
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
  if (dr.kind==='roomCoin') { dr.src = s; roomRelease(dr); return; }
  if (dr.kind==='stick') { stickP.dirty = true; return; }
  if (dr.kind==='dioRotate' || dr.kind==='dioPinchScale' || dr.kind==='maniSpin' || dr.kind==='maniScale' || dr.kind==='maniMove' || dr.kind==='maniGrow' || dr.kind==='maniPopMove') return;
  if (dr.kind==='gridMove') { gridGrabEnd(s,dr); return; }
  if (dr.kind==='gridResize') { gridPlacedAt = 0; tablePlaneLock = true; return; }
  if (dr.kind==='gridExtrude' || dr.kind==='gridCell') return;   // a resized grid stays where the user left it
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
    if (s.drag.kind==='stick' && s.drag.poke) continue;                  // fingertip drag runs in updateXRInput
    if (s.drag.kind==='roomCoin') { roomDragUpdate(s); continue; }
    if (s.drag.kind==='dioGrab') { grabUpdate(s); continue; }
    if (s.drag.kind==='dioPinchScale') { pinchScaleUpdate(s); continue; }
    if (s.drag.kind==='maniScale') { maniScaleUpdate(s); continue; }
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
  if (extHandle.visible) extHandle.userData.glow.material.opacity = .6+.3*Math.sin(t*3);
  if (gridHandles.visible) for (const n of sizeNodes) n.glow.material.opacity = .45+.3*Math.sin(t*2.2+n.sx*1.3+n.sz*2.1);
}
applyDeskToggles(); if (state.dioOnTable) dioToTable();

// ---------------------------------------------------------------- state changes
function setHorizon(h){ if (!data[h]) return; state.horizon = h; rebuildLoop(); [horizonP,timelineP,dashP].forEach(p=>p.dirty=true); }
function setCurrency(c){ state.currency = c; dashP.dirty = true; widgetP.dirty = true; }

// ---------------------------------------------------------------- 02 · window views: Diorama · Manifold · Ribbon · COT Pawns · Rates Membrane
// five tabs at the window's top-left; the pink pill slides to the chosen one. Only Diorama and Manifold are built so far.
const WIN_VIEWS = [['diorama','DIORAMA',true],['manifold','MANIFOLD',true],['ribbon','RIBBON',false],['pawns','COT PAWNS',false],['membrane','RATES',false]];
const TABS = {x:WIN.x+14, y:WIN.y+14, h:32, pad:16, gap:2, slide:.22};       // slide: seconds for the pill to reach its tab
const tabW = (() => { const c = document.createElement('canvas').getContext('2d'); c.font = '800 11px Manrope';
  return WIN_VIEWS.map(([,label])=>Math.ceil(c.measureText(label).width+.4*label.length)+2*TABS.pad); })();
const tabX = tabW.map((w,i)=>4+tabW.slice(0,i).reduce((a,b)=>a+b+TABS.gap,0));
const TABS_W = tabX[tabX.length-1]+tabW[tabW.length-1]+4;
const tabAnim = {from:0, to:0, t0:-1};
const viewIndex = () => Math.max(0,WIN_VIEWS.findIndex(v=>v[0]===state.winView));
tabAnim.from = tabAnim.to = viewIndex();
const tabsP = panel({name:'window views',x:TABS.x,y:TABS.y,w:TABS_W,h:TABS.h,margin:14,z:.012,draw(ctx,p,t){
  ctx.save(); ctx.shadowColor = '#0b0a18'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
  rr(ctx,0,0,TABS_W,TABS.h,TABS.h/2); ctx.fillStyle = 'rgba(35,32,66,.92)'; ctx.fill(); ctx.restore();
  rr(ctx,0,0,TABS_W,TABS.h,TABS.h/2); ctx.lineWidth = 1.5; ctx.strokeStyle = '#4b4470'; ctx.stroke();
  // sliding pill: eases from the previous tab to the chosen one
  let k = 1; if (tabAnim.t0>=0) { k = Math.min(1,(t-tabAnim.t0)/TABS.slide); if (k>=1) { tabAnim.t0 = -1; p.fps = 0; } }
  const e = k<.5 ? 2*k*k : 1-Math.pow(-2*k+2,2)/2, a = tabAnim.from, b = tabAnim.to;
  const px = tabX[a]+(tabX[b]-tabX[a])*e, pw = tabW[a]+(tabW[b]-tabW[a])*e;
  ctx.save(); ctx.shadowColor = C.pink; ctx.shadowBlur = 12; rr(ctx,px,3,pw,TABS.h-6,(TABS.h-6)/2); ctx.fillStyle = C.pink; ctx.fill(); ctx.restore();
  WIN_VIEWS.forEach(([id,label,ready],i)=>{
    const on = i===b && k>=.5, hot = p.hover==='view'+id;
    text(ctx,label,tabX[i]+tabW[i]/2,TABS.h/2+1,{font:'800 11px Manrope',align:'center',ls:'.4px',
      color: on ? C.dark : !ready ? (hot?C.muted:C.dim) : hot ? C.pink : C.ink});
    p.region('view'+id,tabX[i],-8,tabW[i],TABS.h+16,()=>setWinView(id));
  });
}});
function setWinView(id){
  const v = WIN_VIEWS.find(w=>w[0]===id); if (!v) return;
  if (!v[2]) { toast(`${v[1]} — coming soon`); return; }
  if (state.winView===id) return;
  tabAnim.from = viewIndex(); state.winView = id; tabAnim.to = viewIndex(); tabAnim.t0 = performance.now()/1000;
  tabsP.fps = 60; tabsP.dirty = true; dioCardP.dirty = true; maniInfo(null);
  if (id==='manifold') toast(MANI_DATA ? 'Manifold · concept on old data (5H, 3 Sep – 19 Oct 2026) · drag to turn, two hands to zoom' : 'Manifold data could not be loaded');
}

// ---- Manifold hologram (concept): Barış's terrain method on his old manifold-v0 fixture
// samples = every frame's currency positions: x = pc1, z = pc2, height = strength (Barış's toScene / height mapping)
// terrain = compact quartic local mean (bandwidth .65, ≥3 samples), 48-step grid inside a ±3 disc, contours every .5
// a semi-opaque surface, coral contours, and pins on the highest peaks / deepest pits that open an info pop-up when touched
const MANI = {extent:3, steps:48, bandwidth:.65, interval:.5, minSamples:3, radius:.2, height:.045, tilt:.55, zoom:[.5,2.5],
              surface:'#80a7dd', surfaceA:.26, lowA:.1, contour:C.coral, contourA:.9, ring:'#a7a2c9', ringA:.35,
              pins:3, pinSep:.9, pinMin:.35, pinStem:.032, pinHead:.0075, spin:5.5,
              zoomTable:12, vExp:.6, markExp:.3, zoomRoom:12};   // zoomRoom: size when the user steps inside it (2.4 m radius around them)   // above 1× the height grows slower (z^vExp) so it stays walkable · pins / labels grow only z^markExp   // on the table it can grow to a 2.4 m radius — across the whole grid, to walk around   // spin: radians per metre of hand travel
let MANI_DATA = null;
try { MANI_DATA = await getJSON('data/manifold-concept.json'); } catch (e) { console.warn('manifold concept data',e); }
const maniSamples = MANI_DATA ? MANI_DATA.frames.flatMap(f=>Object.entries(f.points).map(([cur,p])=>({cur,x:p[0],z:p[2],y:p[1]}))) : [];
function maniEstimate(x,z){
  const r2 = MANI.bandwidth*MANI.bandwidth; let w = 0, w2 = 0, sum = 0, n = 0; const near = [];
  for (const s of maniSamples) { const d2 = ((s.x-x)**2+(s.z-z)**2)/r2; if (d2>=1) continue;
    const k = (1-d2)**2; w += k; w2 += k*k; sum += k*s.y; n++; near.push([s,k]); }
  if (n<MANI.minSamples || (w2 ? w*w/w2 : 0)<2) return null;
  const mean = sum/w, disp = Math.sqrt(near.reduce((a,[s,k])=>a+k*(s.y-mean)**2,0)/w);
  return {mean,disp,n,near,w};
}
const mani = new THREE.Group(); mani.name = 'manifold';
mani.position.set((WIN.x+WIN.w/2-BW/2)*S,(BH/2-(WIN.y+WIN.h/2))*S,-WIN.depth/2); board.add(mani);
const maniTurn = new THREE.Group(); mani.add(maniTurn);                 // yaw + tilt + zoom from the hands
const maniPins = [];
// ---- terrain at several levels of detail: the bigger the hologram is in the room, the finer the grid, the narrower the
// smoothing (so the real samples show through), the denser the contours and the more pins. Built once per level, cached.
const MANI_LOD = [
  {R:0,    steps:48,  bw:.65, interval:.5,  minor:0,    pins:3, labels:false},
  {R:.45,  steps:80,  bw:.5,  interval:.5,  minor:.25,  pins:5, labels:true},
  {R:1.1,  steps:120, bw:.4,  interval:.25, minor:.125, pins:8, labels:true},
];                                                                        // R: world radius (m) from which a level applies
const maniLevels = [];                                                    // per level: {group, pins, lo, hi}
let maniLevel = -1;
function buildManiLevel(L){
  const lod = MANI_LOD[L], N = lod.steps, E = MANI.extent, hs = MANI.radius/E, vs = MANI.height, verts = [];
  const est = (x,z) => { const b = MANI.bandwidth; MANI.bandwidth = lod.bw; const e = maniEstimate(x,z); MANI.bandwidth = b; return e; };
  for (let j=0;j<=N;j++) for (let i=0;i<=N;i++) { const x = E*(2*i/N-1), z = E*(2*j/N-1);
    verts.push({x,z,i,j,est:Math.hypot(x,z)<=E ? est(x,z) : null}); }
  const tris = [];
  for (let j=0;j<N;j++) for (let i=0;i<N;i++) { const a = j*(N+1)+i, b = a+1, c = a+N+1, d = c+1;
    for (const t of [[a,c,b],[b,c,d]]) if (t.every(k=>verts[k].est)) tris.push(...t); }
  const ys = verts.filter(v=>v.est).map(v=>v.est.mean), lo = Math.min(...ys), hi = Math.max(...ys);
  const group = new THREE.Group(); group.name = 'manifold level '+L;
  // surface: one colour, more opaque toward the peaks
  const pos = new Float32Array(verts.length*3), alpha = new Float32Array(verts.length);
  verts.forEach((v,k)=>{ pos[k*3] = v.x*hs; pos[k*3+1] = (v.est?.mean ?? 0)*vs; pos[k*3+2] = v.z*hs;
    alpha[k] = v.est ? MANI.lowA+(MANI.surfaceA-MANI.lowA)*(hi>lo ? (v.est.mean-lo)/(hi-lo) : .5) : 0; });
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position',new THREE.BufferAttribute(pos,3)); sg.setAttribute('aAlpha',new THREE.BufferAttribute(alpha,1)); sg.setIndex(tris);
  const surf = new THREE.Mesh(sg,new THREE.ShaderMaterial({uniforms:{uCol:{value:new THREE.Color(MANI.surface)}},
    vertexShader:`#include <clipping_planes_pars_vertex>
      attribute float aAlpha; varying float vA; void main(){ vA = aAlpha; vec4 mvPosition = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mvPosition;
      #include <clipping_planes_vertex>
      }`,
    fragmentShader:`#include <clipping_planes_pars_fragment>
      uniform vec3 uCol; varying float vA; void main(){
      #include <clipping_planes_fragment>
      gl_FragColor = vec4(uCol,vA); }`,
    transparent:true, depthWrite:false, side:THREE.DoubleSide, toneMapped:false, clipping:true}));
  surf.renderOrder = 1; group.add(surf);
  // contours (isohypses) in coral: main lines every `interval`, finer, fainter ones every `minor` at the higher levels
  const contourSet = (step,skip) => { const seg = [];
    for (let n=0;n<tris.length;n+=3) {
      const vs3 = [tris[n],tris[n+1],tris[n+2]].map(k=>verts[k]), h = vs3.map(v=>v.est.mean);
      const first = Math.ceil(Math.min(...h)/step), last = Math.floor(Math.max(...h)/step);
      for (let k=first;k<=last;k++) { const lv = k*step; if (skip && Math.abs(lv/skip-Math.round(lv/skip))<1e-6) continue; const pts = [];
        for (const [a,b] of [[0,1],[1,2],[2,0]]) if ((h[a]<=lv&&h[b]>lv)||(h[b]<=lv&&h[a]>lv)) { const u = (lv-h[a])/(h[b]-h[a]);
          pts.push((vs3[a].x+(vs3[b].x-vs3[a].x)*u)*hs, lv*vs+.0004, (vs3[a].z+(vs3[b].z-vs3[a].z)*u)*hs); }
        if (pts.length===6) seg.push(...pts); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(new Float32Array(seg),3)); return g; };
  const contours = new THREE.LineSegments(contourSet(lod.interval,0),new THREE.LineBasicMaterial({color:MANI.contour,transparent:true,opacity:MANI.contourA,depthWrite:false,toneMapped:false}));
  contours.renderOrder = 2; group.add(contours);
  if (lod.minor) { const fine = new THREE.LineSegments(contourSet(lod.minor,lod.interval),new THREE.LineBasicMaterial({color:MANI.contour,transparent:true,opacity:MANI.contourA*.35,depthWrite:false,toneMapped:false}));
    fine.renderOrder = 2; group.add(fine); }
  // pins: local maxima / minima on the grid (8 neighbours), strongest first, kept apart
  const at = (i,j) => (i<0||j<0||i>N||j>N) ? null : verts[j*(N+1)+i].est;
  const ext = [], pins = [], sep = MANI.pinSep*lod.bw/MANI_LOD[0].bw;
  for (const v of verts) { if (!v.est || Math.abs(v.est.mean)<MANI.pinMin) continue;
    let mx = true, mn = true;
    for (let dj=-1;dj<=1;dj++) for (let di=-1;di<=1;di++) { if (!di&&!dj) continue; const e = at(v.i+di,v.j+dj);
      if (!e) { mx = mn = false; continue; } if (e.mean>=v.est.mean) mx = false; if (e.mean<=v.est.mean) mn = false; }
    if (mx && v.est.mean>0) ext.push({v,kind:'peak'}); if (mn && v.est.mean<0) ext.push({v,kind:'pit'}); }
  for (const kind of ['peak','pit']) {
    const list = ext.filter(e=>e.kind===kind).sort((a,b)=>Math.abs(b.v.est.mean)-Math.abs(a.v.est.mean)), keep = [];
    for (const e of list) { if (keep.length>=lod.pins) break; if (keep.every(k=>Math.hypot(k.v.x-e.v.x,k.v.z-e.v.z)>=sep)) keep.push(e); }
    for (const e of keep) {
      const {x,z,est} = e.v, base = new THREE.Vector3(x*hs,est.mean*vs,z*hs), top = base.clone(); top.y += kind==='peak' ? MANI.pinStem : -MANI.pinStem;
      const g = new THREE.Group(); group.add(g);
      const stem = new THREE.Line(new THREE.BufferGeometry().setFromPoints([base,top]),new THREE.LineBasicMaterial({color:C.pink,transparent:true,opacity:.8,toneMapped:false})); g.add(stem);
      const head = new THREE.Mesh(new THREE.SphereGeometry(MANI.pinHead,16,12),new THREE.MeshBasicMaterial({color:'#fff3ff',toneMapped:false})); head.position.copy(top); g.add(head);
      const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:C.pink,transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,toneMapped:false}));
      glow.scale.setScalar(MANI.pinHead*5); glow.position.copy(top); g.add(glow);
      const foot = new THREE.Mesh(new THREE.RingGeometry(MANI.pinHead*.9,MANI.pinHead*1.3,24).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:C.pink,transparent:true,opacity:.7,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}));
      foot.position.copy(base); foot.position.y += .0006; g.add(foot);
      const hit = new THREE.Mesh(new THREE.SphereGeometry(.014,8,6),new THREE.MeshBasicMaterial({visible:false})); hit.position.copy(top); g.add(hit);
      // who gathers here: weighted share of each currency among the samples inside the bandwidth
      const share = {}; for (const [s,k] of est.near) share[s.cur] = (share[s.cur]||0)+k/est.w;
      const pin = {kind,est,x,z,head,glow,hit,base,stem,foot,share:Object.entries(share).sort((a,b)=>b[1]-a[1])};
      hit.userData.kind = 'maniPin'; hit.userData.pin = pin; pins.push(pin);
    }
  }
  return {group,pins,lo,hi};
}
function setManiLevel(L){
  if (L===maniLevel) return;
  if (maniOpen) maniInfo(null);
  if (maniLevel>=0) maniTurn.remove(maniLevels[maniLevel].group);
  maniLevels[L] ||= buildManiLevel(L);
  const lv = maniLevels[L]; maniTurn.add(lv.group); maniLevel = L;
  maniPins.length = 0; maniPins.push(...lv.pins);
  mani.userData.lo = lv.lo; mani.userData.hi = lv.hi;
  const g = mani.userData.grab; g.scale.y = Math.max(.2,(MANI.height*(lv.hi-lv.lo)+.06)/g.userData.h0); g.position.y = (lv.hi+lv.lo)/2*MANI.height;
  for (const t of maniTrails) t.label.visible = MANI_LOD[L].labels;
  setManiClip(!maniOut()); applyManiPose();
}
// which level fits the hologram's size in the room now (a little hysteresis so it doesn't flicker at a boundary)
const maniWorldR = () => MANI.radius*(state.maniZoom||1)*(maniOut() ? 1 : (boardRoot.scale.x||1));
function maniLevelFor(R){ let L = 0; for (let k=1;k<MANI_LOD.length;k++) if (R>=MANI_LOD[k].R*(k<=maniLevel ? .92 : 1.08)) L = k; return L; }

// ---- currency trails: each currency's own path through all frames — where it stood (behaviour plane) and how strong it
// was (height). Old end faint, newest end bright with a glowing head; a slow pulse runs along toward the present.
// The selected currency's trail is bright, the others quiet. Colours: CUR_COL (still the placeholder palette).
const MANI_TRAIL = {sub:4, ribbon:.0035, coin:.018, oldA:.06, newA:.75, dim:.2, pulses:5, speed:.12, head:.006, label:.05};
const maniTrails = [];
const trailUni = {uTime:{value:0}};
function buildManiTrails(){
  const hs = MANI.radius/MANI.extent, vs = MANI.height, F = MANI_DATA.frames;
  for (const cur of CURRENCIES) {
    const pts = F.map(f=>f.points[cur]).filter(Boolean).map(p=>new THREE.Vector3(p[0]*hs,p[1]*vs+.001,p[2]*hs));
    if (pts.length<2) continue;
    const curve = new THREE.CatmullRomCurve3(pts,false,'centripetal'), sm = curve.getPoints((pts.length-1)*MANI_TRAIL.sub);
    // ribbon: a flat band along the path (horizontal, its width across the direction of travel)
    const n = sm.length, rp = new Float32Array(n*6), u = new Float32Array(n*2), idx = [], hw = MANI_TRAIL.ribbon/2;
    for (let k=0;k<n;k++) { const a = sm[Math.max(0,k-1)], b = sm[Math.min(n-1,k+1)];
      let tx = b.x-a.x, tz = b.z-a.z; const l = Math.hypot(tx,tz)||1; tx /= l; tz /= l;
      rp.set([sm[k].x-tz*hw,sm[k].y,sm[k].z+tx*hw, sm[k].x+tz*hw,sm[k].y,sm[k].z-tx*hw],k*6); u[k*2] = u[k*2+1] = k/(n-1);
      if (k<n-1) idx.push(k*2,k*2+1,k*2+2, k*2+1,k*2+3,k*2+2); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position',new THREE.BufferAttribute(rp,3)); g.setAttribute('aU',new THREE.BufferAttribute(u,1)); g.setIndex(idx);
    const mat = new THREE.ShaderMaterial({uniforms:{uCol:{value:new THREE.Color(CUR_COL[cur]||'#ffffff')},uSel:{value:0},uTime:trailUni.uTime},
      vertexShader:`#include <clipping_planes_pars_vertex>
        attribute float aU; varying float vU; void main(){ vU = aU; vec4 mvPosition = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mvPosition;
        #include <clipping_planes_vertex>
        }`,
      fragmentShader:`#include <clipping_planes_pars_fragment>
        uniform vec3 uCol; uniform float uSel; uniform float uTime; varying float vU; void main(){
        #include <clipping_planes_fragment>
        float a = mix(${MANI_TRAIL.oldA.toFixed(3)},${MANI_TRAIL.newA.toFixed(3)},pow(vU,1.6));
        float f = fract(vU*${MANI_TRAIL.pulses.toFixed(1)}-uTime*${MANI_TRAIL.speed.toFixed(3)}); a += .5*exp(-f*18.)*vU;
        a *= mix(${MANI_TRAIL.dim.toFixed(2)},1.,uSel);
        gl_FragColor = vec4(mix(uCol,vec3(1.),.25*uSel),a); }`,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, toneMapped:false, clipping:true, side:THREE.DoubleSide});
    const ribbon = new THREE.Mesh(g,mat); ribbon.renderOrder = 3; maniTurn.add(ribbon);
    const end = pts[pts.length-1];
    // the currency itself: a small coin (same aged bronze as everywhere) inside its glowing glass-marble rim, turning slowly
    const head = new THREE.Group(); head.position.copy(end); maniTurn.add(head);
    const spin = new THREE.Group(); head.add(spin);
    const fallback = new THREE.Mesh(new THREE.SphereGeometry(COIN.dia*.3,16,10),new THREE.MeshBasicMaterial({color:'#ffffff',toneMapped:false})); spin.add(fallback);
    const rim = new THREE.Mesh(new THREE.SphereGeometry(HALO.rimR*.62,40,20),marbleRimMaterial()); head.add(rim);   // in coin units (COIN.dia), like the room coins' marble
    const glow = rim;
    // label above the head (higher detail levels only): the code in Manrope, on a transparent canvas
    const cv = document.createElement('canvas'); cv.width = 128; cv.height = 48; const cx = cv.getContext('2d');
    cx.font = '800 30px Manrope'; cx.textAlign = 'center'; cx.textBaseline = 'middle'; cx.fillStyle = CUR_COL[cur]||'#ffffff'; cx.fillText(cur,64,25);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const label = new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,toneMapped:false}));
    label.scale.set(MANI_TRAIL.label,MANI_TRAIL.label*48/128,1); label.position.copy(end); label.position.y += MANI_TRAIL.head*3.2; label.visible = false; maniTurn.add(label);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(MANI_TRAIL.head*2.5,10,8),new THREE.MeshBasicMaterial({visible:false})); hit.position.copy(end); maniTurn.add(hit);
    const last = F[F.length-1].points[cur]?.[1] ?? 0;
    const tr = {cur,mat,head,spin,fallback,rim,glow,label,end,ribbon,hit,sm,z:last,phase:CURRENCIES.indexOf(cur)*.8,frames:F.map((f,i)=>f.points[cur]?i:-1).filter(i=>i>=0)};
    ribbon.userData.kind = 'maniTrail'; ribbon.userData.trail = tr; hit.userData.kind = 'maniUnit'; hit.userData.trail = tr;
    maniTrails.push(tr);
  }
  maniCoinReady = cur => { const tr = maniTrails.find(t=>t.cur===cur), h = coinHolders[cur]; if (!tr || !h || tr.coin) return;
    const c = h.clone(true); c.traverse(o=>{ if (o.isMesh) { o.material = o.material.clone(); o.material.clippingPlanes = mani.parent===board && !maniOut() ? winPlanes : null; } });
    tr.spin.add(c); tr.coin = c; tr.fallback.visible = false; };
  for (const cur of Object.keys(coinHolders)) maniCoinReady(cur);
}
if (MANI_DATA) {
  // invisible grab volume around the terrain (pinch-ray / mouse drag turns it); its height follows the level
  const h0 = .2, grab = new THREE.Mesh(new THREE.CylinderGeometry(MANI.radius*1.05,MANI.radius*1.05,h0,32),new THREE.MeshBasicMaterial({visible:false}));
  grab.userData.kind = 'maniSpin'; grab.userData.h0 = h0; maniTurn.add(grab); mani.userData.grab = grab;
  buildManiTrails();
}
// ---- links between the currencies on the terrain: the same language as the room network — strands of tiny dots on
// parabolic arches (cubic Bezier rising straight up out of one coin's glass rim and falling into the other's). Every pair is
// there but faint; the selected currency's links are bright. Strength ← gap in latest strength (z): more strands, higher arch,
// more and faster pulses running weaker → stronger. Colour flows from one currency's colour to the other's.
const MLINK = {arch:.18, archPer:.2, strandsMax:5, fan:.55, bead:.0045, beadSize:.0026, beadsMax:150,
               glow:.55, faint:.1, pulses:4, pulseSize:.008, speed:.1, speedPer:.35, pulseGlow:1};   // arch: height × distance (+ more for a wider gap)
const maniPairs = []; for (let a=0;a<8;a++) for (let b=a+1;b<8;b++) maniPairs.push([a,b]);
const mBeads = additivePoints(MLINK.beadSize,maniPairs.length*MLINK.strandsMax*(MLINK.beadsMax+1));
const mFlow = additivePoints(MLINK.pulseSize,maniPairs.length*MLINK.strandsMax*MLINK.pulses);
mBeads.material.map = crispTex; mBeads.renderOrder = mFlow.renderOrder = 4; mani.add(mBeads,mFlow);
const mA = new THREE.Vector3(), mB = new THREE.Vector3(), mUp = new THREE.Vector3(), mSide = new THREE.Vector3(), mQ = new THREE.Quaternion(), mInv = new THREE.Matrix4();
const M0 = new THREE.Vector3(), M1 = new THREE.Vector3(), M2 = new THREE.Vector3(), M3 = new THREE.Vector3(), MP = new THREE.Vector3();
function updateManiLinks(t){
  if (maniTrails.length<2) return;
  mani.updateMatrixWorld(); mInv.copy(mani.matrixWorld).invert();
  mUp.set(0,1,0).applyQuaternion(maniTurn.quaternion);                     // the terrain's own up (the window view is tilted)
  const z = state.maniZoom||1, w = z<=1 ? 1 : Math.pow(z,MANI.markExp), ws = w*(maniOut() ? 1 : (boardRoot.scale.x||1));   // w: in mani's own units · ws: on screen (dot size)
  const rimR = HALO.rimR*.62*MANI_TRAIL.coin/COIN.dia*w;                  // the glass rim's radius
  mBeads.material.size = MLINK.beadSize*ws; mFlow.material.size = MLINK.pulseSize*ws;
  const bp = mBeads.geometry.attributes.position.array, bc = mBeads.geometry.attributes.color.array;
  const fp = mFlow.geometry.attributes.position.array, fc = mFlow.geometry.attributes.color.array;
  let nb = 0, nf = 0; const bead = MLINK.bead*w;
  for (const [ia,ib] of maniPairs) {
    const A = maniTrails[ia], B = maniTrails[ib]; if (!A || !B) continue;
    const hot = A.cur===state.currency || B.cur===state.currency;
    A.head.getWorldPosition(mA).applyMatrix4(mInv); B.head.getWorldPosition(mB).applyMatrix4(mInv);
    const dist = mA.distanceTo(mB), gap = B.z-A.z, gapN = Math.min(1,Math.abs(gap)/2);
    const strands = hot ? 1+Math.round((MLINK.strandsMax-1)*gapN) : 1, base = (hot ? MLINK.glow : MLINK.faint)/Math.sqrt(strands);
    const h = dist*(MLINK.arch+MLINK.archPer*gapN);
    mSide.subVectors(mB,mA).cross(mUp); if (mSide.lengthSq()<1e-10) mSide.set(1,0,0); mSide.normalize();
    const cA = curCol[A.cur], cB = curCol[B.cur], n = Math.min(MLINK.beadsMax,Math.max(12,Math.floor((dist+2*h)/bead)));
    const v = (MLINK.speed+MLINK.speedPer*gapN)/Math.max(dist+h,.01), fwd = gap>=0, nP = hot ? 1+Math.round((MLINK.pulses-1)*gapN) : 0;
    for (let k=0;k<strands;k++) {
      const o = strands>1 ? k/(strands-1)*2-1 : 0, wob = .15*Math.sin(t*.5+k*1.3+ia*2+ib);
      M0.copy(mA).addScaledVector(mUp,rimR).addScaledVector(mSide,o*rimR*.5);
      M3.copy(mB).addScaledVector(mUp,rimR).addScaledVector(mSide,o*rimR*.5);
      M1.copy(M0).addScaledVector(mUp,h).addScaledVector(mSide,(o+wob)*rimR*MLINK.fan*2);
      M2.copy(M3).addScaledVector(mUp,h).addScaledVector(mSide,(o-wob)*rimR*MLINK.fan*2);
      for (let j=0;j<=n;j++) { const s = j/n; cub(s,M0,M1,M2,M3,MP);
        bp[nb*3] = MP.x; bp[nb*3+1] = MP.y; bp[nb*3+2] = MP.z; const a = base*(.6+.4*Math.sin(Math.PI*s));
        bc[nb*3] = (cA.r+(cB.r-cA.r)*s)*a; bc[nb*3+1] = (cA.g+(cB.g-cA.g)*s)*a; bc[nb*3+2] = (cA.b+(cB.b-cA.b)*s)*a; nb++; }
      for (let j=0;j<nP;j++) { let u = (j/nP+k*.137+t*v)%1; if (!fwd) u = 1-u; cub(u,M0,M1,M2,M3,MP);
        fp[nf*3] = MP.x; fp[nf*3+1] = MP.y; fp[nf*3+2] = MP.z; const a = Math.sin(Math.PI*u)*MLINK.pulseGlow/Math.sqrt(strands);
        fc[nf*3] = Math.min(1,(cA.r+(cB.r-cA.r)*u)*a+.25*a); fc[nf*3+1] = Math.min(1,(cA.g+(cB.g-cA.g)*u)*a+.25*a); fc[nf*3+2] = Math.min(1,(cA.b+(cB.b-cA.b)*u)*a+.25*a); nf++; }
    }
  }
  mBeads.geometry.setDrawRange(0,nb); mFlow.geometry.setDrawRange(0,nf);
  for (const g of [mBeads.geometry,mFlow.geometry]) { g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true; }
}
const setManiClip = on => mani.traverse(o=>{ if (o.material) for (const m of [o.material].flat()) { m.clippingPlanes = on ? winPlanes : null; m.needsUpdate = true; } });
setManiClip(true);                                                        // in the window it stays inside the box
// ---- grow nodes (on the table): four glowing nodes on the hologram's rim, one per side so one is always near wherever the
// user stands. Pinch one and pull outward / inward: the hologram grows or shrinks around its centre (free scale, no steps),
// up to the whole grid; detail follows the size (MANI_LOD).
const growNodes = new THREE.Group(); growNodes.name = 'manifold grow nodes'; mani.add(growNodes); growNodes.visible = false;
const growList = [0,1,2,3].map(k=>{ const a = k*Math.PI/2;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(.011,16,10),new THREE.MeshBasicMaterial({color:'#fff3ff',toneMapped:false}));
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex,color:C.coral,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,toneMapped:false}));
  glow.scale.setScalar(.06); ball.add(glow);
  const hit = new THREE.Mesh(new THREE.SphereGeometry(.035,10,8),new THREE.MeshBasicMaterial({visible:false})); hit.userData.kind = 'maniGrow'; ball.add(hit);
  growNodes.add(ball); return {ball,glow,hit,a}; });
const GROW = {gap:.03};                                                   // node distance outside the rim (m)
function layoutGrowNodes(){
  growNodes.visible = !!state.maniOnTable && !state.maniRoom && !!MANI_DATA; if (!growNodes.visible) return;
  const z = state.maniZoom||1, r = MANI.radius*z+GROW.gap, y = Math.min(mani.userData.lo||0,maniRawLo)*MANI.height*maniZY(z);   // at the hologram's foot, on the grid
  for (const n of growList) n.ball.position.set(Math.cos(n.a)*r,y,Math.sin(n.a)*r);
}
const _gc = new THREE.Vector3(), _gp = new THREE.Vector3(), _gPl = new THREE.Plane(), _gUp = new THREE.Vector3(0,1,0);
function maniGrowStart(s,hit){
  hit.object.getWorldPosition(_gp); _gPl.setFromNormalAndCoplanarPoint(_gUp,_gp);
  s.drag = {kind:'maniGrow',plane:_gPl.clone()};
}
function maniGrowUpdate(s,o,d){
  raycaster.set(o,d); if (!raycaster.ray.intersectPlane(s.drag.plane,_gp)) return;
  mani.getWorldPosition(_gc); const r = Math.hypot(_gp.x-_gc.x,_gp.z-_gc.z);
  const z0 = state.maniZoom; state.maniZoom = (r-GROW.gap)/MANI.radius; applyManiPose();
  if (Math.abs(state.maniZoom-z0)>.001) toast(`Manifold ${(MANI.radius*state.maniZoom*2).toFixed(2)} m across`,900);
}
const maniWinPos = mani.position.clone();
const maniRawLo = maniSamples.length ? Math.min(...maniSamples.map(s=>s.y)) : 0;
const maniZY = z => z<=1 ? z : Math.pow(z,MANI.vExp);
// pins, trail heads and labels keep (almost) their size in the room while the terrain grows under them
const _sv = new THREE.Vector3();
function scaleManiMarkers(z,zy){
  const m = z<=1 ? 1 : Math.pow(z,MANI.markExp); _sv.set(m/z,m/zy,m/z);
  for (const q of maniPins) { if (!q.base) continue; const dy = (q.kind==='peak'?1:-1)*MANI.pinStem*m/zy;
    q.head.position.set(q.base.x,q.base.y+dy,q.base.z); q.glow.position.copy(q.head.position); q.hit.position.copy(q.head.position);
    q.head.scale.copy(_sv); q.glow.scale.set(MANI.pinHead*5*m/z,MANI.pinHead*5*m/zy,1); q.hit.scale.copy(_sv); q.foot.scale.copy(_sv);
    const pa = q.stem.geometry.attributes.position; pa.setXYZ(1,q.head.position.x,q.head.position.y,q.head.position.z); pa.needsUpdate = true; }
  const k = MANI_TRAIL.coin/COIN.dia;
  for (const t of maniTrails) { t.head.scale.set(_sv.x*k,_sv.y*k,_sv.z*k); t.hit.scale.copy(_sv);
    t.label.scale.set(MANI_TRAIL.label*m/z,MANI_TRAIL.label*48/128*m/zy,1); t.label.position.set(t.end.x,t.end.y+MANI_TRAIL.coin*.95*m/zy,t.end.z); }
}
const maniOut = () => state.maniOnTable || state.maniRoom;                // out of the window: on the table or around the user
const maniZoomMax = () => state.maniRoom ? MANI.zoomRoom : state.maniOnTable ? MANI.zoomTable : MANI.zoom[1];
function applyManiPose(){ const z = state.maniZoom = Math.max(MANI.zoom[0],Math.min(maniZoomMax(),state.maniZoom||1));
  const zy = maniZY(z);
  maniTurn.rotation.set(0,0,0); maniTurn.rotateX(state.maniTilt ?? (maniOut() ? 0 : MANI.tilt)); maniTurn.rotateY(state.maniYaw||0); maniTurn.scale.set(z,zy,z);
  const foot = Math.min(mani.userData.lo||0,maniRawLo);                    // lowest of the surface and the ribbons (raw values dip below the smoothed surface)
  if (state.maniOnTable) mani.position.set(0,-foot*MANI.height*zy+MANI_T.lift,0);
  else if (state.maniRoom) mani.position.set(maniRoomAt.x,-foot*MANI.height*zy+MANI_ROOM.lift,maniRoomAt.z);   // its lowest point just above the floor
  scaleManiMarkers(z,zy);   // on the table its lowest point sits just above the grid
  layoutGrowNodes(); }

// ---- Manifold on the table: pulled out of the window into the room, a 2×2-cell hologram on the grid
// it arrives level; drag turns / tilts it, two hands zoom it, pinch its frame on the grid to move it cell by cell
const MANI_T = {n:2, lift:.015, frame:.035};                              // footprint in cells · gap above the grid · width of the move frame (m)
const maniDesk = new THREE.Group(); maniDesk.name = 'manifold on table'; maniDesk.visible = false; deskGrid.add(maniDesk);
const maniPads = [];
{ const w = MANI_T.n*DESK.cell, f = MANI_T.frame, sq = new THREE.BufferGeometry().setFromPoints([[-1,-1],[1,-1],[1,-1],[1,1],[1,1],[-1,1],[-1,1],[-1,-1]].map(([x,z])=>new THREE.Vector3(x*w/2,.003,z*w/2)));
  maniDesk.add(new THREE.LineSegments(sq,new THREE.LineBasicMaterial({color:C.pink,transparent:true,opacity:.5,toneMapped:false})));
  for (const [x,z,pw,pd] of [[0,-(w-f)/2,w,f],[0,(w-f)/2,w,f],[-(w-f)/2,0,f,w],[(w-f)/2,0,f,w]]) {     // invisible frame strips = move handle
    const m = new THREE.Mesh(new THREE.PlaneGeometry(pw,pd).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({visible:false}));
    m.position.set(x,.004,z); m.userData.kind = 'maniMove'; maniDesk.add(m); maniPads.push(m); } }
function layoutManiDesk(){ const n = MANI_T.n;
  state.maniI = clampI(state.maniI ?? 0,n,DESK.cols); state.maniJ = clampI(state.maniJ ?? DESK.rows-n,n,DESK.rows);
  maniDesk.position.set(cellCentre(state.maniI,n)-DESK_W/2,0,cellCentre(state.maniJ,n)-DESK_D/2); }
// ---- step inside: the terrain comes down to the floor and spreads out around the user, who stands at its centre and walks
// through it. It stays where it was laid down (the user walks, it doesn't follow). Out again → back where it came from.
const MANI_ROOM = {lift:.01};
const maniRoomAt = new THREE.Vector3();
let maniRoomFrom = null;                                                  // {table, zoom, yaw, tilt} to go back to
function maniToRoom(){
  if (!MANI_DATA || state.maniRoom) return;
  maniRoomFrom = {table:state.maniOnTable, zoom:state.maniZoom||1, yaw:state.maniYaw||0, tilt:state.maniTilt};
  state.maniOnTable = false; state.maniRoom = true; maniInfo(null);
  (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).getWorldPosition(maniRoomAt); maniRoomAt.y = 0;
  scene.add(mani); mani.rotation.set(0,0,0); state.maniTilt = 0; state.maniZoom = MANI.zoomRoom;
  setManiClip(false); applyManiPose(); dioCardP.dirty = true; maniCapP.dirty = true;
  toast('Inside the manifold · walk through it, touch a currency or its ribbon');
}
function maniFromRoom(){
  if (!state.maniRoom) return; state.maniRoom = false; maniInfo(null);
  const f = maniRoomFrom || {table:false,zoom:1,yaw:0,tilt:null}; state.maniZoom = f.zoom; state.maniYaw = f.yaw; state.maniTilt = f.tilt;
  f.table ? maniToTable() : maniToWindow();
}
function maniToTable(){
  state.maniOnTable = true; maniInfo(null); maniDesk.add(mani); mani.rotation.set(0,0,0); state.maniTilt = 0;
  layoutManiDesk(); setManiClip(false); applyManiPose(); dioCardP.dirty = true; maniCapP.dirty = true;
}
function maniToWindow(){
  state.maniOnTable = false; maniInfo(null); board.add(mani); mani.position.copy(maniWinPos); mani.rotation.set(0,0,0); state.maniTilt = null;
  state.maniZoom = Math.min(state.maniZoom||1,MANI.zoom[1]);                // back in the window: its own size limit
  setManiClip(true); applyManiPose(); dioCardP.dirty = true; maniCapP.dirty = true;
}
applyManiPose();
// turning: drag on a plane facing the window through the terrain's centre — sideways turns, up / down tilts
const maniPlane = new THREE.Plane(), maniHit = new THREE.Vector3(), maniN = new THREE.Vector3(), maniC = new THREE.Vector3(), maniInv = new THREE.Matrix4();
const maniX = new THREE.Vector3(), maniY = new THREE.Vector3(0,1,0), maniM = new THREE.Matrix4();
function maniSpinStart(s,point){
  mani.getWorldPosition(maniC);
  if (state.maniOnTable) {                                                // on the table: a level plane facing the viewer
    (renderer.xr.isPresenting ? renderer.xr.getCamera() : camera).getWorldPosition(maniN); maniN.sub(maniC); maniN.y = 0;
    if (maniN.lengthSq()<1e-6) maniN.set(0,0,1); maniN.normalize(); maniX.crossVectors(maniY,maniN);
    maniInv.copy(maniM.makeBasis(maniX,maniY,maniN).setPosition(maniC)).invert();
  } else { board.updateMatrixWorld(); maniN.set(0,0,1).transformDirection(board.matrixWorld); maniInv.copy(board.matrixWorld).invert(); }
  maniPlane.setFromNormalAndCoplanarPoint(maniN,maniC);
  const p0 = point.clone().applyMatrix4(maniInv);
  s.drag = {kind:'maniSpin',plane:maniPlane.clone(),inv:maniInv.clone(),p0,yaw0:state.maniYaw||0,tilt0:state.maniTilt ?? (state.maniOnTable ? 0 : MANI.tilt),
    k:state.maniOnTable ? MANI.spin : MANI.spin/(boardRoot.scale.x||1)};
}
function maniSpinUpdate(s,o,d){
  const dr = s.drag; raycaster.set(o,d); if (!raycaster.ray.intersectPlane(dr.plane,maniHit)) return;
  maniHit.applyMatrix4(dr.inv); const dx = maniHit.x-dr.p0.x, dy = maniHit.y-dr.p0.y, k = dr.k;
  state.maniYaw = dr.yaw0+dx*k; state.maniTilt = Math.max(-.2,Math.min(Math.PI/2,dr.tilt0-dy*k)); applyManiPose();
}
// two hands: while one hand turns it, pinch with the other and open / close the hands to zoom
const mz1 = new THREE.Vector3(), mz2 = new THREE.Vector3();
const pinchW = (s,out) => { const j = s.hand.joints; j['index-finger-tip'].getWorldPosition(mz1); j['thumb-tip'].getWorldPosition(out); return out.add(mz1).multiplyScalar(.5); };
function maniScaleStart(s){
  const other = sources.find(o=>o!==s && o.drag?.kind==='maniSpin' && o.hand); if (!other) return false;
  const j = s.hand?.joints; if (!j?.['index-finger-tip']?.visible || !j['thumb-tip']?.visible) return false;
  const d0 = pinchW(s,new THREE.Vector3()).distanceTo(pinchW(other,new THREE.Vector3())); if (d0<.02) return false;
  s.drag = {kind:'maniScale',other,d0,z0:state.maniZoom||1}; return true;
}
function maniScaleUpdate(s){
  const dr = s.drag, j = s.hand.joints;
  if (dr.other.drag?.kind!=='maniSpin' || !j['index-finger-tip']?.visible || !j['thumb-tip']?.visible) { s.drag = null; return; }
  const d = pinchW(s,new THREE.Vector3()).distanceTo(pinchW(dr.other,new THREE.Vector3()));
  state.maniZoom = dr.z0*d/dr.d0; applyManiPose();
}
// info pop-up. Peaks / pits (pins), a currency (its glowing head on the terrain) or any point of its ribbon can be touched:
// a thin line rises from the touched spot and the window opens at its top. In the window it sits on the glass beside the spot.
let maniOpen = null, maniOpenAt = 0;
const MANI_POP = {w:260, h:176, rise:.07, riseRoom:.32, lineT:.22, openT:.14, fill:.55, side:.45, seg:48, bar:84, barGap:14};   // fill: panel opacity · side: default offset sideways (× rise) so the line curves · bar: grab bar under the window (dp)   // rise: line length above the spot (m) · grow / open times (s)
const fmtFrame = i => { const d = new Date(MANI_DATA.frames[i].end), M = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  return `${String(d.getUTCDate()).padStart(2,'0')} ${M[d.getUTCMonth()]} ${String(d.getUTCHours()).padStart(2,'0')}:00`; };
const zs = v => `${v>=0?'+':'−'}${Math.abs(v).toFixed(2)} z`;
// nearest currencies on the behaviour plane in one frame = those moving most alike then
function alike(i,cur){ const P = MANI_DATA.frames[i].points, me = P[cur];
  return Object.entries(P).filter(([c])=>c!==cur).map(([c,p])=>[c,Math.hypot(p[0]-me[0],p[2]-me[2])]).sort((a,b)=>a[1]-b[1]).slice(0,3); }
function maniTouch(hit){
  const tr = hit.object.userData.trail; setCurrency(tr.cur);
  if (hit.kind==='maniUnit') { maniInfo({kind:'unit',key:'u'+tr.cur,tr,frame:tr.frames[tr.frames.length-1],local:tr.end.clone()}); return; }
  const p = maniTurn.worldToLocal(hit.point.clone()); let best = 0, bd = Infinity;          // nearest point of the path → its frame
  tr.sm.forEach((q,k)=>{ const d = q.distanceToSquared(p); if (d<bd) { bd = d; best = k; } });
  const fi = tr.frames[Math.min(tr.frames.length-1,Math.round(best/MANI_TRAIL.sub))];
  maniInfo({kind:'point',key:'p'+tr.cur+fi,tr,frame:fi,local:tr.sm[best].clone()});
}
const maniPopP = panel({name:'manifold info',x:0,y:0,w:MANI_POP.w,h:MANI_POP.h,margin:16,z:.02,draw(ctx,p){
  const o = maniOpen; if (!o) return; const W = MANI_POP.w, H = MANI_POP.h;
  ctx.save(); ctx.shadowColor = C.pink; ctx.shadowBlur = 10; rr(ctx,0,0,W,H,18); ctx.fillStyle = `rgba(30,27,58,${MANI_POP.fill})`; ctx.fill(); ctx.restore();
  rr(ctx,0,0,W,H,18); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(231,168,240,.75)'; ctx.stroke();
  const hot = p.hover==='close'; drawIcon(ctx,'x-circle',hot?C.pink:C.muted,W-24,24,20);
  p.region('close',W-48,0,48,48,()=>maniInfo(null));
  if (o.kind==='peak' || o.kind==='pit') {
    drawIcon(ctx,o.kind==='peak'?'caret-up':'caret-down',C.coral,24,24,16);
    text(ctx,o.kind==='peak'?'PEAK':'PIT',38,25,{font:'800 13px Manrope',color:C.ink,ls:'.5px'});
    text(ctx,'MEAN STRENGTH',18,58,{font:'800 10px Manrope',color:C.muted,ls:'.5px'});
    text(ctx,zs(o.est.mean),18,83,{font:'600 22px "Kode Mono"',color:C.ink});
    text(ctx,`± ${o.est.disp.toFixed(2)} · ${o.est.n} samples`,18,105,{font:'400 11px "Kode Mono"',color:C.dim});
    text(ctx,'GATHERED HERE',18,132,{font:'800 10px Manrope',color:C.muted,ls:'.5px'});
    o.share.filter(([,sh])=>sh>=.01).slice(0,3).forEach(([cur,sh],i)=>{ const x = 18+i*78;
      text(ctx,cur,x,157,{font:'800 13px Manrope',color:i?C.ink:C.pink}); text(ctx,Math.round(sh*100)+'%',x+34,157.5,{font:'400 11px "Kode Mono"',color:C.dim}); });
    return;
  }
  // a currency: latest state (head) or one moment of its path (ribbon)
  const {tr,frame} = o, P = MANI_DATA.frames[frame].points[tr.cur], col = CUR_COL[tr.cur]||C.ink;
  ctx.beginPath(); ctx.arc(24,24,5,0,Math.PI*2); ctx.fillStyle = col; ctx.fill();
  text(ctx,tr.cur,36,25,{font:'800 15px Manrope',color:C.ink,ls:'.5px'});
  text(ctx,o.kind==='unit'?'LATEST · '+fmtFrame(frame):fmtFrame(frame),W-48,25,{font:'400 11px "Kode Mono"',color:C.muted,align:'right'});
  text(ctx,'STRENGTH',18,58,{font:'800 10px Manrope',color:C.muted,ls:'.5px'});
  text(ctx,zs(P[1]),18,83,{font:'600 22px "Kode Mono"',color:P[1]>=0?C.ink:C.coral});
  const ys = tr.frames.map(i=>MANI_DATA.frames[i].points[tr.cur][1]), first = ys[0];
  if (o.kind==='unit') text(ctx,`since ${fmtFrame(tr.frames[0]).slice(0,6)} ${zs(P[1]-first)} · range ${Math.min(...ys).toFixed(1)} … ${Math.max(...ys).toFixed(1)}`,18,105,{font:'400 11px "Kode Mono"',color:C.dim});
  else text(ctx,`step ${tr.frames.indexOf(frame)+1} / ${tr.frames.length} · now ${zs(ys[ys.length-1])}`,18,105,{font:'400 11px "Kode Mono"',color:C.dim});
  text(ctx,'MOVING ALIKE',18,132,{font:'800 10px Manrope',color:C.muted,ls:'.5px'});
  alike(frame,tr.cur).forEach(([c,d],i)=>{ const x = 18+i*78;
    text(ctx,c,x,157,{font:'800 13px Manrope',color:CUR_COL[c]||C.ink}); text(ctx,d.toFixed(1),x+34,157.5,{font:'400 11px "Kode Mono"',color:C.dim}); });
}});
maniPopP.mesh.visible = false;
// the rising line, and a small ring where it starts
const leadLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({length:MANI_POP.seg+1},()=>new THREE.Vector3())),
  new THREE.LineBasicMaterial({color:C.pink,transparent:true,opacity:.85,depthWrite:false,toneMapped:false}));
leadLine.frustumCulled = false; leadLine.visible = false; leadLine.renderOrder = 5; scene.add(leadLine);
const leadDot = new THREE.Mesh(new THREE.RingGeometry(.004,.0065,24).rotateX(-Math.PI/2),
  new THREE.MeshBasicMaterial({color:C.pink,transparent:true,opacity:.9,side:THREE.DoubleSide,depthWrite:false,toneMapped:false}));
leadDot.visible = false; leadDot.renderOrder = 5; scene.add(leadDot);
// grab bar under the window (out in the room): pinch it and put the window anywhere — the line stretches after it
const popBar = new THREE.Group(); popBar.position.y = -(MANI_POP.h/2+MANI_POP.barGap)*S; maniPopP.mesh.add(popBar);
{ const w = MANI_POP.bar*S, h = 7*S, r = h/2, sh = new THREE.Shape();
  sh.moveTo(-w/2+r,-h/2); sh.lineTo(w/2-r,-h/2); sh.absarc(w/2-r,0,r,-Math.PI/2,Math.PI/2); sh.lineTo(-w/2+r,h/2); sh.absarc(-w/2+r,0,r,Math.PI/2,Math.PI*1.5);
  const bar = new THREE.Mesh(new THREE.ShapeGeometry(sh,12),new THREE.MeshBasicMaterial({color:'#efe6ff',transparent:true,opacity:.55,depthWrite:false,toneMapped:false}));
  popBar.add(bar); popBar.userData.bar = bar;
  const hit = new THREE.Mesh(new THREE.PlaneGeometry(w*1.6,h*6),new THREE.MeshBasicMaterial({visible:false})); hit.userData.kind = 'maniPopMove'; popBar.add(hit); popBar.userData.hit = hit; }
const _pm = new THREE.Vector3();
function popMoveStart(s,hit){ maniPopP.mesh.getWorldPosition(_pm); s.drag = {kind:'maniPopMove',dist:hit.distance,off:_pm.sub(hit.point).clone()}; }
function popMoveUpdate(s,o,d){ if (!maniOpen) { s.drag = null; return; }
  maniOpen.pos = (maniOpen.pos || new THREE.Vector3()).copy(o).addScaledVector(d,s.drag.dist).add(s.drag.off); }
function maniInfo(o){
  maniOpen = (maniOpen && o && (maniOpen===o || (maniOpen.key && maniOpen.key===o.key))) ? null : o;
  maniOpenAt = performance.now(); maniPopP.mesh.visible = false; maniPopP.dirty = true;
  leadLine.visible = leadDot.visible = !!maniOpen;
  const home = maniOut() ? scene : board; if (maniPopP.mesh.parent!==home) home.add(maniPopP.mesh);   // out of the window it floats in the room
  scaleManiMarkers(state.maniZoom||1,maniZY(state.maniZoom||1));
  for (const q of maniPins) { const on = q===maniOpen; if (on) q.head.scale.multiplyScalar(1.5); q.glow.material.opacity = on?1:.7; }
}
const popW = new THREE.Vector3(), popA = new THREE.Vector3(), popT = new THREE.Vector3(), popC = new THREE.Vector3(), popS = new THREE.Vector3();
const L0 = new THREE.Vector3(), L1 = new THREE.Vector3(), L2 = new THREE.Vector3(), L3 = new THREE.Vector3(), LP = new THREE.Vector3();
const anchorOf = (o,out) => o.head ? o.head.getWorldPosition(out) : maniTurn.localToWorld(out.copy(o.local));
function updateManifold(t,visible){
  mani.visible = visible;
  if (!visible) { if (maniOpen) maniInfo(null); return; }
  if (MANI_DATA) { const L = maniLevelFor(maniWorldR()); if (L!==maniLevel) setManiLevel(L); }
  trailUni.uTime.value = t;
  for (const tr of maniTrails) { const on = tr.cur===state.currency ? 1 : 0; tr.mat.uniforms.uSel.value += (on-tr.mat.uniforms.uSel.value)*.15;
    tr.spin.rotation.y = t*COIN.spin+tr.phase;                                 // the coin turns like the others
    const beat = 1-HALO.breath+HALO.breath*(.5+.5*Math.sin(t*2*Math.PI/HALO.period+tr.phase)), u = tr.rim.material.uniforms;   // glass rim breathes, up / down tint
    u.uColor.value.copy(tr.z>=0?UP:DOWN).lerp(PINK,.2).lerp(WHITE,ROOM.haloLight); u.uStrength.value = HALO.rim*beat*ROOM.haloRim*(on?1.35:.85); }
  updateManiLinks(t);
  if (growNodes.visible) for (const n of growList) n.glow.material.opacity = .5+.3*Math.sin(t*2.2+n.a);
  for (const q of maniPins) if (q!==maniOpen) q.glow.material.opacity = .55+.25*Math.sin(t*2+q.x);
  if (maniOpen) {
    const el = (performance.now()-maniOpenAt)/1000, grow = Math.min(1,el/MANI_POP.lineT), ease = 1-(1-grow)**3;
    anchorOf(maniOpen,popA); leadDot.position.copy(popA); leadDot.position.y += .001;
    popBar.visible = maniOut();
    if (maniOut()) {                                                          // in the room: up and a little aside from the spot (or where the user put it), turned to the viewer
      const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera; cam.getWorldPosition(popC);
      if (maniOpen.pos) maniPopP.mesh.position.copy(maniOpen.pos);
      else { const rise = state.maniRoom ? MANI_POP.riseRoom : MANI_POP.rise;
        popS.set(popC.z-popA.z,0,popA.x-popC.x); if (popS.lengthSq()<1e-6) popS.set(1,0,0); popS.normalize().multiplyScalar(-rise*MANI_POP.side);   // to the viewer's right
        maniPopP.mesh.position.copy(popA).add(popS); maniPopP.mesh.position.y += rise+(MANI_POP.h/2+MANI_POP.barGap)*S; }
      popC.y = maniPopP.mesh.position.y; maniPopP.mesh.lookAt(popC);
      popBar.getWorldPosition(popT);                                          // the line arrives at the grab bar
    } else {                                                                  // in the window: beside the spot on the glass, the line runs to its corner
      popW.copy(popA); board.worldToLocal(popW);
      const half = MANI_POP.w/2*S, side = popW.x>(WIN.x+WIN.w/2-BW/2)*S ? -1 : 1;
      maniPopP.mesh.position.set(popW.x+side*(half+.012),popW.y+MANI_POP.h/2*S+.012,.02);
      popT.set(popW.x+side*.012,popW.y+.012,.02); board.localToWorld(popT);
    }
    // a soft curve: leaves the spot straight up, arrives at the window straight from below (cubic Bezier), stretches as it moves
    const dy = Math.abs(popT.y-popA.y), dh = Math.hypot(popT.x-popA.x,popT.z-popA.z);
    L0.copy(popA); L3.copy(popT); L1.copy(L0); L1.y += .55*dy+.35*dh; L2.copy(L3); L2.y -= .35*dy+.25*dh;
    const pa = leadLine.geometry.attributes.position, N = MANI_POP.seg;
    for (let j=0;j<=N;j++) { cub(j/N,L0,L1,L2,L3,LP); pa.setXYZ(j,LP.x,LP.y,LP.z); }
    pa.needsUpdate = true; leadLine.geometry.setDrawRange(0,Math.max(2,Math.ceil(ease*N)+1));
    const op = Math.max(0,Math.min(1,(el-MANI_POP.lineT)/MANI_POP.openT));   // the window opens once the line has arrived
    maniPopP.mesh.visible = op>0; maniPopP.mesh.scale.setScalar(.75+.25*(1-(1-op)**3));
  }
}
// a quiet caption at the window's bottom-left: this is old data
const maniCapP = panel({name:'manifold caption',x:WIN.x+14,y:WIN.y+WIN.h-40,w:430,h:26,margin:8,z:.012,draw(ctx){
  rr(ctx,0,0,430,26,13); ctx.fillStyle = 'rgba(35,32,66,.85)'; ctx.fill();
  text(ctx,(state.maniRoom?'AROUND YOU · ':state.maniOnTable?'ON THE TABLE · ':'')+'CONCEPT · OLD DATA · 5H · 03 SEP – 19 OCT 2026',215,14,{font:'400 11px "Kode Mono"',color:C.muted,align:'center'});
}});
maniCapP.mesh.visible = false;
if (MANI_DATA) setManiLevel(0);
if (state.maniOnTable && MANI_DATA) maniToTable(); else state.maniOnTable = false;
if (state.roomOn) { roomRestore(); pauseP.mesh.visible = true; }

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
  } else {
    boardRoot.position.copy(head).addScaledVector(dir,1.15); boardRoot.position.y = head.y-.1;
  }
  const [turn,tilt] = state.boardRot || [0,0];                            // angles the joystick last left it at
  boardRoot.rotation.set(0,0,0); boardRoot.rotateY(yaw+turn); boardRoot.rotateX((state.desk?-Math.PI*.3:0)+tilt);
  const [r,u,f] = state.boardOff || [0,0,0];                             // where the joystick last left it
  boardRoot.position.add(new THREE.Vector3(-dir.z,0,dir.x).multiplyScalar(r)).addScaledVector(dir,f); boardRoot.position.y += u;
}

// ---------------------------------------------------------------- input: pinch-ray, poke, mouse
const raycaster = new THREE.Raycaster();
const holePanels = new Set(['board','drop CHARTS','diorama card']);
function targets(){ const list = []; for (const p of panels) if (p.mesh.visible && p.mesh.parent.visible) list.push(p.mesh);
  if (state.dioOnTable && dio.visible) { list.push(itemPad,rotRing.userData.hit); for (const c of corners) list.push(c.hit); }
  if (deskGrid.visible && !state.gridOff) { list.push(...gridFrame); for (const n of sizeNodes) list.push(n.hit);
    if (state.gridEdit) { list.push(cellPad,...blockHits); if (extHandle.visible) list.push(extHandle.userData.hit); } }
  if (dio.visible && (board.visible || state.dioOnTable)) for (const m of marbles) list.push(m.hit);
  if (orbitRoot.visible && state.roomOn) for (const rc of roomCoins) if (!rc.held) list.push(rc.hit);
  if (mani.visible && (board.visible || maniOut()) && mani.userData.grab) { if (!state.maniRoom) list.push(mani.userData.grab); for (const q of maniPins) list.push(q.hit);
    for (const tr of maniTrails) list.push(tr.hit,tr.ribbon);
    if (maniPopP.mesh.visible && popBar.visible) list.push(popBar.userData.hit); if (state.maniOnTable) { list.push(...maniPads); for (const n of growList) list.push(n.hit); } }
  return list; }
// far grabbing: a thin ray easily slips past a small node or a coin a few metres away. When the ray finds nothing it can use
// (empty space, a bare panel surface, the grid floor), the nearest grabbable thing within a few degrees of it is taken instead.
const ASSIST = {deg:4, min:.45};                                         // cone half-angle · not for things closer than this (m)
const _ap = new THREE.Vector3();
function assistPick(origin,dir,maxDist){
  let best = null, bestA = ASSIST.deg*Math.PI/180;
  for (const o of targets()) { const u = o.userData, k = u.kind;
    if (!(u.roomCoin || k==='gridResize' || k==='gridExtrude' || k==='dioScale' || k==='maniGrow' || k==='maniUnit')) continue;   // coins in the room, grid / table handles
    o.getWorldPosition(_ap); const v = _ap.clone().sub(origin), d = v.length();
    if (d<ASSIST.min || d>maxDist) continue;
    const a = v.angleTo(dir); if (a<bestA) { bestA = a; best = {o,d,p:_ap.clone()}; } }
  if (!best) return null; const u = best.o.userData;
  if (u.roomCoin) return {roomCoin:u.roomCoin,point:best.p,distance:best.d};
  return {kind:u.kind,object:best.o,point:best.p,distance:best.d};
}
function pick(origin,dir){
  const hit = pickRaw(origin,dir);
  const weak = !hit || (hit.panel && !hit.region) || hit.kind==='gridMove' || hit.kind==='gridCell';
  if (!weak) return hit;
  return assistPick(origin,dir,hit ? hit.distance : 6) || hit;
}
function pickRaw(origin,dir){
  raycaster.set(origin,dir); raycaster.far = 6;
  const hits = raycaster.intersectObjects(targets(),false);
  for (const h of hits) {
    if (h.object.userData.kind==='gridMove') {                           // the grid's invisible edge must not swallow the bar or the joystick behind it
      const f = hits.find(o=>o.object.parent===fixed && o.object.userData.panel?.hit(o.uv).region);
      if (f) { const p = f.object.userData.panel, {region} = p.hit(f.uv); return {panel:p,region,point:f.point,distance:f.distance}; } }
    if (h.object.userData.roomCoin) return {roomCoin:h.object.userData.roomCoin,point:h.point,distance:h.distance};
    if (h.object.userData.currency) return {currency:h.object.userData.currency,point:h.point,distance:h.distance};
    if (h.object.userData.kind==='maniSpin') {                           // a pin, a currency or its ribbon inside the grab volume wins
      for (const k of ['maniPin','maniUnit','maniTrail']) { const q = hits.find(o=>o.object.userData.kind===k);
        if (q) return {kind:k,object:q.object,point:q.point,distance:q.distance}; } }
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
  if (roomHandGrab(source)) return;                                      // pinch right at a coin in the room
  if (source.hand && maniScaleStart(source)) return;                      // second hand while the first turns the manifold
  if (source.hand && state.dioOnTable && !state.hidden && pinchScaleStart(source)) return;    // second hand while the first holds
  if ((hit?.kind==='dioScale' || hit?.kind==='dioRotate' || hit?.kind==='gridMove' || hit?.kind==='gridResize' || hit?.kind==='gridExtrude' || hit?.kind==='maniGrow') && hit.distance<.15) { dragStart(source,hit); return; }   // a handle right at the fingers wins over the body grab
  if (source.hand && state.dioOnTable && !state.hidden && handGrabStart(source)) return;
  if (!hit) return;
  if (hit.roomCoin) { roomRayGrab(source,hit); return; }
  if (hit.currency) { setCurrency(hit.currency); return; }
  if (hit.kind==='maniPin') { maniInfo(hit.object.userData.pin); return; }
  if (hit.kind==='maniUnit' || hit.kind==='maniTrail') { maniTouch(hit); return; }
  if (hit.kind==='maniGrow') { maniGrowStart(source,hit); return; }
  if (hit.kind==='maniPopMove') { popMoveStart(source,hit); return; }
  if (hit.kind==='maniSpin') { maniSpinStart(source,hit.point); return; }
  if (hit.kind==='maniMove') { source.drag = {kind:'maniMove'}; return; }
  if (hit.kind) { dragStart(source,hit); return; }
  if (hit.panel===stickP && (hit.region?.id==='pad' || hit.region?.id==='lift')) { stickStart(source,hit.region.id); return; }
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
  renderer.domElement.style.cursor = mouse.drag ? 'grabbing' : mouse.hit?.kind ? 'grab' : mouse.hit?.roomCoin ? 'grab' : mouse.hit?.region||mouse.hit?.currency ? 'pointer' : ''; });
renderer.domElement.addEventListener('pointerdown',e=>{ mouse.hit = mousePick(e); if (mouse.hit?.region||mouse.hit?.currency||mouse.hit?.kind||mouse.hit?.roomCoin) { orbit.enabled = false; press(mouse,mouse.hit); } });
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
    if (s.drag?.kind==='stick' && s.drag.poke) {                          // finger on the joystick: follow the fingertip until it lifts off
      local.copy(tipPos).applyMatrix4(s.drag.inv);
      if (local.z>.03) dragEnd(s); else { stickFromLocal(s.drag,local); s.tip.visible = true; continue; } }
    let best = null;
    for (const m of marbles) if ((board.visible||state.dioOnTable) && dio.visible && m.hit.getWorldPosition(local).distanceTo(tipPos)<.022) best = {currency:m.cur,touch:true};
    if (!best && mani.visible && (board.visible || state.maniOnTable)) for (const q of maniPins) if (q.head.getWorldPosition(local).distanceTo(tipPos)<.02) best = {maniPin:q,touch:true};
    if (!best) for (const p of panels) {
      if (!p.mesh.visible || !p.mesh.parent.visible || !p.regions.length || p.name==='toast') continue;
      p.mesh.worldToLocal(local.copy(tipPos));
      const d = local.z*(p.mesh.parent.parent===boardRoot ? boardRoot.scale.x : 1), lx = local.x/S+p.w/2, ly = p.h/2-(local.y/S);
      if (lx<0||ly<0||lx>p.w||ly>p.h||d>.05||d<-.03) continue;
      const region = p.regions.findLast(r=>lx>=r.x&&lx<=r.x+r.w&&ly>=r.y&&ly<=r.y+r.h);
      if (region) { best = {panel:p,region,touch:d<.008}; break; }
    }
    s.tip.visible = !!best;
    setHover(s,best?.panel ? best : (active ? s.hit : null));
    if (best?.touch && !s.poke.latched) {
      s.poke.latched = true;
      if (best.panel===stickP && (best.region.id==='pad' || best.region.id==='lift')) { stickStart(s,best.region.id); s.drag.poke = true; continue; }
      if (best.currency) setCurrency(best.currency);
      else if (best.maniPin) maniInfo(best.maniPin);
      else { const bp = best.panel; bp.press = best.region.id; bp.dirty = true; best.region.onTap(); setTimeout(()=>{ bp.press = null; bp.dirty = true; },180); }
    }
    if (!best?.touch) s.poke.latched = false;
  }
}

// ---------------------------------------------------------------- session
let needsPlace = 0;
renderer.xr.addEventListener('sessionstart',()=>{ scene.background = null; renderer.setClearAlpha(0); needsPlace = 12; orbitSnap = true;
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
let lastT = null;
renderer.setAnimationLoop((now,frame)=>{
  const t = now/1000;
  fpsTick(now);
  if (needsPlace && renderer.xr.isPresenting && --needsPlace===0) { place(); placeGrid(); }
  updateXRInput();
  updateStick(Math.min(.1,t-(lastT ?? t))); lastT = t;
  updateDiorama(t);
  updateDesk(t,frame);
  updateRoomOrbit(t);
  // diorama in the window only while the board hides its box; on the table it is always there and the window shows the 2D view
  const folded = state.roomOn && state.roomMin;
  board.visible = !state.hidden && !folded; fixed.visible = !folded; widgetGroup.visible = folded;
  const wSeen = windowSeen(), seen = state.dioOnTable || wSeen, maniView = state.winView==='manifold';
  winBox.visible = wSeen && (!state.dioOnTable || maniView); winTank.visible = !maniView; viewPlane.visible = state.dioOnTable && !maniView;
  dio.visible = !state.hidden && seen && (state.dioOnTable || !maniView); deskItem.visible = state.dioOnTable && !state.hidden;
  maniDesk.visible = state.maniOnTable && !state.hidden;
  updateManifold(t,!state.hidden && !!MANI_DATA && (maniOut() || (maniView && wSeen))); maniCapP.mesh.visible = maniView && !!MANI_DATA;
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
