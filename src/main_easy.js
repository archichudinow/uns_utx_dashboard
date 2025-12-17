import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Papa from 'papaparse';
import { Pane } from 'tweakpane';
import Stats from 'stats.js';

/* ---------------- DEVICE / PERFORMANCE ---------------- */
const IS_MOBILE = /iPhone|iPad|Android/i.test(navigator.userAgent);
const MAX_DPR = IS_MOBILE ? 2 : 1.25;
const WORLD_SCALE = 0.01;
const MAX_AGENT_DISTANCE2 = 2500 * 2500;

/* ---------------- STATS ---------------- */
const stats = new Stats();
document.body.appendChild(stats.dom);

/* ---------------- SCENE ---------------- */
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e0d9ce');
scene.add(new THREE.AmbientLight(0xffffff, 1));

const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(1000, 1500, 1000);
scene.add(dirLight);

/* ---------------- CAMERA ---------------- */
const camera = new THREE.PerspectiveCamera(
    12,
    window.innerWidth / window.innerHeight,
    1,
    10000
);
camera.position.set(-400, 600, -1000);

/* ---------------- RENDERER ---------------- */
const canvas = document.querySelector('canvas.threejs');
const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

/* ---------------- CONTROLS ---------------- */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, -250);

/* ---------------- HEAT PARAMETERS ---------------- */
const HEAT_PARAMS = {
    radius: 4,
    agentStrength: 0.4,
    min: 0,
    max: 4,
    falloff: 4
};

const R2 = HEAT_PARAMS.radius ** 2;
const INV_R2 = 1 / R2;
const INV_HEAT_RANGE = 1 / (HEAT_PARAMS.max - HEAT_PARAMS.min);

/* ---------------- STORAGE ---------------- */
const objects = {
    gltfModel: null,
    heatMeshes: [],
    pointClouds: []
};

/* ---------------- SPATIAL GRID ---------------- */
function gridKey(x, y, z) {
    return `${x},${y},${z}`;
}

function buildSpatialGrid(mesh, cellSize) {
    const { vx, vy, vz } = mesh.userData;
    const grid = new Map();

    for (let i = 0; i < vx.length; i++) {
        const gx = Math.floor(vx[i] / cellSize);
        const gy = Math.floor(vy[i] / cellSize);
        const gz = Math.floor(vz[i] / cellSize);
        const key = gridKey(gx, gy, gz);

        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
    }

    mesh.userData.grid = grid;
    mesh.userData.cellSize = cellSize;
}

/* ---------------- HEAT COLOR LUT ---------------- */
const HEAT_COLOR_STEPS = 256;
const heatLUT = new Array(HEAT_COLOR_STEPS);
const tmpColor = new THREE.Color();

for (let i = 0; i < HEAT_COLOR_STEPS; i++) {
    const t = i / (HEAT_COLOR_STEPS - 1);

    if (t < 0.25) tmpColor.setRGB(1 - t / 0.25, 1, 1);
    else if (t < 0.5) tmpColor.setRGB(0, 1, 1 - (t - 0.25) / 0.25);
    else if (t < 0.75) tmpColor.setRGB((t - 0.5) / 0.25, 1, 0);
    else tmpColor.setRGB(1, 1 - (t - 0.75) / 0.25, 0);

    heatLUT[i] = [tmpColor.r, tmpColor.g, tmpColor.b, t];
}

/* ---------------- HEAT MESH INIT ---------------- */
function initHeatMesh(sourceMesh) {
    const geometry = sourceMesh.geometry.clone();
    geometry.computeBoundingSphere();

    const count = geometry.attributes.position.count;
    const pos = geometry.attributes.position.array;

    const heat = new Float32Array(count);
    const colors = new Float32Array(count * 4);
    const vx = new Float32Array(count);
    const vy = new Float32Array(count);
    const vz = new Float32Array(count);

    const v = new THREE.Vector3();
    const m = sourceMesh.matrixWorld;

    for (let i = 0; i < count; i++) {
        v.set(pos[i*3], pos[i*3+1], pos[i*3+2]).applyMatrix4(m);
        vx[i] = v.x;
        vy[i] = v.y;
        vz[i] = v.z;
        colors.set([1, 1, 1, 0], i * 4);
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));

    const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
            vertexColors: true,
            transparent: true,
            depthWrite: false
        })
    );

    mesh.userData = {
        heat,
        vx, vy, vz,
        dirty: new Set(),
        grid: null,
        cellSize: HEAT_PARAMS.radius
    };

    buildSpatialGrid(mesh, HEAT_PARAMS.radius);
    scene.add(mesh);
    objects.heatMeshes.push(mesh);
}

/* ---------------- LOAD GLTF ---------------- */
const loader = new GLTFLoader();
loader.load('/models/map_high.glb', gltf => {
    objects.gltfModel = gltf.scene;

    gltf.scene.traverse(o => {
        if (!o.isMesh) return;

        o.castShadow = o.receiveShadow = true;
        o.material = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            roughness: 0.7,
            metalness: 0
        });

        initHeatMesh(o);
    });

    scene.add(gltf.scene);
});

/* ---------------- CSV PARSING ---------------- */
function parseCSVToPoints(csvText) {
    const rows = Papa.parse(csvText, { dynamicTyping: true }).data;
    const valid = rows.filter(r => r.length === 3 && r.every(Number.isFinite));

    if (!valid.length) return null;

    const positions = new Float32Array(valid.length * 3);
    const colors = new Float32Array(valid.length * 3);

    for (let i = 0; i < valid.length; i++) {
        positions[i*3]   = valid[i][0];
        positions[i*3+1] = valid[i][2];
        positions[i*3+2] = -valid[i][1];
        colors.set([0.5, 0.5, 0.5], i * 3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return new THREE.Points(
        geometry,
        new THREE.PointsMaterial({
            size: 1,
            sizeAttenuation: false,
            vertexColors: true,
            transparent: true
        })
    );
}

async function loadCSV(url) {
    const text = await (await fetch(url)).text();
    return parseCSVToPoints(text);
}

/* ---------------- LOAD MULTIPLE CSVs ---------------- */
async function loadCSVs() {
    const urls = [
        '/csv/P1_S2_CHART.csv','/csv/P1_S4_CHART.csv','/csv/P2_S1A_CHART.csv',
        '/csv/P2_S2_CHART.csv','/csv/P2_S3_CHART.csv','/csv/P2_S4_CHART.csv',
        '/csv/P3_S1A_CHART.csv','/csv/P3_S2_CHART.csv','/csv/P3_S3_CHART.csv',
        '/csv/P3_S4_CHART.csv'
    ];

    const markerGeo = new THREE.SphereGeometry(2, 16, 16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 'black' });

    for (const url of urls) {
        const pc = await loadCSV(url);
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

/* ---------------- HEAT UPDATE ---------------- */
const tmpVec = new THREE.Vector3();
let frameSkip = 5;

function applyHeatAtPoint(p) {
    for (const mesh of objects.heatMeshes) {
        const { grid, cellSize, heat, dirty, vx, vy, vz } = mesh.userData;

        const gx = Math.floor(p.x / cellSize);
        const gy = Math.floor(p.y / cellSize);
        const gz = Math.floor(p.z / cellSize);

        for (let ix=-1; ix<=1; ix++)
        for (let iy=-1; iy<=1; iy++)
        for (let iz=-1; iz<=1; iz++) {
            const list = grid.get(gridKey(gx+ix, gy+iy, gz+iz));
            if (!list) continue;

            for (const i of list) {
                const dx = vx[i]-p.x;
                const dy = vy[i]-p.y;
                const dz = vz[i]-p.z;
                const d2 = dx*dx + dy*dy + dz*dz;

                if (d2 >= R2) continue;

                heat[i] = Math.min(
                    heat[i] + Math.pow(1 - d2 * INV_R2, HEAT_PARAMS.falloff) * HEAT_PARAMS.agentStrength,
                    HEAT_PARAMS.max
                );
                dirty.add(i);
            }
        }
    }
}

function updateHeat(frame) {
    if ((frameSkip++ & 1) === 1) return;

    for (const pc of objects.pointClouds) {
        const pos = pc.geometry.attributes.position;
        const idx = Math.min(frame, pos.count - 1);

        tmpVec.set(
            pos.array[idx*3] * WORLD_SCALE,
            pos.array[idx*3+1] * WORLD_SCALE,
            pos.array[idx*3+2] * WORLD_SCALE
        );

        if (tmpVec.distanceToSquared(camera.position) > MAX_AGENT_DISTANCE2) continue;
        applyHeatAtPoint(tmpVec);
    }

    for (const mesh of objects.heatMeshes) {
        const colors = mesh.geometry.attributes.color.array;
        const { heat, dirty } = mesh.userData;

        if (!dirty.size) continue;

        dirty.forEach(i => {
            const t = Math.floor(
                THREE.MathUtils.clamp(
                    (heat[i] - HEAT_PARAMS.min) * INV_HEAT_RANGE,
                    0, 1
                ) * (HEAT_COLOR_STEPS - 1)
            );
            colors.set(heatLUT[t], i * 4);
        });

        mesh.geometry.attributes.color.needsUpdate = true;
        dirty.clear();
    }
}

/* ---------------- PLAYBACK ---------------- */
const playback = { frame: 0, playing: false, speed: 5 };
let longestCSV = 0;
let ready = false;

const pane = new Pane();
const folder = pane.addFolder({ title: 'Playback' });
folder.addButton({ title: 'Play / Pause' })
    .on('click', () => playback.playing = !playback.playing);

const frameSlider = folder.addBinding(playback, 'frame', {
    min: 0,
    max: 100,
    step: 1
});

async function initPlayback() {
    while (!objects.pointClouds.length)
        await new Promise(r => setTimeout(r, 50));

    objects.pointClouds.forEach(pc => {
        longestCSV = Math.max(
            longestCSV,
            pc.geometry.attributes.position.count
        );
    });

    frameSlider.max = longestCSV - 1;
    ready = true;
}
initPlayback();

/* ---------------- ANIMATION LOOP ---------------- */
function animate() {
    stats.begin();

    if (ready && playback.playing) {
        playback.frame = Math.min(
            playback.frame + playback.speed,
            longestCSV - 1
        );
    }

    if (ready) {
        const f = Math.floor(playback.frame);
        updateHeat(f);

        for (const pc of objects.pointClouds) {
            const count = pc.geometry.attributes.position.count;
            const drawCount = Math.min(f + 1, count);

            if (drawCount !== pc.userData.prevDrawCount) {
                pc.geometry.setDrawRange(0, drawCount);
                pc.userData.prevDrawCount = drawCount;

                const marker = pc.userData.marker;
                if (drawCount > 0) {
                    const p = pc.geometry.attributes.position.array;
                    marker.position.set(
                        p[(drawCount-1)*3] * WORLD_SCALE,
                        p[(drawCount-1)*3+1] * WORLD_SCALE,
                        p[(drawCount-1)*3+2] * WORLD_SCALE
                    );
                    marker.visible = true;
                } else marker.visible = false;
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
