/**
 * Game Plugin Template for GameBuddies Unified Server
 *
 * Instructions:
 * 1. Copy this file to games/your-game/plugin.ts
 * 2. Replace "YourGame" with your game name
 * 3. Define your game state and player data interfaces
 * 4. Implement game logic in socket handlers
 * 5. Register plugin in core/server.ts
 *
 * @author Your Name
 * @version 1.0.0
 */

import type {
  GamePlugin,
  Room,
  Player,
  SocketEventHandler,
  GameHelpers,
  RoomSettings
} from '../core/types/core';
import type { Socket } from 'socket.io';

// ============================================================================
// TYPE DEFINITIONS - Define your game-specific types here
// ============================================================================

/**
 * Your game's state that persists throughout the game
 */
interface YourGameState {
  // Example fields - replace with your game state
  currentRound: number;
  currentTurn: string | null; // Player ID whose turn it is
  timeRemaining: number;
  // Add your game-specific state here
}

/**
 * Data stored per player for your game
 */
interface YourPlayerData {
  // Example fields - replace with your player data
  score: number;
  isReady: boolean;
  lastAction: string | null;
  // Add your player-specific data here
}

/**
 * Custom settings for your game
 */
interface YourGameSettings {
  // Example fields - replace with your settings
  roundsPerGame: number;
  timePerRound: number;
  difficulty: 'easy' | 'medium' | 'hard';
  // Add your game-specific settings here
}

// ============================================================================
// PLUGIN CLASS
// ============================================================================

class YourGamePlugin implements GamePlugin {
  // ============================================================================
  // PLUGIN METADATA - Update these values
  // ============================================================================

  id = 'your-game';                    // Unique identifier (lowercase, hyphens)
  name = 'Your Game Name';              // Display name
  version = '1.0.0';                    // Semantic version
  description = 'A brief description of your game';
  author = 'Your Name';
  namespace = '/your-game';             // Socket.IO namespace (must start with /)
  basePath = '/your-game';              // URL path for the game

  // ============================================================================
  // DEFAULT SETTINGS
  // ============================================================================

  defaultSettings: RoomSettings = {
    minPlayers: 2,
    maxPlayers: 8,
    gameSpecific: {
      roundsPerGame: 3,
      timePerRound: 60,
      difficulty: 'medium'
    } as YourGameSettings
  };

  // ============================================================================
  // PRIVATE PROPERTIES
  // ============================================================================

  private io: any;
  private timers = new Map<string, NodeJS.Timeout>();
  private intervals = new Map<string, NodeJS.Timeout>();

  // ============================================================================
  // LIFECYCLE HOOKS
  // ============================================================================

  /**
   * Called when plugin is initialized
   */
  async onInitialize(io: any): Promise<void> {
    this.io = io;
    console.log(`[${this.name}] Plugin initialized`);

    // Load any async resources here (e.g., questions, words, cards)
    // await this.loadGameResources();
  }

  /**
   * Called when a room is created
   */
  onRoomCreate(room: Room): void {
    console.log(`[${this.name}] Room created: ${room.code}`);

    // Initialize game state
    room.gameState.data = {
      currentRound: 0,
      currentTurn: null,
      timeRemaining: 0
    } as YourGameState;

    room.gameState.phase = 'lobby'; // lobby, playing, ended
  }

  /**
   * Called when a player joins (or reconnects)
   */
  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    console.log(`[${this.name}] Player ${player.name} ${isReconnecting ? 'reconnected to' : 'joined'} room ${room.code}`);

    // Initialize player data if not reconnecting
    if (!isReconnecting) {
      player.gameData = {
        score: 0,
        isReady: false,
        lastAction: null
      } as YourPlayerData;
    }

    // Broadcast updated state to all players
    this.broadcastRoomState(room);

    // Send welcome message or game rules to the new player
    if (!isReconnecting && this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(player.socketId).emit('welcome', {
        message: `Welcome to ${this.name}, ${player.name}!`,
        rules: 'Game rules here...'
      });
    }
  }

  /**
   * Called when a player disconnects (but not yet removed)
   */
  onPlayerDisconnected(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} disconnected from room ${room.code}`);

    const gameState = room.gameState.data as YourGameState;

    // Handle disconnection during game
    if (room.gameState.phase === 'playing') {
      // If it was their turn, skip to next player
      if (gameState.currentTurn === player.id) {
        this.nextTurn(room);
      }
    }

    // Broadcast updated state (player.connected is now false)
    this.broadcastRoomState(room);
  }

  /**
   * Called when a player is removed (after disconnect timeout)
   */
  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} removed from room ${room.code}`);

    const gameState = room.gameState.data as YourGameState;

    // Clean up player-specific game data
    // Remove from any game structures

    // Check if game should end
    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
    if (room.gameState.phase === 'playing' && connectedPlayers.length < room.settings.minPlayers) {
      this.endGame(room, 'Not enough players');
    }

    // Broadcast updated state
    this.broadcastRoomState(room);
  }

  /**
   * Called when room is being destroyed
   */
  onRoomDestroy?(room: Room): void {
    console.log(`[${this.name}] Room ${room.code} is being destroyed`);

    // Clean up any room-specific resources
    this.clearRoomTimers(room.code);
  }

  // ============================================================================
  // CRITICAL: SERIALIZATION - Converts server Room to client format
  // ============================================================================

  /**
   * IMPORTANT: This function converts the server Room object to the format
   * expected by the client. This is called for each player individually.
   */
  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as YourGameState;
    const requestingPlayer = Array.from(room.players.values()).find(p => p.socketId === socketId);

    return {
      // Core room data
      code: room.code,
      hostId: room.hostId,

      // CRITICAL: Convert Map to Array for client
      players: Array.from(room.players.values()).map(p => {
        const playerData = p.gameData as YourPlayerData;
        return {
          socketId: p.socketId,
          name: p.name,
          isHost: p.isHost,
          connected: p.connected,
          disconnectedAt: p.disconnectedAt,

          // Include game-specific player data
          score: playerData?.score || 0,
          isReady: playerData?.isReady || false

          // Hide private data from other players
          // hand: p.id === requestingPlayer?.id ? playerData.hand : undefined
        };
      }),

      // Game state - map to client-friendly format
      state: this.mapPhaseToClientState(room.gameState.phase),

      // Game data
      gameData: {
        currentRound: gameState.currentRound,
        currentTurn: gameState.currentTurn,
        timeRemaining: gameState.timeRemaining,
        // Add any public game state here

        // Player-specific data (different for each player)
        // myPrivateData: requestingPlayer ? this.getPlayerPrivateData(requestingPlayer) : null
      },

      // Settings
      settings: {
        ...room.settings,
        gameSpecific: room.settings.gameSpecific as YourGameSettings
      },

      // Messages (last 100)
      messages: room.messages.slice(-100),

      // CRITICAL: Client needs to identify themselves
      mySocketId: socketId,

      // GameBuddies integration
      isGameBuddiesRoom: room.isGameBuddiesRoom || false,
      gameBuddiesRoomId: room.gameBuddiesRoomId
    };
  }

  // ============================================================================
  // SOCKET EVENT HANDLERS - Your game logic goes here
  // ============================================================================

  socketHandlers: Record<string, SocketEventHandler> = {
    /**
     * Start the game (host only)
     */
    'game:start': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        // Validate that requester is the host
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player?.isHost) {
          socket.emit('error', { message: 'Only the host can start the game' });
          return;
        }

        // Validate enough players
        const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
        if (connectedPlayers.length < room.settings.minPlayers) {
          socket.emit('error', {
            message: `Need at least ${room.settings.minPlayers} players to start`
          });
          return;
        }

        // Initialize game
        const gameState = room.gameState.data as YourGameState;
        gameState.currentRound = 1;
        gameState.currentTurn = connectedPlayers[0].id;
        gameState.timeRemaining = (room.settings.gameSpecific as YourGameSettings).timePerRound;

        // Update phase
        room.gameState.phase = 'playing';

        // Start game timer
        this.startGameTimer(room);

        // Notify all players
        helpers.sendToRoom(room.code, 'game:started', {
          message: 'Game has started!',
          firstPlayer: connectedPlayers[0].name
        });

        // Broadcast updated state
        this.broadcastRoomState(room);

        console.log(`[${this.name}] Game started in room ${room.code}`);

      } catch (error) {
        console.error(`[${this.name}] Error starting game:`, error);
        socket.emit('error', { message: 'Failed to start game' });
      }
    },

    /**
     * Player ready toggle
     */
    'player:ready': async (socket: Socket, data: { ready: boolean }, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player) return;

        const playerData = player.gameData as YourPlayerData;
        playerData.isReady = data.ready;

        // Check if all players are ready
        const allReady = Array.from(room.players.values())
          .filter(p => p.connected)
          .every(p => (p.gameData as YourPlayerData)?.isReady);

        if (allReady && room.players.size >= room.settings.minPlayers) {
          helpers.sendToRoom(room.code, 'all:ready', {});
        }

        // Broadcast updated state
        this.broadcastRoomState(room);

      } catch (error) {
        console.error(`[${this.name}] Error toggling ready:`, error);
        socket.emit('error', { message: 'Failed to update ready status' });
      }
    },

    /**
     * Example game action - Replace with your game actions
     */
    'game:action': async (socket: Socket, data: { action: string }, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player) return;

        const gameState = room.gameState.data as YourGameState;
        const playerData = player.gameData as YourPlayerData;

        // Validate it's this player's turn
        if (gameState.currentTurn !== player.id) {
          socket.emit('error', { message: "It's not your turn!" });
          return;
        }

        // Validate game is in progress
        if (room.gameState.phase !== 'playing') {
          socket.emit('error', { message: 'Game is not in progress' });
          return;
        }

        // Process the action
        playerData.lastAction = data.action;

        // Update score, game state, etc.
        playerData.score += 10;

        // Send feedback to player
        socket.emit('action:result', {
          success: true,
          points: 10,
          newScore: playerData.score
        });

        // Notify all players of the action
        helpers.sendToRoom(room.code, 'player:acted', {
          player: player.name,
          action: data.action
        });

        // Move to next turn
        this.nextTurn(room);

        // Check win conditions
        if (this.checkWinCondition(room)) {
          this.endGame(room);
        }

        // Broadcast updated state
        this.broadcastRoomState(room);

      } catch (error) {
        console.error(`[${this.name}] Error processing action:`, error);
        socket.emit('error', { message: 'Failed to process action' });
      }
    },

    /**
     * End game (host only)
     */
    'game:end': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player?.isHost) {
          socket.emit('error', { message: 'Only the host can end the game' });
          return;
        }

        this.endGame(room, 'Host ended the game');

      } catch (error) {
        console.error(`[${this.name}] Error ending game:`, error);
        socket.emit('error', { message: 'Failed to end game' });
      }
    },

    /**
     * Restart game (host only)
     */
    'game:restart': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player?.isHost) {
          socket.emit('error', { message: 'Only the host can restart the game' });
          return;
        }

        // Reset game state
        room.gameState.phase = 'lobby';
        room.gameState.data = {
          currentRound: 0,
          currentTurn: null,
          timeRemaining: 0
        } as YourGameState;

        // Reset player data
        room.players.forEach(p => {
          p.gameData = {
            score: 0,
            isReady: false,
            lastAction: null
          } as YourPlayerData;
        });

        // Clear timers
        this.clearRoomTimers(room.code);

        // Notify players
        helpers.sendToRoom(room.code, 'game:restarted', {});

        // Broadcast updated state
        this.broadcastRoomState(room);

        console.log(`[${this.name}] Game restarted in room ${room.code}`);

      } catch (error) {
        console.error(`[${this.name}] Error restarting game:`, error);
        socket.emit('error', { message: 'Failed to restart game' });
      }
    },

    /**
     * Update game settings (host only)
     */
    'settings:update': async (socket: Socket, data: { settings: Partial<YourGameSettings> }, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player?.isHost) {
          socket.emit('error', { message: 'Only the host can update settings' });
          return;
        }

        // Validate settings
        if (data.settings.roundsPerGame && (data.settings.roundsPerGame < 1 || data.settings.roundsPerGame > 10)) {
          socket.emit('error', { message: 'Invalid number of rounds' });
          return;
        }

        // Update settings
        room.settings.gameSpecific = {
          ...room.settings.gameSpecific,
          ...data.settings
        };

        // Notify all players
        helpers.sendToRoom(room.code, 'settings:updated', {
          settings: room.settings.gameSpecific
        });

        // Broadcast updated state
        this.broadcastRoomState(room);

      } catch (error) {
        console.error(`[${this.name}] Error updating settings:`, error);
        socket.emit('error', { message: 'Failed to update settings' });
      }
    }

    // Add more socket handlers for your game-specific events here
  };

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  /**
   * Broadcast room state to all players
   */
  private broadcastRoomState(room: Room): void {
    if (!this.io) return;

    const namespace = this.io.of(this.namespace);

    // Send personalized state to each player
    room.players.forEach(player => {
      const serialized = this.serializeRoom(room, player.socketId);
      namespace.to(player.socketId).emit('roomStateUpdated', serialized);
    });
  }

  /**
   * Map internal phase to client state
   */
  private mapPhaseToClientState(phase: string): string {
    switch (phase) {
      case 'lobby': return 'LOBBY_WAITING';
      case 'playing': return 'PLAYING';
      case 'ended': return 'GAME_ENDED';
      default: return 'UNKNOWN';
    }
  }

  /**
   * Start game timer
   */
  private startGameTimer(room: Room): void {
    const gameState = room.gameState.data as YourGameState;
    const settings = room.settings.gameSpecific as YourGameSettings;
    const timerKey = `${room.code}:timer`;

    // Clear existing timer
    this.clearTimer(timerKey);

    // Start countdown
    const interval = setInterval(() => {
      gameState.timeRemaining--;

      // Broadcast timer update
      if (this.io) {
        const namespace = this.io.of(this.namespace);
        namespace.to(room.code).emit('timer:update', {
          timeRemaining: gameState.timeRemaining
        });
      }

      // Check if time is up
      if (gameState.timeRemaining <= 0) {
        clearInterval(interval);
        this.intervals.delete(timerKey);
        this.onRoundTimeout(room);
      }
    }, 1000);

    this.intervals.set(timerKey, interval);
  }

  /**
   * Handle round timeout
   */
  private onRoundTimeout(room: Room): void {
    const gameState = room.gameState.data as YourGameState;

    // Move to next round or end game
    if (gameState.currentRound < (room.settings.gameSpecific as YourGameSettings).roundsPerGame) {
      this.nextRound(room);
    } else {
      this.endGame(room, 'All rounds completed');
    }
  }

  /**
   * Move to next turn
   */
  private nextTurn(room: Room): void {
    const gameState = room.gameState.data as YourGameState;
    const players = Array.from(room.players.values()).filter(p => p.connected);

    if (players.length === 0) return;

    // Find current player index
    const currentIndex = players.findIndex(p => p.id === gameState.currentTurn);

    // Move to next player (wrap around)
    const nextIndex = (currentIndex + 1) % players.length;
    gameState.currentTurn = players[nextIndex].id;

    // Notify players
    if (this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(room.code).emit('turn:changed', {
        currentPlayer: players[nextIndex].name
      });
    }
  }

  /**
   * Move to next round
   */
  private nextRound(room: Room): void {
    const gameState = room.gameState.data as YourGameState;
    const settings = room.settings.gameSpecific as YourGameSettings;

    gameState.currentRound++;
    gameState.timeRemaining = settings.timePerRound;

    // Reset round-specific data
    room.players.forEach(p => {
      const playerData = p.gameData as YourPlayerData;
      playerData.lastAction = null;
    });

    // Start new round timer
    this.startGameTimer(room);

    // Notify players
    if (this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(room.code).emit('round:started', {
        round: gameState.currentRound,
        totalRounds: settings.roundsPerGame
      });
    }

    this.broadcastRoomState(room);
  }

  /**
   * Check if someone has won
   */
  private checkWinCondition(room: Room): boolean {
    const settings = room.settings.gameSpecific as YourGameSettings;

    // Example win conditions - replace with your logic
    const winner = Array.from(room.players.values()).find(p => {
      const playerData = p.gameData as YourPlayerData;
      return playerData.score >= 100; // First to 100 points wins
    });

    return !!winner;
  }

  /**
   * End the game
   */
  private endGame(room: Room, reason?: string): void {
    // Clear all timers
    this.clearRoomTimers(room.code);

    // Update state
    room.gameState.phase = 'ended';

    // Calculate final scores
    const finalScores = Array.from(room.players.values())
      .map(p => ({
        playerId: p.id,
        playerName: p.name,
        score: (p.gameData as YourPlayerData)?.score || 0
      }))
      .sort((a, b) => b.score - a.score);

    // Determine winner
    const winner = finalScores[0];

    // Notify all players
    if (this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(room.code).emit('game:ended', {
        reason: reason || 'Game completed',
        winner,
        finalScores
      });
    }

    // Broadcast final state
    this.broadcastRoomState(room);

    console.log(`[${this.name}] Game ended in room ${room.code}. Winner: ${winner.playerName}`);
  }

  /**
   * Clear a specific timer
   */
  private clearTimer(key: string): void {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key)!);
      this.timers.delete(key);
    }
    if (this.intervals.has(key)) {
      clearInterval(this.intervals.get(key)!);
      this.intervals.delete(key);
    }
  }

  /**
   * Clear all timers for a room
   */
  private clearRoomTimers(roomCode: string): void {
    // Clear all timers that start with the room code
    this.timers.forEach((timer, key) => {
      if (key.startsWith(roomCode)) {
        clearTimeout(timer);
        this.timers.delete(key);
      }
    });

    this.intervals.forEach((interval, key) => {
      if (key.startsWith(roomCode)) {
        clearInterval(interval);
        this.intervals.delete(key);
      }
    });
  }

  // Add more helper methods as needed for your game
}

// ============================================================================
// EXPORT
// ============================================================================

export default new YourGamePlugin();