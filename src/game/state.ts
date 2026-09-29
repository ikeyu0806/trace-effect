import { GAME_CONFIG } from './config';

export type GamePhase = 'ready' | 'playing' | 'paused' | 'approach' | 'gameover' | 'complete';

export interface GameState {
  phase: GamePhase;
  lives: number;
  depth: number;
  elapsed: number;
}

export function createGameState(): GameState {
  return { phase: 'ready', lives: GAME_CONFIG.maxLives, depth: 0, elapsed: 0 };
}

export function registerCut(state: GameState): GameState {
  if (state.phase !== 'playing') return state;
  return { ...state, depth: Math.min(GAME_CONFIG.maxDepth, state.depth + 1) };
}

export function registerCollision(state: GameState): GameState {
  if (state.phase !== 'playing') return state;
  const lives = Math.max(0, state.lives - 1);
  return {
    ...state,
    lives,
    depth: Math.max(0, state.depth - 1),
    phase: lives === 0 ? 'gameover' : state.phase,
  };
}

export function advanceFlight(state: GameState, delta: number): GameState {
  if (state.phase !== 'playing') return state;
  const elapsed = Math.min(GAME_CONFIG.flightDuration, state.elapsed + Math.max(0, delta));
  return { ...state, elapsed, phase: elapsed >= GAME_CONFIG.flightDuration ? 'approach' : state.phase };
}
