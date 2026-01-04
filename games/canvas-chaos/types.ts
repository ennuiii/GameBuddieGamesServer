/**
 * Canvas Chaos - Type Definitions
 * A party game with multiple drawing-based modes
 */

// ============================================================================
// GAME MODES
// ============================================================================

export type GameMode = 'freeze-frame' | 'artistic-diff' | 'evolution';

export type GamePhase =
  | 'lobby'
  | 'mode-select'
  | 'playing'
  | 'drawing'
  | 'naming'     // Evolution: submit creature names (20s)
  | 'voting'     // Vote on best name (20s)
  | 'reveal'
  | 'results'
  | 'ended';

// ============================================================================
// PLAYER DATA
// ============================================================================

export interface CanvasChaosPlayerData {
  score: number;
  isReady: boolean;
  hasSubmitted: boolean;
  hasVideo: boolean;              // Player has video chat enabled
  currentDrawing: string | null;  // Base64 canvas data
  votedFor: string | null;        // Player ID they voted for
}

// ============================================================================
// GAME STATE
// ============================================================================

export interface CanvasChaosGameState {
  mode: GameMode | null;
  phase: GamePhase;
  round: number;
  totalRounds: number;
  timeRemaining: number;

  // Host-controlled round progression
  awaitingNextRound: boolean;  // True when reveal is done, waiting for host to start next round

  // Mode-specific data
  modeData: FreezeFrameData | ArtisticDiffData | EvolutionData | null;
}

// ============================================================================
// FREEZE FRAME MODE
// ============================================================================

// Common fields for edge case handling
export interface RoundSkipInfo {
  skippedRound?: boolean;         // True if round was skipped due to edge case
  skipReason?: string;            // Reason for skipping (shown to players)
}

export interface FreezeFrameData extends RoundSkipInfo {
  subjectPlayerId: string | null;
  subjectPlayerName: string | null;
  frozenFrame: string | null;     // Base64 image from video
  prompt: string | null;
  submissions: Map<string, DrawingSubmission>;
  votes: Map<string, string>;     // voterId -> submissionPlayerId
  subjectHistory: string[];       // Player IDs who have been subjects
  subjectDisconnected?: boolean;  // True if subject disconnected during capture
}

export interface DrawingSubmission {
  playerId: string;
  playerName: string;
  imageData: string;              // Base64 canvas
  timestamp: number;
}

// ============================================================================
// ARTISTIC DIFFERENCES MODE
// Everyone draws the same prompt, but one player has a secret modifier.
// After drawing, everyone votes to find the "imposter" with the modifier.
// ============================================================================

export interface ArtisticDiffData extends RoundSkipInfo {
  prompt: string | null;
  modifier: string | null;        // Secret modifier (e.g., "but it's on fire")
  modifierPlayerId: string | null;  // The one player who has the modifier
  modifierPlayerName: string | null; // Name of modifier player (for reveal)
  submissions: Map<string, DrawingSubmission>;  // All connected players submit
  votes: Map<string, string>;     // voterId -> guessed modifierPlayerId
  usedModifierPlayers: string[];  // Player IDs who have been the modifier player
}

// ============================================================================
// EVOLUTION MODE
// ============================================================================

export interface EvolutionData extends RoundSkipInfo {
  chain: EvolutionChain;
  currentArtistId: string | null;
  currentArtistName: string | null;
  stageNumber: number;
  mutationPrompt: string | null;
  nameSubmissions: Map<string, string>;   // playerId -> suggested name
  votes: {
    bestMutation: Map<string, number>;    // voterId -> stageNumber
    bestName: Map<string, string>;        // voterId -> nameSubmitterId
  };
}

export interface EvolutionChain {
  id: string;
  layers: EvolutionLayer[];
  mutationOrder: string[];        // Player IDs in order
  finalName: string | null;
}

export interface EvolutionLayer {
  stageNumber: number;
  artistId: string;
  artistName: string;
  canvasData: string;             // Base64 PNG with transparency
  timestamp: number;
}

// ============================================================================
// SETTINGS
// ============================================================================

export interface CanvasChaosSettings {
  // General
  defaultMode: GameMode;
  roundsPerGame: number;

  // Drawing
  drawingTime: number;            // Seconds

  // Voting
  votingTime: number;             // Seconds

  // Freeze Frame
  freezeFramePrompts: boolean;    // Show prompts or free draw

  // Artistic Differences
  modifierDifficulty: 'easy' | 'medium' | 'hard';

  // Evolution
  mutationTime: number;           // Seconds per mutation
  originTime: number;             // Seconds for origin creature
  useMutationPrompts: boolean;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

export function createInitialGameState(): CanvasChaosGameState {
  return {
    mode: null,
    phase: 'lobby',
    round: 0,
    totalRounds: 3,
    timeRemaining: 0,
    awaitingNextRound: false,
    modeData: null,
  };
}

export function createInitialPlayerData(): CanvasChaosPlayerData {
  return {
    score: 0,
    isReady: false,
    hasSubmitted: false,
    hasVideo: false,
    currentDrawing: null,
    votedFor: null,
  };
}

export function createFreezeFrameData(): FreezeFrameData {
  return {
    subjectPlayerId: null,
    subjectPlayerName: null,
    frozenFrame: null,
    prompt: null,
    submissions: new Map(),
    votes: new Map(),
    subjectHistory: [],
  };
}

export function createArtisticDiffData(): ArtisticDiffData {
  return {
    prompt: null,
    modifier: null,
    modifierPlayerId: null,
    modifierPlayerName: null,
    submissions: new Map(),
    votes: new Map(),
    usedModifierPlayers: [],
  };
}

export function createEvolutionData(): EvolutionData {
  return {
    chain: {
      id: crypto.randomUUID(),
      layers: [],
      mutationOrder: [],
      finalName: null,
    },
    currentArtistId: null,
    currentArtistName: null,
    stageNumber: 0,
    mutationPrompt: null,
    nameSubmissions: new Map(),
    votes: {
      bestMutation: new Map(),
      bestName: new Map(),
    },
  };
}
