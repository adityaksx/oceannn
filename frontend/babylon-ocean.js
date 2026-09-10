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
const LAND_TOP_Y = 10;
const WATER_BUMP_URL = 'https://www.babylonjs-playground.com/textures/waterbump.png';

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

// IMPORTANT: data.py already converts lon/lat to kilometres.
// Do NOT project these values again as degrees.
function geo() {
  const xs = data.terrain.x;
  const zs = data.terrain.y;
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minZ = Math.min(...zs), maxZ = Math.max(...zs);
  return {
    minX, maxX, minZ, maxZ,
    width: maxX - minX,
    height: maxZ - minZ,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    size: Math.max(maxX - minX, maxZ - minZ)
  };
}

// Input geometry is already in the same local-km coordinate system.
function xy(x, y) { return [+x, +y]; }

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
  m.diffuseColor = new BABYLON.Color3(0.075, 0.30, 0.095);
  m.emissiveColor = new BABYLON.Color3(0.008, 0.035, 0.010);
  m.specularColor = BABYLON.Color3.Black();
  m.backFaceCulling = false;
  return m;
}

function seabedMaterial() {
  const m = new BABYLON.StandardMaterial('soil seabed', scene);
  m.diffuseColor = new BABYLON.Color3(0.30, 0.18, 0.095);
  m.emissiveColor = new BABYLON.Color3(0.018, 0.010, 0.006);
  m.specularColor = new BABYLON.Color3(0.035, 0.025, 0.015);
  m.backFaceCulling = false;
  return m;
}

function waterMaterial() {
  const m = new BABYLON.StandardMaterial('opaque ocean surface', scene);
  m.diffuseColor = new BABYLON.Color3(0.015, 0.30, 0.76);
  m.emissiveColor = new BABYLON.Color3(0.002, 0.025, 0.085);
  m.specularColor = new BABYLON.Color3(0.50, 0.72, 1.0);
  m.specularPower = 96;
  m.alpha = 1;
  m.backFaceCulling = false;
  waterBump = new BABYLON.Texture(WATER_BUMP_URL, scene);
  waterBump.uScale = 7;
  waterBump.vScale = 7;
  waterBump.level = 0.55;
  m.bumpTexture = waterBump;
  return m;
}

function makeSeabed() {
  const t = data.terrain;
  const xs = t.x, zs = t.y, raw = t.rawDepthKm;
  const nx = xs.length, nz = zs.length;
  const positions = new Float32Array(nx * nz * 3);
  const indices = [];
  let k = 0;

  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++, k++) {
      const d = raw[j]?.[i];
      positions[k * 3] = xs[i];
      positions[k * 3 + 1] = finite(d) ? -d * depthEx * 8 : -80;
      positions[k * 3 + 2] = zs[j];
    }
  }

  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const q = [raw[j]?.[i], raw[j]?.[i + 1], raw[j + 1]?.[i], raw[j + 1]?.[i + 1]];
      if (!q.every(finite)) continue;
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const mesh = makeMesh('REAL SOIL GEBCO SEABED', Array.from(positions), indices, seabedMaterial());
  mesh.renderingGroupId = 0;
  return mesh;
}

function makeLand() {
  const mat = landMaterial();
  const maxSea = Math.max(80, Math.min(600, (data.terrain.maxDepthKm || 5) * depthEx * 4));
  const bottom = -maxSea;
  let count = 0;

  for (const polygons of [data.land || [], data.islands || []]) {
    for (const poly of polygons) {
      if (!poly?.vertices?.length || !poly?.triangles?.length) continue;
      const n = poly.vertices.length;
      const positions = [];

      for (const q of poly.vertices) positions.push(+q[0], LAND_TOP_Y, +q[1]);
      for (const q of poly.vertices) positions.push(+q[0], bottom, +q[1]);

      const indices = [];
      for (const tri of poly.triangles) {
        if (!Array.isArray(tri) || tri.length < 3) continue;
        const a = +tri[0], b = +tri[1], c = +tri[2];
        indices.push(a, c, b);
        indices.push(a + n, b + n, c + n);
      }

      // Extrude the polygon perimeter downwards to form real land cliffs.
      const ring = poly.top || [];
      for (let i = 0; i < ring.length - 1; i++) {
        let ia = -1, ib = -1, da = Infinity, db = Infinity;
        for (let v = 0; v < poly.vertices.length; v++) {
          const vx = +poly.vertices[v][0], vz = +poly.vertices[v][1];
          const a = Math.hypot(vx - ring[i][0], vz - ring[i][1]);
          const b = Math.hypot(vx - ring[i + 1][0], vz - ring[i + 1][1]);
          if (a < da) { da = a; ia = v; }
          if (b < db) { db = b; ib = v; }
        }
        if (ia >= 0 && ib >= 0) indices.push(ia, ib, ia + n, ib, ib + n, ia + n);
      }

      if (!indices.length) continue;
      const mesh = makeMesh(`FOREST LAND ${count}`, positions, indices, mat);
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
    const points = part.map(q => new BABYLON.Vector3(+q[0], y, +q[1]));
    const line = BABYLON.MeshBuilder.CreateLines(`${name}-${n}`, { points }, scene);
    line.color = color;
    line.renderingGroupId = 5;
    line.metadata = { solvx: true };
  }
}

function depthLevels() {
  const supplied = Array.isArray(data.temperatureDepthsM) ? data.temperatureDepthsM.filter(finite) : [];
  if (supplied.length) return supplied;
  const maxM = Math.max(1000, (data.terrain.maxDepthKm || 5) * 1000);
  return Array.from({ length: 32 }, (_, i) => maxM * i / 31);
}

function depthY(meters) {
  return -(meters / 1000) * depthEx * 8;
}

function layerColor(index, total) {
  const t = total <= 1 ? 1 : index / (total - 1);
  return new BABYLON.Color3(0.018 - 0.010 * t, 0.56 - 0.40 * t, 0.94 - 0.40 * t);
}

function makeWaterSurface() {
  if (waterSurface) waterSurface.dispose(false, true);
  const g = geo();
  const mesh = BABYLON.MeshBuilder.CreateGround('OPAQUE REAL OCEAN SURFACE', {
    width: g.width,
    height: g.height,
    subdivisions: 180
  }, scene);
  mesh.position.set(g.cx, SURFACE_Y, g.cz);
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
  const maxDepthM = levels.at(-1) || 1000;
  const bottomY = depthY(maxDepthM);

  levels.forEach((meters, i) => {
    const mesh = BABYLON.MeshBuilder.CreateGround(`TEMPERATURE DEPTH ${i + 1}`, {
      width: g.width,
      height: g.height,
      subdivisions: 1
    }, scene);
    mesh.position.set(g.cx, depthY(meters), g.cz);

    const c = layerColor(i, levels.length);
    const mat = new BABYLON.StandardMaterial(`opaque water layer ${i + 1}`, scene);
    mat.diffuseColor = c;
    mat.emissiveColor = new BABYLON.Color3(c.r * 0.05, c.g * 0.05, c.b * 0.07);
    mat.specularColor = BABYLON.Color3.Black();
    mat.alpha = 1;
    mat.backFaceCulling = false;
    mesh.material = mat;
    mesh.renderingGroupId = 1;
    mesh.metadata = { solvx: true, depthLevel: meters };
    layerMeshes.push(mesh);
  });

  // Four opaque walls form a real water volume for PROFILE/UNDER views.
  const corners = [
    [g.minX, g.minZ, g.maxX, g.minZ],
    [g.maxX, g.minZ, g.maxX, g.maxZ],
    [g.maxX, g.maxZ, g.minX, g.maxZ],
    [g.minX, g.maxZ, g.minX, g.minZ]
  ];
  corners.forEach((s, i) => {
    const [x1, z1, x2, z2] = s;
    const pos = [x1, SURFACE_Y, z1, x2, SURFACE_Y, z2, x2, bottomY, z2, x1, bottomY, z1];
    const mat = new BABYLON.StandardMaterial(`ocean wall ${i}`, scene);
    mat.diffuseColor = new BABYLON.Color3(0.008, 0.20, 0.54);
    mat.emissiveColor = new BABYLON.Color3(0.001, 0.015, 0.055);
    mat.specularColor = BABYLON.Color3.Black();
    mat.alpha = 1;
    mat.backFaceCulling = false;
    const wall = makeMesh(`OCEAN VOLUME WALL ${i}`, pos, [0, 1, 2, 0, 2, 3], mat);
    wall.renderingGroupId = 1;
    wallMeshes.push(wall);
  });

  return levels.length;
}

function setViewVisibility(mode) {
  const surface = mode !== 'under' && mode !== 'profile';
  if (waterSurface) waterSurface.setEnabled(surface);
  layerMeshes.forEach(m => m.setEnabled(!surface));
  wallMeshes.forEach(m => m.setEnabled(mode === 'under' || mode === 'profile'));
  if (seabed) seabed.setEnabled(true);
  landMeshes.forEach(m => m.setEnabled(true));
}

function fit(mode = '3d') {
  currentView = mode;
  const g = geo();
  const maxDepth = Math.abs(depthY(depthLevels().at(-1) || 1000));
  const d = Math.max(650, g.size * 1.45);

  if (mode === 'top') {
    camera.target.set(g.cx, 0, g.cz);
    camera.alpha = -Math.PI / 2;
    camera.beta = 0.10;
    camera.radius = d * 0.90;
  } else if (mode === 'profile') {
    camera.target.set(g.cx, -maxDepth * 0.38, g.cz);
    camera.alpha = 0.0;
    camera.beta = 1.28;
    camera.radius = d * 1.05;
  } else if (mode === 'under') {
    camera.target.set(g.cx, -maxDepth * 0.42, g.cz);
    camera.alpha = 0.58;
    camera.beta = 2.15;
    camera.radius = d * 0.90;
  } else {
    // Normal 3D map: camera is above the surface and aimed at the geographic centre.
    camera.target.set(g.cx, 0, g.cz);
    camera.alpha = -0.78;
    camera.beta = 0.88;
    camera.radius = d * 1.10;
  }
  setViewVisibility(mode);
}

function build() {
  scene.meshes.slice().forEach(m => { if (m.metadata?.solvx) m.dispose(false, true); });
  landMeshes = [];
  seabed = makeSeabed();
  const landCount = makeLand();
  addLines('COASTLINE', data.coast, LAND_TOP_Y + 1.5, new BABYLON.Color3(0.015, 0.08, 0.02));
  addLines('EEZ', data.eez, LAND_TOP_Y + 1.2, new BABYLON.Color3(0.95, 0.55, 0.04));
  const count = makeWaterLayers();
  makeWaterSurface();
  fit(currentView);
  status(`Ocean ready · ${landCount} forest land chunks · coastline · ${count} temperature depth levels`);
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
    hemi.intensity = 1.25;
    const sun = new BABYLON.DirectionalLight('sun', new BABYLON.Vector3(-0.5, -1, -0.4), scene);
    sun.intensity = 1.6;

    camera = new BABYLON.ArcRotateCamera('camera', -0.78, 0.88, 1500, BABYLON.Vector3.Zero(), scene);
    camera.attachControl(canvas, true);
    camera.lowerRadiusLimit = 30;
    camera.upperRadiusLimit = 12000;
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
