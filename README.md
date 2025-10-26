# Unified Game Server

A consolidated server that hosts multiple GameBuddies games as plugins with shared infrastructure.

## Architecture

```
unified-game-server/
├── core/                          # Shared infrastructure (~1,500 lines)
│   ├── server.ts                  # Main server
│   ├── managers/
│   │   ├── RoomManager.ts         # Room management
│   │   ├── SessionManager.ts      # Player reconnection
│   │   └── GameRegistry.ts        # Plugin loading
│   ├── services/
│   │   ├── GameBuddiesService.ts  # Platform integration
│   │   └── ValidationService.ts   # Input validation
│   └── types/
│       └── core.ts                # Type definitions
│
├── games/                         # Game plugins
│   ├── susd/
│   ├── bingo-buddies/
│   ├── clue-scale/
│   ├── ddf/
│   └── school-quiz/
│
├── config/
│   └── games.json                 # Game configuration
│
└── package.json
```

## Quick Start

### Installation

```bash
npm install
```

### Configuration

Create `.env` file:

```bash
# Server
PORT=3001
NODE_ENV=development

# GameBuddies Platform
GAMEBUDDIES_CENTRAL_URL=https://gamebuddies.io

# API Keys (one per game)
BINGO_API_KEY=your_api_key
CLUE_API_KEY=your_api_key
DDF_API_KEY=your_api_key
SUSD_API_KEY=your_api_key
QUIZ_API_KEY=your_api_key

# CORS Origins
CORS_ORIGINS=http://localhost:5173,https://gamebuddies.io
```

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## Game Plugins

### Plugin Structure

Each game implements the `GamePlugin` interface:

```typescript
export const MyGame: GamePlugin = {
  // Metadata
  id: 'my-game',
  name: 'My Game',
  version: '1.0.0',

  // Routing
  namespace: '/mygame',
  basePath: '/mygame',

  // Configuration
  defaultSettings: {
    minPlayers: 2,
    maxPlayers: 8,
  },

  // Socket event handlers (game-specific only)
  socketHandlers: {
    'game:start': handleGameStart,
    'game:action': handleAction,
  },

  // Lifecycle hooks (optional)
  onRoomCreate: (room) => {
    // Initialize game state
  },
  onPlayerJoin: (room, player) => {
    // Handle player join
  },
};
```

### Common Events (Handled by Server)

These events are automatically handled:
- `room:create` - Create new room
- `room:join` - Join existing room
- `room:leave` - Leave room
- `chat:message` - Send chat message

### Game-Specific Events

Games register custom handlers in `socketHandlers`:

```typescript
socketHandlers: {
  'game:start': (socket, data, room, helpers) => {
    // Start game logic
    room.gameState.phase = 'playing';
    helpers.sendToRoom(room.code, 'game:started', {});
  },
  'game:action': (socket, data, room, helpers) => {
    // Handle game action
  },
}
```

### Helper Functions

Game handlers receive `GameHelpers`:

```typescript
{
  sendToRoom: (roomCode, event, data) => void,
  sendToPlayer: (socketId, event, data) => void,
  updatePlayerStatus: (roomCode, playerId, status, data) => Promise<void>,
  getRoomByCode: (code) => Room | undefined,
  removePlayerFromRoom: (roomCode, socketId) => void,
}
```

## API Endpoints

### Health Check
```
GET /health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-10-22T...",
  "uptime": 1234.56,
  "games": ["susd", "bingo-buddies", ...]
}
```

### Global Stats
```
GET /api/stats
```

Response:
```json
{
  "server": { "uptime": 1234, "memory": {...} },
  "rooms": { "totalRooms": 5, "totalPlayers": 23, ... },
  "sessions": { "totalSessions": 20, ... },
  "games": { "totalGames": 5, ... }
}
```

### Game-Specific Stats
```
GET /api/stats/:gameId
```

Response:
```json
{
  "game": { "id": "bingo-buddies", "name": "Bingo Buddies", ... },
  "rooms": {
    "total": 3,
    "players": 12,
    "details": [...]
  }
}
```

## Client Integration

### Connecting to a Game

```typescript
// Connect to specific game namespace
const socket = io('https://server.com/bingo');

// Create room
socket.emit('room:create', {
  playerName: 'Alice',
  settings: { maxPlayers: 8 }
});

socket.on('room:created', ({ room, sessionToken }) => {
  // Store session token for reconnection
  localStorage.setItem('sessionToken', sessionToken);
});

// Join room
socket.emit('room:join', {
  roomCode: 'ABC123',
  playerName: 'Bob',
  sessionToken: localStorage.getItem('sessionToken'), // Optional
});

// Game-specific events
socket.emit('game:start', {});
socket.on('game:started', (data) => {
  // Handle game start
});
```

### Reconnection

The server supports automatic reconnection with session tokens:

1. Player joins → receives `sessionToken`
2. Client stores token in localStorage
3. Player disconnects → has 30 seconds to reconnect
4. On reconnect, provide token in `room:join`
5. Server restores player state

## Deployment

### Render.com

1. Create new Web Service
2. Connect to GitHub repository
3. Set build command: `npm install && npm run build`
4. Set start command: `npm start`
5. Add environment variables from `.env.example`
6. Deploy

### Environment Variables

Required:
- `PORT` (default: 3001)
- `GAMEBUDDIES_CENTRAL_URL`

Optional:
- API keys for each game
- `CORS_ORIGINS`
- `NODE_ENV`

## Development

### Adding a New Game

1. Create `games/your-game/` directory
2. Implement `GamePlugin` interface
3. Register in `core/server.ts`:
```typescript
import { YourGame } from '../games/your-game/plugin.js';
await server.registerGame(YourGame);
```
4. Update client to connect to new namespace

### Testing

```bash
# Start server
npm run dev

# In another terminal, test with a client
cd ../your-game/client
npm run dev
```

## Architecture Decisions

### Why Namespaces?
- Isolates game events (no collisions)
- Easy client routing
- Per-game middleware possible
- Independent scaling

### Why Shared Managers?
- Eliminates code duplication (85%)
- Consistent behavior across games
- Centralized monitoring
- Easier debugging

### Why Plugin Pattern?
- Games are small (300-4,000 lines)
- No complex inter-service communication
- Cost-effective
- Simple deployment

## Cost Savings

**Before**: 5 servers × $7/month = $35/month
**After**: 1 server × $7/month = $7/month
**Savings**: 80% ($28/month)

## Maintenance

### Updating Core Infrastructure

Bug fixes in core benefit all games:
- Security updates
- Performance improvements
- New features

### Adding Game Features

Each game can be updated independently without affecting others.

## License

ISC
