import type { GamePlugin, Room as CoreRoom, Player as CorePlayer, GameHelpers } from '../../core/types/core.js';
import type { Socket } from 'socket.io';
import { GameManager } from './game/GameManager.js';
import { Player, GameMode, GameSettings, Room } from './types/types.js';
import { randomUUID } from 'crypto';

/**
 * SUSD (SUS) Game Plugin
 *
 * A social deduction game where players are assigned words/questions
 * and must figure out who the imposter is.
 *
 * Game Modes:
 * - Classic: Word-based gameplay
 * - Pass & Play: Local multiplayer on one device
 * - Voice Mode: Voice-based gameplay
 * - Questions Mode: Question-based gameplay
 */

class SUSDPlugin implements GamePlugin {
  // Metadata
  id = 'susd';
  name = 'SUS Game';
  version = '1.0.0';
  namespace = '/badactor';
  basePath = '/badactor';

  // Configuration
  defaultSettings = {
    minPlayers: 3,
    maxPlayers: 8,
  };

  // Game manager (handles game-specific logic)
  private gameManager: GameManager;

  // Mapping: CoreRoom.code -> SUSD Room.id (since SUSD uses its own room structure)
  private roomMapping = new Map<string, string>();

  // Socket.IO namespace for emitting events
  private io: any;

  constructor() {
    this.gameManager = new GameManager();
  }

  private collectUniquePlayers(room: Room): Player[] {
    const playersMap = new Map<string, Player>();
    room.players.forEach(player => {
      if (player.socketId) {
        playersMap.set(player.id, player);
      }
    });
    if (room.gamemaster?.socketId) {
      playersMap.set(room.gamemaster.id, room.gamemaster);
    }
    return Array.from(playersMap.values());
  }

  /**
   * ✅ Serialize room for sending to clients
   * Deduplicates players (important during grace period when old socket still exists)
   * This prevents showing duplicate players during reconnection when both old and new sockets are in room.players
   */
  private serializeRoomForClients(room: Room): Room {
    const uniquePlayers = this.collectUniquePlayers(room);
    return {
      ...room,
      players: uniquePlayers
    };
  }

  /**
   * ✅ Serialize CorePlayer to SUSD client-expected Player format
   * Flattens gameData fields to top-level for consistency with SUSD client type definitions
   * This ensures isImposter, isGamemaster, etc. are direct fields, not nested in gameData
   */
  private serializePlayerForClient(corePlayer: CorePlayer): Player {
    const gameData = corePlayer.gameData || {};

    console.log('[SUSD-DEBUG] 🔍 serializePlayerForClient called:', {
      playerId: corePlayer.id,
      playerName: corePlayer.name,
      socketId: corePlayer.socketId,
      hasGameData: !!corePlayer.gameData,
      rawGameData: gameData,
      isImposterRaw: (gameData as any).isImposter,
      isGamemasterRaw: (gameData as any).isGamemaster,
    });

    const serialized = {
      id: corePlayer.id,
      name: corePlayer.name,
      socketId: corePlayer.socketId,
      isGamemaster: (gameData as any).isGamemaster ?? false,
      isImposter: (gameData as any).isImposter ?? false,
      hasSubmittedWord: (gameData as any).hasSubmittedWord ?? false,
      hasVoted: (gameData as any).hasVoted ?? false,
      votedFor: (gameData as any).votedFor,
      isEliminated: (gameData as any).isEliminated ?? false,
      lastSubmittedRound: (gameData as any).lastSubmittedRound ?? 0,
      gameBuddiesPlayerId: (gameData as any).gameBuddiesPlayerId,
      premiumTier: corePlayer.premiumTier,
      avatarUrl: corePlayer.avatarUrl,
    };

    console.log('[SUSD-DEBUG] ✅ Serialized player result:', {
      playerName: serialized.name,
      isImposter: serialized.isImposter,
      isGamemaster: serialized.isGamemaster,
      premiumTier: serialized.premiumTier,
    });

    return serialized;
  }

  private broadcastWordAssignments(room: Room, helpers: GameHelpers) {
    if (!room) return;

    const recipients = this.collectUniquePlayers(room);
    recipients.forEach(player => {
      if (!player.socketId) return;

      const assignment = this.gameManager.getWordForPlayer(room, player.id);
      helpers.sendToPlayer(player.socketId, 'word-assigned', {
        word: assignment ?? null
      });

      if (room.settings.gameType === 'online' && room.currentTurn === player.id) {
        helpers.sendToPlayer(player.socketId, 'turn-started', {
          playerId: player.id,
          word: assignment ?? undefined,
          timeLimit: room.settings.turnTimeLimit
        });
      }
    });
  }

  private broadcastQuestionAssignments(room: Room, helpers: GameHelpers) {
    if (!room || !room.currentQuestion) return;

    const recipients = this.collectUniquePlayers(room);
    recipients.forEach(player => {
      if (!player.socketId) return;

      const payload = this.gameManager.getQuestionAssignmentForPlayer(room, player.id);
      if (!payload) return;

      helpers.sendToPlayer(player.socketId, 'question-assigned', payload);
    });
  }

  /**
   * Initialize plugin
   */
  async onInitialize(io: any) {
    console.log('[SUSD] Initializing SUS Game plugin...');
    this.io = io;
    // GameManager initializes content in its constructor
    console.log('[SUSD] Plugin initialized');
  }

  /**
   * Socket event handlers (game-specific events only)
   * Common events (room:create, room:join, chat:message) are handled by core server
   */
  socketHandlers = {
    /**
     * SUSD-specific room creation (after core room is created)
     * This is called AFTER the core server creates the base room
     */
    'susd:setup-game': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const { gameMode, settings } = data;

        // Get the host player
        const hostPlayer = Array.from(coreRoom.players.values()).find(p => p.isHost);
        if (!hostPlayer) {
          socket.emit('error', { message: 'Host player not found' });
          return;
        }

        // Create SUSD-specific player
        const susdPlayer: Player = {
          id: hostPlayer.id,
          name: hostPlayer.name,
          socketId: hostPlayer.socketId,
          isGamemaster: true,
          isImposter: false,
          hasSubmittedWord: false,
          hasVoted: false,
          isEliminated: false,
          lastSubmittedRound: 0,
          gameBuddiesPlayerId: hostPlayer.id,
        };

        // Create SUSD room using GameManager (async - refreshes content from DB)
        const susdRoom = await this.gameManager.createRoom(susdPlayer, gameMode || 'classic', coreRoom.code);

        // Apply custom settings
        if (settings) {
          Object.assign(susdRoom.settings, settings);
        }

        // Apply language from core room settings
        const roomLanguage = (coreRoom.settings.language as 'en' | 'de') || 'en';
        susdRoom.settings.language = roomLanguage;
        console.log(`[SUSD] 🌐 Room ${coreRoom.code} created with language: ${roomLanguage}`);

        // Store mapping
        this.roomMapping.set(coreRoom.code, susdRoom.id);

        // Store SUSD room data in core room
        coreRoom.gameState.data = { susdRoomId: susdRoom.id };

        // ✅ Update host player's gameData with SUSD player fields
        // This ensures serializeRoom correctly sees the host as gamemaster
        hostPlayer.gameData = {
          isGamemaster: true,
          isImposter: false,
          hasSubmittedWord: false,
          hasVoted: false,
          isEliminated: false,
          lastSubmittedRound: 0,
          gameBuddiesPlayerId: hostPlayer.id,
        };

        console.log('[SUSD-DEBUG] 👑 Host player gameData initialized:', {
          playerId: hostPlayer.id,
          isGamemaster: true
        });

        const serializedRoom = this.serializeRoom(coreRoom, socket.id);
        socket.emit('susd:game-setup', { room: serializedRoom });
        console.log(`[SUSD] Game setup for room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error setting up game:', error);
        socket.emit('error', { message: error.message || 'Failed to setup game' });
      }
    },

    /**
     * Start the game
     */
    'start-game': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) {
          socket.emit('error', { message: 'SUSD room not found' });
          return;
        }

        const susdRoom = this.gameManager.getRoomByCode(coreRoom.code);
        if (!susdRoom) {
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can start the game' });
          return;
        }

        console.log('[SUSD] 🎮 Calling gameManager.startGame for room:', coreRoom.code, 'with susdRoomId:', susdRoomId);
        const result = await this.gameManager.startGame(susdRoomId);

        if (!result.success) {
          console.log('[SUSD] ❌ Failed to start game:', result.error);
          socket.emit('error', { message: result.error || 'Failed to start game' });
          return;
        }

        const updatedRoom = result.room;
        if (!updatedRoom) {
          console.log('[SUSD] ❌ No room returned from startGame');
          socket.emit('error', { message: 'Failed to get updated room' });
          return;
        }

        console.log('[SUSD] 📤 Sending game-started event to room:', coreRoom.code, 'with game phase:', updatedRoom.gamePhase);
        helpers.sendToRoom(coreRoom.code, 'game-started', { room: updatedRoom });
        console.log(`[SUSD] ✅ Game started in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error starting game:', error);
        socket.emit('error', { message: error.message || 'Failed to start game' });
      }
    },

    /**
     * Submit word
     */
    'submit-word': async (socket: Socket, data: { word: string }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const result = this.gameManager.submitWord(socket.id, data.word);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        socket.emit('word-submitted', { success: true });
        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
      } catch (error: any) {
        console.error('[SUSD] Error submitting word:', error);
        socket.emit('error', { message: 'Failed to submit word' });
      }
    },

    /**
     * Submit answer (for questions mode)
     */
    'submit-answer': async (socket: Socket, data: { answer: string }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const result = this.gameManager.submitAnswer(socket.id, data.answer);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        socket.emit('answer-submitted', { success: true });

        // Log answer count for debugging
        if (result.room) {
          const answerCount = result.room.answersThisRound.length;
          const playerCount = result.room.players.length;
          console.log(`[SUSD] Answer submitted: ${answerCount}/${playerCount} answers in room ${coreRoom.code}`);

          // If all answers are in and we've transitioned to voting, emit transition event
          if (result.room.gamePhase === 'voting') {
            console.log(`[SUSD] ✅ All answers submitted, transitioning to voting phase in room ${coreRoom.code}`);
            helpers.sendToRoom(coreRoom.code, 'voting-started', { room: result.room });
          } else {
            helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
          }
        }
      } catch (error: any) {
        console.error('[SUSD] Error submitting answer:', error);
        socket.emit('error', { message: 'Failed to submit answer' });
      }
    },

    /**
     * Submit vote
     */
    'submit-vote': async (socket: Socket, data: { votedForId: string }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const result = this.gameManager.submitVote(socket.id, data.votedForId);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        socket.emit('vote-submitted', { success: true });

        // Check if voting is complete by checking if gamePhase changed to 'reveal'
        // (endRound is called internally by submitVote when all votes are in)
        console.log(`[SUSD] Vote submitted. Room ${coreRoom.code} state:`, {
          gamePhase: result.room?.gamePhase,
          hasCurrentRoundResult: !!result.room?.currentRoundResult,
          passPlayMode: result.room?.settings?.gameType === 'pass-play'
        });

        if (result.room?.gamePhase === 'reveal' && result.room.currentRoundResult) {
          console.log(`[SUSD] ✅ Voting complete in room ${coreRoom.code}, emitting round-ended`);
          helpers.sendToRoom(coreRoom.code, 'round-ended', {
            result: result.room.currentRoundResult
          });
          // Also send room update
          helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
        } else {
          console.log(`[SUSD] ⏳ Voting not complete yet in room ${coreRoom.code}`);
          helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
        }
      } catch (error: any) {
        console.error('[SUSD] Error submitting vote:', error);
        socket.emit('error', { message: 'Failed to submit vote' });
      }
    },

    /**
     * Submit imposter guess
     */
    'submit-imposter-guess': async (socket: Socket, data: { guess: string }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const result = this.gameManager.submitImposterGuess(socket.id, data.guess);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        socket.emit('imposter-guess-result', {
          correct: result.correct,
          guess: data.guess
        });

        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
        console.log(`[SUSD] Imposter guess submitted in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error submitting imposter guess:', error);
        socket.emit('error', { message: 'Failed to submit imposter guess' });
      }
    },

    /**
     * Force start voting (gamemaster only)
     */
    'force-voting': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can force voting' });
          return;
        }

        const result = this.gameManager.forceStartVoting(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        if (result.room) {
          helpers.sendToRoom(coreRoom.code, 'voting-started', { room: result.room, timeLimit: result.room.settings.votingTimeLimit });
        }
      } catch (error: any) {
        console.error('[SUSD] Error forcing voting:', error);
        socket.emit('error', { message: 'Failed to force voting' });
      }
    },

    /**
     * Skip player (gamemaster only)
     */
    'skip-player': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can skip player' });
          return;
        }

        const result = this.gameManager.skipCurrentPlayer(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        helpers.sendToRoom(coreRoom.code, 'player-skipped', { room: result.room });
        // Broadcast room update so client receives new word/question
        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
      } catch (error: any) {
        console.error('[SUSD] Error skipping player:', error);
        socket.emit('error', { message: 'Failed to skip player' });
      }
    },

    /**
     * Skip player in truth mode (gamemaster only)
     */
    'skip-player-truth': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can skip player in truth mode' });
          return;
        }

        const result = this.gameManager.skipCurrentPlayerTruth(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        // Notify all players about the skip
        helpers.sendToRoom(coreRoom.code, 'player-skipped-truth', {
          playerId: result.playerId,
          playerName: result.playerName
        });

        // Update game state
        helpers.sendToRoom(coreRoom.code, 'game-state-updated', { room: result.room });
        // Broadcast room update so client receives new word/question
        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });

        // Handle progression based on the result
        if (result.action === 'next-round') {
          // Start next round
          helpers.sendToRoom(coreRoom.code, 'round-started', {
            roundNumber: result.room!.currentRound,
            room: result.room
          });
        } else if (result.action === 'start-voting') {
          // Start voting phase
          helpers.sendToRoom(coreRoom.code, 'voting-started', {
            timeLimit: result.room!.settings.votingTimeLimit
          });
        }

        console.log(`[SUSD] Player skipped in truth mode in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error skipping player in truth mode:', error);
        socket.emit('error', { message: 'Failed to skip player in truth mode' });
      }
    },

    /**
     * Request skip (any player)
     */
    'skip-request': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const result = this.gameManager.requestSkip(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        // Broadcast skip request to all players (so GM can see the modal)
        helpers.sendToRoom(coreRoom.code, 'skip-requested', { room: result.room });
        console.log(`[SUSD] Skip request submitted in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error requesting skip:', error);
        socket.emit('error', { message: 'Failed to request skip' });
      }
    },

    /**
     * Approve skip request (gamemaster only)
     */
    'approve-skip': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can approve skip' });
          return;
        }

        const existingRoom = this.gameManager.getRoomByCode(coreRoom.code);
        const pendingPhase = existingRoom?.pendingSkipRequest?.gamePhase;

        const result = this.gameManager.approveSkip(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        if (result.room) {
          if (pendingPhase === 'word-round') {
            this.broadcastWordAssignments(result.room, helpers);
          } else if (pendingPhase === 'question-round') {
            this.broadcastQuestionAssignments(result.room, helpers);
          }
        }

        // Broadcast room update to all players
        helpers.sendToRoom(coreRoom.code, 'skip-approved', { room: result.room });
        // Broadcast room state so client receives new word/question
        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
        console.log(`[SUSD] Skip request approved in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error approving skip:', error);
        socket.emit('error', { message: 'Failed to approve skip' });
      }
    },

    /**
     * Decline skip request (gamemaster only)
     */
    'decline-skip': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can decline skip' });
          return;
        }

        const result = this.gameManager.declineSkip(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        // Broadcast room update to all players
        helpers.sendToRoom(coreRoom.code, 'skip-declined', { room: result.room });
        console.log(`[SUSD] Skip request declined in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error declining skip:', error);
        socket.emit('error', { message: 'Failed to decline skip' });
      }
    },

    /**
     * Skip current word - generate new word for all players (gamemaster only)
     */
    'skip-word': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const room = this.gameManager.getRoomBySocketId(socket.id);
        const player = room?.players.find(p => p.socketId === socket.id);
        if (!player) {
          socket.emit('error', { message: 'Player not found in room' });
          return;
        }

        const canSkipWord =
          player.isGamemaster ||
          (room?.settings.gameType === 'pass-play' &&
            room?.skipControls?.wordEligiblePlayerIds.includes(player.id));

        if (!canSkipWord) {
          socket.emit('error', { message: 'Only designated players can skip the word' });
          return;
        }

        const result = this.gameManager.skipWord(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        if (result.room) {
          this.broadcastWordAssignments(result.room, helpers);
        }

        // Broadcast room update to all players
        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
        console.log(`[SUSD] Skip word submitted in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error skipping word:', error);
        socket.emit('error', { message: 'Failed to skip word' });
      }
    },

    /**
     * Skip current question - generate new question for all players (gamemaster only)
     */
    'skip-question': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const room = this.gameManager.getRoomBySocketId(socket.id);
        const player = room?.players.find(p => p.socketId === socket.id);
        if (!player) {
          socket.emit('error', { message: 'Player not found in room' });
          return;
        }

        const canSkipQuestion =
          player.isGamemaster ||
          (room?.settings.gameType === 'pass-play' &&
            room?.skipControls?.questionEligiblePlayerIds.includes(player.id));

        if (!canSkipQuestion) {
          socket.emit('error', { message: 'Only designated players can skip the question' });
          return;
        }

        const result = this.gameManager.skipQuestion(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        if (result.room) {
          this.broadcastQuestionAssignments(result.room, helpers);
        }

        // Broadcast room update to all players
        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
        console.log(`[SUSD] Skip question submitted in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error skipping question:', error);
        socket.emit('error', { message: 'Failed to skip question' });
      }
    },

    /**
     * Force end voting (gamemaster only)
     */
    'end-voting': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can end voting' });
          return;
        }

        const result = this.gameManager.forceEndVoting(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        // Emit round ended with result
        helpers.sendToRoom(coreRoom.code, 'round-ended', {
          result: result.room!.currentRoundResult
        });

        // Update game state
        helpers.sendToRoom(coreRoom.code, 'game-state-updated', { room: result.room });

        console.log(`[SUSD] Voting ended in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error ending voting:', error);
        socket.emit('error', { message: 'Failed to end voting' });
      }
    },

    /**
     * Next player in voice mode (gamemaster only)
     */
    'next-player-voice': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can advance to next player in voice mode' });
          return;
        }

        const result = this.gameManager.nextPlayerVoiceMode(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
        console.log(`[SUSD] Advanced to next player in voice mode in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error advancing to next player in voice mode:', error);
        socket.emit('error', { message: 'Failed to advance to next player in voice mode' });
      }
    },

    /**
     * Force start voting in voice mode (gamemaster only)
     */
    'force-start-voting-voice': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can force start voting in voice mode' });
          return;
        }

        const result = this.gameManager.forceStartVotingVoiceMode(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        if (result.room) {
          helpers.sendToRoom(coreRoom.code, 'voting-started', { room: result.room, timeLimit: result.room.settings.votingTimeLimit });
        }
        console.log(`[SUSD] Force started voting in voice mode in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error force starting voting in voice mode:', error);
        socket.emit('error', { message: 'Failed to force start voting in voice mode' });
      }
    },

    /**
     * Next round
     */
    'next-round': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        console.log(`[SUSD] 🔄 next-round called for room ${coreRoom.code} by socket ${socket.id}`);

        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) {
          console.log(`[SUSD] ❌ No susdRoomId found for room ${coreRoom.code}`);
          return;
        }

        // Get the room to check if it's pass & play mode
        const room = this.gameManager.getRoomByCode(coreRoom.code);
        if (!room) {
          console.log(`[SUSD] ❌ Room not found: ${coreRoom.code}`);
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        // In pass & play mode, any socket can control the game (since it's all one person)
        // In online mode, only the gamemaster can start next round
        if (room.settings.gameType !== 'pass-play') {
          const player = this.gameManager.getPlayerBySocketId(socket.id);
          console.log(`[SUSD] Player check:`, {
            socketId: socket.id,
            player: player ? player.name : 'null',
            isGamemaster: player?.isGamemaster,
            gameType: room.settings.gameType
          });

          if (!player || !player.isGamemaster) {
            console.log(`[SUSD] ❌ Player ${player?.name || 'null'} is not gamemaster, rejecting next-round`);
            socket.emit('error', { message: 'Only gamemaster can start next round' });
            return;
          }
        } else {
          console.log(`[SUSD] ✅ Pass & Play mode - allowing next-round from any socket`);
        }

        console.log(`[SUSD] ✅ Calling gameManager.nextRound for room ${coreRoom.code} with socket ${socket.id}`);
        const result = this.gameManager.nextRound(socket.id);

        if (!result.success) {
          console.log(`[SUSD] ❌ nextRound failed:`, result.error);
          socket.emit('error', { message: result.error });
          return;
        }

        console.log(`[SUSD] ✅ Emitting round-started for room ${coreRoom.code}`);
        helpers.sendToRoom(coreRoom.code, 'round-started', { room: result.room });
      } catch (error: any) {
        console.error('[SUSD] Error starting next round:', error);
        socket.emit('error', { message: 'Failed to start next round' });
      }
    },

    /**
     * End game
     */
    'end-game': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can end the game' });
          return;
        }

        const result = this.gameManager.endGame(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        helpers.sendToRoom(coreRoom.code, 'game-ended', { room: result.room });
      } catch (error: any) {
        console.error('[SUSD] Error ending game:', error);
        socket.emit('error', { message: 'Failed to end game' });
      }
    },

    /**
     * Change game mode
     */
    'change-game-mode': async (socket: Socket, data: { gameMode: string; gameType?: string }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can change game mode' });
          return;
        }

        const result = this.gameManager.changeGameMode(socket.id, data.gameMode, data.gameType);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
      } catch (error: any) {
        console.error('[SUSD] Error changing game mode:', error);
        socket.emit('error', { message: 'Failed to change game mode' });
      }
    },

    /**
     * Update room settings
     */
    'update-room-settings': async (socket: Socket, data: { settings: Partial<GameSettings> }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can update settings' });
          return;
        }

        const result = this.gameManager.updateRoomSettings(socket.id, data.settings);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
      } catch (error: any) {
        console.error('[SUSD] Error updating settings:', error);
        socket.emit('error', { message: 'Failed to update settings' });
      }
    },

    /**
     * Add pass & play player
     */
    'add-pass-play-player': async (socket: Socket, data: { playerName: string }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      console.log('[SUSD] 🎯 add-pass-play-player handler called!', { playerName: data?.playerName, socketId: socket.id, roomCode: coreRoom.code });
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        console.log('[SUSD] susdRoomId:', susdRoomId);
        if (!susdRoomId) {
          console.log('[SUSD] No susdRoomId found for core room:', coreRoom.code);
          return;
        }

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can add players' });
          return;
        }

        const result = this.gameManager.addPassPlayPlayer(socket.id, data.playerName);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
        console.log(`[SUSD] Pass & play player ${data.playerName} added to room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error adding pass & play player:', error);
        socket.emit('error', { message: 'Failed to add player' });
      }
    },

    /**
     * Remove pass & play player
     */
    'remove-pass-play-player': async (socket: Socket, data: { playerId: string }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can remove players' });
          return;
        }

        const result = this.gameManager.removePassPlayPlayer(socket.id, data.playerId);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
        console.log(`[SUSD] Pass & play player removed from room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error removing pass & play player:', error);
        socket.emit('error', { message: 'Failed to remove player' });
      }
    },

    /**
     * Pass & Play: Reveal word to current player
     */
    'reveal-to-current-player': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const result = this.gameManager.revealToCurrentPlayer(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        // Send playerData only to the gamemaster (who controls the device)
        socket.emit('player-revealed', {
          room: result.room,
          playerData: result.playerData
        });

        console.log(`[SUSD] Revealed to current player in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error revealing to current player:', error);
        socket.emit('error', { message: 'Failed to reveal to player' });
      }
    },

    /**
     * Pass & Play: Advance to next player
     */
    'advance-to-next-player': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const result = this.gameManager.advanceToNextPlayer(socket.id);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        // Update all clients with new room state
        helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });

        // If all players have been revealed, notify that word round is complete
        if (result.allPlayersRevealed) {
          helpers.sendToRoom(coreRoom.code, 'next-player-ready', { room: result.room, allPlayersRevealed: true });
        }

        console.log(`[SUSD] Advanced to next player in room ${coreRoom.code}`);
      } catch (error: any) {
        console.error('[SUSD] Error advancing to next player:', error);
        socket.emit('error', { message: 'Failed to advance to next player' });
      }
    },

    /**
     * Kick player (gamemaster only)
     */
    'kick-player': async (socket: Socket, data: { playerId: string }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        const susdRoomId = this.roomMapping.get(coreRoom.code);
        if (!susdRoomId) return;

        const player = this.gameManager.getPlayerBySocketId(socket.id);
        if (!player || !player.isGamemaster) {
          socket.emit('error', { message: 'Only gamemaster can kick players' });
          return;
        }

        // Find target player
        const room = this.gameManager.getRoomBySocketId(socket.id);
        if (!room) return;

        const targetPlayer = room.players.find(p => p.id === data.playerId);
        if (!targetPlayer) {
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        if (targetPlayer.isGamemaster) {
          socket.emit('error', { message: 'Cannot kick gamemaster' });
          return;
        }

        // Remove player from SUSD room
        const result = this.gameManager.leaveRoom(targetPlayer.socketId!);
        
        if (result.player) {
          // Notify the kicked player
          if (targetPlayer.socketId) {
             helpers.sendToPlayer(targetPlayer.socketId, 'kicked', { message: 'You have been kicked from the room' });
             // Optionally force disconnect socket if possible, or let client handle it
             // this.io.of(this.namespace).connected[targetPlayer.socketId]?.disconnect();
          }

          helpers.sendToRoom(coreRoom.code, 'room:updated', { room: result.room });
          console.log(`[SUSD] Player ${targetPlayer.name} kicked by GM in room ${coreRoom.code}`);
        }
      } catch (error: any) {
        console.error('[SUSD] Error kicking player:', error);
        socket.emit('error', { message: 'Failed to kick player' });
      }
    },

    /**
     * WebRTC: Enable video
     */
    'webrtc:enable-video': async (socket: Socket, data: { connectionType: string }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        if (!coreRoom.videoEnabledPeers) {
          coreRoom.videoEnabledPeers = new Set();
        }
        if (!coreRoom.peerConnectionTypes) {
          coreRoom.peerConnectionTypes = new Map();
        }

        coreRoom.videoEnabledPeers.add(socket.id);
        coreRoom.peerConnectionTypes.set(socket.id, data.connectionType);

        helpers.sendToRoom(coreRoom.code, 'webrtc:peer-enabled-video', {
          peerId: socket.id,
          connectionType: data.connectionType,
        });
      } catch (error: any) {
        console.error('[SUSD] Error enabling video:', error);
      }
    },

    /**
     * WebRTC: Disable video
     */
    'webrtc:disable-video': async (socket: Socket, data: any, coreRoom: CoreRoom, helpers: GameHelpers) => {
      try {
        coreRoom.videoEnabledPeers?.delete(socket.id);
        coreRoom.peerConnectionTypes?.delete(socket.id);

        helpers.sendToRoom(coreRoom.code, 'webrtc:peer-disabled-video', { peerId: socket.id });
      } catch (error: any) {
        console.error('[SUSD] Error disabling video:', error);
      }
    },

    /**
     * WebRTC: Forward offer
     */
    'webrtc:offer': async (socket: Socket, data: { toPeerId: string; offer: any }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      helpers.sendToPlayer(data.toPeerId, 'webrtc:offer', {
        fromPeerId: socket.id,
        offer: data.offer,
      });
    },

    /**
     * WebRTC: Forward answer
     */
    'webrtc:answer': async (socket: Socket, data: { toPeerId: string; answer: any }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      helpers.sendToPlayer(data.toPeerId, 'webrtc:answer', {
        fromPeerId: socket.id,
        answer: data.answer,
      });
    },

    /**
     * WebRTC: Forward ICE candidate
     */
    'webrtc:ice-candidate': async (socket: Socket, data: { toPeerId: string; candidate: any }, coreRoom: CoreRoom, helpers: GameHelpers) => {
      helpers.sendToPlayer(data.toPeerId, 'webrtc:ice-candidate', {
        fromPeerId: socket.id,
        candidate: data.candidate,
      });
    },
  };

  /**
   * Called when room is created in core server
   */
  onRoomCreate(room: CoreRoom) {
    console.log(`[SUSD] Core room created: ${room.code}`);
    // SUSD-specific room will be created when client calls 'susd:setup-game'
  }

  /**
   * Called when player joins or reconnects
   */
  onPlayerJoin(room: CoreRoom, player: CorePlayer, isReconnecting?: boolean) {
    const susdRoomId = this.roomMapping.get(room.code);
    if (!susdRoomId) return;

    const susdRoom = this.gameManager.getRoomByCode(room.code);
    if (!susdRoom) return;

    const namespace = this.io.of(this.namespace);

    // Check if player already exists in SUSD room (duplicate check)
    // Check by ID first, then by Name if ID doesn't match
    const existingPlayerIndex = susdRoom.players.findIndex(p => p.id === player.id || p.name === player.name);
    const existingPlayer = susdRoom.players[existingPlayerIndex];

    // Only add player to SUSD room if NOT reconnecting AND not already in room
    if (!isReconnecting && !existingPlayer) {
      console.log(`[Ghost-Debug] New player detected: ${player.name} (${player.id})`);
      // Create SUSD player
      const susdPlayer: Player = {
        id: player.id,
        name: player.name,
        socketId: player.socketId,
        isGamemaster: player.isHost || false,
        isImposter: false,
        hasSubmittedWord: false,
        hasVoted: false,
        isEliminated: false,
        lastSubmittedRound: 0,
        gameBuddiesPlayerId: player.id,
      };

      // Add to SUSD room
      susdRoom.players.push(susdPlayer);
      console.log(`[SUSD] Player ${player.name} added to SUSD room ${room.code}`, {
        totalPlayers: susdRoom.players.length,
      });

      // ✅ Populate core player's gameData with SUSD player fields for consistency
      // This ensures all events (room:joined, room:updated, etc.) have complete SUSD data
      player.gameData = {
        isGamemaster: susdPlayer.isGamemaster,
        isImposter: susdPlayer.isImposter,
        hasSubmittedWord: susdPlayer.hasSubmittedWord,
        hasVoted: susdPlayer.hasVoted,
        votedFor: susdPlayer.votedFor,
        isEliminated: susdPlayer.isEliminated,
        lastSubmittedRound: susdPlayer.lastSubmittedRound,
        gameBuddiesPlayerId: susdPlayer.gameBuddiesPlayerId,
      };

      console.log('[SUSD-DEBUG] 👤 New player join - gameData populated:', {
        playerName: player.name,
        playerId: player.id,
        socketId: player.socketId,
        gameData: player.gameData,
      });

      // Note: Core server will emit 'player:joined' with serializeRoom() result
      // No need to emit 'room:updated' here to avoid duplicate emissions
    } else {
      // Player is reconnecting OR already exists - update their socketId in SUSD room
      // Use existing player if found, otherwise (reconnecting case) find by id
      const susdPlayer = existingPlayer || susdRoom.players.find(p => p.id === player.id);
      
      if (susdPlayer) {
        console.log(`[Ghost-Debug] Existing player found: ${susdPlayer.name} (Old ID: ${susdPlayer.id})`);
        // If we found an existing player but isReconnecting was false, it means we caught a duplicate!
        if (!isReconnecting) {
           console.log(`[SUSD] 🔄 DUPLICATE PREVENTED: Player ${player.name} (${player.id}) already in room. Treating as reconnection.`);
        }

        // If we matched by name but IDs are different (core assigned new ID), we need to adopt the new ID
        if (susdPlayer.id !== player.id) {
            console.log(`[SUSD] 🆔 Player ID changed (reconnection with new ID): ${susdPlayer.id} -> ${player.id}`);
            const oldId = susdPlayer.id;
            
            // Update SUSD player ID
            susdPlayer.id = player.id;
            susdPlayer.gameBuddiesPlayerId = player.id;

            // Update GameManager mapping? GameManager maps socketId -> roomId, so that's fine.
            // But if GameManager stores player IDs internally (e.g. in turn order, votes), we might have an issue.
            // SUSD GameManager seems to reference players by ID in:
            // - turnOrder (array of strings)
            // - votes (key is playerId, value is playerId)
            // - answersThisRound (playerId)
            // - wordsThisRound (playerId)
            // - skipControls (playerIds)
            
            // We need to update ALL references to the old ID in the room state
            
            // 1. Update turnOrder
            if (susdRoom.turnOrder) {
                const turnIndex = susdRoom.turnOrder.indexOf(oldId);
                if (turnIndex !== -1) {
                    susdRoom.turnOrder[turnIndex] = player.id;
                }
            }
            
            // 2. Update currentTurn
            if (susdRoom.currentTurn === oldId) {
                susdRoom.currentTurn = player.id;
            }
            
            // 3. Update votes (keys and values)
            if (susdRoom.votes) {
                // If they voted, move their vote to new ID key
                if (susdRoom.votes[oldId]) {
                    susdRoom.votes[player.id] = susdRoom.votes[oldId];
                    delete susdRoom.votes[oldId];
                }
                // If someone voted FOR them, update the value
                Object.keys(susdRoom.votes).forEach(voterId => {
                    if (susdRoom.votes[voterId] === oldId) {
                        susdRoom.votes[voterId] = player.id;
                    }
                });
            }
            
            // 4. Update wordsThisRound
            if (susdRoom.wordsThisRound) {
                susdRoom.wordsThisRound.forEach(word => {
                    if (word.playerId === oldId) word.playerId = player.id;
                });
            }
            
            // 5. Update answersThisRound
            if (susdRoom.answersThisRound) {
                susdRoom.answersThisRound.forEach(answer => {
                    if (answer.playerId === oldId) answer.playerId = player.id;
                });
            }
            
            // 6. Update skipControls
            if (susdRoom.skipControls) {
                if (susdRoom.skipControls.firstNonImposterId === oldId) susdRoom.skipControls.firstNonImposterId = player.id;
                
                const wordEligibleIndex = susdRoom.skipControls.wordEligiblePlayerIds.indexOf(oldId);
                if (wordEligibleIndex !== -1) susdRoom.skipControls.wordEligiblePlayerIds[wordEligibleIndex] = player.id;
                
                const questionEligibleIndex = susdRoom.skipControls.questionEligiblePlayerIds.indexOf(oldId);
                if (questionEligibleIndex !== -1) susdRoom.skipControls.questionEligiblePlayerIds[questionEligibleIndex] = player.id;
            }
        }

        // Use oldSocketId from core (captured before update) for accurate mapping update
        const oldSocketId = (player as any).oldSocketId;

        // ✅ Validation: Check if socket ID actually changed
        if (!oldSocketId) {
          // If we're just handling a duplicate join on the same socket, we might not have oldSocketId
          // but we should ensure current socket is up to date
          if (susdPlayer.socketId !== player.socketId) {
             susdPlayer.socketId = player.socketId;
             console.log(`[SUSD] Updated socketId for existing player ${player.name} (no oldSocketId): -> ${player.socketId}`);
          }
        } else if (oldSocketId === player.socketId) {
          console.warn(
            `[SUSD] ℹ️  Socket ID unchanged during reconnection (rapid retry within grace period?)`,
            {
              playerId: player.id,
              playerName: player.name,
              socketId: player.socketId,
            }
          );
          // Don't try to update mapping - socket already correct
          // Still send room state sync below to keep client in sync
        } else {
          // Socket ID actually changed - update both SUSD room and GameManager mapping
          susdPlayer.socketId = player.socketId;

          // Update the GameManager's playerToRoom mapping
          this.gameManager.updatePlayerSocketId(oldSocketId, player.socketId);

          console.log(
            `[SUSD] Updated socketId for reconnecting player ${player.name}: ${oldSocketId} → ${player.socketId}`
          );
        }

        // ✅ CRITICAL FIX: Populate core player's gameData with SUSD player fields
        // This ensures room:joined event includes all SUSD-specific data (especially isImposter)
        player.gameData = {
          isGamemaster: susdPlayer.isGamemaster,
          isImposter: susdPlayer.isImposter,
          hasSubmittedWord: susdPlayer.hasSubmittedWord,
          hasVoted: susdPlayer.hasVoted,
          votedFor: susdPlayer.votedFor,
          isEliminated: susdPlayer.isEliminated,
          lastSubmittedRound: susdPlayer.lastSubmittedRound,
          gameBuddiesPlayerId: susdPlayer.gameBuddiesPlayerId,
        };

        console.log(
          `[SUSD] Populated gameData for reconnecting player ${player.name}:`,
          { isImposter: susdPlayer.isImposter, isGamemaster: susdPlayer.isGamemaster }
        );

        console.log('[SUSD-DEBUG] 🔌 Reconnection - gameData populated:', {
          playerName: player.name,
          playerId: player.id,
          socketId: player.socketId,
          gameData: player.gameData,
        });
      } else {
        console.error(
          `[SUSD] ❌ CRITICAL: Reconnecting player ${player.id} not found in SUSD room ${room.code}`
        );
      }

      // Send SUSD room to reconnected player (use proper serialization with premiumTier)
      namespace.to(player.socketId).emit('room:updated', { room: this.serializeRoom(room, player.socketId) });
      console.log(`[SUSD] Sent SUSD room to reconnecting player ${player.name} in ${room.code}`);
    }
  }

  /**
   * Called when player disconnects (during grace period)
   * Broadcast state update so other players see the disconnected status
   */
  onPlayerDisconnected(room: CoreRoom, player: CorePlayer) {
    console.log(`[SUSD] Player ${player.name} disconnected from room ${room.code} - broadcasting state update`);

    // Get SUSD room
    const susdRoomId = this.roomMapping.get(room.code);
    if (!susdRoomId) return;

    const susdRoom = this.gameManager.getRoomByCode(room.code);
    if (!susdRoom) return;

    // Broadcast updated room state so other players see disconnected status (use proper serialization with premiumTier)
    if (this.io) {
      const namespace = this.io.of('/badactor');
      namespace.to(room.code).emit('room:updated', { room: this.serializeRoom(room, '') });
      console.log(`[SUSD] Broadcast disconnect status for ${player.name} to room ${room.code}`);
    }
  }

  /**
   * Called when player leaves after grace period
   * Broadcasts state update so other players see the removal
   */
  onPlayerLeave(room: CoreRoom, player: CorePlayer) {
    const susdRoomId = this.roomMapping.get(room.code);
    if (!susdRoomId) return;

    this.gameManager.leaveRoom(player.socketId);
    console.log(`[SUSD] Player ${player.name} left SUSD room ${room.code}`);

    // Get updated room to broadcast
    const susdRoom = this.gameManager.getRoomByCode(room.code);
    if (!susdRoom) return;

    // Broadcast updated room state so other players see removal (use proper serialization with premiumTier)
    if (this.io) {
      const namespace = this.io.of('/badactor');
      namespace.to(room.code).emit('room:updated', { room: this.serializeRoom(room, '') });
      console.log(`[SUSD] Broadcast player removal for ${player.name} to room ${room.code}`);
    }
  }

  /**
   * Serialize room for sending to clients
   * This is called by core server when emitting room updates (room:joined, room:updated, etc.)
   *
   * ✅ CRITICAL FIX: Flattens player data so client receives isImposter, isGamemaster, etc.
   * as direct fields (not nested in gameData) to match SUSD Player interface
   */
  serializeRoom(room: CoreRoom, socketId: string): any {
    const susdRoomId = this.roomMapping.get(room.code);
    if (!susdRoomId) {
      // Room not initialized yet, return core room
      return room;
    }

    const susdRoom = this.gameManager.getRoomByCode(room.code);
    if (!susdRoom) {
      // SUSD room doesn't exist, return core room
      return room;
    }

    const corePlayerCount = room.players.size;
    const susdPlayerCount = susdRoom.players.length;
    const countMismatch = corePlayerCount !== susdPlayerCount;

    console.log(
      `[SUSD-DEBUG] 🎯 serializeRoom called:` +
      (countMismatch ? ` ⚠️ MISMATCH DETECTED` : '') +
      ` | roomCode: ${room.code}` +
      ` | core: ${corePlayerCount} sockets, susd: ${susdPlayerCount} players`
    );

    if (countMismatch) {
      console.log('[RECONNECT-DEBUG] 🔴 PLAYER COUNT MISMATCH - Grace period likely active!');
      console.log('[RECONNECT-DEBUG] Core player sockets:', Array.from(room.players.keys()));
      console.log('[RECONNECT-DEBUG] SUSD player IDs:', susdRoom.players.map(p => p.id));
      console.log('[RECONNECT-DEBUG] SUSD player names:', susdRoom.players.map(p => p.name));
    }

    console.log('[SUSD-DEBUG] Raw SUSD Players:', susdRoom.players.map(p => `${p.name} (${p.id})`));

    // DEDUPLICATION LOGIC:
    // The core room might contain multiple sockets for the same player during the grace period.
    // We need to ensure the serialized SUSD room only returns ONE entry per unique PLAYER (not socket).
    // Use gameBuddiesPlayerId as the stable identifier (stays same across reconnections).
    const processedGameBuddiesIds = new Set<string>();
    const processedPlayerIds = new Set<string>();
    const processedPlayerNames = new Set<string>();

    // Map SUSD players to client-compatible format by extracting core player data
    // Filter out duplicates on the fly
    const uniqueSerializedPlayers = susdRoom.players
      .map((susdPlayer: Player) => {
        // Find corresponding core player for connection status and gameData
        // Priority: Match by ID first
        let corePlayer = Array.from(room.players.values()).find(cp => cp.id === susdPlayer.id);

        // If no ID match (rare), try matching by name (for legacy/reconnection edge cases)
        if (!corePlayer) {
             corePlayer = Array.from(room.players.values()).find(cp => cp.name === susdPlayer.name);
        }

        console.log('[SUSD-DEBUG] 🔄 Processing player:', {
          susdPlayerName: susdPlayer.name,
          susdPlayerId: susdPlayer.id,
          gameBuddiesPlayerId: (susdPlayer as any).gameBuddiesPlayerId,
          foundInCore: !!corePlayer,
          path: corePlayer ? 'serializePlayerForClient' : 'fallback',
        });

        if (corePlayer) {
          // Use serialized player with flattened fields
          return this.serializePlayerForClient(corePlayer);
        }
        // Fallback to SUSD player (shouldn't happen in normal flow)
        console.log('[SUSD-DEBUG] ⚠️ Using fallback (pass-and-play):', {
          playerName: susdPlayer.name,
          isImposter: susdPlayer.isImposter,
          isGamemaster: susdPlayer.isGamemaster,
        });
        return susdPlayer;
      })
      .filter((player) => {
        // ✅ CRITICAL: Filter out duplicates using MULTIPLE identifiers
        // 1. gameBuddiesPlayerId - THE STABLE IDENTIFIER across reconnections
        // 2. player.id - Fallback for same session
        // 3. player.name - Last resort for identifying same player

        const gbId = (player as any).gameBuddiesPlayerId;
        const playerId = player.id;
        const playerName = player.name;

        if (gbId && processedGameBuddiesIds.has(gbId)) {
          console.log(`[SUSD-GHOST-DEBUG] 🛑 Skipping duplicate player by gameBuddiesPlayerId: ${playerName} (gbId: ${gbId})`);
          return false;
        }

        if (processedPlayerIds.has(playerId) || processedPlayerNames.has(playerName)) {
          console.log(`[SUSD-GHOST-DEBUG] 🛑 Skipping duplicate player by ID/Name: ${playerName} (id: ${playerId})`);
          return false;
        }

        // Track this player to prevent duplicates
        if (gbId) processedGameBuddiesIds.add(gbId);
        processedPlayerIds.add(playerId);
        processedPlayerNames.add(playerName);
        return true;
      });

    console.log('[SUSD-GHOST-DEBUG] Final Serialized Players:',
      uniqueSerializedPlayers.map((p: any) => `${p.name} (id: ${p.id}, gbId: ${p.gameBuddiesPlayerId})`));

    // ✅ Transform SUSD room with flattened player data
    if (room.isStreamerMode || room.hideRoomCode) {
      console.log(`[SUSD] serializeRoom -> ${room.code}: streamerMode=${room.isStreamerMode} hideRoomCode=${room.hideRoomCode}`);
    }
    const serialized = {
      ...susdRoom,
      players: uniqueSerializedPlayers,
      isStreamerMode: room.isStreamerMode || false,
      hideRoomCode: room.hideRoomCode || false,
      // Also serialize gamemaster if it exists
      gamemaster: (() => {
        const gmId = susdRoom.gamemaster?.id;
        if (!gmId) return undefined;
        const coreGM = Array.from(room.players.values()).find(cp => cp.id === gmId);

        console.log('[SUSD-DEBUG] 👑 Gamemaster serialization:', {
          gmId,
          gmName: susdRoom.gamemaster?.name,
          foundInCore: !!coreGM,
        });

        return coreGM ? this.serializePlayerForClient(coreGM) : susdRoom.gamemaster;
      })(),
    };

    console.log('[SUSD-DEBUG] 📤 Final serialized room:', {
      code: serialized.code,
      playerCount: serialized.players.length,
      players: serialized.players.map(p => ({
        name: p.name,
        isImposter: p.isImposter,
        isGamemaster: p.isGamemaster,
      })),
    });

    return serialized;
  }

  /**
   * Cleanup on shutdown
   */
  async onCleanup() {
    console.log('[SUSD] Cleaning up plugin...');
    this.roomMapping.clear();
    console.log('[SUSD] Plugin cleanup complete');
  }
}

// Export singleton instance
export const SUSDGame = new SUSDPlugin();
