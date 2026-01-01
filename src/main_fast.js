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
const camera = new THREE.PerspectiveCamera(12, window.innerWidth / window.innerHeight, 1, 10000);
camera.position.set(-400, 600, -1000);

/* ---------------- RENDERER ---------------- */
const canvas = document.querySelector('canvas.threejs');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

/* ---------------- CONTROLS ---------------- */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, -250);

/* ---------------- HEAT PARAMETERS ---------------- */
const HEAT_PARAMS = { radius: 4, agentStrength: 0.4, min: 0, max: 4, falloff: 4 };

/* ---------------- STORAGE ---------------- */
const objects = { gltfModel: null, heatMeshes: [], pointClouds: [] };

/* ---------------- HEAT TEXTURE ---------------- */
// create 1D gradient texture (256px)
const gradientSize = 256;
const gradientCanvas = document.createElement('canvas');
gradientCanvas.width = gradientSize;
gradientCanvas.height = 1;
const ctx = gradientCanvas.getContext('2d');
const gradient = ctx.createLinearGradient(0, 0, gradientSize, 0);
gradient.addColorStop(0, '#0000ff');   // blue
gradient.addColorStop(0.25, '#00ffff'); // cyan
gradient.addColorStop(0.5, '#00ff00');  // green
gradient.addColorStop(0.75, '#ffff00'); // yellow
gradient.addColorStop(1, '#ff0000');    // red
ctx.fillStyle = gradient;
ctx.fillRect(0, 0, gradientSize, 1);

const heatTexture = new THREE.Texture(gradientCanvas);
heatTexture.needsUpdate = true;

/* ---------------- HEAT SHADER ---------------- */
const heatVertexShader = `
attribute vec3 basePosition;
attribute float heat;
varying float vHeat;
void main() {
    vHeat = heat / ${HEAT_PARAMS.max.toFixed(1)};
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const heatFragmentShader = `
uniform sampler2D heatTex;
varying float vHeat;
void main() {
    vec3 color = texture2D(heatTex, vec2(vHeat, 0.5)).rgb;
    gl_FragColor = vec4(color, 0.8);
}
`;

/* ---------------- HEAT MESH INIT ---------------- */
function initHeatMesh(sourceMesh) {
    const geometry = sourceMesh.geometry.clone();
    const count = geometry.attributes.position.count;
    const pos = geometry.attributes.position.array;
    const m = sourceMesh.matrixWorld;
    const v = new THREE.Vector3();

    const basePos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        v.set(pos[i*3], pos[i*3+1], pos[i*3+2]).applyMatrix4(m);
        basePos[i*3] = v.x;
        basePos[i*3+1] = v.y;
        basePos[i*3+2] = v.z;
    }
    geometry.setAttribute('basePosition', new THREE.BufferAttribute(basePos, 3));
    const heatArray = new Float32Array(count);
    geometry.setAttribute('heat', new THREE.BufferAttribute(heatArray, 1));

    const material = new THREE.ShaderMaterial({
        vertexShader: heatVertexShader,
        fragmentShader: heatFragmentShader,
        uniforms: { heatTex: { value: heatTexture } },
        transparent: false,
        depthWrite: true
    });

    // use InstancedMesh for single draw call
    const mesh = new THREE.Mesh(geometry, material);
    mesh.geometry.computeBoundingSphere();
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
        o.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0 });
        initHeatMesh(o);
    });
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
        colors.set([0,0,0], i*3);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    return new THREE.Points(
        geometry,
        new THREE.PointsMaterial({ size: 1, sizeAttenuation: false, vertexColors: true, transparent: true })
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

    const markerGeo = new THREE.SphereGeometry(2,16,16);
    const markerMat = new THREE.MeshBasicMaterial({ color:'black' });

    for (const url of urls) {
        const pc = await loadCSV(url);
        if (!pc) continue;

        pc.scale.setScalar(WORLD_SCALE);
        pc.geometry.setDrawRange(0,0);
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
const tmpDiff = new THREE.Vector3();
let frameSkip = 5;

function updateHeat(frame) {
    if ((frameSkip++ & 1) === 1) return;
    const radius2 = HEAT_PARAMS.radius * HEAT_PARAMS.radius;
    const falloff = HEAT_PARAMS.falloff;
    const strength = HEAT_PARAMS.agentStrength;

    for (const pc of objects.pointClouds) {
        const pos = pc.geometry.attributes.position;
        const idx = Math.min(frame, pos.count-1);
        tmpVec.set(pos.array[idx*3]*WORLD_SCALE, pos.array[idx*3+1]*WORLD_SCALE, pos.array[idx*3+2]*WORLD_SCALE);

        if (tmpVec.distanceToSquared(camera.position) > MAX_AGENT_DISTANCE2) continue;

        for (const mesh of objects.heatMeshes) {
            const sphere = mesh.geometry.boundingSphere;
            const meshCenter = mesh.position.clone().add(sphere.center);
            const maxDist2 = (HEAT_PARAMS.radius + sphere.radius) ** 2;
            if (tmpVec.distanceToSquared(meshCenter) > maxDist2) continue;

            const heatAttr = mesh.geometry.attributes.heat;
            const basePos = mesh.geometry.attributes.basePosition.array;

            for (let i = 0; i < heatAttr.count; i++) {
                tmpDiff.set(basePos[i*3]-tmpVec.x, basePos[i*3+1]-tmpVec.y, basePos[i*3+2]-tmpVec.z);
                const d2 = tmpDiff.lengthSq();
                if (d2 < radius2) heatAttr.array[i] = Math.min(heatAttr.array[i] + Math.pow(1-d2/radius2, falloff)*strength, HEAT_PARAMS.max);
            }
            heatAttr.needsUpdate = true;
        }
    }
}

/* ---------------- PLAYBACK & ANIMATION ---------------- */
const playback = { frame:0, playing:false, speed:5 };
let longestCSV = 0;
let ready = false;

const pane = new Pane();
const folder = pane.addFolder({ title:'Playback' });
folder.addButton({ title:'Play / Pause' }).on('click', ()=>playback.playing=!playback.playing);
const frameSlider = folder.addBinding(playback,'frame',{ min:0,max:100,step:1 });

async function initPlayback() {
    while (!objects.pointClouds.length) await new Promise(r=>setTimeout(r,50));
    objects.pointClouds.forEach(pc => longestCSV = Math.max(longestCSV, pc.geometry.attributes.position.count));
    frameSlider.max = longestCSV-1;
    ready = true;
}
initPlayback();

function animate() {
    stats.begin();
    if (ready && playback.playing) playback.frame = Math.min(playback.frame + playback.speed, longestCSV-1);
    if (ready) {
        const f = Math.floor(playback.frame);
        updateHeat(f);
        for (const pc of objects.pointClouds) {
            const count = pc.geometry.attributes.position.count;
            const drawCount = Math.min(f+1,count);
            if (drawCount !== pc.userData.prevDrawCount) {
                pc.geometry.setDrawRange(0,drawCount);
                pc.userData.prevDrawCount = drawCount;

                const marker = pc.userData.marker;
                if (drawCount>0) {
                    const p = pc.geometry.attributes.position.array;
                    marker.position.set(p[(drawCount-1)*3]*WORLD_SCALE,p[(drawCount-1)*3+1]*WORLD_SCALE,p[(drawCount-1)*3+2]*WORLD_SCALE);
                    marker.visible=true;
                } else marker.visible=false;
            }
        }
    }
    controls.update();
    renderer.render(scene,camera);
    stats.end();
    requestAnimationFrame(animate);
}
animate();

/* ---------------- RESIZE ---------------- */
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});