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
/* STORAGE                                              */
/* ---------------------------------------------------- */
const objects = {
  gltfModel: null,
  pointClouds: []
};

/* ---------------------------------------------------- */
/* GLTF + HEAT BUFFERS                                  */
/* ---------------------------------------------------- */
function initVertexData(mesh) {
  if (mesh.geometry.index) {
    mesh.geometry = mesh.geometry.toNonIndexed();
  }

  const pos = mesh.geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const heat = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    colors[i * 3 + 2] = 1; // blue base
  }

  mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  mesh.userData.heat = heat;
}

const loader = new GLTFLoader();
loader.load('/models/map.glb', (gltf) => {
  objects.gltfModel = gltf.scene;

  gltf.scene.traverse(child => {
    if (!child.isMesh) return;

    child.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      color: 0xffffff,
      roughness: 0.1,
      metalness: 0.1
    });

    initVertexData(child);
  });

  scene.add(gltf.scene);
});

/* ---------------------------------------------------- */
/* LOAD CSV POINT CLOUDS + AGENT MARKERS                 */
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
  for (let url of csvUrls) {
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
  while (objects.pointClouds.length === 0) {
    await new Promise(r => setTimeout(r, 50));
  }

  for (let pc of objects.pointClouds) {
    longestCSV = Math.max(longestCSV, pc.geometry.attributes.position.count);
  }

  const f = pane.addFolder({ title: 'Playback' });
  f.addBinding(playback, 'frame', { min: 0, max: longestCSV, step: 1 });
  f.addBinding(playback, 'playing');
  f.addBinding(playback, 'speed', { min: 1, max: 60 });

  const v = pane.addFolder({ title: 'View' });
  v.addBinding(settings, 'showHeat', { label: 'Show Heatmap' });
  v.addBinding(settings, 'showGLTF', { label: 'Show GLTF' });

  ready = true;
}
initPlayback();

/* ---------------------------------------------------- */
/* HEAT FUNCTIONS                                       */
/* ---------------------------------------------------- */
function heatColor(t) {
  return new THREE.Color().setHSL((1 - t) * 0.66, 1, 0.5);
}

let lastHeatFrame = -1;

function updateHeatCumulative(frame) {
  if (!objects.gltfModel || !settings.showHeat) return;

  const RADIUS = 50;
  const R2 = RADIUS * RADIUS;

  for (let pc of objects.pointClouds) {
    const pos = pc.geometry.attributes.position;
    const idx = Math.min(frame, pos.count - 1);

    const px = pos.array[idx * 3] * 0.01;
    const py = pos.array[idx * 3 + 1] * 0.01;
    const pz = pos.array[idx * 3 + 2] * 0.01;

    objects.gltfModel.traverse(mesh => {
      if (!mesh.isMesh) return;

      const gPos = mesh.geometry.attributes.position;
      const heat = mesh.userData.heat;
      const col = mesh.geometry.attributes.color;

      for (let i = 0; i < gPos.count; i++) {
        const dx = gPos.array[i*3]   - px;
        const dy = gPos.array[i*3+1] - py;
        const dz = gPos.array[i*3+2] - pz;
        const d2 = dx*dx + dy*dy + dz*dz;

        if (d2 < R2) {
          heat[i] += 1 - d2 / R2;
        }

        const t = Math.min(1, heat[i]);
        const c = heatColor(t);

        col.array[i*3]   = c.r;
        col.array[i*3+1] = c.g;
        col.array[i*3+2] = c.b;
      }

      col.needsUpdate = true;
    });
  }
}

/* ---------------------------------------------------- */
/* RESET TO WHITE (WHEN HEAT OFF)                       */
/* ---------------------------------------------------- */
function resetMeshWhite() {
  if (!objects.gltfModel) return;

  objects.gltfModel.traverse(mesh => {
    if (!mesh.isMesh) return;

    const col = mesh.geometry.attributes.color;
    for (let i = 0; i < col.count; i++) {
      col.array[i*3] = 1;
      col.array[i*3+1] = 1;
      col.array[i*3+2] = 1;
    }
    col.needsUpdate = true;
  });
}

/* ---------------------------------------------------- */
/* RENDER LOOP                                          */
/* ---------------------------------------------------- */
function animate() {
  stats.begin();

  if (ready) {
    if (playback.playing) {
      playback.frame += playback.speed;
      if (playback.frame >= longestCSV) playback.frame = 0;
      pane.refresh();
    }

    const f = Math.floor(playback.frame);

    if (settings.showHeat) {
      if (f !== lastHeatFrame) {
        updateHeatCumulative(f);
        lastHeatFrame = f;
      }
    } else {
      resetMeshWhite();
      lastHeatFrame = -1;
    }

    if (objects.gltfModel) {
      objects.gltfModel.visible = settings.showGLTF;
    }

    for (let pc of objects.pointClouds) {
      const count = pc.geometry.attributes.position.count;
      const draw = Math.min(f, count);
      pc.geometry.setDrawRange(0, draw);

      const marker = pc.userData.marker;
      if (draw > 0) {
        const i = Math.min(draw - 1, count - 1);
        const p = pc.geometry.attributes.position.array;

        marker.position.set(
          p[i*3] * 0.01,
          p[i*3+1] * 0.01,
          p[i*3+2] * 0.01
        );
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
