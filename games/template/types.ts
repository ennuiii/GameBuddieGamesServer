/**
 * Template Game Types
 */

export type GamePhase = 'lobby' | 'playing' | 'ended';

export interface TemplateSettings {
  maxRounds: number;
  timeLimit: number;
}

export interface TemplateGameState {
  phase: GamePhase;
  currentRound: number;
  customData: any; // Placeholder for game-specific data
  settings: TemplateSettings;
}

export interface TemplatePlayerData {
  isReady: boolean;
  score: number;
}

export const DEFAULT_SETTINGS: TemplateSettings = {
  maxRounds: 5,
  timeLimit: 60
};

export function createInitialGameState(settings: TemplateSettings): TemplateGameState {
  return {
    phase: 'lobby',
    currentRound: 0,
    customData: {},
    settings
  };
}

export function createInitialPlayerData(): TemplatePlayerData {
  return {
    isReady: false,
    score: 0
  };
}
