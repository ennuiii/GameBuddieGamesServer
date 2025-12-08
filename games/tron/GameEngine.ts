/**
 * TronGameEngine - Server-side game simulation
 *
 * Uses the Armagetron-inspired Simulation class for deterministic
 * movement. Only turn commands (destinations) are broadcast immediately;
 * full state sync happens periodically for drift correction.
 */

import type { Room, Player } from '../../core/types/core.js';
import { Simulation, Elimination } from './shared/simulation/Simulation.js';
import type { Coord, Direction, CycleSyncData, Destination } from './shared/types/index.js';
import {
  TronGameState,
  TronPlayerData,
  TronSettings,
  DirectionString,
  getSpawnPositions,
  directionToString,
  getTurnDirection,
  GRID_SPACING,
} from './types.js';

export type GameEventCallback = (event: string, data: any) => void;

// Debug logging
const DEBUG = false;
const logDebug = (label: string, payload: Record<string, unknown>): void => {
  if (DEBUG) {
    console.log(`[TronEngine] ${label}`, JSON.stringify(payload));
  }
};

// ===========================================
// CONSTANTS
// ===========================================

const TICK_RATE = 60;             // Server simulation rate (Hz)
const SYNC_INTERVAL_MS = 500;     // Full state sync interval
const BASE_SPEED = 20;            // Units per second at gameSpeed=1

// ===========================================
// GAME ENGINE
// ===========================================

export class TronGameEngine {
  private room: Room;
  private simulation: Simulation;
  private tickInterval: NodeJS.Timeout | null = null;
  private countdownInterval: NodeJS.Timeout | null = null;
  private roundRestartTimeout: NodeJS.Timeout | null = null;
  private isStopped: boolean = false;
  private onEvent: GameEventCallback;

  // Timing
  private lastTickTime: number = 0;
  private lastSyncTime: number = 0;
  private messageCounter: number = 0;

  // Track last turn for rate limiting (anti-cheat)
  private lastTurnTime: Map<string, number> = new Map();
  private readonly MIN_TURN_INTERVAL_MS = 50;

  constructor(room: Room, onEvent: GameEventCallback) {
    this.room = room;
    this.onEvent = onEvent;

    // Initialize simulation with room settings
    const settings = this.getSettings();
    this.simulation = new Simulation({
      arenaSize: settings.arenaSize,
      baseSpeed: BASE_SPEED,
      speedMultiplier: settings.gameSpeed,
      gridSize: GRID_SPACING,
      wrapAround: true,
      selfCollision: true,
      turnDelay: 0.1,
    });
  }

  // ===========================================
  // ACCESSORS
  // ===========================================

  private getGameState(): TronGameState {
    return this.room.gameState.data as TronGameState;
  }

  private getPlayerData(player: Player): TronPlayerData {
    return player.gameData as TronPlayerData;
  }

  private getSettings(): TronSettings {
    return this.getGameState().settings;
  }

  // ===========================================
  // GAME FLOW
  // ===========================================

  public startGame(): void {
    console.log('[TronEngine] Starting game...');
    const gameState = this.getGameState();
    gameState.currentRound = 1;
    this.startCountdown();
  }

  private startCountdown(): void {
    if (this.isStopped || this.room.players.size < 1) {
      console.log('[TronEngine] No players or stopped, skipping countdown');
      return;
    }

    console.log('[TronEngine] Starting countdown...');
    const gameState = this.getGameState();
    gameState.phase = 'countdown';
    gameState.countdown = 3;

    // Reset players and simulation for new round
    this.resetForRound();

    this.onEvent('roomStateUpdated', null);
    console.log('[TronEngine] Countdown: 3');

    this.countdownInterval = setInterval(() => {
      const state = this.getGameState();
      state.countdown--;
      console.log('[TronEngine] Countdown:', state.countdown);

      this.onEvent('tron:countdown', { value: state.countdown });

      if (state.countdown <= 0) {
        if (this.countdownInterval) {
          clearInterval(this.countdownInterval);
          this.countdownInterval = null;
        }
        this.startRound();
      }
    }, 1000);
  }

  private resetForRound(): void {
    const settings = this.getSettings();
    const spawns = getSpawnPositions(settings.arenaSize);

    // Reset simulation
    this.simulation.reset();
    this.simulation.updateConfig({
      arenaSize: settings.arenaSize,
      speedMultiplier: settings.gameSpeed,
    });

    // Reset timing
    this.lastTurnTime.clear();
    this.messageCounter = 0;

    // Add players to simulation
    let spawnIndex = 0;
    this.room.players.forEach((player) => {
      const spawn = spawns[spawnIndex % spawns.length];
      const playerData = this.getPlayerData(player);

      // Add to simulation
      this.simulation.addCycle(
        player.socketId,
        spawn.position,
        spawn.direction,
        playerData.color
      );

      // Update room player data
      playerData.isAlive = true;
      playerData.position = { ...spawn.position };
      playerData.direction = directionToString(spawn.direction);
      playerData.trail = [{ ...spawn.position, timestamp: Date.now() }];
      playerData.eliminatedBy = null;

      spawnIndex++;
    });
  }

  private startRound(): void {
    console.log('[TronEngine] Starting round...');
    const gameState = this.getGameState();
    gameState.phase = 'playing';
    gameState.roundWinner = null;

    // Reset timing
    this.lastTickTime = Date.now() - (1000 / TICK_RATE);
    this.lastSyncTime = Date.now();

    // Gather player spawn data
    const playersData: Array<{
      id: string;
      position: Coord;
      direction: Direction;
      color: string;
    }> = [];

    this.room.players.forEach((player) => {
      const cycle = this.simulation.getCycle(player.socketId);
      const playerData = this.getPlayerData(player);
      if (cycle) {
        playersData.push({
          id: player.socketId,
          position: { ...cycle.position },
          direction: { ...cycle.direction },
          color: playerData.color,
        });
      }
    });

    this.onEvent('roomStateUpdated', null);
    this.onEvent('tron:roundStart', {
      round: gameState.currentRound,
      gameTime: this.simulation.getGameTime(),
      players: playersData,
      config: this.simulation.getConfig(),
    });

    // Start game loop
    console.log('[TronEngine] Starting tick loop at', TICK_RATE, 'Hz');
    this.tickInterval = setInterval(() => this.tick(), 1000 / TICK_RATE);
  }

  // ===========================================
  // SIMULATION TICK
  // ===========================================

  private tick(): void {
    if (this.isStopped) return;

    const now = Date.now();
    const dt = (now - this.lastTickTime) / 1000;
    this.lastTickTime = now;

    // Advance simulation
    const eliminations = this.simulation.tick(dt);

    // Handle eliminations
    for (const elim of eliminations) {
      this.handleElimination(elim);
    }

    // Sync player data to room
    this.syncPlayerDataToRoom();

    // Periodic full sync
    if (now - this.lastSyncTime >= SYNC_INTERVAL_MS) {
      this.broadcastFullSync();
      this.lastSyncTime = now;
    }

    // Check round end
    this.checkRoundEnd();
  }

  private handleElimination(elim: Elimination): void {
    const player = this.room.players.get(elim.playerId);
    if (!player) return;

    const playerData = this.getPlayerData(player);
    playerData.isAlive = false;

    // Determine what they hit
    let eliminatedBy = 'wall';
    if (elim.hitType === 'trail') {
      eliminatedBy = elim.hitPlayerId || 'trail';
    } else if (elim.hitType === 'self') {
      eliminatedBy = 'self';
    }
    playerData.eliminatedBy = eliminatedBy;

    // Mark in simulation
    this.simulation.eliminateCycle(elim.playerId);

    logDebug('Eliminated', {
      player: elim.playerId,
      hitType: elim.hitType,
      position: elim.position,
    });

    // Broadcast elimination
    this.onEvent('tron:eliminated', {
      playerId: elim.playerId,
      position: elim.position,
      hitType: elim.hitType,
      eliminatedBy,
      color: playerData.color,
    });
  }

  // Debug throttling for sync logging
  private static syncLogCount = 0;
  private static readonly SYNC_LOG_INTERVAL = 60;

  private syncPlayerDataToRoom(): void {
    const shouldLog = ++TronGameEngine.syncLogCount % TronGameEngine.SYNC_LOG_INTERVAL === 1;

    this.room.players.forEach((player) => {
      const cycle = this.simulation.getCycle(player.socketId);
      if (!cycle) return;

      const playerData = this.getPlayerData(player);
      playerData.position = { ...cycle.position };
      playerData.direction = directionToString(cycle.direction);
      playerData.isAlive = cycle.alive;

      // Get wall vertices for trail
      const vertices = this.simulation.getWallVertices(player.socketId);
      playerData.trail = vertices.map(v => ({ x: v.x, z: v.z, timestamp: Date.now() }));

      if (shouldLog) {
        console.log(`[SERVER SYNC] player=${player.socketId.slice(-4)} pos=(${cycle.position.x.toFixed(1)},${cycle.position.z.toFixed(1)}) vertices=${vertices.length} alive=${cycle.alive}`);
      }
    });
  }

  // ===========================================
  // NETWORK EVENTS
  // ===========================================

  /**
   * Handle turn input from client
   * Accepts both TurnDir (-1/1) and legacy direction strings
   */
  public handleDirectionChange(playerId: string, newDirection: DirectionString | number): void {
    const player = this.room.players.get(playerId);
    if (!player) return;

    const playerData = this.getPlayerData(player);
    if (!playerData.isAlive) return;

    // Rate limit turns
    const now = Date.now();
    const lastTurn = this.lastTurnTime.get(playerId) || 0;
    if (now - lastTurn < this.MIN_TURN_INTERVAL_MS) {
      return;
    }

    const cycle = this.simulation.getCycle(playerId);
    if (!cycle) return;

    // Convert to TurnDir if needed
    let turnDir: -1 | 1;
    if (typeof newDirection === 'number') {
      // Already a TurnDir
      turnDir = newDirection as -1 | 1;
    } else {
      // Convert from string direction
      const currentDir = directionToString(cycle.direction);
      const result = getTurnDirection(currentDir, newDirection);
      if (result === null) {
        return; // Invalid turn (same direction or 180)
      }
      turnDir = result;
    }

    // Apply turn to simulation
    this.messageCounter++;
    const destination = this.simulation.applyTurn(playerId, turnDir, this.messageCounter);

    if (destination) {
      this.lastTurnTime.set(playerId, now);

      // Get wall info for debug
      const wall = this.simulation.getWall(playerId);
      console.log(`[SERVER TURN] player=${playerId.slice(-4)} turnDir=${turnDir} segments=${wall?.segments.length || 0} pos=(${destination.position.x.toFixed(1)},${destination.position.z.toFixed(1)}) msgId=${destination.messageId}`);

      logDebug('Turn', {
        player: playerId,
        turnDir,
        position: destination.position,
        messageId: destination.messageId,
      });

      // Broadcast destination to ALL clients
      this.onEvent('tron:destination', destination);
    }
  }

  /**
   * Broadcast full state sync
   */
  private broadcastFullSync(): void {
    const syncData = this.simulation.getSyncState();

    console.log(`[SERVER FULL_SYNC] time=${this.simulation.getGameTime().toFixed(2)} players=${syncData.length}`);
    for (const p of syncData) {
      const vertices = this.simulation.getWallVertices(p.id);
      console.log(`[SERVER FULL_SYNC] player=${p.id.slice(-4)} pos=(${p.position.x.toFixed(1)},${p.position.z.toFixed(1)}) dist=${p.distance.toFixed(1)} vertices=${vertices.length} alive=${p.alive}`);
    }

    logDebug('Sync', {
      gameTime: this.simulation.getGameTime(),
      playerCount: syncData.length,
    });

    this.onEvent('tron:sync', {
      gameTime: this.simulation.getGameTime(),
      players: syncData,
    });

    // Also send legacy format for backwards compatibility
    this.onEvent('tron:gameState', this.getLegacyGameStatePayload());
  }

  private getLegacyGameStatePayload(): any {
    const players: Record<string, any> = {};
    const settings = this.getSettings();

    this.room.players.forEach((player) => {
      const cycle = this.simulation.getCycle(player.socketId);
      if (cycle) {
        const vertices = this.simulation.getWallVertices(player.socketId);
        players[player.socketId] = {
          position: cycle.position,
          direction: directionToString(cycle.direction),
          trail: vertices.map(v => ({ x: v.x, z: v.z, timestamp: Date.now() })),
          isAlive: cycle.alive,
        };
      }
    });

    return {
      players,
      state: this.getGameState().phase,
      serverTime: Date.now(),
      gameTime: this.simulation.getGameTime(),
      msPerMove: 1000 / (4 * settings.gameSpeed),
    };
  }

  // ===========================================
  // ROUND/GAME END
  // ===========================================

  private checkRoundEnd(): void {
    const aliveCount = this.simulation.getAliveCount();
    const totalPlayers = this.room.players.size;

    // Solo mode: end when player dies
    if (totalPlayers === 1) {
      if (aliveCount === 0) {
        const soloPlayer = Array.from(this.room.players.values())[0];
        this.endRound(soloPlayer?.socketId || null);
      }
      return;
    }

    // Multiplayer: end when 1 or fewer players remain
    if (aliveCount <= 1) {
      const winner = this.simulation.getWinner();
      let winnerId = winner?.id || null;

      // Tie handling
      if (!winnerId && totalPlayers > 0) {
        const allPlayers = Array.from(this.room.players.values());
        const randomWinner = allPlayers[Math.floor(Math.random() * allPlayers.length)];
        winnerId = randomWinner.socketId;
        console.log('[TronEngine] Tie detected, random winner:', winnerId);
      }

      this.endRound(winnerId);
    }
  }

  private endRound(winnerId: string | null): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    const gameState = this.getGameState();
    gameState.phase = 'round_over';
    gameState.roundWinner = winnerId;

    // Award point to winner
    if (winnerId) {
      const winner = this.room.players.get(winnerId);
      if (winner) {
        const playerData = this.getPlayerData(winner);
        playerData.score++;
      }
    }

    // Get scores
    const scores: Record<string, number> = {};
    this.room.players.forEach((player) => {
      scores[player.socketId] = this.getPlayerData(player).score;
    });

    this.onEvent('tron:roundOver', {
      winnerId,
      round: gameState.currentRound,
      scores,
    });

    // Check for game end
    const settings = this.getSettings();
    const maxScore = Math.max(...Object.values(scores), 0);
    const maxRounds = settings.roundsToWin * 3;

    if (maxScore >= settings.roundsToWin || gameState.currentRound >= maxRounds) {
      const actualWinner = Object.entries(scores).reduce(
        (best, [id, score]) => (score > (best.score || 0) ? { id, score } : best),
        { id: winnerId, score: 0 } as { id: string | null; score: number }
      );
      this.endGame(actualWinner.id);
    } else {
      // Start next round after delay
      if (this.room.players.size >= 1 && !this.isStopped) {
        this.roundRestartTimeout = setTimeout(() => {
          if (!this.isStopped && this.room.players.size >= 1) {
            gameState.currentRound++;
            this.startCountdown();
          }
        }, 3000);
      }
    }
  }

  private endGame(winnerId: string | null): void {
    const gameState = this.getGameState();
    gameState.phase = 'game_over';
    gameState.gameWinner = winnerId;

    const scores: Record<string, number> = {};
    this.room.players.forEach((player) => {
      scores[player.socketId] = this.getPlayerData(player).score;
    });

    this.onEvent('tron:gameOver', {
      winnerId,
      finalScores: scores,
    });

    this.onEvent('roomStateUpdated', null);
  }

  // ===========================================
  // PUBLIC API
  // ===========================================

  public restartGame(): void {
    this.room.players.forEach((player) => {
      const playerData = this.getPlayerData(player);
      playerData.score = 0;
      playerData.isReady = false;
    });

    const gameState = this.getGameState();
    gameState.phase = 'lobby';
    gameState.currentRound = 0;
    gameState.countdown = 0;
    gameState.roundWinner = null;
    gameState.gameWinner = null;

    this.simulation.reset();
    this.onEvent('roomStateUpdated', null);
  }

  public stop(): void {
    this.isStopped = true;

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    if (this.countdownInterval) {
      clearInterval(this.countdownInterval);
      this.countdownInterval = null;
    }
    if (this.roundRestartTimeout) {
      clearTimeout(this.roundRestartTimeout);
      this.roundRestartTimeout = null;
    }

    console.log('[TronEngine] Engine stopped');
  }
}

export default TronGameEngine;
