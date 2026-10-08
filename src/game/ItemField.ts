import * as THREE from 'three';
import { cloneWithMaterials } from './assets';
import { GAME_CONFIG, ITEM_PRESENTATION, type ItemKind } from './config';
import { GLOW_TEXTURE } from './PlayerShip';

export interface ItemPickup {
  kind: ItemKind;
  object: THREE.Object3D;
  velocity: THREE.Vector3;
  age: number;
  tag: HTMLElement;
}

/** 取得アイテムのcapsule。発光部を種類の色に染め、画面上に記号タグを重ねる。 */
export class ItemField {
  readonly items: ItemPickup[] = [];
  private readonly projected = new THREE.Vector3();

  constructor(
    private readonly template: THREE.Object3D,
    private readonly scene: THREE.Scene,
    private readonly tagLayer: HTMLElement,
  ) {}

  spawn(kind: ItemKind, position: THREE.Vector3, drift: THREE.Vector3): void {
    const presentation = ITEM_PRESENTATION[kind];
    const color = new THREE.Color(presentation.color);
    const capsule = cloneWithMaterials(this.template);
    capsule.scale.setScalar(1.45);
    capsule.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.MeshStandardMaterial;
      if (/core/i.test(material.name)) {
        material.color.copy(color);
        material.emissive.copy(color);
        material.emissiveIntensity = 3.2;
      } else if (/accent/i.test(material.name)) {
        material.emissive.copy(color);
        material.emissiveIntensity = 1.2;
      }
    });
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: GLOW_TEXTURE(), color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.7 }),
    );
    halo.scale.setScalar(4.2);
    const object = new THREE.Group();
    object.add(capsule, halo);
    object.position.copy(position);
    this.scene.add(object);

    const tag = document.createElement('span');
    tag.className = 'item-tag';
    tag.textContent = presentation.symbol;
    tag.style.setProperty('--item-color', `#${color.getHexString()}`);
    tag.title = presentation.label;
    tag.hidden = true;
    this.tagLayer.append(tag);
    this.items.push({ kind, object, velocity: drift.clone().multiplyScalar(0.55), age: 0, tag });
  }

  /** shipに触れたアイテムを返し、場から取り除く。 */
  update(delta: number, shipPosition: THREE.Vector3, camera: THREE.Camera, width: number, height: number): ItemKind[] {
    const collected: ItemKind[] = [];
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      item.age += delta;
      const offset = this.projected.subVectors(shipPosition, item.object.position);
      const distance = offset.length();
      if (distance < GAME_CONFIG.itemMagnetRadius && item.age > 0.4) {
        // 近づくと吸い寄せる。近いほど強く引く。
        const pull = (1 - distance / GAME_CONFIG.itemMagnetRadius) * 70;
        item.velocity.addScaledVector(offset.normalize(), pull * delta);
      }
      item.object.position.addScaledVector(item.velocity, delta);
      item.object.rotation.y += delta * 2.2;
      item.object.children[0].rotation.z = Math.sin(item.age * 2) * 0.3;
      item.object.children[0].position.y = Math.sin(item.age * 3) * 0.15;
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
        item.tag.style.transform = `translate(${x.toFixed(1)}px, ${(y - 34).toFixed(1)}px) translate(-50%, -50%)`;
      }
    }
    return collected;
  }

  private removeAt(index: number): void {
    const [item] = this.items.splice(index, 1);
    if (!item) return;
    item.object.removeFromParent();
    item.tag.remove();
    item.object.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Sprite) {
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => material.dispose());
      }
    });
  }

  clear(): void {
    while (this.items.length) this.removeAt(this.items.length - 1);
  }
}
