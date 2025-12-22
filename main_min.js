import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Papa from 'papaparse';

/* ---------------- SCENE ---------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e0d9ce');
scene.add(new THREE.AmbientLight(0xffffff, 1));

/* ---------------- CAMERA ---------------- */
const camera = new THREE.PerspectiveCamera(
    12,
    window.innerWidth / window.innerHeight,
    1,
    10000
);
camera.position.set(-400, 600, -1000);

/* ---------------- RENDERER ---------------- */
const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas.threejs'), antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);

/* ---------------- CONTROLS ---------------- */
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, -250);

/* ---------------- STORAGE ---------------- */
const objects = { gltfModel: null, pointCloud: null };
const WORLD_SCALE = 0.01;

/* ---------------- LOAD GLTF ---------------- */
new GLTFLoader().load('/models/map_high.glb', gltf => {
    objects.gltfModel = gltf.scene;
    scene.add(gltf.scene);
});

/* ---------------- CSV PARSING ---------------- */
async function loadCSVs() {
    const urls = [
        '/csv/P1_S2_CHART.csv','/csv/P1_S4_CHART.csv','/csv/P2_S1A_CHART.csv',
        '/csv/P2_S2_CHART.csv','/csv/P2_S3_CHART.csv','/csv/P2_S4_CHART.csv',
        '/csv/P3_S1A_CHART.csv','/csv/P3_S2_CHART.csv','/csv/P3_S3_CHART.csv',
        '/csv/P3_S4_CHART.csv'
    ];

    const positions = [];
    const colors = [];

    for (const url of urls) {
        const text = await (await fetch(url)).text();
        const rows = Papa.parse(text, { dynamicTyping: true }).data;
        for (const r of rows) {
            if (r.length !== 3 || !r.every(Number.isFinite)) continue;
            positions.push(r[0] * WORLD_SCALE, r[2] * WORLD_SCALE, -r[1] * WORLD_SCALE);
            colors.push(0.5, 0.5, 0.5);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

    objects.pointCloud = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({ size: 1, vertexColors: true })
    );
    scene.add(objects.pointCloud);
}

loadCSVs();


/* ---------------- ANIMATION LOOP ---------------- */
function animate() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}
animate();

/* ---------------- RESIZE ---------------- */
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
