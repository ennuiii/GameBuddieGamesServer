/**
 * Canvas Chaos - Validation Schemas
 */

import { z } from 'zod';

// ============================================================================
// MODE SELECTION
// ============================================================================

export const selectModeSchema = z.object({
  mode: z.enum(['freeze-frame', 'artistic-diff', 'evolution']),
});

// ============================================================================
// DRAWING SUBMISSION
// ============================================================================

export const submitDrawingSchema = z.object({
  // Max 5MB base64 (~3.75MB raw image) - prevents DOS via huge payloads
  imageData: z.string().min(1, 'Drawing data is required').max(5242880, 'Image data too large'),
});

// ============================================================================
// FREEZE FRAME
// ============================================================================

export const captureFrameSchema = z.object({
  // Max 5MB base64 - prevents DOS via huge payloads
  frameData: z.string().min(1, 'Frame data is required').max(5242880, 'Frame data too large'),
  targetPlayerId: z.string().min(1, 'Target player ID is required'),
});

// ============================================================================
// VOTING
// ============================================================================

export const submitVoteSchema = z.object({
  targetId: z.string().min(1, 'Vote target is required'),
});

export const submitModifierGuessSchema = z.object({
  artistId: z.string().min(1, 'Artist ID is required'),
  modifierGuess: z.string().min(1, 'Modifier guess is required'),
});

// ============================================================================
// EVOLUTION
// ============================================================================

export const submitNameSchema = z.object({
  name: z.string().min(1, 'Name is required').max(50, 'Name too long'),
});

export const voteMutationSchema = z.object({
  stageNumber: z.number().int().min(0),
});

export const voteNameSchema = z.object({
  submitterId: z.string().min(1, 'Submitter ID is required'),
});

// ============================================================================
// PROMPT SUBMISSION
// ============================================================================

export const submitPromptSchema = z.object({
  prompt: z.string().min(3, 'Prompt too short').max(100, 'Prompt too long'),
  modifier: z.string().min(3, 'Modifier too short').max(50, 'Modifier too long').optional(),
});

// ============================================================================
// ROUND CONTROL
// ============================================================================

// Host-only: start next round (no data required, auth handled by handler)
export const roundNextSchema = z.object({}).optional();

// ============================================================================
// SETTINGS
// ============================================================================

export const updateSettingsSchema = z.object({
  defaultMode: z.enum(['freeze-frame', 'artistic-diff', 'evolution']).optional(),
  roundsPerGame: z.number().int().min(1).max(10).optional(),
  useDatabasePrompts: z.boolean().optional(),
  promptSubmissionTime: z.number().int().min(15).max(60).optional(),
  drawingTime: z.number().int().min(15).max(120).optional(),
  votingTime: z.number().int().min(10).max(60).optional(),
  freezeFramePrompts: z.boolean().optional(),
  modifierDifficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  mutationTime: z.number().int().min(10).max(60).optional(),
  originTime: z.number().int().min(15).max(60).optional(),
  useMutationPrompts: z.boolean().optional(),
});
