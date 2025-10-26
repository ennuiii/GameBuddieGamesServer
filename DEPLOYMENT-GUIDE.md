# Unified Game Server - Deployment Guide for Render.com

## Overview

This guide explains how to deploy the unified game server and update your game clients to connect to it. The unified server handles multiple games (DDF, SUSD, ClueScale, BingoBuddies) from a single deployment.

---

## Step 1: Deploy the Unified Server

### 1.1 Create `render.yaml` in Unified Server Root

Create `E:/GamebuddiesPlatform/unified-game-server/render.yaml`:

```yaml
services:
  - type: web
    name: unified-game-server
    runtime: node
    repo: https://github.com/YOUR_USERNAME/unified-game-server # Update with your repo URL
    branch: main # or development
    buildCommand: npm install
    startCommand: npm start
    healthCheckPath: /api/health
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 3001
      - key: GAMEBUDDIES_CENTRAL_URL
        value: https://gamebuddies.io
      # Optional: Add API keys if using GameBuddies platform integration
      - key: DDF_API_KEY
        sync: false # Set manually in Render dashboard
      - key: BINGO_API_KEY
        sync: false
      - key: CLUE_API_KEY
        sync: false
      - key: SUSD_API_KEY
        sync: false
      - key: QUIZ_API_KEY
        sync: false
      # Optional: Supabase (for persistent storage)
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_ANON_KEY
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
    autoDeploy: true
```

### 1.2 Add Start Script to `package.json`

Ensure your `package.json` has:

```json
{
  "scripts": {
    "dev": "tsx watch core/server.ts",
    "build": "tsc",
    "start": "node dist/core/server.js"
  }
}
```

**Important:** You need to compile TypeScript for production!

### 1.3 Add Health Check Endpoint

The unified server should already have a health endpoint. Verify in `core/server.ts`:

```typescript
// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', games: gameRegistry.getAllGames() });
});
```

### 1.4 Deploy to Render

1. Push your code to GitHub
2. Go to https://render.com/dashboard
3. Click "New +" → "Web Service"
4. Connect your GitHub repo: `unified-game-server`
5. Render will auto-detect the `render.yaml` and create the service
6. Click "Create Web Service"

**Your server will be available at:** `https://unified-game-server.onrender.com`

---

## Step 2: Update Game Clients to Use Unified Server

### 2.1 DDF Client

**File:** `E:/GamebuddiesPlatform/ddf/client/.env`

**Local Development:**
```env
VITE_BACKEND_URL=http://localhost:3001
```

**Production (Render.com):**
```env
VITE_BACKEND_URL=https://unified-game-server.onrender.com
```

**OR** use environment-based configuration:

Create `.env.production`:
```env
VITE_BACKEND_URL=https://unified-game-server.onrender.com
```

Create `.env.development`:
```env
VITE_BACKEND_URL=http://localhost:3001
```

Vite will automatically use the right file based on build mode!

### 2.2 Update DDF Client `render.yaml`

Create/update `E:/GamebuddiesPlatform/ddf/render.yaml`:

```yaml
services:
  - type: web
    name: ddf-client
    runtime: static
    repo: https://github.com/YOUR_USERNAME/ddf # Update with your repo URL
    branch: main
    buildCommand: cd client && npm install && npm run build
    staticPublishPath: client/dist
    envVars:
      - key: VITE_BACKEND_URL
        value: https://unified-game-server.onrender.com # Your unified server URL
      # Optional: TURN server credentials for WebRTC
      - key: VITE_METERED_USERNAME
        sync: false
      - key: VITE_METERED_PASSWORD
        sync: false
    routes:
      - type: rewrite
        source: /*
        destination: /index.html
```

**Note:** Since this is a static site, you need to set `VITE_BACKEND_URL` in the **build environment**, not runtime!

### 2.3 Better Approach: Hardcode Production URL in Client

**File:** `ddf/client/src/config.ts` (create this file)

```typescript
// Auto-detect environment based on hostname
const isProduction = window.location.hostname !== 'localhost';

export const config = {
  // Use unified server in production, local server in development
  backendUrl: isProduction
    ? 'https://unified-game-server.onrender.com'
    : import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001',

  // WebRTC TURN server (optional)
  meteredUsername: import.meta.env.VITE_METERED_USERNAME,
  meteredPassword: import.meta.env.VITE_METERED_PASSWORD,
};
```

**Update:** `ddf/client/src/services/socketService.ts`

```typescript
import { config } from '../config';

// Use the configured backend URL
const BACKEND_URL = config.backendUrl;
```

This way, the production build automatically uses the unified server!

---

## Step 3: Configure CORS on Unified Server

### 3.1 Update Allowed Origins

**File:** `unified-game-server/core/server.ts`

The server should already have CORS configured. Make sure it includes your client URLs:

```typescript
const corsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',')
  : [
      'http://localhost:3000',
      'http://localhost:3002',
      'http://localhost:5173',
      'http://localhost:5174',
      'https://gamebuddies.io',
      'https://gamebuddies-io.onrender.com',
      'https://ddf-client.onrender.com', // ✅ Add your DDF client URL
      'https://bingo-client.onrender.com', // ✅ Add other clients
      // ... add all your deployed client URLs
    ];
```

### 3.2 Set CORS_ORIGINS in Render Dashboard

1. Go to your unified server on Render
2. Click "Environment"
3. Add environment variable:
   - **Key:** `CORS_ORIGINS`
   - **Value:** `http://localhost:5173,https://ddf-client.onrender.com,https://bingo-client.onrender.com,https://gamebuddies.io`

---

## Step 4: Deploy All Game Clients

Repeat for each game (DDF, BingoBuddies, ClueScale, SUSD):

### Example for BingoBuddies:

**Update:** `BingoBuddies/client/src/config.ts` (create if doesn't exist)

```typescript
const isProduction = window.location.hostname !== 'localhost';

export const config = {
  backendUrl: isProduction
    ? 'https://unified-game-server.onrender.com'
    : import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001',
};
```

**Update:** Socket connection in the client to use the config.

**Deploy:** Each client as a separate static site on Render.

---

## Step 5: Environment Variables Reference

### Unified Server Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Set to `production` on Render |
| `PORT` | No | `3001` | Server port |
| `GAMEBUDDIES_CENTRAL_URL` | No | `https://gamebuddies.io` | GameBuddies platform URL |
| `CORS_ORIGINS` | No | See code | Comma-separated allowed origins |
| `DDF_API_KEY` | No | - | API key for DDF game status updates |
| `BINGO_API_KEY` | No | - | API key for Bingo game status updates |
| `CLUE_API_KEY` | No | - | API key for ClueScale status updates |
| `SUSD_API_KEY` | No | - | API key for SUSD status updates |
| `QUIZ_API_KEY` | No | - | API key for Quiz status updates |
| `SUPABASE_URL` | No | - | Supabase project URL (optional) |
| `SUPABASE_ANON_KEY` | No | - | Supabase anon key (optional) |
| `SUPABASE_SERVICE_ROLE_KEY` | No | - | Supabase service role key (optional) |

### Client Environment Variables (Build-time)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `VITE_BACKEND_URL` | No | Auto-detected | Backend server URL |
| `VITE_METERED_USERNAME` | No | - | TURN server username for WebRTC |
| `VITE_METERED_PASSWORD` | No | - | TURN server password for WebRTC |

---

## Step 6: Testing the Deployment

### 6.1 Test Unified Server Health

Visit: `https://unified-game-server.onrender.com/api/health`

Expected response:
```json
{
  "status": "ok",
  "games": [
    {"id": "ddf", "name": "DDF Quiz Game", "namespace": "/ddf"},
    {"id": "bingo-buddies", "name": "BingoBuddies", "namespace": "/bingo"},
    {"id": "clue-scale", "name": "ClueScale", "namespace": "/clue"},
    {"id": "susd", "name": "SUS Game", "namespace": "/susd"}
  ]
}
```

### 6.2 Test Client Connection

1. Open your deployed client: `https://ddf-client.onrender.com`
2. Open browser DevTools → Network → WS (WebSockets)
3. Create a room
4. You should see WebSocket connection to: `wss://unified-game-server.onrender.com/ddf`

### 6.3 Test Multiplayer

1. Open client in two different browsers/tabs
2. Create room in one
3. Join room in the other
4. Verify both see each other and can play

---

## Step 7: Troubleshooting

### Issue: Client can't connect to server

**Check:**
1. CORS origins include your client URL
2. Client is using correct backend URL
3. Server is running (check Render logs)
4. WebSocket upgrade is working (check Network tab)

**Fix:**
```bash
# Check Render logs
render logs unified-game-server

# Verify CORS in server logs
# Should see: "CORS Origins: https://ddf-client.onrender.com,..."
```

### Issue: "Mixed Content" error (HTTP/HTTPS)

**Problem:** Client is HTTPS but trying to connect to HTTP server

**Fix:** Ensure backend URL uses `https://` and `wss://` (not `http://` and `ws://`)

### Issue: Server sleeps after 15 minutes (Render free tier)

**Expected behavior:** Server spins down after inactivity

**Impact:** First request after sleep takes ~30 seconds to wake up

**Solutions:**
1. Upgrade to paid tier for always-on
2. Accept the wake-up delay
3. Use a ping service (https://uptimerobot.com) to keep it awake

### Issue: Players get disconnected

**Check:**
1. Render logs for errors
2. Client reconnection logic
3. Session token storage

**The unified server has 30-second grace period** - players should auto-reconnect!

---

## Step 8: Migration Checklist

- [ ] Unified server deployed to Render
- [ ] Health endpoint responds correctly
- [ ] CORS configured with all client URLs
- [ ] DDF client updated to use unified server
- [ ] DDF client deployed to Render
- [ ] BingoBuddies client updated
- [ ] BingoBuddies client deployed
- [ ] ClueScale client updated (if migrated)
- [ ] ClueScale client deployed (if migrated)
- [ ] SUSD client updated (if migrated)
- [ ] SUSD client deployed (if migrated)
- [ ] Tested multiplayer in production
- [ ] WebRTC video working (if using TURN servers)
- [ ] GameBuddies integration tested (if using)

---

## Architecture Diagram

```
┌─────────────────┐
│  GameBuddies.io │
│   (Platform)    │
└────────┬────────┘
         │
         ↓
┌─────────────────────────────────────────────┐
│         Unified Game Server                 │
│    https://unified-game-server.onrender.com │
│                                             │
│  ┌─────┐  ┌─────┐  ┌─────┐  ┌─────┐       │
│  │ DDF │  │Bingo│  │Clue │  │SUSD │       │
│  │/ddf │  │/bingo│ │/clue│  │/susd│       │
│  └─────┘  └─────┘  └─────┘  └─────┘       │
└───────┬───────┬───────┬───────┬────────────┘
        │       │       │       │
        ↓       ↓       ↓       ↓
   ┌────┐  ┌────┐  ┌────┐  ┌────┐
   │DDF │  │Bingo│ │Clue│  │SUSD│
   │Client│ │Client│ │Client│ │Client│
   └────┘  └────┘  └────┘  └────┘
```

---

## Production URLs Example

**Unified Server:**
- `https://unified-game-server.onrender.com`

**Game Clients:**
- DDF: `https://ddf-client.onrender.com`
- BingoBuddies: `https://bingobuddies.onrender.com`
- ClueScale: `https://cluescale.onrender.com`
- SUSD: `https://susd-client.onrender.com`

**GameBuddies Platform:**
- `https://gamebuddies.io`

All clients connect to the single unified server!

---

## Next Steps

1. **Push unified server to GitHub**
2. **Deploy unified server on Render** using the `render.yaml`
3. **Update each client** with `config.ts` pointing to unified server
4. **Deploy each client** as static site on Render
5. **Test multiplayer** in production
6. **Update GameBuddies platform** (if using) with new client URLs

---

## Need Help?

- Check Render logs: `https://dashboard.render.com` → Your Service → Logs
- Test locally first: Ensure everything works on `localhost:3001`
- Verify CORS: Check server logs for allowed origins
- Check WebSocket: Use browser DevTools Network tab
