/**
 * Bomberman Game Plugin for GameBuddies Platform
 *
 * Classic Bomberman multiplayer with kick/throw mechanics
 * Ported from Colyseus implementation
 */

import type {
  GamePlugin,
  Room,
  Player,
  SocketEventHandler,
  GameHelpers,
  RoomSettings
} from '../../core/types/core.js';
import type { Socket } from 'socket.io';

import { GAME_CONFIG, TILE, GAME_PHASE, GAME_MODE, DIRECTION, Direction } from './shared/constants.js';
import {
  BombermanGameState,
  BombermanPlayerData,
  SerializedRoom,
  SerializedPlayer,
  SerializedBomb,
  SerializedExplosion,
  createDefaultPlayerData,
  createDefaultGameState,
} from './types.js';
import { MapGenerator } from './game/MapGenerator.js';
import { GameLoop } from './game/GameLoop.js';
import { BombManager } from './game/BombManager.js';
import { PlayerManager, MoveResult } from './game/PlayerManager.js';
import { CurseManager } from './game/CurseManager.js';
import { SuddenDeathManager } from './game/SuddenDeathManager.js';

class BombermanPlugin implements GamePlugin {
  // Plugin metadata
  id = 'bomberman';
  name = 'Bomberman';
  version = '1.0.0';
  description = 'Classic Bomberman multiplayer with power-ups, kick, and throw mechanics';
  author = 'GameBuddies';
  namespace = '/bomberman';
  basePath = '/bomberman';

  // Default settings
  defaultSettings: RoomSettings = {
    minPlayers: GAME_CONFIG.MIN_PLAYERS,
    maxPlayers: GAME_CONFIG.MAX_PLAYERS,
    gameSpecific: {
      gameMode: GAME_MODE.LAST_MAN_STANDING,
    }
  };

  // Private properties
  private io: any;
  private gameLoops = new Map<string, GameLoop>();
  private respawnTimers = new Map<string, NodeJS.Timeout>();

  // ============================================================================
  // LIFECYCLE HOOKS
  // ============================================================================

  async onInitialize(io: any): Promise<void> {
    this.io = io;
    console.log(`[${this.name}] Plugin initialized`);
  }

  onRoomCreate(room: Room): void {
    console.log(`[${this.name}] Room created: ${room.code}`);

    // Initialize game state
    room.gameState.data = createDefaultGameState();
    room.gameState.phase = 'lobby';

    const gameState = room.gameState.data as BombermanGameState;

    // Initialize host player data (host is already in room.players but onPlayerJoin is not called)
    room.players.forEach((player) => {
      if (!player.gameData) {
        const spawnIndex = 0;
        gameState.usedSpawnIndices.add(spawnIndex);
        const spawn = GAME_CONFIG.SPAWN_POSITIONS[spawnIndex];
        const color = GAME_CONFIG.PLAYER_COLORS[spawnIndex];
        player.gameData = createDefaultPlayerData(spawnIndex, spawn, color);
        console.log(`[${this.name}] Initialized host ${player.name} with spawn ${spawnIndex}`);
      }
    });

    // Generate map for the host
    if (room.players.size >= 1) {
      gameState.tiles = MapGenerator.generate(GAME_CONFIG.MAX_PLAYERS);
      console.log(`[${this.name}] Generated map for room ${room.code}`);
    }

    // Start game loop
    this.startGameLoop(room);
  }

  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    console.log(`[${this.name}] Player ${player.name} ${isReconnecting ? 'reconnected to' : 'joined'} room ${room.code}`);

    const gameState = room.gameState.data as BombermanGameState;

    if (!isReconnecting) {
      // Find available spawn index
      let spawnIndex = 0;
      for (let i = 0; i < GAME_CONFIG.MAX_PLAYERS; i++) {
        if (!gameState.usedSpawnIndices.has(i)) {
          spawnIndex = i;
          break;
        }
      }
      gameState.usedSpawnIndices.add(spawnIndex);

      const spawn = GAME_CONFIG.SPAWN_POSITIONS[spawnIndex];
      const color = GAME_CONFIG.PLAYER_COLORS[spawnIndex];

      // Initialize player data
      player.gameData = createDefaultPlayerData(spawnIndex, spawn, color);

      // Generate map when first player joins
      if (room.players.size === 1) {
        gameState.tiles = MapGenerator.generate(GAME_CONFIG.MAX_PLAYERS);
      }
    }

    // Broadcast updated state
    this.broadcastRoomState(room);
  }

  onPlayerDisconnected(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} disconnected from room ${room.code}`);
    this.broadcastRoomState(room);
  }

  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} removed from room ${room.code}`);

    const gameState = room.gameState.data as BombermanGameState;
    const playerData = player.gameData as BombermanPlayerData;

    // Release spawn index
    if (playerData) {
      gameState.usedSpawnIndices.delete(playerData.spawnIndex);
    }

    // Clear any respawn timer for this player
    const timerKey = `${room.code}:${player.id}:respawn`;
    if (this.respawnTimers.has(timerKey)) {
      clearTimeout(this.respawnTimers.get(timerKey)!);
      this.respawnTimers.delete(timerKey);
    }

    // Check win condition
    if (gameState.phase === 'playing') {
      const winnerId = PlayerManager.checkWinCondition(room, gameState);
      if (winnerId !== null) {
        this.endGame(room, winnerId);
      }
    }

    this.broadcastRoomState(room);
  }

  onRoomDestroy?(room: Room): void {
    console.log(`[${this.name}] Room ${room.code} is being destroyed`);

    // Stop game loop
    const gameLoop = this.gameLoops.get(room.code);
    if (gameLoop) {
      gameLoop.stop();
      this.gameLoops.delete(room.code);
    }

    // Clear all respawn timers for this room
    this.respawnTimers.forEach((timer, key) => {
      if (key.startsWith(room.code)) {
        clearTimeout(timer);
        this.respawnTimers.delete(key);
      }
    });
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  serializeRoom(room: Room, socketId: string): SerializedRoom {
    const gameState = room.gameState.data as BombermanGameState;

    // Serialize players
    const players: SerializedPlayer[] = Array.from(room.players.values()).map(p => {
      const data = p.gameData as BombermanPlayerData;
      return {
        id: p.id,
        socketId: p.socketId,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected,
        gridX: data?.gridX ?? 0,
        gridY: data?.gridY ?? 0,
        maxBombs: data?.maxBombs ?? 1,
        bombsPlaced: data?.bombsPlaced ?? 0,
        fireRange: data?.fireRange ?? 2,
        speed: data?.speed ?? 150,
        alive: data?.alive ?? true,
        color: data?.color ?? 0xffffff,
        kills: data?.kills ?? 0,
        deaths: data?.deaths ?? 0,
        hasKick: data?.hasKick ?? false,
        hasThrow: data?.hasThrow ?? false,
        stunnedUntil: data?.stunnedUntil ?? 0,
        facingDir: data?.facingDir ?? DIRECTION.DOWN,
        // New power-up flags
        hasPunch: data?.hasPunch ?? false,
        hasPierce: data?.hasPierce ?? false,
        hasBombPass: data?.hasBombPass ?? false,
        curseType: data?.curseType ?? null,
        curseEndTime: data?.curseEndTime ?? 0,
      };
    });

    // Serialize bombs
    const bombs: SerializedBomb[] = [];
    gameState.bombs.forEach((bomb) => {
      bombs.push({
        id: bomb.id,
        ownerId: bomb.ownerId,
        gridX: bomb.gridX,
        gridY: bomb.gridY,
        range: bomb.range,
        timer: bomb.timer,
        isMoving: bomb.isMoving,
        moveDir: bomb.moveDir,
        isFlying: bomb.isFlying,
        flyDir: bomb.flyDir,
        targetX: bomb.targetX,
        targetY: bomb.targetY,
        isPiercing: bomb.isPiercing,
        isPunched: bomb.isPunched,
      });
    });

    // Serialize explosions
    const explosions: SerializedExplosion[] = [];
    gameState.explosions.forEach((explosion) => {
      explosions.push({
        id: explosion.id,
        gridX: explosion.gridX,
        gridY: explosion.gridY,
        timer: explosion.timer,
      });
    });

    return {
      code: room.code,
      hostId: room.hostId,
      mySocketId: socketId,
      players,
      state: gameState.phase,
      gameData: {
        tiles: gameState.tiles,
        bombs,
        explosions,
        countdown: gameState.countdown,
        timeRemaining: gameState.timeRemaining,
        gameMode: gameState.gameMode,
        winnerId: gameState.winnerId,
        // Sudden Death
        suddenDeathActive: gameState.suddenDeathActive,
        fallingBlocks: gameState.fallingBlocks.map(fb => ({
          x: fb.x,
          y: fb.y,
          fallTime: fb.fallTime,
        })),
      },
    };
  }

  // ============================================================================
  // SOCKET HANDLERS
  // ============================================================================

  socketHandlers: Record<string, SocketEventHandler> = {
    /**
     * Player movement
     */
    'player:move': async (socket: Socket, data: { direction: number }, room: Room) => {
      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'playing') return;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      const result = PlayerManager.handleMove(player, data.direction as Direction, room, gameState);

      // If player walked into an explosion, kill them
      if (result.walkedIntoExplosion) {
        this.handlePlayerKill(room, player, player.id); // Self-kill (suicide by fire)
      }

      this.broadcastRoomState(room);
    },

    /**
     * Place bomb
     */
    'player:bomb': async (socket: Socket, data: any, room: Room) => {
      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'playing') return;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      const playerData = player.gameData as BombermanPlayerData;
      if (!playerData.alive) return;

      BombManager.placeBomb(room, player, gameState);
      this.broadcastRoomState(room);
    },

    /**
     * Throw bomb
     */
    'player:throw': async (socket: Socket, data: any, room: Room) => {
      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'playing') return;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      const playerData = player.gameData as BombermanPlayerData;
      if (!playerData.alive || !playerData.hasThrow) return;
      if (playerData.stunnedUntil > Date.now()) return;

      // Find bomb at player's position
      const bomb = BombManager.findBombAt(gameState, playerData.gridX, playerData.gridY);
      if (bomb) {
        BombManager.throwBomb(bomb, player, gameState);
        this.broadcastRoomState(room);
      }
    },

    /**
     * Punch bomb (boxing glove power-up)
     */
    'player:punch': async (socket: Socket, data: any, room: Room) => {
      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'playing') return;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) return;

      const playerData = player.gameData as BombermanPlayerData;
      if (!playerData.alive || !playerData.hasPunch) return;
      if (playerData.stunnedUntil > Date.now()) return;

      // Punch bomb in front of player
      const punched = BombManager.punchBomb(player, gameState, room, (hitPlayer) => {
        PlayerManager.stunPlayer(hitPlayer);
      });

      if (punched) {
        this.broadcastRoomState(room);
      }
    },

    /**
     * Start game (host only)
     */
    'game:start': async (socket: Socket, data: any, room: Room) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only the host can start the game' });
        return;
      }

      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'lobby') {
        socket.emit('error', { message: 'Game is not in lobby' });
        return;
      }

      const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
      if (connectedPlayers.length < GAME_CONFIG.MIN_PLAYERS) {
        socket.emit('error', { message: `Need at least ${GAME_CONFIG.MIN_PLAYERS} players` });
        return;
      }

      // Start countdown
      this.startCountdown(room);
    },

    /**
     * Set game mode (host only)
     */
    'game:setMode': async (socket: Socket, data: { mode: number }, room: Room) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) return;

      const gameState = room.gameState.data as BombermanGameState;
      if (gameState.phase !== 'lobby') return;

      gameState.gameMode = data.mode;
      this.broadcastRoomState(room);
    },

    /**
     * Restart game (host only)
     */
    'game:restart': async (socket: Socket, data: any, room: Room) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only the host can restart the game' });
        return;
      }

      this.resetGame(room);
    },
  };

  // ============================================================================
  // GAME LOOP
  // ============================================================================

  private startGameLoop(room: Room): void {
    const gameLoop = new GameLoop();
    this.gameLoops.set(room.code, gameLoop);

    gameLoop.start((deltaTime) => {
      this.update(room, deltaTime);
    }, GAME_CONFIG.TICK_RATE);
  }

  private update(room: Room, deltaTime: number): void {
    const gameState = room.gameState.data as BombermanGameState;

    switch (gameState.phase) {
      case 'countdown':
        this.updateCountdown(room, deltaTime);
        break;
      case 'playing':
        this.updatePlaying(room, deltaTime);
        break;
    }
  }

  private updateCountdown(room: Room, deltaTime: number): void {
    const gameState = room.gameState.data as BombermanGameState;

    gameState.countdown -= deltaTime;
    if (gameState.countdown <= 0) {
      gameState.countdown = 0;
      gameState.phase = 'playing';

      if (gameState.gameMode === GAME_MODE.DEATHMATCH) {
        gameState.timeRemaining = GAME_CONFIG.DEATHMATCH_TIME;
      }

      console.log(`[${this.name}] Game started in room ${room.code}!`);
      this.broadcastRoomState(room);
    } else {
      // During countdown, only broadcast at 10Hz (every 100ms) for countdown display
      const now = Date.now();
      const lastBroadcast = (gameState as any)._lastBroadcast || 0;
      if (now - lastBroadcast >= 100) {
        (gameState as any)._lastBroadcast = now;
        this.broadcastRoomState(room);
      }
    }
  }

  private updatePlaying(room: Room, deltaTime: number): void {
    const gameState = room.gameState.data as BombermanGameState;

    // Update deathmatch timer
    if (gameState.gameMode === GAME_MODE.DEATHMATCH) {
      gameState.timeRemaining -= deltaTime;
      if (gameState.timeRemaining <= 0) {
        const winnerId = PlayerManager.getDeathmatchWinner(room);
        this.endGame(room, winnerId);
        return;
      }
    }

    // Update curse effects for all players
    room.players.forEach((player) => {
      CurseManager.updateCurse(player, room, gameState);
    });

    // Update sudden death (arena shrinking)
    SuddenDeathManager.update(gameState, room, (player, killerId) => {
      this.handlePlayerKill(room, player, killerId);
    });

    // Update moving bombs (kick)
    BombManager.updateMovingBombs(gameState, room, (player) => {
      PlayerManager.stunPlayer(player);
    });

    // Update flying bombs (throw)
    BombManager.updateFlyingBombs(gameState, room, (player) => {
      PlayerManager.stunPlayer(player);
    });

    // Update bombs
    BombManager.updateBombs(deltaTime, room, gameState, (bomb) => {
      // After explosion, check for kills
      PlayerManager.checkExplosionKills(bomb.ownerId, room, gameState, (player, killerId) => {
        this.handlePlayerKill(room, player, killerId);
      });
    });

    // Update explosions
    BombManager.updateExplosions(deltaTime, gameState);

    // Broadcast state at 20Hz (every 50ms) to reduce client load
    // Game runs at 60Hz but clients don't need that many updates
    const now = Date.now();
    const lastBroadcast = (gameState as any)._lastBroadcast || 0;
    if (now - lastBroadcast >= 50) {
      (gameState as any)._lastBroadcast = now;
      this.broadcastRoomState(room);
    }
  }

  // ============================================================================
  // GAME LOGIC
  // ============================================================================

  private startCountdown(room: Room): void {
    const gameState = room.gameState.data as BombermanGameState;

    gameState.countdown = GAME_CONFIG.COUNTDOWN_TIME;
    gameState.phase = 'countdown';

    console.log(`[${this.name}] Countdown started in room ${room.code}!`);
    this.broadcastRoomState(room);
  }

  private handlePlayerKill(room: Room, player: Player, killerId: string): void {
    const gameState = room.gameState.data as BombermanGameState;

    PlayerManager.killPlayer(player, killerId, room, gameState);

    // Handle based on game mode
    if (gameState.gameMode === GAME_MODE.DEATHMATCH) {
      // Respawn after delay
      const timerKey = `${room.code}:${player.id}:respawn`;
      const timer = setTimeout(() => {
        PlayerManager.respawnPlayer(player);
        this.respawnTimers.delete(timerKey);
        this.broadcastRoomState(room);
      }, 2000);
      this.respawnTimers.set(timerKey, timer);
    } else {
      // Last man standing - check win
      const winnerId = PlayerManager.checkWinCondition(room, gameState);
      if (winnerId !== null) {
        this.endGame(room, winnerId);
      }
    }
  }

  private endGame(room: Room, winnerId: string): void {
    const gameState = room.gameState.data as BombermanGameState;

    gameState.winnerId = winnerId;
    gameState.phase = 'ended';

    const winner = room.players.get(winnerId);
    console.log(`[${this.name}] Game ended in room ${room.code}! Winner: ${winner?.name || 'None'}`);

    this.broadcastRoomState(room);

    // Auto-reset after delay
    setTimeout(() => {
      this.resetGame(room);
    }, 5000);
  }

  private resetGame(room: Room): void {
    const gameState = room.gameState.data as BombermanGameState;

    // Clear all bombs and explosions
    gameState.bombs.clear();
    gameState.explosions.clear();

    // Reset players
    room.players.forEach((player) => {
      PlayerManager.resetPlayer(player);
    });

    // Regenerate map
    gameState.tiles = MapGenerator.generate(GAME_CONFIG.MAX_PLAYERS);

    // Reset game state
    gameState.winnerId = null;
    gameState.phase = 'lobby';
    gameState.countdown = 0;
    gameState.timeRemaining = 0;

    // Reset sudden death
    SuddenDeathManager.reset(gameState);

    console.log(`[${this.name}] Game reset in room ${room.code}!`);
    this.broadcastRoomState(room);
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  private broadcastRoomState(room: Room): void {
    if (!this.io) return;

    const namespace = this.io.of(this.namespace);

    // Send personalized state to each player
    room.players.forEach(player => {
      const serialized = this.serializeRoom(room, player.socketId);
      namespace.to(player.socketId).emit('roomStateUpdated', serialized);
    });
  }
}

export default new BombermanPlugin();
