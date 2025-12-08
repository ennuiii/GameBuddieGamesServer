/**
 * Wall.ts - Wall/Trail segment types
 *
 * Inspired by Armagetron's gPlayerWall system.
 * Walls use DISTANCE as the primary metric, not time.
 * This makes positioning independent of speed variations.
 */

import type { Coord } from './Core';

/**
 * WallSegment - A continuous section of wall
 *
 * A wall segment represents a straight line of wall from one turn
 * to the next. The segment grows as the cycle moves forward.
 */
export interface WallSegment {
  /**
   * Start position (world coordinates)
   * Where this segment begins (at a turn or spawn point)
   */
  start: Coord;

  /**
   * End position (world coordinates)
   * Where this segment ends (at next turn or current head)
   */
  end: Coord;

  /**
   * Distance traveled by cycle at segment start
   */
  distanceStart: number;

  /**
   * Distance traveled by cycle at segment end
   */
  distanceEnd: number;

  /**
   * Game time when segment started
   */
  timeStart: number;

  /**
   * Game time when segment ended (or current time for active segment)
   */
  timeEnd: number;

  /**
   * Player who owns this wall segment
   */
  playerId: string;

  /**
   * Is this segment solid/dangerous?
   * False = hole (from explosion or other effect)
   */
  isDangerous: boolean;
}

/**
 * PlayerWall - Complete wall data for one player
 *
 * Contains all completed segments plus the current segment being built.
 */
export interface PlayerWall {
  /**
   * Player who owns this wall
   */
  playerId: string;

  /**
   * Completed wall segments (from spawn to last turn)
   */
  segments: WallSegment[];

  /**
   * Current segment being built (from last turn to current head)
   * Null if cycle is dead
   */
  currentSegment: WallSegment | null;
}

/**
 * Create a new wall for a player
 */
export function createPlayerWall(
  playerId: string,
  spawnPosition: Coord,
  gameTime: number
): PlayerWall {
  return {
    playerId,
    segments: [],
    currentSegment: {
      start: { ...spawnPosition },
      end: { ...spawnPosition },
      distanceStart: 0,
      distanceEnd: 0,
      timeStart: gameTime,
      timeEnd: gameTime,
      playerId,
      isDangerous: true,
    },
  };
}

/**
 * Drop the current wall segment and start a new one (on turn)
 */
export function dropWallSegment(
  wall: PlayerWall,
  position: Coord,
  distance: number,
  gameTime: number
): void {
  console.log(`[SERVER WALL DROP] player=${wall.playerId.slice(-4)} pos=(${position.x.toFixed(1)},${position.z.toFixed(1)}) dist=${distance.toFixed(1)} segments=${wall.segments.length}`);

  if (wall.currentSegment) {
    // Finalize current segment
    wall.currentSegment.end = { ...position };
    wall.currentSegment.distanceEnd = distance;
    wall.currentSegment.timeEnd = gameTime;

    // Only add if segment has length
    const dx = wall.currentSegment.end.x - wall.currentSegment.start.x;
    const dz = wall.currentSegment.end.z - wall.currentSegment.start.z;
    const len = Math.sqrt(dx * dx + dz * dz);
    if (dx * dx + dz * dz > 0.01) {
      wall.segments.push(wall.currentSegment);
      console.log(`[SERVER WALL DROP] added segment len=${len.toFixed(2)} newTotal=${wall.segments.length}`);
    } else {
      console.log(`[SERVER WALL DROP] SKIP segment too short len=${len.toFixed(4)}`);
    }
  }

  // Start new segment
  wall.currentSegment = {
    start: { ...position },
    end: { ...position },
    distanceStart: distance,
    distanceEnd: distance,
    timeStart: gameTime,
    timeEnd: gameTime,
    playerId: wall.playerId,
    isDangerous: true,
  };
}

/**
 * Update the current wall segment's head position
 */
export function updateWallHead(
  wall: PlayerWall,
  position: Coord,
  distance: number,
  gameTime: number
): void {
  if (wall.currentSegment) {
    wall.currentSegment.end = { ...position };
    wall.currentSegment.distanceEnd = distance;
    wall.currentSegment.timeEnd = gameTime;
  }
}

// Debug flag for wall vertices logging (reduce spam)
let serverWallVerticesLogCount = 0;
const SERVER_WALL_VERTICES_LOG_INTERVAL = 60; // Log every 60 calls

/**
 * Get all vertices for rendering (completed segments + current)
 */
export function getWallVertices(wall: PlayerWall): Coord[] {
  const vertices: Coord[] = [];

  // Add completed segment points
  for (const seg of wall.segments) {
    if (vertices.length === 0 ||
        vertices[vertices.length - 1].x !== seg.start.x ||
        vertices[vertices.length - 1].z !== seg.start.z) {
      vertices.push({ ...seg.start });
    }
    vertices.push({ ...seg.end });
  }

  // Add current segment
  if (wall.currentSegment) {
    if (vertices.length === 0 ||
        vertices[vertices.length - 1].x !== wall.currentSegment.start.x ||
        vertices[vertices.length - 1].z !== wall.currentSegment.start.z) {
      vertices.push({ ...wall.currentSegment.start });
    }
    vertices.push({ ...wall.currentSegment.end });
  }

  // Debug logging (throttled to reduce spam)
  serverWallVerticesLogCount++;
  if (serverWallVerticesLogCount % SERVER_WALL_VERTICES_LOG_INTERVAL === 1) {
    const curSeg = wall.currentSegment;
    console.log(`[SERVER WALL VERTICES] player=${wall.playerId.slice(-4)} segments=${wall.segments.length} curSeg=${curSeg ? `(${curSeg.start.x.toFixed(1)},${curSeg.start.z.toFixed(1)})->(${curSeg.end.x.toFixed(1)},${curSeg.end.z.toFixed(1)})` : 'null'} verts=${vertices.length}`);
  }

  return vertices;
}

/**
 * Clear all walls (for new round)
 */
export function clearWall(wall: PlayerWall): void {
  wall.segments = [];
  wall.currentSegment = null;
}
