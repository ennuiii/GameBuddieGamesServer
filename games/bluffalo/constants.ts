/**
 * Bluffalo Game Constants
 */

// ============================================================================
// TIMING (milliseconds unless noted)
// ============================================================================

/** Brief pause to show question before lie input (ms) */
export const QUESTION_DISPLAY_DURATION_MS = 3000;

/** Time for lie input phase (seconds) - configurable in settings */
export const DEFAULT_LIE_INPUT_TIME_SECONDS = 45;
export const MIN_LIE_INPUT_TIME_SECONDS = 30;
export const MAX_LIE_INPUT_TIME_SECONDS = 90;

/** Time for voting phase (seconds) - configurable in settings */
export const DEFAULT_VOTING_TIME_SECONDS = 30;
export const MIN_VOTING_TIME_SECONDS = 20;
export const MAX_VOTING_TIME_SECONDS = 60;

/** Time for reveal phase (seconds) */
export const DEFAULT_REVEAL_TIME_SECONDS = 10;
export const MIN_REVEAL_TIME_SECONDS = 8;
export const MAX_REVEAL_TIME_SECONDS = 15;

/** Time for scores phase before next round (seconds) */
export const SCORES_DISPLAY_DURATION_SECONDS = 5;

/** Timer broadcast interval (ms) */
export const TIMER_UPDATE_INTERVAL_MS = 1000;

// ============================================================================
// SCORING
// ============================================================================

/** Points for correctly identifying the real answer */
export const DEFAULT_POINTS_FOR_CORRECT = 500;
export const MIN_POINTS_FOR_CORRECT = 100;
export const MAX_POINTS_FOR_CORRECT = 1000;

/** Points earned for each player fooled by your lie */
export const DEFAULT_POINTS_PER_FOOL = 100;
export const MIN_POINTS_PER_FOOL = 50;
export const MAX_POINTS_PER_FOOL = 500;

// ============================================================================
// GAME LIMITS
// ============================================================================

/** Round limits */
export const DEFAULT_TOTAL_ROUNDS = 5;
export const MIN_TOTAL_ROUNDS = 3;
export const MAX_TOTAL_ROUNDS = 10;

/** Player limits */
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;

/** Answer character limits */
export const MIN_LIE_LENGTH = 1;
export const MAX_LIE_LENGTH = 100;

// ============================================================================
// DUPLICATE DETECTION
// ============================================================================

/** Characters to strip when normalizing lies for duplicate detection */
export const NORMALIZE_STRIP_CHARS = /[^a-z0-9\s]/g;

/** Minimum similarity ratio to consider a lie "too similar" to correct answer */
export const SIMILARITY_THRESHOLD = 0.85;
