/**
 * ThinkAlike Game Types
 *
 * Server-side type definitions for the ThinkAlike game.
 * ThinkAlike is a 1v1 word synchronization game where players
 * share 5 lives and try to think of the same word.
 */

/**
 * Game phases for server-side state management
 */
export type GamePhase =
  | 'lobby'          // Waiting for players and ready status
  | 'round_prep'     // 3-second countdown before word input
  | 'word_input'     // Players typing/entering their words
  | 'reveal'         // Words revealed, showing match/no-match
  | 'victory'        // Players achieved a match (win condition)
  | 'game_over';     // All lives lost (lose condition)

/**
 * Main game state stored in Room.gameState.data
 */
export interface ThinkAlikeGameState {
  // Game phase and timing
  phase: GamePhase;
  currentRound: number;
  maxRounds: number;  // Not used for victory, but tracks round count

  // Lives system (shared between both players)
  livesRemaining: number;
  maxLives: number;

  // Timer
  timeRemaining: number;  // Seconds
  timerStartedAt: number | null;  // Timestamp when timer started

  // Current round data (per-player)
  player1Word: string | null;
  player2Word: string | null;
  player1Submitted: boolean;
  player2Submitted: boolean;

  // Live typing (for spectators to see real-time input)
  player1LiveWord: string | null;
  player2LiveWord: string | null;

  // Player identity (stable across reconnections - set when game starts)
  // Use IDs for game logic, names for display only
  player1Id: string | null;
  player2Id: string | null;
  player1Name: string | null;
  player2Name: string | null;

  // Round history
  rounds: RoundHistory[];

  // Game settings
  settings: ThinkAlikeSettings;
}

/**
 * History entry for each round
 */
export interface RoundHistory {
  number: number;
  player1Word: string;
  player2Word: string;
  wasMatch: boolean;
  timeTaken: number;  // Seconds
  timestamp: number;  // Unix timestamp
}

/**
 * Game settings (configurable by host)
 */
export interface ThinkAlikeSettings {
  timerDuration: number;  // Seconds per round (default: 60)
  maxLives: number;       // Shared lives pool (default: 5)
  voiceMode: boolean;     // Players say words aloud instead of typing (default: false)
}

/**
 * Player-specific data stored in Player.gameData
 */
export interface ThinkAlikePlayerData {
  isReady: boolean;
  isSpectator: boolean; // true if player is a spectator (3rd+ player)
  wins: number;        // Total games won
  totalGames: number;  // Total games played
}

/**
 * Default settings for new games
 */
export const DEFAULT_SETTINGS: ThinkAlikeSettings = {
  timerDuration: 60,
  maxLives: 5,
  voiceMode: false,
};

/**
 * Helper to initialize a new game state
 */
export function createInitialGameState(settings: ThinkAlikeSettings): ThinkAlikeGameState {
  return {
    phase: 'lobby',
    currentRound: 0,
    maxRounds: 999,  // Not enforced, just for tracking
    livesRemaining: settings.maxLives,
    maxLives: settings.maxLives,
    timeRemaining: settings.timerDuration,
    timerStartedAt: null,
    player1Word: null,
    player2Word: null,
    player1Submitted: false,
    player2Submitted: false,
    player1LiveWord: null,  // For spectators to see real-time typing
    player2LiveWord: null,
    player1Id: null,    // Set when game starts - stable ID for game logic
    player2Id: null,
    player1Name: null,  // Set when game starts - for display only
    player2Name: null,
    rounds: [],
    settings: settings,
  };
}

/**
 * Helper to initialize player data
 */
export function createInitialPlayerData(): ThinkAlikePlayerData {
  return {
    isReady: false,
    isSpectator: false, // Will be set to true if 3+ players join
    wins: 0,
    totalGames: 0,
  };
}
