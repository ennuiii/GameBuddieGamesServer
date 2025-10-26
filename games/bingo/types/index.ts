// ========================================
// BingoBuddies Game-Specific Types
// ========================================
// These types extend the core unified server types
// and define BingoBuddies-specific game state

export type BingoGamePhase = 'lobby' | 'input' | 'review' | 'playing' | 'finished';

export interface BingoCard {
  id: string;
  playerId: string;
  playerName: string;
  size: 2 | 3 | 4 | 5;
  items: string[];
  markedItems: boolean[];
  isComplete: boolean;
}

export interface BingoSettings {
  cardSize: 2 | 3 | 4 | 5;
  allowSpectators: boolean;
  autoStart: boolean;
}

// This is what gets stored in room.gameState.data
export interface BingoGameState {
  bingoCards: BingoCard[];
  currentDrawnItems: string[];
  winners: string[]; // Array of player IDs
  startedAt?: number;
  inputPhaseClosedAt?: number;
}

// For extending the core Player type with game-specific data
// BingoBuddies doesn't need much player-specific data since cards are in gameState
export interface BingoPlayerData {
  isSpectator?: boolean;
  lastActivity?: number;
}

// Default settings
export const DEFAULT_BINGO_SETTINGS: BingoSettings = {
  cardSize: 3,
  allowSpectators: true,
  autoStart: false,
};

// Helper function to initialize empty game state
export function createInitialGameState(): BingoGameState {
  return {
    bingoCards: [],
    currentDrawnItems: [],
    winners: [],
  };
}

// Helper function to initialize player data
export function createInitialPlayerData(): BingoPlayerData {
  return {
    isSpectator: false,
    lastActivity: Date.now(),
  };
}

// Helper function to check if a bingo card has a winning pattern
export function checkBingoWin(card: BingoCard): boolean {
  const { size, markedItems } = card;

  // Check rows
  for (let row = 0; row < size; row++) {
    let rowComplete = true;
    for (let col = 0; col < size; col++) {
      if (!markedItems[row * size + col]) {
        rowComplete = false;
        break;
      }
    }
    if (rowComplete) return true;
  }

  // Check columns
  for (let col = 0; col < size; col++) {
    let colComplete = true;
    for (let row = 0; row < size; row++) {
      if (!markedItems[row * size + col]) {
        colComplete = false;
        break;
      }
    }
    if (colComplete) return true;
  }

  // Check diagonals
  let diagonal1Complete = true;
  let diagonal2Complete = true;
  for (let i = 0; i < size; i++) {
    if (!markedItems[i * size + i]) diagonal1Complete = false;
    if (!markedItems[i * size + (size - 1 - i)]) diagonal2Complete = false;
  }
  if (diagonal1Complete || diagonal2Complete) return true;

  return false;
}
