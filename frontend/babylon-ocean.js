(() => {
'use strict';

const $ = id => document.getElementById(id);
const finite = v => typeof v === 'number' && Number.isFinite(v);

let data = null;
let depthEx = 10;
let engine, scene, camera;
let seabed = null, waterSurface = null;
let layerMeshes = [], wallMeshes = [], landMeshes = [];
let waterBump = null, soilBump = null, landBump = null;
let currentView = '3d';

const DEG_KM = 111.32;
const SURFACE_Y = 0;
const LAND_TOP_Y = 8;
const SOIL_BOTTOM_Y = -120;
const WATER_BUMP_URL = 'https://www.babylonjs-playground.com/textures/waterbump.png';
const SOIL_BUMP_URL = 'https://www.babylonjs-playground.com/textures/floor_bump.PNG';
const GRASS_BUMP_URL = 'https://www.babylonjs-playground.com/textures/grassn.png';

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
  const xs = data.terrain.x, ys = data.terrain.y;
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const x of xs) { minLon = Math.min(minLon, x); maxLon = Math.max(maxLon, x); }
  for (const y of ys) { minLat = Math.min(minLat, y); maxLat = Math.max(maxLat, y); }
  const lat0 = (minLat + maxLat) / 2;
  const lon0 = (minLon + maxLon) / 2;
  const kmLon = DEG_KM * Math.cos(lat0 * Math.PI / 180);
  return {
    minLon, maxLon, minLat, maxLat, lon0, lat0, kmLon,
    minX: (minLon - lon0) * kmLon,
    maxX: (maxLon - lon0) * kmLon,
    minZ: (minLat - lat0) * DEG_KM,
    maxZ: (maxLat - lat0) * DEG_KM,
    width: (maxLon - minLon) * kmLon,
    height: (maxLat - minLat) * DEG_KM
  };
}

function xy(lon, lat) {
  const g = geo();
  return [(lon - g.lon0) * g.kmLon, (lat - g.lat0) * DEG_KM];
}

function makeMesh(name, positions, indices, material) {
  const mesh = new BABYLON.Mesh(name, scene);
  const vd = new BABYLON.VertexData();
  vd.positions = positions;
  vd.indices = indices;
  vd.applyToMesh(mesh, true);
  mesh.material = material;
  mesh.metadata = { solvx: true };
  return mesh;
}

function landMaterial() {
  const m = new BABYLON.StandardMaterial('forest cover land', scene);
  m.diffuseColor = new BABYLON.Color3(0.055, 0.26, 0.075);
  m.emissiveColor = new BABYLON.Color3(0.008, 0.045, 0.012);
  m.specularColor = BABYLON.Color3.Black();
  m.backFaceCulling = false;
  m.disableLighting = false;
  landBump = new BABYLON.Texture(GRASS_BUMP_URL, scene);
  landBump.uScale = 5;
  landBump.vScale = 5;
  landBump.level = 0.18;
  m.bumpTexture = landBump;
  return m;
}

function seabedMaterial() {
  const m = new BABYLON.StandardMaterial('soil seabed', scene);
  m.diffuseColor = new BABYLON.Color3(0.28, 0.16, 0.085);
  m.emissiveColor = new BABYLON.Color3(0.018, 0.010, 0.006);
  m.specularColor = new BABYLON.Color3(0.04, 0.03, 0.02);
  m.backFaceCulling = false;
  soilBump = new BABYLON.Texture(SOIL_BUMP_URL, scene);
  soilBump.uScale = 4;
  soilBump.vScale = 4;
  soilBump.level = 0.45;
  m.bumpTexture = soilBump;
  return m;
}

function waterMaterial() {
  const m = new BABYLON.StandardMaterial('opaque ocean surface', scene);
  m.diffuseColor = new BABYLON.Color3(0.015, 0.27, 0.72);
  m.emissiveColor = new BABYLON.Color3(0.003, 0.035, 0.11);
  m.specularColor = new BABYLON.Color3(0.55, 0.75, 1.0);
  m.specularPower = 96;
  m.alpha = 1;
  m.backFaceCulling = false;
  waterBump = new BABYLON.Texture(WATER_BUMP_URL, scene);
  waterBump.uScale = 7;
  waterBump.vScale = 7;
  waterBump.level = 0.7;
  m.bumpTexture = waterBump;
  return m;
}

function makeSeabed() {
  const t = data.terrain, xs = t.x, ys = t.y, raw = t.rawDepthKm;
  const nx = xs.length, ny = ys.length;
  const positions = new Float32Array(nx * ny * 3);
  const indices = [];
  let k = 0;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++, k++) {
      const p = xy(xs[i], ys[j]);
      const d = raw[j]?.[i];
      positions[k * 3] = p[0];
      positions[k * 3 + 1] = finite(d) ? -d * depthEx * 8 : SOIL_BOTTOM_Y;
      positions[k * 3 + 2] = p[1];
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
  const mesh = makeMesh('REAL SOIL SEABED', Array.from(positions), indices, seabedMaterial());
  mesh.renderingGroupId = 0;
  return mesh;
}

function makeLand() {
  const mat = landMaterial();
  const maxSea = Math.max(120, Math.min(600, (data.terrain.maxDepthKm || 5) * depthEx * 4));
  const bottom = -maxSea;
  let count = 0;
  for (const polygons of [data.land || [], data.islands || []]) {
    for (const poly of polygons) {
      if (!poly?.vertices?.length || !poly?.triangles?.length) continue;
      const n = poly.vertices.length;
      const positions = [];
      for (const q of poly.vertices) { const p = xy(+q[0], +q[1]); positions.push(p[0], LAND_TOP_Y, p[1]); }
      for (const q of poly.vertices) { const p = xy(+q[0], +q[1]); positions.push(p[0], bottom, p[1]); }
      const indices = [];
      for (const tri of poly.triangles) {
        if (!Array.isArray(tri) || tri.length < 3) continue;
        const a = +tri[0], b = +tri[1], c = +tri[2];
        indices.push(a, c, b, a + n, b + n, c + n);
      }
      const ring = poly.top || [];
      for (let i = 0; i < ring.length - 1; i++) {
        const a = xy(+ring[i][0], +ring[i][1]);
        const b = xy(+ring[i + 1][0], +ring[i + 1][1]);
        let ia = -1, ib = -1, da = Infinity, db = Infinity;
        for (let v = 0; v < poly.vertices.length; v++) {
          const p = xy(+poly.vertices[v][0], +poly.vertices[v][1]);
          const xa = Math.hypot(p[0] - a[0], p[1] - a[1]);
          const xb = Math.hypot(p[0] - b[0], p[1] - b[1]);
          if (xa < da) { da = xa; ia = v; }
          if (xb < db) { db = xb; ib = v; }
        }
        if (ia >= 0 && ib >= 0) indices.push(ia, ib, ia + n, ib, ib + n, ia + n);
      }
      if (!indices.length) continue;
      const mesh = makeMesh(`FOREST LAND CHUNK ${count}`, positions, indices, mat);
      mesh.renderingGroupId = 3;
      landMeshes.push(mesh);
      count++;
    }
  }
  return count;
}

function addLines(name, parts, y, color) {
  for (let n = 0; n < (parts || []).length; n++) {
    const part = parts[n];
    if (!part || part.length < 2) continue;
    const points = part.map(q => { const p = xy(+q[0], +q[1]); return new BABYLON.Vector3(p[0], y, p[1]); });
    const line = BABYLON.MeshBuilder.CreateLines(`${name}-${n}`, { points }, scene);
    line.color = color;
    line.renderingGroupId = 4;
    line.metadata = { solvx: true };
  }
}

function depthLevels() {
  const supplied = Array.isArray(data.temperatureDepthsM) ? data.temperatureDepthsM.filter(finite) : [];
  if (supplied.length) return supplied;
  const maxM = Math.max(1000, (data.terrain.maxDepthKm || 5) * 1000);
  const fallback = 32;
  return Array.from({ length: fallback }, (_, i) => maxM * i / (fallback - 1));
}

function depthY(meters) {
  return -meters / 1000 * depthEx * 8;
}

function layerColor(index, total) {
  const t = total <= 1 ? 1 : index / (total - 1);
  return new BABYLON.Color3(
    0.02 - 0.012 * t,
    0.55 - 0.43 * t,
    0.92 - 0.38 * t
  );
}

function makeWaterSurface() {
  if (waterSurface) waterSurface.dispose(false, true);
  const g = geo();
  const mesh = BABYLON.MeshBuilder.CreateGround('OPAQUE REALISTIC OCEAN SURFACE', {
    width: g.width,
    height: g.height,
    subdivisions: 180
  }, scene);
  mesh.position.set(0, SURFACE_Y, 0);
  mesh.material = waterMaterial();
  mesh.renderingGroupId = 2;
  mesh.metadata = { solvx: true, waterSurface: true };
  waterSurface = mesh;
}

function makeWaterLayers() {
  layerMeshes.forEach(m => m.dispose(false, true));
  wallMeshes.forEach(m => m.dispose(false, true));
  layerMeshes = [];
  wallMeshes = [];

  const g = geo();
  const levels = depthLevels();
  const maxDepth = levels[levels.length - 1] || 1000;

  // One opaque horizontal stratum for every temperature depth level.
  levels.forEach((meters, i) => {
    const y = depthY(meters);
    const mesh = BABYLON.MeshBuilder.CreateGround(`WATER DEPTH LEVEL ${i + 1}`, {
      width: g.width,
      height: g.height,
      subdivisions: 1
    }, scene);
    mesh.position.set(0, y, 0);
    const c = layerColor(i, levels.length);
    const mat = new BABYLON.StandardMaterial(`water depth material ${i + 1}`, scene);
    mat.diffuseColor = c;
    mat.emissiveColor = new BABYLON.Color3(c.r * 0.06, c.g * 0.06, c.b * 0.08);
    mat.specularColor = BABYLON.Color3.Black();
    mat.alpha = 1;
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.renderingGroupId = 1;
    mesh.metadata = { solvx: true, depthLevel: meters };
    layerMeshes.push(mesh);
  });

  // A continuous opaque blue side wall makes the water a solid chunk.
  const sides = [
    [[g.minX, 0, g.minZ], [g.maxX, 0, g.minZ]],
    [[g.maxX, 0, g.minZ], [g.maxX, 0, g.maxZ]],
    [[g.maxX, 0, g.maxZ], [g.minX, 0, g.maxZ]],
    [[g.minX, 0, g.maxZ], [g.minX, 0, g.minZ]]
  ];
  sides.forEach((s, side) => {
    const p0 = s[0], p1 = s[1];
    const positions = [p0[0], 0, p0[2], p1[0], 0, p1[2], p1[0], -maxDepth / 1000 * depthEx * 8, p1[2], p0[0], -maxDepth / 1000 * depthEx * 8, p0[2]];
    const mat = new BABYLON.StandardMaterial(`ocean wall material ${side}`, scene);
    mat.diffuseColor = new BABYLON.Color3(0.008, 0.22, 0.58);
    mat.emissiveColor = new BABYLON.Color3(0.001, 0.02, 0.07);
    mat.specularColor = BABYLON.Color3.Black();
    mat.alpha = 1;
    mat.backFaceCulling = false;
    const mesh = makeMesh(`SOLID OCEAN CUTAWAY WALL ${side}`, positions, [0, 1, 2, 0, 2, 3], mat);
    mesh.renderingGroupId = 1;
    wallMeshes.push(mesh);
  });

  $('status').dataset.depthCount = String(levels.length);
  return levels.length;
}

function setUnderMode(under) {
  if (waterSurface) waterSurface.setEnabled(!under);
  wallMeshes.forEach(m => m.setEnabled(true));
  layerMeshes.forEach(m => m.setEnabled(true));
  if (seabed) seabed.setEnabled(true);
}

function fit(mode = '3d') {
  currentView = mode;
  const g = geo();
  const maxDepth = (depthLevels().at(-1) || 1000) / 1000 * depthEx * 8;
  const horizontal = Math.max(g.width, g.height);
  const d = Math.max(650, horizontal * 1.22);
  const targetY = mode === 'under' ? -maxDepth * 0.45 : -maxDepth * 0.18;
  camera.target.set(0, targetY, 0);

  if (mode === 'top') {
    camera.alpha = -Math.PI / 2;
    camera.beta = 0.12;
    camera.radius = d * 0.98;
    setUnderMode(false);
  } else if (mode === 'profile') {
    camera.alpha = 0;
    camera.beta = 1.22;
    camera.radius = d * 1.04;
    setUnderMode(false);
  } else if (mode === 'under') {
    camera.alpha = 0.62;
    camera.beta = 2.28;
    camera.radius = d * 0.84;
    setUnderMode(true);
  } else {
    camera.alpha = -0.82;
    camera.beta = 1.04;
    camera.radius = d * 1.05;
    setUnderMode(false);
  }
}

function build() {
  scene.meshes.slice().forEach(m => { if (m.metadata?.solvx) m.dispose(false, true); });
  landMeshes = [];
  seabed = makeSeabed();
  const landCount = makeLand();
  addLines('coast', data.coast, LAND_TOP_Y + 1.5, new BABYLON.Color3(0.01, 0.09, 0.025));
  addLines('eez', data.eez, LAND_TOP_Y + 1.2, new BABYLON.Color3(0.95, 0.55, 0.04));
  makeWaterLayers();
  makeWaterSurface();
  fit(currentView);
  const count = depthLevels().length;
  const source = data.temperatureDepthsM?.length ? 'temperature.nc' : 'fallback bathymetry';
  status(`Ocean ready · ${landCount} forest land chunks · ${count} depth levels from ${source}`);
  $('loading').classList.add('hide');
}

async function init() {
  try {
    if (!window.BABYLON) throw new Error('Babylon.js CDN did not load');
    const canvas = $('renderCanvas');
    engine = new BABYLON.Engine(canvas, true, { stencil: true, preserveDrawingBuffer: false }, true);
    scene = new BABYLON.Scene(engine);
    scene.clearColor = new BABYLON.Color4(0.86, 0.91, 0.95, 1);

    const hemi = new BABYLON.HemisphericLight('hemi', new BABYLON.Vector3(0, 1, 0), scene);
    hemi.intensity = 1.35;
    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, -0.4), scene);
    sun.intensity = 1.8;

    camera = new BABYLON.ArcRotateCamera('camera', -0.82, 1.04, 1500, BABYLON.Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 30;
    camera.upperRadiusLimit = 9000;
    camera.wheelPrecision = 2;
    camera.panningSensibility = 90;

    status('Loading geometry.json…', 'busy');
    const response = await fetch(`geometry.json?${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    data = await response.json();
    if (!data.terrain?.x?.length || !data.terrain?.y?.length) throw new Error('Invalid terrain grid');

    build();
    engine.runRenderLoop(() => {
      if (waterBump) {
        waterBump.uOffset += 0.00035;
        waterBump.vOffset += 0.00014;
      }
      scene.render();
    });
    addEventListener('resize', () => engine.resize());
  } catch (error) {
    fail(error);
  }
}

$('exaggeration').value = 10;
$('exagValue').textContent = '10×';
$('exaggeration').addEventListener('input', e => {
  depthEx = +(e.target.value || 10);
  $('exagValue').textContent = `${depthEx}×`;
  build();
});

$('reset').onclick = () => fit('3d');
$('fullscreen').onclick = () => document.documentElement.requestFullscreen?.();

document.querySelectorAll('[data-view]').forEach(button => {
  button.onclick = () => {
    document.querySelectorAll('[data-view]').forEach(x => x.classList.remove('active'));
    button.classList.add('active');
    fit(button.dataset.view);
  };
});

init();
})();
