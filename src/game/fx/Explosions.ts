import * as THREE from 'three';
import { NOISE_GLSL } from '../render/glsl';
import { ParticleSystem, SparkSystem } from './Particles';

export type ExplosionStyle = 'rock' | 'metal' | 'crystal' | 'ship';

const BILLBOARD_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FIREBALL_FRAGMENT = /* glsl */ `
uniform float progress;
uniform float seed;
uniform vec3 hot;
uniform vec3 cool;
varying vec2 vUv;
${NOISE_GLSL}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float turbulence = fbm(vec3(p * 2.6, seed + progress * 1.8), 5);
  float radius = 0.35 + progress * 0.55;
  float body = smoothstep(radius, radius * 0.25, r + (turbulence - 0.5) * 0.55);
  float heat = smoothstep(0.0, 1.0, body * (1.0 - progress * 0.9) + turbulence * 0.25);
  vec3 color = mix(cool, hot, heat) * (2.4 - progress * 2.0);
  float alpha = body * (1.0 - smoothstep(0.55, 1.0, progress));
  gl_FragColor = vec4(color * alpha, 1.0);
}
`;

const SHOCKWAVE_FRAGMENT = /* glsl */ `
uniform float progress;
uniform vec3 tint;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float ring = smoothstep(0.1, 0.0, abs(r - progress * 0.95)) * (1.0 - progress);
  float fill = smoothstep(progress, 0.0, r) * (1.0 - progress) * 0.12;
  gl_FragColor = vec4(tint * (ring * 1.6 + fill), 1.0);
}
`;

interface BillboardEffect {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  age: number;
  life: number;
  startScale: number;
  endScale: number;
  velocity: THREE.Vector3;
}

interface Chunk {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  spin: THREE.Vector3;
  age: number;
  life: number;
  scale: number;
}

interface FlashLight {
  light: THREE.PointLight;
  age: number;
  life: number;
  peak: number;
}

const STYLE_COLORS: Record<ExplosionStyle, { hot: THREE.Color; cool: THREE.Color; spark: THREE.Color; ring: THREE.Color }> = {
  rock: { hot: new THREE.Color(1.0, 0.82, 0.5), cool: new THREE.Color(0.55, 0.12, 0.03), spark: new THREE.Color(1.0, 0.6, 0.25), ring: new THREE.Color(1.0, 0.6, 0.3) },
  metal: { hot: new THREE.Color(1.0, 0.9, 0.7), cool: new THREE.Color(0.5, 0.15, 0.05), spark: new THREE.Color(1.0, 0.85, 0.5), ring: new THREE.Color(0.6, 0.8, 1.0) },
  crystal: { hot: new THREE.Color(0.75, 1.0, 1.0), cool: new THREE.Color(0.05, 0.3, 0.7), spark: new THREE.Color(0.4, 0.9, 1.0), ring: new THREE.Color(0.3, 0.85, 1.0) },
  ship: { hot: new THREE.Color(1.0, 0.95, 0.85), cool: new THREE.Color(0.6, 0.15, 0.08), spark: new THREE.Color(1.0, 0.7, 0.35), ring: new THREE.Color(1.0, 0.4, 0.35) },
};

const CHUNK_TRAIL = new THREE.Color(1.0, 0.5, 0.15);
const CHUNK_TRAIL_END = new THREE.Color(0.3, 0.05, 0.0);

/** 火球、衝撃波、火花、残り火、煙、破片、閃光をまとめて管理する。 */
export class Explosions {
  readonly group = new THREE.Group();
  readonly glow = new ParticleSystem(5000, 'glow');
  readonly smoke = new ParticleSystem(900, 'smoke');
  readonly sparks = new SparkSystem(1400);
  private readonly fireballs: BillboardEffect[] = [];
  private readonly shockwaves: BillboardEffect[] = [];
  private readonly chunks: Chunk[] = [];
  private readonly flashes: FlashLight[] = [];
  private fireballCursor = 0;
  private shockwaveCursor = 0;
  private chunkCursor = 0;
  private flashCursor = 0;
  private readonly scratch = new THREE.Vector3();
  private readonly scratchColor = new THREE.Color();

  constructor() {
    this.group.add(this.glow.points, this.smoke.points, this.sparks.lines);
    const plane = new THREE.PlaneGeometry(1, 1);
    for (let index = 0; index < 28; index += 1) {
      const fireball = new THREE.Mesh(
        plane,
        new THREE.ShaderMaterial({
          vertexShader: BILLBOARD_VERTEX,
          fragmentShader: FIREBALL_FRAGMENT,
          uniforms: { progress: { value: 1 }, seed: { value: index * 3.7 }, hot: { value: new THREE.Color() }, cool: { value: new THREE.Color() } },
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      fireball.visible = false;
      fireball.renderOrder = 7;
      this.group.add(fireball);
      this.fireballs.push({ mesh: fireball, age: 1, life: 1, startScale: 1, endScale: 1, velocity: new THREE.Vector3() });
    }
    for (let index = 0; index < 12; index += 1) {
      const ring = new THREE.Mesh(
        plane,
        new THREE.ShaderMaterial({
          vertexShader: BILLBOARD_VERTEX,
          fragmentShader: SHOCKWAVE_FRAGMENT,
          uniforms: { progress: { value: 1 }, tint: { value: new THREE.Color() } },
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      ring.visible = false;
      ring.renderOrder = 7;
      this.group.add(ring);
      this.shockwaves.push({ mesh: ring, age: 1, life: 1, startScale: 1, endScale: 1, velocity: new THREE.Vector3() });
    }
    const rockGeometry = new THREE.IcosahedronGeometry(0.5, 0);
    const shardGeometry = new THREE.BoxGeometry(0.9, 0.08, 0.5);
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x6f6158, roughness: 0.9, flatShading: true, emissive: 0x3a1204 });
    const metalMaterial = new THREE.MeshStandardMaterial({ color: 0xc4c8cc, roughness: 0.3, metalness: 0.85 });
    const crystalMaterial = new THREE.MeshStandardMaterial({ color: 0x40c8ff, emissive: 0x2aa8ff, emissiveIntensity: 2, roughness: 0.2 });
    for (let index = 0; index < 90; index += 1) {
      const style = index % 3;
      const mesh = new THREE.Mesh(style === 0 ? rockGeometry : shardGeometry, style === 0 ? rockMaterial : style === 1 ? metalMaterial : crystalMaterial);
      mesh.visible = false;
      mesh.userData.style = style === 0 ? 'rock' : style === 1 ? 'metal' : 'crystal';
      this.group.add(mesh);
      this.chunks.push({ mesh, velocity: new THREE.Vector3(), spin: new THREE.Vector3(), age: 1, life: 1, scale: 1 });
    }
    for (let index = 0; index < 4; index += 1) {
      const light = new THREE.PointLight(0xffaa66, 0, 40, 1.6);
      this.group.add(light);
      this.flashes.push({ light, age: 1, life: 1, peak: 0 });
    }
  }

  setViewport(height: number, fov: number): void {
    this.glow.setPixelScale(height, fov);
    this.smoke.setPixelScale(height, fov);
  }

  /** 撃破時の大爆発。sizeは飛来物の半径、driftは飛来物の移動速度（爆風も流れる）。 */
  explode(position: THREE.Vector3, size: number, style: ExplosionStyle, drift: THREE.Vector3): void {
    const colors = STYLE_COLORS[style];
    const fireballCount = style === 'ship' ? 5 : 3;
    for (let index = 0; index < fireballCount; index += 1) {
      const offset = this.scratch.randomDirection().multiplyScalar(size * 0.45 * Math.random());
      this.spawnFireball(position.clone().add(offset), size * (2.4 + Math.random() * 1.6), 0.55 + Math.random() * 0.35, colors, drift, index * 0.05);
    }
    this.spawnShockwave(position, size * 1.2, size * 7, 0.55, colors.ring, drift);
    if (size > 1.6 || style === 'ship') this.spawnShockwave(position, size, size * 12, 0.9, colors.ring.clone().multiplyScalar(0.5), drift);
    const sparkCount = Math.round(40 + size * 26);
    for (let index = 0; index < sparkCount; index += 1) {
      const direction = this.scratch.randomDirection();
      const speed = 12 + Math.random() * 34 * Math.min(2, size);
      this.sparks.spawn(position, direction.clone().multiplyScalar(speed).add(drift), colors.spark, 0.35 + Math.random() * 0.45);
    }
    const emberCount = Math.round(30 + size * 22);
    for (let index = 0; index < emberCount; index += 1) {
      const direction = this.scratch.randomDirection();
      this.glow.spawn({
        position: position.clone().addScaledVector(direction, Math.random() * size * 0.6),
        velocity: direction.multiplyScalar(6 + Math.random() * 18).add(drift),
        life: 0.35 + Math.random() * 0.65,
        size: 0.1 + Math.random() * 0.18,
        sizeEnd: 0.04,
        color: colors.hot,
        colorEnd: colors.cool,
        drag: 1.6,
      });
    }
    const smokeColor = style === 'crystal' ? this.scratchColor.setRGB(0.05, 0.12, 0.2) : this.scratchColor.setRGB(0.08, 0.07, 0.07);
    for (let index = 0; index < 10 + size * 6; index += 1) {
      const direction = this.scratch.randomDirection();
      this.smoke.spawn({
        position: position.clone().addScaledVector(direction, Math.random() * size * 0.5),
        velocity: direction.multiplyScalar(1.5 + Math.random() * 4).add(drift.clone().multiplyScalar(0.8)),
        life: 1.4 + Math.random() * 1.2,
        size: size * 1.4,
        sizeEnd: size * 4.5,
        color: smokeColor,
        alpha: 0.55,
        drag: 0.8,
      });
    }
    const chunkCount = style === 'ship' ? 18 : Math.round(6 + size * 4);
    for (let index = 0; index < chunkCount; index += 1) this.spawnChunk(position, size, style, drift);
    this.spawnFlash(position, colors.hot, 18 + size * 18, 0.35);
  }

  /** 命中したが壊れていないときの小さな火花。 */
  impact(position: THREE.Vector3, color: THREE.Color, drift: THREE.Vector3, amount = 1): void {
    for (let index = 0; index < 10 * amount; index += 1) {
      const direction = this.scratch.randomDirection();
      direction.z = Math.abs(direction.z);
      this.sparks.spawn(position, direction.multiplyScalar(10 + Math.random() * 22).add(drift), color, 0.18 + Math.random() * 0.2);
    }
    this.glow.spawn({ position: position.clone(), velocity: drift.clone(), life: 0.12, size: 1.6 * amount, sizeEnd: 0.4, color, drag: 0 });
  }

  /** 発光の小さな光点（muzzle flash、アイテム取得など）。 */
  burst(position: THREE.Vector3, color: THREE.Color, count: number, speed: number, size: number, life = 0.5): void {
    for (let index = 0; index < count; index += 1) {
      const direction = this.scratch.randomDirection();
      this.glow.spawn({
        position: position.clone(),
        velocity: direction.multiplyScalar(speed * (0.4 + Math.random() * 0.6)),
        life: life * (0.6 + Math.random() * 0.6),
        size,
        sizeEnd: size * 0.1,
        color,
        drag: 2.5,
      });
    }
  }

  ring(position: THREE.Vector3, startScale: number, endScale: number, life: number, color: THREE.Color): void {
    this.spawnShockwave(position, startScale, endScale, life, color, new THREE.Vector3());
  }

  private spawnFireball(position: THREE.Vector3, scale: number, life: number, colors: { hot: THREE.Color; cool: THREE.Color }, drift: THREE.Vector3, delay: number): void {
    const effect = this.fireballs[this.fireballCursor];
    this.fireballCursor = (this.fireballCursor + 1) % this.fireballs.length;
    effect.mesh.position.copy(position);
    effect.mesh.visible = true;
    effect.age = -delay;
    effect.life = life;
    effect.startScale = scale * 0.35;
    effect.endScale = scale;
    effect.velocity.copy(drift).multiplyScalar(0.85);
    effect.mesh.material.uniforms.hot.value.copy(colors.hot);
    effect.mesh.material.uniforms.cool.value.copy(colors.cool);
    effect.mesh.material.uniforms.seed.value = Math.random() * 100;
    effect.mesh.scale.setScalar(0.001);
  }

  private spawnShockwave(position: THREE.Vector3, startScale: number, endScale: number, life: number, color: THREE.Color, drift: THREE.Vector3): void {
    const effect = this.shockwaves[this.shockwaveCursor];
    this.shockwaveCursor = (this.shockwaveCursor + 1) % this.shockwaves.length;
    effect.mesh.position.copy(position);
    effect.mesh.visible = true;
    effect.age = 0;
    effect.life = life;
    effect.startScale = startScale;
    effect.endScale = endScale;
    effect.velocity.copy(drift).multiplyScalar(0.7);
    effect.mesh.material.uniforms.tint.value.copy(color);
  }

  private spawnChunk(position: THREE.Vector3, size: number, style: ExplosionStyle, drift: THREE.Vector3): void {
    const wanted = style === 'ship' ? 'metal' : style;
    let chunk = this.chunks[this.chunkCursor];
    for (let attempt = 0; attempt < this.chunks.length; attempt += 1) {
      const candidate = this.chunks[(this.chunkCursor + attempt) % this.chunks.length];
      if (candidate.mesh.userData.style === wanted) {
        chunk = candidate;
        this.chunkCursor = (this.chunkCursor + attempt + 1) % this.chunks.length;
        break;
      }
    }
    chunk.mesh.visible = true;
    chunk.mesh.position.copy(position);
    chunk.velocity.randomDirection().multiplyScalar(6 + Math.random() * 14 * Math.min(2, size)).add(drift);
    chunk.spin.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4);
    chunk.age = 0;
    chunk.life = 1.4 + Math.random() * 1.2;
    chunk.scale = (0.12 + Math.random() * 0.3) * Math.min(2.2, 0.6 + size * 0.4);
    chunk.mesh.scale.setScalar(chunk.scale);
  }

  private spawnFlash(position: THREE.Vector3, color: THREE.Color, peak: number, life: number): void {
    const flash = this.flashes[this.flashCursor];
    this.flashCursor = (this.flashCursor + 1) % this.flashes.length;
    flash.light.position.copy(position);
    flash.light.color.copy(color);
    flash.age = 0;
    flash.life = life;
    flash.peak = peak;
  }

  update(delta: number, camera: THREE.Camera): void {
    this.glow.update(delta);
    this.smoke.update(delta);
    this.sparks.update(delta);
    for (const effect of this.fireballs) {
      if (!effect.mesh.visible) continue;
      effect.age += delta;
      if (effect.age < 0) continue;
      const t = effect.age / effect.life;
      if (t >= 1) {
        effect.mesh.visible = false;
        continue;
      }
      effect.mesh.position.addScaledVector(effect.velocity, delta);
      effect.mesh.quaternion.copy(camera.quaternion);
      effect.mesh.scale.setScalar(THREE.MathUtils.lerp(effect.startScale, effect.endScale, 1 - Math.pow(1 - t, 3)));
      effect.mesh.material.uniforms.progress.value = t;
    }
    for (const effect of this.shockwaves) {
      if (!effect.mesh.visible) continue;
      effect.age += delta;
      const t = effect.age / effect.life;
      if (t >= 1) {
        effect.mesh.visible = false;
        continue;
      }
      effect.mesh.position.addScaledVector(effect.velocity, delta);
      effect.mesh.quaternion.copy(camera.quaternion);
      effect.mesh.scale.setScalar(THREE.MathUtils.lerp(effect.startScale, effect.endScale, 1 - Math.pow(1 - t, 2)));
      effect.mesh.material.uniforms.progress.value = t;
    }
    for (const chunk of this.chunks) {
      if (!chunk.mesh.visible) continue;
      chunk.age += delta;
      if (chunk.age >= chunk.life) {
        chunk.mesh.visible = false;
        continue;
      }
      chunk.velocity.multiplyScalar(Math.exp(-0.6 * delta));
      chunk.mesh.position.addScaledVector(chunk.velocity, delta);
      chunk.mesh.rotation.x += chunk.spin.x * delta;
      chunk.mesh.rotation.y += chunk.spin.y * delta;
      chunk.mesh.rotation.z += chunk.spin.z * delta;
      const fade = 1 - Math.max(0, (chunk.age - chunk.life * 0.7) / (chunk.life * 0.3));
      chunk.mesh.scale.setScalar(chunk.scale * fade);
      // 破片が飛ぶ間、焼けた尾を短く残す。
      if (chunk.age < 0.6 && Math.random() < 0.5) {
        this.glow.spawn({ position: chunk.mesh.position.clone(), velocity: new THREE.Vector3(), life: 0.25, size: chunk.scale * 0.9, sizeEnd: 0.02, color: CHUNK_TRAIL, colorEnd: CHUNK_TRAIL_END, drag: 0 });
      }
    }
    for (const flash of this.flashes) {
      if (flash.age >= flash.life) {
        flash.light.intensity = 0;
        continue;
      }
      flash.age += delta;
      flash.light.intensity = flash.peak * Math.pow(Math.max(0, 1 - flash.age / flash.life), 2) * 40;
    }
  }

  clear(): void {
    this.glow.clear();
    this.smoke.clear();
    this.sparks.clear();
    for (const effect of [...this.fireballs, ...this.shockwaves]) effect.mesh.visible = false;
    for (const chunk of this.chunks) chunk.mesh.visible = false;
    for (const flash of this.flashes) flash.age = flash.life;
  }
}
