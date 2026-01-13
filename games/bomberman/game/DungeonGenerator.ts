/**
 * DungeonGenerator - Procedural dungeon floor and room generation
 *
 * Generates rooms with:
 * - Varied layouts (different wall patterns)
 * - Appropriate enemy spawn points
 * - Power-up distribution based on room type
 * - Boss arena layouts
 */

import { GAME_CONFIG, TILE } from '../shared/constants.js';
import {
  DUNGEON_CONFIG,
  ROOM_TYPE,
  ROOM_TYPES,
  ENEMIES,
  type RoomTypeId,
  type EnemyTypeId,
  type EnemySpawn,
  type DungeonRoom,
  getFloorDifficulty,
  selectRandomEnemy,
  getBossForFloor,
  generateFloorRooms,
} from '../shared/dungeon.js';

// Seeded random number generator
class SeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  shuffle<T>(array: T[]): T[] {
    const result = [...array];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
}

export class DungeonGenerator {
  /**
   * Generate all rooms for a floor
   */
  static generateFloor(floor: number, seed: number): DungeonRoom[] {
    const rng = new SeededRandom(seed + floor * 1000);
    const roomTypes = generateFloorRooms(floor);

    return roomTypes.map((type, index) => ({
      index,
      type,
      enemySpawns: [], // Generated when room is entered
      cleared: false,
      bossId: type === ROOM_TYPE.BOSS ? getBossForFloor(floor) || undefined : undefined,
    }));
  }

  /**
   * Generate tiles for a specific room
   */
  static generateRoomTiles(
    roomType: RoomTypeId,
    floor: number,
    seed: number
  ): number[] {
    const rng = new SeededRandom(seed);
    const { GRID_WIDTH, GRID_HEIGHT } = GAME_CONFIG;
    const tiles: number[] = new Array(GRID_WIDTH * GRID_HEIGHT).fill(TILE.EMPTY);

    // Border walls
    for (let x = 0; x < GRID_WIDTH; x++) {
      tiles[x] = TILE.HARD_WALL;
      tiles[(GRID_HEIGHT - 1) * GRID_WIDTH + x] = TILE.HARD_WALL;
    }
    for (let y = 0; y < GRID_HEIGHT; y++) {
      tiles[y * GRID_WIDTH] = TILE.HARD_WALL;
      tiles[y * GRID_WIDTH + (GRID_WIDTH - 1)] = TILE.HARD_WALL;
    }

    // Interior pillars (every other tile, standard Bomberman pattern)
    for (let y = 2; y < GRID_HEIGHT - 1; y += 2) {
      for (let x = 2; x < GRID_WIDTH - 1; x += 2) {
        tiles[y * GRID_WIDTH + x] = TILE.HARD_WALL;
      }
    }

    // Add soft blocks and power-ups based on room type
    const difficulty = getFloorDifficulty(floor);
    const roomDef = ROOM_TYPES[roomType];

    if (roomType === ROOM_TYPE.BOSS) {
      // Boss rooms have open arena with fewer blocks
      this.generateBossArena(tiles, rng, floor);
    } else if (roomType === ROOM_TYPE.REST) {
      // Rest rooms have only power-ups, no destructible blocks in center
      this.generateRestRoom(tiles, rng);
    } else {
      // Normal/Elite/Treasure rooms
      this.generateCombatRoom(tiles, rng, roomDef.powerUpMultiplier * difficulty.powerUpDensity);
    }

    // Clear spawn areas (corners for players, various spots for enemies)
    this.clearSpawnAreas(tiles);

    return tiles;
  }

  /**
   * Generate enemy spawns for a room
   */
  static generateEnemySpawns(
    room: DungeonRoom,
    floor: number,
    playerCount: number,
    seed: number
  ): EnemySpawn[] {
    const rng = new SeededRandom(seed + room.index * 100);
    const difficulty = getFloorDifficulty(floor);
    const roomDef = ROOM_TYPES[room.type];

    // Boss rooms only have the boss
    if (room.type === ROOM_TYPE.BOSS && room.bossId) {
      return [{
        id: `boss_${room.bossId}_${Date.now()}`,
        type: room.bossId,
        gridX: Math.floor(GAME_CONFIG.GRID_WIDTH / 2),
        gridY: Math.floor(GAME_CONFIG.GRID_HEIGHT / 2),
      }];
    }

    // Calculate enemy count
    const baseCount = DUNGEON_CONFIG.BASE_ENEMIES_PER_ROOM;
    const scaledCount = Math.floor(
      baseCount * difficulty.enemyCount * roomDef.enemyMultiplier
    );
    const enemyCount = Math.min(
      scaledCount + Math.floor(playerCount * 0.5),
      DUNGEON_CONFIG.MAX_ENEMIES_PER_ROOM
    );

    // Generate spawn positions (avoid corners where players spawn)
    const spawnPositions = this.getEnemySpawnPositions(enemyCount, rng);

    // Select enemy types
    const spawns: EnemySpawn[] = [];
    for (let i = 0; i < enemyCount; i++) {
      const enemyType = selectRandomEnemy(floor, rng.next() * 1000000);
      const pos = spawnPositions[i];

      spawns.push({
        id: `enemy_${i}_${Date.now()}_${rng.nextInt(0, 9999)}`,
        type: enemyType,
        gridX: pos.x,
        gridY: pos.y,
      });
    }

    return spawns;
  }

  /**
   * Generate a standard combat room layout
   */
  private static generateCombatRoom(
    tiles: number[],
    rng: SeededRandom,
    powerUpDensity: number
  ): void {
    const { GRID_WIDTH, GRID_HEIGHT } = GAME_CONFIG;

    // Add soft blocks
    const softBlockChance = 0.4;
    const powerUpChance = 0.15 * powerUpDensity;

    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
      for (let x = 1; x < GRID_WIDTH - 1; x++) {
        const idx = y * GRID_WIDTH + x;

        // Skip if already a wall
        if (tiles[idx] === TILE.HARD_WALL) continue;

        // Random soft blocks
        if (rng.next() < softBlockChance) {
          tiles[idx] = TILE.SOFT_BLOCK;

          // Some blocks contain power-ups
          if (rng.next() < powerUpChance) {
            const powerUpType = this.randomPowerUp(rng);
            // Store power-up type in upper bits (will be revealed when block destroyed)
            tiles[idx] = TILE.SOFT_BLOCK | (powerUpType << 8);
          }
        }
      }
    }
  }

  /**
   * Generate boss arena layout
   */
  private static generateBossArena(
    tiles: number[],
    rng: SeededRandom,
    floor: number
  ): void {
    const { GRID_WIDTH, GRID_HEIGHT } = GAME_CONFIG;
    const centerX = Math.floor(GRID_WIDTH / 2);
    const centerY = Math.floor(GRID_HEIGHT / 2);

    // Create open center arena (remove some pillars)
    for (let y = 4; y < GRID_HEIGHT - 4; y += 2) {
      for (let x = 4; x < GRID_WIDTH - 4; x += 2) {
        const distFromCenter = Math.abs(x - centerX) + Math.abs(y - centerY);
        if (distFromCenter < 8) {
          const idx = y * GRID_WIDTH + x;
          tiles[idx] = TILE.EMPTY; // Remove pillar
        }
      }
    }

    // Add some cover blocks around the edges
    for (let i = 0; i < 12; i++) {
      const x = rng.nextInt(3, GRID_WIDTH - 4);
      const y = rng.nextInt(3, GRID_HEIGHT - 4);
      const idx = y * GRID_WIDTH + x;

      if (tiles[idx] === TILE.EMPTY) {
        tiles[idx] = TILE.SOFT_BLOCK;
      }
    }
  }

  /**
   * Generate rest room layout (safe room)
   */
  private static generateRestRoom(tiles: number[], rng: SeededRandom): void {
    const { GRID_WIDTH, GRID_HEIGHT } = GAME_CONFIG;

    // Place power-ups in accessible locations
    const powerUpLocations = [
      { x: 5, y: 3 },
      { x: 13, y: 3 },
      { x: 9, y: 7 },
      { x: 5, y: 11 },
      { x: 13, y: 11 },
    ];

    for (const loc of powerUpLocations) {
      const idx = loc.y * GRID_WIDTH + loc.x;
      if (tiles[idx] === TILE.EMPTY) {
        tiles[idx] = this.randomPowerUp(rng);
      }
    }
  }

  /**
   * Clear spawn areas for players and exit
   */
  private static clearSpawnAreas(tiles: number[]): void {
    const { GRID_WIDTH } = GAME_CONFIG;

    // Player spawn corners (2x2 areas)
    const playerSpawns = [
      { x: 1, y: 1 },   // Top-left
      { x: 17, y: 1 },  // Top-right
      { x: 1, y: 13 },  // Bottom-left
      { x: 17, y: 13 }, // Bottom-right
    ];

    for (const spawn of playerSpawns) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const idx = (spawn.y + dy) * GRID_WIDTH + (spawn.x + dx);
          if (tiles[idx] !== TILE.HARD_WALL) {
            tiles[idx] = TILE.EMPTY;
          }
        }
      }
    }

    // Exit area (center-bottom)
    const exitX = 9;
    const exitY = 13;
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const idx = (exitY + dy) * GRID_WIDTH + (exitX + dx);
        if (tiles[idx] !== TILE.HARD_WALL) {
          tiles[idx] = TILE.EMPTY;
        }
      }
    }
  }

  /**
   * Get valid enemy spawn positions
   */
  private static getEnemySpawnPositions(
    count: number,
    rng: SeededRandom
  ): { x: number; y: number }[] {
    const { GRID_WIDTH, GRID_HEIGHT } = GAME_CONFIG;

    // Potential spawn positions (avoid corners where players spawn)
    const potentialPositions: { x: number; y: number }[] = [];

    for (let y = 3; y < GRID_HEIGHT - 3; y++) {
      for (let x = 3; x < GRID_WIDTH - 3; x++) {
        // Skip even coordinates (pillars)
        if (x % 2 === 0 && y % 2 === 0) continue;

        // Avoid very center
        const centerDist = Math.abs(x - 9) + Math.abs(y - 7);
        if (centerDist < 4) continue;

        potentialPositions.push({ x, y });
      }
    }

    // Shuffle and take required count
    return rng.shuffle(potentialPositions).slice(0, count);
  }

  /**
   * Random power-up selection
   */
  private static randomPowerUp(rng: SeededRandom): number {
    const rand = rng.next();

    if (rand < 0.25) return TILE.POWERUP_BOMB;
    if (rand < 0.50) return TILE.POWERUP_FIRE;
    if (rand < 0.65) return TILE.POWERUP_SPEED;
    if (rand < 0.75) return TILE.POWERUP_KICK;
    if (rand < 0.85) return TILE.POWERUP_THROW;
    if (rand < 0.90) return TILE.POWERUP_PUNCH;
    if (rand < 0.95) return TILE.POWERUP_PIERCE;
    return TILE.POWERUP_BOMBPASS;
  }

  /**
   * Get exit tile position for a room
   */
  static getExitPosition(): { x: number; y: number } {
    return { x: 9, y: 13 }; // Center-bottom
  }

  /**
   * Get player spawn positions for PvE (up to 4 players)
   */
  static getPlayerSpawnPositions(): { x: number; y: number }[] {
    return [
      { x: 1, y: 1 },   // Player 1 - Top-left
      { x: 17, y: 1 },  // Player 2 - Top-right
      { x: 1, y: 13 },  // Player 3 - Bottom-left
      { x: 17, y: 13 }, // Player 4 - Bottom-right
    ];
  }
}
