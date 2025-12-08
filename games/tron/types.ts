/**
 * Tron Game Server Types
 */

import type { Direction as DirectionVector, Coord, TurnDir } from './shared/types/index.js';
import { DIR_UP, DIR_DOWN, DIR_LEFT, DIR_RIGHT } from './shared/types/index.js';

// Legacy string direction (for room/player data compatibility)
export type DirectionString = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

// Alias for backwards compatibility
export type Direction = DirectionString;

export type TronPhase = 'lobby' | 'countdown' | 'playing' | 'round_over' | 'game_over';

export interface Position {
  x: number;
  z: number;
}

export interface TrailSegment extends Position {
  timestamp: number;
}

export const PLAYER_COLORS = [
  '#00ffff', // Cyan
  '#ff00ff', // Magenta
  '#ffff00', // Yellow
  '#00ff00', // Green
  '#ff6600', // Orange
  '#ff0044', // Red
] as const;

export type PlayerColor = typeof PLAYER_COLORS[number];

export interface TronSettings {
  arenaSize: 50 | 75 | 100 | 500 | 1000;
  gameSpeed: 1 | 2 | 3;
  roundsToWin: 1 | 3 | 5;
}

export interface TronGameState {
  phase: TronPhase;
  currentRound: number;
  countdown: number;
  roundWinner: string | null;
  gameWinner: string | null;
  settings: TronSettings;
}

export interface TronPlayerData {
  isReady: boolean;
  isAlive: boolean;
  color: PlayerColor;
  position: Position;
  direction: DirectionString;
  trail: TrailSegment[];
  score: number;
  eliminatedBy: string | null;
  colorIndex: number;
}

export const DEFAULT_SETTINGS: TronSettings = {
  arenaSize: 100,
  gameSpeed: 2,
  roundsToWin: 3,
};

// Grid spacing for collision detection
export const GRID_SPACING = 2;

// ===========================================
// DIRECTION CONVERSION UTILITIES
// ===========================================

/**
 * Convert string direction to unit vector
 */
export function stringToDirection(str: DirectionString): DirectionVector {
  switch (str) {
    case 'UP': return { ...DIR_UP };
    case 'DOWN': return { ...DIR_DOWN };
    case 'LEFT': return { ...DIR_LEFT };
    case 'RIGHT': return { ...DIR_RIGHT };
  }
}

/**
 * Convert unit vector to string direction
 */
export function directionToString(dir: DirectionVector): DirectionString {
  if (dir.z < -0.5) return 'UP';
  if (dir.z > 0.5) return 'DOWN';
  if (dir.x < -0.5) return 'LEFT';
  return 'RIGHT';
}

/**
 * Convert string direction to turn direction relative to current
 */
export function getTurnDirection(current: DirectionString, next: DirectionString): TurnDir | null {
  // Map directions to angles (0 = UP, 1 = RIGHT, 2 = DOWN, 3 = LEFT)
  const angles: Record<DirectionString, number> = {
    'UP': 0, 'RIGHT': 1, 'DOWN': 2, 'LEFT': 3
  };

  const currentAngle = angles[current];
  const nextAngle = angles[next];
  const diff = (nextAngle - currentAngle + 4) % 4;

  if (diff === 1) return 1;   // Right turn
  if (diff === 3) return -1;  // Left turn
  return null; // Same direction or 180 (invalid)
}

// Spawn positions for up to 6 players
export function getSpawnPositions(arenaSize: number): Array<{ position: Position; direction: DirectionVector }> {
  const halfSize = arenaSize / 2;
  const margin = Math.round(arenaSize * 0.15);

  return [
    { position: { x: -halfSize + margin, z: -halfSize + margin }, direction: { ...DIR_RIGHT } },
    { position: { x: halfSize - margin, z: halfSize - margin }, direction: { ...DIR_LEFT } },
    { position: { x: -halfSize + margin, z: halfSize - margin }, direction: { ...DIR_UP } },
    { position: { x: halfSize - margin, z: -halfSize + margin }, direction: { ...DIR_DOWN } },
    { position: { x: 0, z: -halfSize + margin }, direction: { ...DIR_DOWN } },
    { position: { x: 0, z: halfSize - margin }, direction: { ...DIR_UP } },
  ];
}

export function createInitialGameState(settings: TronSettings): TronGameState {
  return {
    phase: 'lobby',
    currentRound: 0,
    countdown: 0,
    roundWinner: null,
    gameWinner: null,
    settings,
  };
}

export function createInitialPlayerData(colorIndex: number): TronPlayerData {
  return {
    isReady: false,
    isAlive: true,
    color: PLAYER_COLORS[colorIndex % PLAYER_COLORS.length],
    position: { x: 0, z: 0 },
    direction: 'UP',
    trail: [],
    score: 0,
    eliminatedBy: null,
    colorIndex,
  };
}

// Direction utilities - move by grid spacing (one cell per move)
export const DIRECTION_VECTORS: Record<Direction, Position> = {
  UP: { x: 0, z: -GRID_SPACING },
  DOWN: { x: 0, z: GRID_SPACING },
  LEFT: { x: -GRID_SPACING, z: 0 },
  RIGHT: { x: GRID_SPACING, z: 0 },
};

export const OPPOSITE_DIRECTIONS: Record<Direction, Direction> = {
  UP: 'DOWN',
  DOWN: 'UP',
  LEFT: 'RIGHT',
  RIGHT: 'LEFT',
};

export function isValidDirectionChange(current: Direction, next: Direction): boolean {
  return OPPOSITE_DIRECTIONS[current] !== next;
}
