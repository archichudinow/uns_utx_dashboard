import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Stats from 'stats.js';
import { Pane } from 'tweakpane';
import Papa from 'papaparse';

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

const camera = new THREE.PerspectiveCamera(12, window.innerWidth / window.innerHeight, 1, 10000);
camera.position.set(-400, 600, -1000);

const canvas = document.querySelector('canvas.threejs');
const isMobile = /Mobi|Android/i.test(navigator.userAgent);

const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(isMobile ? 1.25 : Math.min(window.devicePixelRatio, 1.25));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = isMobile ? 0.05 : 0.1;
controls.target.set(0, 0, -250);
controls.maxPolarAngle = Math.PI / 2.2;
controls.minDistance = 100;
controls.maxDistance = 4000;

/* ============================================================
   GLOBALS
============================================================ */
const AGENT_RADIUS = 4.0;
const MAX_HEAT = 50.0;
const WORLD_SCALE = 0.01;

let heatTexSize = 0;
let heatRT1, heatRT2;
let heatScene, heatCamera;
let heatMaterial;

let vertexPosTexture;
let totalVertexCount = 0;
let vertexOffset = 0;

const meshList = [];
let agentsArray = null;
let movingAgentsMask = [];
const glbCenter = new THREE.Vector3();

const objects = { pointClouds: [] };
const playback = { frame: 0, playing: false, speed: 5 };
let longestCSV = 0;
let readyToPlay = false;

// --- InstancedMesh for agents ---
let markerMesh = null;
// dummy Object3D reused for InstancedMesh updates
const dummy = new THREE.Object3D();

/* ============================================================
   CSV LOADING
============================================================ */
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
        colors.set([0.3,0.3,0.3], i*3);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors,3));

    return new THREE.Points(
        geo,
        new THREE.PointsMaterial({ size:1, sizeAttenuation:false, vertexColors:true })
    );
}

async function loadCSVs(urls) {
    longestCSV = 0;

    for(const url of urls){
        const pc = await (await fetch(url)).text().then(parseCSVToPoints);
        if(!pc) continue;

        pc.scale.setScalar(WORLD_SCALE);
        pc.geometry.setDrawRange(0,0);
        scene.add(pc);

        pc.userData.prevDrawCount = -1;
        objects.pointClouds.push(pc);

        longestCSV = Math.max(longestCSV, pc.geometry.attributes.position.count);
    }

    // initialize agents array and mask
    agentsArray = new Float32Array(objects.pointClouds.length*3);
    movingAgentsMask = objects.pointClouds.map(()=>false);

    // set initial positions immediately
    objects.pointClouds.forEach((pc,idx)=>{
        const p = pc.geometry.attributes.position.array;
        if(p.length>=3){
            const x = p[0]*WORLD_SCALE;
            const y = p[1]*WORLD_SCALE;
            const z = p[2]*WORLD_SCALE;
            agentsArray[idx*3] = x;
            agentsArray[idx*3+1] = y;
            agentsArray[idx*3+2] = z;
        }
    });

    // --- create InstancedMesh for agents ---
    const markerGeo = new THREE.SphereGeometry(2,16,16);
    const markerMat = new THREE.MeshBasicMaterial({ color: 'black' });
    markerMesh = new THREE.InstancedMesh(markerGeo, markerMat, objects.pointClouds.length);
    markerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    markerMesh.frustumCulled = false; // prevent disappearing on orbit
    scene.add(markerMesh);

    // set initial agent positions in InstancedMesh
    objects.pointClouds.forEach((pc, idx) => {
        dummy.position.set(
            agentsArray[idx*3],
            agentsArray[idx*3+1],
            agentsArray[idx*3+2]
        );
        dummy.updateMatrix();
        markerMesh.setMatrixAt(idx, dummy.matrix);
    });
    markerMesh.instanceMatrix.needsUpdate = true;

    console.log('CSV agents loaded:', objects.pointClouds.length, 'Longest CSV points:', longestCSV);
}

/* ============================================================
   BLACK LINES OVERLAY
============================================================ */
function loadLines() {
    const loader = new GLTFLoader();

    loader.load(
        '/models/map_lines_low.glb',
        (gltf) => {
            const model = gltf.scene;

            model.traverse((child) => {
                if (child.isLine) {
                    // Line rendering fixes
                    child.material.color.set(0x000000);
                    
                    // Prevent flickering / Z-fighting
                    child.material.depthWrite = true;  // ← here!
                    child.material.depthTest = true;    // optional, usually true
                }
            });

            scene.add(model);
            console.log('Lines loaded:', model);
        },
        undefined,
        (error) => {
            console.error('Error loading GLB:', error);
        }
    );
}

loadLines();




/* ============================================================
   GLTF LOADING & HEATMAP INIT
============================================================ */
async function initHeatmap() {
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve,reject)=>{
        loader.load('/models/map_high.glb', resolve, undefined, reject);
    });

    console.log('GLTF mesh loaded');

    gltf.scene.traverse(o => { 
        if(o.isMesh) totalVertexCount += o.geometry.attributes.position.count; 
    });
    heatTexSize = Math.ceil(Math.sqrt(totalVertexCount));
    const vertexPosArray = new Float32Array(heatTexSize*heatTexSize*4);

    gltf.scene.traverse(o=>{
        if(!o.isMesh) return;
        const pos = o.geometry.attributes.position;
        const count = pos.count;
        const heatUV = new Float32Array(count*2);

        for(let i=0;i<count;i++){
            const index = vertexOffset+i;
            const x = index % heatTexSize;
            const y = Math.floor(index/heatTexSize);

            heatUV[i*2] = (x+0.5)/heatTexSize;
            heatUV[i*2+1] = (y+0.5)/heatTexSize;

            vertexPosArray[index*4]   = pos.getX(i);
            vertexPosArray[index*4+1] = pos.getY(i);
            vertexPosArray[index*4+2] = pos.getZ(i);
            vertexPosArray[index*4+3] = 1.0;
        }

        o.geometry.setAttribute('heatUV', new THREE.BufferAttribute(heatUV,2));
        vertexOffset += count;
        meshList.push(o);
    });

    // ✅ Keep Float32Array for vertex positions, avoids HALF_FLOAT_OES error
    vertexPosTexture = new THREE.DataTexture(
        vertexPosArray, 
        heatTexSize, 
        heatTexSize, 
        THREE.RGBAFormat, 
        THREE.FloatType
    );
    vertexPosTexture.needsUpdate = true;

    // ✅ Render targets use HalfFloat for reduced memory
    heatRT1 = new THREE.WebGLRenderTarget(heatTexSize, heatTexSize,{
        format:THREE.RGBAFormat,
        type:THREE.HalfFloatType,
        minFilter:THREE.NearestFilter,
        magFilter:THREE.NearestFilter,
        wrapS:THREE.ClampToEdgeWrapping,
        wrapT:THREE.ClampToEdgeWrapping
    });
    heatRT2 = heatRT1.clone();

    heatScene = new THREE.Scene();
    heatCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);

    heatMaterial = new THREE.ShaderMaterial({
        uniforms:{
            prevHeat:{value:heatRT1.texture},
            vertexPos:{value:vertexPosTexture},
            agentsPos:{value:agentsArray},
            numAgents:{value:objects.pointClouds.length},
            radius:{value:AGENT_RADIUS},
            playing:{value:true}
        },
        vertexShader:`void main(){gl_Position=vec4(position,1.0);}`,
        fragmentShader:`precision highp float;
            uniform sampler2D prevHeat;
            uniform sampler2D vertexPos;
            uniform vec3 agentsPos[32];
            uniform int numAgents;
            uniform float radius;
            uniform bool playing;

            void main(){
                vec2 uv = gl_FragCoord.xy/vec2(${heatTexSize}.0);
                vec3 pos = texture2D(vertexPos, uv).xyz;
                float heat = texture2D(prevHeat, uv).r;

                if(playing){
                    for(int i=0;i<32;i++){
                        if(i>=numAgents) break;
                        vec3 d = pos - agentsPos[i];
                        float d2 = dot(d,d);
                        float influence = max(0.0,1.0-d2/(radius*radius));
                        heat += influence;
                    }
                }

                gl_FragColor = vec4(heat,0.0,0.0,1.0);
            }`
    });

    heatScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),heatMaterial));

    // Shader for rendering heatmap
    meshList.forEach(mesh=>{
        mesh.material = new THREE.ShaderMaterial({
            uniforms:{
                heatTex:{value:heatRT1.texture}, 
                maxHeat:{value:MAX_HEAT}
            },
            vertexShader:`
                attribute vec2 heatUV;
                varying float vHeat;
                uniform sampler2D heatTex;
                void main(){
                    vHeat = texture2D(heatTex,heatUV).r;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
                }
            `,
            fragmentShader:`
                varying float vHeat;
                uniform float maxHeat;

                vec3 heatColor(float h){
                    if(h < 0.25){
                        float t = h/0.25;
                        return mix(vec3(0.0,0.0,1.0), vec3(0.0,1.0,1.0), t);
                    } else if(h < 0.5){
                        float t = (h-0.25)/0.25;
                        return mix(vec3(0.0,1.0,1.0), vec3(1.0,1.0,0.0), t);
                    } else if(h < 0.75){
                        float t = (h-0.5)/0.25;
                        return mix(vec3(1.0,1.0,0.0), vec3(1.0,0.5,0.0), t);
                    } else{
                        float t = (h-0.75)/0.25;
                        return mix(vec3(1.0,0.5,0.0), vec3(1.0,0.0,0.0), t);
                    }
                }

                void main(){
                    float h = clamp(vHeat/maxHeat,0.0,1.0);
                    vec3 col = heatColor(h);
                    gl_FragColor = vec4(col,1.0);
                }
            `
        });
    });

    scene.add(gltf.scene);
    new THREE.Box3().setFromObject(gltf.scene).getCenter(glbCenter);
}

/* ============================================================
   INIT EVERYTHING ON PAGE LOAD
============================================================ */
async function initScene() {
    const urls = [
        '/csv/P1_S2_CHART.csv','/csv/P1_S4_CHART.csv',
        '/csv/P2_S1A_CHART.csv','/csv/P2_S2_CHART.csv',
        '/csv/P2_S3_CHART.csv','/csv/P2_S4_CHART.csv',
        '/csv/P3_S1A_CHART.csv','/csv/P3_S2_CHART.csv',
        '/csv/P3_S3_CHART.csv','/csv/P3_S4_CHART.csv'
    ];

    await loadCSVs(urls);
    await initHeatmap();
    readyToPlay = true;
}

initScene();

/* ============================================================
   TWEAKPANE
============================================================ */
const pane = new Pane();
pane.addButton({title:'Play / Pause'}).on('click',()=>{
    if(!readyToPlay) return;
    playback.playing = !playback.playing;
    movingAgentsMask = playback.playing ? movingAgentsMask.map(()=>true) : movingAgentsMask.map(()=>false);
});

/* ============================================================
   ANIMATION LOOP
============================================================ */
function animate(){
    stats.begin();

    if(readyToPlay && playback.playing){
        playback.frame += playback.speed;
        if(playback.frame >= longestCSV) playback.frame = longestCSV-1;
    }

    if(agentsArray && objects.pointClouds.length>0 && heatMaterial){
        const f = Math.floor(playback.frame);

        objects.pointClouds.forEach((pc, idx)=>{
            const count = pc.geometry.attributes.position.count;
            const drawCount = Math.min(f + 1, count);

            if(pc.userData.prevDrawCount !== drawCount){
                pc.geometry.setDrawRange(0, drawCount);
                pc.userData.prevDrawCount = drawCount;
            }

            const p = pc.geometry.attributes.position.array;

            if(drawCount>0 && p.length>=3){
                if(movingAgentsMask[idx]){
                    const idx3 = (drawCount-1)*3;
                    const x = p[idx3]*WORLD_SCALE;
                    const y = p[idx3+1]*WORLD_SCALE;
                    const z = p[idx3+2]*WORLD_SCALE;

                    agentsArray[idx*3] = x;
                    agentsArray[idx*3+1] = y;
                    agentsArray[idx*3+2] = z;

                    dummy.position.set(x,y,z);
                } else {
                    agentsArray[idx*3] = 1e6;
                    agentsArray[idx*3+1] = 1e6;
                    agentsArray[idx*3+2] = 1e6;
                    dummy.position.set(1e6,1e6,1e6);
                }

                dummy.updateMatrix();
                markerMesh.setMatrixAt(idx, dummy.matrix);
            }
        });

        markerMesh.instanceMatrix.needsUpdate = true;

        if(f % 2 === 0){
            heatMaterial.uniforms.prevHeat.value = heatRT1.texture;
            heatMaterial.uniforms.agentsPos.value = agentsArray;
            heatMaterial.uniforms.numAgents.value = objects.pointClouds.length;
            heatMaterial.uniforms.playing.value = playback.playing;

            renderer.setRenderTarget(heatRT2);
            renderer.render(heatScene,heatCamera);
            renderer.setRenderTarget(null);

            [heatRT1,heatRT2] = [heatRT2,heatRT1];

            meshList.forEach(m=>{
                if(m.material && m.material.uniforms){
                    m.material.uniforms.heatTex.value = heatRT1.texture;
                }
            });
        }
    }

    controls.update();
    renderer.render(scene,camera);

    stats.end();
    requestAnimationFrame(animate);
}

animate();

/* ============================================================
   WINDOW RESIZE
============================================================ */
window.addEventListener('resize',()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
});
