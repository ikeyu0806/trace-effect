import * as THREE from 'three';
import { boundingRadius, cloneWithMaterials, type GameAssets } from './assets';
import { HAZARD_STATS, type HazardKind } from './config';
import type { ExplosionStyle } from './fx/Explosions';
import { maxPips, remainingPips } from './integrity';
import { GLOW_TEXTURE } from './PlayerShip';

interface FlashMaterial {
  material: THREE.MeshStandardMaterial;
  baseColor: THREE.Color;
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
  pips: THREE.Sprite[];
}

const FLASH_COLOR = new THREE.Color(1.0, 0.75, 0.55);
const PIP_LIVE = new THREE.Color(1.0, 0.86, 0.45);
const PIP_CRITICAL = new THREE.Color(1.0, 0.32, 0.22);
const PIP_GONE = new THREE.Color(0.18, 0.16, 0.14);
const DAMAGE_COLOR = new THREE.Color(0.28, 0.16, 0.1);

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
      materials.push({
        material,
        baseColor: material.color.clone(),
        baseEmissive: material.emissive.clone(),
        baseIntensity: material.emissiveIntensity,
      });
    });
    const pips = this.createPips(stats.hp, stats.radius);
    for (const pip of pips) object.add(pip);

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
      pips,
    };
    this.scene.add(object);
    this.hazards.push(hazard);
    this.refreshPips(hazard);
    return hazard;
  }

  private createPips(maxHp: number, radius: number): THREE.Sprite[] {
    const count = maxPips(maxHp);
    const pips: THREE.Sprite[] = [];
    const spacing = Math.min(0.38, (radius * 1.7) / Math.max(1, count - 1));
    const y = radius + 0.55;
    const map = GLOW_TEXTURE();
    for (let index = 0; index < count; index += 1) {
      const pip = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map,
          color: PIP_LIVE,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          transparent: true,
          opacity: 0.95,
        }),
      );
      pip.position.set((index - (count - 1) * 0.5) * spacing, y, 0);
      pip.scale.setScalar(0.42);
      pips.push(pip);
    }
    return pips;
  }

  private refreshPips(hazard: Hazard): void {
    const live = remainingPips(hazard.hp);
    const critical = live <= 2 && hazard.maxHp > 2;
    for (let index = 0; index < hazard.pips.length; index += 1) {
      const pip = hazard.pips[index];
      const filled = index < live;
      pip.material.color.copy(filled ? (critical ? PIP_CRITICAL : PIP_LIVE) : PIP_GONE);
      pip.material.opacity = filled ? (critical ? 1 : 0.95) : 0.18;
      pip.material.blending = filled ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
  }

  /** 撃破されたらtrue。 */
  damage(hazard: Hazard, amount: number): boolean {
    if (hazard.hp <= 0) return false;
    hazard.hp -= amount;
    hazard.flash = Math.min(1, hazard.flash + 0.6);
    this.refreshPips(hazard);
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
      const broken = 1 - Math.max(0, hazard.hp) / hazard.maxHp;
      for (const entry of hazard.materials) {
        entry.material.color.copy(entry.baseColor).lerp(DAMAGE_COLOR, broken * 0.72);
        entry.material.emissive.copy(entry.baseEmissive).multiplyScalar(entry.baseIntensity).lerp(FLASH_COLOR, Math.max(hazard.flash * 0.35, broken * 0.22));
        entry.material.emissiveIntensity = hazard.flash > 0 ? 1 + hazard.flash * 0.6 : entry.baseIntensity + broken * 0.45;
        if (hazard.flash === 0 && broken === 0) {
          entry.material.emissive.copy(entry.baseEmissive);
          entry.material.emissiveIntensity = entry.baseIntensity;
        }
      }
      const near = THREE.MathUtils.clamp((hazard.position.z + 110) / 90, 0.15, 1);
      for (const pip of hazard.pips) pip.scale.setScalar(0.34 + near * 0.12);
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
