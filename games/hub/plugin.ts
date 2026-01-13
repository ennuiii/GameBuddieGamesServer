/**
 * Hub Game Plugin for GameBuddies Unified Server
 *
 * Handles Socket.IO room management for the Hub.
 * The 2D world state sync is handled by Colyseus (separate port).
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

// Hub-specific game state
interface HubGameState {
  phase: 'lobby' | 'playing';
}

// Hub-specific player data
interface HubPlayerData {
  isReady: boolean;
}

class HubPlugin implements GamePlugin {
  // Metadata
  id = 'hub';
  name = 'GameBuddies Hub';
  version = '1.0.0';
  description = 'Virtual world lobby for GameBuddies';
  author = 'GameBuddies';
  namespace = '/hub';
  basePath = '/hub';

  // Default Settings
  defaultSettings: RoomSettings = {
    minPlayers: 1,
    maxPlayers: 50,
    allowLateJoin: true, // Hub is a virtual world - players can join anytime
    gameSpecific: {}
  };

  private io: any;

  // Lifecycle Hooks
  async onInitialize(io: any): Promise<void> {
    this.io = io;
    console.log(`[${this.name}] Plugin initialized`);
  }

  onRoomCreate(room: Room): void {
    console.log(`[${this.name}] Room created: ${room.code}`);
    room.gameState.data = { phase: 'lobby' } as HubGameState;
    room.gameState.phase = 'lobby';
  }

  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    console.log(`[${this.name}] Player ${player.name} ${isReconnecting ? 'reconnected' : 'joined'}`);

    if (!player.gameData) {
      player.gameData = { isReady: false } as HubPlayerData;
    }

    this.broadcastRoomState(room);
  }

  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} left`);
    this.broadcastRoomState(room);
  }

  onPlayerDisconnected(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} disconnected`);
    this.broadcastRoomState(room);
  }

  // Serialization - converts server state to client format
  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as HubGameState;

    return {
      code: room.code,
      hostId: room.hostId,
      players: Array.from(room.players.values()).map(p => ({
        id: p.id,
        socketId: p.socketId,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected,
        avatarUrl: p.avatarUrl,
        premiumTier: p.premiumTier,
        isReady: (p.gameData as HubPlayerData)?.isReady || false
      })),
      state: gameState?.phase || 'lobby',
      settings: room.settings,
      mySocketId: socketId,
      isGameBuddiesRoom: room.isGameBuddiesRoom,
      isStreamerMode: room.isStreamerMode,
      hideRoomCode: room.hideRoomCode
    };
  }

  // Socket Handlers
  socketHandlers: Record<string, SocketEventHandler> = {
    // Player ready toggle
    'player:ready': async (socket: Socket, data: { ready: boolean }, room: Room, helpers: GameHelpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (player) {
        if (!player.gameData) {
          player.gameData = { isReady: false } as HubPlayerData;
        }
        (player.gameData as HubPlayerData).isReady = data.ready;
        this.broadcastRoomState(room);
      }
    },

    // Start game - transitions from lobby to playing (enters hub world)
    'game:start': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (player?.isHost) {
        const gameState = room.gameState.data as HubGameState;
        gameState.phase = 'playing';
        room.gameState.phase = 'playing';

        // Notify all players to connect to Colyseus
        helpers.sendToRoom(room.code, 'game:started', {
          colyseusRoomCode: room.code // Use same room code for Colyseus
        });

        this.broadcastRoomState(room);
      }
    },

    // Back to lobby
    'game:restart': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (player?.isHost) {
        const gameState = room.gameState.data as HubGameState;
        gameState.phase = 'lobby';
        room.gameState.phase = 'lobby';

        helpers.sendToRoom(room.code, 'game:restarted', {});
        this.broadcastRoomState(room);
      }
    },

    // Kick player
    'player:kick': async (socket: Socket, data: { playerId: string }, room: Room, helpers: GameHelpers) => {
      const { playerId } = data;

      const currentPlayer = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!currentPlayer?.isHost) {
        socket.emit('error', { message: 'Only host can kick players' });
        return;
      }

      const targetPlayer = Array.from(room.players.values()).find(p => p.id === playerId);
      if (!targetPlayer) {
        socket.emit('error', { message: 'Player not found' });
        return;
      }

      if (targetPlayer.isHost) {
        socket.emit('error', { message: 'Cannot kick the host' });
        return;
      }

      console.log(`[${this.name}] Host ${currentPlayer.name} kicking player ${targetPlayer.name}`);

      helpers.sendToPlayer(targetPlayer.socketId, 'player:kicked', {
        message: 'You have been kicked by the host'
      });

      if (targetPlayer.sessionToken) {
        helpers.invalidateSession(targetPlayer.sessionToken);
      }

      helpers.removePlayerFromRoom(room.code, targetPlayer.socketId);

      helpers.sendToRoom(room.code, 'player:left', {
        playerId: targetPlayer.socketId,
        playerName: targetPlayer.name,
        reason: 'kicked'
      });

      this.broadcastRoomState(room);
    }
  };

  // Helper - broadcast room state to all players
  private broadcastRoomState(room: Room): void {
    if (!this.io) return;
    const namespace = this.io.of(this.namespace);
    room.players.forEach(player => {
      namespace.to(player.socketId).emit('roomStateUpdated', this.serializeRoom(room, player.socketId));
    });
  }
}

export default new HubPlugin();
