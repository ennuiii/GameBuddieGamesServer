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
}

// This is what gets stored in room.gameState.data
export interface ClueGameState {
  round: Round | null;
  roundStartTime: number | null;
  roleQueue: string[]; // Array of player IDs for role rotation
  roundTimer?: NodeJS.Timeout; // Timer for round timeout
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
};
