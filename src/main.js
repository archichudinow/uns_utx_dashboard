import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';

import { loadCSV } from './scripts/csv_to_points.js';
import { Pane } from 'tweakpane';
import Stats from 'stats.js';

/* ---------------------------------------------------- */
/* BASIC SETUP                                          */
/* ---------------------------------------------------- */
const stats = new Stats();
document.body.appendChild(stats.dom);

const scene = new THREE.Scene();
scene.background = new THREE.Color('white');

scene.add(new THREE.AmbientLight(0xffffff, 2.5));
const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(500, 1000, -700);
scene.add(dirLight);

/* ---------------------------------------------------- */
/* CAMERA / RENDERER                                    */
/* ---------------------------------------------------- */
const camera = new THREE.PerspectiveCamera(12, window.innerWidth / window.innerHeight, 1, 10000);
camera.position.set(-400, 600, -1000);

const canvas = document.querySelector('canvas.threejs');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

/* ---------------------------------------------------- */
/* CONTROLS                                             */
/* ---------------------------------------------------- */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, -250);

/* ---------------------------------------------------- */
/* UI                                                   */
/* ---------------------------------------------------- */
const pane = new Pane();

const settings = {
  showHeat: true,
  showGLTF: true
};

/* ---------------------------------------------------- */
/* HEAT PARAMETERS                                      */
/* ---------------------------------------------------- */
const HEAT_PARAMS = {
  radius: 15,
  agentStrength: 0.05,
  min: 0,
  max: 2,
  falloff: 4
};

/* ---------------------------------------------------- */
/* STORAGE                                              */
/* ---------------------------------------------------- */
const objects = {
  gltfModel: null,
  meshes: [],
  pointClouds: []
};

/* ---------------------------------------------------- */
/* SPATIAL GRID BUILD                                   */
/* ---------------------------------------------------- */
function buildSpatialGrid(mesh, cellSize) {
  const pos = mesh.geometry.attributes.position.array;
  const grid = new Map();

  for (let i = 0; i < pos.length; i += 3) {
    const gx = Math.floor(pos[i] / cellSize);
    const gy = Math.floor(pos[i + 1] / cellSize);
    const gz = Math.floor(pos[i + 2] / cellSize);

    const key = `${gx},${gy},${gz}`;
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(i / 3);
  }

  mesh.userData.grid = grid;
  mesh.userData.cellSize = cellSize;
}

/* ---------------------------------------------------- */
/* INIT GLTF MESH DATA                                  */
/* ---------------------------------------------------- */
function initMesh(mesh) {
  if (mesh.geometry.index) {
    mesh.geometry = mesh.geometry.toNonIndexed();
  }

  mesh.geometry.computeBoundingSphere();

  const pos = mesh.geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const heat = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    colors[i * 3 + 2] = 1;
  }

  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  mesh.material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.1,
    metalness: 0.1
  });

  mesh.userData.heat = heat;
  mesh.userData.dirty = new Set();

  buildSpatialGrid(mesh, HEAT_PARAMS.radius);
  objects.meshes.push(mesh);
}

/* ---------------------------------------------------- */
/* LOAD GLTF                                            */
/* ---------------------------------------------------- */
const loader = new GLTFLoader();
loader.load('/models/map_high.glb', gltf => {
  objects.gltfModel = gltf.scene;

  gltf.scene.traverse(obj => {
    if (obj.isMesh) initMesh(obj);
  });

  scene.add(gltf.scene);
});

/* ---------------------------------------------------- */
/* LOAD CSV POINT CLOUDS                                */
/* ---------------------------------------------------- */
const csvUrls = [
  '/csv/P1_S2_CHART.csv','/csv/P1_S4_CHART.csv','/csv/P2_S1A_CHART.csv',
  '/csv/P2_S2_CHART.csv','/csv/P2_S3_CHART.csv','/csv/P2_S4_CHART.csv',
  '/csv/P3_S1A_CHART.csv','/csv/P3_S2_CHART.csv','/csv/P3_S3_CHART.csv',
  '/csv/P3_S4_CHART.csv'
];

const markerGeo = new THREE.SphereGeometry(2, 16, 16);
const markerMat = new THREE.MeshBasicMaterial({ color: 'black' });

async function loadCSVs() {
  for (const url of csvUrls) {
    const pc = await loadCSV(url);
    if (!pc) continue;

    pc.scale.set(0.01, 0.01, 0.01);
    scene.add(pc);

    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.visible = false;
    scene.add(marker);

    pc.userData.marker = marker;
    objects.pointClouds.push(pc);
  }
}
loadCSVs();

/* ---------------------------------------------------- */
/* PLAYBACK                                             */
/* ---------------------------------------------------- */
const playback = { frame: 0, playing: false, speed: 1 };
let longestCSV = 0;
let ready = false;

async function initPlayback() {
  while (!objects.pointClouds.length) {
    await new Promise(r => setTimeout(r, 50));
  }

  for (const pc of objects.pointClouds) {
    longestCSV = Math.max(longestCSV, pc.geometry.attributes.position.count);
  }

  const f = pane.addFolder({ title: 'Playback' });
  f.addBinding(playback, 'frame', { min: 0, max: longestCSV, step: 1 });
  f.addBinding(playback, 'playing');
  f.addBinding(playback, 'speed', { min: 1, max: 60 });

  const v = pane.addFolder({ title: 'View' });
  v.addBinding(settings, 'showHeat');
  v.addBinding(settings, 'showGLTF');

  const h = pane.addFolder({ title: 'Heatmap' });
  Object.keys(HEAT_PARAMS).forEach(k =>
    h.addBinding(HEAT_PARAMS, k)
  );

  ready = true;
}
initPlayback();

/* ---------------------------------------------------- */
/* HEAT COLOR                                           */
/* ---------------------------------------------------- */
function heatColor(t) {
  return new THREE.Color().setHSL((1 - t) * 0.66, 1, 0.5);
}

/* ---------------------------------------------------- */
/* HEAT UPDATE (OPTIMIZED)                               */
/* ---------------------------------------------------- */
function updateHeat(frame) {
  const R = HEAT_PARAMS.radius;
  const R2 = R * R;

  for (const pc of objects.pointClouds) {
    const pos = pc.geometry.attributes.position;
    const idx = Math.min(frame, pos.count - 1);

    const px = pos.array[idx * 3] * 0.01;
    const py = pos.array[idx * 3 + 1] * 0.01;
    const pz = pos.array[idx * 3 + 2] * 0.01;

    for (const mesh of objects.meshes) {
      const bs = mesh.geometry.boundingSphere;
      const dx = bs.center.x - px;
      const dy = bs.center.y - py;
      const dz = bs.center.z - pz;
      const r = bs.radius + R;

      if (dx * dx + dy * dy + dz * dz > r * r) continue;

      const { grid, cellSize, heat, dirty } = mesh.userData;
      const gx = Math.floor(px / cellSize);
      const gy = Math.floor(py / cellSize);
      const gz = Math.floor(pz / cellSize);

      const gPos = mesh.geometry.attributes.position.array;

      for (let ix = -1; ix <= 1; ix++) {
        for (let iy = -1; iy <= 1; iy++) {
          for (let iz = -1; iz <= 1; iz++) {
            const key = `${gx + ix},${gy + iy},${gz + iz}`;
            const list = grid.get(key);
            if (!list) continue;

            for (const i of list) {
              const dx = gPos[i*3]   - px;
              const dy = gPos[i*3+1] - py;
              const dz = gPos[i*3+2] - pz;
              const d2 = dx*dx + dy*dy + dz*dz;

              if (d2 < R2) {
                const t = Math.pow(1 - d2 / R2, HEAT_PARAMS.falloff);
                heat[i] += t * HEAT_PARAMS.agentStrength;
                dirty.add(i);
              }
            }
          }
        }
      }
    }
  }

  for (const mesh of objects.meshes) {
    const col = mesh.geometry.attributes.color;
    const heat = mesh.userData.heat;

    for (const i of mesh.userData.dirty) {
      const nt = THREE.MathUtils.clamp(
        (heat[i] - HEAT_PARAMS.min) / (HEAT_PARAMS.max - HEAT_PARAMS.min),
        0, 1
      );
      const c = heatColor(nt);
      col.array[i*3]   = c.r;
      col.array[i*3+1] = c.g;
      col.array[i*3+2] = c.b;
    }

    if (mesh.userData.dirty.size) col.needsUpdate = true;
    mesh.userData.dirty.clear();
  }
}

/* ---------------------------------------------------- */
/* RENDER LOOP                                          */
/* ---------------------------------------------------- */
let lastFrame = -1;

function animate() {
  stats.begin();

  if (ready) {
    if (playback.playing) {
      playback.frame += playback.speed;
      if (playback.frame >= longestCSV) playback.frame = 0;
      pane.refresh();
    }

    const f = Math.floor(playback.frame);

    if (settings.showHeat && f !== lastFrame) {
      updateHeat(f);
      lastFrame = f;
    }

    if (objects.gltfModel) {
      objects.gltfModel.visible = settings.showGLTF;
    }

    for (const pc of objects.pointClouds) {
      const count = pc.geometry.attributes.position.count;
      const draw = Math.min(f, count);
      pc.geometry.setDrawRange(0, draw);

      const marker = pc.userData.marker;
      if (draw > 0) {
        const i = draw - 1;
        const p = pc.geometry.attributes.position.array;
        marker.position.set(p[i*3]*0.01, p[i*3+1]*0.01, p[i*3+2]*0.01);
        marker.visible = true;
      } else {
        marker.visible = false;
      }
    }
  }

  controls.update();
  composer.render();
  stats.end();
  requestAnimationFrame(animate);
}
animate();

/* ---------------------------------------------------- */
/* RESIZE                                               */
/* ---------------------------------------------------- */
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
