import { describe, expect, it } from 'vitest';
import { isThreat } from './threat';

const ship = { x: 0, y: -1.65, z: 0 };

describe('isThreat', () => {
  it('flags a hazard heading straight at the ship', () => {
    expect(isThreat({ x: 0, y: -1.65, z: -60 }, { x: 0, y: 0, z: 30 }, 1, ship, 0.95)).toBe(true);
  });

  it('ignores a hazard that will pass well to the side', () => {
    expect(isThreat({ x: 8, y: -1.65, z: -60 }, { x: 0, y: 0, z: 30 }, 1, ship, 0.95)).toBe(false);
  });

  it('ignores hazards that are still too far away to matter', () => {
    expect(isThreat({ x: 0, y: -1.65, z: -150 }, { x: 0, y: 0, z: 30 }, 1, ship, 0.95)).toBe(false);
  });

  it('ignores hazards that have already reached the ship plane', () => {
    expect(isThreat({ x: 0, y: -1.65, z: -1 }, { x: 0, y: 0, z: 30 }, 1, ship, 0.95)).toBe(false);
  });

  it('accounts for lateral drift toward the ship', () => {
    expect(isThreat({ x: 6, y: -1.65, z: -60 }, { x: -3, y: 0, z: 30 }, 1, ship, 0.95)).toBe(true);
  });
});
