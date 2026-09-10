(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  let data = null, depthEx = 30, engine, scene, camera;
  let seabed = null, waterLayers = [];

  function status(text, type='ok') {
    $('status').textContent = text;
    $('statusDot').className = `statusdot ${type==='error'?'error':type==='busy'?'busy':''}`;
  }
  function fail(e) {
    console.error(e); status(`3D viewer failed: ${e?.message || e}`, 'error');
    $('loading')?.classList.add('hide');
    $('fatalText').textContent = e?.message || String(e); $('fatal').style.display='block';
  }
  function bounds() {
    const xs=data.terrain.x, ys=data.terrain.y; let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
    for(const x of xs){if(x<minX)minX=x;if(x>maxX)maxX=x}
    for(const y of ys){if(y<minY)minY=y;if(y>maxY)maxY=y}
    return {minX,maxX,minY,maxY,cx:(minX+maxX)/2,cy:(minY+maxY)/2,size:Math.max(maxX-minX,maxY-minY)};
  }
  function makeMesh(name,positions,indices,material) {
    const mesh=new BABYLON.Mesh(name,scene), vd=new BABYLON.VertexData();
    vd.positions=positions; vd.indices=indices; vd.applyToMesh(mesh,true); mesh.material=material; return mesh;
  }
  function makeLandMaterial(){const m=new BABYLON.StandardMaterial('land',scene);m.diffuseColor=new BABYLON.Color3(.18,.52,.20);m.specularColor=BABYLON.Color3.Black();m.backFaceCulling=false;return m}
  function makeWaterMaterial(name,color,alpha){const m=new BABYLON.StandardMaterial(name,scene);m.diffuseColor=color;m.emissiveColor=new BABYLON.Color3(color.r*.18,color.g*.18,color.b*.18);m.specularColor=new BABYLON.Color3(.05,.18,.28);m.alpha=alpha;m.backFaceCulling=false;m.useAlphaFromDiffuseTexture=false;return m}

  function makeSeabed(){
    const t=data.terrain,xs=t.x,ys=t.y,raw=t.rawDepthKm,nx=xs.length,ny=ys.length;
    const p=new Float32Array(nx*ny*3), idx=[]; let k=0;
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,k++){const d=raw[j]?.[i];p[k*3]=xs[i];p[k*3+1]=ys[j];p[k*3+2]=finite(d)?-d*depthEx:-3}
    for(let j=0;j<ny-1;j++)for(let i=0;i<nx-1;i++){const q=[raw[j]?.[i],raw[j]?.[i+1],raw[j+1]?.[i],raw[j+1]?.[i+1]];if(q.every(finite)){const a=j*nx+i,b=a+1,c=a+nx,d=c+1;idx.push(a,c,b,b,c,d)}}
    const mat=new BABYLON.StandardMaterial('seabed',scene);mat.diffuseColor=new BABYLON.Color3(.32,.25,.20);mat.specularColor=BABYLON.Color3.Black();
    return makeMesh('GEBCO seabed',Array.from(p),idx,mat);
  }
  function addLand(){
    const mat=makeLandMaterial(); let added=0;
    for(const polys of [data.land||[],data.islands||[]]) for(const poly of polys){
      if(!poly?.vertices?.length||!poly?.triangles?.length)continue;
      const pos=poly.vertices.flatMap(q=>[+q[0],+q[1],8]);
      const idx=[]; for(const tri of poly.triangles){if(Array.isArray(tri)&&tri.length>=3)idx.push(+tri[0],+tri[1],+tri[2])}
      if(idx.length){const mesh=makeMesh(`land-${added}`,pos,idx,mat);mesh.renderingGroupId=2;added++}
    }
    return added;
  }
  function addCoast(){
    for(let n=0;n<(data.coast||[]).length;n++){const a=data.coast[n];if(a.length<2)continue;const pts=a.map(q=>new BABYLON.Vector3(+q[0],+q[1],9.2));const l=BABYLON.MeshBuilder.CreateLines(`coast-${n}`,{points:pts},scene);l.color=new BABYLON.Color3(.02,.22,.25);l.renderingGroupId=3}}
  function addEEZ(){
    for(let n=0;n<(data.eez||[]).length;n++){const a=data.eez[n];if(a.length<2)continue;const pts=a.map(q=>new BABYLON.Vector3(+q[0],+q[1],9));const l=BABYLON.MeshBuilder.CreateLines(`eez-${n}`,{points:pts},scene);l.color=new BABYLON.Color3(.95,.55,.05);l.renderingGroupId=3}}

  function makeOceanLayers(){
    waterLayers.forEach(m=>m.dispose(false,true)); waterLayers=[];
    const b=bounds();
    const levels=[
      {z:7.5,c:new BABYLON.Color3(.04,.68,.86)},
      {z:5.5,c:new BABYLON.Color3(.03,.53,.82)},
      {z:3.2,c:new BABYLON.Color3(.025,.39,.72)},
      {z:0.3,c:new BABYLON.Color3(.02,.29,.62)},
      {z:-3.8,c:new BABYLON.Color3(.015,.20,.48)},
      {z:-7.0,c:new BABYLON.Color3(.01,.12,.34)}
    ];
    for(let i=0;i<levels.length;i++){
      const q=levels[i], m=BABYLON.MeshBuilder.CreateGround(`water-layer-${i}`,{width:b.maxX-b.minX,height:b.maxY-b.minY,subdivisions:1},scene);
      m.position.set(b.cx,b.cy,q.z);m.material=makeWaterMaterial(`water-${i}`,q.c,1.0);m.renderingGroupId=1;waterLayers.push(m);
    }
  }
  function fit(mode='3d'){
    const b=bounds(),d=Math.max(650,b.size*1.55);
    if(mode==='top'){camera.alpha=-Math.PI/2;camera.beta=.08;camera.radius=d*1.05}
    else if(mode==='profile'){camera.alpha=0;camera.beta=1.2;camera.radius=d*1.1}
    else if(mode==='under'){camera.alpha=.7;camera.beta=2.2;camera.radius=d*.9}
    else {camera.alpha=-.85;camera.beta=1.0;camera.radius=d}
    camera.target.set(b.cx,b.cy,-80);
  }
  function build(){
    scene.meshes.slice().forEach(m=>{if(m.metadata?.solvx)m.dispose(false,true)});
    seabed=makeSeabed();seabed.metadata={solvx:true};
    const landCount=addLand();addCoast();addEEZ();makeOceanLayers();
    fit('3d');status(`3D ocean ready · ${landCount} green land polygons`,'ok');$('loading').classList.add('hide');
  }
  async function init(){
    try{
      if(!window.BABYLON)throw new Error('Babylon.js CDN did not load');
      const canvas=$('renderCanvas'); engine=new BABYLON.Engine(canvas,true,{stencil:true,preserveDrawingBuffer:false},true);
      scene=new BABYLON.Scene(engine);scene.clearColor=new BABYLON.Color4(.875,.918,.945,1);scene.ambientColor=new BABYLON.Color3(.45,.45,.45);
      camera=new BABYLON.ArcRotateCamera('camera',-.85,1,2500,BABYLON.Vector3.Zero(),scene);camera.attachControl(canvas,true);camera.lowerRadiusLimit=30;camera.upperRadiusLimit=18000;camera.wheelPrecision=2;camera.panningSensibility=90;
      const hemi=new BABYLON.HemisphericLight('hemi',new BABYLON.Vector3(0,0,1),scene);hemi.intensity=1.5;const sun=new BABYLON.DirectionalLight('sun',new BABYLON.Vector3(-.4,-.5,-1),scene);sun.intensity=1.7;
      status('Loading geometry.json…','busy');const r=await fetch(`geometry.json?${Date.now()}`,{cache:'no-store'});if(!r.ok)throw new Error(`${r.status} ${r.statusText}`);data=await r.json();
      if(!data.terrain?.x?.length||!data.terrain?.y?.length)throw new Error('Invalid terrain grid');build();engine.runRenderLoop(()=>scene.render());addEventListener('resize',()=>engine.resize());
    }catch(e){fail(e)}
  }
  $('exaggeration').value=30;$('exagValue').textContent='30×';$('exaggeration').addEventListener('input',e=>{depthEx=+e.target.value||30;if(seabed){const v=seabed.getVerticesData(BABYLON.VertexBuffer.PositionKind);const raw=data.terrain.rawDepthKm,nx=data.terrain.x.length,ny=data.terrain.y.length;for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const k=j*nx+i,d=raw[j]?.[i];v[k*3+2]=finite(d)?-d*depthEx:-3}seabed.updateVerticesData(BABYLON.VertexBuffer.PositionKind,v,false,false)}});
  $('reset').onclick=()=>fit('3d');$('fullscreen').onclick=()=>document.documentElement.requestFullscreen?.();
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{document.querySelectorAll('[data-view]').forEach(x=>x.classList.remove('active'));b.classList.add('active');fit(b.dataset.view)});
  init();
})();
