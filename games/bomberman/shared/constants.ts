// Bomberman Game Constants

export const GAME_CONFIG = {
  // Grid dimensions (19x15 for 8 players)
  GRID_WIDTH: 19,
  GRID_HEIGHT: 15,
  TILE_SIZE: 40,

  // Calculated arena size
  get ARENA_WIDTH() { return this.GRID_WIDTH * this.TILE_SIZE; },
  get ARENA_HEIGHT() { return this.GRID_HEIGHT * this.TILE_SIZE; },

  // Player settings
  PLAYER_MOVE_SPEED: 150, // ms per tile
  PLAYER_START_BOMBS: 1,
  PLAYER_START_RANGE: 2,
  MAX_BOMBS: 8,
  MAX_RANGE: 8,

  // Bomb settings
  BOMB_TIMER: 3000, // ms until explosion
  EXPLOSION_DURATION: 500, // ms explosion visible
  BOMB_SLIDE_SPEED: 80, // ms per tile when kicked
  BOMB_FLY_SPEED: 150, // ms per tile when thrown (bounce timing)
  THROW_DISTANCE: 3, // tiles bomb travels when thrown (unused now - flies until empty)

  // Stun settings
  STUN_DURATION: 500, // ms player is stunned when hit by kicked/thrown bomb

  // Punch settings
  PUNCH_DISTANCE: 3, // tiles bomb travels when punched

  // Curse settings
  CURSE_DURATION: 15000, // ms curse lasts
  SHORT_FUSE_TIME: 1000, // ms bomb timer when cursed with short fuse

  // Sudden Death settings
  SUDDEN_DEATH_TIME: 60000, // ms remaining when sudden death triggers
  BLOCK_FALL_INTERVAL: 500, // ms between falling blocks (faster = more intense)

  // Game settings
  TICK_RATE: 60,
  MIN_PLAYERS: 2,
  MAX_PLAYERS: 8,
  COUNTDOWN_TIME: 3000, // ms before game starts
  DEATHMATCH_TIME: 180000, // 3 minutes for deathmatch mode

  // Player colors (8 distinct colors for 8 players)
  PLAYER_COLORS: [
    0xff4444, // Red
    0x44ff44, // Green
    0x4444ff, // Blue
    0xffff44, // Yellow
    0xff44ff, // Magenta
    0x44ffff, // Cyan
    0xff8844, // Orange
    0x8844ff, // Purple
  ],

  // Spawn positions (corners and mid-edges for 8 players)
  SPAWN_POSITIONS: [
    { x: 1, y: 1 },           // Top-left
    { x: 17, y: 13 },         // Bottom-right
    { x: 17, y: 1 },          // Top-right
    { x: 1, y: 13 },          // Bottom-left
    { x: 9, y: 1 },           // Top-center
    { x: 9, y: 13 },          // Bottom-center
    { x: 1, y: 7 },           // Left-center
    { x: 17, y: 7 },          // Right-center
  ],
} as const;

// Tile types
export const TILE = {
  EMPTY: 0,
  HARD_WALL: 1,
  SOFT_BLOCK: 2,
  POWERUP_BOMB: 3,
  POWERUP_FIRE: 4,
  POWERUP_SPEED: 5,
  POWERUP_KICK: 6,
  POWERUP_THROW: 7,
  // New power-ups
  POWERUP_PUNCH: 8,    // Boxing glove - instant knock bomb
  POWERUP_PIERCE: 9,   // Pierce bomb - explosion goes through soft blocks
  POWERUP_BOMBPASS: 10, // Walk through bombs
  SKULL: 11,           // Curse item - random negative effect
  // PvE mode tiles
  EXIT: 12,            // Exit to next room/floor
  FIRE_HAZARD: 13,     // Arena hazard from boss
} as const;

// Game phases
export const GAME_PHASE = {
  WAITING: 'lobby',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  ENDED: 'ended',
} as const;

// Game modes
export const GAME_MODE = {
  LAST_MAN_STANDING: 0,
  DEATHMATCH: 1,
  DUNGEON: 2,  // PvE co-op dungeon mode
} as const;

// Direction enum for movement
export const DIRECTION = {
  NONE: 0,
  UP: 1,
  DOWN: 2,
  LEFT: 3,
  RIGHT: 4,
} as const;

// Curse types for skull power-up
export const CURSE_TYPE = {
  DIARRHEA: 0,   // Drop bombs uncontrollably
  SLOW: 1,       // Movement very slow
  FAST: 2,       // Movement uncontrollably fast
  NO_BOMBS: 3,   // Cannot place bombs
  SHORT_FUSE: 4, // Bombs explode in 1 second
  REVERSE: 5,    // Controls inverted
  SWAP: 6,       // Swap positions with random player
} as const;

export type GamePhase = typeof GAME_PHASE[keyof typeof GAME_PHASE];
export type TileType = typeof TILE[keyof typeof TILE];
export type Direction = typeof DIRECTION[keyof typeof DIRECTION];
export type CurseType = typeof CURSE_TYPE[keyof typeof CURSE_TYPE];
