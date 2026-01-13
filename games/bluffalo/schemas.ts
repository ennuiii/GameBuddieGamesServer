/**
 * Bluffalo Zod Validation Schemas
 */

import { z } from 'zod';
import {
  MIN_LIE_LENGTH,
  MAX_LIE_LENGTH,
  MIN_TOTAL_ROUNDS,
  MAX_TOTAL_ROUNDS,
  MIN_LIE_INPUT_TIME_SECONDS,
  MAX_LIE_INPUT_TIME_SECONDS,
  MIN_VOTING_TIME_SECONDS,
  MAX_VOTING_TIME_SECONDS,
  MIN_POINTS_FOR_CORRECT,
  MAX_POINTS_FOR_CORRECT,
  MIN_POINTS_PER_FOOL,
  MAX_POINTS_PER_FOOL
} from './constants.js';

// ============================================================================
// LOBBY EVENTS
// ============================================================================

/** Schema for 'player:ready' event */
export const playerReadySchema = z.object({
  ready: z.boolean()
});

/** Schema for 'game:start' event */
export const gameStartSchema = z.object({});

/** Schema for 'settings:update' event */
export const settingsUpdateSchema = z.object({
  settings: z.object({
    totalRounds: z.number()
      .min(MIN_TOTAL_ROUNDS)
      .max(MAX_TOTAL_ROUNDS)
      .optional(),
    lieInputTime: z.number()
      .min(MIN_LIE_INPUT_TIME_SECONDS)
      .max(MAX_LIE_INPUT_TIME_SECONDS)
      .optional(),
    votingTime: z.number()
      .min(MIN_VOTING_TIME_SECONDS)
      .max(MAX_VOTING_TIME_SECONDS)
      .optional(),
    category: z.enum([
      'history', 'science', 'geography', 'entertainment',
      'sports', 'food', 'weird', 'random'
    ]).optional(),
    pointsForCorrect: z.number()
      .min(MIN_POINTS_FOR_CORRECT)
      .max(MAX_POINTS_FOR_CORRECT)
      .optional(),
    pointsPerFool: z.number()
      .min(MIN_POINTS_PER_FOOL)
      .max(MAX_POINTS_PER_FOOL)
      .optional()
  })
});

// ============================================================================
// GAME EVENTS
// ============================================================================

/** Schema for 'game:submit-lie' event */
export const submitLieSchema = z.object({
  lie: z.string()
    .min(MIN_LIE_LENGTH, 'Answer cannot be empty')
    .max(MAX_LIE_LENGTH, `Answer too long (max ${MAX_LIE_LENGTH} characters)`)
    .transform(s => s.trim())
});

/** Schema for 'game:vote' event */
export const voteSchema = z.object({
  optionId: z.string().min(1, 'Must select an option')
});

/** Schema for 'game:next-round' event (host only) */
export const nextRoundSchema = z.object({});

/** Schema for 'game:restart' event (host only, returns to lobby) */
export const restartSchema = z.object({});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type PlayerReadyData = z.infer<typeof playerReadySchema>;
export type GameStartData = z.infer<typeof gameStartSchema>;
export type SettingsUpdateData = z.infer<typeof settingsUpdateSchema>;
export type SubmitLieData = z.infer<typeof submitLieSchema>;
export type VoteData = z.infer<typeof voteSchema>;
export type NextRoundData = z.infer<typeof nextRoundSchema>;
export type RestartData = z.infer<typeof restartSchema>;
