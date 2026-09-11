import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const $ = (id) => document.getElementById(id);
const API = `${location.protocol === 'file:' ? 'http:' : location.protocol}//${location.hostname || '127.0.0.1'}:8000`;
const finite = (v) => Number.isFinite(Number(v));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const S = {
  scene: null, camera: null, renderer: null, controls: null,
  root: null, geometry: null,
  land: null, landSides: null, landBottom: null,
  coast: null, seabed: null, water: null, surface: null,
  catalog: [], times: [], ti: 0, active: 'temperature',
  depthEx: 10, ray: new THREE.Raycaster(), mouse: new THREE.Vector2(),
  playing: false, lastPlay: 0
};

async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
}

function setStatus(text, type = 'ok') {
  if ($('status')) $('status').textContent = text;
  if ($('statusDot')) $('statusDot').className = type === 'error' ? 'error' : type === 'busy' ? 'busy' : '';
}

function fail(err) {
  console.error(err);
  $('loading')?.classList.add('hidden');
  if ($('fatalText')) $('fatalText').textContent = err?.message || String(err);
  $('fatal')?.classList.add('show');
  setStatus(`Viewer failed · ${err?.message || err}`, 'error');
}

function dispose(obj) {
  if (!obj) return;
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });
  if (obj.parent) obj.parent.remove(obj);
}

function project(lon, lat) {
  const b = S.geometry?.bounds || [84, 93, 16, 24];
  const midLat = (b[2] + b[3]) * 0.5;
  const kmLat = 111.32;
  const kmLon = 111.32 * Math.cos(midLat * Math.PI / 180);
  return [
    (Number(lon) - (b[0] + b[1]) * 0.5) * kmLon,
    (Number(lat) - (b[2] + b[3]) * 0.5) * kmLat
  ];
}

function depthZ(depthMeters) {
  return -Math.max(0, Number(depthMeters)) * S.depthEx / 1000;
}

function lineGeometry(lines, z) {
  const p = [];
  for (const line of lines || []) {
    for (let i = 0; i < line.length - 1; i++) {
      p.push(line[i][0], line[i][1], z, line[i + 1][0], line[i + 1][1], z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return g;
}

function polygonGeometry(parts, z) {
  const p = [], idx = [];
  let base = 0;
  for (const part of parts || []) {
    for (const v of part.vertices || []) p.push(Number(v[0]), Number(v[1]), z);
    for (const t of part.triangles || []) idx.push(base + t[0], base + t[1], base + t[2]);
    base += (part.vertices || []).length;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function drawLand() {
  dispose(S.land);
  dispose(S.landSides);
  dispose(S.landBottom);

  const parts = [...(S.geometry.land || []), ...(S.geometry.islands || [])];
  const top = 0.35;
  const thickness = Math.max(2, Number(S.geometry.landThickness || 3) * S.depthEx / 1000);
  const bottom = top - thickness;

  S.land = new THREE.Mesh(
    polygonGeometry(parts, top),
    new THREE.MeshStandardMaterial({
      color: 0x3f9a45, roughness: 0.95, metalness: 0, side: THREE.DoubleSide
    })
  );
  S.land.renderOrder = 50;
  S.root.add(S.land);

  const sidePos = [], sideIdx = [];
  for (const part of parts) {
    const ring = part.top || [];
    if (ring.length < 2) continue;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      const q = sidePos.length / 3;
      sidePos.push(
        a[0], a[1], top,
        a[0], a[1], bottom,
        b[0], b[1], top,
        b[0], b[1], bottom
      );
      sideIdx.push(q, q + 2, q + 1, q + 2, q + 3, q + 1);
    }
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sidePos, 3));
  sg.setIndex(sideIdx);
  sg.computeVertexNormals();
  S.landSides = new THREE.Mesh(
    sg,
    new THREE.MeshStandardMaterial({ color: 0x76502f, roughness: 1, side: THREE.DoubleSide })
  );
  S.landSides.renderOrder = 48;
  S.root.add(S.landSides);

  S.landBottom = new THREE.Mesh(
    polygonGeometry(parts, bottom),
    new THREE.MeshStandardMaterial({ color: 0x593b28, roughness: 1, side: THREE.DoubleSide })
  );
  S.landBottom.renderOrder = 47;
  S.root.add(S.landBottom);
}

function drawCoast() {
  dispose(S.coast);
  const lines = [...(S.geometry.coast || []), ...(S.geometry.landBoundary || []), ...(S.geometry.islandCoast || [])];
  S.coast = new THREE.LineSegments(
    lineGeometry(lines, 0.48),
    new THREE.LineBasicMaterial({ color: 0x09281b })
  );
  S.coast.renderOrder = 80;
  S.root.add(S.coast);
}

function drawSeabed() {
  dispose(S.seabed);
  const t = S.geometry.terrain;
  if (!t?.x?.length || !t?.y?.length) throw new Error('GEBCO terrain is missing');

  const nx = t.x.length, ny = t.y.length;
  const pos = [], idx = [], map = new Int32Array(nx * ny);
  map.fill(-1);

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const d = Number((t.rawDepthKm[j] || [])[i]);
      if (!finite(d)) continue;
      map[j * nx + i] = pos.length / 3;
      pos.push(t.x[i], t.y[j], depthZ(d * 1000));
    }
  }

  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = map[j * nx + i];
      const b = map[j * nx + i + 1];
      const c = map[(j + 1) * nx + i];
      const d = map[(j + 1) * nx + i + 1];
      if (a >= 0 && b >= 0 && c >= 0 && d >= 0) idx.push(a, c, b, b, c, d);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  S.seabed = new THREE.Mesh(
    g,
    new THREE.MeshStandardMaterial({ color: 0x80542f, roughness: 0.98, metalness: 0, side: THREE.DoubleSide })
  );
  S.seabed.renderOrder = 5;
  S.root.add(S.seabed);
}

function terrainDepthKmAtGrid(i, j) {
  const row = S.geometry.terrain.rawDepthKm[j] || [];
  const d = Number(row[i]);
  return finite(d) ? Math.max(0, d) : NaN;
}

function buildWater() {
  dispose(S.water);
  S.water = new THREE.Group();

  const t = S.geometry.terrain;
  const nx = t.x.length, ny = t.y.length;
  const raw = t.rawDepthKm;

  // Keep the geometry lightweight while preserving the actual GEBCO coastline/depth shape.
  const step = Math.max(1, Math.ceil(Math.sqrt((nx * ny) / 14000)));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x278faf,
    transparent: true,
    opacity: 0.27,
    roughness: 0.18,
    metalness: 0,
    transmission: 0.05,
    ior: 1.333,
    depthWrite: false,
    side: THREE.DoubleSide
  });

  const cells = [];
  for (let j = 0; j < ny - 1; j += step) {
    for (let i = 0; i < nx - 1; i += step) {
      const i2 = Math.min(nx - 1, i + step);
      const j2 = Math.min(ny - 1, j + step);
      const ds = [];

      for (let yy = j; yy <= j2; yy++) {
        const row = raw[yy] || [];
        for (let xx = i; xx <= i2; xx++) {
          const d = Number(row[xx]);
          if (finite(d)) ds.push(d);
        }
      }
      if (!ds.length) continue;

      // Shallowest finite depth controls the bottom. This prevents water from cutting
      // through islands/coastal shelves inside a coarse cell.
      const depthKm = Math.max(0.01, Math.min(...ds));
      const x0 = t.x[i], x1 = t.x[i2];
      const y0 = t.y[j], y1 = t.y[j2];
      const h = Math.abs(depthZ(depthKm * 1000));
      if (h < 0.08) continue;

      cells.push({
        x: (x0 + x1) * 0.5,
        y: (y0 + y1) * 0.5,
        sx: Math.max(0.25, Math.abs(x1 - x0) * 0.98),
        sy: Math.max(0.25, Math.abs(y1 - y0) * 0.98),
        h,
        depthKm
      });
    }
  }

  if (!cells.length) throw new Error('Could not construct ocean water volume');

  const mesh = new THREE.InstancedMesh(box, mat, cells.length);
  const dummy = new THREE.Object3D();
  for (let n = 0; n < cells.length; n++) {
    const c = cells[n];
    dummy.position.set(c.x, c.y, -c.h * 0.5);
    dummy.scale.set(c.sx, c.sy, Math.max(0.08, c.h));
    dummy.updateMatrix();
    mesh.setMatrixAt(n, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData = { isWater: true, cells };
  mesh.renderOrder = 20;
  S.water.add(mesh);
  S.root.add(S.water);
  box.dispose();
}

function drawSurface() {
  dispose(S.surface);
  const b = S.geometry.bounds;
  const midLat = (b[2] + b[3]) * 0.5;
  const W = (b[1] - b[0]) * 111.32 * Math.cos(midLat * Math.PI / 180);
  const H = (b[3] - b[2]) * 111.32;
  const g = new THREE.PlaneGeometry(W, H, 1, 1);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshPhysicalMaterial({
    color: 0x2a94b7,
    transparent: true,
    opacity: 0.08,
    roughness: 0.2,
    transmission: 0.05,
    ior: 1.333,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  S.surface = new THREE.Mesh(g, m);
  S.surface.position.z = 0.55;
  S.surface.renderOrder = 60;
  S.root.add(S.surface);
}

function fitCamera() {
  if (!S.root || !S.controls || !S.camera) return;
  const box = new THREE.Box3().setFromObject(S.root);
  if (box.isEmpty()) return;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const r = Math.max(size.x, size.y, size.z, 1);
  S.controls.target.copy(center);
  S.camera.position.set(center.x + r * 1.12, center.y + r * 0.72, center.z + r * 1.25);
  S.camera.lookAt(center);
  S.controls.update();
}

function setupViews() {
  if (!S.controls || !S.camera) return;
  const box = new THREE.Box3().setFromObject(S.root);
  const c = box.getCenter(new THREE.Vector3());
  const s = box.getSize(new THREE.Vector3());
  const r = Math.max(s.x, s.y, s.z, 1);

  document.querySelectorAll('#views .view').forEach((b) => {
    b.onclick = () => {
      const v = b.dataset.view;
      if (v === 'top') S.camera.position.set(c.x, c.y, c.z + r * 1.55);
      else if (v === 'profile') S.camera.position.set(c.x + r * 1.55, c.y, c.z + r * 0.08);
      else if (v === 'under') S.camera.position.set(c.x + r * 0.8, c.y, c.z - r * 1.35);
      else fitCamera();
      S.controls.target.copy(c);
      S.controls.update();
      document.querySelectorAll('#views .view').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    };
  });
}

function renderVariables() {
  const host = $('vars');
  if (!host) return;
  host.innerHTML = '';
  const labels = {
    temperature: 'Temperature',
    temperature_anomaly: 'Sea surface temperature anomaly',
    salinity: 'Salinity',
    currents: 'Currents',
    sea_level: 'Sea level',
    chlorophyll: 'Chlorophyll'
  };
  const icons = { temperature: 'T', temperature_anomaly: '∆', salinity: 'S', currents: 'C', sea_level: 'η', chlorophyll: 'Ch' };
  for (const item of S.catalog) {
    const b = document.createElement('button');
    b.className = `var ${item.id === S.active ? 'active' : ''} ${item.available === false ? 'off' : ''}`;
    b.dataset.field = item.id;
    b.disabled = item.available === false;
    b.innerHTML = `<span class="vicon">${icons[item.id] || '•'}</span><span><b>${item.label || labels[item.id] || item.id}</b><small>${item.units || 'inspection only'}</small></span><span class="dot"></span>`;
    b.onclick = () => {
      S.active = item.id;
      renderVariables();
      setStatus(`${item.label || labels[item.id] || item.id} · inspection only`);
    };
    host.appendChild(b);
  }
}

function fmt(v, unit) {
  if (!finite(v)) return '—';
  const n = Number(v);
  return `${n.toFixed(Math.abs(n) < 1 ? 4 : 2)} ${unit || ''}`.trim();
}

function showPoint(data, lon, lat) {
  const p = data?.values || data || {};
  $('coords').textContent = `${Number(lat).toFixed(4)}° N · ${Number(lon).toFixed(4)}° E`;
  const rows = [
    ['Temperature', p.temperature, '°C'],
    ['Salinity', p.salinity, 'PSU'],
    ['Chlorophyll', p.chlorophyll, 'mg m⁻³'],
    ['Sea level', p.sea_level ?? p.seaLevel, 'm'],
    ['SST anomaly', p.temperature_anomaly ?? p.sst_anomaly, '°C']
  ];
  $('readoutGrid').innerHTML = rows.map(([name, value, unit]) => `<div class="rval"><b>${name}</b><span>${fmt(value, unit)}</span></div>`).join('');
  $('readoutTime').textContent = data?.time || S.times[S.ti] || 'Current time';
  $('readout')?.classList.remove('hidden');
}

async function inspectPoint(lon, lat) {
  try {
    setStatus('Reading ocean point…', 'busy');
    const q = new URLSearchParams({ lon: String(lon), lat: String(lat) });
    if (S.times[S.ti]) q.set('time', S.times[S.ti]);
    const data = await getJSON(`/ocean/point?${q}`);
    showPoint(data, lon, lat);
    setStatus('Ocean point inspected');
  } catch (e) {
    setStatus(`Point lookup failed · ${e.message}`, 'error');
  }
}

function clickOcean(e) {
  if (!S.renderer || !S.camera || !S.water) return;
  const rect = S.renderer.domElement.getBoundingClientRect();
  S.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  S.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  S.ray.setFromCamera(S.mouse, S.camera);

  const hits = S.ray.intersectObjects(S.water.children, true);
  const hit = hits.find((h) => h.object?.userData?.isWater && h.instanceId != null);
  if (!hit) return;

  const cell = hit.object.userData.cells[hit.instanceId];
  if (!cell) return;
  const b = S.geometry.bounds;
  const midLat = (b[2] + b[3]) * 0.5;
  const kmLon = 111.32 * Math.cos(midLat * Math.PI / 180);
  const lon = (b[0] + b[1]) * 0.5 + cell.x / kmLon;
  const lat = (b[2] + b[3]) * 0.5 + cell.y / 111.32;
  inspectPoint(lon, lat);
}

function setupUI() {
  $('reset')?.addEventListener('click', fitCamera);
  $('fullscreen')?.addEventListener('click', () => document.documentElement.requestFullscreen?.());
  $('closeReadout')?.addEventListener('click', () => $('readout')?.classList.add('hidden'));

  $('renderCanvas')?.addEventListener('pointerdown', (e) => {
    if (e.button === 0) clickOcean(e);
  });

  $('exaggeration')?.addEventListener('input', (e) => {
    S.depthEx = Number(e.target.value);
    if ($('exagValue')) $('exagValue').textContent = `${S.depthEx}×`;
    drawLand(); drawSeabed(); buildWater();
    fitCamera();
  });

  $('play')?.addEventListener('click', () => {
    S.playing = !S.playing;
    $('play').textContent = S.playing ? 'PAUSE' : 'PLAY';
  });
  $('timeSlider')?.addEventListener('input', (e) => {
    S.ti = Number(e.target.value);
    updateTimeUI();
  });
  $('closeReadout')?.addEventListener('click', () => $('readout')?.classList.add('hidden'));
}

function updateTimeUI() {
  const t = S.times[S.ti] || '';
  if ($('timeValue')) $('timeValue').textContent = t ? new Date(t).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }) : 'Ocean time';
  if ($('timeRaw')) $('timeRaw').textContent = t || '—';
  if ($('timeSlider')) {
    $('timeSlider').max = Math.max(0, S.times.length - 1);
    $('timeSlider').value = S.ti;
  }
  if ($('timeCount')) $('timeCount').textContent = `${S.ti + 1}/${Math.max(1, S.times.length)}`;
}

function animate(ms = 0) {
  requestAnimationFrame(animate);
  if (S.playing && S.times.length > 1 && ms - S.lastPlay > 900) {
    S.lastPlay = ms;
    S.ti = (S.ti + 1) % S.times.length;
    updateTimeUI();
  }
  S.controls?.update();
  S.renderer?.render(S.scene, S.camera);
}

async function init() {
  // IMPORTANT: geometry is the only thing needed to build the 3D chunk.
  // No regional variable request is made here.
  S.geometry = await getJSON('/geometry.json');

  S.catalog = await getJSON(`${API}/ocean/catalog`).catch(() => []);
  const timeData = await getJSON(`${API}/ocean/time`).catch(() => []);
  S.times = Array.isArray(timeData) ? timeData : (timeData.times || []);
  S.ti = 0;

  S.scene = new THREE.Scene();
  S.scene.background = new THREE.Color(0xb9dfe9);
  S.scene.fog = new THREE.Fog(0xb9dfe9, 1200, 5200);

  S.camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100000);
  S.camera.position.set(800, 650, 900);

  S.renderer = new THREE.WebGLRenderer({ canvas: $('renderCanvas'), antialias: true, powerPreference: 'high-performance' });
  S.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  S.renderer.setSize(innerWidth, innerHeight);
  S.renderer.outputColorSpace = THREE.SRGBColorSpace;

  S.scene.add(new THREE.HemisphereLight(0xffffff, 0x49636b, 2.0));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(400, 700, 800);
  S.scene.add(sun);

  S.root = new THREE.Group();
  S.scene.add(S.root);

  // Build the chunk in a deterministic order: seabed -> land -> coast -> water -> surface.
  drawSeabed();
  drawLand();
  drawCoast();
  buildWater();
  drawSurface();

  // Create controls BEFORE fitting or activating views. This fixes the previous
  // "Cannot read properties of null (reading 'target')" initialization failure.
  S.controls = new OrbitControls(S.camera, S.renderer.domElement);
  S.controls.enableDamping = true;
  S.controls.dampingFactor = 0.055;
  S.controls.screenSpacePanning = true;
  S.controls.minDistance = 100;
  S.controls.maxDistance = 6000;
  S.controls.target.set(0, 0, 0);

  renderVariables();
  setupViews();
  setupUI();
  updateTimeUI();
  if ($('depthMax')) $('depthMax').textContent = `${Number(S.geometry.terrain.maxDepthKm || 0).toFixed(1)} km`;
  if ($('depthValue')) $('depthValue').textContent = 'Volume';
  $('loading')?.classList.add('hidden');
  setStatus('3D ocean chunk ready');
  fitCamera();
  animate();
}

addEventListener('resize', () => {
  if (!S.camera || !S.renderer) return;
  S.camera.aspect = innerWidth / innerHeight;
  S.camera.updateProjectionMatrix();
  S.renderer.setSize(innerWidth, innerHeight);
});

init().catch(fail);
