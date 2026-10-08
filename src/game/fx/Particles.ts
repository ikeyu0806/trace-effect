import * as THREE from 'three';

export interface ParticleSpawn {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  size: number;
  sizeEnd?: number;
  color: THREE.Color;
  colorEnd?: THREE.Color;
  drag?: number;
  alpha?: number;
}

const POINT_VERTEX = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 tint;
varying float vAlpha;
varying vec3 vTint;
uniform float pixelScale;
void main() {
  vAlpha = alpha;
  vTint = tint;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * pixelScale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const GLOW_FRAGMENT = /* glsl */ `
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float core = exp(-r * 5.0);
  gl_FragColor = vec4(vTint * core * vAlpha, 1.0);
}
`;

const SMOKE_FRAGMENT = /* glsl */ `
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;
  float soft = (1.0 - r) * (1.0 - r);
  gl_FragColor = vec4(vTint, soft * vAlpha);
}
`;

/** CPUで動かし、1回のdraw callで描く粒子プール。古い粒子から上書きする。 */
export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly tints: Float32Array;
  private readonly sizes: Float32Array;
  private readonly alphas: Float32Array;
  private readonly velocities: Float32Array;
  private readonly startColors: Float32Array;
  private readonly endColors: Float32Array;
  private readonly startSizes: Float32Array;
  private readonly endSizes: Float32Array;
  private readonly ages: Float32Array;
  private readonly lives: Float32Array;
  private readonly drags: Float32Array;
  private readonly baseAlphas: Float32Array;
  private cursor = 0;
  private readonly material: THREE.ShaderMaterial;

  constructor(private readonly capacity: number, mode: 'glow' | 'smoke') {
    this.positions = new Float32Array(capacity * 3);
    this.tints = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.alphas = new Float32Array(capacity);
    this.velocities = new Float32Array(capacity * 3);
    this.startColors = new Float32Array(capacity * 3);
    this.endColors = new Float32Array(capacity * 3);
    this.startSizes = new Float32Array(capacity);
    this.endSizes = new Float32Array(capacity);
    this.ages = new Float32Array(capacity).fill(1);
    this.lives = new Float32Array(capacity).fill(1);
    this.drags = new Float32Array(capacity);
    this.baseAlphas = new Float32Array(capacity);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('tint', new THREE.BufferAttribute(this.tints, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      vertexShader: POINT_VERTEX,
      fragmentShader: mode === 'glow' ? GLOW_FRAGMENT : SMOKE_FRAGMENT,
      uniforms: { pixelScale: { value: 600 } },
      transparent: true,
      depthWrite: false,
      blending: mode === 'glow' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = mode === 'glow' ? 5 : 4;
  }

  setPixelScale(viewportHeight: number, fovDegrees: number): void {
    this.material.uniforms.pixelScale.value = viewportHeight / (2 * Math.tan(THREE.MathUtils.degToRad(fovDegrees) / 2));
  }

  spawn(particle: ParticleSpawn): void {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const i3 = index * 3;
    this.positions.set([particle.position.x, particle.position.y, particle.position.z], i3);
    this.velocities.set([particle.velocity.x, particle.velocity.y, particle.velocity.z], i3);
    const end = particle.colorEnd ?? particle.color;
    this.startColors.set([particle.color.r, particle.color.g, particle.color.b], i3);
    this.endColors.set([end.r, end.g, end.b], i3);
    this.startSizes[index] = particle.size;
    this.endSizes[index] = particle.sizeEnd ?? particle.size * 0.2;
    this.ages[index] = 0;
    this.lives[index] = particle.life;
    this.drags[index] = particle.drag ?? 1.2;
    this.baseAlphas[index] = particle.alpha ?? 1;
  }

  update(delta: number): void {
    for (let index = 0; index < this.capacity; index += 1) {
      const life = this.lives[index];
      let age = this.ages[index];
      if (age >= life) {
        this.alphas[index] = 0;
        this.sizes[index] = 0;
        continue;
      }
      age += delta;
      this.ages[index] = age;
      const t = Math.min(1, age / life);
      const i3 = index * 3;
      const damping = Math.exp(-this.drags[index] * delta);
      for (let axis = 0; axis < 3; axis += 1) {
        this.velocities[i3 + axis] *= damping;
        this.positions[i3 + axis] += this.velocities[i3 + axis] * delta;
        this.tints[i3 + axis] = this.startColors[i3 + axis] + (this.endColors[i3 + axis] - this.startColors[i3 + axis]) * t;
      }
      this.sizes[index] = this.startSizes[index] + (this.endSizes[index] - this.startSizes[index]) * t;
      this.alphas[index] = this.baseAlphas[index] * (1 - t) * Math.min(1, age * 30);
    }
    const geometry = this.points.geometry;
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.tint.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
    geometry.attributes.alpha.needsUpdate = true;
  }

  clear(): void {
    this.ages.fill(1);
    this.lives.fill(1);
  }
}

/** 速度方向へ伸びる火花。LineSegmentsの頂点色をフェードさせる。 */
export class SparkSystem {
  readonly lines: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly heads: Float32Array;
  private readonly velocities: Float32Array;
  private readonly baseColors: Float32Array;
  private readonly ages: Float32Array;
  private readonly lives: Float32Array;
  private cursor = 0;

  constructor(private readonly capacity: number) {
    this.positions = new Float32Array(capacity * 6);
    this.colors = new Float32Array(capacity * 6);
    this.heads = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.baseColors = new Float32Array(capacity * 3);
    this.ages = new Float32Array(capacity).fill(1);
    this.lives = new Float32Array(capacity).fill(1);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    this.lines = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 6;
  }

  spawn(position: THREE.Vector3, velocity: THREE.Vector3, color: THREE.Color, life: number): void {
    const index = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.heads.set([position.x, position.y, position.z], index * 3);
    this.velocities.set([velocity.x, velocity.y, velocity.z], index * 3);
    this.baseColors.set([color.r, color.g, color.b], index * 3);
    this.ages[index] = 0;
    this.lives[index] = life;
  }

  update(delta: number): void {
    for (let index = 0; index < this.capacity; index += 1) {
      const i3 = index * 3;
      const i6 = index * 6;
      if (this.ages[index] >= this.lives[index]) {
        this.colors.fill(0, i6, i6 + 6);
        continue;
      }
      this.ages[index] += delta;
      const fade = Math.max(0, 1 - this.ages[index] / this.lives[index]);
      const damping = Math.exp(-2.2 * delta);
      for (let axis = 0; axis < 3; axis += 1) {
        this.velocities[i3 + axis] *= damping;
        this.heads[i3 + axis] += this.velocities[i3 + axis] * delta;
        this.positions[i6 + axis] = this.heads[i3 + axis];
        this.positions[i6 + 3 + axis] = this.heads[i3 + axis] - this.velocities[i3 + axis] * 0.035;
        this.colors[i6 + axis] = this.baseColors[i3 + axis] * fade * 2;
        this.colors[i6 + 3 + axis] = 0;
      }
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;
  }

  clear(): void {
    this.ages.fill(1);
  }
}
