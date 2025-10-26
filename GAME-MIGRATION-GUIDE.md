# Game Migration Guide: Consolidating Games into Unified Server

**Version:** 1.0.0
**Last Updated:** 2025-10-24
**Authors:** Claude Code

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture Patterns](#architecture-patterns)
3. [Prerequisites](#prerequisites)
4. [Migration Steps](#migration-steps)
5. [Critical Pitfalls & Solutions](#critical-pitfalls--solutions)
6. [Testing Checklist](#testing-checklist)
7. [Case Studies](#case-studies)
8. [Reference Architecture](#reference-architecture)

---

## Overview

This guide documents the process of migrating standalone game servers to the unified game server architecture. It is based on successful migrations of **ClueScale** and **SUSD (SUS Game)**, documenting patterns, pitfalls, and solutions discovered during the process.

### Why Unified Server?

**Benefits:**
- Single server process for all games
- Shared infrastructure (chat, WebRTC, GameBuddies integration)
- Centralized room/player management
- Consistent error handling
- Reduced deployment complexity
- Shared session management and reconnection logic

**Trade-offs:**
- Initial migration effort
- Potential for cross-game interference (mitigated by namespaces)
- More complex architecture to understand initially

---

## Architecture Patterns

There are **two primary patterns** for integrating games into the unified server:

### Pattern 1: Direct Core Integration (ClueScale)

**Characteristics:**
- Game plugin directly manipulates core `Room` objects
- Game state stored in `room.gameState.data`
- Game settings stored in `room.settings.gameSpecific`
- Simpler, fewer abstraction layers
- Best for games that align well with core room structure

**When to Use:**
- Game has simple player/room concepts
- Game doesn't need complex internal state management
- You want minimal abstraction overhead

**Example Structure:**
```typescript
// Game state stored directly in core Room
room.gameState.phase = 'round_clue';
room.gameState.data = {
  round: { index: 1, clueWord: 'test', ... },
  roleQueue: [...],
  roundTimer: undefined
};
room.settings.gameSpecific = {
  roundDuration: 60,
  categories: [...],
  teamBonusEnabled: true
};
```

### Pattern 2: Game Manager Wrapper (SUSD)

**Characteristics:**
- Game maintains its own internal room structure
- Core room acts as a lightweight shell
- Game Manager handles all game logic
- Mapping between core rooms and game rooms
- More abstraction, more flexibility

**When to Use:**
- Game has complex existing room/state structure
- Game needs significant independence from core
- Migration from legacy code with established patterns
- Multiple game modes with different structures

**Example Structure:**
```typescript
// Core room is minimal
coreRoom.code = 'ABC123';
coreRoom.gameState.phase = 'lobby';

// Game Manager maintains separate structure
class GameManager {
  private rooms = new Map<string, SUSDRoom>();

  createRoom(player, gameMode, coreRoomCode) {
    const susdRoom = {
      id: uuid(),
      code: coreRoomCode, // Link to core room
      players: new Map(),
      gameMode: gameMode,
      // ... complex game-specific structure
    };
    this.rooms.set(susdRoom.id, susdRoom);
  }
}
```

---

## Prerequisites

### 1. Understand Core Architecture

**Read These Files First:**
- `core/types/core.ts` - Core type definitions
- `core/RoomManager.ts` - Room lifecycle management
- `core/server.ts` - Socket event handling
- `games/clue/plugin.ts` - Simple integration example
- `games/susd/plugin.ts` - Complex integration example

**Key Concepts:**
- **Room**: Core container (code, gameId, players Map, gameState, settings)
- **Player**: Core player data (socketId, id, name, isHost, gameData)
- **GameState**: `{ phase: string, data: any }`
- **GameHelpers**: Helper functions for emitting events
- **Plugin**: Game-specific implementation of `GamePlugin` interface

### 2. Identify Game Structure

**Questions to Answer:**
1. Does your game have a standalone server or is it client-only?
2. What socket events does your game use?
3. How does your game structure rooms/lobbies/sessions?
4. What settings are configurable?
5. Does your game have complex state that changes frequently?
6. What chat implementation does it use?
7. Does it have WebRTC video/voice?

### 3. Backup Current Game

```bash
# Create backup
git branch backup/game-name-standalone
git push origin backup/game-name-standalone

# Or copy directory
cp -r path/to/game path/to/game-backup
```

---

## Migration Steps

### Step 1: Create Plugin Directory Structure

**Location:** `unified-game-server/games/{game-id}/`

**Required Structure:**
```
games/
└── {game-id}/
    ├── plugin.ts           # Main plugin class
    ├── types/
    │   └── index.ts       # Game-specific types
    ├── game/
    │   └── GameManager.ts # Game logic (if using Pattern 2)
    └── utils/
        └── *.ts           # Utility functions
```

**Example from ClueScale:**
```
games/
└── clue/
    ├── plugin.ts
    ├── types/
    │   └── index.ts       # ClueSettings, ClueGameState, Round, etc.
    ├── game/
    │   └── GameManager.ts # Round management, scoring
    └── utils/
        └── scoring.ts     # Scoring calculations
```

### Step 2: Create Type Definitions

**File:** `games/{game-id}/types/index.ts`

**Must Define:**

```typescript
// 1. Game-specific settings (stored in room.settings.gameSpecific)
export interface YourGameSettings {
  roundDuration: number;
  maxPlayers: number;
  // ... game-specific settings
}

// 2. Game state (stored in room.gameState.data)
export interface YourGameState {
  currentRound: number | null;
  // ... game-specific state
}

// 3. Player game data (stored in player.gameData)
export interface YourPlayerData {
  score: number;
  // ... player-specific data
}

// 4. Default values
export const DEFAULT_SETTINGS: YourGameSettings = {
  roundDuration: 60,
  maxPlayers: 20,
};
```

**⚠️ CRITICAL: Null Safety**

Always provide default values and use nullish coalescing:

```typescript
// ❌ BAD - Will crash if gameData is undefined
const score = (player.gameData as YourPlayerData).score;

// ✅ GOOD - Safe access with default
const playerData = player.gameData as YourPlayerData;
const score = playerData?.score ?? 0;
```

### Step 3: Create Plugin Class

**File:** `games/{game-id}/plugin.ts`

**Template:**

```typescript
import type { GamePlugin, Room, Player, GameHelpers } from '../../core/types/core.js';
import type { Socket } from 'socket.io';
import { YourGameState, YourGameSettings, YourPlayerData, DEFAULT_SETTINGS } from './types/index.js';

class YourGamePlugin implements GamePlugin {
  // ========================================
  // 1. METADATA (Required)
  // ========================================
  id = 'your-game-id';           // Must match directory name
  name = 'Your Game Name';        // Display name
  version = '1.0.0';
  namespace = '/your-game';       // Socket.IO namespace
  basePath = '/your-game';        // HTTP route base

  // ========================================
  // 2. DEFAULT SETTINGS (Required)
  // ========================================
  defaultSettings = {
    minPlayers: 3,
    maxPlayers: 20,
  };

  // ========================================
  // 3. INITIALIZATION (Optional)
  // ========================================
  async onInitialize(io: any) {
    console.log('[YourGame] Initializing plugin...');
    // Load content, initialize managers, etc.
    console.log('[YourGame] Plugin initialized');
  }

  // ========================================
  // 4. LIFECYCLE HOOKS (Optional)
  // ========================================

  onRoomCreate(room: Room) {
    console.log(`[YourGame] Room ${room.code} created`);

    // Initialize game state
    room.gameState.phase = 'lobby';
    room.gameState.data = {
      // Your initial game state
    } as YourGameState;

    // Initialize game-specific settings
    room.settings.gameSpecific = {
      ...DEFAULT_SETTINGS,
    } as YourGameSettings;
  }

  onPlayerJoin(room: Room, player: Player, isReconnecting: boolean) {
    console.log(`[YourGame] Player ${player.name} joined room ${room.code}`);

    // Initialize player game data (if not reconnecting)
    if (!isReconnecting) {
      player.gameData = {
        score: 0,
        // ... other player data
      } as YourPlayerData;
    }
  }

  onPlayerLeave(room: Room, player: Player) {
    console.log(`[YourGame] Player ${player.name} left room ${room.code}`);
    // Handle player leaving (pause game, etc.)
  }

  // ========================================
  // 5. SOCKET HANDLERS (Required)
  // ========================================
  socketHandlers = {
    // Two-step room creation (see below)
    'your-game:setup-game': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      // Setup game after core room created
    },

    'your-game:action': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
      // Handle game-specific actions
    },
  };
}

export default new YourGamePlugin();
```

### Step 4: Implement Two-Step Room Creation

**Why Two Steps?**
The core server creates the base room first, then the game plugin sets up game-specific data.

**Client Flow:**
```typescript
// Step 1: Create core room
socket.emit('room:create', {
  playerName: 'Alice',
  gameId: 'your-game-id',
  settings: { minPlayers: 3, maxPlayers: 20 }
});

socket.on('room:created', ({ sessionToken, room }) => {
  // Step 2: Setup game-specific data
  socket.emit('your-game:setup-game', {
    settings: {
      roundDuration: 60,
      customOption: true
    }
  });
});

socket.on('your-game:game-setup', ({ room }) => {
  // Room is fully set up, render lobby
});
```

**Server Handler (in plugin.ts):**
```typescript
'your-game:setup-game': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
  try {
    console.log(`[YourGame] Setting up game for room ${room.code}`);
    const { settings } = data;

    // Update game-specific settings in room.settings.gameSpecific
    const currentSettings = room.settings.gameSpecific as YourGameSettings;
    if (settings) {
      if (settings.roundDuration !== undefined) {
        currentSettings.roundDuration = settings.roundDuration;
      }
      // Update other settings...
    }

    // Serialize room to client format (CRITICAL - see Step 5)
    const lobby = this.serializeRoomToLobby(room, socket.id);

    // Emit setup complete
    helpers.sendToRoom(room.code, 'your-game:game-setup', { room: lobby });
    console.log(`[YourGame] Game setup complete for room ${room.code}`);
  } catch (error) {
    console.error('[YourGame] Error in setup:', error);
    socket.emit('error', { message: 'Failed to setup game' });
  }
}
```

### Step 5: Create Serialization Function

**⚠️ CRITICAL: This is the #1 source of bugs**

The unified server's `Room` structure does NOT match legacy client expectations. You MUST create a serialization function.

**Why This Matters:**
- Server stores `players` as `Map<string, Player>`
- Clients expect `players` as `Player[]`
- Server uses `room.gameState.phase`, clients may expect `state`
- Settings structure differs between server and client
- Client needs `mySocketId` field (server doesn't have this)

**Template:**

```typescript
/**
 * Serialize Room to client Lobby format
 *
 * ⚠️ CRITICAL: This function is MANDATORY
 * The unified server's Room structure doesn't match legacy client expectations
 */
private serializeRoomToLobby(room: Room, socketId: string) {
  const gameState = room.gameState.data as YourGameState;
  const gameSettings = room.settings.gameSpecific as YourGameSettings;

  // 1. Map server phase to client state enum
  let clientState: 'LOBBY' | 'PLAYING' | 'FINISHED';
  switch (room.gameState.phase) {
    case 'lobby':
      clientState = 'LOBBY';
      break;
    case 'playing':
      clientState = 'PLAYING';
      break;
    case 'finished':
      clientState = 'FINISHED';
      break;
    default:
      clientState = 'LOBBY';
  }

  // 2. Convert players Map to Array with client-expected format
  const players = Array.from(room.players.values()).map((p) => ({
    socketId: p.socketId,
    id: p.id,
    name: p.name,
    score: (p.gameData as YourPlayerData)?.score ?? 0, // ⚠️ Safe access!
    connected: p.connected,
    isHost: p.isHost,
  }));

  // 3. Extract and flatten settings
  const settings = {
    roundDuration: gameSettings.roundDuration,
    minPlayers: room.settings.minPlayers,
    maxPlayers: room.settings.maxPlayers,
    // ... other settings
  };

  // 4. Build game-specific data if needed
  let currentRound = null;
  if (gameState.currentRound) {
    currentRound = {
      index: gameState.currentRound.index,
      // ... round data
    };
  }

  // 5. Return complete Lobby object
  return {
    code: room.code,
    hostId: room.hostId,
    settings,
    players,
    state: clientState,
    currentRound,
    isGameBuddiesRoom: room.isGameBuddiesRoom,
    mySocketId: socketId,      // ⚠️ CRITICAL: Client needs this
    messages: room.messages,
  };
}
```

**Use Everywhere:**

```typescript
// ❌ BAD - Sending raw room
helpers.sendToRoom(room.code, 'event', { room });

// ✅ GOOD - Serialize first
const lobby = this.serializeRoomToLobby(room, socket.id);
helpers.sendToRoom(room.code, 'event', { room: lobby });
```

### Step 6: Migrate Socket Handlers

**Identify All Events:**

1. List all `socket.emit()` calls in old server
2. List all `socket.on()` calls in client
3. Map to core events or create game-specific handlers

**Event Categories:**

```typescript
// ========================================
// CORE EVENTS (Handled by core server)
// ========================================
// ✅ Already handled - do NOT implement in plugin
'room:create'        // Core creates room
'room:join'          // Core handles joining
'room:leave'         // Core handles leaving
'chat:message'       // Core handles chat
'player:kick'        // Core handles kicking
'webrtc:*'          // Core handles WebRTC signaling

// ========================================
// GAME EVENTS (Implement in plugin)
// ========================================
'your-game:setup-game'      // Setup after room creation
'your-game:start'           // Start game
'your-game:action'          // Game-specific actions
'your-game:submit-answer'   // Player submissions
```

**Handler Template:**

```typescript
'your-game:action': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
  try {
    const gameState = room.gameState.data as YourGameState;
    const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);

    if (!player) {
      socket.emit('error', { message: 'Player not found' });
      return;
    }

    // Validate phase
    if (room.gameState.phase !== 'expected_phase') {
      socket.emit('error', { message: 'Invalid game phase' });
      return;
    }

    // Validate data
    if (!data.requiredField) {
      socket.emit('error', { message: 'Missing required field' });
      return;
    }

    // Update game state
    gameState.someField = data.value;

    // Serialize and broadcast
    const lobby = this.serializeRoomToLobby(room, socket.id);
    helpers.sendToRoom(room.code, 'your-game:action-complete', { room: lobby });

    console.log(`[YourGame] Room ${room.code} - Action completed`);
  } catch (error: any) {
    console.error(`[YourGame] Error in action:`, error);
    socket.emit('error', { message: 'Action failed' });
  }
}
```

### Step 7: Update Client Code

**Changes Required:**

1. **Update Socket Connection:**

```typescript
// ❌ OLD - Standalone server
const socket = io('http://localhost:3000');

// ✅ NEW - Unified server with namespace
const socket = io('http://localhost:3001/your-game', {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 1000,
});
```

2. **Implement Two-Step Room Creation:**

```typescript
// Step 1: Core room creation
socket.emit('room:create', {
  playerName: playerName,
  gameId: 'your-game-id',
  settings: {
    minPlayers: 3,
    maxPlayers: 20,
  }
});

socket.on('room:created', ({ sessionToken, room }) => {
  // Store session token for reconnection
  localStorage.setItem('sessionToken', sessionToken);

  // Step 2: Game-specific setup
  socket.emit('your-game:setup-game', {
    settings: {
      // Game-specific settings
    }
  });
});

socket.on('your-game:game-setup', ({ room }) => {
  // Setup complete - render lobby
  setLobby(room);
});
```

3. **Update Chat Events:**

```typescript
// ❌ OLD - Custom chat events
socket.emit('chat:send-message', { roomCode, message });
socket.on('chat:message-received', (data) => { ... });

// ✅ NEW - Core chat events
socket.emit('chat:message', { message }); // No roomCode needed
socket.on('chat:message', (data) => { ... }); // Core server broadcasts
```

4. **Handle Lobby Updates:**

```typescript
// Core emits these automatically
socket.on('room:updated', ({ room }) => {
  setLobby(room);
});

socket.on('player:joined', ({ player }) => {
  console.log(`${player.name} joined`);
});

socket.on('player:left', ({ playerId }) => {
  console.log(`Player ${playerId} left`);
});
```

### Step 8: Register Plugin in Core Server

**File:** `core/server.ts`

**Find the plugin loading section and add your game:**

```typescript
// Load game plugins
const plugins = [
  await import('../games/susd/plugin.js'),
  await import('../games/clue/plugin.js'),
  await import('../games/your-game/plugin.js'), // ← Add this
];
```

**No other changes needed!** The core server will automatically:
- Register your namespace
- Setup socket handlers
- Call lifecycle hooks
- Handle room/player management

---

## Critical Pitfalls & Solutions

### Pitfall 1: Settings Storage Location

**❌ WRONG:**

```typescript
// Trying to store settings in gameState
gameState.settings = { roundDuration: 60 };
```

**✅ CORRECT:**

```typescript
// Settings go in room.settings.gameSpecific
room.settings.gameSpecific = {
  roundDuration: 60,
} as YourGameSettings;
```

**Why:** The core `Room` type doesn't have settings in gameState. Settings belong in `room.settings.gameSpecific`.

**Files to Check:**
- All handlers that update settings
- Serialization function
- Default values in `onRoomCreate`

---

### Pitfall 2: Null/Undefined gameData

**❌ CRASH:**

```typescript
// This will crash if gameData is undefined
const score = (player.gameData as PlayerData).score;

// This will crash in sort/map functions
players.sort((a, b) => {
  return a.gameData.score - b.gameData.score; // CRASH!
});
```

**✅ SAFE:**

```typescript
// Always use optional chaining and nullish coalescing
const playerData = player.gameData as PlayerData;
const score = playerData?.score ?? 0;

// Safe sorting
players.sort((a, b) => {
  const aData = a.gameData as PlayerData;
  const bData = b.gameData as PlayerData;
  const aScore = aData?.score ?? 0;
  const bScore = bData?.score ?? 0;
  return bScore - aScore;
});
```

**Why:** Players might not have `gameData` initialized, especially during reconnection or if they joined before the field was added.

**Files to Check:**
- All handlers that access `player.gameData`
- Scoring functions
- Leaderboard generation
- Any array operations (sort, map, filter)

---

### Pitfall 3: Chat Event Mismatches

**❌ WRONG:**

```typescript
// Client sending
socket.emit('chat:send-message', { roomCode, message });

// Client listening
socket.on('chat:message-received', (data) => { ... });
```

**✅ CORRECT:**

```typescript
// Client sending (core server handles routing)
socket.emit('chat:message', { message });

// Client listening (core server emits this)
socket.on('chat:message', (data) => { ... });
```

**Why:** Core server provides unified chat. Event names must match exactly.

**Verification:**
```bash
# Search client code for chat events
grep -r "chat:" client/src/

# Verify against core/server.ts:392 (chat handler)
```

---

### Pitfall 4: Serialization Everywhere

**❌ INCOMPLETE:**

```typescript
// Only serialized in setup handler
'your-game:setup-game': async (...) => {
  const lobby = this.serializeRoomToLobby(room, socket.id);
  helpers.sendToRoom(room.code, 'event', { room: lobby });
}

// But NOT in other handlers!
'your-game:action': async (...) => {
  helpers.sendToRoom(room.code, 'event', { room }); // ❌ Raw room!
}
```

**✅ EVERYWHERE:**

```typescript
// Create helper method
private emitLobbyUpdate(room: Room, helpers: GameHelpers, event: string, additionalData = {}) {
  // Serialize once
  const lobby = this.serializeRoomToLobby(room, ''); // Empty socket for room-wide

  // Send to all players in room
  helpers.sendToRoom(room.code, event, {
    room: lobby,
    ...additionalData
  });
}

// Use in all handlers
'your-game:action': async (...) => {
  // ... game logic ...
  this.emitLobbyUpdate(room, helpers, 'your-game:action-complete');
}
```

**Why:** Clients expect serialized format. One raw emission will break the UI.

---

### Pitfall 5: Player Identification

**❌ WRONG:**

```typescript
// Using socketId for game logic (changes on reconnect!)
gameState.currentPlayer = socket.id;

// Finding by socketId in game state
const player = players.find(p => p.socketId === gameState.currentPlayer);
```

**✅ CORRECT:**

```typescript
// Use stable player.id (UUID)
gameState.currentPlayerId = player.id;

// Find by stable ID
const player = Array.from(room.players.values())
  .find(p => p.id === gameState.currentPlayerId);
```

**Why:** `socketId` changes on reconnection. Use `player.id` (UUID) for game logic.

---

### Pitfall 6: Timer Cleanup

**❌ MEMORY LEAK:**

```typescript
// Setting timer but never clearing
gameState.timer = setTimeout(() => {
  endRound(room, helpers);
}, 60000);

// Room gets deleted but timer still runs!
```

**✅ PROPER CLEANUP:**

```typescript
// In plugin class
onPlayerLeave(room: Room, player: Player) {
  // Clean up timers when room might be deleted
  const gameState = room.gameState.data as YourGameState;
  if (gameState.timer) {
    clearTimeout(gameState.timer);
    gameState.timer = undefined;
  }
}

// Also clear before setting new timer
if (gameState.timer) {
  clearTimeout(gameState.timer);
}
gameState.timer = setTimeout(() => { ... }, duration);
```

---

### Pitfall 7: Event Listener Placement in React Apps

**⚠️ CRITICAL for React + Socket.IO applications**

**❌ BROKEN:**

```typescript
// App.tsx - NO useSocketEvents() call
function App() {
  const { socket, isConnected } = useSocket()
  // Missing: useSocketEvents() call!
  return <Routes>...</Routes>
}

// GamePage.tsx - Event listeners only registered here
const GamePage = () => {
  useSocketEvents() // ❌ Only active when this page is mounted!
  // ...
}

// User Flow:
// 1. Player2 is on HomePage (trying to join)
// 2. GamePage is NOT mounted yet
// 3. useSocketEvents() NOT executed → No listeners registered
// 4. Server emits 'room:joined' → Event lost! ❌
```

**✅ CORRECT:**

```typescript
// App.tsx - Event listeners registered at root level
import { useSocketEvents } from './hooks/useSocketEvents'

function App() {
  const { socket, isConnected } = useSocket()

  // Setup socket event listeners (must be active at all times)
  useSocketEvents() // ✅ Always active from app initialization

  return <Routes>...</Routes>
}

// GamePage.tsx - No event listener registration needed
const GamePage = () => {
  // Socket event listeners are now set up in App.tsx (active at all times)
  // ...
}
```

**Why:** React component lifecycle determines when hooks execute. If event listeners are registered in a page component:
- They only activate when that page is mounted
- Events emitted before navigation will be lost
- Join requests from different pages won't work

**How to Test:**
1. Create room in one browser tab
2. Open new tab, navigate to homepage
3. Try to join room from homepage
4. If listeners are in GamePage, join will fail
5. Server will show success but client times out

**Symptoms:**
- Server logs show "emitted successfully"
- Client shows "timeout" or never receives event
- No errors in console
- Works fine when testing single-player flow

**Files to Check:**
- `client/src/App.tsx` - Should have global event listener setup
- `client/src/pages/*.tsx` - Should NOT register global listeners
- `client/src/hooks/useSocketEvents.tsx` - Verify this is called from App.tsx

**Related Bug:** BingoBuddies migration (Case Study 3) - Player2 couldn't join rooms until this was fixed

---

### Pitfall 8: WebRTC State Synchronization

**Issue:** Old clients may track WebRTC state separately from core.

**❌ OLD CLIENT:**

```typescript
// Client maintains own video state
const [videoEnabled, setVideoEnabled] = useState(false);

socket.on('webrtc:peer-enabled', (data) => {
  // Custom handling
});
```

**✅ USE CORE TRACKING:**

```typescript
// Core server tracks in room.videoEnabledPeers
// Access via serialized lobby
const isVideoEnabled = lobby.players.find(p =>
  p.socketId === mySocketId
)?.videoEnabled;
```

**Server Side:** Core automatically emits `webrtc:peer-enabled` and `webrtc:peer-disabled` to all players in room.

---

## Testing Checklist

Use this checklist for every migration:

### Phase 1: Basic Integration

- [ ] Plugin loads without errors
- [ ] Namespace registered in core server
- [ ] Default settings applied correctly
- [ ] Room creation succeeds
- [ ] Room shows in admin dashboard (if available)

### Phase 2: Player Flow

- [ ] Player can create room (2-step process)
- [ ] Player can join room with code
- [ ] Multiple players can join same room
- [ ] Player list updates correctly
- [ ] Host indicator shows correctly
- [ ] Settings display correctly

### Phase 3: Game Functionality

- [ ] Game can start with minimum players
- [ ] Game state transitions correctly
- [ ] Player actions work as expected
- [ ] Scores/points update correctly
- [ ] Round progression works
- [ ] Game end flow completes
- [ ] Winner/results display correctly

### Phase 4: Chat & Communication

- [ ] Chat messages send successfully
- [ ] Chat messages received by all players
- [ ] System messages work (player joined/left)
- [ ] Chat history persists during game
- [ ] Emoji picker works (if applicable)

### Phase 5: Edge Cases

- [ ] Player disconnect during game
- [ ] Player reconnect after disconnect
- [ ] Session token restoration works
- [ ] Room deletion when last player leaves
- [ ] Kick player functionality
- [ ] Host migration (if applicable)
- [ ] Game handles rapid actions (no race conditions)

### Phase 6: Serialization

- [ ] All emitted events use serialized format
- [ ] Players array is Array (not Map)
- [ ] `mySocketId` field present
- [ ] Settings flattened correctly
- [ ] Phase/state mapped correctly
- [ ] No undefined fields in client

### Phase 7: Error Handling

- [ ] Invalid actions show error messages
- [ ] Network errors don't crash game
- [ ] Server errors logged but don't crash
- [ ] Client shows user-friendly errors
- [ ] Timeout scenarios handled gracefully

### Phase 8: Performance

- [ ] No memory leaks (timers cleaned up)
- [ ] No duplicate event listeners
- [ ] Efficient state updates (no excessive re-renders)
- [ ] WebRTC connections stable
- [ ] Multiple rooms don't interfere

### Phase 9: WebRTC (if applicable)

- [ ] Video chat can be enabled
- [ ] Video streams connect between players
- [ ] Audio works
- [ ] Camera toggle works
- [ ] Microphone toggle works
- [ ] Peer connections clean up on disconnect

### Phase 10: GameBuddies Integration (if applicable)

- [ ] Room creation from GameBuddies platform
- [ ] Status updates sent to platform
- [ ] Player return to platform works
- [ ] Streamer mode functions correctly

---

## Case Studies

### Case Study 1: ClueScale Migration

**Pattern Used:** Direct Core Integration

**Timeline:**
- Initial setup: 2 hours
- Bug fixes: 6 hours
- Total: ~1 day

**Challenges:**

1. **Settings Location Bug**
   - **Problem:** Plugin tried to store settings in `gameState.settings`
   - **Solution:** Changed to `room.settings.gameSpecific`
   - **Files Fixed:** `plugin.ts:238-273`, `plugin.ts:58-67`

2. **Serialization Bug**
   - **Problem:** `serializeRoomToLobby` read from wrong location
   - **Solution:** Read from `room.settings.gameSpecific`
   - **Impact:** Room creation failed with "Cannot read properties of undefined"

3. **Null Safety in Leaderboard**
   - **Problem:** Sorting crashed when `gameData` was undefined
   - **Solution:** Added `??` operators in sort and map
   - **Files Fixed:** `game/GameManager.ts:227-242`

4. **Chat Events Mismatch**
   - **Problem:** Client emitted `chat:send-message`, listened for `chat:message-received`
   - **Solution:** Changed both to `chat:message` (core event)
   - **Files Fixed:** `client/src/components/ChatWindow.tsx:43`, `client/src/App.tsx:379`

**Lessons Learned:**
- Always check settings storage location first
- Serialization must happen in EVERY handler
- Test null safety in all array operations
- Core chat events are simpler than custom implementation

**Testing:** Successfully ran 3-player game through 4 complete rounds with no crashes.

---

### Case Study 2: SUSD Migration

**Pattern Used:** Game Manager Wrapper

**Timeline:**
- Initial setup: 4 hours
- Complex refactoring: 8 hours
- Total: ~1.5 days

**Challenges:**

1. **Room Mapping Complexity**
   - **Problem:** SUSD had its own room structure, needed mapping to core rooms
   - **Solution:** Created `roomMapping: Map<coreCode, susdRoomId>`
   - **Impact:** Added abstraction layer but preserved legacy logic

2. **Multiple Game Modes**
   - **Problem:** Classic, Pass & Play, Voice Mode, Questions Mode
   - **Solution:** Game Manager handles mode-specific logic internally
   - **Benefit:** Core room structure stays simple

3. **Player Structure Mismatch**
   - **Problem:** SUSD Players had different fields than core Players
   - **Solution:** Convert between formats in handlers
   - **Code:**
     ```typescript
     const susdPlayer: SUSDPlayer = {
       id: corePlayer.id,
       name: corePlayer.name,
       socketId: corePlayer.socketId,
       isGamemaster: corePlayer.isHost,
       // ... SUSD-specific fields
     };
     ```

**Lessons Learned:**
- Wrapper pattern good for complex legacy code
- Mapping adds overhead but preserves existing logic
- Clear separation between core and game concerns
- More abstraction = more places to introduce bugs

**Testing:** Successfully tested all 4 game modes with various player counts.

---

### Case Study 3: BingoBuddies Migration

**Pattern Used:** Direct Core Integration

**Timeline:**
- Initial setup: 2 hours (server plugin)
- Client migration: 1 hour
- Bug fixes: 2 hours
- Testing: 1 hour
- Total: ~6 hours

**Challenges:**

1. **Socket Event Listeners Not Active**
   - **Problem:** Player2 join timed out even though server successfully emitted `room:joined` event
   - **Root Cause:** `useSocketEvents()` was only called in `GamePage.tsx`, but Player2 was on `HomePage.tsx` when joining, so event listeners weren't registered
   - **Solution:** Moved `useSocketEvents()` call from `GamePage.tsx` to `App.tsx` (in `AppContent` component) to ensure listeners are always active
   - **Files Fixed:**
     - `BingoBuddies/client/src/App.tsx` - Added `useSocketEvents()` import and call
     - `BingoBuddies/client/src/pages/GamePage.tsx` - Removed duplicate call
   - **Impact:** Critical bug that prevented multiplayer functionality - players couldn't join rooms

2. **Serialization Function Implementation**
   - **Problem:** Server Room structure uses `Map<string, Player>` but client expects `Player[]`
   - **Solution:** Created comprehensive `serializeRoomToLobby` function that:
     - Converts players Map to Array
     - Maps server phase to client GamePhase enum
     - Flattens settings structure
     - Adds `mySocketId` field for client use
   - **Files Created:** Serialization function in `games/bingo/plugin.ts:17-89`

3. **Two-Step Room Creation**
   - **Problem:** Client needed to adapt to unified server's two-step creation pattern
   - **Solution:**
     - Step 1: `room:create` → Core creates base room
     - Step 2: `bingo:setup-game` → Plugin initializes game-specific data
   - **Files Modified:**
     - `BingoBuddies/client/src/pages/HomePage.tsx` - Implemented two-step creation
     - `BingoBuddies/client/src/components/RootHandler.tsx` - Added GameBuddies integration handling

4. **Event Listener Lifecycle**
   - **Problem:** React component lifecycle affected event listener registration
   - **Insight:** Hooks like `useSocketEvents()` must be in components that are always mounted
   - **Best Practice:** Place global socket event listeners in `App.tsx`, not in routed pages

**Lessons Learned:**
- Event listener placement is critical - must be in root component
- Socket events can be emitted successfully but never received if listeners aren't active
- Always test the full user journey (create room → join from different tab)
- Server logs showing "success" doesn't mean client received the event
- React component mounting affects hook execution timing

**Testing:**
- ✅ Successfully created room with Host1 (3x3 grid)
- ✅ Player2 successfully joined from different browser tab
- ✅ Both players visible in lobby (2/8 players)
- ✅ Start Game button enabled with 2+ players
- ✅ Game transitioned to Input Phase
- ✅ 3x3 grid displayed correctly (9 textboxes)
- ✅ Progress tracking working (0/9 filled, 0/2 cards submitted)

**Key Achievement:**
Fixed a critical client-side architecture bug that would affect ANY multiplayer game where event listeners are conditionally registered. This fix ensures event listeners are always active regardless of which page the user is on.

---

## Reference Architecture

### Unified Server Structure

```
unified-game-server/
├── core/
│   ├── server.ts              # Main server, plugin loader
│   ├── RoomManager.ts         # Room lifecycle
│   ├── SessionManager.ts      # Session tokens
│   ├── types/
│   │   └── core.ts           # Core type definitions
│   └── services/
│       └── validation.ts     # Input validation
│
├── games/
│   ├── clue/                 # ClueScale (Direct pattern)
│   │   ├── plugin.ts
│   │   ├── types/
│   │   │   └── index.ts
│   │   ├── game/
│   │   │   └── GameManager.ts
│   │   └── utils/
│   │       └── scoring.ts
│   │
│   ├── susd/                 # SUSD (Wrapper pattern)
│   │   ├── plugin.ts
│   │   ├── types/
│   │   │   └── types.ts
│   │   ├── game/
│   │   │   └── GameManager.ts
│   │   └── data/
│   │       └── content.ts
│   │
│   └── your-game/           # Your new game
│       ├── plugin.ts
│       └── ...
│
├── package.json
└── tsconfig.json
```

### Event Flow Diagram

```
CLIENT                  CORE SERVER              GAME PLUGIN
  |                          |                        |
  |--room:create------------>|                        |
  |                          |--onRoomCreate--------->|
  |                          |<-----------------------|
  |<---room:created----------|                        |
  |                          |                        |
  |--your-game:setup-------->|                        |
  |                          |--handler-------------->|
  |                          |   (with Room object)   |
  |                          |<---sendToRoom----------|
  |<---your-game:setup-------|                        |
  |                          |                        |
  |--your-game:action------->|                        |
  |                          |--handler-------------->|
  |                          |   (updates Room)       |
  |                          |<---sendToRoom----------|
  |<---your-game:update------|                        |
```

### Data Flow: Settings

```
┌─────────────────────────────────────────────────┐
│ Client Creates Room                             │
│ room:create { minPlayers: 3, maxPlayers: 20 }   │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ Core Server                                     │
│ room.settings = {                               │
│   minPlayers: 3,         ← From client         │
│   maxPlayers: 20,        ← From client         │
│   gameSpecific: {}       ← Empty, for plugin   │
│ }                                                │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ Plugin onRoomCreate                             │
│ room.settings.gameSpecific = {                  │
│   roundDuration: 60,     ← Plugin default      │
│   categories: [...]      ← Plugin default      │
│ }                                                │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ Client Setup                                    │
│ your-game:setup { roundDuration: 90 }           │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ Plugin Handler                                  │
│ room.settings.gameSpecific.roundDuration = 90   │
│                         ← Update from client    │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ Serialization                                   │
│ settings = {                                    │
│   roundDuration: 90,     ← From gameSpecific   │
│   minPlayers: 3,         ← From room.settings  │
│   maxPlayers: 20         ← From room.settings  │
│ }                                                │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│ Client Receives                                 │
│ { room: { settings: { ... } } }                 │
└─────────────────────────────────────────────────┘
```

### Memory Management

```typescript
// Plugin should track active resources
class YourGamePlugin implements GamePlugin {
  private activeTimers = new Map<string, NodeJS.Timeout>();
  private activeIntervals = new Map<string, NodeJS.Timeout>();

  onRoomCreate(room: Room) {
    // Initialize empty tracking
    this.activeTimers.set(room.code, []);
  }

  startTimer(room: Room, duration: number, callback: () => void) {
    const timer = setTimeout(callback, duration);
    this.activeTimers.get(room.code)?.push(timer);
    return timer;
  }

  onPlayerLeave(room: Room, player: Player) {
    // If room is now empty, clean up
    if (room.players.size === 0) {
      this.cleanupRoom(room.code);
    }
  }

  private cleanupRoom(roomCode: string) {
    // Clear all timers
    const timers = this.activeTimers.get(roomCode);
    if (timers) {
      timers.forEach(t => clearTimeout(t));
      this.activeTimers.delete(roomCode);
    }

    // Clear intervals
    const intervals = this.activeIntervals.get(roomCode);
    if (intervals) {
      intervals.forEach(i => clearInterval(i));
      this.activeIntervals.delete(roomCode);
    }
  }

  async onCleanup() {
    // Server shutdown - clean everything
    this.activeTimers.forEach(timers =>
      timers.forEach(t => clearTimeout(t))
    );
    this.activeIntervals.forEach(intervals =>
      intervals.forEach(i => clearInterval(i))
    );
  }
}
```

---

## Quick Reference

### Common Commands

```bash
# Development
npm run dev              # Start server with hot reload

# Testing
npm run test            # Run all tests
npm run test:game       # Run specific game tests

# Production
npm run build           # Build TypeScript
npm start               # Start production server

# Debugging
npm run dev:debug       # Start with inspector
```

### Useful File Paths

```typescript
// Core
import { Room, Player, GameHelpers } from '../../core/types/core.js';

// Your game
import { YourSettings, YourState } from './types/index.js';

// Utilities
import { randomUUID } from 'crypto';
```

### Environment Variables

```bash
# .env
PORT=3001
GAMEBUDDIES_API_KEY_YOUR_GAME=your-api-key-here
CORS_ORIGINS=http://localhost:5173,https://gamebuddies.io
```

### Logging Standards

```typescript
// Room-specific logs
console.log(`[YourGame] Room ${room.code} - Action completed`);

// Player-specific logs
console.log(`[YourGame] Player ${player.name} in room ${room.code} - Score: ${score}`);

// Errors
console.error(`[YourGame] Error in handler:`, error);

// State changes
console.log(`[YourGame] Room ${room.code} - State: ${oldState} → ${newState}`);
```

---

## Conclusion

Migrating to the unified server provides significant benefits in maintainability, feature sharing, and deployment simplicity. By following this guide and learning from ClueScale and SUSD migrations, you can avoid common pitfalls and complete your migration efficiently.

### Key Takeaways

1. **Choose the right pattern** - Direct integration for simple games, wrapper for complex
2. **Serialization is critical** - Create once, use everywhere
3. **Null safety matters** - Always use `?.` and `??`
4. **Test thoroughly** - Use the checklist
5. **Clean up resources** - Timers, intervals, listeners
6. **Follow core conventions** - Events, logging, error handling

### Getting Help

- **Documentation:** `CLAUDE.md` for session notes
- **Examples:** Study `games/clue/` and `games/susd/`
- **Core API:** Read `core/types/core.ts`
- **Issues:** Check server console logs first

### Next Steps

1. Read this guide completely
2. Study both ClueScale and SUSD implementations
3. Create plugin structure for your game
4. Implement step-by-step, testing as you go
5. Add your game to this guide's case studies!

Good luck with your migration! 🚀
