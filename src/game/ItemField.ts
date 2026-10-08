import * as THREE from 'three';
import { cloneWithMaterials } from './assets';
import { GAME_CONFIG, ITEM_PRESENTATION, type ItemKind } from './config';
import { GLOW_TEXTURE } from './PlayerShip';

export interface ItemPickup {
  kind: ItemKind;
  object: THREE.Object3D;
  emblem: THREE.Object3D;
  ring: THREE.Object3D;
  velocity: THREE.Vector3;
  age: number;
  tag: HTMLElement;
}

const EMBLEM_SCALE = 1.7;

/**
 * 単体で流れてくる取得アイテム。効果を記号の形で示すemblemを正面に向け、
 * 回る光のringと名前タグで、灰色の隕石やデブリと一目で区別できるようにする。
 */
export class ItemField {
  readonly items: ItemPickup[] = [];
  private readonly projected = new THREE.Vector3();
  private readonly projectedEdge = new THREE.Vector3();
  private readonly ringGeometry = new THREE.RingGeometry(1.55, 1.68, 6, 1);
  private readonly tickGeometry = new THREE.RingGeometry(1.8, 2.0, 24, 1, 0, Math.PI * 0.32);

  constructor(
    private readonly templates: Record<ItemKind, THREE.Object3D>,
    private readonly scene: THREE.Scene,
    private readonly tagLayer: HTMLElement,
  ) {}

  spawn(kind: ItemKind, position: THREE.Vector3, velocity: THREE.Vector3): void {
    const presentation = ITEM_PRESENTATION[kind];
    const color = new THREE.Color(presentation.color);
    const emblem = cloneWithMaterials(this.templates[kind]);
    emblem.scale.setScalar(EMBLEM_SCALE);
    emblem.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.MeshStandardMaterial;
      if (/core/i.test(material.name)) {
        material.color.copy(color);
        material.emissive.copy(color);
        material.emissiveIntensity = 2.2;
      } else if (/trim/i.test(material.name)) {
        material.emissive.copy(color);
        material.emissiveIntensity = 0.25;
      } else if (/frame/i.test(material.name)) {
        // 記号との明暗差を保つため、台座は暗く沈める。
        material.color.multiplyScalar(0.35);
        material.envMapIntensity = 0.25;
      }
    });

    const ringMaterial = new THREE.MeshBasicMaterial({
      color: color.clone().multiplyScalar(1.2),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Group();
    const hex = new THREE.Mesh(this.ringGeometry, ringMaterial);
    hex.rotation.z = Math.PI / 6;
    ring.add(hex);
    for (let index = 0; index < 3; index += 1) {
      const tick = new THREE.Mesh(this.tickGeometry, ringMaterial);
      tick.rotation.z = (index / 3) * Math.PI * 2;
      ring.add(tick);
    }

    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: GLOW_TEXTURE(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.22 }),
    );
    halo.scale.setScalar(5);
    const object = new THREE.Group();
    object.add(halo, emblem, ring);
    object.position.copy(position);
    object.scale.setScalar(0.3);
    this.scene.add(object);

    const tag = document.createElement('span');
    tag.className = 'item-tag';
    tag.textContent = presentation.label;
    tag.style.setProperty('--item-color', `#${color.getHexString()}`);
    tag.hidden = true;
    this.tagLayer.append(tag);
    this.items.push({ kind, object, emblem, ring, velocity: velocity.clone(), age: 0, tag });
  }

  /** shipに触れたアイテムを返し、場から取り除く。 */
  update(delta: number, shipPosition: THREE.Vector3, camera: THREE.Camera, width: number, height: number): ItemKind[] {
    const collected: ItemKind[] = [];
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      item.age += delta;
      const offset = this.projected.subVectors(shipPosition, item.object.position);
      const distance = offset.length();
      if (distance < GAME_CONFIG.itemMagnetRadius) {
        // 近づくと吸い寄せる。近いほど強く引く。
        const pull = (1 - distance / GAME_CONFIG.itemMagnetRadius) * 70;
        item.velocity.addScaledVector(offset.normalize(), pull * delta);
      }
      item.object.position.addScaledVector(item.velocity, delta);
      item.object.scale.setScalar(Math.min(1, 0.3 + item.age * 1.2));
      // 記号が読めるよう正面を保ったまま、左右に揺らして立体感を出す。
      item.emblem.rotation.y = Math.sin(item.age * 1.8) * 0.45;
      item.emblem.position.y = Math.sin(item.age * 3) * 0.15;
      item.ring.rotation.z -= delta * 1.6;
      item.ring.scale.setScalar(1 + Math.sin(item.age * 5) * 0.05);
      if (item.object.position.distanceTo(shipPosition) < GAME_CONFIG.itemPickupRadius) {
        collected.push(item.kind);
        this.removeAt(index);
        continue;
      }
      if (item.object.position.z > 14) {
        this.removeAt(index);
        continue;
      }
      this.projected.copy(item.object.position).project(camera);
      const visible = this.projected.z < 1;
      item.tag.hidden = !visible;
      if (visible) {
        const x = (this.projected.x * 0.5 + 0.5) * width;
        const y = (-this.projected.y * 0.5 + 0.5) * height;
        this.projectedEdge.copy(item.object.position).y -= 2.1 * item.object.scale.y;
        this.projectedEdge.project(camera);
        const gap = Math.max(14, (this.projected.y - this.projectedEdge.y) * 0.5 * height + 10);
        item.tag.style.transform = `translate(${x.toFixed(1)}px, ${(y + gap).toFixed(1)}px) translate(-50%, -50%)`;
      }
    }
    return collected;
  }

  private removeAt(index: number): void {
    const [item] = this.items.splice(index, 1);
    if (!item) return;
    item.object.removeFromParent();
    item.tag.remove();
    const materials = new Set<THREE.Material>();
    item.object.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Sprite) {
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => materials.add(material));
      }
    });
    materials.forEach((material) => material.dispose());
  }

  clear(): void {
    while (this.items.length) this.removeAt(this.items.length - 1);
  }
}
