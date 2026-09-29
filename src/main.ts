import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './styles.css';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
const loading = document.querySelector<HTMLElement>('#loading');

if (!canvas || !loading) {
  throw new Error('Required application elements are missing.');
}

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x030711);
scene.fog = new THREE.FogExp2(0x030711, 0.012);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 300);
camera.position.set(0, 5.5, 12);
camera.lookAt(0, 0, -8);

scene.add(new THREE.HemisphereLight(0xb9dcff, 0x080812, 1.8));
const rimLight = new THREE.DirectionalLight(0x69d9ff, 4.5);
rimLight.position.set(-6, 8, 3);
scene.add(rimLight);

const shipRoot = new THREE.Group();
shipRoot.position.set(0, -1.4, 0);
shipRoot.rotation.set(0.06, Math.PI, 0);
shipRoot.scale.setScalar(0.9);
scene.add(shipRoot);

const loader = new GLTFLoader();
loader.load(
  '/models/trace_fighter.glb',
  ({ scene: model }) => {
    model.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    shipRoot.add(model);
    loading.hidden = true;
  },
  undefined,
  () => {
    loading.innerHTML = '<p class="eyebrow">TRACE EFFECT</p><p>機体を読み込めませんでした</p>';
  },
);

const clock = new THREE.Clock();

function render(): void {
  const elapsed = clock.getElapsedTime();
  shipRoot.position.y = -1.4 + Math.sin(elapsed * 1.6) * 0.08;
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}

function resize(): void {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height, false);
}

window.addEventListener('resize', resize);
render();
