import { GAME_CONFIG, TILE } from '../shared/constants.js';

export class MapGenerator {
  /**
   * Generate a classic Bomberman map with:
   * - Border of hard walls
   * - Grid pattern of hard walls (every other tile)
   * - Random soft blocks (destructible)
   * - Clear spawn areas for players
   */
  static generate(playerCount: number): number[] {
    const { GRID_WIDTH, GRID_HEIGHT } = GAME_CONFIG;
    const tiles: number[] = new Array(GRID_WIDTH * GRID_HEIGHT).fill(TILE.EMPTY);

    // Helper to set tile
    const setTile = (x: number, y: number, value: number) => {
      if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        tiles[y * GRID_WIDTH + x] = value;
      }
    };

    // Helper to get tile
    const getTile = (x: number, y: number): number => {
      if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        return tiles[y * GRID_WIDTH + x];
      }
      return TILE.HARD_WALL; // Out of bounds is wall
    };

    // First pass: set up hard walls in classic pattern
    for (let y = 0; y < GRID_HEIGHT; y++) {
      for (let x = 0; x < GRID_WIDTH; x++) {
        // Border walls
        if (x === 0 || x === GRID_WIDTH - 1 || y === 0 || y === GRID_HEIGHT - 1) {
          setTile(x, y, TILE.HARD_WALL);
        }
        // Interior grid pattern (every other tile on both axes)
        else if (x % 2 === 0 && y % 2 === 0) {
          setTile(x, y, TILE.HARD_WALL);
        }
        else {
          setTile(x, y, TILE.EMPTY);
        }
      }
    }

    // Second pass: add soft blocks randomly (about 60% fill)
    for (let y = 1; y < GRID_HEIGHT - 1; y++) {
      for (let x = 1; x < GRID_WIDTH - 1; x++) {
        if (getTile(x, y) === TILE.EMPTY && Math.random() < 0.6) {
          setTile(x, y, TILE.SOFT_BLOCK);
        }
      }
    }

    // Third pass: clear spawn areas for all 8 spawn positions
    for (const spawn of GAME_CONFIG.SPAWN_POSITIONS) {
      this.clearSpawnArea(tiles, spawn.x, spawn.y);
    }

    return tiles;
  }

  /**
   * Clear a 3x3 area around spawn point (L-shape minimum)
   * This ensures players can move and place initial bombs
   */
  private static clearSpawnArea(tiles: number[], spawnX: number, spawnY: number): void {
    const { GRID_WIDTH, GRID_HEIGHT } = GAME_CONFIG;

    const setTile = (x: number, y: number, value: number) => {
      if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        tiles[y * GRID_WIDTH + x] = value;
      }
    };

    const getTile = (x: number, y: number): number => {
      if (x >= 0 && x < GRID_WIDTH && y >= 0 && y < GRID_HEIGHT) {
        return tiles[y * GRID_WIDTH + x];
      }
      return TILE.HARD_WALL;
    };

    // Clear spawn tile
    if (getTile(spawnX, spawnY) !== TILE.HARD_WALL) {
      setTile(spawnX, spawnY, TILE.EMPTY);
    }

    // Clear adjacent tiles (forming L-shape escape routes)
    const adjacentOffsets = [
      { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
      { x: 2, y: 0 }, { x: -2, y: 0 }, { x: 0, y: 2 }, { x: 0, y: -2 },
    ];

    for (const offset of adjacentOffsets) {
      const x = spawnX + offset.x;
      const y = spawnY + offset.y;
      if (getTile(x, y) !== TILE.HARD_WALL) {
        setTile(x, y, TILE.EMPTY);
      }
    }
  }

  /**
   * Get a random power-up type for when soft blocks are destroyed
   * About 30% chance to spawn a power-up
   */
  static getRandomPowerUp(): number | null {
    if (Math.random() > 0.3) {
      return null; // No power-up
    }

    // Power-up distribution (totals 100%):
    // Common: Bomb 25%, Fire 25%
    // Uncommon: Speed 12%, Kick 10%
    // Rare: Throw 8%, Punch 8%
    // Very Rare: Pierce 5%, Bomb Pass 4%
    // Cursed: Skull 3%
    const roll = Math.random();
    if (roll < 0.25) {
      return TILE.POWERUP_BOMB;     // 25% - extra bomb
    } else if (roll < 0.50) {
      return TILE.POWERUP_FIRE;     // 25% - extra range
    } else if (roll < 0.62) {
      return TILE.POWERUP_SPEED;    // 12% - speed boost
    } else if (roll < 0.72) {
      return TILE.POWERUP_KICK;     // 10% - kick bombs
    } else if (roll < 0.80) {
      return TILE.POWERUP_THROW;    // 8% - throw bombs
    } else if (roll < 0.88) {
      return TILE.POWERUP_PUNCH;    // 8% - punch bombs
    } else if (roll < 0.93) {
      return TILE.POWERUP_PIERCE;   // 5% - pierce explosions
    } else if (roll < 0.97) {
      return TILE.POWERUP_BOMBPASS; // 4% - walk through bombs
    } else {
      return TILE.SKULL;            // 3% - random curse
    }
  }
}
