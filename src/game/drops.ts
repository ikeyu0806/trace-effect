import { GAME_CONFIG, type ItemKind, WEAPON_IDS } from './config';
import type { GameState } from './state';

export interface DropWeight {
  kind: ItemKind;
  weight: number;
}

/**
 * 今の状態に合わせたドロップ表。持っている武器は強化用に出やすく、
 * 満タンのものは出にくくして、取得の価値が下がらないようにする。
 */
export function dropWeights(state: GameState): DropWeight[] {
  const weights: DropWeight[] = WEAPON_IDS.map((kind) => ({
    kind,
    weight: kind === state.weapon ? (state.weaponLevel >= GAME_CONFIG.maxWeaponLevel ? 4 : 14) : 9,
  }));
  weights.push({ kind: 'shield', weight: state.shield ? 3 : 12 });
  weights.push({ kind: 'life', weight: state.lives >= GAME_CONFIG.maxLives ? 1 : state.lives <= 1 ? 8 : 4 });
  weights.push({ kind: 'nova', weight: state.novaStock >= GAME_CONFIG.maxNovaStock ? 2 : 9 });
  weights.push({ kind: 'overdrive', weight: state.overdrive > 0 ? 4 : 10 });
  return weights;
}

/** rollは0以上1未満。テストでは固定値を渡す。 */
export function chooseDrop(state: GameState, roll: number): ItemKind {
  const weights = dropWeights(state);
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0);
  let cursor = Math.min(0.999999, Math.max(0, roll)) * total;
  for (const entry of weights) {
    cursor -= entry.weight;
    if (cursor < 0) return entry.kind;
  }
  return weights[weights.length - 1].kind;
}
