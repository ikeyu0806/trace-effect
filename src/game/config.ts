export const GAME_CONFIG = {
  flightDuration: 90,
  startLives: 3,
  maxLives: 5,
  maxDepth: 4,
  maxNovaStock: 3,
  maxWeaponLevel: 3,
  hitStopDuration: 0.04,
  invulnerableAfterHit: 2.4,
  invulnerableAfterShieldBreak: 1,
  invulnerableAfterNova: 1.5,
  overdriveDuration: 8,
  comboWindow: 2,
  comboStep: 5,
  maxComboMultiplier: 4,
  extendScores: [20000, 50000],
  extendEvery: 50000,
  spawnZ: -150,
  spawnIntervalStart: 1.1,
  spawnIntervalEnd: 0.5,
  maxHazardsStart: 4,
  maxHazardsEnd: 9,
  crystalInterval: 11,
  debrisItemChance: 0.25,
  hazardSpeedStart: 30,
  hazardSpeedEnd: 42,
  projectileSpeed: 78,
  scatterSpread: .75,
  fieldWidth: 13,
  fieldMinY: -2.5,
  fieldMaxY: 2.7,
  keyboardMoveSpeed: 10,
  keyboardMoveSpeedY: 7.5,
  shipHitRadius: 0.95,
  itemMagnetRadius: 6,
  itemPickupRadius: 1.9,
} as const;

export type WeaponId = 'spread' | 'homing' | 'laser' | 'wave' | 'chain';
export type SupportItemId = 'shield' | 'life' | 'nova' | 'overdrive';
export type ItemKind = WeaponId | SupportItemId;

export const WEAPON_IDS: readonly WeaponId[] = ['spread', 'homing', 'laser', 'wave', 'chain'];
export const ITEM_KINDS: readonly ItemKind[] = [...WEAPON_IDS, 'shield', 'life', 'nova', 'overdrive'];

export interface ItemPresentation {
  label: string;
  symbol: string;
  color: number;
}

export const ITEM_PRESENTATION: Record<ItemKind, ItemPresentation> = {
  spread: { label: 'SPREAD', symbol: 'S', color: 0x5fe8ff },
  homing: { label: 'HOMING', symbol: 'H', color: 0xff8a2a },
  laser: { label: 'LASER', symbol: 'L', color: 0xff3fd2 },
  wave: { label: 'WAVE', symbol: 'W', color: 0x4dffa0 },
  chain: { label: 'THUNDER', symbol: 'T', color: 0xffe14a },
  shield: { label: 'SHIELD', symbol: '◇', color: 0x4f8dff },
  life: { label: '1UP', symbol: '+', color: 0xb6ffcf },
  nova: { label: 'NOVA', symbol: 'N', color: 0xff3a3a },
  overdrive: { label: 'OVERDRIVE', symbol: 'O', color: 0xffc24a },
};

export type HazardKind = 'asteroidSmall' | 'asteroidMedium' | 'asteroidLarge' | 'crystal' | 'debris';

export interface HazardStats {
  hp: number;
  radius: number;
  points: number;
}

export const HAZARD_STATS: Record<HazardKind, HazardStats> = {
  asteroidSmall: { hp: 2, radius: 1.05, points: 100 },
  asteroidMedium: { hp: 4, radius: 1.65, points: 200 },
  asteroidLarge: { hp: 9, radius: 2.6, points: 400 },
  crystal: { hp: 6, radius: 1.6, points: 500 },
  debris: { hp: 5, radius: 1.7, points: 300 },
};
