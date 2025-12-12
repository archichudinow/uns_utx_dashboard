import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadCSV } from './scripts/csv_to_points.js';
import { Pane } from 'tweakpane';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SAOPass } from 'three/addons/postprocessing/SAOPass.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color('white');

// Grid setup
const gridHelper = new THREE.GridHelper(400, 1);
scene.add(gridHelper);
gridHelper.position.z = -250;
gridHelper.receiveShadow = true;

// Shadow plane (invisible, receives shadows)
const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.1 }) // shadow color + opacity
);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.position.y = -0.2;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 2.5); // low ambient to allow shadows
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(500, 1000, -700);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 4096;
dirLight.shadow.mapSize.height = 4096;
dirLight.shadow.camera.left = -300;
dirLight.shadow.camera.right = 300;
dirLight.shadow.camera.top = 300;
dirLight.shadow.camera.bottom = -300;
dirLight.shadow.camera.near = 1;
dirLight.shadow.camera.far = 5000;
dirLight.shadow.bias = -0.00001;
scene.add(dirLight);

// Camera
let aspectRatio = window.innerWidth / window.innerHeight;
const camera = new THREE.PerspectiveCamera(12, aspectRatio, 1, 10000);
camera.position.set(-400, 600, -1000);
camera.zoom = 1;
camera.updateProjectionMatrix();

// Renderer
const canvas = document.querySelector('canvas.threejs');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 4; // scene brightness

// Composer for post-processing
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// SSAO / AO pass
const saoPass = new SAOPass(scene, camera, false, true);

// Keep shadows and color intact
saoPass.params.output = SAOPass.OUTPUT.Default;

// AO settings
saoPass.params.saoIntensity = 0.05;        // AO darkness
saoPass.params.saoBias = 0.1;             // shadow acne fix
saoPass.params.saoScale = 1000;           // match your model size
saoPass.params.saoKernelRadius = 100;     // AO sample radius
saoPass.params.saoSamples = 2;           // AO sample count (higher = smoother)
saoPass.params.saoBlur = true;            // smooth AO
saoPass.params.saoBlurRadius = 1;         
saoPass.params.saoBlurStdDev = 4;         
saoPass.params.saoBlurDepthCutoff = 0.01; // prevent over-blur

composer.addPass(saoPass);

// Orbit controls
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, -250);
controls.update();
controls.autoRotate = true;
controls.autoRotateSpeed = 0.3;

// TweakPane
const pane = new Pane();
const tab = pane.addTab({ pages: [{ title: 'Models' }, { title: 'Point Clouds' }] });
const modelFolder = tab.pages[0];
const cloudFolder = tab.pages[1];

// Object storage
const objects = { gltfModel: null, pointClouds: [] };
const gltfParams = { visible: true };

// Load GLTF model
const loader = new GLTFLoader();
loader.load('/models/map.glb', (gltf) => {
  const object = gltf.scene;
  objects.gltfModel = object;

  object.traverse((child) => {
    if (child.isMesh) {
      child.material = new THREE.MeshStandardMaterial({
        color: "#f3f0e4",
        roughness: 0.1,
        metalness: 0.1,
      });
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  scene.add(object);

  modelFolder.addBinding(gltfParams, 'visible', { label: 'GLTF Model' }).on('change', (ev) => {
    objects.gltfModel.visible = ev.value;
  });
}, undefined, console.error);

// Load CSV point clouds
const csvUrls = [
  '/csv/P1_S2_CHART.csv','/csv/P1_S4_CHART.csv','/csv/P2_S1A_CHART.csv','/csv/P2_S2_CHART.csv',
  '/csv/P2_S3_CHART.csv','/csv/P2_S4_CHART.csv','/csv/P3_S1A_CHART.csv','/csv/P3_S2_CHART.csv',
  '/csv/P3_S3_CHART.csv','/csv/P3_S4_CHART.csv'
];

async function loadAndAddPoints(csvUrls) {
  for (let url of csvUrls) {
    try {
      const pointCloud = await loadCSV(url);
      if (pointCloud) {
        scene.add(pointCloud);
        pointCloud.scale.set(0.01, 0.01, 0.01);
        pointCloud.name = url;
        objects.pointClouds.push(pointCloud);

        const cloudParams = { visible: true };
        const label = `${url.split('/').pop()}`;
        cloudFolder.addBinding(cloudParams, 'visible', { label }).on('change', (ev) => {
          pointCloud.visible = ev.value;
        });
      }
    } catch (e) { console.error(e); }
  }
}

loadAndAddPoints(csvUrls);

// Resize handling
window.addEventListener('resize', () => {
  aspectRatio = window.innerWidth / window.innerHeight;
  camera.aspect = aspectRatio;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// Render loop
const renderLoop = () => {
  controls.update();
  composer.render(); // use composer to render AO
  requestAnimationFrame(renderLoop);
};

renderLoop();
