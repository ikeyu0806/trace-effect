import * as THREE from 'three';
import type { WeaponId } from './config';

export interface WeaponLevelSpec {
  interval: number;
  damage: number;
  count: number;
  width: number;
  range: number;
}

export const WEAPON_SPECS: Record<WeaponId, readonly WeaponLevelSpec[]> = {
  spread: [
    { interval: 0.15, damage: 1, count: 5, width: 0.75, range: 0 },
    { interval: 0.13, damage: 1, count: 7, width: 0.95, range: 0 },
    { interval: 0.11, damage: 1.2, count: 9, width: 1.15, range: 0 },
  ],
  homing: [
    { interval: 0.42, damage: 2.2, count: 2, width: 0, range: 0 },
    { interval: 0.36, damage: 2.4, count: 3, width: 0, range: 0 },
    { interval: 0.3, damage: 2.6, count: 4, width: 0, range: 0 },
  ],
  laser: [
    { interval: 0.05, damage: 10, count: 1, width: 0.28, range: 120 },
    { interval: 0.05, damage: 14, count: 1, width: 0.42, range: 120 },
    { interval: 0.05, damage: 19, count: 1, width: 0.6, range: 120 },
  ],
  wave: [
    { interval: 0.34, damage: 2, count: 1, width: 3.4, range: 0 },
    { interval: 0.29, damage: 2.4, count: 1, width: 4.4, range: 0 },
    { interval: 0.24, damage: 2.8, count: 1, width: 5.6, range: 0 },
  ],
  chain: [
    { interval: 0.2, damage: 1.6, count: 2, width: 0, range: 18 },
    { interval: 0.17, damage: 1.8, count: 3, width: 0, range: 20 },
    { interval: 0.14, damage: 2, count: 5, width: 0, range: 22 },
  ],
};

export function weaponSpec(weapon: WeaponId, level: number): WeaponLevelSpec {
  const levels = WEAPON_SPECS[weapon];
  return levels[Math.min(levels.length, Math.max(1, Math.round(level))) - 1];
}

/** 中央と、その周囲へ等間隔に並ぶ照準点。countが5なら十字、7以上は外周を増やす。 */
export function createSpreadTargets(center: THREE.Vector3, spread: number, count: number): THREE.Vector3[] {
  const targets = [center.clone()];
  const outer = Math.max(0, count - 1);
  for (let index = 0; index < outer; index += 1) {
    const angle = (index / outer) * Math.PI * 2;
    targets.push(center.clone().add(new THREE.Vector3(Math.cos(angle) * spread, Math.sin(angle) * spread, 0)));
  }
  return targets;
}

/** 現在の速度を、目標方向へ最大turnRate[rad/s]だけ回す。速さは保つ。 */
export function steerTowards(
  velocity: THREE.Vector3,
  position: THREE.Vector3,
  target: THREE.Vector3,
  turnRate: number,
  delta: number,
): THREE.Vector3 {
  const speed = velocity.length();
  if (speed === 0) return velocity.clone();
  const current = velocity.clone().divideScalar(speed);
  const desired = target.clone().sub(position);
  if (desired.lengthSq() === 0) return velocity.clone();
  desired.normalize();
  const angle = current.angleTo(desired);
  const maxTurn = turnRate * delta;
  if (angle <= maxTurn || angle === 0) return desired.multiplyScalar(speed);
  const axis = new THREE.Vector3().crossVectors(current, desired);
  if (axis.lengthSq() < 1e-12) axis.set(0, 1, 0);
  axis.normalize();
  return current.applyAxisAngle(axis, maxTurn).multiplyScalar(speed);
}

export interface Targetable {
  id: number;
  position: THREE.Vector3;
}

/** 発射点に近い順に、前方（-Z側）にいる標的を選ぶ。 */
export function nearestTarget<T extends Targetable>(
  origin: THREE.Vector3,
  candidates: readonly T[],
  exclude: ReadonlySet<number> = new Set(),
  maxDistance = Infinity,
): T | null {
  let best: T | null = null;
  let bestDistance = maxDistance;
  for (const candidate of candidates) {
    if (exclude.has(candidate.id) || candidate.position.z > origin.z + 1) continue;
    const distance = candidate.position.distanceTo(origin);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** 最初の標的から、range以内の未命中標的へ順に連鎖する。 */
export function buildChain<T extends Targetable>(
  origin: THREE.Vector3,
  candidates: readonly T[],
  links: number,
  range: number,
  firstRange: number,
): T[] {
  const chain: T[] = [];
  const used = new Set<number>();
  let cursor = nearestTarget(origin, candidates, used, firstRange);
  while (cursor && chain.length < links) {
    chain.push(cursor);
    used.add(cursor.id);
    let next: T | null = null;
    let nextDistance = range;
    for (const candidate of candidates) {
      if (used.has(candidate.id)) continue;
      const distance = candidate.position.distanceTo(cursor.position);
      if (distance < nextDistance) {
        next = candidate;
        nextDistance = distance;
      }
    }
    cursor = next;
  }
  return chain;
}

/** 点から線分までの距離。ビームとWAVE ringの当たりに使う。 */
export function distanceToSegment(point: THREE.Vector3, start: THREE.Vector3, end: THREE.Vector3): number {
  const segment = end.clone().sub(start);
  const lengthSquared = segment.lengthSq();
  if (lengthSquared === 0) return point.distanceTo(start);
  const t = THREE.MathUtils.clamp(point.clone().sub(start).dot(segment) / lengthSquared, 0, 1);
  return start.clone().addScaledVector(segment, t).distanceTo(point);
}
