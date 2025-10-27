/**
 * DDF (Dumb/Die/Final) Game Plugin for Unified Server
 *
 * Implements the complete DDF game logic as a plugin for the unified game server.
 * Handles 24 game-specific socket events and manages all game phases.
 */

import { Socket } from 'socket.io';
import { GamePlugin, Room, Player, GameHelpers } from '../../core/types/core.js';
import { DDFGameState, DDFPlayerData } from './types/index.js';
import { serializeRoomToDDF, serializeVotingResults } from './utils/serialization.js';
import { supabaseService } from './services/supabaseService.js';
import GameManager from './game/GameManager.js';
import QuestionManager from './game/QuestionManager.js';

class DDFGamePlugin implements GamePlugin {
  // =========================================================================
  // Plugin Metadata
  // =========================================================================
  id = 'ddf';
  name = 'DDF Quiz Game';
  version = '1.0.0';
  namespace = '/ddf';
  basePath = '/ddf';

  defaultSettings = {
    minPlayers: 2,
    maxPlayers: 20,
    gameSpecific: {
      roundDuration: 120,
      shotClockEnabled: false,
      shotClockDuration: 30,
    },
  };

  // =========================================================================
  // Instance Variables
  // =========================================================================
  private gameManager: any;
  private questionManager: any;
  private io: any;
  private timerIntervals: Map<string, NodeJS.Timeout> = new Map();

  // =========================================================================
  // Constructor & Initialization
  // =========================================================================
  constructor() {
    this.gameManager = new GameManager();
    this.questionManager = new QuestionManager();
  }

  async onInitialize(io: any): Promise<void> {
    this.io = io;
    this.gameManager.setIO(io);

    // Log Supabase availability
    if (supabaseService.isSupabaseAvailable()) {
      console.log('[DDF Plugin] ✅ Supabase integration enabled');
    } else {
      console.log('[DDF Plugin] ℹ️ Using local JSON storage for questions');
    }

    console.log('[DDF Plugin] Initialized');
  }

  onRoomCreate(room: Room): void {
    // Initialize DDF game state
    const gameState: DDFGameState = {
      phase: 'lobby',
      gamemaster: {
        id: room.hostId,
        name: room.hostName, // Use the actual host's name, not 'Gamemaster'
      },
      currentQuestion: null,
      targetPlayerId: null,
      currentPlayerIndex: 0,
      roundAnswers: [],
      previousRoundAnswers: [],
      votes: {},
      votingStatus: {},
      roundNumber: 0,
      showQuestionsToPlayers: false,
      questionIndex: 0,
      isFinale: false,
      finaleState: 'waiting',
      finaleCurrentQuestion: null,
      finaleCurrentAnswers: [],
      finaleScores: {},
      finaleEvaluations: [],
      usedQuestions: [],
      selectedCategories: [],
      timer: {
        isActive: false,
        time: 0,
        duration: room.settings.gameSpecific?.roundDuration || 120,
      },
      roundStarted: false, // Track if round has been started
      shotClock: {
        enabled: room.settings.gameSpecific?.shotClockEnabled || false,
        duration: room.settings.gameSpecific?.shotClockDuration || 30,
      },
      settings: {
        roundDuration: room.settings.gameSpecific?.roundDuration || 120,
        shotClockEnabled: room.settings.gameSpecific?.shotClockEnabled || false,
        shotClockDuration: room.settings.gameSpecific?.shotClockDuration || 30,
      },
    };

    room.gameState.data = gameState;
    console.log(`[DDF] Room ${room.code} created with initial game state`);
  }

  onPlayerJoin(room: Room, player: Player): void {
    // Initialize player game data
    player.gameData = {
      lives: 3,
      isEliminated: false,
      mediaState: {
        isMicOn: false,
        lastUpdated: Date.now(),
      },
    } as DDFPlayerData;
  }

  serializeRoom(room: Room, socketId: string): any {
    return serializeRoomToDDF(room, socketId);
  }

  async onCleanup(): Promise<void> {
    // Clean up all timer intervals
    this.timerIntervals.forEach((interval) => {
      clearInterval(interval);
    });
    this.timerIntervals.clear();
    console.log('[DDF] All timers cleaned up');
  }

  // =========================================================================
  // Socket Event Handlers (24 total)
  // =========================================================================

  socketHandlers = {
    // =====================================================================
    // SETUP (1 handler)
    // =====================================================================

    /**
     * Step 2 of room creation - Setup DDF game with settings
     * Called after core room is created
     */
    'ddf:setup-game': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        console.log(`[DDF] Setting up game for room ${room.code}`);
        const gameState = room.gameState.data as DDFGameState;
        const { settings } = data;

        // Update game settings if provided
        if (settings) {
          if (settings.roundDuration) gameState.settings.roundDuration = settings.roundDuration;
          if (settings.shotClockEnabled !== undefined) gameState.settings.shotClockEnabled = settings.shotClockEnabled;
          if (settings.shotClockDuration) gameState.settings.shotClockDuration = settings.shotClockDuration;
        }

        // Update timer duration
        gameState.timer.duration = gameState.settings.roundDuration;

        // Gamemaster info is already set with correct name in onRoomCreate
        // No need to update it here

        // Emit setup complete
        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-setup', { room: serialized });
        console.log(`[DDF] Game setup complete for room ${room.code}`);
      } catch (error) {
        console.error('[DDF] Error in ddf:setup-game:', error);
        socket.emit('error', { message: 'Failed to setup game' });
      }
    },

    // =====================================================================
    // GAME CONTROL (4 handlers)
    // =====================================================================

    'ddf:start-game': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        console.log(`[DDF] 🎮 START GAME called for room ${room.code}, players: ${room.players.size}`);
        const gameState = room.gameState.data as DDFGameState;
        const { soloMode } = data;

        console.log(`[DDF] 🎮 Solo mode: ${soloMode}, Selected categories: ${JSON.stringify(gameState.selectedCategories)}`);

        // Start game
        gameState.phase = 'playing';
        gameState.roundNumber = 1;

        console.log(`[DDF] ✅ Phase set to 'playing', round: 1`);

        // Get available questions - try Supabase first, fallback to local
        let allQuestions: any[] = [];
        if (supabaseService.isSupabaseAvailable()) {
          console.log('[DDF] Fetching questions from Supabase for game start...');
          allQuestions = await supabaseService.getQuestions();
          console.log(`[DDF] 📚 Loaded ${allQuestions.length} questions from Supabase`);
        } else {
          console.log('[DDF] Fetching questions from local JSON...');
          allQuestions = this.questionManager.getAllQuestions();
          console.log(`[DDF] 📚 Loaded ${allQuestions.length} questions from local file`);
        }

        // Filter by selected categories
        let questions = allQuestions;
        if (gameState.selectedCategories && gameState.selectedCategories.length > 0) {
          questions = allQuestions.filter((q: any) =>
            gameState.selectedCategories.includes(q.category)
          );
          console.log(`[DDF] 📚 Filtered to ${questions.length} questions for categories: ${JSON.stringify(gameState.selectedCategories)}`);
        }

        // If no questions found for selected categories, use all questions
        if (questions.length === 0) {
          console.warn(`[DDF] ⚠️  No questions for selected categories, using ALL questions`);
          questions = allQuestions;
          console.log(`[DDF] 📚 Using all ${questions.length} questions`);
        }

        if (questions.length === 0) {
          console.error(`[DDF] ❌ NO QUESTIONS AVAILABLE!`);
          socket.emit('error', { message: 'No questions available' });
          helpers.sendToRoom(room.code, 'error', { message: 'No questions available in database' });
          return;
        }

        // Assign first question
        const question = questions[Math.floor(Math.random() * questions.length)];
        gameState.currentQuestion = question;
        gameState.usedQuestions.push(question.id);

        console.log(`[DDF] 📝 Assigned question: "${question.question.substring(0, 60)}..."`);

        // Assign to first player (exclude host - host is gamemaster, not a player)
        const activePlayers = Array.from(room.players.values()).filter((p) => !p.isHost && !(p.gameData as DDFPlayerData)?.isEliminated);
        console.log(`[DDF] 👥 Active players: ${activePlayers.length}`);

        if (activePlayers.length > 0) {
          gameState.targetPlayerId = activePlayers[0].id;
          gameState.currentPlayerIndex = 0;
          console.log(`[DDF] 🎯 Target player: ${activePlayers[0].name} (ID: ${activePlayers[0].id})`);
        }

        const serialized = serializeRoomToDDF(room, socket.id);
        console.log(`[DDF] 📦 Serialized room. Game state phase: ${serialized.gameState}`);

        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
        console.log(`[DDF] ✅ Game started in room ${room.code}, emitted game-state-update`);
      } catch (error: any) {
        console.error('[DDF] ❌ ERROR in ddf:start-game:', error);
        console.error('[DDF] ❌ Stack:', error.stack);
        socket.emit('error', { message: 'Failed to start game' });
      }
    },

    'ddf:start-next-turn': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;
        const { questions } = data;

        // Ensure gameState exists
        if (!gameState) {
          console.error('[DDF] Error in ddf:start-next-turn: gameState is undefined');
          socket.emit('error', { message: 'Game state not initialized' });
          return;
        }

        // Ensure usedQuestions array exists
        if (!gameState.usedQuestions) {
          gameState.usedQuestions = [];
        }

        // If questions are provided, assign the next one
        if (questions && Array.isArray(questions)) {
          const availableQuestions = questions.filter(
            (q: any) => !gameState.usedQuestions.includes(q.id),
          );
          if (availableQuestions.length === 0) {
            // No more questions, end game
            gameState.phase = 'finished';
          } else {
            // Assign next question
            const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
            gameState.currentQuestion = question;
            gameState.usedQuestions.push(question.id);

            // Reset player indexes for the new round (exclude host)
            const activePlayers = Array.from(room.players.values()).filter(
              (p) => !p.isHost && !(p.gameData as DDFPlayerData).isEliminated,
            );
            if (activePlayers.length > 0) {
              gameState.currentPlayerIndex = 0;
              gameState.targetPlayerId = activePlayers[0].id;
              console.log(`[DDF] Round ${gameState.roundNumber}: Reset to first player (${activePlayers[0].name})`);
            }
          }
        }
        // If no questions provided, this handler is obsolete (questions assigned in ddf:rate-answer instead)

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:start-next-turn:', error);
        socket.emit('error', { message: 'Failed to progress turn' });
      }
    },

    'ddf:assign-question': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;
        const { playerId, question } = data;

        gameState.targetPlayerId = playerId;
        gameState.currentQuestion = question;

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:assign-question:', error);
        socket.emit('error', { message: 'Failed to assign question' });
      }
    },

    'ddf:start-new-game': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;

        // Reset game state but keep players
        gameState.phase = 'lobby';
        gameState.roundNumber = 0;
        gameState.currentQuestion = null;
        gameState.targetPlayerId = null;
        gameState.roundAnswers = [];
        gameState.votes = {};
        gameState.votingStatus = {};
        gameState.isFinale = false;
        gameState.usedQuestions = [];

        // Reset player data (exclude host - host doesn't have gameData)
        Array.from(room.players.values())
          .filter((p) => !p.isHost) // Exclude host from player data reset
          .forEach((p) => {
            const pd = p.gameData as DDFPlayerData;
            if (pd) {
              pd.lives = 3;
              pd.isEliminated = false;
            }
          });

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:start-new-game:', error);
        socket.emit('error', { message: 'Failed to start new game' });
      }
    },

    // =====================================================================
    // QUESTIONS (5 handlers)
    // =====================================================================

    'ddf:rate-answer': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;
        const { playerId, rating, answerSummary, questions } = data;

        // Record the answer - find player by player.id (not socketId)
        let player: Player | undefined;
        for (const p of room.players.values()) {
          if (p.id === playerId) {
            player = p;
            break;
          }
        }

        if (player && gameState.currentQuestion) {
          gameState.roundAnswers.push({
            playerId,
            playerName: player.name,
            questionText: gameState.currentQuestion.question,
            expectedAnswer: gameState.currentQuestion.answer,
            answerSummary,
            rating,
            timestamp: new Date().toISOString(),
            questionId: gameState.currentQuestion.id,
          });

          // NOTE: Player lives are only lost during voting phase when voted out
          // The rating (correct/incorrect/too-late/no-answer) is only for display in voting UI
          // It determines which players appear as voting targets
        }

        // Clear current question and move to next player (exclude host)
        gameState.currentQuestion = null;
        const activePlayers = Array.from(room.players.values()).filter(
          (p) => !p.isHost && !(p.gameData as DDFPlayerData).isEliminated,
        );
        if (activePlayers.length > 0) {
          gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % activePlayers.length;
          gameState.targetPlayerId = activePlayers[gameState.currentPlayerIndex].id;
        }

        // Automatically assign next question for continuous flow
        if (questions && questions.length > 0) {
          const availableQuestions = questions.filter(
            (q: any) => !gameState.usedQuestions.includes(q.id),
          );
          if (availableQuestions.length > 0) {
            const question = availableQuestions[Math.floor(Math.random() * availableQuestions.length)];
            gameState.currentQuestion = question;
            gameState.usedQuestions.push(question.id);
          } else {
            // No more questions, end game
            gameState.phase = 'finished';
          }
        }

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:rate-answer:', error);
        socket.emit('error', { message: 'Failed to rate answer' });
      }
    },

    'ddf:skip-question': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;

        // Move to next player (exclude host)
        const activePlayers = Array.from(room.players.values()).filter(
          (p) => !p.isHost && !(p.gameData as DDFPlayerData).isEliminated,
        );
        if (activePlayers.length > 0) {
          gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % activePlayers.length;
          gameState.targetPlayerId = activePlayers[gameState.currentPlayerIndex].id;
        }

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:skip-question:', error);
        socket.emit('error', { message: 'Failed to skip question' });
      }
    },

    'ddf:skip-question-keep-player': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;
        // Skip question but keep same player
        gameState.currentQuestion = null;

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:skip-question-keep-player:', error);
        socket.emit('error', { message: 'Failed to skip question' });
      }
    },

    'ddf:mark-question-bad': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const { questionId } = data;
        const result = this.questionManager.markQuestionAsBad(questionId, true);

        // Also mark in Supabase if available
        if (supabaseService.isSupabaseAvailable()) {
          await supabaseService.markQuestionAsBad(questionId);
        }

        if (result) {
          helpers.sendToRoom(room.code, 'ddf:question-marked-bad', {
            questionId,
            badMarkCount: result.badMarkCount,
          });
        }
      } catch (error) {
        console.error('[DDF] Error in ddf:mark-question-bad:', error);
        socket.emit('error', { message: 'Failed to mark question' });
      }
    },

    'ddf:update-categories': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;
        const { categories } = data;

        gameState.selectedCategories = categories || [];

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:update-categories:', error);
        socket.emit('error', { message: 'Failed to update categories' });
      }
    },

    // =====================================================================
    // TIMER (1 handler)
    // =====================================================================

    'ddf:control-timer': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;
        const { action, duration } = data;

        // Clear existing timer
        if (this.timerIntervals.has(room.code)) {
          clearInterval(this.timerIntervals.get(room.code)!);
          this.timerIntervals.delete(room.code);
        }

        switch (action) {
          case 'start':
            gameState.timer.isActive = true;
            gameState.roundStarted = true; // Mark round as started
            // If timer is being resumed (not at 0), keep current time
            // If timer is at 0 or was never started, set it to the provided duration
            if (gameState.timer.time === 0 || gameState.timer.time === gameState.timer.duration) {
              // First start or after reset - set new duration
              gameState.timer.duration = duration || gameState.settings.roundDuration;
              gameState.timer.time = gameState.timer.duration;
            }
            // else: timer is paused mid-countdown, so keep the current time and resume

            // Start countdown
            const interval = setInterval(() => {
              gameState.timer.time--;

              if (gameState.timer.time <= 0) {
                clearInterval(interval);
                this.timerIntervals.delete(room.code);
                gameState.timer.isActive = false;
              }

              // Emit timer update every second
              helpers.sendToRoom(room.code, 'ddf:timer-update', {
                time: gameState.timer.time,
                isActive: gameState.timer.isActive,
              });
            }, 1000);

            this.timerIntervals.set(room.code, interval);
            break;

          case 'pause':
            gameState.timer.isActive = false;
            break;

          case 'reset':
            gameState.timer.isActive = false;
            gameState.roundStarted = false; // Reset round started flag
            gameState.timer.duration = duration || gameState.settings.roundDuration;
            gameState.timer.time = gameState.timer.duration;
            break;

          case 'start-voting':
            console.log(`[DDF] Starting voting phase for room ${room.code}`);
            gameState.phase = 'voting';
            gameState.targetPlayerId = null; // Clear target player
            gameState.currentQuestion = null; // Clear current question

            // Reset voting data for fresh voting phase
            gameState.votes = {}; // Clear old votes
            gameState.votingStatus = {}; // Reset voting status

            // Initialize voting status for all active players (exclude host)
            const activePlayers = Array.from(room.players.values()).filter(p => !p.isHost && !(p.gameData as DDFPlayerData)?.isEliminated);
            activePlayers.forEach(player => {
              if (gameState.votingStatus) {
                gameState.votingStatus[player.id] = {
                  hasVoted: false,
                  votedFor: null,
                  voterName: player.name,
                  votedForName: null,
                };
              }
            });

            console.log(`[DDF] Voting initialized for ${activePlayers.length} players`);
            break;
        }

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:control-timer:', error);
        socket.emit('error', { message: 'Failed to control timer' });
      }
    },

    // =====================================================================
    // VOTING (8 handlers)
    // =====================================================================

    'ddf:submit-vote': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;
        const { votedPlayerId } = data;

        // Get voter (player who is voting)
        const voter = room.players.get(socket.id);
        if (!voter) {
          console.error(`[DDF] Voter not found for socket ${socket.id}`);
          socket.emit('error', { message: 'Voter not found' });
          return;
        }

        // Validate that votedPlayerId is a real player ID
        let votedPlayer: Player | undefined;
        for (const p of room.players.values()) {
          if (p.id === votedPlayerId) {
            votedPlayer = p;
            break;
          }
        }

        if (!votedPlayer) {
          console.error(`[DDF] Voted player not found: ${votedPlayerId}`);
          socket.emit('error', { message: 'Invalid player to vote for' });
          return;
        }

        // Prevent voting for self
        if (voter.id === votedPlayer.id) {
          console.warn(`[DDF] Player ${voter.name} tried to vote for themselves`);
          socket.emit('error', { message: 'Cannot vote for yourself' });
          return;
        }

        // Prevent voting for eliminated players
        if ((votedPlayer.gameData as DDFPlayerData)?.isEliminated) {
          console.warn(`[DDF] Player ${voter.name} tried to vote for eliminated player ${votedPlayer.name}`);
          socket.emit('error', { message: 'Cannot vote for eliminated players' });
          return;
        }

        // Record vote using player.id as key (stable across reconnects)
        gameState.votes[voter.id] = votedPlayerId;

        // Update voting status
        if (gameState.votingStatus) {
          gameState.votingStatus[voter.id] = {
            hasVoted: true,
            votedFor: votedPlayerId,
            voterName: voter.name,
            votedForName: votedPlayer.name,
          };
        }

        console.log(`[DDF] Vote recorded: ${voter.name} voted for ${votedPlayer.name} in room ${room.code}`);

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:submit-vote:', error);
        socket.emit('error', { message: 'Failed to submit vote' });
      }
    },

    'ddf:skip-vote': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;

        // Get voter
        const voter = room.players.get(socket.id);
        if (!voter) {
          console.error(`[DDF] Voter not found for socket ${socket.id}`);
          socket.emit('error', { message: 'Voter not found' });
          return;
        }

        // Mark vote as skipped using player.id as key
        gameState.votes[voter.id] = '__SKIP__';

        if (gameState.votingStatus) {
          gameState.votingStatus[voter.id] = {
            hasVoted: true,
            votedFor: null,
            voterName: voter.name,
            votedForName: null,
          };
        }

        console.log(`[DDF] Vote skipped for ${voter.name} in room ${room.code}`);

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:skip-vote:', error);
        socket.emit('error', { message: 'Failed to skip vote' });
      }
    },

    'ddf:end-voting': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;

        // Process voting results - count votes by votee (who got voted for)
        const playerVoteCounts: Record<string, number> = {};
        Object.values(gameState.votes).forEach((votedForId: any) => {
          if (votedForId && votedForId !== '__SKIP__') {
            playerVoteCounts[votedForId] = (playerVoteCounts[votedForId] || 0) + 1;
          }
        });

        // Find player(s) with most votes
        let mostVotes = 0;
        let selectedPlayerId = '';
        const tiedPlayers: string[] = [];

        Object.entries(playerVoteCounts).forEach(([playerId, count]) => {
          if (count > mostVotes) {
            mostVotes = count;
            selectedPlayerId = playerId;
            tiedPlayers.length = 0;
            tiedPlayers.push(playerId);
          } else if (count === mostVotes && count > 0) {
            tiedPlayers.push(playerId);
          }
        });

        // Build detailed vote breakdown for display
        const voteBreakdown: Record<string, any> = {};

        // For each player, show who voted for them
        Object.entries(playerVoteCounts).forEach(([votedForId, voteCount]) => {
          const votedForPlayer = Array.from(room.players.values()).find(p => p.id === votedForId);
          if (votedForPlayer) {
            // Find who voted for this player
            const voters = Object.entries(gameState.votes)
              .filter(([_, votedId]) => votedId === votedForId)
              .map(([voterId, _]) => {
                const voter = Array.from(room.players.values()).find(p => p.id === voterId);
                return {
                  voterId: voterId,
                  voterName: voter?.name || 'Unknown'
                };
              });

            voteBreakdown[votedForId] = {
              playerName: votedForPlayer.name,
              voteCount: voteCount,
              voters: voters
            };
          }
        });

        // Track eliminated player info
        let eliminatedPlayerId = '';
        let eliminatedPlayerName = '';
        let livesRemaining = 0;

        // If there's a tie, keep the voting phase (require re-vote or GM decision)
        // If there's a clear winner, eliminate that player
        if (selectedPlayerId && tiedPlayers.length === 1) {
          // Find player by their ID and eliminate them
          let eliminatedPlayer: Player | undefined;
          for (const p of room.players.values()) {
            if (p.id === selectedPlayerId) {
              eliminatedPlayer = p;
              break;
            }
          }

          if (eliminatedPlayer) {
            const playerData = eliminatedPlayer.gameData as DDFPlayerData;
            playerData.lives--;
            eliminatedPlayerId = eliminatedPlayer.id;
            eliminatedPlayerName = eliminatedPlayer.name;
            livesRemaining = playerData.lives;
            console.log(`[DDF] Player ${eliminatedPlayer.name} lost a life (now has ${playerData.lives} lives)`);
            if (playerData.lives <= 0) {
              playerData.isEliminated = true;
              console.log(`[DDF] Player ${eliminatedPlayer.name} has been eliminated`);
            }
          }
        } else if (tiedPlayers.length > 1) {
          // Tie - need GM to decide or players to re-vote
          console.log(`[DDF] Voting tie in room ${room.code}: Players ${tiedPlayers.join(', ')} all tied`);
        }

        // ✅ CHECK: If exactly 2 players remain, trigger finale mode (exclude host)
        const activePlayers = Array.from(room.players.values()).filter(
          (p) => !p.isHost && !(p.gameData as DDFPlayerData).isEliminated,
        );

        console.log(`[DDF] 📊 Voting ended - Active players: ${activePlayers.length}`);
        activePlayers.forEach((p, i) => {
          console.log(`[DDF]   Player ${i + 1}: ${p.name}`);
        });

        let finaleStarted = false;
        if (activePlayers.length === 2 && !gameState.isFinale) {
          gameState.isFinale = true;
          gameState.phase = 'finale';
          gameState.finaleState = 'waiting';
          gameState.finaleScores = {};
          gameState.finaleCurrentAnswers = [];
          gameState.finaleEvaluations = [];
          gameState.finaleQuestionIndex = 0;
          gameState.finaleCurrentQuestion = null;
          gameState.finaleQuestions = [];
          gameState.votes = {};
          gameState.votingStatus = {};
          finaleStarted = true;
          console.log(`[DDF] 🏆 FINALE TRIGGERED: Exactly 2 players remain!`);
          console.log(`[DDF]   isFinale: ${gameState.isFinale}`);
          console.log(`[DDF]   phase: ${gameState.phase}`);
          console.log(`[DDF]   finaleState: ${gameState.finaleState}`);
        } else {
          console.log(`[DDF] ℹ️ Not triggering finale - activePlayers: ${activePlayers.length}, isFinale: ${gameState.isFinale}`);
        }

        // Build vote results for display
        const voteResults = {
          voteBreakdown,
          eliminatedPlayerId,
          eliminatedPlayerName,
          livesRemaining,
          isTie: tiedPlayers.length > 1,
          tiedPlayers: tiedPlayers.length > 1
            ? tiedPlayers.map(id => {
                const player = Array.from(room.players.values()).find(p => p.id === id);
                return { id, name: player?.name || 'Unknown' };
              })
            : [],
          finaleStarted
        };

        // Reset votes for next round
        gameState.votes = {};
        gameState.votingStatus = {};
        // NOTE: Keep phase as 'voting' - let GM close the modal to advance
        // gameState.phase will be changed when GM clicks "Continue Game" button

        const serialized = serializeRoomToDDF(room, socket.id);

        // Emit voting results to GM (for results modal display)
        console.log(`[DDF] Emitting voting results to room ${room.code}:`, voteResults);
        helpers.sendToRoom(room.code, 'server:voting-results', voteResults);

        // Game stays in voting phase until GM explicitly closes the modal
        console.log(`[DDF] Voting results emitted. Game stays in voting phase until GM closes modal for room ${room.code}`);
      } catch (error) {
        console.error('[DDF] Error in ddf:end-voting:', error);
        socket.emit('error', { message: 'Failed to end voting' });
      }
    },

    'ddf:skip-voting': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;

        // Mark all non-voted players as skipped (by GM) (exclude host)
        const activePlayers = Array.from(room.players.values()).filter(
          (p) => !p.isHost && !(p.gameData as DDFPlayerData).isEliminated,
        );

        activePlayers.forEach((p) => {
          // Check if player hasn't voted yet (using player.id as key)
          if (!gameState.votes[p.id]) {
            gameState.votes[p.id] = '__SKIP__';
            if (gameState.votingStatus) {
              gameState.votingStatus[p.id] = {
                hasVoted: true,
                votedFor: null,
                voterName: p.name,
                votedForName: null,
                isGMSkipped: true,
              };
            }
          }
        });

        console.log(`[DDF] GM skipped voting for non-responsive players in room ${room.code}`);

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:skip-voting:', error);
        socket.emit('error', { message: 'Failed to skip voting' });
      }
    },

    'ddf:toggle-show-questions': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;
        gameState.showQuestionsToPlayers = !gameState.showQuestionsToPlayers;

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:toggle-show-questions:', error);
        socket.emit('error', { message: 'Failed to toggle questions' });
      }
    },

    'ddf:close-voting-results': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;

        // ✅ Only set phase to 'playing' if NOT in finale mode
        if (!gameState.isFinale) {
          gameState.phase = 'playing';
          console.log(`[DDF] ddf:close-voting-results: Setting phase to 'playing' (not in finale)`);
        } else {
          console.log(`[DDF] ddf:close-voting-results: NOT changing phase - in finale mode (phase stays as ${gameState.phase})`);
        }

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:close-voting-results:', error);
        socket.emit('error', { message: 'Failed to close results' });
      }
    },

    'ddf:close-results-for-all': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;

        console.log(`[DDF] ddf:close-results-for-all called`);
        console.log(`[DDF]   Current phase before: ${gameState.phase}`);
        console.log(`[DDF]   isFinale: ${gameState.isFinale}`);

        // ✅ Check if we're in finale mode
        if (gameState.isFinale) {
          console.log(`[DDF] ✅ In FINALE mode - keeping phase as 'finale', not advancing to 'playing'`);
          console.log(`[DDF]   Phase will stay as: ${gameState.phase}`);
          // Stay in finale mode, don't change phase
        } else {
          // ✅ Increment round number for the next round (only if NOT in finale)
          gameState.roundNumber++;
          console.log(`[DDF] Round ${gameState.roundNumber - 1} complete, advancing to Round ${gameState.roundNumber}`);
          gameState.phase = 'playing';
        }

        console.log(`[DDF]   Phase after: ${gameState.phase}`);

        // ✅ Send updated game state so GM sees "Start Round N" immediately
        const serialized = serializeRoomToDDF(room, socket.id);
        console.log(`[DDF] Sending game state update - phase: ${serialized.gameState}, isFinale: ${serialized.isFinale}`);
        console.log(`[DDF] gameState.phase in game state: ${gameState.phase}`);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });

        helpers.sendToRoom(room.code, 'ddf:close-results-broadcast', {
          action: 'closing',
        });
      } catch (error) {
        console.error('[DDF] Error in ddf:close-results-for-all:', error);
        socket.emit('error', { message: 'Failed to close results' });
      }
    },

    'ddf:break-tie': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;
        const { selectedPlayerId } = data;

        // Eliminate selected player
        const player = room.players.get(selectedPlayerId);
        if (player) {
          const playerData = player.gameData as DDFPlayerData;
          playerData.lives--;
          if (playerData.lives <= 0) {
            playerData.isEliminated = true;
          }
        }

        gameState.isSecondVotingRound = false;
        gameState.tiedPlayerIds = [];

        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:break-tie:', error);
        socket.emit('error', { message: 'Failed to break tie' });
      }
    },

    // =====================================================================
    // FINALE (4 handlers)
    // =====================================================================

    'ddf:submit-finale-answer': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;
        const { questionId, answer } = data;

        // Get the player object to use player ID (not socket ID)
        let player: Player | undefined;
        for (const p of room.players.values()) {
          if (p.socketId === socket.id) {
            player = p;
            break;
          }
        }

        if (!player) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        // Store answer in finaleCurrentAnswers (for real-time display)
        gameState.finaleCurrentAnswers.push({
          playerId: player.id,
          questionId,
          answer,
          timestamp: Date.now(),
        });

        // Also persist to finaleEvaluations (for permanent record)
        // ✅ FIX: Find evaluation by questionId instead of using array index
        let questionData = gameState.finaleEvaluations.find((q: any) => q.questionId === questionId);
        if (!questionData) {
          // ✅ FIX: Find the correct question from finaleQuestions by questionId
          const correctQuestion = gameState.finaleQuestions?.find((q: any) => q.id === questionId);
          questionData = {
            questionId,
            question: correctQuestion, // Store the actual question being answered
            answers: [],
            evaluations: {},
            timestamp: Date.now(),
          };
          gameState.finaleEvaluations.push(questionData);
        }

        // Remove any existing answer from this player for this question
        questionData.answers = questionData.answers.filter((a: any) => a.playerId !== player.id);

        // Add the new answer
        questionData.answers.push({
          playerId: player.id,
          questionId,
          answer,
          timestamp: Date.now(),
        });

        // Calculate actual question number from finaleQuestions array
        const questionNumber = (gameState.finaleQuestions?.findIndex((q: any) => q.id === questionId) ?? -1) + 1;
        console.log(`[DDF] Player ${player.name} answered question ${questionNumber}/10`);

        // Send update to all clients (both players need to know answers are coming in)
        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });

        // Check if both players have answered THIS question (exclude host)
        const activePlayers = Array.from(room.players.values()).filter(
          (p) => !p.isHost && !(p.gameData as DDFPlayerData).isEliminated,
        );

        // Count how many players answered this specific question (by questionId)
        // ✅ FIX: Use questionData instead of array index
        const answersForThisQuestion = questionData.answers.filter(
          (a: any) => a.questionId === questionId
        ).length;

        console.log(
          `[DDF] Question ${questionNumber} answers: ${answersForThisQuestion}/${activePlayers.length} (QuestionID: ${questionId})`
        );

        // When both players have answered this question, trigger evaluation ready
        if (answersForThisQuestion >= activePlayers.length) {
          console.log(`[DDF] ✅ Both players answered question ${questionNumber}/10`);
          helpers.sendToRoom(room.code, 'server:all-finale-answers-ready', {
            allQuestionsComplete: false,  // Explicitly set to false for single question
            questionIndex: questionNumber - 1, // Convert to 0-based index
            questionId,
          });
        }

        // Check if all 10 questions have been answered by both players
        const totalAnswered = gameState.finaleEvaluations.length;
        const totalQuestions = gameState.finaleQuestions?.length || 10;
        console.log(`[DDF] Overall progress: ${totalAnswered}/${totalQuestions} questions answered by both`);

        if (
          totalAnswered >= totalQuestions &&
          gameState.finaleEvaluations[totalQuestions - 1]?.answers.length >= activePlayers.length &&
          gameState.finaleState !== 'evaluating'  // Prevent sending event multiple times
        ) {
          console.log(`[DDF] 🎉 All ${totalQuestions} questions answered by both players!`);
          console.log(`[DDF] Sending server:all-finale-answers-ready event`);
          gameState.finaleState = 'evaluating';
          helpers.sendToRoom(room.code, 'server:all-finale-answers-ready', {
            allQuestionsComplete: true,
            totalAnswered,
            totalQuestions,
            finaleEvaluations: gameState.finaleEvaluations,
          });
          console.log(`[DDF] Event sent!`);
        }
      } catch (error) {
        console.error('[DDF] Error in ddf:submit-finale-answer:', error);
        socket.emit('error', { message: 'Failed to submit finale answer' });
      }
    },

    'ddf:evaluate-single-finale': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;
        const { questionId, questionIndex, evaluations } = data;

        // Determine which question to evaluate - use questionIndex if provided, otherwise find by ID
        let targetQuestionIndex = questionIndex;
        if (targetQuestionIndex === undefined && questionId) {
          targetQuestionIndex = gameState.finaleEvaluations.findIndex(q => q.questionId === questionId);
        }
        if (targetQuestionIndex === undefined) {
          targetQuestionIndex = gameState.finaleEvaluations.length - 1;
        }

        console.log(`[DDF] Evaluating question ${targetQuestionIndex + 1}/10 (questionId: ${questionId})`);
        console.log(`[DDF]   Received evaluations:`, evaluations);

        // Update the evaluation record for this specific question
        if (targetQuestionIndex >= 0 && targetQuestionIndex < gameState.finaleEvaluations.length) {
          const questionData = gameState.finaleEvaluations[targetQuestionIndex];

          // Handle evaluations - can be either an array or a Record<playerId, correct/incorrect>
          if (Array.isArray(evaluations)) {
            // Array format: [{playerId, isCorrect}, ...]
            evaluations.forEach((evaluation: any) => {
              const playerId = evaluation.playerId;
              questionData.evaluations[playerId] = evaluation.isCorrect ? 'correct' : 'incorrect';

              if (evaluation.isCorrect) {
                gameState.finaleScores[playerId] = (gameState.finaleScores[playerId] || 0) + 1;
                console.log(`[DDF] Player ${playerId} correct on Q${targetQuestionIndex + 1}. Score: ${gameState.finaleScores[playerId]}`);
              }
            });
          } else if (typeof evaluations === 'object') {
            // Record format: {playerId: 'correct'|'incorrect', ...}
            Object.entries(evaluations).forEach(([playerId, result]: [string, any]) => {
              const isCorrect = result === 'correct' || result === true;
              questionData.evaluations[playerId] = isCorrect ? 'correct' : 'incorrect';

              if (isCorrect) {
                gameState.finaleScores[playerId] = (gameState.finaleScores[playerId] || 0) + 1;
                console.log(`[DDF] Player ${playerId} correct on Q${targetQuestionIndex + 1}. Score: ${gameState.finaleScores[playerId]}`);
              }
            });
          }

          console.log(`[DDF] Updated question ${targetQuestionIndex + 1} evaluations, scores:`, gameState.finaleScores);

          // ✅ Broadcast real-time evaluation update to all clients (GM and players)
          console.log(`[DDF] Broadcasting evaluation update for questionId: ${questionData.questionId}`);
          helpers.sendToRoom(room.code, 'server:finale-single-evaluation-update', {
            questionId: questionData.questionId,
            evaluations: questionData.evaluations
          });
        }

        // Send the full room update
        const serialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:finale-evaluation', { room: serialized });

        // Check if all questions have been evaluated
        const totalQuestions = gameState.finaleQuestions?.length || 10;
        const allEvaluated = gameState.finaleEvaluations.every(
          (q: any) => Object.keys(q.evaluations || {}).length >= 2
        );

        if (gameState.finaleEvaluations.length >= totalQuestions && allEvaluated) {
          console.log(`[DDF] 🏆 All ${totalQuestions} questions evaluated. Finale complete!`);
          gameState.finaleState = 'complete';
          gameState.phase = 'finished';

          // Determine winner
          let maxScore = 0;
          let winnerId = '';
          let winnerName = '';

          Object.entries(gameState.finaleScores).forEach(([playerId, score]) => {
            if ((score as number) > maxScore) {
              maxScore = score as number;
              winnerId = playerId;
            }
          });

          // Find winner player object
          for (const player of room.players.values()) {
            if (player.id === winnerId) {
              winnerName = player.name;
              break;
            }
          }

          gameState.winner = {
            id: winnerId,
            name: winnerName,
            score: maxScore,
          };

          console.log(`[DDF] 🎉 Winner: ${winnerName} with ${maxScore} correct answers`);

          // Broadcast completion
          helpers.sendToRoom(room.code, 'server:finale-complete', {
            winner: gameState.winner,
            scores: gameState.finaleScores,
          });
        }

        const finalSerialized = serializeRoomToDDF(room, socket.id);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: finalSerialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:evaluate-single-finale:', error);
        socket.emit('error', { message: 'Failed to evaluate finale question' });
      }
    },

    // ✅ REMOVED: ddf:evaluate-all-finale handler
    // Now using real-time evaluation via ddf:evaluate-single-finale
    // Server automatically detects completion and sends server:finale-complete

    'ddf:finale-scroll-sync': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const { scrollTop } = data;

        if (typeof scrollTop !== 'number') {
          console.warn('[DDF] Invalid scrollTop value in ddf:finale-scroll-sync');
          return;
        }

        console.log(`[DDF] 📜 Scroll sync received: scrollTop=${scrollTop} from socket ${socket.id}`);

        // Broadcast scroll position to all other players in the room
        // GM's scroll position is synced to all non-GM players
        helpers.sendToRoom(room.code, 'server:finale-scroll-sync', {
          scrollTop
        });

        console.log(`[DDF] 📜 Broadcasted scroll position to room ${room.code}`);
      } catch (error) {
        console.error('[DDF] Error in ddf:finale-scroll-sync:', error);
        socket.emit('error', { message: 'Failed to sync scroll position' });
      }
    },

    'ddf:next-finale-question': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const gameState = room.gameState.data as DDFGameState;
        console.log(`[DDF] 🎬 ddf:next-finale-question called for room ${room.code}`);
        console.log(`[DDF]   finaleState: ${gameState.finaleState}`);
        console.log(`[DDF]   finaleQuestions length: ${gameState.finaleQuestions?.length || 0}`);
        console.log(`[DDF]   finaleEvaluations length: ${gameState.finaleEvaluations?.length || 0}`);

        // Initialize finale questions on first call (from waiting state)
        if (gameState.finaleState === 'waiting' && (!gameState.finaleQuestions || gameState.finaleQuestions.length === 0)) {
          console.log('[DDF]   ✅ Initializing 10 finale questions...');

          // Get all questions from question manager
          const allQuestions = this.questionManager.getAllQuestions();
          console.log(`[DDF]   Total questions available: ${allQuestions.length}`);

          // Filter by selected categories if any
          let availableQuestions = allQuestions;
          if (gameState.selectedCategories && gameState.selectedCategories.length > 0) {
            console.log(`[DDF]   Filtering by categories: ${gameState.selectedCategories.join(', ')}`);
            availableQuestions = allQuestions.filter((q: any) =>
              gameState.selectedCategories.includes(q.category) ||
              (q.category === '' && gameState.selectedCategories.includes('General'))
            );
            console.log(`[DDF]   Questions after category filter: ${availableQuestions.length}`);
          }

          // Shuffle and take first 10
          const shuffled = availableQuestions.sort(() => Math.random() - 0.5);
          gameState.finaleQuestions = shuffled.slice(0, Math.min(shuffled.length, 10));
          gameState.finaleQuestionIndex = 0;

          console.log(`[DDF]   ✅ Initialized ${gameState.finaleQuestions?.length || 0} finale questions`);
          gameState.finaleQuestions?.forEach((q: any, i: number) => {
            console.log(`[DDF]     Q${i + 1}: ${q.question.substring(0, 60)}...`);
          });
        }

        // Clear previous question's answers
        gameState.finaleCurrentAnswers = [];

        // Get next question based on finaleQuestionIndex (derived from evaluations count)
        const nextQuestionIndex = gameState.finaleEvaluations.length;
        console.log(`[DDF]   nextQuestionIndex: ${nextQuestionIndex}`);

        if (nextQuestionIndex >= (gameState.finaleQuestions?.length || 0)) {
          console.log(`[DDF]   ✅ All finale questions completed (${nextQuestionIndex}/${gameState.finaleQuestions?.length || 0})`);
          gameState.finaleState = 'all-questions-complete';
        } else {
          // Set current question
          gameState.finaleCurrentQuestion = gameState.finaleQuestions?.[nextQuestionIndex] || null;
          gameState.finaleState = 'answering';
          console.log(`[DDF]   ✅ Starting finale question ${nextQuestionIndex + 1}/${gameState.finaleQuestions?.length || 0}`);
          console.log(`[DDF]     Question: ${gameState.finaleCurrentQuestion?.question?.substring(0, 60) || 'null'}...`);
        }

        const serialized = serializeRoomToDDF(room, socket.id);
        console.log(`[DDF]   ✅ Serialized room and sending ddf:game-state-update`);
        console.log(`[DDF]     finaleQuestions in serialized: ${serialized.finaleQuestions?.length || 0}`);
        console.log(`[DDF]     finaleCurrentQuestion in serialized: ${serialized.finaleCurrentQuestion?.question?.substring(0, 40) || 'null'}...`);
        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] ❌ Error in ddf:next-finale-question:', error);
        socket.emit('error', { message: 'Failed to progress finale' });
      }
    },

    // =====================================================================
    // PLAYER MANAGEMENT (1 handler)
    // =====================================================================

    'ddf:edit-lives': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      try {
        const { playerId, lives } = data;
        console.log(`[DDF] Edit lives: room=${room.code}, playerId=${playerId}, newLives=${lives}`);

        // Find player by ID (room.players is keyed by socketId, not playerId)
        let player = null;
        for (const p of room.players.values()) {
          if (p.id === playerId) {
            player = p;
            break;
          }
        }

        if (!player) {
          console.log(`[DDF] ERROR: Player ${playerId} not found`);
          return;
        }

        // Check gameData structure
        if (!player.gameData) {
          console.log(`[DDF] Initializing gameData for player ${playerId}`);
          player.gameData = {
            lives: 3,
            isEliminated: false,
            mediaState: { isMicOn: false, lastUpdated: Date.now() },
          } as DDFPlayerData;
        }

        const playerData = player.gameData as DDFPlayerData;
        const oldLives = playerData.lives || 3;
        playerData.lives = Math.max(0, lives);

        if (playerData.lives === 0) {
          playerData.isEliminated = true;
        }

        console.log(`[DDF] Lives changed: ${oldLives} -> ${playerData.lives}, eliminated=${playerData.isEliminated}`);

        const serialized = serializeRoomToDDF(room, socket.id);
        const updatedPlayer = serialized.players.find((p: any) => p.id === playerId);
        console.log(`[DDF] Broadcasting to ${serialized.players.length} players, ${updatedPlayer?.name}=${updatedPlayer?.lives} lives`);

        helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
      } catch (error) {
        console.error('[DDF] Error in ddf:edit-lives:', error);
        socket.emit('error', { message: 'Failed to edit lives' });
      }
    },
  };

  // =========================================================================
  // HTTP Routes for Question Management
  // =========================================================================

  httpRoutes = [
    {
      method: 'get' as const,
      path: '/api/ddf/questions',
      handler: async (req: any, res: any) => {
        try {
          let questions: any[] = [];

          // Try Supabase first if available
          if (supabaseService.isSupabaseAvailable()) {
            console.log('[DDF] Fetching questions from Supabase...');
            questions = await supabaseService.getQuestions();
          }

          // Fall back to local JSON if Supabase failed or not available
          if (questions.length === 0) {
            console.log('[DDF] Fetching questions from local JSON...');
            questions = this.questionManager.getAllQuestions();
          }

          res.json(questions);
        } catch (error) {
          console.error('[DDF] Error getting questions:', error);
          res.status(500).json({ error: 'Failed to get questions' });
        }
      },
    },
    {
      method: 'post' as const,
      path: '/api/ddf/questions',
      handler: (req: any, res: any) => {
        try {
          const question = this.questionManager.addQuestion(req.body);
          res.json(question);
        } catch (error) {
          res.status(500).json({ error: 'Failed to add question' });
        }
      },
    },
    {
      method: 'put' as const,
      path: '/api/ddf/questions/:id',
      handler: (req: any, res: any) => {
        try {
          const question = this.questionManager.updateQuestion(req.params.id, req.body);
          if (question) {
            res.json(question);
          } else {
            res.status(404).json({ error: 'Question not found' });
          }
        } catch (error) {
          res.status(500).json({ error: 'Failed to update question' });
        }
      },
    },
    {
      method: 'delete' as const,
      path: '/api/ddf/questions/:id',
      handler: (req: any, res: any) => {
        try {
          const deleted = this.questionManager.deleteQuestion(req.params.id);
          if (deleted) {
            res.json({ success: true });
          } else {
            res.status(404).json({ error: 'Question not found' });
          }
        } catch (error) {
          res.status(500).json({ error: 'Failed to delete question' });
        }
      },
    },
    {
      method: 'get' as const,
      path: '/api/ddf/questions/bad/stats',
      handler: (req: any, res: any) => {
        try {
          const stats = this.questionManager.getBadQuestionStats();
          res.json(stats);
        } catch (error) {
          res.status(500).json({ error: 'Failed to get stats' });
        }
      },
    },
    {
      method: 'post' as const,
      path: '/api/ddf/questions/duplicates/find',
      handler: (req: any, res: any) => {
        try {
          const duplicates = this.questionManager.findExactDuplicates();
          res.json({ duplicates });
        } catch (error) {
          res.status(500).json({ error: 'Failed to find duplicates' });
        }
      },
    },
    {
      method: 'post' as const,
      path: '/api/ddf/questions/duplicates/delete',
      handler: (req: any, res: any) => {
        try {
          const result = this.questionManager.deleteExactDuplicates();
          res.json(result);
        } catch (error) {
          res.status(500).json({ error: 'Failed to delete duplicates' });
        }
      },
    },
  ];

  // =========================================================================
  // Lifecycle Hooks
  // =========================================================================

  /**
   * Called immediately when a player disconnects (but before removal)
   * Broadcasts updated game state so all clients see the disconnected status in real-time
   */
  onPlayerDisconnected(room: Room, player: Player): void {
    console.log(`[DDF] Player ${player.name} disconnected from room ${room.code} - broadcasting state update`);

    // Broadcast updated game state to all remaining players
    // This ensures they see the player as disconnected immediately
    const serialized = serializeRoomToDDF(room, ''); // Empty socketId for broadcast

    if (this.io) {
      // Get the /ddf namespace and emit to the room
      const namespace = this.io.of('/ddf');
      namespace.to(room.code).emit('ddf:game-state-update', { room: serialized });
      console.log(`[DDF] Broadcast disconnect status for ${player.name} to room ${room.code}`);
    } else {
      console.error(`[DDF] Cannot broadcast disconnect - io not initialized`);
    }
  }

  /**
   * Called after 30s timeout when disconnected player is actually removed from room
   * No action needed - already handled in onPlayerDisconnected
   */
  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[DDF] Player ${player.name} removed from room ${room.code} after timeout`);

    const gameState = room.gameState.data as DDFGameState;

    // Check if the removed player was the current active player
    if (gameState.targetPlayerId === player.id) {
      console.log(`[DDF] Removed player was the active player, advancing to next player`);

      // Get remaining active players (excluding host, eliminated, and the just-removed player)
      const activePlayers = Array.from(room.players.values()).filter(
        (p) => !p.isHost && !(p.gameData as DDFPlayerData)?.isEliminated
      );

      if (activePlayers.length > 0) {
        // Advance to next player
        const currentIndex = gameState.currentPlayerIndex;
        const nextIndex = currentIndex % activePlayers.length;
        gameState.targetPlayerId = activePlayers[nextIndex].id;
        gameState.currentPlayerIndex = nextIndex;
        console.log(`[DDF] Advanced to next player: ${activePlayers[nextIndex].name} (index ${nextIndex})`);
      } else {
        // No active players left, clear target
        gameState.targetPlayerId = null;
        gameState.currentPlayerIndex = 0;
        console.log(`[DDF] No active players remaining`);
      }
    }

    // Broadcast updated game state to all remaining players
    const serialized = serializeRoomToDDF(room, ""); // Empty socketId for broadcast

    if (this.io) {
      const namespace = this.io.of("/ddf");
      namespace.to(room.code).emit("ddf:game-state-update", { room: serialized });
      console.log(`[DDF] Broadcast player removal for ${player.name} to room ${room.code}`);
    } else {
      console.error(`[DDF] Cannot broadcast player removal - io not initialized`);
    }
  }

  /**
   * Called when the host leaves/disconnects
   * Room will be deleted by core, no action needed here
   */
  onHostLeave(room: Room): void {
    console.log(`[DDF] Host left room ${room.code} - room will be deleted by core`);
  }
}

export default DDFGamePlugin;
