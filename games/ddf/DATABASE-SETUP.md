# DDF Game - Database & External Integration Setup

## Current Implementation Status

The DDF game plugin has been successfully migrated to the unified server with **hybrid storage and optional Supabase integration**:

### ✅ What Works Out-of-the-Box (No Configuration Needed)

1. **In-Memory Game State**
   - Game rooms and active games stored in RAM
   - Fast gameplay with no I/O latency
   - Lost on server restart (fine for sessions)
   - Perfect for local testing and development

2. **File-Based Questions (with Supabase Fallback)**
   - Default: Questions stored in `games/ddf/data/questions.json`
   - QuestionManager provides full CRUD operations
   - Questions persist across server restarts
   - Admin panel can add/edit/delete/manage questions
   - **NEW**: If Supabase credentials provided, reads questions from database first

3. **Optional Supabase Question Storage**
   - When `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set, plugin automatically uses Supabase
   - Questions are fetched from Supabase `questions` table
   - Falls back to local JSON if Supabase unavailable or empty
   - Graceful degradation - works perfectly without Supabase credentials

4. **GameBuddies Integration (Optional)**
   - Platform integration enabled without API key
   - Set `DDF_API_KEY` in `.env` to enable player status updates
   - Works fine without key for local testing

## 🚀 Optional: Supabase Integration (For Production)

The DDF plugin **already has built-in Supabase READ capability**. Configure Supabase to use database-backed questions and persistent game features:

### Environment Variables

Add to `.env`:
```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

Note: `SUPABASE_ANON_KEY` is optional (plugin uses service role key for admin operations)

### What Supabase READ Capability Enables (Already Implemented ✅)

1. **Database-Backed Questions**
   - Questions read from Supabase `questions` table
   - Automatic fallback to local JSON if Supabase unavailable
   - Zero downtime - graceful degradation
   - Admin operations sync to database:
     - Mark questions as bad → Updates `is_bad` flag in Supabase
     - Fetch questions → Tries Supabase first, falls back to JSON

2. **Question Categories**
   - Fetch unique categories from Supabase
   - Maintain centralized category list
   - Admin panel shows database categories

3. **Event Logging (Infrastructure Ready)**
   - Log game events to Supabase for analytics
   - Ready for implementation - infrastructure in place

### What Supabase WRITE Capability Would Enable (Future)

When write operations are added:

1. **Persistent Game History**
   - Store completed games
   - Player statistics and win/loss records
   - Game analytics and metrics

2. **Game State Persistence**
   - Save game states for recovery
   - Support reconnection with full state recovery
   - Game resumption after server crash

3. **Player Profiles & Tracking**
   - Player statistics across games
   - Win/loss records
   - Achievement tracking

### Implementation Status

#### ✅ Already Implemented

1. **SupabaseService Created** (`games/ddf/services/supabaseService.ts`)
   - Graceful initialization (no crash if credentials missing)
   - Methods for reading questions, marking as bad, logging events
   - Fallback to local JSON automatically

2. **Plugin Integrated with SupabaseService** (`games/ddf/plugin.ts`)
   - Auto-detects Supabase availability on initialization
   - GET `/api/ddf/questions` route uses Supabase if available
   - Question marking updates both local and Supabase
   - Clean error handling - no server crashes

3. **Environment Configuration**
   - `.env` supports `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
   - Optional credentials - tested and working without them
   - Documentation in DATABASE-SETUP.md

#### 🔄 To Complete Supabase WRITE Capability (Future)

1. **Add Game State Persistence**
   ```typescript
   // In socket handlers, call:
   await supabaseService.saveGameState(room.code, gameState, playerId);

   // On reconnection, call:
   const savedState = await supabaseService.loadGameState(room.code);
   ```

2. **Add Event Logging** (infrastructure ready)
   ```typescript
   // In key game events:
   await supabaseService.logEvent(
     room.code,
     playerId,
     'game_completed',
     { score, round_number }
   );
   ```

3. **Set Up Supabase Tables** (when adding write capability)
   - `questions` - game questions (read-only, auto-fetched)
   - `ddf_game_states` - game progression snapshots (write operations)
   - `ddf_events` - game event log (write operations)
   - (Optional) `ddf_statistics` - player stats aggregates

## Environment Variable Reference

### Required for Local Testing
```bash
PORT=3001
NODE_ENV=development
GAMEBUDDIES_CENTRAL_URL=https://gamebuddies.io
```

### Optional for GameBuddies Integration
```bash
DDF_API_KEY=your_key  # For player status updates
```

### Optional for Production Database
```bash
SUPABASE_URL=your_url
SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## Current Limitations

| Feature | Current | With Supabase |
|---------|---------|---------------|
| Game state persistence | ❌ Lost on restart | ✅ Persisted |
| Question storage | ✅ JSON file | ✅ Database |
| Player statistics | ❌ No | ✅ Full analytics |
| Game history | ❌ No | ✅ Complete log |
| Reconnection support | ❌ Limited | ✅ Full state recovery |
| GameBuddies integration | ✅ (optional API key) | ✅ Enhanced |

## Migration Status

✅ **Server-Side: Complete**
- DDF plugin integrated with 24 socket handlers
- Question management via API
- In-memory game state working
- File-based question storage working
- **Supabase READ capability integrated** (optional, graceful fallback)

✅ **Client-Side: Complete**
- Connected to `/ddf` namespace
- All 24+ events updated
- Two-step room creation working
- Admin panel integrated

✅ **Database Integration: READ Capability Ready**
- Supabase READ operations fully implemented and tested
- Questions auto-fetch from Supabase when credentials provided
- Graceful fallback to JSON if Supabase unavailable
- Zero additional configuration needed - works out-of-the-box

⏳ **Database Integration: WRITE Capability (Optional)**
- Infrastructure in place, methods created
- Waiting for user preference to enable game state persistence
- Steps documented above for implementation

## Quick Start (No Database Needed)

1. **Server**: Already configured and working
   ```bash
   cd unified-game-server
   npm run dev  # Starts on port 3001
   ```

2. **Client**: Configure and run
   ```bash
   cd DDF/client
   echo "VITE_SERVER_URL=http://localhost:3001" > .env
   npm run dev  # Starts on port 5173
   ```

3. **Test**: Create/join game, questions load from `games/ddf/data/questions.json`

## Questions?

For Supabase setup help:
- [Supabase Documentation](https://supabase.com/docs)
- [Original DDF Server](E:\GamebuddiesPlatform\DDF\DDF\server) - Reference implementation

For GameBuddies API setup:
- Contact GameBuddies team for API key
- Set `DDF_API_KEY` in `.env`
