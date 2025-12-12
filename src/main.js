import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadCSV } from './scripts/csv_to_points.js';
import { Pane } from 'tweakpane';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color('white');

// Grid setup
const gridHelper = new THREE.GridHelper(400, 1);
scene.add(gridHelper);
gridHelper.position.z = -250;

// Lighting setup
const ambientLight = new THREE.AmbientLight(0x404040, 30);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(5, 5, 5).normalize();
scene.add(dirLight);

// Camera setup
let aspectRatio = window.innerWidth / window.innerHeight;
const camera = new THREE.PerspectiveCamera(35, aspectRatio, 1, 10000);
camera.position.set(700, 700, -350);
camera.zoom = 1;
camera.updateProjectionMatrix();

// Renderer setup
const canvas = document.querySelector('canvas.threejs');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

// Orbit controls setup
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, -250);
controls.update();
controls.autoRotate = true;
controls.autoRotateSpeed = 0.3;

// TweakPane setup
const pane = new Pane();
const tab = pane.addTab({
  pages: [
    { title: 'Models' },
    { title: 'Point Clouds' },
  ],
});
const modelFolder = tab.pages[0];
const cloudFolder = tab.pages[1];

// Store references for visibility toggling
const objects = {
  gltfModel: null,
  pointClouds: [],
};

const gltfParams = { visible: true };

// Load the GLTF model
const loader = new GLTFLoader();
loader.load(
  '/models/map.glb',
  function (gltf) {
    const object = gltf.scene;
    objects.gltfModel = object;

    object.traverse((child) => {
      if (child.isMesh) {
        child.material = new THREE.MeshStandardMaterial({
          color: 0xffffff,
        });
      }
    });

    scene.add(object);

    // Add visibility toggle to Tweakpane
    modelFolder.addBinding(gltfParams, 'visible', { label: 'GLTF Model' }).on('change', (ev) => {
      if (objects.gltfModel) {
        objects.gltfModel.visible = ev.value;
      }
    });
  },
  undefined,
  function (error) {
    console.error(error);
  }
);

// Load CSV data
const csvUrls = [
  '/csv/P1_S2_CHART.csv',
  '/csv/P1_S4_CHART.csv',
  '/csv/P2_S1A_CHART.csv',
  '/csv/P2_S2_CHART.csv',
  '/csv/P2_S3_CHART.csv',
  '/csv/P2_S4_CHART.csv',
  '/csv/P3_S1A_CHART.csv',
  '/csv/P3_S2_CHART.csv',
  '/csv/P3_S3_CHART.csv',
  '/csv/P3_S4_CHART.csv',
];

async function loadAndAddPoints(csvUrls) {
  for (let i = 0; i < csvUrls.length; i++) {
    const url = csvUrls[i];
    try {
      const pointCloud = await loadCSV(url);
      if (pointCloud) {
        scene.add(pointCloud);
        pointCloud.scale.set(0.01, 0.01, 0.01);
        pointCloud.name = url; // useful for debugging or UI labeling
        objects.pointClouds.push(pointCloud);

        const cloudParams = { visible: true };
        const label = `${url.split('/').pop()}`;
        cloudFolder.addBinding(cloudParams, 'visible', { label }).on('change', (ev) => {
          pointCloud.visible = ev.value;
        });
      }
    } catch (error) {
      console.error('Error processing CSV:', error);
    }
  }
}

loadAndAddPoints(csvUrls);

// Resize handling
window.addEventListener('resize', () => {
  aspectRatio = window.innerWidth / window.innerHeight;
  camera.aspect = aspectRatio;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Render loop
const renderLoop = () => {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(renderLoop);
};

renderLoop();