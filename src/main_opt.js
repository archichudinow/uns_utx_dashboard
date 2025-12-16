import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

import { loadCSV } from './scripts/csv_to_points.js';
import { Pane } from 'tweakpane';
import Stats from 'stats.js';

/* ---------------------------------------------------- */
/* DEVICE / PERF                                        */
/* ---------------------------------------------------- */
const IS_MOBILE = /iPhone|iPad|Android/i.test(navigator.userAgent);
const MAX_DPR = IS_MOBILE ? 2 : 1.25;
const USE_POST = false;

/* ---------------------------------------------------- */
/* BASIC SETUP                                          */
/* ---------------------------------------------------- */
const stats = new Stats();
document.body.appendChild(stats.dom);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e0d9ce');

/* ---------------- LIGHTS --------------------------- */
scene.add(new THREE.AmbientLight(0xffffff, 3));

const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(1000, 1500, 1000);
dirLight.castShadow = true;

const SHADOW_SIZE = IS_MOBILE ? 2048 : 1024;
dirLight.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
dirLight.shadow.radius = 0;
dirLight.shadow.bias = -0.00005;

dirLight.target.position.set(0, 0, 0);
dirLight.shadow.camera.left = -1000;
dirLight.shadow.camera.right = 1000;
dirLight.shadow.camera.top = 1000;
dirLight.shadow.camera.bottom = -1000;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 3000;

//scene.add(dirLight);
//scene.add(dirLight.target);

/* ---------------- GROUND --------------------------- */
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(5000, 5000),
  new THREE.ShadowMaterial({ opacity: 0.2 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.6;
ground.receiveShadow = true;
scene.add(ground);

/* ---------------- CAMERA / RENDERER ---------------- */
const camera = new THREE.PerspectiveCamera(12, window.innerWidth / window.innerHeight, 1, 10000);
camera.position.set(-400, 600, -1000);

const canvas = document.querySelector('canvas.threejs');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

/* ---------------- POST (OPTIONAL) ------------------ */
let composer = null;
if (USE_POST) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
}

/* ---------------- CONTROLS ------------------------- */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, -250);

/* ---------------- UI ------------------------------- */
const pane = new Pane();
const settings = { showHeat: false, showGLTF: true };

/* ---------------- HEAT PARAMETERS ------------------ */
const HEAT_PARAMS = {
  radius: 4,
  agentStrength: 0.4,
  min: 0,
  max: 4,
  falloff: 4
};
let invHeatRange = 1 / (HEAT_PARAMS.max - HEAT_PARAMS.min);

/* ---------------- STORAGE -------------------------- */
const objects = {
  gltfModel: null,
  heatMeshes: [],
  pointClouds: []
};

/* ---------------- SPATIAL GRID --------------------- */
function buildSpatialGrid(mesh, cellSize) {
  const { vx, vy, vz } = mesh.userData;
  const grid = new Map();
  for (let i = 0; i < vx.length; i++) {
    const key =
      Math.floor(vx[i] / cellSize) +
      Math.floor(vy[i] / cellSize) * 10000 +
      Math.floor(vz[i] / cellSize) * 100000000;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i);
  }
  mesh.userData.grid = grid;
  mesh.userData.cellSize = cellSize;
}

/* ---------------- INIT HEAT MESH ------------------ */
function initHeatMesh(originalMesh) {
  const mesh = new THREE.Mesh(
    originalMesh.geometry.clone(),
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.NormalBlending,
      opacity: 1.0
    })
  );

  mesh.geometry.computeBoundingSphere();

  const pos = mesh.geometry.attributes.position;
  const count = pos.count;

  const colors = new Float32Array(count * 4);
  const heat = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const vz = new Float32Array(count);

  const v = new THREE.Vector3();
  const m = originalMesh.matrixWorld;

  for (let i = 0; i < count; i++) {
    v.set(pos.array[i*3], pos.array[i*3+1], pos.array[i*3+2]).applyMatrix4(m);
    vx[i] = v.x;
    vy[i] = v.y;
    vz[i] = v.z;

    colors[i*4]   = 1.0;  // r
    colors[i*4+1] = 1.0;  // g
    colors[i*4+2] = 1.0;  // b
    colors[i*4+3] = 0.0;  // alpha initially transparent
  }

  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  mesh.userData = { heat, vx, vy, vz, dirty: new Set(), worldBS: mesh.geometry.boundingSphere.clone() };

  buildSpatialGrid(mesh, HEAT_PARAMS.radius);
  mesh.visible = false;

  scene.add(mesh);
  objects.heatMeshes.push(mesh);
}

/* ---------------- LOAD GLTF ------------------------ */
const loader = new GLTFLoader();
loader.load('/models/map_high.glb', gltf => {
  objects.gltfModel = gltf.scene;

  gltf.scene.traverse(o => {
    if (!o.isMesh) return;

    o.castShadow = true;
    o.receiveShadow = true;

    if (o.material) {
      o.material = new THREE.MeshStandardMaterial({
        color: 0xffffff,     // solid white
        roughness: 0.7,
        metalness: 0,
        envMapIntensity: 0.4
      });
      o.material.needsUpdate = true;
    }

    initHeatMesh(o);
  });

  scene.add(gltf.scene);
});

/* ---------------- CSV LOAD ------------------------ */
const markerGeo = new THREE.SphereGeometry(2, 16, 16);
const markerMat = new THREE.MeshBasicMaterial({ color: 'black' });

async function loadCSVs() {
  const urls = [
    '/csv/P1_S2_CHART.csv','/csv/P1_S4_CHART.csv','/csv/P2_S1A_CHART.csv',
    '/csv/P2_S2_CHART.csv','/csv/P2_S3_CHART.csv','/csv/P2_S4_CHART.csv',
    '/csv/P3_S1A_CHART.csv','/csv/P3_S2_CHART.csv','/csv/P3_S3_CHART.csv',
    '/csv/P3_S4_CHART.csv'
  ];

  for (const url of urls) {
    const pc = await loadCSV(url);
    if (!pc) continue;

    pc.scale.setScalar(0.01);
    pc.geometry.setDrawRange(0, 0);
    scene.add(pc);

    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.visible = false;
    scene.add(marker);

    pc.userData.marker = marker;
    objects.pointClouds.push(pc);
  }
}
loadCSVs();

/* ---------------- PLAYBACK ------------------------- */
const playback = { frame: 0, playing: false, speed: 5 };
let longestCSV = 0;
let ready = false;

async function initPlayback() {
  while (!objects.pointClouds.length) await new Promise(r => setTimeout(r, 50));

  objects.pointClouds.forEach(pc => {
    longestCSV = Math.max(longestCSV, pc.geometry.attributes.position.count);
  });

  const fPlayback = pane.addFolder({ title: 'Playback' });
  fPlayback.addBinding(playback, 'frame', { min: 0, max: longestCSV, step: 1 });
  fPlayback.addBinding(playback, 'playing');

  const fView = pane.addFolder({ title: 'View' });
  fView.addBinding(settings, 'showHeat');
  fView.addBinding(settings, 'showGLTF');

  ready = true;
}
initPlayback();

/* ---------------- HEAT COLOR ----------------------- */
const heatColor = (() => {
  const c = new THREE.Color();
  return t => {
    if (t < 0.25) { const f = t / 0.25; c.setRGB(1 - f, 1, 1); }
    else if (t < 0.5) { const f = (t - 0.25) / 0.25; c.setRGB(0, 1, 1 - f); }
    else if (t < 0.75) { const f = (t - 0.5) / 0.25; c.setRGB(f, 1, 0); }
    else { const f = (t - 0.75) / 0.25; c.setRGB(1, 1 - f, 0); }
    return c;
  };
})();

/* ---------------- HEAT UPDATE ---------------------- */
const tmpVec = new THREE.Vector3();
let heatFrameSkip = 0;

function updateHeat(frame) {
  if ((heatFrameSkip++ & 1) === 1) return;

  const R2 = HEAT_PARAMS.radius * HEAT_PARAMS.radius;
  const invR2 = 1 / R2;

  for (const pc of objects.pointClouds) {
    const pos = pc.geometry.attributes.position;
    const idx = Math.min(frame, pos.count - 1);

    tmpVec.set(
      pos.array[idx*3]*0.01,
      pos.array[idx*3+1]*0.01,
      pos.array[idx*3+2]*0.01
    );

    if (tmpVec.distanceToSquared(camera.position) > 2500*2500) continue;

    for (const mesh of objects.heatMeshes) {
      const { grid, cellSize, heat, dirty, vx, vy, vz } = mesh.userData;
      const gx = Math.floor(tmpVec.x / cellSize);
      const gy = Math.floor(tmpVec.y / cellSize);
      const gz = Math.floor(tmpVec.z / cellSize);

      for (let ix=-1; ix<=1; ix++)
      for (let iy=-1; iy<=1; iy++)
      for (let iz=-1; iz<=1; iz++) {
        const key = (gx+ix) + (gy+iy)*10000 + (gz+iz)*100000000;
        const list = grid.get(key);
        if (!list) continue;

        for (const i of list) {
          const dx=vx[i]-tmpVec.x, dy=vy[i]-tmpVec.y, dz=vz[i]-tmpVec.z;
          const d2 = dx*dx + dy*dy + dz*dz;
          if (d2 < R2) {
            heat[i] = Math.min(
              heat[i] + Math.pow(1 - d2*invR2, HEAT_PARAMS.falloff) * HEAT_PARAMS.agentStrength,
              HEAT_PARAMS.max
            );
            dirty.add(i);
          }
        }
      }
    }
  }

  for (const mesh of objects.heatMeshes) {
    const col = mesh.geometry.attributes.color.array;
    const { heat, dirty } = mesh.userData;
    if (!dirty.size) continue;

    dirty.forEach(i => {
      const t = THREE.MathUtils.clamp((heat[i]-HEAT_PARAMS.min)*invHeatRange, 0, 1);
      const c = heatColor(t);
      col[i*4]   = c.r;
      col[i*4+1] = c.g;
      col[i*4+2] = c.b;
      col[i*4+3] = t; // alpha proportional to heat
    });

    mesh.geometry.attributes.color.needsUpdate = true;
    dirty.clear();
  }
}

/* ---------------- RENDER LOOP ---------------------- */
let lastPaneRefresh = 0;

function animate(time) {
  stats.begin();

  if (ready) {
    if (playback.playing) {
      playback.frame += playback.speed;
      if (playback.frame >= longestCSV) {
        playback.frame = longestCSV - 1;
        playback.playing = false;
      }
      if (time - lastPaneRefresh > 33) {
        pane.refresh();
        lastPaneRefresh = time;
      }
    }

    const f = Math.floor(playback.frame);

    // Base GLTF always visible
    objects.gltfModel && (objects.gltfModel.visible = settings.showGLTF);

    // Show heat overlay only if enabled
    objects.heatMeshes.forEach(m => m.visible = settings.showHeat);

    if (settings.showHeat && playback.playing) updateHeat(f);

    for (const pc of objects.pointClouds) {
      const count = pc.geometry.attributes.position.count;
      const drawCount = Math.min(f + 1, count);
      pc.geometry.setDrawRange(0, drawCount);

      const marker = pc.userData.marker;
      if (drawCount > 0) {
        const p = pc.geometry.attributes.position.array;
        marker.position.set(
          p[(drawCount-1)*3]*0.01,
          p[(drawCount-1)*3+1]*0.01,
          p[(drawCount-1)*3+2]*0.01
        );
        marker.visible = true;
      } else {
        marker.visible = false;
      }
    }
  }

  controls.update();
  USE_POST ? composer.render() : renderer.render(scene, camera);
  stats.end();
  requestAnimationFrame(animate);
}
animate();

/* ---------------- RESIZE --------------------------- */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer && composer.setSize(window.innerWidth, window.innerHeight);
});
