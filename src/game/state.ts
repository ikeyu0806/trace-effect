import { GAME_CONFIG, type ItemKind, type WeaponId, WEAPON_IDS } from './config';

export type GamePhase = 'ready' | 'playing' | 'paused' | 'approach' | 'gameover' | 'complete';

export interface GameState {
  phase: GamePhase;
  lives: number;
  depth: number;
  elapsed: number;
  score: number;
  combo: number;
  comboTimer: number;
  weapon: WeaponId;
  weaponLevel: number;
  shield: boolean;
  novaStock: number;
  overdrive: number;
  invulnerable: number;
  extendsAwarded: number;
  kills: number;
}

export type CollisionOutcome = 'ignored' | 'shieldBroken' | 'lifeLost' | 'gameover';

export function createGameState(): GameState {
  return {
    phase: 'ready',
    lives: GAME_CONFIG.startLives,
    depth: 0,
    elapsed: 0,
    score: 0,
    combo: 0,
    comboTimer: 0,
    weapon: 'spread',
    weaponLevel: 1,
    shield: false,
    novaStock: 1,
    overdrive: 0,
    invulnerable: 0,
    extendsAwarded: 0,
    kills: 0,
  };
}

export function comboMultiplier(combo: number): number {
  return Math.min(GAME_CONFIG.maxComboMultiplier, 1 + Math.floor(combo / GAME_CONFIG.comboStep) * 0.5);
}

export function extendThreshold(index: number): number {
  const fixed = GAME_CONFIG.extendScores;
  if (index < fixed.length) return fixed[index];
  return fixed[fixed.length - 1] + (index - fixed.length + 1) * GAME_CONFIG.extendEvery;
}

function awardScore(state: GameState, points: number): GameState {
  let { lives, extendsAwarded } = state;
  const score = state.score + points;
  while (score >= extendThreshold(extendsAwarded)) {
    extendsAwarded += 1;
    lives = Math.min(GAME_CONFIG.maxLives, lives + 1);
  }
  return { ...state, score, lives, extendsAwarded };
}

export function registerCut(state: GameState, basePoints = 100): GameState {
  if (state.phase !== 'playing') return state;
  const combo = state.combo + 1;
  const points = Math.round(basePoints * comboMultiplier(combo));
  return awardScore(
    {
      ...state,
      depth: Math.min(GAME_CONFIG.maxDepth, state.depth + 1),
      combo,
      comboTimer: GAME_CONFIG.comboWindow,
      kills: state.kills + 1,
    },
    points,
  );
}

export function resolveCollision(state: GameState): { state: GameState; outcome: CollisionOutcome } {
  if (state.phase !== 'playing' || state.invulnerable > 0) return { state, outcome: 'ignored' };
  if (state.shield) {
    return {
      state: { ...state, shield: false, invulnerable: GAME_CONFIG.invulnerableAfterShieldBreak },
      outcome: 'shieldBroken',
    };
  }
  const lives = Math.max(0, state.lives - 1);
  const droppedLevel = state.weaponLevel - 1;
  const next: GameState = {
    ...state,
    lives,
    depth: Math.max(0, state.depth - 1),
    weapon: droppedLevel <= 0 ? 'spread' : state.weapon,
    weaponLevel: Math.max(1, droppedLevel),
    combo: 0,
    comboTimer: 0,
    overdrive: 0,
    invulnerable: GAME_CONFIG.invulnerableAfterHit,
    phase: lives === 0 ? 'gameover' : state.phase,
  };
  return { state: next, outcome: lives === 0 ? 'gameover' : 'lifeLost' };
}

export function registerCollision(state: GameState): GameState {
  return resolveCollision(state).state;
}

function isWeapon(kind: ItemKind): kind is WeaponId {
  return (WEAPON_IDS as readonly string[]).includes(kind);
}

export function collectItem(state: GameState, kind: ItemKind): GameState {
  if (state.phase !== 'playing') return state;
  if (isWeapon(kind)) {
    if (kind === state.weapon) {
      if (state.weaponLevel >= GAME_CONFIG.maxWeaponLevel) return awardScore(state, 1000);
      return { ...state, weaponLevel: state.weaponLevel + 1 };
    }
    return { ...state, weapon: kind };
  }
  switch (kind) {
    case 'shield':
      return state.shield ? awardScore(state, 500) : { ...state, shield: true };
    case 'life':
      return state.lives >= GAME_CONFIG.maxLives ? awardScore(state, 2000) : { ...state, lives: state.lives + 1 };
    case 'nova':
      return state.novaStock >= GAME_CONFIG.maxNovaStock
        ? awardScore(state, 1000)
        : { ...state, novaStock: state.novaStock + 1 };
    case 'overdrive':
      return { ...state, overdrive: GAME_CONFIG.overdriveDuration };
  }
}

export function consumeNova(state: GameState): GameState | null {
  if (state.phase !== 'playing' || state.novaStock <= 0) return null;
  return {
    ...state,
    novaStock: state.novaStock - 1,
    invulnerable: Math.max(state.invulnerable, GAME_CONFIG.invulnerableAfterNova),
  };
}

export function advanceFlight(state: GameState, delta: number): GameState {
  if (state.phase !== 'playing') return state;
  const step = Math.max(0, delta);
  const elapsed = Math.min(GAME_CONFIG.flightDuration, state.elapsed + step);
  const comboTimer = Math.max(0, state.comboTimer - step);
  return {
    ...state,
    elapsed,
    comboTimer,
    combo: comboTimer > 0 ? state.combo : 0,
    overdrive: Math.max(0, state.overdrive - step),
    invulnerable: Math.max(0, state.invulnerable - step),
    phase: elapsed >= GAME_CONFIG.flightDuration ? 'approach' : state.phase,
  };
}

export function flightIntensity(elapsed: number): number {
  return Math.min(1, Math.max(0, elapsed / GAME_CONFIG.flightDuration));
}
