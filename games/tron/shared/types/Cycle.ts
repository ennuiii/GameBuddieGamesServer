/**
 * Cycle.ts - Light cycle state
 *
 * Inspired by Armagetron's gCycleMovement.
 * Contains all state needed to simulate a cycle.
 */

import type { Coord, Direction } from './Core';
import type { Destination } from './Destination';
import { createSpawnDestination } from './Destination';

/**
 * CycleState - Complete state of a light cycle
 *
 * This is the internal simulation state. Position is updated every tick,
 * while destinations are added only on turns.
 */
export interface CycleState {
  /**
   * Unique cycle/player ID
   */
  id: string;

  /**
   * Current position (updated every tick)
   */
  position: Coord;

  /**
   * Current direction (unit vector)
   */
  direction: Direction;

  /**
   * Current speed (units per second)
   */
  speed: number;

  /**
   * Total distance traveled since spawn (odometer)
   */
  distance: number;

  /**
   * Is the cycle still alive?
   */
  alive: boolean;

  /**
   * Last game time this cycle was updated
   */
  lastTime: number;

  /**
   * Turn history (destinations)
   * First entry is spawn, subsequent entries are turns
   */
  destinations: Destination[];

  /**
   * Position of last turn (for wall building)
   */
  lastTurnPosition: Coord;

  /**
   * Game time of last turn (for turn delay)
   */
  lastTurnTime: number;

  /**
   * Total number of turns made
   */
  turnCount: number;

  /**
   * Player color (for rendering)
   */
  color: string;
}

/**
 * Create a new cycle at spawn position
 */
export function createCycle(
  id: string,
  position: Coord,
  direction: Direction,
  speed: number,
  gameTime: number,
  color: string = '#00ffff'
): CycleState {
  const spawnDest = createSpawnDestination(id, position, direction, gameTime);

  return {
    id,
    position: { ...position },
    direction: { ...direction },
    speed,
    distance: 0,
    alive: true,
    lastTime: gameTime,
    destinations: [spawnDest],
    lastTurnPosition: { ...position },
    lastTurnTime: gameTime,
    turnCount: 0,
    color,
  };
}

/**
 * Create a sync snapshot of cycle state (for network)
 */
export interface CycleSyncData {
  id: string;
  position: Coord;
  direction: Direction;
  distance: number;
  speed: number;
  alive: boolean;
}

/**
 * Extract sync data from cycle state
 */
export function getCycleSyncData(cycle: CycleState): CycleSyncData {
  return {
    id: cycle.id,
    position: { ...cycle.position },
    direction: { ...cycle.direction },
    distance: cycle.distance,
    speed: cycle.speed,
    alive: cycle.alive,
  };
}

/**
 * Apply sync correction to a cycle (soft correction)
 */
export function applySyncCorrection(
  cycle: CycleState,
  sync: CycleSyncData,
  strength: number = 0.1
): void {
  // Lerp position toward server
  cycle.position.x += (sync.position.x - cycle.position.x) * strength;
  cycle.position.z += (sync.position.z - cycle.position.z) * strength;

  // Update other fields
  cycle.alive = sync.alive;
  cycle.speed = sync.speed;
}

/**
 * Apply hard sync (for major desync or reconnection)
 */
export function applyHardSync(
  cycle: CycleState,
  sync: CycleSyncData
): void {
  cycle.position = { ...sync.position };
  cycle.direction = { ...sync.direction };
  cycle.distance = sync.distance;
  cycle.speed = sync.speed;
  cycle.alive = sync.alive;
}

/**
 * Render data for a cycle (used by client)
 */
export interface CycleRenderData {
  id: string;
  position: Coord;
  direction: Direction;
  alive: boolean;
  color: string;
}

/**
 * Extract render data from cycle state
 */
export function getCycleRenderData(cycle: CycleState): CycleRenderData {
  return {
    id: cycle.id,
    position: { ...cycle.position },
    direction: { ...cycle.direction },
    alive: cycle.alive,
    color: cycle.color,
  };
}
