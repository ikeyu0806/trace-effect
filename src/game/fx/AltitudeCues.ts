import * as THREE from 'three';
import { cloneWithMaterials } from '../assets';
import type { JourneyLook } from '../journey';
import { GLOW_TEXTURE } from '../PlayerShip';
import { NOISE_GLSL } from '../render/glsl';

export const PLANE_Y = -5.6;
const SHADOW_POOL = 20;
const SCENERY_COUNT = 22;

export interface AltitudeBody {
  position: THREE.Vector3;
  radius: number;
}

const PLANE_VERTEX = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorld = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const PLANE_FRAGMENT = /* glsl */ `
uniform float time;
uniform vec3 tint;
uniform float opacity;
varying vec3 vWorld;
${NOISE_GLSL}

void main() {
  float radial = length(vWorld.xz);
  float ring = fract(radial * 0.012 - time * 0.03);
  float gaps = smoothstep(0.08, 0.0, abs(ring - 0.5) - 0.16);
  float ice = pow(fbm(vec3(vWorld.xz * 0.05, time * 0.06), 3), 1.6);
  float lanes = smoothstep(0.06, 0.0, abs(fract(vWorld.z * 0.022 + time * 0.4) - 0.5) - 0.08);
  float fadeZ = smoothstep(6.0, -40.0, vWorld.z) * smoothstep(-200.0, -80.0, vWorld.z);
  float fadeX = smoothstep(52.0, 14.0, abs(vWorld.x));
  float dust = ice * 0.85 + gaps * 0.7 + lanes * 0.25;
  float alpha = opacity * dust * fadeZ * fadeX * smoothstep(95.0, 28.0, radial);
  vec3 color = tint * (0.25 + ice * 1.1 + gaps * 0.65);
  gl_FragColor = vec4(color, alpha);
}
`;

/**
 * プレイ空間の「床」。Cassiniが環の上を飛ぶ映像やプラネタリウムの黄道面のように、
 * 薄い塵の平面と接触影で高さ（Y）を読ませる。隕石の複製を平面上に流して、
 * 避け対象より下を通過する景色にする。
 */
export class AltitudeCues {
  readonly group = new THREE.Group();
  private readonly planeMaterial: THREE.ShaderMaterial;
  private readonly shadows: THREE.Sprite[] = [];
  private readonly scenery: THREE.Object3D[] = [];
  private readonly spin = new Float32Array(SCENERY_COUNT);

  constructor(scene: THREE.Scene) {
    this.planeMaterial = new THREE.ShaderMaterial({
      vertexShader: PLANE_VERTEX,
      fragmentShader: PLANE_FRAGMENT,
      uniforms: {
        time: { value: 0 },
        tint: { value: new THREE.Color(0xd4b07a) },
        opacity: { value: 0.5 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(120, 280, 1, 1), this.planeMaterial);
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, PLANE_Y, -90);
    plane.renderOrder = -20;
    this.group.add(plane);

    const shadowMap = GLOW_TEXTURE();
    for (let index = 0; index < SHADOW_POOL; index += 1) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: shadowMap,
          color: 0x04060c,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          blending: THREE.MultiplyBlending,
          fog: true,
        }),
      );
      sprite.center.set(0.5, 0.5);
      sprite.visible = false;
      this.shadows.push(sprite);
      this.group.add(sprite);
    }
    scene.add(this.group);
  }

  /** 既存の隕石・デブリを、衝突判定のない環上の景色として流す。 */
  fillScenery(templates: THREE.Object3D[]): void {
    for (const object of this.scenery) object.removeFromParent();
    this.scenery.length = 0;
    if (templates.length === 0) return;
    for (let index = 0; index < SCENERY_COUNT; index += 1) {
      const object = cloneWithMaterials(templates[index % templates.length]);
      object.scale.setScalar(0.35 + Math.random() * 0.7);
      object.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.placeScenery(object, -20 - Math.random() * 180);
      this.spin[index] = (Math.random() - 0.5) * 0.4;
      this.group.add(object);
      this.scenery.push(object);
    }
  }

  update(delta: number, elapsed: number, worldSpeed: number, look: JourneyLook, bodies: readonly AltitudeBody[]): void {
    this.planeMaterial.uniforms.time.value = elapsed;
    (this.planeMaterial.uniforms.tint.value as THREE.Color).setHex(look.planeTint);
    this.planeMaterial.uniforms.opacity.value = look.planeOpacity;

    let used = 0;
    for (const body of bodies) {
      const sprite = this.shadows[used];
      if (!sprite) break;
      const height = body.position.y - PLANE_Y;
      if (height < 0.2 || height > 14 || body.position.z > 16 || body.position.z < -140) {
        continue;
      }
      const size = body.radius * (1.6 + height * 0.18);
      sprite.visible = true;
      sprite.position.set(body.position.x, PLANE_Y + 0.04, body.position.z);
      sprite.scale.set(size, size * 0.55, 1);
      sprite.material.opacity = THREE.MathUtils.clamp(0.55 / (0.7 + height * 0.22), 0.08, 0.5);
      used += 1;
    }
    for (let index = used; index < this.shadows.length; index += 1) this.shadows[index].visible = false;

    const visibleCount = Math.round(this.scenery.length * THREE.MathUtils.clamp(look.sceneryDensity, 0.08, 1.4));
    for (let index = 0; index < this.scenery.length; index += 1) {
      const object = this.scenery[index];
      const on = index < visibleCount;
      object.visible = on;
      if (!on) continue;
      object.position.z += worldSpeed * 0.72 * delta;
      object.rotation.y += this.spin[index] * delta;
      if (object.position.z > 18) this.placeScenery(object, -170 - Math.random() * 40);
    }
  }

  private placeScenery(object: THREE.Object3D, z: number): void {
    const side = (Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 16);
    object.position.set(side, PLANE_Y + 0.15 + Math.random() * 0.55, z);
  }
}
