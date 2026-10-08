/** いまの耐久を、画面上の点の数として数える。端数は「あと1発」と読む。 */
export function remainingPips(hp: number): number {
  if (hp <= 0) return 0;
  return Math.max(1, Math.ceil(hp - 1e-6));
}

export function maxPips(maxHp: number): number {
  return Math.max(1, Math.round(maxHp));
}
