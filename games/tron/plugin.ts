/**
 * Tron Game Plugin for GameBuddies Unified Server
 *
 * A multiplayer light cycle game with neon trails.
 *
 * @version 1.0.0
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
import {
  TronGameState,
  TronPlayerData,
  TronSettings,
  createInitialGameState,
  createInitialPlayerData,
  DEFAULT_SETTINGS,
  PLAYER_COLORS,
} from './types.js';
import { TronGameEngine } from './GameEngine.js';
import {
  playerReadySchema,
  gameStartSchema,
  directionChangeSchema,
  settingsUpdateSchema,
} from './schemas.js';

class TronPlugin implements GamePlugin {
  // Metadata
  id = 'tron';
  name = 'Tron Light Cycles';
  version = '1.0.0';
  description = 'Multiplayer Tron light cycle game';
  author = 'GameBuddies';
  namespace = '/tron';
  basePath = '/tron';

  // Default Settings
  defaultSettings: RoomSettings = {
    minPlayers: 1,  // Allow solo play
    maxPlayers: 6,
    gameSpecific: {
      ...DEFAULT_SETTINGS
    } as TronSettings
  };

  private io: any;
  private gameEngines: Map<string, TronGameEngine> = new Map();
  private colorCounters: Map<string, number> = new Map();

  // Lifecycle Hooks
  async onInitialize(io: any): Promise<void> {
    this.io = io;
    console.log(`[${this.name}] Plugin initialized`);
  }

  onRoomCreate(room: Room): void {
    console.log(`[${this.name}] Room created: ${room.code}`);
    const settings = room.settings.gameSpecific as TronSettings || DEFAULT_SETTINGS;
    room.gameState.data = createInitialGameState(settings);
    room.gameState.phase = 'lobby';

    // Initialize color counter for this room
    this.colorCounters.set(room.code, 0);

    // Initialize gameData for any existing players (e.g., host)
    room.players.forEach(player => {
      if (!player.gameData) {
        const colorIndex = this.getNextColorIndex(room.code);
        player.gameData = createInitialPlayerData(colorIndex);
      }
    });
  }

  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    console.log(`[${this.name}] Player ${player.name} ${isReconnecting ? 'reconnected' : 'joined'}`);

    if (!player.gameData) {
      const colorIndex = this.getNextColorIndex(room.code);
      player.gameData = createInitialPlayerData(colorIndex);
    }

    this.broadcastRoomState(room);
  }

  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} left`);

    // If no players remain, stop the engine
    if (room.players.size < 1) {
      const engine = this.gameEngines.get(room.code);
      if (engine) {
        console.log(`[${this.name}] No players remaining, stopping engine`);
        engine.stop();
        this.gameEngines.delete(room.code);

        // Reset room to lobby state
        const gameState = room.gameState.data as TronGameState;
        gameState.phase = 'lobby';
        gameState.currentRound = 0;
        gameState.countdown = 0;
      }
    }

    this.broadcastRoomState(room);
  }

  onRoomDestroy(room: Room): void {
    console.log(`[${this.name}] Room destroyed: ${room.code}`);

    // Stop and clean up game engine
    const engine = this.gameEngines.get(room.code);
    if (engine) {
      engine.stop();
      this.gameEngines.delete(room.code);
    }

    // Clean up color counter
    this.colorCounters.delete(room.code);
  }

  private getNextColorIndex(roomCode: string): number {
    const current = this.colorCounters.get(roomCode) || 0;
    this.colorCounters.set(roomCode, current + 1);
    return current;
  }

  // Serialization
  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as TronGameState;

    return {
      code: room.code,
      hostId: room.hostId,
      players: Array.from(room.players.values()).map(p => {
        const playerData = p.gameData as TronPlayerData;
        return {
          socketId: p.socketId,
          name: p.name,
          isHost: p.isHost,
          connected: p.connected,
          isReady: playerData?.isReady || false,
          isAlive: playerData?.isAlive ?? true,
          color: playerData?.color || PLAYER_COLORS[0],
          position: playerData?.position || { x: 0, z: 0 },
          direction: playerData?.direction || 'UP',
          trail: playerData?.trail || [],
          score: playerData?.score || 0,
          eliminatedBy: playerData?.eliminatedBy || null,
        };
      }),
      state: this.mapPhaseToState(gameState.phase),
      settings: {
        ...room.settings,
        gameSpecific: gameState.settings,
      },
      gameData: {
        currentRound: gameState.currentRound,
        countdown: gameState.countdown,
        roundWinner: gameState.roundWinner,
        gameWinner: gameState.gameWinner,
        tickRate: 20,
      },
      mySocketId: socketId,
      isGameBuddiesRoom: room.isGameBuddiesRoom,
    };
  }

  private mapPhaseToState(phase: string): string {
    const phaseMap: Record<string, string> = {
      'lobby': 'LOBBY_WAITING',
      'countdown': 'COUNTDOWN',
      'playing': 'PLAYING',
      'round_over': 'ROUND_OVER',
      'game_over': 'GAME_OVER',
    };
    return phaseMap[phase] || 'LOBBY_WAITING';
  }

  // Socket Handlers
  socketHandlers: Record<string, SocketEventHandler> = {
    'player:ready': async (socket: Socket, data: { ready: boolean }, room: Room, helpers: GameHelpers) => {
      const validation = playerReadySchema.safeParse(data);
      if (!validation.success) {
        console.error(`[${this.name}] Validation Error (player:ready):`, validation.error);
        return;
      }
      const payload = validation.data;

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (player) {
        if (!player.gameData) {
          const colorIndex = this.getNextColorIndex(room.code);
          player.gameData = createInitialPlayerData(colorIndex);
        }
        (player.gameData as TronPlayerData).isReady = payload.ready;
        this.broadcastRoomState(room);
      }
    },

    'game:start': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const validation = gameStartSchema.safeParse(data);
      if (!validation.success) {
        console.error(`[${this.name}] Validation Error (game:start):`, validation.error);
        return;
      }

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) {
        return;
      }

      // Check if all players are ready
      const allReady = Array.from(room.players.values()).every(p =>
        (p.gameData as TronPlayerData)?.isReady
      );

      if (!allReady && room.players.size > 1) {
        helpers.sendToPlayer(socket.id, 'game:error', { message: 'Not all players are ready' });
        return;
      }

      // Create game engine
      const engine = new TronGameEngine(room, (event, data) => {
        this.handleGameEvent(room, event, data);
      });
      this.gameEngines.set(room.code, engine);

      // Start the game
      engine.startGame();
      this.broadcastRoomState(room);
    },

    'tron:changeDirection': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const validation = directionChangeSchema.safeParse(data);
      if (!validation.success) {
        return;
      }

      const engine = this.gameEngines.get(room.code);
      if (engine) {
        engine.handleDirectionChange(socket.id, validation.data.direction);
      }
    },

    // New turn event (Armagetron-style destination system)
    'tron:turn': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const validation = directionChangeSchema.safeParse(data);
      if (!validation.success) {
        return;
      }

      const engine = this.gameEngines.get(room.code);
      if (engine) {
        engine.handleDirectionChange(socket.id, validation.data.direction);
      }
    },

    'tron:updateSettings': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const validation = settingsUpdateSchema.safeParse(data);
      if (!validation.success) {
        return;
      }

      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) {
        return;
      }

      const gameState = room.gameState.data as TronGameState;
      if (gameState.phase !== 'lobby') {
        return;
      }

      // Update settings
      const newSettings = validation.data;
      if (newSettings.arenaSize) gameState.settings.arenaSize = newSettings.arenaSize;
      if (newSettings.gameSpeed) gameState.settings.gameSpeed = newSettings.gameSpeed;
      if (newSettings.roundsToWin) gameState.settings.roundsToWin = newSettings.roundsToWin;

      this.broadcastRoomState(room);
    },

    'tron:restart': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) {
        return;
      }

      const engine = this.gameEngines.get(room.code);
      if (engine) {
        engine.restartGame();
      } else {
        // Reset without engine
        const gameState = room.gameState.data as TronGameState;
        gameState.phase = 'lobby';
        gameState.currentRound = 0;
        gameState.roundWinner = null;
        gameState.gameWinner = null;

        room.players.forEach(player => {
          const playerData = player.gameData as TronPlayerData;
          if (playerData) {
            playerData.score = 0;
            playerData.isReady = false;
          }
        });

        this.broadcastRoomState(room);
      }
    },

    'player:kick': async (socket: Socket, data: { roomCode: string; playerId: string }, room: Room, helpers: GameHelpers) => {
      const host = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!host?.isHost) {
        return;
      }

      const playerToKick = room.players.get(data.playerId);
      if (!playerToKick || playerToKick.socketId === socket.id) {
        return; // Can't kick yourself
      }

      // Remove player from room
      room.players.delete(data.playerId);

      // Notify the kicked player
      helpers.sendToPlayer(data.playerId, 'player:kicked', { message: 'You have been kicked from the room' });

      // Disconnect kicked player's socket from room
      const namespace = this.io?.of(this.namespace);
      if (namespace) {
        const kickedSocket = namespace.sockets.get(data.playerId);
        if (kickedSocket) {
          kickedSocket.leave(room.code);
        }
      }

      console.log(`[${this.name}] Player ${playerToKick.name} was kicked by host`);
      this.broadcastRoomState(room);
    },
  };

  private handleGameEvent(room: Room, event: string, data: any): void {
    if (!this.io) return;
    const namespace = this.io.of(this.namespace);

    switch (event) {
      case 'roomStateUpdated':
        room.players.forEach(player => {
          namespace.to(player.socketId).emit('roomStateUpdated', this.serializeRoom(room, player.socketId));
        });
        break;

      // New destination-based sync events (Armagetron-inspired)
      case 'tron:destination':
      case 'tron:sync':
      case 'tron:eliminated':
      // Legacy events (for backwards compatibility)
      case 'tron:gameState':
      case 'tron:countdown':
      case 'tron:roundStart':
      case 'tron:playerEliminated':
      case 'tron:roundOver':
      case 'tron:gameOver':
        room.players.forEach(player => {
          namespace.to(player.socketId).emit(event, data);
        });
        break;
    }
  }

  // Helper
  private broadcastRoomState(room: Room): void {
    if (!this.io) return;
    const namespace = this.io.of(this.namespace);
    room.players.forEach(player => {
      namespace.to(player.socketId).emit('roomStateUpdated', this.serializeRoom(room, player.socketId));
    });
  }
}

export default new TronPlugin();
