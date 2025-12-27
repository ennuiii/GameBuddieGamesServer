/**
 * Game Template Server Types
 *
 * Define your game-specific types here.
 * These types are used by the server plugin for state management.
 *
 * @example
 * - GameState: The full game state (rounds, scores, current player, etc.)
 * - PlayerData: Per-player game data (hand, score, role, etc.)
 * - Settings: Game-specific settings (timer, difficulty, etc.)
 */

// ============================================================================
// GAME PHASES
// ============================================================================

/**
 * Define all possible game phases.
 * Common phases: 'lobby', 'playing', 'round_end', 'game_over', 'victory'
 */
export type GamePhase =
  | 'lobby'        // Waiting for players, setting up
  | 'round_prep'   // Countdown before round starts
  | 'playing'      // Active gameplay
  | 'round_end'    // Round finished, showing results
  | 'game_over'    // Game finished (loss)
  | 'victory';     // Game finished (win)

// ============================================================================
// GAME STATE
// ============================================================================

/**
 * The complete game state stored on the server.
 * This is what gets persisted in room.gameState.data
 */
export interface GameState {
  phase: GamePhase;

  // Round tracking
  currentRound: number;
  maxRounds: number;

  // Score/Lives tracking (customize for your game)
  score: number;
  livesRemaining: number;
  maxLives: number;

  // Timer (if your game uses timed rounds)
  timeRemaining: number;
  timerStartedAt: number | null;

  // Round history
  rounds: RoundHistory[];

  // Game settings (copied from room settings for easy access)
  settings: GameSettings;

  // TODO: Add your game-specific state here
  // Examples:
  // - currentQuestion: Question | null;
  // - currentPlayer: string | null;
  // - deck: Card[];
  // - board: Cell[][];
}

/**
 * History entry for each completed round
 */
export interface RoundHistory {
  number: number;
  // TODO: Add round-specific data
  // Examples:
  // - question: string;
  // - correctAnswer: string;
  // - playerAnswers: Record<string, string>;
  // - winner: string | null;
  timestamp: number;
}

// ============================================================================
// PLAYER DATA
// ============================================================================

/**
 * Per-player game data stored in player.gameData
 */
export interface PlayerData {
  isReady: boolean;
  isSpectator: boolean;

  // TODO: Add your player-specific data here
  // Examples:
  // - score: number;
  // - hand: Card[];
  // - role: 'guesser' | 'drawer';
  // - hasAnswered: boolean;
}

// ============================================================================
// GAME SETTINGS
// ============================================================================

/**
 * Game-specific settings (stored in room.settings.gameSpecific)
 */
export interface GameSettings {
  // Timer duration in seconds (0 = no timer)
  timerDuration: number;

  // Maximum lives/attempts
  maxLives: number;

  // TODO: Add your game-specific settings
  // Examples:
  // - difficulty: 'easy' | 'medium' | 'hard';
  // - category: string;
  // - enableHints: boolean;
}

// ============================================================================
// DEFAULT VALUES
// ============================================================================

export const DEFAULT_SETTINGS: GameSettings = {
  timerDuration: 60,
  maxLives: 3,
  // TODO: Add defaults for your settings
};

/**
 * Create initial game state
 */
export function createInitialGameState(settings: GameSettings): GameState {
  return {
    phase: 'lobby',
    currentRound: 0,
    maxRounds: 10, // Or calculate based on settings
    score: 0,
    livesRemaining: settings.maxLives,
    maxLives: settings.maxLives,
    timeRemaining: settings.timerDuration,
    timerStartedAt: null,
    rounds: [],
    settings,
    // TODO: Initialize your game-specific state
  };
}

/**
 * Create initial player data
 */
export function createInitialPlayerData(): PlayerData {
  return {
    isReady: false,
    isSpectator: false,
    // TODO: Initialize your player-specific data
  };
}

// ============================================================================
// CONSTANTS
// ============================================================================

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const COUNTDOWN_DURATION_MS = 3500; // 3-2-1-GO!
export const TIMER_UPDATE_INTERVAL_MS = 1000;
export const MAX_STORED_MESSAGES = 100;
