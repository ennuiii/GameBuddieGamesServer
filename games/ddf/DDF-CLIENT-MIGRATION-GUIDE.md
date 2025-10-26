# DDF Client Migration Guide

**Date:** 2025-10-24
**Target:** DDF/client/ directory
**Changes:** 13 files modified, 1 file created
**Complexity:** Medium (mostly find/replace for event names)
**Estimated Time:** 4-5 hours

---

## Table of Contents

1. [Overview](#overview)
2. [Files to Modify](#files-to-modify)
3. [Step-by-Step Instructions](#step-by-step-instructions)
4. [Event Name Mapping](#event-name-mapping)
5. [Testing After Migration](#testing-after-migration)
6. [Troubleshooting](#troubleshooting)

---

## Overview

### What's Changing

The DDF client needs to adapt to the unified game server architecture:

1. **Socket Connection** - Connect to `/ddf` namespace
2. **Room Creation** - Two-step process (core + game setup)
3. **Event Names** - Rename all game events to `ddf:*` prefix
4. **Core Events** - Use core events for room/player/chat/WebRTC

###

 What's NOT Changing

- **UI Components** - All React components stay the same
- **Game Logic** - Client-side logic unchanged
- **WebRTC Code** - Virtual backgrounds and video chat unchanged
- **GameBuddies Integration** - Session management unchanged
- **Store Structure** - Zustand store structure unchanged

### Migration Strategy

We'll use a **find-and-replace** approach for most changes:
- Find: `gm:start-game`
- Replace: `ddf:start-game`

Then test each feature to ensure it works.

---

## Files to Modify

### Configuration Files

| File | Changes | Priority |
|------|---------|----------|
| `.env` | Create new file | High |

### Service Files

| File | Changes | Priority |
|------|---------|----------|
| `src/services/socketService.ts` | Update namespace, event names | High |
| `src/stores/unifiedStore.ts` | Update all event emitters | High |

### Page Components

| File | Changes | Priority |
|------|---------|----------|
| `src/pages/HomePage.tsx` | Two-step room creation | High |
| `src/pages/LobbyPage.tsx` | Minor event updates | Medium |
| `src/pages/GamePage.tsx` | Verify routing works | Low |
| `src/pages/AdminPage.tsx` | Update API endpoint | Medium |

### UI Components (Event Emitters)

| File | Changes | Priority |
|------|---------|----------|
| `src/components/GamemasterInterface.tsx` | Update event names | High |
| `src/components/FluidGamemaster.tsx` | Update event names | High |
| `src/components/TurnBasedGamemaster.tsx` | Update event names | High |
| `src/components/FinaleEvaluationScreen.tsx` | Update finale events | High |
| `src/components/PlayerInterface.tsx` | Update voting events | Medium |
| `src/components/VotingResults.tsx` | Update event names | Medium |

### No Changes Needed

These files work as-is:
- `src/components/WebcamDisplay.tsx` - WebRTC handled by core
- `src/services/virtualBackgroundService.ts` - Client-side only
- `src/services/faceAvatarService.ts` - Client-side only
- `src/services/GameBuddiesIntegration.js` - Works as-is
- All other UI components that don't emit events

---

## Step-by-Step Instructions

### Step 1: Create Environment File (5 minutes)

**Create:** `DDF/client/.env`

```env
VITE_SERVER_URL=http://localhost:3001
```

**Why:**
- Separate server URL from namespace
- Easier to change for production

**Verify:**
```bash
# In DDF/client directory
cat .env
# Should show: VITE_SERVER_URL=http://localhost:3001
```

---

### Step 2: Update Socket Connection (15 minutes)

**File:** `src/services/socketService.ts`

**Changes:**

```typescript
// Line 8: Update backend URL and add namespace
// OLD:
const backendUrl = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
this.socket = io(backendUrl);

// NEW:
const backendUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
this.socket = io(backendUrl + '/ddf', {
  transports: ['websocket', 'polling']
});
```

**Why:**
- `/ddf` namespace separates DDF from other games
- Explicit transports for better compatibility

**Testing:**
```typescript
// Add temporary log to verify
console.log('Connecting to:', backendUrl + '/ddf');
```

---

### Step 3: Update Event Listeners in socketService.ts (30 minutes)

**File:** `src/services/socketService.ts`

**Find/Replace Table:**

| Line | Old Event | New Event | Notes |
|------|-----------|-----------|-------|
| 26 | `server:lobby-created` | Keep for now | Will handle with `ddf:game-setup` |
| 33 | `server:player-joined` | Keep for now | Will handle with `room:joined` |
| 65 | `server:lobby-update` | Keep for now | Will handle with `player:joined` |
| 78 | `server:game-state-update` | `ddf:game-state-update` | ✅ Change |
| 89 | `server:timer-update` | `ddf:timer-update` | ✅ Change |
| 105 | `server:start-voting` | `ddf:start-voting` | ✅ Change |
| 110 | `server:round-result` | `ddf:round-result` | ✅ Change |
| 115 | `server:error` | Keep | Core event |
| 120 | `server:question-marked-as-bad` | `ddf:question-marked-bad` | ✅ Change |
| 151 | `playerJoined` | Keep | GameBuddies event |
| 162 | `playerLeft` | Keep | GameBuddies event |
| 173 | `hostChanged` | Keep | GameBuddies event |
| 199 | `roomExpired` | Keep | GameBuddies event |
| 213 | `server:return-to-lobby` | `ddf:return-broadcast` | ✅ Change |

**Add New Listeners:**

```typescript
// After existing listeners, add these:

// Core room events
this.socket.on('room:created', (data) => {
  console.log('[SocketService] Room created, triggering game setup');
  const store = useUnifiedStore.getState();

  // Store room info
  store.setRoomCode(data.room.code);

  // Trigger step 2: game setup
  // This will be called from HomePage after room creation
});

this.socket.on('room:joined', (data) => {
  console.log('[SocketService] Player joined room:', data.room.code);
  const store = useUnifiedStore.getState();

  store.setRoomCode(data.room.code);
  store.setUserId(this.socket?.id || '');
  store.setUserRole('player');

  // Find player by socket ID
  const player = data.room.players.find((p: any) => p.id === this.socket?.id);
  if (player) {
    store.setUserName(player.name);
  }
});

this.socket.on('player:joined', (data) => {
  console.log('[SocketService] Player joined broadcast:', data.player.name);
  const store = useUnifiedStore.getState();

  // Update room with new player
  if (store.room) {
    store.setRoom({
      ...store.room,
      players: [...store.room.players, data.player]
    });
  }
});

this.socket.on('player:left', (data) => {
  console.log('[SocketService] Player left:', data.player.name);
  const store = useUnifiedStore.getState();

  // Update room by removing player
  if (store.room) {
    store.setRoom({
      ...store.room,
      players: store.room.players.filter(p => p.id !== data.player.id)
    });
  }
});

// DDF game setup event (step 2 of room creation)
this.socket.on('ddf:game-setup', (data) => {
  console.log('[SocketService] DDF game setup complete:', data.room.code);
  const store = useUnifiedStore.getState();

  store.setRoomCode(data.room.code);
  store.setRoom(data.room);
  store.setUserRole('gamemaster');
  store.setUserName(data.room.gamemaster.name);
});
```

**Why:**
- Core events handle room/player management
- `ddf:game-setup` completes two-step creation
- Player join/leave updates propagate correctly

---

### Step 4: Update Store Event Emitters (1 hour)

**File:** `src/stores/unifiedStore.ts`

**Method 1: createLobby (Two-Step Creation)**

```typescript
// Lines 274-308: Replace entire createLobby method
createLobby: (gmName: string, roomCode?: string) => {
  const { socket } = get();
  console.log('[unifiedStore] createLobby called with:', { gmName, roomCode });

  if (socket) {
    // Get GameBuddies playerId
    let playerId = null;
    try {
      if (window.GameBuddies && window.GameBuddies.getPlayerInfo) {
        const playerInfo = window.GameBuddies.getPlayerInfo();
        playerId = playerInfo.playerId;
        console.log('[unifiedStore] Got playerId from GameBuddies:', playerId);
      }
    } catch (e) {
      console.warn('[unifiedStore] GameBuddies service not available:', e);
    }

    // Store pending settings for step 2
    const pendingSettings = {
      roundDuration: 120,
      shotClockEnabled: false,
      shotClockDuration: 30,
    };

    sessionStorage.setItem('ddf_pending_settings', JSON.stringify(pendingSettings));
    sessionStorage.setItem('ddf_pending_gm_name', gmName);

    // Step 1: Create core room
    console.log('[unifiedStore] Emitting room:create');
    socket.emit('room:create', {
      playerName: gmName,
      settings: {
        minPlayers: 2,
        maxPlayers: 20,
        gameSpecific: pendingSettings
      },
      roomCode: roomCode || undefined,
      playerId: playerId || undefined,
    });

    // Step 2 will be triggered by room:created event
    // See HomePage.tsx for implementation
  }
},
```

**Method 2-25: Update All Other Emitters**

Find/Replace in unifiedStore.ts:

| Method | Line | Old Emit | New Emit |
|--------|------|----------|----------|
| `startGame` | 406 | `gm:start-game` | `ddf:start-game` |
| `startNextTurn` | 422 | `client:start-next-turn` | `ddf:start-next-turn` |
| `assignQuestion` | 429 | `gm:assign-question` | `ddf:assign-question` |
| `rateAnswer` | 436 | `client:rate-answer` | `ddf:rate-answer` |
| `skipQuestion` | 457 | `client:skip-question` | `ddf:skip-question` |
| `editPlayerLives` | 464 | `client:edit-lives` | `ddf:edit-lives` |
| `controlTimer` | 471 | `client:control-timer` | `ddf:control-timer` |
| `submitVote` | 478 | `player:submit-vote` | `ddf:submit-vote` |
| `skipVote` | 487 | `player:skip-vote` | `ddf:skip-vote` |
| `endVoting` | 496 | `gm:end-voting` | `ddf:end-voting` |
| `gmCloseVotingResultsAndAdvance` | 514 | `client:close-voting-results-for-all` | `ddf:close-results-for-all` |
| `gmCloseVotingResultsAndAdvance` | 518 | `gm:close-voting-results` | `ddf:close-voting-results` |
| `breakTie` | 541 | `gm:break-tie` | `ddf:break-tie` |
| `startNewGame` | 548 | `gm:start-new-game` | `ddf:start-new-game` |
| `updateSelectedCategories` | 557 | `gm:update-categories` | `ddf:update-categories` |
| `submitFinaleAnswer` | 573 | `player:submit-finale-answer` | `ddf:submit-finale-answer` |
| `evaluateFinaleAnswers` | 584 | `gm:evaluate-finale-answers` | `ddf:evaluate-finale` |
| `evaluateAllFinaleAnswers` | 592 | `gm:evaluate-all-finale-answers` | `ddf:evaluate-all-finale` |
| `evaluateSingleFinaleQuestion` | 600 | `gm:evaluate-single-finale-question` | `ddf:evaluate-single-finale` |
| `startNextFinaleQuestion` | 608 | `gm:next-finale-question` | `ddf:next-finale-question` |
| `sendGameUpdate` | 615 | `gm:game-update` | `ddf:game-update` |
| `toggleShowQuestionsToPlayers` | 622 | `gm:toggle-show-questions` | `ddf:toggle-show-questions` |
| `gmSkipVoting` | 629 | `gm:skip-voting` | `ddf:skip-voting` |
| `markQuestionAsBad` | 665 | `gm:mark-question-as-bad` | `ddf:mark-question-bad` |
| `skipQuestionKeepPlayer` | 672 | `gm:skip-question-keep-player` | `ddf:skip-question-keep-player` |

**Quick Replace:**
```bash
# In unifiedStore.ts, find and replace:
gm:start-game → ddf:start-game
client:start-next-turn → ddf:start-next-turn
gm:assign-question → ddf:assign-question
client:rate-answer → ddf:rate-answer
client:skip-question → ddf:skip-question
client:edit-lives → ddf:edit-lives
client:control-timer → ddf:control-timer
player:submit-vote → ddf:submit-vote
player:skip-vote → ddf:skip-vote
gm:end-voting → ddf:end-voting
client:close-voting-results-for-all → ddf:close-results-for-all
gm:close-voting-results → ddf:close-voting-results
gm:break-tie → ddf:break-tie
gm:start-new-game → ddf:start-new-game
gm:update-categories → ddf:update-categories
player:submit-finale-answer → ddf:submit-finale-answer
gm:evaluate-finale-answers → ddf:evaluate-finale
gm:evaluate-all-finale-answers → ddf:evaluate-all-finale
gm:evaluate-single-finale-question → ddf:evaluate-single-finale
gm:next-finale-question → ddf:next-finale-question
gm:game-update → ddf:game-update
gm:toggle-show-questions → ddf:toggle-show-questions
gm:skip-voting → ddf:skip-voting
gm:mark-question-as-bad → ddf:mark-question-bad
gm:skip-question-keep-player → ddf:skip-question-keep-player
```

---

### Step 5: Update HomePage.tsx (30 minutes)

**File:** `src/pages/HomePage.tsx`

**Add Listener for room:created:**

```typescript
// Around line 108, after useEffect for GameBuddies session
useEffect(() => {
  const { socket } = useUnifiedStore.getState();
  if (!socket) return;

  // Handle step 2 of room creation
  const handleRoomCreated = (data: any) => {
    console.log('[HomePage] room:created received:', data.room.code);

    // Retrieve pending settings
    const settingsStr = sessionStorage.getItem('ddf_pending_settings');
    const settings = settingsStr ? JSON.parse(settingsStr) : {};

    // Step 2: Setup DDF game
    console.log('[HomePage] Emitting ddf:setup-game');
    socket.emit('ddf:setup-game', { settings });

    // Clean up
    sessionStorage.removeItem('ddf_pending_settings');
    sessionStorage.removeItem('ddf_pending_gm_name');
  };

  socket.on('room:created', handleRoomCreated);

  return () => {
    socket.off('room:created', handleRoomCreated);
  };
}, []);
```

**Why:**
- Completes two-step room creation
- Uses session storage for pending settings
- Cleans up after setup

---

### Step 6: Update Component Event Emitters (1-2 hours)

These components emit game events and need event name updates:

#### GamemasterInterface.tsx

**Search for:** All `socket.emit()` calls

**Replace:**
- Any `gm:*` or `client:*` events → `ddf:*` equivalent
- Use mapping table from Step 4

**Example:**
```typescript
// OLD:
socket.emit('gm:start-game', { roomCode, soloMode });

// NEW:
socket.emit('ddf:start-game', { roomCode, soloMode });
```

#### FluidGamemaster.tsx

Same approach as GamemasterInterface.tsx

#### TurnBasedGamemaster.tsx

Same approach as GamemasterInterface.tsx

#### FinaleEvaluationScreen.tsx

**Focus on finale events:**
- `gm:evaluate-single-finale-question` → `ddf:evaluate-single-finale`
- `gm:evaluate-all-finale-answers` → `ddf:evaluate-all-finale`
- `gm:next-finale-question` → `ddf:next-finale-question`
- `gm:finale-scroll-sync` → `ddf:finale-scroll-sync`

#### PlayerInterface.tsx

**Focus on voting events:**
- `player:submit-vote` → `ddf:submit-vote`
- `player:skip-vote` → `ddf:skip-vote`

#### VotingResults.tsx

**Check for:**
- Any direct socket emits (unlikely)
- May call store methods instead (already updated)

---

### Step 7: Update Admin Panel API Endpoint (15 minutes)

**File:** `src/pages/AdminPage.tsx`

**Find:** API fetch calls

**Update Base URL:**
```typescript
// OLD:
const response = await fetch('/api/questions');

// NEW:
const baseUrl = import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';
const response = await fetch(`${baseUrl}/api/ddf/questions`);
```

**Why:**
- Questions API now under `/api/ddf/` path
- Need explicit base URL in client

**Apply to all fetch calls:**
- GET `/api/questions` → `/api/ddf/questions`
- POST `/api/questions` → `/api/ddf/questions`
- PUT `/api/questions/:id` → `/api/ddf/questions/:id`
- DELETE `/api/questions/:id` → `/api/ddf/questions/:id`
- POST `/api/questions/bulk` → `/api/ddf/questions/bulk`
- etc.

---

## Event Name Mapping

### Complete Reference Table

| Category | Old Event | New Event | Direction |
|----------|-----------|-----------|-----------|
| **Room Management** | | | |
| | `gm:create-lobby` | `room:create` + `ddf:setup-game` | C→S |
| | `player:join-lobby` | `room:join` | C→S |
| | `server:lobby-created` | `room:created` + `ddf:game-setup` | S→C |
| | `server:player-joined` | `room:joined` | S→C |
| | `server:lobby-update` | `player:joined`, `player:left` | S→C |
| **Game Control** | | | |
| | `gm:start-game` | `ddf:start-game` | C→S |
| | `client:start-next-turn` | `ddf:start-next-turn` | C→S |
| | `gm:assign-question` | `ddf:assign-question` | C→S |
| | `gm:start-new-game` | `ddf:start-new-game` | C→S |
| **Questions** | | | |
| | `client:rate-answer` | `ddf:rate-answer` | C→S |
| | `client:skip-question` | `ddf:skip-question` | C→S |
| | `gm:skip-question-keep-player` | `ddf:skip-question-keep-player` | C→S |
| | `gm:mark-question-as-bad` | `ddf:mark-question-bad` | C→S |
| | `gm:update-categories` | `ddf:update-categories` | C→S |
| | `server:question-marked-as-bad` | `ddf:question-marked-bad` | S→C |
| **Timer** | | | |
| | `client:control-timer` | `ddf:control-timer` | C→S |
| | `server:timer-update` | `ddf:timer-update` | S→C |
| **Voting** | | | |
| | `player:submit-vote` | `ddf:submit-vote` | C→S |
| | `player:skip-vote` | `ddf:skip-vote` | C→S |
| | `gm:end-voting` | `ddf:end-voting` | C→S |
| | `gm:skip-voting` | `ddf:skip-voting` | C→S |
| | `gm:toggle-show-questions` | `ddf:toggle-show-questions` | C→S |
| | `gm:close-voting-results` | `ddf:close-voting-results` | C→S |
| | `client:close-voting-results-for-all` | `ddf:close-results-for-all` | C→S |
| | `gm:break-tie` | `ddf:break-tie` | C→S |
| | `server:start-voting` | `ddf:start-voting` | S→C |
| | `server:round-result` | `ddf:round-result` | S→C |
| **Finale** | | | |
| | `player:submit-finale-answer` | `ddf:submit-finale-answer` | C→S |
| | `gm:evaluate-single-finale-question` | `ddf:evaluate-single-finale` | C→S |
| | `gm:evaluate-all-finale-answers` | `ddf:evaluate-all-finale` | C→S |
| | `gm:evaluate-finale-answers` | `ddf:evaluate-finale` | C→S |
| | `gm:next-finale-question` | `ddf:next-finale-question` | C→S |
| | `gm:finale-scroll-sync` | `ddf:finale-scroll-sync` | C→S |
| | `server:all-finale-answers-ready` | `ddf:all-finale-answers-ready` | S→C |
| | `server:finale-single-evaluation-update` | `ddf:finale-evaluation` | S→C |
| | `server:finale-all-evaluations-complete` | `ddf:finale-complete` | S→C |
| | `server:finale-scroll-sync` | `ddf:scroll-sync-broadcast` | S→C |
| **Player Management** | | | |
| | `client:edit-lives` | `ddf:edit-lives` | C→S |
| | `player:update-media-state` | `ddf:update-media-state` | C→S |
| **GameBuddies** | | | |
| | `gm:return-to-lobby` | `ddf:return-to-lobby` | C→S |
| | `server:return-to-lobby` | `ddf:return-broadcast` | S→C |
| | `gm:game-update` | `ddf:game-update` | C→S |
| **State Updates** | | | |
| | `server:game-state-update` | `ddf:game-state-update` | S→C |
| **Core (Unchanged)** | | | |
| | `server:error` | `server:error` | S→C |
| | All `webrtc:*` | All `webrtc:*` | Both |
| | All `chat:*` | All `chat:*` | Both |
| | `playerJoined` (GB) | `playerJoined` | S→C |
| | `playerLeft` (GB) | `playerLeft` | S→C |
| | `hostChanged` (GB) | `hostChanged` | S→C |
| | `roomExpired` (GB) | `roomExpired` | S→C |

---

## Testing After Migration

### Quick Smoke Test (10 minutes)

1. **Start servers:**
   ```bash
   # Terminal 1: Unified server
   cd E:\GamebuddiesPlatform\unified-game-server
   npm run dev

   # Terminal 2: DDF client
   cd E:\GamebuddiesPlatform\DDF\client
   npm run dev
   ```

2. **Test connection:**
   - Open http://localhost:5173
   - Check browser console for connection logs
   - Should see: "Connected to server"
   - Should NOT see connection errors

3. **Test room creation:**
   - Enter GM name
   - Click "Create Game"
   - Should navigate to lobby
   - Check console for two-step process:
     - "Emitting room:create"
     - "room:created received"
     - "Emitting ddf:setup-game"
     - "DDF game setup complete"

4. **Test player join:**
   - Open new tab/window
   - Navigate to http://localhost:5173
   - Enter player name and room code
   - Click "Join Game"
   - Should join successfully
   - Both tabs should see updated player list

### Comprehensive Test (30 minutes)

Follow the testing checklist in DDF-MIGRATION-PLAN.md:
- Game flow (all phases)
- Question assignment
- Voting
- Finale mode
- Admin panel
- WebRTC
- GameBuddies integration

---

## Troubleshooting

### Issue: Client Can't Connect

**Symptoms:**
- "Disconnected from server" in console
- Connection errors in browser network tab

**Solutions:**
1. Verify unified server is running
2. Check namespace: should be `/ddf`
3. Verify server URL in .env
4. Check CORS settings on server

**Debug:**
```typescript
// In socketService.ts
console.log('Connecting to:', backendUrl + '/ddf');
console.log('Socket state:', this.socket?.connected);
```

### Issue: Room Creation Fails

**Symptoms:**
- "Create Game" button does nothing
- Room not created in server logs

**Solutions:**
1. Check if `room:create` event is emitted
2. Check if server receives event
3. Verify pending settings in sessionStorage
4. Check for console errors

**Debug:**
```typescript
// In unifiedStore.ts createLobby
console.log('About to emit room:create with:', {
  playerName: gmName,
  roomCode,
  playerId
});
```

### Issue: Events Not Received

**Symptoms:**
- Client emits event, nothing happens
- Server doesn't respond

**Solutions:**
1. Verify event name spelling (exact match required)
2. Check if listener is registered
3. Verify namespace matches
4. Check server logs for handler execution

**Debug:**
```typescript
// Add debug listener
socket.onAny((event, ...args) => {
  console.log('Received event:', event, args);
});
```

### Issue: Two-Step Creation Incomplete

**Symptoms:**
- Room created but game not initialized
- GM name or settings missing

**Solutions:**
1. Check if `room:created` listener exists
2. Verify `ddf:setup-game` is emitted
3. Check sessionStorage for pending data
4. Check server plugin `ddf:setup-game` handler

**Debug:**
```typescript
// In room:created listener
console.log('Pending settings:', sessionStorage.getItem('ddf_pending_settings'));
console.log('About to emit ddf:setup-game');
```

### Issue: Admin Panel API Errors

**Symptoms:**
- 404 errors when loading questions
- Can't add/edit/delete questions

**Solutions:**
1. Check API base URL in AdminPage.tsx
2. Verify endpoint path: `/api/ddf/questions`
3. Check if question API routes registered in plugin
4. Verify CORS allows API requests

**Debug:**
```typescript
// In AdminPage.tsx
console.log('Fetching from:', `${baseUrl}/api/ddf/questions`);
```

### Issue: WebRTC Not Working

**Symptoms:**
- Video doesn't start
- Can't see other players' video

**Solutions:**
1. WebRTC uses core - no client changes needed
2. Verify WebRTC events still use `webrtc:` prefix
3. Check browser permissions (camera/mic)
4. Verify unified server WebRTC handlers active

**Debug:**
- WebRTC should work exactly as before
- No migration changes needed for WebRTC
- Check core server logs for WebRTC events

---

## Validation Checklist

After completing all changes:

### Files Checked
- [ ] `.env` created with correct server URL
- [ ] `socketService.ts` updated (namespace + 8 event names)
- [ ] `unifiedStore.ts` updated (24 event emitters)
- [ ] `HomePage.tsx` updated (two-step creation)
- [ ] `AdminPage.tsx` updated (API endpoints)
- [ ] `GamemasterInterface.tsx` updated (event names)
- [ ] `FluidGamemaster.tsx` updated (event names)
- [ ] `TurnBasedGamemaster.tsx` updated (event names)
- [ ] `FinaleEvaluationScreen.tsx` updated (finale events)
- [ ] `PlayerInterface.tsx` updated (voting events)
- [ ] `VotingResults.tsx` checked (may not need changes)

### Functionality Tested
- [ ] Socket connection works
- [ ] Room creation (two-step) works
- [ ] Player join works
- [ ] Player list updates
- [ ] Game start works
- [ ] Question assignment works
- [ ] Voting works
- [ ] Finale mode works
- [ ] Admin panel works
- [ ] WebRTC works
- [ ] GameBuddies integration works (if applicable)

### No Regressions
- [ ] All existing features still work
- [ ] No console errors
- [ ] No memory leaks
- [ ] Performance is acceptable

---

## Summary

**Total Changes:**
- 1 file created (.env)
- 11 files modified (services, store, pages, components)
- ~50 event name changes
- 1 two-step creation implementation
- ~100 lines of code changed

**Time Estimate:**
- Configuration: 15 min
- Socket service: 45 min
- Store updates: 1 hour
- Component updates: 1-2 hours
- Testing: 30 min
- Debugging: 30 min - 1 hour
- **Total: 4-5 hours**

**Key Success Factors:**
1. Update namespace first
2. Test connection before event changes
3. Use find/replace for bulk changes
4. Test each feature after updating
5. Keep original code commented until verified

---

**Next:** After completing client migration, proceed to comprehensive testing using the checklist in DDF-MIGRATION-PLAN.md.

**Last Updated:** 2025-10-24
**Status:** Ready for Implementation
