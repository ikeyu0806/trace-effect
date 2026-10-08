import { describe, expect, it } from 'vitest';
import { GAME_CONFIG } from './config';
import {
  advanceFlight,
  collectItem,
  comboMultiplier,
  consumeNova,
  createGameState,
  extendThreshold,
  registerCollision,
  registerCut,
  resolveCollision,
  type GameState,
} from './state';

const playing = (overrides: Partial<GameState> = {}): GameState => ({ ...createGameState(), phase: 'playing', ...overrides });

describe('game state', () => {
  it('starts with three lives, spread weapon and one nova', () => {
    expect(createGameState()).toMatchObject({ phase: 'ready', lives: 3, depth: 0, elapsed: 0, weapon: 'spread', weaponLevel: 1, novaStock: 1 });
  });

  it('caps depth at the configured maximum', () => {
    let state = playing();
    for (let index = 0; index < 8; index += 1) state = registerCut(state);
    expect(state.depth).toBe(GAME_CONFIG.maxDepth);
  });

  it('never reduces depth below zero', () => {
    expect(registerCollision(playing())).toMatchObject({ depth: 0, lives: 2 });
  });

  it('ends on the third unprotected collision', () => {
    let state = playing();
    for (let index = 0; index < 3; index += 1) state = registerCollision({ ...state, invulnerable: 0 });
    expect(state).toMatchObject({ phase: 'gameover', lives: 0 });
  });

  it('ignores collisions while invulnerable', () => {
    const { state, outcome } = resolveCollision(playing({ invulnerable: 1 }));
    expect(outcome).toBe('ignored');
    expect(state.lives).toBe(3);
  });

  it('breaks the shield instead of losing a life', () => {
    const { state, outcome } = resolveCollision(playing({ shield: true }));
    expect(outcome).toBe('shieldBroken');
    expect(state).toMatchObject({ shield: false, lives: 3, invulnerable: GAME_CONFIG.invulnerableAfterShieldBreak });
  });

  it('drops a weapon level on hit and falls back to spread at level one', () => {
    const hitOnce = registerCollision(playing({ weapon: 'laser', weaponLevel: 2 }));
    expect(hitOnce).toMatchObject({ weapon: 'laser', weaponLevel: 1 });
    const hitTwice = registerCollision({ ...hitOnce, invulnerable: 0 });
    expect(hitTwice).toMatchObject({ weapon: 'spread', weaponLevel: 1 });
  });

  it('enters approach when the flight duration is reached', () => {
    const state = advanceFlight(playing({ elapsed: GAME_CONFIG.flightDuration - 0.1 }), 0.2);
    expect(state).toMatchObject({ phase: 'approach', elapsed: GAME_CONFIG.flightDuration });
  });

  it('expires combo and timers over time', () => {
    const state = advanceFlight(playing({ combo: 6, comboTimer: 0.5, overdrive: 1, invulnerable: 0.2 }), 0.6);
    expect(state).toMatchObject({ combo: 0, comboTimer: 0, overdrive: 0.4, invulnerable: 0 });
  });
});

describe('scoring', () => {
  it('raises the multiplier every five combo and caps it', () => {
    expect(comboMultiplier(1)).toBe(1);
    expect(comboMultiplier(5)).toBe(1.5);
    expect(comboMultiplier(100)).toBe(GAME_CONFIG.maxComboMultiplier);
  });

  it('awards an extra life at score thresholds', () => {
    expect(extendThreshold(0)).toBe(20000);
    expect(extendThreshold(2)).toBe(100000);
    const state = registerCut(playing({ score: 19950, lives: 2 }), 100);
    expect(state).toMatchObject({ lives: 3, extendsAwarded: 1 });
  });
});

describe('items', () => {
  it('switches weapon keeping level, and levels up on the same weapon', () => {
    const switched = collectItem(playing({ weaponLevel: 2 }), 'homing');
    expect(switched).toMatchObject({ weapon: 'homing', weaponLevel: 2 });
    const levelled = collectItem(switched, 'homing');
    expect(levelled.weaponLevel).toBe(3);
    const capped = collectItem(levelled, 'homing');
    expect(capped).toMatchObject({ weaponLevel: 3, score: 1000 });
  });

  it('applies shield, life, nova and overdrive with caps', () => {
    expect(collectItem(playing(), 'shield').shield).toBe(true);
    expect(collectItem(playing({ lives: GAME_CONFIG.maxLives }), 'life')).toMatchObject({ lives: GAME_CONFIG.maxLives, score: 2000 });
    expect(collectItem(playing(), 'nova').novaStock).toBe(2);
    expect(collectItem(playing(), 'overdrive').overdrive).toBe(GAME_CONFIG.overdriveDuration);
  });

  it('consumes nova only when stocked', () => {
    expect(consumeNova(playing({ novaStock: 0 }))).toBeNull();
    expect(consumeNova(playing())).toMatchObject({ novaStock: 0, invulnerable: GAME_CONFIG.invulnerableAfterNova });
  });
});
