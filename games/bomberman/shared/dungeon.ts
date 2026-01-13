/**
 * Dungeon/PvE Mode Types and Constants
 *
 * Defines the roguelite dungeon crawl mode:
 * - 5 floors with increasing difficulty
 * - Procedural room generation
 * - AI enemy bombers with different behaviors
 * - Boss encounters on floors 3 and 5
 * - Power-ups carry between floors
 */

// ============================================================================
// DUNGEON CONFIGURATION
// ============================================================================

export const DUNGEON_CONFIG = {
  // Floor settings
  TOTAL_FLOORS: 5,
  ROOMS_PER_FLOOR: [3, 4, 4, 5, 5], // Rooms per floor (excluding boss)
  BOSS_FLOORS: [3, 5], // Floors with boss encounters

  // Difficulty scaling per floor (multipliers)
  DIFFICULTY_SCALING: {
    1: { enemyCount: 1.0, enemySpeed: 1.0, enemyAggression: 0.5, powerUpDensity: 1.2 },
    2: { enemyCount: 1.2, enemySpeed: 1.0, enemyAggression: 0.6, powerUpDensity: 1.0 },
    3: { enemyCount: 1.4, enemySpeed: 1.1, enemyAggression: 0.7, powerUpDensity: 0.9 },
    4: { enemyCount: 1.6, enemySpeed: 1.15, enemyAggression: 0.8, powerUpDensity: 0.8 },
    5: { enemyCount: 1.8, enemySpeed: 1.2, enemyAggression: 0.9, powerUpDensity: 0.7 },
  } as Record<number, DifficultySettings>,

  // Enemy settings
  BASE_ENEMIES_PER_ROOM: 3,
  MAX_ENEMIES_PER_ROOM: 6,
  ENEMY_RESPAWN_DELAY: 0, // No respawning in PvE

  // Room settings
  ROOM_CLEAR_BONUS_XP: 25,
  FLOOR_CLEAR_BONUS_XP: 100,
  BOSS_KILL_BONUS_XP: 250,

  // Player settings
  MAX_PLAYERS_PVE: 4,
  REVIVE_TIME_MS: 5000, // Time teammates have to revive
  REVIVE_PROXIMITY: 2, // Tiles distance to revive

  // Timing
  ROOM_TRANSITION_DELAY: 3000, // ms between rooms
  FLOOR_TRANSITION_DELAY: 5000, // ms between floors
} as const;

interface DifficultySettings {
  enemyCount: number;
  enemySpeed: number;
  enemyAggression: number;
  powerUpDensity: number;
}

// ============================================================================
// ENEMY TYPES
// ============================================================================

export const ENEMY_TYPE = {
  // Basic enemies
  WANDERER: 'wanderer',     // Random movement, drops bombs occasionally
  CHASER: 'chaser',         // Follows nearest player
  BOMBER: 'bomber',         // Places bombs strategically
  SNIPER: 'sniper',         // Tries to line up shots with players

  // Elite enemies (spawn on later floors)
  GHOST: 'ghost',           // Can phase through walls briefly
  BERSERKER: 'berserker',   // Fast, aggressive, more bombs
  TRAPPER: 'trapper',       // Places bombs to cut off escape routes

  // Bosses
  BOSS_KING: 'boss_king',           // Floor 3 boss - Bomb King
  BOSS_INFERNO: 'boss_inferno',     // Floor 5 boss - Inferno Lord
} as const;

export type EnemyTypeId = typeof ENEMY_TYPE[keyof typeof ENEMY_TYPE];

export interface EnemyDefinition {
  id: EnemyTypeId;
  name: string;
  health: number;          // Hits to kill (1 for normal, more for elites/bosses)
  speed: number;           // Movement speed multiplier
  bombCount: number;       // Max bombs they can place
  fireRange: number;       // Explosion range
  behavior: EnemyBehavior;
  color: number;           // Display color
  xpReward: number;        // XP for killing
  isBoss: boolean;
  spawnWeight: number;     // Probability weight for spawning
  minFloor: number;        // First floor this enemy appears
}

export type EnemyBehavior =
  | 'wander'      // Random movement
  | 'chase'       // Follow player
  | 'ambush'      // Wait then attack
  | 'strategic'   // Smart bomb placement
  | 'aggressive'  // Constant pursuit and bombing
  | 'boss';       // Special boss AI

export const ENEMIES: Record<EnemyTypeId, EnemyDefinition> = {
  [ENEMY_TYPE.WANDERER]: {
    id: ENEMY_TYPE.WANDERER,
    name: 'Wanderer',
    health: 1,
    speed: 0.8,
    bombCount: 1,
    fireRange: 2,
    behavior: 'wander',
    color: 0x88aa88,
    xpReward: 10,
    isBoss: false,
    spawnWeight: 40,
    minFloor: 1,
  },
  [ENEMY_TYPE.CHASER]: {
    id: ENEMY_TYPE.CHASER,
    name: 'Chaser',
    health: 1,
    speed: 1.0,
    bombCount: 1,
    fireRange: 2,
    behavior: 'chase',
    color: 0xaa4444,
    xpReward: 15,
    isBoss: false,
    spawnWeight: 30,
    minFloor: 1,
  },
  [ENEMY_TYPE.BOMBER]: {
    id: ENEMY_TYPE.BOMBER,
    name: 'Bomber',
    health: 1,
    speed: 0.9,
    bombCount: 2,
    fireRange: 3,
    behavior: 'strategic',
    color: 0x4444aa,
    xpReward: 20,
    isBoss: false,
    spawnWeight: 20,
    minFloor: 1,
  },
  [ENEMY_TYPE.SNIPER]: {
    id: ENEMY_TYPE.SNIPER,
    name: 'Sniper',
    health: 1,
    speed: 0.7,
    bombCount: 1,
    fireRange: 5,
    behavior: 'ambush',
    color: 0x44aaaa,
    xpReward: 25,
    isBoss: false,
    spawnWeight: 10,
    minFloor: 2,
  },
  [ENEMY_TYPE.GHOST]: {
    id: ENEMY_TYPE.GHOST,
    name: 'Ghost',
    health: 2,
    speed: 1.1,
    bombCount: 1,
    fireRange: 2,
    behavior: 'chase',
    color: 0xaaaaff,
    xpReward: 35,
    isBoss: false,
    spawnWeight: 8,
    minFloor: 3,
  },
  [ENEMY_TYPE.BERSERKER]: {
    id: ENEMY_TYPE.BERSERKER,
    name: 'Berserker',
    health: 2,
    speed: 1.3,
    bombCount: 3,
    fireRange: 2,
    behavior: 'aggressive',
    color: 0xff4444,
    xpReward: 40,
    isBoss: false,
    spawnWeight: 6,
    minFloor: 3,
  },
  [ENEMY_TYPE.TRAPPER]: {
    id: ENEMY_TYPE.TRAPPER,
    name: 'Trapper',
    health: 2,
    speed: 0.85,
    bombCount: 4,
    fireRange: 3,
    behavior: 'strategic',
    color: 0xaa44aa,
    xpReward: 45,
    isBoss: false,
    spawnWeight: 5,
    minFloor: 4,
  },
  [ENEMY_TYPE.BOSS_KING]: {
    id: ENEMY_TYPE.BOSS_KING,
    name: 'Bomb King',
    health: 10,
    speed: 0.7,
    bombCount: 5,
    fireRange: 4,
    behavior: 'boss',
    color: 0xffdd00,
    xpReward: 200,
    isBoss: true,
    spawnWeight: 0,
    minFloor: 3,
  },
  [ENEMY_TYPE.BOSS_INFERNO]: {
    id: ENEMY_TYPE.BOSS_INFERNO,
    name: 'Inferno Lord',
    health: 15,
    speed: 0.8,
    bombCount: 6,
    fireRange: 6,
    behavior: 'boss',
    color: 0xff6600,
    xpReward: 500,
    isBoss: true,
    spawnWeight: 0,
    minFloor: 5,
  },
};

// ============================================================================
// ROOM TYPES
// ============================================================================

export const ROOM_TYPE = {
  NORMAL: 'normal',       // Standard combat room
  ELITE: 'elite',         // Harder enemies, better rewards
  TREASURE: 'treasure',   // Lots of power-ups, few enemies
  BOSS: 'boss',           // Boss encounter
  REST: 'rest',           // Safe room to heal/prepare (before boss)
} as const;

export type RoomTypeId = typeof ROOM_TYPE[keyof typeof ROOM_TYPE];

export interface RoomDefinition {
  type: RoomTypeId;
  enemyMultiplier: number;
  powerUpMultiplier: number;
  hasExit: boolean;
}

export const ROOM_TYPES: Record<RoomTypeId, RoomDefinition> = {
  [ROOM_TYPE.NORMAL]: {
    type: ROOM_TYPE.NORMAL,
    enemyMultiplier: 1.0,
    powerUpMultiplier: 1.0,
    hasExit: true,
  },
  [ROOM_TYPE.ELITE]: {
    type: ROOM_TYPE.ELITE,
    enemyMultiplier: 1.5,
    powerUpMultiplier: 1.5,
    hasExit: true,
  },
  [ROOM_TYPE.TREASURE]: {
    type: ROOM_TYPE.TREASURE,
    enemyMultiplier: 0.3,
    powerUpMultiplier: 3.0,
    hasExit: true,
  },
  [ROOM_TYPE.BOSS]: {
    type: ROOM_TYPE.BOSS,
    enemyMultiplier: 0, // Boss only
    powerUpMultiplier: 0.5,
    hasExit: false, // Exit appears after boss is dead
  },
  [ROOM_TYPE.REST]: {
    type: ROOM_TYPE.REST,
    enemyMultiplier: 0,
    powerUpMultiplier: 2.0,
    hasExit: true,
  },
};

// ============================================================================
// DUNGEON RUN STATE
// ============================================================================

export interface DungeonRunState {
  // Run identification
  runId: string;
  startedAt: number;

  // Progress
  currentFloor: number;
  currentRoom: number;
  totalRoomsCleared: number;
  totalEnemiesKilled: number;

  // Floor/room data
  floorSeed: number;           // Seed for procedural generation
  rooms: DungeonRoom[];        // Current floor's rooms
  currentRoomData: DungeonRoom | null;

  // Player state (preserved between rooms)
  playerStates: Map<string, PvEPlayerState>;

  // Run status
  status: 'active' | 'victory' | 'defeat';
  defeatReason?: string;

  // Rewards
  xpEarned: number;
  coinsEarned: number;
}

export interface DungeonRoom {
  index: number;
  type: RoomTypeId;
  enemySpawns: EnemySpawn[];
  cleared: boolean;
  bossId?: EnemyTypeId;
}

export interface EnemySpawn {
  id: string;
  type: EnemyTypeId;
  gridX: number;
  gridY: number;
}

export interface PvEPlayerState {
  odId: string;
  // Preserved stats (carry between rooms)
  maxBombs: number;
  fireRange: number;
  speed: number;
  hasKick: boolean;
  hasThrow: boolean;
  hasPunch: boolean;
  hasPierce: boolean;
  // Lives
  livesRemaining: number;
  maxLives: number;
  // Down state (waiting for revive)
  isDown: boolean;
  downTimestamp: number;
  reviveProgress: number;
}

// ============================================================================
// ENEMY RUNTIME STATE
// ============================================================================

export interface EnemyState {
  id: string;
  type: EnemyTypeId;
  gridX: number;
  gridY: number;
  health: number;
  maxHealth: number;
  alive: boolean;
  facingDir: number;
  bombsPlaced: number;
  maxBombs: number;
  fireRange: number;
  speed: number;
  // AI state
  targetPlayerId: string | null;
  lastMoveTime: number;
  lastBombTime: number;
  aiState: 'idle' | 'patrol' | 'chase' | 'attack' | 'flee' | 'special';
  patrolPath: { x: number; y: number }[];
  patrolIndex: number;
  // Boss-specific
  bossPhase?: number;
  bossAttackCooldown?: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get enemies that can spawn on a given floor
 */
export function getAvailableEnemies(floor: number): EnemyDefinition[] {
  return Object.values(ENEMIES).filter(
    (e) => !e.isBoss && e.minFloor <= floor
  );
}

/**
 * Select random enemy based on spawn weights
 */
export function selectRandomEnemy(floor: number, seed: number): EnemyTypeId {
  const available = getAvailableEnemies(floor);
  const totalWeight = available.reduce((sum, e) => sum + e.spawnWeight, 0);

  let random = (seed * 9301 + 49297) % 233280;
  random = (random / 233280) * totalWeight;

  let cumulative = 0;
  for (const enemy of available) {
    cumulative += enemy.spawnWeight;
    if (random < cumulative) {
      return enemy.id;
    }
  }

  return ENEMY_TYPE.WANDERER;
}

/**
 * Get boss for a floor
 */
export function getBossForFloor(floor: number): EnemyTypeId | null {
  if (floor === 3) return ENEMY_TYPE.BOSS_KING;
  if (floor === 5) return ENEMY_TYPE.BOSS_INFERNO;
  return null;
}

/**
 * Calculate difficulty settings for a floor
 */
export function getFloorDifficulty(floor: number): DifficultySettings {
  return DUNGEON_CONFIG.DIFFICULTY_SCALING[floor] ||
         DUNGEON_CONFIG.DIFFICULTY_SCALING[5];
}

/**
 * Generate room sequence for a floor
 */
export function generateFloorRooms(floor: number): RoomTypeId[] {
  const roomCount = DUNGEON_CONFIG.ROOMS_PER_FLOOR[floor - 1] || 4;
  const isBossFloor = DUNGEON_CONFIG.BOSS_FLOORS.includes(floor);

  const rooms: RoomTypeId[] = [];

  for (let i = 0; i < roomCount; i++) {
    // First room is always normal
    if (i === 0) {
      rooms.push(ROOM_TYPE.NORMAL);
      continue;
    }

    // Mix of room types based on RNG
    const rand = Math.random();
    if (rand < 0.15 && floor >= 2) {
      rooms.push(ROOM_TYPE.ELITE);
    } else if (rand < 0.25) {
      rooms.push(ROOM_TYPE.TREASURE);
    } else {
      rooms.push(ROOM_TYPE.NORMAL);
    }
  }

  // Boss floors have a rest room before boss
  if (isBossFloor) {
    rooms.push(ROOM_TYPE.REST);
    rooms.push(ROOM_TYPE.BOSS);
  }

  return rooms;
}

/**
 * Create initial PvE player state
 */
export function createPvEPlayerState(odId: string): PvEPlayerState {
  return {
    odId,
    maxBombs: 1,
    fireRange: 2,
    speed: 150,
    hasKick: false,
    hasThrow: false,
    hasPunch: false,
    hasPierce: false,
    livesRemaining: 3,
    maxLives: 3,
    isDown: false,
    downTimestamp: 0,
    reviveProgress: 0,
  };
}

/**
 * Create initial dungeon run state
 */
export function createDungeonRunState(runId: string): DungeonRunState {
  return {
    runId,
    startedAt: Date.now(),
    currentFloor: 1,
    currentRoom: 0,
    totalRoomsCleared: 0,
    totalEnemiesKilled: 0,
    floorSeed: Math.floor(Math.random() * 1000000),
    rooms: [],
    currentRoomData: null,
    playerStates: new Map(),
    status: 'active',
    xpEarned: 0,
    coinsEarned: 0,
  };
}
