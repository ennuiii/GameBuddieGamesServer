import { GAME_CONFIG, TILE } from '../shared/constants.js';
import { BombermanGameState, BombermanPlayerData, FallingBlock } from '../types.js';
import { PlayerManager } from './PlayerManager.js';
import type { Room, Player } from '../../../core/types/core.js';

/**
 * Manages Sudden Death - arena shrinking with falling pressure blocks
 * Triggers when match timer reaches SUDDEN_DEATH_TIME remaining
 * Blocks fall from outer edge in a spiral pattern, crushing players
 */
export class SuddenDeathManager {
  // Pre-computed spiral pattern from outer edge inward
  private static spiralPattern: { x: number; y: number }[] = [];
  private static initialized = false;

  /**
   * Initialize the spiral pattern (called once)
   * Creates a clockwise spiral from outer edge moving inward
   */
  static initSpiral(): void {
    if (this.initialized) return;

    const width = GAME_CONFIG.GRID_WIDTH;
    const height = GAME_CONFIG.GRID_HEIGHT;
    this.spiralPattern = [];

    let top = 0;
    let bottom = height - 1;
    let left = 0;
    let right = width - 1;

    while (top <= bottom && left <= right) {
      // Top row (left to right)
      for (let x = left; x <= right; x++) {
        // Skip corners that are already hard walls
        if (this.isValidSpiralCell(x, top)) {
          this.spiralPattern.push({ x, y: top });
        }
      }
      top++;

      // Right column (top to bottom)
      for (let y = top; y <= bottom; y++) {
        if (this.isValidSpiralCell(right, y)) {
          this.spiralPattern.push({ x: right, y });
        }
      }
      right--;

      // Bottom row (right to left)
      if (top <= bottom) {
        for (let x = right; x >= left; x--) {
          if (this.isValidSpiralCell(x, bottom)) {
            this.spiralPattern.push({ x, y: bottom });
          }
        }
        bottom--;
      }

      // Left column (bottom to top)
      if (left <= right) {
        for (let y = bottom; y >= top; y--) {
          if (this.isValidSpiralCell(left, y)) {
            this.spiralPattern.push({ x: left, y });
          }
        }
        left++;
      }
    }

    this.initialized = true;
    console.log(`[Bomberman] Sudden Death spiral initialized with ${this.spiralPattern.length} positions`);
  }

  /**
   * Check if a cell should be included in the spiral
   * Skip cells that are already hard walls (grid pattern)
   */
  private static isValidSpiralCell(x: number, y: number): boolean {
    // Skip the permanent hard wall grid pattern
    // Hard walls exist at odd x AND odd y positions (interior grid)
    // But we want to include all edge positions and non-wall interior
    return true; // Include all - blocks will replace anything except existing hard walls
  }

  /**
   * Update sudden death state (called each game tick)
   */
  static update(
    gameState: BombermanGameState,
    room: Room,
    onPlayerKilled: (player: Player, killerId: string) => void
  ): void {
    // Initialize spiral if needed
    if (!this.initialized) {
      this.initSpiral();
    }

    // Check if sudden death should activate
    if (!gameState.suddenDeathActive) {
      if (gameState.timeRemaining > 0 && gameState.timeRemaining <= GAME_CONFIG.SUDDEN_DEATH_TIME) {
        gameState.suddenDeathActive = true;
        gameState.fallingBlockIndex = 0;
        gameState.lastBlockFallTime = Date.now();
        gameState.fallingBlocks = [];
        console.log('[Bomberman] SUDDEN DEATH activated! Arena is shrinking!');
      }
      return;
    }

    // Clean up old falling blocks (remove after animation time)
    const now = Date.now();
    gameState.fallingBlocks = gameState.fallingBlocks.filter(
      (block) => now - block.fallTime < 2000 // Keep for 2 seconds for client animation
    );

    // Drop blocks on interval
    if (now - gameState.lastBlockFallTime >= GAME_CONFIG.BLOCK_FALL_INTERVAL) {
      this.dropNextBlock(gameState, room, onPlayerKilled);
      gameState.lastBlockFallTime = now;
    }
  }

  /**
   * Drop the next block in the spiral pattern
   */
  static dropNextBlock(
    gameState: BombermanGameState,
    room: Room,
    onPlayerKilled: (player: Player, killerId: string) => void
  ): void {
    // Check if we've dropped all blocks
    if (gameState.fallingBlockIndex >= this.spiralPattern.length) {
      return;
    }

    const pos = this.spiralPattern[gameState.fallingBlockIndex];
    gameState.fallingBlockIndex++;

    // Skip if this position is already a hard wall
    const currentTile = gameState.tiles[pos.y * GAME_CONFIG.GRID_WIDTH + pos.x];
    if (currentTile === TILE.HARD_WALL) {
      // Try the next block immediately
      this.dropNextBlock(gameState, room, onPlayerKilled);
      return;
    }

    // Kill any player at this position
    room.players.forEach((player) => {
      const pd = player.gameData as BombermanPlayerData;
      if (pd && pd.gridX === pos.x && pd.gridY === pos.y && pd.alive) {
        onPlayerKilled(player, 'arena');
      }
    });

    // Place hard wall (pressure block)
    gameState.tiles[pos.y * GAME_CONFIG.GRID_WIDTH + pos.x] = TILE.HARD_WALL;

    // Track for client animation
    const fallingBlock: FallingBlock = {
      x: pos.x,
      y: pos.y,
      fallTime: Date.now(),
    };
    gameState.fallingBlocks.push(fallingBlock);
  }

  /**
   * Reset sudden death state for a new game
   */
  static reset(gameState: BombermanGameState): void {
    gameState.suddenDeathActive = false;
    gameState.lastBlockFallTime = 0;
    gameState.fallingBlockIndex = 0;
    gameState.fallingBlocks = [];
  }

  /**
   * Check if sudden death is active
   */
  static isActive(gameState: BombermanGameState): boolean {
    return gameState.suddenDeathActive;
  }

  /**
   * Get the number of blocks remaining to fall
   */
  static getRemainingBlocks(gameState: BombermanGameState): number {
    return Math.max(0, this.spiralPattern.length - gameState.fallingBlockIndex);
  }
}
