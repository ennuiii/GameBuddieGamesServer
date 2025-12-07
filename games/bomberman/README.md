# Template Game Plugin

A minimal, well-documented game plugin template for GameBuddies.

## Quick Start

1. **Copy this folder** to create your new game:
   ```bash
   cp -r games/template games/your-game
   ```

2. **Update metadata** in `plugin.ts`:
   ```typescript
   id = 'your-game';
   name = 'Your Game Name';
   namespace = '/your-game';
   basePath = '/your-game';
   ```

3. **Define your types** in `types.ts`:
   - `GamePhase` - Your game's phases
   - `YourGameSettings` - Game-specific settings
   - `YourGameState` - Runtime game state
   - `YourPlayerData` - Per-player data

4. **Add socket handlers** in `plugin.ts`:
   ```typescript
   socketHandlers: Record<string, SocketEventHandler> = {
     'game:your-action': (socket, data, room, helpers) => {
       // Handle your game action
     },
   };
   ```

5. **Register your plugin** in the server config.

## File Structure

```
template/
├── plugin.ts    # Main plugin implementation
├── types.ts     # TypeScript type definitions
├── schemas.ts   # Zod validation schemas
└── README.md    # This file
```

## Key Concepts

### Lifecycle Hooks

| Hook | When Called | Use For |
|------|-------------|---------|
| `onInitialize` | Server starts | Store io reference |
| `onRoomCreate` | Room created | Initialize game state |
| `onPlayerJoin` | Player joins/reconnects | Setup player data |
| `onPlayerDisconnected` | Socket disconnects | Pause gameplay |
| `onPlayerLeave` | After 60s timeout | Remove player permanently |
| `onRoomDestroy` | Room deleted | Clear timers |

### Socket Event Pattern

```typescript
'event:name': (socket, data, room, helpers) => {
  // 1. Validate input
  const validated = validatePayload(schema, data);
  if (!validated) return;

  // 2. Find player
  const player = findPlayer(room, socket.id);
  if (!player) return;

  // 3. Update state
  const gameState = room.gameState.data as YourGameState;
  // ... modify state

  // 4. Broadcast update
  this.broadcastRoomState(room);
}
```

### State Serialization

The `serializeRoom()` method converts server state to client format:
- Called once per player (customize what each player sees)
- Must include `mySocketId` for client identification
- Map server phases to client state names

## Best Practices

1. **Use player.id for game logic** (not socketId - it changes on reconnect)
2. **Clear timers in onRoomDestroy** to prevent memory leaks
3. **Validate all input** with Zod schemas
4. **Use guard flags** for race-sensitive operations
5. **Broadcast state** after every mutation

## Example: Adding a New Action

```typescript
// 1. Add schema (schemas.ts)
export const submitAnswerSchema = z.object({
  answer: z.string().min(1).max(100),
});

// 2. Add handler (plugin.ts)
'game:submit-answer': (socket, data, room, helpers) => {
  const validated = validatePayload(submitAnswerSchema, data);
  if (!validated) return;

  const player = this.findPlayer(room, socket.id);
  if (!player) return;

  const playerData = player.gameData as YourPlayerData;
  playerData.currentAnswer = validated.answer;
  playerData.hasSubmitted = true;

  this.broadcastRoomState(room);
}
```

## Client Integration

Your client should:
1. Connect to `/{your-namespace}` socket namespace
2. Listen for `roomStateUpdated` events
3. Emit game events like `game:your-action`

See `GamebuddiesTemplate/client/` for a complete client template.
