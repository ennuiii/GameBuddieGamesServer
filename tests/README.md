# ClueScale Migration Tests

This directory contains Playwright tests for the ClueScale migration to the unified game server.

## Test Files

### `cluescale.spec.ts`
Comprehensive integration tests for ClueScale functionality:
- Room creation (two-step flow)
- Player joining
- Multi-player gameplay
- Session token handling
- Socket connection to `/clue` namespace
- Game start validation
- Player disconnection handling
- Minimum player requirements
- Full game round simulation

### `server-health.spec.ts`
Server health and API endpoint tests:
- Health check endpoint (`/health`)
- Stats endpoint (`/api/stats`)
- Game registration verification
- CORS configuration
- ClueScale-specific stats

## Running Tests

```bash
# Run all tests
npm test

# Run with UI mode (recommended for debugging)
npm run test:ui

# Run in headed mode (see browser)
npm run test:headed

# Run only ClueScale tests
npm run test:cluescale

# Run only health tests
npm run test:health

# Show test report
npm run test:report
```

## Prerequisites

Both servers must be running:
1. Unified game server on port 3001
2. ClueScale client on port 5173

The Playwright config will automatically start these servers if not running.

## Test Coverage

### ✅ Tested Features:
- Two-step room creation (`room:create` → `clue:setup-game`)
- Socket.io namespace isolation (`/clue`)
- Session token generation and storage
- Multi-player room joining
- Host controls (start game, kick player)
- Minimum player validation (3 players)
- Player disconnection/reconnection
- Server health endpoints
- Game registration in unified server

### ⏳ Future Tests:
- Clue submission validation
- Guess submission and auto-reveal
- Round scoring calculations
- Role rotation between rounds
- Timer functionality
- Settings updates
- Game restart
- WebRTC integration
- Chat functionality

## Notes

- Tests run sequentially (not in parallel) to avoid port conflicts
- Servers are reused if already running
- Screenshots and videos captured on failure
- HTML report generated after test run
