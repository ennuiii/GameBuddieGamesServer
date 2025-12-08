/**
 * index.ts - Barrel exports for shared types
 */

// Core types and utilities
export type { Coord, Direction, TurnDir } from './Core';
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
} from './Core';

// Destination types
export type { Destination } from './Destination';
export {
  createSpawnDestination,
  destinationBefore,
  findDestinationInsertIndex,
  hasDestination,
} from './Destination';

// Wall types
export type { WallSegment, PlayerWall } from './Wall';
export {
  createPlayerWall,
  dropWallSegment,
  updateWallHead,
  getWallVertices,
  clearWall,
} from './Wall';

// Cycle types
export type { CycleState, CycleSyncData, CycleRenderData } from './Cycle';
export {
  createCycle,
  getCycleSyncData,
  applySyncCorrection,
  applyHardSync,
  getCycleRenderData,
} from './Cycle';

// Config types
export type { SimulationConfig } from './Config';
export {
  DEFAULT_CONFIG,
  SPEED_PRESETS,
  ARENA_PRESETS,
  getActualSpeed,
  validateConfig,
} from './Config';
