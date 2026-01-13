// BoomBuddies Roguelite Progression System
// Shared types and constants for bomber classes, runes, and progression

// ============================================================================
// BOMBER CLASSES
// ============================================================================

export const BOMBER_CLASS = {
  CLASSIC: 'classic',
  SPEEDSTER: 'speedster',
  TANK: 'tank',
  PYROMANIAC: 'pyromaniac',
  TRICKSTER: 'trickster',
  NECROMANCER: 'necromancer',
} as const;

export type BomberClassId = typeof BOMBER_CLASS[keyof typeof BOMBER_CLASS];

export interface BomberClassDefinition {
  id: BomberClassId;
  name: string;
  description: string;
  passive: {
    name: string;
    description: string;
    effect: BomberPassiveEffect;
  };
  ultimate: {
    name: string;
    description: string;
    chargeRequired: number; // Kills/actions needed to charge
    duration: number; // ms the ultimate lasts (0 for instant)
  };
  unlockRequirement: {
    type: 'free' | 'level' | 'wins';
    value: number;
  };
  color: number; // Default class color
}

export type BomberPassiveEffect =
  | { type: 'speed_bonus'; value: number }      // % speed increase
  | { type: 'extra_life'; value: number }       // Survive N extra hits
  | { type: 'fire_range_bonus'; value: number } // +N base fire range
  | { type: 'soul_collector' }                  // Collect souls from kills
  | { type: 'decoy_bombs' };                    // Bombs look normal to enemies

export const BOMBER_CLASSES: Record<BomberClassId, BomberClassDefinition> = {
  [BOMBER_CLASS.CLASSIC]: {
    id: BOMBER_CLASS.CLASSIC,
    name: 'Classic',
    description: 'The original bomber. Balanced stats with a powerful mega bomb ultimate.',
    passive: {
      name: 'Balanced',
      description: 'No special passive - pure skill.',
      effect: { type: 'speed_bonus', value: 0 },
    },
    ultimate: {
      name: 'Mega Bomb',
      description: 'Place a bomb with 3x explosion range.',
      chargeRequired: 3,
      duration: 0,
    },
    unlockRequirement: { type: 'free', value: 0 },
    color: 0xff4444, // Red
  },
  [BOMBER_CLASS.SPEEDSTER]: {
    id: BOMBER_CLASS.SPEEDSTER,
    name: 'Speedster',
    description: 'Lightning fast movement. Control time with your ultimate.',
    passive: {
      name: 'Swift Feet',
      description: '+20% movement speed.',
      effect: { type: 'speed_bonus', value: 20 },
    },
    ultimate: {
      name: 'Time Warp',
      description: 'Freeze all bomb timers for 3 seconds.',
      chargeRequired: 4,
      duration: 3000,
    },
    unlockRequirement: { type: 'level', value: 5 },
    color: 0x44ffff, // Cyan
  },
  [BOMBER_CLASS.TANK]: {
    id: BOMBER_CLASS.TANK,
    name: 'Tank',
    description: 'Tough as nails. Survive what would kill others.',
    passive: {
      name: 'Thick Skin',
      description: 'Survive 1 extra explosion hit.',
      effect: { type: 'extra_life', value: 1 },
    },
    ultimate: {
      name: 'Shield Dome',
      description: 'Block all explosions for 4 seconds.',
      chargeRequired: 4,
      duration: 4000,
    },
    unlockRequirement: { type: 'level', value: 10 },
    color: 0x888888, // Gray
  },
  [BOMBER_CLASS.PYROMANIAC]: {
    id: BOMBER_CLASS.PYROMANIAC,
    name: 'Pyromaniac',
    description: 'Master of fire. Bigger explosions and instant detonation.',
    passive: {
      name: 'Fire Lover',
      description: '+1 base explosion range.',
      effect: { type: 'fire_range_bonus', value: 1 },
    },
    ultimate: {
      name: 'Inferno',
      description: 'All your bombs on the field detonate instantly.',
      chargeRequired: 3,
      duration: 0,
    },
    unlockRequirement: { type: 'wins', value: 50 },
    color: 0xff8844, // Orange
  },
  [BOMBER_CLASS.TRICKSTER]: {
    id: BOMBER_CLASS.TRICKSTER,
    name: 'Trickster',
    description: 'Master of deception. Confuse your enemies.',
    passive: {
      name: 'Camouflage',
      description: 'Your bombs look like normal bombs to enemies.',
      effect: { type: 'decoy_bombs' },
    },
    ultimate: {
      name: 'Decoy Bombs',
      description: 'Place 3 fake bombs that look real but do nothing.',
      chargeRequired: 3,
      duration: 0,
    },
    unlockRequirement: { type: 'level', value: 20 },
    color: 0xff44ff, // Magenta
  },
  [BOMBER_CLASS.NECROMANCER]: {
    id: BOMBER_CLASS.NECROMANCER,
    name: 'Necromancer',
    description: 'Harvest souls from the fallen. Cheat death itself.',
    passive: {
      name: 'Soul Harvest',
      description: 'Collect souls from kills. Souls boost ultimate charge.',
      effect: { type: 'soul_collector' },
    },
    ultimate: {
      name: 'Revive',
      description: 'Return from death with 50% power-ups.',
      chargeRequired: 5,
      duration: 0,
    },
    unlockRequirement: { type: 'level', value: 30 },
    color: 0x8844ff, // Purple
  },
};

// ============================================================================
// RUNES
// ============================================================================

export const RUNE_ID = {
  QUICK_FUSE: 'quick_fuse',
  IRON_BOOTS: 'iron_boots',
  SCAVENGER: 'scavenger',
  LAST_STAND: 'last_stand',
  GHOST_WALK: 'ghost_walk',
  BLAST_SHIELD: 'blast_shield',
  POWER_SURGE: 'power_surge',
  SECOND_WIND: 'second_wind',
  CHAIN_REACTION: 'chain_reaction',
  TACTICAL_RETREAT: 'tactical_retreat',
  BOMB_HOARDER: 'bomb_hoarder',
  FIRE_WALKER: 'fire_walker',
  CURSE_IMMUNITY: 'curse_immunity',
  SOUL_SIPHON: 'soul_siphon',
  MOMENTUM: 'momentum',
} as const;

export type RuneId = typeof RUNE_ID[keyof typeof RUNE_ID];

export interface RuneDefinition {
  id: RuneId;
  name: string;
  description: string;
  effect: RuneEffect;
  unlockLevel: number;
  tier: 1 | 2 | 3; // Rarity/power tier
}

export type RuneEffect =
  | { type: 'bomb_timer_reduction'; value: number }     // ms faster detonation
  | { type: 'curse_immunity_first' }                     // Immune to first curse
  | { type: 'powerup_spawn_bonus'; value: number }       // % more power-ups near you
  | { type: 'low_power_bomb_bonus'; value: number }      // +N bombs when low on power-ups
  | { type: 'phase_through_bomb'; uses: number }         // Walk through N bombs per life
  | { type: 'explosion_damage_reduction'; value: number }// % damage reduction from explosions
  | { type: 'starting_power'; bombs: number; range: number } // Start with extra stats
  | { type: 'revive_once'; healthPercent: number }       // Auto-revive once at X% power
  | { type: 'chain_explosion_chance'; value: number }    // % chance explosions chain
  | { type: 'speed_boost_on_damage' }                    // Speed boost when hit
  | { type: 'extra_bomb_capacity'; value: number }       // +N max bomb slots
  | { type: 'explosion_immunity_brief'; duration: number }// Brief immunity after placing bomb
  | { type: 'full_curse_immunity' }                      // Complete curse immunity
  | { type: 'soul_on_powerup' }                          // Gain soul when collecting power-up
  | { type: 'speed_per_kill'; value: number };           // +N% speed per kill (stacks)

export const RUNES: Record<RuneId, RuneDefinition> = {
  [RUNE_ID.QUICK_FUSE]: {
    id: RUNE_ID.QUICK_FUSE,
    name: 'Quick Fuse',
    description: 'Bombs detonate 0.5 seconds faster.',
    effect: { type: 'bomb_timer_reduction', value: 500 },
    unlockLevel: 3,
    tier: 1,
  },
  [RUNE_ID.IRON_BOOTS]: {
    id: RUNE_ID.IRON_BOOTS,
    name: 'Iron Boots',
    description: 'Immune to your first curse each match.',
    effect: { type: 'curse_immunity_first' },
    unlockLevel: 7,
    tier: 1,
  },
  [RUNE_ID.SCAVENGER]: {
    id: RUNE_ID.SCAVENGER,
    name: 'Scavenger',
    description: '25% more power-ups spawn near you.',
    effect: { type: 'powerup_spawn_bonus', value: 25 },
    unlockLevel: 12,
    tier: 2,
  },
  [RUNE_ID.LAST_STAND]: {
    id: RUNE_ID.LAST_STAND,
    name: 'Last Stand',
    description: '+1 bomb capacity when you have 2 or fewer power-ups.',
    effect: { type: 'low_power_bomb_bonus', value: 1 },
    unlockLevel: 15,
    tier: 2,
  },
  [RUNE_ID.GHOST_WALK]: {
    id: RUNE_ID.GHOST_WALK,
    name: 'Ghost Walk',
    description: 'Phase through 1 bomb per life.',
    effect: { type: 'phase_through_bomb', uses: 1 },
    unlockLevel: 18,
    tier: 2,
  },
  [RUNE_ID.BLAST_SHIELD]: {
    id: RUNE_ID.BLAST_SHIELD,
    name: 'Blast Shield',
    description: '15% damage reduction from explosions.',
    effect: { type: 'explosion_damage_reduction', value: 15 },
    unlockLevel: 8,
    tier: 1,
  },
  [RUNE_ID.POWER_SURGE]: {
    id: RUNE_ID.POWER_SURGE,
    name: 'Power Surge',
    description: 'Start each match with +1 bomb and +1 range.',
    effect: { type: 'starting_power', bombs: 1, range: 1 },
    unlockLevel: 22,
    tier: 3,
  },
  [RUNE_ID.SECOND_WIND]: {
    id: RUNE_ID.SECOND_WIND,
    name: 'Second Wind',
    description: 'Auto-revive once per match with 50% power-ups.',
    effect: { type: 'revive_once', healthPercent: 50 },
    unlockLevel: 28,
    tier: 3,
  },
  [RUNE_ID.CHAIN_REACTION]: {
    id: RUNE_ID.CHAIN_REACTION,
    name: 'Chain Reaction',
    description: '10% chance your explosions trigger nearby bombs.',
    effect: { type: 'chain_explosion_chance', value: 10 },
    unlockLevel: 25,
    tier: 2,
  },
  [RUNE_ID.TACTICAL_RETREAT]: {
    id: RUNE_ID.TACTICAL_RETREAT,
    name: 'Tactical Retreat',
    description: 'Gain a brief speed boost when damaged.',
    effect: { type: 'speed_boost_on_damage' },
    unlockLevel: 10,
    tier: 1,
  },
  [RUNE_ID.BOMB_HOARDER]: {
    id: RUNE_ID.BOMB_HOARDER,
    name: 'Bomb Hoarder',
    description: '+2 maximum bomb capacity.',
    effect: { type: 'extra_bomb_capacity', value: 2 },
    unlockLevel: 20,
    tier: 2,
  },
  [RUNE_ID.FIRE_WALKER]: {
    id: RUNE_ID.FIRE_WALKER,
    name: 'Fire Walker',
    description: 'Brief explosion immunity after placing a bomb.',
    effect: { type: 'explosion_immunity_brief', duration: 500 },
    unlockLevel: 16,
    tier: 2,
  },
  [RUNE_ID.CURSE_IMMUNITY]: {
    id: RUNE_ID.CURSE_IMMUNITY,
    name: 'Curse Immunity',
    description: 'Complete immunity to all curses.',
    effect: { type: 'full_curse_immunity' },
    unlockLevel: 35,
    tier: 3,
  },
  [RUNE_ID.SOUL_SIPHON]: {
    id: RUNE_ID.SOUL_SIPHON,
    name: 'Soul Siphon',
    description: 'Gain a soul when collecting any power-up.',
    effect: { type: 'soul_on_powerup' },
    unlockLevel: 30,
    tier: 3,
  },
  [RUNE_ID.MOMENTUM]: {
    id: RUNE_ID.MOMENTUM,
    name: 'Momentum',
    description: '+5% speed per kill this match (stacks up to 25%).',
    effect: { type: 'speed_per_kill', value: 5 },
    unlockLevel: 14,
    tier: 2,
  },
};

// ============================================================================
// PROGRESSION CONSTANTS
// ============================================================================

export const PROGRESSION_CONFIG = {
  // XP Requirements per level (exponential curve)
  XP_BASE: 100,           // XP for level 1
  XP_MULTIPLIER: 1.15,    // Each level requires 15% more XP
  MAX_LEVEL: 50,

  // Fame ranks (cumulative fame thresholds)
  FAME_RANKS: {
    WOOD: { min: 0, max: 499, name: 'Wood', color: 0x8B4513 },
    BRONZE: { min: 500, max: 999, name: 'Bronze', color: 0xCD7F32 },
    SILVER: { min: 1000, max: 1999, name: 'Silver', color: 0xC0C0C0 },
    GOLD: { min: 2000, max: 3499, name: 'Gold', color: 0xFFD700 },
    PLATINUM: { min: 3500, max: 4999, name: 'Platinum', color: 0xE5E4E2 },
    DIAMOND: { min: 5000, max: Infinity, name: 'Diamond', color: 0xB9F2FF },
  },

  // Match rewards
  MATCH_REWARDS: {
    PARTICIPATION: 10,     // Just for playing
    WIN_BONUS: 40,         // Additional for winning
    KILL_XP: 5,            // XP per kill
    PLACEMENT: {           // Fame rewards by placement
      1: 100,
      2: 60,
      3: 30,
      4: 15,
      5: 10,
      6: 5,
      7: 3,
      8: 1,
    } as Record<number, number>,
    KILL_FAME: 10,         // Fame per kill
    FIRST_WIN_WITH_CLASS: 50,  // Bonus fame for first win with each class
    FIRST_PLACE_WITH_CLASS: 100, // Bonus fame for first 1st place with each class
  },

  // Currency
  COINS_PER_MATCH_BASE: 10,
  COINS_PER_KILL: 5,
  COINS_WIN_BONUS: 25,

  // Rune slots (unlock at levels)
  RUNE_SLOTS: {
    1: 1,   // Level 1: 1 rune slot
    10: 2,  // Level 10: 2 rune slots
    25: 3,  // Level 25: 3 rune slots
  } as Record<number, number>,

  // Daily quests
  DAILY_QUEST_COUNT: 3,
  DAILY_QUEST_REFRESH_HOURS: 24,
} as const;

// Calculate XP required for a specific level
export function getXPForLevel(level: number): number {
  if (level <= 1) return 0;
  const { XP_BASE, XP_MULTIPLIER } = PROGRESSION_CONFIG;
  return Math.floor(XP_BASE * Math.pow(XP_MULTIPLIER, level - 1));
}

// Calculate total XP required to reach a level
export function getTotalXPForLevel(level: number): number {
  let total = 0;
  for (let i = 1; i <= level; i++) {
    total += getXPForLevel(i);
  }
  return total;
}

// Get level from total XP
export function getLevelFromXP(totalXP: number): number {
  let level = 1;
  let xpRequired = 0;
  while (level < PROGRESSION_CONFIG.MAX_LEVEL) {
    xpRequired += getXPForLevel(level + 1);
    if (totalXP < xpRequired) break;
    level++;
  }
  return level;
}

// Get fame rank from total fame
export function getFameRank(fame: number): { id: string; name: string; color: number; progress: number } {
  const ranks = PROGRESSION_CONFIG.FAME_RANKS;
  for (const [id, rank] of Object.entries(ranks)) {
    if (fame >= rank.min && fame <= rank.max) {
      const progress = rank.max === Infinity
        ? 1
        : (fame - rank.min) / (rank.max - rank.min + 1);
      return { id, name: rank.name, color: rank.color, progress };
    }
  }
  return { id: 'WOOD', name: 'Wood', color: ranks.WOOD.color, progress: 0 };
}

// Get available rune slots for a level
export function getRuneSlotsForLevel(level: number): number {
  let slots = 0;
  for (const [lvl, slotCount] of Object.entries(PROGRESSION_CONFIG.RUNE_SLOTS)) {
    if (level >= parseInt(lvl)) {
      slots = slotCount;
    }
  }
  return slots;
}

// Check if a bomber class is unlocked
export function isBomberUnlocked(
  classId: BomberClassId,
  playerLevel: number,
  playerWins: number
): boolean {
  // TESTING: All classes unlocked for testing
  return true;

  // Original unlock logic (restore after testing):
  // const classDef = BOMBER_CLASSES[classId];
  // if (!classDef) return false;
  //
  // const req = classDef.unlockRequirement;
  // switch (req.type) {
  //   case 'free': return true;
  //   case 'level': return playerLevel >= req.value;
  //   case 'wins': return playerWins >= req.value;
  //   default: return false;
  // }
}

// Check if a rune is unlocked
export function isRuneUnlocked(runeId: RuneId, playerLevel: number): boolean {
  // TESTING: All runes unlocked for testing
  return true;

  // Original logic:
  // const rune = RUNES[runeId];
  return rune ? playerLevel >= rune.unlockLevel : false;
}

// ============================================================================
// PLAYER PROFILE
// ============================================================================

export interface PlayerProfile {
  odId: string;           // GameBuddies user ID (or local ID)

  // Progression
  xp: number;
  level: number;
  fame: number;

  // Currency
  coins: number;
  gems: number;
  souls: number;          // Necromancer-specific currency

  // Unlocks
  unlockedBombers: BomberClassId[];
  unlockedRunes: RuneId[];

  // Loadout
  selectedBomber: BomberClassId;
  equippedRunes: (RuneId | null)[]; // Up to 3 slots

  // Stats
  stats: {
    totalMatches: number;
    totalWins: number;
    totalKills: number;
    totalDeaths: number;
    firstPlaceCount: number;
    classFirstWins: Partial<Record<BomberClassId, boolean>>;
    classFirstPlaces: Partial<Record<BomberClassId, boolean>>;
  };

  // Daily quests (stored separately)
  lastDailyRefresh: number; // Timestamp

  // Timestamps
  createdAt: number;
  lastPlayedAt: number;
}

export function createDefaultPlayerProfile(odId: string): PlayerProfile {
  return {
    odId,
    xp: 0,
    level: 1,
    fame: 0,
    coins: 0,
    gems: 0,
    souls: 0,
    unlockedBombers: [BOMBER_CLASS.CLASSIC],
    unlockedRunes: [],
    selectedBomber: BOMBER_CLASS.CLASSIC,
    equippedRunes: [null, null, null],
    stats: {
      totalMatches: 0,
      totalWins: 0,
      totalKills: 0,
      totalDeaths: 0,
      firstPlaceCount: 0,
      classFirstWins: {},
      classFirstPlaces: {},
    },
    lastDailyRefresh: 0,
    createdAt: Date.now(),
    lastPlayedAt: Date.now(),
  };
}

// ============================================================================
// MATCH RESULT
// ============================================================================

export interface MatchResult {
  odId: string;
  placement: number;
  kills: number;
  deaths: number;
  bomberClass: BomberClassId;
  matchDuration: number; // ms
  gameMode: 'pvp' | 'pve';
}

export interface MatchRewards {
  xpGained: number;
  fameGained: number;
  coinsGained: number;
  soulsGained: number;
  leveledUp: boolean;
  newLevel: number;
  newUnlocks: {
    bombers: BomberClassId[];
    runes: RuneId[];
  };
  bonuses: {
    firstWinWithClass: boolean;
    firstPlaceWithClass: boolean;
  };
}

// Calculate rewards for a match
export function calculateMatchRewards(
  profile: PlayerProfile,
  result: MatchResult
): MatchRewards {
  const config = PROGRESSION_CONFIG.MATCH_REWARDS;

  let xp = config.PARTICIPATION;
  let fame = 0;
  let coins = PROGRESSION_CONFIG.COINS_PER_MATCH_BASE;
  let souls = 0;

  // Kill rewards
  xp += result.kills * config.KILL_XP;
  fame += result.kills * config.KILL_FAME;
  coins += result.kills * PROGRESSION_CONFIG.COINS_PER_KILL;

  // Necromancer gets souls for kills
  if (result.bomberClass === BOMBER_CLASS.NECROMANCER) {
    souls += result.kills;
  }

  // Placement rewards
  const placementFame = config.PLACEMENT[result.placement] || 0;
  fame += placementFame;

  // Win bonus
  if (result.placement === 1) {
    xp += config.WIN_BONUS;
    coins += PROGRESSION_CONFIG.COINS_WIN_BONUS;
  }

  // First win/place with class bonuses
  const bonuses = { firstWinWithClass: false, firstPlaceWithClass: false };

  if (result.placement <= 3 && !profile.stats.classFirstWins[result.bomberClass]) {
    fame += config.FIRST_WIN_WITH_CLASS;
    bonuses.firstWinWithClass = true;
  }

  if (result.placement === 1 && !profile.stats.classFirstPlaces[result.bomberClass]) {
    fame += config.FIRST_PLACE_WITH_CLASS;
    bonuses.firstPlaceWithClass = true;
  }

  // Calculate level up
  const newTotalXP = profile.xp + xp;
  const newLevel = getLevelFromXP(newTotalXP);
  const leveledUp = newLevel > profile.level;

  // Check for new unlocks at new level
  const newUnlocks: MatchRewards['newUnlocks'] = { bombers: [], runes: [] };

  if (leveledUp) {
    // Check bomber unlocks
    for (const classId of Object.keys(BOMBER_CLASSES) as BomberClassId[]) {
      const wasUnlocked = isBomberUnlocked(classId, profile.level, profile.stats.totalWins);
      const nowUnlocked = isBomberUnlocked(classId, newLevel, profile.stats.totalWins + (result.placement === 1 ? 1 : 0));
      if (!wasUnlocked && nowUnlocked && !profile.unlockedBombers.includes(classId)) {
        newUnlocks.bombers.push(classId);
      }
    }

    // Check rune unlocks
    for (const runeId of Object.keys(RUNES) as RuneId[]) {
      const wasUnlocked = isRuneUnlocked(runeId, profile.level);
      const nowUnlocked = isRuneUnlocked(runeId, newLevel);
      if (!wasUnlocked && nowUnlocked && !profile.unlockedRunes.includes(runeId)) {
        newUnlocks.runes.push(runeId);
      }
    }
  }

  return {
    xpGained: xp,
    fameGained: fame,
    coinsGained: coins,
    soulsGained: souls,
    leveledUp,
    newLevel,
    newUnlocks,
    bonuses,
  };
}

// Apply rewards to profile (mutates profile)
export function applyMatchRewards(
  profile: PlayerProfile,
  result: MatchResult,
  rewards: MatchRewards
): void {
  // Apply currencies
  profile.xp += rewards.xpGained;
  profile.fame += rewards.fameGained;
  profile.coins += rewards.coinsGained;
  profile.souls += rewards.soulsGained;
  profile.level = rewards.newLevel;

  // Update stats
  profile.stats.totalMatches++;
  profile.stats.totalKills += result.kills;
  profile.stats.totalDeaths += result.deaths;

  if (result.placement === 1) {
    profile.stats.totalWins++;
    profile.stats.firstPlaceCount++;
  }

  if (rewards.bonuses.firstWinWithClass) {
    profile.stats.classFirstWins[result.bomberClass] = true;
  }
  if (rewards.bonuses.firstPlaceWithClass) {
    profile.stats.classFirstPlaces[result.bomberClass] = true;
  }

  // Apply unlocks
  for (const classId of rewards.newUnlocks.bombers) {
    if (!profile.unlockedBombers.includes(classId)) {
      profile.unlockedBombers.push(classId);
    }
  }
  for (const runeId of rewards.newUnlocks.runes) {
    if (!profile.unlockedRunes.includes(runeId)) {
      profile.unlockedRunes.push(runeId);
    }
  }

  profile.lastPlayedAt = Date.now();
}
