import type { GamePlugin, Room as CoreRoom, Player as CorePlayer, GameHelpers } from '../../core/types/core.js';
import type { Socket } from 'socket.io';
import { GameManager } from './game/GameManager.js';
import { Player, GameMode, GameSettings } from './types/types.js';
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
  namespace = '/susd';
  basePath = '/susd';

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
          gameBuddiesPlayerId: hostPlayer.id,
        };

        // Create SUSD room using GameManager
        const susdRoom = this.gameManager.createRoom(susdPlayer, gameMode || 'classic', coreRoom.code);

        // Apply custom settings
        if (settings) {
          Object.assign(susdRoom.settings, settings);
        }

        // Store mapping
        this.roomMapping.set(coreRoom.code, susdRoom.id);

        // Store SUSD room data in core room
        coreRoom.gameState.data = { susdRoomId: susdRoom.id };

        socket.emit('susd:game-setup', { room: susdRoom });
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
        const result = this.gameManager.startGame(susdRoomId);

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

        const result = this.gameManager.forceEndVoting(socket.id);

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

        const result = this.gameManager.skipCurrentPlayer(coreRoom.code);

        if (!result.success) {
          socket.emit('error', { message: result.error });
          return;
        }

        helpers.sendToRoom(coreRoom.code, 'player-skipped', { room: result.room });
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

    // Only add player to SUSD room if NOT reconnecting
    if (!isReconnecting) {
      // Create SUSD player
      const susdPlayer: Player = {
        id: player.id,
        name: player.name,
        socketId: player.socketId,
        isGamemaster: false,
        isImposter: false,
        hasSubmittedWord: false,
        hasVoted: false,
        isEliminated: false,
        gameBuddiesPlayerId: player.id,
      };

      // Add to SUSD room
      susdRoom.players.push(susdPlayer);
      console.log(`[SUSD] Player ${player.name} added to SUSD room ${room.code}`);

      // Note: Core server will emit 'player:joined' with serializeRoom() result
      // No need to emit 'room:updated' here to avoid duplicate emissions
    } else {
      // Player is reconnecting - update their socketId in SUSD room
      const susdPlayer = susdRoom.players.find(p => p.id === player.id);
      if (susdPlayer) {
        // Use oldSocketId from core (captured before update) for accurate mapping update
        const oldSocketId = (player as any).oldSocketId || susdPlayer.socketId;
        susdPlayer.socketId = player.socketId;

        // Update the GameManager's playerToRoom mapping
        this.gameManager.updatePlayerSocketId(oldSocketId, player.socketId);

        console.log(`[SUSD] Updated socketId for reconnecting player ${player.name}: ${oldSocketId} → ${player.socketId}`);
      }

      // Send SUSD room to reconnected player
      namespace.to(player.socketId).emit('room:updated', { room: susdRoom });
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

    // Broadcast updated room state so other players see disconnected status
    if (this.io) {
      const namespace = this.io.of('/susd');
      namespace.to(room.code).emit('room:updated', { room: susdRoom });
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

    // Broadcast updated room state so other players see removal
    if (this.io) {
      const namespace = this.io.of('/susd');
      namespace.to(room.code).emit('room:updated', { room: susdRoom });
      console.log(`[SUSD] Broadcast player removal for ${player.name} to room ${room.code}`);
    }
  }

  /**
   * Serialize room for sending to clients
   * This is called by core server when emitting room updates
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

    // Return the SUSD-specific room with all game data
    return susdRoom;
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
