/**
 * Constants for ThinkAlike game plugin
 * Centralizing magic numbers for maintainability and consistency
 */

// ============================================================================
// PLAYER LIMITS
// ============================================================================
/** Maximum players allowed (2 active players + unlimited spectators) */
export const MAX_PLAYERS = 999;
/** Minimum players required to start a game */
export const MIN_PLAYERS = 2;

// ============================================================================
// TIMING CONSTANTS
// ============================================================================
/** Duration of the countdown overlay before round starts (matches client) */
export const COUNTDOWN_DURATION_MS = 3500;
/** Time to wait for second voice vote before timeout */
export const VOICE_VOTE_TIMEOUT_MS = 30000;
/** State update interval for timer broadcast */
export const TIMER_UPDATE_INTERVAL_MS = 1000;
/** Rate limiting for typing updates (100ms = max 10 updates/second) */
export const TYPING_UPDATE_INTERVAL_MS = 100;

// ============================================================================
// GAME SETTINGS BOUNDS
// ============================================================================
/** Minimum timer duration in seconds */
export const MIN_TIMER_DURATION_SECONDS = 30;
/** Maximum timer duration in seconds */
export const MAX_TIMER_DURATION_SECONDS = 180;
/** Default timer duration in seconds */
export const DEFAULT_TIMER_DURATION_SECONDS = 60;
/** Default number of lives */
export const DEFAULT_MAX_LIVES = 3;

// ============================================================================
// MESSAGE LIMITS
// ============================================================================
/** Maximum chat messages to keep in memory */
export const MAX_STORED_MESSAGES = 100;

// ============================================================================
// INPUT LIMITS
// ============================================================================
/** Maximum word length allowed */
export const MAX_WORD_LENGTH = 50;

// ============================================================================
// PAIRS MODE CONSTANTS
// ============================================================================
/** Minimum players for pairs mode (2v2) */
export const MIN_PLAYERS_PAIRS_MODE = 4;
/** Maximum teams supported (4 teams = 8 players) */
export const MAX_TEAMS = 4;
/** Default points needed to win in pairs mode */
export const DEFAULT_POINTS_TO_WIN = 5;
/** Minimum points to win setting */
export const MIN_POINTS_TO_WIN = 3;
/** Maximum points to win setting */
export const MAX_POINTS_TO_WIN = 10;
