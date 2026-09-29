import * as THREE from 'three';

export function calculateShotVelocity(start: THREE.Vector3, target: THREE.Vector3, speed: number): THREE.Vector3 {
  const direction = target.clone().sub(start);
  if (direction.lengthSq() === 0) return new THREE.Vector3(0, 0, -speed);
  return direction.normalize().multiplyScalar(speed);
}

export function createScatterTargets(center: THREE.Vector3, spread: number): THREE.Vector3[] {
  return [
    center.clone(),
    center.clone().add(new THREE.Vector3(spread, 0, 0)),
    center.clone().add(new THREE.Vector3(-spread, 0, 0)),
    center.clone().add(new THREE.Vector3(0, spread, 0)),
    center.clone().add(new THREE.Vector3(0, -spread, 0)),
  ];
}

export function segmentIntersectsSphere(
  segmentStart: THREE.Vector3,
  segmentEnd: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
): boolean {
  const segment = segmentEnd.clone().sub(segmentStart);
  const lengthSquared = segment.lengthSq();
  if (lengthSquared === 0) return segmentStart.distanceToSquared(center) <= radius * radius;
  const offset = center.clone().sub(segmentStart);
  const progress = THREE.MathUtils.clamp(offset.dot(segment) / lengthSquared, 0, 1);
  const closestPoint = segmentStart.clone().addScaledVector(segment, progress);
  return closestPoint.distanceToSquared(center) <= radius * radius;
}
