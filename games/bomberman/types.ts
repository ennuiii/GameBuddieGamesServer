import { GamePhase, Direction, CurseType } from './shared/constants.js';

// ============================================
// Game State Types
// ============================================

export interface FallingBlock {
  x: number;
  y: number;
  fallTime: number;
}

export interface BombermanGameState {
  phase: GamePhase;
  tiles: number[];
  bombs: Map<string, BombData>;
  explosions: Map<string, ExplosionData>;
  countdown: number;
  timeRemaining: number;
  gameMode: number;
  winnerId: string | null;
  usedSpawnIndices: Set<number>;
  bombIdCounter: number;
  explosionIdCounter: number;
  // Sudden Death state
  suddenDeathActive: boolean;
  lastBlockFallTime: number;
  fallingBlockIndex: number;
  fallingBlocks: FallingBlock[];
}

// ============================================
// Player Data (stored in player.gameData)
// ============================================

export interface BombermanPlayerData {
  gridX: number;
  gridY: number;
  maxBombs: number;
  bombsPlaced: number;
  fireRange: number;
  speed: number;
  alive: boolean;
  color: number;
  kills: number;
  deaths: number;
  hasKick: boolean;
  hasThrow: boolean;
  stunnedUntil: number;
  facingDir: Direction;
  spawnIndex: number;
  lastMoveTime: number;
  // New power-up flags
  hasPunch: boolean;
  hasPierce: boolean;
  hasBombPass: boolean;
  // Curse state
  curseType: CurseType | null;
  curseEndTime: number;
  originalSpeed: number; // To restore after curse ends
}

// ============================================
// Entity Types
// ============================================

export interface BombData {
  id: string;
  ownerId: string;
  gridX: number;
  gridY: number;
  range: number;
  timer: number;
  isMoving: boolean;
  moveDir: Direction;
  isFlying: boolean;
  flyDir: Direction;
  targetX: number;
  targetY: number;
  placedAt: number;
  lastSlideTime: number;
  lastFlyTime: number;
  // New flags
  isPiercing: boolean; // Explosion penetrates soft blocks
  isPunched: boolean;  // For client punch animation
}

export interface ExplosionData {
  id: string;
  gridX: number;
  gridY: number;
  timer: number;
  createdAt: number;
}

// ============================================
// Serialized Types (for client transmission)
// ============================================

export interface SerializedPlayer {
  id: string;
  socketId: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  // Game data
  gridX: number;
  gridY: number;
  maxBombs: number;
  bombsPlaced: number;
  fireRange: number;
  speed: number;
  alive: boolean;
  color: number;
  kills: number;
  deaths: number;
  hasKick: boolean;
  hasThrow: boolean;
  stunnedUntil: number;
  facingDir: number;
  // New flags
  hasPunch: boolean;
  hasPierce: boolean;
  hasBombPass: boolean;
  curseType: number | null;
  curseEndTime: number;
}

export interface SerializedBomb {
  id: string;
  ownerId: string;
  gridX: number;
  gridY: number;
  range: number;
  timer: number;
  isMoving: boolean;
  moveDir: number;
  isFlying: boolean;
  flyDir: number;
  targetX: number;
  targetY: number;
  isPiercing: boolean;
  isPunched: boolean;
}

export interface SerializedExplosion {
  id: string;
  gridX: number;
  gridY: number;
  timer: number;
}

export interface SerializedFallingBlock {
  x: number;
  y: number;
  fallTime: number;
}

export interface SerializedGameData {
  tiles: number[];
  bombs: SerializedBomb[];
  explosions: SerializedExplosion[];
  countdown: number;
  timeRemaining: number;
  gameMode: number;
  winnerId: string | null;
  // Sudden Death
  suddenDeathActive: boolean;
  fallingBlocks: SerializedFallingBlock[];
}

export interface SerializedRoom {
  code: string;
  hostId: string;
  mySocketId: string;
  players: SerializedPlayer[];
  state: GamePhase;
  gameData: SerializedGameData;
}

// ============================================
// Socket Event Payloads
// ============================================

export interface MovePayload {
  direction: number;
}

export interface SetModePayload {
  mode: number;
}

// ============================================
// Default Factory Functions
// ============================================

export function createDefaultPlayerData(spawnIndex: number, spawn: { x: number; y: number }, color: number): BombermanPlayerData {
  return {
    gridX: spawn.x,
    gridY: spawn.y,
    maxBombs: 1,
    bombsPlaced: 0,
    fireRange: 2,
    speed: 150,
    alive: true,
    color,
    kills: 0,
    deaths: 0,
    hasKick: false,
    hasThrow: false,
    stunnedUntil: 0,
    facingDir: 2, // DOWN
    spawnIndex,
    lastMoveTime: 0,
    // New flags
    hasPunch: false,
    hasPierce: false,
    hasBombPass: false,
    curseType: null,
    curseEndTime: 0,
    originalSpeed: 150,
  };
}

export function createDefaultGameState(): BombermanGameState {
  return {
    phase: 'lobby',
    tiles: [],
    bombs: new Map(),
    explosions: new Map(),
    countdown: 0,
    timeRemaining: 0,
    gameMode: 0,
    winnerId: null,
    usedSpawnIndices: new Set(),
    bombIdCounter: 0,
    explosionIdCounter: 0,
    // Sudden Death
    suddenDeathActive: false,
    lastBlockFallTime: 0,
    fallingBlockIndex: 0,
    fallingBlocks: [],
  };
}
