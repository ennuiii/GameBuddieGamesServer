# ClueScale Migration to Unified Game Server - Session Notes

## Date: 2025-10-24

## Summary
Successfully migrated ClueScale from standalone server architecture to the unified game server, following the SUSD pattern. Discovered and fixed critical bugs in the two-step room creation flow that were preventing the game from loading.

---

## ⚠️ IMPORTANT: Migrating Other Games

**Before migrating any other game to the unified server, READ THIS FIRST:**

📖 **[GAME-MIGRATION-GUIDE.md](./GAME-MIGRATION-GUIDE.md)**

This comprehensive guide contains:
- ✅ Two proven architecture patterns (Direct Integration vs Wrapper)
- ✅ Complete step-by-step migration process
- ✅ All critical pitfalls and solutions from ClueScale & SUSD migrations
- ✅ Testing checklist (10 phases)
- ✅ Detailed case studies with code examples
- ✅ Serialization templates (the #1 source of bugs)
- ✅ Null-safety patterns
- ✅ Event mapping strategies
- ✅ Memory management best practices

**This guide will save you hours of debugging by documenting every bug we encountered and how to avoid them.**

The rest of this document (CLAUDE.md) contains session-specific notes from the ClueScale migration. Use it as a reference, but start with GAME-MIGRATION-GUIDE.md for your migration.

---

## What We Accomplished

### 1. Installed Playwright MCP
- **Location**: `C:\Users\Basti\.claude.json`
- **Command Used**: `claude mcp add playwright npx '@playwright/mcp@latest'`
- **Purpose**: Enable visual browser testing to debug the room creation flow

### 2. Created Visual Test Script
- **File**: `E:\GamebuddiesPlatform\unified-game-server\run-visual-test.js`
- **Features**:
  - Opens Chrome browser in headed mode (visible)
  - 1-second slow motion between actions
  - Captures browser console logs
  - Tests full flow: Create room → Join room → Verify players see each other
  - Takes screenshots at each step
  - Keeps browser open for 30 seconds after completion

### 3. Fixed Critical Bugs in ClueScale Plugin

#### Bug #1: Missing `clue:setup-game` Socket Handler
**Problem**: The two-step room creation flow was incomplete. Client was emitting `clue:setup-game` but server had no handler.

**Location**: `E:\GamebuddiesPlatform\unified-game-server\games\clue\plugin.ts:145-166`

**Fix**: Added complete socket handler
```typescript
'clue:setup-game': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
  try {
    console.log(`[ClueScale] Setting up game for room ${room.code}`);
    const { settings } = data;

    // Update game settings in room
    const gameState = room.gameState.data as ClueGameState;
    if (settings) {
      gameState.settings = {
        ...gameState.settings,
        ...settings
      };
    }

    // Serialize room (convert Map to array)
    const serializedRoom = {
      ...room,
      players: Array.from(room.players.values())
    };

    // Emit setup complete
    helpers.sendToRoom(room.code, 'clue:game-setup', { room: serializedRoom });
    console.log(`[ClueScale] Game setup complete for room ${room.code}`);
  } catch (error) {
    console.error('[ClueScale] Error in clue:setup-game:', error);
    socket.emit('error', { message: 'Failed to setup game' });
  }
}
```

#### Bug #2: Wrong Helper Method Name
**Problem**: Used `helpers.emitToRoom()` which doesn't exist in the GameHelpers interface.

**Error**: `TypeError: helpers.emitToRoom is not a function`

**Fix**: Changed to `helpers.sendToRoom()` (line 166)

**Reference**: Core GameHelpers interface at `E:\GamebuddiesPlatform\unified-game-server\core\types\core.ts:112-118`

#### Bug #3: Room Serialization Issue
**Problem**: Server sent `room.players` as a Map object, but React client expected an Array, causing:
```
[PAGE ERROR] players.map is not a function
```

**Root Cause**: Unified server uses `Map<string, Player>` for `room.players`, but ClueScale client expects `Player[]`

**Fix**: Added serialization before sending room to client (lines 160-163)
```typescript
const serializedRoom = {
  ...room,
  players: Array.from(room.players.values())
};
```

**Pattern**: Found same pattern in core server at `core/server.ts:668`

### 4. Verified Two-Step Room Creation Flow

The complete flow now works:

**Step 1: Create Core Room**
- Client: `socket.emit('room:create', { playerName, settings })`
- Server: Core creates room with basic data
- Server: Emits `room:created` with sessionToken

**Step 2: Setup ClueScale Game Data**
- Client: Receives `room:created`, stores sessionToken
- Client: `socket.emit('clue:setup-game', { settings })`
- Server: Updates game-specific settings in room.gameState.data
- Server: Serializes room (Map → Array)
- Server: Emits `clue:game-setup` with serialized room

**Step 3: Client Renders Lobby**
- Client: Receives `clue:game-setup`
- Client: Sets lobby state
- Client: Renders lobby UI with player list

### 5. Test Results

**Playwright Tests**: 14/17 passing (82% pass rate)
- ✅ Health check tests (6/6 passing)
- ✅ Basic room creation (working)
- ✅ Player list rendering (working)
- ⚠️ Some UI-specific tests need selector updates

**Visual Test Output** (Room MCTYZP):
```
Players (1)
Alice
HOST
Score: 2
```

**Browser Console Logs Confirmed**:
- Socket connected successfully
- Room created (two-step flow)
- Game setup complete
- Lobby rendered with no React errors

---

## What Still Needs to Be Done

### High Priority

1. **Test Multi-Player Flow**
   - Current visual test doesn't extract room code from page (UI doesn't show it in text)
   - Need to update test to use data attributes or add room code display
   - Verify Player 2 can join using room code
   - Test: Both players see each other in lobby

2. **Fix Remaining Socket Handlers**
   - All socket handlers in `plugin.ts` need room serialization
   - Affected handlers:
     - `game:start` (line 171+)
     - `round:submit-clue`
     - `round:submit-guess`
     - `round:next`
     - `round:skip-turn`
     - `settings:update`
     - `game:restart`
     - `player:kick`
   - Each must serialize room before emitting: `players: Array.from(room.players.values())`

3. **Verify Game Mechanics**
   - Test starting a game (3+ players required)
   - Test clue submission
   - Test guessing
   - Test round completion
   - Test scoring
   - Test game end flow

4. **Fix Playwright Test Selectors**
   - Update tests to handle new UI structure
   - Fix 3 failing tests (likely CSS selector issues)
   - Tests affected:
     - Multi-player join test
     - Game start test
     - Settings display test

### Medium Priority

5. **Update All Event Emitters**
   - Search codebase for all places that emit room updates
   - Ensure consistent serialization pattern
   - Pattern to use:
     ```typescript
     const serializedRoom = {
       ...room,
       players: Array.from(room.players.values())
     };
     helpers.sendToRoom(room.code, 'event:name', { room: serializedRoom });
     ```

6. **Verify Reconnection Logic**
   - Test session token storage and retrieval
   - Test player reconnection after disconnect
   - Verify player.id (UUID) vs socketId handling

7. **Test WebRTC Integration**
   - Verify video chat works with unified server
   - Test signaling through `/clue` namespace
   - Verify peer connection handling

8. **GameBuddies Integration**
   - Test streamer mode room creation
   - Verify GameBuddies session tokens
   - Test status updates to GameBuddies platform

### Low Priority

9. **Code Cleanup**
   - Remove old server references (if any remain)
   - Update comments to reflect unified server architecture
   - Remove debugging console.logs

10. **Documentation**
    - Document two-step room creation pattern
    - Add architecture decision record for Direct Core Integration vs Wrapper pattern
    - Document serialization requirements

11. **Performance Optimization**
    - Consider caching serialized room objects
    - Optimize timer management
    - Review memory leaks in timer cleanup

---

## Technical Decisions Made

### Architecture Pattern: Direct Core Integration
- **Chosen**: Directly manipulate core Room objects in plugin handlers
- **Alternative**: SUSD's Game Manager Wrapper pattern (adds abstraction layer)
- **Reason**: Simpler, fewer moving parts, easier to understand

### Player Identity: UUIDs
- **Implementation**: Use `player.id` (stable UUID) instead of `socketId`
- **Reason**: Enables reconnection - socketId changes on disconnect/reconnect
- **Location**: All game logic uses `player.id` for player identification

### Room Serialization Strategy
- **Problem**: Core uses `Map<string, Player>` but clients expect `Player[]`
- **Solution**: Serialize on emit: `players: Array.from(room.players.values())`
- **Applied**: Every socket emission that includes room data
- **Not Applied**: Internal game logic (still uses Map)

---

## File Changes Summary

### Server Files Modified
1. `E:\GamebuddiesPlatform\unified-game-server\games\clue\plugin.ts`
   - Added `clue:setup-game` handler (lines 145-171)
   - Added room serialization pattern

### Client Files Previously Modified (Earlier Session)
1. `E:\GamebuddiesPlatform\ClueScale\client\src\App.tsx`
   - Implemented two-step room creation
   - Added session token handling

2. `E:\GamebuddiesPlatform\ClueScale\client\src\services\socketService.ts`
   - Updated namespace to `/clue`
   - Added reconnection logic

### Test Files Created
1. `E:\GamebuddiesPlatform\unified-game-server\run-visual-test.js`
   - Visual browser testing script
   - Slow motion playback
   - Console log capture

2. `E:\GamebuddiesPlatform\unified-game-server\playwright.config.ts`
   - Playwright configuration (created earlier)

3. `E:\GamebuddiesPlatform\unified-game-server\tests\demo.spec.ts`
   - Demo test with screenshots

4. `E:\GamebuddiesPlatform\unified-game-server\tests\cluescale.spec.ts`
   - Integration test suite (11 tests)

5. `E:\GamebuddiesPlatform\unified-game-server\tests\server-health.spec.ts`
   - Health check tests (6 tests, all passing)

### Configuration Files
1. `C:\Users\Basti\.claude.json`
   - Added Playwright MCP configuration

---

## Commands Used

### Testing
```bash
# Run visual test (slow motion, headed mode)
node run-visual-test.js

# Run Playwright tests (headless)
npm run test:cluescale

# Run tests in headed mode (see browser)
npm run test:headed

# Run health tests
npm run test:health

# Run with UI mode (interactive)
npx playwright test --ui

# Run in debug mode
npx playwright test --debug
```

### Server Management
```bash
# Start unified server (auto-reload on changes)
npm run dev

# Start ClueScale client
cd E:\GamebuddiesPlatform\ClueScale\client
npm run dev

# Kill port if stuck
npx kill-port 3001
npx kill-port 5173
```

---

## Known Issues

1. **Room Code Not Visible in UI**
   - Room code exists (logged: MCTYZP) but not displayed on page
   - Test script can't extract it from page text
   - Need to either:
     - Add room code display to Lobby UI
     - Use data attributes for testing
     - Extract from lobby object in JS

2. **Test Selector Brittleness**
   - Some tests use text-based selectors that break with UI changes
   - Need more robust selectors (data-testid attributes)

3. **Timer Cleanup**
   - Need to verify all timers are properly cleaned up
   - Check for memory leaks in long-running rooms

---

## Next Steps (Recommended Order)

1. ✅ Fix room serialization in `clue:setup-game` handler ← **DONE**
2. 🔄 Add room serialization to ALL other socket handlers in plugin.ts
3. 🔄 Update visual test to handle room code extraction
4. 🔄 Test complete two-player flow (create + join)
5. 🔄 Test game start with 3+ players
6. 🔄 Test full game round (clue → guess → score)
7. 🔄 Fix remaining Playwright test failures
8. 🔄 Test reconnection scenarios
9. 🔄 Test GameBuddies integration
10. 🔄 Performance testing with multiple rooms

---

## Server Logs Pattern

Successful room creation now shows:
```
[CLUE-SCALE] Player connected: X0nQUGP3lq42MmjLAAAP
[RoomManager] Created room MCTYZP for game clue-scale (host: Alice)
[SessionManager] Created session for player [UUID] in room MCTYZP
[ClueScale] Room MCTYZP created with initial game state
[CLUE-SCALE] Room created: MCTYZP
[CLUE-SCALE] Received event: clue:setup-game from socket X0nQUGP3lq42MmjLAAAP
[ClueScale] Setting up game for room MCTYZP
[ClueScale] Game setup complete for room MCTYZP
```

---

## References

- SUSD migration pattern: `E:\GamebuddiesPlatform\unified-game-server\games\susd\plugin.ts`
- Core types: `E:\GamebuddiesPlatform\unified-game-server\core\types\core.ts`
- GameHelpers interface: Line 112-118 in core.ts
- Room serialization example: core/server.ts:668
- Playwright docs: https://playwright.dev/docs/intro

---

# Session 2: Critical Serialization Bug Fix (2025-10-24 PM)

## Summary
Discovered and fixed a **CRITICAL** serialization bug that prevented the lobby UI from loading. The unified server's `Room` structure does not match the client's `Lobby` structure, causing `state` and `mySocketId` to be undefined. This is a **MANDATORY FIX** for all future game migrations.

## ⚠️ CRITICAL BUG: Room-to-Lobby Structure Mismatch

### Problem

**Symptoms:**
- Lobby UI doesn't render (only webcam and player list visible)
- Browser console shows: `lobby.state: undefined`, `mySocketId: undefined`
- No errors thrown, but main content is missing
- Server creates room successfully but client can't display it

**Root Cause:**

The unified server uses a different data structure than the old standalone ClueScale server:

**Server sends (Room):**
```typescript
{
  code: "ABC123",
  gameId: "clue-scale",
  hostId: "uuid-123",
  players: Map<string, Player>,  // ❌ Map object, not Array!
  gameState: {
    phase: "lobby",              // ❌ Different field names
    data: ClueGameState          // ❌ Nested structure
  },
  settings: {
    minPlayers: 3,
    maxPlayers: 20,
    gameSpecific: {...}          // ❌ Settings in different location
  },
  messages: [...],
  isGameBuddiesRoom: true
}
```

**Client expects (Lobby):**
```typescript
{
  code: "ABC123",
  hostId: "uuid-123",
  players: Player[],             // ✅ Array
  state: "LOBBY_WAITING",        // ✅ Direct field
  round: Round | null,           // ✅ Direct field
  settings: {                    // ✅ Flat settings
    roundDuration: 60,
    minPlayers: 3,
    maxPlayers: 20,
    categories: [...],
    rotationType: "circular",
    teamBonusEnabled: true
  },
  mySocketId: "socketId",        // ✅ Client needs this!
  isGameBuddiesRoom: true,
  messages: [...]
}
```

**Key Differences:**
1. `room.players` is a `Map` on server, client expects `Array`
2. `room.gameState.phase` vs `lobby.state` (different names and values)
3. Settings structure is different (`gameSpecific` wrapper vs flat)
4. `mySocketId` field doesn't exist on server Room (must be added)
5. Round data is nested in `gameState.data.round` on server, direct on client

### The Fix: Serialization Function

**Location**: `E:\GamebuddiesPlatform\unified-game-server\games\clue\plugin.ts:17-89`

Created a dedicated serialization function that transforms the unified server's Room structure into the client's expected Lobby format:

```typescript
/**
 * Serialize Room to client Lobby format
 *
 * ⚠️ CRITICAL: This function is MANDATORY for all game plugins!
 * The unified server's Room structure doesn't match legacy client expectations.
 */
function serializeRoomToLobby(room: Room, socketId: string) {
  const gameState = room.gameState.data as ClueGameState;

  // 1. Map server phase to client GameState enum
  let clientState: 'LOBBY_WAITING' | 'ROUND_CLUE' | 'ROUND_GUESS' | 'ROUND_REVEAL' | 'GAME_END';
  switch (room.gameState.phase) {
    case 'lobby':
      clientState = 'LOBBY_WAITING';
      break;
    case 'round_clue':
      clientState = 'ROUND_CLUE';
      break;
    case 'round_guess':
      clientState = 'ROUND_GUESS';
      break;
    case 'round_reveal':
      clientState = 'ROUND_REVEAL';
      break;
    case 'finished':
      clientState = 'GAME_END';
      break;
    default:
      clientState = 'LOBBY_WAITING';
  }

  // 2. Convert players Map to Array with client-expected format
  const players = Array.from(room.players.values()).map((p) => ({
    socketId: p.socketId,
    name: p.name,
    score: (p.gameData as CluePlayerData)?.score || 0,
    connected: p.connected,
    isHost: p.isHost,
  }));

  // 3. Extract and flatten settings
  const settings = {
    roundDuration: gameState.settings.roundDuration,
    minPlayers: room.settings.minPlayers,
    maxPlayers: room.settings.maxPlayers,
    teamBonusEnabled: gameState.settings.teamBonusEnabled,
    rotationType: gameState.settings.rotationType,
    categories: gameState.settings.categories,
  };

  // 4. Build round data if exists
  let round = null;
  if (gameState.round) {
    round = {
      index: gameState.round.index,
      category: gameState.round.category,
      targetNumber: gameState.round.targetNumber,
      clueWord: gameState.round.clueWord,
      numberPickerId: null,
      clueGiverId: gameState.round.clueGiverId,
      guessCount: gameState.round.guesses.length,
    };
  }

  // 5. Return complete Lobby object
  return {
    code: room.code,
    hostId: room.hostId,
    settings,
    players,
    state: clientState,
    round,
    isGameBuddiesRoom: room.isGameBuddiesRoom,
    mySocketId: socketId,      // ⚠️ CRITICAL: Must pass socketId here
    messages: room.messages,
  };
}
```

**Updated Socket Handler** (line 234):
```typescript
'clue:setup-game': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
  // ... update settings ...

  // ✅ Use serialization function
  const lobby = serializeRoomToLobby(room, socket.id);

  // Emit to all clients in room
  helpers.sendToRoom(room.code, 'clue:game-setup', { room: lobby });
}
```

### Before vs After

**Before (Broken):**
```
[App] lobby.state: undefined
[App] mySocketId: undefined
[UI] Only webcam and player list visible, no lobby content
```

**After (Fixed):**
```
[App] lobby.state: LOBBY_WAITING
[App] mySocketId: 0IhKhTW9LeRSLv2AAAAH
[UI] Full lobby with room code, settings, player list, start button
```

**Screenshots:**
- Before: `cluescale-lobby.png` (broken, no main content)
- After: `cluescale-working-lobby.png` (working, full UI)

### Testing Process

**Environment Setup:**
1. Created `.env` file in ClueScale client:
   ```
   VITE_BACKEND_URL=http://localhost:3001
   ```
2. Started unified server: `npm run dev` (port 3001)
3. Started ClueScale client: `npm run dev` (port 5173)

**Test Flow:**
1. Navigate to `http://localhost:5173`
2. Enter name "TestUser"
3. Click "Create Room"
4. ✅ Room created: FREH6X
5. ✅ Lobby UI displayed correctly
6. ✅ Room code visible
7. ✅ Player list showing host
8. ✅ Start Game button (disabled, needs 3 players)
9. ✅ Settings button visible

### Impact on Future Migrations

**⚠️ MANDATORY for ALL game migrations:**

Every game plugin migrating to the unified server **MUST**:

1. **Create a serialization function** that transforms `Room` → client expected format
2. **Identify client's data structure** (check client types file)
3. **Map all field names** between server and client
4. **Convert Map to Array** for players
5. **Add `mySocketId`** field (server doesn't have this)
6. **Transform nested data** (gameState.data → direct fields)
7. **Update ALL socket emits** to use serialization

**Files to Check:**
- Client types: `games/{game}/client/src/types.ts`
- Server Room type: `core/types/core.ts:19-44`
- Server GameState: `core/types/core.ts:46-49`

**Common Transformations:**
| Server (Room) | Client (Lobby) | Action |
|---------------|----------------|--------|
| `players: Map<>` | `players: []` | `Array.from(map.values())` |
| `gameState.phase` | `state` | Map string values |
| `gameState.data.{field}` | `{field}` | Flatten nested data |
| n/a | `mySocketId` | Add from `socket.id` |
| `settings.gameSpecific` | `settings` | Unwrap and merge |

### Debugging Tips

**Signs you need serialization:**
- ❌ Console shows `undefined` for expected fields
- ❌ UI partially renders (some components missing)
- ❌ No errors but broken display
- ❌ Server logs success but client state is wrong

**How to debug:**
1. Check browser console for `undefined` fields
2. Compare client types vs server Room structure
3. Add console.log to see what server sends vs client expects
4. Use Playwright browser testing to see actual rendering

### Additional Handlers to Update

The serialization function must be used in **ALL** handlers that emit room data:

**Still TODO:**
- `room:joined` - When player joins
- `room:updated` - When room settings change
- `game:start` - When game starts
- `round:start` - When round begins
- `round:clue-submitted` - After clue submission
- `round:reveal` - Round results
- `game:state-sync` - Reconnection sync

**Pattern to follow:**
```typescript
'event:name': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
  // ... game logic ...

  // ✅ Always serialize before emitting
  const lobby = serializeRoomToLobby(room, socket.id);
  helpers.sendToRoom(room.code, 'event:response', { room: lobby });
}
```

---

## Testing Checklist for Future Games

When migrating a game to unified server:

### Initial Setup
- [ ] Create `.env` file with correct port
- [ ] Update client socket namespace
- [ ] Verify server plugin loaded

### Serialization
- [ ] Identify client's expected data structure (check types.ts)
- [ ] Create serialization function
- [ ] Update `room:create` handler to use serialization
- [ ] Update `room:join` handler to use serialization
- [ ] Update ALL game event handlers to use serialization

### Testing
- [ ] Test room creation (check lobby renders)
- [ ] Test room joining (check player sees room)
- [ ] Test game start (check state transitions)
- [ ] Test gameplay (check all events work)
- [ ] Test reconnection (check state sync)
- [ ] Check browser console for `undefined` warnings
- [ ] Use Playwright for visual confirmation

### Common Errors
- [ ] `lobby.state: undefined` → Add state mapping
- [ ] `mySocketId: undefined` → Pass socket.id to serialization
- [ ] `players.map is not a function` → Convert Map to Array
- [ ] Missing nested data → Flatten gameState.data fields

---

## Server Logs After Fix

```
[CLUE-SCALE] Player connected: 0IhKhTW9LeRSLv2AAAAH
[RoomManager] Created room FREH6X for game clue-scale (host: TestUser)
[SessionManager] Created session for player [UUID] in room FREH6X
[ClueScale] Room FREH6X created with initial game state
[CLUE-SCALE] Room created: FREH6X
[CLUE-SCALE] Received event: clue:setup-game from socket 0IhKhTW9LeRSLv2AAAAH
[ClueScale] Setting up game for room FREH6X
[ClueScale] Game setup complete for room FREH6X
```

**Client Logs:**
```
[App] ClueScale game setup complete: FREH6X
[App] lobby.state: LOBBY_WAITING      ← ✅ NOW DEFINED
[App] mySocketId: 0IhKhTW9LeRSLv2AAAAH  ← ✅ NOW DEFINED
[App] Rendering Lobby
```

---

## Key Takeaways

1. **NEVER assume** server and client structures match
2. **ALWAYS create** a serialization layer
3. **CHECK types** before starting migration
4. **TEST visually** with browser (Playwright)
5. **Map all fields** explicitly (don't spread objects blindly)
6. **Add `mySocketId`** - clients often need to know their own socket
7. **Convert Maps to Arrays** - clients can't iterate Maps easily
8. **Document your serialization** - next dev will thank you

This bug would affect **EVERY** game migration. Having this documented will save hours of debugging!

---

# Session 3: Error Handling Implementation (2025-10-24 PM)

## Summary
Implemented comprehensive error handling to prevent server crashes from uncaught exceptions. Used global error handlers instead of per-handler wrappers for simplicity and maintainability.

## ⚠️ CRITICAL: Error Handling Strategy

### Problem
The unified server handles multiple games and rooms simultaneously. If ANY socket handler throws an uncaught error, the entire server crashes, affecting ALL games and ALL players.

**Impact**: A single bug in one game's code could crash the entire platform.

### Solution: Multi-Layer Error Handling

We implemented a **three-layer error handling strategy**:

#### Layer 1: Global Process Error Handlers ✅ IMPLEMENTED
**Location**: `E:\GamebuddiesPlatform\unified-game-server\core\server.ts:34-44`

These catch ANY uncaught errors or unhandled promise rejections across the entire process:

```typescript
// Global error handlers to prevent server crashes
process.on('uncaughtException', (error: Error) => {
  console.error('❌ [FATAL] Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  // Server continues running
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('❌ [FATAL] Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
  // Server continues running
});
```

**What this prevents:**
- Server crashes from any uncaught errors
- Loss of all active game sessions
- Platform downtime

**What this DOESN'T do:**
- Send error responses to clients
- Provide context about which handler failed
- Clean up game state after errors

#### Layer 2: Game-Specific Handler Try-Catch ✅ ALREADY EXISTS
**Location**: `E:\GamebuddiesPlatform\unified-game-server\core\server.ts:574-596`

Game-specific socket handlers are automatically wrapped in try-catch:

```typescript
for (const [event, handler] of Object.entries(plugin.socketHandlers)) {
  socket.on(event, async (data: any) => {
    const room = this.roomManager.getRoomBySocket(socket.id);

    if (!room) {
      socket.emit('error', { message: 'Not in a room' });
      return;
    }

    const helpers = createHelpers(room);

    try {
      await handler(socket, data, room, helpers);
    } catch (error: any) {
      console.error(`[${plugin.id.toUpperCase()}] Error in ${event} handler:`, error);
      socket.emit('error', { message: 'Internal server error' });
    }
  });
}
```

**What this provides:**
- Error responses sent to affected client
- Specific error logs with event name and game ID
- Server continues running
- Other players unaffected

#### Layer 3: Core Handler Protection ⚠️ OPTIONAL
**Status**: Not implemented - global handlers sufficient

Core handlers (`room:create`, `room:join`, etc.) DON'T have individual try-catch blocks. This is **intentional** because:

1. **Global handlers prevent crashes** - Layer 1 catches everything
2. **Simpler code** - No wrapper complexity or boilerplate
3. **Easier to maintain** - Fewer lines, clearer logic
4. **Core handlers are simple** - Mostly validation and calls to RoomManager

**If needed later**, we can add try-catch to specific core handlers like:

```typescript
socket.on('room:create', async (data) => {
  try {
    // ... handler logic ...
  } catch (error: any) {
    console.error('[CORE] Error in room:create:', error);
    socket.emit('error', { message: 'Failed to create room' });
  }
});
```

### Why We Avoided the Wrapper Approach

**Attempted approach:**
```typescript
const wrapHandler = (eventName, handler) => {
  return async (data) => {
    try {
      await handler(data);
    } catch (error) {
      // error handling
    }
  };
};

socket.on('room:create', wrapHandler('room:create', (data) => {
  // handler body
}));
```

**Problems encountered:**
- Syntax errors with complex handler signatures
- Difficult to debug
- Type inference issues
- Extra indentation and complexity
- Hard to read and maintain

**Better approach:**
```typescript
socket.on('room:create', async (data) => {
  try {
    // handler body
  } catch (error) {
    // error handling
  }
});
```

This is simpler, clearer, and easier to maintain. But even this isn't needed for all handlers when global error handlers exist.

### Testing Error Handling

To verify error handling works:

1. **Test uncaught exception**:
   - Add `throw new Error('Test error')` in a socket handler
   - Verify server logs the error but doesn't crash
   - Verify other rooms/games continue working

2. **Test unhandled rejection**:
   - Add `Promise.reject('Test rejection')` in a handler
   - Verify server logs the error but doesn't crash

3. **Test game-specific error**:
   - Throw error in ClueScale plugin handler
   - Verify client receives error message
   - Verify other players unaffected

### Error Handling Checklist for New Games

When migrating a game to unified server:

- [x] Global error handlers exist (core/server.ts)
- [x] Game-specific handlers auto-wrapped (core/server.ts:574-596)
- [ ] Test error scenarios (throw test errors)
- [ ] Verify error logs are clear and actionable
- [ ] Check that clients receive error responses
- [ ] Ensure other players/games unaffected by errors

### Error Log Format

**Good error log:**
```
[CLUE-SCALE] ❌ ERROR in clue:submit-guess:
Error: Invalid guess format
Stack: ...
```

**What to log:**
- Game ID in uppercase (e.g., `[CLUE-SCALE]`)
- Event name (e.g., `clue:submit-guess`)
- Error message
- Stack trace
- Context (room code, player ID if available)

### Common Error Scenarios

| Scenario | Handling | User Impact |
|----------|----------|-------------|
| Uncaught exception in handler | Global handler catches | None - error logged, server continues |
| Game plugin throws error | Try-catch sends error event | Client shows error message |
| Database connection fails | Plugin initialization fails | Game doesn't load, others unaffected |
| Invalid socket data | Validation fails early | Client gets validation error |
| Network timeout | Socket disconnect handler | Player marked disconnected, can reconnect |

### Files Modified

**Core Server** (`E:\GamebuddiesPlatform\unified-game-server\core\server.ts`):
- Lines 34-44: Added global error handlers
- Lines 574-596: Game-specific handler try-catch (already existed)
- Lines 238-627: Removed wrapHandler approach (too complex)

### Key Takeaways

1. **Global error handlers are mandatory** - Prevent entire server crashes
2. **Game-specific try-catch provides better UX** - Send errors to clients
3. **Don't over-engineer** - Simple solutions are often better
4. **Test error scenarios** - Throw test errors to verify handling works
5. **Log errors clearly** - Include context for debugging
6. **Errors should isolate** - One game's error shouldn't affect others

This error handling strategy protects the unified server from crashes while maintaining good user experience and debuggability.

---

# Session 4: BingoBuddies Migration + Critical Client Bug Fix (2025-10-24 PM)

## Summary
Successfully migrated BingoBuddies to the unified server and **discovered a critical client-side architecture bug** that prevented multiplayer from working. The bug was NOT in the server serialization or plugin code, but in React component lifecycle affecting socket event listener registration.

## ⚠️ CRITICAL: Event Listener Placement Bug

### The Problem

**Symptom:**
- Host (Player1) could create room successfully
- Player2's join request timed out: "Join timed out - please try again"
- Server logs showed **complete success**:
  ```
  [SessionManager] Created session for player [UUID] in room MGNY4D
  [RoomManager] Added player Player2 to room MGNY4D
  [Core] Emitting room:joined to socket [ID]
  [Core] Emitted room:joined to socket [ID]
  ```
- Client logs showed:
  ```
  🔵 [Join] Emitting room:join event
  🟢 [Join] room:join event emitted successfully
  ⏰ [Join] Timeout reached, joinCompleted: false
  ```

**What This Looked Like:**
Server was working perfectly. Event was emitted successfully. But client never received it!

### Root Cause Discovery

After adding debug logging to both server and client, we discovered:

**The server WAS sending the event correctly.**

The problem was in `BingoBuddies/client/src/App.tsx` and `GamePage.tsx`:

**BEFORE (Broken):**
```typescript
// App.tsx - useSocketEvents() NOT called here
function AppContent() {
  const { socket, isConnected } = useSocket()
  // No useSocketEvents() call!
  // ...
}

// GamePage.tsx - useSocketEvents() only called here
const GamePage: React.FC<GamePageProps> = ({ roomCodeFromUrl }) => {
  useSocketEvents() // ❌ Only active when GamePage is mounted!
  // ...
}
```

**The Issue:**
When Player2 tried to join a room:
1. Player2 was on `HomePage.tsx` (showing join form)
2. `GamePage.tsx` was NOT mounted yet
3. Therefore `useSocketEvents()` was NOT executed
4. Therefore event listeners for `room:joined` were NOT registered
5. Server emitted `room:joined` but no listener was active
6. Event was lost, client timed out

**AFTER (Fixed):**
```typescript
// App.tsx - useSocketEvents() called at root level
import { useSocketEvents } from './hooks/useSocketEvents'

function AppContent() {
  const { socket, isConnected } = useSocket()

  // Setup socket event listeners (must be active at all times)
  useSocketEvents() // ✅ Always active from app initialization

  // ...
}

// GamePage.tsx - useSocketEvents() removed (no longer needed)
const GamePage: React.FC<GamePageProps> = ({ roomCodeFromUrl }) => {
  // Socket event listeners are now set up in App.tsx (active at all times)
  // ...
}
```

### Files Modified

**`BingoBuddies/client/src/App.tsx`**:
- Line 6: Added `import { useSocketEvents } from './hooks/useSocketEvents'`
- Line 17: Added `useSocketEvents()` call in `AppContent` component
- Line 16: Added comment explaining the purpose

**`BingoBuddies/client/src/pages/GamePage.tsx`**:
- Line 31: Added comment: "Socket event listeners are now set up in App.tsx (active at all times)"
- Removed: `import { useSocketEvents } from '@/hooks/useSocketEvents'`
- Removed: `useSocketEvents()` call (was duplicate)

### Why This Fix Works

**Key Insight:** React component lifecycle determines when hooks execute.

- `App.tsx` → Always mounted (root component)
- `GamePage.tsx` → Only mounted when route is `/game/:roomCode`
- `HomePage.tsx` → Only mounted when route is `/`

**Before Fix:**
```
User Flow: Create room → Navigate to GamePage → useSocketEvents() runs
Player2 Flow: On HomePage → Try to join → NO LISTENERS YET → Event lost
```

**After Fix:**
```
App starts → AppContent mounts → useSocketEvents() runs → Listeners active
Player2: On HomePage → Try to join → Listeners ready → Event received ✅
```

### Impact on Future Migrations

**⚠️ CRITICAL LESSON for ALL React + Socket.IO games:**

This bug would affect ANY game where:
1. Socket event listeners are registered in a page component (not App.tsx)
2. Users can trigger socket events from different pages
3. Navigation/routing changes which components are mounted

**Checklist for Future Client Migrations:**

- [ ] Verify `useSocketEvents()` (or equivalent) is called in `App.tsx`, NOT in page components
- [ ] Test joining a room from a different tab/window
- [ ] Test the flow: Create room (Player1) → Join from different browser tab (Player2)
- [ ] Check that event listeners are active BEFORE emitting join events
- [ ] Don't assume server logs showing "emitted" means client received it

**Files to Check:**
- `client/src/App.tsx` - Should have `useSocketEvents()` call
- `client/src/pages/*.tsx` - Should NOT have duplicate `useSocketEvents()` calls
- `client/src/hooks/useSocketEvents.tsx` - Verify all event listeners are registered

### Testing Results After Fix

**Test Flow:**
1. Created room MGNY4D with Host1 (3x3 grid)
2. Opened new browser tab
3. Player2 entered room code MGNY4D
4. Player2 clicked "Join Room"

**Server Logs:**
```
[BINGO-BUDDIES] Player connected: tqBYz_EbgM8654kUAAAJ
[SessionManager] Created session for player [UUID] in room MGNY4D
[RoomManager] Added player Player2 to room MGNY4D
[BingoBuddies] Player Player2 joined room MGNY4D
[BingoBuddies] Sent room update to 2 players in room MGNY4D
```

**Client Logs (Player2):**
```
🔵 [Join] Emitting room:join event
🟢 [Join] room:join event emitted successfully
[handleRoomJoined] Received data: {room: Object, player: Object, sessionToken: ...}
[handleRoomJoined] Player: {id: ..., name: Player2, ...}
[handleRoomJoined] Room: MGNY4D
🟢 [Join] Store updated with room: MGNY4D
🎯 [Join] Navigating to room: MGNY4D
```

**Result:** ✅ Player2 successfully joined!

**Both players could now see:**
- Room code: MGNY4D
- Player list: Host1 (HOST 👑), Player2
- Player count: 2/8 players
- Start Game button enabled (needs 2+ players)

**Continued Testing:**
5. Host1 clicked "Start Game"
6. Both players transitioned to Input Phase
7. Both players saw 3x3 grid (9 textboxes)
8. Progress showed: 0/9 filled, 9 remaining
9. Room progress: 0/2 cards submitted

---

## Key Lessons for Future Migrations

1. **Always test multiplayer from different browser tabs/windows**
   - Don't just test single-player flow
   - Different tabs may be on different routes

2. **Event listeners must be in root component**
   - App.tsx for React apps
   - Not in page components that mount conditionally

3. **Server logs can be misleading**
   - "Event emitted" doesn't mean "Event received"
   - Always verify client-side reception

4. **React component lifecycle matters**
   - Hooks only run when component is mounted
   - Route changes affect which components are mounted

5. **Document critical bugs immediately**
   - This bug would affect many games
   - Clear documentation prevents repeating mistakes

---

**Migration Status:** ✅ Complete and Working
**User Tested:** ✅ Confirmed working by user


---

# Session 5: DDF Disconnection Logic Fix (2025-10-26)

## Summary
Fixed critical bugs in the DDF game's player disconnection handling. The disconnection flow now properly implements a 30-second grace period with countdown timer, removes disconnected players from all UI components, and advances game turns when the active player disconnects.

## ⚠️ CRITICAL: Player Disconnection Architecture

### The Problem
The unified server's disconnection logic had multiple critical bugs affecting multiplayer gameplay:

1. **Broken countdown timer** - Used wrong timestamp (`lastActivity` instead of `disconnectedAt`)
2. **Players not removed from UI** - Server removed players but didn't broadcast updates
3. **GM interface broke** - When active player disconnected, game state became invalid

**Impact**: Disconnected players would appear stuck in the game indefinitely, and if the active player disconnected, the entire game would freeze for the GM.

### The Solution: Multi-Layer Disconnection System

We implemented a complete disconnection flow with proper state management:

#### Layer 1: Core Player Tracking
**File**: `core/types/core.ts:13`

Added dedicated `disconnectedAt` timestamp to Player interface:

```typescript
export interface Player {
  socketId: string;
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  disconnectedAt?: number; // ✅ NEW: Timestamp when player disconnected (for grace period countdown)
  sessionToken?: string;
  joinedAt: number;
  lastActivity: number;
  gameData?: any;
}
```

**Why this matters**:
- `lastActivity` gets updated during normal gameplay (not suitable for countdown)
- `disconnectedAt` is set once when player disconnects and never changes
- Enables accurate 30-second countdown: `secondsLeft = 30 - Math.floor((Date.now() - disconnectedAt) / 1000)`

#### Layer 2: RoomManager Sets Timestamp
**File**: `core/managers/RoomManager.ts:233-236`

```typescript
markPlayerDisconnected(socketId: string): boolean {
  return this.updatePlayer(socketId, {
    connected: false,
    disconnectedAt: Date.now() // ✅ Set timestamp for grace period countdown
  });
}
```

**Flow**:
1. Player socket disconnects
2. `markPlayerDisconnected()` called
3. Sets `connected = false` and `disconnectedAt = Date.now()`
4. Player stays in `room.players` Map for 30 seconds

#### Layer 3: Serialization Sends Correct Data
**File**: `games/ddf/utils/serialization.ts:93`

```typescript
// Game-specific data
lives: playerData?.lives || 3,
isEliminated: playerData?.isEliminated || false,
isDisconnected: !p.connected,
disconnectedAt: p.disconnectedAt, // ✅ Use the actual disconnect timestamp (not lastActivity)
mediaState: playerData?.mediaState,
```

**Before (Broken)**:
```typescript
disconnectedAt: p.lastActivity, // ❌ Wrong! Changes during normal play
```

**After (Fixed)**:
```typescript
disconnectedAt: p.disconnectedAt, // ✅ Correct! Set once when disconnected
```

#### Layer 4: Broadcast Player Removal + Advance Turn
**File**: `games/ddf/plugin.ts:1468-1507`

```typescript
onPlayerLeave(room: Room, player: Player): void {
  console.log(`[DDF] Player ${player.name} removed from room ${room.code} after timeout`);

  const gameState = room.gameState.data as DDFGameState;

  // ✅ Check if the removed player was the current active player
  if (gameState.targetPlayerId === player.id) {
    console.log(`[DDF] Removed player was the active player, advancing to next player`);

    // Get remaining active players (excluding eliminated and the just-removed player)
    const activePlayers = Array.from(room.players.values()).filter(
      (p) => !(p.gameData as DDFPlayerData)?.isEliminated
    );

    if (activePlayers.length > 0) {
      // Advance to next player
      const currentIndex = gameState.currentPlayerIndex;
      const nextIndex = currentIndex % activePlayers.length;
      gameState.targetPlayerId = activePlayers[nextIndex].id;
      gameState.currentPlayerIndex = nextIndex;
      console.log(`[DDF] Advanced to next player: ${activePlayers[nextIndex].name} (index ${nextIndex})`);
    } else {
      // No active players left, clear target
      gameState.targetPlayerId = null;
      gameState.currentPlayerIndex = 0;
      console.log(`[DDF] No active players remaining`);
    }
  }

  // ✅ Broadcast updated game state to all remaining players
  const serialized = serializeRoomToDDF(room, ""); // Empty socketId for broadcast

  if (this.io) {
    const namespace = this.io.of("/ddf");
    namespace.to(room.code).emit("ddf:game-state-update", { room: serialized });
    console.log(`[DDF] Broadcast player removal for ${player.name} to room ${room.code}`);
  } else {
    console.error(`[DDF] Cannot broadcast player removal - io not initialized`);
  }
}
```

**Before (Broken)**:
```typescript
onPlayerLeave(room: Room, player: Player): void {
  console.log(`[DDF] Player ${player.name} removed from room ${room.code} after timeout`);
  // ❌ No broadcast, no turn advancement - GM interface breaks!
}
```

### Complete Disconnection Flow

**When player disconnects:**
```
1. Socket disconnect event
     ↓
2. core/server.ts:626 - markPlayerDisconnected()
     ↓
3. RoomManager sets: connected=false, disconnectedAt=Date.now()
     ↓
4. plugin.onPlayerDisconnected() - broadcasts state
     ↓
5. Client receives ddf:game-state-update
     ↓
6. Client UI shows:
   - Disconnected badge (orange)
   - WifiOff icon
   - "Removing in 30s...29s...28s..." countdown
     ↓
7. setTimeout(30000) starts in core/server.ts:641
```

**After 30 seconds:**
```
8. core/server.ts:644 - removePlayerFromRoom()
     ↓
9. Player removed from room.players Map
     ↓
10. plugin.onPlayerLeave() called
     ↓
11. Check if player was targetPlayerId
     ↓
12a. If YES: Advance to next active player
12b. If NO: Skip turn advancement
     ↓
13. Serialize room with updated player list
     ↓
14. Broadcast ddf:game-state-update
     ↓
15. Client receives update
     ↓
16. Client removes player from UI
     ↓
17. GM sees working interface (turn advanced if needed)
```

### Files Modified

**Core Server** (`core/types/core.ts`):
- Line 13: Added `disconnectedAt?: number` to Player interface

**RoomManager** (`core/managers/RoomManager.ts`):
- Lines 233-236: Updated `markPlayerDisconnected()` to set timestamp

**DDF Serialization** (`games/ddf/utils/serialization.ts`):
- Line 93: Fixed to use `p.disconnectedAt` instead of `p.lastActivity`

**DDF Plugin** (`games/ddf/plugin.ts`):
- Lines 1468-1507: Complete rewrite of `onPlayerLeave()` with turn advancement logic

### Testing Results

**Test Scenario 1: Non-Active Player Disconnects**
```
Setup: 4 players, Player3 is active, Player4 disconnects
Expected: Player4 shows disconnected, countdown 30s, then removed
Result: ✅ PASS - Player4 removed, Player3 still active, GM interface working
```

**Test Scenario 2: Active Player Disconnects**
```
Setup: 3 players, Player2 is active (answering question), Player2 disconnects
Expected: Player2 shows disconnected, countdown 30s, turn advances to Player3
Result: ✅ PASS - Turn advanced to Player3, GM sees new question, no interface break
```

**Test Scenario 3: Multiple Sequential Disconnects**
```
Setup: 4 players, Player2 (active) disconnects, then Player3 disconnects
Expected: Both show countdown, Player2 removed → advance to Player3, Player3 removed → advance to Player4
Result: ✅ PASS - Turns advanced correctly, GM interface never broke
```

**Test Scenario 4: Last Player Disconnects**
```
Setup: 2 players remaining, active player disconnects
Expected: Countdown, removal, game state cleared (no crash)
Result: ✅ PASS - targetPlayerId set to null, no errors
```

### Client-Side UI Components

The client already had all necessary UI logic in `PlayerList.tsx:100-163`:

```typescript
// Calculate countdown for disconnected players ONLY
const secondsLeft = isDisconnected && player.disconnectedAt
  ? Math.max(0, 30 - Math.floor((Date.now() - player.disconnectedAt) / 1000))
  : 0;

// Display countdown
{isDisconnected && (
  <div className="text-xs text-orange-400 mt-1">
    {secondsLeft > 0
      ? `${t('playerList.removingIn') || 'Removing in'} ${secondsLeft}s`
      : t('playerList.removing') || 'Removing...'
    }
  </div>
)}
```

**What we fixed**: The client code was perfect, but the server was sending the wrong timestamp. Once we fixed `disconnectedAt` on the server, the client countdown started working immediately.

### Key Lessons for Future Games

1. **Always use dedicated timestamps for time-sensitive features**
   - ❌ Don't use `lastActivity` for countdowns (it changes constantly)
   - ✅ Create dedicated fields like `disconnectedAt`, `startedAt`, etc.

2. **Always broadcast state changes after player removal**
   - ❌ Don't assume client will poll or detect changes
   - ✅ Emit `game-state-update` after any player list modification

3. **Always check if removed player was active/important**
   - ❌ Don't just remove without checking game state
   - ✅ Advance turns, reassign roles, clear references

4. **Always test edge cases**
   - Test active player disconnect
   - Test last player disconnect
   - Test multiple rapid disconnects
   - Test reconnection (if implemented)

### Impact on Other Games

**⚠️ ALL games in the unified server should implement this pattern:**

```typescript
// In plugin.ts
onPlayerLeave(room: Room, player: Player): void {
  const gameState = room.gameState.data as YourGameState;

  // 1. Check if player had important role (active player, dealer, etc.)
  if (gameState.importantPlayerId === player.id) {
    // 2. Reassign role to next player
    // 3. Update game state accordingly
  }

  // 4. Always broadcast updated state
  const serialized = serializeRoom(room, '');
  this.io.of(this.namespace).to(room.code).emit('game-state-update', { room: serialized });
}
```

**Games to update:**
- ✅ DDF - Fixed in this session
- ⚠️ SUSD - Check if needs similar fix
- ⚠️ ClueScale - Check if needs similar fix
- ⚠️ BingoBuddies - Check if needs similar fix

### Server Logs Pattern

**Successful disconnection flow:**
```
[DDF] Player 123 disconnected from room ABC123 - broadcasting state update
[DDF] Broadcast disconnect status for 123 to room ABC123
[DDF] Player disconnected: 123
[RoomManager] Removed player from room ABC123 (2 remaining)
[DDF] Player 123 removed from room ABC123 after timeout
[DDF] Removed player was the active player, advancing to next player
[DDF] Advanced to next player: Player2 (index 1)
[DDF] Broadcast player removal for 123 to room ABC123
```

### Debugging Disconnection Issues

**If countdown doesn't work:**
1. Check server logs for `disconnectedAt` being set
2. Check serialization sends `disconnectedAt` (not `lastActivity`)
3. Check client receives proper timestamp in `ddf:game-state-update`

**If player not removed after 30s:**
1. Check server logs for "Player X removed from room Y after timeout"
2. Check `onPlayerLeave()` broadcasts state update
3. Check client receives `ddf:game-state-update` with updated player list

**If GM interface breaks:**
1. Check if removed player was `targetPlayerId`
2. Check `onPlayerLeave()` advances turn when needed
3. Check `currentPlayerIndex` and `targetPlayerId` are valid after removal

---

## Commands Used

```bash
# Fix disconnectedAt field in Player interface
sed -i 's/connected: boolean;/connected: boolean;\n  disconnectedAt?: number; \/\/ Timestamp when player disconnected/' core/types/core.ts

# Fix RoomManager to set timestamp
sed -i 's/return this.updatePlayer(socketId, { connected: false });/return this.updatePlayer(socketId, {\n      connected: false,\n      disconnectedAt: Date.now()\n    });/' core/managers/RoomManager.ts

# Fix serialization
sed -i 's/disconnectedAt: p.lastActivity,/disconnectedAt: p.disconnectedAt, \/\/ Use actual disconnect timestamp/' games/ddf/utils/serialization.ts
```

### References

- Core Player type: `core/types/core.ts:7-17`
- RoomManager disconnect: `core/managers/RoomManager.ts:232-237`
- DDF serialization: `games/ddf/utils/serialization.ts:78-96`
- DDF disconnect hooks: `games/ddf/plugin.ts:1447-1507`
- Server disconnect handler: `core/server.ts:617-652`
- Client PlayerList UI: `ddf/client/src/components/PlayerList.tsx:100-163`
