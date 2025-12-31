/**
 * Template Game Types
 */

export type GamePhase = 'lobby' | 'playing' | 'ended';
export type GameMode = 'classic' | 'teams';

export interface Team {
  id: string;
  name: string;
  color: string;
  playerIds: string[];
  score: number;
}

export interface TemplateSettings {
  maxRounds: number;
  timeLimit: number;
  gameMode: GameMode;
}

export interface TemplateGameState {
  phase: GamePhase;
  currentRound: number;
  customData: any; // Placeholder for game-specific data
  settings: TemplateSettings;
  teams: Team[];
}

export interface TemplatePlayerData {
  isReady: boolean;
  score: number;
}

export const DEFAULT_SETTINGS: TemplateSettings = {
  maxRounds: 5,
  timeLimit: 60,
  gameMode: 'classic'
};

export const DEFAULT_TEAMS: Team[] = [
  { id: 'red', name: 'Team Red', color: '#ef4444', playerIds: [], score: 0 },
  { id: 'blue', name: 'Team Blue', color: '#3b82f6', playerIds: [], score: 0 }
];

export function createInitialGameState(settings: TemplateSettings): TemplateGameState {
  return {
    phase: 'lobby',
    currentRound: 0,
    customData: {},
    settings,
    teams: settings.gameMode === 'teams' ? JSON.parse(JSON.stringify(DEFAULT_TEAMS)) : []
  };
}

export function createInitialPlayerData(): TemplatePlayerData {
  return {
    isReady: false,
    score: 0
  };
}
