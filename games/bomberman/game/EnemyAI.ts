/**
 * EnemyAI - AI behavior for PvE enemy bombers
 *
 * Implements different AI behaviors:
 * - Wander: Random movement with occasional bombs
 * - Chase: Follow nearest player
 * - Ambush: Wait then attack
 * - Strategic: Smart bomb placement
 * - Aggressive: Constant pursuit
 * - Boss: Special multi-phase patterns
 */

import type { Room, Player } from '../../../../core/types/core.js';
import type { BombermanPlayerData, BombermanGameState, BombData } from '../types.js';
import { GAME_CONFIG, TILE, DIRECTION, type Direction } from '../shared/constants.js';
import {
  ENEMIES,
  type EnemyTypeId,
  type EnemyState,
  type EnemyBehavior,
  getFloorDifficulty,
} from '../shared/dungeon.js';

export class EnemyAI {
  /**
   * Create initial enemy state from spawn data
   */
  static createEnemyState(
    id: string,
    type: EnemyTypeId,
    gridX: number,
    gridY: number,
    floor: number
  ): EnemyState {
    const def = ENEMIES[type];
    const difficulty = getFloorDifficulty(floor);

    return {
      id,
      type,
      gridX,
      gridY,
      health: def.health,
      maxHealth: def.health,
      alive: true,
      facingDir: DIRECTION.DOWN,
      bombsPlaced: 0,
      maxBombs: def.bombCount,
      fireRange: def.fireRange,
      speed: Math.floor(GAME_CONFIG.PLAYER_MOVE_SPEED / def.speed / difficulty.enemySpeed),
      targetPlayerId: null,
      lastMoveTime: 0,
      lastBombTime: 0,
      aiState: 'patrol',
      patrolPath: [],
      patrolIndex: 0,
      bossPhase: def.isBoss ? 1 : undefined,
      bossAttackCooldown: def.isBoss ? 0 : undefined,
    };
  }

  /**
   * Update all enemies in a room
   */
  static updateEnemies(
    enemies: Map<string, EnemyState>,
    players: Player[],
    gameState: BombermanGameState,
    tiles: number[],
    deltaTime: number,
    floor: number,
    onPlaceBomb: (enemy: EnemyState) => void,
    onMoveEnemy: (enemy: EnemyState, newX: number, newY: number) => void
  ): void {
    const now = Date.now();
    const alivePlayers = players.filter((p) => {
      const data = p.gameData as BombermanPlayerData;
      return data?.alive;
    });

    if (alivePlayers.length === 0) return;

    const difficulty = getFloorDifficulty(floor);

    enemies.forEach((enemy) => {
      if (!enemy.alive) return;

      const def = ENEMIES[enemy.type];

      // Update target
      enemy.targetPlayerId = this.findNearestPlayer(enemy, alivePlayers);

      // Execute behavior based on type
      switch (def.behavior) {
        case 'wander':
          this.updateWanderer(enemy, tiles, gameState, now, deltaTime, difficulty.enemyAggression, onPlaceBomb, onMoveEnemy);
          break;
        case 'chase':
          this.updateChaser(enemy, alivePlayers, tiles, gameState, now, deltaTime, difficulty.enemyAggression, onPlaceBomb, onMoveEnemy);
          break;
        case 'ambush':
          this.updateAmbusher(enemy, alivePlayers, tiles, gameState, now, deltaTime, onPlaceBomb, onMoveEnemy);
          break;
        case 'strategic':
          this.updateStrategic(enemy, alivePlayers, tiles, gameState, now, deltaTime, onPlaceBomb, onMoveEnemy);
          break;
        case 'aggressive':
          this.updateAggressive(enemy, alivePlayers, tiles, gameState, now, deltaTime, onPlaceBomb, onMoveEnemy);
          break;
        case 'boss':
          this.updateBoss(enemy, alivePlayers, tiles, gameState, now, deltaTime, onPlaceBomb, onMoveEnemy);
          break;
      }
    });
  }

  /**
   * Wanderer AI: Random movement, occasional bombs
   */
  private static updateWanderer(
    enemy: EnemyState,
    tiles: number[],
    gameState: BombermanGameState,
    now: number,
    deltaTime: number,
    aggression: number,
    onPlaceBomb: (enemy: EnemyState) => void,
    onMoveEnemy: (enemy: EnemyState, newX: number, newY: number) => void
  ): void {
    // Move randomly
    if (now - enemy.lastMoveTime >= enemy.speed) {
      const dirs = this.getValidMoves(enemy, tiles, gameState);
      if (dirs.length > 0) {
        const dir = dirs[Math.floor(Math.random() * dirs.length)];
        const newPos = this.getPositionInDirection(enemy.gridX, enemy.gridY, dir);
        onMoveEnemy(enemy, newPos.x, newPos.y);
        enemy.facingDir = dir;
        enemy.lastMoveTime = now;
      }
    }

    // Occasionally place bomb
    if (Math.random() < 0.01 * aggression && enemy.bombsPlaced < enemy.maxBombs) {
      if (now - enemy.lastBombTime >= 2000) {
        onPlaceBomb(enemy);
        enemy.lastBombTime = now;
      }
    }
  }

  /**
   * Chaser AI: Follow nearest player
   */
  private static updateChaser(
    enemy: EnemyState,
    players: Player[],
    tiles: number[],
    gameState: BombermanGameState,
    now: number,
    deltaTime: number,
    aggression: number,
    onPlaceBomb: (enemy: EnemyState) => void,
    onMoveEnemy: (enemy: EnemyState, newX: number, newY: number) => void
  ): void {
    const target = players.find((p) => p.id === enemy.targetPlayerId);
    if (!target) return;

    const targetData = target.gameData as BombermanPlayerData;

    // Move towards player
    if (now - enemy.lastMoveTime >= enemy.speed) {
      const bestDir = this.getBestDirectionTowards(
        enemy.gridX, enemy.gridY,
        targetData.gridX, targetData.gridY,
        tiles, gameState
      );

      if (bestDir !== DIRECTION.NONE) {
        const newPos = this.getPositionInDirection(enemy.gridX, enemy.gridY, bestDir);
        onMoveEnemy(enemy, newPos.x, newPos.y);
        enemy.facingDir = bestDir;
        enemy.lastMoveTime = now;
      }
    }

    // Place bomb when close to player
    const dist = Math.abs(enemy.gridX - targetData.gridX) + Math.abs(enemy.gridY - targetData.gridY);
    if (dist <= enemy.fireRange + 1 && enemy.bombsPlaced < enemy.maxBombs) {
      if (now - enemy.lastBombTime >= 1500 && Math.random() < aggression) {
        onPlaceBomb(enemy);
        enemy.lastBombTime = now;
      }
    }
  }

  /**
   * Ambusher AI: Wait for player to approach, then attack
   */
  private static updateAmbusher(
    enemy: EnemyState,
    players: Player[],
    tiles: number[],
    gameState: BombermanGameState,
    now: number,
    deltaTime: number,
    onPlaceBomb: (enemy: EnemyState) => void,
    onMoveEnemy: (enemy: EnemyState, newX: number, newY: number) => void
  ): void {
    const target = players.find((p) => p.id === enemy.targetPlayerId);
    if (!target) return;

    const targetData = target.gameData as BombermanPlayerData;
    const dist = Math.abs(enemy.gridX - targetData.gridX) + Math.abs(enemy.gridY - targetData.gridY);

    // Wait in ambush
    if (dist > enemy.fireRange + 2) {
      enemy.aiState = 'idle';
      return;
    }

    // Player is close - attack!
    enemy.aiState = 'attack';

    // Check if player is in line of fire
    const inLineX = enemy.gridX === targetData.gridX && Math.abs(enemy.gridY - targetData.gridY) <= enemy.fireRange;
    const inLineY = enemy.gridY === targetData.gridY && Math.abs(enemy.gridX - targetData.gridX) <= enemy.fireRange;

    if ((inLineX || inLineY) && enemy.bombsPlaced < enemy.maxBombs) {
      if (now - enemy.lastBombTime >= 2000) {
        onPlaceBomb(enemy);
        enemy.lastBombTime = now;
      }
    }

    // Reposition to get line of sight
    if (now - enemy.lastMoveTime >= enemy.speed) {
      const bestDir = this.getBestDirectionTowards(
        enemy.gridX, enemy.gridY,
        targetData.gridX, targetData.gridY,
        tiles, gameState
      );

      if (bestDir !== DIRECTION.NONE) {
        const newPos = this.getPositionInDirection(enemy.gridX, enemy.gridY, bestDir);
        onMoveEnemy(enemy, newPos.x, newPos.y);
        enemy.facingDir = bestDir;
        enemy.lastMoveTime = now;
      }
    }
  }

  /**
   * Strategic AI: Smart bomb placement to trap players
   */
  private static updateStrategic(
    enemy: EnemyState,
    players: Player[],
    tiles: number[],
    gameState: BombermanGameState,
    now: number,
    deltaTime: number,
    onPlaceBomb: (enemy: EnemyState) => void,
    onMoveEnemy: (enemy: EnemyState, newX: number, newY: number) => void
  ): void {
    const target = players.find((p) => p.id === enemy.targetPlayerId);
    if (!target) return;

    const targetData = target.gameData as BombermanPlayerData;

    // Move to cut off escape routes
    if (now - enemy.lastMoveTime >= enemy.speed) {
      // Try to position to block player's likely escape path
      const escapeDir = this.predictPlayerEscape(targetData, tiles, gameState);
      const interceptPos = this.getInterceptPosition(enemy, targetData, escapeDir);

      if (interceptPos) {
        const bestDir = this.getBestDirectionTowards(
          enemy.gridX, enemy.gridY,
          interceptPos.x, interceptPos.y,
          tiles, gameState
        );

        if (bestDir !== DIRECTION.NONE) {
          const newPos = this.getPositionInDirection(enemy.gridX, enemy.gridY, bestDir);
          onMoveEnemy(enemy, newPos.x, newPos.y);
          enemy.facingDir = bestDir;
          enemy.lastMoveTime = now;
        }
      }
    }

    // Place bombs strategically
    if (enemy.bombsPlaced < enemy.maxBombs && now - enemy.lastBombTime >= 1800) {
      const dist = Math.abs(enemy.gridX - targetData.gridX) + Math.abs(enemy.gridY - targetData.gridY);
      if (dist <= enemy.fireRange + 2) {
        onPlaceBomb(enemy);
        enemy.lastBombTime = now;
      }
    }
  }

  /**
   * Aggressive AI: Constant pursuit and bombing
   */
  private static updateAggressive(
    enemy: EnemyState,
    players: Player[],
    tiles: number[],
    gameState: BombermanGameState,
    now: number,
    deltaTime: number,
    onPlaceBomb: (enemy: EnemyState) => void,
    onMoveEnemy: (enemy: EnemyState, newX: number, newY: number) => void
  ): void {
    const target = players.find((p) => p.id === enemy.targetPlayerId);
    if (!target) return;

    const targetData = target.gameData as BombermanPlayerData;

    // Move aggressively towards player
    if (now - enemy.lastMoveTime >= enemy.speed) {
      const bestDir = this.getBestDirectionTowards(
        enemy.gridX, enemy.gridY,
        targetData.gridX, targetData.gridY,
        tiles, gameState
      );

      if (bestDir !== DIRECTION.NONE) {
        const newPos = this.getPositionInDirection(enemy.gridX, enemy.gridY, bestDir);
        onMoveEnemy(enemy, newPos.x, newPos.y);
        enemy.facingDir = bestDir;
        enemy.lastMoveTime = now;
      }
    }

    // Bomb frequently
    if (enemy.bombsPlaced < enemy.maxBombs && now - enemy.lastBombTime >= 1000) {
      const dist = Math.abs(enemy.gridX - targetData.gridX) + Math.abs(enemy.gridY - targetData.gridY);
      if (dist <= enemy.fireRange + 1) {
        onPlaceBomb(enemy);
        enemy.lastBombTime = now;
      }
    }
  }

  /**
   * Boss AI: Multi-phase attack patterns
   */
  private static updateBoss(
    enemy: EnemyState,
    players: Player[],
    tiles: number[],
    gameState: BombermanGameState,
    now: number,
    deltaTime: number,
    onPlaceBomb: (enemy: EnemyState) => void,
    onMoveEnemy: (enemy: EnemyState, newX: number, newY: number) => void
  ): void {
    // Determine phase based on health
    const healthPercent = enemy.health / enemy.maxHealth;
    if (healthPercent <= 0.3) {
      enemy.bossPhase = 3; // Enraged
    } else if (healthPercent <= 0.6) {
      enemy.bossPhase = 2; // Aggressive
    } else {
      enemy.bossPhase = 1; // Normal
    }

    // Cooldown between attacks
    if (enemy.bossAttackCooldown && enemy.bossAttackCooldown > now) {
      return;
    }

    const target = players.find((p) => p.id === enemy.targetPlayerId);
    if (!target) return;

    const targetData = target.gameData as BombermanPlayerData;

    // Phase-specific behavior
    switch (enemy.bossPhase) {
      case 1: // Normal - methodical movement, occasional bombs
        this.bossPhase1(enemy, targetData, tiles, gameState, now, onPlaceBomb, onMoveEnemy);
        break;
      case 2: // Aggressive - faster, more bombs
        this.bossPhase2(enemy, targetData, tiles, gameState, now, onPlaceBomb, onMoveEnemy);
        break;
      case 3: // Enraged - very fast, constant bombing
        this.bossPhase3(enemy, targetData, tiles, gameState, now, onPlaceBomb, onMoveEnemy);
        break;
    }
  }

  private static bossPhase1(
    enemy: EnemyState,
    target: BombermanPlayerData,
    tiles: number[],
    gameState: BombermanGameState,
    now: number,
    onPlaceBomb: (enemy: EnemyState) => void,
    onMoveEnemy: (enemy: EnemyState, newX: number, newY: number) => void
  ): void {
    // Slow, methodical movement
    if (now - enemy.lastMoveTime >= enemy.speed * 1.5) {
      const bestDir = this.getBestDirectionTowards(
        enemy.gridX, enemy.gridY,
        target.gridX, target.gridY,
        tiles, gameState
      );

      if (bestDir !== DIRECTION.NONE) {
        const newPos = this.getPositionInDirection(enemy.gridX, enemy.gridY, bestDir);
        onMoveEnemy(enemy, newPos.x, newPos.y);
        enemy.facingDir = bestDir;
        enemy.lastMoveTime = now;
      }
    }

    // Place bombs every 3 seconds
    if (enemy.bombsPlaced < enemy.maxBombs && now - enemy.lastBombTime >= 3000) {
      onPlaceBomb(enemy);
      enemy.lastBombTime = now;
    }
  }

  private static bossPhase2(
    enemy: EnemyState,
    target: BombermanPlayerData,
    tiles: number[],
    gameState: BombermanGameState,
    now: number,
    onPlaceBomb: (enemy: EnemyState) => void,
    onMoveEnemy: (enemy: EnemyState, newX: number, newY: number) => void
  ): void {
    // Faster movement
    if (now - enemy.lastMoveTime >= enemy.speed) {
      const bestDir = this.getBestDirectionTowards(
        enemy.gridX, enemy.gridY,
        target.gridX, target.gridY,
        tiles, gameState
      );

      if (bestDir !== DIRECTION.NONE) {
        const newPos = this.getPositionInDirection(enemy.gridX, enemy.gridY, bestDir);
        onMoveEnemy(enemy, newPos.x, newPos.y);
        enemy.facingDir = bestDir;
        enemy.lastMoveTime = now;
      }
    }

    // Place bombs more frequently
    if (enemy.bombsPlaced < enemy.maxBombs && now - enemy.lastBombTime >= 2000) {
      onPlaceBomb(enemy);
      enemy.lastBombTime = now;
    }
  }

  private static bossPhase3(
    enemy: EnemyState,
    target: BombermanPlayerData,
    tiles: number[],
    gameState: BombermanGameState,
    now: number,
    onPlaceBomb: (enemy: EnemyState) => void,
    onMoveEnemy: (enemy: EnemyState, newX: number, newY: number) => void
  ): void {
    // Very fast movement
    if (now - enemy.lastMoveTime >= enemy.speed * 0.7) {
      const bestDir = this.getBestDirectionTowards(
        enemy.gridX, enemy.gridY,
        target.gridX, target.gridY,
        tiles, gameState
      );

      if (bestDir !== DIRECTION.NONE) {
        const newPos = this.getPositionInDirection(enemy.gridX, enemy.gridY, bestDir);
        onMoveEnemy(enemy, newPos.x, newPos.y);
        enemy.facingDir = bestDir;
        enemy.lastMoveTime = now;
      }
    }

    // Constant bombing
    if (enemy.bombsPlaced < enemy.maxBombs && now - enemy.lastBombTime >= 1200) {
      onPlaceBomb(enemy);
      enemy.lastBombTime = now;
    }
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private static findNearestPlayer(enemy: EnemyState, players: Player[]): string | null {
    let nearest: Player | null = null;
    let nearestDist = Infinity;

    for (const player of players) {
      const data = player.gameData as BombermanPlayerData;
      if (!data?.alive) continue;

      const dist = Math.abs(enemy.gridX - data.gridX) + Math.abs(enemy.gridY - data.gridY);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = player;
      }
    }

    return nearest?.id || null;
  }

  private static getValidMoves(
    enemy: EnemyState,
    tiles: number[],
    gameState: BombermanGameState
  ): Direction[] {
    const validDirs: Direction[] = [];
    const dirs = [DIRECTION.UP, DIRECTION.DOWN, DIRECTION.LEFT, DIRECTION.RIGHT];

    for (const dir of dirs) {
      const newPos = this.getPositionInDirection(enemy.gridX, enemy.gridY, dir);
      if (this.isValidPosition(newPos.x, newPos.y, tiles, gameState)) {
        validDirs.push(dir);
      }
    }

    return validDirs;
  }

  private static getBestDirectionTowards(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    tiles: number[],
    gameState: BombermanGameState
  ): Direction {
    const dx = toX - fromX;
    const dy = toY - fromY;

    // Prioritize directions based on distance
    const candidates: { dir: Direction; priority: number }[] = [];

    if (dx > 0) candidates.push({ dir: DIRECTION.RIGHT, priority: Math.abs(dx) });
    if (dx < 0) candidates.push({ dir: DIRECTION.LEFT, priority: Math.abs(dx) });
    if (dy > 0) candidates.push({ dir: DIRECTION.DOWN, priority: Math.abs(dy) });
    if (dy < 0) candidates.push({ dir: DIRECTION.UP, priority: Math.abs(dy) });

    // Sort by priority (larger distance first)
    candidates.sort((a, b) => b.priority - a.priority);

    // Find first valid direction
    for (const { dir } of candidates) {
      const newPos = this.getPositionInDirection(fromX, fromY, dir);
      if (this.isValidPosition(newPos.x, newPos.y, tiles, gameState)) {
        return dir;
      }
    }

    return DIRECTION.NONE;
  }

  private static getPositionInDirection(
    x: number,
    y: number,
    dir: Direction
  ): { x: number; y: number } {
    switch (dir) {
      case DIRECTION.UP: return { x, y: y - 1 };
      case DIRECTION.DOWN: return { x, y: y + 1 };
      case DIRECTION.LEFT: return { x: x - 1, y };
      case DIRECTION.RIGHT: return { x: x + 1, y };
      default: return { x, y };
    }
  }

  private static isValidPosition(
    x: number,
    y: number,
    tiles: number[],
    gameState: BombermanGameState
  ): boolean {
    const { GRID_WIDTH, GRID_HEIGHT } = GAME_CONFIG;

    // Bounds check
    if (x < 0 || x >= GRID_WIDTH || y < 0 || y >= GRID_HEIGHT) {
      return false;
    }

    // Tile check
    const tileValue = tiles[y * GRID_WIDTH + x] & 0xFF; // Mask off power-up bits
    if (tileValue === TILE.HARD_WALL || tileValue === TILE.SOFT_BLOCK) {
      return false;
    }

    // Bomb check
    for (const bomb of gameState.bombs.values()) {
      if (bomb.gridX === x && bomb.gridY === y) {
        return false;
      }
    }

    return true;
  }

  private static predictPlayerEscape(
    player: BombermanPlayerData,
    tiles: number[],
    gameState: BombermanGameState
  ): Direction {
    // Simple heuristic: predict player will move away from bombs
    let threatDir = DIRECTION.NONE;
    let maxThreat = 0;

    for (const bomb of gameState.bombs.values()) {
      const dist = Math.abs(bomb.gridX - player.gridX) + Math.abs(bomb.gridY - player.gridY);
      if (dist <= bomb.range && dist < maxThreat) {
        // Player will likely move away from this bomb
        const dx = player.gridX - bomb.gridX;
        const dy = player.gridY - bomb.gridY;

        if (Math.abs(dx) > Math.abs(dy)) {
          threatDir = dx > 0 ? DIRECTION.RIGHT : DIRECTION.LEFT;
        } else {
          threatDir = dy > 0 ? DIRECTION.DOWN : DIRECTION.UP;
        }
        maxThreat = dist;
      }
    }

    return threatDir;
  }

  private static getInterceptPosition(
    enemy: EnemyState,
    player: BombermanPlayerData,
    escapeDir: Direction
  ): { x: number; y: number } | null {
    // Try to position to cut off the escape direction
    const escapePos = this.getPositionInDirection(player.gridX, player.gridY, escapeDir);

    // If enemy can reach escape position faster, go there
    const enemyDist = Math.abs(enemy.gridX - escapePos.x) + Math.abs(enemy.gridY - escapePos.y);
    const playerDist = 1; // Player is 1 tile away from escape position

    if (enemyDist <= playerDist + 2) {
      return escapePos;
    }

    // Otherwise, just chase the player
    return { x: player.gridX, y: player.gridY };
  }
}
