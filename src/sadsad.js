
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Papa from 'papaparse';
import { Pane } from 'tweakpane';
import Stats from 'stats.js';

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
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));

/* ---------------- CONTROLS ---------------- */
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 0, -250);

/* ---------------- GLOBALS ---------------- */
const WORLD_SCALE = 0.01;
const MAX_AGENTS = 20;
let vertexCount = 0;
let heatTexSize = 0;
let heatRT1, heatRT2;
let heatMaterial, heatScene, heatCamera;
let vertexPosTexture;
let meshWithHeat;
const objects = { pointClouds: [] };

/* ---------------- LOAD GLTF ---------------- */
const loader = new GLTFLoader();
loader.load('/models/map_high.glb', gltf => {
    gltf.scene.traverse(o => {
        if (!o.isMesh) return;

        const posAttr = o.geometry.attributes.position;
        vertexCount = posAttr.count;
        heatTexSize = Math.pow(2, Math.ceil(Math.log2(Math.sqrt(vertexCount))));
        const texSize = heatTexSize;

        // vertex position texture
        const vertexPosArray = new Float32Array(texSize * texSize * 4);
        for (let i = 0; i < vertexCount; i++) {
            vertexPosArray[i * 4] = posAttr.getX(i) * WORLD_SCALE;
            vertexPosArray[i * 4 + 1] = posAttr.getY(i) * WORLD_SCALE;
            vertexPosArray[i * 4 + 2] = posAttr.getZ(i) * WORLD_SCALE;
            vertexPosArray[i * 4 + 3] = 1.0;
        }
        vertexPosTexture = new THREE.DataTexture(vertexPosArray, texSize, texSize, THREE.RGBAFormat, THREE.FloatType);
        vertexPosTexture.needsUpdate = true;

        // heat render targets
        heatRT1 = new THREE.WebGLRenderTarget(texSize, texSize, { type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
        heatRT2 = heatRT1.clone();

        // heat update scene
        heatScene = new THREE.Scene();
        heatCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        const quadGeo = new THREE.PlaneGeometry(2, 2);
        heatMaterial = new THREE.ShaderMaterial({
            uniforms: {
                prevHeat: { value: heatRT1.texture },
                vertexPos: { value: vertexPosTexture },
                agentsPos: { value: new Float32Array(MAX_AGENTS * 3) },
                numAgents: { value: 0 },
                decay: { value: 0.98 },
                radius: { value: 0.05 } // scaled radius ~ matches tiny WORLD_SCALE
            },
            vertexShader: `void main(){ gl_Position=vec4(position,1.0); }`,
            fragmentShader: `
                precision highp float;
                uniform sampler2D prevHeat;
                uniform sampler2D vertexPos;
                uniform vec3 agentsPos[${MAX_AGENTS}];
                uniform int numAgents;
                uniform float decay;
                uniform float radius;
                void main(){
                    vec2 uv = gl_FragCoord.xy / vec2(${heatTexSize}.0, ${heatTexSize}.0);
                    vec4 posData = texture2D(vertexPos, uv);
                    float heat = texture2D(prevHeat, uv).r;

                    // forced heat debug for first vertex
                    if(gl_FragCoord.x < 1.0) heat = 0.2;

                    for(int i=0;i<${MAX_AGENTS};i++){
                        if(i>=numAgents) break;
                        float dist = length(posData.xyz - agentsPos[i]);
                        heat += exp(-dist*dist/(radius*radius));
                    }

                    heat *= decay;
                    gl_FragColor = vec4(heat,0.0,0.0,1.0);
                }
            `
        });
        const quad = new THREE.Mesh(quadGeo, heatMaterial);
        heatScene.add(quad);

        // mesh shader
        const heatVertexMaterial = new THREE.ShaderMaterial({
            uniforms: {
                heatTex: { value: heatRT1.texture },
                heatTexSize: { value: heatTexSize },
                maxHeat: { value: 0.5 }
            },
            vertexShader: `
                uniform sampler2D heatTex;
                uniform float heatTexSize;
                varying float vHeat;
                void main(){
                    int vid = gl_VertexID;
                    int x = vid % int(heatTexSize);
                    int y = vid / int(heatTexSize);
                    vec2 uv = (vec2(float(x),float(y))+0.5)/heatTexSize;
                    vHeat = texture2D(heatTex, uv).r;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);
                }
            `,
            fragmentShader: `
                varying float vHeat;
                uniform float maxHeat;
                void main(){
                    float h = clamp(vHeat/maxHeat,0.0,1.0);
                    vec3 color = mix(vec3(0.0,0.0,1.0), vec3(1.0,0.0,0.0), h);
                    gl_FragColor = vec4(color,1.0);
                }
            `
        });
        o.material = heatVertexMaterial;
        meshWithHeat = o;
    });
    scene.add(gltf.scene);

    // Debug: print first vertex positions
    console.log("Vertex positions sample:");
    for(let i=0;i<Math.min(10,vertexCount);i++){
        console.log(
            vertexPosTexture.image.data[i*4].toFixed(2),
            vertexPosTexture.image.data[i*4+1].toFixed(2),
            vertexPosTexture.image.data[i*4+2].toFixed(2)
        );
    }
});

/* ---------------- CSV LOADING ---------------- */
async function parseCSV(url){
    const text = await (await fetch(url)).text();
    const rows = Papa.parse(text,{dynamicTyping:true}).data;
    const valid = rows.filter(r => r.length===3 && r.every(Number.isFinite));
    const positions = new Float32Array(valid.length*3);
    const colors = new Float32Array(valid.length*3);
    for(let i=0;i<valid.length;i++){
        positions[i*3] = valid[i][0];
        positions[i*3+1] = valid[i][2];
        positions[i*3+2] = -valid[i][1];
        colors.set([0.3,0.3,0.3], i*3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions,3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors,3));
    const points = new THREE.Points(geo,new THREE.PointsMaterial({size:1,sizeAttenuation:false,vertexColors:true}));
    points.scale.setScalar(WORLD_SCALE);
    points.geometry.setDrawRange(0,0);
    scene.add(points);
    const marker = new THREE.Mesh(new THREE.SphereGeometry(2,16,16),new THREE.MeshBasicMaterial({color:'black'}));
    marker.visible=false; scene.add(marker);
    points.userData.marker=marker;
    points.userData.prevDrawCount=0;
    objects.pointClouds.push(points);
}

async function loadCSVs(){
    const urls = [
        '/csv/P1_S2_CHART.csv','/csv/P1_S4_CHART.csv','/csv/P2_S1A_CHART.csv',
        '/csv/P2_S2_CHART.csv','/csv/P2_S3_CHART.csv','/csv/P2_S4_CHART.csv',
        '/csv/P3_S1A_CHART.csv','/csv/P3_S2_CHART.csv','/csv/P3_S3_CHART.csv',
        '/csv/P3_S4_CHART.csv'
    ];
    for(const u of urls) await parseCSV(u);
}
loadCSVs();

/* ---------------- PLAYBACK ---------------- */
const playback={frame:0,playing:false,speed:5};
let longestCSV=0; let ready=false;
const pane=new Pane();
pane.addButton({title:'Play / Pause'}).on('click',()=>playback.playing=!playback.playing);
const frameSlider = pane.addBinding(playback,'frame',{min:0,max:100});

async function initPlayback(){
    while(objects.pointClouds.length===0) await new Promise(r=>setTimeout(r,50));
    objects.pointClouds.forEach(pc=>longestCSV=Math.max(longestCSV,pc.geometry.attributes.position.count));
    frameSlider.max = longestCSV-1;
    ready=true;
}
initPlayback();

/* ---------------- DEBUG HEAT ---------------- */
function debugHeatTexture() {
    if (!heatRT1) return;
    const texSize = heatTexSize;
    const pixels = new Float32Array(texSize * texSize * 4);
    renderer.readRenderTargetPixels(heatRT1, 0, 0, texSize, texSize, pixels);
    console.log("Vertex heats:");
    for (let i = 0; i < Math.min(10, vertexCount); i++) {
        console.log(`Vertex ${i} heat:`, pixels[i * 4].toFixed(3));
    }
}

/* ---------------- ANIMATE ---------------- */
const tmpVec=new THREE.Vector3();
function animate(){
    stats.begin();
    if(ready && playback.playing) playback.frame = Math.min(playback.frame + playback.speed,longestCSV-1);
    const f = Math.floor(playback.frame);
    const agents = [];

    for(const pc of objects.pointClouds){
        const count = pc.geometry.attributes.position.count;
        const drawCount = Math.min(f+1,count);
        if(drawCount!==pc.userData.prevDrawCount){
            pc.geometry.setDrawRange(0,drawCount);
            pc.userData.prevDrawCount=drawCount;

            const marker = pc.userData.marker;
            if(drawCount>0){
                const p = pc.geometry.attributes.position.array;
                tmpVec.set(
                    p[(drawCount-1)*3]*WORLD_SCALE,
                    p[(drawCount-1)*3+1]*WORLD_SCALE,
                    p[(drawCount-1)*3+2]*WORLD_SCALE
                );
                marker.position.copy(tmpVec);
                marker.visible=true;
                agents.push(tmpVec.clone());
            }
        }
    }

    // heat update
    if(meshWithHeat && vertexPosTexture){
        const agentsArray = new Float32Array(MAX_AGENTS*3);
        for(let i=0;i<MAX_AGENTS;i++){
            if(i<agents.length){
                agentsArray[i*3] = agents[i].x;
                agentsArray[i*3+1] = agents[i].y;
                agentsArray[i*3+2] = agents[i].z;
            }
        }
        heatMaterial.uniforms.prevHeat.value = heatRT1.texture;
        heatMaterial.uniforms.agentsPos.value = agentsArray;
        heatMaterial.uniforms.numAgents.value = agents.length;

        renderer.setRenderTarget(heatRT2);
        renderer.render(heatScene, heatCamera);
        renderer.setRenderTarget(null);

        const tmp = heatRT1; heatRT1 = heatRT2; heatRT2 = tmp;
        meshWithHeat.material.uniforms.heatTex.value = heatRT1.texture;

        // debug output
        debugHeatTexture();
    }

    controls.update();
    renderer.render(scene,camera);
    stats.end();
    requestAnimationFrame(animate);
}
animate();

/* ---------------- RESIZE ---------------- */
window.addEventListener('resize',()=>{
    camera.aspect = window.innerWidth/window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth,window.innerHeight);
});