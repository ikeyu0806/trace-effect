import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildChain, createSpreadTargets, distanceToSegment, nearestTarget, steerTowards, weaponSpec } from './weapons';

describe('weapon specs', () => {
  it('clamps levels into the defined range', () => {
    expect(weaponSpec('spread', 0).count).toBe(5);
    expect(weaponSpec('spread', 9).count).toBe(9);
  });

  it('places spread targets around the reticle', () => {
    const center = new THREE.Vector3(1, 2, -18);
    const targets = createSpreadTargets(center, 1, 7);
    expect(targets).toHaveLength(7);
    expect(targets[0].equals(center)).toBe(true);
    for (const target of targets.slice(1)) expect(target.distanceTo(center)).toBeCloseTo(1);
  });
});

describe('homing', () => {
  it('turns no faster than the turn rate and keeps speed', () => {
    const velocity = new THREE.Vector3(0, 0, -40);
    const steered = steerTowards(velocity, new THREE.Vector3(), new THREE.Vector3(100, 0, 0), 2, 0.1);
    expect(steered.length()).toBeCloseTo(40);
    expect(steered.angleTo(velocity)).toBeCloseTo(0.2);
  });

  it('snaps to the target direction when within the turn budget', () => {
    const steered = steerTowards(new THREE.Vector3(0, 0, -10), new THREE.Vector3(), new THREE.Vector3(0.1, 0, -10), 5, 0.1);
    expect(steered.clone().normalize().x).toBeGreaterThan(0);
  });

  it('only picks targets in front of the origin', () => {
    const behind = { id: 1, position: new THREE.Vector3(0, 0, 5) };
    const ahead = { id: 2, position: new THREE.Vector3(0, 0, -30) };
    expect(nearestTarget(new THREE.Vector3(), [behind, ahead])?.id).toBe(2);
  });
});

describe('chain lightning', () => {
  it('links to nearby targets without repeats', () => {
    const targets = [
      { id: 1, position: new THREE.Vector3(0, 0, -10) },
      { id: 2, position: new THREE.Vector3(5, 0, -12) },
      { id: 3, position: new THREE.Vector3(9, 0, -14) },
      { id: 4, position: new THREE.Vector3(60, 0, -14) },
    ];
    const chain = buildChain(new THREE.Vector3(), targets, 5, 8, 40);
    expect(chain.map((target) => target.id)).toEqual([1, 2, 3]);
  });
});

describe('segment distance', () => {
  it('measures perpendicular and endpoint distance', () => {
    const start = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(0, 0, -10);
    expect(distanceToSegment(new THREE.Vector3(2, 0, -5), start, end)).toBeCloseTo(2);
    expect(distanceToSegment(new THREE.Vector3(0, 0, 3), start, end)).toBeCloseTo(3);
  });
});
