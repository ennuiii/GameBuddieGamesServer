import { randomUUID } from 'crypto';
import type { Room, Player, RoomSettings, GameState } from '../types/core.js';
import { validationService } from '../services/ValidationService.js';

/**
 * Room Manager
 *
 * Manages all active game rooms across ALL games in the unified server.
 * Provides generic room operations that work for any game plugin.
 *
 * Responsibilities:
 * - Create/destroy rooms
 * - Add/remove players
 * - Track room state
 * - Handle room cleanup
 * - Provide room queries
 */
export class RoomManager {
  private rooms: Map<string, Room>;
  private playerRoomMap: Map<string, string>; // socketId -> roomCode
  private socketToPlayerId: Map<string, string>; // socketId -> playerId (for player.id lookup)
  private inviteTokens: Map<string, { roomCode: string; createdAt: number }>; // inviteToken -> { roomCode, createdAt }
  private oldSocketCleanupTimers: Map<string, NodeJS.Timeout>; // Track cleanup timers for old socket IDs
  private roomDeletionTimers: Map<string, NodeJS.Timeout>; // Graceful deletion timers for empty rooms
  private cleanupInterval: NodeJS.Timeout;

  /**
   * Callback invoked when a room is deleted.
   * Used to notify external services (e.g., Gamebuddies.io) about room abandonment.
   * The callback receives the room object and a reason string.
   */
  public onRoomDeleted?: (room: Room, reason: string) => void | Promise<void>;

  constructor() {
    this.rooms = new Map();
    this.playerRoomMap = new Map();
    this.socketToPlayerId = new Map();
    this.inviteTokens = new Map();
    this.oldSocketCleanupTimers = new Map();
    this.roomDeletionTimers = new Map();

    // Auto-cleanup inactive rooms every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveRooms();
      this.cleanupExpiredInvites();
    }, 5 * 60 * 1000);

    console.log('[RoomManager] Initialized');
  }

  /**
   * Create a new room
   */
  createRoom(gameId: string, hostPlayer: Player, settings: RoomSettings, providedRoomCode?: string): Room {
    const roomCode = providedRoomCode || this.generateUniqueRoomCode();

    const room: Room = {
      code: roomCode,
      gameId,
      hostId: hostPlayer.id,
      hostSocketId: hostPlayer.socketId, // Track host's socket ID for disconnect handling
      hostName: hostPlayer.name, // Store host's actual name for display
      players: new Map(), // Don't add host to players - host is only referenced via hostId
      gameState: {
        phase: 'lobby',
        data: {},
      },
      settings,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      isGameBuddiesRoom: false, // Will be set by game plugin if from platform
      messages: [],
    };
    
    // Add host as the first player (keyed by player.id, not socketId)
    room.players.set(hostPlayer.id, hostPlayer);
    this.socketToPlayerId.set(hostPlayer.socketId, hostPlayer.id);

    this.rooms.set(roomCode, room);
    this.playerRoomMap.set(hostPlayer.socketId, roomCode);

    console.log(`[RoomManager] Created room ${roomCode} for game ${gameId} (host: ${hostPlayer.name})`);

    return room;
  }

  /**
   * Generate an invite token for a room
   */
  generateInviteToken(roomCode: string): string | null {
    const room = this.rooms.get(roomCode);
    if (!room) return null;

    // Generate a secure random token (using UUID for now, could be shorter if needed)
    const token = randomUUID();
    
    this.inviteTokens.set(token, {
      roomCode,
      createdAt: Date.now()
    });

    console.log(`[RoomManager] Generated invite token ${token.substring(0, 8)}... for room ${roomCode}`);
    return token;
  }

  /**
   * Resolve an invite token to a room code
   */
  resolveInviteToken(token: string): string | null {
    const invite = this.inviteTokens.get(token);
    
    if (!invite) {
      console.log(`[RoomManager] Resolve failed: Token ${token.substring(0, 8)}... not found`);
      return null;
    }

    // Check if room still exists
    const room = this.rooms.get(invite.roomCode);
    if (!room) {
      console.log(`[RoomManager] Resolve failed: Room ${invite.roomCode} for token ${token.substring(0, 8)}... not found (orphaned)`);
      this.inviteTokens.delete(token);
      return null;
    }

    // OPTIONAL: Delete token after use? 
    // For now, let's keep it valid for multiple uses (shareable link) until expiration
    // this.inviteTokens.delete(token);

    return invite.roomCode;
  }

  /**
   * Add player to room
   */
  addPlayerToRoom(roomCode: string, player: Player): boolean {
    const room = this.rooms.get(roomCode);

    if (!room) {
      console.warn(`[RoomManager] Cannot add player: Room ${roomCode} not found`);
      return false;
    }

    // Cancel any pending deletion timer if room was scheduled for cleanup
    const pendingDeletion = this.roomDeletionTimers.get(roomCode);
    if (pendingDeletion) {
      clearTimeout(pendingDeletion);
      this.roomDeletionTimers.delete(roomCode);
      console.log(`[RoomManager] Cancelled scheduled deletion for room ${roomCode} (player rejoined)`);
    }

    // If player already exists in room, treat as reconnection and update mappings even if game has started
    const existingPlayer = room.players.get(player.id);
    if (existingPlayer) {
      const oldSocketId = existingPlayer.socketId;
      const socketChanged = oldSocketId !== player.socketId;

      existingPlayer.socketId = player.socketId;
      existingPlayer.connected = true;
      existingPlayer.disconnectedAt = undefined;
      existingPlayer.lastActivity = Date.now();
      // Preserve host flag/premium tier if already set; fall back to incoming values
      existingPlayer.isHost = existingPlayer.isHost || player.isHost;
      existingPlayer.premiumTier = existingPlayer.premiumTier || player.premiumTier;
      // Preserve existing gameData; if missing, adopt incoming
      if (!existingPlayer.gameData && player.gameData) {
        existingPlayer.gameData = player.gameData;
      }

      // Update socket ↔ player mappings
      this.socketToPlayerId.set(player.socketId, existingPlayer.id);
      this.playerRoomMap.set(player.socketId, roomCode);

      if (socketChanged && oldSocketId) {
        this.socketToPlayerId.delete(oldSocketId);
        this.playerRoomMap.delete(oldSocketId);

        const cleanupTimer = this.oldSocketCleanupTimers.get(oldSocketId);
        if (cleanupTimer) {
          clearTimeout(cleanupTimer);
          this.oldSocketCleanupTimers.delete(oldSocketId);
        }
      }

      console.log(
        `[RoomManager] Updated existing player ${existingPlayer.name} in room ${roomCode} (reconnection${socketChanged ? ` ${oldSocketId} -> ${player.socketId}` : ''})`
      );

      return true;
    }

    // Check if room is full
    if (room.players.size >= room.settings.maxPlayers) {
      console.warn(`[RoomManager] Cannot add player: Room ${roomCode} is full`);
      return false;
    }

    // Check if room has started (depending on game phase)
    if (room.gameState.phase !== 'lobby' && room.gameState.phase !== 'waiting') {
      console.warn(`[RoomManager] Cannot add player: Room ${roomCode} already started`);
      return false;
    }

    room.players.set(player.id, player);
    this.socketToPlayerId.set(player.socketId, player.id);
    this.playerRoomMap.set(player.socketId, roomCode);
    room.lastActivity = Date.now();

    console.log(`[RoomManager] Added player ${player.name} to room ${roomCode}`);

    return true;
  }

  /**
   * Remove player from room
   */
  removePlayerFromRoom(socketId: string): { room: Room | undefined; player: Player | undefined } {
    const roomCode = this.playerRoomMap.get(socketId);

    if (!roomCode) {
      return { room: undefined, player: undefined };
    }

    const room = this.rooms.get(roomCode);
    if (!room) {
      return { room: undefined, player: undefined };
    }

    const playerId = this.socketToPlayerId.get(socketId);
    const player = playerId ? room.players.get(playerId) : undefined;
    if (playerId) {
      room.players.delete(playerId);
      this.socketToPlayerId.delete(socketId);
    }
    this.playerRoomMap.delete(socketId);
    room.lastActivity = Date.now();

    // Clean up any pending old socket cleanup timers
    const cleanupTimer = this.oldSocketCleanupTimers.get(socketId);
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      this.oldSocketCleanupTimers.delete(socketId);
    }

    console.log(`[RoomManager] Removed player from room ${roomCode} (${room.players.size} remaining)`);

    // If room is empty, delete it
    if (room.players.size === 0) {
      // For GameBuddies rooms, defer deletion to allow reconnection
      if (room.isGameBuddiesRoom) {
        if (!this.roomDeletionTimers.has(roomCode)) {
          const timer = setTimeout(() => {
            this.roomDeletionTimers.delete(roomCode);
            this.deleteRoom(roomCode, 'all_players_left');
          }, 2 * 60 * 1000); // 2 minutes grace period for reconnection
          this.roomDeletionTimers.set(roomCode, timer);
          console.log(`[RoomManager] Scheduled deletion for GameBuddies room ${roomCode} in 2m (all players left)`);
        }
      } else {
        this.deleteRoom(roomCode, 'all_players_left');
      }
    }
    // If host left, transfer host to another player
    else if (player && player.isHost) {
      this.transferHost(room);
    }

    return { room, player };
  }

  /**
   * Get room by code
   */
  getRoomByCode(roomCode: string): Room | undefined {
    return this.rooms.get(roomCode);
  }

  /**
   * Get room for a player's socket
   */
  getRoomBySocket(socketId: string): Room | undefined {
    const roomCode = this.playerRoomMap.get(socketId);
    return roomCode ? this.rooms.get(roomCode) : undefined;
  }

  /**
   * Get all rooms for a specific game
   */
  getRoomsByGame(gameId: string): Room[] {
    return Array.from(this.rooms.values()).filter((room) => room.gameId === gameId);
  }

  /**
   * Get all active rooms (across all games)
   */
  getAllRooms(): Room[] {
    return Array.from(this.rooms.values());
  }

  /**
   * Get player by socket ID
   */
  getPlayer(socketId: string): Player | undefined {
    const playerId = this.socketToPlayerId.get(socketId);
    if (!playerId) return undefined;
    const room = this.getRoomBySocket(socketId);
    return room?.players.get(playerId);
  }

  /**
   * Get player ID by socket ID
   */
  getPlayerIdBySocket(socketId: string): string | undefined {
    return this.socketToPlayerId.get(socketId);
  }

  /**
   * Update player in room
   */
  updatePlayer(socketId: string, updates: Partial<Player>): boolean {
    const room = this.getRoomBySocket(socketId);
    if (!room) return false;

    const playerId = this.socketToPlayerId.get(socketId);
    if (!playerId) return false;
    const player = room.players.get(playerId);
    if (!player) return false;

    Object.assign(player, updates);
    room.lastActivity = Date.now();

    return true;
  }

  /**
   * Update room state
   */
  updateRoomState(roomCode: string, state: Partial<GameState>): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    Object.assign(room.gameState, state);
    room.lastActivity = Date.now();

    return true;
  }

  /**
   * Delete room
   * @param roomCode - The room code to delete
   * @param reason - Optional reason for deletion (used in callback)
   */
  deleteRoom(roomCode: string, reason: string = 'room_deleted'): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) {
      console.warn(`[RoomManager] Cannot delete room ${roomCode}: not found (reason: ${reason})`);
      return false;
    }

    // Call onRoomDeleted callback before deleting (fire-and-forget)
    if (this.onRoomDeleted && room.isGameBuddiesRoom) {
      try {
        // Call async callback without awaiting to avoid blocking
        const result = this.onRoomDeleted(room, reason);
        if (result instanceof Promise) {
          result.catch(err => {
            console.error(`[RoomManager] onRoomDeleted callback failed for room ${roomCode}:`, err);
          });
        }
      } catch (err) {
        console.error(`[RoomManager] onRoomDeleted callback error for room ${roomCode}:`, err);
      }
    }

    // Remove all player mappings
    for (const socketId of room.players.keys()) {
      this.playerRoomMap.delete(socketId);
    }

    this.rooms.delete(roomCode);
    console.log(`[RoomManager] Deleted room ${roomCode} (reason: ${reason})`);

    return true;
  }

  /**
   * Transfer host to another player
   */
  private transferHost(room: Room): void {
    const newHost = Array.from(room.players.values())[0];
    if (newHost) {
      newHost.isHost = true;
      room.hostId = newHost.id;
      console.log(`[RoomManager] Transferred host in room ${room.code} to ${newHost.name}`);
    }
  }

  /**
   * Mark player as disconnected (for reconnection grace period)
   */
  markPlayerDisconnected(socketId: string): boolean {
    return this.updatePlayer(socketId, {
      connected: false,
      disconnectedAt: Date.now() // Set timestamp for grace period countdown
    });
  }

  /**
   * Reconnect player with new socket ID
   */
  reconnectPlayer(oldSocketId: string, newSocketId: string): { room: Room | undefined; player: Player | undefined } {
    const roomCode = this.playerRoomMap.get(oldSocketId);
    if (!roomCode) {
      return { room: undefined, player: undefined };
    }

    const room = this.rooms.get(roomCode);
    if (!room) {
      return { room: undefined, player: undefined };
    }

    // Players are keyed by playerId, not socketId
    const playerId = this.socketToPlayerId.get(oldSocketId);
    const player = playerId ? room.players.get(playerId) : undefined;
    if (!player) {
      return { room: undefined, player: undefined };
    }

    // Update player with new socket ID
    player.socketId = newSocketId;
    player.connected = true;
    player.lastActivity = Date.now();

    // No need to swap keys in room.players - it's keyed by player.id!
    // Just update the socketToPlayerId map
    this.socketToPlayerId.delete(oldSocketId);
    this.socketToPlayerId.set(newSocketId, player.id);

    // Update mappings
    this.playerRoomMap.delete(oldSocketId);
    this.playerRoomMap.set(newSocketId, roomCode);

    // Cancel any existing cleanup timer for this old socket
    const existingTimer = this.oldSocketCleanupTimers.get(oldSocketId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.oldSocketCleanupTimers.delete(oldSocketId);
    }

    console.log(
      `[RoomManager] Reconnected player ${player.name} in room ${roomCode}` +
      ` | OLD socket: ${oldSocketId} | NEW socket: ${newSocketId}`
    );

    return { room, player };
  }

  /**
   * Generate unique room code
   */
  private generateUniqueRoomCode(): string {
    let code: string;
    let attempts = 0;
    const maxAttempts = 100;

    do {
      code = validationService.generateRoomCode();
      attempts++;

      if (attempts >= maxAttempts) {
        // Fallback to UUID if we can't generate unique code
        code = randomUUID().substring(0, 6).toUpperCase();
        console.warn(`[RoomManager] Fell back to UUID for room code: ${code}`);
        break;
      }
    } while (this.rooms.has(code));

    return code;
  }

  /**
   * Cleanup expired invite tokens (24 hours)
   */
  private cleanupExpiredInvites(): void {
    const now = Date.now();
    const expirationTime = 24 * 60 * 60 * 1000; // 24 hours

    let cleanedCount = 0;

    for (const [token, data] of this.inviteTokens.entries()) {
      if (now - data.createdAt > expirationTime) {
        this.inviteTokens.delete(token);
        cleanedCount++;
      }
      
      // Also clean up if room no longer exists
      if (!this.rooms.has(data.roomCode)) {
        this.inviteTokens.delete(token);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[RoomManager] Cleaned up ${cleanedCount} expired/orphan invite tokens`);
    }
  }

  /**
   * Cleanup inactive rooms (no activity for 2 hours)
   */
  private cleanupInactiveRooms(): void {
    const now = Date.now();
    const inactiveThreshold = 2 * 60 * 60 * 1000; // 2 hours

    let cleanedCount = 0;

    for (const [code, room] of this.rooms.entries()) {
      if (now - room.lastActivity > inactiveThreshold) {
        this.deleteRoom(code, 'inactive_timeout');
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[RoomManager] Cleaned up ${cleanedCount} inactive room(s)`);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    const gameStats = new Map<string, number>();

    for (const room of this.rooms.values()) {
      gameStats.set(room.gameId, (gameStats.get(room.gameId) || 0) + 1);
    }

    return {
      totalRooms: this.rooms.size,
      totalPlayers: this.playerRoomMap.size,
      roomsByGame: Object.fromEntries(gameStats),
      rooms: Array.from(this.rooms.values()).map((room) => ({
        code: room.code,
        gameId: room.gameId,
        playerCount: room.players.size,
        phase: room.gameState.phase,
        age: Math.floor((Date.now() - room.createdAt) / 1000), // seconds
      })),
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);

    // Clear all old socket cleanup timers
    for (const timer of this.oldSocketCleanupTimers.values()) {
      clearTimeout(timer);
    }
    this.oldSocketCleanupTimers.clear();

    this.rooms.clear();
    this.playerRoomMap.clear();
    this.socketToPlayerId.clear();
    console.log('[RoomManager] Destroyed');
  }
}
