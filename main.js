import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CSG } from 'three-csg-ts';

// ====== PENGATURAN DASAR ======
const canvas = document.querySelector('#canvas-3d');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // DIUBAH: Background menjadi hitam
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(5, 6, 8);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ====== PENCAHAYAAN ======
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5); // DIUBAH: Intensitas sedikit diturunkan
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
directionalLight.position.set(8, 10, 5);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 1024;
directionalLight.shadow.mapSize.height = 1024;
directionalLight.shadow.camera.near = 0.5;
directionalLight.shadow.camera.far = 50;
scene.add(directionalLight);

// ====== KONTROL KAMERA DAN OBJEK ======
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
const transformControls = new TransformControls(camera, renderer.domElement);
scene.add(transformControls);
transformControls.addEventListener('dragging-changed', (event) => orbitControls.enabled = !event.value);

// ====== STATE MANAGEMENT & MATERIALS ======
let currentMode = 'translate';
let clickableObjects = [];
let wallObjects = [];
let floorMesh = null;
let wallStartPoint = null;
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xd9d9d9, side: THREE.DoubleSide });

// ====== FUNGSI MEMUAT MODEL 3D ======
const loader = new GLTFLoader();
function loadModel(modelPath, position) {
    loader.load(modelPath, (gltf) => {
        const model = gltf.scene;
        model.position.copy(position);
        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });
        scene.add(model);
        clickableObjects.push(model);
        transformControls.attach(model);
        setActiveMode('translate');
    });
}

// ====== FUNGSI UNTUK MEMBUAT RUANGAN ======
let currentRoom = new THREE.Group();
scene.add(currentRoom);

function generateRoom(width, depth, height) {
    while (currentRoom.children.length > 0) currentRoom.remove(currentRoom.children[0]);
    wallObjects = [];
    clickableObjects = clickableObjects.filter(obj => !obj.userData.isWall);

    floorMesh = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), new THREE.MeshStandardMaterial({ color: 0xffffff })); // DIUBAH: Lantai menjadi putih
    floorMesh.rotation.x = -Math.PI / 2;
    floorMesh.receiveShadow = true;
    currentRoom.add(floorMesh);

    const wallBack = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.1), wallMaterial);
    wallBack.position.set(0, height / 2, -depth / 2);
    const wallLeft = new THREE.Mesh(new THREE.BoxGeometry(depth, height, 0.1), wallMaterial);
    wallLeft.position.set(-width / 2, height / 2, 0);
    wallLeft.rotation.y = Math.PI / 2;
    const wallRight = new THREE.Mesh(new THREE.BoxGeometry(depth, height, 0.1), wallMaterial);
    wallRight.position.set(width / 2, height / 2, 0);
    wallRight.rotation.y = Math.PI / 2;

    [wallBack, wallLeft, wallRight].forEach(wall => {
        wall.castShadow = true;
        wall.userData.isWall = true;
        currentRoom.add(wall);
        wallObjects.push(wall);
        clickableObjects.push(wall);
    });
}

// ====== FUNGSI UNTUK MEMBUAT DINDING INTERIOR ======
function createInteriorWall(startPoint, endPoint) {
    const height = parseFloat(document.getElementById('room-height').value);
    const wallThickness = 0.1;
    const length = startPoint.distanceTo(endPoint);
    const centerPoint = new THREE.Vector3().addVectors(startPoint, endPoint).multiplyScalar(0.5);
    const angle = Math.atan2(endPoint.x - startPoint.x, endPoint.z - startPoint.z);
    const wall = new THREE.Mesh(
        new THREE.BoxGeometry(wallThickness, height, length),
        wallMaterial
    );
    wall.position.set(centerPoint.x, height / 2, centerPoint.z);
    wall.rotation.y = angle;
    wall.castShadow = true;
    wall.receiveShadow = true;
    wall.userData.isWall = true;
    currentRoom.add(wall);
    wallObjects.push(wall);
    clickableObjects.push(wall);
}

// ====== FUNGSI UNTUK MELUBANGI DINDING (CSG) ======
function createOpening(targetWall, point, type) {
    const openingSize = {
        window: { width: 1.5, height: 1.2, depth: 0.5 },
        door: { width: 1, height: 2.1, depth: 0.5 }
    };
    const size = openingSize[type];
    if (!size) return;
    const hole = new THREE.Mesh(new THREE.BoxGeometry(size.width, size.height, size.depth));
    hole.position.copy(point);
    hole.rotation.copy(targetWall.rotation);
    if (type === 'door') {
        hole.position.y = size.height / 2;
    }
    targetWall.updateMatrix();
    hole.updateMatrix();
    const newWall = CSG.subtract(targetWall, hole);
    newWall.userData.isWall = true;
    newWall.material = wallMaterial;
    currentRoom.remove(targetWall);
    currentRoom.add(newWall);
    let wallIndex = wallObjects.indexOf(targetWall);
    if (wallIndex > -1) wallObjects.splice(wallIndex, 1, newWall);
    let clickableIndex = clickableObjects.indexOf(targetWall);
    if (clickableIndex > -1) clickableObjects.splice(clickableIndex, 1, newWall);
}

// ====== INTERAKSI KLIK MOUSE ======
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
function onMouseClick(event) {
    if (document.getElementById('controls-panel').contains(event.target)) return;
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = - (event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    if (currentMode === 'addWall') {
        const intersects = raycaster.intersectObject(floorMesh);
        if (intersects.length > 0) {
            const point = intersects[0].point;
            if (!wallStartPoint) {
                wallStartPoint = point;
            } else {
                createInteriorWall(wallStartPoint, point);
                wallStartPoint = null;
                setActiveMode('translate');
            }
        }
    } else if (currentMode === 'addWindow' || currentMode === 'addDoor') {
        const intersects = raycaster.intersectObjects(wallObjects);
        if (intersects.length > 0) {
            createOpening(intersects[0].object, intersects[0].point, currentMode.replace('add', '').toLowerCase());
            setActiveMode('translate');
        }
    } else {
        const intersects = raycaster.intersectObjects(clickableObjects, true);
        if (intersects.length > 0) {
            let objectToSelect = intersects[0].object;
            while (objectToSelect.parent && !objectToSelect.parent.isScene && !objectToSelect.userData.isWall) {
                objectToSelect = objectToSelect.parent;
            }
            transformControls.attach(objectToSelect);
        } else {
            transformControls.detach();
        }
    }
}
window.addEventListener('click', onMouseClick);

// ====== MENGHUBUNGKAN UI DENGAN FUNGSI ======
const widthInput = document.getElementById('room-width');
const depthInput = document.getElementById('room-depth');
const heightInput = document.getElementById('room-height');
const createBtn = document.getElementById('create-room-btn');
createBtn.addEventListener('click', () => {
    generateRoom(parseFloat(widthInput.value), parseFloat(depthInput.value), parseFloat(heightInput.value));
});
document.querySelectorAll('.add-item-btn').forEach(button => {
    button.addEventListener('click', () => {
        loadModel(button.dataset.model, new THREE.Vector3(0, 0, 0));
    });
});
const modeButtons = {
    translate: document.getElementById('mode-translate'),
    rotate: document.getElementById('mode-rotate'),
    scale: document.getElementById('mode-scale')
};
function setActiveMode(mode) {
    currentMode = mode;
    canvas.classList.remove('crosshair-cursor');
    if (mode === 'translate' || mode === 'rotate' || mode === 'scale') {
        transformControls.setMode(mode);
        transformControls.enabled = true;
    } else {
        transformControls.detach();
        transformControls.enabled = false;
        if (mode !== 'select') canvas.classList.add('crosshair-cursor');
    }
    for (const key in modeButtons) {
        modeButtons[key].classList.toggle('active', key === mode);
    }
    if (mode !== 'addWall') {
        wallStartPoint = null;
    }
}
modeButtons.translate.addEventListener('click', () => setActiveMode('translate'));
modeButtons.rotate.addEventListener('click', () => setActiveMode('rotate'));
modeButtons.scale.addEventListener('click', () => setActiveMode('scale'));
document.getElementById('add-wall-btn').addEventListener('click', () => setActiveMode('addWall'));
document.getElementById('add-window-btn').addEventListener('click', () => setActiveMode('addWindow'));
document.getElementById('add-door-btn').addEventListener('click', () => setActiveMode('addDoor'));

document.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', (event) => {
        const newColor = event.target.dataset.color;
        wallMaterial.color.set(newColor);
    });
});

// ====== LOOP ANIMASI & PENYESUAIAN JENDELA ======
function animate() {
    requestAnimationFrame(animate);
    orbitControls.update();
    renderer.render(scene, camera);
}
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
});

generateRoom(parseFloat(widthInput.value), parseFloat(depthInput.value), parseFloat(heightInput.value));
setActiveMode('translate');
animate();