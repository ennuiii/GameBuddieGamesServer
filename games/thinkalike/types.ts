/**
 * ThinkAlike Game Types
 *
 * Server-side type definitions for the ThinkAlike game.
 * Supports two modes:
 * - Classic: 1v1 word synchronization where players share 5 lives
 * - Pairs: Multiple teams of 2 race to sync words (2v2, 2v2v2, 2v2v2v2)
 */

/**
 * Game modes
 */
export type GameMode = 'classic' | 'pairs';

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
 * Team structure for pairs mode
 */
export interface Team {
  id: string;           // e.g., 'team-red', 'team-blue'
  name: string;         // e.g., 'Team Red', 'Team Blue'
  color: string;        // Hex color e.g., '#FF6B6B'
  player1: TeamPlayer | null;
  player2: TeamPlayer | null;
  score: number;        // Points earned from winning rounds
  matched: boolean;     // Did this team match in current round?
}

/**
 * Player slot within a team
 */
export interface TeamPlayer {
  id: string;           // Player ID (stable across reconnections)
  name: string;         // Display name
  word: string | null;  // Submitted word
  liveWord: string | null;  // Real-time typing (for spectators)
  submitted: boolean;   // Has submitted final word
}

/**
 * Main game state stored in Room.gameState.data
 */
export interface ThinkAlikeGameState {
  // Game mode
  gameMode: GameMode;

  // Game phase and timing
  phase: GamePhase;
  currentRound: number;
  maxRounds: number;  // Not used for victory, but tracks round count

  // Lives system (shared between all players/teams)
  livesRemaining: number;
  maxLives: number;

  // Timer
  timeRemaining: number;  // Seconds
  timerStartedAt: number | null;  // Timestamp when timer started

  // === CLASSIC MODE DATA (1v1) ===
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

  // === PAIRS MODE DATA (2v2, 2v2v2, etc.) ===
  teams: Team[];
  winningTeamId: string | null;  // Set when a team wins the round
  pointsToWin: number;           // First team to reach this score wins game

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
  gameMode: GameMode;     // 'classic' (1v1) or 'pairs' (2v2, 2v2v2, etc.)
  timerDuration: number;  // Seconds per round (default: 60)
  maxLives: number;       // Shared lives pool (default: 5)
  voiceMode: boolean;     // Players say words aloud instead of typing (default: false)
  pointsToWin: number;    // Points needed to win in pairs mode (default: 5)
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
  gameMode: 'classic',
  timerDuration: 60,
  maxLives: 5,
  voiceMode: false,
  pointsToWin: 5,
};

/**
 * Helper to initialize a new game state
 */
export function createInitialGameState(settings: ThinkAlikeSettings): ThinkAlikeGameState {
  return {
    gameMode: settings.gameMode,
    phase: 'lobby',
    currentRound: 0,
    maxRounds: 999,  // Not enforced, just for tracking
    livesRemaining: settings.maxLives,
    maxLives: settings.maxLives,
    timeRemaining: settings.timerDuration,
    timerStartedAt: null,
    // Classic mode fields
    player1Word: null,
    player2Word: null,
    player1Submitted: false,
    player2Submitted: false,
    player1LiveWord: null,
    player2LiveWord: null,
    player1Id: null,
    player2Id: null,
    player1Name: null,
    player2Name: null,
    // Pairs mode fields
    teams: [],
    winningTeamId: null,
    pointsToWin: settings.pointsToWin,
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

/**
 * Team preset configurations
 */
export const TEAM_PRESETS = [
  { id: 'team-red', name: 'Team Red', color: '#FF6B6B' },
  { id: 'team-blue', name: 'Team Blue', color: '#4ECDC4' },
  { id: 'team-green', name: 'Team Green', color: '#95E77E' },
  { id: 'team-yellow', name: 'Team Yellow', color: '#FFE66D' },
] as const;

/**
 * Helper to create a new team
 */
export function createTeam(presetIndex: number): Team {
  const preset = TEAM_PRESETS[presetIndex % TEAM_PRESETS.length];
  return {
    id: preset.id,
    name: preset.name,
    color: preset.color,
    player1: null,
    player2: null,
    score: 0,
    matched: false,
  };
}

/**
 * Helper to create a team player slot
 */
export function createTeamPlayer(playerId: string, playerName: string): TeamPlayer {
  return {
    id: playerId,
    name: playerName,
    word: null,
    liveWord: null,
    submitted: false,
  };
}

/**
 * Helper to reset all teams for a new round
 */
export function resetTeamsForNewRound(teams: Team[]): void {
  for (const team of teams) {
    team.matched = false;
    if (team.player1) {
      team.player1.word = null;
      team.player1.liveWord = null;
      team.player1.submitted = false;
    }
    if (team.player2) {
      team.player2.word = null;
      team.player2.liveWord = null;
      team.player2.submitted = false;
    }
  }
}
