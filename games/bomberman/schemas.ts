import { z } from 'zod';

// Schema for 'player:ready' event
export const playerReadySchema = z.object({
  ready: z.boolean(),
});

// Schema for 'game:start' event
export const gameStartSchema = z.object({});

// Schema for player movement
export const playerMoveSchema = z.object({
  x: z.number(),
  y: z.number(),
});

// Schema for placing a bomb
export const playerPlaceBombSchema = z.object({});

// Schema for throwing a bomb
export const playerThrowBombSchema = z.object({
  direction: z.enum(['up', 'down', 'left', 'right']),
});

// Schema for picking up a bomb (no params needed)
export const playerPickupBombSchema = z.object({});