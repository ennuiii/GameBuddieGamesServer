// WebRTC type declarations
declare global {
  interface MediaStream {}
  interface RTCSessionDescriptionInit {}
  interface RTCIceCandidateInit {}
}

export type GameMode = 'classic' | 'hidden' | 'truth';
export type GamePhase = 'lobby' | 'word-round' | 'voting' | 'reveal' | 'finished' | 'question-round';
export type PlayerRole = 'player' | 'imposter';
export type VoteResult = 'imposter_wins' | 'players_win' | 'no_winner';

export interface Player {
  id: string;
  name: string;
  socketId?: string;
  isGamemaster: boolean;
  isImposter: boolean;
  hasSubmittedWord: boolean;
  hasVoted: boolean;
  votedFor?: string;
  isEliminated: boolean;
  lastSubmittedRound: number;
  // GameBuddies integration
  gameBuddiesPlayerId?: string;
}

export interface WordPair {
  normal: string;
  similar: string;
}

export interface Word {
  text: string;
  isImposterWord?: boolean;
}

export interface TurnData {
  playerId: string;
  playerName: string;
  word: string;
  timestamp: number;
}

export interface VoteData {
  voterId: string;
  voterName: string;
  votedForId: string;
  votedForName: string;
  timestamp: number;
}

export interface RoundResult {
  eliminatedPlayerId?: string;
  eliminatedPlayerName?: string;
  imposterGuess?: string;
  imposterGuessCorrect?: boolean;
  imposterWon?: boolean;
  playersWon?: boolean;
  wordRevealed: string;
  voteCounts: Record<string, number>;
  voteDetails: VoteData[];
}

export interface GameSettings {
  roomCode: string;
  maxPlayers: number;
  turnTimeLimit: number; // seconds
  votingTimeLimit: number; // seconds
  discussionTimeLimit: number; // seconds
  enableVideo: boolean;
  enableAudio: boolean;
  // New settings
  roundsBeforeVoting: number; // How many word rounds before voting (classic mode)
  inputMode: 'text' | 'voice'; // Text input boxes vs voice mode
  gameType: 'online' | 'pass-play'; // Online multiplayer vs pass & play single device
  language?: 'en' | 'de'; // Language for question/word content filtering
}

export interface Question {
  id: string;
  text: string;
  type: 'personal' | 'comparative' | 'hypothetical';
  category?: string;
  imposterHint: string; // What the imposter sees instead of the question
}

export interface AnswerData {
  playerId: string;
  playerName: string;
  answer: string;
  questionId: string;
  questionText: string;
  timestamp: number;
}

export interface SkipRequest {
  playerId: string;
  playerName: string;
  requestedAt: number;
  gamePhase: 'word-round' | 'question-round';
}

export interface SkipControls {
  firstNonImposterId: string | null;
  wordEligiblePlayerIds: string[];
  questionEligiblePlayerIds: string[];
  gamemasterCanSkipPlayer: boolean;
  gamemasterCanSkipPlayerTruth: boolean;
}

export interface Room {
  id: string;
  code: string;
  gamemaster: Player;
  players: Player[];
  gameMode: GameMode;
  gamePhase: GamePhase;
  settings: GameSettings;
  
  // Game state
  currentWord: Word | null;
  currentWordPair: WordPair | null; // Store word pair for hidden mode
  currentQuestion: Question | null;
  answersThisRound: AnswerData[];
  currentTurn: string | null; // Player ID whose turn it is
  turnOrder: string[]; // Array of player IDs
  turnIndex: number;
  currentRound: number; // Track which round we're in (for multiple word rounds)
  wordsThisRound: TurnData[];
  allWordsAllRounds: TurnData[][]; // Store words from all rounds
  allAnswersAllRounds: AnswerData[][]; // Store answers from all rounds (truth mode)
  
  // Pass & Play state
  passPlayCurrentPlayer: number; // Index of player currently viewing (pass & play mode)
  passPlayRevealed: boolean; // Whether current player has seen their word/role
  skipControls: SkipControls;

  // Skip request state (for skip request/approval flow)
  pendingSkipRequest?: SkipRequest;

  // Voting state
  votes: Record<string, string>; // voterId -> votedForId
  votingStartTime?: number;
  discussionTimeRemaining?: number;
  votingTimeRemaining?: number;
  
  // Imposter guess (Classic mode)
  imposterGuess?: string;
  
  // Round results
  currentRoundResult?: RoundResult;
  roundHistory: RoundResult[];
  
  // Timer state
  timer: {
    isActive: boolean;
    timeRemaining: number;
    duration: number;
    type: 'turn' | 'discussion' | 'voting' | null;
  };
  
  // Word management
  usedWords: Set<string>;
  usedQuestions: Set<string>;
  wordPairs: WordPair[];
  
  // GameBuddies integration
  isGameBuddiesRoom?: boolean;
  gameBuddiesData?: {
    roomId: string;
    expectedPlayers?: number;
    returnUrl?: string;
    sessionToken?: string;
    streamerMode?: boolean;
  };
  
  // Timestamps
  createdAt: number;
  gameStartedAt?: number;
  lastActivity: number;
}

export interface GameState {
  // Connection
  socket: any;
  isConnected: boolean;
  
  // Current room
  room: Room | null;
  roomCode: string | null;
  
  // Current player
  currentPlayer: Player | null;
  
  // UI state
  isLoading: boolean;
  error: string | null;
  
  // WebRTC state
  localStream: MediaStream | null;
  remoteStreams: Map<string, MediaStream>;
  videoEnabled: boolean;
  audioEnabled: boolean;
}

// Socket event types
export interface SocketEvents {
  // Room events
  'create-room': (data: { playerName: string; gameMode: GameMode; settings?: Partial<GameSettings> }) => void;
  'join-room': (data: { roomCode: string; playerName: string; gameBuddiesPlayerId?: string }) => void;
  'leave-room': () => void;
  
  // Game events
  'start-game': () => void;
  'submit-word': (data: { word: string }) => void;
  'submit-answer': (data: { answer: string }) => void;
  'submit-vote': (data: { votedForId: string }) => void;
  'submit-imposter-guess': (data: { guess: string }) => void;
  'next-round': () => void;
  'end-game': () => void;
  
  // Pass & Play events
  'reveal-to-current-player': () => void;
  'advance-to-next-player': () => void;
  
  // Voice mode events
  'force-start-voting-voice': () => void;
  
  // Timer events
  'start-timer': (data: { type: 'turn' | 'discussion' | 'voting'; duration: number }) => void;
  'pause-timer': () => void;
  'resume-timer': () => void;
  
  // WebRTC events
  'webrtc-offer': (data: { targetId: string; offer: RTCSessionDescriptionInit }) => void;
  'webrtc-answer': (data: { targetId: string; answer: RTCSessionDescriptionInit }) => void;
  'webrtc-ice-candidate': (data: { targetId: string; candidate: RTCIceCandidateInit }) => void;
  'webrtc-ready': (data: { hasVideo: boolean; hasAudio: boolean }) => void;
}

export interface ServerEvents {
  // Room events
  'room-created': (data: { room: Room }) => void;
  'room-joined': (data: { room: Room; player: Player }) => void;
  'room-updated': (data: { room: Room }) => void;
  'player-joined': (data: { player: Player }) => void;
  'player-left': (data: { playerId: string }) => void;
  'player-disconnected': (data: { playerId: string }) => void;
  
  // Game events
  'game-started': (data: { room: Room }) => void;
  'game-state-updated': (data: { room: Room }) => void;
  'turn-started': (data: { playerId: string; word?: Word; timeLimit: number }) => void;
  'word-assigned': (data: { word: Word | null }) => void;
  'question-assigned': (data: { question?: Question; imposterHint?: string; isImposter: boolean }) => void;
  'word-submitted': (data: { playerId: string; word: string }) => void;
  'answer-submitted': (data: { playerId: string; playerName: string }) => void;
  'voting-started': (data: { timeLimit: number }) => void;
  'vote-submitted': (data: { voterId: string; votedForId: string }) => void;
  'imposter-guess-result': (data: { correct: boolean; guess: string }) => void;
  'round-ended': (data: { result: RoundResult }) => void;
  'game-ended': (data: { result: VoteResult; winner?: string }) => void;
  
  // Timer events
  'timer-updated': (data: { timeRemaining: number; isActive: boolean }) => void;
  'timer-ended': () => void;
  
  // WebRTC events
  'webrtc-user-connected': (data: { userId: string; hasVideo: boolean; hasAudio: boolean }) => void;
  'webrtc-user-disconnected': (data: { userId: string }) => void;
  'webrtc-offer': (data: { fromId: string; offer: RTCSessionDescriptionInit }) => void;
  'webrtc-answer': (data: { fromId: string; answer: RTCSessionDescriptionInit }) => void;
  'webrtc-ice-candidate': (data: { fromId: string; candidate: RTCIceCandidateInit }) => void;
  
  // Error events
  'error': (data: { message: string; code?: string }) => void;
  'game-error': (data: { message: string; code?: string }) => void;
  
  // Pass & Play events
  'player-revealed': (data: { playerData: any; room: Room }) => void;
  'next-player-ready': (data: { room: Room; allPlayersRevealed?: boolean }) => void;
  
  // Round events
  'round-started': (data: { roundNumber: number; room: Room }) => void;
}

// API response types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface CreateRoomResponse {
  room: Room;
  player: Player;
}

export interface JoinRoomResponse {
  room: Room;
  player: Player;
} 
