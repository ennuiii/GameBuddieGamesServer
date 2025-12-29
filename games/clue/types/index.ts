// ========================================
// ClueScale Game-Specific Types
// ========================================
// These types extend the core unified server types
// and define ClueScale-specific game state

export type ClueGamePhase =
  | 'lobby'
  | 'round_clue'
  | 'round_guess'
  | 'round_reveal'
  | 'finished';

export type PlayerRole = 'NUMBER_PICKER' | 'CLUE_GIVER' | 'GUESSER' | 'SPECTATOR';

// Team mode types
export type GameMode = 'classic' | 'teams';

export interface TeamPlayer {
  id: string;
  name: string;
}

export interface Team {
  id: string;
  name: string;
  color: string;
  playerIds: string[];
  score: number;
}

// Team presets with distinct, accessible colors
export const TEAM_PRESETS = [
  { name: 'Team Red', color: '#ef4444' },
  { name: 'Team Blue', color: '#3b82f6' },
  { name: 'Team Green', color: '#22c55e' },
  { name: 'Team Purple', color: '#a855f7' },
  { name: 'Team Orange', color: '#f97316' },
  { name: 'Team Teal', color: '#14b8a6' },
];

export interface Guess {
  playerId: string; // Player ID
  playerName: string;
  value: number; // The guessed number (1-10 scale)
  submittedAt: number;
  points: number; // Points earned for this guess
}

export interface Round {
  index: number;
  category: string;
  targetNumber: number; // The actual number on the 1-10 scale
  clueWord: string | null; // The clue provided by the clue giver
  numberPickerId: string | null; // Player ID (null when no dedicated number picker)
  clueGiverId: string; // Player ID
  guesses: Guess[];
  clueSubmittedAt?: number;
  clueGiverPoints: number; // Points earned by clue giver this round
}

export interface ClueSettings {
  roundDuration: number; // seconds
  teamBonusEnabled: boolean;
  rotationType: 'circular' | 'random';
  categories: string[];
  // Team mode settings
  gameMode: GameMode;
  totalRounds: number; // Total rounds to play (teams mode)
}

// This is what gets stored in room.gameState.data
export interface ClueGameState {
  round: Round | null;
  roundStartTime: number | null;
  roleQueue: string[]; // Array of player IDs for role rotation
  roundTimer?: NodeJS.Timeout; // Timer for round timeout
  // Team mode state
  teams?: Team[];
  currentTeamIndex?: number; // Which team's turn (0-indexed)
  teamRoundNumber?: number; // Current round number for teams mode
  completedRounds?: number; // How many full rounds completed
}

// For extending the core Player type with game-specific data
export interface CluePlayerData {
  score: number;
  isBackgrounded?: boolean; // Whether player has backgrounded the app
}

// Default categories for ClueScale
export const DEFAULT_CATEGORIES = [
  'Size',
  'Speed',
  'Temperature',
  'Difficulty',
  'Popularity',
  'Age',
  'Distance',
  'Quality',
  'Danger Level',
  'Excitement',
  'Cost',
  'Importance',
  'Brightness',
  'Loudness',
  'Sweetness',
];

// Default settings
export const DEFAULT_CLUE_SETTINGS: ClueSettings = {
  roundDuration: 60,
  teamBonusEnabled: true,
  rotationType: 'circular',
  categories: DEFAULT_CATEGORIES,
  gameMode: 'classic',
  totalRounds: 5,
};
