import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Papa from 'papaparse';

/* ===================== CHECK ===================== */
if (!window.WebGL2RenderingContext) alert('WebGL2 required');

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
renderer.getContext();

/* ===================== CONTROLS ===================== */
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, -250);

/* ===================== CONSTANTS ===================== */
const WORLD_SCALE = 0.01;
const HEAT_INTENSITY = 0.2;
const TEX_RES = 1024;
const SPREAD_PIXELS = 3;

/* ===================== STORAGE ===================== */
const objects = { gltfModel: null, pointCloud: null };
let textures = { XY: null, YZ: null, XZ: null };
let meshBoundingBox = new THREE.Box3();

/* ===================== LOAD GLTF ===================== */
new GLTFLoader().load('/models/map_high.glb', gltf => {
    objects.gltfModel = gltf.scene;
    scene.add(gltf.scene);
    meshBoundingBox.setFromObject(objects.gltfModel);
    console.log('Mesh loaded');

    if (objects.pointCloud) {
        buildProjectionTextures();
        applyHeatmapMaterial();
        previewTextures();
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

            // Use original point cloud positions
            const x = r[0] * WORLD_SCALE;
            const y = r[1] * WORLD_SCALE;  // keep Y as in CSV
            const z = -r[2] * WORLD_SCALE; // adjust if necessary

            positions.push(x, y, z);
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
        buildProjectionTextures();
        applyHeatmapMaterial();
        previewTextures();
    }
}
loadCSVs();

/* ===================== BUILD 3 PROJECTION TEXTURES ===================== */
function buildProjectionTextures() {
    const points = objects.pointCloud.geometry.attributes.position.array;

    function makeTextureRGBA(projAxis1, projAxis2, size = TEX_RES) {
        const data = new Float32Array(size * size).fill(0);

        for (let i = 0; i < points.length; i += 3) {
            const x = points[i];
            const y = points[i + 1];
            const z = points[i + 2];

            const u = projAxis1 === 'x' ? x : projAxis1 === 'y' ? y : z;
            const v = projAxis2 === 'x' ? x : projAxis2 === 'y' ? y : z;

            let uNorm = (u - meshBoundingBox.min[projAxis1]) / (meshBoundingBox.max[projAxis1] - meshBoundingBox.min[projAxis1]);
            let vNorm = (v - meshBoundingBox.min[projAxis2]) / (meshBoundingBox.max[projAxis2] - meshBoundingBox.min[projAxis2]);
            uNorm = THREE.MathUtils.clamp(uNorm, 0, 1);
            vNorm = THREE.MathUtils.clamp(vNorm, 0, 1);

            const iu = Math.floor(uNorm * (size - 1));
            const iv = Math.floor(vNorm * (size - 1));

            for (let dx = -SPREAD_PIXELS; dx <= SPREAD_PIXELS; dx++) {
                for (let dy = -SPREAD_PIXELS; dy <= SPREAD_PIXELS; dy++) {
                    const ix = THREE.MathUtils.clamp(iu + dx, 0, size - 1);
                    const iy = THREE.MathUtils.clamp(iv + dy, 0, size - 1);
                    data[iy * size + ix] += 1;
                }
            }
        }

        let maxVal = 0;
        for (let i = 0; i < data.length; i++) {
            if (data[i] > maxVal) maxVal = data[i];
        }
        if (maxVal > 0) for (let i = 0; i < data.length; i++) data[i] /= maxVal;

        const rgbaData = new Uint8Array(size * size * 4);
        for (let i = 0; i < size * size; i++) {
            const v = Math.min(1, data[i]) * 255;
            rgbaData[i * 4 + 0] = v;
            rgbaData[i * 4 + 1] = v;
            rgbaData[i * 4 + 2] = v;
            rgbaData[i * 4 + 3] = 255;
        }

        const tex = new THREE.DataTexture(rgbaData, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
        tex.needsUpdate = true;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        return tex;
    }

    textures.XY = makeTextureRGBA('x', 'y');
    textures.YZ = makeTextureRGBA('y', 'z');
    textures.XZ = makeTextureRGBA('x', 'z');

    console.log('Projection textures built');
}

/* ===================== APPLY HEATMAP SHADER WITH DEBUG OPTIONS ===================== */
function applyHeatmapMaterial(debugMode = 0) {
    const mesh = objects.gltfModel;

    const heatGradient = `
        vec3 heat(float t){
            float h = (1.0 - t) * 0.7;
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
            else if(i == 4.0) c = vec3(r,p,q);
            else c = vec3(v,p,q);
            return c;
        }
    `;

    mesh.traverse(obj => {
        if (!obj.isMesh) return;

        obj.material = new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            uniforms: {
                texXY: { value: textures.XY },
                texYZ: { value: textures.YZ },
                texXZ: { value: textures.XZ },
                gridMin: { value: meshBoundingBox.min },
                gridMax: { value: meshBoundingBox.max },
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
                uniform sampler2D texXY;
                uniform sampler2D texYZ;
                uniform sampler2D texXZ;
                uniform vec3 gridMin, gridMax;
                uniform float intensity;
                in vec3 vWorldPos;
                out vec4 outColor;

                ${heatGradient}

                void main() {
                    vec3 normPos = (vWorldPos - gridMin) / (gridMax - gridMin);
                    normPos = clamp(normPos, 0.0, 1.0);

                    vec2 uvXY = normPos.xy;
                    vec2 uvYZ = normPos.yz;
                    vec2 uvXZ = normPos.xz;

                    float dXY = texture(texXY, uvXY).r;
                    float dYZ = texture(texYZ, uvYZ).r;
                    float dXZ = texture(texXZ, uvXZ).r;

                    float d;

                    // debug modes
                    if(debugMode == 1) { outColor = vec4(normPos,1.0); return; } // normalized position RGB
                    if(debugMode == 2) { outColor = vec4(dXY,dXY,dXY,1.0); return; } // XY only
                    if(debugMode == 3) { outColor = vec4(dYZ,dYZ,dYZ,1.0); return; } // YZ only
                    if(debugMode == 4) { outColor = vec4(dXZ,dXZ,dXZ,1.0); return; } // XZ only

                    d = (dXY + dYZ + dXZ)/3.0;
                    d = 1.0 - exp(-d * intensity * 3.0);

                    outColor = vec4(heat(d),1.0);
                }
            `
        });
    });

    console.log('3D heatmap shader applied (debugMode=' + debugMode + ')');
}

/* ===================== PREVIEW TEXTURES ===================== */
function previewTextures() {
    const size = 100;
    const gap = 10;
    const texArray = [textures.XY, textures.YZ, textures.XZ];
    const labels = ['XY', 'YZ', 'XZ'];

    texArray.forEach((tex, i) => {
        const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
        const geo = new THREE.PlaneGeometry(size, size);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set((size + gap) * i, 10, 0);
        mesh.rotation.x = -Math.PI / 2;
        scene.add(mesh);
        console.log(`Previewing ${labels[i]} texture`);
    });
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
