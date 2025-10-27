import { Room, Player, GameMode, GamePhase, Word, WordPair, TurnData, VoteData, RoundResult, Question, AnswerData, GameSettings } from '../types/types.js';
import { WordManager } from './WordManager.js';
import { QuestionManager } from './QuestionManager.js';
import { randomUUID as uuidv4 } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class GameManager {
  private rooms: Map<string, Room> = new Map();
  private playerToRoom: Map<string, string> = new Map(); // socketId -> roomId
  private gameBuddiesSessions: Map<string, string> = new Map(); // sessionToken -> roomCode
  private wordManager: WordManager;
  private questionManager: QuestionManager;

  constructor() {
    this.wordManager = new WordManager();
    this.questionManager = new QuestionManager();
    this.initializeContent();
  }

  private async initializeContent() {
    try {
      // Content file is in games/susd/content.json (relative to GameManager location)
      const contentPath = path.join(__dirname, '..', 'content.json');
      const contentData = await fs.readFile(contentPath, 'utf-8');
      const content = JSON.parse(contentData);
      
      // Load words
      const { wordPairs, classicWords } = content.words;
      this.wordManager.loadWords(wordPairs, classicWords);
      
      // Load questions
      const { personalQuestions, comparativeQuestions } = content.questions;
      this.questionManager.loadQuestions(personalQuestions, comparativeQuestions);
      
      console.log('[GameManager] Content data loaded successfully');
    } catch (error) {
      console.error('[GameManager] Failed to load content data:', error);
    }
  }

  // Public method to reload all content after admin panel updates
  public async reloadContent() {
    await this.initializeContent();
  }

  // Keep these for backward compatibility if needed
  public async reloadWordsData() {
    await this.initializeContent();
  }

  public async reloadQuestionsData() {
    await this.initializeContent();
  }

  // Room Management
  createRoom(gamemaster: Player, gameMode: GameMode, customRoomCode?: string): Room {
    const roomId = uuidv4();
    const roomCode = customRoomCode ? customRoomCode.toUpperCase() : this.generateRoomCode();

    // Check if custom room code already exists
    if (customRoomCode && this.getRoomByCode(roomCode)) {
      throw new Error('Room code already exists');
    }

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

    console.log(`[GameManager] Player ${player.name} joined room ${roomCode}`);
    return { room, success: true };
  }

  leaveRoom(socketId: string): { room: Room | null; player: Player | null } {
    const roomId = this.playerToRoom.get(socketId);
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
    console.log(`[GameManager] Player ${player.name} left room ${room.code}`);
    return { room, player };
  }

  // Game Logic
  startGame(roomId: string): { success: boolean; error?: string; room?: Room } {
    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    if (room.gamePhase !== 'lobby') {
      return { success: false, error: 'Game already started' };
    }

    if (room.players.length < 3) {
      return { success: false, error: 'Need at least 3 players to start' };
    }

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

  private startQuestionRound(room: Room) {
    room.answersThisRound = [];
    room.timer = {
      isActive: true,
      timeRemaining: room.settings.turnTimeLimit * 2, // Give more time for questions
      duration: room.settings.turnTimeLimit * 2,
      type: 'turn'
    };
  }

  private startWordRound(room: Room) {
    room.currentTurn = room.turnOrder[room.turnIndex];
    room.timer = {
      isActive: true,
      timeRemaining: room.settings.turnTimeLimit,
      duration: room.settings.turnTimeLimit,
      type: 'turn'
    };
  }

  private startNextRound(room: Room) {
    // Reset for next round
    room.currentRound++;
    room.wordsThisRound = [];
    room.turnIndex = 0;
    
    // Reset player submission status
    room.players.forEach(player => {
      player.hasSubmittedWord = false;
    });
    
    // Start the next round
    room.currentTurn = room.turnOrder[room.turnIndex];
    room.timer = {
      isActive: true,
      timeRemaining: room.settings.turnTimeLimit,
      duration: room.settings.turnTimeLimit,
      type: 'turn'
    };
    
    console.log(`[GameManager] Starting round ${room.currentRound} in room ${room.code}`);
  }

  submitWord(socketId: string, word: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.playerToRoom.get(socketId);
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

    if (player.hasSubmittedWord) {
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

    room.lastActivity = Date.now();
    return { success: true, room };
  }

  private startVotingPhase(room: Room) {
    room.gamePhase = 'voting';
    room.currentTurn = null;
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
  }

  submitVote(socketId: string, votedForId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.playerToRoom.get(socketId);
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
    const roomId = this.playerToRoom.get(socketId);
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
      // All players answered for this round - DON'T auto-progress
      // The socket handler will handle the delayed progression
      console.log(`[GameManager] All players answered in room ${room.code}`);
    }

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
    
    console.log(`[GameManager] Starting question round ${room.currentRound} in room ${room.code}`);
  }

  submitImposterGuess(socketId: string, guess: string): { success: boolean; error?: string; room?: Room; correct?: boolean } {
    const roomId = this.playerToRoom.get(socketId);
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
    const roomId = this.playerToRoom.get(gamemasterSocketId);
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
      room.wordsThisRound.push({
        playerId: currentPlayer.id,
        playerName: currentPlayer.name,
        word: '[Spoken]',
        timestamp: Date.now()
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
    const roomId = this.playerToRoom.get(gamemasterSocketId);
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

  getRoomBySocketId(socketId: string): Room | undefined {
    const roomId = this.playerToRoom.get(socketId);
    return roomId ? this.rooms.get(roomId) : undefined;
  }

  getPlayerBySocketId(socketId: string): Player | undefined {
    const room = this.getRoomBySocketId(socketId);
    return room?.players.find(p => p.socketId === socketId);
  }

  /**
   * Update a player's socketId when they reconnect
   * This is critical for maintaining game state across reconnections
   */
  updatePlayerSocketId(oldSocketId: string | undefined, newSocketId: string): void {
    if (!oldSocketId) return;

    const roomId = this.playerToRoom.get(oldSocketId);
    if (!roomId) return;

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
    const roomId = this.playerToRoom.get(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can skip players' };
    }

    if (room.gamePhase !== 'word-round') {
      return { success: false, error: 'Can only skip during word round' };
    }

    const currentPlayer = room.players.find(p => p.id === room.currentTurn);
    if (!currentPlayer) {
      return { success: false, error: 'No current player to skip' };
    }

    // Mark player as submitted and add skip word
    currentPlayer.hasSubmittedWord = true;
    room.wordsThisRound.push({
      playerId: currentPlayer.id,
      playerName: currentPlayer.name,
      word: '[Skipped by GM]',
      timestamp: Date.now()
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
    console.log(`[GameManager] Gamemaster skipped ${currentPlayer.name} in room ${room.code}`);
    return { success: true, room };
  }

  skipCurrentPlayerTruth(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room; playerId?: string; playerName?: string; action?: 'next-round' | 'start-voting' } {
    const roomId = this.playerToRoom.get(gamemasterSocketId);
    if (!roomId) return { success: false, error: 'Not in a room' };

    const room = this.rooms.get(roomId);
    if (!room) return { success: false, error: 'Room not found' };

    const gamemaster = room.players.find(p => p.socketId === gamemasterSocketId);
    if (!gamemaster || !gamemaster.isGamemaster) {
      return { success: false, error: 'Only gamemaster can skip players' };
    }

    if (room.gamePhase !== 'question-round') {
      return { success: false, error: 'Can only skip during question round' };
    }

    if (room.gameMode !== 'truth') {
      return { success: false, error: 'Can only skip in truth mode' };
    }

    // Find a player who hasn't answered yet
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
    console.log(`[GameManager] Gamemaster skipped ${playerToSkip.name} in truth mode in room ${room.code}`);
    
    return { 
      success: true, 
      room, 
      playerId: playerToSkip.id, 
      playerName: playerToSkip.name,
      action 
    };
  }

  forceStartVoting(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.playerToRoom.get(gamemasterSocketId);
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
    const roomId = this.playerToRoom.get(gamemasterSocketId);
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
    const roomId = this.playerToRoom.get(gamemasterSocketId);
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
      isEliminated: false
    };

    room.players.push(newPlayer);
    room.lastActivity = Date.now();

    console.log(`[GameManager] Pass & play player ${playerName} added to room ${room.code}`);
    return { success: true, room, player: newPlayer };
  }

  removePassPlayPlayer(gamemasterSocketId: string, playerId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.playerToRoom.get(gamemasterSocketId);
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
    const roomId = this.playerToRoom.get(gamemasterSocketId);
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
    const roomId = this.playerToRoom.get(gamemasterSocketId);
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
    const roomId = this.playerToRoom.get(gamemasterSocketId);
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

    room.lastActivity = Date.now();

    console.log(`[GameManager] Room settings updated in room ${room.code}:`, settings);
    return { success: true, room };
  }

  // End Game and Return to Lobby
  endGame(gamemasterSocketId: string): { success: boolean; error?: string; room?: Room } {
    const roomId = this.playerToRoom.get(gamemasterSocketId);
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