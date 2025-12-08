/**
 * index.ts - Barrel exports for shared types
 */

// Core types and utilities
export type { Coord, Direction, TurnDir } from './Core.js';
export {
  DIR_UP,
  DIR_DOWN,
  DIR_LEFT,
  DIR_RIGHT,
  DIRECTIONS,
  turnDirection,
  oppositeDirection,
  sameDirection,
  isOppositeDirection,
  normalizeDirection,
  directionToAngle,
  distance,
  distanceSquared,
  lerp,
  addCoord,
  subCoord,
  scaleCoord,
  copyCoord,
  getGridKey,
  snapToGrid,
} from './Core.js';

// Destination types
export type { Destination } from './Destination.js';
export {
  createSpawnDestination,
  destinationBefore,
  findDestinationInsertIndex,
  hasDestination,
} from './Destination.js';

// Wall types
export type { WallSegment, PlayerWall } from './Wall.js';
export {
  createPlayerWall,
  dropWallSegment,
  updateWallHead,
  getWallVertices,
  clearWall,
} from './Wall.js';

// Cycle types
export type { CycleState, CycleSyncData, CycleRenderData } from './Cycle.js';
export {
  createCycle,
  getCycleSyncData,
  applySyncCorrection,
  applyHardSync,
  getCycleRenderData,
} from './Cycle.js';

// Config types
export type { SimulationConfig } from './Config.js';
export {
  DEFAULT_CONFIG,
  SPEED_PRESETS,
  ARENA_PRESETS,
  getActualSpeed,
  validateConfig,
} from './Config.js';