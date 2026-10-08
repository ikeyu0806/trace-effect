import * as THREE from 'three';
import { boundingRadius, cloneWithMaterials, type GameAssets } from './assets';
import { HAZARD_STATS, type HazardKind } from './config';
import type { ExplosionStyle } from './fx/Explosions';
import { GLOW_TEXTURE } from './PlayerShip';

interface FlashMaterial {
  material: THREE.MeshStandardMaterial;
  baseEmissive: THREE.Color;
  baseIntensity: number;
}

export interface Hazard {
  id: number;
  kind: HazardKind;
  object: THREE.Object3D;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  hp: number;
  maxHp: number;
  radius: number;
  flash: number;
  age: number;
  style: ExplosionStyle;
  materials: FlashMaterial[];
  marker: THREE.Sprite | null;
}

const FLASH_COLOR = new THREE.Color(1.0, 0.75, 0.55);

/** 隕石、結晶隕石、デブリの生成・移動・被弾発光・破棄を扱う。 */
export class HazardField {
  readonly hazards: Hazard[] = [];
  private nextId = 1;
  private readonly templateRadius = new Map<THREE.Object3D, number>();

  constructor(private readonly assets: GameAssets, private readonly scene: THREE.Scene) {
    for (const template of [...assets.asteroids, assets.crystalAsteroid, ...assets.debris]) {
      this.templateRadius.set(template, boundingRadius(template));
    }
  }

  spawn(kind: HazardKind, position: THREE.Vector3, velocity: THREE.Vector3): Hazard {
    const stats = HAZARD_STATS[kind];
    const template =
      kind === 'crystal'
        ? this.assets.crystalAsteroid
        : kind === 'debris'
          ? this.assets.debris[Math.floor(Math.random() * this.assets.debris.length)]
          : this.assets.asteroids[Math.floor(Math.random() * this.assets.asteroids.length)];
    const body = cloneWithMaterials(template);
    const scale = (stats.radius / (this.templateRadius.get(template) ?? 1)) * (kind === 'debris' ? 1.25 : 1.08);
    body.scale.setScalar(scale);
    body.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
    if (kind.startsWith('asteroid')) body.scale.multiply(new THREE.Vector3(1, 0.82 + Math.random() * 0.3, 0.9 + Math.random() * 0.25));
    const object = new THREE.Group();
    object.add(body);
    object.position.copy(position);

    const materials: FlashMaterial[] = [];
    body.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.MeshStandardMaterial;
      materials.push({ material, baseEmissive: material.emissive.clone(), baseIntensity: material.emissiveIntensity });
    });

    let marker: THREE.Sprite | null = null;
    if (kind === 'crystal') {
      marker = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: GLOW_TEXTURE(),
          color: 0x47c8ff,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0.5,
        }),
      );
      marker.scale.setScalar(stats.radius * 3.4);
      object.add(marker);
    }

    const spinScale = kind === 'debris' ? 0.9 : kind === 'asteroidSmall' ? 1.6 : 0.7;
    const hazard: Hazard = {
      id: this.nextId++,
      kind,
      object,
      position: object.position,
      velocity: velocity.clone(),
      spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(2 * spinScale),
      hp: stats.hp,
      maxHp: stats.hp,
      radius: stats.radius,
      flash: 0,
      age: 0,
      style: kind === 'crystal' ? 'crystal' : kind === 'debris' ? 'metal' : 'rock',
      materials,
      marker,
    };
    this.scene.add(object);
    this.hazards.push(hazard);
    return hazard;
  }

  /** 撃破されたらtrue。 */
  damage(hazard: Hazard, amount: number): boolean {
    if (hazard.hp <= 0) return false;
    hazard.hp -= amount;
    hazard.flash = Math.min(1, hazard.flash + 0.6);
    return hazard.hp <= 0;
  }

  update(delta: number, elapsed: number): void {
    for (const hazard of this.hazards) {
      hazard.age += delta;
      hazard.position.addScaledVector(hazard.velocity, delta);
      const body = hazard.object.children[0];
      body.rotation.x += hazard.spin.x * delta;
      body.rotation.y += hazard.spin.y * delta;
      body.rotation.z += hazard.spin.z * delta;
      // 遠方で急に現れないよう、出現直後は拡大しながらフェードインさせる。
      hazard.object.scale.setScalar(Math.min(1, 0.3 + hazard.age * 1.4));
      hazard.flash = Math.max(0, hazard.flash - delta * 10);
      for (const entry of hazard.materials) {
        entry.material.emissive.copy(entry.baseEmissive).multiplyScalar(entry.baseIntensity).lerp(FLASH_COLOR, hazard.flash * 0.35);
        entry.material.emissiveIntensity = hazard.flash > 0 ? 1 + hazard.flash * 0.6 : 1;
        if (hazard.flash === 0) {
          entry.material.emissive.copy(entry.baseEmissive);
          entry.material.emissiveIntensity = entry.baseIntensity;
        }
      }
      if (hazard.marker) hazard.marker.material.opacity = 0.35 + Math.sin(elapsed * 6 + hazard.id) * 0.15;
    }
  }

  remove(hazard: Hazard): void {
    const index = this.hazards.indexOf(hazard);
    if (index >= 0) this.hazards.splice(index, 1);
    hazard.object.removeFromParent();
    hazard.object.traverse((child) => {
      if (child instanceof THREE.Mesh || child instanceof THREE.Sprite) {
        (Array.isArray(child.material) ? child.material : [child.material]).forEach((material) => material.dispose());
      }
    });
  }

  clear(): void {
    while (this.hazards.length) this.remove(this.hazards[this.hazards.length - 1]);
  }
}
