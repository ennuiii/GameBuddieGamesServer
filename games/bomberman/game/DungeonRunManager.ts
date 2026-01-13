/**
 * DungeonRunManager - Orchestrates PvE dungeon runs
 *
 * Manages:
 * - Run initialization and state
 * - Floor/room transitions
 * - Player state preservation across floors
 * - Enemy spawning and AI updates
 * - Boss encounters
 * - Revival mechanics
 * - Victory/defeat conditions
 */

import { GAME_CONFIG, TILE } from '../shared/constants.js';
import {
  DUNGEON_CONFIG,
  ROOM_TYPE,
  ENEMIES,
  type DungeonRunState,
  type DungeonRoom,
  type PvEPlayerState,
  type EnemyState,
  type EnemySpawn,
  type RoomTypeId,
  createDungeonRunState,
  createPvEPlayerState,
  getFloorDifficulty,
} from '../shared/dungeon.js';
import { DungeonGenerator } from './DungeonGenerator.js';
import { EnemyAI } from './EnemyAI.js';
import { BossManager, type BossState, type BossAction } from './BossManager.js';

// Events emitted by the manager
export type DungeonEvent =
  | { type: 'run_started'; runId: string; floor: number }
  | { type: 'room_entered'; floor: number; roomIndex: number; roomType: RoomTypeId }
  | { type: 'room_cleared'; floor: number; roomIndex: number; xpReward: number }
  | { type: 'floor_completed'; floor: number; xpReward: number }
  | { type: 'enemy_spawned'; enemy: EnemyState }
  | { type: 'enemy_killed'; enemyId: string; xpReward: number }
  | { type: 'boss_spawned'; boss: BossState }
  | { type: 'boss_action'; action: BossAction }
  | { type: 'player_downed'; playerId: string }
  | { type: 'player_revived'; playerId: string; reviverId: string }
  | { type: 'player_eliminated'; playerId: string }
  | { type: 'all_players_eliminated' }
  | { type: 'run_victory'; totalXp: number; totalCoins: number }
  | { type: 'run_defeat'; floor: number; room: number; reason: string }
  | { type: 'tiles_updated'; tiles: number[] }
  | { type: 'exit_revealed'; x: number; y: number };

export interface DungeonRunContext {
  roomCode: string;
  playerIds: string[];
  onEvent: (event: DungeonEvent) => void;
}

export class DungeonRunManager {
  private runState: DungeonRunState;
  private context: DungeonRunContext;
  private tiles: number[] = [];
  private enemies: Map<string, EnemyState> = new Map();
  private boss: BossState | null = null;
  private updateInterval: NodeJS.Timeout | null = null;
  private lastUpdateTime: number = 0;
  private exitRevealed: boolean = false;

  constructor(context: DungeonRunContext) {
    this.context = context;
    this.runState = createDungeonRunState(`run_${context.roomCode}_${Date.now()}`);
  }

  /**
   * Start a new dungeon run
   */
  startRun(): void {
    // Initialize player states
    for (const playerId of this.context.playerIds) {
      this.runState.playerStates.set(playerId, createPvEPlayerState(playerId));
    }

    // Generate first floor
    this.generateFloor(1);

    // Enter first room
    this.enterRoom(0);

    // Start update loop
    this.lastUpdateTime = Date.now();
    this.updateInterval = setInterval(() => this.update(), 50); // 20 FPS for AI

    this.context.onEvent({
      type: 'run_started',
      runId: this.runState.runId,
      floor: 1,
    });
  }

  /**
   * Stop the run (cleanup)
   */
  stopRun(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Generate a floor's rooms
   */
  private generateFloor(floor: number): void {
    this.runState.currentFloor = floor;
    this.runState.floorSeed = Math.floor(Math.random() * 1000000);
    this.runState.rooms = DungeonGenerator.generateFloor(
      floor,
      this.runState.floorSeed
    );
    this.runState.currentRoom = 0;
  }

  /**
   * Enter a specific room
   */
  private enterRoom(roomIndex: number): void {
    const room = this.runState.rooms[roomIndex];
    if (!room) return;

    this.runState.currentRoom = roomIndex;
    this.runState.currentRoomData = room;
    this.exitRevealed = false;

    // Generate tiles for this room
    const seed = this.runState.floorSeed + roomIndex * 1000;
    this.tiles = DungeonGenerator.generateRoomTiles(
      room.type,
      this.runState.currentFloor,
      seed
    );

    this.context.onEvent({ type: 'tiles_updated', tiles: this.tiles });

    // Clear previous enemies
    this.enemies.clear();
    this.boss = null;

    // Spawn enemies or boss
    if (room.type === ROOM_TYPE.BOSS && room.bossId) {
      this.spawnBoss(room);
    } else if (room.type !== ROOM_TYPE.REST) {
      this.spawnEnemies(room);
    }

    this.context.onEvent({
      type: 'room_entered',
      floor: this.runState.currentFloor,
      roomIndex,
      roomType: room.type,
    });
  }

  /**
   * Spawn enemies for a room
   */
  private spawnEnemies(room: DungeonRoom): void {
    const spawns = DungeonGenerator.generateEnemySpawns(
      room,
      this.runState.currentFloor,
      this.context.playerIds.length,
      this.runState.floorSeed + room.index * 100
    );

    for (const spawn of spawns) {
      const enemyDef = ENEMIES[spawn.type];
      const difficulty = getFloorDifficulty(this.runState.currentFloor);

      const enemy: EnemyState = {
        id: spawn.id,
        type: spawn.type,
        gridX: spawn.gridX,
        gridY: spawn.gridY,
        health: enemyDef.health,
        maxHealth: enemyDef.health,
        alive: true,
        facingDir: 0,
        bombsPlaced: 0,
        maxBombs: enemyDef.bombCount,
        fireRange: enemyDef.fireRange,
        speed: enemyDef.speed * difficulty.enemySpeed,
        targetPlayerId: null,
        lastMoveTime: Date.now(),
        lastBombTime: Date.now(),
        aiState: 'patrol',
        patrolPath: [],
        patrolIndex: 0,
      };

      this.enemies.set(spawn.id, enemy);
      this.context.onEvent({ type: 'enemy_spawned', enemy });
    }
  }

  /**
   * Spawn boss for a boss room
   */
  private spawnBoss(room: DungeonRoom): void {
    if (!room.bossId) return;

    const centerX = Math.floor(GAME_CONFIG.GRID_WIDTH / 2);
    const centerY = Math.floor(GAME_CONFIG.GRID_HEIGHT / 2);

    const bossState = BossManager.createBossState(
      `boss_${room.bossId}_${Date.now()}`,
      room.bossId,
      centerX,
      centerY
    );

    if (bossState) {
      this.boss = bossState;
      this.context.onEvent({ type: 'boss_spawned', boss: bossState });
    }
  }

  /**
   * Main update loop
   */
  private update(): void {
    const now = Date.now();
    const deltaTime = now - this.lastUpdateTime;
    this.lastUpdateTime = now;

    if (this.runState.status !== 'active') return;

    // Get player positions for AI
    const playerPositions = this.getActivePlayerPositions();

    // Update enemies
    if (this.enemies.size > 0) {
      const enemyArray = Array.from(this.enemies.values());
      const actions = EnemyAI.updateEnemies(
        enemyArray,
        playerPositions,
        this.tiles,
        deltaTime,
        getFloorDifficulty(this.runState.currentFloor).enemyAggression
      );

      // Process enemy actions (bombs, attacks, etc.)
      // These would be handled by the main game plugin
    }

    // Update boss
    if (this.boss && this.boss.alive) {
      const bossActions = BossManager.updateBoss(
        this.boss,
        playerPositions,
        this.tiles,
        deltaTime
      );

      for (const action of bossActions) {
        this.context.onEvent({ type: 'boss_action', action });
      }
    }

    // Check room clear condition
    this.checkRoomClear();

    // Update downed player timers
    this.updateDownedPlayers(now);
  }

  /**
   * Get positions of alive players
   */
  private getActivePlayerPositions(): {
    id: string;
    gridX: number;
    gridY: number;
    alive: boolean;
  }[] {
    const positions: {
      id: string;
      gridX: number;
      gridY: number;
      alive: boolean;
    }[] = [];

    // In a real implementation, this would get actual player positions
    // from the game state. For now, return spawn positions.
    const spawns = DungeonGenerator.getPlayerSpawnPositions();
    let i = 0;

    for (const [playerId, state] of this.runState.playerStates) {
      if (i < spawns.length) {
        positions.push({
          id: playerId,
          gridX: spawns[i].x,
          gridY: spawns[i].y,
          alive: !state.isDown && state.livesRemaining > 0,
        });
        i++;
      }
    }

    return positions;
  }

  /**
   * Check if room is cleared
   */
  private checkRoomClear(): void {
    const room = this.runState.currentRoomData;
    if (!room || room.cleared) return;

    // Boss room - check if boss is dead
    if (room.type === ROOM_TYPE.BOSS) {
      if (this.boss && !this.boss.alive) {
        this.onRoomCleared();
      }
      return;
    }

    // Normal rooms - check if all enemies are dead
    const aliveEnemies = Array.from(this.enemies.values()).filter(
      (e) => e.alive
    );
    if (aliveEnemies.length === 0) {
      this.onRoomCleared();
    }
  }

  /**
   * Handle room cleared
   */
  private onRoomCleared(): void {
    const room = this.runState.currentRoomData;
    if (!room || room.cleared) return;

    room.cleared = true;
    this.runState.totalRoomsCleared++;

    // Calculate XP reward
    let xpReward = DUNGEON_CONFIG.ROOM_CLEAR_BONUS_XP;
    if (room.type === ROOM_TYPE.BOSS) {
      xpReward = DUNGEON_CONFIG.BOSS_KILL_BONUS_XP;
    } else if (room.type === ROOM_TYPE.ELITE) {
      xpReward = Math.floor(DUNGEON_CONFIG.ROOM_CLEAR_BONUS_XP * 1.5);
    }

    this.runState.xpEarned += xpReward;

    this.context.onEvent({
      type: 'room_cleared',
      floor: this.runState.currentFloor,
      roomIndex: this.runState.currentRoom,
      xpReward,
    });

    // Reveal exit
    if (!this.exitRevealed) {
      this.revealExit();
    }
  }

  /**
   * Reveal exit to next room
   */
  private revealExit(): void {
    const exitPos = DungeonGenerator.getExitPosition();
    this.exitRevealed = true;

    // Update tile to show exit
    const idx = exitPos.y * GAME_CONFIG.GRID_WIDTH + exitPos.x;
    this.tiles[idx] = TILE.EXIT;

    this.context.onEvent({
      type: 'exit_revealed',
      x: exitPos.x,
      y: exitPos.y,
    });
    this.context.onEvent({ type: 'tiles_updated', tiles: this.tiles });
  }

  /**
   * Handle player entering exit
   */
  handleExitEntered(): void {
    const room = this.runState.currentRoomData;
    if (!room || !room.cleared) return;

    const nextRoomIndex = this.runState.currentRoom + 1;

    // Check if floor is complete
    if (nextRoomIndex >= this.runState.rooms.length) {
      this.onFloorComplete();
    } else {
      this.enterRoom(nextRoomIndex);
    }
  }

  /**
   * Handle floor completion
   */
  private onFloorComplete(): void {
    const floorXp = DUNGEON_CONFIG.FLOOR_CLEAR_BONUS_XP;
    this.runState.xpEarned += floorXp;

    this.context.onEvent({
      type: 'floor_completed',
      floor: this.runState.currentFloor,
      xpReward: floorXp,
    });

    // Check for victory
    if (this.runState.currentFloor >= DUNGEON_CONFIG.TOTAL_FLOORS) {
      this.onVictory();
    } else {
      // Start next floor after delay
      setTimeout(() => {
        this.generateFloor(this.runState.currentFloor + 1);
        this.enterRoom(0);
      }, DUNGEON_CONFIG.FLOOR_TRANSITION_DELAY);
    }
  }

  /**
   * Handle run victory
   */
  private onVictory(): void {
    this.runState.status = 'victory';
    this.stopRun();

    // Calculate coins based on performance
    const coins = Math.floor(
      this.runState.totalRoomsCleared * 10 +
        this.runState.totalEnemiesKilled * 2
    );
    this.runState.coinsEarned = coins;

    this.context.onEvent({
      type: 'run_victory',
      totalXp: this.runState.xpEarned,
      totalCoins: coins,
    });
  }

  /**
   * Handle enemy killed
   */
  handleEnemyKilled(enemyId: string): void {
    const enemy = this.enemies.get(enemyId);
    if (!enemy) return;

    enemy.alive = false;
    this.runState.totalEnemiesKilled++;

    const xpReward = ENEMIES[enemy.type].xpReward;
    this.runState.xpEarned += xpReward;

    this.context.onEvent({
      type: 'enemy_killed',
      enemyId,
      xpReward,
    });
  }

  /**
   * Handle boss damaged
   */
  handleBossDamaged(damage: number): void {
    if (!this.boss) return;

    const actions = BossManager.handleDamage(this.boss, damage);
    for (const action of actions) {
      this.context.onEvent({ type: 'boss_action', action });
    }
  }

  /**
   * Handle minion killed (remove from boss tracking)
   */
  handleMinionKilled(minionId: string): void {
    if (this.boss) {
      BossManager.removeMinion(this.boss, minionId);
    }
    this.handleEnemyKilled(minionId);
  }

  /**
   * Handle player death
   */
  handlePlayerDeath(playerId: string): void {
    const playerState = this.runState.playerStates.get(playerId);
    if (!playerState) return;

    playerState.livesRemaining--;

    if (playerState.livesRemaining <= 0) {
      // Player is eliminated
      this.context.onEvent({ type: 'player_eliminated', playerId });
      this.checkAllPlayersEliminated();
    } else {
      // Player is downed, can be revived
      playerState.isDown = true;
      playerState.downTimestamp = Date.now();
      playerState.reviveProgress = 0;

      this.context.onEvent({ type: 'player_downed', playerId });
    }
  }

  /**
   * Handle revival attempt
   */
  handleReviveAttempt(reviverId: string, targetId: string, deltaTime: number): boolean {
    const targetState = this.runState.playerStates.get(targetId);
    const reviverState = this.runState.playerStates.get(reviverId);

    if (!targetState || !reviverState || !targetState.isDown) return false;
    if (reviverState.isDown) return false;

    // Increase revive progress
    const progressRate = deltaTime / DUNGEON_CONFIG.REVIVE_TIME_MS;
    targetState.reviveProgress += progressRate;

    if (targetState.reviveProgress >= 1.0) {
      // Revive complete
      targetState.isDown = false;
      targetState.downTimestamp = 0;
      targetState.reviveProgress = 0;

      this.context.onEvent({
        type: 'player_revived',
        playerId: targetId,
        reviverId,
      });

      return true;
    }

    return false;
  }

  /**
   * Update downed player timers
   */
  private updateDownedPlayers(now: number): void {
    for (const [playerId, state] of this.runState.playerStates) {
      if (state.isDown) {
        const downDuration = now - state.downTimestamp;

        // Auto-eliminate if not revived in time
        if (downDuration >= DUNGEON_CONFIG.REVIVE_TIME_MS * 2) {
          state.livesRemaining = 0;
          state.isDown = false;
          this.context.onEvent({ type: 'player_eliminated', playerId });
          this.checkAllPlayersEliminated();
        }
      }
    }
  }

  /**
   * Check if all players are eliminated
   */
  private checkAllPlayersEliminated(): void {
    let allEliminated = true;

    for (const [, state] of this.runState.playerStates) {
      if (state.livesRemaining > 0) {
        allEliminated = false;
        break;
      }
    }

    if (allEliminated) {
      this.onDefeat('All players eliminated');
    }
  }

  /**
   * Handle run defeat
   */
  private onDefeat(reason: string): void {
    this.runState.status = 'defeat';
    this.runState.defeatReason = reason;
    this.stopRun();

    // Players still get partial rewards
    const coins = Math.floor(this.runState.totalRoomsCleared * 5);
    this.runState.coinsEarned = coins;

    this.context.onEvent({
      type: 'run_defeat',
      floor: this.runState.currentFloor,
      room: this.runState.currentRoom,
      reason,
    });
  }

  /**
   * Apply power-up to player state (preserved across rooms)
   */
  applyPowerUp(playerId: string, powerUpType: number): void {
    const state = this.runState.playerStates.get(playerId);
    if (!state) return;

    switch (powerUpType) {
      case TILE.POWERUP_BOMB:
        state.maxBombs = Math.min(state.maxBombs + 1, 8);
        break;
      case TILE.POWERUP_FIRE:
        state.fireRange = Math.min(state.fireRange + 1, 8);
        break;
      case TILE.POWERUP_SPEED:
        state.speed = Math.min(state.speed + 10, 220);
        break;
      case TILE.POWERUP_KICK:
        state.hasKick = true;
        break;
      case TILE.POWERUP_THROW:
        state.hasThrow = true;
        break;
      case TILE.POWERUP_PUNCH:
        state.hasPunch = true;
        break;
      case TILE.POWERUP_PIERCE:
        state.hasPierce = true;
        break;
    }
  }

  /**
   * Get current run state
   */
  getRunState(): DungeonRunState {
    return this.runState;
  }

  /**
   * Get current tiles
   */
  getTiles(): number[] {
    return this.tiles;
  }

  /**
   * Get all enemies
   */
  getEnemies(): EnemyState[] {
    return Array.from(this.enemies.values());
  }

  /**
   * Get boss state
   */
  getBoss(): BossState | null {
    return this.boss;
  }

  /**
   * Get player state
   */
  getPlayerState(playerId: string): PvEPlayerState | undefined {
    return this.runState.playerStates.get(playerId);
  }

  /**
   * Check if exit is at position
   */
  isExitPosition(x: number, y: number): boolean {
    if (!this.exitRevealed) return false;
    const exitPos = DungeonGenerator.getExitPosition();
    return x === exitPos.x && y === exitPos.y;
  }

  /**
   * Get enemy at position
   */
  getEnemyAtPosition(x: number, y: number): EnemyState | null {
    for (const enemy of this.enemies.values()) {
      if (enemy.alive && enemy.gridX === x && enemy.gridY === y) {
        return enemy;
      }
    }
    return null;
  }

  /**
   * Serialize state for client
   */
  serializeForClient(): SerializedDungeonState {
    return {
      runId: this.runState.runId,
      status: this.runState.status,
      currentFloor: this.runState.currentFloor,
      currentRoom: this.runState.currentRoom,
      totalFloors: DUNGEON_CONFIG.TOTAL_FLOORS,
      roomCount: this.runState.rooms.length,
      roomType: this.runState.currentRoomData?.type || 'normal',
      roomCleared: this.runState.currentRoomData?.cleared || false,
      tiles: this.tiles,
      enemies: Array.from(this.enemies.values()).map((e) => ({
        id: e.id,
        type: e.type,
        gridX: e.gridX,
        gridY: e.gridY,
        health: e.health,
        maxHealth: e.maxHealth,
        alive: e.alive,
        facingDir: e.facingDir,
      })),
      boss: this.boss
        ? {
            id: this.boss.id,
            type: this.boss.type,
            name: this.boss.definition.name,
            gridX: this.boss.gridX,
            gridY: this.boss.gridY,
            health: this.boss.health,
            maxHealth: this.boss.maxHealth,
            alive: this.boss.alive,
            phase: this.boss.currentPhase,
            isEntrancing: this.boss.isEntrancing,
            isEnraged: this.boss.isEnraged,
            currentAttack: this.boss.currentAttack?.type || null,
            fireTrails: this.boss.fireTrailPositions.map((f) => ({
              x: f.x,
              y: f.y,
            })),
            arenaHazards: this.boss.arenaHazards.map((h) => ({
              x: h.x,
              y: h.y,
            })),
          }
        : null,
      playerStates: Object.fromEntries(
        Array.from(this.runState.playerStates.entries()).map(([id, state]) => [
          id,
          {
            livesRemaining: state.livesRemaining,
            maxLives: state.maxLives,
            isDown: state.isDown,
            reviveProgress: state.reviveProgress,
            maxBombs: state.maxBombs,
            fireRange: state.fireRange,
            speed: state.speed,
            hasKick: state.hasKick,
            hasThrow: state.hasThrow,
            hasPunch: state.hasPunch,
            hasPierce: state.hasPierce,
          },
        ])
      ),
      exitRevealed: this.exitRevealed,
      exitPosition: this.exitRevealed
        ? DungeonGenerator.getExitPosition()
        : null,
      xpEarned: this.runState.xpEarned,
      coinsEarned: this.runState.coinsEarned,
      totalRoomsCleared: this.runState.totalRoomsCleared,
      totalEnemiesKilled: this.runState.totalEnemiesKilled,
    };
  }
}

// Serialized state for client
export interface SerializedDungeonState {
  runId: string;
  status: 'active' | 'victory' | 'defeat';
  currentFloor: number;
  currentRoom: number;
  totalFloors: number;
  roomCount: number;
  roomType: RoomTypeId;
  roomCleared: boolean;
  tiles: number[];
  enemies: {
    id: string;
    type: string;
    gridX: number;
    gridY: number;
    health: number;
    maxHealth: number;
    alive: boolean;
    facingDir: number;
  }[];
  boss: {
    id: string;
    type: string;
    name: string;
    gridX: number;
    gridY: number;
    health: number;
    maxHealth: number;
    alive: boolean;
    phase: number;
    isEntrancing: boolean;
    isEnraged: boolean;
    currentAttack: string | null;
    fireTrails: { x: number; y: number }[];
    arenaHazards: { x: number; y: number }[];
  } | null;
  playerStates: Record<
    string,
    {
      livesRemaining: number;
      maxLives: number;
      isDown: boolean;
      reviveProgress: number;
      maxBombs: number;
      fireRange: number;
      speed: number;
      hasKick: boolean;
      hasThrow: boolean;
      hasPunch: boolean;
      hasPierce: boolean;
    }
  >;
  exitRevealed: boolean;
  exitPosition: { x: number; y: number } | null;
  xpEarned: number;
  coinsEarned: number;
  totalRoomsCleared: number;
  totalEnemiesKilled: number;
}
