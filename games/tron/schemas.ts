import { z } from 'zod';

// Schema for 'player:ready' event
export const playerReadySchema = z.object({
  ready: z.boolean(),
});

// Schema for 'game:start' event
export const gameStartSchema = z.object({});

// Schema for direction change (supports both TurnDir numbers and legacy string format)
export const directionChangeSchema = z.object({
  direction: z.union([
    z.literal(-1),      // Turn left
    z.literal(1),       // Turn right
    z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT']),  // Legacy string format
  ]),
  messageId: z.number().optional(),
});

// Schema for settings update
export const settingsUpdateSchema = z.object({
  arenaSize: z.union([z.literal(50), z.literal(75), z.literal(100), z.literal(500), z.literal(1000)]).optional(),
  gameSpeed: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  roundsToWin: z.union([z.literal(1), z.literal(3), z.literal(5)]).optional(),
});

// Type extraction from schemas
export type PlayerReadyData = z.infer<typeof playerReadySchema>;
export type GameStartData = z.infer<typeof gameStartSchema>;
export type DirectionChangeData = z.infer<typeof directionChangeSchema>;
export type SettingsUpdateData = z.infer<typeof settingsUpdateSchema>;
