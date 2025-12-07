/**
 * Bomberman Game Types
 */

export type GamePhase = 'lobby' | 'playing' | 'ended';

export interface BombermanSettings {
  maxRounds: number;
  timeLimit: number; // in seconds
  mapSize: number;
}

export type CellType = 'empty' | 'wall' | 'block';

export interface Bomb {
  id: string;
  x: number;
  y: number;
  playerId: string;
  range: number;
  createdAt: number;
}

export interface Explosion {
  id: string;
  x: number;
  y: number;
  createdAt: number;
}

export type PowerUpType = 'bomb_range' | 'bomb_capacity' | 'speed' | 'kick_bombs' | 'pickup_bombs';

export interface PowerUp {
  id: string;
  x: number;
  y: number;
  type: PowerUpType;
}

export interface BombermanGameState {
  phase: GamePhase;
  currentRound: number;
  grid: CellType[][];
  bombs: Bomb[];
  explosions: Explosion[];
  powerups: PowerUp[];
  settings: BombermanSettings;
  timeLeft: number;
  winnerId: string | null;
}

export interface BombermanPlayerData {
  isReady: boolean;
  score: number;
  x: number;
  y: number;
  isAlive: boolean;
  bombCapacity: number;
  bombRange: number;
  activeBombs: number;
  color: string;
  canKickBombs: boolean;
  canPickUpBombs: boolean;
  heldBomb: Bomb | null;
  facing: 'up' | 'down' | 'left' | 'right';
}

export const DEFAULT_SETTINGS: BombermanSettings = {
  maxRounds: 3,
  timeLimit: 180,
  mapSize: 15
};

export function createInitialGameState(settings: BombermanSettings): BombermanGameState {
  return {
    phase: 'lobby',
    currentRound: 0,
    grid: [],
    bombs: [],
    explosions: [],
    powerups: [],
    settings,
    timeLeft: settings.timeLimit,
    winnerId: null
  };
}

export function createInitialPlayerData(): BombermanPlayerData {
  return {
    isReady: false,
    score: 0,
    x: 0,
    y: 0,
    isAlive: true,
    bombCapacity: 1,
    bombRange: 1,
    activeBombs: 0,
    color: '#000000', // Placeholder
    canKickBombs: false,
    canPickUpBombs: false,
    heldBomb: null,
    facing: 'down'
  };
}