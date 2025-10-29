import { v4 as uuidv4 } from 'uuid';

class GameManager {
  constructor() {
    this.rooms = new Map();
    this.io = null; // Store io reference for timer updates
    this.gameBuddiesService = null; // Store GameBuddies service reference
    this.disconnectTimers = new Map(); // Track recent disconnect timers to prevent duplicate timers
    // Version 2.1 - Force module reload - 2025-06-16
  }

  setIO(io) {
    this.io = io;
  }

  setGameBuddiesService(service) {
    this.gameBuddiesService = service;
  }

  createRoom(gmSocketId, gmName) {
    const roomCode = this.generateRoomCode();
    return this.createRoomWithCode(gmSocketId, gmName, roomCode);
  }

  createRoomWithCode(gmSocketId, gmName, roomCode, metadata = {}) {
    // Check if room already exists
    if (this.rooms.has(roomCode)) {
      const existingRoom = this.rooms.get(roomCode);
      
      // If GM is reconnecting (pending-gm placeholder), update the GM
      if (existingRoom.gamemaster.id === 'pending-gm' && gmSocketId !== 'pending-gm') {
        console.log(`[GameManager] GM ${gmName} taking over room ${roomCode}`);
        existingRoom.gamemaster.id = gmSocketId;
        existingRoom.gamemaster.name = gmName;
        if (metadata.playerId) {
          existingRoom.gamemaster.playerId = metadata.playerId;
        }
        return this.cleanRoomForSerialization(existingRoom);
      }
      
      console.log(`[GameManager] Room ${roomCode} already exists with active GM`);
      return null;
    }
    
    const room = {
      code: roomCode,
      gamemaster: {
        id: gmSocketId,
        name: gmName,
        playerId: metadata.playerId || null, // GameBuddies user UUID
        mediaState: {
          isMicOn: false,
          lastUpdated: Date.now()
        }
      },
      players: [],
      gameState: 'lobby',
      // GameBuddies metadata
      isGameBuddiesRoom: metadata.isGameBuddiesRoom || false,
      gameBuddiesInfo: metadata.gameBuddiesInfo || null,
      maxPlayers: metadata.maxPlayers || 10,
      playerAssignments: metadata.playerAssignments || [],
      currentQuestion: null,
      targetPlayerId: null,
      currentPlayerIndex: 0, // Track whose turn it is
      roundAnswers: [],
      votes: new Map(),
      votingStatus: new Map(), // Track voting status: playerId -> { hasVoted: boolean, votedFor: playerId | '__SKIP__' | null }
      roundNumber: 1,
      showQuestionsToPlayers: false, // GM can show/hide questions during voting
      questionIndex: 0, // Track question progression
      isFinale: false,
      finaleAnswers: [], // Store finale answers separately
      finaleQuestions: [], // Pre-selected finale questions
      finaleQuestionIndex: 0, // Track finale question progression
      finaleCurrentQuestion: null, // Current finale question being answered
      finaleCurrentAnswers: [], // Current question's answers from both players
      finaleScores: {}, // Track finale scores per player
      finaleEvaluations: [], // Store all finale evaluations
      finaleState: 'waiting', // 'waiting', 'answering', 'evaluating', 'complete'
      usedQuestions: new Set(), // Track used questions to prevent reuse - persists across games within room
      selectedCategories: [], // Categories selected by gamemaster for this game
      timer: {
        isActive: false,
        time: 120, // 2 minutes default
        duration: 120
      },
      shotClock: {
        enabled: false,
        duration: 30
      },
      settings: {
        roundDuration: 120,
        shotClockEnabled: false,
        shotClockDuration: 30
      }
    };

    this.rooms.set(roomCode, room);
    
    // Log room creation with GameBuddies status
    console.log(`🏗️ [GameManager] Room ${roomCode} created with metadata:`, {
      isGameBuddiesRoom: room.isGameBuddiesRoom,
      hasGameBuddiesInfo: !!room.gameBuddiesInfo,
      gmName,
      gmPlayerId: room.gamemaster.playerId || 'NOT PROVIDED'
    });
    
    return this.cleanRoomForSerialization(room);
  }

  joinRoom(roomCode, socketId, playerName, playerId = null) {
    console.log(`[GameManager] joinRoom called with parameters (v2):`, {
      roomCode,
      socketId,
      playerName,
      playerId: playerId,
      playerIdActualValue: playerId || 'NULL/UNDEFINED',
      playerIdType: typeof playerId,
      playerIdStringified: JSON.stringify(playerId),
      argumentsLength: arguments.length,
      allArguments: Array.from(arguments),
      deploymentVersion: '2025-06-16-v2'
    });
    
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    // Allow joining at any game state - no longer restricted to lobby only
    console.log(`[GameManager] Player ${playerName} joining room ${roomCode} in state: ${room.gameState}`);

    // Check if player name already exists
    if (room.players.some(p => p.name === playerName)) {
      return { success: false, error: 'Player name already taken' };
    }

    // Players joining mid-game start as spectators (eliminated) unless it's lobby
    const isSpectator = room.gameState !== 'lobby';
    
    const player = {
      id: playerId || socketId, // Use GameBuddies UUID as primary ID when available, fallback to socketId
      socketId: socketId, // Always store socket ID for internal Socket.IO operations
      name: playerName,
      playerId: playerId || null, // GameBuddies user UUID (for backward compatibility)
      lives: isSpectator ? 0 : 3,
      isEliminated: isSpectator
    };
    
    console.log(`[GameManager] Player object created:`, {
      id: player.id,
      socketId: player.socketId,
      name: player.name,
      playerId: player.playerId || 'NULL',
      lives: player.lives,
      isEliminated: player.isEliminated,
      usingGameBuddiesId: !!playerId
    });

    room.players.push(player);
    
    if (isSpectator) {
      console.log(`[GameManager] Player ${playerName} joined as spectator (game in progress)`);
    }
    
    console.log(`[GameManager] Player ${playerName} stored with playerId: ${player.playerId || 'NOT PROVIDED'}`);
    
    // Report player connection to GameBuddies if it's a GameBuddies room
    if (room.isGameBuddiesRoom && this.gameBuddiesService) {
      console.log(`🎮 [GameManager] Reporting player join to GameBuddies: ${playerName} (${isSpectator ? 'spectator' : 'player'})`);
      this.gameBuddiesService.handlePlayerConnect(roomCode, {
        id: playerId || socketId, // Use GameBuddies playerId if available, fallback to socketId
        socketId: socketId, // Keep socket ID for internal use
        name: playerName
      }, isSpectator ? 'joined_as_spectator' : 'joined_game');
    } else if (room.isGameBuddiesRoom && !this.gameBuddiesService) {
      console.warn(`⚠️ [GameManager] GameBuddies room detected but service not available for player: ${playerName}`);
    }
    
    return { success: true, room: this.cleanRoomForSerialization(room) };
  }

  // GameBuddies player reconnection support
  reconnectPlayer(roomCode, socketId, playerInfo) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return { success: false, error: 'Room not found' };
    }

    // Find existing player by name and update their socket ID
    const existingPlayer = room.players.find(p => p.name === playerInfo.name);
    if (existingPlayer) {
      console.log(`[GameBuddies] Player ${playerInfo.name} reconnecting to room ${roomCode}`);
      const oldSocketId = existingPlayer.socketId || existingPlayer.id;
      // Update socket ID but keep the player's main ID (GameBuddies UUID) unchanged
      existingPlayer.socketId = socketId;
      
      // If they were disconnected, cancel their disconnect timer and clear status
      if (existingPlayer.isDisconnected) {
        console.log(`🔄 [Reconnect] Player ${playerInfo.name} reconnected, cancelling disconnect timer`);
        this.cancelDisconnectTimer(oldSocketId);
        existingPlayer.isDisconnected = false;
        existingPlayer.disconnectedAt = undefined;
        
        // Report reconnection to GameBuddies
        if (room.isGameBuddiesRoom && this.gameBuddiesService) {
          console.log(`🔄 [GameManager] Reporting player reconnection to GameBuddies: ${playerInfo.name}`);
          this.gameBuddiesService.handlePlayerConnect(roomCode, {
            id: existingPlayer.id, // Player ID is now GameBuddies UUID when available
            socketId: socketId, // Keep socket ID for internal use
            name: playerInfo.name
          }, 'player_reconnected');
        }
      }
      
      return { success: true, room: this.cleanRoomForSerialization(room) };
    }

    // If player not found, add them as a new player (fallback)
    const player = {
      id: playerInfo.playerId || socketId, // Use GameBuddies UUID when available
      socketId: socketId, // Always store socket ID
      name: playerInfo.name,
      playerId: playerInfo.playerId || null,
      lives: 3,
      isEliminated: false
    };

    room.players.push(player);
    return { success: true, room: this.cleanRoomForSerialization(room) };
  }

  startGame(roomCode, soloMode = false) {
    const room = this.rooms.get(roomCode);
    if (!room) {
      return null;
    }
    
    // Allow starting with solo mode (for debugging) or with 3+ players
    if (!soloMode && room.players.length < 3) {
      return null;
    }

    room.gameState = 'playing';
    room.roundNumber = 1;
    room.roundAnswers = [];
    room.votes.clear();
    
    // DON'T reset usedQuestions - they should persist across games
    // Only reset when creating a completely new room
    room.shuffledQuestions = null; // Will be shuffled when first needed
    
    const playerCount = room.players.length;
    const modeMessage = soloMode ? 'solo mode (debugging)' : `${playerCount} players`;
    console.log(`Game started in ${modeMessage}. Used questions preserved: ${room.usedQuestions?.size || 0} questions`);
    
    // Report game state to GameBuddies
    this.reportGameStateToGameBuddies(room);
    
    return this.cleanRoomForSerialization(room);
  }

  setCurrentQuestion(roomCode, question, targetPlayerId) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    room.currentQuestion = question;
    room.targetPlayerId = targetPlayerId;
    
    return this.cleanRoomForSerialization(room);
  }

  getNextQuestion(roomCode, questions) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    // Initialize used questions tracker if not exists
    if (!room.usedQuestions) {
      room.usedQuestions = new Set();
    } else if (Array.isArray(room.usedQuestions)) {
      // Convert back from array (after serialization) to Set
      room.usedQuestions = new Set(room.usedQuestions);
    }
    
    // Filter questions by selected categories if any are chosen
    let filteredQuestions = questions;
    if (room.selectedCategories && room.selectedCategories.length > 0) {
      filteredQuestions = questions.filter(q => 
        room.selectedCategories.includes(q.category || 'General')
      );
      console.log(`Filtering questions by categories: ${room.selectedCategories.join(', ')}. ${filteredQuestions.length} questions available.`);
    }
    
    // Initialize shuffled questions for this game if not exists
    if (!room.shuffledQuestions) {
      room.shuffledQuestions = [...filteredQuestions].sort(() => Math.random() - 0.5);
      console.log(`Questions shuffled for new game: ${room.shuffledQuestions.length} questions`);
    }
    
    // Initialize finale questions if in finale mode
    if (room.isFinale && (!room.finaleQuestions || room.finaleQuestions.length === 0)) {
      // Select all available hard questions first, then medium, then easy from shuffled set
      const hardQuestions = room.shuffledQuestions.filter(q => q.difficulty === 'hard' && !room.usedQuestions.has(q.id));
      const mediumQuestions = room.shuffledQuestions.filter(q => q.difficulty === 'medium' && !room.usedQuestions.has(q.id));
      const easyQuestions = room.shuffledQuestions.filter(q => q.difficulty === 'easy' && !room.usedQuestions.has(q.id));
      
      // Prioritize hard questions, but use medium/easy if not enough hard ones
      let availableQuestions = [...hardQuestions, ...mediumQuestions, ...easyQuestions];
      
      // Additional shuffle for finale questions
      availableQuestions = availableQuestions.sort(() => Math.random() - 0.5);
      
      // Take up to 20 questions (enough for both players to answer 10 each)
      room.finaleQuestions = availableQuestions.slice(0, Math.min(availableQuestions.length, 20));
      room.finaleQuestionIndex = 0;
      
      console.log(`Finale questions prepared: ${room.finaleQuestions.length} questions available`);
      
      // Warn if we don't have enough questions for a full finale
      if (room.finaleQuestions.length < 20) {
        console.warn(`Warning: Only ${room.finaleQuestions.length} questions available for finale. Full finale needs 20 questions.`);
      }
    }

    // For finale mode, use pre-selected questions
    if (room.isFinale) {
      const activePlayers = room.players.filter(p => !p.isEliminated);
      
      // Count how many questions each player has answered so far
      const answerCounts = {};
      activePlayers.forEach(p => answerCounts[p.id] = 0);
      room.finaleAnswers.forEach(answer => {
        if (answerCounts[answer.playerId] !== undefined) {
          answerCounts[answer.playerId]++;
        }
      });
      
      // Check if both players have completed their 10 questions
      const player1Complete = answerCounts[activePlayers[0].id] >= 10;
      const player2Complete = answerCounts[activePlayers[1].id] >= 10;
      
      if (player1Complete && player2Complete) {
        console.log(`Finale completed: Both players finished 10 questions each`);
        return null; // Finale truly completed
      }
      
      // Find the next available question (cycle through the available ones if needed)
      if (!room.finaleQuestions || room.finaleQuestions.length === 0) {
        console.log(`No finale questions available`);
        return null;
      }
      
      // If we've used all questions but still need more, start reusing them
      if (room.finaleQuestionIndex >= room.finaleQuestions.length) {
        console.log(`Reusing finale questions - reached end of question pool`);
        room.finaleQuestionIndex = 0; // Reset to beginning
      }
      
      const question = room.finaleQuestions[room.finaleQuestionIndex];
      room.finaleQuestionIndex++;
      
      console.log(`Finale question ${room.finaleQuestionIndex}/${room.finaleQuestions.length}: ${question.question}`);
      console.log(`Player progress: ${activePlayers[0].name} (${answerCounts[activePlayers[0].id]}/10), ${activePlayers[1].name} (${answerCounts[activePlayers[1].id]}/10)`);
      return question;
    }

    // Regular mode: find unused questions from shuffled set
    const availableQuestions = room.shuffledQuestions.filter(q => !room.usedQuestions.has(q.id));
    
    if (availableQuestions.length === 0) {
      // All questions used - reset and reshuffle for reuse
      console.log(`All questions used (${room.usedQuestions.size} total). Resetting question pool for reuse.`);
      
      // Reset used questions to allow reuse
      room.usedQuestions.clear();
      
      // Reshuffle questions for variety
      room.shuffledQuestions = [...filteredQuestions].sort(() => Math.random() - 0.5);
      console.log(`Question pool reset and reshuffled: ${room.shuffledQuestions.length} questions available`);
      
      // Get first question from reshuffled set
      if (room.shuffledQuestions.length > 0) {
        return room.shuffledQuestions[0];
      } else {
        // No questions available at all
        console.log(`No questions available in any category`);
        return null;
      }
    }
    
    // Return first available question from shuffled set
    return availableQuestions[0];
  }

  startNextTurn(roomCode, questions, isAutomatic = false) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    // Prevent rapid calls by adding a throttle check (but allow automatic calls)
    if (!isAutomatic) {
      const now = Date.now();
      if (room.lastActionTime && (now - room.lastActionTime) < 1000) {
        console.log(`Action throttled for room ${roomCode} - too rapid`);
        return this.cleanRoomForSerialization(room);
      }
      room.lastActionTime = now;
    }

    // Only reset timer for manual calls (GM clicking next), not automatic progression
    if (!isAutomatic) {
      if (room.timerInterval) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
      }
      room.timer.isActive = false;
      room.timer.time = room.timer.duration; // Reset timer to full duration
    }

    const activePlayers = room.players.filter(p => !p.isEliminated);
    
    // CRITICAL FIX: Ensure currentPlayerIndex is valid for current activePlayers count
    if (!room.currentPlayerIndex || room.currentPlayerIndex >= activePlayers.length) {
      room.currentPlayerIndex = 0;
      console.log(`[GameManager] Reset currentPlayerIndex to 0 for room ${roomCode} (activePlayers: ${activePlayers.length})`);
    } else if (room.currentPlayerIndex < 0) {
      room.currentPlayerIndex = 0;
      console.log(`[GameManager] Fixed negative currentPlayerIndex for room ${roomCode}`);
    }
    
    // Check if should enter finale mode
    if (activePlayers.length === 2 && !room.isFinale) {
      room.isFinale = true;
      room.gameState = 'finale';
      room.finaleAnswers = [];
      room.votes.clear();
      room.finaleQuestionIndex = 0;
      room.currentPlayerIndex = 0; // Start with first player
      
      // Initialize new finale mode properties
      room.finaleCurrentQuestion = null;
      room.finaleCurrentAnswers = [];
      room.finaleScores = {};
      room.finaleEvaluations = [];
      room.finaleState = 'waiting';
      
      // Initialize finale scores
      activePlayers.forEach(player => {
        room.finaleScores[player.id] = 0;
      });
      
      console.log('[GameManager] Finale mode initialized, waiting for GM to start first question');
      
      // Report finale start to GameBuddies
      this.reportGameStateToGameBuddies(room);
      
      // Return early - don't try to get a question yet, let GM manually start finale questions
      return this.cleanRoomForSerialization(room);
    }

    // Special handling for finale mode - but ONLY check completion for the NEW finale system
    if (room.isFinale && room.finaleState && room.finaleEvaluations) {
      // Use the new finale system - check if we've completed all 10 questions
      if (room.finaleEvaluations.length >= 10) {
        // All finale questions completed - end the finale
        room.gameState = 'finished';
        const winner = this.determineFinaleWinnerFromScores(room);
        room.winner = winner;
        
        console.log('[GameManager] All finale questions completed, game finished');
        
        // Report finale completion to GameBuddies
        this.reportGameStateToGameBuddies(room);
        
        return this.cleanRoomForSerialization(room);
      }
      
      // For new finale mode, don't use regular question assignment logic
      // Finale questions are managed separately through startNextFinaleQuestion
      console.log('[GameManager] In finale mode - use startNextFinaleQuestion instead of regular question flow');
      return this.cleanRoomForSerialization(room);
    }

    // Legacy finale mode support (if using old finaleAnswers system)
    if (room.isFinale && !room.finaleState) {
      // Count how many questions each player has answered in old system
      const answerCounts = {};
      activePlayers.forEach(p => answerCounts[p.id] = 0);
      room.finaleAnswers.forEach(answer => {
        if (answerCounts[answer.playerId] !== undefined) {
          answerCounts[answer.playerId]++;
        }
      });
      
      // Check if both players have completed their 10 questions in old system
      if (answerCounts[activePlayers[0].id] >= 10 && answerCounts[activePlayers[1].id] >= 10) {
        // Both players finished - end the finale
        room.gameState = 'finished';
        const winner = this.determineFinaleWinner(room);
        room.winner = winner;
        
        console.log('[GameManager] Legacy finale mode completed, game finished');
        
        // Report finale completion to GameBuddies
        this.reportGameStateToGameBuddies(room);
        
        return this.cleanRoomForSerialization(room);
      }
      
      // Determine which player should answer next in legacy mode
      if (answerCounts[activePlayers[0].id] < 10) {
        // Player 1 hasn't finished their 10 questions yet
        room.targetPlayerId = activePlayers[0].id;
        room.currentPlayerIndex = 0;
      } else if (answerCounts[activePlayers[1].id] < 10) {
        // Player 2's turn to answer questions
        room.targetPlayerId = activePlayers[1].id;
        room.currentPlayerIndex = 1;
      }
      
      console.log(`Legacy finale progress: Player 1 (${answerCounts[activePlayers[0].id]}/10), Player 2 (${answerCounts[activePlayers[1].id]}/10), Next: ${activePlayers.find(p => p.id === room.targetPlayerId)?.name}`);
    }

    // Get next question (for regular mode or legacy finale mode)
    const nextQuestion = this.getNextQuestion(roomCode, questions);
    if (!nextQuestion) {
      // No more questions available
      if (room.isFinale) {
        // This shouldn't happen in finale mode if we have enough questions
        console.error('Finale mode ran out of questions unexpectedly');
        room.gameState = 'finished';
        const winner = this.determineFinaleWinner(room);
        room.winner = winner;
        return this.cleanRoomForSerialization(room);
      } else if (room.roundAnswers.length > 0) {
        // Regular mode - start voting if we have answers
        room.gameState = 'voting';
        room.timer.isActive = false; // Stop timer when entering voting
        room.votes.clear();
        room.currentQuestion = null;
        room.targetPlayerId = null;
        return this.cleanRoomForSerialization(room);
      } else {
        // No questions and no answers - this should not reset used questions mid-game!
        // Only reset if we're truly starting a completely new game
        console.log(`No more questions available, need to start voting or end round`);
        room.gameState = 'voting';
        room.timer.isActive = false;
        room.votes.clear();
        room.currentQuestion = null;
        room.targetPlayerId = null;
        return this.cleanRoomForSerialization(room);
      }
    }

    // Mark question as used for both regular and finale modes
    if (!room.usedQuestions) {
      room.usedQuestions = new Set();
    } else if (Array.isArray(room.usedQuestions)) {
      room.usedQuestions = new Set(room.usedQuestions);
    }
    
    room.usedQuestions.add(nextQuestion.id);
    room.currentQuestion = nextQuestion;
    
    if (!room.isFinale) {
      // Regular mode: alternate between players
      
      // CRITICAL FIX: Ensure currentPlayerIndex is valid for current activePlayers count
      if (room.currentPlayerIndex === undefined || room.currentPlayerIndex >= activePlayers.length || room.currentPlayerIndex < 0) {
        room.currentPlayerIndex = 0;
        console.log(`[GameManager] Reset currentPlayerIndex to 0 for room ${roomCode} (activePlayers: ${activePlayers.length})`);
      }
      
      // Additional safety check: ensure we have active players
      if (activePlayers.length === 0) {
        console.error(`[GameManager] No active players available for question assignment in room ${roomCode}`);
        room.gameState = 'finished';
        return this.cleanRoomForSerialization(room);
      }
      
      room.targetPlayerId = activePlayers[room.currentPlayerIndex].id;
      room.questionIndex++;
      // Move to next player for next turn
      room.currentPlayerIndex = (room.currentPlayerIndex + 1) % activePlayers.length;
    }
    // Note: finale mode player assignment is handled above before getting the question

    console.log(`Question assigned: "${nextQuestion.question}" to ${activePlayers.find(p => p.id === room.targetPlayerId)?.name}. Total used: ${room.usedQuestions.size}`);
    
    return this.cleanRoomForSerialization(room);
  }

  determineFinaleWinner(room) {
    const activePlayers = room.players.filter(p => !p.isEliminated);
    
    // Count correct answers for each player
    const scores = {};
    activePlayers.forEach(p => scores[p.id] = 0);
    
    room.finaleAnswers.forEach(answer => {
      if (answer.rating === 'correct') {
        scores[answer.playerId] = (scores[answer.playerId] || 0) + 1;
      }
    });
    
    // Find winner (player with most correct answers)
    let winnerId = null;
    let maxScore = -1;
    Object.entries(scores).forEach(([playerId, score]) => {
      if (score > maxScore) {
        maxScore = score;
        winnerId = playerId;
      }
    });
    
    return room.players.find(p => p.id === winnerId) || activePlayers[0];
  }

  assignQuestionToPlayer(roomCode, question, playerId) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    room.currentQuestion = question;
    room.targetPlayerId = playerId;
    
    // Mark this question as used
    if (!room.usedQuestions) {
      room.usedQuestions = new Set();
    } else if (Array.isArray(room.usedQuestions)) {
      room.usedQuestions = new Set(room.usedQuestions);
    }
    
    room.usedQuestions.add(question.id);
    console.log(`Question "${question.question}" marked as used. Total used: ${room.usedQuestions.size}`);
    
    return this.cleanRoomForSerialization(room);
  }

  skipCurrentQuestion(roomCode, questions) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    // Prevent rapid skip calls
    const now = Date.now();
    if (room.lastSkipTime && (now - room.lastSkipTime) < 1000) {
      console.log(`Skip action throttled for room ${roomCode} - too rapid`);
      return this.cleanRoomForSerialization(room);
    }
    room.lastSkipTime = now;

    // Rate as "no-answer" and move to next
    if (room.targetPlayerId) {
      const player = room.players.find(p => p.id === room.targetPlayerId);
      if (player) {
        const roundAnswer = {
          playerId: room.targetPlayerId,
          playerName: player.name,
          questionText: room.currentQuestion.question,
          expectedAnswer: room.currentQuestion.answer,
          answerSummary: 'Question skipped by gamemaster',
          rating: 'no-answer',
          timestamp: new Date().toISOString(),
          questionId: room.currentQuestion.id
        };

        if (room.isFinale) {
          room.finaleAnswers.push(roundAnswer);
        } else {
          room.roundAnswers.push(roundAnswer);
        }
      }
    }

    // Start next turn
    return this.startNextTurn(roomCode, questions, true); // true = isAutomatic
  }

  skipQuestionKeepPlayer(roomCode, questions) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.currentQuestion || !room.targetPlayerId) return null;

    console.log(`[GameManager] Skipping bad question but keeping player ${room.targetPlayerId} for room ${roomCode}`);

    // Mark the current question as bad
    if (room.currentQuestion.id) {
      room.currentQuestion.badMarkCount = (room.currentQuestion.badMarkCount || 0) + 1;
      room.currentQuestion.isBad = true;
      console.log(`[GameManager] Marked question ${room.currentQuestion.id} as bad (count: ${room.currentQuestion.badMarkCount})`);
    }

    // Store the current target player ID to reassign
    const currentTargetPlayerId = room.targetPlayerId;
    const targetPlayer = room.players.find(p => p.id === currentTargetPlayerId);
    
    if (!targetPlayer) {
      console.log(`[GameManager] Target player not found: ${currentTargetPlayerId}`);
      return this.cleanRoomForSerialization(room);
    }

    // Add the bad question to used questions list to prevent it from being selected again
    if (!room.usedQuestions.has(room.currentQuestion.id)) {
      room.usedQuestions.add(room.currentQuestion.id);
    }

    // Get a new question for the same player
    const availableQuestions = this.getAvailableQuestions(roomCode, questions);
    const newQuestion = this.getNextQuestion(roomCode, availableQuestions);

    if (!newQuestion) {
      console.log(`[GameManager] No more questions available for room ${roomCode}`);
      // Clear current assignment if no questions left
      room.currentQuestion = null;
      room.targetPlayerId = null;
      return this.cleanRoomForSerialization(room);
    }

    // Assign the new question to the same player
    console.log(`[GameManager] Assigning new question ${newQuestion.id} to same player ${targetPlayer.name}`);
    room.currentQuestion = newQuestion;
    room.targetPlayerId = currentTargetPlayerId;
    room.usedQuestions.add(newQuestion.id);

    return this.cleanRoomForSerialization(room);
  }

  editPlayerLives(roomCode, playerId, lives) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return null;

    player.lives = Math.max(0, lives);
    if (player.lives === 0) {
      player.isEliminated = true;
    } else {
      player.isEliminated = false;
    }

    return this.cleanRoomForSerialization(room);
  }

  rateAnswer(roomCode, playerId, rating, answerSummary, questions) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.currentQuestion) return null;

    const player = room.players.find(p => p.id === playerId);
    if (!player) return null;

    // Prevent rapid rating calls
    const now = Date.now();
    if (room.lastRateTime && (now - room.lastRateTime) < 500) {
      console.log(`Rate action throttled for room ${roomCode} - too rapid`);
      return this.cleanRoomForSerialization(room);
    }
    room.lastRateTime = now;

    const roundAnswer = {
      playerId,
      playerName: player.name,
      questionText: room.currentQuestion.question,
      expectedAnswer: room.currentQuestion.answer,
      answerSummary,
      rating, // 'correct', 'incorrect', 'no-answer', 'too-late'
      timestamp: new Date().toISOString(),
      questionId: room.currentQuestion.id
    };

    // Store answer in appropriate collection
    if (room.isFinale) {
      // Remove existing answer from this player for this question if exists
      room.finaleAnswers = room.finaleAnswers.filter(
        answer => !(answer.playerId === playerId && answer.questionId === room.currentQuestion.id)
      );
      room.finaleAnswers.push(roundAnswer);
    } else {
      // Remove existing answer from this player for this question if exists
      room.roundAnswers = room.roundAnswers.filter(
        answer => !(answer.playerId === playerId && answer.questionId === room.currentQuestion.id)
      );
      room.roundAnswers.push(roundAnswer);
      
      // DEBUG: Log roundAnswers state after adding
      console.log(`[GameManager] 📝 Added roundAnswer for ${player.name}. Total roundAnswers: ${room.roundAnswers.length}`);
      console.log(`[GameManager] 📋 Current roundAnswers:`, room.roundAnswers.map(a => `${a.playerName}: ${a.questionText} → ${a.answerSummary} (${a.rating})`));
    }
    
    // Clear current question assignment after rating
    room.currentQuestion = null;
    room.targetPlayerId = null;

    // In finale mode, check if we have all answers for both players
    if (room.isFinale) {
      const activePlayers = room.players.filter(p => !p.isEliminated);
      
      // Count answers per player
      const answerCounts = {};
      activePlayers.forEach(p => answerCounts[p.id] = 0);
      room.finaleAnswers.forEach(answer => {
        if (answerCounts[answer.playerId] !== undefined) {
          answerCounts[answer.playerId]++;
        }
      });
      
      // Check if both players have answered 10 questions each
      const allPlayersFinished = activePlayers.every(player => answerCounts[player.id] >= 10);
      
      if (allPlayersFinished) {
        // Finale complete, determine winner
        room.gameState = 'finished';
        const winner = this.determineFinaleWinner(room);
        room.winner = winner;
        
        // Report finale completion to GameBuddies
        this.reportGameStateToGameBuddies(room);
        
        return this.cleanRoomForSerialization(room);
      } else {
        // Continue with next question in finale
        return this.startNextTurn(roomCode, questions, true); // true = isAutomatic
      }
    }

    // Automatically start next turn after rating an answer
    console.log(`Automatically starting next turn after rating answer for room ${roomCode}`);
    const nextTurnRoom = this.startNextTurn(roomCode, questions, true); // true = isAutomatic
    
    if (!nextTurnRoom) {
      console.log(`Failed to start next turn for room ${roomCode}`);
      return this.cleanRoomForSerialization(room);
    }
    
    console.log(`Next turn started - currentQuestion: ${!!nextTurnRoom.currentQuestion}, targetPlayer: ${nextTurnRoom.targetPlayerId}`);
    
    // Don't restart timer - let it continue running as it should throughout the round
    
    return nextTurnRoom;
  }

  controlTimer(roomCode, action, duration) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    // Prevent rapid timer control calls (except for pause/reset which should be immediate)
    const now = Date.now();
    if (action === 'start' && room.lastTimerActionTime && (now - room.lastTimerActionTime) < 500) {
      console.log(`Timer action throttled for room ${roomCode} - too rapid`);
      return this.cleanRoomForSerialization(room);
    }
    if (action === 'start') {
      room.lastTimerActionTime = now;
    }

    switch (action) {
      case 'start':
        // Always clear any existing timer first
        if (room.timerInterval) {
          clearInterval(room.timerInterval);
          room.timerInterval = null;
        }
        
        room.timer.isActive = true;
        if (duration) {
          room.timer.time = duration;
          room.timer.duration = duration;
        }
        this.startTimer(roomCode);
        break;
      
      case 'pause':
        room.timer.isActive = false;
        break;
      
      case 'reset':
        room.timer.isActive = false;
        room.timer.time = room.timer.duration;
        break;
      
      case 'start-voting':
        room.gameState = 'voting';
        room.timer.isActive = false;
        
        // Clear previous voting data
        room.votes.clear();
        room.votingStatus.clear();
        
        // Initialize voting status for all active players
        const activePlayers = room.players.filter(p => !p.isEliminated);
        activePlayers.forEach(player => {
          room.votingStatus.set(player.id, {
            hasVoted: false,
            votedFor: null,
            voterName: player.name,
            votedForName: null
          });
        });
        
        // DEBUG: Log roundAnswers state when voting starts
        console.log(`[GameManager] 🗳️ Starting voting for room ${roomCode}`);
        console.log(`[GameManager] 📊 RoundAnswers available: ${room.roundAnswers?.length || 0}`);
        if (room.roundAnswers?.length > 0) {
          console.log(`[GameManager] 📋 Questions & Answers for voting:`, room.roundAnswers.map(a => `${a.playerName}: ${a.questionText} → ${a.answerSummary} (${a.rating})`));
        } else {
          console.log(`[GameManager] ⚠️ WARNING: No roundAnswers available when starting voting!`);
        }
        
        this.io.to(roomCode).emit('server:room-update', this.cleanRoomForSerialization(room));
        
        console.log(`[GameManager] Voting started for room ${roomCode}`);
        
        // Report game state to GameBuddies if applicable
        this.reportGameStateToGameBuddies(room);
        break;
      
      case 'set-duration':
        room.timer.duration = duration;
        room.timer.time = duration;
        break;
    }

    return this.cleanRoomForSerialization(room);
  }

  startTimer(roomCode, io) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    // Clear any existing timer - be more aggressive about cleanup
    if (room.timerInterval) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
    }

    // Don't start timer if it's not supposed to be active
    if (!room.timer.isActive) {
      console.log(`Timer not started for room ${roomCode} - not active`);
      return;
    }

    room.timerInterval = setInterval(() => {
      if (!room.timer.isActive) {
        clearInterval(room.timerInterval);
        room.timerInterval = null;
        return;
      }
      
      if (room.timer.time <= 0) {
        // Timer expired - just stop the timer, don't auto-start voting
        room.timer.isActive = false;
        room.timer.time = 0;
        clearInterval(room.timerInterval);
        room.timerInterval = null;
        
        // Send final timer update indicating time is up
        if (io || this.io) {
          const ioInstance = io || this.io;
          ioInstance.to(roomCode).emit('server:timer-update', {
            time: room.timer.time,
            isActive: room.timer.isActive,
            gameState: room.gameState,
            timeExpired: true
          });
        }
        return;
      }
      
      room.timer.time--;
      
      // Send live timer updates every second for smooth countdown
      if (io || this.io) {
        const ioInstance = io || this.io;
        // Only log timer updates every 10 seconds to reduce console spam
        if (room.timer.time % 10 === 0 || room.timer.time <= 10) {
          console.log(`Timer update: ${room.timer.time}s remaining for room ${roomCode}`);
        }
        ioInstance.to(roomCode).emit('server:timer-update', {
          time: room.timer.time,
          isActive: room.timer.isActive,
          gameState: room.gameState
        });
      }
    }, 1000);
  }

  submitVote(roomCode, voterSocketId, votedPlayerId) {
    const room = this.rooms.get(roomCode);
    if (!room || room.gameState !== 'voting') return;

    // Find the voter player
    const voterPlayer = room.players.find(p => (p.socketId || p.id) === voterSocketId);
    if (!voterPlayer) return;

    room.votes.set(voterSocketId, votedPlayerId);
    
    // Update voting status
    room.votingStatus.set(voterPlayer.id, {
      hasVoted: true,
      votedFor: votedPlayerId,
      voterName: voterPlayer.name,
      votedForName: votedPlayerId === '__SKIP__' ? 'Skipped' : room.players.find(p => p.id === votedPlayerId)?.name || 'Unknown'
    });
    
    console.log(`[GameManager] Vote submitted: ${voterPlayer.name} (${voterSocketId}) voted for ${votedPlayerId}`);
  }

  skipVote(roomCode, voterSocketId) {
    const room = this.rooms.get(roomCode);
    if (!room || room.gameState !== 'voting') return;

    // Find the voter player
    const voterPlayer = room.players.find(p => (p.socketId || p.id) === voterSocketId);
    if (!voterPlayer) return;

    // Use a special value to indicate the player skipped voting
    room.votes.set(voterSocketId, '__SKIP__');
    
    // Update voting status
    room.votingStatus.set(voterPlayer.id, {
      hasVoted: true,
      votedFor: '__SKIP__',
      voterName: voterPlayer.name,
      votedForName: 'Skipped'
    });
    
    console.log(`[GameManager] Vote skipped by: ${voterPlayer.name} (${voterSocketId})`);
    
    // Don't process results here - let the server.js handler check and process
    // This prevents duplicate processing when multiple players skip/vote simultaneously
  }

  endVotingEarly(roomCode, gmSocketId) {
    const room = this.rooms.get(roomCode);
    if (!room || room.gameState !== 'voting') return;
    
    // Verify the request comes from the GM
    if (room.gamemaster.id !== gmSocketId) {
      console.log(`[GameManager] Unauthorized attempt to end voting by ${gmSocketId}`);
      return;
    }

    console.log(`[GameManager] GM ended voting early in room ${roomCode}`);
    // Don't process results here - let the server.js handler process them
    // This prevents duplicate processing and ensures proper event emission
  }

  gmSkipVoting(roomCode, gmSocketId) {
    const room = this.rooms.get(roomCode);
    if (!room || room.gameState !== 'voting') return null;
    
    // Verify the request comes from the GM
    if (room.gamemaster.id !== gmSocketId) {
      console.log(`[GameManager] Unauthorized attempt to skip voting by ${gmSocketId}`);
      return null;
    }

    console.log(`[GameManager] GM is skipping voting for AFK/disconnected players in room ${roomCode}`);
    
    // For all players who haven't voted yet, mark them as skipped
    const activePlayers = room.players.filter(p => !p.isEliminated);
    activePlayers.forEach(player => {
      if (!room.votingStatus.has(player.id)) {
        // Player hasn't voted yet - mark as GM-skipped
        room.votes.set(player.socketId || player.id, '__SKIP__');
        room.votingStatus.set(player.id, {
          hasVoted: true,
          votedFor: '__SKIP__',
          voterName: player.name,
          votedForName: 'GM Skipped (AFK/DC)',
          isGMSkipped: true
        });
        console.log(`[GameManager] GM marked ${player.name} as skipped (AFK/DC)`);
      }
    });

    return this.cleanRoomForSerialization(room);
  }

  allVotesSubmitted(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    const activePlayers = room.players.filter(p => !p.isEliminated);
    return activePlayers.every(player => room.votes.has(player.socketId || player.id));
  }

  allVotesSubmittedOrSkipped(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    const activePlayers = room.players.filter(p => !p.isEliminated);
    return activePlayers.every(player => room.votes.has(player.socketId || player.id));
  }

  processVoteResults(roomCode) {
    console.log('[GameManager] Processing vote results for room:', roomCode);
    const room = this.rooms.get(roomCode);
    if (!room) {
      console.error('[GameManager] Room not found:', roomCode);
      return;
    }

    const activePlayers = room.players.filter(p => !p.isEliminated);
    
    console.log(`[GameManager] Processing vote results for ${activePlayers.length} active players`);
    console.log(`[GameManager] Current votes:`, Array.from(room.votes.entries()));
    
    // Count votes (excluding skipped votes)
    const voteCounts = {};
    const voteBreakdown = {};
    
    // Initialize vote breakdown for all active players
    activePlayers.forEach(player => {
      voteBreakdown[player.id] = {
        playerName: player.name,
        voteCount: 0,
        voters: []
      };
    });

    // Count actual votes (not skips)
    let totalVotes = 0;
    let totalSkips = 0;
    room.votes.forEach((votedPlayerId, voterSocketId) => {
      if (votedPlayerId === '__SKIP__') {
        totalSkips++;
        return; // Skip the skipped votes
      }
      
      const voterPlayer = activePlayers.find(p => (p.socketId || p.id) === voterSocketId);
      if (!voterPlayer) return;

      voteCounts[votedPlayerId] = (voteCounts[votedPlayerId] || 0) + 1;
      totalVotes++;
      
      if (voteBreakdown[votedPlayerId]) {
        voteBreakdown[votedPlayerId].voteCount++;
        voteBreakdown[votedPlayerId].voters.push({
          voterId: voterSocketId,
          voterName: voterPlayer.name
        });
      }
    });

    console.log(`[GameManager] Vote results: ${JSON.stringify(voteCounts)}, total votes: ${totalVotes}, total skips: ${totalSkips}`);

    // Handle case where no votes were cast (everyone skipped)
    if (totalVotes === 0) {
      console.log('[GameManager] No votes cast - continuing to next round');
      
      const voteResultsData = {
        message: 'No votes were cast this round. GM can start the next round when ready.',
        voteCounts: {},
        voteBreakdown: {},
        totalSkips: totalSkips
      };
      console.log('[GameManager] Emitting voting results (no votes) to room:', roomCode, voteResultsData);
      this.io.to(roomCode).emit('server:voting-results', voteResultsData);

      // Don't automatically start next round - let GM decide when to continue
      return;
    }

    // Find player(s) with most votes
    const maxVotes = Math.max(...Object.values(voteCounts));
    const playersWithMaxVotes = Object.keys(voteCounts).filter(playerId => voteCounts[playerId] === maxVotes);
    
    console.log(`[GameManager] Max votes: ${maxVotes}, players with max votes:`, playersWithMaxVotes);

    // Handle ties
    if (playersWithMaxVotes.length > 1) {
      console.log('[GameManager] Tie detected in voting');
      
      // Check if this is already a second voting round
      if (room.isSecondVotingRound) {
        console.log('[GameManager] Second voting round resulted in tie - GM must decide');
        room.gameState = 'tie-breaking';
        
        const tiedPlayers = playersWithMaxVotes.map(playerId => {
          const player = activePlayers.find(p => p.id === playerId);
          return { id: playerId, name: player ? player.name : 'Unknown' };
        });

        const voteResultsData = {
          isTie: true,
          requiresTieBreaking: true,
          tiedPlayers: tiedPlayers,
          voteCounts,
          voteBreakdown,
          maxVotes,
          totalSkips: totalSkips,
          message: 'Second voting round resulted in a tie. Gamemaster must decide who loses a life.'
        };
        console.log('[GameManager] Emitting voting results (tie-breaking) to room:', roomCode, voteResultsData);
        this.io.to(roomCode).emit('server:voting-results', voteResultsData);
        return;
      }

      // Start second voting round
      console.log('[GameManager] Starting second voting round');
      room.isSecondVotingRound = true;
      room.tiedPlayerIds = playersWithMaxVotes;
      room.votes.clear(); // Clear votes for second round
      room.votingStatus.clear(); // Clear voting status for second round
      
      // Initialize voting status for second round
      const activePlayers = room.players.filter(p => !p.isEliminated);
      activePlayers.forEach(player => {
        room.votingStatus.set(player.id, {
          hasVoted: false,
          votedFor: null,
          voterName: player.name,
          votedForName: null
        });
      });

      const tiedPlayers = playersWithMaxVotes.map(playerId => {
        const player = activePlayers.find(p => p.id === playerId);
        return { id: playerId, name: player ? player.name : 'Unknown' };
      });

      // Emit voting reset for second round to clear client hasVoted state
      this.io.to(roomCode).emit('server:start-voting', { 
        isSecondRound: true,
        tiedPlayerIds: playersWithMaxVotes 
      });

      const voteResultsData = {
        isTie: true,
        requiresSecondVote: true,
        tiedPlayers: tiedPlayers,
        voteCounts,
        voteBreakdown,
        maxVotes,
        totalSkips: totalSkips,
        message: 'Voting resulted in a tie. Starting second voting round among tied players only.'
      };
      console.log('[GameManager] Emitting voting results (second vote) to room:', roomCode, voteResultsData);
      this.io.to(roomCode).emit('server:voting-results', voteResultsData);
      return;
    }

    // Single player with most votes - eliminate them
    const eliminatedPlayerId = playersWithMaxVotes[0];
    console.log(`[GameManager] Player ${eliminatedPlayerId} will be eliminated (${maxVotes} votes)`);
    this.eliminatePlayer(roomCode, eliminatedPlayerId, voteCounts, voteBreakdown, totalSkips);
  }

  eliminatePlayer(roomCode, eliminatedPlayerId, voteCounts, voteBreakdown, totalSkips) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const eliminatedPlayer = room.players.find(p => p.id === eliminatedPlayerId);
    if (!eliminatedPlayer) return;

    // Reduce player's life
    eliminatedPlayer.lives--;
    
    // Check if player is fully eliminated
    if (eliminatedPlayer.lives <= 0) {
      eliminatedPlayer.isEliminated = true;
    }

    const result = {
      eliminatedPlayerId,
      eliminatedPlayerName: eliminatedPlayer.name,
      livesRemaining: eliminatedPlayer.lives,
      isFullyEliminated: eliminatedPlayer.isEliminated,
      voteCounts,
      voteBreakdown,
      totalSkips,
      message: `${eliminatedPlayer.name} loses a life! (${eliminatedPlayer.lives} lives remaining)`
    };

    // Check if game should end
    const remainingPlayers = room.players.filter(p => !p.isEliminated);
    if (remainingPlayers.length <= 1) {
      room.gameState = 'finished';
      result.winner = remainingPlayers[0]?.name || 'No winner';
      result.gameEnded = true;
      
      // Report game completion to GameBuddies
      this.reportGameStateToGameBuddies(room);
      
      console.log(`Game ended. Winner: ${remainingPlayers[0]?.name || 'No winner'}`);
    } else if (remainingPlayers.length === 2 && !room.isFinale) {
      room.isFinale = true;
      room.gameState = 'finale';
      room.finaleAnswers = [];
      room.votes.clear();
      room.finaleQuestionIndex = 0;
      room.currentPlayerIndex = 0;
      // Clear any existing question from previous round
      room.currentQuestion = null;
      room.targetPlayerId = null;
      result.finaleStarted = true;
      result.message += ' The finale begins with the final 2 players!';
      
      // Report finale start to GameBuddies
      this.reportGameStateToGameBuddies(room);
      
      console.log(`Finale started with ${remainingPlayers.length} players`);
    }

    // Send voting results
    console.log('[GameManager] Emitting voting results (elimination) to room:', roomCode, result);
    this.io.to(roomCode).emit('server:voting-results', result);

    // Don't automatically start next round - let GM decide when to start
    // GM must manually click "Start Round" or "Close Results" to continue
  }

  startNextRound(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    if (room.gameState === 'finished') {
      return this.cleanRoomForSerialization(room);
    }

    // DEBUG: Log what roundAnswers are about to be cleared
    console.log(`[GameManager] 🔄 Starting next round for room ${roomCode}`);
    console.log(`[GameManager] 📊 About to clear ${room.roundAnswers?.length || 0} roundAnswers from previous round`);
    if (room.roundAnswers?.length > 0) {
      console.log(`[GameManager] 📋 Previous round answers being cleared:`, room.roundAnswers.map(a => `${a.playerName}: ${a.questionText} → ${a.answerSummary} (${a.rating})`));
    }

    // Always clear timer when starting new round
    if (room.timerInterval) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
    }
    room.timer.isActive = false;

    // Don't reset finale mode if we're in finale
    if (!room.isFinale) {
      room.roundNumber++;
      room.gameState = 'playing';
      // DON'T reset used questions for new round - they should persist!
      // Questions are only reset on "new game" or new room creation
    } else {
      // In finale mode, just continue with the current state
      room.gameState = 'finale';
    }
    
    // IMPORTANT FIX: Store previous round answers for GM reference
    // This allows GM to review what happened in the last round even after starting the next round
    if (room.roundAnswers && room.roundAnswers.length > 0) {
      room.previousRoundAnswers = [...room.roundAnswers]; // Create a copy
      console.log(`[GameManager] 💾 Preserved ${room.previousRoundAnswers.length} answers from previous round for GM reference`);
    }
    
    // Clear round data for new round
    room.roundAnswers = [];
    room.votes.clear();
    room.currentQuestion = null;
    room.targetPlayerId = null;

    const roundDuration = room.settings?.roundDuration || room.timer.duration || 120;
    room.timer.duration = roundDuration;
    room.timer.time = roundDuration;
    room.timer.isActive = false;
    
    // CRITICAL FIX: Reset currentPlayerIndex when starting new round after eliminations
    const activePlayers = room.players.filter(p => !p.isEliminated);
    if (room.currentPlayerIndex === undefined || room.currentPlayerIndex >= activePlayers.length || room.currentPlayerIndex < 0) {
      room.currentPlayerIndex = 0;
      console.log(`[GameManager] Reset currentPlayerIndex to 0 in startNextRound for room ${roomCode} (activePlayers: ${activePlayers.length})`);
    }
    
    // Reset voting-related state
    room.isSecondVotingRound = false;
    room.tiedPlayerIds = [];

    const gameState = room.gameState?.data;
    if (gameState) {
      gameState.roundStarted = false;
    }

    console.log(`[GameManager] Started new round ${room.roundNumber}. Used questions preserved: ${room.usedQuestions?.size || 0} questions`);

    if (this.io) {
      this.io.to(roomCode).emit('ddf:timer-update', {
        time: room.timer.time,
        isActive: room.timer.isActive,
        gameState: room.gameState
      });
    }

    return this.cleanRoomForSerialization(room);
  }

  handleDisconnect(socketId) {
    // Remove player or gamemaster from their room
    this.rooms.forEach((room, roomCode) => {
      if (room.gamemaster.id === socketId) {
        // Gamemaster left, end the game
        console.log(`[GameManager] Gamemaster disconnected from room ${roomCode}`);
        
        // Report GM disconnect to GameBuddies if it's a GameBuddies room
        if (room.isGameBuddiesRoom && this.gameBuddiesService) {
          console.log(`👑 [GameManager] Reporting immediate GM disconnect to GameBuddies: ${room.gamemaster.name}`);
          console.log(`🔍 [Debug] GM data: playerId=${room.gamemaster.playerId || 'MISSING'}, socketId=${room.gamemaster.id}`);
          console.log(`🔍 [Debug] Will use ID: ${room.gamemaster.playerId || room.gamemaster.id} for API call`);
          this.gameBuddiesService.handlePlayerDisconnectV2(roomCode, {
            id: room.gamemaster.playerId || room.gamemaster.id, // GM still uses playerId field for backward compatibility
            socketId: room.gamemaster.id, // Keep socket ID for internal use
            name: room.gamemaster.name
          }, 'gm_immediate_disconnect');
        } else if (room.isGameBuddiesRoom && !this.gameBuddiesService) {
          console.warn(`⚠️ [GameManager] GameBuddies room detected but service not available for GM: ${room.gamemaster.name}`);
        } else if (!room.isGameBuddiesRoom) {
          console.log(`🏠 [GameManager] Local room (not GameBuddies) - skipping API call for GM: ${room.gamemaster.name}`);
        }
        
        this.rooms.delete(roomCode);
      } else {
        // Check if disconnecting player is in this room
        const disconnectingPlayer = room.players.find(p => (p.socketId || p.id) === socketId);
        if (disconnectingPlayer) {
          console.log(`[GameManager] Player ${disconnectingPlayer.name} disconnected from room ${roomCode}`);
          
                  // Report disconnect to GameBuddies if it's a GameBuddies room
        if (room.isGameBuddiesRoom && this.gameBuddiesService && disconnectingPlayer) {
          console.log(`💥 [GameManager] Reporting immediate player disconnect to GameBuddies: ${disconnectingPlayer.name}`);
          console.log(`🔍 [Debug] Player data: playerId=${disconnectingPlayer.playerId || 'MISSING'}, socketId=${disconnectingPlayer.socketId || disconnectingPlayer.id}`);
          console.log(`🔍 [Debug] Will use ID: ${disconnectingPlayer.id} for API call`);
          // Use new External Game Status API for immediate disconnect reporting
          this.gameBuddiesService.handlePlayerDisconnectV2(roomCode, {
            id: disconnectingPlayer.id, // Player ID is now GameBuddies UUID when available
            socketId: disconnectingPlayer.socketId || disconnectingPlayer.id, // Socket ID for internal use
            name: disconnectingPlayer.name
          }, 'immediate_disconnect');
          } else if (room.isGameBuddiesRoom && !this.gameBuddiesService && disconnectingPlayer) {
            console.warn(`⚠️ [GameManager] GameBuddies room detected but service not available for player: ${disconnectingPlayer.name}`);
          } else if (!room.isGameBuddiesRoom && disconnectingPlayer) {
            console.log(`🏠 [GameManager] Local room (not GameBuddies) - skipping API call for player: ${disconnectingPlayer.name}`);
          }
          
          // Remove player
          room.players = room.players.filter(p => (p.socketId || p.id) !== socketId);
          
          // If not enough players, end game
          if (room.players.length < 2 && room.gameState !== 'lobby') {
            console.log(`[GameManager] Not enough players remaining in room ${roomCode}, ending game`);
            this.rooms.delete(roomCode);
          }
        }
      }
    });
  }

  handleTimedDisconnect(socketId, io, disconnectData = {}) {
    // Global disconnect timers storage
    if (!this.disconnectTimers) {
      this.disconnectTimers = new Map();
    }

    this.rooms.forEach((room, roomCode) => {
      const isGM = room.gamemaster.id === socketId;
      const disconnectingPlayer = room.players.find(p => (p.socketId || p.id) === socketId);
      
      
      if (isGM) {
        console.log(`🎮 [TimedDisconnect] GM ${room.gamemaster.name} disconnected from room ${roomCode}`);
        
        // Mark GM as disconnected immediately
        room.gamemaster.isDisconnected = true;
        room.gamemaster.disconnectedAt = Date.now();
        
        // For GameBuddies rooms, delay the API call to allow for return commands
        const apiCallDelay = room.isGameBuddiesRoom ? 5000 : 0; // 5 second delay for GameBuddies rooms
        
        if (apiCallDelay > 0) {
          console.log(`⏳ [TimedDisconnect] GameBuddies room detected - delaying API call by ${apiCallDelay}ms to allow for return command`);
        }
        
        // Report GM disconnect to GameBuddies if it's a GameBuddies room (with delay)
        setTimeout(() => {
          if (room.isGameBuddiesRoom && this.gameBuddiesService) {
            console.log(`👑 [GameManager] Reporting GM timed disconnect to GameBuddies: ${room.gamemaster.name}`);
            
            // Use gameBuddiesPlayerId from disconnectData if available, otherwise fallback
            const gameBuddiesPlayerId = disconnectData.gameBuddiesPlayerId || room.gamemaster.playerId || null;
            
            console.log(`🔍 [Debug] GM data: playerId=${gameBuddiesPlayerId || 'MISSING'}, socketId=${room.gamemaster.id}`);
            console.log(`🔍 [Debug] Disconnect data:`, disconnectData);
            console.log(`🔍 [Debug] Will use ID: ${gameBuddiesPlayerId || room.gamemaster.id} for API call`);
            
            this.gameBuddiesService.handlePlayerDisconnectV2(roomCode, {
              id: gameBuddiesPlayerId || room.gamemaster.id, // Use GameBuddies playerId from socket.data
              socketId: room.gamemaster.id, // Keep socket ID for internal use
              name: room.gamemaster.name
            }, 'gm_timed_disconnect');
          } else if (room.isGameBuddiesRoom && !this.gameBuddiesService) {
            console.warn(`⚠️ [GameManager] GameBuddies room detected but service not available for GM: ${room.gamemaster.name}`);
          } else if (!room.isGameBuddiesRoom) {
            console.log(`🏠 [GameManager] Local room (not GameBuddies) - skipping API call for GM: ${room.gamemaster.name}`);
          }
        }, apiCallDelay);
        
        // Broadcast room state with "Left" badge
        io.to(roomCode).emit('server:game-state-update', this.cleanRoomForSerialization(room));
        io.to(roomCode).emit('server:player-disconnected', {
          playerId: socketId,
          playerName: room.gamemaster.name,
          role: 'gamemaster',
          timeout: 10
        });
        
        // Set GM removal timer (10 seconds)
        const timerId = setTimeout(() => {
          console.log(`⏰ [TimedDisconnect] GM ${room.gamemaster.name} removal timer expired`);
          this.removeGMAndTransferHost(roomCode, socketId, io);
          this.disconnectTimers.delete(socketId);
        }, 10000);
        
        this.disconnectTimers.set(socketId, timerId);
        
      } else if (disconnectingPlayer) {
        console.log(`👤 [TimedDisconnect] Player ${disconnectingPlayer.name} disconnected from room ${roomCode}`);
        
        // Mark player as disconnected immediately
        disconnectingPlayer.isDisconnected = true;
        disconnectingPlayer.disconnectedAt = Date.now();
        
        // For GameBuddies rooms, delay the API call to allow for return commands
        const apiCallDelay = room.isGameBuddiesRoom ? 5000 : 0; // 5 second delay for GameBuddies rooms
        
        if (apiCallDelay > 0) {
          console.log(`⏳ [TimedDisconnect] GameBuddies room detected - delaying API call by ${apiCallDelay}ms to allow for return command`);
        }
        
        // Report disconnect to GameBuddies if it's a GameBuddies room (with delay)
        setTimeout(() => {
          if (room.isGameBuddiesRoom && this.gameBuddiesService) {
            console.log(`⏰ [GameManager] Reporting timed player disconnect to GameBuddies: ${disconnectingPlayer.name}`);
            
            // Use gameBuddiesPlayerId from disconnectData if available, otherwise fallback
            const gameBuddiesPlayerId = disconnectData.gameBuddiesPlayerId || disconnectingPlayer.playerId || disconnectingPlayer.id;
            
            console.log(`🔍 [Debug] Player data: playerId=${gameBuddiesPlayerId || 'MISSING'}, socketId=${disconnectingPlayer.socketId || disconnectingPlayer.id}`);
            console.log(`🔍 [Debug] Disconnect data:`, disconnectData);
            console.log(`🔍 [Debug] Will use ID: ${gameBuddiesPlayerId} for API call`);
            
            // Use new External Game Status API if available, fallback to legacy
            this.gameBuddiesService.handlePlayerDisconnectV2(roomCode, {
              id: gameBuddiesPlayerId, // Use GameBuddies playerId from socket.data
              socketId: disconnectingPlayer.socketId || disconnectingPlayer.id, // Socket ID for internal use
              name: disconnectingPlayer.name
            }, 'timed_disconnect_removal');
          } else if (room.isGameBuddiesRoom && !this.gameBuddiesService) {
            console.warn(`⚠️ [GameManager] GameBuddies room detected but service not available for player: ${disconnectingPlayer.name}`);
          } else if (!room.isGameBuddiesRoom) {
            console.log(`🏠 [GameManager] Local room (not GameBuddies) - skipping API call for player: ${disconnectingPlayer.name}`);
          }
        }, apiCallDelay);
        
        // Broadcast room state with "Left" badge
        io.to(roomCode).emit('server:game-state-update', this.cleanRoomForSerialization(room));
        io.to(roomCode).emit('server:player-disconnected', {
          playerId: socketId,
          playerName: disconnectingPlayer.name,
          role: 'player',
          timeout: 30
        });
        
        // Set player removal timer (30 seconds)
        const timerId = setTimeout(() => {
          console.log(`⏰ [TimedDisconnect] Player ${disconnectingPlayer.name} removal timer expired`);
          this.removePlayerFromRoom(roomCode, socketId, io);
          this.disconnectTimers.delete(socketId);
        }, 30000);
        
        this.disconnectTimers.set(socketId, timerId);
      }
    });
  }

  removeGMAndTransferHost(roomCode, gmSocketId, io) {
    const room = this.rooms.get(roomCode);
    if (!room || room.gamemaster.id !== gmSocketId) return;
    
    const gmName = room.gamemaster.name;
    console.log(`🔄 [HostTransfer] Removing GM ${gmName} and transferring host in room ${roomCode}`);
    
    // Find a suitable player to become the new GM
    const availablePlayers = room.players.filter(p => !p.isEliminated && !p.isDisconnected);
    
    if (availablePlayers.length === 0) {
      console.log(`❌ [HostTransfer] No available players to transfer host to, ending room ${roomCode}`);
      this.rooms.delete(roomCode);
      io.to(roomCode).emit('server:room-ended', { 
        reason: 'No gamemaster available',
        message: 'Game ended: Gamemaster left and no players available to take over'
      });
      return;
    }
    
    // Select the first available player as new GM
    const newGM = availablePlayers[0];
    console.log(`👑 [HostTransfer] Transferring host to ${newGM.name} in room ${roomCode}`);
    
    // Remove new GM from players list
    room.players = room.players.filter(p => p.id !== newGM.id);
    
    // Set new GM
    room.gamemaster = {
      id: newGM.id,
      name: newGM.name,
      mediaState: newGM.mediaState
    };
    
    // Broadcast the host transfer
    io.to(roomCode).emit('server:host-transferred', {
      oldGM: gmName,
      newGM: newGM.name,
      newGMId: newGM.id
    });
    
    // Send updated room state
    io.to(roomCode).emit('server:game-state-update', this.cleanRoomForSerialization(room));
    
    console.log(`✅ [HostTransfer] Host successfully transferred from ${gmName} to ${newGM.name}`);
  }

  removePlayerFromRoom(roomCode, playerSocketId, io) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    
    const player = room.players.find(p => (p.socketId || p.id) === playerSocketId);
    if (!player) return;
    
    console.log(`🗑️ [PlayerRemoval] Removing player ${player.name} from room ${roomCode}`);
    
    // Remove player from room
    room.players = room.players.filter(p => (p.socketId || p.id) !== playerSocketId);
    
    // Check if enough players remain for the game to continue
    const activeConnectedPlayers = room.players.filter(p => !p.isEliminated && !p.isDisconnected);
    
    if (activeConnectedPlayers.length < 2 && room.gameState !== 'lobby') {
      console.log(`❌ [PlayerRemoval] Not enough active players remaining in room ${roomCode}, ending game`);
      this.rooms.delete(roomCode);
      io.to(roomCode).emit('server:room-ended', { 
        reason: 'Insufficient players',
        message: 'Game ended: Not enough players remaining'
      });
    } else {
      // Broadcast updated room state
      io.to(roomCode).emit('server:game-state-update', this.cleanRoomForSerialization(room));
      io.to(roomCode).emit('server:player-removed', {
        playerId: playerSocketId,
        playerName: player.name,
        remainingPlayers: activeConnectedPlayers.length
      });
    }
  }

  cancelDisconnectTimer(socketId) {
    // Method to cancel disconnect timer if player reconnects
    if (this.disconnectTimers && this.disconnectTimers.has(socketId)) {
      clearTimeout(this.disconnectTimers.get(socketId));
      this.disconnectTimers.delete(socketId);
      console.log(`⏹️ [TimedDisconnect] Cancelled disconnect timer for socket ${socketId}`);
      return true;
    }
    return false;
  }



  generateRoomCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    
    // Ensure unique
    if (this.rooms.has(result)) {
      return this.generateRoomCode();
    }
    
    return result;
  }

  // Helper method to clean room objects for serialization
  cleanRoomForSerialization(room) {
    if (!room) return null;
    
    const cleanRoom = { ...room };
    delete cleanRoom.timerInterval; // Remove the interval object to prevent circular references
    
    // Convert votes Map to a plain object for serialization
    if (cleanRoom.votes instanceof Map) {
      cleanRoom.votes = Object.fromEntries(cleanRoom.votes);
    }
    
    // Convert votingStatus Map to a plain object for serialization
    if (cleanRoom.votingStatus instanceof Map) {
      cleanRoom.votingStatus = Object.fromEntries(cleanRoom.votingStatus);
    }
    
    // Convert usedQuestions Set to an array for serialization
    if (cleanRoom.usedQuestions instanceof Set) {
      cleanRoom.usedQuestions = Array.from(cleanRoom.usedQuestions);
    }
    
    return cleanRoom;
  }

  // Gamemaster breaks a tie by selecting which player loses a life
  gmBreakTie(roomCode, selectedPlayerId) {
    const room = this.rooms.get(roomCode);
    if (!room || room.gameState !== 'tie-breaking') return null;

    // Verify the selected player is one of the tied players
    if (!room.tiedPlayerIds || !room.tiedPlayerIds.includes(selectedPlayerId)) {
      return null;
    }

    // Remove life from selected player
    const selectedPlayer = room.players.find(p => p.id === selectedPlayerId);
    if (selectedPlayer) {
      selectedPlayer.lives--;
      if (selectedPlayer.lives <= 0) {
        selectedPlayer.isEliminated = true;
      }
    }

    const result = {
      eliminatedPlayerId: selectedPlayerId,
      eliminatedPlayerName: selectedPlayer?.name,
      livesRemaining: selectedPlayer?.lives || 0,
      gmDecision: true,
      message: `Gamemaster decided: ${selectedPlayer?.name} loses a life`
    };

    // Clear tie-breaking state
    room.gameState = 'playing';
    room.tiedPlayerIds = [];

    // Check if game should end or enter finale mode
    const activePlayers = room.players.filter(p => !p.isEliminated);
    if (activePlayers.length <= 1) {
      room.gameState = 'finished';
      result.winner = activePlayers[0]?.name || 'No winner';
    } else if (activePlayers.length === 2 && !room.isFinale) {
      // Trigger finale mode when 2 players remain
      room.isFinale = true;
      room.gameState = 'finale';
      room.finaleAnswers = [];
      room.finaleQuestionIndex = 0;
      room.currentPlayerIndex = 0;
      // Clear any existing question from previous round
      room.currentQuestion = null;
      room.targetPlayerId = null;
      result.finaleStarted = true;
    }

    return result;
  }

  startNewGame(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    // Reset all players to 3 lives and not eliminated
    room.players.forEach(player => {
      player.lives = 3;
      player.isEliminated = false;
    });

    // Reset game state
    room.gameState = 'lobby';
    room.currentQuestion = null;
    room.targetPlayerId = null;
    room.currentPlayerIndex = 0;
    room.roundAnswers = [];
    room.votes = new Map();
    room.roundNumber = 1;
    room.questionIndex = 0;
    room.isFinale = false;
    room.finaleAnswers = [];
    room.finaleQuestionIndex = 0;
    // IMPORTANT: DON'T reset usedQuestions - they persist across all games within the same room
    // usedQuestions only reset when creating a completely new room
    room.shuffledQuestions = null; // Reset question shuffling
    room.tiedPlayerIds = [];
    room.winner = undefined;
    
    // Reset timer
    room.timer.time = room.timer.duration;
    room.timer.isActive = false;
    
    // Clear any running timer interval
    if (room.timerInterval) {
      clearInterval(room.timerInterval);
      room.timerInterval = null;
    }

    console.log(`New game started. Used questions preserved: ${room.usedQuestions?.size || 0} questions - will remain banned`);

    return this.cleanRoomForSerialization(room);
  }

  getRoom(roomCode) {
    const room = this.rooms.get(roomCode);
    return this.cleanRoomForSerialization(room);
  }

  getRooms() {
    return this.rooms;
  }

  // WebRTC Signaling Methods
  handleWebRTCOffer(roomCode, fromSocketId, toSocketId, offer) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    // Forward the offer to the target peer
    if (this.io) {
      this.io.to(toSocketId).emit('webrtc:offer', {
        from: fromSocketId,
        offer: offer
      });
    }
    return true;
  }

  handleWebRTCAnswer(roomCode, fromSocketId, toSocketId, answer) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    // Forward the answer to the target peer
    if (this.io) {
      this.io.to(toSocketId).emit('webrtc:answer', {
        from: fromSocketId,
        answer: answer
      });
    }
    return true;
  }

  handleWebRTCIceCandidate(roomCode, fromSocketId, toSocketId, candidate) {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    // Forward the ICE candidate to the target peer
    if (this.io) {
      this.io.to(toSocketId).emit('webrtc:ice-candidate', {
        from: fromSocketId,
        candidate: candidate
      });
    }
    return true;
  }

  updatePlayerMediaState(roomCode, socketId, mediaState) {
    const room = this.rooms.get(roomCode);
    if (!room) return;

    // Update gamemaster media state
    if (room.gamemaster.id === socketId) {
      room.gamemaster.mediaState = {
        ...mediaState,
        lastUpdated: Date.now()
      };
    }

    // Update player media state
    const player = room.players.find(p => (p.socketId || p.id) === socketId);
    if (player) {
      player.mediaState = {
        ...mediaState,
        lastUpdated: Date.now()
      };
    }
  }

  updateSelectedCategories(roomCode, categories) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    // Only allow updates in lobby state
    if (room.gameState !== 'lobby') {
      return { error: 'Cannot change categories after game has started' };
    }

    room.selectedCategories = categories || [];
    
    // Reset shuffled questions so they get re-filtered when game starts
    if (room.shuffledQuestions) {
      room.shuffledQuestions = null;
    }

    console.log(`Categories updated for room ${roomCode}: ${room.selectedCategories.join(', ') || 'All categories'}`);
    
    return this.cleanRoomForSerialization(room);
  }

  // Get available questions for manual selection (excludes used questions)
  getAvailableQuestions(roomCode, allQuestions) {
    const room = this.rooms.get(roomCode);
    if (!room) return [];

    // Initialize used questions tracker if not exists
    if (!room.usedQuestions) {
      room.usedQuestions = new Set();
    } else if (Array.isArray(room.usedQuestions)) {
      // Convert back from array (after serialization) to Set
      room.usedQuestions = new Set(room.usedQuestions);
    }

    // Filter by selected categories if any
    let filteredQuestions = allQuestions;
    if (room.selectedCategories && room.selectedCategories.length > 0) {
      filteredQuestions = allQuestions.filter(q => 
        room.selectedCategories.includes(q.category || 'General')
      );
    }

    // Filter out used questions
    const availableQuestions = filteredQuestions.filter(q => !room.usedQuestions.has(q.id));
    
    console.log(`Available questions for room ${roomCode}: ${availableQuestions.length} (${room.usedQuestions.size} used, ${filteredQuestions.length} total in selected categories)`);
    
    return availableQuestions;
  }

  // Helper method to find room by GM socket ID
  findRoomByGMSocketId(gmSocketId) {
    console.log('[GameManager] Finding room for GM socket:', gmSocketId);
    for (const [roomCode, room] of this.rooms.entries()) {
      console.log('[GameManager] Checking room:', roomCode, 'GM ID:', room.gamemaster.id);
      if (room.gamemaster.id === gmSocketId) {
        console.log('[GameManager] Found room for GM:', roomCode);
        return { ...room, code: roomCode };
      }
    }
    console.log('[GameManager] No room found for GM socket:', gmSocketId);
    return null;
  }

  // Submit finale answer (new simultaneous mode)
  submitFinaleAnswer(roomCode, playerId, questionId, answer) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.isFinale) {
      console.log('[GameManager] Invalid finale answer submission:', { roomCode, playerId, questionId });
      return null;
    }

    // Store individual answers immediately (don't wait for both players)
    const activePlayers = room.players.filter(p => !p.isEliminated);
    
    // Find or create question data in evaluations array
    let questionData = room.finaleEvaluations.find(q => q.questionId === questionId);
    if (!questionData) {
      questionData = {
        questionId,
        question: room.finaleQuestions.find(q => q.id === questionId),
        answers: [],
        evaluations: null, // Will be filled when GM evaluates
        timestamp: Date.now()
      };
      room.finaleEvaluations.push(questionData);
    }
    
    // Remove any existing answer from this player for this question
    questionData.answers = questionData.answers.filter(a => a.playerId !== playerId);
    
    // Add the new answer to the stored question data
    const answerData = {
      playerId,
      questionId,
      answer: answer.trim(),
      timestamp: Date.now()
    };
    questionData.answers.push(answerData);

    console.log('[GameManager] Finale answer stored:', {
      playerId,
      questionId,
      totalQuestions: room.finaleEvaluations.length,
      playerAnswerCount: room.finaleEvaluations.filter(q => 
        q.answers.some(a => a.playerId === playerId)
      ).length
    });

    // Count how many questions each player has answered
    const playerAnswerCounts = {};
    activePlayers.forEach(p => {
      playerAnswerCounts[p.id] = room.finaleEvaluations.filter(q => 
        q.answers.some(a => a.playerId === p.id)
      ).length;
    });

    // Check if all players have answered all 10 questions
    const allPlayersFinished = activePlayers.every(player => 
      playerAnswerCounts[player.id] >= 10
    );

    if (allPlayersFinished) {
      // All questions answered by all players, move to evaluation phase
      room.finaleState = 'all-questions-complete';
      console.log('[GameManager] All 10 questions answered by all players, ready for GM evaluation');
      
      return {
        room,
        allQuestionsComplete: true,
        allEvaluations: room.finaleEvaluations,
        playerAnswered: playerId,
        playerAnswerCounts
      };
    }

    return {
      room,
      allQuestionsComplete: false,
      playerAnswered: playerId,
      playerAnswerCounts
    };
  }

  // GM evaluates a single question in real-time (new method)
  evaluateSingleFinaleQuestion(roomCode, questionId, evaluations) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.isFinale) {
      console.log('[GameManager] Invalid single finale evaluation:', { roomCode, questionId });
      return null;
    }

    // Find the question in evaluations array
    const questionData = room.finaleEvaluations.find(q => q.questionId === questionId);
    if (!questionData) {
      console.log('[GameManager] Question not found for evaluation:', questionId);
      return null;
    }

    // Validate evaluations format: { playerId: 'correct'|'incorrect', ... }
    const activePlayers = room.players.filter(p => !p.isEliminated);
    for (const player of activePlayers) {
      if (evaluations[player.id] && !['correct', 'incorrect'].includes(evaluations[player.id])) {
        console.log('[GameManager] Invalid evaluation for player:', player.id);
        return null;
      }
    }

    // Store evaluations in the question data
    questionData.evaluations = { ...questionData.evaluations, ...evaluations };

    // Update scores
    if (!room.finaleScores) room.finaleScores = {};
    for (const player of activePlayers) {
      if (!room.finaleScores[player.id]) room.finaleScores[player.id] = 0;
    }

    // Recalculate scores from all evaluated questions
    for (const player of activePlayers) {
      room.finaleScores[player.id] = 0;
    }
    
    room.finaleEvaluations.forEach(qData => {
      if (qData.evaluations) {
        for (const player of activePlayers) {
          if (qData.evaluations[player.id] === 'correct') {
            room.finaleScores[player.id]++;
          }
        }
      }
    });

    console.log('[GameManager] Single question evaluated:', {
      questionId,
      evaluations,
      updatedScores: room.finaleScores
    });

    return {
      room,
      questionId,
      evaluations,
      scores: room.finaleScores,
      questionData
    };
  }

  // GM evaluates ALL finale answers at once
  evaluateAllFinaleAnswers(roomCode, allEvaluations) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.isFinale || room.finaleState !== 'all-questions-complete') {
      console.log('[GameManager] Invalid finale evaluation:', { roomCode, finaleState: room?.finaleState });
      return null;
    }

    // Validate evaluations format: { questionId: { playerId: 'correct'|'incorrect', ... }, ... }
    const activePlayers = room.players.filter(p => !p.isEliminated);
    
    // Initialize scores
    if (!room.finaleScores) room.finaleScores = {};
    for (const player of activePlayers) {
      room.finaleScores[player.id] = 0;
    }

    // Update each question's evaluation and calculate scores
    for (let i = 0; i < room.finaleEvaluations.length; i++) {
      const questionData = room.finaleEvaluations[i];
      const questionId = questionData.questionId;
      const evaluations = allEvaluations[questionId];

      if (!evaluations) {
        console.log('[GameManager] Missing evaluations for question:', questionId);
        return null;
      }

      // Validate evaluations for this question
      for (const player of activePlayers) {
        if (!evaluations[player.id] || !['correct', 'incorrect'].includes(evaluations[player.id])) {
          console.log('[GameManager] Invalid evaluation for player:', player.id, 'question:', questionId);
          return null;
        }
      }

      // Store evaluations in the question data
      room.finaleEvaluations[i].evaluations = evaluations;

      // Update scores
      for (const player of activePlayers) {
        if (evaluations[player.id] === 'correct') {
          room.finaleScores[player.id]++;
        }
      }
    }

    console.log('[GameManager] All finale answers evaluated:', {
      scores: room.finaleScores,
      totalQuestions: room.finaleEvaluations.length
    });

    // Determine winner based on scores
    const winner = this.determineFinaleWinnerFromScores(room);
    room.gameState = 'finished';
    room.winner = winner;
    room.finaleState = 'complete';
    
    console.log('[GameManager] Finale complete, winner:', winner?.name);

    return {
      room,
      allEvaluations,
      scores: room.finaleScores,
      isComplete: true,
      winner,
      evaluatedQuestions: room.finaleEvaluations
    };
  }

  // Determine finale winner from scores
  determineFinaleWinnerFromScores(room) {
    const activePlayers = room.players.filter(p => !p.isEliminated);
    
    // Find winner (player with most correct answers)
    let winnerId = null;
    let maxScore = -1;
    Object.entries(room.finaleScores).forEach(([playerId, score]) => {
      if (score > maxScore) {
        maxScore = score;
        winnerId = playerId;
      }
    });
    
    return room.players.find(p => p.id === winnerId) || activePlayers[0];
  }

  // GM evaluates finale answers (legacy method - keep for compatibility)
  evaluateFinaleAnswers(roomCode, questionId, evaluations) {
    const room = this.rooms.get(roomCode);
    if (!room || !room.isFinale || room.finaleState !== 'evaluating') {
      console.log('[GameManager] Invalid finale evaluation:', { roomCode, questionId });
      return null;
    }

    // Validate evaluations format: { playerId: 'correct'|'incorrect', ... }
    const activePlayers = room.players.filter(p => !p.isEliminated);
    for (const player of activePlayers) {
      if (!evaluations[player.id] || !['correct', 'incorrect'].includes(evaluations[player.id])) {
        console.log('[GameManager] Invalid evaluation for player:', player.id);
        return null;
      }
    }

    // Store evaluations
    const evaluation = {
      questionId,
      question: room.finaleCurrentQuestion,
      answers: [...room.finaleCurrentAnswers],
      evaluations,
      timestamp: Date.now()
    };
    room.finaleEvaluations.push(evaluation);

    // Update scores
    if (!room.finaleScores) room.finaleScores = {};
    for (const player of activePlayers) {
      if (!room.finaleScores[player.id]) room.finaleScores[player.id] = 0;
      if (evaluations[player.id] === 'correct') {
        room.finaleScores[player.id]++;
      }
    }

    console.log('[GameManager] Finale answers evaluated:', {
      questionId,
      evaluations,
      scores: room.finaleScores,
      questionNumber: room.finaleEvaluations.length
    });

    // Check if finale is complete (10 questions answered)
    const isComplete = room.finaleEvaluations.length >= 10;
    let winner = null;

    if (isComplete) {
      // Determine winner based on scores
      winner = this.determineFinaleWinner(room);
      room.gameState = 'finished';
      room.winner = winner;
      room.finaleState = 'complete';
      console.log('[GameManager] Finale complete, winner:', winner?.name);
    } else {
      // Automatically start next question
      room.finaleState = 'waiting';
      room.finaleCurrentQuestion = null;
      room.finaleCurrentAnswers = [];
      
      // Auto-start next question
      this.autoStartNextFinaleQuestion(room);
    }

    return {
      room,
      evaluations,
      scores: room.finaleScores,
      isComplete,
      winner
    };
  }

  // Auto-start next finale question (internal method)
  autoStartNextFinaleQuestion(room) {
    if (!room || !room.isFinale || room.finaleState !== 'waiting') {
      return;
    }

    // Initialize finale questions if needed
    if (!room.finaleQuestions || room.finaleQuestions.length === 0) {
      // Get all questions - we need to initialize them
      // This should have been done when finale started, but just in case
      console.log('[GameManager] Warning: Finale questions not initialized, cannot auto-start');
      return;
    }

    // Get next question
    const questionIndex = room.finaleEvaluations.length;
    
    if (questionIndex >= room.finaleQuestions.length || questionIndex >= 10) {
      console.log('[GameManager] No more finale questions available or reached 10 questions');
      return;
    }

    const question = room.finaleQuestions[questionIndex];
    room.finaleCurrentQuestion = question;
    room.finaleCurrentAnswers = [];
    room.finaleState = 'answering';
    
    // Clear regular question fields to avoid confusion
    room.currentQuestion = null;
    room.targetPlayerId = null;

    console.log('[GameManager] Auto-started finale question:', {
      questionNumber: questionIndex + 1,
      questionId: question.id,
      question: question.question
    });
  }

  // Start next finale question (GM controlled)
  startNextFinaleQuestion(roomCode, questions) {
    const room = this.rooms.get(roomCode);
    console.log('[GameManager] startNextFinaleQuestion called:', {
      roomCode,
      roomExists: !!room,
      isFinale: room?.isFinale,
      finaleState: room?.finaleState,
      questionsLength: questions?.length || 0
    });

    // Allow both 'waiting' and 'answering' states because autoStartNextFinaleQuestion
    // may have already set the state to 'answering' after evaluation
    if (!room || !room.isFinale || (room.finaleState !== 'waiting' && room.finaleState !== 'answering')) {
      console.log('[GameManager] Cannot start next finale question:', {
        roomCode,
        isFinale: room?.isFinale,
        finaleState: room?.finaleState
      });
      return null;
    }

    // Initialize finale questions if needed
    if (!room.finaleQuestions || room.finaleQuestions.length === 0) {
      console.log('[GameManager] Initializing finale questions...');
      this.initializeFinaleQuestions(room, questions);
    }

    // Get next question
    const questionIndex = room.finaleEvaluations.length;
    console.log('[GameManager] Getting question at index:', questionIndex, 'of', room.finaleQuestions.length);
    
    if (questionIndex >= room.finaleQuestions.length) {
      console.log('[GameManager] No more finale questions available');
      return null;
    }

    const question = room.finaleQuestions[questionIndex];
    room.finaleCurrentQuestion = question;
    room.finaleCurrentAnswers = [];
    room.finaleState = 'answering';
    
    // Clear regular question fields to avoid confusion
    room.currentQuestion = null;
    room.targetPlayerId = null;

    console.log('[GameManager] Started finale question:', {
      questionNumber: questionIndex + 1,
      questionId: question.id,
      question: question.question,
      newFinaleState: room.finaleState
    });

    return room;
  }

  // Initialize finale questions
  initializeFinaleQuestions(room, questions) {
    // Filter questions by selected categories if any
    let availableQuestions = questions;
    if (room.selectedCategories && room.selectedCategories.length > 0) {
      availableQuestions = questions.filter(q => 
        room.selectedCategories.includes(q.category) || 
        (q.category === '' && room.selectedCategories.includes('General'))
      );
    }

    // Remove already used questions
    availableQuestions = availableQuestions.filter(q => !room.usedQuestions.has(q.id));

    // Shuffle questions
    for (let i = availableQuestions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [availableQuestions[i], availableQuestions[j]] = [availableQuestions[j], availableQuestions[i]];
    }

    // Take up to 10 questions for finale
    room.finaleQuestions = availableQuestions.slice(0, Math.min(availableQuestions.length, 10));
    
    console.log(`[GameManager] Finale questions initialized: ${room.finaleQuestions.length} questions`);
    
    if (room.finaleQuestions.length < 10) {
      console.warn(`[GameManager] Warning: Only ${room.finaleQuestions.length} questions available for finale`);
    }
  }

  // Updated finale winner determination
  determineFinaleWinner(room) {
    const activePlayers = room.players.filter(p => !p.isEliminated);
    if (activePlayers.length !== 2) return null;

    const scores = room.finaleScores || {};
    const player1Score = scores[activePlayers[0].id] || 0;
    const player2Score = scores[activePlayers[1].id] || 0;

    console.log('[GameManager] Finale scores:', {
      [activePlayers[0].name]: player1Score,
      [activePlayers[1].name]: player2Score
    });

    if (player1Score > player2Score) {
      return activePlayers[0];
    } else if (player2Score > player1Score) {
      return activePlayers[1];
    } else {
      // Tie - could implement tiebreaker logic here
      // For now, return first player
      console.log('[GameManager] Finale ended in tie, defaulting to first player');
      return activePlayers[0];
    }
  }

  // Toggle showing questions to players during voting
  toggleShowQuestionsToPlayers(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room || room.gameState !== 'voting') {
      return null;
    }

    room.showQuestionsToPlayers = !room.showQuestionsToPlayers;
    console.log(`[GameManager] Questions visibility for players in room ${roomCode}: ${room.showQuestionsToPlayers ? 'SHOWN' : 'HIDDEN'}`);
    
    return this.cleanRoomForSerialization(room);
  }

  // Report game state to GameBuddies
  reportGameStateToGameBuddies(room) {
    if (!this.gameBuddiesService || !room.isGameBuddiesRoom) {
      return; // Only report for GameBuddies rooms
    }

    try {
      const gameState = {
        gameState: room.gameState,
        players: room.players.map(p => ({
          id: p.id,
          name: p.name,
          lives: p.lives,
          isEliminated: p.isEliminated
        })),
        roundNumber: room.roundNumber,
        isFinale: room.isFinale,
        winner: room.winner,
        currentQuestion: room.currentQuestion ? {
          id: room.currentQuestion.id,
          question: room.currentQuestion.question
        } : null,
        targetPlayerId: room.targetPlayerId
      };

      this.gameBuddiesService.reportGameState(room.code, gameState);
      console.log(`[GameBuddies] Game state reported for room ${room.code}:`, gameState.gameState);
    } catch (error) {
      console.error(`[GameBuddies] Failed to report game state for room ${room.code}:`, error.message);
    }
  }
}

export default GameManager; 
