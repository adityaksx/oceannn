(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  let data = null;
  let depthEx = 55;
  let engine, scene, camera;
  let terrain = null;
  let water = null;

  function status(text, type = 'ok') {
    const el = $('status');
    const dot = $('statusDot');
    if (el) el.textContent = text;
    if (dot) dot.className = `statusdot ${type === 'error' ? 'error' : type === 'busy' ? 'busy' : ''}`;
  }

  function fail(error) {
    console.error('SolvX Babylon initialization failed:', error);
    status(`3D viewer failed: ${error?.message || error}`, 'error');
    $('loading')?.classList.add('hide');
    const fatal = $('fatal');
    const text = $('fatalText');
    if (text) text.textContent = error?.message || String(error);
    if (fatal) fatal.style.display = 'block';
  }

  function disposeMesh(mesh) {
    if (mesh) mesh.dispose(false, true);
  }

  function makeTerrain() {
    const t = data.terrain;
    const xs = t.x, ys = t.y, raw = t.rawDepthKm;
    const nx = xs.length, ny = ys.length;
    if (nx < 2 || ny < 2) throw new Error('GEBCO grid is too small');

    const positions = new Float32Array(nx * ny * 3);
    const indices = [];
    let k = 0;
    for (let j = 0; j < ny; j++) {
      const row = raw[j] || [];
      for (let i = 0; i < nx; i++, k++) {
        const d = row[i];
        positions[k * 3] = xs[i];
        positions[k * 3 + 1] = ys[j];
        positions[k * 3 + 2] = finite(d) ? -d * depthEx : -2;
      }
    }
    for (let j = 0; j < ny - 1; j++) {
      for (let i = 0; i < nx - 1; i++) {
        const q = [raw[j]?.[i], raw[j]?.[i + 1], raw[j + 1]?.[i], raw[j + 1]?.[i + 1]];
        if (!q.every(finite)) continue;
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }

    const mesh = new BABYLON.Mesh('GEBCO seabed', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.applyToMesh(mesh, true);
    const mat = new BABYLON.StandardMaterial('seabed material', scene);
    mat.diffuseColor = new BABYLON.Color3(0.42, 0.30, 0.21);
    mat.specularColor = BABYLON.Color3.Black();
    mesh.material = mat;
    mesh.freezeWorldMatrix();
    return mesh;
  }

  function addLand() {
    const groups = [data.land || [], data.islands || []];
    const positions = [], indices = [];
    let offset = 0, count = 0;

    for (const polygons of groups) {
      for (const p of polygons) {
        if (!Array.isArray(p.vertices) || !Array.isArray(p.triangles)) continue;
        if (p.vertices.length < 3 || !p.triangles.length) continue;
        for (const q of p.vertices) {
          if (!Array.isArray(q) || !finite(+q[0]) || !finite(+q[1])) continue;
          positions.push(+q[0], +q[1], 12);
        }
        for (const tri of p.triangles) {
          if (!Array.isArray(tri) || tri.length < 3) continue;
          const a = +tri[0], b = +tri[1], c = +tri[2];
          if (![a,b,c].every(Number.isInteger)) continue;
          if (a < 0 || b < 0 || c < 0 || a >= p.vertices.length || b >= p.vertices.length || c >= p.vertices.length) continue;
          indices.push(offset + a, offset + b, offset + c);
        }
        offset += p.vertices.length;
        count++;
      }
    }

    if (!positions.length || !indices.length) return 0;
    const mesh = new BABYLON.Mesh('Natural Earth land', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.applyToMesh(mesh, true);
    const mat = new BABYLON.StandardMaterial('land material', scene);
    mat.diffuseColor = new BABYLON.Color3(0.25, 0.60, 0.33);
    mat.specularColor = BABYLON.Color3.Black();
    mesh.material = mat;
    mesh.renderingGroupId = 2;
    return count;
  }

  function addLines(name, parts, z, color) {
    const material = new BABYLON.StandardMaterial(`${name} material`, scene);
    material.emissiveColor = color;
    material.disableLighting = true;
    let n = 0;
    for (const part of parts || []) {
      if (!Array.isArray(part) || part.length < 2) continue;
      const pts = part.map(p => new BABYLON.Vector3(+p[0], +p[1], z));
      const line = BABYLON.MeshBuilder.CreateLines(`${name}-${n++}`, {points: pts, updatable: false}, scene);
      line.color = color;
      line.renderingGroupId = 3;
    }
    material.dispose();
  }

  function bounds() {
    const xs = data.terrain.x, ys = data.terrain.y;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const x of xs) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    for (const y of ys) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    return {minX, maxX, minY, maxY, cx:(minX+maxX)/2, cy:(minY+maxY)/2, size:Math.max(maxX-minX,maxY-minY)};
  }

  function fitCamera(mode = '3d') {
    const b = bounds();
    const d = Math.max(650, b.size * 1.5);
    if (mode === 'top') {
      camera.position.set(b.cx, b.cy, d * .95);
      camera.setTarget(new BABYLON.Vector3(b.cx, b.cy, 0));
    } else if (mode === 'under') {
      camera.position.set(b.cx + d*.45, b.cy - d*.45, -d*.25);
      camera.setTarget(new BABYLON.Vector3(b.cx, b.cy, -120));
    } else if (mode === 'profile') {
      camera.position.set(b.cx + d*.8, b.cy, d*.18);
      camera.setTarget(new BABYLON.Vector3(b.cx, b.cy, -120));
    } else {
      camera.position.set(b.cx + d*.72, b.cy - d*.82, d*.62);
      camera.setTarget(new BABYLON.Vector3(b.cx, b.cy, -Math.min(100, b.size*.05)));
    }
  }

  function build() {
    if (terrain) disposeMesh(terrain);
    if (water) disposeMesh(water);
    scene.meshes.slice().forEach(m => {
      if (m !== terrain && m !== water && m.name !== 'Camera') {
        if (m.metadata?.solvx) m.dispose(false, true);
      }
    });

    terrain = makeTerrain();
    terrain.metadata = {solvx:true};

    const b = bounds();
    water = BABYLON.MeshBuilder.CreatePlane('ocean surface', {width:b.maxX-b.minX, height:b.maxY-b.minY}, scene);
    water.rotation.x = Math.PI / 2;
    water.position.set(b.cx, b.cy, 3);
    const wm = new BABYLON.StandardMaterial('water material', scene);
    wm.diffuseColor = new BABYLON.Color3(0.05, 0.45, 0.68);
    wm.alpha = .22;
    wm.specularColor = new BABYLON.Color3(.4,.7,.85);
    water.material = wm;
    water.metadata = {solvx:true};
    water.renderingGroupId = 1;

    const landCount = addLand();
    addLines('coast', data.coast, 15, new BABYLON.Color3(.06,.25,.30));
    addLines('eez', data.eez, 14.5, new BABYLON.Color3(.72,.50,.08));

    fitCamera('3d');
    status(`3D ocean ready · ${landCount} land polygons`);
    $('loading')?.classList.add('hide');
  }

  function initBabylon() {
    const canvas = $('renderCanvas');
    if (!canvas) throw new Error('renderCanvas missing');
    if (!window.BABYLON) throw new Error('Babylon.js CDN did not load');

    engine = new BABYLON.Engine(canvas, true, {preserveDrawingBuffer:false, stencil:true}, true);
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(.875,.918,.945,1);
    scene.ambientColor = new BABYLON.Color3(.5,.5,.5);

    camera = new BABYLON.ArcRotateCamera('camera', -0.85, 1.0, 2500, BABYLON.Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 30;
    camera.upperRadiusLimit = 14000;
    camera.wheelPrecision = 2;
    camera.panningSensibility = 80;
    camera.inertia = .75;

    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0,0,1), scene);
    hemi.intensity = 1.6;
    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-.4,-.5,-1), scene);
    sun.intensity = 1.8;

    return engine;
  }

  async function init() {
    try {
      status('Starting Babylon.js renderer…', 'busy');
      initBabylon();
      status('Loading geometry.json…', 'busy');
      const r = await fetch(`geometry.json?${Date.now()}`, {cache:'no-store'});
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      data = await r.json();
      if (!data.terrain || !Array.isArray(data.terrain.x) || !Array.isArray(data.terrain.y)) throw new Error('Invalid geometry.json terrain');
      build();
      engine.runRenderLoop(() => scene.render());
      addEventListener('resize', () => engine.resize());
    } catch (e) { fail(e); }
  }

  $('exaggeration')?.addEventListener('input', e => {
    depthEx = +e.target.value || 55;
    $('exagValue').textContent = `${depthEx}×`;
    if (terrain) {
      const vd = terrain.getVerticesData(BABYLON.VertexBuffer.PositionKind);
      if (vd) {
        const raw = data.terrain.rawDepthKm;
        const nx = data.terrain.x.length, ny = data.terrain.y.length;
        for (let j=0;j<ny;j++) for (let i=0;i<nx;i++) {
          const k=j*nx+i, d=raw[j]?.[i];
          vd[k*3+2]=finite(d)?-d*depthEx:-2;
        }
        terrain.updateVerticesData(BABYLON.VertexBuffer.PositionKind, vd, false, false);
      }
    }
  });

  $('reset')?.addEventListener('click', () => fitCamera('3d'));
  $('fullscreen')?.addEventListener('click', () => document.documentElement.requestFullscreen?.());
  $('closeReadout')?.addEventListener('click', () => $('readout')?.classList.remove('show'));
  document.querySelectorAll('[data-view]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    fitCamera(btn.dataset.view || '3d');
  }));

  init();
})();
