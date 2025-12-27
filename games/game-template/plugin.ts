/**
 * Game Template Plugin for GameBuddies Unified Server
 *
 * This is a template for creating new game plugins.
 * Replace 'GameTemplate' with your game name throughout.
 *
 * To use this plugin:
 * 1. Copy this folder to GameBuddieGamesServer/games/your-game-name/
 * 2. Update the metadata (id, name, namespace, basePath)
 * 3. Implement your game logic in the TODO sections
 * 4. Register the plugin in GameBuddieGamesServer/index.ts
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
} from '../../core/types/core';
import type { Socket } from 'socket.io';
import { gameBuddiesService } from '../../core/services/GameBuddiesService.js';
import {
  GameState,
  PlayerData,
  GameSettings,
  GamePhase,
  createInitialGameState,
  createInitialPlayerData,
  DEFAULT_SETTINGS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  COUNTDOWN_DURATION_MS,
  TIMER_UPDATE_INTERVAL_MS,
  MAX_STORED_MESSAGES
} from './types.js';

// ============================================================================
// PLUGIN CLASS
// ============================================================================

class GameTemplatePlugin implements GamePlugin {
  // ============================================================================
  // PLUGIN METADATA - TODO: Update these for your game
  // ============================================================================

  id = 'game-template';           // Unique identifier (kebab-case)
  name = 'Game Template';         // Display name
  version = '1.0.0';
  description = 'A template game for GameBuddies platform';
  author = 'GameBuddies';
  namespace = '/game-template';   // Socket.IO namespace (must match basePath)
  basePath = '/game-template';    // URL path prefix

  // ============================================================================
  // DEFAULT SETTINGS
  // ============================================================================

  defaultSettings: RoomSettings = {
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    gameSpecific: { ...DEFAULT_SETTINGS } as GameSettings
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

    // TODO: Initialize any external resources (database connections, etc.)
  }

  /**
   * Called when a room is created
   */
  onRoomCreate(room: Room): void {
    console.log(`[${this.name}] Room created: ${room.code}`);

    // Initialize game state
    const settings = room.settings.gameSpecific as GameSettings;
    room.gameState.data = createInitialGameState(settings);
    room.gameState.phase = 'lobby';
  }

  /**
   * Called when a player joins (or reconnects)
   */
  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    console.log(
      `[${this.name}] Player ${player.name} ${isReconnecting ? 'reconnected to' : 'joined'} room ${room.code}`
    );

    const namespace = this.io?.of(this.namespace);

    // Initialize player data if missing
    if (!player.gameData) {
      player.gameData = createInitialPlayerData();
    }

    const playerData = player.gameData as PlayerData;

    // Handle reconnection
    if (isReconnecting) {
      player.connected = true;
      player.disconnectedAt = undefined;
      player.lastActivity = Date.now();

      // TODO: Resume any paused timers if all players are connected

      // Sync state to reconnecting player
      if (namespace) {
        namespace.to(player.socketId).emit('room:updated', {
          room: this.serializeRoom(room, player.socketId)
        });
      }

      this.broadcastRoomState(room);
      return;
    }

    // New player join logic
    // TODO: Implement spectator logic if your game supports it
    // Example: If game is in progress, mark new players as spectators
    const gameState = room.gameState.data as GameState;
    if (gameState.phase !== 'lobby') {
      playerData.isSpectator = true;
    }

    // Broadcast updated state
    this.broadcastRoomState(room);

    // Send welcome message
    if (this.io) {
      namespace.to(player.socketId).emit('welcome', {
        message: `Welcome to ${this.name}, ${player.name}!`,
        rules: 'TODO: Add your game rules here'
      });
    }
  }

  /**
   * Called when a player disconnects (but not yet removed)
   */
  onPlayerDisconnected(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} disconnected from room ${room.code}`);

    const gameState = room.gameState.data as GameState;

    // TODO: Pause timer if game is in progress
    if (gameState.phase === 'playing') {
      this.clearTimer(`${room.code}:round-timer`);
      console.log(`[${this.name}] Paused timer due to disconnection`);
    }

    this.broadcastRoomState(room);
  }

  /**
   * Called when a player is removed (after disconnect timeout)
   */
  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} removed from room ${room.code}`);

    const gameState = room.gameState.data as GameState;

    // Check if game should end (not enough players)
    const connectedPlayers = Array.from(room.players.values())
      .filter(p => p.connected && !(p.gameData as PlayerData)?.isSpectator);

    if (gameState.phase !== 'lobby' && connectedPlayers.length < MIN_PLAYERS) {
      this.endGame(room, 'player-left');
    }

    this.broadcastRoomState(room);
  }

  /**
   * Called when room is being destroyed
   */
  onRoomDestroy?(room: Room): void {
    console.log(`[${this.name}] Room ${room.code} is being destroyed`);
    this.clearRoomTimers(room.code);
  }

  // ============================================================================
  // SERIALIZATION - Converts server Room to client format
  // ============================================================================

  /**
   * IMPORTANT: This function converts the server Room object to the format
   * expected by the client. Called for each player individually.
   *
   * TODO: Customize the serialization for your game's data structure
   */
  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as GameState;
    const allPlayers = Array.from(room.players.values());

    // Find requesting player
    const requestingPlayer = allPlayers.find(p => p.socketId === socketId);
    const isSpectator = (requestingPlayer?.gameData as PlayerData)?.isSpectator || false;

    // Separate active players and spectators
    const activePlayers = allPlayers.filter(p => !(p.gameData as PlayerData)?.isSpectator);
    const spectators = allPlayers.filter(p => (p.gameData as PlayerData)?.isSpectator);

    return {
      // Core room data
      code: room.code,
      hostId: room.hostId,

      // Players array (active players only)
      players: activePlayers.map(p => {
        const playerData = p.gameData as PlayerData;

        return {
          socketId: p.socketId,
          name: p.name,
          isHost: p.isHost,
          connected: p.connected,
          disconnectedAt: p.disconnectedAt,
          isReady: playerData?.isReady || false,
          isSpectator: false,
          premiumTier: p.premiumTier,
          avatarUrl: p.avatarUrl,
          // TODO: Add game-specific player data that clients need
          // Be careful not to expose secret data (like cards in hand) to other players
        };
      }),

      // Spectators array
      spectators: spectators.map(s => ({
        socketId: s.socketId,
        name: s.name,
        isHost: s.isHost,
        connected: s.connected,
        isSpectator: true,
        premiumTier: s.premiumTier,
        avatarUrl: s.avatarUrl
      })),

      // Game state - map to client-friendly format
      state: this.mapPhaseToClientState(gameState.phase),

      // Game data
      gameData: {
        currentRound: gameState.currentRound,
        maxRounds: gameState.maxRounds,
        score: gameState.score,
        livesRemaining: gameState.livesRemaining,
        maxLives: gameState.maxLives,
        timeRemaining: gameState.timeRemaining,
        rounds: gameState.rounds,
        settings: {
          timerDuration: gameState.settings.timerDuration,
          maxLives: gameState.settings.maxLives
        },
        // TODO: Add game-specific data
      },

      // Settings
      settings: {
        minPlayers: room.settings.minPlayers,
        maxPlayers: room.settings.maxPlayers,
        ...gameState.settings
      },

      // Messages (most recent)
      messages: room.messages.slice(-MAX_STORED_MESSAGES),

      // CRITICAL: Client needs to identify themselves
      mySocketId: socketId,

      // Spectator flag
      isSpectator: isSpectator,

      // Streamer Mode
      isStreamerMode: room.isStreamerMode || false,
      hideRoomCode: room.hideRoomCode || false,

      // GameBuddies integration
      isGameBuddiesRoom: room.isGameBuddiesRoom || false,
      gameBuddiesRoomId: room.gameBuddiesRoomId
    };
  }

  // ============================================================================
  // SOCKET EVENT HANDLERS
  // ============================================================================

  socketHandlers: Record<string, SocketEventHandler> = {
    /**
     * Player ready toggle
     */
    'player:ready': async (socket: Socket, data: { ready: boolean }, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player) return;

        // Ensure gameData exists
        if (!player.gameData) {
          player.gameData = createInitialPlayerData();
        }

        const playerData = player.gameData as PlayerData;
        playerData.isReady = data.ready;

        // Check if all players are ready
        const activePlayers = Array.from(room.players.values())
          .filter(p => p.connected && !(p.gameData as PlayerData)?.isSpectator);
        const allReady = activePlayers.length >= MIN_PLAYERS &&
          activePlayers.every(p => (p.gameData as PlayerData)?.isReady);

        if (allReady) {
          helpers.sendToRoom(room.code, 'all:ready', {});
        }

        this.broadcastRoomState(room);

      } catch (error) {
        console.error(`[${this.name}] Error toggling ready:`, error);
        socket.emit('error', { message: 'Failed to update ready status' });
      }
    },

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

        // Validate player count
        const activePlayers = Array.from(room.players.values())
          .filter(p => p.connected && !(p.gameData as PlayerData)?.isSpectator);
        if (activePlayers.length < MIN_PLAYERS) {
          socket.emit('error', { message: `Need at least ${MIN_PLAYERS} players to start` });
          return;
        }

        const gameState = room.gameState.data as GameState;

        // TODO: Initialize first round
        gameState.phase = 'round_prep';
        gameState.currentRound = 1;
        room.gameState.phase = 'round_prep';

        // Notify players
        helpers.sendToRoom(room.code, 'game:started', {
          message: 'Game starting! Get ready...'
        });

        this.broadcastRoomState(room);

        console.log(`[${this.name}] Game started in room ${room.code}`);

        // After countdown, move to playing phase
        const timerKey = `${room.code}:round-prep-transition`;
        const timeout = setTimeout(() => {
          // Race condition check
          if (room.gameState.phase !== 'round_prep') return;

          console.log(`[${this.name}] Countdown complete, starting round`);
          this.startPlayingPhase(room);
        }, COUNTDOWN_DURATION_MS);
        this.timers.set(timerKey, timeout);

      } catch (error) {
        console.error(`[${this.name}] Error starting game:`, error);
        socket.emit('error', { message: 'Failed to start game' });
      }
    },

    /**
     * Game action - TODO: Implement your game-specific actions
     * Examples: 'game:submit-answer', 'game:play-card', 'game:draw', etc.
     */
    'game:action': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player) return;

        const gameState = room.gameState.data as GameState;

        // Validate phase
        if (gameState.phase !== 'playing') {
          socket.emit('error', { message: 'Not in playing phase' });
          return;
        }

        // TODO: Implement your game action logic
        console.log(`[${this.name}] Action from ${player.name}:`, data);

        // Example: Process action, update state, check win condition
        // gameState.score += data.points;
        // if (checkWinCondition(gameState)) {
        //   this.handleVictory(room);
        // }

        this.broadcastRoomState(room);

      } catch (error) {
        console.error(`[${this.name}] Error processing action:`, error);
        socket.emit('error', { message: 'Failed to process action' });
      }
    },

    /**
     * Move to next round
     */
    'game:next-round': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as GameState;

        // Validate phase
        if (gameState.phase !== 'round_end') return;

        // Check if game should continue
        if (gameState.livesRemaining > 0 && gameState.currentRound < gameState.maxRounds) {
          gameState.phase = 'round_prep';
          room.gameState.phase = 'round_prep';
          gameState.currentRound++;

          this.broadcastRoomState(room);

          // After countdown, start next round
          const timerKey = `${room.code}:next-round-transition`;
          const timeout = setTimeout(() => {
            if (room.gameState.phase !== 'round_prep') return;
            this.startPlayingPhase(room);
          }, COUNTDOWN_DURATION_MS);
          this.timers.set(timerKey, timeout);
        } else {
          // Game over
          this.endGame(room, gameState.livesRemaining <= 0 ? 'out-of-lives' : 'max-rounds');
        }

      } catch (error) {
        console.error(`[${this.name}] Error moving to next round:`, error);
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
        const settings = room.settings.gameSpecific as GameSettings;
        room.gameState.phase = 'lobby';
        room.gameState.data = createInitialGameState(settings);

        // Reset player data
        room.players.forEach(p => {
          p.gameData = createInitialPlayerData();
        });

        // Clear timers
        this.clearRoomTimers(room.code);

        helpers.sendToRoom(room.code, 'game:restarted', {});
        this.broadcastRoomState(room);

        console.log(`[${this.name}] Game restarted in room ${room.code}`);

      } catch (error) {
        console.error(`[${this.name}] Error restarting game:`, error);
        socket.emit('error', { message: 'Failed to restart game' });
      }
    },

    /**
     * Update game settings (host only, lobby only)
     */
    'settings:update': async (socket: Socket, data: { settings: Partial<GameSettings> }, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player?.isHost) {
          socket.emit('error', { message: 'Only the host can update settings' });
          return;
        }

        if (room.gameState.phase !== 'lobby') {
          socket.emit('error', { message: 'Cannot change settings during game' });
          return;
        }

        // Validate and update settings
        const gameState = room.gameState.data as GameState;
        gameState.settings = {
          ...gameState.settings,
          ...data.settings
        };

        // Update related state (e.g., lives)
        if (data.settings.maxLives) {
          gameState.maxLives = data.settings.maxLives;
          gameState.livesRemaining = data.settings.maxLives;
        }

        helpers.sendToRoom(room.code, 'settings:updated', {
          settings: gameState.settings
        });

        this.broadcastRoomState(room);

      } catch (error) {
        console.error(`[${this.name}] Error updating settings:`, error);
        socket.emit('error', { message: 'Failed to update settings' });
      }
    }
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

    room.players.forEach(player => {
      namespace.to(player.socketId).emit('roomStateUpdated', this.serializeRoom(room, player.socketId));
    });
  }

  /**
   * Map internal phase to client state
   */
  private mapPhaseToClientState(phase: GamePhase): string {
    switch (phase) {
      case 'lobby':
        return 'LOBBY_WAITING';
      case 'round_prep':
        return 'ROUND_PREP';
      case 'playing':
        return 'PLAYING';
      case 'round_end':
        return 'ROUND_END';
      case 'victory':
        return 'VICTORY';
      case 'game_over':
        return 'GAME_OVER';
      default:
        return 'LOBBY_WAITING';
    }
  }

  /**
   * Start playing phase
   */
  private startPlayingPhase(room: Room): void {
    const gameState = room.gameState.data as GameState;

    gameState.phase = 'playing';
    room.gameState.phase = 'playing';

    // Reset timer
    gameState.timeRemaining = gameState.settings.timerDuration;
    gameState.timerStartedAt = Date.now();

    // TODO: Initialize round-specific state
    // Example: Select question, deal cards, etc.

    this.broadcastRoomState(room);

    // Start round timer (if applicable)
    if (gameState.settings.timerDuration > 0) {
      this.startRoundTimer(room);
    }

    console.log(`[${this.name}] Playing phase started in room ${room.code}`);
  }

  /**
   * Start round timer
   */
  private startRoundTimer(room: Room): void {
    const gameState = room.gameState.data as GameState;
    const timerKey = `${room.code}:round-timer`;

    this.clearTimer(timerKey);

    const interval = setInterval(() => {
      try {
        gameState.timeRemaining--;

        // Broadcast timer update
        if (this.io) {
          const namespace = this.io.of(this.namespace);
          namespace.to(room.code).emit('timer:update', {
            timeRemaining: gameState.timeRemaining
          });
        }

        // Time's up
        if (gameState.timeRemaining <= 0) {
          clearInterval(interval);
          this.intervals.delete(timerKey);
          this.onRoundTimeout(room);
        }
      } catch (error) {
        console.error(`[${this.name}] Timer error:`, error);
        clearInterval(interval);
        this.intervals.delete(timerKey);
      }
    }, TIMER_UPDATE_INTERVAL_MS);

    this.intervals.set(timerKey, interval);
  }

  /**
   * Handle round timeout
   */
  private onRoundTimeout(room: Room): void {
    const gameState = room.gameState.data as GameState;

    if (gameState.phase !== 'playing') return;

    console.log(`[${this.name}] Round timeout in room ${room.code}`);

    // TODO: Handle timeout (e.g., lose a life, auto-submit, etc.)
    gameState.livesRemaining--;

    if (gameState.livesRemaining > 0) {
      gameState.phase = 'round_end';
      room.gameState.phase = 'round_end';
      this.broadcastRoomState(room);
    } else {
      this.endGame(room, 'out-of-lives');
    }
  }

  /**
   * End the game
   */
  private endGame(room: Room, reason: string): void {
    this.clearRoomTimers(room.code);

    const gameState = room.gameState.data as GameState;
    gameState.phase = 'game_over';
    room.gameState.phase = 'game_over';

    // Grant rewards (if GameBuddies integration)
    this.grantEndGameRewards(room, reason);

    this.broadcastRoomState(room);

    if (this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(room.code).emit('game:ended', {
        reason,
        rounds: gameState.rounds,
        totalRounds: gameState.currentRound,
        finalScore: gameState.score
      });
    }

    console.log(`[${this.name}] Game ended in room ${room.code}. Reason: ${reason}`);
  }

  /**
   * Grant rewards at game end (GameBuddies integration)
   */
  private async grantEndGameRewards(room: Room, reason: string): Promise<void> {
    const gameState = room.gameState.data as GameState;
    const durationSeconds = Math.floor((Date.now() - room.createdAt) / 1000);

    const activePlayers = Array.from(room.players.values())
      .filter(p => !(p.gameData as PlayerData)?.isSpectator && p.userId);

    for (const player of activePlayers) {
      if (!player.userId) continue;

      try {
        const isVictory = reason === 'victory' || gameState.phase === 'victory';
        const reward = await gameBuddiesService.grantReward(this.id, player.userId, {
          won: isVictory,
          durationSeconds,
          score: gameState.score,
          metadata: {
            reason,
            totalRounds: gameState.currentRound
          }
        });

        if (reward && this.io) {
          const namespace = this.io.of(this.namespace);
          namespace.to(player.socketId).emit('player:reward', reward);
        }
      } catch (err) {
        console.error(`[${this.name}] Failed to grant reward to ${player.name}:`, err);
      }
    }
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
}

// ============================================================================
// EXPORT
// ============================================================================

export default new GameTemplatePlugin();
