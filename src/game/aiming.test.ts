import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { calculateShotVelocity, createScatterTargets, segmentIntersectsSphere } from './aiming';

describe('shot aiming', () => {
  it('moves a projectile through the visible aim point', () => {
    const start = new THREE.Vector3(-1.2, -0.4, -3.1);
    const target = new THREE.Vector3(2.4, 2.1, -18);
    const speed = 72;
    const velocity = calculateShotVelocity(start, target, speed);
    const travelTime = start.distanceTo(target) / speed;
    const positionAtAimPlane = start.clone().addScaledVector(velocity, travelTime);

    expect(velocity.length()).toBeCloseTo(speed);
    expect(positionAtAimPlane.distanceTo(target)).toBeLessThan(0.000001);
  });

  it('falls back to forward fire when start and target overlap', () => {
    const point = new THREE.Vector3(0, 0, -3);
    expect(calculateShotVelocity(point, point, 50)).toEqual(new THREE.Vector3(0, 0, -50));
  });

  it('detects a meteor crossed between two rendered frames', () => {
    const before = new THREE.Vector3(0, 0, -20);
    const after = new THREE.Vector3(0, 0, -24);
    const meteor = new THREE.Vector3(.7, 0, -22);

    expect(segmentIntersectsSphere(before, after, meteor, 1.2)).toBe(true);
    expect(segmentIntersectsSphere(before, after, meteor, .5)).toBe(false);
  });

  it('keeps one accurate center shot and adds four surrounding shots', () => {
    const center = new THREE.Vector3(2, 3, -18);
    const targets = createScatterTargets(center, .75);

    expect(targets).toHaveLength(5);
    expect(targets[0]).toEqual(center);
    expect(targets.slice(1).map((target) => target.distanceTo(center))).toEqual([.75, .75, .75, .75]);
  });
});
