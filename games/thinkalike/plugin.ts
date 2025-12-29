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
import { gameBuddiesService } from '../../core/services/GameBuddiesService.js';
import {
  ThinkAlikeGameState,
  ThinkAlikePlayerData,
  ThinkAlikeSettings,
  GamePhase,
  GameMode,
  Team,
  TeamPlayer,
  RoundHistory,
  createInitialGameState,
  createInitialPlayerData,
  createTeam,
  createTeamPlayer,
  resetTeamsForNewRound,
  TEAM_PRESETS,
  DEFAULT_SETTINGS
} from './types.js';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  MIN_PLAYERS_PAIRS_MODE,
  MAX_TEAMS,
  TYPING_UPDATE_INTERVAL_MS,
  COUNTDOWN_DURATION_MS,
  VOICE_VOTE_TIMEOUT_MS,
  TIMER_UPDATE_INTERVAL_MS,
  MAX_STORED_MESSAGES,
  MIN_TIMER_DURATION_SECONDS,
  MAX_TIMER_DURATION_SECONDS,
} from './constants.js';

// ============================================================================
// PLUGIN CLASS
// ============================================================================

class ThinkAlikePlugin implements GamePlugin {
  // ============================================================================
  // PLUGIN METADATA
  // ============================================================================

  id = 'thinkalike';
  name = 'ThinkAlike';
  version = '2.0.0';
  description = 'Word synchronization game - Classic 1v1 or Pairs mode (2v2, 2v2v2, 2v2v2v2)!';
  author = 'GameBuddies';
  namespace = '/thinkalike';
  basePath = '/thinkalike';

  // ============================================================================
  // DEFAULT SETTINGS
  // ============================================================================

  defaultSettings: RoomSettings = {
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
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
  // Rate limiting for typing updates
  private lastTypingUpdate = new Map<string, number>();
  // Guard against race conditions - prevent double reveals
  private revealInProgress = new Set<string>();
  // Guard against double timeout handling
  private timeoutInProgress = new Set<string>();

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
    console.log(
      `[${this.name}] Player ${player.name} ${isReconnecting ? 'reconnected to' : 'joined'} room ${room.code} | players:`,
      Array.from(room.players.keys())
    );

    const namespace = this.io?.of(this.namespace);
    const existingPlayer = room.players.get(player.id);
    const resolvedPlayer = existingPlayer || player;
    const socketChanged = existingPlayer ? existingPlayer.socketId !== player.socketId : false;
    const shouldTreatAsReconnect = isReconnecting || !!existingPlayer;

    if (existingPlayer) {
      console.log(
        `[${this.name}] ⚠️ existing player detected for ${player.name} in ${room.code} | existingSocket=${existingPlayer.socketId} newSocket=${player.socketId} socketChanged=${socketChanged}`
      );
    }

    // Merge basic fields if the core provided a fresh Player instance while one already exists in the room
    if (existingPlayer && existingPlayer !== player) {
      existingPlayer.premiumTier = existingPlayer.premiumTier || player.premiumTier;
      if (!existingPlayer.gameData && player.gameData) {
        existingPlayer.gameData = player.gameData;
      }
    }

    // Always initialize player data if missing (handles both new joins and reconnections)
    if (!resolvedPlayer.gameData) {
      resolvedPlayer.gameData = createInitialPlayerData();
    }

    const playerData = resolvedPlayer.gameData as ThinkAlikePlayerData;

    // Handle reconnection: reuse existing player slot, refresh socket mapping, and sync state
    if (shouldTreatAsReconnect) {
      const oldSocketId = (player as any).oldSocketId || (socketChanged ? existingPlayer?.socketId : undefined);

      resolvedPlayer.connected = true;
      resolvedPlayer.disconnectedAt = undefined;
      resolvedPlayer.socketId = player.socketId;
      resolvedPlayer.lastActivity = Date.now();

      // Resume timer if appropriate (same logic as prior reconnection block)
      const gameState = room.gameState.data as ThinkAlikeGameState;
      const timerKey = `${room.code}:round-timer`;
      const allActivePlayers = Array.from(room.players.values())
        .filter(p => !(p.gameData as ThinkAlikePlayerData)?.isSpectator);
      const allConnected = allActivePlayers.every(p => p.connected);

      if (gameState.phase === 'word_input'
          && gameState.timeRemaining > 0
          && !this.intervals.has(timerKey)
          && allConnected) {
        console.log(`[${this.name}] Resuming timer after reconnection (${gameState.timeRemaining}s remaining)`);
        this.startRoundTimer(room);
      }

      // Sync state to everyone and to the reconnecting client
      this.broadcastRoomState(room);
      if (namespace) {
        namespace.to(resolvedPlayer.socketId).emit('room:updated', {
          room: this.serializeRoom(room, resolvedPlayer.socketId)
        });
      }

      console.log(
        `[${this.name}] Reconnection handled for ${resolvedPlayer.name} in ${room.code}` +
        (oldSocketId ? ` (oldSocketId: ${oldSocketId} -> ${resolvedPlayer.socketId})` : '')
      );
      console.log(
        `[${this.name}] Reconnect state snapshot ${room.code}: players=${Array.from(room.players.values()).map(p => `${p.name}:${p.socketId}:${p.connected}`)} phase=${(room.gameState.data as ThinkAlikeGameState).phase}`
      );
      return;
    }

    // Auto-assign spectator role: first 2 players are active, 3+ are spectators
    if (!isReconnecting) {
      const activePlayers = Array.from(room.players.values())
        .filter(p => !(p.gameData as ThinkAlikePlayerData)?.isSpectator)
        .filter(p => p.socketId !== resolvedPlayer.socketId); // Don't count the player joining

      if (activePlayers.length >= 2) {
        // This is the 3rd+ player, make them a spectator
        playerData.isSpectator = true;
        console.log(`[${this.name}] Player ${resolvedPlayer.name} joined as SPECTATOR`);
      } else {
        // This is the 1st or 2nd player, they're active
        playerData.isSpectator = false;
      }
    }

    // Resume timer if reconnecting during active game phase
    if (isReconnecting) {
      const gameState = room.gameState.data as ThinkAlikeGameState;
      const timerKey = `${room.code}:round-timer`;

      // Check if all active players are connected again
      const allActivePlayers = Array.from(room.players.values())
        .filter(p => !(p.gameData as ThinkAlikePlayerData)?.isSpectator);
      const allConnected = allActivePlayers.every(p => p.connected);

      // Resume timer only if:
      // 1. Game is in word_input phase
      // 2. Time remaining > 0
      // 3. Timer is not already running
      // 4. All active players are connected
      if (gameState.phase === 'word_input'
          && gameState.timeRemaining > 0
          && !this.intervals.has(timerKey)
          && allConnected) {
        console.log(`[${this.name}] Resuming timer after reconnection (${gameState.timeRemaining}s remaining)`);
        this.startRoundTimer(room);
      }
    }

    // Reinitialize teams if in pairs mode lobby (new player needs a team)
    const gameState = room.gameState.data as ThinkAlikeGameState;
    if (!isReconnecting && gameState.gameMode === 'pairs' && gameState.phase === 'lobby') {
      this.initializeTeamsForPairsMode(room);
      console.log(`[${this.name}] Reinitialized teams after player join in pairs mode`);
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

    // Clean up typing rate limit entry for this player
    const playerKey = `${room.code}:${player.id}`;
    this.lastTypingUpdate.delete(playerKey);

    const gameState = room.gameState.data as ThinkAlikeGameState;

    // Check if game should end (need exactly 2 ACTIVE players, not counting spectators)
    const connectedActivePlayers = Array.from(room.players.values())
      .filter(p => p.connected && !(p.gameData as ThinkAlikePlayerData)?.isSpectator);
    if (gameState.phase !== 'lobby' && connectedActivePlayers.length < 2) {
      this.endGame(room, 'Player left the game');
    }

    // Reinitialize teams if in pairs mode lobby (player left, need to rebalance)
    if (gameState.gameMode === 'pairs' && gameState.phase === 'lobby') {
      this.initializeTeamsForPairsMode(room);
      console.log(`[${this.name}] Reinitialized teams after player left in pairs mode`);
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
      players: activePlayers.map((p) => {
        const playerData = p.gameData as ThinkAlikePlayerData;

        // Determine which player slot by name (not array index) for stable reconnection
        const isPlayer1 = p.name === gameState.player1Name;

        // Determine which word to show
        let currentWord = null;
        if (isSpectator) {
          // Spectators see LIVE words (real-time typing)
          currentWord = isPlayer1 ? gameState.player1LiveWord : gameState.player2LiveWord;
        } else if (p.socketId === socketId) {
          // Players see their own word
          currentWord = isPlayer1 ? gameState.player1Word : gameState.player2Word;
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
          hasSubmitted: isPlayer1 ? gameState.player1Submitted : gameState.player2Submitted,
          premiumTier: p.premiumTier,
          avatarUrl: p.avatarUrl
        };
      }),

      // Spectators array (3rd+ players)
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
        livesRemaining: gameState.livesRemaining,
        maxLives: gameState.maxLives,
        timeRemaining: gameState.timeRemaining,
        rounds: gameState.rounds,
        // Pairs mode data
        gameMode: gameState.gameMode,
        teams: gameState.gameMode === 'pairs' ? this.serializeTeams(gameState, socketId, isSpectator) : [],
        winningTeamId: gameState.winningTeamId,
        pointsToWin: gameState.pointsToWin,
        settings: {
          timerDuration: gameState.settings.timerDuration,
          maxLives: gameState.settings.maxLives,
          gameMode: gameState.settings.gameMode,
          pointsToWin: gameState.settings.pointsToWin
        }
      },

      // Settings
      settings: {
        minPlayers: room.settings.minPlayers,
        maxPlayers: room.settings.maxPlayers,
        timerDuration: gameState.settings.timerDuration,
        maxLives: gameState.settings.maxLives,
        voiceMode: gameState.settings.voiceMode,
        gameMode: gameState.settings.gameMode,
        pointsToWin: gameState.settings.pointsToWin
      },

      // Messages (most recent)
      messages: room.messages.slice(-MAX_STORED_MESSAGES),

      // CRITICAL: Client needs to identify themselves
      mySocketId: socketId,

      // Spectator flag (am I a spectator?)
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

        const gameState = room.gameState.data as ThinkAlikeGameState;
        const activePlayers = Array.from(room.players.values())
          .filter(p => p.connected && !(p.gameData as ThinkAlikePlayerData)?.isSpectator);

        // Validate player count based on game mode
        if (gameState.gameMode === 'pairs') {
          // Pairs mode requires at least 4 players (2 teams of 2)
          if (activePlayers.length < MIN_PLAYERS_PAIRS_MODE) {
            socket.emit('error', { message: `Need at least ${MIN_PLAYERS_PAIRS_MODE} players for pairs mode` });
            return;
          }
          // Must be even number of players
          if (activePlayers.length % 2 !== 0) {
            socket.emit('error', { message: 'Need even number of players for pairs mode' });
            return;
          }
        } else {
          // Classic mode requires exactly 2 players
          if (activePlayers.length !== 2) {
            socket.emit('error', { message: 'Need exactly 2 active players to start' });
            return;
          }
        }

        // Initialize first round
        gameState.phase = 'round_prep';
        gameState.currentRound = 1;
        gameState.winningTeamId = null;

        if (gameState.gameMode === 'pairs') {
          // PAIRS MODE: Initialize teams
          this.initializeTeamsForPairsMode(room);
          resetTeamsForNewRound(gameState.teams);

          console.log(`[${this.name}] Pairs mode started with ${gameState.teams.length} teams`);
        } else {
          // CLASSIC MODE: Set up player slots
          gameState.player1Word = null;
          gameState.player2Word = null;
          gameState.player1Submitted = false;
          gameState.player2Submitted = false;

          // Store player identity for stable mapping across reconnections
          gameState.player1Id = activePlayers[0]?.id || null;
          gameState.player2Id = activePlayers[1]?.id || null;
          gameState.player1Name = activePlayers[0]?.name || null;
          gameState.player2Name = activePlayers[1]?.name || null;
          console.log(`[${this.name}] Classic mode: P1=${gameState.player1Name}, P2=${gameState.player2Name}`);
        }

        // Update phase
        room.gameState.phase = 'round_prep';

        // Notify all players
        helpers.sendToRoom(room.code, 'game:started', {
          message: 'Game starting! Get ready...',
          gameMode: gameState.gameMode
        });

        // Broadcast updated state
        this.broadcastRoomState(room);

        console.log(`[${this.name}] Game started in room ${room.code} (mode: ${gameState.gameMode})`);

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
        }, COUNTDOWN_DURATION_MS);
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
        // Normalize: trim, uppercase, strip punctuation (keep letters, numbers, spaces)
        const word = data.word.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '');
        if (!word || word.length === 0) {
          socket.emit('error', { message: 'Word cannot be empty' });
          return;
        }
        if (word.length > 50) {
          socket.emit('error', { message: 'Word too long (max 50 characters)' });
          return;
        }

        if (gameState.gameMode === 'pairs') {
          // PAIRS MODE: Find player's team and store word
          const teamInfo = this.findPlayerTeam(gameState, player.id);
          if (!teamInfo) {
            socket.emit('error', { message: 'You are not assigned to a team' });
            return;
          }

          const { team, isPlayer1 } = teamInfo;
          if (isPlayer1 && team.player1) {
            team.player1.word = word;
            team.player1.submitted = true;
          } else if (team.player2) {
            team.player2.word = word;
            team.player2.submitted = true;
          }

          console.log(`[${this.name}] ${team.name} player ${player.name} submitted word`);

          // Check for match immediately (real-time detection)
          const winningTeam = this.checkForPairsMatch(gameState);
          if (winningTeam) {
            // RACE CONDITION FIX: Clear timer BEFORE handling victory
            this.clearTimer(`${room.code}:round-timer`);
            this.handlePairsVictory(room, winningTeam);
          } else {
            // Check if ALL teams have submitted (no winner found)
            const allTeamsSubmitted = gameState.teams.every(t =>
              t.player1?.submitted && t.player2?.submitted
            );

            if (allTeamsSubmitted) {
              // All teams submitted but no match - handle as timeout (lose a life)
              console.log(`[${this.name}] All teams submitted, no match - treating as timeout`);
              this.clearTimer(`${room.code}:round-timer`);
              this.handlePairsTimeout(room);
            } else {
              // Still waiting for more submissions - broadcast state
              this.broadcastRoomState(room);
            }
          }

        } else {
          // CLASSIC MODE: Original logic
          const isPlayer1 = player.id === gameState.player1Id;

          if (isPlayer1) {
            gameState.player1Word = word;
            gameState.player1Submitted = true;
          } else {
            gameState.player2Word = word;
            gameState.player2Submitted = true;
          }

          console.log(`[${this.name}] Player ${player.name} submitted word in room ${room.code}`);

          // Check if both players have submitted
          if (gameState.player1Submitted && gameState.player2Submitted) {
            // RACE CONDITION FIX: Clear timer BEFORE reveal to prevent timeout race
            this.clearTimer(`${room.code}:round-timer`);
            // Both submitted - move to reveal phase
            this.revealWords(room);
          } else {
            // Waiting for other player - broadcast state
            this.broadcastRoomState(room);
          }
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
          room.gameState.phase = 'round_prep';  // CRITICAL: Must set both for timer check
          gameState.currentRound++;
          gameState.winningTeamId = null;

          if (gameState.gameMode === 'pairs') {
            // PAIRS MODE: Reset all teams for new round
            resetTeamsForNewRound(gameState.teams);
          } else {
            // CLASSIC MODE: Reset player words
            gameState.player1Word = null;
            gameState.player2Word = null;
            gameState.player1Submitted = false;
            gameState.player2Submitted = false;
          }

          // Broadcast state
          this.broadcastRoomState(room);

          console.log(`[${this.name}] Moving to round ${gameState.currentRound} in room ${room.code}`);

          // After 3.5 seconds, start word input (matches client countdown: 3→2→1→GO!)
          const timerKey = `${room.code}:next-round-transition`;
          const timeout = setTimeout(() => {
            // RACE CONDITION CHECK: Ensure phase hasn't changed (e.g. by restart/end game)
            if (room.gameState.phase !== 'round_prep') {
              console.log(`[${this.name}] Timer expired but phase changed to ${room.gameState.phase}, aborting transition`);
              return;
            }

            console.log(`[${this.name}] Round prep countdown complete in next-round, transitioning to word input in room ${room.code}`);
            this.startWordInputPhase(room);
          }, COUNTDOWN_DURATION_MS);
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

        // Validate settings object exists
        if (!data || !data.settings || typeof data.settings !== 'object') {
          socket.emit('error', { message: 'Invalid settings data' });
          return;
        }

        // Validate timerDuration if provided
        if (data.settings.timerDuration !== undefined) {
          if (typeof data.settings.timerDuration !== 'number' ||
              Number.isNaN(data.settings.timerDuration) ||
              data.settings.timerDuration < MIN_TIMER_DURATION_SECONDS ||
              data.settings.timerDuration > MAX_TIMER_DURATION_SECONDS) {
            socket.emit('error', { message: `Timer must be a number between ${MIN_TIMER_DURATION_SECONDS} and ${MAX_TIMER_DURATION_SECONDS} seconds` });
            return;
          }
        }

        // Validate maxLives if provided
        if (data.settings.maxLives !== undefined) {
          if (typeof data.settings.maxLives !== 'number' ||
              Number.isNaN(data.settings.maxLives) ||
              !Number.isInteger(data.settings.maxLives) ||
              data.settings.maxLives < 1 ||
              data.settings.maxLives > 10) {
            socket.emit('error', { message: 'Lives must be an integer between 1 and 10' });
            return;
          }
        }

        // Validate voiceMode if provided
        if (data.settings.voiceMode !== undefined && typeof data.settings.voiceMode !== 'boolean') {
          socket.emit('error', { message: 'Voice mode must be a boolean' });
          return;
        }

        // Validate gameMode if provided
        if (data.settings.gameMode !== undefined) {
          if (data.settings.gameMode !== 'classic' && data.settings.gameMode !== 'pairs') {
            socket.emit('error', { message: 'Game mode must be "classic" or "pairs"' });
            return;
          }
        }

        // Validate pointsToWin if provided
        if (data.settings.pointsToWin !== undefined) {
          if (typeof data.settings.pointsToWin !== 'number' ||
              Number.isNaN(data.settings.pointsToWin) ||
              !Number.isInteger(data.settings.pointsToWin) ||
              data.settings.pointsToWin < 3 ||
              data.settings.pointsToWin > 10) {
            socket.emit('error', { message: 'Points to win must be an integer between 3 and 10' });
            return;
          }
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

        // Update gameMode if setting changed
        if (data.settings.gameMode) {
          gameState.gameMode = data.settings.gameMode;

          // Initialize or clear teams based on mode
          if (data.settings.gameMode === 'pairs') {
            // Initialize teams for pairs mode in lobby
            this.initializeTeamsForPairsMode(room);
            console.log(`[${this.name}] Initialized teams for pairs mode in room ${room.code}`);
          } else {
            // Clear teams for classic mode
            gameState.teams = [];
          }
        }

        // Update pointsToWin if setting changed
        if (data.settings.pointsToWin) {
          gameState.pointsToWin = data.settings.pointsToWin;
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
        // Use ID-based identification for stable reconnection
        const isPlayer1 = player.id === gameState.player1Id;
        if (isPlayer1) {
          gameState.player1Word = data.vote; // Store vote in word field temporarily
          gameState.player1Submitted = true;
        } else {
          gameState.player2Word = data.vote; // Store vote in word field temporarily
          gameState.player2Submitted = true;
        }

        console.log(`[${this.name}] Voice vote from ${player.name}: ${data.vote}`);

        // Notify opponent of the vote (use ID-based matching to avoid targeting spectators)
        const opponentId = isPlayer1 ? gameState.player2Id : gameState.player1Id;
        const opponentPlayer = Array.from(room.players.values()).find(p => p.id === opponentId);
        if (opponentPlayer && this.io) {
          const namespace = this.io.of(this.namespace);
          namespace.to(opponentPlayer.socketId).emit('game:opponent-vote', {
            playerId: player.id,
            playerName: player.name,
            vote: data.vote
          });
        }

        // Start timeout for second vote (prevent infinite wait if player disconnects)
        const voiceVoteTimeoutKey = `${room.code}:voice-vote-timeout`;
        if (!this.timers.has(voiceVoteTimeoutKey)) {
          const timeout = setTimeout(() => {
            const currentGameState = room.gameState.data as ThinkAlikeGameState;
            // Only auto-submit if still waiting for a vote
            if (currentGameState.phase === 'word_input' &&
                (!currentGameState.player1Submitted || !currentGameState.player2Submitted)) {
              console.log(`[${this.name}] Voice vote timeout in room ${room.code}`);

              // Clear round timer to prevent duplicate timer events
              this.clearTimer(`${room.code}:round-timer`);

              // Auto-submit no-match for missing votes
              if (!currentGameState.player1Submitted) {
                currentGameState.player1Word = 'no-match';
                currentGameState.player1Submitted = true;
              }
              if (!currentGameState.player2Submitted) {
                currentGameState.player2Word = 'no-match';
                currentGameState.player2Submitted = true;
              }

              // Process as no-match
              currentGameState.livesRemaining--;
              if (currentGameState.livesRemaining > 0) {
                currentGameState.phase = 'reveal';
                room.gameState.phase = 'reveal';
                this.broadcastRoomState(room);
              } else {
                this.endGame(room, 'all-lives-lost');
              }
            }
            this.timers.delete(voiceVoteTimeoutKey);
          }, VOICE_VOTE_TIMEOUT_MS);
          this.timers.set(voiceVoteTimeoutKey, timeout);
        }

        // Check if both players voted
        if (gameState.player1Submitted && gameState.player2Submitted) {
          // Clear the timeout since both players voted
          this.clearTimer(`${room.code}:voice-vote-timeout`);

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

              // GRANT REWARDS - Victory
              this.grantVictoryRewards(room, gameState, 'VOICE_MODE_MATCH');

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

        // Store this player's revote and mark them as submitted
        // Use ID-based identification for stable reconnection
        const isPlayer1 = player.id === gameState.player1Id;
        if (isPlayer1) {
          gameState.player1Word = data.vote;
          gameState.player1Submitted = true; // Mark this player as submitted
        } else {
          gameState.player2Word = data.vote;
          gameState.player2Submitted = true; // Mark this player as submitted
        }

        console.log(`[${this.name}] Voice mode revote from ${player.name}: ${data.vote}`);

        // Notify opponent of the revote (use ID-based matching to avoid targeting spectators)
        const opponentId = isPlayer1 ? gameState.player2Id : gameState.player1Id;
        const opponentPlayer = Array.from(room.players.values()).find(p => p.id === opponentId);
        if (opponentPlayer && this.io) {
          const namespace = this.io.of(this.namespace);
          namespace.to(opponentPlayer.socketId).emit('game:opponent-vote', {
            playerId: player.id,
            playerName: player.name,
            vote: data.vote
          });
        }

        // Start/restart timeout for dispute revote (prevent infinite wait if player disconnects)
        const disputeTimeoutKey = `${room.code}:voice-dispute-timeout`;
        this.clearTimer(disputeTimeoutKey); // Clear any existing timeout
        const timeout = setTimeout(() => {
          const currentGameState = room.gameState.data as ThinkAlikeGameState;
          // Only auto-submit if still waiting for a vote during word_input phase
          if (currentGameState.phase === 'word_input' &&
              (!currentGameState.player1Submitted || !currentGameState.player2Submitted)) {
            console.log(`[${this.name}] Voice dispute timeout in room ${room.code}`);

            // Clear round timer to prevent duplicate timer events
            this.clearTimer(`${room.code}:round-timer`);

            // Auto-submit no-match for missing votes
            if (!currentGameState.player1Submitted) {
              currentGameState.player1Word = 'no-match';
              currentGameState.player1Submitted = true;
            }
            if (!currentGameState.player2Submitted) {
              currentGameState.player2Word = 'no-match';
              currentGameState.player2Submitted = true;
            }

            // Process as no-match
            currentGameState.livesRemaining--;
            if (currentGameState.livesRemaining > 0) {
              currentGameState.phase = 'reveal';
              room.gameState.phase = 'reveal';
              this.broadcastRoomState(room);
            } else {
              this.endGame(room, 'all-lives-lost');
            }
          }
          this.timers.delete(disputeTimeoutKey);
        }, VOICE_VOTE_TIMEOUT_MS);
        this.timers.set(disputeTimeoutKey, timeout);

        // Check if both players have voted again
        if (gameState.player1Submitted && gameState.player2Submitted) {
          // Clear the timeout since both players voted
          this.clearTimer(`${room.code}:voice-dispute-timeout`);

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

              // GRANT REWARDS - Victory
              this.grantVictoryRewards(room, gameState, 'VOICE_MODE_MATCH');

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
    /**
     * Shuffle teams (host only, pairs mode, lobby only)
     */
    'game:shuffle-teams': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player?.isHost) {
          socket.emit('error', { message: 'Only the host can shuffle teams' });
          return;
        }

        const gameState = room.gameState.data as ThinkAlikeGameState;

        // Only allow in lobby and pairs mode
        if (gameState.phase !== 'lobby') {
          socket.emit('error', { message: 'Can only shuffle teams in lobby' });
          return;
        }

        if (gameState.gameMode !== 'pairs') {
          socket.emit('error', { message: 'Team shuffle only available in pairs mode' });
          return;
        }

        // Shuffle teams
        this.shuffleTeams(room);

        // Broadcast updated state
        this.broadcastRoomState(room);

        console.log(`[${this.name}] Teams shuffled by host in room ${room.code}`);

      } catch (error) {
        console.error(`[${this.name}] Error shuffling teams:`, error);
        socket.emit('error', { message: 'Failed to shuffle teams' });
      }
    },

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

        // Rate limiting: max 10 updates per second per player
        const playerKey = `${room.code}:${player.id}`;
        const now = Date.now();
        const lastUpdate = this.lastTypingUpdate.get(playerKey) || 0;
        if (now - lastUpdate < TYPING_UPDATE_INTERVAL_MS) {
          return; // Too soon, skip this update
        }
        this.lastTypingUpdate.set(playerKey, now);

        if (gameState.gameMode === 'pairs') {
          // PAIRS MODE: Find player's team and update live word
          const teamInfo = this.findPlayerTeam(gameState, player.id);
          if (!teamInfo) return;

          const { team, isPlayer1: isTeamPlayer1 } = teamInfo;
          if (isTeamPlayer1 && team.player1) {
            team.player1.liveWord = data.word;
          } else if (team.player2) {
            team.player2.liveWord = data.word;
          }

          // Broadcast to spectators with team info
          const spectators = Array.from(room.players.values())
            .filter(p => (p.gameData as ThinkAlikePlayerData)?.isSpectator);

          if (this.io && spectators.length > 0) {
            const namespace = this.io.of(this.namespace);
            spectators.forEach(spectator => {
              namespace.to(spectator.socketId).emit('spectator:typing-update', {
                teamId: team.id,
                teamName: team.name,
                isPlayer1: isTeamPlayer1,
                playerName: player.name,
                word: data.word
              });
            });
          }
        } else {
          // CLASSIC MODE: Original logic
          const isPlayer1 = player.id === gameState.player1Id;

          // Update live word in game state
          if (isPlayer1) {
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
                playerIndex: isPlayer1 ? 0 : 1,
                playerName: player.name,
                word: data.word
              });
            });
          }
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
   * Broadcast room state to all players with optimized serialization.
   * Pre-computes common state and only personalizes per-player fields.
   */
  private broadcastRoomState(room: Room): void {
    if (!this.io) return;

    const namespace = this.io.of(this.namespace);
    const gameState = room.gameState.data as ThinkAlikeGameState;
    const allPlayers = Array.from(room.players.values());

    // Pre-compute common data once
    const activePlayers = allPlayers.filter(p => !(p.gameData as ThinkAlikePlayerData)?.isSpectator);
    const spectators = allPlayers.filter(p => (p.gameData as ThinkAlikePlayerData)?.isSpectator);

    // Pre-serialize spectators (same for all viewers)
    const serializedSpectators = spectators.map(s => ({
      socketId: s.socketId,
      name: s.name,
      isHost: s.isHost,
      connected: s.connected,
      isSpectator: true,
      premiumTier: s.premiumTier
    }));

    // Pre-serialize base player info (without currentWord)
    const basePlayerInfo = activePlayers.map(p => {
      const playerData = p.gameData as ThinkAlikePlayerData;
      const isPlayer1 = p.id === gameState.player1Id;
      return {
        socketId: p.socketId,
        name: p.name,
        isHost: p.isHost,
        connected: p.connected,
        disconnectedAt: p.disconnectedAt,
        isReady: playerData?.isReady || false,
        isSpectator: false,
        hasSubmitted: isPlayer1 ? gameState.player1Submitted : gameState.player2Submitted,
        premiumTier: p.premiumTier,
        // Store for word lookup
        _isPlayer1: isPlayer1
      };
    });

    // Pre-compute common state once
    const baseState = {
      code: room.code,
      hostId: room.hostId,
      spectators: serializedSpectators,
      state: this.mapPhaseToClientState(gameState.phase),
      gameData: {
        currentRound: gameState.currentRound,
        maxRounds: gameState.maxRounds,
        livesRemaining: gameState.livesRemaining,
        maxLives: gameState.maxLives,
        timeRemaining: gameState.timeRemaining,
        rounds: gameState.rounds,
        // Pairs mode data
        gameMode: gameState.gameMode,
        winningTeamId: gameState.winningTeamId,
        pointsToWin: gameState.pointsToWin,
        settings: {
          timerDuration: gameState.settings.timerDuration,
          maxLives: gameState.settings.maxLives,
          gameMode: gameState.settings.gameMode,
          pointsToWin: gameState.settings.pointsToWin
        }
      },
      settings: {
        minPlayers: room.settings.minPlayers,
        maxPlayers: room.settings.maxPlayers,
        timerDuration: gameState.settings.timerDuration,
        maxLives: gameState.settings.maxLives,
        voiceMode: gameState.settings.voiceMode,
        gameMode: gameState.settings.gameMode,
        pointsToWin: gameState.settings.pointsToWin
      },
      messages: room.messages.slice(-MAX_STORED_MESSAGES),
      isStreamerMode: room.isStreamerMode || false,
      hideRoomCode: room.hideRoomCode || false,
      isGameBuddiesRoom: room.isGameBuddiesRoom || false,
      gameBuddiesRoomId: room.gameBuddiesRoomId
    };

    // Send personalized state to each player
    room.players.forEach(player => {
      const isViewerSpectator = (player.gameData as ThinkAlikePlayerData)?.isSpectator || false;

      // Create player-specific players array with appropriate words
      const personalizedPlayers = basePlayerInfo.map(p => {
        let currentWord = null;
        if (isViewerSpectator) {
          // Spectators see LIVE words
          currentWord = p._isPlayer1 ? gameState.player1LiveWord : gameState.player2LiveWord;
        } else if (p.socketId === player.socketId) {
          // Players see their own word
          currentWord = p._isPlayer1 ? gameState.player1Word : gameState.player2Word;
        }

        // Return without internal _isPlayer1 field
        const { _isPlayer1, ...cleanPlayer } = p;
        return { ...cleanPlayer, currentWord };
      });

      // Serialize teams with proper visibility for this viewer
      const personalizedTeams = gameState.gameMode === 'pairs'
        ? this.serializeTeams(gameState, player.socketId, isViewerSpectator)
        : [];

      // Send personalized state
      namespace.to(player.socketId).emit('roomStateUpdated', {
        ...baseState,
        players: personalizedPlayers,
        gameData: {
          ...baseState.gameData,
          teams: personalizedTeams
        },
        mySocketId: player.socketId,
        isSpectator: isViewerSpectator
      });
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

    // Start countdown with try-catch to prevent timer crashes
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

        // Check if time is up
        if (gameState.timeRemaining <= 0) {
          clearInterval(interval);
          this.intervals.delete(timerKey);
          this.onRoundTimeout(room);
        }
      } catch (error) {
        console.error(`[${this.name}] Error in timer callback for room ${room.code}:`, error);
        // Clear interval on error to prevent further issues
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
    // RACE CONDITION GUARD: Prevent double timeout handling
    if (this.timeoutInProgress.has(room.code)) {
      console.log(`[${this.name}] Timeout already in progress for room ${room.code}, skipping`);
      return;
    }
    this.timeoutInProgress.add(room.code);

    try {
      const gameState = room.gameState.data as ThinkAlikeGameState;

      // Skip if not in word_input phase (game may have ended or moved on)
      if (gameState.phase !== 'word_input') {
        console.log(`[${this.name}] Timeout fired but phase is ${gameState.phase}, skipping`);
        return;
      }

      console.log(`[${this.name}] Round timeout in room ${room.code}`);

      if (gameState.gameMode === 'pairs') {
        // PAIRS MODE: Handle timeout
        this.handlePairsTimeout(room);
      } else {
        // CLASSIC MODE: Auto-submit empty words
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
    } finally {
      this.timeoutInProgress.delete(room.code);
    }
  }

  /**
   * Reveal words and check for match
   */
  private revealWords(room: Room): void {
    // RACE CONDITION GUARD: Prevent double reveal
    if (this.revealInProgress.has(room.code)) {
      console.log(`[${this.name}] Reveal already in progress for room ${room.code}, skipping`);
      return;
    }
    this.revealInProgress.add(room.code);

    try {
      const gameState = room.gameState.data as ThinkAlikeGameState;

      // Skip if already in reveal or later phase
      if (gameState.phase !== 'word_input') {
        console.log(`[${this.name}] Reveal called but phase is ${gameState.phase}, skipping`);
        return;
      }

      // Stop timer
      this.clearTimer(`${room.code}:round-timer`);

      // Calculate time taken
      const timeTaken = gameState.timerStartedAt
        ? Math.floor((Date.now() - gameState.timerStartedAt) / 1000)
        : gameState.settings.timerDuration - gameState.timeRemaining;

      // Check if words match (case-insensitive, trimmed)
      // Normalize words for comparison: trim, uppercase, strip punctuation
      const word1 = (gameState.player1Word || '').trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '');
      const word2 = (gameState.player2Word || '').trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '');
      const isMatch = word1.length > 0 && word1 === word2;

      // Log word lengths, not actual words (privacy protection)
      console.log(`[${this.name}] Reveal: ${word1.length} chars vs ${word2.length} chars - Match: ${isMatch}`);

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

        // GRANT REWARDS - Victory
        this.grantVictoryRewards(room, gameState, word1);

        console.log(`[${this.name}] VICTORY in room ${room.code}! Word length: ${word1.length}`);

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
    } finally {
      // Always clear the guard when done
      this.revealInProgress.delete(room.code);
    }
  }

  /**
   * End the game
   */
  private endGame(room: Room, reason: 'all-lives-lost' | 'player-left' | string): void {
    // Grant rewards for completed game (Loss)
    if (reason === 'all-lives-lost') {
      const durationSeconds = Math.floor((Date.now() - room.createdAt) / 1000);
      const activePlayers = Array.from(room.players.values())
        .filter(p => !(p.gameData as ThinkAlikePlayerData)?.isSpectator && p.userId);

      console.log(`[${this.name}] 🎁 Attempting to grant DEFEAT rewards. Room: ${room.code}, Active players with userId: ${activePlayers.length}`);

      activePlayers.forEach(async player => {
        console.log(`[${this.name}] 👤 Processing loss reward for ${player.name} (ID: ${player.userId}, Socket: ${player.socketId})`);
        if (player.userId) {
          try {
            const reward = await gameBuddiesService.grantReward(this.id, player.userId, {
              won: false,
              durationSeconds,
              score: (room.gameState.data as ThinkAlikeGameState).currentRound * 2, // Reduced score for loss
              metadata: {
                reason: 'all-lives-lost',
                totalRounds: (room.gameState.data as ThinkAlikeGameState).currentRound
              }
            });

            console.log(`[${this.name}] 🔙 Reward API response for ${player.name}:`, reward ? 'Success' : 'Failed/Null');

            if (reward && this.io) {
              const namespace = this.io.of(this.namespace);
              console.log(`[${this.name}] 📡 Emitting player:reward to socket ${player.socketId}`);
              namespace.to(player.socketId).emit('player:reward', reward);
            } else {
              console.warn(`[${this.name}] ⚠️ Cannot emit reward: Reward is null or io is missing`);
            }
          } catch (err) {
            console.error(`[${this.name}] ❌ Failed to grant loss reward to ${player.name}:`, err);
          }
        } else {
          console.warn(`[${this.name}] ⚠️ Player ${player.name} skipped (no userId)`);
        }
      });
    }

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
   * Grant rewards to winners
   */
  private grantVictoryRewards(room: Room, gameState: ThinkAlikeGameState, matchedWord: string): void {
    const durationSeconds = Math.floor((Date.now() - room.createdAt) / 1000);
    const activePlayers = Array.from(room.players.values())
      .filter(p => !(p.gameData as ThinkAlikePlayerData)?.isSpectator && p.userId);

    console.log(`[${this.name}] 🎁 Attempting to grant VICTORY rewards. Room: ${room.code}, Active players with userId: ${activePlayers.length}`);

    activePlayers.forEach(async player => {
      console.log(`[${this.name}] 👤 Processing reward for ${player.name} (ID: ${player.userId}, Socket: ${player.socketId})`);
      if (player.userId) {
        try {
          const reward = await gameBuddiesService.grantReward(this.id, player.userId, {
            won: true,
            durationSeconds,
            score: 30 + (gameState.livesRemaining * 2), // Base 30 + 2 per life (Max 40)
            metadata: {
              totalRounds: gameState.currentRound,
              livesRemaining: gameState.livesRemaining,
              matchedWord: matchedWord
            }
          });

          console.log(`[${this.name}] 🔙 Reward API response for ${player.name}:`, reward ? 'Success' : 'Failed/Null');

          if (reward && this.io) {
            const namespace = this.io.of(this.namespace);
            console.log(`[${this.name}] 📡 Emitting player:reward to socket ${player.socketId}`);
            namespace.to(player.socketId).emit('player:reward', reward);
          } else {
            console.warn(`[${this.name}] ⚠️ Cannot emit reward: Reward is null or io is missing`);
          }
        } catch (err) {
          console.error(`[${this.name}] ❌ Failed to grant reward to ${player.name}:`, err);
        }
      } else {
        console.warn(`[${this.name}] ⚠️ Player ${player.name} skipped (no userId)`);
      }
    });
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

    // Clear typing rate limit entries for this room
    this.lastTypingUpdate.forEach((_, key) => {
      if (key.startsWith(roomCode)) {
        this.lastTypingUpdate.delete(key);
      }
    });

    // Clear race condition guards for this room
    this.revealInProgress.delete(roomCode);
    this.timeoutInProgress.delete(roomCode);
  }

  // ============================================================================
  // PAIRS MODE HELPER METHODS
  // ============================================================================

  /**
   * Initialize teams for pairs mode based on player count
   * Creates teams and assigns players to them
   */
  private initializeTeamsForPairsMode(room: Room): void {
    const gameState = room.gameState.data as ThinkAlikeGameState;
    const activePlayers = Array.from(room.players.values())
      .filter(p => !(p.gameData as ThinkAlikePlayerData)?.isSpectator);

    // Calculate number of teams needed (1 team per 2 players)
    const numTeams = Math.floor(activePlayers.length / 2);

    // Create teams
    gameState.teams = [];
    for (let i = 0; i < numTeams; i++) {
      gameState.teams.push(createTeam(i));
    }

    // Assign players to teams
    for (let i = 0; i < activePlayers.length && i < numTeams * 2; i++) {
      const teamIndex = Math.floor(i / 2);
      const isPlayer1 = i % 2 === 0;
      const player = activePlayers[i];

      if (isPlayer1) {
        gameState.teams[teamIndex].player1 = createTeamPlayer(player.id, player.name);
      } else {
        gameState.teams[teamIndex].player2 = createTeamPlayer(player.id, player.name);
      }
    }

    console.log(`[${this.name}] Initialized ${numTeams} teams for pairs mode`);
  }

  /**
   * Find which team a player belongs to
   */
  private findPlayerTeam(gameState: ThinkAlikeGameState, playerId: string): { team: Team; isPlayer1: boolean } | null {
    for (const team of gameState.teams) {
      if (team.player1?.id === playerId) {
        return { team, isPlayer1: true };
      }
      if (team.player2?.id === playerId) {
        return { team, isPlayer1: false };
      }
    }
    return null;
  }

  /**
   * Check if any team has matched in pairs mode (real-time detection)
   * Returns the winning team or null
   */
  private checkForPairsMatch(gameState: ThinkAlikeGameState): Team | null {
    for (const team of gameState.teams) {
      if (team.player1?.submitted && team.player2?.submitted) {
        const word1 = (team.player1.word || '').trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '');
        const word2 = (team.player2.word || '').trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '');

        if (word1.length > 0 && word1 === word2) {
          team.matched = true;
          return team; // First team to match wins!
        }
      }
    }
    return null;
  }

  /**
   * Handle pairs mode victory
   */
  private handlePairsVictory(room: Room, winningTeam: Team): void {
    const gameState = room.gameState.data as ThinkAlikeGameState;

    // Award point to winning team
    winningTeam.score++;
    gameState.winningTeamId = winningTeam.id;

    // Calculate time taken
    const timeTaken = gameState.timerStartedAt
      ? Math.floor((Date.now() - gameState.timerStartedAt) / 1000)
      : gameState.settings.timerDuration - gameState.timeRemaining;

    // Check if team has won the game
    if (winningTeam.score >= gameState.pointsToWin) {
      // GAME VICTORY!
      gameState.phase = 'victory';
      room.gameState.phase = 'victory';

      // Add to round history
      gameState.rounds.push({
        number: gameState.currentRound,
        player1Word: winningTeam.player1?.word || '',
        player2Word: winningTeam.player2?.word || '',
        wasMatch: true,
        timeTaken,
        timestamp: Date.now()
      });

      // Broadcast final state
      this.broadcastRoomState(room);

      // Notify all players
      if (this.io) {
        const namespace = this.io.of(this.namespace);
        namespace.to(room.code).emit('game:victory', {
          winningTeamId: winningTeam.id,
          winningTeamName: winningTeam.name,
          matchedWord: winningTeam.player1?.word,
          round: gameState.currentRound,
          timeTaken
        });
      }

      // Grant rewards to winning team members
      this.grantPairsVictoryRewards(room, gameState, winningTeam);

      console.log(`[${this.name}] PAIRS VICTORY! ${winningTeam.name} wins in room ${room.code}!`);
    } else {
      // Round win - move to reveal phase
      gameState.phase = 'reveal';
      room.gameState.phase = 'reveal';

      // Add to round history
      gameState.rounds.push({
        number: gameState.currentRound,
        player1Word: winningTeam.player1?.word || '',
        player2Word: winningTeam.player2?.word || '',
        wasMatch: true,
        timeTaken,
        timestamp: Date.now()
      });

      // Broadcast state
      this.broadcastRoomState(room);

      // Notify players
      if (this.io) {
        const namespace = this.io.of(this.namespace);
        namespace.to(room.code).emit('game:round-win', {
          winningTeamId: winningTeam.id,
          winningTeamName: winningTeam.name,
          matchedWord: winningTeam.player1?.word,
          teamScores: gameState.teams.map(t => ({ id: t.id, name: t.name, score: t.score })),
          pointsToWin: gameState.pointsToWin
        });
      }

      console.log(`[${this.name}] Round win: ${winningTeam.name} (${winningTeam.score}/${gameState.pointsToWin} points)`);
    }
  }

  /**
   * Handle pairs mode timeout (no team matched)
   */
  private handlePairsTimeout(room: Room): void {
    const gameState = room.gameState.data as ThinkAlikeGameState;

    // Lose a life
    gameState.livesRemaining--;

    // Calculate time taken
    const timeTaken = gameState.settings.timerDuration;

    // Add to history (no winner)
    gameState.rounds.push({
      number: gameState.currentRound,
      player1Word: 'TIMEOUT',
      player2Word: 'TIMEOUT',
      wasMatch: false,
      timeTaken,
      timestamp: Date.now()
    });

    if (gameState.livesRemaining <= 0) {
      // Game over - all lives lost
      this.endGame(room, 'all-lives-lost');
    } else {
      // Move to reveal
      gameState.phase = 'reveal';
      room.gameState.phase = 'reveal';
      gameState.winningTeamId = null;

      // Broadcast state
      this.broadcastRoomState(room);

      // Notify players
      if (this.io) {
        const namespace = this.io.of(this.namespace);
        namespace.to(room.code).emit('game:no-match', {
          teams: gameState.teams.map(t => ({
            id: t.id,
            name: t.name,
            player1Word: t.player1?.word,
            player2Word: t.player2?.word,
            matched: t.matched
          })),
          livesRemaining: gameState.livesRemaining
        });
      }

      console.log(`[${this.name}] Pairs timeout - no match. Lives: ${gameState.livesRemaining}`);
    }
  }

  /**
   * Grant rewards to winning team members in pairs mode
   */
  private grantPairsVictoryRewards(room: Room, gameState: ThinkAlikeGameState, winningTeam: Team): void {
    const durationSeconds = Math.floor((Date.now() - room.createdAt) / 1000);

    // Find actual player objects for the winning team
    const winningPlayerIds = [winningTeam.player1?.id, winningTeam.player2?.id].filter(Boolean);
    const winningPlayers = Array.from(room.players.values())
      .filter(p => winningPlayerIds.includes(p.id) && p.userId);

    console.log(`[${this.name}] 🎁 Granting PAIRS VICTORY rewards to ${winningTeam.name}`);

    winningPlayers.forEach(async player => {
      if (player.userId) {
        try {
          const reward = await gameBuddiesService.grantReward(this.id, player.userId, {
            won: true,
            durationSeconds,
            score: 30 + (gameState.livesRemaining * 2) + (winningTeam.score * 5),
            metadata: {
              gameMode: 'pairs',
              teamName: winningTeam.name,
              totalRounds: gameState.currentRound,
              livesRemaining: gameState.livesRemaining,
              teamScore: winningTeam.score
            }
          });

          if (reward && this.io) {
            const namespace = this.io.of(this.namespace);
            namespace.to(player.socketId).emit('player:reward', reward);
          }
        } catch (err) {
          console.error(`[${this.name}] Failed to grant pairs reward to ${player.name}:`, err);
        }
      }
    });
  }

  /**
   * Shuffle teams randomly
   */
  private shuffleTeams(room: Room): void {
    const gameState = room.gameState.data as ThinkAlikeGameState;

    // Collect all players from teams
    const allTeamPlayers: TeamPlayer[] = [];
    for (const team of gameState.teams) {
      if (team.player1) allTeamPlayers.push(team.player1);
      if (team.player2) allTeamPlayers.push(team.player2);
    }

    // Fisher-Yates shuffle
    for (let i = allTeamPlayers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [allTeamPlayers[i], allTeamPlayers[j]] = [allTeamPlayers[j], allTeamPlayers[i]];
    }

    // Reassign to teams
    let playerIndex = 0;
    for (const team of gameState.teams) {
      team.player1 = allTeamPlayers[playerIndex++] || null;
      team.player2 = allTeamPlayers[playerIndex++] || null;
    }

    console.log(`[${this.name}] Teams shuffled in room ${room.code}`);
  }

  /**
   * Serialize teams for client consumption
   * Handles visibility of words based on whether requester is spectator
   */
  private serializeTeams(gameState: ThinkAlikeGameState, socketId: string, isSpectator: boolean): any[] {
    return gameState.teams.map(team => ({
      id: team.id,
      name: team.name,
      color: team.color,
      score: team.score,
      matched: team.matched,
      player1: team.player1 ? {
        id: team.player1.id,
        name: team.player1.name,
        // Spectators see live words, own team sees submitted words
        word: isSpectator ? team.player1.liveWord : (team.player1.submitted ? team.player1.word : null),
        submitted: team.player1.submitted
      } : null,
      player2: team.player2 ? {
        id: team.player2.id,
        name: team.player2.name,
        // Spectators see live words, own team sees submitted words
        word: isSpectator ? team.player2.liveWord : (team.player2.submitted ? team.player2.word : null),
        submitted: team.player2.submitted
      } : null
    }));
  }
}

// ============================================================================
// EXPORT
// ============================================================================

export default new ThinkAlikePlugin();
