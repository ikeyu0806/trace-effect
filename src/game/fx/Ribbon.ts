import * as THREE from 'three';

/** 点列からカメラへ向いた帯（三角形strip）を作る。雷やtrailのように太さのある線に使う。 */
export function writeRibbon(
  geometry: THREE.BufferGeometry,
  points: readonly THREE.Vector3[],
  width: number,
  cameraPosition: THREE.Vector3,
  taper = 0,
): void {
  const count = points.length;
  let position = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!position || position.count !== count * 2) {
    position = new THREE.BufferAttribute(new Float32Array(count * 2 * 3), 3);
    const along = new Float32Array(count * 2);
    const indices: number[] = [];
    for (let index = 0; index < count; index += 1) {
      along[index * 2] = along[index * 2 + 1] = index / Math.max(1, count - 1);
      if (index < count - 1) {
        const a = index * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geometry.setAttribute('position', position);
    geometry.setAttribute('along', new THREE.BufferAttribute(along, 1));
    geometry.setIndex(indices);
  }
  const tangent = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  const side = new THREE.Vector3();
  for (let index = 0; index < count; index += 1) {
    const point = points[index];
    const previous = points[Math.max(0, index - 1)];
    const next = points[Math.min(count - 1, index + 1)];
    tangent.subVectors(next, previous);
    if (tangent.lengthSq() < 1e-8) tangent.set(0, 0, 1);
    toCamera.subVectors(cameraPosition, point);
    const t = index / Math.max(1, count - 1);
    side.crossVectors(tangent, toCamera).normalize().multiplyScalar(width * 0.5 * (1 - taper * t));
    position.setXYZ(index * 2, point.x + side.x, point.y + side.y, point.z + side.z);
    position.setXYZ(index * 2 + 1, point.x - side.x, point.y - side.y, point.z - side.z);
  }
  position.needsUpdate = true;
  geometry.computeBoundingSphere();
}

/** 2点間を中点変位でギザギザに分割した雷の点列。 */
export function lightningPath(start: THREE.Vector3, end: THREE.Vector3, depth: number, jitter: number): THREE.Vector3[] {
  let points = [start.clone(), end.clone()];
  let amplitude = start.distanceTo(end) * jitter;
  for (let level = 0; level < depth; level += 1) {
    const next: THREE.Vector3[] = [points[0]];
    for (let index = 0; index < points.length - 1; index += 1) {
      const middle = points[index].clone().lerp(points[index + 1], 0.5);
      middle.add(new THREE.Vector3().randomDirection().multiplyScalar(amplitude * (0.4 + Math.random() * 0.6)));
      next.push(middle, points[index + 1]);
    }
    points = next;
    amplitude *= 0.52;
  }
  return points;
}
