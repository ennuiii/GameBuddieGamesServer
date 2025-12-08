/**
 * Core.ts - Fundamental types and utilities
 *
 * Based on Armagetron's eCoord system - using 2D coordinates
 * with unit vectors for direction.
 */

// ===========================================
// COORDINATE SYSTEM
// ===========================================

/**
 * 2D Coordinate (like Armagetron's eCoord)
 * Using z instead of y for Three.js compatibility (y is up in 3D)
 */
export interface Coord {
  x: number;
  z: number;
}

/**
 * Direction as a unit vector
 * Allows smooth rotation and any angle direction
 */
export type Direction = Coord;

// ===========================================
// PRE-DEFINED DIRECTIONS
// ===========================================

export const DIR_UP: Direction = { x: 0, z: -1 };
export const DIR_DOWN: Direction = { x: 0, z: 1 };
export const DIR_LEFT: Direction = { x: -1, z: 0 };
export const DIR_RIGHT: Direction = { x: 1, z: 0 };

/**
 * All four cardinal directions
 */
export const DIRECTIONS: Direction[] = [DIR_UP, DIR_RIGHT, DIR_DOWN, DIR_LEFT];

// ===========================================
// TURN SYSTEM
// ===========================================

/**
 * Turn direction: -1 = left (counter-clockwise), 1 = right (clockwise)
 */
export type TurnDir = -1 | 1;

/**
 * Rotate a direction by 90 degrees
 * Left turn: rotate counter-clockwise
 * Right turn: rotate clockwise
 */
export function turnDirection(dir: Direction, turn: TurnDir): Direction {
  // 90-degree rotation matrix:
  // For right turn (clockwise): [cos(-90), -sin(-90)] = [0, 1]
  //                             [sin(-90), cos(-90)]   = [-1, 0]
  // For left turn (counter-clockwise): [cos(90), -sin(90)] = [0, -1]
  //                                     [sin(90), cos(90)]   = [1, 0]
  return {
    x: -dir.z * turn,
    z: dir.x * turn,
  };
}

/**
 * Get the opposite direction
 */
export function oppositeDirection(dir: Direction): Direction {
  return { x: -dir.x, z: -dir.z };
}

/**
 * Check if two directions are the same (within tolerance)
 */
export function sameDirection(a: Direction, b: Direction, tolerance = 0.01): boolean {
  return Math.abs(a.x - b.x) < tolerance && Math.abs(a.z - b.z) < tolerance;
}

/**
 * Check if two directions are opposite
 */
export function isOppositeDirection(a: Direction, b: Direction, tolerance = 0.01): boolean {
  return Math.abs(a.x + b.x) < tolerance && Math.abs(a.z + b.z) < tolerance;
}

/**
 * Normalize a direction to unit length
 */
export function normalizeDirection(dir: Direction): Direction {
  const len = Math.sqrt(dir.x * dir.x + dir.z * dir.z);
  if (len === 0) return { x: 0, z: -1 }; // Default to UP
  return { x: dir.x / len, z: dir.z / len };
}

/**
 * Get the angle of a direction in radians (for rendering)
 * 0 = facing -z (up), positive = clockwise
 */
export function directionToAngle(dir: Direction): number {
  return Math.atan2(dir.x, -dir.z);
}

// ===========================================
// COORDINATE UTILITIES
// ===========================================

/**
 * Calculate distance between two coordinates
 */
export function distance(a: Coord, b: Coord): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/**
 * Calculate squared distance (faster, for comparisons)
 */
export function distanceSquared(a: Coord, b: Coord): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return dx * dx + dz * dz;
}

/**
 * Linear interpolation between two coordinates
 */
export function lerp(a: Coord, b: Coord, t: number): Coord {
  return {
    x: a.x + (b.x - a.x) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

/**
 * Add two coordinates
 */
export function addCoord(a: Coord, b: Coord): Coord {
  return { x: a.x + b.x, z: a.z + b.z };
}

/**
 * Subtract coordinates (a - b)
 */
export function subCoord(a: Coord, b: Coord): Coord {
  return { x: a.x - b.x, z: a.z - b.z };
}

/**
 * Scale a coordinate
 */
export function scaleCoord(c: Coord, s: number): Coord {
  return { x: c.x * s, z: c.z * s };
}

/**
 * Copy a coordinate
 */
export function copyCoord(c: Coord): Coord {
  return { x: c.x, z: c.z };
}

// ===========================================
// GRID UTILITIES
// ===========================================

/**
 * Get grid cell key for collision detection
 */
export function getGridKey(pos: Coord, gridSize: number): string {
  const gx = Math.floor(pos.x / gridSize);
  const gz = Math.floor(pos.z / gridSize);
  return `${gx},${gz}`;
}

/**
 * Snap a position to the nearest grid intersection
 */
export function snapToGrid(pos: Coord, gridSize: number): Coord {
  return {
    x: Math.round(pos.x / gridSize) * gridSize,
    z: Math.round(pos.z / gridSize) * gridSize,
  };
}
