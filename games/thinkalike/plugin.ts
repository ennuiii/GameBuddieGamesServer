/**
 * ThinkAlike Game Plugin for GameBuddies Unified Server
 *
 * A 1v1 word synchronization game where two players share 5 lives
 * and try to think of the same word simultaneously.
 *
 * Victory Condition: First successful word match wins!
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
import {
  ThinkAlikeGameState,
  ThinkAlikePlayerData,
  ThinkAlikeSettings,
  GamePhase,
  RoundHistory,
  createInitialGameState,
  createInitialPlayerData,
  DEFAULT_SETTINGS
} from './types.js';

// ============================================================================
// PLUGIN CLASS
// ============================================================================

class ThinkAlikePlugin implements GamePlugin {
  // ============================================================================
  // PLUGIN METADATA
  // ============================================================================

  id = 'thinkalike';
  name = 'ThinkAlike';
  version = '1.0.0';
  description = '1v1 word synchronization game - share 5 lives and think of the same word!';
  author = 'GameBuddies';
  namespace = '/thinkalike';
  basePath = '/thinkalike';

  // ============================================================================
  // DEFAULT SETTINGS
  // ============================================================================

  defaultSettings: RoomSettings = {
    minPlayers: 2,  // Exactly 2 players required to start
    maxPlayers: 999,  // Allow unlimited players (2 active + unlimited spectators)
    gameSpecific: {
      ...DEFAULT_SETTINGS
    } as ThinkAlikeSettings
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
  }

  /**
   * Called when a room is created
   */
  onRoomCreate(room: Room): void {
    console.log(`[${this.name}] Room created: ${room.code}`);

    // Initialize game state
    const settings = room.settings.gameSpecific as ThinkAlikeSettings;
    room.gameState.data = createInitialGameState(settings);
    room.gameState.phase = 'lobby';
  }

  /**
   * Called when a player joins (or reconnects)
   */
  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    console.log(`[${this.name}] Player ${player.name} ${isReconnecting ? 'reconnected to' : 'joined'} room ${room.code}`);

    // Always initialize player data if missing (handles both new joins and reconnections)
    if (!player.gameData) {
      player.gameData = createInitialPlayerData();
    }

    const playerData = player.gameData as ThinkAlikePlayerData;

    // Auto-assign spectator role: first 2 players are active, 3+ are spectators
    if (!isReconnecting) {
      const activePlayers = Array.from(room.players.values())
        .filter(p => !(p.gameData as ThinkAlikePlayerData)?.isSpectator)
        .filter(p => p.socketId !== player.socketId); // Don't count the player joining

      if (activePlayers.length >= 2) {
        // This is the 3rd+ player, make them a spectator
        playerData.isSpectator = true;
        console.log(`[${this.name}] Player ${player.name} joined as SPECTATOR`);
      } else {
        // This is the 1st or 2nd player, they're active
        playerData.isSpectator = false;
      }
    }

    // Broadcast updated state to all players
    this.broadcastRoomState(room);

    // Send welcome message to new player
    if (!isReconnecting && this.io) {
      const namespace = this.io.of(this.namespace);
      const roleMsg = playerData.isSpectator ? 'spectator' : 'player';
      namespace.to(player.socketId).emit('welcome', {
        message: `Welcome to ${this.name}, ${player.name}! You are a ${roleMsg}.`,
        rules: playerData.isSpectator
          ? 'You are spectating! Watch the two players compete.'
          : 'Type the same word as your opponent to win! You share 5 lives.'
      });
    }
  }

  /**
   * Called when a player disconnects (but not yet removed)
   */
  onPlayerDisconnected(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} disconnected from room ${room.code}`);

    const gameState = room.gameState.data as ThinkAlikeGameState;

    // If game is in progress, pause timer
    if (gameState.phase === 'word_input' || gameState.phase === 'round_prep') {
      this.clearTimer(`${room.code}:round-timer`);
      console.log(`[${this.name}] Paused timer due to disconnection`);
    }

    // Broadcast updated state (player.connected is now false)
    this.broadcastRoomState(room);
  }

  /**
   * Called when a player is removed (after disconnect timeout)
   */
  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} removed from room ${room.code}`);

    const gameState = room.gameState.data as ThinkAlikeGameState;

    // Check if game should end (need exactly 2 players)
    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
    if (gameState.phase !== 'lobby' && connectedPlayers.length < 2) {
      this.endGame(room, 'Player left the game');
    }

    // Broadcast updated state
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
  // CRITICAL: SERIALIZATION - Converts server Room to client format
  // ============================================================================

  /**
   * IMPORTANT: This function converts the server Room object to the format
   * expected by the client. This is called for each player individually.
   */
  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as ThinkAlikeGameState;
    const allPlayers = Array.from(room.players.values());

    // Find requesting player and determine if they're a spectator
    const requestingPlayer = allPlayers.find(p => p.socketId === socketId);
    const isSpectator = (requestingPlayer?.gameData as ThinkAlikePlayerData)?.isSpectator || false;

    // Separate active players and spectators
    const activePlayers = allPlayers.filter(p => !(p.gameData as ThinkAlikePlayerData)?.isSpectator);
    const spectators = allPlayers.filter(p => (p.gameData as ThinkAlikePlayerData)?.isSpectator);

    return {
      // Core room data
      code: room.code,
      hostId: room.hostId,

      // Convert Map to Array for client (active players only)
      players: activePlayers.map((p, index) => {
        const playerData = p.gameData as ThinkAlikePlayerData;

        // Determine which word to show
        let currentWord = null;
        if (isSpectator) {
          // Spectators see LIVE words (real-time typing)
          currentWord = index === 0 ? gameState.player1LiveWord : gameState.player2LiveWord;
        } else if (p.socketId === socketId) {
          // Players see their own word
          currentWord = index === 0 ? gameState.player1Word : gameState.player2Word;
        }
        // Otherwise null (opponent's word hidden from opponent)

        return {
          socketId: p.socketId,
          name: p.name,
          isHost: p.isHost,
          connected: p.connected,
          disconnectedAt: p.disconnectedAt,
          isReady: playerData?.isReady || false,
          isSpectator: false,  // Active players, not spectators
          currentWord: currentWord,
          hasSubmitted: index === 0 ? gameState.player1Submitted : gameState.player2Submitted,
          premiumTier: p.premiumTier
        };
      }),

      // Spectators array (3rd+ players)
      spectators: spectators.map(s => ({
        socketId: s.socketId,
        name: s.name,
        isHost: s.isHost,
        connected: s.connected,
        isSpectator: true,
        premiumTier: s.premiumTier
      })),

      // Game state - map to client-friendly format
      state: this.mapPhaseToClientState(gameState.phase),

      // Game data
      gameData: {
        currentRound: gameState.currentRound,
        maxRounds: gameState.maxRounds,
        livesRemaining: gameState.livesRemaining,
        maxLives: gameState.maxLives,
        timeRemaining: gameState.timeRemaining,
        rounds: gameState.rounds,
        settings: {
          timerDuration: gameState.settings.timerDuration,
          maxLives: gameState.settings.maxLives
        }
      },

      // Settings
      settings: {
        minPlayers: room.settings.minPlayers,
        maxPlayers: room.settings.maxPlayers,
        timerDuration: gameState.settings.timerDuration,
        maxLives: gameState.settings.maxLives,
        voiceMode: gameState.settings.voiceMode
      },

      // Messages (last 100)
      messages: room.messages.slice(-100),

      // CRITICAL: Client needs to identify themselves
      mySocketId: socketId,

      // Spectator flag (am I a spectator?)
      isSpectator: isSpectator,

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

        // Ensure gameData exists before accessing (handles reconnection edge case)
        if (!player.gameData) {
          player.gameData = createInitialPlayerData();
        }

        const playerData = player.gameData as ThinkAlikePlayerData;
        playerData.isReady = data.ready;

        // Check if both active players are ready (ignore spectators)
        const activePlayers = Array.from(room.players.values())
          .filter(p => p.connected && !(p.gameData as ThinkAlikePlayerData)?.isSpectator);
        const allReady = activePlayers.length === 2 && activePlayers.every(p => (p.gameData as ThinkAlikePlayerData)?.isReady);

        if (allReady) {
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

        // Validate exactly 2 active players (not counting spectators)
        const activePlayers = Array.from(room.players.values())
          .filter(p => p.connected && !(p.gameData as ThinkAlikePlayerData)?.isSpectator);
        if (activePlayers.length !== 2) {
          socket.emit('error', { message: 'Need exactly 2 active players to start' });
          return;
        }

        // Initialize first round
        const gameState = room.gameState.data as ThinkAlikeGameState;
        gameState.phase = 'round_prep';
        gameState.currentRound = 1;
        gameState.player1Word = null;
        gameState.player2Word = null;
        gameState.player1Submitted = false;
        gameState.player2Submitted = false;

        // Update phase
        room.gameState.phase = 'round_prep';

        // Notify all players
        helpers.sendToRoom(room.code, 'game:started', {
          message: 'Game starting! Get ready...'
        });

        // Broadcast updated state
        this.broadcastRoomState(room);

        console.log(`[${this.name}] Game started in room ${room.code}`);

        // After 3.5 seconds, move to word input phase (matches client countdown: 3→2→1→GO!)
        const timerKey = `${room.code}:round-prep-transition`;
        const timeout = setTimeout(() => {
          // RACE CONDITION CHECK: Ensure phase hasn't changed (e.g. by restart/end game)
          if (room.gameState.phase !== 'round_prep') {
            console.log(`[${this.name}] Timer expired but phase changed to ${room.gameState.phase}, aborting transition`);
            return;
          }
          
          console.log(`[${this.name}] Round prep countdown complete, transitioning to word input in room ${room.code}`);
          this.startWordInputPhase(room);
        }, 3500);
        this.timers.set(timerKey, timeout);

      } catch (error) {
        console.error(`[${this.name}] Error starting game:`, error);
        socket.emit('error', { message: 'Failed to start game' });
      }
    },

    /**
     * Submit word
     */
    'game:submit-word': async (socket: Socket, data: { word: string }, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player) return;

        const gameState = room.gameState.data as ThinkAlikeGameState;

        // Validate phase
        if (gameState.phase !== 'word_input') {
          socket.emit('error', { message: 'Not in word input phase' });
          return;
        }

        // Validate word
        const word = data.word.trim().toUpperCase();
        if (!word || word.length === 0) {
          socket.emit('error', { message: 'Word cannot be empty' });
          return;
        }
        if (word.length > 50) {
          socket.emit('error', { message: 'Word too long (max 50 characters)' });
          return;
        }

        // Determine which player (player1 or player2)
        const players = Array.from(room.players.values());
        const playerIndex = players.findIndex(p => p.socketId === socket.id);

        if (playerIndex === 0) {
          gameState.player1Word = word;
          gameState.player1Submitted = true;
        } else {
          gameState.player2Word = word;
          gameState.player2Submitted = true;
        }

        console.log(`[${this.name}] Player ${player.name} submitted word in room ${room.code}`);

        // Check if both players have submitted
        if (gameState.player1Submitted && gameState.player2Submitted) {
          // Both submitted - move to reveal phase
          this.revealWords(room);
        } else {
          // Waiting for other player - broadcast state
          this.broadcastRoomState(room);
        }

      } catch (error) {
        console.error(`[${this.name}] Error submitting word:`, error);
        socket.emit('error', { message: 'Failed to submit word' });
      }
    },

    /**
     * Move to next round (after reveal)
     */
    'game:next-round': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as ThinkAlikeGameState;

        // Validate phase
        if (gameState.phase !== 'reveal') {
          return;
        }

        // Check if game should continue
        if (gameState.livesRemaining > 0) {
          // Continue to next round
          gameState.phase = 'round_prep';
          gameState.currentRound++;
          gameState.player1Word = null;
          gameState.player2Word = null;
          gameState.player1Submitted = false;
          gameState.player2Submitted = false;

          // Broadcast state
          this.broadcastRoomState(room);

          console.log(`[${this.name}] Moving to round ${gameState.currentRound} in room ${room.code}`);

          // After 3.5 seconds, start word input (matches client countdown: 3→2→1→GO!)
          const timerKey = `${room.code}:next-round-transition`;
          const timeout = setTimeout(() => {
            console.log(`[${this.name}] Round prep countdown complete in next-round, transitioning to word input in room ${room.code}`);
            this.startWordInputPhase(room);
          }, 3500);
          this.timers.set(timerKey, timeout);
        } else {
          // No lives left - game over
          this.endGame(room, 'all-lives-lost');
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
        const settings = room.settings.gameSpecific as ThinkAlikeSettings;
        room.gameState.phase = 'lobby';
        room.gameState.data = createInitialGameState(settings);

        // Reset player data
        room.players.forEach(p => {
          p.gameData = createInitialPlayerData();
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
    'settings:update': async (socket: Socket, data: { settings: Partial<ThinkAlikeSettings> }, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player?.isHost) {
          socket.emit('error', { message: 'Only the host can update settings' });
          return;
        }

        // Only allow updates in lobby
        if (room.gameState.phase !== 'lobby') {
          socket.emit('error', { message: 'Cannot change settings during game' });
          return;
        }

        // Validate settings
        if (data.settings.timerDuration && (data.settings.timerDuration < 30 || data.settings.timerDuration > 180)) {
          socket.emit('error', { message: 'Timer must be between 30 and 180 seconds' });
          return;
        }

        if (data.settings.maxLives && (data.settings.maxLives < 1 || data.settings.maxLives > 10)) {
          socket.emit('error', { message: 'Lives must be between 1 and 10' });
          return;
        }

        // Update settings
        const gameState = room.gameState.data as ThinkAlikeGameState;
        gameState.settings = {
          ...gameState.settings,
          ...data.settings
        };

        // Update lives if setting changed
        if (data.settings.maxLives) {
          gameState.maxLives = data.settings.maxLives;
          gameState.livesRemaining = data.settings.maxLives;
        }

        // Notify all players
        helpers.sendToRoom(room.code, 'settings:updated', {
          settings: gameState.settings
        });

        // Broadcast updated state
        this.broadcastRoomState(room);

      } catch (error) {
        console.error(`[${this.name}] Error updating settings:`, error);
        socket.emit('error', { message: 'Failed to update settings' });
      }
    },

    /**
     * Voice mode: Player votes on whether they matched
     */
    'game:voice-vote': async (socket: Socket, data: { vote: 'match' | 'no-match' }, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player) return;

        const gameState = room.gameState.data as ThinkAlikeGameState;

        // Validate phase
        if (gameState.phase !== 'word_input') {
          socket.emit('error', { message: 'Not in voice voting phase' });
          return;
        }

        // Store vote (reusing player word fields for vote storage)
        // Player 1 is first to join, Player 2 is second
        const isPlayer1 = Array.from(room.players.values())[0]?.id === player.id;
        if (isPlayer1) {
          gameState.player1Word = data.vote; // Store vote in word field temporarily
          gameState.player1Submitted = true;
        } else {
          gameState.player2Word = data.vote; // Store vote in word field temporarily
          gameState.player2Submitted = true;
        }

        console.log(`[${this.name}] Voice vote from ${player.name}: ${data.vote}`);

        // Notify opponent of the vote
        const opponentPlayer = Array.from(room.players.values()).find(p => p.id !== player.id);
        if (opponentPlayer && this.io) {
          const namespace = this.io.of(this.namespace);
          namespace.to(opponentPlayer.socketId).emit('game:opponent-vote', {
            playerId: player.id,
            playerName: player.name,
            vote: data.vote
          });
        }

        // Check if both players voted
        if (gameState.player1Submitted && gameState.player2Submitted) {
          const vote1 = gameState.player1Word as string;
          const vote2 = gameState.player2Word as string;

          if (vote1 === vote2) {
            // AGREEMENT
            if (vote1 === 'match') {
              // Victory!
              gameState.phase = 'victory';
              room.gameState.phase = 'victory';

              // Add to history
              const roundHistory: RoundHistory = {
                number: gameState.currentRound,
                player1Word: 'MATCH', // Use vote indicator in history
                player2Word: 'MATCH',
                wasMatch: true,
                timeTaken: 0,
                timestamp: Date.now()
              };
              gameState.rounds.push(roundHistory);

              // Broadcast final state
              this.broadcastRoomState(room);

              // Notify players
              if (this.io) {
                const namespace = this.io.of(this.namespace);
                namespace.to(room.code).emit('game:victory', {
                  matchedWord: 'VOICE_MODE_MATCH',
                  round: gameState.currentRound,
                  timeTaken: 0
                });
              }

              console.log(`[${this.name}] VOICE MODE VICTORY in room ${room.code}!`);
            } else {
              // No match, lose a life
              gameState.livesRemaining--;

              // Add to history
              const roundHistory: RoundHistory = {
                number: gameState.currentRound,
                player1Word: 'NO_MATCH',
                player2Word: 'NO_MATCH',
                wasMatch: false,
                timeTaken: 0,
                timestamp: Date.now()
              };
              gameState.rounds.push(roundHistory);

              if (gameState.livesRemaining > 0) {
                // Continue to next round
                gameState.phase = 'reveal'; // Show the reveal screen
                room.gameState.phase = 'reveal';

                // Broadcast state to show result
                this.broadcastRoomState(room);

                console.log(`[${this.name}] Voice mode no-match in room ${room.code}, lives: ${gameState.livesRemaining}`);
              } else {
                // Game over
                this.endGame(room, 'all-lives-lost');
              }
            }
          } else {
            // DISAGREEMENT - Both agreed but voted differently
            // The client side will handle dispute UI, we just track that both voted
            console.log(`[${this.name}] Voice mode vote disagreement in room ${room.code}: ${vote1} vs ${vote2}`);
            // Client will show dispute dialog and re-vote
          }
        }

      } catch (error) {
        console.error(`[${this.name}] Error in voice vote:`, error);
        socket.emit('error', { message: 'Failed to submit voice vote' });
      }
    },

    /**
     * Voice mode: Player revotes during dispute
     */
    'game:voice-dispute-revote': async (socket: Socket, data: { vote: 'match' | 'no-match' }, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player) return;

        const gameState = room.gameState.data as ThinkAlikeGameState;

        // Reset opponent's vote to allow revoting
        const isPlayer1 = Array.from(room.players.values())[0]?.id === player.id;
        if (isPlayer1) {
          gameState.player1Word = data.vote;
          gameState.player2Submitted = false; // Reset opponent's submission flag
        } else {
          gameState.player2Word = data.vote;
          gameState.player1Submitted = false; // Reset opponent's submission flag
        }

        console.log(`[${this.name}] Voice mode revote from ${player.name}: ${data.vote}`);

        // Notify opponent of the revote
        const opponentPlayer = Array.from(room.players.values()).find(p => p.id !== player.id);
        if (opponentPlayer && this.io) {
          const namespace = this.io.of(this.namespace);
          namespace.to(opponentPlayer.socketId).emit('game:opponent-vote', {
            playerId: player.id,
            playerName: player.name,
            vote: data.vote
          });
        }

        // Check if both players have voted again
        if (gameState.player1Submitted && gameState.player2Submitted) {
          const vote1 = gameState.player1Word as string;
          const vote2 = gameState.player2Word as string;

          if (vote1 === vote2) {
            // AGREEMENT on revote
            if (vote1 === 'match') {
              // Victory!
              gameState.phase = 'victory';
              room.gameState.phase = 'victory';

              // Broadcast final state
              this.broadcastRoomState(room);

              // Notify players
              if (this.io) {
                const namespace = this.io.of(this.namespace);
                namespace.to(room.code).emit('game:victory', {
                  matchedWord: 'VOICE_MODE_MATCH',
                  round: gameState.currentRound,
                  timeTaken: 0
                });
              }

              console.log(`[${this.name}] VOICE MODE VICTORY (after dispute) in room ${room.code}!`);
            } else {
              // No match, lose a life
              gameState.livesRemaining--;

              if (gameState.livesRemaining > 0) {
                // Continue to next round
                gameState.phase = 'reveal';
                room.gameState.phase = 'reveal';

                // Broadcast state
                this.broadcastRoomState(room);
              } else {
                // Game over
                this.endGame(room, 'all-lives-lost');
              }
            }
          } else {
            // Still disagreeing - client will show dispute again
            console.log(`[${this.name}] Voice mode still disagreeing in room ${room.code}: ${vote1} vs ${vote2}`);
          }
        }

      } catch (error) {
        console.error(`[${this.name}] Error in voice dispute revote:`, error);
        socket.emit('error', { message: 'Failed to submit revote' });
      }
    },

    /**
     * Live typing update (players send their current typed word to spectators)
     * Only broadcasts to spectators, not to other players (for privacy)
     */
    'game:typing-update': async (socket: Socket, data: { word: string }, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player) return;

        const playerData = player.gameData as ThinkAlikePlayerData;

        // Only active players can send typing updates, not spectators
        if (playerData?.isSpectator) return;

        const gameState = room.gameState.data as ThinkAlikeGameState;

        // Only accept typing during WORD_INPUT phase
        if (gameState.phase !== 'word_input') return;

        // Get all active players (non-spectators)
        const activePlayers = Array.from(room.players.values())
          .filter(p => !(p.gameData as ThinkAlikePlayerData)?.isSpectator);

        // Find which player this is (0 or 1)
        const playerIndex = activePlayers.findIndex(p => p.socketId === socket.id);
        if (playerIndex === -1) return;

        // Update live word in game state
        if (playerIndex === 0) {
          gameState.player1LiveWord = data.word;
        } else {
          gameState.player2LiveWord = data.word;
        }

        // Broadcast ONLY to spectators (not to other players for privacy)
        const spectators = Array.from(room.players.values())
          .filter(p => (p.gameData as ThinkAlikePlayerData)?.isSpectator);

        if (this.io && spectators.length > 0) {
          const namespace = this.io.of(this.namespace);
          spectators.forEach(spectator => {
            namespace.to(spectator.socketId).emit('spectator:typing-update', {
              playerIndex,
              playerName: player.name,
              word: data.word
            });
          });
        }

      } catch (error) {
        console.error(`[${this.name}] Error in game:typing-update:`, error);
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

    // Send personalized state to each player
    room.players.forEach(player => {
      const serialized = this.serializeRoom(room, player.socketId);
      namespace.to(player.socketId).emit('roomStateUpdated', serialized);
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
      case 'word_input':
        return 'WORD_INPUT';
      case 'reveal':
        return 'REVEAL';
      case 'victory':
        return 'VICTORY';
      case 'game_over':
        return 'GAME_OVER';
      default:
        return 'LOBBY_WAITING';
    }
  }

  /**
   * Start word input phase
   */
  private startWordInputPhase(room: Room): void {
    const gameState = room.gameState.data as ThinkAlikeGameState;

    // Update phase
    gameState.phase = 'word_input';
    room.gameState.phase = 'word_input';

    // Reset timer
    gameState.timeRemaining = gameState.settings.timerDuration;
    gameState.timerStartedAt = Date.now();

    // Broadcast state
    this.broadcastRoomState(room);

    // Start countdown timer
    this.startRoundTimer(room);

    console.log(`[${this.name}] Word input phase started in room ${room.code}`);
  }

  /**
   * Start round timer
   */
  private startRoundTimer(room: Room): void {
    const gameState = room.gameState.data as ThinkAlikeGameState;
    const timerKey = `${room.code}:round-timer`;

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
    const gameState = room.gameState.data as ThinkAlikeGameState;

    console.log(`[${this.name}] Round timeout in room ${room.code}`);

    // If both players haven't submitted, auto-submit empty words
    if (!gameState.player1Submitted) {
      gameState.player1Word = '';
      gameState.player1Submitted = true;
    }
    if (!gameState.player2Submitted) {
      gameState.player2Word = '';
      gameState.player2Submitted = true;
    }

    // Reveal words
    this.revealWords(room);
  }

  /**
   * Reveal words and check for match
   */
  private revealWords(room: Room): void {
    const gameState = room.gameState.data as ThinkAlikeGameState;

    // Stop timer
    this.clearTimer(`${room.code}:round-timer`);

    // Calculate time taken
    const timeTaken = gameState.timerStartedAt
      ? Math.floor((Date.now() - gameState.timerStartedAt) / 1000)
      : gameState.settings.timerDuration - gameState.timeRemaining;

    // Check if words match (case-insensitive, trimmed)
    const word1 = (gameState.player1Word || '').trim().toUpperCase();
    const word2 = (gameState.player2Word || '').trim().toUpperCase();
    const isMatch = word1.length > 0 && word1 === word2;

    console.log(`[${this.name}] Reveal: "${word1}" vs "${word2}" - Match: ${isMatch}`);

    // Add to history
    const roundHistory: RoundHistory = {
      number: gameState.currentRound,
      player1Word: gameState.player1Word || '',
      player2Word: gameState.player2Word || '',
      wasMatch: isMatch,
      timeTaken,
      timestamp: Date.now()
    };
    gameState.rounds.push(roundHistory);

    if (isMatch) {
      // Victory! First match wins
      gameState.phase = 'victory';
      room.gameState.phase = 'victory';

      // Broadcast final state
      this.broadcastRoomState(room);

      // Notify players
      if (this.io) {
        const namespace = this.io.of(this.namespace);
        namespace.to(room.code).emit('game:victory', {
          matchedWord: word1,
          round: gameState.currentRound,
          timeTaken
        });
      }

      console.log(`[${this.name}] VICTORY in room ${room.code}! Word: ${word1}`);

    } else {
      // No match - lose a life
      gameState.livesRemaining--;

      if (gameState.livesRemaining <= 0) {
        // Game over - all lives lost
        this.endGame(room, 'all-lives-lost');
      } else {
        // Move to reveal phase
        gameState.phase = 'reveal';
        room.gameState.phase = 'reveal';

        // Broadcast state
        this.broadcastRoomState(room);

        // Notify players
        if (this.io) {
          const namespace = this.io.of(this.namespace);
          namespace.to(room.code).emit('game:no-match', {
            player1Word: gameState.player1Word,
            player2Word: gameState.player2Word,
            livesRemaining: gameState.livesRemaining
          });
        }

        console.log(`[${this.name}] No match in room ${room.code}. Lives: ${gameState.livesRemaining}`);
      }
    }
  }

  /**
   * End the game
   */
  private endGame(room: Room, reason: 'all-lives-lost' | 'player-left' | string): void {
    // Clear all timers
    this.clearRoomTimers(room.code);

    // Update state
    const gameState = room.gameState.data as ThinkAlikeGameState;
    gameState.phase = 'game_over';
    room.gameState.phase = 'game_over';

    // Broadcast final state
    this.broadcastRoomState(room);

    // Notify all players
    if (this.io) {
      const namespace = this.io.of(this.namespace);
      namespace.to(room.code).emit('game:ended', {
        reason,
        rounds: gameState.rounds,
        totalRounds: gameState.currentRound
      });
    }

    console.log(`[${this.name}] Game ended in room ${room.code}. Reason: ${reason}`);
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
}

// ============================================================================
// EXPORT
// ============================================================================

export default new ThinkAlikePlugin();
