import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SAOPass } from 'three/examples/jsm/postprocessing/SAOPass.js';

import { loadCSV } from './scripts/csv_to_points.js';
import { Pane } from 'tweakpane';
import Stats from 'stats.js';


/* ---------------------------------------------------- */
/* BASIC SETUP                                          */
/* ---------------------------------------------------- */
const stats = new Stats();
stats.showPanel(0);
document.body.appendChild(stats.dom);

const scene = new THREE.Scene();
scene.background = new THREE.Color('white');

scene.add(new THREE.AmbientLight(0xffffff, 2.5));

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(500, 1000, -700);
dirLight.castShadow = true;
scene.add(dirLight);

/* ---------------------------------------------------- */
/* CAMERA / RENDERER                                    */
/* ---------------------------------------------------- */
const camera = new THREE.PerspectiveCamera(
  12,
  window.innerWidth / window.innerHeight,
  1,
  10000
);
camera.position.set(-400, 600, -1000);

const canvas = document.querySelector('canvas.threejs');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 4;

/* ---------------------------------------------------- */
/* POST FX                                              */
/* ---------------------------------------------------- */
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

//const saoPass = new SAOPass(scene, camera);
//saoPass.params.saoIntensity = 0.05;
//composer.addPass(saoPass);

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
const tab = pane.addTab({
  pages: [{ title: 'Models' }, { title: 'Point Clouds' }]
});


/* ---------------------------------------------------- */
/* STORAGE                                              */
/* ---------------------------------------------------- */
const objects = {
  gltfModel: null,
  pointClouds: []
};

/* ---------------------------------------------------- */
/* LOAD GLTF + INIT VERTEX COLORS                       */
/* ---------------------------------------------------- */
function initVertexColors(mesh) {
  if (mesh.geometry.index) {
    mesh.geometry = mesh.geometry.toNonIndexed();
  }

  const pos = mesh.geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);

  for (let i = 0; i < pos.count; i++) {
    colors[i * 3 + 2] = 1; // blue
  }

  mesh.geometry.setAttribute(
    'color',
    new THREE.BufferAttribute(colors, 3)
  );
}

const loader = new GLTFLoader();
loader.load('/models/map.glb', (gltf) => {
  objects.gltfModel = gltf.scene;

  gltf.scene.traverse((child) => {
    if (child.isMesh) {
      child.material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        vertexColors: true,
        roughness: 0.1,
        metalness: 0.1
      });
      initVertexColors(child);
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  scene.add(gltf.scene);
});

/* ---------------------------------------------------- */
/* LOAD CSV POINT CLOUDS + MARKERS                      */
/* ---------------------------------------------------- */
const csvUrls = [
  '/csv/P1_S2_CHART.csv','/csv/P1_S4_CHART.csv','/csv/P2_S1A_CHART.csv',
  '/csv/P2_S2_CHART.csv','/csv/P2_S3_CHART.csv','/csv/P2_S4_CHART.csv',
  '/csv/P3_S1A_CHART.csv','/csv/P3_S2_CHART.csv','/csv/P3_S3_CHART.csv',
  '/csv/P3_S4_CHART.csv'
];

async function loadCSVs() {
  for (let url of csvUrls) {
    const pc = await loadCSV(url);
    if (!pc) continue;

    pc.scale.set(0.01, 0.01, 0.01);
    scene.add(pc);
    objects.pointClouds.push(pc);

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(2, 16, 16),
      new THREE.MeshBasicMaterial({ color: 'black' })
    );
    marker.visible = false;
    scene.add(marker);
    pc.userData.marker = marker;
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
    const c = pc.geometry.attributes.position.count;
    longestCSV = Math.max(longestCSV, c);
  }

  const f = pane.addFolder({ title: 'Playback' });
  f.addBinding(playback, 'frame', { min: 0, max: longestCSV, step: 1 });
  f.addBinding(playback, 'playing');
  f.addBinding(playback, 'speed', { min: 1, max: 60 });

  ready = true;
}
initPlayback();

/* ---------------------------------------------------- */
/* HEAT MAP LOGIC                                       */
/* ---------------------------------------------------- */
function heatColor(t) {
  return new THREE.Color().setHSL((1 - t) * 0.66, 1, 0.5);
}

function getActiveCSVPoints(frame) {
  const pts = [];

  for (let pc of objects.pointClouds) {
    const pos = pc.geometry.attributes.position;
    const idx = Math.min(frame, pos.count - 1);

    pts.push(new THREE.Vector3(
      pos.array[idx * 3 + 0] * 0.01,
      pos.array[idx * 3 + 1] * 0.01,
      pos.array[idx * 3 + 2] * 0.01
    ));
  }
  return pts;
}

function applyHeat(frame) {
  if (!objects.gltfModel) return;

  const pts = getActiveCSVPoints(frame);
  const RADIUS = 50;

  objects.gltfModel.traverse(mesh => {
    if (!mesh.isMesh) return;

    const pos = mesh.geometry.attributes.position;
    const col = mesh.geometry.attributes.color;

    for (let i = 0; i < pos.count; i++) {
      let minD = Infinity;

      for (let p of pts) {
        const dx = pos.array[i * 3 + 0] - p.x;
        const dy = pos.array[i * 3 + 1] - p.y;
        const dz = pos.array[i * 3 + 2] - p.z;
        minD = Math.min(minD, Math.sqrt(dx*dx + dy*dy + dz*dz));
      }

      const heat = Math.max(0, 1 - minD / RADIUS);
      const c = heatColor(heat);

      col.array[i * 3 + 0] = c.r;
      col.array[i * 3 + 1] = c.g;
      col.array[i * 3 + 2] = c.b;
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

    for (let pc of objects.pointClouds) {
      const count = pc.geometry.attributes.position.count;
      const f = Math.min(playback.frame, count);
      pc.geometry.setDrawRange(0, f);

      const marker = pc.userData.marker;
      if (marker && f > 0) {
        const i = Math.min(f - 1, count - 1);
        const p = pc.geometry.attributes.position.array;
        marker.position.set(
          p[i*3] * 0.01,
          p[i*3+1] * 0.01,
          p[i*3+2] * 0.01
        );
        marker.visible = true;
      }
    }

    applyHeat(Math.floor(playback.frame));
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
