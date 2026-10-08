import { describe, expect, it } from 'vitest';
import { sampleJourney } from './journey';

describe('sampleJourney', () => {
  it('starts above the ring plane with the gas giant nearby', () => {
    const look = sampleJourney(0);
    expect(look.id).toBe('rings');
    expect(look.destination).toContain('RINGS');
    expect(look.gasGiant.z).toBeGreaterThan(-600);
    expect(look.planeOpacity).toBeGreaterThan(0.25);
  });

  it('passes the ice moon, then a denser asteroid belt', () => {
    expect(sampleJourney(0.28).id).toBe('ice');
    expect(sampleJourney(0.5).id).toBe('belt');
    expect(sampleJourney(0.5).sceneryDensity).toBeGreaterThan(sampleJourney(0.28).sceneryDensity);
  });

  it('fills the sky with nebula before the destination star', () => {
    expect(sampleJourney(0.72).id).toBe('nebula');
    expect(sampleJourney(0.72).nebula).toBeGreaterThan(0.7);
    expect(sampleJourney(0.96).id).toBe('approach');
    expect(sampleJourney(0.96).destination).toContain('STELLAR');
  });

  it('sends both planets far behind by the final approach', () => {
    expect(sampleJourney(1).gasGiant.z).toBeLessThan(sampleJourney(0).gasGiant.z);
    expect(sampleJourney(1).icePlanet.z).toBeLessThan(sampleJourney(0.28).icePlanet.z);
    expect(sampleJourney(1).planeOpacity).toBeLessThan(0.15);
  });
});
