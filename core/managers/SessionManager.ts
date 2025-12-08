import { randomUUID } from 'crypto';
import type { PlayerSession } from '../types/core.js';
import { gameBuddiesService } from '../services/GameBuddiesService.js';

/**
 * Session Manager (Updated)
 *
 * Handles player session tokens and reconnection logic.
 * Allows players to reconnect to their game if they disconnect temporarily.
 * 
 * Note: Now relies on GameBuddies.Io platform for authoritative session validation.
 *
 * Features:
 * - Validates tokens against GameBuddies API
 * - Automatic session expiry
 * - Session cleanup
 */
export class SessionManager {
  private sessions: Map<string, PlayerSession>; // sessionToken -> session
  private playerSessions: Map<string, string>; // playerId -> sessionToken
  private cleanupInterval: NodeJS.Timeout;

  // Session expiry: 30 minutes of inactivity
  private readonly SESSION_EXPIRY_MS = 30 * 60 * 1000;

  /**
   * Truncate session token for safe logging (prevents token exposure in logs)
   */
  private truncateToken(token: string): string {
    if (!token || token.length < 8) return '***';
    return token.substring(0, 8) + '...';
  }

  constructor() {
    this.sessions = new Map();
    this.playerSessions = new Map();

    // Cleanup expired sessions every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredSessions();
    }, 5 * 60 * 1000);

    console.log('[SessionManager] Initialized');
  }

  /**
   * Create/Register a session for a player.
   * 
   * NOTE: The unified game server should ideally receive tokens from the client 
   * (which got them from GameBuddies.io platform).
   * 
   * If a session token is provided, we register it.
   * If NOT provided, we must create a temporary local one (legacy/fallback), 
   * but this will fail API validation with the platform.
   */
  createSession(playerId: string, roomCode: string, existingToken?: string): string {
    // If we have an existing token from the client, use it!
    if (existingToken) {
      // Check if we already track this token
      const existingSession = this.sessions.get(existingToken);
      if (existingSession) {
        // Update
        existingSession.lastActivity = Date.now();
        // Update mapping if player ID changed (unlikely but possible)
        if (existingSession.playerId !== playerId) {
           this.playerSessions.delete(existingSession.playerId);
           existingSession.playerId = playerId;
           this.playerSessions.set(playerId, existingToken);
        }
        console.log(`[SessionManager] Registered existing session for player ${playerId} (${this.truncateToken(existingToken)})`);
        return existingToken;
      }

      // New local tracking for this token
      const session: PlayerSession = {
        playerId,
        roomCode,
        sessionToken: existingToken,
        createdAt: Date.now(),
        lastActivity: Date.now(),
      };
      this.sessions.set(existingToken, session);
      this.playerSessions.set(playerId, existingToken);
      
      console.log(`[SessionManager] Registered external session for player ${playerId} (${this.truncateToken(existingToken)})`);
      return existingToken;
    }

    // Fallback: Create local session (Warning: Won't work with Platform API)
    console.warn(`[SessionManager] Creating LOCAL session for ${playerId}. This player will fail platform API validation!`);

    const sessionToken = randomUUID();
    const session: PlayerSession = {
      playerId,
      roomCode,
      sessionToken,
      createdAt: Date.now(),
      lastActivity: Date.now(),
    };

    this.sessions.set(sessionToken, session);
    this.playerSessions.set(playerId, sessionToken);

    return sessionToken;
  }

  /**
   * Validate and retrieve session
   */
  validateSession(sessionToken: string): PlayerSession | null {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      // We don't know about this session locally.
      // In a fuller implementation, we might query the Platform API here to "hydrate" the session?
      // For now, if it's not in memory, it's invalid for *this* server process.
      console.warn(`[SessionManager] Session not found in memory: ${this.truncateToken(sessionToken)}`);
      return null;
    }

    // Check if session expired
    const age = Date.now() - session.lastActivity;
    if (age > this.SESSION_EXPIRY_MS) {
      console.warn(`[SessionManager] Session expired: ${this.truncateToken(sessionToken)} (age: ${Math.floor(age / 1000)}s)`);
      this.deleteSession(sessionToken);
      return null;
    }

    // Update last activity
    session.lastActivity = Date.now();

    // console.log(`[SessionManager] Validated session for player ${session.playerId}`);

    return session;
  }

  /**
   * Refresh session activity timestamp
   */
  refreshSession(sessionToken: string): boolean {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      return false;
    }

    session.lastActivity = Date.now();
    return true;
  }

  /**
   * Get session by player ID
   */
  getSessionByPlayerId(playerId: string): PlayerSession | null {
    const sessionToken = this.playerSessions.get(playerId);
    if (!sessionToken) {
      return null;
    }

    return this.validateSession(sessionToken);
  }

  /**
   * Delete session
   */
  deleteSession(sessionToken: string): boolean {
    const session = this.sessions.get(sessionToken);

    if (!session) {
      return false;
    }

    this.sessions.delete(sessionToken);
    this.playerSessions.delete(session.playerId);

    console.log(`[SessionManager] Deleted session for player ${session.playerId}`);

    return true;
  }

  /**
   * Delete all sessions for a room (when room is destroyed)
   */
  deleteSessionsForRoom(roomCode: string): number {
    let deleted = 0;

    for (const [token, session] of this.sessions.entries()) {
      if (session.roomCode === roomCode) {
        this.deleteSession(token);
        deleted++;
      }
    }

    if (deleted > 0) {
      console.log(`[SessionManager] Deleted ${deleted} session(s) for room ${roomCode}`);
    }

    return deleted;
  }

  /**
   * Cleanup expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [token, session] of this.sessions.entries()) {
      const age = now - session.lastActivity;
      if (age > this.SESSION_EXPIRY_MS) {
        this.deleteSession(token);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.log(`[SessionManager] Cleaned up ${cleanedCount} expired session(s)`);
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    const now = Date.now();
    const sessionsByRoom = new Map<string, number>();

    for (const session of this.sessions.values()) {
      sessionsByRoom.set(session.roomCode, (sessionsByRoom.get(session.roomCode) || 0) + 1);
    }

    return {
      totalSessions: this.sessions.size,
      sessionsByRoom: Object.fromEntries(sessionsByRoom),
      sessions: Array.from(this.sessions.values()).map((session) => ({
        playerId: session.playerId,
        roomCode: session.roomCode,
        ageSeconds: Math.floor((now - session.createdAt) / 1000),
        lastActivitySeconds: Math.floor((now - session.lastActivity) / 1000),
      })),
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.sessions.clear();
    this.playerSessions.clear();
    console.log('[SessionManager] Destroyed');
  }
}
