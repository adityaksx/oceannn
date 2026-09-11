import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $=id=>document.getElementById(id);
const API=`${location.protocol==='file:'?'http:':location.protocol}//${location.hostname||'127.0.0.1'}:8000`;
const n=v=>Number(v), finite=v=>Number.isFinite(n(v));
const S={scene:null,camera:null,renderer:null,controls:null,root:null,g:null,land:null,landSides:null,landBottom:null,chunkSides:null,chunkBottom:null,coast:null,seabed:null,water:null,catalog:[],times:[],ti:0,active:'temperature',depthEx:70,ray:new THREE.Raycaster(),mouse:new THREE.Vector2(),playing:false,lastPlay:0};

async function json(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw Error(`${r.status} ${await r.text()}`);return r.json()}
function status(t,type='ok'){if($('status'))$('status').textContent=t;if($('statusDot'))$('statusDot').className=type==='error'?'error':type==='busy'?'busy':''}
function fail(e){console.error(e);$('loading')?.classList.add('hidden');if($('fatalText'))$('fatalText').textContent=e?.message||String(e);$('fatal')?.classList.add('show');status(`Viewer failed · ${e?.message||e}`,'error')}
function dispose(o){if(!o)return;o.traverse(x=>{if(x.geometry)x.geometry.dispose();if(x.material){if(Array.isArray(x.material))x.material.forEach(m=>m.dispose());else x.material.dispose()}});o.parent?.remove(o)}
function depthZ(m){return-Math.max(0,n(m))*S.depthEx/1000}
function polyGeo(parts,z){const p=[],ix=[];let base=0;for(const a of parts||[]){for(const v of a.vertices||[])p.push(n(v[0]),z,n(v[1]));for(const t of a.triangles||[])ix.push(base+t[0],base+t[1],base+t[2]);base+=(a.vertices||[]).length}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ix);return g}
function lineGeo(lines,z){const p=[];for(const l of lines||[])for(let i=0;i<l.length-1;i++)p.push(n(l[i][0]),z,n(l[i][1]),n(l[i+1][0]),z,n(l[i+1][1]));const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));return g}

function drawLand(){
 dispose(S.land);dispose(S.landSides);dispose(S.landBottom);
 const parts=[...(S.g.land||[]),...(S.g.islands||[])];
 const top=.42,thickness=Math.max(2,n(S.g.landThickness||3)*S.depthEx/1000),bottom=top-thickness;
 S.land=new THREE.Mesh(polyGeo(parts,top),new THREE.MeshBasicMaterial({color:0x2fba49,side:THREE.DoubleSide}));
 S.land.renderOrder=60;S.root.add(S.land);
 const p=[],ix=[];
 for(const part of parts){
   const r=part.top||[];
   for(let i=0;i<r.length-1;i++){
     const a=r[i],b=r[i+1],q=p.length/3;
     p.push(n(a[0]),top,n(a[1]),n(a[0]),bottom,n(a[1]),n(b[0]),top,n(b[1]),n(b[0]),bottom,n(b[1]));
     ix.push(q,q+2,q+1,q+2,q+3,q+1);
   }
 }
 const sg=new THREE.BufferGeometry();sg.setAttribute('position',new THREE.Float32BufferAttribute(p,3));sg.setIndex(ix);
 S.landSides=new THREE.Mesh(sg,new THREE.MeshBasicMaterial({color:0x744925,side:THREE.DoubleSide}));S.landSides.renderOrder=55;S.root.add(S.landSides);
 S.landBottom=new THREE.Mesh(polyGeo(parts,bottom),new THREE.MeshBasicMaterial({color:0x5b391f,side:THREE.DoubleSide}));S.landBottom.renderOrder=54;S.root.add(S.landBottom);
}

function drawCoast(){
 dispose(S.coast);
 const lines=[...(S.g.coast||[]),...(S.g.landBoundary||[]),...(S.g.islandCoast||[])];
 S.coast=new THREE.LineSegments(lineGeo(lines,.5),new THREE.LineBasicMaterial({color:0x102d1b}));
 S.coast.renderOrder=90;S.root.add(S.coast);
}

function drawSeabed(){
 dispose(S.seabed);
 const t=S.g.terrain,nx=t.x.length,ny=t.y.length,p=[],ix=[],map=new Int32Array(nx*ny);map.fill(-1);
 for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
   const d=n((t.rawDepthKm[j]||[])[i]);
   if(!finite(d)||d<=0)continue;
   map[j*nx+i]=p.length/3;p.push(t.x[i],depthZ(d*1000),t.y[j]);
 }
 for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){
   const a=map[j*nx+i],b=map[j*nx+i+1],c=map[(j+1)*nx+i],d=map[(j+1)*nx+i+1];
   if(a>=0&&b>=0&&c>=0&&d>=0)ix.push(a,c,b,b,c,d);
 }
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ix);g.computeVertexNormals();
 S.seabed=new THREE.Mesh(g,new THREE.MeshStandardMaterial({color:0x85572f,roughness:1,side:THREE.DoubleSide}));S.seabed.renderOrder=8;S.root.add(S.seabed);
}

function buildWater(){
 dispose(S.water);S.water=new THREE.Group();
 const t=S.g.terrain,nx=t.x.length,ny=t.y.length,raw=t.rawDepthKm;
 const step=Math.max(1,Math.ceil(Math.sqrt(nx*ny/16000))),cells=[];
 for(let j=0;j<ny-1;j+=step)for(let i=0;i<nx-1;i+=step){
   const i2=Math.min(nx-1,i+step),j2=Math.min(ny-1,j+step);
   const corners=[
     n((raw[j]||[])[i]),n((raw[j]||[])[i2]),
     n((raw[j2]||[])[i]),n((raw[j2]||[])[i2])
   ];
   // Every corner must be real GEBCO ocean depth. This keeps water strictly on the ocean side of the coastline.
   if(!corners.every(v=>Number.isFinite(v)&&v>0.005))continue;
   const depthKm=Math.min(...corners);
   const x0=t.x[i],x1=t.x[i2],y0=t.y[j],y1=t.y[j2],h=Math.abs(depthZ(depthKm*1000));
   if(h<.15)continue;
   cells.push({x:(x0+x1)/2,y:(y0+y1)/2,sx:Math.max(.3,Math.abs(x1-x0)*.97),sy:Math.max(.3,Math.abs(y1-y0)*.97),h,depthKm});
 }
 if(!cells.length)throw Error('No ocean cells were found in GEBCO geometry');
 const box=new THREE.BoxGeometry(1,1,1);
 const mat=new THREE.MeshPhysicalMaterial({color:0x198db5,transparent:true,opacity:.30,roughness:.25,metalness:0,transmission:.03,ior:1.333,depthWrite:false,side:THREE.DoubleSide});
 const mesh=new THREE.InstancedMesh(box,mat,cells.length),dummy=new THREE.Object3D();
 for(let k=0;k<cells.length;k++){
   const c=cells[k];dummy.position.set(c.x,-c.h/2,c.y);dummy.scale.set(c.sx,c.h,c.sy);dummy.updateMatrix();mesh.setMatrixAt(k,dummy.matrix);
 }
 mesh.instanceMatrix.needsUpdate=true;mesh.userData={isWater:true,cells};mesh.renderOrder=20;S.water.add(mesh);S.root.add(S.water);box.dispose();
}

function drawChunkBase(){
 dispose(S.chunkSides);dispose(S.chunkBottom);
 const b=S.g.bounds,mid=(b[2]+b[3])/2,klon=111.32*Math.cos(mid*Math.PI/180);
 const x0=(b[0]-(b[0]+b[1])/2)*klon,x1=(b[1]-(b[0]+b[1])/2)*klon;
 const y0=(b[2]-(b[2]+b[3])/2)*111.32,y1=(b[3]-(b[2]+b[3])/2)*111.32;
 const maxDepth=Math.max(1,n(S.g.terrain?.maxDepthKm||1));
 // Keep the artificial chunk base below the real GEBCO seabed so it only closes the exposed outside walls.
 const baseZ=depthZ((maxDepth+1.5)*1000);
 const p=[x0,0,y0,x1,0,y0,x1,0,y1,x0,0,y1,x0,baseZ,y0,x1,baseZ,y0,x1,baseZ,y1,x0,baseZ,y1];
 const ix=[0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7];
 const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(p,3));g.setIndex(ix);
 S.chunkSides=new THREE.Mesh(g,new THREE.MeshBasicMaterial({color:0x654126,side:THREE.DoubleSide}));S.chunkSides.renderOrder=1;S.root.add(S.chunkSides);
 const bg=new THREE.BufferGeometry();bg.setAttribute('position',new THREE.Float32BufferAttribute([x0,baseZ,y0,x1,baseZ,y0,x1,baseZ,y1,x0,baseZ,y1],3));bg.setIndex([0,2,1,0,3,2]);
 S.chunkBottom=new THREE.Mesh(bg,new THREE.MeshBasicMaterial({color:0x54351f,side:THREE.DoubleSide}));S.chunkBottom.renderOrder=0;S.root.add(S.chunkBottom);
}

function renderVars(){
 const host=$('vars');if(!host)return;host.innerHTML='';
 const icons={temperature:'T',temperature_anomaly:'∆',salinity:'S',currents:'C',sea_level:'η',chlorophyll:'Ch'};
 for(const x of S.catalog){
   const b=document.createElement('button');b.className=`var ${x.id===S.active?'active':''} ${x.available===false?'off':''}`;b.disabled=x.available===false;
   b.innerHTML=`<span class="vicon">${icons[x.id]||'•'}</span><span><b>${x.label||x.id}</b><small>${x.units||'inspection only'}</small></span><span class="dot"></span>`;
   b.onclick=()=>{S.active=x.id;renderVars();status(`${x.label||x.id} · inspection only`)};host.appendChild(b);
 }
}
function fmt(v,u){if(!finite(v))return'—';const x=n(v);return`${x.toFixed(Math.abs(x)<1?4:2)} ${u||''}`.trim()}
function showPoint(data,lon,lat){
 const v=data?.values||data;
 $('coords').textContent=`${n(lat).toFixed(4)}° N · ${n(lon).toFixed(4)}° E`;
 const rows=[['Temperature',v.temperature,'°C'],['Salinity',v.salinity,'PSU'],['Chlorophyll',v.chlorophyll,'mg m⁻³'],['Sea level',v.sea_level??v.seaLevel,'m'],['SST anomaly',v.temperature_anomaly??v.sst_anomaly,'°C']];
 $('readoutGrid').innerHTML=rows.map(r=>`<div class="rval"><b>${r[0]}</b><span>${fmt(r[1],r[2])}</span></div>`).join('');
 $('readoutTime').textContent=data?.time||S.times[S.ti]||'Current time';$('readout')?.classList.remove('hidden');
}
async function inspect(lon,lat){try{status('Reading ocean point…','busy');const q=new URLSearchParams({lon:String(lon),lat:String(lat)});if(S.times[S.ti])q.set('time',S.times[S.ti]);showPoint(await json(`${API}/ocean/point?${q}`),lon,lat);status('Ocean point inspected')}catch(e){status(`Point lookup failed · ${e.message}`,'error')}}
function clickOcean(e){
 if(!S.water)return;const r=S.renderer.domElement.getBoundingClientRect();S.mouse.x=(e.clientX-r.left)/r.width*2-1;S.mouse.y=-(e.clientY-r.top)/r.height*2+1;S.ray.setFromCamera(S.mouse,S.camera);
 const hit=S.ray.intersectObjects(S.water.children,true).find(h=>h.object?.userData?.isWater&&h.instanceId!=null);if(!hit)return;
 const c=hit.object.userData.cells[hit.instanceId],b=S.g.bounds,ml=(b[2]+b[3])/2,klon=111.32*Math.cos(ml*Math.PI/180);
 inspect((b[0]+b[1])/2+c.x/klon,(b[2]+b[3])/2+c.y/111.32);
}

function fit(){
 const box=new THREE.Box3().setFromObject(S.root);if(box.isEmpty())return;const c=box.getCenter(new THREE.Vector3()),s=box.getSize(new THREE.Vector3()),r=Math.max(s.x,s.y,s.z,1);
 S.controls.target.copy(c);
 // Camera from the west/south side so longitude increases visually toward the right and the coastline-to-ocean direction is not mirrored.
 S.camera.position.set(c.x-r*1.15,c.y-r*.72,c.z+r*.95);S.camera.lookAt(c);S.controls.update();
}
function views(){
 document.querySelectorAll('#views .view').forEach(b=>b.onclick=()=>{
   const box=new THREE.Box3().setFromObject(S.root),c=box.getCenter(new THREE.Vector3()),s=box.getSize(new THREE.Vector3()),r=Math.max(s.x,s.y,s.z,1),v=b.dataset.view;
   if(v==='top')S.camera.position.set(c.x,c.y,c.z+r*1.45);
   else if(v==='profile')S.camera.position.set(c.x-r*1.5,c.y,c.z+.05*r);
   else if(v==='under')S.camera.position.set(c.x-r*.75,c.y-r*.55,c.z-r*1.2);
   else S.camera.position.set(c.x-r*1.15,c.y-r*.72,c.z+r*.95);
   S.controls.target.copy(c);S.controls.update();document.querySelectorAll('#views .view').forEach(x=>x.classList.remove('active'));b.classList.add('active');
 });
}
function timeUI(){const t=S.times[S.ti]||'';if($('timeValue'))$('timeValue').textContent=t?new Date(t).toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}):'Ocean time';if($('timeRaw'))$('timeRaw').textContent=t||'—';if($('timeSlider')){$('timeSlider').max=Math.max(0,S.times.length-1);$('timeSlider').value=S.ti}if($('timeCount'))$('timeCount').textContent=`${S.ti+1}/${Math.max(1,S.times.length)}`}
function ui(){
 $('reset')?.addEventListener('click',fit);$('fullscreen')?.addEventListener('click',()=>document.documentElement.requestFullscreen?.());$('closeReadout')?.addEventListener('click',()=>$('readout')?.classList.add('hidden'));
 $('renderCanvas')?.addEventListener('click',clickOcean);
 $('exaggeration')?.addEventListener('input',e=>{S.depthEx=n(e.target.value);if($('exagValue'))$('exagValue').textContent=`${S.depthEx}×`;drawLand();drawSeabed();buildWater();drawChunkBase();fit()});
 $('play')?.addEventListener('click',()=>{S.playing=!S.playing;$('play').textContent=S.playing?'PAUSE':'PLAY'});$('timeSlider')?.addEventListener('input',e=>{S.ti=n(e.target.value);timeUI()});
}
function animate(ms=0){requestAnimationFrame(animate);if(S.playing&&S.times.length>1&&ms-S.lastPlay>900){S.lastPlay=ms;S.ti=(S.ti+1)%S.times.length;timeUI()}S.controls?.update();S.renderer?.render(S.scene,S.camera)}

async function init(){
 S.g=await json('/geometry.json');
 const [cat,times]=await Promise.all([json(`${API}/ocean/catalog`).catch(()=>[]),json(`${API}/ocean/time`).catch(()=>[])]);S.catalog=Array.isArray(cat)?cat:(cat.variables||[]);S.times=Array.isArray(times)?times:(times.times||[]);
 S.scene=new THREE.Scene();S.scene.background=new THREE.Color(0xb9dfe9);S.scene.fog=new THREE.Fog(0xb9dfe9,1600,6500);
 S.camera=new THREE.PerspectiveCamera(42,innerWidth/innerHeight,.1,100000);
 S.renderer=new THREE.WebGLRenderer({canvas:$('renderCanvas'),antialias:true,powerPreference:'high-performance'});S.renderer.setPixelRatio(Math.min(devicePixelRatio,2));S.renderer.setSize(innerWidth,innerHeight);S.renderer.outputColorSpace=THREE.SRGBColorSpace;
 S.scene.add(new THREE.HemisphereLight(0xffffff,0x49636b,2));const sun=new THREE.DirectionalLight(0xffffff,2.2);sun.position.set(500,800,900);S.scene.add(sun);
 S.root=new THREE.Group();S.scene.add(S.root);
 drawSeabed();drawLand();drawCoast();buildWater();drawChunkBase();
 S.controls=new OrbitControls(S.camera,S.renderer.domElement);S.controls.enableDamping=true;S.controls.dampingFactor=.055;S.controls.screenSpacePanning=true;S.controls.minDistance=80;S.controls.maxDistance=9000;S.controls.target.set(0,0,0);
 renderVars();views();ui();timeUI();if($('exaggeration'))$('exaggeration').value=70;if($('exagValue'))$('exagValue').textContent='70×';if($('depthMax'))$('depthMax').textContent=`${n(S.g.terrain.maxDepthKm||0).toFixed(1)} km`;if($('depthValue'))$('depthValue').textContent='Sea level → seabed';$('loading')?.classList.add('hidden');status('3D ocean chunk ready');fit();animate();
}
addEventListener('resize',()=>{if(!S.camera||!S.renderer)return;S.camera.aspect=innerWidth/innerHeight;S.camera.updateProjectionMatrix();S.renderer.setSize(innerWidth,innerHeight)});
init().catch(fail);
