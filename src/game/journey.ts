/**
 * 90秒の飛行を、プラネタリウムの太陽系ショーやEverspace / Elite Dangerousのように
 * 色と光源と遠景の配置が変わる区間へ分ける。 Cassiniの環上飛行、氷衛星、小惑星帯、
 * 散光星雲、そして目的星への接近。
 */
export type JourneyId = 'rings' | 'ice' | 'belt' | 'nebula' | 'approach';

export interface Vec3Key {
  x: number;
  y: number;
  z: number;
}

export interface JourneyLook {
  id: JourneyId;
  destination: string;
  fogColor: number;
  fogDensity: number;
  dustTint: readonly [number, number, number];
  sunColor: number;
  sunIntensity: number;
  keyColor: number;
  keyIntensity: number;
  bounceColor: number;
  bounceIntensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  planeTint: number;
  planeOpacity: number;
  nebula: number;
  skyAurora: number;
  skyTint: number;
  exposure: number;
  sceneryDensity: number;
  gasGiant: Vec3Key & { scale: number };
  icePlanet: Vec3Key & { scale: number };
  moon: Vec3Key;
}

interface JourneyStop {
  at: number;
  id: JourneyId;
  destination: string;
  look: Omit<JourneyLook, 'id' | 'destination'>;
}

const STOPS: readonly JourneyStop[] = [
  {
    at: 0,
    id: 'rings',
    destination: 'RINGS / 01',
    look: {
      fogColor: 0x1a140c,
      fogDensity: 0.0044,
      dustTint: [1.0, 0.82, 0.55],
      sunColor: 0xffe2bc,
      sunIntensity: 3.6,
      keyColor: 0xffe8c8,
      keyIntensity: 2.2,
      bounceColor: 0xc9a06a,
      bounceIntensity: 1.35,
      hemiSky: 0xffd9a8,
      hemiGround: 0x2a1608,
      hemiIntensity: 0.62,
      planeTint: 0xd4b07a,
      planeOpacity: 0.34,
      nebula: 0,
      skyAurora: 0.62,
      skyTint: 0xfff0d8,
      exposure: 1.02,
      sceneryDensity: 1,
      gasGiant: { x: -210, y: -95, z: -480, scale: 1.18 },
      icePlanet: { x: 420, y: -280, z: -780, scale: 0.82 },
      moon: { x: -90, y: -28, z: -360 },
    },
  },
  {
    at: 0.22,
    id: 'ice',
    destination: 'ICE WAKE / 02',
    look: {
      fogColor: 0x07141f,
      fogDensity: 0.005,
      dustTint: [0.7, 0.9, 1.0],
      sunColor: 0xe8f4ff,
      sunIntensity: 2.8,
      keyColor: 0xd8e8ff,
      keyIntensity: 2.4,
      bounceColor: 0x4f8dff,
      bounceIntensity: 1.55,
      hemiSky: 0xb8d8ff,
      hemiGround: 0x081018,
      hemiIntensity: 0.7,
      planeTint: 0x8ec8ff,
      planeOpacity: 0.28,
      nebula: 0.08,
      skyAurora: 0.95,
      skyTint: 0xc8e4ff,
      exposure: 0.98,
      sceneryDensity: 0.85,
      gasGiant: { x: -340, y: -160, z: -720, scale: 0.92 },
      icePlanet: { x: 210, y: -140, z: -430, scale: 1.2 },
      moon: { x: 40, y: -10, z: -300 },
    },
  },
  {
    at: 0.44,
    id: 'belt',
    destination: 'ASTEROID BELT / 03',
    look: {
      fogColor: 0x120e0a,
      fogDensity: 0.0062,
      dustTint: [1.0, 0.72, 0.42],
      sunColor: 0xffd4a0,
      sunIntensity: 3.1,
      keyColor: 0xffe0c0,
      keyIntensity: 2.0,
      bounceColor: 0x8a5a32,
      bounceIntensity: 1.1,
      hemiSky: 0xe8c8a0,
      hemiGround: 0x1a0e08,
      hemiIntensity: 0.5,
      planeTint: 0xb88958,
      planeOpacity: 0.38,
      nebula: 0.05,
      skyAurora: 0.18,
      skyTint: 0xffe6c8,
      exposure: 0.96,
      sceneryDensity: 1.35,
      gasGiant: { x: -460, y: -210, z: -920, scale: 0.7 },
      icePlanet: { x: 380, y: -220, z: -820, scale: 0.78 },
      moon: { x: -40, y: 8, z: -640 },
    },
  },
  {
    at: 0.68,
    id: 'nebula',
    destination: 'EMISSION NEBULA / 04',
    look: {
      fogColor: 0x14061a,
      fogDensity: 0.0056,
      dustTint: [0.85, 0.45, 1.0],
      sunColor: 0xffb0e8,
      sunIntensity: 2.2,
      keyColor: 0xc8a0ff,
      keyIntensity: 2.1,
      bounceColor: 0xff4fa0,
      bounceIntensity: 1.4,
      hemiSky: 0xe0a0ff,
      hemiGround: 0x180814,
      hemiIntensity: 0.78,
      planeTint: 0xc060ff,
      planeOpacity: 0.16,
      nebula: 1,
      skyAurora: 0.28,
      skyTint: 0xffd0ff,
      exposure: 1.04,
      sceneryDensity: 0.35,
      gasGiant: { x: -520, y: -240, z: -1100, scale: 0.48 },
      icePlanet: { x: 520, y: -260, z: -1080, scale: 0.5 },
      moon: { x: 80, y: 30, z: -900 },
    },
  },
  {
    at: 1,
    id: 'approach',
    destination: 'STELLAR APPROACH / 05',
    look: {
      fogColor: 0x050814,
      fogDensity: 0.0038,
      dustTint: [0.75, 0.88, 1.0],
      sunColor: 0xfff6e8,
      sunIntensity: 4.2,
      keyColor: 0xe8f4ff,
      keyIntensity: 2.6,
      bounceColor: 0x6aa8ff,
      bounceIntensity: 0.7,
      hemiSky: 0xc8dcff,
      hemiGround: 0x060814,
      hemiIntensity: 0.48,
      planeTint: 0x88b4ff,
      planeOpacity: 0.08,
      nebula: 0.12,
      skyAurora: 0.05,
      skyTint: 0xdce8ff,
      exposure: 1.08,
      sceneryDensity: 0.12,
      gasGiant: { x: -580, y: -280, z: -1280, scale: 0.32 },
      icePlanet: { x: 600, y: -300, z: -1240, scale: 0.34 },
      moon: { x: 120, y: 50, z: -1100 },
    },
  },
];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpHex(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const r = Math.round(lerp(ar, br, t));
  const g = Math.round(lerp(ag, bg, t));
  const bl = Math.round(lerp(ab, bb, t));
  return (r << 16) | (g << 8) | bl;
}

function lerpVec(a: Vec3Key, b: Vec3Key, t: number): Vec3Key {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** 飛行進行度0〜1から、今の区間の見た目を取り出す。区間の境は滑らかに混ぜる。 */
export function sampleJourney(progress: number): JourneyLook {
  const t = Math.min(1, Math.max(0, progress));
  let index = 0;
  while (index < STOPS.length - 2 && t >= STOPS[index + 1].at) index += 1;
  const from = STOPS[index];
  const to = STOPS[index + 1];
  const span = Math.max(1e-6, to.at - from.at);
  const mix = smooth(Math.min(1, Math.max(0, (t - from.at) / span)));
  const a = from.look;
  const b = to.look;
  const id = mix < 0.5 ? from.id : to.id;
  const destination = mix < 0.5 ? from.destination : to.destination;
  return {
    id,
    destination,
    fogColor: lerpHex(a.fogColor, b.fogColor, mix),
    fogDensity: lerp(a.fogDensity, b.fogDensity, mix),
    dustTint: [
      lerp(a.dustTint[0], b.dustTint[0], mix),
      lerp(a.dustTint[1], b.dustTint[1], mix),
      lerp(a.dustTint[2], b.dustTint[2], mix),
    ],
    sunColor: lerpHex(a.sunColor, b.sunColor, mix),
    sunIntensity: lerp(a.sunIntensity, b.sunIntensity, mix),
    keyColor: lerpHex(a.keyColor, b.keyColor, mix),
    keyIntensity: lerp(a.keyIntensity, b.keyIntensity, mix),
    bounceColor: lerpHex(a.bounceColor, b.bounceColor, mix),
    bounceIntensity: lerp(a.bounceIntensity, b.bounceIntensity, mix),
    hemiSky: lerpHex(a.hemiSky, b.hemiSky, mix),
    hemiGround: lerpHex(a.hemiGround, b.hemiGround, mix),
    hemiIntensity: lerp(a.hemiIntensity, b.hemiIntensity, mix),
    planeTint: lerpHex(a.planeTint, b.planeTint, mix),
    planeOpacity: lerp(a.planeOpacity, b.planeOpacity, mix),
    nebula: lerp(a.nebula, b.nebula, mix),
    skyAurora: lerp(a.skyAurora, b.skyAurora, mix),
    skyTint: lerpHex(a.skyTint, b.skyTint, mix),
    exposure: lerp(a.exposure, b.exposure, mix),
    sceneryDensity: lerp(a.sceneryDensity, b.sceneryDensity, mix),
    gasGiant: { ...lerpVec(a.gasGiant, b.gasGiant, mix), scale: lerp(a.gasGiant.scale, b.gasGiant.scale, mix) },
    icePlanet: { ...lerpVec(a.icePlanet, b.icePlanet, mix), scale: lerp(a.icePlanet.scale, b.icePlanet.scale, mix) },
    moon: lerpVec(a.moon, b.moon, mix),
  };
}
