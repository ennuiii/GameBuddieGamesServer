/**
 * Simulation.ts - Core deterministic game simulation
 *
 * This runs IDENTICALLY on both client and server.
 * Inspired by Armagetron's approach where movement is deterministic
 * and only turn commands (destinations) need to be synchronized.
 *
 * Key features:
 * - Fixed timestep simulation
 * - Destination-based turns
 * - Bresenham line rasterization for trail collision
 * - Distance-based wall segments
 */

import type {
  Coord,
  Direction,
  TurnDir,
  Destination,
  CycleState,
  CycleSyncData,
  PlayerWall,
  WallSegment,
  SimulationConfig,
} from '../types';

import {
  turnDirection,
  copyCoord,
  getGridKey,
  createCycle,
  hasDestination,
  findDestinationInsertIndex,
  createPlayerWall,
  dropWallSegment,
  updateWallHead,
  getWallVertices,
  DEFAULT_CONFIG,
  getActualSpeed,
} from '../types';

// ===========================================
// DEBUG FLAG
// ===========================================
const DEBUG_SIMULATION = true;

// ===========================================
// ELIMINATION RESULT
// ===========================================

export interface Elimination {
  playerId: string;
  position: Coord;
  hitType: 'wall' | 'trail' | 'self';
  hitPlayerId?: string;
}

// ===========================================
// SIMULATION CLASS
// ===========================================

export class Simulation {
  private cycles: Map<string, CycleState> = new Map();
  private walls: Map<string, PlayerWall> = new Map();
  private gameTime: number = 0;
  private config: SimulationConfig;

  // Collision grid: "gridX,gridZ" -> playerId who owns it
  private collisionGrid: Map<string, string> = new Map();

  // Message counter for destination IDs
  private messageCounter: number = 0;

  constructor(config: Partial<SimulationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ===========================================
  // GETTERS
  // ===========================================

  public getGameTime(): number {
    return this.gameTime;
  }

  public getConfig(): SimulationConfig {
    return this.config;
  }

  public getSpeed(): number {
    return getActualSpeed(this.config);
  }

  public getCycle(id: string): CycleState | undefined {
    return this.cycles.get(id);
  }

  public getAllCycles(): Map<string, CycleState> {
    return this.cycles;
  }

  public getWall(playerId: string): PlayerWall | undefined {
    return this.walls.get(playerId);
  }

  public getAllWalls(): Map<string, PlayerWall> {
    return this.walls;
  }

  // ===========================================
  // SIMULATION TICK
  // ===========================================

  /**
   * Advance simulation by dt seconds
   * Returns list of eliminations
   */
  public tick(dt: number): Elimination[] {
    this.gameTime += dt;
    const eliminations: Elimination[] = [];

    for (const [id, cycle] of this.cycles) {
      if (!cycle.alive) continue;

      // 1. Save previous position
      const prevPos = copyCoord(cycle.position);

      // 2. Move cycle
      const moveDistance = cycle.speed * dt;
      cycle.position.x += cycle.direction.x * moveDistance;
      cycle.position.z += cycle.direction.z * moveDistance;
      cycle.distance += moveDistance;
      cycle.lastTime = this.gameTime;

      if (DEBUG_SIMULATION && cycle.distance < 20) {
        console.log(`[SIM TICK] id=${id.slice(-4)} pos=(${cycle.position.x.toFixed(2)}, ${cycle.position.z.toFixed(2)}) dist=${cycle.distance.toFixed(2)} dir=(${cycle.direction.x}, ${cycle.direction.z})`);
      }

      // 3. Check collisions FIRST (before marking trail)
      const collision = this.checkCollision(cycle, prevPos);
      if (collision) {
        if (DEBUG_SIMULATION) {
          console.log(`[SIM COLLISION] id=${id.slice(-4)} hitType=${collision.hitType} at pos=(${collision.position.x}, ${collision.position.z}) distance=${cycle.distance.toFixed(2)}`);
        }
        eliminations.push(collision);
        continue; // Don't mark trail if dead
      }

      // 4. Mark trail on collision grid (only if still alive AND no wrap occurred)
      // Detect wrap by checking if position jumped more than expected
      const jumpX = Math.abs(cycle.position.x - prevPos.x);
      const jumpZ = Math.abs(cycle.position.z - prevPos.z);
      const maxNormalJump = moveDistance * 2; // Tolerance for normal movement

      if (jumpX <= maxNormalJump && jumpZ <= maxNormalJump) {
        // Normal movement - mark trail
        this.markTrailPath(id, prevPos, cycle.position);
      }
      // For wrap: skip trail marking, createWrapDestination already handled wall break

      // 5. Update wall head
      const wall = this.walls.get(id);
      if (wall) {
        updateWallHead(wall, cycle.position, cycle.distance, this.gameTime);
      }
    }

    return eliminations;
  }

  // ===========================================
  // TURN HANDLING
  // ===========================================

  /**
   * Apply a turn command (local player)
   * Returns the destination if valid, null otherwise
   */
  public applyTurn(
    playerId: string,
    turnDir: TurnDir,
    messageId?: number
  ): Destination | null {
    const cycle = this.cycles.get(playerId);
    if (!cycle || !cycle.alive) return null;

    // Check turn delay
    if (this.gameTime - cycle.lastTurnTime < this.config.turnDelay) {
      return null;
    }

    // Calculate new direction
    const newDir = turnDirection(cycle.direction, turnDir);

    // Create destination
    const dest: Destination = {
      position: copyCoord(cycle.position),
      direction: newDir,
      distance: cycle.distance,
      gameTime: this.gameTime,
      messageId: messageId ?? ++this.messageCounter,
      playerId,
    };

    // Apply to cycle
    cycle.direction = newDir;
    cycle.lastTurnPosition = copyCoord(cycle.position);
    cycle.lastTurnTime = this.gameTime;
    cycle.turnCount++;
    cycle.destinations.push(dest);

    // Drop wall (end current segment, start new one)
    const wall = this.walls.get(playerId);
    if (wall) {
      dropWallSegment(wall, cycle.position, cycle.distance, this.gameTime);
    }

    return dest;
  }

  /**
   * Apply a destination from network (for remote players)
   */
  public applyDestination(dest: Destination): void {
    const cycle = this.cycles.get(dest.playerId);
    if (!cycle) return;

    // Check if we already have this destination
    if (hasDestination(cycle.destinations, dest.messageId, dest.playerId)) {
      return;
    }

    // Insert in order
    const insertIndex = findDestinationInsertIndex(cycle.destinations, dest);
    cycle.destinations.splice(insertIndex, 0, dest);

    // If this is the latest destination, update direction
    if (insertIndex === cycle.destinations.length - 1) {
      cycle.direction = { ...dest.direction };
    }

    // Drop wall at destination position
    const wall = this.walls.get(dest.playerId);
    if (wall) {
      dropWallSegment(wall, dest.position, dest.distance, dest.gameTime);
    }
  }

  // ===========================================
  // COLLISION DETECTION
  // ===========================================

  /**
   * Mark all grid cells along movement path using Bresenham's algorithm
   */
  private markTrailPath(playerId: string, from: Coord, to: Coord): void {
    const gridSize = this.config.gridSize;

    const x0 = Math.floor(from.x / gridSize);
    const z0 = Math.floor(from.z / gridSize);
    const x1 = Math.floor(to.x / gridSize);
    const z1 = Math.floor(to.z / gridSize);

    // Bresenham's line algorithm
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;

    let x = x0;
    let z = z0;

    while (true) {
      const key = `${x},${z}`;
      if (!this.collisionGrid.has(key)) {
        this.collisionGrid.set(key, playerId);
      }

      if (x === x1 && z === z1) break;

      const e2 = 2 * err;
      if (e2 > -dz) {
        err -= dz;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        z += sz;
      }
    }
  }

  /**
   * Check for collisions
   */
  private checkCollision(cycle: CycleState, prevPos: Coord): Elimination | null {
    const pos = cycle.position;
    const halfArena = this.config.arenaSize / 2;

    // 1. Arena boundary check
    if (this.config.wrapAround) {
      // Wrap to opposite side
      let wrapped = false;

      if (pos.x < -halfArena) {
        pos.x = halfArena - 0.1;
        wrapped = true;
      } else if (pos.x > halfArena) {
        pos.x = -halfArena + 0.1;
        wrapped = true;
      }

      if (pos.z < -halfArena) {
        pos.z = halfArena - 0.1;
        wrapped = true;
      } else if (pos.z > halfArena) {
        pos.z = -halfArena + 0.1;
        wrapped = true;
      }

      // If wrapped, create a destination to break trail
      if (wrapped) {
        this.createWrapDestination(cycle);
        // Skip collision check for this tick - the path from pre-wrap to post-wrap
        // spans the entire arena and would cause false self-collisions
        return null;
      }
    } else {
      // Wall collision (death)
      if (
        pos.x < -halfArena ||
        pos.x > halfArena ||
        pos.z < -halfArena ||
        pos.z > halfArena
      ) {
        return {
          playerId: cycle.id,
          position: copyCoord(pos),
          hitType: 'wall',
        };
      }
    }

    // 2. Trail collision - check all cells along movement path
    const collision = this.checkPathCollision(cycle, prevPos);
    if (collision) {
      return collision;
    }

    return null;
  }

  /**
   * Check collision along the movement path
   */
  private checkPathCollision(cycle: CycleState, from: Coord): Elimination | null {
    const gridSize = this.config.gridSize;
    const to = cycle.position;

    const x0 = Math.floor(from.x / gridSize);
    const z0 = Math.floor(from.z / gridSize);
    const x1 = Math.floor(to.x / gridSize);
    const z1 = Math.floor(to.z / gridSize);

    // Bresenham to check all cells
    const dx = Math.abs(x1 - x0);
    const dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1;
    const sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;

    let x = x0;
    let z = z0;
    let first = true;

    while (true) {
      // Skip the first cell (where we started)
      if (!first) {
        const key = `${x},${z}`;
        const owner = this.collisionGrid.get(key);

        if (DEBUG_SIMULATION && owner && cycle.distance < 20) {
          console.log(`[SIM PATH_CHECK] cell=(${x},${z}) key=${key} owner=${owner?.slice(-4)} cycleId=${cycle.id.slice(-4)} dist=${cycle.distance.toFixed(2)}`);
        }

        if (owner) {
          // Check collision type
          if (owner !== cycle.id) {
            // Hit another player's trail
            if (DEBUG_SIMULATION) {
              console.log(`[SIM HIT_OTHER] cell=${key} owner=${owner.slice(-4)} != cycle=${cycle.id.slice(-4)}`);
            }
            return {
              playerId: cycle.id,
              position: { x: x * gridSize, z: z * gridSize },
              hitType: 'trail',
              hitPlayerId: owner,
            };
          } else if (this.config.selfCollision) {
            // Self-collision - but only if we've traveled enough
            // (to avoid hitting our immediate trail)
            if (cycle.distance > gridSize * 3) {
              // Also check distance from spawn position to avoid
              // false positives when crossing near spawn cell
              const spawnPos = cycle.destinations[0]?.position;
              if (spawnPos) {
                const cellWorldX = x * gridSize;
                const cellWorldZ = z * gridSize;
                const dxSpawn = cellWorldX - spawnPos.x;
                const dzSpawn = cellWorldZ - spawnPos.z;
                const distFromSpawnSq = dxSpawn * dxSpawn + dzSpawn * dzSpawn;
                const minDistSq = (gridSize * 4) * (gridSize * 4);

                if (DEBUG_SIMULATION) {
                  console.log(`[SIM SELF_CHECK] cell=(${x},${z}) distFromSpawnSq=${distFromSpawnSq.toFixed(2)} minDistSq=${minDistSq} spawnPos=(${spawnPos.x.toFixed(2)}, ${spawnPos.z.toFixed(2)})`);
                }

                // Skip if cell is too close to spawn
                if (distFromSpawnSq < minDistSq) {
                  // Not a self-collision, continue checking
                  if (DEBUG_SIMULATION) {
                    console.log(`[SIM SELF_SKIP] near spawn, skipping`);
                  }
                } else {
                  if (DEBUG_SIMULATION) {
                    console.log(`[SIM SELF_HIT] far from spawn, COLLISION!`);
                  }
                  return {
                    playerId: cycle.id,
                    position: { x: cellWorldX, z: cellWorldZ },
                    hitType: 'self',
                  };
                }
              } else {
                if (DEBUG_SIMULATION) {
                  console.log(`[SIM SELF_HIT] no spawnPos, COLLISION!`);
                }
                return {
                  playerId: cycle.id,
                  position: { x: x * gridSize, z: z * gridSize },
                  hitType: 'self',
                };
              }
            }
          }
        }
      }
      first = false;

      if (x === x1 && z === z1) break;

      const e2 = 2 * err;
      if (e2 > -dz) {
        err -= dz;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        z += sz;
      }
    }

    return null;
  }

  /**
   * Create a destination at wrap point to break trail
   */
  private createWrapDestination(cycle: CycleState): void {
    const dest: Destination = {
      position: copyCoord(cycle.position),
      direction: { ...cycle.direction },
      distance: cycle.distance,
      gameTime: this.gameTime,
      messageId: ++this.messageCounter,
      playerId: cycle.id,
    };
    cycle.destinations.push(dest);

    // Also drop wall segment
    const wall = this.walls.get(cycle.id);
    if (wall) {
      dropWallSegment(wall, cycle.position, cycle.distance, this.gameTime);
    }
  }

  // ===========================================
  // PLAYER MANAGEMENT
  // ===========================================

  /**
   * Add a player/cycle to the simulation
   */
  public addCycle(
    id: string,
    position: Coord,
    direction: Direction,
    color: string = '#00ffff'
  ): void {
    const speed = this.getSpeed();
    const cycle = createCycle(id, position, direction, speed, this.gameTime, color);
    this.cycles.set(id, cycle);

    // Create wall
    const wall = createPlayerWall(id, position, this.gameTime);
    this.walls.set(id, wall);

    // Mark spawn position
    const spawnGridKey = getGridKey(position, this.config.gridSize);
    this.collisionGrid.set(spawnGridKey, id);

    if (DEBUG_SIMULATION) {
      console.log(`[SIM ADD_CYCLE] id=${id.slice(-4)} spawn=(${position.x.toFixed(2)}, ${position.z.toFixed(2)}) gridKey=${spawnGridKey} speed=${speed} gridSize=${this.config.gridSize}`);
      console.log(`[SIM ADD_CYCLE] spawnDest[0]=${JSON.stringify(cycle.destinations[0]?.position)}`);
    }
  }

  /**
   * Remove a player from the simulation
   */
  public removeCycle(id: string): void {
    this.cycles.delete(id);
    this.walls.delete(id);
    // Note: we don't remove from collisionGrid - trails persist
  }

  /**
   * Mark a player as eliminated
   */
  public eliminateCycle(id: string): void {
    const cycle = this.cycles.get(id);
    if (cycle) {
      cycle.alive = false;
    }
  }

  /**
   * Get alive cycle count
   */
  public getAliveCount(): number {
    let count = 0;
    for (const cycle of this.cycles.values()) {
      if (cycle.alive) count++;
    }
    return count;
  }

  /**
   * Get the last alive cycle (winner)
   */
  public getWinner(): CycleState | null {
    for (const cycle of this.cycles.values()) {
      if (cycle.alive) return cycle;
    }
    return null;
  }

  // ===========================================
  // SYNC / CORRECTION
  // ===========================================

  /**
   * Apply sync correction (soft - for minor drift)
   */
  public applySyncCorrection(
    playerId: string,
    serverPos: Coord,
    strength: number = 0.1
  ): void {
    const cycle = this.cycles.get(playerId);
    if (!cycle) return;

    cycle.position.x += (serverPos.x - cycle.position.x) * strength;
    cycle.position.z += (serverPos.z - cycle.position.z) * strength;
  }

  /**
   * Apply hard sync (for reconnection or major desync)
   */
  public hardSync(
    playerId: string,
    serverPos: Coord,
    serverDir: Direction,
    serverDistance: number
  ): void {
    const cycle = this.cycles.get(playerId);
    if (!cycle) return;

    cycle.position = copyCoord(serverPos);
    cycle.direction = { ...serverDir };
    cycle.distance = serverDistance;
  }

  /**
   * Get state for sync broadcast
   */
  public getSyncState(): CycleSyncData[] {
    const states: CycleSyncData[] = [];
    for (const cycle of this.cycles.values()) {
      states.push({
        id: cycle.id,
        position: copyCoord(cycle.position),
        direction: { ...cycle.direction },
        distance: cycle.distance,
        speed: cycle.speed,
        alive: cycle.alive,
      });
    }
    return states;
  }

  // ===========================================
  // GAME STATE MANAGEMENT
  // ===========================================

  /**
   * Reset simulation for a new round
   */
  public reset(): void {
    this.cycles.clear();
    this.walls.clear();
    this.collisionGrid.clear();
    this.gameTime = 0;
    this.messageCounter = 0;
  }

  /**
   * Clear all trails (for new round without removing players)
   */
  public clearTrails(): void {
    this.collisionGrid.clear();
    for (const wall of this.walls.values()) {
      wall.segments = [];
      wall.currentSegment = null;
    }
    for (const cycle of this.cycles.values()) {
      cycle.destinations = [cycle.destinations[0]]; // Keep spawn
      cycle.distance = 0;
    }
  }

  /**
   * Update config
   */
  public updateConfig(config: Partial<SimulationConfig>): void {
    this.config = { ...this.config, ...config };
    const speed = this.getSpeed();
    for (const cycle of this.cycles.values()) {
      cycle.speed = speed;
    }
  }

  // ===========================================
  // TRAIL DATA FOR RENDERING
  // ===========================================

  /**
   * Get wall vertices for rendering
   */
  public getWallVertices(playerId: string): Coord[] {
    const wall = this.walls.get(playerId);
    if (!wall) return [];
    return getWallVertices(wall);
  }

  /**
   * Get all wall segments for a player
   */
  public getWallSegments(playerId: string): WallSegment[] {
    const wall = this.walls.get(playerId);
    if (!wall) return [];

    const segments = [...wall.segments];
    if (wall.currentSegment) {
      segments.push(wall.currentSegment);
    }
    return segments;
  }
}

export default Simulation;
