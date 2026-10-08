import * as THREE from 'three';
import { calculateShotVelocity, segmentIntersectsSphere } from './aiming';
import { GAME_CONFIG, ITEM_PRESENTATION, type WeaponId } from './config';
import type { Explosions } from './fx/Explosions';
import { lightningPath, writeRibbon } from './fx/Ribbon';
import type { Hazard } from './Hazards';
import type { PlayerShip } from './PlayerShip';
import { GLOW_TEXTURE } from './PlayerShip';
import { buildChain, createSpreadTargets, distanceToSegment, nearestTarget, steerTowards, weaponSpec } from './weapons';

export type HitHandler = (hazard: Hazard, damage: number, point: THREE.Vector3) => void;

export interface WeaponFrame {
  weapon: WeaponId;
  level: number;
  overdrive: boolean;
  firing: boolean;
  aimPoint: THREE.Vector3;
  hazards: readonly Hazard[];
}

interface Bolt {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
}

interface Missile {
  object: THREE.Object3D;
  velocity: THREE.Vector3;
  targetId: number | null;
  age: number;
  damage: number;
}

interface WaveRing {
  group: THREE.Group;
  velocity: THREE.Vector3;
  radius: number;
  maxRadius: number;
  age: number;
  damage: number;
  hit: Set<number>;
}

interface Bolt3D {
  core: THREE.Mesh;
  glow: THREE.Mesh;
  age: number;
  life: number;
}

const BEAM_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec3 viewNormal = normalize(normalMatrix * normal);
  vFacing = abs(dot(viewNormal, normalize(-mvPosition.xyz)));
  gl_Position = projectionMatrix * mvPosition;
}
`;

const BEAM_FRAGMENT = /* glsl */ `
uniform float time;
uniform float intensity;
uniform vec3 color;
uniform float sharpness;
varying vec2 vUv;
varying float vFacing;
void main() {
  float pulse = 0.75 + 0.25 * sin(vUv.y * 160.0 - time * 70.0);
  float fadeEnd = smoothstep(1.0, 0.82, vUv.y) * smoothstep(0.0, 0.01, vUv.y);
  float body = pow(vFacing, sharpness);
  gl_FragColor = vec4(color * body * pulse * fadeEnd * intensity, 1.0);
}
`;

const LIGHTNING_FRAGMENT = /* glsl */ `
uniform vec3 color;
uniform float opacity;
void main() { gl_FragColor = vec4(color * opacity, 1.0); }
`;

const LIGHTNING_VERTEX = /* glsl */ `
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

function hdr(hex: number, gain: number): THREE.Color {
  return new THREE.Color(hex).multiplyScalar(gain);
}

/** 武器ごとの弾・ビーム・波・雷の生成と命中判定。命中の結果処理はゲーム側へ渡す。 */
export class WeaponSystem {
  private readonly bolts: Bolt[] = [];
  private readonly missiles: Missile[] = [];
  private readonly waves: WaveRing[] = [];
  private readonly lightning: Bolt3D[] = [];
  private cooldown = 0;
  private muzzleToggle = 0;
  private laserTick = 0;
  private readonly boltGeometry: THREE.BufferGeometry;
  private readonly boltCoreMaterial: THREE.MeshBasicMaterial;
  private readonly boltOuterMaterial: THREE.MeshBasicMaterial;
  private readonly waveGeometry = new THREE.TorusGeometry(1, 0.03, 6, 96);
  private readonly waveMaterial: THREE.MeshBasicMaterial;
  private readonly waveInnerMaterial: THREE.MeshBasicMaterial;
  private readonly beam = new THREE.Group();
  private readonly beamCore: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private readonly beamOuter: THREE.Mesh<THREE.CylinderGeometry, THREE.ShaderMaterial>;
  private readonly beamMuzzle: THREE.Sprite;
  private beamIntensity = 0;
  private readonly origin = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();
  private readonly forward = new THREE.Vector3(0, 0, -1);
  private readonly modelForward = new THREE.Vector3(0, 0, 1);

  constructor(
    private readonly scene: THREE.Scene,
    private readonly explosions: Explosions,
    private readonly missileTemplate: THREE.Object3D,
    private readonly ship: PlayerShip,
  ) {
    this.boltGeometry = new THREE.CapsuleGeometry(0.07, 1.25, 4, 8).rotateX(Math.PI / 2);
    this.boltCoreMaterial = new THREE.MeshBasicMaterial({ color: hdr(0xe8fdff, 3), toneMapped: true });
    this.boltOuterMaterial = new THREE.MeshBasicMaterial({ color: hdr(0x5fe8ff, 2.4) });
    this.waveMaterial = new THREE.MeshBasicMaterial({ color: hdr(0x4dffa0, 0.9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.waveInnerMaterial = new THREE.MeshBasicMaterial({ color: hdr(0xc8ffe6, 0.45), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

    const beamGeometry = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0).rotateX(-Math.PI / 2);
    const makeBeam = (color: THREE.Color, sharpness: number) =>
      new THREE.Mesh(
        beamGeometry,
        new THREE.ShaderMaterial({
          vertexShader: BEAM_VERTEX,
          fragmentShader: BEAM_FRAGMENT,
          uniforms: { time: { value: 0 }, intensity: { value: 0 }, color: { value: color }, sharpness: { value: sharpness } },
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      );
    this.beamCore = makeBeam(new THREE.Color(2.4, 2.2, 2.6), 2.5);
    this.beamOuter = makeBeam(hdr(0xff3fd2, 1.6), 1.2);
    this.beamMuzzle = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: GLOW_TEXTURE(), color: 0xff8be8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
    );
    this.beam.add(this.beamCore, this.beamOuter, this.beamMuzzle);
    this.beam.visible = false;
    this.scene.add(this.beam);
  }

  update(delta: number, elapsed: number, frame: WeaponFrame, camera: THREE.Camera, onHit: HitHandler): void {
    this.cooldown = Math.max(0, this.cooldown - delta);
    const spec = weaponSpec(frame.weapon, frame.level);
    const interval = spec.interval * (frame.overdrive ? 0.55 : 1);
    if (frame.firing && frame.weapon !== 'laser' && this.cooldown <= 0) {
      this.cooldown = interval;
      this.fire(frame, camera, onHit);
    }
    this.updateLaser(delta, elapsed, frame, onHit);
    this.updateBolts(delta, frame.hazards, onHit);
    this.updateMissiles(delta, frame.hazards, onHit);
    this.updateWaves(delta, frame.hazards, onHit);
    this.updateLightning(delta);
  }

  private muzzle(index: number, target: THREE.Vector3): THREE.Vector3 {
    const muzzles = this.ship.muzzles;
    if (muzzles.length === 0) return target.copy(this.ship.root.position);
    return muzzles[index % muzzles.length].getWorldPosition(target);
  }

  private fire(frame: WeaponFrame, camera: THREE.Camera, onHit: HitHandler): void {
    const spec = weaponSpec(frame.weapon, frame.level);
    const color = new THREE.Color(ITEM_PRESENTATION[frame.weapon].color);
    switch (frame.weapon) {
      case 'spread': {
        const targets = createSpreadTargets(frame.aimPoint, spec.width, spec.count);
        targets.forEach((target, index) => {
          const start = this.muzzle(index === 0 ? 2 : index, new THREE.Vector3());
          this.spawnBolt(start, calculateShotVelocity(start, target, GAME_CONFIG.projectileSpeed * 1.25), spec.damage, index === 0);
        });
        for (let index = 0; index < 2; index += 1) this.explosions.burst(this.muzzle(index, this.scratch), color, 3, 4, 0.5, 0.12);
        break;
      }
      case 'homing': {
        const locked = new Set(this.missiles.map((missile) => missile.targetId).filter((id): id is number => id !== null));
        for (let index = 0; index < spec.count; index += 1) {
          const pods = this.ship.missilePods;
          const pod = pods.length ? pods[(this.muzzleToggle + index) % pods.length] : this.ship.root;
          const start = pod.getWorldPosition(new THREE.Vector3());
          const side = start.x >= this.ship.root.position.x ? 1 : -1;
          const target = nearestTarget(start, frame.hazards, locked, 170) ?? nearestTarget(start, frame.hazards, new Set(), 170);
          if (target) locked.add(target.id);
          this.spawnMissile(start, new THREE.Vector3(side * (6 + Math.random() * 4), 3 + Math.random() * 4, -16), target?.id ?? null, spec.damage);
        }
        this.muzzleToggle += 1;
        break;
      }
      case 'wave': {
        const start = this.muzzle(2, new THREE.Vector3());
        const direction = frame.aimPoint.clone().sub(start).normalize();
        const group = new THREE.Group();
        const outer = new THREE.Mesh(this.waveGeometry, this.waveMaterial.clone());
        const inner = new THREE.Mesh(this.waveGeometry, this.waveInnerMaterial.clone());
        inner.scale.setScalar(0.82);
        group.add(outer, inner);
        group.position.copy(start);
        group.quaternion.setFromUnitVectors(this.forward, direction);
        group.scale.setScalar(0.5);
        this.scene.add(group);
        this.waves.push({ group, velocity: direction.multiplyScalar(50), radius: 0.5, maxRadius: spec.width, age: 0, damage: spec.damage, hit: new Set() });
        this.explosions.burst(start, color, 6, 6, 0.7, 0.2);
        break;
      }
      case 'chain': {
        const start = this.muzzle(2, new THREE.Vector3());
        const chain = buildChain(start, frame.hazards, spec.count, spec.range, 80);
        let from = start;
        if (chain.length === 0) {
          const end = frame.aimPoint.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3, 0));
          this.spawnLightning(start, end, camera, 0.6);
        }
        for (const hazard of chain) {
          const end = hazard.position.clone();
          this.spawnLightning(from, end, camera, 1);
          this.explosions.impact(end, color, hazard.velocity, 0.8);
          onHit(hazard, spec.damage, end);
          from = end;
        }
        this.explosions.burst(start, color, 5, 5, 0.6, 0.15);
        break;
      }
      case 'laser':
        break;
    }
  }

  private spawnBolt(start: THREE.Vector3, velocity: THREE.Vector3, damage: number, center: boolean): void {
    const mesh = new THREE.Mesh(this.boltGeometry, center ? this.boltCoreMaterial : this.boltOuterMaterial);
    mesh.position.copy(start);
    mesh.quaternion.setFromUnitVectors(this.forward, this.scratch.copy(velocity).normalize());
    if (!center) mesh.scale.set(0.8, 0.8, 0.75);
    this.scene.add(mesh);
    this.bolts.push({ mesh, velocity, damage });
  }

  private spawnMissile(start: THREE.Vector3, velocity: THREE.Vector3, targetId: number | null, damage: number): void {
    const object = this.missileTemplate.clone(true);
    object.scale.setScalar(0.5);
    object.position.copy(start);
    this.scene.add(object);
    this.missiles.push({ object, velocity, targetId, age: 0, damage });
  }

  private spawnLightning(start: THREE.Vector3, end: THREE.Vector3, camera: THREE.Camera, strength: number): void {
    const points = lightningPath(start, end, 6, 0.32);
    const material = (color: THREE.Color) =>
      new THREE.ShaderMaterial({
        vertexShader: LIGHTNING_VERTEX,
        fragmentShader: LIGHTNING_FRAGMENT,
        uniforms: { color: { value: color }, opacity: { value: 1 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    const coreGeometry = new THREE.BufferGeometry();
    writeRibbon(coreGeometry, points, 0.06 * strength, camera.position);
    const glowGeometry = new THREE.BufferGeometry();
    writeRibbon(glowGeometry, points, 0.3 * strength, camera.position);
    const core = new THREE.Mesh(coreGeometry, material(new THREE.Color(2.6, 2.5, 2.0)));
    const glow = new THREE.Mesh(glowGeometry, material(hdr(0xffe14a, 0.35)));
    core.frustumCulled = glow.frustumCulled = false;
    this.scene.add(glow, core);
    this.lightning.push({ core, glow, age: 0, life: 0.16 });
  }

  private updateLaser(delta: number, elapsed: number, frame: WeaponFrame, onHit: HitHandler): void {
    const active = frame.weapon === 'laser' && frame.firing;
    this.beamIntensity = THREE.MathUtils.damp(this.beamIntensity, active ? 1 : 0, active ? 30 : 18, delta);
    this.beam.visible = this.beamIntensity > 0.02;
    if (!this.beam.visible) return;
    const spec = weaponSpec('laser', frame.weapon === 'laser' ? frame.level : 1);
    const start = this.muzzle(2, this.origin);
    const direction = this.scratch.copy(frame.aimPoint).sub(start).normalize();
    const end = start.clone().addScaledVector(direction, spec.range);
    this.beam.position.copy(start);
    this.beam.quaternion.setFromUnitVectors(this.forward, direction);
    const flicker = 1 + Math.sin(elapsed * 90) * 0.08;
    this.beamCore.scale.set(spec.width * 0.32 * flicker, spec.width * 0.32 * flicker, spec.range);
    this.beamOuter.scale.set(spec.width * flicker, spec.width * flicker, spec.range);
    for (const mesh of [this.beamCore, this.beamOuter]) {
      mesh.material.uniforms.time.value = elapsed;
      mesh.material.uniforms.intensity.value = this.beamIntensity;
    }
    this.beamMuzzle.scale.setScalar((1.6 + spec.width * 3) * this.beamIntensity * flicker);
    if (!active) return;
    this.laserTick -= delta;
    const emit = this.laserTick <= 0;
    if (emit) this.laserTick = spec.interval;
    const damage = spec.damage * delta * (frame.overdrive ? 1.6 : 1);
    const color = new THREE.Color(ITEM_PRESENTATION.laser.color);
    for (const hazard of frame.hazards) {
      if (hazard.position.z > start.z + 1) continue;
      if (distanceToSegment(hazard.position, start, end) > hazard.radius + spec.width * 0.5) continue;
      const point = hazard.position.clone().addScaledVector(direction, -hazard.radius * 0.8);
      if (emit) this.explosions.impact(point, color, hazard.velocity, 0.6);
      onHit(hazard, damage, point);
    }
  }

  private updateBolts(delta: number, hazards: readonly Hazard[], onHit: HitHandler): void {
    const previous = new THREE.Vector3();
    for (let index = this.bolts.length - 1; index >= 0; index -= 1) {
      const bolt = this.bolts[index];
      previous.copy(bolt.mesh.position);
      bolt.mesh.position.addScaledVector(bolt.velocity, delta);
      const hazard = hazards.find((candidate) => candidate.hp > 0 && segmentIntersectsSphere(previous, bolt.mesh.position, candidate.position, candidate.radius));
      if (hazard) {
        const point = bolt.mesh.position.clone();
        this.explosions.impact(point, new THREE.Color(ITEM_PRESENTATION.spread.color), hazard.velocity, 0.5);
        onHit(hazard, bolt.damage, point);
        this.removeAt(this.bolts, index, (item) => item.mesh.removeFromParent());
        continue;
      }
      if (bolt.mesh.position.z < GAME_CONFIG.spawnZ - 20) this.removeAt(this.bolts, index, (item) => item.mesh.removeFromParent());
    }
  }

  private updateMissiles(delta: number, hazards: readonly Hazard[], onHit: HitHandler): void {
    const flame = new THREE.Color(1.0, 0.55, 0.15);
    const smoke = new THREE.Color(0.32, 0.3, 0.3);
    for (let index = this.missiles.length - 1; index >= 0; index -= 1) {
      const missile = this.missiles[index];
      missile.age += delta;
      let target = missile.targetId === null ? undefined : hazards.find((hazard) => hazard.id === missile.targetId && hazard.hp > 0);
      if (!target && missile.age > 0.1) {
        target = nearestTarget(missile.object.position, hazards, new Set(), 140) ?? undefined;
        missile.targetId = target?.id ?? null;
      }
      const speed = Math.min(72, missile.velocity.length() + 95 * delta);
      missile.velocity.setLength(speed);
      if (target && missile.age > 0.12) {
        const turnRate = 3 + missile.age * 6;
        missile.velocity.copy(steerTowards(missile.velocity, missile.object.position, target.position, turnRate, delta));
      } else if (missile.age > 0.35) {
        missile.velocity.copy(steerTowards(missile.velocity, missile.object.position, missile.object.position.clone().add(this.forward), 2, delta));
      }
      missile.object.position.addScaledVector(missile.velocity, delta);
      missile.object.quaternion.setFromUnitVectors(this.modelForward, this.scratch.copy(missile.velocity).normalize());
      const tail = missile.object.position.clone().addScaledVector(this.scratch, -0.5);
      this.explosions.glow.spawn({ position: tail, velocity: new THREE.Vector3(), life: 0.18, size: 0.55, sizeEnd: 0.1, color: flame, drag: 0 });
      if (Math.random() < 0.7) {
        this.explosions.smoke.spawn({
          position: tail,
          velocity: new THREE.Vector3((Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.6, 4),
          life: 0.9,
          size: 0.3,
          sizeEnd: 1.4,
          color: smoke,
          alpha: 0.35,
          drag: 1,
        });
      }
      const hit = hazards.find((hazard) => hazard.hp > 0 && hazard.position.distanceTo(missile.object.position) < hazard.radius + 0.45);
      if (hit) {
        const point = missile.object.position.clone();
        this.explosions.impact(point, flame, hit.velocity, 1.2);
        this.explosions.burst(point, flame, 18, 9, 0.7, 0.4);
        onHit(hit, missile.damage, point);
        this.removeAt(this.missiles, index, (item) => item.object.removeFromParent());
        continue;
      }
      if (missile.age > 3.6 || missile.object.position.z < GAME_CONFIG.spawnZ - 30) {
        this.explosions.burst(missile.object.position, flame, 8, 5, 0.5, 0.3);
        this.removeAt(this.missiles, index, (item) => item.object.removeFromParent());
      }
    }
  }

  private updateWaves(delta: number, hazards: readonly Hazard[], onHit: HitHandler): void {
    const lateral = new THREE.Vector3();
    const color = new THREE.Color(ITEM_PRESENTATION.wave.color);
    for (let index = this.waves.length - 1; index >= 0; index -= 1) {
      const wave = this.waves[index];
      wave.age += delta;
      wave.radius = THREE.MathUtils.lerp(0.5, wave.maxRadius, 1 - Math.exp(-wave.age * 5));
      wave.group.position.addScaledVector(wave.velocity, delta);
      wave.group.scale.setScalar(wave.radius);
      wave.group.rotation.z += delta * 3;
      const fade = Math.min(1, wave.age * 8) * Math.max(0, 1 - Math.max(0, wave.age - 1.2) / 1.0);
      for (const child of wave.group.children) ((child as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = fade;
      for (const hazard of hazards) {
        if (hazard.hp <= 0 || wave.hit.has(hazard.id)) continue;
        if (Math.abs(hazard.position.z - wave.group.position.z) > hazard.radius + 1) continue;
        lateral.set(hazard.position.x - wave.group.position.x, hazard.position.y - wave.group.position.y, 0);
        if (lateral.length() > wave.radius + hazard.radius * 0.6) continue;
        wave.hit.add(hazard.id);
        const point = hazard.position.clone();
        this.explosions.impact(point, color, hazard.velocity, 0.9);
        onHit(hazard, wave.damage, point);
      }
      if (wave.age > 2.2) {
        this.removeAt(this.waves, index, (item) => {
          item.group.removeFromParent();
          item.group.children.forEach((child) => ((child as THREE.Mesh).material as THREE.Material).dispose());
        });
      }
    }
  }

  private updateLightning(delta: number): void {
    for (let index = this.lightning.length - 1; index >= 0; index -= 1) {
      const bolt = this.lightning[index];
      bolt.age += delta;
      const fade = Math.max(0, 1 - bolt.age / bolt.life);
      const flicker = Math.random() < 0.3 ? 0.4 : 1;
      (bolt.core.material as THREE.ShaderMaterial).uniforms.opacity.value = fade * flicker;
      (bolt.glow.material as THREE.ShaderMaterial).uniforms.opacity.value = fade * flicker;
      if (bolt.age >= bolt.life) {
        this.removeAt(this.lightning, index, (item) => {
          for (const mesh of [item.core, item.glow]) {
            mesh.removeFromParent();
            mesh.geometry.dispose();
            (mesh.material as THREE.Material).dispose();
          }
        });
      }
    }
  }

  private removeAt<T>(list: T[], index: number, cleanup: (item: T) => void): void {
    const [item] = list.splice(index, 1);
    if (item) cleanup(item);
  }

  clear(): void {
    while (this.bolts.length) this.removeAt(this.bolts, 0, (item) => item.mesh.removeFromParent());
    while (this.missiles.length) this.removeAt(this.missiles, 0, (item) => item.object.removeFromParent());
    this.updateWaves(10, [], () => undefined);
    this.updateLightning(10);
    this.beamIntensity = 0;
    this.beam.visible = false;
    this.cooldown = 0;
  }
}
