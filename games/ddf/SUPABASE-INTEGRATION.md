# DDF Supabase Integration

## Overview

The DDF plugin now includes **Supabase READ capability**, enabling:
- Database-backed question storage
- Optional persistent game state logging
- Event tracking for analytics
- Graceful fallback to local JSON if Supabase unavailable

**Zero additional configuration needed** - the plugin automatically detects Supabase credentials and uses them if available.

## Architecture

### Component: SupabaseService

**Location**: `games/ddf/services/supabaseService.ts` (270 lines)

A singleton service that handles all Supabase operations:

```typescript
export class SupabaseService {
  // Initialize Supabase client if credentials provided
  constructor()

  // Check availability
  isSupabaseAvailable(): boolean

  // READ Operations
  getQuestions(): Promise<any[]>
  getQuestionsByCategory(category: string): Promise<any[]>
  getCategories(): Promise<string[]>

  // WRITE Operations (ready for implementation)
  saveGameState(roomCode, gameState, playerId): Promise<boolean>
  loadGameState(roomCode): Promise<any | null>
  logEvent(roomCode, playerId, eventType, eventData): Promise<boolean>
  markQuestionAsBad(questionId): Promise<boolean>
}
```

**Key Design Decision**: Graceful initialization
- If Supabase credentials missing → `isSupabaseAvailable() = false`
- No errors thrown, no server crash
- Plugin logs status clearly
- All operations return empty/false gracefully

### Integration Points

#### 1. Plugin Initialization

**File**: `games/ddf/plugin.ts:61-73`

```typescript
async onInitialize(io: any): Promise<void> {
  this.io = io;
  this.gameManager.setIO(io);

  // Log Supabase availability
  if (supabaseService.isSupabaseAvailable()) {
    console.log('[DDF Plugin] ✅ Supabase integration enabled');
  } else {
    console.log('[DDF Plugin] ℹ️ Using local JSON storage for questions');
  }

  console.log('[DDF Plugin] Initialized');
}
```

Logs during startup:
- With Supabase: `[DDF Plugin] ✅ Supabase integration enabled`
- Without Supabase: `[DDF Plugin] ℹ️ Using local JSON storage for questions`

#### 2. Question Fetching

**File**: `games/ddf/plugin.ts:835-857`

HTTP GET endpoint with automatic fallback:

```typescript
handler: async (req: any, res: any) => {
  let questions: any[] = [];

  // Try Supabase first if available
  if (supabaseService.isSupabaseAvailable()) {
    console.log('[DDF] Fetching questions from Supabase...');
    questions = await supabaseService.getQuestions();
  }

  // Fall back to local JSON if Supabase failed or empty
  if (questions.length === 0) {
    console.log('[DDF] Fetching questions from local JSON...');
    questions = this.questionManager.getAllQuestions();
  }

  res.json(questions);
}
```

**Behavior**:
1. If Supabase available → fetch from database
2. If Supabase fetch returns 0 questions → fall back to JSON
3. If Supabase unavailable → skip to JSON
4. Always return questions (never returns empty)

#### 3. Question Management

**File**: `games/ddf/plugin.ts:382-402`

Mark question as bad in both places:

```typescript
'ddf:mark-question-bad': async (socket: Socket, data: any, room: Room, helpers: GameHelpers) => {
  try {
    const { questionId } = data;
    const result = this.questionManager.markQuestionAsBad(questionId, true);

    // Also mark in Supabase if available
    if (supabaseService.isSupabaseAvailable()) {
      await supabaseService.markQuestionAsBad(questionId);
    }

    if (result) {
      helpers.sendToRoom(room.code, 'ddf:question-marked-bad', {
        questionId,
        badMarkCount: result.badMarkCount,
      });
    }
  } catch (error) {
    console.error('[DDF] Error in ddf:mark-question-bad:', error);
    socket.emit('error', { message: 'Failed to mark question' });
  }
}
```

**Behavior**: Updates both local JSON and Supabase (if available)

## Configuration

### Environment Variables

Add to `.env`:

```bash
# Supabase credentials (optional)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

**Notes**:
- Both variables must be set to enable Supabase
- If either is missing → falls back to local JSON
- `SUPABASE_ANON_KEY` not required (using service role key)

### Verification

Check logs after starting server:

**With Supabase configured**:
```
[Supabase] ✅ Connected to Supabase
[DDF Plugin] ✅ Supabase integration enabled
```

**Without Supabase configured**:
```
[Supabase] ℹ️ Supabase credentials not provided - using local storage
[DDF Plugin] ℹ️ Using local JSON storage for questions
```

## Supabase Table Schema

### Required Tables for READ Operations

#### `questions` table
```sql
CREATE TABLE questions (
  id UUID PRIMARY KEY,
  question_text TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT,
  difficulty TEXT,
  is_bad BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);
```

### Optional Tables for WRITE Operations (Future)

#### `ddf_game_states` table
```sql
CREATE TABLE ddf_game_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL,
  game_state JSONB NOT NULL,
  saved_by TEXT,
  created_at TIMESTAMP DEFAULT now()
);
```

#### `ddf_events` table
```sql
CREATE TABLE ddf_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_code TEXT NOT NULL,
  player_id TEXT,
  event_type TEXT NOT NULL,
  event_data JSONB,
  created_at TIMESTAMP DEFAULT now()
);
```

## Testing

### Test Without Supabase (Local JSON)

1. Start server without Supabase credentials:
   ```bash
   npm run dev
   ```

2. Check logs:
   ```
   [Supabase] ℹ️ Supabase credentials not provided - using local storage
   [DDF Plugin] ℹ️ Using local JSON storage for questions
   ```

3. Test question loading:
   ```bash
   curl http://localhost:3001/api/ddf/questions
   ```

4. Should return questions from `games/ddf/data/questions.json`

### Test With Supabase (Database)

1. Configure `.env`:
   ```bash
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=your_key
   ```

2. Start server:
   ```bash
   npm run dev
   ```

3. Check logs:
   ```
   [Supabase] ✅ Connected to Supabase
   [DDF Plugin] ✅ Supabase integration enabled
   ```

4. Test question loading:
   ```bash
   curl http://localhost:3001/api/ddf/questions
   ```

5. Should return questions from Supabase `questions` table

### Test Fallback Behavior

1. Configure Supabase but leave `questions` table empty
2. Start server - should log:
   ```
   [DDF] Fetching questions from Supabase...
   [DDF] Fetching questions from local JSON...
   ```
3. Should return questions from local JSON

## Implementation Status

### ✅ Implemented

- [x] SupabaseService class with full READ operations
- [x] Plugin initialization with Supabase detection
- [x] GET questions endpoint with Supabase + fallback
- [x] Mark question as bad in Supabase
- [x] Error handling and graceful degradation
- [x] Logging for debugging
- [x] Type definitions for Supabase responses

### 🔄 Ready for Implementation

- [ ] Save game state to Supabase
- [ ] Load game state on reconnection
- [ ] Log game events for analytics
- [ ] Fetch categories from Supabase

### 📋 Infrastructure in Place

The following methods are **already implemented** in SupabaseService, ready to use:

```typescript
// Game state persistence
async saveGameState(roomCode, gameState, playerId)
async loadGameState(roomCode)

// Event logging
async logEvent(roomCode, playerId, eventType, eventData)

// Category management
async getCategories()
async getQuestionsByCategory(category)
```

## Error Handling

### Graceful Degradation

- If Supabase connection fails → falls back to local JSON
- If Supabase returns 0 results → uses local JSON
- If Supabase is unavailable → skips directly to JSON
- No server crashes, no user impact

### Logging

All operations log status:

```typescript
console.log('[Supabase] ✅ Connected to Supabase');
console.log('[DDF] Fetching questions from Supabase...');
console.log('[DDF] Fetching questions from local JSON...');
console.error('[Supabase] Error fetching questions:', error);
```

## Performance Considerations

### Caching (Future Enhancement)

For production, consider caching:
```typescript
// Pseudo-code
private questionCache: any[] = [];
private cacheExpiry: Date;

async getQuestions() {
  if (this.isCacheValid()) {
    return this.questionCache;
  }
  // Fetch from Supabase
  // Cache result
}
```

### Network Timeout (Future Enhancement)

Add timeout protection:
```typescript
async getQuestionsWithTimeout(timeout = 5000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    // Fetch with timeout
  } finally {
    clearTimeout(timeoutId);
  }
}
```

## Next Steps

### For Testing
1. Leave Supabase unconfigured (current setup)
2. Test with local JSON questions
3. Verify plugin loads and questions load correctly

### For Production
1. Configure `.env` with Supabase credentials
2. Create `questions` table in Supabase
3. Populate questions in database
4. Plugin automatically uses Supabase

### For Future Enhancement
1. Enable game state persistence (methods ready)
2. Add event logging (methods ready)
3. Implement caching for performance
4. Add timeout protection

## References

- **SupabaseService**: `games/ddf/services/supabaseService.ts`
- **Plugin Integration**: `games/ddf/plugin.ts` (lines 15, 66-69, 835-857, 382-402)
- **Configuration**: `.env` example in `unified-game-server/.env.example`
- **Documentation**: `games/ddf/DATABASE-SETUP.md`

## Support

For issues with Supabase integration:

1. **Check logs** for `[Supabase]` and `[DDF]` messages
2. **Verify credentials** in `.env`
3. **Check table schema** matches expected columns
4. **Test fallback** by removing Supabase credentials - local JSON should work

For questions about the original SupabaseService:
- Reference implementation: `DDF/DDF/server/src/services/supabaseService.js`
