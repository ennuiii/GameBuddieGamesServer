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
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.rooms = new Map();
    this.playerRoomMap = new Map();

    // Auto-cleanup inactive rooms every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupInactiveRooms();
    }, 5 * 60 * 1000);

    console.log('[RoomManager] Initialized');
  }

  /**
   * Create a new room
   */
  createRoom(gameId: string, hostPlayer: Player, settings: RoomSettings): Room {
    const roomCode = this.generateUniqueRoomCode();

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
    
    // Add host as the first player
    room.players.set(hostPlayer.socketId, hostPlayer);

    this.rooms.set(roomCode, room);
    this.playerRoomMap.set(hostPlayer.socketId, roomCode);

    console.log(`[RoomManager] Created room ${roomCode} for game ${gameId} (host: ${hostPlayer.name})`);

    return room;
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

    room.players.set(player.socketId, player);
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

    const player = room.players.get(socketId);
    room.players.delete(socketId);
    this.playerRoomMap.delete(socketId);
    room.lastActivity = Date.now();

    console.log(`[RoomManager] Removed player from room ${roomCode} (${room.players.size} remaining)`);

    // If room is empty, delete it
    if (room.players.size === 0) {
      this.deleteRoom(roomCode);
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
    const room = this.getRoomBySocket(socketId);
    return room?.players.get(socketId);
  }

  /**
   * Update player in room
   */
  updatePlayer(socketId: string, updates: Partial<Player>): boolean {
    const room = this.getRoomBySocket(socketId);
    if (!room) return false;

    const player = room.players.get(socketId);
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
   */
  deleteRoom(roomCode: string): boolean {
    const room = this.rooms.get(roomCode);
    if (!room) return false;

    // Remove all player mappings
    for (const socketId of room.players.keys()) {
      this.playerRoomMap.delete(socketId);
    }

    this.rooms.delete(roomCode);
    console.log(`[RoomManager] Deleted room ${roomCode}`);

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

    const player = room.players.get(oldSocketId);
    if (!player) {
      return { room: undefined, player: undefined };
    }

    // Update player with new socket ID
    player.socketId = newSocketId;
    player.connected = true;
    player.lastActivity = Date.now();

    // Update mappings
    room.players.delete(oldSocketId);
    room.players.set(newSocketId, player);
    this.playerRoomMap.delete(oldSocketId);
    this.playerRoomMap.set(newSocketId, roomCode);

    console.log(`[RoomManager] Reconnected player ${player.name} in room ${roomCode}`);

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
   * Cleanup inactive rooms (no activity for 2 hours)
   */
  private cleanupInactiveRooms(): void {
    const now = Date.now();
    const inactiveThreshold = 2 * 60 * 60 * 1000; // 2 hours

    let cleanedCount = 0;

    for (const [code, room] of this.rooms.entries()) {
      if (now - room.lastActivity > inactiveThreshold) {
        this.deleteRoom(code);
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
    this.rooms.clear();
    this.playerRoomMap.clear();
    console.log('[RoomManager] Destroyed');
  }
}
