/**
 * Destination.ts - Turn command structure
 *
 * Inspired by Armagetron's gDestination system.
 * These are the ONLY things synchronized over the network.
 * Everything else is deterministically simulated from destinations.
 */

import type { Coord, Direction } from './Core';

/**
 * Destination - A turn/command point in the game
 *
 * Like Armagetron's gDestination, this represents a point where a player
 * issued a turn command. Between destinations, movement is deterministic
 * and can be computed locally.
 */
export interface Destination {
  /**
   * Position where the turn occurred
   * This is where the wall segment ends and a new one begins
   */
  position: Coord;

  /**
   * Direction AFTER the turn
   * The new heading of the cycle
   */
  direction: Direction;

  /**
   * Cycle's odometer reading at this point
   * Total distance traveled since spawn
   */
  distance: number;

  /**
   * Game time when the turn occurred (seconds since round start)
   */
  gameTime: number;

  /**
   * Unique ID for ordering and deduplication
   * Used to match client predictions with server confirmations
   */
  messageId: number;

  /**
   * Player who made this turn
   */
  playerId: string;

  /**
   * Optional: braking state
   * True if player was braking at this destination
   */
  braking?: boolean;
}

/**
 * Create a spawn destination (first destination for a cycle)
 */
export function createSpawnDestination(
  playerId: string,
  position: Coord,
  direction: Direction,
  gameTime: number
): Destination {
  return {
    position: { ...position },
    direction: { ...direction },
    distance: 0,
    gameTime,
    messageId: 0, // Spawn always has ID 0
    playerId,
    braking: false,
  };
}

/**
 * Check if destination A comes before destination B
 */
export function destinationBefore(a: Destination, b: Destination): boolean {
  // Primary sort by distance (more reliable than time)
  if (a.distance !== b.distance) {
    return a.distance < b.distance;
  }
  // Fallback to game time
  if (a.gameTime !== b.gameTime) {
    return a.gameTime < b.gameTime;
  }
  // Fallback to message ID
  return a.messageId < b.messageId;
}

/**
 * Find insertion index for a destination in a sorted array
 */
export function findDestinationInsertIndex(
  destinations: Destination[],
  newDest: Destination
): number {
  for (let i = destinations.length - 1; i >= 0; i--) {
    if (destinationBefore(destinations[i], newDest)) {
      return i + 1;
    }
  }
  return 0;
}

/**
 * Check if a destination already exists (by messageId)
 */
export function hasDestination(
  destinations: Destination[],
  messageId: number,
  playerId: string
): boolean {
  return destinations.some(
    d => d.messageId === messageId && d.playerId === playerId
  );
}
