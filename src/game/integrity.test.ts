import { describe, expect, it } from 'vitest';
import { maxPips, remainingPips } from './integrity';

describe('integrity pips', () => {
  it('shows one pip per hit point while intact', () => {
    expect(maxPips(2)).toBe(2);
    expect(maxPips(9)).toBe(9);
    expect(remainingPips(4)).toBe(4);
  });

  it('keeps a last pip until the hazard is actually destroyed', () => {
    expect(remainingPips(0.2)).toBe(1);
    expect(remainingPips(0)).toBe(0);
  });

  it('drops a pip as soon as a whole hit is spent', () => {
    expect(remainingPips(2.2)).toBe(3);
    expect(remainingPips(2)).toBe(2);
  });
});
