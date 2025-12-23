import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Papa from 'papaparse';

/* ===================== CHECK ===================== */
if (!window.WebGL2RenderingContext) {
    alert('WebGL2 required');
}

/* ===================== SCENE ===================== */
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e0d9ce');
scene.add(new THREE.AmbientLight(0xffffff, 1));

/* ===================== CAMERA ===================== */
const camera = new THREE.PerspectiveCamera(12, window.innerWidth / window.innerHeight, 1, 10000);
camera.position.set(-400, 600, -1000);

/* ===================== RENDERER ===================== */
const renderer = new THREE.WebGLRenderer({
    canvas: document.querySelector('canvas.threejs'),
    antialias: true,
    alpha: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.getContext(); // force WebGL2

/* ===================== CONTROLS ===================== */
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, -250);

/* ===================== CONSTANTS ===================== */
const GRID_SIZE = 128;        // GPU density texture resolution
const WORLD_SCALE = 0.01;
const POINT_POWER = 0.3;
const HEAT_INTENSITY = 0.2;
const POINT_RADIUS = 1.0;    // meters in world units

/* ===================== STORAGE ===================== */
const objects = { gltfModel: null, pointCloud: null };
let densityTexture = null;

/* ===================== LOAD GLTF ===================== */
new GLTFLoader().load('/models/map_high.glb', gltf => {
    objects.gltfModel = gltf.scene;
    scene.add(gltf.scene);
    console.log('Mesh loaded');

    if (objects.pointCloud) {
        buildDensityGPU();
        applyHeatmapMaterial();
    }
});

/* ===================== LOAD CSV POINTS ===================== */
async function loadCSVs() {
    const urls = [
        '/csv/P1_S2_CHART.csv','/csv/P1_S4_CHART.csv','/csv/P2_S1A_CHART.csv',
        '/csv/P2_S2_CHART.csv','/csv/P2_S3_CHART.csv','/csv/P2_S4_CHART.csv',
        '/csv/P3_S1A_CHART.csv','/csv/P3_S2_CHART.csv','/csv/P3_S3_CHART.csv',
        '/csv/P3_S4_CHART.csv'
    ];

    const positions = [];

    for (const url of urls) {
        const text = await (await fetch(url)).text();
        const rows = Papa.parse(text, { dynamicTyping: true }).data;
        for (const r of rows) {
            if (r.length !== 3 || !r.every(Number.isFinite)) continue;
            positions.push(
                r[0] * WORLD_SCALE,
                0 * WORLD_SCALE,
                -r[1] * WORLD_SCALE
            );
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

    objects.pointCloud = new THREE.Points(
        geometry,
        new THREE.PointsMaterial({ size: 4, color: 0xff00ff })
    );
    objects.pointCloud.frustumCulled = false;
    scene.add(objects.pointCloud);

    console.log('Point cloud loaded:', positions.length / 3);

    if (objects.gltfModel) {
        buildDensityGPU();
        applyHeatmapMaterial();
    }
}
loadCSVs();

/* ===================== GPU VOXELIZATION WITH FULL 3D GAUSSIAN ===================== */
function buildDensityGPU() {
    console.log('Building GPU density texture with full 3D Gaussian…');

    const mesh = objects.gltfModel;
    const points = objects.pointCloud;

    const box = new THREE.Box3().setFromObject(mesh);
    const voxelSize = (box.max.x - box.min.x) / GRID_SIZE;
    const radiusVoxels = POINT_RADIUS / voxelSize * 1.5; // increased radius for smoother spread

    const rt = new THREE.WebGL3DRenderTarget(
        GRID_SIZE,
        GRID_SIZE,
        GRID_SIZE,
        {
            format: THREE.RedFormat,
            type: THREE.HalfFloatType,
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            depthBuffer: false,
            stencilBuffer: false
        }
    );

    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const voxelMat = new THREE.ShaderMaterial({
        glslVersion: THREE.GLSL3,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
        uniforms: {
            gridMin: { value: box.min },
            gridMax: { value: box.max },
            sliceZ: { value: 0 },
            radiusVoxels: { value: radiusVoxels },
            pointPower: { value: POINT_POWER },
        },
        vertexShader: `
            uniform vec3 gridMin;
            uniform vec3 gridMax;
            out vec3 vUVW;
            void main(){
                vUVW = (position - gridMin) / (gridMax - gridMin);
                gl_Position = vec4(vUVW.xy * 2.0 - 1.0, 0.0, 1.0);
                gl_PointSize = 1.0;
            }
        `,
        fragmentShader: `
            precision highp float;
            in vec3 vUVW;
            uniform float sliceZ;
            uniform float radiusVoxels;
            uniform float pointPower;
            out float outDensity;

            void main(){
                float z = vUVW.z * float(${GRID_SIZE});
                float dz = z - sliceZ;

                vec2 uv = gl_PointCoord - 0.5;
                float dx = uv.x * radiusVoxels * 2.0;
                float dy = uv.y * radiusVoxels * 2.0;
                float dist2 = dx*dx + dy*dy + dz*dz;

                outDensity = pointPower * exp(-dist2 / (2.0 * radiusVoxels * radiusVoxels));
            }
        `
    });

    const voxelScene = new THREE.Scene();
    points.material = voxelMat;
    voxelScene.add(points);

    renderer.setRenderTarget(rt);
    renderer.clearColor();

    for (let z = 0; z < GRID_SIZE; z++) {
        voxelMat.uniforms.sliceZ.value = z;
        renderer.setRenderTarget(rt, z);
        renderer.render(voxelScene, cam);
    }

    renderer.setRenderTarget(null);
    densityTexture = rt.texture;

    console.log('Full 3D Gaussian density texture built');
}

/* ===================== SMOOTH HEATMAP MATERIAL ===================== */
function applyHeatmapMaterial() {
    const mesh = objects.gltfModel;
    const box = new THREE.Box3().setFromObject(mesh);

    // HSV-based smooth gradient
    const heatGradient = `
        vec3 heat(float t){
            float h = (1.0 - t) * 0.7; // hue from blue to red
            float s = 1.0;
            float v = 1.0;
            vec3 c;
            float i = floor(h * 6.0);
            float f = h*6.0 - i;
            float p = v * (1.0 - s);
            float q = v * (1.0 - f*s);
            float r = v * (1.0 - (1.0 - f) * s);
            if(i == 0.0) c = vec3(v,r,p);
            else if(i == 1.0) c = vec3(q,v,p);
            else if(i == 2.0) c = vec3(p,v,r);
            else if(i == 3.0) c = vec3(p,q,v);
            else if(i == 4.0) c = vec3(r,p,v);
            else c = vec3(v,p,q);
            return c;
        }
    `;

    mesh.traverse(obj => {
        if (!obj.isMesh) return;

        obj.material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                densityTex: { value: densityTexture },
                gridMin: { value: box.min },
                gridMax: { value: box.max },
                intensity: { value: HEAT_INTENSITY }
            },
            vertexShader: `
                out vec3 vWorldPos;
                void main(){
                    vec4 wp = modelMatrix * vec4(position,1.0);
                    vWorldPos = wp.xyz;
                    gl_Position = projectionMatrix * viewMatrix * wp;
                }
            `,
            fragmentShader: `
                precision highp float;
                uniform sampler3D densityTex;
                uniform vec3 gridMin, gridMax;
                uniform float intensity;
                in vec3 vWorldPos;
                out vec4 outColor;

                ${heatGradient}

                void main(){
                    vec3 uvw = (vWorldPos - gridMin) / (gridMax - gridMin);
                    if(any(lessThan(uvw,vec3(0))) || any(greaterThan(uvw,vec3(1)))) discard;

                    float d = texture(densityTex, uvw).r;
                    d = 1.0 - exp(-d * intensity * 3.0); // smooth exponential mapping

                    outColor = vec4(heat(d), 1.0);
                }
            `
        });
    });

    console.log('Smooth heatmap with full 3D Gaussian applied');
}

/* ===================== LOOP ===================== */
function animate() {
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}
animate();

/* ===================== RESIZE ===================== */
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
