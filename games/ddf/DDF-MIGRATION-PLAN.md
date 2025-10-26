# DDF Migration to Unified Game Server - Complete Plan

**Date:** 2025-10-24
**Status:** Planning Complete, Ready for Implementation
**Pattern:** Game Manager Wrapper (SUSD-style)
**Complexity:** High (Most Complex Game Yet)
**Estimated Time:** 12-16 hours

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Architecture Analysis](#current-architecture-analysis)
3. [Migration Strategy](#migration-strategy)
4. [Complete Event Mapping](#complete-event-mapping)
5. [Implementation Plan](#implementation-plan)
6. [Critical Considerations](#critical-considerations)
7. [Testing Checklist](#testing-checklist)
8. [Potential Pitfalls](#potential-pitfalls)

---

## Executive Summary

### Game Overview

**DDF (Dumb/Die/Final)** is a real-time multiplayer quiz game where:
- Players answer questions **verbally** (voice chat required)
- Gamemaster (GM) controls game flow and rates answers
- Players vote on the "dumbest" answer each round
- Player with most votes loses a life (3 lives total)
- Last player standing wins
- **Finale Mode**: 2 remaining players answer 10 questions simultaneously
- Full GameBuddies integration (already implemented)
- Advanced WebRTC video chat with AI-powered virtual backgrounds

### Complexity Metrics

| Metric | Count | Notes |
|--------|-------|-------|
| Socket Events (Client → Server) | 24 | Game-specific only |
| Socket Events (Server → Client) | 18 | Game-specific only |
| Game States | 6 | lobby, playing, voting, tie-breaking, finale, finished |
| Code Files | ~10 | Server + Client |
| Lines of Game Logic | ~2,900 | GameManager + Enhanced + Question |
| UI Components | ~15 | Complex GM and player interfaces |
| Features | 10+ | Questions, Timer, Voting, Finale, WebRTC, etc. |

### Why This Migration Is Critical

1. **GameBuddies Platform Integration**: Already has full integration, needs to work on unified server
2. **Code Consolidation**: Reduce duplication across games
3. **Shared Infrastructure**: Leverage core for room/player/chat/WebRTC management
4. **Scalability**: Single server can host multiple games
5. **Maintenance**: Easier to maintain all games in one place

---

## Current Architecture Analysis

### Standalone Server Structure

```
DDF/
├── server/
│   ├── server.js (1,680 lines)              # Main server + all socket handlers
│   ├── game/
│   │   ├── GameManager.js (2,426 lines)     # Core game logic
│   │   ├── EnhancedGameManager.js (492 lines) # DB integration
│   │   └── QuestionManager.js (~300 lines)  # Question CRUD
│   ├── services/
│   │   └── gameBuddiesService.js            # GameBuddies API client
│   └── data/
│       └── questions.json                    # Question storage
└── client/
    ├── src/
    │   ├── stores/
    │   │   └── unifiedStore.ts (677 lines)  # Zustand state management
    │   ├── services/
    │   │   ├── socketService.ts (253 lines) # Socket.IO client
    │   │   ├── GameBuddiesIntegration.js    # GB session management
    │   │   └── virtualBackgroundService.ts  # AI background processing
    │   ├── pages/
    │   │   ├── HomePage.tsx                  # Landing/join page
    │   │   ├── LobbyPage.tsx                 # Pre-game lobby
    │   │   ├── GamePage.tsx                  # Main game page
    │   │   └── AdminPage.tsx                 # Question management
    │   └── components/
    │       ├── GamemasterInterface.tsx       # GM controls
    │       ├── PlayerInterface.tsx           # Player view
    │       ├── FluidGamemaster.tsx           # Fluid mode GM
    │       ├── TurnBasedGamemaster.tsx       # Turn-based GM
    │       ├── FinaleEvaluationScreen.tsx    # Finale scoring
    │       └── WebcamDisplay.tsx             # Video chat UI
```

### Key Dependencies

**Server:**
- `express` - HTTP server
- `socket.io` - Real-time communication
- `cors` - Cross-origin support
- `dotenv` - Environment variables
- Node.js file system for question storage

**Client:**
- `react` 18 + TypeScript
- `vite` - Build tool
- `zustand` - State management
- `socket.io-client` - Socket connection
- `react-router-dom` - Navigation
- `@tensorflow/tfjs` - AI virtual backgrounds
- `@mediapipe/selfie_segmentation` - Person segmentation

### Current Game Flow

```
1. GM creates lobby
   ↓
2. Players join lobby
   ↓
3. GM selects categories
   ↓
4. GM starts game
   ↓
5. PLAYING Phase:
   - GM assigns question to player (auto or manual)
   - Player answers verbally
   - GM rates answer (correct/incorrect/no-answer/too-late)
   - If incorrect: player loses life
   - If player eliminated: check for winner
   - Continue to next player
   ↓
6. VOTING Phase:
   - Timer starts
   - All players vote for "dumbest answer"
   - Player with most votes loses a life
   - Tie-breaking logic (GM decides)
   ↓
7. Check Win Condition:
   - If 2 players remain → FINALE
   - If 1 player remains → FINISHED
   - Otherwise → back to PLAYING
   ↓
8. FINALE Phase:
   - 10 questions displayed simultaneously
   - Both players answer all 10
   - GM evaluates all answers
   - Player with most correct answers wins
   ↓
9. FINISHED Phase:
   - Show winner
   - Option to start new game
   - Option to return to GameBuddies
```

---

## Migration Strategy

### Architecture Decision: Game Manager Wrapper Pattern

**Why Wrapper (not Direct Integration)?**

1. **Existing Code Works Well**
   - GameManager.js is well-tested and stable
   - Complex state machine logic
   - Extensive game rules

2. **Complexity**
   - 2,900+ lines of game logic
   - Multiple game modes (regular, solo, finale)
   - Would require extensive rewrite for direct integration

3. **Similar to SUSD**
   - SUSD successfully used wrapper pattern
   - Proven pattern for complex games
   - Isolates game logic from infrastructure

4. **Question Management**
   - Questions stored in JSON file
   - Admin API endpoints
   - Self-contained system

**Pattern Structure:**

```typescript
// Plugin acts as adapter
class DDFPlugin implements GamePlugin {
  private gameManager: GameManager;
  private questionManager: QuestionManager;

  socketHandlers = {
    'ddf:start-game': (socket, data, room, helpers) => {
      // Call game manager
      const updatedRoom = this.gameManager.startGame(room.code);

      // Serialize and emit
      const serialized = serializeRoomToDDF(updatedRoom, socket.id);
      helpers.sendToRoom(room.code, 'ddf:game-state-update', { room: serialized });
    }
  };
}
```

### What Core Provides

**✅ Use Core For:**
- Room creation/deletion
- Player join/leave/reconnect
- Session token management
- Chat messages (`room.messages`)
- WebRTC signaling (all `webrtc:*` events)
- GameBuddies integration (`GameBuddiesService`)
- Player disconnection handling
- Room code generation

**❌ Keep in DDF Plugin:**
- Game state machine
- Question assignment logic
- Answer rating system
- Voting mechanics
- Elimination logic
- Finale mode
- Timer system
- Life management
- Category selection

---

## Complete Event Mapping

### Core Events (Handled by Unified Server Core)

| Old Event | New Event | Handler | Changes Needed |
|-----------|-----------|---------|----------------|
| `gm:create-lobby` | `room:create` + `ddf:setup-game` | Core + Plugin | Client: Two-step creation |
| `player:join-lobby` | `room:join` | Core | Client: Change event name |
| N/A | `room:created` | Core | Client: Add listener |
| N/A | `room:joined` | Core | Client: Add listener |
| `server:lobby-created` | `room:created` | Core | Client: Update listener |
| `server:player-joined` | `room:joined` | Core | Client: Update listener |
| `server:lobby-update` | `player:joined`, `player:left` | Core | Client: Multiple listeners |
| All `webrtc:*` | All `webrtc:*` | Core | No changes (core handles) |
| All `chat:*` | All `chat:*` | Core | No changes (core handles) |

### Game-Specific Events (DDF Plugin Handles)

#### Game Control Events

| Client → Server | Server → Client | Purpose | Notes |
|----------------|-----------------|---------|-------|
| `ddf:setup-game` | `ddf:game-setup` | Complete room setup after creation | Step 2 of creation |
| `ddf:start-game` | `ddf:game-state-update` | Start game from lobby | Solo mode flag |
| `ddf:start-next-turn` | `ddf:game-state-update` | Auto-progress to next question | Auto mode |
| `ddf:assign-question` | `ddf:game-state-update` | GM manually assigns question | Manual mode |
| `ddf:start-new-game` | `ddf:game-state-update` | Reset game, keep players | |

#### Question & Answer Events

| Client → Server | Server → Client | Purpose | Notes |
|----------------|-----------------|---------|-------|
| `ddf:rate-answer` | `ddf:game-state-update` | GM rates player's answer | 4 rating types |
| `ddf:skip-question` | `ddf:game-state-update` | Skip to next player | |
| `ddf:skip-question-keep-player` | `ddf:game-state-update` | Skip question but keep same player | |
| `ddf:mark-question-bad` | `ddf:question-marked-bad` | Flag question for admin review | Doesn't affect game |
| `ddf:update-categories` | `ddf:game-state-update` | Update selected question categories | Lobby only |

#### Timer Events

| Client → Server | Server → Client | Purpose | Notes |
|----------------|-----------------|---------|-------|
| `ddf:control-timer` | `ddf:game-state-update` | Start/pause/reset timer | action: start/pause/reset |
| N/A | `ddf:timer-update` | Timer tick (every second) | Live countdown |

#### Voting Events

| Client → Server | Server → Client | Purpose | Notes |
|----------------|-----------------|---------|-------|
| `ddf:submit-vote` | `ddf:game-state-update` | Player votes for dumbest answer | |
| `ddf:skip-vote` | `ddf:game-state-update` | Player skips voting | |
| `ddf:end-voting` | `ddf:game-state-update` | GM ends voting early | Force end |
| `ddf:skip-voting` | `ddf:game-state-update` | GM skips AFK/DC players | Auto-complete |
| `ddf:toggle-show-questions` | `ddf:game-state-update` | Toggle question visibility for players | Voting phase |
| `ddf:close-voting-results` | `ddf:game-state-update` | Close results modal, advance game | Also triggers startNextRound |
| `ddf:close-results-for-all` | `ddf:close-results-broadcast` | Sync close for all players | GM-initiated |
| `ddf:break-tie` | `ddf:game-state-update` | GM selects player to eliminate | Tie-breaking |

#### Finale Events

| Client → Server | Server → Client | Purpose | Notes |
|----------------|-----------------|---------|-------|
| `ddf:submit-finale-answer` | `ddf:finale-progress` | Player submits answer to finale question | 10 questions total |
| N/A | `ddf:all-finale-answers-ready` | All 10 questions answered by all players | Triggers evaluation screen |
| `ddf:evaluate-single-finale` | `ddf:finale-evaluation` | GM evaluates one question | Real-time evaluation |
| `ddf:evaluate-all-finale` | `ddf:finale-complete` | GM evaluates all 10 questions at once | Batch evaluation |
| `ddf:next-finale-question` | `ddf:game-state-update` | Advance to next finale question | If not simultaneous |
| `ddf:finale-scroll-sync` | `ddf:scroll-sync-broadcast` | Sync GM scroll to player screens | UX enhancement |

#### Player Management Events

| Client → Server | Server → Client | Purpose | Notes |
|----------------|-----------------|---------|-------|
| `ddf:edit-lives` | `ddf:game-state-update` | GM manually edits player lives | Admin override |
| `ddf:update-media-state` | N/A | Update player audio state | Mic on/off |

#### GameBuddies Integration Events

| Client → Server | Server → Client | Purpose | Notes |
|----------------|-----------------|---------|-------|
| `ddf:return-to-lobby` | `ddf:return-broadcast` | GM initiates return to GameBuddies | All players |
| `ddf:game-update` | N/A | Send game state to GameBuddies API | Status updates |

### Event Count Summary

- **Core Events Used**: 9 (room management, chat, WebRTC)
- **Game-Specific Events**: 42 (24 client→server, 18 server→client)
- **Total Events**: 51

---

## Implementation Plan

### Phase 1: Server Plugin Creation (6-8 hours)

#### Step 1.1: Create Type Definitions (1 hour)

**File**: `games/ddf/types/index.ts`

```typescript
// Game-specific types
export interface DDFGameState {
  phase: 'lobby' | 'playing' | 'voting' | 'tie-breaking' | 'finale' | 'finished';
  gamemaster: {
    id: string;
    name: string;
    isDisconnected?: boolean;
    disconnectedAt?: number;
  };
  currentQuestion: DDFQuestion | null;
  targetPlayerId: string | null;
  currentPlayerIndex: number;
  roundAnswers: RoundAnswer[];
  previousRoundAnswers?: RoundAnswer[];
  votes: Record<string, string>;
  votingStatus?: Record<string, VotingStatus>;
  roundNumber: number;
  showQuestionsToPlayers: boolean;
  questionIndex: number;
  isFinale: boolean;
  finaleState: 'waiting' | 'answering' | 'evaluating' | 'all-questions-complete' | 'complete';
  finaleCurrentQuestion: DDFQuestion | null;
  finaleCurrentAnswers: FinaleAnswer[];
  finaleScores: Record<string, number>;
  finaleEvaluations: any[];
  usedQuestions: string[];
  selectedCategories: string[];
  winner?: Player;
  timer: Timer;
  shotClock: {
    enabled: boolean;
    duration: number;
  };
  settings: {
    roundDuration: number;
    shotClockEnabled: boolean;
    shotClockDuration: number;
  };
  isSecondVotingRound?: boolean;
  tiedPlayerIds?: string[];
}

export interface DDFPlayerData {
  lives: number;
  isEliminated: boolean;
  isDisconnected?: boolean;
  disconnectedAt?: number;
  mediaState?: {
    isMicOn: boolean;
    lastUpdated: number;
  };
}

export interface DDFQuestion {
  id: string;
  type: string;
  question: string;
  answer: string;
  category?: string;
  difficulty?: string;
  isBad?: boolean;
  badMarkCount?: number;
}

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

export interface Timer {
  isActive: boolean;
  time: number;
  duration: number;
}

export interface FinaleAnswer {
  playerId: string;
  questionId: string;
  answer: string;
  timestamp: number;
}

export interface VotingStatus {
  hasVoted: boolean;
  votedFor: string | null;
  voterName: string;
  votedForName: string | null;
  isGMSkipped?: boolean;
}
```

**Checklist:**
- [ ] Define all game state interfaces
- [ ] Define player data interface
- [ ] Define question interfaces
- [ ] Define answer interfaces
- [ ] Export all types

#### Step 1.2: Copy and Adapt GameManager (2 hours)

**Files**:
- Source: `E:\GamebuddiesPlatform\DDF\DDF\server\src\game\GameManager.js`
- Destination: `games/ddf/game/GameManager.js`

**Changes Needed:**
1. Remove room creation logic (use core)
2. Accept Room from core, update it
3. Remove player join logic (use core)
4. Remove disconnect timers (core handles)
5. Keep all game logic intact
6. Update method signatures to accept `room: Room` parameter

**Key Methods to Adapt:**
```javascript
// OLD (creates own room)
createRoom(gmSocketId, gmName) {
  this.rooms.set(roomCode, {
    code: roomCode,
    gamemaster: { ... },
    players: [],
    // ...
  });
}

// NEW (updates core room)
initializeGameState(room: Room): DDFGameState {
  return {
    phase: 'lobby',
    currentQuestion: null,
    // ... all game-specific state
  };
}
```

**Checklist:**
- [ ] Copy GameManager.js to plugin
- [ ] Remove room creation (createRoom, createRoomWithCode)
- [ ] Remove player join/leave (use core)
- [ ] Update to work with core Room structure
- [ ] Add initialization method for game state
- [ ] Keep all game logic methods
- [ ] Test that methods work with new structure

#### Step 1.3: Copy QuestionManager (30 min)

**Files**:
- Source: `E:\GamebuddiesPlatform\DDF\DDF\server\src\game\QuestionManager.js`
- Destination: `games/ddf/game/QuestionManager.js`

**Changes**: Minimal, mostly works as-is

**Checklist:**
- [ ] Copy QuestionManager.js
- [ ] Copy questions.json to games/ddf/data/
- [ ] Update file paths if needed
- [ ] Verify CRUD methods work

#### Step 1.4: Create Serialization Function (1 hour)

**File**: `games/ddf/utils/serialization.ts`

```typescript
import { Room, Player } from '../../../core/types/core';
import { DDFGameState, DDFPlayerData } from '../types';

export function serializeRoomToDDF(room: Room, socketId: string) {
  const gameState = room.gameState.data as DDFGameState;

  // Convert players Map to Array with game data
  const players = Array.from(room.players.values()).map((p) => {
    const playerData = p.gameData as DDFPlayerData;
    return {
      id: p.socketId,
      name: p.name,
      lives: playerData?.lives || 3,
      isEliminated: playerData?.isEliminated || false,
      isDisconnected: !p.connected,
      disconnectedAt: p.lastActivity,
      mediaState: playerData?.mediaState,
    };
  });

  // Build complete room object expected by client
  return {
    code: room.code,
    gamemaster: gameState.gamemaster,
    players,
    gameState: gameState.phase,
    currentQuestion: gameState.currentQuestion,
    targetPlayerId: gameState.targetPlayerId,
    currentPlayerIndex: gameState.currentPlayerIndex,
    roundAnswers: gameState.roundAnswers,
    previousRoundAnswers: gameState.previousRoundAnswers,
    votes: gameState.votes,
    votingStatus: gameState.votingStatus,
    roundNumber: gameState.roundNumber,
    showQuestionsToPlayers: gameState.showQuestionsToPlayers,
    questionIndex: gameState.questionIndex,
    isFinale: gameState.isFinale,
    finaleState: gameState.finaleState,
    finaleCurrentQuestion: gameState.finaleCurrentQuestion,
    finaleCurrentAnswers: gameState.finaleCurrentAnswers,
    finaleScores: gameState.finaleScores,
    finaleEvaluations: gameState.finaleEvaluations,
    usedQuestions: gameState.usedQuestions,
    selectedCategories: gameState.selectedCategories,
    winner: gameState.winner,
    timer: gameState.timer,
    shotClock: gameState.shotClock,
    settings: gameState.settings,
    isSecondVotingRound: gameState.isSecondVotingRound,
    tiedPlayerIds: gameState.tiedPlayerIds,
  };
}
```

**Checklist:**
- [ ] Create serialization function
- [ ] Convert players Map → Array
- [ ] Map all game state fields
- [ ] Add socketId to response
- [ ] Test serialization output

#### Step 1.5: Create Plugin Structure (3-4 hours)

**File**: `games/ddf/plugin.ts`

**Structure:**
```typescript
import { GamePlugin, Room, Player, Socket, GameHelpers } from '../../core/types/core';
import { DDFGameState, DDFPlayerData } from './types';
import { serializeRoomToDDF } from './utils/serialization';
const GameManager = require('./game/GameManager');
const QuestionManager = require('./game/QuestionManager');

class DDFGamePlugin implements GamePlugin {
  id = 'ddf';
  name = 'DDF Quiz Game';
  version = '1.0.0';
  namespace = '/ddf';
  basePath = '/ddf';

  defaultSettings = {
    minPlayers: 2,
    maxPlayers: 20,
    gameSpecific: {
      roundDuration: 120,
      shotClockEnabled: false,
      shotClockDuration: 30,
    }
  };

  private gameManager: any;
  private questionManager: any;
  private io: any;

  constructor() {
    this.gameManager = new GameManager();
    this.questionManager = new QuestionManager();
  }

  async onInitialize(io: any): Promise<void> {
    this.io = io;
    this.gameManager.setIO(io);
  }

  onRoomCreate(room: Room): void {
    // Initialize DDF game state
    room.gameState.data = {
      phase: 'lobby',
      gamemaster: null, // Set in setup-game
      currentQuestion: null,
      targetPlayerId: null,
      currentPlayerIndex: 0,
      roundAnswers: [],
      previousRoundAnswers: [],
      votes: {},
      votingStatus: {},
      roundNumber: 0,
      showQuestionsToPlayers: false,
      questionIndex: 0,
      isFinale: false,
      finaleState: 'waiting',
      finaleCurrentQuestion: null,
      finaleCurrentAnswers: [],
      finaleScores: {},
      finaleEvaluations: [],
      usedQuestions: [],
      selectedCategories: [],
      timer: {
        isActive: false,
        time: 0,
        duration: room.settings.gameSpecific?.roundDuration || 120,
      },
      shotClock: {
        enabled: room.settings.gameSpecific?.shotClockEnabled || false,
        duration: room.settings.gameSpecific?.shotClockDuration || 30,
      },
      settings: {
        roundDuration: room.settings.gameSpecific?.roundDuration || 120,
        shotClockEnabled: room.settings.gameSpecific?.shotClockEnabled || false,
        shotClockDuration: room.settings.gameSpecific?.shotClockDuration || 30,
      },
    } as DDFGameState;
  }

  onPlayerJoin(room: Room, player: Player): void {
    // Initialize player game data
    player.gameData = {
      lives: 3,
      isEliminated: false,
      mediaState: {
        isMicOn: false,
        lastUpdated: Date.now(),
      },
    } as DDFPlayerData;
  }

  serializeRoom(room: Room, socketId: string): any {
    return serializeRoomToDDF(room, socketId);
  }

  socketHandlers = {
    // Implement all 24 game-specific handlers here
    'ddf:setup-game': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      // ... implementation
    },

    'ddf:start-game': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      // ... implementation
    },

    // ... 22 more handlers
  };

  httpRoutes = [
    {
      method: 'get',
      path: '/questions',
      handler: (req, res) => {
        res.json(this.questionManager.getAllQuestions());
      },
    },
    {
      method: 'post',
      path: '/questions',
      handler: (req, res) => {
        const question = this.questionManager.addQuestion(req.body);
        res.json(question);
      },
    },
    // ... more question CRUD routes
  ];
}

export default DDFGamePlugin;
```

**All 24 Socket Handlers to Implement:**

1. `ddf:setup-game` - Complete room setup (step 2)
2. `ddf:start-game` - Start game
3. `ddf:start-next-turn` - Auto-progress question
4. `ddf:assign-question` - Manual question assignment
5. `ddf:rate-answer` - Rate player answer
6. `ddf:skip-question` - Skip to next player
7. `ddf:skip-question-keep-player` - Skip but keep player
8. `ddf:edit-lives` - Edit player lives
9. `ddf:control-timer` - Timer controls
10. `ddf:submit-vote` - Submit vote
11. `ddf:skip-vote` - Skip vote
12. `ddf:end-voting` - End voting early
13. `ddf:skip-voting` - Skip AFK players
14. `ddf:toggle-show-questions` - Toggle visibility
15. `ddf:mark-question-bad` - Flag question
16. `ddf:close-voting-results` - Close results
17. `ddf:close-results-for-all` - Broadcast close
18. `ddf:break-tie` - Break tie
19. `ddf:start-new-game` - Reset game
20. `ddf:update-categories` - Update categories
21. `ddf:submit-finale-answer` - Finale answer
22. `ddf:evaluate-single-finale` - Evaluate one finale
23. `ddf:evaluate-all-finale` - Evaluate all finale
24. `ddf:next-finale-question` - Next finale question

**Checklist:**
- [ ] Create plugin.ts file
- [ ] Implement GamePlugin interface
- [ ] Initialize GameManager and QuestionManager
- [ ] Implement onRoomCreate hook
- [ ] Implement onPlayerJoin hook
- [ ] Implement serializeRoom hook
- [ ] Implement all 24 socket handlers
- [ ] Add HTTP routes for questions API
- [ ] Test each handler individually

#### Step 1.6: Register Plugin in Core (15 min)

**File**: `core/server.ts`

```typescript
import DDFGamePlugin from '../games/ddf/plugin';

// Register games
const ddfPlugin = new DDFGamePlugin();
server.registerGame(ddfPlugin);
```

**Checklist:**
- [ ] Import DDF plugin
- [ ] Register with server
- [ ] Verify plugin loads
- [ ] Check namespace registration
- [ ] Test basic connection

### Phase 2: Client Migration (4-5 hours)

#### Step 2.1: Update Socket Connection (30 min)

**File**: `DDF/client/src/services/socketService.ts`

**Changes:**
```typescript
// OLD
const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
this.socket = io(backendUrl);

// NEW
const backendUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
this.socket = io(backendUrl + '/ddf', {
  transports: ['websocket', 'polling']
});
```

**Checklist:**
- [ ] Update namespace to `/ddf`
- [ ] Update environment variable name
- [ ] Keep all existing event listeners
- [ ] Test connection

#### Step 2.2: Create .env File (5 min)

**File**: `DDF/client/.env`

```
VITE_SERVER_URL=http://localhost:3001
```

**Checklist:**
- [ ] Create .env file
- [ ] Add to .gitignore if not already
- [ ] Document in README

#### Step 2.3: Implement Two-Step Room Creation (1 hour)

**File**: `DDF/client/src/pages/HomePage.tsx` and `unifiedStore.ts`

**Changes in unifiedStore.ts:**
```typescript
createLobby: (gmName: string, roomCode?: string) => {
  const { socket } = get();
  if (socket) {
    // Get GameBuddies data
    let playerId = null;
    if (window.GameBuddies && window.GameBuddies.getPlayerInfo) {
      const playerInfo = window.GameBuddies.getPlayerInfo();
      playerId = playerInfo.playerId;
    }

    // Step 1: Create core room
    socket.emit('room:create', {
      playerName: gmName,
      settings: {
        minPlayers: 2,
        maxPlayers: 20,
        gameSpecific: {
          roundDuration: 120,
          shotClockEnabled: false,
          shotClockDuration: 30,
        }
      },
      roomCode: roomCode || undefined,
      playerId: playerId || undefined,
    });

    // Store pending settings for step 2
    // Will be sent after receiving room:created event
  }
},
```

**Add new listener:**
```typescript
socket.on('room:created', (data) => {
  // Step 2: Setup DDF game
  socket.emit('ddf:setup-game', {
    settings: {
      roundDuration: 120,
      shotClockEnabled: false,
      shotClockDuration: 30,
    }
  });
});

socket.on('ddf:game-setup', (data) => {
  store.setRoomCode(data.room.code);
  store.setRoom(data.room);
  store.setUserRole('gamemaster');
  store.setUserName(data.room.gamemaster.name);
});
```

**Checklist:**
- [ ] Update createLobby to use room:create
- [ ] Add room:created listener
- [ ] Emit ddf:setup-game after creation
- [ ] Add ddf:game-setup listener
- [ ] Test two-step creation

#### Step 2.4: Update All Event Names (2-3 hours)

**Files to Update:**
- `src/stores/unifiedStore.ts` - All emit calls
- `src/services/socketService.ts` - All listeners
- All component files that emit events

**Event Name Changes:**
```typescript
// Example updates in unifiedStore.ts
startGame: (soloMode = false) => {
  const { socket, roomCode } = get();
  if (socket && roomCode) {
    // OLD: socket.emit('gm:start-game', { roomCode, soloMode });
    socket.emit('ddf:start-game', { roomCode, soloMode }); // NEW
  }
},
```

**Complete List of Changes:**
- `gm:start-game` → `ddf:start-game`
- `client:start-next-turn` → `ddf:start-next-turn`
- `gm:assign-question` → `ddf:assign-question`
- `client:rate-answer` → `ddf:rate-answer`
- `client:skip-question` → `ddf:skip-question`
- `client:edit-lives` → `ddf:edit-lives`
- `client:control-timer` → `ddf:control-timer`
- `player:submit-vote` → `ddf:submit-vote`
- `player:skip-vote` → `ddf:skip-vote`
- `gm:end-voting` → `ddf:end-voting`
- `gm:toggle-show-questions` → `ddf:toggle-show-questions`
- `gm:skip-voting` → `ddf:skip-voting`
- `gm:mark-question-as-bad` → `ddf:mark-question-bad`
- `gm:skip-question-keep-player` → `ddf:skip-question-keep-player`
- `gm:close-voting-results` → `ddf:close-voting-results`
- `client:close-voting-results-for-all` → `ddf:close-results-for-all`
- `gm:break-tie` → `ddf:break-tie`
- `gm:start-new-game` → `ddf:start-new-game`
- `gm:update-categories` → `ddf:update-categories`
- `player:submit-finale-answer` → `ddf:submit-finale-answer`
- `gm:evaluate-single-finale-question` → `ddf:evaluate-single-finale`
- `gm:evaluate-all-finale-answers` → `ddf:evaluate-all-finale`
- `gm:evaluate-finale-answers` → `ddf:evaluate-finale` (legacy)
- `gm:next-finale-question` → `ddf:next-finale-question`
- `gm:finale-scroll-sync` → `ddf:finale-scroll-sync`

**Server → Client Events:**
- `server:lobby-created` → handled by `room:created` + `ddf:game-setup`
- `server:player-joined` → handled by `room:joined`
- `server:lobby-update` → handled by `player:joined` and `player:left`
- `server:game-state-update` → `ddf:game-state-update`
- `server:timer-update` → `ddf:timer-update`
- `server:start-voting` → Keep (or rename to `ddf:start-voting`)
- `server:round-result` → Keep (or rename to `ddf:round-result`)
- `server:error` → Keep (core event)
- `server:question-marked-as-bad` → `ddf:question-marked-bad`
- All others follow `ddf:*` pattern

**Checklist:**
- [ ] Update all emitters in unifiedStore.ts (23 methods)
- [ ] Update all listeners in socketService.ts (18 events)
- [ ] Update GamemasterInterface.tsx emitters
- [ ] Update PlayerInterface.tsx emitters
- [ ] Update FinaleEvaluationScreen.tsx emitters
- [ ] Search codebase for any remaining old events
- [ ] Test each event flow

### Phase 3: Testing & Validation (2-3 hours)

See [Testing Checklist](#testing-checklist) section below.

---

## Critical Considerations

### 1. Timer Management

**Challenge:** Server-side timer emits updates every second

**Current Implementation:**
```javascript
startTimer(roomCode, io) {
  const room = this.rooms.get(roomCode);
  const timer = setInterval(() => {
    room.timer.time--;
    if (room.timer.time <= 0) {
      clearInterval(timer);
      room.timer.isActive = false;
    }
    io.to(roomCode).emit('server:timer-update', {
      time: room.timer.time,
      isActive: room.timer.isActive
    });
  }, 1000);
}
```

**Migration Strategy:**
- Store timer interval reference in `room.gameState.data`
- Clean up timer on room deletion
- Emit via plugin: `helpers.sendToRoom(roomCode, 'ddf:timer-update', ...)`

**Potential Issues:**
- Timer leaks if room deleted during countdown
- Multiple timers if started multiple times

**Solution:**
- Clear existing timer before starting new one
- Add cleanup in `onCleanup` hook
- Store timer ref in gameState: `gameState.timerInterval`

### 2. Question Storage

**Current:** JSON file at `server/src/data/questions.json`

**Migration:** Copy to `games/ddf/data/questions.json`

**HTTP Routes:** Add to plugin.httpRoutes

**Admin Panel:** Should still work with `/api/ddf/questions` endpoint

**Checklist:**
- [ ] Copy questions.json to plugin
- [ ] Update file paths in QuestionManager
- [ ] Add HTTP routes to plugin
- [ ] Test admin panel CRUD operations
- [ ] Verify question loading on server start

### 3. GameBuddies Integration

**Current State:** Fully implemented with:
- Session detection from URL params
- playerId extraction and storage
- Auto-join for hosts and players
- Return-to-lobby functionality
- External Game Status API updates

**What's Already in Core:**
- `GameBuddiesService` class
- API authentication middleware
- Database integration (if enabled)
- Player session management

**Plugin Responsibilities:**
- Use core `GameBuddiesService` via helpers
- Don't duplicate GameBuddies logic
- Emit game state updates through core service

**Key Files to Review:**
- `DDF/client/src/services/GameBuddiesIntegration.js` - Session management
- `DDF/client/src/services/gameBuddiesStatusUpdater.js` - Status updates
- `DDF/server/src/services/gameBuddiesService.js` - API client

**Migration Notes:**
- Core already has `gameBuddiesService`
- Plugin should call `helpers.updatePlayerStatus()` instead of direct API calls
- playerId flow must be preserved through room creation

### 4. WebRTC & Virtual Backgrounds

**Good News:** Core handles all WebRTC!

**What Core Provides:**
- WebRTC signaling (offer/answer/ICE candidates)
- Peer tracking (`room.videoEnabledPeers`)
- Connection type tracking (`room.peerConnectionTypes`)
- All `webrtc:*` events

**What Stays in Client:**
- `virtualBackgroundService.ts` - AI processing (client-only)
- `faceAvatarService.ts` - Face tracking (client-only)
- `WebcamDisplay.tsx` - UI component
- MediaPipe/TensorFlow.js integration

**No Changes Needed:** WebRTC code stays exactly as-is

**Checklist:**
- [ ] Verify WebRTC events still work
- [ ] Test video enable/disable
- [ ] Test virtual backgrounds
- [ ] Test multiple peers
- [ ] No plugin code needed for WebRTC

### 5. Finale Mode Complexity

**Challenge:** Most complex game mode

**Features:**
- 10 questions displayed simultaneously
- All players answer all questions
- Real-time progress tracking
- Batch evaluation by GM
- Scroll synchronization

**Current Implementation:** Works well

**Migration Strategy:**
- Keep all finale logic in GameManager
- Serialize finale state in `serializeRoomToDDF()`
- Emit finale-specific events as needed

**Events:**
- `ddf:submit-finale-answer` - Player submits
- `ddf:finale-progress` - Progress update
- `ddf:all-finale-answers-ready` - All submitted
- `ddf:evaluate-single-finale` - Evaluate one
- `ddf:evaluate-all-finale` - Evaluate all
- `ddf:finale-complete` - Winner determined
- `ddf:finale-scroll-sync` - Scroll position

**Checklist:**
- [ ] Test finale mode start
- [ ] Test answer submission (all 10)
- [ ] Test progress tracking
- [ ] Test evaluation screen
- [ ] Test single question evaluation
- [ ] Test batch evaluation
- [ ] Test scroll sync
- [ ] Test winner determination

### 6. Voting & Tie-Breaking

**Challenge:** Complex logic with multiple paths

**Voting Flow:**
1. Round ends → voting starts
2. Players vote for "dumbest answer"
3. Count votes
4. If tie → second voting round OR GM breaks tie
5. Eliminate player with most votes
6. Check win condition

**Tie-Breaking Logic:**
- Automatic second vote if 2 players tied
- GM decision if 3+ players tied
- Complex edge cases

**Migration Strategy:**
- Keep all logic in GameManager
- Emit different events based on tie-breaking path
- Serialize voting status correctly

**Checklist:**
- [ ] Test normal voting (no tie)
- [ ] Test 2-player tie (automatic second vote)
- [ ] Test 3+ player tie (GM breaks)
- [ ] Test GM skip voting (AFK players)
- [ ] Test GM end voting early
- [ ] Test vote results display
- [ ] Test elimination after voting

### 7. Disconnection Handling

**Current:** Complex timed disconnect system with badges

**Core Provides:**
- Session tokens
- Automatic reconnection
- Disconnect timers (60 seconds)
- Badge system (🔌 for disconnected)

**Plugin Needs:**
- Mark player as disconnected in game data
- Don't assign questions to disconnected players
- Allow voting skip for disconnected players
- Keep player in game (can reconnect)

**Migration Strategy:**
- Use core's disconnect handling
- Update `player.connected` flag
- GameManager checks `player.connected` before assigning
- Voting logic handles disconnected players

**Checklist:**
- [ ] Test player disconnect during game
- [ ] Test reconnection (session token)
- [ ] Test question assignment skips DC players
- [ ] Test voting with DC players
- [ ] Test GM skip voting for DC
- [ ] Verify 60-second timer works

---

## Testing Checklist

### Room Management
- [ ] GM creates room (auto-generated code)
- [ ] GM creates room (custom code from GameBuddies)
- [ ] Player joins room
- [ ] Multiple players join (test 3-5 players)
- [ ] Player list updates for all
- [ ] Room code display correct
- [ ] Invalid room code rejected

### Game Flow - Lobby
- [ ] Start game button enabled with 2+ players
- [ ] Start game button disabled with 0-1 players
- [ ] Solo mode option works
- [ ] Category selection works
- [ ] Category changes broadcast to all

### Game Flow - Playing
- [ ] Auto question assignment works
- [ ] Manual question assignment works
- [ ] Question displays for target player
- [ ] GM can rate answer (all 4 types: correct, incorrect, no-answer, too-late)
- [ ] Incorrect answer reduces life
- [ ] Correct answer keeps life
- [ ] Skip question works
- [ ] Skip question but keep player works
- [ ] Player elimination when lives = 0
- [ ] Used questions not repeated
- [ ] Category filtering works

### Game Flow - Voting
- [ ] Voting phase starts automatically after round
- [ ] All players see voting UI
- [ ] Vote submission works
- [ ] Vote skip works
- [ ] Vote counts displayed to GM
- [ ] Player with most votes loses life
- [ ] Voting results display correctly
- [ ] Close voting results works for all players

### Tie-Breaking
- [ ] 2-player tie triggers automatic second vote
- [ ] 3+ player tie shows GM break-tie UI
- [ ] GM can select player to eliminate
- [ ] Tie-breaking completes correctly

### Finale Mode
- [ ] Finale starts with 2 players remaining
- [ ] All 10 questions display
- [ ] Players can answer all 10
- [ ] Progress tracking shows X/10 for each player
- [ ] GM evaluation screen shows when all answers in
- [ ] GM can evaluate single questions
- [ ] GM can evaluate all at once
- [ ] Scores calculated correctly
- [ ] Winner determined correctly
- [ ] Scroll sync works (GM to players)

### Timer
- [ ] Timer starts when commanded
- [ ] Timer pauses when commanded
- [ ] Timer resets when commanded
- [ ] Timer countdown visible to all
- [ ] Timer reaches 0 and stops
- [ ] Multiple timer operations don't conflict

### Question Management (Admin)
- [ ] Access admin panel at /admin
- [ ] View all questions
- [ ] Add new question
- [ ] Edit existing question
- [ ] Delete question
- [ ] Bulk upload questions
- [ ] Find duplicate questions
- [ ] Delete duplicates
- [ ] Filter by category
- [ ] Mark question as bad (during game)
- [ ] Bad question counter increments

### GameBuddies Integration
- [ ] Host auto-creates room with GB room code
- [ ] Player auto-joins room with GB code
- [ ] playerId flows through correctly
- [ ] Return to lobby button visible
- [ ] GM return-to-lobby broadcasts to all
- [ ] Player individual return works
- [ ] Streamer mode works (if applicable)

### WebRTC & Media
- [ ] Enable video works
- [ ] Disable video works
- [ ] Multiple peers connect
- [ ] Virtual background enable works
- [ ] Background blur works
- [ ] Background image replacement works
- [ ] Device selection works (camera/mic)
- [ ] Mic mute/unmute works
- [ ] Audio state syncs across players
- [ ] Video disconnects on player leave

### Disconnection & Reconnection
- [ ] Player disconnect shows badge (🔌)
- [ ] Question assignment skips DC player
- [ ] Voting allows skip for DC players
- [ ] GM can skip voting for DC players
- [ ] Player can reconnect with session token
- [ ] Reconnected player rejoins game state
- [ ] Reconnection within 60 seconds succeeds
- [ ] Reconnection after 60 seconds fails (kicked)

### Edge Cases
- [ ] GM disconnects (room handling)
- [ ] All players disconnect
- [ ] Player joins mid-game (spectator mode)
- [ ] Start new game works
- [ ] Game reset keeps players
- [ ] Lives can be edited by GM
- [ ] Question skip doesn't break game
- [ ] Empty question pool handled
- [ ] Invalid category selection handled

### Performance
- [ ] 10+ players in room
- [ ] Rapid question assignment
- [ ] Multiple votes simultaneously
- [ ] Timer accuracy over long duration
- [ ] Memory leaks (check after multiple games)

---

## Potential Pitfalls

Based on BingoBuddies and ClueScale migrations:

### Pitfall 1: Event Listener Placement (CRITICAL)

**Issue:** Socket event listeners must be in root component (App.tsx)

**Symptom:** Player2 join times out, server logs show success

**Solution:** Move `useSocketEvents()` to App.tsx, not GamePage.tsx

**DDF-Specific:**
- `socketService.ts` already sets up listeners correctly
- Verify listeners registered before any events emitted
- Test join flow from HomePage (not GamePage)

### Pitfall 2: Serialization - Map to Array

**Issue:** Server uses `Map<string, Player>`, client expects `Player[]`

**Symptom:** `players.map is not a function`, UI crashes

**Solution:** `Array.from(room.players.values())` in serialization

**DDF-Specific:**
- Already planned in `serializeRoomToDDF()`
- Also serialize votes: `Record<string, string>` (already correct format)
- Serialize votingStatus: `Record<string, VotingStatus>` (already correct)

### Pitfall 3: Two-Step Room Creation

**Issue:** Client expects one-step, server has two-step

**Symptom:** Room created but game state not initialized

**Solution:**
1. `room:create` → store pending settings
2. `room:created` → emit `ddf:setup-game`
3. `ddf:game-setup` → room fully ready

**DDF-Specific:**
- Store pending settings in store state
- Emit `ddf:setup-game` in `room:created` listener
- Set gamemaster info in `ddf:setup-game` handler

### Pitfall 4: playerId Flow

**Issue:** GameBuddies playerId lost during room creation

**Symptom:** External Game Status API calls fail

**Solution:**
- Extract playerId from URL/session storage
- Pass in `room:create` event
- Store in `room.gameBuddiesData`
- Use in API calls

**DDF-Specific:**
- Already has complex playerId detection
- Ensure detection works before room creation
- Test with GameBuddies context

### Pitfall 5: Timer Cleanup

**Issue:** Timers continue after room deleted

**Symptom:** Memory leak, server slowdown

**Solution:**
- Store timer ref in game state
- Clear timer in `onCleanup` hook
- Clear timer before starting new timer

**DDF-Specific:**
- `setInterval` for timer updates
- Must be cleared on:
  - Room deletion
  - Game end
  - Game reset
  - New timer start

### Pitfall 6: Question File Path

**Issue:** QuestionManager can't find questions.json

**Symptom:** No questions available, game can't start

**Solution:**
- Copy questions.json to `games/ddf/data/`
- Update file path in QuestionManager
- Use absolute path or relative to plugin root

**DDF-Specific:**
- Path: `games/ddf/data/questions.json`
- Ensure path works in both dev and production
- Test question loading on server start

### Pitfall 7: Namespace Mismatch

**Issue:** Client connects to `/` but plugin is `/ddf`

**Symptom:** No connection, events not received

**Solution:**
- Client: `io(serverUrl + '/ddf')`
- Server: `namespace = '/ddf'`
- Test connection immediately

**DDF-Specific:**
- Update `socketService.ts`
- Keep other event listeners
- Verify connection in browser console

### Pitfall 8: Core Event Conflicts

**Issue:** Plugin emits events that core also emits

**Symptom:** Duplicate events, confusion

**Solution:**
- Use core events for core features
- Prefix all game events with `ddf:`
- Never emit `room:*`, `player:*`, `chat:*`, `webrtc:*`

**DDF-Specific:**
- All game events use `ddf:` prefix
- WebRTC events stay as `webrtc:*` (core handles)
- Chat uses core (if needed)

---

## Success Criteria

DDF migration is complete when:

- [ ] Server plugin loads without errors
- [ ] Client connects to `/ddf` namespace
- [ ] Room can be created (both auto and custom code)
- [ ] Players can join room
- [ ] Game can start with 2+ players
- [ ] Questions can be assigned
- [ ] Answers can be rated
- [ ] Voting works
- [ ] Tie-breaking works
- [ ] Finale mode works
- [ ] All 10 questions can be answered
- [ ] Winner is determined correctly
- [ ] Timer works
- [ ] Admin panel works
- [ ] Questions can be managed
- [ ] GameBuddies integration works
- [ ] WebRTC video chat works
- [ ] Virtual backgrounds work
- [ ] Reconnection works
- [ ] No memory leaks
- [ ] No console errors
- [ ] All 51 events functional
- [ ] All 6 game states work

---

## Estimated Timeline Breakdown

| Phase | Task | Estimated Time | Priority |
|-------|------|----------------|----------|
| 1.1 | Create type definitions | 1 hour | High |
| 1.2 | Copy and adapt GameManager | 2 hours | High |
| 1.3 | Copy QuestionManager | 30 min | Medium |
| 1.4 | Create serialization function | 1 hour | High |
| 1.5 | Create plugin structure | 3-4 hours | High |
| 1.6 | Register plugin in core | 15 min | High |
| **Phase 1 Total** | | **7-8.75 hours** | |
| 2.1 | Update socket connection | 30 min | High |
| 2.2 | Create .env file | 5 min | Low |
| 2.3 | Implement two-step creation | 1 hour | High |
| 2.4 | Update all event names | 2-3 hours | High |
| **Phase 2 Total** | | **3.5-4.5 hours** | |
| 3 | Testing & validation | 2-3 hours | High |
| **Total** | | **13-16.25 hours** | |

---

## Next Steps

1. ✅ Review and approve this plan
2. Start Phase 1: Server Plugin Creation
   - Create types
   - Adapt GameManager
   - Create plugin structure
3. Phase 2: Client Migration
   - Update socket connection
   - Implement two-step creation
   - Update event names
4. Phase 3: Testing
   - Test all game flows
   - Test GameBuddies integration
   - Test edge cases
5. Documentation
   - Update MIGRATION_LOG.md
   - Update GAME-MIGRATION-GUIDE.md
   - Document any issues found

---

**Last Updated:** 2025-10-24
**Author:** Claude Code
**Migration Pattern:** Game Manager Wrapper
**Status:** Ready for Implementation
