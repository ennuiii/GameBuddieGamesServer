import { z } from 'zod';

// Schema for 'player:ready' event
export const playerReadySchema = z.object({
  ready: z.boolean(),
});

// Schema for 'game:start' event (can be an empty object if no data is expected)
export const gameStartSchema = z.object({});

// Schema for a generic 'game:action' event
// This should be customized for a real game's actions
export const gameActionSchema = z.object({
  actionType: z.string(),
  payload: z.any().optional(), // Be more specific in a real game
});

// Type extraction from schemas
export type PlayerReadyData = z.infer<typeof playerReadySchema>;
export type GameStartData = z.infer<typeof gameStartSchema>;
export type GameActionData = z.infer<typeof gameActionSchema>;
