# GamebuddiesTemplate + Unified Server Integration Guide

This guide explains how to integrate the GamebuddiesTemplate with the GameBuddiesGameServer (unified server) instead of using the template's standalone server.

## Table of Contents
1. [Architecture Overview](#architecture-overview)
2. [Key Differences](#key-differences)
3. [Migration Steps](#migration-steps)
4. [Socket Event Mapping](#socket-event-mapping)
5. [Serialization Guide](#serialization-guide)
6. [Common Issues & Solutions](#common-issues--solutions)
7. [Testing Checklist](#testing-checklist)

---

## Architecture Overview

### Standalone Template Server (Current)
```
Client (React) → Socket.IO → Template Server (Express)
                                    ↓
                              Local Game Logic
                                    ↓
                              GameBuddies API
```

### Unified Game Server (Target)
```
Client (React) → Socket.IO → Unified Server → Game Plugin
                    ↓                              ↓
              Namespace: /game-name          Game Logic
                                                  ↓
                                            GameBuddies API
```

### Benefits of Unified Server

1. **Shared Infrastructure**
   - Chat system
   - WebRTC signaling
   - Session management
   - Reconnection logic
   - GameBuddies integration

2. **Centralized Management**
   - Single deployment
   - Unified monitoring
   - Consistent updates
   - Shared bug fixes

3. **Namespace Isolation**
   - Each game runs in its own namespace
   - No cross-game interference
   - Independent scaling

---

## Key Differences

| Feature | Template Server | Unified Server |
|---------|----------------|----------------|
| **Connection** | `io(SERVER_URL)` | `io(SERVER_URL + '/game-namespace')` |
| **Room Type** | `Lobby` interface | `Room` interface |
| **Players Storage** | `Player[]` array | `Map<string, Player>` |
| **Event Handlers** | Inline in server.ts | Plugin.socketHandlers object |
| **Room Management** | Direct Map manipulation | RoomManager API |
| **Session Tokens** | Custom implementation | SessionManager API |
| **Game Logic** | In server.ts | In plugin.ts |
| **Serialization** | Direct object passing | Must implement serializeRoom() |

---

## Migration Steps

### Step 1: Create Game Plugin

Create `GameBuddieGamesServer/games/your-game/plugin.ts`:

```typescript
import type { GamePlugin, Room, Player, SocketEventHandler, GameHelpers } from '../../core/types/core.js';
import type { Socket } from 'socket.io';

// Define your game-specific types
interface YourGameState {
  // Your game state fields
  currentRound: number;
  timeRemaining: number;
  // ... etc
}

interface YourPlayerData {
  // Your player-specific data
  score: number;
  isReady: boolean;
  // ... etc
}

class YourGamePlugin implements GamePlugin {
  id = 'your-game';
  name = 'Your Game Name';
  version = '1.0.0';
  namespace = '/your-game';
  basePath = '/your-game';

  defaultSettings = {
    minPlayers: 2,
    maxPlayers: 12,
    gameSpecific: {
      // Your game-specific settings
      roundDuration: 60,
      difficulty: 'medium'
    }
  };

  private io: any;

  async onInitialize(io: any): Promise<void> {
    this.io = io;
    console.log(`[${this.name}] Plugin initialized`);
  }

  onRoomCreate(room: Room): void {
    // Initialize game state
    room.gameState.data = {
      currentRound: 0,
      timeRemaining: 0
    } as YourGameState;
    room.gameState.phase = 'lobby';
  }

  onPlayerJoin(room: Room, player: Player, isReconnecting?: boolean): void {
    // Initialize player data
    player.gameData = {
      score: 0,
      isReady: false
    } as YourPlayerData;

    // Broadcast updated state
    this.broadcastRoomState(room);
  }

  onPlayerDisconnected(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} disconnected`);
    this.broadcastRoomState(room);
  }

  onPlayerLeave(room: Room, player: Player): void {
    console.log(`[${this.name}] Player ${player.name} left`);
    this.broadcastRoomState(room);
  }

  // CRITICAL: This function converts server Room to client format
  serializeRoom(room: Room, socketId: string): any {
    const gameState = room.gameState.data as YourGameState;

    return {
      // Core fields
      code: room.code,
      hostId: room.hostId,

      // Convert Map to Array for client
      players: Array.from(room.players.values()).map(p => ({
        socketId: p.socketId,
        name: p.name,
        score: (p.gameData as YourPlayerData)?.score || 0,
        isHost: p.isHost,
        connected: p.connected,
        disconnectedAt: p.disconnectedAt
      })),

      // Game state
      state: room.gameState.phase,
      gameData: gameState,

      // Settings
      settings: room.settings,

      // Messages
      messages: room.messages.slice(-100),

      // IMPORTANT: Client needs to know their socket ID
      mySocketId: socketId,

      // GameBuddies integration
      isGameBuddiesRoom: room.metadata?.isGameBuddiesRoom || false
    };
  }

  // Helper method to broadcast state to all players
  private broadcastRoomState(room: Room): void {
    if (!this.io) return;

    const namespace = this.io.of(this.namespace);
    room.players.forEach(player => {
      const serialized = this.serializeRoom(room, player.socketId);
      namespace.to(player.socketId).emit('roomStateUpdated', serialized);
    });
  }

  // Socket event handlers
  socketHandlers: Record<string, SocketEventHandler> = {
    'game:start': async (socket, data, room, helpers) => {
      try {
        // Validate host
        if (room.hostId !== Array.from(room.players.values()).find(p => p.socketId === socket.id)?.id) {
          socket.emit('error', { message: 'Only host can start the game' });
          return;
        }

        // Check minimum players
        const connectedPlayers = Array.from(room.players.values()).filter(p => p.connected);
        if (connectedPlayers.length < room.settings.minPlayers) {
          socket.emit('error', { message: `Need at least ${room.settings.minPlayers} players` });
          return;
        }

        // Update game state
        room.gameState.phase = 'playing';
        const gameState = room.gameState.data as YourGameState;
        gameState.currentRound = 1;
        gameState.timeRemaining = room.settings.gameSpecific.roundDuration;

        // Notify all players
        helpers.sendToRoom(room.code, 'gamePhaseChanged', 'playing');
        this.broadcastRoomState(room);

        console.log(`[${this.name}] Game started in room ${room.code}`);

      } catch (error) {
        console.error(`[${this.name}] Error starting game:`, error);
        socket.emit('error', { message: 'Failed to start game' });
      }
    },

    'game:submit-answer': async (socket, data, room, helpers) => {
      try {
        const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
        if (!player) return;

        const playerData = player.gameData as YourPlayerData;
        const gameState = room.gameState.data as YourGameState;

        // Process answer
        // Update scores, etc.
        playerData.score += 10;

        // Broadcast update
        this.broadcastRoomState(room);

        // Send feedback to player
        socket.emit('answer:result', { correct: true, score: playerData.score });

      } catch (error) {
        console.error(`[${this.name}] Error processing answer:`, error);
        socket.emit('error', { message: 'Failed to submit answer' });
      }
    },

    'game:end': async (socket, data, room, helpers) => {
      try {
        // Validate host
        if (room.hostId !== Array.from(room.players.values()).find(p => p.socketId === socket.id)?.id) {
          socket.emit('error', { message: 'Only host can end the game' });
          return;
        }

        // Update state
        room.gameState.phase = 'ended';

        // Calculate final scores
        const finalScores = Array.from(room.players.values())
          .map(p => ({
            name: p.name,
            score: (p.gameData as YourPlayerData)?.score || 0
          }))
          .sort((a, b) => b.score - a.score);

        // Notify all players
        helpers.sendToRoom(room.code, 'game:ended', { finalScores });
        this.broadcastRoomState(room);

        console.log(`[${this.name}] Game ended in room ${room.code}`);

      } catch (error) {
        console.error(`[${this.name}] Error ending game:`, error);
        socket.emit('error', { message: 'Failed to end game' });
      }
    }
  };
}

export default new YourGamePlugin();
```

### Step 2: Register Plugin with Server

Edit `GameBuddieGamesServer/core/server.ts`:

```typescript
// Add import
import yourGamePlugin from '../games/your-game/plugin.js';

// In constructor, register the plugin
constructor() {
  // ... existing code ...

  // Register your game
  this.gameRegistry.registerGame(yourGamePlugin);
}
```

### Step 3: Update Client Socket Connection

Edit `GamebuddiesTemplate/client/src/services/socketService.ts`:

```typescript
// CHANGE: Add namespace to connection
const NAMESPACE = '/your-game'; // Your game's namespace

class SocketService {
  private socket: Socket | null = null;

  connect(): Socket {
    if (this.socket?.connected) {
      return this.socket;
    }

    const SERVER_URL = getServerUrl();

    // CHANGE: Connect to namespace instead of root
    console.log('[Socket] Connecting to:', `${SERVER_URL}${NAMESPACE}`);

    this.socket = io(`${SERVER_URL}${NAMESPACE}`, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      transports: ['websocket', 'polling'],
    });

    // ... rest of connection logic

    return this.socket;
  }
}
```

### Step 4: Update Client Event Listeners

Edit `GamebuddiesTemplate/client/src/App.tsx`:

```typescript
// Update event names to match unified server

// CHANGE: lobby:created → room:created
socket.on('room:created', (data: { room: any; sessionToken: string }) => {
  console.log('[App] Room created:', data.room.code);
  setLobby(data.room);
  setSessionToken(data.sessionToken);
  sessionStorage.setItem('gameSessionToken', data.sessionToken);
});

// CHANGE: lobby:joined → room:joined
socket.on('room:joined', (data: { room: any; player: any; sessionToken: string }) => {
  console.log('[App] Joined room');
  setLobby(data.room);
  setSessionToken(data.sessionToken);
  sessionStorage.setItem('gameSessionToken', data.sessionToken);
});

// CHANGE: Multiple update events → single roomStateUpdated
socket.on('roomStateUpdated', (room: any) => {
  console.log('[App] Room state updated');
  setLobby(room);
  setMessages(room.messages || []);
});

// Remove these individual events (replaced by roomStateUpdated):
// - lobby:player-joined
// - lobby:player-left
// - lobby:player-disconnected
// - lobby:player-reconnected
// - lobby:settings-updated
```

---

## Socket Event Mapping

### Core Events (Handled by Unified Server)

| Template Event | Unified Event | Notes |
|---------------|--------------|-------|
| `lobby:create` | `room:create` | Request format same |
| `lobby:join` | `room:join` | Request format same |
| `session:reconnect` | `session:reconnect` | Handled by SessionManager |
| `chat:send-message` | `chat:message` | Handled by core |
| `webrtc:*` | `webrtc:*` | All WebRTC events unchanged |

### Response Events

| Template Event | Unified Event | Notes |
|---------------|--------------|-------|
| `lobby:created` | `room:created` | Includes sessionToken |
| `lobby:joined` | `room:joined` | Includes sessionToken |
| `lobby:player-joined` | `roomStateUpdated` | Full state update |
| `lobby:player-left` | `roomStateUpdated` | Full state update |
| `lobby:settings-updated` | `roomStateUpdated` | Full state update |
| `player:kicked` | `player:kicked` | Same format |
| `error` | `error` | Same format |

### Game-Specific Events

Define these in your plugin's `socketHandlers`:

```typescript
socketHandlers = {
  'game:start': async (socket, data, room, helpers) => { /* ... */ },
  'game:submit-answer': async (socket, data, room, helpers) => { /* ... */ },
  'game:end': async (socket, data, room, helpers) => { /* ... */ },
  // Add your custom events here
}
```

---

## Serialization Guide

### The Problem

The server uses different data structures than the client expects:

**Server Room:**
```typescript
interface Room {
  id: string;
  code: string;
  hostId: string;
  players: Map<string, Player>; // MAP!
  gameState: {
    phase: string;
    data: any;
  };
  // ... etc
}
```

**Client Expects:**
```typescript
interface Lobby {
  code: string;
  hostId: string;
  players: Player[]; // ARRAY!
  state: string;
  gameData: any;
  mySocketId: string; // Not in server!
  // ... etc
}
```

### The Solution

Always implement `serializeRoom()` to convert:

```typescript
serializeRoom(room: Room, socketId: string): any {
  return {
    // Direct mappings
    code: room.code,
    hostId: room.hostId,

    // CRITICAL: Convert Map to Array
    players: Array.from(room.players.values()).map(p => ({
      socketId: p.socketId,
      name: p.name,
      score: p.gameData?.score || 0,
      connected: p.connected,
      isHost: p.isHost
    })),

    // Rename/restructure fields
    state: room.gameState.phase,
    gameData: room.gameState.data,

    // Add client-only fields
    mySocketId: socketId, // CRITICAL: Client needs this!

    // Include messages
    messages: room.messages.slice(-100)
  };
}
```

### Common Serialization Patterns

#### Pattern 1: Player List with Game Data
```typescript
players: Array.from(room.players.values()).map(p => {
  const gameData = p.gameData as YourPlayerData;
  return {
    socketId: p.socketId,
    name: p.name,
    // Include game-specific data
    score: gameData?.score || 0,
    lives: gameData?.lives || 3,
    powerups: gameData?.powerups || [],
    // Include connection state
    connected: p.connected,
    isHost: p.isHost
  };
})
```

#### Pattern 2: Game State Mapping
```typescript
// Map internal state to client-friendly format
state: (() => {
  switch(room.gameState.phase) {
    case 'waiting': return 'LOBBY_WAITING';
    case 'playing': return 'PLAYING';
    case 'ended': return 'GAME_ENDED';
    default: return 'UNKNOWN';
  }
})()
```

#### Pattern 3: Filtered Data by Player
```typescript
// Different data for different players
serializeRoom(room: Room, socketId: string): any {
  const player = Array.from(room.players.values()).find(p => p.socketId === socketId);
  const isHost = player?.isHost || false;

  return {
    // ... common fields ...

    // Host-only data
    adminSettings: isHost ? room.settings.adminOnly : undefined,

    // Player-specific view
    myHand: player?.gameData?.hand || [],

    // Hide secret info from other players
    players: Array.from(room.players.values()).map(p => ({
      name: p.name,
      score: p.gameData?.score,
      // Don't send other players' hands
      cardCount: p.gameData?.hand?.length || 0
    }))
  };
}
```

---

## Common Issues & Solutions

### Issue 1: "Cannot read property 'players' of undefined"

**Cause:** Client expects array, server sends Map.

**Solution:** Always convert in serializeRoom:
```typescript
players: Array.from(room.players.values())
```

### Issue 2: "mySocketId is undefined"

**Cause:** Client needs to identify itself in player list.

**Solution:** Always include in serialization:
```typescript
mySocketId: socketId
```

### Issue 3: Events not reaching client

**Cause:** Client connected to wrong namespace or event name mismatch.

**Solution:**
1. Verify namespace in client connection
2. Check event names match exactly
3. Use namespace when emitting from plugin:
```typescript
const namespace = this.io.of(this.namespace);
namespace.to(room.code).emit('eventName', data);
```

### Issue 4: Reconnection not working

**Cause:** Session token not stored/retrieved correctly.

**Solution:**
```typescript
// Store on join
socket.on('room:joined', (data) => {
  sessionStorage.setItem('gameSessionToken', data.sessionToken);
});

// Attempt reconnect on connect
socket.on('connect', () => {
  const token = sessionStorage.getItem('gameSessionToken');
  if (token) {
    socket.emit('session:reconnect', { sessionToken: token });
  }
});
```

### Issue 5: WebRTC not working

**Cause:** WebRTC events not forwarded correctly.

**Solution:** Unified server handles WebRTC automatically. Ensure:
1. Client still sends webrtc:* events
2. No custom WebRTC handling in plugin
3. TURN servers configured in client

---

## Testing Checklist

### Basic Functionality
- [ ] Create room as host
- [ ] Join room as player
- [ ] See other players in list
- [ ] Chat messages work
- [ ] Start game (host only)
- [ ] Game-specific actions work
- [ ] End game (host only)

### Reconnection
- [ ] Refresh page → auto-reconnect
- [ ] Close tab → 30s countdown visible to others
- [ ] Reopen within 30s → reconnect successful
- [ ] Wait 31s → player removed

### Host Management
- [ ] Kick player (host only)
- [ ] Host leaves → next player becomes host
- [ ] Non-host cannot access host controls

### WebRTC (if using)
- [ ] Video/audio connects
- [ ] Multiple peers work
- [ ] Disconnect/reconnect maintains video

### GameBuddies Integration
- [ ] Launch from GameBuddies URL works
- [ ] Streamer mode (hidden room code) works
- [ ] Return to lobby button works
- [ ] Status updates sent to GameBuddies

### Error Handling
- [ ] Invalid room code → error message
- [ ] Room full → error message
- [ ] Network disconnect → reconnect attempt
- [ ] Server restart → client reconnects

---

## Deployment Considerations

### Environment Variables

**Unified Server:**
```env
PORT=3001
GAMEBUDDIES_API_KEY=your-key
GAME_IDS=your-game,other-game
```

**Client:**
```env
VITE_BACKEND_URL=https://your-unified-server.com
VITE_GAME_NAMESPACE=/your-game
```

### CORS Configuration

Unified server handles CORS for all games:

```typescript
// In unified server
const io = new Server(httpServer, {
  cors: {
    origin: [
      'http://localhost:5173',
      'https://your-game.com',
      'https://gamebuddies.io'
    ],
    credentials: true
  }
});
```

### Load Balancing

Unified server can handle multiple games:
- Each game in separate namespace
- Independent scaling per namespace
- Shared infrastructure reduces overhead

---

## Next Steps

1. **Create your game plugin** using the template above
2. **Test locally** with both servers running
3. **Migrate gradually** - run both servers during transition
4. **Deploy unified server** once stable
5. **Update client** to point to unified server
6. **Monitor and optimize** based on usage

For creating new games from scratch, see [CREATE-NEW-GAME-GUIDE.md](CREATE-NEW-GAME-GUIDE.md).