import { Server as SocketIOServer, Socket } from 'socket.io';

// ========================================
// Core Player & Room Types
// ========================================

export interface Player {
  socketId: string;
  id: string; // GameBuddies player ID (if from platform)
  userId?: string; // Supabase User ID (for authenticated users)
  isGuest: boolean; // true if no userId (anonymous/guest player)
  name: string;
  isHost: boolean;
  connected: boolean;
  disconnectedAt?: number; // Timestamp when player disconnected (for grace period countdown)
  oldSocketId?: string; // Temporary property set during reconnection for plugin use
  sessionToken?: string;
  joinedAt: number;
  lastActivity: number;
  gameData?: any; // Game-specific data
  premiumTier?: string; // 'free' | 'monthly' | 'lifetime' - GameBuddies premium status
  avatarUrl?: string; // GameBuddies avatar URL for player profile picture
}

export interface Room {
  code: string;
  gameId: string; // Which game plugin (e.g., 'bingo-buddies')
  hostId: string;
  hostSocketId: string; // Socket ID of the host (needed for disconnect handling)
  hostName: string; // Host's player name (for display purposes)
  players: Map<string, Player>;
  gameState: GameState;
  settings: RoomSettings;
  createdAt: number;
  lastActivity: number;

  // Display options
  isStreamerMode?: boolean;
  hideRoomCode?: boolean;

  // GameBuddies platform integration
  isGameBuddiesRoom: boolean;
  gameBuddiesRoomId?: string;
  gameBuddiesData?: {
    returnUrl?: string;
    sessionToken?: string;
    streamerId?: string;
    premiumTier?: string; // 'free' | 'monthly' | 'lifetime'
  };

  // Chat
  messages: ChatMessage[];

  // WebRTC tracking
  videoEnabledPeers?: Set<string>;
  peerConnectionTypes?: Map<string, string>;
}

export interface GameState {
  phase: string; // e.g., 'lobby', 'playing', 'finished'
  data: any; // Game-specific state
}

export interface RoomSettings {
  minPlayers: number;
  maxPlayers: number;
  language?: 'en' | 'de'; // Language for question content filtering
  gameSpecific?: any; // Game-specific settings
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  message: string;
  timestamp: number;
  isSystem?: boolean;
}

// ========================================
// Game Plugin Interface
// ========================================

export interface GamePlugin {
  // Metadata
  id: string;
  name: string;
  version: string;

  // Routing
  namespace: string; // e.g., '/bingo'
  basePath: string; // e.g., '/bingo'

  // Configuration
  defaultSettings: RoomSettings;
  requiresDatabase?: boolean;
  apiKey?: string;

  // Lifecycle hooks
  onInitialize?(io: SocketIOServer): Promise<void>;
  onRoomCreate?(room: Room): void;
  onPlayerJoin?(room: Room, player: Player, isReconnecting?: boolean): void;
  onPlayerDisconnected?(room: Room, player: Player): void; // Called immediately when player disconnects
  onPlayerLeave?(room: Room, player: Player): void; // Called after 30s timeout when player is removed
  onHostLeave?(room: Room): void; // Called when the host/gamemaster disconnects
  onGameStart?(room: Room): void;
  onGameEnd?(room: Room): void;
  onRoomDestroy?(room: Room): void; // Called when room is deleted - cleanup timers, etc.
  onCleanup?(): Promise<void>;

  // Serialization hook - converts server Room to client-expected format
  // Required for proper client-server communication
  serializeRoom(room: Room, socketId: string): any;

  // Socket event handlers (game-specific only)
  socketHandlers: Record<string, SocketEventHandler>;

  // Optional: Custom HTTP routes
  httpRoutes?: Array<{
    method: 'get' | 'post' | 'put' | 'delete';
    path: string;
    handler: any;
  }>;
}

export type SocketEventHandler = (
  socket: Socket,
  data: any,
  room: Room,
  helpers: GameHelpers
) => void | Promise<void>;

export interface GameHelpers {
  sendToRoom: (roomCode: string, event: string, data: any) => void;
  sendToPlayer: (socketId: string, event: string, data: any) => void;
  updatePlayerStatus: (roomCode: string, playerId: string, status: string, data?: any) => Promise<void>;
  getRoomByCode: (code: string) => Room | undefined;
  removePlayerFromRoom: (roomCode: string, socketId: string) => void;
  grantReward: (
    gameId: string,
    userId: string,
    data: {
      won: boolean;
      durationSeconds: number;
      score?: number;
      metadata?: Record<string, any>;
    }
  ) => Promise<any>;
}

// ========================================
// GameBuddies Integration Types
// ========================================

export interface GameBuddiesPlayerInfo {
  id: string;
  name: string;
  isHost?: boolean;
}

export interface GameBuddiesStatusUpdate {
  playerId: string;
  status: string;
  location: string;
  reason: string;
  gameData?: any;
}

export interface GameBuddiesReturnResult {
  success: boolean;
  apiResponse?: any;
  error?: string;
  statusCode?: number;
  playersTargeted?: number;
}

// ========================================
// Server Configuration
// ========================================

export interface ServerConfig {
  port: number;
  corsOrigins: string[];
  gameBuddiesCentralUrl: string;
  enabledGames: string[];
}

export interface GameConfig {
  id: string;
  enabled: boolean;
  basePath: string;
  namespace: string;
  apiKey?: string;
  requiresDatabase?: boolean;
}

// ========================================
// Session Management
// ========================================

export interface PlayerSession {
  playerId: string;
  roomCode: string;
  sessionToken: string;
  createdAt: number;
  lastActivity: number;
}

// ========================================
// Validation Types
// ========================================

export interface ValidationResult {
  isValid: boolean;
  error?: string;
  sanitizedValue?: any;
}
