import * as THREE from 'three';
import type { Hazard } from './Hazards';
import { isThreat } from './threat';

/** 自機へ向かってくる隕石・デブリを赤い警告枠で囲み、取得アイテムと見分けやすくする。 */
export class ThreatMarkers {
  private readonly pool: HTMLElement[] = [];
  private readonly center = new THREE.Vector3();
  private readonly edge = new THREE.Vector3();

  constructor(private readonly layer: HTMLElement) {}

  update(hazards: readonly Hazard[], ship: THREE.Vector3, shipRadius: number, camera: THREE.Camera, width: number, height: number): void {
    let used = 0;
    for (const hazard of hazards) {
      if (hazard.hp <= 0 || !isThreat(hazard.position, hazard.velocity, hazard.radius, ship, shipRadius)) continue;
      this.center.copy(hazard.position).project(camera);
      if (this.center.z >= 1) continue;
      this.edge.copy(hazard.position);
      this.edge.y += hazard.radius;
      this.edge.project(camera);
      const size = THREE.MathUtils.clamp((this.edge.y - this.center.y) * height * 1.1, 30, 220);
      const x = (this.center.x * 0.5 + 0.5) * width;
      const y = (-this.center.y * 0.5 + 0.5) * height;
      const marker = this.marker(used);
      marker.style.setProperty('--size', `${size.toFixed(1)}px`);
      marker.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      used += 1;
    }
    for (let index = used; index < this.pool.length; index += 1) this.pool[index].hidden = true;
  }

  clear(): void {
    for (const marker of this.pool) marker.hidden = true;
  }

  private marker(index: number): HTMLElement {
    let marker = this.pool[index];
    if (!marker) {
      marker = document.createElement('span');
      marker.className = 'threat-marker';
      this.layer.append(marker);
      this.pool.push(marker);
    }
    marker.hidden = false;
    return marker;
  }
}
