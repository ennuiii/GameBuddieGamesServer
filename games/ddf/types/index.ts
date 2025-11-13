/**
 * DDF Game Type Definitions
 *
 * Comprehensive type system for the DDF (Dumb/Die/Final) game
 * Includes game state, player data, questions, answers, and voting
 */

// ============================================================================
// Main Game State Interface
// ============================================================================

export interface DDFGameState {
  /**
   * Current phase of the game
   * - lobby: Waiting for game to start
   * - playing: Players answering questions
   * - voting: Players voting on dumbest answer
   * - tie-breaking: GM breaking tie between players
   * - finale: 2 remaining players answer 10 questions
   * - finished: Game complete, showing winner
   */
  phase: 'lobby' | 'playing' | 'voting' | 'tie-breaking' | 'finale' | 'finished';

  /**
   * Gamemaster information
   */
  gamemaster: {
    id: string;
    name: string;
    isDisconnected?: boolean;
    disconnectedAt?: number;
  } | null;

  /**
   * Current question being asked
   */
  currentQuestion: DDFQuestion | null;

  /**
   * Which player is being asked the current question
   */
  targetPlayerId: string | null;

  /**
   * Index in player list for round-robin assignment
   */
  currentPlayerIndex: number;

  /**
   * Answers submitted in current round
   */
  roundAnswers: RoundAnswer[];

  /**
   * Answers from previous round (for voting display)
   */
  previousRoundAnswers?: RoundAnswer[];

  /**
   * Votes submitted in voting phase
   * Key: voter socket ID, Value: voted player socket ID
   */
  votes: Record<string, string>;

  /**
   * Voting status per player
   * Tracks who voted, who they voted for, skip status
   */
  votingStatus?: Record<string, VotingStatus>;

  /**
   * Current round number
   */
  roundNumber: number;

  /**
   * Whether to show question text to players during voting
   */
  showQuestionsToPlayers: boolean;

  /**
   * Index of current question in selected questions
   */
  questionIndex: number;

  /**
   * Are we in finale mode (2 players left)
   */
  isFinale: boolean;

  /**
   * Finale state progression
   * - waiting: Waiting for both players to answer all 10
   * - answering: Players answering finale questions
   * - evaluating: GM evaluating answers
   * - all-questions-complete: All 10 questions evaluated
   * - complete: Winner determined
   */
  finaleState: 'waiting' | 'answering' | 'evaluating' | 'all-questions-complete' | 'complete';

  /**
   * Current finale question being evaluated
   */
  finaleCurrentQuestion: DDFQuestion | null;

  /**
   * Answers submitted for all finale questions
   */
  finaleCurrentAnswers: FinaleAnswer[];

  /**
   * Finale scores per player (correct answers count)
   */
  finaleScores: Record<string, number>;

  /**
   * The 10 locked finale questions (same for both finalists)
   */
  finaleQuestions?: DDFQuestion[];

  /**
   * Evaluations for finale questions
   */
  finaleEvaluations: any[];

  /**
   * Questions already used (to prevent repeats)
   */
  usedQuestions: string[];

  /**
   * Current finale question index (for tracking progression)
   */
  finaleQuestionIndex?: number;

  /**
   * Selected question categories
   */
  selectedCategories: string[];

  /**
   * Winner of the game (set at end)
   */
  winner?: {
    id: string;
    name: string;
    score?: number;
  };

  /**
   * Timer for current phase
   */
  timer: Timer;

  /**
   * Whether the current round has been started (timer activated for first time)
   * Used to show "Start Round" vs "Pause/Resume" in GM UI
   */
  roundStarted: boolean;

  /**
   * Shot clock (additional timer for quick decisions)
   */
  shotClock: {
    enabled: boolean;
    duration: number;
  };

  /**
   * Game settings
   */
  settings: {
    roundDuration: number;
    shotClockEnabled: boolean;
    shotClockDuration: number;
  };

  /**
   * Whether we're in second voting round (tie-breaker)
   */
  isSecondVotingRound?: boolean;

  /**
   * Players tied for elimination
   */
  tiedPlayerIds?: string[];
}

// ============================================================================
// Player Data Interface
// ============================================================================

export interface DDFPlayerData {
  /**
   * Number of lives remaining
   * Starts at 3, decreases with wrong answers or votes
   */
  lives: number;

  /**
   * Whether player has been eliminated from game
   */
  isEliminated: boolean;

  /**
   * Whether this player is the gamemaster (DDF host who asks questions)
   * Gamemasters are kept in room.players but filtered from player list UI
   */
  isGamemaster?: boolean;

  /**
   * Whether player is currently disconnected
   */
  isDisconnected?: boolean;

  /**
   * Timestamp when player disconnected
   */
  disconnectedAt?: number;

  /**
   * Media state (mic on/off)
   */
  mediaState?: {
    isMicOn: boolean;
    lastUpdated: number;
  };
}

// ============================================================================
// Question Interface
// ============================================================================

export interface DDFQuestion {
  id: string;
  type: string; // 'normal', etc
  question: string;
  answer: string;
  category?: string;
  difficulty?: string;
  isBad?: boolean;
  badMarkCount?: number;
}

// ============================================================================
// Round Answer Interface
// ============================================================================

export interface RoundAnswer {
  playerId: string;
  playerName: string;
  questionText: string;
  expectedAnswer: string;
  answerSummary: string;
  rating: 'correct' | 'incorrect' | 'no-answer' | 'too-late';
  timestamp: string;
  questionId: string;
}

// ============================================================================
// Timer Interface
// ============================================================================

export interface Timer {
  isActive: boolean;
  time: number; // Seconds remaining
  duration: number; // Total duration in seconds
}

// ============================================================================
// Finale Answer Interface
// ============================================================================

export interface FinaleAnswer {
  playerId: string;
  questionId: string;
  answer: string;
  timestamp: number;
}

// ============================================================================
// Voting Status Interface
// ============================================================================

export interface VotingStatus {
  hasVoted: boolean;
  votedFor: string | null;
  voterName: string;
  votedForName: string | null;
  isGMSkipped?: boolean;
}

// ============================================================================
// Event Data Interfaces
// ============================================================================

export interface GameStateUpdate {
  room: any; // Serialized room
}

export interface TimerUpdate {
  time: number;
  isActive: boolean;
}

export interface VotingStarted {
  room: any;
  roundAnswers: RoundAnswer[];
  previousRoundAnswers?: RoundAnswer[];
}

export interface RoundResult {
  room: any;
  votingResults: {
    votes: Record<string, string>;
    playerVoteCounts: Record<string, number>;
    selectedPlayerId: string;
    tiedPlayerIds?: string[];
  };
}

export interface QuestionMarkedBad {
  questionId: string;
  badMarkCount: number;
}

export interface FinaleProgress {
  playerId: string;
  questionId: string;
  answeredCount: number;
  totalQuestions: number;
}

export interface FinaleEvaluation {
  questionId: string;
  evaluations: {
    playerId: string;
    playerName: string;
    answer: string;
    isCorrect: boolean;
  }[];
}

export interface FinaleComplete {
  room: any;
  scores: Record<string, number>;
  winner: {
    id: string;
    name: string;
    score: number;
  };
}

export interface ScrollSyncBroadcast {
  scrollPosition: number;
}

export interface ClosingResultsBroadcast {
  action: 'closing';
}

export interface ReturnToBroadcast {
  message: string;
}
