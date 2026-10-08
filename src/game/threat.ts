export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export const THREAT_LOOKAHEAD = 2.6;
export const THREAT_MARGIN = 1.1;

/**
 * 今の速度のまま自機の面（z）へ届いたとき、自機に当たる範囲を通るか。
 * 自機は動くので、余白を足して「避けるべきもの」を早めに知らせる。
 */
export function isThreat(position: Vec3Like, velocity: Vec3Like, radius: number, ship: Vec3Like, shipRadius: number): boolean {
  if (velocity.z <= 0 || position.z > ship.z - 3) return false;
  const time = (ship.z - position.z) / velocity.z;
  if (time > THREAT_LOOKAHEAD) return false;
  const dx = position.x + velocity.x * time - ship.x;
  const dy = position.y + velocity.y * time - ship.y;
  const reach = radius + shipRadius + THREAT_MARGIN;
  return dx * dx + dy * dy < reach * reach;
}
