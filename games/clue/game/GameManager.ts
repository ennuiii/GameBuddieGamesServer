import { Room, Player, GameHelpers } from '../../../core/types/core.js';
import { ClueGameState, CluePlayerData, Round, ClueSettings } from '../types/index.js';
import { scoreRound } from '../utils/scoring.js';

// ========================================
// Helper Functions
// ========================================

/**
 * Get random category from the list
 */
export function getRandomCategory(categories: string[]): string {
  return categories[Math.floor(Math.random() * categories.length)];
}

/**
 * Generate random target number (1-10)
 */
export function getRandomTargetNumber(): number {
  return Math.floor(Math.random() * 10) + 1;
}

/**
 * Get next player for clue giver role (circular rotation)
 */
export function getNextClueGiver(room: Room): { giverId: string; giverSocketId: string } | null {
  const gameState = room.gameState.data as ClueGameState;
  const connectedPlayers = Array.from(room.players.values()).filter((p) => p.connected);

  if (connectedPlayers.length < 2) {
    console.log(`[ClueScale] Room ${room.code} - Not enough players (${connectedPlayers.length}) to continue`);
    return null;
  }

  // Initialize role queue if empty or needs reset
  if (gameState.roleQueue.length === 0) {
    gameState.roleQueue = connectedPlayers.map((p) => p.id);
  }

  // Get next player as clue giver
  const giverId = gameState.roleQueue[0];

  // Find the player to get their socket ID
  const giverPlayer = Array.from(room.players.values()).find((p) => p.id === giverId);
  if (!giverPlayer) {
    console.log(`[ClueScale] Room ${room.code} - Could not find player for giverId ${giverId}`);
    return null;
  }

  // Rotate queue
  gameState.roleQueue.push(gameState.roleQueue.shift()!);

  return { giverId, giverSocketId: giverPlayer.socketId };
}

// ========================================
// Round Management
// ========================================

/**
 * Start a new round
 */
export function startNewRound(
  room: Room,
  helpers: GameHelpers
): boolean {
  const gameState = room.gameState.data as ClueGameState;
  const settings = room.settings.gameSpecific as ClueSettings;
  const roles = getNextClueGiver(room);

  if (!roles) {
    // Not enough players - return to lobby
    console.log(`[ClueScale] Room ${room.code} - Cannot start round - returning to lobby`);
    room.gameState.phase = 'lobby';
    gameState.round = null;

    // Clear any timers
    if (gameState.roundTimer) {
      clearTimeout(gameState.roundTimer);
      gameState.roundTimer = undefined;
    }

    // Notify players
    helpers.sendToRoom(room.code, 'error', {
      message: 'Not enough players to continue. Waiting for more players...'
    });

    return false;
  }

  const { giverId, giverSocketId } = roles;
  const category = getRandomCategory(settings.categories);
  const targetNumber = getRandomTargetNumber();

  const round: Round = {
    index: gameState.round ? gameState.round.index + 1 : 1,
    category,
    targetNumber,
    clueWord: null,
    numberPickerId: null, // No number picker in current version
    clueGiverId: giverId,
    guesses: [],
    clueGiverPoints: 0,
  };

  gameState.round = round;
  room.gameState.phase = 'round_clue';
  gameState.roundStartTime = Date.now();

  console.log(`[ClueScale] Room ${room.code} - Round ${round.index} started - Category: ${category}, Clue Giver: ${giverId}`);

  // Emit round start to all players
  helpers.sendToRoom(room.code, 'round:start', {
    roundIndex: round.index,
    category: round.category,
    clueGiverId: giverId,
    duration: settings.roundDuration,
  });

  // Emit specific data to clue giver (they are the only one who sees the number)
  helpers.sendToPlayer(giverSocketId, 'round:giver-data', {
    targetNumber,
    category
  });

  // Clear any existing timer
  if (gameState.roundTimer) {
    clearTimeout(gameState.roundTimer);
  }

  // Start round timer
  gameState.roundTimer = setTimeout(() => {
    if (room.gameState.phase === 'round_clue' && !gameState.round?.clueWord) {
      // Clue not submitted in time - skip round
      console.log(`[ClueScale] Room ${room.code} - Clue timeout - skipping round`);
      handleClueTimeout(room, helpers);
    } else if (room.gameState.phase === 'round_guess') {
      // Guess phase timeout - reveal results
      console.log(`[ClueScale] Room ${room.code} - Guess timeout - revealing results`);
      revealRoundResults(room, helpers);
    }
  }, settings.roundDuration * 1000);

  return true;
}

/**
 * Handle clue submission timeout
 */
export function handleClueTimeout(
  room: Room,
  helpers: GameHelpers
): void {
  const gameState = room.gameState.data as ClueGameState;

  if (!gameState.round) return;

  // Deduct points from clue giver
  const clueGiver = Array.from(room.players.values()).find((p) => p.id === gameState.round!.clueGiverId);
  if (clueGiver && clueGiver.gameData) {
    const clueGiverData = clueGiver.gameData as CluePlayerData;
    const currentScore = clueGiverData?.score ?? 0;
    clueGiverData.score = Math.max(0, currentScore - 1);
  }

  console.log(`[ClueScale] Room ${room.code} - Clue timeout - ${clueGiver?.name} loses 1 point`);

  helpers.sendToRoom(room.code, 'round:clue-timeout', {
    clueGiverId: gameState.round.clueGiverId,
    clueGiverName: clueGiver?.name,
  });

  // Wait a bit, then try to start next round
  setTimeout(() => {
    const stillExists = helpers.getRoomByCode(room.code);
    if (stillExists) {
      const success = startNewRound(room, helpers);
      if (!success) {
        console.log(`[ClueScale] Room ${room.code} - Could not start new round - room returned to waiting`);
      }
    }
  }, 3000);
}

/**
 * Reveal round results and update scores
 */
export function revealRoundResults(
  room: Room,
  helpers: GameHelpers
): void {
  const gameState = room.gameState.data as ClueGameState;
  const settings = room.settings.gameSpecific as ClueSettings;

  if (!gameState.round) return;

  room.gameState.phase = 'round_reveal';

  // Clear timer
  if (gameState.roundTimer) {
    clearTimeout(gameState.roundTimer);
    gameState.roundTimer = undefined;
  }

  // Score the round
  const { scoredGuesses, clueGiverPoints, teamBonus } = scoreRound(
    gameState.round,
    settings.teamBonusEnabled
  );

  // Update player scores
  scoredGuesses.forEach((guess) => {
    const player = Array.from(room.players.values()).find((p) => p.id === guess.playerId);
    if (player && player.gameData) {
      const playerData = player.gameData as CluePlayerData;
      playerData.score += guess.points;
      console.log(`[ClueScale] Guesser ${player.name} score updated: ${playerData.score - guess.points} -> ${playerData.score} (+${guess.points})`);
    }
  });

  const clueGiver = Array.from(room.players.values()).find((p) => p.id === gameState.round!.clueGiverId);
  if (clueGiver && clueGiver.gameData) {
    const clueGiverData = clueGiver.gameData as CluePlayerData;
    clueGiverData.score += clueGiverPoints;
  console.log(`[ClueScale] Clue giver ${clueGiver.name} score updated: ${clueGiverData.score - clueGiverPoints} -> ${clueGiverData.score} (+${clueGiverPoints})`);
  }

  // Sort players by score for leaderboard
  const leaderboard = Array.from(room.players.values())
    .sort((a, b) => {
      const aData = a.gameData as CluePlayerData;
      const bData = b.gameData as CluePlayerData;
      const aScore = aData?.score ?? 0;
      const bScore = bData?.score ?? 0;
      return bScore - aScore;
    })
    .map((p, index) => {
      const playerData = p.gameData as CluePlayerData;
      return {
        rank: index + 1,
        name: p.name,
        score: playerData?.score ?? 0,
        socketId: p.socketId,
      };
    });

  console.log(`[ClueScale] Room ${room.code} - Round ${gameState.round.index} results revealed - Target: ${gameState.round.targetNumber}, Clue: ${gameState.round.clueWord}`);

  // Debug: Log the reveal payload
  console.log(`[RESULT] 📤 Emitting round:reveal to room ${room.code}`);
  console.log(`[RESULT] 📤 Payload:`, JSON.stringify({
    roundIndex: gameState.round.index,
    targetNumber: gameState.round.targetNumber,
    clueWord: gameState.round.clueWord,
    guessCount: scoredGuesses.length,
    guesses: scoredGuesses.map(g => ({ player: g.playerName, value: g.value, points: g.points })),
    leaderboardCount: leaderboard.length,
  }, null, 2));

  // Emit results
  helpers.sendToRoom(room.code, 'round:reveal', {
    roundIndex: gameState.round.index,
    targetNumber: gameState.round.targetNumber,
    clueWord: gameState.round.clueWord,
    guesses: scoredGuesses,
    clueGiverId: gameState.round.clueGiverId,
    clueGiverName: clueGiver?.name,
    clueGiverPoints,
    teamBonus,
    leaderboard,
  });
}

/**
 * Initialize game state for a new room
 */
export function initializeGameState(): ClueGameState {
  return {
    round: null,
    roundStartTime: null,
    roleQueue: [],
    roundTimer: undefined,
  };
}

/**
 * Initialize player game data
 */
export function initializePlayerData(): CluePlayerData {
  return {
    score: 0,
    isBackgrounded: false,
  };
}
