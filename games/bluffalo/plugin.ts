/**
 * Bluffalo Game Plugin for GameBuddies Unified Server
 *
 * A Fibbage-style trivia deception game where players create fake answers
 * to fool opponents while trying to identify the real answer.
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
  BluffaloGameState,
  BluffaloPlayerData,
  BluffaloSettings,
  BluffaloPhase,
  VotingOption,
  SubmittedLie,
  ScoreEvent,
  RoundResult,
  DEFAULT_SETTINGS,
  createInitialGameState,
  createInitialPlayerData,
  resetPlayerForNewRound,
  CATEGORY_INFO
} from './types.js';
import {
  playerReadySchema,
  gameStartSchema,
  submitLieSchema,
  voteSchema,
  settingsUpdateSchema
} from './schemas.js';
import { getRandomQuestion, QUESTIONS } from './questions.js';
import {
  QUESTION_DISPLAY_DURATION_MS,
  TIMER_UPDATE_INTERVAL_MS,
  SCORES_DISPLAY_DURATION_SECONDS,
  MIN_PLAYERS,
  MAX_PLAYERS,
  NORMALIZE_STRIP_CHARS
} from './constants.js';

class BluffaloPlugin implements GamePlugin {
  // ============================================================================
  // METADATA
  // ============================================================================

  id = 'bluffalo';
  name = 'Bluffalo';
  version = '1.0.0';
  description = 'A Fibbage-style trivia deception game';
  author = 'GameBuddies';
  namespace = '/bluffalo';
  basePath = '/bluffalo';

  defaultSettings: RoomSettings = {
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    gameSpecific: { ...DEFAULT_SETTINGS } as BluffaloSettings
  };

  // ============================================================================
  // PRIVATE STATE
  // ============================================================================

  private io: any;
  private timers = new Map<string, NodeJS.Timeout>();
  private intervals = new Map<string, NodeJS.Timeout>();

  // ============================================================================
  // LIFECYCLE HOOKS
  // ============================================================================

  async onInitialize(io: any): Promise<void> {
    this.io = io;
    console.log(`[${this.name}] Plugin initialized with ${QUESTIONS.length} questions`);
  }

  onRoomCreate(room: Room): void {
    console.log(`[${this.name}] Room created: ${room.code}`);
    const settings = room.settings.gameSpecific as BluffaloSettings || DEFAULT_SETTINGS;
    room.gameState.data = createInitialGameState(settings);
    room.gameState.phase = 'lobby';

    // Initialize gameData for host
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

  onPlayerDisconnected(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} disconnected`);
    // Player is still in room but marked as disconnected
    // Game continues - they just miss their chance to submit/vote
    this.broadcastRoomState(room);
  }

  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} left permanently`);

    const gameState = room.gameState.data as BluffaloGameState;

    // Check if we're below minimum players during game
    const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
    if (gameState.phase !== 'lobby' && connectedPlayers.length < MIN_PLAYERS) {
      console.log(`[${this.name}] Below minimum players, ending game`);
      this.endGame(room, 'Not enough players');
    }

    this.broadcastRoomState(room);
  }

  onHostLeave(room: Room): void {
    console.log(`[${this.name}] Host left, new host assigned`);
    this.broadcastRoomState(room);
  }

  onRoomDestroy(room: Room): void {
    console.log(`[${this.name}] Room ${room.code} destroyed, cleaning up timers`);
    this.clearRoomTimers(room.code);
  }

  async onCleanup(): Promise<void> {
    console.log(`[${this.name}] Plugin cleanup`);
    // Clear all timers
    this.timers.forEach((timer) => clearTimeout(timer));
    this.intervals.forEach((interval) => clearInterval(interval));
    this.timers.clear();
    this.intervals.clear();
  }

  // ============================================================================
  // SERIALIZATION
  // ============================================================================

  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as BluffaloGameState;

    // Prepare voting options for client (hide author info until reveal)
    const clientVotingOptions = gameState.votingOptions.map(opt => {
      const base = {
        id: opt.id,
        text: opt.text,
        votes: opt.votes
      };

      // Only reveal authorship and correctness during/after reveal phase
      if (gameState.phase === 'reveal' || gameState.phase === 'scores' || gameState.phase === 'game_over') {
        return {
          ...base,
          isCorrect: opt.isCorrect,
          authorId: opt.authorId,
          authorName: opt.authorName
        };
      }

      return base;
    });

    // Get current player's data
    const currentPlayer = Array.from(room.players.values()).find(p => p.socketId === socketId);
    const playerData = currentPlayer?.gameData as BluffaloPlayerData;

    return {
      code: room.code,
      hostId: room.hostId,
      players: Array.from(room.players.values()).map(p => {
        const pd = p.gameData as BluffaloPlayerData;
        return {
          id: p.id,
          socketId: p.socketId,
          name: p.name,
          isHost: p.isHost,
          connected: p.connected,
          isReady: pd?.isReady || false,
          score: pd?.score || 0,
          hasSubmittedLie: pd?.hasSubmittedLie || false,
          hasVoted: pd?.hasVoted || false,
          avatarUrl: p.avatarUrl,
          premiumTier: p.premiumTier,
          // Stats for game over screen
          liesFooledCount: pd?.liesFooledCount || 0,
          correctVotesCount: pd?.correctVotesCount || 0
        };
      }),
      state: gameState.phase,
      settings: {
        minPlayers: room.settings.minPlayers,
        maxPlayers: room.settings.maxPlayers,
        ...gameState.settings
      },
      gameData: {
        currentRound: gameState.currentRound,
        totalRounds: gameState.totalRounds,
        timeRemaining: gameState.timeRemaining,
        currentQuestion: gameState.currentQuestion ? {
          id: gameState.currentQuestion.id,
          category: gameState.currentQuestion.category,
          categoryName: CATEGORY_INFO[gameState.currentQuestion.category]?.name || 'Random',
          categoryIcon: CATEGORY_INFO[gameState.currentQuestion.category]?.icon || '🎲',
          text: gameState.currentQuestion.text
          // Note: correctAnswer is NOT included until reveal
        } : null,
        votingOptions: clientVotingOptions,
        roundResults: gameState.roundResults,
        // Current player's state
        myLie: playerData?.currentLie || null,
        myVote: playerData?.currentVote || null
      },
      mySocketId: socketId,
      isGameBuddiesRoom: room.isGameBuddiesRoom,
      isStreamerMode: room.isStreamerMode,
      hideRoomCode: room.hideRoomCode
    };
  }

  // ============================================================================
  // SOCKET HANDLERS
  // ============================================================================

  socketHandlers: Record<string, SocketEventHandler> = {
    'player:ready': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const validation = playerReadySchema.safeParse(data);
      if (!validation.success) {
        console.error(`[${this.name}] Validation Error (player:ready):`, validation.error);
        return;
      }

      const player = this.findPlayerBySocket(room, socket.id);
      if (!player) return;

      if (!player.gameData) {
        player.gameData = createInitialPlayerData();
      }
      (player.gameData as BluffaloPlayerData).isReady = validation.data.ready;
      this.broadcastRoomState(room);
    },

    'game:start': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const validation = gameStartSchema.safeParse(data);
      if (!validation.success) {
        console.error(`[${this.name}] Validation Error (game:start):`, validation.error);
        return;
      }

      const player = this.findPlayerBySocket(room, socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only host can start the game' });
        return;
      }

      const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
      if (connectedPlayers.length < MIN_PLAYERS) {
        socket.emit('error', { message: `Need at least ${MIN_PLAYERS} players to start` });
        return;
      }

      console.log(`[${this.name}] Game starting in room ${room.code}`);
      this.startGame(room, helpers);
    },

    'game:submit-lie': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const validation = submitLieSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('game:error', { message: validation.error.errors[0]?.message || 'Invalid lie' });
        return;
      }

      const player = this.findPlayerBySocket(room, socket.id);
      if (!player) return;

      const gameState = room.gameState.data as BluffaloGameState;
      const playerData = player.gameData as BluffaloPlayerData;

      // Validate phase
      if (gameState.phase !== 'lie_input') {
        socket.emit('game:error', { message: 'Not accepting lies right now' });
        return;
      }

      // Check if already submitted
      if (playerData.hasSubmittedLie) {
        socket.emit('game:error', { message: 'You already submitted a lie' });
        return;
      }

      const lie = validation.data.lie;

      // Check for duplicates
      const duplicateCheck = this.checkDuplicate(lie, gameState);
      if (duplicateCheck.isDuplicate) {
        socket.emit('game:error', { message: duplicateCheck.reason || 'Duplicate answer' });
        return;
      }

      // Accept the lie
      const normalizedLie = this.normalizeLie(lie);
      gameState.submittedLies.push({
        playerId: player.id,
        playerName: player.name,
        text: lie,
        normalizedText: normalizedLie
      });

      playerData.currentLie = lie;
      playerData.hasSubmittedLie = true;

      console.log(`[${this.name}] ${player.name} submitted lie: "${lie}"`);

      // Check if all players have submitted
      const activePlayers = Array.from(room.players.values()).filter(p => p.connected);
      const allSubmitted = activePlayers.every(p => (p.gameData as BluffaloPlayerData).hasSubmittedLie);

      if (allSubmitted) {
        console.log(`[${this.name}] All players submitted, moving to voting`);
        this.clearTimer(`${room.code}:lie-input`);
        this.startVotingPhase(room, helpers);
      } else {
        this.broadcastRoomState(room);
      }
    },

    'game:vote': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const validation = voteSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('game:error', { message: 'Invalid vote' });
        return;
      }

      const player = this.findPlayerBySocket(room, socket.id);
      if (!player) return;

      const gameState = room.gameState.data as BluffaloGameState;
      const playerData = player.gameData as BluffaloPlayerData;

      // Validate phase
      if (gameState.phase !== 'voting') {
        socket.emit('game:error', { message: 'Not accepting votes right now' });
        return;
      }

      // Check if already voted
      if (playerData.hasVoted) {
        socket.emit('game:error', { message: 'You already voted' });
        return;
      }

      // Find the option
      const option = gameState.votingOptions.find(o => o.id === validation.data.optionId);
      if (!option) {
        socket.emit('game:error', { message: 'Invalid option' });
        return;
      }

      // Don't allow voting for own lie
      if (option.authorId === player.id) {
        socket.emit('game:error', { message: 'Cannot vote for your own lie' });
        return;
      }

      // Record the vote
      option.votes.push(player.id);
      playerData.currentVote = option.id;
      playerData.hasVoted = true;

      console.log(`[${this.name}] ${player.name} voted for option ${option.id}`);

      // Check if all players have voted
      const activePlayers = Array.from(room.players.values()).filter(p => p.connected);
      const allVoted = activePlayers.every(p => (p.gameData as BluffaloPlayerData).hasVoted);

      if (allVoted) {
        console.log(`[${this.name}] All players voted, moving to reveal`);
        this.clearTimer(`${room.code}:voting`);
        this.startRevealPhase(room, helpers);
      } else {
        this.broadcastRoomState(room);
      }
    },

    'game:next-round': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.findPlayerBySocket(room, socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only host can advance' });
        return;
      }

      const gameState = room.gameState.data as BluffaloGameState;
      if (gameState.phase !== 'scores') {
        return;
      }

      this.clearTimer(`${room.code}:scores`);
      this.startNextRound(room, helpers);
    },

    'game:restart': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.findPlayerBySocket(room, socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only host can restart' });
        return;
      }

      console.log(`[${this.name}] Game restarting in room ${room.code}`);
      this.restartGame(room, helpers);
    },

    'settings:update': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      const player = this.findPlayerBySocket(room, socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only host can update settings' });
        return;
      }

      const gameState = room.gameState.data as BluffaloGameState;
      if (gameState.phase !== 'lobby') {
        socket.emit('error', { message: 'Can only change settings in lobby' });
        return;
      }

      const validation = settingsUpdateSchema.safeParse(data);
      if (!validation.success) {
        socket.emit('error', { message: 'Invalid settings' });
        return;
      }

      const newSettings = validation.data.settings;

      // Apply settings
      if (newSettings.totalRounds !== undefined) gameState.settings.totalRounds = newSettings.totalRounds;
      if (newSettings.lieInputTime !== undefined) gameState.settings.lieInputTime = newSettings.lieInputTime;
      if (newSettings.votingTime !== undefined) gameState.settings.votingTime = newSettings.votingTime;
      if (newSettings.category !== undefined) gameState.settings.category = newSettings.category;
      if (newSettings.pointsForCorrect !== undefined) gameState.settings.pointsForCorrect = newSettings.pointsForCorrect;
      if (newSettings.pointsPerFool !== undefined) gameState.settings.pointsPerFool = newSettings.pointsPerFool;

      gameState.totalRounds = gameState.settings.totalRounds;

      console.log(`[${this.name}] Settings updated by ${player.name}`);
      this.broadcastRoomState(room);
    },

    'player:kick': async (socket: Socket, data: { playerId: string }, room: Room, helpers: GameHelpers) => {
      const { playerId } = data;
      const currentPlayer = this.findPlayerBySocket(room, socket.id);

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

      console.log(`[${this.name}] Host ${currentPlayer.name} kicking ${targetPlayer.name}`);

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

  // ============================================================================
  // GAME FLOW METHODS
  // ============================================================================

  private startGame(room: Room, helpers: GameHelpers): void {
    const gameState = room.gameState.data as BluffaloGameState;

    // Reset all player data
    room.players.forEach(player => {
      if (!player.gameData) {
        player.gameData = createInitialPlayerData();
      }
      const pd = player.gameData as BluffaloPlayerData;
      pd.score = 0;
      pd.liesFooledCount = 0;
      pd.correctVotesCount = 0;
      pd.timesDeceivedCount = 0;
      resetPlayerForNewRound(pd);
    });

    // Reset game state
    gameState.currentRound = 0;
    gameState.roundResults = [];
    gameState.usedQuestionIds = [];

    helpers.sendToRoom(room.code, 'game:started', {});
    this.startNextRound(room, helpers);
  }

  private startNextRound(room: Room, helpers: GameHelpers): void {
    const gameState = room.gameState.data as BluffaloGameState;

    // Increment round
    gameState.currentRound++;

    // Check if game should end
    if (gameState.currentRound > gameState.totalRounds) {
      this.endGame(room, 'All rounds complete');
      return;
    }

    console.log(`[${this.name}] Starting round ${gameState.currentRound}/${gameState.totalRounds}`);

    // Reset player data for new round
    room.players.forEach(player => {
      if (player.gameData) {
        resetPlayerForNewRound(player.gameData as BluffaloPlayerData);
      }
    });

    // Clear round data
    gameState.submittedLies = [];
    gameState.votingOptions = [];

    // Get a new question
    const question = getRandomQuestion(gameState.usedQuestionIds, gameState.settings.category);
    if (!question) {
      console.log(`[${this.name}] No more questions available!`);
      this.endGame(room, 'No more questions');
      return;
    }

    gameState.currentQuestion = question;
    gameState.usedQuestionIds.push(question.id);

    // Start question display phase
    gameState.phase = 'question_display';
    room.gameState.phase = 'question_display';
    gameState.timeRemaining = Math.floor(QUESTION_DISPLAY_DURATION_MS / 1000);
    gameState.phaseStartedAt = Date.now();

    helpers.sendToRoom(room.code, 'game:round-started', {
      round: gameState.currentRound,
      totalRounds: gameState.totalRounds
    });

    this.broadcastRoomState(room);

    // After display, move to lie input
    const timerKey = `${room.code}:question-display`;
    const timeout = setTimeout(() => {
      if (gameState.phase === 'question_display') {
        this.startLieInputPhase(room, helpers);
      }
    }, QUESTION_DISPLAY_DURATION_MS);
    this.timers.set(timerKey, timeout);
  }

  private startLieInputPhase(room: Room, helpers: GameHelpers): void {
    const gameState = room.gameState.data as BluffaloGameState;

    gameState.phase = 'lie_input';
    room.gameState.phase = 'lie_input';
    gameState.timeRemaining = gameState.settings.lieInputTime;
    gameState.phaseStartedAt = Date.now();

    helpers.sendToRoom(room.code, 'game:phase-changed', { phase: 'lie_input' });
    this.broadcastRoomState(room);

    // Start timer
    this.startPhaseTimer(room, 'lie-input', gameState.settings.lieInputTime, () => {
      console.log(`[${this.name}] Lie input time expired`);
      this.startVotingPhase(room, helpers);
    });
  }

  private startVotingPhase(room: Room, helpers: GameHelpers): void {
    const gameState = room.gameState.data as BluffaloGameState;

    // Build voting options (shuffle lies + correct answer)
    gameState.votingOptions = this.shuffleAnswers(
      gameState.submittedLies,
      gameState.currentQuestion!.correctAnswer
    );

    gameState.phase = 'voting';
    room.gameState.phase = 'voting';
    gameState.timeRemaining = gameState.settings.votingTime;
    gameState.phaseStartedAt = Date.now();

    helpers.sendToRoom(room.code, 'game:phase-changed', { phase: 'voting' });
    this.broadcastRoomState(room);

    // Start timer
    this.startPhaseTimer(room, 'voting', gameState.settings.votingTime, () => {
      console.log(`[${this.name}] Voting time expired`);
      this.startRevealPhase(room, helpers);
    });
  }

  private startRevealPhase(room: Room, helpers: GameHelpers): void {
    const gameState = room.gameState.data as BluffaloGameState;

    // Calculate scores
    const scoreEvents = this.calculateScores(room);

    // Apply scores to players
    for (const event of scoreEvents) {
      const player = Array.from(room.players.values()).find(p => p.id === event.playerId);
      if (player && player.gameData) {
        (player.gameData as BluffaloPlayerData).score += event.points;
      }
    }

    // Store round result
    const roundResult: RoundResult = {
      roundNumber: gameState.currentRound,
      question: gameState.currentQuestion!,
      correctAnswer: gameState.currentQuestion!.correctAnswer,
      options: gameState.votingOptions,
      scoreEvents
    };
    gameState.roundResults.push(roundResult);

    gameState.phase = 'reveal';
    room.gameState.phase = 'reveal';
    gameState.timeRemaining = gameState.settings.revealTime;
    gameState.phaseStartedAt = Date.now();

    helpers.sendToRoom(room.code, 'game:reveal', {
      correctAnswer: gameState.currentQuestion!.correctAnswer,
      options: gameState.votingOptions,
      scoreEvents
    });

    this.broadcastRoomState(room);

    // After reveal, move to scores
    const timerKey = `${room.code}:reveal`;
    const timeout = setTimeout(() => {
      if (gameState.phase === 'reveal') {
        this.startScoresPhase(room, helpers);
      }
    }, gameState.settings.revealTime * 1000);
    this.timers.set(timerKey, timeout);
  }

  private startScoresPhase(room: Room, helpers: GameHelpers): void {
    const gameState = room.gameState.data as BluffaloGameState;

    gameState.phase = 'scores';
    room.gameState.phase = 'scores';
    gameState.timeRemaining = SCORES_DISPLAY_DURATION_SECONDS;
    gameState.phaseStartedAt = Date.now();

    // Get standings
    const standings = Array.from(room.players.values())
      .map(p => ({
        playerId: p.id,
        playerName: p.name,
        score: (p.gameData as BluffaloPlayerData)?.score || 0
      }))
      .sort((a, b) => b.score - a.score);

    helpers.sendToRoom(room.code, 'game:scores', {
      standings,
      round: gameState.currentRound,
      totalRounds: gameState.totalRounds
    });

    this.broadcastRoomState(room);

    // Auto-advance to next round after timer (host can also manually advance)
    const timerKey = `${room.code}:scores`;
    const timeout = setTimeout(() => {
      if (gameState.phase === 'scores') {
        this.startNextRound(room, helpers);
      }
    }, SCORES_DISPLAY_DURATION_SECONDS * 1000);
    this.timers.set(timerKey, timeout);
  }

  private endGame(room: Room, reason: string): void {
    const gameState = room.gameState.data as BluffaloGameState;

    console.log(`[${this.name}] Game ended: ${reason}`);

    this.clearRoomTimers(room.code);

    gameState.phase = 'game_over';
    room.gameState.phase = 'game_over';

    // Calculate final standings
    const standings = Array.from(room.players.values())
      .map(p => {
        const pd = p.gameData as BluffaloPlayerData;
        return {
          playerId: p.id,
          playerName: p.name,
          score: pd?.score || 0,
          liesFooledCount: pd?.liesFooledCount || 0,
          correctVotesCount: pd?.correctVotesCount || 0
        };
      })
      .sort((a, b) => b.score - a.score);

    const winner = standings[0];

    const namespace = this.io.of(this.namespace);
    namespace.to(room.code).emit('game:ended', {
      reason,
      standings,
      winner
    });

    this.broadcastRoomState(room);

    // TODO: Grant XP rewards to winner
  }

  private restartGame(room: Room, helpers: GameHelpers): void {
    const gameState = room.gameState.data as BluffaloGameState;

    this.clearRoomTimers(room.code);

    // Reset to lobby
    gameState.phase = 'lobby';
    room.gameState.phase = 'lobby';
    gameState.currentRound = 0;
    gameState.currentQuestion = null;
    gameState.submittedLies = [];
    gameState.votingOptions = [];
    gameState.roundResults = [];
    gameState.usedQuestionIds = [];
    gameState.timeRemaining = 0;
    gameState.phaseStartedAt = null;

    // Reset player data
    room.players.forEach(player => {
      player.gameData = createInitialPlayerData();
    });

    helpers.sendToRoom(room.code, 'game:restarted', {});
    this.broadcastRoomState(room);
  }

  // ============================================================================
  // HELPER METHODS
  // ============================================================================

  private findPlayerBySocket(room: Room, socketId: string): Player | undefined {
    return Array.from(room.players.values()).find(p => p.socketId === socketId);
  }

  private broadcastRoomState(room: Room): void {
    if (!this.io) return;
    const namespace = this.io.of(this.namespace);
    room.players.forEach(player => {
      namespace.to(player.socketId).emit('roomStateUpdated', this.serializeRoom(room, player.socketId));
    });
  }

  private normalizeLie(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(NORMALIZE_STRIP_CHARS, '')
      .replace(/\s+/g, ' ');
  }

  private checkDuplicate(lie: string, gameState: BluffaloGameState): { isDuplicate: boolean; reason?: string } {
    const normalized = this.normalizeLie(lie);

    // Check against correct answer
    const correctNormalized = this.normalizeLie(gameState.currentQuestion!.correctAnswer);
    if (normalized === correctNormalized) {
      return { isDuplicate: true, reason: 'Too similar to the correct answer!' };
    }

    // Check similarity to correct answer (fuzzy match)
    if (this.isSimilar(normalized, correctNormalized)) {
      return { isDuplicate: true, reason: 'Too similar to the correct answer!' };
    }

    // Check against other lies
    for (const existingLie of gameState.submittedLies) {
      if (normalized === existingLie.normalizedText) {
        return { isDuplicate: true, reason: 'Someone already submitted that answer!' };
      }
    }

    return { isDuplicate: false };
  }

  private isSimilar(a: string, b: string): boolean {
    // Simple similarity check: if one contains the other
    if (a.includes(b) || b.includes(a)) {
      return true;
    }

    // Levenshtein distance check for very similar strings
    if (a.length > 3 && b.length > 3) {
      const maxLen = Math.max(a.length, b.length);
      const distance = this.levenshteinDistance(a, b);
      const similarity = 1 - (distance / maxLen);
      return similarity > 0.85;
    }

    return false;
  }

  private levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[b.length][a.length];
  }

  private shuffleAnswers(lies: SubmittedLie[], correctAnswer: string): VotingOption[] {
    const options: VotingOption[] = [
      // Correct answer
      {
        id: `correct-${Date.now()}`,
        text: correctAnswer,
        isCorrect: true,
        authorId: null,
        authorName: null,
        votes: []
      },
      // Player lies (filter out empty ones)
      ...lies.filter(lie => lie.text.trim().length > 0).map(lie => ({
        id: `lie-${lie.playerId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        text: lie.text,
        isCorrect: false,
        authorId: lie.playerId,
        authorName: lie.playerName,
        votes: []
      }))
    ];

    // Fisher-Yates shuffle
    for (let i = options.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [options[i], options[j]] = [options[j], options[i]];
    }

    return options;
  }

  private calculateScores(room: Room): ScoreEvent[] {
    const gameState = room.gameState.data as BluffaloGameState;
    const scoreEvents: ScoreEvent[] = [];

    for (const option of gameState.votingOptions) {
      for (const voterId of option.votes) {
        const voter = Array.from(room.players.values()).find(p => p.id === voterId);
        if (!voter) continue;

        const voterData = voter.gameData as BluffaloPlayerData;

        if (option.isCorrect) {
          // Voter found the correct answer
          scoreEvents.push({
            playerId: voterId,
            playerName: voter.name,
            points: gameState.settings.pointsForCorrect,
            reason: 'Found the truth!'
          });
          voterData.correctVotesCount++;
        } else if (option.authorId) {
          // Voter was fooled - award points to lie author
          const author = Array.from(room.players.values()).find(p => p.id === option.authorId);
          if (author) {
            scoreEvents.push({
              playerId: author.id,
              playerName: author.name,
              points: gameState.settings.pointsPerFool,
              reason: `Fooled ${voter.name}!`
            });
            (author.gameData as BluffaloPlayerData).liesFooledCount++;
          }
          voterData.timesDeceivedCount++;
        }
      }
    }

    return scoreEvents;
  }

  // ============================================================================
  // TIMER MANAGEMENT
  // ============================================================================

  private startPhaseTimer(
    room: Room,
    phaseName: string,
    durationSeconds: number,
    onComplete: () => void
  ): void {
    const gameState = room.gameState.data as BluffaloGameState;
    const timerKey = `${room.code}:${phaseName}`;
    const intervalKey = `${room.code}:${phaseName}-interval`;

    // Set up countdown interval
    const interval = setInterval(() => {
      if (gameState.timeRemaining > 0) {
        gameState.timeRemaining--;
        const namespace = this.io.of(this.namespace);
        namespace.to(room.code).emit('timer:update', {
          timeRemaining: gameState.timeRemaining,
          phase: gameState.phase
        });
      }
    }, TIMER_UPDATE_INTERVAL_MS);
    this.intervals.set(intervalKey, interval);

    // Set up completion timeout
    const timeout = setTimeout(() => {
      this.clearTimer(timerKey);
      onComplete();
    }, durationSeconds * 1000);
    this.timers.set(timerKey, timeout);
  }

  private clearTimer(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }

    const intervalKey = `${key}-interval`;
    const interval = this.intervals.get(intervalKey);
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(intervalKey);
    }
  }

  private clearRoomTimers(roomCode: string): void {
    const keysToDelete: string[] = [];

    this.timers.forEach((_, key) => {
      if (key.startsWith(roomCode)) {
        clearTimeout(this.timers.get(key)!);
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.timers.delete(key));

    keysToDelete.length = 0;
    this.intervals.forEach((_, key) => {
      if (key.startsWith(roomCode)) {
        clearInterval(this.intervals.get(key)!);
        keysToDelete.push(key);
      }
    });
    keysToDelete.forEach(key => this.intervals.delete(key));
  }
}

export default new BluffaloPlugin();
