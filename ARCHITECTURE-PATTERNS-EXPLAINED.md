# Why SUSD and ClueScale Use Different Integration Patterns

## Quick Answer

**SUSD uses the Wrapper pattern** because it's a complex legacy game with:
- 4 different game modes (Classic, Pass & Play, Voice, Questions)
- Its own elaborate Room/Player structures
- Extensive existing game logic that was hard to refactor

**ClueScale uses Direct Integration** because:
- Simpler game mechanics (one game mode)
- Clean state structure that fits core Room naturally
- Was being built fresh during migration

---

## Detailed Comparison

### SUSD Architecture (Wrapper Pattern)

**SUSD's Own Room Structure:**
```typescript
interface SUSDRoom {
  id: string;                      // Own UUID
  code: string;                    // Links to core room
  gamemaster: SUSDPlayer;          // Own player type
  players: SUSDPlayer[];           // Array, not Map
  gameMode: 'classic' | 'hidden' | 'truth';
  gamePhase: 'lobby' | 'word-round' | 'voting' | 'reveal' | 'finished' | 'question-round';
  settings: SUSDSettings;          // Complex settings object

  // Classic mode
  currentWord: Word | null;
  currentWordPair: WordPair | null;
  wordsThisRound: TurnData[];
  allWordsAllRounds: TurnData[][];

  // Truth mode
  currentQuestion: Question | null;
  answersThisRound: AnswerData[];
  allAnswersAllRounds: AnswerData[][];

  // Pass & Play mode
  passPlayCurrentPlayer: number;
  passPlayRevealed: boolean;

  // Voting mechanics
  votes: Record<string, string>;
  votingStartTime?: number;
  imposterGuess?: string;

  // Results tracking
  currentRoundResult?: RoundResult;
  roundHistory: RoundResult[];

  // Timer management
  timers: any[];
  // ... many more fields
}
```

**SUSDPlayer Structure:**
```typescript
interface SUSDPlayer {
  id: string;
  name: string;
  socketId?: string;
  isGamemaster: boolean;
  isImposter: boolean;           // Role-based
  hasSubmittedWord: boolean;      // Action tracking
  hasVoted: boolean;              // Action tracking
  votedFor?: string;              // Vote tracking
  isEliminated: boolean;          // Game state
  gameBuddiesPlayerId?: string;
}
```

**How SUSD Works:**

1. **Core Room (Minimal Shell):**
```typescript
// Core room just holds reference
coreRoom.code = 'ABC123';
coreRoom.gameState.data = { susdRoomId: 'uuid-of-susd-room' };
coreRoom.gameState.phase = 'playing'; // Generic
```

2. **SUSD Room (Full State):**
```typescript
// Game Manager maintains full game state
class GameManager {
  private rooms = new Map<string, SUSDRoom>();

  createRoom(player, gameMode, coreRoomCode) {
    const susdRoom = {
      id: uuid(),
      code: coreRoomCode, // Link back
      players: [],
      gameMode: gameMode,
      // ... 30+ fields of complex state
    };
    this.rooms.set(susdRoom.id, susdRoom);
    return susdRoom;
  }

  getRoom(coreRoomCode: string): SUSDRoom | undefined {
    // Find SUSD room by core room code
    return Array.from(this.rooms.values())
      .find(r => r.code === coreRoomCode);
  }
}
```

3. **Mapping Between Systems:**
```typescript
// Plugin maintains mapping
private roomMapping = new Map<string, string>();
// coreRoom.code -> susdRoom.id

// Every handler needs translation:
'susd:action': async (socket, data, coreRoom, helpers) => {
  // 1. Get SUSD room from core room
  const susdRoomId = this.roomMapping.get(coreRoom.code);
  const susdRoom = this.gameManager.getRoom(susdRoomId);

  // 2. Work with SUSD room
  susdRoom.gamePhase = 'voting';

  // 3. Sync core room phase
  coreRoom.gameState.phase = 'playing';

  // 4. Emit SUSD room (not core room)
  helpers.sendToRoom(coreRoom.code, 'susd:update', { room: susdRoom });
}
```

**Why This Pattern:**

✅ **Preserves Legacy Code:** SUSD had years of development. Refactoring to fit core Room would be weeks of work.

✅ **Multiple Game Modes:** Each mode has different fields/logic. Cramming all into core would be messy.

✅ **Pass & Play:** Single-device mode doesn't fit core's multi-socket assumption.

✅ **Complex State:** 40+ fields in SUSD Room vs 5 in core Room.gameState.data.

❌ **More Complexity:** Every handler needs to translate between systems.

❌ **Two Sources of Truth:** Core room and SUSD room must stay in sync.

---

### ClueScale Architecture (Direct Integration)

**ClueScale Uses Core Room Directly:**
```typescript
// Everything stored in core Room
room.code = 'ABC123';
room.gameState.phase = 'round_clue'; // Specific phase
room.gameState.data = {
  round: {
    index: 1,
    category: 'Size',
    targetNumber: 7,
    clueWord: 'Medium',
    clueGiverId: 'player-uuid',
    guesses: []
  },
  roleQueue: ['player1-id', 'player2-id', 'player3-id'],
  roundStartTime: 1234567890,
  roundTimer: undefined
};

room.settings.gameSpecific = {
  roundDuration: 60,
  teamBonusEnabled: true,
  rotationType: 'circular',
  categories: ['Size', 'Speed', 'Temperature', ...]
};

// Player data stored in core Player
player.gameData = {
  score: 5,
  isBackgrounded: false
};
```

**How ClueScale Works:**

1. **Direct State Access:**
```typescript
'clue:submit-clue': async (socket, data, room, helpers) => {
  // Direct access to game state
  const gameState = room.gameState.data as ClueGameState;

  // Update directly
  gameState.round.clueWord = data.clue;
  room.gameState.phase = 'round_guess';

  // Serialize and emit
  const lobby = serializeRoomToLobby(room, socket.id);
  helpers.sendToRoom(room.code, 'clue:clue-submitted', { room: lobby });
}
```

2. **No Mapping Needed:**
```typescript
// No translation layer - work directly with room
const round = gameState.round;
const settings = room.settings.gameSpecific as ClueSettings;
const players = Array.from(room.players.values());
```

3. **Simpler Lifecycle:**
```typescript
onRoomCreate(room: Room) {
  // Initialize directly in core room
  room.gameState.phase = 'lobby';
  room.gameState.data = {
    round: null,
    roleQueue: [],
    roundTimer: undefined
  };
}

onPlayerJoin(room: Room, player: Player) {
  // Initialize player data directly
  player.gameData = {
    score: 0,
    isBackgrounded: false
  };
}
```

**Why This Pattern:**

✅ **Simpler:** No mapping, no translation layer, fewer moving parts.

✅ **Single Source of Truth:** Core room is the only state.

✅ **Easier to Debug:** All state visible in core Room object.

✅ **Fits Core Model:** ClueScale's structure aligns with core Room/Player.

❌ **Less Flexibility:** Must fit game into core's structure.

❌ **Harder for Complex Games:** Wouldn't work well for SUSD's complexity.

---

## Visual Comparison

### SUSD (Wrapper Pattern)

```
┌─────────────────────────────────────────────────────────┐
│ Core Room (Lightweight Shell)                          │
│                                                         │
│ code: "ABC123"                                          │
│ gameState.phase: "playing"                              │
│ gameState.data: { susdRoomId: "uuid-789" }  ←─────┐   │
│ players: Map<socketId, CorePlayer>                 │   │
│   └─ CorePlayer { id, name, isHost, gameData }    │   │
└──────────────────────────────────────────────────┼─────┘
                                                   │
                                                   │ Reference
                                                   │
┌──────────────────────────────────────────────────▼─────┐
│ SUSD Game Manager                                      │
│                                                         │
│ rooms: Map<uuid, SUSDRoom>                              │
│   └─ "uuid-789" →                                       │
│       ┌─────────────────────────────────────────────┐  │
│       │ SUSDRoom (Full Game State)                  │  │
│       │                                             │  │
│       │ code: "ABC123"  ←─ Links back               │  │
│       │ gameMode: 'classic'                         │  │
│       │ gamePhase: 'word-round'                     │  │
│       │ players: SUSDPlayer[]                       │  │
│       │ currentWord: { text: "Cat", ... }           │  │
│       │ wordsThisRound: [...]                       │  │
│       │ votes: { p1: p2, p2: p3 }                   │  │
│       │ roundHistory: [...]                         │  │
│       │ ... 30+ more fields                         │  │
│       └─────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘

Every Handler:
  1. Look up SUSD room from core room code
  2. Update SUSD room state
  3. Sync core room phase
  4. Emit SUSD room (not core room)
```

### ClueScale (Direct Integration)

```
┌────────────────────────────────────────────────────────┐
│ Core Room (Complete Game State)                       │
│                                                        │
│ code: "ABC123"                                         │
│ gameState.phase: "round_clue"  ←─ Specific phase     │
│ gameState.data: {              ←─ All game state     │
│   round: {                                            │
│     index: 1,                                         │
│     category: "Size",                                 │
│     targetNumber: 7,                                  │
│     clueWord: null,                                   │
│     clueGiverId: "uuid-123",                          │
│     guesses: []                                       │
│   },                                                  │
│   roleQueue: ["uuid-1", "uuid-2", "uuid-3"],         │
│   roundStartTime: 1234567890,                         │
│   roundTimer: undefined                               │
│ }                                                     │
│                                                        │
│ settings.gameSpecific: {       ←─ Game settings      │
│   roundDuration: 60,                                  │
│   teamBonusEnabled: true,                             │
│   rotationType: 'circular',                           │
│   categories: [...]                                   │
│ }                                                     │
│                                                        │
│ players: Map<socketId, CorePlayer>                    │
│   └─ CorePlayer {                                     │
│        id: "uuid-123",                                │
│        name: "Alice",                                 │
│        gameData: { score: 5, isBackgrounded: false } │
│      }                                                │
└────────────────────────────────────────────────────────┘

Every Handler:
  1. Access room.gameState.data directly
  2. Update fields
  3. Serialize and emit
  (No mapping or translation needed)
```

---

## When to Use Each Pattern

### Use Wrapper Pattern (like SUSD) When:

1. **Migrating Complex Legacy Code**
   - Game already has years of development
   - Refactoring would take weeks
   - Existing structure is deeply embedded

2. **Multiple Distinct Game Modes**
   - Each mode has different state requirements
   - Modes are fundamentally different (not just setting variations)
   - Example: SUSD has Classic (words), Truth (questions), Pass & Play (single device)

3. **Non-Standard Player Model**
   - Game needs player fields that don't fit core
   - Complex role systems (imposter, gamemaster, spectator variations)
   - Action tracking per player (submitted, voted, revealed)

4. **Single-Device Modes**
   - Pass & Play scenarios
   - Core assumes one socket = one player, this breaks that

5. **Extensive Custom State**
   - 30+ fields of game state
   - Complex nested structures
   - Multiple timers and tracking systems

6. **Existing Game Manager**
   - Game already has a well-tested GameManager class
   - Manager handles complex logic you don't want to refactor
   - Proven patterns you want to preserve

### Use Direct Integration (like ClueScale) When:

1. **Simple Game Structure**
   - Game has straightforward state (5-10 fields)
   - One game mode or simple variations
   - Linear progression (lobby → playing → finished)

2. **New Development**
   - Building game fresh or early in development
   - Can design state to fit core structure
   - No legacy baggage

3. **Fits Core Model Well**
   - Player concept matches core Player
   - Room concept matches core Room
   - State transitions map cleanly to phases

4. **Minimal Custom Logic**
   - Most logic is standard (scoring, turns, rounds)
   - No complex mode variations
   - Simple timer management

5. **Want Simplicity**
   - Fewer abstraction layers
   - Easier debugging
   - Less code to maintain

---

## Performance & Complexity Trade-offs

### Wrapper Pattern

**Pros:**
- Flexibility: Game state can be arbitrarily complex
- Legacy Preservation: Don't need to refactor working code
- Isolation: Core room changes won't break game logic

**Cons:**
- More Memory: Two room objects (core + game)
- Mapping Overhead: Constant translation between systems
- Sync Complexity: Must keep core and game state aligned
- More Code: Mapping layer, translation functions

**When Worth It:** Complex games where refactoring would be prohibitive.

### Direct Integration

**Pros:**
- Simpler: Single state object
- Faster: No translation layer
- Easier to Debug: Everything in one place
- Less Memory: Single room object

**Cons:**
- Less Flexible: Must fit into core's structure
- Migration Work: Need to refactor game state to fit
- Core Coupling: Changes to core types affect game

**When Worth It:** New or simple games where state fits naturally.

---

## Hybrid Approach?

**Could you mix both?** Yes, but not recommended.

Example:
```typescript
// Store some state in core
room.gameState.data = {
  currentRound: 5,
  scores: {...}
};

// Store complex state in game manager
gameManager.rooms.get(roomId).complexVotingLogic = {...};
```

**Problems:**
- Unclear where to look for state
- Easy to get out of sync
- Worst of both worlds

**Better:** Pick one pattern and stick with it.

---

## Real-World Migration Decision Tree

```
Start: Migrating Game to Unified Server
│
├─ Is this a new game or early in development?
│  └─ YES → Use Direct Integration (ClueScale pattern)
│
├─ Does the game have 1 simple mode?
│  └─ YES → Consider Direct Integration
│
├─ Does game state fit in 5-10 fields?
│  └─ YES → Use Direct Integration
│
├─ Is there a complex existing GameManager?
│  └─ YES → Use Wrapper Pattern (SUSD pattern)
│
├─ Are there 3+ completely different game modes?
│  └─ YES → Use Wrapper Pattern
│
├─ Does the game have Pass & Play / single device?
│  └─ YES → Use Wrapper Pattern
│
├─ Is there extensive custom Player state?
│  └─ YES → Use Wrapper Pattern
│
└─ DEFAULT → Start with Direct Integration,
              switch to Wrapper if you hit limitations
```

---

## Conclusion

**SUSD uses Wrapper** because it's a mature, complex game with multiple modes and extensive state that would be hard to cram into core Room.

**ClueScale uses Direct** because it's simpler, fits core Room naturally, and benefits from having a single source of truth.

**Both patterns work!** Choose based on your game's complexity, not preference. The unified server supports both approaches equally well.

**Rule of Thumb:**
- Simple game or new development? → Direct Integration
- Complex legacy game or multiple modes? → Wrapper Pattern

When in doubt, start with Direct Integration. You can always refactor to Wrapper if you hit limitations. Going the other way (Wrapper → Direct) is much harder.
