import * as THREE from 'three';
import { NOISE_GLSL } from './glsl';

/**
 * 太陽へ向かう方向（world）。カメラは約24度見下ろしているため、画面上端近くの左奥に置く。
 * 機体のrim light、全天の散乱、lens flareで共有する。
 */
export const SUN_DIRECTION = new THREE.Vector3(-0.52, -0.06, -0.85).normalize();
/** 惑星の陰影用の光。太陽と同じ左側から、やや手前に回して半月状に読ませる。 */
export const PLANET_LIGHT_DIRECTION = new THREE.Vector3(-0.62, 0.32, 0.36).normalize();
const SUN_DISTANCE = 1500;

const SKY_VERTEX = /* glsl */ `
varying vec3 vWorldPosition;
void main() {
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
  gl_Position.z = gl_Position.w;
}
`;

/** 天の川・星雲・太陽散乱の低周波成分。起動時に一度だけcubemapへ焼く。 */
const SKY_DIFFUSE_FRAGMENT = /* glsl */ `
uniform vec3 sunDirection;
varying vec3 vWorldPosition;
${NOISE_GLSL}

void main() {
  vec3 direction = normalize(vWorldPosition - cameraPosition);

  // 天の川: 傾いた大円に沿った帯と、暗い塵の筋。
  vec3 galacticNormal = normalize(vec3(0.305, -0.873, 0.38));
  float latitude = dot(direction, galacticNormal);
  float band = exp(-latitude * latitude * 22.0);
  float bandCore = exp(-latitude * latitude * 120.0);
  float dust = smoothstep(0.42, 0.72, fbm(direction * 7.0 + vec3(4.0, 1.0, 9.0), 5));
  float clumps = fbm(direction * 16.0, 4);
  vec3 milky = vec3(0.16, 0.17, 0.24) * band * (0.55 + clumps * 0.9);
  milky += vec3(0.42, 0.30, 0.22) * bandCore * (0.6 + clumps);
  milky *= 1.0 - dust * 0.8 * band;

  // 星雲: 2つの塊を方向で局在させ、色を重ねる。
  float nebulaA = exp(-pow(distance(direction, normalize(vec3(0.42, -0.36, -0.83))), 2.0) * 2.4);
  float nebulaB = exp(-pow(distance(direction, normalize(vec3(-0.58, -0.52, -0.63))), 2.0) * 3.0);
  float cloud = fbm(direction * 2.6 + vec3(2.0, 7.0, 1.0), 5);
  float wisps = fbm(direction * 6.5 + cloud * 2.0, 4);
  float shapeA = smoothstep(0.35, 0.85, cloud * 0.8 + wisps * 0.5) * nebulaA;
  float shapeB = smoothstep(0.3, 0.8, wisps * 0.9 + cloud * 0.3) * nebulaB;
  vec3 nebula = vec3(0.02, 0.28, 0.62) * shapeA + vec3(0.62, 0.04, 0.42) * shapeA * smoothstep(0.55, 0.85, wisps);
  nebula += vec3(0.7, 0.16, 0.03) * shapeB + vec3(0.28, 0.04, 0.5) * shapeB * (1.0 - wisps);
  nebula *= nebula * 2.4;
  float darkLane = smoothstep(0.55, 0.75, fbm(direction * 11.0 + 3.0, 4));
  nebula *= 1.0 - darkLane * 0.7;

  // 宇宙の背景は黒が基調。帯と星雲は暗部で色味だけが読める程度に抑える。
  vec3 color = vec3(0.0015, 0.0025, 0.006) + milky * 0.09 + nebula * 0.11;
  float sunAmount = max(dot(direction, sunDirection), 0.0);
  color += vec3(1.0, 0.78, 0.55) * pow(sunAmount, 24.0) * 0.06;
  gl_FragColor = vec4(color, 1.0);
}
`;

/** 毎フレーム描く全天。焼いた低周波cubemapに、画素精度の星を重ねる。 */
const SKY_FRAGMENT = /* glsl */ `
uniform samplerCube skyDiffuse;
varying vec3 vWorldPosition;
${NOISE_GLSL}

vec3 starLayer(vec3 direction, float scale, float density, float radius, float brightness) {
  vec3 p = direction * scale;
  vec3 cell = floor(p);
  vec3 jitter = 0.2 + 0.6 * hash33(cell);
  float presence = hash13(cell + 17.0);
  if (presence > density) return vec3(0.0);
  float distanceToStar = length(p - (cell + jitter));
  float pixel = max(fwidth(p.x), fwidth(p.y)) * 0.9;
  float effectiveRadius = max(radius, pixel);
  float energy = (radius * radius) / (effectiveRadius * effectiveRadius);
  float core = 1.0 - smoothstep(0.0, effectiveRadius, distanceToStar);
  float glow = exp(-distanceToStar * 10.0 / max(radius * 4.0, pixel)) * 0.25;
  float temperature = hash13(cell + 41.0);
  vec3 tint = mix(vec3(0.62, 0.78, 1.0), vec3(1.0, 0.82, 0.62), temperature);
  tint = mix(tint, vec3(1.0), 0.45);
  float magnitude = pow(hash13(cell + 5.0), 6.0) * 3.0 + 0.35;
  return tint * (core * energy + glow) * magnitude * brightness;
}

void main() {
  vec3 direction = normalize(vWorldPosition - cameraPosition);
  vec3 galacticNormal = normalize(vec3(0.305, -0.873, 0.38));
  float latitude = dot(direction, galacticNormal);
  float band = exp(-latitude * latitude * 22.0);
  vec3 color = textureCube(skyDiffuse, direction).rgb;
  color += starLayer(direction, 140.0, 0.08, 0.05, 1.6);
  color += starLayer(direction, 320.0, 0.22, 0.06, 0.9);
  color += starLayer(direction, 700.0, 0.35 + band * 0.4, 0.07, 0.5);
  gl_FragColor = vec4(color, 1.0);
}
`;

const PLANET_VERTEX = /* glsl */ `
varying vec3 vLocalNormal;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
void main() {
  vLocalNormal = normalize(position);
  vLocalPosition = position;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const GAS_GIANT_FRAGMENT = /* glsl */ `
uniform vec3 sunDirection;
uniform float time;
uniform float ringInner;
uniform float ringOuter;
uniform float radius;
uniform mat3 worldToLocal;
varying vec3 vLocalNormal;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
${NOISE_GLSL}

float ringDensity(float r) {
  float t = (r - ringInner) / (ringOuter - ringInner);
  if (t < 0.0 || t > 1.0) return 0.0;
  float d = 0.18 * smoothstep(0.0, 0.18, t);
  d += 0.75 * smoothstep(0.17, 0.2, t) * (1.0 - smoothstep(0.54, 0.56, t));
  d += 0.55 * smoothstep(0.6, 0.62, t) * (1.0 - smoothstep(0.92, 0.94, t));
  d *= 1.0 - 0.9 * (smoothstep(0.83, 0.835, t) - smoothstep(0.845, 0.85, t));
  d += 0.5 * exp(-pow((t - 0.975) * 120.0, 2.0));
  return d * (0.75 + 0.25 * sin(t * 220.0));
}

void main() {
  float latitude = vLocalNormal.y;
  float swirl = fbm(vec3(vLocalNormal.x * 3.0, latitude * 22.0, vLocalNormal.z * 3.0 + time * 0.01), 4);
  float bands = sin(latitude * 38.0 + swirl * 3.5) * 0.5 + 0.5;
  float fine = fbm(vec3(latitude * 90.0, vLocalNormal.x * 2.0, vLocalNormal.z * 2.0), 3);
  vec3 cream = vec3(0.86, 0.74, 0.52);
  vec3 tan = vec3(0.66, 0.48, 0.30);
  vec3 umber = vec3(0.40, 0.28, 0.18);
  vec3 albedo = mix(cream, tan, bands);
  albedo = mix(albedo, umber, smoothstep(0.55, 0.8, fine) * 0.5);
  albedo = mix(albedo, vec3(0.55, 0.62, 0.68), smoothstep(0.82, 0.95, abs(latitude)));

  vec3 normal = normalize(vWorldNormal);
  float lambert = dot(normal, sunDirection);
  float diffuse = smoothstep(-0.12, 0.6, lambert);

  // 環の影: 表面から太陽方向へ伸ばした光線が環の面と交わる位置の密度。
  vec3 localSun = normalize(worldToLocal * sunDirection);
  float shadow = 1.0;
  if (abs(localSun.y) > 1e-3) {
    float travel = -vLocalPosition.y / localSun.y;
    if (travel > 0.0) {
      vec3 hit = vLocalPosition + localSun * travel;
      shadow = 1.0 - ringDensity(length(hit.xz)) * 0.85;
    }
  }

  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 3.0);
  vec3 color = albedo * albedo * diffuse * shadow * 1.05;
  color += vec3(1.0, 0.78, 0.5) * rim * smoothstep(-0.2, 0.5, lambert) * 0.5;
  color += albedo * 0.015;
  gl_FragColor = vec4(color, 1.0);
}
`;

const RING_VERTEX = /* glsl */ `
varying vec3 vLocalPosition;
varying vec3 vWorldPosition;
void main() {
  vLocalPosition = position;
  vec4 worldPosition = modelMatrix * vec4(position, 1.0);
  vWorldPosition = worldPosition.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPosition;
}
`;

const RING_FRAGMENT = /* glsl */ `
uniform vec3 sunDirection;
uniform float ringInner;
uniform float ringOuter;
uniform float radius;
uniform mat3 worldToLocal;
varying vec3 vLocalPosition;
varying vec3 vWorldPosition;
${NOISE_GLSL}

void main() {
  float r = length(vLocalPosition.xy);
  float t = (r - ringInner) / (ringOuter - ringInner);
  if (t < 0.0 || t > 1.0) discard;
  float d = 0.18 * smoothstep(0.0, 0.18, t);
  d += 0.75 * smoothstep(0.17, 0.2, t) * (1.0 - smoothstep(0.54, 0.56, t));
  d += 0.55 * smoothstep(0.6, 0.62, t) * (1.0 - smoothstep(0.92, 0.94, t));
  d *= 1.0 - 0.9 * (smoothstep(0.83, 0.835, t) - smoothstep(0.845, 0.85, t));
  d += 0.5 * exp(-pow((t - 0.975) * 120.0, 2.0));
  float grain = valueNoise(vec3(r * 2.4, 0.0, 0.0)) * 0.5 + valueNoise(vec3(r * 9.0, 3.0, 0.0)) * 0.5;
  d *= 0.55 + grain * 0.7;

  // 惑星の影: 環の点から太陽へ向かう光線が惑星球に当たるか。
  vec3 localPoint = vec3(vLocalPosition.x, 0.0, -vLocalPosition.y);
  vec3 localSun = normalize(worldToLocal * sunDirection);
  float b = dot(localPoint, localSun);
  float c = dot(localPoint, localPoint) - radius * radius;
  float h = b * b - c;
  float shadow = (h > 0.0 && -b - sqrt(h) > 0.0) ? 0.08 : 1.0;

  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  float forward = pow(max(dot(-viewDirection, sunDirection), 0.0), 6.0);
  vec3 albedo = mix(vec3(0.78, 0.68, 0.52), vec3(0.55, 0.47, 0.38), grain);
  albedo = mix(albedo, vec3(0.86, 0.84, 0.8), smoothstep(0.6, 0.95, t));
  vec3 color = albedo * (0.95 + forward * 1.6) * shadow;
  gl_FragColor = vec4(color, d * 0.92);
}
`;

const ICE_PLANET_FRAGMENT = /* glsl */ `
uniform vec3 sunDirection;
uniform float time;
varying vec3 vLocalNormal;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
${NOISE_GLSL}

void main() {
  vec3 n = vLocalNormal;
  float continents = fbm(n * 2.2 + 11.0, 5);
  float ice = smoothstep(0.62, 0.9, abs(n.y) + fbm(n * 5.0, 3) * 0.2);
  vec3 ocean = mix(vec3(0.015, 0.06, 0.16), vec3(0.03, 0.16, 0.3), continents);
  vec3 land = mix(vec3(0.16, 0.24, 0.3), vec3(0.38, 0.46, 0.5), fbm(n * 9.0, 3));
  vec3 albedo = mix(ocean, land, smoothstep(0.52, 0.58, continents));
  albedo = mix(albedo, vec3(0.82, 0.9, 0.96), ice);
  float clouds = smoothstep(0.5, 0.78, fbm(n * 3.4 + vec3(time * 0.004, 0.0, time * 0.002) + fbm(n * 7.0, 3), 5));
  albedo = mix(albedo, vec3(0.92, 0.95, 1.0), clouds * 0.85);

  vec3 normal = normalize(vWorldNormal);
  float lambert = dot(normal, sunDirection);
  float diffuse = smoothstep(-0.1, 0.7, lambert);
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.5);
  vec3 color = albedo * diffuse * 0.9;
  color += vec3(0.3, 0.6, 1.0) * fresnel * smoothstep(-0.3, 0.4, lambert) * 0.7;
  // 夜側に海の鏡面がないぶん、わずかな大気の青で輪郭を保つ。
  color += vec3(0.01, 0.025, 0.06) * (1.0 - diffuse);
  vec3 halfVector = normalize(sunDirection + viewDirection);
  color += vec3(1.0, 0.9, 0.8) * pow(max(dot(normal, halfVector), 0.0), 60.0) * (1.0 - clouds) * (1.0 - ice) * 0.3;
  gl_FragColor = vec4(color, 1.0);
}
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
uniform vec3 sunDirection;
uniform vec3 glowColor;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;
void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 viewDirection = normalize(cameraPosition - vWorldPosition);
  // 裏面の大気殻で、惑星の縁（約0.37）から外縁（0）へ減衰させる。
  float edge = pow(clamp(dot(-normal, viewDirection) / 0.37, 0.0, 1.0), 2.2);
  float lit = smoothstep(-0.3, 0.6, dot(normal, sunDirection));
  gl_FragColor = vec4(glowColor * edge * (0.25 + lit * 1.4), 1.0);
}
`;

const AURORA_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const AURORA_FRAGMENT = /* glsl */ `
uniform float time;
uniform float intensity;
uniform float repeat;
uniform float seed;
varying vec2 vUv;
${NOISE_GLSL}

float curtain(vec2 uv, float offset) {
  float x = uv.x * repeat + offset;
  if (uv.y < 0.1 || uv.y > 0.98) return 0.0;
  float fold = fbm(vec3(x * 0.6, time * 0.05 + offset, seed), 2) * 2.4;
  float edge = 0.12 + 0.18 * fbm(vec3(x * 0.9 + fold, time * 0.03, seed + 4.0), 2);
  float height = uv.y - edge;
  if (height < 0.0) return 0.0;
  float presence = smoothstep(0.35, 0.65, fbm(vec3(x * 0.35 - time * 0.02, seed, 2.0), 2));
  if (presence <= 0.0) return 0.0;
  float rays = valueNoise(vec3((x + fold) * 26.0, uv.y * 1.5 - time * 0.4, seed));
  rays = pow(rays, 2.0) * 0.8 + 0.25;
  float profile = smoothstep(0.0, 0.035, height) * exp(-height * 3.2);
  return profile * rays * presence;
}

void main() {
  float a = curtain(vUv, 0.0);
  float b = curtain(vUv + vec2(0.013, 0.02), 7.3) * 0.7;
  float height = vUv.y;
  vec3 green = vec3(0.12, 1.0, 0.48);
  vec3 teal = vec3(0.1, 0.65, 0.9);
  vec3 violet = vec3(0.65, 0.2, 0.9);
  vec3 color = mix(green, teal, smoothstep(0.2, 0.5, height));
  color = mix(color, violet, smoothstep(0.42, 0.85, height));
  float sideFade = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
  float topFade = 1.0 - smoothstep(0.75, 1.0, height);
  gl_FragColor = vec4(color * (a + b) * intensity * sideFade * topFade, 1.0);
}
`;

const MOON_FRAGMENT = /* glsl */ `
uniform vec3 sunDirection;
varying vec3 vLocalNormal;
varying vec3 vWorldNormal;
${NOISE_GLSL}
void main() {
  vec3 n = vLocalNormal;
  float maria = smoothstep(0.45, 0.6, fbm(n * 1.8 + 3.0, 4));
  float craters = fbm(n * 14.0, 4);
  vec3 albedo = mix(vec3(0.42, 0.41, 0.4), vec3(0.2, 0.2, 0.21), maria);
  albedo *= 0.8 + craters * 0.4;
  float diffuse = smoothstep(-0.05, 0.6, dot(normalize(vWorldNormal), sunDirection));
  gl_FragColor = vec4(albedo * diffuse * 1.2, 1.0);
}
`;

const SUN_FRAGMENT = /* glsl */ `
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float core = smoothstep(0.12, 0.08, r) * 14.0;
  float corona = exp(-r * 7.0) * 2.6 + exp(-r * 2.6) * 0.35;
  float rays = pow(max(0.0, 1.0 - abs(p.y) * 30.0), 2.0) * exp(-abs(p.x) * 2.4) * 0.9;
  vec3 color = vec3(1.0, 0.92, 0.8) * (core + corona) + vec3(0.6, 0.75, 1.0) * rays;
  gl_FragColor = vec4(color * smoothstep(1.0, 0.7, r), 1.0);
}
`;

interface SphereOccluder {
  object: THREE.Object3D;
  radius: number;
}

/**
 * 遠景をまとめて持つ。全天、ガス惑星と環、氷惑星とオーロラ、衛星、太陽、空のオーロラ。
 * 遠景は飛行の進行に合わせてわずかに近づけ、90秒の移動感を出す。
 */
export class SpaceBackdrop {
  readonly group = new THREE.Group();
  readonly sky: THREE.Mesh;
  private readonly skyDiffuseMaterial: THREE.ShaderMaterial;
  private readonly timeUniforms: { value: number }[] = [];
  private readonly gasGiant = new THREE.Group();
  private readonly icePlanet = new THREE.Group();
  private readonly moon: THREE.Mesh;
  private readonly sun: THREE.Mesh;
  private readonly occluders: SphereOccluder[] = [];
  private readonly worldToLocalUniforms: { value: THREE.Matrix3; target: THREE.Object3D }[] = [];

  constructor() {
    const skySunUniform = { value: SUN_DIRECTION.clone() };
    const sunUniform = { value: PLANET_LIGHT_DIRECTION.clone() };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1800, 64, 32),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERTEX,
        fragmentShader: SKY_FRAGMENT,
        uniforms: { skyDiffuse: { value: null } },
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.skyDiffuseMaterial = new THREE.ShaderMaterial({
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_DIFFUSE_FRAGMENT,
      uniforms: { sunDirection: skySunUniform },
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    this.createGasGiant(sunUniform);
    this.createIcePlanet(sunUniform);
    this.moon = this.createMoon(sunUniform);
    this.sun = this.createSun();
    this.createSkyAurora();
  }

  /** 全天の低周波成分を512角のHDR cubemapへ焼く。描画前に一度だけ呼ぶ。 */
  bake(renderer: THREE.WebGLRenderer): void {
    const target = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    const bakeScene = new THREE.Scene();
    bakeScene.add(new THREE.Mesh(this.sky.geometry, this.skyDiffuseMaterial));
    new THREE.CubeCamera(1, 4000, target).update(renderer, bakeScene);
    (this.sky.material as THREE.ShaderMaterial).uniforms.skyDiffuse.value = target.texture;
    this.skyDiffuseMaterial.dispose();
  }

  /** 環境map用に、全天と太陽だけを持つSceneを返す。 */
  createEnvironmentScene(): THREE.Scene {
    const environmentScene = new THREE.Scene();
    const skyClone = new THREE.Mesh(this.sky.geometry, this.sky.material);
    environmentScene.add(skyClone);
    const sunClone = this.sun.clone();
    sunClone.position.copy(SUN_DIRECTION).multiplyScalar(900);
    sunClone.scale.setScalar(0.6);
    sunClone.lookAt(0, 0, 0);
    environmentScene.add(sunClone);
    return environmentScene;
  }

  private createGasGiant(sunUniform: { value: THREE.Vector3 }): void {
    const radius = 72;
    const ringInner = radius * 1.24;
    const ringOuter = radius * 2.3;
    const worldToLocal = { value: new THREE.Matrix3(), target: this.gasGiant };
    this.worldToLocalUniforms.push(worldToLocal);
    const time = { value: 0 };
    this.timeUniforms.push(time);
    const uniforms = {
      sunDirection: sunUniform,
      time,
      ringInner: { value: ringInner },
      ringOuter: { value: ringOuter },
      radius: { value: radius },
      worldToLocal,
    };
    const planet = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 128, 64),
      new THREE.ShaderMaterial({ vertexShader: PLANET_VERTEX, fragmentShader: GAS_GIANT_FRAGMENT, uniforms }),
    );
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(ringInner, ringOuter, 256, 1),
      new THREE.ShaderMaterial({
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        uniforms,
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    // RingGeometryはローカルXY平面。惑星のローカルXZ（赤道面）へ寝かせる。
    ring.rotation.x = -Math.PI / 2;
    this.gasGiant.add(planet, ring);
    this.gasGiant.position.set(-280, -150, -700);
    this.gasGiant.rotation.set(0.42, 0.3, -0.38);
    this.group.add(this.gasGiant);
    this.occluders.push({ object: this.gasGiant, radius });
  }

  private createIcePlanet(sunUniform: { value: THREE.Vector3 }): void {
    const radius = 58;
    const time = { value: 0 };
    this.timeUniforms.push(time);
    const surface = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 128, 64),
      new THREE.ShaderMaterial({
        vertexShader: PLANET_VERTEX,
        fragmentShader: ICE_PLANET_FRAGMENT,
        uniforms: { sunDirection: sunUniform, time },
      }),
    );
    const atmosphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.075, 96, 48),
      new THREE.ShaderMaterial({
        vertexShader: PLANET_VERTEX,
        fragmentShader: ATMOSPHERE_FRAGMENT,
        uniforms: { sunDirection: sunUniform, glowColor: { value: new THREE.Color(0.35, 0.7, 1.4) } },
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.icePlanet.add(surface, atmosphere);
    for (const pole of [1, -1]) {
      for (let layer = 0; layer < 2; layer += 1) {
        const height = radius * (0.3 + layer * 0.1);
        const aurora = this.createAuroraCurtain(radius * (0.36 + layer * 0.05), height, 3.2, 1.5 + layer * 0.5, pole * 3 + layer);
        // 緯度約70度の地表（半径0.34R、高さ0.94R）のすぐ外側から立ち上げる。
        aurora.position.y = pole * (radius * (0.95 + layer * 0.02) + height * 0.5);
        if (pole < 0) aurora.rotation.x = Math.PI;
        this.icePlanet.add(aurora);
      }
    }
    this.icePlanet.position.set(340, -260, -620);
    this.icePlanet.rotation.set(0.62, 0, -0.35);
    this.group.add(this.icePlanet);
    this.occluders.push({ object: this.icePlanet, radius });
  }

  private createAuroraCurtain(bottomRadius: number, height: number, repeat: number, intensity: number, seed: number): THREE.Mesh {
    const time = { value: 0 };
    this.timeUniforms.push(time);
    const geometry = new THREE.CylinderGeometry(bottomRadius * 1.18, bottomRadius, height, 160, 1, true);
    return new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: AURORA_VERTEX,
        fragmentShader: AURORA_FRAGMENT,
        uniforms: { time, intensity: { value: intensity }, repeat: { value: repeat * 4 }, seed: { value: seed } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
  }

  private createSkyAurora(): void {
    const radius = 1300;
    const arc = THREE.MathUtils.degToRad(110);
    // 画面に入る仰角-32度〜-2度の帯に、カメラを囲む円筒の一部として置く。
    const geometry = new THREE.CylinderGeometry(radius, radius, 760, 220, 1, true, Math.PI - arc * 0.5 + 0.25, arc);
    // 画面の広い範囲を覆うため1枚だけにしてfill rateを抑える（奥のcurtainはshader内で重ねる）。
    const time = { value: 0 };
    this.timeUniforms.push(time);
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: AURORA_VERTEX,
        fragmentShader: AURORA_FRAGMENT,
        uniforms: { time, intensity: { value: 0.58 }, repeat: { value: 5 }, seed: { value: 20 } },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.BackSide,
      }),
    );
    mesh.position.y = -420;
    mesh.renderOrder = -90;
    mesh.frustumCulled = false;
    this.group.add(mesh);
  }

  private createMoon(sunUniform: { value: THREE.Vector3 }): THREE.Mesh {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(13, 64, 32),
      new THREE.ShaderMaterial({ vertexShader: PLANET_VERTEX, fragmentShader: MOON_FRAGMENT, uniforms: { sunDirection: sunUniform } }),
    );
    moon.position.set(-120, -40, -520);
    this.group.add(moon);
    this.occluders.push({ object: moon, radius: 13 });
    return moon;
  }

  private createSun(): THREE.Mesh {
    const sun = new THREE.Mesh(
      new THREE.PlaneGeometry(240, 240),
      new THREE.ShaderMaterial({
        vertexShader: AURORA_VERTEX,
        fragmentShader: SUN_FRAGMENT,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    sun.position.copy(SUN_DIRECTION).multiplyScalar(SUN_DISTANCE);
    sun.renderOrder = -80;
    this.group.add(sun);
    return sun;
  }

  /** 太陽が惑星に隠れているかを、カメラからの光線と球の交差で判定する。 */
  sunVisibility(camera: THREE.Camera): number {
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const toSun = this.sun.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const center = new THREE.Vector3();
    for (const occluder of this.occluders) {
      occluder.object.getWorldPosition(center);
      const offset = center.sub(origin);
      const along = offset.dot(toSun);
      if (along <= 0) continue;
      const closest = offset.lengthSq() - along * along;
      if (closest < occluder.radius * occluder.radius) return 0;
    }
    return 1;
  }

  sunWorldPosition(target: THREE.Vector3): THREE.Vector3 {
    return this.sun.getWorldPosition(target);
  }

  update(elapsed: number, flightProgress: number, camera: THREE.Camera): void {
    for (const uniform of this.timeUniforms) uniform.value = elapsed;
    this.sky.position.copy(camera.position);
    this.sun.lookAt(camera.position);
    const drift = flightProgress;
    this.gasGiant.position.set(-280 + drift * 40, -150 + drift * 20, -700 + drift * 120);
    this.gasGiant.rotation.y = 0.3 + elapsed * 0.004;
    this.icePlanet.position.set(340 - drift * 30, -260 + drift * 25, -620 + drift * 90);
    this.icePlanet.rotation.y = elapsed * 0.01;
    this.moon.position.set(-120 + drift * 25, -40 + drift * 8, -520 + drift * 100);
    for (const uniform of this.worldToLocalUniforms) {
      uniform.target.updateMatrixWorld();
      uniform.value.setFromMatrix4(uniform.target.matrixWorld).invert();
    }
  }
}
