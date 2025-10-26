# ClueScale Migration to Unified Game Server

## Overview
This document describes the architectural decisions and implementation details for migrating ClueScale from a standalone game server to the unified game server platform.

## Architecture Decision
**Date**: 2025-10-24
**Status**: Implemented

### Context
ClueScale was originally a standalone game with its own dedicated Express/Socket.io server. The game features:
- Role rotation (clue giver role rotates through players)
- Round-based gameplay with timers
- Real-time scoring and leaderboard
- Category-based clue system
- Settings customization (round duration, team bonus, categories)
- Mobile support with background/foreground detection
- GameBuddies platform integration

The goal was to migrate it to the unified server architecture to:
1. Reduce maintenance overhead
2. Share common infrastructure (lobby, chat, WebRTC, etc.)
3. Standardize game development patterns
4. Enable future games to be built faster using established patterns

### Decision
We migrated ClueScale using the **Direct Core Integration** pattern (like ClueScale original, different from SUSD's "Game Manager Wrapper" pattern).

**Key Architectural Choices**:
1. **Use Core Room Structure Directly**: Store ClueScale game state in `room.gameState.data` as `ClueGameState`
2. **Pure Logic GameManager**: GameManager.ts contains ONLY pure business logic functions - no Socket.io dependencies
3. **Plugin Handles All Socket Events**: plugin.ts orchestrates all socket handlers and calls GameManager functions
4. **Player Identity**: Use core Player.id (UUID) throughout, not socketId (which can change on reconnect)
5. **Lifecycle Hooks**: Implement all lifecycle hooks for proper integration with core server

### Consequences

**Positive**:
- Clean separation between game logic (GameManager) and communication layer (Plugin)
- Game logic is testable without Socket.io
- Automatic reconnection handling from core server
- Shared infrastructure for chat, video, room management
- Consistent logging patterns with `[ClueScale]` prefix
- Type-safe with proper TypeScript interfaces
- Timer management is centralized in game state

**Negative**:
- Need to map between socketId (connection) and player.id (identity)
- More boilerplate than standalone server (lifecycle hooks, type casting)
- Core server assumptions must be understood (player.id stability, room.players Map, etc.)

**Neutral**:
- Different pattern than SUSD (which wraps an entire GameManager class)
- Game-specific types must extend core types carefully

## Technical Design

### Component Structure

```
games/clue/
├── plugin.ts                 # Main plugin class, socket handlers, lifecycle hooks
├── game/
│   └── GameManager.ts        # Pure logic: round management, scoring, role rotation
├── types/
│   └── index.ts              # Type definitions extending core types
└── utils/
    └── scoring.ts            # Scoring calculations
```

### Data Flow

1. **Player Joins**:
   - Core server creates Player, adds to room.players Map
   - `onPlayerJoin` hook: Initialize player.gameData as CluePlayerData
   - Broadcast updated state to all players

2. **Game Start**:
   - `game:start` socket handler validates host and min players
   - Calls `startNewRound()` from GameManager
   - GameManager selects clue giver from role queue, generates round data
   - Timer starts for round duration
   - Events emitted to all players

3. **Clue Submission**:
   - `round:submit-clue` handler validates clue giver, validates clue word
   - Updates gameState.round.clueWord
   - Transitions phase to 'round_guess'
   - Restarts timer for guess phase
   - Broadcasts clue to all players

4. **Guess Submission**:
   - `round:submit-guess` handler validates guess (1-10)
   - Stores guess in gameState.round.guesses[]
   - Checks if all players have guessed
   - Auto-reveals results when all guesses are in

5. **Round Results**:
   - `revealRoundResults()` calculates scores using scoring.ts utils
   - Updates all player scores in player.gameData
   - Generates leaderboard sorted by score
   - Broadcasts results with leaderboard
   - Phase transitions to 'round_reveal'

6. **Next Round**:
   - Host clicks "Next Round"
   - `round:next` handler calls `startNewRound()`
   - Role queue rotates to next clue giver
   - Process repeats

### State Management

#### Room GameState
```typescript
room.gameState = {
  phase: 'lobby' | 'round_clue' | 'round_guess' | 'round_reveal',
  data: ClueGameState {
    round: Round | null,
    roundStartTime: number | null,
    roleQueue: string[],        // Player IDs in rotation order
    roundTimer?: NodeJS.Timeout // Active timer reference
  }
}
```

#### Player GameData
```typescript
player.gameData = CluePlayerData {
  score: number,
  isBackgrounded?: boolean
}
```

#### Settings
```typescript
room.settings.gameSpecific = ClueSettings {
  roundDuration: number,        // 30-180 seconds
  teamBonusEnabled: boolean,
  rotationType: 'circular',
  categories: string[]
}
```

### API/Interface

#### Socket Events (Client → Server)

- `game:start` - Start the game (host only)
- `round:submit-clue` - Submit clue word (clue giver only)
- `round:submit-guess` - Submit guess 1-10 (non-clue-givers only)
- `round:next` - Advance to next round (host only, from reveal phase)
- `round:skip-turn` - Skip current turn (host only)
- `settings:update` - Update game settings (host only, lobby only)
- `game:restart` - Restart game (host only)
- `player:kick` - Kick player (host only)

#### Socket Events (Server → Client)

- `round:start` - Round started with category, clue giver
- `round:giver-data` - Target number (sent only to clue giver)
- `round:clue-submitted` - Clue word revealed
- `round:guess-submitted` - Player submitted guess (name only)
- `round:reveal` - Results with scores, leaderboard
- `round:clue-timeout` - Clue giver ran out of time
- `round:turn-skipped` - Turn skipped by host
- `settings:updated` - Settings changed
- `game:restarted` - Game reset to lobby
- `player:kicked` - Player was kicked
- `error` - Error message

### Integration Pattern

**GameManager Functions** (pure logic):
```typescript
// Returns success/failure, modifies room in-place
export function startNewRound(room: Room, helpers: GameHelpers): boolean

// Modifies room in-place, sends events via helpers
export function revealRoundResults(room: Room, helpers: GameHelpers): void

export function handleClueTimeout(room: Room, helpers: GameHelpers): void

export function initializeGameState(): ClueGameState
export function initializePlayerData(): CluePlayerData

// Helper functions
export function getNextClueGiver(room: Room): { giverId: string, giverSocketId: string } | null
export function getRandomCategory(categories: string[]): string
export function getRandomTargetNumber(): number
```

**Plugin Responsibilities**:
- Validate socket events (permissions, phase checks)
- Extract current player from socket.id
- Call GameManager functions
- Handle errors and emit responses
- Manage lifecycle hooks

### Configuration

**Default Settings**:
- minPlayers: 3
- maxPlayers: 12
- roundDuration: 60 seconds (adjustable 30-180)
- teamBonusEnabled: true
- rotationType: 'circular'
- categories: 15 default categories (Size, Speed, Temperature, etc.)

**Customizable Per Room**:
- Round duration
- Team bonus on/off
- Category list

## Dependencies

### Internal Dependencies
- Core server types: Room, Player, GameHelpers, GamePlugin
- Core server lifecycle: onRoomCreate, onPlayerJoin, onPlayerLeave
- Core server helpers: sendToRoom, sendToPlayer, getRoomByCode, removePlayerFromRoom

### External Packages
- socket.io (via core server)
- crypto (for randomUUID in old server, not needed in unified)

### Cross-Component Interactions
- Chat: Uses core server chat system
- WebRTC: Uses core server WebRTC infrastructure
- GameBuddies: Uses core server GameBuddies integration

## Migration Notes

### From Standalone Server to Unified Server

**Key Changes**:
1. **Player Identity**: Old server used `socketId` everywhere. New server uses `player.id` (UUID) which persists across reconnections.
2. **Room Structure**: Old server had `Lobby` type with `players: Player[]`. New server has core `Room` with `players: Map<socketId, Player>`.
3. **State Storage**: Old server stored everything in `lobbies` Map. New server uses `room.gameState.data` and `player.gameData`.
4. **Event Emission**: Old server used `io.to(roomCode).emit()`. New server uses `helpers.sendToRoom()`.
5. **Settings**: Old server had flat Settings. New server has `room.settings.gameSpecific`.

**Migration Checklist**:
- [x] Convert player lookups from array to Map with socketId → find by socketId → use player.id
- [x] Change all event emissions to use helpers
- [x] Move game state into room.gameState.data
- [x] Move player data into player.gameData
- [x] Implement lifecycle hooks
- [x] Update timer cleanup to use onPlayerLeave
- [x] Remove direct io usage, use helpers instead
- [x] Update role queue to use player.id not socketId

### Player Lookup Pattern

**Old (Standalone)**:
```typescript
const player = lobby.players.find(p => p.socketId === socket.id);
```

**New (Unified)**:
```typescript
const player = Array.from(room.players.values()).find(p => p.socketId === socket.id);
// Then use player.id for game logic, not player.socketId
```

### Role Queue Management

**Critical**: Role queue must use player.id (UUID) not socketId:
```typescript
// Initialize with player IDs
gameState.roleQueue = connectedPlayers.map(p => p.id);

// Find player by ID to get their current socketId
const giverPlayer = Array.from(room.players.values()).find(p => p.id === giverId);
helpers.sendToPlayer(giverPlayer.socketId, 'round:giver-data', data);
```

## Examples

### Basic Usage - Starting a Game

```typescript
// Client emits
socket.emit('game:start', { roomCode: 'ABC123' });

// Server handler (in plugin.ts)
'game:start': async (socket, data, room, helpers) => {
  // Validate host
  const currentPlayer = Array.from(room.players.values())
    .find(p => p.socketId === socket.id);
  if (!currentPlayer?.isHost) {
    socket.emit('error', { message: 'Only host can start game' });
    return;
  }

  // Call GameManager
  const success = startNewRound(room, helpers);
  // GameManager handles all the logic and emits events
}
```

### Advanced Usage - Round Completion

```typescript
// GameManager.ts - Pure logic
export function revealRoundResults(room: Room, helpers: GameHelpers): void {
  const gameState = room.gameState.data as ClueGameState;
  const settings = room.settings.gameSpecific as ClueSettings;

  // Clear timer
  if (gameState.roundTimer) {
    clearTimeout(gameState.roundTimer);
    gameState.roundTimer = undefined;
  }

  // Score the round
  const { scoredGuesses, clueGiverPoints, teamBonus } =
    scoreRound(gameState.round, settings.teamBonusEnabled);

  // Update player scores
  scoredGuesses.forEach(guess => {
    const player = Array.from(room.players.values())
      .find(p => p.id === guess.playerId);
    if (player) {
      const playerData = player.gameData as CluePlayerData;
      playerData.score += guess.points;
    }
  });

  // Generate leaderboard
  const leaderboard = Array.from(room.players.values())
    .sort((a, b) => {
      const aData = a.gameData as CluePlayerData;
      const bData = b.gameData as CluePlayerData;
      return bData.score - aData.score;
    })
    .map((p, index) => ({
      rank: index + 1,
      name: p.name,
      score: (p.gameData as CluePlayerData).score,
      playerId: p.id
    }));

  // Emit results
  helpers.sendToRoom(room.code, 'round:reveal', {
    roundIndex: gameState.round.index,
    targetNumber: gameState.round.targetNumber,
    clueWord: gameState.round.clueWord,
    guesses: scoredGuesses,
    clueGiverPoints,
    teamBonus,
    leaderboard
  });

  room.gameState.phase = 'round_reveal';
}
```

## Testing Strategy

### Unit Testing (GameManager)
- Test `getNextClueGiver()` with various player counts
- Test `getRandomCategory()` and `getRandomTargetNumber()`
- Test score calculations via scoring.ts
- Test role queue rotation
- Mock Room and helpers, no Socket.io needed

### Integration Testing (Plugin)
- Test full game flow: lobby → start → clue → guess → reveal → next
- Test reconnection handling
- Test timer cleanup on player leave
- Test host-only actions
- Test validation (guess range, clue format)

### Manual Testing
- Multi-player game with 3+ players
- Mobile background/foreground transitions
- Player disconnection and reconnection
- Host migration (if host leaves)
- Settings changes in lobby
- Game restart

## Performance Considerations

### Timers
- Only one active timer per room (stored in gameState.roundTimer)
- Always clear timer before setting new one
- Clear timer in onPlayerLeave if clue giver leaves
- Clear timer in onGameEnd for cleanup

### Memory Management
- No global state in plugin (all state in room)
- Timers are properly cleaned up
- No memory leaks from event listeners (handled by core server)

### Scalability
- Each room is independent
- No cross-room dependencies
- Role queue is O(n) for player count
- Leaderboard sort is O(n log n) per reveal

### Bottlenecks
- Timer accuracy limited by Node.js setTimeout (not suitable for <1s precision)
- Broadcasting large leaderboards to many players (mitigated by small player count)

## Security Considerations

### Authentication
- Host-only actions validated in every handler
- Player identity validated via room.players lookup
- No trust of client-provided player IDs

### Data Validation
- Clue word: trim, single word check, no numbers
- Guess: must be integer 1-10
- Settings: clamped to valid ranges (30-180s, etc.)

### Threat Model
- **Cheating**: Clue giver sees target number (sent only to their socket)
- **Griefing**: Host can kick players (by design)
- **DoS**: Rate limiting handled by core server
- **Injection**: Input sanitization on all text inputs

### Known Limitations
- No encryption on clue data (rely on TLS)
- Host has full control (could be abused)
- No replay protection (out of scope for party game)

## Future Enhancements

### Planned Improvements
1. **Statistics Tracking**: Track player stats across games (wins, avg score, etc.)
2. **Custom Categories**: Allow players to create custom category lists
3. **Achievements**: Award badges for perfect guesses, win streaks, etc.
4. **Game Modes**: Add variations (hard mode with smaller guess window, team vs team)
5. **Spectator Mode**: Allow players to watch without participating
6. **AI Players**: Bot players for single-player practice

### Known Limitations
1. **Random Rotation Only**: Current rotationType always uses 'circular', 'random' not implemented
2. **No Number Picker**: Old game had a "number picker" role, now clue giver picks (target is random)
3. **No Vote Kicking**: Only host can kick, no democratic vote
4. **No Pause**: Game cannot be paused mid-round
5. **No Undo**: Cannot undo guess submission

## Related Decisions
- [001-room-mechanism.md](001-room-mechanism.md) - Core room structure
- [002-susd-migration.md](002-susd-migration.md) - SUSD migration (different pattern)
- [gamebuddies-integration.md](../components/gamebuddies-integration.md) - GameBuddies platform integration

## References
- Original ClueScale server: `E:\GamebuddiesPlatform\ClueScale\server\server.ts`
- Unified server core: `E:\GamebuddiesPlatform\unified-game-server\core\`
- SUSD migration (comparison): `E:\GamebuddiesPlatform\unified-game-server\games\susd\`
