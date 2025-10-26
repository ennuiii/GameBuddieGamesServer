# BingoBuddies Migration to Unified Server - Notes

## Date: 2025-10-24

## Summary
Successfully created the BingoBuddies game plugin for the unified server. The plugin follows the Direct Integration pattern (like ClueScale) and handles all game-specific logic.

---

## Server-Side Changes Completed

### 1. Plugin Structure Created
- ✅ **Directory**: `unified-game-server/games/bingo/`
- ✅ **Types**: `types/index.ts` - Defines BingoGameState, BingoSettings, BingoPlayerData, BingoCard
- ✅ **Plugin**: `plugin.ts` - Implements GamePlugin interface with all lifecycle hooks
- ✅ **Registration**: Added to `core/server.ts` imports and loadGamePlugins()

### 2. Game State Mapping
**Server Storage:**
```typescript
room.gameState.phase = 'lobby' | 'input' | 'review' | 'playing' | 'finished'
room.gameState.data = BingoGameState {
  bingoCards: BingoCard[]
  currentDrawnItems: string[]
  winners: string[]
  startedAt?: number
  inputPhaseClosedAt?: number
}
room.settings.gameSpecific = BingoSettings {
  cardSize: 2 | 3 | 4 | 5
  allowSpectators: boolean
  autoStart: boolean
}
player.gameData = BingoPlayerData {
  isSpectator?: boolean
  lastActivity?: number
}
```

### 3. Serialization Function
Created `serializeRoomToClient()` that transforms:
- `room.players` Map → Array
- Adds `mySocketId` field for client
- Flattens settings structure
- Maps server phases to client GamePhase enum

### 4. Socket Event Handlers Implemented
**Game-specific events (in `/bingo` namespace):**
- ✅ `bingo:setup-game` - Two-step room creation (setup game data)
- ✅ `bingo:start-game` - Move to INPUT phase
- ✅ `bingo:reset-game` - Reset to lobby
- ✅ `bingo:submit-card` - Submit/update bingo card
- ✅ `bingo:close-input` - Host closes input phase
- ✅ `bingo:start-playing` - Move to PLAYING phase
- ✅ `bingo:mark-item` - Mark item on card
- ✅ `bingo:update-settings` - Update game settings

**Core events (handled by unified server):**
- `room:create` - Create base room
- `room:join` - Join existing room
- `room:leave` - Leave room
- `chat:message` - Send/receive chat messages
- `player:kick` - Kick player (host only)

---

## Client-Side Changes Needed

### 1. Socket Connection ✅ DONE
**File**: `client/src/hooks/useSocket.tsx`
- ✅ Updated to connect to `/bingo` namespace
- ✅ Added `transports: ['websocket', 'polling']`

### 2. Room Creation - TWO-STEP PROCESS REQUIRED
**File**: `client/src/pages/HomePage.tsx`

**Current code:**
```typescript
socket.emit('createRoom', {
  playerName: playerName,
  settings: { maxPlayers, cardSize }
}, callback)
```

**Need to update to:**
```typescript
// Step 1: Create core room
socket.emit('room:create', {
  playerName: playerName,
  gameId: 'bingo-buddies',
  settings: {
    minPlayers: 2,
    maxPlayers: maxPlayers
  }
})

// Step 2: Listen for room:created and setup game
socket.on('room:created', ({ sessionToken, room }) => {
  localStorage.setItem('bingo-session-token', sessionToken)

  // Setup game-specific data
  socket.emit('bingo:setup-game', {
    settings: {
      cardSize: cardSize,
      allowSpectators: true,
      autoStart: false
    }
  })
})

// Step 3: Listen for game setup complete
socket.on('bingo:game-setup', ({ room }) => {
  setCurrentRoom(room)
  // ... navigate to game
})
```

### 3. Socket Event Names - NEED TO UPDATE EMITTERS

**Files to Update:**
- `client/src/pages/GamePage.tsx` - Game actions (start, reset, etc.)
- `client/src/components/LobbyView.tsx` - Start game, update settings
- `client/src/components/InputPhaseView.tsx` - Submit card, close input
- `client/src/components/ReviewPhaseView.tsx` - Start playing
- `client/src/components/PlayingPhaseView.tsx` - Mark items

**Event Name Mapping:**
| Old Event (Client emits) | New Event (Unified server) |
|--------------------------|----------------------------|
| `createRoom` | `room:create` + `bingo:setup-game` |
| `joinRoom` | `room:join` (no change) |
| `startGame` | `bingo:start-game` |
| `resetGame` | `bingo:reset-game` |
| `submitBingoCard` | `bingo:submit-card` |
| `closeInputPhase` | `bingo:close-input` |
| `startPlayingPhase` | `bingo:start-playing` |
| `markItem` | `bingo:mark-item` |
| `updateRoomSettings` | `bingo:update-settings` |
| `sendChatMessage` | `chat:message` |

### 4. Socket Event Listeners - MOSTLY OK, SOME ADDITIONS NEEDED

**File**: `client/src/hooks/useSocketEvents.tsx`

**Current listeners that should work:**
- ✅ `roomStateUpdated` - Plugin emits this
- ✅ `gamePhaseChanged` - Plugin emits this
- ✅ `bingoCardSubmitted` - Plugin emits this
- ✅ `bingoCardUpdated` - Plugin emits this
- ✅ `itemMarked` - Plugin emits this (check data structure)
- ✅ `winnerDeclared` - Plugin emits this (check data structure)
- ✅ `error` - Core and plugin emit this
- ✅ `gamebuddies:return-all` - Core emits this

**Need to add:**
- `room:created` - For two-step room creation
- `bingo:game-setup` - For game setup complete
- `player:joined` - Core server event (currently `playerJoined`)
- `player:left` - Core server event (currently `playerLeft`)

**May need to check core server event names** - the core might use the same names

### 5. Chat Integration - UPDATE REQUIRED

**File**: Find where `sendChatMessage` is called

**Current:**
```typescript
socket.emit('sendChatMessage', messageText, callback)
```

**Update to:**
```typescript
socket.emit('chat:message', { message: messageText })
```

**Listener** should already work (client listens for `chatMessage`, check if core emits this or `chat:message`)

---

## Testing Checklist

### Phase 1: Connection
- [ ] Client connects to unified server at localhost:3001/bingo
- [ ] Connection status shows "Connected"
- [ ] No console errors about namespace

### Phase 2: Room Creation
- [ ] Host can create room with two-step process
- [ ] Room code is generated and displayed
- [ ] Settings (cardSize) are applied correctly
- [ ] Session token is stored in localStorage

### Phase 3: Room Joining
- [ ] Second player can join using room code
- [ ] Player list updates for both players
- [ ] Host indicator shows correctly

### Phase 4: Game Flow - INPUT Phase
- [ ] Host can start game (move to INPUT)
- [ ] All players can submit bingo cards
- [ ] Cards are visible in REVIEW phase
- [ ] Auto-advance to REVIEW when all cards submitted

### Phase 5: Game Flow - REVIEW Phase
- [ ] Host can see all submitted cards
- [ ] Host can start PLAYING phase

### Phase 6: Game Flow - PLAYING Phase
- [ ] Players can mark items on their cards
- [ ] Mark events broadcast to all players
- [ ] Bingo detection works (row/column/diagonal)
- [ ] Winner declared correctly
- [ ] Game moves to FINISHED phase

### Phase 7: Game Reset
- [ ] Host can reset game to lobby
- [ ] All cards cleared
- [ ] Phase resets to LOBBY

### Phase 8: Chat
- [ ] Chat messages send successfully
- [ ] All players receive messages
- [ ] Player names show in chat

### Phase 9: Error Handling
- [ ] Invalid actions show error messages
- [ ] Network disconnect handled gracefully
- [ ] Reconnection works with session token

### Phase 10: GameBuddies Integration
- [ ] Room creation from GameBuddies works
- [ ] Return to GameBuddies button works
- [ ] Status updates sent to GameBuddies platform

---

## Known Issues / Notes

1. **Event Name Consistency**: Need to verify if core server uses `player:joined` or `playerJoined`. May need to update either client or confirm plugin event emissions.

2. **ItemMarked Data Structure**: Plugin emits `{ cardId, itemIndex, playerId }` - client expects this format. ✅ Confirmed matching.

3. **WinnerDeclared Data Structure**: Plugin emits `{ winners: string[], winningCards: BingoCard[] }` - client expects `(winners: string[], winningCards: BingoCard[])`. May need to adjust.

4. **Chat Event Names**: Core server might emit `chat:message` while client listens for `chatMessage`. Need to verify and update.

5. **Session Token**: Client stores as `bingo-session-token`, core server creates sessions. Should work but verify localStorage key.

6. **GameBuddies Return**: Plugin doesn't handle return-to-gamebuddies. This should be handled by core server's GameBuddies service.

---

## Next Steps

1. ✅ Create plugin (DONE)
2. ✅ Register plugin in core server (DONE)
3. ⏭️ Update client socket connection (DONE)
4. ⏭️ Update client room creation to two-step process
5. ⏭️ Update all client event emitters
6. ⏭️ Update/verify all client event listeners
7. ⏭️ Test basic room creation and joining
8. ⏭️ Test full game flow
9. ⏭️ Test GameBuddies integration
10. ⏭️ Document any issues and solutions

---

## File Changes Summary

### Server Files Created
1. `unified-game-server/games/bingo/types/index.ts` - Type definitions
2. `unified-game-server/games/bingo/plugin.ts` - Main plugin implementation
3. `unified-game-server/games/bingo/MIGRATION-NOTES.md` - This file

### Server Files Modified
1. `unified-game-server/core/server.ts`
   - Line 29: Added import for bingoPlugin
   - Lines 656-662: Added plugin registration

### Client Files Modified
1. `client/src/hooks/useSocket.tsx`
   - Updated to connect to `/bingo` namespace

### Client Files To Modify
1. `client/src/pages/HomePage.tsx` - Two-step room creation
2. `client/src/pages/GamePage.tsx` - Update event emitters
3. `client/src/components/LobbyView.tsx` - Update event emitters
4. `client/src/components/InputPhaseView.tsx` - Update event emitters
5. `client/src/components/ReviewPhaseView.tsx` - Update event emitters
6. `client/src/components/PlayingPhaseView.tsx` - Update event emitters
7. `client/src/hooks/useSocketEvents.tsx` - Add new listeners
8. `client/.env` - Add VITE_SERVER_URL=http://localhost:3001

---

## Comparison with ClueScale Migration

**Similarities:**
- Both use Direct Integration pattern
- Both require serialization function
- Both need two-step room creation
- Both store settings in `room.settings.gameSpecific`

**Differences:**
- BingoBuddies has simpler game mechanics (no rounds, roles, timers)
- BingoBuddies stores cards in game state, not player data
- BingoBuddies has more game phases (5 vs ClueScale's 4)
- BingoBuddies doesn't need timer cleanup (no timed rounds)

**Estimated Migration Complexity:** Medium (simpler than ClueScale due to no timers/roles)
