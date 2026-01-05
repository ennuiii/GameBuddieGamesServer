import { GAME_CONFIG } from './constants.js';

// Utility types
export interface GridPos {
  x: number;
  y: number;
}

// Helper to convert grid position to pixel position (center of tile)
export function gridToPixel(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: gridX * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
    y: gridY * GAME_CONFIG.TILE_SIZE + GAME_CONFIG.TILE_SIZE / 2,
  };
}

// Helper to convert pixel position to grid position
export function pixelToGrid(pixelX: number, pixelY: number): { x: number; y: number } {
  return {
    x: Math.floor(pixelX / GAME_CONFIG.TILE_SIZE),
    y: Math.floor(pixelY / GAME_CONFIG.TILE_SIZE),
  };
}

// Generate unique ID
export function generateId(prefix: string, counter: number): string {
  return `${prefix}_${counter}`;
}
