import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = id => document.getElementById(id);
const finite = v => Number.isFinite(Number(v));
const clamp = (v,a,b) => Math.max(a, Math.min(b,v));
const API = `${location.protocol === 'file:' ? 'http:' : location.protocol}//${location.hostname || '127.0.0.1'}:8000`;

const LABEL = {
  temperature: 'Temperature',
  temperature_anomaly: 'Sea surface temperature anomaly',
  salinity: 'Salinity',
  currents: 'Currents',
  sea_level: 'Sea level',
  chlorophyll: 'Chlorophyll'
};

const S = {
  scene:null, camera:null, renderer:null, controls:null, root:null,
  geometry:null, catalog:[], times:[], ti:0, active:'temperature',
  land:null, landSide:null, landBottom:null, coast:null, seabed:null,
  water:null, waterPick:null, depthEx:10, request:0, playing:false,
  lastPlay:0, ray:new THREE.Raycaster(), mouse:new THREE.Vector2()
};

async function get(path){
  const r = await fetch(API + path, {cache:'no-store'});
  if(!r.ok) throw Error(`${r.status} ${await r.text()}`);
  return r.json();
}
async function getStatic(path){
  const r = await fetch(path, {cache:'no-store'});
  if(!r.ok) throw Error(`${r.status} ${await r.text()}`);
  return r.json();
}
function status(t,type='ok'){
  if($('status')) $('status').textContent=t;
  if($('statusDot')) $('statusDot').className=type==='error'?'error':type==='busy'?'busy':'';
}
function fail(e){
  console.error(e);
  $('loading')?.classList.add('hidden');
  if($('fatalText')) $('fatalText').textContent=e?.message||String(e);
  $('fatal')?.classList.add('show');
  status(`Viewer failed · ${e?.message||e}`,'error');
}
function dispose(o){
  if(!o)return;
  o.traverse(x=>{
    if(x.geometry) x.geometry.dispose();
    if(x.material){
      if(Array.isArray(x.material)) x.material.forEach(m=>m.dispose());
      else x.material.dispose();
    }
  });
  o.parent?.remove(o);
}
function project(lon,lat){
  const b=S.geometry?.bounds || [84,93,16,24];
  const midLat=(b[2]+b[3])/2;
  const klat=111.32;
  const klon=111.32*Math.cos(midLat*Math.PI/180);
  const midLon=(b[0]+b[1])/2;
  return [(Number(lon)-midLon)*klon,(Number(lat)-midLat)*klat];
}
function depthY(depthM){return -Math.max(0,Number(depthM))*S.depthEx/1000;}
function cellBounds(a,i){
  if(a.length===1) return [a[i]-.025,a[i]+.025];
  if(i===0) return [a[0]-(a[1]-a[0])/2,(a[0]+a[1])/2];
  if(i===a.length-1) return [(a[i-1]+a[i])/2,a[i]+(a[i]-a[i-1])/2];
  return [(a[i-1]+a[i])/2,(a[i]+a[i+1])/2];
}
function terrainDepthAt(lon,lat){
  const t=S.geometry?.terrain;
  if(!t?.x?.length || !t?.y?.length) return 0;
  const p=project(lon,lat), nx=t.x.length, ny=t.y.length;
  const ix=clamp(Math.round((p[0]-t.x[0])/((t.x[nx-1]-t.x[0])||1)*(nx-1)),0,nx-1);
  const iy=clamp(Math.round((p[1]-t.y[0])/((t.y[ny-1]-t.y[0])||1)*(ny-1)),0,ny-1);
  const d=Number((t.rawDepthKm[iy]||[])[ix]);
  return finite(d) ? Math.max(0,d*1000) : 0;
}
function lineGeometry(parts,y=0){
  const p=[];
  for(const l of parts||[]){
    for(let i=0;i<l.length-1;i++) p.push(+l[i][0],y,+l[i][1],+l[i+1][0],y,+l[i+1][1]);
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  return g;
}
function polygonGeometry(parts,y=0){
  const p=[],idx=[]; let base=0;
  for(const part of parts||[]){
    for(const v of part.vertices||[]) p.push(Number(v[0]),y,Number(v[1]));
    for(const t of part.triangles||[]) idx.push(base+t[0],base+t[1],base+t[2]);
    base+=(part.vertices||[]).length;
  }
  const g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function drawLand(){
  dispose(S.land); dispose(S.landSide); dispose(S.landBottom);
  const g=S.geometry;
  if(!g) return;
  const parts=[...(g.land||[]),...(g.islands||[])];
  const topY=.18;
  const thickness=Math.max(1.5,Number(g.landThickness||3)*S.depthEx/1000);
  const bottomY=topY-thickness;

  S.land=new THREE.Mesh(
    polygonGeometry(parts,topY),
    new THREE.MeshStandardMaterial({color:0x4d9a4d,roughness:.92,metalness:0,side:THREE.DoubleSide})
  );
  S.land.renderOrder=50;
  S.root.add(S.land);

  const sidePos=[],sideIdx=[],bottomParts=[];
  let q=0;
  for(const part of parts){
    const ring=part.top||[];
    if(ring.length<2) continue;
    for(let i=0;i<ring.length-1;i++){
      const a=ring[i],b=ring[i+1],base=sidePos.length/3;
      sidePos.push(a[0],topY,a[1], a[0],bottomY,a[1], b[0],topY,b[1], b[0],bottomY,b[1]);
      sideIdx.push(base,base+2,base+1, base+2,base+3,base+1);
    }
    if(part.vertices?.length && part.triangles?.length) bottomParts.push(part);
  }
  const sg=new THREE.BufferGeometry();
  sg.setAttribute('position',new THREE.Float32BufferAttribute(sidePos,3));
  sg.setIndex(sideIdx); sg.computeVertexNormals();
  S.landSide=new THREE.Mesh(sg,new THREE.MeshStandardMaterial({color:0x76502f,roughness:1,side:THREE.DoubleSide}));
  S.landSide.renderOrder=45; S.root.add(S.landSide);

  S.landBottom=new THREE.Mesh(
    polygonGeometry(bottomParts,bottomY),
    new THREE.MeshStandardMaterial({color:0x5a3b27,roughness:1,side:THREE.DoubleSide})
  );
  S.landBottom.renderOrder=44; S.root.add(S.landBottom);
}

function drawCoast(){
  dispose(S.coast);
  const g=S.geometry;
  const geo=lineGeometry([...(g.coast||[]),...(g.landBoundary||[]),...(g.islandCoast||[])],.24);
  S.coast=new THREE.LineSegments(geo,new THREE.LineBasicMaterial({color:0x102e20}));
  S.coast.renderOrder=70; S.root.add(S.coast);
}

function drawSeabed(){
  dispose(S.seabed);
  const t=S.geometry?.terrain;
  if(!t?.x?.length || !t?.y?.length) return;
  const nx=t.x.length,ny=t.y.length,pos=[],idx=[],map=new Int32Array(nx*ny); map.fill(-1);
  for(let j=0;j<ny;j++) for(let i=0;i<nx;i++){
    const d=Number((t.rawDepthKm[j]||[])[i]);
    if(!finite(d)) continue;
    map[j*nx+i]=pos.length/3;
    pos.push(t.x[i],depthY(d*1000),t.y[j]);
  }
  for(let j=0;j<ny-1;j++) for(let i=0;i<nx-1;i++){
    const a=map[j*nx+i],b=map[j*nx+i+1],c=map[(j+1)*nx+i],d=map[(j+1)*nx+i+1];
    if(a>=0&&b>=0&&c>=0&&d>=0) idx.push(a,c,b,b,c,d);
  }
  const geo=new THREE.BufferGeometry();
  geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));
  geo.setIndex(idx); geo.computeVertexNormals();
  S.seabed=new THREE.Mesh(geo,new THREE.MeshStandardMaterial({color:0x79502d,roughness:.97,metalness:0,side:THREE.DoubleSide}));
  S.seabed.renderOrder=5; S.root.add(S.seabed);
}

function buildWater(){
  dispose(S.water);
  S.water=new THREE.Group();
  const t=S.geometry?.terrain;
  if(!t?.x?.length || !t?.y?.length) return;
  const nx=t.x.length,ny=t.y.length,raw=t.rawDepthKm;
  const total=nx*ny;
  const step=Math.max(1,Math.ceil(Math.sqrt(total/18000)));
  const cells=[];
  for(let j=0;j<ny-1;j+=step){
    for(let i=0;i<nx-1;i+=step){
      const ds=[];
      for(let yy=j;yy<=Math.min(j+step,ny-1);yy+=Math.max(1,Math.floor(step/2))){
        for(let xx=i;xx<=Math.min(i+step,nx-1);xx+=Math.max(1,Math.floor(step/2))){
          const d=Number((raw[yy]||[])[xx]); if(finite(d)) ds.push(d);
        }
      }
      if(!ds.length) continue;
      const depthKm=Math.max(...ds);
      if(!(depthKm>0.002)) continue;
      const i2=Math.min(i+step,nx-1),j2=Math.min(j+step,ny-1);
      const x0=t.x[i],x1=t.x[i2],z0=t.y[j],z1=t.y[j2];
      const centerDepth=terrainDepthAt(
        (S.geometry.bounds[0]+S.geometry.bounds[1])/2 + ((x0+x1)/2)/(111.32*Math.cos(((S.geometry.bounds[2]+S.geometry.bounds[3])/2)*Math.PI/180)),
        (S.geometry.bounds[2]+S.geometry.bounds[3])/2 + ((z0+z1)/2)/111.32
      );
      const depthM=Math.max(0.5,centerDepth||depthKm*1000);
      cells.push({x:(x0+x1)/2,z:(z0+z1)/2,sx:Math.max(.1,x1-x0)*.99,sz:Math.max(.1,z1-z0)*.99,depth:depthM});
    }
  }
  if(!cells.length) return;
  const box=new THREE.BoxGeometry(1,1,1);
  const mat=new THREE.MeshPhysicalMaterial({color:0x238db7,transparent:true,opacity:.25,roughness:.2,metalness:0,transmission:.08,ior:1.333,depthWrite:false,side:THREE.DoubleSide});
  const mesh=new THREE.InstancedMesh(box,mat,cells.length);
  const dummy=new THREE.Object3D();
  for(let i=0;i<cells.length;i++){
    const c=cells[i];
    const h=Math.abs(depthY(c.depth));
    dummy.position.set(c.x,-h/2,c.z);
    dummy.scale.set(c.sx,Math.max(.1,h),c.sz);
    dummy.updateMatrix(); mesh.setMatrixAt(i,dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate=true;
  mesh.userData={cells,isWater:true};
  mesh.renderOrder=20;
  thisWaterMesh=mesh;
  S.water.add(mesh);
  box.dispose();
  S.root.add(S.water);
}
let thisWaterMesh=null;

function drawWaterSurface(){
  if(!S.geometry?.bounds) return;
  const b=S.geometry.bounds;
  const W=(b[1]-b[0])*111.32*Math.cos(((b[2]+b[3])/2)*Math.PI/180);
  const H=(b[3]-b[2])*111.32;
  const g=new THREE.PlaneGeometry(W,H,80,60);
  g.rotateX(-Math.PI/2);
  const m=new THREE.MeshPhysicalMaterial({color:0x2d9bc1,transparent:true,opacity:.12,roughness:.12,metalness:0,transmission:.12,ior:1.333,depthWrite:false,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(g,m); mesh.position.y=.30; mesh.renderOrder=60; mesh.userData.surface=true;
  S.root.add(mesh);
}

function renderVariableButtons(){
  const host=$('vars'); if(!host)return;
  host.innerHTML='';
  for(const x of S.catalog){
    const b=document.createElement('button');
    b.className=`var ${x.id===S.active?'active':''} ${x.available===false?'off':''}`;
    b.dataset.field=x.id; b.disabled=x.available===false;
    const icon=x.id==='temperature'?'T':x.id==='temperature_anomaly'?'∆':x.id==='salinity'?'S':x.id==='currents'?'C':x.id==='sea_level'?'η':'Ch';
    b.innerHTML=`<span class="vicon">${icon}</span><span><b>${x.label||LABEL[x.id]||x.id}</b><small>${x.units||'—'}</small></span><span class="dot"></span>`;
    host.appendChild(b);
  }
}

function fmt(v,unit=''){
  return finite(v) ? `${Number(v).toFixed(Math.abs(Number(v))<1?4:2)} ${unit}` : '—';
}
function openReadout(p,lon,lat){
  const panel=$('readout'); if(!panel)return;
  const v=p?.values||p||{};
  const rows=[
    ['Latitude',lat,'°'],['Longitude',lon,'°'],
    ['Temperature',v.temperature,'°C'],['Salinity',v.salinity,'PSU'],
    ['Chlorophyll',v.chlorophyll,'mg m⁻³'],['Sea level',v.sea_level??v.seaLevel,'m'],
    ['SST anomaly',v.temperature_anomaly??v.sst_anomaly,'°C']
  ];
  $('coords').textContent=`${Number(lat).toFixed(4)}° N · ${Number(lon).toFixed(4)}° E`;
  $('readoutGrid').innerHTML=rows.slice(2).map(r=>`<div class="rval"><b>${r[0]}</b><span>${fmt(r[1],r[2])}</span></div>`).join('');
  $('readoutTime').textContent=p?.time||S.times[S.ti]||'Current time';
  panel.classList.remove('hidden');
}
async function pointInfo(lon,lat){
  try{
    const q=new URLSearchParams({lon:String(lon),lat:String(lat)});
    if(S.times[S.ti]) q.set('time',S.times[S.ti]);
    const p=await get(`/ocean/point?${q}`);
    openReadout(p,lon,lat);
  }catch(e){status(`Point lookup failed · ${e.message}`,'error');}
}

function raycast(evt){
  const rect=S.renderer.domElement.getBoundingClientRect();
  S.mouse.x=((evt.clientX-rect.left)/rect.width)*2-1;
  S.mouse.y=-((evt.clientY-rect.top)/rect.height)*2+1;
  S.ray.setFromCamera(S.mouse,S.camera);
  const targets=[];
  if(S.water) targets.push(S.water);
  if(S.seabed) targets.push(S.seabed);
  const hit=S.ray.intersectObjects(targets,true)[0];
  if(!hit)return;
  let p=hit.point;
  const x=p.x,lat=S.geometry.bounds[2]+(p.z-(S.geometry.bounds[2]+S.geometry.bounds[3])/2)/111.32;
  const midLat=(S.geometry.bounds[2]+S.geometry.bounds[3])/2;
  const lon=(S.geometry.bounds[0]+S.geometry.bounds[1])/2+x/(111.32*Math.cos(midLat*Math.PI/180));
  pointInfo(lon,lat);
}

function updateTimeUI(){
  const t=S.times[S.ti]||'';
  if($('timeValue')) $('timeValue').textContent=t?new Date(t).toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}):'Ocean time';
  if($('timeRaw')) $('timeRaw').textContent=t||'—';
  if($('timeSlider')){$('timeSlider').max=Math.max(0,S.times.length-1);$('timeSlider').value=S.ti;}
  if($('timeCount')) $('timeCount').textContent=`${S.ti+1}/${Math.max(1,S.times.length)}`;
}

function setupUI(){
  $('vars')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-field]'); if(!b||b.disabled)return;
    S.active=b.dataset.field; renderVariableButtons();
    status(`${LABEL[S.active]||S.active} · click an ocean point to inspect`);
  });
  $('views')?.addEventListener('click',e=>{
    const b=e.target.closest('[data-view]'); if(!b)return;
    const box=new THREE.Box3().setFromObject(S.root),c=box.getCenter(new THREE.Vector3()),s=box.getSize(new THREE.Vector3()),r=Math.max(s.x,s.y,s.z);
    const v=b.dataset.view;
    if(v==='top')S.camera.position.set(c.x,c.y+r*1.45,c.z+.01);
    else if(v==='profile')S.camera.position.set(c.x+r*1.45,c.y,c.z);
    else if(v==='under')S.camera.position.set(c.x,c.y-r*1.15,c.z+.01);
    else if(v==='3d')S.camera.position.set(c.x+r*1.05,c.y+r*.58,c.z+r*1.05);
    S.controls.target.copy(c);S.controls.update();
    document.querySelectorAll('#views .view').forEach(x=>x.classList.remove('active'));b.classList.add('active');
  });
  $('reset')?.addEventListener('click',fit);
  $('fullscreen')?.addEventListener('click',()=>document.documentElement.requestFullscreen?.());
  $('closeReadout')?.addEventListener('click',()=>$('readout')?.classList.add('hidden'));
  $('renderCanvas')?.addEventListener('pointerdown',e=>{if(e.button===0)raycast(e);});
  $('exaggeration')?.addEventListener('input',e=>{S.depthEx=Number(e.target.value);if($('exagValue'))$('exagValue').textContent=`${S.depthEx}×`;rebuild();});
  $('play')?.addEventListener('click',()=>{S.playing=!S.playing;$('play').textContent=S.playing?'PAUSE':'PLAY';});
  $('timeSlider')?.addEventListener('input',e=>{S.ti=Number(e.target.value);updateTimeUI();});
  window.addEventListener('resize',()=>{if(!S.camera)return;S.camera.aspect=innerWidth/innerHeight;S.camera.updateProjectionMatrix();S.renderer.setSize(innerWidth,innerHeight);});
  updateTimeUI();
}

function rebuild(){
  drawSeabed(); drawLand(); drawCoast(); buildWater();
  if($('depthBadge')) $('depthBadge').textContent='Physical water volume';
  if($('depthValue')) $('depthValue').textContent='Sea level → seabed';
}
function fit(){
  const box=new THREE.Box3().setFromObject(S.root); if(box.isEmpty())return;
  const c=box.getCenter(new THREE.Vector3()),s=box.getSize(new THREE.Vector3()),r=Math.max(s.x,s.y,s.z);
  S.controls.target.copy(c); S.camera.position.set(c.x+r*1.05,c.y+r*.62,c.z+r*1.05); S.camera.lookAt(c); S.controls.update();
}

async function init(){
  S.geometry=await getStatic('/geometry.json');
  const [catalog,times]=await Promise.all([get('/ocean/catalog'),get('/ocean/time')]);
  S.catalog=catalog.variables||catalog||[];
  S.times=Array.isArray(times)?times:(times.times||[]);
  S.ti=0;

  S.scene=new THREE.Scene();
  S.scene.background=new THREE.Color(0xb9dce8);
  S.camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.1,100000);
  S.renderer=new THREE.WebGLRenderer({canvas:$('renderCanvas'),antialias:true,powerPreference:'high-performance'});
  S.renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  S.renderer.setSize(innerWidth,innerHeight);
  S.renderer.outputColorSpace=THREE.SRGBColorSpace;

  S.scene.add(new THREE.HemisphereLight(0xffffff,0x405860,1.8));
  const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(500,900,400);S.scene.add(sun);
  S.root=new THREE.Group();S.scene.add(S.root);

  setupUI();
  renderVariableButtons();
  rebuild();
  drawWaterSurface();
  $('depthSection')?.classList.add('hidden');
  $('loading')?.classList.add('hidden');
  status('Physical GEBCO ocean chunk · click water to inspect');
  fit();
  animate();
}

function animate(ms=0){
  requestAnimationFrame(animate);
  if(S.playing && S.times.length>1 && ms-S.lastPlay>900){
    S.lastPlay=ms; S.ti=(S.ti+1)%S.times.length; updateTimeUI();
  }
  S.controls?.update();
  S.renderer?.render(S.scene,S.camera);
}

init().catch(fail);
