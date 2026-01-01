import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Stats from 'stats.js';

/* ============================================================
   BASIC SETUP
============================================================ */
const stats = new Stats();
document.body.appendChild(stats.dom);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#e0d9ce');

scene.add(new THREE.AmbientLight(0xffffff, 1));
const dirLight = new THREE.DirectionalLight(0xffffff, 2);
dirLight.position.set(1000, 1500, 1000);
scene.add(dirLight);

/* ============================================================
   CAMERA & RENDERER
============================================================ */
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 5000);
camera.position.set(0, 50, 150);

const canvas = document.querySelector('canvas.threejs');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

/* ============================================================
   GLOBALS
============================================================ */
const NUM_AGENTS = 8;
const AGENT_RADIUS = 50.0;
const MAX_HEAT = 50.0;

let heatTexSize = 0;
let heatRT1, heatRT2;
let heatScene, heatCamera;
let heatMaterial;

let vertexPosTexture;
let totalVertexCount = 0;
let vertexOffset = 0;

const meshList = [];
const agents = [];
const agentSpheres = [];
const glbCenter = new THREE.Vector3();

/* ============================================================
   LOAD MODEL & BUILD HEAT DATA
============================================================ */
const loader = new GLTFLoader();
loader.load('/models/map_high.glb', gltf => {

    // ---- count vertices ----
    gltf.scene.traverse(o => {
        if (o.isMesh) totalVertexCount += o.geometry.attributes.position.count;
    });

    // NPOT texture size (tight fit)
    heatTexSize = Math.ceil(Math.sqrt(totalVertexCount));

    // ---- vertex position texture ----
    const vertexPosArray = new Float32Array(heatTexSize * heatTexSize * 4);

    gltf.scene.traverse(o => {
        if (!o.isMesh) return;

        const pos = o.geometry.attributes.position;
        const count = pos.count;
        const heatUV = new Float32Array(count * 2);

        for (let i = 0; i < count; i++) {
            const index = vertexOffset + i;
            const x = index % heatTexSize;
            const y = Math.floor(index / heatTexSize);

            heatUV[i * 2] = (x + 0.5) / heatTexSize;
            heatUV[i * 2 + 1] = (y + 0.5) / heatTexSize;

            vertexPosArray[index * 4 + 0] = pos.getX(i);
            vertexPosArray[index * 4 + 1] = pos.getY(i);
            vertexPosArray[index * 4 + 2] = pos.getZ(i);
            vertexPosArray[index * 4 + 3] = 1.0;
        }

        o.geometry.setAttribute('heatUV', new THREE.BufferAttribute(heatUV, 2));
        vertexOffset += count;
        meshList.push(o);
    });

    vertexPosTexture = new THREE.DataTexture(
        vertexPosArray,
        heatTexSize,
        heatTexSize,
        THREE.RGBAFormat,
        THREE.FloatType
    );
    vertexPosTexture.needsUpdate = true;

    /* ============================================================
       HEAT SIMULATION (GPU)
    ============================================================ */
    heatRT1 = new THREE.WebGLRenderTarget(heatTexSize, heatTexSize, {
        format: THREE.RGBAFormat,
        type: THREE.FloatType,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping
    });
    heatRT2 = heatRT1.clone();

    heatScene = new THREE.Scene();
    heatCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    heatMaterial = new THREE.ShaderMaterial({
        uniforms: {
            prevHeat: { value: heatRT1.texture },
            vertexPos: { value: vertexPosTexture },
            agentsPos: { value: new Float32Array(NUM_AGENTS * 3) },
            numAgents: { value: NUM_AGENTS },
            radius: { value: AGENT_RADIUS }
        },
        vertexShader: `
            void main() {
                gl_Position = vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            precision highp float;
            uniform sampler2D prevHeat;
            uniform sampler2D vertexPos;
            uniform vec3 agentsPos[${NUM_AGENTS}];
            uniform int numAgents;
            uniform float radius;

            void main() {
                vec2 uv = gl_FragCoord.xy / vec2(${heatTexSize}.0);
                vec3 pos = texture2D(vertexPos, uv).xyz;

                float heat = texture2D(prevHeat, uv).r;

                for (int i = 0; i < ${NUM_AGENTS}; i++) {
                    if (i >= numAgents) break;
                    vec3 d = pos - agentsPos[i];
                    float d2 = dot(d, d);
                    float influence = max(0.0, 1.0 - d2 / (radius * radius));
                    heat += influence;
                }

                gl_FragColor = vec4(heat, 0.0, 0.0, 1.0);
            }
        `
    });

    heatScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), heatMaterial));

    /* ============================================================
       VISUALIZATION SHADER
    ============================================================ */
    meshList.forEach(mesh => {
        mesh.material = new THREE.ShaderMaterial({
            uniforms: {
                heatTex: { value: heatRT1.texture },
                maxHeat: { value: MAX_HEAT }
            },
            vertexShader: `
                attribute vec2 heatUV;
                varying float vHeat;
                uniform sampler2D heatTex;

                void main() {
                    vHeat = texture2D(heatTex, heatUV).r;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                varying float vHeat;
                uniform float maxHeat;

                void main() {
                    float h = clamp(vHeat / maxHeat, 0.0, 1.0);
                    vec3 col = mix(vec3(0.0, 0.0, 1.0), vec3(1.0, 0.0, 0.0), h);
                    gl_FragColor = vec4(col, 1.0);
                }
            `
        });
    });

    scene.add(gltf.scene);

    new THREE.Box3().setFromObject(gltf.scene).getCenter(glbCenter);

    /* ============================================================
       AGENTS
    ============================================================ */
    for (let i = 0; i < NUM_AGENTS; i++) {
        const s = new THREE.Mesh(
            new THREE.SphereGeometry(1, 8, 8),
            new THREE.MeshBasicMaterial({ color: 'black' })
        );
        scene.add(s);
        agentSpheres.push(s);
        agents.push({
            pos: s.position.clone(),
            phase: i * Math.PI * 0.2
        });
    }
});

/* ============================================================
   ANIMATION LOOP
============================================================ */
let time = 0;
const agentsArray = new Float32Array(NUM_AGENTS * 3);

function animate() {
    stats.begin();
    time += 0.01;

    if (agents.length === NUM_AGENTS) {
        for (let i = 0; i < NUM_AGENTS; i++) {
            const a = agents[i];
            a.pos.set(
                glbCenter.x + Math.sin(time + a.phase) * 50,
                glbCenter.y + Math.sin(time * 2 + a.phase) * 5,
                glbCenter.z + Math.cos(time + a.phase) * 50
            );

            agentSpheres[i].position.copy(a.pos);

            agentsArray[i * 3 + 0] = a.pos.x;
            agentsArray[i * 3 + 1] = a.pos.y;
            agentsArray[i * 3 + 2] = a.pos.z;
        }

        heatMaterial.uniforms.prevHeat.value = heatRT1.texture;
        heatMaterial.uniforms.agentsPos.value = agentsArray;

        renderer.setRenderTarget(heatRT2);
        renderer.render(heatScene, heatCamera);
        renderer.setRenderTarget(null);

        [heatRT1, heatRT2] = [heatRT2, heatRT1];

        meshList.forEach(m => m.material.uniforms.heatTex.value = heatRT1.texture);
    }

    controls.update();
    renderer.render(scene, camera);
    stats.end();
    requestAnimationFrame(animate);
}

animate();

/* ============================================================
   RESIZE
============================================================ */
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
