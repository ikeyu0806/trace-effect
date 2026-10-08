import * as THREE from 'three';
import { findNode } from './assets';
import type { ParticleSystem } from './fx/Particles';
import { NOISE_GLSL } from './render/glsl';

const FLAME_VERTEX = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPosition;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vViewPosition = -mvPosition.xyz;
  vNormalView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const FLAME_FRAGMENT = /* glsl */ `
uniform float time;
uniform float throttle;
uniform vec3 coreColor;
uniform vec3 edgeColor;
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPosition;
${NOISE_GLSL}
void main() {
  float along = 1.0 - vUv.y;
  float flicker = fbm(vec3(vUv.x * 6.0, vUv.y * 5.0 - time * 14.0, time * 2.0), 3);
  float facing = abs(dot(normalize(vNormalView), normalize(vViewPosition)));
  float body = pow(along, 1.6) * (0.55 + flicker * 0.9);
  float diamonds = 0.75 + 0.25 * sin(vUv.y * 40.0 - time * 30.0);
  vec3 color = mix(edgeColor, coreColor, pow(facing, 2.0) * along);
  gl_FragColor = vec4(color * body * diamonds * throttle * 1.5 * facing, 1.0);
}
`;

const SHIELD_FRAGMENT = /* glsl */ `
uniform float time;
uniform float strength;
uniform float hit;
varying vec2 vUv;
varying vec3 vNormalView;
varying vec3 vViewPosition;
void main() {
  float fresnel = pow(1.0 - abs(dot(normalize(vNormalView), normalize(vViewPosition))), 2.4);
  vec2 grid = vUv * vec2(48.0, 24.0);
  vec2 cell = abs(fract(grid + vec2(floor(grid.y) * 0.5, 0.0)) - 0.5);
  float hex = smoothstep(0.42, 0.5, max(cell.x * 1.15, cell.y));
  float sweep = smoothstep(0.08, 0.0, abs(fract(vUv.y * 2.0 - time * 0.6) - 0.5));
  vec3 color = vec3(0.25, 0.6, 1.0) * (fresnel * 1.4 + hex * 0.22 + sweep * 0.25) + vec3(0.7, 0.9, 1.0) * hit * (0.4 + fresnel);
  gl_FragColor = vec4(color * strength, 1.0);
}
`;

interface Trail {
  socket: THREE.Object3D;
  points: THREE.Vector3[];
  mesh: THREE.Mesh;
}

const TRAIL_LENGTH = 34;

function glowTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas is unavailable');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,255,255,0.65)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export const GLOW_TEXTURE = (() => {
  let texture: THREE.Texture | null = null;
  return () => (texture ??= glowTexture());
})();

/**
 * プレイヤー機の見た目。Blenderのsocketへ噴射炎、翼端trail、glowを付け、
 * シールド球と被弾後の点滅、strobeの明滅を扱う。gameplayの位置はrootを外から動かす。
 */
export class PlayerShip {
  readonly root = new THREE.Group();
  private readonly model: THREE.Object3D;
  private readonly flames: THREE.Mesh[] = [];
  private readonly flameUniforms = {
    time: { value: 0 },
    throttle: { value: 1 },
    coreColor: { value: new THREE.Color(0.85, 0.97, 1.0) },
    edgeColor: { value: new THREE.Color(0.15, 0.45, 1.0) },
  };
  private readonly engineSockets: THREE.Object3D[] = [];
  private readonly engineGlows: THREE.Sprite[] = [];
  private readonly trails: Trail[] = [];
  private readonly shield: THREE.Mesh;
  private readonly shieldUniforms = { time: { value: 0 }, strength: { value: 0 }, hit: { value: 0 } };
  private readonly strobeMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly engineMaterials: THREE.MeshStandardMaterial[] = [];
  private readonly engineLight = new THREE.PointLight(0x66ccff, 0, 12, 2);
  readonly muzzles: THREE.Object3D[] = [];
  readonly missilePods: THREE.Object3D[] = [];
  private shieldTarget = 0;
  private readonly scratch = new THREE.Vector3();
  private readonly overdriveCore = new THREE.Color(1.0, 0.95, 0.7);
  private readonly overdriveEdge = new THREE.Color(1.0, 0.45, 0.08);
  private readonly normalCore = new THREE.Color(0.85, 0.97, 1.0);
  private readonly normalEdge = new THREE.Color(0.15, 0.45, 1.0);

  constructor(model: THREE.Object3D, private readonly scene: THREE.Scene) {
    this.model = model;
    this.model.scale.setScalar(0.62);
    this.root.add(this.model);
    this.root.add(this.engineLight);

    model.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const material = child.material as THREE.MeshStandardMaterial;
      if (/strobe/i.test(material.name)) this.strobeMaterials.push(material);
      if (/engineglow/i.test(material.name)) this.engineMaterials.push(material);
    });

    const flameGeometry = new THREE.ConeGeometry(0.24, 1, 24, 6, true);
    flameGeometry.translate(0, 0.5, 0);
    flameGeometry.rotateX(-Math.PI / 2);
    const innerGeometry = new THREE.ConeGeometry(0.12, 1, 16, 4, true);
    innerGeometry.translate(0, 0.5, 0);
    innerGeometry.rotateX(-Math.PI / 2);
    const flameMaterial = new THREE.ShaderMaterial({
      vertexShader: FLAME_VERTEX,
      fragmentShader: FLAME_FRAGMENT,
      uniforms: this.flameUniforms,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    for (const [socketName, scale] of [
      ['TraceFighterMk2.Socket.EngineL', 1],
      ['TraceFighterMk2.Socket.EngineR', 1],
      ['TraceFighterMk2.Socket.EngineC', 0.6],
    ] as const) {
      const socket = findNode(model, socketName);
      if (!socket) continue;
      this.engineSockets.push(socket);
      const flame = new THREE.Mesh(flameGeometry, flameMaterial);
      const inner = new THREE.Mesh(innerGeometry, flameMaterial);
      flame.scale.set(scale, scale, 2.6 * scale);
      inner.scale.set(scale, scale, 1.6 * scale);
      flame.userData.baseLength = 2.6 * scale;
      inner.userData.baseLength = 1.6 * scale;
      socket.add(flame, inner);
      this.flames.push(flame, inner);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: GLOW_TEXTURE(), color: 0x7fd8ff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }),
      );
      glow.scale.setScalar(1.15 * scale);
      socket.add(glow);
      this.engineGlows.push(glow);
    }
    for (const name of ['MuzzleL', 'MuzzleR', 'Nose']) {
      const socket = findNode(model, `TraceFighterMk2.Socket.${name}`);
      if (socket) this.muzzles.push(socket);
    }
    for (const name of ['MissileL', 'MissileR']) {
      const socket = findNode(model, `TraceFighterMk2.Socket.${name}`);
      if (socket) this.missilePods.push(socket);
    }
    for (const name of ['WingtipL', 'WingtipR']) {
      const socket = findNode(model, `TraceFighterMk2.Socket.${name}`);
      if (socket) this.trails.push(this.createTrail(socket));
    }

    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1, 48, 24),
      new THREE.ShaderMaterial({
        vertexShader: FLAME_VERTEX,
        fragmentShader: SHIELD_FRAGMENT,
        uniforms: this.shieldUniforms,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.shield.scale.set(2.3, 1.1, 2.6);
    this.shield.visible = false;
    this.root.add(this.shield);
  }

  private createTrail(socket: THREE.Object3D): Trail {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(TRAIL_LENGTH * 2 * 3);
    const alphas = new Float32Array(TRAIL_LENGTH * 2);
    for (let index = 0; index < TRAIL_LENGTH; index += 1) {
      const fade = 1 - index / (TRAIL_LENGTH - 1);
      alphas[index * 2] = alphas[index * 2 + 1] = fade * fade;
    }
    const indices: number[] = [];
    for (let index = 0; index < TRAIL_LENGTH - 1; index += 1) {
      const a = index * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alphas, 1));
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: /* glsl */ `
          attribute float alpha;
          varying float vAlpha;
          void main() {
            vAlpha = alpha;
            gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          void main() { gl_FragColor = vec4(vec3(0.55, 0.8, 1.0) * vAlpha * 0.9, 1.0); }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const start = socket.getWorldPosition(new THREE.Vector3());
    return { socket, mesh, points: Array.from({ length: TRAIL_LENGTH }, () => start.clone()) };
  }

  resetTrails(): void {
    this.root.updateMatrixWorld(true);
    for (const trail of this.trails) {
      const start = trail.socket.getWorldPosition(new THREE.Vector3());
      for (const point of trail.points) point.copy(start);
    }
  }

  setShield(active: boolean): void {
    this.shieldTarget = active ? 1 : 0;
  }

  flashShield(): void {
    this.shieldUniforms.hit.value = 1;
    this.shield.visible = true;
  }

  setVisible(visible: boolean): void {
    this.model.visible = visible;
    for (const trail of this.trails) trail.mesh.visible = visible;
  }

  update(
    delta: number,
    elapsed: number,
    options: { throttle: number; overdrive: boolean; invulnerable: boolean; worldSpeed: number; camera: THREE.Camera; exhaust: ParticleSystem | null },
  ): void {
    this.flameUniforms.time.value = elapsed;
    const throttle = options.throttle * (options.overdrive ? 1.35 : 1);
    this.flameUniforms.throttle.value = THREE.MathUtils.damp(this.flameUniforms.throttle.value, throttle, 8, delta);
    this.flameUniforms.coreColor.value.lerp(options.overdrive ? this.overdriveCore : this.normalCore, Math.min(1, delta * 6));
    this.flameUniforms.edgeColor.value.lerp(options.overdrive ? this.overdriveEdge : this.normalEdge, Math.min(1, delta * 6));
    const pulse = 1 + Math.sin(elapsed * 38) * 0.06 + Math.sin(elapsed * 23) * 0.05;
    for (const flame of this.flames) {
      flame.scale.z = flame.userData.baseLength * this.flameUniforms.throttle.value * pulse;
    }
    for (const glow of this.engineGlows) {
      glow.material.color.copy(this.flameUniforms.edgeColor.value).lerp(this.flameUniforms.coreColor.value, 0.5);
      glow.material.opacity = 0.42 * this.flameUniforms.throttle.value;
    }
    for (const material of this.engineMaterials) material.emissiveIntensity = 3 + Math.sin(elapsed * 30) * 0.4;
    const strobe = (elapsed % 1.1) < 0.07 || ((elapsed + 0.18) % 1.1) < 0.05 ? 9 : 0.2;
    for (const material of this.strobeMaterials) material.emissiveIntensity = strobe;
    this.engineLight.position.set(0, 0.2, 2.2);
    this.engineLight.color.copy(this.flameUniforms.edgeColor.value);
    this.engineLight.intensity = 6 * this.flameUniforms.throttle.value;

    this.model.visible = !options.invulnerable || Math.floor(elapsed * 16) % 2 === 0;

    this.shieldUniforms.time.value = elapsed;
    this.shieldUniforms.hit.value = Math.max(0, this.shieldUniforms.hit.value - delta * 2.5);
    this.shieldUniforms.strength.value = THREE.MathUtils.damp(this.shieldUniforms.strength.value, this.shieldTarget, 6, delta);
    this.shield.visible = this.shieldUniforms.strength.value > 0.01 || this.shieldUniforms.hit.value > 0.01;
    if (this.shield.visible && this.shieldTarget === 0) this.shieldUniforms.strength.value = Math.max(this.shieldUniforms.strength.value, this.shieldUniforms.hit.value);

    this.root.updateMatrixWorld(true);
    if (options.exhaust) {
      for (const socket of this.engineSockets) {
        socket.getWorldPosition(this.scratch);
        options.exhaust.spawn({
          position: this.scratch.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.15, (Math.random() - 0.5) * 0.15, 0.3)),
          velocity: new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.8, options.worldSpeed * 0.9),
          life: 0.35,
          size: 0.32,
          sizeEnd: 0.05,
          color: this.flameUniforms.edgeColor.value,
          drag: 0.5,
          alpha: 0.5,
        });
      }
    }
    this.updateTrails(delta, options.worldSpeed, options.camera);
  }

  private updateTrails(delta: number, worldSpeed: number, camera: THREE.Camera): void {
    const toCamera = new THREE.Vector3();
    const tangent = new THREE.Vector3();
    const side = new THREE.Vector3();
    for (const trail of this.trails) {
      for (let index = trail.points.length - 1; index > 0; index -= 1) {
        trail.points[index].copy(trail.points[index - 1]);
        trail.points[index].z += worldSpeed * delta;
      }
      trail.socket.getWorldPosition(trail.points[0]);
      const positions = trail.mesh.geometry.attributes.position as THREE.BufferAttribute;
      for (let index = 0; index < trail.points.length; index += 1) {
        const point = trail.points[index];
        const next = trail.points[Math.min(trail.points.length - 1, index + 1)];
        tangent.subVectors(next, point);
        if (tangent.lengthSq() < 1e-6) tangent.set(0, 0, 1);
        toCamera.subVectors(camera.position, point);
        side.crossVectors(tangent, toCamera).normalize().multiplyScalar(0.05 * (1 - index / trail.points.length) + 0.01);
        positions.setXYZ(index * 2, point.x + side.x, point.y + side.y, point.z + side.z);
        positions.setXYZ(index * 2 + 1, point.x - side.x, point.y - side.y, point.z - side.z);
      }
      positions.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const trail of this.trails) trail.mesh.removeFromParent();
  }
}
