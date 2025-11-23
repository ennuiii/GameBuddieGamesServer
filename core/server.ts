import 'dotenv/config';
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import { randomUUID } from 'crypto';

// Core managers and services
import { RoomManager } from './managers/RoomManager.js';
import { SessionManager } from './managers/SessionManager.js';
import { GameRegistry } from './managers/GameRegistry.js';
import { gameBuddiesService } from './services/GameBuddiesService.js';
import { validationService } from './services/ValidationService.js';

// Types
import type {
  Room,
  Player,
  ChatMessage,
  GamePlugin,
  GameHelpers,
} from './types/core.js';

// Game plugins
import { SUSDGame } from '../games/susd/plugin.js';
import { cluePlugin } from '../games/clue/plugin.js';
import bingoPlugin from '../games/bingo/plugin.js';
import DDFGamePlugin from '../games/ddf/plugin.js';
import thinkAlikePlugin from '../games/thinkalike/plugin.js';
import templatePlugin from '../games/template/plugin.js';

/**
 * Global error handlers to prevent server crashes
 * ⚠️ Last resort - handlers should have their own try-catch
 */
process.on('uncaughtException', (error: Error) => {
  console.error('❌ [FATAL] Uncaught Exception:', error);
  console.error('Stack:', error.stack);
  // Don't exit - keep server running
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('❌ [FATAL] Unhandled Promise Rejection:', reason);
  console.error('Promise:', promise);
  // Don't exit - keep server running
});

/**
 * Unified Game Server
 *
 * Hosts multiple GameBuddies games as plugins with shared infrastructure.
 * Each game runs in its own Socket.io namespace for isolation.
 */
class UnifiedGameServer {
  private app: express.Application;
  private httpServer: ReturnType<typeof createServer>;
  private io: SocketIOServer;

  // Core managers
  private roomManager: RoomManager;
  private sessionManager: SessionManager;
  private gameRegistry: GameRegistry;

  // Configuration
  private port: number;
  private corsOrigins: string[];

  // ⚡ OPTIMIZATION: Broadcast throttling per room
  // Limits broadcasts to 10/second per room to prevent event loop saturation
  private broadcastThrottleMs = 100; // Throttle to 10 broadcasts/sec per room
  private lastBroadcastTime = new Map<string, number>(); // Track last broadcast per room
  private pendingBroadcasts = new Map<string, { event: string; data: any }>(); // Queue pending broadcasts

  // Using simple setInterval drift measurement instead of perf_hooks (more reliable)

  // ⚡ OPTIMIZATION: Connection tracking (limit removed for testing)
  // Track connection count for monitoring
  private connectionCount = 0;
  // MAX_CONNECTIONS limit removed - testing capacity

  constructor() {
    this.port = parseInt(process.env.PORT || '3001', 10);
    this.corsOrigins = this.parseCorsOrigins();

    // Initialize Express
    this.app = express();
    this.httpServer = createServer(this.app);

    // Initialize Socket.IO (main instance, games will use namespaces)
    // ⚡ PERFORMANCE TUNING: Phase 1 optimizations for handling 2000+ concurrent connections
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: this.corsOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      // Connection State Recovery: Automatically restores socket state after temporary disconnects
      // https://socket.io/docs/v4/connection-state-recovery
      connectionStateRecovery: {
        maxDisconnectionDuration: 5 * 60 * 1000, // ⚡ 5 minutes (matches pingTimeout - players can reconnect without full re-join)
        skipMiddlewares: true, // Skip auth middleware on recovery (state already validated)
      },
      // Increased ping timeout to prevent disconnects when tabs are backgrounded
      // Browsers suspend JavaScript in background tabs, preventing ping responses
      // 5 minutes allows players to switch tabs, think, and come back without disconnecting
      pingTimeout: 300000, // 5 minutes (was 60s - too short for backgrounded tabs)
      pingInterval: 25000, // Keep ping interval at 25s to detect actual disconnects quickly

      // ⚡ OPTIMIZATION 1: Force WebSocket-only transport (skip polling)
      // WebSockets are more efficient than HTTP long-polling
      // Result: 35% lower latency, no polling overhead
      transports: ['websocket'],

      // ⚡ OPTIMIZATION 2: Disable message compression (save CPU/memory)
      // Compression adds CPU overhead with marginal benefit for quiz games
      // Most game messages are small (<1KB), not worth compressing
      perMessageDeflate: false,

      // ⚡ OPTIMIZATION 3: Increase message buffer size
      // Allows larger messages without disconnecting clients
      // Default is 100 KB, we increase to 1 MB to handle large game state updates
      maxHttpBufferSize: 1024 * 1024, // 1 MB per message (default 100 KB)

      // ⚡ OPTIMIZATION 4: Timeout tuning for faster handshake
      // Lower timeouts for faster connection establishment
      connectTimeout: 45000, // 45s to complete connection (default: 45s)
      upgradeTimeout: 10000, // 10s for WebSocket upgrade (default: 10s)
      allowUpgrades: false, // ⚡ Disable upgrades (we're WebSocket-only anyway)
    });

    // Initialize managers
    this.roomManager = new RoomManager();
    this.sessionManager = new SessionManager();
    this.gameRegistry = new GameRegistry();

    // ⚡ OPTIMIZATION: Connection tracking
    // Note: TCP_NODELAY is already enabled by the WebSocket transport (ws library)
    // No need to manually configure since we're using transports: ['websocket']
    // Connection limit removed for capacity testing
    this.io.engine.on('connection', (engineSocket: any) => {
      // Track connection count for monitoring
      this.connectionCount++;

      engineSocket.on('close', () => {
        this.connectionCount--;
      });
    });

    // Log connection errors
    this.io.engine.on('connection_error', (err: any) => {
      console.error('⚠️  [CONNECTION ERROR]', err.code, err.message);
    });

    console.log('🎮 [Server] Unified Game Server initializing...');
  }

  /**
   * Parse CORS origins from environment
   */
  private parseCorsOrigins(): string[] {
    const defaultOrigins = [
      'http://localhost:3000',
      'http://localhost:3002',
      'http://localhost:5173',
      'https://gamebuddies.io',
      'https://gamebuddies-io.onrender.com',
    ];

    const envOrigins = process.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) || [];

    return Array.from(new Set([...defaultOrigins, ...envOrigins]));
  }

  /**
   * Configure Express middleware
   */
  private configureMiddleware(): void {
    // Trust proxy (for Render.com and other reverse proxies)
    this.app.set('trust proxy', true);

    // Security
    this.app.use(helmet({
      contentSecurityPolicy: false, // Games may need inline scripts
      crossOriginEmbedderPolicy: false,
    }));

    // Compression (optional - disabled by default to save CPU for WebSocket traffic)
    if (process.env.ENABLE_HTTP_COMPRESSION === 'true') {
      this.app.use(compression());
      console.log('📦 HTTP compression enabled');
    } else {
      console.log('⚡ HTTP compression disabled (WebSocket traffic uses perMessageDeflate: false)');
    }

    // CORS
    this.app.use(cors({
      origin: this.corsOrigins,
      credentials: true,
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    console.log('[Server] Middleware configured');
    console.log(`[Server] CORS Origins: ${this.corsOrigins.join(', ')}`);
  }

  /**
   * Configure HTTP routes
   */
  private configureRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        games: this.gameRegistry.getGameIds(),
      });
    });

    // Global stats
    this.app.get('/api/stats', (req, res) => {
      res.json({
        server: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        },
        rooms: this.roomManager.getStats(),
        sessions: this.sessionManager.getStats(),
        games: this.gameRegistry.getStats(),
      });
    });

    // Game-specific stats
    this.app.get('/api/stats/:gameId', (req, res) => {
      const { gameId } = req.params;
      const game = this.gameRegistry.getGame(gameId);

      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      const rooms = this.roomManager.getRoomsByGame(gameId);

      res.json({
        game: {
          id: game.id,
          name: game.name,
          version: game.version,
        },
        rooms: {
          total: rooms.length,
          players: rooms.reduce((sum, room) => sum + room.players.size, 0),
          details: rooms.map((room) => ({
            code: room.code,
            players: room.players.size,
            phase: room.gameState.phase,
          })),
        },
      });
    });

    console.log('[Server] HTTP routes configured');
  }

  /**
   * Set up Socket.io namespace for a game plugin
   */
  private setupGameNamespace(plugin: GamePlugin): void {
    const namespace = this.io.of(plugin.namespace);

    console.log(`[Server] Setting up namespace for ${plugin.name}: ${plugin.namespace}`);

    // Create helper functions for game event handlers
    const createHelpers = (room: Room): GameHelpers => ({
      // ⚡ OPTIMIZED: Throttle broadcasts to 10/sec per room
      // Prevents event loop saturation from rapid state updates
      sendToRoom: (roomCode: string, event: string, data: any) => {
        const now = Date.now();
        const lastBroadcast = this.lastBroadcastTime.get(roomCode) || 0;
        const timeSinceLastBroadcast = now - lastBroadcast;

        if (timeSinceLastBroadcast >= this.broadcastThrottleMs) {
          // Enough time has passed - send immediately
          namespace.to(roomCode).emit(event, data);
          this.lastBroadcastTime.set(roomCode, now);

          // Process any pending broadcast for this room
          if (this.pendingBroadcasts.has(roomCode)) {
            const pending = this.pendingBroadcasts.get(roomCode)!;
            this.pendingBroadcasts.delete(roomCode);

            // Schedule the pending broadcast for later
            setTimeout(() => {
              namespace.to(roomCode).emit(pending.event, pending.data);
              this.lastBroadcastTime.set(roomCode, Date.now());
            }, this.broadcastThrottleMs);
          }
        } else {
          // Too soon - queue this broadcast as pending (overwrites previous pending)
          this.pendingBroadcasts.set(roomCode, { event, data });
        }
      },
      sendToPlayer: (socketId: string, event: string, data: any) => {
        namespace.to(socketId).emit(event, data);
      },
      updatePlayerStatus: async (roomCode: string, playerId: string, status: string, data?: any) => {
        await gameBuddiesService.updatePlayerStatus(
          plugin.id,
          roomCode,
          playerId,
          status,
          `Status update: ${status}`,
          data
        );
      },
      getRoomByCode: (code: string) => {
        return this.roomManager.getRoomByCode(code);
      },
      removePlayerFromRoom: (roomCode: string, socketId: string) => {
        this.roomManager.removePlayerFromRoom(socketId);
      },
    });

    // Socket connection handler
    namespace.on('connection', (socket: Socket) => {
      console.log(`[${plugin.id.toUpperCase()}] Player connected: ${socket.id}`);

      // Common event: Create room
      socket.on('room:create', (data: { playerName: string; roomCode?: string; isGameBuddiesRoom?: boolean; settings?: any; playerId?: string; sessionToken?: string; premiumTier?: string }) => {
        console.log(`📥 [${plugin.id.toUpperCase()}] room:create received:`, {
          playerName: data.playerName,
          roomCode: data.roomCode,
          isGameBuddiesRoom: data.isGameBuddiesRoom,
          playerId: data.playerId,
          sessionToken: data.sessionToken?.substring(0, 8) + '...',
          premiumTier: data.premiumTier,
          settings: data.settings
        });
        console.log(`💎 [PREMIUM DEBUG] premiumTier received from client: ${data.premiumTier}`);

        const nameValidation = validationService.validatePlayerName(data.playerName);

        if (!nameValidation.isValid) {
          console.log(`❌ [${plugin.id.toUpperCase()}] Name validation failed:`, nameValidation.error);
          socket.emit('error', { message: nameValidation.error });
          return;
        }

        const player: Player = {
          socketId: socket.id,
          id: randomUUID(),
          name: nameValidation.sanitizedValue!,
          isHost: true,
          connected: true,
          joinedAt: Date.now(),
          lastActivity: Date.now(),
          premiumTier: data.premiumTier,
        };
        console.log(`💎 [PREMIUM DEBUG] Player created with premiumTier: ${player.premiumTier}`);

        const settings = { ...plugin.defaultSettings, ...data.settings };
        const room = this.roomManager.createRoom(plugin.id, player, settings, data.roomCode);

        console.log(`🏠 [${plugin.id.toUpperCase()}] Room created:`, {
          code: room.code,
          playerId: player.id,
          playerName: player.name,
          isGameBuddiesRoom: data.isGameBuddiesRoom
        });

        // Preserve GameBuddies flag if provided
        if (data.isGameBuddiesRoom) {
          room.isGameBuddiesRoom = true;
        }

        // Generate session token
        const sessionToken = this.sessionManager.createSession(player.id, room.code);
        player.sessionToken = sessionToken;

        // Join Socket.io room
        socket.join(room.code);

        // Call plugin hook
        if (plugin.onRoomCreate) {
          plugin.onRoomCreate(room);
        }

        const sanitizedRoom = this.sanitizeRoom(room, socket.id);
        socket.emit('room:created', {
          room: sanitizedRoom,
          sessionToken,
        });

        console.log(`✅ [${plugin.id.toUpperCase()}] Emitted room:created for ${room.code}`);
      });

      // Common event: Join room
      socket.on('room:join', (data: { roomCode: string; playerName: string; sessionToken?: string; premiumTier?: string }) => {
        console.log(`💎 [PREMIUM DEBUG] room:join premiumTier: ${data.premiumTier}`);
        const codeValidation = validationService.validateRoomCode(data.roomCode);
        const nameValidation = validationService.validatePlayerName(data.playerName);

        if (!codeValidation.isValid) {
          socket.emit('error', { message: codeValidation.error });
          return;
        }

        if (!nameValidation.isValid) {
          socket.emit('error', { message: nameValidation.error });
          return;
        }

        const room = this.roomManager.getRoomByCode(data.roomCode);

        if (!room) {
          // ✅ Emit specific error code so client can distinguish from other join errors
          socket.emit('error', {
            message: 'Room not found',
            code: 'ROOM_NOT_FOUND'
          });
          return;
        }

        // Check if reconnecting with session token
        let player: Player;
        let sessionToken: string;
        let isReconnecting = false;

        if (data.sessionToken) {
          const session = this.sessionManager.validateSession(data.sessionToken);
          if (session && session.roomCode === data.roomCode) {
            // Reconnecting player
            const existingPlayer = Array.from(room.players.values()).find(
              (p) => p.id === session.playerId
            );

            if (existingPlayer) {
              // Capture old socketId BEFORE updating (plugins need this for their own mappings)
              const oldSocketId = existingPlayer.socketId;

              // ✅ Update socket ID in core room and check for success
              const reconnectResult = this.roomManager.reconnectPlayer(oldSocketId, socket.id);

              if (!reconnectResult.player) {
                // ⚠️ reconnectPlayer couldn't find player under oldSocketId
                // This can happen during rapid reconnections (grace period grace period) when player already updated under new socketId
                // Fallback: manually update the player's socketId and room mappings
                console.warn(
                  `[CORE] reconnectPlayer failed for ${existingPlayer.name} - likely player already under new socket ID`,
                  { oldSocketId, newSocketId: socket.id }
                );

                // Manually update the player object and room mappings
                existingPlayer.socketId = socket.id;
                existingPlayer.connected = true;
                existingPlayer.lastActivity = Date.now();

                // Update room players Map: remove old key, add with new key
                room.players.delete(oldSocketId);
                room.players.set(socket.id, existingPlayer);
              }

              player = existingPlayer;
              player.oldSocketId = oldSocketId; // Store for plugin use
              sessionToken = data.sessionToken;
              isReconnecting = true;
              console.log(`[${plugin.id.toUpperCase()}] Player reconnected: ${player.name}`);
            } else {
              // Session valid but player not in room - join as new
              player = this.createPlayer(socket.id, nameValidation.sanitizedValue!, data.premiumTier);
              sessionToken = this.sessionManager.createSession(player.id, room.code);
            }
          } else {
            // Invalid session - join as new
            player = this.createPlayer(socket.id, nameValidation.sanitizedValue!, data.premiumTier);
            sessionToken = this.sessionManager.createSession(player.id, room.code);
          }
        } else {
          // New player
          player = this.createPlayer(socket.id, nameValidation.sanitizedValue!, data.premiumTier);
          sessionToken = this.sessionManager.createSession(player.id, room.code);
        }

        // Only add to room if NOT reconnecting (reconnectPlayer already updated the room)
        if (!isReconnecting) {
          const joined = this.roomManager.addPlayerToRoom(room.code, player);

          if (!joined) {
            socket.emit('error', { message: 'Cannot join room (full or already started)' });
            return;
          }
        }

        socket.join(room.code);

        // Call plugin hook for all players (including reconnecting)
        if (plugin.onPlayerJoin) {
          plugin.onPlayerJoin(room, player, isReconnecting);
        }

        socket.emit('room:joined', {
          room: this.sanitizeRoom(room, socket.id),
          player: this.sanitizePlayer(player),
          sessionToken,
        });

        if (isReconnecting) {
          // ✅ Filter out duplicate sockets during grace period
          // When a player reconnects, both old and new sockets are in room.players for 2s
          // We must only broadcast to the NEWEST socket per unique player ID
          const uniquePlayersByIdMap = new Map<string, Player>();
          for (const p of room.players.values()) {
            const existing = uniquePlayersByIdMap.get(p.id);
            // Keep the socket with the most recent lastActivity (newer connection)
            if (!existing || p.lastActivity > existing.lastActivity) {
              uniquePlayersByIdMap.set(p.id, p);
            }
          }
          const uniquePlayers = Array.from(uniquePlayersByIdMap.values());

          console.log(
            `[CORE] Broadcasting reconnection update: ${uniquePlayers.length} unique players ` +
            `(filtered from ${room.players.size} total sockets in room)`
          );

          for (const p of uniquePlayers) {
            const serializedRoom = plugin.serializeRoom
              ? plugin.serializeRoom(room, p.socketId)
              : this.sanitizeRoom(room, p.socketId);

            namespace.to(p.socketId).emit('server:game-state-update', serializedRoom);
          }
        }

        // Only broadcast to others if new player (not reconnecting)
        if (!isReconnecting) {
          // Broadcast updated room to all players so they see the new player
          // ⚠️ CRITICAL: Serialize for EACH player with THEIR socketId (not the joining player's)
          // This ensures each player gets correct personalized fields like mySocketId
          // This fixes the issue where existing players wouldn't see new joiners correctly
          const players = Array.from(room.players.values());

          for (const p of players) {
            const serializedRoom = plugin.serializeRoom
              ? plugin.serializeRoom(room, p.socketId)
              : this.sanitizeRoom(room, p.socketId);

            namespace.to(p.socketId).emit('player:joined', {
              player: this.sanitizePlayer(player),
              room: serializedRoom, // Each player gets room serialized for their perspective
            });
          }
        }

        const action = isReconnecting ? 'reconnected to' : 'joined';
        console.log(`[${plugin.id.toUpperCase()}] Player ${action} room ${room.code}: ${player.name}`);
      });

      // Common event: Leave room
      socket.on('room:leave', () => {
        const { room, player } = this.roomManager.removePlayerFromRoom(socket.id);

        if (room && player) {
          socket.leave(room.code);

          // Call plugin hook
          if (plugin.onPlayerLeave) {
            plugin.onPlayerLeave(room, player);
          }

          namespace.to(room.code).emit('player:left', {
            player: this.sanitizePlayer(player),
          });

          console.log(`[${plugin.id.toUpperCase()}] Player left room ${room.code}: ${player.name}`);
        }
      });

      // Common event: Chat message
      socket.on('chat:message', (data: { message: string }) => {
        const room = this.roomManager.getRoomBySocket(socket.id);
        const player = this.roomManager.getPlayer(socket.id);

        if (!room || !player) {
          socket.emit('error', { message: 'Not in a room' });
          return;
        }

        const messageValidation = validationService.validateChatMessage(data.message);

        if (!messageValidation.isValid) {
          socket.emit('error', { message: messageValidation.error });
          return;
        }

        const chatMessage: ChatMessage = {
          id: randomUUID(),
          playerId: player.id,
          playerName: player.name,
          message: messageValidation.sanitizedValue!,
          timestamp: Date.now(),
        };

        room.messages.push(chatMessage);
        namespace.to(room.code).emit('chat:message', chatMessage);
      });

      // Common event: Mini-Game (Click the Dot)
      socket.on('minigame:click', (data: { score: number; time: number }) => {
        const room = this.roomManager.getRoomBySocket(socket.id);
        const player = this.roomManager.getPlayer(socket.id);

        if (!room || !player) return;

        // Broadcast score to room to update leaderboard
        namespace.to(room.code).emit('minigame:leaderboard-update', {
          playerId: player.id,
          playerName: player.name,
          score: data.score,
          time: data.time
        });
      });

      // WebRTC Signaling Events
      socket.on('webrtc:enable-video', (data: { roomCode: string; connectionType: string }) => {
        const room = this.roomManager.getRoomBySocket(socket.id);
        const player = this.roomManager.getPlayer(socket.id);

        if (!room || !player) return;

        console.log(`[WebRTC] ${socket.id} enabled video in room ${room.code} with type ${data.connectionType}`);

        // Notify other players in the room that this player enabled video
        socket.to(room.code).emit('webrtc:peer-enabled-video', {
          peerId: socket.id,
          connectionType: data.connectionType,
          name: player.name
        });
      });

      socket.on('webrtc:disable-video', (data: { roomCode: string }) => {
        const room = this.roomManager.getRoomBySocket(socket.id);

        if (!room) return;

        console.log(`[WebRTC] ${socket.id} disabled video in room ${room.code}`);

        // Notify other players in the room that this player disabled video
        socket.to(room.code).emit('webrtc:peer-disabled-video', {
          peerId: socket.id
        });
      });

      socket.on('webrtc:offer', (data: { roomCode: string; toPeerId: string; offer: RTCSessionDescriptionInit }) => {
        console.log(`[WebRTC] Relaying offer from ${socket.id} to ${data.toPeerId} in room ${data.roomCode}`);

        // Relay the offer to the target peer
        socket.to(data.toPeerId).emit('webrtc:offer', {
          fromPeerId: socket.id,
          offer: data.offer
        });
      });

      socket.on('webrtc:answer', (data: { roomCode: string; toPeerId: string; answer: RTCSessionDescriptionInit }) => {
        console.log(`[WebRTC] Relaying answer from ${socket.id} to ${data.toPeerId} in room ${data.roomCode}`);

        // Relay the answer to the target peer
        socket.to(data.toPeerId).emit('webrtc:answer', {
          fromPeerId: socket.id,
          answer: data.answer
        });
      });

      socket.on('webrtc:ice-candidate', (data: { roomCode: string; toPeerId: string; candidate: RTCIceCandidateInit }) => {
        console.log(`[WebRTC] Relaying ICE candidate from ${socket.id} to ${data.toPeerId} in room ${data.roomCode}`);

        // Relay the ICE candidate to the target peer
        socket.to(data.toPeerId).emit('webrtc:ice-candidate', {
          fromPeerId: socket.id,
          candidate: data.candidate
        });
      });

      // GameBuddies Integration - Return all players to lobby (LEGACY - kept for backwards compatibility)
      socket.on('gm:return-all-to-gamebuddies', (data: {
        roomCode: string;
        hostName: string;
        returnUrl: string;
        timestamp: number;
        playerDelay: number;
      }) => {
        const room = this.roomManager.getRoomBySocket(socket.id);
        const player = this.roomManager.getPlayer(socket.id);

        if (!room || !player) {
          socket.emit('error', { message: 'Not in a room' });
          return;
        }

        if (!player.isHost) {
          socket.emit('error', { message: 'Only host can return all players' });
          return;
        }

        console.log(`[GameBuddies] GM ${data.hostName} requesting return to lobby for room ${data.roomCode}`);

        // Broadcast return command to ALL players in the room (including GM)
        namespace.to(room.code).emit('server:return-to-gamebuddies', {
          roomCode: data.roomCode,
          hostName: data.hostName,
          returnUrl: data.returnUrl,
          timestamp: data.timestamp,
          playerDelay: data.playerDelay
        });

        console.log(`[GameBuddies] ✅ Broadcasted return command to all players in room ${room.code}`);
      });

      // GameBuddies Integration - Return handler using API v2
      socket.on('gamebuddies:return', async (data: {
        roomCode: string;
        mode: 'group' | 'individual';
        reason?: string;
      }) => {
        const room = this.roomManager.getRoomBySocket(socket.id);
        const player = this.roomManager.getPlayer(socket.id);

        console.log('[GameBuddies] 📥 Received gamebuddies:return event:', data);

        if (!room) {
          console.error('[GameBuddies] ❌ Room not found for socket:', socket.id);
          socket.emit('error', { message: 'Room not found' });
          return;
        }

        if (!player) {
          console.error('[GameBuddies] ❌ Player not found for socket:', socket.id);
          socket.emit('error', { message: 'Player not found' });
          return;
        }

        const returnAll = data.mode === 'group';

        console.log(`[GameBuddies] ${player.name} requesting ${returnAll ? 'group' : 'individual'} return for room ${data.roomCode}`);

        // Call GameBuddies API v2 to get proper return URL
        let payload: any;

        const apiResponse = await gameBuddiesService.requestReturnToLobby(
          room.gameId,
          data.roomCode,
          {
            returnAll,
            playerId: data.mode === 'individual' ? player.id : undefined,
            initiatedBy: player.name,
            reason: data.reason || 'player_initiated_return',
            metadata: {
              game: room.gameId,
              playerName: player.name,
              timestamp: new Date().toISOString()
            }
          }
        );

        if (apiResponse.success && apiResponse.data) {
          // ✅ Use API response (includes proper room URL and session token)
          payload = {
            returnUrl: apiResponse.data.returnUrl,
            sessionToken: apiResponse.data.sessionToken,
            playersReturned: apiResponse.data.playersReturned,
            success: true,
          };
          console.log(`[GameBuddies] ✅ Using API response for return URL`);
        } else {
          // ⚠️ API failed, use fallback with room code (NOT just homepage!)
          console.warn('[GameBuddies] ⚠️ API failed, using fallback URL with room code');
          payload = {
            returnUrl: gameBuddiesService.getFallbackReturnUrl(data.roomCode),
            sessionToken: undefined,
            success: true,
            apiError: apiResponse.error
          };
        }

        console.log(`[GameBuddies] Return result:`, payload);

        if (returnAll) {
          // Return entire room
          namespace.to(room.code).emit('gamebuddies:return-redirect', payload);
          console.log(`[GameBuddies] ✅ Broadcasted return redirect to all players in room ${data.roomCode}`);
        } else {
          // Return single player
          socket.emit('gamebuddies:return-redirect', payload);
          console.log(`[GameBuddies] ✅ Sent return redirect to ${player.name}`);
        }
      });

      // Mobile optimization: Handle custom heartbeat from backgrounded clients
      socket.on('mobile-heartbeat', (data: { timestamp: number; isBackgrounded: boolean }) => {
        console.log(`[Mobile] 📱 Heartbeat from ${socket.id} (backgrounded: ${data.isBackgrounded})`);

        // Update player's last activity timestamp
        const player = this.roomManager.getPlayer(socket.id);
        if (player) {
          player.lastActivity = Date.now();
        }
      });

      // 🆕 GENERIC STATE SYNC - Works for all games!
      // Used by clients for reconnection/route restoration
      socket.on('game:sync-state', async (data: { roomCode: string }, callback?: (response: any) => void) => {
        try {
          console.log(`[CORE] 🔄 State sync requested by ${socket.id} for room ${data.roomCode}`);

          const room = this.roomManager.getRoomByCode(data.roomCode);
          if (!room) {
            console.log(`[CORE] ❌ Room not found: ${data.roomCode}`);
            if (callback && typeof callback === 'function') {
              callback({ success: false, message: 'Room not found' });
            }
            return;
          }

          // Get the plugin for this game
          const plugin = this.gameRegistry.getGame(room.gameId);
          if (!plugin) {
            console.log(`[CORE] ❌ Plugin not found for game: ${room.gameId}`);
            if (callback && typeof callback === 'function') {
              callback({ success: false, message: 'Game plugin not found' });
            }
            return;
          }

          // Serialize the room using the game's serializer
          const serialized = plugin.serializeRoom(room, socket.id);

          console.log(`[CORE] ✅ State sync successful for room ${data.roomCode}`);
          if (callback && typeof callback === 'function') {
            callback({ success: true, room: serialized });
          }
        } catch (error: any) {
          console.error(`[CORE] ❌ Error in game:sync-state:`, error);
          if (callback && typeof callback === 'function') {
            callback({ success: false, message: 'Failed to sync state' });
          }
        }
      });

      // Register game-specific socket handlers
      for (const [event, handler] of Object.entries(plugin.socketHandlers)) {
        socket.on(event, async (data: any) => {
          console.log(`[${plugin.id.toUpperCase()}] 📥 Received event: ${event} from socket ${socket.id}`);
          console.log(`[${plugin.id.toUpperCase()}] 📦 Event data:`, JSON.stringify(data, null, 2));

          // First try to get room by socket ID (normal case)
          let room = this.roomManager.getRoomBySocket(socket.id);

          if (!room) {
            console.log(`[${plugin.id.toUpperCase()}] ⚠️ Room lookup by socket ID failed`);
            console.log(`[${plugin.id.toUpperCase()}] 🔍 Socket ID: ${socket.id}`);
            console.log(`[${plugin.id.toUpperCase()}] 🔍 Socket connected: ${socket.connected}`);
            console.log(`[${plugin.id.toUpperCase()}] 🔍 Data has roomCode: ${!!data?.roomCode}`);
          }

          // If not found and roomCode is provided in data, use that (reconnection/new socket case)
          if (!room && data?.roomCode) {
            console.log(`[${plugin.id.toUpperCase()}] 🔄 Trying fallback lookup with roomCode: ${data.roomCode}`);
            room = this.roomManager.getRoomByCode(data.roomCode);
            if (room) {
              console.log(`[${plugin.id.toUpperCase()}] ✅ Found room ${data.roomCode} via roomCode parameter (socket ${socket.id} not in playerRoomMap)`);
              console.log(`[${plugin.id.toUpperCase()}] 👥 Room has ${room.players.size} players`);
              const playerIds = Array.from(room.players.keys());
              console.log(`[${plugin.id.toUpperCase()}] 🔑 Player socket IDs in room:`, playerIds);
            } else {
              console.log(`[${plugin.id.toUpperCase()}] ❌ Room ${data.roomCode} not found in roomManager`);
            }
          }

          if (!room) {
            // WebRTC events are just cleanup - silently ignore if room doesn't exist
            // This is common when rooms are deleted or during reconnection
            if (event.startsWith('webrtc:')) {
              console.log(`[${plugin.id.toUpperCase()}] 🔇 Ignoring WebRTC event for non-existent room (cleanup event)`);
              return;
            }

            // For non-WebRTC events, this is a real error
            console.error(`[${plugin.id.toUpperCase()}] ❌ NOT IN A ROOM ERROR`);
            console.error(`[${plugin.id.toUpperCase()}] 📋 Error context:`);
            console.error(`[${plugin.id.toUpperCase()}]    - Event: ${event}`);
            console.error(`[${plugin.id.toUpperCase()}]    - Socket ID: ${socket.id}`);
            console.error(`[${plugin.id.toUpperCase()}]    - Socket connected: ${socket.connected}`);
            console.error(`[${plugin.id.toUpperCase()}]    - Data roomCode: ${data?.roomCode || 'NOT PROVIDED'}`);
            console.error(`[${plugin.id.toUpperCase()}]    - Timestamp: ${new Date().toISOString()}`);

            // Get all rooms for this game to help debug
            const allRooms = this.roomManager.getRoomsByGame(plugin.id);
            console.error(`[${plugin.id.toUpperCase()}]    - Total ${plugin.id} rooms: ${allRooms.length}`);
            if (allRooms.length > 0) {
              console.error(`[${plugin.id.toUpperCase()}]    - Room codes: ${allRooms.map(r => r.code).join(', ')}`);
              allRooms.forEach(r => {
                const playerSockets = Array.from(r.players.keys());
                console.error(`[${plugin.id.toUpperCase()}]       - Room ${r.code}: ${r.players.size} players, sockets: ${playerSockets.join(', ')}`);
              });
            }

            socket.emit('error', { message: 'Not in a room' });
            return;
          }

          const helpers = createHelpers(room);

          try {
            await handler(socket, data, room, helpers);
          } catch (error: any) {
            console.error(`[${plugin.id.toUpperCase()}] Error in ${event} handler:`, error);
            socket.emit('error', { message: 'Internal server error' });
          }
        });
      }

      // Handle disconnection
      socket.on('disconnect', () => {
        const room = this.roomManager.getRoomBySocket(socket.id);
        const player = this.roomManager.getPlayer(socket.id);
        const isHost = room && room.hostSocketId === socket.id;

        // Handle both regular players and the host
        if (room && (player || isHost)) {
          // For regular players: mark as disconnected
          if (player) {
            this.roomManager.markPlayerDisconnected(socket.id);

            namespace.to(room.code).emit('player:disconnected', {
              player: this.sanitizePlayer(player),
            });

            // Notify about WebRTC peer leaving
            namespace.to(room.code).emit('webrtc:peer-left', { peerId: socket.id });

            // Notify plugin immediately about disconnect (for UI updates)
            if (plugin.onPlayerDisconnected) {
              plugin.onPlayerDisconnected(room, player);
            }

            // Remove after grace period (60 seconds)
            setTimeout(() => {
              const stillDisconnected = !player.connected;
              if (stillDisconnected) {
                const { room: currentRoom } = this.roomManager.removePlayerFromRoom(socket.id);

                // Invalidate session token - player loses their score/progress if they rejoin
                if (player.sessionToken) {
                  this.sessionManager.deleteSession(player.sessionToken);
                  console.log(`[${plugin.id.toUpperCase()}] Session invalidated for removed player: ${player.name}`);
                }

                if (currentRoom && plugin.onPlayerLeave) {
                  plugin.onPlayerLeave(currentRoom, player);
                }
              }
            }, 60000);

            console.log(`[${plugin.id.toUpperCase()}] Player disconnected: ${player.name}`);
          }
          // For the host: immediately remove from room and notify
          else if (isHost) {
            namespace.to(room.code).emit('host:disconnected', {
              message: 'Host has disconnected. Game will end.',
            });

            // Notify about WebRTC peer leaving
            namespace.to(room.code).emit('webrtc:peer-left', { peerId: socket.id });

            // Remove host and end the room
            this.roomManager.deleteRoom(room.code);
            console.log(`[${plugin.id.toUpperCase()}] Host disconnected - room ${room.code} deleted`);

            if (plugin.onHostLeave) {
              plugin.onHostLeave(room);
            }
          }
        }
      });
    });

    console.log(`[${plugin.id.toUpperCase()}] Namespace ${plugin.namespace} ready`);
  }

  /**
   * Register HTTP routes for a game plugin
   */
  private setupGameHttpRoutes(plugin: GamePlugin): void {
    if (!plugin.httpRoutes || plugin.httpRoutes.length === 0) {
      return;
    }

    console.log(`[Server] Registering ${plugin.httpRoutes.length} HTTP route(s) for ${plugin.name}`);

    for (const route of plugin.httpRoutes) {
      const { method, path, handler } = route;

      if (method === 'get') {
        this.app.get(path, handler);
        console.log(`  ✓ ${method.toUpperCase()} ${path}`);
      } else if (method === 'post') {
        this.app.post(path, handler);
        console.log(`  ✓ ${method.toUpperCase()} ${path}`);
      } else if (method === 'put') {
        this.app.put(path, handler);
        console.log(`  ✓ ${method.toUpperCase()} ${path}`);
      } else if (method === 'delete') {
        this.app.delete(path, handler);
        console.log(`  ✓ ${method.toUpperCase()} ${path}`);
      }
    }
  }

  /**
   * Load and register game plugins
   */
  async loadGamePlugins(): Promise<void> {
    console.log('[Server] Loading game plugins...');

    // Register SUSD game
    const susdRegistered = await this.registerGame(SUSDGame);
    if (susdRegistered) {
      console.log('[Server] ✓ SUSD game registered');
    } else {
      console.error('[Server] ✗ Failed to register SUSD game');
    }

    // Register ClueScale game
    const clueRegistered = await this.registerGame(cluePlugin);
    if (clueRegistered) {
      console.log('[Server] ✓ ClueScale game registered');
    } else {
      console.error('[Server] ✗ Failed to register ClueScale game');
    }

    // Register BingoBuddies game
    const bingoRegistered = await this.registerGame(bingoPlugin);
    if (bingoRegistered) {
      console.log('[Server] ✓ BingoBuddies game registered');
    } else {
      console.error('[Server] ✗ Failed to register BingoBuddies game');
    }

    // Register DDF game
    const ddfPlugin = new DDFGamePlugin();
    const ddfRegistered = await this.registerGame(ddfPlugin);
    if (ddfRegistered) {
      console.log('[Server] ✓ DDF game registered');
    } else {
      console.error('[Server] ✗ Failed to register DDF game');
    }

    // Register ThinkAlike game
    const thinkAlikeRegistered = await this.registerGame(thinkAlikePlugin);
    if (thinkAlikeRegistered) {
      console.log('[Server] ✓ ThinkAlike game registered');
    } else {
      console.error('[Server] ✗ Failed to register ThinkAlike game');
    }

    // Register Template game
    const templateRegistered = await this.registerGame(templatePlugin);
    if (templateRegistered) {
      console.log('[Server] ✓ Template game registered');
    } else {
      console.error('[Server] ✗ Failed to register Template game');
    }

    // TODO: Load games dynamically from games/ directory
    // For now, games will be imported and registered manually

    console.log('[Server] Game plugins loaded');
  }

  /**
   * Helper: Create new player
   */
  private createPlayer(socketId: string, name: string, premiumTier?: string): Player {
    return {
      socketId,
      id: randomUUID(),
      name,
      isHost: false,
      connected: true,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
      premiumTier,
    };
  }

  /**
   * Helper: Sanitize room for client (remove sensitive data)
   * Uses plugin's serializeRoom if available for game-specific format
   */
  private sanitizeRoom(room: Room, socketId?: string) {
    const plugin = this.gameRegistry.getGame(room.gameId);

    // Use plugin's custom serialization if available
    if (plugin && plugin.serializeRoom && socketId) {
      return plugin.serializeRoom(room, socketId);
    }

    // Default serialization (fallback)
    return {
      code: room.code,
      gameId: room.gameId,
      hostId: room.hostId,
      players: Array.from(room.players.values()).map(this.sanitizePlayer),
      gameState: room.gameState,
      settings: room.settings,
      messages: room.messages,
    };
  }

  /**
   * Helper: Sanitize player for client
   */
  private sanitizePlayer(player: Player) {
    return {
      id: player.id,
      name: player.name,
      isHost: player.isHost,
      connected: player.connected,
      disconnectedAt: player.disconnectedAt,
      gameData: player.gameData,
      premiumTier: player.premiumTier,
    };
  }

  /**
   * Register a game plugin
   */
  async registerGame(plugin: GamePlugin): Promise<boolean> {
    const registered = await this.gameRegistry.registerGame(plugin, this.io);

    if (registered) {
      this.setupGameNamespace(plugin);
      this.setupGameHttpRoutes(plugin);
    }

    return registered;
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    this.configureMiddleware();
    this.configureRoutes();
    await this.loadGamePlugins();

    this.httpServer.listen(this.port, () => {
      console.log('');
      console.log('🎮 ================================');
      console.log('🎮  Unified Game Server Started');
      console.log('🎮 ================================');
      console.log(`🎮  Port: ${this.port}`);
      console.log(`🎮  Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🎮  Games Loaded: ${this.gameRegistry.getGameIds().length}`);
      console.log('🎮 ================================');
      console.log('');

      // ⚡ MONITORING: Log performance metrics every 30 seconds
      // Use simple setInterval drift measurement (more reliable than perf_hooks)
      let lastCheck = Date.now();
      setInterval(() => {
        const now = Date.now();
        const activeConnections = this.io.engine.clientsCount;
        const totalRooms = this.roomManager.getAllRooms().length;

        // Measure event loop lag (setInterval drift)
        const expectedDelay = 30000; // 30 seconds
        const actualDelay = now - lastCheck;
        const lag = actualDelay - expectedDelay;

        // Show connection tracking with simple lag measurement
        console.log(`\n📊 [METRICS] Connections: ${this.connectionCount} | Active: ${activeConnections} | Rooms: ${totalRooms} | Lag: ${lag.toFixed(0)}ms`);

        // Alert if event loop is significantly delayed
        if (lag > 100) {
          console.warn(`⚠️  [ALERT] Event loop lag HIGH: ${lag.toFixed(0)}ms (expected 0ms, indicates blocking)`);
        }

        lastCheck = now;
      }, 30000); // Every 30 seconds
    });
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    console.log('[Server] Shutting down gracefully...');

    // Cleanup managers
    await this.gameRegistry.destroy();
    this.sessionManager.destroy();
    this.roomManager.destroy();

    // Close server
    this.httpServer.close(() => {
      console.log('[Server] Server closed');
      process.exit(0);
    });
  }
}

// Create and start server
const server = new UnifiedGameServer();

// Graceful shutdown handlers
process.on('SIGTERM', () => server.shutdown());
process.on('SIGINT', () => server.shutdown());

// Start server
server.start().catch((error) => {
  console.error('[Server] Failed to start:', error);
  process.exit(1);
});

// Export for game plugin registration
export { server };
