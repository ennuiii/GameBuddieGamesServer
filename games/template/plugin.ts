/**
 * Template Game Plugin for GameBuddies Unified Server
 *
 * A generic starting point for new games.
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
  TemplateGameState,
  TemplatePlayerData,
  TemplateSettings,
  createInitialGameState,
  createInitialPlayerData,
  DEFAULT_SETTINGS
} from './types.js';
import { playerReadySchema, gameStartSchema, gameActionSchema } from './schemas.js';

class TemplatePlugin implements GamePlugin {
  // Metadata
  id = 'template';
  name = 'Ultimate Game Template';
  version = '1.0.0';
  description = 'A generic template for GameBuddies games';
  author = 'GameBuddies';
  namespace = '/template';
  basePath = '/template';

  // Default Settings
  defaultSettings: RoomSettings = {
    minPlayers: 1,
    maxPlayers: 8,
    gameSpecific: {
      ...DEFAULT_SETTINGS
    } as TemplateSettings
  };

  private io: any;

  // Lifecycle Hooks
  async onInitialize(io: any): Promise<void> {
    this.io = io;
    console.log(`[${this.name}] Plugin initialized`);
  }

  onRoomCreate(room: Room): void {
    console.log(`[${this.name}] Room created: ${room.code}`);
    const settings = room.settings.gameSpecific as TemplateSettings;
    room.gameState.data = createInitialGameState(settings);
    room.gameState.phase = 'lobby';

    // Initialize gameData for any existing players (e.g., host)
    room.players.forEach(player => {
      if (!player.gameData) {
        player.gameData = createInitialPlayerData();
      }
    });
  }

  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    console.log(`[${this.name}] Player ${player.name} ${isReconnecting ? 'reconnected' : 'joined'}`);
    
    if (!player.gameData) {
      player.gameData = createInitialPlayerData();
    }

    this.broadcastRoomState(room);
  }

  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} left`);
    this.broadcastRoomState(room);
  }

  // Serialization
  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as TemplateGameState;
    
    return {
      code: room.code,
      hostId: room.hostId,
      players: Array.from(room.players.values()).map(p => ({
        socketId: p.socketId,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected,
        isReady: (p.gameData as TemplatePlayerData)?.isReady || false,
        score: (p.gameData as TemplatePlayerData)?.score || 0,
        avatarUrl: p.avatarUrl,
        premiumTier: p.premiumTier
      })),
      state: gameState.phase, // 'LOBBY', 'PLAYING', etc.
      settings: room.settings,
      gameData: {
        round: gameState.currentRound,
        ...gameState.customData
      },
      mySocketId: socketId,
      isGameBuddiesRoom: room.isGameBuddiesRoom,
      isStreamerMode: room.isStreamerMode,
      hideRoomCode: room.hideRoomCode
    };
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
        // Ensure gameData exists before accessing
        if (!player.gameData) {
          player.gameData = createInitialPlayerData();
        }
        (player.gameData as TemplatePlayerData).isReady = payload.ready;
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
      if (player?.isHost) {
        const gameState = room.gameState.data as TemplateGameState;
        gameState.phase = 'playing';
        room.gameState.phase = 'playing';
        
        helpers.sendToRoom(room.code, 'game:started', {});
        this.broadcastRoomState(room);
      }
    },
    
    'game:action': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
       const validation = gameActionSchema.safeParse(data);
       if (!validation.success) {
         console.error(`[${this.name}] Validation Error (game:action):`, validation.error);
         return;
       }

       // Generic action handler for testing
       console.log(`[${this.name}] Action received:`, validation.data);
       // Implement your game logic here
    },

    'debug:grant-xp': async (socket: Socket, data: { password: string }, room: Room, helpers: GameHelpers) => {
      // Validate password
      if (data.password !== 'Gabu123!') {
        socket.emit('error', { message: 'Invalid password' });
        return;
      }

      // Find player
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player) {
        socket.emit('error', { message: 'Player not found' });
        return;
      }

      if (!player.userId) {
        socket.emit('error', { message: 'Must be logged in via GameBuddies to test XP' });
        return;
      }

      console.log(`[${this.name}] Debug: Granting XP to ${player.name} (${player.userId})`);

      try {
        // Grant reward via API (~50 XP: 30 base + 20 win bonus)
        const reward = await helpers.grantReward(this.id, player.userId, {
          won: true,
          durationSeconds: 60,
          score: 50,
          metadata: { reason: 'debug_test' }
        });

        if (reward) {
          console.log(`[${this.name}] Debug: XP granted successfully:`, reward);
          socket.emit('player:reward', reward);
        } else {
          socket.emit('error', { message: 'Failed to grant XP - no response from API' });
        }
      } catch (error) {
        console.error(`[${this.name}] Debug: Error granting XP:`, error);
        socket.emit('error', { message: 'Failed to grant XP - API error' });
      }
    }
  };

  // Helper
  private broadcastRoomState(room: Room): void {
    if (!this.io) return;
    const namespace = this.io.of(this.namespace);
    room.players.forEach(player => {
      namespace.to(player.socketId).emit('roomStateUpdated', this.serializeRoom(room, player.socketId));
    });
  }
}

export default new TemplatePlugin();