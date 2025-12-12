import { Room, Player, GameMode, GamePhase, Word, WordPair, TurnData, VoteData, RoundResult, Question, AnswerData, GameSettings, SkipControls } from '../types/types.js';
import { WordManager } from './WordManager.js';
import { QuestionManager } from './QuestionManager.js';
import { supabaseService } from '../services/supabaseService.js';
import { randomUUID as uuidv4 } from 'crypto';

// Cached content structure per language
interface CachedContent {
  wordPairs: WordPair[];
  classicWords: string[];
  personalQuestions: Question[];
  comparativeQuestions: Question[];
}

export class GameManager {
  private rooms: Map<string, Room> = new Map();
  private playerToRoom: Map<string, string> = new Map(); // socketId -> roomId
  private gameBuddiesSessions: Map<string, string> = new Map(); // sessionToken -> roomCode
  private wordManager: WordManager;
  private questionManager: QuestionManager;

  // Content caching per language
  private contentCache: Map<'en' | 'de', CachedContent> = new Map();
  private currentLoadedLanguage: 'en' | 'de' | null = null;

  constructor() {
    this.wordManager = new WordManager();
    this.questionManager = new QuestionManager();
    // Initialize with default English content
    this.initializeContent('en');
  }

  private async initializeContent(language: 'en' | 'de' = 'en') {
    try {
      console.log(`[GameManager] Loading content from Supabase for language: ${language}...`);
      const content = await supabaseService.getAllContent(language);

      // Cache content for this language
      this.contentCache.set(language, {
        wordPairs: content.wordPairs,
        classicWords: content.classicWords,
        personalQuestions: content.personalQuestions,
        comparativeQuestions: content.comparativeQuestions
      });

      // Load into managers if this is the current language
      if (this.currentLoadedLanguage === null || this.currentLoadedLanguage === language) {
        this.wordManager.loadWords(content.wordPairs, content.classicWords);
        this.questionManager.loadQuestions(content.personalQuestions, content.comparativeQuestions);
        this.currentLoadedLanguage = language;
      }

      console.log(`[GameManager] Content loaded from Supabase successfully (language: ${language})`);
    } catch (error) {
      console.error(`[GameManager] Failed to load content data for language ${language}:`, error);
    }
  }

  /**
   * Ensure content is loaded for a specific language
   * Loads from cache if available, otherwise fetches from Supabase
   */
  private async ensureContentForLanguage(language: 'en' | 'de'): Promise<void> {
    // Check if we need to load this language
    if (!this.contentCache.has(language)) {
      console.log(`[GameManager] 🌐 Content for '${language}' not cached, loading...`);
      await this.initializeContent(language);
    }

    // Switch managers to this language if not already loaded
    if (this.currentLoadedLanguage !== language) {
      const content = this.contentCache.get(language);
      if (content) {
        this.wordManager.loadWords(content.wordPairs, content.classicWords);
        this.questionManager.loadQuestions(content.personalQuestions, content.comparativeQuestions);
        this.currentLoadedLanguage = language;
        console.log(`[GameManager] 🌐 Switched content managers to language: ${language}`);
      }
    }
  }

  /**
   * Refresh content from Supabase for a new room
   * Always fetches fresh content, bypassing the cache
   */
  private async refreshContentForNewRoom(language: 'en' | 'de' = 'en'): Promise<void> {
    console.log(`[GameManager] 🔄 Refreshing content for new room (language: ${language})...`);
    // Clear cache for this language to force fresh fetch
    this.contentCache.delete(language);
    await this.initializeContent(language);
  }

  // Public method to reload all content after admin panel updates
  public async reloadContent(language?: 'en' | 'de') {
    if (language) {
      // Clear cache for specific language and reload
      this.contentCache.delete(language);
      await this.initializeContent(language);
    } else {
      // Reload all cached languages
      this.contentCache.clear();
      this.currentLoadedLanguage = null;
      await this.initializeContent('en');
    }
  }

  // Keep these for backward compatibility if needed
  public async reloadWordsData() {
    await this.reloadContent();
  }

  public async reloadQuestionsData() {
    await this.reloadContent();
  }

  // Room Management
  async createRoom(gamemaster: Player, gameMode: GameMode, customRoomCode?: string): Promise<Room> {
    const roomId = uuidv4();
    const roomCode = customRoomCode ? customRoomCode.toUpperCase() : this.generateRoomCode();

    // Check if custom room code already exists
    if (customRoomCode && this.getRoomByCode(roomCode)) {
      throw new Error('Room code already exists');
    }

    // Refresh content for the new room (fetch latest from DB)
    await this.refreshContentForNewRoom('en');

    const room: Room = {
      id: roomId,
      code: roomCode,
      gamemaster,
      players: [gamemaster],
      gameMode,
      gamePhase: 'lobby',
      settings: {
        roomCode,
        maxPlayers: 8,
        turnTimeLimit: 30,
        votingTimeLimit: 60,
        discussionTimeLimit: 30,
        enableVideo: true,
        enableAudio: true,
        roundsBeforeVoting: 2, // Default: 2 rounds before voting
        inputMode: 'text', // Default: text input
        gameType: 'online' // Default: online multiplayer
      },
      currentWord: null,
      currentWordPair: null,
      currentQuestion: null,
      answersThisRound: [],
      currentTurn: null,
      turnOrder: [],
      turnIndex: 0,
      currentRound: 1,
      wordsThisRound: [],
      allWordsAllRounds: [],
      allAnswersAllRounds: [],
      passPlayCurrentPlayer: 0,
      passPlayRevealed: false,
      skipControls: {
        firstNonImposterId: null,
        wordEligiblePlayerIds: [],
        questionEligiblePlayerIds: [],
        gamemasterCanSkipPlayer: true,
        gamemasterCanSkipPlayerTruth: true
      },
      votes: {},
      roundHistory: [],
      timer: {
        isActive: false,
        timeRemaining: 0,
        duration: 0,
        type: null
      },
      usedWords: new Set(),
      usedQuestions: new Set(),
      wordPairs: [],
      createdAt: Date.now(),
      lastActivity: Date.now()
    };

    this.rooms.set(roomId, room);
    this.playerToRoom.set(gamemaster.socketId!, roomId);

    this.updateSkipControls(room);
    console.log(`[GameManager] Room created: ${roomCode} (${roomId})`);
    return room;
  }

  joinRoom(roomCode: string, player: Player): { room: Room; success: boolean; error?: string } {
    const room = this.getRoomByCode(roomCode);
    
    if (!room) {
      return { room: null as any, success: false, error: 'Room not found' };
    }

    if (room.players.length >= room.settings.maxPlayers) {
      return { room: null as any, success: false, error: 'Room is full' };
    }

    if (room.gamePhase !== 'lobby') {
      return { room: null as any, success: false, error: 'Game is already in progress' };
    }

    // Check if player name already exists in the room
    const existingPlayer = room.players.find(p => p.name === player.name);
    if (existingPlayer) {
      return { room: null as any, success: false, error: 'Player name already exists in room' };
    }

    // Add new player
    room.players.push(player);
    this.playerToRoom.set(player.socketId!, room.id);
    room.lastActivity = Date.now();

    this.updateSkipControls(room);
    console.log(`[GameManager] Player ${player.name} joined room ${roomCode}`);
    return { room, success: true };
  }

  leaveRoom(socketId: string): { room: Room | null; player: Player | null } {
    const roomId = this.getRoomIdBySocketId(socketId);
    if (!roomId) return { room: null, player: null };

    const room = this.rooms.get(roomId);
    if (!room) return { room: null, player: null };

    const playerIndex = room.players.findIndex(p => p.socketId === socketId);
    if (playerIndex === -1) return { room: null, player: null };

    const player = room.players[playerIndex];
    
    // If this is the gamemaster and there are other players, transfer ownership
    if (player.isGamemaster && room.players.length > 1) {
      const newGamemaster = room.players.find(p => p.id !== player.id);
      if (newGamemaster) {
        newGamemaster.isGamemaster = true;
        room.gamemaster = newGamemaster;
        console.log(`[GameManager] Gamemaster transferred to ${newGamemaster.name}`);
      }
    }

    // Remove player
    room.players.splice(playerIndex, 1);
    this.playerToRoom.delete(socketId);

    // If no players left, cleanup room
    if (room.players.length === 0) {
      this.rooms.delete(roomId);
      console.log(`[GameManager] Room ${room.code} deleted (empty)`);
      return { room: null, player };
    }

    room.lastActivity = Date.now();
    this.updateSkipControls(room);
    console.log(`[GameManager] Player ${player.name} left room ${room.code}`);
    return { room, player };
  }

  // Game Logic
  async startGame(roomId: string): Promise<{ success: boolean; error?: string; room?: Room }> {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    if (room.gamePhase !== 'lobby') {
      return { success: false, error: 'Game already started' };
    }

    if (room.players.length < 3) {
      return { success: false, error: 'Need at least 3 players to start' };
    }

    // Ensure content is loaded for room's language
    const roomLanguage = (room.settings.language as 'en' | 'de') || 'en';
    await this.ensureContentForLanguage(roomLanguage);
    console.log(`[GameManager] 🌐 Starting game with language: ${roomLanguage}`);

    // Initialize game
    this.initializeGame(room);

    if (room.gameMode === 'truth') {
      this.assignQuestion(room);
      this.startQuestionRound(room);
      room.gamePhase = 'question-round';
    } else {
      this.assignWords(room);
      this.startWordRound(room);
      room.gamePhase = 'word-round';
    }

    room.gameStartedAt = Date.now();
    room.lastActivity = Date.now();

    this.updateSkipControls(room);
    console.log(`[GameManager] Game started in room ${room.code}, mode: ${room.gameMode}`);
    return { success: true, room };
  }

  private initializeGame(room: Room) {
    // Find who was the previous imposter for debugging
    const previousImposter = room.players.find(p => p.isImposter);
    console.log(`[GameManager] Previous imposter: ${previousImposter ? previousImposter.name : 'None'}`);
    
    // Reset all player states
    room.players.forEach(player => {
      player.isImposter = false;
      player.hasSubmittedWord = false;
      player.hasVoted = false;
      player.votedFor = undefined;
      player.isEliminated = false;
      player.lastSubmittedRound = 0;
    });

    // Choose random imposter with better logging
    const playerCount = room.players.length;
    const randomValue = Math.random();
    const randomIndex = Math.floor(randomValue * playerCount);
    
    console.log(`[GameManager] Imposter selection: ${playerCount} players, random value: ${randomValue}, random index: ${randomIndex}`);
    console.log(`[GameManager] All players: ${room.players.map((p, i) => `${i}: ${p.name}`).join(', ')}`);
    
    room.players[randomIndex].isImposter = true;

    // Reset game state
    room.currentRound = 1;
    room.wordsThisRound = [];
    room.allWordsAllRounds = [];
    room.answersThisRound = [];
    room.allAnswersAllRounds = [];
    room.votes = {};
    
    // Initialize based on game type
    if (room.settings.gameType === 'pass-play') {
      room.passPlayCurrentPlayer = 0;
      room.passPlayRevealed = false;
      // Don't shuffle turn order for pass & play - use player order
      room.turnOrder = room.players.map(p => p.id);
      room.turnIndex = 0;
    } else {
      // Online mode: shuffle turn order
      room.turnOrder = [...room.players.map(p => p.id)].sort(() => Math.random() - 0.5);
      room.turnIndex = 0;
    }
    
    console.log(`[GameManager] NEW IMPOSTER SELECTED: ${room.players[randomIndex].name} (index ${randomIndex})`);
    console.log(`[GameManager] Final imposter status: ${room.players.map(p => `${p.name}: ${p.isImposter}`).join(', ')}`);
    console.log(`[GameManager] Game type: ${room.settings.gameType}, Input mode: ${room.settings.inputMode}`);
    this.updateSkipControls(room);
  }

  private assignWords(room: Room) {
    console.log(`[GameManager] Assigning words for room ${room.code}, mode: ${room.gameMode}`);
    
    if (room.gameMode === 'classic') {
      const word = this.wordManager.getRandomClassicWord(room.usedWords);
      room.currentWord = { text: word };
      room.currentWordPair = null;
      room.usedWords.add(word);
      console.log(`[GameManager] Classic mode - assigned word: ${word}`);
    } else {
      const wordPair = this.wordManager.getRandomWordPair(room.usedWords);
      room.currentWord = { text: wordPair.normal };
      room.currentWordPair = wordPair; // Store the word pair for hidden mode
      room.usedWords.add(wordPair.normal);
      room.usedWords.add(wordPair.similar);
      console.log(`[GameManager] Hidden mode - assigned word pair: ${wordPair.normal} / ${wordPair.similar}`);
    }
    
    console.log(`[GameManager] Final room.currentWord:`, room.currentWord);
  }

  private assignQuestion(room: Room) {
    console.log(`[GameManager] Assigning question for room ${room.code}, mode: ${room.gameMode}`);
    
    const question = this.questionManager.getRandomQuestion(room.usedQuestions);
    room.currentQuestion = question;
    room.usedQuestions.add(question.id);
    console.log(`[GameManager] Truth mode - assigned question: ${question.text}`);
    console.log(`[GameManager] Final room.currentQuestion:`, room.currentQuestion);
  }

  public getWordForPlayer(room: Room, playerId: string): Word | null {
    if (!room.currentWord) {
      return null;
    }

    const player =
      room.players.find(p => p.id === playerId) ||
      (room.gamemaster?.id === playerId ? room.gamemaster : undefined);

    if (!player) {
      return null;
    }

    if (room.gameMode === 'classic') {
      if (player.isImposter) {
        return null;
      }
      return { text: room.currentWord.text };
    }

    if (room.gameMode === 'hidden') {
      if (!room.currentWordPair) {
        return { text: room.currentWord.text };
      }
      const text = this.wordManager.getWordForPlayer(
        player.isImposter,
        room.gameMode,
        room.currentWord.text,
        room.currentWordPair
      );
      if (!text) {
        return null;
      }
      return {
        text,
        isImposterWord: player.isImposter
      };
    }

    return { text: room.currentWord.text };
  }

  public getQuestionAssignmentForPlayer(
    room: Room,
    playerId: string
  ): { question?: Question; imposterHint?: string; isImposter: boolean } | null {
    if (!room.currentQuestion) {
      return null;
    }

    const player =
      room.players.find(p => p.id === playerId) ||
      (room.gamemaster?.id === playerId ? room.gamemaster : undefined);

    if (!player) {
      return null;
    }

    if (player.isImposter) {
      return {
        imposterHint: room.currentQuestion.imposterHint,
        isImposter: true
      };
    }

    return {
      question: room.currentQuestion,
      isImposter: false
    };
  }

  private reassignImposter(room: Room): Player | null {
    const eligiblePlayers = room.players.filter(player => !player.isEliminated);

    if (eligiblePlayers.length === 0) {
      console.warn(`[GameManager] Unable to reassign imposter in room ${room.code} - no eligible players`);
      return null;
    }

    const currentImposter = eligiblePlayers.find(player => player.isImposter);

    let selectionPool = eligiblePlayers;
    if (currentImposter && eligiblePlayers.length > 1) {
      const filtered = eligiblePlayers.filter(player => player.id !== currentImposter.id);
      if (filtered.length > 0) {
        selectionPool = filtered;
      }
    }

    const randomIndex = Math.floor(Math.random() * selectionPool.length);
    const nextImposter = selectionPool[randomIndex];

    room.players.forEach(player => {
      player.isImposter = player.id === nextImposter.id;
    });

    if (room.gamemaster) {
      room.gamemaster.isImposter = room.gamemaster.id === nextImposter.id;
    }

    room.imposterGuess = undefined;

    console.log(`[GameManager] Reassigned imposter to ${nextImposter.name} in room ${room.code}`);
    return nextImposter;
  }

  private startQuestionRound(room: Room) {
    room.answersThisRound = [];
    room.timer = {
      isActive: true,
      timeRemaining: room.settings.turnTimeLimit * 2, // Give more time for questions
      duration: room.settings.turnTimeLimit * 2,
      type: 'turn'
    };
    this.updateSkipControls(room);
  }

  private startWordRound(room: Room) {
    room.currentTurn = room.turnOrder[room.turnIndex];
    room.timer = {
      isActive: true,
      timeRemaining: room.settings.turnTimeLimit,
      duration: room.settings.turnTimeLimit,
      type: 'turn'
    };
    this.updateSkipControls(room);
  }

  private startNextRound(room: Room) {
    // Reset for next round
    room.currentRound++;
    room.wordsThisRound = [];
    room.turnIndex = 0;
    
    // Reset player submission status
    room.players.forEach(player => {
      player.hasSubmittedWord = false;
      player.lastSubmittedRound = 0;
    });

    console.log(
      `[SUSD][Round] Preparing round ${room.currentRound}`,
      room.players.map(p => ({
        name: p.name,
        lastSubmittedRound: p.lastSubmittedRound,
        isImposter: p.isImposter,
      }))
    );
    
    // Start the next round
    room.currentTurn = room.turnOrder[room.turnIndex];
    room.timer = {
      isActive: true,
      timeRemaining: room.settings.turnTimeLimit,
      duration: room.settings.turnTimeLimit,
      type: 'turn'
    };
    
    this.updateSkipControls(room);
    console.log(`[GameManager] Starting round ${room.currentRound} in room ${room.code}`);
  }

  submitWord(socketId: string, word: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(socketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const player = room.players.find(p => p.socketId === socketId);
    if (!player) return { success: false, error: 'Player not found' };

    if (room.gamePhase !== 'word-round') {
      return { success: false, error: 'Not in word round phase' };
    }

    if (room.currentTurn !== player.id) {
      return { success: false, error: 'Not your turn' };
    }

    console.log('[SUSD][submitWord] Attempt', {
      player: player.name,
      round: room.currentRound,
      word: word.trim(),
      hasSubmittedWord: player.hasSubmittedWord,
      lastSubmittedRound: player.lastSubmittedRound,
      turnIndex: room.turnIndex,
      currentTurn: room.currentTurn,
    });

    if (player.hasSubmittedWord && player.lastSubmittedRound === room.currentRound) {
      console.warn('[SUSD][submitWord] Duplicate blocked', {
        player: player.name,
        round: room.currentRound,
        lastSubmittedRound: player.lastSubmittedRound,
      });
      return { success: false, error: 'Already submitted word' };
    }

    // Record the word
    const turnData: TurnData = {
      playerId: player.id,
      playerName: player.name,
      word: word.trim(),
      timestamp: Date.now()
    };

    room.wordsThisRound.push(turnData);
    player.hasSubmittedWord = true;
    player.lastSubmittedRound = room.currentRound;

    console.log('[SUSD][submitWord] Accepted', {
      player: player.name,
      round: room.currentRound,
      totalWordsThisRound: room.wordsThisRound.length,
      nextTurnIndex: room.turnIndex + 1,
    });

    // Move to next turn or check if round is complete
    room.turnIndex++;
    if (room.turnIndex < room.turnOrder.length) {
      // Next player's turn
      room.currentTurn = room.turnOrder[room.turnIndex];
      room.timer = {
        isActive: true,
        timeRemaining: room.settings.turnTimeLimit,
        duration: room.settings.turnTimeLimit,
        type: 'turn'
      };
    } else {
      // All players have submitted for this round
      room.allWordsAllRounds.push([...room.wordsThisRound]);
      
      // Check if we should start another round or go to voting
      // Multi-round support for all modes
      if (room.currentRound < room.settings.roundsBeforeVoting) {
        // Start next round
        this.startNextRound(room);
      } else {
        // All rounds complete, start voting
        this.startVotingPhase(room);
      }
    }

    this.updateSkipControls(room);
    room.lastActivity = Date.now();
    return { success: true, room };
  }

  private startVotingPhase(room: Room) {
    room.gamePhase = 'voting';
    room.currentTurn = null;
    
    // ✅ FIX: Save answers from truth mode before transitioning to voting
    if (room.gameMode === 'truth' && room.answersThisRound.length > 0) {
      room.allAnswersAllRounds.push([...room.answersThisRound]);
      console.log(`[GameManager] Saved ${room.answersThisRound.length} answers to allAnswersAllRounds for room ${room.code}`);
    }
    room.timer = {
      isActive: true,
      timeRemaining: room.settings.votingTimeLimit,
      duration: room.settings.votingTimeLimit,
      type: 'voting'
    };

    // Reset voting state
    room.votes = {};
    room.players.forEach(player => {
      player.hasVoted = false;
      player.votedFor = undefined;
    });
    this.updateSkipControls(room);
  }

  submitVote(socketId: string, votedForId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(socketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const voter = room.players.find(p => p.socketId === socketId);
    if (!voter) return { success: false, error: 'Player not found' };

    const votedFor = room.players.find(p => p.id === votedForId);
    if (!votedFor) return { success: false, error: 'Invalid vote target' };

    if (room.gamePhase !== 'voting') {
      return { success: false, error: 'Not in voting phase' };
    }

    if (voter.hasVoted) {
      return { success: false, error: 'Already voted' };
    }

    // In online mode, you can't vote for yourself
    // In pass & play mode, all players (including gamemaster) are voteable
    if (room.settings.gameType !== 'pass-play' && voter.id === votedForId) {
      return { success: false, error: 'Cannot vote for yourself' };
    }

    // Record vote
    room.votes[voter.id] = votedForId;
    voter.hasVoted = true;
    voter.votedFor = votedForId;

    // Handle Pass & Play mode differently
    if (room.settings.gameType === 'pass-play') {
      // In pass & play mode, one vote represents the group decision
      // Mark all players as having voted and end the round immediately
      room.players.forEach(player => {
        if (!player.hasVoted) {
          player.hasVoted = true;
          player.votedFor = votedForId;
          room.votes[player.id] = votedForId;
        }
      });
      
      console.log(`[GameManager] Pass & play group vote cast for ${votedFor.name} in room ${room.code}`);
      this.endRound(room);
    } else {
      // Online mode: check if all players have voted individually
      const allVoted = room.players.every(p => p.hasVoted);
      if (allVoted) {
        this.endRound(room);
      }
    }

    room.lastActivity = Date.now();
    return { success: true, room };
  }

  submitAnswer(socketId: string, answer: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(socketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const player = room.players.find(p => p.socketId === socketId);
    if (!player) return { success: false, error: 'Player not found' };

    if (room.gamePhase !== 'question-round') {
      return { success: false, error: 'Not in question round phase' };
    }

    if (!room.currentQuestion) {
      return { success: false, error: 'No current question' };
    }

    // Check if player already answered this question
    const existingAnswer = room.answersThisRound.find(a => a.playerId === player.id);
    if (existingAnswer) {
      return { success: false, error: 'Already submitted answer' };
    }

    // Record the answer
    const answerData: AnswerData = {
      playerId: player.id,
      playerName: player.name,
      answer: answer.trim(),
      questionId: room.currentQuestion.id,
      questionText: room.currentQuestion.text,
      timestamp: Date.now()
    };

    room.answersThisRound.push(answerData);

    // Check if all players have answered
    const allAnswered = room.players.every(p =>
      room.answersThisRound.some(a => a.playerId === p.id)
    );

    if (allAnswered) {
      // All players answered - auto-transition to voting phase
      console.log(`[GameManager] All players answered in room ${room.code} - starting voting phase`);
      this.startVotingPhase(room);
    }

    this.updateSkipControls(room);
    room.lastActivity = Date.now();
    return { success: true, room };
  }

  // Public method for progressing truth mode after all answers are viewed
  progressTruthModeFromAnswers(socketId: string): { success: boolean; error?: string; room?: Room; action?: 'next-round' | 'voting' } {
    const roomId = this.playerToRoom.get(socketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    if (room.gameMode !== 'truth') {
      return { success: false, error: 'Only available in truth mode' };
    }

    if (room.gamePhase !== 'question-round') {
      return { success: false, error: 'Not in question round phase' };
    }

    // In truth mode, always go to voting after first round (multiple question rounds don't make sense)
    const maxRounds = room.gameMode === 'truth' ? 1 : room.settings.roundsBeforeVoting;
    
    // Check if we should start another round or go to voting
    if (room.currentRound < maxRounds) {
      // Start next round with a new question
      this.startNextQuestionRound(room);
      return { success: true, room, action: 'next-round' };
    } else {
      // Save answers from the final round before voting
      if (room.answersThisRound.length > 0) {
        room.allAnswersAllRounds.push([...room.answersThisRound]);
      }
      
      // All rounds complete, start voting
      this.startVotingPhase(room);
      return { success: true, room, action: 'voting' };
    }
  }

  private startNextQuestionRound(room: Room) {
    // Save answers from the completed round
    if (room.answersThisRound.length > 0) {
      room.allAnswersAllRounds.push([...room.answersThisRound]);
    }
    
    // Reset for next round
    room.currentRound++;
    room.answersThisRound = [];
    
    // Assign a new question for the next round
    this.assignQuestion(room);
    
    // Start the question round timer
    room.timer = {
      isActive: true,
      timeRemaining: room.settings.turnTimeLimit * 2, // Give more time for questions
      duration: room.settings.turnTimeLimit * 2,
      type: 'turn'
    };
    
    this.updateSkipControls(room);
    console.log(`[GameManager] Starting question round ${room.currentRound} in room ${room.code}`);
  }

  submitImposterGuess(socketId: string, guess: string): { success: boolean; error?: string; room?: Room; correct?: boolean } {
    const roomId = this.getRoomIdBySocketId(socketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const player = room.players.find(p => p.socketId === socketId);
    if (!player) return { success: false, error: 'Player not found' };

    if (!player.isImposter) {
      return { success: false, error: 'Only imposter can guess' };
    }

    if (room.gameMode !== 'classic') {
      return { success: false, error: 'Imposter guessing only available in classic mode' };
    }

    if (!room.currentWord) {
      return { success: false, error: 'No current word to guess' };
    }

    // Check if guess is correct
    const correct = guess.toLowerCase().trim() === room.currentWord.text.toLowerCase();
    
    // Store the guess
    room.imposterGuess = guess.trim();

    if (correct) {
      // Imposter wins immediately
      const result: RoundResult = {
        imposterGuess: guess.trim(),
        imposterGuessCorrect: true,
        imposterWon: true,
        playersWon: false,
        wordRevealed: room.currentWord.text,
        voteCounts: {},
        voteDetails: []
      };

      room.currentRoundResult = result;
      room.roundHistory.push(result);
      room.gamePhase = 'reveal';
      room.timer = { isActive: false, timeRemaining: 0, duration: 0, type: null };

      console.log(`[GameManager] Imposter won with correct guess: ${guess} in room ${room.code}`);
    }

    room.lastActivity = Date.now();
    return { success: true, room, correct };
  }

  // Pass & Play mode methods
  revealToCurrentPlayer(socketId: string): { success: boolean; error?: string; room?: Room; playerData?: any } {
    const roomId = this.playerToRoom.get(socketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const requester = room.players.find(p => p.socketId === socketId);
    if (!requester || !requester.isGamemaster) {
      return { success: false, error: 'Only gamemaster can control pass & play' };
    }

    if (room.settings.gameType !== 'pass-play') {
      return { success: false, error: 'Not in pass & play mode' };
    }

    if (room.passPlayRevealed) {
      return { success: false, error: 'Already revealed to current player' };
    }

    const currentPlayer = room.players[room.passPlayCurrentPlayer];
    if (!currentPlayer) {
      return { success: false, error: 'Invalid player index' };
    }

    room.passPlayRevealed = true;

    let playerData: any = {
      playerName: currentPlayer.name,
      isImposter: currentPlayer.isImposter
    };

    if (room.gameMode === 'truth') {
      if (currentPlayer.isImposter) {
        playerData.imposterHint = room.currentQuestion!.imposterHint;
      } else {
        playerData.question = room.currentQuestion!;
      }
    } else {
      // Classic/Hidden mode
      if (room.gameMode === 'classic' && !currentPlayer.isImposter) {
        playerData.word = room.currentWord!;
      } else if (room.gameMode === 'hidden') {
        // Use WordManager to get proper word for player
        const wordText = this.wordManager.getWordForPlayer(
          currentPlayer.isImposter,
          room.gameMode,
          room.currentWord!.text,
          room.currentWordPair!
        );
        if (wordText) {
          playerData.word = { text: wordText };
        }
      }
    }

    room.lastActivity = Date.now();
    console.log(`[GameManager] Revealed to ${currentPlayer.name} in pass & play room ${room.code}`);
    
    return { success: true, room, playerData };
  }

  advanceToNextPlayer(socketId: string): { success: boolean; error?: string; room?: Room; allPlayersRevealed?: boolean } {
    const roomId = this.playerToRoom.get(socketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const requester = room.players.find(p => p.socketId === socketId);
    if (!requester || !requester.isGamemaster) {
      return { success: false, error: 'Only gamemaster can control pass & play' };
    }

    if (room.settings.gameType !== 'pass-play') {
      return { success: false, error: 'Not in pass & play mode' };
    }

    if (!room.passPlayRevealed) {
      return { success: false, error: 'Must reveal to current player first' };
    }

    // Move to next player
    room.passPlayCurrentPlayer++;
    room.passPlayRevealed = false;

    const allPlayersRevealed = room.passPlayCurrentPlayer >= room.players.length;
    
    if (allPlayersRevealed) {
      // All players have seen their roles, start voting phase
      this.startVotingPhase(room);
    }

    room.lastActivity = Date.now();
    console.log(`[GameManager] Advanced to next player in pass & play room ${room.code}`);
    
    return { success: true, room, allPlayersRevealed };
  }

  // Voice mode method for GM to advance to next player
  nextPlayerVoiceMode(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can advance players' };
    }

    if (room.settings.inputMode !== 'voice') {
      return { success: false, error: 'Not in voice mode' };
    }

    if (room.gamePhase !== 'word-round') {
      return { success: false, error: 'Not in word round phase' };
    }

    const currentPlayer = room.players.find(p => p.id === room.currentTurn);
    if (currentPlayer) {
      // Mark current player as having "submitted" for voice mode
      currentPlayer.hasSubmittedWord = true;
      currentPlayer.lastSubmittedRound = room.currentRound;
      room.wordsThisRound.push({
        playerId: currentPlayer.id,
        playerName: currentPlayer.name,
        word: '[Spoken]',
        timestamp: Date.now()
      });

      console.log('[SUSD][voiceNextPlayer] Marked spoken submission', {
        player: currentPlayer.name,
        round: room.currentRound,
      });
    }

    // Move to next turn, check rounds, or voting
    room.turnIndex++;
    if (room.turnIndex < room.turnOrder.length) {
      room.currentTurn = room.turnOrder[room.turnIndex];
    } else {
      // All players have submitted for this round
      room.allWordsAllRounds.push([...room.wordsThisRound]);
      
      // Check if we should start another round or go to voting
      if (room.currentRound < room.settings.roundsBeforeVoting) {
        // Start next round
        this.startNextRound(room);
      } else {
        // All rounds complete, start voting
        this.startVotingPhase(room);
      }
    }

    room.lastActivity = Date.now();
    console.log(`[GameManager] GM advanced to next player in voice mode room ${room.code}`);
    return { success: true, room };
  }

  // Voice mode method for GM to force start voting
  forceStartVotingVoiceMode(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can force voting' };
    }

    if (room.settings.inputMode !== 'voice') {
      return { success: false, error: 'Not in voice mode' };
    }

    if (room.gamePhase !== 'word-round') {
      return { success: false, error: 'Not in word round phase' };
    }

    this.startVotingPhase(room);
    room.lastActivity = Date.now();

    console.log(`[GameManager] GM forced voting start in voice mode room ${room.code}`);
    return { success: true, room };
  }

  private endRound(room: Room) {
    // Calculate vote results
    const voteCounts: Record<string, number> = {};
    const voteDetails: VoteData[] = [];

    Object.entries(room.votes).forEach(([voterId, votedForId]) => {
      const voter = room.players.find(p => p.id === voterId)!;
      const votedFor = room.players.find(p => p.id === votedForId)!;
      
      voteCounts[votedForId] = (voteCounts[votedForId] || 0) + 1;
      voteDetails.push({
        voterId,
        voterName: voter.name,
        votedForId,
        votedForName: votedFor.name,
        timestamp: Date.now()
      });
    });

    // Find most voted player
    let mostVotedId = '';
    let maxVotes = 0;
    Object.entries(voteCounts).forEach(([playerId, votes]) => {
      if (votes > maxVotes) {
        maxVotes = votes;
        mostVotedId = playerId;
      }
    });

    const imposter = room.players.find(p => p.isImposter)!;
    const mostVotedPlayer = room.players.find(p => p.id === mostVotedId);

    const result: RoundResult = {
      eliminatedPlayerId: mostVotedPlayer?.id,
      eliminatedPlayerName: mostVotedPlayer?.name,
      imposterWon: false,
      playersWon: false,
      wordRevealed: room.gameMode === 'truth' ? (room.currentQuestion?.text || 'No question') : (room.currentWord?.text || 'No word'),
      voteCounts,
      voteDetails
    };

    // Check win conditions
    if (mostVotedPlayer?.isImposter) {
      result.playersWon = true;
    } else {
      result.imposterWon = true;
    }

    room.currentRoundResult = result;
    room.roundHistory.push(result);
    room.gamePhase = 'reveal';
    room.timer = { isActive: false, timeRemaining: 0, duration: 0, type: null };

    console.log(`[GameManager] Round ended in room ${room.code}. Winner: ${result.imposterWon ? 'Imposter' : 'Players'}`);
  }

  // Utility methods
  private generateRoomCode(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  getRoomByCode(code: string): Room | undefined {
    return Array.from(this.rooms.values()).find(room => room.code === code);
  }

  // GameBuddies session token management
  storeSessionToken(sessionToken: string, roomCode: string): void {
    this.gameBuddiesSessions.set(sessionToken, roomCode);
    console.log(`[GameBuddies] ✅ Stored session mapping: ${sessionToken.substring(0, 8)}...${sessionToken.substring(sessionToken.length - 4)} -> ${roomCode}`);
  }

  getRoomBySessionToken(sessionToken: string): Room | undefined {
    const roomCode = this.gameBuddiesSessions.get(sessionToken);
    if (!roomCode) {
      console.log(`[GameBuddies] ❌ No room found for session token: ${sessionToken.substring(0, 8)}...`);
      return undefined;
    }
    console.log(`[GameBuddies] ✅ Found room for session token: ${roomCode}`);
    return this.getRoomByCode(roomCode);
  }

  /**
   * Get room ID for a socket, with fallback to searching all rooms.
   * This handles race conditions during reconnections where the mapping might be stale.
   */
  private getRoomIdBySocketId(socketId: string): string | undefined {
    // Try to get room from mapping first
    let roomId = this.playerToRoom.get(socketId);

    // Fallback: If not in mapping (e.g., during reconnection), search all rooms for this socket
    if (!roomId) {
      for (const [id, room] of this.rooms.entries()) {
        if (room.players.some(p => p.socketId === socketId)) {
          roomId = id;
          // Update the mapping to fix it for future calls
          this.playerToRoom.set(socketId, roomId);
          console.log(`[GameManager] Found player ${socketId} in room ${room.code}, updated mapping`);
          break;
        }
      }
    }

    return roomId;
  }

  getRoomBySocketId(socketId: string): Room | undefined {
    const roomId = this.getRoomIdBySocketId(socketId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  getPlayerBySocketId(socketId: string): Player | undefined {
    const room = this.getRoomBySocketId(socketId);
    return room?.players.find(p => p.socketId === socketId);
  }

  private getFirstNonImposter(room: Room): Player | null {
    const orderedIds = room.turnOrder && room.turnOrder.length > 0
      ? room.turnOrder
      : room.players.map(player => player.id);

    for (const playerId of orderedIds) {
      const player = room.players.find(p => p.id === playerId);
      if (player && !player.isImposter) {
        return player;
      }
    }

    return null;
  }

  private hasSubmittedWordThisRound(room: Room, player: Player): boolean {
    return player.hasSubmittedWord && player.lastSubmittedRound === room.currentRound;
  }

  private hasAnsweredQuestionThisRound(room: Room, player: Player): boolean {
    return room.answersThisRound.some(answer => answer.playerId === player.id);
  }

  private updateSkipControls(room: Room): void {
    const gamemaster = room.players.find(p => p.isGamemaster) || room.gamemaster;
    const firstNonImposter = this.getFirstNonImposter(room);

    const firstNonImposterId = firstNonImposter ? firstNonImposter.id : null;
    const wordEligible = new Set<string>();
    const questionEligible = new Set<string>();
    const gamemasterNotImposter = !!gamemaster && !gamemaster.isImposter;
    const isPassPlay = room.settings.gameType === 'pass-play';

    if (room.gamePhase === 'word-round' && room.gameMode !== 'truth') {
      if (isPassPlay) {
        if (firstNonImposter) {
          wordEligible.add(firstNonImposter.id);
        }
      } else if (gamemasterNotImposter) {
        wordEligible.add(gamemaster!.id);
      }
    }

    if (room.gamePhase === 'question-round' && room.gameMode === 'truth') {
      if (isPassPlay) {
        if (firstNonImposter) {
          questionEligible.add(firstNonImposter.id);
        }
      } else if (gamemasterNotImposter) {
        questionEligible.add(gamemaster!.id);
      }
    }

    const nextControls: SkipControls = {
      firstNonImposterId,
      wordEligiblePlayerIds: Array.from(wordEligible),
      questionEligiblePlayerIds: Array.from(questionEligible),
      gamemasterCanSkipPlayer: Boolean(gamemaster),
      gamemasterCanSkipPlayerTruth: Boolean(gamemaster)
    };

    room.skipControls = nextControls;
  }

  /**
   * Update a player's socketId when they reconnect
   * This is critical for maintaining game state across reconnections
   */
  updatePlayerSocketId(oldSocketId: string | undefined, newSocketId: string): void {
    if (!oldSocketId) return;

    // ✅ VALIDATION: Prevent corrupting the playerToRoom mapping
    // oldSocketId === newSocketId typically happens during rapid reconnections within the grace period
    if (oldSocketId === newSocketId) {
      console.log(
        '[GameManager] ℹ️  Socket ID unchanged - likely rapid reconnection within grace period. Skipping mapping update (no-op).',
        { socketId: oldSocketId }
      );
      return;
    }

    // Try to get room from mapping first
    let roomId = this.playerToRoom.get(oldSocketId);

    // Fallback: Search all rooms for old socket ID
    if (!roomId) {
      for (const [id, room] of this.rooms.entries()) {
        if (room.players.some(p => p.socketId === oldSocketId)) {
          roomId = id;
          console.log(`[GameManager] Found old socket ${oldSocketId} in room ${room.code} during update`);
          break;
        }
      }
    }

    if (!roomId) {
      console.warn(`[GameManager] Could not find room for old socket ${oldSocketId} during socket ID update`);
      return;
    }

    // Update the playerToRoom mapping
    this.playerToRoom.delete(oldSocketId);
    this.playerToRoom.set(newSocketId, roomId);

    console.log(`[GameManager] Updated playerToRoom mapping: ${oldSocketId} → ${newSocketId}`);
  }

  getActiveRoomsCount(): number {
    return this.rooms.size;
  }

  getTotalPlayersCount(): number {
    return Array.from(this.rooms.values()).reduce((total, room) => total + room.players.length, 0);
  }

  // Gamemaster skip controls
  skipCurrentPlayer(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const caller = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!caller) {
      return { success: false, error: 'Player not found in room' };
    }

    if (!caller.isGamemaster) {
      return { success: false, error: 'Only gamemaster can skip players' };
    }

    if (room.settings.gameType === 'pass-play') {
      return { success: false, error: 'Skip player is not available in pass & play mode' };
    }

    if (room.gamePhase !== 'word-round') {
      return { success: false, error: 'Can only skip during word round' };
    }

    // Online mode: Skip the current player in turn
    const currentPlayer = room.players.find(p => p.id === room.currentTurn);
    if (!currentPlayer) {
      return { success: false, error: 'No current player to skip' };
    }

    // Mark player as submitted and add skip word
    currentPlayer.hasSubmittedWord = true;
    currentPlayer.lastSubmittedRound = room.currentRound;
    room.wordsThisRound.push({
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      word: '[Skipped by GM]',
      timestamp: Date.now()
    });

    console.log('[SUSD][skipCurrentPlayer] Player skipped', {
      player: currentPlayer.name,
      round: room.currentRound,
    });

    // Move to next turn, check rounds, or voting
    room.turnIndex++;
    if (room.turnIndex < room.turnOrder.length) {
      room.currentTurn = room.turnOrder[room.turnIndex];
    } else {
      // All players have submitted for this round
      room.allWordsAllRounds.push([...room.wordsThisRound]);

      // Check if we should start another round or go to voting
      if (room.currentRound < room.settings.roundsBeforeVoting) {
        // Start next round
        this.startNextRound(room);
      } else {
        // All rounds complete, start voting
        this.startVotingPhase(room);
      }
    }

    room.lastActivity = Date.now();
    this.updateSkipControls(room);
    console.log(`[GameManager] Gamemaster skipped ${currentPlayer.name} in room ${room.code}`);
    return { success: true, room };
  }

  skipCurrentPlayerTruth(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room; playerId?: string; playerName?: string; action?: 'next-round' | 'start-voting' } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const caller = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!caller) {
      return { success: false, error: 'Player not found in room' };
    }

    if (!caller.isGamemaster) {
      return { success: false, error: 'Only gamemaster can skip players' };
    }

    if (room.settings.gameType === 'pass-play') {
      return { success: false, error: 'Skip player is not available in pass & play mode' };
    }

    if (room.gamePhase !== 'question-round') {
      return { success: false, error: 'Can only skip during question round' };
    }

    if (room.gameMode !== 'truth') {
      return { success: false, error: 'Can only skip in truth mode' };
    }

    // Online mode: Find a player who hasn't answered yet
    const playersWhoHaventAnswered = room.players.filter(p =>
      !room.answersThisRound.some(a => a.playerId === p.id)
    );

    if (playersWhoHaventAnswered.length === 0) {
      return { success: false, error: 'All players have already answered' };
    }

    // Skip the first player who hasn't answered (or we could make this more sophisticated)
    const playerToSkip = playersWhoHaventAnswered[0];

    // Add a placeholder answer for the skipped player
    room.answersThisRound.push({
      playerId: playerToSkip.id,
      playerName: playerToSkip.name,
      answer: '[Skipped by GM]',
      questionId: room.currentQuestion?.id || '',
      questionText: room.currentQuestion?.text || '',
      timestamp: Date.now()
    });

    // Check if all players have now answered (including the skip)
    const allAnswered = room.players.every(p =>
      room.answersThisRound.some(a => a.playerId === p.id)
    );

    let action: 'next-round' | 'start-voting' = 'start-voting';

    if (allAnswered) {
      // In truth mode, always go to voting after first round (multiple question rounds don't make sense)
      const maxRounds = room.gameMode === 'truth' ? 1 : room.settings.roundsBeforeVoting;

      // All players have answered, check if we should continue to next round or voting
      if (room.currentRound < maxRounds) {
        // Start next round
        this.startNextQuestionRound(room);
        action = 'next-round';
      } else {
        // All rounds complete, start voting
        this.startVotingPhase(room);
        action = 'start-voting';
      }
    }

    room.lastActivity = Date.now();
    this.updateSkipControls(room);
    console.log(`[GameManager] Gamemaster skipped ${playerToSkip.name} in truth mode in room ${room.code}`);

    return {
      success: true,
      room,
      playerId: playerToSkip.id,
      playerName: playerToSkip.name,
      action
    };
  }

  /**
   * Skip current word in online mode (generate new word for all players)
   */
  skipWord(socketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(socketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    if (room.gamePhase !== 'word-round') {
      return { success: false, error: 'Can only skip word during word round' };
    }

    if (room.gameMode === 'truth') {
      return { success: false, error: 'Use skip question in truth mode' };
    }

    const caller = room.players.find(player => player.socketId === socketId);
    if (!caller) {
      return { success: false, error: 'Player not found in room' };
    }

    const isPassPlay = room.settings.gameType === 'pass-play';
    const firstNonImposter = this.getFirstNonImposter(room);
    const isFirstNonImposter = firstNonImposter ? firstNonImposter.id === caller.id : false;

    if (isPassPlay) {
      if (!caller.isGamemaster && !isFirstNonImposter) {
        return { success: false, error: 'Only the pass & play host can skip the word' };
      }
    } else if (!caller.isGamemaster) {
      return { success: false, error: 'Only gamemaster can skip word' };
    }

    this.assignWords(room);

    room.wordsThisRound = [];
    room.turnIndex = 0;
    room.currentTurn = room.turnOrder[0] ?? null;

    room.players.forEach(player => {
      player.hasSubmittedWord = false;
      player.lastSubmittedRound = 0;
    });

    if (isPassPlay) {
      room.passPlayCurrentPlayer = 0;
      room.passPlayRevealed = false;
    }

    this.reassignImposter(room);
    room.pendingSkipRequest = undefined;
    room.lastActivity = Date.now();
    if (room.settings.gameType === 'online') {
      this.startWordRound(room);
    } else {
      room.timer = {
        isActive: false,
        timeRemaining: 0,
        duration: 0,
        type: null
      };
      this.updateSkipControls(room);
    }

    console.log(`[GameManager] Word skipped by ${caller.name} in room ${room.code}`);
    return { success: true, room };
  }

  /**
   * Skip current question in online mode (generate new question for all players)
   */
  skipQuestion(socketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(socketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    if (room.gamePhase !== 'question-round') {
      return { success: false, error: 'Can only skip question during question round' };
    }

    if (room.gameMode !== 'truth') {
      return { success: false, error: 'Skip question only available in truth mode' };
    }

    const caller = room.players.find(player => player.socketId === socketId);
    if (!caller) {
      return { success: false, error: 'Player not found in room' };
    }

    const isPassPlay = room.settings.gameType === 'pass-play';
    const firstNonImposter = this.getFirstNonImposter(room);
    const isFirstNonImposter = firstNonImposter ? firstNonImposter.id === caller.id : false;

    if (isPassPlay) {
      if (!caller.isGamemaster && !isFirstNonImposter) {
        return { success: false, error: 'Only the pass & play host can skip the question' };
      }
    } else if (!caller.isGamemaster) {
      return { success: false, error: 'Only gamemaster can skip question' };
    }

    this.assignQuestion(room);

    room.answersThisRound = [];

    if (isPassPlay) {
      room.passPlayCurrentPlayer = 0;
      room.passPlayRevealed = false;
    }

    this.reassignImposter(room);
    room.pendingSkipRequest = undefined;
    room.lastActivity = Date.now();
    if (room.settings.gameType === 'online') {
      this.startQuestionRound(room);
    } else {
      room.timer = {
        isActive: false,
        timeRemaining: 0,
        duration: 0,
        type: null
      };
      this.updateSkipControls(room);
    }

    console.log(`[GameManager] Question skipped by ${caller.name} in room ${room.code}`);
    return { success: true, room };
  }

  // Skip request/approval flow methods
  requestSkip(socketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(socketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const player = room.players.find(p => p.socketId === socketId);
    if (!player) {
      return { success: false, error: 'Player not found' };
    }

    if (room.gamePhase !== 'word-round' && room.gamePhase !== 'question-round') {
      return { success: false, error: 'Can only request skip during word or question round' };
    }

    // Create skip request
    room.pendingSkipRequest = {
      playerId: player.id,
      playerName: player.name,
      requestedAt: Date.now(),
      gamePhase: room.gamePhase
    };

    room.lastActivity = Date.now();
    console.log(`[GameManager] Skip request from ${player.name} in room ${room.code}`);
    return { success: true, room };
  }

  approveSkip(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    if (!room.pendingSkipRequest) {
      return { success: false, error: 'No pending skip request' };
    }

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can approve skip' };
    }

    let skipResult;
    if (room.pendingSkipRequest.gamePhase === 'word-round') {
      skipResult = this.skipWord(gamemasterSocketId);
    } else {
      skipResult = this.skipQuestion(gamemasterSocketId);
    }

    if (!skipResult.success) {
      return skipResult;
    }

    const updatedRoom = skipResult.room!;
    updatedRoom.pendingSkipRequest = undefined;
    updatedRoom.lastActivity = Date.now();
    this.updateSkipControls(updatedRoom);

    console.log(`[GameManager] Skip approved in room ${updatedRoom.code}`);
    return { success: true, room: updatedRoom };
  }

  declineSkip(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    if (!room.pendingSkipRequest) {
      return { success: false, error: 'No pending skip request' };
    }

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can decline skip' };
    }

    // Simply clear the pending skip request
    room.pendingSkipRequest = undefined;
    room.lastActivity = Date.now();
    console.log(`[GameManager] Skip declined in room ${room.code}`);
    return { success: true, room };
  }

  forceStartVoting(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can force voting' };
    }

    if (room.gamePhase !== 'word-round' && room.gamePhase !== 'question-round') {
      return { success: false, error: 'Can only force voting during word or question round' };
    }

    // Save answers if we're in truth mode question round
    if (room.gamePhase === 'question-round' && room.answersThisRound.length > 0) {
      room.allAnswersAllRounds.push([...room.answersThisRound]);
    }

    this.startVotingPhase(room);
    room.lastActivity = Date.now();
    console.log(`[GameManager] Gamemaster forced voting in room ${room.code}`);
    return { success: true, room };
  }

  forceEndVoting(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can end voting' };
    }

    if (room.gamePhase !== 'voting') {
      return { success: false, error: 'Can only end voting during voting phase' };
    }

    this.endRound(room);
    room.lastActivity = Date.now();
    console.log(`[GameManager] Gamemaster ended voting in room ${room.code}`);
    return { success: true, room };
  }

  // Pass & Play Player Management
  addPassPlayPlayer(gamemasterSocketId: string, playerName: string): { success: boolean; error?: string; room?: Room; player?: Player } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can add players' };
    }

    if (room.settings.gameType !== 'pass-play') {
      return { success: false, error: 'Can only add players in pass & play mode' };
    }

    if (room.gamePhase !== 'lobby') {
      return { success: false, error: 'Can only add players in lobby phase' };
    }

    if (room.players.length >= 10) {
      return { success: false, error: 'Room is full (10 players max for pass & play)' };
    }

    // Check for duplicate names
    const existingPlayer = room.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
    if (existingPlayer) {
      return { success: false, error: 'Player name already exists' };
    }

    // Create new pass & play player (no socket connection)
    const newPlayer: Player = {
      id: uuidv4(),
      name: playerName,
      socketId: undefined, // Pass & play players don't have socket connections
      isGamemaster: false,
      isImposter: false,
      hasSubmittedWord: false,
      hasVoted: false,
      isEliminated: false,
      lastSubmittedRound: 0
    };

    room.players.push(newPlayer);
    room.lastActivity = Date.now();

    console.log(`[GameManager] Pass & play player ${playerName} added to room ${room.code}`);
    return { success: true, room, player: newPlayer };
  }

  removePassPlayPlayer(gamemasterSocketId: string, playerId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can remove players' };
    }

    if (room.settings.gameType !== 'pass-play') {
      return { success: false, error: 'Can only remove players in pass & play mode' };
    }

    if (room.gamePhase !== 'lobby') {
      return { success: false, error: 'Can only remove players in lobby phase' };
    }

    const playerToRemove = room.players.find(p => p.id === playerId);
    if (!playerToRemove) {
      return { success: false, error: 'Player not found' };
    }

    if (playerToRemove.isGamemaster) {
      return { success: false, error: 'Cannot remove gamemaster' };
    }

    // Remove the player
    const playerIndex = room.players.findIndex(p => p.id === playerId);
    room.players.splice(playerIndex, 1);
    room.lastActivity = Date.now();

    console.log(`[GameManager] Pass & play player ${playerToRemove.name} removed from room ${room.code}`);
    return { success: true, room };
  }

  // Start next round
  nextRound(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can start next round' };
    }

    if (room.gamePhase !== 'reveal') {
      return { success: false, error: 'Can only start next round from results phase' };
    }

    // Reset the game for a new round
    this.initializeGame(room);
    
    if (room.gameMode === 'truth') {
      this.assignQuestion(room);
      this.startQuestionRound(room);
      room.gamePhase = 'question-round';
    } else {
      this.assignWords(room);
      this.startWordRound(room);
      room.gamePhase = 'word-round';
    }

    room.lastActivity = Date.now();

    console.log(`[GameManager] Next round started in room ${room.code}, mode: ${room.gameMode}`);
    return { success: true, room };
  }

  // Game Mode Management
  changeGameMode(gamemasterSocketId: string, gameMode: string, gameType?: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can change game mode' };
    }

    if (room.gamePhase !== 'lobby') {
      return { success: false, error: 'Cannot change game mode while game is in progress' };
    }

    // Validate game mode
    const validGameModes = ['classic', 'hidden', 'truth'];
    if (!validGameModes.includes(gameMode)) {
      return { success: false, error: 'Invalid game mode' };
    }

    // Update game mode
    room.gameMode = gameMode as GameMode;

    // Update game type if provided
    if (gameType && (gameType === 'online' || gameType === 'pass-play')) {
      const oldGameType = room.settings.gameType;
      room.settings.gameType = gameType;

      // If switching FROM pass-play TO online, remove all Pass & Play dummy players
      // Keep only the gamemaster (who has a real socket connection)
      if (oldGameType === 'pass-play' && gameType === 'online') {
        const gamemasterId = gamemaster.id;

        // Remove all players except the gamemaster
        const playersToRemove = room.players.filter(p => p.id !== gamemasterId);

        playersToRemove.forEach(player => {
          // Remove from playerToRoom mapping if they have a socketId
          if (player.socketId) {
            this.playerToRoom.delete(player.socketId);
          }

          console.log(`[GameManager] Removing Pass & Play player ${player.name} when switching to online mode`);
        });

        // Keep only the gamemaster in the room
        room.players = [gamemaster];

        console.log(`[GameManager] Removed ${playersToRemove.length} Pass & Play player(s) when switching to online mode in room ${room.code}`);
      }
    }

    room.lastActivity = Date.now();
    console.log(`[GameManager] Game mode changed to ${gameMode} in room ${room.code}`);
    return { success: true, room };
  }

  // Update Room Settings
  updateRoomSettings(gamemasterSocketId: string, settings: Partial<GameSettings>): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can update room settings' };
    }

    if (room.gamePhase !== 'lobby') {
      return { success: false, error: 'Can only update settings in lobby' };
    }

    // Validate and update settings
    if (settings.inputMode !== undefined) {
      const validInputModes = ['text', 'voice'];
      if (!validInputModes.includes(settings.inputMode)) {
        return { success: false, error: 'Invalid input mode' };
      }
      room.settings.inputMode = settings.inputMode;
    }

    if (settings.roundsBeforeVoting !== undefined) {
      if (settings.roundsBeforeVoting < 1 || settings.roundsBeforeVoting > 5) {
        return { success: false, error: 'Rounds before voting must be between 1 and 5' };
      }
      room.settings.roundsBeforeVoting = settings.roundsBeforeVoting;
    }

    if (settings.gameType !== undefined) {
      const validGameTypes = ['online', 'pass-play'];
      if (!validGameTypes.includes(settings.gameType)) {
        return { success: false, error: 'Invalid game type' };
      }

      const oldGameType = room.settings.gameType;
      room.settings.gameType = settings.gameType;

      // If switching FROM pass-play TO online, remove all Pass & Play dummy players
      // Keep only the gamemaster (who has a real socket connection)
      if (oldGameType === 'pass-play' && settings.gameType === 'online') {
        const gamemasterId = gamemaster.id;

        // Remove all players except the gamemaster
        const playersToRemove = room.players.filter(p => p.id !== gamemasterId);

        playersToRemove.forEach(player => {
          // Remove from playerToRoom mapping if they have a socketId
          if (player.socketId) {
            this.playerToRoom.delete(player.socketId);
          }

          console.log(`[GameManager] Removing Pass & Play player ${player.name} when switching to online mode`);
        });

        // Keep only the gamemaster in the room
        room.players = [gamemaster];

        console.log(`[GameManager] Removed ${playersToRemove.length} Pass & Play player(s) when switching to online mode in room ${room.code}`);
      }
    }

    if (settings.maxPlayers !== undefined) {
      if (settings.maxPlayers < 3 || settings.maxPlayers > 10) {
        return { success: false, error: 'Max players must be between 3 and 10' };
      }
      room.settings.maxPlayers = settings.maxPlayers;
    }

    // Allow language update in lobby
    if (settings.language !== undefined) {
      const validLanguages = ['en', 'de'];
      if (!validLanguages.includes(settings.language)) {
        return { success: false, error: 'Invalid language. Must be "en" or "de"' };
      }
      room.settings.language = settings.language;
      console.log(`[GameManager] Room language changed to ${settings.language} in room ${room.code}`);
    }

    room.lastActivity = Date.now();

    console.log(`[GameManager] Room settings updated in room ${room.code}:`, settings);
    return { success: true, room };
  }

  // End Game and Return to Lobby
  endGame(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.getRoomIdBySocketId(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can end the game' };
    }

    if (room.gamePhase === 'lobby') {
      return { success: false, error: 'Game is not in progress' };
    }

    // Reset game state to lobby
    room.gamePhase = 'lobby';
    room.currentRound = 0;
    room.currentTurn = null;
    
    // ✅ FIX: Save answers from truth mode before transitioning to voting
    if (room.gameMode === 'truth' && room.answersThisRound.length > 0) {
      room.allAnswersAllRounds.push([...room.answersThisRound]);
      console.log(`[GameManager] Saved ${room.answersThisRound.length} answers to allAnswersAllRounds for room ${room.code}`);
    }
    room.currentWord = null;
    room.currentQuestion = null;
    room.currentWordPair = null;
    room.wordsThisRound = [];
    room.answersThisRound = [];
    room.votes = {};
    room.currentRoundResult = undefined;
    room.roundHistory = [];
    room.turnIndex = 0;
    room.turnOrder = [];
    room.passPlayCurrentPlayer = 0;
    room.passPlayRevealed = false;
    room.imposterGuess = undefined;
    room.timer = {
      isActive: false,
      timeRemaining: 0,
      duration: 0,
      type: null
    };

    // Reset all players' game-specific states
    room.players.forEach(p => {
      p.isImposter = false;
      p.hasSubmittedWord = false;
      p.hasVoted = false;
      p.isEliminated = false;
    });

    room.lastActivity = Date.now();
    console.log(`[GameManager] Game ended in room ${room.code}, returned to lobby`);
    return { success: true, room };
  }
} 
