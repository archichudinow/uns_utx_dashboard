import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Papa from 'papaparse';
import { Pane } from 'tweakpane';
import Stats from 'stats.js';

/* ---------------- BASIC SETUP ---------------- */
const stats = new Stats();
document.body.appendChild(stats.dom);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e0d9ce');

scene.add(new THREE.AmbientLight(0xffffff, 1));
const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(1000, 1500, 1000);
scene.add(dirLight);

const camera = new THREE.PerspectiveCamera(
    12,
    window.innerWidth / window.innerHeight,
    1,
    10000
);
camera.position.set(-400, 600, -1000);

/* ---------------- RENDERER ---------------- */
const canvas = document.querySelector('canvas.threejs');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));

/* ---------------- CONTROLS ---------------- */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, -250);

/* ---------------- LOAD GLTF ---------------- */
const loader = new GLTFLoader();
loader.load('/models/map_high.glb', gltf => {
    gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        o.material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.7,
            metalness: 0
        });
    });
    scene.add(gltf.scene);
});

/* ---------------- CSV POINT LOADING ---------------- */
const WORLD_SCALE = 0.01;
const objects = { pointClouds: [] };

function parseCSVToPoints(csvText) {
    const rows = Papa.parse(csvText, { dynamicTyping: true }).data;
    const valid = rows.filter(r => r.length === 3 && r.every(Number.isFinite));
    if (!valid.length) return null;

    const positions = new Float32Array(valid.length * 3);
    const colors = new Float32Array(valid.length * 3);

    for (let i = 0; i < valid.length; i++) {
        positions[i*3]     = valid[i][0];
        positions[i*3 + 1] = valid[i][2];
        positions[i*3 + 2] = -valid[i][1];
        colors.set([0.3, 0.3, 0.3], i * 3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return new THREE.Points(
        geo,
        new THREE.PointsMaterial({
            size: 1,
            sizeAttenuation: false,
            vertexColors: true
        })
    );
}

async function loadCSVs() {
    const urls = [
        '/csv/P1_S2_CHART.csv',
        '/csv/P1_S4_CHART.csv',
        '/csv/P2_S1A_CHART.csv',
        '/csv/P2_S2_CHART.csv',
        '/csv/P2_S3_CHART.csv',
        '/csv/P2_S4_CHART.csv',
        '/csv/P3_S1A_CHART.csv',
        '/csv/P3_S2_CHART.csv',
        '/csv/P3_S3_CHART.csv',
        '/csv/P3_S4_CHART.csv'
    ];

    const markerGeo = new THREE.SphereGeometry(2, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 'black' });

    for (const url of urls) {
        const pc = await (await fetch(url)).text().then(parseCSVToPoints);
        if (!pc) continue;

        pc.scale.setScalar(WORLD_SCALE);
        pc.geometry.setDrawRange(0, 0);
        scene.add(pc);

        const marker = new THREE.Mesh(markerGeo, markerMat);
        marker.visible = false;
        scene.add(marker);

        pc.userData.marker = marker;
        pc.userData.prevDrawCount = 0;
        objects.pointClouds.push(pc);
    }
}

loadCSVs();

/* ---------------- PLAYBACK ---------------- */
const playback = { frame: 0, playing: false, speed: 5 };
let longestCSV = 0;
let ready = false;

const pane = new Pane();
pane.addButton({ title: 'Play / Pause' })
    .on('click', () => playback.playing = !playback.playing);

const frameSlider = pane.addBinding(playback, 'frame', { min: 0, max: 100 });

async function initPlayback() {
    while (!objects.pointClouds.length)
        await new Promise(r => setTimeout(r, 50));

    objects.pointClouds.forEach(pc => {
        longestCSV = Math.max(longestCSV, pc.geometry.attributes.position.count);
    });

    frameSlider.max = longestCSV - 1;
    ready = true;
}
initPlayback();

/* ---------------- ANIMATION LOOP ---------------- */
function animate() {
    stats.begin();

    if (ready && playback.playing) {
        playback.frame = Math.min(playback.frame + playback.speed, longestCSV - 1);
    }

    if (ready) {
        const f = Math.floor(playback.frame);

        for (const pc of objects.pointClouds) {
            const count = pc.geometry.attributes.position.count;
            const drawCount = Math.min(f + 1, count);

            if (drawCount !== pc.userData.prevDrawCount) {
                pc.geometry.setDrawRange(0, drawCount);
                pc.userData.prevDrawCount = drawCount;

                const p = pc.geometry.attributes.position.array;
                const marker = pc.userData.marker;

                if (drawCount > 0) {
                    marker.position.set(
                        p[(drawCount - 1) * 3] * WORLD_SCALE,
                        p[(drawCount - 1) * 3 + 1] * WORLD_SCALE,
                        p[(drawCount - 1) * 3 + 2] * WORLD_SCALE
                    );
                    marker.visible = true;
                }
            }
        }
    }

    controls.update();
    renderer.render(scene, camera);
    stats.end();
    requestAnimationFrame(animate);
}
animate();

/* ---------------- RESIZE ---------------- */
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
