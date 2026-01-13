/**
 * Bluffalo Game Types
 * A Fibbage-style trivia deception game
 */

// ============================================================================
// GAME PHASES
// ============================================================================

export type BluffaloPhase =
  | 'lobby'            // Waiting for players, host configuring settings
  | 'question_display' // Question revealed, answer hidden (brief suspense)
  | 'lie_input'        // Players submit fake believable answers
  | 'voting'           // All answers shuffled, players vote for "truth"
  | 'reveal'           // Animated reveal of correct answer + who voted what
  | 'scores'           // Round summary showing point changes
  | 'game_over';       // Final results and winner announcement

// ============================================================================
// QUESTION TYPES
// ============================================================================

export interface Question {
  id: string;
  category: QuestionCategory;
  text: string;              // The trivia question
  correctAnswer: string;     // The real answer
  difficulty: 'easy' | 'medium' | 'hard';
}

export type QuestionCategory =
  | 'history'
  | 'science'
  | 'geography'
  | 'entertainment'
  | 'sports'
  | 'food'
  | 'weird'
  | 'random';

export const CATEGORY_INFO: Record<QuestionCategory, { name: string; icon: string }> = {
  history: { name: 'History', icon: '📜' },
  science: { name: 'Science', icon: '🔬' },
  geography: { name: 'Geography', icon: '🌍' },
  entertainment: { name: 'Entertainment', icon: '🎬' },
  sports: { name: 'Sports', icon: '⚽' },
  food: { name: 'Food & Drink', icon: '🍕' },
  weird: { name: 'Weird Facts', icon: '🤪' },
  random: { name: 'Random', icon: '🎲' }
};

// ============================================================================
// LIE & VOTING TYPES
// ============================================================================

export interface SubmittedLie {
  playerId: string;          // Stable player ID (not socket ID)
  playerName: string;
  text: string;              // The fake answer
  normalizedText: string;    // Lowercase, trimmed for duplicate detection
}

export interface VotingOption {
  id: string;                // Unique ID for this option
  text: string;              // Display text
  isCorrect: boolean;        // True if this is the real answer
  authorId: string | null;   // Player ID if lie, null if correct answer
  authorName: string | null; // Player name if lie
  votes: string[];           // Player IDs who voted for this
}

// ============================================================================
// ROUND RESULTS
// ============================================================================

export interface ScoreEvent {
  playerId: string;
  playerName: string;
  points: number;
  reason: string;  // e.g., "Correct answer!", "Fooled Player1!"
}

export interface RoundResult {
  roundNumber: number;
  question: Question;
  correctAnswer: string;
  options: VotingOption[];
  scoreEvents: ScoreEvent[];
}

// ============================================================================
// GAME STATE (stored in room.gameState.data)
// ============================================================================

export interface BluffaloGameState {
  phase: BluffaloPhase;
  currentRound: number;
  totalRounds: number;

  // Current question
  currentQuestion: Question | null;

  // Lies submitted this round (before voting)
  submittedLies: SubmittedLie[];

  // Shuffled voting options (lies + correct answer, randomized)
  votingOptions: VotingOption[];

  // Timer state
  timeRemaining: number;      // Seconds remaining in current phase
  phaseStartedAt: number | null;  // Timestamp when current phase started

  // History
  roundResults: RoundResult[];

  // Used question IDs to prevent repeats within game
  usedQuestionIds: string[];

  // Settings
  settings: BluffaloSettings;
}

// ============================================================================
// PLAYER DATA (stored in player.gameData)
// ============================================================================

export interface BluffaloPlayerData {
  isReady: boolean;
  score: number;

  // Current round state
  currentLie: string | null;       // Their submitted lie this round
  hasSubmittedLie: boolean;
  currentVote: string | null;      // VotingOption ID they voted for
  hasVoted: boolean;

  // Lifetime stats for final results
  liesFooledCount: number;         // How many times their lies fooled others
  correctVotesCount: number;       // How many times they picked correct answer
  timesDeceivedCount: number;      // How many times they were fooled by lies
}

// ============================================================================
// SETTINGS
// ============================================================================

export interface BluffaloSettings {
  totalRounds: number;             // 3-10 rounds
  lieInputTime: number;            // Seconds for submitting lies (30-90)
  votingTime: number;              // Seconds for voting (30-60)
  revealTime: number;              // Seconds to show reveal (8-15)
  category: QuestionCategory;      // Question category filter ('random' = all)
  pointsForCorrect: number;        // Points for voting correctly (default 500)
  pointsPerFool: number;           // Points per player fooled (default 100)
}

// ============================================================================
// DEFAULTS & FACTORY FUNCTIONS
// ============================================================================

export const DEFAULT_SETTINGS: BluffaloSettings = {
  totalRounds: 5,
  lieInputTime: 45,
  votingTime: 30,
  revealTime: 10,
  category: 'random',
  pointsForCorrect: 500,
  pointsPerFool: 100
};

export function createInitialGameState(settings: BluffaloSettings): BluffaloGameState {
  return {
    phase: 'lobby',
    currentRound: 0,
    totalRounds: settings.totalRounds,
    currentQuestion: null,
    submittedLies: [],
    votingOptions: [],
    timeRemaining: 0,
    phaseStartedAt: null,
    roundResults: [],
    usedQuestionIds: [],
    settings
  };
}

export function createInitialPlayerData(): BluffaloPlayerData {
  return {
    isReady: false,
    score: 0,
    currentLie: null,
    hasSubmittedLie: false,
    currentVote: null,
    hasVoted: false,
    liesFooledCount: 0,
    correctVotesCount: 0,
    timesDeceivedCount: 0
  };
}

export function resetPlayerForNewRound(playerData: BluffaloPlayerData): void {
  playerData.currentLie = null;
  playerData.hasSubmittedLie = false;
  playerData.currentVote = null;
  playerData.hasVoted = false;
}
