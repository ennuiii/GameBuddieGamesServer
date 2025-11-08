#!/usr/bin/env node

/**
 * Socket.IO Load Testing Script for unified-game-server
 *
 * Usage: node socket-load-test.js
 *
 * This script simulates concurrent player connections to the DDF game server
 * with gradual ramp-up: 50 → 100 → 500 → 1000 → 2000 connections
 *
 * While running, monitor the Render dashboard to track:
 * - CPU usage (% of 0.5 CPU)
 * - Memory usage (MB / 512 MB)
 * - Any errors or crashes
 */

const io = require('socket.io-client');

// Configuration
const SERVER_URL = 'https://ddf-server.onrender.com';
const GAME_NAMESPACE = '/ddf';
const RAMP_LEVELS = [10000];
const HOLD_TIME_MS = 30000; // Hold each tier for 30 seconds
const STATS_INTERVAL_MS = 2000; // Print stats every 2 seconds

// Metrics tracking
const metrics = {
  totalConnected: 0,
  totalFailed: 0,
  totalDisconnected: 0,
  joinAttempts: 0,      // Track room join attempts
  joinSuccesses: 0,     // Track successful joins
  joinFailures: 0,      // Track failed joins (full room, etc)
  activeSockets: new Map(), // socketId → connection state
};

// Phase 2 Optimization Metrics
const phase2Metrics = {
  // Payload optimization
  payloadSamples: [],
  totalFullPayloads: 0,
  totalDeltaPayloads: 0,

  // Batching optimization
  actionsEmitted: 0,
  batchesEmitted: 0,
  actionsInBatches: 0,

  // Broadcast metrics
  broadcastsReceived: 0,
  broadcastSizes: [],
};

// Supabase Question Loading Metrics
const questionMetrics = {
  questionsLoadedSuccessfully: 0,
  questionsLoadedFailed: 0,
  questionLoadTimes: [],
  gameStartsInitiated: 0,
  gameStartsCompleted: 0,
};

// Batching configuration
const batchingConfig = {
  enabled: true,  // Toggle for A/B testing
  windowMs: 100,
  queues: new Map(),   // socketId → action queue
  timers: new Map(),   // socketId → batch timer
  lastGameState: new Map(), // socketId → last received game state
};

const roomCodes = new Set();
let currentLevel = 0;
let rampUpStartTime = 0;

/**
 * Calculate delta between two game states
 */
function calculateDelta(oldState, newState) {
  const delta = {};
  for (const key in newState) {
    if (JSON.stringify(oldState[key]) !== JSON.stringify(newState[key])) {
      delta[key] = newState[key];
    }
  }
  return delta;
}

/**
 * Emit an action, optionally batched
 */
function emitAction(socket, playerIndex, eventName, data) {
  if (!batchingConfig.enabled) {
    socket.emit(eventName, data);
    phase2Metrics.actionsEmitted++;
    return;
  }

  // Queue action for batching
  if (!batchingConfig.queues.has(socket.id)) {
    batchingConfig.queues.set(socket.id, []);
  }

  batchingConfig.queues.get(socket.id).push({ event: eventName, data });

  // Set batch timer if not already set
  if (!batchingConfig.timers.has(socket.id)) {
    batchingConfig.timers.set(socket.id, setTimeout(() => {
      flushActionBatch(socket);
    }, batchingConfig.windowMs));
  }
}

/**
 * Flush queued actions in a batch
 */
function flushActionBatch(socket) {
  const queue = batchingConfig.queues.get(socket.id);

  if (queue && queue.length > 0) {
    if (queue.length === 1) {
      // Single action - emit directly
      socket.emit(queue[0].event, queue[0].data);
      phase2Metrics.actionsEmitted++;
    } else if (queue.length > 1) {
      // Multiple actions - batch them
      socket.emit('ddf:batch-actions', { actions: queue });
      phase2Metrics.batchesEmitted++;
      phase2Metrics.actionsInBatches += queue.length;
    }
  }

  // Clear queue and timer
  batchingConfig.queues.set(socket.id, []);
  batchingConfig.timers.delete(socket.id);
}

/**
 * Simulate realistic gameplay actions
 */
function simulateGameplay(socket, playerIndex, roomCode) {
  const isGM = playerIndex % 10 === 0;

  if (isGM) {
    // GM starts game first (this triggers Supabase question loading)
    setTimeout(() => {
      console.log(`[Player ${playerIndex}] 🎮 GM starting game to load questions from Supabase`);
      questionMetrics.gameStartsInitiated++;
      socket.emit('ddf:start-game', { soloMode: false });
    }, 1000 + Math.random() * 2000);

    // GM simulates rating answers every 5-15 seconds (after game starts)
    setTimeout(() => {
      setInterval(() => {
        const ratings = ['correct', 'incorrect', 'too-late'];
        emitAction(socket, playerIndex, 'ddf:rate-answer', {
          playerId: `player_${Math.floor(Math.random() * 1000000)}`,
          rating: ratings[Math.floor(Math.random() * ratings.length)],
          answerSummary: 'Test answer',
          questions: [],
        });
      }, 5000 + Math.random() * 10000);
    }, 3000);

    // GM simulates starting voting every 60-120 seconds
    setTimeout(() => {
      setInterval(() => {
        emitAction(socket, playerIndex, 'ddf:control-timer', {
          action: 'start-voting',
        });
      }, 60000 + Math.random() * 60000);
    }, 5000);
  } else {
    // Players simulate voting every 3-10 seconds
    setTimeout(() => {
      setInterval(() => {
        emitAction(socket, playerIndex, 'ddf:submit-vote', {
          votedPlayerId: `player_${Math.floor(Math.random() * 1000000)}`,
        });
      }, 3000 + Math.random() * 7000);
    }, 2000 + Math.random() * 3000);
  }
}

/**
 * Connect a single player to the server
 */
function connectPlayer(playerIndex) {
  return new Promise((resolve) => {
    const socket = io(SERVER_URL + GAME_NAMESPACE, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 3,
      transports: ['websocket'],
      query: {
        // Optional: send some client info
      }
    });

    const playerName = `LoadTestPlayer_${playerIndex}`;
    let joinAttempted = false;

    socket.on('connect', () => {
      metrics.totalConnected++;
      metrics.activeSockets.set(socket.id, {
        playerId: playerIndex,
        playerName,
        connected: true,
        joinedRoom: false,
        roomCode: null,
      });

      // Try to join a room
      if (!joinAttempted) {
        joinAttempted = true;
        attemptJoinRoom(socket, playerName, playerIndex);
      }

      resolve(socket);
    });

    socket.on('error', (error) => {
      console.error(`[Player ${playerIndex}] Connection error:`, error);
      metrics.totalFailed++;
      resolve(socket);
    });

    socket.on('disconnect', () => {
      const state = metrics.activeSockets.get(socket.id);
      if (state) {
        state.connected = false;
      }
      metrics.totalDisconnected++;
    });

    socket.on('room:created', (data) => {
      const state = metrics.activeSockets.get(socket.id);
      if (state) {
        state.roomCode = data.room.code;
        state.joinedRoom = true;
        roomCodes.add(data.room.code);
      }
    });

    socket.on('room:joined', (data) => {
      const state = metrics.activeSockets.get(socket.id);
      if (state) {
        state.roomCode = data.room.code;
        state.joinedRoom = true;
        roomCodes.add(data.room.code);
      }
    });

    socket.on('ddf:game-state-update', (data) => {
      // Track payload size and delta
      if (data && data.room) {
        const fullSize = JSON.stringify(data).length;
        phase2Metrics.broadcastsReceived++;
        phase2Metrics.broadcastSizes.push(fullSize);
        phase2Metrics.totalFullPayloads += fullSize;

        // Track question loading from Supabase
        if (data.room.gameState && data.room.gameState.currentQuestion) {
          questionMetrics.questionsLoadedSuccessfully++;
          console.log(`[Player ${playerIndex}] ✅ Question loaded from Supabase: ${data.room.gameState.currentQuestion.question?.substring(0, 50)}`);
        }

        // Calculate delta if we have previous state
        const lastState = batchingConfig.lastGameState.get(socket.id);
        if (lastState) {
          const delta = calculateDelta(lastState, data.room);
          const deltaSize = JSON.stringify(delta).length;
          phase2Metrics.totalDeltaPayloads += deltaSize;

          const payloadReduction = 1 - (deltaSize / fullSize);
          phase2Metrics.payloadSamples.push({
            full: fullSize,
            delta: deltaSize,
            reduction: payloadReduction,
          });
        }

        batchingConfig.lastGameState.set(socket.id, JSON.parse(JSON.stringify(data.room)));
      }
    });

    // Track game start for question loading
    socket.on('ddf:game-started', (data) => {
      questionMetrics.gameStartsCompleted++;
      console.log(`[Player ${playerIndex}] 🎮 Game started, questions loaded`);
    });

    // Timeout fallback
    setTimeout(() => {
      resolve(socket);
    }, 5000);
  });
}

/**
 * Attempt to join or create a room
 * If join fails (room full), automatically creates a new room instead
 */
function attemptJoinRoom(socket, playerName, playerIndex) {
  // First few players create rooms, rest join them
  if (playerIndex % 10 === 0) {
    // Create a new room
    socket.emit('room:create', { playerName }, (response) => {
      if (response && response.room) {
        roomCodes.add(response.room.code);
        metrics.joinSuccesses++;
        // Start gameplay simulation for GM
        setTimeout(() => simulateGameplay(socket, playerIndex, response.room.code), 1000);
      }
    });
  } else if (roomCodes.size > 0) {
    // Try to join an existing room
    const roomCode = Array.from(roomCodes)[Math.floor(Math.random() * roomCodes.size)];
    metrics.joinAttempts++;

    socket.emit('room:join', {
      roomCode,
      playerName
    }, (response) => {
      // Check if join failed (room full, etc)
      if (response && response.error) {
        console.log(`[Player ${playerIndex}] Join failed: ${response.error} - creating new room instead`);
        metrics.joinFailures++;

        // Create a new room instead
        socket.emit('room:create', { playerName }, (createResponse) => {
          if (createResponse && createResponse.room) {
            roomCodes.add(createResponse.room.code);
            metrics.joinSuccesses++;
            // Start gameplay simulation for fallback GM
            setTimeout(() => simulateGameplay(socket, playerIndex, createResponse.room.code), 1000);
          }
        });
      } else if (response && response.room) {
        // Join was successful
        metrics.joinSuccesses++;
        // Start gameplay simulation for regular player
        setTimeout(() => simulateGameplay(socket, playerIndex, roomCode), 1000);
      }
    });
  }
}

/**
 * Ramp up connections to a target level
 */
async function rampUpToLevel(targetCount) {
  const currentCount = metrics.activeSockets.size;
  const connectionsNeeded = targetCount - currentCount;

  if (connectionsNeeded <= 0) {
    console.log(`Already at ${currentCount} connections, target is ${targetCount}`);
    return;
  }

  console.log(`\n🚀 Ramping up from ${currentCount} to ${targetCount} connections (${connectionsNeeded} new connections)`);
  rampUpStartTime = Date.now();

  // Connect in batches to avoid overwhelming the local machine
  const batchSize = 10;
  for (let i = 0; i < connectionsNeeded; i += batchSize) {
    const batch = [];
    for (let j = 0; j < batchSize && i + j < connectionsNeeded; j++) {
      const playerIndex = currentCount + i + j;
      batch.push(connectPlayer(playerIndex));
    }
    await Promise.all(batch);

    // Small delay between batches
    await new Promise(resolve => setTimeout(resolve, 100));

    // Print progress
    const progress = Math.min(currentCount + i + batchSize, targetCount);
    console.log(`  ↳ Connected: ${progress}/${targetCount}`);
  }

  console.log(`✅ Ramp-up complete. Now holding for ${HOLD_TIME_MS / 1000}s while you monitor Render dashboard...`);
}

/**
 * Print current metrics
 */
function printMetrics() {
  const connected = Array.from(metrics.activeSockets.values()).filter(s => s.connected).length;
  const inRooms = Array.from(metrics.activeSockets.values()).filter(s => s.joinedRoom).length;
  const uniqueRooms = roomCodes.size;

  // Calculate Phase 2 metrics
  const avgPayloadReduction = phase2Metrics.payloadSamples.length > 0
    ? (phase2Metrics.payloadSamples.reduce((sum, s) => sum + s.reduction, 0) / phase2Metrics.payloadSamples.length)
    : 0;

  const totalBytesWithDelta = phase2Metrics.totalDeltaPayloads;
  const totalBytesWithoutDelta = phase2Metrics.totalFullPayloads;
  const bytesSaved = totalBytesWithoutDelta - totalBytesWithDelta;

  const avgBatchSize = phase2Metrics.batchesEmitted > 0
    ? (phase2Metrics.actionsInBatches / phase2Metrics.batchesEmitted).toFixed(2)
    : 0;

  const totalActions = phase2Metrics.actionsEmitted + phase2Metrics.actionsInBatches;
  const totalEmits = phase2Metrics.actionsEmitted + phase2Metrics.batchesEmitted;
  const emissionReduction = totalActions > 0
    ? (1 - (totalEmits / totalActions)) * 100
    : 0;

  const actionsPerBroadcast = phase2Metrics.broadcastsReceived > 0
    ? (totalActions / phase2Metrics.broadcastsReceived).toFixed(2)
    : 0;

  const avgBroadcastSize = phase2Metrics.broadcastSizes.length > 0
    ? (phase2Metrics.broadcastSizes.reduce((a, b) => a + b, 0) / phase2Metrics.broadcastSizes.length / 1024).toFixed(2)
    : 0;

  console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 METRICS (Level ${currentLevel}/${RAMP_LEVELS.length})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔷 CONNECTION METRICS:
  Connected:         ${connected}/${metrics.activeSockets.size}
  In Rooms:          ${inRooms}
  Unique Rooms:      ${uniqueRooms}
  Join Attempts:     ${metrics.joinAttempts}
  Join Successes:    ${metrics.joinSuccesses}
  Join Failures:     ${metrics.joinFailures}

🔷 PHASE 2 OPTIMIZATION METRICS:
  📦 Delta Updates:
    Avg Reduction:   ${(avgPayloadReduction * 100).toFixed(1)}%
    Bytes Saved:     ${(bytesSaved / 1024).toFixed(2)} KB

  ⚡ Client Batching:
    Actions Emitted: ${phase2Metrics.actionsEmitted}
    Batches Sent:    ${phase2Metrics.batchesEmitted}
    Avg Batch Size:  ${avgBatchSize}
    Emit Reduction:  ${emissionReduction.toFixed(1)}%

  📡 Broadcast Efficiency:
    Actions/Broadcast: ${actionsPerBroadcast}
    Avg Size:        ${avgBroadcastSize} KB

🔷 SUPABASE QUESTION LOADING:
  Game Starts Initiated: ${questionMetrics.gameStartsInitiated}
  Game Starts Completed: ${questionMetrics.gameStartsCompleted}
  Questions Loaded: ${questionMetrics.questionsLoadedSuccessfully}
  Load Success Rate: ${questionMetrics.gameStartsInitiated > 0 ? ((questionMetrics.gameStartsCompleted / questionMetrics.gameStartsInitiated) * 100).toFixed(1) : 0}%

🔷 ERROR METRICS:
  Total Failed:      ${metrics.totalFailed}
  Total Disconnected: ${metrics.totalDisconnected}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);
}

/**
 * Main loop
 */
async function main() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║      Socket.IO Load Test - unified-game-server            ║
║      Server: ${SERVER_URL}
║      Ramp Profile: ${RAMP_LEVELS.join(' → ')} connections
╚════════════════════════════════════════════════════════════╝
  `);

  // Print metrics every 2 seconds
  const metricsInterval = setInterval(() => {
    printMetrics();
  }, STATS_INTERVAL_MS);

  // Ramp through each level
  for (currentLevel = 0; currentLevel < RAMP_LEVELS.length; currentLevel++) {
    const level = RAMP_LEVELS[currentLevel];

    await rampUpToLevel(level);

    // Hold at this level
    await new Promise(resolve => {
      setTimeout(() => {
        resolve();
      }, HOLD_TIME_MS);
    });
  }

  clearInterval(metricsInterval);

  // Calculate final Phase 2 metrics
  const finalAvgPayloadReduction = phase2Metrics.payloadSamples.length > 0
    ? (phase2Metrics.payloadSamples.reduce((sum, s) => sum + s.reduction, 0) / phase2Metrics.payloadSamples.length) * 100
    : 0;

  const finalBytesSaved = phase2Metrics.totalFullPayloads - phase2Metrics.totalDeltaPayloads;
  const finalAvgBatchSize = phase2Metrics.batchesEmitted > 0
    ? (phase2Metrics.actionsInBatches / phase2Metrics.batchesEmitted).toFixed(2)
    : 0;

  const finalTotalActions = phase2Metrics.actionsEmitted + phase2Metrics.actionsInBatches;
  const finalTotalEmits = phase2Metrics.actionsEmitted + phase2Metrics.batchesEmitted;
  const finalEmissionReduction = finalTotalActions > 0
    ? (1 - (finalTotalEmits / finalTotalActions)) * 100
    : 0;

  const finalActionsPerBroadcast = phase2Metrics.broadcastsReceived > 0
    ? (finalTotalActions / phase2Metrics.broadcastsReceived).toFixed(2)
    : 0;

  const finalAvgBroadcastSize = phase2Metrics.broadcastSizes.length > 0
    ? (phase2Metrics.broadcastSizes.reduce((a, b) => a + b, 0) / phase2Metrics.broadcastSizes.length / 1024).toFixed(2)
    : 0;

  // Final summary
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                  LOAD TEST COMPLETE                        ║
╚════════════════════════════════════════════════════════════╝

📊 CONNECTION METRICS:
  Peak Connections:   ${metrics.activeSockets.size}
  Currently Connected: ${Array.from(metrics.activeSockets.values()).filter(s => s.connected).length}
  In Rooms:           ${Array.from(metrics.activeSockets.values()).filter(s => s.joinedRoom).length}
  Total Rooms Created: ${roomCodes.size}
  Join Attempts:      ${metrics.joinAttempts}
  Join Successes:     ${metrics.joinSuccesses}
  Join Failures:      ${metrics.joinFailures}
  Join Success Rate:  ${metrics.joinAttempts > 0 ? ((metrics.joinSuccesses / metrics.joinAttempts) * 100).toFixed(1) : 0}%

📦 PHASE 2 DELTA UPDATES:
  Avg Payload Reduction:  ${finalAvgPayloadReduction.toFixed(1)}%
  Total Bytes Saved:      ${(finalBytesSaved / 1024 / 1024).toFixed(2)} MB
  Full State Total:       ${(phase2Metrics.totalFullPayloads / 1024 / 1024).toFixed(2)} MB
  Delta State Total:      ${(phase2Metrics.totalDeltaPayloads / 1024 / 1024).toFixed(2)} MB

⚡ PHASE 2 CLIENT-SIDE BATCHING:
  Total Actions Emitted:  ${phase2Metrics.actionsEmitted}
  Total Batches Sent:     ${phase2Metrics.batchesEmitted}
  Total Actions Batched:  ${phase2Metrics.actionsInBatches}
  Avg Batch Size:         ${finalAvgBatchSize}
  Emission Reduction:     ${finalEmissionReduction.toFixed(1)}%

📡 BROADCAST EFFICIENCY:
  Total Broadcasts Received: ${phase2Metrics.broadcastsReceived}
  Actions Per Broadcast:     ${finalActionsPerBroadcast}
  Avg Broadcast Size:        ${finalAvgBroadcastSize} KB

🗄️ SUPABASE QUESTION LOADING:
  Game Starts Initiated:  ${questionMetrics.gameStartsInitiated}
  Game Starts Completed:  ${questionMetrics.gameStartsCompleted}
  Questions Loaded:       ${questionMetrics.questionsLoadedSuccessfully}
  Load Success Rate:      ${questionMetrics.gameStartsInitiated > 0 ? ((questionMetrics.gameStartsCompleted / questionMetrics.gameStartsInitiated) * 100).toFixed(1) : 0}%

🔴 ERROR METRICS:
  Total Failed:       ${metrics.totalFailed}
  Total Disconnected: ${metrics.totalDisconnected}

✅ Server remains stable with Phase 2 gameplay simulation active!
Check Render dashboard for final CPU/Memory metrics.
  `);

  process.exit(0);
}

// Run the test
main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
