import { describe, expect, it } from 'vitest';
import { ITEM_KINDS } from './config';
import { chooseDrop, dropWeights } from './drops';
import { createGameState } from './state';

describe('item drops', () => {
  it('can drop every item kind', () => {
    const state = createGameState();
    const seen = new Set<string>();
    for (let index = 0; index < 1000; index += 1) seen.add(chooseDrop(state, index / 1000));
    expect([...seen].sort()).toEqual([...ITEM_KINDS].sort());
  });

  it('favours the equipped weapon for upgrades', () => {
    const weights = dropWeights({ ...createGameState(), weapon: 'laser' });
    const laser = weights.find((entry) => entry.kind === 'laser')?.weight ?? 0;
    const homing = weights.find((entry) => entry.kind === 'homing')?.weight ?? 0;
    expect(laser).toBeGreaterThan(homing);
  });

  it('makes extra lives likelier when the player is on the last life', () => {
    const life = (lives: number) => dropWeights({ ...createGameState(), lives }).find((entry) => entry.kind === 'life')?.weight ?? 0;
    expect(life(1)).toBeGreaterThan(life(3));
  });

  it('clamps out-of-range rolls', () => {
    const state = createGameState();
    expect(ITEM_KINDS).toContain(chooseDrop(state, -1));
    expect(ITEM_KINDS).toContain(chooseDrop(state, 2));
  });
});
