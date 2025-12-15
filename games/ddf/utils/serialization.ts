/**
 * DDF Room Serialization Utilities
 *
 * Converts unified server's Room structure into the format expected by DDF client.
 * Critical for multiplayer functionality - ensures client receives correct data structure.
 */

import { Room, Player } from '../../../core/types/core.js';
import { DDFGameState, DDFPlayerData } from '../types/index.js';

/**
 * Serialize a unified server Room to DDF client format
 *
 * The unified server uses a different structure than what the old DDF client expects.
 * This function transforms between the two:
 *
 * Server structure:
 * - players: Map<string, Player>
 * - gameState.data: DDFGameState
 * - gameState.phase: server phase names
 *
 * Client expects:
 * - players: Player[]
 * - All game state fields at root level
 * - mySocketId: added for client's reference
 *
 * @param room - The unified server's Room object
 * @param socketId - The client's socket ID (for mySocketId field)
 * @returns Serialized room object matching DDF client expectations
 */
export function serializeRoomToDDF(room: Room, socketId: string): any {
  const gameState = room.gameState.data as DDFGameState | undefined;

  // Default game state if not yet initialized
  const defaultGameState: DDFGameState = {
    phase: 'lobby',
    gamemaster: null,
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
    finaleQuestions: [],
    finaleCurrentQuestion: null,
    finaleCurrentAnswers: [],
    finaleScores: {},
    finaleEvaluations: [],
    usedQuestions: [],
    selectedCategories: [],
    timer: {
      isActive: false,
      time: 0,
      duration: 120,
    },
    roundStarted: false,
    shotClock: {
      enabled: false,
      duration: 30,
    },
    settings: {
      roundDuration: 120,
      shotClockEnabled: false,
      shotClockDuration: 30,
    },
  };

  const gs = gameState || defaultGameState;

  // =========================================================================
  // 1. Convert players Map to Array with client-expected format
  // =========================================================================
  // In GameBuddies rooms, include all players
  // In regular DDF, exclude host (they're the gamemaster)
  const allPlayers = Array.from(room.players.values());

  // Debug logging for GameBuddies rooms to diagnose join issues
  if (room.isGameBuddiesRoom) {
    console.log(`[DDF Serialization] GameBuddies room: ${room.code}, Total players: ${allPlayers.length}`);
    console.log(`[DDF Serialization] Players:`, allPlayers.map(p => ({ id: p.id, name: p.name, isHost: p.isHost, connected: p.connected, premiumTier: p.premiumTier })));
  }

  const players = allPlayers
    .filter((p) => {
      const playerData = p.gameData as DDFPlayerData | undefined;

      // Exclude gamemaster from player list (they're marked with isGamemaster flag)
      if (playerData?.isGamemaster) {
        return false;
      }

      // Include all other players
      if (room.isGameBuddiesRoom) {
        return true; // Include everyone except gamemaster in GameBuddies mode
      }
      return !p.isHost; // Regular DDF: exclude by isHost (fallback)
    })
    .map((p) => {
    const playerData = p.gameData as DDFPlayerData | undefined;

    return {
      // Core player info
      id: p.id,
      socketId: p.socketId,
      name: p.name,
      connected: p.connected,
      isHost: p.isHost,
      premiumTier: p.premiumTier,
      avatarUrl: p.avatarUrl,

      // Game-specific data
      lives: playerData?.lives || 3,
      isEliminated: playerData?.isEliminated || false,
      isDisconnected: !p.connected,
      disconnectedAt: p.disconnectedAt, // Use the actual disconnect timestamp
      mediaState: playerData?.mediaState,
    };
    });

  if (room.isStreamerMode || room.hideRoomCode) {
    console.log(
      `[DDF Serialization] Room ${room.code} streamerMode=${room.isStreamerMode} hideRoomCode=${room.hideRoomCode}`
    );
  }

  // =========================================================================
  // 2. Ensure gamemaster has the correct actual name and premiumTier
  // =========================================================================
  // Use the host's actual name from the room, falling back to gameState if not set
  // Find the host player to get their premiumTier
  const hostPlayer = allPlayers.find(p => p.id === room.hostId);

  console.log('[DDF AVATAR DEBUG] hostPlayer:', {
    id: hostPlayer?.id,
    name: hostPlayer?.name,
    avatarUrl: hostPlayer?.avatarUrl,
    premiumTier: hostPlayer?.premiumTier
  });

  const gamemasterWithName = {
    id: room.hostId,
    name: room.hostName || gs.gamemaster?.name || 'Gamemaster',
    premiumTier: hostPlayer?.premiumTier || 'free',
    avatarUrl: hostPlayer?.avatarUrl,
  };

  console.log('[DDF AVATAR DEBUG] gamemasterWithName:', gamemasterWithName);

  // =========================================================================
  // 3. Build complete room object for client
  // =========================================================================
  return {
    // Core room info
    code: room.code,
    gameId: room.gameId,
    hostId: room.hostId,

    // Players (converted from Map to Array)
    players,

    // Game state (flattened from gameState.data)
    // Note: gameState is a string for client-side checks like `room.gameState !== 'lobby'`
    gameState: gs.phase,
    phase: gs.phase,
    gamemaster: gamemasterWithName,
    currentQuestion: gs.currentQuestion,
    targetPlayerId: gs.targetPlayerId,
    currentPlayerIndex: gs.currentPlayerIndex,
    roundAnswers: gs.roundAnswers,
    previousRoundAnswers: gs.previousRoundAnswers,
    votes: gs.votes,
    votingStatus: gs.votingStatus,
    roundNumber: gs.roundNumber,
    showQuestionsToPlayers: gs.showQuestionsToPlayers,
    questionIndex: gs.questionIndex,
    isFinale: gs.isFinale,
    finaleState: gs.finaleState,
    finaleQuestions: gs.finaleQuestions || [],
    finaleCurrentQuestion: gs.finaleCurrentQuestion,
    finaleCurrentAnswers: gs.finaleCurrentAnswers,
    finaleScores: gs.finaleScores,
    finaleEvaluations: gs.finaleEvaluations,
    usedQuestions: gs.usedQuestions,
    selectedCategories: gs.selectedCategories,
    winner: gs.winner,
    timer: gs.timer,
    shotClock: gs.shotClock,
    settings: gs.settings,
    isSecondVotingRound: gs.isSecondVotingRound,
    tiedPlayerIds: gs.tiedPlayerIds,

    // Other room data
    messages: room.messages || [],
    isGameBuddiesRoom: room.isGameBuddiesRoom || false,
    isStreamerMode: room.isStreamerMode || false,
    hideRoomCode: room.hideRoomCode || false,

    // Critical for client-side socket operations
    mySocketId: socketId,
  };
}

/**
 * Serialization helper for specific phase updates
 * Use this when you only need to send partial game state
 */
export function serializeGameStateUpdate(
  room: Room,
  socketId: string,
): any {
  return serializeRoomToDDF(room, socketId);
}

/**
 * Serialize voting results for the round result event
 */
export function serializeVotingResults(
  room: Room,
  playerVoteCounts: Record<string, number>,
  selectedPlayerId: string,
  tiedPlayerIds?: string[],
): any {
  return {
    room: serializeRoomToDDF(room, ''),
    votingResults: {
      playerVoteCounts,
      selectedPlayerId,
      tiedPlayerIds,
    },
  };
}

/**
 * Serialize finale state
 */
export function serializeFinaleProgress(
  room: Room,
  socketId: string,
  playerId: string,
  answeredCount: number,
  totalQuestions: number,
): any {
  return {
    room: serializeRoomToDDF(room, socketId),
    playerId,
    answeredCount,
    totalQuestions,
  };
}
