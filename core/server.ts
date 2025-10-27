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

  constructor() {
    this.port = parseInt(process.env.PORT || '3001', 10);
    this.corsOrigins = this.parseCorsOrigins();

    // Initialize Express
    this.app = express();
    this.httpServer = createServer(this.app);

    // Initialize Socket.IO (main instance, games will use namespaces)
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: this.corsOrigins,
        methods: ['GET', 'POST'],
        credentials: true,
      },
      // Connection State Recovery: Automatically restores socket state after temporary disconnects
      // https://socket.io/docs/v4/connection-state-recovery
      connectionStateRecovery: {
        maxDisconnectionDuration: 2 * 60 * 1000, // 2 minutes - longer than typical network blips
        skipMiddlewares: true, // Skip auth middleware on recovery (state already validated)
      },
      pingTimeout: 60000,
      pingInterval: 25000,
      transports: ['websocket', 'polling'],
    });

    // Initialize managers
    this.roomManager = new RoomManager();
    this.sessionManager = new SessionManager();
    this.gameRegistry = new GameRegistry();

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

    // Compression
    this.app.use(compression());

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
      sendToRoom: (roomCode: string, event: string, data: any) => {
        namespace.to(roomCode).emit(event, data);
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
      socket.on('room:create', (data: { playerName: string; settings?: any }) => {
        const nameValidation = validationService.validatePlayerName(data.playerName);

        if (!nameValidation.isValid) {
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
        };

        const settings = { ...plugin.defaultSettings, ...data.settings };
        const room = this.roomManager.createRoom(plugin.id, player, settings);

        // Generate session token
        const sessionToken = this.sessionManager.createSession(player.id, room.code);
        player.sessionToken = sessionToken;

        // Join Socket.io room
        socket.join(room.code);

        // Call plugin hook
        if (plugin.onRoomCreate) {
          plugin.onRoomCreate(room);
        }

        socket.emit('room:created', {
          room: this.sanitizeRoom(room, socket.id),
          sessionToken,
        });

        console.log(`[${plugin.id.toUpperCase()}] Room created: ${room.code}`);
      });

      // Common event: Join room
      socket.on('room:join', (data: { roomCode: string; playerName: string; sessionToken?: string }) => {
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
          socket.emit('error', { message: 'Room not found' });
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
              // Update socket ID
              this.roomManager.reconnectPlayer(existingPlayer.socketId, socket.id);
              player = existingPlayer;
              sessionToken = data.sessionToken;
              isReconnecting = true;
              console.log(`[${plugin.id.toUpperCase()}] Player reconnected: ${player.name}`);
            } else {
              // Session valid but player not in room - join as new
              player = this.createPlayer(socket.id, nameValidation.sanitizedValue!);
              sessionToken = this.sessionManager.createSession(player.id, room.code);
            }
          } else {
            // Invalid session - join as new
            player = this.createPlayer(socket.id, nameValidation.sanitizedValue!);
            sessionToken = this.sessionManager.createSession(player.id, room.code);
          }
        } else {
          // New player
          player = this.createPlayer(socket.id, nameValidation.sanitizedValue!);
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

        // Only broadcast to others if new player (not reconnecting)
        if (!isReconnecting) {
          // Broadcast updated room to all players so they see the new player
          const serializedRoom = plugin.serializeRoom
            ? plugin.serializeRoom(room, socket.id)
            : this.sanitizeRoom(room, socket.id);

          namespace.to(room.code).emit('player:joined', {
            player: this.sanitizePlayer(player),
            room: serializedRoom, // Include full room so all players see the update
          });
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

      // GameBuddies Integration - Modern return handler using API
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

        // TODO: Call GameBuddies API service to get proper return URL
        // For now, use placeholder response
        const payload = {
          returnUrl: room.gameBuddiesData?.returnUrl || 'https://gamebuddies.io',
          sessionToken: room.gameBuddiesData?.sessionToken,
          success: true,
        };

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

      // Register game-specific socket handlers
      for (const [event, handler] of Object.entries(plugin.socketHandlers)) {
        socket.on(event, async (data: any) => {
          console.log(`[${plugin.id.toUpperCase()}] Received event: ${event} from socket ${socket.id}`);

          // First try to get room by socket ID (normal case)
          let room = this.roomManager.getRoomBySocket(socket.id);

          // If not found and roomCode is provided in data, use that (reconnection/new socket case)
          if (!room && data?.roomCode) {
            room = this.roomManager.getRoomByCode(data.roomCode);
            if (room) {
              console.log(`[${plugin.id.toUpperCase()}] Found room ${data.roomCode} via roomCode parameter (socket ${socket.id} not in playerRoomMap)`);
            }
          }

          if (!room) {
            console.log(`[${plugin.id.toUpperCase()}] Socket ${socket.id} not in a room for event ${event}`);
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

            // Remove after grace period (30 seconds)
            setTimeout(() => {
              const stillDisconnected = !player.connected;
              if (stillDisconnected) {
                const { room: currentRoom } = this.roomManager.removePlayerFromRoom(socket.id);
                if (currentRoom && plugin.onPlayerLeave) {
                  plugin.onPlayerLeave(currentRoom, player);
                }
              }
            }, 30000);

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

    // TODO: Load games dynamically from games/ directory
    // For now, games will be imported and registered manually

    console.log('[Server] Game plugins loaded');
  }

  /**
   * Helper: Create new player
   */
  private createPlayer(socketId: string, name: string): Player {
    return {
      socketId,
      id: randomUUID(),
      name,
      isHost: false,
      connected: true,
      joinedAt: Date.now(),
      lastActivity: Date.now(),
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
      gameData: player.gameData,
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
