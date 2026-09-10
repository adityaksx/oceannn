(() => {
'use strict';

const $ = id => document.getElementById(id);
const finite = v => typeof v === 'number' && Number.isFinite(v);

let data = null;
let depthEx = 10;
let engine, scene, camera;
let seabed = null, waterSurface = null;
let layerMeshes = [], wallMeshes = [], landMeshes = [];
let waterBump = null;
let currentView = '3d';

const SURFACE_Y = 0;
const LAND_TOP_Y = 3;
const LAND_BOTTOM_Y = -3;
const WATER_BUMP_URL = 'https://www.babylonjs-playground.com/textures/waterbump.png';
const WATER_LAYER_COUNT = 50;

function status(text, type = 'ok') {
  $('status').textContent = text;
  $('statusDot').className = `statusdot ${type === 'error' ? 'error' : type === 'busy' ? 'busy' : ''}`;
}

function fail(error) {
  console.error(error);
  status(`3D viewer failed: ${error?.message || error}`, 'error');
  $('loading')?.classList.add('hide');
  $('fatalText').textContent = error?.message || String(error);
  $('fatal').style.display = 'block';
}

function geo() {
  const xs = data.terrain.x, zs = data.terrain.y;
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return { minX, maxX, minZ, maxZ, width:maxX-minX, height:maxZ-minZ, cx:(minX+maxX)/2, cz:(minZ+maxZ)/2, size:Math.max(maxX-minX,maxZ-minZ) };
}

function makeMesh(name, positions, indices, material) {
  const mesh = new BABYLON.Mesh(name, scene);
  const vd = new BABYLON.VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.applyToMesh(mesh, true);
  mesh.material = material;
  mesh.metadata = { solvx:true };
  return mesh;
}

function landMaterial() {
  const m = new BABYLON.StandardMaterial('dark forest cover', scene);
  m.diffuseColor = new BABYLON.Color3(0.045,0.22,0.055);
  m.emissiveColor = new BABYLON.Color3(0.004,0.018,0.005);
  m.specularColor = BABYLON.Color3.Black();
  m.backFaceCulling = false;
  return m;
}

function seabedMaterial() {
  const m = new BABYLON.StandardMaterial('real soil seabed', scene);
  m.diffuseColor = new BABYLON.Color3(0.30,0.17,0.075);
  m.emissiveColor = new BABYLON.Color3(0.018,0.008,0.003);
  m.specularColor = new BABYLON.Color3(0.025,0.018,0.01);
  m.backFaceCulling = false;
  return m;
}

function waterMaterial() {
  const m = new BABYLON.StandardMaterial('opaque ocean surface', scene);
  m.diffuseColor = new BABYLON.Color3(0.012,0.27,0.70);
  m.emissiveColor = new BABYLON.Color3(0.001,0.022,0.07);
  m.specularColor = new BABYLON.Color3(0.55,0.75,1);
  m.specularPower = 100;
  m.alpha = 1;
  m.backFaceCulling = false;
  waterBump = new BABYLON.Texture(WATER_BUMP_URL, scene);
  waterBump.uScale = 8;
  waterBump.vScale = 8;
  waterBump.level = 0.55;
  m.bumpTexture = waterBump;
  return m;
}

function makeSeabed() {
  const t=data.terrain, xs=t.x, zs=t.y, raw=t.rawDepthKm;
  const nx=xs.length,nz=zs.length,positions=new Float32Array(nx*nz*3),indices=[];
  let k=0;
  for(let j=0;j<nz;j++) for(let i=0;i<nx;i++,k++) {
    const d=raw[j]?.[i];
    positions[k*3]=xs[i];
    positions[k*3+1]=finite(d) ? -d*depthEx*8 : LAND_BOTTOM_Y;
    positions[k*3+2]=zs[j];
  }
  for(let j=0;j<nz-1;j++) for(let i=0;i<nx-1;i++) {
    const q=[raw[j]?.[i],raw[j]?.[i+1],raw[j+1]?.[i],raw[j+1]?.[i+1]];
    if(!q.every(finite)) continue;
    const a=j*nx+i,b=a+1,c=a+nx,d=c+1;
    indices.push(a,c,b,b,c,d);
  }
  const mesh=makeMesh('GEBCO SOIL SEABED',Array.from(positions),indices,seabedMaterial());
  mesh.renderingGroupId=0;
  return mesh;
}

function makeLand() {
  const mat=landMaterial();
  let count=0;
  for(const polygons of [data.land||[],data.islands||[]]) for(const poly of polygons) {
    if(!poly?.vertices?.length||!poly?.triangles?.length) continue;
    const n=poly.vertices.length,positions=[];
    for(const q of poly.vertices) positions.push(+q[0],LAND_TOP_Y,+q[1]);
    for(const q of poly.vertices) positions.push(+q[0],LAND_BOTTOM_Y,+q[1]);
    const indices=[];
    for(const tri of poly.triangles) {
      if(!Array.isArray(tri)||tri.length<3) continue;
      const a=+tri[0],b=+tri[1],c=+tri[2];
      indices.push(a,c,b,a+n,b+n,c+n);
    }
    const ring=poly.top||[];
    for(let i=0;i<ring.length-1;i++) {
      let ia=-1,ib=-1,da=Infinity,db=Infinity;
      for(let v=0;v<poly.vertices.length;v++) {
        const vx=+poly.vertices[v][0],vz=+poly.vertices[v][1];
        const aa=Math.hypot(vx-ring[i][0],vz-ring[i][1]);
        const bb=Math.hypot(vx-ring[i+1][0],vz-ring[i+1][1]);
        if(aa<da){da=aa;ia=v} if(bb<db){db=bb;ib=v}
      }
      if(ia>=0&&ib>=0) indices.push(ia,ib,ia+n,ib,ib+n,ia+n);
    }
    if(!indices.length) continue;
    const mesh=makeMesh(`FOREST LAND ${count++}`,positions,indices,mat);
    mesh.renderingGroupId=3;landMeshes.push(mesh);
  }
  return count;
}

function addLines(name,parts,y,color) {
  for(let n=0;n<(parts||[]).length;n++) {
    const part=parts[n]; if(!part||part.length<2) continue;
    const points=part.map(q=>new BABYLON.Vector3(+q[0],y,+q[1]));
    const line=BABYLON.MeshBuilder.CreateLines(`${name}-${n}`,{points},scene);
    line.color=color;line.renderingGroupId=5;line.metadata={solvx:true};
  }
}

function depthLevels() {
  const source=Array.isArray(data.temperatureDepthsM)?data.temperatureDepthsM.filter(finite):[];
  if(!source.length) {
    const maxM=Math.max(1000,(data.terrain.maxDepthKm||5)*1000);
    return Array.from({length:WATER_LAYER_COUNT},(_,i)=>maxM*i/(WATER_LAYER_COUNT-1));
  }
  // Preserve the actual temperature model depth range, but interpolate it to
  // exactly 50 visual strata so the volume is smooth instead of only 32 planes.
  const lo=source[0]||0,hi=source[source.length-1];
  if(source.length>=WATER_LAYER_COUNT) return source.slice(0,WATER_LAYER_COUNT);
  const out=[];
  for(let i=0;i<WATER_LAYER_COUNT;i++) {
    const target=lo+(hi-lo)*i/(WATER_LAYER_COUNT-1);
    let best=source[0];
    for(let j=0;j<source.length-1;j++) {
      if(target>=source[j]&&target<=source[j+1]) {
        const f=(target-source[j])/(source[j+1]-source[j]||1);
        best=source[j]+f*(source[j+1]-source[j]);break;
      }
    }
    out.push(best);
  }
  return out;
}

function depthY(m) { return -(m/1000)*depthEx*8; }

function waterLayerMaterial(i,total) {
  const t=total<=1?0:i/(total-1);
  const c=new BABYLON.Color3(0.015-0.008*t,0.52-0.25*t,0.88-0.28*t);
  const m=new BABYLON.StandardMaterial(`blended water ${i+1}`,scene);
  m.diffuseColor=c;
  m.emissiveColor=new BABYLON.Color3(c.r*0.08,c.g*0.08,c.b*0.10);
  m.specularColor=new BABYLON.Color3(0.12,0.22,0.35);
  // The layers deliberately overlap optically: 50 low-alpha strata blend into
  // a dense blue volume instead of behaving like 50 opaque sheets.
  m.alpha=0.20;
  m.backFaceCulling=false;
  m.needDepthPrePass=true;
  return m;
}

function meshFromPolygons(name,polygons,y,material,group=1) {
  const meshes=[];
  for(let p=0;p<(polygons||[]).length;p++) {
    const poly=polygons[p]; if(!poly?.vertices?.length||!poly?.triangles?.length) continue;
    const pos=[];for(const q of poly.vertices) pos.push(+q[0],y,+q[1]);
    const ind=[];for(const t of poly.triangles) ind.push(+t[0],+t[1],+t[2]);
    const m=makeMesh(`${name}-${p}`,pos,ind,material);m.renderingGroupId=group;meshes.push(m);
  }
  return meshes;
}

function makeWaterLayers() {
  layerMeshes.forEach(m=>m.dispose(false,true));wallMeshes.forEach(m=>m.dispose(false,true));
  layerMeshes=[];wallMeshes=[];
  const levels=depthLevels(), ocean=data.ocean||[];
  if(!ocean.length) throw new Error('Ocean footprint was not generated from Natural Earth land data');

  // Fifty coastline-clipped horizontal strata. They use the actual temperature
  // file depth range, interpolated between its measured levels.
  levels.forEach((meters,i)=>{
    const meshes=meshFromPolygons(`WATER STRATUM ${i+1}`,ocean,depthY(meters),waterLayerMaterial(i,levels.length),1);
    meshes.forEach(m=>{m.metadata={solvx:true,depthLevel:meters,waterLayer:true};layerMeshes.push(m)});
  });

  // Thin vertical ocean boundary using the same coastline-clipped footprint.
  // This is intentionally shallow in normal 3D and mainly visible in PROFILE/UNDER.
  const maxY=depthY(levels.at(-1)||1000);
  for(let p=0;p<ocean.length;p++) {
    const ring=ocean[p]?.top||[]; if(ring.length<2) continue;
    const pos=[];for(const q of ring) pos.push(+q[0],0,+q[1]);for(const q of ring) pos.push(+q[0],maxY,+q[1]);
    const n=ring.length,ind=[];
    for(let i=0;i<n-1;i++) ind.push(i,i+1,i+n,i+1,i+n+1,i+n);
    const mat=new BABYLON.StandardMaterial(`water boundary ${p}`,scene);
    mat.diffuseColor=new BABYLON.Color3(0.01,0.18,0.48);mat.emissiveColor=new BABYLON.Color3(0.001,0.01,0.035);mat.alpha=0.35;mat.backFaceCulling=false;
    const wall=makeMesh(`OCEAN BOUNDARY ${p}`,pos,ind,mat);wall.renderingGroupId=1;wall.metadata={solvx:true,waterWall:true};wallMeshes.push(wall);
  }
  return levels.length;
}

function makeWaterSurface() {
  if(waterSurface) waterSurface.dispose(false,true);
  const ocean=data.ocean||[];
  const mat=waterMaterial();
  const meshes=meshFromPolygons('COASTLINE CLIPPED OCEAN SURFACE',ocean,SURFACE_Y,mat,2);
  waterSurface=meshes;
}

function setViewVisibility(mode) {
  const normal=mode==='3d'||mode==='top';
  layerMeshes.forEach(m=>m.setEnabled(!normal));
  wallMeshes.forEach(m=>m.setEnabled(mode==='profile'||mode==='under'));
  if(Array.isArray(waterSurface)) waterSurface.forEach(m=>m.setEnabled(normal));
  if(seabed) seabed.setEnabled(true);
  landMeshes.forEach(m=>m.setEnabled(true));
}

function fit(mode='3d') {
  currentView=mode;const g=geo();const maxDepth=Math.abs(depthY(depthLevels().at(-1)||1000));const d=Math.max(650,g.size*1.30);
  if(mode==='top') {camera.target.set(g.cx,0,g.cz);camera.alpha=-Math.PI/2;camera.beta=0.08;camera.radius=d*0.92}
  else if(mode==='profile') {camera.target.set(g.cx,-maxDepth*0.35,g.cz);camera.alpha=0;camera.beta=1.25;camera.radius=d*1.02}
  else if(mode==='under') {camera.target.set(g.cx,-maxDepth*0.40,g.cz);camera.alpha=0.55;camera.beta=2.10;camera.radius=d*0.90}
  else {camera.target.set(g.cx,-maxDepth*0.06,g.cz);camera.alpha=-0.78;camera.beta=0.88;camera.radius=d*1.05}
  setViewVisibility(mode);
}

function build() {
  scene.meshes.slice().forEach(m=>{if(m.metadata?.solvx)m.dispose(false,true)});
  landMeshes=[];seabed=makeSeabed();
  const landCount=makeLand();
  addLines('COASTLINE',data.coast,LAND_TOP_Y+0.35,new BABYLON.Color3(0.01,0.045,0.01));
  addLines('EEZ',data.eez,LAND_TOP_Y+0.20,new BABYLON.Color3(0.95,0.55,0.04));
  const count=makeWaterLayers();makeWaterSurface();fit(currentView);
  const source=data.temperatureDepthsM?.length?`${data.temperatureDepthsM.length} source levels`: 'bathymetry fallback';
  status(`Ocean ready · ${landCount} forest land chunks · coastline · ${count} blended water layers (${source})`);
  $('loading').classList.add('hide');
}

async function init() {
  try {
    if(!window.BABYLON) throw new Error('Babylon.js CDN did not load');
    const canvas=$('renderCanvas');
    engine=new BABYLON.Engine(canvas,true,{stencil:true,preserveDrawingBuffer:false},true);
    scene=new BABYLON.Scene(engine);scene.clearColor=new BABYLON.Color4(0.86,0.91,0.95,1);
    const hemi=new BABYLON.HemisphericLight('hemi',new BABYLON.Vector3(0,1,0),scene);hemi.intensity=1.25;
    const sun=new BABYLON.DirectionalLight('sun',new BABYLON.Vector3(-0.5,-1,-0.4),scene);sun.intensity=1.6;
    camera=new BABYLON.ArcRotateCamera('camera',-0.78,0.88,1500,BABYLON.Vector3.Zero(),scene);camera.attachControl(canvas,true);
    camera.lowerRadiusLimit=30;camera.upperRadiusLimit=12000;camera.wheelPrecision=2;camera.panningSensibility=90;
    status('Loading geometry.json…','busy');
    const response=await fetch(`geometry.json?${Date.now()}`,{cache:'no-store'});if(!response.ok)throw new Error(`${response.status} ${response.statusText}`);
    data=await response.json();if(!data.terrain?.x?.length||!data.terrain?.y?.length)throw new Error('Invalid terrain grid');
    build();
    engine.runRenderLoop(()=>{if(waterBump){waterBump.uOffset+=0.00035;waterBump.vOffset+=0.00014}scene.render()});
    addEventListener('resize',()=>engine.resize());
  }catch(error){fail(error)}
}

$('exaggeration').value=10;$('exagValue').textContent='10×';
$('exaggeration').addEventListener('input',e=>{depthEx=+(e.target.value||10);$('exagValue').textContent=`${depthEx}×`;build()});
$('reset').onclick=()=>fit('3d');$('fullscreen').onclick=()=>document.documentElement.requestFullscreen?.();
document.querySelectorAll('[data-view]').forEach(button=>{button.onclick=()=>{document.querySelectorAll('[data-view]').forEach(x=>x.classList.remove('active'));button.classList.add('active');fit(button.dataset.view)}});
init();
})();
