import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from './config';
import { advanceFlight, createGameState, registerCollision, registerCut, type GameState } from './state';

describe('game state', () => {
  it('starts with three lives and no background depth', () => {
    expect(createGameState()).toMatchObject({ phase: 'ready', lives: 3, depth: 0, elapsed: 0 });
  });

  it('caps depth at the configured maximum', () => {
    let state: GameState = { ...createGameState(), phase: 'playing' };
    for (let index = 0; index < 8; index += 1) state = registerCut(state);
    expect(state.depth).toBe(GAME_CONFIG.maxDepth);
  });

  it('never reduces depth below zero', () => {
    const state = registerCollision({ ...createGameState(), phase: 'playing' });
    expect(state).toMatchObject({ depth: 0, lives: 2 });
  });

  it('ends immediately on the third collision', () => {
    let state: GameState = { ...createGameState(), phase: 'playing' };
    state = registerCollision(registerCollision(registerCollision(state)));
    expect(state).toMatchObject({ phase: 'gameover', lives: 0 });
  });

  it('enters approach when the flight duration is reached', () => {
    const state = advanceFlight(
      { ...createGameState(), phase: 'playing', elapsed: GAME_CONFIG.flightDuration - 0.1 },
      0.2,
    );
    expect(state).toMatchObject({ phase: 'approach', elapsed: GAME_CONFIG.flightDuration });
  });
});
