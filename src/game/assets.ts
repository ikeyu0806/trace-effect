import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ITEM_KINDS, type ItemKind } from './config';

export interface GameAssets {
  ship: THREE.Object3D;
  asteroids: THREE.Object3D[];
  crystalAsteroid: THREE.Object3D;
  debris: THREE.Object3D[];
  itemEmblems: Record<ItemKind, THREE.Object3D>;
  missile: THREE.Object3D;
}

/** アイテム種別ごとのemblem model（blender-works trace_pickups）。 */
const EMBLEM_NODES: Record<ItemKind, string> = {
  spread: 'EmblemSpread',
  homing: 'EmblemHoming',
  laser: 'EmblemLaser',
  wave: 'EmblemWave',
  chain: 'EmblemThunder',
  shield: 'EmblemShield',
  life: 'EmblemLife',
  nova: 'EmblemNova',
  overdrive: 'EmblemOverdrive',
};

/** GLTFLoaderはnode名から「.」などを除くため、比較は英数字だけで行う。 */
export function normalizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

export function findNode(root: THREE.Object3D, blenderName: string): THREE.Object3D | undefined {
  const wanted = normalizeName(blenderName);
  let found: THREE.Object3D | undefined;
  root.traverse((child) => {
    if (!found && normalizeName(child.name) === wanted) found = child;
  });
  return found;
}

function requireNode(root: THREE.Object3D, blenderName: string): THREE.Object3D {
  const node = findNode(root, blenderName);
  if (!node) throw new Error(`model node not found: ${blenderName}`);
  return node;
}

/** groupを親から外し、preview用の配置を消して原点中心のtemplateにする。 */
function detachTemplate(node: THREE.Object3D): THREE.Object3D {
  node.removeFromParent();
  node.position.set(0, 0, 0);
  node.updateMatrixWorld(true);
  return node;
}

function prepareMaterials(root: THREE.Object3D, environmentIntensity: number): void {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.envMapIntensity = environmentIntensity;
        // Blenderの発光強度はbloomに対して強すぎるため、ゲームの露出に合わせて抑える。
        if (material.emissiveIntensity > 1) material.emissiveIntensity = Math.min(material.emissiveIntensity, 4);
      }
    }
  });
}

export async function loadGameAssets(onProgress: (ratio: number) => void): Promise<GameAssets> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const files = ['trace_fighter_mk2', 'asteroid_set', 'space_debris_set', 'trace_pickups'] as const;
  let loaded = 0;
  const [shipGltf, asteroidGltf, debrisGltf, pickupGltf] = await Promise.all(
    files.map(async (file) => {
      const gltf = await loader.loadAsync(`/models/${file}.glb`);
      loaded += 1;
      onProgress(loaded / files.length);
      return gltf;
    }),
  );

  const ship = shipGltf.scene;
  prepareMaterials(ship, 1.1);
  prepareMaterials(asteroidGltf.scene, 0.6);
  prepareMaterials(debrisGltf.scene, 1.2);
  prepareMaterials(pickupGltf.scene, 1);

  const asteroids = ['A', 'B', 'C', 'D'].map((variant) => detachTemplate(requireNode(asteroidGltf.scene, `Asteroid.${variant}`)));
  const crystalAsteroid = detachTemplate(requireNode(asteroidGltf.scene, 'Asteroid.Crystal'));
  const debris = ['Satellite', 'FuelTank', 'Truss', 'HullPlate', 'SolarFragment', 'RocketStage'].map((piece) =>
    detachTemplate(requireNode(debrisGltf.scene, `SpaceDebris.${piece}`)),
  );
  const itemEmblems = Object.fromEntries(
    ITEM_KINDS.map((kind) => [kind, detachTemplate(requireNode(pickupGltf.scene, `Pickups.${EMBLEM_NODES[kind]}`))]),
  ) as Record<ItemKind, THREE.Object3D>;
  const missile = detachTemplate(requireNode(pickupGltf.scene, 'Pickups.HomingMissile'));
  return { ship, asteroids, crystalAsteroid, debris, itemEmblems, missile };
}

/** templateを複製し、点滅などで個別に変えるためMaterialも複製する。 */
export function cloneWithMaterials(template: THREE.Object3D): THREE.Object3D {
  const clone = template.clone(true);
  clone.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.material = Array.isArray(child.material) ? child.material.map((material) => material.clone()) : child.material.clone();
    }
  });
  return clone;
}

/** templateの外接球半径。ゲーム上の当たり半径へ拡大率を合わせるのに使う。 */
export function boundingRadius(template: THREE.Object3D): number {
  const box = new THREE.Box3().setFromObject(template);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  return sphere.radius;
}
