# Create New Game Guide - GameBuddies Platform

This guide shows you how to create a new multiplayer game using the GamebuddiesTemplate and GameBuddiesGameServer together.

## Table of Contents
1. [Quick Start (30 minutes)](#quick-start-30-minutes)
2. [Architecture Decision](#architecture-decision)
3. [Step-by-Step Implementation](#step-by-step-implementation)
4. [Game Examples](#game-examples)
5. [Testing & Debugging](#testing--debugging)
6. [Deployment](#deployment)

---

## Quick Start (30 minutes)

Create a simple number guessing game in 30 minutes:

### 1. Clone the Template
```bash
# Clone GamebuddiesTemplate
cp -r GamebuddiesTemplate MyNumberGame
cd MyNumberGame
```

### 2. Create Game Plugin
Create `GameBuddieGamesServer/games/number-game/plugin.ts`:

```typescript
import type { GamePlugin, Room, Player, SocketEventHandler } from '../../core/types/core.js';

interface NumberGameState {
  targetNumber: number;
  guesses: Array<{ player: string; guess: number; }>;
  winner: string | null;
}

class NumberGamePlugin implements GamePlugin {
  id = 'number-game';
  name = 'Number Guessing Game';
  namespace = '/number-game';

  defaultSettings = {
    minPlayers: 2,
    maxPlayers: 8,
    gameSpecific: {
      minNumber: 1,
      maxNumber: 100
    }
  };

  onRoomCreate(room: Room): void {
    room.gameState.data = {
      targetNumber: 0,
      guesses: [],
      winner: null
    };
  }

  onPlayerJoin(room: Room, player: Player): void {
    player.gameData = { score: 0 };
  }

  serializeRoom(room: Room, socketId: string): any {
    return {
      code: room.code,
      hostId: room.hostId,
      players: Array.from(room.players.values()),
      state: room.gameState.phase,
      gameData: room.gameState.data,
      mySocketId: socketId
    };
  }

  socketHandlers = {
    'game:start': async (socket, data, room, helpers) => {
      const { minNumber, maxNumber } = room.settings.gameSpecific;
      const gameState = room.gameState.data as NumberGameState;

      // Generate random target number
      gameState.targetNumber = Math.floor(Math.random() * (maxNumber - minNumber + 1)) + minNumber;
      gameState.guesses = [];
      gameState.winner = null;
      room.gameState.phase = 'playing';

      // Notify players
      helpers.sendToRoom(room.code, 'game:started', {
        min: minNumber,
        max: maxNumber
      });
    },

    'game:guess': async (socket, data: { guess: number }, room, helpers) => {
      const gameState = room.gameState.data as NumberGameState;
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);

      if (!player || room.gameState.phase !== 'playing') return;

      // Record guess
      gameState.guesses.push({ player: player.name, guess: data.guess });

      // Check if correct
      if (data.guess === gameState.targetNumber) {
        gameState.winner = player.name;
        room.gameState.phase = 'ended';

        helpers.sendToRoom(room.code, 'game:won', {
          winner: player.name,
          targetNumber: gameState.targetNumber
        });
      } else {
        const hint = data.guess < gameState.targetNumber ? 'higher' : 'lower';
        socket.emit('game:hint', { hint });
      }
    }
  };
}

export default new NumberGamePlugin();
```

### 3. Update Client Connection
Edit `MyNumberGame/client/src/services/socketService.ts`:

```typescript
const NAMESPACE = '/number-game'; // Add namespace

// In connect():
this.socket = io(`${SERVER_URL}${NAMESPACE}`, {
  // ... options
});
```

### 4. Create Game UI
Edit `MyNumberGame/client/src/components/GameComponent.tsx`:

```typescript
import React, { useState } from 'react';

const GameComponent = ({ lobby, socket }) => {
  const [guess, setGuess] = useState('');
  const [hint, setHint] = useState('');

  socket.on('game:started', (data) => {
    setHint(`Guess a number between ${data.min} and ${data.max}`);
  });

  socket.on('game:hint', (data) => {
    setHint(`Go ${data.hint}!`);
  });

  socket.on('game:won', (data) => {
    setHint(`${data.winner} won! The number was ${data.targetNumber}`);
  });

  const handleGuess = () => {
    socket.emit('game:guess', { guess: parseInt(guess) });
    setGuess('');
  };

  return (
    <div>
      <h2>Number Guessing Game</h2>
      <p>{hint}</p>
      {lobby.state === 'PLAYING' && (
        <div>
          <input
            type="number"
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
          />
          <button onClick={handleGuess}>Guess!</button>
        </div>
      )}
    </div>
  );
};

export default GameComponent;
```

### 5. Register & Run
```bash
# Register in unified server
# Edit GameBuddieGamesServer/core/server.ts:
# import numberGamePlugin from '../games/number-game/plugin.js';
# this.gameRegistry.registerGame(numberGamePlugin);

# Run both servers
cd GameBuddieGamesServer && npm run dev
cd ../MyNumberGame && npm run dev
```

**Done! You have a working multiplayer game in 30 minutes!**

---

## Architecture Decision

### When to Use Unified Server vs Template Server

#### Use Unified Server When:
- ✅ You want shared infrastructure (chat, video, sessions)
- ✅ You're building multiple games
- ✅ You want centralized deployment
- ✅ You need consistent features across games
- ✅ You want easier maintenance

#### Use Template Server When:
- ✅ You need complete control over server logic
- ✅ You're building a single standalone game
- ✅ You have very custom requirements
- ✅ You want independent deployment
- ✅ You're prototyping quickly

### Architecture Comparison

```
Option 1: Unified Server (Recommended for Platform)
┌─────────────────────────────────────────┐
│         Unified Game Server             │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐│
│  │  Game 1  │ │  Game 2  │ │ Game 3  ││
│  │  Plugin  │ │  Plugin  │ │ Plugin  ││
│  └──────────┘ └──────────┘ └─────────┘│
│  ┌────────────────────────────────────┐│
│  │    Shared Infrastructure           ││
│  │  • RoomManager  • SessionManager   ││
│  │  • Chat System  • WebRTC           ││
│  │  • GameBuddies  • Reconnection     ││
│  └────────────────────────────────────┘│
└─────────────────────────────────────────┘

Option 2: Template Server (Quick Prototyping)
┌──────────┐ ┌──────────┐ ┌──────────┐
│  Game 1  │ │  Game 2  │ │  Game 3  │
│  Server  │ │  Server  │ │  Server  │
│          │ │          │ │          │
│ Template │ │ Template │ │ Template │
│   Copy   │ │   Copy   │ │   Copy   │
└──────────┘ └──────────┘ └──────────┘
```

---

## Step-by-Step Implementation

### Phase 1: Planning Your Game

#### 1.1 Define Core Mechanics
```typescript
// What is your game about?
interface GameConcept {
  name: "Trivia Battle";
  type: "Question/Answer";
  players: "2-8";
  duration: "10-15 minutes";
  core_loop: "Answer questions → Score points → Winner";
}
```

#### 1.2 Define Data Structures
```typescript
// What data do you need?
interface GameState {
  questions: Question[];
  currentQuestionIndex: number;
  scores: Map<string, number>;
  timer: number;
}

interface PlayerData {
  score: number;
  currentAnswer: string | null;
  answerTime: number;
}

interface Question {
  text: string;
  options: string[];
  correctAnswer: number;
  category: string;
}
```

#### 1.3 Define Events
```typescript
// What actions can players take?
type GameEvents =
  | 'game:start'
  | 'game:submit-answer'
  | 'game:next-question'
  | 'game:end'
  | 'game:timeout';
```

### Phase 2: Server Implementation

#### 2.1 Create Plugin Structure
```
GameBuddieGamesServer/games/trivia-battle/
├── plugin.ts         # Main plugin file
├── types.ts         # Type definitions
├── questions.json   # Game data
└── utils.ts        # Helper functions
```

#### 2.2 Implement Plugin Class
```typescript
// games/trivia-battle/plugin.ts
import type { GamePlugin, Room, Player } from '../../core/types/core.js';
import { loadQuestions, shuffleArray, calculateScore } from './utils.js';
import type { TriviaGameState, TriviaPlayerData } from './types.js';

class TriviaBattlePlugin implements GamePlugin {
  id = 'trivia-battle';
  name = 'Trivia Battle';
  namespace = '/trivia';
  basePath = '/trivia';

  private io: any;
  private timers = new Map<string, NodeJS.Timeout>();

  defaultSettings = {
    minPlayers: 2,
    maxPlayers: 8,
    gameSpecific: {
      questionsPerRound: 10,
      timePerQuestion: 30,
      categories: ['science', 'history', 'sports']
    }
  };

  async onInitialize(io: any): Promise<void> {
    this.io = io;
    // Load questions from file/database
    await loadQuestions();
  }

  onRoomCreate(room: Room): void {
    room.gameState.data = {
      questions: [],
      currentQuestionIndex: -1,
      scores: new Map(),
      timer: 0
    } as TriviaGameState;
  }

  onPlayerJoin(room: Room, player: Player): void {
    player.gameData = {
      score: 0,
      currentAnswer: null,
      answerTime: 0
    } as TriviaPlayerData;

    const gameState = room.gameState.data as TriviaGameState;
    gameState.scores.set(player.id, 0);
  }

  onPlayerLeave(room: Room, player: Player): void {
    // Clean up player data
    const gameState = room.gameState.data as TriviaGameState;
    gameState.scores.delete(player.id);

    // Clear any timers
    const timerKey = `${room.code}:question`;
    if (this.timers.has(timerKey)) {
      clearTimeout(this.timers.get(timerKey)!);
      this.timers.delete(timerKey);
    }
  }

  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as TriviaGameState;
    const currentQuestion = gameState.questions[gameState.currentQuestionIndex];

    return {
      code: room.code,
      hostId: room.hostId,
      players: Array.from(room.players.values()).map(p => ({
        socketId: p.socketId,
        name: p.name,
        score: (p.gameData as TriviaPlayerData)?.score || 0,
        connected: p.connected,
        isHost: p.isHost,
        hasAnswered: (p.gameData as TriviaPlayerData)?.currentAnswer !== null
      })),
      state: room.gameState.phase,
      gameData: {
        currentQuestion: currentQuestion ? {
          text: currentQuestion.text,
          options: currentQuestion.options,
          // Don't send correct answer until time is up
        } : null,
        questionNumber: gameState.currentQuestionIndex + 1,
        totalQuestions: gameState.questions.length,
        timer: gameState.timer,
        scores: Array.from(gameState.scores.entries()).map(([id, score]) => ({
          playerId: id,
          playerName: room.players.get(id)?.name || 'Unknown',
          score
        }))
      },
      mySocketId: socketId,
      settings: room.settings
    };
  }

  private broadcastState(room: Room): void {
    if (!this.io) return;

    const namespace = this.io.of(this.namespace);
    room.players.forEach(player => {
      const serialized = this.serializeRoom(room, player.socketId);
      namespace.to(player.socketId).emit('roomStateUpdated', serialized);
    });
  }

  private startQuestionTimer(room: Room): void {
    const gameState = room.gameState.data as TriviaGameState;
    const timerKey = `${room.code}:question`;

    // Clear existing timer
    if (this.timers.has(timerKey)) {
      clearTimeout(this.timers.get(timerKey)!);
    }

    // Start countdown
    gameState.timer = room.settings.gameSpecific.timePerQuestion;

    const countdown = setInterval(() => {
      gameState.timer--;

      if (gameState.timer <= 0) {
        clearInterval(countdown);
        this.endQuestion(room);
      } else {
        // Broadcast timer update
        const namespace = this.io.of(this.namespace);
        namespace.to(room.code).emit('timer:update', { timer: gameState.timer });
      }
    }, 1000);

    this.timers.set(timerKey, countdown as any);
  }

  private endQuestion(room: Room): void {
    const gameState = room.gameState.data as TriviaGameState;
    const currentQuestion = gameState.questions[gameState.currentQuestionIndex];

    // Calculate scores
    room.players.forEach(player => {
      const playerData = player.gameData as TriviaPlayerData;

      if (playerData.currentAnswer === currentQuestion.options[currentQuestion.correctAnswer]) {
        const timeBonus = Math.floor((room.settings.gameSpecific.timePerQuestion - playerData.answerTime) / 2);
        const points = 100 + timeBonus;

        playerData.score += points;
        gameState.scores.set(player.id, playerData.score);
      }

      // Reset for next question
      playerData.currentAnswer = null;
      playerData.answerTime = 0;
    });

    // Show correct answer
    const namespace = this.io.of(this.namespace);
    namespace.to(room.code).emit('question:result', {
      correctAnswer: currentQuestion.options[currentQuestion.correctAnswer],
      scores: Array.from(gameState.scores.entries()).map(([id, score]) => ({
        playerId: id,
        playerName: room.players.get(id)?.name || 'Unknown',
        score
      }))
    });

    // Move to next question or end game
    setTimeout(() => {
      if (gameState.currentQuestionIndex < gameState.questions.length - 1) {
        this.nextQuestion(room);
      } else {
        this.endGame(room);
      }
    }, 3000);
  }

  private nextQuestion(room: Room): void {
    const gameState = room.gameState.data as TriviaGameState;

    gameState.currentQuestionIndex++;
    this.startQuestionTimer(room);
    this.broadcastState(room);
  }

  private endGame(room: Room): void {
    const gameState = room.gameState.data as TriviaGameState;
    room.gameState.phase = 'ended';

    // Calculate final scores
    const finalScores = Array.from(gameState.scores.entries())
      .map(([id, score]) => ({
        playerId: id,
        playerName: room.players.get(id)?.name || 'Unknown',
        score
      }))
      .sort((a, b) => b.score - a.score);

    // Announce winner
    const namespace = this.io.of(this.namespace);
    namespace.to(room.code).emit('game:ended', {
      winner: finalScores[0],
      finalScores
    });

    this.broadcastState(room);
  }

  socketHandlers = {
    'game:start': async (socket, data, room, helpers) => {
      // Validate host
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only host can start the game' });
        return;
      }

      // Load questions
      const gameState = room.gameState.data as TriviaGameState;
      gameState.questions = shuffleArray(await loadQuestions())
        .slice(0, room.settings.gameSpecific.questionsPerRound);
      gameState.currentQuestionIndex = 0;

      // Start game
      room.gameState.phase = 'playing';
      this.startQuestionTimer(room);

      helpers.sendToRoom(room.code, 'game:started', {});
      this.broadcastState(room);
    },

    'game:submit-answer': async (socket, data: { answer: string }, room, helpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player || room.gameState.phase !== 'playing') return;

      const playerData = player.gameData as TriviaPlayerData;
      const gameState = room.gameState.data as TriviaGameState;

      // Record answer if not already answered
      if (playerData.currentAnswer === null) {
        playerData.currentAnswer = data.answer;
        playerData.answerTime = room.settings.gameSpecific.timePerQuestion - gameState.timer;

        socket.emit('answer:accepted', { answer: data.answer });

        // Check if all players have answered
        const allAnswered = Array.from(room.players.values())
          .filter(p => p.connected)
          .every(p => (p.gameData as TriviaPlayerData).currentAnswer !== null);

        if (allAnswered) {
          // End question early
          this.endQuestion(room);
        }

        this.broadcastState(room);
      }
    },

    'game:end': async (socket, data, room, helpers) => {
      const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
      if (!player?.isHost) {
        socket.emit('error', { message: 'Only host can end the game' });
        return;
      }

      this.endGame(room);
    }
  };
}

export default new TriviaBattlePlugin();
```

### Phase 3: Client Implementation

#### 3.1 Update Socket Service
```typescript
// client/src/services/socketService.ts
const NAMESPACE = '/trivia'; // Your game namespace

class SocketService {
  connect(): Socket {
    const SERVER_URL = getServerUrl();
    this.socket = io(`${SERVER_URL}${NAMESPACE}`, {
      // ... options
    });
    return this.socket;
  }
}
```

#### 3.2 Create Game Components
```typescript
// client/src/components/TriviaGame.tsx
import React, { useState, useEffect } from 'react';
import { Socket } from 'socket.io-client';

interface TriviaGameProps {
  lobby: any;
  socket: Socket;
}

const TriviaGame: React.FC<TriviaGameProps> = ({ lobby, socket }) => {
  const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
  const [timer, setTimer] = useState(0);
  const [showResult, setShowResult] = useState(false);
  const [correctAnswer, setCorrectAnswer] = useState<string>('');

  useEffect(() => {
    socket.on('timer:update', (data) => {
      setTimer(data.timer);
    });

    socket.on('question:result', (data) => {
      setCorrectAnswer(data.correctAnswer);
      setShowResult(true);
      setTimeout(() => {
        setShowResult(false);
        setSelectedAnswer(null);
      }, 3000);
    });

    socket.on('game:ended', (data) => {
      // Show final scores
      console.log('Game ended!', data.finalScores);
    });

    return () => {
      socket.off('timer:update');
      socket.off('question:result');
      socket.off('game:ended');
    };
  }, [socket]);

  const handleSubmitAnswer = (answer: string) => {
    if (selectedAnswer) return; // Already answered

    setSelectedAnswer(answer);
    socket.emit('game:submit-answer', { answer });
  };

  const currentQuestion = lobby.gameData?.currentQuestion;

  if (lobby.state !== 'playing') {
    return <div>Waiting for game to start...</div>;
  }

  if (showResult) {
    return (
      <div className="result-screen">
        <h2>Correct Answer: {correctAnswer}</h2>
        <div className="scores">
          {lobby.gameData.scores.map((score: any) => (
            <div key={score.playerId}>
              {score.playerName}: {score.score} points
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="trivia-game">
      <div className="question-header">
        <span>Question {lobby.gameData.questionNumber} of {lobby.gameData.totalQuestions}</span>
        <span className="timer">Time: {timer}s</span>
      </div>

      <div className="question">
        <h2>{currentQuestion?.text}</h2>
        <div className="options">
          {currentQuestion?.options.map((option: string, index: number) => (
            <button
              key={index}
              onClick={() => handleSubmitAnswer(option)}
              className={`option ${selectedAnswer === option ? 'selected' : ''}`}
              disabled={selectedAnswer !== null}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div className="players-status">
        {lobby.players.map((player: any) => (
          <div key={player.socketId} className={player.hasAnswered ? 'answered' : 'thinking'}>
            {player.name}: {player.hasAnswered ? '✓' : '🤔'}
          </div>
        ))}
      </div>
    </div>
  );
};

export default TriviaGame;
```

#### 3.3 Update App.tsx
```typescript
// client/src/App.tsx
import TriviaGame from './components/TriviaGame';

// In renderContent():
case 'PLAYING':
  return <TriviaGame lobby={lobby} socket={socket!} />;
```

### Phase 4: Add Polish

#### 4.1 Add Animations
```css
/* client/src/styles/game.css */
.option {
  transition: all 0.3s ease;
  transform: scale(1);
}

.option:hover {
  transform: scale(1.05);
  box-shadow: 0 4px 8px rgba(0,0,0,0.2);
}

.option.selected {
  background: var(--primary);
  animation: pulse 0.5s;
}

@keyframes pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

.timer {
  color: var(--danger);
  font-weight: bold;
  animation: flash 1s infinite;
}

.timer.low-time {
  animation: flash 0.5s infinite;
}

@keyframes flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

#### 4.2 Add Sound Effects
```typescript
// client/src/utils/sounds.ts
class SoundManager {
  private sounds = {
    correct: new Audio('/sounds/correct.mp3'),
    wrong: new Audio('/sounds/wrong.mp3'),
    tick: new Audio('/sounds/tick.mp3'),
    gameStart: new Audio('/sounds/start.mp3'),
    gameEnd: new Audio('/sounds/end.mp3')
  };

  play(sound: keyof typeof this.sounds) {
    this.sounds[sound].play().catch(e => {
      console.log('Sound play failed:', e);
    });
  }
}

export const soundManager = new SoundManager();

// Use in component:
socket.on('answer:result', (data) => {
  if (data.correct) {
    soundManager.play('correct');
  } else {
    soundManager.play('wrong');
  }
});
```

#### 4.3 Add Mobile Support
```tsx
// client/src/hooks/useMobileDetection.ts
export const useMobileDetection = () => {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  return isMobile;
};

// Use in component:
const isMobile = useMobileDetection();

return (
  <div className={`game-container ${isMobile ? 'mobile' : 'desktop'}`}>
    {/* Game UI */}
  </div>
);
```

---

## Game Examples

### Example 1: Drawing Game
```typescript
// Similar to Pictionary
interface DrawingGameState {
  currentDrawer: string;
  currentWord: string;
  canvas: string; // Base64 image
  guesses: Array<{ player: string; guess: string; }>;
  timeRemaining: number;
}

socketHandlers = {
  'canvas:draw': async (socket, data: { drawing: string }, room, helpers) => {
    // Broadcast drawing to all except drawer
    socket.to(room.code).emit('canvas:update', { drawing: data.drawing });
  },

  'game:guess': async (socket, data: { guess: string }, room, helpers) => {
    const gameState = room.gameState.data as DrawingGameState;

    if (data.guess.toLowerCase() === gameState.currentWord.toLowerCase()) {
      // Correct guess!
      helpers.sendToRoom(room.code, 'guess:correct', {
        player: player.name,
        word: gameState.currentWord
      });

      // Award points and move to next round
      this.nextRound(room);
    } else {
      // Show guess to everyone
      helpers.sendToRoom(room.code, 'guess:wrong', {
        player: player.name,
        guess: data.guess
      });
    }
  }
};
```

### Example 2: Card Game
```typescript
// Similar to UNO
interface CardGameState {
  deck: Card[];
  discardPile: Card[];
  currentPlayer: string;
  direction: 1 | -1;
  currentColor: string;
}

interface CardPlayerData {
  hand: Card[];
  uno: boolean; // Called uno?
}

socketHandlers = {
  'card:play': async (socket, data: { card: Card }, room, helpers) => {
    const player = findPlayer(socket.id);
    const playerData = player.gameData as CardPlayerData;

    // Validate card can be played
    if (!isValidPlay(data.card, gameState.discardPile[0])) {
      socket.emit('error', { message: 'Invalid card' });
      return;
    }

    // Remove from hand
    playerData.hand = playerData.hand.filter(c => c.id !== data.card.id);

    // Add to discard
    gameState.discardPile.unshift(data.card);

    // Apply card effects
    applyCardEffect(data.card, room);

    // Move to next player
    gameState.currentPlayer = getNextPlayer(room);

    // Check win condition
    if (playerData.hand.length === 0) {
      this.endGame(room, player);
    }

    this.broadcastState(room);
  },

  'card:draw': async (socket, data, room, helpers) => {
    const playerData = player.gameData as CardPlayerData;

    // Draw cards from deck
    const drawnCards = gameState.deck.splice(0, 1);
    playerData.hand.push(...drawnCards);

    socket.emit('cards:drawn', { cards: drawnCards });
    this.broadcastState(room);
  }
};
```

### Example 3: Real-time Strategy
```typescript
// Similar to .io games
interface StrategyGameState {
  map: Tile[][];
  units: Unit[];
  resources: Map<string, number>;
  tick: number;
}

// Use game loop
onRoomCreate(room: Room): void {
  this.startGameLoop(room);
}

private startGameLoop(room: Room): void {
  const loopId = setInterval(() => {
    const gameState = room.gameState.data as StrategyGameState;

    // Update all units
    gameState.units.forEach(unit => {
      this.updateUnit(unit, gameState);
    });

    // Check collisions
    this.checkCollisions(gameState);

    // Update resources
    this.updateResources(room);

    // Increment tick
    gameState.tick++;

    // Broadcast state (throttled)
    if (gameState.tick % 3 === 0) { // Every 3 ticks
      this.broadcastState(room);
    }
  }, 100); // 10 updates per second

  this.gameLoops.set(room.code, loopId);
}

socketHandlers = {
  'unit:move': async (socket, data: { unitId: string; target: Point }, room) => {
    const unit = gameState.units.find(u => u.id === data.unitId);
    if (unit && unit.owner === player.id) {
      unit.targetPosition = data.target;
    }
  },

  'unit:attack': async (socket, data: { unitId: string; targetId: string }, room) => {
    const unit = gameState.units.find(u => u.id === data.unitId);
    const target = gameState.units.find(u => u.id === data.targetId);

    if (unit && target && unit.owner === player.id) {
      unit.target = target;
    }
  }
};
```

---

## Testing & Debugging

### Local Testing Setup
```bash
# Terminal 1: Run unified server
cd GameBuddieGamesServer
npm run dev

# Terminal 2: Run client
cd MyGame/client
npm run dev

# Terminal 3: Run another client instance
npx http-server -p 5174
```

### Debug Tools

#### 1. Socket.IO Admin UI
```typescript
// In unified server
import { instrument } from '@socket.io/admin-ui';

instrument(io, {
  auth: false,
  mode: 'development'
});

// Visit http://localhost:3001/admin
```

#### 2. Custom Debug Panel
```tsx
// client/src/components/DebugPanel.tsx
const DebugPanel = ({ socket, lobby }) => {
  const [events, setEvents] = useState<any[]>([]);

  useEffect(() => {
    const originalEmit = socket.emit.bind(socket);
    socket.emit = (...args: any[]) => {
      setEvents(prev => [...prev, { type: 'emit', event: args[0], data: args[1] }]);
      return originalEmit(...args);
    };

    const events = ['roomStateUpdated', 'error', 'game:started'];
    events.forEach(event => {
      socket.on(event, (data) => {
        setEvents(prev => [...prev, { type: 'on', event, data }]);
      });
    });
  }, [socket]);

  return (
    <div className="debug-panel">
      <h3>Debug Events</h3>
      <div className="events-log">
        {events.map((e, i) => (
          <div key={i} className={e.type}>
            [{e.type}] {e.event}: {JSON.stringify(e.data)}
          </div>
        ))}
      </div>
      <div className="lobby-state">
        <h4>Lobby State</h4>
        <pre>{JSON.stringify(lobby, null, 2)}</pre>
      </div>
    </div>
  );
};
```

#### 3. Network Simulation
```typescript
// Test with Chrome DevTools
// Network tab → Throttling → Slow 3G

// Or programmatically:
socket.on('connect', () => {
  // Simulate lag
  setTimeout(() => {
    socket.emit('room:join', data);
  }, 2000);
});
```

### Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| Players array undefined | Serialization missing | Always convert Map to Array in serializeRoom |
| Events not received | Wrong namespace | Check client connects to correct namespace |
| State out of sync | Missing broadcast | Call broadcastState after every change |
| Reconnection fails | Session token lost | Store token in sessionStorage |
| WebRTC not working | TURN servers | Configure TURN credentials |
| Memory leak | Timers not cleared | Clear all timers in onPlayerLeave |

### Testing Checklist

#### Functionality
- [ ] Create room
- [ ] Join room
- [ ] Start game
- [ ] Game actions work
- [ ] End game
- [ ] Restart game

#### Multiplayer
- [ ] 2 players minimum
- [ ] Max players enforced
- [ ] Turn-based logic
- [ ] Real-time updates
- [ ] No race conditions

#### Edge Cases
- [ ] Host leaves (transfer)
- [ ] All players disconnect
- [ ] Rapid actions
- [ ] Network lag
- [ ] Server restart

#### Performance
- [ ] 8+ players smooth
- [ ] Large state updates
- [ ] Mobile performance
- [ ] Memory usage stable

---

## Deployment

### Production Build

#### Build Plugin
```bash
cd GameBuddieGamesServer
npm run build

# Plugin is compiled to dist/
```

#### Build Client
```bash
cd MyGame/client
npm run build

# Static files in dist/
```

### Environment Configuration

#### Production Server
```env
# .env.production
NODE_ENV=production
PORT=3001
GAMEBUDDIES_API_KEY=your-production-key
```

#### Production Client
```env
# client/.env.production
VITE_BACKEND_URL=https://games.yourdomain.com
VITE_GAME_NAMESPACE=/your-game
```

### Deployment Options

#### Option 1: Single Server (Recommended)
```
Deploy unified server with all games:
- games.yourdomain.com
  - /trivia
  - /drawing
  - /cards

Deploy clients as static sites:
- trivia.yourdomain.com
- drawing.yourdomain.com
- cards.yourdomain.com
```

#### Option 2: Microservices
```
Each game gets own server instance:
- trivia-server.yourdomain.com
- drawing-server.yourdomain.com

But all share same codebase
```

### Render.com Deployment

#### Server (Web Service)
```yaml
Build Command: npm install && npm run build
Start Command: npm start
Environment: Node
Port: 3001
```

#### Client (Static Site)
```yaml
Build Command: cd client && npm install && npm run build
Publish Directory: client/dist
```

### Docker Deployment
```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy server
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

# Copy client
COPY client/dist ./public

EXPOSE 3001

CMD ["npm", "start"]
```

### Monitoring

#### Health Check Endpoint
```typescript
// Unified server includes health check
// GET /health
{
  "status": "ok",
  "games": ["trivia", "drawing", "cards"],
  "rooms": 15,
  "players": 127
}
```

#### Logging
```typescript
// Use structured logging
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// In plugin
logger.info('Game started', {
  game: this.id,
  room: room.code,
  players: room.players.size
});
```

---

## Best Practices

### 1. State Management
- Server is source of truth
- Validate all client inputs
- Use optimistic updates carefully
- Broadcast full state on changes

### 2. Performance
- Throttle broadcasts (not every frame)
- Paginate large lists
- Use binary data for real-time games
- Clean up resources (timers, listeners)

### 3. Security
- Validate all inputs
- Check permissions (host-only actions)
- Rate limit actions
- Sanitize user content

### 4. User Experience
- Show loading states
- Handle errors gracefully
- Provide feedback for actions
- Support mobile devices

### 5. Development
- Use TypeScript for type safety
- Write tests for game logic
- Document socket events
- Version your API

---

## Next Steps

1. **Choose your game type** (turn-based, real-time, etc.)
2. **Set up development environment** with both servers
3. **Create minimal prototype** (30-min quick start)
4. **Iterate and add features** incrementally
5. **Test with real players** early and often
6. **Deploy to production** when stable

For more examples, check out the existing games in `GameBuddieGamesServer/games/`

Happy game building! 🎮